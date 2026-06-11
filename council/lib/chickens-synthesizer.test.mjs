// node --test suite for the Chickens synthesizer (Phase 3).
// Run: cd council && node --test lib/chickens-synthesizer.test.mjs   (or: npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildChickensRecord,
  moodScore,
  mindfulnessScore,
  isMindfulSession,
  bfrbScore,
  focusScore,
  stressScore,
  reflectionForWeek,
  isoWeekKey,
  chickensAreaLabel,
  AREA_KEYS,
} from './chickens-synthesizer.mjs';
import { windowDateKeys, dateKeyLocal } from './physicals-synthesizer.mjs';
import { validateSynthesisRecord } from './synthesis-record.mjs';

// Mirror config/chickens.json so assertions use the shipped defaults.
const SCORING = {
  windowDays: 14,
  weights: { mood: 0.30, bfrb: 0.25, mindfulness: 0.20, focus: 0.15, stress: 0.10 },
  mood: { minLogs: 3 },
  mindfulness: { targetSessions: 4 },
  bfrb: { quietThreshold: 5, quietScore: 85, bands: [0.7, 1.15, 1.6], scores: [90, 70, 50, 30] },
  focus: { targetMinutes: 600 },
};
const BALANCE_CFG = { importance: 5, target: 75 };

const NOW = Date.parse('2026-06-08T18:00:00Z'); // a Monday — ISO week 2026-W24
const KEYS = windowDateKeys(NOW, 14);
const LAST7 = KEYS.slice(-7);
const PRIOR7 = KEYS.slice(0, 7);
const msAtLocalNoon = (key) => new Date(`${key}T12:00:00`).getTime();

// Fixture builders — mood stamps `at` (ADR-0008), bfrb stamps `takenAt`,
// history sessions carry the canonical ISO `date` field.
const mood = (key, valence) => ({ at: msAtLocalNoon(key), valence, deviceId: 'd' });
const catchAt = (key) => ({ takenAt: msAtLocalNoon(key), deviceId: 'd' });
const session = (key, props) => ({ date: new Date(msAtLocalNoon(key)).toISOString(), ...props });
const catches = (keys, perDay) => keys.flatMap((k) => Array.from({ length: perDay }, () => catchAt(k)));

// ── label + week helpers ─────────────────────────────────────────────────────
test('chickensAreaLabel maps known keys + falls back', () => {
  assert.equal(chickensAreaLabel('mood'), 'Mood');
  assert.equal(chickensAreaLabel('bfrb'), 'BFRB regulation');
  assert.equal(chickensAreaLabel('stress'), 'Stress load');
  assert.equal(chickensAreaLabel('foo'), 'Foo');
});

test('isoWeekKey computes ISO-8601 week keys incl. year boundary', () => {
  assert.equal(isoWeekKey(new Date(2026, 5, 8, 12).getTime()), '2026-W24'); // Mon Jun 8 2026
  assert.equal(isoWeekKey(new Date(2026, 0, 1, 12).getTime()), '2026-W01'); // Thu Jan 1 2026
  assert.equal(isoWeekKey(new Date(2027, 0, 1, 12).getTime()), '2026-W53'); // Fri Jan 1 2027 → prior ISO year
});

// ── moodScore ────────────────────────────────────────────────────────────────
test('moodScore maps mean valence onto 0..100; <minLogs → null', () => {
  const d = KEYS[KEYS.length - 1];
  assert.equal(moodScore([mood(d, 5), mood(d, 5), mood(d, 5)], KEYS, SCORING), 100);
  assert.equal(moodScore([mood(d, 3), mood(d, 3), mood(d, 3)], KEYS, SCORING), 50);
  assert.equal(moodScore([mood(d, 1), mood(d, 1), mood(d, 1)], KEYS, SCORING), 0);
  // mean 3.667 → (2.667/4)*100 = 66.7 → 67
  assert.equal(moodScore([mood(d, 3), mood(d, 4), mood(d, 4)], KEYS, SCORING), 67);
  // 2 logs is a thin sample → null, never a failing score
  assert.equal(moodScore([mood(d, 5), mood(d, 5)], KEYS, SCORING), null);
  assert.equal(moodScore([], KEYS, SCORING), null);
});

