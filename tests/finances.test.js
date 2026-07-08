// Life-OS Phase 5 — Finances module tests (the finances 8th synced store).
//
// Coverage (mirrors mood.test.js cases, adapted to the per-month-KEYED
// editable store — finances has NO migration and NO append-only array):
//   1.  setMonth() upserts a new month + stamps deviceId/updatedAt/schemaVersion.
//   2.  setMonth() merges a PARTIAL patch into the existing month (LWW field-preserve).
//   3.  setMonth() same-month re-entry overwrites (whole-record LWW newer wins).
//   4.  setMonth() rejects a malformed month key.
//   5.  setMonth() copies ONLY recognized metric fields; ignores junk + non-finite.
//   6.  getMonth() returns a defensive copy; getAll() returns the whole map.
//   7.  snapshotForSync() returns the wire envelope shape { payload: { finances } }.
//   8.  setMonth() honors F13 write gate.
//   9.  setMonth() F19a — refuses a future-schema record.
//   10. load-time F19a — a future-schema month on disk is dropped from the view.
//   11. _reconcileWriteRaw writes verbatim (no stamping, no gate).
//
// Every top-level identifier is prefixed `_fin_` — the engine tests share
// ONE global scope, so collisions break the suite.

// ── Shared save/restore + install helpers ─────────────────────────────

function _fin_savedEnv() {
  return {
    sync_flag_storage: localStorage.getItem('tempo_sync_enabled'),
    flag_isEnabled: (typeof SyncFlag !== 'undefined') ? SyncFlag.isEnabled : undefined,
    syncState: window.SyncState,
    finances: localStorage.getItem('finances'),
  };
}

function _fin_restore(saved) {
  if (typeof SyncFlag !== 'undefined' && saved.flag_isEnabled !== undefined) {
    SyncFlag.isEnabled = saved.flag_isEnabled;
  }
  if (saved.syncState === undefined) delete window.SyncState;
  else window.SyncState = saved.syncState;
  if (saved.sync_flag_storage === null) localStorage.removeItem('tempo_sync_enabled');
  else localStorage.setItem('tempo_sync_enabled', saved.sync_flag_storage);
  if (saved.finances === null) localStorage.removeItem('finances');
  else localStorage.setItem('finances', saved.finances);
}

function _fin_clearAll() {
  try { localStorage.removeItem('finances'); } catch (_) {}
}

// ────────────────────────────────────────────────────────────────────────
// Test cases — Finances module API
// ────────────────────────────────────────────────────────────────────────

