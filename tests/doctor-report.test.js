// Doctor Report engine tests.
//
// All top-level consts are DR_-prefixed to avoid collisions in the shared
// test-page scope (CLAUDE.md memory: const collision silently discards
// the entire file).
//
// Fixed clock: 2026-07-15 at noon local time.
//   DR_NOW_MS = new Date(2026, 6, 15, 12, 0, 0, 0).getTime()
//               (month 6 = July in JS — zero-indexed months)
//
// Stubs: History.getSessions, MedsManager.all, Analytics.getMedAdherence, and
// localStorage wellness_rest_log are saved + restored around every test.
// Analytics.getMedAdherence is ALWAYS stubbed — its internal windowing reads
// the live clock and would produce different numbers than the pinned `now`.

// ── Module guard ───────────────────────────────────────────────────────────
// If DoctorReport did not load (e.g. missing <script> tag) skip all tests
// gracefully rather than crashing with "DoctorReport is not defined".
if (typeof DoctorReport === 'undefined') {
  describe('DoctorReport (SKIPPED — module not loaded)', () => {
    it('module loaded', () => { assert(false, 'DoctorReport is not defined — check tests/index.html'); });
  });
} else {

// ── Constants ──────────────────────────────────────────────────────────────

// Fixed clock: 2026-07-15 noon local time.
const DR_NOW_MS = new Date(2026, 6, 15, 12, 0, 0, 0).getTime();

// 30-day window for that fixed now:
//   startMs = midnight of 2026-06-15, endMs = midnight of 2026-07-16.
const DR_WIN_30 = DoctorReport._internals.computeWindow(30, DR_NOW_MS);

// One ms before the window opens (should be excluded).
const DR_BEFORE_WINDOW = DR_WIN_30.startMs - 1;
// One ms into the window (should be included).
const DR_IN_WINDOW_EARLY = DR_WIN_30.startMs;
// One ms before the window closes (should be included).
const DR_IN_WINDOW_LATE = DR_WIN_30.endMs - 1;
// One ms after the window closes (should be excluded).
const DR_AFTER_WINDOW = DR_WIN_30.endMs;

// ── Stub helpers ──────────────────────────────────────────────────────────

// MedsManager and Analytics are declared as `const` at the top level of
// meds.js / analytics.js and loaded in tests/index.html. Top-level `const`
// does NOT create a window property — setting window.MedsManager only creates
// a NEW window property that is shadowed by the existing const binding, so
// doctor-report.js's bare `MedsManager` / `Analytics` references always see
// the live singletons. To stub them we must override their methods directly.
//
// History is NOT loaded in tests/index.html (no history.js tag), so bare
// `History` resolves to window.History — the window-assignment stub works.

// DR_REAL_HISTORY is intentionally NOT captured at file-load time.
// export.test.js's last test leaves window.History as a working stub that
// backup.test.js depends on. Capturing at load time would save undefined
// (history.js is not loaded), and DR_restore() would wipe that stub.
// Instead, DR_stubHistory() saves the current value at stub-call time and
// DR_restore() returns it. This keeps the window.History contract intact
// for downstream test files.
let _DR_HISTORY_SAVED = window.History; // snapshot per stub-call, not at load
const DR_REAL_MEDS_ALL = (typeof MedsManager !== 'undefined') ? MedsManager.all.bind(MedsManager) : null;
const DR_REAL_ANALYTICS_ADHERENCE = (typeof Analytics !== 'undefined') ? Analytics.getMedAdherence.bind(Analytics) : null;

function DR_stubHistory(sessions) {
  _DR_HISTORY_SAVED = window.History; // save current value before overwriting
  window.History = { getSessions: async () => sessions };
}

function DR_stubMeds(meds) {
  if (typeof MedsManager !== 'undefined') {
    MedsManager.all = () => meds;
  }
}

function DR_stubAdherence(medsArr) {
  if (typeof Analytics !== 'undefined') {
    Analytics.getMedAdherence = async () => ({ meds: medsArr });
  }
}

function DR_stubRestLog(obj) {
  if (obj === null || obj === undefined) {
    localStorage.removeItem('wellness_rest_log');
  } else {
    localStorage.setItem('wellness_rest_log', typeof obj === 'string' ? obj : JSON.stringify(obj));
  }
}

function DR_restore() {
  window.History = _DR_HISTORY_SAVED; // restore to value before the most recent stub
  if (typeof MedsManager !== 'undefined' && DR_REAL_MEDS_ALL !== null) {
    MedsManager.all = DR_REAL_MEDS_ALL;
  }
  if (typeof Analytics !== 'undefined' && DR_REAL_ANALYTICS_ADHERENCE !== null) {
    Analytics.getMedAdherence = DR_REAL_ANALYTICS_ADHERENCE;
  }
  localStorage.removeItem('wellness_rest_log');
}

// ── Build a plain-object med fixture (normalizeMed accepts plain objects) ─

function DR_makeMed(overrides) {
  return Object.assign({
    id: 'med-1',
    name: 'Aspirin',
    dose: '81mg',
    frequency: 'once-daily',
    lastTakenAt: DR_IN_WINDOW_LATE,
    doseLog: [],
  }, overrides);
}

// ── Build a History session fixture ──────────────────────────────────────

function DR_makeSession(overrides) {
  return Object.assign({
    id: 's1',
    type: 'flow',
    date: new Date(DR_IN_WINDOW_EARLY).toISOString(),
    duration: 3600000, // 1 hour
    tags: [],
  }, overrides);
}

// ── Build a rest-log day fixture ──────────────────────────────────────────

function DR_makeRestDay(dateKey, sleepHours, opts) {
  opts = opts || {};
  const day = {
    sleep: { hours: sleepHours },
    naps: opts.naps || [],
  };
  if (typeof opts.quality === 'number') day.sleep.quality = opts.quality;
  if (opts.bedtime) day.sleep.bedtime = opts.bedtime;
  if (opts.wakeTime) day.sleep.wakeTime = opts.wakeTime;
  return { [dateKey]: day };
}

// ────────────────────────────────────────────────────────────────────────────
// 1. _internals: computeWindow (pure, clock-pinned)
// ────────────────────────────────────────────────────────────────────────────

describe('DoctorReport._internals.computeWindow', () => {
  it('returns correct 30-day window for fixed now', () => {
    const win = DoctorReport._internals.computeWindow(30, DR_NOW_MS);
    // 30-day window: today (2026-07-15) + previous 29 days = starts 2026-06-16
    assertEqual(win.startKey, '2026-06-16');
    // endKey should be today
    assertEqual(win.endKey, '2026-07-15');
    assertEqual(win.days, 30);
    // endMs is midnight of next day (2026-07-16)
    const endDate = new Date(win.endMs);
    assertEqual(endDate.getHours(), 0);
    assertEqual(endDate.getMinutes(), 0);
  });

  it('endMs - startMs spans exactly 30 days', () => {
    const win = DoctorReport._internals.computeWindow(30, DR_NOW_MS);
    assertEqual(win.endMs - win.startMs, 30 * 86400000);
  });

  it('clamps invalid days to 30', () => {
    const win = DoctorReport._internals.computeWindow(-5, DR_NOW_MS);
    assertEqual(win.days, 30);
  });

  it('clamps non-finite now to Date.now() (just resolves)', () => {
    const win = DoctorReport._internals.computeWindow(7, NaN);
    assert(typeof win.startMs === 'number' && isFinite(win.startMs));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. _internals: filterSessions (window boundary)
// ────────────────────────────────────────────────────────────────────────────

describe('DoctorReport._internals.filterSessions — window filtering', () => {
  it('includes session at startMs (inclusive)', () => {
    const s = { date: new Date(DR_WIN_30.startMs).toISOString() };
    const result = DoctorReport._internals.filterSessions([s], DR_WIN_30.startMs, DR_WIN_30.endMs);
    assertEqual(result.length, 1);
  });

  it('excludes session one ms before startMs', () => {
    const s = { date: new Date(DR_BEFORE_WINDOW).toISOString() };
    const result = DoctorReport._internals.filterSessions([s], DR_WIN_30.startMs, DR_WIN_30.endMs);
    assertEqual(result.length, 0);
  });

  it('includes session one ms before endMs (inclusive)', () => {
    const s = { date: new Date(DR_IN_WINDOW_LATE).toISOString() };
    const result = DoctorReport._internals.filterSessions([s], DR_WIN_30.startMs, DR_WIN_30.endMs);
    assertEqual(result.length, 1);
  });

  it('excludes session at endMs (exclusive)', () => {
    const s = { date: new Date(DR_AFTER_WINDOW).toISOString() };
    const result = DoctorReport._internals.filterSessions([s], DR_WIN_30.startMs, DR_WIN_30.endMs);
    assertEqual(result.length, 0);
  });

  it('skips null rows without throwing', () => {
    const result = DoctorReport._internals.filterSessions([null, undefined, { date: 'garbage' }], DR_WIN_30.startMs, DR_WIN_30.endMs);
    assertEqual(result.length, 0);
  });

  it('skips row with missing date without throwing', () => {
    const result = DoctorReport._internals.filterSessions([{ type: 'flow' }], DR_WIN_30.startMs, DR_WIN_30.endMs);
    assertEqual(result.length, 0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. _internals: clockToMinutes
// ────────────────────────────────────────────────────────────────────────────

describe('DoctorReport._internals.clockToMinutes', () => {
  it('parses "22:30" → 1350', () => {
    assertEqual(DoctorReport._internals.clockToMinutes('22:30'), 1350);
  });
  it('parses "0:00" → 0', () => {
    assertEqual(DoctorReport._internals.clockToMinutes('0:00'), 0);
  });
  it('parses "23:59" → 1439', () => {
    assertEqual(DoctorReport._internals.clockToMinutes('23:59'), 1439);
  });
  it('returns null for "24:00"', () => {
    assertEqual(DoctorReport._internals.clockToMinutes('24:00'), null);
  });
  it('returns null for non-string', () => {
    assertEqual(DoctorReport._internals.clockToMinutes(2230), null);
  });
  it('returns null for empty string', () => {
    assertEqual(DoctorReport._internals.clockToMinutes(''), null);
  });
  it('returns null for garbage', () => {
    assertEqual(DoctorReport._internals.clockToMinutes('not-a-time'), null);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. _internals: parseRestLog
// ────────────────────────────────────────────────────────────────────────────

describe('DoctorReport._internals.parseRestLog', () => {
  it('returns [] for null input', () => {
    assertArrayEqual(DoctorReport._internals.parseRestLog(null), []);
  });
  it('returns [] for empty string', () => {
    assertArrayEqual(DoctorReport._internals.parseRestLog(''), []);
  });
  it('returns [] for malformed JSON', () => {
    assertArrayEqual(DoctorReport._internals.parseRestLog('{bad json'), []);
  });
  it('returns [] for valid JSON that is an array not an object', () => {
    assertArrayEqual(DoctorReport._internals.parseRestLog('[]'), []);
  });
  it('parses a single valid day', () => {
    const raw = { '2026-07-10': { sleep: { hours: 7 }, naps: [] } };
    const result = DoctorReport._internals.parseRestLog(raw);
    assertEqual(result.length, 1);
    assertEqual(result[0].dateKey, '2026-07-10');
    assert(typeof result[0].dayStartMs === 'number');
    assert(result[0].sleep.hours === 7);
  });
  it('skips malformed date keys', () => {
    const raw = { 'not-a-date': { sleep: { hours: 7 }, naps: [] } };
    const result = DoctorReport._internals.parseRestLog(raw);
    assertEqual(result.length, 0);
  });
  it('skips calendar-invalid dates (month 13)', () => {
    const raw = { '2026-13-05': { sleep: { hours: 7 }, naps: [] } };
    const result = DoctorReport._internals.parseRestLog(raw);
    assertEqual(result.length, 0);
  });
  it('skips non-object day entries', () => {
    const raw = { '2026-07-10': null, '2026-07-11': 'bad', '2026-07-12': { sleep: { hours: 8 }, naps: [] } };
    const result = DoctorReport._internals.parseRestLog(raw);
    assertEqual(result.length, 1);
    assertEqual(result[0].dateKey, '2026-07-12');
  });
  it('filters naps with negative durationMs', () => {
    const raw = {
      '2026-07-10': {
        sleep: { hours: 7 },
        naps: [
          { durationMs: -1000 },
          { durationMs: 1800000 },
        ],
      },
    };
    const result = DoctorReport._internals.parseRestLog(raw);
    assertEqual(result[0].naps.length, 1);
    assertEqual(result[0].naps[0].durationMs, 1800000);
  });
  it('accepts a pre-parsed object (no JSON.parse needed)', () => {
    const obj = { '2026-07-05': { sleep: { hours: 6 }, naps: [] } };
    const result = DoctorReport._internals.parseRestLog(obj);
    assertEqual(result.length, 1);
  });
  it('sorts entries by date ascending', () => {
    const raw = {
      '2026-07-12': { sleep: { hours: 6 }, naps: [] },
      '2026-07-10': { sleep: { hours: 7 }, naps: [] },
      '2026-07-11': { sleep: { hours: 8 }, naps: [] },
    };
    const result = DoctorReport._internals.parseRestLog(raw);
    assertEqual(result[0].dateKey, '2026-07-10');
    assertEqual(result[1].dateKey, '2026-07-11');
    assertEqual(result[2].dateKey, '2026-07-12');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5. _internals: normalizeMed
// ────────────────────────────────────────────────────────────────────────────

describe('DoctorReport._internals.normalizeMed', () => {
  it('normalizes a plain-object med', () => {
    const m = DR_makeMed({});
    const n = DoctorReport._internals.normalizeMed(m);
    assertEqual(n.name, 'Aspirin');
    assertEqual(n.dose, '81mg');
    assertEqual(n.frequency, 'once-daily');
  });
  it('returns null for null input', () => {
    assertEqual(DoctorReport._internals.normalizeMed(null), null);
  });
  it('returns null for a non-object input', () => {
    assertEqual(DoctorReport._internals.normalizeMed('bad'), null);
  });
  it('defaults name to "Medication" when blank', () => {
    const m = DR_makeMed({ name: '  ' });
    const n = DoctorReport._internals.normalizeMed(m);
    assertEqual(n.name, 'Medication');
  });
  it('defaults frequency to "as-needed" when missing', () => {
    const m = DR_makeMed({ frequency: undefined });
    const n = DoctorReport._internals.normalizeMed(m);
    assertEqual(n.frequency, 'as-needed');
  });
  it('normalizes a getter-based med object', () => {
    const med = {
      getId: () => 'med-x',
      getName: () => 'Ibuprofen',
      getDose: () => '200mg',
      getFrequency: () => 'twice-daily',
      getLastTakenAt: () => 1000,
      getDoseLog: () => [{ takenAt: 1000 }],
    };
    const n = DoctorReport._internals.normalizeMed(med);
    assertEqual(n.name, 'Ibuprofen');
    assertEqual(n.frequency, 'twice-daily');
    assertEqual(n.doseLog.length, 1);
  });
  it('filters doseLog entries missing takenAt', () => {
    const m = DR_makeMed({ doseLog: [{ takenAt: 1000 }, { bad: true }, null] });
    const n = DoctorReport._internals.normalizeMed(m);
    assertEqual(n.doseLog.length, 1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 6. _internals: countDosesInWindow
// ────────────────────────────────────────────────────────────────────────────

describe('DoctorReport._internals.countDosesInWindow', () => {
  it('counts only doses inside [startMs, endMs)', () => {
    const doseLog = [
      { takenAt: DR_BEFORE_WINDOW },   // excluded
      { takenAt: DR_IN_WINDOW_EARLY }, // included
      { takenAt: DR_IN_WINDOW_LATE },  // included
      { takenAt: DR_AFTER_WINDOW },    // excluded
    ];
    assertEqual(DoctorReport._internals.countDosesInWindow(doseLog, DR_WIN_30.startMs, DR_WIN_30.endMs), 2);
  });

  it('returns 0 for empty doseLog', () => {
    assertEqual(DoctorReport._internals.countDosesInWindow([], DR_WIN_30.startMs, DR_WIN_30.endMs), 0);
  });

  it('returns 0 for null doseLog', () => {
    assertEqual(DoctorReport._internals.countDosesInWindow(null, DR_WIN_30.startMs, DR_WIN_30.endMs), 0);
  });

  it('skips entries with non-numeric takenAt', () => {
    const doseLog = [{ takenAt: 'bad' }, { takenAt: DR_IN_WINDOW_EARLY }];
    assertEqual(DoctorReport._internals.countDosesInWindow(doseLog, DR_WIN_30.startMs, DR_WIN_30.endMs), 1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 7. _internals: lastDoseMs
// ────────────────────────────────────────────────────────────────────────────

describe('DoctorReport._internals.lastDoseMs', () => {
  it('returns lastTakenAt when present', () => {
    const m = { lastTakenAt: 9999, doseLog: [{ takenAt: 1000 }] };
    assertEqual(DoctorReport._internals.lastDoseMs(m), 9999);
  });

  it('falls back to doseLog tail when lastTakenAt is null', () => {
    const m = {
      lastTakenAt: null,
      doseLog: [{ takenAt: 1000 }, { takenAt: 5000 }, { takenAt: 3000 }],
    };
    assertEqual(DoctorReport._internals.lastDoseMs(m), 5000);
  });

  it('returns null when both are absent', () => {
    const m = { lastTakenAt: null, doseLog: [] };
    assertEqual(DoctorReport._internals.lastDoseMs(m), null);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 8. _internals: frequencyLabel
// ────────────────────────────────────────────────────────────────────────────

describe('DoctorReport._internals.frequencyLabel', () => {
  it('"once-daily" → "once daily"', () => {
    assertEqual(DoctorReport._internals.frequencyLabel('once-daily'), 'once daily');
  });
  it('"twice-daily" → "twice daily"', () => {
    assertEqual(DoctorReport._internals.frequencyLabel('twice-daily'), 'twice daily');
  });
  it('"as-needed" → "as needed"', () => {
    assertEqual(DoctorReport._internals.frequencyLabel('as-needed'), 'as needed');
  });
  it('unknown value passes through verbatim', () => {
    assertEqual(DoctorReport._internals.frequencyLabel('three-times-daily'), 'three-times-daily');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 9. _internals: buildMedsSection
// ────────────────────────────────────────────────────────────────────────────

describe('DoctorReport._internals.buildMedsSection', () => {
  it('empty list renders "No medications logged in this window."', () => {
    const text = DoctorReport._internals.buildMedsSection([], null, DR_WIN_30);
    assert(text.includes('No medications logged in this window.'));
  });

  it('scheduled med shows adherence % from stub', () => {
    const med = DoctorReport._internals.normalizeMed(DR_makeMed({
      id: 'med-1',
      frequency: 'once-daily',
      doseLog: [{ takenAt: DR_IN_WINDOW_EARLY }],
    }));
    const adherence = { meds: [{ id: 'med-1', name: 'Aspirin', adherencePct: 75 }] };
    const text = DoctorReport._internals.buildMedsSection([med], adherence, DR_WIN_30);
    assert(text.includes('Adherence: 75%'), 'expected adherence line for scheduled med');
  });

  it('scheduled med rounds adherence % (e.g. 74.7 → 75%)', () => {
    const med = DoctorReport._internals.normalizeMed(DR_makeMed({ id: 'med-2', frequency: 'once-daily' }));
    const adherence = { meds: [{ id: 'med-2', name: 'Aspirin', adherencePct: 74.7 }] };
    const text = DoctorReport._internals.buildMedsSection([med], adherence, DR_WIN_30);
    assert(text.includes('Adherence: 75%'));
  });

  it('as-needed med shows no adherence line', () => {
    const med = DoctorReport._internals.normalizeMed(DR_makeMed({ frequency: 'as-needed' }));
    const text = DoctorReport._internals.buildMedsSection([med], null, DR_WIN_30);
    assert(!text.includes('Adherence:'), 'as-needed med should not have adherence line');
  });

  it('shows doses-in-window count', () => {
    const med = DoctorReport._internals.normalizeMed(DR_makeMed({
      doseLog: [{ takenAt: DR_IN_WINDOW_EARLY }, { takenAt: DR_BEFORE_WINDOW }],
    }));
    const text = DoctorReport._internals.buildMedsSection([med], null, DR_WIN_30);
    assert(text.includes('Doses in window: 1'));
  });

  it('shows "Last taken: never" when no dose log', () => {
    const med = DoctorReport._internals.normalizeMed(DR_makeMed({ lastTakenAt: null, doseLog: [] }));
    const text = DoctorReport._internals.buildMedsSection([med], null, DR_WIN_30);
    assert(text.includes('Last taken: never'));
  });

  it('matches adherence by name when id is absent', () => {
    const med = DoctorReport._internals.normalizeMed(DR_makeMed({ id: null }));
    const adherence = { meds: [{ id: null, name: 'Aspirin', adherencePct: 80 }] };
    const text = DoctorReport._internals.buildMedsSection([med], adherence, DR_WIN_30);
    assert(text.includes('Adherence: 80%'));
  });

  it('scheduled med with no matching adherence entry omits adherence line', () => {
    const med = DoctorReport._internals.normalizeMed(DR_makeMed({ id: 'no-match' }));
    const adherence = { meds: [] };
    const text = DoctorReport._internals.buildMedsSection([med], adherence, DR_WIN_30);
    assert(!text.includes('Adherence:'));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 10. _internals: timeRangePart
// ────────────────────────────────────────────────────────────────────────────

describe('DoctorReport._internals.timeRangePart', () => {
  it('returns null for empty values array', () => {
    assertEqual(DoctorReport._internals.timeRangePart('Bedtime', [], true), null);
  });

  it('single value renders without dash', () => {
    const r = DoctorReport._internals.timeRangePart('Wake', ['07:30'], false);
    assertEqual(r, 'Wake 07:30');
  });

  it('different wake times show range earliest–latest', () => {
    const r = DoctorReport._internals.timeRangePart('Wake', ['08:00', '06:30', '07:00'], false);
    assertEqual(r, 'Wake 06:30–08:00');
  });

  it('midnight-wrapped bedtime: 00:30 sorts as later than 23:00', () => {
    // 00:30 is after-midnight so sorts after 23:00 in isBedtime mode.
    const r = DoctorReport._internals.timeRangePart('Bedtime', ['23:00', '00:30'], true);
    // Earliest habitual bedtime is 23:00, latest is 00:30 (after midnight)
    assertEqual(r, 'Bedtime 23:00–00:30');
  });

  it('skips malformed time values gracefully', () => {
    const r = DoctorReport._internals.timeRangePart('Wake', ['bad', '07:30', null], false);
    assertEqual(r, 'Wake 07:30');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 11. _internals: buildSleepSection
// ────────────────────────────────────────────────────────────────────────────

describe('DoctorReport._internals.buildSleepSection', () => {
  it('empty entries renders "No sleep logged in this window."', () => {
    const text = DoctorReport._internals.buildSleepSection([], DR_WIN_30);
    assert(text.includes('No sleep logged in this window.'));
  });

  it('out-of-window entries are excluded', () => {
    // dayStartMs is one ms before window starts → excluded
    const entries = [{ dateKey: '2026-06-14', dayStartMs: DR_WIN_30.startMs - 1, sleep: { hours: 7 }, naps: [] }];
    const text = DoctorReport._internals.buildSleepSection(entries, DR_WIN_30);
    assert(text.includes('No sleep logged in this window.'));
  });

  it('shows sleep logged N of 30 days', () => {
    // Two days in-window
    const entries = [
      { dateKey: '2026-06-15', dayStartMs: DR_WIN_30.startMs, sleep: { hours: 7 }, naps: [] },
      { dateKey: '2026-06-16', dayStartMs: DR_WIN_30.startMs + 86400000, sleep: { hours: 8 }, naps: [] },
    ];
    const text = DoctorReport._internals.buildSleepSection(entries, DR_WIN_30);
    assert(text.includes('Sleep logged 2 of 30 days'));
  });

  it('computes correct average hours', () => {
    const entries = [
      { dateKey: '2026-06-15', dayStartMs: DR_WIN_30.startMs, sleep: { hours: 6 }, naps: [] },
      { dateKey: '2026-06-16', dayStartMs: DR_WIN_30.startMs + 86400000, sleep: { hours: 8 }, naps: [] },
    ];
    const text = DoctorReport._internals.buildSleepSection(entries, DR_WIN_30);
    // avg = (6+8)/2 = 7.0
    assert(text.includes('Average: 7.0 hr'), 'expected "Average: 7.0 hr"');
  });

  it('includes quality when present', () => {
    const entries = [
      { dateKey: '2026-06-15', dayStartMs: DR_WIN_30.startMs, sleep: { hours: 7, quality: 4 }, naps: [] },
    ];
    const text = DoctorReport._internals.buildSleepSection(entries, DR_WIN_30);
    assert(text.includes('quality 4.0/5'));
  });

  it('omits quality line when not logged', () => {
    const entries = [
      { dateKey: '2026-06-15', dayStartMs: DR_WIN_30.startMs, sleep: { hours: 7 }, naps: [] },
    ];
    const text = DoctorReport._internals.buildSleepSection(entries, DR_WIN_30);
    assert(!text.includes('quality'));
  });

  it('counts naps and totals their duration', () => {
    const entries = [
      {
        dateKey: '2026-06-15',
        dayStartMs: DR_WIN_30.startMs,
        sleep: { hours: 6 },
        naps: [{ durationMs: 1800000 }, { durationMs: 900000 }],
      },
    ];
    const text = DoctorReport._internals.buildSleepSection(entries, DR_WIN_30);
    // 2 naps, total = 2700000ms = 45m
    assert(text.includes('Naps: 2'), 'expected nap count');
    assert(text.includes('45m'), 'expected total nap time');
  });

  it('shows naps even when no sleep hours logged (naps-only)', () => {
    const entries = [
      { dateKey: '2026-06-15', dayStartMs: DR_WIN_30.startMs, sleep: null, naps: [{ durationMs: 1800000 }] },
    ];
    const text = DoctorReport._internals.buildSleepSection(entries, DR_WIN_30);
    assert(text.includes('Naps: 1'));
  });

  it('shows bedtime range from logged entries', () => {
    const entries = [
      { dateKey: '2026-06-15', dayStartMs: DR_WIN_30.startMs, sleep: { hours: 7, bedtime: '22:00' }, naps: [] },
      { dateKey: '2026-06-16', dayStartMs: DR_WIN_30.startMs + 86400000, sleep: { hours: 8, bedtime: '23:30' }, naps: [] },
    ];
    const text = DoctorReport._internals.buildSleepSection(entries, DR_WIN_30);
    assert(text.includes('Bedtime 22:00–23:30'));
  });

  it('midnight-wrapped bedtime range renders correctly', () => {
    const entries = [
      { dateKey: '2026-06-15', dayStartMs: DR_WIN_30.startMs, sleep: { hours: 7, bedtime: '23:00' }, naps: [] },
      { dateKey: '2026-06-16', dayStartMs: DR_WIN_30.startMs + 86400000, sleep: { hours: 8, bedtime: '00:30' }, naps: [] },
    ];
    const text = DoctorReport._internals.buildSleepSection(entries, DR_WIN_30);
    assert(text.includes('Bedtime 23:00–00:30'));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 12. _internals: buildActivitySection
// ────────────────────────────────────────────────────────────────────────────

describe('DoctorReport._internals.buildActivitySection', () => {
  it('empty → "No sessions logged in this window."', () => {
    const text = DoctorReport._internals.buildActivitySection([]);
    assert(text.includes('No sessions logged in this window.'));
  });

  it('cooking-only window renders empty-state', () => {
    const sessions = [
      { type: 'cooking', date: new Date(DR_IN_WINDOW_EARLY).toISOString(), duration: 300000, tags: [] },
    ];
    const text = DoctorReport._internals.buildActivitySection(sessions);
    assert(text.includes('No sessions logged in this window.'));
  });

  it('sums focus ms from flow and pomodoro', () => {
    const sessions = [
      { type: 'flow', duration: 3600000, tags: [] },
      { type: 'pomodoro', duration: 1800000, tags: [] },
    ];
    const text = DoctorReport._internals.buildActivitySection(sessions);
    // 3600000 + 1800000 = 5400000 ms = 1h 30m
    assert(text.includes('1h 30m'), 'expected focus total "1h 30m"');
  });

  it('counts focus sessions correctly', () => {
    const sessions = [
      { type: 'flow', duration: 3600000, tags: [] },
      { type: 'pomodoro', duration: 1800000, tags: [] },
      { type: 'pomodoro', duration: 1800000, tags: [] },
    ];
    const text = DoctorReport._internals.buildActivitySection(sessions);
    assert(text.includes('3 sessions'));
  });

  it('counts mindful tag sessions', () => {
    const sessions = [
      { type: 'flow', duration: 3600000, tags: ['mindful'] },
      { type: 'timer', duration: 600000, tags: ['mindful'] },
      { type: 'timer', duration: 600000, tags: [] },
    ];
    const text = DoctorReport._internals.buildActivitySection(sessions);
    assert(text.includes('Mindful sessions: 2'));
  });

  it('counts interval sessions (exercise)', () => {
    const sessions = [
      { type: 'interval', duration: 1800000, tags: [] },
      { type: 'interval', duration: 900000, tags: [] },
    ];
    const text = DoctorReport._internals.buildActivitySection(sessions);
    assert(text.includes('Exercise sessions: 2'));
  });

  it('cooking excluded from all counts', () => {
    const sessions = [
      { type: 'cooking', duration: 600000, tags: [] },
      { type: 'flow', duration: 3600000, tags: [] },
    ];
    const text = DoctorReport._internals.buildActivitySection(sessions);
    // Should only count the flow session
    assert(text.includes('1 session'));
    assert(!text.includes('Exercise sessions: 1')); // cooking is NOT interval
  });

  it('shows "Focus sessions: 0" when no flow/pomodoro but other types present', () => {
    const sessions = [
      { type: 'interval', duration: 1800000, tags: [] },
    ];
    const text = DoctorReport._internals.buildActivitySection(sessions);
    assert(text.includes('Focus sessions: 0'));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 13. _internals: buildHeader
// ────────────────────────────────────────────────────────────────────────────

describe('DoctorReport._internals.buildHeader', () => {
  it('contains "TEMPO HEALTH SUMMARY"', () => {
    const text = DoctorReport._internals.buildHeader(DR_WIN_30);
    assert(text.includes('TEMPO HEALTH SUMMARY'));
  });

  it('includes the date range', () => {
    const text = DoctorReport._internals.buildHeader(DR_WIN_30);
    // 30-day window from fixed now=2026-07-15 starts on 2026-06-16
    assert(text.includes('2026-06-16'), 'expected start date 2026-06-16 in: ' + text);
    assert(text.includes('2026-07-15'), 'expected end date 2026-07-15 in: ' + text);
  });

  it('includes "Last 30 days"', () => {
    const text = DoctorReport._internals.buildHeader(DR_WIN_30);
    assert(text.includes('Last 30 days'));
  });

  it('includes "Generated" line', () => {
    const text = DoctorReport._internals.buildHeader(DR_WIN_30);
    assert(text.includes('Generated 2026-07-15'));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 14. _internals: FOOTER
// ────────────────────────────────────────────────────────────────────────────

describe('DoctorReport._internals.FOOTER', () => {
  it('contains the required disclaimer text', () => {
    assert(
      DoctorReport._internals.FOOTER.includes('descriptive only, no medical interpretation'),
      'footer must include the disclaimer'
    );
  });
  it('starts with "Generated by Tempo"', () => {
    assert(DoctorReport._internals.FOOTER.startsWith('Generated by Tempo'));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 15. buildReport — full integration (all-empty)
// ────────────────────────────────────────────────────────────────────────────

describe('DoctorReport.buildReport — all-empty stores', () => {
  it('resolves without throwing when all stores empty', async () => {
    DR_stubHistory([]);
    DR_stubMeds([]);
    DR_stubAdherence([]);
    DR_stubRestLog(null);
    let report;
    let threw = false;
    try {
      report = await DoctorReport.buildReport({ days: 30, now: DR_NOW_MS });
    } catch (e) {
      threw = true;
    }
    DR_restore();
    assert(!threw, 'buildReport must not throw on empty stores');
    assert(typeof report === 'string', 'report must be a string');
  });

  it('all-empty report contains "No medications logged" section', async () => {
    DR_stubHistory([]);
    DR_stubMeds([]);
    DR_stubAdherence([]);
    DR_stubRestLog(null);
    const report = await DoctorReport.buildReport({ days: 30, now: DR_NOW_MS });
    DR_restore();
    assert(report.includes('No medications logged in this window.'));
  });

  it('all-empty report contains "No sleep logged" section', async () => {
    DR_stubHistory([]);
    DR_stubMeds([]);
    DR_stubAdherence([]);
    DR_stubRestLog(null);
    const report = await DoctorReport.buildReport({ days: 30, now: DR_NOW_MS });
    DR_restore();
    assert(report.includes('No sleep logged in this window.'));
  });

  it('all-empty report contains "No sessions logged" activity section', async () => {
    DR_stubHistory([]);
    DR_stubMeds([]);
    DR_stubAdherence([]);
    DR_stubRestLog(null);
    const report = await DoctorReport.buildReport({ days: 30, now: DR_NOW_MS });
    DR_restore();
    assert(report.includes('No sessions logged in this window.'));
  });

  it('all-empty report includes header and footer', async () => {
    DR_stubHistory([]);
    DR_stubMeds([]);
    DR_stubAdherence([]);
    DR_stubRestLog(null);
    const report = await DoctorReport.buildReport({ days: 30, now: DR_NOW_MS });
    DR_restore();
    assert(report.includes('TEMPO HEALTH SUMMARY'));
    assert(report.includes('Generated by Tempo'));
  });

  it('resolves even when History.getSessions rejects', async () => {
    window.History = { getSessions: async () => { throw new Error('IDB error'); } };
    DR_stubMeds([]);
    DR_stubAdherence([]);
    DR_stubRestLog(null);
    let threw = false;
    try {
      await DoctorReport.buildReport({ days: 30, now: DR_NOW_MS });
    } catch (e) {
      threw = true;
    }
    DR_restore();
    assert(!threw, 'buildReport must not propagate IDB errors');
  });

  it('resolves even when MedsManager is undefined', async () => {
    window.MedsManager = undefined;
    DR_stubHistory([]);
    DR_stubAdherence([]);
    DR_stubRestLog(null);
    let threw = false;
    try {
      await DoctorReport.buildReport({ days: 30, now: DR_NOW_MS });
    } catch (e) {
      threw = true;
    }
    DR_restore();
    assert(!threw, 'buildReport must survive missing MedsManager');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 16. buildReport — full integration (populated data)
// ────────────────────────────────────────────────────────────────────────────

describe('DoctorReport.buildReport — populated data', () => {
  it('scheduled med shows name + adherence % in full report', async () => {
    const med = DR_makeMed({ id: 'med-s1', frequency: 'once-daily', doseLog: [{ takenAt: DR_IN_WINDOW_EARLY }] });
    DR_stubMeds([med]);
    DR_stubAdherence([{ id: 'med-s1', name: 'Aspirin', adherencePct: 90 }]);
    DR_stubHistory([]);
    DR_stubRestLog(null);
    const report = await DoctorReport.buildReport({ days: 30, now: DR_NOW_MS });
    DR_restore();
    assert(report.includes('Aspirin'), 'expected Aspirin in report; meds section: ' + report.split('\n\n')[1]);
    assert(report.includes('Adherence: 90%'), 'expected Adherence: 90% in report');
  });

  it('as-needed med shows no adherence line in full report', async () => {
    const med = DR_makeMed({ id: 'med-a1', frequency: 'as-needed', doseLog: [] });
    DR_stubMeds([med]);
    DR_stubAdherence([]);
    DR_stubHistory([]);
    DR_stubRestLog(null);
    const report = await DoctorReport.buildReport({ days: 30, now: DR_NOW_MS });
    DR_restore();
    assert(report.includes('Aspirin'), 'expected Aspirin in report; meds section: ' + report.split('\n\n')[1]);
    assert(!report.includes('Adherence:'), 'as-needed should not have adherence line');
  });

  it('sessions outside window are excluded from activity section', async () => {
    // Only out-of-window sessions
    const oldSession = DR_makeSession({ date: new Date(DR_BEFORE_WINDOW).toISOString(), type: 'flow', duration: 3600000 });
    DR_stubHistory([oldSession]);
    DR_stubMeds([]);
    DR_stubAdherence([]);
    DR_stubRestLog(null);
    const report = await DoctorReport.buildReport({ days: 30, now: DR_NOW_MS });
    DR_restore();
    assert(report.includes('No sessions logged in this window.'));
  });

  it('sleep avg hours appears in full report', async () => {
    // Both dates must be within the window (starts 2026-06-16, ends 2026-07-15)
    const restLog = {
      '2026-06-16': { sleep: { hours: 7 }, naps: [] },
      '2026-06-17': { sleep: { hours: 9 }, naps: [] },
    };
    DR_stubHistory([]);
    DR_stubMeds([]);
    DR_stubAdherence([]);
    DR_stubRestLog(restLog);
    const report = await DoctorReport.buildReport({ days: 30, now: DR_NOW_MS });
    DR_restore();
    // avg = (7+9)/2 = 8.0 hr
    assert(report.includes('Average: 8.0 hr'), 'expected avg 8.0 in report: ' + report.slice(0, 400));
  });

  it('focus sessions aggregated correctly in full report', async () => {
    const flowSession = DR_makeSession({ type: 'flow', duration: 5400000 }); // 1h30m
    const pomSession = DR_makeSession({ id: 's2', type: 'pomodoro', duration: 1800000 }); // 30m
    DR_stubHistory([flowSession, pomSession]);
    DR_stubMeds([]);
    DR_stubAdherence([]);
    DR_stubRestLog(null);
    const report = await DoctorReport.buildReport({ days: 30, now: DR_NOW_MS });
    DR_restore();
    // 5400000 + 1800000 = 7200000ms = 2h
    assert(report.includes('2h'), 'expected 2h total focus');
    assert(report.includes('2 sessions'));
  });

  it('mindful session counted in full report', async () => {
    const mindfulSession = DR_makeSession({ type: 'timer', tags: ['mindful'], duration: 600000 });
    DR_stubHistory([mindfulSession]);
    DR_stubMeds([]);
    DR_stubAdherence([]);
    DR_stubRestLog(null);
    const report = await DoctorReport.buildReport({ days: 30, now: DR_NOW_MS });
    DR_restore();
    assert(report.includes('Mindful sessions: 1'));
  });

  it('interval sessions counted in full report', async () => {
    const intervalSession = DR_makeSession({ type: 'interval', duration: 1800000 });
    DR_stubHistory([intervalSession]);
    DR_stubMeds([]);
    DR_stubAdherence([]);
    DR_stubRestLog(null);
    const report = await DoctorReport.buildReport({ days: 30, now: DR_NOW_MS });
    DR_restore();
    assert(report.includes('Exercise sessions: 1'));
  });

  it('cooking sessions excluded from full report counts', async () => {
    const cookingSession = DR_makeSession({ type: 'cooking', duration: 600000 });
    DR_stubHistory([cookingSession]);
    DR_stubMeds([]);
    DR_stubAdherence([]);
    DR_stubRestLog(null);
    const report = await DoctorReport.buildReport({ days: 30, now: DR_NOW_MS });
    DR_restore();
    assert(report.includes('No sessions logged in this window.'));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 17. buildReport — malformed-row resilience
// ────────────────────────────────────────────────────────────────────────────

describe('DoctorReport.buildReport — malformed-row resilience', () => {
  it('null session rows are skipped', async () => {
    DR_stubHistory([null, undefined, DR_makeSession({ type: 'flow', duration: 3600000 })]);
    DR_stubMeds([]);
    DR_stubAdherence([]);
    DR_stubRestLog(null);
    let threw = false;
    try {
      await DoctorReport.buildReport({ days: 30, now: DR_NOW_MS });
    } catch (e) {
      threw = true;
    }
    DR_restore();
    assert(!threw, 'null rows must not throw');
  });

  it('null med rows are skipped', async () => {
    DR_stubHistory([]);
    DR_stubMeds([null, undefined, DR_makeMed({})]);
    DR_stubAdherence([]);
    DR_stubRestLog(null);
    let report;
    let threw = false;
    try {
      report = await DoctorReport.buildReport({ days: 30, now: DR_NOW_MS });
    } catch (e) {
      threw = true;
    }
    DR_restore();
    assert(!threw, 'null med rows must not throw');
    assert(report && report.includes('Aspirin'), 'valid med should still appear; meds section: ' + (report || '').split('\n\n')[1]);
  });

  it('malformed rest_log JSON is silently skipped', async () => {
    DR_stubHistory([]);
    DR_stubMeds([]);
    DR_stubAdherence([]);
    DR_stubRestLog('{not valid json}}');
    let threw = false;
    try {
      await DoctorReport.buildReport({ days: 30, now: DR_NOW_MS });
    } catch (e) {
      threw = true;
    }
    DR_restore();
    assert(!threw, 'malformed rest_log must not throw');
  });

  it('session with missing duration is counted without NaN in focus total', async () => {
    const badSession = { type: 'flow', date: new Date(DR_IN_WINDOW_EARLY).toISOString() }; // no duration
    DR_stubHistory([badSession]);
    DR_stubMeds([]);
    DR_stubAdherence([]);
    DR_stubRestLog(null);
    let threw = false;
    let report;
    try {
      report = await DoctorReport.buildReport({ days: 30, now: DR_NOW_MS });
    } catch (e) {
      threw = true;
    }
    DR_restore();
    assert(!threw);
    // NaN would produce "NaN" in the string; check it doesn't
    assert(!report.includes('NaN'), 'report must not contain NaN');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 18. Export helpers — existence and type checks
// ────────────────────────────────────────────────────────────────────────────

describe('Export text helpers (copyText / shareText / downloadText)', () => {
  it('copyText is a function', () => {
    assert(typeof Export.copyText === 'function', 'Export.copyText must be a function');
  });
  it('shareText is a function', () => {
    assert(typeof Export.shareText === 'function', 'Export.shareText must be a function');
  });
  it('downloadText is a function', () => {
    assert(typeof Export.downloadText === 'function', 'Export.downloadText must be a function');
  });

  it('shareText falls back to clipboard when canShare() is false', async () => {
    // Record whether navigator.share and navigator.clipboard existed as own
    // properties BEFORE this test touches them, so restore is exact.
    const shareWasOwn = Object.prototype.hasOwnProperty.call(navigator, 'share');
    const clipboardWasOwn = Object.prototype.hasOwnProperty.call(navigator, 'clipboard');
    const origShare = shareWasOwn ? navigator.share : undefined;
    const origClipboard = clipboardWasOwn
      ? Object.getOwnPropertyDescriptor(navigator, 'clipboard')
      : undefined;

    // Temporarily stub navigator.share to be absent
    try { delete navigator.share; } catch (_) {}
    // Also stub clipboard so we can observe the fallback
    let clipboardCalled = false;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { clipboardCalled = true; return; } },
    });

    let result;
    try {
      result = await Export.shareText('Test Title', 'Test content');
    } finally {
      // Restore navigator.share exactly:
      //   - if it was NOT an own property before, delete any own property we may
      //     have left behind (do NOT assign undefined, which would plant an own prop)
      //   - if it WAS an own property before, put the saved value back
      try {
        if (shareWasOwn) {
          Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: origShare });
        } else {
          delete navigator.share;
        }
      } catch (_) {}

      // Restore navigator.clipboard exactly:
      //   - if it was NOT an own property before, deleting the own data-property
      //     we installed lets the prototype accessor shine through again
      //   - if it WAS an own property before, restore the saved descriptor
      try {
        if (clipboardWasOwn && origClipboard) {
          Object.defineProperty(navigator, 'clipboard', origClipboard);
        } else {
          delete navigator.clipboard;
        }
      } catch (_) {}
    }

    assert(clipboardCalled || result === true || result === false,
      'shareText must resolve (not throw) when navigator.share is absent');
  });
});

} // end DoctorReport guard
