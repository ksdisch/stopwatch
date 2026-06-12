// Chickens synthesizer — Phase 3 (the build-heavy native pillar).
//
// Pure ESM, no I/O: this module never reads env, the filesystem, or the
// network. The council runtime (synthesize.mjs) reads the raw Firestore data
// (Tempo's synced mood_events / bfrb_events / history stores plus the
// `physicals` synthesis RECORD via the Admin SDK) and passes it in; everything
// here is testable under node --test.
//
// It turns five Areas into one normalized 0..100 Chickens score + the additive
// `balance{}` stamp the PWA bubble-map lenses read, replacing the Phase-1 seed:
//
//   Mood        — mood_events mean valence over the window ((mean−1)/4×100)
//   Mindfulness — history sessions tagged 'mindful' OR Meditation-named timers
//   BFRB        — bfrb_events last-7d vs prior-7d trend ratio (quiet-stream floor)
//   Focus       — history flow+pomodoro minutes vs a 14-day engagement target
//   Stress      — BORROWED: mean of the physicals RECORD's recovery+sleep Areas
//                 (the contract's recursion rule — read the sibling's record,
//                 never its raw stores)
//
// The composite reuses balance.mjs's importance-weighted mean (null Areas drop
// out, weights renormalize) — the same aggregation the home Balance uses.
//
// A thin Tier-3 weekly reflection ({weekKey: {rating, note}}, the gitignored
// council/data/reflections/chickens.json) folds into confidence/headline ONLY —
// it is never a scored Area (the full Capturer archetype is Phase 6).
//
// DESCRIPTIVE-FIRST (mirrors tempo-coach.js): every headline/signal/nudge is
// OBSERVATIONAL — it reports what the data shows, never an imperative or
// clinical instruction. No-data is an explicit empty-state, never a failing 0.

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
// Shared date/window/confidence helpers — reuse, not re-implementation.
import {
  dateKeyLocal,
  windowDateKeys,
  confidenceFromCoverage,
} from './physicals-synthesizer.mjs';

// The five Areas, in display order (also the order the hub renders cards).
export const AREA_KEYS = ['mood', 'mindfulness', 'bfrb', 'focus', 'stress'];

const AREA_LABELS = {
  mood: 'Mood',
  mindfulness: 'Mindfulness',
  bfrb: 'BFRB regulation',
  focus: 'Focus engagement',
  stress: 'Stress load',
};

/** chickensAreaLabel(key) — display label for an Area key. */
export function chickensAreaLabel(key) {
  return AREA_LABELS[key] || (typeof key === 'string'
    ? key.charAt(0).toUpperCase() + key.slice(1)
    : 'Area');
}

