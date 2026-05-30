# Glossary — Tempo domain + project jargon

A reference legend for the dense vocabulary that runs through [`../../CLAUDE.md`](../../CLAUDE.md), the cloud-sync docs, and the merge modules. Grouped by domain rather than alphabetized — the F-invariant section in particular is the central legend for the `F`-numbers cited across CLAUDE.md and every `js/sync-merge-*.js` header, which otherwise have no single home.

Every entry carries an anchor (a `file.js:line`, an ADR, or a doc) where the term is defined or used. Line numbers drift; the anchor names a symbol or claim you can re-find by grep if the number has moved.

---

## Domain / Wellness terms

**BFRB** — body-focused repetitive behavior (hair-pulling, skin-picking, nail-biting). Tempo logs a "catch" of one to a single consolidated event stream, `bfrb_events`, where each entry is `{ takenAt, context, sessionId?, phase?, cycleIndex?, deviceId, updatedAt, schemaVersion }` and `context ∈ 'global' | 'flow' | 'pomodoro'` (`js/bfrb-events.js:5-20`). A catch triggers a 60-second in-button competing-response countdown (`DURATION_MS = 60 * 1000`, `js/bfrb-recovery.js:11`) that creates cognitive friction around the habit and plays a separately-configurable chime on completion. The consolidated stream replaced three legacy buckets (`bfrbs_global` / `flow_bfrbs` / `pomodoro_bfrbs`) as the single source of truth (F3).

**Flow Block / ultradian rhythm** — a single deep-focus block (90 or 120 minutes) followed by a 15-minute recovery, modeled on the ultradian rest-activity cycle. The engine's focus duration is one of two constants, `FOCUS_90 = 90 * 60000` (5,400,000 ms) or `FOCUS_120 = 120 * 60000` (7,200,000 ms), with recovery fixed at `RECOVERY_MS = 15 * 60000` (`js/flow.js:3-5`). A block has a `phase ∈ 'focus' | 'recovery'` and a status machine that runs `idle → running → overflowing → recovery → done` (`js/flow.js:7-12`).

**Pomodoro phases** — the work/break cycle. `phase ∈ 'work' | 'shortBreak' | 'longBreak'` (`js/pomodoro.js:7`), with `shortBreakMs = 5 * 60000` and `longBreakMs = 15 * 60000` defaults (`js/pomodoro.js:11-12`). The engine captures `previousPhaseSnapshot = { phase, cycleIndex, accumulatedMs }` at the top of every `nextPhase()` call (`js/pomodoro.js:164`) so `revertPhase()` (`js/pomodoro.js:200`) can fold elapsed time back into the prior phase for a one-level "Go back" undo; the snapshot is cleared on `reset()` (`js/pomodoro.js:115`). (Note: the live engine uses status `'overflowing'` where older docs say `'phaseComplete'` — `js/pomodoro.js:3`.)

**ACWR** — acute:chronic workload ratio. A `recovery_state` row metric, rendered `toFixed(2)` and shown only when present as a number (`js/rhythm-ui.js:187-188`; [`recovery-state-contract.md`](recovery-state-contract.md) row schema).

**HRV** — heart-rate variability, in milliseconds. A `recovery_state` row metric, rendered `toFixed(1)` (`js/rhythm-ui.js:184-185`; [`recovery-state-contract.md`](recovery-state-contract.md)).

**RHR** — resting heart rate, in bpm. A `recovery_state` row metric, rendered `Math.round(...)` and shown only as a fallback when fewer than two other metrics are present (`js/rhythm-ui.js:190-191`; [`recovery-state-contract.md`](recovery-state-contract.md)).

