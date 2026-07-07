// Export / Import (backup + restore) tests.
//
// The primary concern: the localStorage key list must stay in sync with
// every feature that owns durable state. When a new feature lands, its
// storage key needs to be added to EXPORT_SETTINGS_KEYS or its data won't
// survive a backup/restore round-trip. These tests catch that silently.

// Keys that must always be covered. Adding a new durable-state key to
// this list + to js/export.js's EXPORT_SETTINGS_KEYS is a single-PR
// change; leaving either out is the bug this test prevents.
const CRITICAL_KEYS = [
  // Wellness pillar — user's primary reason for backup/restore
  'wellness_meds',
  'wellness_rest_log',

  // BFRB — ADHD-adjacent habit data the user's invested in tracking
  'bfrb_events',   // F3 consolidated stream — source of truth post-migration (A1)
  'bfrbs_global',
  'flow_bfrbs',
  'pomodoro_bfrbs',

  // Focus session state (mid-block resume across devices)
  'flow_state', 'flow_config',
  'pomodoro_state', 'pomodoro_config',

  // Workout / cooking state
  'interval_state',
  'sequence_state', 'sequence_templates',
  'cooking_timers',

  // User preferences
  'theme', 'sound_profile', 'bfrb_volume',
];

describe('Export — settings key coverage', () => {
  it('exposes getSettingsKeys() for test introspection', () => {
    assertEqual(typeof Export.getSettingsKeys, 'function');
    const keys = Export.getSettingsKeys();
    assertEqual(Array.isArray(keys), true);
    assert(keys.length > 0, 'expected non-empty key list');
  });

  it('covers every critical localStorage key', () => {
    const keys = Export.getSettingsKeys();
    const missing = CRITICAL_KEYS.filter(k => !keys.includes(k));
    assertEqual(missing.length, 0,
      `EXPORT_SETTINGS_KEYS is missing: ${missing.join(', ')}`);
  });

  it('returns a copy, not the internal array (mutation-safe)', () => {
    const a = Export.getSettingsKeys();
    a.push('__mutation_probe__');
    const b = Export.getSettingsKeys();
    assertEqual(b.includes('__mutation_probe__'), false);
  });
});

describe('Export.buildBackupData — payload shape', () => {
  it('returns { version: 1, exportedAt, sessions, settings }', async () => {
    window.History = { getSessions: async () => [] };
    const data = await Export.buildBackupData();
    assertEqual(data.version, 1);
    assertEqual(typeof data.exportedAt, 'string');
    assertEqual(Array.isArray(data.sessions), true);
    assertEqual(typeof data.settings, 'object');
  });

  it('includes wellness_meds in the settings block when set', async () => {
    const medsBlob = JSON.stringify({
      meds: [{ id: 'v', name: 'Vyvanse', dose: '60 mg',
               frequency: 'once-daily', doseLog: [{ takenAt: 1700000000000 }] }],
    });
    localStorage.setItem('wellness_meds', medsBlob);
    window.History = { getSessions: async () => [] };
    try {
      const data = await Export.buildBackupData();
      assertEqual(data.settings.wellness_meds, medsBlob);
    } finally {
      localStorage.removeItem('wellness_meds');
    }
  });

  it('includes wellness_rest_log when set', async () => {
    const restBlob = JSON.stringify({
      '2026-04-23': { sleep: { hours: 7.5, quality: 4 }, naps: [] },
    });
    localStorage.setItem('wellness_rest_log', restBlob);
    window.History = { getSessions: async () => [] };
    try {
      const data = await Export.buildBackupData();
      assertEqual(data.settings.wellness_rest_log, restBlob);
    } finally {
      localStorage.removeItem('wellness_rest_log');
    }
  });

  it('omits keys that are not set (keeps the backup compact)', async () => {
    // Sweep — don't leave test data bleed from earlier tests.
    Export.getSettingsKeys().forEach(k => localStorage.removeItem(k));
    window.History = { getSessions: async () => [] };
    const data = await Export.buildBackupData();
    assertEqual(Object.keys(data.settings).length, 0);
  });

  it('forwards session history unchanged', async () => {
    const fixture = [
      { id: 1, type: 'flow', date: '2026-04-23T12:00:00.000Z', duration: 5400000, laps: [] },
      { id: 2, type: 'pomodoro', date: '2026-04-23T13:00:00.000Z', duration: 1500000, laps: [] },
    ];
    window.History = { getSessions: async () => fixture };
    const data = await Export.buildBackupData();
    assertEqual(data.sessions.length, 2);
    assertEqual(data.sessions[0].id, 1);
    assertEqual(data.sessions[1].type, 'pomodoro');
  });
});

