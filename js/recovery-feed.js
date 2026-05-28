// Recovery feed — read-only consumer of the personal-health-elt pipeline's
// daily public-API mart (mart_recovery_state), surfaced into Rhythm as a
// readiness band.
//
// One-way: the pipeline writes Firestore docs at
//   users/{uid}/recovery_state/latest    -- the most recent day
//   users/{uid}/recovery_state/history   -- { rows: [...last 14 days] }
//
// This module fetches them via SyncFirestore.getDoc, caches the result in
// localStorage so Rhythm has something to render when offline, and exposes
// synchronous getLatest / getHistory for the UI layer. No write path — the
// pipeline is authoritative. No Schema.stamp / deviceId / merge logic.
//
// Degrades silently when:
//   - SyncFlag is off (the user hasn't opted into cloud sync)
//   - SyncAuth.getCurrentUser() returns null (signed out)
//   - SyncFirestore returns no doc (the pipeline hasn't pushed yet)
//   - the device is offline (cached value still serves)
const RecoveryFeed = (() => {
  const CACHE_KEY_LATEST = 'tempo_recovery_state_latest';
  const CACHE_KEY_HISTORY = 'tempo_recovery_state_history';

  let _inFlight = null;       // dedup concurrent refresh() calls

  // ── Cache helpers ─────────────────────────────────────────────────

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

  function _clearCache() {
    try { localStorage.removeItem(CACHE_KEY_LATEST); } catch (_) {}
    try { localStorage.removeItem(CACHE_KEY_HISTORY); } catch (_) {}
  }

  // ── Gate checks ───────────────────────────────────────────────────

  // Three-condition gate: master flag on, auth singleton present, signed in.
  // Mirrors the pattern in sync-engine.js's auto-invoke helper without taking
  // a hard dependency on it.
  function _canFetch() {
    if (typeof SyncFlag === 'undefined' || !SyncFlag.isEnabled()) return null;
    if (typeof SyncAuth === 'undefined' || typeof SyncAuth.getCurrentUser !== 'function') return null;
    if (typeof SyncFirestore === 'undefined' || typeof SyncFirestore.getDoc !== 'function') return null;
    const user = SyncAuth.getCurrentUser();
    if (!user || !user.uid) return null;
    return user.uid;
  }

  // ── Public reads ──────────────────────────────────────────────────

  // Latest day's row, from cache. Null when never fetched / signed out.
  // The renderer must handle null gracefully (band hides).
  function getLatest() {
    return _readJSON(CACHE_KEY_LATEST);
  }

  // Last-N-days array (N currently 14 server-side). { rows: [...] } or null.
  function getHistory() {
    return _readJSON(CACHE_KEY_HISTORY);
  }

  // ── Refresh ───────────────────────────────────────────────────────

  // Pull both docs from Firestore and write through to cache. Returns the
  // latest-doc payload on success, null when the gate is closed, throws on
  // unexpected transport errors (caller decides whether to surface).
  //
  // Concurrent calls dedup to the first in-flight promise so a sign-in
  // event + a pillar-activation event don't double-fetch.
  async function refresh() {
    if (_inFlight) return _inFlight;
    const uid = _canFetch();
    if (!uid) return null;

    const latestPath = 'users/' + uid + '/recovery_state/latest';
    const historyPath = 'users/' + uid + '/recovery_state/history';

    _inFlight = (async () => {
      try {
        // getDoc returns { id, data } per js/sync-firestore.js:211. `data`
        // is the document payload or null when the doc doesn't exist yet.
        const latestSnap = await SyncFirestore.getDoc(latestPath);
        if (latestSnap && latestSnap.data) {
          _writeJSON(CACHE_KEY_LATEST, latestSnap.data);
        }
        // History is best-effort — a missing history doc shouldn't void the
        // latest read. Wrap independently.
        try {
          const historySnap = await SyncFirestore.getDoc(historyPath);
          if (historySnap && historySnap.data) {
            _writeJSON(CACHE_KEY_HISTORY, historySnap.data);
          }
        } catch (_) { /* history fetch failure is non-fatal */ }
        return latestSnap && latestSnap.data ? latestSnap.data : null;
      } finally {
        _inFlight = null;
      }
    })();

    return _inFlight;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  let _initialized = false;

  function init() {
    if (_initialized) return;
    _initialized = true;

    // Wire to the SyncEngine auth-change event (sync-auth.js:57-59). Sign-in
    // refreshes; sign-out clears the cache so a different account's stale
    // band never bleeds through.
    if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.on === 'function') {
      try {
        SyncEngine.on('auth-change', (user) => {
          if (user && user.uid) {
            refresh().catch(() => { /* swallow — band just doesn't update */ });
          } else {
            _clearCache();
          }
        });
      } catch (_) { /* on-page-with-no-SyncEngine — harmless */ }
    }

    // Best-effort initial fetch if the user is already signed in at boot.
    if (_canFetch()) {
      refresh().catch(() => { /* swallow */ });
    }
  }

  return {
    init,
    refresh,
    getLatest,
    getHistory,
    // Exposed for tests; not part of the public surface for app code.
    _internals: { CACHE_KEY_LATEST, CACHE_KEY_HISTORY, _canFetch, _clearCache },
  };
})();
