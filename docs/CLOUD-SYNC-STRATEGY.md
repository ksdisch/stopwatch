# Cloud Sync Strategy v1.0

Backend-agnostic exploration of how Tempo's local-first storage would survive becoming multi-device. Structure only — no backend choice, no API shape, no code.

## Stores in scope

**High stakes** — health record; loss or duplication causes real-world harm.

- `wellness_meds` (localStorage) — medication list + per-med `doseLog: [{takenAt}]`. Drives "did I take it today?".
- IndexedDB `stopwatch_history_db.sessions` — every completed stopwatch / timer / pomodoro / flow / interval / cooking session, plus mutable `note` / `tags` / `bfrbs` per row.
- `wellness_rest_log` — daily sleep hours/quality + naps, keyed by `YYYY-MM-DD`.

**Medium stakes** — active-session continuity and user-curated content.

- Engine state: `multi_state`, `pomodoro_state`, `pomodoro_config`, `flow_state`, `flow_config`, `interval_state`, `sequence_state`, `cooking_timers`.
- Append-only event logs: `bfrbs_global`, `flow_bfrbs`, `pomodoro_bfrbs`, `pomodoro_distractions`, `flow_distractions`.
- Curated content: `quick_presets`, `offset_presets`, `pomodoro_saved_tasks`, `pomodoro_task_templates`, `sequence_templates`.
- Per-session UI: `pomodoro_checklist`, `pomodoro_break_checklist`, `pomodoro_actual_work`, `flow_checklist_state`, `flow_checklist_skipped`, `flow_last_saved_session`.

**Low stakes** — per-device taste is acceptable.

- `app_mode`, `display_mode`, `lap_display_mode`, `vibrate_interval`, `install_dismissed`, `presets_seeded`, `sound_muted`, `sound_profile`, `theme`, `bfrb_volume`, `pomo_auto_advance`.

## Per-store merge strategy


