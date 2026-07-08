// node --test suite for the Life Building synthesizer (Phase 5 slice 1).
// Run: cd council && node --test lib/life-building-synthesizer.test.mjs   (or: npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLifeBuildingRecord,
  savingsRateScore,
  creditScoreScore,
  debtRemainingScore,
  netWorthScore,
  currentMonthKey,
  confidenceFromCoverage,
  METRIC_KEYS,
} from './life-building-synthesizer.mjs';
import { validateSynthesisRecord } from './synthesis-record.mjs';

// Mirror config/life-building.json so assertions use the shipped defaults.
const CONFIG = {
  windowDays: 14,
  weights: { savingsRate: 0.40, creditScore: 0.30, debtRemaining: 0.15, netWorth: 0.15 },
  savingsTarget: 20,
  creditTarget: 800,
  creditFloor: 670,
};
const BALANCE_CFG = { importance: 4, target: 70 };

// A fixed "now" whose UTC month is 2026-07.
const NOW = Date.parse('2026-07-08T18:00:00Z');

// Helpers to build finance docs.
function finDoc(month, overrides = {}) {
  return {
    month,
    deviceId: 'test-device',
    updatedAt: Date.parse(`${month}-15T12:00:00Z`),
    schemaVersion: 1,
    ...overrides,
  };
}

// ── currentMonthKey ───────────────────────────────────────────────────────────
test('currentMonthKey returns YYYY-MM from ms timestamp', () => {
  assert.equal(currentMonthKey(Date.parse('2026-07-08T18:00:00Z')), '2026-07');
  assert.equal(currentMonthKey(Date.parse('2026-01-01T00:00:00Z')), '2026-01');
  assert.equal(currentMonthKey(Date.parse('2025-12-31T23:59:00Z')), '2025-12');
});

// ── confidenceFromCoverage ────────────────────────────────────────────────────
test('confidenceFromCoverage thresholds', () => {
  assert.equal(confidenceFromCoverage(1), 'high');
  assert.equal(confidenceFromCoverage(0.8), 'high');
  assert.equal(confidenceFromCoverage(0.5), 'medium');
  assert.equal(confidenceFromCoverage(0.25), 'low');
  assert.equal(confidenceFromCoverage(0), 'low');
});

// ── savingsRateScore ──────────────────────────────────────────────────────────
test('savingsRateScore: clamp(rate/target, 0, 1) * 100, null when absent', () => {
  // exactly at target (20%) → 100
  assert.equal(savingsRateScore([finDoc('2026-07', { savingsRate: 20 })], CONFIG), 100);
  // half of target (10%) → 50
  assert.equal(savingsRateScore([finDoc('2026-07', { savingsRate: 10 })], CONFIG), 50);
  // over target (30%) → clamped to 100
  assert.equal(savingsRateScore([finDoc('2026-07', { savingsRate: 30 })], CONFIG), 100);
  // 0% → 0
  assert.equal(savingsRateScore([finDoc('2026-07', { savingsRate: 0 })], CONFIG), 0);
  // no snapshot has savingsRate → null
  assert.equal(savingsRateScore([finDoc('2026-07')], CONFIG), null);
  assert.equal(savingsRateScore([], CONFIG), null);
});

test('savingsRateScore picks the LATEST snapshot carrying savingsRate', () => {
  // Two months: June (savingsRate 10) and July (savingsRate 20). July should win.
  const docs = [
    finDoc('2026-06', { savingsRate: 10 }),
    finDoc('2026-07', { savingsRate: 20 }),
  ];
  assert.equal(savingsRateScore(docs, CONFIG), 100); // July 20/20 = 100
  // Reversed array order — month sort must still pick July.
  const reversed = [
    finDoc('2026-07', { savingsRate: 20 }),
    finDoc('2026-06', { savingsRate: 10 }),
  ];
  assert.equal(savingsRateScore(reversed, CONFIG), 100);
});

