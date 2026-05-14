const Presets = (() => {
  const STORAGE_KEY = 'quick_presets';
  const SEEDED_KEY = 'presets_seeded';

  function getAll() {
    // E-1e: filter tombstones at the engine boundary so every UI caller
    // (drawer, applyPreset, formatDurationHint) automatically excludes
    // soft-deleted presets. Use `== null` to catch both `undefined` and
    // `null` but NOT `0` / `''` (Risk #8). The `p && ` guard is defensive
    // against malformed entries from a corrupt parse.
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
      return raw.filter(p => p && p.deletedAt == null);
    } catch (e) { return []; }
  }

  // E-1e: tombstone-inclusive read for the sync snapshot adapter +
  // `remove()` (so a previously-tombstoned record can be re-tombstoned
  // as a no-op and we never accidentally "resurrect" by missing the
  // record entirely). UI callers MUST NOT use this — they want the
  // tombstone-filtered `getAll()`.
  function _getAllIncludingTombstones() {
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
    // F13: cross-store write gate. The `typeof` guard keeps the engine
    // usable in test contexts that don't load persistence.js.
    if (typeof SyncState !== 'undefined' && !SyncState.canWrite()) return;
    const presets = getAll();
    preset.id = preset.id || Date.now().toString(36);
    preset.createdAt = preset.createdAt || Date.now();
    // F19a: stamp schemaVersion at write. Schema.stamp is a no-op if the
    // caller passed a future-schemaVersion record (e.g. JSON import from a
    // newer client), preserving the original version so the record
    // roundtrips cleanly.
    Schema.stamp(preset);
    presets.push(preset);
    saveAll(presets);
    return preset;
  }

  function update(id, changes) {
    // F13: cross-store write gate.
    if (typeof SyncState !== 'undefined' && !SyncState.canWrite()) return;
    const presets = getAll();
    const idx = presets.findIndex(p => p.id === id);
    if (idx === -1) return;
    // F19a: refuse to overwrite future-schema records. A downlevel client
    // would strip fields it doesn't recognize on writeback. Silent no-op
    // (existing return shape is also `undefined`). The full array is NOT
    // re-saved here, so the on-disk future record stays untouched.
    if (Schema.isFutureRecord(presets[idx])) return;
    Object.assign(presets[idx], changes);
    Schema.stamp(presets[idx]);
    saveAll(presets);
  }

  function remove(id) {
    // F13: cross-store write gate.
    if (typeof SyncState !== 'undefined' && !SyncState.canWrite()) return;
    // E-1e: tombstone-set instead of hard-filter. Use the tombstone-
    // inclusive view so we can re-tombstone a previously-tombstoned
    // record (no-op writeback) and so we never accidentally
    // "resurrect" by missing the record entirely.
    const presets = _getAllIncludingTombstones();
    const target = presets.find(p => p.id === id);
    if (!target) return;
    // F19a: future-schema records are read-only — refuse to tombstone.
    // The downlevel client may not understand semantics the newer
    // client attached to the preset; even a soft delete could lose
    // data we can't represent.
    if (Schema.isFutureRecord(target)) return;
    target.deletedAt = Date.now();
    Schema.stamp(target);
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

      case 'cooking':
        // Cooking mode just switches — no preset config to apply
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

    // Set instance name if provided
    if (cfg.instanceName) {
      if (preset.mode === 'stopwatch') Stopwatch.setName(cfg.instanceName);
      else if (preset.mode === 'timer') Timer.setName(cfg.instanceName);
      Persistence.save();
    }

    // Apply the mode UI
    if (typeof applyAppMode === 'function') applyAppMode();

    // Auto-start if configured
    if (cfg.autoStart) {
      setTimeout(() => {
        if (preset.mode === 'stopwatch' && Stopwatch.getStatus() === 'idle') {
          Stopwatch.start(); Persistence.save(); SFX.playStart(); if (typeof UI !== 'undefined') UI.syncUI();
        } else if (preset.mode === 'timer' && Timer.getStatus() === 'idle' && Timer.getDurationMs() > 0) {
          Timer.start(); if (typeof updateTimerUI === 'function') updateTimerUI(); SFX.playStart();
        } else if (preset.mode === 'pomodoro' && Pomodoro.getStatus() === 'idle') {
          Pomodoro.start(); SFX.playStart(); if (typeof startPomodoroRenderLoop === 'function') startPomodoroRenderLoop(); if (typeof updatePomodoroUI === 'function') updatePomodoroUI();
        }
      }, 100);
    }
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

    // Capture instance name
    if (mode === 'stopwatch' && Stopwatch.getName() !== 'Stopwatch') {
      config.instanceName = Stopwatch.getName();
    } else if (mode === 'timer' && Timer.getName() !== 'Timer') {
      config.instanceName = Timer.getName();
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
    // F19a: stamp schemaVersion on each seeded default so first-launch
    // storage doesn't carry unstamped records.
    return [
      { id: 'default-sw', name: 'Stopwatch', icon: '⏱️', mode: 'stopwatch', config: {}, createdAt: 0 },
      { id: 'default-timer-5', name: '5 min Timer', icon: '⏲️', mode: 'timer', config: { durationMs: 5 * 60000 }, createdAt: 1 },
      { id: 'default-pomo', name: 'Pomodoro', icon: '🍅', mode: 'pomodoro', config: { workMs: 25 * 60000, shortBreakMs: 5 * 60000, longBreakMs: 15 * 60000, totalCycles: 4 }, createdAt: 2 },
      { id: 'default-tabata', name: 'Tabata', icon: '🏋️', mode: 'interval', config: { intervalProgram: { name: 'Tabata', rounds: 8, restBetweenRoundsMs: 0, phases: [{ name: 'Work', durationMs: 20000, color: '#30d158' }, { name: 'Rest', durationMs: 10000, color: '#ff9f0a' }] } }, createdAt: 3 },
      { id: 'default-hiit', name: 'HIIT 30/30', icon: '💪', mode: 'interval', config: { intervalProgram: { name: 'HIIT 30/30', rounds: 10, restBetweenRoundsMs: 0, phases: [{ name: 'Work', durationMs: 30000, color: '#30d158' }, { name: 'Rest', durationMs: 30000, color: '#ff9f0a' }] } }, createdAt: 4 },
      { id: 'default-crate', name: 'Milhouse Crate', icon: '🐕', mode: 'timer', config: { durationMs: 15 * 60000 }, createdAt: 5 },
      { id: 'default-walk', name: 'Louis Walk', icon: '🦮', mode: 'stopwatch', config: { vibrateIntervalMs: 1800000, alertsMs: [1800000] }, createdAt: 6 },
      { id: 'default-potty', name: 'Puppy Potty', icon: '🐶', mode: 'timer', config: { durationMs: 45 * 60000 }, createdAt: 7 },
      { id: 'default-training', name: 'Training Session', icon: '🎾', mode: 'timer', config: { durationMs: 10 * 60000 }, createdAt: 8 },
    ].map(Schema.stamp);
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
        // F19a: stamp schemaVersion on the migrated record so it lands at
        // the current schema (pre-F19a offset_presets have no version).
        current.push(Schema.stamp({
          id: 'migrated-' + op.id,
          name: op.name,
          icon: '⏱️',
          mode: 'stopwatch',
          config: { offsetMs: op.ms },
          createdAt: Date.now(),
        }));
      });
      saveAll(current);
      localStorage.removeItem('offset_presets');
    } catch (e) {}
  }

  function init() {
    migrateOffsetPresets();
    seedDefaults();
  }

  // B-1: read-only snapshot adapter for SyncEngine.getSnapshot().
  // Returns the per-store envelope { deviceId, schemaVersion, payload }
  // where `payload.presets` is the array of preset records. Defensive-
  // copy contract holds because `getAll()` re-parses localStorage on
  // every call, producing a fresh object graph each time. No Schema.stamp()
  // — inner records are already stamped at write time (F19a) via save()
  // and update().
  function snapshotForSync() {
    return {
      deviceId: History.getDeviceId(),
      schemaVersion: Schema.SCHEMA_VERSION,
      payload: {
        // E-1e: sync must propagate tombstones to cloud so deletes
        // replicate cross-device. UI never sees tombstones via
        // `getAll()`'s filter; only the sync snapshot adapter peeks
        // into the tombstone-inclusive view.
        presets: _getAllIncludingTombstones(),
      },
    };
  }

  // C-1: privileged hydrate write path. Writes the cloud records as the
  // full presets array to localStorage, bypassing the `SyncState.canWrite()`
  // gate that save/update/remove consult. The orchestrator has flipped the
  // gate to 'hydrating' so user UI is paused; this path is the explicit
  // exception. F19a: records are written verbatim — no `Schema.stamp()`
  // call, so any future-schema record (schemaVersion=2) keeps its original
  // version on disk and the standard mutators (save/update/remove) then
  // refuse writeback on them.
  //
  // Also sets `presets_seeded = '1'` so the next `init()` doesn't seed
  // default presets over the cloud-supplied set.
  function _hydrateWriteRaw(records) {
    if (!Array.isArray(records)) records = [];
    let written = 0;
    let skipped = 0;
    const valid = [];
    for (const rec of records) {
      if (!rec || typeof rec !== 'object' || typeof rec.id !== 'string' || !rec.id) {
        skipped++;
        continue;
      }
      valid.push(rec);
      written++;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
      // Mark seeded so `seedDefaults()` is a no-op on the next init —
      // cloud-supplied presets are the canonical set.
      localStorage.setItem(SEEDED_KEY, '1');
    } catch (e) {
      // Quota / storage unavailable. Mark all as skipped — orchestrator
      // surfaces the count via its return shape.
      skipped += written;
      written = 0;
    }
    if (skipped > 0) {
      try { console.warn('[Presets] hydrate skipped ' + skipped + ' malformed/un-writable record(s)'); }
      catch (e) {}
    }
    return { written, skipped };
  }

  function hydrateFromCloud(records) {
    if (!Array.isArray(records)) {
      return Promise.reject(new Error('hydrateFromCloud: records must be an array'));
    }
    const { written, skipped } = _hydrateWriteRaw(records);
    return Promise.resolve({ ok: true, count: written, skipped });
  }

  // E-1e: privileged reconcile write path used by `js/sync-merge-presets.js`
  // after per-record CAS writeback. Bypasses the `SyncState.canWrite()` gate
  // that save/update/remove consult — the merge function is the explicit
  // exception, same contract as `_hydrateWriteRaw`. Drops malformed records
  // (missing id) but preserves tombstones (records with `deletedAt` set)
  // so deletes replicate cross-device.
  function _reconcileWriteRaw(records) {
    if (!Array.isArray(records)) records = [];
    let written = 0;
    let skipped = 0;
    const valid = [];
    for (const rec of records) {
      if (!rec || typeof rec !== 'object' || typeof rec.id !== 'string' || !rec.id) {
        skipped++;
        continue;
      }
      valid.push(rec);
      written++;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
    } catch (e) {
      skipped += written;
      written = 0;
    }
    return { written, skipped };
  }

  return {
    getAll, get, save, update, remove, applyPreset, captureCurrentConfig,
    formatDurationHint, init, snapshotForSync,
    hydrateFromCloud, _hydrateWriteRaw,
    _reconcileWriteRaw, _getAllIncludingTombstones,
  };
})();
