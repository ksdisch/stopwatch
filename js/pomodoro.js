const Pomodoro = (() => {
  // 'idle' | 'running' | 'paused' | 'overflowing' | 'done'
  // 'overflowing' replaces the old 'phaseComplete'. The phase has crossed
  // zero, the alarm has fired, but the engine continues counting up until
  // the user advances (nextPhase) or the auto-advance overlay fires.
  let status = 'idle';
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
  let alarmFired = false;
  let zeroCrossedAt = null;
  let sessionStartedAt = null;  // When the overall Pomodoro session began
  let phaseStartedAt = null;    // When the current phase first started
  let phaseLog = [];            // { phase, startedAt, endedAt, overshootMs } per completed phase

  function getBasePhaseDurationMs() {
    if (phase === 'work') return workMs;
    if (phase === 'shortBreak') return shortBreakMs;
    return longBreakMs;
  }

  function getCurrentPhaseDurationMs() {
    return Math.max(1000, getBasePhaseDurationMs() + phaseAdjustmentMs);
  }

  // Raw elapsed (without clamping) — used for overshoot math.
  function rawElapsedMs() {
    let elapsed = accumulatedMs;
    if ((status === 'running' || status === 'overflowing') && startedAt !== null) {
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
    return status === 'overflowing';
  }

  function getZeroCrossedAt() {
    return zeroCrossedAt;
  }

  function getProgress() {
    const dur = getCurrentPhaseDurationMs();
    if (dur === 0) return 0;
    return Math.min(1, getElapsedMs() / dur);
  }

  function start() {
    if (status === 'running' || status === 'done') return;
    if (status === 'overflowing') return;
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
    alarmFired = false;
    zeroCrossedAt = null;
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
      // Snapshot at exactly the duration so subsequent (now - startedAt)
      // becomes the overshoot delta. Keep startedAt set so the clock keeps
      // ticking through the overflowing state.
      const now = Date.now();
      const carry = startedAt !== null ? now - startedAt : 0;
      accumulatedMs += carry;
      startedAt = now;
      status = 'overflowing';
      zeroCrossedAt = now;
      // Push the phase log entry now (with overshootMs: 0); when the user
      // advances via nextPhase we'll back-fill the overshoot value.
      phaseLog.push({ phase, startedAt: phaseStartedAt, endedAt: now, overshootMs: 0 });
      phaseStartedAt = null;
      if (!alarmFired) {
        alarmFired = true;
        if (phaseCallback) phaseCallback(phase);
      }
      return true;
    }
    return false;
  }

  function nextPhase() {
    if (status !== 'overflowing' && status !== 'done') return;
    // Capture overshoot into the most recent phaseLog entry before resetting.
    if (status === 'overflowing') {
      const overshoot = getOvershootMs();
      if (phaseLog.length > 0) {
        phaseLog[phaseLog.length - 1].overshootMs = overshoot;
      }
    }
    accumulatedMs = 0;
    startedAt = null;
    phaseStartedAt = null;
    phaseAdjustmentMs = 0;
    alarmFired = false;
    zeroCrossedAt = null;

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
    alarmFired = false;
    zeroCrossedAt = null;
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
      alarmFired, zeroCrossedAt,
      sessionStartedAt, phaseStartedAt, phaseLog,
    };
  }

  function loadState(state) {
    if (!state) return;
    status = state.status ?? 'idle';
    // Migrate legacy 'phaseComplete' status to 'overflowing' so old saved
    // states resume cleanly into the new state machine. Old states have no
    // overshoot tracked — treat alarmFired as true so we don't re-fire.
    if (status === 'phaseComplete') {
      status = 'overflowing';
    }
    phase = state.phase ?? 'work';
    cycleIndex = state.cycleIndex ?? 0;
    totalCycles = state.totalCycles ?? 4;
    workMs = state.workMs ?? 25 * 60000;
    shortBreakMs = state.shortBreakMs ?? 5 * 60000;
    longBreakMs = state.longBreakMs ?? 15 * 60000;
    startedAt = state.startedAt ?? null;
    accumulatedMs = state.accumulatedMs ?? 0;
    phaseAdjustmentMs = state.phaseAdjustmentMs ?? 0;
    alarmFired = state.alarmFired === true;
    zeroCrossedAt = state.zeroCrossedAt ?? null;
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
      const now = Date.now();
      const carry = startedAt !== null ? now - startedAt : 0;
      accumulatedMs += carry;
      startedAt = now;
      status = 'overflowing';
      if (zeroCrossedAt === null) zeroCrossedAt = now;
      alarmFired = true;
      if (phaseStartedAt !== null) {
        phaseLog.push({ phase, startedAt: phaseStartedAt, endedAt: now, overshootMs: 0 });
        phaseStartedAt = null;
      }
    }
    // 24h overshoot cap to avoid pathological "left it for a week" states.
    if (status === 'overflowing') {
      const cap = getCurrentPhaseDurationMs() + 24 * 60 * 60 * 1000;
      const elapsed = rawElapsedMs();
      if (elapsed > cap) {
        accumulatedMs = cap;
        startedAt = null;
      }
    }
  }

  return {
    start, pause, reset, restartPhase, checkFinished, nextPhase,
    adjustRemainingMs,
    getRemainingMs, getElapsedMs, getProgress,
    getOvershootMs, isOvershooting, getZeroCrossedAt,
    getStatus, getPhase, getCycleIndex, getTotalCycles,
    getCurrentPhaseDurationMs, getConfig,
    getSessionStartedAt: () => sessionStartedAt,
    getPhaseLog: () => phaseLog,
    getPhaseStartedAt: () => phaseStartedAt,
    onPhaseComplete, configure,
    getState, loadState,
  };
})();
