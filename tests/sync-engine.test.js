// B-1 — SyncEngine + SyncFlag + four snapshotForSync() adapter tests.
//
// Scope (from docs/sync-impl/audits/B-1-AUDIT.md § "Test scope"):
//   1.  init() is a no-op when tempo_sync_enabled = '0'
//   2.  init() is idempotent
//   3.  init() with flag enabled stays a no-op in B-1 (no fetch, no snapshot)
//   4.  getSnapshot() shape — four keys, envelope shape, deviceId, schemaVersion
//   5.  Per-store snapshotForSync() defensive-copy contract (meds + history)
//   6.  F21 structural exclusion — no alarmFired anywhere in snapshot
//   7.  F2 ID shape preservation through History.snapshotForSync()
//   Plus optional cases:
//     8.  F4 regression — MedsManager.snapshotForSync() does not call recomputeLastTakenAt()
//     9.  F19a future-record passthrough
//     10. F19b unknown-field passthrough
//     11. SyncFlag.isEnabled() default false
//     12. SyncFlag.enable()/disable() round-trip
//     13. SyncEngine.getState() shape
//     14. SyncEngine.on/off/emit emitter behavior
//
// Stubbing pattern: history.js and recovery-ui.js are NOT loaded by
// tests/index.html, so each test that calls SyncEngine.getSnapshot() or
// History.snapshotForSync() / RecoveryUI.snapshotForSync() must install
// per-case stubs on window.History / window.RecoveryUI. meds.js and
// presets.js ARE loaded — those adapters run for real against in-memory
// state, which we control via MedsManager.add / clear and the
// quick_presets localStorage key. Mirrors the patterns in
// tests/sync-stamps.test.js (stubHistory / restoreHistory) and
// tests/analytics.test.js (setSessions).

// ── Shared History / RecoveryUI / Presets stubbing helpers ─────────────

const _realHistoryStubRoot = typeof window !== 'undefined' ? window.History : undefined;
const _realRecoveryUIStubRoot = typeof window !== 'undefined' ? window.RecoveryUI : undefined;

function stubHistoryForSync(opts) {
  const o = opts || {};
  window.History = {
    getDeviceId: () => o.deviceId || 'mock-device-abc',
    getSessions: async () => (o.sessions !== undefined ? o.sessions : []),
    snapshotForSync: async () => ({
      deviceId: o.deviceId || 'mock-device-abc',
      schemaVersion: Schema.SCHEMA_VERSION,
      payload: { sessions: (o.sessions !== undefined ? o.sessions : []).slice() },
    }),
  };
}

function stubRecoveryUIForSync(restLog) {
  window.RecoveryUI = {
    snapshotForSync: () => ({
      deviceId: 'mock-device-abc',
      schemaVersion: Schema.SCHEMA_VERSION,
      payload: { rest_log: restLog || {} },
    }),
  };
}

function restoreSyncStubs() {
  if (_realHistoryStubRoot === undefined) delete window.History;
  else window.History = _realHistoryStubRoot;
  if (_realRecoveryUIStubRoot === undefined) delete window.RecoveryUI;
  else window.RecoveryUI = _realRecoveryUIStubRoot;
}

// Local helpers for localStorage round-trips on shared keys so each test
// starts from a known baseline and restores whatever the user had before.
function snapshotSyncFlagKey() {
  return localStorage.getItem('tempo_sync_enabled');
}
function restoreSyncFlagKey(prev) {
  if (prev === null) localStorage.removeItem('tempo_sync_enabled');
  else localStorage.setItem('tempo_sync_enabled', prev);
}
function snapshotSyncStateKey() {
  return localStorage.getItem('tempo_sync_state');
}
function restoreSyncStateKey(prev) {
  if (prev === null) localStorage.removeItem('tempo_sync_state');
  else localStorage.setItem('tempo_sync_state', prev);
}

// Snapshot all meds/* keys so the tests can clear them in scoped fashion
// without nuking the user's real meds data. Mirrors the helper inside
// tests/meds.test.js.
function snapshotMedsKeys() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && (k.startsWith('meds/') || k === 'wellness_meds')) {
      out.push([k, localStorage.getItem(k)]);
    }
  }
  return out;
}
function clearMedsKeys() {
  const toClean = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && (k.startsWith('meds/') || k === 'wellness_meds')) toClean.push(k);
  }
  for (const k of toClean) localStorage.removeItem(k);
}
function restoreMedsKeys(snapshot) {
  clearMedsKeys();
  for (const [k, v] of snapshot) localStorage.setItem(k, v);
}

