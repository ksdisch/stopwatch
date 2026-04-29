describe('Timer — creation and idle state', () => {
  it('creates with idle status', () => {
    const t = createTimer('tm-test-1');
    assertEqual(t.getStatus(), 'idle');
    assertEqual(t.getDurationMs(), 0);
    assertEqual(t.getRemainingMs(), 0);
    assertEqual(t.getElapsedMs(), 0);
  });

  it('has id and name', () => {
    const t = createTimer('tm-test-2');
    assertEqual(t.getId(), 'tm-test-2');
    assertEqual(t.getName(), 'Timer');
    t.setName('My Countdown');
    assertEqual(t.getName(), 'My Countdown');
  });
});

describe('Timer — duration', () => {
  it('sets duration when idle', () => {
    const t = createTimer('tm-test-3');
    t.setDuration(60000);
    assertEqual(t.getDurationMs(), 60000);
    assertEqual(t.getRemainingMs(), 60000);
  });

  it('ignores setDuration when not idle', () => {
    const t = createTimer('tm-test-4');
    t.setDuration(60000);
    t.start();
    t.setDuration(120000);
    assertEqual(t.getDurationMs(), 60000);
  });

  it('clamps negative duration to 0', () => {
    const t = createTimer('tm-test-5');
    t.setDuration(-1000);
    assertEqual(t.getDurationMs(), 0);
  });
});

describe('Timer — start/pause/resume', () => {
  it('starts with duration set', () => {
    const t = createTimer('tm-test-6');
    t.setDuration(60000);
    t.start();
    assertEqual(t.getStatus(), 'running');
  });

  it('does not start without duration', () => {
    const t = createTimer('tm-test-7');
    t.start();
    assertEqual(t.getStatus(), 'idle');
  });

  it('pauses correctly', () => {
    const t = createTimer('tm-test-8');
    t.setDuration(60000);
    t.start();
    t.pause();
    assertEqual(t.getStatus(), 'paused');
    assert(t.getRemainingMs() <= 60000, 'Remaining should be <= duration');
    assert(t.getRemainingMs() > 59000, 'Remaining should be close to duration');
  });

  it('resumes from paused', () => {
    const t = createTimer('tm-test-9');
    t.setDuration(60000);
    t.start();
    t.pause();
    t.start();
    assertEqual(t.getStatus(), 'running');
  });

  it('does not start when finished', () => {
    const t = createTimer('tm-test-10');
    t.setDuration(60000);
    t.start();
    // Simulate finished state
    t.loadState({ status: 'finished', durationMs: 60000, accumulatedMs: 60000, startedAt: null });
    t.start();
    assertEqual(t.getStatus(), 'finished');
  });
});

describe('Timer — progress', () => {
  it('progress is 0 at start', () => {
    const t = createTimer('tm-test-11');
    t.setDuration(60000);
    assertEqual(t.getProgress(), 0);
  });

  it('progress is 0 without duration', () => {
    const t = createTimer('tm-test-12');
    assertEqual(t.getProgress(), 0);
  });

  it('progress increases when running', () => {
    const t = createTimer('tm-test-13');
    t.setDuration(60000);
    t.start();
    const p = t.getProgress();
    assert(p >= 0 && p <= 1, 'Progress should be between 0 and 1');
  });
});

describe('Timer — checkFinished', () => {
  it('fires alarm callback when finished', () => {
    let alarmFired = false;
    const t = createTimer('tm-test-14');
    t.onAlarm(() => { alarmFired = true; });
    t.setDuration(100000); // 100s duration
    // Set up: accumulatedMs + time since startedAt must be < duration at loadState time
    // but >= duration at checkFinished time.
    // accumulatedMs = 99000, startedAt = 500ms ago → elapsed = 99500 < 100000 (no auto-finish)
    // By the time checkFinished runs, elapsed = 99000 + 500+ = 99500+ (still under)
    // So use a tighter margin: startedAt 2000ms ago, accumulatedMs = 98500
    // loadState: elapsed = 98500 + 2000 = 100500 > 100000 → auto-finishes. Hmm.
    // The problem: loadState's auto-finish check runs the same getRemainingMs() as checkFinished.
    // Any state that checkFinished would catch, loadState also catches.
    // Solution: set onAlarm BEFORE loadState so the auto-finish path is what we test.
    t.loadState({ status: 'running', durationMs: 100000, startedAt: Date.now() - 200000, accumulatedMs: 0 });
    // loadState auto-finished — but onAlarm was set before, so it should NOT have fired
    // (loadState doesn't call alarmCallback, only checkFinished does)
    assertEqual(t.getStatus(), 'finished');
    assert(!alarmFired, 'Alarm should not fire from loadState auto-finish');

    // Test checkFinished directly with a fresh timer
    let alarm2 = false;
    const t2 = createTimer('tm-test-14b');
    t2.onAlarm(() => { alarm2 = true; });
    t2.setDuration(100);
    t2.start();
    // Busy-wait until checkFinished triggers (100ms is fast enough)
    const start = Date.now();
    while (Date.now() - start < 200) { /* spin */ }
    const result = t2.checkFinished();
    assertEqual(result, true);
    assertEqual(t2.getStatus(), 'finished');
    assert(alarm2, 'Alarm callback should have fired via checkFinished');
  });

  it('does not fire when not finished', () => {
    const t = createTimer('tm-test-15');
    t.setDuration(999999);
    t.start();
    const result = t.checkFinished();
    assertEqual(result, false);
    assertEqual(t.getStatus(), 'running');
  });

  it('remaining is 0 when finished', () => {
    const t = createTimer('tm-test-16');
    t.setDuration(10000);
    t.loadState({ status: 'running', durationMs: 10000, startedAt: Date.now() - 5000, accumulatedMs: 6000 });
    t.checkFinished();
    assertEqual(t.getRemainingMs(), 0);
  });
});

