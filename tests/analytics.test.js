// Analytics engine tests.
//
// These scenarios were originally verified inline in the browser preview
// during each of PRs #25 / #26 / #27 / #28 / #29 / #30 / #31 as the
// features were built. They're ported here so the behavior is locked in
// against future refactors.
//
// Pattern: each test stubs `window.History` (and localStorage where
// relevant) with a known fixture, awaits the function under test, and
// asserts on the returned shape. The Analytics module itself is untouched;
// no engine changes needed to make these tests pass.

// ── Helpers ────────────────────────────────────────────────────────────

// Stash the real History binding so we can restore it after the suite in
// case anything else in the page needs it. In practice analytics tests
// run last in the index.html, but being polite is cheap.
const _realHistory = window.History;

// Build a Date at local midnight for `daysAgo` days in the past, optionally
// at a specific hour. Using local time (not UTC) matches how Analytics
// buckets sessions via `localDateKey(d)`.
function atHoursAgo(daysAgo, hour) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour == null ? 9 : hour, 30, 0, 0);
  return d.getTime();
}

// ISO-ish date string that History records use — the engine reads
// `new Date(s.date)` so any format Date can parse is fine.
function dateStr(daysAgo, hour) {
  return new Date(atHoursAgo(daysAgo, hour)).toISOString();
}

function setSessions(sessions) {
  window.History = {
    getSessions: async () => sessions,
  };
}

function clearBFRBStores() {
  localStorage.removeItem('flow_bfrbs');
  localStorage.removeItem('pomodoro_bfrbs');
  localStorage.removeItem('bfrbs_global');
}

function clearMedsStore() {
  localStorage.removeItem('wellness_meds');
}

// ── § G — Focus streak (PR #25) ────────────────────────────────────────

describe('Analytics.getFocusStreak — empty and baseline', () => {
  it('returns zeroed state with no sessions', async () => {
    setSessions([]);
    const r = await Analytics.getFocusStreak();
    assertEqual(r.current, 0);
    assertEqual(r.longest, 0);
    assertEqual(r.activeToday, false);
    assertEqual(r.recent7.length, 7);
  });

  it('recent7 is ordered newest-first with today at index 0', async () => {
    setSessions([]);
    const r = await Analytics.getFocusStreak();
    assertEqual(r.recent7[0].isToday, true);
    for (let i = 1; i < 7; i++) {
      assertEqual(r.recent7[i].isToday, false);
    }
  });
});

describe('Analytics.getFocusStreak — current & longest', () => {
  it('counts today + yesterday + 2 days ago as a 3-day active streak', async () => {
    setSessions([
      { type: 'flow',     date: dateStr(0, 14), duration: 5400000 },
      { type: 'pomodoro', date: dateStr(1, 10), duration: 1500000 },
      { type: 'flow',     date: dateStr(2, 14), duration: 5400000 },
    ]);
    const r = await Analytics.getFocusStreak();
    assertEqual(r.current, 3);
    assertEqual(r.longest, 3);
    assertEqual(r.activeToday, true);
  });

  it('1-day grace: yesterday-only session keeps streak alive, activeToday false', async () => {
    setSessions([
      { type: 'flow', date: dateStr(1, 10), duration: 5400000 },
    ]);
    const r = await Analytics.getFocusStreak();
    assertEqual(r.current, 1);
    assertEqual(r.activeToday, false);
  });

  it('gap of 2+ days resets current to 0 but preserves longest', async () => {
    setSessions([
      { type: 'flow', date: dateStr(2, 10), duration: 5400000 },
      { type: 'flow', date: dateStr(3, 10), duration: 5400000 },
      { type: 'flow', date: dateStr(4, 10), duration: 5400000 },
    ]);
    const r = await Analytics.getFocusStreak();
    assertEqual(r.current, 0);
    assertEqual(r.longest, 3);
  });

  it('ignores non-focus session types (stopwatch / timer / cooking)', async () => {
    setSessions([
      { type: 'stopwatch', date: dateStr(0), duration: 60000 },
      { type: 'timer',     date: dateStr(1), duration: 60000 },
      { type: 'cooking',   date: dateStr(2), duration: 60000 },
    ]);
    const r = await Analytics.getFocusStreak();
    assertEqual(r.current, 0);
    assertEqual(r.longest, 0);
  });

  it('5-day current run + 3-day orphan run: longest reflects current', async () => {
    setSessions([
      { type: 'flow',     date: dateStr(0) }, { type: 'flow', date: dateStr(1) },
      { type: 'pomodoro', date: dateStr(2) }, { type: 'flow', date: dateStr(3) },
      { type: 'pomodoro', date: dateStr(4) },
      { type: 'flow', date: dateStr(10) }, { type: 'flow', date: dateStr(11) },
      { type: 'flow', date: dateStr(12) },
    ]);
    const r = await Analytics.getFocusStreak();
    assertEqual(r.current, 5);
    assertEqual(r.longest, 5);
    assertEqual(r.activeToday, true);
  });
});

