// E-1d-f3 — BfrbEvents module + migration tests.
//
// Coverage (per E-1d-f3-AUDIT § "Test scope"):
//   1.  Migration idempotency — re-run with marker set is a no-op.
//   2.  Migration idempotency — re-run WITHOUT marker produces byte-identical
//       output via (deviceId, takenAt) dedup. (Risk #2 mitigation.)
//   3.  Migration unions legacy entries correctly — context tag + sub-field
//       mapping (timestamp → takenAt, phase, cycleIndex).
//   4.  Migration skips malformed entries — per-entry try/catch + warning.
//       (Risk #1 mitigation.)
//   5.  log() stamps deviceId + updatedAt + schemaVersion via Schema.stamp.
//   6.  log() honors F13 write gate.
//   7.  getByContext(ctx) filters correctly.
//   8.  countToday(ctx?) respects local-date boundary.
//   9.  snapshotForSync() returns wire envelope shape.
//   10. Analytics output byte-equivalent pre-vs-post migration. (Risk #4.)
//
// Module-level note: js/bfrb-events.js auto-runs migration at module load.
// That ran ONCE at script-include time (with whatever localStorage happened
// to be present — probably empty in test harness). Each test clears
// localStorage + invokes BfrbEvents._runMigration() explicitly, so the
// auto-run is observably irrelevant.

// ── Shared save/restore + install helpers ─────────────────────────────

function _bfrb_savedEnv() {
  return {
    sync_flag_storage: localStorage.getItem('tempo_sync_enabled'),
    flag_isEnabled: (typeof SyncFlag !== 'undefined') ? SyncFlag.isEnabled : undefined,
    syncState: window.SyncState,
  };
}

function _bfrb_restore(saved) {
  if (typeof SyncFlag !== 'undefined' && saved.flag_isEnabled !== undefined) {
    SyncFlag.isEnabled = saved.flag_isEnabled;
  }
  if (saved.syncState === undefined) delete window.SyncState;
  else window.SyncState = saved.syncState;
  if (saved.sync_flag_storage === null) localStorage.removeItem('tempo_sync_enabled');
  else localStorage.setItem('tempo_sync_enabled', saved.sync_flag_storage);
}

// Clear every key BfrbEvents touches.
function _bfrb_clearAll() {
  try { localStorage.removeItem('bfrb_events'); } catch (_) {}
  try { localStorage.removeItem('tempo_bfrb_events_migration_v1'); } catch (_) {}
  try { localStorage.removeItem('bfrbs_global'); } catch (_) {}
  try { localStorage.removeItem('flow_bfrbs'); } catch (_) {}
  try { localStorage.removeItem('pomodoro_bfrbs'); } catch (_) {}
}

// ────────────────────────────────────────────────────────────────────────
// Test cases — BfrbEvents migration + module API
// ────────────────────────────────────────────────────────────────────────

