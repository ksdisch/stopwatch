// Tests for js/rhythm-panel-distraction-rollup.js — the all-time Distractions
// rollup panel. Panels read via injected deps, so these pass a plain
// getDistractions() stub; no Analytics module seeding required.

(function () {
  const RI = RhythmInsights;

  function panel() { return RI.getPanels().find(p => p.key === 'distraction-rollup'); }

  // deps stub matching the documented getDistractions() shape.
  function deps(dist) {
    return { getDistractions: async () => dist };
  }
  function emptyHourly() { return new Array(24).fill(0); }

  describe('Distraction-rollup panel', () => {

    it('is registered at order 50 with title Distractions', () => {
      const p = panel();
      assert(p, 'distraction-rollup registered');
      assertEqual(p.order, 50);
      assertEqual(p.title, 'Distractions');
    });

    // ── build() ────────────────────────────────────────────────────────
    it('build() normalizes a missing distraction payload to safe defaults', async () => {
      const model = await panel().build(deps({}));
      assertEqual(model.total, 0);
      assertArrayEqual(model.top5, []);
      assertArrayEqual(model.hourly, []);
    });

    it('build() passes through total / top5 / hourly', async () => {
      const dist = {
        total: 7,
        top5: [{ category: 'phone', flow: 2, pomodoro: 1, total: 3 }],
        hourly: emptyHourly(),
      };
      const model = await panel().build(deps(dist));
      assertEqual(model.total, 7);
      assertEqual(model.top5.length, 1);
      assertEqual(model.hourly.length, 24);
    });

    // ── render() empty ───────────────────────────────────────────────────
    it('render() with total 0 → empty card with the panel hook + empty copy', async () => {
      const model = await panel().build(deps({ total: 0, top5: [], hourly: [] }));
      const html = panel().render(model);
      assert(/data-insight-panel="distraction-rollup"/.test(html), 'card hook present');
      assert(/No distractions/.test(html), 'empty-state copy present');
    });

    it('render() is safe on a hand-built empty model', () => {
      const html = panel().render({ total: 0, top5: [], hourly: [] });
      assert(/data-insight-panel="distraction-rollup"/.test(html), 'card hook present');
      assert(/No distractions/.test(html), 'empty-state copy present');
    });

    it('render() never throws on null / undefined model', () => {
      let threw = false;
      try { panel().render(null); panel().render(undefined); }
      catch (e) { threw = true; }
      assertEqual(threw, false);
    });

    // ── render() populated ────────────────────────────────────────────────
    it('render() lists each top category with its nice label + count', async () => {
      const dist = {
        total: 12,
        top5: [
          { category: 'phone', flow: 4, pomodoro: 2, total: 6 },
          { category: 'email', flow: 0, pomodoro: 4, total: 4 },
          { category: 'self', flow: 2, pomodoro: 0, total: 2 },
        ],
        hourly: emptyHourly(),
      };
      const model = await panel().build(deps(dist));
      const html = panel().render(model);

      assert(/Phone/.test(html), 'phone → Phone label');
      assert(/Email/.test(html), 'email → Email label');
      assert(/Self/.test(html), 'self → Self label');
      // counts present inside the count cell (phone has a flow+pomo split
      // subtext after the number, so match "6" followed by space-or-tag).
      assert(/analytics-distraction-count">6[\s<]/.test(html), 'phone count 6 rendered');
      assert(/analytics-distraction-count">4[\s<]/.test(html), 'email count 4 rendered');
      // honest all-time labelling
      assert(/all-time/.test(html), 'aside / subtitle says all-time');
      // reuses the leaderboard idiom
      assert(/analytics-distraction-row/.test(html), 'reuses leaderboard row class');
      assert(/analytics-distraction-bar/.test(html), 'reuses bar class');
    });

    it('maps known category keys to nice labels and escapes unknown raw keys', async () => {
      const dist = {
        total: 5,
        top5: [
          { category: 'interrupted', flow: 0, pomodoro: 3, total: 3 },
          { category: '<weird>', flow: 0, pomodoro: 2, total: 2 },
        ],
        hourly: [],
      };
      const model = await panel().build(deps(dist));
      const html = panel().render(model);

      assert(/Interrupted/.test(html), 'interrupted → Interrupted label');
      // unknown raw key is HTML-escaped, not injected verbatim
      assert(/&lt;weird&gt;/.test(html), 'unknown category escaped');
      assert(html.indexOf('<weird>') === -1, 'raw unknown key not injected unescaped');
    });

    it('renders the by-hour strip + peak callout only when hourly has 24 cells', async () => {
      const hourly = emptyHourly();
      hourly[9] = 5; // 9 AM peak
      const dist = {
        total: 5,
        top5: [{ category: 'phone', flow: 0, pomodoro: 5, total: 5 }],
        hourly: hourly,
      };
      const withStrip = panel().render(await panel().build(deps(dist)));
      assert(/analytics-distraction-hour-strip/.test(withStrip), 'hour strip present with 24 cells');
      assert(/Peak: 9 AM \(5\)/.test(withStrip), 'peak hour callout present');

      // No hourly → no strip, but leaderboard still renders.
      const noStrip = panel().render(await panel().build(deps({
        total: 5,
        top5: [{ category: 'phone', flow: 0, pomodoro: 5, total: 5 }],
        hourly: [],
      })));
      assertEqual(/analytics-distraction-hour-strip/.test(noStrip), false);
      assert(/Phone/.test(noStrip), 'leaderboard still renders without an hour strip');
    });

  });
})();
