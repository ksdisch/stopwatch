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
// reflects their in-context session count.
//
// Daily rollover (bfrbs_global only): the global log accumulates timestamps
// forever — that's how Analytics computes the 14/30/90-day BFRB trend. But
// the FAB label was previously showing the all-time count, which is both
// discouraging (number only ever grows) and not what most users want from a
// daily-tracking habit. So when the active store is bfrbs_global, the label
// now shows only today's catches (filtered by local-date key). The stored
// timestamps are untouched — Analytics still sees every day. A midnight
// timeout re-renders the label so a left-open PWA flips to "0" at 00:00.
// Session stores (Flow/Pomodoro) keep showing the full session count, since
// those reset at session boundaries already.

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

  // Local-date key (YYYY-MM-DD in the user's local timezone). Matches the
  // helper of the same name in js/analytics.js — replicated here rather than
  // exported across the IIFE boundary because it's 5 lines and the spec is
  // stable. If a third caller ever needs it, hoist into Utils.
  function localDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  // Count for the FAB label.
  //   - Session stores (flow_bfrbs / pomodoro_bfrbs): full count, since those
  //     stores are already session-scoped (cleared on session end/abandon).
  //   - Global store (bfrbs_global): today's catches only. Stored entries
  //     stay intact for Analytics; we just filter at render time. Entries
  //     without a numeric timestamp are skipped — they predate the schema.
  function countForLabel(key) {
    const items = loadStore(key);
    if (key !== GLOBAL_KEY) return items.length;
    const today = localDateKey(new Date());
    return items.reduce((n, e) => {
      if (!e || typeof e.timestamp !== 'number') return n;
      return localDateKey(new Date(e.timestamp)) === today ? n + 1 : n;
    }, 0);
  }

  function label() {
    const count = countForLabel(getActiveStoreKey());
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

  // ms until the next local midnight. The +50ms buffer keeps us safely past
  // the boundary so the new local date has actually rolled over by the time
  // we re-render.
  function msUntilNextMidnight() {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 50);
    return Math.max(1000, next.getTime() - now.getTime());
  }

  function scheduleMidnightRollover() {
    setTimeout(() => {
      renderLabel();
      scheduleMidnightRollover();
    }, msUntilNextMidnight());
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

    // Midnight rollover: a long-running PWA tab needs the global tally to
    // flip to "0" at the local-day boundary. Schedule a one-shot at the next
    // midnight, then chain so DST transitions self-correct (we recompute the
    // delta each time instead of using a fixed 24-hour interval).
    scheduleMidnightRollover();

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
