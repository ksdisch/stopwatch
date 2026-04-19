describe('Sequence — creation and idle state', () => {
  it('starts in idle state', () => {
    Sequence.reset();
    Sequence.setProgram({ name: '', phases: [] });
    assertEqual(Sequence.getStatus(), 'idle');
    assertEqual(Sequence.getPhaseIndex(), 0);
    assertEqual(Sequence.getPhaseCount(), 0);
    assertEqual(Sequence.getElapsedMs(), 0);
    assertEqual(Sequence.getRemainingMs(), 0);
    assertEqual(Sequence.getProgress(), 0);
    assertEqual(Sequence.getTotalProgress(), 0);
  });

  it('reset clears phase index and accumulated time', () => {
    Sequence.reset();
    Sequence.setProgram({
      name: 'Demo',
      phases: [{ name: 'A', durationMs: 5000 }, { name: 'B', durationMs: 5000 }],
    });
    Sequence.loadState({
      status: 'paused',
      program: Sequence.getProgram(),
      phaseIndex: 1,
      startedAt: null,
      accumulatedMs: 1234,
    });
    Sequence.reset();
    assertEqual(Sequence.getStatus(), 'idle');
    assertEqual(Sequence.getPhaseIndex(), 0);
    assertEqual(Sequence.getElapsedMs(), 0);
  });
});

describe('Sequence — setProgram', () => {
  it('stores program name and phases', () => {
    Sequence.reset();
    Sequence.setProgram({
      name: 'Brew',
      phases: [
        { name: 'Bloom', durationMs: 30000 },
        { name: 'Pour', durationMs: 90000 },
        { name: 'Steep', durationMs: 60000 },
      ],
    });
    const prog = Sequence.getProgram();
    assertEqual(prog.name, 'Brew');
    assertEqual(prog.phases.length, 3);
    assertEqual(prog.phases[0].name, 'Bloom');
    assertEqual(prog.phases[1].durationMs, 90000);
    assertEqual(Sequence.getPhaseCount(), 3);
  });

  it('defaults name to empty string', () => {
    Sequence.reset();
    Sequence.setProgram({ phases: [{ name: 'X', durationMs: 1000 }] });
    assertEqual(Sequence.getProgram().name, '');
  });

  it('defaults phases to empty array when omitted', () => {
    Sequence.reset();
    Sequence.setProgram({ name: 'No phases' });
    assertEqual(Sequence.getPhaseCount(), 0);
    assertEqual(Sequence.getProgram().phases.length, 0);
  });

  it('resets phaseIndex to 0', () => {
    Sequence.reset();
    Sequence.setProgram({ phases: [{ name: 'A', durationMs: 5000 }, { name: 'B', durationMs: 5000 }] });
    Sequence.loadState({
      status: 'idle',
      program: Sequence.getProgram(),
      phaseIndex: 1,
      accumulatedMs: 0,
    });
    assertEqual(Sequence.getPhaseIndex(), 1);
    Sequence.reset();
    Sequence.setProgram({ phases: [{ name: 'C', durationMs: 1000 }] });
    assertEqual(Sequence.getPhaseIndex(), 0);
  });

  it('ignores setProgram when not idle', () => {
    Sequence.reset();
    Sequence.setProgram({ name: 'First', phases: [{ name: 'A', durationMs: 60000 }] });
    Sequence.start();
    Sequence.setProgram({ name: 'Second', phases: [{ name: 'B', durationMs: 1000 }] });
    assertEqual(Sequence.getProgram().name, 'First');
  });
});

