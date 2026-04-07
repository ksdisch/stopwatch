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
    localStorage.removeItem('interval_state');
  }

  return { save, load, clear };
})();
