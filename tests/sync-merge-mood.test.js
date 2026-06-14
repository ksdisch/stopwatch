// Life-OS Phase 3 — SyncMergeMood.merge() tests (mood_events, 7th store).
//
// Coverage (clones sync-merge-bfrb.test.js, adapted to the `at` field —
// ADR-0008's contract — instead of bfrb's `takenAt`):
//   1.  Happy path — events append-merge by (deviceId, at).
//   2.  Dedup by (deviceId, at) — cloud wins on sig collision.
//   3.  F19a per-record pre-filter — future-schema cloud entry skipped.
//   4.  F13 write gate during cycle — SyncState.canWrite returns false mid-cycle.
//   5.  F13 gate releases after cycle — dispatcher's responsibility (sanity check).
//   6.  Idempotency — 2nd merge with same cloud state produces zero net new.
//   7.  CAS abort tolerance — refuse-writeback counted, loop continues.
//   8.  SYNC_DISABLED fast-path — flag off returns { ok:false, kind:'sync-not-enabled' }.
//   9.  Unauthenticated — no user → { ok:false, kind:'unauthenticated' }.
//   10. Empty cloud — local entries all written.
//   11. Optional fields pass through writeback — tags/note/context preserved.
//   12. Mixed context values merge into one stream.
//
// Mocking pattern: SyncFirestore + SyncAuth methods are hot-swapped on
// the real modules and restored in finally (same convention as
// sync-merge-bfrb.test.js / sync-merge-meds.test.js).

// ── Shared save/restore + install helpers ─────────────────────────────

function _mm_savedEnv() {
  return {
    flag_enabled: SyncFlag.isEnabled,
    auth_getCurrentUser: SyncAuth.getCurrentUser,
    fs_getCollection: SyncFirestore.getCollection,
    fs_runTransaction: SyncFirestore.runTransaction,
    syncState: window.SyncState,
    sync_flag_storage: localStorage.getItem('tempo_sync_enabled'),
    mood_events: localStorage.getItem('mood_events'),
  };
}

function _mm_restore(saved) {
  SyncFlag.isEnabled = saved.flag_enabled;
  SyncAuth.getCurrentUser = saved.auth_getCurrentUser;
  SyncFirestore.getCollection = saved.fs_getCollection;
  SyncFirestore.runTransaction = saved.fs_runTransaction;
  if (saved.syncState === undefined) delete window.SyncState;
  else window.SyncState = saved.syncState;
  if (saved.sync_flag_storage === null) localStorage.removeItem('tempo_sync_enabled');
  else localStorage.setItem('tempo_sync_enabled', saved.sync_flag_storage);
  if (saved.mood_events === null) localStorage.removeItem('mood_events');
  else localStorage.setItem('mood_events', saved.mood_events);
}

function _mm_clearStore() {
  localStorage.removeItem('mood_events');
}

function _mm_seedLocal(entries) {
  localStorage.setItem('mood_events', JSON.stringify(entries));
}

function _mm_makeCloudDoc(rec) {
  const dev = (typeof rec.deviceId === 'string') ? rec.deviceId : 'no-device';
  return { id: dev + '-' + rec.at, data: rec };  // NOTE: `at`, not `takenAt`
}

function _mm_makeEntry(deviceId, at, context, extras) {
  return Object.assign({
    at,
    valence: 3,
    context: context || 'global',
    deviceId,
    updatedAt: at,
    schemaVersion: 1,
  }, extras || {});
}

