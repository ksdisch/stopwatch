// Engine tests for the three sync-prep behaviors landed in PR A-1:
//   F4  — MedsManager re-derives lastTakenAt from doseLog after merge.
//   F6  — Pomodoro phaseLog entries carry (deviceId, phaseStartedAt) at push time.
//   F21 — alarmFired is per-device: each engine fires its own chime
//         independently, regardless of prior on-disk alarmFired state.
//
// F7 isn't testable as code (it's a static audit — see docs/sync-impl/F7-AUDIT.md).

// ── Shared History stub ──
//
// pomodoro.js's F6 stamp helper reads `History.getDeviceId()` at push time.
// History isn't loaded into the engine-test harness (no IDB in unit tests),
// so we stub it. Pattern mirrors tests/analytics.test.js's approach.
const _realHistory = typeof window !== 'undefined' ? window.History : undefined;
function stubHistory(deviceId) {
  window.History = { getDeviceId: () => deviceId };
}
function restoreHistory() {
  if (_realHistory === undefined) delete window.History;
  else window.History = _realHistory;
}

// Small helper: spin the real wall clock for `ms` to age out a running
// engine. Mirrors the pattern in tests/timer.test.js — the engines all
// derive elapsed from Date.now(), so a real spin is the simplest mock.
function spin(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) { /* spin */ }
}

// ── F4 — recomputeLastTakenAt ──

describe('F4 — Meds.recomputeLastTakenAt', () => {
  it('matches doseLog tail after a fresh log', () => {
    const m = createMed('f4-1');
    m.logDose(1700000000000);
    m.logDose(1700000100000);
    m.recomputeLastTakenAt();
    assertEqual(m.getLastTakenAt(), 1700000100000);
  });

  it('returns null when doseLog is empty', () => {
    const m = createMed('f4-2');
    m.recomputeLastTakenAt();
    assertEqual(m.getLastTakenAt(), null);
  });

  it('is idempotent — repeated calls produce the same result', () => {
    const m = createMed('f4-3');
    m.logDose(1700000000000);
    m.logDose(1700000300000);
    m.recomputeLastTakenAt();
    const first = m.getLastTakenAt();
    m.recomputeLastTakenAt();
    m.recomputeLastTakenAt();
    assertEqual(m.getLastTakenAt(), first);
  });

  it('converges after a cross-device merge appended a newer entry', () => {
    // Simulates D-2's reconcile path: a remote dose entry is appended to
    // the doseLog (with the log re-sorted ascending), and F4 must
    // re-derive the convenience mirror so cross-device consumers see the
    // newer takenAt.
    const m = createMed('f4-4');
    m.loadState({
      id: 'f4-4',
      lastTakenAt: 1700000000000,                  // intentionally stale
      doseLog: [
        { takenAt: 1700000000000, deviceId: 'a' },
        { takenAt: 1700000500000, deviceId: 'b' },
      ],
    });
    m.recomputeLastTakenAt();
    assertEqual(m.getLastTakenAt(), 1700000500000);
  });

  it('does not bump updatedAt (sync caller controls persistence)', () => {
    // F4 runs after a merge; SyncEngine batches saves around it.
    // Bumping updatedAt here would cause every merge to write back,
    // generating a roundtrip storm with no semantic change.
    const m = createMed('f4-5');
    m.logDose(1700000000000);
    const before = m.getUpdatedAt();
    // Tiny spin so a touch() would visibly bump updatedAt.
    spin(5);
    m.recomputeLastTakenAt();
    assertEqual(m.getUpdatedAt(), before);
  });
});

describe('F4 — MedsManager.onMergeComplete', () => {
  it('re-derives lastTakenAt on the named med', () => {
    MedsManager.clear();
    const m = MedsManager.add({ name: 'OnMerge' });
    m.logDose(1700000000000);
    // Simulate a remote entry landing in the doseLog (D-2's reconcile
    // shape — replace the log via loadState so the engine re-sorts).
    m.loadState({
      id: m.getId(),
      name: 'OnMerge',
      frequency: 'as-needed',
      doseLog: [
        { takenAt: 1700000000000, deviceId: 'local' },
        { takenAt: 1700000400000, deviceId: 'remote' },
      ],
    });
    MedsManager.onMergeComplete(m.getId());
    assertEqual(m.getLastTakenAt(), 1700000400000);
    MedsManager.clear();
  });

  it('is a safe no-op for an unknown medId', () => {
    MedsManager.clear();
    // Would throw if the helper didn't guard — surface as a test failure.
    MedsManager.onMergeComplete('does-not-exist');
    assertEqual(MedsManager.count(), 0);
  });
});

