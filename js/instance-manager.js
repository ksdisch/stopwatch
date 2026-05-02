const InstanceManager = (() => {
  const MAX_INSTANCES = 5;
  const STORAGE_KEY = 'multi_state';

  let stopwatches = [Stopwatch];
  let timers = [Timer];
  let primaryStopwatchId = Stopwatch.getId();
  let primaryTimerId = Timer.getId();

  // ── Stopwatch Management ──

  function addStopwatch(name) {
    if (stopwatches.length >= MAX_INSTANCES) return null;
    const id = 'sw-' + Date.now().toString(36);
    const instance = createStopwatch(id);
    instance.setName(name || 'Stopwatch ' + (stopwatches.length + 1));
    stopwatches.push(instance);
    return instance;
  }

  function removeStopwatch(id) {
    if (stopwatches.length <= 1) return false;
    if (id === primaryStopwatchId) return false;
    stopwatches = stopwatches.filter(sw => sw.getId() !== id);
    return true;
  }

  function getStopwatches() {
    return stopwatches.slice();
  }

  function getPrimaryStopwatch() {
    return stopwatches.find(sw => sw.getId() === primaryStopwatchId) || stopwatches[0];
  }

  function setPrimaryStopwatch(id) {
    const instance = stopwatches.find(sw => sw.getId() === id);
    if (!instance) return;
    primaryStopwatchId = id;
    Stopwatch = instance;
  }

  // ── Timer Management ──

  function addTimer(name) {
    if (timers.length >= MAX_INSTANCES) return null;
    const id = 'tm-' + Date.now().toString(36);
    const instance = createTimer(id, { allowOvershoot: true });
    instance.setName(name || 'Timer ' + (timers.length + 1));
    timers.push(instance);
    return instance;
  }

  function removeTimer(id) {
    if (timers.length <= 1) return false;
    if (id === primaryTimerId) return false;
    timers = timers.filter(t => t.getId() !== id);
    return true;
  }

  function getTimers() {
    return timers.slice();
  }

  function getPrimaryTimer() {
    return timers.find(t => t.getId() === primaryTimerId) || timers[0];
  }

  function setPrimaryTimer(id) {
    const instance = timers.find(t => t.getId() === id);
    if (!instance) return;
    primaryTimerId = id;
    Timer = instance;
  }

  // ── Persistence ──

  function saveAll() {
    try {
      const state = {
        stopwatches: stopwatches.map(sw => sw.getState()),
        primaryStopwatchId,
        timers: timers.map(t => t.getState()),
        primaryTimerId,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // localStorage full or unavailable
    }
  }

  function loadAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const state = JSON.parse(raw);
        loadFromState(state);
        return;
      }
      // Legacy migration: load old single-instance keys
      migrateLegacy();
    } catch (e) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function loadFromState(state) {
    if (!state) return;

    // Restore stopwatches
    if (Array.isArray(state.stopwatches) && state.stopwatches.length > 0) {
      stopwatches = state.stopwatches.map(s => {
        const instance = createStopwatch(s.id || 'sw-default');
        instance.loadState(s);
        return instance;
      });
      primaryStopwatchId = state.primaryStopwatchId || stopwatches[0].getId();
      Stopwatch = getPrimaryStopwatch();
    }

    // Restore timers
    if (Array.isArray(state.timers) && state.timers.length > 0) {
      timers = state.timers.map(s => {
        const instance = createTimer(s.id || 'tm-default', { allowOvershoot: true });
        instance.loadState(s);
        return instance;
      });
      primaryTimerId = state.primaryTimerId || timers[0].getId();
      Timer = getPrimaryTimer();
    }
  }

  function migrateLegacy() {
    // Migrate old stopwatch state
    const legacySw = localStorage.getItem('stopwatch_state');
    if (legacySw) {
      try {
        Stopwatch.loadState(JSON.parse(legacySw));
      } catch (e) {}
      localStorage.removeItem('stopwatch_state');
    }

    // Migrate old timer state
    const legacyTm = localStorage.getItem('timer_state');
    if (legacyTm) {
      try {
        Timer.loadState(JSON.parse(legacyTm));
      } catch (e) {}
      localStorage.removeItem('timer_state');
    }
  }

  return {
    addStopwatch, removeStopwatch, getStopwatches,
    getPrimaryStopwatch, setPrimaryStopwatch,
    addTimer, removeTimer, getTimers,
    getPrimaryTimer, setPrimaryTimer,
    saveAll, loadAll,
    MAX_INSTANCES,
  };
})();
