// E-2: SyncBuffer — pointer-based offline pending-op queue (IndexedDB).
//
// Persists pending sync pointers across tab close so ops authored during
// offline windows survive a browser restart and drain FIFO on reconnect.
// Buffered writes preserve the original wall-clock timestamp captured at
// user-action time (strategy doc Q3 lock — `docs/CLOUD-SYNC-STRATEGY.md:116`):
// `originalWallClock` is stamped at enqueue; the local record itself was
// already stamped at the engine write site with its own `updatedAt`. The
// merge fns on drain consume `updatedAt` for LWW — `originalWallClock` is
// an audit-trail field this module preserves verbatim.
//
// **Pointer-based, NOT snapshot-based** (Pick A on E-2-PROMPT TODO #1).
// Each entry holds `{ id, store, recordId, originalWallClock, enqueuedAt }`
// — never a copy of the record itself. On drain, the dispatcher reads the
// CURRENT local state for each `(store, recordId)` and routes through the
// per-store merge fn. Edit-then-undo on the same record collapses to one
// pointer + final-state replay (correct LWW semantic).
//
// **Brand-new IDB DB** (`tempo_sync_db` v1) with a single `pending_ops`
// object store, `keyPath: 'id'` autoincrement + index on `enqueuedAt` for
// FIFO ordering. Separate from `stopwatch_history_db` so this module is
// independently revertable (Pick A on TODO #2 / auditor's lean B).
//
// **F-invariant contracts:**
//   - **F10 (envelope stamping):** the buffer NEVER mutates or re-stamps
//     the local record. `deviceId` + `updatedAt` + `schemaVersion` are set
//     inline at the original write site. The buffer entry is a pointer.
//   - **F13 (write gate):** enqueue BYPASSES `SyncState.canWrite()` —
//     offline writes can't be blocked by an active hydrate cycle (local-
//     first contract). Drain routes through the per-store merge fns which
//     are called from `_runMergeCycle` in `js/sync-engine.js`; the
//     dispatcher already gates on `SyncState.canWrite()` per E-1c.
//   - **F19a (refuse-writeback):** drain inherits the three E-1e layers
//     (dispatcher snapshot pre-filter + per-merge-fn cloud-side pre-filter
//     + per-record CAS-level refuseWriteback). E-2 does NOT add a 4th
//     F19a layer at the buffer level.
//
// **Compaction** (Pick A on TODO #3) — only the four per-field-LWW stores
// in `COMPACTABLE_STORES` dedup by `(store, recordId)` to collapse
// repeated chatty edits (history note typing, tag toggling, sleep slider
// flicker, presets edits). The other storeKeys (meds, history,
// rest_log-naps, bfrb_events, distractions, mood_events) are append-only
// with sub-second timestamps — collision is engineering-zero, no compaction.
// `finances` is editable-per-MONTH LWW (not append-only): each YYYY-MM key
// is its own buffer entry keyed by month, so it is NOT compacted here
// (monthly cadence → collision is likewise engineering-zero).
//
// **Cap** (Pick A on TODO #4) — `PENDING_OP_CAP = 1000` immutable per
// release; no localStorage override. On overflow, drop the OLDEST entry
// by `enqueuedAt` index + emit `SyncEngine.emit('buffer-overflow', { droppedCount })`.
//
// **Local-first contract:** the buffer is an opportunistic optimization.
// On any IDB / shim failure, enqueue returns `{ ok: false, kind }` and
// local writes still hit localStorage / IDB normally. The 30s steady-
// state polling cycle picks up pending changes within 30s of reconnect.
//
// **Public surface:**
//   SyncBuffer.enqueue({ store, recordId, originalWallClock? })
//     → Promise<{ ok: true, id } | { ok: false, kind }>
//   SyncBuffer.drain()
//     → Promise<{ ok: true, drained, failed } | { ok: false, kind }>
//   SyncBuffer.count()
//     → Promise<number>
//   SyncBuffer._open()
//     → Promise<IDBDatabase>  (exposed for test hot-swap)
//
// No DOM access; no console.warn at module level. Dispatcher batches
// observability via SyncEngine events.

