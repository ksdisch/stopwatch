// Tempo navigation — pillar tabs + sub-nav + hash routing.
//
// Pillars:
//   timers     → wraps existing Stopwatch / Timer / Pomodoro / Flow / Interval / Cooking modes
//   wellness   → placeholder surfaces (Meds / Exercise / Mindful / Cooking / Recovery)
//   rhythm     → placeholder
//   analytics  → opens the existing Analytics panel
//
// Hash routing (per docs/TEMPO-PLAN §10):
//   #/timers            → stopwatch (default)
//   #/timers/countdown  → timer
//   #/timers/pomodoro   → pomodoro
//   #/timers/flow       → flow
//   #/timers/interval   → interval
//   #/timers/cook       → cooking
//   #/wellness[/:sub]   → wellness pillar, optional sub-nav
//   #/rhythm            → rhythm pillar
//   #/analytics         → analytics pillar
//
// Legacy URL support: ?mode=X is mapped to the right hash and replaced
// in-place so the URL bar reflects the new scheme.

const TempoNav = (() => {
  const PILLAR_PRODUCTIVITY = 'productivity';  // for data-pillar (CSS token key)
  const PILLAR_WELLNESS     = 'wellness';

  // Pillar metadata. id is the URL segment. mode is the app-mode each
  // Timers sub-nav button maps to (via data-app-mode). Wellness/Rhythm
  // are placeholder-only for this branch.
  const TIMERS_MODES = {
    'stopwatch': { sub: '',          appMode: 'stopwatch' },
    'countdown': { sub: 'countdown', appMode: 'timer'     },
    'pomodoro':  { sub: 'pomodoro',  appMode: 'pomodoro'  },
    'flow':      { sub: 'flow',      appMode: 'flow'      },
    'interval':  { sub: 'interval',  appMode: 'interval'  },
    'cook':      { sub: 'cook',      appMode: 'cooking'   },
  };

  // Reverse map: app-mode → URL sub segment (for writing the hash when
  // switchAppMode runs through the legacy mode selector path).
  const MODE_TO_SUB = {
    stopwatch: '',
    timer:     'countdown',
    pomodoro:  'pomodoro',
    flow:      'flow',
    interval:  'interval',
    cooking:   'cook',
  };

  const LEGACY_QUERY_MAP = {
    stopwatch: '#/timers',
    timer:     '#/timers/countdown',
    pomodoro:  '#/timers/pomodoro',
    flow:      '#/timers/flow',
    interval:  '#/timers/interval',
    cooking:   '#/timers/cook',
  };

  let activePillar = 'timers';  // 'timers' | 'wellness' | 'rhythm' | 'analytics'
  let initialised  = false;

  function init() {
    if (initialised) return;
    initialised = true;

    migrateLegacyQuery();

    wireTabBar();
    wireSubNav();
    wireSettingsDrawer();
    wireWellnessPlaceholderCTA();
    wireAnalyticsPillarOpener();

    // Resolve initial route from URL hash. If none, honour the persisted
    // app_mode that app.js already restored — otherwise a fresh load with
    // no hash would reset the user from (say) pomodoro back to stopwatch.
    const hash = window.location.hash;
    const route = hash
      ? parseHash(hash)
      : { pillar: 'timers', sub: MODE_TO_SUB[currentAppMode()] ?? '' };
    applyRoute(route);

    window.addEventListener('hashchange', () => {
      applyRoute(parseHash(window.location.hash), { updateHash: false });
    });
  }

  // ── URL handling ─────────────────────────────────────────────────────

  function migrateLegacyQuery() {
    const params = new URLSearchParams(window.location.search);
    const legacy = params.get('mode');
    if (!legacy) return;
    const hash = LEGACY_QUERY_MAP[legacy];
    if (!hash) return;
    // Preserve any other query params (there shouldn't be any, but be safe).
    params.delete('mode');
    const qs = params.toString();
    const url = window.location.pathname + (qs ? `?${qs}` : '') + hash;
    window.history.replaceState({}, '', url);
  }

  function parseHash(hash) {
    // Normalize "#/timers/pomodoro" → ["timers", "pomodoro"]
    const raw = (hash || '').replace(/^#\/?/, '');
    const parts = raw.split('/').filter(Boolean);
    const pillar = parts[0] || 'timers';
    const sub    = parts[1] || '';
    return { pillar, sub };
  }

  function writeHash(pillar, sub) {
    const suffix = sub ? `/${sub}` : '';
    const next = `#/${pillar}${suffix}`;
    if (window.location.hash !== next) {
      // Use replaceState — pushState would pollute the back stack on
      // every sub-nav tap.
      window.history.replaceState({}, '', window.location.pathname +
        window.location.search + next);
    }
  }

  // ── Applying a route ─────────────────────────────────────────────────

  function applyRoute({ pillar, sub }, { updateHash = true } = {}) {
    if (!['timers', 'wellness', 'rhythm', 'analytics'].includes(pillar)) {
      pillar = 'timers';
    }
    activePillar = pillar;

    // 1) Pillar-level visibility. Each .tempo-pillar[data-pillar-id] has
    //    data-active toggled; CSS drives display:contents on the active
    //    one only.
    document.querySelectorAll('.tempo-pillar').forEach(el => {
      el.dataset.active = (el.dataset.pillarId === pillar) ? 'true' : 'false';
    });

    // 2) Token pillar (productivity vs wellness). Rhythm and Analytics
    //    reuse the productivity blue — feels right for data/chart tabs.
    const tokenPillar = (pillar === 'wellness') ? PILLAR_WELLNESS : PILLAR_PRODUCTIVITY;
    document.body.dataset.pillar = tokenPillar;
    const appEl = document.getElementById('app');
    if (appEl) appEl.dataset.pillar = tokenPillar;

    // 3) Sub-nav — show only the buttons for this pillar. Pillars with
    //    no sub-nav (rhythm, analytics) hide the whole strip.
    const subnav = document.querySelector('.tempo-subnav');
    if (subnav) {
      subnav.dataset.pillar = pillar;
      const hasSub = (pillar === 'timers' || pillar === 'wellness');
      subnav.dataset.empty = hasSub ? 'false' : 'true';
    }

    // 4) Bottom tab bar aria-current state.
    document.querySelectorAll('.tempo-tab').forEach(t => {
      const isActive = t.dataset.pillarTarget === pillar;
      if (isActive) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });

    // 5) Pillar-specific behaviour.
    if (pillar === 'timers') {
      const desc = TIMERS_MODES[sub] || TIMERS_MODES['stopwatch'];
      // Delegate to the existing mode-switch flow so render loops, DOM
      // hide/show, etc. all run.
      if (typeof window.switchAppMode === 'function') {
        window.switchAppMode(desc.appMode);
      }
      // Sub-nav visual state follows the app-mode.
      syncSubnavActive('timers', desc.sub);
    } else if (pillar === 'wellness') {
      // Apply wellness sub-nav visual state only; all tiles are placeholder.
      syncSubnavActive('wellness', sub || 'meds');
      showWellnessSub(sub || 'meds');
    } else if (pillar === 'analytics') {
      // Placeholder shows an "Open dashboard" CTA that opens the existing
      // analytics slide-up panel on demand. Keeping it one tap away avoids
      // double-layering the pillar placeholder under an auto-opened panel.
    }

    if (updateHash) writeHash(pillar, sub);
  }

  function syncSubnavActive(pillar, sub) {
    document.querySelectorAll('.tempo-subnav [data-subnav-for] button').forEach(btn => {
      const forPillar = btn.parentElement?.dataset.subnavFor;
      if (forPillar !== pillar) return;
      const isActive = (btn.dataset.subnavKey || '') === sub;
      if (pillar === 'timers') {
        // Preserve the legacy .mode-tab-active class so existing JS that
        // introspects it keeps working.
        btn.classList.toggle('mode-tab-active', isActive);
      } else {
        btn.classList.toggle('is-active', isActive);
      }
    });
  }

  function showWellnessSub(sub) {
    document.querySelectorAll('[data-wellness-sub]').forEach(el => {
      el.hidden = (el.dataset.wellnessSub !== sub);
    });
  }

  // ── Wiring ───────────────────────────────────────────────────────────

  function wireTabBar() {
    document.querySelectorAll('.tempo-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.pillarTarget;
        if (!target) return;
        const route = (target === 'timers')
          ? resumeTimersRoute()
          : { pillar: target, sub: (target === 'wellness') ? 'meds' : '' };
        applyRoute(route);
      });
    });
  }

  function currentAppMode() {
    // Source of truth for the active Timers mode is the DOM: app.js marks
    // the current sub-nav button with .mode-tab-active via applyAppMode.
    // Reading that avoids depending on window.appMode staying in sync with
    // the module-scoped `appMode` let in app.js.
    const active = document.querySelector('.mode-tab.mode-tab-active');
    return active?.dataset.appMode || 'stopwatch';
  }

  function resumeTimersRoute() {
    // When returning to Timers from another pillar, land on whichever
    // mode the app is already tracking — preserves the user's last-used
    // Timers mode.
    return { pillar: 'timers', sub: MODE_TO_SUB[currentAppMode()] ?? '' };
  }

  function wireSubNav() {
    // Wellness sub-nav items — Timers sub-nav is driven by the existing
    // .mode-tab wiring in app.js. We just add a click listener that
    // writes the URL hash when a Timers sub-nav button is activated,
    // so back/forward and deep-linking both behave.
    document.querySelectorAll('[data-subnav-for="timers"] button').forEach(btn => {
      btn.addEventListener('click', () => {
        const sub = btn.dataset.subnavKey || '';
        writeHash('timers', sub);
      });
    });
    document.querySelectorAll('[data-subnav-for="wellness"] button').forEach(btn => {
      btn.addEventListener('click', () => {
        const sub = btn.dataset.subnavKey || 'meds';
        applyRoute({ pillar: 'wellness', sub });
      });
    });
  }

  function wireSettingsDrawer() {
    const toggle = document.getElementById('tempo-settings-toggle');
    const drawer = document.getElementById('tempo-settings-drawer');
    if (!toggle || !drawer) return;

    const syncExpanded = () => {
      toggle.setAttribute('aria-expanded',
        drawer.classList.contains('hidden') ? 'false' : 'true');
    };
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      drawer.classList.toggle('hidden');
      syncExpanded();
    });
    document.addEventListener('click', (e) => {
      if (drawer.classList.contains('hidden')) return;
      if (!drawer.contains(e.target) && !toggle.contains(e.target)) {
        drawer.classList.add('hidden');
        syncExpanded();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !drawer.classList.contains('hidden')) {
        drawer.classList.add('hidden');
        syncExpanded();
        toggle.focus();
      }
    });
    // Items inside the drawer keep their legacy IDs (theme-toggle, sound-
    // toggle, presets-toggle, log-session-toggle, focus-toggle) so their
    // existing click handlers fire. We only need to close the drawer
    // after an item is activated; setTimeout gives the handler a tick to
    // open its own panel first.
    drawer.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        setTimeout(() => {
          drawer.classList.add('hidden');
          syncExpanded();
        }, 0);
      });
    });
  }

  function wireWellnessPlaceholderCTA() {
    // Placeholder CTA buttons carry data-cta-route="pillar:sub".
    // `timers:` with no sub is a special case — "Back to Timers" should
    // restore the user's last Timers mode, not force stopwatch.
    document.querySelectorAll('[data-cta-route]').forEach(btn => {
      btn.addEventListener('click', () => {
        const [pillar, sub = ''] = btn.dataset.ctaRoute.split(':');
        if (pillar === 'timers' && !sub) {
          applyRoute(resumeTimersRoute());
        } else {
          applyRoute({ pillar, sub });
        }
      });
    });
  }

  function wireAnalyticsPillarOpener() {
    // When Analytics tab is clicked, applyRoute calls openAnalyticsPanel.
    // We also need to send the user back to Timers when they close the
    // analytics panel, so the shell doesn't sit on an empty pillar.
    const closeBtn = document.getElementById('analytics-close');
    if (!closeBtn) return;
    closeBtn.addEventListener('click', () => {
      if (activePillar === 'analytics') {
        applyRoute(resumeTimersRoute());
      }
    });
  }

  // ── Public hook: called by app.js after a mode switch so the hash
  // reflects the new state when switching is triggered outside tempo-nav
  // (e.g. from a PWA shortcut, or some legacy click path).
  function onAppModeChanged(mode) {
    if (activePillar !== 'timers') return;
    writeHash('timers', MODE_TO_SUB[mode] ?? '');
    syncSubnavActive('timers', MODE_TO_SUB[mode] ?? '');
  }

  return { init, applyRoute, onAppModeChanged, getPillar: () => activePillar };
})();

window.TempoNav = TempoNav;
