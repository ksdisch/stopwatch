// Physicals hub UI (Life-OS Phase 2) — the dedicated deep-dive surface for the
// `physicals` domain pillar. Renders the council's single `physicals` synthesis
// record as:
//   (a) a hero — the composite Physicals score + band + headline;
//   (b) four Area cards — Recovery / Sleep / Meds / Training load, from the
//       record's additive `areas[]` field (each: label + band chip + signal);
//   (c) "This week's moves" — the record's own nudges (weekly only);
//   (d) an empty state (the DEFAULT path) when nothing is cached yet.
//
// RENDER-FROM-CACHE ONLY. Mirrors js/home-ui.js: the empty state is the default
// path, render() never throws, and EVERY record-derived string is escaped via
// escapeHtml (js/dom-utils.js). No live Firestore on the render path —
// SynthesisFeed.refreshAll() runs off-render (sign-in / boot) and `physicals`
// is already in its node list, so the hub adds NO fetch path. No write path;
// the council is authoritative.
//
// The 4 Areas ride INSIDE the one `physicals` record (additive `areas[]`), so
// this reads SynthesisFeed.getRecord('physicals') only — no sub-node fetch.
// Reuses the home hub's --home-band-* tokens + .home-band-chip primitive.
window.PhysicalsUI = (() => {
  // The Area render order (matches the council's AREA_KEYS). The record's
  // `areas[]` already carries this order; this is only a fallback label source.
  const AREA_LABELS = {
    recovery: 'Recovery',
    sleep: 'Sleep',
    meds: 'Meds',
    training: 'Training load',
  };

  // ── Pure helpers (exposed on _internals for tests; NO DOM here) ───────

  // 'training' → 'Training' (fallback when an area carries no label). Splits on
  // '_' and '/' and title-cases, same idiom as HomeUI.titleCase.
  function titleCase(key) {
    if (typeof key !== 'string' || !key.length) return '';
    return key
      .split(/[/_]/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  // The score → band bucket per the contract (thriving 80+, steady 60-79,
  // strained 40-59, depleted 0-39, unknown when null/non-numeric).
  function bandForScore(score) {
    if (typeof score !== 'number' || !isFinite(score)) return 'unknown';
    if (score >= 80) return 'thriving';
    if (score >= 60) return 'steady';
    if (score >= 40) return 'strained';
    return 'depleted';
  }

  function bandLabel(band) {
    switch (band) {
      case 'thriving': return 'Thriving';
      case 'steady':   return 'Steady';
      case 'strained': return 'Strained';
      case 'depleted': return 'Depleted';
      default:         return 'Unknown';
    }
  }

  // Band → the CSS var token backing its color (reuses the Home hub's tokens).
  function bandColorVar(band) {
    switch (band) {
      case 'thriving': return 'var(--home-band-thriving)';
      case 'steady':   return 'var(--home-band-steady)';
      case 'strained': return 'var(--home-band-strained)';
      case 'depleted': return 'var(--home-band-depleted)';
      default:         return 'var(--home-band-unknown)';
    }
  }

  // Shape one Area card model from an `areas[]` entry. Null/garbage-tolerant —
  // a bad entry yields null so the caller filters it out. A null score →
  // hasData:false (the renderer shows a "—" and an "Unknown" chip).
  function areaCardModel(area) {
    if (!area || typeof area !== 'object') return null;
    const key = typeof area.key === 'string' ? area.key : '';
    const label = (typeof area.label === 'string' && area.label)
      ? area.label
      : (AREA_LABELS[key] || titleCase(key) || 'Area');
    const score = (typeof area.score === 'number' && isFinite(area.score)) ? area.score : null;
    const band = (typeof area.band === 'string' && area.band) ? area.band : bandForScore(score);
    const signal = (typeof area.signal === 'string') ? area.signal : '';
    return { key, label, score, band, signal, hasData: score != null };
  }

  // The list of Area card models from a record's additive `areas[]`. Missing /
  // non-array → [].
  function areaModelsFrom(rec) {
    const areas = (rec && Array.isArray(rec.areas)) ? rec.areas : [];
    return areas.map(areaCardModel).filter(Boolean);
  }

  // The hero model from the physicals record: composite score + band + headline.
  function heroModel(rec) {
    if (!rec) return { hasData: false, score: null, band: 'unknown', headline: '' };
    const score = (rec.state && typeof rec.state.score === 'number' && isFinite(rec.state.score))
      ? rec.state.score
      : null;
    const band = (rec.state && typeof rec.state.band === 'string' && rec.state.band)
      ? rec.state.band
      : bandForScore(score);
    const headline = (typeof rec.headline === 'string') ? rec.headline : '';
    return { hasData: true, score, band, headline };
  }

  // ── Section builders (return HTML strings; read pure helpers above) ───

  // The band chip primitive (reused from the Home hub, .home-band-chip). Routes
  // both band + score through escapeHtml so the "escape every record-derived
  // string" invariant holds mechanically.
  function _bandChip(band, score) {
    const safeBand = band || 'unknown';
    const scoreTxt = (typeof score === 'number') ? (' ' + escapeHtml(String(score))) : '';
    return '<span class="home-band-chip" data-band="' + escapeHtml(safeBand) + '">'
      + escapeHtml(bandLabel(safeBand)) + scoreTxt + '</span>';
  }

  function _heroHtml(hero) {
    if (!hero || !hero.hasData) return '';
    let s = '<section class="home-card physicals-hero" aria-label="Physicals overall">';
    s += '<div class="physicals-hero-header">'
      + '<span class="physicals-hero-kicker">Physicals</span>'
      + _bandChip(hero.band, hero.score) + '</div>';
    if (hero.headline) {
      s += '<p class="physicals-hero-headline">' + escapeHtml(hero.headline) + '</p>';
    }
    return s + '</section>';
  }

  function _areaCardsHtml(areaModels) {
    if (!areaModels.length) return '';
    const cards = areaModels.map((m) => {
      const scoreForChip = m.hasData ? m.score : null;
      let c = '<section class="home-card physicals-area-card" data-area-key="' + escapeHtml(m.key) + '">';
      c += '<div class="physicals-area-card-header">'
        + '<span class="physicals-area-card-title">' + escapeHtml(m.label) + '</span>'
        + _bandChip(m.band, scoreForChip) + '</div>';
      if (m.signal) {
        c += '<p class="physicals-area-card-signal">' + escapeHtml(m.signal) + '</p>';
      }
      return c + '</section>';
    }).join('');
    return '<div class="physicals-areas">' + cards + '</div>';
  }

  function _movesHtml(rec) {
    const nudges = (rec && Array.isArray(rec.nudges)) ? rec.nudges.slice() : [];
    if (!nudges.length) return ''; // hidden on the daily glance
    nudges.sort((a, b) => {
      const pa = (a && typeof a.priority === 'number') ? a.priority : 999;
      const pb = (b && typeof b.priority === 'number') ? b.priority : 999;
      return pa - pb;
    });
    const top = nudges.slice(0, 3).filter((nd) => nd && typeof nd.text === 'string' && nd.text.length);
    if (!top.length) return '';
    const rows = top.map((nd) => '<li class="home-move-row">' + escapeHtml(nd.text) + '</li>').join('');
    return '<section class="home-card home-moves" aria-label="This week’s moves">'
      + '<div class="home-moves-title">This week’s moves</div>'
      + '<ol class="home-moves-list">' + rows + '</ol>'
      + '</section>';
  }

  function _emptyStateHtml() {
    return '<section class="home-card physicals-empty" aria-label="Physicals">'
      + '<div class="physicals-empty-mark" aria-hidden="true">♡</div>'
      + '<div class="physicals-empty-title">Your body, at a glance</div>'
      + '<div class="physicals-empty-body">Sign in and run a synthesis to see recovery, sleep, meds and training load.</div>'
      + '</section>';
  }

  // Build the inner HTML from the cached physicals record. Reads SynthesisFeed
  // (cache only) but touches no DOM. Returns a string.
  function _buildHtml() {
    let rec = null;
    try {
      if (typeof SynthesisFeed !== 'undefined' && typeof SynthesisFeed.getRecord === 'function') {
        rec = SynthesisFeed.getRecord('physicals');
      }
    } catch (_) { rec = null; }

    if (!rec) return _emptyStateHtml();

    const hero = heroModel(rec);
    const areaModels = areaModelsFrom(rec);
    let html = '';
    html += _heroHtml(hero);
    html += _areaCardsHtml(areaModels);
    html += _movesHtml(rec);
    // A cached record with no hero text AND no areas is effectively empty.
    if (!html) return _emptyStateHtml();
    return html;
  }

  // ── Render (the only DOM-touching entry point) ───────────────────────

  function _container() {
    return document.getElementById('physicals-pillar-body');
  }

  function render() {
    const root = _container();
    if (!root) return;
    try {
      root.innerHTML = _buildHtml();
    } catch (_) {
      // Never throw on the render path — fall back to the calm empty state.
      try { root.innerHTML = _emptyStateHtml(); } catch (__) {}
    }
  }

  // Subscribe once so the hub repaints the moment a fresh physicals record lands
  // in the cache (refreshAll fills it asynchronously after boot / sign-in).
  // Only repaints when Physicals is the visible pillar; the navigate-to-Physicals
  // path (TempoNav → render()) covers the hidden case. Idempotent.
  let _subscribed = false;
  function init() {
    if (_subscribed) return;
    _subscribed = true;
    if (typeof SynthesisFeed !== 'undefined' && typeof SynthesisFeed.onUpdate === 'function') {
      SynthesisFeed.onUpdate(() => {
        const sec = document.querySelector('.tempo-pillar[data-pillar-id="physicals"]');
        if (sec && sec.dataset.active === 'true') {
          try { render(); } catch (_) { /* never break the feed's notify loop */ }
        }
      });
    }
  }

  return {
    render,
    init,
    _internals: {
      titleCase,
      bandForScore,
      bandLabel,
      bandColorVar,
      areaCardModel,
      areaModelsFrom,
      heroModel,
      AREA_LABELS,
    },
  };
})();
