// ── Sequence Engine (linear phase chain, no repeats) ──
const Sequence = (() => {
  let status = 'idle'; // 'idle' | 'running' | 'paused' | 'phaseComplete' | 'done'
  let program = { name: '', phases: [] }; // [{ name, durationMs }]
  let phaseIndex = 0;
  let startedAt = null;
  let accumulatedMs = 0;
  let phaseAdjustmentMs = 0;     // ±N min adjust applied to the current phase only; reset on phase boundary
  let phaseCallback = null;

  function setProgram(p) {
    if (status !== 'idle') return;
    program = {
      name: p.name || '',
      phases: (p.phases || []).map(ph => ({ name: ph.name, durationMs: ph.durationMs })),
    };
    phaseIndex = 0;
  }

  function getProgram() { return program; }

  function getBasePhaseDurationMs() {
    const ph = program.phases[phaseIndex];
    return ph ? ph.durationMs : 0;
  }

  function getCurrentPhaseDurationMs() {
    const base = getBasePhaseDurationMs();
    if (base === 0) return 0;
    return Math.max(1000, base + phaseAdjustmentMs);
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
    return dur > 0 ? Math.min(1, getElapsedMs() / dur) : 0;
  }

  function getTotalProgress() {
    if (program.phases.length === 0) return 0;
    return (phaseIndex + getProgress()) / program.phases.length;
  }

  function start() {
    if (status === 'running' || status === 'done' || status === 'phaseComplete') return;
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
    startedAt = null;
    accumulatedMs = 0;
    phaseAdjustmentMs = 0;
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
    if (status === 'running' && getRemainingMs() <= 0) {
      accumulatedMs = getCurrentPhaseDurationMs();
      startedAt = null;
      status = 'phaseComplete';
      if (phaseCallback) phaseCallback(program.phases[phaseIndex]);
      return true;
    }
    return false;
  }

  function advancePhase() {
    if (status !== 'phaseComplete') return;
    phaseIndex++;
    accumulatedMs = 0;
    phaseAdjustmentMs = 0;
    startedAt = null;
    if (phaseIndex >= program.phases.length) {
      status = 'done';
      phaseIndex = 0;
      return;
    }
    status = 'idle';
  }

  function getCurrentPhase() { return program.phases[phaseIndex] || null; }
  function getNextPhase() { return program.phases[phaseIndex + 1] || null; }
  function getPhaseIndex() { return phaseIndex; }
  function getPhaseCount() { return program.phases.length; }
  function getStatus() { return status; }
  function onPhaseComplete(cb) { phaseCallback = cb; }

  function getState() {
    return { status, program, phaseIndex, startedAt, accumulatedMs, phaseAdjustmentMs };
  }

  function loadState(state) {
    if (!state) return;
    status = state.status ?? 'idle';
    program = state.program ?? { name: '', phases: [] };
    phaseIndex = state.phaseIndex ?? 0;
    startedAt = state.startedAt ?? null;
    accumulatedMs = state.accumulatedMs ?? 0;
    phaseAdjustmentMs = state.phaseAdjustmentMs ?? 0;
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
    setProgram, getProgram, start, pause, reset, checkFinished, advancePhase,
    adjustRemainingMs,
    getRemainingMs, getElapsedMs, getProgress, getTotalProgress,
    getCurrentPhase, getNextPhase, getPhaseIndex, getPhaseCount,
    getCurrentPhaseDurationMs, getStatus, onPhaseComplete,
    getState, loadState,
  };
})();