describe('Export — Todoist-linkage stripping (DECISION 8)', () => {
  it('includes flow_user_tasks in getSettingsKeys()', () => {
    const keys = Export.getSettingsKeys();
    assertEqual(keys.includes('flow_user_tasks'), true,
      'flow_user_tasks must be in EXPORT_SETTINGS_KEYS for backup parity with pomodoro_saved_tasks');
  });

  it('strips todoistId + localTag from flow_user_tasks while preserving text + done', async () => {
    const raw = JSON.stringify([
      { text: 'Write spec', todoistId: '12345', localTag: 'flow-abc', done: true },
    ]);
    localStorage.setItem('flow_user_tasks', raw);
    window.History = { getSessions: async () => [] };
    try {
      const data = await Export.buildBackupData();
      assert(typeof data.settings.flow_user_tasks === 'string',
        'flow_user_tasks should be exported as a JSON string');
      const items = JSON.parse(data.settings.flow_user_tasks);
      assertEqual(items.length, 1);
      assertEqual(items[0].text, 'Write spec');
      assertEqual(items[0].done, true);
      assertEqual('todoistId' in items[0], false, 'todoistId must be stripped');
      assertEqual('localTag' in items[0], false, 'localTag must be stripped');
    } finally {
      localStorage.removeItem('flow_user_tasks');
    }
  });

  it('preserves a plain local flow_user_tasks entry verbatim (no linkage to strip)', async () => {
    const raw = JSON.stringify([{ text: 'Read', done: false }]);
    localStorage.setItem('flow_user_tasks', raw);
    window.History = { getSessions: async () => [] };
    try {
      const data = await Export.buildBackupData();
      const items = JSON.parse(data.settings.flow_user_tasks);
      assertEqual(items.length, 1);
      assertEqual(items[0].text, 'Read');
      assertEqual(items[0].done, false);
      assertEqual('todoistId' in items[0], false);
      assertEqual('localTag' in items[0], false);
    } finally {
      localStorage.removeItem('flow_user_tasks');
    }
  });

  it('omits flow_user_tasks from settings when the key is absent (null-skip path)', async () => {
    localStorage.removeItem('flow_user_tasks');
    window.History = { getSessions: async () => [] };
    const data = await Export.buildBackupData();
    assertEqual('flow_user_tasks' in data.settings, false,
      'absent flow_user_tasks must not appear in the backup settings block');
  });

  it('round-trips flow_user_tasks back into localStorage on import (stripped form)', async () => {
    // Sweep so only flow_user_tasks is in play.
    Export.getSettingsKeys().forEach(k => localStorage.removeItem(k));
    const raw = JSON.stringify([
      { text: 'Write spec', todoistId: '12345', localTag: 'flow-abc', done: true },
    ]);
    localStorage.setItem('flow_user_tasks', raw);

    let stored = [];
    window.History = {
      getSessions: async () => stored.slice(),
      addSession: async (s) => { stored.push(s); },
      clearAll: async () => { stored = []; },
    };

    // Export → capture the stripped string.
    const payload = await Export.buildBackupData();
    const exported = payload.settings.flow_user_tasks;
    const json = JSON.stringify(payload);

    // Clear the key, then import the backup back.
    localStorage.removeItem('flow_user_tasks');
    assertEqual(localStorage.getItem('flow_user_tasks'), null);

    const result = await Export.importAllData(json);
    assert(result.settingsRestored >= 1, 'expected at least flow_user_tasks restored');
    assertEqual(localStorage.getItem('flow_user_tasks'), exported,
      'imported flow_user_tasks must match the exported (stripped) string');

    // The restored value carries text + done but no linkage.
    const restored = JSON.parse(localStorage.getItem('flow_user_tasks'));
    assertEqual(restored[0].text, 'Write spec');
    assertEqual(restored[0].done, true);
    assertEqual('todoistId' in restored[0], false);
    assertEqual('localTag' in restored[0], false);

    localStorage.removeItem('flow_user_tasks');
  });

  it('regression: still strips todoistId + localTag from pomodoro_saved_tasks', async () => {
    const raw = JSON.stringify([
      { text: 'Ship PR', todoistId: '99999', localTag: 'pomo-xyz' },
      'plain-string-task',
    ]);
    localStorage.setItem('pomodoro_saved_tasks', raw);
    window.History = { getSessions: async () => [] };
    try {
      const data = await Export.buildBackupData();
      const items = JSON.parse(data.settings.pomodoro_saved_tasks);
      assertEqual(items.length, 2);
      assertEqual(items[0].text, 'Ship PR');
      assertEqual('todoistId' in items[0], false, 'todoistId must be stripped');
      assertEqual('localTag' in items[0], false, 'localTag must be stripped');
      // String-form tasks pass through untouched.
      assertEqual(items[1], 'plain-string-task');
    } finally {
      localStorage.removeItem('pomodoro_saved_tasks');
    }
  });
});

