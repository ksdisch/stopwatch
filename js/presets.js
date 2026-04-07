const Presets = (() => {
  const STORAGE_KEY = 'quick_presets';
  const SEEDED_KEY = 'presets_seeded';

  function getAll() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) { return []; }
  }

  function saveAll(presets) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    } catch (e) { /* quota exceeded */ }
  }

  function get(id) {
    return getAll().find(p => p.id === id) || null;
  }

  function save(preset) {
    const presets = getAll();
    preset.id = preset.id || Date.now().toString(36);
    preset.createdAt = preset.createdAt || Date.now();
    presets.push(preset);
    saveAll(presets);
    return preset;
  }

  function update(id, changes) {
    const presets = getAll();
    const idx = presets.findIndex(p => p.id === id);
    if (idx === -1) return;
    Object.assign(presets[idx], changes);
    saveAll(presets);
  }

  function remove(id) {
    const presets = getAll().filter(p => p.id !== id);
    saveAll(presets);
  }

  function applyPreset(id) {
    const preset = get(id);
    if (!preset) return;

    const cfg = preset.config || {};

    // Switch to the correct mode
    if (typeof switchAppMode === 'function') {
      // switchAppMode has a setTimeout for animation — we need to apply config after mode is set
      // Bypass the animation for preset application
      if (typeof UI !== 'undefined') UI.stopRenderLoop();
      if (typeof stopTimerRenderLoop === 'function') stopTimerRenderLoop();
      if (typeof stopPomodoroRenderLoop === 'function') stopPomodoroRenderLoop();
      appMode = preset.mode;
      localStorage.setItem('app_mode', preset.mode);
    }

    switch (preset.mode) {
      case 'stopwatch':
        Stopwatch.reset();
        if (cfg.offsetMs) Stopwatch.setOffset(cfg.offsetMs);
        if (Array.isArray(cfg.alertsMs)) {
          cfg.alertsMs.forEach(ms => Stopwatch.addAlert(ms));
        }
        if (cfg.vibrateIntervalMs !== undefined) {
          localStorage.setItem('vibrate_interval', cfg.vibrateIntervalMs);
          const sel = document.getElementById('vibrate-interval');
          if (sel) sel.value = cfg.vibrateIntervalMs;
        }
        Persistence.save();
        break;

      case 'timer':
        Timer.reset();
        if (cfg.durationMs) {
          Timer.setDuration(cfg.durationMs);
        }
        Persistence.save();
        break;

      case 'interval':
        Interval.reset();
        if (cfg.intervalProgram) {
          Interval.setProgram(cfg.intervalProgram);
        }
        saveIntervalState();
        break;

      case 'pomodoro':
        Pomodoro.reset();
        const pomoConfig = {};
        if (cfg.workMs) pomoConfig.workMs = cfg.workMs;
        if (cfg.shortBreakMs) pomoConfig.shortBreakMs = cfg.shortBreakMs;
        if (cfg.longBreakMs) pomoConfig.longBreakMs = cfg.longBreakMs;
        if (cfg.totalCycles) pomoConfig.totalCycles = cfg.totalCycles;
        if (Object.keys(pomoConfig).length > 0) {
          Pomodoro.configure(pomoConfig);
          localStorage.setItem('pomodoro_config', JSON.stringify(pomoConfig));
        }
        if (Array.isArray(cfg.checklist) && cfg.checklist.length > 0) {
          const items = cfg.checklist.map(text => ({ text, done: false }));
          localStorage.setItem('pomodoro_checklist', JSON.stringify(items));
        }
        localStorage.setItem('pomodoro_state', JSON.stringify(Pomodoro.getState()));
        break;
    }

    // Apply the mode UI
    if (typeof applyAppMode === 'function') applyAppMode();
  }

  function captureCurrentConfig() {
    const mode = appMode;
    const config = {};

    switch (mode) {
      case 'stopwatch': {
        const state = Stopwatch.getState();
        if (state.offsetMs > 0) config.offsetMs = state.offsetMs;
        const alerts = Stopwatch.getAlerts().filter(a => !a.fired);
        if (alerts.length > 0) config.alertsMs = alerts.map(a => a.ms);
        const vibMs = parseInt(localStorage.getItem('vibrate_interval') || '0', 10);
        if (vibMs > 0) config.vibrateIntervalMs = vibMs;
        break;
      }
      case 'timer': {
        const dur = Timer.getDurationMs();
        if (dur > 0) config.durationMs = dur;
        break;
      }
      case 'interval': {
        const prog = Interval.getProgram();
        if (prog.phases.length > 0) config.intervalProgram = prog;
        break;
      }
      case 'pomodoro': {
        const cfg = Pomodoro.getConfig();
        config.workMs = cfg.workMs;
        config.shortBreakMs = cfg.shortBreakMs;
        config.longBreakMs = cfg.longBreakMs;
        config.totalCycles = cfg.totalCycles;
        try {
          const items = JSON.parse(localStorage.getItem('pomodoro_checklist') || '[]');
          if (items.length > 0) config.checklist = items.map(i => i.text);
        } catch (e) {}
        break;
      }
    }

    return { mode, config };
  }

  function formatDurationHint(preset) {
    const cfg = preset.config || {};
    switch (preset.mode) {
      case 'stopwatch':
        if (cfg.offsetMs) {
          const t = Utils.formatMs(cfg.offsetMs);
          return t.hours > 0 ? `${t.hours}:${t.minStr}:${t.secStr}` : `${t.minStr}:${t.secStr}`;
        }
        return 'Blank';
      case 'timer':
        if (cfg.durationMs) {
          const t = Utils.formatMs(cfg.durationMs);
          return t.hours > 0 ? `${t.hours}:${t.minStr}:${t.secStr}` : `${t.minStr}:${t.secStr}`;
        }
        return 'No duration';
      case 'interval': {
        const prog = cfg.intervalProgram;
        if (prog && prog.phases.length > 0) {
          return `${prog.phases.length} phases × ${prog.rounds || 1}`;
        }
        return 'No phases';
      }
      case 'pomodoro': {
        const work = (cfg.workMs || 25 * 60000) / 60000;
        const cycles = cfg.totalCycles || 4;
        return `${work}m × ${cycles}`;
      }
      default:
        return '';
    }
  }

  function getDefaults() {
    return [
      { id: 'default-sw', name: 'Stopwatch', icon: '⏱️', mode: 'stopwatch', config: {}, createdAt: 0 },
      { id: 'default-timer-5', name: '5 min Timer', icon: '⏲️', mode: 'timer', config: { durationMs: 5 * 60000 }, createdAt: 1 },
      { id: 'default-pomo', name: 'Pomodoro', icon: '🍅', mode: 'pomodoro', config: { workMs: 25 * 60000, shortBreakMs: 5 * 60000, longBreakMs: 15 * 60000, totalCycles: 4 }, createdAt: 2 },
      { id: 'default-tabata', name: 'Tabata', icon: '🏋️', mode: 'interval', config: { intervalProgram: { name: 'Tabata', rounds: 8, restBetweenRoundsMs: 0, phases: [{ name: 'Work', durationMs: 20000, color: '#30d158' }, { name: 'Rest', durationMs: 10000, color: '#ff9f0a' }] } }, createdAt: 3 },
      { id: 'default-hiit', name: 'HIIT 30/30', icon: '💪', mode: 'interval', config: { intervalProgram: { name: 'HIIT 30/30', rounds: 10, restBetweenRoundsMs: 0, phases: [{ name: 'Work', durationMs: 30000, color: '#30d158' }, { name: 'Rest', durationMs: 30000, color: '#ff9f0a' }] } }, createdAt: 4 },
    ];
  }

  function seedDefaults() {
    if (localStorage.getItem(SEEDED_KEY)) return;
    const presets = getAll();
    if (presets.length === 0) {
      saveAll(getDefaults());
    }
    localStorage.setItem(SEEDED_KEY, '1');
  }

  function migrateOffsetPresets() {
    const raw = localStorage.getItem('offset_presets');
    if (!raw) return;
    try {
      const oldPresets = JSON.parse(raw);
      if (!Array.isArray(oldPresets) || oldPresets.length === 0) return;
      const current = getAll();
      oldPresets.forEach(op => {
        // Skip if already migrated (check by name)
        if (current.some(p => p.name === op.name && p.mode === 'stopwatch')) return;
        current.push({
          id: 'migrated-' + op.id,
          name: op.name,
          icon: '⏱️',
          mode: 'stopwatch',
          config: { offsetMs: op.ms },
          createdAt: Date.now(),
        });
      });
      saveAll(current);
      localStorage.removeItem('offset_presets');
    } catch (e) {}
  }

  function init() {
    migrateOffsetPresets();
    seedDefaults();
  }

  return { getAll, get, save, update, remove, applyPreset, captureCurrentConfig, formatDurationHint, init };
})();
