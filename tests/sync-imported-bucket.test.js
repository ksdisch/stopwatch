// D-1 — Stage D imported-bucket reconcile tests.
//
// Covers:
//   Group A: MedsManager._reconcileWriteRaw (3 cases)
//   Group B: SyncEngine.reconcileImportedBucket — happy path (5 cases)
//   Group C: SyncEngine.reconcileImportedBucket — failure paths (4 cases)
//   Group D: SyncEngine.reconcileImportedBucket — re-entry + events (3 cases)
//   Group E: SyncEngine.reconcileImportedBucket — merge collision rules (2 cases)
//   Group F: ManualDedupe.scan (6 cases)
//
// Stubbing strategy (mirrors sync-hydrate.test.js):
//   - SyncFlag, SyncAuth, SyncFirestore, SyncState are stubbed per-case.
//   - MedsManager is loaded for real — those tests exercise the real
//     in-memory + localStorage path.
//   - History is NOT loaded by tests/index.html (loading it would change
//     `typeof History` from undefined → object in code paths like
//     pomodoro.js's `_phaseDeviceId`, breaking existing tests). The
//     History-coupled D-1 tests (bucket overlay in addSession, getAllTags
//     regression, History._reconcileWriteRaw IDB write, snapshotForSync
//     bucket field) cannot run in this harness and are skipped here —
//     they're enforced manually per the audit's "Manual setup steps".
//   - For orchestrator + ManualDedupe tests, we install `window.History`
//     stubs per-case. `typeof History` in engine code falls through to
//     `window.History` when the lexical `History` is undeclared.
//   - Each test resets the hydrate-marker family + stage-d-handoff flag
//     + the meds/* localStorage namespace in before/finally.

// ── Shared helpers (D-1 prefix) ──────────────────────────────────────────

function _d1_snapshotMarkers() {
  return {
    rest_log: localStorage.getItem('tempo_sync_hydrated_rest_log'),
    meds:     localStorage.getItem('tempo_sync_hydrated_meds'),
    presets:  localStorage.getItem('tempo_sync_hydrated_presets'),
    history:  localStorage.getItem('tempo_sync_hydrated_history'),
    all:      localStorage.getItem('tempo_sync_hydrated_all'),
    stageD:   localStorage.getItem('tempo_sync_stage_d_handoff'),
    flag:     localStorage.getItem('tempo_sync_enabled'),
    partial:  localStorage.getItem('tempo_sync_partial_upload_uid'),
    seeded:   localStorage.getItem('presets_seeded'),
    presetsKey: localStorage.getItem('quick_presets'),
    restLogKey: localStorage.getItem('wellness_rest_log'),
    hideImported: localStorage.getItem('history_hide_imported'),
  };
}
function _d1_clearMarkers() {
  localStorage.removeItem('tempo_sync_hydrated_rest_log');
  localStorage.removeItem('tempo_sync_hydrated_meds');
  localStorage.removeItem('tempo_sync_hydrated_presets');
  localStorage.removeItem('tempo_sync_hydrated_history');
  localStorage.removeItem('tempo_sync_hydrated_all');
  localStorage.removeItem('tempo_sync_stage_d_handoff');
  localStorage.removeItem('tempo_sync_partial_upload_uid');
}
function _d1_restoreMarkers(snap) {
  for (const [k, v] of [
    ['tempo_sync_hydrated_rest_log', snap.rest_log],
    ['tempo_sync_hydrated_meds', snap.meds],
    ['tempo_sync_hydrated_presets', snap.presets],
    ['tempo_sync_hydrated_history', snap.history],
    ['tempo_sync_hydrated_all', snap.all],
    ['tempo_sync_stage_d_handoff', snap.stageD],
    ['tempo_sync_enabled', snap.flag],
    ['tempo_sync_partial_upload_uid', snap.partial],
    ['presets_seeded', snap.seeded],
    ['quick_presets', snap.presetsKey],
    ['wellness_rest_log', snap.restLogKey],
    ['history_hide_imported', snap.hideImported],
  ]) {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  }
}

function _d1_snapshotMedsKeys() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && (k.startsWith('meds/') || k === 'wellness_meds')) {
      out.push([k, localStorage.getItem(k)]);
    }
  }
  return out;
}
function _d1_clearMedsKeys() {
  const toClean = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && (k.startsWith('meds/') || k === 'wellness_meds')) toClean.push(k);
  }
  for (const k of toClean) localStorage.removeItem(k);
  if (typeof MedsManager !== 'undefined' && MedsManager.clear) MedsManager.clear();
}
function _d1_restoreMedsKeys(saved) {
  _d1_clearMedsKeys();
  for (const [k, v] of saved) localStorage.setItem(k, v);
  if (typeof MedsManager !== 'undefined' && MedsManager.loadAll) MedsManager.loadAll();
}

// Save/restore module method references. Mirrors sync-hydrate.test.js's
// pattern — we mutate methods on the real modules and restore them in finally.
function _d1_saveModuleMethods() {
  return {
    flag_isEnabled: SyncFlag.isEnabled,
    auth_getCurrentUser: SyncAuth.getCurrentUser,
    fs_getCollection: SyncFirestore.getCollection,
    fs_setDoc: SyncFirestore.setDoc,
    meds_all: MedsManager.all,
    meds_reconcileRaw: MedsManager._reconcileWriteRaw,
    presets_snap: Presets.snapshotForSync,
    presets_hydrateRaw: Presets._hydrateWriteRaw,
    history: window.History,
    recoveryUI: window.RecoveryUI,
    syncState: window.SyncState,
  };
}
function _d1_restoreModuleMethods(orig) {
  SyncFlag.isEnabled = orig.flag_isEnabled;
  SyncAuth.getCurrentUser = orig.auth_getCurrentUser;
  SyncFirestore.getCollection = orig.fs_getCollection;
  SyncFirestore.setDoc = orig.fs_setDoc;
  MedsManager.all = orig.meds_all;
  MedsManager._reconcileWriteRaw = orig.meds_reconcileRaw;
  Presets.snapshotForSync = orig.presets_snap;
  Presets._hydrateWriteRaw = orig.presets_hydrateRaw;
  if (orig.history === undefined) delete window.History;
  else window.History = orig.history;
  if (orig.recoveryUI === undefined) delete window.RecoveryUI;
  else window.RecoveryUI = orig.recoveryUI;
  if (orig.syncState === undefined) delete window.SyncState;
  else window.SyncState = orig.syncState;
}

