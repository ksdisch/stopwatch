describe('Interval — creation and idle state', () => {
  it('starts in idle state', () => {
    Interval.reset();
    assertEqual(Interval.getStatus(), 'idle');
    assertEqual(Interval.getPhaseIndex(), 0);
    assertEqual(Interval.getRoundIndex(), 0);
    assertEqual(Interval.getIsResting(), false);
  });

  it('reset clears phase and round indices', () => {
    Interval.reset();
    Interval.setProgram({ rounds: 3, phases: [{ durationMs: 10000 }, { durationMs: 5000 }] });
    Interval.loadState({
      status: 'idle',
      phaseIndex: 1,
      roundIndex: 2,
      isResting: true,
      accumulatedMs: 0,
      program: Interval.getProgram(),
    });
    Interval.reset();
    assertEqual(Interval.getPhaseIndex(), 0);
    assertEqual(Interval.getRoundIndex(), 0);
    assertEqual(Interval.getIsResting(), false);
  });
});

describe('Interval — setProgram', () => {
  it('sets program name, rounds, rest, and phases', () => {
    Interval.reset();
    Interval.setProgram({
      name: 'Tabata',
      rounds: 8,
      restBetweenRoundsMs: 30000,
      phases: [
        { name: 'Work', durationMs: 20000, color: '#ff0' },
        { name: 'Rest', durationMs: 10000 },
      ],
    });
    const p = Interval.getProgram();
    assertEqual(p.name, 'Tabata');
    assertEqual(p.rounds, 8);
    assertEqual(p.restBetweenRoundsMs, 30000);
    assertEqual(p.phases.length, 2);
    assertEqual(p.phases[0].name, 'Work');
    assertEqual(p.phases[0].durationMs, 20000);
    assertEqual(p.phases[0].color, '#ff0');
  });

  it('defaults program name to "Custom"', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 10000 }] });
    assertEqual(Interval.getProgram().name, 'Custom');
  });

  it('defaults phase name to "Phase"', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 10000 }] });
    assertEqual(Interval.getProgram().phases[0].name, 'Phase');
  });

  it('clamps rounds to at least 1', () => {
    Interval.reset();
    Interval.setProgram({ rounds: 0, phases: [{ durationMs: 10000 }] });
    assertEqual(Interval.getProgram().rounds, 1);
  });

  it('clamps restBetweenRoundsMs to at least 0', () => {
    Interval.reset();
    Interval.setProgram({ restBetweenRoundsMs: -500, phases: [{ durationMs: 10000 }] });
    assertEqual(Interval.getProgram().restBetweenRoundsMs, 0);
  });

  it('clamps phase durationMs to at least 1000', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 100 }] });
    assertEqual(Interval.getProgram().phases[0].durationMs, 1000);
  });

  it('handles empty phases array', () => {
    Interval.reset();
    Interval.setProgram({ phases: [] });
    assertEqual(Interval.getProgram().phases.length, 0);
    assertEqual(Interval.getTotalPhases(), 0);
  });

  it('ignores setProgram when not idle', () => {
    Interval.reset();
    Interval.setProgram({ name: 'First', phases: [{ durationMs: 10000 }] });
    Interval.start();
    Interval.setProgram({ name: 'Second', phases: [{ durationMs: 5000 }] });
    assertEqual(Interval.getProgram().name, 'First');
  });

  it('getProgram returns a deep copy', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ name: 'A', durationMs: 10000 }] });
    const p = Interval.getProgram();
    p.phases[0].name = 'Mutated';
    p.rounds = 99;
    assertEqual(Interval.getProgram().phases[0].name, 'A');
    assertEqual(Interval.getProgram().rounds, 1);
  });
});

