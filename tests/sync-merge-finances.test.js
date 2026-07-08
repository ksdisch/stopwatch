// Life-OS Phase 5 — SyncMergeFinances.merge() tests (finances, 8th store).
//
// Clones sync-merge-rest-log.test.js's per-KEY structure (finances keys by
// YYYY-MM month) + mood's CAS cases, adapted to WHOLE-record per-month LWW
// (a finances month record is a flat metric bag — the latest updatedAt for
// that month wins; NOT rest_log's sleep/naps sub-merge, NOT mood's
// append-only (deviceId, at) dedup).
//
// Coverage:
//   1.  Happy path — cloud has 1 new month, local has 0, writes 1 record.
//   2.  Same-month LWW — cloud newer updatedAt wins.
//   3.  Same-month LWW — local newer updatedAt wins.
//   4.  Same-month LWW — equal updatedAt is stable (cloud wins on tie).
//   5.  Same-month LWW — absent updatedAt treated as -Infinity (stamped side wins).
//   6.  Two DIFFERENT months coexist (union, no collapse).
//   7.  Doc id == the month string.
//   8.  F19a per-record pre-filter — future-schema cloud month skipped.
//   9.  CAS skip when recordsEqual — no redundant cloud write.
//   10. CAS abort on refuse-writeback — month counted in skipped, loop continues.
//   11. SYNC_DISABLED fast-path — flag off → { ok:false, kind:'sync-not-enabled' }.
//   12. Unauthenticated — no user → { ok:false, kind:'unauthenticated' }.
//   13. Local writeback — a cloud-origin month lands in the LOCAL finances map.
//
// Every top-level identifier is prefixed `_finm_` (finances-MERGE) — the
// engine tests share ONE global scope; this MUST NOT collide with
// finances.test.js's `_fin_` module-test helpers.

// ── Shared save/restore + install helpers ─────────────────────────────

function _finm_savedEnv() {
  return {
    flag_enabled: SyncFlag.isEnabled,
    auth_getCurrentUser: SyncAuth.getCurrentUser,
    fs_getCollection: SyncFirestore.getCollection,
    fs_runTransaction: SyncFirestore.runTransaction,
    syncState: window.SyncState,
    sync_flag_storage: localStorage.getItem('tempo_sync_enabled'),
    finances: localStorage.getItem('finances'),
  };
}

function _finm_restore(saved) {
  SyncFlag.isEnabled = saved.flag_enabled;
  SyncAuth.getCurrentUser = saved.auth_getCurrentUser;
  SyncFirestore.getCollection = saved.fs_getCollection;
  SyncFirestore.runTransaction = saved.fs_runTransaction;
  if (saved.syncState === undefined) delete window.SyncState;
  else window.SyncState = saved.syncState;
  if (saved.sync_flag_storage === null) localStorage.removeItem('tempo_sync_enabled');
  else localStorage.setItem('tempo_sync_enabled', saved.sync_flag_storage);
  if (saved.finances === null) localStorage.removeItem('finances');
  else localStorage.setItem('finances', saved.finances);
}

function _finm_clearStore() {
  localStorage.removeItem('finances');
}

function _finm_seedLocal(map) {
  localStorage.setItem('finances', JSON.stringify(map || {}));
}

function _finm_makeCloudDoc(monthKey, data) {
  return { id: monthKey, data };
}

function _finm_makeRec(month, updatedAt, extras) {
  return Object.assign({
    month,
    savingsRate: 18,
    deviceId: 'phone-x',
    updatedAt,
    schemaVersion: 1,
  }, extras || {});
}