test('savingsRateScore skips months without the field to find the latest with it', () => {
  const docs = [
    finDoc('2026-07'), // most recent, no savingsRate
    finDoc('2026-06', { savingsRate: 15 }),
  ];
  // Should use June's 15% since July lacks the field.
  assert.equal(savingsRateScore(docs, CONFIG), 75); // 15/20 = 0.75 → 75
});

// ── creditScoreScore ──────────────────────────────────────────────────────────
test('creditScoreScore: clamp((score-floor)/(target-floor), 0, 1) * 100', () => {
  // At target (800): (800-670)/(800-670) = 1 → 100
  assert.equal(creditScoreScore([finDoc('2026-07', { creditScore: 800 })], CONFIG), 100);
  // At floor (670): (670-670)/130 = 0 → 0
  assert.equal(creditScoreScore([finDoc('2026-07', { creditScore: 670 })], CONFIG), 0);
  // Midpoint (735): (735-670)/130 = 65/130 = 0.5 → 50
  assert.equal(creditScoreScore([finDoc('2026-07', { creditScore: 735 })], CONFIG), 50);
  // Below floor (600): clamped to 0
  assert.equal(creditScoreScore([finDoc('2026-07', { creditScore: 600 })], CONFIG), 0);
  // Above target (850): clamped to 100
  assert.equal(creditScoreScore([finDoc('2026-07', { creditScore: 850 })], CONFIG), 100);
  // No creditScore field → null
  assert.equal(creditScoreScore([finDoc('2026-07')], CONFIG), null);
  assert.equal(creditScoreScore([], CONFIG), null);
});

test('creditScoreScore picks the LATEST snapshot with creditScore', () => {
  const docs = [
    finDoc('2026-06', { creditScore: 670 }),  // floor = 0
    finDoc('2026-07', { creditScore: 800 }),  // target = 100
  ];
  assert.equal(creditScoreScore(docs, CONFIG), 100);
});

// ── debtRemainingScore ────────────────────────────────────────────────────────
test('debtRemainingScore: null with <2 months carrying debtRemaining', () => {
  assert.equal(debtRemainingScore([]), null);
  assert.equal(debtRemainingScore([finDoc('2026-07', { debtRemaining: 10000 })]), null);
  // Two months without debtRemaining field → null
  assert.equal(
    debtRemainingScore([finDoc('2026-06'), finDoc('2026-07')]),
    null,
  );
  // One with, one without → still null (need 2 carrying the field)
  assert.equal(
    debtRemainingScore([
      finDoc('2026-06', { debtRemaining: 10000 }),
      finDoc('2026-07'),
    ]),
    null,
  );
});

test('debtRemainingScore: down = good; activates at ≥2 months', () => {
  // Paid off 10%: (10000-9000)/10000 = 0.10 → 10
  assert.equal(
    debtRemainingScore([
      finDoc('2026-06', { debtRemaining: 10000 }),
      finDoc('2026-07', { debtRemaining: 9000 }),
    ]),
    10,
  );
  // Paid off 100%: debt gone → 100
  assert.equal(
    debtRemainingScore([
      finDoc('2026-06', { debtRemaining: 10000 }),
      finDoc('2026-07', { debtRemaining: 0 }),
    ]),
    100,
  );
  // Debt grew (9000 → 10000): negative reduction → clamped to 0
  assert.equal(
    debtRemainingScore([
      finDoc('2026-06', { debtRemaining: 9000 }),
      finDoc('2026-07', { debtRemaining: 10000 }),
    ]),
    0,
  );
  // Paid off 50% → 50
  assert.equal(
    debtRemainingScore([
      finDoc('2026-06', { debtRemaining: 20000 }),
      finDoc('2026-07', { debtRemaining: 10000 }),
    ]),
    50,
  );
});

test('debtRemainingScore uses the two most recent months (not first two)', () => {
  // Three months: Apr grew, May→Jun paid down
  const docs = [
    finDoc('2026-04', { debtRemaining: 8000 }),
    finDoc('2026-05', { debtRemaining: 10000 }),
    finDoc('2026-06', { debtRemaining: 9000 }),
  ];
  // Most recent pair: May(10000)→Jun(9000) = 10% reduction → 10
  assert.equal(debtRemainingScore(docs), 10);
});