describe('Interval — start / pause / resume / reset', () => {
  it('starts when program has phases', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 10000 }] });
    Interval.start();
    assertEqual(Interval.getStatus(), 'running');
  });

  it('refuses to start when program has no phases', () => {
    Interval.reset();
    Interval.setProgram({ phases: [] });
    Interval.start();
    assertEqual(Interval.getStatus(), 'idle');
  });

  it('pauses when running and retains elapsed', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 10000 }] });
    Interval.start();
    const before = Interval.getElapsedMs();
    Interval.pause();
    assertEqual(Interval.getStatus(), 'paused');
    assert(Interval.getElapsedMs() >= before, 'Elapsed should not decrease on pause');
  });

  it('resumes from paused', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 10000 }] });
    Interval.start();
    Interval.pause();
    Interval.start();
    assertEqual(Interval.getStatus(), 'running');
  });

  it('ignores double start while running', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 10000 }] });
    Interval.start();
    Interval.start();
    assertEqual(Interval.getStatus(), 'running');
  });

  it('ignores pause when not running', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 10000 }] });
    Interval.pause();
    assertEqual(Interval.getStatus(), 'idle');
  });

  it('does not start from done state', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 10000 }] });
    Interval.loadState({
      status: 'done',
      phaseIndex: 0,
      roundIndex: 1,
      isResting: false,
      accumulatedMs: 0,
      program: Interval.getProgram(),
    });
    Interval.start();
    assertEqual(Interval.getStatus(), 'done');
  });

  it('does not start from phaseComplete state', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 10000 }, { durationMs: 5000 }] });
    Interval.loadState({
      status: 'phaseComplete',
      phaseIndex: 0,
      roundIndex: 0,
      isResting: false,
      accumulatedMs: 10000,
      program: Interval.getProgram(),
    });
    Interval.start();
    assertEqual(Interval.getStatus(), 'phaseComplete');
  });

  it('reset returns to idle from any state', () => {
    Interval.reset();
    Interval.setProgram({ rounds: 2, phases: [{ durationMs: 10000 }, { durationMs: 5000 }] });
    Interval.start();
    Interval.pause();
    Interval.reset();
    assertEqual(Interval.getStatus(), 'idle');
    assertEqual(Interval.getPhaseIndex(), 0);
    assertEqual(Interval.getRoundIndex(), 0);
    assertEqual(Interval.getIsResting(), false);
  });
});

describe('Interval — remaining / elapsed / progress', () => {
  it('remaining equals phase duration when idle', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 10000 }] });
    assertEqual(Interval.getRemainingMs(), 10000);
  });

  it('elapsed is 0 when idle', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 10000 }] });
    assertEqual(Interval.getElapsedMs(), 0);
  });

  it('progress is 0 when idle', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 10000 }] });
    assertEqual(Interval.getProgress(), 0);
  });

  it('remaining decreases once started', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 10000 }] });
    Interval.start();
    assert(Interval.getRemainingMs() <= 10000, 'Remaining should be <= duration');
  });

  it('progress stays within 0..1', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 10000 }] });
    Interval.start();
    const p = Interval.getProgress();
    assert(p >= 0 && p <= 1, 'Progress should be 0-1');
  });

  it('progress is 0 when current-phase duration is 0', () => {
    Interval.reset();
    Interval.setProgram({ phases: [] });
    assertEqual(Interval.getProgress(), 0);
  });

  it('remaining never goes below zero', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 5000 }] });
    Interval.loadState({
      status: 'paused',
      phaseIndex: 0,
      roundIndex: 0,
      isResting: false,
      accumulatedMs: 999999,
      program: Interval.getProgram(),
    });
    assertEqual(Interval.getRemainingMs(), 0);
  });

  it('elapsed caps at current phase duration', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 5000 }] });
    Interval.loadState({
      status: 'paused',
      phaseIndex: 0,
      roundIndex: 0,
      isResting: false,
      accumulatedMs: 999999,
      program: Interval.getProgram(),
    });
    assertEqual(Interval.getElapsedMs(), 5000);
  });
});

describe('Interval — total progress', () => {
  it('is 0 at start of program', () => {
    Interval.reset();
    Interval.setProgram({ rounds: 2, phases: [{ durationMs: 10000 }, { durationMs: 5000 }] });
    assertEqual(Interval.getTotalProgress(), 0);
  });

  it('is 0 when program has no phases', () => {
    Interval.reset();
    Interval.setProgram({ phases: [] });
    assertEqual(Interval.getTotalProgress(), 0);
  });

  it('reflects completed phases across rounds', () => {
    Interval.reset();
    Interval.setProgram({ rounds: 2, phases: [{ durationMs: 10000 }, { durationMs: 5000 }] });
    // After 1 phase out of 4 total (2 phases * 2 rounds)
    Interval.loadState({
      status: 'idle',
      phaseIndex: 1,
      roundIndex: 0,
      isResting: false,
      accumulatedMs: 0,
      program: Interval.getProgram(),
    });
    assertClose(Interval.getTotalProgress(), 0.25, 0.001);
  });

  it('reflects full round completion', () => {
    Interval.reset();
    Interval.setProgram({ rounds: 2, phases: [{ durationMs: 10000 }, { durationMs: 5000 }] });
    // Round 1 complete (2 phases done out of 4)
    Interval.loadState({
      status: 'idle',
      phaseIndex: 0,
      roundIndex: 1,
      isResting: false,
      accumulatedMs: 0,
      program: Interval.getProgram(),
    });
    assertClose(Interval.getTotalProgress(), 0.5, 0.001);
  });
});

