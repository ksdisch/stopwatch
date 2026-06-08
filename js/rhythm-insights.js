// Rhythm Insights — foundation for the multi-panel insights dashboard
// (backlog #12). Owns a panel registry, a dependency-injected data layer,
// a set of shared inline-SVG chart helpers (mirroring js/analytics-ui.js so
// the visual language stays consistent), and renderInto() which paints all
// registered panels into a container.
//
// Each panel lives in its own js/rhythm-panel-<key>.js and self-registers via
// RhythmInsights.register({ key, title, order, build, render }). Panels are
// pure: build(deps, ctx) reads ONLY via the injected deps (live defaults,
// overridable for tests) and returns a plain model; render(model, ctx) returns
// card HTML and must never throw. This keeps panels disjoint + parallelizable.
const RhythmInsights = (() => {

  // ── Panel registry ─────────────────────────────────────────────────
  // Registration order is NOT load order: getPanels() sorts by the panel's
  // own `order` field (ascending), tie-broken by registration sequence.
  const _panels = [];
  let _seq = 0;

  function register(panel) {
    if (!panel || typeof panel.key !== 'string'
        || typeof panel.build !== 'function' || typeof panel.render !== 'function') {
      return; // invalid shape — ignore rather than throw at load time
    }
    const entry = {
      key: panel.key,
      title: typeof panel.title === 'string' ? panel.title : panel.key,
      order: typeof panel.order === 'number' ? panel.order : 100,
      build: panel.build,
      render: panel.render,
      _seq: _seq++,
    };
    const existing = _panels.findIndex(p => p.key === panel.key);
    if (existing >= 0) _panels[existing] = entry; // dedupe by key — last wins
    else _panels.push(entry);
  }

  function getPanels() {
    return _panels.slice().sort((a, b) => (a.order - b.order) || (a._seq - b._seq));
  }

  function has(key) {
    return _panels.some(p => p.key === key);
  }

  // ── Per-panel UI state (toggles / selections) ──────────────────────
  // Kept in module scope keyed by panel key, NOT in the URL hash — the hash
  // router (tempo-nav.js) parses exactly two segments (pillar/sub), so a third
  // toggle segment would need a parser change. Panels read/write their bag via
  // ctx.state(key).
  const _panelState = {};
  function panelState(key) {
    return _panelState[key] || (_panelState[key] = {});
  }

  // ── Dependency-injected data layer ─────────────────────────────────
  // Live defaults; every accessor is null-safe and returns the documented
  // empty value when its source module is absent, so panels never throw and
  // tests can override any single accessor.
  function _deps() {
    return {
      now: () => Date.now(),
      getSessions: async () =>
        (typeof History !== 'undefined' && History.getSessions) ? await History.getSessions() : [],
      getMeds: () =>
        (typeof MedsManager !== 'undefined' && MedsManager.all) ? MedsManager.all() : [],
      getRestLog: () =>
        (typeof RecoveryUI !== 'undefined' && RecoveryUI.loadLog) ? RecoveryUI.loadLog() : {},
      getRecoveryHistory: () => {
        if (typeof RecoveryFeed === 'undefined' || !RecoveryFeed.getHistory) return { rows: [] };
        return RecoveryFeed.getHistory() || { rows: [] }; // CLOUD-DEPENDENT → {rows:[]} when signed out
      },
      getBfrbEvents: () =>
        (typeof BfrbEvents !== 'undefined' && BfrbEvents.getAll) ? BfrbEvents.getAll() : [],
      getBfrbTrend: async (days) =>
        (typeof Analytics !== 'undefined' && Analytics.getBFRBTrend)
          ? await Analytics.getBFRBTrend(days)
          : { days: days, series: [], total: 0, hourly: [], bySource: {} },
      getDistractions: async () =>
        (typeof Analytics !== 'undefined' && Analytics.getDistractions)
          ? await Analytics.getDistractions()
          : { total: 0, top5: [], hourly: [] },
      getDayTimeline: async (date) =>
        (typeof Rhythm !== 'undefined' && Rhythm.getDayTimeline) ? await Rhythm.getDayTimeline(date) : [],
    };
  }

  // ── Shared date / bucketing helpers ────────────────────────────────

  // n local-day buckets oldest→newest ending today. Uses the Date(y,m,d)
  // constructor (not ms subtraction) so DST transitions land on real local
  // midnights. Each: { key 'YYYY-MM-DD', date, start ms, end ms, label 'M/D' }.
  function windowDays(n, now) {
    if (typeof now !== 'number') now = Date.now();
    const base = new Date(now);
    base.setHours(0, 0, 0, 0);
    const y = base.getFullYear(), m = base.getMonth(), d = base.getDate();
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const date = new Date(y, m, d - i);
      const endDate = new Date(y, m, d - i + 1);
      out.push({
        key: Utils.localDateKey(date),
        date,
        start: date.getTime(),
        end: endDate.getTime(),
        label: (date.getMonth() + 1) + '/' + date.getDate(),
      });
    }
    return out;
  }

  // Bucket items into the windowDays(days) day-keys via local date. Items
  // outside the window (or with a non-finite timestamp) are dropped. Returns
  // a Map<dayKey, item[]> with every window key present (possibly empty).
  function bucketByDay(items, getMs, days, now) {
    const win = windowDays(days, now);
    const map = new Map();
    win.forEach(w => map.set(w.key, []));
    (items || []).forEach(it => {
      const ms = getMs(it);
      if (typeof ms !== 'number' || !isFinite(ms)) return;
      const key = Utils.localDateKey(new Date(ms));
      if (map.has(key)) map.get(key).push(it);
    });
    return map;
  }

  // Per-day sum of getVal aligned to windowDays (0-filled). Returns
  // [{ key, label, value }] oldest→newest.
  function sumByDay(items, getMs, getVal, days, now) {
    const win = windowDays(days, now);
    const map = bucketByDay(items, getMs, days, now);
    return win.map(w => ({
      key: w.key,
      label: w.label,
      value: (map.get(w.key) || []).reduce((s, it) => s + (getVal(it) || 0), 0),
    }));
  }

  // ── Shared SVG chart helpers (analytics-ui.js idiom) ───────────────

  function svgScaffold(o) {
    o = o || {};
    const W = o.w != null ? o.w : 320;
    const H = o.h != null ? o.h : 88;
    const padL = o.padL != null ? o.padL : 4;
    const padR = o.padR != null ? o.padR : 4;
    const padT = o.padT != null ? o.padT : 6;
    const padB = o.padB != null ? o.padB : 14;
    return { W, H, padL, padR, padT, padB, innerW: W - padL - padR, innerH: H - padT - padB };
  }

  // Map a numeric series to SVG coords. Single value → centered horizontally.
  // max defaults to the series max (min 1). Returns [{x, y, value}].
  function linePoints(values, dims, max) {
    const n = values.length;
    const m = (max != null ? max : Math.max(1, ...values)) || 1;
    return values.map((v, i) => {
      const x = dims.padL + (n === 1 ? dims.innerW / 2 : (i * dims.innerW) / (n - 1));
      const y = dims.padT + dims.innerH - ((v || 0) / m) * dims.innerH;
      return { x: x, y: y, value: v };
    });
  }

  function polyline(points) {
    return points.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
  }

  // Closed area polygon (baseline → series → baseline) for fill-under-line.
  function area(points, dims) {
    if (!points.length) return '';
    const base = dims.padT + dims.innerH;
    return dims.padL + ',' + base + ' ' + polyline(points) + ' ' + (dims.padL + dims.innerW) + ',' + base;
  }

  // Sleep-quality 1→5 mapped red→green. null/unknown → muted grey. Endpoints +
  // the amber step use theme vars so they track light/dark; the two pure-yellow
  // mid steps stay literal (no yellow token in the palette).
  function qualityColor(q) {
    switch (q) {
      case 1: return 'var(--red)';
      case 2: return 'var(--amber)';
      case 3: return '#ffd60a';
      case 4: return '#9acd32';
      case 5: return 'var(--green)';
      default: return 'var(--text-secondary)';
    }
  }

  // 0..23 (handles negative / >24 via mod) → '7 AM'. Mirrors hourLabel in
  // analytics-ui.js so axis labels read identically.
  function fmtHour(h) {
    h = ((Math.round(h) % 24) + 24) % 24;
    if (h === 0) return '12 AM';
    if (h === 12) return '12 PM';
    if (h < 12) return h + ' AM';
    return (h - 12) + ' PM';
  }

  // ── Axis / gridline helpers ────────────────────────────────────────
  // Pixel-based + composable: the panel owns its data→pixel scale and passes
  // already-projected coordinates, so these stay scale-agnostic and every SVG
  // panel draws ticks/gridlines/labels identically. Styling lives in CSS
  // (.rhythm-gridline / .rhythm-axis-line / .rhythm-axis-text) so themes track.

  // Faint gridlines at the given inner-plot pixel positions.
  // opts: { xs: [pxX...], ys: [pxY...] } — vertical lines at xs, horizontal at ys.
  function gridlines(dims, opts) {
    opts = opts || {};
    const x0 = dims.padL, x1 = dims.padL + dims.innerW;
    const y0 = dims.padT, y1 = dims.padT + dims.innerH;
    let s = '';
    (opts.ys || []).forEach(y => {
      y = +y;
      if (!isFinite(y) || !isFinite(x0) || !isFinite(x1)) return; // skip bad coords (→ no NaN attrs)
      s += '<line class="rhythm-gridline" x1="' + x0.toFixed(1) + '" y1="' + y.toFixed(1)
        + '" x2="' + x1.toFixed(1) + '" y2="' + y.toFixed(1) + '"/>';
    });
    (opts.xs || []).forEach(x => {
      x = +x;
      if (!isFinite(x) || !isFinite(y0) || !isFinite(y1)) return;
      s += '<line class="rhythm-gridline" x1="' + x.toFixed(1) + '" y1="' + y0.toFixed(1)
        + '" x2="' + x.toFixed(1) + '" y2="' + y1.toFixed(1) + '"/>';
    });
    return s;
  }

  // Bottom axis: baseline + per-tick mark + label. ticks: [{ x: pxX, label }].
  // Label anchor auto-clamps at the plot edges so end labels don't clip.
  function xAxis(dims, ticks, opts) {
    opts = opts || {};
    const baseY = dims.padT + dims.innerH;
    const x0 = dims.padL, x1 = dims.padL + dims.innerW;
    const okExtent = isFinite(baseY) && isFinite(x0) && isFinite(x1);
    let s = '';
    if (opts.baseline !== false && okExtent) {
      s += '<line class="rhythm-axis-line" x1="' + x0.toFixed(1) + '" y1="' + baseY.toFixed(1)
        + '" x2="' + x1.toFixed(1) + '" y2="' + baseY.toFixed(1) + '"/>';
    }
    (ticks || []).forEach(t => {
      const x = +t.x;
      if (!isFinite(x) || !okExtent) return; // skip bad coords (→ no NaN attrs)
      const anchor = x <= x0 + 0.5 ? 'start' : x >= x1 - 0.5 ? 'end' : 'middle';
      s += '<line class="rhythm-axis-line" x1="' + x.toFixed(1) + '" y1="' + baseY.toFixed(1)
        + '" x2="' + x.toFixed(1) + '" y2="' + (baseY + 3).toFixed(1) + '"/>';
      s += '<text class="rhythm-axis-text" x="' + x.toFixed(1) + '" y="' + (baseY + 11).toFixed(1)
        + '" text-anchor="' + anchor + '">' + escapeHtml(String(t.label)) + '</text>';
    });
    return s;
  }

  // Left axis: vertical baseline + right-anchored horizontal labels. Needs a
  // padL wide enough to hold the labels. ticks: [{ y: pxY, label }].
  function yAxis(dims, ticks, opts) {
    opts = opts || {};
    const x0 = dims.padL;
    const y0 = dims.padT, y1 = dims.padT + dims.innerH;
    const okExtent = isFinite(x0) && isFinite(y0) && isFinite(y1);
    let s = '';
    if (opts.baseline !== false && okExtent) {
      s += '<line class="rhythm-axis-line" x1="' + x0.toFixed(1) + '" y1="' + y0.toFixed(1)
        + '" x2="' + x0.toFixed(1) + '" y2="' + y1.toFixed(1) + '"/>';
    }
    (ticks || []).forEach(t => {
      const y = +t.y;
      if (!isFinite(y) || !isFinite(x0)) return; // skip bad coords (→ no NaN attrs)
      s += '<text class="rhythm-axis-text" x="' + (x0 - 4).toFixed(1) + '" y="' + (y + 3).toFixed(1)
        + '" text-anchor="end">' + escapeHtml(String(t.label)) + '</text>';
    });
    return s;
  }

  // ~count round tick values 0..max. Steps snap to 1/2/5×10ⁿ and the last tick
  // is the smallest nice multiple ≥ max — so a panel can use it as the axis max
  // for clean alignment. Returns ascending numbers (always starts at 0).
  function niceTicks(max, count) {
    max = (typeof max === 'number' && isFinite(max) && max > 0) ? max : 1;
    count = (count && count > 0) ? count : 4;
    const rawStep = max / count;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    const niceMax = Math.ceil(max / step) * step;
    const out = [];
    for (let v = 0; v <= niceMax + step * 1e-6; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }

  // ── Card chrome (reuses .analytics-card* CSS) ──────────────────────
  // label is escaped (always plain text); aside + body are trusted markup
  // built by the panel's render(). data-insight-panel is a stable hook for
  // CSS + tests.
  function card(opts) {
    opts = opts || {};
    const asideHtml = opts.aside ? '<div class="analytics-card-aside">' + opts.aside + '</div>' : '';
    const classes = ['analytics-card', 'rhythm-insight-card', opts.className].filter(Boolean).join(' ');
    return '<section class="' + classes + '" data-insight-panel="' + escapeHtml(opts.key || '') + '"'
      + ' aria-label="' + escapeHtml(opts.label || '') + '">'
      + '<div class="analytics-card-header-row">'
      + '<div class="analytics-card-header">' + escapeHtml(opts.label || '') + '</div>'
      + asideHtml
      + '</div>'
      + (opts.body || '')
      + '</section>';
  }

  function empty(msg) {
    return '<div class="rhythm-insight-empty">' + escapeHtml(msg || 'Nothing to show yet.') + '</div>';
  }

  // ── Shared hover tooltip + cross-panel day highlight ───────────────
  // One positioned <div> on <body> (created lazily) follows the cursor and
  // shows the hovered element's data-tip text. Separately, hovering any element
  // carrying data-day="YYYY-MM-DD" outlines EVERY element with the same data-day
  // across all panels (the synchronized cross-panel crosshair). Both are driven
  // by the single delegated listener wired in renderInto — panels stay pure,
  // emitting only inert data-tip / data-day attributes.
  let _tipEl = null;
  let _tipVisible = false;
  let _hiDay = null;

  function _ensureTipEl() {
    if (_tipEl || typeof document === 'undefined' || !document.body) return _tipEl;
    _tipEl = document.createElement('div');
    _tipEl.className = 'rhythm-tooltip';
    _tipEl.setAttribute('role', 'tooltip');
    _tipEl.hidden = true;
    document.body.appendChild(_tipEl);
    return _tipEl;
  }

  // el null → hide. Content set via textContent (no markup), so panel-supplied
  // data-tip text is rendered safely regardless of its characters.
  function _showTip(el, e) {
    if (!el) {
      if (_tipEl) _tipEl.hidden = true;
      _tipVisible = false;
      return;
    }
    const tip = _ensureTipEl();
    if (!tip) return;
    tip.textContent = el.getAttribute('data-tip') || '';
    tip.hidden = false;
    _tipVisible = true;
    if (e) _moveTip(e);
  }

  function _moveTip(e) {
    if (!_tipEl) return;
    const pad = 12;
    const vw = window.innerWidth || 320, vh = window.innerHeight || 480;
    const w = _tipEl.offsetWidth || 0, h = _tipEl.offsetHeight || 0;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + w > vw - 4) x = Math.max(4, e.clientX - w - pad);
    if (y + h > vh - 4) y = Math.max(4, e.clientY - h - pad);
    _tipEl.style.left = x + 'px';
    _tipEl.style.top = y + 'px';
  }

  // Toggle .rhythm-day-hi on every element in `container` sharing `day`. Pass a
  // falsy day to clear. No-op when the highlighted day is unchanged.
  function _highlightDay(container, day) {
    if (day === _hiDay) return;
    if (_hiDay != null) {
      container.querySelectorAll('.rhythm-day-hi')
        .forEach(el => el.classList.remove('rhythm-day-hi'));
    }
    _hiDay = day || null;
    if (day) {
      const esc = (window.CSS && CSS.escape) ? CSS.escape(day) : String(day).replace(/"/g, '\\"');
      container.querySelectorAll('[data-day="' + esc + '"]')
        .forEach(el => el.classList.add('rhythm-day-hi'));
    }
  }

  // Drop any floating tooltip + cross-panel highlight. Called by renderInto
  // before it rebuilds the DOM (the highlighted / tooltip-described nodes are
  // about to be destroyed, and _hiDay must reset so a same-day re-hover
  // re-applies), and by the consumer when it hides the Insights surface (so a
  // tooltip can't linger over another view after a keyboard / hash route away
  // that fires no mouse event). Idempotent.
  function resetHover() {
    _showTip(null);
    if (_lastRender && _lastRender.container) _highlightDay(_lastRender.container, null);
    else _hiDay = null;
  }

  // ── renderInto ─────────────────────────────────────────────────────
  // Builds every registered panel's model concurrently (Promise.allSettled so
  // one panel's failure — e.g. a cloud read — can't blank the board), then
  // writes the container once and wires a single delegated listener for panel
  // toggles (click) + hover tooltip / cross-panel highlight (mouse events).
  // Safe to call repeatedly (every route to the Insights sub).
  let _lastRender = null;

  async function renderInto(container, opts) {
    if (!container) return;
    opts = opts || {};
    _lastRender = { container: container, opts: opts };
    resetHover(); // the innerHTML rebuild below destroys the nodes a live tooltip/highlight points at
    const days = opts.days != null ? opts.days : 14;

    // Merge deps over live defaults, then memoize getSessions for THIS render
    // so panels 3/4/6/7 share a single History read instead of N reads.
    const deps = Object.assign({}, _deps(), opts.deps || {});
    const origGetSessions = deps.getSessions;
    let sessionsPromise = null;
    deps.getSessions = () => {
      if (!sessionsPromise) sessionsPromise = Promise.resolve(origGetSessions());
      return sessionsPromise;
    };

    const ctx = { state: panelState, days: days, container: container };
    const panels = getPanels();

    container.innerHTML = '<div class="rhythm-insights-loading">Loading…</div>';

    const settled = await Promise.allSettled(panels.map(p => {
      try { return Promise.resolve(p.build(deps, ctx)); }
      catch (e) { return Promise.reject(e); }
    }));

    let html = '';
    panels.forEach((p, i) => {
      const r = settled[i];
      if (r.status === 'fulfilled') {
        try {
          html += p.render(r.value, ctx);
        } catch (e) {
          html += card({ key: p.key, label: p.title, body: empty('Could not render this panel.') });
        }
      } else {
        html += card({ key: p.key, label: p.title, body: empty('Could not load this panel.') });
      }
    });

    container.innerHTML = panels.length ? html : empty('No insight panels registered.');

    if (!container.dataset.insightsWired) {
      container.dataset.insightsWired = '1';
      container.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('[data-insight-action]');
        if (!btn || !container.contains(btn)) return;
        // action = "<panelKey>:<field>:<value>" (med ids have no ':')
        const parts = (btn.dataset.insightAction || '').split(':');
        if (parts.length < 3) return;
        panelState(parts[0])[parts[1]] = parts.slice(2).join(':');
        if (_lastRender) renderInto(_lastRender.container, _lastRender.opts);
      });
      // Hover tooltip + cross-panel highlight. mouseover bubbles, so it fires
      // on every entered element: a [data-tip]/[data-day] ancestor shows/
      // highlights; entering bare chart space (no such ancestor) clears both.
      container.addEventListener('mouseover', (e) => {
        const tEl = e.target.closest && e.target.closest('[data-tip]');
        _showTip(tEl && container.contains(tEl) ? tEl : null, e);
        const dEl = e.target.closest && e.target.closest('[data-day]');
        _highlightDay(container, (dEl && container.contains(dEl)) ? dEl.getAttribute('data-day') : null);
      });
      container.addEventListener('mousemove', (e) => {
        if (_tipVisible) _moveTip(e);
      });
      container.addEventListener('mouseleave', () => {
        _showTip(null);
        _highlightDay(container, null);
      });
    }
  }

  return {
    register, getPanels, has, renderInto, resetHover, _deps,
    windowDays, bucketByDay, sumByDay,
    svgScaffold, linePoints, polyline, area,
    qualityColor, fmtHour, gridlines, xAxis, yAxis, niceTicks, card, empty,
    // Exposed for tests; not part of the app-facing surface.
    _internals: { panelState, _panelState },
  };
})();