test('debtRemainingScore: prev=0 with curr=0 → 100; prev=0 with curr>0 → null', () => {
  // Started at 0 (no debt), still 0 → 100 (perfect)
  assert.equal(
    debtRemainingScore([
      finDoc('2026-06', { debtRemaining: 0 }),
      finDoc('2026-07', { debtRemaining: 0 }),
    ]),
    100,
  );
  // Started at 0, now has debt → null (can't compute reduction from 0 base)
  assert.equal(
    debtRemainingScore([
      finDoc('2026-06', { debtRemaining: 0 }),
      finDoc('2026-07', { debtRemaining: 5000 }),
    ]),
    null,
  );
});

// ── netWorthScore ─────────────────────────────────────────────────────────────
test('netWorthScore: null with <2 months carrying netWorth', () => {
  assert.equal(netWorthScore([]), null);
  assert.equal(netWorthScore([finDoc('2026-07', { netWorth: 50000 })]), null);
  assert.equal(netWorthScore([finDoc('2026-06'), finDoc('2026-07')]), null);
});

test('netWorthScore: up = good; activates at ≥2 months', () => {
  // Grew 10%: (55000-50000)/50000 = 0.10 → 10
  assert.equal(
    netWorthScore([
      finDoc('2026-06', { netWorth: 50000 }),
      finDoc('2026-07', { netWorth: 55000 }),
    ]),
    10,
  );
  // Grew 100% → 100
  assert.equal(
    netWorthScore([
      finDoc('2026-06', { netWorth: 50000 }),
      finDoc('2026-07', { netWorth: 100000 }),
    ]),
    100,
  );
  // Fell: negative growth → clamped to 0
  assert.equal(
    netWorthScore([
      finDoc('2026-06', { netWorth: 50000 }),
      finDoc('2026-07', { netWorth: 40000 }),
    ]),
    0,
  );
  // Negative net worth improving (−10000 → −5000): ((-5000)-(-10000))/10000 = 0.5 → 50
  assert.equal(
    netWorthScore([
      finDoc('2026-06', { netWorth: -10000 }),
      finDoc('2026-07', { netWorth: -5000 }),
    ]),
    50,
  );
});

test('netWorthScore: prev=0 with curr>0 → 100; prev=0 with curr<=0 → 0', () => {
  assert.equal(
    netWorthScore([
      finDoc('2026-06', { netWorth: 0 }),
      finDoc('2026-07', { netWorth: 1000 }),
    ]),
    100,
  );
  assert.equal(
    netWorthScore([
      finDoc('2026-06', { netWorth: 0 }),
      finDoc('2026-07', { netWorth: 0 }),
    ]),
    0,
  );
  assert.equal(
    netWorthScore([
      finDoc('2026-06', { netWorth: 0 }),
      finDoc('2026-07', { netWorth: -1000 }),
    ]),
    0,
  );
});

test('netWorthScore uses the two most recent months (not first two)', () => {
  const docs = [
    finDoc('2026-04', { netWorth: 100000 }),
    finDoc('2026-05', { netWorth: 50000 }),  // fell
    finDoc('2026-06', { netWorth: 60000 }),  // grew 20%
  ];
  // Most recent pair: May(50000)→Jun(60000) = 20% growth → 20
  assert.equal(netWorthScore(docs), 20);
});

// ── METRIC_KEYS ───────────────────────────────────────────────────────────────
test('METRIC_KEYS has 4 entries matching the spec', () => {
  assert.equal(METRIC_KEYS.length, 4);
  assert.deepEqual(METRIC_KEYS, ['savingsRate', 'creditScore', 'debtRemaining', 'netWorth']);
});

// ── buildLifeBuildingRecord (integration: score model + record contract) ──────