// ── F6 — phaseLog stamping ──

describe('F6 — Pomodoro phaseLog stamping', () => {
  it('loadState recovery push carries deviceId + phaseStartedAt', () => {
    // loadState's recovery branch synthesizes a phaseLog entry when the
    // tab closed mid-phase and reopened past the phase end. The
    // synthesized entry must carry F6 stamps so cross-device append-merge
    // can dedup it.
    stubHistory('device-a');
    try {
      Pomodoro.reset();
      Pomodoro.configure({ workMs: 60000, shortBreakMs: 60000, longBreakMs: 60000, totalCycles: 4 });
      Pomodoro.loadState({
        status: 'running',
        phase: 'work',
        cycleIndex: 0,
        totalCycles: 4,
        workMs: 60000,
        shortBreakMs: 60000,
        longBreakMs: 60000,
        startedAt: Date.now() - 65000,
        accumulatedMs: 0,
        sessionStartedAt: Date.now() - 65000,
        phaseStartedAt: Date.now() - 65000,
        phaseLog: [],
      });
      const log = Pomodoro.getPhaseLog();
      assertEqual(log.length, 1);
      assertEqual(log[0].deviceId, 'device-a');
      assert(typeof log[0].phaseStartedAt === 'number',
        'phaseStartedAt stamped on recovery push');
      assertEqual(log[0].phaseStartedAt, log[0].startedAt);
    } finally {
      restoreHistory();
    }
  });

  it('checkFinished push carries deviceId + phaseStartedAt', () => {
    // Exercise the natural completion path: load with a short phase, spin
    // past zero, call checkFinished. Asserts the push site at the natural
    // boundary inside the engine.
    stubHistory('device-b');
    try {
      Pomodoro.reset();
      // workMs goes through loadState (no min clamp) → 1s phase.
      const start = Date.now();
      Pomodoro.loadState({
        status: 'running',
        phase: 'work',
        cycleIndex: 0,
        totalCycles: 4,
        workMs: 1000,
        shortBreakMs: 60000,
        longBreakMs: 60000,
        startedAt: start - 200,    // 800ms remaining
        accumulatedMs: 0,
        sessionStartedAt: start - 200,
        phaseStartedAt: start - 200,
        phaseLog: [],
      });
      assertEqual(Pomodoro.getStatus(), 'running');
      spin(1100);  // age past the 1s phase boundary
      Pomodoro.checkFinished();
      assertEqual(Pomodoro.getStatus(), 'overflowing');
      const log = Pomodoro.getPhaseLog();
      assertEqual(log.length, 1);
      assertEqual(log[0].deviceId, 'device-b');
      assert(typeof log[0].phaseStartedAt === 'number',
        'phaseStartedAt stamped on natural-boundary push');
      assertEqual(log[0].phaseStartedAt, log[0].startedAt);
    } finally {
      restoreHistory();
    }
  });

  it('restartPhase push carries deviceId + phaseStartedAt', () => {
    stubHistory('device-c');
    try {
      Pomodoro.reset();
      Pomodoro.configure({ workMs: 60000, shortBreakMs: 60000, longBreakMs: 60000, totalCycles: 4 });
      Pomodoro.start();
      Pomodoro.restartPhase();
      const log = Pomodoro.getPhaseLog();
      assertEqual(log.length, 1);
      assertEqual(log[0].restarted, true);
      assertEqual(log[0].deviceId, 'device-c');
      assert(typeof log[0].phaseStartedAt === 'number',
        'phaseStartedAt stamped on restart push');
      assertEqual(log[0].phaseStartedAt, log[0].startedAt);
    } finally {
      restoreHistory();
    }
  });

  it('legacy phaseLog entries without stamps round-trip cleanly', () => {
    // F19b spirit: a pre-F6 phaseLog entry (no deviceId / phaseStartedAt)
    // must survive load + getState without corruption. The engine doesn't
    // back-fill stamps on load — pre-F6 entries stay as-is, and only
    // newly-pushed entries (post-A-1) carry the stamps.
    stubHistory('device-d');
    try {
      Pomodoro.reset();
      const legacyEntry = {
        phase: 'work', startedAt: 1700000000000, endedAt: 1700001500000,
        overshootMs: 0,
      };
      Pomodoro.loadState({
        status: 'idle',
        phase: 'work',
        cycleIndex: 1,
        totalCycles: 4,
        workMs: 60000,
        shortBreakMs: 60000,
        longBreakMs: 60000,
        startedAt: null,
        accumulatedMs: 0,
        phaseLog: [legacyEntry],
      });
      const out = Pomodoro.getState();
      assertEqual(out.phaseLog.length, 1);
      assertEqual(out.phaseLog[0].startedAt, 1700000000000);
      assert(out.phaseLog[0].deviceId === undefined,
        'legacy entry not back-filled with deviceId');
      assert(out.phaseLog[0].phaseStartedAt === undefined,
        'legacy entry not back-filled with phaseStartedAt');
    } finally {
      restoreHistory();
    }
  });

  it('stamps degrade gracefully when History is unavailable', () => {
    // Engine tests load pomodoro.js without history.js; the stamp helper
    // returns null in that case. Confirms the engine doesn't crash and the
    // phaseLog entry is still well-formed. Future sync code dedups on
    // (deviceId, phaseStartedAt) — a null deviceId is acceptable for
    // pre-sign-in entries.
    restoreHistory();
    if (typeof window !== 'undefined') delete window.History;
    Pomodoro.reset();
    Pomodoro.configure({ workMs: 60000, shortBreakMs: 60000, longBreakMs: 60000, totalCycles: 4 });
    Pomodoro.start();
    Pomodoro.restartPhase();
    const log = Pomodoro.getPhaseLog();
    assertEqual(log.length, 1);
    assertEqual(log[0].deviceId, null);
    assert(typeof log[0].phaseStartedAt === 'number',
      'phaseStartedAt still stamped without History');
  });
});

