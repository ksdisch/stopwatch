// E-1c — SyncMergeMeds.merge() + D-1 reconcile retrofit + F13 dispatcher
// gate + F15 ≥2-entry remote-arrival counter.
//
// Coverage (per E-1c-AUDIT.md § "Test scope"):
//   1.  Happy path — 1 new remote dose entry, NO F15 emit (threshold ≥2)
//   2.  F15 fire — 2 new remote entries on 1 med → 1 emit { medId, count: 2 }
//   3.  F15 multi-med — 2 on A + 3 on B → 2 emits (per-med independence)
//   4.  F15 no-fire — 1 on A + 1 on B → 0 emits (per-med threshold)
//   5.  F19a pre-filter — future-schema cloud record skipped + counted
//   6.  F19a D-2 backup — pre-filter bypassed, reconcileDoseLog still
//        returns existing log unchanged (D-2 per-method gate)
//   7.  Idempotency — 2nd merge with same cloud state produces 0 F15 emits
//   8.  CAS abort on stale schemaVersion — counted in `skipped`, loop continues
//   9.  F13 gate during cycle — SyncState set to 'hydrating' mid-cycle
//   10. F13 release — SyncState restored to 'ready' after cycle (incl. on throw)
//   11. F4 ordering — onMergeComplete fires AFTER doseLog reassignment
//   12. D-1 retrofit — reconcileImportedBucket loop collapses cross-device dupes
//   13. CAS error tolerance — non-refuse-writeback errors per-med tolerated
//   14. F20 forward-compat — unknown `frequency` value passes through pre-filter
//   15. Empty cloud — no docs → ok: true, count: 0, 0 events, 0 transactions
//
// Mocking pattern: SyncFirestore + SyncAuth methods are hot-swapped on
// the real modules and restored in finally (same convention as
// sync-uploader.test.js / sync-imported-bucket.test.js). MedsManager is
// loaded for real, but we clear its in-memory state per test and pre-
// seed via MedsManager.add(...) or its real loadAll path.

// ── Shared save/restore + install helpers ─────────────────────────────

function _e1c_savedEnv() {
  return {
    flag_enabled: SyncFlag.isEnabled,
    auth_getCurrentUser: SyncAuth.getCurrentUser,
    fs_getCollection: SyncFirestore.getCollection,
    fs_runTransaction: SyncFirestore.runTransaction,
    meds_all: MedsManager.all,
    meds_snapshot: MedsManager.snapshotForSync,
    meds_reconcileDoseLog: MedsManager.reconcileDoseLog,
    meds_onMergeComplete: MedsManager.onMergeComplete,
    syncState: window.SyncState,
    sync_flag_storage: localStorage.getItem('tempo_sync_enabled'),
  };
}

function _e1c_restore(saved) {
  SyncFlag.isEnabled = saved.flag_enabled;
  SyncAuth.getCurrentUser = saved.auth_getCurrentUser;
  SyncFirestore.getCollection = saved.fs_getCollection;
  SyncFirestore.runTransaction = saved.fs_runTransaction;
  MedsManager.all = saved.meds_all;
  MedsManager.snapshotForSync = saved.meds_snapshot;
  MedsManager.reconcileDoseLog = saved.meds_reconcileDoseLog;
  MedsManager.onMergeComplete = saved.meds_onMergeComplete;
  if (saved.syncState === undefined) delete window.SyncState;
  else window.SyncState = saved.syncState;
  if (saved.sync_flag_storage === null) localStorage.removeItem('tempo_sync_enabled');
  else localStorage.setItem('tempo_sync_enabled', saved.sync_flag_storage);
}

// Build a fake SyncState that records every set() call so tests can
// inspect mid-cycle state.
function _e1c_makeStateSpy(initial) {
  let state = initial || 'ready';
  const sets = [];
  const obj = {
    get: () => state,
    set: (s) => { sets.push(s); state = s; return true; },
    canWrite: () => state === 'ready',
    isHydrating: () => state === 'hydrating',
    STORAGE_KEY: 'tempo_sync_state',
  };
  return { obj, sets, setDirect: (s) => { state = s; } };
}

// Build a minimal cloud doc as Firestore would return it: { id, data }.
function _e1c_makeCloudDoc(rec) {
  return { id: rec.id, data: rec };
}

// Build a dose entry stamped with given (deviceId, takenAt).
function _e1c_doseEntry(deviceId, takenAt) {
  return { deviceId, takenAt };
}

// Install per-test stubs: sync flag on, auth user, fake cloud
// getCollection + runTransaction. Tests override individual fields.
function _e1c_install(opts) {
  opts = opts || {};
  SyncFlag.isEnabled = () => true;
  SyncAuth.getCurrentUser = () => ({ uid: opts.uid || 'u-e1c-test', email: 't@test.com' });

  const cloudDocs = opts.cloudDocs || [];
  SyncFirestore.getCollection = async (path) => ({ docs: cloudDocs.slice(), count: cloudDocs.length });

  // Default runTransaction implementation: invokes the callback with a
  // tx shim that returns the cloud doc for `get(path)` and records
  // every `set(path, data)` into opts.txSets (if provided).
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

  // MedsManager.all: by default returns whatever was seeded via opts.
  if (opts.medsAll !== undefined) MedsManager.all = opts.medsAll;
  // snapshotForSync supplies the deviceId for "what counts as remote".
  if (opts.localDeviceId !== undefined) {
    MedsManager.snapshotForSync = () => ({
      deviceId: opts.localDeviceId,
      schemaVersion: 1,
      payload: { meds: [] },
    });
  }
  // reconcileDoseLog: passes through the real D-2 helper unless
  // explicitly mocked (test #6 swaps it in for the bypass case).
  if (opts.reconcileDoseLog !== undefined) {
    MedsManager.reconcileDoseLog = opts.reconcileDoseLog;
  }
  // onMergeComplete: spy by default so tests can observe ordering.
  opts.onMergeCalls = opts.onMergeCalls || [];
  MedsManager.onMergeComplete = (medId) => {
    // Snapshot the doseLog at call time so test #11 can assert F4 ordering.
    const allMeds = (typeof MedsManager.all === 'function') ? MedsManager.all() : [];
    const found = allMeds.find ? allMeds.find(m => m.getId && m.getId() === medId) : null;
    opts.onMergeCalls.push({
      medId,
      doseLogAtCall: found && found.getDoseLog ? found.getDoseLog() : null,
    });
  };

  // SyncState stub.
  if (opts.stateSpy) window.SyncState = opts.stateSpy.obj;
  else if (opts.syncState !== undefined) window.SyncState = opts.syncState;
  // else: leave whatever's there (or undefined)

  // Default: sync flag on in localStorage (some code paths read it).
  localStorage.setItem('tempo_sync_enabled', '1');

  return opts;
}

