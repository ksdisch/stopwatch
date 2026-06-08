// Physicals synthesizer — Phase 2 (the first REAL federated pillar).
//
// Pure ESM, no I/O: this module never reads env, the filesystem, or the
// network. The council runtime (synthesize.mjs) reads the raw Firestore data
// (recovery_state mart + Tempo's synced meds/rest_log/history stores via the
// Admin SDK) and passes it in; everything here is testable under node --test.
//
// It turns four Areas into one normalized 0..100 Physicals score + the additive
// `balance{}` stamp the PWA bubble-map lenses read, replacing the Phase-1 seed:
//
//   Recovery  — recovery_state.recovery_signal band   (reuses tempo-coach readinessBand)
//   Training  — recovery_state ACWR vs the optimal band (the app's only load signal)
//   Sleep     — rest_log hours vs target + quality/5   (hours target is council-set; app has none)
//   Meds      — doseLog adherence per analytics.getMedAdherence (per-day cap, excl. as-needed)
//
// The composite reuses balance.mjs's importance-weighted mean (null Areas drop
// out, weights renormalize) — the same aggregation the home Balance uses.
//
// DESCRIPTIVE-FIRST (mirrors tempo-coach.js): every headline/signal/nudge is
// OBSERVATIONAL — it reports what the data shows, never an imperative medical or
// training instruction. No-data is an explicit empty-state, never a failing 0.

import {
  clamp,
  neglect,
  priority,
  bandForScore,
  balanceScore,
  DEFAULT_IMPORTANCE,
  DEFAULT_TARGET,
} from './balance.mjs';
import {
  buildSynthesisRecord,
  validateSynthesisRecord,
} from './synthesis-record.mjs';

// The four Areas, in display order (also the order the hub renders cards).
export const AREA_KEYS = ['recovery', 'sleep', 'meds', 'training'];

const AREA_LABELS = {
  recovery: 'Recovery',
  sleep: 'Sleep',
  meds: 'Meds',
  training: 'Training load',
};

/** physicalsAreaLabel(key) — display label for an Area key. */
export function physicalsAreaLabel(key) {
  return AREA_LABELS[key] || (typeof key === 'string'
    ? key.charAt(0).toUpperCase() + key.slice(1)
    : 'Area');
}

