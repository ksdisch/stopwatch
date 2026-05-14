// E-1d-f8 — Distractions module + migration tests.
//
// Coverage (per E-1d-f8-AUDIT § "Test scope"):
//   1.  Migration idempotency — re-run with marker set is a no-op.
//   2.  Migration idempotency — re-run WITHOUT marker produces byte-identical
//       output via (deviceId, timestamp) dedup. (Risk #2 mitigation.)
//   3.  Migration attaches legacy flat array to active session if running.
//   4.  Migration falls back to orphan key when no session is running.
//   5.  Migration skips malformed entries — per-entry try/catch.
//       (Risk #1 mitigation.)
//   6.  log() stamps deviceId + updatedAt + schemaVersion via Schema.stamp.
//   7.  log() honors F13 write gate.
//   8.  getForSession filters to one session's entries.
//   9.  clearSession drops one session's entries without touching others.
//   10. clearAllForContext empties one context without touching the other.
//   11. snapshotForSync returns wire envelope shape.
//   12. Migration partial-completion recovery — new map already has entries
//       and marker not set; dedup keeps byte-equivalent output.
//
// Module-level note: js/distractions.js auto-runs migration at module load.
// Each test clears localStorage + invokes Distractions._runMigration()
// explicitly, so the auto-run is observably irrelevant.

// ── Shared save/restore + install helpers ─────────────────────────────

function _e1d_f8_savedEnv() {
  return {
    sync_flag_storage: localStorage.getItem('tempo_sync_enabled'),
    flag_isEnabled: (typeof SyncFlag !== 'undefined') ? SyncFlag.isEnabled : undefined,
    syncState: window.SyncState,
    flow: window.Flow,
    pomodoro: window.Pomodoro,
  };
}

function _e1d_f8_restore(saved) {
  if (typeof SyncFlag !== 'undefined' && saved.flag_isEnabled !== undefined) {
    SyncFlag.isEnabled = saved.flag_isEnabled;
  }
  if (saved.syncState === undefined) delete window.SyncState;
  else window.SyncState = saved.syncState;
  if (saved.sync_flag_storage === null) localStorage.removeItem('tempo_sync_enabled');
  else localStorage.setItem('tempo_sync_enabled', saved.sync_flag_storage);
  if (saved.flow === undefined) delete window.Flow;
  else window.Flow = saved.flow;
  if (saved.pomodoro === undefined) delete window.Pomodoro;
  else window.Pomodoro = saved.pomodoro;
}

// Clear every key Distractions touches.
function _e1d_f8_clearAll() {
  try { localStorage.removeItem('flow_distractions'); } catch (_) {}
  try { localStorage.removeItem('pomodoro_distractions'); } catch (_) {}
  try { localStorage.removeItem('tempo_distractions_migration_v1'); } catch (_) {}
}