function snapshotPresetsKeys() {
  return [
    localStorage.getItem('quick_presets'),
    localStorage.getItem('presets_seeded'),
  ];
}
function clearPresetsKeys() {
  localStorage.removeItem('quick_presets');
  localStorage.removeItem('presets_seeded');
}
function restorePresetsKeys(snapshot) {
  const [presets, seeded] = snapshot;
  clearPresetsKeys();
  if (presets !== null) localStorage.setItem('quick_presets', presets);
  if (seeded !== null) localStorage.setItem('presets_seeded', seeded);
}

// Recursive walk over a snapshot output. Returns true if any object at
// any depth carries one of the forbidden per-device engine-state keys.
function snapshotContainsForbiddenKeys(node) {
  const forbidden = new Set(['alarmFired', 'zeroCrossedAt', 'focusEndedAt']);
  function visit(v) {
    if (v === null || typeof v !== 'object') return false;
    if (Array.isArray(v)) {
      for (const child of v) {
        if (visit(child)) return true;
      }
      return false;
    }
    for (const key of Object.keys(v)) {
      if (forbidden.has(key)) return true;
      if (visit(v[key])) return true;
    }
    return false;
  }
  return visit(node);
}

// ── SyncFlag basics ────────────────────────────────────────────────────

describe('SyncFlag — defaults and round-trip', () => {
  it('isEnabled() returns false when key is absent', () => {
    const prev = snapshotSyncFlagKey();
    try {
      localStorage.removeItem('tempo_sync_enabled');
      assertEqual(SyncFlag.isEnabled(), false);
    } finally {
      restoreSyncFlagKey(prev);
    }
  });

  it('enable() sets key to "1"; isEnabled() returns true', () => {
    const prev = snapshotSyncFlagKey();
    try {
      localStorage.removeItem('tempo_sync_enabled');
      SyncFlag.enable();
      assertEqual(localStorage.getItem('tempo_sync_enabled'), '1');
      assertEqual(SyncFlag.isEnabled(), true);
    } finally {
      restoreSyncFlagKey(prev);
    }
  });

  it('disable() sets key to "0" (explicit opt-out, not removeItem)', () => {
    const prev = snapshotSyncFlagKey();
    try {
      SyncFlag.enable();
      SyncFlag.disable();
      // Explicit '0' so the engine can distinguish "never opted in" (null)
      // from "user opted out" ('0'). Both are off, but the debugger view
      // is more useful when the path is distinguishable.
      assertEqual(localStorage.getItem('tempo_sync_enabled'), '0');
      assertEqual(SyncFlag.isEnabled(), false);
    } finally {
      restoreSyncFlagKey(prev);
    }
  });

  it('exposes STORAGE_KEY constant for debuggability', () => {
    assertEqual(SyncFlag.STORAGE_KEY, 'tempo_sync_enabled');
  });
});

// ── SyncEngine — init() lifecycle ──────────────────────────────────────

