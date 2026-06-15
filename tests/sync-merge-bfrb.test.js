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

// ────────────────────────────────────────────────────────────────────────
// H4 — cloud→local writeback. Before this fix the merge converged the CLOUD
// (CAS writeback) but never applied cloud-origin arrivals back to the local
// bfrb_events array, so a catch logged on another device was invisible here
// forever. These lock in that the merged set is now queryable LOCALLY via the
// normal BfrbEvents.getAll() consumer path after merge().
// ────────────────────────────────────────────────────────────────────────
describe('SyncMergeBfrb — H4 cloud→local writeback', () => {

  it('applies a cloud-origin event to LOCAL storage so getAll() returns it after merge()', async () => {
    const saved = _bm_savedEnv();
    try {
      _bm_clearStore();
      _bm_seedLocal([_bm_makeEntry('local-dev', 1000, 'global')]);
      // A record that exists ONLY in the cloud (logged on another device).
      const cloudC = _bm_makeEntry('phone-2', 3000, 'flow', { sessionId: 7 });
      _bm_install({ cloudDocs: [_bm_makeCloudDoc(cloudC)] });

      // Precondition: the cloud-origin event is NOT yet in the local store.
      assertEqual(BfrbEvents.getAll().some(e => e.takenAt === 3000), false,
        'precondition — cloud-origin event not yet local');

      const result = await SyncMergeBfrb.merge(null);
      assertEqual(result.ok, true, 'ok:true');

      const all = BfrbEvents.getAll();
      const arrived = all.find(e => e.takenAt === 3000 && e.deviceId === 'phone-2');
      assert(arrived, 'cloud-origin event must be locally queryable after merge (H4)');
      assertEqual(arrived.context, 'flow', 'cloud event payload preserved locally');
      assertEqual(arrived.sessionId, 7, 'cloud event sessionId preserved locally');
      assert(all.some(e => e.takenAt === 1000 && e.deviceId === 'local-dev'),
        'pre-existing local event preserved (lossless union)');
      assertEqual(all.length, 2, 'union of cloud + local — no duplication');
    } finally {
      _bm_restore(saved);
    }
  });

  it('cloud wins on (deviceId, takenAt) collision in the LOCAL store too', async () => {
    const saved = _bm_savedEnv();
    try {
      _bm_clearStore();
      _bm_seedLocal([_bm_makeEntry('shared-dev', 5000, 'flow', { phase: 'local-state' })]);
      const cloud = _bm_makeEntry('shared-dev', 5000, 'flow', { phase: 'cloud-state' });
      _bm_install({ cloudDocs: [_bm_makeCloudDoc(cloud)] });

      await SyncMergeBfrb.merge(null);

      const all = BfrbEvents.getAll();
      assertEqual(all.length, 1, 'collision deduped in the local store');
      assertEqual(all[0].phase, 'cloud-state',
        'cloud value wins locally — matches the CAS writeback winner');
    } finally {
      _bm_restore(saved);
    }
  });

  it('a local-only event is not lost when the cloud is empty', async () => {
    const saved = _bm_savedEnv();
    try {
      _bm_clearStore();
      _bm_seedLocal([_bm_makeEntry('local-dev', 9000, 'global')]);
      _bm_install({ cloudDocs: [] }); // empty cloud

      await SyncMergeBfrb.merge(null);

      const all = BfrbEvents.getAll();
      assertEqual(all.length, 1, 'local-only event survives the local writeback');
      assertEqual(all[0].takenAt, 9000, 'the local event is intact');
    } finally {
      _bm_restore(saved);
    }
  });

});

// ────────────────────────────────────────────────────────────────────────
// M2/M5 (AUDIT-2026-06-13) — change-detection skip via SyncMergeEqual.
// Representative coverage for the shared deep-equal guard wired into all 7
// merge modules. The pre-existing tests stay green because their default tx
// shim returns null from tx.get (so the guard is never reached); these seed
// txGetMap to actually exercise the skip.
// ────────────────────────────────────────────────────────────────────────