describe('Finances — setMonth() upsert + stamping', () => {

  it('1. setMonth() upserts a new month + stamps deviceId + updatedAt + schemaVersion', () => {
    const saved = _fin_savedEnv();
    try {
      _fin_clearAll();
      localStorage.removeItem('tempo_sync_enabled');

      const result = Finances.setMonth('2026-07', { savingsRate: 18, creditScore: 760 });
      assert(result, 'setMonth returned record');
      assertEqual(result.month, '2026-07', 'month preserved');
      assertEqual(result.savingsRate, 18, 'savingsRate preserved');
      assertEqual(result.creditScore, 760, 'creditScore preserved');
      assert(typeof result.deviceId === 'string' && result.deviceId.length > 0, 'deviceId stamped');
      assert(typeof result.updatedAt === 'number', 'updatedAt stamped');
      assertEqual(result.schemaVersion, Schema.SCHEMA_VERSION, 'schemaVersion stamped via Schema.stamp');

      const persisted = JSON.parse(localStorage.getItem('finances'));
      assert(persisted && persisted['2026-07'], 'one month persisted under its key');
      assertEqual(persisted['2026-07'].schemaVersion, Schema.SCHEMA_VERSION, 'persisted record stamped');
      assertEqual(Object.keys(persisted).length, 1, 'exactly one month key');
    } finally {
      _fin_clearAll();
      _fin_restore(saved);
    }
  });

  it('2. setMonth() merges a partial patch into the existing month (field-preserve)', () => {
    const saved = _fin_savedEnv();
    try {
      _fin_clearAll();
      localStorage.removeItem('tempo_sync_enabled');

      Finances.setMonth('2026-07', { savingsRate: 18, creditScore: 760 });
      // Patch ONLY the credit score — savingsRate must survive.
      const patched = Finances.setMonth('2026-07', { creditScore: 780 });
      assertEqual(patched.creditScore, 780, 'creditScore updated');
      assertEqual(patched.savingsRate, 18, 'savingsRate preserved across partial patch');

      // Add a third metric — the first two survive.
      const patched2 = Finances.setMonth('2026-07', { debtRemaining: 5000 });
      assertEqual(patched2.debtRemaining, 5000, 'debtRemaining added');
      assertEqual(patched2.creditScore, 780, 'creditScore preserved');
      assertEqual(patched2.savingsRate, 18, 'savingsRate preserved');

      const persisted = JSON.parse(localStorage.getItem('finances'));
      assertEqual(Object.keys(persisted).length, 1, 'still one month key (upsert, not append)');
    } finally {
      _fin_clearAll();
      _fin_restore(saved);
    }
  });

  it('3. setMonth() same-month re-entry overwrites (whole-record LWW newer wins)', () => {
    const saved = _fin_savedEnv();
    try {
      _fin_clearAll();
      localStorage.removeItem('tempo_sync_enabled');

      const first = Finances.setMonth('2026-07', { savingsRate: 10 });
      const firstStamp = first.updatedAt;
      // Re-enter the SAME month with a corrected number — the record's
      // updatedAt advances (newer wins in the eventual merge).
      const second = Finances.setMonth('2026-07', { savingsRate: 22 });
      assertEqual(second.savingsRate, 22, 'corrected value replaces the old one');
      assert(second.updatedAt >= firstStamp, 'updatedAt advanced (or equal) on re-entry');

      const persisted = JSON.parse(localStorage.getItem('finances'));
      assertEqual(persisted['2026-07'].savingsRate, 22, 'persisted month reflects the correction');
    } finally {
      _fin_clearAll();
      _fin_restore(saved);
    }
  });

  it('4. setMonth() rejects a malformed month key', () => {
    const saved = _fin_savedEnv();
    try {
      _fin_clearAll();
      localStorage.removeItem('tempo_sync_enabled');
      ['2026', '2026-7', '2026-13', '2026-00', '26-07', 'nope', '', null, undefined, 202607, '2026-07-01']
        .forEach(bad => {
          const r = Finances.setMonth(bad, { savingsRate: 5 });
          assertEqual(r, null, 'setMonth refused for month=' + String(bad));
        });
      const after = localStorage.getItem('finances');
      assert(!after || Object.keys(JSON.parse(after)).length === 0, 'nothing persisted');
      // Boundary months survive.
      assertEqual(Finances.setMonth('2026-01', { savingsRate: 5 }).month, '2026-01', '01 accepted');
      _fin_clearAll();
      assertEqual(Finances.setMonth('2026-12', { savingsRate: 5 }).month, '2026-12', '12 accepted');
    } finally {
      _fin_clearAll();
      _fin_restore(saved);
    }
  });

  it('5. setMonth() copies only recognized metric fields; ignores junk + non-finite', () => {
    const saved = _fin_savedEnv();
    try {
      _fin_clearAll();
      localStorage.removeItem('tempo_sync_enabled');

      const r = Finances.setMonth('2026-07', {
        savingsRate: 18,
        netWorth: -1200,          // negative is valid for net worth
        bogusField: 'ignore me',  // junk — must not land
        creditScore: NaN,         // non-finite — must not land
        debtRemaining: Infinity,  // non-finite — must not land
      });
      assertEqual(r.savingsRate, 18, 'savingsRate landed');
      assertEqual(r.netWorth, -1200, 'negative netWorth landed');
      assert(!('bogusField' in r), 'junk field dropped');
      assert(!('creditScore' in r), 'NaN creditScore dropped');
      assert(!('debtRemaining' in r), 'Infinity debtRemaining dropped');
      // A patch with no valid metric fields still upserts the month record
      // (stamped envelope), just carrying no metrics.
      _fin_clearAll();
      const empty = Finances.setMonth('2026-08', { onlyJunk: true });
      assert(empty, 'empty-metrics patch still upserts');
      assertEqual(empty.month, '2026-08', 'month key present');
      assert(!('onlyJunk' in empty), 'junk not persisted');
    } finally {
      _fin_clearAll();
      _fin_restore(saved);
    }
  });

  it('8. setMonth() honors F13 write gate', () => {
    const saved = _fin_savedEnv();
    try {
      _fin_clearAll();

      const prevIsEnabled = SyncFlag.isEnabled;
      SyncFlag.isEnabled = () => true;
      window.SyncState = {
        canWrite: () => false,
        get: () => 'hydrating',
        STORAGE_KEY: 'tempo_sync_state',
      };

      try {
        const blocked = Finances.setMonth('2026-07', { savingsRate: 18 });
        assertEqual(blocked, null, 'setMonth returned null when canWrite=false');
        const after = localStorage.getItem('finances');
        assert(!after || Object.keys(JSON.parse(after)).length === 0, 'no record written');

        // Flip canWrite to true and retry.
        window.SyncState.canWrite = () => true;
        window.SyncState.get = () => 'ready';
        const allowed = Finances.setMonth('2026-07', { savingsRate: 18 });
        assert(allowed, 'setMonth succeeded when canWrite=true');
        const persisted = JSON.parse(localStorage.getItem('finances'));
        assertEqual(Object.keys(persisted).length, 1, 'one record written after gate released');
      } finally {
        SyncFlag.isEnabled = prevIsEnabled;
      }
    } finally {
      _fin_clearAll();
      _fin_restore(saved);
    }
  });

  it('9. setMonth() F19a — refuses a future-schema record', () => {
    const saved = _fin_savedEnv();
    const prevIsFuture = Schema.isFutureRecord;
    try {
      _fin_clearAll();
      localStorage.removeItem('tempo_sync_enabled');
      // Force the F19a predicate to flag the candidate — the gate is
      // belt-and-suspenders (stamp() assigns the current version) so this
      // is the only way to exercise the refusal branch deterministically.
      Schema.isFutureRecord = () => true;
      const refused = Finances.setMonth('2026-07', { savingsRate: 18 });
      assertEqual(refused, null, 'setMonth refused the future-schema record');
      const after = localStorage.getItem('finances');
      assert(!after || Object.keys(JSON.parse(after)).length === 0, 'nothing persisted');
    } finally {
      Schema.isFutureRecord = prevIsFuture;
      _fin_clearAll();
      _fin_restore(saved);
    }
  });

  it('10. load-time F19a — a future-schema month on disk is dropped from the view', () => {
    const saved = _fin_savedEnv();
    try {
      _fin_clearAll();
      localStorage.removeItem('tempo_sync_enabled');
      // Seed a mix: one normal month + one future-schema month directly on disk.
      const onDisk = {
        '2026-06': { month: '2026-06', savingsRate: 15, deviceId: 'd1', updatedAt: 1000, schemaVersion: 1 },
        '2026-07': { month: '2026-07', savingsRate: 20, deviceId: 'd1', updatedAt: 2000, schemaVersion: 999 },
      };
      localStorage.setItem('finances', JSON.stringify(onDisk));

      const all = Finances.getAll();
      assert(all['2026-06'], 'normal month present in the view');
      assert(!all['2026-07'], 'future-schema month dropped from the view');
      assertEqual(Finances.getMonth('2026-07'), null, 'getMonth also drops the future record');

      // The future record MUST survive on disk untouched (byte-clean for a
      // future client) — getAll() must NOT have rewritten the store.
      const stillOnDisk = JSON.parse(localStorage.getItem('finances'));
      assert(stillOnDisk['2026-07'], 'future-schema month still on disk (not stripped)');
      assertEqual(stillOnDisk['2026-07'].schemaVersion, 999, 'future schemaVersion intact on disk');
    } finally {
      _fin_clearAll();
      _fin_restore(saved);
    }
  });

});

