// Rhythm Insights panel: Correlations (order 70) — the synthesis panel.
//
// Question it answers: "do my logged streams move together?" This is the
// last panel — it cross-references the day-keyed series the other panels
// render individually (focus minutes, recovery signal, BFRB catches, sleep
// hours) over the trailing 14 days and emits plain-language callouts ONLY
// where the underlying day-sets are non-empty.
//
// Conservative by design: every callout guards its denominators, so the model
// never produces a NaN / divide-by-zero string. When nothing correlates yet
// (sparse data), render falls back to the "keep logging" empty state rather
// than inventing a number.
//
// Day alignment: focus minutes, recovery signal, and BFRB count are all keyed
// to the day they happened (D). The optional sleep↔focus callout pairs a
// night's sleep (logged the morning after, under date D) with THAT day's focus
// minutes — i.e. "did sleeping ≥7h last night precede a more-focused today?",
// so sleepHours[D] is compared against focusMin[D].
//
// CSS: reuses the existing .rhythm-callout-list / .rhythm-callout rules
// (styles.css ~5691). No new CSS needed.
(function () {
  if (typeof RhythmInsights === 'undefined') return; // load-order guard
  const RI = RhythmInsights;
  const KEY = 'correlations';
  const TITLE = 'Correlations';
  const WINDOW = 14;

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  // Mean of a non-empty numeric array. Callers MUST guard arr.length > 0
  // before calling (returns 0 on empty rather than NaN as a backstop).
  function mean(arr) {
    if (!arr.length) return 0;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  RI.register({
    key: KEY,
    title: TITLE,
    order: 70,

    async build(deps) {
      const days = WINDOW;
      const now = deps.now();
      const win = RI.windowDays(days, now);

      // ── focusMinByDay: flow + pomodoro session minutes per day ───────
      const sessions = (await deps.getSessions()) || [];
      const focus = sessions.filter(s => s && (s.type === 'flow' || s.type === 'pomodoro'));
      const focusSeries = RI.sumByDay(
        focus,
        s => new Date(s.date).getTime(),
        s => (s.duration || 0) / 60000,
        days,
        now
      );
      const focusMinByDay = {};
      focusSeries.forEach(d => { focusMinByDay[d.key] = d.value; });

      // ── recoverySignalByDay: day → recovery_signal string ────────────
      const hist = (deps.getRecoveryHistory && deps.getRecoveryHistory()) || { rows: [] };
      const recoveryRows = Array.isArray(hist.rows) ? hist.rows : [];
      const recoverySignalByDay = {};
      recoveryRows.forEach(r => {
        if (r && typeof r.day === 'string' && typeof r.recovery_signal === 'string') {
          recoverySignalByDay[r.day] = r.recovery_signal;
        }
      });

      // ── bfrbByDay: day → catch count (pre-de-duped by the trend engine) ─
      const trend = (await deps.getBfrbTrend(days)) || { series: [] };
      const bfrbByDay = {};
      ((trend && trend.series) || []).forEach(pt => {
        if (pt && typeof pt.date === 'string' && isNum(pt.count)) {
          bfrbByDay[pt.date] = pt.count;
        }
      });

      // ── sleepHoursByDay: day → sleep.hours (number) when present ──────
      const restLog = (deps.getRestLog && deps.getRestLog()) || {};
      const sleepHoursByDay = {};
      Object.keys(restLog).forEach(k => {
        const sleep = restLog[k] && restLog[k].sleep;
        if (sleep && isNum(sleep.hours)) sleepHoursByDay[k] = sleep.hours;
      });

      // Restrict the recovery-keyed day-set classification to the window so a
      // stale cloud history can't drag in pre-window days.
      const winKeys = win.map(w => w.key);
      const winKeySet = {};
      winKeys.forEach(k => { winKeySet[k] = true; });

      const wellDays = winKeys.filter(k => recoverySignalByDay[k] === 'well_recovered');
      const strainedDays = winKeys.filter(k => recoverySignalByDay[k] === 'strained');

      const callouts = [];

      // (a) Focus on well-recovered vs strained days. Only when BOTH groups
      //     have ≥1 day (otherwise there's nothing to contrast).
      if (wellDays.length >= 1 && strainedDays.length >= 1) {
        const aFocus = wellDays.map(k => focusMinByDay[k] || 0);
        const bFocus = strainedDays.map(k => focusMinByDay[k] || 0);
        const a = Math.round(mean(aFocus));
        const b = Math.round(mean(bFocus));
        callouts.push(
          'Focus averaged ' + a + ' min on well-recovered days vs ' + b + ' min on strained days.'
        );

        // (b) BFRB catches on strained vs well-recovered days — same two
        //     groups, 1-decimal rate per day. Only emit when at least one of
        //     the two groups has a recorded catch count (else both read 0.0,
        //     which is noise, not a finding).
        const strainedBfrb = strainedDays.map(k => bfrbByDay[k] || 0);
        const wellBfrb = wellDays.map(k => bfrbByDay[k] || 0);
        const hasAnyBfrb = strainedDays.some(k => isNum(bfrbByDay[k]))
          || wellDays.some(k => isNum(bfrbByDay[k]));
        if (hasAnyBfrb) {
          const x = mean(strainedBfrb).toFixed(1);
          const y = mean(wellBfrb).toFixed(1);
          callouts.push(
            'BFRB catches ran ' + x + '/day on strained days vs ' + y + '/day on well-recovered days.'
          );
        }
      }

      // (c) Sleep ↔ focus: nights ≥7h vs <7h, compared against THAT day's
      //     focus minutes. Needs ≥4 days that have BOTH a sleep hours value
      //     AND a focus minute value, and both buckets non-empty.
      const paired = winKeys
        .filter(k => isNum(sleepHoursByDay[k]) && isNum(focusMinByDay[k]))
        .map(k => ({ hours: sleepHoursByDay[k], focus: focusMinByDay[k] }));
      if (paired.length >= 4) {
        const longSleep = paired.filter(p => p.hours >= 7).map(p => p.focus);
        const shortSleep = paired.filter(p => p.hours < 7).map(p => p.focus);
        if (longSleep.length >= 1 && shortSleep.length >= 1) {
          const p = Math.round(mean(longSleep));
          const q = Math.round(mean(shortSleep));
          callouts.push(
            'Focus was ' + p + ' min after ≥7h sleep vs ' + q + ' min after <7h.'
          );
        }
      }

      // dayCount = distinct in-window days touched by ANY stream.
      const touched = {};
      Object.keys(focusMinByDay).forEach(k => { if (focusMinByDay[k] > 0 && winKeySet[k]) touched[k] = true; });
      Object.keys(recoverySignalByDay).forEach(k => { if (winKeySet[k]) touched[k] = true; });
      Object.keys(bfrbByDay).forEach(k => { if (bfrbByDay[k] > 0 && winKeySet[k]) touched[k] = true; });
      Object.keys(sleepHoursByDay).forEach(k => { if (winKeySet[k]) touched[k] = true; });

      return { callouts: callouts, dayCount: Object.keys(touched).length };
    },

    render(model) {
      model = model || {};
      const callouts = Array.isArray(model.callouts) ? model.callouts : [];

      if (callouts.length === 0) {
        return RI.card({
          key: KEY, label: TITLE, aside: 'last ' + WINDOW + 'd',
          body: RI.empty('Keep logging focus, sleep, and recovery — correlations '
            + 'unlock once there are ~2 weeks of overlapping data.'),
        });
      }

      const list = '<ul class="rhythm-callout-list">'
        + callouts.map(c => '<li class="rhythm-callout">' + escapeHtml(c) + '</li>').join('')
        + '</ul>';

      return RI.card({
        key: KEY, label: TITLE, aside: 'last ' + WINDOW + 'd',
        body: list,
      });
    },
  });
})();
