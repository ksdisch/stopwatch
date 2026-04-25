// PomodoroStats engine tests.
//
// Pattern: each test stubs `window.History` with a known fixture, awaits
// the function under test, and asserts on the returned shape. The
// PomodoroStats module itself is untouched — these tests lock in the
// behavior used by the Pomodoro UI's stats panel.

const _realHistoryForPomodoroStats = window.History;

function setPomodoroSessions(sessions) {
  window.History = {
    getSessions: async () => sessions,
  };
}

const DAY_MS = 86400000;

// Build an ISO date string offset from now by `daysAgo` whole days.
// Using ms offsets (rather than setDate) keeps the relationship
// between sessions and the engine's "today/yesterday" / "this week"
// buckets stable: the engine derives those boundaries the same way.
function pomDateStr(daysAgo) {
  return new Date(Date.now() - daysAgo * DAY_MS).toISOString();
}

// ── getCompletedCyclesThisWeek ─────────────────────────────────────────

describe('PomodoroStats.getCompletedCyclesThisWeek', () => {
  it('returns 0 with no sessions', async () => {
    setPomodoroSessions([]);
    assertEqual(await PomodoroStats.getCompletedCyclesThisWeek(), 0);
  });

  it('ignores non-pomodoro session types', async () => {
    setPomodoroSessions([
      { type: 'flow',     date: pomDateStr(0), completedCycles: 4 },
      { type: 'interval', date: pomDateStr(0), completedCycles: 4 },
      { type: 'cooking',  date: pomDateStr(0), completedCycles: 4 },
    ]);
    assertEqual(await PomodoroStats.getCompletedCyclesThisWeek(), 0);
  });

  it('sums completedCycles for pomodoro sessions today', async () => {
    setPomodoroSessions([
      { type: 'pomodoro', date: pomDateStr(0), completedCycles: 3 },
      { type: 'pomodoro', date: pomDateStr(0), completedCycles: 2 },
    ]);
    assertEqual(await PomodoroStats.getCompletedCyclesThisWeek(), 5);
  });

  it('excludes sessions from before the start of this week', async () => {
    // 8 days ago is guaranteed to be before this week's Sunday 00:00,
    // regardless of which day of the week the test runs.
    setPomodoroSessions([
      { type: 'pomodoro', date: pomDateStr(0), completedCycles: 4 },
      { type: 'pomodoro', date: pomDateStr(8), completedCycles: 99 },
    ]);
    assertEqual(await PomodoroStats.getCompletedCyclesThisWeek(), 4);
  });

  it('treats missing completedCycles as 0', async () => {
    setPomodoroSessions([
      { type: 'pomodoro', date: pomDateStr(0) }, // no completedCycles
      { type: 'pomodoro', date: pomDateStr(0), completedCycles: 2 },
    ]);
    assertEqual(await PomodoroStats.getCompletedCyclesThisWeek(), 2);
  });
});

// ── getTotalWorkMsThisWeek ─────────────────────────────────────────────

describe('PomodoroStats.getTotalWorkMsThisWeek', () => {
  it('returns 0 with no sessions', async () => {
    setPomodoroSessions([]);
    assertEqual(await PomodoroStats.getTotalWorkMsThisWeek(), 0);
  });

  it('ignores non-pomodoro session types', async () => {
    setPomodoroSessions([
      { type: 'flow',     date: pomDateStr(0), totalWorkMs: 5400000 },
      { type: 'interval', date: pomDateStr(0), totalWorkMs: 1200000 },
    ]);
    assertEqual(await PomodoroStats.getTotalWorkMsThisWeek(), 0);
  });

  it('sums totalWorkMs across pomodoro sessions today', async () => {
    setPomodoroSessions([
      { type: 'pomodoro', date: pomDateStr(0), totalWorkMs: 1500000 },
      { type: 'pomodoro', date: pomDateStr(0), totalWorkMs: 3000000 },
    ]);
    assertEqual(await PomodoroStats.getTotalWorkMsThisWeek(), 4500000);
  });

  it('falls back to duration when totalWorkMs is missing', async () => {
    setPomodoroSessions([
      { type: 'pomodoro', date: pomDateStr(0), duration: 1500000 },
    ]);
    assertEqual(await PomodoroStats.getTotalWorkMsThisWeek(), 1500000);
  });

  it('prefers totalWorkMs over duration when both are present', async () => {
    setPomodoroSessions([
      { type: 'pomodoro', date: pomDateStr(0), totalWorkMs: 1500000, duration: 9999999 },
    ]);
    assertEqual(await PomodoroStats.getTotalWorkMsThisWeek(), 1500000);
  });

  it('excludes sessions from before the start of this week', async () => {
    setPomodoroSessions([
      { type: 'pomodoro', date: pomDateStr(0), totalWorkMs: 1500000 },
      { type: 'pomodoro', date: pomDateStr(8), totalWorkMs: 9999999 },
    ]);
    assertEqual(await PomodoroStats.getTotalWorkMsThisWeek(), 1500000);
  });

  it('treats missing totalWorkMs and duration as 0', async () => {
    setPomodoroSessions([
      { type: 'pomodoro', date: pomDateStr(0) },
      { type: 'pomodoro', date: pomDateStr(0), totalWorkMs: 1000 },
    ]);
    assertEqual(await PomodoroStats.getTotalWorkMsThisWeek(), 1000);
  });
});

