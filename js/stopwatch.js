const Stopwatch = (() => {
  let status = 'idle'; // 'idle' | 'running' | 'paused'
  let offsetMs = 0;
  let startedAt = null;
  let accumulatedMs = 0;
  let laps = [];
  let lapStartMs = 0;

  function getElapsedMs() {
    let elapsed = offsetMs + accumulatedMs;
    if (status === 'running' && startedAt !== null) {
      elapsed += Date.now() - startedAt;
    }
    return Math.max(0, elapsed);
  }

  function start() {
    if (status === 'running') return;
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
    offsetMs = 0;
    startedAt = null;
    accumulatedMs = 0;
    laps = [];
    lapStartMs = 0;
  }

  function lap() {
    if (status !== 'running') return;
    const currentElapsed = getElapsedMs();
    const lapMs = currentElapsed - lapStartMs;
    laps.push({ lapMs, totalMs: currentElapsed });
    lapStartMs = currentElapsed;
  }

  function setOffset(ms) {
    if (status !== 'idle') return;
    offsetMs = Math.max(0, ms);
  }

  function getStatus() {
    return status;
  }

  function getLaps() {
    return laps.slice();
  }

  function getCurrentLapMs() {
    if (status === 'idle' && laps.length === 0) return 0;
    return getElapsedMs() - lapStartMs;
  }

  function getState() {
    return {
      status,
      offsetMs,
      startedAt,
      accumulatedMs,
      laps: laps.slice(),
      lapStartMs,
    };
  }

  function loadState(state) {
    if (!state) return;
    status = state.status || 'idle';
    offsetMs = state.offsetMs || 0;
    startedAt = state.startedAt || null;
    accumulatedMs = state.accumulatedMs || 0;
    laps = Array.isArray(state.laps) ? state.laps.slice() : [];
    lapStartMs = state.lapStartMs || 0;

    // Guard against clock skew
    if (status === 'running' && startedAt && startedAt > Date.now()) {
      accumulatedMs += 0; // keep what we had
      startedAt = null;
      status = 'paused';
    }
  }

  return {
    start,
    pause,
    reset,
    lap,
    setOffset,
    getElapsedMs,
    getStatus,
    getLaps,
    getCurrentLapMs,
    getState,
    loadState,
  };
})();