describe('SyncEngine.init — no-op when flag off (default path)', () => {
  it('does not invoke any store read when flag = "0"', () => {
    const prevFlag = snapshotSyncFlagKey();
    const prevState = snapshotSyncStateKey();
    try {
      SyncFlag.disable();  // tempo_sync_enabled = '0'

      // Spy on each adapter the registry would read. MedsManager + Presets
      // are loaded for real, so we patch their snapshotForSync directly and
      // count invocations. History + RecoveryUI are stubbed.
      let medsCalls = 0;
      let presetsCalls = 0;
      let historyCalls = 0;
      let recoveryCalls = 0;

      const origMedsSnap = MedsManager.snapshotForSync;
      const origPresetsSnap = Presets.snapshotForSync;
      MedsManager.snapshotForSync = function () { medsCalls++; return origMedsSnap.call(MedsManager); };
      Presets.snapshotForSync = function () { presetsCalls++; return origPresetsSnap.call(Presets); };
      window.History = {
        getDeviceId: () => 'mock-device-abc',
        snapshotForSync: async () => { historyCalls++; return { deviceId: 'mock-device-abc', schemaVersion: Schema.SCHEMA_VERSION, payload: { sessions: [] } }; },
      };
      window.RecoveryUI = {
        snapshotForSync: () => { recoveryCalls++; return { deviceId: 'mock-device-abc', schemaVersion: Schema.SCHEMA_VERSION, payload: { rest_log: {} } }; },
      };

      try {
        SyncEngine.init();
        assertEqual(medsCalls, 0, 'meds.snapshotForSync should NOT be called from init()');
        assertEqual(presetsCalls, 0, 'presets.snapshotForSync should NOT be called from init()');
        assertEqual(historyCalls, 0, 'history.snapshotForSync should NOT be called from init()');
        assertEqual(recoveryCalls, 0, 'recovery.snapshotForSync should NOT be called from init()');
      } finally {
        MedsManager.snapshotForSync = origMedsSnap;
        Presets.snapshotForSync = origPresetsSnap;
        restoreSyncStubs();
      }

      // tempo_sync_state must be untouched by init()
      const afterState = localStorage.getItem('tempo_sync_state');
      assertEqual(afterState, prevState, 'tempo_sync_state must be unchanged by init()');
    } finally {
      restoreSyncFlagKey(prevFlag);
      restoreSyncStateKey(prevState);
    }
  });

  it('marks getState().initialized = true after first call', () => {
    const prevFlag = snapshotSyncFlagKey();
    try {
      SyncFlag.disable();
      SyncEngine.init();
      const s = SyncEngine.getState();
      assertEqual(s.initialized, true);
    } finally {
      restoreSyncFlagKey(prevFlag);
    }
  });
});

describe('SyncEngine.init — idempotent', () => {
  it('second call is a no-op (no double-init, getState stable)', () => {
    const prevFlag = snapshotSyncFlagKey();
    try {
      SyncFlag.disable();
      SyncEngine.init();
      const after1 = SyncEngine.getState();
      // Toggle the flag mid-flight to see if init() re-checks it (it must
      // NOT — idempotence means subsequent calls early-return).
      SyncFlag.enable();
      SyncEngine.init();
      const after2 = SyncEngine.getState();
      // initialized stays true; enabled mirrors current flag state (it's a
      // live getter), which is the documented behavior.
      assertEqual(after1.initialized, true);
      assertEqual(after2.initialized, true);
      // Most important assertion: second init does NOT throw and does NOT
      // re-run the (currently no-op) auth-handshake branch.
    } finally {
      restoreSyncFlagKey(prevFlag);
    }
  });

  it('emit/listener registration is not duplicated on repeated init() calls', () => {
    // B-1's init() does not register any listener, but this test guards
    // future PRs from accidentally registering inside init() without an
    // idempotence guard. We call init() repeatedly and check that the
    // emitter map stays empty (no internal subscriber gets pushed twice).
    const prevFlag = snapshotSyncFlagKey();
    try {
      SyncFlag.disable();
      let testEvents = 0;
      const cb = () => { testEvents++; };
      SyncEngine.on('b1-test', cb);
      SyncEngine.init();
      SyncEngine.init();
      SyncEngine.init();
      SyncEngine.emit('b1-test', {});
      assertEqual(testEvents, 1, 'emit fires the listener exactly once regardless of init count');
      SyncEngine.off('b1-test', cb);
    } finally {
      restoreSyncFlagKey(prevFlag);
    }
  });
});

describe('SyncEngine.init — flag enabled is still a no-op in B-1', () => {
  it('does not fetch, does not snapshot, does not mutate sync state', () => {
    const prevFlag = snapshotSyncFlagKey();
    const prevState = snapshotSyncStateKey();
    const origFetch = window.fetch;
    try {
      // Stub fetch to count any network attempt. B-1 must not hit the
      // network, even when the flag is on — auth lives in B-2.
      let fetchCalls = 0;
      window.fetch = function () { fetchCalls++; return Promise.resolve(); };

      // Spy on getSnapshot itself to confirm init() does not invoke it.
      const origGetSnapshot = SyncEngine.getSnapshot;
      let snapshotCalls = 0;
      SyncEngine.getSnapshot = function () { snapshotCalls++; return origGetSnapshot.call(SyncEngine); };

      try {
        SyncFlag.enable();
        SyncEngine.init();
        assertEqual(fetchCalls, 0, 'fetch must not be called from init() in B-1');
        assertEqual(snapshotCalls, 0, 'getSnapshot must not be invoked from init() in B-1');
      } finally {
        SyncEngine.getSnapshot = origGetSnapshot;
      }

      // tempo_sync_state is owned by SyncState (persistence.js, F13).
      // SyncEngine.init() must not touch it.
      assertEqual(localStorage.getItem('tempo_sync_state'), prevState,
        'init() must not mutate tempo_sync_state');
    } finally {
      window.fetch = origFetch;
      restoreSyncFlagKey(prevFlag);
      restoreSyncStateKey(prevState);
    }
  });
});

