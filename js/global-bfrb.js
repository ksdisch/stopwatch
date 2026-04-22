// ── Global BFRB Button ──
// One floating tally/recovery-trigger that's always visible, regardless of
// which pillar or mode the user is on. Tap logs a catch + kicks off the 60s
// competing-response countdown. Keyboard shortcut: B.
//
// Smart storage routing: catches are appended to the "most specific" active
// store so per-session history stays accurate.
//   - Flow focus running  → flow_bfrbs (existing session-scoped store)
//   - Pomodoro work phase → pomodoro_bfrbs (existing session-scoped store)
//   - Everything else     → bfrbs_global (unbounded global log)
//
// The FAB label reads the currently-active store so the tally the user sees
// reflects their in-context session count. Outside of Flow/Pomodoro it
// reflects the global log.

const GlobalBFRB = (() => {
  const BTN_ID = 'global-bfrb-fab';
  const GLOBAL_KEY = 'bfrbs_global';

  function isFlowRunning() {
    return typeof Flow !== 'undefined' && Flow.getStatus && Flow.getStatus() === 'running';
  }

  function isPomoWorkRunning() {
    if (typeof Pomodoro === 'undefined') return false;
    return Pomodoro.getStatus() === 'running' && Pomodoro.getPhase() === 'work';
  }

  function getActiveStoreKey() {
    if (isFlowRunning()) return 'flow_bfrbs';
    if (isPomoWorkRunning()) return 'pomodoro_bfrbs';
    return GLOBAL_KEY;
  }

  function loadStore(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch (e) { return []; }
  }

  function saveStore(key, items) {
    localStorage.setItem(key, JSON.stringify(items));
  }

  function buildEntry() {
    const e = { timestamp: Date.now() };
    if (isFlowRunning()) {
      e.phase = Flow.getPhase();
    } else if (isPomoWorkRunning()) {
      e.phase = Pomodoro.getPhase();
      e.cycleIndex = Pomodoro.getCycleIndex();
    }
    return e;
  }

  function label() {
    const key = getActiveStoreKey();
    const count = loadStore(key).length;
    return count > 0 ? `BFRB ×${count}` : 'BFRB';
  }

  function renderLabel() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    if (typeof BFRBRecovery !== 'undefined' && BFRBRecovery.isActive(BTN_ID)) return;
    btn.textContent = label();
  }

  function logCatch() {
    const key = getActiveStoreKey();
    const items = loadStore(key);
    items.push(buildEntry());
    saveStore(key, items);
    if (navigator.vibrate) navigator.vibrate(20);
    if (typeof BFRBRecovery !== 'undefined') {
      BFRBRecovery.start(BTN_ID, label);
    } else {
      renderLabel();
    }
  }

  function init() {
    const btn = document.getElementById(BTN_ID);
    if (btn) {
      btn.addEventListener('click', logCatch);
      renderLabel();
    }

    // Keyboard shortcut: B. Suppressed when focus is inside a text-entry field
    // so it doesn't interfere with typing in goal/note/name inputs.
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyB') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      logCatch();
    });

    // Re-render the label as the user moves between modes, starts/stops
    // sessions, etc. Cheap — just a textContent swap. hashchange fires on the
    // tempo-nav routes, focus fires when the window re-gains attention.
    window.addEventListener('hashchange', renderLabel);
    window.addEventListener('focus', renderLabel);
    // Also tick on visibility in case another tab mutated a store.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) renderLabel();
    });

    // Volume slider in the settings drawer.
    const slider = document.getElementById('bfrb-volume-slider');
    const valueEl = document.getElementById('bfrb-volume-value');
    if (slider && typeof SFX !== 'undefined' && SFX.getBFRBVolume) {
      const current = Math.round(SFX.getBFRBVolume() * 100);
      slider.value = String(current);
      if (valueEl) valueEl.textContent = `${current}%`;
      slider.addEventListener('input', () => {
        const pct = parseInt(slider.value, 10);
        SFX.setBFRBVolume(pct / 100);
        if (valueEl) valueEl.textContent = `${pct}%`;
      });
      // Preview the chime on release so the user can hear the adjustment.
      slider.addEventListener('change', () => {
        if (typeof SFX !== 'undefined' && SFX.playBFRBEnd) SFX.playBFRBEnd();
      });
    }
  }

  // All the other UI modules rely on DOM being present at script-load time
  // (their <script> tags are at the bottom of <body>). The FAB element is
  // placed just before this script so document.getElementById works.
  init();

  return { logCatch, renderLabel, getActiveStoreKey };
})();
