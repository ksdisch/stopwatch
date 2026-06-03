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
      // may not be exactly 14 long — plot as-is.
      const dims = RI.svgScaffold({ w: 320, h: 88, padL: 4, padR: 4, padT: 6, padB: 14 });
      const pts = RI.linePoints(series.map(d => d.count || 0), dims);

      const areaPoly = RI.area(pts, dims);
      const linePoly = RI.polyline(pts);
      const dots = pts
        .map((p, i) => ({ p: p, d: series[i] }))
        .filter(x => (x.d && x.d.count) > 0)
        .map(x =>
          '<circle cx="' + x.p.x.toFixed(1) + '" cy="' + x.p.y.toFixed(1) + '" r="2"'
          + ' fill="var(--orange)"><title>'
          + escapeHtml(x.d.date + ': ' + x.d.count) + '</title></circle>')
        .join('');

      const chart = '<svg class="rhythm-bfrb-chart" viewBox="0 0 ' + dims.W + ' ' + dims.H + '"'
        + ' width="100%" height="' + dims.H + '" role="img"'
        + ' aria-label="Daily BFRB catches over the last 14 days">'
        + '<polygon points="' + areaPoly + '" fill="rgba(255,159,10,0.18)"/>'
        + '<polyline points="' + linePoly + '" fill="none" stroke="var(--orange)"'
        + ' stroke-width="1.5" stroke-linejoin="round"/>'
        + dots
        + '</svg>';

      // Axis: oldest series date on the left, "Today" on the right. Inline
      // style (no new CSS rule needed) — small + secondary, justified ends.
      const firstLabel = series.length ? shortDate(series[0].date) : '';
      const axis = '<div class="rhythm-bfrb-axis"'
        + ' style="display:flex;justify-content:space-between;font-size:0.7rem;color:var(--text-secondary)">'
        + '<span>' + escapeHtml(firstLabel) + '</span>'
        + '<span>Today</span>'
        + '</div>';

      return RI.card({
        key: KEY, label: 'BFRB Frequency',
        aside: total + ' · 14d',
        body: chart + axis,
      });
    },
  });
})();
