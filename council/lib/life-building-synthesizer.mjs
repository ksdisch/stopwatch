// Life Building synthesizer — Phase 5 slice 1 (Finances Area only).
//
// Pure ESM, no I/O: this module never reads env, the filesystem, or the
// network. The council runtime (synthesize.mjs) reads the raw Firestore data
// (Tempo's synced 'finances' store via the Admin SDK) and passes it in;
// everything here is testable under node --test.
//
// Slice 1 has ONE Area (Finances), whose four metrics blend into the Finances
// Area score, which (being the only Area) IS the Life Building composite.
// Adding Habits/Admin later just adds entries to the same weighted mean.
//
//   savingsRate   (level)  — clamp(rate / target, 0, 1); target from config
//   creditScore   (level)  — clamp((score − floor) / (target − floor), 0, 1)
//   debtRemaining (trend)  — down = good; % reduction between the two latest months
//   netWorth      (trend)  — up = good; % growth between the two latest months
//
// Trend metrics need ≥2 monthly snapshots carrying the field; null with <2.
// Level metrics go null when no snapshot carries the field.
//
// The composite reuses balance.mjs's importance-weighted mean (null metrics
// drop out, weights renormalize) — the same aggregation the home Balance uses.
//
// Staleness nudge (weekly mode only): when the latest snapshot's month ≠ the
// current month → priority-1 observational nudge. No-data is never a failing 0.
//
// DESCRIPTIVE-FIRST (mirrors tempo-coach.js): every headline/signal/nudge is
// OBSERVATIONAL — it reports what the data shows, never an imperative.

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

