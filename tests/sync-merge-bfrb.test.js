// E-1d-f3 — SyncMergeBfrb.merge() tests.
//
// Coverage (per E-1d-f3-AUDIT § "Test scope"):
//   1.  Happy path — events append-merge by (deviceId, takenAt).
//   2.  Dedup by (deviceId, takenAt) — cloud wins on sig collision.
//   3.  F19a per-record pre-filter — future-schema cloud entry skipped.
//   4.  F13 write gate during cycle — SyncState.canWrite returns false mid-cycle.
//   5.  F13 gate releases after cycle — dispatcher's responsibility (sanity check).
//   6.  Idempotency — 2nd merge with same cloud state produces zero net new.
//   7.  CAS abort tolerance — refuse-writeback counted, loop continues.
//   8.  SYNC_DISABLED fast-path — flag off returns { ok:false, kind:'sync-not-enabled' }.
//   9.  Unauthenticated — no user → { ok:false, kind:'unauthenticated' }.
//   10. Empty cloud — local entries all written.
//   11. Context tag passes through writeback — flow + pomo sessionId preserved.
//   12. Mixed context values merge into one stream.
//
// Mocking pattern: SyncFirestore + SyncAuth methods are hot-swapped on
// the real modules and restored in finally (same convention as
// sync-merge-meds.test.js + sync-merge-history.test.js).

// ── Shared save/restore + install helpers ─────────────────────────────

function _bm_savedEnv() {
  return {
    flag_enabled: SyncFlag.isEnabled,
    auth_getCurrentUser: SyncAuth.getCurrentUser,
    fs_getCollection: SyncFirestore.getCollection,
    fs_runTransaction: SyncFirestore.runTransaction,
    syncState: window.SyncState,
    sync_flag_storage: localStorage.getItem('tempo_sync_enabled'),
    bfrb_events: localStorage.getItem('bfrb_events'),
    bfrb_marker: localStorage.getItem('tempo_bfrb_events_migration_v1'),
  };
}

function _bm_restore(saved) {
  SyncFlag.isEnabled = saved.flag_enabled;
  SyncAuth.getCurrentUser = saved.auth_getCurrentUser;
  SyncFirestore.getCollection = saved.fs_getCollection;
  SyncFirestore.runTransaction = saved.fs_runTransaction;
  if (saved.syncState === undefined) delete window.SyncState;
  else window.SyncState = saved.syncState;
  if (saved.sync_flag_storage === null) localStorage.removeItem('tempo_sync_enabled');
  else localStorage.setItem('tempo_sync_enabled', saved.sync_flag_storage);
  if (saved.bfrb_events === null) localStorage.removeItem('bfrb_events');
  else localStorage.setItem('bfrb_events', saved.bfrb_events);
  if (saved.bfrb_marker === null) localStorage.removeItem('tempo_bfrb_events_migration_v1');
  else localStorage.setItem('tempo_bfrb_events_migration_v1', saved.bfrb_marker);
}

function _bm_clearStore() {
  localStorage.removeItem('bfrb_events');
  // Set marker so module-load migration is a no-op during test setup.
  localStorage.setItem('tempo_bfrb_events_migration_v1', '1');
}

function _bm_seedLocal(entries) {
  localStorage.setItem('bfrb_events', JSON.stringify(entries));
}

function _bm_makeCloudDoc(rec) {
  const dev = (typeof rec.deviceId === 'string') ? rec.deviceId : 'no-device';
  return { id: dev + '-' + rec.takenAt, data: rec };
}

function _bm_makeEntry(deviceId, takenAt, context, extras) {
  return Object.assign({
    takenAt,
    context: context || 'global',
    deviceId,
    updatedAt: takenAt,
    schemaVersion: 1,
  }, extras || {});
}

function _bm_install(opts) {
  opts = opts || {};
  SyncFlag.isEnabled = () => true;
  SyncAuth.getCurrentUser = () => ({ uid: opts.uid || 'u-bfrb-test', email: 't@test.com' });

  const cloudDocs = opts.cloudDocs || [];
  SyncFirestore.getCollection = async (path) => ({ docs: cloudDocs.slice(), count: cloudDocs.length });

  const txGetMap = opts.txGetMap || {};
  opts.txSets = opts.txSets || [];
  SyncFirestore.runTransaction = opts.runTransaction || (async (fn) => {
    const tx = {
      get: async (path) => {
        if (Object.prototype.hasOwnProperty.call(txGetMap, path)) {
          const data = txGetMap[path];
          return data == null ? null : { id: path.split('/').pop(), data };
        }
        return null;
      },
      set: (path, data) => {
        opts.txSets.push({ path, data });
      },
      refuseWriteback: (remote, local) => {
        const err = new Error('refuse-writeback: remote=' + (remote && remote.schemaVersion)
                              + ' > local=' + local);
        err.kind = 'refuse-writeback';
        err.isRetryable = false;
        throw err;
      },
    };
    return await fn(tx);
  });

  if (opts.syncState !== undefined) window.SyncState = opts.syncState;

  localStorage.setItem('tempo_sync_enabled', '1');

  return opts;
}

