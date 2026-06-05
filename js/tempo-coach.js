// Tempo Coach — the pure "daily loop" decision core (tempo-coach-daily-loop).
//
// Turns Tempo's already-computed signals FORWARD into daily decisions:
//   - readinessBand(recoveryState)        → which band today's recovery row implies
//   - suggestFocusDurationMs(recoveryState) → a readiness-sized Flow focus default
//   - doseSleepSlope(pairs)               → a dose→sleep-onset slope, suppressed on thin/noisy data
//   - buildTodayModel(deps)               → the assembled model for the "Today" Insights panel
//   - shouldNudge(recoveryState, now)     → a pure decision for the opt-in morning heads-up
//
// THE ONE NON-NEGOTIABLE: DESCRIPTIVE-FIRST. Every string this module emits is
// observational ("on similar days your focus ran about half"), NEVER imperative
// ("take your dose by 9 AM"). The app reports what its own data shows; it never
// prescribes a medical action. The morning-nudge copy is the riskiest surface
// and is held to the same bar.
//
// PURE: zero DOM, zero side-effects. Every function returns a decision object;
// callers (rhythm-panel-today.js, flow-ui.js, tempo-nav.js) act on it. The
// recovery-feed row is read from `recoveryState` arguments / injected `deps`
// accessors so the whole surface is unit-testable with fixtures. Empty / null /
// signed-out recovery state is the DEFAULT path, not a fallback.
const TempoCoach = (() => {

  // Flow focus-duration constants, mirrored from js/flow.js PRESETS so a band
  // maps to the exact ms the engine accepts. Kept literal (no hard dep on Flow
  // being loaded — this module loads early, before flow-ui).
  const FOCUS_90 = 5400000;   // 90 min
  const FOCUS_120 = 7200000;  // 120 min

  // doseSleepSlope suppression thresholds — never assert a slope on thin/noisy
  // data. Mirrors the both-groups-have-data guard in rhythm-panel-correlations.js.
  const MIN_PAIRS = 5;          // ≥5 usable {doseHour, bedtimeHour} pairs
  const MIN_X_SPREAD_HOURS = 1.5; // ≥1.5h between earliest + latest dose hour
  const NOT_ENOUGH = 'Not enough data yet — keep logging doses and bedtimes.';

  // ── readinessBand ──────────────────────────────────────────────────
  // Map a recovery-feed row's recovery_signal onto the three coach bands.
  // Mirrors the well/strained classification language in rhythm-ui.js /
  // rhythm-panel-correlations.js so copy stays consistent across the app.
  //
  //   'well_recovered'                          → 'well'
  //   'strained'                                → 'strained'
  //   'neutral'                                 → 'neutral'
  //   null / missing / 'insufficient_data' /
  //     any unrecognized value / no row         → null (no signal)
  //
  // null is the common case (signed out / offline / pipeline hasn't pushed) —
  // every caller treats it as "render local value, add no recovery re-lens".
  function readinessBand(recoveryState) {
    if (!recoveryState || typeof recoveryState !== 'object') return null;
    const sig = recoveryState.recovery_signal;
    if (sig === 'well_recovered') return 'well';
    if (sig === 'strained') return 'strained';
    if (sig === 'neutral') return 'neutral';
    return null; // insufficient_data / absent / unrecognized → no signal
  }

  // ── suggestFocusDurationMs ─────────────────────────────────────────
  // A readiness-sized Flow focus default. well → 120 min, strained → 90 min,
  // neutral / null → no suggestion (ms:null) so flow-ui keeps the user's last
  // persisted default untouched. `reason` is a short DESCRIPTIVE string (the
  // "why" line under the duration buttons), present only when suggesting.
  function suggestFocusDurationMs(recoveryState) {
    const band = readinessBand(recoveryState);
    if (band === 'well') {
      return {
        ms: FOCUS_120,
        band: 'well',
        reason: 'Recovery signal is strong today — a longer block tends to land well on days like this.',
      };
    }
    if (band === 'strained') {
      return {
        ms: FOCUS_90,
        band: 'strained',
        reason: 'Recovery signal is strained today — a shorter block has matched these days better.',
      };
    }
    // neutral / null → leave the user's last default in place, no "why" line.
    return { ms: null, band: band, reason: null };
  }

  // ── doseSleepSlope ─────────────────────────────────────────────────
  // Least-squares slope of bedtimeHour (y) on doseHour (x) over
  // { doseHour, bedtimeHour } pairs, with SUPPRESSION GUARDS so the panel
  // never narrates a correlation that isn't there:
  //   1. ≥ MIN_PAIRS usable pairs (both coords finite numbers)
  //   2. ≥ MIN_X_SPREAD_HOURS between earliest + latest dose hour (a flat x
  //      can't support a slope claim)
  //   3. slope stability — the residual scatter must be small relative to the
  //      slope's own predicted spread (guards against a noisy cloud that a
  //      line happens to thread). Modeled as R² ≥ 0.3.
  // Any guard failing → { usable:false, reason:NOT_ENOUGH } with the numeric
  // fields zeroed (never NaN). `deltaMinutes` is the DESCRIPTIVE
  // earliest-vs-latest-dose-day onset difference used in the copy (positive =
  // later doses → later bedtime).
  function doseSleepSlope(pairs) {
    const clean = (Array.isArray(pairs) ? pairs : []).filter(p =>
      p && typeof p.doseHour === 'number' && isFinite(p.doseHour)
        && typeof p.bedtimeHour === 'number' && isFinite(p.bedtimeHour));

    const base = { usable: false, slope: 0, intercept: 0, nPoints: clean.length, deltaMinutes: 0, reason: NOT_ENOUGH };

    // Guard 1: enough usable pairs.
    if (clean.length < MIN_PAIRS) return base;

    const xs = clean.map(p => p.doseHour);
    // Treat a bedtime logged in the small hours (e.g. 0.5 = 12:30 AM) as a
    // continuous "night hour" past midnight so it sits AFTER an 11 PM bedtime,
    // mirroring rhythm-panel-meds-sleep.js's onset transform.
    const ys = clean.map(p => (p.bedtimeHour < 12 ? p.bedtimeHour + 24 : p.bedtimeHour));

    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const xSpread = xMax - xMin;

    // Guard 2: enough x-spread to support a slope.
    if (xSpread < MIN_X_SPREAD_HOURS) return base;

    const n = clean.length;
    const meanX = xs.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;

    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - meanX, dy = ys[i] - meanY;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    if (sxx === 0) return base; // degenerate (all x equal — also caught by spread)

    const slope = sxy / sxx;
    const intercept = meanY - slope * meanX;

    // Guard 3: slope stability via R². syy===0 (all bedtimes identical) → no
    // variance to explain → not a finding.
    const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
    if (r2 < 0.3) return base;

    // Descriptive delta: predicted onset difference across the observed dose
    // span (earliest vs latest dose day), in minutes. Sign preserved.
    const deltaMinutes = Math.round(slope * xSpread * 60);

    return {
      usable: true,
      slope: slope,
      intercept: intercept,
      nPoints: n,
      deltaMinutes: deltaMinutes,
      reason: null,
    };
  }

  // ── buildTodayModel ────────────────────────────────────────────────
  // Assemble the "Today" panel model from injected `deps` (the RhythmInsights
  // _deps accessors, overridable for tests). EVERY field is computed defensively
  // so empty / sparse / signed-out deps yield a valid model with empty-state
  // flags set — never a throw, never a NaN. The recovery re-lens is strictly
  // ADDITIVE: with no recovery feed the model still carries local dose + sleep +
  // focus value.
  //
  // Returns:
  //   {
  //     band,                 // 'well'|'strained'|'neutral'|null
  //     hasRecovery,          // bool — a usable recovery row was present
  //     focusSuggestion,      // suggestFocusDurationMs() result (ms may be null)
  //     doseStatus: {         // live MedsManager-derived dose-logged status
  //       hasMeds, allLogged, anyUnlogged, meds:[{ name, dose, kind, takenToday, expected }]
  //     },
  //     sleep: { logged, hours, quality, bedtime } | { logged:false },
  //     focusTodayMs,         // total flow+pomodoro session ms logged today
  //     doseSleep,            // doseSleepSlope() result over the trailing window
  //     empty                 // true when there is NOTHING local to show either
  //   }
  function buildTodayModel(deps) {
    deps = deps || {};
    const now = (typeof deps.now === 'function') ? deps.now() : Date.now();

    // ── Recovery band (additive) ──────────────────────────────────────
    let recoveryState = null;
    try {
      recoveryState = (typeof deps.getRecoveryLatest === 'function')
        ? deps.getRecoveryLatest()
        : null;
    } catch (_) { recoveryState = null; }
    const band = readinessBand(recoveryState);
    const focusSuggestion = suggestFocusDurationMs(recoveryState);

    // ── Live dose-logged status (MedsManager, never wellness_meds blob) ─
    const doseStatus = _buildDoseStatus(deps);

    // ── Today's sleep (rest log, keyed YYYY-MM-DD) ────────────────────
    const sleep = _buildSleepToday(deps, now);

    // ── Focus minutes logged today (flow + pomodoro) ──────────────────
    // Synchronous-only: getSessions may be async; buildTodayModel stays sync so
    // the panel build can be sync. focusTodayMs is sourced from the doseSleep
    // pairs path only when sessions are pre-resolved; otherwise 0. The panel's
    // build awaits sessions and passes a resolved array via deps.getSessionsSync
    // when available (see rhythm-panel-today.js).
    const focusTodayMs = _focusTodayMs(deps, now);

    // ── dose→sleep-onset slope over the trailing window ───────────────
    const doseSleep = _buildDoseSleep(deps, now);

    const hasRecovery = band !== null;
    const empty = !doseStatus.hasMeds && !sleep.logged && focusTodayMs === 0 && !hasRecovery;

    return {
      band: band,
      hasRecovery: hasRecovery,
      focusSuggestion: focusSuggestion,
      doseStatus: doseStatus,
      sleep: sleep,
      focusTodayMs: focusTodayMs,
      doseSleep: doseSleep,
      empty: empty,
    };
  }

  // Live dose-logged status from MedsManager via deps.getMeds(). Reads each
  // med's getStatusToday() / getName() / getDose(). NEVER localStorage.
  function _buildDoseStatus(deps) {
    let meds = [];
    try {
      meds = (typeof deps.getMeds === 'function' && deps.getMeds()) || [];
    } catch (_) { meds = []; }

    const rows = [];
    let anyUnlogged = false;
    meds.forEach(med => {
      if (!med || typeof med.getStatusToday !== 'function') return;
      let status;
      try { status = med.getStatusToday(); } catch (_) { return; }
      if (!status) return;
      const name = (typeof med.getName === 'function' && med.getName()) || 'Medication';
      const dose = (typeof med.getDose === 'function' && med.getDose()) || '';
      // 'na' (as-needed) doesn't count toward "unlogged" — there's no expectation.
      if (status.kind === 'none' || status.kind === 'partial') anyUnlogged = true;
      rows.push({
        name: name,
        dose: dose,
        kind: status.kind,
        takenToday: status.takenToday || 0,
        expected: status.expected,
      });
    });

    return {
      hasMeds: rows.length > 0,
      allLogged: rows.length > 0 && !anyUnlogged,
      anyUnlogged: anyUnlogged,
      meds: rows,
    };
  }

  // Today's sleep entry from the rest log (object keyed YYYY-MM-DD). The night
  // logged the morning of `now` lives under today's key.
  function _buildSleepToday(deps, now) {
    let restLog = {};
    try {
      restLog = (typeof deps.getRestLog === 'function' && deps.getRestLog()) || {};
    } catch (_) { restLog = {}; }
    const key = Utils.localDateKey(new Date(now));
    const entry = restLog[key] && restLog[key].sleep;
    if (!entry || typeof entry.hours !== 'number' || !isFinite(entry.hours)) {
      return { logged: false };
    }
    return {
      logged: true,
      hours: entry.hours,
      quality: (typeof entry.quality === 'number') ? entry.quality : null,
      bedtime: (typeof entry.bedtime === 'string') ? entry.bedtime : null,
    };
  }

  // Total flow+pomodoro session ms logged today, from a PRE-RESOLVED session
  // array (deps.getSessionsSync — the panel resolves the async getSessions once
  // and hands the array down). Returns 0 when unavailable so buildTodayModel
  // stays synchronous and never throws.
  function _focusTodayMs(deps, now) {
    let sessions = [];
    try {
      sessions = (typeof deps.getSessionsSync === 'function' && deps.getSessionsSync()) || [];
    } catch (_) { sessions = []; }
    if (!Array.isArray(sessions) || sessions.length === 0) return 0;
    const todayKey = Utils.localDateKey(new Date(now));
    let total = 0;
    sessions.forEach(s => {
      if (!s || (s.type !== 'flow' && s.type !== 'pomodoro')) return;
      const t = new Date(s.date).getTime();
      if (!isFinite(t)) return;
      if (Utils.localDateKey(new Date(t)) !== todayKey) return;
      const d = (typeof s.duration === 'number' && isFinite(s.duration)) ? s.duration : 0;
      total += d;
    });
    return total;
  }

  // Build { doseHour, bedtimeHour } pairs over the trailing 14 days — first dose
  // hour on day D paired with the FOLLOWING night's bedtime (restLog[D+1]),
  // matching the causal pairing in rhythm-panel-meds-sleep.js — then run
  // doseSleepSlope. Uses deps.getMeds() (live) + deps.getRestLog(). Picks the
  // most-dosed in-window med as the subject. Returns a doseSleepSlope result
  // plus the subject med name (null when no med qualifies).
  function _buildDoseSleep(deps, now) {
    const WINDOW = 14;
    let meds = [], restLog = {};
    try { meds = (typeof deps.getMeds === 'function' && deps.getMeds()) || []; } catch (_) { meds = []; }
    try { restLog = (typeof deps.getRestLog === 'function' && deps.getRestLog()) || {}; } catch (_) { restLog = {}; }

    const base = new Date(now); base.setHours(0, 0, 0, 0);
    const y = base.getFullYear(), mo = base.getMonth(), da = base.getDate();
    const winStart = new Date(y, mo, da - (WINDOW - 1)).getTime();
    const winEnd = new Date(y, mo, da + 1).getTime();

    let best = null; // { name, count, pairs }
    meds.forEach(med => {
      if (!med || typeof med.getDoseLog !== 'function') return;
      let log;
      try { log = med.getDoseLog() || []; } catch (_) { return; }
      const inWin = log.filter(d => d && typeof d.takenAt === 'number'
        && d.takenAt >= winStart && d.takenAt < winEnd);
      if (inWin.length === 0) return;

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

      const pairs = [];
      Object.keys(firstDoseHourByDay).forEach(dayKey => {
        // Next-day bedtime: the night that the dose-day's dose influenced.
        const parts = dayKey.split('-').map(Number);
        const nd = new Date(parts[0], parts[1] - 1, parts[2] + 1);
        const nextKey = Utils.localDateKey(nd);
        const sleep = restLog[nextKey] && restLog[nextKey].sleep;
        const bedtimeHour = sleep ? _hhmmToHour(sleep.bedtime) : null;
        if (bedtimeHour != null) {
          pairs.push({ doseHour: firstDoseHourByDay[dayKey], bedtimeHour: bedtimeHour });
        }
      });

      if (!best || inWin.length > best.count) {
        const name = (typeof med.getName === 'function' && med.getName()) || 'Medication';
        best = { name: name, count: inWin.length, pairs: pairs };
      }
    });

    if (!best) {
      return Object.assign({ medName: null }, doseSleepSlope([]));
    }
    return Object.assign({ medName: best.name }, doseSleepSlope(best.pairs));
  }

  // "HH:MM" → fractional hour 0..24, or null. Mirrors rhythm-panel-meds-sleep.js.
  function _hhmmToHour(s) {
    if (typeof s !== 'string') return null;
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = +m[1], min = +m[2];
    if (h > 23 || min > 59) return null;
    return h + min / 60;
  }

  // ── shouldNudge ────────────────────────────────────────────────────
  // Pure decision for the opt-in morning heads-up. DESCRIPTIVE copy only —
  // reports the recovery signal, never prescribes an action. No scheduling
  // side-effect here (the drawer toggle owns BgNotify). No signal → nudge:false
  // (nothing to say → don't fire). `now` is accepted for future time-of-day
  // gating + testability; current logic is time-independent.
  function shouldNudge(recoveryState, now) {
    const band = readinessBand(recoveryState);
    if (band === 'well') {
      return {
        nudge: true,
        title: 'Tempo · today’s rhythm',
        body: 'Today’s recovery signal is strong — a good window for a longer focus block.',
      };
    }
    if (band === 'strained') {
      return {
        nudge: true,
        title: 'Tempo · today’s rhythm',
        body: 'Today’s recovery signal is strained — on similar days, shorter focus blocks have fit better.',
      };
    }
    // neutral / null → nothing notable to report; don't nudge.
    return { nudge: false, title: null, body: null };
  }

  return {
    readinessBand,
    suggestFocusDurationMs,
    doseSleepSlope,
    buildTodayModel,
    shouldNudge,
    // Exposed for tests / panel reuse; not part of the broad app surface.
    _internals: {
      FOCUS_90, FOCUS_120, MIN_PAIRS, MIN_X_SPREAD_HOURS, NOT_ENOUGH,
      _hhmmToHour, _buildDoseSleep, _focusTodayMs,
    },
  };
})();