**recovery_signal / readiness band** — the categorical recovery band the Rhythm tab paints. `recovery_signal ∈ 'well_recovered' | 'neutral' | 'strained' | 'insufficient_data'` (`js/rhythm-ui.js:89-100`); any unrecognized value falls through to `insufficient_data` — a non-string is coerced (`js/rhythm-ui.js:175-177`) and an unrecognized string hits the map fallback (`:178-179`). It is the only field besides `day` the band strictly requires ([`recovery-state-contract.md`](recovery-state-contract.md) `recovery_signal` enum).

**recovery_state feed** — the one read-only Firestore feed Tempo consumes. An external `personal-health-elt` pipeline (a separate repo, Firebase Admin SDK) materializes a daily `mart_recovery_state` and pushes `users/{uid}/recovery_state/{latest,history}` into Firestore; Tempo only reads and caches it — no write path, no `Schema.stamp` envelope, no merge (`js/recovery-feed.js:2-7`). Every other synced store is read-write; this one is producer-authoritative ([`recovery-state-contract.md`](recovery-state-contract.md)).

---

## Timing terms

**offset / "start with time already elapsed"** — Tempo's headline differentiator: begin a stopwatch with elapsed time pre-loaded ("I took my medication ~30 minutes ago, count up from 30:00"). The pre-load is `offsetMs`, set through the offset-input UI's call to `Stopwatch.setOffset(ms)` (`js/offset-input.js:96`, `:104`) and added into elapsed at read time (`js/stopwatch.js:13`). See [`../../CLAUDE.md`](../../CLAUDE.md) "What This App Is".

**drift-free timing** — elapsed time is *derived* from the device wall clock on every read, never accumulated by a `setInterval`/`setTimeout` tick. The invariant is one line in every engine: `let elapsed = offsetMs + accumulatedMs;` plus `elapsed += Date.now() - startedAt` while running (`js/stopwatch.js:12-18`, `getElapsedMs`). `accumulatedMs` moves only on an explicit `pause()` (`js/stopwatch.js:26-31`). The RAF render loop is cosmetic — it repaints, it does not count. This is what lets a closed tab resume with the correct time. See [ADR 0002](../adr/0002-drift-free-wall-clock-timing.md).

**mutable global proxy** — the top-level binding `let Stopwatch = createStopwatch('sw-default')` (`js/stopwatch.js:172`) is reassigned when the primary instance is swapped, so the ~490-line UI written against the single handle `Stopwatch` follows the new primary with no re-binding. Works only because there is no module system: every `.js` file shares one global lexical scope, and a `let` declared in an earlier script is mutable from every later one. See [ADR 0005](../adr/0005-mutable-global-proxy-primary-instance.md).

**primary instance** — the active stopwatch/timer the global proxy points at. `InstanceManager` holds up to five of each and tracks `primaryStopwatchId` / `primaryTimerId`; `getPrimaryStopwatch()` resolves the live engine (`js/instance-manager.js:7-8`, `:32-33`), and `setPrimaryStopwatch(id)` (`js/instance-manager.js:36-40`) is what triggers the proxy reassignment above (`Stopwatch = instance;`, `:40`).

---

## Sync terms

**LWW (last-write-wins)** — conflict resolution where the record with the higher `updatedAt` wins, and "cloud wins on tie" is uniform across every LWW store (`js/sync-merge-history.js:267-302`). LWW is the default for *editable* fields (notes, tags, sleep entries, med metadata, preset edits) per the v2.0 UX rule (`../CLOUD-SYNC-STRATEGY.md:67`). It is explicitly *rejected as a global policy* because it silently drops append-only data — a whole-record LWW on a med would discard the slower device's `doseLog` entries. See [ADR 0004](../adr/0004-per-store-merge-strategy.md).

**append-merge / union-dedup** — merge an event stream by unioning entries and deduping on a stable signature instead of overwriting the whole record. Used for `doseLog` (dedup `(deviceId, takenAt)`, `../CLOUD-SYNC-STRATEGY.md:31`), `naps` (`(deviceId, startedAt)`, `:35`), `bfrb_events`, `distractions`, and nested `phaseLog` (`(deviceId, phaseStartedAt)`, `:48`) — each merged independent of any LWW envelope winner. This is the correctness property that keeps health data from being lost on the slower device. See [ADR 0004](../adr/0004-per-store-merge-strategy.md).

