// Rhythm Insights panel: Distractions (order 50).
//
// Question it answers: "what pulls me out of focus, and when does it strike?"
// Renders an all-time category leaderboard (top 5) reusing the analytics-ui
// distraction idiom (.analytics-distraction-* classes) so the visual language
// matches the Analytics tab, plus an optional 24-cell by-hour strip with a
// peak-hour callout.
//
// NOTE: deps.getDistractions() is ALL-TIME (sourced from session history), NOT
// a 14-day window like the other Insights panels — so the aside + subtitle say
// "all-time" rather than "last 14d" to stay honest about the window.
(function () {
  if (typeof RhythmInsights === 'undefined') return; // load-order guard
  const RI = RhythmInsights;
  const KEY = 'distraction-rollup';

  // Raw category keys → nice display labels. Fallback (below) escapes the raw
  // key so a future/unknown category still renders safely.
  const CATEGORY_LABELS = {
    phone: 'Phone',
    email: 'Email',
    interrupted: 'Interrupted',
    self: 'Self',
    other: 'Other',
  };

  RI.register({
    key: KEY,
    title: 'Distractions',
    order: 50,

    async build(deps) {
      const d = (await deps.getDistractions()) || {};
      return {
        total: d.total || 0,
        top5: d.top5 || [],
        hourly: d.hourly || [],
      };
    },

    render(model) {
      if (!model || model.total === 0) {
        return RI.card({
          key: KEY, label: 'Distractions',
          body: RI.empty('No distractions logged across Flow + Pomodoro yet.'),
        });
      }

      const top5 = model.top5 || [];
      const hourly = model.hourly || [];

      // ── Category leaderboard ─────────────────────────────────────────
      const maxTotal = (top5[0] && top5[0].total) || 1;
      const leaderboard = top5.map(row => {
        const total = row.total || 0;
        const pct = (total / maxTotal) * 100;
        // displayLabel: human-readable label for the row + tooltip; rawLabel:
        // the un-prettified category name for the tooltip's leading phrase.
        const displayLabel = CATEGORY_LABELS[row.category] || escapeHtml(row.category || 'Other');
        const rawLabel = CATEGORY_LABELS[row.category] || (row.category || 'Other');
        const flow = row.flow || 0;
        const pomo = row.pomodoro || 0;
        const split = (flow > 0 && pomo > 0)
          ? ' <span class="analytics-distraction-split">' + flow + 'f · ' + pomo + 'p</span>'
          : '';
        // Single-line, ' · '-joined tooltip; escapeHtml so the attribute is safe
        // even for unknown raw category keys. Read by the shared delegated hover
        // listener in rhythm-insights.js (no title= — the custom tooltip wins).
        const tip = escapeHtml(
          rawLabel + ' · ' + total + ' distraction' + (total === 1 ? '' : 's')
          + ' (' + flow + ' flow / ' + pomo + ' pomodoro)'
        );
        return '<div class="analytics-distraction-row" data-tip="' + tip + '">'
          + '<div class="analytics-distraction-label">' + displayLabel + '</div>'
          + '<div class="analytics-distraction-bar">'
          + '<div class="analytics-distraction-bar-pomo" style="width:' + pct.toFixed(1) + '%"></div>'
          + '</div>'
          + '<div class="analytics-distraction-count">' + total + split + '</div>'
          + '</div>';
      }).join('');

      // ── Optional by-hour strip (nice-to-have) ────────────────────────
      let hourBlock = '';
      if (hourly.length === 24) {
        const maxHour = Math.max(1, ...hourly);
        const hourCells = hourly.map((count, h) => {
          const c = count || 0;
          const intensity = c > 0 ? Math.max(0.18, c / maxHour) : 0;
          const bg = intensity > 0
            ? 'rgba(255, 107, 107, ' + intensity.toFixed(2) + ')'
            : 'var(--btn-border)';
          // data-tip (no title=) — the shared delegated hover listener in
          // rhythm-insights.js paints the custom tooltip. Single line, ' · '-joined.
          const tip = escapeHtml(RI.fmtHour(h) + ' · ' + c + ' distraction' + (c === 1 ? '' : 's'));
          return '<div class="analytics-distraction-hour" style="background:' + bg + '"'
            + ' data-tip="' + tip + '"></div>';
        }).join('');

        // Peak hour callout.
        let peakHour = -1, peakCount = 0;
        hourly.forEach((c, h) => { if ((c || 0) > peakCount) { peakCount = c; peakHour = h; } });
        const peakLine = (peakHour >= 0 && peakCount > 0)
          ? '<div class="analytics-distraction-peak">'
              + escapeHtml('Peak: ' + RI.fmtHour(peakHour) + ' (' + peakCount + ')') + '</div>'
          : '';

        // Evenly-spaced hour tick labels every ~4h (the strip is a 24-cell grid;
        // the axis is a space-between flex row, so 7 ticks read as 12a · 4a · 8a
        // · 12p · 4p · 8p · 11p across the full width, lining up under the cells).
        // Compact 'a'/'p' form via fmtHour so it stays legible at 390px.
        const AXIS_HOURS = [0, 4, 8, 12, 16, 20, 23];
        const axisTicks = AXIS_HOURS.map(h => {
          // '4 AM' → '4a', '12 PM' → '12p' — compact the fmtHour output.
          const compact = RI.fmtHour(h).replace(' AM', 'a').replace(' PM', 'p');
          return '<span>' + escapeHtml(compact) + '</span>';
        }).join('');

        hourBlock = '<div class="analytics-distraction-hour-title">BY HOUR OF DAY</div>'
          + '<div class="analytics-distraction-hour-strip" role="img"'
          + ' aria-label="Distraction count by hour of day, 12 AM to 11 PM">' + hourCells + '</div>'
          + '<div class="analytics-distraction-hour-axis">' + axisTicks + '</div>'
          + peakLine;
      }

      // Units: spell out "distractions" on the card aside + subtitle so the
      // bare counts in the leaderboard read with a unit (singular at 1).
      const noun = model.total === 1 ? 'distraction' : 'distractions';
      const aside = escapeHtml(model.total + ' ' + noun + ' · all-time');
      const subtitle = '<div class="analytics-distraction-subtitle">'
        + escapeHtml(model.total + ' ' + noun + ' logged across Flow + Pomodoro · all-time') + '</div>';

      return RI.card({
        key: KEY, label: 'Distractions', aside: aside,
        body: subtitle
          + '<div class="analytics-distraction-leaderboard">' + leaderboard + '</div>'
          + hourBlock,
      });
    },
  });
})();
