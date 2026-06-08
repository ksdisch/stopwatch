// Home synthesizer — ADR-0005 (synthesis-record roll-up + token discipline).
//
// Pure ESM, no I/O: this module never reads env, the filesystem, or the
// network. It rolls the FIVE domain-pillar synthesis records up into the single
// `home` Balance record. The council runtime (synthesize.mjs) reads the pillar
// docs from Firestore and the launchd job schedules it; everything here is
// testable in isolation under node --test.
//
// The roll-up rule (synthesis-record.md): the home reads its children's
// RECORDS, never their raw data. Balance math lives in balance.mjs; the record
// envelope (build + validate the FROZEN contract) lives in synthesis-record.mjs.
// This module is the glue: rank → score → headline/signals/nudges → validate.

import {
  rankPillars,
  balanceScore,
  bandForScore,
  coverage,
} from './balance.mjs';
import {
  buildSynthesisRecord,
  validateSynthesisRecord,
} from './synthesis-record.mjs';

// Human labels for the dotted pillar node paths (life_building → "Life
// Building"). Anything not in the map is title-cased from its node path.
const PILLAR_LABELS = {
  home: 'Home',
  life_building: 'Life Building',
  physicals: 'Physicals',
  chickens: 'Chickens',
  relationships: 'Relationships',
  growth: 'Growth',
};

/**
 * pillarLabel(node) — a title-cased display label for a pillar node path.
 * Falls back to splitting on `_`/`/` and capitalizing each word.
 *
 * @param {string} node
 * @returns {string}
 */
export function pillarLabel(node) {
  if (PILLAR_LABELS[node]) return PILLAR_LABELS[node];
  const raw = typeof node === 'string' ? node : String(node ?? '');
  return raw
    .split(/[_/]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// How many top-priority pillars to surface in `signals` (contract caps at 5).
const MAX_SIGNALS = 5;
// How many cross-pillar moves a weekly home record carries.
const MAX_NUDGES = 3;

/**
 * confidenceFromCoverage(cov) — the contract confidence enum from coverage.
 *   >= 0.8 → "high" · >= 0.5 → "medium" · else "low".
 *
 * @param {number} cov 0..1
 * @returns {"high"|"medium"|"low"}
 */
export function confidenceFromCoverage(cov) {
  if (cov >= 0.8) return 'high';
  if (cov >= 0.5) return 'medium';
  return 'low';
}

// Map a balance band to a short read fragment used in the home headline.
const BAND_READ = {
  thriving: 'overall thriving this week',
  steady: 'overall steady this week',
  strained: 'overall running strained this week',
  depleted: 'overall depleted this week',
  unknown: 'not enough data to read the week',
};

/**
 * buildHeadline(topPillar, band) — <=140 char one-liner naming the single
 * top-priority pillar + the balance band read. Falls back to a band-only
 * headline when there is no top pillar (e.g. no records).
 *
 * @param {object|null} topPillar — a ranked entry, or null
 * @param {string} band — the home balance band
 * @returns {string}
 */
function buildHeadline(topPillar, band) {
  const read = BAND_READ[band] || BAND_READ.unknown;
  if (!topPillar) {
    const h = `Balance — ${read}.`;
    return h.length > 140 ? h.slice(0, 140) : h;
  }
  const label = pillarLabel(topPillar.node);
  // Only frame a pillar as "needs tending" when it actually carries neglect;
  // an all-at-target week shouldn't manufacture a concern.
  const lead =
    topPillar.priority > 0
      ? `${label} needs tending`
      : `${label} is holding`;
  const h = `${lead} — ${read}.`;
  return h.length > 140 ? `${h.slice(0, 139)}…` : h;
}

/**
 * buildSignals(ranked) — up to MAX_SIGNALS top-priority pillars rendered as
 * "<Pillar> <band> (<score>)". A null-score pillar renders its score as "—".
 *
 * @param {Array<{node,band,score}>} ranked
 * @returns {string[]}
 */
function buildSignals(ranked) {
  return ranked.slice(0, MAX_SIGNALS).map((p) => {
    const label = pillarLabel(p.node);
    const score = p.score == null ? '—' : p.score;
    return `${label} ${p.band} (${score})`;
  });
}

/**
 * buildNudges(ranked, pillarByNode) — for a weekly home record, 1..3
 * cross-pillar moves drawn from the top-priority pillars. For each of the top
 * pillars (that actually carry neglect), prefer that pillar's OWN top nudge
 * from its record; otherwise synthesize a "Tend <Pillar> — running below
 * target" move. Re-priorities the moves 1..N (1 = highest).
 *
 * @param {Array<{node,priority}>} ranked
 * @param {Map<string, object>} pillarByNode
 * @returns {Array<{text:string, priority:number}>}
 */
function buildNudges(ranked, pillarByNode) {
  const candidates = ranked.filter((p) => p.priority > 0).slice(0, MAX_NUDGES);
  return candidates.map((p, i) => {
    const rec = pillarByNode.get(p.node);
    const ownNudges =
      rec && Array.isArray(rec.nudges) ? rec.nudges : [];
    let text;
    if (ownNudges.length > 0) {
      // Use the pillar's own highest-priority nudge text (lowest priority int).
      const best = ownNudges
        .slice()
        .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))[0];
      text = best && typeof best.text === 'string' && best.text.length > 0
        ? best.text
        : `Tend ${pillarLabel(p.node)} — running below target`;
    } else {
      text = `Tend ${pillarLabel(p.node)} — running below target`;
    }
    return { text, priority: i + 1 };
  });
}

