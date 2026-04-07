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

  it('does not start when phaseComplete', () => {
    Pomodoro.reset();
    Pomodoro.loadState({ status: 'phaseComplete', phase: 'work' });
    Pomodoro.start();
    assertEqual(Pomodoro.getStatus(), 'phaseComplete');
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
  it('triggers phaseComplete when time expires', () => {
    Pomodoro.reset();
    Pomodoro.configure({ workMs: 60000, shortBreakMs: 60000, longBreakMs: 60000, totalCycles: 4 });

    // loadState with expired time auto-completes the phase
    Pomodoro.loadState({
      status: 'running',
      phase: 'work',
      startedAt: Date.now() - 120000,
      accumulatedMs: 0,
      workMs: 60000,
    });

    // loadState should have auto-set phaseComplete
    assertEqual(Pomodoro.getStatus(), 'phaseComplete');
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

  it('loadState auto-completes expired phase', () => {
    Pomodoro.reset();
    Pomodoro.loadState({
      status: 'running',
      phase: 'work',
      workMs: 10000,
      startedAt: Date.now() - 60000,
      accumulatedMs: 0,
    });
    assertEqual(Pomodoro.getStatus(), 'phaseComplete');
  });

  it('reset restores defaults', () => {
    Pomodoro.reset();
    assertEqual(Pomodoro.getStatus(), 'idle');
    assertEqual(Pomodoro.getPhase(), 'work');
    assertEqual(Pomodoro.getCycleIndex(), 0);
  });
});
