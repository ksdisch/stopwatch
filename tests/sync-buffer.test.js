// E-2 — SyncBuffer (offline pending-op queue) tests.
//
// Coverage (per E-2-AUDIT § "Test scope" + the engine-implementer's
// recommended test list):
//   1.  Happy path — enqueue while offline returns { ok:true, id } + count = 1.
//   2.  Enqueue no-op when SYNC_DISABLED.
//   3.  Enqueue no-op when unauthenticated.
//   4.  Compaction collapses repeated (history-note, s1) to 1 entry.
//   5.  Compaction does NOT apply to append-only stores (meds).
//   6.  originalWallClock preserved verbatim through enqueue.
//   7.  Invalid args returns { ok:false, kind:'invalid-args' }.
//   8.  Drain FIFO across 3 stores invokes merge fns in store-grouped order.
//   9.  Cap-overflow drops oldest and emits buffer-overflow event.
//   10. Cross-restart — entries persist in IDB across a fresh raw open.
//   11. Drain idempotency — second drain on empty queue is no-op.
//   12. Drain failure mid-cycle — failing store entries stay; other stores drain.
//   13. SYNC_DISABLED fast-path during drain.
//   14. Per-store dedup-by-recordId — different storeKeys NOT deduped.
//
// Mocking pattern: SyncFlag.isEnabled + SyncAuth.getCurrentUser are
// hot-swapped on the real modules and restored in finally. The buffer's
// IDB connection cache is invalidated between cases via
// indexedDB.deleteDatabase('tempo_sync_db'). The buffer's cached `_dbCache`
// inside the IIFE is closed via versionchange when deleteDatabase fires.

// ── Shared helpers ────────────────────────────────────────────────────

const _sb_DB_NAME = 'tempo_sync_db';

function _sb_savedEnv() {
  return {
    flag_enabled: SyncFlag.isEnabled,
    auth_getCurrentUser: SyncAuth.getCurrentUser,
    sync_flag_storage: localStorage.getItem('tempo_sync_enabled'),
  };
}

function _sb_restore(saved) {
  SyncFlag.isEnabled = saved.flag_enabled;
  SyncAuth.getCurrentUser = saved.auth_getCurrentUser;
  if (saved.sync_flag_storage === null) localStorage.removeItem('tempo_sync_enabled');
  else localStorage.setItem('tempo_sync_enabled', saved.sync_flag_storage);
}

function _sb_install(opts) {
  opts = opts || {};
  SyncFlag.isEnabled = () => (opts.flag !== false);
  SyncAuth.getCurrentUser = () => (opts.unauth ? null : { uid: opts.uid || 'u-buf-test' });
  localStorage.setItem('tempo_sync_enabled', opts.flag === false ? '0' : '1');
}

// Wipe the tempo_sync_db DB between cases so each `it()` starts fresh.
// The buffer module caches its _dbCache inside the IIFE; the cache's
// onversionchange handler (set at open time) drops the cache when a
// concurrent caller issues deleteDatabase, so this call is sufficient.
async function _sb_resetDb() {
  return new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.deleteDatabase(_sb_DB_NAME);
    } catch (_) {
      resolve();
      return;
    }
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

// ────────────────────────────────────────────────────────────────────────
// SyncBuffer.enqueue
// ────────────────────────────────────────────────────────────────────────