describe('Timer — reset', () => {
  it('resets to idle with zero duration', () => {
    const t = createTimer('tm-test-17');
    t.setDuration(60000);
    t.start();
    t.reset();
    assertEqual(t.getStatus(), 'idle');
    assertEqual(t.getDurationMs(), 0);
    assertEqual(t.getRemainingMs(), 0);
  });
});

describe('Timer — state serialization', () => {
  it('getState returns complete state', () => {
    const t = createTimer('tm-test-18');
    t.setName('Countdown');
    t.setDuration(60000);
    const state = t.getState();
    assertEqual(state.id, 'tm-test-18');
    assertEqual(state.name, 'Countdown');
    assertEqual(state.durationMs, 60000);
    assertEqual(state.status, 'idle');
  });

  it('loadState restores state', () => {
    const t1 = createTimer('tm-test-19');
    t1.setName('Test');
    t1.setDuration(30000);
    const state = t1.getState();

    const t2 = createTimer('tm-test-20');
    t2.loadState(state);
    assertEqual(t2.getName(), 'Test');
    assertEqual(t2.getDurationMs(), 30000);
  });

  it('loadState handles clock skew', () => {
    const t = createTimer('tm-test-21');
    t.loadState({
      status: 'running',
      durationMs: 60000,
      startedAt: Date.now() + 999999,
      accumulatedMs: 0,
    });
    assertEqual(t.getStatus(), 'paused');
  });

  it('loadState auto-finishes if timer should have completed', () => {
    const t = createTimer('tm-test-22');
    t.loadState({
      status: 'running',
      durationMs: 10000,
      startedAt: Date.now() - 60000, // started 60s ago, only 10s duration
      accumulatedMs: 0,
    });
    assertEqual(t.getStatus(), 'finished');
  });
});

describe('Timer — adjustRemainingMs', () => {
  it('extends remaining while running', () => {
    const t = createTimer('tm-test-adjust-1');
    t.setDuration(60000); // 60s
    t.start();
    const before = t.getRemainingMs();
    const ok = t.adjustRemainingMs(180000); // +3 min
    assertEqual(ok, true);
    const after = t.getRemainingMs();
    assert(after - before >= 179000 && after - before <= 181000,
      `Expected ~+180000ms, got ${after - before}`);
  });

  it('extends remaining while paused', () => {
    const t = createTimer('tm-test-adjust-2');
    t.setDuration(300000); // 5 min
    t.start();
    t.pause();
    const before = t.getRemainingMs();
    assertEqual(t.adjustRemainingMs(180000), true);
    assert(t.getRemainingMs() - before >= 179000 && t.getRemainingMs() - before <= 181000,
      'Paused extend should add ~180000ms');
  });

  it('shrinks remaining while running', () => {
    const t = createTimer('tm-test-adjust-3');
    t.setDuration(600000); // 10 min
    t.start();
    const before = t.getRemainingMs();
    assertEqual(t.adjustRemainingMs(-180000), true);
    const after = t.getRemainingMs();
    assert(before - after >= 179000 && before - after <= 181000,
      `Expected ~-180000ms, got ${before - after}`);
  });

  it('rejects when status is idle', () => {
    const t = createTimer('tm-test-adjust-4');
    t.setDuration(60000);
    assertEqual(t.adjustRemainingMs(180000), false);
    assertEqual(t.getDurationMs(), 60000);
  });

  it('rejects when status is finished', () => {
    const t = createTimer('tm-test-adjust-5');
    t.loadState({ status: 'finished', durationMs: 60000, accumulatedMs: 60000, startedAt: null });
    assertEqual(t.adjustRemainingMs(180000), false);
  });

  it('rejects underflow when -delta would go below 1s remaining', () => {
    const t = createTimer('tm-test-adjust-6');
    t.setDuration(120000); // 2 min
    t.start();
    // Remaining is ~120000, -180000 would leave less than 1s
    assertEqual(t.adjustRemainingMs(-180000), false);
    assertEqual(t.getDurationMs(), 120000); // unchanged
  });

  it('persists durationMs change across getState/loadState', () => {
    const t1 = createTimer('tm-test-adjust-7');
    t1.setDuration(300000);
    t1.start();
    t1.pause();
    t1.adjustRemainingMs(180000);
    const after = t1.getDurationMs();
    const state = t1.getState();
    const t2 = createTimer('tm-test-adjust-8');
    t2.loadState(state);
    assertEqual(t2.getDurationMs(), after);
  });
});