describe('Export.importAllData — restore behavior', () => {
  // A minimal in-memory History stub the import path can call.
  function makeHistoryStub() {
    let stored = [];
    return {
      getSessions: async () => stored.slice(),
      addSession: async (s) => { stored.push(s); },
      clearAll: async () => { stored = []; },
      _peek: () => stored,
    };
  }

  it('throws on missing or wrong version', async () => {
    window.History = makeHistoryStub();
    let threw = false;
    try { await Export.importAllData('{}'); } catch { threw = true; }
    assertEqual(threw, true);
    threw = false;
    try { await Export.importAllData('{"version":2}'); } catch { threw = true; }
    assertEqual(threw, true);
  });

  it('throws on malformed JSON', async () => {
    window.History = makeHistoryStub();
    let threw = false;
    try { await Export.importAllData('not-json'); } catch { threw = true; }
    assertEqual(threw, true);
  });

  it('restores sessions into History and reports count', async () => {
    const stub = makeHistoryStub();
    window.History = stub;
    const payload = JSON.stringify({
      version: 1,
      exportedAt: '2026-04-23T12:00:00.000Z',
      sessions: [
        { id: 1, type: 'flow', date: '2026-04-22T10:00:00.000Z', duration: 5400000, laps: [] },
        { id: 2, type: 'pomodoro', date: '2026-04-22T11:00:00.000Z', duration: 1500000, laps: [] },
        { id: 3, type: 'stopwatch', date: '2026-04-22T12:00:00.000Z', duration: 30000, laps: [] },
      ],
      settings: {},
    });
    const result = await Export.importAllData(payload);
    assertEqual(result.sessionsImported, 3);
    assertEqual(stub._peek().length, 3);
  });

  it('restores settings into localStorage and reports count', async () => {
    Export.getSettingsKeys().forEach(k => localStorage.removeItem(k));
    window.History = makeHistoryStub();
    const payload = JSON.stringify({
      version: 1,
      exportedAt: '2026-04-23T12:00:00.000Z',
      sessions: [],
      settings: {
        wellness_meds: '{"meds":[]}',
        wellness_rest_log: '{"2026-04-22":{"sleep":{"hours":7.5}}}',
        theme: 'midnight',
        bfrb_volume: '0.6',
      },
    });
    const result = await Export.importAllData(payload);
    assertEqual(result.settingsRestored, 4);
    assertEqual(localStorage.getItem('wellness_meds'), '{"meds":[]}');
    assertEqual(localStorage.getItem('theme'), 'midnight');
    assertEqual(localStorage.getItem('bfrb_volume'), '0.6');
  });

  it('ignores unknown setting keys (defense against malformed backups)', async () => {
    Export.getSettingsKeys().forEach(k => localStorage.removeItem(k));
    window.History = makeHistoryStub();
    const payload = JSON.stringify({
      version: 1,
      sessions: [],
      settings: { theme: 'ocean', __evil_key__: 'should-not-land' },
    });
    await Export.importAllData(payload);
    assertEqual(localStorage.getItem('theme'), 'ocean');
    assertEqual(localStorage.getItem('__evil_key__'), null);
  });

  it('ignores non-string setting values (defense against malformed backups)', async () => {
    Export.getSettingsKeys().forEach(k => localStorage.removeItem(k));
    window.History = makeHistoryStub();
    const payload = JSON.stringify({
      version: 1,
      sessions: [],
      settings: {
        theme: 'ocean',
        // These are in the keys list but have wrong types — must be skipped.
        wellness_meds: { meds: [] },           // object, not string
        bfrb_volume: 0.6,                       // number, not string
      },
    });
    const result = await Export.importAllData(payload);
    assertEqual(localStorage.getItem('theme'), 'ocean');
    assertEqual(localStorage.getItem('wellness_meds'), null);
    assertEqual(localStorage.getItem('bfrb_volume'), null);
    assertEqual(result.settingsRestored, 1);
  });
});

