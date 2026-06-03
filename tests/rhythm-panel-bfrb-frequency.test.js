// Tests for js/rhythm-panel-bfrb-frequency.js (BFRB Frequency panel).
// The panel is pure: build() reads only via injected deps (getBfrbTrend) and
// render() returns card HTML and must never throw. No BfrbEvents / Analytics
// seeding required — stubbed deps supply the trend directly.

(function () {
  const RI = RhythmInsights;

  function panel() { return RI.getPanels().find(p => p.key === 'bfrb-frequency'); }

  // Build a {days, series, total, ratePerHour} trend with `counts` mapped onto
  // sequential YYYY-MM-DD keys, total summed from the counts.
  function trendOf(counts) {
    const series = counts.map((c, i) => ({
      date: '2026-05-' + String(10 + i).padStart(2, '0'),
      count: c,
    }));
    return {
      days: counts.length,
      series: series,
      total: counts.reduce((a, b) => a + b, 0),
      ratePerHour: 0.5,
    };
  }

  describe('BFRB Frequency panel', () => {
    it('is registered at order 40 with the right title', () => {
      const p = panel();
      assert(p, 'bfrb-frequency registered');
      assertEqual(p.order, 40);
      assertEqual(p.title, 'BFRB Frequency');
    });

    it('build requests a 14-day window from getBfrbTrend', async () => {
      let seenDays = null;
      const deps = {
        getBfrbTrend: async (days) => { seenDays = days; return trendOf([0, 1, 2]); },
      };
      const model = await panel().build(deps);
      assertEqual(seenDays, 14);
      assertEqual(model.total, 3);
      assertEqual(model.series.length, 3);
      assertEqual(model.ratePerHour, 0.5);
    });

    it('build defaults to safe empties when trend is sparse', async () => {
      const deps = { getBfrbTrend: async () => ({}) };
      const model = await panel().build(deps);
      assertArrayEqual(model.series, []);
      assertEqual(model.total, 0);
    });

    it('render() shows the empty card (with panel hook) when total is 0', () => {
      const trend = trendOf([0, 0, 0, 0]);
      const html = panel().render({ series: trend.series, total: 0, ratePerHour: 0 });
      assert(/data-insight-panel="bfrb-frequency"/.test(html), 'card hook present');
      assert(/No BFRB catches/.test(html), 'empty-state copy present');
      assert(!/<polyline/.test(html), 'no chart in empty state');
    });

    it('render() draws a line+area chart with dots only for nonzero days', () => {
      const trend = trendOf([0, 2, 0, 3]); // total 5
      const html = panel().render({ series: trend.series, total: trend.total, ratePerHour: trend.ratePerHour });
      assert(/data-insight-panel="bfrb-frequency"/.test(html), 'card hook present');
      assert(/<polyline/.test(html), 'polyline present');
      assert(/<polygon/.test(html), 'area polygon present');
      // Two nonzero days → exactly two <circle> dots.
      const circles = html.match(/<circle/g) || [];
      assertEqual(circles.length, 2);
      // Titles carry "date: count" for the nonzero days.
      assert(/2026-05-11: 2/.test(html), 'second day title present');
      assert(/2026-05-13: 3/.test(html), 'fourth day title present');
      // Aside reports total + window.
      assert(/5 · 14d/.test(html), 'aside total/window present');
    });

    it('render() escapes date text in dot titles', () => {
      const series = [{ date: '<x>', count: 1 }];
      const html = panel().render({ series: series, total: 1, ratePerHour: 0 });
      assert(/&lt;x&gt;: 1/.test(html), 'date escaped in title');
      assert(!/<x>: 1/.test(html), 'no raw markup leaked');
    });

    it('render() puts the first series date (M/D) left and Today right', () => {
      const trend = trendOf([1, 0, 0]); // first key 2026-05-10
      const html = panel().render({ series: trend.series, total: 1, ratePerHour: 0 });
      assert(/>5\/10</.test(html), 'first date as M/D on the axis');
      assert(/>Today</.test(html), 'Today label on the axis');
    });

    it('render() never throws on a missing/empty model', () => {
      let ok = true;
      try {
        panel().render(undefined);
        panel().render({});
        panel().render({ series: [], total: 0 });
      } catch (e) { ok = false; }
      assert(ok, 'render tolerates empty / missing model');
    });

    it('render() tolerates a series shorter than 14 (plots as-is)', () => {
      const trend = trendOf([3, 4]); // only 2 days
      const html = panel().render({ series: trend.series, total: trend.total, ratePerHour: 0 });
      assert(/<polyline/.test(html), 'chart still draws');
      const circles = html.match(/<circle/g) || [];
      assertEqual(circles.length, 2);
    });
  });
})();
