# ADR 0006: Split localStorage / IndexedDB persistence topology — and two separate IndexedDB databases

- **Status:** Accepted (retro-documented 2026-05-30)
- **Date:** History → IndexedDB migration landed April 2026 (`docs/TEMPO-PLAN.md:446` dates it 2026-04-10; the `stopwatch_history_db` store predates that note). The second IndexedDB database (`tempo_sync_db`) landed with the E-2 offline buffer during Phase 9 cloud-sync (`js/sync-buffer.js:1` "E-2: SyncBuffer"). The localStorage-for-config split is foundational and predates the first committed history.
- **Deciders:** ksdisch
- **Tags:** persistence, storage, local-first, sync

## Context

Tempo is a no-build vanilla-JS PWA (ADR 0001) that is local-first: every engine writes to device storage and is correct from local state alone, with cloud sync (ADR 0003) layered on top. The same JS runs on web (GitHub Pages) and inside the Capacitor iOS WKWebView, so the storage primitives have to be the ones the browser ships — there is no native DB and no room for a heavyweight storage library that would violate the no-build mandate.

The data this app persists is not uniform. It splits into three populations with materially different shapes and lifecycles:

1. **Small, bounded config + engine state** — ~50 keys: `app_mode`, `theme`, `sound_muted`, `vibrate_interval`, the multi-instance stopwatch/timer snapshot (`multi_state`), Pomodoro/Flow/Interval/Cooking state and config, presets, Todoist device-local tokens, sync flags, hydrate markers. Each is a few bytes to a few kilobytes, read on the hot path (the render loop reads display/theme flags; the button state machine reads `app_mode`), and most are written on every user gesture. The total is small and does not grow without bound — it is *configuration*, not a *log*.

2. **Unbounded canonical session history** — every completed stopwatch / timer / pomodoro / flow / interval / cooking session, plus mutable `note` / `tags` per row (`docs/CLOUD-SYNC-STRATEGY.md:10`). This grows for the life of the install, is the user's real data, is queried with filters and aggregations (Analytics, Rhythm), and is one of the six Firestore-synced stores — so it carries the `deviceId` / `updatedAt` / `schemaVersion` envelope (ADR 0004) and must survive schema evolution byte-clean.

3. **A transient offline write buffer** — the E-2 sync infrastructure: pointers to dirty synced records, captured at user-action time while offline, replayed FIFO on reconnect. Each entry is a pointer (`{ store, recordId, originalWallClock, enqueuedAt }`), never a copy of the record (`js/sync-buffer.js:13`, `:195-202`). The buffer fills during an offline window and **empties on drain** — its steady state is zero entries. It is sync plumbing, not user data; on any failure it is safe to discard entirely (`js/sync-buffer.js:49-52`).

The storage primitives have opposite cost profiles. `localStorage` is synchronous, string-only, and quota-limited (~5 MB) — fine for tiny config reads on the render hot path, wrong for an unbounded growing log (quota exhaustion plus main-thread serialization jank on every write). `IndexedDB` is asynchronous, large-capacity, and indexed — right for the history log and the buffer, but ceremony-heavy (`open` → `onupgradeneeded` → transaction → request) for a 12-byte theme flag the render loop wants synchronously.

Populations (2) and (3) both want IndexedDB, but they have *orthogonal lifecycles*: history is permanent and append-mostly; the buffer drains-and-empties. They have different failure semantics (losing history is data loss; losing the buffer is a no-op — the steady-state poll re-converges, `js/sync-buffer.js:49-52`), and different versioning futures (a history schema migration must not put the buffer at risk, and vice versa).

## Decision

We deliberately split persistence by data shape, and we run **two distinct IndexedDB databases** rather than one DB with two object stores.

**Tier 1 — config + engine state in `localStorage` (~50 keys).** The multi-instance stopwatch/timer snapshot serializes to one JSON string under `multi_state` (`js/instance-manager.js:3`, written at `js/instance-manager.js:86`, read at `:94`). `Persistence.save()` / `load()` are thin delegations to `InstanceManager.saveAll()` / `loadAll()` (`js/persistence.js:50-56`). Pomodoro / Flow / Interval / Cooking each own their own keys, enumerated in `Persistence.clear()` (`js/persistence.js:59-77`). Synchronous reads keep the render loop and button state machine cheap; the whole tier is small enough to never threaten quota.

**Tier 2 — canonical session history in IndexedDB db `stopwatch_history_db` / store `sessions`.** `js/history.js:2-4` declares `DB_NAME = 'stopwatch_history_db'`, `STORE_NAME = 'sessions'`, `DB_VERSION = 1`; `open()` creates the object store with `keyPath: 'id'` on `onupgradeneeded` (`js/history.js:51-59`). On `init()` the module runs a one-time migration that drains the legacy `localStorage['stopwatch_history']` array into the `sessions` store and removes the legacy key on success (`js/history.js:5`, `:68-94`, sequenced in `init()` at `:170-181`) — this is the historical move of population (2) *out* of localStorage once it outgrew the tier. History is read via `getSessions()` (`js/history.js:193-201`) and exposes the sync adapter `snapshotForSync()` (`js/history.js:389-398`).

