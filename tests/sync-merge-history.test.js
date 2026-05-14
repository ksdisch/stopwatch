// E-1d — SyncMergeHistory.merge() — sessions append-merge + record-level
// LWW + phaseLog dedup + F19a per-record pre-filter + F13 dispatcher gate
// inheritance.
//
// Coverage (per E-1d-AUDIT.md § "Test scope"):
//   1.  Happy path — 1 new cloud session merged in, written back
//   2.  Cloud-wins on id collision (F2 + LWW tie-break per D-1 precedent)
//   3.  note LWW — record-level (cloud newer wins; local newer wins)
//   4.  tags LWW — record-level (same pattern as note)
//   5.  phaseLog dedup by (deviceId, phaseStartedAt) per F6 + legacy fallback
//   6.  F19a per-record pre-filter — future-schema skipped + counted
//   7.  F13 write gate during cycle — SyncState.canWrite() false mid-cycle
//   8.  F13 gate releases — SyncState restored to 'ready' after cycle
//   9.  Idempotency — 2nd merge with same cloud state → 0 net new on-disk
//   10. CAS abort tolerance — refuse-writeback counted in skipped, loop continues
//   11. Empty cloud — 0 docs → ok:true, count:<local>, no skips
//   12. Large cloud snapshot — 50+ sessions processed without error
//   13. SYNC_DISABLED fast-path — no fetch, no writes
//   14. Unauthenticated — no user → ok:false, kind:'unauthenticated'
//   15. Mixed session types — pomodoro+stopwatch+flow merge without crash
//
// Mocking pattern: SyncFirestore + SyncAuth methods are hot-swapped on
// the real modules. `window.History` is fully stubbed per-test (history.js
// is NOT loaded in tests/index.html — same pattern as analytics.test.js /
// export.test.js / sync-merge-meds.test.js handle MedsManager).

// ── Shared save/restore + install helpers ─────────────────────────────

function _e1d_savedEnv() {
  return {
    flag_enabled: SyncFlag.isEnabled,
    auth_getCurrentUser: SyncAuth.getCurrentUser,
    fs_getCollection: SyncFirestore.getCollection,
    fs_runTransaction: SyncFirestore.runTransaction,
    history: window.History,
    syncState: window.SyncState,
    sync_flag_storage: localStorage.getItem('tempo_sync_enabled'),
  };
}

function _e1d_restore(saved) {
  SyncFlag.isEnabled = saved.flag_enabled;
  SyncAuth.getCurrentUser = saved.auth_getCurrentUser;
  SyncFirestore.getCollection = saved.fs_getCollection;
  SyncFirestore.runTransaction = saved.fs_runTransaction;
  if (saved.history === undefined) delete window.History;
  else window.History = saved.history;
  if (saved.syncState === undefined) delete window.SyncState;
  else window.SyncState = saved.syncState;
  if (saved.sync_flag_storage === null) localStorage.removeItem('tempo_sync_enabled');
  else localStorage.setItem('tempo_sync_enabled', saved.sync_flag_storage);
}

