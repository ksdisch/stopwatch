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
//   SyncFirestore.runTransaction(fn)    : Promise<any>   — CAS wrapper (E-1b; web-only)
//   SyncFirestore.subscribe(path, cb)   : () => void    — onSnapshot wrapper (E-3; web-only)
//   SyncFirestore.setBatch(writes)      : Promise<void>  — STUB (throws in B-3)
//
// Error normalization:
//   All methods throw / reject with the same normalized error shape:
//     { kind: 'permission-denied' | 'network' | 'not-found' |
//             'refuse-writeback' | 'unknown',
//       message: string, isRetryable: boolean, originalError: any }
//   Web `FirebaseError` codes + native plugin error codes are mapped to
//   `kind`; the original error is preserved on `originalError` for
//   debugging. `kind: 'refuse-writeback'` is E-1b's new addition for the
//   F19a CAS gate — it's stamped by the caller's transaction body when
//   `remote.schemaVersion > local SCHEMA_VERSION` and signals "downlevel
//   client refused to overwrite future-schema record".
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
      // E-1b: pulled in alongside the existing imports so the CAS
      // wrapper below can call `runTransaction(db, fn)` against the
      // same lazy-loaded SDK without re-importing on every call.
      runTransaction:  firestoreMod.runTransaction,
      // E-3: pulled in alongside the existing imports so the subscribe
      // wrapper below can call `onSnapshot(ref, next, error)` against
      // the same lazy-loaded SDK without re-importing on every call.
      onSnapshot:      firestoreMod.onSnapshot,
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

  // ── E-1b: CAS wrapper for per-record writes ─────────────────────────
  //
  // Caller-supplied `fn(tx)` is invoked inside a Firestore transaction.
  // The `tx` argument is a thin adapter over the SDK's transaction
  // primitive — exposes `get(path)`, `set(path, data)`, and a
  // `refuseWriteback(remoteRecord, localSchemaVersion)` helper that
  // throws the normalized refuse-writeback error so callers can encode
  // the F19a check without re-implementing the error shape.
  //
  // F19a CAS gate (web):
  //   const ref = `users/${uid}/${store}/${id}`;
  //   await SyncFirestore.runTransaction(async (tx) => {
  //     const snap = await tx.get(ref);
  //     if (snap && snap.data && snap.data.schemaVersion > Schema.SCHEMA_VERSION) {
  //       tx.refuseWriteback(snap.data, Schema.SCHEMA_VERSION);
  //     }
  //     tx.set(ref, mergedRecord);
  //   });
  //
  // CRITICAL: the `tx.get` call MUST happen INSIDE the transaction
  // callback (Risk #1). A separate `getDoc` outside the transaction
  // would lose CAS atomicity — a write-after-read race could clobber
  // a future-schema record between the schemaVersion check and the
  // transaction-internal write.
  //
  // Native CAS parity is a documented follow-up — web-only in E-1b.
  // The native branch throws `kind: 'unknown'` with "native parity
  // pending" so downstream callers (E-1c/d/e merge functions) can
  // defensive-skip the CAS path on `isNative === true` until the
  // @capacitor-firebase/firestore plugin's `runTransaction` shape is
  // verified and wired.
  async function runTransaction(fn) {
    if (!_flagOn()) throw _wrap('unknown', 'SYNC_DISABLED', false, null);
    if (typeof fn !== 'function') {
      throw _wrap('unknown', 'runTransaction requires a callback function', false, null);
    }

    if (isNative) {
      // E-1b sub-decision 5b: native CAS parity is a documented
      // follow-up. The plugin's `runTransaction` shape (if any) hasn't
      // been verified — until it is, native iOS clients can't use the
      // CAS wrapper. Downstream merge code should defensive-skip on
      // `isNative === true`.
      //
      // M9 (AUDIT-2026-06-13): tag the throw with `nativeUnsupported` so the
      // per-store merge catch blocks can tell this documented gap apart from a
      // generic transient 'unknown' and surface it ONCE per store (instead of
      // silently swallowing 100% of native writebacks into a skipped counter
      // the UI never reads). Keep kind:'unknown' for back-compat — nothing
      // downstream branches on this path's kind, and adding a side-channel
      // field is zero-risk vs. changing the kind.
      const _nativeErr = _wrap(
        'unknown',
        'runTransaction native parity pending — web-only in E-1b; see follow-up issue',
        false,
        null
      );
      if (_nativeErr && typeof _nativeErr === 'object') _nativeErr.nativeUnsupported = true;
      throw _nativeErr;
    }

    try {
      const { sdk, db } = await _getWebDb();
      return await sdk.runTransaction(db, async (sdkTx) => {
        // Build the thin adapter we hand to the caller. Paths are
        // normalized via `_normPath` so callers can pass `/users/...`
        // or `users/...` interchangeably (matching the rest of this
        // module's public methods).
        const tx = {
          get: async (path) => {
            const norm = _normPath(path);
            const ref = sdk.doc(db, norm);
            const snap = await sdkTx.get(ref);
            if (!snap || typeof snap.exists !== 'function' || !snap.exists()) return null;
            return { id: snap.id, data: snap.data() };
          },
          set: (path, data) => {
            const norm = _normPath(path);
            const ref = sdk.doc(db, norm);
            sdkTx.set(ref, data);
          },
          refuseWriteback: (remoteRecord, localSchemaVersion) => {
            const remoteVersion = (remoteRecord && remoteRecord.schemaVersion) || '?';
            const msg = 'refuse-writeback: remote schemaVersion=' + remoteVersion +
                        ' > local=' + (localSchemaVersion == null ? '?' : localSchemaVersion);
            throw _wrap('refuse-writeback', msg, false, null);
          },
        };
        return await fn(tx);
      });
    } catch (err) {
      // Preserve the caller-stamped `kind: 'refuse-writeback'` shape —
      // `_normalizeError` would re-route it through the Firebase code
      // matcher and downgrade to `'unknown'`. If the inner throw is
      // already a fully-wrapped error (has `kind` + `isRetryable`),
      // re-throw it as-is.
      if (err && typeof err.kind === 'string' && typeof err.isRetryable === 'boolean') {
        throw err;
      }
      throw _normalizeError(err);
    }
  }

  // ── E-3: real-time onSnapshot wrapper for per-collection subscriptions ─
  //
  // Caller supplies a path (`users/{uid}/{store}`) and a callback. Each
  // time the cloud-side collection mutates (Firestore batches naturally
  // coalesce bursty writes from another device), the callback is invoked
  // with `{ docs, count }` — the same shape `getCollection` returns —
  // OR `{ ok: false, error: <normalized> }` if the listener emits an
  // error mid-stream (e.g. permission revoked while the listener is
  // alive). The caller's callback is invoked in both branches so the
  // engine can emit `'listener-disconnected'` on error without coupling
  // this module to SyncEngine.
  //
  // Returns the SDK's `unsubscribe` fn verbatim — calling it tears down
  // the listener. Idempotent + safe to call repeatedly per Firestore
  // SDK contract.
  //
  // Web branch: lazy-imports `onSnapshot` alongside the existing
  // `firebase-firestore.js` CDN module (the cached `_sdk` object now
  // carries `onSnapshot` after E-3's `_loadWebSdk` extension above).
  //
  // Native branch: throws `kind: 'unknown'` with "subscribe native parity
  // pending" mirroring the existing `runTransaction` native branch
  // (carry-forward filed alongside the long-deferred native CAS parity).
  // The engine's `_subscribeAllStores` outer try/catch catches this
  // throw so listener wire-up fails silently on native — iOS users fall
  // back to the 5-min defensive poll until a separate native-parity
  // follow-up bundles `addSnapshotListener` + `runTransaction`.
  //
  // SYNC_DISABLED fast-path matches the other public methods: throw
  // synchronously when the master flag is off.
  function subscribe(path, callback) {
    if (!_flagOn()) throw _wrap('unknown', 'SYNC_DISABLED', false, null);
    if (typeof callback !== 'function') {
      throw _wrap('unknown', 'subscribe requires a callback function', false, null);
    }
    const norm = _normPath(path);

    if (isNative) {
      // E-3 sub-decision per Pick A on TODO #7 (RESOLUTIONS in
      // docs/sync-impl/prompts/E-3-PROMPT.md): native subscribe parity
      // is a documented follow-up. Filed as a tracked carry-forward
      // alongside the long-deferred native CAS parity from E-1b.
      throw _wrap(
        'unknown',
        'subscribe native parity pending — web-only in E-3; see follow-up issue',
        false,
        null
      );
    }

    // Web branch — lazy-load the SDK + db handle, resolve the path as a
    // collection ref, register `onSnapshot(ref, next, error)`. The SDK
    // returns an `unsubscribe` fn that we hand back to the caller verbatim.
    //
    // The lazy-load is async, but `subscribe` MUST return the unsubscribe
    // fn synchronously so callers can stash it in the listener registry
    // before the next event loop tick. We solve this with a "deferred
    // unsubscribe" pattern: return a closure that either calls the real
    // unsubscribe (if the SDK has loaded) or sets a flag so the load
    // resolution callback no-ops.
    let _realUnsub = null;
    let _cancelled = false;
    (async () => {
      try {
        const { sdk, db } = await _getWebDb();
        if (_cancelled) return;
        const ref = sdk.collection(db, norm);
        _realUnsub = sdk.onSnapshot(
          ref,
          function _onNext(snapshot) {
            try {
              // M2 (AUDIT-2026-06-13): drop snapshots caused solely by THIS
              // device's own un-acked writes. `hasPendingWrites` is true on
              // the local-echo snapshot fired immediately after our own
              // tx.set; forwarding it would re-trigger a merge that re-writes
              // the same record — a self-perpetuating loop. The server-ack
              // snapshot for the same write arrives later with
              // hasPendingWrites=false, and the deep-equal writeback guard in
              // the per-store merge modules stops THAT from re-writing. Both
              // halves are required together.
              if (snapshot && snapshot.metadata && snapshot.metadata.hasPendingWrites) return;
              const docs = [];
              snapshot.forEach(d => docs.push({ id: d.id, data: d.data() }));
              callback({ docs, count: docs.length });
            } catch (_e) {
              // Caller's callback threw — must not break the listener.
            }
          },
          function _onError(err) {
            try {
              callback({ ok: false, error: _normalizeError(err) });
            } catch (_e) {
              // Caller's callback threw — must not break the listener.
            }
          }
        );
        if (_cancelled && typeof _realUnsub === 'function') {
          // Caller invoked unsubscribe before the SDK finished loading;
          // tear down immediately to avoid leaking a listener.
          try { _realUnsub(); } catch (_) {}
          _realUnsub = null;
        }
      } catch (err) {
        // Setup failed — surface the normalized error via the callback
        // so the engine can emit `'listener-disconnected'`. The caller
        // already has the deferred-unsubscribe closure; calling it is a
        // no-op since we never registered.
        try {
          callback({ ok: false, error: _normalizeError(err) });
        } catch (_e) {}
      }
    })();

    return function unsubscribe() {
      _cancelled = true;
      if (typeof _realUnsub === 'function') {
        try { _realUnsub(); } catch (_) {}
        _realUnsub = null;
      }
    };
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
    subscribe,
    setBatch,
  };
})();

if (typeof window !== 'undefined') {
  window.SyncFirestore = SyncFirestore;
}