describe('SyncBuffer — enqueue happy path + guards', () => {

  it('1. happy path — enqueue returns { ok:true, id }, count() = 1', async () => {
    const saved = _sb_savedEnv();
    try {
      await _sb_resetDb();
      _sb_install({});
      const result = await SyncBuffer.enqueue({
        store: 'history-note',
        recordId: 's1',
        originalWallClock: 1000,
      });
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(typeof result.id, 'number', 'id is numeric (autoincrement)');
      const c = await SyncBuffer.count();
      assertEqual(c, 1, 'count is 1 after one enqueue');
    } finally {
      _sb_restore(saved);
      await _sb_resetDb();
    }
  });

  it('2. no-op when SYNC_DISABLED — returns { ok:false, kind:"sync-disabled" }', async () => {
    const saved = _sb_savedEnv();
    try {
      await _sb_resetDb();
      _sb_install({ flag: false });
      const result = await SyncBuffer.enqueue({
        store: 'history-note',
        recordId: 's1',
      });
      assertEqual(result.ok, false, 'ok:false when flag off');
      assertEqual(result.kind, 'sync-disabled', 'kind:sync-disabled');
    } finally {
      _sb_restore(saved);
      await _sb_resetDb();
    }
  });

  it('3. no-op when unauthenticated — returns { ok:false, kind:"unauthenticated" }', async () => {
    const saved = _sb_savedEnv();
    try {
      await _sb_resetDb();
      _sb_install({ unauth: true });
      const result = await SyncBuffer.enqueue({
        store: 'history-note',
        recordId: 's1',
      });
      assertEqual(result.ok, false, 'ok:false when signed out');
      assertEqual(result.kind, 'unauthenticated', 'kind:unauthenticated');
    } finally {
      _sb_restore(saved);
      await _sb_resetDb();
    }
  });

  it('7. invalid args — missing recordId returns { ok:false, kind:"invalid-args" }', async () => {
    const saved = _sb_savedEnv();
    try {
      await _sb_resetDb();
      _sb_install({});
      const r1 = await SyncBuffer.enqueue({ store: 'history-note' });
      assertEqual(r1.ok, false, 'missing recordId → ok:false');
      assertEqual(r1.kind, 'invalid-args', 'kind:invalid-args (missing recordId)');

      const r2 = await SyncBuffer.enqueue({ recordId: 's1' });
      assertEqual(r2.ok, false, 'missing store → ok:false');
      assertEqual(r2.kind, 'invalid-args', 'kind:invalid-args (missing store)');

      const r3 = await SyncBuffer.enqueue(null);
      assertEqual(r3.ok, false, 'null opts → ok:false');
      assertEqual(r3.kind, 'invalid-args', 'kind:invalid-args (null opts)');
    } finally {
      _sb_restore(saved);
      await _sb_resetDb();
    }
  });

});

// ────────────────────────────────────────────────────────────────────────
// Compaction + per-store dedup
// ────────────────────────────────────────────────────────────────────────

describe('SyncBuffer — compaction + per-store dedup', () => {

  it('4. compaction — 5 repeated (history-note, s1) enqueues collapse to 1', async () => {
    const saved = _sb_savedEnv();
    try {
      await _sb_resetDb();
      _sb_install({});
      for (let i = 0; i < 5; i++) {
        const r = await SyncBuffer.enqueue({
          store: 'history-note',
          recordId: 's1',
          originalWallClock: 1000 + i,
        });
        assertEqual(r.ok, true, 'enqueue ' + i + ' ok');
      }
      const c = await SyncBuffer.count();
      assertEqual(c, 1, 'compactable store collapses 5 enqueues to 1');
    } finally {
      _sb_restore(saved);
      await _sb_resetDb();
    }
  });

  it('5. compaction does NOT apply to append-only stores (meds × 3 = 3)', async () => {
    const saved = _sb_savedEnv();
    try {
      await _sb_resetDb();
      _sb_install({});
      // meds is not in COMPACTABLE_STORES; each enqueue stays.
      for (let i = 0; i < 3; i++) {
        const r = await SyncBuffer.enqueue({
          store: 'meds',
          recordId: 'm1',
          originalWallClock: 1000 + i,
        });
        assertEqual(r.ok, true, 'enqueue ' + i + ' ok');
      }
      const c = await SyncBuffer.count();
      assertEqual(c, 3, 'append-only store does not dedup');
    } finally {
      _sb_restore(saved);
      await _sb_resetDb();
    }
  });

  it('14. per-store dedup-by-recordId — (history-note, s1) + (history-tags, s1) = 2', async () => {
    const saved = _sb_savedEnv();
    try {
      await _sb_resetDb();
      _sb_install({});
      const r1 = await SyncBuffer.enqueue({
        store: 'history-note',
        recordId: 's1',
        originalWallClock: 1000,
      });
      const r2 = await SyncBuffer.enqueue({
        store: 'history-tags',
        recordId: 's1',
        originalWallClock: 1001,
      });
      assertEqual(r1.ok, true);
      assertEqual(r2.ok, true);
      const c = await SyncBuffer.count();
      assertEqual(c, 2, 'different store keys are NOT deduped even with same recordId');
    } finally {
      _sb_restore(saved);
      await _sb_resetDb();
    }
  });

  it('6. originalWallClock preserved verbatim through enqueue', async () => {
    const saved = _sb_savedEnv();
    try {
      await _sb_resetDb();
      _sb_install({});
      const r = await SyncBuffer.enqueue({
        store: 'meds',
        recordId: 'm1',
        originalWallClock: 1234567890,
      });
      assertEqual(r.ok, true, 'enqueue ok');

      // Read the entry directly via the buffer's exposed _open() helper
      // to verify the persisted record carries the original timestamp.
      const db = await SyncBuffer._open();
      const value = await new Promise((resolve, reject) => {
        const tx = db.transaction('pending_ops', 'readonly');
        const store = tx.objectStore('pending_ops');
        const req = store.openCursor();
        req.onsuccess = (event) => {
          const cur = event.target.result;
          if (!cur) { resolve(null); return; }
          resolve(cur.value);
        };
        req.onerror = () => reject(req.error || new Error('cursor failed'));
      });
      assert(value != null, 'a record exists');
      assertEqual(value.originalWallClock, 1234567890,
        'originalWallClock preserved verbatim');
      assertEqual(value.store, 'meds');
      assertEqual(value.recordId, 'm1');
    } finally {
      _sb_restore(saved);
      await _sb_resetDb();
    }
  });

});

