// Rhythm Insights panel: Today (order 5) — the daily-loop briefing, pinned
// ATOP Insights (order 5 < meds-sleep's 10).
//
// Turns the other panels' history FORWARD into a single "what does today look
// like" card: a readiness re-lens (additive), today's dose-logged status, last
// night's sleep, focus minutes so far, and a descriptive dose→sleep-onset
// observation. ALL the logic lives in the pure TempoCoach engine — this module
// only adapts the injected _deps accessors into the shape buildTodayModel reads,
// then renders the model to a DESCRIPTIVE HTML STRING (never touches `document`).
//
// EMPTY-STATE IS THE DEFAULT PATH: with no recovery feed (signed out / offline /
// pipeline silent — the common case) the panel still delivers local value from
// dose + sleep + focus data. The recovery re-lens is strictly additive. Every
// interpolated value is escaped via escapeHtml.
(function () {
  if (typeof RhythmInsights === 'undefined') return; // load-order guard
  if (typeof TempoCoach === 'undefined') return;      // engine must load first
  const RI = RhythmInsights;
  const KEY = 'today';
  const TITLE = 'Today';

  RI.register({
    key: KEY,
    title: TITLE,
    order: 5,

    // build adapts the RhythmInsights _deps surface (async getSessions,
    // getRecoveryHistory, live getMeds/getRestLog) into the synchronous shape
    // TempoCoach.buildTodayModel reads: a pre-resolved session array
    // (getSessionsSync) + a single latest recovery row (getRecoveryLatest).
    async build(deps) {
      deps = deps || {};

      // Resolve sessions once (shared with the per-render cache in renderInto).
      let sessions = [];
      try {
        sessions = (typeof deps.getSessions === 'function' && (await deps.getSessions())) || [];
      } catch (_) { sessions = []; }

      // Latest recovery row — prefer a deps override (tests), else the live feed.
      // Null when signed out / offline / never fetched → empty-state default.
      let latest = null;
      try {
        if (typeof deps.getRecoveryLatest === 'function') {
          latest = deps.getRecoveryLatest();
        } else if (typeof RecoveryFeed !== 'undefined' && typeof RecoveryFeed.getLatest === 'function') {
          latest = RecoveryFeed.getLatest();
        }
      } catch (_) { latest = null; }

      const coachDeps = {
        now: (typeof deps.now === 'function') ? deps.now : (() => Date.now()),
        getMeds: (typeof deps.getMeds === 'function') ? deps.getMeds : (() => []),
        getRestLog: (typeof deps.getRestLog === 'function') ? deps.getRestLog : (() => ({})),
        getSessionsSync: () => sessions,
        getRecoveryLatest: () => latest,
      };

      return TempoCoach.buildTodayModel(coachDeps);
    },

    render(model) {
      model = model || {};

      // Nothing local AND no recovery → the genuine empty state. Still a card,
      // not a blank — explains how value unlocks.
      if (model.empty) {
        return RI.card({
          key: KEY, label: TITLE,
          body: RI.empty('Log a dose, last night’s sleep, or a focus block to see today’s rhythm here.'),
        });
      }

      const rows = [];

      // (1) Readiness re-lens — additive, only when a signal exists.
      if (model.hasRecovery) {
        rows.push(_readinessRow(model));
      }

      // (2) Dose-logged status — observational, never "take it by X".
      if (model.doseStatus && model.doseStatus.hasMeds) {
        rows.push(_doseRow(model.doseStatus));
      }

      // (3) Last night's sleep.
      if (model.sleep && model.sleep.logged) {
        rows.push(_sleepRow(model.sleep));
      }

      // (4) Focus logged so far today.
      if (typeof model.focusTodayMs === 'number' && model.focusTodayMs > 0) {
        rows.push(_focusRow(model.focusTodayMs));
      }

      // (5) Dose → sleep-onset observation (suppressed on thin/noisy data).
      if (model.doseSleep && model.doseSleep.usable) {
        rows.push(_doseSleepRow(model.doseSleep));
      }

      const body = rows.length
        ? '<ul class="rhythm-callout-list rhythm-today-list">' + rows.join('') + '</ul>'
        : RI.empty('Nothing logged for today yet.');

      const aside = model.hasRecovery ? escapeHtml(_bandLabel(model.band)) : 'local';

      return RI.card({ key: KEY, label: TITLE, aside: aside, body: body });
    },
  });

  // ── Row builders (each returns an escaped <li> of descriptive copy) ──

  function _li(text) {
    return '<li class="rhythm-callout rhythm-today-row">' + escapeHtml(text) + '</li>';
  }

  function _bandLabel(band) {
    if (band === 'well') return 'Well-recovered';
    if (band === 'strained') return 'Strained';
    if (band === 'neutral') return 'Neutral';
    return '';
  }

  function _readinessRow(model) {
    const band = model.band;
    let text;
    if (band === 'well') {
      text = 'Recovery signal is strong today — a good window for a longer focus block.';
    } else if (band === 'strained') {
      text = 'Recovery signal is strained today — on similar days, focus minutes tend to run shorter.';
    } else {
      text = 'Recovery signal is neutral today.';
    }
    return _li(text);
  }

  function _doseRow(doseStatus) {
    const meds = doseStatus.meds || [];
    if (doseStatus.allLogged) {
      // All scheduled meds logged for today.
      const named = meds.filter(m => m.kind !== 'na').map(m => m.name);
      if (named.length === 1) return _li(named[0] + ' is logged for today.');
      if (named.length > 1) return _li('All scheduled meds are logged for today.');
      return _li('No scheduled doses are pending today.');
    }
    // Surface the unlogged ones, descriptively (not "take it").
    const pending = meds.filter(m => m.kind === 'none' || m.kind === 'partial');
    if (pending.length === 1) {
      const m = pending[0];
      if (m.kind === 'partial') {
        return _li(m.name + ': ' + m.takenToday + ' of ' + m.expected + ' doses logged so far today.');
      }
      return _li(m.name + ' has no dose logged yet today.');
    }
    if (pending.length > 1) {
      return _li(pending.length + ' meds have no dose logged yet today.');
    }
    return _li('Doses are up to date for today.');
  }

  function _sleepRow(sleep) {
    let text = 'Last night: ' + _fmtHours(sleep.hours) + ' of sleep';
    if (typeof sleep.quality === 'number') {
      text += ' · quality ' + sleep.quality + '/5';
    }
    text += '.';
    return _li(text);
  }

  function _focusRow(ms) {
    const t = Utils.formatMs(ms);
    const mins = t.hours * 60 + t.minutes;
    return _li('Focus so far today: ' + mins + ' min logged.');
  }

  function _doseSleepRow(ds) {
    const name = ds.medName ? ds.medName : 'your dose';
    const mag = Math.abs(ds.deltaMinutes);
    if (mag < 1) {
      return _li('Across recent days, ' + name + ' dose timing shows little link to sleep onset.');
    }
    const dir = ds.deltaMinutes > 0 ? 'later' : 'earlier';
    return _li('Across recent days, later ' + name + ' doses lined up with sleep onset about '
      + mag + ' min ' + dir + '.');
  }

  // Whole-hours-friendly sleep formatter (e.g. 7 → "7h", 7.5 → "7.5h").
  function _fmtHours(h) {
    const rounded = Math.round(h * 10) / 10;
    return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)) + 'h';
  }
})();