describe('Interval — getCurrentPhase / getNextPhase', () => {
  it('getCurrentPhase returns the active phase', () => {
    Interval.reset();
    Interval.setProgram({
      phases: [{ name: 'Work', durationMs: 20000 }, { name: 'Rest', durationMs: 10000 }],
    });
    const cur = Interval.getCurrentPhase();
    assertEqual(cur.name, 'Work');
    assertEqual(cur.durationMs, 20000);
  });

  it('getCurrentPhase returns Rest when isResting', () => {
    Interval.reset();
    Interval.setProgram({
      rounds: 2,
      restBetweenRoundsMs: 30000,
      phases: [{ name: 'Work', durationMs: 20000 }],
    });
    Interval.loadState({
      status: 'idle',
      phaseIndex: 0,
      roundIndex: 1,
      isResting: true,
      accumulatedMs: 0,
      program: Interval.getProgram(),
    });
    const cur = Interval.getCurrentPhase();
    assertEqual(cur.name, 'Rest');
    assertEqual(cur.durationMs, 30000);
  });

  it('getCurrentPhase returns null when phaseIndex past end', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 10000 }] });
    Interval.loadState({
      status: 'done',
      phaseIndex: 5,
      roundIndex: 0,
      isResting: false,
      accumulatedMs: 0,
      program: Interval.getProgram(),
    });
    assertEqual(Interval.getCurrentPhase(), null);
  });

  it('getNextPhase returns the upcoming phase within a round', () => {
    Interval.reset();
    Interval.setProgram({
      phases: [{ name: 'A', durationMs: 10000 }, { name: 'B', durationMs: 5000 }],
    });
    const next = Interval.getNextPhase();
    assertEqual(next.name, 'B');
  });

  it('getNextPhase returns Rest at end of round when rest > 0', () => {
    Interval.reset();
    Interval.setProgram({
      rounds: 2,
      restBetweenRoundsMs: 30000,
      phases: [{ name: 'Work', durationMs: 20000 }],
    });
    const next = Interval.getNextPhase();
    assertEqual(next.name, 'Rest');
    assertEqual(next.durationMs, 30000);
  });

  it('getNextPhase returns first phase at end of round when rest is 0', () => {
    Interval.reset();
    Interval.setProgram({
      rounds: 2,
      restBetweenRoundsMs: 0,
      phases: [{ name: 'A', durationMs: 10000 }, { name: 'B', durationMs: 5000 }],
    });
    Interval.loadState({
      status: 'idle',
      phaseIndex: 1, // at last phase of round
      roundIndex: 0,
      isResting: false,
      accumulatedMs: 0,
      program: Interval.getProgram(),
    });
    const next = Interval.getNextPhase();
    assertEqual(next.name, 'A');
  });

  it('getNextPhase returns null at end of final round', () => {
    Interval.reset();
    Interval.setProgram({
      rounds: 1,
      phases: [{ name: 'A', durationMs: 10000 }, { name: 'B', durationMs: 5000 }],
    });
    Interval.loadState({
      status: 'idle',
      phaseIndex: 1,
      roundIndex: 0,
      isResting: false,
      accumulatedMs: 0,
      program: Interval.getProgram(),
    });
    assertEqual(Interval.getNextPhase(), null);
  });

  it('getNextPhase after rest returns first phase of next round', () => {
    Interval.reset();
    Interval.setProgram({
      rounds: 2,
      restBetweenRoundsMs: 30000,
      phases: [{ name: 'A', durationMs: 10000 }, { name: 'B', durationMs: 5000 }],
    });
    Interval.loadState({
      status: 'idle',
      phaseIndex: 0,
      roundIndex: 1,
      isResting: true,
      accumulatedMs: 0,
      program: Interval.getProgram(),
    });
    const next = Interval.getNextPhase();
    assertEqual(next.name, 'A');
  });
});

