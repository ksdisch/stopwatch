// B-1: Cloud-sync feature flag (off by default).
//
// `tempo_sync_enabled` is the localStorage key gating whether SyncEngine.init()
// does anything at all. Distinct from `tempo_sync_state` (persistence.js,
// F13) — that's the runtime write gate consulted on every engine save.
// Different key, different role:
//   - `tempo_sync_enabled` ('0' | '1', default absent → false): the user-
//     visible "Cloud Sync ON/OFF" feature flag. Owned here, flipped via
//     SyncFlag.enable() / .disable() (or the future B-2 settings drawer).
//   - `tempo_sync_state` ('hydrating' | 'ready' | 'error', default 'ready'):
//     internal pause-writes gate during sync transitions. Owned by
//     persistence.js's SyncState module.
//
// `disable()` writes '0' instead of removeItem() so a future debugger can
// distinguish "user explicitly turned sync off" from "user never opted in".
// Both paths are treated as off by `isEnabled()` (anything !== '1').

const SyncFlag = (() => {
  const STORAGE_KEY = 'tempo_sync_enabled';

  function isEnabled() {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function enable() {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch (e) {}
  }

  function disable() {
    try { localStorage.setItem(STORAGE_KEY, '0'); } catch (e) {}
  }

  return { isEnabled, enable, disable, STORAGE_KEY };
})();
