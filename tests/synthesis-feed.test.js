// Tests for SynthesisFeed — the read-only consumer of the council's per-node
// synthesis records pushed to Firestore at users/{uid}/synthesis/{nodeId}.
// Same testing pattern as recovery-feed.test.js: stub globals per-case,
// exercise the public surface, restore at end.

// synthesis-feed.js references SyncFlag / SyncAuth / SyncFirestore / SyncEngine
// LEXICALLY — they are top-level `const` singletons (all loaded in
// tests/index.html), NOT window properties. A lexical `const` reference never
// reads `window.<Name>`, so the only way to inject a fake is to overwrite the
// real object's METHODS (the same idiom recovery-feed.test.js uses). Save the
// real methods now; restore them after the suite.
const _sfOrig = {
  flagIsEnabled: SyncFlag.isEnabled,
  authGetCurrentUser: SyncAuth.getCurrentUser,
  fsGetDoc: SyncFirestore.getDoc,
  engineOn: SyncEngine.on,
  engineEmit: SyncEngine.emit,
};

function sfRestoreGlobals() {
  SyncFlag.isEnabled = _sfOrig.flagIsEnabled;
  SyncAuth.getCurrentUser = _sfOrig.authGetCurrentUser;
  SyncFirestore.getDoc = _sfOrig.fsGetDoc;
  SyncEngine.on = _sfOrig.engineOn;
  SyncEngine.emit = _sfOrig.engineEmit;
}

function sfClearCache() {
  // Wipe every key under the module's per-node prefix.
  const prefix = SynthesisFeed._internals.CACHE_PREFIX;
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.indexOf(prefix) === 0) keys.push(k);
  }
  keys.forEach(k => localStorage.removeItem(k));
}

function sfStubGate({ flagOn = true, uid = 'user-abc', firestore = null } = {}) {
  // Overwrite methods on the REAL const singletons (see note above).
  SyncFlag.isEnabled = () => flagOn;
  SyncAuth.getCurrentUser = () => (uid ? { uid } : null);
  const fs = firestore || { getDoc: async () => ({ id: 'missing', data: null }) };
  SyncFirestore.getDoc = fs.getDoc;
  // Bus stub — accept .on/.emit registrations without doing anything.
  SyncEngine.on = () => {};
  SyncEngine.emit = () => {};
}

function sfFirestoreReturning(map) {
  return {
    getDoc: async (path) => {
      if (map[path] !== undefined) return { id: path.split('/').pop(), data: map[path] };
      return { id: 'missing', data: null };
    },
  };
}

// A minimal valid synthesis record (frozen contract requires node + headline).
function sfRecord(node, headline) {
  return {
    contractVersion: 1,
    node: node,
    producer: 'council/nightly-light',
    producedAt: '2026-06-08T06:00:12Z',
    window: '2026-06-01..2026-06-07',
    state: { band: 'steady', score: 72 },
    headline: headline,
    signals: ['slept 7h', 'low caffeine'],
    nudges: [],
    provenance: { sources: ['sleep'], coverage: 0.8 },
    confidence: 'medium',
  };
}

describe('SynthesisFeed.encodeNodeId — node id encoding', () => {
  it("maps 'physicals/sleep' to 'physicals__sleep'", () => {
    assertEqual(SynthesisFeed._internals.encodeNodeId('physicals/sleep'), 'physicals__sleep');
  });

  it("leaves 'home' as 'home'", () => {
    assertEqual(SynthesisFeed._internals.encodeNodeId('home'), 'home');
  });

  it("encodes a deep path's slashes", () => {
    assertEqual(SynthesisFeed._internals.encodeNodeId('a/b/c'), 'a__b__c');
  });

  it('defaults a non-string / empty input to home', () => {
    assertEqual(SynthesisFeed._internals.encodeNodeId(''), 'home');
    assertEqual(SynthesisFeed._internals.encodeNodeId(null), 'home');
    assertEqual(SynthesisFeed._internals.encodeNodeId(undefined), 'home');
  });
});

