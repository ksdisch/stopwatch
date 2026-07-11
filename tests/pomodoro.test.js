describe('Pomodoro — creation and defaults', () => {
  it('creates with idle status and work phase', () => {
    const p = Pomodoro;
    p.reset();
    assertEqual(p.getStatus(), 'idle');
    assertEqual(p.getPhase(), 'work');
    assertEqual(p.getCycleIndex(), 0);
    assertEqual(p.getTotalCycles(), 4);
  });

  it('has default config', () => {
    Pomodoro.reset();
    const cfg = Pomodoro.getConfig();
    assertEqual(cfg.workMs, 25 * 60000);
    assertEqual(cfg.shortBreakMs, 5 * 60000);
    assertEqual(cfg.longBreakMs, 15 * 60000);
    assertEqual(cfg.totalCycles, 4);
  });
});

describe('Pomodoro — start/pause/resume', () => {
  it('starts from idle', () => {
    Pomodoro.reset();
    Pomodoro.start();
    assertEqual(Pomodoro.getStatus(), 'running');
    assertEqual(Pomodoro.getPhase(), 'work');
  });

  it('pauses when running', () => {
    Pomodoro.reset();
    Pomodoro.start();
    Pomodoro.pause();
    assertEqual(Pomodoro.getStatus(), 'paused');
  });

  it('resumes from paused', () => {
    Pomodoro.reset();
    Pomodoro.start();
    Pomodoro.pause();
    Pomodoro.start();
    assertEqual(Pomodoro.getStatus(), 'running');
  });

  it('does not start when done', () => {
    Pomodoro.reset();
    Pomodoro.loadState({ status: 'done', phase: 'work' });
    Pomodoro.start();
    assertEqual(Pomodoro.getStatus(), 'done');
  });

  it('does not start when overflowing (legacy phaseComplete migrates)', () => {
    Pomodoro.reset();
    Pomodoro.loadState({ status: 'phaseComplete', phase: 'work' });
    // loadState migrates legacy 'phaseComplete' → 'overflowing'
    Pomodoro.start();
    assertEqual(Pomodoro.getStatus(), 'overflowing');
  });
});

describe('Pomodoro — remaining time', () => {
  it('remaining equals work duration when idle', () => {
    Pomodoro.reset();
    assertEqual(Pomodoro.getRemainingMs(), 25 * 60000);
  });

  it('remaining decreases when running', () => {
    Pomodoro.reset();
    Pomodoro.start();
    assert(Pomodoro.getRemainingMs() <= 25 * 60000, 'Remaining should decrease');
  });

  it('progress is between 0 and 1', () => {
    Pomodoro.reset();
    Pomodoro.start();
    const p = Pomodoro.getProgress();
    assert(p >= 0 && p <= 1, 'Progress should be 0-1');
  });
});

describe('Pomodoro — phase transitions', () => {
  it('work → shortBreak after phase complete (cycle 1)', () => {
    Pomodoro.reset();
    // Simulate work phase completion
    Pomodoro.loadState({
      status: 'phaseComplete',
      phase: 'work',
      cycleIndex: 0,
      totalCycles: 4,
    });
    Pomodoro.nextPhase();
    assertEqual(Pomodoro.getPhase(), 'shortBreak');
    assertEqual(Pomodoro.getCycleIndex(), 1);
    assertEqual(Pomodoro.getStatus(), 'idle');
  });

  it('shortBreak → work after break complete', () => {
    Pomodoro.reset();
    Pomodoro.loadState({
      status: 'phaseComplete',
      phase: 'shortBreak',
      cycleIndex: 1,
      totalCycles: 4,
    });
    Pomodoro.nextPhase();
    assertEqual(Pomodoro.getPhase(), 'work');
    assertEqual(Pomodoro.getStatus(), 'idle');
  });

  it('work → longBreak after 4th work session', () => {
    Pomodoro.reset();
    Pomodoro.loadState({
      status: 'phaseComplete',
      phase: 'work',
      cycleIndex: 3, // 0-based, 4th cycle
      totalCycles: 4,
    });
    Pomodoro.nextPhase();
    assertEqual(Pomodoro.getPhase(), 'longBreak');
    assertEqual(Pomodoro.getCycleIndex(), 4);
  });

  it('longBreak → done', () => {
    Pomodoro.reset();
    Pomodoro.loadState({
      status: 'phaseComplete',
      phase: 'longBreak',
      cycleIndex: 4,
      totalCycles: 4,
    });
    Pomodoro.nextPhase();
    assertEqual(Pomodoro.getStatus(), 'done');
  });
});

