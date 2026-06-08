// node --test suite for the Home synthesizer (ADR-0005 roll-up).
// Run: cd council && node --test lib/home-synthesizer.test.mjs   (or: npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHomeRecord,
  pillarLabel,
  confidenceFromCoverage,
  deriveWindow,
} from './home-synthesizer.mjs';
import { validateSynthesisRecord } from './synthesis-record.mjs';
import { bandForScore } from './balance.mjs';

const CONFIG = {
  physicals: { importance: 5, target: 75 },
  chickens: { importance: 5, target: 75 },
  life_building: { importance: 4, target: 70 },
  relationships: { importance: 4, target: 70 },
  growth: { importance: 3, target: 70 },
};

// A fixed set of 5 pillar records mirroring the seed spread:
// physicals 45 · chickens 68 · life_building 52 · relationships 34 · growth 73
function pillarRec(node, score, nudges = []) {
  return {
    contractVersion: 1,
    node,
    producer: 'council/seed',
    producedAt: '2026-06-08T06:00:00Z',
    window: '2026-06-08',
    state: { band: bandForScore(score), score },
    headline: `${node} read.`,
    signals: [`${node} signal`],
    nudges,
    provenance: { sources: ['seed'], coverage: 1 },
    confidence: 'medium',
  };
}

function fiveRecords() {
  return [
    pillarRec('physicals', 45, [{ text: 'Add one easy aerobic session', priority: 1 }]),
    pillarRec('chickens', 68),
    pillarRec('life_building', 52),
    pillarRec('relationships', 34, [{ text: 'Plan a date night with Marlee', priority: 1 }]),
    pillarRec('growth', 73),
  ];
}

// ── label helper ─────────────────────────────────────────────────────────────
test('pillarLabel title-cases compound node paths', () => {
  assert.equal(pillarLabel('life_building'), 'Life Building');
  assert.equal(pillarLabel('physicals'), 'Physicals');
  assert.equal(pillarLabel('relationships'), 'Relationships');
  // unmapped node falls back to title-casing
  assert.equal(pillarLabel('foo_bar'), 'Foo Bar');
  assert.equal(pillarLabel('physicals/sleep'), 'Physicals Sleep');
});

// ── confidence helper ────────────────────────────────────────────────────────
test('confidenceFromCoverage thresholds', () => {
  assert.equal(confidenceFromCoverage(1), 'high');
  assert.equal(confidenceFromCoverage(0.8), 'high');
  assert.equal(confidenceFromCoverage(0.79), 'medium');
  assert.equal(confidenceFromCoverage(0.5), 'medium');
  assert.equal(confidenceFromCoverage(0.49), 'low');
  assert.equal(confidenceFromCoverage(0), 'low');
});

// ── roll-up produces a VALID record ──────────────────────────────────────────
test('weekly home record rolls 5 pillars into a valid record', () => {
  const record = buildHomeRecord({
    pillarRecords: fiveRecords(),
    config: CONFIG,
    mode: 'weekly',
    producer: 'council/weekly-recap',
  });
  const { valid, errors } = validateSynthesisRecord(record);
  assert.equal(valid, true, errors.join('; '));
  assert.equal(record.node, 'home');
  assert.equal(record.contractVersion, 1);
  assert.equal(record.producer, 'council/weekly-recap');
  // balanceScore of the fixed spread (weighted mean) = 54, band "strained".
  assert.equal(record.state.score, 54);
  assert.equal(record.state.band, 'strained');
  // coverage = 5/5 → high.
  assert.equal(record.provenance.coverage, 1);
  assert.equal(record.confidence, 'high');
  // provenance.sources name each pillar.
  assert.deepEqual(record.provenance.sources.sort(), [
    'synthesis/chickens',
    'synthesis/growth',
    'synthesis/life_building',
    'synthesis/physicals',
    'synthesis/relationships',
  ]);
});

test('headline names the top-priority pillar and is <=140 chars', () => {
  const record = buildHomeRecord({
    pillarRecords: fiveRecords(),
    config: CONFIG,
    mode: 'weekly',
    producer: 'council/weekly-recap',
  });
  // relationships is the most important-and-neglected → it leads the headline.
  assert.ok(record.headline.includes('Relationships'), record.headline);
  assert.ok(record.headline.length <= 140);
});

test('signals render top pillars as "<Pillar> <band> (<score>)" (<=5)', () => {
  const record = buildHomeRecord({
    pillarRecords: fiveRecords(),
    config: CONFIG,
    mode: 'weekly',
    producer: 'council/weekly-recap',
  });
  assert.ok(record.signals.length <= 5);
  // top signal is relationships depleted (34).
  assert.equal(record.signals[0], 'Relationships depleted (34)');
});