// ── F21 — alarmFired per-device contract ──
//
// The strategy doc says alarmFired is per-device — each engine fires its
// own chime regardless of any prior alarmFired state. Today engine state
// is excluded from sync, so the contract holds by construction. These
// tests are regression guards: if a future PR ever surfaces engine state
// to the cloud (F19c manifest registry, or any new synced store), the
// per-device alarm contract must continue to hold.
//
// The test shape per engine:
//   1. Simulate a stale state on disk where alarmFired=true (e.g. as if
//      cross-device sync had ever delivered it).
//   2. reset() — clears alarmFired.
//   3. Start a fresh session, run past zero via real-time spin.
//   4. Assert the callback fires exactly once (and only once across
//      repeated checkFinished calls — the on-device debounce).

describe('F21 — alarmFired per-device (Timer)', () => {
  it('fresh engine after reset fires alarm exactly once', () => {
    const t = createTimer('f21-timer', { allowOvershoot: false });
    let fires = 0;
    t.onAlarm(() => { fires++; });
    // Stale state with alarmFired=true (hypothetical leak).
    t.loadState({
      status: 'paused', durationMs: 1000, startedAt: null,
      accumulatedMs: 1000, alarmFired: true,
    });
    t.reset();
    // Fresh 1s session, "started" 200ms ago → 800ms remaining. loadState
    // recovery branch does NOT trigger (remaining > 0), so alarmFired stays
    // false. Then spin past zero and checkFinished fires the callback.
    t.loadState({
      status: 'running', durationMs: 1000,
      startedAt: Date.now() - 200, accumulatedMs: 0,
    });
    assertEqual(t.getStatus(), 'running');
    spin(1100);
    t.checkFinished();
    assertEqual(fires, 1);
    // Subsequent checkFinished is a no-op (engine debounce via status flip).
    t.checkFinished();
    t.checkFinished();
    assertEqual(fires, 1);
  });
});

