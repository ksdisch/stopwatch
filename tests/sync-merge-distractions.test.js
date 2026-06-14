// E-1d-f8 — SyncMergeDistractions.merge() tests.
//
// Coverage (per E-1d-f8-AUDIT § "Test scope"):
//   1.  Happy path — entries append-merge by (deviceId, timestamp) within session.
//   2.  Per-session merge isolation — sessionA doesn't bleed into sessionB.
//   3.  Dedup by (deviceId, timestamp) — cloud wins on sig collision.
//   4.  F19a per-record pre-filter — future-schema cloud entry skipped.
//   5.  F13 write gate during cycle — SyncState.canWrite=false visible mid-cycle.
//   6.  F13 gate release contract — merge fn never sets state to ready.
//   7.  Idempotency — 2nd merge with same cloud state produces byte-equivalent writes.
//   8.  CAS abort tolerance — refuse-writeback counted, loop continues.
//   9.  SYNC_DISABLED fast-path — flag off returns { ok:false, kind:'sync-not-enabled' }.
//   10. Unauthenticated — no user → { ok:false, kind:'unauthenticated' }.
//   11. Empty cloud collection — local entries all written.
//   12. Mixed contexts (flow + pomodoro) merge into respective context maps.
//   13. entryId derivation collides cleanly across contexts.
//
// Mocking pattern: SyncFirestore + SyncAuth methods are hot-swapped on
// the real modules and restored in finally (same convention as
// sync-merge-bfrb.test.js).

// ── Shared save/restore + install helpers ─────────────────────────────

function _e1d_f8_md_savedEnv() {
  return {
    flag_enabled: SyncFlag.isEnabled,
    auth_getCurrentUser: SyncAuth.getCurrentUser,
    fs_getCollection: SyncFirestore.getCollection,
    fs_runTransaction: SyncFirestore.runTransaction,
    syncState: window.SyncState,
    sync_flag_storage: localStorage.getItem('tempo_sync_enabled'),
    flow_dist: localStorage.getItem('flow_distractions'),
    pomo_dist: localStorage.getItem('pomodoro_distractions'),
    dist_marker: localStorage.getItem('tempo_distractions_migration_v1'),
  };
}

function _e1d_f8_md_restore(saved) {
  SyncFlag.isEnabled = saved.flag_enabled;
  SyncAuth.getCurrentUser = saved.auth_getCurrentUser;
  SyncFirestore.getCollection = saved.fs_getCollection;
  SyncFirestore.runTransaction = saved.fs_runTransaction;
  if (saved.syncState === undefined) delete window.SyncState;
  else window.SyncState = saved.syncState;
  if (saved.sync_flag_storage === null) localStorage.removeItem('tempo_sync_enabled');
  else localStorage.setItem('tempo_sync_enabled', saved.sync_flag_storage);
  if (saved.flow_dist === null) localStorage.removeItem('flow_distractions');
  else localStorage.setItem('flow_distractions', saved.flow_dist);
  if (saved.pomo_dist === null) localStorage.removeItem('pomodoro_distractions');
  else localStorage.setItem('pomodoro_distractions', saved.pomo_dist);
  if (saved.dist_marker === null) localStorage.removeItem('tempo_distractions_migration_v1');
  else localStorage.setItem('tempo_distractions_migration_v1', saved.dist_marker);
}

function _e1d_f8_md_clearStore() {
  localStorage.removeItem('flow_distractions');
  localStorage.removeItem('pomodoro_distractions');
  // Set marker so module-load migration is a no-op during test setup.
  localStorage.setItem('tempo_distractions_migration_v1', '1');
}

function _e1d_f8_md_seedLocal(context, sessionId, entries) {
  const key = context === 'flow' ? 'flow_distractions' : 'pomodoro_distractions';
  const map = JSON.parse(localStorage.getItem(key) || '{}');
  map[String(sessionId)] = entries;
  localStorage.setItem(key, JSON.stringify(map));
}

function _e1d_f8_md_makeCloudDoc(context, sessionId, rec) {
  const dev = (typeof rec.deviceId === 'string') ? rec.deviceId : 'no-device';
  const id = context + '-' + String(sessionId) + '-' + dev + '-' + rec.timestamp;
  const data = Object.assign({}, rec, { context, sessionId: String(sessionId) });
  return { id, data };
}