// ── getCurrentStreak ───────────────────────────────────────────────────

describe('PomodoroStats.getCurrentStreak', () => {
  it('returns 0 with no sessions', async () => {
    setPomodoroSessions([]);
    assertEqual(await PomodoroStats.getCurrentStreak(), 0);
  });

  it('returns 0 when no session has completedCycles >= 1', async () => {
    setPomodoroSessions([
      { type: 'pomodoro', date: pomDateStr(0), completedCycles: 0 },
      { type: 'pomodoro', date: pomDateStr(1) }, // missing
    ]);
    assertEqual(await PomodoroStats.getCurrentStreak(), 0);
  });

  it('counts a single completed session today as streak 1', async () => {
    setPomodoroSessions([
      { type: 'pomodoro', date: pomDateStr(0), completedCycles: 1 },
    ]);
    assertEqual(await PomodoroStats.getCurrentStreak(), 1);
  });

  it('still counts streak when latest activity was yesterday (not today)', async () => {
    setPomodoroSessions([
      { type: 'pomodoro', date: pomDateStr(1), completedCycles: 2 },
    ]);
    assertEqual(await PomodoroStats.getCurrentStreak(), 1);
  });

  it('returns 0 when latest activity was 2+ days ago', async () => {
    setPomodoroSessions([
      { type: 'pomodoro', date: pomDateStr(2), completedCycles: 4 },
      { type: 'pomodoro', date: pomDateStr(3), completedCycles: 4 },
    ]);
    assertEqual(await PomodoroStats.getCurrentStreak(), 0);
  });

  it('counts consecutive days as a multi-day streak', async () => {
    setPomodoroSessions([
      { type: 'pomodoro', date: pomDateStr(0), completedCycles: 1 },
      { type: 'pomodoro', date: pomDateStr(1), completedCycles: 1 },
      { type: 'pomodoro', date: pomDateStr(2), completedCycles: 1 },
    ]);
    assertEqual(await PomodoroStats.getCurrentStreak(), 3);
  });

  it('breaks the streak on a missing day', async () => {
    setPomodoroSessions([
      { type: 'pomodoro', date: pomDateStr(0), completedCycles: 1 },
      { type: 'pomodoro', date: pomDateStr(1), completedCycles: 1 },
      // gap at day 2
      { type: 'pomodoro', date: pomDateStr(3), completedCycles: 1 },
      { type: 'pomodoro', date: pomDateStr(4), completedCycles: 1 },
    ]);
    assertEqual(await PomodoroStats.getCurrentStreak(), 2);
  });

  it('treats multiple sessions on the same day as a single streak day', async () => {
    setPomodoroSessions([
      { type: 'pomodoro', date: pomDateStr(0), completedCycles: 1 },
      { type: 'pomodoro', date: pomDateStr(0), completedCycles: 1 },
      { type: 'pomodoro', date: pomDateStr(1), completedCycles: 1 },
    ]);
    assertEqual(await PomodoroStats.getCurrentStreak(), 2);
  });

  it('ignores sessions with zero completedCycles when building streak days', async () => {
    setPomodoroSessions([
      { type: 'pomodoro', date: pomDateStr(0), completedCycles: 1 },
      // day 1 only has a 0-cycle session — should break the streak
      { type: 'pomodoro', date: pomDateStr(1), completedCycles: 0 },
      { type: 'pomodoro', date: pomDateStr(2), completedCycles: 1 },
    ]);
    assertEqual(await PomodoroStats.getCurrentStreak(), 1);
  });

  it('ignores non-pomodoro session types', async () => {
    setPomodoroSessions([
      { type: 'flow',     date: pomDateStr(0), completedCycles: 5 },
      { type: 'interval', date: pomDateStr(1), completedCycles: 5 },
    ]);
    assertEqual(await PomodoroStats.getCurrentStreak(), 0);
  });
});

