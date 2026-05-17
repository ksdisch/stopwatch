// B-2: SyncAuth — Google sign-in engine (platform-agnostic facade).
//
// Public API:
//   SyncAuth.init()             : void — idempotent; no-op when SyncFlag is off.
//   SyncAuth.signIn()           : Promise<User|null>  — null on user cancellation.
//   SyncAuth.signOut()          : Promise<void>
//   SyncAuth.getCurrentUser()   : User|null
//   SyncAuth.onAuthChange(cb)   : () => void  (unsubscribe)
//
// User shape (normalized across web + native):
//   { uid: string, email: string|null, displayName: string|null, photoURL: string|null }
//
// Scope discipline for B-2:
//   - No DOM access. Pure data + lifecycle.
//   - No Firebase imports. All SDK access goes through Platform.auth.*.
//   - No fetch.
//   - No mutation of `tempo_sync_state` (F13 write gate). Auth state changes
//     do NOT call SyncState.set(). The gate is owned by the upload + hydrate
//     paths (B-3, C-1). See B-2-AUDIT Headline #5 + invariant row "B-2 new".
//
// B-2 invariant (new, layered onto F13):
//   "Auth state gates cloud writes." SyncEngine.pushSnapshot() (B-3) MUST
//   verify SyncAuth.getCurrentUser() !== null before any Firestore call.
//   B-2 ships the gate-checker (getCurrentUser); B-3 wires it into the
//   upload path.

const SyncAuth = (() => {
  let _initialized = false;
  let _currentUser = null;        // in-memory cache of the user; null when signed out
  const _listeners = [];          // array of onAuthChange callbacks
  let _platformUnsubscribe = null; // teardown for Platform.auth.onAuthChange

  // Hard ceiling on how long we wait for `Platform.auth.signIn()` to settle
  // before failing the call with a structured timeout error. PR #74 fixed
  // the iOS Podfile race that caused the native promise to never resolve,
  // but the JS-side defense was deferred — without a cap, any future
  // plugin / SDK regression silently hangs the UI on "Signing in…".
  // 60s comfortably covers an interactive OAuth flow (account picker +
  // password + 2FA) without making a wedged plugin feel permanent.
  const SIGN_IN_TIMEOUT_MS = 60000;

  // ── Internal: dispatch a state transition ────────────────────────────────
  //
  // Single entry point for "user changed" — keeps the cache, local listeners,
  // and SyncEngine emission in lockstep so a future caller doesn't get a stale
  // value via getCurrentUser() between emit and cache write.

  function _setUser(user) {
    _currentUser = user || null;
    for (const cb of _listeners.slice()) {
      try { cb(_currentUser); }
      catch (e) { /* listener errors must not break the chain */ }
    }
    // SyncEngine is a sibling singleton from B-1; emit() exists from the
    // very first init. Fall through silently if SyncEngine isn't on the page
    // (e.g., test harness loading sync-auth.js in isolation).
    if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.emit === 'function') {
      SyncEngine.emit('auth-change', _currentUser);
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  function init() {
    if (_initialized) return;     // idempotent — second call is a no-op
    if (typeof SyncFlag === 'undefined' || !SyncFlag.isEnabled()) {
      // Flag-off branch still marks initialized so a double-init from app.js
      // is cheap. NO SDK touch.
      _initialized = true;
      return;
    }
    _initialized = true;

    if (typeof Platform === 'undefined' || !Platform.auth) {
      // Platform shim missing the auth namespace — should never happen in
      // production (platform.js loads before sync-auth.js per index.html
      // script order), but stay defensive so unit-test harnesses that only
      // load sync-auth.js don't blow up.
      return;
    }

    // Bring the Platform shim online (lazy-loads SDK on web, subscribes to
    // the Capacitor plugin's authStateChange on native). Safe to call when
    // the flag is on — Platform.auth.init() is itself a no-op when flag is
    // off, so double-checking here keeps the contract layered.
    try { Platform.auth.init(); } catch (e) { /* swallow — UI surfaces errors */ }

    // Seed the cache from whatever the platform layer believes (handles
    // cold-boot rehydrate when the SDK has a persisted user in IDB).
    try {
      const seed = Platform.auth.getCurrentUser();
      if (seed) _currentUser = seed;
    } catch (e) { /* ignore — leave _currentUser null */ }

    // Subscribe to ongoing state changes. _setUser fans out to local
    // listeners + SyncEngine.emit. Capture the unsubscribe in case a future
    // PR adds a teardown hook (B-2 itself never tears down — engine lives
    // for the page lifetime).
    try {
      _platformUnsubscribe = Platform.auth.onAuthChange((user) => {
        _setUser(user);
      });
    } catch (e) { /* swallow — auth still works on demand via signIn() */ }
  }

  // ── Sign in / out ────────────────────────────────────────────────────────

  async function signIn() {
    if (typeof Platform === 'undefined' || !Platform.auth) return null;
    try {
      // Promise.race against SIGN_IN_TIMEOUT_MS so a non-resolving native
      // promise (the iOS race PR #74 fixed at the Podfile layer; this is
      // the JS-side defense) can't strand the UI on "Signing in…". If
      // Platform.auth.signIn eventually resolves with a user after the
      // race lost, the cached _setUser path is unreachable from here,
      // but the platform-layer onAuthChange subscriber (wired in init())
      // still picks it up — so the user becomes signed-in via the next
      // auth-change emission, no manual retry needed.
      let timeoutId = null;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const err = new Error('Sign-in timed out. Try again.');
          err.code = 'auth/timeout';
          reject(err);
        }, SIGN_IN_TIMEOUT_MS);
      });
      let user;
      try {
        user = await Promise.race([Platform.auth.signIn(), timeout]);
      } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
      }
      if (!user) {
        // User cancelled (popup-closed-by-user on web, plugin cancellation
        // on native). Do NOT fire auth-change — UI stays on signed-out.
        return null;
      }
      _setUser(user);
      return user;
    } catch (e) {
      // Surface for upstream UI handling (B-2's settings drawer in Phase 4
      // converts thrown errors to an inline error message). Local cache
      // stays untouched — getCurrentUser() still returns the pre-failure
      // value.
      throw e;
    }
  }

  async function signOut() {
    if (typeof Platform === 'undefined' || !Platform.auth) {
      _setUser(null);
      return;
    }
    try {
      await Platform.auth.signOut();
    } catch (e) {
      // Even on plugin/SDK error, clear local state so the UI doesn't
      // wedge on a signed-in label after the user explicitly signed out.
    }
    _setUser(null);
  }

  // ── Accessors ────────────────────────────────────────────────────────────

  function getCurrentUser() {
    return _currentUser;
  }

  function onAuthChange(callback) {
    if (typeof callback !== 'function') return () => {};
    _listeners.push(callback);
    return function unsubscribe() {
      const idx = _listeners.indexOf(callback);
      if (idx !== -1) _listeners.splice(idx, 1);
    };
  }

  return {
    init,
    signIn,
    signOut,
    getCurrentUser,
    onAuthChange,
  };
})();

if (typeof window !== 'undefined') {
  window.SyncAuth = SyncAuth;
}
