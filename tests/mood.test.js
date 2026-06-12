// Life-OS Phase 3 — Mood module tests (the mood_events 7th synced store).
//
// Coverage (mirrors bfrb-events.test.js cases 5-9; Mood has NO migration —
// the migration cases 1-4 from the bfrb suite have no analogue here):
//   1.  log() stamps deviceId + updatedAt + schemaVersion via Schema.stamp.
//   2.  log() honors F13 write gate.
//   3.  log() rejects missing / out-of-range / non-numeric valence.
//   4.  log() rounds a float valence to the nearest anchor.
//   5.  log() clamps tags — ≤3, trimmed, length-capped, invalid dropped.
//   6.  log() trims + length-caps note; empty/whitespace omitted.
//   7.  log() honors an explicit `at` override (deferred-commit flow).
//   8.  log() defaults context to 'global'; accepts flow/pomodoro only.
//   9.  log() F19a — refuses a future-schema entry.
//   10. energy is reserved: accepted when valid, never set otherwise.
//   11. getAll() returns a defensive copy.
//   12. snapshotForSync() returns the wire envelope shape.
//   13. _reconcileWriteRaw writes verbatim (no stamping, no gate).
//   14. dedup signature + doc id (deviceId, at) unchanged by optional fields.

// ── Shared save/restore + install helpers ─────────────────────────────

function _mood_savedEnv() {
  return {
    sync_flag_storage: localStorage.getItem('tempo_sync_enabled'),
    flag_isEnabled: (typeof SyncFlag !== 'undefined') ? SyncFlag.isEnabled : undefined,
    syncState: window.SyncState,
  };
}

function _mood_restore(saved) {
  if (typeof SyncFlag !== 'undefined' && saved.flag_isEnabled !== undefined) {
    SyncFlag.isEnabled = saved.flag_isEnabled;
  }
  if (saved.syncState === undefined) delete window.SyncState;
  else window.SyncState = saved.syncState;
  if (saved.sync_flag_storage === null) localStorage.removeItem('tempo_sync_enabled');
  else localStorage.setItem('tempo_sync_enabled', saved.sync_flag_storage);
}

// Clear every key Mood touches (no migration marker — mood starts fresh).
function _mood_clearAll() {
  try { localStorage.removeItem('mood_events'); } catch (_) {}
}

// The dedup signature + derived Firestore doc id exactly as sync-merge-mood
// computes them (js/sync-merge-mood.js _sigOf/_entryIdOf — field is `at`).
function _mood_sig(e) {
  const dev = (typeof e.deviceId === 'string') ? e.deviceId : '∅';
  return dev + '@' + e.at;
}
function _mood_docId(e) {
  const dev = (typeof e.deviceId === 'string' && e.deviceId) ? e.deviceId : 'no-device';
  return dev + '-' + e.at;
}

// ────────────────────────────────────────────────────────────────────────
// Test cases — Mood module API
// ────────────────────────────────────────────────────────────────────────

