# Cloud Sync Strategy v2.0

Backend-agnostic strategy for evolving Tempo's local-first storage to multi-device. v2.0 incorporates findings from a three-lens adversarial review (data integrity, migration, schema evolution) — see `docs/sync-review/CONSOLIDATED-FINDINGS.md` for the audit trail. Structure only — no backend choice, no API shape, no code.

## Stores in scope

**High stakes** — health record; loss or duplication causes real-world harm.

- `wellness_meds` (localStorage) — medication list + per-med `doseLog: [{takenAt}]`. Drives "did I take it today?".
- IndexedDB `stopwatch_history_db.sessions` — every completed stopwatch / timer / pomodoro / flow / interval / cooking session, plus mutable `note` / `tags` / `bfrbs` per row.
- `wellness_rest_log` — daily sleep hours/quality + naps, keyed by `YYYY-MM-DD`.

**Medium stakes** — append-only event streams and user-curated content.

- Append-only event logs: `bfrbs_global`, `flow_bfrbs`, `pomodoro_bfrbs`, `pomodoro_distractions`, `flow_distractions`.
- Curated content: `quick_presets`, `offset_presets`, `pomodoro_saved_tasks`, `pomodoro_task_templates`, `sequence_templates`.

**Excluded from sync** — per-device by design.

- All engine state stores (`multi_state`, `pomodoro_state`, `pomodoro_config`, `flow_state`, `flow_config`, `interval_state`, `sequence_state`, `cooking_timers`). Per Q4 resolution: live engine state is per-device; only completed sessions sync via history.
- Per-session checklist state (`pomodoro_checklist`, `pomodoro_break_checklist`, `pomodoro_actual_work`, `flow_checklist_state`, `flow_checklist_skipped`, `flow_last_saved_session`) — coupled to engine state, same exclusion.
- Primary instance pointers (`primaryStopwatchId`, `primaryTimerId` inside `multi_state`) — UI focus, not engine state. A sync-mid-render swap would reassign the live `Stopwatch` module binding underfoot (F5).
- Per-device prefs: `app_mode`, `display_mode`, `lap_display_mode`, `vibrate_interval`, `install_dismissed`, `presets_seeded`, `sound_muted`, `sound_profile`, `theme`, `bfrb_volume`, `pomo_auto_advance`. Phone volume should not match laptop volume.

## Per-store merge strategy

| Store | Strategy | Notes |
| --- | --- | --- |
| `wellness_meds` (`name` / `dose` / `frequency`) | LWW per-field with `updatedAt` | Requires per-record persistence (prereq F18) and unknown-frequency passthrough (schema rule F20). |
| `wellness_meds.lastTakenAt` | **Derived — do not sync** | Re-derived from merged `doseLog` after merge (F4). |
| `wellness_meds.doseLog` | Append-merge, dedup by `(deviceId, takenAt)`, plus ±N-minute per-med reconcile (F1) | Reconcile is steady-state, not just Stage D. ±15-minute clock-skew clamp for entries carrying a non-local `deviceId` (F16). Toast on ≥2-entry remote merges (F15 — see UX rules). |
| `history.sessions` (immutable: `duration`, `laps`, `phaseLog`, `bfrbs`, `programName`, `overshootMs`) | Append-merge, dedup by `id` | Each `phaseLog` entry is stamped `(deviceId, phaseStartedAt)` at push time so the immutable bag has a per-entry merge key (F6). `phaseLog` itself is a separate append-only stream that folds into `history.sessions` at session-end. |
| `history.sessions.note` / `tags` | LWW per-field with `updatedAt` | Stamping is a prereq (F10). |
| `wellness_rest_log[date].sleep` | LWW per-day | One sleep entry per night. |
| `wellness_rest_log[date].naps` | Append-merge, dedup by `(deviceId, startedAt)` | Append-only events. |
| BFRB events | Append-merge, dedup by `(deviceId, loggedAt)` | Either consolidate `bfrbs_global` / `flow_bfrbs` / `pomodoro_bfrbs` into one tagged stream with `context: 'flow' \| 'pomodoro' \| 'global'`, or exclude the session-local buckets entirely and treat `session.bfrbs` (in the synced history row) as canonical (F3). Decision deferred to implementation; both shapes preserve correctness. |
| Distraction logs | Append-merge with session tombstones | Either move to `sessionId`-keyed storage (UI filters by current session, never reset) or emit explicit session-cleared tombstone events into the same stream so reset is representable in append-merge (F8). |
| Templates / presets / saved tasks | LWW per-record by `id` + `updatedAt`, with tombstones for deletes | Records carry `schemaVersion`; loaders pass unknown fields through `__forward` (schema rules F19a/b). |
| Engine state, per-session checklists, primary pointers | **Excluded from sync** | Q4 resolution. `loadState` recoveries (auto-advance, `focusEndedAt`, `alarmFired`) are local rendering only, never persisted back (F7). `alarmFired` is intrinsically per-device — Device B must still play the chime even after Device A fires (F21). |
| UI prefs (low-stakes block) | **Excluded from sync** | Per-device taste. |

