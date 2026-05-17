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
    } else if (pillar === 'rhythm') {
      // Rhythm pillar: render the daily timeline on activation. The UI
      // module owns its own DOM + tick interval; calling render() is
      // idempotent and re-paints with today's data.
      if (typeof RhythmUI !== 'undefined' && typeof RhythmUI.render === 'function') {
        RhythmUI.render();
      }
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
    //
    // Buttons with [data-keep-drawer-open] opt OUT of the auto-close so
    // the user can flip toggles (e.g., the Cloud Sync enable switch) and
    // immediately see the new state. Sign-in is a navigation-onward
    // action so it auto-closes as usual.
    drawer.querySelectorAll('button:not([data-keep-drawer-open])').forEach(btn => {
      btn.addEventListener('click', () => {
        setTimeout(() => {
          drawer.classList.add('hidden');
          syncExpanded();
        }, 0);
      });
    });

    wireCloudSync(drawer, syncExpanded);
  }

  // ── Cloud Sync section (B-2) ────────────────────────────────────────
  // Lives inside the settings drawer. Wires the developer toggle for
  // tempo_sync_enabled plus the Google sign-in / sign-out buttons. All
  // engine calls go through SyncFlag.* / SyncAuth.*.
  function wireCloudSync(drawer, syncDrawerExpanded) {
    const toggleBtn = drawer.querySelector('#cloud-sync-toggle');
    const signInBtn = drawer.querySelector('#cloud-sync-signin-btn');
    const signOutBtn = drawer.querySelector('#cloud-sync-signout-btn');
    const identityRow = drawer.querySelector('#cloud-sync-identity');
    const statusEl = drawer.querySelector('#cloud-sync-status');
    const emailEl = drawer.querySelector('#cloud-sync-email');
    const nameEl = drawer.querySelector('#cloud-sync-display-name');
    const photoEl = drawer.querySelector('#cloud-sync-photo');
    // B-3: "Push to cloud" button + a local in-flight latch so the
    // button stays disabled across the click handler's awaits. The
    // SyncEngine has its own _pushInFlight guard; this one is purely
    // UI-side for rendering the disabled state synchronously.
    const pushBtn = drawer.querySelector('#cloud-sync-push-btn');
    let _pushInFlightLocal = false;
    // D-1: "Reconcile now" button + a local in-flight latch. Same shape
    // as _pushInFlightLocal — keeps the button disabled across the click
    // handler's awaits while SyncEngine.reconcileImportedBucket() runs.
    // The engine has its own _reconcileInFlight guard; this UI-side
    // latch renders the disabled state synchronously.
    const reconcileBtn = drawer.querySelector('#cloud-sync-reconcile-btn');
    let _reconcileInFlightLocal = false;
    if (!toggleBtn) return; // markup not present — feature disabled

    function setStatus(msg, isError) {
      if (!statusEl) return;
      if (!msg) {
        statusEl.textContent = '';
        statusEl.hidden = true;
        statusEl.removeAttribute('data-error');
        statusEl.removeAttribute('data-progress');
        return;
      }
      statusEl.textContent = msg;
      statusEl.hidden = false;
      if (isError) statusEl.setAttribute('data-error', '');
      else statusEl.removeAttribute('data-error');
    }

    // B-3: orthogonal to data-error — data-progress drives the per-stage
    // color. Passing null clears both the attribute and the row.
    function setProgress(stage) {
      if (!statusEl) return;
      if (!stage) {
        statusEl.removeAttribute('data-progress');
        statusEl.hidden = true;
        statusEl.textContent = '';
        return;
      }
      statusEl.setAttribute('data-progress', stage);
      statusEl.hidden = false;
    }

    // B-3: push button is gated behind flag-on AND signed-in. It's
    // additionally disabled while a push is in-flight (either this UI's
    // local latch or the global SyncState.isHydrating() gate).
    function renderPushBtn() {
      if (!pushBtn) return;
      const enabled = (typeof SyncFlag !== 'undefined') && SyncFlag.isEnabled();
      const user = (typeof SyncAuth !== 'undefined') ? SyncAuth.getCurrentUser() : null;
      const hydrating = (typeof SyncState !== 'undefined' && SyncState.isHydrating())
        || _pushInFlightLocal;
      const visible = enabled && user !== null;
      pushBtn.hidden = !visible;
      if (visible) {
        pushBtn.disabled = hydrating;
        pushBtn.setAttribute('aria-disabled', hydrating ? 'true' : 'false');
      }
    }

    // D-1: reconcile button is gated behind flag-on AND signed-in AND
    // the Stage D handoff flag being set. (B-3's push and C-1's hydrate
    // both set the handoff when they detect "local + cloud both have
    // data"; D-1's reconcileImportedBucket clears it on success.)
    // Disabled while reconcile is in-flight, same idiom as renderPushBtn.
    function renderReconcileBtn() {
      if (!reconcileBtn) return;
      const enabled = (typeof SyncFlag !== 'undefined') && SyncFlag.isEnabled();
      const user = (typeof SyncAuth !== 'undefined') ? SyncAuth.getCurrentUser() : null;
      const handoff = (typeof SyncEngine !== 'undefined' &&
                       typeof SyncEngine.getStageDHandoff === 'function')
        ? SyncEngine.getStageDHandoff()
        : false;
      const hydrating = (typeof SyncState !== 'undefined' && SyncState.isHydrating())
        || _reconcileInFlightLocal;
      const visible = enabled && user !== null && handoff;
      reconcileBtn.hidden = !visible;
      if (visible) {
        reconcileBtn.disabled = hydrating;
        reconcileBtn.setAttribute('aria-disabled', hydrating ? 'true' : 'false');
      }
    }

    function renderCloudSyncUI() {
      const enabled = (typeof SyncFlag !== 'undefined') && SyncFlag.isEnabled();
      const user = (typeof SyncAuth !== 'undefined') ? SyncAuth.getCurrentUser() : null;

      toggleBtn.setAttribute('aria-checked', enabled ? 'true' : 'false');

      if (!enabled) {
        if (identityRow) identityRow.hidden = true;
        if (signInBtn) signInBtn.hidden = true;
        renderPushBtn();
        renderReconcileBtn();
        return;
      }

      if (user) {
        if (identityRow) identityRow.hidden = false;
        if (signInBtn) signInBtn.hidden = true;
        if (nameEl) nameEl.textContent = user.displayName || '';
        if (emailEl) emailEl.textContent = user.email || '';
        if (photoEl) {
          if (user.photoURL) {
            photoEl.src = user.photoURL;
            photoEl.hidden = false;
          } else {
            photoEl.removeAttribute('src');
            photoEl.hidden = true;
          }
        }
      } else {
        if (identityRow) identityRow.hidden = true;
        if (signInBtn) signInBtn.hidden = false;
      }

      renderPushBtn();
      renderReconcileBtn();
    }

    // Toggle the feature flag. Enabling lazy-inits SyncAuth so the cold-
    // boot rehydrate path runs without a page refresh.
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof SyncFlag === 'undefined') return;
      if (SyncFlag.isEnabled()) {
        SyncFlag.disable();
      } else {
        SyncFlag.enable();
        if (typeof SyncAuth !== 'undefined') {
          try { SyncAuth.init(); } catch (_e) {}
        }
      }
      setStatus('', false);
      renderCloudSyncUI();
    });

    if (signInBtn) {
      signInBtn.addEventListener('click', async () => {
        setStatus('Signing in…', false);
        try {
          const user = (typeof SyncAuth !== 'undefined')
            ? await SyncAuth.signIn()
            : null;
          if (!user) {
            // Cancellation — nothing to surface.
            setStatus('', false);
          } else {
            setStatus('', false);
          }
        } catch (err) {
          const msg = (err && (err.message || err.code)) || String(err);
          setStatus('Sign-in error: ' + msg, true);
        }
        renderCloudSyncUI();
      });
    }

    if (signOutBtn) {
      signOutBtn.addEventListener('click', async () => {
        try {
          if (typeof SyncAuth !== 'undefined') await SyncAuth.signOut();
          setStatus('', false);
        } catch (err) {
          const msg = (err && (err.message || err.code)) || String(err);
          setStatus('Sign-out error: ' + msg, true);
        }
        renderCloudSyncUI();
      });
    }

    // ── B-3: "Push to cloud" click handler ───────────────────────────
    // Drives SyncEngine.pushSnapshot() and renders the result into the
    // existing status row. Live per-stage progress is wired through
    // SyncEngine.on('push-progress', ...) below; this handler only
    // renders the final state because it owns the "done" / error copy.
    if (pushBtn) {
      pushBtn.addEventListener('click', async () => {
        if (_pushInFlightLocal) return;
        if (typeof SyncEngine === 'undefined' ||
            typeof SyncEngine.pushSnapshot !== 'function') {
          setStatus('Sync engine unavailable.', true);
          return;
        }
        _pushInFlightLocal = true;
        renderPushBtn();
        try {
          const result = await SyncEngine.pushSnapshot();
          if (result && result.ok) {
            setProgress('done');
            if (statusEl) {
              const skipped = result.skippedFutureRecords || 0;
              statusEl.textContent = skipped > 0
                ? 'Synced. ' + skipped + ' newer record' +
                  (skipped === 1 ? '' : 's') +
                  ' kept local — update Tempo on your other device.'
                : 'Synced ✓';
            }
          } else if (result && result.kind === 'stage-d-handoff') {
            setProgress('stage-d-handoff');
            if (statusEl) {
              statusEl.textContent =
                'Cloud has existing data. Tap "Reconcile now" to merge your local data with cloud.';
            }
            // D-1: handoff flag was set by the engine; surface the
            // Reconcile button immediately so the user has an action.
            renderReconcileBtn();
          } else {
            const kind = (result && result.kind) || 'unknown';
            const errMsg = (result && result.error &&
              (result.error.message || result.error.code)) || '';
            setProgress('error');
            if (statusEl) {
              statusEl.textContent = errMsg
                ? 'Push failed (' + escapeHtml(kind) + '): ' + escapeHtml(errMsg)
                : 'Push failed: ' + escapeHtml(kind);
            }
          }
        } catch (err) {
          setProgress('error');
          if (statusEl) {
            const msg = (err && (err.message || err.code)) || String(err);
            statusEl.textContent = 'Push error: ' + escapeHtml(msg);
          }
        } finally {
          _pushInFlightLocal = false;
          renderPushBtn();
        }
      });
    }

    // Live progress updates from the engine. The click handler above
    // renders the FINAL state (done / error / stage-d-handoff); these
    // subscriptions paint the in-flight transitions.
    if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.on === 'function') {
      SyncEngine.on('push-progress', (payload) => {
        if (!payload || !payload.stage) return;
        const stage = payload.stage;
        setProgress(stage);
        if (!statusEl) return;
        if (stage === 'backup') {
          statusEl.textContent = 'Backing up local data…';
        } else if (stage === 'checking-cloud') {
          statusEl.textContent = 'Checking cloud…';
        } else if (stage === 'uploading') {
          const store = payload.store ? escapeHtml(payload.store) : '';
          const current = (typeof payload.current === 'number') ? payload.current : null;
          const total = (typeof payload.total === 'number') ? payload.total : null;
          if (store && current !== null && total !== null) {
            statusEl.textContent = 'Uploading ' + store +
              ' (' + current + '/' + total + ')…';
          } else if (store) {
            statusEl.textContent = 'Uploading ' + store + '…';
          } else {
            statusEl.textContent = 'Uploading…';
          }
        }
      });
      // Re-render the button on push-complete so its disabled state
      // tracks the engine's _pushInFlight latch (mostly useful if a
      // future code path triggers pushSnapshot from outside this UI).
      SyncEngine.on('push-complete', () => {
        renderPushBtn();
      });
    }

    // ── C-1: hydrate-from-cloud overlay + status-row wiring ─────────
    // The overlay lives at <body>/#tempo-hydrate-overlay (above #app)
    // so it stacks over every renderer. It blocks UI behind a
    // "Loading from cloud…" message during boot-time hydrate. On
    // hydrate-progress, we update the overlay's progress line AND
    // the settings-drawer status row (so the drawer reflects state
    // when the user opens it post-hydrate). On hydrate-complete, the
    // overlay auto-dismisses on success and reveals retry/skip on
    // error. The overlay is queried at document scope; the drawer's
    // statusEl is shared with the push pipeline.
    const overlay = document.getElementById('tempo-hydrate-overlay');
    const overlayProgress = document.getElementById('tempo-hydrate-overlay-progress');
    const overlayError = document.getElementById('tempo-hydrate-overlay-error');
    const overlayErrorText = document.getElementById('tempo-hydrate-overlay-error-text');
    const overlayRetry = document.getElementById('tempo-hydrate-overlay-retry');
    const overlayDismiss = document.getElementById('tempo-hydrate-overlay-dismiss');

    // Pretty labels for the per-store progress events. Cloud payload
    // store keys are wire-format (rest_log, meds, presets, history);
    // the user-facing label is friendlier ("rest log", "medications").
    const HYDRATE_STORE_LABELS = {
      'rest_log': 'rest log',
      'meds': 'medications',
      'presets': 'presets',
      'history': 'history',
    };

    function showHydrateError(message) {
      if (!overlay) return;
      overlay.hidden = false;
      if (overlayProgress) overlayProgress.textContent = '';
      if (overlayError) overlayError.hidden = false;
      if (overlayErrorText) overlayErrorText.textContent = message || 'unknown error';
    }

    function hideHydrateOverlay() {
      if (!overlay) return;
      overlay.hidden = true;
      if (overlayError) overlayError.hidden = true;
      if (overlayProgress) overlayProgress.textContent = '';
    }

    if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.on === 'function') {
      SyncEngine.on('hydrate-progress', (payload) => {
        if (!payload || !payload.stage) return;
        // Reveal overlay only for stages that actually do work; the
        // 'checking-local' stage flashes briefly so we still show the
        // overlay (avoids a render-then-replace race).
        if (overlay) {
          overlay.hidden = false;
          if (overlayError) overlayError.hidden = true;
        }

        if (payload.stage === 'checking-local') {
          if (overlayProgress) overlayProgress.textContent = 'Checking local data…';
          setProgress('hydrate-checking-local');
          if (statusEl) statusEl.textContent = 'Checking local data…';
          return;
        }

        if (payload.stage === 'pulling' && payload.store) {
          const friendly = HYDRATE_STORE_LABELS[payload.store] || payload.store;
          const message = 'Loading ' + friendly + '…';
          if (overlayProgress) overlayProgress.textContent = message;
          setProgress('hydrate-' + payload.store);
          if (statusEl) statusEl.textContent = message;
        }
      });

      SyncEngine.on('hydrate-complete', (payload) => {
        if (!payload) return;

        // Success — show "Loaded ✓" briefly, then auto-hide overlay.
        if (payload.ok && payload.kind === 'done') {
          if (overlayProgress) overlayProgress.textContent = 'Loaded ✓';
          setProgress('hydrate-done');
          if (statusEl) statusEl.textContent = 'Loaded from cloud ✓';
          setTimeout(hideHydrateOverlay, 1000);
          renderCloudSyncUI();
          return;
        }

        // Already hydrated on a prior boot — overlay should never have
        // shown, but defensively hide and clear drawer status.
        if (payload.ok && payload.kind === 'already-hydrated') {
          hideHydrateOverlay();
          renderCloudSyncUI();
          return;
        }

        // Stage D handoff — local has data + cloud has data; D-1 owns
        // reconciliation. Hide the overlay; surface in the drawer row.
        if (payload.kind === 'stage-d-handoff') {
          hideHydrateOverlay();
          setProgress('stage-d-handoff');
          if (statusEl) {
            statusEl.textContent =
              'Cloud has existing data. Tap "Reconcile now" to merge your local data with cloud.';
          }
          // D-1: handoff flag is set by the engine; renderCloudSyncUI
          // surfaces the Reconcile button (renderReconcileBtn fires inside).
          renderCloudSyncUI();
          return;
        }

        // Sign-in / sync-not-enabled / sync-error-state / already-in-flight —
        // engine refused to run; no overlay treatment, just clear it.
        if (payload.kind === 'sign-in-required' ||
            payload.kind === 'sync-not-enabled' ||
            payload.kind === 'sync-error-state' ||
            payload.kind === 'already-in-flight') {
          hideHydrateOverlay();
          renderCloudSyncUI();
          return;
        }

        // Real error path (permission-denied, network, unknown, etc.)
        // Surface in the overlay with retry + skip buttons.
        const kind = payload.kind || 'unknown';
        const errMsg = (payload.error &&
          (payload.error.message || payload.error.code)) || '';
        const userFacing = errMsg
          ? kind + ' — ' + errMsg
          : kind;
        showHydrateError(userFacing);
        setProgress('error');
        if (statusEl) {
          statusEl.textContent = 'Load failed: ' + escapeHtml(userFacing);
        }
        renderCloudSyncUI();
      });
    }

    // ── D-1: "Reconcile now" click handler + event subscriptions ─────
    // Drives SyncEngine.reconcileImportedBucket() — pull cloud, merge
    // with locally-stamped imported rows, push the combined snapshot.
    // Live per-stage progress comes through SyncEngine.on(
    // 'reconcile-progress'); the final state is rendered via
    // 'reconcile-complete'. The click handler only kicks off the
    // request + tracks the local in-flight latch.
    //
    // Pretty labels for the per-store progress payloads. Same shape
    // as HYDRATE_STORE_LABELS above; redeclared locally so the label
    // map is colocated with its consumer.
    const RECONCILE_STORE_LABELS = {
      'rest_log': 'rest log',
      'meds': 'medications',
      'presets': 'presets',
      'history': 'history',
    };

    function startReconcile() {
      if (_reconcileInFlightLocal) return;
      if (typeof SyncEngine === 'undefined' ||
          typeof SyncEngine.reconcileImportedBucket !== 'function') {
        setStatus('Sync engine unavailable.', true);
        return;
      }
      _reconcileInFlightLocal = true;
      renderReconcileBtn();
      // Engine emits reconcile-progress / reconcile-complete; the
      // click handler simply awaits the promise so its `finally` can
      // clear the local latch. The progress/complete handlers below
      // own the user-facing copy.
      SyncEngine.reconcileImportedBucket()
        .catch(() => { /* engine routes errors via reconcile-complete */ })
        .then(() => {
          _reconcileInFlightLocal = false;
          renderReconcileBtn();
        });
    }

    if (reconcileBtn) {
      reconcileBtn.addEventListener('click', () => {
        // Clear any prior "Reconcile failed…" status before the new run.
        setStatus('', false);
        startReconcile();
      });
    }

    if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.on === 'function') {
      SyncEngine.on('reconcile-progress', (payload) => {
        if (!payload || !payload.stage) return;
        // Reuse the existing setProgress() data-progress driver so the
        // status row picks up the in-flight neutral color treatment
        // (it falls back gracefully on unknown stage values).
        setProgress('stage-d-handoff');
        if (!statusEl) return;
        const stage = payload.stage;
        const friendly = payload.store
          ? (RECONCILE_STORE_LABELS[payload.store] || payload.store)
          : '';
        if (stage === 'stamping') {
          statusEl.textContent = friendly
            ? 'Tagging local ' + friendly + '…'
            : 'Tagging local data…';
        } else if (stage === 'pulling') {
          statusEl.textContent = friendly
            ? 'Loading cloud ' + friendly + '…'
            : 'Loading cloud data…';
        } else if (stage === 'writing') {
          statusEl.textContent = friendly
            ? 'Merging ' + friendly + '…'
            : 'Merging…';
        } else if (stage === 'uploading') {
          const current = (typeof payload.current === 'number') ? payload.current : null;
          const total = (typeof payload.total === 'number') ? payload.total : null;
          if (friendly && current !== null && total !== null) {
            statusEl.textContent = 'Uploading ' + friendly +
              ' (' + current + '/' + total + ')…';
          } else if (friendly) {
            statusEl.textContent = 'Uploading ' + friendly + '…';
          } else {
            statusEl.textContent = 'Uploading…';
          }
        }
      });

      SyncEngine.on('reconcile-complete', (payload) => {
        if (!payload) return;
        if (payload.ok === true) {
          // Success — clear the in-flight latch + re-render. The engine
          // already cleared `tempo_sync_stage_d_handoff` in step 8, so
          // renderCloudSyncUI() hides the Reconcile button.
          setProgress('done');
          if (statusEl) {
            const counts = payload.counts || {};
            const n = (typeof counts.history === 'number') ? counts.history : 0;
            const skipped = payload.skippedFutureRecords || 0;
            const base = 'Imported ' + n + ' past session' +
              (n === 1 ? '' : 's') + '. Synced ✓';
            statusEl.textContent = skipped > 0
              ? base + ' (' + skipped + ' newer record' +
                (skipped === 1 ? '' : 's') + ' kept local)'
              : base;
          }
          _reconcileInFlightLocal = false;
          renderCloudSyncUI();
          return;
        }
        // Failure path — engine left the handoff flag set, so the
        // Reconcile button remains visible. Render a friendly error +
        // keep the latch cleared so the user can immediately retry.
        const kind = payload.kind || 'unknown';
        const errMsg = (payload.error &&
          (payload.error.message || payload.error.code)) || '';
        setProgress('error');
        if (statusEl) {
          statusEl.textContent = errMsg
            ? 'Reconcile failed (' + escapeHtml(kind) + '): ' + escapeHtml(errMsg)
            : 'Reconcile failed: ' + escapeHtml(kind);
        }
        _reconcileInFlightLocal = false;
        renderReconcileBtn();
      });
    }

    // Retry button — re-runs hydrate. hydrate-complete handler above
    // will then route to the success / error path on resolve.
    if (overlayRetry) {
      overlayRetry.addEventListener('click', async () => {
        if (overlayError) overlayError.hidden = true;
        if (overlayProgress) overlayProgress.textContent = 'Retrying…';
        if (typeof SyncEngine === 'undefined' ||
            typeof SyncEngine.hydrateFromCloud !== 'function') {
          showHydrateError('Sync engine unavailable.');
          return;
        }
        try {
          await SyncEngine.hydrateFromCloud();
        } catch (err) {
          // The hydrate-complete handler renders the error; this catch
          // exists to keep the click handler from rejecting unhandled.
        }
      });
    }

    // Skip button — escape valve. Tempo is local-first; the user must
    // always be able to use the app even if cloud sync is broken. This
    // does NOT clear the per-store hydrate markers — next boot will
    // re-try the hydrate path automatically. Per audit Open question
    // #8, a manual "Retry hydrate" button in the settings drawer ships
    // in E-1; for now, signing out + back in is the recovery path.
    if (overlayDismiss) {
      overlayDismiss.addEventListener('click', () => {
        hideHydrateOverlay();
      });
    }

    // ── E-3: Sync activity indicator (listeners + last-merge time) ─────
    // Per Pick A on E-3-PROMPT TODO #6, extend the existing
    // `#cloud-sync-status` text content (already aria-live="polite") with
    // a stable, test-parseable format:
    //
    //   Last sync: <relative time> · Listeners: <state>
    //
    // where <state> ∈ 'connected' | 'disconnected' | 'pending' aggregated
    // across the 6 SYNCED_STORES entries:
    //   - 'connected'    if all 6 stores last reported listener-connected
    //   - 'disconnected' if ANY of the 6 reported listener-disconnected
    //                    (since the most recent listener-connected for that store)
    //   - 'pending'      if no listener events have arrived yet this session
    //
    // The relative-time portion uses Utils.formatMs (CLAUDE.md mandates
    // reuse of the shared helper) wrapped in a small humanizer that maps
    // sub-second to "just now", sub-minute to "Ns ago", sub-hour to
    // "Nm ago", else "Nh ago". The status row never paints E-3 text
    // until at least one listener event has arrived, so the existing
    // push/hydrate/reconcile pipelines own the row uncontested during
    // their in-flight windows.
    let _lastMergeAt = null;
    const _listenerStateByStore = {};

    function _humanizeRelative(elapsedMs) {
      if (elapsedMs < 1000) return 'just now';
      const t = Utils.formatMs(elapsedMs);
      // Utils.formatMs returns hours/minutes/seconds parts; we pick the
      // largest non-zero unit for a compact "Nx ago" rendering.
      if (t.hours > 0) {
        return t.hours + ' hr' + (t.hours === 1 ? '' : 's') + ' ago';
      }
      if (t.minutes > 0) {
        return t.minutes + ' min' + (t.minutes === 1 ? '' : 's') + ' ago';
      }
      return t.seconds + ' sec' + (t.seconds === 1 ? '' : 's') + ' ago';
    }

    function _aggregateListenerState() {
      const stores = Object.keys(_listenerStateByStore);
      if (stores.length === 0) return 'pending';
      // If any store reports disconnected, the aggregate is disconnected
      // — preserves the safety-net signal even if the other 5 are fine.
      for (const k of stores) {
        if (_listenerStateByStore[k] === 'disconnected') return 'disconnected';
      }
      // Otherwise all known stores are connected. (We don't require all 6
      // before reporting connected — partial visibility is still useful
      // and the test verifies the format string regardless.)
      return 'connected';
    }

    function _formatSyncStatus() {
      // Don't clobber the row if no listener events have arrived yet —
      // push/hydrate/reconcile own the surface in those windows.
      if (_lastMergeAt === null && Object.keys(_listenerStateByStore).length === 0) {
        return;
      }
      const elapsed = (_lastMergeAt !== null) ? (Date.now() - _lastMergeAt) : null;
      const relTime = (elapsed !== null) ? _humanizeRelative(elapsed) : 'never';
      const state = _aggregateListenerState();
      setStatus('Last sync: ' + relTime + ' · Listeners: ' + state, false);
    }

    if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.on === 'function') {
      SyncEngine.on('merge-complete', () => {
        _lastMergeAt = Date.now();
        _formatSyncStatus();
      });
      SyncEngine.on('listener-connected', (payload) => {
        if (payload && payload.store) {
          _listenerStateByStore[payload.store] = 'connected';
        }
        _formatSyncStatus();
      });
      SyncEngine.on('listener-disconnected', (payload) => {
        if (payload && payload.store) {
          _listenerStateByStore[payload.store] = 'disconnected';
        }
        _formatSyncStatus();
      });
    }

    // Subscribe to ongoing auth changes (covers cold-boot rehydrate
    // landing after the drawer is already populated, plus system-level
    // account changes on native).
    //
    // Self-heal contract: when a user signs in late (e.g. after the
    // SyncAuth signIn timeout fired but Platform.auth.signIn eventually
    // succeeded on its own), the status row may still be showing the
    // stale "Sign-in error: Sign-in timed out…" message painted by the
    // click handler's catch branch. Clear it so the drawer transitions
    // cleanly to the signed-in state instead of leaving the error
    // visible alongside the user identity row.
    if (typeof SyncAuth !== 'undefined' && typeof SyncAuth.onAuthChange === 'function') {
      SyncAuth.onAuthChange((user) => {
        if (user) {
          try { setStatus('', false); } catch (_) {}
        }
        renderCloudSyncUI();
      });
    }

    // Re-render on every drawer open so toggle state always reflects
    // localStorage (handles cases where the flag is flipped by another
    // tab or by devtools).
    const settingsToggle = document.getElementById('tempo-settings-toggle');
    if (settingsToggle) {
      settingsToggle.addEventListener('click', () => {
        // Render after the drawer-open click handler has had a tick to
        // flip the .hidden class; we want the freshest state in view.
        setTimeout(renderCloudSyncUI, 0);
      });
    }

    // Initial paint.
    renderCloudSyncUI();
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
