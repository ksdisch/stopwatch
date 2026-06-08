// node --test suite for the Physicals synthesizer (Phase 2).
// Run: cd council && node --test lib/physicals-synthesizer.test.mjs   (or: npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPhysicalsRecord,
  recoveryScore,
  trainingScore,
  sleepScore,
  medsScore,
  windowDateKeys,
  dateKeyLocal,
  confidenceFromCoverage,
  physicalsAreaLabel,
  AREA_KEYS,
} from './physicals-synthesizer.mjs';
import { validateSynthesisRecord } from './synthesis-record.mjs';

// Mirror config/physicals.json so assertions use the shipped defaults.
const SCORING = {
  windowDays: 14,
  weights: { recovery: 0.40, sleep: 0.25, meds: 0.20, training: 0.15 },
  recovery: { signalScores: { well_recovered: 90, neutral: 65, strained: 35 } },
  training: {
    optimalLow: 0.8, optimalHigh: 1.3, elevatedHigh: 1.5,
    scores: { optimal: 90, elevated: 65, high: 35, low: 70 },
  },
  sleep: { targetHours: 7.5, hoursWeight: 0.6, qualityWeight: 0.4 },
  meds: { expected: { 'once-daily': 1, 'twice-daily': 2 } },
};
const BALANCE_CFG = { importance: 5, target: 75 };

const NOW = Date.parse('2026-06-08T18:00:00Z');
const KEYS = windowDateKeys(NOW, 14);
const msAtLocalNoon = (key) => new Date(`${key}T12:00:00`).getTime();

// ── label + date helpers ─────────────────────────────────────────────────────
test('physicalsAreaLabel maps known keys + falls back', () => {
  assert.equal(physicalsAreaLabel('recovery'), 'Recovery');
  assert.equal(physicalsAreaLabel('training'), 'Training load');
  assert.equal(physicalsAreaLabel('foo'), 'Foo');
});

test('windowDateKeys returns N oldest-first local date keys ending today', () => {
  assert.equal(KEYS.length, 14);
  assert.equal(KEYS[KEYS.length - 1], dateKeyLocal(NOW));
  // sorted ascending, unique
  const sorted = KEYS.slice().sort();
  assert.deepEqual(KEYS, sorted);
  assert.equal(new Set(KEYS).size, 14);
});

test('confidenceFromCoverage thresholds', () => {
  assert.equal(confidenceFromCoverage(1), 'high');
  assert.equal(confidenceFromCoverage(0.8), 'high');
  assert.equal(confidenceFromCoverage(0.5), 'medium');
  assert.equal(confidenceFromCoverage(0.25), 'low');
  assert.equal(confidenceFromCoverage(0), 'low');
});

// ── recoveryScore ─────────────────────────────────────────────────────────────
test('recoveryScore maps the categorical band; unknown/missing → null', () => {
  assert.equal(recoveryScore({ recovery_signal: 'well_recovered' }, SCORING), 90);
  assert.equal(recoveryScore({ recovery_signal: 'neutral' }, SCORING), 65);
  assert.equal(recoveryScore({ recovery_signal: 'strained' }, SCORING), 35);
  assert.equal(recoveryScore({ recovery_signal: 'insufficient_data' }, SCORING), null);
  assert.equal(recoveryScore({ recovery_signal: 'garbage' }, SCORING), null);
  assert.equal(recoveryScore(null, SCORING), null);
  assert.equal(recoveryScore({}, SCORING), null);
});

// ── trainingScore ─────────────────────────────────────────────────────────────
test('trainingScore bands ACWR; latest precedence, history fallback, absent → null', () => {
  assert.equal(trainingScore({ acwr: 1.0 }, null, SCORING), 90); // optimal
  assert.equal(trainingScore({ acwr: 0.8 }, null, SCORING), 90); // inclusive low edge
  assert.equal(trainingScore({ acwr: 1.3 }, null, SCORING), 90); // inclusive high edge
  assert.equal(trainingScore({ acwr: 1.4 }, null, SCORING), 65); // elevated
  assert.equal(trainingScore({ acwr: 1.5 }, null, SCORING), 65); // inclusive elevated edge
  assert.equal(trainingScore({ acwr: 1.8 }, null, SCORING), 35); // high
  assert.equal(trainingScore({ acwr: 0.5 }, null, SCORING), 70); // detraining
  // latest has no acwr → fall back to most recent history row with acwr
  assert.equal(trainingScore({}, { rows: [{ acwr: 0.6 }, { acwr: 1.0 }] }, SCORING), 90);
  // none anywhere → null
  assert.equal(trainingScore({}, { rows: [{}] }, SCORING), null);
  assert.equal(trainingScore(null, null, SCORING), null);
});

