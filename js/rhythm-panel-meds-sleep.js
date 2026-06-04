// Rhythm Insights panel: Meds vs Sleep (order 10) — the flagship + the
// copy-template for the other panels.
//
// Question it answers: "does taking my dose earlier in the day correlate with
// falling asleep earlier (or sleeping longer) that night?"
//   x = first-dose hour of the selected med on day D
//   y = that night's sleep — Onset view: bedtime; Duration view: hours slept
//   color = sleep quality (1-5, red→green)
//
// Causal pairing: a dose on day D influences the night of D→D+1, which the user
// logs the next morning as "last night's sleep" under date D+1. So each point
// pairs dose[D] with restLog[D+1], NOT restLog[D] (that night preceded the dose).
(function () {
  if (typeof RhythmInsights === 'undefined') return; // load-order guard
  const RI = RhythmInsights;
  const KEY = 'meds-sleep';

  // "HH:MM" (the #11 bedtime field) → fractional hour 0..24, or null.
  function hhmmToHour(s) {
    if (typeof s !== 'string') return null;
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = +m[1], min = +m[2];
    if (h > 23 || min > 59) return null;
    return h + min / 60;
  }

  // Local YYYY-MM-DD of the day after `date`.
  function nextDayKey(date) {
    const nd = new Date(date);
    nd.setDate(nd.getDate() + 1);
    return Utils.localDateKey(nd);
  }

  // Compact hour label for the Onset y-axis (time strings): 18→'6p', 21→'9p',
  // 24→'12a', 27→'3a', 30→'6a'. Input is a continuous night-hour (18..30).
  function compactNightHour(nh) {
    let h = ((Math.round(nh) % 24) + 24) % 24; // 18..30 → 18,21,0,3,6
    if (h === 0) return '12a';
    if (h === 12) return '12p';
    if (h < 12) return h + 'a';
    return (h - 12) + 'p';
  }

  RI.register({
    key: KEY,
    title: 'Meds vs Sleep',
    order: 10,

    build(deps) {
      const days = 14;
      const win = RI.windowDays(days, deps.now());
      const meds = deps.getMeds() || [];
      const restLog = deps.getRestLog() || {};
      if (meds.length === 0) return { empty: true };

      const winStart = win[0].start;
      const winEnd = win[win.length - 1].end;

      // Per med: in-window dose count (for default selection) + per-dose-day
      // points pairing the dose with the FOLLOWING night's sleep.
      const medMeta = [];
      const byMed = {};
      meds.forEach(med => {
        if (!med || typeof med.getId !== 'function') return;
        const id = med.getId();
        const log = (typeof med.getDoseLog === 'function' && med.getDoseLog()) || [];
        const inWin = log.filter(d => d && typeof d.takenAt === 'number'
          && d.takenAt >= winStart && d.takenAt < winEnd);

        // Earliest dose hour per dose-day.
        const firstDoseHourByDay = {};
        inWin.forEach(d => {
          const dt = new Date(d.takenAt);
          const k = Utils.localDateKey(dt);
          const hr = dt.getHours() + dt.getMinutes() / 60;
          if (firstDoseHourByDay[k] == null || hr < firstDoseHourByDay[k]) {
            firstDoseHourByDay[k] = hr;
          }
        });

        byMed[id] = win.map(w => {
          const doseHour = firstDoseHourByDay[w.key];
          const sleep = restLog[nextDayKey(w.date)] && restLog[nextDayKey(w.date)].sleep;
          return {
            doseDayKey: w.key,
            doseDayLabel: w.label,
            doseHour: doseHour == null ? null : doseHour,
            bedtimeHour: sleep ? hhmmToHour(sleep.bedtime) : null,
            hours: (sleep && typeof sleep.hours === 'number') ? sleep.hours : null,
            quality: (sleep && typeof sleep.quality === 'number') ? sleep.quality : null,
          };
        });

        medMeta.push({
          id: id,
          name: (typeof med.getName === 'function' && med.getName()) || 'Medication',
          dose: (typeof med.getDose === 'function' && med.getDose()) || '',
          doseCount: inWin.length,
        });
      });

      if (medMeta.length === 0) return { empty: true };
      medMeta.sort((a, b) => b.doseCount - a.doseCount); // most-dosed first = default

      return { empty: false, days: days, meds: medMeta, byMed: byMed, defaultMedId: medMeta[0].id };
    },

    render(model, ctx) {
      if (!model || model.empty) {
        return RI.card({
          key: KEY, label: 'Meds vs Sleep',
          body: RI.empty('No medications logged yet. Add one under Wellness › Meds.'),
        });
      }

      const st = ctx.state(KEY);
      const medId = (st.medId && model.byMed[st.medId]) ? st.medId : model.defaultMedId;
      const view = st.view === 'duration' ? 'duration' : 'onset'; // default Onset
      st.medId = medId; st.view = view;

      // Onset|Duration toggle in the card aside.
      const toggle =
        '<div class="rhythm-ms-toggle" role="radiogroup" aria-label="Sleep metric">'
        + '<button type="button" class="' + (view === 'onset' ? 'is-active' : '') + '"'
        + ' role="radio" aria-checked="' + (view === 'onset') + '"'
        + ' data-insight-action="' + KEY + ':view:onset">Onset</button>'
        + '<button type="button" class="' + (view === 'duration' ? 'is-active' : '') + '"'
        + ' role="radio" aria-checked="' + (view === 'duration') + '"'
        + ' data-insight-action="' + KEY + ':view:duration">Duration</button>'
        + '</div>';

      // Med selector — only render when more than one med exists.
      let selector = '';
      if (model.meds.length > 1) {
        selector = '<div class="rhythm-ms-meds" role="radiogroup" aria-label="Medication">'
          + model.meds.map(m =>
            '<button type="button" class="rhythm-ms-med ' + (m.id === medId ? 'is-active' : '') + '"'
            + ' role="radio" aria-checked="' + (m.id === medId) + '"'
            + ' data-insight-action="' + KEY + ':medId:' + escapeHtml(m.id) + '">'
            + escapeHtml(m.name) + '</button>').join('')
          + '</div>';
      }
      const selMed = model.meds.find(m => m.id === medId) || model.meds[0];
      const subtitle = '<div class="rhythm-ms-subtitle">'
        + escapeHtml(selMed.name) + ' · first dose vs that night · last ' + model.days + 'd</div>';

      const pts = model.byMed[medId] || [];
      const usable = pts.filter(p => p.doseHour != null
        && (view === 'onset' ? p.bedtimeHour != null : p.hours != null));

      let chart;
      if (usable.length === 0) {
        chart = RI.empty(view === 'onset'
          ? 'Log bedtimes under Wellness › Recovery to chart sleep onset.'
          : 'No sleep hours logged for the nights after these doses yet.');
      } else {
        // Onset's y-labels are time strings ('12a'…) — give padL a touch more
        // room than Duration's 'Nh' labels so they never clip on the left edge.
        const dims = RI.svgScaffold({ w: 320, h: 150, padL: view === 'onset' ? 40 : 34, padR: 8, padT: 10, padB: 24 });
        const xMax = 24; // dose hour 0..24

        // Onset: convert bedtime to a continuous "night hour" so 11 PM (23) and
        // 12:30 AM (→24.5) sit adjacent; fixed 6 PM→6 AM band (18..30), earlier
        // = top. Duration: hours slept, more = top — yMax snapped to a nice
        // tick so dots align with the gridlines/labels.
        const durTicks = view === 'duration'
          ? RI.niceTicks(Math.max(12, ...usable.map(p => p.hours)), 4)
          : null;
        const yMin = view === 'onset' ? 18 : 0;
        const yMax = view === 'onset' ? 30 : durTicks[durTicks.length - 1];
        const yClamp = (v) => Math.max(yMin, Math.min(yMax, v));
        const yToPx = (yVal) => dims.padT + dims.innerH - ((yVal - yMin) / (yMax - yMin || 1)) * dims.innerH;

        // Y-axis ticks + the pixel rows they sit on (shared by gridlines).
        let yTicks, yTickPx;
        if (view === 'onset') {
          const vals = [18, 21, 24, 27, 30];
          yTicks = vals.map(v => ({ y: yToPx(v), label: compactNightHour(v) }));
          yTickPx = yTicks.map(t => t.y);
        } else {
          yTicks = durTicks.map(v => ({ y: yToPx(v), label: v + 'h' }));
          yTickPx = yTicks.map(t => t.y);
        }

        // X-axis ticks at the four 6-hour marks + midnight bookends.
        const xTicks = [0, 6, 12, 18, 24].map(h => ({
          x: dims.padL + (h / xMax) * dims.innerW,
          label: RI.fmtHour(h),
        }));

        const dots = usable.map(p => {
          const x = dims.padL + (p.doseHour / xMax) * dims.innerW;
          let yVal, yLabel;
          if (view === 'onset') {
            const nightHour = p.bedtimeHour < 12 ? p.bedtimeHour + 24 : p.bedtimeHour;
            yVal = yClamp(nightHour);
            yLabel = 'bed ' + RI.fmtHour(p.bedtimeHour);
          } else {
            yVal = yClamp(p.hours);
            yLabel = p.hours + ' h';
          }
          const y = yToPx(yVal);
          const color = RI.qualityColor(p.quality);
          const tip = p.doseDayLabel + ' · dose ' + RI.fmtHour(p.doseHour) + ' → ' + yLabel
            + (p.quality ? ' · q' + p.quality + '/5' : '');
          return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3.5"'
            + ' fill="' + color + '" fill-opacity="0.85"'
            + ' data-day="' + escapeHtml(p.doseDayKey) + '"'
            + ' data-tip="' + escapeHtml(tip) + '"/>';
        }).join('');

        // Axis baselines + tick labels + faint gridlines, emitted BEFORE the
        // dots so the dots render on top and stay hoverable.
        const axis = RI.xAxis(dims, xTicks) + RI.yAxis(dims, yTicks);
        const grid = RI.gridlines(dims, { ys: yTickPx });

        chart = '<svg class="rhythm-ms-chart" viewBox="0 0 ' + dims.W + ' ' + dims.H + '"'
          + ' width="100%" height="' + dims.H + '" role="img"'
          + ' aria-label="Scatter of first dose hour versus ' + (view === 'onset' ? 'bedtime' : 'hours slept') + '">'
          + axis + grid + dots + '</svg>'
          + '<div class="rhythm-ms-axis">'
          + '<span>' + (view === 'onset' ? 'Earlier bedtime ↑' : 'More sleep ↑') + '</span>'
          + '<span>Earlier dose → later dose</span>'
          + '</div>'
          + '<div class="rhythm-ms-legend">'
          + '<span><i style="background:var(--red)"></i>poor</span>'
          + '<span><i style="background:var(--green)"></i>great</span>'
          + '<span class="rhythm-ms-legend-note">sleep quality</span>'
          + '</div>';
      }

      return RI.card({
        key: KEY, label: 'Meds vs Sleep', aside: toggle,
        body: subtitle + selector + chart,
      });
    },
  });
})();