// ── § D — Flow completion rate (PR #26) ────────────────────────────────

describe('Analytics.getFlowCompletion', () => {
  const H = 3600000; // 1 hour in ms

  it('returns total:0 when no flow sessions exist', async () => {
    setSessions([{ type: 'pomodoro', date: dateStr(0), duration: H }]);
    const r = await Analytics.getFlowCompletion();
    assertEqual(r.total, 0);
    assertEqual(r.completed, 0);
    assertEqual(r.endedEarly, 0);
    assertEqual(r.completionRate, 0);
  });

  it('counts all 3 flow blocks as completed when none have endedEarly set', async () => {
    setSessions([
      { type: 'flow', date: dateStr(0), duration: 1.5 * H, blockDurationMs: 1.5 * H },
      { type: 'flow', date: dateStr(1), duration: 1.5 * H, blockDurationMs: 1.5 * H },
      { type: 'flow', date: dateStr(2), duration: 1.5 * H, blockDurationMs: 1.5 * H },
    ]);
    const r = await Analytics.getFlowCompletion();
    assertEqual(r.total, 3);
    assertEqual(r.completed, 3);
    assertEqual(r.endedEarly, 0);
    assertEqual(r.completionRate, 1);
    assertClose(r.avgDurationPct, 1, 0.001);
  });

  it('2 done + 1 early-at-50%: 67% rate, 83.3% avg', async () => {
    setSessions([
      { type: 'flow', date: dateStr(0), duration: 1.5 * H, blockDurationMs: 1.5 * H },
      { type: 'flow', date: dateStr(1), duration: 1.5 * H, blockDurationMs: 1.5 * H },
      { type: 'flow', date: dateStr(2), duration: 0.75 * H, blockDurationMs: 1.5 * H, endedEarly: true },
    ]);
    const r = await Analytics.getFlowCompletion();
    assertClose(r.completionRate, 2 / 3, 0.01);
    assertClose(r.avgDurationPct, (1 + 1 + 0.5) / 3, 0.01);
    assertEqual(r.endedEarly, 1);
  });

  it('legacy session without blockDurationMs is counted in totals but skipped from avg', async () => {
    setSessions([
      // legacy: completed (history only saved it because it finished), no blockDurationMs
      { type: 'flow', date: dateStr(0), duration: 1.5 * H },
      // new: ended early at 1/3 of planned
      { type: 'flow', date: dateStr(1), duration: 0.5 * H, blockDurationMs: 1.5 * H, endedEarly: true },
    ]);
    const r = await Analytics.getFlowCompletion();
    assertEqual(r.total, 2);
    assertEqual(r.completed, 1);
    assertEqual(r.endedEarly, 1);
    // Legacy session has no blockDurationMs so it's skipped from pct calc.
    // Only the ended-early session contributes: 0.5 / 1.5 = 0.333...
    assertClose(r.avgDurationPct, 1 / 3, 0.01);
  });

  it('all ended-early: 0% completion rate', async () => {
    setSessions([
      { type: 'flow', date: dateStr(0), duration: 0.3 * H, blockDurationMs: 1.5 * H, endedEarly: true },
      { type: 'flow', date: dateStr(1), duration: 0.7 * H, blockDurationMs: 1.5 * H, endedEarly: true },
    ]);
    const r = await Analytics.getFlowCompletion();
    assertEqual(r.completed, 0);
    assertEqual(r.completionRate, 0);
  });

  it('ignores pomodoro sessions when counting flow completion', async () => {
    setSessions([
      { type: 'flow',     date: dateStr(0), duration: 1.5 * H, blockDurationMs: 1.5 * H },
      { type: 'pomodoro', date: dateStr(1), duration: H },
      { type: 'pomodoro', date: dateStr(2), duration: H },
    ]);
    const r = await Analytics.getFlowCompletion();
    assertEqual(r.total, 1);
    assertEqual(r.completionRate, 1);
  });
});

// ── § E + F — Distractions (PR #27) ────────────────────────────────────

