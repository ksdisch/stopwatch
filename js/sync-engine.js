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

  // B-3: re-entry guard for pushSnapshot. Concurrent click on the
  // "Push to cloud" button must not start two upload races (per audit
  // Risk #3). The second call returns the in-flight promise instead of
  // starting fresh.
  let _pushInFlight = false;
  let _currentPushPromise = null;

  // B-3: localStorage keys this module owns. tempo_sync_partial_upload_uid
  // records "this UID's cloud is mid-upload, not Stage D territory" so a
  // network-failure retry doesn't incorrectly route to the Stage D handoff.
  // tempo_sync_stage_d_handoff is the persistent flag D-1 will consume.
  const PARTIAL_UPLOAD_KEY = 'tempo_sync_partial_upload_uid';
  const STAGE_D_HANDOFF_KEY = 'tempo_sync_stage_d_handoff';

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

  // ── B-3: Cloud upload (pushSnapshot) ─────────────────────────────────
  //
  // Public flow:
  //   1. Preconditions: flag on, signed in, gate not already hydrating.
  //   2. F12 mandatory backup. Hard gate — no cloud byte moves until OK.
  //   3. F9 read-cloud-first guard. Pull each store's collection. If any
  //      has records AND the partial-upload marker doesn't match the
  //      current user, abort to Stage D handoff.
  //   4. F13 flip: SyncState.set('hydrating'). Set the partial-upload
  //      marker so a network failure mid-upload resumes correctly.
  //   5. Per-store upload loop in dependency order: rest_log → meds →
  //      presets → history. Within each store, per-record setDoc loop.
  //      F19a future-schema records are filtered out (preserved on disk,
  //      surfaced as a count to the caller).
  //   6. Success: clear partial-upload marker, set gate back to 'ready',
  //      emit push-complete { ok: true }.
  //   7. Failure: leave partial-upload marker in place (so retry resumes),
  //      set gate to 'error', emit push-complete { ok: false }.
  //
  // Return shape mirrors the audit's sign-off enum:
  //   { ok: true, uploaded: { rest_log, meds, presets, history }, skippedFutureRecords }
  //   { ok: false, kind: 'sign-in-required' | 'sync-not-enabled' |
  //                       'sync-error-state' | 'already-in-flight' |
  //                       'backup-failed' | 'stage-d-handoff' |
  //                       'upload-error' | 'snapshot-failed',
  //     error?, counts? }

  function _getStorage() {
    // Centralizing the localStorage access here keeps the SSR / Node
    // test harness from blowing up on direct localStorage.getItem.
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  }

  function getStageDHandoff() {
    const ls = _getStorage();
    if (!ls) return false;
    try { return ls.getItem(STAGE_D_HANDOFF_KEY) === '1'; }
    catch (_) { return false; }
  }

  function setStageDHandoff() {
    const ls = _getStorage();
    if (!ls) return;
    try { ls.setItem(STAGE_D_HANDOFF_KEY, '1'); } catch (_) {}
  }

  function _getPartialUploadUid() {
    const ls = _getStorage();
    if (!ls) return null;
    try { return ls.getItem(PARTIAL_UPLOAD_KEY); } catch (_) { return null; }
  }

  function setPartialUploadMarker(uid) {
    const ls = _getStorage();
    if (!ls || !uid) return;
    try { ls.setItem(PARTIAL_UPLOAD_KEY, String(uid)); } catch (_) {}
  }

  function clearPartialUploadMarker() {
    const ls = _getStorage();
    if (!ls) return;
    try { ls.removeItem(PARTIAL_UPLOAD_KEY); } catch (_) {}
  }

  // Probe the cloud per-store. Returns { isEmpty, counts }.
  async function _pullCloudSnapshot(uid) {
    const counts = {};
    let total = 0;
    for (const { key } of SYNCED_STORES) {
      const result = await SyncFirestore.getCollection(`users/${uid}/${key}`);
      const c = (result && typeof result.count === 'number') ? result.count : 0;
      counts[key] = c;
      total += c;
    }
    return { isEmpty: total === 0, counts };
  }

  // Pull the per-record list from each store's snapshot envelope. Each
  // adapter returns `{ deviceId, schemaVersion, payload: { <storeKey>: ... } }`,
  // but the inner payload shape varies:
  //   - meds:     payload.meds      = Array<med record>
  //   - history:  payload.sessions  = Array<session record>
  //   - rest_log: payload.rest_log  = Object<date → entry>   (NOT an array)
  //   - presets:  payload.presets   = Array<preset record>
  //
  // Returns an array of `{ id, record }` tuples — `id` is the Firestore
  // doc id, `record` is the full inner record. For rest_log the id is
  // the YYYY-MM-DD key; for the others it's `record.id`. If the inner
  // record lacks an id (defensive guard), we fall back to a deterministic
  // index-based id so the upload doesn't silently drop records.
  function _extractRecords(storeKey, snapshot) {
    if (!snapshot || !snapshot.payload) return [];
    const out = [];
    if (storeKey === 'rest_log') {
      const obj = snapshot.payload.rest_log || {};
      for (const key of Object.keys(obj)) {
        // The rest_log entry has no inner id; the date key IS the id.
        // We stamp the date onto a shallow copy so future per-record
        // merge code (E-1) can find it without re-deriving from path.
        const entry = obj[key] || {};
        out.push({ id: key, record: Object.assign({ date: key }, entry) });
      }
      return out;
    }
    // Array-of-records shape for meds / history / presets.
    const innerKey = storeKey === 'history' ? 'sessions' : storeKey;
    const arr = snapshot.payload[innerKey];
    if (!Array.isArray(arr)) return [];
    for (let i = 0; i < arr.length; i++) {
      const rec = arr[i] || {};
      const id = rec.id || `_idx_${i}`;
      out.push({ id, record: rec });
    }
    return out;
  }

  async function pushSnapshot() {
    // Re-entry guard — concurrent click returns the in-flight promise.
    if (_pushInFlight && _currentPushPromise) {
      return _currentPushPromise;
    }

    _pushInFlight = true;
    _currentPushPromise = (async () => {
      // ── Preconditions ─────────────────────────────────────────────
      if (typeof SyncFlag === 'undefined' || !SyncFlag.isEnabled()) {
        return { ok: false, kind: 'sync-not-enabled' };
      }
      if (typeof SyncAuth === 'undefined' || !SyncAuth.getCurrentUser) {
        return { ok: false, kind: 'sign-in-required' };
      }
      const user = SyncAuth.getCurrentUser();
      if (!user || !user.uid) {
        return { ok: false, kind: 'sign-in-required' };
      }
      // SyncState gate — if already hydrating (e.g. another push is
      // mid-flight from a different code path), refuse.
      if (typeof SyncState !== 'undefined') {
        const state = SyncState.get();
        if (state === 'hydrating') {
          return { ok: false, kind: 'already-in-flight' };
        }
        if (state === 'error') {
          // The UI maps this to "Retry sync" — caller decides to
          // SyncState.set('ready') then re-invoke. Don't auto-clear
          // here, because that would hide failures from the user.
          return { ok: false, kind: 'sync-error-state' };
        }
      }

      // ── F12: Mandatory local backup ──────────────────────────────
      emit('push-progress', { stage: 'backup' });
      let backupResult;
      try {
        if (typeof Backup === 'undefined' || typeof Backup.exportLocal !== 'function') {
          backupResult = { ok: false, error: new Error('Backup module unavailable') };
        } else {
          backupResult = await Backup.exportLocal();
        }
      } catch (err) {
        backupResult = { ok: false, error: err };
      }
      if (!backupResult || backupResult.ok !== true) {
        // No cloud byte moves. Gate stays 'ready' so engine writes
        // continue locally. UI re-enables the button for retry.
        const result = {
          ok: false,
          kind: 'backup-failed',
          error: backupResult && backupResult.error,
        };
        emit('push-complete', result);
        return result;
      }

      // ── F9: Read-cloud-first guard ────────────────────────────────
      emit('push-progress', { stage: 'checking-cloud' });
      let cloudProbe;
      try {
        cloudProbe = await _pullCloudSnapshot(user.uid);
      } catch (err) {
        // Cloud probe failed — treat as upload error (we can't even
        // verify F9). State stays ready (we never flipped to hydrating
        // yet), so local writes keep working.
        const result = {
          ok: false,
          kind: 'upload-error',
          error: err,
        };
        emit('push-complete', result);
        return result;
      }

      if (!cloudProbe.isEmpty) {
        // Cloud has data. Distinguish "my failed retry" from "another
        // device's existing data" via the partial-upload marker.
        const markerUid = _getPartialUploadUid();
        if (markerUid !== user.uid) {
          // Genuine Stage D handoff. Flag is persistent so D-1 can
          // detect "this device already saw cloud data on this
          // account" and re-prompt for reconciliation.
          setStageDHandoff();
          const result = {
            ok: false,
            kind: 'stage-d-handoff',
            counts: cloudProbe.counts,
          };
          emit('push-complete', result);
          return result;
        }
        // Else: this is our own retry — treat as cloud-empty and
        // re-upload from the start (setDoc is idempotent per record id).
      }

      // ── F13: Flip the write gate before any setDoc ────────────────
      if (typeof SyncState !== 'undefined') {
        try { SyncState.set('hydrating'); } catch (_) {}
      }
      setPartialUploadMarker(user.uid);

      // ── Build atomic in-memory snapshot ──────────────────────────
      let snapshot;
      try {
        snapshot = await getSnapshot();
      } catch (err) {
        // Snapshot read failed (e.g. IDB corruption). Clear gate +
        // partial marker so we don't wedge — the local store is fine,
        // we just couldn't read it.
        if (typeof SyncState !== 'undefined') {
          try { SyncState.set('error'); } catch (_) {}
        }
        const result = {
          ok: false,
          kind: 'snapshot-failed',
          error: err,
        };
        emit('push-complete', result);
        return result;
      }

      // ── Per-store upload loop (rest_log → meds → presets → history) ─
      const storeOrder = ['rest_log', 'meds', 'presets', 'history'];
      const uploaded = { rest_log: 0, meds: 0, presets: 0, history: 0 };
      let skippedFutureRecords = 0;

      for (const storeKey of storeOrder) {
        const records = _extractRecords(storeKey, snapshot[storeKey]);
        const total = records.length;
        for (let i = 0; i < records.length; i++) {
          const { id, record } = records[i];
          // F19a: skip future-schema records — they stay byte-clean on
          // disk and we surface the count in the result.
          if (typeof Schema !== 'undefined' && typeof Schema.isFutureRecord === 'function' &&
              Schema.isFutureRecord(record)) {
            skippedFutureRecords++;
            continue;
          }
          emit('push-progress', {
            stage: 'uploading',
            store: storeKey,
            current: i + 1,
            total,
          });
          try {
            await SyncFirestore.setDoc(`users/${user.uid}/${storeKey}/${id}`, record);
            uploaded[storeKey]++;
          } catch (err) {
            // Leave partial-upload marker in place so the retry path
            // (next click) resumes correctly (treats cloud as empty).
            if (typeof SyncState !== 'undefined') {
              try { SyncState.set('error'); } catch (_) {}
            }
            const result = {
              ok: false,
              kind: 'upload-error',
              store: storeKey,
              error: err,
              uploaded,
            };
            emit('push-complete', result);
            return result;
          }
        }
      }

      // ── Success ───────────────────────────────────────────────────
      clearPartialUploadMarker();
      if (typeof SyncState !== 'undefined') {
        try { SyncState.set('ready'); } catch (_) {}
      }
      const success = {
        ok: true,
        uploaded,
        skippedFutureRecords,
      };
      emit('push-complete', success);
      return success;
    })();

    // Always clear the in-flight latch when the promise settles —
    // regardless of success / failure / throw. Without this, a
    // failed push would permanently wedge the gate.
    const promise = _currentPushPromise;
    promise.finally(() => {
      _pushInFlight = false;
      _currentPushPromise = null;
    });
    return promise;
  }

  return {
    init, enable, disable, getState, getSnapshot,
    on, off, emit,
    // B-3: cloud upload + state helpers.
    pushSnapshot,
    getStageDHandoff,
    setStageDHandoff,
    setPartialUploadMarker,
    clearPartialUploadMarker,
  };
})();