describe('Interval — checkFinished and phase transitions', () => {
  // Helper to put engine at end of current phase so checkFinished triggers
  function primeAtPhaseEnd(phaseDurationMs) {
    Interval.loadState({
      status: 'paused',
      phaseIndex: Interval.getPhaseIndex(),
      roundIndex: Interval.getRoundIndex(),
      isResting: Interval.getIsResting(),
      accumulatedMs: phaseDurationMs + 1,
      program: Interval.getProgram(),
    });
    Interval.start();
  }

  it('returns false when still running with time remaining', () => {
    Interval.reset();
    Interval.onPhaseComplete(null);
    Interval.setProgram({ phases: [{ durationMs: 10000 }] });
    Interval.start();
    assertEqual(Interval.checkFinished(), false);
    assertEqual(Interval.getStatus(), 'running');
  });

  it('returns false when not running', () => {
    Interval.reset();
    Interval.onPhaseComplete(null);
    Interval.setProgram({ phases: [{ durationMs: 10000 }] });
    assertEqual(Interval.checkFinished(), false);
  });

  it('advances to next phase within a round', () => {
    Interval.reset();
    Interval.onPhaseComplete(null);
    Interval.setProgram({
      rounds: 1,
      phases: [{ name: 'A', durationMs: 5000 }, { name: 'B', durationMs: 3000 }],
    });
    primeAtPhaseEnd(5000);
    assertEqual(Interval.checkFinished(), true);
    assertEqual(Interval.getStatus(), 'phaseComplete');
    assertEqual(Interval.getPhaseIndex(), 1);
    assertEqual(Interval.getRoundIndex(), 0);
  });

  it('transitions to done after last phase of last round', () => {
    Interval.reset();
    Interval.onPhaseComplete(null);
    Interval.setProgram({ rounds: 1, phases: [{ name: 'A', durationMs: 5000 }] });
    primeAtPhaseEnd(5000);
    assertEqual(Interval.checkFinished(), true);
    assertEqual(Interval.getStatus(), 'done');
  });

  it('starts rest between rounds when rest > 0', () => {
    Interval.reset();
    Interval.onPhaseComplete(null);
    Interval.setProgram({
      rounds: 2,
      restBetweenRoundsMs: 15000,
      phases: [{ name: 'A', durationMs: 5000 }],
    });
    primeAtPhaseEnd(5000);
    assertEqual(Interval.checkFinished(), true);
    assertEqual(Interval.getStatus(), 'phaseComplete');
    assertEqual(Interval.getIsResting(), true);
    assertEqual(Interval.getRoundIndex(), 1);
  });

  it('skips rest and goes to next round when rest is 0', () => {
    Interval.reset();
    Interval.onPhaseComplete(null);
    Interval.setProgram({
      rounds: 2,
      restBetweenRoundsMs: 0,
      phases: [{ name: 'A', durationMs: 5000 }],
    });
    primeAtPhaseEnd(5000);
    assertEqual(Interval.checkFinished(), true);
    assertEqual(Interval.getStatus(), 'phaseComplete');
    assertEqual(Interval.getIsResting(), false);
    assertEqual(Interval.getRoundIndex(), 1);
    assertEqual(Interval.getPhaseIndex(), 0);
  });

  it('rest completion advances to next round phase 0', () => {
    Interval.reset();
    Interval.onPhaseComplete(null);
    Interval.setProgram({
      rounds: 2,
      restBetweenRoundsMs: 15000,
      phases: [{ name: 'A', durationMs: 5000 }, { name: 'B', durationMs: 3000 }],
    });
    Interval.loadState({
      status: 'paused',
      phaseIndex: 0,
      roundIndex: 1,
      isResting: true,
      accumulatedMs: 15001,
      program: Interval.getProgram(),
    });
    Interval.start();
    assertEqual(Interval.checkFinished(), true);
    assertEqual(Interval.getIsResting(), false);
    assertEqual(Interval.getPhaseIndex(), 0);
    assertEqual(Interval.getRoundIndex(), 1);
    assertEqual(Interval.getStatus(), 'phaseComplete');
  });

  it('fires phaseCallback with "phase" on intra-round advance', () => {
    Interval.reset();
    const events = [];
    Interval.onPhaseComplete((kind) => events.push(kind));
    Interval.setProgram({
      rounds: 1,
      phases: [{ durationMs: 5000 }, { durationMs: 3000 }],
    });
    primeAtPhaseEnd(5000);
    Interval.checkFinished();
    Interval.onPhaseComplete(null);
    assertEqual(events.length, 1);
    assertEqual(events[0], 'phase');
  });

  it('fires phaseCallback with "roundEnd" when crossing rounds', () => {
    Interval.reset();
    const events = [];
    Interval.onPhaseComplete((kind) => events.push(kind));
    Interval.setProgram({
      rounds: 2,
      restBetweenRoundsMs: 0,
      phases: [{ durationMs: 5000 }],
    });
    primeAtPhaseEnd(5000);
    Interval.checkFinished();
    Interval.onPhaseComplete(null);
    assertEqual(events[0], 'roundEnd');
  });

  it('fires phaseCallback with "done" on program completion', () => {
    Interval.reset();
    const events = [];
    Interval.onPhaseComplete((kind) => events.push(kind));
    Interval.setProgram({
      rounds: 1,
      phases: [{ durationMs: 5000 }],
    });
    primeAtPhaseEnd(5000);
    Interval.checkFinished();
    Interval.onPhaseComplete(null);
    assertEqual(events[0], 'done');
  });

  it('fires phaseCallback with "rest" after rest between rounds', () => {
    Interval.reset();
    const events = [];
    Interval.onPhaseComplete((kind) => events.push(kind));
    Interval.setProgram({
      rounds: 2,
      restBetweenRoundsMs: 15000,
      phases: [{ durationMs: 5000 }],
    });
    Interval.loadState({
      status: 'paused',
      phaseIndex: 0,
      roundIndex: 1,
      isResting: true,
      accumulatedMs: 15001,
      program: Interval.getProgram(),
    });
    Interval.start();
    Interval.checkFinished();
    Interval.onPhaseComplete(null);
    assertEqual(events[0], 'rest');
  });
});