describe('Mood — log() validation + stamping', () => {

  it('1. log() stamps deviceId + updatedAt + schemaVersion via Schema.stamp', () => {
    const saved = _mood_savedEnv();
    try {
      _mood_clearAll();
      localStorage.removeItem('tempo_sync_enabled');

      const result = Mood.log({ valence: 4 });
      assert(result, 'log returned entry');
      assert(typeof result.at === 'number', 'at set');
      assertEqual(result.valence, 4, 'valence preserved');
      assertEqual(result.context, 'global', 'context defaults to global');
      assert(typeof result.deviceId === 'string' && result.deviceId.length > 0, 'deviceId stamped');
      assert(typeof result.updatedAt === 'number', 'updatedAt stamped');
      assertEqual(result.schemaVersion, Schema.SCHEMA_VERSION, 'schemaVersion stamped via Schema.stamp');

      const persisted = JSON.parse(localStorage.getItem('mood_events'));
      assertEqual(persisted.length, 1, 'one entry persisted');
      assertEqual(persisted[0].schemaVersion, Schema.SCHEMA_VERSION, 'persisted entry stamped');
    } finally {
      _mood_clearAll();
      _mood_restore(saved);
    }
  });

  it('2. log() honors F13 write gate', () => {
    const saved = _mood_savedEnv();
    try {
      _mood_clearAll();

      // Mock: sync enabled + canWrite() === false → blocks write.
      const prevIsEnabled = SyncFlag.isEnabled;
      SyncFlag.isEnabled = () => true;
      window.SyncState = {
        canWrite: () => false,
        get: () => 'hydrating',
        STORAGE_KEY: 'tempo_sync_state',
      };

      try {
        const blocked = Mood.log({ valence: 3 });
        assertEqual(blocked, null, 'log returned null when canWrite=false');
        const after = localStorage.getItem('mood_events');
        assert(!after || JSON.parse(after).length === 0, 'no entry written');

        // Flip canWrite to true and retry.
        window.SyncState.canWrite = () => true;
        window.SyncState.get = () => 'ready';
        const allowed = Mood.log({ valence: 3 });
        assert(allowed, 'log succeeded when canWrite=true');
        const persisted = JSON.parse(localStorage.getItem('mood_events'));
        assertEqual(persisted.length, 1, 'one entry written after gate released');
      } finally {
        SyncFlag.isEnabled = prevIsEnabled;
      }
    } finally {
      _mood_clearAll();
      _mood_restore(saved);
    }
  });

  it('3. log() rejects missing / out-of-range / non-numeric valence', () => {
    const saved = _mood_savedEnv();
    try {
      _mood_clearAll();
      localStorage.removeItem('tempo_sync_enabled');
      [undefined, null, 0, 6, -1, NaN, Infinity, '3'].forEach(bad => {
        const e = Mood.log({ valence: bad });
        assertEqual(e, null, 'log refused for valence=' + String(bad));
      });
      const after = localStorage.getItem('mood_events');
      assert(!after || JSON.parse(after).length === 0, 'nothing persisted');
      // Boundary values survive.
      assertEqual(Mood.log({ valence: 1 }).valence, 1, 'valence 1 accepted');
      assertEqual(Mood.log({ valence: 5 }).valence, 5, 'valence 5 accepted');
    } finally {
      _mood_clearAll();
      _mood_restore(saved);
    }
  });

  it('4. log() rounds a float valence to the nearest anchor', () => {
    const saved = _mood_savedEnv();
    try {
      _mood_clearAll();
      localStorage.removeItem('tempo_sync_enabled');
      assertEqual(Mood.log({ valence: 2.6 }).valence, 3, '2.6 rounds to 3');
      assertEqual(Mood.log({ valence: 4.4 }).valence, 4, '4.4 rounds to 4');
      // A float that rounds OUT of range still refuses.
      assertEqual(Mood.log({ valence: 5.6 }), null, '5.6 rounds to 6 → refused');
      assertEqual(Mood.log({ valence: 0.4 }), null, '0.4 rounds to 0 → refused');
    } finally {
      _mood_clearAll();
      _mood_restore(saved);
    }
  });

  it('5. log() clamps tags — ≤3, trimmed, length-capped, invalid dropped', () => {
    const saved = _mood_savedEnv();
    try {
      _mood_clearAll();
      localStorage.removeItem('tempo_sync_enabled');

      // Trims + drops invalid members + caps at 3.
      const e = Mood.log({ valence: 3, tags: ['  calm ', '', 42, 'tired', 'stressed', 'anxious'] });
      assert(e, 'log returned entry');
      assertEqual(e.tags.length, 3, 'capped at 3 tags');
      assertEqual(e.tags[0], 'calm', 'first tag trimmed');
      assertEqual(e.tags[1], 'tired', 'invalid members dropped, valid kept in order');
      assertEqual(e.tags[2], 'stressed', 'third valid tag kept');

      // Length cap per tag (mirrors triggerZone's 40-char cap).
      const long = 'x'.repeat(80);
      assertEqual(Mood.log({ valence: 3, tags: [long] }).tags[0].length, 40, 'tag length-capped at 40');

      // All-invalid / empty array / non-array → field omitted entirely.
      assert(!('tags' in Mood.log({ valence: 3, tags: ['  ', ''] })), 'all-invalid tags omitted');
      assert(!('tags' in Mood.log({ valence: 3, tags: [] })), 'empty array omitted');
      assert(!('tags' in Mood.log({ valence: 3, tags: 'calm' })), 'non-array omitted');
      assert(!('tags' in Mood.log({ valence: 3 })), 'absent tags omitted');
    } finally {
      _mood_clearAll();
      _mood_restore(saved);
    }
  });

  it('6. log() trims + length-caps note; empty/whitespace omitted', () => {
    const saved = _mood_savedEnv();
    try {
      _mood_clearAll();
      localStorage.removeItem('tempo_sync_enabled');
      assertEqual(Mood.log({ valence: 3, note: '  long day ' }).note, 'long day', 'note trimmed');
      const long = 'n'.repeat(400);
      assertEqual(Mood.log({ valence: 3, note: long }).note.length, 280, 'note capped at 280');
      assert(!('note' in Mood.log({ valence: 3, note: '   ' })), 'whitespace note omitted');
      assert(!('note' in Mood.log({ valence: 3, note: '' })), 'empty note omitted');
      assert(!('note' in Mood.log({ valence: 3, note: 42 })), 'non-string note omitted');
      assert(!('note' in Mood.log({ valence: 3 })), 'absent note omitted');
    } finally {
      _mood_clearAll();
      _mood_restore(saved);
    }
  });

  it('7. log() honors an explicit `at` override (deferred-commit flow)', () => {
    const saved = _mood_savedEnv();
    try {
      _mood_clearAll();
      localStorage.removeItem('tempo_sync_enabled');
      const t = 1700000000000;
      assertEqual(Mood.log({ valence: 2, at: t }).at, t, 'override applied');
      // invalid overrides fall back to Date.now()
      const before = Date.now();
      const e = Mood.log({ valence: 2, at: 'nope' });
      assert(e.at >= before, 'invalid override falls back to now');
    } finally {
      _mood_clearAll();
      _mood_restore(saved);
    }
  });

  it('8. log() defaults context to global; accepts flow/pomodoro only', () => {
    const saved = _mood_savedEnv();
    try {
      _mood_clearAll();
      localStorage.removeItem('tempo_sync_enabled');
      assertEqual(Mood.log({ valence: 3 }).context, 'global', 'absent → global');
      assertEqual(Mood.log({ valence: 3, context: 'flow' }).context, 'flow', 'flow accepted');
      assertEqual(Mood.log({ valence: 3, context: 'pomodoro' }).context, 'pomodoro', 'pomodoro accepted');
      assertEqual(Mood.log({ valence: 3, context: 'bogus' }).context, 'global', 'unknown → global');
    } finally {
      _mood_clearAll();
      _mood_restore(saved);
    }
  });

  it('9. log() F19a — refuses a future-schema entry', () => {
    const saved = _mood_savedEnv();
    const prevIsFuture = Schema.isFutureRecord;
    try {
      _mood_clearAll();
      localStorage.removeItem('tempo_sync_enabled');
      // Force the F19a predicate to flag the candidate — the gate is
      // belt-and-suspenders (stamp() assigns the current version) so this
      // is the only way to exercise the refusal branch deterministically.
      Schema.isFutureRecord = () => true;
      const refused = Mood.log({ valence: 3 });
      assertEqual(refused, null, 'log refused the future-schema entry');
      const after = localStorage.getItem('mood_events');
      assert(!after || JSON.parse(after).length === 0, 'nothing persisted');
    } finally {
      Schema.isFutureRecord = prevIsFuture;
      _mood_clearAll();
      _mood_restore(saved);
    }
  });

  it('10. energy is reserved — accepted when valid, never set otherwise', () => {
    const saved = _mood_savedEnv();
    try {
      _mood_clearAll();
      localStorage.removeItem('tempo_sync_enabled');
      // Never set when absent (the v1 contract: accept-never-set).
      assert(!('energy' in Mood.log({ valence: 3 })), 'no energy key when absent');
      // Accepted when a (future) caller provides a valid value.
      assertEqual(Mood.log({ valence: 3, energy: 4 }).energy, 4, 'valid energy accepted');
      assertEqual(Mood.log({ valence: 3, energy: 2.6 }).energy, 3, 'roundable float accepted');
      // Invalid values are dropped — never refuse the whole log over the
      // reserved field.
      [0, 6, NaN, '3', null].forEach(bad => {
        const e = Mood.log({ valence: 3, energy: bad });
        assert(e, 'log still succeeds for energy=' + String(bad));
        assert(!('energy' in e), 'energy omitted for ' + String(bad));
      });
    } finally {
      _mood_clearAll();
      _mood_restore(saved);
    }
  });

});