test('trainingScore history fallback picks the MAX .day row regardless of array order', () => {
  // newest day (06-08, acwr 1.0 → optimal 90) wins, whatever the array order
  const oldestFirst = { rows: [{ day: '2026-06-01', acwr: 1.8 }, { day: '2026-06-08', acwr: 1.0 }] };
  const newestFirst = { rows: [{ day: '2026-06-08', acwr: 1.0 }, { day: '2026-06-01', acwr: 1.8 }] };
  assert.equal(trainingScore({}, oldestFirst, SCORING), 90);
  assert.equal(trainingScore({}, newestFirst, SCORING), 90); // order-independent
  // undated rows keep the last-positional convention (no .day to compare)
  assert.equal(trainingScore({}, { rows: [{ acwr: 1.8 }, { acwr: 0.5 }] }, SCORING), 70); // last → 0.5 → low
});

// ── sleepScore ────────────────────────────────────────────────────────────────
test('sleepScore blends hours+quality, hours-only fallback, no nights → null', () => {
  const day = KEYS[KEYS.length - 1];
  // 7.5h + quality 5 → 1.0 → 100
  assert.equal(sleepScore([{ id: day, sleep: { hours: 7.5, quality: 5 } }], KEYS, SCORING), 100);
  // hours-only: 7.5/7.5 = 1.0 → 100
  assert.equal(sleepScore([{ id: day, sleep: { hours: 7.5 } }], KEYS, SCORING), 100);
  // hours 3.75 (half) + quality 5: (0.6*0.5 + 0.4*1) = 0.7 → 70
  assert.equal(sleepScore([{ id: day, sleep: { hours: 3.75, quality: 5 } }], KEYS, SCORING), 70);
  // out-of-window day excluded → null
  assert.equal(sleepScore([{ id: '2000-01-01', sleep: { hours: 8 } }], KEYS, SCORING), null);
  // no rest log → null (not 0)
  assert.equal(sleepScore([], KEYS, SCORING), null);
  // malformed sleep ignored → null
  assert.equal(sleepScore([{ id: day, sleep: {} }], KEYS, SCORING), null);
});

// ── medsScore ─────────────────────────────────────────────────────────────────
test('medsScore mirrors analytics adherence; excludes as-needed; per-day cap; no scheduled → null', () => {
  const dosedEveryDay = (freq, perDay) => ({
    frequency: freq,
    doseLog: KEYS.flatMap((k) =>
      Array.from({ length: perDay }, () => ({ takenAt: msAtLocalNoon(k), deviceId: 'd' }))),
  });
  // once-daily, dosed every day → 100
  assert.equal(medsScore([dosedEveryDay('once-daily', 1)], KEYS, SCORING), 100);
  // twice-daily, dosed twice every day → 100
  assert.equal(medsScore([dosedEveryDay('twice-daily', 2)], KEYS, SCORING), 100);
  // per-day cap: once-daily dosed 3x/day is still 1.0/day → 100
  assert.equal(medsScore([dosedEveryDay('once-daily', 3)], KEYS, SCORING), 100);
  // twice-daily dosed once/day → 0.5/day → 50
  assert.equal(medsScore([dosedEveryDay('twice-daily', 1)], KEYS, SCORING), 50);
  // as-needed excluded entirely → null when it's the only med
  assert.equal(medsScore([{ frequency: 'as-needed', doseLog: [] }], KEYS, SCORING), null);
  // no meds → null
  assert.equal(medsScore([], KEYS, SCORING), null);
  // doses outside window don't count → 0
  assert.equal(
    medsScore([{ frequency: 'once-daily', doseLog: [{ takenAt: Date.parse('2000-01-01') }] }], KEYS, SCORING),
    0,
  );
});

// ── buildPhysicalsRecord (the gate substance) ────────────────────────────────
function fullInputs() {
  return {
    recoveryLatest: { recovery_signal: 'well_recovered', acwr: 1.0 },
    recoveryHistory: { rows: [{ day: '2026-06-07', acwr: 1.0 }] },
    meds: [{
      frequency: 'once-daily',
      doseLog: KEYS.map((k) => ({ takenAt: msAtLocalNoon(k), deviceId: 'd' })),
    }],
    restLog: KEYS.map((k) => ({ id: k, sleep: { hours: 7.5, quality: 5 } })),
    history: [],
    scoring: SCORING,
    balanceConfig: BALANCE_CFG,
    mode: 'weekly',
    producer: 'council/physicals',
    nowMs: NOW,
  };
}

test('buildPhysicalsRecord composites via the Balance engine weighted mean', () => {
  const rec = buildPhysicalsRecord(fullInputs());
  // recovery 90*.40 + sleep 100*.25 + meds 100*.20 + training 90*.15 = 94.5 → 95 (half-up)
  assert.equal(rec.state.score, 95);
  assert.equal(rec.state.band, 'thriving');
  assert.equal(rec.node, 'physicals');
  assert.equal(rec.contractVersion, 1);
});

test('buildPhysicalsRecord produces a contract-VALID record', () => {
  const rec = buildPhysicalsRecord(fullInputs());
  const { valid, errors } = validateSynthesisRecord(rec);
  assert.equal(valid, true, errors.join('; '));
});