describe('Sequence — start/pause/resume', () => {
  it('starts when phases exist', () => {
    Sequence.reset();
    Sequence.setProgram({ phases: [{ name: 'A', durationMs: 60000 }] });
    Sequence.start();
    assertEqual(Sequence.getStatus(), 'running');
  });

  it('does not start with no phases', () => {
    Sequence.reset();
    Sequence.setProgram({ phases: [] });
    Sequence.start();
    assertEqual(Sequence.getStatus(), 'idle');
  });

  it('does not start when already running', () => {
    Sequence.reset();
    Sequence.setProgram({ phases: [{ name: 'A', durationMs: 60000 }] });
    Sequence.start();
    const before = Sequence.getStatus();
    Sequence.start();
    assertEqual(Sequence.getStatus(), before);
  });

  it('does not start when done', () => {
    Sequence.reset();
    Sequence.setProgram({ phases: [{ name: 'A', durationMs: 60000 }] });
    Sequence.loadState({
      status: 'done',
      program: Sequence.getProgram(),
      phaseIndex: 0,
      accumulatedMs: 0,
    });
    Sequence.start();
    assertEqual(Sequence.getStatus(), 'done');
  });

  it('does not start when phaseComplete', () => {
    Sequence.reset();
    Sequence.setProgram({ phases: [{ name: 'A', durationMs: 60000 }] });
    Sequence.loadState({
      status: 'phaseComplete',
      program: Sequence.getProgram(),
      phaseIndex: 0,
      accumulatedMs: 60000,
    });
    Sequence.start();
    assertEqual(Sequence.getStatus(), 'phaseComplete');
  });

  it('pauses while running and retains elapsed', () => {
    Sequence.reset();
    Sequence.setProgram({ phases: [{ name: 'A', durationMs: 60000 }] });
    Sequence.start();
    const before = Sequence.getElapsedMs();
    Sequence.pause();
    assertEqual(Sequence.getStatus(), 'paused');
    assert(Sequence.getElapsedMs() >= before, 'Elapsed should not decrease on pause');
  });

  it('pause is no-op when not running', () => {
    Sequence.reset();
    Sequence.setProgram({ phases: [{ name: 'A', durationMs: 60000 }] });
    Sequence.pause();
    assertEqual(Sequence.getStatus(), 'idle');
  });

  it('resumes from paused', () => {
    Sequence.reset();
    Sequence.setProgram({ phases: [{ name: 'A', durationMs: 60000 }] });
    Sequence.start();
    Sequence.pause();
    Sequence.start();
    assertEqual(Sequence.getStatus(), 'running');
  });
});

describe('Sequence — timing accessors', () => {
  it('getRemainingMs equals current phase duration when idle', () => {
    Sequence.reset();
    Sequence.setProgram({ phases: [{ name: 'A', durationMs: 45000 }] });
    assertEqual(Sequence.getRemainingMs(), 45000);
  });

  it('getCurrentPhaseDurationMs returns 0 with no program', () => {
    Sequence.reset();
    Sequence.setProgram({ phases: [] });
    assertEqual(Sequence.getCurrentPhaseDurationMs(), 0);
  });

  it('getProgress is 0 at start of phase', () => {
    Sequence.reset();
    Sequence.setProgram({ phases: [{ name: 'A', durationMs: 60000 }] });
    assertEqual(Sequence.getProgress(), 0);
  });

  it('getProgress is between 0 and 1 while running', () => {
    Sequence.reset();
    Sequence.setProgram({ phases: [{ name: 'A', durationMs: 60000 }] });
    Sequence.start();
    const p = Sequence.getProgress();
    assert(p >= 0 && p <= 1, 'Progress should be 0-1');
  });

  it('getProgress is 0 when phase has no duration', () => {
    Sequence.reset();
    Sequence.setProgram({ phases: [] });
    assertEqual(Sequence.getProgress(), 0);
  });

  it('getElapsedMs is clamped to phase duration', () => {
    Sequence.reset();
    Sequence.setProgram({ phases: [{ name: 'A', durationMs: 1000 }] });
    Sequence.loadState({
      status: 'paused',
      program: Sequence.getProgram(),
      phaseIndex: 0,
      accumulatedMs: 999999,
    });
    assertEqual(Sequence.getElapsedMs(), 1000);
  });

  it('getTotalProgress reflects phase index plus current progress', () => {
    Sequence.reset();
    Sequence.setProgram({
      phases: [
        { name: 'A', durationMs: 1000 },
        { name: 'B', durationMs: 1000 },
        { name: 'C', durationMs: 1000 },
        { name: 'D', durationMs: 1000 },
      ],
    });
    Sequence.loadState({
      status: 'idle',
      program: Sequence.getProgram(),
      phaseIndex: 2,
      accumulatedMs: 0,
    });
    // 2 of 4 phases complete with no in-phase progress = 0.5
    assertClose(Sequence.getTotalProgress(), 0.5, 0.0001);
  });

  it('getTotalProgress is 0 with no phases', () => {
    Sequence.reset();
    Sequence.setProgram({ phases: [] });
    assertEqual(Sequence.getTotalProgress(), 0);
  });
});