describe('SynthesisFeed.getRecord — cache reads', () => {
  it('returns null when nothing is cached', () => {
    sfClearCache();
    assertEqual(SynthesisFeed.getRecord('home'), null);
  });

  it('defaults to the home node when no nodeId is passed', () => {
    sfClearCache();
    assertEqual(SynthesisFeed.getRecord(), null);
  });

  it('round-trips a cached record through getRecord', () => {
    sfClearCache();
    const rec = sfRecord('home', 'Steady today — keep the rhythm.');
    localStorage.setItem(SynthesisFeed._internals.cacheKey('home'), JSON.stringify(rec));
    const out = SynthesisFeed.getRecord('home');
    assertEqual(out.node, 'home');
    assertEqual(out.headline, 'Steady today — keep the rhythm.');
    assertEqual(out.state.band, 'steady');
  });

  it('reads a sub-node record by its dotted path', () => {
    sfClearCache();
    const rec = sfRecord('physicals/sleep', 'Sleep debt creeping up.');
    localStorage.setItem(SynthesisFeed._internals.cacheKey('physicals/sleep'), JSON.stringify(rec));
    const out = SynthesisFeed.getRecord('physicals/sleep');
    assertEqual(out.node, 'physicals/sleep');
    assertEqual(out.headline, 'Sleep debt creeping up.');
  });

  it('returns null on malformed cache (does not throw)', () => {
    sfClearCache();
    localStorage.setItem(SynthesisFeed._internals.cacheKey('home'), '{{not json');
    assertEqual(SynthesisFeed.getRecord('home'), null);
  });
});

describe('SynthesisFeed._canFetch — gate', () => {
  it('returns null when SyncFlag is off', () => {
    sfStubGate({ flagOn: false });
    assertEqual(SynthesisFeed._internals._canFetch(), null);
  });

  it('returns null when signed out', () => {
    sfStubGate({ flagOn: true, uid: null });
    assertEqual(SynthesisFeed._internals._canFetch(), null);
  });

  it('returns the uid when flag on + signed in', () => {
    sfStubGate({ flagOn: true, uid: 'user-xyz' });
    assertEqual(SynthesisFeed._internals._canFetch(), 'user-xyz');
  });

  it('returns null when SyncFirestore.getDoc is unavailable', () => {
    SyncFlag.isEnabled = () => true;
    SyncAuth.getCurrentUser = () => ({ uid: 'u' });
    SyncFirestore.getDoc = undefined;   // collaborator method missing → gate closed
    SyncEngine.on = () => {};
    SyncEngine.emit = () => {};
    assertEqual(SynthesisFeed._internals._canFetch(), null);
  });
});

describe('SynthesisFeed.refresh — gate', () => {
  it('no-ops and returns null when SyncFlag is off', async () => {
    sfClearCache();
    sfStubGate({ flagOn: false });
    const result = await SynthesisFeed.refresh('home');
    assertEqual(result, null);
    assertEqual(SynthesisFeed.getRecord('home'), null);
  });

  it('no-ops and returns null when signed out', async () => {
    sfClearCache();
    sfStubGate({ flagOn: true, uid: null });
    const result = await SynthesisFeed.refresh('home');
    assertEqual(result, null);
    assertEqual(SynthesisFeed.getRecord('home'), null);
  });
});