// Per-test stub installer. Defaults: sync flag on, signed in,
// SyncState 'ready', empty cloud, empty local.
function _d1_install(s) {
  s = s || {};
  SyncFlag.isEnabled = s.flag_isEnabled || (() => true);
  SyncAuth.getCurrentUser = s.auth_getCurrentUser || (() => ({ uid: 'u1' }));
  SyncFirestore.getCollection = s.fs_getCollection || (async () => ({ docs: [], count: 0 }));
  SyncFirestore.setDoc = s.fs_setDoc || (async () => ({ ok: true }));

  window.History = s.history || {
    getDeviceId: () => 'mock-device-d1',
    getSessions: async () => [],
    _reconcileWriteRaw: async () => ({ written: 0, skipped: 0 }),
  };
  window.RecoveryUI = s.recoveryUI || {
    loadLog: () => ({}),
    _hydrateWriteRaw: () => ({ written: 0, skipped: 0 }),
  };

  if (s.medsAll !== undefined) MedsManager.all = s.medsAll;
  // _reconcileWriteRaw — for orchestrator tests, override with a spy;
  // for engine tests, leave real (which is the default).
  if (s.medsReconcileRaw !== undefined) MedsManager._reconcileWriteRaw = s.medsReconcileRaw;

  if (s.presetsSnap !== undefined) Presets.snapshotForSync = s.presetsSnap;
  else Presets.snapshotForSync = () => ({ deviceId: 'd', schemaVersion: 1, payload: { presets: [] } });
  if (s.presetsHydrateRaw !== undefined) Presets._hydrateWriteRaw = s.presetsHydrateRaw;
  else Presets._hydrateWriteRaw = () => ({ written: 0, skipped: 0 });

  if (s.syncStateObj === undefined) {
    window.SyncState = _d1_makeSyncStateSpy('ready').obj;
  } else if (s.syncStateObj === null) {
    delete window.SyncState;
  } else {
    window.SyncState = s.syncStateObj;
  }
}

function _d1_makeSyncStateSpy(initial) {
  let state = initial || 'ready';
  const sets = [];
  const obj = {
    get: () => state,
    set: (s) => { sets.push(s); state = s; return true; },
    canWrite: () => state === 'ready',
    isHydrating: () => state === 'hydrating',
    STORAGE_KEY: 'tempo_sync_state',
  };
  return { spy: sets, obj, setDirect: (s) => { state = s; } };
}

// ────────────────────────────────────────────────────────────────────────
// Group A: MedsManager._reconcileWriteRaw
// ────────────────────────────────────────────────────────────────────────

describe('D-1 MedsManager._reconcileWriteRaw — writes records verbatim, calls loadAll() to rehydrate', () => {
  it('records land in localStorage AND become accessible via MedsManager.get()', () => {
    const medsSnap = _d1_snapshotMedsKeys();
    _d1_clearMedsKeys();
    try {
      const records = [
        { id: 'd1-med-a', name: 'Adderall', dose: '20 mg', frequency: 'twice-daily', schemaVersion: 1, deviceId: 'd', updatedAt: 1, doseLog: [], originDeviceId: 'device-A' },
        { id: 'd1-med-b', name: 'Vyvanse', dose: '40 mg', frequency: 'once-daily', schemaVersion: 1, deviceId: 'd', updatedAt: 2, doseLog: [] },
      ];
      const result = MedsManager._reconcileWriteRaw(records);
      assertEqual(result.written, 2, 'two records written');

      // Disk state.
      const onDiskA = localStorage.getItem('meds/d1-med-a');
      const onDiskB = localStorage.getItem('meds/d1-med-b');
      assert(onDiskA !== null, 'd1-med-a on disk');
      assert(onDiskB !== null, 'd1-med-b on disk');
      const parsedA = JSON.parse(onDiskA);
      assertEqual(parsedA.name, 'Adderall', 'on-disk name correct');
      assertEqual(parsedA.originDeviceId, 'device-A',
        'on-disk originDeviceId preserved verbatim');

      // In-memory state (loadAll triggered by _reconcileWriteRaw).
      assertEqual(MedsManager.count(), 2, 'in-memory count = 2');
      const a = MedsManager.get('d1-med-a');
      const b = MedsManager.get('d1-med-b');
      assert(a !== null, 'd1-med-a loaded in-memory');
      assert(b !== null, 'd1-med-b loaded in-memory');
      assertEqual(a.getName(), 'Adderall', 'in-memory name matches');
    } finally {
      _d1_clearMedsKeys();
      _d1_restoreMedsKeys(medsSnap);
    }
  });
});

describe('D-1 MedsManager._reconcileWriteRaw — clears existing meds/* keys before writing merged snapshot', () => {
  it('stale local meds/* keys are wiped before the new snapshot is written', () => {
    const medsSnap = _d1_snapshotMedsKeys();
    _d1_clearMedsKeys();
    try {
      // Plant a stale record that should NOT survive.
      localStorage.setItem('meds/stale-1', JSON.stringify({
        id: 'stale-1', name: 'StaleMed', frequency: 'once-daily',
        schemaVersion: 1, deviceId: 'd', updatedAt: 1, doseLog: [],
      }));
      MedsManager.loadAll();
      assertEqual(MedsManager.count(), 1, 'stale record loaded initially');

      // Now reconcile with a fresh set that does NOT include 'stale-1'.
      MedsManager._reconcileWriteRaw([
        { id: 'fresh-1', name: 'FreshMed', frequency: 'once-daily', schemaVersion: 1, deviceId: 'd', updatedAt: 2, doseLog: [] },
      ]);

      assertEqual(localStorage.getItem('meds/stale-1'), null,
        'stale meds/stale-1 key removed');
      assert(localStorage.getItem('meds/fresh-1') !== null,
        'fresh meds/fresh-1 key written');
      assertEqual(MedsManager.count(), 1, 'in-memory count = 1');
      assertEqual(MedsManager.get('stale-1'), null,
        'stale record purged from in-memory state');
    } finally {
      _d1_clearMedsKeys();
      _d1_restoreMedsKeys(medsSnap);
    }
  });
});

