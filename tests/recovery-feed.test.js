// Tests for RecoveryFeed — the read-only consumer of mart_recovery_state
// pushed to Firestore by personal-health-elt. Same testing pattern as
// analytics.test.js / rhythm.test.js: stub globals per-case, exercise the
// public surface, restore at end.

// recovery-feed.js references SyncFlag / SyncAuth / SyncFirestore / SyncEngine
// LEXICALLY — they are top-level `const` singletons (all loaded in
// tests/index.html), NOT window properties. A lexical `const` reference never
// reads `window.<Name>`, so the only way to inject a fake is to overwrite the
// real object's METHODS (the same idiom sync-hydrate.test.js uses for
// SyncFirestore.getCollection). Replacing window.SyncFlag etc. — the original
// approach here — silently did nothing: the module kept reading the real
// modules (flag off by default → gate closed → refresh() returned null), which
// is exactly why the four happy-path cases NPE'd on `out.day` / `cached.rows`.
// Save the real methods now; restore them after the suite.
const _rfOrig = {
  flagIsEnabled: SyncFlag.isEnabled,
  authGetCurrentUser: SyncAuth.getCurrentUser,
  fsGetDoc: SyncFirestore.getDoc,
  engineOn: SyncEngine.on,
  engineEmit: SyncEngine.emit,
};

function rfRestoreGlobals() {
  SyncFlag.isEnabled = _rfOrig.flagIsEnabled;
  SyncAuth.getCurrentUser = _rfOrig.authGetCurrentUser;
  SyncFirestore.getDoc = _rfOrig.fsGetDoc;
  SyncEngine.on = _rfOrig.engineOn;
  SyncEngine.emit = _rfOrig.engineEmit;
}

function rfClearCache() {
  localStorage.removeItem('tempo_recovery_state_latest');
  localStorage.removeItem('tempo_recovery_state_history');
}

function rfStubGate({ flagOn = true, uid = 'user-abc', firestore = null } = {}) {
  // Overwrite methods on the REAL const singletons (see note above).
  SyncFlag.isEnabled = () => flagOn;
  SyncAuth.getCurrentUser = () => (uid ? { uid } : null);
  const fs = firestore || { getDoc: async () => ({ id: 'missing', data: null }) };
  SyncFirestore.getDoc = fs.getDoc;
  // Bus stub — accept .on/.emit registrations without doing anything.
  SyncEngine.on = () => {};
  SyncEngine.emit = () => {};
}

function rfFirestoreReturning(map) {
  return {
    getDoc: async (path) => {
      if (map[path] !== undefined) return { id: path.split('/').pop(), data: map[path] };
      return { id: 'missing', data: null };
    },
  };
}

describe('RecoveryFeed.getLatest — cache reads', () => {
  it('returns null when nothing is cached', () => {
    rfClearCache();
    assertEqual(RecoveryFeed.getLatest(), null);
  });

  it('returns the cached row when present', () => {
    rfClearCache();
    const row = { day: '2026-05-28', recovery_signal: 'well_recovered', acwr: 1.05, hrv_ms: 68 };
    localStorage.setItem('tempo_recovery_state_latest', JSON.stringify(row));
    const out = RecoveryFeed.getLatest();
    assertEqual(out.day, '2026-05-28');
    assertEqual(out.recovery_signal, 'well_recovered');
    assertEqual(out.acwr, 1.05);
  });

  it('returns null on malformed cache (does not throw)', () => {
    rfClearCache();
    localStorage.setItem('tempo_recovery_state_latest', '{{not json');
    assertEqual(RecoveryFeed.getLatest(), null);
  });
});

describe('RecoveryFeed.getHistory — cache reads', () => {
  it('returns null when nothing is cached', () => {
    rfClearCache();
    assertEqual(RecoveryFeed.getHistory(), null);
  });

  it('returns the cached history payload', () => {
    rfClearCache();
    const history = { rows: [{ day: '2026-05-27' }, { day: '2026-05-28' }] };
    localStorage.setItem('tempo_recovery_state_history', JSON.stringify(history));
    const out = RecoveryFeed.getHistory();
    assertEqual(out.rows.length, 2);
    assertEqual(out.rows[1].day, '2026-05-28');
  });
});

describe('RecoveryFeed.getDayRow — history lookup', () => {
  it('returns null when no history is cached', () => {
    rfClearCache();
    assertEqual(RecoveryFeed.getDayRow('2026-05-28'), null);
  });

  it('returns null when cached history has empty rows', () => {
    rfClearCache();
    localStorage.setItem('tempo_recovery_state_history', JSON.stringify({ rows: [] }));
    assertEqual(RecoveryFeed.getDayRow('2026-05-28'), null);
  });

  it('returns the matching row by ISO date', () => {
    rfClearCache();
    const history = {
      rows: [
        { day: '2026-05-26', recovery_signal: 'neutral', acwr: 0.9 },
        { day: '2026-05-27', recovery_signal: 'well_recovered', acwr: 1.05 },
        { day: '2026-05-28', recovery_signal: 'strained', acwr: 1.6 },
      ],
    };
    localStorage.setItem('tempo_recovery_state_history', JSON.stringify(history));
    const out = RecoveryFeed.getDayRow('2026-05-27');
    assertEqual(out.day, '2026-05-27');
    assertEqual(out.recovery_signal, 'well_recovered');
    assertEqual(out.acwr, 1.05);
  });

  it('returns null for an absent date', () => {
    rfClearCache();
    const history = { rows: [{ day: '2026-05-27', recovery_signal: 'neutral' }] };
    localStorage.setItem('tempo_recovery_state_history', JSON.stringify(history));
    assertEqual(RecoveryFeed.getDayRow('2026-04-01'), null);
  });

  it('returns null for malformed input', () => {
    rfClearCache();
    const history = { rows: [{ day: '2026-05-27', recovery_signal: 'neutral' }] };
    localStorage.setItem('tempo_recovery_state_history', JSON.stringify(history));
    assertEqual(RecoveryFeed.getDayRow(null), null);
    assertEqual(RecoveryFeed.getDayRow(undefined), null);
    assertEqual(RecoveryFeed.getDayRow(42), null);
  });

  it('does not throw on malformed cache', () => {
    rfClearCache();
    localStorage.setItem('tempo_recovery_state_history', '{{not json');
    assertEqual(RecoveryFeed.getDayRow('2026-05-28'), null);
  });
});

