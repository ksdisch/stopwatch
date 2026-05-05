// Auth surface for Tempo cloud sync.
//
// One module, two paths:
//   • Web build: firebase.auth().signInWithPopup(<provider>)
//   • Native iOS (Capacitor): @capacitor-firebase/authentication. The
//     native plugin presents the system Sign in with Apple sheet and
//     returns a Firebase credential we exchange for a Firebase user.
//
// All call sites use the same Auth.signInApple() / signInGoogle() API
// regardless of platform — the branch is hidden inside this module,
// matching the existing pattern in js/platform.js.

const Auth = (() => {
  const listeners = new Set();

  function onChange(cb) {
    if (typeof cb !== 'function') return () => {};
    listeners.add(cb);
    // Fire immediately with current state if known, so consumers don't
    // have to wait for the next auth-state change to render.
    try { cb(getCurrentUser()); } catch (_) {}
    return () => listeners.delete(cb);
  }

  function fire(user) {
    listeners.forEach(cb => {
      try { cb(user); } catch (_) {}
    });
  }

  // Wire up Firebase's onAuthStateChanged once the SDK is ready. Fires
  // every time the user signs in or out. Re-runs probeClockSkew on each
  // sign-in so we have skew data before the first sync write.
  function attach() {
    const fbAuth = Cloud && Cloud.getAuth();
    if (!fbAuth || typeof fbAuth.onAuthStateChanged !== 'function') return;
    fbAuth.onAuthStateChanged((user) => {
      if (user && Cloud && typeof Cloud.probeClockSkew === 'function') {
        // Don't await — fire-and-forget so the listener call stays sync.
        Cloud.probeClockSkew().catch(() => {});
      }
      fire(user);
    });
  }

  function getCurrentUser() {
    const fbAuth = Cloud && Cloud.getAuth();
    return (fbAuth && fbAuth.currentUser) || null;
  }

  // ── Native (Capacitor) path ─────────────────────────────────────────

  function nativePlugin() {
    if (typeof window === 'undefined') return null;
    const cap = window.Capacitor;
    const isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
    if (!isNative) return null;
    const plug = cap.Plugins && cap.Plugins.FirebaseAuthentication;
    return plug || null;
  }

  // The Capacitor plugin manages its own auth state in native land.
  // For Firestore JS reads/writes to work in the WebView we need the
  // matching Firebase JS user too — that's why we exchange the
  // native credential for a JS sign-in via signInWithCredential().
  async function signInNativeWithCredential(providerName, native) {
    const fb = window.firebase;
    const fbAuth = Cloud.getAuth();
    if (!fb || !fbAuth || !native || !native.credential) {
      throw new Error('native-credential-missing');
    }
    let credential = null;
    if (providerName === 'apple') {
      credential = fb.auth.OAuthProvider.credential('apple.com', {
        idToken: native.credential.idToken,
        rawNonce: native.credential.nonce,
      });
    } else if (providerName === 'google') {
      credential = fb.auth.GoogleAuthProvider.credential(
        native.credential.idToken,
        native.credential.accessToken,
      );
    }
    if (!credential) throw new Error('credential-build-failed');
    const result = await fbAuth.signInWithCredential(credential);
    return result && result.user;
  }

  // ── Public sign-in actions ──────────────────────────────────────────

  async function signInApple() {
    if (!ensureReady()) throw new Error('cloud-not-ready');
    const native = nativePlugin();
    if (native) {
      const result = await native.signInWithApple({
        skipNativeAuth: false,
      });
      // Some plugin versions auto-sign-in to Firebase JS; others return
      // a raw credential. Check first, fall back to manual exchange.
      if (Cloud.getAuth().currentUser) return Cloud.getAuth().currentUser;
      return signInNativeWithCredential('apple', result);
    }
    const fb = window.firebase;
    const provider = new fb.auth.OAuthProvider('apple.com');
    provider.addScope('email');
    provider.addScope('name');
    const result = await Cloud.getAuth().signInWithPopup(provider);
    return result && result.user;
  }

  async function signInGoogle() {
    if (!ensureReady()) throw new Error('cloud-not-ready');
    const native = nativePlugin();
    if (native) {
      const result = await native.signInWithGoogle({
        skipNativeAuth: false,
      });
      if (Cloud.getAuth().currentUser) return Cloud.getAuth().currentUser;
      return signInNativeWithCredential('google', result);
    }
    const fb = window.firebase;
    const provider = new fb.auth.GoogleAuthProvider();
    const result = await Cloud.getAuth().signInWithPopup(provider);
    return result && result.user;
  }

  async function signOut() {
    const native = nativePlugin();
    if (native && typeof native.signOut === 'function') {
      try { await native.signOut(); } catch (_) {}
    }
    const fbAuth = Cloud && Cloud.getAuth();
    if (fbAuth) await fbAuth.signOut();
  }

  function ensureReady() {
    if (!window.Cloud) return false;
    Cloud.init();
    return !!Cloud.getAuth();
  }

  return {
    attach, onChange, getCurrentUser,
    signInApple, signInGoogle, signOut,
  };
})();

window.Auth = Auth;
