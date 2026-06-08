// Rhythm Insights panel: Recovery Trends (order 20) — 14-day sparklines for
// the three recovery metrics the external personal-health-elt pipeline writes
// into users/{uid}/recovery_state (surfaced read-only via RecoveryFeed).
//
// One small sparkline per metric (HRV / ACWR / RHR). Each metric is scaled to
// its OWN min..max (not 0-based) so the day-to-day variation is visible even
// though the three live on totally different numeric ranges. The latest value
// is shown on the right, formatted with its unit.
//
// Interactivity: each sparkline point renders a small <circle> marker carrying
// inert data-tip + data-day attributes. The Insights foundation's single
// delegated listener (rhythm-insights.js) consumes those to drive the shared
// cursor tooltip + the cross-panel day-highlight — this panel stays pure.
//
// CSS: reuses the existing generic insight building blocks
//   .rhythm-spark / .rhythm-spark-row / .rhythm-spark-label / .rhythm-spark-value
// (styles.css ~5678). No new CSS needed.
//
// Data: cloud-dependent. deps.getRecoveryHistory() returns { rows: [] } when
// signed out / not synced, which renders as the sign-in empty state.
(function () {
  if (typeof RhythmInsights === 'undefined') return; // load-order guard
  const RI = RhythmInsights;
  const KEY = 'recovery-trends';
  const TITLE = 'Recovery Trends';
  const WINDOW = 14;

  // The three metrics, in display order. `field` is the row property on the
  // RecoveryFeed history rows; `stroke` is a themed CSS var so the sparkline
  // tracks light/dark; `fmt` renders the latest value with its unit.
  // E-polish follow-up: three distinct series → the categorical --chart-1..6
  // ramp (Bold Data-Dense), the canonical home for multi-series chart colors.
  // chart-2=green, chart-3=amber, chart-1=blue — these resolve to the same
  // hues as the prior --green/--orange/--active-accent and keep theming.
  const METRICS = [
    {
      field: 'hrv_ms', label: 'HRV', unit: 'ms', stroke: 'var(--chart-2)',
      fmt: (v) => Math.round(v) + ' ms',
    },
    {
      field: 'acwr', label: 'ACWR', unit: '', stroke: 'var(--chart-3)',
      fmt: (v) => v.toFixed(2),
    },
    {
      field: 'rhr_bpm', label: 'RHR', unit: 'bpm', stroke: 'var(--chart-1)',
      fmt: (v) => Math.round(v) + ' bpm',
    },
  ];

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  RI.register({
    key: KEY,
    title: TITLE,
    order: 20,

    build(deps) {
      const hist = (deps.getRecoveryHistory && deps.getRecoveryHistory()) || { rows: [] };
      const allRows = Array.isArray(hist.rows) ? hist.rows : [];
      // Keep only rows with a string day, sort ascending, take the last 14.
      const rows = allRows
        .filter(r => r && typeof r.day === 'string')
        .slice()
        .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
        .slice(-WINDOW);

      if (rows.length === 0) return { empty: true };

      const metrics = METRICS.map(meta => {
        // Retain each value's day so render() can stamp per-point data-day for
        // the cross-panel highlight. Drop non-numeric readings per metric only.
        const points = rows
          .map(r => ({ day: r.day, value: r[meta.field] }))
          .filter(p => isNum(p.value));
        const values = points.map(p => p.value);
        return {
          label: meta.label,
          unit: meta.unit,
          field: meta.field,
          stroke: meta.stroke,
          points: points,
          values: values,
          latest: values.length ? values[values.length - 1] : null,
          min: values.length ? Math.min(...values) : null,
          max: values.length ? Math.max(...values) : null,
        };
      });

      return { empty: false, days: WINDOW, metrics: metrics };
    },

    render(model) {
      if (!model || model.empty || !Array.isArray(model.metrics)) {
        return RI.card({
          key: KEY, label: TITLE, aside: 'last ' + WINDOW + 'd',
          body: RI.empty('Sign in and sync to see recovery trends (HRV, ACWR, RHR).'),
        });
      }

      // Small sparkline geometry — own min..max per metric so variation shows.
      const dims = RI.svgScaffold({ w: 120, h: 30, padL: 2, padR: 2, padT: 3, padB: 3 });
      const meta = {};
      METRICS.forEach(m => { meta[m.field] = m; });

      const rows = model.metrics.map(metric => {
        const m = meta[metric.field] || {};
        const stroke = metric.stroke || m.stroke || 'var(--text-secondary)';
        const fmt = m.fmt || ((v) => String(v));

        const valueText = (metric.values && metric.values.length >= 2 && isNum(metric.latest))
          ? fmt(metric.latest)
          : '—';

        // < 2 numeric values → no line (nothing to plot a trend with).
        let spark = '';
        const points = (metric.points && metric.points.length)
          ? metric.points
          : (metric.values || []).map(v => ({ day: null, value: v })); // tolerate older model shape
        if (points.length >= 2) {
          const min = metric.min;
          const max = metric.max;
          const span = (max - min) || 1; // flat series → midline (avoids /0)
          const n = points.length;
          const pts = points.map((p, i) => {
            const x = dims.padL + (n === 1 ? dims.innerW / 2 : (i * dims.innerW) / (n - 1));
            const y = dims.padT + dims.innerH - ((p.value - min) / span) * dims.innerH;
            return { x: x, y: y, value: p.value, day: p.day };
          });
          // Hoverable data-point markers, drawn LAST so they sit on top of the
          // polyline + receive pointer events. Each carries data-day (joins the
          // shared cross-panel day-highlight — CSS strokes .rhythm-day-hi circles)
          // and data-tip (the foundation's shared cursor tooltip).
          const markers = pts.map(p => {
            const cx = p.x.toFixed(1);
            const cy = p.y.toFixed(1);
            const tip = metric.label + ' · ' + fmt(p.value) + (p.day ? ' · ' + p.day : '');
            const dayAttr = p.day ? ' data-day="' + escapeHtml(p.day) + '"' : '';
            return '<circle cx="' + cx + '" cy="' + cy + '" r="1.8" fill="' + stroke + '"'
              + dayAttr + ' data-tip="' + escapeHtml(tip) + '"/>';
          }).join('');
          spark = '<svg class="rhythm-spark" viewBox="0 0 ' + dims.W + ' ' + dims.H + '"'
            + ' width="100%" height="' + dims.H + '" preserveAspectRatio="none" role="img"'
            + ' aria-label="' + escapeHtml(metric.label) + ' last ' + n + ' readings">'
            + '<polyline fill="none" stroke="' + stroke + '" stroke-width="1.5"'
            + ' stroke-linejoin="round" stroke-linecap="round" points="' + RI.polyline(pts) + '"/>'
            + markers
            + '</svg>';
        }

        return '<div class="rhythm-spark-row">'
          + '<span class="rhythm-spark-label">' + escapeHtml(metric.label) + '</span>'
          + spark
          + '<span class="rhythm-spark-value">' + escapeHtml(valueText) + '</span>'
          + '</div>';
      }).join('');

      return RI.card({
        key: KEY, label: TITLE, aside: 'last ' + model.days + 'd',
        body: rows,
      });
    },
  });
})();