test('buildPhysicalsRecord stamps the additive balance{} (cross-runtime obligation)', () => {
  const rec = buildPhysicalsRecord(fullInputs());
  assert.ok(rec.balance, 'balance stamp present');
  assert.equal(rec.balance.importance, 5);
  // score 95 >= target 75 → shortfall 0 → neglect 0 → priority 0
  assert.equal(rec.balance.neglect, 0);
  assert.equal(rec.balance.priority, 0);
});

test('buildPhysicalsRecord emits 4 areas[] in order with band/signal', () => {
  const rec = buildPhysicalsRecord(fullInputs());
  assert.equal(rec.areas.length, 4);
  assert.deepEqual(rec.areas.map((a) => a.key), AREA_KEYS);
  for (const a of rec.areas) {
    assert.ok(typeof a.label === 'string' && a.label.length > 0);
    assert.ok(typeof a.signal === 'string' && a.signal.length > 0);
    assert.ok(['thriving', 'steady', 'strained', 'depleted', 'unknown'].includes(a.band));
  }
});

test('null Areas drop out of the composite (weights renormalize)', () => {
  const rec = buildPhysicalsRecord({
    ...fullInputs(),
    recoveryHistory: null,
    meds: [], // null meds area
    restLog: [], // null sleep area
    recoveryLatest: { recovery_signal: 'well_recovered' }, // no acwr → training null
  });
  // only recovery present (90) → composite = round(90*.40/.40) = 90
  assert.equal(rec.state.score, 90);
  assert.equal(rec.areas.find((a) => a.key === 'sleep').score, null);
  assert.equal(rec.areas.find((a) => a.key === 'meds').score, null);
  assert.equal(rec.areas.find((a) => a.key === 'training').score, null);
  assert.equal(rec.provenance.coverage, 0.25); // 1 of 4
  assert.equal(rec.confidence, 'low');
});

test('all-null inputs → null score, unknown band, valid empty-state record', () => {
  const rec = buildPhysicalsRecord({
    recoveryLatest: null, recoveryHistory: null, meds: [], restLog: [], history: [],
    scoring: SCORING, balanceConfig: BALANCE_CFG, mode: 'weekly', nowMs: NOW,
  });
  assert.equal(rec.state.score, null);
  assert.equal(rec.state.band, 'unknown');
  assert.equal(rec.provenance.coverage, 0);
  assert.deepEqual(rec.provenance.sources, ['none']);
  assert.equal(validateSynthesisRecord(rec).valid, true);
  assert.equal(rec.balance.neglect, 0); // null score → no shortfall
});

test('a zero/missing-weight Area is excluded from BOTH composite and coverage (no high-confidence no-data)', () => {
  // recovery present (well_recovered → 90) but its weight is mis-set to 0; all
  // other Areas null. The composite must NOT count recovery, and coverage must
  // agree (else confidence could read "high" on a null score).
  const scoring = { ...SCORING, weights: { recovery: 0, sleep: 0.25, meds: 0.20, training: 0.15 } };
  const rec = buildPhysicalsRecord({
    recoveryLatest: { recovery_signal: 'well_recovered' }, // recovery present, no acwr → training null
    recoveryHistory: null, meds: [], restLog: [], history: [],
    scoring, balanceConfig: BALANCE_CFG, mode: 'weekly', nowMs: NOW,
  });
  assert.equal(rec.state.score, null);        // recovery dropped (weight 0), rest null
  assert.equal(rec.state.band, 'unknown');
  assert.equal(rec.provenance.coverage, 0);   // consistent — nothing fed the score
  assert.equal(rec.confidence, 'low');
  // but the hub still SHOWS recovery's sub-score (display unaffected by weighting)
  assert.equal(rec.areas.find((a) => a.key === 'recovery').score, 90);
});

test('low Areas produce neglect>0 + weekly nudges; daily mode → no nudges', () => {
  const lowInputs = {
    ...fullInputs(),
    recoveryLatest: { recovery_signal: 'strained', acwr: 1.8 }, // recovery 35, training 35
    restLog: KEYS.map((k) => ({ id: k, sleep: { hours: 3.75, quality: 2 } })), // low sleep
  };
  const weekly = buildPhysicalsRecord({ ...lowInputs, mode: 'weekly' });
  assert.ok(weekly.state.score < 75, 'below target');
  assert.ok(weekly.balance.neglect > 0, 'neglect accrues');
  assert.ok(weekly.balance.priority > 0, 'priority = importance*neglect');
  assert.ok(weekly.nudges.length >= 1 && weekly.nudges.length <= 2, 'weekly carries 1..2 moves');
  for (const n of weekly.nudges) {
    assert.ok(typeof n.text === 'string' && n.text.length > 0);
    assert.ok(Number.isInteger(n.priority) && n.priority >= 1);
  }
  const daily = buildPhysicalsRecord({ ...lowInputs, mode: 'daily' });
  assert.deepEqual(daily.nudges, []);
});