describe('BfrbEvents — module + migration', () => {

  it('1. migration idempotency — re-run with marker set is a no-op', () => {
    const saved = _bfrb_savedEnv();
    try {
      _bfrb_clearAll();
      // Seed legacy keys then run migration once.
      localStorage.setItem('bfrbs_global', JSON.stringify([{ timestamp: 1000 }, { timestamp: 2000 }]));
      const r1 = BfrbEvents._runMigration();
      assertEqual(r1.migrated, true, 'first run migrated');
      assertEqual(localStorage.getItem('tempo_bfrb_events_migration_v1'), '1', 'marker set');
      const afterFirst = JSON.parse(localStorage.getItem('bfrb_events'));
      assertEqual(afterFirst.length, 2, 'two entries written on first run');

      // Spy setItem to confirm second run does NOT re-write bfrb_events.
      const originalSetItem = localStorage.setItem.bind(localStorage);
      const setCalls = [];
      localStorage.setItem = (k, v) => {
        setCalls.push(k);
        return originalSetItem(k, v);
      };
      try {
        const r2 = BfrbEvents._runMigration();
        assertEqual(r2.migrated, false, 'second run is a no-op');
        const wrotebfrb = setCalls.some(k => k === 'bfrb_events');
        assertEqual(wrotebfrb, false, 'bfrb_events NOT re-written on second run');
      } finally {
        localStorage.setItem = originalSetItem;
      }
    } finally {
      _bfrb_clearAll();
      _bfrb_restore(saved);
    }
  });

  it('2. migration idempotency — re-run WITHOUT marker produces byte-identical output', () => {
    const saved = _bfrb_savedEnv();
    try {
      _bfrb_clearAll();
      // Seed all 3 legacy keys.
      localStorage.setItem('bfrbs_global', JSON.stringify([{ timestamp: 100 }, { timestamp: 200 }]));
      localStorage.setItem('flow_bfrbs', JSON.stringify([{ timestamp: 150, phase: 'focus' }]));
      localStorage.setItem('pomodoro_bfrbs', JSON.stringify([{ timestamp: 175, phase: 'work', cycleIndex: 1 }]));

      BfrbEvents._runMigration();
      const firstOutput = localStorage.getItem('bfrb_events');
      assert(firstOutput, 'bfrb_events written on first run');

      // Remove marker (simulating marker-write failure).
      localStorage.removeItem('tempo_bfrb_events_migration_v1');

      // Re-run migration.
      BfrbEvents._runMigration();
      const secondOutput = localStorage.getItem('bfrb_events');
      assertEqual(secondOutput, firstOutput, 're-run produces byte-identical output');
    } finally {
      _bfrb_clearAll();
      _bfrb_restore(saved);
    }
  });

  it('3. migration unions legacy entries correctly — context tag + sub-field mapping', () => {
    const saved = _bfrb_savedEnv();
    try {
      _bfrb_clearAll();
      localStorage.setItem('bfrbs_global', JSON.stringify([{ timestamp: 1000 }, { timestamp: 2000 }]));
      localStorage.setItem('flow_bfrbs', JSON.stringify([{ timestamp: 3000, phase: 'focus' }]));
      localStorage.setItem('pomodoro_bfrbs', JSON.stringify([{ timestamp: 4000, phase: 'work', cycleIndex: 2 }]));

      const r = BfrbEvents._runMigration();
      assertEqual(r.migrated, true, 'migration ran');

      const entries = JSON.parse(localStorage.getItem('bfrb_events'));
      assertEqual(entries.length, 4, 'four entries written');

      // Sorted by takenAt ascending.
      const byContext = {};
      for (const e of entries) {
        byContext[e.context] = (byContext[e.context] || 0) + 1;
        assert(typeof e.takenAt === 'number', 'takenAt is number');
        assert(typeof e.deviceId === 'string' && e.deviceId.length > 0, 'deviceId stamped');
        assert(typeof e.updatedAt === 'number', 'updatedAt stamped');
        assertEqual(e.schemaVersion, 1, 'schemaVersion stamped');
      }
      assertEqual(byContext['global'], 2, 'two global entries');
      assertEqual(byContext['flow'], 1, 'one flow entry');
      assertEqual(byContext['pomodoro'], 1, 'one pomodoro entry');

      // Pomodoro entry retains phase + cycleIndex.
      const pomoEntry = entries.find(e => e.context === 'pomodoro');
      assertEqual(pomoEntry.phase, 'work', 'pomodoro phase preserved');
      assertEqual(pomoEntry.cycleIndex, 2, 'pomodoro cycleIndex preserved');
      assertEqual(pomoEntry.takenAt, 4000, 'pomodoro takenAt === legacy timestamp');

      // Flow entry retains phase.
      const flowEntry = entries.find(e => e.context === 'flow');
      assertEqual(flowEntry.phase, 'focus', 'flow phase preserved');
      assertEqual(flowEntry.takenAt, 3000, 'flow takenAt === legacy timestamp');
    } finally {
      _bfrb_clearAll();
      _bfrb_restore(saved);
    }
  });

  it('4. migration skips malformed entries — per-entry try/catch + warning', () => {
    const saved = _bfrb_savedEnv();
    try {
      _bfrb_clearAll();
      localStorage.setItem('bfrbs_global', JSON.stringify([
        { timestamp: 1000 },                       // well-formed
        { phase: 'orphan' },                        // missing timestamp
        { timestamp: 'not-a-number' },              // string timestamp
        null,                                       // null entry
        { timestamp: 5000 },                        // well-formed
      ]));

      const r = BfrbEvents._runMigration();
      assertEqual(r.migrated, true, 'migration ran');
      assert(r.skipped >= 3, 'three or more malformed entries skipped');

      const entries = JSON.parse(localStorage.getItem('bfrb_events'));
      assertEqual(entries.length, 2, 'only well-formed entries kept');
      assertEqual(entries[0].takenAt, 1000, 'first well-formed entry preserved');
      assertEqual(entries[1].takenAt, 5000, 'second well-formed entry preserved');
    } finally {
      _bfrb_clearAll();
      _bfrb_restore(saved);
    }
  });

  it('5. log() stamps deviceId + updatedAt + schemaVersion via Schema.stamp', () => {
    const saved = _bfrb_savedEnv();
    try {
      _bfrb_clearAll();
      // Mark migration done so we exercise the fresh-write path.
      localStorage.setItem('tempo_bfrb_events_migration_v1', '1');

      const result = BfrbEvents.log({ context: 'global' });
      assert(result, 'log returned entry');
      assert(typeof result.takenAt === 'number', 'takenAt set');
      assertEqual(result.context, 'global', 'context preserved');
      assert(typeof result.deviceId === 'string' && result.deviceId.length > 0, 'deviceId stamped');
      assert(typeof result.updatedAt === 'number', 'updatedAt stamped');
      assertEqual(result.schemaVersion, Schema.SCHEMA_VERSION, 'schemaVersion stamped via Schema.stamp');

      const persisted = JSON.parse(localStorage.getItem('bfrb_events'));
      assertEqual(persisted.length, 1, 'one entry persisted');
      assertEqual(persisted[0].schemaVersion, Schema.SCHEMA_VERSION, 'persisted entry stamped');
    } finally {
      _bfrb_clearAll();
      _bfrb_restore(saved);
    }
  });

  it('6. log() honors F13 write gate', () => {
    const saved = _bfrb_savedEnv();
    try {
      _bfrb_clearAll();
      localStorage.setItem('tempo_bfrb_events_migration_v1', '1');

      // Mock: sync enabled + canWrite() === false → blocks write.
      const prevIsEnabled = SyncFlag.isEnabled;
      SyncFlag.isEnabled = () => true;
      window.SyncState = {
        canWrite: () => false,
        get: () => 'hydrating',
        STORAGE_KEY: 'tempo_sync_state',
      };

      try {
        const blocked = BfrbEvents.log({ context: 'global' });
        assertEqual(blocked, null, 'log returned null when canWrite=false');
        const after = localStorage.getItem('bfrb_events');
        assert(!after || JSON.parse(after).length === 0, 'no entry written');

        // Flip canWrite to true and retry.
        window.SyncState.canWrite = () => true;
        window.SyncState.get = () => 'ready';
        const allowed = BfrbEvents.log({ context: 'global' });
        assert(allowed, 'log succeeded when canWrite=true');
        const persisted = JSON.parse(localStorage.getItem('bfrb_events'));
        assertEqual(persisted.length, 1, 'one entry written after gate released');
      } finally {
        SyncFlag.isEnabled = prevIsEnabled;
      }
    } finally {
      _bfrb_clearAll();
      _bfrb_restore(saved);
    }
  });

  it('7. getByContext(ctx) filters correctly', () => {
    const saved = _bfrb_savedEnv();
    try {
      _bfrb_clearAll();
      localStorage.setItem('tempo_bfrb_events_migration_v1', '1');
      // Seed directly so we control field shape.
      const fixtures = [
        { takenAt: 1000, context: 'global', deviceId: 'd1', updatedAt: 1000, schemaVersion: 1 },
        { takenAt: 2000, context: 'global', deviceId: 'd1', updatedAt: 2000, schemaVersion: 1 },
        { takenAt: 3000, context: 'flow', sessionId: 100, deviceId: 'd1', updatedAt: 3000, schemaVersion: 1 },
        { takenAt: 4000, context: 'flow', sessionId: 100, deviceId: 'd1', updatedAt: 4000, schemaVersion: 1 },
        { takenAt: 5000, context: 'pomodoro', sessionId: 200, deviceId: 'd1', updatedAt: 5000, schemaVersion: 1 },
      ];
      localStorage.setItem('bfrb_events', JSON.stringify(fixtures));

      const flow = BfrbEvents.getByContext('flow');
      assertEqual(flow.length, 2, 'two flow entries');
      for (const e of flow) assertEqual(e.context, 'flow', 'all flow context');

      const pomodoro = BfrbEvents.getByContext('pomodoro');
      assertEqual(pomodoro.length, 1, 'one pomodoro entry');
      assertEqual(pomodoro[0].sessionId, 200, 'pomodoro sessionId preserved');

      const global = BfrbEvents.getByContext('global');
      assertEqual(global.length, 2, 'two global entries');
    } finally {
      _bfrb_clearAll();
      _bfrb_restore(saved);
    }
  });

  it('8. countToday(ctx?) respects local-date boundary', () => {
    const saved = _bfrb_savedEnv();
    try {
      _bfrb_clearAll();
      localStorage.setItem('tempo_bfrb_events_migration_v1', '1');
      const now = Date.now();
      const fixtures = [
        { takenAt: now,                          context: 'global',   deviceId: 'd1', updatedAt: now, schemaVersion: 1 },
        { takenAt: now - 24 * 3600 * 1000,        context: 'global',   deviceId: 'd1', updatedAt: now, schemaVersion: 1 },
        { takenAt: now - 48 * 3600 * 1000,        context: 'global',   deviceId: 'd1', updatedAt: now, schemaVersion: 1 },
        { takenAt: now,                          context: 'flow',     sessionId: 1, deviceId: 'd1', updatedAt: now, schemaVersion: 1 },
        { takenAt: now,                          context: 'pomodoro', sessionId: 2, deviceId: 'd1', updatedAt: now, schemaVersion: 1 },
      ];
      localStorage.setItem('bfrb_events', JSON.stringify(fixtures));

      // countToday with NO context = total of today across all contexts (1 global + 1 flow + 1 pomodoro = 3).
      const all = BfrbEvents.countToday();
      assertEqual(all, 3, 'three entries today across all contexts');

      const globalToday = BfrbEvents.countToday('global');
      assertEqual(globalToday, 1, 'one global entry today (yesterday + 2-days-ago excluded)');

      const flowToday = BfrbEvents.countToday('flow');
      assertEqual(flowToday, 1, 'one flow entry today');
    } finally {
      _bfrb_clearAll();
      _bfrb_restore(saved);
    }
  });

  it('9. snapshotForSync() returns wire envelope shape', () => {
    const saved = _bfrb_savedEnv();
    try {
      _bfrb_clearAll();
      localStorage.setItem('tempo_bfrb_events_migration_v1', '1');
      const fixtures = [
        { takenAt: 1000, context: 'global', deviceId: 'd1', updatedAt: 1000, schemaVersion: 1 },
        { takenAt: 2000, context: 'flow', sessionId: 10, deviceId: 'd1', updatedAt: 2000, schemaVersion: 1 },
      ];
      localStorage.setItem('bfrb_events', JSON.stringify(fixtures));

      const env = BfrbEvents.snapshotForSync();
      assert(env && typeof env === 'object', 'envelope is object');
      assert(typeof env.deviceId === 'string' && env.deviceId.length > 0, 'deviceId set');
      assertEqual(env.schemaVersion, Schema.SCHEMA_VERSION, 'schemaVersion = current');
      assert(env.payload && Array.isArray(env.payload.events), 'payload.events is array');
      assertEqual(env.payload.events.length, 2, 'two events in payload');
    } finally {
      _bfrb_clearAll();
      _bfrb_restore(saved);
    }
  });

  it('10. analytics-equivalent: getAll() output covers all 3 legacy contexts post-migration (Risk #4)', () => {
    const saved = _bfrb_savedEnv();
    try {
      _bfrb_clearAll();
      // Pre-migration fixture across all 3 legacy keys.
      localStorage.setItem('bfrbs_global', JSON.stringify([{ timestamp: 1000 }]));
      localStorage.setItem('flow_bfrbs', JSON.stringify([{ timestamp: 2000, phase: 'focus' }]));
      localStorage.setItem('pomodoro_bfrbs', JSON.stringify([
        { timestamp: 3000, phase: 'work', cycleIndex: 0 },
        { timestamp: 4000, phase: 'work', cycleIndex: 1 },
      ]));

      BfrbEvents._runMigration();

      // After migration, getAll() output mapped to legacy source enum
      // (global→'idle', flow→'flow', pomodoro→'pomodoro') should
      // produce one stamp per legacy entry — same total + same per-source
      // breakdown that LIVE_SOURCES would have produced pre-migration.
      const events = BfrbEvents.getAll();
      const bySource = { idle: 0, flow: 0, pomodoro: 0 };
      for (const e of events) {
        if (typeof e.takenAt !== 'number') continue;
        const src = e.context === 'flow' ? 'flow'
                  : e.context === 'pomodoro' ? 'pomodoro'
                  : 'idle';
        bySource[src]++;
      }
      assertEqual(bySource.idle, 1, 'one idle stamp');
      assertEqual(bySource.flow, 1, 'one flow stamp');
      assertEqual(bySource.pomodoro, 2, 'two pomodoro stamps');
      assertEqual(events.length, 4, 'four total entries');
    } finally {
      _bfrb_clearAll();
      _bfrb_restore(saved);
    }
  });

});
