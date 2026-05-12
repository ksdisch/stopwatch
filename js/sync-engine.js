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

  // D-1: re-entry guard for reconcileImportedBucket. Same shape as
  // _hydrateInFlight — a re-click on the "Reconcile now" button while a
  // reconcile is mid-flight returns the in-flight promise rather than
  // starting a fresh pull/merge/push race.
  let _reconcileInFlight = false;
  let _currentReconcilePromise = null;

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

  // D-1: cleared by step 7 of `reconcileImportedBucket()` on success.
  // Left set on reconcile failure so the user can retry — idempotent
  // re-run is the documented rollback strategy (audit Headline #5).
  function clearStageDHandoff() {
    const ls = _getStorage();
    if (!ls) return;
    try { ls.removeItem(STAGE_D_HANDOFF_KEY); } catch (_) {}
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

  // ── D-1: Stage D imported-bucket reconcile (reconcileImportedBucket) ──
  //
  // Resolves the path C-1's `tempo_sync_stage_d_handoff` guard short-
  // circuits to: tag every pre-existing local record as "imported (pre-
  // sync)", pull cloud, merge cloud ∪ tagged-local, push the combined
  // snapshot to both local and cloud, and clear the handoff flag on
  // success.
  //
  // 9-step contract (per audit Headline #3 + D-1-PROMPT.md):
  //   1. Re-entry guard + preconditions (sign-in, flag, gate-not-busy).
  //   2. `SyncState.set('hydrating')` before any stamp/pull/push.
  //   3. Stamp local idempotently:
  //        - History rows missing `bucket` AND not future-schema get
  //          `bucket: 'imported'` + `originDeviceId: getDeviceId()`.
  //          Future-schema rows are skipped per F19a and surfaced as
  //          `result.skippedFutureRecords`.
  //        - Meds records missing `originDeviceId` get it stamped to
  //          the local device's id. Idempotent — already-stamped
  //          records are no-ops.
  //        - Privileged writes via `_reconcileWriteRaw` (bypasses F13).
  //   4. Pull cloud per-store in dependency order: rest_log → meds →
  //      presets → history. Reuses C-1's `_pullCloudStore(uid, key)`.
  //   5. Merge per collision rules:
  //        - history (sessionId): prefer cloud + console.warn.
  //        - meds (medId): keep BOTH records (distinguished by
  //          originDeviceId — D-2+ UI surfaces dedup candidates).
  //        - rest_log (date key): LWW via `updatedAt`.
  //        - presets (presetId): LWW via `updatedAt`.
  //   6. Write merged snapshot:
  //        - Local: history + meds via the new `_reconcileWriteRaw`
  //          helpers; rest_log + presets via C-1's existing
  //          `_hydrateWriteRaw` helpers (LWW collapses to "replace
  //          local with canonical payload" semantics).
  //        - Cloud: per-record `SyncFirestore.setDoc` reusing B-3's
  //          per-record write pattern.
  //   7. Set all 5 hydrate markers (so subsequent boots short-circuit
  //      C-1's auto-hydrate).
  //   8. Clear `tempo_sync_stage_d_handoff`.
  //   9. `SyncState.set('ready')` + emit
  //      `reconcile-complete { ok: true, kind: 'reconciled', counts,
  //                            skippedFutureRecords }`.
  //
  // Failure handling: on any step failure, `SyncState.set('error')`,
  // emit `reconcile-complete { ok: false, kind: 'reconcile-error',
  // error }`, LEAVE the handoff flag set AND the 5 hydrate markers
  // unset. Idempotent re-run is the documented rollback (Headline #5);
  // the stamp loop in step 3 uses `if (bucket == null) ...` so partial
  // stamps from a prior failed attempt are stable across retries.

  function _allHydrateMarkerKeys() {
    const keys = [];
    for (const storeKey of HYDRATE_STORE_ORDER) {
      keys.push(HYDRATE_MARKER_PREFIX + storeKey);
    }
    keys.push(HYDRATE_MARKER_ALL);
    return keys;
  }

  function _setAllHydrateMarkers() {
    for (const storeKey of HYDRATE_STORE_ORDER) {
      _setHydratedMarker(storeKey);
    }
    _setAllHydrated();
  }

  // D-1 merge helpers — collision-rule application per the audit's
  // "Merge" section. Pure functions; the orchestrator wires them in
  // step 5.

  // History: prefer cloud on `sessionId` collision; emit a console.warn
  // per collision so post-merge debugging surfaces the (rare) cases
  // where device-prefixed IDs happened to alias.
  function _mergeHistory(localRecords, cloudRecords) {
    const cloudById = new Map();
    for (const rec of cloudRecords) {
      if (rec && typeof rec.id === 'string' && rec.id) {
        cloudById.set(rec.id, rec);
      }
    }
    const out = [];
    const seen = new Set();
    // Cloud records win on collision — emit them first, mark as seen.
    for (const rec of cloudRecords) {
      if (rec && typeof rec.id === 'string' && rec.id) {
        out.push(rec);
        seen.add(rec.id);
      }
    }
    // Tagged-local records appended where the id isn't in cloud.
    for (const rec of localRecords) {
      if (!rec || typeof rec.id !== 'string' || !rec.id) continue;
      if (seen.has(rec.id)) {
        try {
          console.warn('[SyncEngine] reconcile history sessionId collision (cloud wins): ' + rec.id);
        } catch (_) {}
        continue;
      }
      out.push(rec);
      seen.add(rec.id);
    }
    return out;
  }

  // Meds: keep BOTH records on `medId` collision. The user resolves
  // later via `ManualDedupe.scan()`. No console.warn — duplication is
  // the expected outcome of independently-authored same-name meds.
  // To preserve "both" without violating the per-record localStorage
  // contract (one key per medId), the cloud record's id is rewritten
  // by prepending an originDeviceId-derived suffix when collision is
  // detected AND the cloud record's `originDeviceId` differs from the
  // local one. This is the simplest way to keep both rows visible in
  // the meds panel without auto-merging dose logs (which is D-2).
  function _mergeMeds(localRecords, cloudRecords, localDeviceId) {
    const out = [];
    const localById = new Map();
    for (const rec of localRecords) {
      if (rec && typeof rec.id === 'string' && rec.id) {
        localById.set(rec.id, rec);
        out.push(rec);
      }
    }
    for (const rec of cloudRecords) {
      if (!rec || typeof rec.id !== 'string' || !rec.id) continue;
      const local = localById.get(rec.id);
      if (!local) {
        // No collision — cloud record joins as-is.
        out.push(rec);
        continue;
      }
      // Collision: keep BOTH. If cloud's originDeviceId is missing,
      // assume it's the local device's already-stamped tag — fall back
      // to cloud's `deviceId` for the suffix.
      const cloudOrigin = (typeof rec.originDeviceId === 'string' && rec.originDeviceId)
        ? rec.originDeviceId
        : (typeof rec.deviceId === 'string' ? rec.deviceId : 'cloud');
      // Skip if cloud's originDeviceId matches our local device's id —
      // same authoring device, this is a steady-state reconcile of a
      // record we already own. Cloud wins by LWW intent (will be
      // refined in D-2/E-1; D-1 keeps the rule conservative).
      if (cloudOrigin === localDeviceId) {
        // Replace local with cloud (cloud is canonical for our own
        // device's later writes). Find and overwrite the entry in `out`.
        for (let i = 0; i < out.length; i++) {
          if (out[i] && out[i].id === rec.id) {
            out[i] = rec;
            break;
          }
        }
        continue;
      }
      // Genuine cross-device collision — re-key cloud copy with the
      // origin suffix so both survive the per-record localStorage write.
      const newId = rec.id + '@' + cloudOrigin;
      const cloned = Object.assign({}, rec, { id: newId });
      out.push(cloned);
    }
    return out;
  }

  // LWW for rest_log + presets. Both store per-record `updatedAt`
  // stamps; cloud wins on tie (matches push-then-hydrate convergence
  // in steady state). `keyOf` lets the caller pick `date` (rest_log)
  // or `id` (presets) — the merge logic is otherwise identical.
  function _mergeLWWArray(localRecords, cloudRecords, keyOf) {
    const merged = new Map();
    for (const rec of localRecords) {
      if (!rec) continue;
      const key = keyOf(rec);
      if (key == null) continue;
      merged.set(key, rec);
    }
    for (const rec of cloudRecords) {
      if (!rec) continue;
      const key = keyOf(rec);
      if (key == null) continue;
      const local = merged.get(key);
      if (!local) {
        merged.set(key, rec);
        continue;
      }
      const localAt = typeof local.updatedAt === 'number' ? local.updatedAt : 0;
      const cloudAt = typeof rec.updatedAt === 'number' ? rec.updatedAt : 0;
      if (cloudAt >= localAt) {
        merged.set(key, rec);
      }
    }
    return Array.from(merged.values());
  }

  // rest_log specifically: cloud comes through as a `{date: entry}`
  // object (per C-1's `_pullCloudStore` array→map conversion). Local is
  // the same shape via `RecoveryUI.loadLog()`. We merge on the date key
  // with LWW on `updatedAt` — but rest_log entries don't currently
  // carry `updatedAt` themselves (the strategy doc keeps the rest_log
  // payload as the raw YYYY-MM-DD-keyed object). For D-1, prefer cloud
  // on collision so the user's cross-device most-recent edit wins
  // (matches push-then-hydrate convergence semantics).
  function _mergeRestLog(localMap, cloudMap) {
    const out = Object.assign({}, localMap || {});
    if (cloudMap && typeof cloudMap === 'object') {
      for (const date of Object.keys(cloudMap)) {
        const cloudEntry = cloudMap[date];
        if (!cloudEntry || typeof cloudEntry !== 'object') continue;
        out[date] = cloudEntry;
      }
    }
    return out;
  }

  async function reconcileImportedBucket() {
    // Step 1a: re-entry guard — concurrent call returns the in-flight promise.
    if (_reconcileInFlight && _currentReconcilePromise) {
      return _currentReconcilePromise;
    }

    _reconcileInFlight = true;
    _currentReconcilePromise = (async () => {
      try {
        // ── Step 1b: Preconditions ──────────────────────────────────
        if (typeof SyncFlag === 'undefined' || !SyncFlag.isEnabled()) {
          const result = { ok: false, kind: 'sync-not-enabled' };
          emit('reconcile-complete', result);
          return result;
        }
        if (typeof SyncAuth === 'undefined' || typeof SyncAuth.getCurrentUser !== 'function') {
          const result = { ok: false, kind: 'sign-in-required' };
          emit('reconcile-complete', result);
          return result;
        }
        const user = SyncAuth.getCurrentUser();
        if (!user || !user.uid) {
          const result = { ok: false, kind: 'sign-in-required' };
          emit('reconcile-complete', result);
          return result;
        }
        // SyncState gate — if already 'hydrating' from another code path
        // (push or hydrate owns the gate), refuse with `busy`. The
        // _reconcileInFlight latch handles the "two reconcile calls"
        // case; this handles the "push/hydrate owns the gate" case.
        if (typeof SyncState !== 'undefined') {
          const state = SyncState.get();
          if (state === 'hydrating') {
            const result = { ok: false, kind: 'busy' };
            emit('reconcile-complete', result);
            return result;
          }
          if (state === 'error') {
            const result = { ok: false, kind: 'sync-error-state' };
            emit('reconcile-complete', result);
            return result;
          }
        }

        // ── Step 2: Flip F13 write gate ─────────────────────────────
        if (typeof SyncState !== 'undefined') {
          try { SyncState.set('hydrating'); } catch (_) {}
        }

        // ── Step 3: Stamp local idempotently ────────────────────────
        emit('reconcile-progress', { stage: 'stamping', store: 'history' });
        const localDeviceId = (typeof History !== 'undefined' && typeof History.getDeviceId === 'function')
          ? History.getDeviceId()
          : null;
        let skippedFutureRecords = 0;
        let historyStampedCount = 0;
        let medsStampedCount = 0;

        // 3a: history rows
        let historyRows = [];
        try {
          if (typeof History === 'undefined' || typeof History.getSessions !== 'function') {
            throw new Error('History module unavailable');
          }
          historyRows = await History.getSessions();
          if (!Array.isArray(historyRows)) historyRows = [];
        } catch (err) {
          if (typeof SyncState !== 'undefined') {
            try { SyncState.set('error'); } catch (_) {}
          }
          const result = { ok: false, kind: 'reconcile-error', error: err };
          emit('reconcile-complete', result);
          return result;
        }
        const stampedHistory = [];
        for (const session of historyRows) {
          if (!session || typeof session !== 'object') continue;
          // F19a: skip future-schema rows. Downlevel client would corrupt
          // semantics on writeback. Count + skip + keep on disk as-is.
          if (typeof Schema !== 'undefined' && typeof Schema.isFutureRecord === 'function' &&
              Schema.isFutureRecord(session)) {
            skippedFutureRecords++;
            stampedHistory.push(session);
            continue;
          }
          // Idempotent stamp — only tag if `bucket` is absent.
          if (session.bucket == null) {
            session.bucket = 'imported';
            if (localDeviceId) session.originDeviceId = localDeviceId;
            historyStampedCount++;
          }
          stampedHistory.push(session);
        }

        // 3b: meds records
        emit('reconcile-progress', { stage: 'stamping', store: 'meds' });
        let medsList = [];
        try {
          if (typeof MedsManager === 'undefined' || typeof MedsManager.all !== 'function') {
            throw new Error('MedsManager module unavailable');
          }
          medsList = MedsManager.all().map(m => m.getState());
          if (!Array.isArray(medsList)) medsList = [];
        } catch (err) {
          if (typeof SyncState !== 'undefined') {
            try { SyncState.set('error'); } catch (_) {}
          }
          const result = { ok: false, kind: 'reconcile-error', error: err };
          emit('reconcile-complete', result);
          return result;
        }
        const stampedMeds = [];
        for (const med of medsList) {
          if (!med || typeof med !== 'object') continue;
          if (med.originDeviceId == null && localDeviceId) {
            med.originDeviceId = localDeviceId;
            medsStampedCount++;
          }
          stampedMeds.push(med);
        }

        // 3c: write tagged local snapshot via privileged paths so the
        // tag stamps are durable even if step 4+ fails (idempotent
        // retry resumes with stamps already in place).
        try {
          if (typeof History._reconcileWriteRaw === 'function') {
            await History._reconcileWriteRaw(stampedHistory);
          }
          if (typeof MedsManager._reconcileWriteRaw === 'function') {
            MedsManager._reconcileWriteRaw(stampedMeds);
          }
        } catch (err) {
          if (typeof SyncState !== 'undefined') {
            try { SyncState.set('error'); } catch (_) {}
          }
          const result = { ok: false, kind: 'reconcile-error', error: err };
          emit('reconcile-complete', result);
          return result;
        }

        // ── Step 4: Pull cloud per-store in dependency order ────────
        const cloudData = { rest_log: null, meds: null, presets: null, history: null };
        for (const storeKey of HYDRATE_STORE_ORDER) {
          emit('reconcile-progress', { stage: 'pulling', store: storeKey });
          try {
            cloudData[storeKey] = await _pullCloudStore(user.uid, storeKey);
          } catch (err) {
            if (typeof SyncState !== 'undefined') {
              try { SyncState.set('error'); } catch (_) {}
            }
            const result = {
              ok: false,
              kind: 'reconcile-error',
              store: storeKey,
              error: err,
            };
            emit('reconcile-complete', result);
            return result;
          }
        }

        // ── Step 5: Merge per collision rules ───────────────────────
        // Read the freshly-stamped local snapshot back so the merge sees
        // exactly the on-disk shape after step 3 (defensive — the
        // stamping loop mutated objects in-place, but re-reading
        // guarantees the merge input matches the privileged-write).
        let localHistory = [];
        try {
          localHistory = await History.getSessions();
          if (!Array.isArray(localHistory)) localHistory = [];
        } catch (err) {
          if (typeof SyncState !== 'undefined') {
            try { SyncState.set('error'); } catch (_) {}
          }
          const result = { ok: false, kind: 'reconcile-error', error: err };
          emit('reconcile-complete', result);
          return result;
        }
        const localMeds = MedsManager.all().map(m => m.getState());
        const localRestLog = (typeof RecoveryUI !== 'undefined' && typeof RecoveryUI.loadLog === 'function')
          ? (RecoveryUI.loadLog() || {})
          : {};
        const localPresets = (typeof Presets !== 'undefined' && typeof Presets.snapshotForSync === 'function')
          ? ((Presets.snapshotForSync().payload || {}).presets || [])
          : [];

        const mergedHistory = _mergeHistory(localHistory, cloudData.history || []);
        const mergedMeds    = _mergeMeds(localMeds, cloudData.meds || [], localDeviceId);
        const mergedRestLog = _mergeRestLog(localRestLog, cloudData.rest_log || {});
        const mergedPresets = _mergeLWWArray(localPresets, cloudData.presets || [], (rec) => rec.id);

        // ── Step 6: Write merged snapshot to local + cloud ──────────
        // 6a: local writes (reuse C-1 hydrate helpers for rest_log +
        // presets where merge semantics collapse to "replace local
        // with canonical payload"; D-1 reconcile helpers for history +
        // meds where merge keeps tagged-local + cloud union).
        emit('reconcile-progress', { stage: 'writing', store: 'history' });
        try {
          if (typeof History._reconcileWriteRaw === 'function') {
            await History._reconcileWriteRaw(mergedHistory);
          }
          emit('reconcile-progress', { stage: 'writing', store: 'meds' });
          if (typeof MedsManager._reconcileWriteRaw === 'function') {
            MedsManager._reconcileWriteRaw(mergedMeds);
          }
          emit('reconcile-progress', { stage: 'writing', store: 'rest_log' });
          if (typeof RecoveryUI !== 'undefined' && typeof RecoveryUI._hydrateWriteRaw === 'function') {
            RecoveryUI._hydrateWriteRaw(mergedRestLog);
          }
          emit('reconcile-progress', { stage: 'writing', store: 'presets' });
          if (typeof Presets !== 'undefined' && typeof Presets._hydrateWriteRaw === 'function') {
            Presets._hydrateWriteRaw(mergedPresets);
          }
        } catch (err) {
          if (typeof SyncState !== 'undefined') {
            try { SyncState.set('error'); } catch (_) {}
          }
          const result = { ok: false, kind: 'reconcile-error', error: err };
          emit('reconcile-complete', result);
          return result;
        }

        // 6b: cloud writes per-record via SyncFirestore.setDoc.
        // history + meds: array-of-records with `record.id` as the doc key.
        // presets: same. rest_log: object-keyed map; the key IS the doc id.
        try {
          // history
          for (let i = 0; i < mergedHistory.length; i++) {
            const rec = mergedHistory[i];
            if (!rec || typeof rec.id !== 'string' || !rec.id) continue;
            // F19a: skip future-schema rows on cloud write too — they
            // came from cloud (or were merged in untouched) and are
            // canonical there already; pushing them again is a no-op
            // setDoc but cheaper to skip.
            if (typeof Schema !== 'undefined' && typeof Schema.isFutureRecord === 'function' &&
                Schema.isFutureRecord(rec)) {
              continue;
            }
            emit('reconcile-progress', {
              stage: 'uploading',
              store: 'history',
              current: i + 1,
              total: mergedHistory.length,
            });
            await SyncFirestore.setDoc(`users/${user.uid}/history/${rec.id}`, rec);
          }
          // meds
          for (let i = 0; i < mergedMeds.length; i++) {
            const rec = mergedMeds[i];
            if (!rec || typeof rec.id !== 'string' || !rec.id) continue;
            emit('reconcile-progress', {
              stage: 'uploading',
              store: 'meds',
              current: i + 1,
              total: mergedMeds.length,
            });
            await SyncFirestore.setDoc(`users/${user.uid}/meds/${rec.id}`, rec);
          }
          // rest_log (map → per-date doc)
          const restLogKeys = Object.keys(mergedRestLog);
          for (let i = 0; i < restLogKeys.length; i++) {
            const date = restLogKeys[i];
            const entry = mergedRestLog[date];
            if (!entry || typeof entry !== 'object') continue;
            emit('reconcile-progress', {
              stage: 'uploading',
              store: 'rest_log',
              current: i + 1,
              total: restLogKeys.length,
            });
            // B-3 upload contract: stamp the date onto the inner record
            // so E-1 per-record merge code can find it without
            // re-deriving from the path.
            await SyncFirestore.setDoc(
              `users/${user.uid}/rest_log/${date}`,
              Object.assign({ date }, entry)
            );
          }
          // presets
          for (let i = 0; i < mergedPresets.length; i++) {
            const rec = mergedPresets[i];
            if (!rec || typeof rec.id !== 'string' || !rec.id) continue;
            emit('reconcile-progress', {
              stage: 'uploading',
              store: 'presets',
              current: i + 1,
              total: mergedPresets.length,
            });
            await SyncFirestore.setDoc(`users/${user.uid}/presets/${rec.id}`, rec);
          }
        } catch (err) {
          if (typeof SyncState !== 'undefined') {
            try { SyncState.set('error'); } catch (_) {}
          }
          const result = { ok: false, kind: 'reconcile-error', error: err };
          emit('reconcile-complete', result);
          return result;
        }

        // ── Step 7: Set all 5 hydrate markers ───────────────────────
        // Done ONLY after both local + cloud writes succeed — so a
        // mid-flight failure leaves markers absent and the next boot's
        // auto-hydrate path re-evaluates correctly.
        _setAllHydrateMarkers();

        // ── Step 8: Clear Stage D handoff flag ──────────────────────
        clearStageDHandoff();

        // ── Step 9: Flip back to 'ready' + emit success ─────────────
        if (typeof SyncState !== 'undefined') {
          try { SyncState.set('ready'); } catch (_) {}
        }
        const counts = {
          rest_log: Object.keys(mergedRestLog).length,
          meds: mergedMeds.length,
          presets: mergedPresets.length,
          history: mergedHistory.length,
        };
        const success = {
          ok: true,
          kind: 'reconciled',
          counts,
          stamped: { history: historyStampedCount, meds: medsStampedCount },
          skippedFutureRecords,
        };
        emit('reconcile-complete', success);
        return success;
      } catch (err) {
        // Defensive catch — anything unexpected (throw inside a merge
        // helper, missing module, etc.) lands here. Leave handoff flag
        // set + hydrate markers unset so retry resumes from scratch
        // (Headline #5 — idempotent re-run as rollback).
        if (typeof SyncState !== 'undefined') {
          try { SyncState.set('error'); } catch (_) {}
        }
        const result = { ok: false, kind: 'reconcile-error', error: err };
        emit('reconcile-complete', result);
        return result;
      }
    })();

    // Always clear the in-flight latch when the promise settles —
    // regardless of success / failure / throw. Without this, a failed
    // reconcile would permanently wedge the re-entry guard.
    const promise = _currentReconcilePromise;
    promise.finally(() => {
      _reconcileInFlight = false;
      _currentReconcilePromise = null;
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
    // D-1: imported-bucket reconcile + handoff-clear helper.
    reconcileImportedBucket,
    clearStageDHandoff,
  };
})();