/**
 * buildHomeRecord({ pillarRecords, config, mode, producer }) — roll the five
 * pillar records up into a single VALID `home` synthesis record.
 *
 * - state.score = balanceScore(ranked); state.band = bandForScore(score).
 * - headline (<=140): names the top-priority pillar + the balance read.
 * - signals (<=5): top pillars as "<Pillar> <band> (<score>)".
 * - nudges: mode "weekly" → top 1..3 cross-pillar moves; mode "daily" → [].
 * - provenance.sources = "synthesis/<node>" per input record; coverage from the
 *   ranked set; confidence derived from coverage.
 *
 * Stamps node:"home" + window via buildSynthesisRecord (which also stamps
 * contractVersion + producedAt), then validates and THROWS on any contract
 * violation — never returns an invalid record.
 *
 * @param {object} args
 * @param {Array<object>} args.pillarRecords — the 5 (or fewer) pillar records
 * @param {object} args.config — balance.json contents
 * @param {"daily"|"weekly"} args.mode
 * @param {string} args.producer — the council job string
 * @param {string} [args.window] — defaults to a range over the records' windows
 * @returns {object} a VALID home synthesis record
 * @throws {Error} when the produced record fails validateSynthesisRecord
 */
export function buildHomeRecord({
  pillarRecords = [],
  config = {},
  mode = 'weekly',
  producer = 'council/home',
  window: explicitWindow,
} = {}) {
  // Drop malformed child records (missing/blank `node`) before ranking + Map
  // construction — the synthesizer is the trust boundary for child records, and
  // a node-less doc would key the Map under `undefined` (collide) or mislabel
  // the roll-up. validateSynthesisRecord catches it downstream, but filter here
  // so one garbage child can't skew the headline/signals.
  const validRecords = (Array.isArray(pillarRecords) ? pillarRecords : [])
    .filter((r) => r && typeof r.node === 'string' && r.node.length > 0);
  const ranked = rankPillars(validRecords, config);
  const score = balanceScore(ranked);
  const band = bandForScore(score);
  const cov = coverage(ranked);

  const topPillar = ranked.length > 0 ? ranked[0] : null;
  const pillarByNode = new Map(validRecords.map((r) => [r.node, r]));

  const headline = buildHeadline(topPillar, band);
  const signals = buildSignals(ranked);
  const nudges =
    mode === 'weekly' ? buildNudges(ranked, pillarByNode) : [];

  const sources = validRecords.map((r) => `synthesis/${r.node}`);
  const confidence = confidenceFromCoverage(cov);

  // Derive a window spanning the input records when not given explicitly.
  const window = explicitWindow || deriveWindow(pillarRecords);

  const record = buildSynthesisRecord({
    node: 'home',
    producer,
    window,
    state: { band, score },
    headline,
    signals,
    nudges,
    provenance: { sources, coverage: cov },
    confidence,
  });

  const { valid, errors } = validateSynthesisRecord(record);
  if (!valid) {
    throw new Error(
      `home synthesis record failed contract validation: ${errors.join('; ')}`,
    );
  }
  return record;
}

/**
 * deriveWindow(pillarRecords) — a window string spanning the child records'
 * windows. Uses the min..max of the ISO date prefixes the children carry;
 * collapses to a single date when they all share one, and falls back to today
 * (UTC) when there are no records.
 *
 * @param {Array<{window?:string}>} pillarRecords
 * @returns {string}
 */
export function deriveWindow(pillarRecords = []) {
  const dates = [];
  for (const r of pillarRecords) {
    if (r && typeof r.window === 'string' && r.window.length > 0) {
      // Pull the ISO-date prefix from either a single date or a "a..b" range.
      for (const part of r.window.split('..')) {
        const d = part.slice(0, 10);
        if (d) dates.push(d);
      }
    }
  }
  if (dates.length === 0) {
    return new Date().toISOString().slice(0, 10);
  }
  dates.sort();
  const lo = dates[0];
  const hi = dates[dates.length - 1];
  return lo === hi ? lo : `${lo}..${hi}`;
}
