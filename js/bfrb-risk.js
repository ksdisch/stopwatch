// BFRB Risk — the pure "is today clustering?" decision core (BFRB Closed Loop
// Slice B, the deferred in-the-moment half of #16).
//
// ONE job: given the live consolidated BFRB stream + the current time + (optional)
// today's recovery row, decide whether today's catches are CLUSTERING above the
// user's own recent baseline — so the wiring layer (js/global-bfrb.js) can offer a
// gentle, opt-in "your 60-second reset is here whenever you want it" support nudge.
//
// THE NON-NEGOTIABLE: this module decides a BAND and returns NUMBERS. It NEVER
// owns user-facing copy — the ratified supportive string lives in js/global-bfrb.js
// (the one human-ratification surface). So "is it clustered?" (testable logic) is
// cleanly separated from "what words do we say" (ratified UI copy).
//
// DESCRIPTIVE-FIRST, like js/tempo-coach.js: the band reports what the user's own
// data shows; it never predicts ("expect 9 today") and never prescribes. Suppression
// guards mirror TempoCoach.doseSleepSlope — never assert on thin data.
//
// PURE: zero DOM, zero side-effects, zero localStorage. Every input is an argument
// so the whole surface is unit-testable with fixtures. Empty / null / signed-out
// recovery state is the DEFAULT path, not a fallback — Surface 1 works with no feed.
const BfrbRisk = (() => {

  // ── Tunables ─────────────────────────────────────────────────────────
  const WINDOW_DAYS = 14;        // trailing baseline window (excludes today)
  const MIN_ACTIVE_DAYS = 4;     // ≥4 days WITH a catch before we trust a baseline
  const MIN_TODAY_FLOOR = 3;     // don't nudge below the 3rd catch today
  const CLUSTER_FACTOR = 1.5;    // clustered when today ≥ ceil(baseline × this)
  // Recovery re-lens (strictly additive — only ever makes the nudge MORE available):
  const STRAINED_TODAY_FLOOR = 2;
  const STRAINED_CLUSTER_FACTOR = 1.25;

  // Local 'YYYY-MM-DD' (no UTC shift — split via the local Date fields). Matches
  // the helper in js/bfrb-events.js / js/global-bfrb.js so day-bucketing agrees.
  function _localDateKey(d) {
    return d.getFullYear() + '-'
      + String(d.getMonth() + 1).padStart(2, '0') + '-'
      + String(d.getDate()).padStart(2, '0');
  }

  // Map a recovery-feed row onto the strained flag. Mirrors
  // TempoCoach.readinessBand but only the 'strained' case matters here, and a
  // missing/unrecognized signal is the COMMON case (no feed) → not strained.
  function _isStrained(recoveryState) {
    if (typeof TempoCoach !== 'undefined' && typeof TempoCoach.readinessBand === 'function') {
      try { return TempoCoach.readinessBand(recoveryState) === 'strained'; } catch (_) { /* fall through */ }
    }
    // Local fallback so this module is usable without TempoCoach loaded (tests).
    return !!(recoveryState && typeof recoveryState === 'object'
      && recoveryState.recovery_signal === 'strained');
  }

  // ── assess ───────────────────────────────────────────────────────────
  // events: the live BfrbEvents.getAll() array (or any [{ takenAt }] list).
  // now: ms epoch (defaults to Date.now()).
  // recoveryState: today's recovery-feed row, or null (the default path).
  //
  // Returns a decision object — NEVER throws, NEVER NaN:
  //   {
  //     band: 'clustered' | 'steady' | null,  // null === suppressed (no baseline)
  //     todayCount,                            // catches so far today
  //     baselineActiveAvg,                     // mean catches per active day, 14d ex-today
  //     activeDays,                            // active days in the baseline window
  //     suppressed,                            // true when band === null
  //     strainedLens,                          // true when the strained re-lens applied
  //   }
  function assess(input) {
    input = input || {};
    const events = Array.isArray(input.events) ? input.events : [];
    const now = (typeof input.now === 'number' && isFinite(input.now)) ? input.now : Date.now();
    const strained = _isStrained(input.recoveryState);

    const todayKey = _localDateKey(new Date(now));

    // Window start = local midnight (WINDOW_DAYS-1) days before today, so the
    // window is [windowStart, todayStart) for the baseline and today is separate.
    const base = new Date(now); base.setHours(0, 0, 0, 0);
    const todayStartMs = base.getTime();
    const winStartMs = new Date(base.getFullYear(), base.getMonth(),
      base.getDate() - (WINDOW_DAYS - 1)).getTime();

    let todayCount = 0;
    const baselineDayCounts = {}; // dayKey → count, baseline window only (excl. today)

    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (!e || typeof e.takenAt !== 'number' || !isFinite(e.takenAt)) continue;
      const t = e.takenAt;
      if (t > now) continue; // ignore future-stamped rows defensively
      const key = _localDateKey(new Date(t));
      if (key === todayKey) {
        todayCount++;
      } else if (t >= winStartMs && t < todayStartMs) {
        baselineDayCounts[key] = (baselineDayCounts[key] || 0) + 1;
      }
    }

    const activeDayKeys = Object.keys(baselineDayCounts);
    const activeDays = activeDayKeys.length;
    let baselineSum = 0;
    for (let i = 0; i < activeDayKeys.length; i++) baselineSum += baselineDayCounts[activeDayKeys[i]];
    const baselineActiveAvg = activeDays > 0 ? baselineSum / activeDays : 0;

    const result = {
      band: null,
      todayCount: todayCount,
      baselineActiveAvg: baselineActiveAvg,
      activeDays: activeDays,
      suppressed: true,
      strainedLens: strained,
    };

    // Guard 1: not enough active history to trust a baseline → suppress.
    if (activeDays < MIN_ACTIVE_DAYS) return result;

    const todayFloor = strained ? STRAINED_TODAY_FLOOR : MIN_TODAY_FLOOR;
    const factor = strained ? STRAINED_CLUSTER_FACTOR : CLUSTER_FACTOR;

    result.suppressed = false;

    // Guard 2: below the today floor → steady (don't nag early in the day).
    if (todayCount < todayFloor) {
      result.band = 'steady';
      return result;
    }

    // Decision: clustered when today meets/exceeds the scaled baseline threshold.
    const threshold = Math.ceil(baselineActiveAvg * factor);
    result.band = (todayCount >= threshold) ? 'clustered' : 'steady';
    return result;
  }

  return {
    assess,
    // Exposed for tests / wiring; not part of a broad app surface.
    _internals: {
      WINDOW_DAYS, MIN_ACTIVE_DAYS, MIN_TODAY_FLOOR, CLUSTER_FACTOR,
      STRAINED_TODAY_FLOOR, STRAINED_CLUSTER_FACTOR,
      _localDateKey, _isStrained,
    },
  };
})();

if (typeof window !== 'undefined') {
  window.BfrbRisk = BfrbRisk;
}
