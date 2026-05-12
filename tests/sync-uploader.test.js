// B-3 — SyncEngine.pushSnapshot() + SyncFirestore + Backup uploader tests.
//
// Scope (from docs/sync-impl/audits/B-3-AUDIT.md § "Test scope"):
//   Group 1: pushSnapshot() happy paths + Stage D handoff
//     1. Cloud-empty path uploads in dependency order
//     2. Cloud-non-empty WITHOUT partial-upload marker → Stage D handoff
//     3. Cloud-non-empty WITH partial-upload marker (same uid) → resume upload
//     4. F12 backup-failure aborts
//   Group 2: F13 + F19a + SyncState transitions
//     5. F19a future-record skipped on upload
//     6. SyncState transitions on success (hydrating → ready)
//     7. SyncState transitions on failure mid-upload (error + marker set)
//     8. Snapshot read failure aborts upload
//   Group 3: Re-entry + sentinel rejections
//     9. Re-entry guard returns same in-flight promise (resolves to same result)
//     10. Push rejected when not signed in
//     11. Push rejected when flag off
//     12. Push rejected when SyncState already hydrating
//     13. Push rejected when SyncState at error
//   Group 4: F13 gap regressions (Presets only — RecoveryUI not loaded)
//     14. Presets.save honors F13 gate
//     15. Presets.update honors F13 gate
//     16. Presets.remove honors F13 gate
//   Group 5: SyncFirestore stub seams
//     17. SyncFirestore.runTransaction throws B-3 stub error
//     18. SyncFirestore.setBatch throws B-3 stub error
//
// Stubbing strategy:
//   js/sync-engine.js reads its collaborators (`SyncFlag`, `SyncAuth`,
//   `Backup`, `SyncFirestore`, `Schema`) as LEXICAL bindings — they are
//   `const`-declared script-globals in their respective modules. That
//   means `window.X = stub` does NOT shadow them inside the engine's IIFE.
//   The robust approach is to mutate METHODS on the existing modules,
//   saving the originals and restoring in finally. Same pattern as
//   `sync-engine.test.js` (which does `MedsManager.snapshotForSync = ...`).
//
//   `SyncState` is the exception — persistence.js is NOT loaded in tests,
//   so `SyncState` is undefined lexically and the engine's
//   `typeof SyncState !== 'undefined'` guard reads `window.SyncState`.
//   For SyncState we install / clear `window.SyncState`.

// ── Shared helpers ─────────────────────────────────────────────────────

// Save the originals so each test can replace and restore safely.
//
// `getSnapshot()` inside the engine is the LEXICAL function (not
// SyncEngine.getSnapshot); we can't stub it externally. Instead we
// stub each adapter the registry reads: MedsManager + Presets (both
// loaded for real) + window.History + window.RecoveryUI (not loaded —
// the engine's bare `History` / `RecoveryUI` resolves through window).
function _b3_saveModuleMethods() {
  return {
    flag_isEnabled: SyncFlag.isEnabled,
    auth_getCurrentUser: SyncAuth.getCurrentUser,
    backup_exportLocal: Backup.exportLocal,
    fs_getDoc: SyncFirestore.getDoc,
    fs_setDoc: SyncFirestore.setDoc,
    fs_getCollection: SyncFirestore.getCollection,
    meds_snap: MedsManager.snapshotForSync,
    presets_snap: Presets.snapshotForSync,
    history: window.History,
    recoveryUI: window.RecoveryUI,
    syncState: window.SyncState,
  };
}
function _b3_restoreModuleMethods(orig) {
  SyncFlag.isEnabled = orig.flag_isEnabled;
  SyncAuth.getCurrentUser = orig.auth_getCurrentUser;
  Backup.exportLocal = orig.backup_exportLocal;
  SyncFirestore.getDoc = orig.fs_getDoc;
  SyncFirestore.setDoc = orig.fs_setDoc;
  SyncFirestore.getCollection = orig.fs_getCollection;
  MedsManager.snapshotForSync = orig.meds_snap;
  Presets.snapshotForSync = orig.presets_snap;
  if (orig.history === undefined) delete window.History;
  else window.History = orig.history;
  if (orig.recoveryUI === undefined) delete window.RecoveryUI;
  else window.RecoveryUI = orig.recoveryUI;
  if (orig.syncState === undefined) delete window.SyncState;
  else window.SyncState = orig.syncState;
}