describe('Finances — getMonth / getAll / snapshotForSync / _reconcileWriteRaw', () => {

  it('6. getMonth() + getAll() return defensive copies', () => {
    const saved = _fin_savedEnv();
    try {
      _fin_clearAll();
      const fixtures = {
        '2026-06': { month: '2026-06', savingsRate: 15, deviceId: 'd1', updatedAt: 1000, schemaVersion: 1 },
        '2026-07': { month: '2026-07', creditScore: 760, deviceId: 'd1', updatedAt: 2000, schemaVersion: 1 },
      };
      localStorage.setItem('finances', JSON.stringify(fixtures));

      const one = Finances.getMonth('2026-06');
      assertEqual(one.savingsRate, 15, 'getMonth reads the record');
      one.savingsRate = 99; // mutate the copy
      assertEqual(Finances.getMonth('2026-06').savingsRate, 15, 'store unchanged by copy mutation');
      assertEqual(Finances.getMonth('2099-01'), null, 'absent month → null');

      const all = Finances.getAll();
      assertEqual(Object.keys(all).length, 2, 'two months read');
      all['2026-06'].savingsRate = 42;
      all['2026-08'] = { month: '2026-08' };
      const reread = Finances.getAll();
      assertEqual(Object.keys(reread).length, 2, 'store unchanged by map mutation');
      assertEqual(reread['2026-06'].savingsRate, 15, 'store unchanged by nested mutation');
    } finally {
      _fin_clearAll();
      _fin_restore(saved);
    }
  });

  it('7. snapshotForSync() returns the wire envelope shape', () => {
    const saved = _fin_savedEnv();
    try {
      _fin_clearAll();
      const fixtures = {
        '2026-06': { month: '2026-06', savingsRate: 15, deviceId: 'd1', updatedAt: 1000, schemaVersion: 1 },
        '2026-07': { month: '2026-07', creditScore: 760, deviceId: 'd1', updatedAt: 2000, schemaVersion: 1 },
      };
      localStorage.setItem('finances', JSON.stringify(fixtures));

      const env = Finances.snapshotForSync();
      assert(env && typeof env === 'object', 'envelope is object');
      assert(typeof env.deviceId === 'string' && env.deviceId.length > 0, 'deviceId set');
      assertEqual(env.schemaVersion, Schema.SCHEMA_VERSION, 'schemaVersion = current');
      assert(env.payload && env.payload.finances && typeof env.payload.finances === 'object',
        'payload.finances is an object');
      assert(!Array.isArray(env.payload.finances), 'payload.finances is a MAP, not an array');
      assertEqual(Object.keys(env.payload.finances).length, 2, 'two months in payload');
      assertEqual(env.payload.finances['2026-07'].creditScore, 760, 'month record carried in payload');
    } finally {
      _fin_clearAll();
      _fin_restore(saved);
    }
  });

  it('11. _reconcileWriteRaw writes verbatim — no stamping, no gate', () => {
    const saved = _fin_savedEnv();
    try {
      _fin_clearAll();
      // Closed F13 gate must NOT block the raw reconcile hook.
      const prevIsEnabled = SyncFlag.isEnabled;
      SyncFlag.isEnabled = () => true;
      window.SyncState = { canWrite: () => false, get: () => 'hydrating' };
      try {
        const map = {
          '2026-05': { month: '2026-05', savingsRate: 12, deviceId: 'phone-2', updatedAt: 5000, schemaVersion: 1 },
        };
        Finances._reconcileWriteRaw(map);
        const persisted = JSON.parse(localStorage.getItem('finances'));
        assertEqual(Object.keys(persisted).length, 1, 'raw write landed under closed gate');
        assertEqual(persisted['2026-05'].deviceId, 'phone-2', 'deviceId NOT re-stamped');
        assertEqual(persisted['2026-05'].updatedAt, 5000, 'updatedAt NOT re-stamped');
        // Non-object input normalizes to an empty map.
        Finances._reconcileWriteRaw('garbage');
        assertEqual(Object.keys(JSON.parse(localStorage.getItem('finances'))).length, 0,
          'non-object input writes empty map');
      } finally {
        SyncFlag.isEnabled = prevIsEnabled;
      }
    } finally {
      _fin_clearAll();
      _fin_restore(saved);
    }
  });

});