describe('F21 — alarmFired per-device (Pomodoro)', () => {
  it('fresh engine after reset fires phase-complete exactly once', () => {
    Pomodoro.reset();
    let fires = 0;
    Pomodoro.onPhaseComplete(() => { fires++; });
    // Stale state with alarmFired=true.
    Pomodoro.loadState({
      status: 'overflowing', phase: 'work',
      cycleIndex: 0, totalCycles: 4,
      workMs: 60000, shortBreakMs: 60000, longBreakMs: 60000,
      startedAt: null, accumulatedMs: 60000,
      sessionStartedAt: Date.now() - 70000,
      phaseStartedAt: Date.now() - 70000,
      alarmFired: true, phaseLog: [],
    });
    Pomodoro.reset();
    // Fresh 1s phase running, "started" 200ms ago → spin past zero.
    const start = Date.now();
    Pomodoro.loadState({
      status: 'running', phase: 'work',
      cycleIndex: 0, totalCycles: 4,
      workMs: 1000, shortBreakMs: 60000, longBreakMs: 60000,
      startedAt: start - 200, accumulatedMs: 0,
      sessionStartedAt: start - 200,
      phaseStartedAt: start - 200,
      phaseLog: [],
    });
    assertEqual(Pomodoro.getStatus(), 'running');
    spin(1100);
    Pomodoro.checkFinished();
    assertEqual(fires, 1);
    // Repeated calls don't re-fire (on-device debounce).
    for (let i = 0; i < 10; i++) Pomodoro.checkFinished();
    assertEqual(fires, 1);
  });
});

describe('F21 — alarmFired per-device (Flow)', () => {
  it('fresh engine after reset fires phase-complete exactly once', () => {
    Flow.reset();
    let fires = 0;
    Flow.onPhaseComplete(() => { fires++; });
    // Stale state with alarmFired=true.
    Flow.loadState({
      status: 'overflowing', phase: 'focus',
      focusDurationMs: 60000,
      startedAt: null, accumulatedMs: 60000,
      sessionStartedAt: Date.now() - 70000,
      focusEndedAt: Date.now() - 5000,
      alarmFired: true, goal: '',
    });
    Flow.reset();
    // Fresh 1s focus phase running.
    const start = Date.now();
    Flow.loadState({
      status: 'running', phase: 'focus',
      focusDurationMs: 1000,
      startedAt: start - 200, accumulatedMs: 0,
      sessionStartedAt: start - 200, goal: '',
    });
    assertEqual(Flow.getStatus(), 'running');
    spin(1100);
    Flow.checkFinished();
    assertEqual(fires, 1);
    for (let i = 0; i < 10; i++) Flow.checkFinished();
    assertEqual(fires, 1);
  });
});

describe('F21 — alarmFired per-device (Interval)', () => {
  it('fresh engine after reset fires phase-complete exactly once on terminal', () => {
    Interval.reset();
    let fires = 0;
    Interval.onPhaseComplete(() => { fires++; });
    // Stale state with alarmFired=true (terminal overflowing).
    Interval.loadState({
      status: 'overflowing', phaseIndex: 0, roundIndex: 0, isResting: false,
      startedAt: null, accumulatedMs: 1000, alarmFired: true,
      program: { name: 'F21', rounds: 1, restBetweenRoundsMs: 0,
                 phases: [{ name: 'P1', durationMs: 1000 }] },
    });
    Interval.reset();
    // Fresh single-phase single-round program.
    Interval.setProgram({
      name: 'F21', rounds: 1, restBetweenRoundsMs: 0,
      phases: [{ name: 'P1', durationMs: 1000 }],
    });
    Interval.loadState({
      status: 'running', phaseIndex: 0, roundIndex: 0, isResting: false,
      startedAt: Date.now() - 200, accumulatedMs: 0,
      program: { name: 'F21', rounds: 1, restBetweenRoundsMs: 0,
                 phases: [{ name: 'P1', durationMs: 1000 }] },
    });
    assertEqual(Interval.getStatus(), 'running');
    spin(1100);
    Interval.checkFinished();
    assertEqual(fires, 1);
    for (let i = 0; i < 10; i++) Interval.checkFinished();
    assertEqual(fires, 1);
  });
});