function _e1d_f8_md_makeEntry(deviceId, timestamp, extras) {
  return Object.assign({
    category: 'phone',
    timestamp,
    deviceId,
    updatedAt: timestamp,
    schemaVersion: 1,
  }, extras || {});
}

function _e1d_f8_md_install(opts) {
  opts = opts || {};
  SyncFlag.isEnabled = () => true;
  SyncAuth.getCurrentUser = () => ({ uid: opts.uid || 'u-dist-test', email: 't@test.com' });

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
// Test cases — SyncMergeDistractions.merge()
// ────────────────────────────────────────────────────────────────────────

describe('SyncMergeDistractions — merge — happy path + dedup + F19a + CAS', () => {

  it('1. happy path — entries append-merge by (deviceId, timestamp) within session', async () => {
    const saved = _e1d_f8_md_savedEnv();
    try {
      _e1d_f8_md_clearStore();
      _e1d_f8_md_seedLocal('flow', 'sessA', [_e1d_f8_md_makeEntry('local-dev', 1000)]);
      const cloudC = _e1d_f8_md_makeEntry('phone-2', 2000);
      const opts = _e1d_f8_md_install({
        cloudDocs: [_e1d_f8_md_makeCloudDoc('flow', 'sessA', cloudC)],
      });

      const result = await SyncMergeDistractions.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 2, 'two records written');
      assertEqual(result.skipped, 0, 'no skips');
      assertEqual(opts.txSets.length, 2, 'two CAS writes');
      const keys = Object.keys(result.remoteArrivals);
      assertEqual(keys.length, 0, 'remoteArrivals empty (no F15 for distractions)');
    } finally {
      _e1d_f8_md_restore(saved);
    }
  });

  it('2. per-session merge isolation — sessionA does not bleed into sessionB', async () => {
    const saved = _e1d_f8_md_savedEnv();
    try {
      _e1d_f8_md_clearStore();
      _e1d_f8_md_seedLocal('flow', 'sessB', [_e1d_f8_md_makeEntry('local-dev', 1000)]);
      const cloudA = _e1d_f8_md_makeEntry('phone-2', 2000);
      const opts = _e1d_f8_md_install({
        cloudDocs: [_e1d_f8_md_makeCloudDoc('flow', 'sessA', cloudA)],
      });

      const result = await SyncMergeDistractions.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 2, 'two records — one per session');
      const sessIds = opts.txSets.map(s => s.data.sessionId).sort();
      assertEqual(sessIds.join(','), 'sessA,sessB', 'each session has one entry');
    } finally {
      _e1d_f8_md_restore(saved);
    }
  });

  it('3. dedup by (deviceId, timestamp) — cloud wins on sig collision', async () => {
    const saved = _e1d_f8_md_savedEnv();
    try {
      _e1d_f8_md_clearStore();
      const local = _e1d_f8_md_makeEntry('shared-dev', 5000, { category: 'local-value' });
      _e1d_f8_md_seedLocal('flow', 'sessA', [local]);
      const cloud = _e1d_f8_md_makeEntry('shared-dev', 5000, { category: 'cloud-value' });
      const opts = _e1d_f8_md_install({
        cloudDocs: [_e1d_f8_md_makeCloudDoc('flow', 'sessA', cloud)],
      });

      const result = await SyncMergeDistractions.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 1, 'single entry after dedup');
      assertEqual(opts.txSets[0].data.category, 'cloud-value', 'cloud wins on sig collision');
    } finally {
      _e1d_f8_md_restore(saved);
    }
  });

  it('4. F19a per-record pre-filter — future-schema cloud entry skipped', async () => {
    const saved = _e1d_f8_md_savedEnv();
    try {
      _e1d_f8_md_clearStore();

      const futureRec = _e1d_f8_md_makeEntry('phone-2', 6000);
      futureRec.schemaVersion = 999;
      const normalRec = _e1d_f8_md_makeEntry('phone-2', 7000);

      const opts = _e1d_f8_md_install({
        cloudDocs: [
          _e1d_f8_md_makeCloudDoc('flow', 'sessA', futureRec),
          _e1d_f8_md_makeCloudDoc('flow', 'sessA', normalRec),
        ],
      });

      const result = await SyncMergeDistractions.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 1, 'one record written (future skipped)');
      assert(result.skipped >= 1, 'at least one skipped');
      assertEqual(opts.txSets[0].data.timestamp, 7000, 'normal record written');
    } finally {
      _e1d_f8_md_restore(saved);
    }
  });

  it('5. F13 write gate during cycle — merge succeeds while canWrite=false', async () => {
    const saved = _e1d_f8_md_savedEnv();
    try {
      _e1d_f8_md_clearStore();
      _e1d_f8_md_seedLocal('flow', 'sessA', [_e1d_f8_md_makeEntry('local-dev', 8000)]);

      const stateSets = [];
      window.SyncState = {
        get: () => 'hydrating',
        set: (s) => { stateSets.push(s); return true; },
        canWrite: () => false,
        isHydrating: () => true,
      };

      _e1d_f8_md_install({ syncState: window.SyncState });
      const result = await SyncMergeDistractions.merge(null);
      assertEqual(result.ok, true, 'merge succeeded under closed gate');
      assertEqual(result.count, 1, 'one record written');
      assertEqual(stateSets.length, 0, 'merge fn did not flip SyncState');
    } finally {
      _e1d_f8_md_restore(saved);
    }
  });

  it('6. F13 gate release contract — merge fn never sets state to ready', async () => {
    const saved = _e1d_f8_md_savedEnv();
    try {
      _e1d_f8_md_clearStore();
      const stateSets = [];
      window.SyncState = {
        get: () => 'ready',
        set: (s) => { stateSets.push(s); return true; },
        canWrite: () => true,
        isHydrating: () => false,
      };
      _e1d_f8_md_install({ syncState: window.SyncState });

      await SyncMergeDistractions.merge(null);
      assertEqual(stateSets.length, 0, 'merge fn never sets SyncState');
    } finally {
      _e1d_f8_md_restore(saved);
    }
  });

  it('7. idempotency — 2nd merge with same cloud state writes byte-equivalent records', async () => {
    const saved = _e1d_f8_md_savedEnv();
    try {
      _e1d_f8_md_clearStore();
      _e1d_f8_md_seedLocal('flow', 'sessA', [_e1d_f8_md_makeEntry('local-dev', 10000)]);
      const cloud = _e1d_f8_md_makeEntry('phone-2', 11000);

      const opts1 = _e1d_f8_md_install({ cloudDocs: [_e1d_f8_md_makeCloudDoc('flow', 'sessA', cloud)] });
      const r1 = await SyncMergeDistractions.merge(null);
      assertEqual(r1.ok, true, 'first merge ok');
      assertEqual(opts1.txSets.length, 2, 'two writes on first run');
      const firstWrites = opts1.txSets.map(s => JSON.stringify(s.data));

      const opts2 = _e1d_f8_md_install({ cloudDocs: [_e1d_f8_md_makeCloudDoc('flow', 'sessA', cloud)] });
      const r2 = await SyncMergeDistractions.merge(null);
      assertEqual(r2.ok, true, 'second merge ok');
      assertEqual(opts2.txSets.length, 2, 'two writes on second run too');
      const secondWrites = opts2.txSets.map(s => JSON.stringify(s.data));
      firstWrites.sort();
      secondWrites.sort();
      assertEqual(secondWrites.join('|'), firstWrites.join('|'), 'byte-equivalent writes');
    } finally {
      _e1d_f8_md_restore(saved);
    }
  });

  it('8. CAS abort tolerance — refuse-writeback counted, loop continues', async () => {
    const saved = _e1d_f8_md_savedEnv();
    try {
      _e1d_f8_md_clearStore();
      _e1d_f8_md_seedLocal('flow', 'sessA', [
        _e1d_f8_md_makeEntry('local-dev', 20000),
        _e1d_f8_md_makeEntry('local-dev', 21000),
      ]);

      let callCount = 0;
      const opts = _e1d_f8_md_install({});
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

      const result = await SyncMergeDistractions.merge(null);
      assertEqual(result.ok, true, 'ok:true (loop continues)');
      assertEqual(result.count, 1, 'one successful write');
      assert(result.skipped >= 1, 'one or more skipped');
    } finally {
      _e1d_f8_md_restore(saved);
    }
  });

  it('9. SYNC_DISABLED fast-path — flag off returns { ok:false, kind:"sync-not-enabled" }', async () => {
    const saved = _e1d_f8_md_savedEnv();
    try {
      _e1d_f8_md_clearStore();
      SyncFlag.isEnabled = () => false;
      let getCollectionCalled = false;
      SyncFirestore.getCollection = async () => { getCollectionCalled = true; return { docs: [] }; };

      const result = await SyncMergeDistractions.merge(null);
      assertEqual(result.ok, false, 'ok:false');
      assertEqual(result.kind, 'sync-not-enabled', 'kind correct');
      assertEqual(getCollectionCalled, false, 'getCollection NOT called');
    } finally {
      _e1d_f8_md_restore(saved);
    }
  });

  it('10. unauthenticated — no signed-in user → { ok:false, kind:"unauthenticated" }', async () => {
    const saved = _e1d_f8_md_savedEnv();
    try {
      _e1d_f8_md_clearStore();
      SyncFlag.isEnabled = () => true;
      SyncAuth.getCurrentUser = () => null;
      let getCollectionCalled = false;
      SyncFirestore.getCollection = async () => { getCollectionCalled = true; return { docs: [] }; };

      const result = await SyncMergeDistractions.merge(null);
      assertEqual(result.ok, false, 'ok:false');
      assertEqual(result.kind, 'unauthenticated', 'kind correct');
      assertEqual(getCollectionCalled, false, 'no cloud reads');
    } finally {
      _e1d_f8_md_restore(saved);
    }
  });

  it('11. empty cloud collection — all local entries written', async () => {
    const saved = _e1d_f8_md_savedEnv();
    try {
      _e1d_f8_md_clearStore();
      _e1d_f8_md_seedLocal('flow', 'sessA', [
        _e1d_f8_md_makeEntry('local-dev', 30000),
        _e1d_f8_md_makeEntry('local-dev', 30100),
      ]);
      _e1d_f8_md_seedLocal('pomodoro', 'sessB', [
        _e1d_f8_md_makeEntry('local-dev', 31000),
      ]);
      const opts = _e1d_f8_md_install({ cloudDocs: [] });

      const result = await SyncMergeDistractions.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 3, 'three local entries written');
      assertEqual(opts.txSets.length, 3, 'three CAS writes');
    } finally {
      _e1d_f8_md_restore(saved);
    }
  });

  it('12. mixed contexts (flow + pomodoro) merge into respective context maps', async () => {
    const saved = _e1d_f8_md_savedEnv();
    try {
      _e1d_f8_md_clearStore();
      _e1d_f8_md_seedLocal('flow', 'sessA', [_e1d_f8_md_makeEntry('local-dev', 40000)]);
      _e1d_f8_md_seedLocal('pomodoro', 'sessB', [_e1d_f8_md_makeEntry('local-dev', 41000)]);
      const opts = _e1d_f8_md_install({
        cloudDocs: [
          _e1d_f8_md_makeCloudDoc('flow', 'sessA', _e1d_f8_md_makeEntry('phone-2', 40500)),
          _e1d_f8_md_makeCloudDoc('pomodoro', 'sessB', _e1d_f8_md_makeEntry('phone-2', 41500)),
        ],
      });

      const result = await SyncMergeDistractions.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 4, 'four entries total (2 flow + 2 pomo)');

      const flowWrites = opts.txSets.filter(s => s.data.context === 'flow');
      const pomoWrites = opts.txSets.filter(s => s.data.context === 'pomodoro');
      assertEqual(flowWrites.length, 2, 'two flow writes');
      assertEqual(pomoWrites.length, 2, 'two pomodoro writes');
      for (const w of flowWrites) assertEqual(w.data.sessionId, 'sessA', 'flow sessionId preserved');
      for (const w of pomoWrites) assertEqual(w.data.sessionId, 'sessB', 'pomo sessionId preserved');
    } finally {
      _e1d_f8_md_restore(saved);
    }
  });

  it('13. entryId derivation collides cleanly across contexts (different doc paths for same deviceId+timestamp)', async () => {
    const saved = _e1d_f8_md_savedEnv();
    try {
      _e1d_f8_md_clearStore();
      // Same deviceId + timestamp in two different contexts. These MUST
      // produce different Firestore document ids — the context prefix
      // collapses the collision.
      _e1d_f8_md_seedLocal('flow', 'sessA', [_e1d_f8_md_makeEntry('shared-dev', 99999)]);
      _e1d_f8_md_seedLocal('pomodoro', 'sessA', [_e1d_f8_md_makeEntry('shared-dev', 99999)]);
      const opts = _e1d_f8_md_install({ cloudDocs: [] });

      const result = await SyncMergeDistractions.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 2, 'two distinct entries despite shared (deviceId, timestamp)');
      const paths = opts.txSets.map(s => s.path).sort();
      assert(paths[0] !== paths[1], 'distinct Firestore document paths');
      assert(paths[0].indexOf('flow-') >= 0 || paths[0].indexOf('pomodoro-') >= 0, 'context prefix in doc id');
    } finally {
      _e1d_f8_md_restore(saved);
    }
  });

});