describe('Analytics.getDistractions — aggregation & filtering', () => {
  it('returns empty state with no distractions logged anywhere', async () => {
    setSessions([]);
    const r = await Analytics.getDistractions();
    assertEqual(r.total, 0);
    assertArrayEqual(r.top5, []);
    assertEqual(r.hourly.length, 24);
    assertEqual(r.hourly.every(c => c === 0), true);
  });

  it('sessions without distractions[] or with non-focus types are ignored', async () => {
    setSessions([
      { type: 'pomodoro', date: dateStr(0), duration: 1500000 },
      { type: 'stopwatch', date: dateStr(0), distractions: [{ category: 'phone', timestamp: atHoursAgo(0, 9) }] },
    ]);
    const r = await Analytics.getDistractions();
    assertEqual(r.total, 0);
  });

  it('single-pomodoro 4 catches: correct top5 split + hour buckets', async () => {
    setSessions([{
      type: 'pomodoro',
      date: dateStr(0),
      distractions: [
        { category: 'phone', timestamp: atHoursAgo(0, 9) },
        { category: 'phone', timestamp: atHoursAgo(0, 14) },
        { category: 'phone', timestamp: atHoursAgo(0, 16) },
        { category: 'email', timestamp: atHoursAgo(0, 9) },
      ],
    }]);
    const r = await Analytics.getDistractions();
    assertEqual(r.total, 4);
    assertEqual(r.top5.length, 2);
    assertEqual(r.top5[0].category, 'phone');
    assertEqual(r.top5[0].pomodoro, 3);
    assertEqual(r.top5[0].flow, 0);
    assertEqual(r.top5[1].category, 'email');
    // Hourly buckets use local-time getHours()
    assertEqual(r.hourly[9], 2);
    assertEqual(r.hourly[14], 1);
    assertEqual(r.hourly[16], 1);
  });

  it('mixed flow + pomodoro: split preserved, hours aggregated', async () => {
    setSessions([
      { type: 'flow', date: dateStr(0), distractions: [
        { category: 'phone', timestamp: atHoursAgo(0, 10) },
        { category: 'interrupted', timestamp: atHoursAgo(0, 14) },
      ]},
      { type: 'pomodoro', date: dateStr(0), distractions: [
        { category: 'phone', timestamp: atHoursAgo(0, 10) },
        { category: 'phone', timestamp: atHoursAgo(0, 14) },
        { category: 'email', timestamp: atHoursAgo(0, 11) },
      ]},
    ]);
    const r = await Analytics.getDistractions();
    assertEqual(r.total, 5);
    assertEqual(r.top5[0].category, 'phone');
    assertEqual(r.top5[0].total, 3);
    assertEqual(r.top5[0].flow, 1);
    assertEqual(r.top5[0].pomodoro, 2);
    assertEqual(r.hourly[10], 2);
    assertEqual(r.hourly[14], 2);
  });

  it('top5 caps at 5 even with 6+ unique categories', async () => {
    setSessions([{
      type: 'flow', date: dateStr(0),
      distractions: [
        { category: 'phone', timestamp: atHoursAgo(0, 8) },
        { category: 'phone', timestamp: atHoursAgo(0, 8) },
        { category: 'phone', timestamp: atHoursAgo(0, 8) },
        { category: 'email', timestamp: atHoursAgo(0, 9) },
        { category: 'email', timestamp: atHoursAgo(0, 9) },
        { category: 'interrupted', timestamp: atHoursAgo(0, 10) },
        { category: 'self', timestamp: atHoursAgo(0, 11) },
        { category: 'other', timestamp: atHoursAgo(0, 12) },
        { category: 'custom1', timestamp: atHoursAgo(0, 13) },
      ],
    }]);
    const r = await Analytics.getDistractions();
    assertEqual(r.top5.length, 5);
    assertEqual(r.top5.map(x => x.category).includes('custom1'), false);
  });
});

// ── § A — BFRB trend (PR #28) + § B+C extensions (PR #30) ──────────────

describe('Analytics.getBFRBTrend — empty + shape', () => {
  it('empty state: 30-day series of zeros, total 0, rate 0', async () => {
    setSessions([]);
    clearBFRBStores();
    const r = await Analytics.getBFRBTrend(30);
    assertEqual(r.total, 0);
    assertEqual(r.series.length, 30);
    assertEqual(r.series.every(d => d.count === 0), true);
    assertEqual(r.focusHours, 0);
    assertEqual(r.ratePerHour, 0);
    assertEqual(r.hourly.length, 24);
    assertEqual(r.hourly.every(c => c === 0), true);
    assertEqual(r.bySource.flow, 0);
    assertEqual(r.bySource.pomodoro, 0);
    assertEqual(r.bySource.idle, 0);
  });

  it('series length matches requested window (14 / 30 / 90)', async () => {
    setSessions([]);
    clearBFRBStores();
    const r14 = await Analytics.getBFRBTrend(14);
    const r90 = await Analytics.getBFRBTrend(90);
    assertEqual(r14.series.length, 14);
    assertEqual(r90.series.length, 90);
  });
});