test('moodScore rejects NaN/non-finite valence (cloud docs can carry NaN; range checks alone would admit it)', () => {
  const d = KEYS[KEYS.length - 1];
  // A NaN valence among valid logs must be filtered, not poison the mean.
  const withNaN = [mood(d, 4), mood(d, 4), mood(d, 4), { ...mood(d, 4), valence: NaN }];
  assert.equal(moodScore(withNaN, KEYS, SCORING), 75);
  // All-NaN → below minLogs → null (never NaN, never a throw downstream).
  const allNaN = [{ ...mood(d, 4), valence: NaN }, { ...mood(d, 4), valence: Infinity }];
  assert.equal(moodScore(allNaN, KEYS, SCORING), null);
});

test('moodScore reads the `at` stamp only and respects the window', () => {
  const d = KEYS[KEYS.length - 1];
  // out-of-window logs never count toward minLogs
  const old = { at: Date.parse('2000-01-01T12:00:00'), valence: 5 };
  assert.equal(moodScore([mood(d, 5), mood(d, 5), old, old, old], KEYS, SCORING), null);
  // takenAt is the WRONG field for mood (ADR-0008) — must be ignored
  const wrongField = { takenAt: msAtLocalNoon(d), valence: 5 };
  assert.equal(moodScore([wrongField, wrongField, wrongField], KEYS, SCORING), null);
  // invalid valences ignored
  assert.equal(moodScore([mood(d, 0), mood(d, 6), { at: msAtLocalNoon(d) }], KEYS, SCORING), null);
});

// ── mindfulnessScore ─────────────────────────────────────────────────────────
test('isMindfulSession detects BOTH paths (mindful tag OR Meditation-named timer)', () => {
  assert.equal(isMindfulSession({ type: 'mindful', tags: ['mindful'] }), true);
  assert.equal(isMindfulSession({ type: 'timer', programName: 'Meditation 5 min' }), true);
  assert.equal(isMindfulSession({ type: 'timer', programName: 'Timer' }), false);
  assert.equal(isMindfulSession({ type: 'cooking', programName: 'Meditation 5 min' }), false);
  assert.equal(isMindfulSession({ type: 'flow', tags: ['deep'] }), false);
  assert.equal(isMindfulSession(null), false);
});

test('mindfulnessScore counts both paths; 0 when unmindful; null when history empty in window', () => {
  const d = KEYS[KEYS.length - 1];
  const tagged = (k) => session(k, { type: 'mindful', tags: ['mindful'], duration: 0 });
  const meditation = (k) => session(k, { type: 'timer', programName: 'Meditation 10 min', duration: 600000 });
  // 2 tagged + 2 meditation timers = 4 of target 4 → 100
  assert.equal(
    mindfulnessScore([tagged(KEYS[0]), tagged(KEYS[5]), meditation(KEYS[9]), meditation(d)], KEYS, SCORING),
    100,
  );
  // 1 of 4 → 25 (other sessions present, so the store is read)
  assert.equal(mindfulnessScore([tagged(d), session(d, { type: 'flow', duration: 1 })], KEYS, SCORING), 25);
  // cap at 100
  assert.equal(mindfulnessScore(KEYS.map((k) => tagged(k)), KEYS, SCORING), 100);
  // sessions in window but none mindful → a real 0
  assert.equal(mindfulnessScore([session(d, { type: 'flow', duration: 1 })], KEYS, SCORING), 0);
  // history empty in window → null (unread, not failing)
  assert.equal(mindfulnessScore([], KEYS, SCORING), null);
  assert.equal(mindfulnessScore([session('2000-01-01', { type: 'mindful', tags: ['mindful'] })], KEYS, SCORING), null);
});

// ── bfrbScore ────────────────────────────────────────────────────────────────
test('bfrbScore bands the last-7d/prior-7d trend ratio; quiet stream → 85; empty → null', () => {
  const prior10 = catches(PRIOR7.slice(0, 5), 2); // 10 catches in the prior week
  // improving: 7/10 = 0.7 → 90 (inclusive edge)
  assert.equal(bfrbScore([...prior10, ...catches(LAST7, 1)], KEYS, SCORING), 90);
  // steady: 11/10 = 1.1 → 70
  assert.equal(bfrbScore([...prior10, ...catches(LAST7, 1), ...catches(LAST7.slice(0, 4), 1)], KEYS, SCORING), 70);
  // rising: 16/10 = 1.6 → 50 (inclusive edge)
  assert.equal(bfrbScore([...prior10, ...catches(LAST7.slice(0, 4), 4)], KEYS, SCORING), 50);
  // clustered: 17/10 = 1.7 → 30
  assert.equal(bfrbScore([...prior10, ...catches(LAST7.slice(0, 4), 4), catchAt(LAST7[6])], KEYS, SCORING), 30);
  // quiet stream: <5 catches across the window is GOOD (85), not unread
  assert.equal(bfrbScore(catches(LAST7.slice(0, 4), 1), KEYS, SCORING), 85);
  // empty prior week with a non-quiet last week → unbounded ratio → 30
  assert.equal(bfrbScore(catches(LAST7.slice(0, 6), 1), KEYS, SCORING), 30);
  // truly empty stream → null
  assert.equal(bfrbScore([], KEYS, SCORING), null);
});

