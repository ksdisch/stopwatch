const Flow = (() => {
  // Fixed preset durations
  const FOCUS_90 = 90 * 60000;
  const FOCUS_120 = 120 * 60000;
  const RECOVERY_MS = 15 * 60000;

  // status: 'idle' | 'running' | 'paused' | 'focusComplete'
  //       | 'recovery' | 'recoveryPaused' | 'done'
  // phase:  'focus' | 'recovery'
  let status = 'idle';
  let phase = 'focus';
  let focusDurationMs = FOCUS_90;
  let startedAt = null;
  let accumulatedMs = 0;
  let sessionStartedAt = null;
  let focusEndedAt = null;
  let goal = '';
  let phaseCallback = null;

  function getCurrentPhaseDurationMs() {
    return phase === 'focus' ? focusDurationMs : RECOVERY_MS;
  }

  function getRemainingMs() {
    let elapsed = accumulatedMs;
    if ((status === 'running' || status === 'recovery') && startedAt !== null) {
      elapsed += Date.now() - startedAt;
    }
    return Math.max(0, getCurrentPhaseDurationMs() - elapsed);
  }

  function getElapsedMs() {
    let elapsed = accumulatedMs;
    if ((status === 'running' || status === 'recovery') && startedAt !== null) {
      elapsed += Date.now() - startedAt;
    }
    return Math.min(elapsed, getCurrentPhaseDurationMs());
  }

  function getProgress() {
    const dur = getCurrentPhaseDurationMs();
    if (dur === 0) return 0;
    return Math.min(1, getElapsedMs() / dur);
  }

  function start() {
    if (status !== 'idle' && status !== 'paused') return;
    const now = Date.now();
    startedAt = now;
    if (!sessionStartedAt) sessionStartedAt = now;
    status = 'running';
    phase = 'focus';
  }

  function pause() {
    if (status !== 'running' && status !== 'recovery') return;
    accumulatedMs += Date.now() - startedAt;
    startedAt = null;
    status = status === 'running' ? 'paused' : 'recoveryPaused';
  }

  function resume() {
    if (status !== 'paused' && status !== 'recoveryPaused') return;
    startedAt = Date.now();
    status = status === 'paused' ? 'running' : 'recovery';
  }

  function reset() {
    status = 'idle';
    phase = 'focus';
    startedAt = null;
    accumulatedMs = 0;
    sessionStartedAt = null;
    focusEndedAt = null;
    goal = '';
  }

  function startRecovery() {
    if (status !== 'focusComplete') return;
    phase = 'recovery';
    accumulatedMs = 0;
    startedAt = Date.now();
    status = 'recovery';
  }

  function skipRecovery() {
    if (status !== 'focusComplete' && status !== 'recovery' && status !== 'recoveryPaused') return;
    status = 'done';
    startedAt = null;
    accumulatedMs = 0;
  }

  function checkFinished() {
    if (status === 'running' && getRemainingMs() <= 0) {
      accumulatedMs = getCurrentPhaseDurationMs();
      startedAt = null;
      status = 'focusComplete';
      focusEndedAt = Date.now();
      if (phaseCallback) phaseCallback('focus');
      return true;
    }
    if (status === 'recovery' && getRemainingMs() <= 0) {
      accumulatedMs = getCurrentPhaseDurationMs();
      startedAt = null;
      status = 'done';
      if (phaseCallback) phaseCallback('recovery');
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
      // Only allow the two presets
      focusDurationMs = opts.focusDurationMs === FOCUS_120 ? FOCUS_120 : FOCUS_90;
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
      startedAt, accumulatedMs,
      sessionStartedAt, focusEndedAt, goal,
    };
  }

  function loadState(state) {
    if (!state) return;
    status = state.status ?? 'idle';
    phase = state.phase ?? 'focus';
    focusDurationMs = state.focusDurationMs === FOCUS_120 ? FOCUS_120 : FOCUS_90;
    startedAt = state.startedAt ?? null;
    accumulatedMs = state.accumulatedMs ?? 0;
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
      accumulatedMs = getCurrentPhaseDurationMs();
      startedAt = null;
      status = 'focusComplete';
      focusEndedAt = focusEndedAt || Date.now();
    } else if (status === 'recovery' && getRemainingMs() <= 0) {
      accumulatedMs = getCurrentPhaseDurationMs();
      startedAt = null;
      status = 'done';
    }
  }

  return {
    start, pause, resume, reset,
    startRecovery, skipRecovery,
    checkFinished, onPhaseComplete, configure,
    setGoal, getGoal,
    getRemainingMs, getElapsedMs, getProgress,
    getStatus, getPhase,
    getCurrentPhaseDurationMs, getFocusDurationMs, getRecoveryDurationMs,
    getSessionStartedAt, getFocusEndedAt, getConfig,
    getState, loadState,
    PRESETS: { FOCUS_90, FOCUS_120, RECOVERY_MS },
  };
})();