function fullDocs() {
  // Two months for trends; July = current month for staleness tests.
  return [
    finDoc('2026-06', { savingsRate: 20, creditScore: 800, debtRemaining: 10000, netWorth: 50000 }),
    finDoc('2026-07', { savingsRate: 20, creditScore: 800, debtRemaining: 9000, netWorth: 55000 }),
  ];
}

function fullArgs(overrides = {}) {
  return {
    financesDocs: fullDocs(),
    config: CONFIG,
    balanceConfig: BALANCE_CFG,
    mode: 'weekly',
    producer: 'council/life-building',
    now: NOW,
    ...overrides,
  };
}

test('buildLifeBuildingRecord composites via the Balance engine weighted mean', () => {
  const rec = buildLifeBuildingRecord(fullArgs());
  // savingsRate 100 * 0.40 + creditScore 100 * 0.30 + debtRemaining 10 * 0.15 + netWorth 10 * 0.15
  // = 40 + 30 + 1.5 + 1.5 = 73 → round(73) = 73
  // debtRemaining: (10000-9000)/10000 = 10% → 10
  // netWorth: (55000-50000)/50000 = 10% → 10
  // weighted: (100*.40 + 100*.30 + 10*.15 + 10*.15) / 1.0 = (40+30+1.5+1.5) = 73
  assert.equal(rec.state.score, 73);
  assert.equal(rec.state.band, 'steady');
  assert.equal(rec.node, 'life_building');
  assert.equal(rec.contractVersion, 1);
});

test('buildLifeBuildingRecord produces a contract-VALID record', () => {
  const rec = buildLifeBuildingRecord(fullArgs());
  const { valid, errors } = validateSynthesisRecord(rec);
  assert.equal(valid, true, errors.join('; '));
});

test('buildLifeBuildingRecord stamps balance{} (cross-runtime obligation)', () => {
  const rec = buildLifeBuildingRecord(fullArgs());
  assert.ok(rec.balance, 'balance stamp present');
  assert.equal(rec.balance.importance, 4);
  // score 73 >= target 70 → shortfall 0 → neglect 0 → priority 0
  assert.equal(rec.balance.neglect, 0);
  assert.equal(rec.balance.priority, 0);
});

test('buildLifeBuildingRecord stamps balance neglect when score < target', () => {
  // savingsRate 10% → 50; rest null
  const rec = buildLifeBuildingRecord(fullArgs({
    financesDocs: [finDoc('2026-07', { savingsRate: 10 })],
  }));
  // score = 50, target = 70 → shortfall = (70-50)/70 ≈ 0.286
  assert.ok(rec.balance.neglect > 0, 'neglect accrues when below target');
  assert.ok(rec.balance.priority > 0, 'priority = importance * neglect');
});

test('buildLifeBuildingRecord emits areas[] with the Finances entry', () => {
  const rec = buildLifeBuildingRecord(fullArgs());
  assert.equal(rec.areas.length, 1);
  assert.equal(rec.areas[0].key, 'finances');
  assert.equal(rec.areas[0].label, 'Finances');
  assert.ok(typeof rec.areas[0].signal === 'string' && rec.areas[0].signal.length > 0);
  assert.ok(['thriving', 'steady', 'strained', 'depleted', 'unknown'].includes(rec.areas[0].band));
});

test('empty input → null score, unknown band, valid empty-state record', () => {
  const rec = buildLifeBuildingRecord({
    financesDocs: [],
    config: CONFIG,
    balanceConfig: BALANCE_CFG,
    mode: 'weekly',
    now: NOW,
  });
  assert.equal(rec.state.score, null);
  assert.equal(rec.state.band, 'unknown');
  assert.equal(rec.provenance.coverage, 0);
  assert.deepEqual(rec.provenance.sources, ['none']);
  assert.equal(validateSynthesisRecord(rec).valid, true);
  // null score → no shortfall → neglect 0 (matches physicals behaviour)
  assert.equal(rec.balance.neglect, 0);
});

