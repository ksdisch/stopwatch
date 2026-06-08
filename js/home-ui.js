// Home hub UI (Life-OS Phase 1) — the cross-pillar dashboard overlay and the
// default landing surface. Renders the council's `home` synthesis record (the
// Balance read) plus the five domain-pillar records as:
//   (a) a bubble map — one inline-SVG circle per pillar, radius scaled by the
//       ACTIVE lens (Needs-attention / Importance / Neglect), fill = band color;
//   (b) synthesis cards — a home hero + one card per pillar;
//   (c) "This week's 3 moves" — the home record's top-3 nudges;
//   (d) an empty state (the DEFAULT path) when nothing is cached yet.
//
// RENDER-FROM-CACHE ONLY. Mirrors js/rhythm-panel-today.js: the empty state is
// the default path, render() never throws, and EVERY record-derived string is
// escaped via escapeHtml (js/dom-utils.js). No live Firestore on the render
// path — SynthesisFeed.refreshAll() runs off-render (sign-in / boot). No write
// path; the council is authoritative.
//
// SVG helpers are a SMALL self-contained replica of the js/rhythm-insights.js
// idiom — deliberately NOT a load-order dependency on RhythmInsights.
window.HomeUI = (() => {
  // The five domain-pillars, in a fixed bubble order. Falls back to the feed's
  // PILLAR_NODES if present, else this literal (keeps render() safe when the
  // feed is absent in a test harness).
  const PILLARS = (typeof SynthesisFeed !== 'undefined' && Array.isArray(SynthesisFeed.PILLAR_NODES))
    ? SynthesisFeed.PILLAR_NODES.slice()
    : ['life_building', 'physicals', 'chickens', 'relationships', 'growth'];

  // The three bubble lenses. 'priority' (Needs attention) is the DEFAULT.
  const LENSES = [
    { key: 'priority',   label: 'Needs attention' },
    { key: 'importance', label: 'Importance' },
    { key: 'neglect',    label: 'Neglect' },
  ];
  let activeLens = 'priority';

  // Bubble geometry.
  const MIN_R = 9;    // a 0-value pillar still shows
  const MAX_R = 30;

  // ── Pure helpers (exposed on _internals for tests; NO DOM here) ───────

  // 'life_building' → 'Life Building'. Splits on '_' and '/' and title-cases.
  function titleCase(node) {
    if (typeof node !== 'string' || !node.length) return '';
    return node
      .split(/[/_]/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  // Band → the CSS var token that backs its color. Unknown / missing → the
  // 'unknown' var. Bands are the frozen contract enum.
  function bandColorVar(band) {
    switch (band) {
      case 'thriving': return 'var(--home-band-thriving)';
      case 'steady':   return 'var(--home-band-steady)';
      case 'strained': return 'var(--home-band-strained)';
      case 'depleted': return 'var(--home-band-depleted)';
      default:         return 'var(--home-band-unknown)';
    }
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

  // The lens value for one pillar record. Prefers the council's additive
  // `balance` object; falls back to a score-derived heuristic so an older
  // record (no balance) still sizes a bubble. NOTE (cross-runtime): importance
  // has no score-derived signal, so a pillar record lacking `balance.importance`
  // sizes to a flat 3 and the Importance lens degenerates to uniform bubbles —
  // Phase-1 seed records carry `balance`; any real Phase-2 pillar synthesizer
  // MUST stamp it too (via the council's balance.mjs). See docs/lifeos/phase-1-plan.md.
  //   priority   → balance.priority           else (100 - (score ?? 50)) / 20   (0..5-ish)
  //   importance → balance.importance         else 3                            (neutral mid)
  //   neglect    → balance.neglect            else (100 - (score ?? 100)) / 100 (0..1 shortfall)
  function lensValue(rec, lens) {
    const balance = (rec && typeof rec.balance === 'object' && rec.balance) ? rec.balance : null;
    const score = (rec && rec.state && typeof rec.state.score === 'number') ? rec.state.score : null;
    if (lens === 'importance') {
      if (balance && typeof balance.importance === 'number' && isFinite(balance.importance)) {
        return balance.importance;
      }
      return 3;
    }
    if (lens === 'neglect') {
      if (balance && typeof balance.neglect === 'number' && isFinite(balance.neglect)) {
        return balance.neglect;
      }
      return (100 - (score == null ? 100 : score)) / 100;
    }
    // priority (default)
    if (balance && typeof balance.priority === 'number' && isFinite(balance.priority)) {
      return balance.priority;
    }
    return (100 - (score == null ? 50 : score)) / 20;
  }

  // Normalize a numeric array to bubble radii in [minR, maxR]. The smallest
  // value clamps to minR (so even a 0 shows), the largest hits maxR. An
  // all-equal (or single-value) set maps everything to the midpoint so the
  // bubbles read as uniform rather than collapsing to minR. Non-finite inputs
  // are treated as 0.
  function normalizeRadii(values, minR, maxR) {
    minR = (typeof minR === 'number') ? minR : MIN_R;
    maxR = (typeof maxR === 'number') ? maxR : MAX_R;
    const vals = (values || []).map((v) => (typeof v === 'number' && isFinite(v)) ? v : 0);
    if (vals.length === 0) return [];
    const lo = Math.min.apply(null, vals);
    const hi = Math.max.apply(null, vals);
    const span = hi - lo;
    const mid = (minR + maxR) / 2;
    if (span <= 0) return vals.map(() => mid); // all equal / single value
    return vals.map((v) => minR + ((v - lo) / span) * (maxR - minR));
  }

  // Shape one pillar's card model from its record. Pure — the renderer turns
  // this into (escaped) HTML. A null record yields a card flagged hasData:false
  // so the renderer can hide it / show a thin placeholder.
  function pillarCardModel(node, rec) {
    if (!rec) {
      return {
        node,
        label: titleCase(node),
        hasData: false,
        band: 'unknown',
        score: null,
        headline: '',
        topSignal: '',
      };
    }
    const score = (rec.state && typeof rec.state.score === 'number') ? rec.state.score : null;
    const band = (rec.state && rec.state.band) ? rec.state.band : bandForScore(score);
    const signals = Array.isArray(rec.signals) ? rec.signals : [];
    return {
      node,
      label: titleCase(node),
      hasData: true,
      band,
      score,
      headline: typeof rec.headline === 'string' ? rec.headline : '',
      topSignal: (signals.length && typeof signals[0] === 'string') ? signals[0] : '',
    };
  }

  // ── Small self-contained SVG bubble-map builder (DOM-string only) ────

  // Lay out N bubbles across a row, evenly spaced, vertically centered, each
  // labeled below. Returns an SVG string. radii align 1:1 with pillarModels.
  function _bubbleMapSvg(pillarModels, radii) {
    const n = pillarModels.length;
    if (n === 0) return '';
    const W = 320;
    const H = 150;
    const cy = 64;            // bubble centerline
    const labelY = 128;       // pillar label baseline
    const colW = W / n;
    let body = '';
    pillarModels.forEach((m, i) => {
      const cx = colW * i + colW / 2;
      const r = (typeof radii[i] === 'number' && isFinite(radii[i])) ? radii[i] : MIN_R;
      const fill = bandColorVar(m.band);
      const tip = m.label + (m.hasData && m.score != null ? ' · ' + m.score : '') + ' · ' + m.band;
      body += '<g class="home-bubble" data-pillar-node="' + escapeHtml(m.node) + '">';
      body += '<circle class="home-bubble-circle" cx="' + cx.toFixed(1) + '" cy="' + cy
        + '" r="' + r.toFixed(1) + '" fill="' + fill + '">'
        + '<title>' + escapeHtml(tip) + '</title></circle>';
      body += '<text class="home-bubble-label" x="' + cx.toFixed(1) + '" y="' + labelY
        + '" text-anchor="middle">' + escapeHtml(m.label) + '</text>';
      body += '</g>';
    });
    return '<svg class="home-bubblemap-svg" viewBox="0 0 ' + W + ' ' + H
      + '" role="img" aria-label="Pillar balance bubble map" preserveAspectRatio="xMidYMid meet">'
      + body + '</svg>';
  }

  // ── Section builders (return HTML strings; read pure helpers above) ───

  function _bubbleMapHtml(pillarModels) {
    const values = pillarModels.map((m) => lensValue(m.rec, activeLens));
    const radii = normalizeRadii(values, MIN_R, MAX_R);
    const lensBtns = LENSES.map((l) => {
      const isActive = (l.key === activeLens);
      return '<button type="button" class="home-lens-btn' + (isActive ? ' is-active' : '')
        + '" data-home-lens="' + escapeHtml(l.key) + '"'
        + (isActive ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>'
        + escapeHtml(l.label) + '</button>';
    }).join('');
    return '<section class="home-card home-bubblemap" aria-label="Balance bubble map">'
      + '<div class="home-lens-toggle" role="group" aria-label="Bubble size lens">' + lensBtns + '</div>'
      + '<div class="home-bubblemap-figure">' + _bubbleMapSvg(pillarModels, radii) + '</div>'
      + '</section>';
  }

  function _bandChip(band, score) {
    const safeBand = band || 'unknown';
    // Number-typed today (guarded), but route through escapeHtml so the
    // "escape every record-derived string" invariant holds mechanically even
    // if the type guard is ever loosened.
    const scoreTxt = (typeof score === 'number') ? (' ' + escapeHtml(String(score))) : '';
    return '<span class="home-band-chip" data-band="' + escapeHtml(safeBand) + '">'
      + escapeHtml(_bandLabel(safeBand)) + scoreTxt + '</span>';
  }

  function _bandLabel(band) {
    switch (band) {
      case 'thriving': return 'Thriving';
      case 'steady':   return 'Steady';
      case 'strained': return 'Strained';
      case 'depleted': return 'Depleted';
      default:         return 'Unknown';
    }
  }

  function _heroCardHtml(homeRec) {
    if (!homeRec) return '';
    const score = (homeRec.state && typeof homeRec.state.score === 'number') ? homeRec.state.score : null;
    const band = (homeRec.state && homeRec.state.band) ? homeRec.state.band : bandForScore(score);
    const headline = (typeof homeRec.headline === 'string') ? homeRec.headline : '';
    let s = '<section class="home-card home-hero" aria-label="This week’s balance">';
    s += '<div class="home-hero-header"><span class="home-hero-kicker">This week</span>'
      + _bandChip(band, score) + '</div>';
    if (headline) {
      s += '<p class="home-hero-headline">' + escapeHtml(headline) + '</p>';
    }
    s += '</section>';
    return s;
  }

  function _pillarCardsHtml(pillarModels) {
    const cards = pillarModels.filter((m) => m.hasData).map((m) => {
      let c = '<section class="home-card home-pillar-card" data-pillar-node="' + escapeHtml(m.node) + '">';
      c += '<div class="home-pillar-card-header">'
        + '<span class="home-pillar-card-title">' + escapeHtml(m.label) + '</span>'
        + _bandChip(m.band, m.score) + '</div>';
      if (m.headline) {
        c += '<p class="home-pillar-card-headline">' + escapeHtml(m.headline) + '</p>';
      }
      if (m.topSignal) {
        c += '<p class="home-pillar-card-signal">' + escapeHtml(m.topSignal) + '</p>';
      }
      c += '</section>';
      return c;
    });
    if (!cards.length) return '';
    return '<div class="home-pillar-cards">' + cards.join('') + '</div>';
  }

  function _movesHtml(homeRec) {
    const nudges = (homeRec && Array.isArray(homeRec.nudges)) ? homeRec.nudges.slice() : [];
    if (!nudges.length) return ''; // hidden when empty (daily glance)
    // Sort by priority ascending (1 = highest); missing priority sinks last.
    nudges.sort((a, b) => {
      const pa = (a && typeof a.priority === 'number') ? a.priority : 999;
      const pb = (b && typeof b.priority === 'number') ? b.priority : 999;
      return pa - pb;
    });
    const top = nudges.slice(0, 3).filter((nd) => nd && typeof nd.text === 'string' && nd.text.length);
    if (!top.length) return '';
    const rows = top.map((nd) =>
      '<li class="home-move-row">' + escapeHtml(nd.text) + '</li>'
    ).join('');
    return '<section class="home-card home-moves" aria-label="This week’s 3 moves">'
      + '<div class="home-moves-title">This week’s 3 moves</div>'
      + '<ol class="home-moves-list">' + rows + '</ol>'
      + '</section>';
  }

  function _emptyStateHtml() {
    return '<section class="home-card home-empty" aria-label="Home">'
      + '<div class="home-empty-mark" aria-hidden="true">○</div>'
      + '<div class="home-empty-title">Your week, at a glance</div>'
      + '<div class="home-empty-body">Sign in and run a synthesis to see your week.</div>'
      + '</section>';
  }

  // Build the full inner HTML string from cached records. Pure-ish: reads
  // SynthesisFeed (cache only) but touches no DOM. Returns a string.
  function _buildHtml() {
    let homeRec = null;
    let pillarRecs = {};
    try {
      if (typeof SynthesisFeed !== 'undefined') {
        if (typeof SynthesisFeed.getRecord === 'function') homeRec = SynthesisFeed.getRecord('home');
        if (typeof SynthesisFeed.getAllPillarRecords === 'function') pillarRecs = SynthesisFeed.getAllPillarRecords() || {};
      }
    } catch (_) { homeRec = null; pillarRecs = {}; }

    // Build per-pillar card models, carrying the raw record for lens sizing.
    const pillarModels = PILLARS.map((node) => {
      const rec = pillarRecs ? pillarRecs[node] : null;
      const model = pillarCardModel(node, rec);
      model.rec = rec || null;
      return model;
    });

    const anyPillarData = pillarModels.some((m) => m.hasData);
    if (!homeRec && !anyPillarData) {
      return _emptyStateHtml();
    }

    let html = '';
    html += _bubbleMapHtml(pillarModels);
    html += _heroCardHtml(homeRec);
    html += _pillarCardsHtml(pillarModels);
    html += _movesHtml(homeRec);
    return html;
  }

  // ── Render (the only DOM-touching entry point) ───────────────────────

  function _container() {
    return document.getElementById('home-pillar-body');
  }

  // Re-render only the bubble map (after a lens toggle) without rebuilding the
  // cards. Falls back to a full render if the bubble container is missing.
  function _renderBubblesOnly() {
    const root = _container();
    if (!root) return;
    const fig = root.querySelector('.home-bubblemap');
    if (!fig) { render(); return; }
    let pillarRecs = {};
    try {
      if (typeof SynthesisFeed !== 'undefined' && typeof SynthesisFeed.getAllPillarRecords === 'function') {
        pillarRecs = SynthesisFeed.getAllPillarRecords() || {};
      }
    } catch (_) { pillarRecs = {}; }
    const pillarModels = PILLARS.map((node) => {
      const rec = pillarRecs ? pillarRecs[node] : null;
      const model = pillarCardModel(node, rec);
      model.rec = rec || null;
      return model;
    });
    const tmp = document.createElement('div');
    tmp.innerHTML = _bubbleMapHtml(pillarModels);
    const next = tmp.firstChild;
    if (next) {
      // a11y: replaceWith removes the lens button the user just activated, which
      // would drop keyboard/SR focus to <body>. If focus was inside the toggle,
      // move it onto the matching button in the freshly-built node.
      const wasFocusedInToggle = !!(document.activeElement
        && fig.contains(document.activeElement)
        && document.activeElement.hasAttribute
        && document.activeElement.hasAttribute('data-home-lens'));
      fig.replaceWith(next);
      if (wasFocusedInToggle) {
        const active = next.querySelector('[data-home-lens="' + activeLens + '"]');
        if (active && typeof active.focus === 'function') { try { active.focus(); } catch (_) {} }
      }
    }
  }

  let _wired = false;

  function render() {
    const root = _container();
    if (!root) return;
    try {
      root.innerHTML = _buildHtml();
    } catch (_) {
      // Never throw on the render path — fall back to the calm empty state.
      try { root.innerHTML = _emptyStateHtml(); } catch (__) {}
    }
    // Wire the lens toggle once via delegation (survives re-renders).
    if (!_wired) {
      _wired = true;
      root.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('[data-home-lens]');
        if (!btn || !root.contains(btn)) return;
        const lens = btn.getAttribute('data-home-lens');
        if (!lens || lens === activeLens) return;
        if (lens === 'priority' || lens === 'importance' || lens === 'neglect') {
          activeLens = lens;
          _renderBubblesOnly();
        }
      });
    }
  }

  // Subscribe once so Home repaints the moment fresh synthesis records land in
  // the cache. render() reads the cache synchronously, but SynthesisFeed
  // .refreshAll() fills it asynchronously after boot / sign-in — without this, a
  // cold load shows the empty state until the user navigates away and back. Only
  // repaints when Home is the visible pillar; the navigate-to-Home path
  // (TempoNav → render()) covers the hidden case. Idempotent.
  let _subscribed = false;
  function init() {
    if (_subscribed) return;
    _subscribed = true;
    if (typeof SynthesisFeed !== 'undefined' && typeof SynthesisFeed.onUpdate === 'function') {
      SynthesisFeed.onUpdate(() => {
        const sec = document.querySelector('.tempo-pillar[data-pillar-id="home"]');
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
      bandColorVar,
      bandForScore,
      lensValue,
      normalizeRadii,
      pillarCardModel,
      PILLARS,
      LENSES,
      MIN_R,
      MAX_R,
    },
  };
})();
