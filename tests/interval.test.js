describe('Interval — creation and idle state', () => {
  it('reset returns to idle state', () => {
    Interval.reset();
    assertEqual(Interval.getStatus(), 'idle');
    assertEqual(Interval.getPhaseIndex(), 0);
    assertEqual(Interval.getRoundIndex(), 0);
    assertEqual(Interval.getIsResting(), false);
  });
});

describe('Interval — setProgram', () => {
  it('sets program name, rounds, and phases', () => {
    Interval.reset();
    Interval.setProgram({
      name: 'Tabata',
      rounds: 8,
      restBetweenRoundsMs: 0,
      phases: [
        { name: 'Work', durationMs: 20000 },
        { name: 'Rest', durationMs: 10000 },
      ],
    });
    const p = Interval.getProgram();
    assertEqual(p.name, 'Tabata');
    assertEqual(p.rounds, 8);
    assertEqual(p.phases.length, 2);
    assertEqual(p.phases[0].name, 'Work');
    assertEqual(p.phases[0].durationMs, 20000);
  });

  it('defaults name to Custom when omitted', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 5000 }] });
    assertEqual(Interval.getProgram().name, 'Custom');
  });

  it('clamps rounds to minimum 1', () => {
    Interval.reset();
    Interval.setProgram({ rounds: 0, phases: [{ durationMs: 5000 }] });
    assertEqual(Interval.getTotalRounds(), 1);
  });

  it('clamps phase durationMs to minimum 1000ms', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ name: 'Short', durationMs: 100 }] });
    const p = Interval.getProgram();
    assertEqual(p.phases[0].durationMs, 1000);
  });

  it('clamps restBetweenRoundsMs to minimum 0', () => {
    Interval.reset();
    Interval.setProgram({ rounds: 2, restBetweenRoundsMs: -500, phases: [{ durationMs: 5000 }] });
    assertEqual(Interval.getProgram().restBetweenRoundsMs, 0);
  });

  it('defaults empty phase name to "Phase"', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 5000 }] });
    assertEqual(Interval.getProgram().phases[0].name, 'Phase');
  });

  it('ignores setProgram when not idle', () => {
    Interval.reset();
    Interval.setProgram({ name: 'First', phases: [{ durationMs: 5000 }] });
    Interval.start();
    Interval.setProgram({ name: 'Second', phases: [{ durationMs: 9999 }] });
    assertEqual(Interval.getProgram().name, 'First');
  });

  it('getTotalPhases reflects the program phase count', () => {
    Interval.reset();
    Interval.setProgram({
      phases: [
        { name: 'A', durationMs: 5000 },
        { name: 'B', durationMs: 5000 },
        { name: 'C', durationMs: 5000 },
      ],
    });
    assertEqual(Interval.getTotalPhases(), 3);
  });
});

describe('Interval — start/pause/reset', () => {
  it('starts a program with phases', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ name: 'W', durationMs: 5000 }] });
    Interval.start();
    assertEqual(Interval.getStatus(), 'running');
  });

  it('does not start an empty program', () => {
    Interval.reset();
    Interval.setProgram({ phases: [] });
    Interval.start();
    assertEqual(Interval.getStatus(), 'idle');
  });

  it('double start is a no-op', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 5000 }] });
    Interval.start();
    Interval.start();
    assertEqual(Interval.getStatus(), 'running');
  });

  it('pauses a running program', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 5000 }] });
    Interval.start();
    Interval.pause();
    assertEqual(Interval.getStatus(), 'paused');
  });

  it('pause while not running is a no-op', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 5000 }] });
    Interval.pause();
    assertEqual(Interval.getStatus(), 'idle');
  });

  it('resumes from paused', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 5000 }] });
    Interval.start();
    Interval.pause();
    Interval.start();
    assertEqual(Interval.getStatus(), 'running');
  });

  it('does not start from phaseComplete', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 5000 }] });
    Interval.loadState({ status: 'phaseComplete', program: Interval.getProgram() });
    Interval.start();
    assertEqual(Interval.getStatus(), 'phaseComplete');
  });

  it('does not start from done', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 5000 }] });
    Interval.loadState({ status: 'done', program: Interval.getProgram() });
    Interval.start();
    assertEqual(Interval.getStatus(), 'done');
  });

  it('reset clears phase and round indices', () => {
    Interval.reset();
    Interval.setProgram({
      rounds: 3,
      phases: [{ durationMs: 5000 }, { durationMs: 5000 }],
    });
    Interval.loadState({
      status: 'paused',
      phaseIndex: 1,
      roundIndex: 2,
      isResting: true,
      accumulatedMs: 2000,
      program: Interval.getProgram(),
    });
    Interval.reset();
    assertEqual(Interval.getStatus(), 'idle');
    assertEqual(Interval.getPhaseIndex(), 0);
    assertEqual(Interval.getRoundIndex(), 0);
    assertEqual(Interval.getIsResting(), false);
  });
});