// Finite-number guard with a default (excludes NaN/Infinity/non-numbers).
function num(v, dflt) {
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

// Round a config score value, or null when it isn't a finite number.
function roundOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

/**
 * dateKeyLocal(ms) — local-calendar YYYY-MM-DD for a ms timestamp, matching how
 * the Tempo app buckets days (analytics.js setHours(0,0,0,0) + Utils.localDateKey)
 * and how rest_log doc ids are keyed.
 */
export function dateKeyLocal(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * windowDateKeys(nowMs, windowDays) — the local date keys for the last
 * `windowDays` days ending today (inclusive), oldest first.
 */
export function windowDateKeys(nowMs, windowDays) {
  const n = Math.max(1, Math.floor(num(windowDays, 14)));
  const base = new Date(nowMs);
  const keys = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
    keys.push(dateKeyLocal(d.getTime()));
  }
  return keys;
}

/**
 * confidenceFromCoverage(cov) — the contract confidence enum from coverage.
 * Mirrors home-synthesizer's thresholds (>=0.8 high · >=0.5 medium · else low).
 */
export function confidenceFromCoverage(cov) {
  if (cov >= 0.8) return 'high';
  if (cov >= 0.5) return 'medium';
  return 'low';
}

// ── Area sub-scores (each → integer 0..100, or null = no data) ───────────────

/**
 * recoveryScore(recoveryLatest, scoring) — map the upstream categorical readiness
 * band (recovery_state.recovery_signal) onto a 0..100 score. Reuses the upstream
 * composite verdict (which already folds HRV/RHR/sleep) rather than re-fusing the
 * raw numerics. insufficient_data / missing / unknown → null.
 */
export function recoveryScore(recoveryLatest, scoring = {}) {
  const map = (scoring.recovery && scoring.recovery.signalScores) || {};
  const signal = recoveryLatest && typeof recoveryLatest.recovery_signal === 'string'
    ? recoveryLatest.recovery_signal
    : null;
  if (signal && Object.prototype.hasOwnProperty.call(map, signal)) {
    return roundOrNull(map[signal]);
  }
  return null;
}

/**
 * trainingScore(recoveryLatest, recoveryHistory, scoring) — band the ACWR
 * (acute:chronic workload ratio) the mart publishes. Optimal band → high score;
 * elevated/high → penalized ("don't dig a recovery hole"); detraining (<low) is
 * mildly off-target. Uses latest, falling back to the most recent history row
 * carrying a numeric acwr. No ACWR anywhere → null.
 */
export function trainingScore(recoveryLatest, recoveryHistory, scoring = {}) {
  const t = scoring.training || {};
  let acwr = recoveryLatest && typeof recoveryLatest.acwr === 'number' ? recoveryLatest.acwr : null;
  if (acwr == null && recoveryHistory && Array.isArray(recoveryHistory.rows)) {
    // Pick the most-recent row carrying a numeric acwr. Prefer the MAX .day (ISO
    // string compare) so we never assume array order — the recovery_state
    // contract leaves history ordering unspecified. Rows lacking a .day fall back
    // to the last positional numeric acwr (the de-facto oldest-first convention).
    let bestDay = null;
    let dayAcwr = null;
    let undatedAcwr = null;
    for (const r of recoveryHistory.rows) {
      if (!r || typeof r.acwr !== 'number') continue;
      if (typeof r.day === 'string' && r.day) {
        if (bestDay == null || r.day > bestDay) { bestDay = r.day; dayAcwr = r.acwr; }
      } else {
        undatedAcwr = r.acwr;
      }
    }
    acwr = (dayAcwr != null) ? dayAcwr : undatedAcwr;
  }
  if (acwr == null) return null;
  const s = t.scores || {};
  const optimalLow = num(t.optimalLow, 0.8);
  const optimalHigh = num(t.optimalHigh, 1.3);
  const elevatedHigh = num(t.elevatedHigh, 1.5);
  if (acwr < optimalLow) return roundOrNull(s.low);
  if (acwr <= optimalHigh) return roundOrNull(s.optimal);
  if (acwr <= elevatedHigh) return roundOrNull(s.elevated);
  return roundOrNull(s.high);
}

/**
 * sleepScore(restLog, windowKeys, scoring) — mean over logged nights in the
 * window of a per-night 0..1 blend: hours-vs-target + (when present) quality/5.
 * NOTE: the hours target is council-invented — the Tempo app stores raw hours +
 * a 1..5 quality grade but has no sleep-debt formula. No logged nights → null.
 *
 * @param {Array<{id?:string,date?:string,sleep?:{hours?:number,quality?:number}}>} restLog
 * @param {string[]} windowKeys — local date keys in scope
 */
export function sleepScore(restLog, windowKeys, scoring = {}) {
  const cfg = scoring.sleep || {};
  const target = num(cfg.targetHours, 7.5);
  const hoursWeight = num(cfg.hoursWeight, 0.6);
  const qualityWeight = num(cfg.qualityWeight, 0.4);
  const inWindow = new Set(windowKeys || []);
  const nights = [];
  for (const doc of (restLog || [])) {
    if (!doc) continue;
    const dateKey = typeof doc.id === 'string' && doc.id
      ? doc.id
      : (typeof doc.date === 'string' ? doc.date.slice(0, 10) : null);
    if (!dateKey || !inWindow.has(dateKey)) continue;
    const sleep = doc.sleep;
    if (!sleep || typeof sleep.hours !== 'number' || !Number.isFinite(sleep.hours)) continue;
    const hoursPart = target > 0 ? clamp(sleep.hours / target, 0, 1) : 0;
    let night;
    if (typeof sleep.quality === 'number' && sleep.quality >= 1 && sleep.quality <= 5) {
      const qualityPart = sleep.quality / 5;
      const wsum = hoursWeight + qualityWeight || 1;
      night = (hoursWeight * hoursPart + qualityWeight * qualityPart) / wsum;
    } else {
      night = hoursPart; // hours-only when quality wasn't logged
    }
    nights.push(night);
  }
  if (nights.length === 0) return null;
  const mean = nights.reduce((a, b) => a + b, 0) / nights.length;
  return clamp(Math.round(mean * 100), 0, 100);
}

/**
 * medsScore(meds, windowKeys, scoring) — adherence % over the window, mirroring
 * analytics.getMedAdherence: per scheduled med, mean over days of
 * min(1, takenThatDay / expected) (per-day capped at 1.0), then averaged across
 * scheduled meds. 'as-needed' meds are EXCLUDED (no adherence concept). No
 * scheduled meds → null (don't penalize an as-needed-only regimen).
 *
 * @param {Array<{frequency?:string,doseLog?:Array<{takenAt?:number}>}>} meds
 * @param {string[]} windowKeys
 */
export function medsScore(meds, windowKeys, scoring = {}) {
  const expected = (scoring.meds && scoring.meds.expected) || {};
  const scheduled = (meds || []).filter(
    (m) => m && (m.frequency === 'once-daily' || m.frequency === 'twice-daily'),
  );
  if (scheduled.length === 0) return null;
  const windowSet = new Set(windowKeys || []);
  const nDays = (windowKeys && windowKeys.length) || 1;
  const perMed = [];
  for (const med of scheduled) {
    const exp = num(expected[med.frequency], med.frequency === 'twice-daily' ? 2 : 1);
    if (exp <= 0) continue;
    const takenByDay = Object.create(null);
    const doseLog = Array.isArray(med.doseLog) ? med.doseLog : [];
    for (const dose of doseLog) {
      if (!dose || typeof dose.takenAt !== 'number') continue;
      const dk = dateKeyLocal(dose.takenAt);
      if (!windowSet.has(dk)) continue;
      takenByDay[dk] = (takenByDay[dk] || 0) + 1;
    }
    let sum = 0;
    for (const dk of (windowKeys || [])) {
      sum += Math.min(1, (takenByDay[dk] || 0) / exp);
    }
    perMed.push(sum / nDays);
  }
  if (perMed.length === 0) return null;
  const mean = perMed.reduce((a, b) => a + b, 0) / perMed.length;
  return clamp(Math.round(mean * 100), 0, 100);
}

// ── Copy (descriptive-first) ─────────────────────────────────────────────────

const BAND_PHRASE = {
  thriving: 'On track',
  steady: 'Holding',
  strained: 'Running low',
  depleted: 'Needs attention',
  unknown: 'No data yet',
};

/** areaSignal(band) — a short observational status phrase for an Area card. */
function areaSignal(band) {
  return BAND_PHRASE[band] || BAND_PHRASE.unknown;
}

const HEADLINE_READ = {
  thriving: 'thriving',
  steady: 'steady',
  strained: 'running strained',
  depleted: 'depleted',
  unknown: 'unread',
};

/** buildHeadline(areas, band, composite) — <=140 char observational one-liner. */
function buildHeadline(areas, band, composite) {
  if (composite == null) return 'Not enough data to read Physicals yet.';
  const read = HEADLINE_READ[band] || HEADLINE_READ.unknown;
  const scored = areas.filter((a) => a.score != null).slice().sort((a, b) => a.score - b.score);
  const weakest = scored[0];
  let h;
  if (weakest && weakest.score < 60) {
    h = `${weakest.label} is dragging — Physicals ${read} overall.`;
  } else {
    h = `Physicals ${read} — recovery, sleep, meds and load on track.`;
  }
  return h.length > 140 ? `${h.slice(0, 139)}…` : h;
}

const AREA_NUDGE = {
  recovery: 'Recovery readiness has run low this week.',
  sleep: 'Sleep has averaged below your target this week.',
  meds: 'Med adherence has dipped below full this week.',
  training: 'Training load is outside the optimal range this week.',
};

/** buildNudges(areas) — up to 2 OBSERVATIONAL moves for Areas below 60 (weekly). */
function buildNudges(areas) {
  return areas
    .filter((a) => a.score != null && a.score < 60)
    .sort((a, b) => a.score - b.score)
    .slice(0, 2)
    .map((a, i) => ({
      text: AREA_NUDGE[a.key] || `${a.label} is running low this week.`,
      priority: i + 1,
    }));
}

/**
 * buildPhysicalsRecord({...}) — roll the four Areas up into a single VALID
 * `physicals` synthesis record, with the additive `areas[]` (hub) + `balance{}`
 * (bubble-map lenses) fields. Stamps node/window/contractVersion/producedAt via
 * buildSynthesisRecord, then validates and THROWS on any contract violation.
 *
 * @param {object} args
 * @param {object|null} args.recoveryLatest   — recovery_state/latest doc data
 * @param {object|null} args.recoveryHistory  — recovery_state/history doc data ({rows:[...]})
 * @param {Array} args.meds                    — users/{uid}/meds docs
 * @param {Array} args.restLog                 — users/{uid}/rest_log docs (each with .id = date)
 * @param {Array} args.history                 — users/{uid}/history docs (reserved; v1 uses ACWR)
 * @param {object} args.scoring                — physicals.json contents
 * @param {object} args.balanceConfig          — balance.json['physicals'] ({importance,target})
 * @param {"daily"|"weekly"} args.mode
 * @param {string} args.producer
 * @param {number} [args.nowMs=Date.now()]
 * @param {string} [args.window]
 * @returns {object} a VALID physicals synthesis record
 * @throws {Error} when the produced record fails validateSynthesisRecord
 */
export function buildPhysicalsRecord({
  recoveryLatest = null,
  recoveryHistory = null,
  meds = [],
  restLog = [],
  history = [], // eslint-disable-line no-unused-vars — reserved for training-volume (v2)
  scoring = {},
  balanceConfig = {},
  mode = 'weekly',
  producer = 'council/physicals',
  nowMs = Date.now(),
  window: explicitWindow,
} = {}) {
  const windowKeys = windowDateKeys(nowMs, scoring.windowDays);

  const subscores = {
    recovery: recoveryScore(recoveryLatest, scoring),
    training: trainingScore(recoveryLatest, recoveryHistory, scoring),
    sleep: sleepScore(restLog, windowKeys, scoring),
    meds: medsScore(meds, windowKeys, scoring),
  };

  const weights = scoring.weights || {};
  const weightFor = (key) => num(weights[key], 0);

  // The Areas that actually feed the composite: present (non-null score) AND
  // carrying a positive weight. balanceScore silently omits importance-0 entries,
  // so we pre-filter to the SAME set coverage/confidence report below — otherwise
  // a mis-configured (missing/0) weight would drop a present Area from the score
  // while still inflating coverage ("high-confidence, no-data" card).
  const counted = AREA_KEYS.filter((k) => subscores[k] != null && weightFor(k) > 0);

  // Composite via the Balance engine's importance-weighted mean — weights
  // renormalize over the counted set, Math.round + clamp 0..100. Reuse, not re-impl.
  const composite = balanceScore(
    counted.map((key) => ({ score: subscores[key], importance: weightFor(key) })),
  );
  const band = bandForScore(composite);

  const areas = AREA_KEYS.map((key) => {
    const score = subscores[key];
    const b = bandForScore(score);
    return { key, label: physicalsAreaLabel(key), score, band: b, signal: areaSignal(b) };
  });

  // The cross-runtime balance stamp (importance/target from balance.json).
  const importance = num(balanceConfig.importance, DEFAULT_IMPORTANCE);
  const target = num(balanceConfig.target, DEFAULT_TARGET);
  const neglectValue = neglect({ score: composite, target, priorNeglect: 0 });
  const priorityValue = priority(importance, neglectValue);

  // coverage = fraction of the 4 Areas that actually fed the composite (present
  // AND weighted), so confidence can never read "high" on a null/partial score.
  const cov = AREA_KEYS.length ? counted.length / AREA_KEYS.length : 0;
  const confidence = confidenceFromCoverage(cov);

  const headline = buildHeadline(areas, band, composite);
  const signals = areas.map(
    (a) => `${a.label} ${a.band}${a.score == null ? '' : ` (${a.score})`}`,
  );
  const nudges = mode === 'weekly' ? buildNudges(areas) : [];

  const sources = [];
  if (subscores.recovery != null || subscores.training != null) sources.push('recovery_state');
  if (subscores.sleep != null) sources.push('rest_log');
  if (subscores.meds != null) sources.push('meds');
  if (sources.length === 0) sources.push('none');

  const window = explicitWindow
    || (windowKeys.length
      ? `${windowKeys[0]}..${windowKeys[windowKeys.length - 1]}`
      : dateKeyLocal(nowMs));

  const record = buildSynthesisRecord({
    node: 'physicals',
    producer,
    window,
    state: { band, score: composite },
    headline,
    signals,
    nudges,
    provenance: { sources, coverage: cov },
    confidence,
    // ADDITIVE, contract-safe (additionalProperties: true):
    areas, // the hub renders these 4 cards
    balance: { importance, neglect: neglectValue, priority: priorityValue }, // bubble-map lenses
  });

  const { valid, errors } = validateSynthesisRecord(record);
  if (!valid) {
    throw new Error(
      `physicals synthesis record failed contract validation: ${errors.join('; ')}`,
    );
  }
  return record;
}