// ────────────────────────────────────────────────────────────────────────
// H4 — cloud→local writeback. Before this fix the merge converged the CLOUD
// but never reprojected the merged set back into the local sessionId-keyed
// maps, so a distraction logged on another device was invisible here. The
// reprojection strips the transport-only context/sessionId stamped on cloud
// docs so local entries match native log() shape.
// ────────────────────────────────────────────────────────────────────────
describe('SyncMergeDistractions — H4 cloud→local writeback', () => {

  it('applies cloud-origin distractions into the LOCAL session maps after merge()', async () => {
    const saved = _e1d_f8_md_savedEnv();
    try {
      _e1d_f8_md_clearStore();
      // Local: one flow distraction in session 100.
      _e1d_f8_md_seedLocal('flow', 100, [_e1d_f8_md_makeEntry('local-dev', 1000, { category: 'noise' })]);
      // Cloud: another flow distraction in the SAME session (different device),
      // plus a brand-new pomodoro session that exists only in the cloud.
      const cloudFlow = _e1d_f8_md_makeEntry('phone-2', 2000, { category: 'phone' });
      const cloudPomo = _e1d_f8_md_makeEntry('phone-2', 3000, { category: 'slack' });
      _e1d_f8_md_install({
        cloudDocs: [
          _e1d_f8_md_makeCloudDoc('flow', 100, cloudFlow),
          _e1d_f8_md_makeCloudDoc('pomodoro', 200, cloudPomo),
        ],
      });

      const result = await SyncMergeDistractions.merge(null);
      assertEqual(result.ok, true, 'ok:true');

      const payload = Distractions.snapshotForSync().payload;
      // Flow session 100 now holds BOTH the local + cloud entry, time-sorted.
      const flow100 = payload.flow['100'] || [];
      assertEqual(flow100.length, 2, 'local + cloud-origin entries merged into the flow session');
      assertEqual(flow100[0].timestamp, 1000, 'local entry first (timestamp-sorted)');
      assertEqual(flow100[1].timestamp, 2000, 'cloud-origin entry now locally present');
      assertEqual(flow100[1].deviceId, 'phone-2', 'cloud-origin attribution preserved');
      assertEqual(flow100[1].category, 'phone', 'cloud-origin payload preserved');
      // The transport-only fields are stripped (native log() shape).
      assertEqual('context' in flow100[1], false, 'context stripped from local entry');
      assertEqual('sessionId' in flow100[1], false, 'sessionId stripped from local entry');
      // The new cloud-origin pomodoro session landed locally too.
      const pomo200 = payload.pomodoro['200'] || [];
      assertEqual(pomo200.length, 1, 'cloud-origin pomodoro session created locally');
      assertEqual(pomo200[0].timestamp, 3000, 'cloud-origin pomodoro entry present');
    } finally {
      _e1d_f8_md_restore(saved);
    }
  });

  it('does not lose a local-only session when the cloud is empty', async () => {
    const saved = _e1d_f8_md_savedEnv();
    try {
      _e1d_f8_md_clearStore();
      _e1d_f8_md_seedLocal('flow', 100, [_e1d_f8_md_makeEntry('local-dev', 1000)]);
      _e1d_f8_md_seedLocal('pomodoro', 200, [_e1d_f8_md_makeEntry('local-dev', 1500)]);
      _e1d_f8_md_install({ cloudDocs: [] });

      await SyncMergeDistractions.merge(null);

      const payload = Distractions.snapshotForSync().payload;
      assertEqual((payload.flow['100'] || []).length, 1, 'local flow session preserved');
      assertEqual((payload.pomodoro['200'] || []).length, 1, 'local pomodoro session preserved');
    } finally {
      _e1d_f8_md_restore(saved);
    }
  });

});