**CAS (compare-and-swap)** — an atomic conditional write via Firestore `runTransaction`: read the current remote doc inside the transaction and abort if it is future-schema (the transactional half of the F19a guard). Web-only — the native `@capacitor-firebase/firestore` branch throws `'runTransaction native parity pending'` (`js/sync-firestore.js:339`), so native degrades to a 5-min poll + plain `setDoc`. See [ADR 0009](../adr/0009-defer-native-cas-listener-parity.md).

**schemaVersion / F19a refuse-writeback** — every synced record is stamped with its writer's schema version (`SCHEMA_VERSION = 1`, `js/schema.js:30`). A downlevel client detects a future record via `isFutureRecord(record)` — true only for a finite numeric `schemaVersion` strictly greater than the local version (`js/schema.js:38-42`) — and `stamp()` refuses to downgrade it (`js/schema.js:52-57`), so the older client cannot strip the newer client's unrecognized fields on roundtrip. See `../CLOUD-SYNC-STRATEGY.md:57` and [ADR 0004](../adr/0004-per-store-merge-strategy.md).

**deviceId / updatedAt envelope** — the sync metadata stamped onto every synced record so the dedup and LWW rules have keys to work with. `schemaVersion` is set by `Schema.stamp` (`js/schema.js:52-57`); `deviceId` + `updatedAt` are stamped at each engine's own write sites (e.g. `js/bfrb-events.js:198`, `js/history.js:241`) — for meds, `deviceId` is stamped at the `doseLog` entry (`js/meds.js:235`) while record-level `updatedAt` is stamped separately by `touch()` (`js/meds.js:105`, `:133`). CLAUDE.md describes the three together as the one "sync-invariant stamping seam" (`../../CLAUDE.md` line 22). The stamping mandate is prereq F10 (`../CLOUD-SYNC-STRATEGY.md:76`).

**SYNCED_STORES** — the hardcoded six-store registry that is the source of truth for what syncs: `meds`, `history`, `rest_log`, `presets`, `bfrb_events`, `distractions`, each with a `snapshotForSync()` read adapter (`js/sync-engine.js:138-145`). There is no shared merge engine — each store has its own bespoke merge module. See [ADR 0004](../adr/0004-per-store-merge-strategy.md).

**Stage-D handoff** — the imported-bucket reconcile path taken when Device B signs in with existing standalone data *and* the cloud already holds another device's data. Rather than a per-collision prompt (which collapses under months of accumulated doses), Device B's pre-sync history lands in a separate "imported" bucket alongside synced data, stamped with its own `deviceId`, plus a later opt-in manual-dedupe tool (F17, `../CLOUD-SYNC-STRATEGY.md:101`). It is flagged by the `tempo_sync_stage_d_handoff` localStorage key, set when the read-cloud-first guard detects foreign cloud data (D-1; [`../../CLAUDE.md`](../../CLAUDE.md) localStorage keys).

**hydrate / steady-state** — the two halves of the `SyncEngine` lifecycle. `hydrateFromCloud()` (`js/sync-engine.js:989`) pulls each store down in strict order and writes a per-store completion marker, gated by an all-hydrated short-circuit so it is a no-op once done. `startSteadyState()` (`js/sync-engine.js:2425`) then arms the defensive 5-min poll (`STEADY_STATE_DEFAULT_MS = 300000`, `js/sync-engine.js:99`) and, on web, the real-time `onSnapshot` listeners. See [`../diagrams/state-sync.mmd`](../diagrams/state-sync.mmd).

---

## The F-invariants (F1–F21)