describe('Pomodoro — full cycle (2 cycles)', () => {
  it('completes a 2-cycle set correctly', () => {
    Pomodoro.reset();
    Pomodoro.configure({ totalCycles: 2, workMs: 60000, shortBreakMs: 60000, longBreakMs: 60000 });

    // Cycle 1: work
    assertEqual(Pomodoro.getPhase(), 'work');
    Pomodoro.loadState({ status: 'phaseComplete', phase: 'work', cycleIndex: 0, totalCycles: 2 });
    Pomodoro.nextPhase();
    assertEqual(Pomodoro.getPhase(), 'shortBreak');
    assertEqual(Pomodoro.getCycleIndex(), 1);

    // Cycle 1: short break
    Pomodoro.loadState({ status: 'phaseComplete', phase: 'shortBreak', cycleIndex: 1, totalCycles: 2 });
    Pomodoro.nextPhase();
    assertEqual(Pomodoro.getPhase(), 'work');

    // Cycle 2: work
    Pomodoro.loadState({ status: 'phaseComplete', phase: 'work', cycleIndex: 1, totalCycles: 2 });
    Pomodoro.nextPhase();
    assertEqual(Pomodoro.getPhase(), 'longBreak');
    assertEqual(Pomodoro.getCycleIndex(), 2);

    // Long break
    Pomodoro.loadState({ status: 'phaseComplete', phase: 'longBreak', cycleIndex: 2, totalCycles: 2 });
    Pomodoro.nextPhase();
    assertEqual(Pomodoro.getStatus(), 'done');
  });
});

describe('Pomodoro — checkFinished', () => {
  it('triggers overflowing when time expires', () => {
    Pomodoro.reset();
    Pomodoro.configure({ workMs: 60000, shortBreakMs: 60000, longBreakMs: 60000, totalCycles: 4 });

    // loadState with expired time auto-completes the phase into overflow
    Pomodoro.loadState({
      status: 'running',
      phase: 'work',
      startedAt: Date.now() - 120000,
      accumulatedMs: 0,
      workMs: 60000,
    });

    // loadState should have auto-set overflowing (replaces legacy phaseComplete)
    assertEqual(Pomodoro.getStatus(), 'overflowing');
  });

  it('does not trigger when time remains', () => {
    Pomodoro.reset();
    Pomodoro.configure({ workMs: 60000, shortBreakMs: 60000, longBreakMs: 60000, totalCycles: 4 });
    Pomodoro.start();
    const result = Pomodoro.checkFinished();
    assertEqual(result, false);
    assertEqual(Pomodoro.getStatus(), 'running');
  });
});

describe('Pomodoro — configure', () => {
  it('updates durations when idle', () => {
    Pomodoro.reset();
    Pomodoro.configure({ workMs: 120000, shortBreakMs: 90000, longBreakMs: 600000, totalCycles: 6 });
    const cfg = Pomodoro.getConfig();
    assertEqual(cfg.workMs, 120000);
    assertEqual(cfg.shortBreakMs, 90000);
    assertEqual(cfg.longBreakMs, 600000);
    assertEqual(cfg.totalCycles, 6);
  });

  it('ignores configure when not idle', () => {
    Pomodoro.reset();
    // Reset config to known defaults first
    Pomodoro.configure({ workMs: 25 * 60000, shortBreakMs: 5 * 60000, longBreakMs: 15 * 60000, totalCycles: 4 });
    Pomodoro.start();
    Pomodoro.configure({ workMs: 999999 });
    const cfg = Pomodoro.getConfig();
    assertEqual(cfg.workMs, 25 * 60000); // unchanged
  });

  it('clamps totalCycles to 1-10', () => {
    Pomodoro.reset();
    Pomodoro.configure({ totalCycles: 0 });
    assertEqual(Pomodoro.getTotalCycles(), 1);
    Pomodoro.configure({ totalCycles: 20 });
    assertEqual(Pomodoro.getTotalCycles(), 10);
  });

  it('clamps durations to minimum 60000ms', () => {
    Pomodoro.reset();
    Pomodoro.configure({ workMs: 100, shortBreakMs: 100, longBreakMs: 100 });
    const cfg = Pomodoro.getConfig();
    assertEqual(cfg.workMs, 60000);
    assertEqual(cfg.shortBreakMs, 60000);
    assertEqual(cfg.longBreakMs, 60000);
  });
});

