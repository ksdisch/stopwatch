# Local-First Data Model

## Purpose
This page answers "where does every piece of data live, how does it move between devices, and why is the model shaped the way it is?" No single existing document covers all three layers together: the storage split, the sync envelope rules, and the per-store conflict resolution choices. The data dictionary enumerates every key; the architecture doc draws the topology; ADR 0004 explains the merge strategy. This page synthesizes those into the durable mental model a developer needs before touching any synced store.

## Key understanding

### Three storage tiers, three distinct lifecycles

**Fact** (`docs/ARCHITECTURE.md` § Persistence topology, ADR 0006): engine state and configs live in `localStorage`; canonical session history lives in `IndexedDB stopwatch_history_db`; the transient offline write-buffer lives in a separate `IndexedDB tempo_sync_db`. A fourth IDB, `tempo_notify_db`, holds the R9 durable web-notification queue (web-only, never synced/exported). These are kept separate deliberately — the sync buffer can be wiped without touching history; the notification queue is self-contained and SW-safe.

**Fact** (`docs/reference/data-dictionary.md` §2): `pending_ops` entries are pointer-shaped — they hold a record ID, not a record copy — so a drain replays from the current local state, not a snapshot.

### The 8 synced stores and why each uses its merge strategy

**Fact** (`js/sync-engine.js:138-156`, `docs/reference/data-dictionary.md` §3): The `SYNCED_STORES` registry defines 8 stores. Each has a bespoke merge module because no single policy is correct for all:

| Store | Local key | Merge strategy | Why |
|---|---|---|---|
| `meds` | `wellness_meds` | Metadata LWW + `doseLog` append-merge (F1 ±15-min reconcile, F16 clock-skew clamp) | A medication record is both an editable config and an append-only event log; LWW on the whole record would silently discard doses |
| `history` | `stopwatch_history_db`/`sessions` | Union by session `id`, record-level LWW, `phaseLog` append-dedup (F6) | Session events are append-only; a note/tag edit on one device is editable; phaseLog is its own stream |
| `rest_log` | `wellness_rest_log` | Per-date key; `sleep` LWW; `naps` append-merge | A sleep entry is editable (correction); naps are events and must union |
| `presets` | `quick_presets` | Full-record LWW + `deletedAt` tombstone propagation | Presets are edited atomically; deletes must propagate across devices |
| `bfrb_events` | `bfrb_events` | Union-dedup by `(deviceId, takenAt)`; deterministic doc id | Pure event log; order of arrival is irrelevant; no field is editable |
| `distractions` | `flow_distractions` + `pomodoro_distractions` | Union-dedup by `(context, sessionId, deviceId, timestamp)` | Two localStorage keys collapse into one Firestore store; both are event logs |
| `mood_events` | `mood_events` | Union-dedup by `(deviceId, at)` — clone of bfrb merge; no F15 toast | Immutable mood log; same shape as BFRB events |
| `finances` | `finances` | Per-month key; whole-record LWW (latest `updatedAt` per `YYYY-MM` wins) | A month's finance numbers are corrected, not appended; last edit wins per month |

**Decision** (ADR 0004): global LWW was explicitly rejected because it silently destroys `doseLog` entries on the slower device. CRDTs were rejected (no-build PWA, one real user, append-merge-with-dedup is sufficient). Server-side merge was rejected (no backend).

### The sync envelope — every synced write stamps three fields

**Fact** (`js/schema.js:30,52-57`, `docs/reference/data-dictionary.md` §4): `Schema.stamp(record)` mutates every synced write with:
- `deviceId` — stable per-device UUID v4 (generated once, stored in `tempo_device_id`); used as the dedup signature prefix for event streams
- `updatedAt` — wall-clock ms at write time; the LWW comparator
- `schemaVersion = 1` — the forward-compat guard

**Fact** (`js/schema.js:38-42`): The **F19a refuse-writeback rule**: `isFutureRecord(r)` is true iff `r.schemaVersion` is a finite number strictly `> SCHEMA_VERSION`. A downlevel client must not write back a future record — it would strip unrecognized fields. `stamp()` refuses to downgrade (`js/schema.js:53`). The guard runs at three layers: cloud-side pre-filter in each merge module; the CAS `refuseWriteback` call inside `runTransaction`; and a local-side filter on JSON import.

### What is deliberately NOT synced — and why

**Fact** (`docs/reference/data-dictionary.md` §1d, `CLAUDE.md` § Persistence topology):
- `todoist_api_token` and all `todoist_*` keys — device-local credential; no backend to hold an OAuth secret (ADR 0008)
- `flow_user_tasks`, `pomodoro_saved_tasks` — Todoist itself is the cross-device source of truth; these are local caches with linkage stripped from exports
- `tempo_recovery_state_*` — read-only pull cache of the external `personal-health-elt` feed; not Tempo-owned data
- `live_activities_enabled` — per-device iOS preference
- Engine state (`multi_state`, `pomodoro_state`, `flow_state`, …) — local-only; primary-instance pointers must never sync (F5: a mid-render swap would reassign the `Stopwatch` global underfoot)