describe('Export.importAllData — restore robustness (H1 / M8)', () => {
  it('skips non-object session elements instead of feeding them to addSession (M8)', async () => {
    let stored = [];
    window.History = {
      getSessions: async () => stored.slice(),
      // Real addSession dereferences session.id / spreads ...session, so a
      // non-object would throw here. Assert we are never handed garbage.
      addSession: async (s) => {
        assert(s && typeof s === 'object' && !Array.isArray(s),
          'addSession must only receive plain-object sessions');
        stored.push(s);
      },
      clearAll: async () => { stored = []; },
    };
    const payload = JSON.stringify({
      version: 1,
      sessions: [{ id: 'a' }, 'garbage', null, 42, ['x'], { id: 'b' }],
      settings: {},
    });
    const result = await Export.importAllData(payload);
    assertEqual(result.sessionsImported, 2);   // only the two real objects
    assertEqual(stored.length, 2);
  });

  it('a session that throws mid-import does not abort the rest — no half-wiped history (H1)', async () => {
    let stored = [];
    let cleared = false;
    window.History = {
      getSessions: async () => stored.slice(),
      addSession: async (s) => {
        if (s && s.id === 'boom') throw new Error('simulated IDB write failure');
        stored.push(s);
      },
      clearAll: async () => { cleared = true; stored = []; },
    };
    const payload = JSON.stringify({
      version: 1,
      sessions: [
        { id: 'a', type: 'flow', duration: 1 },
        { id: 'boom', type: 'flow', duration: 1 },  // throws inside addSession
        { id: 'b', type: 'pomodoro', duration: 1 },
      ],
      settings: {},
    });
    // Must NOT throw — the per-element try/catch keeps the loop alive.
    const result = await Export.importAllData(payload);
    assertEqual(cleared, true);
    assertEqual(result.sessionsImported, 2);   // a + b survived; boom skipped
    assertEqual(stored.length, 2);
  });

  it('validates element shape before clearAll (a wholly-garbage sessions array still clears + imports 0)', async () => {
    let stored = [{ id: 'pre-existing' }];
    let cleared = false;
    window.History = {
      getSessions: async () => stored.slice(),
      addSession: async (s) => { stored.push(s); },
      clearAll: async () => { cleared = true; stored = []; },
    };
    const payload = JSON.stringify({
      version: 1,
      sessions: ['x', null, 7, ['y']],   // nothing valid
      settings: {},
    });
    const result = await Export.importAllData(payload);
    assertEqual(cleared, true);
    assertEqual(result.sessionsImported, 0);
    assertEqual(stored.length, 0);
  });
});