// ── getDailyMinutesThisWeek ────────────────────────────────────────────

describe('PomodoroStats.getDailyMinutesThisWeek', () => {
  it('returns exactly 7 entries', async () => {
    setPomodoroSessions([]);
    const r = await PomodoroStats.getDailyMinutesThisWeek();
    assertEqual(r.length, 7);
  });

  it('zeros every day when there are no sessions', async () => {
    setPomodoroSessions([]);
    const r = await PomodoroStats.getDailyMinutesThisWeek();
    for (const d of r) assertEqual(d.minutes, 0);
  });

  it('places today at the last index (newest at end)', async () => {
    setPomodoroSessions([
      { type: 'pomodoro', date: pomDateStr(0), totalWorkMs: 25 * 60000 },
    ]);
    const r = await PomodoroStats.getDailyMinutesThisWeek();
    assertEqual(r[6].minutes, 25);
    for (let i = 0; i < 6; i++) assertEqual(r[i].minutes, 0);
  });

  it('places a 3-days-ago session at index 3', async () => {
    setPomodoroSessions([
      { type: 'pomodoro', date: pomDateStr(3), totalWorkMs: 50 * 60000 },
    ]);
    const r = await PomodoroStats.getDailyMinutesThisWeek();
    assertEqual(r[3].minutes, 50);
  });

  it('aggregates multiple sessions on the same day', async () => {
    setPomodoroSessions([
      { type: 'pomodoro', date: pomDateStr(0), totalWorkMs: 25 * 60000 },
      { type: 'pomodoro', date: pomDateStr(0), totalWorkMs: 25 * 60000 },
      { type: 'pomodoro', date: pomDateStr(0), totalWorkMs: 10 * 60000 },
    ]);
    const r = await PomodoroStats.getDailyMinutesThisWeek();
    assertEqual(r[6].minutes, 60);
  });

  it('falls back to duration when totalWorkMs is missing', async () => {
    setPomodoroSessions([
      { type: 'pomodoro', date: pomDateStr(0), duration: 25 * 60000 },
    ]);
    const r = await PomodoroStats.getDailyMinutesThisWeek();
    assertEqual(r[6].minutes, 25);
  });

  it('rounds milliseconds to whole minutes', async () => {
    // 89 * 60000 + 30000 = 89.5 minutes → rounds to 90
    setPomodoroSessions([
      { type: 'pomodoro', date: pomDateStr(0), totalWorkMs: 89 * 60000 + 30000 },
    ]);
    const r = await PomodoroStats.getDailyMinutesThisWeek();
    assertEqual(r[6].minutes, 90);
  });

  it('ignores non-pomodoro session types', async () => {
    setPomodoroSessions([
      { type: 'flow',     date: pomDateStr(0), totalWorkMs: 5400000 },
      { type: 'interval', date: pomDateStr(0), totalWorkMs: 1200000 },
    ]);
    const r = await PomodoroStats.getDailyMinutesThisWeek();
    for (const d of r) assertEqual(d.minutes, 0);
  });

  it('ignores sessions older than 6 days', async () => {
    setPomodoroSessions([
      { type: 'pomodoro', date: pomDateStr(7), totalWorkMs: 60 * 60000 },
      { type: 'pomodoro', date: pomDateStr(10), totalWorkMs: 120 * 60000 },
    ]);
    const r = await PomodoroStats.getDailyMinutesThisWeek();
    for (const d of r) assertEqual(d.minutes, 0);
  });

  it('attaches a non-empty short-weekday label to each entry', async () => {
    setPomodoroSessions([]);
    const r = await PomodoroStats.getDailyMinutesThisWeek();
    for (const d of r) {
      assert(typeof d.label === 'string' && d.label.length > 0, 'label should be a non-empty string');
    }
  });
});

// Restore real History for any later code on the page.
window.History = _realHistoryForPomodoroStats;
