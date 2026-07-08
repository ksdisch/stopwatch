// Tests for LifeBuildingUI — the Life-OS Life Building hub (Phase 5). We
// exercise ONLY the pure helpers on LifeBuildingUI._internals (titleCase,
// bandForScore, bandLabel, bandColorVar, areaCardModel, areaModelsFrom,
// heroModel, isEmptyState, formPrefillFrom, serializeForm). Those touch no
// DOM, so no #life-building-pillar-body container is needed. render() and
// _buildHtml() are thin DOM wrappers covered by Playwright, not this suite.

// NB: a UNIQUE top-level name — tests/index.html loads every *.test.js into
// one shared global scope, so a generic `const P` could collide with another
// file's top-level const (a parse-time redeclaration silently discards this
// whole file). Keep this identifier file-unique.
const _lbui_ = LifeBuildingUI._internals;

describe('LifeBuildingUI.titleCase', () => {
  it('title-cases keys, splitting on _ and /', () => {
    assertEqual(_lbui_.titleCase('finances'), 'Finances');
    assertEqual(_lbui_.titleCase('net_worth'), 'Net Worth');
    assertEqual(_lbui_.titleCase('life/building'), 'Life Building');
  });
  it("returns '' for empty / non-string", () => {
    assertEqual(_lbui_.titleCase(''), '');
    assertEqual(_lbui_.titleCase(null), '');
    assertEqual(_lbui_.titleCase(undefined), '');
  });
});

describe('LifeBuildingUI.bandForScore', () => {
  it('buckets scores per the frozen contract bands', () => {
    assertEqual(_lbui_.bandForScore(95), 'thriving');
    assertEqual(_lbui_.bandForScore(80), 'thriving');
    assertEqual(_lbui_.bandForScore(60), 'steady');
    assertEqual(_lbui_.bandForScore(40), 'strained');
    assertEqual(_lbui_.bandForScore(0), 'depleted');
    assertEqual(_lbui_.bandForScore(39), 'depleted');
  });
  it('returns unknown for null / non-numeric', () => {
    assertEqual(_lbui_.bandForScore(null), 'unknown');
    assertEqual(_lbui_.bandForScore(undefined), 'unknown');
    assertEqual(_lbui_.bandForScore('72'), 'unknown');
    assertEqual(_lbui_.bandForScore(NaN), 'unknown');
    assertEqual(_lbui_.bandForScore(Infinity), 'unknown');
  });
});

describe('LifeBuildingUI.bandLabel', () => {
  it('maps each band to a display label', () => {
    assertEqual(_lbui_.bandLabel('thriving'), 'Thriving');
    assertEqual(_lbui_.bandLabel('steady'), 'Steady');
    assertEqual(_lbui_.bandLabel('strained'), 'Strained');
    assertEqual(_lbui_.bandLabel('depleted'), 'Depleted');
    assertEqual(_lbui_.bandLabel('whatever'), 'Unknown');
    assertEqual(_lbui_.bandLabel('unknown'), 'Unknown');
  });
});

describe('LifeBuildingUI.bandColorVar', () => {
  it('reuses the Home hub band tokens', () => {
    assertEqual(_lbui_.bandColorVar('thriving'), 'var(--home-band-thriving)');
    assertEqual(_lbui_.bandColorVar('steady'), 'var(--home-band-steady)');
    assertEqual(_lbui_.bandColorVar('strained'), 'var(--home-band-strained)');
    assertEqual(_lbui_.bandColorVar('depleted'), 'var(--home-band-depleted)');
    assertEqual(_lbui_.bandColorVar(null), 'var(--home-band-unknown)');
    assertEqual(_lbui_.bandColorVar('unknown'), 'var(--home-band-unknown)');
  });
});

describe('LifeBuildingUI.areaCardModel', () => {
  it('shapes a full area entry', () => {
    const m = _lbui_.areaCardModel({
      key: 'finances', label: 'Finances', score: 72,
      band: 'steady', signal: 'Savings rate solid this month.',
    });
    assertEqual(m.key, 'finances');
    assertEqual(m.label, 'Finances');
    assertEqual(m.score, 72);
    assertEqual(m.band, 'steady');
    assertEqual(m.signal, 'Savings rate solid this month.');
    assertEqual(m.hasData, true);
  });
  it('derives band from score + falls back to AREA_LABELS when label missing', () => {
    const m = _lbui_.areaCardModel({ key: 'finances', score: 45 });
    assertEqual(m.label, 'Finances'); // from AREA_LABELS
    assertEqual(m.band, 'strained'); // derived from 45
    assertEqual(m.hasData, true);
  });
  it('maps the one Life Building area key to its display label', () => {
    assertEqual(_lbui_.AREA_LABELS.finances, 'Finances');
  });
  it('flags hasData:false for a null score, band→unknown', () => {
    const m = _lbui_.areaCardModel({ key: 'finances', score: null });
    assertEqual(m.hasData, false);
    assertEqual(m.score, null);
    assertEqual(m.band, 'unknown');
    assertEqual(m.label, 'Finances');
  });
  it('returns null for garbage input', () => {
    assertEqual(_lbui_.areaCardModel(null), null);
    assertEqual(_lbui_.areaCardModel('nope'), null);
    assertEqual(_lbui_.areaCardModel(42), null);
  });
  it('uses provided band over derived when both present', () => {
    const m = _lbui_.areaCardModel({ key: 'finances', score: 85, band: 'strained' });
    assertEqual(m.band, 'strained'); // explicit band wins over derived thriving
  });
});