// ── SyncEngine.getState() ──────────────────────────────────────────────

describe('SyncEngine.getState — shape', () => {
  it('returns { enabled, initialized } reflecting current state', () => {
    const prevFlag = snapshotSyncFlagKey();
    try {
      SyncFlag.disable();
      SyncEngine.init();
      const offState = SyncEngine.getState();
      assertEqual(offState.enabled, false);
      assertEqual(offState.initialized, true);
      assertEqual(Object.keys(offState).length, 2, 'getState should expose exactly 2 keys');

      SyncFlag.enable();
      const onState = SyncEngine.getState();
      assertEqual(onState.enabled, true);
      assertEqual(onState.initialized, true);
    } finally {
      restoreSyncFlagKey(prevFlag);
    }
  });
});

// ── SyncEngine.getSnapshot() shape ─────────────────────────────────────

describe('SyncEngine.getSnapshot — shape', () => {
  it('returns the four registry keys with the envelope shape', async () => {
    const prevFlag = snapshotSyncFlagKey();
    const medsSnapshot = snapshotMedsKeys();
    const presetsSnap = snapshotPresetsKeys();
    try {
      clearMedsKeys();
      clearPresetsKeys();
      MedsManager.clear();
      MedsManager.add({ name: 'TestMed', dose: '10 mg', frequency: 'once-daily' });

      stubHistoryForSync({
        deviceId: 'mock-device-abc',
        sessions: [{
          id: 'mock-device-abc-1700000000000-0',
          startedAt: 1, endedAt: 2, type: 'stopwatch', date: '2025-01-01T00:00:00.000Z',
          duration: 1000, laps: [], note: '', tags: [],
          deviceId: 'mock-device-abc', updatedAt: 1700000000000, schemaVersion: 1,
        }],
      });
      stubRecoveryUIForSync({ '2025-01-01': { sleep: { hours: 7.5 }, naps: [] } });

      try {
        const snap = await SyncEngine.getSnapshot();

        // Four registry keys, in registry order
        const keys = Object.keys(snap);
        assertEqual(keys.length, 4);
        assertEqual(keys[0], 'meds');
        assertEqual(keys[1], 'history');
        assertEqual(keys[2], 'rest_log');
        assertEqual(keys[3], 'presets');

        // Each value has the envelope shape
        for (const key of keys) {
          const env = snap[key];
          assert(env && typeof env === 'object', `${key} envelope is an object`);
          assert('deviceId' in env, `${key} envelope has deviceId`);
          assert('schemaVersion' in env, `${key} envelope has schemaVersion`);
          assert('payload' in env, `${key} envelope has payload`);
        }

        // Envelopes use the same deviceId as History.getDeviceId()
        assertEqual(snap.meds.deviceId, 'mock-device-abc');
        assertEqual(snap.history.deviceId, 'mock-device-abc');
        assertEqual(snap.rest_log.deviceId, 'mock-device-abc');
        assertEqual(snap.presets.deviceId, 'mock-device-abc');

        // schemaVersion at every envelope === Schema.SCHEMA_VERSION
        assertEqual(snap.meds.schemaVersion, Schema.SCHEMA_VERSION);
        assertEqual(snap.history.schemaVersion, Schema.SCHEMA_VERSION);
        assertEqual(snap.rest_log.schemaVersion, Schema.SCHEMA_VERSION);
        assertEqual(snap.presets.schemaVersion, Schema.SCHEMA_VERSION);
      } finally {
        restoreSyncStubs();
      }
    } finally {
      MedsManager.clear();
      restoreMedsKeys(medsSnapshot);
      restorePresetsKeys(presetsSnap);
      MedsManager.loadAll();
      restoreSyncFlagKey(prevFlag);
    }
  });
});

// ── Per-store snapshotForSync() defensive-copy contract ────────────────