test('bfrbScore reads the `takenAt` stamp only (never mood\'s `at`)', () => {
  const wrong = LAST7.map((k) => ({ at: msAtLocalNoon(k), deviceId: 'd' }));
  assert.equal(bfrbScore(wrong, KEYS, SCORING), null);
});

// ── focusScore ───────────────────────────────────────────────────────────────
test('focusScore sums flow+pomodoro minutes vs target; caps; null when history empty in window', () => {
  const flow = (k, mins) => session(k, { type: 'flow', duration: mins * 60000 });
  const pomo = (k, mins) => session(k, { type: 'pomodoro', duration: mins * 60000 });
  // 600 of 600 minutes → 100
  assert.equal(focusScore(KEYS.slice(0, 10).map((k) => flow(k, 60)), KEYS, SCORING), 100);
  // 300 minutes (mixed engines) → 50
  assert.equal(focusScore([flow(KEYS[0], 150), pomo(KEYS[1], 150)], KEYS, SCORING), 50);
  // over target caps at 100
  assert.equal(focusScore(KEYS.map((k) => flow(k, 120)), KEYS, SCORING), 100);
  // sessions in window but no focus engines → a real 0
  assert.equal(focusScore([session(KEYS[0], { type: 'timer', duration: 60000 })], KEYS, SCORING), 0);
  // history empty in window → null
  assert.equal(focusScore([], KEYS, SCORING), null);
  assert.equal(focusScore([flow('2000-01-01', 60)], KEYS, SCORING), null);
});

// ── stressScore (the borrowed-record read) ───────────────────────────────────
test('stressScore means the physicals record recovery+sleep Areas, null-tolerant', () => {
  const rec = (recovery, sleep) => ({
    areas: [
      { key: 'recovery', score: recovery },
      { key: 'sleep', score: sleep },
      { key: 'meds', score: 100 }, // other Areas never leak in
    ],
  });
  assert.equal(stressScore(rec(80, 60)), 70);
  assert.equal(stressScore(rec(80, null)), 80); // null-tolerant: one Area carries it
  assert.equal(stressScore(rec(null, null)), null); // both null → null
  assert.equal(stressScore(null), null); // record absent → null
  assert.equal(stressScore({ state: { score: 50 } }), null); // no areas[] → null
});

// ── reflection (thin Tier-3) ─────────────────────────────────────────────────
test('reflectionForWeek accepts current week, falls back to prior week, ignores stale/invalid', () => {
  assert.deepEqual(
    reflectionForWeek({ '2026-W24': { rating: 4, note: 'ok' } }, NOW),
    { weekKey: '2026-W24', rating: 4, note: 'ok' },
  );
  // Monday ritual may key by the week it reviews → prior week accepted
  assert.equal(reflectionForWeek({ '2026-W23': { rating: 2 } }, NOW).rating, 2);
  // current week wins over prior when both exist
  assert.equal(
    reflectionForWeek({ '2026-W23': { rating: 2 }, '2026-W24': { rating: 5 } }, NOW).rating,
    5,
  );
  assert.equal(reflectionForWeek({ '2026-W01': { rating: 4 } }, NOW), null); // stale
  assert.equal(reflectionForWeek({ '2026-W24': { rating: 9 } }, NOW), null); // invalid rating
  assert.equal(reflectionForWeek(null, NOW), null);
});