describe('LifeBuildingUI.areaModelsFrom', () => {
  it('maps a record\'s areas[] into card models', () => {
    const rec = { areas: [
      { key: 'finances', score: 72, band: 'steady' },
    ] };
    const models = _lbui_.areaModelsFrom(rec);
    assertEqual(models.length, 1);
    assertEqual(models[0].key, 'finances');
    assertEqual(models[0].band, 'steady');
  });
  it('handles null score in an area entry', () => {
    const rec = { areas: [{ key: 'finances', score: null }] };
    const models = _lbui_.areaModelsFrom(rec);
    assertEqual(models.length, 1);
    assertEqual(models[0].hasData, false);
  });
  it('returns [] when areas is missing / not an array / record null', () => {
    assertArrayEqual(_lbui_.areaModelsFrom({}), []);
    assertArrayEqual(_lbui_.areaModelsFrom({ areas: 'nope' }), []);
    assertArrayEqual(_lbui_.areaModelsFrom(null), []);
    assertArrayEqual(_lbui_.areaModelsFrom(undefined), []);
  });
  it('filters out garbage area entries', () => {
    const rec = { areas: [null, 'bad', { key: 'finances', score: 60 }] };
    const models = _lbui_.areaModelsFrom(rec);
    assertEqual(models.length, 1);
    assertEqual(models[0].key, 'finances');
  });
});

describe('LifeBuildingUI.heroModel', () => {
  it('reads composite score/band/headline from the record', () => {
    const rec = { state: { score: 72, band: 'steady' }, headline: 'Finances steady.' };
    const h = _lbui_.heroModel(rec);
    assertEqual(h.hasData, true);
    assertEqual(h.score, 72);
    assertEqual(h.band, 'steady');
    assertEqual(h.headline, 'Finances steady.');
  });
  it('derives band from score when state.band absent', () => {
    const h = _lbui_.heroModel({ state: { score: 88 }, headline: '' });
    assertEqual(h.band, 'thriving');
  });
  it('handles a null score (unknown band)', () => {
    const h = _lbui_.heroModel({ state: { score: null } });
    assertEqual(h.score, null);
    assertEqual(h.band, 'unknown');
    assertEqual(h.hasData, true);
  });
  it('handles a null record (empty model)', () => {
    const none = _lbui_.heroModel(null);
    assertEqual(none.hasData, false);
    assertEqual(none.band, 'unknown');
    assertEqual(none.score, null);
    assertEqual(none.headline, '');
  });
});

describe('LifeBuildingUI.isEmptyState', () => {
  it('returns true for null record', () => {
    assertEqual(_lbui_.isEmptyState(null), true);
    assertEqual(_lbui_.isEmptyState(undefined), true);
  });
  it('returns true when record has no score AND no areas', () => {
    assertEqual(_lbui_.isEmptyState({ state: { score: null }, areas: [] }), true);
    assertEqual(_lbui_.isEmptyState({ state: {} }), true);
    assertEqual(_lbui_.isEmptyState({}), true);
  });
  it('returns false when record has a finite score', () => {
    assertEqual(_lbui_.isEmptyState({ state: { score: 72 } }), false);
    assertEqual(_lbui_.isEmptyState({ state: { score: 0 } }), false);
  });
  it('returns false when record has areas (even with null score)', () => {
    assertEqual(_lbui_.isEmptyState({ state: { score: null }, areas: [{ key: 'finances' }] }), false);
  });
});

describe('LifeBuildingUI.formPrefillFrom', () => {
  it('extracts string values for all four metric fields', () => {
    const rec = { savingsRate: 18, creditScore: 760, debtRemaining: 12000, netWorth: 45000 };
    const p = _lbui_.formPrefillFrom(rec);
    assertEqual(p.savingsRate, '18');
    assertEqual(p.creditScore, '760');
    assertEqual(p.debtRemaining, '12000');
    assertEqual(p.netWorth, '45000');
  });
  it('yields empty string for absent / non-finite metrics', () => {
    const p = _lbui_.formPrefillFrom({ savingsRate: 20 });
    assertEqual(p.savingsRate, '20');
    assertEqual(p.creditScore, '');
    assertEqual(p.debtRemaining, '');
    assertEqual(p.netWorth, '');
  });
  it('yields all empty strings for null monthRecord', () => {
    const p = _lbui_.formPrefillFrom(null);
    assertEqual(p.savingsRate, '');
    assertEqual(p.creditScore, '');
    assertEqual(p.debtRemaining, '');
    assertEqual(p.netWorth, '');
  });
  it('handles non-finite metric values gracefully', () => {
    const p = _lbui_.formPrefillFrom({ savingsRate: NaN, creditScore: Infinity });
    assertEqual(p.savingsRate, '');
    assertEqual(p.creditScore, '');
  });
  it('handles negative values (e.g. negative net worth)', () => {
    const p = _lbui_.formPrefillFrom({ netWorth: -5000 });
    assertEqual(p.netWorth, '-5000');
  });
});

