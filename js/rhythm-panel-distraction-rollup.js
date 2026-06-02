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
        const label = CATEGORY_LABELS[row.category] || escapeHtml(row.category || 'Other');
        const flow = row.flow || 0;
        const pomo = row.pomodoro || 0;
        const split = (flow > 0 && pomo > 0)
          ? ' <span class="analytics-distraction-split">' + flow + 'f · ' + pomo + 'p</span>'
          : '';
        return '<div class="analytics-distraction-row">'
          + '<div class="analytics-distraction-label">' + label + '</div>'
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
          return '<div class="analytics-distraction-hour" style="background:' + bg + '"'
            + ' title="' + escapeHtml(RI.fmtHour(h) + ' — ' + c) + '"></div>';
        }).join('');

        // Peak hour callout.
        let peakHour = -1, peakCount = 0;
        hourly.forEach((c, h) => { if ((c || 0) > peakCount) { peakCount = c; peakHour = h; } });
        const peakLine = (peakHour >= 0 && peakCount > 0)
          ? '<div class="analytics-distraction-peak">'
              + escapeHtml('Peak: ' + RI.fmtHour(peakHour) + ' (' + peakCount + ')') + '</div>'
          : '';

        hourBlock = '<div class="analytics-distraction-hour-title">BY HOUR OF DAY</div>'
          + '<div class="analytics-distraction-hour-strip" role="img"'
          + ' aria-label="Distraction count by hour of day, 12 AM to 11 PM">' + hourCells + '</div>'
          + '<div class="analytics-distraction-hour-axis">'
          + '<span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>11p</span>'
          + '</div>'
          + peakLine;
      }

      const aside = escapeHtml(model.total + ' · all-time');
      const subtitle = '<div class="analytics-distraction-subtitle">'
        + escapeHtml(model.total + ' logged across Flow + Pomodoro · all-time') + '</div>';

      return RI.card({
        key: KEY, label: 'Distractions', aside: aside,
        body: subtitle
          + '<div class="analytics-distraction-leaderboard">' + leaderboard + '</div>'
          + hourBlock,
      });
    },
  });
})();