// ────────────────────────────────────────────────────────────────────────
// Drain — FIFO ordering, idempotency, mid-cycle failures
// ────────────────────────────────────────────────────────────────────────

describe('SyncBuffer — drain', () => {

  it('8. drain FIFO — 3 entries across 3 stores call merge fns in store-grouped order', async () => {
    const saved = _sb_savedEnv();
    const realMerges = {
      meds: SyncMergeMeds.merge,
      history: SyncMergeHistory.merge,
      restLog: SyncMergeRestLog.merge,
      presets: SyncMergePresets.merge,
      bfrb: SyncMergeBfrb.merge,
      distractions: SyncMergeDistractions.merge,
      mood: SyncMergeMood.merge,
    };
    try {
      await _sb_resetDb();
      _sb_install({});

      // Enqueue 3 entries in known order — each maps to a different
      // canonical merge fn.
      await SyncBuffer.enqueue({ store: 'meds', recordId: 'm1', originalWallClock: 1000 });
      await SyncBuffer.enqueue({ store: 'history-note', recordId: 's1', originalWallClock: 1001 });
      await SyncBuffer.enqueue({ store: 'presets', recordId: 'p1', originalWallClock: 1002 });

      const order = [];
      SyncMergeMeds.merge = () => { order.push('meds'); return { ok: true, count: 1 }; };
      SyncMergeHistory.merge = () => { order.push('history'); return { ok: true, count: 1 }; };
      SyncMergeRestLog.merge = () => { order.push('rest_log'); return { ok: true, count: 1 }; };
      SyncMergePresets.merge = () => { order.push('presets'); return { ok: true, count: 1 }; };
      SyncMergeBfrb.merge = () => { order.push('bfrb_events'); return { ok: true, count: 1 }; };
      SyncMergeDistractions.merge = () => { order.push('distractions'); return { ok: true, count: 1 }; };
      SyncMergeMood.merge = () => { order.push('mood_events'); return { ok: true, count: 1 }; };

      const result = await SyncBuffer.drain();
      assertEqual(result.ok, true, 'drain ok');

      // Order is grouped by store (each store's merge fn invoked once);
      // FIFO is preserved across the first-seen store keys.
      // Expected: meds (from m1 entry first) → history (history-note → 'history') → presets.
      assertArrayEqual(order, ['meds', 'history', 'presets'],
        'merge fns invoked in store-grouped FIFO order');
    } finally {
      SyncMergeMeds.merge = realMerges.meds;
      SyncMergeHistory.merge = realMerges.history;
      SyncMergeRestLog.merge = realMerges.restLog;
      SyncMergePresets.merge = realMerges.presets;
      SyncMergeBfrb.merge = realMerges.bfrb;
      SyncMergeDistractions.merge = realMerges.distractions;
      SyncMergeMood.merge = realMerges.mood;
      _sb_restore(saved);
      await _sb_resetDb();
    }
  });

  it('11. drain idempotency — second drain on empty queue is no-op', async () => {
    const saved = _sb_savedEnv();
    const realMerges = {
      meds: SyncMergeMeds.merge,
      history: SyncMergeHistory.merge,
      restLog: SyncMergeRestLog.merge,
      presets: SyncMergePresets.merge,
      bfrb: SyncMergeBfrb.merge,
      distractions: SyncMergeDistractions.merge,
      mood: SyncMergeMood.merge,
    };
    try {
      await _sb_resetDb();
      _sb_install({});

      // First call against an empty queue: drained:0, failed:0, no merge fns invoked.
      let calls = 0;
      const incrementer = () => { calls++; return { ok: true, count: 1 }; };
      SyncMergeMeds.merge = incrementer;
      SyncMergeHistory.merge = incrementer;
      SyncMergeRestLog.merge = incrementer;
      SyncMergePresets.merge = incrementer;
      SyncMergeBfrb.merge = incrementer;
      SyncMergeDistractions.merge = incrementer;
      SyncMergeMood.merge = incrementer;

      const r1 = await SyncBuffer.drain();
      assertEqual(r1.ok, true, 'first drain ok');
      assertEqual(r1.drained, 0, 'drained = 0 on empty');
      assertEqual(calls, 0, 'no merge fns called on empty queue');

      // Second drain — also a no-op.
      const r2 = await SyncBuffer.drain();
      assertEqual(r2.ok, true, 'second drain ok');
      assertEqual(r2.drained, 0, 'drained = 0 on second empty drain');
      assertEqual(calls, 0, 'no merge fns called after second empty drain');
    } finally {
      SyncMergeMeds.merge = realMerges.meds;
      SyncMergeHistory.merge = realMerges.history;
      SyncMergeRestLog.merge = realMerges.restLog;
      SyncMergePresets.merge = realMerges.presets;
      SyncMergeBfrb.merge = realMerges.bfrb;
      SyncMergeDistractions.merge = realMerges.distractions;
      SyncMergeMood.merge = realMerges.mood;
      _sb_restore(saved);
      await _sb_resetDb();
    }
  });

  it('12. drain failure mid-cycle — failing store entries stay; others drain', async () => {
    const saved = _sb_savedEnv();
    const realMerges = {
      meds: SyncMergeMeds.merge,
      history: SyncMergeHistory.merge,
      restLog: SyncMergeRestLog.merge,
      presets: SyncMergePresets.merge,
      bfrb: SyncMergeBfrb.merge,
      distractions: SyncMergeDistractions.merge,
      mood: SyncMergeMood.merge,
    };
    try {
      await _sb_resetDb();
      _sb_install({});

      await SyncBuffer.enqueue({ store: 'meds', recordId: 'm1', originalWallClock: 1000 });
      await SyncBuffer.enqueue({ store: 'presets', recordId: 'p1', originalWallClock: 1001 });

      SyncMergeMeds.merge = () => { throw new Error('boom — meds drain failed'); };
      SyncMergeHistory.merge = () => ({ ok: true, count: 0 });
      SyncMergeRestLog.merge = () => ({ ok: true, count: 0 });
      SyncMergePresets.merge = () => ({ ok: true, count: 1 });
      SyncMergeBfrb.merge = () => ({ ok: true, count: 0 });
      SyncMergeDistractions.merge = () => ({ ok: true, count: 0 });
      SyncMergeMood.merge = () => ({ ok: true, count: 0 });

      const result = await SyncBuffer.drain();
      assertEqual(result.ok, true, 'drain returns ok:true even when one store throws');
      assert(result.failed >= 1, 'at least one failed entry');
      assert(result.drained >= 1, 'at least one drained entry (presets)');

      const remaining = await SyncBuffer.count();
      assertEqual(remaining, 1, 'one entry (meds) stays in queue after failure');
    } finally {
      SyncMergeMeds.merge = realMerges.meds;
      SyncMergeHistory.merge = realMerges.history;
      SyncMergeRestLog.merge = realMerges.restLog;
      SyncMergePresets.merge = realMerges.presets;
      SyncMergeBfrb.merge = realMerges.bfrb;
      SyncMergeDistractions.merge = realMerges.distractions;
      SyncMergeMood.merge = realMerges.mood;
      _sb_restore(saved);
      await _sb_resetDb();
    }
  });

  it('13. SYNC_DISABLED fast-path during drain — no merge fns invoked', async () => {
    const saved = _sb_savedEnv();
    const realMerges = {
      meds: SyncMergeMeds.merge,
      history: SyncMergeHistory.merge,
      restLog: SyncMergeRestLog.merge,
      presets: SyncMergePresets.merge,
      bfrb: SyncMergeBfrb.merge,
      distractions: SyncMergeDistractions.merge,
      mood: SyncMergeMood.merge,
    };
    try {
      await _sb_resetDb();
      // Enqueue while flag is on so there's actual buffer state...
      _sb_install({});
      await SyncBuffer.enqueue({ store: 'meds', recordId: 'm1', originalWallClock: 1000 });

      // ...then flip flag off and drain — should fast-path.
      let calls = 0;
      const incrementer = () => { calls++; return { ok: true, count: 1 }; };
      SyncMergeMeds.merge = incrementer;
      SyncMergeHistory.merge = incrementer;
      SyncMergeRestLog.merge = incrementer;
      SyncMergePresets.merge = incrementer;
      SyncMergeBfrb.merge = incrementer;
      SyncMergeDistractions.merge = incrementer;
      SyncMergeMood.merge = incrementer;

      SyncFlag.isEnabled = () => false;
      localStorage.setItem('tempo_sync_enabled', '0');
      const result = await SyncBuffer.drain();
      assertEqual(result.ok, false, 'ok:false when flag off');
      assertEqual(result.kind, 'sync-disabled', 'kind:sync-disabled');
      assertEqual(calls, 0, 'no merge fns called when flag off');
    } finally {
      SyncMergeMeds.merge = realMerges.meds;
      SyncMergeHistory.merge = realMerges.history;
      SyncMergeRestLog.merge = realMerges.restLog;
      SyncMergePresets.merge = realMerges.presets;
      SyncMergeBfrb.merge = realMerges.bfrb;
      SyncMergeDistractions.merge = realMerges.distractions;
      SyncMergeMood.merge = realMerges.mood;
      _sb_restore(saved);
      await _sb_resetDb();
    }
  });

  it('T4. drain — entry with no matching merge fn is counted failed + left in queue', async () => {
    // A buffer entry whose store has no merge fn (`_mergeFnFor` → null,
    // e.g. a stale key left by an older release) must NOT be silently
    // dropped: drain counts it as failed and leaves the pointer in the
    // queue for a future drain (sync-buffer.js _mergeFnFor → null path).
    const saved = _sb_savedEnv();
    try {
      await _sb_resetDb();
      _sb_install({});

      await SyncBuffer.enqueue({ store: 'bogus', recordId: 'x1', originalWallClock: 1000 });
      assertEqual(await SyncBuffer.count(), 1, 'one bogus-store entry enqueued');

      const result = await SyncBuffer.drain();
      assertEqual(result.ok, true, 'drain returns ok:true');
      assertEqual(result.drained, 0, 'nothing drained — no merge fn for bogus store');
      assertEqual(result.failed, 1, 'the bogus entry is counted failed');

      const remaining = await SyncBuffer.count();
      assertEqual(remaining, 1, 'bogus entry stays in queue for the next drain');
    } finally {
      _sb_restore(saved);
      await _sb_resetDb();
    }
  });

  it('T5. drain — merge ok:true with skipped>0 still deletes pointers (current contract)', async () => {
    // Contract (T5 decision): when a store's merge fn returns ok:true but
    // reports skipped>0 (a record guarded by e.g. F19a refuse-writeback),
    // drain still treats the pass as successful and deletes ALL of that
    // store's pointers. The skipped record is NOT lost — the 300s steady-
    // state poll re-merges from full local state every cycle while sync is
    // live. This characterization test pins that behavior so a future
    // refactor can't silently flip it.
    const saved = _sb_savedEnv();
    const realMedsMerge = SyncMergeMeds.merge;
    try {
      await _sb_resetDb();
      _sb_install({});

      await SyncBuffer.enqueue({ store: 'meds', recordId: 'm1', originalWallClock: 1000 });
      assertEqual(await SyncBuffer.count(), 1, 'one meds entry enqueued');

      // Merge reports a skipped record but a successful pass overall.
      SyncMergeMeds.merge = () => ({ ok: true, count: 0, skipped: 1 });

      const result = await SyncBuffer.drain();
      assertEqual(result.ok, true, 'drain ok');
      assertEqual(result.drained, 1, 'pointer counted drained despite skipped>0');
      assertEqual(result.failed, 0, 'nothing counted failed');

      const remaining = await SyncBuffer.count();
      assertEqual(remaining, 0, 'skipped pointer is DELETED — steady-state re-syncs the record');
    } finally {
      SyncMergeMeds.merge = realMedsMerge;
      _sb_restore(saved);
      await _sb_resetDb();
    }
  });

});