describe('RecoveryFeed.refresh — gate', () => {
  it('no-ops and returns null when SyncFlag is off', async () => {
    rfClearCache();
    rfStubGate({ flagOn: false });
    const result = await RecoveryFeed.refresh();
    assertEqual(result, null);
    assertEqual(RecoveryFeed.getLatest(), null);
  });

  it('no-ops and returns null when signed out', async () => {
    rfClearCache();
    rfStubGate({ flagOn: true, uid: null });
    const result = await RecoveryFeed.refresh();
    assertEqual(result, null);
    assertEqual(RecoveryFeed.getLatest(), null);
  });

  it('no-ops when SyncFirestore.getDoc is unavailable', async () => {
    rfClearCache();
    SyncFlag.isEnabled = () => true;
    SyncAuth.getCurrentUser = () => ({ uid: 'u' });
    SyncFirestore.getDoc = undefined;   // collaborator method missing → gate closed
    SyncEngine.on = () => {};
    SyncEngine.emit = () => {};
    const result = await RecoveryFeed.refresh();
    assertEqual(result, null);
  });
});

describe('RecoveryFeed.refresh — happy path', () => {
  it('writes the fetched latest doc to localStorage', async () => {
    rfClearCache();
    const row = { day: '2026-05-28', recovery_signal: 'well_recovered', hrv_ms: 68.4, acwr: 1.05 };
    rfStubGate({
      uid: 'user-abc',
      firestore: rfFirestoreReturning({
        'users/user-abc/recovery_state/latest': row,
      }),
    });
    const out = await RecoveryFeed.refresh();
    assertEqual(out.day, '2026-05-28');
    const cached = RecoveryFeed.getLatest();
    assertEqual(cached.day, '2026-05-28');
    assertEqual(cached.recovery_signal, 'well_recovered');
  });

  it('writes the fetched history doc independently of latest', async () => {
    rfClearCache();
    const latestRow = { day: '2026-05-28', recovery_signal: 'strained' };
    const history = { rows: [{ day: '2026-05-27' }, { day: '2026-05-28' }] };
    rfStubGate({
      uid: 'user-abc',
      firestore: rfFirestoreReturning({
        'users/user-abc/recovery_state/latest': latestRow,
        'users/user-abc/recovery_state/history': history,
      }),
    });
    await RecoveryFeed.refresh();
    const cached = RecoveryFeed.getHistory();
    assertEqual(cached.rows.length, 2);
    assertEqual(cached.rows[1].day, '2026-05-28');
  });

  it('history fetch failure does not void the latest write', async () => {
    rfClearCache();
    const latestRow = { day: '2026-05-28', recovery_signal: 'neutral' };
    rfStubGate({
      uid: 'user-abc',
      firestore: {
        getDoc: async (path) => {
          if (path.endsWith('/latest')) return { id: 'latest', data: latestRow };
          throw new Error('history is down');
        },
      },
    });
    const out = await RecoveryFeed.refresh();
    assertEqual(out.day, '2026-05-28');
    assertEqual(RecoveryFeed.getLatest().recovery_signal, 'neutral');
  });

  it('a missing doc leaves the cache untouched', async () => {
    rfClearCache();
    // Seed a previously-cached row so we can detect overwrites.
    const prior = { day: '2026-05-26', recovery_signal: 'neutral' };
    localStorage.setItem('tempo_recovery_state_latest', JSON.stringify(prior));
    rfStubGate({
      uid: 'user-abc',
      firestore: { getDoc: async () => ({ id: 'missing', data: null }) },
    });
    await RecoveryFeed.refresh();
    const cached = RecoveryFeed.getLatest();
    assertEqual(cached.day, '2026-05-26');
  });
});

describe('RecoveryFeed.refresh — dedup', () => {
  it('returns the same in-flight promise for concurrent calls', async () => {
    rfClearCache();
    let calls = 0;
    rfStubGate({
      uid: 'user-abc',
      firestore: {
        getDoc: async () => {
          calls++;
          await new Promise(resolve => setTimeout(resolve, 5));
          return { id: 'latest', data: { day: '2026-05-28', recovery_signal: 'neutral' } };
        },
      },
    });
    const [a, b] = await Promise.all([RecoveryFeed.refresh(), RecoveryFeed.refresh()]);
    // Two getDoc calls per refresh (latest + history). One refresh would hit
    // each path once; a deduped pair must NOT double that.
    assert(calls <= 2, 'expected concurrent refresh() calls to dedup; got ' + calls + ' getDoc calls');
    assertEqual(a.day, '2026-05-28');
    assertEqual(b.day, '2026-05-28');
  });
});

// Restore the real collaborator methods so later suites see a clean environment.
rfRestoreGlobals();