// ── buildChickensRecord (the gate substance) ─────────────────────────────────
function fullInputs() {
  return {
    moodEvents: KEYS.map((k) => mood(k, 4)), // mean 4 → 75
    bfrbEvents: [catchAt(PRIOR7[1]), catchAt(PRIOR7[4]), catchAt(LAST7[2])], // quiet → 85
    history: [
      ...KEYS.slice(0, 4).map((k) => session(k, { type: 'mindful', tags: ['mindful'], duration: 0 })), // 4 → 100
      ...KEYS.slice(4).map((k) => session(k, { type: 'flow', duration: 60 * 60000 })), // 600 min → 100
    ],
    restLog: [],
    physicalsRecord: { areas: [{ key: 'recovery', score: 90 }, { key: 'sleep', score: 100 }] }, // 95
    reflection: null,
    scoring: SCORING,
    balanceConfig: BALANCE_CFG,
    mode: 'weekly',
    producer: 'council/chickens',
    nowMs: NOW,
  };
}

test('buildChickensRecord composites via the Balance engine weighted mean', () => {
  const rec = buildChickensRecord(fullInputs());
  // mood 75*.30 + bfrb 85*.25 + mindful 100*.20 + focus 100*.15 + stress 95*.10 = 88.25 → 88
  assert.equal(rec.state.score, 88);
  assert.equal(rec.state.band, 'thriving');
  assert.equal(rec.node, 'chickens');
  assert.equal(rec.contractVersion, 1);
  assert.equal(rec.provenance.coverage, 1);
  assert.equal(rec.confidence, 'high');
  assert.deepEqual(
    rec.provenance.sources,
    ['mood_events', 'history', 'bfrb_events', 'synthesis/physicals'],
  );
});

test('buildChickensRecord produces a contract-VALID record', () => {
  const rec = buildChickensRecord(fullInputs());
  const { valid, errors } = validateSynthesisRecord(rec);
  assert.equal(valid, true, errors.join('; '));
});

test('buildChickensRecord stamps the additive balance{} (cross-runtime obligation)', () => {
  const rec = buildChickensRecord(fullInputs());
  assert.ok(rec.balance, 'balance stamp present');
  assert.equal(rec.balance.importance, 5);
  // score 88 >= target 75 → shortfall 0 → neglect 0 → priority 0
  assert.equal(rec.balance.neglect, 0);
  assert.equal(rec.balance.priority, 0);
});

test('buildChickensRecord emits 5 areas[] in order with band/signal', () => {
  const rec = buildChickensRecord(fullInputs());
  assert.equal(rec.areas.length, 5);
  assert.deepEqual(rec.areas.map((a) => a.key), AREA_KEYS);
  for (const a of rec.areas) {
    assert.ok(typeof a.label === 'string' && a.label.length > 0);
    assert.ok(typeof a.signal === 'string' && a.signal.length > 0);
    assert.ok(['thriving', 'steady', 'strained', 'depleted', 'unknown'].includes(a.band));
  }
  assert.ok(rec.signals.length <= 5);
});

test('null Areas drop out of the composite (weights renormalize)', () => {
  const d = KEYS[KEYS.length - 1];
  const rec = buildChickensRecord({
    moodEvents: [mood(d, 4), mood(d, 4), mood(d, 4)], // mood 75, everything else unread
    bfrbEvents: [], history: [], restLog: [], physicalsRecord: null,
    scoring: SCORING, balanceConfig: BALANCE_CFG, mode: 'weekly', nowMs: NOW,
  });
  // only mood present (75) → composite = round(75*.30/.30) = 75
  assert.equal(rec.state.score, 75);
  for (const key of ['mindfulness', 'bfrb', 'focus', 'stress']) {
    assert.equal(rec.areas.find((a) => a.key === key).score, null);
  }
  assert.equal(rec.provenance.coverage, 0.2); // 1 of 5
  assert.equal(rec.confidence, 'low');
  assert.deepEqual(rec.provenance.sources, ['mood_events']);
});

test('all-null inputs → null score, unknown band, valid empty-state record', () => {
  const rec = buildChickensRecord({
    moodEvents: [], bfrbEvents: [], history: [], restLog: [], physicalsRecord: null,
    scoring: SCORING, balanceConfig: BALANCE_CFG, mode: 'weekly', nowMs: NOW,
  });
  assert.equal(rec.state.score, null);
  assert.equal(rec.state.band, 'unknown');
  assert.equal(rec.provenance.coverage, 0);
  assert.deepEqual(rec.provenance.sources, ['none']);
  assert.equal(rec.headline, 'Not enough data to read Chickens yet.');
  assert.equal(validateSynthesisRecord(rec).valid, true);
  assert.equal(rec.balance.neglect, 0); // null score → no shortfall
});