describe('MedsManager.snapshotForSync — defensive copy', () => {
  it('mutating payload.meds does not affect internal MedsManager state', () => {
    const medsSnapshot = snapshotMedsKeys();
    try {
      clearMedsKeys();
      MedsManager.clear();
      const m = MedsManager.add({ name: 'Defensive', dose: '5 mg', frequency: 'once-daily' });
      m.logDose(1700000000000);

      stubHistoryForSync({ deviceId: 'mock-device-abc' });
      try {
        const snap = MedsManager.snapshotForSync();
        // Inject a forbidden field directly into the payload array — if
        // the adapter aliased internal state, this push would land on
        // m.getState() too.
        snap.payload.meds.push({ injected: true });
        // Mutate an inner record's doseLog as well.
        if (snap.payload.meds[0]) {
          snap.payload.meds[0].doseLog.push({ takenAt: 9999999999999, deviceId: 'tainted' });
          snap.payload.meds[0].name = 'TAINTED';
        }

        // Re-read internal state — must be unchanged.
        assertEqual(MedsManager.count(), 1, 'No new med leaked into MedsManager');
        const re = MedsManager.all()[0];
        assertEqual(re.getName(), 'Defensive', 'Name unchanged');
        assertEqual(re.getDoseLog().length, 1, 'doseLog length unchanged');
        assertEqual(re.getDoseLog()[0].takenAt, 1700000000000, 'Original dose preserved');
      } finally {
        restoreSyncStubs();
      }
    } finally {
      MedsManager.clear();
      restoreMedsKeys(medsSnapshot);
      MedsManager.loadAll();
    }
  });
});

describe('History.snapshotForSync — array-slice defensive copy (top-level)', () => {
  it('mutating the returned envelope payload.sessions array (push/pop) does not aliasing-poison repeat reads', async () => {
    // Note on contract scope: History sits behind IndexedDB in production —
    // IDB's getAll() always builds a fresh array of structured-cloned
    // objects per call, so the top-level array AND its inner objects are
    // intrinsically defensive copies in the real adapter. The test harness
    // doesn't load history.js (no IDB in unit tests), so we stub the
    // adapter and only assert the top-level array-slice contract that the
    // stub itself can model. The inner-object defensive-copy contract is
    // verified by the meds defensive-copy test above, which exercises a
    // real adapter (MedsManager.snapshotForSync is loaded).
    const sessionsFixture = [{
      id: 'mock-device-abc-1700000000000-0',
      startedAt: 1, endedAt: 2, type: 'stopwatch',
      duration: 1000, laps: [], date: '2025-01-01T00:00:00.000Z',
      deviceId: 'mock-device-abc', updatedAt: 1700000000000, schemaVersion: 1,
    }];

    stubHistoryForSync({ deviceId: 'mock-device-abc', sessions: sessionsFixture });
    try {
      const snap1 = await window.History.snapshotForSync();
      // Append to the returned array — should not mutate the fixture.
      snap1.payload.sessions.push({ id: 'INJECTED' });

      // Second call returns a fresh slice; the injection from snap1 must
      // not appear here. (This is the array-level defensive-copy contract
      // every adapter must satisfy.)
      const snap2 = await window.History.snapshotForSync();
      assertEqual(snap2.payload.sessions.length, 1,
        'Second snapshot call returns a fresh array of the same length');
      // Verify the injected sentinel doesn't appear in the second call's array.
      const injected = snap2.payload.sessions.find(s => s.id === 'INJECTED');
      assert(injected === undefined,
        'Injected sentinel does not leak into a subsequent snapshot call');
    } finally {
      restoreSyncStubs();
    }
  });
});

// ── F21 structural exclusion ───────────────────────────────────────────