// Finite-number guard with a default (excludes NaN/Infinity/non-numbers).
function num(v, dflt) {
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

// Round a score value to integer, or null when not a finite number.
function roundOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

/**
 * currentMonthKey(now) — YYYY-MM string for a Date (or ms timestamp) in UTC.
 * Used for staleness comparison.
 */
export function currentMonthKey(now) {
  const d = typeof now === 'number' ? new Date(now) : now;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * confidenceFromCoverage(cov) — the contract confidence enum from coverage.
 * Same thresholds as physicals (>=0.8 high · >=0.5 medium · else low).
 */
export function confidenceFromCoverage(cov) {
  if (cov >= 0.8) return 'high';
  if (cov >= 0.5) return 'medium';
  return 'low';
}

// ── Finance metric helpers (each → integer 0..100, or null = no data) ────────

/**
 * savingsRateScore(docs, config) — level metric.
 * Uses the LATEST snapshot that carries a finite savingsRate.
 * Returns clamp(rate / target, 0, 1) * 100, or null when no snapshot has it.
 *
 * @param {Array<{month:string, savingsRate?:number}>} docs
 * @param {object} config — life-building.json contents
 * @returns {number|null}
 */
export function savingsRateScore(docs, config = {}) {
  const target = num(config.savingsTarget, 20);
  if (target <= 0) return null;
  // Iterate docs sorted newest-first (by month string — YYYY-MM sorts lexically)
  const sorted = (docs || [])
    .filter((d) => d && typeof d.month === 'string')
    .sort((a, b) => (b.month > a.month ? 1 : b.month < a.month ? -1 : 0));
  for (const doc of sorted) {
    if (typeof doc.savingsRate === 'number' && Number.isFinite(doc.savingsRate)) {
      return roundOrNull(clamp(doc.savingsRate / target, 0, 1) * 100);
    }
  }
  return null;
}

/**
 * creditScoreScore(docs, config) — level metric.
 * Uses the LATEST snapshot that carries a finite creditScore.
 * Returns clamp((score - floor) / (target - floor), 0, 1) * 100, or null.
 *
 * @param {Array<{month:string, creditScore?:number}>} docs
 * @param {object} config — life-building.json contents
 * @returns {number|null}
 */
export function creditScoreScore(docs, config = {}) {
  const target = num(config.creditTarget, 800);
  const floor = num(config.creditFloor, 670);
  const range = target - floor;
  if (range <= 0) return null;
  const sorted = (docs || [])
    .filter((d) => d && typeof d.month === 'string')
    .sort((a, b) => (b.month > a.month ? 1 : b.month < a.month ? -1 : 0));
  for (const doc of sorted) {
    if (typeof doc.creditScore === 'number' && Number.isFinite(doc.creditScore)) {
      return roundOrNull(clamp((doc.creditScore - floor) / range, 0, 1) * 100);
    }
  }
  return null;
}

/**
 * debtRemainingScore(docs) — trend metric, needs ≥2 months carrying debtRemaining.
 * Down = good. Score = clamp(reduction%, 0, 1) * 100, where reduction% is
 * (prev − curr) / |prev| when prev !== 0. Null with <2 eligible months.
 *
 * @param {Array<{month:string, debtRemaining?:number}>} docs
 * @returns {number|null}
 */
export function debtRemainingScore(docs) {
  const eligible = (docs || [])
    .filter(
      (d) =>
        d &&
        typeof d.month === 'string' &&
        typeof d.debtRemaining === 'number' &&
        Number.isFinite(d.debtRemaining),
    )
    .sort((a, b) => (a.month > b.month ? 1 : a.month < b.month ? -1 : 0));
  if (eligible.length < 2) return null;
  // Use the two most recent eligible months.
  const prev = eligible[eligible.length - 2].debtRemaining;
  const curr = eligible[eligible.length - 1].debtRemaining;
  if (prev === 0) {
    // No debt before; if still no debt, hold at 100; else can't score a trend.
    return curr === 0 ? 100 : null;
  }
  // Reduction fraction: (prev - curr) / |prev|. Negative means debt grew.
  const reduction = (prev - curr) / Math.abs(prev);
  return roundOrNull(clamp(reduction, 0, 1) * 100);
}

/**
 * netWorthScore(docs) — trend metric, needs ≥2 months carrying netWorth.
 * Up = good. Score = clamp(growth%, 0, 1) * 100, where growth% is
 * (curr − prev) / |prev| when prev !== 0. Null with <2 eligible months.
 *
 * @param {Array<{month:string, netWorth?:number}>} docs
 * @returns {number|null}
 */
export function netWorthScore(docs) {
  const eligible = (docs || [])
    .filter(
      (d) =>
        d &&
        typeof d.month === 'string' &&
        typeof d.netWorth === 'number' &&
        Number.isFinite(d.netWorth),
    )
    .sort((a, b) => (a.month > b.month ? 1 : a.month < b.month ? -1 : 0));
  if (eligible.length < 2) return null;
  const prev = eligible[eligible.length - 2].netWorth;
  const curr = eligible[eligible.length - 1].netWorth;
  if (prev === 0) {
    // Zero prev net worth: positive growth is 100, flat or negative is 0.
    return curr > 0 ? 100 : 0;
  }
  // Growth fraction: (curr - prev) / |prev|. Negative means net worth fell.
  const growth = (curr - prev) / Math.abs(prev);
  return roundOrNull(clamp(growth, 0, 1) * 100);
}

// ── Metric key set (used for coverage denominator matching spec) ──────────────

export const METRIC_KEYS = ['savingsRate', 'creditScore', 'debtRemaining', 'netWorth'];

// ── Copy (descriptive-first) ─────────────────────────────────────────────────

const BAND_PHRASE = {
  thriving: 'On track',
  steady: 'Holding',
  strained: 'Running low',
  depleted: 'Needs attention',
  unknown: 'No data yet',
};

function areaSignal(band) {
  return BAND_PHRASE[band] || BAND_PHRASE.unknown;
}

/** buildHeadline(composite, band) — <=140 char observational one-liner. */
function buildHeadline(composite, band) {
  if (composite == null) return 'No finances data entered yet — add this month\'s numbers to get started.';
  const phrase = {
    thriving: 'Life Building on track — finances heading in the right direction.',
    steady: 'Life Building steady — finances holding.',
    strained: 'Life Building strained — some finance metrics need attention.',
    depleted: 'Life Building needs attention — finances running well below targets.',
    unknown: 'Not enough data to read Life Building yet.',
  };
  const h = phrase[band] || phrase.unknown;
  return h.length > 140 ? `${h.slice(0, 139)}…` : h;
}

/**
 * buildLifeBuildingRecord({...}) — roll the Finances metrics into a single VALID
 * `life_building` synthesis record, with the additive `areas[]` (hub) + `balance{}`
 * (bubble-map lenses) fields. Stamps node/window/contractVersion/producedAt via
 * buildSynthesisRecord, then validates and THROWS on any contract violation.
 *
 * @param {object} args
 * @param {Array<{month:string, savingsRate?:number, creditScore?:number, debtRemaining?:number, netWorth?:number, deviceId:string, updatedAt:number, schemaVersion:number}>} args.financesDocs
 * @param {object} args.config         — life-building.json contents
 * @param {object} args.balanceConfig  — balance.json['life_building'] ({importance, target})
 * @param {"daily"|"weekly"} args.mode
 * @param {string} [args.producer]
 * @param {number} [args.now=Date.now()]
 * @returns {object} a VALID life_building synthesis record
 * @throws {Error} when the produced record fails validateSynthesisRecord
 */
export function buildLifeBuildingRecord({
  financesDocs = [],
  config = {},
  balanceConfig = {},
  mode = 'weekly',
  producer = 'council/life-building',
  now = Date.now(),
} = {}) {
  // ── Compute per-metric sub-scores ─────────────────────────────────────────
  const subscores = {
    savingsRate: savingsRateScore(financesDocs, config),
    creditScore: creditScoreScore(financesDocs, config),
    debtRemaining: debtRemainingScore(financesDocs),
    netWorth: netWorthScore(financesDocs),
  };

  const configWeights = config.weights || {};
  const weightFor = (key) => num(configWeights[key], 0);

  // The metrics that actually feed the composite: present (non-null) AND
  // carrying a positive weight. Same positive-weight pre-filter as physicals.
  const counted = METRIC_KEYS.filter((k) => subscores[k] != null && weightFor(k) > 0);

  // Composite via Balance engine's importance-weighted mean — weights renormalize.
  const composite = balanceScore(
    counted.map((key) => ({ score: subscores[key], importance: weightFor(key) })),
  );
  const band = bandForScore(composite);

  // ── Build the single Finances Area ────────────────────────────────────────
  const financesBand = band; // only one Area, so its band IS the composite band
  const financesSignal = composite != null
    ? areaSignal(financesBand)
    : 'No finances data entered yet.';

  const areas = [
    {
      key: 'finances',
      label: 'Finances',
      score: composite,
      band: financesBand,
      signal: financesSignal,
    },
  ];

  // ── Balance stamp (cross-runtime obligation — synthesize.mjs never re-stamps) ──
  const importance = num(balanceConfig.importance, DEFAULT_IMPORTANCE);
  const target = num(balanceConfig.target, DEFAULT_TARGET);
  const neglectValue = neglect({ score: composite, target, priorNeglect: 0 });
  const priorityValue = priority(importance, neglectValue);

  // ── Coverage = counted / 4 (all four metrics; inactive trends count against) ──
  const cov = METRIC_KEYS.length ? counted.length / METRIC_KEYS.length : 0;
  const confidence = confidenceFromCoverage(cov);

  // ── Staleness nudge (weekly mode only) ───────────────────────────────────
  const staleNudges = [];
  if (mode === 'weekly' && financesDocs.length > 0) {
    const latestMonth = (financesDocs || [])
      .filter((d) => d && typeof d.month === 'string')
      .sort((a, b) => (b.month > a.month ? 1 : b.month < a.month ? -1 : 0))[0];
    if (latestMonth && latestMonth.month !== currentMonthKey(now)) {
      staleNudges.push({ priority: 1, text: "Finances haven't been updated this month." });
    }
  }

  // Staleness is the ONLY nudge in v1 (ratified fork #3 / decision #8): the
  // synthesizer surfaces just the "not updated this month" prompt. Below-target
  // scoring is conveyed by the Area band/signal, not a nudge.
  const nudgeList = [...staleNudges];

  // ── headline + signals ────────────────────────────────────────────────────
  const headline = buildHeadline(composite, band);
  const metricSignals = METRIC_KEYS
    .map((k) => {
      const s = subscores[k];
      if (s == null) return null;
      const b = bandForScore(s);
      return `${k} ${b} (${s})`;
    })
    .filter(Boolean);
  const signals = metricSignals.length > 0 ? metricSignals : ['No finances data yet.'];

  // Only include the sources we actually drew from.
  const sources = counted.length > 0 ? ['finances'] : ['none'];

  // Use the current month as the window (finances are monthly, not daily-windowed).
  const window = currentMonthKey(now);

  const record = buildSynthesisRecord({
    node: 'life_building',
    producer,
    window,
    state: { band, score: composite },
    headline,
    signals: signals.slice(0, 5), // contract allows max 5
    nudges: nudgeList,
    provenance: { sources, coverage: cov },
    confidence,
    // ADDITIVE, contract-safe (additionalProperties: true):
    areas,                                                      // the hub renders this card
    balance: { importance, neglect: neglectValue, priority: priorityValue }, // bubble-map lenses
  });

  const { valid, errors } = validateSynthesisRecord(record);
  if (!valid) {
    throw new Error(
      `life_building synthesis record failed contract validation: ${errors.join('; ')}`,
    );
  }
  return record;
}