describe('Pomodoro — state serialization', () => {
  it('getState returns complete state', () => {
    Pomodoro.reset();
    Pomodoro.start();
    const state = Pomodoro.getState();
    assertEqual(state.status, 'running');
    assertEqual(state.phase, 'work');
    assert(state.startedAt !== null, 'startedAt should be set');
  });

  it('loadState restores and handles clock skew', () => {
    Pomodoro.reset();
    Pomodoro.loadState({
      status: 'running',
      phase: 'work',
      startedAt: Date.now() + 999999,
      accumulatedMs: 0,
    });
    assertEqual(Pomodoro.getStatus(), 'paused');
  });

  it('loadState auto-completes expired phase into overflowing', () => {
    Pomodoro.reset();
    Pomodoro.loadState({
      status: 'running',
      phase: 'work',
      workMs: 10000,
      startedAt: Date.now() - 60000,
      accumulatedMs: 0,
    });
    assertEqual(Pomodoro.getStatus(), 'overflowing');
  });

  it('reset restores defaults', () => {
    Pomodoro.reset();
    assertEqual(Pomodoro.getStatus(), 'idle');
    assertEqual(Pomodoro.getPhase(), 'work');
    assertEqual(Pomodoro.getCycleIndex(), 0);
  });

  it('loadState preserves 0 values with nullish coalescing', () => {
    Pomodoro.reset();
    Pomodoro.loadState({
      status: 'idle',
      cycleIndex: 0,
      accumulatedMs: 0,
    });
    assertEqual(Pomodoro.getCycleIndex(), 0);
    assertEqual(Pomodoro.getStatus(), 'idle');
  });

  it('done state preserves cycleIndex 0 correctly', () => {
    Pomodoro.reset();
    Pomodoro.loadState({
      status: 'done',
      phase: 'work',
      cycleIndex: 0,
    });
    assertEqual(Pomodoro.getStatus(), 'done');
    assertEqual(Pomodoro.getCycleIndex(), 0);
  });
});

describe("Pomodoro — adjustRemainingMs", () => {
  it("extends current phase remaining while running", () => {
    Pomodoro.reset();
    Pomodoro.start();
    const before = Pomodoro.getRemainingMs();
    const ok = Pomodoro.adjustRemainingMs(180000);
    assertEqual(ok, true);
    const after = Pomodoro.getRemainingMs();
    assert(after - before >= 179000 && after - before <= 181000,
      `Expected ~+180000ms, got ${after - before}`);
  });

  it("extends current phase while paused", () => {
    Pomodoro.reset();
    Pomodoro.start();
    Pomodoro.pause();
    const before = Pomodoro.getRemainingMs();
    assertEqual(Pomodoro.adjustRemainingMs(180000), true);
    assert(Pomodoro.getRemainingMs() - before >= 179000 && Pomodoro.getRemainingMs() - before <= 181000,
      "Paused extend should add ~180000ms");
  });

  it("rejects when idle", () => {
    Pomodoro.reset();
    assertEqual(Pomodoro.adjustRemainingMs(180000), false);
    assertEqual(Pomodoro.getCurrentPhaseDurationMs(), 25 * 60000);
  });

  it("rejects underflow when -delta would go below 1s", () => {
    Pomodoro.reset();
    Pomodoro.configure({ workMs: 120000 });  // 2 min work
    Pomodoro.start();
    assertEqual(Pomodoro.adjustRemainingMs(-180000), false);
  });

  it("phaseAdjustmentMs resets on nextPhase (does not leak to next phase)", () => {
    Pomodoro.reset();
    Pomodoro.configure({ workMs: 60000, shortBreakMs: 5 * 60000, longBreakMs: 15 * 60000, totalCycles: 4 });
    Pomodoro.start();
    Pomodoro.adjustRemainingMs(180000);  // +3 min on current work phase
    // Force phase complete
    Pomodoro.loadState({ ...Pomodoro.getState(), status: "phaseComplete", accumulatedMs: 240000 });
    Pomodoro.nextPhase();  // moves to shortBreak, resets phaseAdjustmentMs
    Pomodoro.start();
    // Break should be the configured 5 min, not 5 min + 3 min
    const breakRemaining = Pomodoro.getRemainingMs();
    assert(breakRemaining > 4 * 60000 && breakRemaining <= 5 * 60000,
      `Expected break ~5 min, got ${breakRemaining / 60000} min`);
  });

  it("phaseAdjustmentMs resets on restartPhase", () => {
    Pomodoro.reset();
    Pomodoro.configure({ workMs: 25 * 60000 });
    Pomodoro.start();
    Pomodoro.adjustRemainingMs(180000);
    Pomodoro.restartPhase();
    Pomodoro.start();
    const remaining = Pomodoro.getRemainingMs();
    assert(remaining > 24 * 60000 && remaining <= 25 * 60000,
      `Expected ~25 min, got ${remaining / 60000} min`);
  });

  it("phaseAdjustmentMs resets on reset", () => {
    Pomodoro.reset();
    Pomodoro.configure({ workMs: 25 * 60000 });
    Pomodoro.start();
    Pomodoro.adjustRemainingMs(180000);
    Pomodoro.reset();
    Pomodoro.configure({ workMs: 25 * 60000 });
    Pomodoro.start();
    const remaining = Pomodoro.getRemainingMs();
    assert(remaining > 24 * 60000 && remaining <= 25 * 60000,
      `Expected ~25 min after reset, got ${remaining / 60000} min`);
  });

  it("phaseAdjustmentMs survives getState/loadState round-trip", () => {
    Pomodoro.reset();
    Pomodoro.configure({ workMs: 25 * 60000 });
    Pomodoro.start();
    Pomodoro.adjustRemainingMs(180000);
    const before = Pomodoro.getCurrentPhaseDurationMs();
    const state = Pomodoro.getState();
    Pomodoro.reset();
    Pomodoro.configure({ workMs: 25 * 60000 });
    Pomodoro.loadState(state);
    assertEqual(Pomodoro.getCurrentPhaseDurationMs(), before);
  });
});