// Install per-test stubs. `s` may override any of:
//   flag_isEnabled       (default: () => true)
//   auth_getCurrentUser  (default: () => ({ uid: 'u1' }))
//   backup_exportLocal   (default: async () => ({ ok: true }))
//   fs_setDoc            (default: async () => {})
//   fs_getCollection     (default: async () => ({ docs: [], count: 0 }))
//   snapshot             (default: _b3_smallSnapshot())
//                        — used to populate the four adapter stubs.
//                        Each store's snapshot is wired to its adapter:
//                        meds → MedsManager.snapshotForSync,
//                        history → window.History.snapshotForSync,
//                        rest_log → window.RecoveryUI.snapshotForSync,
//                        presets → Presets.snapshotForSync.
//                        If `snapshotThrows` is true, the meds adapter
//                        throws (proxy for "snapshot read failure").
//   snapshotThrows       (default: false) — when true, makes one adapter
//                        throw so getSnapshot() rejects, exercising the
//                        snapshot-failed branch.
//   syncStateObj         (default: a fresh _makeSyncStateSpy('ready').obj)
function _b3_install(s) {
  s = s || {};
  SyncFlag.isEnabled = s.flag_isEnabled || (() => true);
  SyncAuth.getCurrentUser = s.auth_getCurrentUser || (() => ({ uid: 'u1' }));
  Backup.exportLocal = s.backup_exportLocal || (async () => ({ ok: true, bytesWritten: 100 }));
  SyncFirestore.getDoc = s.fs_getDoc || (async () => null);
  SyncFirestore.setDoc = s.fs_setDoc || (async () => {});
  SyncFirestore.getCollection = s.fs_getCollection || (async () => ({ docs: [], count: 0 }));

  const snap = s.snapshot || _b3_smallSnapshot();
  // Wire each per-store adapter so getSnapshot() returns the fixture.
  if (s.snapshotThrows) {
    MedsManager.snapshotForSync = () => { throw new Error('IDB blew up'); };
  } else {
    MedsManager.snapshotForSync = () => snap.meds;
  }
  Presets.snapshotForSync = () => snap.presets;
  window.History = {
    getDeviceId: () => snap.history.deviceId,
    snapshotForSync: async () => snap.history,
  };
  window.RecoveryUI = {
    snapshotForSync: () => snap.rest_log,
  };

  if (s.syncStateObj === undefined) {
    window.SyncState = _b3_makeSyncStateSpy('ready').obj;
  } else {
    window.SyncState = s.syncStateObj;
  }
}

