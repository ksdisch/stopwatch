// Tests for js/rhythm-panel-recovery-trends.js (the Recovery Trends panel's
// pure build() + render()). The panel reads ONLY via injected deps, so these
// pass plain { rows: [...] } data — no RecoveryFeed seeding required.

(function () {
  const RI = RhythmInsights;
  const NOW = new Date(2026, 4, 20, 12, 0, 0).getTime(); // 2026-05-20, noon local

  function dayKeyOffset(daysFromToday) {
    const b = new Date(NOW);
    return Utils.localDateKey(new Date(b.getFullYear(), b.getMonth(), b.getDate() + daysFromToday));
  }

  // A recovery-state row as RecoveryFeed.getHistory() yields them.
  function row(day, hrv, acwr, rhr) {
    const r = { day: day };
    if (hrv !== undefined) r.hrv_ms = hrv;
    if (acwr !== undefined) r.acwr = acwr;
    if (rhr !== undefined) r.rhr_bpm = rhr;
    return r;
  }

  function panel() { return RI.getPanels().find(p => p.key === 'recovery-trends'); }
  function metric(model, label) { return model.metrics.find(m => m.label === label); }

  describe('Recovery-Trends panel registration', () => {
    it('is registered at order 20', () => {
      const p = panel();
      assert(p, 'recovery-trends registered');
      assertEqual(p.order, 20);
      assertEqual(p.title, 'Recovery Trends');
    });
  });

  describe('Recovery-Trends panel build', () => {
    it('returns {empty:true} when rows are empty (signed out / not synced)', async () => {
      const model = await panel().build({ now: () => NOW, getRecoveryHistory: () => ({ rows: [] }) });
      assertEqual(model.empty, true);
    });

    it('tolerates a missing/garbage history shape without throwing', async () => {
      const m1 = await panel().build({ now: () => NOW, getRecoveryHistory: () => null });
      assertEqual(m1.empty, true);
      const m2 = await panel().build({ now: () => NOW, getRecoveryHistory: () => ({}) });
      assertEqual(m2.empty, true);
    });

    it('collects metric values in ascending-day order with correct latest/min/max', async () => {
      const deps = {
        now: () => NOW,
        getRecoveryHistory: () => ({
          rows: [
            // Intentionally out of order — build() must sort ascending by day.
            row(dayKeyOffset(-1), 70, 1.2, 55),
            row(dayKeyOffset(-3), 50, 0.8, 60),
            row(dayKeyOffset(-2), 62, 1.0, 58),
          ],
        }),
      };
      const model = await panel().build(deps);
      assertEqual(model.empty, false);
      assertEqual(model.days, 14);
      assertEqual(model.metrics.length, 3);

      const hrv = metric(model, 'HRV');
      assertArrayEqual(hrv.values, [50, 62, 70]); // -3, -2, -1 in day order
      assertEqual(hrv.latest, 70);
      assertEqual(hrv.min, 50);
      assertEqual(hrv.max, 70);
      assertEqual(hrv.unit, 'ms');

      // points retain the per-reading day in the SAME ascending order as values,
      // so render() can stamp data-day on each marker for the cross-panel highlight.
      assertEqual(hrv.points.length, 3);
      assertArrayEqual(hrv.points.map(p => p.value), [50, 62, 70]);
      assertArrayEqual(hrv.points.map(p => p.day),
        [dayKeyOffset(-3), dayKeyOffset(-2), dayKeyOffset(-1)]);

      const acwr = metric(model, 'ACWR');
      assertArrayEqual(acwr.values, [0.8, 1.0, 1.2]);
      assertClose(acwr.latest, 1.2, 0.0001);

      const rhr = metric(model, 'RHR');
      assertArrayEqual(rhr.values, [60, 58, 55]);
      assertEqual(rhr.latest, 55);
      assertEqual(rhr.min, 55);
      assertEqual(rhr.max, 60);
    });

    it('drops rows with null/missing/NaN numeric fields from that metric only', async () => {
      const deps = {
        now: () => NOW,
        getRecoveryHistory: () => ({
          rows: [
            row(dayKeyOffset(-2), 50, null, 60),       // acwr null → dropped from ACWR
            row(dayKeyOffset(-1), 62, undefined, 58),  // acwr missing → dropped from ACWR
            row(dayKeyOffset(0), NaN, 1.1, 55),         // hrv NaN → dropped from HRV
          ],
        }),
      };
      const model = await panel().build(deps);
      const hrv = metric(model, 'HRV');
      assertArrayEqual(hrv.values, [50, 62]); // NaN row dropped
      // points drop the same NaN reading, so each surviving value keeps its day.
      assertArrayEqual(hrv.points.map(p => p.value), [50, 62]);
      assertArrayEqual(hrv.points.map(p => p.day), [dayKeyOffset(-2), dayKeyOffset(-1)]);
      const acwr = metric(model, 'ACWR');
      assertArrayEqual(acwr.values, [1.1]);   // only the last row had a numeric acwr
      assertArrayEqual(acwr.points.map(p => p.day), [dayKeyOffset(0)]);
      const rhr = metric(model, 'RHR');
      assertArrayEqual(rhr.values, [60, 58, 55]);
    });

    it('keeps only the last 14 rows when more are supplied (sorted ascending)', async () => {
      const rows = [];
      for (let i = 0; i < 20; i++) rows.push(row(dayKeyOffset(-i), 40 + i));
      const model = await panel().build({ now: () => NOW, getRecoveryHistory: () => ({ rows: rows }) });
      const hrv = metric(model, 'HRV');
      assertEqual(hrv.values.length, 14);
      // newest row is dayKeyOffset(0) with hrv 40; oldest kept is dayKeyOffset(-13) with hrv 53
      assertEqual(hrv.latest, 40);          // dayKeyOffset(0)
      assertEqual(hrv.values[0], 53);       // dayKeyOffset(-13)
      assertEqual(hrv.values[13], 40);      // dayKeyOffset(0)
    });

    it('ignores rows without a string day', async () => {
      const deps = {
        now: () => NOW,
        getRecoveryHistory: () => ({
          rows: [row(dayKeyOffset(-1), 60), { day: 123, hrv_ms: 99 }, null, { hrv_ms: 88 }],
        }),
      };
      const model = await panel().build(deps);
      const hrv = metric(model, 'HRV');
      assertArrayEqual(hrv.values, [60]); // only the well-formed row survives
    });
  });

  describe('Recovery-Trends panel render', () => {
    it('render() returns a sign-in empty card on the empty model and never throws', () => {
      const html = panel().render({ empty: true }, { state: () => ({}) });
      assert(/data-insight-panel="recovery-trends"/.test(html), 'card hook present');
      assert(/Sign in/.test(html), 'sign-in empty copy present');
      assert(!/<circle/.test(html), 'empty state draws no hoverable markers');
    });

    it('render() of a populated model produces svg sparklines + formatted values', async () => {
      const deps = {
        now: () => NOW,
        getRecoveryHistory: () => ({
          rows: [
            row(dayKeyOffset(-2), 50, 0.83, 60),
            row(dayKeyOffset(-1), 62, 1.07, 58),
            row(dayKeyOffset(0), 70, 1.25, 55),
          ],
        }),
      };
      const model = await panel().build(deps);
      const html = panel().render(model, { state: () => ({}) });
      assert(typeof html === 'string', 'render returns a string');
      assert(/data-insight-panel="recovery-trends"/.test(html), 'card hook present');
      assert(/<svg/.test(html), 'has at least one sparkline svg');
      assert(/<polyline/.test(html), 'sparkline drawn as a polyline');
      assert(/70 ms/.test(html), 'HRV latest formatted with unit');
      assert(/1\.25/.test(html), 'ACWR latest to 2 decimals');
      assert(/55 bpm/.test(html), 'RHR latest formatted with unit');
      assert(/last 14d/.test(html), 'aside present');

      // Per-point hoverable markers join the shared tooltip + cross-panel highlight.
      assert(/<circle/.test(html), 'renders hoverable circle markers');
      // 3 rows × 3 metrics, all numeric → 9 markers, each with data-day + data-tip.
      const circles = html.match(/<circle\b[^>]*>/g) || [];
      assertEqual(circles.length, 9);
      assert(circles.every(c => /\sdata-day="\d{4}-\d{2}-\d{2}"/.test(c)),
        'every marker carries a YYYY-MM-DD data-day');
      assert(circles.every(c => /\sdata-tip="/.test(c)),
        'every marker carries a data-tip');
      // The tooltip text is the label · formatted value · day for the point.
      assert(html.indexOf('data-tip="HRV · 70 ms · ' + dayKeyOffset(0) + '"') >= 0,
        'HRV latest marker tip = label · value · day');
      assert(html.indexOf('data-day="' + dayKeyOffset(0) + '"') >= 0,
        'latest day stamped on a marker');
    });

    it('shows an em-dash and no line for a metric with < 2 numeric values', async () => {
      const deps = {
        now: () => NOW,
        getRecoveryHistory: () => ({
          rows: [
            row(dayKeyOffset(-1), 60, undefined, 58), // ACWR has 0 values
            row(dayKeyOffset(0), 64, undefined, 55),
          ],
        }),
      };
      const model = await panel().build(deps);
      const acwr = metric(model, 'ACWR');
      assertEqual(acwr.values.length, 0);
      const html = panel().render(model, { state: () => ({}) });
      assert(/—/.test(html), 'em-dash shown for the sparse metric');
      // HRV (2 values) still draws a polyline + 2 markers; RHR (2 values) too.
      assert(/<polyline/.test(html), 'HRV still drawn');
      // ACWR (0 values) contributes no markers — only HRV(2) + RHR(2) = 4 circles.
      const circles = html.match(/<circle\b[^>]*>/g) || [];
      assertEqual(circles.length, 4);
    });

    it('render() never throws on a malformed model', () => {
      let html;
      assertEqual(typeof (html = panel().render(null, { state: () => ({}) })), 'string');
      assert(/data-insight-panel="recovery-trends"/.test(html), 'null model → fallback card');
      const html2 = panel().render({ empty: false }, { state: () => ({}) }); // no metrics array
      assert(/data-insight-panel="recovery-trends"/.test(html2), 'missing metrics → fallback card');
    });
  });
})();