describe('Export — per-record meds sweep (post-F18)', () => {
  // The migrated meds store is per-record `meds/{id}` keys (NOT the legacy
  // single `wellness_meds` blob, which meds.js deletes on migration). These
  // keys are outside EXPORT_SETTINGS_KEYS, so buildBackupData/importAllData
  // handle them via the dedicated `meds` payload field.
  function clearMedsRecords() {
    const stale = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('meds/')) stale.push(k);
    }
    stale.forEach(k => localStorage.removeItem(k));
  }
  function seedMedRecord(id, obj) {
    localStorage.setItem('meds/' + id, JSON.stringify(Object.assign({ id }, obj)));
  }
  function makeHistoryStub() {
    let stored = [];
    return {
      getSessions: async () => stored.slice(),
      addSession: async (s) => { stored.push(s); },
      clearAll: async () => { stored = []; },
    };
  }

  it('captures per-record meds/{id} keys in payload.meds on a migrated device', async () => {
    clearMedsRecords();
    localStorage.removeItem('wellness_meds'); // migrated: legacy blob is gone
    seedMedRecord('med-a', { name: 'Vyvanse', dose: '60 mg', frequency: 'once-daily',
      doseLog: [{ takenAt: 1700000000000, deviceId: 'd1' }] });
    seedMedRecord('med-b', { name: 'Strattera', frequency: 'twice-daily', doseLog: [] });
    window.History = { getSessions: async () => [] };
    try {
      const data = await Export.buildBackupData();
      assertEqual(Array.isArray(data.meds), true);
      assertEqual(data.meds.length, 2);
      const byId = {}; data.meds.forEach(m => { byId[m.id] = m; });
      assertEqual(byId['med-a'].name, 'Vyvanse');
      assertEqual(byId['med-a'].doseLog.length, 1);
      assertEqual(byId['med-b'].frequency, 'twice-daily');
      // The legacy blob is absent on a migrated device, yet meds are captured.
      assertEqual(data.settings.wellness_meds, undefined);
    } finally {
      clearMedsRecords();
    }
  });

  it('skips corrupt meds/{id} entries without aborting the backup', async () => {
    clearMedsRecords();
    seedMedRecord('med-good', { name: 'Good', doseLog: [] });
    localStorage.setItem('meds/med-bad', '{{not json');
    window.History = { getSessions: async () => [] };
    try {
      const data = await Export.buildBackupData();
      assertEqual(data.meds.length, 1);
      assertEqual(data.meds[0].id, 'med-good');
    } finally {
      clearMedsRecords();
    }
  });

  it('payload.meds is an empty array when there are no meds/* keys', async () => {
    clearMedsRecords();
    localStorage.removeItem('wellness_meds');
    window.History = { getSessions: async () => [] };
    const data = await Export.buildBackupData();
    assertEqual(Array.isArray(data.meds), true);
    assertEqual(data.meds.length, 0);
  });

  it('importAllData restores per-record meds and reports medsRestored', async () => {
    clearMedsRecords();
    window.History = makeHistoryStub();
    const payload = JSON.stringify({
      version: 1, sessions: [], settings: {},
      meds: [
        { id: 'med-x', name: 'Adderall', dose: '20 mg', frequency: 'twice-daily',
          doseLog: [{ takenAt: 1700000000000, deviceId: 'd9' }] },
        { id: 'med-y', name: 'Wellbutrin', frequency: 'once-daily', doseLog: [] },
      ],
    });
    try {
      const result = await Export.importAllData(payload);
      assertEqual(result.medsRestored, 2);
      const x = JSON.parse(localStorage.getItem('meds/med-x'));
      assertEqual(x.name, 'Adderall');
      assertEqual(x.doseLog[0].takenAt, 1700000000000);
      assertEqual(JSON.parse(localStorage.getItem('meds/med-y')).frequency, 'once-daily');
    } finally {
      clearMedsRecords();
    }
  });

  it('import clears stale meds/{id} keys not present in the backup', async () => {
    clearMedsRecords();
    seedMedRecord('med-stale', { name: 'Old', doseLog: [] });
    window.History = makeHistoryStub();
    const payload = JSON.stringify({
      version: 1, sessions: [], settings: {},
      meds: [{ id: 'med-fresh', name: 'New', doseLog: [] }],
    });
    try {
      await Export.importAllData(payload);
      assertEqual(localStorage.getItem('meds/med-stale'), null);          // cleared
      assert(localStorage.getItem('meds/med-fresh') !== null, 'fresh med written');
    } finally {
      clearMedsRecords();
    }
  });

  it('pre-F18 backups (no meds field) leave meds/* untouched — medsRestored 0', async () => {
    clearMedsRecords();
    seedMedRecord('med-keep', { name: 'Keep', doseLog: [] });
    window.History = makeHistoryStub();
    const payload = JSON.stringify({
      version: 1, sessions: [], settings: { wellness_meds: '{"meds":[]}' },
    });
    try {
      const result = await Export.importAllData(payload);
      assertEqual(result.medsRestored, 0);
      // No meds field → meds/* not cleared; legacy blob restored for reload-time migration.
      assert(localStorage.getItem('meds/med-keep') !== null, 'existing med preserved');
      assertEqual(localStorage.getItem('wellness_meds'), '{"meds":[]}');
    } finally {
      clearMedsRecords();
      localStorage.removeItem('wellness_meds');
    }
  });

  it('F10: hybrid backup — per-record meds win, the stale wellness_meds blob is NOT restored', async () => {
    clearMedsRecords();
    localStorage.removeItem('wellness_meds');
    window.History = makeHistoryStub();
    // Hand-assembled hybrid: stale blob + fresher per-record copy of the SAME
    // med id. Restoring the blob would let meds.js's _migrateLegacyBlob()
    // overwrite the fresher meds/{id} key on the post-import reload.
    const payload = JSON.stringify({
      version: 1, sessions: [], settings: {
        wellness_meds: JSON.stringify({ meds: [{ id: 'med-h', name: 'Stale', doseLog: [] }] }),
      },
      meds: [{ id: 'med-h', name: 'Fresh', dose: '10 mg',
        doseLog: [{ takenAt: 1700000000000, deviceId: 'd1' }] }],
    });
    try {
      const result = await Export.importAllData(payload);
      assertEqual(result.medsRestored, 1);
      assertEqual(localStorage.getItem('wellness_meds'), null);
      assertEqual(JSON.parse(localStorage.getItem('meds/med-h')).name, 'Fresh');
    } finally {
      clearMedsRecords();
      localStorage.removeItem('wellness_meds');
    }
  });

  it('F10 boundary: an EMPTY meds array still restores the blob (legacy-style rollback)', async () => {
    clearMedsRecords();
    localStorage.removeItem('wellness_meds');
    window.History = makeHistoryStub();
    // meds: [] clears device meds/* wholesale (restore-replaces semantics), so
    // no fresher per-record key survives for the blob migration to clobber —
    // restoring the blob here is coherent legacy rollback, not a hazard.
    const payload = JSON.stringify({
      version: 1, sessions: [], settings: {
        wellness_meds: JSON.stringify({ meds: [{ id: 'med-r', name: 'Rollback', doseLog: [] }] }),
      },
      meds: [],
    });
    try {
      const result = await Export.importAllData(payload);
      assertEqual(result.medsRestored, 0);
      const blob = JSON.parse(localStorage.getItem('wellness_meds'));
      assertEqual(blob.meds[0].name, 'Rollback');
    } finally {
      clearMedsRecords();
      localStorage.removeItem('wellness_meds');
    }
  });

  it('round-trips per-record meds through export → import onto a fresh store', async () => {
    clearMedsRecords();
    localStorage.removeItem('wellness_meds');
    seedMedRecord('med-rt', { name: 'Vyvanse', dose: '50 mg', frequency: 'once-daily',
      doseLog: [{ takenAt: 1699999999999, deviceId: 'd1' }] });
    window.History = makeHistoryStub();
    try {
      const json = JSON.stringify(await Export.buildBackupData());
      clearMedsRecords(); // simulate a fresh device
      assertEqual(localStorage.getItem('meds/med-rt'), null);
      const result = await Export.importAllData(json);
      assertEqual(result.medsRestored, 1);
      const restored = JSON.parse(localStorage.getItem('meds/med-rt'));
      assertEqual(restored.name, 'Vyvanse');
      assertEqual(restored.dose, '50 mg');
      assertEqual(restored.doseLog[0].takenAt, 1699999999999);
    } finally {
      clearMedsRecords();
    }
  });
});