describe('Sequence — phase navigation', () => {
  it('getCurrentPhase returns the phase at current index', () => {
    Sequence.reset();
    Sequence.setProgram({
      phases: [{ name: 'A', durationMs: 1000 }, { name: 'B', durationMs: 2000 }],
    });
    assertEqual(Sequence.getCurrentPhase().name, 'A');
  });

  it('getCurrentPhase returns null when no phases', () => {
    Sequence.reset();
    Sequence.setProgram({ phases: [] });
    assertEqual(Sequence.getCurrentPhase(), null);
  });

  it('getNextPhase returns the next phase', () => {
    Sequence.reset();
    Sequence.setProgram({
      phases: [{ name: 'A', durationMs: 1000 }, { name: 'B', durationMs: 2000 }],
    });
    assertEqual(Sequence.getNextPhase().name, 'B');
  });

  it('getNextPhase returns null on last phase', () => {
    Sequence.reset();
    Sequence.setProgram({ phases: [{ name: 'Only', durationMs: 1000 }] });
    assertEqual(Sequence.getNextPhase(), null);
  });
});

describe('Sequence — checkFinished and advancePhase', () => {
  it('checkFinished returns false when remaining > 0', () => {
    Sequence.reset();
    Sequence.setProgram({ phases: [{ name: 'A', durationMs: 999999 }] });
    Sequence.start();
    assertEqual(Sequence.checkFinished(), false);
    assertEqual(Sequence.getStatus(), 'running');
  });

  it('checkFinished returns false when not running', () => {
    Sequence.reset();
    Sequence.setProgram({ phases: [{ name: 'A', durationMs: 1000 }] });
    assertEqual(Sequence.checkFinished(), false);
  });

  it('checkFinished transitions to phaseComplete and fires callback', () => {
    Sequence.reset();
    let firedPhase = null;
    Sequence.onPhaseComplete((ph) => { firedPhase = ph; });
    Sequence.setProgram({ phases: [{ name: 'Bloom', durationMs: 50 }] });
    Sequence.start();
    const stop = Date.now() + 120;
    while (Date.now() < stop) { /* spin until phase elapses */ }
    assertEqual(Sequence.checkFinished(), true);
    assertEqual(Sequence.getStatus(), 'phaseComplete');
    assert(firedPhase !== null, 'Phase callback should have fired');
    assertEqual(firedPhase.name, 'Bloom');
  });

  it('advancePhase moves to next phase and returns to idle', () => {
    Sequence.reset();
    Sequence.setProgram({
      phases: [{ name: 'A', durationMs: 1000 }, { name: 'B', durationMs: 1000 }],
    });
    Sequence.loadState({
      status: 'phaseComplete',
      program: Sequence.getProgram(),
      phaseIndex: 0,
      accumulatedMs: 1000,
    });
    Sequence.advancePhase();
    assertEqual(Sequence.getStatus(), 'idle');
    assertEqual(Sequence.getPhaseIndex(), 1);
    assertEqual(Sequence.getCurrentPhase().name, 'B');
  });

  it('advancePhase is no-op when not phaseComplete', () => {
    Sequence.reset();
    Sequence.setProgram({ phases: [{ name: 'A', durationMs: 1000 }] });
    Sequence.start();
    Sequence.advancePhase();
    assertEqual(Sequence.getStatus(), 'running');
    assertEqual(Sequence.getPhaseIndex(), 0);
  });

  it('advancePhase past last phase transitions to done', () => {
    Sequence.reset();
    Sequence.setProgram({
      phases: [{ name: 'A', durationMs: 1000 }, { name: 'B', durationMs: 1000 }],
    });
    Sequence.loadState({
      status: 'phaseComplete',
      program: Sequence.getProgram(),
      phaseIndex: 1,
      accumulatedMs: 1000,
    });
    Sequence.advancePhase();
    assertEqual(Sequence.getStatus(), 'done');
    assertEqual(Sequence.getPhaseIndex(), 0);
  });
});