function _mm_install(opts) {
  opts = opts || {};
  SyncFlag.isEnabled = () => true;
  SyncAuth.getCurrentUser = () => ({ uid: opts.uid || 'u-mood-test', email: 't@test.com' });

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
// Test cases — SyncMergeMood.merge()
// ────────────────────────────────────────────────────────────────────────

describe('SyncMergeMood — merge — happy path + dedup + F19a + CAS', () => {

  it('1. happy path — events append-merge by (deviceId, at)', async () => {
    const saved = _mm_savedEnv();
    try {
      _mm_clearStore();
      const localA = _mm_makeEntry('local-dev', 1000, 'global');
      const localB = _mm_makeEntry('local-dev', 2000, 'global');
      _mm_seedLocal([localA, localB]);

      const cloudC = _mm_makeEntry('phone-2', 3000, 'global');
      const opts = _mm_install({
        cloudDocs: [_mm_makeCloudDoc(cloudC)],
      });

      const result = await SyncMergeMood.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 3, 'three records written back');
      assertEqual(result.skipped, 0, 'no skips');
      assertEqual(opts.txSets.length, 3, 'three CAS writes');
      // Document paths use the mood_events collection + deviceId-at ids.
      assert(opts.txSets[0].path.indexOf('/mood_events/') !== -1, 'writes target mood_events collection');
      assertEqual(opts.txSets[0].path.split('/').pop(), 'local-dev-1000', 'doc id is deviceId-at');
      // remoteArrivals always {} for mood events (no F15).
      const keys = Object.keys(result.remoteArrivals);
      assertEqual(keys.length, 0, 'remoteArrivals is empty (no F15 for mood_events)');
    } finally {
      _mm_restore(saved);
    }
  });

  it('2. dedup by (deviceId, at) — cloud wins on sig collision', async () => {
    const saved = _mm_savedEnv();
    try {
      _mm_clearStore();
      // Same sig (deviceId, at) — but different `note` value to detect winner.
      const local = _mm_makeEntry('shared-dev', 5000, 'global', { note: 'local-state' });
      _mm_seedLocal([local]);
      const cloud = _mm_makeEntry('shared-dev', 5000, 'global', { note: 'cloud-state' });
      const opts = _mm_install({
        cloudDocs: [_mm_makeCloudDoc(cloud)],
      });

      const result = await SyncMergeMood.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 1, 'single entry (dedup)');
      assertEqual(opts.txSets.length, 1, 'one CAS write');
      assertEqual(opts.txSets[0].data.note, 'cloud-state', 'cloud entry wins on sig collision');
    } finally {
      _mm_restore(saved);
    }
  });

  it('3. F19a per-record pre-filter — future-schema cloud entry skipped', async () => {
    const saved = _mm_savedEnv();
    try {
      _mm_clearStore();
      _mm_seedLocal([]);

      const futureRec = _mm_makeEntry('phone-2', 6000, 'global');
      futureRec.schemaVersion = 999; // future schema
      const normalRec = _mm_makeEntry('phone-2', 7000, 'global');

      const opts = _mm_install({
        cloudDocs: [_mm_makeCloudDoc(futureRec), _mm_makeCloudDoc(normalRec)],
      });

      const result = await SyncMergeMood.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 1, 'one record written (future-schema skipped)');
      assert(result.skipped >= 1, 'at least one skipped');
      // Confirm the written record is the non-future one.
      assertEqual(opts.txSets.length, 1, 'one CAS write');
      assertEqual(opts.txSets[0].data.at, 7000, 'normal record written');
    } finally {
      _mm_restore(saved);
    }
  });

  it('4. F13 write gate during cycle — SyncState.canWrite=false visible during merge', async () => {
    const saved = _mm_savedEnv();
    try {
      _mm_clearStore();
      _mm_seedLocal([_mm_makeEntry('local-dev', 8000, 'global')]);

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

      _mm_install({ syncState: window.SyncState });

      const result = await SyncMergeMood.merge(null);
      assertEqual(result.ok, true, 'merge succeeded under closed gate');
      assertEqual(result.count, 1, 'one record written');
      // Merge function does NOT flip state on its own — dispatcher's job.
      assertEqual(stateSets.length, 0, 'merge fn did not flip SyncState');
    } finally {
      _mm_restore(saved);
    }
  });

  it('5. F13 gate release contract — merge fn never sets state to ready (dispatcher does)', async () => {
    // Sanity check: confirms the inverse of test #4. The dispatcher's
    // contract is to flip state AROUND the merge call; this test
    // documents that merge never sets state to 'ready' on its own.
    const saved = _mm_savedEnv();
    try {
      _mm_clearStore();
      _mm_seedLocal([]);

      const stateSets = [];
      window.SyncState = {
        get: () => 'ready',
        set: (s) => { stateSets.push(s); return true; },
        canWrite: () => true,
        isHydrating: () => false,
      };

      _mm_install({ syncState: window.SyncState });

      await SyncMergeMood.merge(null);
      assertEqual(stateSets.length, 0, 'merge fn never sets SyncState');
    } finally {
      _mm_restore(saved);
    }
  });

  it('6. idempotency — 2nd merge with same cloud state writes byte-equivalent records', async () => {
    const saved = _mm_savedEnv();
    try {
      _mm_clearStore();
      _mm_seedLocal([_mm_makeEntry('local-dev', 10000, 'global')]);

      const cloud = _mm_makeEntry('phone-2', 11000, 'flow', { tags: ['stressed'] });
      const opts1 = _mm_install({ cloudDocs: [_mm_makeCloudDoc(cloud)] });
      const r1 = await SyncMergeMood.merge(null);
      assertEqual(r1.ok, true, 'first merge ok');
      assertEqual(opts1.txSets.length, 2, 'two writes on first run');
      const firstWrites = opts1.txSets.map(s => JSON.stringify(s.data));

      // Re-run with the SAME cloud state.
      const opts2 = _mm_install({ cloudDocs: [_mm_makeCloudDoc(cloud)] });
      const r2 = await SyncMergeMood.merge(null);
      assertEqual(r2.ok, true, 'second merge ok');
      // Both runs write the same set of records (idempotent).
      assertEqual(opts2.txSets.length, 2, 'two writes on second run too');
      const secondWrites = opts2.txSets.map(s => JSON.stringify(s.data));
      firstWrites.sort();
      secondWrites.sort();
      assertEqual(secondWrites.join('|'), firstWrites.join('|'), 'byte-equivalent writes');
    } finally {
      _mm_restore(saved);
    }
  });

  it('7. CAS abort tolerance — refuse-writeback counted, loop continues', async () => {
    const saved = _mm_savedEnv();
    try {
      _mm_clearStore();
      _mm_seedLocal([
        _mm_makeEntry('local-dev', 20000, 'global'),
        _mm_makeEntry('local-dev', 21000, 'global'),
      ]);

      // Mock runTransaction to throw refuse-writeback on entry #1, succeed on #2.
      let callCount = 0;
      const opts = _mm_install({});
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

      const result = await SyncMergeMood.merge(null);
      assertEqual(result.ok, true, 'ok:true (loop continues)');
      assertEqual(result.count, 1, 'one successful write');
      assert(result.skipped >= 1, 'one or more skipped (refuse-writeback)');
    } finally {
      _mm_restore(saved);
    }
  });

  it('8. SYNC_DISABLED fast-path — flag off returns { ok:false, kind:"sync-not-enabled" }', async () => {
    const saved = _mm_savedEnv();
    try {
      _mm_clearStore();
      SyncFlag.isEnabled = () => false;
      let getCollectionCalled = false;
      let runTransactionCalled = false;
      SyncFirestore.getCollection = async () => { getCollectionCalled = true; return { docs: [] }; };
      SyncFirestore.runTransaction = async () => { runTransactionCalled = true; };

      const result = await SyncMergeMood.merge(null);
      assertEqual(result.ok, false, 'ok:false');
      assertEqual(result.kind, 'sync-not-enabled', 'kind correct');
      assertEqual(getCollectionCalled, false, 'getCollection NOT called');
      assertEqual(runTransactionCalled, false, 'runTransaction NOT called');
    } finally {
      _mm_restore(saved);
    }
  });

  it('9. unauthenticated — no signed-in user → { ok:false, kind:"unauthenticated" }', async () => {
    const saved = _mm_savedEnv();
    try {
      _mm_clearStore();
      SyncFlag.isEnabled = () => true;
      SyncAuth.getCurrentUser = () => null;
      let getCollectionCalled = false;
      SyncFirestore.getCollection = async () => { getCollectionCalled = true; return { docs: [] }; };

      const result = await SyncMergeMood.merge(null);
      assertEqual(result.ok, false, 'ok:false');
      assertEqual(result.kind, 'unauthenticated', 'kind correct');
      assertEqual(getCollectionCalled, false, 'no cloud reads');
    } finally {
      _mm_restore(saved);
    }
  });

  it('10. empty cloud — no events in cloud → ok:true, all local written', async () => {
    const saved = _mm_savedEnv();
    try {
      _mm_clearStore();
      _mm_seedLocal([
        _mm_makeEntry('local-dev', 30000, 'global'),
        _mm_makeEntry('local-dev', 31000, 'flow'),
        _mm_makeEntry('local-dev', 32000, 'pomodoro'),
      ]);
      const opts = _mm_install({ cloudDocs: [] });

      const result = await SyncMergeMood.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 3, 'three local entries written');
      assertEqual(opts.txSets.length, 3, 'three CAS writes');
    } finally {
      _mm_restore(saved);
    }
  });

  it('11. optional fields pass through writeback — valence/tags/note preserved', async () => {
    const saved = _mm_savedEnv();
    try {
      _mm_clearStore();
      _mm_seedLocal([
        _mm_makeEntry('local-dev', 40000, 'flow', { valence: 5, tags: ['calm', 'content'] }),
        _mm_makeEntry('local-dev', 41000, 'global', { valence: 1, note: 'rough morning' }),
      ]);
      const opts = _mm_install({});

      const result = await SyncMergeMood.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets.length, 2, 'two writes');

      const flowWrite = opts.txSets.find(s => s.data.context === 'flow');
      assertEqual(flowWrite.data.valence, 5, 'flow valence preserved');
      assertEqual(flowWrite.data.tags.join(','), 'calm,content', 'flow tags preserved');

      const globalWrite = opts.txSets.find(s => s.data.context === 'global');
      assertEqual(globalWrite.data.valence, 1, 'global valence preserved');
      assertEqual(globalWrite.data.note, 'rough morning', 'global note preserved');
    } finally {
      _mm_restore(saved);
    }
  });

  it('12. mixed context values merge into one stream — dedup is by (deviceId, at) regardless of context', async () => {
    const saved = _mm_savedEnv();
    try {
      _mm_clearStore();
      _mm_seedLocal([
        _mm_makeEntry('local-dev', 50000, 'global'),
        _mm_makeEntry('local-dev', 50500, 'flow'),
      ]);
      const opts = _mm_install({
        cloudDocs: [
          _mm_makeCloudDoc(_mm_makeEntry('phone-2', 50250, 'pomodoro')),
          _mm_makeCloudDoc(_mm_makeEntry('phone-2', 50750, 'global')),
        ],
      });

      const result = await SyncMergeMood.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 4, 'four entries (mixed contexts merged)');

      const contexts = opts.txSets.map(s => s.data.context).sort();
      assertEqual(contexts.join(','), 'flow,global,global,pomodoro', 'all three contexts survive');
    } finally {
      _mm_restore(saved);
    }
  });

});

