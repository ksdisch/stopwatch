// Sync registry — generic infrastructure shared by every per-domain
// sync module. Owns:
//
//   • The outbox (pending writes that piled up before sign-in or
//     while offline beyond Firestore's own queue).
//   • The auth-change listener that triggers initial pulls + flush.
//   • The visibility/foreground listener that re-pulls when the user
//     comes back to the tab.
//   • The status broadcast that cloud-ui.js renders into the
//     Settings drawer ("Last synced 2s ago").
//
// Domain modules (sync-prefs, sync-meds, sync-bfrb, sync-rest) register
// themselves with `Sync.register({ key, ...handlers })`. The registry
// then knows how to push their local changes to Firestore and how to
// merge incoming remote changes back into localStorage / IndexedDB.
//
// The registry is a no-op when:
//   • Cloud sync is disabled (`cloud_sync_enabled !== '1'`)
//   • Firebase failed to load or isn't configured
//   • The user is signed out
//
// In all those cases, `Sync.notifyLocalChange()` returns immediately —
// the existing local writes in meds.js / global-bfrb.js / etc. are
// always the source of truth.

const Sync = (() => {
  const handlers = new Map(); // key -> handler config
  const statusListeners = new Set();
  let lastSyncedAt = null;
  let pendingCount = 0;
  let syncing = false;
  let lastError = null;
  let initialized = false;

  // ── Registration ────────────────────────────────────────────────────

  // Register a sync handler for a domain (e.g. 'wellness_meds').
  // Required:
  //   key       - string. Unique. Usually matches the localStorage key.
  //   push(user) - async. Push local changes for this domain to cloud.
  //   pull(user) - async. Pull remote changes and merge into local.
  // Optional:
  //   subscribe(user) - return an unsubscribe fn. Sets up onSnapshot
  //                     listeners for real-time updates while online.
  function register(handler) {
    if (!handler || typeof handler.key !== 'string') {
      throw new Error('Sync.register requires { key, push, pull }');
    }
    handlers.set(handler.key, handler);
  }

  // ── Status reporting ────────────────────────────────────────────────

  function getStatus() {
    return {
      enabled: !!(window.Cloud && Cloud.isEnabled()),
      signedIn: !!(window.Auth && Auth.getCurrentUser()),
      syncing, pendingCount, lastSyncedAt, lastError,
      handlers: Array.from(handlers.keys()),
    };
  }

  function onStatus(cb) {
    if (typeof cb !== 'function') return () => {};
    statusListeners.add(cb);
    try { cb(getStatus()); } catch (_) {}
    return () => statusListeners.delete(cb);
  }

  function emitStatus() {
    const s = getStatus();
    statusListeners.forEach(cb => { try { cb(s); } catch (_) {} });
  }

  // ── Local write hook ────────────────────────────────────────────────

  // Domain modules call this AFTER writing to localStorage / IndexedDB.
  // No-op when cloud sync is disabled or signed out — meaning the same
  // call site works whether the user has cloud sync on or off.
  function notifyLocalChange(key, payload) {
    if (!isReady()) return;
    const handler = handlers.get(key);
    if (!handler) return;
    pendingCount++;
    emitStatus();
    runPush(handler, { key, payload }).finally(() => {
      pendingCount = Math.max(0, pendingCount - 1);
      emitStatus();
    });
  }

  async function runPush(handler, evt) {
    if (typeof handler.push !== 'function') return;
    const user = Auth.getCurrentUser();
    if (!user) return;
    try {
      await handler.push(user, evt);
      lastSyncedAt = Date.now();
      lastError = null;
    } catch (err) {
      lastError = (err && err.message) || String(err);
      // Swallow the error — we don't want a sync failure to bubble
      // into local UI. Status panel surfaces it via lastError.
    }
  }

  // ── Auth-state-driven cycle ─────────────────────────────────────────

  async function fullSyncCycle() {
    if (!isReady()) return;
    const user = Auth.getCurrentUser();
    if (!user) return;
    syncing = true;
    emitStatus();
    try {
      // Pull first so local merge sees remote state.
      for (const handler of handlers.values()) {
        if (typeof handler.pull === 'function') {
          try { await handler.pull(user); }
          catch (err) { lastError = (err && err.message) || String(err); }
        }
      }
      // Then push any local changes that arrived during pull.
      for (const handler of handlers.values()) {
        if (typeof handler.push === 'function') {
          try { await handler.push(user, { reason: 'full-sync' }); }
          catch (err) { lastError = (err && err.message) || String(err); }
        }
      }
      lastSyncedAt = Date.now();
    } finally {
      syncing = false;
      emitStatus();
    }
  }

  function isReady() {
    if (!window.Cloud || !window.Auth) return false;
    if (!Cloud.isEnabled()) return false;
    Cloud.init();
    if (!Cloud.getDb() || !Cloud.getAuth()) return false;
    return !!Auth.getCurrentUser();
  }

  // ── Auto-sync wrapper around localStorage.setItem ───────────────────

  // Wrap localStorage.setItem so every write to a registered key auto-
  // fires notifyLocalChange. This is what makes the existing per-pref
  // call sites (themes.js, audio.js, ui.js, analog.js, etc.) sync
  // without needing 11 one-liner edits across the codebase. Domain
  // modules that own larger objects (meds, bfrb, rest) still call
  // notifyLocalChange explicitly because they often want to push the
  // *event* (e.g. "dose logged") rather than just the underlying blob.
  let applyingRemote = 0;

  // Pull paths wrap their localStorage writes in withApplyingRemote() so
  // the setItem hook doesn't fire a push back to the cloud — that would
  // create a ping-pong of remote-apply → re-push every sync cycle.
  function withApplyingRemote(fn) {
    applyingRemote++;
    try { return fn(); }
    finally { applyingRemote = Math.max(0, applyingRemote - 1); }
  }
  async function withApplyingRemoteAsync(fn) {
    applyingRemote++;
    try { return await fn(); }
    finally { applyingRemote = Math.max(0, applyingRemote - 1); }
  }

  function attachSetItemHook() {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (window.__cloudSyncSetItemHooked) return;
    const proto = Object.getPrototypeOf(localStorage);
    const original = proto.setItem.bind(localStorage);
    proto.setItem = function (key, value) {
      original(key, value);
      if (applyingRemote > 0) return; // suppress while applying remote pulls
      try {
        if (handlers.has(key)) notifyLocalChange(key);
      } catch (_) {}
    };
    window.__cloudSyncSetItemHooked = true;
  }

  // ── Boot ────────────────────────────────────────────────────────────

  function init() {
    if (initialized) return;
    initialized = true;

    attachSetItemHook();

    if (!window.Cloud) return;
    Cloud.init();

    // Hook auth state changes — sign-in triggers a full sync cycle, and
    // sign-out clears state.
    if (window.Auth) {
      Auth.attach();
      Auth.onChange((user) => {
        if (user && Cloud.isEnabled()) {
          fullSyncCycle().catch(() => {});
        } else if (!user) {
          // Reset transient sync stats when signed out.
          pendingCount = 0;
          syncing = false;
          emitStatus();
        }
      });
    }

    // Re-pull when the tab comes back to the foreground — handles the
    // common "phone in pocket, laptop in front of me" case.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && isReady()) {
          fullSyncCycle().catch(() => {});
        }
      });
    }
  }

  // ── Helpers exposed to domain handlers ──────────────────────────────

  // Stamp an outgoing doc with the standard sync metadata.
  function stampDoc(doc) {
    const fb = window.firebase;
    const out = Object.assign({}, doc);
    out.schemaVersion = 1;
    out.clientUpdatedAt = (window.Cloud && Cloud.nowSkewed) ? Cloud.nowSkewed() : Date.now();
    out.clientId = (window.Cloud && Cloud.getClientId) ? Cloud.getClientId() : 'unknown';
    if (fb && fb.firestore && fb.firestore.FieldValue) {
      out.updatedAt = fb.firestore.FieldValue.serverTimestamp();
    }
    return out;
  }

  // Last-write-wins comparator used by domain merge functions.
  // Returns 'remote' if the remote doc is newer, else 'local'.
  function lwwWinner(localClientUpdatedAt, remoteClientUpdatedAt) {
    const a = Number(localClientUpdatedAt) || 0;
    const b = Number(remoteClientUpdatedAt) || 0;
    if (b > a) return 'remote';
    return 'local';
  }

  return {
    register, init, getStatus, onStatus,
    notifyLocalChange, fullSyncCycle, isReady,
    stampDoc, lwwWinner,
    withApplyingRemote, withApplyingRemoteAsync,
  };
})();

window.Sync = Sync;

// Auto-init at DOM-ready. By the time this fires, every per-domain
// sync module has already registered its handler at IIFE time (script
// load order in index.html guarantees this), so Sync.init() can wire
// auth + visibility listeners against the full handler set.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Sync.init());
  } else {
    // Defer one tick so per-domain modules loaded after sync-registry
    // get a chance to register before init() runs.
    setTimeout(() => Sync.init(), 0);
  }
}
