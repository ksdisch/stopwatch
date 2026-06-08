// Synthesis feed — read-only consumer of the council's per-node synthesis
// records, surfaced into Tempo as a Life-OS "briefing" for any tree node.
//
// One-way: a local "council" runtime (Tier-2, Admin SDK / service-account)
// writes Firestore docs at
//   users/{uid}/synthesis/{nodeId}    -- one doc per tree node
// where nodeId = the dotted node path with '/' replaced by '__'
// (Firestore document IDs cannot contain '/'), e.g.
//   "home"                  → users/{uid}/synthesis/home
//   "physicals/sleep"       → users/{uid}/synthesis/physicals__sleep
//
// This module fetches a node's record via SyncFirestore.getDoc, caches the
// result in localStorage (one key per node) so the PWA has something to
// render when offline, and exposes a synchronous getRecord for the UI layer.
// No write path — the council is authoritative. No Schema.stamp / deviceId /
// merge logic. Mirrors js/recovery-feed.js exactly (the proven "external
// producer writes Firestore, PWA reads read-only" template).
//
// Degrades silently when:
//   - SyncFlag is off (the user hasn't opted into cloud sync)
//   - SyncAuth.getCurrentUser() returns null (signed out)
//   - SyncFirestore returns no doc (the council hasn't pushed yet)
//   - the device is offline (cached value still serves)
const SynthesisFeed = (() => {
  // Per-node localStorage cache. The full key is `CACHE_PREFIX + nodeId`,
  // e.g. 'tempo_synthesis_home', 'tempo_synthesis_physicals__sleep'. We key
  // by the ENCODED nodeId so the cache key matches the Firestore doc id 1:1.
  const CACHE_PREFIX = 'tempo_synthesis_';

  const _inFlight = {};        // dedup concurrent refresh() calls, keyed by encoded nodeId

  // ── Node id encoding ──────────────────────────────────────────────

  // Firestore document IDs cannot contain '/', so the council encodes the
  // dotted tree path with '/' → '__'. 'home' (the root) stays 'home'.
  //   'physicals/sleep' → 'physicals__sleep'
  function encodeNodeId(node) {
    if (typeof node !== 'string' || !node.length) return 'home';
    return node.split('/').join('__');
  }

  // ── Cache helpers ─────────────────────────────────────────────────

  function cacheKey(nodeId) {
    return CACHE_PREFIX + encodeNodeId(nodeId);
  }

  function _readJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function _writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) { /* quota or private-mode — caller already has the value in memory */ }
  }

  // Clear every per-node synthesis cache (used on sign-out so a different
  // account's stale briefings never bleed through). Scans localStorage for
  // any key under our prefix.
  function _clearCache() {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(CACHE_PREFIX) === 0) keys.push(k);
      }
      keys.forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
    } catch (_) { /* private-mode — nothing to clear */ }
  }

  // ── Gate checks ───────────────────────────────────────────────────

  // Three-condition gate: master flag on, auth singleton present, signed in.
  // Identical to RecoveryFeed._canFetch — both consume the same Firestore
  // read seam under the same opt-in.
  function _canFetch() {
    if (typeof SyncFlag === 'undefined' || !SyncFlag.isEnabled()) return null;
    if (typeof SyncAuth === 'undefined' || typeof SyncAuth.getCurrentUser !== 'function') return null;
    if (typeof SyncFirestore === 'undefined' || typeof SyncFirestore.getDoc !== 'function') return null;
    const user = SyncAuth.getCurrentUser();
    if (!user || !user.uid) return null;
    return user.uid;
  }

  // ── Public reads ──────────────────────────────────────────────────

  // A node's cached synthesis record, from localStorage. Null when never
  // fetched / signed out / malformed. The renderer must handle null
  // gracefully (the briefing line hides). Defaults to the 'home' root node.
  function getRecord(nodeId) {
    return _readJSON(cacheKey(nodeId || 'home'));
  }

  // ── Refresh ───────────────────────────────────────────────────────

  // Pull a single node's doc from Firestore and write through to cache.
  // Returns the document payload on success, null when the gate is closed
  // or the doc is absent. Defaults to the 'home' root node.
  //
  // Concurrent calls for the SAME node dedup to the first in-flight promise
  // (keyed by encoded nodeId) so a sign-in event + a panel-activation event
  // don't double-fetch the same record. Different nodes fetch independently.
  async function refresh(nodeId) {
    const node = nodeId || 'home';
    const encoded = encodeNodeId(node);
    if (_inFlight[encoded]) return _inFlight[encoded];

    const uid = _canFetch();
    if (!uid) return null;

    const path = 'users/' + uid + '/synthesis/' + encoded;

    _inFlight[encoded] = (async () => {
      try {
        // getDoc returns { id, data } per js/sync-firestore.js:211. `data`
        // is the document payload or null when the doc doesn't exist yet.
        const snap = await SyncFirestore.getDoc(path);
        if (snap && snap.data) {
          // Light shape-guard: the frozen contract requires `node` and
          // `headline`. A doc missing either is malformed (or a stub from a
          // different schema) — don't write it through, so getRecord keeps
          // returning the last-good cached record (or null).
          const data = snap.data;
          if (data.node && data.headline) {
            _writeJSON(cacheKey(node), data);
            return data;
          }
        }
        return null;
      } finally {
        delete _inFlight[encoded];
      }
    })();

    return _inFlight[encoded];
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  let _initialized = false;

  function init() {
    if (_initialized) return;
    _initialized = true;

    // Wire to the SyncEngine auth-change event (sync-auth.js:57-59). Sign-in
    // refreshes the root briefing; sign-out clears every synthesis cache so a
    // different account's stale briefings never bleed through.
    if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.on === 'function') {
      try {
        SyncEngine.on('auth-change', (user) => {
          if (user && user.uid) {
            refresh('home').catch(() => { /* swallow — briefing just doesn't update */ });
          } else {
            _clearCache();
          }
        });
      } catch (_) { /* on-page-with-no-SyncEngine — harmless */ }
    }

    // Best-effort initial fetch if the user is already signed in at boot.
    if (_canFetch()) {
      refresh('home').catch(() => { /* swallow */ });
    }
  }

  return {
    init,
    refresh,
    getRecord,
    // Exposed for tests; not part of the public surface for app code.
    _internals: { CACHE_PREFIX, _canFetch, _clearCache, encodeNodeId, cacheKey },
  };
})();