The `F`-numbers are the named correctness invariants and prerequisite refactors from the cloud-sync strategy, cited bare all over CLAUDE.md and the merge modules. Each is defined in [`../CLOUD-SYNC-STRATEGY.md`](../CLOUD-SYNC-STRATEGY.md); the line anchor is to that doc. There is **no F11** — the sequence skips it.

| F | One-line definition | Anchor |
| --- | --- | --- |
| **F1** | `doseLog` ±N-minute (±15-min) per-med reconcile, applied in steady-state (not just at one-time migration), to collapse the cross-device "I forgot, let me re-log it" double-entry regardless of `deviceId`. | `../CLOUD-SYNC-STRATEGY.md:31`, `:103` |
| **F2** | Migrate `history.sessions.id` from bare `Date.now()` to `${deviceId}-${Date.now()}-${counter}` via IDB delete+put, preserving `legacyId`, before sync ships. | `../CLOUD-SYNC-STRATEGY.md:74` |
| **F3** | Consolidate the three legacy BFRB buckets into one `context`-tagged append-merge stream (or treat `session.bfrbs` as canonical); both shapes preserve correctness. | `../CLOUD-SYNC-STRATEGY.md:36` |
| **F4** | `lastTakenAt` is **derived, not synced** — re-derived per device from the merged `doseLog` after each merge. | `../CLOUD-SYNC-STRATEGY.md:30`, `:49` |
| **F5** | Primary-instance pointers stay out of sync: a sync-mid-render swap of `primaryStopwatchId` would reassign the live `Stopwatch` module binding underfoot. | `../CLOUD-SYNC-STRATEGY.md:22` |
| **F6** | `phaseLog` is its own append-only stream, each entry stamped `(deviceId, phaseStartedAt)` at push time, folding into `history.sessions` at session-end with a per-entry merge key. | `../CLOUD-SYNC-STRATEGY.md:32`, `:48`, `:110` |
| **F7** | `loadState` recovery branches (auto-advance, `focusEndedAt`, `alarmFired`) are local rendering only, never persisted back. | `../CLOUD-SYNC-STRATEGY.md:39`, `:108` |
| **F8** | Make distraction-log reset representable under append-merge: move to `sessionId`-keyed storage (UI filters by current session) or emit session-cleared tombstone events. | `../CLOUD-SYNC-STRATEGY.md:37` |
| **F9** | Stage-B0 "read cloud first" prerequisite — if the cloud is non-empty, route through the Stage D reconcile path; treat every first-enable as potentially a second device. | `../CLOUD-SYNC-STRATEGY.md:90` |
| **F10** | Stamp `deviceId` + `updatedAt` at every mutation write site (the metadata every LWW/dedup rule references); back-fill existing rows in Stage B. | `../CLOUD-SYNC-STRATEGY.md:76` |
| **F12** | Mandatory full local backup before Stage B mutates any record — `Persistence.clear()` only deletes, so restore-from-backup is the documented rollback if stamping fails partway. | `../CLOUD-SYNC-STRATEGY.md:91` |
| **F13** | Hydrate write gate `tempo_sync_state ∈ {hydrating, ready, error}` — every engine reads it before any write; strict hydrate order rest-log → meds → presets → history with per-store markers. | `../CLOUD-SYNC-STRATEGY.md:78` |
| **F14** | Replace the 200-entry `doseLog` truncate (which silently drops the oldest under append-merge) — raise the cap to 1000 entries (~2.7 years of twice-daily dosing) or soft-warn. | `../CLOUD-SYNC-STRATEGY.md:80` |
| **F15** | Toast on health-data multi-entry arrivals — when an append-merge adds ≥2 remote `doseLog` entries, surface a non-blocking toast so the user can catch a real anomaly. | `../CLOUD-SYNC-STRATEGY.md:31`, `:68` |
| **F16** | ±15-minute clock-skew clamp for `doseLog` entries carrying a non-local `deviceId`, to absorb cross-device clock drift. | `../CLOUD-SYNC-STRATEGY.md:31` |
| **F17** | Stage D defaults to a separate-bucket "imported" history (Alternative 2) rather than a per-collision ±60s prompt, which collapses under realistic data volume. | `../CLOUD-SYNC-STRATEGY.md:101` |
| **F18** | Per-record meds persistence — split `MedsManager.saveAll`'s single blob into `meds/{medId}` keyed records (and `doseLog` as its own subcollection); the largest prereq, gating per-field LWW. | `../CLOUD-SYNC-STRATEGY.md:82` |
| **F19 / F19a / F19b / F19c** | F19a: stamp `schemaVersion` per record and refuse-writeback when `record.schemaVersion > clientVersion`. F19b: pass unknown fields through verbatim via a `__forward` bag. F19c: a per-store manifest registry replacing hardcoded key lists — **deferred**. | `../CLOUD-SYNC-STRATEGY.md:57-58`, `:61` |
| **F20** | Loaders distinguish "field absent" (apply default) from "field present but unknown" (preserve verbatim, do not normalize) — fixes the `MED_FREQUENCIES.includes` destroy-on-roundtrip trap. | `../CLOUD-SYNC-STRATEGY.md:59` |
| **F21** | `alarmFired` is intrinsically per-device — Device B must still play the chime even after Device A fires; it is never synced. | `../CLOUD-SYNC-STRATEGY.md:39` |