### The read-only recovery feed is not in SYNCED_STORES

**Fact** (`js/recovery-feed.js:5-12`, `firestore.rules:21-33`, `docs/reference/data-dictionary.md` §3 Read-only section): `recovery_state` is written by the `personal-health-elt` pipeline via Admin SDK (bypasses Firestore rules); the client has no write path, no `Schema.stamp`, no merge. The security rule enforces `write: if false` for all clients — a compromised client cannot poison its own feed. Tempo caches the latest and 14-day history docs in `localStorage` for offline rendering.

### Derived fields — never stored, always recomputed

**Fact** (`docs/reference/data-dictionary.md` §5):
- **Med supply remaining**: `supplyStartCount − consumedSinceReset() + supplyAdjustment`, clamped `[0, 1000]`. A dose-log append automatically reflects; no separate counter to keep in sync.
- **`lastTakenAt`** (F4): re-derived after every merge from the merged `doseLog`; never synced.
- **Stopwatch elapsed**: `offsetMs + accumulatedMs + (Date.now() − startedAt)` — wall-clock derivation; never a counter (ADR 0002).
- **Pomodoro `previousPhaseSnapshot`**: in-memory, transient; cleared on `reset()`.

### The SyncEngine lifecycle

**Fact** (`docs/ARCHITECTURE.md` § Cloud sync architecture, `js/sync-engine.js:85-174`): `init()` → auth-change → if fresh device: `hydrateFromCloud()` (pull order: `rest_log → meds → presets → history`, per-store markers set) → `startSteadyState()` (web `onSnapshot` + 300s defensive poll). Offline writes enqueue as pointer-ops in `tempo_sync_db`; drained FIFO on `Platform.network` online event. A pre-existing-cloud-data collision routes to Stage-D `reconcileImportedBucket()` (F17: separate "imported" bucket rather than per-collision prompts). **CAS (`runTransaction`) is web-only** — native degrades to 5-min poll + plain `setDoc`; the append-merge correctness still holds, the atomicity guarantee does not (ADR 0009).

### Adding a new synced store — what this means in practice

**Inference** (from ADR 0004 consequences + `CLAUDE.md` § Definition of done): every new synced store requires: a `SYNCED_STORES` entry in `js/sync-engine.js`, a bespoke merge module with the F19a guard at three layers, a `snapshotForSync()` adapter on the data module, a persisted-key entry in `docs/reference/data-dictionary.md`, and `Schema.stamp()` at every write site. There is no shared merge engine — the skeleton must be applied from scratch.

## Sources
- [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) — persistence topology diagram, sync lifecycle state machine, the IDB split rationale
- [`docs/reference/data-dictionary.md`](../docs/reference/data-dictionary.md) — every key, shape, synced/export flags, the sync envelope, derived fields
- [`docs/adr/0004-per-store-merge-strategy.md`](../docs/adr/0004-per-store-merge-strategy.md) — the full per-store merge decision with rejected alternatives
- [`docs/adr/0006-split-localstorage-indexeddb-persistence.md`](../docs/adr/0006-split-localstorage-indexeddb-persistence.md) — why three IDB databases
- [`docs/reference/glossary.md`](../docs/reference/glossary.md) — F-invariants, LWW/append-merge/CAS/Stage-D/F19a definitions
- `js/schema.js` — `Schema.stamp`, `isFutureRecord`, `SCHEMA_VERSION`
- `js/sync-engine.js:138-156` — `SYNCED_STORES` registry (8 entries as of Phase 5)

## Uncertainties & contradictions
- **Unresolved:** `docs/ARCHITECTURE.md` (written 2026-05-30) still shows the original 6-store `SYNCED_STORES` snippet; the actual registry has 8 stores as of Phase 5 (mood_events, finances added). The code is authoritative.
- **Unresolved:** ADR 0004 references `docs/adr/0006` as "planned" — it has since been documented; the "planned" flag in the data dictionary header is stale.
- **Unresolved:** native CAS parity is permanently blocked by the `@capacitor-firebase/firestore` plugin through v8.3.0 (see `CLAUDE.md` backlog row 3). The F19a guard at the CAS layer is therefore web-only; iOS relies on the 5-min poll + plain `setDoc` fallback.

## Related pages
- [lifeos-status](lifeos-status.md) — reconciles plan docs vs. what has actually shipped (including the Phase 5 finances store)
- [History](History.md) — the sync build era (2026-05-03 – 2026-05-17) and the H4 audit (2026-06-14) that found sync never wrote remote arrivals to local for 5 of 7 stores

## Relevance to current work
Any session adding a new Life-OS pillar (P4 Growth/Career federation, P6 unit lifecycle, P7 feedback loop) that introduces a new synced store must follow the 8-step pattern described here. The finances store (P5) is the most recent addition and serves as the reference template. The F19a guard is mandatory boilerplate at three layers — omitting it silently reopens a downlevel-corruption hole.

_Last reviewed: 2026-07-26_
