// F13: cross-store write gate. Engines consult `SyncState.canWrite()` before
// any persistence write that participates in cross-device sync. Default
// state is 'ready', so today every write proceeds — F13 only lays the
// plumbing. Future stages flip the gate to 'hydrating' (Stage B initial
// upload, Stage C cross-device pull-down) to keep local writes from racing
// the sync transition; 'error' suspends writes on sync failure.
const SyncState = (() => {
  const STORAGE_KEY = 'tempo_sync_state';
  const VALID = ['hydrating', 'ready', 'error'];

  function get() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return VALID.includes(v) ? v : 'ready';
    } catch (e) {
      return 'ready';
    }
  }

  function set(state) {
    if (!VALID.includes(state)) return false;
    try { localStorage.setItem(STORAGE_KEY, state); return true; }
    catch (e) { return false; }
  }

  function canWrite() {
    return get() === 'ready';
  }

  return { get, set, canWrite, STORAGE_KEY };
})();

const Persistence = (() => {
  function save() {
    InstanceManager.saveAll();
  }

  function load() {
    InstanceManager.loadAll();
  }

  function clear() {
    localStorage.removeItem('multi_state');
    localStorage.removeItem('pomodoro_state');
    localStorage.removeItem('pomodoro_config');
    localStorage.removeItem('pomodoro_checklist');
    localStorage.removeItem('pomodoro_break_checklist');
    localStorage.removeItem('pomodoro_actual_work');
    localStorage.removeItem('pomodoro_saved_tasks');
    localStorage.removeItem('pomodoro_task_templates');
    localStorage.removeItem('pomodoro_distractions');
    localStorage.removeItem('interval_state');
    localStorage.removeItem('cooking_timers');
  }

  return { save, load, clear };
})();