describe('Interval — remaining and progress', () => {
  it('remainingMs equals phase duration when idle', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 20000 }] });
    assertEqual(Interval.getRemainingMs(), 20000);
  });

  it('remainingMs decreases when running', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 20000 }] });
    Interval.start();
    assert(Interval.getRemainingMs() <= 20000, 'Remaining should not exceed duration');
  });

  it('progress is between 0 and 1', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 20000 }] });
    Interval.start();
    const p = Interval.getProgress();
    assert(p >= 0 && p <= 1, 'Progress should be 0-1');
  });

  it('elapsedMs is capped at phase duration', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 5000 }] });
    Interval.loadState({
      status: 'paused',
      accumulatedMs: 999999,
      program: Interval.getProgram(),
    });
    assertEqual(Interval.getElapsedMs(), 5000);
  });

  it('totalProgress reflects completed phases', () => {
    Interval.reset();
    Interval.setProgram({
      rounds: 2,
      phases: [
        { name: 'A', durationMs: 5000 },
        { name: 'B', durationMs: 5000 },
      ],
    });
    Interval.loadState({
      status: 'idle',
      phaseIndex: 1,
      roundIndex: 0,
      program: Interval.getProgram(),
    });
    assertClose(Interval.getTotalProgress(), 0.25, 0.001);
  });

  it('totalProgress is 0 when program has no phases', () => {
    Interval.reset();
    Interval.setProgram({ phases: [] });
    assertEqual(Interval.getTotalProgress(), 0);
  });
});

describe('Interval — getCurrentPhase / getNextPhase', () => {
  it('returns current phase object', () => {
    Interval.reset();
    Interval.setProgram({
      phases: [{ name: 'Work', durationMs: 20000 }, { name: 'Rest', durationMs: 10000 }],
    });
    assertEqual(Interval.getCurrentPhase().name, 'Work');
  });

  it('returns next phase within same round', () => {
    Interval.reset();
    Interval.setProgram({
      phases: [{ name: 'Work', durationMs: 20000 }, { name: 'Rest', durationMs: 10000 }],
    });
    assertEqual(Interval.getNextPhase().name, 'Rest');
  });

  it('returns null next when program will complete after this phase', () => {
    Interval.reset();
    Interval.setProgram({
      rounds: 1,
      phases: [{ name: 'Only', durationMs: 20000 }],
    });
    assertEqual(Interval.getNextPhase(), null);
  });

  it('returns Rest as next phase at end of round when restBetweenRoundsMs > 0', () => {
    Interval.reset();
    Interval.setProgram({
      rounds: 2,
      restBetweenRoundsMs: 15000,
      phases: [{ name: 'Work', durationMs: 20000 }],
    });
    const next = Interval.getNextPhase();
    assertEqual(next.name, 'Rest');
    assertEqual(next.durationMs, 15000);
  });

  it('returns first phase as next at end of round when no rest configured', () => {
    Interval.reset();
    Interval.setProgram({
      rounds: 2,
      restBetweenRoundsMs: 0,
      phases: [{ name: 'Work', durationMs: 20000 }],
    });
    assertEqual(Interval.getNextPhase().name, 'Work');
  });

  it('returns rest phase as current during rest between rounds', () => {
    Interval.reset();
    Interval.setProgram({
      rounds: 2,
      restBetweenRoundsMs: 15000,
      phases: [{ name: 'Work', durationMs: 20000 }],
    });
    Interval.loadState({
      status: 'paused',
      isResting: true,
      roundIndex: 1,
      program: Interval.getProgram(),
    });
    const cur = Interval.getCurrentPhase();
    assertEqual(cur.name, 'Rest');
    assertEqual(cur.durationMs, 15000);
  });

  it('returns first phase of next round after rest completes', () => {
    Interval.reset();
    Interval.setProgram({
      rounds: 2,
      restBetweenRoundsMs: 15000,
      phases: [{ name: 'Work', durationMs: 20000 }],
    });
    Interval.loadState({
      status: 'paused',
      isResting: true,
      roundIndex: 1,
      program: Interval.getProgram(),
    });
    assertEqual(Interval.getNextPhase().name, 'Work');
  });
});