// ────────────────────────────────────────────────────────────────────────
// Test cases — SyncMergeBfrb.merge()
// ────────────────────────────────────────────────────────────────────────

describe('SyncMergeBfrb — merge — happy path + dedup + F19a + CAS', () => {

  it('1. happy path — events append-merge by (deviceId, takenAt)', async () => {
    const saved = _bm_savedEnv();
    try {
      _bm_clearStore();
      const localA = _bm_makeEntry('local-dev', 1000, 'global');
      const localB = _bm_makeEntry('local-dev', 2000, 'global');
      _bm_seedLocal([localA, localB]);

      const cloudC = _bm_makeEntry('phone-2', 3000, 'global');
      const opts = _bm_install({
        cloudDocs: [_bm_makeCloudDoc(cloudC)],
      });

      const result = await SyncMergeBfrb.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 3, 'three records written back');
      assertEqual(result.skipped, 0, 'no skips');
      assertEqual(opts.txSets.length, 3, 'three CAS writes');
      // remoteArrivals always {} for BFRB events (no F15).
      const keys = Object.keys(result.remoteArrivals);
      assertEqual(keys.length, 0, 'remoteArrivals is empty (no F15 for bfrb_events)');
    } finally {
      _bm_restore(saved);
    }
  });

  it('2. dedup by (deviceId, takenAt) — cloud wins on sig collision', async () => {
    const saved = _bm_savedEnv();
    try {
      _bm_clearStore();
      // Same sig (deviceId, takenAt) — but different `phase` value to detect winner.
      const local = _bm_makeEntry('shared-dev', 5000, 'flow', { phase: 'local-state', sessionId: 100 });
      _bm_seedLocal([local]);
      const cloud = _bm_makeEntry('shared-dev', 5000, 'flow', { phase: 'cloud-state', sessionId: 100 });
      const opts = _bm_install({
        cloudDocs: [_bm_makeCloudDoc(cloud)],
      });

      const result = await SyncMergeBfrb.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 1, 'single entry (dedup)');
      assertEqual(opts.txSets.length, 1, 'one CAS write');
      assertEqual(opts.txSets[0].data.phase, 'cloud-state', 'cloud entry wins on sig collision');
    } finally {
      _bm_restore(saved);
    }
  });

  it('3. F19a per-record pre-filter — future-schema cloud entry skipped', async () => {
    const saved = _bm_savedEnv();
    try {
      _bm_clearStore();
      _bm_seedLocal([]);

      const futureRec = _bm_makeEntry('phone-2', 6000, 'global');
      futureRec.schemaVersion = 999; // future schema
      const normalRec = _bm_makeEntry('phone-2', 7000, 'global');

      const opts = _bm_install({
        cloudDocs: [_bm_makeCloudDoc(futureRec), _bm_makeCloudDoc(normalRec)],
      });

      const result = await SyncMergeBfrb.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 1, 'one record written (future-schema skipped)');
      assert(result.skipped >= 1, 'at least one skipped');
      // Confirm the written record is the non-future one.
      assertEqual(opts.txSets.length, 1, 'one CAS write');
      assertEqual(opts.txSets[0].data.takenAt, 7000, 'normal record written');
    } finally {
      _bm_restore(saved);
    }
  });

  it('4. F13 write gate during cycle — SyncState.canWrite=false visible during merge', async () => {
    const saved = _bm_savedEnv();
    try {
      _bm_clearStore();
      _bm_seedLocal([_bm_makeEntry('local-dev', 8000, 'global')]);

      // Install a SyncState stub set to 'hydrating' (gate closed) — the
      // merge function does NOT flip state itself; the dispatcher owns
      // that. This test verifies the merge runs cleanly while the gate
      // is closed (no engine writes happen, but cloud writeback proceeds).
      const stateSets = [];
      window.SyncState = {
        get: () => 'hydrating',
        set: (s) => { stateSets.push(s); return true; },
        canWrite: () => false,
        isHydrating: () => true,
      };

      _bm_install({ syncState: window.SyncState });

      const result = await SyncMergeBfrb.merge(null);
      assertEqual(result.ok, true, 'merge succeeded under closed gate');
      assertEqual(result.count, 1, 'one record written');
      // Merge function does NOT flip state on its own — dispatcher's job.
      assertEqual(stateSets.length, 0, 'merge fn did not flip SyncState');
    } finally {
      _bm_restore(saved);
    }
  });

  it('5. F13 gate release contract — merge fn never sets state to ready (dispatcher does)', async () => {
    // Sanity check: confirms the inverse of test #4. The dispatcher's
    // contract is to flip state AROUND the merge call; this test
    // documents that merge never sets state to 'ready' on its own.
    const saved = _bm_savedEnv();
    try {
      _bm_clearStore();
      _bm_seedLocal([]);

      const stateSets = [];
      window.SyncState = {
        get: () => 'ready',
        set: (s) => { stateSets.push(s); return true; },
        canWrite: () => true,
        isHydrating: () => false,
      };

      _bm_install({ syncState: window.SyncState });

      await SyncMergeBfrb.merge(null);
      assertEqual(stateSets.length, 0, 'merge fn never sets SyncState');
    } finally {
      _bm_restore(saved);
    }
  });

  it('6. idempotency — 2nd merge with same cloud state writes byte-equivalent records', async () => {
    const saved = _bm_savedEnv();
    try {
      _bm_clearStore();
      _bm_seedLocal([_bm_makeEntry('local-dev', 10000, 'global')]);

      const cloud = _bm_makeEntry('phone-2', 11000, 'flow', { sessionId: 50 });
      const opts1 = _bm_install({ cloudDocs: [_bm_makeCloudDoc(cloud)] });
      const r1 = await SyncMergeBfrb.merge(null);
      assertEqual(r1.ok, true, 'first merge ok');
      assertEqual(opts1.txSets.length, 2, 'two writes on first run');
      const firstWrites = opts1.txSets.map(s => JSON.stringify(s.data));

      // Re-run with the SAME cloud state.
      const opts2 = _bm_install({ cloudDocs: [_bm_makeCloudDoc(cloud)] });
      const r2 = await SyncMergeBfrb.merge(null);
      assertEqual(r2.ok, true, 'second merge ok');
      // Both runs write the same set of records (idempotent).
      assertEqual(opts2.txSets.length, 2, 'two writes on second run too');
      const secondWrites = opts2.txSets.map(s => JSON.stringify(s.data));
      // Sets are equal as multisets (order may differ since merge sorts
      // by takenAt — but sort is stable, so order is preserved here).
      firstWrites.sort();
      secondWrites.sort();
      assertEqual(secondWrites.join('|'), firstWrites.join('|'), 'byte-equivalent writes');
    } finally {
      _bm_restore(saved);
    }
  });

  it('7. CAS abort tolerance — refuse-writeback counted, loop continues', async () => {
    const saved = _bm_savedEnv();
    try {
      _bm_clearStore();
      _bm_seedLocal([
        _bm_makeEntry('local-dev', 20000, 'global'),
        _bm_makeEntry('local-dev', 21000, 'global'),
      ]);

      // Mock runTransaction to throw refuse-writeback on entry #1, succeed on #2.
      let callCount = 0;
      const opts = _bm_install({});
      opts.txSets = [];
      SyncFirestore.runTransaction = async (fn) => {
        callCount++;
        if (callCount === 1) {
          // Simulate CAS refusing the first write.
          const err = new Error('refuse-writeback: future record');
          err.kind = 'refuse-writeback';
          throw err;
        }
        // Second call succeeds.
        const tx = {
          get: async () => null,
          set: (path, data) => { opts.txSets.push({ path, data }); },
          refuseWriteback: () => { throw new Error('unused'); },
        };
        return await fn(tx);
      };

      const result = await SyncMergeBfrb.merge(null);
      assertEqual(result.ok, true, 'ok:true (loop continues)');
      assertEqual(result.count, 1, 'one successful write');
      assert(result.skipped >= 1, 'one or more skipped (refuse-writeback)');
    } finally {
      _bm_restore(saved);
    }
  });

  it('8. SYNC_DISABLED fast-path — flag off returns { ok:false, kind:"sync-not-enabled" }', async () => {
    const saved = _bm_savedEnv();
    try {
      _bm_clearStore();
      SyncFlag.isEnabled = () => false;
      let getCollectionCalled = false;
      let runTransactionCalled = false;
      SyncFirestore.getCollection = async () => { getCollectionCalled = true; return { docs: [] }; };
      SyncFirestore.runTransaction = async () => { runTransactionCalled = true; };

      const result = await SyncMergeBfrb.merge(null);
      assertEqual(result.ok, false, 'ok:false');
      assertEqual(result.kind, 'sync-not-enabled', 'kind correct');
      assertEqual(getCollectionCalled, false, 'getCollection NOT called');
      assertEqual(runTransactionCalled, false, 'runTransaction NOT called');
    } finally {
      _bm_restore(saved);
    }
  });

  it('9. unauthenticated — no signed-in user → { ok:false, kind:"unauthenticated" }', async () => {
    const saved = _bm_savedEnv();
    try {
      _bm_clearStore();
      SyncFlag.isEnabled = () => true;
      SyncAuth.getCurrentUser = () => null;
      let getCollectionCalled = false;
      SyncFirestore.getCollection = async () => { getCollectionCalled = true; return { docs: [] }; };

      const result = await SyncMergeBfrb.merge(null);
      assertEqual(result.ok, false, 'ok:false');
      assertEqual(result.kind, 'unauthenticated', 'kind correct');
      assertEqual(getCollectionCalled, false, 'no cloud reads');
    } finally {
      _bm_restore(saved);
    }
  });

  it('10. empty cloud — no events in cloud → ok:true, all local written', async () => {
    const saved = _bm_savedEnv();
    try {
      _bm_clearStore();
      _bm_seedLocal([
        _bm_makeEntry('local-dev', 30000, 'global'),
        _bm_makeEntry('local-dev', 31000, 'flow', { sessionId: 1 }),
        _bm_makeEntry('local-dev', 32000, 'pomodoro', { sessionId: 2, cycleIndex: 0 }),
      ]);
      const opts = _bm_install({ cloudDocs: [] });

      const result = await SyncMergeBfrb.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 3, 'three local entries written');
      assertEqual(opts.txSets.length, 3, 'three CAS writes');
    } finally {
      _bm_restore(saved);
    }
  });

  it('11. context tag passes through writeback — sessionId/phase/cycleIndex preserved', async () => {
    const saved = _bm_savedEnv();
    try {
      _bm_clearStore();
      _bm_seedLocal([
        _bm_makeEntry('local-dev', 40000, 'flow', { sessionId: 12345, phase: 'focus' }),
        _bm_makeEntry('local-dev', 41000, 'pomodoro', { sessionId: 67890, phase: 'work', cycleIndex: 2 }),
      ]);
      const opts = _bm_install({});

      const result = await SyncMergeBfrb.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets.length, 2, 'two writes');

      const flowWrite = opts.txSets.find(s => s.data.context === 'flow');
      assertEqual(flowWrite.data.sessionId, 12345, 'flow sessionId preserved');
      assertEqual(flowWrite.data.phase, 'focus', 'flow phase preserved');

      const pomoWrite = opts.txSets.find(s => s.data.context === 'pomodoro');
      assertEqual(pomoWrite.data.sessionId, 67890, 'pomodoro sessionId preserved');
      assertEqual(pomoWrite.data.phase, 'work', 'pomodoro phase preserved');
      assertEqual(pomoWrite.data.cycleIndex, 2, 'pomodoro cycleIndex preserved');
    } finally {
      _bm_restore(saved);
    }
  });

  it('12. mixed context values merge into one stream — dedup is by (deviceId, takenAt) regardless of context', async () => {
    const saved = _bm_savedEnv();
    try {
      _bm_clearStore();
      _bm_seedLocal([
        _bm_makeEntry('local-dev', 50000, 'global'),
        _bm_makeEntry('local-dev', 50500, 'flow', { sessionId: 1 }),
      ]);
      const opts = _bm_install({
        cloudDocs: [
          _bm_makeCloudDoc(_bm_makeEntry('phone-2', 50250, 'pomodoro', { sessionId: 2, cycleIndex: 0 })),
          _bm_makeCloudDoc(_bm_makeEntry('phone-2', 50750, 'global')),
        ],
      });

      const result = await SyncMergeBfrb.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 4, 'four entries (mixed contexts merged)');

      const contexts = opts.txSets.map(s => s.data.context).sort();
      assertEqual(contexts.join(','), 'flow,global,global,pomodoro', 'all three contexts survive');
    } finally {
      _bm_restore(saved);
    }
  });

});