**Tier 3 — the offline buffer in a SEPARATE IndexedDB db `tempo_sync_db` v1 / store `pending_ops`.** `js/sync-buffer.js:69-72` declares `DB_NAME = 'tempo_sync_db'`, `DB_VERSION = 1`, `STORE_NAME = 'pending_ops'`, plus an `enqueuedAt` index name. `_open()`'s `onupgradeneeded` creates the store with `keyPath: 'id'`, `autoIncrement: true`, and a non-unique index on `enqueuedAt` for FIFO ordering (`js/sync-buffer.js:124-132`). Entries are pointer-shaped (`js/sync-buffer.js:195-202`), capped at `PENDING_OP_CAP = 1000` immutable per release (`js/sync-buffer.js:75`) — on overflow the oldest entry by `enqueuedAt` is evicted and a `buffer-overflow` event emitted (`js/sync-buffer.js:237-259`). `drain()` walks the `enqueuedAt` index FIFO and routes each store's pointers through the per-store merge fns (`js/sync-buffer.js:280-378`), and is invoked from the `Platform.network` online handler in the sync engine (`js/sync-engine.js:2529-2535`, inside the network `onChange` listener at `:2491-2538`).

The module header states the separation rationale outright: a "Brand-new IDB DB (`tempo_sync_db` v1) ... Separate from `stopwatch_history_db` so this module is independently revertable" (`js/sync-buffer.js:19-22`). `CLAUDE.md` records the same: *"Two distinct IDB DBs by design — sessions and pending-ops have orthogonal lifecycles (history is canonical user data, the buffer is transient sync infrastructure)."*

## Consequences

### Positive

- **Hot-path config stays synchronous and cheap.** Theme / sound / `app_mode` / display flags are plain `localStorage.getItem` reads with no transaction ceremony, so the RAF render loop and the button state machine never await IndexedDB for a 12-byte flag.
- **History scales without touching quota.** The unbounded session log lives in IndexedDB, so it never competes with config for the ~5 MB `localStorage` budget and never serializes a growing array on the main thread per write. The April-2026 migration (`js/history.js:68-94`) is the moment this benefit was realized — it moved population (2) out of localStorage once it outgrew the tier.
- **The two IndexedDB databases version and fail independently.** A future `stopwatch_history_db` `DB_VERSION` bump and `onupgradeneeded` migration cannot brick or block the buffer, and a buffer schema change cannot risk canonical history — each owns its own `open()` / version / upgrade path (`js/history.js:51-66` vs `js/sync-buffer.js:111-153`). The buffer is "independently revertable" (`js/sync-buffer.js:19-22`): deleting `tempo_sync_db` wholesale is harmless.
- **Failure semantics match the data's value.** Buffer failures fail-open and return `{ ok: false, kind }` without disturbing the canonical write (`js/sync-buffer.js:49-52`); the steady-state poll re-converges. History/config failures are caught and degrade gracefully (`js/instance-manager.js:87-89`, `js/history.js` request `onerror` rejections) but are treated as real data paths.
- **Each store's keyPath fits its identity.** `sessions` keys on the stamped, collision-resistant session `id` (`js/history.js:32-34`, keyPath at `:57`); `pending_ops` uses an `autoIncrement` surrogate `id` because a pointer has no natural key and FIFO order comes from the `enqueuedAt` index instead (`js/sync-buffer.js:127-131`).

### Negative / tradeoffs

