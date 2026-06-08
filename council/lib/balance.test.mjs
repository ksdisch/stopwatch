// node --test suite for the Balance engine (ADR-0004).
// Run: cd council && node --test lib/balance.test.mjs   (or: npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clamp,
  shortfall,
  neglect,
  priority,
  bandForScore,
  rankPillars,
  balanceScore,
  coverage,
  DEFAULT_IMPORTANCE,
  DEFAULT_TARGET,
} from './balance.mjs';

// ── clamp ────────────────────────────────────────────────────────────────────
test('clamp constrains to the inclusive range', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
  assert.equal(clamp(0, 0, 10), 0);
  assert.equal(clamp(10, 0, 10), 10);
});

// ── shortfall ──────────────────────────────────────────────────────────────--
test('shortfall is (target - score) / target, clamped 0..1', () => {
  assert.equal(shortfall(50, 100), 0.5);
  assert.equal(shortfall(70, 70), 0); // at target
  assert.equal(shortfall(90, 70), 0); // above target → clamped to 0
  assert.equal(shortfall(0, 70), 1); // floor at target → 1
});

test('shortfall is 0 when score is null', () => {
  assert.equal(shortfall(null, 70), 0);
});

test('shortfall is 0 when target is 0 (no yardstick)', () => {
  assert.equal(shortfall(50, 0), 0);
});

// ── neglect ────────────────────────────────────────────────────────────────--
test('neglect (snapshot, no prior) equals shortfall', () => {
  assert.equal(neglect({ score: 35, target: 70 }), shortfall(35, 70));
  assert.equal(neglect({ score: 35, target: 70 }), 0.5);
});

test('neglect decays prior and adds shortfall, clamped 0..1', () => {
  // decay 0.5 * priorNeglect 0.4 = 0.2 ; shortfall(56,70)=0.2 ; sum 0.4
  assert.equal(neglect({ score: 56, target: 70, priorNeglect: 0.4, decay: 0.5 }), 0.4);
});

test('neglect with null score only decays the prior (no new shortfall)', () => {
  assert.equal(neglect({ score: null, target: 70, priorNeglect: 0.8, decay: 0.5 }), 0.4);
  assert.equal(neglect({ score: null, target: 70 }), 0); // default prior 0
});

test('neglect clamps the accumulation to 1', () => {
  assert.equal(neglect({ score: 0, target: 70, priorNeglect: 1, decay: 0.5 }), 1);
});

// ── priority ───────────────────────────────────────────────────────────────--
test('priority is importance * neglect', () => {
  assert.equal(priority(5, 0.5), 2.5);
  assert.equal(priority(3, 0), 0);
  assert.equal(priority(5, 1), 5);
});

// ── bandForScore (boundary coverage) ─────────────────────────────────────────
test('bandForScore null → unknown', () => {
  assert.equal(bandForScore(null), 'unknown');
});

test('bandForScore band boundaries 39/40/59/60/79/80', () => {
  assert.equal(bandForScore(0), 'depleted');
  assert.equal(bandForScore(39), 'depleted');
  assert.equal(bandForScore(40), 'strained');
  assert.equal(bandForScore(59), 'strained');
  assert.equal(bandForScore(60), 'steady');
  assert.equal(bandForScore(79), 'steady');
  assert.equal(bandForScore(80), 'thriving');
  assert.equal(bandForScore(100), 'thriving');
});

// ── rankPillars ──────────────────────────────────────────────────────────────
function rec(node, score) {
  return { node, state: { band: bandForScore(score), score } };
}

const CONFIG = {
  physicals: { importance: 5, target: 75 },
  chickens: { importance: 5, target: 75 },
  life_building: { importance: 4, target: 70 },
  relationships: { importance: 4, target: 70 },
  growth: { importance: 3, target: 70 },
};

test('rankPillars sorts by priority desc', () => {
  const ranked = rankPillars(
    [rec('growth', 73), rec('relationships', 34), rec('physicals', 45)],
    CONFIG,
  );
  // relationships: imp4 * shortfall(34,70)=0.514... = ~2.057 (highest)
  // physicals:     imp5 * shortfall(45,75)=0.4 = 2.0
  // growth:        imp3 * shortfall(73,70)=0 = 0
  assert.equal(ranked[0].node, 'relationships');
  assert.equal(ranked[1].node, 'physicals');
  assert.equal(ranked[2].node, 'growth');
  // priority is monotonically non-increasing.
  assert.ok(ranked[0].priority >= ranked[1].priority);
  assert.ok(ranked[1].priority >= ranked[2].priority);
});

test('rankPillars carries through node/score/band/importance/neglect/priority', () => {
  const [top] = rankPillars([rec('physicals', 45)], CONFIG);
  assert.equal(top.node, 'physicals');
  assert.equal(top.score, 45);
  assert.equal(top.band, 'strained');
  assert.equal(top.importance, 5);
  assert.equal(top.neglect, shortfall(45, 75));
  assert.equal(top.priority, 5 * shortfall(45, 75));
});