describe('Interval — checkFinished phase transitions', () => {
  function triggerExpiration(program) {
    Interval.reset();
    Interval.setProgram(program);
    Interval.loadState({
      status: 'paused',
      accumulatedMs: 999999,
      program: Interval.getProgram(),
    });
    Interval.start();
    return Interval.checkFinished();
  }

  it('returns true when phase finishes', () => {
    const completed = triggerExpiration({
      phases: [{ name: 'A', durationMs: 5000 }, { name: 'B', durationMs: 5000 }],
    });
    assertEqual(completed, true);
  });

  it('advances phaseIndex on completion', () => {
    triggerExpiration({
      phases: [{ name: 'A', durationMs: 5000 }, { name: 'B', durationMs: 5000 }],
    });
    assertEqual(Interval.getPhaseIndex(), 1);
    assertEqual(Interval.getStatus(), 'phaseComplete');
  });

  it('advances roundIndex at end of round with no rest', () => {
    triggerExpiration({
      rounds: 2,
      restBetweenRoundsMs: 0,
      phases: [{ name: 'Only', durationMs: 5000 }],
    });
    assertEqual(Interval.getRoundIndex(), 1);
    assertEqual(Interval.getPhaseIndex(), 0);
    assertEqual(Interval.getIsResting(), false);
  });

  it('enters rest period at end of round when restBetweenRoundsMs > 0', () => {
    triggerExpiration({
      rounds: 2,
      restBetweenRoundsMs: 10000,
      phases: [{ name: 'Only', durationMs: 5000 }],
    });
    assertEqual(Interval.getRoundIndex(), 1);
    assertEqual(Interval.getIsResting(), true);
    assertEqual(Interval.getStatus(), 'phaseComplete');
  });

  it('leaves rest period and starts next round', () => {
    Interval.reset();
    Interval.setProgram({
      rounds: 2,
      restBetweenRoundsMs: 10000,
      phases: [{ name: 'Only', durationMs: 5000 }],
    });
    Interval.loadState({
      status: 'paused',
      isResting: true,
      roundIndex: 1,
      accumulatedMs: 999999,
      program: Interval.getProgram(),
    });
    Interval.start();
    const completed = Interval.checkFinished();
    assertEqual(completed, true);
    assertEqual(Interval.getIsResting(), false);
    assertEqual(Interval.getPhaseIndex(), 0);
    assertEqual(Interval.getStatus(), 'phaseComplete');
  });

  it('transitions to done after last phase of last round', () => {
    triggerExpiration({
      rounds: 1,
      phases: [{ name: 'Only', durationMs: 5000 }],
    });
    assertEqual(Interval.getStatus(), 'done');
  });

  it('returns false when phase still has time left', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 60000 }] });
    Interval.start();
    assertEqual(Interval.checkFinished(), false);
    assertEqual(Interval.getStatus(), 'running');
  });

  it('returns false when not running', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 60000 }] });
    assertEqual(Interval.checkFinished(), false);
  });
});

describe('Interval — advancePhase', () => {
  it('clears phaseComplete back to idle', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 5000 }] });
    Interval.loadState({
      status: 'phaseComplete',
      program: Interval.getProgram(),
    });
    Interval.advancePhase();
    assertEqual(Interval.getStatus(), 'idle');
  });

  it('is a no-op when not phaseComplete', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 5000 }] });
    Interval.start();
    Interval.advancePhase();
    assertEqual(Interval.getStatus(), 'running');
  });
});

describe('Interval — onPhaseComplete callback', () => {
  it('fires with "phase" when a phase completes mid-round', () => {
    let fired = null;
    Interval.reset();
    Interval.onPhaseComplete((e) => { fired = e; });
    Interval.setProgram({
      phases: [{ name: 'A', durationMs: 5000 }, { name: 'B', durationMs: 5000 }],
    });
    Interval.loadState({
      status: 'paused',
      accumulatedMs: 999999,
      program: Interval.getProgram(),
    });
    Interval.start();
    Interval.checkFinished();
    assertEqual(fired, 'phase');
  });

  it('fires with "roundEnd" at the end of a round', () => {
    let fired = null;
    Interval.reset();
    Interval.onPhaseComplete((e) => { fired = e; });
    Interval.setProgram({
      rounds: 2,
      phases: [{ name: 'Only', durationMs: 5000 }],
    });
    Interval.loadState({
      status: 'paused',
      accumulatedMs: 999999,
      program: Interval.getProgram(),
    });
    Interval.start();
    Interval.checkFinished();
    assertEqual(fired, 'roundEnd');
  });

  it('fires with "done" when the program finishes', () => {
    let fired = null;
    Interval.reset();
    Interval.onPhaseComplete((e) => { fired = e; });
    Interval.setProgram({
      rounds: 1,
      phases: [{ name: 'Only', durationMs: 5000 }],
    });
    Interval.loadState({
      status: 'paused',
      accumulatedMs: 999999,
      program: Interval.getProgram(),
    });
    Interval.start();
    Interval.checkFinished();
    assertEqual(fired, 'done');
  });

  it('fires with "rest" when a rest period ends', () => {
    let fired = null;
    Interval.reset();
    Interval.onPhaseComplete((e) => { fired = e; });
    Interval.setProgram({
      rounds: 2,
      restBetweenRoundsMs: 10000,
      phases: [{ name: 'Only', durationMs: 5000 }],
    });
    Interval.loadState({
      status: 'paused',
      isResting: true,
      roundIndex: 1,
      accumulatedMs: 999999,
      program: Interval.getProgram(),
    });
    Interval.start();
    Interval.checkFinished();
    assertEqual(fired, 'rest');
  });
});

