function createTimer(id) {
  let status = 'idle'; // 'idle' | 'running' | 'paused' | 'finished'
  let durationMs = 0;
  let startedAt = null;
  let accumulatedMs = 0;
  let alarmCallback = null;
  let name = 'Timer';

  function setDuration(ms) {
    if (status !== 'idle') return;
    durationMs = Math.max(0, ms);
  }

  function getRemainingMs() {
    let elapsed = accumulatedMs;
    if (status === 'running' && startedAt !== null) {
      elapsed += Date.now() - startedAt;
    }
    return Math.max(0, durationMs - elapsed);
  }

  function getElapsedMs() {
    let elapsed = accumulatedMs;
    if (status === 'running' && startedAt !== null) {
      elapsed += Date.now() - startedAt;
    }
    return Math.min(elapsed, durationMs);
  }

  function getProgress() {
    if (durationMs === 0) return 0;
    return Math.min(1, getElapsedMs() / durationMs);
  }

  function start() {
    if (status === 'running' || status === 'finished') return;
    if (durationMs === 0) return;
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
    durationMs = 0;
    startedAt = null;
    accumulatedMs = 0;
  }

  function checkFinished() {
    if (status === 'running' && getRemainingMs() <= 0) {
      accumulatedMs = durationMs;
      startedAt = null;
      status = 'finished';
      if (alarmCallback) alarmCallback();
      return true;
    }
    return false;
  }

  function onAlarm(cb) {
    alarmCallback = cb;
  }

  function getStatus() { return status; }
  function getDurationMs() { return durationMs; }
  function getId() { return id; }
  function getName() { return name; }
  function setName(n) { name = n || 'Timer'; }

  function getState() {
    return { id, name, status, durationMs, startedAt, accumulatedMs };
  }

  function loadState(state) {
    if (!state) return;
    name = state.name ?? 'Timer';
    status = state.status ?? 'idle';
    durationMs = state.durationMs ?? 0;
    startedAt = state.startedAt ?? null;
    accumulatedMs = state.accumulatedMs ?? 0;

    if (status === 'running' && startedAt && startedAt > Date.now()) {
      startedAt = null;
      status = 'paused';
    }
    // Check if it should have finished while page was closed
    if (status === 'running' && getRemainingMs() <= 0) {
      status = 'finished';
      accumulatedMs = durationMs;
      startedAt = null;
    }
  }

  return {
    setDuration, start, pause, reset, checkFinished,
    getRemainingMs, getElapsedMs, getProgress,
    getStatus, getDurationMs, getId, getName, setName,
    getState, loadState, onAlarm,
  };
}

// Default instance — backward compatible global
let Timer = createTimer('tm-default');
