// Tests for js/rhythm-panel-focus-minutes.js — the Focus Minutes Rhythm panel.
// Panel reads via injected deps, so these pass plain session data — no History
// seeding required. Sessions carry an ISO `date` string (per the panel contract).

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
  function sess(id, type, daysFromToday, hour, durationMin) {
    return {
      id: id,
      type: type,
      date: new Date(atLocalDayHour(daysFromToday, hour)).toISOString(),
      duration: durationMin * MIN,
    };
  }

  function panel() { return RI.getPanels().find(p => p.key === 'focus-minutes'); }
  function depsWith(sessions) {
    return { now: () => NOW, getSessions: async () => sessions };
  }

  describe('Focus Minutes panel', () => {
    it('is registered at order 30 with the right title', () => {
      const p = panel();
      assert(p, 'focus-minutes registered');
      assertEqual(p.order, 30);
      assertEqual(p.title, 'Focus Minutes');
    });

    it('returns totalMin 0 + a 14-length series when no sessions', async () => {
      const model = await panel().build(depsWith([]));
      assertEqual(model.totalMin, 0);
      assertEqual(model.maxMin, 0);
      assertEqual(model.series.length, 14);
    });

    it('renders the empty-state card (with panel hook) when totalMin is 0', () => {
      const html = panel().render({ days: 14, series: [], totalMin: 0, maxMin: 0 });
      assert(/data-insight-panel="focus-minutes"/.test(html), 'card hook present');
      assert(/No focus sessions in the last 14 days\./.test(html), 'empty-state copy present');
    });

    it('sums flow + pomodoro minutes per day and excludes non-focus types', async () => {
      const sessions = [
        sess('a', 'flow', 0, 9, 25),       // today: 25
        sess('b', 'pomodoro', 0, 11, 50),  // today: +50 → 75
        sess('c', 'stopwatch', 0, 13, 99), // EXCLUDED
        sess('d', 'interval', 0, 14, 99),  // EXCLUDED
        sess('e', 'cooking', 0, 15, 99),   // EXCLUDED
        sess('f', 'flow', -1, 9, 30),      // yesterday: 30
      ];
      const model = await panel().build(depsWith(sessions));
      const today = model.series.find(d => d.key === dayKeyOffset(0));
      const yest = model.series.find(d => d.key === dayKeyOffset(-1));
      assertEqual(today.value, 75);
      assertEqual(yest.value, 30);
      assertEqual(model.totalMin, 105);
      assertEqual(model.maxMin, 75);
    });

    it('rounds fractional minutes', async () => {
      // 90_000 ms = 1.5 min → rounds to 2
      const sessions = [{ id: 'r', type: 'flow', date: new Date(atLocalDayHour(0, 9)).toISOString(), duration: 90000 }];
      const model = await panel().build(depsWith(sessions));
      const today = model.series.find(d => d.key === dayKeyOffset(0));
      assertEqual(today.value, 2);
    });

    it('excludes sessions outside the 14-day window', async () => {
      const sessions = [
        sess('old', 'flow', -30, 9, 60), // outside window
        sess('in', 'flow', -2, 9, 40),   // inside window
      ];
      const model = await panel().build(depsWith(sessions));
      assertEqual(model.series.length, 14);
      assertEqual(model.totalMin, 40); // only the in-window session counted
      const inDay = model.series.find(d => d.key === dayKeyOffset(-2));
      assertEqual(inDay.value, 40);
    });

    it('render(populated) returns a bar-chart string and never throws', () => {
      const model = {
        days: 14,
        series: RI.windowDays(14, NOW).map((w, i) => ({ key: w.key, label: w.label, value: i })),
        totalMin: 91,
        maxMin: 13,
      };
      let html;
      // Must never throw.
      html = panel().render(model);
      assertEqual(typeof html, 'string');
      assert(/analytics-bar-chart/.test(html), 'bar-chart class present');
      assert(/data-insight-panel="focus-minutes"/.test(html), 'card hook present');
      assert(/91 min · 14d/.test(html), 'aside total present');
    });
  });
})();
