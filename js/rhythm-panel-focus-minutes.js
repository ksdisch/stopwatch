// Rhythm Insights panel: Focus Minutes (order 30).
//
// Question it answers: "how many minutes of deep-focus work did I log each day
// over the last two weeks?" Counts only the productivity modes — Flow Block +
// Pomodoro work — so casual stopwatch/cooking/interval sessions don't inflate
// the bar. Renders a 14-column bar chart reusing the analytics-ui bar idiom
// (.analytics-bar-* classes) so the visual language matches the Analytics tab.
(function () {
  if (typeof RhythmInsights === 'undefined') return; // load-order guard
  const RI = RhythmInsights;
  const KEY = 'focus-minutes';

  // Only Flow + Pomodoro count as "focus" — everything else (stopwatch,
  // interval, cooking, sequence, timer) is excluded from the productivity total.
  const FOCUS_TYPES = { flow: true, pomodoro: true };

  RI.register({
    key: KEY,
    title: 'Focus Minutes',
    order: 30,

    async build(deps) {
      const days = 14;
      const sessions = (await deps.getSessions()) || [];
      const focus = sessions.filter(s => s && FOCUS_TYPES[s.type]);

      // Per-day sum of session minutes, aligned to the 14-day window (0-filled).
      const series = RI.sumByDay(
        focus,
        s => new Date(s.date).getTime(),
        s => (s.duration || 0) / 60000,
        days,
        deps.now()
      ).map(d => ({ key: d.key, label: d.label, value: Math.round(d.value) }));

      const totalMin = series.reduce((sum, d) => sum + d.value, 0);
      const maxMin = series.reduce((m, d) => Math.max(m, d.value), 0);

      return { days: days, series: series, totalMin: totalMin, maxMin: maxMin };
    },

    render(model) {
      if (!model || model.totalMin === 0) {
        return RI.card({
          key: KEY, label: 'Focus Minutes',
          body: RI.empty('No focus sessions in the last 14 days.'),
        });
      }

      const max = model.maxMin || 1;
      // Label every ~3rd column to avoid crowding the 14-wide axis.
      const cols = model.series.map((d, i) => {
        const heightPct = d.value > 0 ? Math.max((d.value / max) * 100, 2) : 0;
        const labelTxt = (i % 3 === 0) ? d.label : '';
        const stack = heightPct > 0
          ? '<div class="analytics-bar-stack" style="height:' + heightPct.toFixed(1) + '%">'
              + '<div class="analytics-bar-segment" style="height:100%;background:var(--active-accent,#007aff)"></div>'
            + '</div>'
          : '<div class="analytics-bar-stack" style="height:0%"></div>';
        return '<div class="analytics-bar-col" title="' + escapeHtml(d.label + ' · ' + d.value + ' min') + '">'
          + stack
          + '<span class="analytics-bar-label">' + escapeHtml(labelTxt) + '</span>'
          + '</div>';
      }).join('');

      const aside = escapeHtml(model.totalMin + ' min · ' + model.days + 'd');

      return RI.card({
        key: KEY, label: 'Focus Minutes', aside: aside,
        body: '<div class="analytics-bar-chart">' + cols + '</div>',
      });
    },
  });
})();