describe('SyncMergeBfrb — M2/M5 redundant-write skip', () => {

  it('skips the cloud write when the in-tx cloud doc already equals the merged record', async () => {
    const saved = _bm_savedEnv();
    try {
      _bm_clearStore();
      const e = _bm_makeEntry('dev-A', 5000, 'global', { phase: 'caught' });
      _bm_seedLocal([e]);
      const path = 'users/u-bfrb-test/bfrb_events/dev-A-5000';
      const opts = _bm_install({
        cloudDocs: [_bm_makeCloudDoc(e)],   // cloud already has the identical record
        txGetMap: { [path]: e },            // the in-transaction read returns it
      });

      const result = await SyncMergeBfrb.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets.length, 0, 'NO redundant cloud write when merged === cloud doc');
      assertEqual(result.count, 1, 'count still credits the record as converged (count stable)');
    } finally {
      _bm_restore(saved);
    }
  });

  it('still writes when the in-tx cloud doc differs from the merged record', async () => {
    const saved = _bm_savedEnv();
    try {
      _bm_clearStore();
      const local = _bm_makeEntry('dev-A', 6000, 'global', { phase: 'fresh' });
      _bm_seedLocal([local]);
      const path = 'users/u-bfrb-test/bfrb_events/dev-A-6000';
      const staleCloud = _bm_makeEntry('dev-A', 6000, 'global', { phase: 'stale' });
      const opts = _bm_install({
        cloudDocs: [],                      // getCollection empty → merged = local 'fresh'
        txGetMap: { [path]: staleCloud },   // but the in-tx read finds a stale doc
      });

      const result = await SyncMergeBfrb.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets.length, 1, 'merged differs from cloud doc → writes');
      assertEqual(opts.txSets[0].data.phase, 'fresh', 'the merged (fresh) record is written');
    } finally {
      _bm_restore(saved);
    }
  });

  it('still writes when the cloud doc is absent (tx.get null) — guards on remote presence', async () => {
    const saved = _bm_savedEnv();
    try {
      _bm_clearStore();
      _bm_seedLocal([_bm_makeEntry('dev-A', 7000, 'global')]);
      const opts = _bm_install({ cloudDocs: [] }); // no txGetMap → tx.get returns null

      const result = await SyncMergeBfrb.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets.length, 1, 'cloud absent → still writes (this is why pre-existing tests stay green)');
    } finally {
      _bm_restore(saved);
    }
  });

});

// ────────────────────────────────────────────────────────────────────────
// M9 (AUDIT-2026-06-13) — native (iOS) writeback gap surfaced via the event
// bus instead of a silent skip. Verified on the bfrb module (the catch-branch
// is identical across all 7 stores).
// ────────────────────────────────────────────────────────────────────────

describe('SyncMergeBfrb — M9 native-writeback-unsupported emit', () => {

  it('emits ONCE per store + counts skipped when runTransaction throws the native marker', async () => {
    const saved = _bm_savedEnv();
    const events = [];
    const onNative = (p) => events.push(p);
    try {
      _bm_clearStore();
      SyncEngine._resetNativeWritebackWarned();
      SyncEngine.on('native-writeback-unsupported', onNative);
      _bm_seedLocal([
        _bm_makeEntry('dev-A', 8000, 'global'),
        _bm_makeEntry('dev-A', 8100, 'global'),
      ]);
      const opts = _bm_install({
        cloudDocs: [],
        // Simulate the native runTransaction parity gap for every record.
        runTransaction: async () => {
          const e = new Error('runTransaction native parity pending');
          e.kind = 'unknown';
          e.nativeUnsupported = true;
          throw e;
        },
      });

      const result = await SyncMergeBfrb.merge(null);
      assertEqual(result.ok, true, 'merge still resolves ok (per-record tolerated)');
      assertEqual(result.skipped, 2, 'both records counted as skipped');
      assertEqual(opts.txSets.length, 0, 'no cloud writes land on native');
      assertEqual(events.length, 1, 'native-writeback-unsupported emitted exactly ONCE despite 2 records (deduped)');
      assertEqual(events[0].store, 'bfrb_events', 'payload carries the store key');
    } finally {
      SyncEngine.off('native-writeback-unsupported', onNative);
      SyncEngine._resetNativeWritebackWarned();
      _bm_restore(saved);
    }
  });

});
