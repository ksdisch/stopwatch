// Tests for RecoveryFeed — the read-only consumer of mart_recovery_state
// pushed to Firestore by personal-health-elt. Same testing pattern as
// analytics.test.js / rhythm.test.js: stub globals per-case, exercise the
// public surface, restore at end.

const _rfRealSyncFlag = window.SyncFlag;
const _rfRealSyncAuth = window.SyncAuth;
const _rfRealSyncFirestore = window.SyncFirestore;
const _rfRealSyncEngine = window.SyncEngine;

function rfClearCache() {
  localStorage.removeItem('tempo_recovery_state_latest');
  localStorage.removeItem('tempo_recovery_state_history');
}

function rfStubGate({ flagOn = true, uid = 'user-abc', firestore = null } = {}) {
  window.SyncFlag = { isEnabled: () => flagOn };
  window.SyncAuth = { getCurrentUser: () => (uid ? { uid } : null) };
  window.SyncFirestore = firestore || {
    getDoc: async () => ({ id: 'missing', data: null }),
  };
  // Bus stub — accept .on/.emit registrations without doing anything.
  window.SyncEngine = { on: () => {}, emit: () => {} };
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

  it('no-ops when SyncFirestore is unavailable', async () => {
    rfClearCache();
    window.SyncFlag = { isEnabled: () => true };
    window.SyncAuth = { getCurrentUser: () => ({ uid: 'u' }) };
    window.SyncFirestore = undefined;
    window.SyncEngine = { on: () => {}, emit: () => {} };
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

// Restore globals so later test suites see the real environment.
window.SyncFlag = _rfRealSyncFlag;
window.SyncAuth = _rfRealSyncAuth;
window.SyncFirestore = _rfRealSyncFirestore;
window.SyncEngine = _rfRealSyncEngine;