describe('LifeBuildingUI.serializeForm', () => {
  // Create a minimal container with the four data-fin-input elements.
  function makeContainer(values) {
    const div = document.createElement('div');
    const keys = ['savingsRate', 'creditScore', 'debtRemaining', 'netWorth'];
    for (const key of keys) {
      const inp = document.createElement('input');
      inp.setAttribute('data-fin-input', key);
      inp.value = (values && values[key] !== undefined) ? String(values[key]) : '';
      div.appendChild(inp);
    }
    return div;
  }

  it('serializes filled fields as numbers', () => {
    const c = makeContainer({ savingsRate: '18', creditScore: '760' });
    const patch = _lbui_.serializeForm(c);
    assertEqual(patch.savingsRate, 18);
    assertEqual(patch.creditScore, 760);
  });
  it('omits empty inputs from the patch', () => {
    const c = makeContainer({ savingsRate: '15' });
    const patch = _lbui_.serializeForm(c);
    assertEqual(patch.savingsRate, 15);
    assertEqual(Object.prototype.hasOwnProperty.call(patch, 'creditScore'), false);
    assertEqual(Object.prototype.hasOwnProperty.call(patch, 'debtRemaining'), false);
    assertEqual(Object.prototype.hasOwnProperty.call(patch, 'netWorth'), false);
  });
  it('returns an empty object when all inputs are blank', () => {
    const c = makeContainer({});
    const patch = _lbui_.serializeForm(c);
    assertEqual(Object.keys(patch).length, 0);
  });
  it('handles negative values (net worth below zero)', () => {
    const c = makeContainer({ netWorth: '-5000' });
    const patch = _lbui_.serializeForm(c);
    assertEqual(patch.netWorth, -5000);
  });
  it('handles a null container gracefully', () => {
    const patch = _lbui_.serializeForm(null);
    assertEqual(Object.keys(patch).length, 0);
  });
  it('coerces decimal inputs to numbers', () => {
    const c = makeContainer({ savingsRate: '18.5' });
    const patch = _lbui_.serializeForm(c);
    assertEqual(patch.savingsRate, 18.5);
  });
});

describe('LifeBuildingUI._captureFormHtml — prefill into value attrs', () => {
  it('renders prefilled values into the input value attributes', () => {
    const html = _lbui_._captureFormHtml(
      { savingsRate: '18', creditScore: '762', debtRemaining: '', netWorth: '45000' },
      '2026-07'
    );
    assert(html.indexOf('value="18"') !== -1, 'savingsRate prefilled');
    assert(html.indexOf('value="762"') !== -1, 'creditScore prefilled');
    assert(html.indexOf('value="45000"') !== -1, 'netWorth prefilled');
    assert(html.indexOf('value=""') === -1, 'empty field emits no value attr');
    assert(html.indexOf('Update 2026-07 numbers') !== -1, 'month title rendered');
  });
  it('renders no value attributes for an empty prefill', () => {
    const html = _lbui_._captureFormHtml({}, '2026-07');
    assert(html.indexOf('value=') === -1, 'no value attrs when prefill empty');
  });
});

describe('LifeBuildingUI._emptyStateHtml — threads prefill to the capture form (finding B)', () => {
  it('empty-state form prefills from the stored month (the DEFAULT pre-council path)', () => {
    // Regression: _emptyStateHtml hardcoded {} so already-entered numbers never
    // showed in the default (pre-council) state. The fix threads the prefill in.
    const html = _lbui_._emptyStateHtml('2026-07', { savingsRate: '18', creditScore: '762', debtRemaining: '', netWorth: '' });
    assert(html.indexOf('value="18"') !== -1, 'empty-state form shows savingsRate prefill');
    assert(html.indexOf('value="762"') !== -1, 'empty-state form shows creditScore prefill');
    assert(html.indexOf('Your finances, at a glance') !== -1, 'empty-state prompt still present');
  });
  it('empty-state with no prefill renders a blank form', () => {
    const html = _lbui_._emptyStateHtml('2026-07');
    assert(html.indexOf('value=') === -1, 'no prefill → blank form');
    assert(html.indexOf('Your finances, at a glance') !== -1, 'empty-state prompt present');
  });
});
