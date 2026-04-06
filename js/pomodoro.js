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
  let phaseCallback = null;

  function getCurrentPhaseDurationMs() {
    if (phase === 'work') return workMs;
    if (phase === 'shortBreak') return shortBreakMs;
    return longBreakMs;
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
    startedAt = Date.now();
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
  }

  function checkFinished() {
    if (status === 'running' && getRemainingMs() <= 0) {
      accumulatedMs = getCurrentPhaseDurationMs();
      startedAt = null;
      status = 'phaseComplete';
      if (phaseCallback) phaseCallback(phase);
      return true;
    }
    return false;
  }

  function nextPhase() {
    if (status !== 'phaseComplete' && status !== 'done') return;
    accumulatedMs = 0;
    startedAt = null;

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
      startedAt, accumulatedMs,
    };
  }

  function loadState(state) {
    if (!state) return;
    status = state.status || 'idle';
    phase = state.phase || 'work';
    cycleIndex = state.cycleIndex || 0;
    totalCycles = state.totalCycles || 4;
    workMs = state.workMs || 25 * 60000;
    shortBreakMs = state.shortBreakMs || 5 * 60000;
    longBreakMs = state.longBreakMs || 15 * 60000;
    startedAt = state.startedAt || null;
    accumulatedMs = state.accumulatedMs || 0;

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
    start, pause, reset, checkFinished, nextPhase,
    getRemainingMs, getElapsedMs, getProgress,
    getStatus, getPhase, getCycleIndex, getTotalCycles,
    getCurrentPhaseDurationMs, getConfig,
    onPhaseComplete, configure,
    getState, loadState,
  };
})();
