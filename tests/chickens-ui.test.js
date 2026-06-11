// Tests for ChickensUI — the Life-OS Chickens hub (Phase 3). We exercise ONLY
// the pure helpers on ChickensUI._internals (titleCase, bandForScore, bandLabel,
// bandColorVar, areaCardModel, areaModelsFrom, heroModel). Those touch no DOM, so
// no #chickens-pillar-body container is needed. render() is a thin DOM wrapper
// around _buildHtml() and is covered by Playwright, not this suite.

// NB: a UNIQUE top-level name — tests/index.html loads every *.test.js into one
// shared global scope, so a generic `const P` could collide with another file's
// top-level const (a parse-time redeclaration silently discards this whole
// file). Keep this identifier file-unique.
const CKUI = ChickensUI._internals;

describe('ChickensUI.titleCase', () => {
  it('title-cases keys, splitting on _ and /', () => {
    assertEqual(CKUI.titleCase('mood'), 'Mood');
    assertEqual(CKUI.titleCase('stress_load'), 'Stress Load');
    assertEqual(CKUI.titleCase('chickens/mood'), 'Chickens Mood');
  });
  it("returns '' for empty / non-string", () => {
    assertEqual(CKUI.titleCase(''), '');
    assertEqual(CKUI.titleCase(null), '');
    assertEqual(CKUI.titleCase(undefined), '');
  });
});

describe('ChickensUI.bandForScore', () => {
  it('buckets scores per the frozen contract bands', () => {
    assertEqual(CKUI.bandForScore(95), 'thriving');
    assertEqual(CKUI.bandForScore(80), 'thriving');
    assertEqual(CKUI.bandForScore(60), 'steady');
    assertEqual(CKUI.bandForScore(40), 'strained');
    assertEqual(CKUI.bandForScore(0), 'depleted');
  });
  it('returns unknown for null / non-numeric', () => {
    assertEqual(CKUI.bandForScore(null), 'unknown');
    assertEqual(CKUI.bandForScore(undefined), 'unknown');
    assertEqual(CKUI.bandForScore('72'), 'unknown');
  });
});

describe('ChickensUI.bandLabel', () => {
  it('maps each band to a display label', () => {
    assertEqual(CKUI.bandLabel('thriving'), 'Thriving');
    assertEqual(CKUI.bandLabel('steady'), 'Steady');
    assertEqual(CKUI.bandLabel('strained'), 'Strained');
    assertEqual(CKUI.bandLabel('depleted'), 'Depleted');
    assertEqual(CKUI.bandLabel('whatever'), 'Unknown');
  });
});

describe('ChickensUI.bandColorVar', () => {
  it('reuses the Home hub band tokens', () => {
    assertEqual(CKUI.bandColorVar('thriving'), 'var(--home-band-thriving)');
    assertEqual(CKUI.bandColorVar('depleted'), 'var(--home-band-depleted)');
    assertEqual(CKUI.bandColorVar(null), 'var(--home-band-unknown)');
  });
});

describe('ChickensUI.areaCardModel', () => {
  it('shapes a full area entry', () => {
    const m = CKUI.areaCardModel({ key: 'mood', label: 'Mood', score: 90, band: 'thriving', signal: 'Mean valence ran high this week' });
    assertEqual(m.key, 'mood');
    assertEqual(m.label, 'Mood');
    assertEqual(m.score, 90);
    assertEqual(m.band, 'thriving');
    assertEqual(m.signal, 'Mean valence ran high this week');
    assertEqual(m.hasData, true);
  });
  it('derives band from score + falls back to label when missing', () => {
    const m = CKUI.areaCardModel({ key: 'mood', score: 45 });
    assertEqual(m.label, 'Mood'); // from AREA_LABELS
    assertEqual(m.band, 'strained'); // derived from 45
  });
  it('maps every Chickens area key to its display label', () => {
    assertEqual(CKUI.AREA_LABELS.mood, 'Mood');
    assertEqual(CKUI.AREA_LABELS.mindfulness, 'Mindfulness');
    assertEqual(CKUI.AREA_LABELS.bfrb, 'BFRB regulation');
    assertEqual(CKUI.AREA_LABELS.focus, 'Focus engagement');
    assertEqual(CKUI.AREA_LABELS.stress, 'Stress load');
  });
  it('flags hasData:false for a null score', () => {
    const m = CKUI.areaCardModel({ key: 'mindfulness', score: null });
    assertEqual(m.hasData, false);
    assertEqual(m.score, null);
    assertEqual(m.band, 'unknown');
    assertEqual(m.label, 'Mindfulness');
  });
  it('returns null for garbage', () => {
    assertEqual(CKUI.areaCardModel(null), null);
    assertEqual(CKUI.areaCardModel('nope'), null);
  });
});