---

## Project / build terms

**no-build / script-order-as-dependency-graph** — there is no bundler, transpile, or build artifact. The flat list of `<script>` tags in `index.html` *is* the dependency graph (`index.html:1030-1119`); each module is a self-contained IIFE assigning one global, or a factory function plus a trailing mutable global. Engine modules must load before UI modules, which must load before `app.js`. See [ADR 0001](../adr/0001-no-build-script-load-order.md).

**CACHE_NAME slug** — the service-worker cache key in `sw.js`, shaped `stopwatch-vNNN-<short-slug>` (currently `'stopwatch-v105-sw-schema-asset'`, `sw.js:1`). The number is the de-facto release id — the repo has **zero git tags**, so the slug is the only release marker (`docs/runbooks/deploy-and-cache-bump.md:83-84`), and the slug "names the fix" (`:79`). Any PR that changes a cached web file must bump it in the same PR. See [`../runbooks/deploy-and-cache-bump.md`](../runbooks/deploy-and-cache-bump.md).

**`?nosw=1`** — the query param that bypasses the service worker. `tests/index.html` forces it onto its own URL on load so every script-src request goes to network, not a stale SW cache — the test harness must always run against current source (`tests/index.html:12-13`). Also useful for ad-hoc cache debugging.

---

## See also

- [`../CLOUD-SYNC-STRATEGY.md`](../CLOUD-SYNC-STRATEGY.md) — the authoritative source for every F-invariant and the per-store merge table.
- [`../reference/data-dictionary.md`](data-dictionary.md) — the datastore reference (keys, shapes, and the synced stores).
- [`../reference/recovery-state-contract.md`](recovery-state-contract.md) — the `recovery_state` read-only feed contract (HRV / ACWR / RHR / `recovery_signal`).
- [ADR 0001](../adr/0001-no-build-script-load-order.md), [ADR 0002](../adr/0002-drift-free-wall-clock-timing.md), [ADR 0004](../adr/0004-per-store-merge-strategy.md), [ADR 0005](../adr/0005-mutable-global-proxy-primary-instance.md), [ADR 0009](../adr/0009-defer-native-cas-listener-parity.md).
- [`../runbooks/deploy-and-cache-bump.md`](../runbooks/deploy-and-cache-bump.md) — the `CACHE_NAME` bump rule and naming convention.
- [`../../CLAUDE.md`](../../CLAUDE.md) — the project reference this glossary is the legend for.
</content>
</invoke>
