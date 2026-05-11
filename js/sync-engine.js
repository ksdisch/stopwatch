// B-1: SyncEngine — registry + lifecycle scaffold for cloud sync.
//
// This module ships the skeleton only. Zero network calls, zero behavior
// change when `tempo_sync_enabled === '0'` (the default). Future PRs wire
// it up:
//   - B-2: Google sign-in (auth-change events emitted from here).
//   - B-3: First cloud byte — `pushSnapshot()` consumes `getSnapshot()`
//     output and uploads to Firestore via the registry's `write` callback
//     (today's `writeStub`).
//   - C-1+: Cross-device hydrate, real-time listeners, merge-complete and
//     meds-arrival events fired through the emitter exposed here.
//
// Scope discipline for B-1:
//   - `init()` is a no-op when the flag is off. With the flag on, it's
//     also still a no-op (the engine has nothing to do until B-2/B-3).
//   - `init()` does NOT read any store. It only checks the flag and sets
//     `_initialized`. Reading a store would couple boot order to
//     History.init()'s async IDB open, which the audit explicitly
//     dispatches to the B-3 snapshot path instead.
//   - No DOM access. No Firebase imports. No fetch.
//   - Event emitter is wired but `emit()` is never called from inside
//     this module in B-1.

const SyncEngine = (() => {
  let _initialized = false;
  const _listeners = new Map();  // event name → Set<callback>

  // ── Store registry ────────────────────────────────────────────────────
  //
  // Hardcoded list of synced-eligible stores. Order here matches the audit:
  // meds → history → rest_log → presets. For snapshot the order is purely
  // cosmetic; B-3's hydrate ordering can diverge.
  //
  // Each adapter's `read` returns the per-store envelope
  // `{ deviceId, schemaVersion, payload }`. Sync adapters can be either
  // sync or async — getSnapshot() wraps each return in `Promise.resolve()`
  // so callers always `await` uniformly.
  //
  // `write` is a documented stub for B-1. B-3 wires the real uploader,
  // which will call `adapter.write(record)` per record (not per store) on
  // the steady-state push path.
  function writeStub(/* record */) {
    // B-3 implements; B-1 ships the registry shape only.
    return Promise.resolve();
  }

  const SYNCED_STORES = [
    { key: 'meds',     adapter: { read: () => MedsManager.snapshotForSync(), write: writeStub } },
    { key: 'history',  adapter: { read: () => History.snapshotForSync(),     write: writeStub } },
    { key: 'rest_log', adapter: { read: () => RecoveryUI.snapshotForSync(),  write: writeStub } },
    { key: 'presets',  adapter: { read: () => Presets.snapshotForSync(),     write: writeStub } },
  ];

  // ── Lifecycle ─────────────────────────────────────────────────────────

  function init() {
    if (_initialized) return;            // idempotent — second call is a no-op
    if (!SyncFlag.isEnabled()) {
      _initialized = true;               // flag-off branch still marks initialized
      return;                            // so a double-init from app.js is cheap
    }
    // Flag-on branch is still a no-op in B-1: no auth, no snapshot, no
    // listener registration. B-2 wires the auth handshake here.
    _initialized = true;
  }

  function enable() {
    // B-2 will also fire auth-related side effects from here.
    SyncFlag.enable();
  }

  function disable() {
    // B-2 will also tear down any active listeners from here.
    SyncFlag.disable();
  }

  function getState() {
    return {
      enabled: SyncFlag.isEnabled(),
      initialized: _initialized,
    };
  }

  // ── Snapshot ──────────────────────────────────────────────────────────
  //
  // Returns the full per-store snapshot in the wire format B-3's uploader
  // expects. Async — History.snapshotForSync() awaits IDB; the others are
  // synchronous but wrapped in Promise.resolve() for iterator uniformity.

  async function getSnapshot() {
    const result = {};
    for (const { key, adapter } of SYNCED_STORES) {
      result[key] = await Promise.resolve(adapter.read());
    }
    return result;
  }

  // ── Event emitter ─────────────────────────────────────────────────────
  //
  // Minimal sync emitter. Future events:
  //   - 'auth-change'      (B-2)  payload: { uid, email } | null
  //   - 'merge-complete'   (D-2)  payload: { store, count }
  //   - 'meds-arrival'     (B-4)  payload: { medId }
  //   - 'error'            (any)  payload: { stage, error }
  // B-1 ships the API surface but does not emit any event.

  function on(event, callback) {
    if (typeof event !== 'string' || typeof callback !== 'function') return;
    if (!_listeners.has(event)) _listeners.set(event, new Set());
    _listeners.get(event).add(callback);
  }

  function off(event, callback) {
    const set = _listeners.get(event);
    if (set) set.delete(callback);
  }

  function emit(event, payload) {
    const set = _listeners.get(event);
    if (!set) return;
    for (const cb of set) {
      try { cb(payload); }
      catch (e) { /* listener errors must not break the emit chain */ }
    }
  }

  return {
    init, enable, disable, getState, getSnapshot,
    on, off, emit,
  };
})();