test('a zero/missing-weight Area is excluded from BOTH composite and coverage (no high-confidence no-data)', () => {
  const d = KEYS[KEYS.length - 1];
  // mood present (75) but its weight is mis-set to 0; all other Areas null.
  const scoring = { ...SCORING, weights: { ...SCORING.weights, mood: 0 } };
  const rec = buildChickensRecord({
    moodEvents: [mood(d, 4), mood(d, 4), mood(d, 4)],
    bfrbEvents: [], history: [], restLog: [], physicalsRecord: null,
    scoring, balanceConfig: BALANCE_CFG, mode: 'weekly', nowMs: NOW,
  });
  assert.equal(rec.state.score, null); // mood dropped (weight 0), rest null
  assert.equal(rec.state.band, 'unknown');
  assert.equal(rec.provenance.coverage, 0); // consistent — nothing fed the score
  assert.equal(rec.confidence, 'low');
  // but the hub still SHOWS mood's sub-score (display unaffected by weighting)
  assert.equal(rec.areas.find((a) => a.key === 'mood').score, 75);
});

test('low Areas produce neglect>0 + weekly nudges; daily mode → no nudges', () => {
  const lowInputs = {
    moodEvents: KEYS.slice(0, 3).map((k) => mood(k, 1)), // mood 0
    bfrbEvents: [...catches(PRIOR7.slice(0, 5), 2), ...catches(LAST7, 3)], // 21/10 → 30
    history: [session(KEYS[0], { type: 'flow', duration: 60 * 60000 })], // focus 10, mindfulness 0
    restLog: [],
    physicalsRecord: { areas: [{ key: 'recovery', score: 30 }, { key: 'sleep', score: 20 }] }, // 25
    scoring: SCORING, balanceConfig: BALANCE_CFG, nowMs: NOW,
  };
  const weekly = buildChickensRecord({ ...lowInputs, mode: 'weekly' });
  assert.ok(weekly.state.score < 75, 'below target');
  assert.ok(weekly.balance.neglect > 0, 'neglect accrues');
  assert.ok(weekly.balance.priority > 0, 'priority = importance*neglect');
  assert.ok(weekly.nudges.length >= 1 && weekly.nudges.length <= 2, 'weekly carries 1..2 moves');
  for (const n of weekly.nudges) {
    assert.ok(typeof n.text === 'string' && n.text.length > 0);
    assert.ok(Number.isInteger(n.priority) && n.priority >= 1);
  }
  const daily = buildChickensRecord({ ...lowInputs, mode: 'daily' });
  assert.deepEqual(daily.nudges, []);
});

test('reflection folds into confidence/headline ONLY — never a scored Area', () => {
  const d = KEYS[KEYS.length - 1];
  const base = {
    moodEvents: [mood(d, 4), mood(d, 4), mood(d, 4)], // coverage 0.2 → confidence low
    bfrbEvents: [], history: [], restLog: [], physicalsRecord: null,
    scoring: SCORING, balanceConfig: BALANCE_CFG, mode: 'weekly', nowMs: NOW,
  };
  const without = buildChickensRecord(base);
  const withRef = buildChickensRecord({ ...base, reflection: { '2026-W24': { rating: 4, note: 'ok' } } });
  // confidence bumped one step (low → medium); headline carries the mention
  assert.equal(without.confidence, 'low');
  assert.equal(withRef.confidence, 'medium');
  assert.ok(withRef.headline.includes('Weekly reflection 4/5'));
  assert.ok(withRef.headline.length <= 140);
  assert.ok(withRef.provenance.sources.includes('reflection'));
  // NOT a scored Area: same 5 areas, same composite, same coverage
  assert.equal(withRef.areas.length, 5);
  assert.equal(withRef.state.score, without.state.score);
  assert.equal(withRef.provenance.coverage, without.provenance.coverage);
  assert.equal(validateSynthesisRecord(withRef).valid, true);
  // a stale-week reflection is ignored entirely
  const stale = buildChickensRecord({ ...base, reflection: { '2026-W01': { rating: 4 } } });
  assert.equal(stale.confidence, 'low');
  assert.ok(!stale.provenance.sources.includes('reflection'));
});

test('window string spans the 14-day local-date range', () => {
  const rec = buildChickensRecord(fullInputs());
  assert.equal(rec.window, `${KEYS[0]}..${KEYS[KEYS.length - 1]}`);
  assert.equal(KEYS[KEYS.length - 1], dateKeyLocal(NOW));
});
