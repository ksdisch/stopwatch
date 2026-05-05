# Consolidated Findings — Cloud Sync Strategy v1.0 Review

Synthesis of three parallel adversarial reviews (Agent A — data integrity, Agent B — migration, Agent C — schema evolution) against `docs/CLOUD-SYNC-STRATEGY.md` v1.0. Findings deduped across lenses; revisions grouped by v1.0 section. No code, no v2.0 — input for the user's next phase.

## Artifact 1 — Findings table

20 findings, ordered by severity (data-loss → sileption → UX-confusion → migration-fragility), then by frequency-cited descending.


| ID  | Lens  | File:line                                                                               | Severity            | v1.0 decision affected                               | Proposed fix (one sentence)                                                                                                                                                                                                                                                           | Status                                                      |
| --- | ----- | --------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| F1  | A     | js/meds.js:45–55                                                                        | data-loss           | Row 2; Open Q "Conflict UI"; Stage D                 | Promote Stage D's ±N-minute dose-reconcile from one-time migration to a **steady-state** rule keyed by (med, time-window) — `(deviceId, takenAt)` alone fails the cross-device "I forgot, let me re-log it" case.                                                                     | accept (strategy)                                           |
| F2  | A,B,C | js/history.js:96; js/history.js:14 (`keyPath: 'id'`); Stage A/B/D                       | data-loss           | Row 3; Stage A lock; Stage B; Open Q (manual import) | Migrate `history.sessions.id` to `${deviceId}-${Date.now()}-${counter}` *before* sync ships, do IDB delete+put (not in-place mutation), preserve `legacyId` on every rewritten row until Stage D pairings complete.                                                                   | accept (prereq + strategy)                                  |
| F6  | A,C   | js/pomodoro.js:21,125,138–143,175–176,207–215; js/flow.js:phaseLog                      | data-loss           | Row 7; Row 3                                         | Split engine `phaseLog` out of the LWW snapshot into a separate append-only stream keyed by `(deviceId, sessionStartedAt, phaseStartedAt)` that folds into `history.sessions` at session-end.                                                                                         | accept (strategy)                                           |
| F7  | A,B   | js/flow.js:138–153, 178–207, 243–273; js/pomodoro.js:217–269                            | data-loss           | Row 7; Stage E                                       | `loadState` "phase should have finished while page was closed" recoveries (auto-advance, `focusEndedAt` stamp, `alarmFired = true`) are local rendering only — never persisted back to cloud.                                                                                         | accept (strategy)                                           |
| F9  | B     | Stage B (strategy doc)                                                                  | data-loss           | Stage B                                              | Add **Stage B0**: read cloud first; if non-empty, route through Stage D reconcile path. Treat every "first enable" as potentially-second-device — current Stage B silently overwrites a previously-seeded cloud.                                                                      | accept (strategy)                                           |
| F13 | B     | js/app.js (boot); js/persistence.js:10; js/instance-manager.js:92                       | data-loss           | Stage C                                              | Promote "block writes during hydrate" from ❓ to hard requirement: introduce `tempo_sync_state ∈ {hydrating, ready, error}` shared write gate, strict order rest-log → meds → presets → history, per-store markers.                                                                    | accept (prereq + strategy)                                  |
| F14 | B     | js/meds.js:53 (200-entry cap); meds.js:196 (saveAll)                                    | data-loss           | Row 2                                                | Replace the 200-entry doseLog truncate with a soft warn or 1000-entry cap; otherwise cross-device append-merge silently drops oldest entries and Row 2's "never lossy" promise is fiction.                                                                                            | accept (prereq)                                             |
| F16 | B     | js/meds.js:147 (clock-skew future-clamp)                                                | data-loss           | Row 2                                                | Widen the future-clamp from ±60s to ±15min for entries carrying a non-local `deviceId` — distinguish "my clock skewed" from "another device's clock differs."                                                                                                                         | accept (code fix)                                           |
| F20 | C     | js/meds.js:121–127 (`MED_FREQUENCIES.includes` allowlist)                               | data-loss           | Row 1; Open Q (schema)                               | Loader must distinguish "field absent" (apply default) from "field present but unknown" (preserve verbatim) — current allowlist silently rewrites unknown frequency to `as-needed` on roundtrip.                                                                                      | accept (code fix + schema rule)                             |
| F18 | B,C   | js/meds.js:196–201 (single-blob saveAll)                                                | sileption           | Row 1; Row 2                                         | Split persistence shape: each med becomes its own keyed record (`meds/{medId}`), `doseLog` is its own append-only subcollection — without this, Row 1's "LWW per-field" is structurally impossible at the wire.                                                                       | accept (prereq — big)                                       |
| F3  | A     | CLAUDE.md (`bfrbs_global`/`flow_bfrbs`/`pomodoro_bfrbs`)                                | sileption           | Row 6                                                | Either tag a single `bfrb_events` stream with `context: 'flow'|'pomodoro'|'global'` at write time, or exclude `flow_bfrbs`/`pomodoro_bfrbs` from sync (session-local scratchpads; `session.bfrbs` is canonical).                                                                      | accept (strategy)                                           |
| F4  | A     | js/meds.js:54, 105–110, 138–142                                                         | sileption           | Row 1                                                | Mark `lastTakenAt` non-synced / derived-on-load — re-derive from merged `doseLog` after merge; add a "derived (do not sync)" column to the per-store table.                                                                                                                           | accept (strategy)                                           |
| F8  | A     | CLAUDE.md (distractions cleared on session start/reset/complete)                        | sileption           | Row 6                                                | Either store distractions as sessionId-keyed (never clear; UI filters to current session), or emit an explicit session-cleared tombstone event so other devices' merges drop pre-reset entries.                                                                                       | accept (strategy)                                           |
| F5  | A     | js/instance-manager.js:7–8, 36–41, 86                                                   | UX-confusion        | Row 7; low-stakes block                              | Move `primaryStopwatchId` / `primaryTimerId` to the per-device exclude-from-sync block — they're UI focus, not engine state, and a sync mid-render swap reassigns the live `Stopwatch` module binding underfoot.                                                                      | accept (strategy)                                           |
| F15 | B     | strategy Open Q "Conflict UI"                                                           | UX-confusion        | Row 2; Open Q "Conflict UI"                          | Surface a non-blocking toast ("4 doses from your phone synced") whenever an append-merge adds ≥2 entries — silent LWW is fine for solo edits, **not** for health-data multi-entry arrivals.                                                                                           | accept (UX rule)                                            |
| F21 | C     | js/pomodoro.js:235; js/flow.js:253                                                      | UX-confusion        | Row 7                                                | `alarmFired` is per-device ("I already played the chime") — sync excludes it even when other engine fields aren't, otherwise Device B suppresses the alarm because Device A already fired it.                                                                                         | accept (strategy)                                           |
| F10 | B     | js/history.js:134, 157; js/meds.js (logDose); meds.js:177                               | migration-fragility | Rows 1, 2, 4, 6, 9; device-origin tagging            | Block sync adoption until engines stamp `deviceId` and `updatedAt` at every write site, plus a Stage B back-fill (`updatedAt = sessionEndedAt || date || Date.now()`) — every LWW/dedup rule references metadata the engines don't yet emit.                                          | accept (prereq — big)                                       |
| F12 | B     | js/persistence.js:10 (`clear()`); Stage B                                               | migration-fragility | Stage B                                              | Mandate a local backup file written before any Stage B mutation begins; restore-from-backup is the rollback if stamping fails partway. No current code path snapshots — `Persistence.clear()` only deletes.                                                                           | accept (strategy)                                           |
| F17 | B     | Stage D ±60s prompt                                                                     | migration-fragility | Stage D                                              | Default Stage D to **Alternative 2** (separate-bucket "imported" history visible alongside synced) with an opt-in dedupe tool later — a per-collision prompt UI does not survive 360 doses × 6mo of accumulated entries.                                                              | accept (Stage D resolution)                                 |
| F19 | C     | js/meds.js:113–151; js/pomodoro.js:217–269; js/flow.js:243–292; js/persistence.js:11–21 | migration-fragility | Row 9; Stage E; Open Q (backend)                     | Stamp `schemaVersion` per record at write; loader preserves unknown fields in `__forward` passthrough; refuse-writeback when `record.schemaVersion > clientVersion`; replace hardcoded key lists in `Persistence.clear()` and the sync serializer with a per-store manifest registry. | accept (a, b — schema rules); defer (c — manifest refactor) |