describe('D-1 originDeviceId roundtrips through MedsManager.loadAll() → getState() (KNOWN_MED_KEYS regression)', () => {
  it('originDeviceId set via _reconcileWriteRaw is accessible via getState() AND not in _forwardBag', () => {
    const medsSnap = _d1_snapshotMedsKeys();
    _d1_clearMedsKeys();
    try {
      MedsManager._reconcileWriteRaw([
        {
          id: 'origin-test',
          name: 'OriginTest',
          dose: '5 mg',
          frequency: 'once-daily',
          schemaVersion: 1,
          deviceId: 'd-local',
          updatedAt: 1,
          doseLog: [],
          originDeviceId: 'device-X',
          // A truly-unknown field that SHOULD land in _forwardBag, used as
          // a control to make sure the bag mechanism is operational.
          truliyUnknown: 'should-go-in-forward',
        },
      ]);

      const m = MedsManager.get('origin-test');
      assert(m !== null, 'med loaded in-memory');

      const state = m.getState();
      assertEqual(state.id, 'origin-test', 'id preserved');
      assertEqual(state.name, 'OriginTest', 'name preserved');
      assertEqual(state.originDeviceId, 'device-X',
        'originDeviceId roundtrips through getState() (Headline #2 regression)');
      // The control field should ride through too via _forwardBag.
      assertEqual(state.truliyUnknown, 'should-go-in-forward',
        'truly-unknown field preserved via _forwardBag (control)');
    } finally {
      _d1_clearMedsKeys();
      _d1_restoreMedsKeys(medsSnap);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Group B: SyncEngine.reconcileImportedBucket — happy path
// ────────────────────────────────────────────────────────────────────────

describe('D-1 reconcileImportedBucket — stamps bucket:"imported" + originDeviceId on every untagged history row', () => {
  it('two rows with no bucket → both stamped with bucket:"imported" + originDeviceId === local deviceId', async () => {
    const markers = _d1_snapshotMarkers();
    const medsSnap = _d1_snapshotMedsKeys();
    _d1_clearMarkers();
    _d1_clearMedsKeys();
    const orig = _d1_saveModuleMethods();

    // Stub history with two pre-existing rows lacking `bucket`.
    const localRows = [
      { id: 'r1', duration: 1000, type: 'stopwatch', schemaVersion: 1, deviceId: 'd', updatedAt: 1 },
      { id: 'r2', duration: 2000, type: 'pomodoro', schemaVersion: 1, deviceId: 'd', updatedAt: 2 },
    ];
    const writeCalls = [];
    try {
      _d1_install({
        history: {
          getDeviceId: () => 'local-device-A',
          getSessions: async () => localRows.slice(),
          _reconcileWriteRaw: async (rows) => {
            writeCalls.push(rows.map(r => Object.assign({}, r)));
            return { written: rows.length, skipped: 0 };
          },
        },
        medsAll: () => [],
        medsReconcileRaw: () => ({ written: 0, skipped: 0 }),
      });

      const result = await SyncEngine.reconcileImportedBucket();
      assertEqual(result.ok, true, 'reconcile ok: ' + JSON.stringify(result));
      assertEqual(result.kind, 'reconciled', 'kind === reconciled');
      assertEqual(result.stamped.history, 2, 'two history rows stamped');

      // The FIRST call to _reconcileWriteRaw is the tag-stamp write
      // (step 3c), which captures the snapshot right after stamping.
      assert(writeCalls.length >= 1, '_reconcileWriteRaw was called for history');
      const stampedSnapshot = writeCalls[0];
      assertEqual(stampedSnapshot.length, 2, 'two rows written back');
      for (const r of stampedSnapshot) {
        assertEqual(r.bucket, 'imported', `${r.id}: bucket === "imported"`);
        assertEqual(r.originDeviceId, 'local-device-A',
          `${r.id}: originDeviceId set to local deviceId`);
      }
    } finally {
      _d1_restoreModuleMethods(orig);
      _d1_restoreMedsKeys(medsSnap);
      _d1_restoreMarkers(markers);
    }
  });
});

describe('D-1 reconcileImportedBucket — stamps originDeviceId on every med record missing it', () => {
  it('two meds (one with originDeviceId, one without) → only the missing one is stamped', async () => {
    const markers = _d1_snapshotMarkers();
    const medsSnap = _d1_snapshotMedsKeys();
    _d1_clearMarkers();
    _d1_clearMedsKeys();
    const orig = _d1_saveModuleMethods();

    const writeCalls = [];
    try {
      _d1_install({
        history: {
          getDeviceId: () => 'local-device-B',
          getSessions: async () => [],
          _reconcileWriteRaw: async () => ({ written: 0, skipped: 0 }),
        },
        medsAll: () => [
          { getState: () => ({ id: 'medA', name: 'A', frequency: 'once-daily', doseLog: [], schemaVersion: 1, deviceId: 'd', updatedAt: 1, originDeviceId: 'device-A' }) },
          { getState: () => ({ id: 'medB', name: 'B', frequency: 'once-daily', doseLog: [], schemaVersion: 1, deviceId: 'd', updatedAt: 2 /* no originDeviceId */ }) },
        ],
        medsReconcileRaw: (rows) => {
          writeCalls.push(rows.map(r => Object.assign({}, r)));
          return { written: rows.length, skipped: 0 };
        },
      });

      const result = await SyncEngine.reconcileImportedBucket();
      assertEqual(result.ok, true, 'reconcile ok: ' + JSON.stringify(result));
      assertEqual(result.stamped.meds, 1, 'one med stamped (the other was already tagged)');

      // The FIRST call captures the stamping write (step 3c).
      assert(writeCalls.length >= 1, 'meds were written');
      const stamped = writeCalls[0];
      const medA = stamped.find(m => m.id === 'medA');
      const medB = stamped.find(m => m.id === 'medB');
      assert(medA !== undefined, 'medA in stamped write');
      assert(medB !== undefined, 'medB in stamped write');
      assertEqual(medA.originDeviceId, 'device-A',
        'medA originDeviceId preserved verbatim (idempotency)');
      assertEqual(medB.originDeviceId, 'local-device-B',
        'medB originDeviceId stamped to local deviceId');
    } finally {
      _d1_restoreModuleMethods(orig);
      _d1_restoreMedsKeys(medsSnap);
      _d1_restoreMarkers(markers);
    }
  });
});

describe('D-1 reconcileImportedBucket — idempotent on re-run (no double-stamp, no originDeviceId overwrite)', () => {
  it('second run stamps zero records; existing originDeviceId values are NOT overwritten', async () => {
    const markers = _d1_snapshotMarkers();
    const medsSnap = _d1_snapshotMedsKeys();
    _d1_clearMarkers();
    _d1_clearMedsKeys();
    const orig = _d1_saveModuleMethods();

    // Pre-populate the row as already-tagged.
    const taggedRow = {
      id: 'already-tagged',
      duration: 5000,
      type: 'stopwatch',
      schemaVersion: 1,
      deviceId: 'd',
      updatedAt: 1,
      bucket: 'imported',
      originDeviceId: 'device-A',
    };
    const writeCalls = [];
    try {
      _d1_install({
        history: {
          getDeviceId: () => 'local-device-NEW',
          getSessions: async () => [Object.assign({}, taggedRow)],
          _reconcileWriteRaw: async (rows) => {
            writeCalls.push(rows.map(r => Object.assign({}, r)));
            return { written: rows.length, skipped: 0 };
          },
        },
        medsAll: () => [
          { getState: () => ({ id: 'already-tagged-med', name: 'X', frequency: 'once-daily', doseLog: [], schemaVersion: 1, deviceId: 'd', updatedAt: 1, originDeviceId: 'device-A' }) },
        ],
        medsReconcileRaw: () => ({ written: 1, skipped: 0 }),
      });

      const result = await SyncEngine.reconcileImportedBucket();
      assertEqual(result.ok, true, 'reconcile ok: ' + JSON.stringify(result));
      assertEqual(result.stamped.history, 0,
        'history.stamped === 0 (already tagged → idempotent no-op)');
      assertEqual(result.stamped.meds, 0,
        'meds.stamped === 0 (already tagged → idempotent no-op)');
      // Critical: existing originDeviceId NOT overwritten. Inspect the
      // first _reconcileWriteRaw call (the stamping snapshot).
      assert(writeCalls.length >= 1, 'history rows written');
      const stamped = writeCalls[0];
      const r = stamped.find(x => x.id === 'already-tagged');
      assert(r !== undefined, 'already-tagged in stamped write');
      assertEqual(r.bucket, 'imported', 'bucket unchanged');
      assertEqual(r.originDeviceId, 'device-A',
        'originDeviceId preserved verbatim (NOT overwritten with local deviceId)');
    } finally {
      _d1_restoreModuleMethods(orig);
      _d1_restoreMedsKeys(medsSnap);
      _d1_restoreMarkers(markers);
    }
  });
});

describe('D-1 reconcileImportedBucket — F19a future-schema history rows skipped, NOT tagged', () => {
  it('future-schema row stays untagged; schemaVersion preserved; result.skippedFutureRecords === 1', async () => {
    const markers = _d1_snapshotMarkers();
    const medsSnap = _d1_snapshotMedsKeys();
    _d1_clearMarkers();
    _d1_clearMedsKeys();
    const orig = _d1_saveModuleMethods();

    const futureVersion = Schema.SCHEMA_VERSION + 1;
    const futureRow = {
      id: 'future-1',
      duration: 1000,
      type: 'stopwatch',
      schemaVersion: futureVersion,
      deviceId: 'd',
      updatedAt: 1,
      // No bucket field. A downlevel client must NOT add one.
    };
    const normalRow = {
      id: 'normal-1',
      duration: 2000,
      type: 'pomodoro',
      schemaVersion: 1,
      deviceId: 'd',
      updatedAt: 2,
    };
    const writeCalls = [];
    try {
      _d1_install({
        history: {
          getDeviceId: () => 'local-device-C',
          getSessions: async () => [
            Object.assign({}, futureRow),
            Object.assign({}, normalRow),
          ],
          _reconcileWriteRaw: async (rows) => {
            writeCalls.push(rows.map(r => Object.assign({}, r)));
            return { written: rows.length, skipped: 0 };
          },
        },
        medsAll: () => [],
        medsReconcileRaw: () => ({ written: 0, skipped: 0 }),
      });

      const result = await SyncEngine.reconcileImportedBucket();
      assertEqual(result.ok, true, 'reconcile ok: ' + JSON.stringify(result));
      assertEqual(result.skippedFutureRecords, 1,
        'skippedFutureRecords === 1');
      assertEqual(result.stamped.history, 1,
        'stamped.history === 1 (only the non-future row)');

      assert(writeCalls.length >= 1, 'rows written');
      const stamped = writeCalls[0];
      const f = stamped.find(x => x.id === 'future-1');
      const n = stamped.find(x => x.id === 'normal-1');
      assert(f !== undefined, 'future row in stamped snapshot');
      assert(n !== undefined, 'normal row in stamped snapshot');
      assertEqual(f.bucket, undefined,
        'future row bucket remains absent (NOT tagged)');
      assertEqual(f.schemaVersion, futureVersion,
        'future row schemaVersion preserved verbatim');
      assertEqual(n.bucket, 'imported',
        'normal row tagged with bucket="imported"');
    } finally {
      _d1_restoreModuleMethods(orig);
      _d1_restoreMedsKeys(medsSnap);
      _d1_restoreMarkers(markers);
    }
  });
});

describe('D-1 reconcileImportedBucket — clears tempo_sync_stage_d_handoff on success, sets all 5 hydrate markers', () => {
  it('handoff flag cleared, all 5 hydrate markers set to "1"', async () => {
    const markers = _d1_snapshotMarkers();
    const medsSnap = _d1_snapshotMedsKeys();
    _d1_clearMarkers();
    _d1_clearMedsKeys();
    const orig = _d1_saveModuleMethods();

    // Pre-set the handoff flag.
    localStorage.setItem('tempo_sync_stage_d_handoff', '1');

    try {
      _d1_install({
        history: {
          getDeviceId: () => 'local-device-D',
          getSessions: async () => [],
          _reconcileWriteRaw: async () => ({ written: 0, skipped: 0 }),
        },
        medsAll: () => [],
        medsReconcileRaw: () => ({ written: 0, skipped: 0 }),
      });

      const result = await SyncEngine.reconcileImportedBucket();
      assertEqual(result.ok, true, 'reconcile ok: ' + JSON.stringify(result));

      assertEqual(localStorage.getItem('tempo_sync_stage_d_handoff'), null,
        'handoff flag cleared on success');
      assertEqual(localStorage.getItem('tempo_sync_hydrated_rest_log'), '1',
        'rest_log marker set');
      assertEqual(localStorage.getItem('tempo_sync_hydrated_meds'), '1',
        'meds marker set');
      assertEqual(localStorage.getItem('tempo_sync_hydrated_presets'), '1',
        'presets marker set');
      assertEqual(localStorage.getItem('tempo_sync_hydrated_history'), '1',
        'history marker set');
      assertEqual(localStorage.getItem('tempo_sync_hydrated_all'), '1',
        '_all marker set');
    } finally {
      _d1_restoreModuleMethods(orig);
      _d1_restoreMedsKeys(medsSnap);
      _d1_restoreMarkers(markers);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Group C: SyncEngine.reconcileImportedBucket — failure paths
// ────────────────────────────────────────────────────────────────────────

describe('D-1 reconcileImportedBucket — leaves handoff set + markers unset on cloud-write failure', () => {
  it('SyncFirestore.setDoc rejection → ok:false, kind:reconcile-error, handoff flag still "1"', async () => {
    const markers = _d1_snapshotMarkers();
    const medsSnap = _d1_snapshotMedsKeys();
    _d1_clearMarkers();
    _d1_clearMedsKeys();
    const orig = _d1_saveModuleMethods();

    localStorage.setItem('tempo_sync_stage_d_handoff', '1');
    const stateSpy = _d1_makeSyncStateSpy('ready');

    try {
      _d1_install({
        history: {
          getDeviceId: () => 'd',
          getSessions: async () => [
            { id: 'r1', duration: 1000, type: 'stopwatch', schemaVersion: 1, deviceId: 'd', updatedAt: 1 },
          ],
          _reconcileWriteRaw: async () => ({ written: 1, skipped: 0 }),
        },
        medsAll: () => [],
        medsReconcileRaw: () => ({ written: 0, skipped: 0 }),
        fs_setDoc: async () => { throw new Error('permission denied'); },
        syncStateObj: stateSpy.obj,
      });

      const result = await SyncEngine.reconcileImportedBucket();
      assertEqual(result.ok, false, 'reconcile failed');
      assertEqual(result.kind, 'reconcile-error', 'kind === reconcile-error');

      assertEqual(localStorage.getItem('tempo_sync_stage_d_handoff'), '1',
        'handoff flag STILL set on failure (retry-safe)');
      assertEqual(localStorage.getItem('tempo_sync_hydrated_all'), null,
        '_all marker NOT set on failure');
      assertEqual(localStorage.getItem('tempo_sync_hydrated_history'), null,
        'history marker NOT set on failure');

      assertEqual(stateSpy.obj.get(), 'error',
        'SyncState transitioned to "error"');
    } finally {
      _d1_restoreModuleMethods(orig);
      _d1_restoreMedsKeys(medsSnap);
      _d1_restoreMarkers(markers);
    }
  });
});

describe('D-1 reconcileImportedBucket — refuses when sync flag is off', () => {
  it('SyncFlag.isEnabled() === false → kind=sync-not-enabled', async () => {
    const markers = _d1_snapshotMarkers();
    const medsSnap = _d1_snapshotMedsKeys();
    _d1_clearMarkers();
    _d1_clearMedsKeys();
    const orig = _d1_saveModuleMethods();

    try {
      _d1_install({
        flag_isEnabled: () => false,
      });

      const result = await SyncEngine.reconcileImportedBucket();
      assertEqual(result.ok, false, 'returned ok=false');
      assertEqual(result.kind, 'sync-not-enabled', 'kind=sync-not-enabled');
    } finally {
      _d1_restoreModuleMethods(orig);
      _d1_restoreMedsKeys(medsSnap);
      _d1_restoreMarkers(markers);
    }
  });
});

describe('D-1 reconcileImportedBucket — refuses when no user is signed in', () => {
  it('SyncAuth.getCurrentUser() returns null → kind=sign-in-required', async () => {
    const markers = _d1_snapshotMarkers();
    const medsSnap = _d1_snapshotMedsKeys();
    _d1_clearMarkers();
    _d1_clearMedsKeys();
    const orig = _d1_saveModuleMethods();

    try {
      _d1_install({
        auth_getCurrentUser: () => null,
      });

      const result = await SyncEngine.reconcileImportedBucket();
      assertEqual(result.ok, false, 'returned ok=false');
      assertEqual(result.kind, 'sign-in-required', 'kind=sign-in-required');
    } finally {
      _d1_restoreModuleMethods(orig);
      _d1_restoreMedsKeys(medsSnap);
      _d1_restoreMarkers(markers);
    }
  });
});

describe('D-1 reconcileImportedBucket — returns {ok:false, kind:"busy"} when SyncState is already "hydrating"', () => {
  it('SyncState === "hydrating" from another code path → kind=busy', async () => {
    const markers = _d1_snapshotMarkers();
    const medsSnap = _d1_snapshotMedsKeys();
    _d1_clearMarkers();
    _d1_clearMedsKeys();
    const orig = _d1_saveModuleMethods();

    const stateSpy = _d1_makeSyncStateSpy('hydrating');

    try {
      _d1_install({
        history: {
          getDeviceId: () => 'd',
          getSessions: async () => [],
          _reconcileWriteRaw: async () => ({ written: 0, skipped: 0 }),
        },
        medsAll: () => [],
        medsReconcileRaw: () => ({ written: 0, skipped: 0 }),
        syncStateObj: stateSpy.obj,
      });

      const result = await SyncEngine.reconcileImportedBucket();
      assertEqual(result.ok, false, 'returned ok=false');
      assertEqual(result.kind, 'busy',
        'kind=busy when gate already owned by another code path');
      assertEqual(stateSpy.spy.length, 0, 'SyncState.set NEVER called');
    } finally {
      _d1_restoreModuleMethods(orig);
      _d1_restoreMedsKeys(medsSnap);
      _d1_restoreMarkers(markers);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Group D: SyncEngine.reconcileImportedBucket — re-entry + events
// ────────────────────────────────────────────────────────────────────────

describe('D-1 reconcileImportedBucket — re-entry guard returns same in-flight promise', () => {
  it('two concurrent calls share one in-flight promise (===)', async () => {
    const markers = _d1_snapshotMarkers();
    const medsSnap = _d1_snapshotMedsKeys();
    _d1_clearMarkers();
    _d1_clearMedsKeys();
    const orig = _d1_saveModuleMethods();

    // Hold history.getSessions open so the first reconcile sits mid-flight
    // when the second call lands.
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let getSessionsCount = 0;
    try {
      _d1_install({
        history: {
          getDeviceId: () => 'd',
          getSessions: async () => {
            getSessionsCount++;
            await gate;
            return [];
          },
          _reconcileWriteRaw: async () => ({ written: 0, skipped: 0 }),
        },
        medsAll: () => [],
        medsReconcileRaw: () => ({ written: 0, skipped: 0 }),
      });

      const p1 = SyncEngine.reconcileImportedBucket();
      // Yield once so the first call enters its async body.
      await Promise.resolve();
      const p2 = SyncEngine.reconcileImportedBucket();

      release();

      const [r1, r2] = await Promise.all([p1, p2]);
      assertEqual(r1.ok, true, 'first call ok: ' + JSON.stringify(r1));
      assert(r1 === r2,
        'r1 === r2 — both calls returned the same in-flight promise result');
      // Step 3a calls getSessions; step 5 calls again from within the
      // same reconcile. Two CONCURRENT reconciles sharing one in-flight
      // should still produce only one reconcile's worth of calls (≤ 2).
      assert(getSessionsCount <= 2,
        `getSessions called at most twice (one reconcile); got ${getSessionsCount}`);
    } finally {
      _d1_restoreModuleMethods(orig);
      _d1_restoreMedsKeys(medsSnap);
      _d1_restoreMarkers(markers);
    }
  });
});

describe('D-1 reconcileImportedBucket — emits reconcile-progress + reconcile-complete events', () => {
  it('progress events fire per stage; complete event fires once at end', async () => {
    const markers = _d1_snapshotMarkers();
    const medsSnap = _d1_snapshotMedsKeys();
    _d1_clearMarkers();
    _d1_clearMedsKeys();
    const orig = _d1_saveModuleMethods();

    const progressEvents = [];
    const completeEvents = [];
    const progressHandler = (data) => progressEvents.push(data);
    const completeHandler = (data) => completeEvents.push(data);

    try {
      _d1_install({
        history: {
          getDeviceId: () => 'd',
          getSessions: async () => [],
          _reconcileWriteRaw: async () => ({ written: 0, skipped: 0 }),
        },
        medsAll: () => [],
        medsReconcileRaw: () => ({ written: 0, skipped: 0 }),
      });

      SyncEngine.on('reconcile-progress', progressHandler);
      SyncEngine.on('reconcile-complete', completeHandler);

      const result = await SyncEngine.reconcileImportedBucket();
      assertEqual(result.ok, true, 'reconcile ok: ' + JSON.stringify(result));

      assert(progressEvents.length > 0,
        `at least one reconcile-progress event fired (got ${progressEvents.length})`);
      const hasStamping = progressEvents.some(e => e.stage === 'stamping');
      const hasPulling = progressEvents.some(e => e.stage === 'pulling');
      const hasWriting = progressEvents.some(e => e.stage === 'writing');
      assert(hasStamping, 'a stamping progress event fired');
      assert(hasPulling, 'a pulling progress event fired');
      assert(hasWriting, 'a writing progress event fired');

      assertEqual(completeEvents.length, 1, 'exactly one reconcile-complete event');
      assertEqual(completeEvents[0].ok, true, 'reconcile-complete payload ok=true');
    } finally {
      SyncEngine.off('reconcile-progress', progressHandler);
      SyncEngine.off('reconcile-complete', completeHandler);
      _d1_restoreModuleMethods(orig);
      _d1_restoreMedsKeys(medsSnap);
      _d1_restoreMarkers(markers);
    }
  });
});

describe('D-1 SyncEngine.clearStageDHandoff — removes the tempo_sync_stage_d_handoff localStorage key', () => {
  it('clearStageDHandoff() removes the key', () => {
    const markers = _d1_snapshotMarkers();
    _d1_clearMarkers();
    try {
      localStorage.setItem('tempo_sync_stage_d_handoff', '1');
      assertEqual(localStorage.getItem('tempo_sync_stage_d_handoff'), '1',
        'flag pre-set');
      SyncEngine.clearStageDHandoff();
      assertEqual(localStorage.getItem('tempo_sync_stage_d_handoff'), null,
        'flag cleared');
    } finally {
      _d1_restoreMarkers(markers);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Group E: SyncEngine.reconcileImportedBucket — merge collision rules
// ────────────────────────────────────────────────────────────────────────

describe('D-1 reconcileImportedBucket — history sessionId collision prefers cloud + logs console.warn', () => {
  it('cloud rec wins on collision; at least one console.warn fires during the merge', async () => {
    const markers = _d1_snapshotMarkers();
    const medsSnap = _d1_snapshotMedsKeys();
    _d1_clearMarkers();
    _d1_clearMedsKeys();
    const orig = _d1_saveModuleMethods();

    const origWarn = console.warn;
    let warnCount = 0;
    console.warn = function () { warnCount++; };

    const collisionId = 'dev-A-100-0';
    const localRow = { id: collisionId, duration: 1000, type: 'stopwatch', schemaVersion: 1, deviceId: 'd-local', updatedAt: 100, bucket: 'imported' };
    const cloudRow = { id: collisionId, duration: 9999, type: 'stopwatch', schemaVersion: 1, deviceId: 'd-cloud', updatedAt: 200, bucket: 'synced' };
    const writeCalls = [];

    try {
      _d1_install({
        history: {
          getDeviceId: () => 'd-local',
          getSessions: async () => [Object.assign({}, localRow)],
          _reconcileWriteRaw: async (rows) => {
            writeCalls.push(rows.map(r => Object.assign({}, r)));
            return { written: rows.length, skipped: 0 };
          },
        },
        medsAll: () => [],
        medsReconcileRaw: () => ({ written: 0, skipped: 0 }),
        fs_getCollection: async (path) => {
          if (path === 'users/u1/history') {
            return { docs: [{ id: collisionId, data: cloudRow }], count: 1 };
          }
          return { docs: [], count: 0 };
        },
      });

      const result = await SyncEngine.reconcileImportedBucket();
      assertEqual(result.ok, true, 'reconcile ok: ' + JSON.stringify(result));

      // The LAST call to _reconcileWriteRaw is the merge write (step 6a).
      assert(writeCalls.length >= 2, 'at least two writes occurred (stamp + merge)');
      const mergedWrite = writeCalls[writeCalls.length - 1];
      const merged = mergedWrite.find(r => r.id === collisionId);
      assert(merged !== undefined, 'collision id present in merged write');
      assertEqual(merged.duration, 9999,
        'cloud record wins on collision (duration=9999, not 1000)');
      assert(warnCount >= 1,
        `at least one console.warn fired during merge (got ${warnCount})`);
    } finally {
      console.warn = origWarn;
      _d1_restoreModuleMethods(orig);
      _d1_restoreMedsKeys(medsSnap);
      _d1_restoreMarkers(markers);
    }
  });
});

describe('D-1 reconcileImportedBucket — meds medId collision with different originDeviceId keeps BOTH records', () => {
  it('local + cloud meds with same id but different originDeviceId → 2 records in merged write (cloud re-keyed)', async () => {
    const markers = _d1_snapshotMarkers();
    const medsSnap = _d1_snapshotMedsKeys();
    _d1_clearMarkers();
    _d1_clearMedsKeys();
    const orig = _d1_saveModuleMethods();

    const collisionId = 'adderall';
    const localMed = { id: collisionId, name: 'Adderall', frequency: 'twice-daily', doseLog: [], schemaVersion: 1, deviceId: 'd-local', updatedAt: 100, originDeviceId: 'device-LOCAL' };
    const cloudMed = { id: collisionId, name: 'Adderall', frequency: 'twice-daily', doseLog: [], schemaVersion: 1, deviceId: 'd-cloud', updatedAt: 200, originDeviceId: 'device-CLOUD' };

    const writeCalls = [];
    try {
      _d1_install({
        history: {
          getDeviceId: () => 'device-LOCAL',
          getSessions: async () => [],
          _reconcileWriteRaw: async () => ({ written: 0, skipped: 0 }),
        },
        medsAll: () => [
          { getState: () => Object.assign({}, localMed) },
        ],
        medsReconcileRaw: (rows) => {
          writeCalls.push(rows.map(r => Object.assign({}, r)));
          return { written: rows.length, skipped: 0 };
        },
        fs_getCollection: async (path) => {
          if (path === 'users/u1/meds') {
            return { docs: [{ id: collisionId, data: cloudMed }], count: 1 };
          }
          return { docs: [], count: 0 };
        },
      });

      const result = await SyncEngine.reconcileImportedBucket();
      assertEqual(result.ok, true, 'reconcile ok: ' + JSON.stringify(result));

      // The LAST call captures the merge write (step 6a).
      assert(writeCalls.length >= 1, 'meds written');
      const mergedWrite = writeCalls[writeCalls.length - 1];
      assertEqual(mergedWrite.length, 2,
        'BOTH records survived (one re-keyed with @originDeviceId suffix)');
      // Local record keeps the original id; cloud is re-keyed.
      const localKept = mergedWrite.find(m => m.id === collisionId);
      const cloudRekeyed = mergedWrite.find(m => m.id !== collisionId);
      assert(localKept !== undefined, 'local record kept its original id');
      assert(cloudRekeyed !== undefined, 'cloud record re-keyed (id differs)');
      assert(cloudRekeyed.id.startsWith(collisionId + '@'),
        `cloud record re-keyed as "${collisionId}@<originDeviceId>"; got "${cloudRekeyed.id}"`);
      assertEqual(localKept.originDeviceId, 'device-LOCAL',
        'local record originDeviceId preserved');
      assertEqual(cloudRekeyed.originDeviceId, 'device-CLOUD',
        'cloud record originDeviceId preserved');
    } finally {
      _d1_restoreModuleMethods(orig);
      _d1_restoreMedsKeys(medsSnap);
      _d1_restoreMarkers(markers);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Group F: ManualDedupe.scan
// ────────────────────────────────────────────────────────────────────────
//
// `ManualDedupe.scan()` reads `History.getSessions()`. We stub
// `window.History` per-case since the engine code's `typeof History`
// check falls through to `window.History` when no `const History` is
// declared lexically (history.js NOT loaded by tests/index.html).

function _d1_setManualDedupeSessions(sessions) {
  // Save the existing window.History stub (if any) for restoration.
  const prev = window.History;
  window.History = Object.assign({}, prev || {}, {
    getSessions: async () => sessions.slice(),
  });
  return prev;
}
function _d1_restoreManualDedupeHistory(prev) {
  if (prev === undefined) delete window.History;
  else window.History = prev;
}

describe('D-1 ManualDedupe.scan — returns [] when no imported sessions exist', () => {
  it('history with only synced rows → scan returns []', async () => {
    const prev = _d1_setManualDedupeSessions([
      { id: 's1', duration: 1000, type: 'stopwatch', bucket: 'synced', date: '2026-05-12T12:00:00.000Z' },
      { id: 's2', duration: 2000, type: 'pomodoro', bucket: 'synced', date: '2026-05-12T13:00:00.000Z' },
    ]);
    try {
      const pairs = await ManualDedupe.scan();
      assertEqual(Array.isArray(pairs), true, 'pairs is an array');
      assertEqual(pairs.length, 0,
        'no imported rows → no pairs');
    } finally {
      _d1_restoreManualDedupeHistory(prev);
    }
  });
});

describe('D-1 ManualDedupe.scan — returns one pair with similarity 1.0 on exact triple match', () => {
  it('synced + imported with identical (date, type, duration) → 1 pair, similarity=1', async () => {
    const day = '2026-05-12T12:00:00.000Z';
    const prev = _d1_setManualDedupeSessions([
      { id: 's1', duration: 5000, type: 'stopwatch', bucket: 'synced', date: day },
      { id: 'i1', duration: 5000, type: 'stopwatch', bucket: 'imported', date: day },
    ]);
    try {
      const pairs = await ManualDedupe.scan();
      assertEqual(pairs.length, 1, 'exactly one candidate pair');
      assertEqual(pairs[0].similarity, 1.0,
        'similarity === 1.0 on exact match');
      assertEqual(pairs[0].b.bucket, 'imported',
        'pair.b is the imported record');
      assert(pairs[0].a.bucket === 'synced' || pairs[0].a.bucket === undefined,
        'pair.a is the synced (or absent-bucket) record');
    } finally {
      _d1_restoreManualDedupeHistory(prev);
    }
  });
});

describe('D-1 ManualDedupe.scan — returns one pair with similarity 0.9 when durations differ by ≤5000ms', () => {
  it('near-match (delta=3000ms) yields similarity=0.9', async () => {
    const day = '2026-05-12T12:00:00.000Z';
    const prev = _d1_setManualDedupeSessions([
      { id: 's1', duration: 10000, type: 'stopwatch', bucket: 'synced', date: day },
      { id: 'i1', duration: 13000, type: 'stopwatch', bucket: 'imported', date: day },
    ]);
    try {
      const pairs = await ManualDedupe.scan();
      assertEqual(pairs.length, 1, 'exactly one near-match pair');
      assertEqual(pairs[0].similarity, 0.9,
        'similarity === 0.9 on near-match within ±5000ms');
    } finally {
      _d1_restoreManualDedupeHistory(prev);
    }
  });
});

describe('D-1 ManualDedupe.scan — does NOT surface pairs across different types', () => {
  it('synced=cooking + imported=stopwatch with same duration → no pair', async () => {
    const day = '2026-05-12T12:00:00.000Z';
    const prev = _d1_setManualDedupeSessions([
      { id: 's1', duration: 5000, type: 'cooking', bucket: 'synced', date: day },
      { id: 'i1', duration: 5000, type: 'stopwatch', bucket: 'imported', date: day },
    ]);
    try {
      const pairs = await ManualDedupe.scan();
      assertEqual(pairs.length, 0,
        'no pair when types differ (cooking ≠ stopwatch)');
    } finally {
      _d1_restoreManualDedupeHistory(prev);
    }
  });
});

describe('D-1 ManualDedupe.scan — does NOT surface pairs across different YYYY-MM-DD days', () => {
  it('same type + same duration but different days → no pair', async () => {
    const day1 = '2026-05-10T12:00:00.000Z';
    const day2 = '2026-05-11T12:00:00.000Z';
    const prev = _d1_setManualDedupeSessions([
      { id: 's1', duration: 5000, type: 'stopwatch', bucket: 'synced', date: day1 },
      { id: 'i1', duration: 5000, type: 'stopwatch', bucket: 'imported', date: day2 },
    ]);
    try {
      const pairs = await ManualDedupe.scan();
      assertEqual(pairs.length, 0,
        'no pair when calendar days differ');
    } finally {
      _d1_restoreManualDedupeHistory(prev);
    }
  });
});

describe('D-1 ManualDedupe.scan — absent-bucket sessions are treated as "synced" for pair generation', () => {
  it('untagged (no bucket) + imported with matching triple → pair surfaces (similarity=1)', async () => {
    const day = '2026-05-12T12:00:00.000Z';
    const prev = _d1_setManualDedupeSessions([
      // No `bucket` field at all on this row — should be treated as synced.
      { id: 'legacy', duration: 5000, type: 'stopwatch', date: day },
      { id: 'imported', duration: 5000, type: 'stopwatch', bucket: 'imported', date: day },
    ]);
    try {
      const pairs = await ManualDedupe.scan();
      assertEqual(pairs.length, 1,
        'one pair surfaced (absent-bucket treated as synced)');
      assertEqual(pairs[0].similarity, 1.0,
        'similarity=1 on exact triple match');
      assertEqual(pairs[0].b.id, 'imported', 'pair.b is the imported record');
    } finally {
      _d1_restoreManualDedupeHistory(prev);
    }
  });
});
