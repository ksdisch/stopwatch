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

  // The five Life-OS domain-pillars the Home hub rolls up (the Balance
  // currency). The 'home' record is the cross-pillar Balance node; these are
  // its children. Kept as dotted node paths (encodeNodeId handles the
  // Firestore doc-id encoding). See docs/lifeos/phase-1-plan.md.
  const PILLAR_NODES = ['life_building', 'physicals', 'chickens', 'relationships', 'growth'];

  const _inFlight = {};        // dedup concurrent refresh() calls, keyed by encoded nodeId

  // ── Update notification ───────────────────────────────────────────
  // Subscribers notified after a record is written through to cache, so a UI
  // that rendered from an empty cache can repaint the moment data lands. This
  // closes the cold-load "empty flash": render() reads the cache synchronously,
  // but refreshAll() fills it asynchronously after boot / sign-in. UI-agnostic
  // — the feed only emits; consumers decide whether to re-render.
  const _updateListeners = [];
  function onUpdate(cb) {
    if (typeof cb === 'function') _updateListeners.push(cb);
  }
  function _notifyUpdate(node) {
    _updateListeners.forEach((cb) => {
      try { cb(node); } catch (_) { /* a bad listener must not break the feed */ }
    });
  }

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
            _notifyUpdate(node);   // repaint any UI rendered from the empty cache
            return data;
          }
        }
        return null;
      } catch (_) {
        // Transport error (network / permission-denied) — degrade silently to
        // null, matching this feed's silent-degrade contract and the documented
        // surface ("returns null when the gate is closed or the doc is absent").
        // A previously-cached record keeps serving via getRecord.
        return null;
      } finally {
        delete _inFlight[encoded];
      }
    })();

    return _inFlight[encoded];
  }

  // Refresh the 'home' record plus every domain-pillar record the Home hub
  // needs, concurrently. Each node fetch is independent (reuses the per-node
  // refresh + its in-flight dedup) so a missing child doc never voids the
  // rest — a quiet pillar just stays uncached/null while the others land.
  // Resolves once all settle; never rejects (per-node errors are swallowed
  // into a null result, same posture as refresh()).
  async function refreshAll() {
    const nodes = ['home'].concat(PILLAR_NODES);
    const results = await Promise.all(
      nodes.map((node) => refresh(node).catch(() => null))
    );
    return results;
  }

  // Synchronous read of every domain-pillar's cached record. Returns a plain
  // object keyed by the dotted pillar node, each value the cached record or
  // null (never fetched / signed out / never produced). The renderer hides a
  // pillar card on null. Never throws.
  function getAllPillarRecords() {
    const out = {};
    PILLAR_NODES.forEach((node) => { out[node] = getRecord(node); });
    return out;
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
            // Sign-in pulls the home record AND each domain-pillar record so
            // the Home bubble map has its full set without a render-path fetch.
            refreshAll().catch(() => { /* swallow — briefing just doesn't update */ });
          } else {
            _clearCache();
          }
        });
      } catch (_) { /* on-page-with-no-SyncEngine — harmless */ }
    }

    // Best-effort initial fetch if the user is already signed in at boot.
    if (_canFetch()) {
      refreshAll().catch(() => { /* swallow */ });
    }
  }

  return {
    init,
    refresh,
    refreshAll,
    getRecord,
    getAllPillarRecords,
    onUpdate,
    PILLAR_NODES,
    // Exposed for tests; not part of the public surface for app code.
    _internals: { CACHE_PREFIX, PILLAR_NODES, _canFetch, _clearCache, encodeNodeId, cacheKey, refreshAll, getAllPillarRecords, onUpdate, _notifyUpdate },
  };
})();