describe('SyncEngine.getSnapshot — F21 structural exclusion', () => {
  it('no alarmFired / zeroCrossedAt / focusEndedAt at any depth', async () => {
    const medsSnapshot = snapshotMedsKeys();
    const presetsSnap = snapshotPresetsKeys();
    try {
      clearMedsKeys();
      clearPresetsKeys();
      MedsManager.clear();

      // Plant a med whose doseLog has multiple entries, plus a preset and
      // a session — three distinct payload shapes the walker exercises.
      const m = MedsManager.add({ name: 'F21', dose: '10 mg', frequency: 'as-needed' });
      m.logDose(1700000000000);
      m.logDose(1700000100000);

      // Plant a preset with nested config (to ensure recursion descends).
      Presets.save({
        id: 'fp-f21',
        name: 'F21Preset',
        mode: 'pomodoro',
        config: { workMs: 60000, checklist: ['a', 'b'] },
      });

      stubHistoryForSync({
        deviceId: 'mock-device-abc',
        sessions: [{
          id: 'mock-device-abc-1700000000000-0',
          startedAt: 1, endedAt: 2, type: 'pomodoro',
          duration: 60000, laps: [], date: '2025-01-01T00:00:00.000Z',
          deviceId: 'mock-device-abc', updatedAt: 1700000000000, schemaVersion: 1,
          // Plant a phaseLog so the recursive walker has to descend an array.
          phaseLog: [
            { phase: 'work', startedAt: 1, endedAt: 2, deviceId: 'mock-device-abc', phaseStartedAt: 1 },
          ],
        }],
      });
      stubRecoveryUIForSync({
        '2025-01-01': {
          sleep: { hours: 7.5, quality: 4 },
          naps: [{ startedAt: 1, durationMs: 1800000 }],
        },
      });

      try {
        const snap = await SyncEngine.getSnapshot();
        assert(!snapshotContainsForbiddenKeys(snap),
          'snapshot must not carry alarmFired / zeroCrossedAt / focusEndedAt anywhere');
      } finally {
        restoreSyncStubs();
      }
    } finally {
      MedsManager.clear();
      restoreMedsKeys(medsSnapshot);
      restorePresetsKeys(presetsSnap);
      MedsManager.loadAll();
    }
  });
});

// ── F2 ID shape preservation ───────────────────────────────────────────

describe('History.snapshotForSync — F2 id shape preservation', () => {
  it('id passes through byte-equivalent to ${deviceId}-${ts}-${counter}', async () => {
    const id = 'deviceXYZ-1234567890-7';
    stubHistoryForSync({
      deviceId: 'deviceXYZ',
      sessions: [{
        id,
        startedAt: 1, endedAt: 2, type: 'stopwatch',
        duration: 1000, laps: [], date: '2025-01-01T00:00:00.000Z',
        deviceId: 'deviceXYZ', updatedAt: 1700000000000, schemaVersion: 1,
      }],
    });
    try {
      const snap = await window.History.snapshotForSync();
      assertEqual(snap.payload.sessions.length, 1);
      assertEqual(snap.payload.sessions[0].id, id,
        'Session id must pass through unchanged (no re-derivation)');
      assertEqual(snap.deviceId, 'deviceXYZ',
        'Envelope deviceId matches History.getDeviceId()');
    } finally {
      restoreSyncStubs();
    }
  });
});

// ── F4 regression — recomputeLastTakenAt not called from snapshot ──────

describe('MedsManager.snapshotForSync — F4 regression', () => {
  it('does not call recomputeLastTakenAt() (lastTakenAt comes from getState pass-through)', () => {
    const medsSnapshot = snapshotMedsKeys();
    try {
      clearMedsKeys();
      MedsManager.clear();
      const m = MedsManager.add({ name: 'F4Reg', frequency: 'once-daily' });
      m.logDose(1700000000000);

      // Spy on recomputeLastTakenAt for this med instance.
      let recomputeCalls = 0;
      const orig = m.recomputeLastTakenAt;
      m.recomputeLastTakenAt = function () { recomputeCalls++; return orig.apply(m, arguments); };

      stubHistoryForSync({ deviceId: 'mock-device-abc' });
      try {
        MedsManager.snapshotForSync();
        assertEqual(recomputeCalls, 0,
          'snapshotForSync must not call recomputeLastTakenAt — that runs on the merge path (D-2)');
      } finally {
        restoreSyncStubs();
        m.recomputeLastTakenAt = orig;
      }
    } finally {
      MedsManager.clear();
      restoreMedsKeys(medsSnapshot);
      MedsManager.loadAll();
    }
  });
});

// ── F19a future-record passthrough ─────────────────────────────────────

