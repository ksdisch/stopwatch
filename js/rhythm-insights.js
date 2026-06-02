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

  // Sleep-quality 1→5 mapped red→green. null/unknown → muted grey. The two
  // mid values use literal hex (no theme var for yellow), endpoints use theme
  // vars so they track light/dark.
  function qualityColor(q) {
    switch (q) {
      case 1: return 'var(--red)';
      case 2: return '#ff9f0a';
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

  // ── renderInto ─────────────────────────────────────────────────────
  // Builds every registered panel's model concurrently (Promise.allSettled so
  // one panel's failure — e.g. a cloud read — can't blank the board), then
  // writes the container once and wires a single delegated click listener for
  // panel toggles. Safe to call repeatedly (every route to the Insights sub).
  let _lastRender = null;

  async function renderInto(container, opts) {
    if (!container) return;
    opts = opts || {};
    _lastRender = { container: container, opts: opts };
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
    }
  }

  return {
    register, getPanels, has, renderInto, _deps,
    windowDays, bucketByDay, sumByDay,
    svgScaffold, linePoints, polyline, area,
    qualityColor, fmtHour, card, empty,
    // Exposed for tests; not part of the app-facing surface.
    _internals: { panelState, _panelState },
  };
})();
