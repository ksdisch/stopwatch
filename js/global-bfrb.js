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
  const POPOVER_ID = 'bfrb-capture-popover';

  // ── Antecedent capture taxonomy (E-1g) ────────────────────────────────
  // These labels are the ONE human-ratification surface for this milestone —
  // conservative defaults for a real person in BFRB recovery. Edit this single
  // list to retune the chips: the engine stores whatever string it's given and
  // the BFRB Triggers Insights panel groups by value, so relabeling needs no
  // other code change.
  const URGE_CHIPS = [
    { level: 1, label: 'Mild' },
    { level: 2, label: 'Medium' },
    { level: 3, label: 'Strong' },
  ];
  const TRIGGER_CHIPS = ['stress', 'bored', 'tired', 'focused', 'idle'];

  // ── BFRB pace-support nudge (Slice B) ─────────────────────────────────
  // RATIFIED COPY (user sign-off 2026-06-05, "Supportive offer" tone): the ONE
  // human-owned string for Slice B. Shown at most once/day, ONLY when the opt-in
  // toggle is on AND BfrbRisk says today's catches are clustering above the
  // user's own baseline. Descriptive-first by construction — no count, no
  // prediction, no judgment; it offers the existing 60s reset as a tool. Edit
  // this single line to retune the wording (the engine, throttle, and gate are
  // copy-agnostic).
  const SUPPORT_COPY = 'A few catches close together today. Your 60-second reset is here whenever you want it.';
  // PHASE 3 ESCALATED COPY (working draft — ratification surface at the Phase 3
  // gate, same contract as SUPPORT_COPY above): shown INSTEAD of SUPPORT_COPY
  // when BfrbRisk also reports sleepDown (catches clustering AND last night ran
  // short). The toast is tappable — 'Open' routes to Wellness › Mindful. The
  // same opt-in toggle + the same once-per-day throttle key govern both
  // variants; the mindful variant takes precedence by being the if-branch.
  const MINDFUL_COPY = 'Catches are clustering and last night ran short. A 5-minute breather is one tap away.';
  const SUPPORT_ENABLED_KEY = 'bfrb_support_enabled';     // '1' = on; default OFF (absent)
  const SUPPORT_TOAST_DAY_KEY = 'bfrb_support_last_toast_day'; // 'YYYY-MM-DD' throttle stamp

  // Deferred-commit backstop. Armed at catch time and re-armed on each chip tap
  // (so it never races a deliberating user), it's the last-resort flush for the
  // narrow case of "popover left open, no clicks anywhere, no app-lifecycle
  // exit." Every genuinely-lossy exit (Done, click-outside, navigate, tab
  // background/close, a new catch) flushes sooner. It sits inside the 60s
  // competing-response countdown that hides the FAB count, so the catch always
  // lands before the label re-renders.
  const AUTO_COMMIT_MS = 30000;

  // At most ONE uncommitted catch. The antecedent fields MUST ride a single
  // BfrbEvents.log() call — sync-merge-bfrb keeps the CLOUD copy on a
  // (deviceId, takenAt) collision (js/sync-merge-bfrb.js:158-174), so a
  // post-hoc patch of an already-synced catch is silently dropped. The catch
  // is held here while the user optionally taps chips, then committed exactly
  // once. Every app-lifecycle exit flushes it, so no catch is ever lost.
  let pending = null;
  let commitTimer = null;

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

  // Build the per-context payload for a catch. takenAt is captured at the
  // catch moment (the deferred commit replays it via opts.takenAt).
  function beginPending() {
    const context = getActiveContext();
    const p = { takenAt: Date.now(), context: context, urgeLevel: null, triggerZone: null };
    if (context === 'flow') {
      p.sessionId = getActiveSessionId();
      const ph = getActivePhase();
      if (typeof ph === 'string') p.phase = ph;
    } else if (context === 'pomodoro') {
      p.sessionId = getActiveSessionId();
      const ph = getActivePhase();
      if (typeof ph === 'string') p.phase = ph;
      const ci = getActiveCycleIndex();
      if (typeof ci === 'number') p.cycleIndex = ci;
    }
    return p;
  }

  // Persist the pending catch in exactly ONE BfrbEvents.log() call (antecedent
  // fields included), then clear it. Idempotent — safe to call from any flush
  // hook. BfrbEvents.log stamps deviceId + updatedAt + schemaVersion (F10) and
  // consults SyncState.canWrite (F13).
  function commitPending() {
    if (commitTimer) { clearTimeout(commitTimer); commitTimer = null; }
    const p = pending;
    pending = null;
    if (!p) return;
    if (typeof BfrbEvents !== 'undefined' && typeof BfrbEvents.log === 'function') {
      const opts = { context: p.context, takenAt: p.takenAt };
      if (p.sessionId !== undefined && p.sessionId !== null) opts.sessionId = p.sessionId;
      if (typeof p.phase === 'string') opts.phase = p.phase;
      if (typeof p.cycleIndex === 'number') opts.cycleIndex = p.cycleIndex;
      if (p.urgeLevel === 1 || p.urgeLevel === 2 || p.urgeLevel === 3) opts.urgeLevel = p.urgeLevel;
      if (typeof p.triggerZone === 'string' && p.triggerZone) opts.triggerZone = p.triggerZone;
      BfrbEvents.log(opts);
    }
    hidePicker();
    // The capture popover just dismissed. If the 60s competing-response
    // countdown is still running, surface the user's if-then plan now — so the
    // popover (tagging) and the plan banner (the competing-response reminder)
    // never share the corner; they're separated in time. Every popover-dismiss
    // path routes through commitPending(), so this covers Done / click-outside /
    // a new catch / auto-commit / lifecycle exits.
    if (typeof BFRBRecovery !== 'undefined' && typeof BFRBRecovery.showPlan === 'function'
        && BFRBRecovery.isActive && BFRBRecovery.isActive(BTN_ID)) {
      try { BFRBRecovery.showPlan(); } catch (_) {}
    }
    renderLabel();
  }

  function armCommitTimer(ms) {
    if (commitTimer) clearTimeout(commitTimer);
    commitTimer = setTimeout(commitPending, ms);
  }

  function logCatch() {
    // Flush any still-pending prior catch first (no loss; counts stay correct).
    commitPending();

    pending = beginPending();
    Platform.haptic(20);
    if (typeof BFRBRecovery !== 'undefined') {
      BFRBRecovery.start(BTN_ID, label);
    } else {
      renderLabel();
    }
    showPicker();
    armCommitTimer(AUTO_COMMIT_MS);

    // Slice B: offer the gentle pace-support nudge at the catch moment (the
    // therapeutic interrupt) — foreground only, never on a lifecycle-flush
    // commit. Pass the just-started pending catch so today's count reflects it
    // (it isn't in the store yet — commitPending() persists it later).
    maybeOfferSupport(pending);
  }

  // ── BFRB pace-support nudge (Slice B) ─────────────────────────────────
  // Opt-in (default OFF). On a fresh-today CLUSTERED band from BfrbRisk, paint
  // the ratified supportive toast once per local day. Everything is best-effort
  // + guarded so a missing engine / Toast / RecoveryFeed never breaks the catch
  // hot path. The decision logic is pure (js/bfrb-risk.js); this only gates,
  // throttles, and paints the one ratified copy line.
  function _supportEnabled() {
    try { return localStorage.getItem(SUPPORT_ENABLED_KEY) === '1'; } catch (_) { return false; }
  }

  function _todayKey() {
    const d = new Date();
    return d.getFullYear() + '-'
      + String(d.getMonth() + 1).padStart(2, '0') + '-'
      + String(d.getDate()).padStart(2, '0');
  }

  function maybeOfferSupport(pendingEntry) {
    if (!_supportEnabled()) return;
    if (typeof BfrbRisk === 'undefined' || typeof BfrbRisk.assess !== 'function') return;

    let events = [];
    try {
      events = (typeof BfrbEvents !== 'undefined' && BfrbEvents.getAll) ? BfrbEvents.getAll() : [];
    } catch (_) { events = []; }
    // Include the in-flight catch — it isn't persisted until commitPending().
    if (pendingEntry && typeof pendingEntry.takenAt === 'number') {
      events = events.concat([{ takenAt: pendingEntry.takenAt }]);
    }

    let recoveryState = null;
    try {
      if (typeof RecoveryFeed !== 'undefined' && typeof RecoveryFeed.getLatest === 'function') {
        recoveryState = RecoveryFeed.getLatest();
      }
    } catch (_) { recoveryState = null; }

    const today = _todayKey();

    // Phase 3 (stress nudge): source today's rest row + the past-14-day sleep
    // history from wellness_rest_log so BfrbRisk can decide sleepDown without
    // ever touching localStorage itself (the module stays pure — the caller
    // owns the read). Best-effort: a missing/corrupt log just means no sleep
    // signal (sleepDown false; the clustered-only nudge still works).
    let restRow = null;
    const sleepNightsHistory = [];
    try {
      const raw = localStorage.getItem('wellness_rest_log');
      const log = raw ? JSON.parse(raw) : null;
      if (log && typeof log === 'object') {
        restRow = log[today] || null;
        // Past 14 local days, EXCLUDING today — only numeric sleep.hours count.
        const now = new Date();
        for (let i = 1; i <= 14; i++) {
          const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
          const k = d.getFullYear() + '-'
            + String(d.getMonth() + 1).padStart(2, '0') + '-'
            + String(d.getDate()).padStart(2, '0');
          const entry = log[k];
          if (entry && entry.sleep && typeof entry.sleep.hours === 'number') {
            sleepNightsHistory.push(entry.sleep.hours);
          }
        }
      }
    } catch (_) { restRow = null; }

    let decision = null;
    try {
      decision = BfrbRisk.assess({
        events: events, now: Date.now(), recoveryState: recoveryState,
        restRow: restRow, sleepNightsHistory: sleepNightsHistory,
      });
    } catch (_) { return; }
    if (!decision || decision.band !== 'clustered') return;

    // Once-per-day throttle — at most one supportive toast per local day. The
    // single day key covers BOTH variants (mindful + clustered-only); the
    // mindful variant takes precedence by being the if-branch below.
    let last = null;
    try { last = localStorage.getItem(SUPPORT_TOAST_DAY_KEY); } catch (_) {}
    if (last === today) return;

    // Stamp the day ONLY after a successful paint, so the throttle records a
    // toast that was SHOWN — not merely attempted. If Toast is somehow absent
    // or throws, the day stays un-consumed and the nudge can still fire later.
    if (decision.mindfulSuggested
        && typeof Toast !== 'undefined' && typeof Toast.action === 'function') {
      // Escalated variant (Phase 3): catches clustering AND last night ran
      // short → a tappable toast that routes straight to Wellness › Mindful.
      try {
        Toast.action(MINDFUL_COPY, 'Open', () => {
          if (typeof TempoNav !== 'undefined' && typeof TempoNav.applyRoute === 'function') {
            TempoNav.applyRoute({ pillar: 'wellness', sub: 'mindful' });
          }
        });
        localStorage.setItem(SUPPORT_TOAST_DAY_KEY, today);
      } catch (_) {}
    } else if (typeof Toast !== 'undefined' && typeof Toast.notice === 'function') {
      try {
        Toast.notice(SUPPORT_COPY);
        localStorage.setItem(SUPPORT_TOAST_DAY_KEY, today);
      } catch (_) {}
    }
  }

  // ── Antecedent capture popover ────────────────────────────────────────
  // Created lazily on <body> (mirrors RhythmInsights' lazy tooltip element).
  // Chips are OPTIONAL: one tap logs the catch field-less via the auto-commit
  // fallback; tapping chips folds urge + one trigger into the same single
  // commit. The popover never blocks the FAB hot path.
  let _popoverEl = null;

  function _buildPopover() {
    if (_popoverEl || typeof document === 'undefined' || !document.body) return _popoverEl;
    const el = document.createElement('div');
    el.id = POPOVER_ID;
    el.className = 'bfrb-capture';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'Tag this BFRB catch (optional)');
    el.hidden = true;

    const urgeRow = URGE_CHIPS.map(c =>
      '<button type="button" class="bfrb-chip" data-urge="' + c.level + '" aria-pressed="false">'
      + escapeHtml(c.label) + '</button>').join('');
    const trigRow = TRIGGER_CHIPS.map(z =>
      '<button type="button" class="bfrb-chip" data-zone="' + escapeHtml(z) + '" aria-pressed="false">'
      + escapeHtml(z.charAt(0).toUpperCase() + z.slice(1)) + '</button>').join('');

    el.innerHTML =
      '<div class="bfrb-capture-title">Logged ✓'
      + '<span class="bfrb-capture-sub"> — what set it off? (optional)</span></div>'
      + '<div class="bfrb-capture-grouplabel">Urge</div>'
      + '<div class="bfrb-capture-row" data-group="urge">' + urgeRow + '</div>'
      + '<div class="bfrb-capture-grouplabel">Trigger</div>'
      + '<div class="bfrb-capture-row" data-group="trigger">' + trigRow + '</div>'
      + '<div class="bfrb-capture-actions">'
      + '<button type="button" class="bfrb-capture-done">Done</button></div>';

    el.addEventListener('click', _onPopoverClick);
    document.body.appendChild(el);
    _popoverEl = el;
    return el;
  }

  function _onPopoverClick(e) {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('.bfrb-capture-done')) { commitPending(); return; }
    const chip = t.closest('.bfrb-chip');
    if (!chip || !pending) return;
    if (chip.hasAttribute('data-urge')) {
      const lvl = parseInt(chip.getAttribute('data-urge'), 10);
      pending.urgeLevel = (pending.urgeLevel === lvl) ? null : lvl; // toggle off on re-tap
      _syncSelected('urge');
    } else if (chip.hasAttribute('data-zone')) {
      const z = chip.getAttribute('data-zone');
      pending.triggerZone = (pending.triggerZone === z) ? null : z;
      _syncSelected('trigger');
    }
    armCommitTimer(AUTO_COMMIT_MS); // re-arm so an engaged user is never cut off
  }

  // Reflect the pending selection into each chip row's .is-selected state.
  function _syncSelected(group) {
    if (!_popoverEl) return;
    const row = _popoverEl.querySelector('.bfrb-capture-row[data-group="' + group + '"]');
    if (!row) return;
    row.querySelectorAll('.bfrb-chip').forEach(chip => {
      const on = (group === 'urge')
        ? (pending && pending.urgeLevel === parseInt(chip.getAttribute('data-urge'), 10))
        : (pending && pending.triggerZone === chip.getAttribute('data-zone'));
      chip.classList.toggle('is-selected', !!on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false'); // D: toggle-button state for AT
    });
  }

  function showPicker() {
    const el = _buildPopover();
    if (!el) return;
    el.querySelectorAll('.bfrb-chip').forEach(c => { c.classList.remove('is-selected'); c.setAttribute('aria-pressed', 'false'); });
    el.hidden = false;
    // D: move focus into the popover so keyboard/SR users can tag the catch.
    // This is a NON-blocking, auto-committing popover (timer + click-outside),
    // so we deliberately do NOT trap focus — just move it in, and restore it to
    // the FAB on hide (below).
    const firstChip = el.querySelector('.bfrb-chip');
    if (firstChip && firstChip.focus) firstChip.focus();
  }

  function hidePicker() {
    if (!_popoverEl) return;
    // D: restore focus to the FAB, but only if it currently sits inside the
    // popover (hidePicker is also reached from non-focus paths like the auto-
    // commit timer — we shouldn't yank focus then).
    const focusWasInside = _popoverEl.contains(document.activeElement);
    _popoverEl.hidden = true;
    if (focusWasInside) {
      const fab = document.getElementById(BTN_ID);
      if (fab && fab.focus) fab.focus();
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
    // Also tick on visibility in case another tab mutated a store. When the tab
    // is BACKGROUNDED, flush any pending catch first so a deferred antecedent
    // capture can't be lost to a tab suspend.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) commitPending();
      else renderLabel();
    });

    // Guaranteed flush — a pending catch must never be lost on app exit or a
    // route change. commitPending is idempotent, so registering it on several
    // lifecycle events is safe (whichever fires first wins).
    window.addEventListener('pagehide', commitPending);
    window.addEventListener('beforeunload', commitPending);
    window.addEventListener('hashchange', commitPending);

    // Click anywhere outside the popover (and not on the FAB) dismisses it,
    // committing the pending catch. The natural "I'm done tagging" signal — so
    // the backstop timer never has to race a deliberating user. The FAB is
    // excluded because its own handler (logCatch → commitPending) owns that path.
    document.addEventListener('click', (e) => {
      if (!_popoverEl || _popoverEl.hidden) return;
      const t = e.target;
      if (t && t.closest && (t.closest('#' + POPOVER_ID) || t.closest('#' + BTN_ID))) return;
      commitPending();
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

  return { logCatch, renderLabel, getActiveStoreKey, commitPending };
})();
