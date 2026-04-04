const Persistence = (() => {
  const KEY = 'stopwatch_state';

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(Stopwatch.getState()));
    } catch (e) {
      // localStorage full or unavailable — silently ignore
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const state = JSON.parse(raw);
      Stopwatch.loadState(state);
    } catch (e) {
      // corrupted data — start fresh
      localStorage.removeItem(KEY);
    }
  }

  function clear() {
    localStorage.removeItem(KEY);
  }

  return { save, load, clear };
})();
