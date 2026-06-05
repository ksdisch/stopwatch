// Tests for js/rhythm-panel-bfrb-triggers.js (BFRB Triggers panel).
//
// The panel is pure: build() reads ONLY via injected deps (getBfrbEvents + now)
// and render() returns card HTML and must never throw. We stub the live stream
// directly — no BfrbEvents seeding required.
//
// Central correctness contracts under test:
//   - The forgiving clean-streak is a FIXED no-catch WINDOW of elapsed time
//     (hoursSinceLast → cleanDays), NEVER "days with no catch logged" — a catch
//     earlier *today* must NOT read as "1 day clean".
//   - The breakdown reads the LIVE consolidated stream (deps.getBfrbEvents),
//     not the snapshot trend path (deps.getBfrbTrend).

(function () {
  const RI = RhythmInsights;
  const HOUR = 3600000;
  const DAY = 86400000;
  // Fixed local noon so recent7 day-bucketing is boundary-stable.
  const NOW = new Date(2026, 4, 20, 12, 0, 0, 0).getTime();

  function panel() { return RI.getPanels().find(p => p.key === 'bfrb-triggers'); }

  // A catch `hoursAgo` before NOW, with optional { triggerZone, urgeLevel, context }.
  function ev(hoursAgo, extra) {
    return Object.assign({ takenAt: NOW - hoursAgo * HOUR, context: 'global' }, extra || {});
  }

  function depsOf(events) {
    return { getBfrbEvents: () => events, now: () => NOW };
  }

  describe('BFRB Triggers panel — registration + build', () => {
    it('is registered at order 45 with the right title', () => {
      const p = panel();
      assert(p, 'bfrb-triggers registered');
      assertEqual(p.order, 45);
      assertEqual(p.title, 'BFRB Triggers');
    });

    it('build reads the LIVE stream (getBfrbEvents), not the snapshot trend', () => {
      let calledLive = false, calledTrend = false;
      const deps = {
        getBfrbEvents: () => { calledLive = true; return []; },
        getBfrbTrend: async () => { calledTrend = true; return { series: [], total: 0 }; },
        now: () => NOW,
      };
      panel().build(deps);
      assert(calledLive, 'build called getBfrbEvents');
      assert(!calledTrend, 'build did NOT call getBfrbTrend');
    });

    it('build tolerates missing deps without throwing', () => {
      let ok = true;
      try { panel().build({}); panel().build(undefined); } catch (e) { ok = false; }
      assert(ok, 'build is null-safe');
    });
  });

  describe('BFRB Triggers panel — forgiving clean-streak math', () => {
    it('no catches ever → hasData false, 7 clean dots', () => {
      const m = panel().build(depsOf([]));
      assertEqual(m.streak.hasData, false);
      assertEqual(m.streak.cleanDays, 0);
      assertEqual(m.streak.recent7.length, 7);
      assert(m.streak.recent7.every(d => d.clean), 'all 7 recent days clean when no catches');
    });

    it('last catch 30h ago → 1 day clean (floor of the elapsed window)', () => {
      const m = panel().build(depsOf([ev(30)]));
      assert(m.streak.hasData, 'has data');
      assertClose(m.streak.hoursSinceLast, 30, 0.001);
      assertEqual(m.streak.cleanDays, 1);
      // Only one catch → the single open gap (30h) is the longest clean stretch.
      assertEqual(m.streak.longestCleanDays, 1);
    });

    it('a catch earlier TODAY does NOT inflate the streak to a clean day', () => {
      // The anti-pattern guard: 2h since the last catch must read as 0 clean
      // days (and the "Xh since last catch" hero), NOT "today has no later log → 1 day".
      const m = panel().build(depsOf([ev(2)]));
      assertEqual(m.streak.cleanDays, 0);
      assertClose(m.streak.hoursSinceLast, 2, 0.001);
      // recent7 today bucket reflects the real catch (not clean).
      const today = m.streak.recent7.find(d => d.isToday);
      assert(today && !today.clean && today.catchCount === 1, 'today shows the catch, not clean');
    });

    it('longest clean stretch spans the largest inter-catch gap', () => {
      // Catches 100h and 10h ago → 90h gap between them, 10h open gap now.
      const m = panel().build(depsOf([ev(100), ev(10)]));
      assertClose(m.streak.hoursSinceLast, 10, 0.001);
      assertEqual(m.streak.cleanDays, 0);
      assertClose(m.streak.longestCleanHours, 90, 0.001);
      assertEqual(m.streak.longestCleanDays, 3); // floor(90/24)
    });

    it('recent7 buckets per-day catch counts newest-first', () => {
      // two catches today, one yesterday, none else in the last 7 days
      const m = panel().build(depsOf([ev(1), ev(3), ev(25)]));
      const r = m.streak.recent7;
      assertEqual(r.length, 7);
      assertEqual(r[0].catchCount, 2);  // today
      assert(!r[0].clean, 'today not clean');
      assertEqual(r[1].catchCount, 1);  // yesterday
      assert(r.slice(2).every(d => d.clean), 'days 3..7 clean');
    });
  });

  describe('BFRB Triggers panel — antecedent breakdown', () => {
    it('trigger leaderboard counts + untagged bucket, sorted desc', () => {
      const events = [
        ev(1, { triggerZone: 'stress' }),
        ev(2, { triggerZone: 'stress' }),
        ev(3, { triggerZone: 'stress' }),
        ev(4, { triggerZone: 'bored' }),
        ev(5), // untagged
        ev(6), // untagged
      ];
      const m = panel().build(depsOf(events));
      assertEqual(m.breakdown.total, 6);
      assertEqual(m.breakdown.triggers.length, 2);
      assertEqual(m.breakdown.triggers[0].zone, 'stress');
      assertEqual(m.breakdown.triggers[0].count, 3);
      assertEqual(m.breakdown.triggers[1].zone, 'bored');
      assertEqual(m.breakdown.untagged, 2);
    });

    it('urge mix tallies 1/2/3 and ignores out-of-range', () => {
      const events = [
        ev(1, { urgeLevel: 1 }), ev(2, { urgeLevel: 1 }),
        ev(3, { urgeLevel: 2 }), ev(4, { urgeLevel: 3 }),
        ev(5, { urgeLevel: 9 }), // invalid — counted as a catch but not an urge
        ev(6), // no urge
      ];
      const m = panel().build(depsOf(events));
      assertEqual(m.breakdown.urge[1], 2);
      assertEqual(m.breakdown.urge[2], 1);
      assertEqual(m.breakdown.urge[3], 1);
      assertEqual(m.breakdown.urgeTagged, 4);
    });

    it('context split tallies global/flow/pomodoro', () => {
      const events = [
        ev(1, { context: 'flow' }), ev(2, { context: 'pomodoro' }),
        ev(3, { context: 'global' }), ev(4, { context: 'global' }),
      ];
      const m = panel().build(depsOf(events));
      assertEqual(m.breakdown.context.flow, 1);
      assertEqual(m.breakdown.context.pomodoro, 1);
      assertEqual(m.breakdown.context.global, 2);
    });

    it('breakdown window excludes catches older than 14 days; streak still sees them', () => {
      const events = [
        ev(20 * 24, { triggerZone: 'stress' }), // 20 days ago — outside the 14d window
        ev(2 * 24, { triggerZone: 'bored' }),   // 2 days ago — inside
      ];
      const m = panel().build(depsOf(events));
      assertEqual(m.breakdown.total, 1, 'only the in-window catch counts');
      assertEqual(m.breakdown.triggers.length, 1);
      assertEqual(m.breakdown.triggers[0].zone, 'bored');
      // The streak uses the FULL history, so the most recent catch is 2 days ago.
      assertEqual(m.streak.cleanDays, 2);
    });
  });

  describe('BFRB Triggers panel — render', () => {
    it('empty card (with panel hook) when there are no catches at all', () => {
      const m = panel().build(depsOf([]));
      const html = panel().render(m);
      assert(/data-insight-panel="bfrb-triggers"/.test(html), 'card hook present');
      assert(/No BFRB catches logged yet/.test(html), 'empty copy present');
      assert(!/analytics-streak-number/.test(html), 'no streak hero in the empty state');
    });

    it('renders the streak hero + trigger leaderboard + urge mix when populated', () => {
      const events = [
        ev(2, { triggerZone: 'stress', urgeLevel: 3 }),
        ev(5, { triggerZone: 'stress', urgeLevel: 2 }),
        ev(8, { triggerZone: 'bored', urgeLevel: 1 }),
        ev(30), // untagged + no urge
      ];
      const html = panel().render(panel().build(depsOf(events)));
      assert(/data-insight-panel="bfrb-triggers"/.test(html), 'card hook present');
      assert(/analytics-streak-number/.test(html), 'streak hero present');
      assert(/TOP TRIGGERS/.test(html), 'trigger leaderboard heading present');
      assert(/>Stress</.test(html), 'Stress row present (capitalized)');
      assert(/>Untagged</.test(html), 'untagged row present');
      assert(/URGE INTENSITY/.test(html), 'urge mix present');
      assert(/4 catches · 14d/.test(html), 'aside total/window present');
    });

    it('catch days get the amber catch-dot class; clean days the green on-dot', () => {
      const html = panel().render(panel().build(depsOf([ev(2)])));
      assert(/bfrb-streak-dot-catch/.test(html), 'today (a catch day) uses the catch dot');
      assert(/analytics-streak-dot-on/.test(html), 'clean days use the green on-dot');
    });

    it('shows a streak hero but no leaderboard when the only catches are >14d old', () => {
      const html = panel().render(panel().build(depsOf([ev(20 * 24)])));
      assert(/analytics-streak-number/.test(html), 'streak hero still renders from full history');
      assert(!/TOP TRIGGERS/.test(html), 'no leaderboard when nothing is in the 14d window');
    });

    it('never throws on a missing / empty model', () => {
      let ok = true;
      try {
        panel().render(undefined);
        panel().render({});
        panel().render({ breakdown: {}, streak: {} });
      } catch (e) { ok = false; }
      assert(ok, 'render tolerates empty / missing model');
    });
  });
})();