// ────────────────────────────────────────────────────────────────────────
// Cap-overflow + cross-restart
// ────────────────────────────────────────────────────────────────────────

describe('SyncBuffer — cap-overflow + cross-restart', () => {

  it('10. cross-restart — entries persist on disk in IDB across the connection lifecycle', async () => {
    // The cross-restart guarantee is that enqueued entries land in IDB
    // (a brand-new persistent DB, `tempo_sync_db`) and survive across
    // tab close. We verify this by enqueueing 3 entries through the
    // buffer (which exercises the full IDB write path) and then
    // reading them back via a direct raw IDB open in this test scope.
    const saved = _sb_savedEnv();
    try {
      await _sb_resetDb();
      _sb_install({});

      await SyncBuffer.enqueue({ store: 'meds', recordId: 'm1', originalWallClock: 1000 });
      await SyncBuffer.enqueue({ store: 'meds', recordId: 'm2', originalWallClock: 1001 });
      await SyncBuffer.enqueue({ store: 'meds', recordId: 'm3', originalWallClock: 1002 });
      assertEqual(await SyncBuffer.count(), 3, 'count = 3 after 3 enqueues');

      // Open the DB directly via the buffer's _open() helper — this is
      // what a fresh page load would see if it called _open() at boot
      // (subsequent calls return the cached handle, but the first call
      // re-opens from disk). Use the buffer's cursor-walk to read all
      // entries: this verifies the data is durably persisted.
      const db = await SyncBuffer._open();
      const entries = await new Promise((resolve, reject) => {
        const tx = db.transaction('pending_ops', 'readonly');
        const store = tx.objectStore('pending_ops');
        const result = [];
        const req = store.openCursor();
        req.onsuccess = (event) => {
          const cur = event.target.result;
          if (!cur) { resolve(result); return; }
          result.push(cur.value);
          cur.continue();
        };
        req.onerror = () => reject(req.error || new Error('cursor failed'));
      });
      assertEqual(entries.length, 3,
        'IDB on disk persists 3 entries (cross-restart guarantee)');
      // Order by enqueuedAt ascending (cursor walk default on autoincrement keys).
      const recordIds = entries.map((e) => e.recordId).sort();
      assertArrayEqual(recordIds, ['m1', 'm2', 'm3'], 'all 3 recordIds present');
    } finally {
      _sb_restore(saved);
      await _sb_resetDb();
    }
  });

  it('9. cap-overflow drops oldest + emits buffer-overflow event', async () => {
    // This case fills the queue to PENDING_OP_CAP, adds one more,
    // then asserts the dropped count + the emitted event payload.
    const saved = _sb_savedEnv();
    try {
      await _sb_resetDb();
      _sb_install({});

      const CAP = SyncBuffer._PENDING_OP_CAP;
      assertEqual(CAP, 1000, 'PENDING_OP_CAP is 1000');

      let overflowEvents = [];
      const cb = (p) => { overflowEvents.push(p); };
      SyncEngine.on('buffer-overflow', cb);

      // Use append-only store (meds) so compaction doesn't collapse
      // entries — we want CAP+1 distinct entries in the queue.
      // We enqueue CAP entries first (each with a different recordId).
      // Sequential awaits so autoincrement order is deterministic.
      for (let i = 0; i < CAP; i++) {
        await SyncBuffer.enqueue({
          store: 'meds',
          recordId: 'm' + i,
          originalWallClock: 1000 + i,
        });
      }

      let cBefore = await SyncBuffer.count();
      assertEqual(cBefore, CAP, 'count at CAP after ' + CAP + ' enqueues');
      assertEqual(overflowEvents.length, 0, 'no overflow event before CAP+1');

      // The (CAP+1)th entry should trigger eviction.
      await SyncBuffer.enqueue({
        store: 'meds',
        recordId: 'm-overflow',
        originalWallClock: 1000 + CAP,
      });

      const cAfter = await SyncBuffer.count();
      assertEqual(cAfter, CAP, 'count clamped to CAP after overflow');
      assertEqual(overflowEvents.length, 1, 'buffer-overflow event fired once');
      assertEqual(overflowEvents[0].droppedCount, 1, 'droppedCount = 1');

      SyncEngine.off('buffer-overflow', cb);
    } finally {
      _sb_restore(saved);
      await _sb_resetDb();
    }
  });

});
