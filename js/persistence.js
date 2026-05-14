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
      // Intentionally NOT subject to the F20 "preserve unknown values"
      // rule. The sync gate is local-only device metadata (it never
      // syncs to the cloud), and `canWrite()` only returns true on
      // === 'ready'. If a future version wrote an unrecognized state
      // like 'syncing' here, an older client preserving it verbatim
      // would block ALL writes on this device. Fail-open to 'ready' is
      // the safer DoS-avoidance posture; `set()` below already rejects
      // unknown values, so a well-behaved future client won't write them.
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

  // B-3: convenience for UI button-disabled + uploader re-entry guard.
  // True iff the runtime gate is mid-upload / mid-hydrate (i.e. someone
  // else owns the write window). Cheaper than re-deriving from get() at
  // call sites and keeps "is the gate locked?" as one named query.
  function isHydrating() {
    return get() === 'hydrating';
  }

  return { get, set, canWrite, isHydrating, STORAGE_KEY };
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
    // E-1d-f8: pomodoro_distractions is now a sessionId-keyed map owned
    // by the Distractions module. App-mode-change away from Pomodoro
    // drops every past Pomo session's entries (semantically broader than
    // the legacy flat-array blow-away — but those entries are already
    // persisted to history records via gatherTaskData, so no data loss).
    // typeof-guarded so a missing module degrades gracefully (no-op).
    if (typeof Distractions !== 'undefined' && typeof Distractions.clearAllForContext === 'function') {
      Distractions.clearAllForContext('pomodoro');
    }
    localStorage.removeItem('interval_state');
    localStorage.removeItem('cooking_timers');
  }

  return { save, load, clear };
})();