- **Two IndexedDB databases to reason about, plus localStorage.** A developer must know which of three datastores a given key lives in; there is no single storage abstraction (see Alternatives). The split is documented in `CLAUDE.md` and the planned data dictionary, but it is tribal knowledge until read.
- **No transactional consistency across tiers.** A session write (IndexedDB) and its sync-pointer enqueue (a different IndexedDB DB) are not atomic with each other or with any `localStorage` flag. This is acceptable only because the buffer is opportunistic — a lost pointer is re-derived by the steady-state poll (`js/sync-buffer.js:49-52`; the engine's live default interval is 5 min, `js/sync-engine.js:99`) — but it means there is no "commit both or neither" guarantee, by design.
- **localStorage's ~5 MB ceiling still bounds Tier 1.** The ~50 config keys are individually small, but `multi_state` serializes the full multi-instance state as one string (`js/instance-manager.js:78-90`); if engine state ever grew large (e.g. very long lap arrays across five instances) the synchronous-write/quota concern would resurface and push that population toward IndexedDB the way history already moved.
- **Duplicated IndexedDB plumbing.** `open()` / `onupgradeneeded` / request-wrapping is hand-rolled in both `js/history.js:51-66` and `js/sync-buffer.js:111-170` rather than shared — the no-build, no-library constraint (ADR 0001) means there is no common IDB helper, so the two databases each carry their own boilerplate.

## Alternatives considered

- **One IndexedDB database with two object stores (`sessions` + `pending_ops`).** Rejected: it couples the versioning and migration of two orthogonal lifecycles onto a single `DB_VERSION` / `onupgradeneeded` path. A history-schema migration would then run inside the same upgrade transaction that owns the buffer (and vice versa), so a bug in one risks the other. The buffer's own header calls out independent revertability as the reason it is a separate DB (`js/sync-buffer.js:19-22`).
- **Everything in `localStorage`.** Rejected: the session log grows without bound and would exhaust the ~5 MB quota, and every append would synchronously re-serialize a growing array on the main thread. The April-2026 migration of history *out* of `localStorage['stopwatch_history']` and into IndexedDB (`js/history.js:68-94`) is the concrete reversal of this approach.
- **Everything in IndexedDB.** Rejected: it imposes async transaction ceremony (`open` → transaction → request) on tiny hot-path config reads (theme, sound, `app_mode`) that the synchronous render loop wants without awaiting. The cost/benefit inverts for a 12-byte flag.
- **A single storage abstraction layer over both primitives (or a third-party storage library).** Rejected per ADR 0001 — a no-build vanilla-JS PWA with one real user does not justify a wrapper library's bundle weight or a bespoke abstraction's maintenance surface; the explicit three-way split, documented in `CLAUDE.md`, is cheaper to hold in the head than a leaky uniform API over storage engines with genuinely different cost profiles.

## References

**Tier 1 — localStorage config / engine state**
- `js/persistence.js:50-56` (`Persistence.save/load` delegate to `InstanceManager.saveAll/loadAll`), `:59-77` (`clear()` enumerates the engine-state keys)
- `js/instance-manager.js:3` (`STORAGE_KEY = 'multi_state'`), `:78-90` (`saveAll` → `localStorage.setItem`), `:92-105` (`loadAll`), `:133-151` (legacy `stopwatch_state` / `timer_state` migration)

**Tier 2 — `stopwatch_history_db` / `sessions` (canonical, unbounded)**
- `js/history.js:2-4` (`DB_NAME = 'stopwatch_history_db'`, `STORE_NAME = 'sessions'`, `DB_VERSION = 1`), `:51-66` (`open()` + `onupgradeneeded` createObjectStore `keyPath:'id'`)
- `js/history.js:5` (`LEGACY_KEY = 'stopwatch_history'`), `:68-94` (legacy localStorage → IDB migration), `:170-181` (`init()` ordering), `:193-201` (`getSessions`), `:389-398` (`snapshotForSync`)

**Tier 3 — `tempo_sync_db` v1 / `pending_ops` (transient buffer)**
- `js/sync-buffer.js:1` (module banner "E-2: SyncBuffer"), `:19-22` (separate-DB rationale), `:49-52` (opportunistic / fail-open), `:13` + `:195-202` (pointer-shaped entry)
- `js/sync-buffer.js:69-72` (`DB_NAME = 'tempo_sync_db'`, `DB_VERSION = 1`, `STORE_NAME = 'pending_ops'`, `enqueuedAt` index), `:75` (`PENDING_OP_CAP = 1000`), `:111-153` (`_open()` + `onupgradeneeded` `keyPath:'id'` autoIncrement + index), `:237-259` (cap eviction drops oldest by `enqueuedAt`), `:280-378` (`drain()` FIFO via `enqueuedAt` index)
- `js/sync-engine.js:2491-2538` (`Platform.network.onChange` steady-state listener), `:2529-2535` (`SyncBuffer.drain()` on `online`)

**Shared**
- `js/persistence.js:7-47` (`SyncState` write gate consulted before synced writes), `js/schema.js:30` / `:38-42` / `:52-57` (the envelope Tier 2/3 records carry — see ADR 0004)
- Related ADRs: [0001](0001-no-build-script-load-order.md) (no-build / no storage library), [0003](0003-firestore-sync-backend.md) (the cloud the buffer drains toward), [0004](0004-per-store-merge-strategy.md) (the synced-store envelope + merge fns the buffer pointers route through)
- Related docs: `docs/CLOUD-SYNC-STRATEGY.md:10` (history store contents), `CLAUDE.md` State Model / Datastores ("two distinct IDB DBs by design"), and the planned `docs/reference/data-dictionary.md` (`docs/artifacts-plan.md:126`, `:198`) — the authoritative per-key inventory this ADR's three tiers index into
- Historical context: `docs/TEMPO-PLAN.md:446` (dates the history → IndexedDB migration 2026-04-10)
