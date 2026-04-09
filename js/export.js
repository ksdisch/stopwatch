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

  const EXPORT_SETTINGS_KEYS = [
    'multi_state', 'pomodoro_state', 'pomodoro_config',
    'pomodoro_checklist', 'pomodoro_break_checklist', 'pomodoro_actual_work',
    'interval_state', 'cooking_timers', 'quick_presets',
    'theme', 'sound_muted', 'sound_profile', 'vibrate_interval',
    'lap_display_mode', 'pomo_auto_advance', 'app_mode',
  ];

  async function exportAllData() {
    const sessions = await History.getSessions();
    const settings = {};
    EXPORT_SETTINGS_KEYS.forEach(key => {
      const val = localStorage.getItem(key);
      if (val !== null) settings[key] = val;
    });
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      sessions,
      settings,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stopwatch-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
          localStorage.setItem(key, data.settings[key]);
          settingsRestored++;
        }
      });
    }
    return { sessionsImported, settingsRestored };
  }

  return { copyToClipboard, downloadCSV, share, canShare, lapsToText, lapsToCSV, exportAllData, importAllData };
})();
