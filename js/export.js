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
    // Note: E-1d-f8 reshaped `pomodoro_distractions` from a flat array
    // into a sessionId-keyed map (see flow_distractions note below).
    'pomodoro_distractions', 'pomodoro_bfrbs',

    // Flow Block
    // Note: E-1d-f8 reshaped `flow_distractions` from a flat array into a
    // sessionId-keyed map `{ [sessionId]: [entries] }`. JSON.stringify
    // handles maps transparently, so the export/import round-trip is
    // unchanged. Pre-migration backups containing the legacy flat array
    // are re-migrated on import by the load-time migration in Distractions.
    'flow_state', 'flow_config',
    'flow_distractions', 'flow_bfrbs',
    'flow_checklist_state', 'flow_checklist_skipped', 'flow_last_saved_session',
    // todoist-flow-tasks (DECISION 8): Flow Block user-task list. Non-synced
    // (not in SYNCED_STORES — Todoist is the cross-device source of truth) but
    // backed up here for device portability, with Todoist linkage stripped at
    // export time exactly like pomodoro_saved_tasks (see buildBackupData).
    'flow_user_tasks',

    // Interval / Sequence / Cooking
    'interval_state',
    'sequence_state', 'sequence_templates',
    'cooking_timers',

    // Presets
    'offset_presets', 'quick_presets', 'presets_seeded',

    // Wellness pillar — the user's primary concern for cross-device sync
    // Legacy pre-F18 single-blob meds key. meds.js's F18 migration deletes it
    // (meds moved to per-record meds/{id} keys), so on migrated devices it is
    // null and new exports capture meds via the meds/* sweep below
    // (collectMedRecords → payload.meds). Retained here so RESTORING a
    // pre-migration backup still works: the blob is written back, then
    // loadAll's _migrateLegacyBlob folds it into per-record keys on reload.
    'wellness_meds',       // Medications + dose log (legacy blob — see above)
    'wellness_rest_log',   // Sleep + naps by day
    // F3 consolidated BFRB stream — the SINGLE SOURCE OF TRUTH since the
    // bfrb-events migration (js/bfrb-events.js). EVERY catch logged after that
    // migration lands ONLY here; the legacy keys below stop receiving new
    // entries. Omitting it meant post-migration catches were silently dropped
    // from both the JSON export AND the F12 mandatory pre-push backup
    // (backup.js reuses buildBackupData) — health-relevant data loss.
    'bfrb_events',
    // …and its migration marker. bfrb-events.js's migration dedups by
    // (deviceId, takenAt); on a CROSS-DEVICE restore the legacy keys would be
    // re-migrated under the NEW device's id and double-count the already-
    // consolidated entries. Restoring the marker makes the migration a clean
    // no-op so bfrb_events round-trips verbatim. (Pre-migration backups have no
    // marker → migration still runs on reload and consolidates the legacy keys.)
    'tempo_bfrb_events_migration_v1',
    'bfrbs_global',        // BFRB catches logged outside any focus session (legacy/pre-migration)
    // BFRB Closed Loop Slice B: the user-authored if-then competing-response
    // plan (own words). User CONTENT, so backed up here for device portability
    // (like flow_user_tasks) — but NOT synced (not in SYNCED_STORES). The
    // bfrb_support_enabled toggle is a device-local PREFERENCE → intentionally
    // NOT exported (matches tempo_coach_nudge_enabled / flow_readiness_suggest).
    'bfrb_if_then_plan',
    // Life-OS Phase 3 mood capture stream — the 7th synced store (ADR-0008).
    // Append-only; export captures the full stream for cross-device restore
    // portability. No migration marker needed (mood_events starts fresh —
    // unlike bfrb_events there are no legacy keys to consolidate).
    'mood_events',

    // Preferences
    'theme', 'sound_muted', 'sound_profile', 'bfrb_volume',
    'vibrate_interval', 'lap_display_mode', 'pomo_auto_advance',
    'app_mode', 'display_mode', 'install_dismissed',
  ];

  // bl-2-todoist: strip Todoist linkage (todoistId, localTag) from saved
  // tasks at export time. Backups are portable across Tempo installs;
  // Todoist ids belong to ONE Todoist account and 404 if restored to a
  // device signed into a different account. Stripping makes the backup
  // account-neutral; users who want Todoist sync re-paste their token on
  // the restored device and re-import via the picker (which dedupes by
  // text per js/pomodoro-ui.js).
  function _stripTodoistLinkage(rawJson) {
    try {
      const items = JSON.parse(rawJson);
      if (!Array.isArray(items)) return rawJson;
      const stripped = items.map(item => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return item;
        const out = { text: item.text };
        // Preserve any future non-Todoist fields (e.g. done) but DROP
        // todoistId + localTag specifically.
        for (const k of Object.keys(item)) {
          if (k !== 'todoistId' && k !== 'localTag' && k !== 'text') {
            out[k] = item[k];
          }
        }
        return out;
      });
      return JSON.stringify(stripped);
    } catch (_) {
      return rawJson;
    }
  }

  // F18 meds migration moved each med out of the single `wellness_meds` blob
  // into its own `meds/{medId}` localStorage key. Those per-record keys are
  // NOT in EXPORT_SETTINGS_KEYS (a fixed list), so without this sweep a
  // post-migration backup would silently omit EVERY medication — a data-loss
  // bug for users not on cloud sync, and it also weakens the F12 mandatory
  // pre-push backup (js/backup.js reuses buildBackupData). Reads localStorage
  // directly (not MedsManager) so the backup captures persisted state with no
  // load-order dependency; mirrors MedsManager.loadAll's `meds/` enumeration.
  const MEDS_PREFIX = 'meds/';
  function collectMedRecords() {
    const records = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(MEDS_PREFIX)) continue;
        const raw = localStorage.getItem(k);
        if (raw === null) continue;
        try {
          const rec = JSON.parse(raw);
          if (rec && typeof rec === 'object' && typeof rec.id === 'string') {
            records.push(rec);
          }
        } catch (_) { /* corrupt record — skip, don't abort the backup */ }
      }
    } catch (_) { /* localStorage unavailable */ }
    return records;
  }

  // Extract the JSON payload so it's testable without triggering a browser
  // download. exportAllData calls this and handles the <a> click.
  async function buildBackupData() {
    const sessions = await History.getSessions();
    const settings = {};
    EXPORT_SETTINGS_KEYS.forEach(key => {
      const val = localStorage.getItem(key);
      if (val === null) return;
      if (key === 'pomodoro_saved_tasks' || key === 'flow_user_tasks') {
        settings[key] = _stripTodoistLinkage(val);
      } else {
        settings[key] = val;
      }
    });
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      sessions,
      settings,
      // Per-record meds (post-F18). Array of wire-format records, each with a
      // string `id`. importAllData writes them back to meds/{id}.
      meds: collectMedRecords(),
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
      // H1/M8: import is the one place untrusted JSON (a hand-edited or
      // foreign backup) becomes persisted state. Validate element shape
      // BEFORE the destructive clearAll(), and import each session under its
      // own try/catch so a single malformed element — or a transient IDB
      // error — can't abort the loop and leave history wiped + half-restored.
      // addSession still normalizes each record (legacy-id rewrite, schema
      // stamp, field defaults); History._reconcileWriteRaw can't replace this
      // loop because it writes verbatim and would reject pre-F2 numeric ids.
      const validSessions = data.sessions.filter(
        s => s && typeof s === 'object' && !Array.isArray(s)
      );
      await History.clearAll();
      for (const s of validSessions) {
        try {
          await History.addSession(s);
          sessionsImported++;
        } catch (e) {
          try { console.warn('[import] skipped malformed session', e); } catch (_) {}
        }
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
    // Per-record meds (post-F18). Clear existing meds/{id} keys first so a
    // stale local med not present in the backup doesn't survive the restore
    // (mirrors how a settings overwrite replaces prior values), then write
    // each backed-up record. MedsManager.loadAll() picks these up on the
    // post-import reload (history-ui.js reloads after importAllData). Absent
    // on pre-F18 backups (data.meds undefined → skipped), in which case the
    // restored legacy wellness_meds blob migrates on reload instead.
    let medsRestored = 0;
    if (Array.isArray(data.meds)) {
      const stale = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(MEDS_PREFIX)) stale.push(k);
      }
      stale.forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
      data.meds.forEach(rec => {
        if (rec && typeof rec === 'object' && typeof rec.id === 'string') {
          try {
            localStorage.setItem(MEDS_PREFIX + rec.id, JSON.stringify(rec));
            medsRestored++;
          } catch (_) { /* quota or unavailable — skip this record */ }
        }
      });
    }
    return { sessionsImported, settingsRestored, medsRestored };
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