// ── daily vs weekly nudges ───────────────────────────────────────────────────
test('daily home record carries NO nudges (passive glance)', () => {
  const record = buildHomeRecord({
    pillarRecords: fiveRecords(),
    config: CONFIG,
    mode: 'daily',
    producer: 'council/nightly-glance',
  });
  assert.deepEqual(record.nudges, []);
  assert.equal(validateSynthesisRecord(record).valid, true);
});

test('weekly home record carries 1..3 priority-ordered nudges', () => {
  const record = buildHomeRecord({
    pillarRecords: fiveRecords(),
    config: CONFIG,
    mode: 'weekly',
    producer: 'council/weekly-recap',
  });
  assert.ok(record.nudges.length >= 1 && record.nudges.length <= 3, JSON.stringify(record.nudges));
  // priorities are 1..N, ascending and contiguous.
  record.nudges.forEach((n, i) => assert.equal(n.priority, i + 1));
  // the top nudge is drawn from relationships' OWN record nudge.
  assert.equal(record.nudges[0].text, 'Plan a date night with Marlee');
  // the second is drawn from physicals' own nudge.
  assert.equal(record.nudges[1].text, 'Add one easy aerobic session');
});

test('weekly nudges synthesize a "Tend <Pillar>" move when a pillar has none', () => {
  // life_building (52, strained, no own nudges) is a top-3 neglected pillar.
  const record = buildHomeRecord({
    pillarRecords: fiveRecords(),
    config: CONFIG,
    mode: 'weekly',
    producer: 'council/weekly-recap',
  });
  // third nudge falls to life_building, which has no own nudges → synthesized.
  assert.equal(record.nudges[2].text, 'Tend Life Building — running below target');
});

// ── null-score pillar → coverage / confidence ────────────────────────────────
test('a null-score pillar lowers coverage and confidence', () => {
  const records = fiveRecords();
  // knock out growth's data.
  records[4] = pillarRec('growth', null);
  const record = buildHomeRecord({
    pillarRecords: records,
    config: CONFIG,
    mode: 'weekly',
    producer: 'council/weekly-recap',
  });
  // 4 of 5 scored → coverage 0.8 → still "high".
  assert.equal(record.provenance.coverage, 0.8);
  assert.equal(record.confidence, 'high');
  assert.equal(validateSynthesisRecord(record).valid, true);
});

test('two null-score pillars drop coverage to 0.6 → medium confidence', () => {
  const records = fiveRecords();
  records[3] = pillarRec('relationships', null);
  records[4] = pillarRec('growth', null);
  const record = buildHomeRecord({
    pillarRecords: records,
    config: CONFIG,
    mode: 'weekly',
    producer: 'council/weekly-recap',
  });
  assert.equal(record.provenance.coverage, 0.6);
  assert.equal(record.confidence, 'medium');
});

test('all-null pillars → null score, unknown band, valid record, low confidence', () => {
  const records = [
    pillarRec('physicals', null),
    pillarRec('chickens', null),
  ];
  const record = buildHomeRecord({
    pillarRecords: records,
    config: CONFIG,
    mode: 'weekly',
    producer: 'council/weekly-recap',
  });
  assert.equal(record.state.score, null);
  assert.equal(record.state.band, 'unknown');
  assert.equal(record.provenance.coverage, 0);
  assert.equal(record.confidence, 'low');
  // no pillar carries neglect (all null) → no nudges, no manufactured concern.
  assert.deepEqual(record.nudges, []);
  assert.equal(validateSynthesisRecord(record).valid, true);
});

// ── window derivation ────────────────────────────────────────────────────────
test('deriveWindow collapses to a single shared date', () => {
  assert.equal(deriveWindow(fiveRecords()), '2026-06-08');
});

test('deriveWindow spans a min..max range across differing windows', () => {
  const recs = [
    pillarRec('physicals', 45),
    { ...pillarRec('chickens', 68), window: '2026-06-01..2026-06-07' },
  ];
  assert.equal(deriveWindow(recs), '2026-06-01..2026-06-08');
});

test('deriveWindow falls back to today (UTC) when no records', () => {
  const w = deriveWindow([]);
  assert.match(w, /^\d{4}-\d{2}-\d{2}$/);
});

// ── empty input still produces a valid record ────────────────────────────────
test('buildHomeRecord with no pillar records still emits a valid (unknown) home record', () => {
  const record = buildHomeRecord({
    pillarRecords: [],
    config: CONFIG,
    mode: 'weekly',
    producer: 'council/weekly-recap',
  });
  assert.equal(record.state.score, null);
  assert.equal(record.state.band, 'unknown');
  assert.deepEqual(record.signals, []);
  assert.deepEqual(record.nudges, []);
  assert.equal(record.confidence, 'low');
  assert.equal(validateSynthesisRecord(record).valid, true);
});