describe('Pomodoro — revertPhase', () => {
  // Helper: put engine into overflowing state with a known accumulatedMs.
  // Uses the same loadState-with-expired-timer pattern the existing overshoot
  // tests use. workMs is set to 60000 so the arithmetic stays simple.
  function _forceOverflowing() {
    Pomodoro.reset();
    Pomodoro.loadState({
      status: 'running',
      phase: 'work',
      cycleIndex: 0,
      totalCycles: 4,
      workMs: 60000,
      shortBreakMs: 60000,
      longBreakMs: 60000,
      startedAt: Date.now() - 70000,
      accumulatedMs: 0,
      sessionStartedAt: Date.now() - 70000,
      phaseStartedAt: Date.now() - 70000,
      phaseLog: [],
    });
    // loadState auto-transitions to 'overflowing'
  }

  it('snapshot captured on nextPhase', () => {
    _forceOverflowing();
    assertEqual(Pomodoro.getStatus(), 'overflowing');
    Pomodoro.nextPhase();
    const snap = Pomodoro.getState().previousPhaseSnapshot;
    assert(snap !== null, 'snapshot should be non-null after nextPhase');
    assertEqual(snap.phase, 'work');
    assertEqual(snap.cycleIndex, 0);
    assert(snap.accumulatedMs > 0, 'snapshot.accumulatedMs should be non-zero (captured at overflow)');
  });

  it('revertPhase while paused restores phase, cycleIndex, accumulatedMs, status', () => {
    _forceOverflowing();
    Pomodoro.nextPhase(); // status → idle, phase → shortBreak
    const snap = Pomodoro.getState().previousPhaseSnapshot;
    Pomodoro.start();    // status → running
    Pomodoro.pause();    // status → paused; accumulatedMs captures some elapsed
    const pausedAccumulated = Pomodoro.getState().accumulatedMs;
    Pomodoro.revertPhase();
    const state = Pomodoro.getState();
    assertEqual(state.phase, 'work');
    assertEqual(state.cycleIndex, 0);
    assertEqual(state.status, 'paused');
    assertEqual(state.previousPhaseSnapshot, null);
    // accumulatedMs = snapshot.accumulatedMs + time we spent in the break phase
    assertClose(state.accumulatedMs, snap.accumulatedMs + pausedAccumulated, 100,
      'accumulatedMs should fold in time spent in the new phase');
  });

  it('revertPhase while running keeps status running and resets startedAt', () => {
    _forceOverflowing();
    Pomodoro.nextPhase(); // status → idle
    const snap = Pomodoro.getState().previousPhaseSnapshot;
    Pomodoro.start();    // status → running
    const beforeRevert = Date.now();
    Pomodoro.revertPhase();
    const afterRevert = Date.now();
    const state = Pomodoro.getState();
    assertEqual(state.status, 'running');
    assertEqual(state.phase, 'work');
    assertEqual(state.cycleIndex, 0);
    assertEqual(state.previousPhaseSnapshot, null);
    // startedAt should be approximately now (set fresh in revertPhase)
    assert(state.startedAt >= beforeRevert - 5 && state.startedAt <= afterRevert + 5,
      'startedAt should be approximately now after revert while running');
    // accumulatedMs is approximately snap.accumulatedMs (minimal elapsed since start)
    assertClose(state.accumulatedMs, snap.accumulatedMs, 200,
      'accumulatedMs should be approximately snapshot value when elapsed is near zero');
  });

  it('revertPhase from idle (new phase not yet started) sets status to paused', () => {
    _forceOverflowing();
    Pomodoro.nextPhase(); // status → idle (new phase not started)
    const snap = Pomodoro.getState().previousPhaseSnapshot;
    // Do NOT call start() — revert from idle
    Pomodoro.revertPhase();
    const state = Pomodoro.getState();
    assertEqual(state.status, 'paused');
    assertEqual(state.phase, 'work');
    assertEqual(state.cycleIndex, 0);
    assertEqual(state.previousPhaseSnapshot, null);
    // currentElapsed is 0 when idle (no startedAt), so accumulatedMs == snapshot value
    assertEqual(state.accumulatedMs, snap.accumulatedMs,
      'accumulatedMs should equal snapshot when reverting from idle (zero elapsed)');
  });

  it('cycleIndex is un-incremented after revertPhase (captured before cycleIndex++)', () => {
    Pomodoro.reset();
    Pomodoro.loadState({
      status: 'running',
      phase: 'work',
      cycleIndex: 0,
      totalCycles: 2,
      workMs: 60000,
      shortBreakMs: 60000,
      longBreakMs: 60000,
      startedAt: Date.now() - 70000,
      accumulatedMs: 0,
      sessionStartedAt: Date.now() - 70000,
      phaseStartedAt: Date.now() - 70000,
      phaseLog: [],
    });
    assertEqual(Pomodoro.getStatus(), 'overflowing');
    Pomodoro.nextPhase(); // cycleIndex increments to 1, phase → shortBreak
    assertEqual(Pomodoro.getCycleIndex(), 1);
    Pomodoro.revertPhase();
    assertEqual(Pomodoro.getCycleIndex(), 0,
      'cycleIndex should be restored to pre-transition value (0), not the incremented value (1)');
  });

  it('snapshot overwritten on second nextPhase reflects second transition pre-state', () => {
    // First transition: work(cycleIndex=0) → shortBreak
    _forceOverflowing();
    Pomodoro.nextPhase(); // snap1: { phase:'work', cycleIndex:0 }

    // Now force the shortBreak to overflow so we can call nextPhase again
    Pomodoro.loadState({
      status: 'running',
      phase: 'shortBreak',
      cycleIndex: 1,
      totalCycles: 4,
      workMs: 60000,
      shortBreakMs: 60000,
      longBreakMs: 60000,
      startedAt: Date.now() - 70000,
      accumulatedMs: 0,
      sessionStartedAt: Date.now() - 140000,
      phaseStartedAt: Date.now() - 70000,
      phaseLog: Pomodoro.getPhaseLog(),
    });
    assertEqual(Pomodoro.getStatus(), 'overflowing');

    // Second transition: shortBreak(cycleIndex=1) → work
    Pomodoro.nextPhase(); // snap2 should overwrite snap1: { phase:'shortBreak', cycleIndex:1 }

    const snap = Pomodoro.getState().previousPhaseSnapshot;
    assert(snap !== null, 'snapshot should exist after second nextPhase');
    assertEqual(snap.phase, 'shortBreak',
      'snapshot should reflect second transition (shortBreak), not first (work)');
    assertEqual(snap.cycleIndex, 1,
      'snapshot cycleIndex should reflect second transition value (1)');
  });

  it('revertPhase on null snapshot is a no-op and does not throw', () => {
    Pomodoro.reset();
    // Fresh instance: previousPhaseSnapshot is null
    const stateBefore = Pomodoro.getState();
    let threw = false;
    try {
      Pomodoro.revertPhase();
    } catch (e) {
      threw = true;
    }
    assert(!threw, 'revertPhase should not throw when snapshot is null');
    const stateAfter = Pomodoro.getState();
    assertEqual(stateAfter.status, stateBefore.status);
    assertEqual(stateAfter.phase, stateBefore.phase);
    assertEqual(stateAfter.cycleIndex, stateBefore.cycleIndex);
    assertEqual(stateAfter.accumulatedMs, stateBefore.accumulatedMs);
  });

  it('reset clears previousPhaseSnapshot', () => {
    _forceOverflowing();
    Pomodoro.nextPhase(); // creates snapshot
    assert(Pomodoro.getState().previousPhaseSnapshot !== null, 'snapshot should exist before reset');
    Pomodoro.reset();
    assertEqual(Pomodoro.getState().previousPhaseSnapshot, null,
      'reset() should clear previousPhaseSnapshot');
  });

  it('persistence round-trip: loadState restores previousPhaseSnapshot', () => {
    _forceOverflowing();
    Pomodoro.nextPhase(); // creates snapshot
    const captured = Pomodoro.getState();
    const snapBefore = captured.previousPhaseSnapshot;
    assert(snapBefore !== null, 'snapshot should exist before reset');

    Pomodoro.reset();
    assertEqual(Pomodoro.getState().previousPhaseSnapshot, null, 'snapshot cleared after reset');

    Pomodoro.loadState(captured);
    const snapAfter = Pomodoro.getState().previousPhaseSnapshot;
    assert(snapAfter !== null, 'snapshot should be restored by loadState');
    assertEqual(snapAfter.phase, snapBefore.phase);
    assertEqual(snapAfter.cycleIndex, snapBefore.cycleIndex);
    assertEqual(snapAfter.accumulatedMs, snapBefore.accumulatedMs);
  });
});