describe('Export + Import round-trip', () => {
  it('backup → restore preserves every covered key + sessions', async () => {
    // Seed localStorage with representative values for every critical key.
    const seeded = {
      wellness_meds: JSON.stringify({ meds: [{ id: 'v', name: 'Test',
                                               frequency: 'once-daily',
                                               doseLog: [{ takenAt: 1700000000000 }] }] }),
      wellness_rest_log: JSON.stringify({ '2026-04-23': { sleep: { hours: 8 } } }),
      bfrbs_global: JSON.stringify([{ timestamp: 1700000000000 }]),
      theme: 'midnight',
      bfrb_volume: '0.55',
    };
    Object.entries(seeded).forEach(([k, v]) => localStorage.setItem(k, v));

    const fixtureSessions = [
      { id: 1, type: 'flow', date: '2026-04-22T10:00:00.000Z', duration: 5400000, laps: [] },
    ];
    window.History = { getSessions: async () => fixtureSessions };

    const payload = await Export.buildBackupData();
    const json = JSON.stringify(payload);

    // Wipe everything, then restore.
    Object.keys(seeded).forEach(k => localStorage.removeItem(k));
    let stored = [];
    window.History = {
      getSessions: async () => stored.slice(),
      addSession: async (s) => { stored.push(s); },
      clearAll: async () => { stored = []; },
    };

    const result = await Export.importAllData(json);
    assertEqual(result.sessionsImported, 1);
    assertEqual(stored[0].id, 1);
    Object.entries(seeded).forEach(([k, v]) => {
      assertEqual(localStorage.getItem(k), v, `mismatch after restore for key ${k}`);
    });

    // Cleanup
    Object.keys(seeded).forEach(k => localStorage.removeItem(k));
  });
});