// Build a fake SyncState that records every set() call so tests can
// inspect mid-cycle state. Mirrors _e1c_makeStateSpy verbatim.
function _e1d_makeStateSpy(initial) {
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
function _e1d_makeCloudDoc(rec) {
  return { id: rec.id, data: rec };
}

// Build a minimal session record. Callers override fields as needed.
function _e1d_makeSession(overrides) {
  return Object.assign({
    id: 'sess-default',
    type: 'stopwatch',
    date: '2026-05-14T00:00:00.000Z',
    duration: 60000,
    laps: [],
    note: '',
    tags: [],
    deviceId: 'local-dev',
    updatedAt: 100,
    schemaVersion: 1,
    bucket: 'synced',
  }, overrides || {});
}

// Install per-test stubs: sync flag on, auth user, fake cloud
// getCollection + runTransaction, stubbed History. Tests override
// individual fields.
function _e1d_install(opts) {
  opts = opts || {};
  SyncFlag.isEnabled = () => true;
  SyncAuth.getCurrentUser = () => ({ uid: opts.uid || 'u-e1d-test', email: 't@test.com' });

  const cloudDocs = opts.cloudDocs || [];
  SyncFirestore.getCollection = opts.getCollection || (async (path) => ({
    docs: cloudDocs.slice(),
    count: cloudDocs.length,
  }));

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

  // History stub. getSessions returns whatever was seeded via opts;
  // getDeviceId returns the local deviceId.
  const localSessions = Array.isArray(opts.localSessions) ? opts.localSessions : [];
  const localDeviceId = opts.localDeviceId || 'local-dev';
  window.History = {
    getSessions: async () => localSessions.slice(),
    getDeviceId: () => localDeviceId,
  };

  // SyncState stub.
  if (opts.stateSpy) window.SyncState = opts.stateSpy.obj;
  else if (opts.syncState !== undefined) window.SyncState = opts.syncState;

  // Default: sync flag on in localStorage (some code paths read it).
  localStorage.setItem('tempo_sync_enabled', '1');

  return opts;
}

// ────────────────────────────────────────────────────────────────────────
// Test cases — SyncMergeHistory.merge()
// ────────────────────────────────────────────────────────────────────────

describe('SyncMergeHistory — merge — happy path + LWW + F19a + CAS', () => {

  it('1. happy path — sessions append-merge by id (1 new cloud + 2 local → 3 writes)', async () => {
    const saved = _e1d_savedEnv();
    try {
      const localA = _e1d_makeSession({ id: 'dev-A-1', note: 'A1', updatedAt: 100 });
      const localB = _e1d_makeSession({ id: 'dev-A-2', note: 'A2', updatedAt: 100 });
      const cloudC = _e1d_makeSession({ id: 'dev-B-1', deviceId: 'phone-2',
                                        note: 'B1', updatedAt: 200 });
      const opts = _e1d_install({
        cloudDocs: [_e1d_makeCloudDoc(cloudC)],
        localSessions: [localA, localB],
      });

      const result = await SyncMergeHistory.merge(null);

      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 3, 'three records written back');
      assertEqual(result.skipped, 0, 'no skips');
      // F15 NOT fired for sessions (Pick B on TODO #4).
      assertEqual(Object.keys(result.remoteArrivals).length, 0,
        'remoteArrivals is empty — F15 skipped for sessions');
      assertEqual(opts.txSets.length, 3, 'three CAS writes');
    } finally {
      _e1d_restore(saved);
    }
  });

  it('2. cloud-wins on id collision (F2 + LWW tie-break per D-1 precedent)', async () => {
    const saved = _e1d_savedEnv();
    try {
      const local = _e1d_makeSession({ id: 's-1', note: 'local',
                                       deviceId: 'local-dev', updatedAt: 100 });
      const cloud = _e1d_makeSession({ id: 's-1', note: 'cloud',
                                       deviceId: 'phone-2', updatedAt: 100 });
      const opts = _e1d_install({
        cloudDocs: [_e1d_makeCloudDoc(cloud)],
        localSessions: [local],
      });

      await SyncMergeHistory.merge(null);

      assertEqual(opts.txSets.length, 1, 'one CAS write');
      assertEqual(opts.txSets[0].data.note, 'cloud',
        'cloud wins on cloudAt >= localAt tie');
      assertEqual(opts.txSets[0].data.deviceId, 'phone-2',
        'cloud record body lands wholesale');
    } finally {
      _e1d_restore(saved);
    }
  });

  it('3. note LWW (record-level) — cloud newer wins, local newer wins', async () => {
    // 3a — cloud's higher updatedAt wins on the WHOLE record (note + tags + body).
    const saved1 = _e1d_savedEnv();
    try {
      const local = _e1d_makeSession({ id: 's-3a', note: 'local-stale',
                                       tags: ['l'], updatedAt: 100 });
      const cloud = _e1d_makeSession({ id: 's-3a', note: 'cloud-fresh',
                                       tags: ['c'], updatedAt: 200 });
      const opts = _e1d_install({
        cloudDocs: [_e1d_makeCloudDoc(cloud)],
        localSessions: [local],
      });
      await SyncMergeHistory.merge(null);
      assertEqual(opts.txSets[0].data.note, 'cloud-fresh', '3a: cloud note wins');
      assertArrayEqual(opts.txSets[0].data.tags, ['c'],
        '3a: cloud tags win (record-level LWW)');
    } finally {
      _e1d_restore(saved1);
    }

    // 3b — local's higher updatedAt wins on the WHOLE record.
    const saved2 = _e1d_savedEnv();
    try {
      const local = _e1d_makeSession({ id: 's-3b', note: 'local-fresh',
                                       tags: ['l'], updatedAt: 200 });
      const cloud = _e1d_makeSession({ id: 's-3b', note: 'cloud-stale',
                                       tags: ['c'], updatedAt: 100 });
      const opts = _e1d_install({
        cloudDocs: [_e1d_makeCloudDoc(cloud)],
        localSessions: [local],
      });
      await SyncMergeHistory.merge(null);
      assertEqual(opts.txSets[0].data.note, 'local-fresh', '3b: local note wins');
      assertArrayEqual(opts.txSets[0].data.tags, ['l'],
        '3b: local tags win (record-level LWW)');
    } finally {
      _e1d_restore(saved2);
    }
  });

  it('4. tags LWW (record-level, same pattern as note)', async () => {
    // Asserts the entire tags array is replaced wholesale — NOT per-tag
    // union. Documents the TODO #2 deferred per-field stamping behavior.
    const saved = _e1d_savedEnv();
    try {
      const local = _e1d_makeSession({ id: 's-4', note: 'l',
                                       tags: ['local-tag', 'shared'], updatedAt: 100 });
      const cloud = _e1d_makeSession({ id: 's-4', note: 'c',
                                       tags: ['cloud-tag'], updatedAt: 200 });
      const opts = _e1d_install({
        cloudDocs: [_e1d_makeCloudDoc(cloud)],
        localSessions: [local],
      });
      await SyncMergeHistory.merge(null);
      assertArrayEqual(opts.txSets[0].data.tags, ['cloud-tag'],
        'cloud tags array replaces local wholesale (NOT a per-tag union)');
    } finally {
      _e1d_restore(saved);
    }
  });

  it('5. phaseLog dedup by (deviceId, phaseStartedAt) per F6 + legacy fallback', async () => {
    const saved = _e1d_savedEnv();
    try {
      // Local pomodoro session with 2 phaseLog entries.
      const local = _e1d_makeSession({
        id: 's-pomo-5',
        type: 'pomodoro',
        updatedAt: 100,
        phaseLog: [
          { deviceId: 'dev-A', phaseStartedAt: 1000, phase: 'work' },
          { deviceId: 'dev-A', phaseStartedAt: 2000, phase: 'shortBreak' },
        ],
      });
      // Cloud version of same session: 1 dup (dev-A@2000) + 1 new (dev-B@3000).
      const cloud = _e1d_makeSession({
        id: 's-pomo-5',
        type: 'pomodoro',
        updatedAt: 200, // cloud wins LWW
        phaseLog: [
          { deviceId: 'dev-A', phaseStartedAt: 2000, phase: 'shortBreak' },
          { deviceId: 'dev-B', phaseStartedAt: 3000, phase: 'work' },
        ],
      });
      const opts = _e1d_install({
        cloudDocs: [_e1d_makeCloudDoc(cloud)],
        localSessions: [local],
      });

      await SyncMergeHistory.merge(null);

      const written = opts.txSets[0].data;
      assertEqual(written.phaseLog.length, 3,
        'phaseLog deduped: 2 + 2 - 1 dup = 3');
      // Verify order by phaseStartedAt.
      assertEqual(written.phaseLog[0].phaseStartedAt, 1000, 'order: 1000 first');
      assertEqual(written.phaseLog[1].phaseStartedAt, 2000, 'order: 2000 next');
      assertEqual(written.phaseLog[2].phaseStartedAt, 3000, 'order: 3000 last');
      // Verify the new cross-device entry survived.
      assertEqual(written.phaseLog[2].deviceId, 'dev-B',
        'new dev-B entry preserved');
    } finally {
      _e1d_restore(saved);
    }
  });

  it('5b. legacy phaseLog entries (no deviceId) survive verbatim — F19b spirit', async () => {
    const saved = _e1d_savedEnv();
    try {
      const local = _e1d_makeSession({
        id: 's-pomo-5b',
        type: 'pomodoro',
        updatedAt: 100,
        phaseLog: [
          { phaseStartedAt: 1000, phase: 'work' }, // legacy — no deviceId
        ],
      });
      const cloud = _e1d_makeSession({
        id: 's-pomo-5b',
        type: 'pomodoro',
        updatedAt: 200,
        phaseLog: [
          { phaseStartedAt: 1000, phase: 'work' }, // legacy — no deviceId — dup
          { deviceId: 'dev-B', phaseStartedAt: 2000, phase: 'shortBreak' },
        ],
      });
      const opts = _e1d_install({
        cloudDocs: [_e1d_makeCloudDoc(cloud)],
        localSessions: [local],
      });

      await SyncMergeHistory.merge(null);

      const written = opts.txSets[0].data;
      // Legacy fallback: both legacy entries use sig '∅@1000' → 1 kept.
      // Plus the new dev-B@2000 entry → 2 total.
      assertEqual(written.phaseLog.length, 2,
        'legacy entries dedup by phaseStartedAt-only fallback');
    } finally {
      _e1d_restore(saved);
    }
  });

  it('6. F19a per-record pre-filter — future-schema skipped + counted', async () => {
    const saved = _e1d_savedEnv();
    try {
      const cloudCurrent = _e1d_makeSession({
        id: 's-current', deviceId: 'phone-2', updatedAt: 200,
      });
      const cloudFuture = _e1d_makeSession({
        id: 's-future', deviceId: 'phone-2', updatedAt: 200,
        schemaVersion: 999,
      });
      const opts = _e1d_install({
        cloudDocs: [_e1d_makeCloudDoc(cloudCurrent), _e1d_makeCloudDoc(cloudFuture)],
        localSessions: [],
      });

      const result = await SyncMergeHistory.merge(null);

      assertEqual(result.skipped, 1, 'future-schema record counted in skipped');
      assertEqual(result.count, 1, 'only current-schema record written back');
      assertEqual(opts.txSets.length, 1, 'no CAS write attempted for future-schema');
      assertEqual(opts.txSets[0].path.indexOf('s-current') >= 0, true,
        'CAS targeted the current-schema record');
    } finally {
      _e1d_restore(saved);
    }
  });

  it('9. idempotency — 2nd merge with same cloud state writes byte-identical records', async () => {
    const saved = _e1d_savedEnv();
    try {
      const session = _e1d_makeSession({
        id: 's-idem', deviceId: 'phone-2', updatedAt: 200, note: 'remote-note',
      });
      const opts = _e1d_install({
        cloudDocs: [_e1d_makeCloudDoc(session)],
        localSessions: [],
      });

      // Pass 1 — session lands.
      const r1 = await SyncMergeHistory.merge(null);
      assertEqual(r1.count, 1, 'pass 1: 1 write');
      const firstWrite = JSON.stringify(opts.txSets[0].data);

      // Reset txSets; seed local with the now-merged session.
      opts.txSets.length = 0;
      window.History = {
        getSessions: async () => [JSON.parse(JSON.stringify(session))],
        getDeviceId: () => 'local-dev',
      };

      // Pass 2 — same cloud state.
      const r2 = await SyncMergeHistory.merge(null);
      assertEqual(r2.count, 1, 'pass 2: 1 write (still CAS-attempted)');
      const secondWrite = JSON.stringify(opts.txSets[0].data);
      assertEqual(secondWrite, firstWrite,
        'byte-identical writeback — no LWW thrash');
      // F15 not fired either run.
      assertEqual(Object.keys(r1.remoteArrivals).length, 0, 'pass 1: no F15');
      assertEqual(Object.keys(r2.remoteArrivals).length, 0, 'pass 2: no F15');
    } finally {
      _e1d_restore(saved);
    }
  });

  it('10. CAS abort tolerance — refuse-writeback counted in skipped, loop continues', async () => {
    const saved = _e1d_savedEnv();
    try {
      const cloudA = _e1d_makeSession({ id: 'sess-A', deviceId: 'phone-2', updatedAt: 200 });
      const cloudB = _e1d_makeSession({ id: 'sess-B', deviceId: 'phone-2', updatedAt: 200 });
      const opts = _e1d_install({
        cloudDocs: [_e1d_makeCloudDoc(cloudA), _e1d_makeCloudDoc(cloudB)],
        localSessions: [],
      });

      // Override runTransaction: session #1's tx.get returns a
      // future-schema remote, triggering refuseWriteback. Session #2
      // succeeds normally.
      SyncFirestore.runTransaction = async (fn) => {
        const tx = {
          get: async (path) => {
            if (path.indexOf('sess-A') >= 0) {
              return { id: 'sess-A', data: { id: 'sess-A', schemaVersion: 999 } };
            }
            return null;
          },
          set: (path, data) => { opts.txSets.push({ path, data }); },
          refuseWriteback: (remote, local) => {
            const err = new Error('refuse-writeback: remote=' + remote.schemaVersion
                                  + ' local=' + local);
            err.kind = 'refuse-writeback';
            err.isRetryable = false;
            throw err;
          },
        };
        return await fn(tx);
      };

      const result = await SyncMergeHistory.merge(null);

      assertEqual(result.ok, true, 'overall ok despite per-record refuse');
      assert(result.skipped >= 1, 'sess-A counted in skipped');
      assertEqual(result.count, 1, 'sess-B still written');
      assert(result.warnings.length > 0, 'warnings carries the rejection');
    } finally {
      _e1d_restore(saved);
    }
  });

  it('11. empty cloud — no docs → ok:true, count=<local>, no skips', async () => {
    const saved = _e1d_savedEnv();
    try {
      const local1 = _e1d_makeSession({ id: 'l-1' });
      const local2 = _e1d_makeSession({ id: 'l-2' });
      const opts = _e1d_install({
        cloudDocs: [],
        localSessions: [local1, local2],
      });

      const result = await SyncMergeHistory.merge(null);

      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 2, 'both local sessions pushed to cloud');
      assertEqual(result.skipped, 0, 'no skips');
      assertEqual(opts.txSets.length, 2, 'two CAS writes');
    } finally {
      _e1d_restore(saved);
    }
  });

  it('12. large cloud snapshot — 50 cloud + 25 local (10 overlap) processed without error', async () => {
    const saved = _e1d_savedEnv();
    try {
      // 50 cloud sessions, ids c-0..c-49.
      const cloudDocs = [];
      for (let i = 0; i < 50; i++) {
        cloudDocs.push(_e1d_makeCloudDoc(_e1d_makeSession({
          id: 'c-' + i, deviceId: 'phone-2', updatedAt: 200 + i,
        })));
      }
      // 25 local sessions. First 10 overlap with cloud ids c-0..c-9.
      const localSessions = [];
      for (let i = 0; i < 10; i++) {
        localSessions.push(_e1d_makeSession({
          id: 'c-' + i, deviceId: 'local-dev', note: 'local-' + i, updatedAt: 50 + i,
        }));
      }
      for (let i = 0; i < 15; i++) {
        localSessions.push(_e1d_makeSession({
          id: 'l-' + i, deviceId: 'local-dev', updatedAt: 100 + i,
        }));
      }
      const opts = _e1d_install({
        cloudDocs,
        localSessions,
      });

      const result = await SyncMergeHistory.merge(null);

      assertEqual(result.ok, true, 'ok:true on large snapshot');
      // 50 cloud + 25 local - 10 overlap = 65 unique sessions.
      assertEqual(result.count, 65, 'count = 65 unique sessions');
      assertEqual(result.skipped, 0, 'no skips');
      assertEqual(opts.txSets.length, 65, '65 CAS writes');
    } finally {
      _e1d_restore(saved);
    }
  });

  it('13. SYNC_DISABLED fast-path — no fetch, no writes', async () => {
    const saved = _e1d_savedEnv();
    try {
      let fetchCalled = false;
      let txCalled = false;
      _e1d_install({
        cloudDocs: [_e1d_makeCloudDoc(_e1d_makeSession({ id: 's-1' }))],
        localSessions: [_e1d_makeSession({ id: 'l-1' })],
        getCollection: async () => { fetchCalled = true; return { docs: [] }; },
        runTransaction: async () => { txCalled = true; },
      });
      // Flip sync off AFTER install (install enables it).
      SyncFlag.isEnabled = () => false;

      const result = await SyncMergeHistory.merge(null);

      assertEqual(result.ok, false, 'ok:false on flag-off');
      assertEqual(result.kind, 'sync-not-enabled', 'kind:sync-not-enabled');
      assertEqual(fetchCalled, false, 'getCollection NOT called');
      assertEqual(txCalled, false, 'runTransaction NOT called');
    } finally {
      _e1d_restore(saved);
    }
  });

  it('14. unauthenticated — no user → ok:false, kind:"unauthenticated", no cloud reads', async () => {
    const saved = _e1d_savedEnv();
    try {
      let fetchCalled = false;
      _e1d_install({
        cloudDocs: [],
        localSessions: [],
        getCollection: async () => { fetchCalled = true; return { docs: [] }; },
      });
      // Flip auth off AFTER install.
      SyncAuth.getCurrentUser = () => null;

      const result = await SyncMergeHistory.merge(null);

      assertEqual(result.ok, false, 'ok:false on no user');
      assertEqual(result.kind, 'unauthenticated', 'kind:unauthenticated');
      assertEqual(fetchCalled, false, 'getCollection NOT called');
    } finally {
      _e1d_restore(saved);
    }
  });

  it('15. mixed session types — stopwatch + pomodoro + flow merge without crashing on missing phaseLog', async () => {
    const saved = _e1d_savedEnv();
    try {
      // 1 stopwatch (no phaseLog), 1 pomodoro (with phaseLog), 1 flow (no phaseLog).
      const localStopwatch = _e1d_makeSession({ id: 's-sw', type: 'stopwatch', updatedAt: 100 });
      const localPomo = _e1d_makeSession({
        id: 's-pomo', type: 'pomodoro', updatedAt: 100,
        phaseLog: [{ deviceId: 'local-dev', phaseStartedAt: 1000, phase: 'work' }],
      });
      const localFlow = _e1d_makeSession({ id: 's-flow', type: 'flow', updatedAt: 100 });
      // Cloud: new pomodoro session for the same session id with additional phaseLog entries.
      const cloudPomo = _e1d_makeSession({
        id: 's-pomo', type: 'pomodoro', updatedAt: 200, deviceId: 'phone-2',
        phaseLog: [
          { deviceId: 'local-dev', phaseStartedAt: 1000, phase: 'work' }, // dup
          { deviceId: 'phone-2', phaseStartedAt: 2000, phase: 'shortBreak' },
        ],
      });
      const opts = _e1d_install({
        cloudDocs: [_e1d_makeCloudDoc(cloudPomo)],
        localSessions: [localStopwatch, localPomo, localFlow],
      });

      const result = await SyncMergeHistory.merge(null);

      assertEqual(result.ok, true, 'ok:true on mixed-type merge');
      assertEqual(result.count, 3, 'all 3 sessions written back');
      assertEqual(result.skipped, 0, 'no skips');
      // Find the pomodoro write and verify phaseLog dedup landed.
      const pomoWrite = opts.txSets.find(w => w.path.indexOf('s-pomo') >= 0);
      assert(pomoWrite, 'pomodoro write located');
      assertEqual(pomoWrite.data.phaseLog.length, 2,
        'pomodoro phaseLog: 1 + 2 - 1 dup = 2');
      // Stopwatch + flow writes should not gain a phaseLog field.
      const swWrite = opts.txSets.find(w => w.path.indexOf('s-sw') >= 0);
      const flowWrite = opts.txSets.find(w => w.path.indexOf('s-flow') >= 0);
      assert(swWrite, 'stopwatch write located');
      assert(flowWrite, 'flow write located');
      assertEqual(swWrite.data.phaseLog, undefined,
        'stopwatch session has no phaseLog field after merge');
      assertEqual(flowWrite.data.phaseLog, undefined,
        'flow session has no phaseLog field after merge');
    } finally {
      _e1d_restore(saved);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// F13 dispatcher-wide gate flip — exercised through SyncEngine._runMergeCycle
// (Inherited from E-1c; verifies the dispatcher's contract still holds with
// SyncMergeHistory's real merge body in the loop.)
// ────────────────────────────────────────────────────────────────────────

describe('SyncMergeHistory — F13 dispatcher-wide write gate', () => {

  it('7. SyncState.canWrite() returns false mid-cycle during history merge', async () => {
    const saved = _e1d_savedEnv();
    const stateSpy = _e1d_makeStateSpy('ready');
    let canWriteDuringMerge = null;
    let stateDuringMerge = null;

    const savedMerges = {
      meds: SyncMergeMeds.merge,
      history: SyncMergeHistory.merge,
      rest_log: SyncMergeRestLog.merge,
      presets: SyncMergePresets.merge,
      bfrb_events: SyncMergeBfrb.merge,
    };

    try {
      localStorage.setItem('tempo_sync_enabled', '1');
      SyncFlag.isEnabled = () => true;
      SyncAuth.getCurrentUser = () => ({ uid: 'u-f13' });
      window.SyncState = stateSpy.obj;

      // Probe HISTORY merge fn — captures state mid-cycle.
      SyncMergeHistory.merge = function () {
        stateDuringMerge = stateSpy.obj.get();
        canWriteDuringMerge = stateSpy.obj.canWrite();
        return Promise.resolve({ ok: true, count: 0, skipped: 0,
                                 remoteArrivals: {}, warnings: [] });
      };
      // Other stubs no-op.
      SyncMergeMeds.merge = () => ({ ok: true });
      SyncMergeRestLog.merge = () => ({ ok: false });
      SyncMergePresets.merge = () => ({ ok: false });
      SyncMergeBfrb.merge = () => ({ ok: true });

      const completeP = new Promise((resolve) => {
        const cb = () => { SyncEngine.off('merge-cycle-complete', cb); resolve(); };
        SyncEngine.on('merge-cycle-complete', cb);
      });

      SyncEngine._runMergeCycle();
      await completeP;

      assertEqual(stateDuringMerge, 'hydrating',
        'F13: SyncState is hydrating during history merge fn execution');
      assertEqual(canWriteDuringMerge, false,
        'F13: SyncState.canWrite() returns false mid-cycle');
    } finally {
      SyncMergeMeds.merge = savedMerges.meds;
      SyncMergeHistory.merge = savedMerges.history;
      SyncMergeRestLog.merge = savedMerges.rest_log;
      SyncMergePresets.merge = savedMerges.presets;
      SyncMergeBfrb.merge = savedMerges.bfrb_events;
      _e1d_restore(saved);
    }
  });

  it('8a. SyncState returns to "ready" after a successful history merge cycle', async () => {
    const saved = _e1d_savedEnv();
    const stateSpy = _e1d_makeStateSpy('ready');
    const savedMerges = {
      meds: SyncMergeMeds.merge,
      history: SyncMergeHistory.merge,
      rest_log: SyncMergeRestLog.merge,
      presets: SyncMergePresets.merge,
      bfrb_events: SyncMergeBfrb.merge,
    };

    try {
      localStorage.setItem('tempo_sync_enabled', '1');
      SyncFlag.isEnabled = () => true;
      SyncAuth.getCurrentUser = () => ({ uid: 'u-f13' });
      window.SyncState = stateSpy.obj;

      SyncMergeMeds.merge = () => ({ ok: true });
      SyncMergeHistory.merge = () => ({ ok: true });
      SyncMergeRestLog.merge = () => ({ ok: true });
      SyncMergePresets.merge = () => ({ ok: true });
      SyncMergeBfrb.merge = () => ({ ok: true });

      SyncEngine._runMergeCycle();

      assertEqual(stateSpy.obj.get(), 'ready',
        'SyncState restored to ready after sync cycle finalizes');
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
      _e1d_restore(saved);
    }
  });

  it('8b. SyncState returns to "ready" even when history merge throws (Risk #1 — try/finally)', async () => {
    const saved = _e1d_savedEnv();
    const stateSpy = _e1d_makeStateSpy('ready');
    const savedMerges = {
      meds: SyncMergeMeds.merge,
      history: SyncMergeHistory.merge,
      rest_log: SyncMergeRestLog.merge,
      presets: SyncMergePresets.merge,
      bfrb_events: SyncMergeBfrb.merge,
    };

    try {
      localStorage.setItem('tempo_sync_enabled', '1');
      SyncFlag.isEnabled = () => true;
      SyncAuth.getCurrentUser = () => ({ uid: 'u-f13' });
      window.SyncState = stateSpy.obj;

      // Make history merge throw a non-Error value.
      SyncMergeMeds.merge = () => ({ ok: true });
      SyncMergeHistory.merge = function () { throw 'string-throw-history'; };
      SyncMergeRestLog.merge = function () { throw null; };
      SyncMergePresets.merge = function () { throw new Error('stub'); };
      SyncMergeBfrb.merge = function () { throw 'string-throw-bfrb'; };

      SyncEngine._runMergeCycle();

      assertEqual(stateSpy.obj.get(), 'ready',
        'SyncState restored to ready even after history merge throws');
    } finally {
      SyncMergeMeds.merge = savedMerges.meds;
      SyncMergeHistory.merge = savedMerges.history;
      SyncMergeRestLog.merge = savedMerges.rest_log;
      SyncMergePresets.merge = savedMerges.presets;
      SyncMergeBfrb.merge = savedMerges.bfrb_events;
      _e1d_restore(saved);
    }
  });
});
