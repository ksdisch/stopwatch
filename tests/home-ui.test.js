// Tests for HomeUI — the Life-OS Home hub (Phase 1). We exercise ONLY the
// pure helpers exposed on HomeUI._internals (titleCase, bandColorVar,
// bandForScore, lensValue, normalizeRadii, pillarCardModel). Those touch no
// DOM, so no #home-pillar-body container is needed here. render() is a thin
// DOM wrapper around _buildHtml() and is covered by Playwright, not this suite.

// NB: a UNIQUE top-level name — tests/index.html loads every *.test.js into one
// shared global scope, so a generic `const H` collides with utils.test.js's
// `const H = 60 * M` (a parse-time redeclaration that would silently discard
// this entire file). Keep this identifier file-unique.
const HUI = HomeUI._internals;

describe('HomeUI.titleCase', () => {
  it("title-cases a single-underscore node", () => {
    assertEqual(HUI.titleCase('life_building'), 'Life Building');
  });

  it("title-cases a plain word", () => {
    assertEqual(HUI.titleCase('growth'), 'Growth');
  });

  it("splits on '/' for dotted sub-node paths", () => {
    assertEqual(HUI.titleCase('physicals/sleep'), 'Physicals Sleep');
  });

  it("returns '' for empty / non-string input", () => {
    assertEqual(HUI.titleCase(''), '');
    assertEqual(HUI.titleCase(null), '');
    assertEqual(HUI.titleCase(undefined), '');
  });
});

describe('HomeUI.bandColorVar', () => {
  it('maps each band to its CSS var', () => {
    assertEqual(HUI.bandColorVar('thriving'), 'var(--home-band-thriving)');
    assertEqual(HUI.bandColorVar('steady'), 'var(--home-band-steady)');
    assertEqual(HUI.bandColorVar('strained'), 'var(--home-band-strained)');
    assertEqual(HUI.bandColorVar('depleted'), 'var(--home-band-depleted)');
    assertEqual(HUI.bandColorVar('unknown'), 'var(--home-band-unknown)');
  });

  it('falls back to the unknown var for a missing / bad band', () => {
    assertEqual(HUI.bandColorVar(null), 'var(--home-band-unknown)');
    assertEqual(HUI.bandColorVar('nonsense'), 'var(--home-band-unknown)');
    assertEqual(HUI.bandColorVar(undefined), 'var(--home-band-unknown)');
  });
});

describe('HomeUI.bandForScore', () => {
  it('buckets scores per the frozen contract bands', () => {
    assertEqual(HUI.bandForScore(95), 'thriving'); // 80+
    assertEqual(HUI.bandForScore(80), 'thriving');
    assertEqual(HUI.bandForScore(70), 'steady');   // 60-79
    assertEqual(HUI.bandForScore(60), 'steady');
    assertEqual(HUI.bandForScore(45), 'strained'); // 40-59
    assertEqual(HUI.bandForScore(40), 'strained');
    assertEqual(HUI.bandForScore(10), 'depleted'); // 0-39
    assertEqual(HUI.bandForScore(0), 'depleted');
  });

  it('returns unknown for null / non-numeric', () => {
    assertEqual(HUI.bandForScore(null), 'unknown');
    assertEqual(HUI.bandForScore(undefined), 'unknown');
    assertEqual(HUI.bandForScore('72'), 'unknown');
  });
});

describe('HomeUI.lensValue — importance lens', () => {
  it("prefers the council's balance.importance", () => {
    const rec = { state: { score: 50 }, balance: { importance: 5 } };
    assertEqual(HUI.lensValue(rec, 'importance'), 5);
  });

  it('falls back to the neutral mid (3) when no balance', () => {
    const rec = { state: { score: 50 } };
    assertEqual(HUI.lensValue(rec, 'importance'), 3);
  });

  it('falls back to 3 for a null record', () => {
    assertEqual(HUI.lensValue(null, 'importance'), 3);
  });
});

describe('HomeUI.lensValue — neglect lens', () => {
  it("prefers the council's balance.neglect", () => {
    const rec = { state: { score: 50 }, balance: { neglect: 0.42 } };
    assertEqual(HUI.lensValue(rec, 'neglect'), 0.42);
  });

  it('falls back to (100 - score) / 100 from the score', () => {
    const rec = { state: { score: 40 } };
    assertClose(HUI.lensValue(rec, 'neglect'), 0.6, 1e-9);
  });

  it('falls back to (100 - (score ?? 100)) / 100 → 0 when score is missing', () => {
    // Spec fallback: score ?? 100, so a missing score yields (100-100)/100 = 0.
    assertEqual(HUI.lensValue({ state: {} }, 'neglect'), 0);
    assertEqual(HUI.lensValue(null, 'neglect'), 0);
  });
});

