/* STRUCTURAL CSS (lives in css/styles.css — the .rhythm-zoom-* classes already
   exist; this block documents the layout contract, it is NOT a to-do):

   .rhythm-zoom-strip {
     display: flex;
     flex-direction: row;
     gap: 3px;
     align-items: flex-end;
   }
   .rhythm-zoom-col {
     flex: 1 1 0;
     min-width: 0;
     display: flex;
     flex-direction: column;
     align-items: center;
   }
   .rhythm-zoom-bar {
     width: 100%;
     height: 60px;
     display: flex;
     flex-direction: column;
     justify-content: flex-end;
     align-items: stretch;
   }
   .rhythm-zoom-segment {
     width: 100%;
   }
   .rhythm-zoom-label {
     margin-top: 4px;
     font-size: 9px;
     line-height: 1;
     text-align: center;
     color: var(--text-secondary);
     white-space: nowrap;
   }

   (Dynamic per-segment height + background are set inline via style="" so only
   the structural rules above are needed. The bar's fixed 60px height + bottom
   justification gives the stacked segments their baseline-aligned column.) */

// Rhythm Insights panel: 14-Day Activity (order 60) — the "zoomed-out" version
// of the daily event timeline.
//
// Question it answers: "at a glance, which of the last 14 days were busy, and
// were they productivity (Flow/Pomodoro/stopwatch/timer/sequence) or wellness
// (interval/cooking) days?" Renders a condensed calendar strip of 14 day-columns,
// each a vertical stacked mini-bar (productivity segment + wellness segment)
// whose total height is proportional to that day's session count.
//
// PERF: one deps.getSessions() read, bucketed locally — NOT one
// deps.getDayTimeline call per day.
(function () {
  if (typeof RhythmInsights === 'undefined') return; // load-order guard
  const RI = RhythmInsights;
  const KEY = 'event-zoom';

  // Pillar classification by session type. Productivity = focused / timing work;
  // wellness = the Wellness-suite modes that emit sessions (interval workouts +
  // cooking timers). Anything unrecognized falls through as neither.
  const PRODUCTIVITY_TYPES = { flow: true, pomodoro: true, stopwatch: true, timer: true, sequence: true };
  const WELLNESS_TYPES = { interval: true, cooking: true };

  RI.register({
    key: KEY,
    title: '14-Day Activity',
    order: 60,

    async build(deps) {
      const days = 14;
      const sessions = (await deps.getSessions()) || [];

      // ONE read → bucket locally by local day (drops out-of-window + non-finite).
      const byDay = RI.bucketByDay(sessions, s => new Date(s.date).getTime(), days, deps.now());

      const win = RI.windowDays(days, deps.now());
      let maxTotal = 0;
      let grandTotal = 0;

      const dayModels = win.map(w => {
        const items = byDay.get(w.key) || [];
        let productivity = 0, wellness = 0;
        items.forEach(s => {
          if (!s) return;
          if (PRODUCTIVITY_TYPES[s.type]) productivity++;
          else if (WELLNESS_TYPES[s.type]) wellness++;
        });
        const total = productivity + wellness;
        if (total > maxTotal) maxTotal = total;
        grandTotal += total;
        return { key: w.key, label: w.label, productivity: productivity, wellness: wellness, total: total };
      });

      // `days` is the per-day array (per the panel contract); `windowDays(14)`
      // means the window is always exactly 14 cells.
      return { days: dayModels, maxTotal: maxTotal, grandTotal: grandTotal };
    },

    render(model) {
      // Always render the 14-cell strip — even an all-zero model reads as a grid.
      if (!model) {
        return RI.card({
          key: KEY, label: '14-Day Activity',
          body: RI.empty('No sessions in the last 14 days.'),
        });
      }

      const dayModels = model.days || [];
      const max = model.maxTotal || 0;

      // Each column: a fixed-height bar with two bottom-aligned stacked segments
      // (productivity on top of wellness). Total bar height ∝ total/maxTotal, with
      // a thin baseline for any non-zero day so a single session still reads.
      const cols = dayModels.map((d, i) => {
        const totalPct = (max > 0 && d.total > 0) ? Math.max((d.total / max) * 100, 6) : 0;
        // Split the stack proportionally between the two pillars.
        const prodPct = d.total > 0 ? (d.productivity / d.total) * totalPct : 0;
        const wellPct = d.total > 0 ? (d.wellness / d.total) * totalPct : 0;

        // E-polish follow-up: explicit pillar tokens (was --active-accent /
        // --green) so productivity stays blue and wellness green regardless of
        // the active-pillar accent, and both drop the dead hex fallback.
        const segs =
          '<div class="rhythm-zoom-segment" style="height:' + prodPct.toFixed(1)
            + '%;background:var(--productivity-accent)"></div>'
          + '<div class="rhythm-zoom-segment" style="height:' + wellPct.toFixed(1)
            + '%;background:var(--wellness-accent)"></div>';

        // Label every ~3rd day to keep the 14-wide axis uncrowded.
        const labelTxt = (i % 3 === 0) ? d.label : '';
        const tip = d.label + ' · ' + d.total + ' session' + (d.total === 1 ? '' : 's')
          + ' (' + d.productivity + ' prod / ' + d.wellness + ' wellness)';

        // data-day joins the foundation's cross-panel highlight; data-tip drives
        // the shared hover tooltip (replaces the old native title=). The column —
        // not the inner segments — carries both so the whole day reads as one unit.
        return '<div class="rhythm-zoom-col" data-day="' + escapeHtml(d.key)
          + '" data-tip="' + escapeHtml(tip) + '">'
          + '<div class="rhythm-zoom-bar">' + segs + '</div>'
          + '<span class="rhythm-zoom-label">' + escapeHtml(labelTxt) + '</span>'
          + '</div>';
      }).join('');

      // Peak reference — the busiest single day's session count anchors the
      // proportional bar heights so the strip is readable without a full axis.
      const peak = '<div style="font-size:10px;color:var(--text-secondary);margin-bottom:4px">'
        + escapeHtml('peak ' + max + ' session' + (max === 1 ? '' : 's')) + '</div>';

      // Legend — makes the two stacked segment colors interpretable. Inline-styled
      // swatches (coordinator owns styles.css; no new CSS classes here).
      const sw = 'display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;vertical-align:middle';
      const legend = '<div style="display:flex;gap:12px;font-size:10px;color:var(--text-secondary);margin-top:6px">'
        + '<span><span style="' + sw + ';background:var(--productivity-accent)"></span>Productivity</span>'
        + '<span><span style="' + sw + ';background:var(--wellness-accent)"></span>Wellness</span>'
        + '</div>';

      let body = peak + '<div class="rhythm-zoom-strip">' + cols + '</div>' + legend;
      if (model.grandTotal === 0) {
        body += RI.empty('No sessions in the last 14 days.');
      }

      const aside = escapeHtml(model.grandTotal + ' sessions · 14d');

      return RI.card({
        key: KEY, label: '14-Day Activity', aside: aside,
        body: body,
      });
    },
  });
})();
