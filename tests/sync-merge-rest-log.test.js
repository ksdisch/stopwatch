// E-1e — SyncMergeRestLog.merge() tests.
//
// Coverage (per E-1e-AUDIT § "Test scope" 1-16):
//   1.  Happy path — cloud has 1 new day, local has 0, append-merge writes 1 record.
//   2.  Sleep LWW — cloud newer wins.
//   3.  Sleep LWW — local newer wins.
//   4.  Sleep LWW — equal updatedAt is stable (cloud wins on tie).
//   5.  Sleep LWW — absent updatedAt treated as -Infinity (side WITH stamp wins).
//   6.  Naps append-merge — cloud-only entries land in local.
//   7.  Naps append-merge — different deviceId same startedAt both survive.
//   8.  Naps append-merge — same (deviceId, startedAt) collapses to one (cloud wins).
//   9.  F19a per-record pre-filter — future-schema cloud record skipped + counted.
//   10. Idempotency — 2nd merge with same cloud state produces byte-equivalent writes.
//   11. CAS abort on refuse-writeback — entry counted in skipped, loop continues.
//   12. CAS abort on network error — entry counted, loop continues.
//   13. Empty cloud collection — local has 1 day, written.
//   14. SYNC_DISABLED fast-path — flag off → { ok:false, kind:'sync-not-enabled' }.
//   15. Unauthenticated — no user → { ok:false, kind:'unauthenticated' }.
//   16. Multi-day merge — 3 days cloud + 2 days local, all 5 written.
//   17. Pre-E-1e naps fallback — naps without deviceId dedup via 'no-device@startedAt'.
//
// Mocking pattern: SyncFirestore + SyncAuth methods are hot-swapped on
// the real modules and restored in finally. RecoveryUI is loaded for real;
// the wellness_rest_log key is cleared between cases. Mirrors the
// sync-merge-bfrb.test.js convention.

// ── Shared save/restore + install helpers ─────────────────────────────

function _e1e_rl_savedEnv() {
  return {
    flag_enabled: SyncFlag.isEnabled,
    auth_getCurrentUser: SyncAuth.getCurrentUser,
    fs_getCollection: SyncFirestore.getCollection,
    fs_runTransaction: SyncFirestore.runTransaction,
    syncState: window.SyncState,
    sync_flag_storage: localStorage.getItem('tempo_sync_enabled'),
    rest_log: localStorage.getItem('wellness_rest_log'),
    real_recoveryUI: window.RecoveryUI,
  };
}

function _e1e_rl_restore(saved) {
  SyncFlag.isEnabled = saved.flag_enabled;
  SyncAuth.getCurrentUser = saved.auth_getCurrentUser;
  SyncFirestore.getCollection = saved.fs_getCollection;
  SyncFirestore.runTransaction = saved.fs_runTransaction;
  if (saved.syncState === undefined) delete window.SyncState;
  else window.SyncState = saved.syncState;
  if (saved.sync_flag_storage === null) localStorage.removeItem('tempo_sync_enabled');
  else localStorage.setItem('tempo_sync_enabled', saved.sync_flag_storage);
  if (saved.rest_log === null) localStorage.removeItem('wellness_rest_log');
  else localStorage.setItem('wellness_rest_log', saved.rest_log);
  if (saved.real_recoveryUI === undefined) delete window.RecoveryUI;
  else window.RecoveryUI = saved.real_recoveryUI;
}

// Install a minimal `window.RecoveryUI` stub that backs onto the
// `wellness_rest_log` localStorage key the same way the real module
// does. The merge function only consumes `loadLog()` +
// `_reconcileWriteRaw(mergedMap)`, so those are the only methods we
// need to satisfy. recovery-ui.js itself isn't loaded by tests/index.html
// (it has DOM-coupled init), so per-test stubbing is the established
// convention (sync-engine.test.js does the same via
// `stubRecoveryUIForSync`).
function _e1e_rl_stubRecoveryUI() {
  window.RecoveryUI = {
    loadLog: () => {
      try {
        const raw = JSON.parse(localStorage.getItem('wellness_rest_log'));
        return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
      } catch (e) { return {}; }
    },
    _reconcileWriteRaw: (map) => {
      try {
        localStorage.setItem('wellness_rest_log', JSON.stringify(map || {}));
      } catch (_) {}
      return { written: 0, skipped: 0 };
    },
  };
}

