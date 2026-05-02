function createTimer(id, opts) {
  // 'idle' | 'running' | 'paused' | 'finished' | 'overflowing'
  // 'overflowing' is only reachable when allowOvershoot === true. Cook timers
  // omit the option, preserving the legacy halt-at-zero behavior they rely on.
  let status = 'idle';
  let durationMs = 0;
  let startedAt = null;
  let accumulatedMs = 0;
  let alarmCallback = null;
  let alarmFired = false;
  let zeroCrossedAt = null;
  let name = 'Timer';
  let color = null;
  const allowOvershoot = !!(opts && opts.allowOvershoot);

  function setDuration(ms) {
    if (status !== 'idle') return;
    durationMs = Math.max(0, ms);
  }

  function adjustRemainingMs(deltaMs) {
    if (status !== 'running' && status !== 'paused') return false;
    if (deltaMs < 0) {
      const remaining = getRemainingMs();
      if (remaining + deltaMs < 1000) return false;
    }
    durationMs = Math.max(1000, durationMs + deltaMs);
    return true;
  }

  // Raw elapsed (without clamping) — used internally for overshoot math.
  function rawElapsedMs() {
    let elapsed = accumulatedMs;
    if ((status === 'running' || status === 'overflowing') && startedAt !== null) {
      elapsed += Date.now() - startedAt;
    }
    return elapsed;
  }

  function getRemainingMs() {
    return Math.max(0, durationMs - rawElapsedMs());
  }

  function getElapsedMs() {
    return Math.min(rawElapsedMs(), durationMs);
  }

  function getOvershootMs() {
    return Math.max(0, rawElapsedMs() - durationMs);
  }

  function isOvershooting() {
    return status === 'overflowing';
  }

  function getZeroCrossedAt() {
    return zeroCrossedAt;
  }

  function getProgress() {
    if (durationMs === 0) return 0;
    return Math.min(1, getElapsedMs() / durationMs);
  }

  function start() {
    if (status === 'running' || status === 'finished' || status === 'overflowing') return;
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
    alarmFired = false;
    zeroCrossedAt = null;
  }

  function checkFinished() {
    if (status === 'running' && getRemainingMs() <= 0) {
      if (allowOvershoot) {
        // Snapshot accumulatedMs at exactly the duration so that
        // (now - startedAt) past this moment becomes the overshoot delta.
        // Critically: we keep startedAt set and status === 'overflowing'
        // so the engine continues ticking on subsequent calls.
        const now = Date.now();
        const carry = startedAt !== null ? now - startedAt : 0;
        accumulatedMs += carry;
        startedAt = now;
        status = 'overflowing';
        zeroCrossedAt = now;
      } else {
        accumulatedMs = durationMs;
        startedAt = null;
        status = 'finished';
      }
      if (!alarmFired) {
        alarmFired = true;
        if (alarmCallback) alarmCallback();
      }
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
    return {
      id, name, status, durationMs, startedAt, accumulatedMs, color,
      alarmFired, zeroCrossedAt,
    };
  }

  function loadState(state) {
    if (!state) return;
    name = state.name ?? 'Timer';
    color = state.color ?? null;
    status = state.status ?? 'idle';
    durationMs = state.durationMs ?? 0;
    startedAt = state.startedAt ?? null;
    accumulatedMs = state.accumulatedMs ?? 0;
    alarmFired = state.alarmFired === true;
    zeroCrossedAt = state.zeroCrossedAt ?? null;

    if (status === 'running' && startedAt && startedAt > Date.now()) {
      startedAt = null;
      status = 'paused';
    }
    // Check if it should have finished while page was closed
    if (status === 'running' && getRemainingMs() <= 0) {
      if (allowOvershoot) {
        // Resume into overflowing — the alarm already fired (or was missed)
        // while the tab was closed; suppress re-fire.
        const now = Date.now();
        const carry = startedAt !== null ? now - startedAt : 0;
        accumulatedMs += carry;
        startedAt = now;
        status = 'overflowing';
        if (zeroCrossedAt === null) zeroCrossedAt = now;
        alarmFired = true;
      } else {
        status = 'finished';
        accumulatedMs = durationMs;
        startedAt = null;
        alarmFired = true;
      }
    }
    // 24h overshoot guard — pathological "left it for a week" sessions
    // shouldn't pollute analytics. Cap accumulatedMs so getOvershootMs maxes
    // out at durationMs + 24h. Only applies when we're already overflowing.
    if (status === 'overflowing') {
      const cap = durationMs + 24 * 60 * 60 * 1000;
      const elapsed = rawElapsedMs();
      if (elapsed > cap) {
        // Snapshot at the cap and stop ticking forward.
        accumulatedMs = cap;
        startedAt = null;
      }
    }
  }

  return {
    setDuration, adjustRemainingMs, start, pause, reset, checkFinished,
    getRemainingMs, getElapsedMs, getProgress,
    getOvershootMs, isOvershooting, getZeroCrossedAt,
    getStatus, getDurationMs, getId, getName, setName,
    getColor: () => color,
    setColor: (c) => { color = c; },
    getState, loadState, onAlarm,
  };
}

// Default instance — backward compatible global. Timer-mode opts in to
// overshoot; cook timers (created in cooking-ui.js) get default behavior.
let Timer = createTimer('tm-default', { allowOvershoot: true });