// Finite-number guard with a default (excludes NaN/Infinity/non-numbers).
function num(v, dflt) {
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

/**
 * isoWeekKey(ms) — the ISO-8601 week key ("YYYY-Www", local calendar) for a ms
 * timestamp. Keys the thin Tier-3 reflection file (Monday-ritual entries).
 */
export function isoWeekKey(ms) {
  const d = new Date(ms);
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNum = (t.getDay() + 6) % 7; // Mon=0 .. Sun=6
  t.setDate(t.getDate() - dayNum + 3); // the Thursday of this ISO week
  const isoYear = t.getFullYear();
  const jan4 = new Date(isoYear, 0, 4); // Jan 4 is always in ISO week 1
  const jan4DayNum = (jan4.getDay() + 6) % 7;
  const week1Thursday = new Date(isoYear, 0, 4 - jan4DayNum + 3);
  const week = 1 + Math.round((t - week1Thursday) / (7 * 86400000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

// sessionDateKey(s) — the local date key a history session lands on, parsed
// from its canonical ISO `date` field (the same bucketing analytics.js uses).
function sessionDateKey(s) {
  if (!s || typeof s.date !== 'string' || !s.date) return null;
  const ms = Date.parse(s.date);
  return Number.isFinite(ms) ? dateKeyLocal(ms) : null;
}

// ── Area sub-scores (each → integer 0..100, or null = no data) ───────────────

/**
 * moodScore(moodEvents, windowKeys, scoring) — mean valence over the window
 * mapped onto 0..100: (mean − 1) / 4 × 100. Mood events stamp `at` (epochMs —
 * NOT takenAt; ADR-0008). Fewer than minLogs valid logs in window → null
 * (a thin sample is "unread", never a failing score).
 *
 * @param {Array<{at?:number,valence?:number}>} moodEvents
 * @param {string[]} windowKeys — local date keys in scope
 */
export function moodScore(moodEvents, windowKeys, scoring = {}) {
  const minLogs = num(scoring.mood && scoring.mood.minLogs, 3);
  const inWindow = new Set(windowKeys || []);
  const valences = [];
  for (const e of (moodEvents || [])) {
    if (!e || typeof e.at !== 'number' || !Number.isFinite(e.at)) continue;
    // Number.isFinite also rejects NaN (NaN comparisons are all false, so the
    // range checks alone would admit it and poison the mean → composite).
    if (typeof e.valence !== 'number' || !Number.isFinite(e.valence)
        || e.valence < 1 || e.valence > 5) continue;
    if (!inWindow.has(dateKeyLocal(e.at))) continue;
    valences.push(e.valence);
  }
  if (valences.length < minLogs) return null;
  const mean = valences.reduce((a, b) => a + b, 0) / valences.length;
  return clamp(Math.round(((mean - 1) / 4) * 100), 0, 100);
}

/**
 * isMindfulSession(s) — BOTH detection paths for a mindful practice session:
 * tagged 'mindful' (the breathing-runner save) OR a timer session whose
 * programName starts with 'Meditation' (the meditation-preset save).
 */
export function isMindfulSession(s) {
  if (!s) return false;
  if (Array.isArray(s.tags) && s.tags.includes('mindful')) return true;
  return s.type === 'timer'
    && typeof s.programName === 'string'
    && s.programName.startsWith('Meditation');
}

/**
 * mindfulnessScore(history, windowKeys, scoring) — min(100, count / target ×
 * 100) where count is the in-window mindful sessions (both paths above).
 * History empty in window → null (an unread store, not a zero practice).
 */
export function mindfulnessScore(history, windowKeys, scoring = {}) {
  const target = num(scoring.mindfulness && scoring.mindfulness.targetSessions, 4);
  if (target <= 0) return null;
  const inWindow = new Set(windowKeys || []);
  const sessions = (history || []).filter((s) => {
    const dk = sessionDateKey(s);
    return dk != null && inWindow.has(dk);
  });
  if (sessions.length === 0) return null;
  const count = sessions.filter(isMindfulSession).length;
  return clamp(Math.round(Math.min(100, (count / target) * 100)), 0, 100);
}

/**
 * bfrbScore(bfrbEvents, windowKeys, scoring) — week-over-week trend ratio
 * r = last-7d catches / prior-7d catches, banded (≤0.7→90 · ≤1.15→70 ·
 * ≤1.6→50 · else→30). Fewer than quietThreshold catches across the window →
 * quietScore (a quiet stream is GOOD, not unread). A truly empty stream (no
 * valid events at all) → null. bfrb_events stamp `takenAt` (NOT `at`).
 * The trend split is a fixed 7-vs-7 day halving of the window tail.
 */
export function bfrbScore(bfrbEvents, windowKeys, scoring = {}) {
  const cfg = scoring.bfrb || {};
  const quietThreshold = num(cfg.quietThreshold, 5);
  const quietScore = num(cfg.quietScore, 85);
  const bands = Array.isArray(cfg.bands) ? cfg.bands : [0.7, 1.15, 1.6];
  const scores = Array.isArray(cfg.scores) ? cfg.scores : [90, 70, 50, 30];

  const valid = (bfrbEvents || []).filter(
    (e) => e && typeof e.takenAt === 'number' && Number.isFinite(e.takenAt),
  );
  if (valid.length === 0) return null;

  const keys = windowKeys || [];
  const lastSet = new Set(keys.slice(-7));
  const priorSet = new Set(keys.slice(-14, -7));
  let last = 0;
  let prior = 0;
  for (const e of valid) {
    const dk = dateKeyLocal(e.takenAt);
    if (lastSet.has(dk)) last += 1;
    else if (priorSet.has(dk)) prior += 1;
  }
  if (last + prior < quietThreshold) return Math.round(quietScore);
  // prior 0 with a non-quiet last week → ratio is unbounded → the else bracket.
  const r = prior > 0 ? last / prior : Infinity;
  for (let i = 0; i < bands.length; i++) {
    if (r <= bands[i]) return Math.round(num(scores[i], 0));
  }
  return Math.round(num(scores[bands.length], 0));
}

/**
 * focusScore(history, windowKeys, scoring) — min(100, flow+pomodoro minutes /
 * targetMinutes × 100) over the window. No overwork penalty in v1 (strain is
 * Physicals' job via recovery). History empty in window → null.
 */
export function focusScore(history, windowKeys, scoring = {}) {
  const targetMinutes = num(scoring.focus && scoring.focus.targetMinutes, 600);
  if (targetMinutes <= 0) return null;
  const inWindow = new Set(windowKeys || []);
  const sessions = (history || []).filter((s) => {
    const dk = sessionDateKey(s);
    return dk != null && inWindow.has(dk);
  });
  if (sessions.length === 0) return null;
  let minutes = 0;
  for (const s of sessions) {
    if (s.type !== 'flow' && s.type !== 'pomodoro') continue;
    if (typeof s.duration === 'number' && Number.isFinite(s.duration) && s.duration > 0) {
      minutes += s.duration / 60000;
    }
  }
  return clamp(Math.round(Math.min(100, (minutes / targetMinutes) * 100)), 0, 100);
}

/**
 * stressScore(physicalsRecord) — BORROWED signal: the null-tolerant mean of
 * the physicals RECORD's `recovery` + `sleep` Area scores (provenance
 * `synthesis/physicals`). Record absent / no areas / both Areas null → null.
 */
export function stressScore(physicalsRecord) {
  if (!physicalsRecord || !Array.isArray(physicalsRecord.areas)) return null;
  const vals = [];
  for (const key of ['recovery', 'sleep']) {
    const area = physicalsRecord.areas.find((a) => a && a.key === key);
    if (area && typeof area.score === 'number' && Number.isFinite(area.score)) {
      vals.push(area.score);
    }
  }
  if (vals.length === 0) return null;
  return clamp(Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), 0, 100);
}

// ── Thin Tier-3 reflection (confidence/headline ONLY — never a scored Area) ──

/**
 * reflectionForWeek(reflection, nowMs) — pick the applicable Monday-ritual
 * entry from {weekKey: {rating, note}}. Accepts the current ISO week, falling
 * back to the prior week (the ritual may key the entry by the week it reviews
 * rather than the week it's written in). Invalid ratings are ignored.
 */
export function reflectionForWeek(reflection, nowMs) {
  if (!reflection || typeof reflection !== 'object') return null;
  for (const key of [isoWeekKey(nowMs), isoWeekKey(nowMs - 7 * 86400000)]) {
    const entry = reflection[key];
    if (entry && typeof entry.rating === 'number'
      && entry.rating >= 1 && entry.rating <= 5) {
      return {
        weekKey: key,
        rating: entry.rating,
        note: typeof entry.note === 'string' ? entry.note : '',
      };
    }
  }
  return null;
}

// One-step confidence corroboration: a human-validated weekly rating raises
// low→medium and medium→high (high stays high).
function bumpConfidence(confidence) {
  if (confidence === 'low') return 'medium';
  if (confidence === 'medium') return 'high';
  return confidence;
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
  if (composite == null) return 'Not enough data to read Chickens yet.';
  const read = HEADLINE_READ[band] || HEADLINE_READ.unknown;
  const scored = areas.filter((a) => a.score != null).slice().sort((a, b) => a.score - b.score);
  const weakest = scored[0];
  let h;
  if (weakest && weakest.score < 60) {
    h = `${weakest.label} is dragging — Chickens ${read} overall.`;
  } else {
    h = `Chickens ${read} — mood, regulation and focus holding.`;
  }
  return h.length > 140 ? `${h.slice(0, 139)}…` : h;
}

const AREA_NUDGE = {
  mood: 'Mood has averaged on the low side this week.',
  mindfulness: 'Mindful sessions have been sparse this week.',
  bfrb: 'BFRB catches have trended up this week.',
  focus: 'Focus minutes have run light this week.',
  stress: 'Recovery and sleep have run low — stress load is reading high.',
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
 * buildChickensRecord({...}) — roll the five Areas up into a single VALID
 * `chickens` synthesis record, with the additive `areas[]` (hub) + `balance{}`
 * (bubble-map lenses) fields. Stamps node/window/contractVersion/producedAt via
 * buildSynthesisRecord, then validates and THROWS on any contract violation.
 *
 * @param {object} args
 * @param {Array} args.moodEvents           — users/{uid}/mood_events docs (stamp `at`)
 * @param {Array} args.bfrbEvents           — users/{uid}/bfrb_events docs (stamp `takenAt`)
 * @param {Array} args.history              — users/{uid}/history docs
 * @param {Array} args.restLog              — users/{uid}/rest_log docs (reserved; stress reads the physicals RECORD)
 * @param {object|null} args.physicalsRecord — the synthesis/physicals RECORD (borrowed Stress Load)
 * @param {object|null} args.reflection     — {weekKey: {rating, note}} (thin Tier-3; confidence/headline only)
 * @param {object} args.scoring             — chickens.json contents
 * @param {object} args.balanceConfig       — balance.json['chickens'] ({importance,target})
 * @param {"daily"|"weekly"} args.mode
 * @param {string} args.producer
 * @param {number} [args.nowMs=Date.now()]
 * @param {string} [args.window]
 * @returns {object} a VALID chickens synthesis record
 * @throws {Error} when the produced record fails validateSynthesisRecord
 */
export function buildChickensRecord({
  moodEvents = [],
  bfrbEvents = [],
  history = [],
  restLog = [], // eslint-disable-line no-unused-vars — reserved (stress borrows the physicals record, not raw rest_log)
  physicalsRecord = null,
  reflection = null,
  scoring = {},
  balanceConfig = {},
  mode = 'weekly',
  producer = 'council/chickens',
  nowMs = Date.now(),
  window: explicitWindow,
} = {}) {
  const windowKeys = windowDateKeys(nowMs, scoring.windowDays);

  const subscores = {
    mood: moodScore(moodEvents, windowKeys, scoring),
    mindfulness: mindfulnessScore(history, windowKeys, scoring),
    bfrb: bfrbScore(bfrbEvents, windowKeys, scoring),
    focus: focusScore(history, windowKeys, scoring),
    stress: stressScore(physicalsRecord),
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
    return { key, label: chickensAreaLabel(key), score, band: b, signal: areaSignal(b) };
  });

  // The cross-runtime balance stamp (importance/target from balance.json).
  const importance = num(balanceConfig.importance, DEFAULT_IMPORTANCE);
  const target = num(balanceConfig.target, DEFAULT_TARGET);
  const neglectValue = neglect({ score: composite, target, priorNeglect: 0 });
  const priorityValue = priority(importance, neglectValue);

  // coverage = fraction of the 5 Areas that actually fed the composite (present
  // AND weighted). Note: the reflection corroboration below can raise the
  // coverage-derived confidence one step, so a partial score CAN read one
  // band higher than coverage alone would give it — by design (human
  // validation is corroborating signal).
  const cov = AREA_KEYS.length ? counted.length / AREA_KEYS.length : 0;
  let confidence = confidenceFromCoverage(cov);

  let headline = buildHeadline(areas, band, composite);

  // Thin Tier-3 reflection: a human-validated weekly rating corroborates the
  // read — folds into confidence (one-step bump) + headline (observational
  // mention, only when it fits the 140-char contract). NEVER a scored Area.
  const reflectionEntry = reflectionForWeek(reflection, nowMs);
  if (reflectionEntry) {
    confidence = bumpConfidence(confidence);
    const suffix = ` Weekly reflection ${reflectionEntry.rating}/5.`;
    if (headline.length + suffix.length <= 140) headline += suffix;
  }

  const signals = areas.map(
    (a) => `${a.label} ${a.band}${a.score == null ? '' : ` (${a.score})`}`,
  );
  const nudges = mode === 'weekly' ? buildNudges(areas) : [];

  const sources = [];
  if (subscores.mood != null) sources.push('mood_events');
  if (subscores.mindfulness != null || subscores.focus != null) sources.push('history');
  if (subscores.bfrb != null) sources.push('bfrb_events');
  if (subscores.stress != null) sources.push('synthesis/physicals');
  if (reflectionEntry) sources.push('reflection');
  if (sources.length === 0) sources.push('none');

  const window = explicitWindow
    || (windowKeys.length
      ? `${windowKeys[0]}..${windowKeys[windowKeys.length - 1]}`
      : dateKeyLocal(nowMs));

  const record = buildSynthesisRecord({
    node: 'chickens',
    producer,
    window,
    state: { band, score: composite },
    headline,
    signals,
    nudges,
    provenance: { sources, coverage: cov },
    confidence,
    // ADDITIVE, contract-safe (additionalProperties: true):
    areas, // the hub renders these 5 cards
    balance: { importance, neglect: neglectValue, priority: priorityValue }, // bubble-map lenses
  });

  const { valid, errors } = validateSynthesisRecord(record);
  if (!valid) {
    throw new Error(
      `chickens synthesis record failed contract validation: ${errors.join('; ')}`,
    );
  }
  return record;
}