## Artifact 2 — Strategy revisions needed

Grouped by section of v1.0. Each revision cites the finding IDs that drive it.

### Per-store table

**Row 1 — `wellness_meds` (name / dose / frequency) LWW per-field with `updatedAt`** (drivers: F4, F10, F18, F20)

- Add a "derived (do not sync)" column and move `lastTakenAt` into it; re-derive from merged `doseLog` after merge.
- Block adoption until engines stamp `updatedAt` at every mutation site (F10).
- Whole-document `MedsManager.saveAll` cannot represent per-field LWW at the wire format — split persistence so each med is its own record before sync ships (F18).
- `frequency` field must distinguish "absent" (apply default) from "unknown" (preserve verbatim, do not normalize) — `MED_FREQUENCIES.includes` allowlist is a destroy-on-roundtrip trap (F20).

**Row 2 — `wellness_meds.doseLog` append-merge, dedup by `(deviceId, takenAt)`** (drivers: F1, F10, F14, F15, F16)

- Promote Stage D's reconcile contract to steady-state: any two doseLog entries within ±N minutes for the same med trigger reconcile, regardless of `deviceId` (F1).
- Block adoption until `logDose` stamps `deviceId` (F10).
- Replace the 200-entry cap with a soft warn or 1000-entry cap (F14).
- Widen the clock-skew future-clamp from ±60s to ±15min for entries carrying a non-local `deviceId` (F16).
- Append-merges of ≥2 entries surface a toast — health-data silent merges are unsafe (F15).

