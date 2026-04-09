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
    localStorage.removeItem('interval_state');
    localStorage.removeItem('cooking_timers');
  }

  return { save, load, clear };
})();
