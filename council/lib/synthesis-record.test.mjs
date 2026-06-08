// node --test suite for the synthesis-record envelope.
// Run: cd council && npm test   (or: node --test)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSynthesisRecord,
  validateSynthesisRecord,
  CONTRACT_VERSION,
} from './synthesis-record.mjs';

// A minimal, contract-valid record used as the base for the negative cases.
function validRecord(overrides = {}) {
  return {
    contractVersion: 1,
    node: 'home',
    producer: 'council/phase0-smoke',
    producedAt: '2026-06-08T06:00:12Z',
    window: '2026-06-08',
    state: { band: 'steady', score: 72 },
    headline: 'Phase 0 smoke — local council reached Firestore.',
    signals: ['launchd fired', 'admin SDK authenticated', 'write path verified'],
    nudges: [],
    provenance: { sources: ['none — synthetic'], coverage: 1 },
    confidence: 'low',
    ...overrides,
  };
}

test('a valid record passes', () => {
  const { valid, errors } = validateSynthesisRecord(validRecord());
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test('rejects a missing required field', () => {
  const rec = validRecord();
  delete rec.headline;
  const { valid, errors } = validateSynthesisRecord(rec);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('headline')));
});

test('rejects a bad band', () => {
  const { valid, errors } = validateSynthesisRecord(
    validRecord({ state: { band: 'sleepy', score: 50 } }),
  );
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('band')));
});

test('rejects 6 signals (max is 5)', () => {
  const { valid, errors } = validateSynthesisRecord(
    validRecord({ signals: ['a', 'b', 'c', 'd', 'e', 'f'] }),
  );
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('signals')));
});

test('rejects a score of 101 (out of 0..100)', () => {
  const { valid, errors } = validateSynthesisRecord(
    validRecord({ state: { band: 'thriving', score: 101 } }),
  );
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('score')));
});

test('accepts a null score (band unknown)', () => {
  const { valid } = validateSynthesisRecord(
    validRecord({ state: { band: 'unknown', score: null } }),
  );
  assert.equal(valid, true);
});

test('rejects a bad confidence enum', () => {
  const { valid, errors } = validateSynthesisRecord(
    validRecord({ confidence: 'certain' }),
  );
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('confidence')));
});

test('rejects a nudge with priority < 1', () => {
  const { valid, errors } = validateSynthesisRecord(
    validRecord({ nudges: [{ text: 'hydrate', priority: 0 }] }),
  );
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('priority')));
});

test('buildSynthesisRecord defaults nudges to [] and stamps contractVersion + producedAt', () => {
  const rec = buildSynthesisRecord({
    node: 'home',
    producer: 'council/phase0-smoke',
    window: '2026-06-08',
    state: { band: 'steady', score: 72 },
    headline: 'hi',
    signals: [],
    provenance: { sources: [], coverage: 1 },
    confidence: 'low',
  });
  assert.deepEqual(rec.nudges, []);
  assert.equal(rec.contractVersion, CONTRACT_VERSION);
  assert.equal(typeof rec.producedAt, 'string');
  // producedAt must be a parseable ISO-8601 UTC timestamp.
  assert.ok(!Number.isNaN(Date.parse(rec.producedAt)));
  assert.ok(rec.producedAt.endsWith('Z'));
});

test('buildSynthesisRecord lets an explicit nudges override the default', () => {
  const rec = buildSynthesisRecord({ nudges: [{ text: 'walk', priority: 1 }] });
  assert.deepEqual(rec.nudges, [{ text: 'walk', priority: 1 }]);
});

test('buildSynthesisRecord output round-trips through the validator', () => {
  const rec = buildSynthesisRecord({
    node: 'home',
    producer: 'council/phase0-smoke',
    window: '2026-06-08',
    state: { band: 'steady', score: 72 },
    headline: 'Phase 0 smoke — local council reached Firestore.',
    signals: ['launchd fired', 'admin SDK authenticated', 'write path verified'],
    provenance: { sources: ['none — synthetic'], coverage: 1 },
    confidence: 'low',
  });
  const { valid, errors } = validateSynthesisRecord(rec);
  assert.equal(valid, true, errors.join('; '));
});