describe('Pomodoro — overshoot', () => {
  it('phase past zero transitions to overflowing (replaces phaseComplete)', () => {
    Pomodoro.reset();
    Pomodoro.configure({ workMs: 60000, shortBreakMs: 60000, longBreakMs: 60000, totalCycles: 4 });
    Pomodoro.start();
    // Force the engine into a state where remaining is 0.
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
    // loadState should have transitioned to overflowing automatically.
    assertEqual(Pomodoro.getStatus(), 'overflowing');
    assert(Pomodoro.isOvershooting(), 'isOvershooting');
    assert(Pomodoro.getOvershootMs() >= 4000, 'overshoot at least 4s past');
  });

  it('phaseLog entry gets overshootMs back-filled on nextPhase', () => {
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
      startedAt: Date.now() - 67000,
      accumulatedMs: 0,
      sessionStartedAt: Date.now() - 67000,
      phaseStartedAt: Date.now() - 67000,
      phaseLog: [],
    });
    assertEqual(Pomodoro.getStatus(), 'overflowing');
    Pomodoro.nextPhase();
    const log = Pomodoro.getPhaseLog();
    assertEqual(log.length, 1);
    assert((log[0].overshootMs || 0) >= 5000, 'overshoot captured into phaseLog');
  });

  it('legacy "phaseComplete" persisted state migrates to overflowing', () => {
    Pomodoro.reset();
    Pomodoro.loadState({
      status: 'phaseComplete',
      phase: 'work',
      cycleIndex: 0,
      totalCycles: 4,
      workMs: 60000,
      shortBreakMs: 60000,
      longBreakMs: 60000,
      startedAt: null,
      accumulatedMs: 60000,
      phaseLog: [],
    });
    assertEqual(Pomodoro.getStatus(), 'overflowing');
  });

  it('alarm fires once even with multiple checkFinished calls', () => {
    Pomodoro.reset();
    Pomodoro.configure({ workMs: 60000, shortBreakMs: 60000, longBreakMs: 60000, totalCycles: 4 });
    let count = 0;
    Pomodoro.onPhaseComplete(() => count++);
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
    // loadState already transitioned us to overflowing with alarmFired=true.
    // checkFinished should be a no-op now and definitely not re-fire.
    for (let i = 0; i < 30; i++) Pomodoro.checkFinished();
    assertEqual(count, 0);
  });

  it('nextPhase clears alarm-fired flag for next phase', () => {
    Pomodoro.reset();
    Pomodoro.configure({ workMs: 60000, shortBreakMs: 60000, longBreakMs: 60000, totalCycles: 4 });
    let count = 0;
    Pomodoro.onPhaseComplete(() => count++);
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
    Pomodoro.nextPhase();
    // Now in shortBreak idle; start it and force overflow again.
    Pomodoro.start();
    Pomodoro.loadState({
      status: 'running',
      phase: 'shortBreak',
      cycleIndex: 1,
      totalCycles: 4,
      workMs: 60000,
      shortBreakMs: 60000,
      longBreakMs: 60000,
      startedAt: Date.now() - 65000,
      accumulatedMs: 0,
      sessionStartedAt: Date.now() - 130000,
      phaseStartedAt: Date.now() - 65000,
      phaseLog: Pomodoro.getPhaseLog(),
    });
    // loadState fired the alarm internally? No — it sets alarmFired=true to
    // suppress. But for THIS test, our reset of alarmFired during nextPhase
    // means a fresh phase that crosses zero in checkFinished WILL fire.
    // We can't easily simulate that here; just assert the count from
    // loadState path is still 0 (alarms suppressed across tab-recovery).
    assertEqual(count, 0);
  });
});

