// Balance engine — ADR-0004 (Priority = Importance × Neglect).
//
// Pure ESM, no I/O: this module never reads env, the filesystem, or the
// network. It is the math the home synthesizer (home-synthesizer.mjs) uses to
// weigh the five domain-pillars against each other. Forward-compatible with
// Phase-2+ history (which will feed a real `priorNeglect`); Phase 1 runs the
// snapshot form (priorNeglect = 0).
//
// The score currency is each pillar's synthesis-record `state.score`
// (0..100, computed relative to that pillar's own target/baseline — see
// docs/lifeos/decisions/0004-balance-importance-x-neglect.md). A `null` score
// means "no data / unknown".

// Defaults for a pillar absent from balance.json — a neutral middle importance
// and a moderate target, so an unconfigured pillar still ranks sensibly.
export const DEFAULT_IMPORTANCE = 3;
export const DEFAULT_TARGET = 70;

/**
 * clamp(n, lo, hi) — constrain n to the inclusive [lo, hi] range.
 * @param {number} n
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
export function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/**
 * shortfall(score, target) — how far below target the score runs, normalized
 * to 0..1. 0 means at/above target (or unmeasurable); 1 means score 0 vs a
 * positive target.
 *
 *   target > 0 && score != null ? clamp((target - score) / target, 0, 1) : 0
 *
 * @param {number|null} score
 * @param {number} target
 * @returns {number} 0..1
 */
export function shortfall(score, target) {
  if (target > 0 && score != null) {
    return clamp((target - score) / target, 0, 1);
  }
  return 0;
}

/**
 * neglect({ score, target, priorNeglect, decay }) — time-decayed accumulation
 * of how far the pillar has run below target, normalized to 0..1.
 *
 *   clamp(decay * priorNeglect + shortfall(score, target), 0, 1)
 *
 * A `null` score contributes no new shortfall, so neglect just decays:
 *   score == null → clamp(decay * priorNeglect, 0, 1)
 *
 * Phase 1 passes priorNeglect = 0 (the snapshot form): neglect == shortfall.
 *
 * @param {object} args
 * @param {number|null} args.score
 * @param {number} args.target
 * @param {number} [args.priorNeglect=0]
 * @param {number} [args.decay=0.5]
 * @returns {number} 0..1
 */
export function neglect({ score, target, priorNeglect = 0, decay = 0.5 }) {
  return clamp(decay * priorNeglect + shortfall(score, target), 0, 1);
}

/**
 * priority(importance, neglect) — Importance × Neglect (range 0..5 when
 * importance is 1..5 and neglect is 0..1). The single number the home ranks by.
 *
 * @param {number} importance
 * @param {number} neglectValue
 * @returns {number}
 */
export function priority(importance, neglectValue) {
  return importance * neglectValue;
}

/**
 * bandForScore(score) — bucket a 0..100 score into the contract band enum.
 *   null    → "unknown"
 *   80..100 → "thriving"
 *   60..79  → "steady"
 *   40..59  → "strained"
 *   0..39   → "depleted"
 *
 * @param {number|null} score
 * @returns {string} a synthesis-record band
 */
export function bandForScore(score) {
  if (score == null) return 'unknown';
  if (score >= 80) return 'thriving';
  if (score >= 60) return 'steady';
  if (score >= 40) return 'strained';
  return 'depleted';
}

/**
 * rankPillars(records, config) — for each pillar record, resolve its
 * importance/target from config (defaulting when absent), compute neglect +
 * priority (Phase-1 snapshot form: priorNeglect = 0), and sort.
 *
 * Sort order: priority DESC, then (stable tiebreak) lower score first
 * (null scores sort last among ties), then node name ASC.
 *
 * @param {Array<{node:string,state:{band:string,score:number|null}}>} records
 * @param {object} config — { [node]: { importance, target } }
 * @returns {Array<{node,score,band,importance,neglect,priority}>}
 */
export function rankPillars(records, config = {}) {
  const ranked = (records || []).map((rec) => {
    const node = rec.node;
    const cfg = (config && config[node]) || {};
    const importance =
      typeof cfg.importance === 'number' ? cfg.importance : DEFAULT_IMPORTANCE;
    const target = typeof cfg.target === 'number' ? cfg.target : DEFAULT_TARGET;
    const score =
      rec.state && rec.state.score != null ? rec.state.score : null;
    const n = neglect({ score, target, priorNeglect: 0 });
    return {
      node,
      score,
      band: bandForScore(score),
      importance,
      neglect: n,
      priority: priority(importance, n),
    };
  });

  ranked.sort((a, b) => {
    // Primary: priority DESC.
    if (b.priority !== a.priority) return b.priority - a.priority;
    // Tiebreak 1: lower score first; a null score sorts after any number.
    const as = a.score == null ? Infinity : a.score;
    const bs = b.score == null ? Infinity : b.score;
    if (as !== bs) return as - bs;
    // Tiebreak 2: node name ASC.
    return a.node < b.node ? -1 : a.node > b.node ? 1 : 0;
  });

  return ranked;
}

/**
 * balanceScore(ranked) — the importance-weighted mean of the non-null pillar
 * scores, rounded to an integer 0..100. Pillars with a null score are omitted
 * from the mean. If every pillar is null, returns null.
 *
 * NOTE: a pillar with importance 0 contributes zero weight and is therefore
 * silently omitted from the mean even when it has real data. ADR-0004 implies
 * importance ∈ 1..5 — do NOT set 0 to "mute" a pillar (that erases it from
 * Balance rather than down-weighting it); lower the weight to 1 instead.
 *
 * @param {Array<{score:number|null,importance:number}>} ranked
 * @returns {number|null}
 */
export function balanceScore(ranked) {
  let weightedSum = 0;
  let weightTotal = 0;
  for (const p of ranked || []) {
    if (p.score == null) continue;
    weightedSum += p.score * p.importance;
    weightTotal += p.importance;
  }
  if (weightTotal === 0) return null;
  return clamp(Math.round(weightedSum / weightTotal), 0, 100);
}

/**
 * coverage(ranked) — fraction of pillars that carry a non-null score (0..1).
 * Empty input → 0.
 *
 * @param {Array<{score:number|null}>} ranked
 * @returns {number} 0..1
 */
export function coverage(ranked) {
  const list = ranked || [];
  if (list.length === 0) return 0;
  const scored = list.filter((p) => p.score != null).length;
  return scored / list.length;
}