describe('Interval — advancePhase', () => {
  it('transitions from phaseComplete to idle', () => {
    Interval.reset();
    Interval.onPhaseComplete(null);
    Interval.setProgram({
      rounds: 1,
      phases: [{ durationMs: 5000 }, { durationMs: 3000 }],
    });
    Interval.loadState({
      status: 'phaseComplete',
      phaseIndex: 1,
      roundIndex: 0,
      isResting: false,
      accumulatedMs: 0,
      program: Interval.getProgram(),
    });
    Interval.advancePhase();
    assertEqual(Interval.getStatus(), 'idle');
    assertEqual(Interval.getPhaseIndex(), 1);
  });

  it('is a no-op when not in phaseComplete', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 10000 }] });
    Interval.start();
    Interval.advancePhase();
    assertEqual(Interval.getStatus(), 'running');
  });
});

describe('Interval — state serialization', () => {
  it('getState returns complete snapshot', () => {
    Interval.reset();
    Interval.setProgram({
      name: 'HIIT',
      rounds: 3,
      restBetweenRoundsMs: 20000,
      phases: [{ name: 'Work', durationMs: 30000 }],
    });
    Interval.start();
    const s = Interval.getState();
    assertEqual(s.status, 'running');
    assertEqual(s.program.name, 'HIIT');
    assertEqual(s.program.rounds, 3);
    assertEqual(s.phaseIndex, 0);
    assertEqual(s.roundIndex, 0);
    assertEqual(s.isResting, false);
    assert(s.startedAt !== null, 'startedAt should be set while running');
  });

  it('getState returns deep copy of program', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ name: 'A', durationMs: 10000 }] });
    const s = Interval.getState();
    s.program.phases[0].name = 'Mutated';
    assertEqual(Interval.getProgram().phases[0].name, 'A');
  });

  it('loadState restores status, indices, and program', () => {
    Interval.reset();
    Interval.loadState({
      status: 'paused',
      phaseIndex: 1,
      roundIndex: 2,
      isResting: false,
      accumulatedMs: 1234,
      program: {
        name: 'Loaded',
        rounds: 3,
        restBetweenRoundsMs: 5000,
        phases: [{ name: 'A', durationMs: 10000 }, { name: 'B', durationMs: 5000 }],
      },
    });
    assertEqual(Interval.getStatus(), 'paused');
    assertEqual(Interval.getPhaseIndex(), 1);
    assertEqual(Interval.getRoundIndex(), 2);
    assertEqual(Interval.getProgram().name, 'Loaded');
    assertEqual(Interval.getProgram().phases.length, 2);
  });

  it('loadState handles clock skew (future startedAt)', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 10000 }] });
    Interval.loadState({
      status: 'running',
      phaseIndex: 0,
      roundIndex: 0,
      isResting: false,
      startedAt: Date.now() + 999999,
      accumulatedMs: 0,
      program: Interval.getProgram(),
    });
    assertEqual(Interval.getStatus(), 'paused');
  });

  it('loadState auto-completes expired phase', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 5000 }, { durationMs: 3000 }] });
    Interval.loadState({
      status: 'running',
      phaseIndex: 0,
      roundIndex: 0,
      isResting: false,
      startedAt: Date.now() - 60000,
      accumulatedMs: 0,
      program: Interval.getProgram(),
    });
    assertEqual(Interval.getStatus(), 'phaseComplete');
    assertEqual(Interval.getElapsedMs(), 5000);
  });

  it('loadState is a no-op when state is null', () => {
    Interval.reset();
    Interval.setProgram({ phases: [{ durationMs: 10000 }] });
    Interval.loadState(null);
    assertEqual(Interval.getStatus(), 'idle');
    assertEqual(Interval.getProgram().phases.length, 1);
  });

  it('loadState preserves 0 values via nullish coalescing', () => {
    Interval.reset();
    Interval.loadState({
      status: 'idle',
      phaseIndex: 0,
      roundIndex: 0,
      isResting: false,
      accumulatedMs: 0,
      startedAt: null,
    });
    assertEqual(Interval.getPhaseIndex(), 0);
    assertEqual(Interval.getRoundIndex(), 0);
    assertEqual(Interval.getIsResting(), false);
  });
});