**Row 3 — `history.sessions` (immutable fields), append-merge by `id`** (drivers: F2, F6)

- Migrate `id` shape to `${deviceId}-${Date.now()}-${counter}` *before* sync ships, with a one-time backfill of existing rows (F2).
- Stamp every `phaseLog` entry with `(deviceId, phaseStartedAt)` at push time so the immutable bag has a per-entry merge key (F6).

**Row 4 — `history.sessions.note` / `tags` LWW per-field with `updatedAt*`* (driver: F10)

- Block adoption until `History.updateNote` and `addTag` stamp `updatedAt`; Stage B back-fills existing rows.

**Row 6 — BFRB / distraction logs append-merge by `(deviceId, loggedAt)`** (drivers: F3, F8)

- Replace single row with two sub-rows. BFRBs: either consolidate `bfrbs_global`/`flow_bfrbs`/`pomodoro_bfrbs` into one tagged stream with `context: 'flow' | 'pomodoro' | 'global'`, or exclude the session-local buckets entirely and treat `session.bfrbs` (in the synced history row) as canonical (F3).
- Distractions: either move to sessionId-keyed storage (never reset; UI filters by current session), or emit explicit session-cleared tombstone events into the same stream so reset is representable in append-merge (F8).

**Row 7 — Engine state stores, server-arbitrated single active device** (drivers: F5, F6, F7, F21)

- **Resolve in favor of "exclude live engine state from sync."** Auditors converge on this: server arbitration cannot model two-device-mid-session safely, `loadState` recovery branches write back local artifacts that double-count, and the bucket is heterogeneous (some fields are device-local).
- `primaryStopwatchId` / `primaryTimerId` move to the low-stakes block — they're per-device UI focus and the sync-mid-render binding swap is unsafe (F5).
- `alarmFired` joins the per-device exclusion list even if other engine fields ever sync (F21).
- `phaseLog` splits out to its own append-only stream and folds into `history.sessions` at session-end (F6).
- `loadState` recovery actions are local rendering only — never persisted back (F7).

**Row 9 — Templates / presets / saved tasks LWW per-record with tombstones** (driver: F19)

- Records carry `schemaVersion`; loader preserves unknown fields in `__forward` passthrough; refuse-writeback when `record.schemaVersion > clientVersion`.
- Per-store manifest registry: stores enumerate themselves on init, sync layer + `Persistence.clear()` iterate the manifest (no hardcoded key lists).

### Migration path stages

**Stage A — pre-sync (today)** (driver: F2)

- Lock includes "session IDs are device-scoped from this point forward." The bare `Date.now()` shape collides today via the existing JSON export/import path; ID migration must land before sync ships, not as part of Stage B.