function _finm_install(opts) {
  opts = opts || {};
  SyncFlag.isEnabled = () => true;
  SyncAuth.getCurrentUser = () => ({ uid: opts.uid || 'u-fin-test', email: 't@test.com' });

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
// Test cases — SyncMergeFinances.merge()
// ────────────────────────────────────────────────────────────────────────

describe('SyncMergeFinances — merge — per-month whole-record LWW + F19a + CAS', () => {

  it('1. happy path — cloud has 1 new month, local has 0, writes 1 record', async () => {
    const saved = _finm_savedEnv();
    try {
      _finm_clearStore();
      _finm_seedLocal({});

      const cloudRec = _finm_makeRec('2026-07', 1000, { savingsRate: 20 });
      const opts = _finm_install({
        cloudDocs: [_finm_makeCloudDoc('2026-07', cloudRec)],
      });

      const result = await SyncMergeFinances.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 1, 'one record written');
      assertEqual(result.skipped, 0, 'no skips');
      assertEqual(opts.txSets.length, 1, 'one CAS write');
      assertEqual(opts.txSets[0].data.savingsRate, 20, 'cloud month merged in');
      // No F15 for finances arrivals.
      assertEqual(Object.keys(result.remoteArrivals).length, 0,
        'remoteArrivals empty (no F15 for finances)');
    } finally {
      _finm_restore(saved);
    }
  });

  it('2. same-month LWW — cloud newer updatedAt wins', async () => {
    const saved = _finm_savedEnv();
    try {
      _finm_clearStore();
      _finm_seedLocal({ '2026-07': _finm_makeRec('2026-07', 500, { savingsRate: 10 }) });
      const cloudRec = _finm_makeRec('2026-07', 1000, { savingsRate: 22 });
      const opts = _finm_install({ cloudDocs: [_finm_makeCloudDoc('2026-07', cloudRec)] });

      const result = await SyncMergeFinances.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets.length, 1, 'one CAS write');
      assertEqual(opts.txSets[0].data.savingsRate, 22, 'cloud (newer) month wins');
    } finally {
      _finm_restore(saved);
    }
  });

  it('3. same-month LWW — local newer updatedAt wins', async () => {
    const saved = _finm_savedEnv();
    try {
      _finm_clearStore();
      _finm_seedLocal({ '2026-07': _finm_makeRec('2026-07', 1000, { savingsRate: 10 }) });
      const cloudRec = _finm_makeRec('2026-07', 500, { savingsRate: 22 });
      const opts = _finm_install({ cloudDocs: [_finm_makeCloudDoc('2026-07', cloudRec)] });

      const result = await SyncMergeFinances.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets[0].data.savingsRate, 10, 'local (newer) month wins');
    } finally {
      _finm_restore(saved);
    }
  });

  it('4. same-month LWW — equal updatedAt is stable (cloud wins on tie)', async () => {
    const saved = _finm_savedEnv();
    try {
      _finm_clearStore();
      _finm_seedLocal({ '2026-07': _finm_makeRec('2026-07', 1000, { savingsRate: 10 }) });
      const cloudRec = _finm_makeRec('2026-07', 1000, { savingsRate: 22 });
      const opts = _finm_install({ cloudDocs: [_finm_makeCloudDoc('2026-07', cloudRec)] });

      const result = await SyncMergeFinances.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets[0].data.savingsRate, 22, 'cloud wins on updatedAt tie');
    } finally {
      _finm_restore(saved);
    }
  });

  it('5. same-month LWW — absent updatedAt treated as -Infinity (stamped side wins)', async () => {
    const saved = _finm_savedEnv();
    try {
      _finm_clearStore();
      // Local record has NO updatedAt at all.
      _finm_seedLocal({ '2026-07': { month: '2026-07', savingsRate: 10 } });
      const cloudRec = _finm_makeRec('2026-07', 1000, { savingsRate: 22 });
      const opts = _finm_install({ cloudDocs: [_finm_makeCloudDoc('2026-07', cloudRec)] });

      const result = await SyncMergeFinances.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets[0].data.savingsRate, 22,
        'cloud wins — local record had no updatedAt (treated as -Infinity)');
    } finally {
      _finm_restore(saved);
    }
  });

  it('6. two different months coexist (union, no collapse)', async () => {
    const saved = _finm_savedEnv();
    try {
      _finm_clearStore();
      _finm_seedLocal({ '2026-06': _finm_makeRec('2026-06', 500, { savingsRate: 15 }) });
      const cloudRec = _finm_makeRec('2026-07', 1000, { savingsRate: 20 });
      const opts = _finm_install({ cloudDocs: [_finm_makeCloudDoc('2026-07', cloudRec)] });

      const result = await SyncMergeFinances.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 2, 'both months written');
      assertEqual(opts.txSets.length, 2, 'two CAS writes (distinct months)');
      const months = opts.txSets.map(s => s.path.split('/').pop()).sort();
      assertArrayEqual(months, ['2026-06', '2026-07'], 'both month keys present');
    } finally {
      _finm_restore(saved);
    }
  });

  it('7. doc id == the month string', async () => {
    const saved = _finm_savedEnv();
    try {
      _finm_clearStore();
      _finm_seedLocal({ '2026-07': _finm_makeRec('2026-07', 1000) });
      const opts = _finm_install({ cloudDocs: [] });

      const result = await SyncMergeFinances.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets.length, 1, 'one CAS write');
      assert(opts.txSets[0].path.indexOf('/finances/') !== -1, 'writes target finances collection');
      assertEqual(opts.txSets[0].path.split('/').pop(), '2026-07', 'doc id IS the month string');
    } finally {
      _finm_restore(saved);
    }
  });

  it('8. F19a per-record pre-filter — future-schema cloud month skipped', async () => {
    const saved = _finm_savedEnv();
    try {
      _finm_clearStore();
      _finm_seedLocal({});

      const futureRec = _finm_makeRec('2026-06', 1000);
      futureRec.schemaVersion = 999;
      const normalRec = _finm_makeRec('2026-07', 2000);
      const opts = _finm_install({
        cloudDocs: [
          _finm_makeCloudDoc('2026-06', futureRec),
          _finm_makeCloudDoc('2026-07', normalRec),
        ],
      });

      const result = await SyncMergeFinances.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 1, 'one record written (future-schema skipped)');
      assert(result.skipped >= 1, 'at least one record skipped');
      assertEqual(opts.txSets.length, 1, 'one CAS write');
      assertEqual(opts.txSets[0].path.split('/').pop(), '2026-07', 'only non-future month written');
    } finally {
      _finm_restore(saved);
    }
  });

  it('9. CAS skip when recordsEqual — no redundant cloud write', async () => {
    const saved = _finm_savedEnv();
    try {
      _finm_clearStore();
      // The local month is byte-identical (minus stamp envelope) to the
      // cloud doc the CAS read returns → recordsEqual → skip the write.
      const rec = _finm_makeRec('2026-07', 1000, { savingsRate: 20 });
      _finm_seedLocal({ '2026-07': rec });

      const cloudCopy = _finm_makeRec('2026-07', 1000, { savingsRate: 20 });
      const opts = _finm_install({
        cloudDocs: [_finm_makeCloudDoc('2026-07', cloudCopy)],
        // The CAS tx.get must return the same cloud copy so recordsEqual fires.
        txGetMap: { 'users/u-fin-test/finances/2026-07': cloudCopy },
      });

      const result = await SyncMergeFinances.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      // The merge still "counts" the record (writtenCount++ after the tx),
      // but no tx.set fired — the redundant cloud write was skipped.
      assertEqual(opts.txSets.length, 0, 'no CAS write — records equal, self-echo suppressed');
    } finally {
      _finm_restore(saved);
    }
  });

  it('10. CAS abort on refuse-writeback — month counted in skipped, loop continues', async () => {
    const saved = _finm_savedEnv();
    try {
      _finm_clearStore();
      _finm_seedLocal({
        '2026-06': _finm_makeRec('2026-06', 500),
        '2026-07': _finm_makeRec('2026-07', 500),
      });

      // Throw refuse-writeback on call #1, succeed on #2.
      let callCount = 0;
      const opts = _finm_install({});
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

      const result = await SyncMergeFinances.merge(null);
      assertEqual(result.ok, true, 'ok:true (loop continues)');
      assertEqual(result.count, 1, 'one successful write');
      assert(result.skipped >= 1, 'one or more skipped (refuse-writeback)');
    } finally {
      _finm_restore(saved);
    }
  });

  it('11. SYNC_DISABLED fast-path — flag off returns { ok:false, kind:"sync-not-enabled" }', async () => {
    const saved = _finm_savedEnv();
    try {
      _finm_clearStore();
      SyncFlag.isEnabled = () => false;
      let getCollectionCalled = false;
      let runTransactionCalled = false;
      SyncFirestore.getCollection = async () => { getCollectionCalled = true; return { docs: [] }; };
      SyncFirestore.runTransaction = async () => { runTransactionCalled = true; };

      const result = await SyncMergeFinances.merge(null);
      assertEqual(result.ok, false, 'ok:false');
      assertEqual(result.kind, 'sync-not-enabled', 'kind correct');
      assertEqual(getCollectionCalled, false, 'getCollection NOT called');
      assertEqual(runTransactionCalled, false, 'runTransaction NOT called');
    } finally {
      _finm_restore(saved);
    }
  });

  it('12. unauthenticated — no signed-in user → { ok:false, kind:"unauthenticated" }', async () => {
    const saved = _finm_savedEnv();
    try {
      _finm_clearStore();
      SyncFlag.isEnabled = () => true;
      SyncAuth.getCurrentUser = () => null;
      let getCollectionCalled = false;
      SyncFirestore.getCollection = async () => { getCollectionCalled = true; return { docs: [] }; };

      const result = await SyncMergeFinances.merge(null);
      assertEqual(result.ok, false, 'ok:false');
      assertEqual(result.kind, 'unauthenticated', 'kind correct');
      assertEqual(getCollectionCalled, false, 'no cloud reads');
    } finally {
      _finm_restore(saved);
    }
  });

  it('13. local writeback — a cloud-origin month lands in the LOCAL finances map', async () => {
    const saved = _finm_savedEnv();
    try {
      _finm_clearStore();
      _finm_seedLocal({ '2026-06': _finm_makeRec('2026-06', 500, { savingsRate: 15 }) });
      const cloudRec = _finm_makeRec('2026-07', 1000, { savingsRate: 20, creditScore: 760 });
      _finm_install({ cloudDocs: [_finm_makeCloudDoc('2026-07', cloudRec)] });

      assertEqual(Finances.getMonth('2026-07'), null, 'precondition — cloud month not yet local');

      const result = await SyncMergeFinances.merge(null);
      assertEqual(result.ok, true, 'ok:true');

      const arrived = Finances.getMonth('2026-07');
      assert(arrived, 'cloud-origin month must be locally queryable after merge');
      assertEqual(arrived.savingsRate, 20, 'cloud month payload preserved locally');
      assertEqual(arrived.creditScore, 760, 'cloud month creditScore preserved locally');
      assert(Finances.getMonth('2026-06'), 'pre-existing local month preserved (lossless union)');
      assertEqual(Object.keys(Finances.getAll()).length, 2, 'union of cloud + local — no duplication');
    } finally {
      _finm_restore(saved);
    }
  });

});
