// Tests for PhysicalsUI — the Life-OS Physicals hub (Phase 2). We exercise ONLY
// the pure helpers on PhysicalsUI._internals (titleCase, bandForScore, bandLabel,
// bandColorVar, areaCardModel, areaModelsFrom, heroModel). Those touch no DOM, so
// no #physicals-pillar-body container is needed. render() is a thin DOM wrapper
// around _buildHtml() and is covered by Playwright, not this suite.

// NB: a UNIQUE top-level name — tests/index.html loads every *.test.js into one
// shared global scope, so a generic `const P` could collide with another file's
// top-level const (a parse-time redeclaration silently discards this whole
// file). Keep this identifier file-unique.
const PXUI = PhysicalsUI._internals;

describe('PhysicalsUI.titleCase', () => {
  it('title-cases keys, splitting on _ and /', () => {
    assertEqual(PXUI.titleCase('training'), 'Training');
    assertEqual(PXUI.titleCase('training_load'), 'Training Load');
    assertEqual(PXUI.titleCase('physicals/sleep'), 'Physicals Sleep');
  });
  it("returns '' for empty / non-string", () => {
    assertEqual(PXUI.titleCase(''), '');
    assertEqual(PXUI.titleCase(null), '');
    assertEqual(PXUI.titleCase(undefined), '');
  });
});

describe('PhysicalsUI.bandForScore', () => {
  it('buckets scores per the frozen contract bands', () => {
    assertEqual(PXUI.bandForScore(95), 'thriving');
    assertEqual(PXUI.bandForScore(80), 'thriving');
    assertEqual(PXUI.bandForScore(60), 'steady');
    assertEqual(PXUI.bandForScore(40), 'strained');
    assertEqual(PXUI.bandForScore(0), 'depleted');
  });
  it('returns unknown for null / non-numeric', () => {
    assertEqual(PXUI.bandForScore(null), 'unknown');
    assertEqual(PXUI.bandForScore(undefined), 'unknown');
    assertEqual(PXUI.bandForScore('72'), 'unknown');
  });
});

describe('PhysicalsUI.bandLabel', () => {
  it('maps each band to a display label', () => {
    assertEqual(PXUI.bandLabel('thriving'), 'Thriving');
    assertEqual(PXUI.bandLabel('steady'), 'Steady');
    assertEqual(PXUI.bandLabel('strained'), 'Strained');
    assertEqual(PXUI.bandLabel('depleted'), 'Depleted');
    assertEqual(PXUI.bandLabel('whatever'), 'Unknown');
  });
});

describe('PhysicalsUI.bandColorVar', () => {
  it('reuses the Home hub band tokens', () => {
    assertEqual(PXUI.bandColorVar('thriving'), 'var(--home-band-thriving)');
    assertEqual(PXUI.bandColorVar('depleted'), 'var(--home-band-depleted)');
    assertEqual(PXUI.bandColorVar(null), 'var(--home-band-unknown)');
  });
});

describe('PhysicalsUI.areaCardModel', () => {
  it('shapes a full area entry', () => {
    const m = PXUI.areaCardModel({ key: 'recovery', label: 'Recovery', score: 90, band: 'thriving', signal: 'On track' });
    assertEqual(m.key, 'recovery');
    assertEqual(m.label, 'Recovery');
    assertEqual(m.score, 90);
    assertEqual(m.band, 'thriving');
    assertEqual(m.signal, 'On track');
    assertEqual(m.hasData, true);
  });
  it('derives band from score + falls back to label when missing', () => {
    const m = PXUI.areaCardModel({ key: 'meds', score: 45 });
    assertEqual(m.label, 'Meds'); // from AREA_LABELS
    assertEqual(m.band, 'strained'); // derived from 45
  });
  it('flags hasData:false for a null score', () => {
    const m = PXUI.areaCardModel({ key: 'sleep', score: null });
    assertEqual(m.hasData, false);
    assertEqual(m.score, null);
    assertEqual(m.band, 'unknown');
    assertEqual(m.label, 'Sleep');
  });
  it('returns null for garbage', () => {
    assertEqual(PXUI.areaCardModel(null), null);
    assertEqual(PXUI.areaCardModel('nope'), null);
  });
});

describe('PhysicalsUI.areaModelsFrom', () => {
  it('maps a record’s areas[] into card models', () => {
    const rec = { areas: [
      { key: 'recovery', score: 90, band: 'thriving' },
      { key: 'sleep', score: null },
    ] };
    const models = PXUI.areaModelsFrom(rec);
    assertEqual(models.length, 2);
    assertEqual(models[0].key, 'recovery');
    assertEqual(models[1].hasData, false);
  });
  it('returns [] when areas is missing / not an array / record null', () => {
    assertArrayEqual(PXUI.areaModelsFrom({}), []);
    assertArrayEqual(PXUI.areaModelsFrom({ areas: 'nope' }), []);
    assertArrayEqual(PXUI.areaModelsFrom(null), []);
  });
});

describe('PhysicalsUI.heroModel', () => {
  it('reads composite score/band/headline from the record', () => {
    const rec = { state: { score: 72, band: 'steady' }, headline: 'Physicals steady overall.' };
    const h = PXUI.heroModel(rec);
    assertEqual(h.hasData, true);
    assertEqual(h.score, 72);
    assertEqual(h.band, 'steady');
    assertEqual(h.headline, 'Physicals steady overall.');
  });
  it('derives band from score when state.band absent', () => {
    const h = PXUI.heroModel({ state: { score: 88 }, headline: '' });
    assertEqual(h.band, 'thriving');
  });
  it('handles a null score (unknown band) and a null record', () => {
    const h = PXUI.heroModel({ state: { score: null } });
    assertEqual(h.score, null);
    assertEqual(h.band, 'unknown');
    const none = PXUI.heroModel(null);
    assertEqual(none.hasData, false);
    assertEqual(none.band, 'unknown');
  });
});