**Stage B — sync enabled on Device A** (drivers: F2, F9, F10, F12, F13)

- **Stage B0** prerequisite: read cloud first; if non-empty, route through Stage D reconcile path (F9).
- Mandate a local backup file written before any mutation begins; restore-from-backup is the documented rollback (F12).
- ID rewrite uses IDB delete+put (not in-place mutation) and preserves `legacyId` on every rewritten row until Stage D pairings complete (F2).
- `updatedAt` back-fill at stamping time: every record gets `updatedAt = sessionEndedAt || date || Date.now()` so server LWW has a baseline (F10).
- Block all writes during stamping using the same shared write gate Stage C requires (F13).

**Stage C — Device B signs in, no local data** (drivers: F2, F13)

- Promote the parenthetical "block writes during hydrate" from ❓ to **hard requirement** (F13).
- Add `tempo_sync_state ∈ {hydrating, ready, error}` localStorage key; every engine reads it before any write (F13).
- Strict hydrate order: rest-log → meds → presets → history; per-store hydrated marker; missing markers force re-pull on next boot (F13).
- Generate `deviceId` before first user gesture so any in-flight session-end during hydrate uses the new ID shape, not bare `Date.now()` (F2).

**Stage D — Device B signs in with existing standalone data** (drivers: F1, F17)

- Default to **Alternative 2** (separate-bucket "imported" history visible alongside synced) with an opt-in dedupe tool later — the ±60s prompt approach does not survive 360 doses × 6 months (F17).
- Steady-state inherits Stage D's contract — the ±N-minute reconcile rule applies in Stage E too, not just at one-time migration (F1).

**Stage E — steady-state** (drivers: F5, F6, F7, F19, F21)

- Drop the "single-active-device arbitration for engine state" clause; Row 7 resolves to exclude live engine state from sync (F5, F6, F7, F21).
- `loadState` recovery branches (auto-advance, `focusEndedAt`, `alarmFired`) are local rendering only — never persisted back (F7).
- Clients refuse-writeback when receiving a record with `schemaVersion > clientVersion`; downlevel display is read-only until update (F19).
- Sync layer iterates the per-store manifest; new pillars register on load (F19).

### Open questions

**Backend constraints** (driver: F19)

- `schemaVersion`-aware writes are a backend requirement: rules out backends without atomic compare-and-swap on per-record version. Add this constraint to the backend-selection spike before shopping vendors.

**Conflict UI** (driver: F15)

- Confirm: silent LWW is acceptable for solo edits on tags/sleep/med metadata. **Override**: any append-merge that adds ≥2 entries to a doseLog stream surfaces a toast — health-data silent merges are unsafe even when "correct."

**Active-session sync** — resolves Row 7, the "Flow-running-on-two-devices" sub-question, and the Stage E arbitration clause as a single decision (drivers: F5, F6, F7, F18, F21)

- **Recommendation: exclude live engine state from sync; only completed history syncs.** Same recommendation closes all three open questions in this cluster simultaneously. Live `phaseLog` becomes a separate append stream that folds into `history.sessions` at session-end (F6); `primaryStopwatchId` and `alarmFired` stay per-device (F5, F21); `loadState` recoveries don't write back (F7); the whole-blob meds-style granularity problem doesn't apply because engine state isn't on the wire (F18).



## Open question resolutions

- **Q1 — Backend constraints (driver: F19):** ✅ Accept. Add "atomic

  compare-and-swap on per-record schemaVersion" to the backend-selection

  spike's hard requirements list.

- **Q2 — Conflict UI (driver: F15):** ✅ Accept. Silent LWW for general

  edits; toast override for doseLog append-merges of ≥2 entries.

- **Q3 — Offline buffer:** No auditor recommendation in the consolidation.

  Phase 1 ✅-locked "buffered writes preserve original takenAt"; the

  cap/compaction/optimistic-write sub-questions remain ❓ for Phase 4

  to resolve or defer to implementation.

- **Q4 — Active-session sync (drivers: F5, F6, F7, F18, F21):** ✅ Accept.

  **Exclude live engine state from sync; only completed history syncs.**

  This single decision resolves Row 7, Stage E's arbitration clause,

  and Q2's Flow-conflict sub-question simultaneously.

