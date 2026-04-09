function createStopwatch(id) {
  let status = 'idle'; // 'idle' | 'running' | 'paused'
  let offsetMs = 0;
  let startedAt = null;
  let accumulatedMs = 0;
  let laps = [];
  let lapStartMs = 0;
  let name = 'Stopwatch';
  let color = null;
  let alerts = [];

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
    alerts = [];
  }

  function lap() {
    if (status !== 'running') return;
    const currentElapsed = getElapsedMs();
    const lapMs = currentElapsed - lapStartMs;
    laps.push({ lapMs, totalMs: currentElapsed });
    lapStartMs = currentElapsed;
  }

  function deleteLap(index) {
    if (index < 0 || index >= laps.length) return;
    laps.splice(index, 1);
    // Recalculate lapStartMs from remaining laps
    if (laps.length === 0) {
      lapStartMs = offsetMs;
    } else {
      lapStartMs = laps[laps.length - 1].totalMs;
    }
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

  function addAlert(ms) {
    if (ms <= 0) return;
    if (alerts.some(a => a.ms === ms)) return;
    alerts.push({ ms, fired: false });
    alerts.sort((a, b) => a.ms - b.ms);
  }

  function removeAlert(ms) {
    alerts = alerts.filter(a => a.ms !== ms);
  }

  function getAlerts() {
    return alerts.map(a => ({ ...a }));
  }

  function checkAlerts() {
    if (status !== 'running') return [];
    const elapsed = getElapsedMs();
    const fired = [];
    alerts.forEach(a => {
      if (!a.fired && elapsed >= a.ms) {
        a.fired = true;
        fired.push(a.ms);
      }
    });
    return fired;
  }

  function getId() { return id; }
  function getName() { return name; }
  function setName(n) { name = n || 'Stopwatch'; }

  function getState() {
    return {
      id,
      name,
      status,
      offsetMs,
      startedAt,
      accumulatedMs,
      laps: laps.slice(),
      lapStartMs,
      alerts: alerts.map(a => ({ ...a })),
      color,
    };
  }

  function loadState(state) {
    if (!state) return;
    name = state.name ?? 'Stopwatch';
    color = state.color ?? null;
    status = state.status ?? 'idle';
    offsetMs = state.offsetMs ?? 0;
    startedAt = state.startedAt ?? null;
    accumulatedMs = state.accumulatedMs ?? 0;
    laps = Array.isArray(state.laps) ? state.laps.slice() : [];
    lapStartMs = state.lapStartMs ?? 0;
    alerts = Array.isArray(state.alerts) ? state.alerts.map(a => ({ ...a })) : [];

    // Guard against clock skew
    if (status === 'running' && startedAt && startedAt > Date.now()) {
      startedAt = null;
      status = 'paused';
    }
  }

  return {
    start,
    pause,
    reset,
    lap,
    deleteLap,
    setOffset,
    getElapsedMs,
    getStatus,
    getLaps,
    getCurrentLapMs,
    addAlert,
    removeAlert,
    getAlerts,
    checkAlerts,
    getId,
    getName,
    setName,
    getColor: () => color,
    setColor: (c) => { color = c; },
    getState,
    loadState,
  };
}

// Default instance — backward compatible global
let Stopwatch = createStopwatch('sw-default');