test('rankPillars defaults importance/target for pillars missing from config', () => {
  const [only] = rankPillars([rec('mystery', 35)], {});
  assert.equal(only.importance, DEFAULT_IMPORTANCE);
  // neglect uses DEFAULT_TARGET 70 → shortfall(35,70)=0.5
  assert.equal(only.neglect, shortfall(35, DEFAULT_TARGET));
  assert.equal(only.priority, DEFAULT_IMPORTANCE * shortfall(35, DEFAULT_TARGET));
});

test('rankPillars tiebreak: equal priority → lower score first, then node asc', () => {
  // Two pillars contrived to the SAME priority but different scores.
  // a: importance 2, target 100, score 60 → shortfall 0.4 → priority 0.8
  // b: importance 4, target 100, score 80 → shortfall 0.2 → priority 0.8
  const cfg = { a: { importance: 2, target: 100 }, b: { importance: 4, target: 100 } };
  const ranked = rankPillars([rec('b', 80), rec('a', 60)], cfg);
  assert.equal(ranked[0].priority, ranked[1].priority);
  // lower score (a, 60) sorts before higher score (b, 80).
  assert.equal(ranked[0].node, 'a');
  assert.equal(ranked[1].node, 'b');
});

test('rankPillars tiebreak: equal priority AND equal score → node name asc', () => {
  // Both priority 0 (at target) and equal score → node name decides.
  const cfg = { zeta: { importance: 3, target: 70 }, alpha: { importance: 3, target: 70 } };
  const ranked = rankPillars([rec('zeta', 70), rec('alpha', 70)], cfg);
  assert.equal(ranked[0].node, 'alpha');
  assert.equal(ranked[1].node, 'zeta');
});

test('rankPillars: a null-score pillar sorts after scored ties (priority 0)', () => {
  // null score → neglect 0 → priority 0, same as an at-target pillar; the
  // null sorts last among the zero-priority group (treated as +Infinity score).
  const cfg = { atTarget: { importance: 3, target: 70 }, noData: { importance: 3, target: 70 } };
  const ranked = rankPillars([rec('noData', null), rec('atTarget', 70)], cfg);
  assert.equal(ranked[0].node, 'atTarget');
  assert.equal(ranked[1].node, 'noData');
  assert.equal(ranked[1].band, 'unknown');
});

test('rankPillars handles empty input', () => {
  assert.deepEqual(rankPillars([], CONFIG), []);
  assert.deepEqual(rankPillars(undefined, CONFIG), []);
});

// ── balanceScore (importance-weighted mean, rounded) ─────────────────────────
test('balanceScore is the importance-weighted mean, rounded to int', () => {
  // scores 45(imp5), 68(imp5), 52(imp4), 34(imp4), 73(imp3)
  // weightedSum = 45*5+68*5+52*4+34*4+73*3 = 225+340+208+136+219 = 1128
  // weightTotal = 5+5+4+4+3 = 21 ; 1128/21 = 53.714... → 54
  const ranked = rankPillars(
    [
      rec('physicals', 45),
      rec('chickens', 68),
      rec('life_building', 52),
      rec('relationships', 34),
      rec('growth', 73),
    ],
    CONFIG,
  );
  assert.equal(balanceScore(ranked), 54);
});

test('balanceScore rounds half-up via Math.round', () => {
  // single pillar score 53.5 is impossible (scores are ints), so contrive a
  // weighted average that lands on .5: scores 50(imp1), 51(imp1) → 50.5 → 51
  const ranked = [
    { score: 50, importance: 1 },
    { score: 51, importance: 1 },
  ];
  assert.equal(balanceScore(ranked), 51);
});

test('balanceScore omits null-score pillars from the mean', () => {
  const ranked = [
    { score: 80, importance: 5 },
    { score: null, importance: 5 },
    { score: 60, importance: 5 },
  ];
  // mean of 80 and 60 (equal weight) = 70
  assert.equal(balanceScore(ranked), 70);
});

test('balanceScore is null when every pillar is null', () => {
  const ranked = [
    { score: null, importance: 5 },
    { score: null, importance: 3 },
  ];
  assert.equal(balanceScore(ranked), null);
});

test('balanceScore of empty input is null', () => {
  assert.equal(balanceScore([]), null);
});

// ── coverage ─────────────────────────────────────────────────────────────────
test('coverage is the fraction with a non-null score', () => {
  const ranked = [
    { score: 45 },
    { score: null },
    { score: 73 },
    { score: null },
  ];
  assert.equal(coverage(ranked), 0.5);
});

test('coverage is 1 when all scored, 0 when none scored or empty', () => {
  assert.equal(coverage([{ score: 10 }, { score: 20 }]), 1);
  assert.equal(coverage([{ score: null }, { score: null }]), 0);
  assert.equal(coverage([]), 0);
});
