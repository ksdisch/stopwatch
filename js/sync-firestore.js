// B-3: SyncFirestore — single Firestore SDK seam.
//
// Mirrors Platform.auth's lazy-load pattern: every Firestore SDK
// reference inside the app goes through this module. Engine code
// (SyncEngine.pushSnapshot, future merge / listener code) stays
// platform-agnostic; this module is the only place that imports
// `firebase/firestore` or touches `Capacitor.Plugins.FirebaseFirestore`.
//
// Public API:
//   SyncFirestore.getDoc(path)          : Promise<{ id, data } | null>
//   SyncFirestore.setDoc(path, data)    : Promise<void>
//   SyncFirestore.getCollection(path)   : Promise<{ docs: [{id,data}], count }>
//   SyncFirestore.runTransaction(fn)    : Promise<any>   — STUB (throws in B-3)
//   SyncFirestore.setBatch(writes)      : Promise<void>  — STUB (throws in B-3)
//
// Error normalization:
//   All methods throw / reject with the same normalized error shape:
//     { kind: 'permission-denied' | 'network' | 'not-found' | 'unknown',
//       message: string, isRetryable: boolean, originalError: any }
//   Web `FirebaseError` codes + native plugin error codes are mapped to
//   `kind`; the original error is preserved on `originalError` for
//   debugging.
//
// No-op fast-path: when SyncFlag.isEnabled() === false, every method
// throws `Error('SYNC_DISABLED')` synchronously (well, returns a rejected
// Promise) without loading the SDK. Keeps boot byte-equivalent to
// pre-sync builds when the flag is off.
//
// Scope discipline for B-3:
//   - No DOM access.
//   - No static Firebase imports — all SDK access via lazy dynamic
//     `import()` (web) or `window.Capacitor.Plugins` (native).
//   - Reuses the FirebaseApp instance Platform.auth initialized. We
//     call `getApps()` and reuse [0]; never call initializeApp here.
//   - No fetch outside the lazy CDN import.