describe('Export — bfrb_events (F3 consolidated stream, A1)', () => {
  function makeHistoryStub() {
    let stored = [];
    return {
      getSessions: async () => stored.slice(),
      addSession: async (s) => { stored.push(s); },
      clearAll: async () => { stored = []; },
    };
  }

  it('includes bfrb_events AND its migration marker in getSettingsKeys()', () => {
    const keys = Export.getSettingsKeys();
    assertEqual(keys.includes('bfrb_events'), true,
      'bfrb_events (post-migration source of truth) must be backed up — every catch logged after the migration lands ONLY here');
    assertEqual(keys.includes('tempo_bfrb_events_migration_v1'), true,
      'the migration marker must be backed up so a cross-device restore does not re-migrate the legacy keys and double-count');
  });

  it('captures bfrb_events in the backup when set', async () => {
    const events = JSON.stringify([
      { takenAt: 1700000000000, context: 'global', deviceId: 'd1', updatedAt: 1700000000000, schemaVersion: 1 },
    ]);
    localStorage.setItem('bfrb_events', events);
    window.History = { getSessions: async () => [] };
    try {
      const data = await Export.buildBackupData();
      assertEqual(data.settings.bfrb_events, events);
    } finally {
      localStorage.removeItem('bfrb_events');
    }
  });

  it('round-trips bfrb_events + marker through export → import (the data-loss regression)', async () => {
    Export.getSettingsKeys().forEach(k => localStorage.removeItem(k));
    const events = JSON.stringify([
      { takenAt: 1700000000000, context: 'flow', phase: 'focus', deviceId: 'd1', updatedAt: 1700000000000, schemaVersion: 1 },
      { takenAt: 1700000600000, context: 'global', deviceId: 'd1', updatedAt: 1700000600000, schemaVersion: 1 },
    ]);
    localStorage.setItem('bfrb_events', events);
    localStorage.setItem('tempo_bfrb_events_migration_v1', '1');
    window.History = makeHistoryStub();

    const json = JSON.stringify(await Export.buildBackupData());
    // Simulate restoring onto a fresh device.
    localStorage.removeItem('bfrb_events');
    localStorage.removeItem('tempo_bfrb_events_migration_v1');

    await Export.importAllData(json);
    assertEqual(localStorage.getItem('bfrb_events'), events,
      'every consolidated BFRB catch must survive backup → restore');
    assertEqual(localStorage.getItem('tempo_bfrb_events_migration_v1'), '1',
      'the marker must restore so the migration stays a no-op on the new device (no double-count)');

    Export.getSettingsKeys().forEach(k => localStorage.removeItem(k));
  });
});

describe('Export tests — cleanup', () => {
  it('clears any settings left behind', () => {
    Export.getSettingsKeys().forEach(k => localStorage.removeItem(k));
  });
});