describe('Analytics.getBFRBTrend — merge across stores', () => {
  it('sums catches from session history bfrbs[] only', async () => {
    clearBFRBStores();
    setSessions([
      { type: 'flow', date: dateStr(2), duration: 5400000, bfrbs: [
        { timestamp: atHoursAgo(2, 14) },
        { timestamp: atHoursAgo(2, 15) },
      ]},
      { type: 'pomodoro', date: dateStr(5), duration: 1500000, bfrbs: [
        { timestamp: atHoursAgo(5, 10) },
      ]},
    ]);
    const r = await Analytics.getBFRBTrend(30);
    assertEqual(r.total, 3);
    // Focus hours: 1.5h (flow) + 0.416h (pomodoro 25min) = 1.916h
    assertClose(r.focusHours, 1.9167, 0.01);
    assertClose(r.ratePerHour, 3 / 1.9167, 0.1);
  });

  it('localStorage-only catches are counted (no focus hours)', async () => {
    setSessions([]);
    clearBFRBStores();
    localStorage.setItem('flow_bfrbs', JSON.stringify([
      { timestamp: atHoursAgo(0, 9) }, { timestamp: atHoursAgo(0, 10) },
    ]));
    localStorage.setItem('bfrbs_global', JSON.stringify([
      { timestamp: atHoursAgo(1, 8) },
    ]));
    const r = await Analytics.getBFRBTrend(30);
    assertEqual(r.total, 3);
    assertEqual(r.focusHours, 0);
    assertEqual(r.ratePerHour, 0);
  });

  it('all 4 sources merge: 2 history + 1 flow_bfrbs + 1 pomodoro_bfrbs + 1 global = 5 total', async () => {
    clearBFRBStores();
    setSessions([
      { type: 'flow', date: dateStr(3), duration: 5400000, bfrbs: [{ timestamp: atHoursAgo(3, 14) }] },
      { type: 'pomodoro', date: dateStr(6), duration: 1500000, bfrbs: [{ timestamp: atHoursAgo(6, 10) }] },
    ]);
    localStorage.setItem('flow_bfrbs', JSON.stringify([{ timestamp: atHoursAgo(0, 9) }]));
    localStorage.setItem('pomodoro_bfrbs', JSON.stringify([{ timestamp: atHoursAgo(0, 11) }]));
    localStorage.setItem('bfrbs_global', JSON.stringify([{ timestamp: atHoursAgo(1, 12) }]));
    const r = await Analytics.getBFRBTrend(30);
    assertEqual(r.total, 5);
  });

  it('stamps older than window are dropped', async () => {
    clearBFRBStores();
    setSessions([
      { type: 'flow', date: dateStr(40), duration: 5400000, bfrbs: [{ timestamp: atHoursAgo(40, 14) }] },
      { type: 'flow', date: dateStr(3),  duration: 5400000, bfrbs: [{ timestamp: atHoursAgo(3, 14) }] },
    ]);
    const r = await Analytics.getBFRBTrend(30);
    assertEqual(r.total, 1);
  });

  it('rate math: 5 catches / 2.5 focus-hours = 2.0/hr', async () => {
    clearBFRBStores();
    setSessions([
      { type: 'flow', date: dateStr(2), duration: 2.5 * 3600000, bfrbs: [
        { timestamp: atHoursAgo(2, 14) }, { timestamp: atHoursAgo(2, 15) },
        { timestamp: atHoursAgo(2, 16) }, { timestamp: atHoursAgo(2, 17) },
        { timestamp: atHoursAgo(2, 18) },
      ]},
    ]);
    const r = await Analytics.getBFRBTrend(30);
    assertEqual(r.total, 5);
    assertEqual(r.focusHours, 2.5);
    assertEqual(r.ratePerHour, 2);
  });
});

describe('Analytics.getBFRBTrend — hourly (§ B) + bySource (§ C)', () => {
  it('hourly histogram buckets by local getHours()', async () => {
    clearBFRBStores();
    setSessions([]);
    localStorage.setItem('bfrbs_global', JSON.stringify([
      { timestamp: atHoursAgo(1, 9) }, { timestamp: atHoursAgo(1, 9) },
      { timestamp: atHoursAgo(2, 14) }, { timestamp: atHoursAgo(3, 14) },
      { timestamp: atHoursAgo(3, 14) }, { timestamp: atHoursAgo(3, 14) },
      { timestamp: atHoursAgo(4, 22) },
    ]));
    const r = await Analytics.getBFRBTrend(30);
    assertEqual(r.total, 7);
    assertEqual(r.hourly[9], 2);
    assertEqual(r.hourly[14], 4);
    assertEqual(r.hourly[22], 1);
  });

  it('bySource attributes history records by session.type, localStorage keys by store name', async () => {
    clearBFRBStores();
    setSessions([
      { type: 'flow', date: dateStr(2), duration: 5400000, bfrbs: [
        { timestamp: atHoursAgo(2, 10) }, { timestamp: atHoursAgo(2, 11) }, { timestamp: atHoursAgo(2, 12) },
      ]},
      { type: 'pomodoro', date: dateStr(5), duration: 1500000, bfrbs: [
        { timestamp: atHoursAgo(5, 14) }, { timestamp: atHoursAgo(5, 15) },
      ]},
    ]);
    localStorage.setItem('flow_bfrbs',     JSON.stringify([{ timestamp: atHoursAgo(0, 9) }]));
    localStorage.setItem('pomodoro_bfrbs', JSON.stringify([{ timestamp: atHoursAgo(0, 11) }]));
    localStorage.setItem('bfrbs_global',   JSON.stringify([
      { timestamp: atHoursAgo(1, 18) }, { timestamp: atHoursAgo(1, 19) },
      { timestamp: atHoursAgo(3, 20) }, { timestamp: atHoursAgo(4, 21) },
    ]));
    const r = await Analytics.getBFRBTrend(30);
    assertEqual(r.total, 11);
    assertEqual(r.bySource.flow, 4);     // 3 history + 1 flow_bfrbs
    assertEqual(r.bySource.pomodoro, 3); // 2 history + 1 pomodoro_bfrbs
    assertEqual(r.bySource.idle, 4);     // 4 bfrbs_global
  });
});

