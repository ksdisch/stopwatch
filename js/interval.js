const Interval = (() => {
  // 'idle' | 'running' | 'paused' | 'phaseComplete' | 'overflowing'
  // 'phaseComplete' is preserved for inter-phase boundaries (auto-advance);
  // 'overflowing' replaces the legacy 'done' status — the program is past
  // its final phase, alarm has fired, and the engine continues counting up
  // until the user resets.
  let status = 'idle';
  let program = { name: 'Custom', rounds: 1, restBetweenRoundsMs: 0, phases: [] };
  let phaseIndex = 0;
  let roundIndex = 0;
  let isResting = false; // true during rest-between-rounds
  let startedAt = null;
  let accumulatedMs = 0;
  let phaseAdjustmentMs = 0;     // ±N min adjust applied to the current phase only; reset on phase boundary
  let phaseCallback = null;
  let alarmFired = false;
  let zeroCrossedAt = null;

  function getBasePhaseDurationMs() {
    if (isResting) return program.restBetweenRoundsMs;
    if (phaseIndex < program.phases.length) return program.phases[phaseIndex].durationMs;
    return 0;
  }

  function getCurrentPhaseDurationMs() {
    const base = getBasePhaseDurationMs();
    if (base === 0) return 0;
    return Math.max(1000, base + phaseAdjustmentMs);
  }

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
    if (status !== 'overflowing') return 0;
    return Math.max(0, rawElapsedMs() - getCurrentPhaseDurationMs());
  }

  function isOvershooting() {
    return status === 'overflowing';
  }

  function getZeroCrossedAt() {
    return zeroCrossedAt;
  }

  function isDone() {
    // Backwards-compat: a program past its final phase is 'done'-equivalent
    // regardless of whether the engine is in the new 'overflowing' state.
    return status === 'overflowing';
  }

  function getProgress() {
    const dur = getCurrentPhaseDurationMs();
    if (dur === 0) return 0;
    return Math.min(1, getElapsedMs() / dur);
  }

  function getTotalProgress() {
    // Overall progress through the entire program
    const totalPhases = program.phases.length * program.rounds;
    if (totalPhases === 0) return 0;
    const completedPhases = roundIndex * program.phases.length + phaseIndex;
    return completedPhases / totalPhases;
  }

  function setProgram(p) {
    if (status !== 'idle') return;
    program = {
      name: p.name || 'Custom',
      rounds: Math.max(1, p.rounds || 1),
      restBetweenRoundsMs: Math.max(0, p.restBetweenRoundsMs || 0),
      phases: (p.phases || []).map(ph => ({
        name: ph.name || 'Phase',
        durationMs: Math.max(1000, ph.durationMs || 10000),
        color: ph.color || null,
      })),
    };
  }

  function start() {
    if (status === 'running' || status === 'overflowing') return;
    if (status === 'phaseComplete') return;
    if (program.phases.length === 0) return;
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
    phaseIndex = 0;
    roundIndex = 0;
    isResting = false;
    startedAt = null;
    accumulatedMs = 0;
    phaseAdjustmentMs = 0;
    alarmFired = false;
    zeroCrossedAt = null;
  }

  function adjustRemainingMs(deltaMs) {
    if (status !== 'running' && status !== 'paused') return false;
    if (getBasePhaseDurationMs() === 0) return false;
    if (deltaMs < 0) {
      const remaining = getRemainingMs();
      if (remaining + deltaMs < 1000) return false;
    }
    phaseAdjustmentMs += deltaMs;
    const minAdjustment = 1000 - getBasePhaseDurationMs();
    if (phaseAdjustmentMs < minAdjustment) phaseAdjustmentMs = minAdjustment;
    return true;
  }

  function checkFinished() {
    if (status !== 'running' || getRemainingMs() > 0) return false;

    // Default: snap to phase end (legacy behavior preserved for non-terminal
    // boundaries). The terminal branch overrides this below.
    accumulatedMs = getCurrentPhaseDurationMs();
    startedAt = null;

    // Determine next state
    if (isResting) {
      // Rest between rounds finished — start next round
      isResting = false;
      phaseIndex = 0;
      accumulatedMs = 0;
      phaseAdjustmentMs = 0;
      status = 'phaseComplete';
      if (phaseCallback) phaseCallback('rest');
      return true;
    }

    // Current phase finished
    const nextPhaseIdx = phaseIndex + 1;

    if (nextPhaseIdx >= program.phases.length) {
      // End of round
      const nextRound = roundIndex + 1;
      if (nextRound >= program.rounds) {
        // Program complete — overflow past zero, keep ticking forward
        // until the user resets. Push back into 'overflowing' state with
        // startedAt re-anchored to now.
        const now = Date.now();
        startedAt = now;
        status = 'overflowing';
        zeroCrossedAt = now;
        phaseAdjustmentMs = 0;
        if (!alarmFired) {
          alarmFired = true;
          if (phaseCallback) phaseCallback('done');
        }
        return true;
      }
      // More rounds — check for rest between rounds
      roundIndex = nextRound;
      if (program.restBetweenRoundsMs > 0) {
        isResting = true;
        accumulatedMs = 0;
        phaseAdjustmentMs = 0;
        status = 'phaseComplete';
        if (phaseCallback) phaseCallback('roundEnd');
        return true;
      }
      // No rest — start next round
      phaseIndex = 0;
      accumulatedMs = 0;
      phaseAdjustmentMs = 0;
      status = 'phaseComplete';
      if (phaseCallback) phaseCallback('roundEnd');
      return true;
    }

    // Advance to next phase
    phaseIndex = nextPhaseIdx;
    accumulatedMs = 0;
    phaseAdjustmentMs = 0;
    status = 'phaseComplete';
    if (phaseCallback) phaseCallback('phase');
    return true;
  }

  function advancePhase() {
    if (status !== 'phaseComplete') return;
    status = 'idle';
  }

  function getCurrentPhase() {
    if (isResting) return { name: 'Rest', durationMs: program.restBetweenRoundsMs, color: '#8e8e93' };
    if (phaseIndex < program.phases.length) return program.phases[phaseIndex];
    return null;
  }

  function getNextPhase() {
    if (isResting) {
      // After rest, next is first phase of next round
      return program.phases.length > 0 ? program.phases[0] : null;
    }
    const next = phaseIndex + 1;
    if (next < program.phases.length) return program.phases[next];
    // End of round
    const nextRound = roundIndex + 1;
    if (nextRound >= program.rounds) return null; // program will be done
    if (program.restBetweenRoundsMs > 0) return { name: 'Rest', durationMs: program.restBetweenRoundsMs, color: '#8e8e93' };
    return program.phases.length > 0 ? program.phases[0] : null;
  }

  function onPhaseComplete(cb) { phaseCallback = cb; }

  function getStatus() { return status; }
  function getPhaseIndex() { return phaseIndex; }
  function getRoundIndex() { return roundIndex; }
  function getIsResting() { return isResting; }
  function getTotalPhases() { return program.phases.length; }
  function getTotalRounds() { return program.rounds; }
  function getProgram() {
    return JSON.parse(JSON.stringify(program));
  }

  function getState() {
    return {
      status, phaseIndex, roundIndex, isResting,
      startedAt, accumulatedMs, phaseAdjustmentMs,
      alarmFired, zeroCrossedAt,
      program: JSON.parse(JSON.stringify(program)),
    };
  }

  function loadState(state) {
    if (!state) return;
    status = state.status ?? 'idle';
    // Migrate legacy terminal 'done' state to 'overflowing' so old saved
    // states don't lose the workout-finished context. Old states have no
    // overshoot tracked; alarmFired defaults true so we don't re-fire.
    if (status === 'done') status = 'overflowing';
    phaseIndex = state.phaseIndex ?? 0;
    roundIndex = state.roundIndex ?? 0;
    isResting = state.isResting ?? false;
    startedAt = state.startedAt ?? null;
    accumulatedMs = state.accumulatedMs ?? 0;
    phaseAdjustmentMs = state.phaseAdjustmentMs ?? 0;
    alarmFired = state.alarmFired === true || status === 'overflowing';
    zeroCrossedAt = state.zeroCrossedAt ?? null;
    if (state.program) {
      program = JSON.parse(JSON.stringify(state.program));
    }

    if (status === 'running' && startedAt && startedAt > Date.now()) {
      startedAt = null;
      status = 'paused';
    }
    if (status === 'running' && getRemainingMs() <= 0) {
      // If this was the terminal phase, transition into overflowing.
      // Otherwise (mid-program), snap into phaseComplete so the UI's
      // auto-advance handler can take over.
      const isTerminal = !isResting
        && phaseIndex + 1 >= program.phases.length
        && roundIndex + 1 >= program.rounds;
      if (isTerminal) {
        const now = Date.now();
        const carry = startedAt !== null ? now - startedAt : 0;
        accumulatedMs += carry;
        startedAt = now;
        status = 'overflowing';
        if (zeroCrossedAt === null) zeroCrossedAt = now;
        alarmFired = true;
      } else {
        status = 'phaseComplete';
        accumulatedMs = getCurrentPhaseDurationMs();
        startedAt = null;
      }
    }
    // 24h overshoot cap.
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
    setProgram, start, pause, reset, checkFinished, advancePhase,
    adjustRemainingMs,
    getRemainingMs, getElapsedMs, getProgress, getTotalProgress,
    getOvershootMs, isOvershooting, isDone, getZeroCrossedAt,
    getCurrentPhase, getNextPhase,
    getStatus, getPhaseIndex, getRoundIndex, getIsResting,
    getTotalPhases, getTotalRounds, getProgram,
    onPhaseComplete, getState, loadState,
  };
})();