describe('HomeUI.lensValue — priority lens (default)', () => {
  it("prefers the council's balance.priority", () => {
    const rec = { state: { score: 50 }, balance: { priority: 4.2 } };
    assertEqual(HUI.lensValue(rec, 'priority'), 4.2);
  });

  it('falls back to (100 - score) / 20 from the score', () => {
    const rec = { state: { score: 40 } };
    assertClose(HUI.lensValue(rec, 'priority'), 3, 1e-9);
  });

  it('falls back to the mid heuristic (2.5) when score is missing', () => {
    // (100 - 50) / 20 = 2.5
    assertClose(HUI.lensValue({ state: {} }, 'priority'), 2.5, 1e-9);
    assertClose(HUI.lensValue(null, 'priority'), 2.5, 1e-9);
  });
});

describe('HomeUI.normalizeRadii', () => {
  it('clamps the smallest value to minR and the largest to maxR', () => {
    const out = HUI.normalizeRadii([0, 5, 10], 9, 30);
    assertClose(out[0], 9, 1e-9);
    assertClose(out[2], 30, 1e-9);
    assertClose(out[1], 19.5, 1e-9); // midpoint of the span
  });

  it('maps an all-equal set to the midpoint (no collapse to minR)', () => {
    const out = HUI.normalizeRadii([3, 3, 3], 9, 30);
    out.forEach(r => assertClose(r, 19.5, 1e-9)); // (9 + 30) / 2
  });

  it('maps a single value to the midpoint', () => {
    const out = HUI.normalizeRadii([7], 9, 30);
    assertEqual(out.length, 1);
    assertClose(out[0], 19.5, 1e-9);
  });

  it('returns an empty array for an empty input', () => {
    assertArrayEqual(HUI.normalizeRadii([], 9, 30), []);
  });

  it('treats non-finite values as 0', () => {
    const out = HUI.normalizeRadii([NaN, 10], 9, 30);
    assertClose(out[0], 9, 1e-9);  // NaN → 0 → minR
    assertClose(out[1], 30, 1e-9);
  });
});

describe('HomeUI.pillarCardModel', () => {
  it('shapes a card model from a full record', () => {
    const rec = {
      state: { band: 'strained', score: 45 },
      headline: 'Physicals running below target.',
      signals: ['slept 6h', 'no training'],
    };
    const m = HUI.pillarCardModel('physicals', rec);
    assertEqual(m.node, 'physicals');
    assertEqual(m.label, 'Physicals');
    assertEqual(m.hasData, true);
    assertEqual(m.band, 'strained');
    assertEqual(m.score, 45);
    assertEqual(m.headline, 'Physicals running below target.');
    assertEqual(m.topSignal, 'slept 6h');
  });

  it('derives the band from the score when state.band is absent', () => {
    const rec = { state: { score: 88 }, headline: 'Thriving.', signals: [] };
    const m = HUI.pillarCardModel('growth', rec);
    assertEqual(m.band, 'thriving');
    assertEqual(m.topSignal, '');
  });

  it('flags hasData:false for a null record', () => {
    const m = HUI.pillarCardModel('chickens', null);
    assertEqual(m.hasData, false);
    assertEqual(m.label, 'Chickens');
    assertEqual(m.band, 'unknown');
    assertEqual(m.score, null);
    assertEqual(m.headline, '');
    assertEqual(m.topSignal, '');
  });
});

describe('HomeUI._internals — exported constants', () => {
  it('exposes the five domain-pillars in fixed bubble order', () => {
    assertArrayEqual(HUI.PILLARS, ['life_building', 'physicals', 'chickens', 'relationships', 'growth']);
  });

  it("defaults the lens set to 'priority' (Needs attention) first, three total", () => {
    assertEqual(HUI.LENSES.length, 3);
    assertEqual(HUI.LENSES[0].key, 'priority');
  });

  it('keeps a sane bubble radius range (MIN_R < MAX_R)', () => {
    assertEqual(HUI.MIN_R < HUI.MAX_R, true);
  });
});
