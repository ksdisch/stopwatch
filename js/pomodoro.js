const Pomodoro = (() => {
  let status = 'idle'; // 'idle' | 'running' | 'paused' | 'phaseComplete' | 'done'
  let phase = 'work';  // 'work' | 'shortBreak' | 'longBreak'
  let cycleIndex = 0;  // 0-based, which work session we're on
  let totalCycles = 4;
  let workMs = 25 * 60000;
  let shortBreakMs = 5 * 60000;
  let longBreakMs = 15 * 60000;
  let startedAt = null;
  let accumulatedMs = 0;
  let phaseAdjustmentMs = 0;    // ±N min adjust applied to the current phase only; reset on phase boundary
  let phaseCallback = null;
  let sessionStartedAt = null;  // When the overall Pomodoro session began
  let phaseStartedAt = null;    // When the current phase first started
  let phaseLog = [];            // { phase, startedAt, endedAt } for each completed phase

  function getBasePhaseDurationMs() {
    if (phase === 'work') return workMs;
    if (phase === 'shortBreak') return shortBreakMs;
    return longBreakMs;
  }

  function getCurrentPhaseDurationMs() {
    return Math.max(1000, getBasePhaseDurationMs() + phaseAdjustmentMs);
  }

  function getRemainingMs() {
    let elapsed = accumulatedMs;
    if (status === 'running' && startedAt !== null) {
      elapsed += Date.now() - startedAt;
    }
    return Math.max(0, getCurrentPhaseDurationMs() - elapsed);
  }

  function getElapsedMs() {
    let elapsed = accumulatedMs;
    if (status === 'running' && startedAt !== null) {
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
    if (status === 'running' || status === 'done') return;
    if (status === 'phaseComplete') return;
    const now = Date.now();
    startedAt = now;
    if (!sessionStartedAt) sessionStartedAt = now;
    if (!phaseStartedAt) phaseStartedAt = now;
    status = 'running';
  }

  function pause() {
    if (status !== 'running') return;
    accumulatedMs += Date.now() - startedAt;
    startedAt = null;
    status = 'paused';
  }

  function reset() {
    status = 'idle';
    phase = 'work';
    cycleIndex = 0;
    startedAt = null;
    accumulatedMs = 0;
    phaseAdjustmentMs = 0;
    sessionStartedAt = null;
    phaseStartedAt = null;
    phaseLog = [];
  }

  function adjustRemainingMs(deltaMs) {
    if (status !== 'running' && status !== 'paused') return false;
    if (deltaMs < 0) {
      const remaining = getRemainingMs();
      if (remaining + deltaMs < 1000) return false;
    }
    phaseAdjustmentMs += deltaMs;
    // Floor: keep effective phase duration above 1s no matter how much we subtract.
    const minAdjustment = 1000 - getBasePhaseDurationMs();
    if (phaseAdjustmentMs < minAdjustment) phaseAdjustmentMs = minAdjustment;
    return true;
  }

  function checkFinished() {
    if (status === 'running' && getRemainingMs() <= 0) {
      const now = Date.now();
      accumulatedMs = getCurrentPhaseDurationMs();
      startedAt = null;
      status = 'phaseComplete';
      phaseLog.push({ phase, startedAt: phaseStartedAt, endedAt: now });
      phaseStartedAt = null;
      if (phaseCallback) phaseCallback(phase);
      return true;
    }
    return false;
  }

  function nextPhase() {
    if (status !== 'phaseComplete' && status !== 'done') return;
    accumulatedMs = 0;
    startedAt = null;
    phaseStartedAt = null;
    phaseAdjustmentMs = 0;

    if (phase === 'work') {
      cycleIndex++;
      if (cycleIndex >= totalCycles) {
        phase = 'longBreak';
      } else {
        phase = 'shortBreak';
      }
    } else {
      // Coming from a break
      if (phase === 'longBreak') {
        // Full set complete
        status = 'done';
        cycleIndex = 0;
        phase = 'work';
        return;
      }
      phase = 'work';
    }
    status = 'idle';
  }

  function restartPhase() {
    if (status === 'idle' || status === 'done') return;
    if (phaseStartedAt) {
      phaseLog.push({ phase, startedAt: phaseStartedAt, endedAt: Date.now(), restarted: true });
    }
    accumulatedMs = 0;
    startedAt = null;
    phaseStartedAt = null;
    phaseAdjustmentMs = 0;
    status = 'idle';
  }

  function onPhaseComplete(cb) {
    phaseCallback = cb;
  }

  function configure(opts) {
    if (status !== 'idle') return;
    if (opts.workMs !== undefined) workMs = Math.max(60000, opts.workMs);
    if (opts.shortBreakMs !== undefined) shortBreakMs = Math.max(60000, opts.shortBreakMs);
    if (opts.longBreakMs !== undefined) longBreakMs = Math.max(60000, opts.longBreakMs);
    if (opts.totalCycles !== undefined) totalCycles = Math.max(1, Math.min(10, opts.totalCycles));
  }

  function getStatus() { return status; }
  function getPhase() { return phase; }
  function getCycleIndex() { return cycleIndex; }
  function getTotalCycles() { return totalCycles; }
  function getConfig() {
    return { workMs, shortBreakMs, longBreakMs, totalCycles };
  }

  function getState() {
    return {
      status, phase, cycleIndex, totalCycles,
      workMs, shortBreakMs, longBreakMs,
      startedAt, accumulatedMs, phaseAdjustmentMs,
      sessionStartedAt, phaseStartedAt, phaseLog,
    };
  }

  function loadState(state) {
    if (!state) return;
    status = state.status ?? 'idle';
    phase = state.phase ?? 'work';
    cycleIndex = state.cycleIndex ?? 0;
    totalCycles = state.totalCycles ?? 4;
    workMs = state.workMs ?? 25 * 60000;
    shortBreakMs = state.shortBreakMs ?? 5 * 60000;
    longBreakMs = state.longBreakMs ?? 15 * 60000;
    startedAt = state.startedAt ?? null;
    accumulatedMs = state.accumulatedMs ?? 0;
    phaseAdjustmentMs = state.phaseAdjustmentMs ?? 0;
    sessionStartedAt = state.sessionStartedAt ?? null;
    phaseStartedAt = state.phaseStartedAt ?? null;
    phaseLog = state.phaseLog ?? [];

    // Clock skew guard
    if (status === 'running' && startedAt && startedAt > Date.now()) {
      startedAt = null;
      status = 'paused';
    }
    // Check if phase should have finished while page was closed
    if (status === 'running' && getRemainingMs() <= 0) {
      status = 'phaseComplete';
      accumulatedMs = getCurrentPhaseDurationMs();
      startedAt = null;
    }
  }

  return {
    start, pause, reset, restartPhase, checkFinished, nextPhase,
    adjustRemainingMs,
    getRemainingMs, getElapsedMs, getProgress,
    getStatus, getPhase, getCycleIndex, getTotalCycles,
    getCurrentPhaseDurationMs, getConfig,
    getSessionStartedAt: () => sessionStartedAt,
    getPhaseLog: () => phaseLog,
    getPhaseStartedAt: () => phaseStartedAt,
    onPhaseComplete, configure,
    getState, loadState,
  };
})();