const SyncFirestore = (() => {
  const FIREBASE_APP_URL       = 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
  const FIREBASE_FIRESTORE_URL = 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

  const cap = (typeof window !== 'undefined' && window.Capacitor) || null;
  const isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
  const plugins = (cap && cap.Plugins) || {};

  // Module-scoped caches so subsequent calls don't re-import or rebuild.
  let _sdk = null;             // web: { initializeApp, getApps, getFirestore, doc, getDoc, setDoc, collection, getDocs }
  let _db = null;              // web: Firestore instance
  let _nativeUnavailableLogged = false;

  function _flagOn() {
    return typeof SyncFlag !== 'undefined' && SyncFlag.isEnabled();
  }

  // ── Error normalization ──────────────────────────────────────────────

  function _normalizeError(err) {
    if (!err) return _wrap('unknown', 'unknown error', false, err);

    const code = err.code || (err.error && err.error.code) || '';
    const message = err.message || err.errorMessage || String(err);

    // Firebase web SDK: codes look like 'permission-denied', 'unavailable',
    // 'not-found', plus 'auth/...' on the auth SDK.
    if (typeof code === 'string') {
      // Permission denied — security rules rejected the write.
      if (code === 'permission-denied' || code.indexOf('permission-denied') !== -1) {
        return _wrap('permission-denied', message, false, err);
      }
      // Network / transient — `unavailable`, `deadline-exceeded`,
      // `aborted`, `cancelled` are all "retry probably works".
      if (
        code === 'unavailable' ||
        code === 'deadline-exceeded' ||
        code === 'aborted' ||
        code === 'cancelled' ||
        code === 'resource-exhausted'
      ) {
        return _wrap('network', message, true, err);
      }
      // Not-found is its own kind so callers (esp. F9 cloud probe) can
      // distinguish "doc/collection literally absent" from generic errors.
      if (code === 'not-found') {
        return _wrap('not-found', message, false, err);
      }

      // @capacitor-firebase/firestore plugin error code patterns observed
      // in the plugin source:
      //   - 'FIRESTORE/<error-code>' for SDK-passthrough errors
      //   - numeric strings ('12...') for cancellation/etc.
      // The substring checks below are a best-effort mapping; the
      // plugin's exact shape may evolve, but kind: 'unknown' is a safe
      // fallback for anything we miss.
      if (code.indexOf('FIRESTORE/') === 0) {
        const inner = code.slice('FIRESTORE/'.length);
        if (inner === 'permission-denied') return _wrap('permission-denied', message, false, err);
        if (inner === 'unavailable')        return _wrap('network', message, true, err);
        if (inner === 'not-found')          return _wrap('not-found', message, false, err);
        return _wrap('unknown', message, false, err);
      }
    }

    // Fallback: pattern-match the message string for the most common
    // transient signals when we don't have a code.
    if (typeof message === 'string') {
      if (/network|offline|unavailable|timeout/i.test(message)) {
        return _wrap('network', message, true, err);
      }
      if (/permission|forbidden|unauthori[sz]ed/i.test(message)) {
        return _wrap('permission-denied', message, false, err);
      }
    }

    return _wrap('unknown', message, false, err);
  }

  function _wrap(kind, message, isRetryable, originalError) {
    // Use a plain Error subclass-like object so callers can both
    // `catch (err) { err.kind; }` AND `throw err` cleanly.
    const e = new Error(message || kind);
    e.kind = kind;
    e.isRetryable = !!isRetryable;
    e.originalError = originalError;
    return e;
  }

  // ── Web SDK lazy-load ───────────────────────────────────────────────

  async function _loadWebSdk() {
    if (_sdk) return _sdk;
    const [appMod, firestoreMod] = await Promise.all([
      import(/* @vite-ignore */ FIREBASE_APP_URL),
      import(/* @vite-ignore */ FIREBASE_FIRESTORE_URL),
    ]);
    _sdk = {
      initializeApp:   appMod.initializeApp,
      getApps:         appMod.getApps,
      getFirestore:    firestoreMod.getFirestore,
      doc:             firestoreMod.doc,
      getDoc:          firestoreMod.getDoc,
      setDoc:          firestoreMod.setDoc,
      collection:      firestoreMod.collection,
      getDocs:         firestoreMod.getDocs,
    };
    return _sdk;
  }

  async function _getWebDb() {
    const sdk = await _loadWebSdk();
    if (_db) return { sdk, db: _db };
    // Reuse the FirebaseApp instance Platform.auth initialized. We never
    // call initializeApp here — duplicate init would log a warning and
    // (worse) create a parallel app graph that doesn't share auth state.
    const apps = sdk.getApps();
    let app;
    if (apps.length) {
      app = apps[0];
    } else {
      // Fallback path — Platform.auth hasn't initialized yet (e.g. push
      // triggered before sign-in flow on a cold boot). Initialize from
      // FirebaseConfig here. Auth's _getWebAuth will reuse this app on
      // its next call because getApps() will return it.
      const config = (typeof window !== 'undefined' && window.FirebaseConfig) || null;
      if (!config) {
        throw _wrap('unknown', 'FirebaseConfig missing — js/sync-firebase-config.js not loaded', false, null);
      }
      app = sdk.initializeApp(config);
    }
    _db = sdk.getFirestore(app);
    return { sdk, db: _db };
  }

  // ── Native plugin handle ─────────────────────────────────────────────

  function _nativePlugin() {
    const fs = plugins && plugins.FirebaseFirestore;
    if (!fs) {
      if (!_nativeUnavailableLogged) {
        try { console.warn('[SyncFirestore] FirebaseFirestore plugin unavailable — rebuild iOS app via `npx cap sync ios`.'); } catch (_e) {}
        _nativeUnavailableLogged = true;
      }
      return null;
    }
    return fs;
  }

  // Path normalization — strip leading slash; Firestore SDK accepts
  // `users/{uid}/meds/{id}` (path) but Capacitor plugin expects the same
  // shape so both branches use the same input string.
  function _normPath(path) {
    if (typeof path !== 'string' || !path.length) {
      throw _wrap('unknown', 'invalid Firestore path', false, null);
    }
    return path.charAt(0) === '/' ? path.slice(1) : path;
  }

  // ── Public API ───────────────────────────────────────────────────────

  async function getDoc(path) {
    if (!_flagOn()) throw _wrap('unknown', 'SYNC_DISABLED', false, null);
    const norm = _normPath(path);

    if (isNative) {
      const fs = _nativePlugin();
      if (!fs) throw _wrap('unknown', 'FirebaseFirestore plugin unavailable', false, null);
      try {
        const result = await fs.getDocument({ reference: norm });
        // Plugin returns { snapshot: { id, path, data } } in current shape.
        const snap = result && result.snapshot;
        if (!snap || !snap.data) return null;
        return { id: snap.id || norm.split('/').pop(), data: snap.data };
      } catch (err) {
        throw _normalizeError(err);
      }
    }

    try {
      const { sdk, db } = await _getWebDb();
      const ref = sdk.doc(db, norm);
      const snap = await sdk.getDoc(ref);
      if (!snap.exists()) return null;
      return { id: snap.id, data: snap.data() };
    } catch (err) {
      throw _normalizeError(err);
    }
  }

  async function setDoc(path, data) {
    if (!_flagOn()) throw _wrap('unknown', 'SYNC_DISABLED', false, null);
    const norm = _normPath(path);

    if (isNative) {
      const fs = _nativePlugin();
      if (!fs) throw _wrap('unknown', 'FirebaseFirestore plugin unavailable', false, null);
      try {
        await fs.setDocument({ reference: norm, data, merge: false });
      } catch (err) {
        throw _normalizeError(err);
      }
      return;
    }

    try {
      const { sdk, db } = await _getWebDb();
      const ref = sdk.doc(db, norm);
      await sdk.setDoc(ref, data);
    } catch (err) {
      throw _normalizeError(err);
    }
  }

  async function getCollection(path) {
    if (!_flagOn()) throw _wrap('unknown', 'SYNC_DISABLED', false, null);
    const norm = _normPath(path);

    if (isNative) {
      const fs = _nativePlugin();
      if (!fs) throw _wrap('unknown', 'FirebaseFirestore plugin unavailable', false, null);
      try {
        const result = await fs.getCollection({ reference: norm });
        // Plugin returns { snapshots: [{ id, path, data }, ...] }.
        const snaps = (result && result.snapshots) || [];
        const docs = snaps.map(s => ({ id: s.id, data: s.data }));
        return { docs, count: docs.length };
      } catch (err) {
        throw _normalizeError(err);
      }
    }

    try {
      const { sdk, db } = await _getWebDb();
      const ref = sdk.collection(db, norm);
      const snap = await sdk.getDocs(ref);
      const docs = [];
      snap.forEach(d => docs.push({ id: d.id, data: d.data() }));
      return { docs, count: docs.length };
    } catch (err) {
      throw _normalizeError(err);
    }
  }

  // E-1 will implement per-record CAS via Firestore transactions. B-3
  // ships the stub so call-site code can land + tests can assert the
  // seam exists. Throws so a stray call surfaces immediately.
  async function runTransaction(/* fn */) {
    throw _wrap('unknown', 'runTransaction not implemented until E-1', false, null);
  }

  // Defined for future use; B-3 uses a per-record setDoc loop instead
  // because Firestore batched writes have a 500-write cap (F14's
  // doseLog cap is 1000 entries which can blow past 500).
  async function setBatch(/* writes */) {
    throw _wrap('unknown', 'setBatch not implemented; B-3 uses per-record setDoc loop', false, null);
  }

  return {
    getDoc,
    setDoc,
    getCollection,
    runTransaction,
    setBatch,
  };
})();

if (typeof window !== 'undefined') {
  window.SyncFirestore = SyncFirestore;
}
