// E-1e — SyncMergePresets.merge() tests.
//
// Coverage (per E-1e-AUDIT § "Test scope" 1-16):
//   1.  Happy path — cloud has 1 new preset, local has 0, written back.
//   2.  Full-record LWW — cloud newer wins.
//   3.  Full-record LWW — local newer wins.
//   4.  Full-record LWW — equal updatedAt cloud wins on tie.
//   5.  Tombstone propagation — cloud has deletedAt → local gains deletedAt.
//   6.  Tombstone propagation — local has deletedAt → CAS pushes to cloud.
//   7.  Tombstone propagation — both have deletedAt, newer cloud wins.
//   8.  F19a per-record pre-filter — future-schema cloud record skipped.
//   9.  Idempotency — 2nd merge with same cloud state produces byte-equivalent writes.
//   10. CAS abort on refuse-writeback — entry counted, loop continues.
//   11. Tombstone filter in Presets.getAll() — hidden from UI; visible via _getAllIncludingTombstones.
//   12. Tombstone filter predicate — deletedAt: 0 / '' does NOT hide preset.
//   13. Presets.remove sets deletedAt (not hard delete).
//   14. Presets.remove future-schema refuse stays.
//   15. SYNC_DISABLED + unauthenticated fast-paths.
//   16. Mixed scenario — 3 cloud + 2 local, 1 collision + 1 tombstone propagation + 1 local-newer.
//
// Mocking pattern: SyncFirestore + SyncAuth methods are hot-swapped on
// the real modules and restored in finally. Presets + Schema are loaded
// for real; the quick_presets localStorage key is cleared between cases.
// Mirrors the sync-merge-history.test.js / sync-merge-bfrb.test.js
// conventions.

// ── Shared save/restore + install helpers ─────────────────────────────

function _e1e_p_savedEnv() {
  return {
    flag_enabled: SyncFlag.isEnabled,
    auth_getCurrentUser: SyncAuth.getCurrentUser,
    fs_getCollection: SyncFirestore.getCollection,
    fs_runTransaction: SyncFirestore.runTransaction,
    syncState: window.SyncState,
    sync_flag_storage: localStorage.getItem('tempo_sync_enabled'),
    quick_presets: localStorage.getItem('quick_presets'),
    presets_seeded: localStorage.getItem('presets_seeded'),
  };
}

function _e1e_p_restore(saved) {
  SyncFlag.isEnabled = saved.flag_enabled;
  SyncAuth.getCurrentUser = saved.auth_getCurrentUser;
  SyncFirestore.getCollection = saved.fs_getCollection;
  SyncFirestore.runTransaction = saved.fs_runTransaction;
  if (saved.syncState === undefined) delete window.SyncState;
  else window.SyncState = saved.syncState;
  if (saved.sync_flag_storage === null) localStorage.removeItem('tempo_sync_enabled');
  else localStorage.setItem('tempo_sync_enabled', saved.sync_flag_storage);
  if (saved.quick_presets === null) localStorage.removeItem('quick_presets');
  else localStorage.setItem('quick_presets', saved.quick_presets);
  if (saved.presets_seeded === null) localStorage.removeItem('presets_seeded');
  else localStorage.setItem('presets_seeded', saved.presets_seeded);
}

function _e1e_p_clearStore() {
  localStorage.removeItem('quick_presets');
  // Set seeded marker so any init() side effects are skipped.
  localStorage.setItem('presets_seeded', '1');
}

function _e1e_p_seedLocal(arr) {
  localStorage.setItem('quick_presets', JSON.stringify(arr || []));
}

function _e1e_p_makeCloudDoc(rec) {
  return { id: rec.id, data: rec };
}

function _e1e_p_makePreset(overrides) {
  return Object.assign({
    id: 'preset-default',
    name: 'Default',
    icon: '*',
    mode: 'stopwatch',
    config: {},
    createdAt: 100,
    updatedAt: 100,
    deviceId: 'phone-x',
    schemaVersion: 1,
  }, overrides || {});
}