// Build a `local meds` array that MedsManager.all() returns. Each "med"
// is a synthetic object with the methods sync-merge-meds.js uses:
//   getState() → wire-format object
//   getId() → string
//   getDoseLog() → array (returned to onMergeComplete snapshot)
function _e1c_makeLocalMed(rec) {
  return {
    getState: () => Object.assign({}, rec, {
      doseLog: Array.isArray(rec.doseLog) ? rec.doseLog.slice() : [],
    }),
    getId: () => rec.id,
    getDoseLog: () => Array.isArray(rec.doseLog) ? rec.doseLog.slice() : [],
  };
}

// ────────────────────────────────────────────────────────────────────────
// Test cases — SyncMergeMeds.merge()
// ────────────────────────────────────────────────────────────────────────

describe('SyncMergeMeds — merge — happy path + F15 + F19a + CAS', () => {

  it('1. happy path — 1 new remote dose entry, 0 F15 emits (below threshold)', async () => {
    const saved = _e1c_savedEnv();
    const events = [];
    const onArrival = (p) => events.push(p);
    SyncEngine.on('meds-arrival', onArrival);
    try {
      const localMed = { id: 'med-1', name: 'Adderall', frequency: 'twice-daily',
                         updatedAt: 100, deviceId: 'local-dev', schemaVersion: 1,
                         doseLog: [] };
      const cloudMed = Object.assign({}, localMed, {
        updatedAt: 200,
        doseLog: [_e1c_doseEntry('phone-2', Date.now() - 60000)],
      });
      const opts = _e1c_install({
        cloudDocs: [_e1c_makeCloudDoc(cloudMed)],
        localDeviceId: 'local-dev',
        medsAll: () => [_e1c_makeLocalMed(localMed)],
      });

      const result = await SyncMergeMeds.merge(null);

      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 1, 'one record written');
      assertEqual(result.skipped, 0, 'no skips');
      assertEqual(events.length, 0, 'no meds-arrival emit (count=1 below threshold)');
      assertEqual(opts.txSets.length, 1, 'one CAS write');
    } finally {
      SyncEngine.off('meds-arrival', onArrival);
      _e1c_restore(saved);
    }
  });

  it('2. F15 fire — 2 new remote entries on 1 med → 1 meds-arrival emit', async () => {
    const saved = _e1c_savedEnv();
    const events = [];
    const onArrival = (p) => events.push(p);
    SyncEngine.on('meds-arrival', onArrival);
    try {
      const localMed = { id: 'med-1', name: 'Vyvanse', frequency: 'once-daily',
                         updatedAt: 100, deviceId: 'local-dev', schemaVersion: 1,
                         doseLog: [] };
      const now = Date.now();
      const cloudMed = Object.assign({}, localMed, {
        updatedAt: 200,
        doseLog: [
          _e1c_doseEntry('phone-2', now - 120000),
          _e1c_doseEntry('phone-2', now - 60000),
        ],
      });
      _e1c_install({
        cloudDocs: [_e1c_makeCloudDoc(cloudMed)],
        localDeviceId: 'local-dev',
        medsAll: () => [_e1c_makeLocalMed(localMed)],
      });

      const result = await SyncMergeMeds.merge(null);

      assertEqual(result.ok, true, 'ok:true');
      assertEqual(events.length, 1, 'exactly one meds-arrival emit');
      assertEqual(events[0].medId, 'med-1', 'medId in payload');
      assertEqual(events[0].count, 2, 'count = 2');
    } finally {
      SyncEngine.off('meds-arrival', onArrival);
      _e1c_restore(saved);
    }
  });

  it('3. F15 multi-med — 2 on A + 3 on B → 2 emits (per-med independence)', async () => {
    const saved = _e1c_savedEnv();
    const events = [];
    const onArrival = (p) => events.push(p);
    SyncEngine.on('meds-arrival', onArrival);
    try {
      const now = Date.now();
      const localA = { id: 'med-A', name: 'A', frequency: 'as-needed',
                       updatedAt: 1, deviceId: 'local-dev', schemaVersion: 1, doseLog: [] };
      const localB = { id: 'med-B', name: 'B', frequency: 'as-needed',
                       updatedAt: 1, deviceId: 'local-dev', schemaVersion: 1, doseLog: [] };
      const cloudA = Object.assign({}, localA, {
        updatedAt: 2,
        doseLog: [
          _e1c_doseEntry('phone-2', now - 200000),
          _e1c_doseEntry('phone-2', now - 100000),
        ],
      });
      const cloudB = Object.assign({}, localB, {
        updatedAt: 2,
        doseLog: [
          _e1c_doseEntry('phone-2', now - 300000),
          _e1c_doseEntry('phone-2', now - 200000),
          _e1c_doseEntry('phone-2', now - 100000),
        ],
      });
      _e1c_install({
        cloudDocs: [_e1c_makeCloudDoc(cloudA), _e1c_makeCloudDoc(cloudB)],
        localDeviceId: 'local-dev',
        medsAll: () => [_e1c_makeLocalMed(localA), _e1c_makeLocalMed(localB)],
      });

      await SyncMergeMeds.merge(null);

      assertEqual(events.length, 2, 'two emits — one per qualifying med');
      const byMed = {};
      for (const e of events) byMed[e.medId] = e.count;
      assertEqual(byMed['med-A'], 2, 'med-A count = 2');
      assertEqual(byMed['med-B'], 3, 'med-B count = 3');
    } finally {
      SyncEngine.off('meds-arrival', onArrival);
      _e1c_restore(saved);
    }
  });

  it('4. F15 no-fire — 1 new on A + 1 new on B → 0 emits (per-med threshold)', async () => {
    const saved = _e1c_savedEnv();
    const events = [];
    const onArrival = (p) => events.push(p);
    SyncEngine.on('meds-arrival', onArrival);
    try {
      const now = Date.now();
      const localA = { id: 'med-A', name: 'A', frequency: 'as-needed',
                       updatedAt: 1, deviceId: 'local-dev', schemaVersion: 1, doseLog: [] };
      const localB = { id: 'med-B', name: 'B', frequency: 'as-needed',
                       updatedAt: 1, deviceId: 'local-dev', schemaVersion: 1, doseLog: [] };
      const cloudA = Object.assign({}, localA, {
        updatedAt: 2,
        doseLog: [_e1c_doseEntry('phone-2', now - 100000)],
      });
      const cloudB = Object.assign({}, localB, {
        updatedAt: 2,
        doseLog: [_e1c_doseEntry('phone-2', now - 100000)],
      });
      _e1c_install({
        cloudDocs: [_e1c_makeCloudDoc(cloudA), _e1c_makeCloudDoc(cloudB)],
        localDeviceId: 'local-dev',
        medsAll: () => [_e1c_makeLocalMed(localA), _e1c_makeLocalMed(localB)],
      });

      await SyncMergeMeds.merge(null);

      assertEqual(events.length, 0,
        'aggregate=2 but per-med threshold of 2 not met on either med');
    } finally {
      SyncEngine.off('meds-arrival', onArrival);
      _e1c_restore(saved);
    }
  });

  it('5. F19a per-record pre-filter — future-schema cloud record skipped + counted', async () => {
    const saved = _e1c_savedEnv();
    try {
      const localMed = { id: 'med-current', name: 'Current', frequency: 'as-needed',
                         updatedAt: 1, deviceId: 'local-dev', schemaVersion: 1, doseLog: [] };
      const cloudCurrent = Object.assign({}, localMed, { updatedAt: 2, doseLog: [] });
      const cloudFuture = {
        id: 'med-future', name: 'FutureRecord', frequency: 'as-needed',
        updatedAt: 2, deviceId: 'phone-2', schemaVersion: 999, doseLog: [],
      };
      const opts = _e1c_install({
        cloudDocs: [_e1c_makeCloudDoc(cloudCurrent), _e1c_makeCloudDoc(cloudFuture)],
        localDeviceId: 'local-dev',
        medsAll: () => [_e1c_makeLocalMed(localMed)],
      });

      const result = await SyncMergeMeds.merge(null);

      assertEqual(result.skipped, 1, 'future-schema record counted in skipped');
      assertEqual(result.count, 1, 'only current-schema record written back');
      // CAS was called once (for the current record only).
      assertEqual(opts.txSets.length, 1, 'no CAS write attempted for future-schema');
      assertEqual(opts.txSets[0].path.indexOf('med-current') >= 0, true,
        'CAS write targeted the current-schema record');
    } finally {
      _e1c_restore(saved);
    }
  });

  it('6. F19a D-2 backup — bypassed pre-filter still refused by reconcileDoseLog', async () => {
    const saved = _e1c_savedEnv();
    try {
      // Simulate pre-filter bypass by handing a synthetic future-schema
      // med directly to MedsManager.reconcileDoseLog and asserting the
      // helper returns the existing log unchanged (D-2 per-method gate).
      const futureMed = { id: 'm', schemaVersion: 999, doseLog: [{ deviceId: 'x', takenAt: 1 }] };
      const result = MedsManager.reconcileDoseLog(futureMed, [
        { deviceId: 'phone-2', takenAt: Date.now() },
      ]);
      assertEqual(result.entries.length, 1, 'returned existing log unchanged');
      assertEqual(result.entries[0].deviceId, 'x', 'first existing entry preserved');
      assert(Array.isArray(result.warnings) && result.warnings.length > 0,
        'warnings include skip notice');
    } finally {
      _e1c_restore(saved);
    }
  });

  it('7. idempotency — 2nd merge with same cloud state produces 0 F15 emits', async () => {
    const saved = _e1c_savedEnv();
    const events = [];
    const onArrival = (p) => events.push(p);
    SyncEngine.on('meds-arrival', onArrival);
    try {
      const now = Date.now();
      const remoteEntries = [
        _e1c_doseEntry('phone-2', now - 200000),
        _e1c_doseEntry('phone-2', now - 100000),
      ];
      // Simulate idempotency: on second pass, local now contains the
      // entries that were merged in on the first pass.
      let localDoseLog = [];
      const localMed = () => ({
        id: 'med-1', name: 'M', frequency: 'as-needed',
        updatedAt: 1, deviceId: 'local-dev', schemaVersion: 1,
        doseLog: localDoseLog.slice(),
      });
      const cloudMed = {
        id: 'med-1', name: 'M', frequency: 'as-needed',
        updatedAt: 2, deviceId: 'phone-2', schemaVersion: 1,
        doseLog: remoteEntries.slice(),
      };
      _e1c_install({
        cloudDocs: [_e1c_makeCloudDoc(cloudMed)],
        localDeviceId: 'local-dev',
        medsAll: () => [_e1c_makeLocalMed(localMed())],
      });

      // Pass 1 — entries are new.
      const result1 = await SyncMergeMeds.merge(null);
      assertEqual(events.length, 1, 'first pass emits one arrival');
      assertEqual(result1.remoteArrivals['med-1'], 2, 'first pass counted 2 new');

      // Now seed local doseLog as if the writeback succeeded.
      localDoseLog = remoteEntries.slice();

      // Pass 2 — same cloud state.
      events.length = 0;
      const result2 = await SyncMergeMeds.merge(null);
      assertEqual(events.length, 0, 'second pass — 0 emits (idempotent)');
      assert(!result2.remoteArrivals['med-1'] || result2.remoteArrivals['med-1'] === 0,
        'second pass — 0 new arrivals counted');
    } finally {
      SyncEngine.off('meds-arrival', onArrival);
      _e1c_restore(saved);
    }
  });

  it('8. CAS abort on stale schemaVersion — counted in skipped, loop continues', async () => {
    const saved = _e1c_savedEnv();
    try {
      const now = Date.now();
      const localA = { id: 'med-A', name: 'A', frequency: 'as-needed',
                       updatedAt: 1, deviceId: 'local-dev', schemaVersion: 1, doseLog: [] };
      const localB = { id: 'med-B', name: 'B', frequency: 'as-needed',
                       updatedAt: 1, deviceId: 'local-dev', schemaVersion: 1, doseLog: [] };
      const cloudA = Object.assign({}, localA, { updatedAt: 2, doseLog: [] });
      const cloudB = Object.assign({}, localB, { updatedAt: 2, doseLog: [] });

      const opts = _e1c_install({
        cloudDocs: [_e1c_makeCloudDoc(cloudA), _e1c_makeCloudDoc(cloudB)],
        localDeviceId: 'local-dev',
        medsAll: () => [_e1c_makeLocalMed(localA), _e1c_makeLocalMed(localB)],
      });

      // Override runTransaction so med-A's tx.get returns a future-schema
      // remote, which triggers refuseWriteback inside the merge fn.
      SyncFirestore.runTransaction = async (fn) => {
        const tx = {
          get: async (path) => {
            if (path.indexOf('med-A') >= 0) {
              return { id: 'med-A', data: { id: 'med-A', schemaVersion: 999 } };
            }
            return null;
          },
          set: (path, data) => { opts.txSets.push({ path, data }); },
          refuseWriteback: (remote, local) => {
            const err = new Error('refuse-writeback: remote=' + remote.schemaVersion + ' local=' + local);
            err.kind = 'refuse-writeback';
            err.isRetryable = false;
            throw err;
          },
        };
        return await fn(tx);
      };

      const result = await SyncMergeMeds.merge(null);

      assertEqual(result.ok, true, 'overall result is ok despite per-record refuse');
      assertEqual(result.skipped >= 1, true, 'med-A counted in skipped');
      assertEqual(result.count, 1, 'med-B still written back');
    } finally {
      _e1c_restore(saved);
    }
  });

  it('11. F4 ordering — onMergeComplete fires AFTER doseLog reassignment', async () => {
    const saved = _e1c_savedEnv();
    try {
      const now = Date.now();
      const localMed = { id: 'med-order', name: 'OrderTest', frequency: 'as-needed',
                         updatedAt: 1, deviceId: 'local-dev', schemaVersion: 1,
                         doseLog: [] };
      const cloudMed = Object.assign({}, localMed, {
        updatedAt: 2,
        doseLog: [_e1c_doseEntry('phone-2', now - 100000)],
      });

      // Capture the doseLog seen by onMergeComplete callback.
      let observedDoseLog = null;
      let observedMergedMedDoseLog = null;
      // Use the mergedMeds doseLog directly — we instrument via the
      // _e1c_install opts.onMergeCalls path: when onMergeComplete fires,
      // we record it. We also override onMergeComplete to grab the
      // currently merged in-memory doseLog directly from the merge fn's
      // working state (which we cannot reach directly), so instead we
      // verify ordering by making reconcileDoseLog mutate a marker and
      // then assert onMergeComplete observed the post-marker state.
      let stepSeq = [];
      const realReconcile = MedsManager.reconcileDoseLog;
      MedsManager.reconcileDoseLog = (med, incoming) => {
        stepSeq.push('reconcile-called');
        const result = realReconcile.call(MedsManager, med, incoming);
        stepSeq.push('reconcile-returned');
        return result;
      };
      MedsManager.onMergeComplete = (medId) => {
        stepSeq.push('onMergeComplete:' + medId);
      };

      _e1c_install({
        cloudDocs: [_e1c_makeCloudDoc(cloudMed)],
        localDeviceId: 'local-dev',
        medsAll: () => [_e1c_makeLocalMed(localMed)],
        reconcileDoseLog: MedsManager.reconcileDoseLog,
      });
      // Restore onMergeComplete spy after _e1c_install reassigns it.
      MedsManager.onMergeComplete = (medId) => {
        stepSeq.push('onMergeComplete:' + medId);
      };

      await SyncMergeMeds.merge(null);

      // Sequence: reconcile must happen BEFORE onMergeComplete.
      const reconcileIdx = stepSeq.indexOf('reconcile-returned');
      const completeIdx = stepSeq.indexOf('onMergeComplete:med-order');
      assert(reconcileIdx >= 0, 'reconcile-returned recorded');
      assert(completeIdx >= 0, 'onMergeComplete recorded');
      assertEqual(reconcileIdx < completeIdx, true,
        'F4 ordering — onMergeComplete fires AFTER reconcileDoseLog returns');
    } finally {
      _e1c_restore(saved);
    }
  });

  it('13. CAS network error per-med — does NOT short-circuit subsequent meds', async () => {
    const saved = _e1c_savedEnv();
    try {
      const localA = { id: 'med-A', name: 'A', frequency: 'as-needed',
                       updatedAt: 1, deviceId: 'local-dev', schemaVersion: 1, doseLog: [] };
      const localB = { id: 'med-B', name: 'B', frequency: 'as-needed',
                       updatedAt: 1, deviceId: 'local-dev', schemaVersion: 1, doseLog: [] };
      const cloudA = Object.assign({}, localA, { updatedAt: 2, doseLog: [] });
      const cloudB = Object.assign({}, localB, { updatedAt: 2, doseLog: [] });

      const opts = _e1c_install({
        cloudDocs: [_e1c_makeCloudDoc(cloudA), _e1c_makeCloudDoc(cloudB)],
        localDeviceId: 'local-dev',
        medsAll: () => [_e1c_makeLocalMed(localA), _e1c_makeLocalMed(localB)],
      });

      // First call (med-A) rejects with network error; second (med-B) succeeds.
      let callCount = 0;
      SyncFirestore.runTransaction = async (fn) => {
        callCount++;
        if (callCount === 1) {
          const err = new Error('network unreachable');
          err.kind = 'network';
          err.isRetryable = true;
          throw err;
        }
        const tx = {
          get: async () => null,
          set: (path, data) => { opts.txSets.push({ path, data }); },
          refuseWriteback: () => { throw new Error('not used'); },
        };
        return await fn(tx);
      };

      const result = await SyncMergeMeds.merge(null);

      assertEqual(result.ok, true, 'overall ok despite per-record network error');
      assertEqual(callCount, 2, 'both meds attempted (no short-circuit)');
      assertEqual(result.count, 1, 'med-B written, med-A failed');
      assert(result.skipped >= 1, 'med-A counted in skipped');
      assert(result.warnings.length > 0, 'warnings carries the network error');
    } finally {
      _e1c_restore(saved);
    }
  });

  it('14. F20 forward-compat — unknown frequency value passes through pre-filter', async () => {
    const saved = _e1c_savedEnv();
    try {
      const cloudMed = {
        id: 'med-f20', name: 'F20test', frequency: 'three-times-daily',
        updatedAt: 2, deviceId: 'phone-2', schemaVersion: 1, doseLog: [],
      };
      const opts = _e1c_install({
        cloudDocs: [_e1c_makeCloudDoc(cloudMed)],
        localDeviceId: 'local-dev',
        medsAll: () => [],
      });

      const result = await SyncMergeMeds.merge(null);

      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.skipped, 0,
        'current-schema record with unknown frequency NOT skipped');
      assertEqual(result.count, 1, 'record written back');
      // Verify the unknown frequency survived in the wire-format payload
      // handed to tx.set.
      assertEqual(opts.txSets.length, 1, 'CAS write attempted');
      assertEqual(opts.txSets[0].data.frequency, 'three-times-daily',
        'unknown frequency preserved verbatim through merge');
    } finally {
      _e1c_restore(saved);
    }
  });

  it('15. empty cloud — no docs → ok: true, count: 0, no events, no transactions', async () => {
    const saved = _e1c_savedEnv();
    const events = [];
    const onArrival = (p) => events.push(p);
    SyncEngine.on('meds-arrival', onArrival);
    try {
      const opts = _e1c_install({
        cloudDocs: [],
        localDeviceId: 'local-dev',
        medsAll: () => [],
      });

      const result = await SyncMergeMeds.merge(null);

      assertEqual(result.ok, true, 'ok:true on empty cloud + empty local');
      assertEqual(result.count, 0, 'count = 0');
      assertEqual(result.skipped, 0, 'skipped = 0');
      assertEqual(events.length, 0, 'no meds-arrival emit');
      assertEqual(opts.txSets.length, 0, 'no CAS writes attempted');
    } finally {
      SyncEngine.off('meds-arrival', onArrival);
      _e1c_restore(saved);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// F13 dispatcher-wide gate flip — exercised through SyncEngine._runMergeCycle
// ────────────────────────────────────────────────────────────────────────

describe('SyncMergeMeds — F13 dispatcher-wide write gate', () => {

  it('9. SyncState.canWrite() returns false mid-cycle (during merge fn execution)', async () => {
    const saved = _e1c_savedEnv();
    const stateSpy = _e1c_makeStateSpy('ready');
    // Capture canWrite() values seen by an in-merge probe.
    let canWriteDuringMerge = null;
    let stateDuringMerge = null;

    // Save + override the four merge modules; only meds runs a probe,
    // the others throw to keep behavior parallel to E-1b tests.
    const savedMerges = {
      meds: SyncMergeMeds.merge,
      history: SyncMergeHistory.merge,
      rest_log: SyncMergeRestLog.merge,
      presets: SyncMergePresets.merge,
      bfrb_events: SyncMergeBfrb.merge,
      distractions: SyncMergeDistractions.merge,
      mood_events: SyncMergeMood.merge,
    };

    try {
      // Set preconditions for _runMergeCycle (sync flag on, signed in).
      localStorage.setItem('tempo_sync_enabled', '1');
      SyncFlag.isEnabled = () => true;
      SyncAuth.getCurrentUser = () => ({ uid: 'u-f13' });
      window.SyncState = stateSpy.obj;

      // Probe merge fn — captures state mid-cycle.
      SyncMergeMeds.merge = function () {
        stateDuringMerge = stateSpy.obj.get();
        canWriteDuringMerge = stateSpy.obj.canWrite();
        return Promise.resolve({ ok: true, count: 0, skipped: 0,
                                 remoteArrivals: {}, warnings: [] });
      };
      // Other stubs no-op.
      SyncMergeHistory.merge = () => ({ ok: false });
      SyncMergeRestLog.merge = () => ({ ok: false });
      SyncMergePresets.merge = () => ({ ok: false });
      SyncMergeBfrb.merge = () => ({ ok: true });
      SyncMergeDistractions.merge = () => ({ ok: true });
      SyncMergeMood.merge = () => ({ ok: true });

      // Wait for cycle to complete.
      const completeP = new Promise((resolve) => {
        const cb = () => { SyncEngine.off('merge-cycle-complete', cb); resolve(); };
        SyncEngine.on('merge-cycle-complete', cb);
      });

      SyncEngine._runMergeCycle();
      await completeP;

      assertEqual(stateDuringMerge, 'hydrating',
        'F13: SyncState is hydrating during merge fn execution');
      assertEqual(canWriteDuringMerge, false,
        'F13: SyncState.canWrite() returns false mid-cycle');
    } finally {
      SyncMergeMeds.merge = savedMerges.meds;
      SyncMergeHistory.merge = savedMerges.history;
      SyncMergeRestLog.merge = savedMerges.rest_log;
      SyncMergePresets.merge = savedMerges.presets;
      SyncMergeBfrb.merge = savedMerges.bfrb_events;
      SyncMergeDistractions.merge = savedMerges.distractions;
      SyncMergeMood.merge = savedMerges.mood_events;
      _e1c_restore(saved);
    }
  });

  it('10a. SyncState returns to "ready" after a successful cycle', async () => {
    const saved = _e1c_savedEnv();
    const stateSpy = _e1c_makeStateSpy('ready');
    const savedMerges = {
      meds: SyncMergeMeds.merge,
      history: SyncMergeHistory.merge,
      rest_log: SyncMergeRestLog.merge,
      presets: SyncMergePresets.merge,
      bfrb_events: SyncMergeBfrb.merge,
      distractions: SyncMergeDistractions.merge,
      mood_events: SyncMergeMood.merge,
    };

    try {
      localStorage.setItem('tempo_sync_enabled', '1');
      SyncFlag.isEnabled = () => true;
      SyncAuth.getCurrentUser = () => ({ uid: 'u-f13' });
      window.SyncState = stateSpy.obj;

      // All six merges sync no-op so the cycle finalizes immediately.
      SyncMergeMeds.merge = () => ({ ok: true });
      SyncMergeHistory.merge = () => ({ ok: true });
      SyncMergeRestLog.merge = () => ({ ok: true });
      SyncMergePresets.merge = () => ({ ok: true });
      SyncMergeBfrb.merge = () => ({ ok: true });
      SyncMergeDistractions.merge = () => ({ ok: true });
      SyncMergeMood.merge = () => ({ ok: true });

      SyncEngine._runMergeCycle();

      assertEqual(stateSpy.obj.get(), 'ready',
        'SyncState restored to ready after sync cycle finalizes');
      // Verify the flip-and-restore sequence happened.
      assert(stateSpy.sets.indexOf('hydrating') >= 0,
        'state was flipped to hydrating during the cycle');
      assertEqual(stateSpy.sets[stateSpy.sets.length - 1], 'ready',
        'last state set call is ready');
    } finally {
      SyncMergeMeds.merge = savedMerges.meds;
      SyncMergeHistory.merge = savedMerges.history;
      SyncMergeRestLog.merge = savedMerges.rest_log;
      SyncMergePresets.merge = savedMerges.presets;
      SyncMergeBfrb.merge = savedMerges.bfrb_events;
      SyncMergeDistractions.merge = savedMerges.distractions;
      SyncMergeMood.merge = savedMerges.mood_events;
      _e1c_restore(saved);
    }
  });

  it('10b. SyncState returns to "ready" even when every merge throws (Risk #1 — try/finally)', async () => {
    const saved = _e1c_savedEnv();
    const stateSpy = _e1c_makeStateSpy('ready');
    const savedMerges = {
      meds: SyncMergeMeds.merge,
      history: SyncMergeHistory.merge,
      rest_log: SyncMergeRestLog.merge,
      presets: SyncMergePresets.merge,
      bfrb_events: SyncMergeBfrb.merge,
      distractions: SyncMergeDistractions.merge,
      mood_events: SyncMergeMood.merge,
    };

    try {
      localStorage.setItem('tempo_sync_enabled', '1');
      SyncFlag.isEnabled = () => true;
      SyncAuth.getCurrentUser = () => ({ uid: 'u-f13' });
      window.SyncState = stateSpy.obj;

      // Make each merge throw a non-Error value (Risk #1 specifically
      // calls out non-Error throws in the loop body).
      SyncMergeMeds.merge = function () { throw 'string-throw-meds'; };
      SyncMergeHistory.merge = function () { throw { weird: true }; };
      SyncMergeRestLog.merge = function () { throw null; };
      SyncMergePresets.merge = function () { throw new Error('stub'); };
      SyncMergeBfrb.merge = function () { throw 'string-throw-bfrb'; };
      SyncMergeDistractions.merge = function () { throw 'string-throw-distractions'; };
      SyncMergeMood.merge = function () { throw 'string-throw-mood'; };

      SyncEngine._runMergeCycle();

      assertEqual(stateSpy.obj.get(), 'ready',
        'SyncState restored to ready even after every merge throws');
    } finally {
      SyncMergeMeds.merge = savedMerges.meds;
      SyncMergeHistory.merge = savedMerges.history;
      SyncMergeRestLog.merge = savedMerges.rest_log;
      SyncMergePresets.merge = savedMerges.presets;
      SyncMergeBfrb.merge = savedMerges.bfrb_events;
      SyncMergeDistractions.merge = savedMerges.distractions;
      SyncMergeMood.merge = savedMerges.mood_events;
      _e1c_restore(saved);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// D-1 reconcile retrofit — reconcileImportedBucket calls reconcileDoseLog
// per merged med so cross-device duplicates collapse via F1.
// ────────────────────────────────────────────────────────────────────────

describe('SyncMergeMeds — D-1 reconcile retrofit (E-1c TODO #4 Pick A)', () => {

  it('12. reconcileDoseLog is invoked per merged med — cross-device pair within 15min collapses via F1', async () => {
    // Mirrors D-1's retrofit invocation shape: pass the local doseLog as
    // `med.doseLog` and the cloud-side entries (from _mergeMeds union) as
    // `incomingEntries`. The helper unions them, F16-clamps cross-device
    // far-out entries, dedups exact (deviceId, takenAt) matches, then F1
    // collapses cross-device pairs within RECONCILE_WINDOW_MS.
    const now = Date.now();
    const med = {
      id: 'med-d1-retrofit',
      schemaVersion: 1,
      doseLog: [
        { deviceId: 'device-A', takenAt: now - 60000 },  // local: -1 min
      ],
    };
    const incomingEntries = [
      { deviceId: 'device-B', takenAt: now - 55000 },    // cloud: -55s (5s after A, cross-device)
    ];
    const result = MedsManager.reconcileDoseLog(med, incomingEntries);

    // Union = 2 entries. Both within F16 window (≤15min from now).
    // No exact-match dedup (different deviceIds). Sort: A then B.
    // F1 walk: delta 5000ms < 15min, cross-device → drop B, collapsed=1.
    // Final: [A@-60s]. The D-1 retrofit's call site does exactly this
    // per-merged-med inside reconcileImportedBucket's mergedMeds loop.
    assertEqual(result.entries.length, 1,
      'cross-device pair within 15min collapsed (2 → 1)');
    assert(result.collapsed >= 1, 'collapsed counter incremented');
  });
});

// ────────────────────────────────────────────────────────────────────────
// H4 — cloud→local writeback for meds. The merge reconciles each doseLog onto
// a throwaway getState() SNAPSHOT, so before this fix the reconciled cross-
// device doses reached the cloud but never the LIVE med (onMergeComplete
// recomputed lastTakenAt from the stale live log). These tests use a REAL
// MedsManager.add()ed med (so MedsManager.get(medId) resolves the live record)
// and assert the merged doseLog lands on the live med + is persisted to disk.
// Timestamps are spaced > RECONCILE_WINDOW_MS apart so F1 doesn't collapse the
// pair, and the cloud dose is recent so F16 doesn't clamp it.
// ────────────────────────────────────────────────────────────────────────
describe('SyncMergeMeds — H4 cloud→local doseLog writeback (live med)', () => {

  function _clearMedsLocalStorage() {
    const stale = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf('meds/') === 0) stale.push(k);
    }
    stale.forEach(k => localStorage.removeItem(k));
  }

  it('applies the reconciled cross-device dose to the LIVE med + persists it', async () => {
    const saved = _e1c_savedEnv();
    // Use the real MedsManager (no medsAll override) so get(medId) resolves.
    delete window.SyncState;           // ungated: add()/direct writes proceed
    MedsManager.clear();
    _clearMedsLocalStorage();
    try {
      const now = Date.now();
      const localTime = now - 2 * 3600000; // 2h ago, SAME device (F16 exempt)
      const cloudTime = now - 60000;       // 60s ago, cross-device (within F16 window)

      const med = MedsManager.add({ name: 'Vyvanse', dose: '60 mg', frequency: 'once-daily' });
      med.logDose(localTime);
      const medId = med.getId();

      // Cloud record: same med id, doseLog carries ONLY the cross-device dose.
      const cloudRec = Object.assign({}, med.getState(), {
        doseLog: [_e1c_doseEntry('phone-2', cloudTime)],
      });
      _e1c_install({
        cloudDocs: [_e1c_makeCloudDoc(cloudRec)],
        localDeviceId: med.getDeviceId(),
      });

      // Precondition: live med has only the local dose.
      assertEqual(MedsManager.get(medId).getDoseLog().length, 1,
        'precondition — live med has only the local dose');

      const result = await SyncMergeMeds.merge(null);
      assertEqual(result.ok, true, 'ok:true');

      // The reconciled doseLog (local ∪ cloud) is now on the LIVE med.
      const log = MedsManager.get(medId).getDoseLog();
      assertEqual(log.length, 2, 'live med now carries local + cloud-origin dose (H4)');
      assert(log.some(e => e.deviceId === 'phone-2' && e.takenAt === cloudTime),
        'cloud-origin dose applied to the LIVE med');
      assert(log.some(e => e.takenAt === localTime),
        'local dose preserved');
      assertEqual(MedsManager.get(medId).getLastTakenAt(), cloudTime,
        'lastTakenAt re-derived from the merged tail (the newer cross-device dose)');

      // ...and persisted to the per-record meds/{id} key (direct write, gate-bypassing).
      const onDisk = JSON.parse(localStorage.getItem('meds/' + medId));
      assert(onDisk && Array.isArray(onDisk.doseLog), 'meds/{id} persisted');
      assertEqual(onDisk.doseLog.length, 2, 'merged doseLog persisted to disk');
    } finally {
      MedsManager.clear();
      _clearMedsLocalStorage();
      _e1c_restore(saved);
    }
  });

  it('leaves a future-schema live med untouched (no doseLog clobber)', async () => {
    const saved = _e1c_savedEnv();
    delete window.SyncState;
    MedsManager.clear();
    _clearMedsLocalStorage();
    try {
      const now = Date.now();
      const med = MedsManager.add({ name: 'Strattera', frequency: 'as-needed' });
      med.logDose(now - 2 * 3600000);
      const medId = med.getId();
      // Force the live med into future-schema state via loadState.
      const future = Object.assign({}, med.getState(), { schemaVersion: 999 });
      med.loadState(future);
      assertEqual(med.isFromFutureSchema(), true, 'precondition — live med is future-schema');
      const beforeLen = med.getDoseLog().length;

      const cloudRec = Object.assign({}, med.getState(), {
        schemaVersion: 1,
        doseLog: [_e1c_doseEntry('phone-2', now - 60000)],
      });
      _e1c_install({
        cloudDocs: [_e1c_makeCloudDoc(cloudRec)],
        localDeviceId: med.getDeviceId(),
      });

      await SyncMergeMeds.merge(null);

      // applyMergedDoseLog must skip future-schema meds — doseLog unchanged.
      assertEqual(MedsManager.get(medId).getDoseLog().length, beforeLen,
        'future-schema live med doseLog left untouched');
    } finally {
      MedsManager.clear();
      _clearMedsLocalStorage();
      _e1c_restore(saved);
    }
  });

});

// ── T6 / C1 (audit AUDIT-2026-06-13 :227 / :168) ──────────────────────────
// The F15 arrival count is read from the POST-F1-collapse doseLog, NOT the
// raw incoming entries. F1 (MedsManager.reconcileDoseLog) collapses
// CROSS-device doses that fall within RECONCILE_WINDOW_MS (±15min) into one
// physical dose — the designed-for case being a single real dose logged on
// two devices before sync propagated. Because the counter
// (sync-merge-meds.js:291-300) runs AFTER that collapse, two genuinely
// distinct cross-device doses inside the window count as ONE arrival and can
// drop below the ≥2 `meds-arrival` toast threshold (audit C1's "undercount").
//
// This is ACCEPTED as working-as-designed (the count means "distinct doses
// MERGED", not "entries received"): counting raw arrivals would make the
// toast announce "2 doses arrived" for the COMMON one-dose-double-logged
// case — trading a rare under-report for a common over-report. This test pins
// the behavior so a future change to the counting loop (or to F1) fails here.
//
// Contrast — test #2 above ("F15 fire") seeds two close timestamps from ONE
// device → F1 preserves same-device re-doses (meds.js:900) → count 2 → toast
// fires. The ONLY difference below is two distinct deviceIds, which is what
// flips F1 from preserve to collapse.
describe('SyncMergeMeds — F15 arrival count is post-F1-collapse (T6 / C1)', () => {

  it('two cross-device doses within ±15min collapse to one → count 1 → no meds-arrival toast', async () => {
    const saved = _e1c_savedEnv();
    const events = [];
    const onArrival = (p) => events.push(p);
    SyncEngine.on('meds-arrival', onArrival);
    try {
      const now = Date.now();
      // Local has no prior doses; cloud metadata wins LWW (updatedAt 200 > 100)
      // and carries two doses from TWO DIFFERENT remote devices, 5 min apart
      // (≤ 15min F1 window) and both recent (≤ 15min from now, so F16's
      // clock-skew clamp keeps them rather than dropping them).
      const localMed = { id: 'med-1', name: 'Vyvanse', frequency: 'once-daily',
                         updatedAt: 100, deviceId: 'local-dev', schemaVersion: 1,
                         doseLog: [] };
      const cloudMed = Object.assign({}, localMed, {
        updatedAt: 200,
        doseLog: [
          _e1c_doseEntry('phone-2', now - 600000),  // device A — 10 min ago (earliest → survives)
          _e1c_doseEntry('phone-3', now - 300000),  // device B —  5 min ago (collapses into A)
        ],
      });
      const opts = _e1c_install({
        cloudDocs: [_e1c_makeCloudDoc(cloudMed)],
        localDeviceId: 'local-dev',
        medsAll: () => [_e1c_makeLocalMed(localMed)],
      });

      const result = await SyncMergeMeds.merge(null);

      assertEqual(result.ok, true, 'ok:true');
      // Two distinct remote doses arrived, but F1 collapsed device-B's into
      // device-A's → only ONE survives → only ONE arrival is counted.
      assertEqual(result.remoteArrivals['med-1'], 1,
        'cross-device pair collapsed → undercounted to 1 (the intended merged-truth count)');
      assertEqual(events.length, 0,
        'count 1 < the ≥2 threshold → arrival toast intentionally suppressed');
      // The merged record still writes back (one collapsed dose).
      assertEqual(result.count, 1, 'one record written');
      assertEqual(opts.txSets.length, 1, 'one CAS write');
    } finally {
      SyncEngine.off('meds-arrival', onArrival);
      _e1c_restore(saved);
    }
  });

});
