// Rhythm Insights panel: BFRB Frequency (order 40) — a 14-day daily catch
// line chart.
//
// Question it answers: "am I catching BFRB urges more or less often lately?"
//   x = day (oldest → today, left → right)
//   y = number of catches that day
//
// Reuses the analytics line+area idiom (js/analytics-ui.js renderBFRBTrend).
// The series comes pre-de-duped from deps.getBfrbTrend — that engine already
// reconciles the consolidated BfrbEvents stream with legacy per-session
// catches, so this panel never independently sums getBfrbEvents.
(function () {
  if (typeof RhythmInsights === 'undefined') return; // load-order guard
  const RI = RhythmInsights;
  const KEY = 'bfrb-frequency';

  // 'YYYY-MM-DD' → 'M/D', or '' when unparseable. Local, no UTC shift (split
  // the string rather than new Date(key) which parses as UTC midnight).
  function shortDate(key) {
    if (typeof key !== 'string') return '';
    const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    return (+m[2]) + '/' + (+m[3]);
  }

  RI.register({
    key: KEY,
    title: 'BFRB Frequency',
    order: 40,

    async build(deps) {
      const trend = await deps.getBfrbTrend(14);
      return {
        series: (trend && trend.series) || [],
        total: (trend && trend.total) || 0,
        ratePerHour: trend && trend.ratePerHour,
      };
    },

    render(model) {
      model = model || {};
      const series = model.series || [];
      const total = model.total || 0;

      if (total === 0) {
        return RI.card({
          key: KEY, label: 'BFRB Frequency',
          body: RI.empty('No BFRB catches in the last 14 days.'),
        });
      }

      // Line-with-area chart, mirroring analytics-ui.js renderBFRBTrend. Series
      // may not be exactly 14 long — plot as-is. Padded for axis labels: left
      // for the y count ticks, bottom for the x date ticks.
      const dims = RI.svgScaffold({ w: 320, h: 96, padL: 24, padR: 6, padT: 8, padB: 18 });

      // Round count ticks (0..niceMax). Use niceMax as the explicit line max so
      // the polyline aligns exactly to the y-axis gridlines.
      const maxCount = Math.max(1, ...series.map(d => d.count || 0));
      const ticks = RI.niceTicks(maxCount, 3);
      const niceMax = ticks[ticks.length - 1] || 1;
      const pts = RI.linePoints(series.map(d => d.count || 0), dims, niceMax);

      // Y-axis: project each round count value to its pixel row.
      const yTicks = ticks.map(v => ({
        y: dims.padT + dims.innerH - (v / niceMax) * dims.innerH,
        label: String(v),
      }));

      // X-axis: first / middle / last day. Last is always "Today"; the others
      // use the M/D short date. De-dupe indices so a tiny series doesn't repeat.
      const lastI = pts.length - 1;
      const midI = Math.floor(lastI / 2);
      const xIdx = [...new Set([0, midI, lastI])].filter(i => i >= 0);
      const xTicks = xIdx.map(i => ({
        x: pts[i].x,
        label: i === lastI ? 'Today' : shortDate(series[i].date),
      }));

      const grid = RI.gridlines(dims, { ys: yTicks.map(t => t.y) });
      const yAxisSvg = RI.yAxis(dims, yTicks);
      const xAxisSvg = RI.xAxis(dims, xTicks);

      const areaPoly = RI.area(pts, dims);
      const linePoly = RI.polyline(pts);
      const dots = pts
        .map((p, i) => ({ p: p, d: series[i] }))
        .filter(x => (x.d && x.d.count) > 0)
        .map(x =>
          '<circle cx="' + x.p.x.toFixed(1) + '" cy="' + x.p.y.toFixed(1) + '" r="2"'
          + ' fill="var(--amber)"'
          + ' data-day="' + escapeHtml(x.d.date) + '"'
          + ' data-tip="' + escapeHtml(shortDate(x.d.date) + ' · ' + x.d.count
            + ' catch' + (x.d.count === 1 ? '' : 'es')) + '"/>')
        .join('');

      // Element order: gridlines + axes first, then area, polyline, dots LAST
      // (so the chart draws on top of the grid, and dots stay hit-testable).
      const chart = '<svg class="rhythm-bfrb-chart" viewBox="0 0 ' + dims.W + ' ' + dims.H + '"'
        + ' width="100%" height="' + dims.H + '" role="img"'
        + ' aria-label="Daily BFRB catches over the last 14 days">'
        + grid
        + yAxisSvg
        + xAxisSvg
        + '<polygon points="' + areaPoly + '" fill="rgba(255,159,10,0.18)"/>'
        + '<polyline points="' + linePoly + '" fill="none" stroke="var(--amber)"'
        + ' stroke-width="1.5" stroke-linejoin="round"/>'
        + dots
        + '</svg>';

      return RI.card({
        key: KEY, label: 'BFRB Frequency',
        aside: total + ' catch' + (total === 1 ? '' : 'es') + ' · 14d',
        body: chart,
      });
    },
  });
})();