## Device-origin tagging

Persistent `deviceId` (UUID v4) generated on first launch and stored in localStorage `tempo_device_id`. Tag every record where same-instant collisions across devices are plausible:

- `doseLog`, BFRB, distraction, and nap entries → `deviceId` appended to the entry shape.
- `history.sessions.id` → migrated from bare `Date.now()` to `${deviceId}-${Date.now()}-${counter}` (F2 — see prereqs).
- `phaseLog` entries → stamped with `(deviceId, phaseStartedAt)` at push time (F6).
- `lastTakenAt` is **derived, not synced** — re-derived from merged `doseLog` per device after each merge (F4).

Templates, presets, and prefs don't need `deviceId` — they sync record-keyed by stable IDs.

## Schema-evolution rules

Sync runs against a shared cloud schema that older clients may not understand. Three rules govern roundtrip safety.

1. **Stamp `schemaVersion` per record at write (F19a).** Every synced record carries its writer's schema version. Clients refuse-writeback when a received record has `schemaVersion > clientVersion`; downlevel clients display the record read-only until the client updates. This is the contract that makes incremental schema changes safe across mixed-version devices.
2. **Unknown fields pass through verbatim via `__forward` (F19b).** Loaders preserve fields they don't recognize in a `__forward` bag and re-emit them on writeback. Without this, the first downlevel client to edit any record silently strips fields written by a newer client.
3. **Loaders distinguish "field absent" from "field present but unknown" (F20).** The current `MED_FREQUENCIES.includes` allowlist silently rewrites unknown frequencies to `as-needed` on roundtrip — a destroy-on-roundtrip trap. Rule: absent → apply default; present-but-unknown → preserve verbatim, do not normalize.

The per-store manifest registry (F19c — replacing hardcoded key lists in `Persistence.clear()` and the sync serializer with a registry stores enumerate themselves into) is **deferred**; see Known limitations.

## UX rules

Two rules cover the conflict surface for v2.0 — everything else is implementation detail.

- **Silent LWW is the default** for editable fields (tags, notes, sleep entries, med metadata, template renames, preset edits). Solo personal use does not justify a "review conflicts" inbox; the cost of surfacing every race exceeds the cost of the rare wrong winner.
- **Toast on health-data multi-entry arrivals (F15).** Whenever an append-merge into `doseLog` adds ≥2 entries from a remote device, surface a non-blocking toast ("4 doses from your phone synced"). Health-data silent merges are unsafe even when "correct" — the user needs to see the arrival to catch real anomalies (a forgotten med, a clock-skew duplicate, a buffered backlog).

## Prerequisite refactor work — must ship before sync

Five code changes block sync adoption regardless of strategy details. These land *before* the backend-selection spike, not as part of the sync rollout itself.