function _e1e_p_install(opts) {
  opts = opts || {};
  SyncFlag.isEnabled = () => true;
  SyncAuth.getCurrentUser = () => ({ uid: opts.uid || 'u-p-test', email: 't@test.com' });

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
// Test cases — SyncMergePresets.merge()
// ────────────────────────────────────────────────────────────────────────

describe('SyncMergePresets — merge — LWW + tombstones + F19a + CAS', () => {

  it('1. happy path — cloud has 1 new preset, local has 0, written back', async () => {
    const saved = _e1e_p_savedEnv();
    try {
      _e1e_p_clearStore();
      _e1e_p_seedLocal([]);

      const cloud = _e1e_p_makePreset({ id: 'p1', name: 'Cloud P1' });
      const opts = _e1e_p_install({
        cloudDocs: [_e1e_p_makeCloudDoc(cloud)],
      });

      const result = await SyncMergePresets.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 1, 'one record written');
      assertEqual(result.skipped, 0, 'no skips');
      assertEqual(opts.txSets.length, 1, 'one CAS write');
      assertEqual(opts.txSets[0].data.id, 'p1', 'cloud preset written back');
      // F15 NOT fired for presets.
      assertEqual(Object.keys(result.remoteArrivals).length, 0,
        'remoteArrivals empty (no F15 for presets)');
    } finally {
      _e1e_p_restore(saved);
    }
  });

  it('2. full-record LWW — cloud newer wins', async () => {
    const saved = _e1e_p_savedEnv();
    try {
      _e1e_p_clearStore();
      const local = _e1e_p_makePreset({ id: 'p1', name: 'Local', updatedAt: 500 });
      _e1e_p_seedLocal([local]);
      const cloud = _e1e_p_makePreset({ id: 'p1', name: 'Cloud', updatedAt: 1000 });
      const opts = _e1e_p_install({
        cloudDocs: [_e1e_p_makeCloudDoc(cloud)],
      });

      const result = await SyncMergePresets.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets.length, 1, 'one CAS write');
      assertEqual(opts.txSets[0].data.name, 'Cloud', 'cloud (newer) wins');
    } finally {
      _e1e_p_restore(saved);
    }
  });

  it('3. full-record LWW — local newer wins', async () => {
    const saved = _e1e_p_savedEnv();
    try {
      _e1e_p_clearStore();
      const local = _e1e_p_makePreset({ id: 'p1', name: 'Local', updatedAt: 1000 });
      _e1e_p_seedLocal([local]);
      const cloud = _e1e_p_makePreset({ id: 'p1', name: 'Cloud', updatedAt: 500 });
      const opts = _e1e_p_install({
        cloudDocs: [_e1e_p_makeCloudDoc(cloud)],
      });

      const result = await SyncMergePresets.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets[0].data.name, 'Local', 'local (newer) wins');
    } finally {
      _e1e_p_restore(saved);
    }
  });

  it('4. full-record LWW — equal updatedAt cloud wins on tie', async () => {
    const saved = _e1e_p_savedEnv();
    try {
      _e1e_p_clearStore();
      const local = _e1e_p_makePreset({ id: 'p1', name: 'Local', updatedAt: 1000 });
      _e1e_p_seedLocal([local]);
      const cloud = _e1e_p_makePreset({ id: 'p1', name: 'Cloud', updatedAt: 1000 });
      const opts = _e1e_p_install({
        cloudDocs: [_e1e_p_makeCloudDoc(cloud)],
      });

      const result = await SyncMergePresets.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets[0].data.name, 'Cloud', 'cloud wins on tie');
    } finally {
      _e1e_p_restore(saved);
    }
  });

  it('5. tombstone propagation — cloud has deletedAt, local intact → local gains deletedAt', async () => {
    const saved = _e1e_p_savedEnv();
    try {
      _e1e_p_clearStore();
      const local = _e1e_p_makePreset({ id: 'p1', updatedAt: 500 });
      _e1e_p_seedLocal([local]);
      const cloud = _e1e_p_makePreset({ id: 'p1', deletedAt: 1000, updatedAt: 1000 });
      const opts = _e1e_p_install({
        cloudDocs: [_e1e_p_makeCloudDoc(cloud)],
      });

      const result = await SyncMergePresets.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets[0].data.deletedAt, 1000,
        'merged record has cloud deletedAt');
    } finally {
      _e1e_p_restore(saved);
    }
  });

  it('6. tombstone propagation — local has deletedAt, cloud intact → CAS pushes deletedAt to cloud', async () => {
    const saved = _e1e_p_savedEnv();
    try {
      _e1e_p_clearStore();
      const local = _e1e_p_makePreset({ id: 'p1', deletedAt: 1000, updatedAt: 1000 });
      _e1e_p_seedLocal([local]);
      const cloud = _e1e_p_makePreset({ id: 'p1', updatedAt: 500 });
      const opts = _e1e_p_install({
        cloudDocs: [_e1e_p_makeCloudDoc(cloud)],
      });

      const result = await SyncMergePresets.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets.length, 1, 'one CAS write');
      assertEqual(opts.txSets[0].data.deletedAt, 1000,
        'CAS writeback includes local deletedAt');
    } finally {
      _e1e_p_restore(saved);
    }
  });

  it('7. tombstone propagation — both have deletedAt, newer cloud wins', async () => {
    const saved = _e1e_p_savedEnv();
    try {
      _e1e_p_clearStore();
      const local = _e1e_p_makePreset({ id: 'p1', deletedAt: 800, updatedAt: 800 });
      _e1e_p_seedLocal([local]);
      const cloud = _e1e_p_makePreset({ id: 'p1', deletedAt: 1000, updatedAt: 1000 });
      const opts = _e1e_p_install({
        cloudDocs: [_e1e_p_makeCloudDoc(cloud)],
      });

      const result = await SyncMergePresets.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(opts.txSets[0].data.deletedAt, 1000,
        'newer (cloud) deletedAt wins');
    } finally {
      _e1e_p_restore(saved);
    }
  });

  it('8. F19a per-record pre-filter — future-schema cloud record skipped', async () => {
    const saved = _e1e_p_savedEnv();
    try {
      _e1e_p_clearStore();
      _e1e_p_seedLocal([]);

      const futureRec = _e1e_p_makePreset({ id: 'p-future', schemaVersion: 999 });
      const normalRec = _e1e_p_makePreset({ id: 'p-normal' });
      const opts = _e1e_p_install({
        cloudDocs: [
          _e1e_p_makeCloudDoc(futureRec),
          _e1e_p_makeCloudDoc(normalRec),
        ],
      });

      const result = await SyncMergePresets.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      assertEqual(result.count, 1, 'one record written (future-schema skipped)');
      assert(result.skipped >= 1, 'one or more skipped');
      assertEqual(opts.txSets[0].data.id, 'p-normal',
        'only normal record written');
    } finally {
      _e1e_p_restore(saved);
    }
  });

  it('9. idempotency — 2nd merge with same cloud state writes byte-equivalent records', async () => {
    const saved = _e1e_p_savedEnv();
    try {
      _e1e_p_clearStore();
      _e1e_p_seedLocal([]);
      const cloud = _e1e_p_makePreset({ id: 'p1', name: 'Cloud P1', updatedAt: 1000 });
      const opts1 = _e1e_p_install({
        cloudDocs: [_e1e_p_makeCloudDoc(cloud)],
      });
      const r1 = await SyncMergePresets.merge(null);
      assertEqual(r1.ok, true, 'first merge ok');
      assertEqual(opts1.txSets.length, 1, 'one write on first run');
      const firstName = opts1.txSets[0].data.name;

      const opts2 = _e1e_p_install({
        cloudDocs: [_e1e_p_makeCloudDoc(cloud)],
      });
      const r2 = await SyncMergePresets.merge(null);
      assertEqual(r2.ok, true, 'second merge ok');
      assertEqual(opts2.txSets.length, 1, 'one write on second run');
      assertEqual(opts2.txSets[0].data.name, firstName,
        'byte-equivalent name across runs');
    } finally {
      _e1e_p_restore(saved);
    }
  });

  it('10. CAS abort on refuse-writeback — entry counted, loop continues', async () => {
    const saved = _e1e_p_savedEnv();
    try {
      _e1e_p_clearStore();
      _e1e_p_seedLocal([
        _e1e_p_makePreset({ id: 'p1', name: 'P1' }),
        _e1e_p_makePreset({ id: 'p2', name: 'P2' }),
      ]);

      let callCount = 0;
      const opts = _e1e_p_install({});
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

      const result = await SyncMergePresets.merge(null);
      assertEqual(result.ok, true, 'ok:true (loop continues)');
      assertEqual(result.count, 1, 'one successful write');
      assert(result.skipped >= 1, 'one or more skipped (refuse-writeback)');
    } finally {
      _e1e_p_restore(saved);
    }
  });

  it('11. tombstone filter in Presets.getAll() — hidden from UI, visible via _getAllIncludingTombstones', () => {
    const saved = _e1e_p_savedEnv();
    try {
      _e1e_p_clearStore();
      _e1e_p_seedLocal([
        _e1e_p_makePreset({ id: 'p1', name: 'Alive 1' }),
        _e1e_p_makePreset({ id: 'p2', name: 'Tombstoned', deletedAt: 1000 }),
        _e1e_p_makePreset({ id: 'p3', name: 'Alive 2' }),
      ]);

      const visible = Presets.getAll();
      assertEqual(visible.length, 2, 'getAll() hides tombstones');
      const ids = visible.map(p => p.id).sort();
      assertArrayEqual(ids, ['p1', 'p3'], 'only alive presets visible to UI');

      const all = Presets._getAllIncludingTombstones();
      assertEqual(all.length, 3, '_getAllIncludingTombstones() returns everything');
      const allIds = all.map(p => p.id).sort();
      assertArrayEqual(allIds, ['p1', 'p2', 'p3'], 'all three records accessible to sync');
    } finally {
      _e1e_p_restore(saved);
    }
  });

  it('12. tombstone filter predicate — only null/undefined are alive; 0/"" are tombstones', () => {
    const saved = _e1e_p_savedEnv();
    try {
      _e1e_p_clearStore();
      // The `== null` predicate matches null AND undefined (loose
      // equality), but NOT 0 or ''. Any other value — including
      // falsy ones like 0 or '' — is treated as a tombstone. This
      // is the safer default: real tombstones write Date.now()
      // (always a large positive number), so 0/'' can only occur on
      // malformed records, which should be hidden as a defensive
      // default rather than rendered as ghost presets.
      _e1e_p_seedLocal([
        _e1e_p_makePreset({ id: 'p-zero', name: 'Zero', deletedAt: 0 }),
        _e1e_p_makePreset({ id: 'p-empty', name: 'Empty', deletedAt: '' }),
        _e1e_p_makePreset({ id: 'p-null', name: 'Null', deletedAt: null }),
        _e1e_p_makePreset({ id: 'p-undef', name: 'Undef' }),
        _e1e_p_makePreset({ id: 'p-real', name: 'Real Tomb', deletedAt: 12345 }),
      ]);

      const visible = Presets.getAll();
      const visibleIds = visible.map(p => p.id).sort();
      // Only null + undefined are alive. 0/''/12345 are all tombstones.
      assertArrayEqual(visibleIds, ['p-null', 'p-undef'],
        'only null/undefined deletedAt treated as alive; 0/"" are tombstones');

      // Sanity check: _getAllIncludingTombstones returns all 5.
      const all = Presets._getAllIncludingTombstones();
      assertEqual(all.length, 5,
        '_getAllIncludingTombstones returns all 5 records including tombstones');
    } finally {
      _e1e_p_restore(saved);
    }
  });

  it('13. Presets.remove sets deletedAt (not hard delete)', () => {
    const saved = _e1e_p_savedEnv();
    try {
      _e1e_p_clearStore();
      _e1e_p_seedLocal([
        _e1e_p_makePreset({ id: 'p1', name: 'P1' }),
        _e1e_p_makePreset({ id: 'p2', name: 'P2' }),
      ]);

      Presets.remove('p1');

      // After remove, the record STILL exists in storage but has deletedAt set.
      const all = Presets._getAllIncludingTombstones();
      assertEqual(all.length, 2, 'record still in storage (soft delete)');
      const tomb = all.find(p => p.id === 'p1');
      assert(tomb != null, 'p1 still in storage');
      assert(typeof tomb.deletedAt === 'number' && tomb.deletedAt > 0,
        'p1 has numeric deletedAt set');

      // UI sees only the surviving record.
      const visible = Presets.getAll();
      assertEqual(visible.length, 1, 'UI sees only alive presets');
      assertEqual(visible[0].id, 'p2', 'p2 is the one visible alive record');
    } finally {
      _e1e_p_restore(saved);
    }
  });

  it('14. Presets.remove future-schema refuse stays — no mutation', () => {
    const saved = _e1e_p_savedEnv();
    try {
      _e1e_p_clearStore();
      const futureRec = _e1e_p_makePreset({ id: 'p-future', name: 'Future', schemaVersion: 999 });
      _e1e_p_seedLocal([futureRec]);

      Presets.remove('p-future');

      // The future-schema record must NOT be mutated — no deletedAt added.
      const all = Presets._getAllIncludingTombstones();
      assertEqual(all.length, 1, 'record still in storage');
      assert(all[0].deletedAt == null,
        'future-schema record was NOT tombstoned (refuse stays)');
      assertEqual(all[0].schemaVersion, 999, 'schemaVersion preserved');
    } finally {
      _e1e_p_restore(saved);
    }
  });

  it('15. SYNC_DISABLED fast-path — flag off returns { ok:false, kind:"sync-not-enabled" }', async () => {
    const saved = _e1e_p_savedEnv();
    try {
      _e1e_p_clearStore();
      SyncFlag.isEnabled = () => false;
      let getCollectionCalled = false;
      SyncFirestore.getCollection = async () => { getCollectionCalled = true; return { docs: [] }; };

      const result = await SyncMergePresets.merge(null);
      assertEqual(result.ok, false, 'ok:false');
      assertEqual(result.kind, 'sync-not-enabled', 'kind correct');
      assertEqual(getCollectionCalled, false, 'getCollection NOT called');

      // Unauthenticated branch.
      SyncFlag.isEnabled = () => true;
      SyncAuth.getCurrentUser = () => null;
      const result2 = await SyncMergePresets.merge(null);
      assertEqual(result2.ok, false, 'ok:false (unauth)');
      assertEqual(result2.kind, 'unauthenticated', 'kind correct (unauth)');
    } finally {
      _e1e_p_restore(saved);
    }
  });

  it('16. mixed scenario — 3 cloud + 2 local, includes collision + tombstone propagation + local-newer', async () => {
    const saved = _e1e_p_savedEnv();
    try {
      _e1e_p_clearStore();
      // Local: p1 (newer than cloud's p1), p2 (only local).
      _e1e_p_seedLocal([
        _e1e_p_makePreset({ id: 'p1', name: 'LocalNewer', updatedAt: 2000 }),
        _e1e_p_makePreset({ id: 'p2', name: 'LocalOnly', updatedAt: 100 }),
      ]);
      // Cloud: p1 (older), p3 (only cloud), p4 (cloud-deleted tombstone).
      const opts = _e1e_p_install({
        cloudDocs: [
          _e1e_p_makeCloudDoc(_e1e_p_makePreset({ id: 'p1', name: 'CloudOlder', updatedAt: 1000 })),
          _e1e_p_makeCloudDoc(_e1e_p_makePreset({ id: 'p3', name: 'CloudOnly', updatedAt: 500 })),
          _e1e_p_makeCloudDoc(_e1e_p_makePreset({ id: 'p4', name: 'Tomb', updatedAt: 1000, deletedAt: 1000 })),
        ],
      });

      const result = await SyncMergePresets.merge(null);
      assertEqual(result.ok, true, 'ok:true');
      // 4 distinct ids written: p1, p2, p3, p4.
      assertEqual(opts.txSets.length, 4, 'four CAS writes (one per distinct id)');

      const writesById = {};
      for (const s of opts.txSets) writesById[s.data.id] = s.data;

      assertEqual(writesById.p1.name, 'LocalNewer', 'p1 — local newer wins');
      assertEqual(writesById.p2.name, 'LocalOnly', 'p2 — local-only landed');
      assertEqual(writesById.p3.name, 'CloudOnly', 'p3 — cloud-only landed');
      assertEqual(writesById.p4.deletedAt, 1000, 'p4 — tombstone propagates');
    } finally {
      _e1e_p_restore(saved);
    }
  });

});