// ── Trend gating: null with <2 months, activates at 2 ────────────────────────
test('trend metrics are null with only 1 month of data', () => {
  const rec = buildLifeBuildingRecord(fullArgs({
    financesDocs: [finDoc('2026-07', { savingsRate: 20, creditScore: 800, debtRemaining: 5000, netWorth: 50000 })],
  }));
  // Only level metrics (savingsRate + creditScore) contribute; trends null.
  // savingsRate 100*.40 + creditScore 100*.30, renormalized over .40+.30=.70
  // = (40+30)/0.70 = 100 → round(100) = 100
  assert.equal(rec.state.score, 100);
  assert.equal(rec.provenance.coverage, 0.5); // 2 of 4 metrics counted
  assert.equal(rec.confidence, 'medium'); // 0.5 → medium (never high with 2/4)
  // areas[0] score matches composite
  assert.equal(rec.areas[0].score, 100);
});

test('trend metrics activate at 2 months, not before', () => {
  // One month: no trends
  const oneMo = buildLifeBuildingRecord(fullArgs({
    financesDocs: [finDoc('2026-06', { debtRemaining: 10000, netWorth: 50000 })],
  }));
  assert.equal(oneMo.state.score, null); // no level metrics → null

  // Two months: trends activate
  const twoMo = buildLifeBuildingRecord(fullArgs({
    financesDocs: [
      finDoc('2026-06', { debtRemaining: 10000, netWorth: 50000 }),
      finDoc('2026-07', { debtRemaining: 9000, netWorth: 55000 }),
    ],
  }));
  // debtRemaining 10% → 10; netWorth 10% → 10
  // weights: debt 0.15 + nw 0.15 = 0.30
  // (10*0.15 + 10*0.15) / 0.30 = 3/0.30 = 10
  assert.equal(twoMo.state.score, 10);
  assert.ok(twoMo.state.score != null, 'trends are now active');
});

// ── Weight renormalization when metrics drop out ───────────────────────────────
test('null metrics drop out of composite (weights renormalize)', () => {
  // Only savingsRate present (20% = 100 score), others absent.
  const rec = buildLifeBuildingRecord(fullArgs({
    financesDocs: [finDoc('2026-07', { savingsRate: 20 })],
  }));
  // savingsRate only: 100 * 0.40 / 0.40 = 100
  assert.equal(rec.state.score, 100);
  assert.equal(rec.provenance.coverage, 0.25); // 1 of 4
  assert.equal(rec.confidence, 'low');
});

test('zero-weight metric excluded from composite and coverage', () => {
  // Set savingsRate weight to 0 in config; savingsRate is present but should be excluded.
  const zeroWeightConfig = {
    ...CONFIG,
    weights: { savingsRate: 0, creditScore: 0.30, debtRemaining: 0.15, netWorth: 0.15 },
  };
  const rec = buildLifeBuildingRecord(fullArgs({
    financesDocs: [finDoc('2026-07', { savingsRate: 20, creditScore: 800 })],
    config: zeroWeightConfig,
  }));
  // savingsRate present but weight=0 → excluded from composite + coverage
  // creditScore 100 * 0.30 / 0.30 = 100
  assert.equal(rec.state.score, 100);
  assert.equal(rec.provenance.coverage, 0.25); // only creditScore counted (1/4)
});

// ── Level target normalization ─────────────────────────────────────────────────
test('savingsRate level: clamp at 0 and 1 (never negative, never >100)', () => {
  // Negative savings rate → 0
  assert.equal(savingsRateScore([finDoc('2026-07', { savingsRate: -5 })], CONFIG), 0);
  // 200% → still 100 (clamped)
  assert.equal(savingsRateScore([finDoc('2026-07', { savingsRate: 200 })], CONFIG), 100);
});

test('creditScore level: clamp at 0 and 1 (below floor → 0, above target → 100)', () => {
  assert.equal(creditScoreScore([finDoc('2026-07', { creditScore: 300 })], CONFIG), 0);
  assert.equal(creditScoreScore([finDoc('2026-07', { creditScore: 900 })], CONFIG), 100);
});

