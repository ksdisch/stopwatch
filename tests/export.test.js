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

describe('Export tests — cleanup', () => {
  it('clears any settings left behind', () => {
    Export.getSettingsKeys().forEach(k => localStorage.removeItem(k));
  });
});
