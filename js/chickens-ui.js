// Chickens hub UI (Life-OS Phase 3) — the dedicated deep-dive surface for the
// `chickens` domain pillar. Renders the council's single `chickens` synthesis
// record as:
//   (a) a hero — the composite Chickens score + band + headline;
//   (b) five Area cards — Mood / Mindfulness / BFRB regulation / Focus
//       engagement / Stress load, from the record's additive `areas[]` field
//       (each: label + band chip + signal; the Mood card adds a display-only
//       7d-vs-prior-7d valence delta from the LOCAL mood_events stream);
//   (c) "This week's moves" — the record's own nudges (weekly only);
//   (d) an empty state (the DEFAULT path) when nothing is cached yet.
//
// RENDER-FROM-CACHE ONLY. Mirrors js/physicals-ui.js: the empty state is the
// default path, render() never throws, and EVERY record-derived string is
// escaped via escapeHtml (js/dom-utils.js). No live Firestore on the render
// path — SynthesisFeed.refreshAll() runs off-render (sign-in / boot) and
// `chickens` is already in its node list, so the hub adds NO fetch path. No
// write path; the council is authoritative.
//
// The 5 Areas ride INSIDE the one `chickens` record (additive `areas[]`), so
// this reads SynthesisFeed.getRecord('chickens') only — no sub-node fetch.
// Reuses the home hub's --home-band-* tokens + .home-band-chip primitive.
window.ChickensUI = (() => {
  // The Area render order (matches the council's AREA_KEYS). The record's
  // `areas[]` already carries this order; this is only a fallback label source.
  const AREA_LABELS = {
    mood: 'Mood',
    mindfulness: 'Mindfulness',
    bfrb: 'BFRB regulation',
    focus: 'Focus engagement',
    stress: 'Stress load',
  };

  // ── Pure helpers (exposed on _internals for tests; NO DOM here) ───────

  // 'mood' → 'Mood' (fallback when an area carries no label). Splits on
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

  // Display-only mood trend: last-7d mean valence vs prior-7d — the ratified
  // "delta chip" on the Mood card (plan §Score model, Mood row). Computed from
  // the LOCAL mood_events stream (the council record carries no delta; the
  // render path stays cache/local-only). Requires ≥3 valid logs in EACH
  // window (the same thin-sample bar as the council's minLogs) → else null
  // (no chip — a thin sample is unread, never a fake trend).
  function moodDelta(events, nowMs) {
    if (!Array.isArray(events) || !events.length) return null;
    const now = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : Date.now();
    const DAY = 86400000;
    const last = [];
    const prior = [];
    for (const e of events) {
      if (!e || typeof e.at !== 'number' || !isFinite(e.at)) continue;
      if (typeof e.valence !== 'number' || !isFinite(e.valence)
          || e.valence < 1 || e.valence > 5) continue;
      const age = now - e.at;
      if (age < 0) continue;
      if (age <= 7 * DAY) last.push(e.valence);
      else if (age <= 14 * DAY) prior.push(e.valence);
    }
    if (last.length < 3 || prior.length < 3) return null;
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const delta = Math.round((mean(last) - mean(prior)) * 10) / 10;
    const dir = delta > 0.05 ? 'up' : (delta < -0.05 ? 'down' : 'flat');
    const text = dir === 'flat'
      ? 'steady vs prior 7d'
      : (dir === 'up' ? '▲ +' : '▼ ') + delta.toFixed(1) + ' vs prior 7d';
    return { delta, dir, text };
  }

  // The hero model from the chickens record: composite score + band + headline.
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
    let s = '<section class="home-card chickens-hero" aria-label="Chickens overall">';
    s += '<div class="chickens-hero-header">'
      + '<span class="chickens-hero-kicker">Chickens</span>'
      + _bandChip(hero.band, hero.score) + '</div>';
    if (hero.headline) {
      s += '<p class="chickens-hero-headline">' + escapeHtml(hero.headline) + '</p>';
    }
    return s + '</section>';
  }

  function _areaCardsHtml(areaModels, moodDeltaModel) {
    if (!areaModels.length) return '';
    const cards = areaModels.map((m) => {
      const scoreForChip = m.hasData ? m.score : null;
      let c = '<section class="home-card chickens-area-card" data-area-key="' + escapeHtml(m.key) + '">';
      c += '<div class="chickens-area-card-header">'
        + '<span class="chickens-area-card-title">' + escapeHtml(m.label) + '</span>'
        + _bandChip(m.band, scoreForChip) + '</div>';
      if (m.signal) {
        c += '<p class="chickens-area-card-signal">' + escapeHtml(m.signal) + '</p>';
      }
      // Display-only 7d-vs-prior-7d trend on the Mood card (local stream).
      if (m.key === 'mood' && moodDeltaModel && typeof moodDeltaModel.text === 'string') {
        c += '<p class="chickens-mood-delta" data-dir="' + escapeHtml(moodDeltaModel.dir) + '">'
          + escapeHtml(moodDeltaModel.text) + '</p>';
      }
      return c + '</section>';
    }).join('');
    return '<div class="chickens-areas">' + cards + '</div>';
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
    return '<section class="home-card chickens-empty" aria-label="Chickens">'
      + '<div class="chickens-empty-mark" aria-hidden="true">☽</div>'
      + '<div class="chickens-empty-title">Your headspace, at a glance</div>'
      + '<div class="chickens-empty-body">No chickens synthesis yet — the council writes the first record on its next run.</div>'
      + '</section>';
  }

  // Build the inner HTML from the cached chickens record. Reads SynthesisFeed
  // (cache only) but touches no DOM. Returns a string.
  function _buildHtml() {
    let rec = null;
    try {
      if (typeof SynthesisFeed !== 'undefined' && typeof SynthesisFeed.getRecord === 'function') {
        rec = SynthesisFeed.getRecord('chickens');
      }
    } catch (_) { rec = null; }

    if (!rec) return _emptyStateHtml();

    const hero = heroModel(rec);
    const areaModels = areaModelsFrom(rec);
    // Local-only read (no fetch): the Mood card's display-only trend chip.
    let deltaModel = null;
    try {
      if (typeof Mood !== 'undefined' && typeof Mood.getAll === 'function') {
        deltaModel = moodDelta(Mood.getAll());
      }
    } catch (_) { deltaModel = null; }
    let html = '';
    html += _heroHtml(hero);
    html += _areaCardsHtml(areaModels, deltaModel);
    html += _movesHtml(rec);
    // A cached record with no hero text AND no areas is effectively empty.
    if (!html) return _emptyStateHtml();
    return html;
  }

  // ── Render (the only DOM-touching entry point) ───────────────────────

  function _container() {
    return document.getElementById('chickens-pillar-body');
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

  // Subscribe once so the hub repaints the moment a fresh chickens record lands
  // in the cache (refreshAll fills it asynchronously after boot / sign-in).
  // Only repaints when Chickens is the visible pillar; the navigate-to-Chickens
  // path (TempoNav → render()) covers the hidden case. Idempotent.
  let _subscribed = false;
  function init() {
    if (_subscribed) return;
    _subscribed = true;
    if (typeof SynthesisFeed !== 'undefined' && typeof SynthesisFeed.onUpdate === 'function') {
      SynthesisFeed.onUpdate(() => {
        const sec = document.querySelector('.tempo-pillar[data-pillar-id="chickens"]');
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
      moodDelta,
      AREA_LABELS,
    },
  };
})();
