describe('Flow — creation and idle state', () => {
  it('starts in idle state with focus phase', () => {
    Flow.reset();
    assertEqual(Flow.getStatus(), 'idle');
    assertEqual(Flow.getPhase(), 'focus');
    assertEqual(Flow.getElapsedMs(), 0);
    assertEqual(Flow.getGoal(), '');
  });

  it('exposes preset durations', () => {
    assertEqual(Flow.PRESETS.FOCUS_90, 90 * 60000);
    assertEqual(Flow.PRESETS.FOCUS_120, 120 * 60000);
    assertEqual(Flow.PRESETS.RECOVERY_MS, 15 * 60000);
  });

  it('defaults to 90-minute focus duration', () => {
    Flow.reset();
    assertEqual(Flow.getFocusDurationMs(), 90 * 60000);
    assertEqual(Flow.getRecoveryDurationMs(), 15 * 60000);
  });

  it('remaining equals focus duration when idle', () => {
    Flow.reset();
    assertEqual(Flow.getRemainingMs(), 90 * 60000);
  });

  it('getConfig returns focus duration', () => {
    Flow.reset();
    const cfg = Flow.getConfig();
    assertEqual(cfg.focusDurationMs, 90 * 60000);
  });
});

describe('Flow — configure', () => {
  it('allows switching to 120-minute preset when idle', () => {
    Flow.reset();
    Flow.configure({ focusDurationMs: 120 * 60000 });
    assertEqual(Flow.getFocusDurationMs(), 120 * 60000);
  });

  it('allows switching back to 90-minute preset', () => {
    Flow.reset();
    Flow.configure({ focusDurationMs: 120 * 60000 });
    Flow.configure({ focusDurationMs: 90 * 60000 });
    assertEqual(Flow.getFocusDurationMs(), 90 * 60000);
  });

  it('coerces non-preset durations to 90 minutes', () => {
    Flow.reset();
    Flow.configure({ focusDurationMs: 30 * 60000 });
    assertEqual(Flow.getFocusDurationMs(), 90 * 60000);
  });

  it('ignores configure when not idle', () => {
    Flow.reset();
    Flow.configure({ focusDurationMs: 120 * 60000 });
    Flow.start();
    Flow.configure({ focusDurationMs: 90 * 60000 });
    assertEqual(Flow.getFocusDurationMs(), 120 * 60000);
    Flow.reset();
  });
});

describe('Flow — goal', () => {
  it('sets and reads goal text', () => {
    Flow.reset();
    Flow.setGoal('Write the report');
    assertEqual(Flow.getGoal(), 'Write the report');
  });

  it('truncates goal to 120 characters', () => {
    Flow.reset();
    const long = 'x'.repeat(200);
    Flow.setGoal(long);
    assertEqual(Flow.getGoal().length, 120);
  });

  it('coerces null/undefined to empty string', () => {
    Flow.reset();
    Flow.setGoal('something');
    Flow.setGoal(null);
    assertEqual(Flow.getGoal(), '');
    Flow.setGoal(undefined);
    assertEqual(Flow.getGoal(), '');
  });

  it('reset clears the goal', () => {
    Flow.setGoal('My focus');
    Flow.reset();
    assertEqual(Flow.getGoal(), '');
  });
});

describe('Flow — start/pause/resume', () => {
  it('starts from idle and enters running/focus', () => {
    Flow.reset();
    Flow.start();
    assertEqual(Flow.getStatus(), 'running');
    assertEqual(Flow.getPhase(), 'focus');
    assert(Flow.getSessionStartedAt() !== null, 'sessionStartedAt should be set');
  });

  it('pauses correctly from running', () => {
    Flow.reset();
    Flow.start();
    Flow.pause();
    assertEqual(Flow.getStatus(), 'paused');
  });

  it('resume returns to running', () => {
    Flow.reset();
    Flow.start();
    Flow.pause();
    Flow.resume();
    assertEqual(Flow.getStatus(), 'running');
  });

  it('start ignored while running', () => {
    Flow.reset();
    Flow.start();
    const startedAt1 = Flow.getSessionStartedAt();
    Flow.start();
    assertEqual(Flow.getStatus(), 'running');
    assertEqual(Flow.getSessionStartedAt(), startedAt1);
  });

  it('start resumes from paused', () => {
    Flow.reset();
    Flow.start();
    Flow.pause();
    Flow.start();
    assertEqual(Flow.getStatus(), 'running');
  });

  it('pause ignored when idle', () => {
    Flow.reset();
    Flow.pause();
    assertEqual(Flow.getStatus(), 'idle');
  });

  it('resume ignored when not paused', () => {
    Flow.reset();
    Flow.resume();
    assertEqual(Flow.getStatus(), 'idle');
  });

  it('preserves sessionStartedAt across pause/resume', () => {
    Flow.reset();
    Flow.start();
    const started = Flow.getSessionStartedAt();
    Flow.pause();
    Flow.resume();
    assertEqual(Flow.getSessionStartedAt(), started);
  });
});

