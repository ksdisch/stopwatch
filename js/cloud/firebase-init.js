// Firebase SDK boot for Tempo cloud sync.
//
// Loads after the Firebase compat bundles are pulled in via <script> tags.
// Boots `firebase.initializeApp()` once, enables IndexedDB persistence so
// the app keeps working offline, and exposes the SDK on `window.Cloud`
// (auth + db handles) for the rest of the cloud modules.
//
// Hard-disabled at runtime when:
//   - The compat bundles failed to load (window.firebase is undefined)
//   - firebase-config.js still has the placeholder PASTE_* values
// In either case the app falls back to local-only behavior — same as
// pre-cloud-sync builds — and every other cloud module no-ops.

const Cloud = (() => {
  const FEATURE_FLAG_KEY = 'cloud_sync_enabled';
  const CLIENT_ID_KEY = 'sync_client_id';

  // Feature flag. Defaults to false for upgraders so cloud code stays
  // dormant until the user opts in via the Settings panel.
  function isEnabled() {
    return localStorage.getItem(FEATURE_FLAG_KEY) === '1';
  }
  function setEnabled(on) {
    localStorage.setItem(FEATURE_FLAG_KEY, on ? '1' : '0');
  }

  // Per-install identifier for conflict resolution and debug telemetry.
  // Generated lazily on first read so the value persists across sessions
  // but isn't created until cloud sync is actually used.
  function getClientId() {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  }

  // Treat the file as "not configured" if any of the required values
  // still match the placeholder string from firebase-config.js.
  function configIsPlaceholder(cfg) {
    if (!cfg) return true;
    const keys = ['apiKey', 'authDomain', 'projectId', 'appId'];
    return keys.some(k => !cfg[k] || /^PASTE_/.test(String(cfg[k])));
  }

  let app = null;
  let auth = null;
  let db = null;
  let initError = null;
  let clockSkewMs = 0;

  function init() {
    if (app) return app;
    if (typeof window === 'undefined') return null;

    const fb = window.firebase;
    if (!fb || typeof fb.initializeApp !== 'function') {
      initError = 'firebase-sdk-not-loaded';
      return null;
    }
    const cfg = window.TEMPO_FIREBASE_CONFIG;
    if (configIsPlaceholder(cfg)) {
      initError = 'firebase-config-not-set';
      return null;
    }

    try {
      app = fb.initializeApp(cfg);
      auth = fb.auth();
      db = fb.firestore();

      // Multi-tab IndexedDB persistence — the PWA can be opened in
      // multiple tabs/windows on desktop, and a single-tab cache would
      // throw 'failed-precondition' the moment a second tab booted.
      const persistP = (typeof db.enablePersistence === 'function')
        ? (db.enablePersistence({ synchronizeTabs: true })
            .catch(() => {/* ignore; cache may already be open elsewhere */}))
        : Promise.resolve();

      // Best-effort clock-skew probe — fires in the background, doesn't
      // block init. Skew is used by sync-registry to skew-correct
      // clientUpdatedAt timestamps before LWW comparisons.
      persistP.then(() => probeClockSkew()).catch(() => {});

      return app;
    } catch (err) {
      initError = (err && err.message) || 'firebase-init-failed';
      app = null;
      auth = null;
      db = null;
      return null;
    }
  }

  // Write a server-timestamped doc + read it back to estimate the
  // device's clock skew. Stored in memory only; recomputed on each init.
  // Falls back silently if writes are denied (signed out — expected).
  async function probeClockSkew() {
    if (!db || !auth) return;
    if (!auth.currentUser) return; // need to be signed in to write under /users
    try {
      const fb = window.firebase;
      const uid = auth.currentUser.uid;
      const ref = db.collection('users').doc(uid).collection('_meta').doc('clockProbe');
      const tWrite = Date.now();
      await ref.set({
        schemaVersion: 1,
        clientUpdatedAt: tWrite,
        clientId: getClientId(),
        updatedAt: fb.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      const snap = await ref.get();
      const data = snap.data() || {};
      const serverTs = data.updatedAt;
      if (serverTs && typeof serverTs.toMillis === 'function') {
        const tRead = Date.now();
        const serverMs = serverTs.toMillis();
        // Approximate: serverMs landed somewhere between tWrite and tRead.
        // Use the midpoint as the local reference.
        const localMid = (tWrite + tRead) / 2;
        clockSkewMs = serverMs - localMid;
      }
    } catch (_) {
      // Most often: auth not yet ready, or rules denied. Safe to ignore.
    }
  }

  function getClockSkewMs() { return clockSkewMs; }

  // Skew-corrected wall-clock timestamp. Use this for clientUpdatedAt
  // fields so LWW is consistent across devices with drifted clocks.
  function nowSkewed() {
    return Date.now() + clockSkewMs;
  }

  function getDb()   { return db; }
  function getAuth() { return auth; }
  function getStatus() {
    return {
      initialized: !!app,
      error: initError,
      enabled: isEnabled(),
      clientId: getClientId(),
      clockSkewMs,
    };
  }

  return {
    init,
    isEnabled, setEnabled,
    getClientId,
    getDb, getAuth,
    getStatus,
    nowSkewed, getClockSkewMs, probeClockSkew,
  };
})();

// Make it discoverable as window.Cloud for the rest of the cloud modules.
window.Cloud = Cloud;