**F2 — `history.sessions.id` migration.** The current `Date.now()` ID shape already collides via the existing JSON export/import path; cross-device sync makes the collision rate worse. Migrate to `${deviceId}-${Date.now()}-${counter}` *before* sync ships. The migration uses IDB delete+put (not in-place mutation, which IndexedDB doesn't support on `keyPath: 'id'`) and preserves `legacyId` on every rewritten row until Stage D pairings complete.

**F10 — `deviceId` and `updatedAt` stamping at every write site.** Every LWW and dedup rule in the per-store table references metadata the engines don't currently emit. `History.updateNote`, `History.addTag`, `MedsManager.logDose`, `History.saveSession`, and equivalent mutation entry points must stamp `deviceId` and `updatedAt` at write time. Stage B back-fills existing rows with `updatedAt = sessionEndedAt || date || Date.now()` so server LWW has a baseline.

**F13 — Hydrate write gate.** Introduce `tempo_sync_state ∈ {hydrating, ready, error}` in localStorage as a shared write gate. Every engine reads it before any persistence write. Hydrate order is strict: rest-log → meds → presets → history. Per-store hydrated markers; missing markers force a re-pull on next boot. The same gate is used in Stage B (block writes during stamping) and Stage C (block writes during pull-down).

**F14 — Replace 200-entry doseLog cap.** `MedsManager` truncates `doseLog` at 200 entries. With cross-device append-merge, the truncate silently drops the oldest entries and Row 2's "never lossy" promise is fiction. Replace with a soft warn (UI nudge to export) or raise the cap to 1000 entries, which gives roughly 2.7 years of twice-daily dosing headroom.

**F18 — Per-record meds persistence.** `MedsManager.saveAll` writes the entire meds collection as a single localStorage blob. Whole-document writes cannot represent per-field LWW at the wire format — Row 1 is structurally impossible until each med is its own keyed record (`meds/{medId}`) and `doseLog` is its own append-only subcollection. This is the largest of the five prereqs and gates everything in Rows 1 and 2.

## Migration path

**Stage A — pre-sync (today).** Single device, localStorage + IndexedDB only. **Lock now extends:** session IDs are device-scoped from this point forward (F2). The bare `Date.now()` shape collides today via JSON export/import, so the ID migration ships standalone — not bundled into Stage B.

**Stage B — sync enabled on Device A.** Generate `deviceId`, retroactively stamp every existing record (`deviceId` + `updatedAt` per F10), rewrite session IDs to the new shape, then upload a one-shot snapshot.

- **Stage B0 prerequisite (F9):** Read cloud first. If non-empty, route through the Stage D reconcile path. Treat every "first enable" as potentially-second-device — naive Stage B silently overwrites a previously-seeded cloud.
- **Mandatory local backup before mutation (F12):** `Persistence.clear()` only deletes — there is no current snapshot path. Write a full local backup file before Stage B touches any record; restore-from-backup is the documented rollback if stamping fails partway.
- **IDB delete+put for ID rewrite (F2):** Not in-place mutation; preserve `legacyId` until Stage D pairings complete.
- **Block all writes during stamping (F13):** Same `tempo_sync_state` gate Stage C uses.

**Stage C — Device B signs in, no local data.** Pull-down hydrate, with hard guarantees.

- `tempo_sync_state = hydrating` blocks all writes until pull completes (F13 — promoted from ❓ to hard requirement).
- Strict hydrate order: rest-log → meds → presets → history. Per-store markers; missing markers force a re-pull on next boot (F13).
- Generate `deviceId` *before* first user gesture so any in-flight session-end during hydrate uses the new ID shape, not bare `Date.now()` (F2).

**Stage D — Device B signs in with existing standalone data.** Default to **Alternative 2 — separate-bucket "imported" history** (F17). Device B's pre-sync history is stamped with its own `deviceId`, kept in an "imported" bucket visible alongside synced data, and an opt-in manual dedupe tool ships later. The per-collision ±60s prompt approach from v1.0 does not survive 360 doses × 6 months of accumulated entries — the UX collapses under realistic data volume.

- Steady-state inherits Stage D's contract (F1): the ±N-minute per-med reconcile rule applies in Stage E too, not just at one-time migration. Two same-med entries within ±N minutes always trigger reconcile — regardless of `deviceId` — to cover the cross-device "I forgot, let me re-log it" case.

**Stage E — steady-state.** Periodic sync: append-merge for event streams, LWW for editable fields, per-record `schemaVersion` checks. Offline writes buffer locally and replay on reconnect.

- **Engine state is excluded** (Q4 resolution). The "single-active-device arbitration for engine state" clause from v1.0 is dropped. Only completed history syncs.
- `loadState` recovery branches (auto-advance, `focusEndedAt`, `alarmFired`) are local rendering only — never persisted back (F7).
- Clients refuse-writeback when `record.schemaVersion > clientVersion`; downlevel clients display read-only until update (F19a).
- `phaseLog` is its own append-only stream that folds into `history.sessions` at session-end (F6).

## Open questions

- **Q1 — Backend constraints.** ✅ **Resolved.** Atomic compare-and-swap on per-record `schemaVersion` is now a hard requirement on the backend-selection spike (driver: F19). Auth across web + Capacitor surfaces, residency / HIPAA-adjacent rules, and cost at single-user-two-devices scale remain inputs to the spike but don't shape the strategy further.
- **Q2 — Conflict UI.** ✅ **Resolved.** Silent LWW for general edits; toast override for `doseLog` append-merges of ≥2 entries (F15). See UX rules.
- **Q3 — Offline buffer.** Partially resolved. ✅ **Locked:** buffered writes always preserve the original wall-clock timestamp captured at user-action time. A "took it now" syncing 3 days late records the original 9am, not "3 days later." ❓ **Deferred to implementation:** pending-op cap, op compaction for chatty stores, optimistic-vs-ack write semantics. None change the merge rules.
- **Q4 — Active-session sync.** ✅ **Resolved.** Exclude live engine state from sync; only completed history syncs. This single decision closes Row 7 of the per-store table, the Stage E arbitration clause, and the "Flow-running-on-two-devices" sub-question simultaneously.

## Known limitations / deferred

- **F19c — per-store manifest registry.** The hardcoded key lists in `Persistence.clear()` and the sync serializer should be replaced with a manifest registry that stores enumerate themselves into. Deferred from v2.0 — schema rules F19a (`schemaVersion` stamping) and F19b (`__forward` passthrough) ship without it; a hardcoded key list works for the current store count and the refactor can land alongside the next pillar that adds a synced store.
- **Q3 sub-questions (offline buffer):** pending-op cap, op compaction, optimistic-vs-ack write semantics — implementation-time decisions, not strategy-shaping.
- **Q1 sub-questions:** auth across web + Capacitor surfaces, health-data residency posture, cost at two-device scale — inputs to the backend-selection spike, not strategy-shaping.