describe('SynthesisFeed.refresh — happy path', () => {
  it("writes the fetched home doc to cache under the encoded key", async () => {
    sfClearCache();
    const rec = sfRecord('home', 'Steady — protect tonight\'s sleep.');
    sfStubGate({
      uid: 'user-abc',
      firestore: sfFirestoreReturning({
        'users/user-abc/synthesis/home': rec,
      }),
    });
    const out = await SynthesisFeed.refresh('home');
    assertEqual(out.headline, 'Steady — protect tonight\'s sleep.');
    const cached = SynthesisFeed.getRecord('home');
    assertEqual(cached.node, 'home');
    assertEqual(cached.headline, 'Steady — protect tonight\'s sleep.');
  });

  it('fetches a sub-node at its slash-encoded path', async () => {
    sfClearCache();
    const rec = sfRecord('physicals/sleep', 'Sleep strained.');
    sfStubGate({
      uid: 'user-abc',
      firestore: sfFirestoreReturning({
        'users/user-abc/synthesis/physicals__sleep': rec,
      }),
    });
    const out = await SynthesisFeed.refresh('physicals/sleep');
    assertEqual(out.node, 'physicals/sleep');
    const cached = SynthesisFeed.getRecord('physicals/sleep');
    assertEqual(cached.headline, 'Sleep strained.');
  });

  it('a missing doc leaves the cache untouched', async () => {
    sfClearCache();
    const prior = sfRecord('home', 'Prior briefing.');
    localStorage.setItem(SynthesisFeed._internals.cacheKey('home'), JSON.stringify(prior));
    sfStubGate({
      uid: 'user-abc',
      firestore: { getDoc: async () => ({ id: 'missing', data: null }) },
    });
    await SynthesisFeed.refresh('home');
    const cached = SynthesisFeed.getRecord('home');
    assertEqual(cached.headline, 'Prior briefing.');
  });

  it('a record missing node/headline is not written through (shape-guard)', async () => {
    sfClearCache();
    sfStubGate({
      uid: 'user-abc',
      firestore: sfFirestoreReturning({
        'users/user-abc/synthesis/home': { contractVersion: 1, producer: 'x' }, // no node/headline
      }),
    });
    const out = await SynthesisFeed.refresh('home');
    assertEqual(out, null);
    assertEqual(SynthesisFeed.getRecord('home'), null);
  });
});

describe('SynthesisFeed.onUpdate — repaint signal', () => {
  it('notifies subscribers after a record is written through to cache', async () => {
    sfClearCache();
    const fired = [];
    SynthesisFeed.onUpdate((node) => fired.push(node));
    sfStubGate({
      uid: 'user-abc',
      firestore: sfFirestoreReturning({
        'users/user-abc/synthesis/home': sfRecord('home', 'Steady week.'),
      }),
    });
    await SynthesisFeed.refresh('home');
    assert(fired.indexOf('home') !== -1, 'expected onUpdate to fire with the written node');
  });

  it('does NOT notify when the doc is missing (nothing written through)', async () => {
    sfClearCache();
    let count = 0;
    SynthesisFeed.onUpdate(() => { count += 1; });
    sfStubGate({
      uid: 'user-abc',
      firestore: { getDoc: async () => ({ id: 'missing', data: null }) },
    });
    await SynthesisFeed.refresh('home');
    assertEqual(count, 0);
  });
});

describe('SynthesisFeed.refresh — dedup', () => {
  it('returns the same in-flight promise for concurrent same-node calls', async () => {
    sfClearCache();
    let calls = 0;
    sfStubGate({
      uid: 'user-abc',
      firestore: {
        getDoc: async () => {
          calls++;
          await new Promise(resolve => setTimeout(resolve, 5));
          return { id: 'home', data: sfRecord('home', 'Deduped.') };
        },
      },
    });
    const [a, b] = await Promise.all([SynthesisFeed.refresh('home'), SynthesisFeed.refresh('home')]);
    // One getDoc call per node; a deduped pair must NOT double it.
    assert(calls <= 1, 'expected concurrent refresh() calls to dedup; got ' + calls + ' getDoc calls');
    assertEqual(a.headline, 'Deduped.');
    assertEqual(b.headline, 'Deduped.');
  });
});

// Restore the real collaborator methods so later suites see a clean environment.
sfRestoreGlobals();