// ────────────────────────────────────────────────────────────────────────
// H4 — cloud→local writeback (mirrors sync-merge-bfrb). Before this fix the
// merge converged the CLOUD but never applied cloud-origin mood arrivals back
// to the local mood_events array. Mood is append-only/immutable (ADR-0008), so
// the merged set is a lossless superset of prior local state.
// ────────────────────────────────────────────────────────────────────────
describe('SyncMergeMood — H4 cloud→local writeback', () => {

  it('applies a cloud-origin mood to LOCAL storage so getAll() returns it after merge()', async () => {
    const saved = _mm_savedEnv();
    try {
      _mm_clearStore();
      _mm_seedLocal([_mm_makeEntry('local-dev', 1000, 'global', { valence: 4 })]);
      const cloudC = _mm_makeEntry('phone-2', 3000, 'flow', { valence: 2, note: 'rough day' });
      _mm_install({ cloudDocs: [_mm_makeCloudDoc(cloudC)] });

      assertEqual(Mood.getAll().some(e => e.at === 3000), false,
        'precondition — cloud-origin mood not yet local');

      const result = await SyncMergeMood.merge(null);
      assertEqual(result.ok, true, 'ok:true');

      const all = Mood.getAll();
      const arrived = all.find(e => e.at === 3000 && e.deviceId === 'phone-2');
      assert(arrived, 'cloud-origin mood must be locally queryable after merge (H4)');
      assertEqual(arrived.context, 'flow', 'cloud mood payload preserved locally');
      assertEqual(arrived.note, 'rough day', 'cloud mood note preserved locally');
      assert(all.some(e => e.at === 1000 && e.deviceId === 'local-dev'),
        'pre-existing local mood preserved (lossless union)');
      assertEqual(all.length, 2, 'union of cloud + local — no duplication');
    } finally {
      _mm_restore(saved);
    }
  });

  it('cloud wins on (deviceId, at) collision in the LOCAL store too', async () => {
    const saved = _mm_savedEnv();
    try {
      _mm_clearStore();
      _mm_seedLocal([_mm_makeEntry('shared-dev', 5000, 'global', { note: 'local-state' })]);
      const cloud = _mm_makeEntry('shared-dev', 5000, 'global', { note: 'cloud-state' });
      _mm_install({ cloudDocs: [_mm_makeCloudDoc(cloud)] });

      await SyncMergeMood.merge(null);

      const all = Mood.getAll();
      assertEqual(all.length, 1, 'collision deduped in the local store');
      assertEqual(all[0].note, 'cloud-state',
        'cloud value wins locally — matches the CAS writeback winner');
    } finally {
      _mm_restore(saved);
    }
  });

  it('a local-only mood is not lost when the cloud is empty', async () => {
    const saved = _mm_savedEnv();
    try {
      _mm_clearStore();
      _mm_seedLocal([_mm_makeEntry('local-dev', 9000, 'global')]);
      _mm_install({ cloudDocs: [] });

      await SyncMergeMood.merge(null);

      const all = Mood.getAll();
      assertEqual(all.length, 1, 'local-only mood survives the local writeback');
      assertEqual(all[0].at, 9000, 'the local mood is intact');
    } finally {
      _mm_restore(saved);
    }
  });

});