// ── § H — Med adherence (PR #29) ───────────────────────────────────────

describe('Analytics.getMedAdherence', () => {
  it('returns empty when localStorage has no meds state', async () => {
    clearMedsStore();
    const r = await Analytics.getMedAdherence(30);
    assertEqual(r.meds.length, 0);
  });

  it('as-needed meds are filtered out — no adherence concept', async () => {
    localStorage.setItem('wellness_meds', JSON.stringify({ meds: [
      { id: 'a', name: 'Advil', frequency: 'as-needed',
        doseLog: [{ takenAt: atHoursAgo(0, 10) }] },
    ]}));
    const r = await Analytics.getMedAdherence(30);
    assertEqual(r.meds.length, 0);
  });

  it('once-daily perfect 30-day log = 100%, all dots full', async () => {
    const log = [];
    for (let i = 0; i < 30; i++) log.push({ takenAt: atHoursAgo(i, 9) });
    localStorage.setItem('wellness_meds', JSON.stringify({ meds: [
      { id: 'v', name: 'Vyvanse', frequency: 'once-daily', doseLog: log },
    ]}));
    const r = await Analytics.getMedAdherence(30);
    assertEqual(r.meds[0].adherencePct, 100);
    assertEqual(r.meds[0].dots.every(d => d.status === 'full'), true);
  });

  it('twice-daily perfect 30-day log (60 doses) = 100%', async () => {
    const log = [];
    for (let i = 0; i < 30; i++) {
      log.push({ takenAt: atHoursAgo(i, 9) });
      log.push({ takenAt: atHoursAgo(i, 21) });
    }
    localStorage.setItem('wellness_meds', JSON.stringify({ meds: [
      { id: 's', name: 'Strattera', frequency: 'twice-daily', doseLog: log },
    ]}));
    const r = await Analytics.getMedAdherence(30);
    assertEqual(r.meds[0].adherencePct, 100);
    assertEqual(r.meds[0].dots.every(d => d.status === 'full'), true);
  });

  it('once-daily with 3 missed days = 90%', async () => {
    const log = [];
    for (let i = 0; i < 30; i++) {
      if (i === 5 || i === 14 || i === 22) continue;
      log.push({ takenAt: atHoursAgo(i, 9) });
    }
    localStorage.setItem('wellness_meds', JSON.stringify({ meds: [
      { id: 'v', name: 'Vyvanse', frequency: 'once-daily', doseLog: log },
    ]}));
    const r = await Analytics.getMedAdherence(30);
    assertEqual(r.meds[0].adherencePct, 90);
    assertEqual(r.meds[0].dots.filter(d => d.status === 'missed').length, 3);
  });

  it('twice-daily with 5 partial days = 92% (round((25 + 5*0.5)/30 * 100))', async () => {
    const log = [];
    for (let i = 0; i < 30; i++) {
      log.push({ takenAt: atHoursAgo(i, 9) });
      if (!(i === 3 || i === 7 || i === 11 || i === 15 || i === 19)) {
        log.push({ takenAt: atHoursAgo(i, 21) });
      }
    }
    localStorage.setItem('wellness_meds', JSON.stringify({ meds: [
      { id: 's', name: 'Strattera', frequency: 'twice-daily', doseLog: log },
    ]}));
    const r = await Analytics.getMedAdherence(30);
    assertEqual(r.meds[0].adherencePct, 92);
    assertEqual(r.meds[0].dots.filter(d => d.status === 'partial').length, 5);
    assertEqual(r.meds[0].dots.filter(d => d.status === 'full').length, 25);
  });

  it('doses outside 30-day window are excluded', async () => {
    localStorage.setItem('wellness_meds', JSON.stringify({ meds: [
      { id: 'v', name: 'Old', frequency: 'once-daily', doseLog: [
        { takenAt: atHoursAgo(45, 9) },
        { takenAt: atHoursAgo(60, 9) },
        { takenAt: atHoursAgo(5, 9) },
      ]},
    ]}));
    const r = await Analytics.getMedAdherence(30);
    // Only 1 in-window dose → 1/30 ≈ 3%
    assertEqual(r.meds[0].adherencePct, 3);
  });
});

