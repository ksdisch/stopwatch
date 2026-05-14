// ── Global BFRB Button ──
// One floating tally/recovery-trigger that's always visible, regardless of
// which pillar or mode the user is on. Tap logs a catch + kicks off the 60s
// competing-response countdown. Keyboard shortcut: B.
//
// E-1d-f3 (F3 BFRB stream consolidation): catches now route through
// BfrbEvents.log({ context, sessionId?, phase?, cycleIndex? }) — a single
// consolidated `bfrb_events` localStorage store. The legacy 3-key routing
// (bfrbs_global / flow_bfrbs / pomodoro_bfrbs) was replaced by a context
// tag on each entry. Routing rules:
//   - Flow focus running  → context: 'flow', sessionId: Flow.getSessionStartedAt(), phase
//   - Pomodoro work phase → context: 'pomodoro', sessionId, phase, cycleIndex
//   - Everything else     → context: 'global'
//
// `getActiveStoreKey()` is retained as a deprecated shim returning the
// context string so the public return shape stays back-compatible for any
// callers that still reference it (cleanup PR deferred per Pick C on TODO #5).
//
// Daily rollover (global context only): the FAB label shows today's catches
// only when the active context is 'global', so a left-open PWA flips to "0"
// at local midnight. Session contexts (flow/pomodoro) keep showing the full
// session count, filtered by current sessionId — those reset at session
// boundaries already (saveFlowBFRBs([]) / savePomoBFRBs([]) on session end).

const GlobalBFRB = (() => {
  const BTN_ID = 'global-bfrb-fab';

  function isFlowRunning() {
    return typeof Flow !== 'undefined' && Flow.getStatus && Flow.getStatus() === 'running';
  }

  function isPomoWorkRunning() {
    if (typeof Pomodoro === 'undefined') return false;
    return Pomodoro.getStatus() === 'running' && Pomodoro.getPhase() === 'work';
  }

  // E-1d-f3: return the context tag instead of the legacy storage key.
  function getActiveContext() {
    if (isFlowRunning()) return 'flow';
    if (isPomoWorkRunning()) return 'pomodoro';
    return 'global';
  }

  // Deprecated shim — retained so existing references to GlobalBFRB.getActiveStoreKey
  // don't break. Returns the context tag verbatim (callers that previously
  // compared against 'bfrbs_global' / 'flow_bfrbs' / 'pomodoro_bfrbs' will
  // need to be updated; the only known caller is this module itself, fully
  // migrated below). Cleanup deferred per Pick C on E-1d-f3 TODO #5.
  function getActiveStoreKey() {
    return getActiveContext();
  }

  // Per E-1d-f3 audit Open question Q1: Flow + Pomodoro engines don't
  // expose a discrete getSessionId — `getSessionStartedAt()` IS the
  // session identifier (engine guarantees one active session at a time;
  // value changes on each start/reset, exactly the boundary we want).
  function getActiveSessionId() {
    if (isFlowRunning() && typeof Flow.getSessionStartedAt === 'function') {
      return Flow.getSessionStartedAt();
    }
    if (isPomoWorkRunning() && typeof Pomodoro.getSessionStartedAt === 'function') {
      return Pomodoro.getSessionStartedAt();
    }
    return null;
  }

  function getActivePhase() {
    if (isFlowRunning() && typeof Flow.getPhase === 'function') return Flow.getPhase();
    if (isPomoWorkRunning() && typeof Pomodoro.getPhase === 'function') return Pomodoro.getPhase();
    return null;
  }

  function getActiveCycleIndex() {
    if (isPomoWorkRunning() && typeof Pomodoro.getCycleIndex === 'function') {
      return Pomodoro.getCycleIndex();
    }
    return null;
  }

  // Count for the FAB label.
  //   - Session contexts ('flow' / 'pomodoro'): count entries belonging to
  //     the CURRENT session (filtered by sessionId === active sessionStartedAt).
  //     Behavior parity with the legacy session-scoped store, where catches
  //     for an old session were cleared via saveFlowBFRBs([]) / savePomoBFRBs([]).
  //   - Global context: today's catches only (preserves the legacy daily-
  //     rollover behavior). BfrbEvents.countToday('global') applies the
  //     local-date filter — byte-equivalent to the legacy countForLabel.
  function countForLabel(context) {
    if (typeof BfrbEvents === 'undefined') return 0;
    if (context === 'global') {
      return BfrbEvents.countToday('global');
    }
    const sessionId = getActiveSessionId();
    if (sessionId == null) return 0;
    const entries = BfrbEvents.getByContext(context);
    let n = 0;
    for (const e of entries) {
      if (e && e.sessionId === sessionId) n++;
    }
    return n;
  }

  function label() {
    const count = countForLabel(getActiveContext());
    return count > 0 ? `BFRB ×${count}` : 'BFRB';
  }

  function renderLabel() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    if (typeof BFRBRecovery !== 'undefined' && BFRBRecovery.isActive(BTN_ID)) return;
    btn.textContent = label();
  }

  function logCatch() {
    const context = getActiveContext();
    // Build per-context payload. BfrbEvents.log stamps deviceId +
    // updatedAt + schemaVersion (F10) and consults SyncState.canWrite (F13).
    const payload = { context: context };
    if (context === 'flow') {
      payload.sessionId = getActiveSessionId();
      const ph = getActivePhase();
      if (typeof ph === 'string') payload.phase = ph;
    } else if (context === 'pomodoro') {
      payload.sessionId = getActiveSessionId();
      const ph = getActivePhase();
      if (typeof ph === 'string') payload.phase = ph;
      const ci = getActiveCycleIndex();
      if (typeof ci === 'number') payload.cycleIndex = ci;
    }
    if (typeof BfrbEvents !== 'undefined' && typeof BfrbEvents.log === 'function') {
      BfrbEvents.log(payload);
    }
    Platform.haptic(20);
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