// ── Staleness nudge ───────────────────────────────────────────────────────────
test('staleness nudge fires when latest month ≠ current month (weekly mode)', () => {
  // Latest data is June, current month is July → stale
  const rec = buildLifeBuildingRecord(fullArgs({
    financesDocs: [finDoc('2026-06', { savingsRate: 20 })],
    now: NOW, // NOW = 2026-07
    mode: 'weekly',
  }));
  const staleNudge = rec.nudges.find((n) => n.text.includes("haven't been updated"));
  assert.ok(staleNudge, 'staleness nudge present');
  assert.equal(staleNudge.priority, 1);
});

test('staleness nudge does NOT fire when latest month === current month', () => {
  // Latest data is July (same as NOW) → not stale
  const rec = buildLifeBuildingRecord(fullArgs({
    financesDocs: [finDoc('2026-07', { savingsRate: 20 })],
    now: NOW,
    mode: 'weekly',
  }));
  const staleNudge = rec.nudges.find((n) => n.text.includes("haven't been updated"));
  assert.equal(staleNudge, undefined, 'no staleness nudge when current');
});

test('staleness nudge does NOT fire in daily mode', () => {
  const rec = buildLifeBuildingRecord(fullArgs({
    financesDocs: [finDoc('2026-06', { savingsRate: 20 })],
    now: NOW,
    mode: 'daily',
  }));
  const staleNudge = rec.nudges.find((n) => n.text.includes("haven't been updated"));
  assert.equal(staleNudge, undefined, 'no staleness nudge in daily mode');
});

test('staleness nudge does NOT fire when financesDocs is empty', () => {
  // No docs → no "latest month" to compare → no stale nudge
  const rec = buildLifeBuildingRecord(fullArgs({
    financesDocs: [],
    now: NOW,
    mode: 'weekly',
  }));
  const staleNudge = rec.nudges.find((n) => n.text.includes("haven't been updated"));
  assert.equal(staleNudge, undefined, 'no staleness nudge when no docs');
});

// ── Daily mode: no nudges ─────────────────────────────────────────────────────
test('daily mode produces no nudges (even with low score)', () => {
  const rec = buildLifeBuildingRecord(fullArgs({
    financesDocs: [finDoc('2026-07', { savingsRate: 1 })], // very low
    mode: 'daily',
  }));
  assert.deepEqual(rec.nudges, []);
});

// ── Low score produces neglect > 0 ───────────────────────────────────────────
test('low score produces neglect > 0 and priority > 0', () => {
  // savingsRate 5% → 25 score, way below target 70
  const rec = buildLifeBuildingRecord(fullArgs({
    financesDocs: [finDoc('2026-07', { savingsRate: 5 })],
    mode: 'weekly',
  }));
  assert.ok(rec.state.score != null && rec.state.score < 70, 'below target');
  assert.ok(rec.balance.neglect > 0, 'neglect accrues');
  assert.ok(rec.balance.priority > 0, 'priority = importance * neglect');
});

// ── Cold-start coverage: 2 level metrics → medium confidence ─────────────────
test('cold-start (1 month, 2 level metrics) → coverage=0.5 → confidence medium', () => {
  const rec = buildLifeBuildingRecord(fullArgs({
    financesDocs: [finDoc('2026-07', { savingsRate: 20, creditScore: 800 })],
  }));
  assert.equal(rec.provenance.coverage, 0.5); // 2 of 4
  assert.equal(rec.confidence, 'medium');
});

// ── Full 4-metric coverage → high confidence ─────────────────────────────────
test('all 4 metrics present → coverage=1 → confidence high', () => {
  const rec = buildLifeBuildingRecord(fullArgs());
  assert.equal(rec.provenance.coverage, 1); // all 4 counted
  assert.equal(rec.confidence, 'high');
});

// ── Validator passes on a well-formed record ──────────────────────────────────
test('validator passes on a good record (integration gate)', () => {
  const rec = buildLifeBuildingRecord(fullArgs());
  const { valid, errors } = validateSynthesisRecord(rec);
  assert.equal(valid, true, `validator errors: ${errors.join('; ')}`);
});