// ── F19a — Meds future-record schemaVersion passthrough (post-fix) ──
//
// Pre-F19a-fix: createMed.getState() unconditionally stamped schemaVersion =
// Schema.SCHEMA_VERSION on every read, silently downgrading future-schema
// records on the wire-format passthrough (snapshotForSync → cloud upload).
// Post-F19a-fix: loadState captures the on-disk schemaVersion into a
// closed-over _originalSchemaVersion field when Schema.isFutureRecord(state)
// is true; getState emits _originalSchemaVersion ?? Schema.SCHEMA_VERSION.
//
// These tests exercise that contract directly against createMed (no
// localStorage, no manager) to keep blast radius minimal, plus one
// MedsManager.loadAll() roundtrip case for the integration shape.

describe('F19a — Meds future-record schemaVersion passthrough', () => {
  it('future-schema record (schemaVersion=2) preserves stamp on getState', () => {
    const m = createMed('f19a-1');
    m.loadState({
      id: 'f19a-1',
      name: 'FutureMed',
      dose: '10 mg',
      frequency: 'once-daily',
      schemaVersion: 2,
      doseLog: [],
      updatedAt: 1700000000000,
      deviceId: 'd-test',
    });
    const out = m.getState();
    assertEqual(out.schemaVersion, 2,
      'future schemaVersion preserved verbatim');
    assertEqual(m.isFromFutureSchema(), true,
      'future-record flag is set on load');
  });

  it('current-schema record (schemaVersion=1) stays at current on getState (regression)', () => {
    // Existing pre-fix behavior must be preserved: a current-version record
    // continues to emit Schema.SCHEMA_VERSION via the ?? fallback.
    const m = createMed('f19a-2');
    m.loadState({
      id: 'f19a-2',
      name: 'CurrentMed',
      frequency: 'once-daily',
      schemaVersion: Schema.SCHEMA_VERSION,
      doseLog: [],
      updatedAt: 1700000000000,
      deviceId: 'd-test',
    });
    const out = m.getState();
    assertEqual(out.schemaVersion, Schema.SCHEMA_VERSION,
      'current schemaVersion still emits SCHEMA_VERSION');
    assertEqual(m.isFromFutureSchema(), false,
      'current record is NOT flagged as future');
  });

  it('legacy record (no schemaVersion field) gets stamped to current on getState (regression)', () => {
    // Pre-F19a records with no schemaVersion field continue to be stamped
    // to SCHEMA_VERSION on their next save, lazily. The fix's null-fallback
    // path keeps this contract intact.
    const m = createMed('f19a-3');
    m.loadState({
      id: 'f19a-3',
      name: 'LegacyMed',
      frequency: 'once-daily',
      doseLog: [],
      updatedAt: 1700000000000,
      deviceId: 'd-test',
    });
    const out = m.getState();
    assertEqual(out.schemaVersion, Schema.SCHEMA_VERSION,
      'legacy record stamped to current SCHEMA_VERSION');
    assertEqual(m.isFromFutureSchema(), false,
      'legacy record is NOT flagged as future');
  });

  it('far-future schema version (99) preserved exactly (truthiness range check)', () => {
    // Catches an off-by-one or truthiness bug in the ?? operator. If
    // someone accidentally uses || instead, 0 / NaN would coerce wrong;
    // 99 is the canonical "schema version we definitely don't understand"
    // value that exercises the non-1, non-2 case.
    const m = createMed('f19a-4');
    m.loadState({
      id: 'f19a-4',
      name: 'FarFutureMed',
      frequency: 'once-daily',
      schemaVersion: 99,
      doseLog: [],
      updatedAt: 1700000000000,
      deviceId: 'd-test',
    });
    const out = m.getState();
    assertEqual(out.schemaVersion, 99,
      'far-future schemaVersion=99 preserved exactly');
    assertEqual(m.isFromFutureSchema(), true,
      'far-future record is flagged as future');
  });

  it('future record + unknown forward field round-trip together (F19a + F19b interaction)', () => {
    // Verifies the two preservation mechanisms (_originalSchemaVersion for
    // schemaVersion, _forwardBag for unknown keys) don't collide and that
    // schemaVersion isn't accidentally smuggled into _forwardBag — which
    // would cause double-emission via getState's Object.assign(out, bag).
    const m = createMed('f19a-5');
    m.loadState({
      id: 'f19a-5',
      name: 'ForwardCompatMed',
      frequency: 'once-daily',
      schemaVersion: 2,
      customFutureField: 'hi',
      doseLog: [],
      updatedAt: 1700000000000,
      deviceId: 'd-test',
    });
    const out = m.getState();
    assertEqual(out.schemaVersion, 2,
      'schemaVersion preserved (via _originalSchemaVersion)');
    assertEqual(out.customFutureField, 'hi',
      'unknown field preserved (via _forwardBag)');
  });

  it('idempotence: _originalSchemaVersion resets to null on every loadState', () => {
    // A subsequent loadState of a non-future record must properly forget
    // the prior captured value. A stale _originalSchemaVersion would leak
    // a future stamp onto a current record — subtle data corruption.
    const m = createMed('f19a-6');
    // First load: future record with schemaVersion=2.
    m.loadState({
      id: 'f19a-6',
      name: 'TmpFuture',
      frequency: 'once-daily',
      schemaVersion: 2,
      doseLog: [],
      updatedAt: 1700000000000,
      deviceId: 'd-test',
    });
    assertEqual(m.getState().schemaVersion, 2,
      'first load: future stamp preserved');
    assertEqual(m.isFromFutureSchema(), true);

    // Second load on the SAME instance: current record (no future stamp).
    m.loadState({
      id: 'f19a-6',
      name: 'TmpCurrent',
      frequency: 'once-daily',
      doseLog: [],
      updatedAt: 1700000000000,
      deviceId: 'd-test',
    });
    assertEqual(m.getState().schemaVersion, Schema.SCHEMA_VERSION,
      'second load: future stamp from prior load was cleared');
    assertEqual(m.isFromFutureSchema(), false,
      'future flag also reset');
  });

  it('MedsManager.loadAll roundtrip: future record on disk preserves stamp through getState', () => {
    // End-to-end integration shape: seed a meds/{id} key with a future
    // record on disk, call loadAll(), read .getState() on the loaded med,
    // assert the future schemaVersion survives. This mirrors what
    // snapshotForSync does internally (all().map(m => m.getState())).
    //
    // Snapshot ALL meds/* keys + the legacy blob key so we restore the
    // user's real meds data even if any assertion below throws.
    const medsSnapshot = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('meds/') || k === 'wellness_meds')) {
        medsSnapshot.push([k, localStorage.getItem(k)]);
      }
    }
    try {
      // Clear out current meds/* keys so loadAll only sees our fixture.
      const toClean = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('meds/') || k === 'wellness_meds')) toClean.push(k);
      }
      for (const k of toClean) localStorage.removeItem(k);
      MedsManager.clear();

      // Seed the disk with a future record + an unknown forward field.
      localStorage.setItem('meds/f19a-rt', JSON.stringify({
        id: 'f19a-rt',
        name: 'RoundtripFuture',
        dose: '30 mg',
        frequency: 'once-daily',
        schemaVersion: 2,
        customFutureField: 'hi',
        doseLog: [],
        updatedAt: 1700000000000,
        deviceId: 'd-test',
      }));

      MedsManager.loadAll();
      const loaded = MedsManager.all();
      assertEqual(loaded.length, 1, 'loadAll picked up the seeded med');
      assertEqual(loaded[0].getId(), 'f19a-rt');
      const wire = loaded[0].getState();
      assertEqual(wire.schemaVersion, 2,
        'future schemaVersion survives load → getState');
      assertEqual(wire.customFutureField, 'hi',
        'unknown forward field also survives');
      assertEqual(loaded[0].isFromFutureSchema(), true,
        'future-record flag is set');
    } finally {
      // Restore the user's real meds data.
      const toClean = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('meds/') || k === 'wellness_meds')) toClean.push(k);
      }
      for (const k of toClean) localStorage.removeItem(k);
      for (const [k, v] of medsSnapshot) localStorage.setItem(k, v);
      MedsManager.clear();
      MedsManager.loadAll();
    }
  });
});