| Store                                                                               | Strategy                                                          | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wellness_meds` (name / dose / frequency)                                           | LWW per-field with `updatedAt`                                    | **✅ Lock** Slow-edit text fields; latest edit wins is fine.                                                                                                                                                                                                                                                                                                                                                                                      |
| `wellness_meds.doseLog`                                                             | Append-merge, dedup by `(deviceId, takenAt)`                      | **✅ Lock**, but flag a ❓ on whether the Stage D prompt is actually sufficient — that's a question worth letting Agent A (data-integrity auditor) stress-test.Append-only health record; never overwrite, never collapse same-ms doses across devices.                                                                                                                                                                                            |
| `history.sessions` (duration / laps / phaseLog / bfrbs / programName / overshootMs) | Append-merge, dedup by `id`                                       | **✅ Lock**Written once on session-end; no edits to these fields afterward.                                                                                                                                                                                                                                                                                                                                                                       |
| `history.sessions` (`note`, `tags`)                                                 | LWW per-field with `updatedAt`                                    | **✅ Lock**Human-driven edits; last write reflects current intent.                                                                                                                                                                                                                                                                                                                                                                                |
| `wellness_rest_log[date].sleep`                                                     | LWW per-day                                                       | **✅ Lock**One sleep entry per night.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `wellness_rest_log[date].naps`                                                      | Append-merge, dedup by `(deviceId, startedAt)`                    | **✅ Lock**Append-only events.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Engine state stores (`*_state`, `*_config`, `cooking_timers`)                       | Server-arbitrated, single active device                           | ❓ Unsure — alternative under consideration: exclude live engine state from sync entirely; only completed sessions sync via Row 3 (loses cross-device session resume but ships massively simpler). Auditors: is server arbitration worth the complexity for a 2-device personal app, or is the "exclude live state, sync only history" alternative sufficient?Only one device can be "running" a session; stale snapshots from others must yield. |
| BFRB / distraction logs                                                             | Append-merge, dedup by `(deviceId, loggedAt)`                     | **✅ Lock**Pure event streams — never lossy.                                                                                                                                                                                                                                                                                                                                                                                                      |
| Templates / presets / saved tasks                                                   | LWW per-record by `id` + `updatedAt`, with tombstones for deletes | **❓ Unsure** — Agent C (schema-evolution auditor) should weigh in on tombstone GC.Explicit user-driven edits and deletions.                                                                                                                                                                                                                                                                                                                      |
| Per-session checklist state                                                         | Server-arbitrated under the active session's device               | ❓ Decision deferred — coupled to Row 7. If Row 7 resolves to "server-arbitrated," keep this. If Row 7 resolves to "exclude from sync," this becomes "exclude from sync" too.Tied to the engine that owns the in-flight session.                                                                                                                                                                                                                  |
| UI prefs (low-stakes block)                                                         | Exclude from sync                                                 | - ✅ LockPer-device taste — phone volume should not match laptop volume.                                                                                                                                                                                                                                                                                                                                                                          |


## Device-origin tagging

Persistent `deviceId` (UUID v4) generated on first launch and stored in localStorage `tempo_device_id`. Tag every record where same-instant collisions across devices are plausible:

- `doseLog`, BFRB, distraction, and nap entries → append `deviceId` to the entry shape.
- `history.sessions.id` → migrate from bare `Date.now()` to `${deviceId}-${Date.now()}-${counter}` so simultaneous session-ends on two devices don't collide.
- Engine state snapshots → stamp with `deviceId` so the server knows the author and can reject stale writes from a non-active device.

Templates, presets, and prefs don't need `deviceId` — they sync record-keyed by stable IDs.

## Migration path

**Stage A — pre-sync (today).** Single device, localStorage + IndexedDB only. Session IDs are bare `Date.now()`; no `deviceId` anywhere. 

- **✅ Lock**

**Stage B — sync enabled on Device A.** Generate `deviceId`, retroactively stamp every existing record, rewrite session IDs to the new shape, then upload a one-shot snapshot. Low risk: single source of truth, no merge.

- **❓ Unsure** — flag as "Agent B (migration auditor) weigh in: what's the rollback story if Stage B fails partway? Should we require a local backup before stamping?"

**Stage C — Device B signs in, no local data.** Pull-down hydrate. Trivial.

- **✅ Lock** the overall direction (pull-down hydrate is correct), but consider adding a sentence: *"During hydrate, the UI shows a sync indicator and blocks new writes until pull completes."* That single line removes the race and the auditors don't have to flag it.

**Stage D — Device B signs in *with existing standalone data*. Riskiest transition.** Device B's pre-sync history has no `deviceId`, and its session IDs (`Date.now()`) may collide with cloud entries Device A wrote in the same minute. Required: stamp Device B's local data with its own `deviceId`, rewrite colliding session IDs, then run a one-time reconcile pass — for every untagged doseLog entry within ±60s of a cloud entry, prompt the user to confirm same-dose-or-separate. Without that prompt we either lose real doses or invent fake ones.

- ❓ Stage D is the highest-stakes transition in the entire migration. Three alternatives under consideration:
  1. As proposed: ±60s reconcile prompt on doseLog.
  2. Separate-bucket: keep Device B's pre-sync history as untagged-and-not-merged, visible alongside synced data.
  3. Defer-reconcile: sync raw, offer manual dedup tool later.
  Auditors: which best protects the medication log from silent corruption? Is the ±60s window right? Is the prompt UX realistic for 6+ months of accumulated entries?

**Stage E — steady-state.** Periodic sync: append-merge for event streams, LWW for editable fields, single-active-device arbitration for engine state. Offline writes buffer locally and replay on reconnect.

- *Coupled to Row 7. If Row 7 resolves to exclude live engine state from sync, drop the 'single-active-device arbitration' clause from this stage.*

## Open questions

- **Backend constraints.** Does the store support efficient append-only subcollections (per-med `doseLog` is the hot path)? Auth that works on both web and a Capacitor iOS shell without re-prompting per surface? Health-data residency / HIPAA-adjacent disclosure rules for medication logs? Cost at single-user-two-devices scale, given the app has no monetization path.
  - ❓ All four sub-questions punted to backend-selection spike (separate from this strategy doc). Auditors: of these four, which is most load-bearing — i.e., which one's answer would *change the strategy* (vs just inform implementation)? My instinct: HIPAA-adjacent disclosure rules might shift this from "any cloud backend" to "end-to-end encrypted only"
- **Conflict UI.** When a merge can't resolve automatically (Stage D dose dedupe; tag-edit races on the same session; engine-state arbitration), do we silently last-write-wins, surface a banner, or ship a "review conflicts" inbox? If Device B starts a Flow block while Device A already has one running, does B refuse, override, or prompt?
  - ✅ For general conflicts (LWW races on tags, sleep, med metadata): silent LWW is acceptable for solo personal use — no banner, no inbox.
  ❓ For "Device B starts a Flow while Device A has one running": coupled to Row 7. Defer until Row 7 resolves.
- **Offline buffer.** Cap on pending-op size? Op compaction for chatty stores like engine snapshots? Do we write `doseLog` locally and optimistically reconcile, or hold until ack? If a buffered "took it now" syncs three days late, does it still claim "now" or get rewritten with the original wall-clock `takenAt`?
  - ✅ Buffered writes always preserve the original wall-clock timestamp captured at user-action time. A "took it now" syncing 3 days late still records the original 9am — not "3 days later."
  ❓ Pending-op cap, op compaction, and optimistic-vs-ack-write semantics are implementation details. Auditors: are any of these strategy-shaping (i.e., would the answer change the merge rules), or are they all pure implementation?
- **Active-session sync.** Worth syncing engine state at all, or only completed history? The drift-free `startedAt + accumulatedMs` timing model means a resumed session on Device B needs exact `startedAt` agreement — feasible but adds ceremony for an unclear payoff.
  - ❓ This is the same decision as Row 7 (engine state stores) and Q2's "Flow-running-on-two-devices" sub-question. All three resolve together. Auditors: please give a single recommendation that covers all three; don't evaluate them independently.