describe('Flow — elapsed and progress', () => {
  it('elapsed is 0 when idle', () => {
    Flow.reset();
    assertEqual(Flow.getElapsedMs(), 0);
  });

  it('elapsed grows after start', () => {
    Flow.reset();
    Flow.start();
    const e = Flow.getElapsedMs();
    assert(e >= 0, 'elapsed should be >= 0');
    assert(e <= 90 * 60000, 'elapsed should be <= focus duration');
    Flow.reset();
  });

  it('progress is between 0 and 1 while running', () => {
    Flow.reset();
    Flow.start();
    const p = Flow.getProgress();
    assert(p >= 0 && p <= 1, 'progress should be 0..1');
    Flow.reset();
  });

  it('progress is 0 when idle', () => {
    Flow.reset();
    assertEqual(Flow.getProgress(), 0);
  });

  it('remaining never goes negative', () => {
    Flow.reset();
    Flow.loadState({
      status: 'running',
      phase: 'focus',
      focusDurationMs: 90 * 60000,
      startedAt: Date.now() - 200 * 60000,
      accumulatedMs: 0,
    });
    assert(Flow.getRemainingMs() >= 0, 'remaining should not be negative');
  });
});

describe('Flow — checkFinished (focus → focusComplete)', () => {
  it('returns false while focus is still running', () => {
    Flow.reset();
    Flow.start();
    assertEqual(Flow.checkFinished(), false);
    assertEqual(Flow.getStatus(), 'running');
    Flow.reset();
  });

  it('transitions running → focusComplete when time expires', () => {
    Flow.reset();
    let calledWith = null;
    Flow.onPhaseComplete((phase) => { calledWith = phase; });
    // Manually rig running state with elapsed > duration without triggering loadState auto-complete
    Flow.start();
    Flow.pause();
    // After pause, accumulatedMs holds whatever ran. Inject a state via loadState that
    // is RUNNING with startedAt in the past such that elapsed > duration; but loadState
    // will auto-complete it. To exercise the checkFinished branch, set accumulatedMs
    // beyond the duration while paused, then resume — the resumed running state will
    // immediately satisfy getRemainingMs() <= 0.
    Flow.reset();
    Flow.loadState({
      status: 'paused',
      phase: 'focus',
      focusDurationMs: 90 * 60000,
      accumulatedMs: 90 * 60000 + 1000, // past full duration
      startedAt: null,
      sessionStartedAt: Date.now() - 90 * 60000,
    });
    Flow.resume();
    const result = Flow.checkFinished();
    assertEqual(result, true);
    assertEqual(Flow.getStatus(), 'focusComplete');
    assert(Flow.getFocusEndedAt() !== null, 'focusEndedAt should be set');
    assertEqual(calledWith, 'focus');
    Flow.onPhaseComplete(null);
    Flow.reset();
  });

  it('caps elapsed at focus duration once complete', () => {
    Flow.reset();
    Flow.loadState({
      status: 'paused',
      phase: 'focus',
      focusDurationMs: 90 * 60000,
      accumulatedMs: 90 * 60000 + 5000,
      startedAt: null,
    });
    Flow.resume();
    Flow.checkFinished();
    assertEqual(Flow.getElapsedMs(), 90 * 60000);
    assertEqual(Flow.getRemainingMs(), 0);
    Flow.reset();
  });
});

