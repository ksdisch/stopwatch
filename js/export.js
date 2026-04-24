const Export = (() => {

  function formatMs(ms) {
    const t = Utils.formatMs(ms);
    if (t.hours > 0) return `${t.hours}:${t.minStr}:${t.secStr}.${t.csStr}`;
    return `${t.minStr}:${t.secStr}.${t.csStr}`;
  }

  function lapsToText(laps, totalElapsed) {
    let text = 'Lap\tTime\n';
    text += '---\t----\n';
    laps.forEach((lap, i) => {
      text += `Lap ${i + 1}\t${formatMs(lap.lapMs)}\n`;
    });
    text += `---\t----\n`;
    text += `Total\t${formatMs(totalElapsed)}\n`;
    return text;
  }

  function lapsToCSV(laps, totalElapsed) {
    let csv = 'Lap,Time (ms),Time (formatted)\n';
    laps.forEach((lap, i) => {
      csv += `${i + 1},${lap.lapMs},${formatMs(lap.lapMs)}\n`;
    });
    csv += `Total,${totalElapsed},${formatMs(totalElapsed)}\n`;
    return csv;
  }

  async function copyToClipboard(laps, totalElapsed) {
    const text = lapsToText(laps, totalElapsed);
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      return false;
    }
  }

  function downloadCSV(laps, totalElapsed) {
    const csv = lapsToCSV(laps, totalElapsed);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stopwatch-laps-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function share(laps, totalElapsed) {
    const text = lapsToText(laps, totalElapsed);
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Stopwatch Laps', text });
        return true;
      } catch (e) { return false; }
    }
    return copyToClipboard(laps, totalElapsed);
  }

  function canShare() {
    return !!navigator.share;
  }

  // ── Full Data Export/Import ──

  // Every localStorage key that carries durable state. If it belongs to
  // a feature that the user would expect to survive across devices (meds,
  // sleep log, BFRB catches, focus-session state, prefs), it goes here.
  // In-flight scratch that's derivable from something else doesn't.
  //
  // Grouped by pillar/feature for future maintenance — don't rely on the
  // ordering for anything.
  const EXPORT_SETTINGS_KEYS = [
    // Instance state (stopwatch + timer factories)
    'multi_state',

    // Pomodoro
    'pomodoro_state', 'pomodoro_config',
    'pomodoro_checklist', 'pomodoro_break_checklist', 'pomodoro_actual_work',
    'pomodoro_saved_tasks', 'pomodoro_task_templates',
    'pomodoro_distractions', 'pomodoro_bfrbs',

    // Flow Block
    'flow_state', 'flow_config',
    'flow_distractions', 'flow_bfrbs',
    'flow_checklist_state', 'flow_checklist_skipped', 'flow_last_saved_session',

    // Interval / Sequence / Cooking
    'interval_state',
    'sequence_state', 'sequence_templates',
    'cooking_timers',

    // Presets
    'offset_presets', 'quick_presets', 'presets_seeded',

    // Wellness pillar — the user's primary concern for cross-device sync
    'wellness_meds',       // Medications + dose log
    'wellness_rest_log',   // Sleep + naps by day
    'bfrbs_global',        // BFRB catches logged outside any focus session

    // Preferences
    'theme', 'sound_muted', 'sound_profile', 'bfrb_volume',
    'vibrate_interval', 'lap_display_mode', 'pomo_auto_advance',
    'app_mode', 'display_mode', 'install_dismissed',
  ];

  // Extract the JSON payload so it's testable without triggering a browser
  // download. exportAllData calls this and handles the <a> click.
  async function buildBackupData() {
    const sessions = await History.getSessions();
    const settings = {};
    EXPORT_SETTINGS_KEYS.forEach(key => {
      const val = localStorage.getItem(key);
      if (val !== null) settings[key] = val;
    });
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      sessions,
      settings,
    };
  }

  async function exportAllData() {
    const data = await buildBackupData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tempo-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importAllData(jsonString) {
    const data = JSON.parse(jsonString);
    if (!data || data.version !== 1) throw new Error('Invalid backup file');
    let sessionsImported = 0;
    let settingsRestored = 0;
    if (Array.isArray(data.sessions)) {
      await History.clearAll();
      for (const s of data.sessions) {
        await History.addSession(s);
        sessionsImported++;
      }
    }
    if (data.settings && typeof data.settings === 'object') {
      EXPORT_SETTINGS_KEYS.forEach(key => {
        if (data.settings[key] !== undefined) {
          // Defensive: the backup format stores everything as strings, but
          // validate anyway so a malformed file can't poison localStorage.
          const val = data.settings[key];
          if (typeof val === 'string') {
            localStorage.setItem(key, val);
            settingsRestored++;
          }
        }
      });
    }
    return { sessionsImported, settingsRestored };
  }

  // Test surface. Small getter so the test suite can assert coverage
  // (e.g. "wellness_meds is in the key list") without reaching into
  // the closure.
  function getSettingsKeys() {
    return EXPORT_SETTINGS_KEYS.slice();
  }

  return {
    copyToClipboard, downloadCSV, share, canShare, lapsToText, lapsToCSV,
    exportAllData, importAllData, buildBackupData, getSettingsKeys,
  };
})();
