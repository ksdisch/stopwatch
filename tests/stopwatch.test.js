describe('Stopwatch — creation and idle state', () => {
  it('creates with idle status', () => {
    const sw = createStopwatch('test-1');
    assertEqual(sw.getStatus(), 'idle');
    assertEqual(sw.getElapsedMs(), 0);
    assertEqual(sw.getLaps().length, 0);
    assertEqual(sw.getId(), 'test-1');
  });

  it('has default name', () => {
    const sw = createStopwatch('test-2');
    assertEqual(sw.getName(), 'Stopwatch');
  });

  it('allows setting name', () => {
    const sw = createStopwatch('test-3');
    sw.setName('My Timer');
    assertEqual(sw.getName(), 'My Timer');
  });
});

describe('Stopwatch — start/pause/resume', () => {
  it('starts and reports running', () => {
    const sw = createStopwatch('test-4');
    sw.start();
    assertEqual(sw.getStatus(), 'running');
  });

  it('elapsed increases after start', () => {
    const sw = createStopwatch('test-5');
    sw.start();
    const elapsed = sw.getElapsedMs();
    assert(elapsed >= 0, 'Elapsed should be >= 0');
  });

  it('pauses and retains elapsed', () => {
    const sw = createStopwatch('test-6');
    sw.start();
    // Simulate some time passing
    const before = sw.getElapsedMs();
    sw.pause();
    assertEqual(sw.getStatus(), 'paused');
    const after = sw.getElapsedMs();
    assert(after >= before, 'Elapsed should not decrease on pause');
  });

  it('resumes from paused', () => {
    const sw = createStopwatch('test-7');
    sw.start();
    sw.pause();
    sw.start();
    assertEqual(sw.getStatus(), 'running');
  });

  it('ignores double start', () => {
    const sw = createStopwatch('test-8');
    sw.start();
    sw.start(); // should be no-op
    assertEqual(sw.getStatus(), 'running');
  });

  it('ignores pause when not running', () => {
    const sw = createStopwatch('test-9');
    sw.pause(); // should be no-op
    assertEqual(sw.getStatus(), 'idle');
  });
});

describe('Stopwatch — reset', () => {
  it('resets to idle with zero elapsed', () => {
    const sw = createStopwatch('test-10');
    sw.start();
    sw.pause();
    sw.reset();
    assertEqual(sw.getStatus(), 'idle');
    assertEqual(sw.getElapsedMs(), 0);
    assertEqual(sw.getLaps().length, 0);
  });

  it('clears alerts on reset', () => {
    const sw = createStopwatch('test-11');
    sw.addAlert(5000);
    sw.addAlert(10000);
    assertEqual(sw.getAlerts().length, 2);
    sw.reset();
    assertEqual(sw.getAlerts().length, 0);
  });
});

describe('Stopwatch — offset', () => {
  it('sets offset when idle', () => {
    const sw = createStopwatch('test-12');
    sw.setOffset(30000);
    assertEqual(sw.getElapsedMs(), 30000);
  });

  it('ignores offset when not idle', () => {
    const sw = createStopwatch('test-13');
    sw.start();
    sw.setOffset(30000);
    // Elapsed should be small, not 30000
    assert(sw.getElapsedMs() < 1000, 'Offset should not apply when running');
  });

  it('offset adds to elapsed when running', () => {
    const sw = createStopwatch('test-14');
    sw.setOffset(10000);
    sw.start();
    assert(sw.getElapsedMs() >= 10000, 'Elapsed should include offset');
  });
});

describe('Stopwatch — laps', () => {
  it('records a lap', () => {
    const sw = createStopwatch('test-15');
    sw.start();
    sw.lap();
    assertEqual(sw.getLaps().length, 1);
  });

  it('ignores lap when not running', () => {
    const sw = createStopwatch('test-16');
    sw.lap();
    assertEqual(sw.getLaps().length, 0);
  });

  it('lap has lapMs and totalMs', () => {
    const sw = createStopwatch('test-17');
    sw.start();
    sw.lap();
    const laps = sw.getLaps();
    assert(laps[0].lapMs >= 0, 'lapMs should be >= 0');
    assert(laps[0].totalMs >= 0, 'totalMs should be >= 0');
  });

  it('deletes a lap by index', () => {
    const sw = createStopwatch('test-18');
    sw.start();
    sw.lap();
    sw.lap();
    sw.lap();
    assertEqual(sw.getLaps().length, 3);
    sw.deleteLap(1);
    assertEqual(sw.getLaps().length, 2);
  });

  it('getCurrentLapMs returns 0 when idle with no laps', () => {
    const sw = createStopwatch('test-19');
    assertEqual(sw.getCurrentLapMs(), 0);
  });
});