describe('Interval — state serialization', () => {
  it('getState returns complete state', () => {
    Interval.reset();
    Interval.setProgram({
      name: 'Snapshot',
      rounds: 3,
      phases: [{ name: 'W', durationMs: 20000 }, { name: 'R', durationMs: 10000 }],
    });
    Interval.start();
    const state = Interval.getState();
    assertEqual(state.status, 'running');
    assertEqual(state.phaseIndex, 0);
    assertEqual(state.roundIndex, 0);
    assertEqual(state.isResting, false);
    assertEqual(state.program.name, 'Snapshot');
    assertEqual(state.program.phases.length, 2);
  });

  it('loadState restores program and rounds', () => {
    Interval.reset();
    Interval.loadState({
      status: 'idle',
      phaseIndex: 0,
      roundIndex: 0,
      isResting: false,
      accumulatedMs: 0,
      program: {
        name: 'Restored',
        rounds: 5,
        restBetweenRoundsMs: 0,
        phases: [{ name: 'P', durationMs: 30000 }],
      },
    });
    assertEqual(Interval.getProgram().name, 'Restored');
    assertEqual(Interval.getTotalRounds(), 5);
  });

  it('loadState handles future startedAt (clock skew)', () => {
    Interval.reset();
    Interval.loadState({
      status: 'running',
      startedAt: Date.now() + 999999,
      accumulatedMs: 0,
      program: { rounds: 1, phases: [{ name: 'P', durationMs: 30000 }] },
    });
    assertEqual(Interval.getStatus(), 'paused');
  });

  it('loadState auto-completes an expired running phase', () => {
    Interval.reset();
    Interval.loadState({
      status: 'running',
      startedAt: Date.now() - 999999,
      accumulatedMs: 0,
      program: { rounds: 1, phases: [{ name: 'P', durationMs: 5000 }] },
    });
    assertEqual(Interval.getStatus(), 'phaseComplete');
  });

  it('loadState preserves 0 values with nullish coalescing', () => {
    Interval.reset();
    Interval.loadState({
      status: 'idle',
      phaseIndex: 0,
      roundIndex: 0,
      accumulatedMs: 0,
    });
    assertEqual(Interval.getPhaseIndex(), 0);
    assertEqual(Interval.getRoundIndex(), 0);
    assertEqual(Interval.getStatus(), 'idle');
  });

  it('getProgram returns a deep copy', () => {
    Interval.reset();
    Interval.setProgram({
      name: 'Immutable',
      phases: [{ name: 'P', durationMs: 5000 }],
    });
    const copy = Interval.getProgram();
    copy.name = 'Mutated';
    copy.phases[0].durationMs = 99999;
    assertEqual(Interval.getProgram().name, 'Immutable');
    assertEqual(Interval.getProgram().phases[0].durationMs, 5000);
  });
});

describe("Interval — adjustRemainingMs", () => {
  it("extends current phase while running", () => {
    Interval.reset();
    Interval.setProgram({
      name: "T",
      rounds: 2,
      phases: [{ name: "Work", durationMs: 60000 }, { name: "Rest", durationMs: 30000 }],
    });
    Interval.start();
    const before = Interval.getRemainingMs();
    assertEqual(Interval.adjustRemainingMs(180000), true);
    const after = Interval.getRemainingMs();
    assert(after - before >= 179000 && after - before <= 181000,
      `Expected ~+180000ms, got ${after - before}`);
  });

  it("does not change next phase duration", () => {
    Interval.reset();
    Interval.setProgram({
      name: "T",
      rounds: 1,
      phases: [{ name: "P1", durationMs: 60000 }, { name: "P2", durationMs: 30000 }],
    });
    Interval.start();
    Interval.adjustRemainingMs(180000);
    // Verify P2 program duration is untouched
    assertEqual(Interval.getProgram().phases[1].durationMs, 30000);
  });

  it("rejects when idle", () => {
    Interval.reset();
    Interval.setProgram({ name: "T", rounds: 1, phases: [{ name: "P", durationMs: 60000 }] });
    assertEqual(Interval.adjustRemainingMs(180000), false);
  });

  it("rejects underflow when -delta would go below 1s", () => {
    Interval.reset();
    Interval.setProgram({ name: "T", rounds: 1, phases: [{ name: "P", durationMs: 120000 }] });
    Interval.start();
    assertEqual(Interval.adjustRemainingMs(-180000), false);
  });
});