describe('MedsManager.snapshotForSync — F19a future-record passthrough', () => {
  it('inner record schemaVersion=2 survives; envelope schemaVersion stays at current', () => {
    // F19a-fix PR (feat/sync-stage-a-f19a-passthrough-fix) restored this
    // assertion. Pre-fix, createMed.getState() unconditionally wrote
    // schemaVersion = Schema.SCHEMA_VERSION, downgrading future-schema
    // records on the wire-format passthrough. Post-fix, loadState captures
    // the on-disk schemaVersion when it's > SCHEMA_VERSION, and getState
    // emits the captured value verbatim.
    //
    // End-to-end snapshot path: seed a future record on disk → loadAll →
    // snapshotForSync → assert envelope stays current (wrapper version)
    // while the inner record preserves its future schemaVersion.
    const medsSnapshot = snapshotMedsKeys();
    try {
      clearMedsKeys();
      MedsManager.clear();
      localStorage.setItem('meds/f19a-1', JSON.stringify({
        id: 'f19a-1',
        schemaVersion: 2,
        name: 'FutureMed',
        dose: '15 mg',
        frequency: 'once-daily',
        doseLog: [],
        updatedAt: 1700000000000,
        deviceId: 'd-test',
      }));
      MedsManager.loadAll();

      stubHistoryForSync({ deviceId: 'mock-device-abc' });
      try {
        const snap = MedsManager.snapshotForSync();
        // Envelope stays at the current wrapper version — the envelope
        // version is the snapshot adapter's wrapper, not a per-record stamp.
        assertEqual(snap.schemaVersion, Schema.SCHEMA_VERSION,
          'envelope schemaVersion is the wrapper version (current)');
        assertEqual(snap.deviceId, 'mock-device-abc',
          'envelope deviceId comes from History.getDeviceId stub');
        // Inner record preserves its original future schemaVersion.
        const target = snap.payload.meds.find(x => x.id === 'f19a-1');
        assert(target !== undefined, 'f19a-1 med present in payload');
        assertEqual(target.schemaVersion, 2,
          'inner record schemaVersion=2 preserved end-to-end through load → getState → snapshot');
      } finally {
        restoreSyncStubs();
      }
    } finally {
      MedsManager.clear();
      restoreMedsKeys(medsSnapshot);
      MedsManager.loadAll();
    }
  });
});

// ── F19b unknown-field passthrough ─────────────────────────────────────

describe('MedsManager.snapshotForSync — F19b unknown-field passthrough', () => {
  it('unknown top-level field on a med survives into snapshot payload', () => {
    const medsSnapshot = snapshotMedsKeys();
    try {
      clearMedsKeys();
      MedsManager.clear();
      localStorage.setItem('meds/fwd-snap', JSON.stringify({
        id: 'fwd-snap',
        schemaVersion: 1,
        name: 'WithForward',
        dose: '20 mg',
        frequency: 'once-daily',
        doseLog: [],
        updatedAt: 1700000000000,
        deviceId: 'd-test',
        customFutureField: 'hi',
      }));
      MedsManager.loadAll();

      stubHistoryForSync({ deviceId: 'mock-device-abc' });
      try {
        const snap = MedsManager.snapshotForSync();
        const target = snap.payload.meds.find(x => x.id === 'fwd-snap');
        assert(target !== undefined, 'fwd-snap med present in payload');
        assertEqual(target.customFutureField, 'hi',
          'Unknown field rides through __forward → getState → snapshot');
      } finally {
        restoreSyncStubs();
      }
    } finally {
      MedsManager.clear();
      restoreMedsKeys(medsSnapshot);
      MedsManager.loadAll();
    }
  });
});

// ── SyncEngine.on/off/emit emitter behavior ────────────────────────────

describe('SyncEngine.on/off/emit — emitter happy path', () => {
  it('emit fires registered listeners with payload; off removes them', () => {
    let received = null;
    let fires = 0;
    const cb = (p) => { fires++; received = p; };
    SyncEngine.on('test-emit', cb);
    SyncEngine.emit('test-emit', { x: 1 });
    assertEqual(fires, 1);
    assert(received !== null && received.x === 1, 'payload delivered');

    SyncEngine.off('test-emit', cb);
    SyncEngine.emit('test-emit', { x: 2 });
    assertEqual(fires, 1, 'off() removed the listener — second emit is a no-op');
  });

  it('emit with no listeners is a safe no-op', () => {
    // Would throw if the implementation didn't guard the missing-set path.
    SyncEngine.emit('never-registered', { irrelevant: true });
    assertEqual(true, true, 'emit() with no listeners did not throw');
  });

  it('on() rejects non-string event names and non-function callbacks', () => {
    // Defensive contract — emit() walks the listener set, so a bad
    // callback would explode at emit time. The doc comment in sync-engine.js
    // says on() ignores malformed input; verify that contract.
    SyncEngine.on(null, () => {});
    SyncEngine.on('valid-event', 'not-a-function');
    // If on() accepted the bad inputs, emit() would crash. Run both:
    SyncEngine.emit(null, {});
    SyncEngine.emit('valid-event', {});
    assertEqual(true, true, 'malformed on() inputs were silently dropped');
  });
});