const SyncBuffer = (() => {

  const DB_NAME = 'tempo_sync_db';
  const DB_VERSION = 1;
  const STORE_NAME = 'pending_ops';
  const INDEX_ENQUEUED_AT = 'enqueuedAt';

  // Immutable per release — no localStorage override per Pick A on TODO #4.
  const PENDING_OP_CAP = 1000;

  // Per-field-LWW stores only (Pick A on TODO #3). Repeated enqueues
  // for the same `(store, recordId)` collapse to a single pointer
  // (latest enqueuedAt wins). The other storeKeys are append-only
  // with sub-second timestamps — no compaction.
  const COMPACTABLE_STORES = [
    'history-note',
    'history-tags',
    'rest_log-sleep',
    'presets',
  ];

  // Cached DB connection. Opens lazily on first enqueue/drain/count.
  let _dbCache = null;

  // ── Feature-detect helpers ───────────────────────────────────────────

  function _flagOn() {
    return typeof SyncFlag !== 'undefined' && SyncFlag.isEnabled();
  }

  function _signedIn() {
    if (typeof SyncAuth === 'undefined' || typeof SyncAuth.getCurrentUser !== 'function') {
      return false;
    }
    const user = SyncAuth.getCurrentUser();
    return !!(user && user.uid);
  }

  function _idbAvailable() {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  }

  // ── IDB connection (lazy, cached) ────────────────────────────────────

  function _open() {
    if (_dbCache) return Promise.resolve(_dbCache);
    if (!_idbAvailable()) {
      return Promise.reject(new Error('indexedDB unavailable'));
    }
    return new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = function (event) {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: 'id',
            autoIncrement: true,
          });
          store.createIndex(INDEX_ENQUEUED_AT, 'enqueuedAt', { unique: false });
        }
      };
      req.onsuccess = function () {
        _dbCache = req.result;
        // Defensive: on version-change from another tab, drop cache so
        // the next call re-opens fresh.
        try {
          _dbCache.onversionchange = function () {
            try { _dbCache.close(); } catch (_) {}
            _dbCache = null;
          };
        } catch (_) {}
        resolve(_dbCache);
      };
      req.onerror = function () {
        reject(req.error || new Error('indexedDB open failed'));
      };
      req.onblocked = function () {
        reject(new Error('indexedDB open blocked'));
      };
    });
  }

  // ── Transaction helpers ──────────────────────────────────────────────

  function _readTxn(db) {
    return db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
  }

  function _writeTxn(db) {
    return db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);
  }

  function _wrapReq(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IDB request failed'));
    });
  }

  // ── Public API ───────────────────────────────────────────────────────

  // Enqueue a pointer to a dirty local record. Idempotent for compactable
  // stores (collapses repeated enqueues for same `(store, recordId)` to
  // one entry — latest enqueuedAt wins).
  //
  // Bypasses `SyncState.canWrite()` (F13) — offline writes must not be
  // blocked by an active hydrate cycle.
  async function enqueue(opts) {
    if (!_flagOn()) return { ok: false, kind: 'sync-disabled' };
    if (!_signedIn()) return { ok: false, kind: 'unauthenticated' };
    if (!opts || typeof opts.store !== 'string' || typeof opts.recordId !== 'string') {
      return { ok: false, kind: 'invalid-args' };
    }

    let db;
    try {
      db = await _open();
    } catch (err) {
      return { ok: false, kind: 'idb-unavailable', error: err };
    }

    const now = Date.now();
    const entry = {
      store: opts.store,
      recordId: opts.recordId,
      originalWallClock: (typeof opts.originalWallClock === 'number')
        ? opts.originalWallClock
        : now,
      enqueuedAt: now,
    };
    const compactable = COMPACTABLE_STORES.indexOf(entry.store) !== -1;

    // Compaction + add + count + cap-eviction all run inside ONE
    // readwrite transaction (R1). The prior implementation spanned three
    // transactions with `await` boundaries between them, which let
    // (a) concurrent enqueues race the count→evict step and over/under-
    // evict, and (b) the compaction `await` risk the add-transaction
    // auto-committing before `store.add`. Every step here is chained
    // through request callbacks so the transaction is never idle between
    // operations — it stays continuously active and the whole sequence
    // is atomic. The count sees the txn's own uncommitted add (read-your-
    // writes), matching the old "fresh count after commit" result.
    try {
      const { newId, droppedCount } = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const idx = store.index(INDEX_ENQUEUED_AT);

        let newId = null;
        let droppedCount = 0;

        // Step 3 — cap enforcement. Count within the txn, then if over
        // cap evict the OLDEST entries by the enqueuedAt (FIFO) index.
        function countAndEvict() {
          const countReq = store.count();
          countReq.onsuccess = function () {
            const toDrop = countReq.result - PENDING_OP_CAP;
            if (toDrop <= 0) return; // under cap — let the txn commit
            const evictReq = idx.openCursor();
            evictReq.onsuccess = function (event) {
              const cur = event.target.result;
              if (!cur || droppedCount >= toDrop) return;
              cur.delete();
              droppedCount++;
              cur.continue();
            };
            evictReq.onerror = () => reject(evictReq.error || new Error('eviction cursor failed'));
          };
          countReq.onerror = () => reject(countReq.error || new Error('count failed'));
        }

        // Step 2 — insert the new pointer, then enforce the cap.
        function add() {
          const addReq = store.add(entry);
          addReq.onsuccess = function () {
            newId = addReq.result;
            countAndEvict();
          };
          addReq.onerror = () => reject(addReq.error || new Error('add failed'));
        }

        // Step 1 (COMPACTABLE_STORES only) — delete any prior entry with
        // the same `(store, recordId)` via the FIFO index cursor, then add.
        if (compactable) {
          const cursorReq = idx.openCursor();
          cursorReq.onsuccess = function (event) {
            const cur = event.target.result;
            if (!cur) { add(); return; }
            const val = cur.value;
            if (val && val.store === entry.store && val.recordId === entry.recordId) {
              cur.delete();
            }
            cur.continue();
          };
          cursorReq.onerror = () => reject(cursorReq.error || new Error('compaction cursor failed'));
        } else {
          add();
        }

        tx.oncomplete = () => resolve({ newId, droppedCount });
        tx.onerror = () => reject(tx.error || new Error('enqueue txn failed'));
        tx.onabort = () => reject(tx.error || new Error('enqueue txn aborted'));
      });

      // Emit AFTER the txn commits so observers see a durable drop.
      if (droppedCount > 0) {
        try {
          if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.emit === 'function') {
            SyncEngine.emit('buffer-overflow', { droppedCount });
          }
        } catch (_) {}
      }

      return { ok: true, id: newId };
    } catch (err) {
      return { ok: false, kind: 'enqueue-failed', error: err };
    }
  }

  // Drain pending pointers FIFO. For each pointer, look up the
  // corresponding per-store merge fn and invoke it. The merge fn reads
  // CURRENT local state for the dirty record + routes through the
  // per-record CAS gates already established in E-1c/d/e (F13 + F19a).
  //
  // Per-record try/catch: errors from the merge fn don't short-circuit
  // the loop. Failed entries stay in the queue for the next drain.
  //
  // Drain is grouped by store — for each unique store key in the
  // queue, we call the merge fn ONCE (the per-store merge fns are
  // self-contained, reading their full local state internally). The
  // pointer is a "go look at this store" signal, not a per-record
  // operation against cloud.
  async function drain() {
    if (!_flagOn()) return { ok: false, kind: 'sync-disabled' };
    if (!_signedIn()) return { ok: false, kind: 'unauthenticated' };

    let db;
    try {
      db = await _open();
    } catch (err) {
      return { ok: false, kind: 'idb-unavailable', error: err };
    }

    // Read all entries in FIFO order via the enqueuedAt index.
    let entries;
    try {
      entries = await new Promise((resolve, reject) => {
        const store = _readTxn(db);
        const idx = store.index(INDEX_ENQUEUED_AT);
        const result = [];
        const cursorReq = idx.openCursor();
        cursorReq.onsuccess = function (event) {
          const cur = event.target.result;
          if (!cur) { resolve(result); return; }
          result.push(cur.value);
          cur.continue();
        };
        cursorReq.onerror = () => reject(cursorReq.error || new Error('drain cursor failed'));
      });
    } catch (err) {
      return { ok: false, kind: 'drain-read-failed', error: err };
    }

    if (entries.length === 0) {
      return { ok: true, drained: 0, failed: 0 };
    }

    // Group pointers by store key (preserving first-seen FIFO order
    // for the deterministic per-store dispatch order — matches
    // SYNCED_STORES canonical order when present).
    const orderedStores = [];
    const idsByStore = {};
    for (const e of entries) {
      if (!e || typeof e.store !== 'string') continue;
      const storeKey = _resolveStoreKey(e.store);
      if (!storeKey) continue;
      if (!idsByStore[storeKey]) {
        idsByStore[storeKey] = [];
        orderedStores.push(storeKey);
      }
      idsByStore[storeKey].push(e.id);
    }

    let drained = 0;
    let failed = 0;

    for (const storeKey of orderedStores) {
      const mergeFn = _mergeFnFor(storeKey);
      if (!mergeFn) {
        // Module missing — leave entries in queue for next drain.
        failed += idsByStore[storeKey].length;
        continue;
      }
      let mergeOk = false;
      try {
        const result = await Promise.resolve(mergeFn(null));
        // Treat any result that isn't `{ ok: false }` with a hard kind
        // as a successful drain pass — the per-store merge fns return
        // `{ ok: true, count, skipped, warnings }` on success and
        // `{ ok: false, kind }` on guard failures.
        if (!result || result.ok !== false) {
          mergeOk = true;
        }
      } catch (err) {
        // Swallow — convergence retries next drain. Log via
        // SyncEngine.emit so observers see a uniform error shape.
        try {
          if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.emit === 'function') {
            SyncEngine.emit('merge-error', { store: storeKey, error: err });
          }
        } catch (_) {}
      }
      if (mergeOk) {
        // Delete the entries that this store's merge fn processed.
        try {
          const writeStore = _writeTxn(db);
          for (const id of idsByStore[storeKey]) {
            try { writeStore.delete(id); } catch (_) {}
          }
          // No await — fire and forget; the transaction auto-commits.
          drained += idsByStore[storeKey].length;
        } catch (_) {
          failed += idsByStore[storeKey].length;
        }
      } else {
        failed += idsByStore[storeKey].length;
      }
    }

    return { ok: true, drained, failed };
  }

  // Return the per-store merge fn matching a buffer-entry store key.
  // The buffer uses compound keys (`history-note`, `rest_log-sleep`,
  // etc.) so it can compact per-field-LWW writes; drain collapses
  // those back to the canonical store key for merge-fn lookup.
  function _resolveStoreKey(bufferStoreKey) {
    if (bufferStoreKey === 'history-note' || bufferStoreKey === 'history-tags') return 'history';
    if (bufferStoreKey === 'rest_log-sleep' || bufferStoreKey === 'rest_log-naps') return 'rest_log';
    return bufferStoreKey;
  }

  function _mergeFnFor(storeKey) {
    if (storeKey === 'meds' && typeof SyncMergeMeds !== 'undefined' && SyncMergeMeds.merge) {
      return SyncMergeMeds.merge;
    }
    if (storeKey === 'history' && typeof SyncMergeHistory !== 'undefined' && SyncMergeHistory.merge) {
      return SyncMergeHistory.merge;
    }
    if (storeKey === 'rest_log' && typeof SyncMergeRestLog !== 'undefined' && SyncMergeRestLog.merge) {
      return SyncMergeRestLog.merge;
    }
    if (storeKey === 'presets' && typeof SyncMergePresets !== 'undefined' && SyncMergePresets.merge) {
      return SyncMergePresets.merge;
    }
    if (storeKey === 'bfrb_events' && typeof SyncMergeBfrb !== 'undefined' && SyncMergeBfrb.merge) {
      return SyncMergeBfrb.merge;
    }
    if (storeKey === 'distractions' && typeof SyncMergeDistractions !== 'undefined' && SyncMergeDistractions.merge) {
      return SyncMergeDistractions.merge;
    }
    if (storeKey === 'mood_events' && typeof SyncMergeMood !== 'undefined' && SyncMergeMood.merge) {
      return SyncMergeMood.merge;
    }
    if (storeKey === 'finances' && typeof SyncMergeFinances !== 'undefined' && SyncMergeFinances.merge) {
      return SyncMergeFinances.merge;
    }
    return null;
  }

  // Count of pending pointers. Returns 0 if IDB is unavailable rather
  // than rejecting — the caller (observability surfaces, future E-3
  // sync-status badge) should never break on a buffer-open failure.
  async function count() {
    let db;
    try {
      db = await _open();
    } catch (_) {
      return 0;
    }
    try {
      return await _wrapReq(_readTxn(db).count());
    } catch (_) {
      return 0;
    }
  }

  return {
    enqueue,
    drain,
    count,
    _open,
    _COMPACTABLE_STORES: COMPACTABLE_STORES,
    _PENDING_OP_CAP: PENDING_OP_CAP,
  };
})();

if (typeof window !== 'undefined') {
  window.SyncBuffer = SyncBuffer;
}
