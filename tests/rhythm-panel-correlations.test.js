// Tests for js/rhythm-panel-correlations.js — the Correlations synthesis panel.
// Panel reads via injected deps, so these pass plain seeded data — no live
// History / RecoveryFeed / BfrbEvents / RecoveryUI modules required.
//
// Sessions carry an ISO `date` string (per the deps contract). Recovery rows
// carry a 'YYYY-MM-DD' `day` + `recovery_signal`. BFRB trend carries a
// { series:[{date, count}], total } shape. Rest log is keyed by 'YYYY-MM-DD'
// with a nested { sleep: { hours } }.

(function () {
  const RI = RhythmInsights;
  const NOW = new Date(2026, 4, 20, 12, 0, 0).getTime(); // 2026-05-20, noon local

  // ms timestamp `daysFromToday` away at the given local hour/min.
  function atLocalDayHour(daysFromToday, hour, min) {
    const b = new Date(NOW);
    return new Date(b.getFullYear(), b.getMonth(), b.getDate() + daysFromToday, hour, min || 0, 0, 0).getTime();
  }
  function dayKeyOffset(daysFromToday) {
    const b = new Date(NOW);
    return Utils.localDateKey(new Date(b.getFullYear(), b.getMonth(), b.getDate() + daysFromToday));
  }
  const MIN = 60000; // ms per minute

  // Session factory — `date` is an ISO string per the deps contract.
  function sess(type, daysFromToday, hour, durationMin) {
    return {
      type: type,
      date: new Date(atLocalDayHour(daysFromToday, hour)).toISOString(),
      duration: durationMin * MIN,
    };
  }

  function panel() { return RI.getPanels().find(p => p.key === 'correlations'); }

  // Full deps stub — every accessor present + overridable, mirroring the live
  // deps surface the panel reads.
  function depsWith(o) {
    o = o || {};
    return {
      now: () => NOW,
      getSessions: async () => o.sessions || [],
      getRecoveryHistory: () => ({ rows: o.recoveryRows || [] }),
      getBfrbTrend: async () => o.bfrbTrend || { series: [], total: 0 },
      getRestLog: () => o.restLog || {},
    };
  }

  describe('Correlations panel', () => {
    it('is registered at order 70 with the right title', () => {
      const p = panel();
      assert(p, 'correlations registered');
      assertEqual(p.order, 70);
      assertEqual(p.title, 'Correlations');
    });

    it('emits no callouts when there is no data (empty everything)', async () => {
      const model = await panel().build(depsWith({}));
      assertEqual(model.callouts.length, 0);
      assertEqual(model.dayCount, 0);
    });

    it('emits no callouts when recovery rows are empty even with focus + sleep', async () => {
      // Sessions + sleep present but NO recovery signal → callout (a)/(b) can't
      // fire; only 2 paired sleep/focus days → callout (c) needs ≥4 → none.
      const model = await panel().build(depsWith({
        sessions: [sess('flow', 0, 9, 60), sess('pomodoro', -1, 10, 30)],
        recoveryRows: [],
        restLog: {
          [dayKeyOffset(0)]: { sleep: { hours: 8 } },
          [dayKeyOffset(-1)]: { sleep: { hours: 6 } },
        },
      }));
      assertEqual(model.callouts.length, 0);
    });

    it('renders the empty-state card (with panel hook + copy) when callouts empty', () => {
      const html = panel().render({ callouts: [], dayCount: 0 });
      assert(/data-insight-panel="correlations"/.test(html), 'card hook present');
      assert(/Keep logging/.test(html), 'empty-state copy present');
    });

    it('emits callout (a) with correctly rounded focus averages for well vs strained days', async () => {
      // well-recovered days: -1 (90 min) and -3 (30 min) → mean 60 → "60 min"
      // strained days:       -2 (20 min) and -4 (10 min) → mean 15 → "15 min"
      const model = await panel().build(depsWith({
        sessions: [
          sess('flow', -1, 9, 90),
          sess('pomodoro', -3, 9, 30),
          sess('flow', -2, 9, 20),
          sess('pomodoro', -4, 9, 10),
        ],
        recoveryRows: [
          { day: dayKeyOffset(-1), recovery_signal: 'well_recovered' },
          { day: dayKeyOffset(-3), recovery_signal: 'well_recovered' },
          { day: dayKeyOffset(-2), recovery_signal: 'strained' },
          { day: dayKeyOffset(-4), recovery_signal: 'strained' },
        ],
      }));
      const a = model.callouts.find(c => /well-recovered days vs/.test(c));
      assert(a, 'focus correlation callout present');
      assertEqual(a, 'Focus averaged 60 min on well-recovered days vs 15 min on strained days.');
    });

    it('rounds focus averages (5/3 wellMean, 0 strainedMean) without fractional output', async () => {
      // well days -1(2),-2(1),-3(2) → focus mins 2,1,2 mean 5/3=1.666… → round 2
      // strained day -4 → no focus → 0
      const model = await panel().build(depsWith({
        sessions: [
          { type: 'flow', date: new Date(atLocalDayHour(-1, 9)).toISOString(), duration: 2 * MIN },
          { type: 'flow', date: new Date(atLocalDayHour(-2, 9)).toISOString(), duration: 1 * MIN },
          { type: 'flow', date: new Date(atLocalDayHour(-3, 9)).toISOString(), duration: 2 * MIN },
        ],
        recoveryRows: [
          { day: dayKeyOffset(-1), recovery_signal: 'well_recovered' },
          { day: dayKeyOffset(-2), recovery_signal: 'well_recovered' },
          { day: dayKeyOffset(-3), recovery_signal: 'well_recovered' },
          { day: dayKeyOffset(-4), recovery_signal: 'strained' },
        ],
      }));
      const a = model.callouts.find(c => /well-recovered days vs/.test(c));
      assert(a, 'focus correlation callout present');
      assertEqual(a, 'Focus averaged 2 min on well-recovered days vs 0 min on strained days.');
      // No fractional digits in callout (a).
      assert(!/\d\.\d/.test(a), 'focus callout uses integer minutes');
    });

    it('emits callout (b) BFRB rate (1-decimal) for strained vs well days', async () => {
      // strained days -2,-4 with counts 4,2 → mean 3.0
      // well days     -1,-3 with counts 0(absent),1 → mean 0.5
      const model = await panel().build(depsWith({
        sessions: [sess('flow', -1, 9, 30)], // give (a) something to compute
        recoveryRows: [
          { day: dayKeyOffset(-1), recovery_signal: 'well_recovered' },
          { day: dayKeyOffset(-3), recovery_signal: 'well_recovered' },
          { day: dayKeyOffset(-2), recovery_signal: 'strained' },
          { day: dayKeyOffset(-4), recovery_signal: 'strained' },
        ],
        bfrbTrend: {
          series: [
            { date: dayKeyOffset(-2), count: 4 },
            { date: dayKeyOffset(-4), count: 2 },
            { date: dayKeyOffset(-3), count: 1 },
          ],
          total: 7,
        },
      }));
      const b = model.callouts.find(c => /BFRB catches ran/.test(c));
      assert(b, 'bfrb correlation callout present');
      assertEqual(b, 'BFRB catches ran 3.0/day on strained days vs 0.5/day on well-recovered days.');
    });

    it('suppresses callout (b) when neither group recorded any BFRB count', async () => {
      const model = await panel().build(depsWith({
        sessions: [sess('flow', -1, 9, 30)],
        recoveryRows: [
          { day: dayKeyOffset(-1), recovery_signal: 'well_recovered' },
          { day: dayKeyOffset(-2), recovery_signal: 'strained' },
        ],
        bfrbTrend: { series: [], total: 0 },
      }));
      assert(model.callouts.some(c => /well-recovered days vs/.test(c)), '(a) still fires');
      assert(!model.callouts.some(c => /BFRB catches ran/.test(c)), '(b) suppressed when no bfrb data');
    });

    it('emits callout (c) sleep↔focus once ≥4 paired days with both buckets non-empty', async () => {
      // 4 paired days, all with focus + sleep:
      //   -1: 8h, 60 min   ┐ ≥7h bucket → [60, 40] mean 50
      //   -2: 7h, 40 min   ┘
      //   -3: 6h, 20 min   ┐ <7h bucket → [20, 10] mean 15
      //   -4: 5h, 10 min   ┘
      const model = await panel().build(depsWith({
        sessions: [
          sess('flow', -1, 9, 60),
          sess('flow', -2, 9, 40),
          sess('flow', -3, 9, 20),
          sess('flow', -4, 9, 10),
        ],
        restLog: {
          [dayKeyOffset(-1)]: { sleep: { hours: 8 } },
          [dayKeyOffset(-2)]: { sleep: { hours: 7 } },
          [dayKeyOffset(-3)]: { sleep: { hours: 6 } },
          [dayKeyOffset(-4)]: { sleep: { hours: 5 } },
        },
      }));
      const c = model.callouts.find(x => /≥7h sleep/.test(x));
      assert(c, 'sleep↔focus callout present');
      assertEqual(c, 'Focus was 50 min after ≥7h sleep vs 15 min after <7h.');
    });

    it('suppresses callout (c) when fewer than 4 paired days', async () => {
      const model = await panel().build(depsWith({
        sessions: [sess('flow', -1, 9, 60), sess('flow', -2, 9, 40), sess('flow', -3, 9, 20)],
        restLog: {
          [dayKeyOffset(-1)]: { sleep: { hours: 8 } },
          [dayKeyOffset(-2)]: { sleep: { hours: 7 } },
          [dayKeyOffset(-3)]: { sleep: { hours: 6 } },
        },
      }));
      assert(!model.callouts.some(x => /≥7h sleep/.test(x)), '(c) suppressed under 4 paired days');
    });

    it('suppresses callout (c) when one sleep bucket is empty (all nights ≥7h)', async () => {
      const model = await panel().build(depsWith({
        sessions: [
          sess('flow', -1, 9, 60), sess('flow', -2, 9, 40),
          sess('flow', -3, 9, 20), sess('flow', -4, 9, 10),
        ],
        restLog: {
          [dayKeyOffset(-1)]: { sleep: { hours: 8 } },
          [dayKeyOffset(-2)]: { sleep: { hours: 7.5 } },
          [dayKeyOffset(-3)]: { sleep: { hours: 9 } },
          [dayKeyOffset(-4)]: { sleep: { hours: 7 } },
        },
      }));
      assert(!model.callouts.some(x => /≥7h sleep/.test(x)), '(c) suppressed when <7h bucket empty');
    });

    it('never produces NaN in any callout (mixed seeded data)', async () => {
      const model = await panel().build(depsWith({
        sessions: [
          sess('flow', -1, 9, 90), sess('pomodoro', -2, 9, 20),
          sess('flow', -3, 9, 30), sess('flow', -4, 9, 10),
        ],
        recoveryRows: [
          { day: dayKeyOffset(-1), recovery_signal: 'well_recovered' },
          { day: dayKeyOffset(-3), recovery_signal: 'well_recovered' },
          { day: dayKeyOffset(-2), recovery_signal: 'strained' },
          { day: dayKeyOffset(-4), recovery_signal: 'strained' },
        ],
        bfrbTrend: { series: [{ date: dayKeyOffset(-2), count: 3 }], total: 3 },
        restLog: {
          [dayKeyOffset(-1)]: { sleep: { hours: 8 } },
          [dayKeyOffset(-2)]: { sleep: { hours: 6 } },
          [dayKeyOffset(-3)]: { sleep: { hours: 7.5 } },
          [dayKeyOffset(-4)]: { sleep: { hours: 5.5 } },
        },
      }));
      assert(model.callouts.length >= 1, 'at least one callout emitted');
      model.callouts.forEach(c => assert(!/NaN/.test(c), 'no NaN in callout: ' + c));
    });

    it('render(populated) returns a <ul class="rhythm-callout-list"> and never throws', () => {
      const model = {
        callouts: [
          'Focus averaged 60 min on well-recovered days vs 15 min on strained days.',
          'BFRB catches ran 3.0/day on strained days vs 0.5/day on well-recovered days.',
        ],
        dayCount: 4,
      };
      let html;
      html = panel().render(model);
      assertEqual(typeof html, 'string');
      assert(/<ul class="rhythm-callout-list">/.test(html), 'callout list present');
      assert(/<li class="rhythm-callout">/.test(html), 'callout item present');
      assert(/data-insight-panel="correlations"/.test(html), 'card hook present');
      // Two seeded callouts → two list items.
      assertEqual((html.match(/<li class="rhythm-callout">/g) || []).length, 2);
      assert(!/NaN/.test(html), 'no NaN in rendered html');
    });

    it('ignores recovery rows outside the 14-day window', async () => {
      // A stale strained day 30 days back must not pair with an in-window
      // well-recovered day — only the in-window days count, so with only one
      // in-window group present callout (a) does NOT fire.
      const model = await panel().build(depsWith({
        sessions: [sess('flow', -1, 9, 60)],
        recoveryRows: [
          { day: dayKeyOffset(-1), recovery_signal: 'well_recovered' },
          { day: dayKeyOffset(-30), recovery_signal: 'strained' }, // out of window
        ],
      }));
      assert(!model.callouts.some(c => /well-recovered days vs/.test(c)),
        'out-of-window strained day excluded → (a) suppressed');
    });
  });
})();
