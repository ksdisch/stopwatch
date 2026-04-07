const Interval = (() => {
  let status = 'idle'; // 'idle' | 'running' | 'paused' | 'phaseComplete' | 'done'
  let program = { name: 'Custom', rounds: 1, restBetweenRoundsMs: 0, phases: [] };
  let phaseIndex = 0;
  let roundIndex = 0;
  let isResting = false; // true during rest-between-rounds
  let startedAt = null;
  let accumulatedMs = 0;
  let phaseCallback = null;

  function getCurrentPhaseDurationMs() {
    if (isResting) return program.restBetweenRoundsMs;
    if (phaseIndex < program.phases.length) return program.phases[phaseIndex].durationMs;
    return 0;
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
    if (status === 'running' || status === 'done') return;
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
  }

  function checkFinished() {
    if (status !== 'running' || getRemainingMs() > 0) return false;

    accumulatedMs = getCurrentPhaseDurationMs();
    startedAt = null;

    // Determine next state
    if (isResting) {
      // Rest between rounds finished — start next round
      isResting = false;
      phaseIndex = 0;
      accumulatedMs = 0;
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
        // Program complete
        status = 'done';
        if (phaseCallback) phaseCallback('done');
        return true;
      }
      // More rounds — check for rest between rounds
      roundIndex = nextRound;
      if (program.restBetweenRoundsMs > 0) {
        isResting = true;
        accumulatedMs = 0;
        status = 'phaseComplete';
        if (phaseCallback) phaseCallback('roundEnd');
        return true;
      }
      // No rest — start next round
      phaseIndex = 0;
      accumulatedMs = 0;
      status = 'phaseComplete';
      if (phaseCallback) phaseCallback('roundEnd');
      return true;
    }

    // Advance to next phase
    phaseIndex = nextPhaseIdx;
    accumulatedMs = 0;
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
      startedAt, accumulatedMs,
      program: JSON.parse(JSON.stringify(program)),
    };
  }

  function loadState(state) {
    if (!state) return;
    status = state.status ?? 'idle';
    phaseIndex = state.phaseIndex ?? 0;
    roundIndex = state.roundIndex ?? 0;
    isResting = state.isResting ?? false;
    startedAt = state.startedAt ?? null;
    accumulatedMs = state.accumulatedMs ?? 0;
    if (state.program) {
      program = JSON.parse(JSON.stringify(state.program));
    }

    if (status === 'running' && startedAt && startedAt > Date.now()) {
      startedAt = null;
      status = 'paused';
    }
    if (status === 'running' && getRemainingMs() <= 0) {
      status = 'phaseComplete';
      accumulatedMs = getCurrentPhaseDurationMs();
      startedAt = null;
    }
  }

  return {
    setProgram, start, pause, reset, checkFinished, advancePhase,
    getRemainingMs, getElapsedMs, getProgress, getTotalProgress,
    getCurrentPhase, getNextPhase,
    getStatus, getPhaseIndex, getRoundIndex, getIsResting,
    getTotalPhases, getTotalRounds, getProgram,
    onPhaseComplete, getState, loadState,
  };
})();
