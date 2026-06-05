// Tests for js/tempo-coach.js — the pure "daily loop" decision core.
//
// TempoCoach is a side-effect-free engine: readinessBand / suggestFocusDurationMs
// / doseSleepSlope / buildTodayModel / shouldNudge all take data (or injected
// deps) and return decision objects. No DOM, no MedsManager/RecoveryFeed seeding
// required — every input is passed as a fixture.
//
// Heavily-tested surface (per the audit Test scope):
//   - readinessBand mapping + null for every no-signal case
//   - suggestFocusDurationMs band→ms + descriptive reason; neutral/null→no override
//   - doseSleepSlope happy path + all THREE suppression paths + boundary thresholds
//   - buildTodayModel populated / sparse / empty — never throws, never NaN
//   - shouldNudge descriptive copy + no-signal→nudge:false

(function () {
  const FOCUS_90 = 5400000;
  const FOCUS_120 = 7200000;
  const NOW = new Date(2026, 4, 20, 12, 0, 0).getTime(); // 2026-05-20, noon local

  function atLocalDayHour(daysFromToday, hour, min) {
    const b = new Date(NOW);
    return new Date(b.getFullYear(), b.getMonth(), b.getDate() + daysFromToday, hour, min || 0, 0, 0).getTime();
  }
  function dayKeyOffset(daysFromToday) {
    const b = new Date(NOW);
    return Utils.localDateKey(new Date(b.getFullYear(), b.getMonth(), b.getDate() + daysFromToday));
  }

  // Live-MedsManager-shaped stub. Mirrors the accessor surface buildTodayModel
  // reads: getStatusToday / getName / getDose / getDoseLog.
  function stubMed(opts) {
    return {
      getName: () => opts.name,
      getDose: () => opts.dose || '',
      getStatusToday: () => opts.status, // { kind, takenToday, expected }
      getDoseLog: () => opts.doseLog || [],
    };
  }

  // Returns true iff no field of `obj` (recursively) is NaN.
  function noNaN(obj) {
    if (typeof obj === 'number') return !Number.isNaN(obj);
    if (Array.isArray(obj)) return obj.every(noNaN);
    if (obj && typeof obj === 'object') return Object.keys(obj).every(k => noNaN(obj[k]));
    return true;
  }

  // ── readinessBand ──────────────────────────────────────────────────
  describe('TempoCoach.readinessBand', () => {
    it('maps well_recovered → well', () => {
      assertEqual(TempoCoach.readinessBand({ recovery_signal: 'well_recovered' }), 'well');
    });
    it('maps strained → strained', () => {
      assertEqual(TempoCoach.readinessBand({ recovery_signal: 'strained' }), 'strained');
    });
    it('maps neutral → neutral', () => {
      assertEqual(TempoCoach.readinessBand({ recovery_signal: 'neutral' }), 'neutral');
    });
    it('returns null for insufficient_data', () => {
      assertEqual(TempoCoach.readinessBand({ recovery_signal: 'insufficient_data' }), null);
    });
    it('returns null for a missing recovery_signal field', () => {
      assertEqual(TempoCoach.readinessBand({ hrv: 50 }), null);
    });
    it('returns null for an unrecognized signal value', () => {
      assertEqual(TempoCoach.readinessBand({ recovery_signal: 'super_recovered' }), null);
    });
    it('returns null for null', () => {
      assertEqual(TempoCoach.readinessBand(null), null);
    });
    it('returns null for a non-object argument', () => {
      assertEqual(TempoCoach.readinessBand('well_recovered'), null);
      assertEqual(TempoCoach.readinessBand(42), null);
      assertEqual(TempoCoach.readinessBand(undefined), null);
    });
  });

  // ── suggestFocusDurationMs ─────────────────────────────────────────
  describe('TempoCoach.suggestFocusDurationMs', () => {
    it('well → 120-min block, band well, non-empty descriptive reason', () => {
      const s = TempoCoach.suggestFocusDurationMs({ recovery_signal: 'well_recovered' });
      assertEqual(s.ms, FOCUS_120);
      assertEqual(s.band, 'well');
      assertEqual(typeof s.reason, 'string');
      assert(s.reason.length > 0, 'reason present when suggesting');
    });
    it('strained → 90-min block, band strained, non-empty descriptive reason', () => {
      const s = TempoCoach.suggestFocusDurationMs({ recovery_signal: 'strained' });
      assertEqual(s.ms, FOCUS_90);
      assertEqual(s.band, 'strained');
      assertEqual(typeof s.reason, 'string');
      assert(s.reason.length > 0, 'reason present when suggesting');
    });
    it('neutral → ms null + reason null (no override of the user default)', () => {
      const s = TempoCoach.suggestFocusDurationMs({ recovery_signal: 'neutral' });
      assertEqual(s.ms, null);
      assertEqual(s.band, 'neutral');
      assertEqual(s.reason, null);
    });
    it('null (no signal) → ms null + reason null (no override)', () => {
      const s = TempoCoach.suggestFocusDurationMs(null);
      assertEqual(s.ms, null);
      assertEqual(s.band, null);
      assertEqual(s.reason, null);
    });
    it('suggesting reason is descriptive, not imperative', () => {
      const well = TempoCoach.suggestFocusDurationMs({ recovery_signal: 'well_recovered' });
      const strained = TempoCoach.suggestFocusDurationMs({ recovery_signal: 'strained' });
      [well.reason, strained.reason].forEach(r => {
        assert(!/\btake\b/i.test(r), 'no "take" imperative in reason: ' + r);
        assert(!/you should/i.test(r), 'no "you should" in reason: ' + r);
      });
    });
  });

  // ── doseSleepSlope ─────────────────────────────────────────────────
  describe('TempoCoach.doseSleepSlope', () => {
    // Clean monotonic pairs: later dose → later bedtime, strong correlation,
    // 5 points, x-spread 7→11 = 4h (≥1.5h). Bedtimes in evening hours.
    const cleanPairs = [
      { doseHour: 7, bedtimeHour: 22.0 },
      { doseHour: 8, bedtimeHour: 22.5 },
      { doseHour: 9, bedtimeHour: 23.0 },
      { doseHour: 10, bedtimeHour: 23.5 },
      { doseHour: 11, bedtimeHour: 24.0 - 0.0 }, // 24:00 isn't valid HH:MM but the slope input is a raw hour; use 23.9
    ];
    // Fix the last point to a valid evening hour to keep slope ~0.5/h.
    cleanPairs[4].bedtimeHour = 24.0; // raw hour fine for slope math

    it('happy path — 5 clean monotonic pairs, wide spread → usable:true, signed delta, nPoints', () => {
      const r = TempoCoach.doseSleepSlope(cleanPairs);
      assertEqual(r.usable, true);
      assertEqual(r.nPoints, 5);
      assert(r.slope > 0, 'positive slope (later dose → later bedtime)');
      // delta = slope(~0.5) * spread(4h) * 60 ≈ 120 min, positive.
      assert(r.deltaMinutes > 0, 'positive deltaMinutes for later-dose-later-sleep');
      assert(Number.isFinite(r.deltaMinutes), 'deltaMinutes finite');
      assert(noNaN(r), 'no NaN anywhere in the result');
    });

    it('preserves a NEGATIVE slope sign (earlier dose later, later dose earlier)', () => {
      const neg = [
        { doseHour: 7, bedtimeHour: 24.0 },
        { doseHour: 8, bedtimeHour: 23.5 },
        { doseHour: 9, bedtimeHour: 23.0 },
        { doseHour: 10, bedtimeHour: 22.5 },
        { doseHour: 11, bedtimeHour: 22.0 },
      ];
      const r = TempoCoach.doseSleepSlope(neg);
      assertEqual(r.usable, true);
      assert(r.slope < 0, 'negative slope');
      assert(r.deltaMinutes < 0, 'negative deltaMinutes');
    });

    it('suppression: fewer than 5 usable pairs → usable:false, "not enough" reason, zeroed non-NaN fields', () => {
      const four = cleanPairs.slice(0, 4);
      const r = TempoCoach.doseSleepSlope(four);
      assertEqual(r.usable, false);
      assert(/not enough data/i.test(r.reason), 'not-enough-data reason');
      assertEqual(r.slope, 0);
      assertEqual(r.intercept, 0);
      assertEqual(r.deltaMinutes, 0);
      assertEqual(r.nPoints, 4); // reports the count it saw
      assert(noNaN(r), 'no NaN in suppressed result');
    });

    it('suppression: empty / null / non-array input → usable:false, zeroed, never NaN', () => {
      [[], null, undefined, 'nope', {}].forEach(input => {
        const r = TempoCoach.doseSleepSlope(input);
        assertEqual(r.usable, false, 'usable:false for ' + JSON.stringify(input));
        assertEqual(r.slope, 0);
        assertEqual(r.deltaMinutes, 0);
        assert(noNaN(r), 'no NaN for ' + JSON.stringify(input));
      });
    });

    it('suppression: 5+ pairs but x-spread < 1.5h → usable:false ("not enough data")', () => {
      // 6 pairs, all dose hours within 8.0–9.0 (1.0h spread < 1.5h), strong y-trend.
      const tight = [
        { doseHour: 8.0, bedtimeHour: 22.0 },
        { doseHour: 8.2, bedtimeHour: 22.3 },
        { doseHour: 8.4, bedtimeHour: 22.6 },
        { doseHour: 8.6, bedtimeHour: 22.9 },
        { doseHour: 8.8, bedtimeHour: 23.2 },
        { doseHour: 9.0, bedtimeHour: 23.5 },
      ];
      const r = TempoCoach.doseSleepSlope(tight);
      assertEqual(r.usable, false);
      assert(/not enough data/i.test(r.reason), 'not-enough-data reason on tight spread');
      assert(noNaN(r), 'no NaN');
    });

    it('suppression: 5+ pairs, wide spread, but noisy/low-R^2 scatter → usable:false', () => {
      // Wide x-spread (6→12 = 6h) but bedtimes are a noisy cloud with no real trend.
      const noisy = [
        { doseHour: 6, bedtimeHour: 23.0 },
        { doseHour: 7, bedtimeHour: 21.5 },
        { doseHour: 8, bedtimeHour: 24.0 },
        { doseHour: 9, bedtimeHour: 22.0 },
        { doseHour: 10, bedtimeHour: 23.8 },
        { doseHour: 11, bedtimeHour: 21.8 },
        { doseHour: 12, bedtimeHour: 23.2 },
      ];
      const r = TempoCoach.doseSleepSlope(noisy);
      assertEqual(r.usable, false);
      assert(/not enough data/i.test(r.reason), 'not-enough-data reason on noisy scatter');
      assert(noNaN(r), 'no NaN');
    });

    it('boundary: exactly 5 pairs AND exactly 1.5h spread + strong correlation → usable:true', () => {
      // x from 8.0 to 9.5 (spread exactly 1.5h), 5 points, clean linear y.
      const edge = [
        { doseHour: 8.0, bedtimeHour: 22.0 },
        { doseHour: 8.375, bedtimeHour: 22.5 },
        { doseHour: 8.75, bedtimeHour: 23.0 },
        { doseHour: 9.125, bedtimeHour: 23.5 },
        { doseHour: 9.5, bedtimeHour: 24.0 },
      ];
      const r = TempoCoach.doseSleepSlope(edge);
      assertEqual(r.nPoints, 5);
      assertEqual(r.usable, true, 'exactly-at-thresholds clean data is usable');
      assert(r.deltaMinutes !== 0, 'a delta is reported');
      assert(noNaN(r), 'no NaN');
    });

    it('treats a small-hours bedtime (0.5 = 12:30 AM) as a post-midnight night hour after an 11 PM bedtime', () => {
      // If 0.5 were treated literally (< 23), the fit would invert. The engine
      // lifts hours < 12 by +24 so 0.5 → 24.5 sits AFTER 23.0. With dose timing
      // monotonic, the slope must stay positive (later dose → later, into the AM).
      const pastMidnight = [
        { doseHour: 7, bedtimeHour: 22.0 },
        { doseHour: 8, bedtimeHour: 23.0 },
        { doseHour: 9, bedtimeHour: 23.5 },
        { doseHour: 10, bedtimeHour: 0.0 },   // 12:00 AM → treated as 24.0
        { doseHour: 11, bedtimeHour: 0.5 },   // 12:30 AM → treated as 24.5
      ];
      const r = TempoCoach.doseSleepSlope(pastMidnight);
      assertEqual(r.usable, true);
      assert(r.slope > 0, 'past-midnight bedtimes treated as continuous late hours → positive slope');
      assert(r.deltaMinutes > 0, 'positive delta');
      assert(noNaN(r), 'no NaN');
    });

    it('ignores entries with non-finite doseHour/bedtimeHour and never returns NaN', () => {
      const mixed = [
        { doseHour: 7, bedtimeHour: 22.0 },
        { doseHour: NaN, bedtimeHour: 22.5 },        // dropped
        { doseHour: 8, bedtimeHour: 22.5 },
        { doseHour: 8.5, bedtimeHour: Infinity },    // dropped (bedtime non-finite)
        { doseHour: null, bedtimeHour: 23.0 },       // dropped (doseHour non-finite)
        { doseHour: 9, bedtimeHour: 23.0 },
        { doseHour: 10, bedtimeHour: 23.5 },
        { doseHour: 11, bedtimeHour: 24.0 },
        { bedtimeHour: 23.0 },                       // dropped (no doseHour)
        null,                                        // dropped
      ];
      const r = TempoCoach.doseSleepSlope(mixed);
      // 5 clean pairs survive (doseHour 7, 8, 9, 10, 11) → enough, wide spread, clean.
      assertEqual(r.nPoints, 5);
      assert(noNaN(r), 'no NaN in any field');
      assert(Number.isFinite(r.slope), 'slope finite');
      assert(Number.isFinite(r.intercept), 'intercept finite');
      assert(Number.isFinite(r.deltaMinutes), 'deltaMinutes finite');
    });
  });

  // ── shouldNudge ────────────────────────────────────────────────────
  describe('TempoCoach.shouldNudge', () => {
    it('well signal → nudge:true with descriptive (non-imperative) title/body', () => {
      const n = TempoCoach.shouldNudge({ recovery_signal: 'well_recovered' }, NOW);
      assertEqual(n.nudge, true);
      assertEqual(typeof n.title, 'string');
      assertEqual(typeof n.body, 'string');
      assert(n.body.length > 0, 'body present');
      assert(!/\btake\b/i.test(n.body), 'no "take" imperative in well body: ' + n.body);
      assert(!/you should/i.test(n.body), 'no "you should" in well body: ' + n.body);
    });
    it('strained signal → nudge:true with descriptive body', () => {
      const n = TempoCoach.shouldNudge({ recovery_signal: 'strained' }, NOW);
      assertEqual(n.nudge, true);
      assertEqual(typeof n.body, 'string');
      assert(n.body.length > 0, 'body present');
      assert(!/\btake\b/i.test(n.body), 'no "take" imperative in strained body: ' + n.body);
      assert(!/you should/i.test(n.body), 'no "you should" in strained body: ' + n.body);
    });
    it('neutral → nudge:false with title/body null', () => {
      const n = TempoCoach.shouldNudge({ recovery_signal: 'neutral' }, NOW);
      assertEqual(n.nudge, false);
      assertEqual(n.title, null);
      assertEqual(n.body, null);
    });
    it('null (no signal) → nudge:false with title/body null', () => {
      const n = TempoCoach.shouldNudge(null, NOW);
      assertEqual(n.nudge, false);
      assertEqual(n.title, null);
      assertEqual(n.body, null);
    });
  });

  // ── buildTodayModel ────────────────────────────────────────────────
  describe('TempoCoach.buildTodayModel', () => {
    // Fully-populated deps: recovery well, one once-daily med logged, sleep
    // logged today, two focus sessions today, and a dose/bedtime history that
    // yields a usable dose→sleep slope.
    function populatedDeps() {
      // Build 6 dose days each followed by a logged bedtime, monotonic, wide
      // spread, clean — so _buildDoseSleep → doseSleepSlope is usable.
      const doseLog = [];
      const restLog = {};
      for (let i = 0; i < 6; i++) {
        const day = -(i + 1);          // dose days D-1..D-6
        const doseHour = 7 + i * 0.7;  // 7.0 .. 10.5 → spread 3.5h
        doseLog.push({ takenAt: atLocalDayHour(day, Math.floor(doseHour), Math.round((doseHour % 1) * 60)) });
        // following night's bedtime climbs with dose hour (clean trend)
        const bedMin = Math.round((22 + i * 0.4) % 24 * 60);
        const bh = Math.floor(bedMin / 60), bm = bedMin % 60;
        restLog[dayKeyOffset(day + 1)] = {
          sleep: { hours: 7, quality: 4, bedtime: String(bh).padStart(2, '0') + ':' + String(bm).padStart(2, '0') },
        };
      }
      // Today's sleep entry (the "last night" row).
      restLog[dayKeyOffset(0)] = { sleep: { hours: 7.5, quality: 4, bedtime: '23:00' } };

      const med = stubMed({
        name: 'Vyvanse', dose: '60 mg',
        status: { kind: 'done', takenToday: 1, expected: 1 },
        doseLog: doseLog,
      });

      return {
        now: () => NOW,
        getRecoveryLatest: () => ({ recovery_signal: 'well_recovered', hrv: 60 }),
        getMeds: () => [med],
        getRestLog: () => restLog,
        getSessionsSync: () => [
          { type: 'flow', date: new Date(atLocalDayHour(0, 9)).toISOString(), duration: 90 * 60000 },
          { type: 'pomodoro', date: new Date(atLocalDayHour(0, 14)).toISOString(), duration: 25 * 60000 },
          { type: 'stopwatch', date: new Date(atLocalDayHour(0, 16)).toISOString(), duration: 99 * 60000 }, // ignored
          { type: 'flow', date: new Date(atLocalDayHour(-3, 9)).toISOString(), duration: 60 * 60000 },       // other day, ignored
        ],
      };
    }

    it('populated deps → assembles band/recovery/focus/dose/sleep/doseSleep without throwing', () => {
      const m = TempoCoach.buildTodayModel(populatedDeps());
      assertEqual(m.band, 'well');
      assertEqual(m.hasRecovery, true);
      assertEqual(m.empty, false);
      assert(m.focusSuggestion && m.focusSuggestion.ms === FOCUS_120, 'well → 120-min suggestion');
      assertEqual(m.doseStatus.hasMeds, true);
      assertEqual(m.doseStatus.meds.length, 1);
      assertEqual(m.doseStatus.meds[0].name, 'Vyvanse');
      assertEqual(m.sleep.logged, true);
      assert(m.focusTodayMs > 0, 'focus minutes logged today');
      assert(m.doseSleep, 'doseSleep present');
      assert(noNaN(m), 'no NaN anywhere in the populated model');
    });

    it('populated focusTodayMs sums only flow+pomodoro dated TODAY (90+25 min)', () => {
      const m = TempoCoach.buildTodayModel(populatedDeps());
      // flow 90m + pomodoro 25m today; stopwatch and the -3d flow excluded.
      assertEqual(m.focusTodayMs, (90 + 25) * 60000);
    });

    it('doseSleep over the populated history is usable (slope assembled from live dose log + rest log)', () => {
      const m = TempoCoach.buildTodayModel(populatedDeps());
      assertEqual(m.doseSleep.usable, true);
      assertEqual(m.doseSleep.medName, 'Vyvanse');
      assert(noNaN(m.doseSleep), 'no NaN in doseSleep');
    });

    it('doseStatus sets anyUnlogged for kind "none" and kind "partial"', () => {
      const noneMed = stubMed({ name: 'A', status: { kind: 'none', takenToday: 0, expected: 1 } });
      const partialMed = stubMed({ name: 'B', status: { kind: 'partial', takenToday: 1, expected: 2 } });
      const m = TempoCoach.buildTodayModel({
        now: () => NOW,
        getRecoveryLatest: () => null,
        getMeds: () => [noneMed, partialMed],
        getRestLog: () => ({}),
        getSessionsSync: () => [],
      });
      assertEqual(m.doseStatus.anyUnlogged, true);
      assertEqual(m.doseStatus.allLogged, false);
    });

    it('doseStatus never flags anyUnlogged for kind "na" (as-needed has no expectation)', () => {
      const naMed = stubMed({ name: 'PRN', status: { kind: 'na', takenToday: 0, expected: null } });
      const m = TempoCoach.buildTodayModel({
        now: () => NOW,
        getRecoveryLatest: () => null,
        getMeds: () => [naMed],
        getRestLog: () => ({}),
        getSessionsSync: () => [],
      });
      assertEqual(m.doseStatus.hasMeds, true);
      assertEqual(m.doseStatus.anyUnlogged, false);
      assertEqual(m.doseStatus.allLogged, true);
    });

    it('doseStatus reads live MedsManager-shaped accessors (getStatusToday/getName/getDose)', () => {
      const med = stubMed({ name: 'Adderall', dose: '20 mg', status: { kind: 'done', takenToday: 2, expected: 2 } });
      const m = TempoCoach.buildTodayModel({
        now: () => NOW, getRecoveryLatest: () => null,
        getMeds: () => [med], getRestLog: () => ({}), getSessionsSync: () => [],
      });
      const row = m.doseStatus.meds[0];
      assertEqual(row.name, 'Adderall');
      assertEqual(row.dose, '20 mg');
      assertEqual(row.kind, 'done');
      assertEqual(row.takenToday, 2);
      assertEqual(row.expected, 2);
    });

    it('empty deps → valid model with empty:true, no recovery/meds/sleep/focus, never throws or NaN', () => {
      const m = TempoCoach.buildTodayModel({});
      assertEqual(m.empty, true);
      assertEqual(m.hasRecovery, false);
      assertEqual(m.band, null);
      assertEqual(m.doseStatus.hasMeds, false);
      assertEqual(m.sleep.logged, false);
      assertEqual(m.focusTodayMs, 0);
      assert(m.doseSleep && m.doseSleep.usable === false, 'doseSleep suppressed on empty');
      assert(noNaN(m), 'no NaN in the empty model');
    });

    it('buildTodayModel(undefined) does not throw and returns the empty model', () => {
      const m = TempoCoach.buildTodayModel(undefined);
      assertEqual(m.empty, true);
      assert(noNaN(m), 'no NaN');
    });

    it('sparse deps (sleep only, no recovery/meds/focus) → empty:false, hasRecovery:false', () => {
      const m = TempoCoach.buildTodayModel({
        now: () => NOW,
        getRecoveryLatest: () => null,
        getMeds: () => [],
        getRestLog: () => ({ [dayKeyOffset(0)]: { sleep: { hours: 6.5, quality: 3, bedtime: '23:30' } } }),
        getSessionsSync: () => [],
      });
      assertEqual(m.empty, false);          // local value present (sleep)
      assertEqual(m.hasRecovery, false);    // recovery re-lens additive, absent
      assertEqual(m.sleep.logged, true);
      assertEqual(m.sleep.hours, 6.5);
      assert(noNaN(m), 'no NaN');
    });

    it('throwing deps accessors are swallowed — model still assembles without throwing', () => {
      const m = TempoCoach.buildTodayModel({
        now: () => NOW,
        getRecoveryLatest: () => { throw new Error('feed down'); },
        getMeds: () => { throw new Error('meds down'); },
        getRestLog: () => { throw new Error('rest down'); },
        getSessionsSync: () => { throw new Error('sessions down'); },
      });
      assertEqual(m.empty, true);
      assertEqual(m.hasRecovery, false);
      assertEqual(m.doseStatus.hasMeds, false);
      assertEqual(m.focusTodayMs, 0);
      assert(noNaN(m), 'no NaN even when every accessor throws');
    });
  });
})();
