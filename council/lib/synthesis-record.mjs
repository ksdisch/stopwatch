// Synthesis-record envelope: build + validate the FROZEN synthesis-record
// contract (Firestore path users/{uid}/synthesis/{nodeId}).
//
// Pure ESM, no I/O — this module never reads env, the filesystem, or the
// network. The council runtime (synthesize.mjs) is the only place that does
// Firestore writes; everything here is testable in isolation under node --test.
//
// FROZEN CONTRACT (do NOT rename fields or change enums — additive-only):
//   { contractVersion, node, producer, producedAt, window,
//     state: { band, score }, headline, signals[], nudges[],
//     provenance: { sources[], coverage }, confidence }
//   BAND       = "thriving" | "steady" | "strained" | "depleted" | "unknown"
//   confidence = "high" | "medium" | "low"

export const CONTRACT_VERSION = 1;

export const BANDS = ['thriving', 'steady', 'strained', 'depleted', 'unknown'];
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];

const MAX_SIGNALS = 5;
const MAX_HEADLINE_CHARS = 140;

// Required top-level fields (nudges is optional → defaults to []).
const REQUIRED_FIELDS = [
  'contractVersion',
  'node',
  'producer',
  'producedAt',
  'window',
  'state',
  'headline',
  'signals',
  'provenance',
  'confidence',
];

// True only for a finite integer (excludes NaN, Infinity, floats, non-numbers).
function isInteger(value) {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * buildSynthesisRecord(partial) — fill the envelope.
 *
 * Stamps the producer-independent fields the council owns:
 *   - contractVersion: CONTRACT_VERSION (1)
 *   - producedAt: the current UTC time as an ISO-8601 string
 *   - nudges: defaults to [] when the caller omits it
 *
 * Caller-supplied fields (node, producer, window, state, headline, signals,
 * provenance, confidence, and an explicit nudges) override the defaults. Does
 * NOT validate — call validateSynthesisRecord on the result before writing.
 *
 * @param {object} partial
 * @returns {object} the merged synthesis record
 */
export function buildSynthesisRecord(partial = {}) {
  return {
    nudges: [],
    ...partial,
    contractVersion: CONTRACT_VERSION,
    producedAt: new Date().toISOString(),
  };
}

/**
 * validateSynthesisRecord(rec) — enforce the FROZEN contract.
 *
 * Returns { valid:boolean, errors:string[] }. Collects every violation rather
 * than failing on the first, so the council log shows all problems at once.
 *
 * @param {object} rec
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSynthesisRecord(rec) {
  const errors = [];

  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
    return { valid: false, errors: ['record must be a non-null object'] };
  }

  // Required fields present.
  for (const field of REQUIRED_FIELDS) {
    if (!(field in rec)) {
      errors.push(`missing required field: ${field}`);
    }
  }

  // contractVersion — integer.
  if ('contractVersion' in rec && !isInteger(rec.contractVersion)) {
    errors.push('contractVersion must be an integer');
  }

  // node / producer / window — non-empty strings.
  for (const field of ['node', 'producer', 'window']) {
    if (field in rec && typeof rec[field] !== 'string') {
      errors.push(`${field} must be a string`);
    }
  }

  // headline — string, <= 140 chars.
  if ('headline' in rec) {
    if (typeof rec.headline !== 'string') {
      errors.push('headline must be a string');
    } else if (rec.headline.length > MAX_HEADLINE_CHARS) {
      errors.push(`headline must be <= ${MAX_HEADLINE_CHARS} chars`);
    }
  }

  // confidence — enum.
  if ('confidence' in rec && !CONFIDENCE_LEVELS.includes(rec.confidence)) {
    errors.push(`confidence must be one of: ${CONFIDENCE_LEVELS.join(', ')}`);
  }

  // state — { band: enum, score: null | integer 0..100 }.
  if ('state' in rec) {
    const state = rec.state;
    if (state === null || typeof state !== 'object' || Array.isArray(state)) {
      errors.push('state must be an object');
    } else {
      if (!BANDS.includes(state.band)) {
        errors.push(`state.band must be one of: ${BANDS.join(', ')}`);
      }
      if (state.score !== null) {
        if (!isInteger(state.score)) {
          errors.push('state.score must be null or an integer');
        } else if (state.score < 0 || state.score > 100) {
          errors.push('state.score must be between 0 and 100');
        }
      }
    }
  }

  // signals — array, length <= 5.
  if ('signals' in rec) {
    if (!Array.isArray(rec.signals)) {
      errors.push('signals must be an array');
    } else if (rec.signals.length > MAX_SIGNALS) {
      errors.push(`signals must have at most ${MAX_SIGNALS} items`);
    }
  }

  // nudges — optional; if present, an array of { text, priority:int >= 1 }.
  if ('nudges' in rec && rec.nudges !== undefined) {
    if (!Array.isArray(rec.nudges)) {
      errors.push('nudges must be an array');
    } else {
      rec.nudges.forEach((nudge, i) => {
        if (nudge === null || typeof nudge !== 'object' || Array.isArray(nudge)) {
          errors.push(`nudges[${i}] must be an object`);
          return;
        }
        if (typeof nudge.text !== 'string') {
          errors.push(`nudges[${i}].text must be a string`);
        }
        if (!isInteger(nudge.priority) || nudge.priority < 1) {
          errors.push(`nudges[${i}].priority must be an integer >= 1`);
        }
      });
    }
  }

  // provenance — { sources: array, coverage: number 0..1 }.
  if ('provenance' in rec) {
    const prov = rec.provenance;
    if (prov === null || typeof prov !== 'object' || Array.isArray(prov)) {
      errors.push('provenance must be an object');
    } else {
      if (!Array.isArray(prov.sources)) {
        errors.push('provenance.sources must be an array');
      }
      if (typeof prov.coverage !== 'number' || prov.coverage < 0 || prov.coverage > 1) {
        errors.push('provenance.coverage must be a number between 0 and 1');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