describe('Flow — recovery phase', () => {
  it('startRecovery transitions focusComplete → recovery', () => {
    Flow.reset();
    Flow.loadState({
      status: 'focusComplete',
      phase: 'focus',
      focusDurationMs: 90 * 60000,
      accumulatedMs: 90 * 60000,
      startedAt: null,
      focusEndedAt: Date.now(),
    });
    Flow.startRecovery();
    assertEqual(Flow.getStatus(), 'recovery');
    assertEqual(Flow.getPhase(), 'recovery');
    Flow.reset();
  });

  it('startRecovery ignored unless focusComplete', () => {
    Flow.reset();
    Flow.startRecovery();
    assertEqual(Flow.getStatus(), 'idle');
  });

  it('recovery phase uses 15-minute duration', () => {
    Flow.reset();
    Flow.loadState({
      status: 'focusComplete',
      phase: 'focus',
      focusDurationMs: 90 * 60000,
      accumulatedMs: 90 * 60000,
      startedAt: null,
    });
    Flow.startRecovery();
    assertEqual(Flow.getCurrentPhaseDurationMs(), 15 * 60000);
    assert(Flow.getRemainingMs() <= 15 * 60000, 'remaining should be <= 15min');
    Flow.reset();
  });

  it('pause during recovery → recoveryPaused', () => {
    Flow.reset();
    Flow.loadState({
      status: 'focusComplete',
      phase: 'focus',
      focusDurationMs: 90 * 60000,
      accumulatedMs: 90 * 60000,
      startedAt: null,
    });
    Flow.startRecovery();
    Flow.pause();
    assertEqual(Flow.getStatus(), 'recoveryPaused');
    Flow.reset();
  });

  it('resume from recoveryPaused returns to recovery', () => {
    Flow.reset();
    Flow.loadState({
      status: 'focusComplete',
      phase: 'focus',
      focusDurationMs: 90 * 60000,
      accumulatedMs: 90 * 60000,
      startedAt: null,
    });
    Flow.startRecovery();
    Flow.pause();
    Flow.resume();
    assertEqual(Flow.getStatus(), 'recovery');
    Flow.reset();
  });

  it('checkFinished transitions recovery → done', () => {
    Flow.reset();
    let calledWith = null;
    Flow.onPhaseComplete((p) => { calledWith = p; });
    Flow.loadState({
      status: 'focusComplete',
      phase: 'focus',
      focusDurationMs: 90 * 60000,
      accumulatedMs: 90 * 60000,
      startedAt: null,
    });
    Flow.startRecovery();
    // Force recovery elapsed past full duration via pause/load/resume
    Flow.pause();
    Flow.loadState({
      status: 'recoveryPaused',
      phase: 'recovery',
      focusDurationMs: 90 * 60000,
      accumulatedMs: 15 * 60000 + 1000,
      startedAt: null,
    });
    Flow.resume();
    const result = Flow.checkFinished();
    assertEqual(result, true);
    assertEqual(Flow.getStatus(), 'done');
    assertEqual(calledWith, 'recovery');
    Flow.onPhaseComplete(null);
    Flow.reset();
  });
});

describe('Flow — skipRecovery', () => {
  it('skipRecovery from focusComplete → done', () => {
    Flow.reset();
    Flow.loadState({
      status: 'focusComplete',
      phase: 'focus',
      focusDurationMs: 90 * 60000,
      accumulatedMs: 90 * 60000,
      startedAt: null,
    });
    Flow.skipRecovery();
    assertEqual(Flow.getStatus(), 'done');
    Flow.reset();
  });

  it('skipRecovery from recovery → done', () => {
    Flow.reset();
    Flow.loadState({
      status: 'focusComplete',
      phase: 'focus',
      focusDurationMs: 90 * 60000,
      accumulatedMs: 90 * 60000,
      startedAt: null,
    });
    Flow.startRecovery();
    Flow.skipRecovery();
    assertEqual(Flow.getStatus(), 'done');
    Flow.reset();
  });

  it('skipRecovery from recoveryPaused → done', () => {
    Flow.reset();
    Flow.loadState({
      status: 'focusComplete',
      phase: 'focus',
      focusDurationMs: 90 * 60000,
      accumulatedMs: 90 * 60000,
      startedAt: null,
    });
    Flow.startRecovery();
    Flow.pause();
    Flow.skipRecovery();
    assertEqual(Flow.getStatus(), 'done');
    Flow.reset();
  });

  it('skipRecovery ignored from idle/running/paused', () => {
    Flow.reset();
    Flow.skipRecovery();
    assertEqual(Flow.getStatus(), 'idle');

    Flow.start();
    Flow.skipRecovery();
    assertEqual(Flow.getStatus(), 'running');

    Flow.pause();
    Flow.skipRecovery();
    assertEqual(Flow.getStatus(), 'paused');
    Flow.reset();
  });
});