// Install Flow / Pomodoro stubs that return a configurable sessionId.
function _e1d_f8_installEngines(flowSessionId, pomoSessionId) {
  window.Flow = {
    getSessionStartedAt: () => flowSessionId,
  };
  window.Pomodoro = {
    getSessionStartedAt: () => pomoSessionId,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Test cases — Distractions migration + module API
// ────────────────────────────────────────────────────────────────────────

describe('Distractions — module + migration', () => {

  it('1. migration idempotency — re-run with marker set is a no-op', () => {
    const saved = _e1d_f8_savedEnv();
    try {
      _e1d_f8_clearAll();
      _e1d_f8_installEngines(null, null);
      // Seed legacy keys then run migration once.
      localStorage.setItem('flow_distractions', JSON.stringify([{ category: 'phone', timestamp: 1000 }]));
      localStorage.setItem('pomodoro_distractions', JSON.stringify([{ category: 'self', timestamp: 2000 }]));
      const r1 = Distractions._runMigration();
      assertEqual(r1.migrated, true, 'first run migrated');
      assertEqual(localStorage.getItem('tempo_distractions_migration_v1'), '1', 'marker set');

      // Spy setItem to confirm second run does NOT re-write either map.
      const originalSetItem = localStorage.setItem.bind(localStorage);
      const setCalls = [];
      localStorage.setItem = (k, v) => {
        setCalls.push(k);
        return originalSetItem(k, v);
      };
      try {
        const r2 = Distractions._runMigration();
        assertEqual(r2.migrated, false, 'second run is a no-op');
        const wroteFlow = setCalls.some(k => k === 'flow_distractions');
        const wrotePomo = setCalls.some(k => k === 'pomodoro_distractions');
        assertEqual(wroteFlow, false, 'flow_distractions NOT re-written');
        assertEqual(wrotePomo, false, 'pomodoro_distractions NOT re-written');
      } finally {
        localStorage.setItem = originalSetItem;
      }
    } finally {
      _e1d_f8_clearAll();
      _e1d_f8_restore(saved);
    }
  });

  it('2. migration idempotency — re-run WITHOUT marker produces byte-identical output', () => {
    const saved = _e1d_f8_savedEnv();
    try {
      _e1d_f8_clearAll();
      _e1d_f8_installEngines(null, null);
      localStorage.setItem('flow_distractions', JSON.stringify([
        { category: 'phone', timestamp: 100 },
        { category: 'email', timestamp: 200 },
      ]));
      localStorage.setItem('pomodoro_distractions', JSON.stringify([
        { category: 'self', timestamp: 150, phase: 'work', cycleIndex: 1 },
      ]));

      Distractions._runMigration();
      const firstFlow = localStorage.getItem('flow_distractions');
      const firstPomo = localStorage.getItem('pomodoro_distractions');
      assert(firstFlow, 'flow_distractions written on first run');
      assert(firstPomo, 'pomodoro_distractions written on first run');

      // Remove marker (simulating marker-write failure).
      localStorage.removeItem('tempo_distractions_migration_v1');

      // Re-run migration. Legacy keys are GONE now (overwritten by the map),
      // so the migration sees maps + nothing new to merge.
      Distractions._runMigration();
      const secondFlow = localStorage.getItem('flow_distractions');
      const secondPomo = localStorage.getItem('pomodoro_distractions');
      assertEqual(secondFlow, firstFlow, 'flow re-run byte-identical');
      assertEqual(secondPomo, firstPomo, 'pomo re-run byte-identical');
    } finally {
      _e1d_f8_clearAll();
      _e1d_f8_restore(saved);
    }
  });

  it('3. migration attaches legacy flat array to active session if running', () => {
    const saved = _e1d_f8_savedEnv();
    try {
      _e1d_f8_clearAll();
      _e1d_f8_installEngines(50000, null); // Flow active, sessionId = 50000
      localStorage.setItem('flow_distractions', JSON.stringify([
        { category: 'phone', timestamp: 1000, phase: 'focus' },
        { category: 'email', timestamp: 2000, phase: 'focus' },
      ]));

      Distractions._runMigration();
      const map = JSON.parse(localStorage.getItem('flow_distractions'));
      assert(map && typeof map === 'object' && !Array.isArray(map), 'is a map');
      assert(Array.isArray(map['50000']), 'session 50000 key present');
      assertEqual(map['50000'].length, 2, 'two entries under sessionId');
      // Stamped envelope fields present.
      for (const e of map['50000']) {
        assert(typeof e.deviceId === 'string' && e.deviceId.length > 0, 'deviceId stamped');
        assert(typeof e.updatedAt === 'number', 'updatedAt stamped');
        assertEqual(e.schemaVersion, 1, 'schemaVersion stamped');
        assertEqual(e.phase, 'focus', 'phase preserved');
      }
    } finally {
      _e1d_f8_clearAll();
      _e1d_f8_restore(saved);
    }
  });

  it('4. migration falls back to orphan key when no session is running', () => {
    const saved = _e1d_f8_savedEnv();
    try {
      _e1d_f8_clearAll();
      _e1d_f8_installEngines(null, null); // no active sessions
      localStorage.setItem('flow_distractions', JSON.stringify([
        { category: 'phone', timestamp: 1000 },
      ]));

      Distractions._runMigration();
      const map = JSON.parse(localStorage.getItem('flow_distractions'));
      assert(Array.isArray(map[Distractions.ORPHAN_SESSION_ID]), 'orphan key present');
      assertEqual(map[Distractions.ORPHAN_SESSION_ID].length, 1, 'one orphan entry');
      assertEqual(map[Distractions.ORPHAN_SESSION_ID][0].category, 'phone', 'category preserved');
    } finally {
      _e1d_f8_clearAll();
      _e1d_f8_restore(saved);
    }
  });

  it('5. migration skips malformed entries — per-entry try/catch', () => {
    const saved = _e1d_f8_savedEnv();
    try {
      _e1d_f8_clearAll();
      _e1d_f8_installEngines(99, null);
      localStorage.setItem('flow_distractions', JSON.stringify([
        { category: 'phone', timestamp: 1000 },       // well-formed
        { category: 'email' },                          // missing timestamp
        { timestamp: 'not-a-number', category: 'self' },// string timestamp
        null,                                            // null entry
        { category: 'other', timestamp: 5000 },         // well-formed
      ]));

      const r = Distractions._runMigration();
      assertEqual(r.migrated, true, 'migration ran');
      assert(r.skipped >= 3, 'at least 3 malformed skipped');

      const map = JSON.parse(localStorage.getItem('flow_distractions'));
      assertEqual(map['99'].length, 2, 'only well-formed entries kept');
      assertEqual(map['99'][0].timestamp, 1000, 'first well-formed kept');
      assertEqual(map['99'][1].timestamp, 5000, 'second well-formed kept');
    } finally {
      _e1d_f8_clearAll();
      _e1d_f8_restore(saved);
    }
  });

  it('6. log() stamps deviceId + updatedAt + schemaVersion via Schema.stamp', () => {
    const saved = _e1d_f8_savedEnv();
    try {
      _e1d_f8_clearAll();
      // Mark migration done so we exercise the fresh-write path.
      localStorage.setItem('tempo_distractions_migration_v1', '1');

      const result = Distractions.log({
        context: 'flow',
        sessionId: 12345,
        category: 'phone',
      });
      assert(result, 'log returned entry');
      assertEqual(result.category, 'phone', 'category preserved');
      assert(typeof result.timestamp === 'number', 'timestamp set');
      assert(typeof result.deviceId === 'string' && result.deviceId.length > 0, 'deviceId stamped');
      assert(typeof result.updatedAt === 'number', 'updatedAt stamped');
      assertEqual(result.schemaVersion, Schema.SCHEMA_VERSION, 'schemaVersion stamped via Schema.stamp');

      const map = JSON.parse(localStorage.getItem('flow_distractions'));
      assertEqual(map['12345'].length, 1, 'one entry persisted under sessionId');
      assertEqual(map['12345'][0].schemaVersion, Schema.SCHEMA_VERSION, 'persisted entry stamped');
    } finally {
      _e1d_f8_clearAll();
      _e1d_f8_restore(saved);
    }
  });

  it('7. log() honors F13 write gate', () => {
    const saved = _e1d_f8_savedEnv();
    try {
      _e1d_f8_clearAll();
      localStorage.setItem('tempo_distractions_migration_v1', '1');

      const prevIsEnabled = SyncFlag.isEnabled;
      SyncFlag.isEnabled = () => true;
      window.SyncState = {
        canWrite: () => false,
        get: () => 'hydrating',
        STORAGE_KEY: 'tempo_sync_state',
      };

      try {
        const blocked = Distractions.log({ context: 'flow', sessionId: 1, category: 'phone' });
        assertEqual(blocked, null, 'log returned null when canWrite=false');
        const after = localStorage.getItem('flow_distractions');
        assert(!after || Object.keys(JSON.parse(after)).length === 0, 'no entry written');

        // Flip canWrite to true and retry.
        window.SyncState.canWrite = () => true;
        window.SyncState.get = () => 'ready';
        const allowed = Distractions.log({ context: 'flow', sessionId: 1, category: 'phone' });
        assert(allowed, 'log succeeded when canWrite=true');
        const map = JSON.parse(localStorage.getItem('flow_distractions'));
        assertEqual(map['1'].length, 1, 'one entry written after gate released');
      } finally {
        SyncFlag.isEnabled = prevIsEnabled;
      }
    } finally {
      _e1d_f8_clearAll();
      _e1d_f8_restore(saved);
    }
  });

  it('8. getForSession filters to one session', () => {
    const saved = _e1d_f8_savedEnv();
    try {
      _e1d_f8_clearAll();
      localStorage.setItem('tempo_distractions_migration_v1', '1');
      // Seed map directly with two sessions.
      const fixture = {
        '111': [
          { category: 'phone', timestamp: 100, deviceId: 'd1', updatedAt: 100, schemaVersion: 1 },
          { category: 'email', timestamp: 200, deviceId: 'd1', updatedAt: 200, schemaVersion: 1 },
          { category: 'self', timestamp: 300, deviceId: 'd1', updatedAt: 300, schemaVersion: 1 },
        ],
        '222': [
          { category: 'phone', timestamp: 400, deviceId: 'd1', updatedAt: 400, schemaVersion: 1 },
          { category: 'other', timestamp: 500, deviceId: 'd1', updatedAt: 500, schemaVersion: 1 },
        ],
      };
      localStorage.setItem('flow_distractions', JSON.stringify(fixture));

      const a = Distractions.getForSession('flow', 111);
      assertEqual(a.length, 3, 'session 111 has 3 entries');
      const b = Distractions.getForSession('flow', 222);
      assertEqual(b.length, 2, 'session 222 has 2 entries');
      const c = Distractions.getForSession('flow', 999);
      assertEqual(c.length, 0, 'missing session returns empty');
      const d = Distractions.getForSession('invalid', 111);
      assertEqual(d.length, 0, 'invalid context returns empty');
    } finally {
      _e1d_f8_clearAll();
      _e1d_f8_restore(saved);
    }
  });

  it('9. clearSession drops one session without touching others', () => {
    const saved = _e1d_f8_savedEnv();
    try {
      _e1d_f8_clearAll();
      localStorage.setItem('tempo_distractions_migration_v1', '1');
      const fixture = {
        '111': [{ category: 'phone', timestamp: 100, deviceId: 'd1', updatedAt: 100, schemaVersion: 1 }],
        '222': [{ category: 'email', timestamp: 200, deviceId: 'd1', updatedAt: 200, schemaVersion: 1 }],
      };
      localStorage.setItem('flow_distractions', JSON.stringify(fixture));

      Distractions.clearSession('flow', 111);
      const map = JSON.parse(localStorage.getItem('flow_distractions'));
      assert(!Object.prototype.hasOwnProperty.call(map, '111'), '111 deleted');
      assert(Object.prototype.hasOwnProperty.call(map, '222'), '222 retained');
      assertEqual(map['222'].length, 1, '222 entries intact');
    } finally {
      _e1d_f8_clearAll();
      _e1d_f8_restore(saved);
    }
  });

  it('10. clearAllForContext empties one context without touching the other', () => {
    const saved = _e1d_f8_savedEnv();
    try {
      _e1d_f8_clearAll();
      localStorage.setItem('tempo_distractions_migration_v1', '1');
      localStorage.setItem('flow_distractions', JSON.stringify({
        '111': [{ category: 'phone', timestamp: 100, deviceId: 'd1', updatedAt: 100, schemaVersion: 1 }],
      }));
      localStorage.setItem('pomodoro_distractions', JSON.stringify({
        '222': [{ category: 'self', timestamp: 200, deviceId: 'd1', updatedAt: 200, schemaVersion: 1 }],
      }));

      Distractions.clearAllForContext('pomodoro');
      const flowMap = JSON.parse(localStorage.getItem('flow_distractions'));
      const pomoMap = JSON.parse(localStorage.getItem('pomodoro_distractions'));
      assertEqual(Object.keys(flowMap).length, 1, 'flow map untouched');
      assertEqual(Object.keys(pomoMap).length, 0, 'pomo map emptied');
    } finally {
      _e1d_f8_clearAll();
      _e1d_f8_restore(saved);
    }
  });

  it('11. snapshotForSync returns wire envelope shape', () => {
    const saved = _e1d_f8_savedEnv();
    try {
      _e1d_f8_clearAll();
      localStorage.setItem('tempo_distractions_migration_v1', '1');
      localStorage.setItem('flow_distractions', JSON.stringify({
        '111': [{ category: 'phone', timestamp: 100, deviceId: 'd1', updatedAt: 100, schemaVersion: 1 }],
      }));
      localStorage.setItem('pomodoro_distractions', JSON.stringify({
        '222': [{ category: 'self', timestamp: 200, deviceId: 'd1', updatedAt: 200, schemaVersion: 1 }],
      }));

      const env = Distractions.snapshotForSync();
      assert(env && typeof env === 'object', 'envelope is object');
      assert(typeof env.deviceId === 'string' && env.deviceId.length > 0, 'deviceId set');
      assertEqual(env.schemaVersion, Schema.SCHEMA_VERSION, 'schemaVersion current');
      assert(env.payload && typeof env.payload === 'object', 'payload is object');
      assert(env.payload.flow && typeof env.payload.flow === 'object', 'payload.flow is map');
      assert(env.payload.pomodoro && typeof env.payload.pomodoro === 'object', 'payload.pomodoro is map');
      assert(Array.isArray(env.payload.flow['111']), 'flow session entries are array');
      assertEqual(env.payload.flow['111'].length, 1, 'flow session has one entry');
      assertEqual(env.payload.pomodoro['222'].length, 1, 'pomo session has one entry');
    } finally {
      _e1d_f8_clearAll();
      _e1d_f8_restore(saved);
    }
  });

  it('12. migration partial-completion recovery — new map already has entries, marker unset, dedup keeps output stable', () => {
    const saved = _e1d_f8_savedEnv();
    try {
      _e1d_f8_clearAll();
      _e1d_f8_installEngines(50000, null);
      // Simulate partial prior migration: the map is already written
      // under flow_distractions, marker is unset. The migration finds
      // the map shape (no legacy flat-array to transform), so the union
      // step is a no-op, marker gets set, and the map stays byte-equal.
      const preMigrated = {
        '50000': [{
          category: 'phone',
          timestamp: 1000,
          deviceId: 'd-test',
          updatedAt: 1000,
          schemaVersion: 1,
          phase: 'focus',
        }],
      };
      localStorage.setItem('flow_distractions', JSON.stringify(preMigrated));
      // Marker unset.
      const before = localStorage.getItem('flow_distractions');

      Distractions._runMigration();
      const after = localStorage.getItem('flow_distractions');
      assertEqual(after, before, 'pre-migrated map preserved byte-for-byte');
      assertEqual(localStorage.getItem('tempo_distractions_migration_v1'), '1', 'marker now set');
    } finally {
      _e1d_f8_clearAll();
      _e1d_f8_restore(saved);
    }
  });

});