describe('Mood — getAll / snapshotForSync / _reconcileWriteRaw', () => {

  it('11. getAll() returns a defensive copy', () => {
    const saved = _mood_savedEnv();
    try {
      _mood_clearAll();
      const fixtures = [
        { at: 1000, valence: 3, context: 'global', deviceId: 'd1', updatedAt: 1000, schemaVersion: 1 },
        { at: 2000, valence: 4, context: 'flow', deviceId: 'd1', updatedAt: 2000, schemaVersion: 1 },
      ];
      localStorage.setItem('mood_events', JSON.stringify(fixtures));

      const all = Mood.getAll();
      assertEqual(all.length, 2, 'two entries read');
      // Mutate the returned array — the store must not change.
      all.push({ at: 9999, valence: 1 });
      all[0].valence = 99;
      const reread = Mood.getAll();
      assertEqual(reread.length, 2, 'store unchanged by array mutation');
      assertEqual(reread[0].valence, 3, 'store unchanged by entry mutation');
    } finally {
      _mood_clearAll();
      _mood_restore(saved);
    }
  });

  it('12. snapshotForSync() returns the wire envelope shape', () => {
    const saved = _mood_savedEnv();
    try {
      _mood_clearAll();
      const fixtures = [
        { at: 1000, valence: 3, context: 'global', deviceId: 'd1', updatedAt: 1000, schemaVersion: 1 },
        { at: 2000, valence: 5, context: 'flow', tags: ['calm'], deviceId: 'd1', updatedAt: 2000, schemaVersion: 1 },
      ];
      localStorage.setItem('mood_events', JSON.stringify(fixtures));

      const env = Mood.snapshotForSync();
      assert(env && typeof env === 'object', 'envelope is object');
      assert(typeof env.deviceId === 'string' && env.deviceId.length > 0, 'deviceId set');
      assertEqual(env.schemaVersion, Schema.SCHEMA_VERSION, 'schemaVersion = current');
      assert(env.payload && Array.isArray(env.payload.events), 'payload.events is array');
      assertEqual(env.payload.events.length, 2, 'two events in payload');
    } finally {
      _mood_clearAll();
      _mood_restore(saved);
    }
  });

  it('13. _reconcileWriteRaw writes verbatim — no stamping, no gate', () => {
    const saved = _mood_savedEnv();
    try {
      _mood_clearAll();
      // Closed F13 gate must NOT block the raw reconcile hook.
      const prevIsEnabled = SyncFlag.isEnabled;
      SyncFlag.isEnabled = () => true;
      window.SyncState = { canWrite: () => false, get: () => 'hydrating' };
      try {
        const events = [
          { at: 5000, valence: 2, context: 'global', deviceId: 'phone-2', updatedAt: 5000, schemaVersion: 1 },
        ];
        Mood._reconcileWriteRaw(events);
        const persisted = JSON.parse(localStorage.getItem('mood_events'));
        assertEqual(persisted.length, 1, 'raw write landed under closed gate');
        assertEqual(persisted[0].deviceId, 'phone-2', 'deviceId NOT re-stamped');
        assertEqual(persisted[0].updatedAt, 5000, 'updatedAt NOT re-stamped');
        // Non-array input normalizes to empty store.
        Mood._reconcileWriteRaw('garbage');
        assertEqual(JSON.parse(localStorage.getItem('mood_events')).length, 0,
          'non-array input writes empty store');
      } finally {
        SyncFlag.isEnabled = prevIsEnabled;
      }
    } finally {
      _mood_clearAll();
      _mood_restore(saved);
    }
  });

  it('14. dedup signature + doc id are byte-identical with vs without the optional fields', () => {
    const saved = _mood_savedEnv();
    try {
      _mood_clearAll();
      localStorage.removeItem('tempo_sync_enabled');
      const t = 1700000000123;
      const bare = Mood.log({ valence: 3, at: t });
      _mood_clearAll();
      const rich = Mood.log({ valence: 3, at: t, tags: ['calm', 'tired'], note: 'steady' });
      // Same device + same `at` → identical merge key, regardless of the
      // optional fields. This is the invariant that keeps tags/note from
      // changing how sync-merge-mood dedups (and why the capture UI folds
      // everything into ONE log call).
      assertEqual(_mood_sig(rich), _mood_sig(bare), 'dedup signature unchanged');
      assertEqual(_mood_docId(rich), _mood_docId(bare), 'derived doc id unchanged');
    } finally {
      _mood_clearAll();
      _mood_restore(saved);
    }
  });

});