// ── § I — Actual-work log (PR #31) ─────────────────────────────────────

describe('Analytics.getActualWork', () => {
  it('returns empty state with no pomodoro actualWork entries', async () => {
    setSessions([]);
    const r = await Analytics.getActualWork(7);
    assertEqual(r.total, 0);
    assertArrayEqual(r.top10, []);
  });

  it('aggregates across sessions (case-insensitive), filters window + type', async () => {
    setSessions([
      { type: 'pomodoro', date: dateStr(1),
        actualWork: ['Email inbox', 'Fix bug #42', 'email inbox'] },
      { type: 'pomodoro', date: dateStr(3),
        actualWork: ['Email inbox', 'Refactor tests'] },
      // Out of window — default 7 days
      { type: 'pomodoro', date: dateStr(9), actualWork: ['Out of window'] },
      // Wrong type — ignored even with actualWork[]
      { type: 'flow', date: dateStr(1), actualWork: ['Ignored'] },
    ]);
    const r = await Analytics.getActualWork(7);
    assertEqual(r.total, 5);
    assertEqual(r.top10[0].display, 'Email inbox');
    assertEqual(r.top10[0].count, 3);
    assertEqual(r.top10.length, 3);
    assertEqual(r.top10.some(e => e.display === 'Out of window'), false);
    assertEqual(r.top10.some(e => e.display === 'Ignored'), false);
  });

  it('top10 caps at 10', async () => {
    const big = [];
    for (let i = 0; i < 15; i++) big.push('Task ' + i);
    setSessions([
      { type: 'pomodoro', date: dateStr(1), actualWork: big },
    ]);
    const r = await Analytics.getActualWork(7);
    assertEqual(r.total, 15);
    assertEqual(r.top10.length, 10);
  });

  it('whitespace normalized: multi-space + different casings collapse to one row', async () => {
    setSessions([
      { type: 'pomodoro', date: dateStr(1), actualWork: [
        'Hello   world', '  hello world', 'Hello World',
      ]},
    ]);
    const r = await Analytics.getActualWork(7);
    assertEqual(r.total, 3);
    assertEqual(r.top10.length, 1);
    assertEqual(r.top10[0].display, 'Hello world');
    assertEqual(r.top10[0].count, 3);
  });
});

// ── § J — Phase restarts (PR #31) ──────────────────────────────────────

describe('Analytics.getPhaseRestarts', () => {
  it('returns zero totals with no pomodoro phaseLog entries', async () => {
    setSessions([]);
    const r = await Analytics.getPhaseRestarts(30);
    assertEqual(r.total, 0);
    assertEqual(r.byPhase.work, 0);
    assertEqual(r.byPhase.shortBreak, 0);
    assertEqual(r.byPhase.longBreak, 0);
  });

  it('only counts entries with restarted === true, bucketed by phase', async () => {
    setSessions([
      { type: 'pomodoro', date: dateStr(2), phaseLog: [
        { phase: 'work', restarted: true },
        { phase: 'shortBreak', restarted: true },
        { phase: 'shortBreak' },               // not restarted
        { phase: 'longBreak', restarted: true },
        { phase: 'work', restarted: true },
      ]},
    ]);
    const r = await Analytics.getPhaseRestarts(30);
    assertEqual(r.total, 4);
    assertEqual(r.byPhase.work, 2);
    assertEqual(r.byPhase.shortBreak, 1);
    assertEqual(r.byPhase.longBreak, 1);
  });

  it('ignores restarts outside the window', async () => {
    setSessions([
      { type: 'pomodoro', date: dateStr(50), phaseLog: [
        { phase: 'work', restarted: true },
      ]},
    ]);
    const r = await Analytics.getPhaseRestarts(30);
    assertEqual(r.total, 0);
  });
});

// ── Pre-existing analytics — getTotalTimeByMode ────────────────────────