describe('Flow — reset', () => {
  it('reset returns engine to defaults', () => {
    Flow.configure({ focusDurationMs: 120 * 60000 });
    Flow.setGoal('Write code');
    Flow.start();
    Flow.reset();
    assertEqual(Flow.getStatus(), 'idle');
    assertEqual(Flow.getPhase(), 'focus');
    assertEqual(Flow.getElapsedMs(), 0);
    assertEqual(Flow.getGoal(), '');
    assertEqual(Flow.getSessionStartedAt(), null);
    assertEqual(Flow.getFocusEndedAt(), null);
  });
});

describe('Flow — state serialization', () => {
  it('getState returns full state shape', () => {
    Flow.reset();
    Flow.configure({ focusDurationMs: 120 * 60000 });
    Flow.setGoal('ship feature');
    Flow.start();
    const s = Flow.getState();
    assertEqual(s.status, 'running');
    assertEqual(s.phase, 'focus');
    assertEqual(s.focusDurationMs, 120 * 60000);
    assertEqual(s.goal, 'ship feature');
    assert(s.startedAt !== null, 'startedAt should be set');
    assert(s.sessionStartedAt !== null, 'sessionStartedAt should be set');
    Flow.reset();
  });

  it('loadState restores state values', () => {
    Flow.reset();
    Flow.loadState({
      status: 'paused',
      phase: 'focus',
      focusDurationMs: 120 * 60000,
      accumulatedMs: 5 * 60000,
      startedAt: null,
      sessionStartedAt: Date.now() - 5 * 60000,
      goal: 'plan day',
    });
    assertEqual(Flow.getStatus(), 'paused');
    assertEqual(Flow.getFocusDurationMs(), 120 * 60000);
    assertEqual(Flow.getGoal(), 'plan day');
    Flow.reset();
  });

  it('loadState handles future startedAt clock skew (running)', () => {
    Flow.reset();
    Flow.loadState({
      status: 'running',
      phase: 'focus',
      focusDurationMs: 90 * 60000,
      startedAt: Date.now() + 999999,
      accumulatedMs: 0,
    });
    assertEqual(Flow.getStatus(), 'paused');
    Flow.reset();
  });

  it('loadState handles future startedAt clock skew (recovery)', () => {
    Flow.reset();
    Flow.loadState({
      status: 'recovery',
      phase: 'recovery',
      focusDurationMs: 90 * 60000,
      startedAt: Date.now() + 999999,
      accumulatedMs: 0,
    });
    assertEqual(Flow.getStatus(), 'recoveryPaused');
    Flow.reset();
  });

  it('loadState auto-completes focus that elapsed while closed', () => {
    Flow.reset();
    Flow.loadState({
      status: 'running',
      phase: 'focus',
      focusDurationMs: 90 * 60000,
      startedAt: Date.now() - 200 * 60000,
      accumulatedMs: 0,
    });
    assertEqual(Flow.getStatus(), 'focusComplete');
    assert(Flow.getFocusEndedAt() !== null, 'focusEndedAt should be set after auto-complete');
    Flow.reset();
  });

  it('loadState auto-completes recovery that elapsed while closed', () => {
    Flow.reset();
    Flow.loadState({
      status: 'recovery',
      phase: 'recovery',
      focusDurationMs: 90 * 60000,
      startedAt: Date.now() - 60 * 60000,
      accumulatedMs: 0,
    });
    assertEqual(Flow.getStatus(), 'done');
    Flow.reset();
  });

  it('loadState preserves 0 values via nullish coalescing', () => {
    Flow.reset();
    Flow.loadState({
      status: 'idle',
      phase: 'focus',
      focusDurationMs: 90 * 60000,
      accumulatedMs: 0,
      startedAt: null,
    });
    assertEqual(Flow.getStatus(), 'idle');
    assertEqual(Flow.getElapsedMs(), 0);
    Flow.reset();
  });

  it('loadState coerces non-preset focus durations to 90 min', () => {
    Flow.reset();
    Flow.loadState({
      status: 'idle',
      phase: 'focus',
      focusDurationMs: 45 * 60000,
    });
    assertEqual(Flow.getFocusDurationMs(), 90 * 60000);
    Flow.reset();
  });

  it('loadState with empty object is a no-op', () => {
    Flow.reset();
    Flow.setGoal('keep me');
    Flow.loadState(null);
    assertEqual(Flow.getGoal(), 'keep me');
    Flow.reset();
  });
});
