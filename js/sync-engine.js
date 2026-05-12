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

  // C-1: re-entry guard for hydrateFromCloud. The boot-trigger
  // (SyncAuth.onAuthChange) can fire twice during cold boot (once for
  // the SDK rehydrate, once for the platform shim seed). The second call
  // returns the in-flight promise — same pattern as _pushInFlight.
  let _hydrateInFlight = false;
  let _currentHydratePromise = null;

  // C-1: tracks whether init() already wired the SyncAuth.onAuthChange
  // subscription so re-calling init() doesn't register the handler twice.
  let _authChangeUnsubscribe = null;

  // B-3: localStorage keys this module owns. tempo_sync_partial_upload_uid
  // records "this UID's cloud is mid-upload, not Stage D territory" so a
  // network-failure retry doesn't incorrectly route to the Stage D handoff.
  // tempo_sync_stage_d_handoff is the persistent flag D-1 will consume.
  const PARTIAL_UPLOAD_KEY = 'tempo_sync_partial_upload_uid';
  const STAGE_D_HANDOFF_KEY = 'tempo_sync_stage_d_handoff';

  // C-1: per-store + per-`all` hydrate markers. Audit Headline #3 — five
  // separate keys (rather than a single JSON-encoded value) for cheaper
  // primitives, no parse cost, and easier debugging via dev tools. Each
  // per-store marker is written ONLY after that store's hydrateFromCloud
  // resolves; _all is written ONLY after every store completes AND the
  // success branch is reached. Boot-trigger short-circuits on _all.
  const HYDRATE_MARKER_PREFIX = 'tempo_sync_hydrated_';
  const HYDRATE_MARKER_ALL    = HYDRATE_MARKER_PREFIX + 'all';
  // C-1: strict pull order is rest_log → meds → presets → history. Matches
  // B-3's upload order. History last because it's IDB-backed (async) and
  // can be large — keeping it at the tail lets the synchronous-store
  // hydrates (rest_log/meds/presets) finish quickly and progress events
  // fire crisply for UX.
  const HYDRATE_STORE_ORDER = ['rest_log', 'meds', 'presets', 'history'];

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
    _initialized = true;

    // C-1: subscribe to auth-change so a first sign-in (cold boot SDK
    // rehydrate, or user clicking "Sign in" later) auto-triggers hydrate
    // when the four-condition gate is satisfied. Defensive `typeof` guard
    // keeps the engine usable in test contexts that don't load sync-auth.js.
    if (typeof SyncAuth !== 'undefined' && typeof SyncAuth.onAuthChange === 'function') {
      // Capture the unsubscribe so a future teardown helper can clean up.
      // _authChangeUnsubscribe stays null in flag-off / test-mode branches.
      try {
        _authChangeUnsubscribe = SyncAuth.onAuthChange((user) => {
          _maybeAutoHydrate(user);
        });
      } catch (e) {
        // Surface to the orchestrator's error path on retry; do not block
        // boot. The user can still trigger hydrate manually (E-1 follow-up).
        try { console.warn('[SyncEngine] auth-change subscription failed:', e); }
        catch (_e) {}
      }
    }
  }

  // C-1: four-condition gate per audit Headline #4. Called from the
  // onAuthChange subscription registered in init(). Defensive try/catch so
  // a thrown error inside hydrateFromCloud never bubbles up through the
  // auth event chain — boot stays alive regardless.
  function _maybeAutoHydrate(user) {
    try {
      if (!user) return;                                                  // signed out — nothing to do
      if (typeof SyncFlag === 'undefined' || !SyncFlag.isEnabled()) return;
      if (isAllHydrated()) return;                                        // already done — short-circuit
      if (getStageDHandoff()) return;                                     // D-1 owns reconciliation
      // Fire-and-forget; hydrateFromCloud handles its own state + UI events.
      hydrateFromCloud().catch((err) => {
        try { console.warn('[SyncEngine] auto-hydrate failed:', err); }
        catch (e) {}
      });
    } catch (err) {
      try { console.warn('[SyncEngine] _maybeAutoHydrate threw:', err); }
      catch (e) {}
    }
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

  // ── C-1: Cloud hydrate (hydrateFromCloud) ────────────────────────────
  //
  // Public flow:
  //   1. Re-entry guard: second concurrent call returns first call's promise.
  //   2. Preconditions: flag on, signed in, gate not already hydrating.
  //   3. Short-circuit: if tempo_sync_hydrated_all === '1', no-op.
  //   4. Stage D non-empty-local guard. If ANY synced store is non-empty
  //      locally, set tempo_sync_stage_d_handoff = '1', emit
  //      hydrate-complete { kind: 'stage-d-handoff' }, return WITHOUT
  //      pulling, WITHOUT flipping SyncState.
  //   5. F13 flip: SyncState.set('hydrating'). Blocks every gated engine
  //      write path (saveAll/addSession/save/saveLog) while we replace.
  //   6. Per-store pull loop in strict order: rest_log → meds → presets →
  //      history. Skips stores whose per-store marker is already set
  //      (resume after partial failure). Each store:
  //        a. Pull collection from Firestore.
  //        b. Call engine.hydrateFromCloud(records) — the engine writes
  //           via its private _hydrateWriteRaw helper, which bypasses
  //           SyncState.canWrite().
  //        c. Set per-store marker on success.
  //   7. All stores complete: set _all marker, flip SyncState to 'ready',
  //      emit hydrate-complete { ok: true, hydrated }.
  //   8. Any error: flip SyncState to 'error', emit hydrate-complete
  //      { ok: false, kind, error }, leave per-store markers for completed
  //      stores in place so resume picks up where we left off.

  function _getStorageSafe() {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  }

  function _getHydratedMarker(storeKey) {
    const ls = _getStorageSafe();
    if (!ls) return false;
    try { return ls.getItem(HYDRATE_MARKER_PREFIX + storeKey) === '1'; }
    catch (_) { return false; }
  }

  function _setHydratedMarker(storeKey) {
    const ls = _getStorageSafe();
    if (!ls) return;
    try { ls.setItem(HYDRATE_MARKER_PREFIX + storeKey, '1'); } catch (_) {}
  }

  function isAllHydrated() {
    const ls = _getStorageSafe();
    if (!ls) return false;
    try { return ls.getItem(HYDRATE_MARKER_ALL) === '1'; }
    catch (_) { return false; }
  }

  function _setAllHydrated() {
    const ls = _getStorageSafe();
    if (!ls) return;
    try { ls.setItem(HYDRATE_MARKER_ALL, '1'); } catch (_) {}
  }

  // C-1: dev-only / test helper — clears every per-store + _all marker so
  // the next hydrate trigger re-pulls from scratch. NOT wired to any UI in
  // C-1 (E-1 may add a "Refresh from cloud" button). The audit's manual e2e
  // smoke (step 13) instructs users to clear specific keys via dev tools;
  // this exists for tests that need a clean baseline between cases.
  function clearHydrationMarkers() {
    const ls = _getStorageSafe();
    if (!ls) return;
    for (const storeKey of HYDRATE_STORE_ORDER) {
      try { ls.removeItem(HYDRATE_MARKER_PREFIX + storeKey); } catch (_) {}
    }
    try { ls.removeItem(HYDRATE_MARKER_ALL); } catch (_) {}
  }

  // C-1: Stage D non-empty-local guard. Probes every synced store for
  // local data. Returns { isEmpty, counts }. Audit decision: presets'
  // default-seeded entries are EXCLUDED from the emptiness check (a fresh
  // first-launch device always has default presets — counting them would
  // route every first-launch user to Stage D handoff and prevent hydrate
  // from ever firing). The audit's strict-empty stance covers user data:
  // meds, history, rest_log are the load-bearing stores.
  async function _isLocalEmpty() {
    const counts = { rest_log: 0, meds: 0, presets: 0, history: 0 };
    try {
      if (typeof MedsManager !== 'undefined' && typeof MedsManager.count === 'function') {
        counts.meds = MedsManager.count();
      }
    } catch (_) {}
    try {
      if (typeof History !== 'undefined' && typeof History.getSessions === 'function') {
        const sessions = await History.getSessions();
        counts.history = Array.isArray(sessions) ? sessions.length : 0;
      }
    } catch (_) {}
    try {
      if (typeof RecoveryUI !== 'undefined' && typeof RecoveryUI.loadLog === 'function') {
        const log = RecoveryUI.loadLog() || {};
        counts.rest_log = Object.keys(log).length;
      }
    } catch (_) {}
    // Presets emptiness deliberately ignores default seeds — see the
    // function header. Future polish PR can route Stage D for presets if
    // we mint a more robust "user touched a preset" signal.
    counts.presets = 0;

    const totalUserData = counts.meds + counts.history + counts.rest_log;
    return { isEmpty: totalUserData === 0, counts };
  }

  // C-1: pull one store's collection from Firestore. Returns an array of
  // record data (the doc `data` field), augmented with `id` for stores
  // where the id is the doc key (rest_log uses the date as the doc id).
  async function _pullCloudStore(uid, storeKey) {
    const result = await SyncFirestore.getCollection(`users/${uid}/${storeKey}`);
    const docs = (result && Array.isArray(result.docs)) ? result.docs : [];
    if (storeKey === 'rest_log') {
      // Convert array-of-docs → date-keyed map for RecoveryUI.hydrateFromCloud.
      // B-3's upload stamps `date: <doc-id>` onto each inner record so E-1's
      // future merge code can find it without re-deriving; the engine's
      // hydrate path strips that redundant field before persisting.
      const out = {};
      for (const d of docs) {
        if (!d || typeof d.id !== 'string' || !d.id) continue;
        out[d.id] = d.data || {};
      }
      return out;
    }
    // Array-of-records for meds / history / presets. Inner record's `id`
    // field is the doc key — preserved from the upload path.
    const records = [];
    for (const d of docs) {
      if (!d) continue;
      const rec = (d.data && typeof d.data === 'object') ? d.data : null;
      if (!rec) continue;
      // Be defensive — if a record somehow lacks an inner id (shouldn't
      // happen post-B-3 upload, but cloud is canonical and we don't trust
      // it), use the doc key as the fallback.
      if (typeof rec.id !== 'string' || !rec.id) {
        if (typeof d.id === 'string' && d.id) rec.id = d.id;
      }
      records.push(rec);
    }
    return records;
  }

  async function hydrateFromCloud() {
    // Re-entry guard — concurrent call returns the in-flight promise.
    if (_hydrateInFlight && _currentHydratePromise) {
      return _currentHydratePromise;
    }

    _hydrateInFlight = true;
    _currentHydratePromise = (async () => {
      try {
        // ── Preconditions ───────────────────────────────────────────
        if (typeof SyncFlag === 'undefined' || !SyncFlag.isEnabled()) {
          const result = { ok: false, kind: 'sync-not-enabled' };
          emit('hydrate-complete', result);
          return result;
        }
        if (typeof SyncAuth === 'undefined' || typeof SyncAuth.getCurrentUser !== 'function') {
          const result = { ok: false, kind: 'sign-in-required' };
          emit('hydrate-complete', result);
          return result;
        }
        const user = SyncAuth.getCurrentUser();
        if (!user || !user.uid) {
          const result = { ok: false, kind: 'sign-in-required' };
          emit('hydrate-complete', result);
          return result;
        }
        // SyncState gate — if already hydrating from another code path
        // (e.g. push raced hydrate), refuse with already-in-flight. The
        // _hydrateInFlight latch above handles the "two hydrate calls"
        // case; this handles the "push owns the gate" case.
        if (typeof SyncState !== 'undefined') {
          const state = SyncState.get();
          if (state === 'hydrating') {
            const result = { ok: false, kind: 'already-in-flight' };
            emit('hydrate-complete', result);
            return result;
          }
          if (state === 'error') {
            // The UI maps this to "Retry sync" — caller decides to
            // SyncState.set('ready') then re-invoke.
            const result = { ok: false, kind: 'sync-error-state' };
            emit('hydrate-complete', result);
            return result;
          }
        }

        // ── Short-circuit: already fully hydrated ───────────────────
        if (isAllHydrated()) {
          const result = { ok: true, kind: 'already-hydrated' };
          emit('hydrate-complete', result);
          return result;
        }

        // ── Stage D non-empty-local guard ───────────────────────────
        // Runs BEFORE any cloud read AND BEFORE SyncState flip — if local
        // has any user data, we route to handoff without touching cloud
        // or the write gate.
        emit('hydrate-progress', { stage: 'checking-local' });
        let localProbe;
        try {
          localProbe = await _isLocalEmpty();
        } catch (err) {
          const result = { ok: false, kind: 'unknown', error: err };
          emit('hydrate-complete', result);
          return result;
        }
        if (!localProbe.isEmpty) {
          setStageDHandoff();
          const result = {
            ok: false,
            kind: 'stage-d-handoff',
            counts: localProbe.counts,
          };
          emit('hydrate-complete', result);
          return result;
        }

        // ── F13 flip: enter 'hydrating' before first per-store call ──
        if (typeof SyncState !== 'undefined') {
          try { SyncState.set('hydrating'); } catch (_) {}
        }

        // ── Per-store pull loop ─────────────────────────────────────
        const hydrated = { rest_log: 0, meds: 0, presets: 0, history: 0 };
        for (const storeKey of HYDRATE_STORE_ORDER) {
          // Resume support: skip stores already done on a prior partial run.
          if (_getHydratedMarker(storeKey)) continue;

          emit('hydrate-progress', { stage: 'pulling', store: storeKey });

          let payload;
          try {
            payload = await _pullCloudStore(user.uid, storeKey);
          } catch (err) {
            // Map normalized SyncFirestore error kinds onto the hydrate
            // result kind. permission-denied bubbles directly; everything
            // else folds into 'network' / 'unknown'.
            const kind = (err && err.kind === 'permission-denied') ? 'permission-denied'
                       : (err && err.kind === 'network')           ? 'network'
                       : (err && err.kind === 'not-found')         ? 'unknown'
                       : 'unknown';
            if (typeof SyncState !== 'undefined') {
              try { SyncState.set('error'); } catch (_) {}
            }
            const result = { ok: false, kind, store: storeKey, error: err, hydrated };
            emit('hydrate-complete', result);
            return result;
          }

          // Dispatch to per-engine hydrate. Each engine returns { ok, count, skipped }.
          let storeResult;
          try {
            if (storeKey === 'rest_log') {
              if (typeof RecoveryUI === 'undefined' || typeof RecoveryUI.hydrateFromCloud !== 'function') {
                throw new Error('RecoveryUI.hydrateFromCloud unavailable');
              }
              storeResult = await RecoveryUI.hydrateFromCloud(payload);
            } else if (storeKey === 'meds') {
              if (typeof MedsManager === 'undefined' || typeof MedsManager.hydrateFromCloud !== 'function') {
                throw new Error('MedsManager.hydrateFromCloud unavailable');
              }
              storeResult = await MedsManager.hydrateFromCloud(payload);
            } else if (storeKey === 'presets') {
              if (typeof Presets === 'undefined' || typeof Presets.hydrateFromCloud !== 'function') {
                throw new Error('Presets.hydrateFromCloud unavailable');
              }
              storeResult = await Presets.hydrateFromCloud(payload);
            } else if (storeKey === 'history') {
              if (typeof History === 'undefined' || typeof History.hydrateFromCloud !== 'function') {
                throw new Error('History.hydrateFromCloud unavailable');
              }
              storeResult = await History.hydrateFromCloud(payload);
            }
          } catch (err) {
            if (typeof SyncState !== 'undefined') {
              try { SyncState.set('error'); } catch (_) {}
            }
            const result = { ok: false, kind: 'unknown', store: storeKey, error: err, hydrated };
            emit('hydrate-complete', result);
            return result;
          }

          hydrated[storeKey] = (storeResult && typeof storeResult.count === 'number')
            ? storeResult.count : 0;

          // Per-store marker set AFTER successful write — partial-failure
          // resume relies on this ordering. A mid-flight kill leaves the
          // marker absent → next boot re-pulls that store.
          _setHydratedMarker(storeKey);
        }

        // ── Success ─────────────────────────────────────────────────
        _setAllHydrated();
        if (typeof SyncState !== 'undefined') {
          try { SyncState.set('ready'); } catch (_) {}
        }
        const success = { ok: true, hydrated, kind: 'done' };
        emit('hydrate-complete', success);
        return success;
      } catch (err) {
        // Defensive catch — anything unexpected (throw inside a per-engine
        // hydrate, missing module, etc.) lands here. Flip to 'error' so
        // local writes stay paused until the UI surfaces a retry.
        if (typeof SyncState !== 'undefined') {
          try { SyncState.set('error'); } catch (_) {}
        }
        const result = { ok: false, kind: 'unknown', error: err };
        emit('hydrate-complete', result);
        return result;
      }
    })();

    // Always clear the in-flight latch when the promise settles —
    // regardless of success / failure / throw. Without this, a failed
    // hydrate would permanently wedge the re-entry guard.
    const promise = _currentHydratePromise;
    promise.finally(() => {
      _hydrateInFlight = false;
      _currentHydratePromise = null;
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
    // C-1: cloud hydrate + marker helpers.
    hydrateFromCloud,
    isAllHydrated,
    clearHydrationMarkers,
  };
})();