describe('Analytics.getTotalTimeByMode', () => {
  it('returns an empty object with no sessions', async () => {
    setSessions([]);
    const r = await Analytics.getTotalTimeByMode();
    assertEqual(Object.keys(r).length, 0);
  });

  it('sums duration per mode across sessions', async () => {
    setSessions([
      { type: 'stopwatch', date: dateStr(0), duration: 60000 },
      { type: 'stopwatch', date: dateStr(1), duration: 120000 },
      { type: 'timer', date: dateStr(0), duration: 300000 },
      { type: 'pomodoro', date: dateStr(0), duration: 1500000 },
    ]);
    const r = await Analytics.getTotalTimeByMode();
    assertEqual(r.stopwatch, 180000);
    assertEqual(r.timer, 300000);
    assertEqual(r.pomodoro, 1500000);
  });

  it('defaults missing type to "stopwatch"', async () => {
    setSessions([
      { date: dateStr(0), duration: 5000 },
      { type: 'stopwatch', date: dateStr(1), duration: 3000 },
    ]);
    const r = await Analytics.getTotalTimeByMode();
    assertEqual(r.stopwatch, 8000);
  });

  it('handles sessions with 0 or missing duration', async () => {
    setSessions([
      { type: 'flow', date: dateStr(0), duration: 0 },
      { type: 'flow', date: dateStr(1) }, // no duration
      { type: 'flow', date: dateStr(2), duration: 5400000 },
    ]);
    const r = await Analytics.getTotalTimeByMode();
    assertEqual(r.flow, 5400000);
  });
});

// ── Pre-existing analytics — getWeeklyTotals ───────────────────────────

describe('Analytics.getWeeklyTotals', () => {
  it('returns requested number of week buckets, newest last', async () => {
    setSessions([]);
    const r = await Analytics.getWeeklyTotals(8);
    assertEqual(r.length, 8);
    // Every bucket should have a label and a totals object
    assertEqual(typeof r[0].label, 'string');
    assertEqual(typeof r[0].totals, 'object');
    assertEqual(Object.keys(r[7].totals).length, 0);
  });

  it('supports custom weekCount', async () => {
    setSessions([]);
    const r4 = await Analytics.getWeeklyTotals(4);
    const r12 = await Analytics.getWeeklyTotals(12);
    assertEqual(r4.length, 4);
    assertEqual(r12.length, 12);
  });

  it('puts a today-dated session into the most-recent week (index n-1)', async () => {
    setSessions([
      { type: 'flow', date: dateStr(0, 12), duration: 5400000 },
    ]);
    const r = await Analytics.getWeeklyTotals(8);
    const currentWeek = r[r.length - 1];
    assertEqual(currentWeek.totals.flow, 5400000);
    // Older weeks are empty
    assertEqual(Object.keys(r[0].totals).length, 0);
  });

  it('a session from ~8 weeks ago is excluded from an 8-week window', async () => {
    // 60 days ago is well outside an 8-week window (56 days)
    setSessions([
      { type: 'flow', date: dateStr(60, 12), duration: 5400000 },
    ]);
    const r = await Analytics.getWeeklyTotals(8);
    const totalMs = r.reduce((sum, week) => {
      return sum + Object.values(week.totals).reduce((a, b) => a + b, 0);
    }, 0);
    assertEqual(totalMs, 0);
  });
});

// ── Pre-existing analytics — getActivityHeatmap ────────────────────────

describe('Analytics.getActivityHeatmap', () => {
  it('returns weeks*7 day buckets in chronological order', async () => {
    setSessions([]);
    const r = await Analytics.getActivityHeatmap(26);
    assertEqual(r.length, 26 * 7);
    // Each entry has the expected shape
    assertEqual(typeof r[0].date, 'string');
    assertEqual(typeof r[0].dayOfWeek, 'number');
    assertEqual(r[0].count, 0);
    assertEqual(r[0].totalMs, 0);
  });

  it('supports custom weekCount', async () => {
    setSessions([]);
    const r = await Analytics.getActivityHeatmap(4);
    assertEqual(r.length, 4 * 7);
  });

  it('buckets a today-dated session into the last entry', async () => {
    setSessions([
      { type: 'flow', date: dateStr(0, 12), duration: 5400000 },
    ]);
    const r = await Analytics.getActivityHeatmap(4);
    const last = r[r.length - 1];
    // getActivityHeatmap uses UTC-based getDateStr; use midday (hour 12) so
    // the UTC and local day agree in any typical timezone.
    assertEqual(last.count, 1);
    assertEqual(last.totalMs, 5400000);
  });

  it('aggregates multiple sessions on the same day', async () => {
    setSessions([
      { type: 'flow',  date: dateStr(0, 10), duration: 5400000 },
      { type: 'flow',  date: dateStr(0, 14), duration: 5400000 },
      { type: 'timer', date: dateStr(0, 16), duration: 300000 },
    ]);
    const r = await Analytics.getActivityHeatmap(4);
    const last = r[r.length - 1];
    assertEqual(last.count, 3);
    assertEqual(last.totalMs, 5400000 + 5400000 + 300000);
  });

  it('dayOfWeek is an integer in [0, 6]', async () => {
    setSessions([]);
    const r = await Analytics.getActivityHeatmap(4);
    assert(r.every(d => Number.isInteger(d.dayOfWeek) && d.dayOfWeek >= 0 && d.dayOfWeek <= 6));
  });
});