describe('ChickensUI.areaModelsFrom', () => {
  it('maps a record’s areas[] into card models', () => {
    const rec = { areas: [
      { key: 'mood', score: 90, band: 'thriving' },
      { key: 'stress', score: null },
    ] };
    const models = CKUI.areaModelsFrom(rec);
    assertEqual(models.length, 2);
    assertEqual(models[0].key, 'mood');
    assertEqual(models[1].hasData, false);
  });
  it('returns [] when areas is missing / not an array / record null', () => {
    assertArrayEqual(CKUI.areaModelsFrom({}), []);
    assertArrayEqual(CKUI.areaModelsFrom({ areas: 'nope' }), []);
    assertArrayEqual(CKUI.areaModelsFrom(null), []);
  });
});

describe('ChickensUI.heroModel', () => {
  it('reads composite score/band/headline from the record', () => {
    const rec = { state: { score: 72, band: 'steady' }, headline: 'Chickens steady overall.' };
    const h = CKUI.heroModel(rec);
    assertEqual(h.hasData, true);
    assertEqual(h.score, 72);
    assertEqual(h.band, 'steady');
    assertEqual(h.headline, 'Chickens steady overall.');
  });
  it('derives band from score when state.band absent', () => {
    const h = CKUI.heroModel({ state: { score: 88 }, headline: '' });
    assertEqual(h.band, 'thriving');
  });
  it('handles a null score (unknown band) and a null record', () => {
    const h = CKUI.heroModel({ state: { score: null } });
    assertEqual(h.score, null);
    assertEqual(h.band, 'unknown');
    const none = CKUI.heroModel(null);
    assertEqual(none.hasData, false);
    assertEqual(none.band, 'unknown');
  });
});

describe('ChickensUI.moodDelta (display-only 7d-vs-prior-7d trend)', () => {
  const DAY = 86400000;
  const NOW = 1760000000000;
  const ev = (daysAgo, valence) => ({ at: NOW - daysAgo * DAY, valence });

  it('computes delta + dir + text when both windows have ≥3 logs', () => {
    const events = [
      ev(1, 4), ev(2, 4), ev(3, 4),          // last 7d mean 4.0
      ev(8, 3), ev(9, 3), ev(10, 4),         // prior 7d mean 3.33
    ];
    const d = CKUI.moodDelta(events, NOW);
    assertEqual(d.delta, 0.7);
    assertEqual(d.dir, 'up');
    assertEqual(d.text, '▲ +0.7 vs prior 7d');
  });
  it('downward trend renders ▼ with the signed value', () => {
    const events = [
      ev(1, 2), ev(2, 2), ev(3, 2),          // last mean 2.0
      ev(8, 4), ev(9, 4), ev(10, 4),         // prior mean 4.0
    ];
    const d = CKUI.moodDelta(events, NOW);
    assertEqual(d.delta, -2);
    assertEqual(d.dir, 'down');
    assertEqual(d.text, '▼ -2.0 vs prior 7d');
  });
  it('near-zero delta reads as steady (flat)', () => {
    const events = [
      ev(1, 3), ev(2, 3), ev(3, 3),
      ev(8, 3), ev(9, 3), ev(10, 3),
    ];
    const d = CKUI.moodDelta(events, NOW);
    assertEqual(d.dir, 'flat');
    assertEqual(d.text, 'steady vs prior 7d');
  });
  it('thin sample in EITHER window → null (never a fake trend)', () => {
    const thinPrior = [ev(1, 4), ev(2, 4), ev(3, 4), ev(8, 3), ev(9, 3)];
    assertEqual(CKUI.moodDelta(thinPrior, NOW), null);
    const thinLast = [ev(1, 4), ev(2, 4), ev(8, 3), ev(9, 3), ev(10, 3)];
    assertEqual(CKUI.moodDelta(thinLast, NOW), null);
    assertEqual(CKUI.moodDelta([], NOW), null);
    assertEqual(CKUI.moodDelta(null, NOW), null);
  });
  it('filters invalid events (bad at / out-of-range or NaN valence / future)', () => {
    const events = [
      ev(1, 4), ev(2, 4), ev(3, 4),
      ev(8, 3), ev(9, 3), ev(10, 3),
      { at: 'nope', valence: 5 }, { at: NOW - DAY, valence: 9 },
      { at: NOW - DAY, valence: NaN }, ev(-2, 1), null,
    ];
    const d = CKUI.moodDelta(events, NOW);
    assertEqual(d.delta, 1);
    assertEqual(d.dir, 'up');
  });
});
