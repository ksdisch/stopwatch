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
        const dims = RI.svgScaffold({ w: 320, h: 150, padL: 34, padR: 8, padT: 10, padB: 24 });
        const xMax = 24; // dose hour 0..24

        // Onset: convert bedtime to a continuous "night hour" so 11 PM (23) and
        // 12:30 AM (→24.5) sit adjacent; fixed 6 PM→6 AM band (18..30), earlier
        // = top. Duration: hours slept, more = top.
        const yMin = view === 'onset' ? 18 : 0;
        const yMax = view === 'onset' ? 30 : Math.max(12, ...usable.map(p => p.hours));
        const yClamp = (v) => Math.max(yMin, Math.min(yMax, v));

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
          const y = dims.padT + dims.innerH - ((yVal - yMin) / (yMax - yMin || 1)) * dims.innerH;
          const color = RI.qualityColor(p.quality);
          const tip = p.doseDayLabel + ': dose ' + RI.fmtHour(p.doseHour) + ' → ' + yLabel
            + (p.quality ? ' · q' + p.quality : '');
          return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3.5"'
            + ' fill="' + color + '" fill-opacity="0.85"><title>' + escapeHtml(tip) + '</title></circle>';
        }).join('');

        // x-axis baseline + tick labels (12a / 6a / 12p / 6p / 12a).
        const baseY = dims.padT + dims.innerH;
        const axis = '<line x1="' + dims.padL + '" y1="' + dims.padT + '" x2="' + dims.padL + '" y2="' + baseY + '" stroke="var(--btn-border)" stroke-width="1"/>'
          + '<line x1="' + dims.padL + '" y1="' + baseY + '" x2="' + (dims.padL + dims.innerW) + '" y2="' + baseY + '" stroke="var(--btn-border)" stroke-width="1"/>';

        chart = '<svg class="rhythm-ms-chart" viewBox="0 0 ' + dims.W + ' ' + dims.H + '"'
          + ' width="100%" height="' + dims.H + '" role="img"'
          + ' aria-label="Scatter of first dose hour versus ' + (view === 'onset' ? 'bedtime' : 'hours slept') + '">'
          + axis + dots + '</svg>'
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