function _e1e_rl_clearStore() {
  localStorage.removeItem('wellness_rest_log');
}

function _e1e_rl_seedLocal(map) {
  localStorage.setItem('wellness_rest_log', JSON.stringify(map || {}));
}

function _e1e_rl_makeCloudDoc(dateKey, data) {
  return { id: dateKey, data };
}

function _e1e_rl_makeSleep(updatedAt, extras) {
  return Object.assign({
    hours: 7,
    quality: 4,
    deviceId: 'phone-x',
    updatedAt,
    schemaVersion: 1,
  }, extras || {});
}

function _e1e_rl_makeNap(deviceId, startedAt, durationMs, extras) {
  return Object.assign({
    startedAt,
    durationMs: durationMs == null ? 1200000 : durationMs,
    deviceId,
    updatedAt: startedAt,
    schemaVersion: 1,
  }, extras || {});
}

function _e1e_rl_install(opts) {
  opts = opts || {};
  SyncFlag.isEnabled = () => true;
  SyncAuth.getCurrentUser = () => ({ uid: opts.uid || 'u-rl-test', email: 't@test.com' });

  // Install RecoveryUI stub (sync-merge-rest-log.js bails with
  // 'recovery-ui-unavailable' otherwise — recovery-ui.js isn't loaded
  // into tests/index.html).
  _e1e_rl_stubRecoveryUI();

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
// Test cases — SyncMergeRestLog.merge()
// ────────────────────────────────────────────────────────────────────────

describe('SyncMergeRestLog — merge — sleep LWW + naps append-merge + F19a + CAS', () => {

  it('1. happy path — cloud has 1 new day, local has 0, writes 1 record', async () => {
    const saved = _e1e_rl_savedEnv();
    try {
      _e1e_rl_clearStore();
      _e1e_rl_seedLocal({});

      const cloudDay = { sleep: _e1e_rl_makeSleep(1000, { hours: 7 }), naps: [] };
      const opts = _e1e_rl_install({
        cloudDocs: [_e1e_rl_makeCloudDoc('2026-05-13', cloudDay)],
      });

      const result = await SyncMergeRestLog.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 1, 'one record written');
      assertEqual(result.skipped, 0, 'no skips');
      assertEqual(opts.txSets.length, 1, 'one CAS write');
      assertEqual(opts.txSets[0].data.sleep.hours, 7, 'sleep merged in');
      // No F15 for rest_log arrivals.
      assertEqual(Object.keys(result.remoteArrivals).length, 0,
        'remoteArrivals empty (no F15 for rest_log)');
    } finally {
      _e1e_rl_restore(saved);
    }
  });

  it('2. sleep LWW — cloud newer wins', async () => {
    const saved = _e1e_rl_savedEnv();
    try {
      _e1e_rl_clearStore();
      _e1e_rl_seedLocal({
        '2026-05-13': { sleep: _e1e_rl_makeSleep(500, { hours: 6 }), naps: [] },
      });
      const cloudDay = { sleep: _e1e_rl_makeSleep(1000, { hours: 8 }), naps: [] };
      const opts = _e1e_rl_install({
        cloudDocs: [_e1e_rl_makeCloudDoc('2026-05-13', cloudDay)],
      });

      const result = await SyncMergeRestLog.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets.length, 1, 'one CAS write');
      assertEqual(opts.txSets[0].data.sleep.hours, 8, 'cloud (newer) sleep wins');
    } finally {
      _e1e_rl_restore(saved);
    }
  });

  it('3. sleep LWW — local newer wins', async () => {
    const saved = _e1e_rl_savedEnv();
    try {
      _e1e_rl_clearStore();
      _e1e_rl_seedLocal({
        '2026-05-13': { sleep: _e1e_rl_makeSleep(1000, { hours: 6 }), naps: [] },
      });
      const cloudDay = { sleep: _e1e_rl_makeSleep(500, { hours: 8 }), naps: [] };
      const opts = _e1e_rl_install({
        cloudDocs: [_e1e_rl_makeCloudDoc('2026-05-13', cloudDay)],
      });

      const result = await SyncMergeRestLog.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets[0].data.sleep.hours, 6, 'local (newer) sleep wins');
    } finally {
      _e1e_rl_restore(saved);
    }
  });

  it('4. sleep LWW — equal updatedAt is stable (cloud wins on tie)', async () => {
    const saved = _e1e_rl_savedEnv();
    try {
      _e1e_rl_clearStore();
      _e1e_rl_seedLocal({
        '2026-05-13': { sleep: _e1e_rl_makeSleep(1000, { hours: 6 }), naps: [] },
      });
      const cloudDay = { sleep: _e1e_rl_makeSleep(1000, { hours: 8 }), naps: [] };
      const opts = _e1e_rl_install({
        cloudDocs: [_e1e_rl_makeCloudDoc('2026-05-13', cloudDay)],
      });

      const result = await SyncMergeRestLog.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets[0].data.sleep.hours, 8, 'cloud wins on updatedAt tie');
    } finally {
      _e1e_rl_restore(saved);
    }
  });

  it('5. sleep LWW — absent updatedAt treated as -Infinity (side WITH stamp wins)', async () => {
    const saved = _e1e_rl_savedEnv();
    try {
      _e1e_rl_clearStore();
      // Local sleep has NO updatedAt at all — pre-E-1e shape.
      _e1e_rl_seedLocal({
        '2026-05-13': { sleep: { hours: 6 }, naps: [] },
      });
      const cloudDay = { sleep: _e1e_rl_makeSleep(1000, { hours: 8 }), naps: [] };
      const opts = _e1e_rl_install({
        cloudDocs: [_e1e_rl_makeCloudDoc('2026-05-13', cloudDay)],
      });

      const result = await SyncMergeRestLog.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets[0].data.sleep.hours, 8,
        'cloud wins — local sleep had no updatedAt (treated as -Infinity)');
    } finally {
      _e1e_rl_restore(saved);
    }
  });

  it('6. naps append-merge — cloud-only entries land in local', async () => {
    const saved = _e1e_rl_savedEnv();
    try {
      _e1e_rl_clearStore();
      _e1e_rl_seedLocal({
        '2026-05-13': { sleep: null, naps: [] },
      });
      const cloudDay = {
        sleep: null,
        naps: [
          _e1e_rl_makeNap('phone-A', 100000),
          _e1e_rl_makeNap('phone-A', 200000),
        ],
      };
      const opts = _e1e_rl_install({
        cloudDocs: [_e1e_rl_makeCloudDoc('2026-05-13', cloudDay)],
      });

      const result = await SyncMergeRestLog.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets.length, 1, 'one CAS write');
      assertEqual(opts.txSets[0].data.naps.length, 2, 'two naps merged in');
    } finally {
      _e1e_rl_restore(saved);
    }
  });

  it('7. naps append-merge — different deviceId same startedAt both survive', async () => {
    const saved = _e1e_rl_savedEnv();
    try {
      _e1e_rl_clearStore();
      // Two devices logging a nap at the same millisecond. Different
      // deviceId → distinct dedup sig → both must survive.
      _e1e_rl_seedLocal({
        '2026-05-13': {
          sleep: null,
          naps: [_e1e_rl_makeNap('phone-B', 1000, 1800000)],
        },
      });
      const cloudDay = {
        sleep: null,
        naps: [_e1e_rl_makeNap('phone-A', 1000, 1800000)],
      };
      const opts = _e1e_rl_install({
        cloudDocs: [_e1e_rl_makeCloudDoc('2026-05-13', cloudDay)],
      });

      const result = await SyncMergeRestLog.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets.length, 1, 'one CAS write');
      assertEqual(opts.txSets[0].data.naps.length, 2,
        'both naps survive — different deviceId on same startedAt');
    } finally {
      _e1e_rl_restore(saved);
    }
  });

  it('8. naps append-merge — same (deviceId, startedAt) collapses (cloud wins)', async () => {
    const saved = _e1e_rl_savedEnv();
    try {
      _e1e_rl_clearStore();
      _e1e_rl_seedLocal({
        '2026-05-13': {
          sleep: null,
          naps: [_e1e_rl_makeNap('shared-dev', 1000, 1800000, { endedEarly: true })],
        },
      });
      const cloudDay = {
        sleep: null,
        naps: [_e1e_rl_makeNap('shared-dev', 1000, 1800000, { endedEarly: false })],
      };
      const opts = _e1e_rl_install({
        cloudDocs: [_e1e_rl_makeCloudDoc('2026-05-13', cloudDay)],
      });

      const result = await SyncMergeRestLog.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets[0].data.naps.length, 1,
        'naps deduped to one entry (same sig)');
      assertEqual(opts.txSets[0].data.naps[0].endedEarly, false,
        'cloud nap wins on sig collision');
    } finally {
      _e1e_rl_restore(saved);
    }
  });

  it('9. F19a per-record pre-filter — future-schema cloud record skipped', async () => {
    const saved = _e1e_rl_savedEnv();
    try {
      _e1e_rl_clearStore();
      _e1e_rl_seedLocal({});

      const futureDay = { sleep: _e1e_rl_makeSleep(1000), naps: [], schemaVersion: 999 };
      const normalDay = { sleep: _e1e_rl_makeSleep(2000), naps: [] };
      const opts = _e1e_rl_install({
        cloudDocs: [
          _e1e_rl_makeCloudDoc('2026-05-12', futureDay),
          _e1e_rl_makeCloudDoc('2026-05-13', normalDay),
        ],
      });

      const result = await SyncMergeRestLog.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 1, 'one record written (future-schema skipped)');
      assert(result.skipped >= 1, 'at least one record skipped');
      assertEqual(opts.txSets.length, 1, 'one CAS write');
      assertEqual(opts.txSets[0].path.endsWith('2026-05-13'), true,
        'only non-future record written');
    } finally {
      _e1e_rl_restore(saved);
    }
  });

  it('10. idempotency — 2nd merge with same cloud state writes byte-equivalent records', async () => {
    const saved = _e1e_rl_savedEnv();
    try {
      _e1e_rl_clearStore();
      _e1e_rl_seedLocal({});
      const cloudDay = {
        sleep: _e1e_rl_makeSleep(1000),
        naps: [_e1e_rl_makeNap('phone-A', 100000)],
      };
      const opts1 = _e1e_rl_install({
        cloudDocs: [_e1e_rl_makeCloudDoc('2026-05-13', cloudDay)],
      });
      const r1 = await SyncMergeRestLog.merge(null);
      assertEqual(r1.ok, true, 'first merge ok');
      assertEqual(opts1.txSets.length, 1, 'one write on first run');
      const firstNapsLen = opts1.txSets[0].data.naps.length;
      const firstSleepHours = opts1.txSets[0].data.sleep.hours;

      // Re-run with the SAME cloud state. The local merged map persists
      // via _reconcileWriteRaw, so the second pass should produce
      // byte-equivalent writes.
      const opts2 = _e1e_rl_install({
        cloudDocs: [_e1e_rl_makeCloudDoc('2026-05-13', cloudDay)],
      });
      const r2 = await SyncMergeRestLog.merge(null);
      assertEqual(r2.ok, true, 'second merge ok');
      assertEqual(opts2.txSets.length, 1, 'one write on second run too');
      assertEqual(opts2.txSets[0].data.naps.length, firstNapsLen,
        'naps count stable across runs');
      assertEqual(opts2.txSets[0].data.sleep.hours, firstSleepHours,
        'sleep stable across runs');
    } finally {
      _e1e_rl_restore(saved);
    }
  });

  it('11. CAS abort on refuse-writeback — entry counted in skipped, loop continues', async () => {
    const saved = _e1e_rl_savedEnv();
    try {
      _e1e_rl_clearStore();
      _e1e_rl_seedLocal({
        '2026-05-12': { sleep: _e1e_rl_makeSleep(500), naps: [] },
        '2026-05-13': { sleep: _e1e_rl_makeSleep(500), naps: [] },
      });

      // Mock runTransaction to throw refuse-writeback on call #1, succeed on #2.
      let callCount = 0;
      const opts = _e1e_rl_install({});
      opts.txSets = [];
      SyncFirestore.runTransaction = async (fn) => {
        callCount++;
        if (callCount === 1) {
          const err = new Error('refuse-writeback: future record');
          err.kind = 'refuse-writeback';
          throw err;
        }
        const tx = {
          get: async () => null,
          set: (path, data) => { opts.txSets.push({ path, data }); },
          refuseWriteback: () => { throw new Error('unused'); },
        };
        return await fn(tx);
      };

      const result = await SyncMergeRestLog.merge(null);
      assertEqual(result.ok, true, 'ok:true (loop continues)');
      assertEqual(result.count, 1, 'one successful write');
      assert(result.skipped >= 1, 'one or more skipped (refuse-writeback)');
    } finally {
      _e1e_rl_restore(saved);
    }
  });

  it('12. CAS abort on network error — entry counted, loop continues', async () => {
    const saved = _e1e_rl_savedEnv();
    try {
      _e1e_rl_clearStore();
      _e1e_rl_seedLocal({
        '2026-05-12': { sleep: _e1e_rl_makeSleep(500), naps: [] },
        '2026-05-13': { sleep: _e1e_rl_makeSleep(500), naps: [] },
      });

      let callCount = 0;
      const opts = _e1e_rl_install({});
      opts.txSets = [];
      SyncFirestore.runTransaction = async (fn) => {
        callCount++;
        if (callCount === 1) {
          const err = new Error('network unreachable');
          err.kind = 'network';
          throw err;
        }
        const tx = {
          get: async () => null,
          set: (path, data) => { opts.txSets.push({ path, data }); },
          refuseWriteback: () => { throw new Error('unused'); },
        };
        return await fn(tx);
      };

      const result = await SyncMergeRestLog.merge(null);
      assertEqual(result.ok, true, 'ok:true (loop continues on network error)');
      assertEqual(result.count, 1, 'one successful write');
      assert(result.skipped >= 1, 'one or more skipped (network error)');
    } finally {
      _e1e_rl_restore(saved);
    }
  });

  it('13. empty cloud collection — local has 1 day, written', async () => {
    const saved = _e1e_rl_savedEnv();
    try {
      _e1e_rl_clearStore();
      _e1e_rl_seedLocal({
        '2026-05-13': {
          sleep: _e1e_rl_makeSleep(500),
          naps: [_e1e_rl_makeNap('local-dev', 100000)],
        },
      });
      const opts = _e1e_rl_install({ cloudDocs: [] });

      const result = await SyncMergeRestLog.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 1, 'one local day written to cloud');
      assertEqual(opts.txSets.length, 1, 'one CAS write');
      assertEqual(opts.txSets[0].data.sleep.hours, 7, 'local sleep present');
      assertEqual(opts.txSets[0].data.naps.length, 1, 'local nap present');
    } finally {
      _e1e_rl_restore(saved);
    }
  });

  it('14. SYNC_DISABLED fast-path — flag off returns { ok:false, kind:"sync-not-enabled" }', async () => {
    const saved = _e1e_rl_savedEnv();
    try {
      _e1e_rl_clearStore();
      SyncFlag.isEnabled = () => false;
      let getCollectionCalled = false;
      let runTransactionCalled = false;
      SyncFirestore.getCollection = async () => { getCollectionCalled = true; return { docs: [] }; };
      SyncFirestore.runTransaction = async () => { runTransactionCalled = true; };

      const result = await SyncMergeRestLog.merge(null);
      assertEqual(result.ok, false, 'ok:false');
      assertEqual(result.kind, 'sync-not-enabled', 'kind correct');
      assertEqual(getCollectionCalled, false, 'getCollection NOT called');
      assertEqual(runTransactionCalled, false, 'runTransaction NOT called');
    } finally {
      _e1e_rl_restore(saved);
    }
  });

  it('15. unauthenticated — no signed-in user → { ok:false, kind:"unauthenticated" }', async () => {
    const saved = _e1e_rl_savedEnv();
    try {
      _e1e_rl_clearStore();
      SyncFlag.isEnabled = () => true;
      SyncAuth.getCurrentUser = () => null;
      let getCollectionCalled = false;
      SyncFirestore.getCollection = async () => { getCollectionCalled = true; return { docs: [] }; };

      const result = await SyncMergeRestLog.merge(null);
      assertEqual(result.ok, false, 'ok:false');
      assertEqual(result.kind, 'unauthenticated', 'kind correct');
      assertEqual(getCollectionCalled, false, 'no cloud reads');
    } finally {
      _e1e_rl_restore(saved);
    }
  });

  it('16. multi-day merge — 3 cloud days + 2 local days, all 5 written', async () => {
    const saved = _e1e_rl_savedEnv();
    try {
      _e1e_rl_clearStore();
      _e1e_rl_seedLocal({
        '2026-05-10': { sleep: _e1e_rl_makeSleep(100), naps: [] },
        '2026-05-11': { sleep: _e1e_rl_makeSleep(200), naps: [] },
      });
      const opts = _e1e_rl_install({
        cloudDocs: [
          _e1e_rl_makeCloudDoc('2026-05-12', { sleep: _e1e_rl_makeSleep(300), naps: [] }),
          _e1e_rl_makeCloudDoc('2026-05-13', { sleep: _e1e_rl_makeSleep(400), naps: [] }),
          _e1e_rl_makeCloudDoc('2026-05-14', { sleep: _e1e_rl_makeSleep(500), naps: [] }),
        ],
      });

      const result = await SyncMergeRestLog.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 5, 'all five days written');
      assertEqual(opts.txSets.length, 5, 'five CAS writes');
    } finally {
      _e1e_rl_restore(saved);
    }
  });

  it('17. pre-E-1e naps fallback — naps without deviceId dedup via "no-device@startedAt"', async () => {
    const saved = _e1e_rl_savedEnv();
    try {
      _e1e_rl_clearStore();
      // Pre-E-1e naps have NO deviceId field. The merge function's
      // fallback sig is `'no-device@' + startedAt`, so two such naps
      // with the same startedAt collapse to one (Risk #2 mitigation).
      _e1e_rl_seedLocal({
        '2026-05-13': {
          sleep: null,
          naps: [{ startedAt: 1000, durationMs: 1200000 }],
        },
      });
      const cloudDay = {
        sleep: null,
        naps: [{ startedAt: 1000, durationMs: 1800000 }],
      };
      const opts = _e1e_rl_install({
        cloudDocs: [_e1e_rl_makeCloudDoc('2026-05-13', cloudDay)],
      });

      const result = await SyncMergeRestLog.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets[0].data.naps.length, 1,
        'pre-E-1e naps without deviceId collapse via no-device fallback');
    } finally {
      _e1e_rl_restore(saved);
    }
  });

});