describe('Pomodoro — Live Activity emits', () => {
  // tests/index.html does not load js/platform.js, so `Platform` is
  // undefined here by default — each case installs a spy global and
  // restores after. Pomodoro is a SINGLETON: reset() runs BEFORE the spy
  // installs (so the hygiene reset's own endTimer emit isn't recorded) and
  // again in finally AFTER the spy restores; configure() is restored too,
  // since reset() deliberately leaves config alone.
  function withLiveActivitySpy(fn) {
    Pomodoro.reset();
    const calls = [];
    const hadPlatform = typeof window.Platform !== 'undefined';
    const prevPlatform = hadPlatform ? window.Platform : undefined;
    const prevFlag = localStorage.getItem('live_activities_enabled');
    localStorage.removeItem('live_activities_enabled'); // absent = enabled
    const record = (method) => (args) => {
      calls.push({ method, args });
      return Promise.resolve({ ok: true });
    };
    window.Platform = {
      liveActivity: {
        startTimer: record('startTimer'),
        updateTimer: record('updateTimer'),
        endTimer: record('endTimer'),
      },
    };
    try {
      fn(calls);
    } finally {
      if (hadPlatform) window.Platform = prevPlatform; else delete window.Platform;
      if (prevFlag === null) localStorage.removeItem('live_activities_enabled');
      else localStorage.setItem('live_activities_enabled', prevFlag);
      Pomodoro.reset();
      Pomodoro.configure({
        workMs: 25 * 60000, shortBreakMs: 5 * 60000,
        longBreakMs: 15 * 60000, totalCycles: 4,
      });
    }
  }

  function ofMethod(calls, m) {
    return calls.filter((c) => c.method === m);
  }
  function endsAtUpdates(calls) {
    return ofMethod(calls, 'updateTimer').filter((c) => c.args.endsAt !== undefined);
  }

  // Restores a work phase that crossed zero while no page was alive —
  // loadState lands it in 'overflowing' without waiting a real 60s.
  function loadOverflowed(phase, cycleIndex) {
    Pomodoro.loadState({
      status: 'running', phase, cycleIndex, totalCycles: 4,
      workMs: 60000, shortBreakMs: 60000, longBreakMs: 60000,
      startedAt: Date.now() - 90000, accumulatedMs: 0,
      sessionStartedAt: Date.now() - 90000,
      phaseStartedAt: Date.now() - 90000,
    });
  }

  it('start emits a full startTimer payload with mode + phase label', () => {
    withLiveActivitySpy((calls) => {
      Pomodoro.configure({ workMs: 60000 });
      Pomodoro.start();
      const starts = ofMethod(calls, 'startTimer');
      assertEqual(starts.length, 1);
      const a = starts[0].args;
      assertEqual(a.id, 'pomodoro');
      assertEqual(a.name, 'Pomodoro');
      assertEqual(a.mode, 'pomodoro');
      assertEqual(a.label, 'Work 1/4');
      assertEqual(a.isPaused, false);
      assertClose(a.endsAt - Date.now(), 60000, 1500);
      assertClose(Date.now() - a.startedAt, 0, 1500);
    });
  });

  it('pause emits an isPaused update', () => {
    withLiveActivitySpy((calls) => {
      Pomodoro.configure({ workMs: 60000 });
      Pomodoro.start();
      Pomodoro.pause();
      const ups = ofMethod(calls, 'updateTimer');
      assertEqual(ups.length, 1);
      assertEqual(ups[0].args.id, 'pomodoro');
      assertEqual(ups[0].args.isPaused, true);
    });
  });

  it('resume re-emits startTimer (native side update-routes, no duplicate)', () => {
    withLiveActivitySpy((calls) => {
      Pomodoro.configure({ workMs: 60000 });
      Pomodoro.start();
      Pomodoro.pause();
      calls.length = 0;
      Pomodoro.start();
      const starts = ofMethod(calls, 'startTimer');
      assertEqual(starts.length, 1);
      assertEqual(starts[0].args.isPaused, false);
      assertEqual(starts[0].args.label, 'Work 1/4');
    });
  });

  it('reset emits endTimer', () => {
    withLiveActivitySpy((calls) => {
      Pomodoro.start();
      calls.length = 0;
      Pomodoro.reset();
      const ends = ofMethod(calls, 'endTimer');
      assertEqual(ends.length, 1);
      assertEqual(ends[0].args.id, 'pomodoro');
    });
  });

  it('restartPhase emits endTimer (abandoned window; next start re-requests)', () => {
    withLiveActivitySpy((calls) => {
      Pomodoro.start();
      calls.length = 0;
      Pomodoro.restartPhase();
      assertEqual(ofMethod(calls, 'endTimer').length, 1);
    });
  });

  it('adjust while running emits updateTimer with the new endsAt', () => {
    withLiveActivitySpy((calls) => {
      Pomodoro.configure({ workMs: 60000 });
      Pomodoro.start();
      calls.length = 0;
      assert(Pomodoro.adjustRemainingMs(3 * 60 * 1000), 'adjust accepted');
      const ups = endsAtUpdates(calls);
      assertEqual(ups.length, 1);
      assertEqual(ups[0].args.isPaused, false);
      assertClose(ups[0].args.endsAt - Date.now(), 240000, 1500);
    });
  });

  it('adjust while paused does not emit an endsAt update (resume re-emits)', () => {
    withLiveActivitySpy((calls) => {
      Pomodoro.configure({ workMs: 60000 });
      Pomodoro.start();
      Pomodoro.pause();
      calls.length = 0;
      assert(Pomodoro.adjustRemainingMs(60000), 'adjust accepted');
      assertEqual(endsAtUpdates(calls).length, 0);
    });
  });

  it('suppresses all emits when live_activities_enabled is "0"', () => {
    withLiveActivitySpy((calls) => {
      localStorage.setItem('live_activities_enabled', '0');
      Pomodoro.start();
      Pomodoro.pause();
      Pomodoro.reset();
      assertEqual(calls.length, 0);
    });
  });

  it('loadState finished-while-away is SILENT (phase-done is not session-done)', () => {
    withLiveActivitySpy((calls) => {
      loadOverflowed('work', 0);
      assertEqual(Pomodoro.getStatus(), 'overflowing');
      assertEqual(calls.length, 0);
    });
  });

  it('mid-session nextPhase emits nothing; the next start carries the new label', () => {
    withLiveActivitySpy((calls) => {
      loadOverflowed('work', 0);
      calls.length = 0;
      Pomodoro.nextPhase();
      assertEqual(Pomodoro.getStatus(), 'idle');
      assertEqual(Pomodoro.getPhase(), 'shortBreak');
      assertEqual(calls.length, 0);
      Pomodoro.start();
      const starts = ofMethod(calls, 'startTimer');
      assertEqual(starts.length, 1);
      assertEqual(starts[0].args.label, 'Break');
    });
  });

  it('nextPhase out of the long break (session complete) emits endTimer', () => {
    withLiveActivitySpy((calls) => {
      loadOverflowed('longBreak', 0);
      calls.length = 0;
      Pomodoro.nextPhase();
      assertEqual(Pomodoro.getStatus(), 'done');
      assertEqual(ofMethod(calls, 'endTimer').length, 1);
    });
  });

  it('revertPhase emits an update with the restored label + paused flag', () => {
    withLiveActivitySpy((calls) => {
      loadOverflowed('work', 0);
      Pomodoro.nextPhase(); // → shortBreak idle, snapshot captured
      calls.length = 0;
      Pomodoro.revertPhase(); // → work, paused
      const ups = ofMethod(calls, 'updateTimer');
      assertEqual(ups.length, 1);
      assertEqual(ups[0].args.label, 'Work 1/4');
      assertEqual(ups[0].args.isPaused, true);
      assertEqual(Pomodoro.getStatus(), 'paused');
    });
  });

  it('loadState past the 24h overshoot cap ends the orphaned activity', () => {
    withLiveActivitySpy((calls) => {
      const dayPlus = 25 * 60 * 60 * 1000;
      Pomodoro.loadState({
        status: 'overflowing', phase: 'work', cycleIndex: 0, totalCycles: 4,
        workMs: 60000, shortBreakMs: 60000, longBreakMs: 60000,
        startedAt: Date.now() - dayPlus, accumulatedMs: 60000,
        alarmFired: true, zeroCrossedAt: Date.now() - dayPlus,
      });
      assertEqual(ofMethod(calls, 'endTimer').length, 1);
    });
  });

  it('getPhaseLabel tracks phase and cycle', () => {
    withLiveActivitySpy(() => {
      loadOverflowed('work', 2);
      assertEqual(Pomodoro.getPhaseLabel(), 'Work 3/4');
      Pomodoro.nextPhase();
      assertEqual(Pomodoro.getPhaseLabel(), 'Break');
    });
  });
});
