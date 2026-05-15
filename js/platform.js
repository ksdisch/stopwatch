// Platform abstraction for haptics + notifications.
//
// Web build: delegates to navigator.vibrate / Notification / BgNotify (via SW).
// Native build (Capacitor iOS): delegates to @capacitor/haptics +
// @capacitor/local-notifications. Capacitor injects window.Capacitor.Plugins
// into the WebView at native-shell boot, so no import/bundler is needed.
//
// All call sites pass the existing navigator.vibrate-style argument
// (number | number[]) — translation to Capacitor's discrete haptic types
// happens inside Platform.haptic so call sites don't change.

const Platform = (() => {
  const cap = (typeof window !== 'undefined' && window.Capacitor) || null;
  const isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
  const plugins = (cap && cap.Plugins) || {};

  // ── Haptics ──────────────────────────────────────────────────────────────

  // Map a navigator.vibrate-style argument to a Capacitor Haptics call.
  // Patterns observed in the codebase:
  //   single small int (15–40) → light tap (button feedback, phase tick)
  //   single int 50+           → medium tap
  //   [100, 50, 100]           → medium tap (interval threshold)
  //   [200, 100, 200]          → notification.warning (sequence complete)
  //   [200, 100, 200, 100, 200]→ notification.success (alarm)
  //   [30,40,30] / [120,80,120]→ short triplet of light taps (BFRB / recovery)
  function dispatchNativeHaptic(pattern) {
    const Haptics = plugins.Haptics;
    if (!Haptics) return;

    if (typeof pattern === 'number') {
      const style = pattern >= 50 ? 'MEDIUM' : 'LIGHT';
      Haptics.impact({ style }).catch(() => {});
      return;
    }

    if (!Array.isArray(pattern) || pattern.length === 0) return;

    // Single-element array — same as scalar
    if (pattern.length === 1) {
      const ms = pattern[0];
      const style = ms >= 50 ? 'MEDIUM' : 'LIGHT';
      Haptics.impact({ style }).catch(() => {});
      return;
    }

    // 5+ alternating elements → alarm: success notification haptic
    if (pattern.length >= 5) {
      Haptics.notification({ type: 'SUCCESS' }).catch(() => {});
      return;
    }

    // 3-element patterns: peak amplitude tells us alarm vs tick
    if (pattern.length === 3) {
      const peak = Math.max(pattern[0], pattern[2]);
      if (peak >= 200) {
        Haptics.notification({ type: 'WARNING' }).catch(() => {});
        return;
      }
      if (peak >= 100) {
        Haptics.impact({ style: 'MEDIUM' }).catch(() => {});
        return;
      }
      // Short triplet (e.g. BFRB recovery [30,40,30]) — three light taps
      Haptics.impact({ style: 'LIGHT' }).catch(() => {});
      setTimeout(() => Haptics.impact({ style: 'LIGHT' }).catch(() => {}), pattern[0] + pattern[1]);
      return;
    }

    // Fallback for any other shape
    Haptics.impact({ style: 'LIGHT' }).catch(() => {});
  }

  function haptic(pattern) {
    if (isNative) {
      dispatchNativeHaptic(pattern);
      return;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(pattern); } catch (_) {}
    }
  }

  // ── Notifications ────────────────────────────────────────────────────────

  // String IDs ('timer', 'pomodoro', 'cooking-3') → stable int IDs for Capacitor.
  function hashStringId(s) {
    let h = 0;
    const str = String(s);
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i) | 0;
    h = Math.abs(h);
    return h || 1; // avoid 0
  }

  // Map of string-id → int-id, so we can cancel by string id later.
  const nativeIdMap = new Map();
  function nativeIdFor(stringId) {
    if (!nativeIdMap.has(stringId)) nativeIdMap.set(stringId, hashStringId(stringId));
    return nativeIdMap.get(stringId);
  }

  function notify(title, opts) {
    opts = opts || {};
    if (isNative) {
      const LN = plugins.LocalNotifications;
      if (!LN) return;
      // Fire ~now (10ms in the future — required by some plugin versions)
      LN.schedule({
        notifications: [{
          id: hashStringId('immediate-' + Date.now() + '-' + Math.random()),
          title: title,
          body: opts.body || '',
          schedule: { at: new Date(Date.now() + 10) },
        }],
      }).catch(() => {});
      return;
    }
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    try { new Notification(title, opts); } catch (_) {}
  }

  function scheduleNotification(id, delayMs, title, body) {
    if (delayMs <= 0) return;
    if (isNative) {
      const LN = plugins.LocalNotifications;
      if (!LN) return;
      const intId = nativeIdFor(id);
      // Cancel any existing schedule for this id first (replace semantics).
      LN.cancel({ notifications: [{ id: intId }] }).catch(() => {});
      LN.schedule({
        notifications: [{
          id: intId,
          title: title || 'Tempo',
          body: body || 'Time is up!',
          schedule: { at: new Date(Date.now() + delayMs) },
        }],
      }).catch(() => {});
      return;
    }
    // Web path — keep using BgNotify (SW + setTimeout).
    if (typeof BgNotify !== 'undefined' && typeof BgNotify.schedule === 'function') {
      BgNotify.schedule(id, delayMs, title, body);
    }
  }

  function cancelNotification(id) {
    if (isNative) {
      const LN = plugins.LocalNotifications;
      if (!LN) return;
      LN.cancel({ notifications: [{ id: nativeIdFor(id) }] }).catch(() => {});
      return;
    }
    if (typeof BgNotify !== 'undefined' && typeof BgNotify.cancel === 'function') {
      BgNotify.cancel(id);
    }
  }

  function requestNotificationPermission() {
    if (isNative) {
      const LN = plugins.LocalNotifications;
      if (!LN) return Promise.resolve('denied');
      return LN.requestPermissions().then(
        (r) => (r && r.display) || 'denied',
        () => 'denied',
      );
    }
    if (typeof Notification === 'undefined') return Promise.resolve('denied');
    if (Notification.permission === 'granted') return Promise.resolve('granted');
    if (Notification.permission === 'denied') return Promise.resolve('denied');
    try { return Notification.requestPermission(); } catch (_) { return Promise.resolve('denied'); }
  }

  // ── Auth (B-2) ───────────────────────────────────────────────────────────
  //
  // Google sign-in shim. Mirrors the haptic/notify pattern: same public
  // method names work on web and native; the internal branch picks the
  // backend.
  //
  // - Web build: lazy dynamic import() of the modular firebase-app +
  //   firebase-auth bundles from gstatic CDN on first call (signIn / init).
  //   The SDK is NEVER imported at boot — only when the user opts into
  //   cloud sync AND triggers an auth flow. This keeps the dormant web
  //   boot byte-equivalent to pre-sync builds.
  // - Native build: routes to window.Capacitor.Plugins.FirebaseAuthentication
  //   (provided by @capacitor-firebase/authentication, installed in S0-1).
  //   No bundler needed — the plugin is injected into the WebView at
  //   native-shell boot.
  //
  // Returns a normalized User shape on both branches so the SyncAuth
  // facade stays platform-agnostic:
  //   { uid, email, displayName, photoURL }
  //
  // Contract:
  //   - All methods are no-ops when SyncFlag.isEnabled() === false.
  //   - signIn() returns null on user cancellation (popup-closed on web,
  //     plugin cancellation code on native) — never throws for cancellation.
  //   - getCurrentUser() returns the cached user; init() seeds the cache
  //     from the SDK's persisted state (handles cold-boot rehydrate).

  const FIREBASE_APP_URL  = 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
  const FIREBASE_AUTH_URL = 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';

  // Module-scoped caches so subsequent calls don't re-import or rebuild.
  let _webAuthSdk = null;            // { initializeApp, getApps, getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  let _webAuthInstance = null;       // the Auth instance returned by getAuth(app)
  let _webProvider = null;           // cached GoogleAuthProvider instance
  let _authCachedUser = null;        // in-shim cache of the current user (normalized)
  const _authListeners = [];         // callbacks registered via Platform.auth.onAuthChange
  let _authInitialized = false;      // idempotence guard for Platform.auth.init()
  let _authNativeUnavailableLogged = false;

  function _flagOn() {
    return typeof SyncFlag !== 'undefined' && SyncFlag.isEnabled();
  }

  function _normalizeUser(raw) {
    if (!raw) return null;
    return {
      uid: raw.uid || null,
      email: raw.email || null,
      displayName: raw.displayName || null,
      photoURL: raw.photoURL || null,
    };
  }

  function _emitAuth(user) {
    _authCachedUser = user || null;
    for (const cb of _authListeners.slice()) {
      try { cb(_authCachedUser); }
      catch (_e) { /* listener errors must not break the chain */ }
    }
  }

  // Load the modular firebase-app + firebase-auth bundles on demand. Cached
  // on the module so repeat calls are free. Returns the auth-module exports.
  async function _loadWebAuthSdk() {
    if (_webAuthSdk) return _webAuthSdk;
    const [appMod, authMod] = await Promise.all([
      import(/* @vite-ignore */ FIREBASE_APP_URL),
      import(/* @vite-ignore */ FIREBASE_AUTH_URL),
    ]);
    _webAuthSdk = {
      initializeApp:    appMod.initializeApp,
      getApps:          appMod.getApps,
      getAuth:          authMod.getAuth,
      GoogleAuthProvider: authMod.GoogleAuthProvider,
      signInWithPopup:  authMod.signInWithPopup,
      signOut:          authMod.signOut,
      onAuthStateChanged: authMod.onAuthStateChanged,
    };
    return _webAuthSdk;
  }

  async function _getWebAuth() {
    const sdk = await _loadWebAuthSdk();
    if (!_webAuthInstance) {
      const config = (typeof window !== 'undefined' && window.FirebaseConfig) || null;
      if (!config) throw new Error('FirebaseConfig missing — js/sync-firebase-config.js not loaded');
      const apps = sdk.getApps();
      const app = apps.length ? apps[0] : sdk.initializeApp(config);
      _webAuthInstance = sdk.getAuth(app);
    }
    if (!_webProvider) _webProvider = new sdk.GoogleAuthProvider();
    return { sdk, auth: _webAuthInstance, provider: _webProvider };
  }

  function _nativePlugin() {
    const fa = plugins && plugins.FirebaseAuthentication;
    if (!fa) {
      if (!_authNativeUnavailableLogged) {
        // Plugin missing — most likely cause is that `npx cap sync ios`
        // hasn't been re-run since S0-1 added the Podfile entry. Surface
        // once so a developer notices, but don't throw — SyncAuth's UI
        // layer will degrade gracefully.
        try { console.warn('[Platform.auth] FirebaseAuthentication plugin unavailable — rebuild iOS app via `npx cap sync ios`.'); } catch (_e) {}
        _authNativeUnavailableLogged = true;
      }
      return null;
    }
    return fa;
  }

  function authInit() {
    if (_authInitialized) return;
    if (!_flagOn()) return;       // flag-off: don't even mark initialized;
                                  // a later flag-flip + re-init should still work
    _authInitialized = true;

    if (isNative) {
      const fa = _nativePlugin();
      if (!fa) return;
      // Subscribe to the plugin's authStateChange event so signOut/signIn
      // performed outside our flow (e.g., system-level account removal)
      // still propagate to listeners.
      try {
        if (typeof fa.addListener === 'function') {
          fa.addListener('authStateChange', (event) => {
            const u = event && event.user ? _normalizeUser(event.user) : null;
            _emitAuth(u);
          });
        }
      } catch (_e) {}
      // Rehydrate the cached user (cold-boot path — the plugin persists
      // the auth state at the OS level via Firebase iOS SDK's keychain).
      try {
        const p = fa.getCurrentUser();
        if (p && typeof p.then === 'function') {
          p.then((result) => {
            const u = result && result.user ? _normalizeUser(result.user) : null;
            if (u) _emitAuth(u);
          }).catch(() => {});
        }
      } catch (_e) {}
      return;
    }

    // Web cold-boot rehydrate. The Firebase SDK persists auth state in
    // IndexedDB by default; loading the SDK and subscribing to
    // onAuthStateChanged seeds _authCachedUser with the previously
    // signed-in user (if any) without showing a popup.
    _loadWebAuthSdk()
      .then(() => _getWebAuth())
      .then(({ sdk, auth }) => {
        sdk.onAuthStateChanged(auth, (firebaseUser) => {
          _emitAuth(_normalizeUser(firebaseUser));
        });
      })
      .catch(() => {
        // CDN unreachable or import blocked — SyncAuth degrades to
        // "sign-in unavailable until next attempt." Don't throw; the
        // user's manual signIn() call will surface the failure path.
      });
  }

  async function authSignIn() {
    if (!_flagOn()) return null;

    if (isNative) {
      const fa = _nativePlugin();
      if (!fa) return null;
      try {
        const result = await fa.signInWithGoogle({ scopes: ['profile', 'email'] });
        const u = result && result.user ? _normalizeUser(result.user) : null;
        if (u) _emitAuth(u);
        return u;
      } catch (e) {
        // Capacitor Firebase Auth plugin throws on user cancellation.
        // Common shapes: { code: '12501' } (Android-style), or message
        // containing 'cancel'/'canceled' on iOS. Map all of these to
        // null so SyncAuth treats it as a no-op.
        if (_isCancellationError(e)) return null;
        throw e;
      }
    }

    // Web: lazy-load SDK, run popup flow.
    let ctx;
    try {
      ctx = await _getWebAuth();
    } catch (e) {
      throw e; // CDN/SDK load failure — surface to caller.
    }
    try {
      const result = await ctx.sdk.signInWithPopup(ctx.auth, ctx.provider);
      const u = _normalizeUser(result && result.user);
      if (u) _emitAuth(u);
      return u;
    } catch (e) {
      // Cancellation shapes on Firebase web:
      //   'auth/popup-closed-by-user'
      //   'auth/cancelled-popup-request'
      //   'auth/user-cancelled' (rare)
      if (_isCancellationError(e)) return null;
      throw e;
    }
  }

  function _isCancellationError(e) {
    if (!e) return false;
    const code = e.code || (e.error && e.error.code) || '';
    if (typeof code === 'string') {
      if (code.indexOf('popup-closed-by-user') !== -1) return true;
      if (code.indexOf('cancelled-popup-request') !== -1) return true;
      if (code.indexOf('user-cancelled') !== -1) return true;
      if (code === '12501') return true;
    }
    const msg = (e.message || e.errorMessage || '') + '';
    if (/cancel(l)?ed/i.test(msg)) return true;
    return false;
  }

  async function authSignOut() {
    if (!_flagOn()) {
      _emitAuth(null);
      return;
    }

    if (isNative) {
      const fa = _nativePlugin();
      if (!fa) {
        _emitAuth(null);
        return;
      }
      try { await fa.signOut(); } catch (_e) {}
      _emitAuth(null);
      return;
    }

    // Web: only signOut from SDK if it's been loaded — otherwise nothing
    // to clean up.
    if (_webAuthSdk && _webAuthInstance) {
      try { await _webAuthSdk.signOut(_webAuthInstance); } catch (_e) {}
    }
    _emitAuth(null);
  }

  function authGetCurrentUser() {
    return _authCachedUser;
  }

  function authOnChange(callback) {
    if (typeof callback !== 'function') return () => {};
    _authListeners.push(callback);
    return function unsubscribe() {
      const idx = _authListeners.indexOf(callback);
      if (idx !== -1) _authListeners.splice(idx, 1);
    };
  }

  const auth = {
    init:           authInit,
    signIn:         authSignIn,
    signOut:        authSignOut,
    getCurrentUser: authGetCurrentUser,
    onAuthChange:   authOnChange,
  };

  // ── Network (E-2) ─────────────────────────────────────────────────────
  //
  // Online/offline detection + subscription. Mirrors the Platform.auth
  // shim's web-vs-native pattern.
  //
  // - Web build: uses `navigator.onLine` for the synchronous `isOnline()`
  //   read and `window.addEventListener('online'/'offline')` for change
  //   notifications. `navigator.onLine` is famously unreliable on flaky
  //   Wi-Fi (Chrome / Safari / Firefox each have their quirks) — false
  //   positives are documented in the E-2 audit Risk #2; the
  //   dispatcher's offline-branch falls through to the 30s steady-state
  //   cycle on a spurious `true`, so correctness is preserved.
  // - Native build (Capacitor iOS): routes to
  //   `window.Capacitor.Plugins.Network` (from `@capacitor/network@^6.0.0`).
  //   `Network.getStatus()` is async, so the shim caches the latest
  //   `connected` value at module init + refreshes the cache on the
  //   `networkStatusChange` listener; subsequent `isOnline()` calls
  //   return the cached value synchronously.
  //
  // The dispatcher hook in `js/sync-engine.js:1911-1942` was wired
  // forward-compatibly in E-1b — once this shim lands, the existing
  // feature-detect block activates retroactively (steady-state
  // pause-on-offline + resume-on-online become real). The
  // `onChange` callback shape is duck-typed for `status.connected`,
  // `status.online`, and bare `true`/`false` — matching both Capacitor
  // and our web wrapper.
  //
  // Contract:
  //   - `isOnline()` is synchronous and returns a `boolean`. Defaults
  //     to `true` if the runtime offers no signal (safe default —
  //     forces the steady-state cycle to try; correctness via cloud-
  //     layer error handling).
  //   - `onChange(callback)` returns an unsubscribe fn.
  //   - All methods are independent of the cloud-sync flag — network
  //     detection is useful even when sync is off (future surfaces).

  let _networkCachedOnline = null;
  const _networkListeners = [];
  let _networkInitialized = false;
  let _networkNativeUnavailableLogged = false;
  let _networkNativePluginHandle = null;
  let _networkWebHandlersInstalled = false;

  function _networkPlugin() {
    const np = plugins && plugins.Network;
    if (!np) {
      if (!_networkNativeUnavailableLogged) {
        try { console.warn('[Platform.network] Capacitor Network plugin unavailable — rebuild iOS app via `npx cap sync ios`.'); } catch (_e) {}
        _networkNativeUnavailableLogged = true;
      }
      return null;
    }
    return np;
  }

  function _dispatchNetworkChange(status) {
    // Normalize a duck-typed status into the canonical
    // `{ connected: boolean }` shape consumed by listeners
    // (including the existing `js/sync-engine.js:1911-1942` hook).
    const online = (status && (status.connected === true || status.online === true)) ||
                   (status === 'online') || (status === true);
    const normalized = { connected: online === true };
    _networkCachedOnline = normalized.connected;
    for (const cb of _networkListeners.slice()) {
      try { cb(normalized); }
      catch (_e) { /* listener errors must not break the chain */ }
    }
  }

  function _networkInit() {
    if (_networkInitialized) return;
    _networkInitialized = true;

    if (isNative) {
      const np = _networkPlugin();
      if (!np) return;
      // Seed the synchronous cache from the plugin's async getStatus().
      // Until the first promise resolves, `isOnline()` falls back to
      // `navigator.onLine` (which the WKWebView still exposes), so the
      // dispatcher's pre-resolve offline check stays safe.
      try {
        const p = np.getStatus();
        if (p && typeof p.then === 'function') {
          p.then((status) => {
            const online = (status && status.connected === true) || status === true;
            _networkCachedOnline = online;
          }).catch(() => {});
        }
      } catch (_e) {}
      // Subscribe once so future native status changes refresh the
      // cache AND notify listeners. We stash the handle so a future
      // teardown can remove the listener.
      try {
        if (typeof np.addListener === 'function') {
          const handle = np.addListener('networkStatusChange', (status) => {
            _dispatchNetworkChange(status);
          });
          _networkNativePluginHandle = handle;
        }
      } catch (_e) {}
      return;
    }

    // Web branch: install the `online`/`offline` window listeners
    // exactly once. Each listener fires a normalized payload to
    // every registered callback.
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function'
        && !_networkWebHandlersInstalled) {
      _networkWebHandlersInstalled = true;
      try {
        window.addEventListener('online', () => _dispatchNetworkChange({ connected: true }));
        window.addEventListener('offline', () => _dispatchNetworkChange({ connected: false }));
      } catch (_e) {}
    }
  }

  function networkIsOnline() {
    // Defensive cache hit first — native branch updates this on every
    // status change; web branch updates it only via the event listeners.
    // If the cache is unset, fall through to navigator.onLine, which
    // both branches share (WKWebView still exposes it on iOS).
    if (_networkCachedOnline !== null) return _networkCachedOnline === true;
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      return navigator.onLine;
    }
    return true; // safe default — see audit Risk #2
  }

  function networkOnChange(callback) {
    if (typeof callback !== 'function') return () => {};
    // Lazy init — first listener registration arms the underlying
    // event/plugin wiring. Subsequent calls are no-ops.
    if (!_networkInitialized) {
      try { _networkInit(); } catch (_e) {}
    }
    _networkListeners.push(callback);
    return function unsubscribe() {
      const idx = _networkListeners.indexOf(callback);
      if (idx !== -1) _networkListeners.splice(idx, 1);
    };
  }

  const network = {
    isOnline: networkIsOnline,
    onChange: networkOnChange,
  };

  return {
    isNative,
    haptic,
    notify,
    scheduleNotification,
    cancelNotification,
    requestNotificationPermission,
    auth,
    network,
  };
})();
