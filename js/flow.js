const Flow = (() => {
  // Fixed preset durations
  const FOCUS_90 = 90 * 60000;
  const FOCUS_120 = 120 * 60000;
  const RECOVERY_MS = 15 * 60000;

  // status: 'idle' | 'running' | 'paused' | 'overflowing' | 'recovery'
  //       | 'recoveryPaused' | 'recoveryOverflowing' | 'done'
  // 'overflowing' replaces the old 'focusComplete' — focus is past zero,
  // alarm has fired, but the engine keeps counting up until the user
  // either starts recovery or skips. Same idea for recovery overshoot.
  // phase:  'focus' | 'recovery'
  let status = 'idle';
  let phase = 'focus';
  let focusDurationMs = FOCUS_90;
  let startedAt = null;
  let accumulatedMs = 0;
  let phaseAdjustmentMs = 0;     // ±N min adjust applied to the current phase only; reset on phase boundary
  let sessionStartedAt = null;
  let focusEndedAt = null;
  let goal = '';
  let phaseCallback = null;
  // F21: per-device, never synced. Each device's engine fires its own
  // chime independently — receiving alarmFired=true from another device
  // would suppress the local alarm, violating the strategy doc's Stage E
  // per-device contract. Engine state (`flow_state`) is excluded from
  // sync today; this marker exists so a future synced-store PR can't
  // smuggle the field in without re-checking the contract.
  let alarmFired = false;
  let zeroCrossedAt = null;

  function getBasePhaseDurationMs() {
    return phase === 'focus' ? focusDurationMs : RECOVERY_MS;
  }

  function getCurrentPhaseDurationMs() {
    return Math.max(1000, getBasePhaseDurationMs() + phaseAdjustmentMs);
  }

  function isTickingStatus(s) {
    return s === 'running' || s === 'recovery'
        || s === 'overflowing' || s === 'recoveryOverflowing';
  }

  function rawElapsedMs() {
    let elapsed = accumulatedMs;
    if (isTickingStatus(status) && startedAt !== null) {
      elapsed += Date.now() - startedAt;
    }
    return elapsed;
  }

  function getRemainingMs() {
    return Math.max(0, getCurrentPhaseDurationMs() - rawElapsedMs());
  }

  function getElapsedMs() {
    return Math.min(rawElapsedMs(), getCurrentPhaseDurationMs());
  }

  function getOvershootMs() {
    return Math.max(0, rawElapsedMs() - getCurrentPhaseDurationMs());
  }

  function isOvershooting() {
    return status === 'overflowing' || status === 'recoveryOverflowing';
  }

  function getZeroCrossedAt() {
    return zeroCrossedAt;
  }

  function getProgress() {
    const dur = getCurrentPhaseDurationMs();
    if (dur === 0) return 0;
    return Math.min(1, getElapsedMs() / dur);
  }

  // ── Live Activity bridge (iOS lock screen / Dynamic Island) ──────────
  // Same gate as js/timer.js: user flag (default ON when key absent) +
  // Platform presence. Fire-and-forget — engine state mutation MUST NOT
  // block on the bridge. One continuous activity (id 'flow') spans the
  // whole block: focus→recovery updates it in place (the native side
  // update-routes startTimer when the activity already exists), and phase
  // zero-crossings emit nothing (the widget's staleDate contract renders
  // "Done ✓" until the user acts).
  function _laEnabled() {
    return localStorage.getItem('live_activities_enabled') !== '0'
      && typeof Platform !== 'undefined' && !!Platform.liveActivity;
  }

  // Truthful progress window: startedAt is back-dated by the elapsed already
  // on the phase clock, so the OS-rendered progress bar survives resumes.
  // The widget suppresses ProgressView labels, so the window is only ever
  // read as fill fraction + countdown target.
  function _laWindow() {
    const now = Date.now();
    return { startedAt: now - getElapsedMs(), endsAt: now + getRemainingMs() };
  }

  function getPhaseLabel() {
    return phase === 'focus' ? 'Focus' : 'Recovery';
  }

  function _laStart() {
    if (!_laEnabled()) return;
    const w = _laWindow();
    Platform.liveActivity.startTimer({
      id: 'flow', name: 'Flow Block', mode: 'flow',
      label: getPhaseLabel(),
      startedAt: w.startedAt, endsAt: w.endsAt, isPaused: false,
    }).catch(() => {});
  }

  function start() {
    if (status !== 'idle' && status !== 'paused') return;
    const now = Date.now();
    startedAt = now;
    if (!sessionStartedAt) sessionStartedAt = now;
    status = 'running';
    phase = 'focus';
    // Fresh start AND resume-from-pause both land here — no duplicate
    // activity on resume (see the update-routing note above).
    _laStart();
  }

  function pause() {
    if (status !== 'running' && status !== 'recovery') return;
    accumulatedMs += Date.now() - startedAt;
    startedAt = null;
    status = status === 'running' ? 'paused' : 'recoveryPaused';
    if (_laEnabled()) {
      Platform.liveActivity.updateTimer({ id: 'flow', isPaused: true }).catch(() => {});
    }
  }

  function resume() {
    if (status !== 'paused' && status !== 'recoveryPaused') return;
    startedAt = Date.now();
    status = status === 'paused' ? 'running' : 'recovery';
    // startTimer (not update) — self-healing: if a force-quit lost the
    // activity, this re-requests it instead of noop-updating a ghost.
    _laStart();
  }

  function reset() {
    status = 'idle';
    phase = 'focus';
    startedAt = null;
    accumulatedMs = 0;
    phaseAdjustmentMs = 0;
    alarmFired = false;
    zeroCrossedAt = null;
    sessionStartedAt = null;
    focusEndedAt = null;
    goal = '';
    if (_laEnabled()) {
      Platform.liveActivity.endTimer({ id: 'flow' }).catch(() => {});
    }
  }

  function adjustRemainingMs(deltaMs) {
    if (status !== 'running' && status !== 'paused'
        && status !== 'recovery' && status !== 'recoveryPaused') return false;
    if (deltaMs < 0) {
      const remaining = getRemainingMs();
      if (remaining + deltaMs < 1000) return false;
    }
    phaseAdjustmentMs += deltaMs;
    const minAdjustment = 1000 - getBasePhaseDurationMs();
    if (phaseAdjustmentMs < minAdjustment) phaseAdjustmentMs = minAdjustment;
    // Keep the lock-screen countdown in step (ticking states only — a
    // paused activity is frozen by design and picks the new remaining up
    // from the resume re-emit).
    if ((status === 'running' || status === 'recovery') && _laEnabled()) {
      const w = _laWindow();
      Platform.liveActivity.updateTimer({
        id: 'flow', startedAt: w.startedAt, endsAt: w.endsAt, isPaused: false,
      }).catch(() => {});
    }
    return true;
  }

  function startRecovery() {
    if (status !== 'overflowing') return;
    phase = 'recovery';
    accumulatedMs = 0;
    phaseAdjustmentMs = 0;
    alarmFired = false;
    zeroCrossedAt = null;
    startedAt = Date.now();
    status = 'recovery';
    // Updates the surviving (stale "Done ✓") focus activity in place into
    // the recovery countdown — or re-requests one if it was lost.
    _laStart();
  }

  // End the focus phase early. Captures actual elapsed time into
  // accumulatedMs (so history records the real duration, not the planned
  // blockDurationMs), then transitions to overflowing and fires the
  // phase-complete callback so the UI + history pipeline treats this the
  // same as a naturally-completed block. No overshoot accrues — early-end
  // means the engine never crossed zero.
  function endFocusEarly() {
    if (phase !== 'focus') return;
    if (status !== 'running' && status !== 'paused') return;
    if (status === 'running' && startedAt) {
      accumulatedMs += Date.now() - startedAt;
    }
    startedAt = null;
    status = 'overflowing';
    focusEndedAt = Date.now();
    // Treat the alarm as already fired — endFocusEarly is the user's explicit
    // action and we don't want a double-alarm.
    if (!alarmFired) {
      alarmFired = true;
      if (phaseCallback) phaseCallback('focus');
    }
    // The activity was counting down to a now-dead future endsAt — pull
    // endsAt to now so the widget's staleDate contract flips it to "Done ✓"
    // immediately. isPaused must clear: a paused activity is never "done".
    if (_laEnabled()) {
      Platform.liveActivity.updateTimer({
        id: 'flow', endsAt: Date.now(), isPaused: false,
      }).catch(() => {});
    }
  }

  // Elapsed time inside the focus phase. Returns accumulatedMs for all
  // statuses except those ticking forward, where it also includes the in-flight
  // chunk since the last resume. Always bounded to the focus phase (returns
  // 0 on recovery states) — but during overshoot we return the full elapsed
  // so callers see how long the user was actually in the focus block.
  function getFocusElapsedMs() {
    if (phase !== 'focus') return 0;
    const inFlight = (status === 'running' || status === 'overflowing') && startedAt
      ? Date.now() - startedAt : 0;
    return accumulatedMs + inFlight;
  }

  function skipRecovery() {
    if (status !== 'overflowing'
        && status !== 'recovery'
        && status !== 'recoveryPaused'
        && status !== 'recoveryOverflowing') return;
    status = 'done';
    startedAt = null;
    accumulatedMs = 0;
    phaseAdjustmentMs = 0;
    // Session over — end the lock-screen activity. (The UI's follow-up
    // reset() end is a safe noop on the native side.)
    if (_laEnabled()) {
      Platform.liveActivity.endTimer({ id: 'flow' }).catch(() => {});
    }
  }

  function checkFinished() {
    // No Live Activity emits on either zero-cross below: endsAt has passed,
    // so the widget's staleDate contract already renders "Done ✓" — and the
    // activity must survive so startRecovery()/resume() can update it.
    if (status === 'running' && getRemainingMs() <= 0) {
      const now = Date.now();
      const carry = startedAt !== null ? now - startedAt : 0;
      accumulatedMs += carry;
      startedAt = now;
      status = 'overflowing';
      zeroCrossedAt = now;
      focusEndedAt = now;
      if (!alarmFired) {
        alarmFired = true;
        if (phaseCallback) phaseCallback('focus');
      }
      return true;
    }
    if (status === 'recovery' && getRemainingMs() <= 0) {
      const now = Date.now();
      const carry = startedAt !== null ? now - startedAt : 0;
      accumulatedMs += carry;
      startedAt = now;
      status = 'recoveryOverflowing';
      zeroCrossedAt = now;
      if (!alarmFired) {
        alarmFired = true;
        if (phaseCallback) phaseCallback('recovery');
      }
      return true;
    }
    return false;
  }

  function onPhaseComplete(cb) {
    phaseCallback = cb;
  }

  function configure(opts) {
    if (status !== 'idle') return;
    if (opts.focusDurationMs !== undefined) {
      // F20: split absent vs present-but-unknown.
      // - Absent / non-numeric → default FOCUS_90 (the safest baseline).
      // - Present numeric (including future values like 60-min or 180-min
      //   focus blocks rolled out by a newer client) → preserve verbatim.
      // The UI only offers the two presets, so today this path always sees
      // FOCUS_90 or FOCUS_120; the preserve branch matters when configure()
      // is called from the load path (app.js → JSON.parse(flow_config)).
      focusDurationMs = (typeof opts.focusDurationMs === 'number'
                         && isFinite(opts.focusDurationMs))
        ? opts.focusDurationMs
        : FOCUS_90;
    }
  }

  function setGoal(text) {
    goal = (text || '').slice(0, 120);
  }

  function getStatus() { return status; }
  function getPhase() { return phase; }
  function getGoal() { return goal; }
  function getFocusDurationMs() { return focusDurationMs; }
  function getRecoveryDurationMs() { return RECOVERY_MS; }
  function getSessionStartedAt() { return sessionStartedAt; }
  function getFocusEndedAt() { return focusEndedAt; }
  function getConfig() { return { focusDurationMs }; }

  function getState() {
    return {
      status, phase, focusDurationMs,
      startedAt, accumulatedMs, phaseAdjustmentMs,
      alarmFired, zeroCrossedAt,
      sessionStartedAt, focusEndedAt, goal,
    };
  }

  function loadState(state) {
    if (!state) return;
    status = state.status ?? 'idle';
    // Migrate legacy 'focusComplete' to the new 'overflowing' state.
    if (status === 'focusComplete') status = 'overflowing';
    phase = state.phase ?? 'focus';
    // F20: split absent vs present-but-unknown — see configure() for the
    // full rationale. Absent / non-numeric → default FOCUS_90; any finite
    // numeric value (including a future 180-min preset) is preserved
    // verbatim so a roundtrip on this client doesn't silently downcast
    // forward-compat data.
    focusDurationMs = (typeof state.focusDurationMs === 'number'
                       && isFinite(state.focusDurationMs))
      ? state.focusDurationMs
      : FOCUS_90;
    startedAt = state.startedAt ?? null;
    accumulatedMs = state.accumulatedMs ?? 0;
    phaseAdjustmentMs = state.phaseAdjustmentMs ?? 0;
    alarmFired = state.alarmFired === true;
    zeroCrossedAt = state.zeroCrossedAt ?? null;
    sessionStartedAt = state.sessionStartedAt ?? null;
    focusEndedAt = state.focusEndedAt ?? null;
    goal = state.goal ?? '';

    // Clock skew guard
    if ((status === 'running' || status === 'recovery') && startedAt && startedAt > Date.now()) {
      startedAt = null;
      status = status === 'running' ? 'paused' : 'recoveryPaused';
    }
    // Check if phase should have finished while page was closed
    if (status === 'running' && getRemainingMs() <= 0) {
      const now = Date.now();
      const carry = startedAt !== null ? now - startedAt : 0;
      accumulatedMs += carry;
      startedAt = now;
      status = 'overflowing';
      focusEndedAt = focusEndedAt || now;
      if (zeroCrossedAt === null) zeroCrossedAt = now;
      alarmFired = true;
    } else if (status === 'recovery' && getRemainingMs() <= 0) {
      const now = Date.now();
      const carry = startedAt !== null ? now - startedAt : 0;
      accumulatedMs += carry;
      startedAt = now;
      status = 'recoveryOverflowing';
      if (zeroCrossedAt === null) zeroCrossedAt = now;
      alarmFired = true;
    }
    // 24h overshoot cap.
    // (The finished-while-away branches above emit no endTimer — a finished
    // PHASE is not a finished session; the stale "Done ✓" activity stays up
    // so the boundary is glanceable and the next transition reuses it.)
    if (isOvershooting()) {
      const cap = getCurrentPhaseDurationMs() + 24 * 60 * 60 * 1000;
      const elapsed = rawElapsedMs();
      if (elapsed > cap) {
        accumulatedMs = cap;
        startedAt = null;
        // A day-plus-past-zero block is abandoned, not glanceable — clean
        // up the orphaned lock-screen activity.
        if (_laEnabled()) {
          Platform.liveActivity.endTimer({ id: 'flow' }).catch(() => {});
        }
      }
    }
  }

  return {
    start, pause, resume, reset,
    startRecovery, skipRecovery, endFocusEarly,
    checkFinished, onPhaseComplete, configure,
    adjustRemainingMs,
    setGoal, getGoal,
    getRemainingMs, getElapsedMs, getProgress, getFocusElapsedMs,
    getOvershootMs, isOvershooting, getZeroCrossedAt,
    getStatus, getPhase, getPhaseLabel,
    getCurrentPhaseDurationMs, getFocusDurationMs, getRecoveryDurationMs,
    getSessionStartedAt, getFocusEndedAt, getConfig,
    getState, loadState,
    PRESETS: { FOCUS_90, FOCUS_120, RECOVERY_MS },
  };
})();
