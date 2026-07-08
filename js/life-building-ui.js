// Life Building hub UI (Life-OS Phase 5) — the dedicated deep-dive surface for
// the `life_building` domain pillar. Renders the council's single
// `life_building` synthesis record as:
//   (a) a hero — the composite Life Building score + band + headline;
//   (b) the Finances Area card — from the record's additive `areas[]` field
//       (label + band chip + signal), PLUS the four raw numbers from the
//       LOCAL Finances store (savingsRate / creditScore / debtRemaining /
//       netWorth for the current month) with a per-metric mini-status line;
//   (c) "This week's moves" — the record's own nudges (weekly only);
//   (d) the capture form — "Update this month's numbers" (recovery-ui pattern):
//       4 optional number inputs prefilled from the current month's snapshot →
//       Save → Finances.setMonth(currentMonth, partialPatch) → haptic + "Saved ✓";
//   (e) an empty state (the DEFAULT path) when nothing is cached yet, with
//       a prompt to add this month's numbers to get started.
//
// RENDER-FROM-CACHE for the verdict side. Mirrors js/physicals-ui.js +
// js/chickens-ui.js: the empty state is the default path, render() never
// throws, and EVERY record-derived string is escaped via escapeHtml
// (js/dom-utils.js). No live Firestore on the render path.
// SynthesisFeed.refreshAll() runs off-render (sign-in / boot); `life_building`
// is already in its node list (graduated from the seed in Phase 5). No change
// to synthesis-feed.js needed.
//
// The capture form hosts the ONE write path: Finances.setMonth() via the
// form submit handler. The hub never writes to synthesis/*.
//
// The Finances Area is the ONLY Area in slice 1; additional Areas (Habits,
// Admin, Values, Goals) slot into the same `areas[]` pattern in later slices.
// Reuses the home hub's --home-band-* tokens + .home-band-chip primitive.
window.LifeBuildingUI = (() => {
  // The Area render order (matches the council's AREA_KEYS). The record's
  // `areas[]` already carries this order; this is only a fallback label source.
  const AREA_LABELS = {
    finances: 'Finances',
  };

  // Human-readable labels for the four finance metrics (shown in the raw-numbers
  // breakdown on the Finances Area card).
  const METRIC_META = [
    { key: 'savingsRate',    label: 'Savings rate',   suffix: '%'  },
    { key: 'creditScore',    label: 'Credit score',   suffix: ''   },
    { key: 'debtRemaining',  label: 'Debt remaining', suffix: ''   },
    { key: 'netWorth',       label: 'Net worth',      suffix: ''   },
  ];

  // ── Pure helpers (exposed on _internals for tests; NO DOM here) ───────

  // 'finances' → 'Finances' (fallback when an area carries no label). Splits on
  // '_' and '/' and title-cases, same idiom as PhysicalsUI.titleCase.
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
  // hasData:false (the renderer shows "—" and an "Unknown" chip).
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

  // The hero model from the life_building record: composite score + band + headline.
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

  // Determine whether we should show the empty-state: no record from the feed,
  // OR record present but has no score AND no areas. Returns true for empty.
  function isEmptyState(rec) {
    if (!rec) return true;
    const hasScore = (rec.state && typeof rec.state.score === 'number' && isFinite(rec.state.score));
    const hasAreas = Array.isArray(rec.areas) && rec.areas.length > 0;
    return !hasScore && !hasAreas;
  }

  // Derive the current month as 'YYYY-MM' from the LOCAL clock. This is
  // intentionally local (not UTC) — the user's finances belong to their
  // current calendar month.
  function currentMonthKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return y + '-' + m;
  }

  // Build the prefill object for the capture form from a month record (or null).
  // Returns { savingsRate: string|'', creditScore: string|'', ... } — all values
  // are strings because HTML input.value is always a string. An absent / non-finite
  // metric yields '' (empty → unpopulated input).
  function formPrefillFrom(monthRecord) {
    const out = {};
    for (const { key } of METRIC_META) {
      const v = monthRecord && typeof monthRecord[key] === 'number' && isFinite(monthRecord[key])
        ? String(monthRecord[key])
        : '';
      out[key] = v;
    }
    return out;
  }

  // Read the form inputs from a container element and serialize to a partial patch
  // object — ONLY the filled fields (non-empty, finite number) are included. An
  // empty input is OMITTED (not written as 0) so the caller can do a partial merge.
  // Returns { savingsRate?: number, creditScore?: number, ... }.
  function serializeForm(container) {
    const patch = {};
    for (const { key } of METRIC_META) {
      const el = container && container.querySelector('[data-fin-input="' + key + '"]');
      if (!el) continue;
      const raw = el.value.trim();
      if (!raw) continue; // empty → omit
      const v = Number(raw);
      if (isFinite(v)) {
        patch[key] = v;
      }
    }
    return patch;
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
    let s = '<section class="home-card life-building-hero" aria-label="Life Building overall">';
    s += '<div class="life-building-hero-header">'
      + '<span class="life-building-hero-kicker">Life Building</span>'
      + _bandChip(hero.band, hero.score) + '</div>';
    if (hero.headline) {
      s += '<p class="life-building-hero-headline">' + escapeHtml(hero.headline) + '</p>';
    }
    return s + '</section>';
  }

  // The raw-numbers breakdown shown on the Finances Area card below the signal.
  // Reads the current month's record from the LOCAL Finances store (no fetch).
  // Each metric shows its value + a per-metric mini-status, or a "—" placeholder.
  function _rawNumbersHtml(monthRecord) {
    let rows = '';
    for (const { key, label, suffix } of METRIC_META) {
      const v = monthRecord && typeof monthRecord[key] === 'number' && isFinite(monthRecord[key])
        ? monthRecord[key] : null;
      let valTxt;
      if (v === null) {
        valTxt = '—';
      } else if (suffix === '%') {
        valTxt = escapeHtml(String(v)) + '%';
      } else {
        // Thousands separator for currency fields.
        valTxt = escapeHtml(v.toLocaleString('en-US', { maximumFractionDigits: 0 }));
      }
      rows += '<div class="life-building-raw-row">'
        + '<span class="life-building-raw-label">' + escapeHtml(label) + '</span>'
        + '<span class="life-building-raw-value">' + valTxt + '</span>'
        + '</div>';
    }
    if (!rows) return '';
    return '<div class="life-building-raw-numbers">' + rows + '</div>';
  }

  function _areaCardsHtml(areaModels, monthRecord) {
    if (!areaModels.length) return '';
    const cards = areaModels.map((m) => {
      const scoreForChip = m.hasData ? m.score : null;
      let c = '<section class="home-card life-building-area-card" data-area-key="' + escapeHtml(m.key) + '">';
      c += '<div class="life-building-area-card-header">'
        + '<span class="life-building-area-card-title">' + escapeHtml(m.label) + '</span>'
        + _bandChip(m.band, scoreForChip) + '</div>';
      if (m.signal) {
        c += '<p class="life-building-area-card-signal">' + escapeHtml(m.signal) + '</p>';
      }
      // The Finances Area card gets the raw-numbers breakdown from the LOCAL
      // Finances store (per-metric mini-status, not from the council record).
      if (m.key === 'finances') {
        c += _rawNumbersHtml(monthRecord);
      }
      return c + '</section>';
    }).join('');
    return '<div class="life-building-areas">' + cards + '</div>';
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
    return '<section class="home-card home-moves" aria-label="This week\'s moves">'
      + '<div class="home-moves-title">This week\'s moves</div>'
      + '<ol class="home-moves-list">' + rows + '</ol>'
      + '</section>';
  }

  // The capture form — "Update this month's numbers" (recovery-ui pattern).
  // 4 optional number inputs prefilled from the current month's snapshot.
  // Empty inputs are omitted from the Save patch (partial merge, not replace).
  function _captureFormHtml(prefill, month) {
    const displayMonth = escapeHtml(month || '');
    let inputs = '';
    for (const { key, label, suffix } of METRIC_META) {
      const val = escapeHtml((prefill && prefill[key]) || '');
      const ph = suffix === '%' ? '0–100' : '0';
      inputs += '<label class="life-building-form-label">'
        + '<span class="life-building-form-label-text">' + escapeHtml(label)
        + (suffix ? ' (' + escapeHtml(suffix) + ')' : '') + '</span>'
        + '<input class="life-building-form-input" type="number" inputmode="decimal"'
        + ' data-fin-input="' + escapeHtml(key) + '"'
        + ' placeholder="' + ph + '"'
        + ' autocomplete="off"'
        + (val ? ' value="' + val + '"' : '')
        + '>'
        + '</label>';
    }
    return '<section class="home-card life-building-capture" aria-label="Update finances">'
      + '<div class="life-building-capture-title">Update ' + displayMonth + ' numbers</div>'
      + '<form class="life-building-form" data-fin-form novalidate>'
      + inputs
      + '<div class="life-building-form-submit-row">'
      + '<button type="submit" class="life-building-form-save-btn">Save</button>'
      + '<span class="life-building-form-saved-msg" data-fin-saved aria-live="polite"></span>'
      + '</div>'
      + '</form>'
      + '</section>';
  }

  function _emptyStateHtml(month, prefill) {
    return '<section class="home-card life-building-empty" aria-label="Life Building">'
      + '<div class="life-building-empty-mark" aria-hidden="true">$</div>'
      + '<div class="life-building-empty-title">Your finances, at a glance</div>'
      + '<div class="life-building-empty-body">Add this month\'s numbers below to get started. '
      + 'The Life Building score appears after the council\'s next run.</div>'
      + '</section>'
      + _captureFormHtml(prefill || {}, month);
  }

  // Build the inner HTML from the cached life_building record + local Finances
  // store. Reads SynthesisFeed (cache only) and Finances.getMonth(). Returns
  // a string. Touches no DOM.
  function _buildHtml() {
    let rec = null;
    try {
      if (typeof SynthesisFeed !== 'undefined' && typeof SynthesisFeed.getRecord === 'function') {
        rec = SynthesisFeed.getRecord('life_building');
      }
    } catch (_) { rec = null; }

    const month = currentMonthKey();

    // Read the current month's raw numbers from the local Finances store (no fetch).
    let monthRecord = null;
    try {
      if (typeof Finances !== 'undefined' && typeof Finances.getMonth === 'function') {
        monthRecord = Finances.getMonth(month);
      }
    } catch (_) { monthRecord = null; }

    // Prefill for the capture form.
    const prefill = formPrefillFrom(monthRecord);

    // Empty-state check. Pass the prefill so the capture form shows any numbers
    // already entered for this month even before the council has run (the
    // empty state is the DEFAULT path for every user pre-council — finding B).
    if (isEmptyState(rec)) {
      return _emptyStateHtml(month, prefill);
    }

    const hero = heroModel(rec);
    const areaModels = areaModelsFrom(rec);
    let html = '';
    html += _heroHtml(hero);
    html += _areaCardsHtml(areaModels, monthRecord);
    html += _movesHtml(rec);
    // If the record was present but yielded no hero text AND no area cards,
    // fall through to the combined empty-state + capture-form prompt.
    if (!html) return _emptyStateHtml(month, prefill);
    // Always append the capture form below the verdict (the hub is a hybrid).
    html += _captureFormHtml(prefill, month);
    return html;
  }

  // ── Render (the only DOM-touching entry point) ───────────────────────

  function _container() {
    return document.getElementById('life-building-pillar-body');
  }

  function render() {
    const root = _container();
    if (!root) return;
    try {
      root.innerHTML = _buildHtml();
    } catch (_) {
      // Never throw on the render path — fall back to the calm empty state.
      try { root.innerHTML = _emptyStateHtml(currentMonthKey()); } catch (__) {}
    }
    _wireForm(root);
  }

  // ── Capture form wiring ──────────────────────────────────────────────

  function _wireForm(root) {
    if (!root) return;
    const form = root.querySelector('[data-fin-form]');
    if (!form) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const patch = serializeForm(form);
      // If the user submitted with everything blank, silently skip —
      // an empty patch does nothing meaningful.
      if (!Object.keys(patch).length) return;

      const month = currentMonthKey();
      let saved = false;
      try {
        if (typeof Finances !== 'undefined' && typeof Finances.setMonth === 'function') {
          const result = Finances.setMonth(month, patch);
          saved = (result !== null);
        }
      } catch (_) {}

      if (saved) {
        // Haptic feedback (ignored on desktop).
        try {
          if (typeof Platform !== 'undefined' && typeof Platform.haptic === 'function') {
            Platform.haptic(15);
          }
        } catch (_) {}
        // Repaint FIRST so the raw-numbers breakdown + the (now-prefilled) form
        // refresh. render() rebuilds innerHTML, so the "Saved ✓" flash must be
        // written to the FRESH node AFTER the repaint — writing it before (as
        // the original did) discards it on the same synchronous tick (finding A).
        render();
        const root = _container();
        const savedEl = root && root.querySelector('[data-fin-saved]');
        if (savedEl) {
          savedEl.textContent = 'Saved ✓';
          setTimeout(() => {
            try {
              const el = _container();
              const s = el && el.querySelector('[data-fin-saved]');
              if (s) s.textContent = '';
            } catch (_) {}
          }, 2500);
        }
      }
    });
  }

  // Subscribe once so the hub repaints the moment a fresh life_building record
  // lands in the cache (refreshAll fills it asynchronously after boot / sign-in).
  // Only repaints when Life Building is the visible pillar; the navigate-to-
  // LifeBuilding path (TempoNav → render()) covers the hidden case. Idempotent.
  let _subscribed = false;
  function init() {
    if (_subscribed) return;
    _subscribed = true;
    if (typeof SynthesisFeed !== 'undefined' && typeof SynthesisFeed.onUpdate === 'function') {
      SynthesisFeed.onUpdate(() => {
        const sec = document.querySelector('.tempo-pillar[data-pillar-id="life-building"]');
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
      isEmptyState,
      currentMonthKey,
      formPrefillFrom,
      serializeForm,
      _captureFormHtml,
      _emptyStateHtml,
      AREA_LABELS,
      METRIC_META,
    },
  };
})();