describe('Sequence — state serialization', () => {
  it('getState returns full state', () => {
    Sequence.reset();
    Sequence.setProgram({
      name: 'Brew',
      phases: [{ name: 'Bloom', durationMs: 30000 }, { name: 'Pour', durationMs: 60000 }],
    });
    Sequence.start();
    const state = Sequence.getState();
    assertEqual(state.status, 'running');
    assertEqual(state.phaseIndex, 0);
    assertEqual(state.program.name, 'Brew');
    assertEqual(state.program.phases.length, 2);
    assert(state.startedAt !== null, 'startedAt should be set');
  });

  it('loadState restores program and phaseIndex', () => {
    Sequence.reset();
    Sequence.loadState({
      status: 'paused',
      program: { name: 'Restored', phases: [{ name: 'A', durationMs: 5000 }, { name: 'B', durationMs: 5000 }] },
      phaseIndex: 1,
      accumulatedMs: 1234,
    });
    assertEqual(Sequence.getStatus(), 'paused');
    assertEqual(Sequence.getProgram().name, 'Restored');
    assertEqual(Sequence.getPhaseIndex(), 1);
    assertEqual(Sequence.getCurrentPhase().name, 'B');
  });

  it('loadState handles clock skew (future startedAt → paused)', () => {
    Sequence.reset();
    Sequence.loadState({
      status: 'running',
      program: { name: '', phases: [{ name: 'A', durationMs: 60000 }] },
      phaseIndex: 0,
      startedAt: Date.now() + 999999,
      accumulatedMs: 0,
    });
    assertEqual(Sequence.getStatus(), 'paused');
  });

  it('loadState auto-completes expired phase', () => {
    Sequence.reset();
    Sequence.loadState({
      status: 'running',
      program: { name: '', phases: [{ name: 'A', durationMs: 1000 }] },
      phaseIndex: 0,
      startedAt: Date.now() - 60000,
      accumulatedMs: 0,
    });
    assertEqual(Sequence.getStatus(), 'phaseComplete');
    assertEqual(Sequence.getRemainingMs(), 0);
  });

  it('loadState preserves 0 phaseIndex with nullish coalescing', () => {
    Sequence.reset();
    Sequence.loadState({
      status: 'idle',
      program: { name: '', phases: [{ name: 'A', durationMs: 1000 }] },
      phaseIndex: 0,
      accumulatedMs: 0,
    });
    assertEqual(Sequence.getPhaseIndex(), 0);
    assertEqual(Sequence.getStatus(), 'idle');
  });

  it('loadState defaults missing program to empty', () => {
    Sequence.reset();
    Sequence.loadState({ status: 'idle' });
    assertEqual(Sequence.getPhaseCount(), 0);
    assertEqual(Sequence.getProgram().name, '');
  });

  it('loadState ignores null/undefined input', () => {
    Sequence.reset();
    Sequence.setProgram({ name: 'Keep', phases: [{ name: 'A', durationMs: 1000 }] });
    Sequence.loadState(null);
    assertEqual(Sequence.getProgram().name, 'Keep');
  });
});