describe('Interval — full program walk-through', () => {
  it('completes a 2-round, 2-phase program with rest', () => {
    Interval.reset();
    Interval.onPhaseComplete(null);
    Interval.setProgram({
      rounds: 2,
      restBetweenRoundsMs: 10000,
      phases: [{ name: 'A', durationMs: 5000 }, { name: 'B', durationMs: 3000 }],
    });

    // Round 0, phase A → phase B
    Interval.loadState({
      status: 'paused', phaseIndex: 0, roundIndex: 0, isResting: false,
      accumulatedMs: 5001, program: Interval.getProgram(),
    });
    Interval.start();
    Interval.checkFinished();
    assertEqual(Interval.getPhaseIndex(), 1);
    assertEqual(Interval.getStatus(), 'phaseComplete');

    // Round 0, phase B → rest
    Interval.advancePhase();
    Interval.loadState({
      status: 'paused', phaseIndex: 1, roundIndex: 0, isResting: false,
      accumulatedMs: 3001, program: Interval.getProgram(),
    });
    Interval.start();
    Interval.checkFinished();
    assertEqual(Interval.getIsResting(), true);
    assertEqual(Interval.getRoundIndex(), 1);

    // Rest → round 1, phase A
    Interval.advancePhase();
    Interval.loadState({
      status: 'paused', phaseIndex: 0, roundIndex: 1, isResting: true,
      accumulatedMs: 10001, program: Interval.getProgram(),
    });
    Interval.start();
    Interval.checkFinished();
    assertEqual(Interval.getIsResting(), false);
    assertEqual(Interval.getPhaseIndex(), 0);
    assertEqual(Interval.getRoundIndex(), 1);

    // Round 1, phase A → phase B
    Interval.advancePhase();
    Interval.loadState({
      status: 'paused', phaseIndex: 0, roundIndex: 1, isResting: false,
      accumulatedMs: 5001, program: Interval.getProgram(),
    });
    Interval.start();
    Interval.checkFinished();
    assertEqual(Interval.getPhaseIndex(), 1);

    // Round 1, phase B → done
    Interval.advancePhase();
    Interval.loadState({
      status: 'paused', phaseIndex: 1, roundIndex: 1, isResting: false,
      accumulatedMs: 3001, program: Interval.getProgram(),
    });
    Interval.start();
    Interval.checkFinished();
    assertEqual(Interval.getStatus(), 'done');
  });
});