// Track every SyncState.set() call so we can assert the gate sequence.
// `obj` is what gets installed onto window.SyncState; `spy` is the call log.
function _b3_makeSyncStateSpy(initial) {
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

// Snapshot/restore the localStorage markers pushSnapshot writes.
function _b3_snapshotMarkers() {
  return {
    partial: localStorage.getItem('tempo_sync_partial_upload_uid'),
    stageD: localStorage.getItem('tempo_sync_stage_d_handoff'),
  };
}
function _b3_clearMarkers() {
  localStorage.removeItem('tempo_sync_partial_upload_uid');
  localStorage.removeItem('tempo_sync_stage_d_handoff');
}
function _b3_restoreMarkers(snap) {
  _b3_clearMarkers();
  if (snap.partial !== null) localStorage.setItem('tempo_sync_partial_upload_uid', snap.partial);
  if (snap.stageD !== null) localStorage.setItem('tempo_sync_stage_d_handoff', snap.stageD);
}

// Minimal fixture — one record per store. Used by happy-path tests.
function _b3_smallSnapshot() {
  return {
    meds: {
      deviceId: 'd-test',
      schemaVersion: Schema.SCHEMA_VERSION,
      payload: { meds: [{ id: 'med-1', name: 'A', schemaVersion: 1, deviceId: 'd-test', updatedAt: 1 }] },
    },
    history: {
      deviceId: 'd-test',
      schemaVersion: Schema.SCHEMA_VERSION,
      payload: { sessions: [{ id: 'd-test-1700000000000-0', type: 'stopwatch', schemaVersion: 1, deviceId: 'd-test', updatedAt: 1 }] },
    },
    rest_log: {
      deviceId: 'd-test',
      schemaVersion: Schema.SCHEMA_VERSION,
      payload: { rest_log: { '2025-01-01': { sleep: { hours: 7 }, naps: [] } } },
    },
    presets: {
      deviceId: 'd-test',
      schemaVersion: Schema.SCHEMA_VERSION,
      payload: { presets: [{ id: 'p-1', name: 'P', mode: 'stopwatch', schemaVersion: 1, deviceId: 'd-test', updatedAt: 1 }] },
    },
  };
}

// Capture setDoc invocations: { path, data, t }.
function _b3_makeSetDocSpy(impl) {
  const calls = [];
  let counter = 0;
  const fn = async (path, data) => {
    counter++;
    const entry = { path, data, t: counter };
    calls.push(entry);
    if (impl) return impl(path, data, calls.length);
  };
  return { fn, calls };
}

// ────────────────────────────────────────────────────────────────────────
// Group 1: pushSnapshot() happy paths + Stage D handoff
// ────────────────────────────────────────────────────────────────────────

describe('B-3 pushSnapshot — cloud-empty happy path uploads in dependency order', () => {
  it('backup runs before setDoc; rest_log → meds → presets → history; returns ok', async () => {
    const markers = _b3_snapshotMarkers();
    _b3_clearMarkers();
    const orig = _b3_saveModuleMethods();

    let backupCalledAt = -1;
    let setDocBaseline = 0;
    const setDoc = _b3_makeSetDocSpy();

    try {
      _b3_install({
        backup_exportLocal: async () => {
          backupCalledAt = ++setDocBaseline;
          return { ok: true, bytesWritten: 100 };
        },
        fs_setDoc: async (path, data) => {
          setDocBaseline++;
          const entry = { path, data, t: setDocBaseline };
          setDoc.calls.push(entry);
        },
      });

      const result = await SyncEngine.pushSnapshot();

      // Use raw assertEqual without a msg so default failure reveals actual vs expected.
      if (!result || result.ok !== true) {
        throw new Error('expected ok=true, got: ' + JSON.stringify(result));
      }
      assertEqual(result.uploaded.rest_log, 1, 'rest_log uploaded count = 1');
      assertEqual(result.uploaded.meds, 1, 'meds uploaded count = 1');
      assertEqual(result.uploaded.presets, 1, 'presets uploaded count = 1');
      assertEqual(result.uploaded.history, 1, 'history uploaded count = 1');
      assertEqual(result.skippedFutureRecords, 0, 'no future records skipped');

      // Backup ran before any setDoc.
      assert(backupCalledAt > 0, 'backup invoked (got: ' + backupCalledAt + ')');
      assert(setDoc.calls.length === 4, 'four setDoc calls (got: ' + setDoc.calls.length + ')');
      assert(setDoc.calls[0].t > backupCalledAt, 'first setDoc happened after backup');

      // Dependency order check via path prefix.
      const paths = setDoc.calls.map(c => c.path);
      assert(paths[0].indexOf('/rest_log/') !== -1, 'first setDoc is rest_log (got ' + paths[0] + ')');
      assert(paths[1].indexOf('/meds/') !== -1, 'second setDoc is meds (got ' + paths[1] + ')');
      assert(paths[2].indexOf('/presets/') !== -1, 'third setDoc is presets (got ' + paths[2] + ')');
      assert(paths[3].indexOf('/history/') !== -1, 'fourth setDoc is history (got ' + paths[3] + ')');

      // Partial-upload marker cleared on success.
      assertEqual(localStorage.getItem('tempo_sync_partial_upload_uid'), null,
        'partial-upload marker cleared on success');
    } finally {
      _b3_restoreModuleMethods(orig);
      _b3_restoreMarkers(markers);
    }
  });
});

describe('B-3 pushSnapshot — cloud-non-empty without partial-upload marker → Stage D handoff', () => {
  it('aborts to Stage D handoff: no setDoc, stage-d marker set, SyncState stays ready', async () => {
    const markers = _b3_snapshotMarkers();
    _b3_clearMarkers();
    const orig = _b3_saveModuleMethods();

    const stateSpy = _b3_makeSyncStateSpy('ready');
    const setDoc = _b3_makeSetDocSpy();
    let backupCalls = 0;

    try {
      _b3_install({
        backup_exportLocal: async () => { backupCalls++; return { ok: true }; },
        fs_setDoc: setDoc.fn,
        fs_getCollection: async (path) => {
          if (path.indexOf('/meds') !== -1) {
            return { docs: [{ id: 'existing', data: {} }], count: 1 };
          }
          return { docs: [], count: 0 };
        },
        syncStateObj: stateSpy.obj,
      });

      const result = await SyncEngine.pushSnapshot();

      assertEqual(result.ok, false, 'push returned ok=false');
      assertEqual(result.kind, 'stage-d-handoff', 'kind=stage-d-handoff');
      assertEqual(setDoc.calls.length, 0, 'no setDoc invocations');
      assertEqual(backupCalls, 1, 'backup did run (F12 — backup before probe)');

      // Stage D flag persisted.
      assertEqual(localStorage.getItem('tempo_sync_stage_d_handoff'), '1',
        'tempo_sync_stage_d_handoff = "1"');

      // SyncState stayed at ready (no hydrating transition).
      assertEqual(stateSpy.spy.length, 0, 'SyncState.set was NEVER called');
      assertEqual(stateSpy.obj.get(), 'ready', 'SyncState stayed at ready');
    } finally {
      _b3_restoreModuleMethods(orig);
      _b3_restoreMarkers(markers);
    }
  });
});

describe('B-3 pushSnapshot — cloud-non-empty WITH matching partial-upload marker → resume', () => {
  it('treats own retry as resumable: setDoc IS called and marker cleared on success', async () => {
    const markers = _b3_snapshotMarkers();
    _b3_clearMarkers();
    const orig = _b3_saveModuleMethods();
    localStorage.setItem('tempo_sync_partial_upload_uid', 'u1');  // matches user.uid

    const stateSpy = _b3_makeSyncStateSpy('ready');
    const setDoc = _b3_makeSetDocSpy();

    try {
      _b3_install({
        fs_setDoc: setDoc.fn,
        fs_getCollection: async () => ({ docs: [{ id: 'x', data: {} }], count: 1 }),
        syncStateObj: stateSpy.obj,
      });

      const result = await SyncEngine.pushSnapshot();

      assertEqual(result.ok, true, 'resumed upload succeeded');
      assert(setDoc.calls.length === 4, 'all four records uploaded on retry');

      // Stage D flag NOT set on resume path.
      assertEqual(localStorage.getItem('tempo_sync_stage_d_handoff'), null,
        'stage-d flag NOT set on resume path');

      // Partial-upload marker cleared at end.
      assertEqual(localStorage.getItem('tempo_sync_partial_upload_uid'), null,
        'partial-upload marker cleared after successful resume');
    } finally {
      _b3_restoreModuleMethods(orig);
      _b3_restoreMarkers(markers);
    }
  });
});

describe('B-3 pushSnapshot — F12 backup-failure aborts upload', () => {
  it('returns kind=backup-failed, no setDoc, SyncState stays ready', async () => {
    const markers = _b3_snapshotMarkers();
    _b3_clearMarkers();
    const orig = _b3_saveModuleMethods();

    const stateSpy = _b3_makeSyncStateSpy('ready');
    const setDoc = _b3_makeSetDocSpy();

    try {
      _b3_install({
        backup_exportLocal: async () => ({ ok: false, error: new Error('quota exceeded') }),
        fs_setDoc: setDoc.fn,
        syncStateObj: stateSpy.obj,
      });

      const result = await SyncEngine.pushSnapshot();

      assertEqual(result.ok, false, 'push returned ok=false');
      assertEqual(result.kind, 'backup-failed', 'kind=backup-failed');
      assertEqual(setDoc.calls.length, 0, 'zero setDoc invocations');
      assertEqual(stateSpy.spy.length, 0, 'SyncState.set NEVER called');
      assertEqual(stateSpy.obj.get(), 'ready', 'SyncState stayed at ready');
    } finally {
      _b3_restoreModuleMethods(orig);
      _b3_restoreMarkers(markers);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Group 2: F13 + F19a + SyncState transitions
// ────────────────────────────────────────────────────────────────────────

describe('B-3 pushSnapshot — F19a future-record is skipped on upload', () => {
  it('future-schema meds record is not uploaded; skippedFutureRecords reflects count', async () => {
    const markers = _b3_snapshotMarkers();
    _b3_clearMarkers();
    const orig = _b3_saveModuleMethods();

    const setDoc = _b3_makeSetDocSpy();

    // Build a snapshot where meds has 2 records — one future-schema.
    const fixture = _b3_smallSnapshot();
    fixture.meds.payload.meds = [
      { id: 'med-current', schemaVersion: Schema.SCHEMA_VERSION, name: 'Current', deviceId: 'd', updatedAt: 1 },
      { id: 'med-future',  schemaVersion: Schema.SCHEMA_VERSION + 1, name: 'Future',  deviceId: 'd', updatedAt: 2 },
    ];

    try {
      _b3_install({
        fs_setDoc: setDoc.fn,
        snapshot: fixture,
      });

      const result = await SyncEngine.pushSnapshot();

      assertEqual(result.ok, true, 'push succeeded');
      assertEqual(result.skippedFutureRecords, 1, 'one future record skipped');
      assertEqual(result.uploaded.meds, 1, 'meds count = 1 (only the current-schema record)');

      // Check no setDoc path mentions the future record id.
      const futurePath = setDoc.calls.find(c => c.path.indexOf('med-future') !== -1);
      assertEqual(futurePath, undefined, 'med-future was NOT uploaded');

      // The current record IS uploaded.
      const currentPath = setDoc.calls.find(c => c.path.indexOf('med-current') !== -1);
      assert(currentPath !== undefined, 'med-current WAS uploaded');
    } finally {
      _b3_restoreModuleMethods(orig);
      _b3_restoreMarkers(markers);
    }
  });
});

describe('B-3 pushSnapshot — SyncState transitions on success', () => {
  it('flips ready → hydrating before first setDoc, then ready on success', async () => {
    const markers = _b3_snapshotMarkers();
    _b3_clearMarkers();
    const orig = _b3_saveModuleMethods();

    const stateSpy = _b3_makeSyncStateSpy('ready');
    let counter = 0;
    let firstSetDocAt = -1;
    let firstHydratingSetAt = -1;
    // Wrap the spy's set to capture order vs setDoc.
    const origSet = stateSpy.obj.set;
    stateSpy.obj.set = (s) => {
      counter++;
      if (s === 'hydrating' && firstHydratingSetAt === -1) firstHydratingSetAt = counter;
      return origSet(s);
    };

    const setDoc = _b3_makeSetDocSpy(async () => {
      counter++;
      if (firstSetDocAt === -1) firstSetDocAt = counter;
    });

    try {
      _b3_install({
        fs_setDoc: setDoc.fn,
        syncStateObj: stateSpy.obj,
      });

      const result = await SyncEngine.pushSnapshot();

      assertEqual(result.ok, true, 'push succeeded');
      // Sequence: 'hydrating' first, then 'ready'.
      assertEqual(stateSpy.spy.length, 2, 'exactly two SyncState.set calls');
      assertEqual(stateSpy.spy[0], 'hydrating', 'first state set is hydrating');
      assertEqual(stateSpy.spy[1], 'ready', 'second state set is ready');
      // Hydrating happened before first setDoc.
      assert(firstHydratingSetAt > 0 && firstSetDocAt > 0, 'sequence tracked');
      assert(firstHydratingSetAt < firstSetDocAt, 'SyncState=hydrating happened BEFORE first setDoc');
      // No 'error' set anywhere in the spy log.
      const errSets = stateSpy.spy.filter(s => s === 'error');
      assertEqual(errSets.length, 0, 'no error state set during success path');
    } finally {
      _b3_restoreModuleMethods(orig);
      _b3_restoreMarkers(markers);
    }
  });
});

describe('B-3 pushSnapshot — SyncState transitions on failure mid-upload', () => {
  it('on setDoc failure: state ends at error, partial-upload marker is set', async () => {
    const markers = _b3_snapshotMarkers();
    _b3_clearMarkers();
    const orig = _b3_saveModuleMethods();

    const stateSpy = _b3_makeSyncStateSpy('ready');
    // rest_log first (1 record), then meds (1 record) — fail on the meds setDoc.
    const setDoc = _b3_makeSetDocSpy(async (path) => {
      if (path.indexOf('/meds/') !== -1) {
        const err = new Error('network drop');
        err.kind = 'network';
        err.isRetryable = true;
        throw err;
      }
    });

    try {
      _b3_install({
        fs_setDoc: setDoc.fn,
        syncStateObj: stateSpy.obj,
      });

      const result = await SyncEngine.pushSnapshot();

      assertEqual(result.ok, false, 'push returned ok=false');
      assertEqual(result.kind, 'upload-error', 'kind=upload-error');
      assertEqual(result.store, 'meds', 'store=meds (where it failed)');

      // SyncState ended at error.
      assertEqual(stateSpy.obj.get(), 'error', 'SyncState ends at error');

      // Partial-upload marker IS set (so next retry knows it's resuming).
      assertEqual(localStorage.getItem('tempo_sync_partial_upload_uid'), 'u1',
        'partial-upload marker preserved on error');

      // Sequence: hydrating → error.
      assertEqual(stateSpy.spy[0], 'hydrating', 'first set is hydrating');
      assertEqual(stateSpy.spy[stateSpy.spy.length - 1], 'error', 'last set is error');
    } finally {
      _b3_restoreModuleMethods(orig);
      _b3_restoreMarkers(markers);
    }
  });
});

describe('B-3 pushSnapshot — snapshot read failure aborts upload', () => {
  it('returns kind=snapshot-failed; zero setDoc calls; SyncState ends at error', async () => {
    const markers = _b3_snapshotMarkers();
    _b3_clearMarkers();
    const orig = _b3_saveModuleMethods();

    const stateSpy = _b3_makeSyncStateSpy('ready');
    const setDoc = _b3_makeSetDocSpy();
    let backupCalls = 0;

    try {
      _b3_install({
        backup_exportLocal: async () => { backupCalls++; return { ok: true }; },
        fs_setDoc: setDoc.fn,
        syncStateObj: stateSpy.obj,
        snapshotThrows: true,
      });

      const result = await SyncEngine.pushSnapshot();

      assertEqual(result.ok, false, 'push returned ok=false');
      assertEqual(result.kind, 'snapshot-failed', 'kind=snapshot-failed');
      assertEqual(setDoc.calls.length, 0, 'no setDoc invocations');
      assertEqual(backupCalls, 1, 'backup DID run (F12 happens BEFORE snapshot)');
      assertEqual(stateSpy.obj.get(), 'error', 'SyncState ends at error');
    } finally {
      _b3_restoreModuleMethods(orig);
      _b3_restoreMarkers(markers);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Group 3: Re-entry + sentinel rejections
// ────────────────────────────────────────────────────────────────────────

describe('B-3 pushSnapshot — re-entry guard: concurrent calls share one backup', () => {
  it('second call during in-flight push resolves to same result; backup invoked once', async () => {
    // NOTE: pushSnapshot is `async function`, so each top-level call
    // returns a NEW outer Promise that adopts the inner promise's state.
    // We can't assert `p1 === p2`; the user-observable contract is "both
    // calls resolve to the same result and the side-effects (backup) ran
    // exactly once." That's what we test.
    const markers = _b3_snapshotMarkers();
    _b3_clearMarkers();
    const orig = _b3_saveModuleMethods();

    let backupCalls = 0;
    // Hold the backup open so the second call lands while the first is mid-flight.
    let releaseBackup;
    const backupPromise = new Promise(resolve => { releaseBackup = resolve; });

    const setDoc = _b3_makeSetDocSpy();

    try {
      _b3_install({
        backup_exportLocal: async () => {
          backupCalls++;
          await backupPromise;
          return { ok: true };
        },
        fs_setDoc: setDoc.fn,
      });

      // Fire the first call but don't await yet.
      const p1 = SyncEngine.pushSnapshot();
      // Yield once so the first call enters its async body and sets _pushInFlight=true.
      await Promise.resolve();
      // Second call while p1 is still mid-backup.
      const p2 = SyncEngine.pushSnapshot();

      // Release backup and let both awaits complete.
      releaseBackup({ ok: true });

      const [r1, r2] = await Promise.all([p1, p2]);
      assertEqual(r1.ok, true, 'first call succeeded');
      assertEqual(r2.ok, true, 'second call succeeded (same result)');
      // r1 === r2 because both resolve to the same inner Promise's value.
      assert(r1 === r2, 'both calls resolve to the SAME result object (re-entry guard returned in-flight promise)');
      assertEqual(backupCalls, 1, 'backup invoked exactly once for both calls');
    } finally {
      _b3_restoreModuleMethods(orig);
      _b3_restoreMarkers(markers);
    }
  });
});

describe('B-3 pushSnapshot — rejected when not signed in', () => {
  it('returns kind=sign-in-required, no backup, no setDoc, SyncState unchanged', async () => {
    const markers = _b3_snapshotMarkers();
    _b3_clearMarkers();
    const orig = _b3_saveModuleMethods();

    const stateSpy = _b3_makeSyncStateSpy('ready');
    const setDoc = _b3_makeSetDocSpy();
    let backupCalls = 0;

    try {
      _b3_install({
        auth_getCurrentUser: () => null,
        backup_exportLocal: async () => { backupCalls++; return { ok: true }; },
        fs_setDoc: setDoc.fn,
        syncStateObj: stateSpy.obj,
      });

      const result = await SyncEngine.pushSnapshot();

      assertEqual(result.ok, false, 'push returned ok=false');
      assertEqual(result.kind, 'sign-in-required', 'kind=sign-in-required');
      assertEqual(backupCalls, 0, 'backup NOT called when signed out');
      assertEqual(setDoc.calls.length, 0, 'no setDoc invocations');
      assertEqual(stateSpy.spy.length, 0, 'SyncState NEVER touched');
    } finally {
      _b3_restoreModuleMethods(orig);
      _b3_restoreMarkers(markers);
    }
  });
});

describe('B-3 pushSnapshot — rejected when flag is off', () => {
  it('returns kind=sync-not-enabled, no backup, no setDoc, SyncState unchanged', async () => {
    const markers = _b3_snapshotMarkers();
    _b3_clearMarkers();
    const orig = _b3_saveModuleMethods();

    const stateSpy = _b3_makeSyncStateSpy('ready');
    const setDoc = _b3_makeSetDocSpy();
    let backupCalls = 0;

    try {
      _b3_install({
        flag_isEnabled: () => false,
        backup_exportLocal: async () => { backupCalls++; return { ok: true }; },
        fs_setDoc: setDoc.fn,
        syncStateObj: stateSpy.obj,
      });

      const result = await SyncEngine.pushSnapshot();

      assertEqual(result.ok, false, 'push returned ok=false');
      assertEqual(result.kind, 'sync-not-enabled', 'kind=sync-not-enabled');
      assertEqual(backupCalls, 0, 'backup NOT called when flag off');
      assertEqual(setDoc.calls.length, 0, 'no setDoc invocations');
      assertEqual(stateSpy.spy.length, 0, 'SyncState NEVER touched');
    } finally {
      _b3_restoreModuleMethods(orig);
      _b3_restoreMarkers(markers);
    }
  });
});

describe('B-3 pushSnapshot — rejected when SyncState is already hydrating', () => {
  it('returns kind=already-in-flight; no backup, no setDoc', async () => {
    const markers = _b3_snapshotMarkers();
    _b3_clearMarkers();
    const orig = _b3_saveModuleMethods();

    const stateSpy = _b3_makeSyncStateSpy('hydrating');
    const setDoc = _b3_makeSetDocSpy();
    let backupCalls = 0;

    try {
      _b3_install({
        backup_exportLocal: async () => { backupCalls++; return { ok: true }; },
        fs_setDoc: setDoc.fn,
        syncStateObj: stateSpy.obj,
      });

      const result = await SyncEngine.pushSnapshot();

      assertEqual(result.ok, false, 'push returned ok=false');
      assertEqual(result.kind, 'already-in-flight', 'kind=already-in-flight');
      assertEqual(backupCalls, 0, 'backup NOT invoked');
      assertEqual(setDoc.calls.length, 0, 'no setDoc invocations');
      assertEqual(stateSpy.spy.length, 0, 'SyncState.set NEVER called');
    } finally {
      _b3_restoreModuleMethods(orig);
      _b3_restoreMarkers(markers);
    }
  });
});

describe('B-3 pushSnapshot — rejected when SyncState is at error', () => {
  it('returns kind=sync-error-state; no backup, no setDoc', async () => {
    const markers = _b3_snapshotMarkers();
    _b3_clearMarkers();
    const orig = _b3_saveModuleMethods();

    const stateSpy = _b3_makeSyncStateSpy('error');
    const setDoc = _b3_makeSetDocSpy();
    let backupCalls = 0;

    try {
      _b3_install({
        backup_exportLocal: async () => { backupCalls++; return { ok: true }; },
        fs_setDoc: setDoc.fn,
        syncStateObj: stateSpy.obj,
      });

      const result = await SyncEngine.pushSnapshot();

      assertEqual(result.ok, false, 'push returned ok=false');
      assertEqual(result.kind, 'sync-error-state', 'kind=sync-error-state');
      assertEqual(backupCalls, 0, 'backup NOT invoked');
      assertEqual(setDoc.calls.length, 0, 'no setDoc invocations');
      assertEqual(stateSpy.spy.length, 0,
        'SyncState.set NEVER called (caller is responsible for resetting to ready)');
    } finally {
      _b3_restoreModuleMethods(orig);
      _b3_restoreMarkers(markers);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Group 4: F13 gap regressions — Presets honor the SyncState write gate
// ────────────────────────────────────────────────────────────────────────
//
// NOTE: tests/index.html does NOT load js/recovery-ui.js, so the
// RecoveryUI.saveLog regression is not exercisable here. Documented in
// the return summary. The Presets F13 gates ARE exercised below since
// presets.js is loaded for B-1/F19b storage-layer tests.

describe('B-3 F13 gap — Presets.save honors the SyncState write gate', () => {
  it('returns early when SyncState.canWrite() is false; no localStorage write', () => {
    // Snapshot + clear the presets storage so we can detect a write.
    const prevPresets = localStorage.getItem('quick_presets');
    const prevSeeded = localStorage.getItem('presets_seeded');
    const prevSyncState = window.SyncState;
    try {
      localStorage.removeItem('quick_presets');
      // Install a stub SyncState that blocks writes.
      window.SyncState = {
        get: () => 'hydrating',
        set: () => true,
        canWrite: () => false,
        isHydrating: () => true,
        STORAGE_KEY: 'tempo_sync_state',
      };

      const result = Presets.save({
        name: 'BlockedPreset',
        mode: 'timer',
        config: { durationMs: 60000 },
      });

      // No localStorage write happened.
      const stored = localStorage.getItem('quick_presets');
      assertEqual(stored, null, 'quick_presets not written when canWrite=false');
      // F13 returns early — implementation returns undefined.
      assertEqual(result, undefined, 'save returned undefined (early-return)');

      // Now flip canWrite to true and re-save; write should occur.
      window.SyncState = {
        get: () => 'ready',
        set: () => true,
        canWrite: () => true,
        isHydrating: () => false,
        STORAGE_KEY: 'tempo_sync_state',
      };
      const result2 = Presets.save({
        name: 'AllowedPreset',
        mode: 'timer',
        config: { durationMs: 60000 },
      });
      assert(result2 !== undefined && result2.id, 'save returned the preset when gate open');
      const stored2 = localStorage.getItem('quick_presets');
      assert(stored2 !== null, 'quick_presets WAS written after gate opened');
      const parsed = JSON.parse(stored2);
      assertEqual(parsed.length, 1, 'one preset in storage');
      assertEqual(parsed[0].name, 'AllowedPreset', 'only the allowed preset was saved');
    } finally {
      // Restore.
      if (prevPresets === null) localStorage.removeItem('quick_presets');
      else localStorage.setItem('quick_presets', prevPresets);
      if (prevSeeded === null) localStorage.removeItem('presets_seeded');
      else localStorage.setItem('presets_seeded', prevSeeded);
      if (prevSyncState === undefined) delete window.SyncState;
      else window.SyncState = prevSyncState;
    }
  });
});

describe('B-3 F13 gap — Presets.update honors the SyncState write gate', () => {
  it('returns early when canWrite=false; record unchanged on disk', () => {
    const prevPresets = localStorage.getItem('quick_presets');
    const prevSyncState = window.SyncState;
    try {
      const seed = [{
        id: 'p-update-test',
        name: 'Original',
        mode: 'timer',
        config: { durationMs: 60000 },
        schemaVersion: 1,
      }];
      localStorage.setItem('quick_presets', JSON.stringify(seed));

      // Gate closed.
      window.SyncState = {
        get: () => 'hydrating',
        set: () => true,
        canWrite: () => false,
        isHydrating: () => true,
        STORAGE_KEY: 'tempo_sync_state',
      };

      Presets.update('p-update-test', { name: 'CHANGED' });

      const after = JSON.parse(localStorage.getItem('quick_presets'));
      assertEqual(after.length, 1, 'still one preset');
      assertEqual(after[0].name, 'Original', 'name unchanged (write was blocked)');

      // Gate open — update IS applied.
      window.SyncState = {
        get: () => 'ready',
        set: () => true,
        canWrite: () => true,
        isHydrating: () => false,
        STORAGE_KEY: 'tempo_sync_state',
      };
      Presets.update('p-update-test', { name: 'AfterGateOpened' });
      const after2 = JSON.parse(localStorage.getItem('quick_presets'));
      assertEqual(after2[0].name, 'AfterGateOpened', 'update applied after gate opened');
    } finally {
      if (prevPresets === null) localStorage.removeItem('quick_presets');
      else localStorage.setItem('quick_presets', prevPresets);
      if (prevSyncState === undefined) delete window.SyncState;
      else window.SyncState = prevSyncState;
    }
  });
});

describe('B-3 F13 gap — Presets.remove honors the SyncState write gate', () => {
  it('returns early when canWrite=false; record remains on disk', () => {
    const prevPresets = localStorage.getItem('quick_presets');
    const prevSyncState = window.SyncState;
    try {
      const seed = [{
        id: 'p-remove-test',
        name: 'ToRemove',
        mode: 'timer',
        config: { durationMs: 60000 },
        schemaVersion: 1,
      }];
      localStorage.setItem('quick_presets', JSON.stringify(seed));

      // Gate closed — remove must NOT mutate storage.
      window.SyncState = {
        get: () => 'hydrating',
        set: () => true,
        canWrite: () => false,
        isHydrating: () => true,
        STORAGE_KEY: 'tempo_sync_state',
      };

      Presets.remove('p-remove-test');
      const after = JSON.parse(localStorage.getItem('quick_presets'));
      assertEqual(after.length, 1, 'preset still on disk (gate blocked remove)');

      // Gate open — remove is honored.
      window.SyncState = {
        get: () => 'ready',
        set: () => true,
        canWrite: () => true,
        isHydrating: () => false,
        STORAGE_KEY: 'tempo_sync_state',
      };
      Presets.remove('p-remove-test');
      const after2 = JSON.parse(localStorage.getItem('quick_presets'));
      assertEqual(after2.length, 0, 'preset removed once gate opened');
    } finally {
      if (prevPresets === null) localStorage.removeItem('quick_presets');
      else localStorage.setItem('quick_presets', prevPresets);
      if (prevSyncState === undefined) delete window.SyncState;
      else window.SyncState = prevSyncState;
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Group 5: SyncFirestore stub seams (B-3 ships these as throw-stubs;
// real impls land in E-1+).
// ────────────────────────────────────────────────────────────────────────

describe('B-3 SyncFirestore.runTransaction — stub throws documented error', () => {
  it('rejects with kind=unknown and the "not implemented until E-1" message', async () => {
    // SyncFirestore lazy-flag-checks: when SyncFlag.isEnabled() is false
    // it throws SYNC_DISABLED first. Ensure flag is on for this seam test.
    const prevFlag = localStorage.getItem('tempo_sync_enabled');
    try {
      localStorage.setItem('tempo_sync_enabled', '1');

      let threw = false;
      let err;
      try {
        await SyncFirestore.runTransaction(() => {});
      } catch (e) {
        threw = true;
        err = e;
      }

      assert(threw, 'runTransaction must throw in B-3');
      // Engine-implementer wraps via _wrap('unknown', '...', false, null).
      assertEqual(err.kind, 'unknown', 'normalized kind is unknown');
      assert(/E-1|not implemented/i.test(err.message),
        'message references E-1 / not implemented (got: ' + err.message + ')');
      assertEqual(err.isRetryable, false, 'isRetryable=false on the stub');
    } finally {
      if (prevFlag === null) localStorage.removeItem('tempo_sync_enabled');
      else localStorage.setItem('tempo_sync_enabled', prevFlag);
    }
  });
});

describe('B-3 SyncFirestore.setBatch — stub throws documented error', () => {
  it('rejects with kind=unknown and references "per-record setDoc loop"', async () => {
    const prevFlag = localStorage.getItem('tempo_sync_enabled');
    try {
      localStorage.setItem('tempo_sync_enabled', '1');

      let threw = false;
      let err;
      try {
        await SyncFirestore.setBatch([]);
      } catch (e) {
        threw = true;
        err = e;
      }

      assert(threw, 'setBatch must throw in B-3');
      assertEqual(err.kind, 'unknown', 'normalized kind is unknown');
      assert(/per-record|not implemented|setDoc/i.test(err.message),
        'message documents the B-3 decision (got: ' + err.message + ')');
      assertEqual(err.isRetryable, false, 'isRetryable=false on the stub');
    } finally {
      if (prevFlag === null) localStorage.removeItem('tempo_sync_enabled');
      else localStorage.setItem('tempo_sync_enabled', prevFlag);
    }
  });
});
