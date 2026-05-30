# Data Dictionary — every persisted datum in Tempo

> **Provenance:** key list verified by grep across `js/*.js` on **2026-05-30**, then each
> claim re-opened against the cited source line. Every `file.js:line` anchor below was
> confirmed against the file at author time.
>
> **Maintenance:** re-grep `localStorage.(get|set|remove)Item` + the `SYNCED_STORES`
> registry on any schema change. New synced field → check the envelope rule
> ([§4](#4-the-sync-envelope)) and the relevant merge module. Cross-links:
> [ADR 0004](../adr/0004-per-store-merge-strategy.md) (per-store merge), ADR 0006
> (split localStorage/IndexedDB persistence — planned, see `docs/adr/README.md:21-22`).
>
> **Drift caught vs. `CLAUDE.md` (2026-05-30):** two keys present in code but missing
> from the `CLAUDE.md` localStorage list — `flow_vibrate_interval` (`js/flow-ui.js:36`)
> and `flow_ambient_profile` (`js/flow-ui.js:49`), both Phase 10 additions. Also absent
> from that list: `tempo_device_id` (`js/history.js:6`), `tempo_sync_state`
> (`js/persistence.js:8`), `tempo_sync_steady_interval_ms` (`js/sync-engine.js:102`),
> `stopwatch_history`/`stopwatch_state`/`timer_state` legacy keys, and the two
> `tempo_recovery_state_*` cache keys (`js/recovery-feed.js:20-21`). All catalogued below.

---

## 1. localStorage keys

"Synced?" = present in Firestore `SYNCED_STORES` ([§3](#3-firestore-synced-stores)).
"Export?" = present in `EXPORT_SETTINGS_KEYS` (`js/export.js:74-118`) and therefore in
local backup / full-data JSON export. Many synced stores are NOT raw-keyed in
`EXPORT_SETTINGS_KEYS` (they sync via their own snapshot adapter, not the flat key copy).

### 1a. Core UI / config

| Key | Owner module | Shape | Synced? | Export? | Notes |
|---|---|---|---|---|---|
| `app_mode` | `js/app.js:2` | string enum (`stopwatch`/`timer`/`pomodoro`/…) | no | yes | Active mode. Also written by Presets apply (`js/presets.js:105`). |
| `display_mode` | `js/analog.js:3,62` | string (`digital`/`analog`) | no | yes | Clock face. |
| `lap_display_mode` | `js/ui.js:5,238` | string (cumulative vs split) | no | yes | Lap list rendering. |
| `vibrate_interval` | `js/ui.js:6,57` | int ms | no | yes | Stopwatch vibration cadence. |
| `theme` | `js/themes.js:2,54,61` | string preset id, default `'auto'` | no | yes | 6 presets. |
| `sound_muted` | `js/audio.js:3,92` | `'1'`/`'0'` | no | yes | SFX mute. |
| `sound_profile` | `js/audio.js:4,115` | string, default `'classic'` | no | yes | SFX profile. |
| `bfrb_volume` | `js/audio.js:43` | numeric string | no | yes | BFRB chime volume. |
| `install_dismissed` | `js/app.js:120,146` | `'1'` | no | yes | PWA install-prompt dismissal. |
| `tempo_device_id` | `js/history.js:6,16-29` | UUID v4 string | no | no | Stable per-device id. Generated once; reused by `meds`/`distractions`/`bfrb-events` for sync dedup signatures. Read-mirrored in `js/meds.js:70`, `js/distractions.js:74`, `js/bfrb-events.js:64`. |

### 1b. Engine state

| Key | Owner module | Shape | Synced? | Export? | Notes |
|---|---|---|---|---|---|
| `multi_state` | `js/instance-manager.js:3,86` | JSON `{ stopwatches[], timers[], primaryId }` | no | yes | All stopwatch + timer instances (≤5 each). |
| `stopwatch_state` | `js/instance-manager.js:135-140` | legacy JSON | no | no | **Legacy** single-instance key; migrated into `multi_state` then removed. |
| `timer_state` | `js/instance-manager.js:144-149` | legacy JSON | no | no | **Legacy**; same migration path. |
| `pomodoro_state` | `js/pomodoro-ui.js:564` | JSON Pomodoro state | no | yes | Cleared on done-cleanup (`js/app.js:15`). |
| `pomodoro_config` | `js/pomodoro-ui.js:54` | JSON `{ workMs, shortBreakMs, … }` | no | yes | |
| `pomo_auto_advance` | `js/pomodoro-ui.js:3,115` | `'1'`/`'0'` | no | yes | Auto-advance phase toggle. |
| `pomodoro_checklist` | `js/persistence.js:62` (cleanup) / `js/presets.js:156` | JSON item array | no | yes | Focus checklist. |
| `pomodoro_break_checklist` | `js/persistence.js:63` | JSON item array | no | yes | Break checklist. |
| `pomodoro_actual_work` | `js/persistence.js:64` | JSON item array | no | yes | Actual-work checklist. |
| `pomodoro_saved_tasks` | `js/persistence.js:65` | JSON `Array<{ text, todoistId?, done, localTag? }>` | no | yes (Todoist linkage stripped, `js/export.js:158-159`) | Inline-rename + Todoist write-back. |
| `pomodoro_task_templates` | `js/persistence.js:66` | JSON template array | no | yes | |
| `flow_state` | `js/flow-ui.js:1120` | JSON Flow Block state | no | yes | |
| `flow_config` | `js/flow-ui.js:1124` | JSON `{ focusDurationMs, … }` | no | yes | |
| `flow_checklist_state` | `js/flow-ui.js:6,96` | JSON ritual-checklist state | no | yes | Hardcoded 5-item ritual. |
| `flow_checklist_skipped` | `js/flow-ui.js:7,110` | `'1'` | no | yes | |
| `flow_last_saved_session` | `js/flow-ui.js:102,1069` | timestamp string | no | yes | Dedup guard for history capture. |
| `flow_vibrate_interval` | `js/flow-ui.js:36,172` | int ms string, default `'0'` | no | no | **Not in `CLAUDE.md` list.** Phase 10 Flow vibration cadence. |
| `flow_ambient_profile` | `js/flow-ui.js:49,185` | string profile id | no | no | **Not in `CLAUDE.md` list.** Phase 10 Flow ambient-noise selection. |
| `interval_state` | `js/interval-ui.js:7,414` | JSON Interval engine state | no | yes | Also written by Exercise presets (`js/exercise-ui.js:186,197`). |
| `sequence_state` | `js/sequence-ui.js:5` | JSON Sequence state | no | yes | |
| `sequence_templates` | `js/sequence-ui.js:4` | JSON template array | no | yes | |
| `cooking_timers` | `js/cooking-ui.js:2` | JSON named-timer array | no | yes | ≤8 concurrent. |
| `offset_presets` | `js/offset-input.js:187,194` | JSON preset array | no | yes | "Start with time elapsed" presets; migrated into `quick_presets` (`js/presets.js:292,313`). |

### 1c. Wellness

| Key | Owner module | Shape | Synced? | Export? | Notes |
|---|---|---|---|---|---|
| `wellness_meds` | `js/meds.js` (MedsManager) / read `js/analytics.js:426` | JSON med-record array | **yes** (`meds`) | yes | Each record stamped via Schema. Derived supply ([§5](#5-derived-vs-stored)); doseLog capped at 1000 (`js/meds.js:239`). |
| `wellness_rest_log` | `js/recovery-ui.js:15,46` | JSON object keyed by `YYYY-MM-DD`: `{ sleep:{hours,quality?}, naps:[…] }` | **yes** (`rest_log`) | yes | Read by Rhythm (`js/rhythm-engine.js:182`). `bedtime`/`wakeTime` planned ([§6](#6-additive-nullable-fields)). |
| `bfrb_events` | `js/bfrb-events.js:48` | JSON entry array `{ takenAt, context, sessionId?, …, deviceId, updatedAt, schemaVersion }` | **yes** (`bfrb_events`) | no (synced via adapter) | F3 consolidated stream; `context ∈ global/flow/pomodoro`. |
| `tempo_bfrb_events_migration_v1` | `js/bfrb-events.js:49,261` | `'1'` | no | no | Idempotency marker for legacy-bucket → `bfrb_events` migration. |
| `bfrbs_global` | `js/bfrb-events.js:50` (legacy) / `js/global-bfrb.js:46` | JSON array | no | yes | **Legacy** BFRB bucket; retained one release, no scheduled removal. |
| `flow_bfrbs` | `js/bfrb-events.js:50` (legacy) / `js/flow-ui.js:5,84` | JSON array | no | yes | **Legacy** bucket. |
| `pomodoro_bfrbs` | `js/bfrb-events.js:50` (legacy) / `js/pomodoro-ui.js:1264` | JSON array | no | yes | **Legacy** bucket. |
| `flow_distractions` | `js/distractions.js:58` / `js/flow-ui.js:4` | JSON `sessionId`-keyed map `{ [sid]: [entries] }` | **yes** (`distractions`) | yes | F8 keyed map (was flat array). |
| `pomodoro_distractions` | `js/distractions.js:59` / `js/pomodoro-ui.js:1204` | JSON `sessionId`-keyed map | **yes** (`distractions`) | yes | Same shape; both maps travel under one snapshot envelope. |
| `tempo_distractions_migration_v1` | `js/distractions.js:60,329` | `'1'` | no | no | F8 flat-array → keyed-map migration marker. |

### 1d. Todoist (device-local — never synced, never exported)

| Key | Owner module | Shape | Synced? | Export? | Notes |
|---|---|---|---|---|---|
| `todoist_api_token` | `js/todoist.js:65,89-107` | string token | no | **no** (excluded by design — credential) | Re-paste per device. |
| `todoist_default_project_id` | `js/todoist.js:66,118-130` | string id | no | no | Default project for new tasks. |
| `todoist_default_filter` | `js/todoist.js:67,137-155` | string, default `'today'` | no | no | Picker filter. |
| `todoist_pending_ops` | `js/todoist.js:68,443-467` | JSON op queue (`close`/`reopen`/`create`/`update`), 200-op FIFO cap | no | no | Drains on `online` + `visibilitychange:visible`. Read in `js/todoist-ui.js:216`. |
| `flow_user_tasks` | `js/flow-ui.js:15,19-27` | JSON `Array<{ text, todoistId?, done, localTag? }>` | **no** (Todoist is cross-device truth) | yes (linkage stripped, `js/export.js:99,158`) | Flow "Tasks for this block". `done` resets each `Flow.start()`. |

### 1e. Sync infrastructure (markers / flags)

| Key | Owner module | Shape | Synced? | Export? | Notes |
|---|---|---|---|---|---|
| `tempo_sync_enabled` | `js/sync-flag.js:19,23-34` | `'1'`/`'0'`, default off | no | no | Master cloud-sync feature flag. |
| `tempo_sync_state` | `js/persistence.js:8,13-30` | string (`ready`/`hydrating`) | no | no | F13 cross-store write gate (`SyncState.canWrite()`). Distinct from the feature flag above. |
| `tempo_sync_partial_upload_uid` | `js/sync-engine.js:69` | UID string | no | no | Mid-upload marker; cleared on success. |
| `tempo_sync_stage_d_handoff` | `js/sync-engine.js:70` | flag | no | no | Set when existing cloud data from another device is detected (D-1 consumes). |
| `tempo_sync_hydrated_<store>` | `js/sync-engine.js:78` (prefix `tempo_sync_hydrated_`) | `'1'` | no | no | Per-store hydrate-completion markers (`rest_log`/`meds`/`presets`/`history`). |
| `tempo_sync_hydrated_all` | `js/sync-engine.js:79` | `'1'` | no | no | Short-circuit gate — once set, `hydrateFromCloud()` is a no-op. |
| `tempo_sync_steady_interval_ms` | `js/sync-engine.js:102` | int ms, default 300000, clamp [10s,10m] | no | no | **Not in `CLAUDE.md` list.** Optional steady-state poll-interval override. |

### 1f. Presets

| Key | Owner module | Shape | Synced? | Export? | Notes |
|---|---|---|---|---|---|
| `quick_presets` | `js/presets.js:2` / read `js/schema.js:22` | JSON preset records (each Schema-stamped; soft-delete via `deletedAt`) | **yes** (`presets`) | yes | `getAll()` filters out tombstones (`js/presets.js:13`). |
| `presets_seeded` | `js/presets.js:3` | `'1'` | no | yes | First-run seed marker. |

### 1g. Recovery cache (read-only feed mirror)

| Key | Owner module | Shape | Synced? | Export? | Notes |
|---|---|---|---|---|---|
| `tempo_recovery_state_latest` | `js/recovery-feed.js:20,29-45` | JSON latest-day recovery doc | no (one-way pull cache) | no | **Not in `CLAUDE.md` list.** Offline render cache of Firestore `recovery_state/latest`. |
| `tempo_recovery_state_history` | `js/recovery-feed.js:21,29-45` | JSON `{ rows: [...≤14 days] }` | no (one-way pull cache) | no | **Not in `CLAUDE.md` list.** Cache of `recovery_state/history`. No write path. |

---

## 2. IndexedDB stores

Two separate IDB databases by design — see ADR 0006 (planned, `docs/adr/README.md:21-22`).
Sessions are canonical user data; the pending-op buffer is transient sync infrastructure.
Orthogonal lifecycles → independently revertable (`js/sync-buffer.js:19-22`).

| DB / store | Owner | keyPath | Indexes | Cap | Purpose |
|---|---|---|---|---|---|
| `stopwatch_history_db` v1 / `sessions` | `js/history.js:2-3,53-57` | `id` (string `deviceId-ts-counter`, `js/history.js:32-34`) | none | unbounded | Canonical session history. Migrates legacy `stopwatch_history` localStorage on first load (`js/history.js:68-94`). Synced as the `history` store. |
| `tempo_sync_db` v1 / `pending_ops` | `js/sync-buffer.js:69-72` | `id` (autoincrement) | `enqueuedAt` (FIFO drain) | **1000** (`PENDING_OP_CAP`, `js/sync-buffer.js:75`) | Offline write buffer. Holds pointer-shaped ops `{ id, store, recordId, originalWallClock, enqueuedAt }` — never a record copy (`js/sync-buffer.js:12-17`). Drained FIFO on `Platform.network` online. Overflow drops oldest + emits `buffer-overflow`. |

**Why two DBs:** keeping the buffer out of `stopwatch_history_db` lets the entire E-2
offline-buffer feature be reverted without touching the canonical history schema
(`js/sync-buffer.js:19-22`).

---

## 3. Firestore synced stores

Registry: `SYNCED_STORES` in `js/sync-engine.js:138-145` (six stores). Each carries a
`snapshotForSync()` adapter. Per-store merge rules: ADR 0004
(`docs/adr/0004-per-store-merge-strategy.md`). All client-side, same code web + native.

| Store | Local source | Merge strategy | Key / dedup fields | Module |
|---|---|---|---|---|
| `meds` | `wellness_meds` via `MedsManager.snapshotForSync()` (`js/sync-engine.js:139`) | Metadata LWW by `updatedAt`; `doseLog` **append-merge** (F1 ±15-min reconcile, F16 skew clamp) | union by med `id`; doseLog by reconcile window | `js/sync-merge-meds.js:174-176` |
| `history` | `History.snapshotForSync()` (`js/sync-engine.js:140`) | Sessions union by id; **record-level** LWW by `updatedAt`; `phaseLog` deduped | session `id`; phaseLog by `(deviceId, phaseStartedAt)` (F6) | `js/sync-merge-history.js:12-15` |
| `rest_log` | `RecoveryUI.snapshotForSync()` (`js/sync-engine.js:141`) | Per-date key; `sleep` LWW; `naps` append-merge | date `YYYY-MM-DD`; naps by `(deviceId, startedAt)` | `js/sync-merge-rest-log.js:7-13` |
| `presets` | `Presets.snapshotForSync()` (`js/sync-engine.js:142`) | Full-record LWW; `deletedAt` tombstone propagation (newer wins) | preset `id` | `js/sync-merge-presets.js:9-21` |
| `bfrb_events` | `BfrbEvents.snapshotForSync()` (`js/sync-engine.js:143`) | Union-dedup; deterministic doc id `deviceId-takenAt` | `(deviceId, takenAt)` | `js/sync-merge-bfrb.js:7,18,32` |
| `distractions` | `Distractions.snapshotForSync()` (`js/sync-engine.js:144`) | Union-dedup within each `(context, sessionId)` pair | `(context, sessionId, deviceId, timestamp)` | `js/sync-merge-distractions.js:7,36,39` |

### Read-only recovery feed (NOT in `SYNCED_STORES`)

| Path | Direction | Local cache | Notes |
|---|---|---|---|
| `users/{uid}/recovery_state/{latest,history}` | **read-only pull** (`js/recovery-feed.js:5-12`) | `tempo_recovery_state_{latest,history}` ([§1g](#1g-recovery-cache-read-only-feed-mirror)) | Written by an external `personal-health-elt` Admin-SDK pipeline. No write path, no `Schema.stamp`, no merge (`js/recovery-feed.js:11-12`). Full contract: [`recovery-state-contract.md`](./recovery-state-contract.md). |

---

## 4. The sync envelope

Every write to a synced-eligible store stamps three fields via `js/schema.js`
(`Schema.stamp` mutates in place, returns the record for inline use):

| Field | Source | Meaning |
|---|---|---|
| `deviceId` | `js/history.js:16-30` (`getDeviceId()`, UUID v4 in `tempo_device_id`) | Stable per-device prefix; half of most dedup signatures. |
| `updatedAt` | wall-clock ms at write site | LWW comparator across all per-store merges. |
| `schemaVersion` | `Schema.SCHEMA_VERSION = 1` (`js/schema.js:30`); set by `Schema.stamp` (`js/schema.js:52-57`) | Forward-compat guard. |

**F19a refuse-writeback rule** (`js/schema.js:38-42`): `isFutureRecord(record)` is true iff
`schemaVersion` is a finite number strictly `> SCHEMA_VERSION`. A future record is loaded
read-only — the writeback path must skip it so the on-disk bytes stay intact for the newer
client. Pre-F19a records (no `schemaVersion`) are **not** future; they get stamped lazily on
next write (`js/schema.js:16-17`). `stamp()` refuses to downgrade a future record
(`js/schema.js:53`). Merge modules apply the F19a skip + the meds path also caps doseLog at
1000 entries (F14, `js/meds.js:239`).

---

## 5. Derived vs. stored

Fields that are **computed at read time**, never persisted:

| Datum | Where | How derived | Why not stored |
|---|---|---|---|
| Med supply remaining | `getSupplyRemaining()` `js/meds.js:299-305` | `supplyStartCount − consumedSinceReset() + supplyAdjustment`, clamped `[0, MAX_SUPPLY=1000]` (`js/meds.js:84,305`). `consumedSinceReset()` counts doses with `takenAt >= supplyResetAt` (`js/meds.js:288-293`). Returns `null` when not tracked — doubles as the "is tracked" flag. | A single dose-log append automatically reflects in the count; no separate counter to keep in sync. |
| `supplyAdjustment` | `js/meds.js:102,212-223` | Solved (not stored as a raw delta the user sees): `adjustSupply(delta)` sets the offset so the *displayed* remaining lands on the new target (`js/meds.js:216-223`). | Keeps the ±1 steppers responsive even when `consumed > startCount`. *(Note: `supplyAdjustment` itself IS persisted in `wellness_meds` — it's the remaining count that's derived.)* |
| Pomodoro `previousPhaseSnapshot` | `js/pomodoro.js:28,164` | Captured `{ phase, cycleIndex, accumulatedMs }` at the top of every `nextPhase()` (`js/pomodoro.js:164`); consumed by `revertPhase()` which folds elapsed time back into the restored phase (`js/pomodoro.js:200-206`). | One-level undo only; cleared on `reset()` (`js/pomodoro.js:115`) and overwritten each transition. Transient in-memory — not in the persisted Pomodoro state shape. |
| Stopwatch elapsed | `getElapsedMs()` `js/stopwatch.js:12-13` | `offsetMs + accumulatedMs + (Date.now() − startedAt)` — pure wall-clock derivation, never a counter incremented by `setInterval`. | Drift-free: on reload a `running` instance self-corrects because elapsed is recomputed from `startedAt` (ADR 0002). |

---

## 6. Additive-nullable fields

Optional fields added without a `SCHEMA_VERSION` bump (absent ⇒ feature off / legacy record):

| Field | On | Status | Anchor |
|---|---|---|---|
| `todoistId` / `localTag` | Pomodoro saved tasks (`pomodoro_saved_tasks`) | **shipped** | `js/pomodoro-ui.js:635-639,654`; stripped from backups in `js/export.js:127-148` |
| `todoistId` / `localTag` | Flow user tasks (`flow_user_tasks`) | **shipped** | `js/flow-ui.js:10,357,693`; same strip path |
| `supplyStartCount` / `supplyResetAt` / `supplyAdjustment` | Medication records (`wellness_meds`) | **shipped** | declared `js/meds.js:47,96-102`; loaded null-safe `js/meds.js:449-456` |
| `deletedAt` | Quick preset records (`quick_presets`) | **shipped** | tombstone set `js/presets.js:86`; filtered on read `js/presets.js:13`; propagated cross-device `js/sync-merge-presets.js:15-21` |
| `bedtime` / `wakeTime` | Sleep entry in `wellness_rest_log` | **planned** (backlog #12 / row 11) — **not in code** (no `bedtime`/`wakeTime` reference in `js/recovery-ui.js` as of 2026-05-30) | n/a — verify before relying on it |

> When `bedtime`/`wakeTime` ship, they are additive nullable on `sleep:{…}`; `wellness_rest_log`
> is already in `SYNCED_STORES` (`rest_log`), so they sync with no registry change.