// ── Pre-existing analytics — getPersonalBests ──────────────────────────

describe('Analytics.getPersonalBests', () => {
  it('returns null when no sessions exist', async () => {
    setSessions([]);
    const r = await Analytics.getPersonalBests();
    assertEqual(r, null);
  });

  it('totalSessions + totalTimeMs reflect every session', async () => {
    setSessions([
      { type: 'stopwatch', date: dateStr(0), duration: 1000 },
      { type: 'flow',      date: dateStr(1), duration: 5400000 },
      { type: 'pomodoro',  date: dateStr(2), duration: 1500000 },
    ]);
    const r = await Analytics.getPersonalBests();
    assertEqual(r.totalSessions, 3);
    assertEqual(r.totalTimeMs, 1000 + 5400000 + 1500000);
  });

  it('longestSession points at the session with max duration', async () => {
    setSessions([
      { id: 1, type: 'stopwatch', date: dateStr(0), duration: 1000 },
      { id: 2, type: 'flow',      date: dateStr(1), duration: 7200000 },  // 2 hr
      { id: 3, type: 'flow',      date: dateStr(2), duration: 5400000 },  // 1.5 hr
    ]);
    const r = await Analytics.getPersonalBests();
    assertEqual(r.longestSession.id, 2);
    assertEqual(r.longestSession.duration, 7200000);
  });

  it('mostLaps is null when no session has a non-empty laps[]', async () => {
    setSessions([
      { id: 1, type: 'stopwatch', date: dateStr(0), duration: 1000, laps: [] },
      { id: 2, type: 'flow', date: dateStr(1), duration: 5400000 },
    ]);
    const r = await Analytics.getPersonalBests();
    assertEqual(r.mostLaps, null);
  });

  it('mostLaps points at the session with the largest laps array', async () => {
    setSessions([
      { id: 1, type: 'stopwatch', date: dateStr(0), duration: 5000, laps: [{}, {}] },
      { id: 2, type: 'stopwatch', date: dateStr(1), duration: 9000, laps: [{}, {}, {}, {}, {}] },
      { id: 3, type: 'stopwatch', date: dateStr(2), duration: 3000, laps: [{}] },
    ]);
    const r = await Analytics.getPersonalBests();
    assertEqual(r.mostLaps.id, 2);
    assertEqual(r.mostLaps.laps.length, 5);
  });

  it('handles sessions with missing duration gracefully', async () => {
    setSessions([
      { id: 1, type: 'flow', date: dateStr(0) },        // no duration
      { id: 2, type: 'flow', date: dateStr(1), duration: 3600000 },
    ]);
    const r = await Analytics.getPersonalBests();
    assertEqual(r.totalTimeMs, 3600000);
    assertEqual(r.longestSession.id, 2);
  });
});

// ── Pre-existing analytics — getTrends ─────────────────────────────────

describe('Analytics.getTrends', () => {
  it('returns zeros with no sessions', async () => {
    setSessions([]);
    const r = await Analytics.getTrends();
    assertEqual(r.thisWeek.totalMs, 0);
    assertEqual(r.thisWeek.count, 0);
    assertEqual(r.lastWeek.totalMs, 0);
    assertEqual(r.lastWeek.count, 0);
  });

  it('a session dated now counts toward thisWeek', async () => {
    setSessions([
      { type: 'flow', date: new Date().toISOString(), duration: 5400000 },
    ]);
    const r = await Analytics.getTrends();
    assertEqual(r.thisWeek.count, 1);
    assertEqual(r.thisWeek.totalMs, 5400000);
  });

  it('a session 30+ days ago falls outside both windows', async () => {
    // Sunday-anchored weeks: 30 days back is 2+ weeks ago guaranteed
    setSessions([
      { type: 'flow', date: dateStr(30), duration: 5400000 },
    ]);
    const r = await Analytics.getTrends();
    assertEqual(r.thisWeek.count, 0);
    assertEqual(r.lastWeek.count, 0);
  });

  it('sums across multiple current-week sessions', async () => {
    const now = Date.now();
    setSessions([
      { type: 'flow',  date: new Date(now).toISOString(),             duration: 5400000 },
      { type: 'flow',  date: new Date(now - 1 * 3600000).toISOString(), duration: 7200000 },
      { type: 'timer', date: new Date(now - 2 * 3600000).toISOString(), duration: 300000 },
    ]);
    const r = await Analytics.getTrends();
    assertEqual(r.thisWeek.count, 3);
    assertEqual(r.thisWeek.totalMs, 5400000 + 7200000 + 300000);
  });
});

// ── Cleanup ────────────────────────────────────────────────────────────

describe('Analytics tests — cleanup', () => {
  it('restores real History + clears test fixtures', () => {
    window.History = _realHistory;
    clearBFRBStores();
    clearMedsStore();
  });
});