describe('Stopwatch — alerts', () => {
  it('adds alerts sorted by ms', () => {
    const sw = createStopwatch('test-20');
    sw.addAlert(10000);
    sw.addAlert(5000);
    sw.addAlert(15000);
    const alerts = sw.getAlerts();
    assertEqual(alerts.length, 3);
    assertEqual(alerts[0].ms, 5000);
    assertEqual(alerts[1].ms, 10000);
    assertEqual(alerts[2].ms, 15000);
  });

  it('prevents duplicate alerts', () => {
    const sw = createStopwatch('test-21');
    sw.addAlert(5000);
    sw.addAlert(5000);
    assertEqual(sw.getAlerts().length, 1);
  });

  it('removes an alert', () => {
    const sw = createStopwatch('test-22');
    sw.addAlert(5000);
    sw.addAlert(10000);
    sw.removeAlert(5000);
    assertEqual(sw.getAlerts().length, 1);
    assertEqual(sw.getAlerts()[0].ms, 10000);
  });

  it('checkAlerts fires when elapsed passes threshold', () => {
    const sw = createStopwatch('test-23');
    sw.setOffset(10000); // Start at 10s
    sw.addAlert(5000);   // Alert at 5s — already passed
    sw.start();
    const fired = sw.checkAlerts();
    assertEqual(fired.length, 1);
    assertEqual(fired[0], 5000);
    assert(sw.getAlerts()[0].fired, 'Alert should be marked as fired');
  });

  it('does not re-fire alerts', () => {
    const sw = createStopwatch('test-24');
    sw.setOffset(10000);
    sw.addAlert(5000);
    sw.start();
    sw.checkAlerts(); // fires
    const fired2 = sw.checkAlerts(); // should not fire again
    assertEqual(fired2.length, 0);
  });

  it('does not fire alerts when not running', () => {
    const sw = createStopwatch('test-25');
    sw.setOffset(10000);
    sw.addAlert(5000);
    const fired = sw.checkAlerts();
    assertEqual(fired.length, 0);
  });
});

describe('Stopwatch — state serialization', () => {
  it('getState returns complete state', () => {
    const sw = createStopwatch('test-26');
    sw.setName('Test');
    sw.setOffset(5000);
    sw.addAlert(10000);
    const state = sw.getState();
    assertEqual(state.id, 'test-26');
    assertEqual(state.name, 'Test');
    assertEqual(state.offsetMs, 5000);
    assertEqual(state.alerts.length, 1);
  });

  it('loadState restores state', () => {
    const sw1 = createStopwatch('test-27');
    sw1.setName('Original');
    sw1.setOffset(5000);
    sw1.addAlert(10000);
    const state = sw1.getState();

    const sw2 = createStopwatch('test-28');
    sw2.loadState(state);
    assertEqual(sw2.getName(), 'Original');
    assertEqual(sw2.getElapsedMs(), 5000);
    assertEqual(sw2.getAlerts().length, 1);
  });

  it('loadState handles clock skew', () => {
    const sw = createStopwatch('test-29');
    sw.loadState({
      status: 'running',
      startedAt: Date.now() + 999999, // future timestamp
      accumulatedMs: 0,
    });
    assertEqual(sw.getStatus(), 'paused');
  });

  it('loadState preserves 0 values with nullish coalescing', () => {
    const sw = createStopwatch('test-30');
    sw.loadState({
      status: 'idle',
      offsetMs: 0,
      accumulatedMs: 0,
      lapStartMs: 0,
    });
    assertEqual(sw.getElapsedMs(), 0);
    assertEqual(sw.getStatus(), 'idle');
  });
});

describe('Stopwatch — deleteLap rebaseline (C3 — AUDIT-2026-06-13)', () => {
  it('deleting the last lap restores the fresh-start baseline (lapStartMs = 0), keeping the offset in', () => {
    // A paused stopwatch started 30s "ago" (offset), run for another 60s → 90s
    // elapsed, with one lap spanning the whole 90s (totalMs = 90s, the same as
    // a first lap taken from a fresh start where lapStartMs began at 0).
    const sw = createStopwatch('c3-1');
    sw.loadState({
      status: 'paused',
      offsetMs: 30000,
      accumulatedMs: 60000,
      startedAt: null,
      laps: [{ lapMs: 90000, totalMs: 90000 }],
      lapStartMs: 90000,
    });
    assertEqual(sw.getElapsedMs(), 90000, 'deterministic elapsed for a paused state');

    sw.deleteLap(0); // empties the lap list
    assertEqual(sw.getLaps().length, 0, 'lap removed');
    // The in-progress lap must measure from 0 (like the first lap from a fresh
    // start, which includes the offset) — NOT from offsetMs. Pre-fix this was
    // 90000 - 30000 = 60000, silently dropping the offset.
    assertEqual(sw.getCurrentLapMs(), 90000, 'baseline reset to 0, offset retained');
  });

  it('deleting the last lap with no offset is unchanged (regression guard)', () => {
    const sw = createStopwatch('c3-2');
    sw.loadState({
      status: 'paused',
      offsetMs: 0,
      accumulatedMs: 50000,
      startedAt: null,
      laps: [{ lapMs: 50000, totalMs: 50000 }],
      lapStartMs: 50000,
    });
    sw.deleteLap(0);
    assertEqual(sw.getLaps().length, 0);
    // offsetMs was 0, so the fix (→0) matches the old behavior (→offsetMs=0).
    assertEqual(sw.getCurrentLapMs(), 50000, 'no-offset baseline still 0');
  });

  it('deleting a non-last lap still rebaselines to the remaining tail lap', () => {
    const sw = createStopwatch('c3-3');
    sw.loadState({
      status: 'paused',
      offsetMs: 0,
      accumulatedMs: 30000,
      startedAt: null,
      laps: [
        { lapMs: 10000, totalMs: 10000 },
        { lapMs: 10000, totalMs: 20000 },
      ],
      lapStartMs: 20000,
    });
    sw.deleteLap(0); // remove the first lap; one remains (totalMs 20000)
    assertEqual(sw.getLaps().length, 1, 'one lap remains');
    // Non-empty branch is unchanged: lapStartMs = last remaining lap's totalMs.
    assertEqual(sw.getCurrentLapMs(), 10000, 'rebaselined to the surviving tail lap');
  });
});
