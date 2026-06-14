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

  // E-1b: steady-state merge timer state. Module-scope slots so
  // stopSteadyState() can `removeEventListener` with the SAME function
  // reference that `addEventListener` got (anonymous inline handlers
  // would leak — Risk #6 in the audit). `_steadyRunInFlight` is the
  // coalesce-concurrent-ticks latch — overlapping interval fires (e.g.
  // a slow IDB read on tick N still running when tick N+1 fires) return
  // immediately instead of starting a second merge cycle.
  let _steadyTimer = null;
  let _steadyVisibilityHandler = null;
  let _steadyNetworkUnsubscribe = null;
  let _steadyRunInFlight = false;

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

  // E-1b: steady-state merge timer constants. E-3 BUMPED default
  // interval from 30s to 5 minutes (300_000ms) per Pick A on TODO #1
  // in docs/sync-impl/prompts/E-3-PROMPT.md — listeners are now the
  // primary cross-device propagation mechanism, the timer is a
  // defensive fallback only. Clamp range [10s, 10m] — a 10s minimum
  // still protects against runaway polling if a future caller bumps
  // it back down; the 10m maximum keeps cross-device propagation
  // latency bounded even if someone hand-tunes the interval. E-1e
  // removed the `tempo_sync_steady_state_enabled` dev flag — steady-
  // state runs by default when the four-condition gate (signed in +
  // master sync flag on + all-hydrated + no Stage D handoff) is
  // satisfied, gated only by `_maybeAutoStartSteady`.
  const STEADY_STATE_DEFAULT_MS = 300000;
  const STEADY_STATE_MIN_MS = 10000;
  const STEADY_STATE_MAX_MS = 600000;
  const STEADY_STATE_INTERVAL_KEY = 'tempo_sync_steady_interval_ms';

  // ── Store registry ────────────────────────────────────────────────────
  //
  // Hardcoded list of synced-eligible stores. Order: meds → history →
  // rest_log → presets → bfrb_events → distractions → mood_events. For
  // snapshot the order is purely cosmetic; B-3's hydrate ordering can
  // diverge.
  //
  // E-1d-f3 added `bfrb_events` as the 5th entry — the consolidated BFRB
  // stream (F3) replacing the legacy 3-key routing (`bfrbs_global` /
  // `flow_bfrbs` / `pomodoro_bfrbs`).
  // E-1d-f8 added `distractions` as the 6th entry — the consolidated
  // distractions stream (F8) replacing the legacy two-key flat-array
  // shape (`flow_distractions` / `pomodoro_distractions`). Both maps
  // travel under one snapshot envelope; the per-store merge resolves
  // per-(context, sessionId).
  // Life-OS Phase 3 added `mood_events` as the 7th entry — the mood
  // capture stream (ADR-0008). Append-only events deduped by
  // (deviceId, at); merge in js/sync-merge-mood.js.
  //
  // Hydrate is NOT added to HYDRATE_STORE_ORDER for E-1d-f3, E-1d-f8,
  // or mood_events; the load-time migrations in js/bfrb-events.js +
  // js/distractions.js cover cold-start (mood_events has no migration —
  // it starts fresh), and the steady-state merge cycle covers
  // cross-device propagation post-sign-in (E-1e revisits hydrate
  // expansion alongside rest_log + presets cleanup).
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
    { key: 'meds',         adapter: { read: () => MedsManager.snapshotForSync(),  write: writeStub } },
    { key: 'history',      adapter: { read: () => History.snapshotForSync(),      write: writeStub } },
    { key: 'rest_log',     adapter: { read: () => RecoveryUI.snapshotForSync(),   write: writeStub } },
    { key: 'presets',      adapter: { read: () => Presets.snapshotForSync(),      write: writeStub } },
    { key: 'bfrb_events',  adapter: { read: () => BfrbEvents.snapshotForSync(),   write: writeStub } },
    { key: 'distractions', adapter: { read: () => Distractions.snapshotForSync(), write: writeStub } },
    { key: 'mood_events',  adapter: { read: () => Mood.snapshotForSync(),         write: writeStub } },
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

    // E-1e: cold-boot auto-arm path. If a previous session already
    // completed hydrate (`tempo_sync_hydrated_all === '1'`) AND the SDK
    // has rehydrated the auth session, fire steady-state immediately.
    // The four-condition gate inside `_maybeAutoStartSteady` covers all
    // bail conditions; if any fails, the post-hydrate `.then()` block
    // in `_maybeAutoHydrate` will fire later as the second entry point.
    try {
      const currentUser = (typeof SyncAuth !== 'undefined' && typeof SyncAuth.getCurrentUser === 'function')
        ? SyncAuth.getCurrentUser()
        : null;
      if (currentUser) _maybeAutoStartSteady(currentUser);
    } catch (_) {
      // Defensive — keep boot alive regardless of cold-boot probe failure.
    }
  }

  // C-1: four-condition gate per audit Headline #4. Called from the
  // onAuthChange subscription registered in init(). Defensive try/catch so
  // a thrown error inside hydrateFromCloud never bubbles up through the
  // auth event chain — boot stays alive regardless.
  //
  // E-1e: extended to fire `_maybeAutoStartSteady(user)` from the
  // post-hydrate `.then()` block — the first-sign-in path. The cold-
  // boot path (marker already set) is covered by `init()`'s end-of-
  // function call below. NOT called from `.catch()` — a failed hydrate
  // must NOT auto-arm steady-state (Risk #6).
  function _maybeAutoHydrate(user) {
    try {
      if (!user) return;                                                  // signed out — nothing to do
      if (typeof SyncFlag === 'undefined' || !SyncFlag.isEnabled()) return;
      if (isAllHydrated()) {
        // Already hydrated from a prior session. The cold-boot probe in
        // init() (line ~186) only fires _maybeAutoStartSteady when
        // SyncAuth.getCurrentUser() is non-null at init time — but the
        // Firebase Auth SDK's session rehydrate is async, so on cold
        // boot init() typically sees a null user and the auth-change
        // event is the first reliable signal that the user is signed
        // in. Without this call, post-Reconcile reloads + any cold boot
        // where the SDK rehydrates after init() leave listeners unarmed
        // (caught in two-tab validation 2026-05-17).
        _maybeAutoStartSteady(user);
        return;
      }
      if (getStageDHandoff()) return;                                     // D-1 owns reconciliation
      // Fire-and-forget; hydrateFromCloud handles its own state + UI events.
      hydrateFromCloud()
        .then(() => _maybeAutoStartSteady(user))
        .catch((err) => {
          try { console.warn('[SyncEngine] auto-hydrate failed:', err); }
          catch (e) {}
        });
    } catch (err) {
      try { console.warn('[SyncEngine] _maybeAutoHydrate threw:', err); }
      catch (e) {}
    }
  }

  // E-1e: four-condition gate for auto-arming the steady-state merge
  // timer (Pick C on TODO #6). Called from two entry points:
  //   (a) `init()` end — cold-boot path: marker already set from a
  //       previous session, user already signed in via SDK rehydrate.
  //   (b) `_maybeAutoHydrate(user).then()` — first-sign-in path:
  //       hydrate just completed; the all-hydrated marker just got set.
  // Idempotent via `startSteadyState`'s existing `_steadyTimer != null`
  // guard, so double-invocation is safe.
  function _maybeAutoStartSteady(user) {
    try {
      if (!user) return;                                                  // signed out — nothing to do
      if (typeof SyncFlag === 'undefined' || !SyncFlag.isEnabled()) return;
      if (!isAllHydrated()) return;                                       // hydrate must complete first
      if (getStageDHandoff()) return;                                     // D-1 owns reconciliation
      try { startSteadyState(); }
      catch (err) {
        try { console.warn('[SyncEngine] _maybeAutoStartSteady — startSteadyState threw:', err); }
        catch (_e) {}
      }
    } catch (err) {
      try { console.warn('[SyncEngine] _maybeAutoStartSteady threw:', err); }
      catch (_e) {}
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

  // H3: user-initiated recovery from the 'error' gate — the "Retry" action on
  // the sync-error toast. The gate deliberately does NOT auto-clear 'error'
  // (so a sync failure stays visible rather than silently hidden); this is the
  // explicit user gesture that clears it and re-attempts the sync flow. Clears
  // the gate to 'ready', then re-runs the auto-hydrate path: it re-pulls cloud
  // if the initial hydrate had failed (marker unset), or re-arms steady-state
  // if already hydrated. If sync is still broken, the failure paths re-set
  // 'error' and the toast re-fires. Best-effort + guarded — never throws into
  // the toast's tap handler.
  function retrySync() {
    try {
      if (typeof SyncState !== 'undefined' && typeof SyncState.set === 'function') {
        SyncState.set('ready');
      }
    } catch (_) {}
    let user = null;
    try {
      user = (typeof SyncAuth !== 'undefined' && typeof SyncAuth.getCurrentUser === 'function')
        ? SyncAuth.getCurrentUser()
        : null;
    } catch (_) {}
    try { _maybeAutoHydrate(user); } catch (_) {}
    return { ok: true };
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

  // E-1e: dispatcher-level F19a snapshot gate (Pick C on TODO #4).
  // Filters future-schema local records from the per-store snapshot
  // BEFORE passing to each merge fn. The existing per-merge-fn cloud-
  // side gates stay — two layers, different vectors:
  //   - Cloud-side gate (in each merge fn): catches future-schema
  //     records arriving over the wire from a newer client.
  //   - Local-side gate (this helper): catches future-schema records
  //     that leaked into local storage via JSON import, schema-version
  //     downgrade race, or other out-of-band paths.
  //
  // Per-store payload shapes:
  //   - meds:         payload.meds[]
  //   - history:      payload.sessions[] (+ other top-level fields)
  //   - rest_log:     payload.rest_log{} — object keyed by YYYY-MM-DD
  //   - presets:      payload.presets[]
  //   - bfrb_events:  payload.events[]
  //   - distractions: payload.flow{sessionId: [entries]} + payload.pomodoro{...}
  //   - mood_events:  payload.events[]
  //
  // Returns a NEW snapshot with the filtered payload + a `__skipped`
  // counter for observability. The dispatcher logs the skip count via
  // `console.warn` when non-zero. Today's merge fns pass `null` to
  // `merge()` and re-read internally, so the filtered snapshot's value
  // is observability only — the future-proof contract (merge fns
  // could consume the snapshot) is in place for E-2+ refactors.
  function _filterFutureRecordsInSnapshot(key, snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.payload) {
      return snapshot;
    }
    const out = {
      deviceId: snapshot.deviceId,
      schemaVersion: snapshot.schemaVersion,
      payload: {},
    };
    let skipped = 0;
    // E-3: track the highest skipped `schemaVersion` so the post-walk
    // emit can carry it on the `'refuse-writeback'` payload. We trail
    // the existing filter walk in-place — no second pass.
    let highestSkippedVersion = 0;
    const isFuture = (typeof Schema !== 'undefined' && typeof Schema.isFutureRecord === 'function')
      ? Schema.isFutureRecord
      : () => false;
    function _trackSkip(record) {
      skipped++;
      const v = (record && typeof record.schemaVersion === 'number') ? record.schemaVersion : 0;
      if (v > highestSkippedVersion) highestSkippedVersion = v;
    }

    if (key === 'meds') {
      const arr = Array.isArray(snapshot.payload.meds) ? snapshot.payload.meds : [];
      out.payload.meds = arr.filter(r => { if (isFuture(r)) { _trackSkip(r); return false; } return true; });
    } else if (key === 'history') {
      // history payload may carry other top-level fields beyond sessions;
      // preserve them via shallow clone, then overwrite sessions.
      out.payload = Object.assign({}, snapshot.payload);
      const arr = Array.isArray(snapshot.payload.sessions) ? snapshot.payload.sessions : [];
      out.payload.sessions = arr.filter(r => { if (isFuture(r)) { _trackSkip(r); return false; } return true; });
    } else if (key === 'rest_log') {
      // payload.rest_log is an OBJECT keyed by date. Filter the whole
      // day entry if its envelope (or its sleep sub-record) is future-
      // schema. For naps, drop only the individual future-schema entries
      // and keep the day with the remaining naps.
      const obj = (snapshot.payload.rest_log && typeof snapshot.payload.rest_log === 'object'
                   && !Array.isArray(snapshot.payload.rest_log))
        ? snapshot.payload.rest_log : {};
      const filtered = {};
      for (const k of Object.keys(obj)) {
        const day = obj[k];
        if (isFuture(day) || (day && isFuture(day.sleep))) {
          // Track the highest version we can read — prefer the day
          // envelope, fall back to the sleep sub-record's version.
          if (isFuture(day)) {
            _trackSkip(day);
          } else if (day && isFuture(day.sleep)) {
            _trackSkip(day.sleep);
          }
          continue;
        }
        let dayOut = day;
        if (day && Array.isArray(day.naps)) {
          const okNaps = day.naps.filter(n => { if (isFuture(n)) { _trackSkip(n); return false; } return true; });
          if (okNaps.length !== day.naps.length) dayOut = Object.assign({}, day, { naps: okNaps });
        }
        filtered[k] = dayOut;
      }
      out.payload.rest_log = filtered;
    } else if (key === 'presets') {
      const arr = Array.isArray(snapshot.payload.presets) ? snapshot.payload.presets : [];
      out.payload.presets = arr.filter(r => { if (isFuture(r)) { _trackSkip(r); return false; } return true; });
    } else if (key === 'bfrb_events') {
      out.payload = Object.assign({}, snapshot.payload);
      const arr = Array.isArray(snapshot.payload.events) ? snapshot.payload.events : null;
      if (arr) {
        out.payload.events = arr.filter(r => { if (isFuture(r)) { _trackSkip(r); return false; } return true; });
      }
    } else if (key === 'distractions') {
      // payload shape: { flow: {sessionId: [entries]}, pomodoro: same }.
      // Filter at entry level within each session.
      out.payload = Object.assign({}, snapshot.payload);
      for (const ctx of ['flow', 'pomodoro']) {
        const map = snapshot.payload[ctx];
        if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
        const filteredMap = {};
        for (const sid of Object.keys(map)) {
          const entries = Array.isArray(map[sid]) ? map[sid] : [];
          filteredMap[sid] = entries.filter(e => { if (isFuture(e)) { _trackSkip(e); return false; } return true; });
        }
        out.payload[ctx] = filteredMap;
      }
    } else if (key === 'mood_events') {
      out.payload = Object.assign({}, snapshot.payload);
      const arr = Array.isArray(snapshot.payload.events) ? snapshot.payload.events : null;
      if (arr) {
        out.payload.events = arr.filter(r => { if (isFuture(r)) { _trackSkip(r); return false; } return true; });
      }
    } else {
      // Unknown store key — pass through verbatim (defensive forward-compat
      // for future stores added by E-2+ work).
      out.payload = snapshot.payload;
    }

    out.__skipped = skipped;

    // E-3: F19a observability emit — surface the dispatcher's local-side
    // refuse-writeback event so `js/sync-toast.js`'s `downlevelWarning`
    // listener can paint a user-facing message. Once-per-store emit
    // (the dispatcher sees ≤7 future-schema events per cycle even in
    // worst-case bursts; the toast's `_downlevelWarningShown` dedup
    // collapses cross-store duplicates to one toast per session).
    if (skipped > 0) {
      try {
        const localVer = (typeof Schema !== 'undefined' && typeof Schema.SCHEMA_VERSION === 'number')
          ? Schema.SCHEMA_VERSION
          : 0;
        emit('refuse-writeback', {
          store: key,
          remoteSchemaVersion: highestSkippedVersion,
          localSchemaVersion: localVer,
        });
      } catch (_) { /* listener errors must not break the filter chain */ }
    }

    return out;
  }

  // ── Event emitter ─────────────────────────────────────────────────────
  //
  // Minimal sync emitter. Events:
  //   - 'auth-change'             (B-2)  payload: { uid, email } | null
  //   - 'merge-complete'          (D-2)  payload: { store, count }
  //   - 'meds-arrival'            (B-4)  payload: { medId }
  //   - 'error'                   (any)  payload: { stage, error }
  //   - 'refuse-writeback'        (E-3)  payload: { store, remoteSchemaVersion, localSchemaVersion, remoteDeviceId? }
  //   - 'listener-connected'      (E-3)  payload: { store }
  //   - 'listener-disconnected'   (E-3)  payload: { store, reason? }
  // B-1 shipped the API surface; downstream PRs (B-3 / C-1 / D-1 /
  // E-1c→f8 / E-1e / E-2 / E-3) wire emits at the relevant call sites.

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

  // Walk an object / array recursively and collect every `deviceId`
  // string found at any depth into `out` (a Set). Used by the F9
  // read-cloud-first guard to distinguish "cloud has writes from this
  // device" (post-first-push retry / re-sync) from "cloud has writes
  // from another device" (the real Stage D handoff case). Closes
  // caveat (b) — without this, every Push after the first lands in
  // Stage D because the guard saw cloud-non-empty and couldn't tell
  // self-writes from foreign writes.
  //
  // Reaches into nested structures because some stores stamp deviceId
  // on inner entries rather than the top-level doc (e.g. rest_log day
  // records contain `naps[].deviceId`).
  function _collectDeviceIds(value, out) {
    if (value == null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const v of value) _collectDeviceIds(v, out);
      return;
    }
    for (const key of Object.keys(value)) {
      const v = value[key];
      if (key === 'deviceId' && typeof v === 'string' && v) {
        out.add(v);
      } else {
        _collectDeviceIds(v, out);
      }
    }
  }

  // Probe the cloud per-store. Returns { isEmpty, counts, deviceIds }.
  // `deviceIds` is a Set<string> of every `deviceId` value found across
  // all cloud docs (top-level and nested) — consumed by the F9 push
  // guard's "all-self-writes" check (caveat b fix).
  async function _pullCloudSnapshot(uid) {
    const counts = {};
    const deviceIds = new Set();
    let total = 0;
    for (const { key } of SYNCED_STORES) {
      const result = await SyncFirestore.getCollection(`users/${uid}/${key}`);
      const c = (result && typeof result.count === 'number') ? result.count : 0;
      counts[key] = c;
      total += c;
      // Walk each doc's data to harvest deviceId stamps. Defensive
      // typeof + Array.isArray guards keep this safe against backend
      // shape changes / partial responses.
      const docs = (result && Array.isArray(result.docs)) ? result.docs : [];
      for (const d of docs) {
        if (d && d.data) _collectDeviceIds(d.data, deviceIds);
      }
    }
    return { isEmpty: total === 0, counts, deviceIds };
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
        // Cloud has data. Three sub-paths to distinguish:
        //   1. "my failed retry" — partial-upload marker matches this
        //      user. Proceed (existing path, predates caveat b fix).
        //   2. "all cloud docs are my own previous successful pushes"
        //      — partial-upload marker is gone (cleared on prior
        //      success), but every cloud deviceId stamp matches THIS
        //      device. Caveat (b) fix: skip Stage D, proceed with
        //      idempotent re-upload. Without this branch, the second+
        //      Push from any device always lands in Stage D (caught
        //      at 2026-05-17 two-tab validation; backlog #6 caveat b).
        //   3. "genuine Stage D" — cloud carries at least one foreign
        //      deviceId. Hand off to D-1's reconcile flow.
        const markerUid = _getPartialUploadUid();
        if (markerUid !== user.uid) {
          // Path 2 vs path 3 — inspect cloud deviceId set.
          const thisDeviceId = (typeof History !== 'undefined' &&
            typeof History.getDeviceId === 'function')
            ? History.getDeviceId()
            : null;
          let foreignDeviceFound = false;
          if (thisDeviceId) {
            for (const id of cloudProbe.deviceIds) {
              if (id !== thisDeviceId) { foreignDeviceFound = true; break; }
            }
          } else {
            // Can't determine this device's id (defensive — History
            // unavailable). Fall back to current behavior: any cloud
            // deviceId at all is treated as foreign so we don't
            // accidentally clobber another device's data.
            foreignDeviceFound = cloudProbe.deviceIds.size > 0;
          }
          if (foreignDeviceFound) {
            setStageDHandoff();
            const result = {
              ok: false,
              kind: 'stage-d-handoff',
              counts: cloudProbe.counts,
            };
            emit('push-complete', result);
            return result;
          }
          // Else: all cloud stamps match this device (or cloud has no
          // stamps at all — pre-F10 era, treated as neutral). Safe to
          // re-upload via the idempotent setDoc path below.
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

  // History: prefer cloud on `sessionId` collision. Collisions surface
  // via a single summary console.warn at the end of the merge so debug
  // logs stay readable when the burst is large. Caught at two-tab
  // validation 2026-05-17: 13 per-collision warnings fired in a 1ms
  // burst during a Reconcile, drowning out other reconcile output.
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
    // Collect colliding IDs for the single end-of-merge summary log.
    const collisionIds = [];
    for (const rec of localRecords) {
      if (!rec || typeof rec.id !== 'string' || !rec.id) continue;
      if (seen.has(rec.id)) {
        collisionIds.push(rec.id);
        continue;
      }
      out.push(rec);
      seen.add(rec.id);
    }
    // Summary log replaces the previous per-collision console.warn.
    // First 10 IDs are inlined so debugging a specific Firestore doc
    // is still possible; longer bursts surface as "+N more".
    if (collisionIds.length > 0) {
      try {
        const PREVIEW_LIMIT = 10;
        const head = collisionIds.slice(0, PREVIEW_LIMIT);
        const more = collisionIds.length > PREVIEW_LIMIT
          ? ' (+' + (collisionIds.length - PREVIEW_LIMIT) + ' more)'
          : '';
        console.warn(
          '[SyncEngine] reconcile history: ' + collisionIds.length +
          ' sessionId collision(s) resolved cloud-wins; ids=[' +
          head.join(', ') + ']' + more
        );
      } catch (_) {}
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
        // E-1c retrofit (Pick A on E-1c-PROMPT TODO #4): after
        // _mergeMeds() unions cloud ∪ local records by (medId,
        // originDeviceId), iterate each merged med and call
        // MedsManager.reconcileDoseLog(med, incomingEntries) to collapse
        // cross-device ±15-min duplicates (F1) and clamp clock-skewed
        // entries (F16). incomingEntries is `med.doseLog` itself — the
        // helper's union step combines existing ∪ incoming + dedups by
        // (deviceId, takenAt), so passing doseLog twice is correct
        // (the reconcile result is the deduplicated/collapsed set).
        // Reassign result.entries onto med.doseLog BEFORE firing
        // onMergeComplete (Risk #11 — F4 recompute reads med.doseLog).
        // Per-med try/catch so one bad record doesn't abort reconcile.
        if (Array.isArray(mergedMeds) && typeof MedsManager !== 'undefined') {
          for (const med of mergedMeds) {
            if (!med || typeof med.id !== 'string') continue;
            try {
              const result = MedsManager.reconcileDoseLog(med, med.doseLog || []);
              med.doseLog = Array.isArray(result.entries) ? result.entries : [];
              if (typeof MedsManager.onMergeComplete === 'function') {
                try { MedsManager.onMergeComplete(med.id); } catch (_) {}
              }
            } catch (_) {
              // Per-med reconcile failures don't abort the D-1 cycle;
              // emit a structured progress warning and continue.
              try { emit('reconcile-progress', { stage: 'reconcile-warning', store: 'meds', id: med.id }); }
              catch (__) {}
            }
          }
        }
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

        // E-3 listener arm — once the 4-condition gate is satisfied
        // (hydrate markers set in step 7, Stage D cleared in step 8),
        // auto-start steady-state so listeners come up without
        // requiring a page reload. Idempotent via startSteadyState's
        // existing _steadyTimer guard. Defensive try/catch keeps the
        // return value unaffected by any wire-up failure.
        try {
          const currentUser = (typeof SyncAuth !== 'undefined' && typeof SyncAuth.getCurrentUser === 'function')
            ? SyncAuth.getCurrentUser()
            : null;
          if (currentUser) _maybeAutoStartSteady(currentUser);
        } catch (_) {}

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

  // ── E-1b: steady-state merge timer scaffold ──────────────────────────
  //
  // `startSteadyState()` arms a periodic merge timer that invokes
  // `_runMergeCycle()` at the configured interval. E-1e removed the
  // `tempo_sync_steady_state_enabled` dev flag — steady-state runs by
  // default for any user signed in with the master sync flag on. The
  // four-condition gate (signed in + master sync flag on + all-
  // hydrated + no Stage D handoff) is enforced by
  // `_maybeAutoStartSteady(user)`, which auto-fires from both
  // `init()` end (cold-boot path) and `_maybeAutoHydrate.then()`
  // (first-sign-in path).
  //
  // E-1c-onward: each merge function ships a real per-store body:
  // meds (E-1c), history (E-1d), bfrb_events (E-1d-f3), distractions
  // (E-1d-f8), rest_log + presets (E-1e). The dispatcher's per-store
  // try/catch wraps each call so one bad merge doesn't short-circuit
  // the rest of the cycle.
  //
  // Pause mechanism (per Pick B on E-1b-PROMPT TODO #2): `visibility-
  // change` always paused; `Platform.network` feature-detected — if
  // present, the timer also pauses on network loss. The handlers are
  // stashed on module-scope slots so `stopSteadyState()` can remove
  // them with the same function reference (anonymous handlers would
  // leak — Risk #6).
  //
  // SyncState flip: the dispatcher's `_runMergeCycle` flips
  // SyncState to 'hydrating' BEFORE the per-store loop (E-1c F13
  // dispatcher-wide write gate) and restores 'ready' in the
  // chained `.finally()`. Local writes via `SyncState.canWrite()`
  // are blocked while the merge cycle runs.

  function _getSteadyInterval() {
    const ls = _getStorage();
    if (!ls) return STEADY_STATE_DEFAULT_MS;
    let raw;
    try { raw = ls.getItem(STEADY_STATE_INTERVAL_KEY); }
    catch (_) { return STEADY_STATE_DEFAULT_MS; }
    if (raw == null || raw === '') return STEADY_STATE_DEFAULT_MS;
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
      return STEADY_STATE_DEFAULT_MS;
    }
    // Inclusive clamp — boundary values pass through unchanged.
    return Math.min(STEADY_STATE_MAX_MS, Math.max(STEADY_STATE_MIN_MS, parsed));
  }

  // E-2: dispatcher-level write-site hook. Called from `_runMergeCycle`
  // when the network is offline; enqueues a buffer pointer per dirty
  // record so the user's offline writes drain FIFO on reconnect (with
  // `originalWallClock` preserved per strategy doc Q3 lock).
  //
  // Per Pick A on E-2-PROMPT TODO #1, the buffer is pointer-based, so
  // this helper does NOT mutate the local record — it captures a
  // `(store, recordId, originalWallClock)` triplet for replay.
  //
  // Feature-detect SyncBuffer: a partial test stub / pre-deploy
  // environment may omit it. Missing module is a silent fall-through
  // (local-first contract: correctness from local state alone).
  function _maybeBufferOnOffline(storeKey, recordId, originalWallClock) {
    if (typeof SyncFlag === 'undefined' || !SyncFlag.isEnabled()) return;
    if (typeof SyncAuth === 'undefined' || typeof SyncAuth.getCurrentUser !== 'function') return;
    const user = SyncAuth.getCurrentUser();
    if (!user || !user.uid) return;
    if (typeof Platform === 'undefined' || !Platform || !Platform.network) return;
    if (typeof Platform.network.isOnline !== 'function') return;
    if (Platform.network.isOnline() !== false) return;
    if (typeof SyncBuffer === 'undefined' || typeof SyncBuffer.enqueue !== 'function') return;
    try {
      const ret = SyncBuffer.enqueue({
        store: storeKey,
        recordId: String(recordId == null ? '' : recordId),
        originalWallClock: (typeof originalWallClock === 'number') ? originalWallClock : Date.now(),
      });
      // enqueue is async; swallow rejection so caller never breaks.
      if (ret && typeof ret.then === 'function') {
        ret.catch(() => {});
      }
    } catch (_) {}
  }

  // E-2: enumerate dirty records in a per-store snapshot + enqueue
  // pointers via _maybeBufferOnOffline. Lightweight Pick (a) on audit:
  // when offline, the dispatcher walks each store's snapshot and
  // enqueues one pointer per record. Compaction in `SyncBuffer.enqueue`
  // (for COMPACTABLE_STORES) keeps the queue bounded under chatty UX.
  //
  // Payload shapes are the same per-store envelopes consumed by
  // `_filterFutureRecordsInSnapshot` — meds[], history.sessions[],
  // rest_log{date}, presets[], bfrb_events.events[],
  // distractions.flow{}/.pomodoro{}, mood_events.events[].
  function _enqueueDirtyRecordsForStore(storeKey, snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.payload) return;
    const payload = snapshot.payload;
    const now = Date.now();

    if (storeKey === 'meds') {
      const arr = Array.isArray(payload.meds) ? payload.meds : [];
      for (const r of arr) {
        if (!r || typeof r.id === 'undefined' || r.id === null) continue;
        const wc = (typeof r.updatedAt === 'number') ? r.updatedAt : now;
        _maybeBufferOnOffline('meds', String(r.id), wc);
      }
      return;
    }
    if (storeKey === 'history') {
      const arr = Array.isArray(payload.sessions) ? payload.sessions : [];
      for (const r of arr) {
        if (!r || typeof r.id === 'undefined' || r.id === null) continue;
        const wc = (typeof r.updatedAt === 'number') ? r.updatedAt : now;
        _maybeBufferOnOffline('history', String(r.id), wc);
      }
      return;
    }
    if (storeKey === 'rest_log') {
      const obj = (payload.rest_log && typeof payload.rest_log === 'object'
                   && !Array.isArray(payload.rest_log))
        ? payload.rest_log : {};
      for (const dateKey of Object.keys(obj)) {
        const day = obj[dateKey];
        const wc = (day && day.sleep && typeof day.sleep.updatedAt === 'number')
          ? day.sleep.updatedAt
          : ((day && typeof day.updatedAt === 'number') ? day.updatedAt : now);
        _maybeBufferOnOffline('rest_log', String(dateKey), wc);
      }
      return;
    }
    if (storeKey === 'presets') {
      const arr = Array.isArray(payload.presets) ? payload.presets : [];
      for (const r of arr) {
        if (!r || typeof r.id === 'undefined' || r.id === null) continue;
        const wc = (typeof r.updatedAt === 'number') ? r.updatedAt : now;
        _maybeBufferOnOffline('presets', String(r.id), wc);
      }
      return;
    }
    if (storeKey === 'bfrb_events') {
      const arr = Array.isArray(payload.events) ? payload.events : [];
      for (const r of arr) {
        if (!r || typeof r.takenAt !== 'number') continue;
        const dev = (typeof r.deviceId === 'string' && r.deviceId) ? r.deviceId : 'no-device';
        const recordId = dev + '-' + r.takenAt;
        const wc = (typeof r.updatedAt === 'number') ? r.updatedAt : r.takenAt;
        _maybeBufferOnOffline('bfrb_events', recordId, wc);
      }
      return;
    }
    if (storeKey === 'mood_events') {
      const arr = Array.isArray(payload.events) ? payload.events : [];
      for (const r of arr) {
        if (!r || typeof r.at !== 'number') continue;
        const dev = (typeof r.deviceId === 'string' && r.deviceId) ? r.deviceId : 'no-device';
        const recordId = dev + '-' + r.at;
        const wc = (typeof r.updatedAt === 'number') ? r.updatedAt : r.at;
        _maybeBufferOnOffline('mood_events', recordId, wc);
      }
      return;
    }
    if (storeKey === 'distractions') {
      const flow = (payload.flow && typeof payload.flow === 'object') ? payload.flow : {};
      const pomo = (payload.pomodoro && typeof payload.pomodoro === 'object') ? payload.pomodoro : {};
      for (const sessionId of Object.keys(flow)) {
        const entries = Array.isArray(flow[sessionId]) ? flow[sessionId] : [];
        for (const r of entries) {
          if (!r || typeof r.timestamp !== 'number') continue;
          const dev = (typeof r.deviceId === 'string' && r.deviceId) ? r.deviceId : 'no-device';
          const recordId = 'flow-' + sessionId + '-' + dev + '-' + r.timestamp;
          const wc = (typeof r.updatedAt === 'number') ? r.updatedAt : r.timestamp;
          _maybeBufferOnOffline('distractions', recordId, wc);
        }
      }
      for (const sessionId of Object.keys(pomo)) {
        const entries = Array.isArray(pomo[sessionId]) ? pomo[sessionId] : [];
        for (const r of entries) {
          if (!r || typeof r.timestamp !== 'number') continue;
          const dev = (typeof r.deviceId === 'string' && r.deviceId) ? r.deviceId : 'no-device';
          const recordId = 'pomodoro-' + sessionId + '-' + dev + '-' + r.timestamp;
          const wc = (typeof r.updatedAt === 'number') ? r.updatedAt : r.timestamp;
          _maybeBufferOnOffline('distractions', recordId, wc);
        }
      }
      return;
    }
  }

  function _runMergeCycle() {
    // Re-entry guard — coalesce overlapping ticks. A slow merge cycle
    // (e.g. an IDB read on tick N still running) means tick N+1 returns
    // immediately rather than starting a second cycle in parallel.
    if (_steadyRunInFlight) return;

    // Preconditions: flag on, signed in, SyncState not busy or errored.
    if (typeof SyncFlag === 'undefined' || !SyncFlag.isEnabled()) return;
    if (typeof SyncAuth !== 'undefined' && typeof SyncAuth.getCurrentUser === 'function') {
      const user = SyncAuth.getCurrentUser();
      if (!user || !user.uid) return;
    }
    if (typeof SyncState !== 'undefined' && typeof SyncState.get === 'function') {
      const state = SyncState.get();
      if (state === 'hydrating' || state === 'error') return;
    }

    // E-2: offline-branch early-return. If `Platform.network.isOnline()`
    // is defined AND returns `false`, enumerate dirty records per store
    // + enqueue buffer pointers, then short-circuit the cloud-write
    // phase. The next `online` event triggers `SyncBuffer.drain()`
    // (wired in the network listener at lines ~1911-1955 below).
    // Defensive feature-detect — when Platform.network is unavailable
    // (legacy environments, partial test stubs), fall through to the
    // normal merge cycle.
    let _offlineBuffered = false;
    try {
      // E-3 (TODO #8 Pick A): the outer `typeof SyncBuffer !== 'undefined'`
      // check was unreachable in practice — the lexical binding from
      // `const SyncBuffer = (() => {...})()` at the top of
      // `js/sync-buffer.js` is always defined when the script loads.
      // The secondary `typeof SyncBuffer.enqueue === 'function'` check
      // IS the real feature-detect. One-line cleanup; identical runtime
      // behavior. (E-2 follow-up symmetry fix.)
      if (typeof Platform !== 'undefined' && Platform && Platform.network
          && typeof Platform.network.isOnline === 'function'
          && Platform.network.isOnline() === false
          && typeof SyncBuffer.enqueue === 'function') {
        for (const { key, adapter } of SYNCED_STORES) {
          if (!adapter || typeof adapter.read !== 'function') continue;
          let snapshot;
          try { snapshot = adapter.read(); } catch (_) { continue; }
          if (snapshot && typeof snapshot.then === 'function') {
            // Async snapshot (History) — fire-and-forget the enumeration.
            // Errors swallowed; the next online tick rebuilds the queue.
            const captureKey = key;
            snapshot.then((resolved) => {
              try { _enqueueDirtyRecordsForStore(captureKey, resolved); } catch (_) {}
            }).catch(() => {});
          } else {
            try { _enqueueDirtyRecordsForStore(key, snapshot); } catch (_) {}
          }
        }
        _offlineBuffered = true;
      }
    } catch (_) {
      // Defensive — buffer enqueue path must never break the dispatcher.
    }
    if (_offlineBuffered) return;

    _steadyRunInFlight = true;
    const storeResults = { meds: null, history: null, rest_log: null, presets: null, bfrb_events: null, distractions: null, mood_events: null };

    // E-1c: F13 dispatcher-wide write gate flip (Pick B on E-1c-PROMPT
    // TODO #2). Flip SyncState to 'hydrating' BEFORE the per-store loop
    // so engine writes via `SyncState.canWrite()` are blocked while the
    // merge cycle runs. Restored to 'ready' in the cleanup path below.
    // Risk #1: cleanup MUST run even on exception — the sync try/finally
    // around the loop AND the .finally() chained onto the async tail
    // both guarantee restoration. Leaving SyncState stuck in 'hydrating'
    // would permanently block local writes.
    //
    // Only flip when SyncState exposes set() — test harnesses install
    // partial stubs (`{ get: () => 'ready' }`) and we must respect them.
    let _stateFlipped = false;
    if (typeof SyncState !== 'undefined' && typeof SyncState.set === 'function') {
      try {
        if (SyncState.set('hydrating')) _stateFlipped = true;
      } catch (_) { /* defensive — partial-stub envs */ }
    }

    // Resolve each store's merge module via defensive typeof checks —
    // the stub files install a global, but a test harness or future
    // refactor might omit them. Missing module is treated as an error
    // for that store; the loop keeps going.
    const moduleByKey = {
      meds:         (typeof SyncMergeMeds         !== 'undefined') ? SyncMergeMeds         : null,
      history:      (typeof SyncMergeHistory      !== 'undefined') ? SyncMergeHistory      : null,
      rest_log:     (typeof SyncMergeRestLog      !== 'undefined') ? SyncMergeRestLog      : null,
      presets:      (typeof SyncMergePresets      !== 'undefined') ? SyncMergePresets      : null,
      bfrb_events:  (typeof SyncMergeBfrb         !== 'undefined') ? SyncMergeBfrb         : null,
      distractions: (typeof SyncMergeDistractions !== 'undefined') ? SyncMergeDistractions : null,
      mood_events:  (typeof SyncMergeMood         !== 'undefined') ? SyncMergeMood         : null,
    };

    // E-1c: collect async per-store promises so we can chain a single
    // `.finally()` to restore SyncState + clear the in-flight latch
    // AFTER all merge functions resolve. Sync merge stubs (E-1b legacy
    // + test fixtures) produce a non-thenable result; we treat them
    // inline so the dispatcher emits `merge-cycle-complete` synchronously
    // in the sync-only path (preserves E-1b's "emits once per cycle"
    // test contract).
    const pendingPromises = [];

    // E-1c: wrap the per-store loop in try/finally so a non-Error throw
    // in the iteration boundary itself (not the per-store body) still
    // restores SyncState. The per-store try/catch inside the loop
    // catches sync merge errors as before.
    try {
      // Iterate in canonical order: meds → history → rest_log → presets
      // → bfrb_events → distractions → mood_events (matches SYNCED_STORES
      // registry).
      for (const { key, adapter } of SYNCED_STORES) {
        const mod = moduleByKey[key];
        if (!mod || typeof mod.merge !== 'function') {
          const err = new Error('merge module unavailable for store: ' + key);
          storeResults[key] = { ok: false, error: err };
          try { console.warn('[SyncEngine] steady-state merge module missing:', key); }
          catch (_) {}
          emit('merge-error', { store: key, error: err });
          continue;
        }

        // E-1e: dispatcher-level F19a snapshot gate (Pick C on TODO #4).
        // Read the per-store snapshot synchronously when possible (6 of
        // 7 stores return sync values; History is the async exception).
        // For the async case we treat the unfiltered snapshot as a
        // pass-through — the merge fn's cloud-side gate still catches
        // future-schema records over the wire. The local-side gate's
        // value is observability via the logged skip count, not
        // blocking (today's merge fns pass null to merge() and re-read
        // internally; the filtered snapshot is parked for E-2+ refactors
        // that may consume it directly).
        let filteredSnapshot = null;
        if (adapter && typeof adapter.read === 'function') {
          try {
            const rawSnapshot = adapter.read();
            if (rawSnapshot && typeof rawSnapshot.then === 'function') {
              // Async snapshot (History) — skip the local-side gate this
              // cycle. The cloud-side gate inside History's merge fn
              // still protects against future-schema records over the
              // wire. Observability gap is acceptable; History sessions
              // don't have meaningful future-record risk today.
              filteredSnapshot = null;
            } else {
              filteredSnapshot = _filterFutureRecordsInSnapshot(key, rawSnapshot);
              if (filteredSnapshot && filteredSnapshot.__skipped > 0) {
                try {
                  console.warn('[SyncEngine] dispatcher filtered '
                               + filteredSnapshot.__skipped
                               + ' future-schema local records from store: ' + key);
                } catch (_) {}
              }
            }
          } catch (snapshotErr) {
            // Snapshot read failed — log + pass null. The merge fn's
            // defensive path handles missing snapshot via internal
            // re-read (self-contained contract from E-1c onward).
            try {
              console.warn('[SyncEngine] snapshot read failed for ' + key + ':', snapshotErr);
            } catch (_) {}
          }
        }

        try {
          // Pass the filtered snapshot — merge fns still ignore the
          // argument today (E-1c-onward self-contained contract), but
          // the dispatcher contract now matches the future-proof shape.
          const result = mod.merge(filteredSnapshot);

          if (result && typeof result.then === 'function') {
            // Async merge — capture the promise and store the resolved
            // value on completion. A rejection still routes through
            // merge-error so observers see a uniform error shape.
            const captureKey = key;
            const p = result.then(
              (r) => { storeResults[captureKey] = { ok: true, result: r }; },
              (err) => {
                storeResults[captureKey] = { ok: false, error: err };
                try { console.warn('[SyncEngine] steady-state merge error (' + captureKey + '):', err); }
                catch (_) {}
                emit('merge-error', { store: captureKey, error: err });
              }
            );
            pendingPromises.push(p);
          } else {
            storeResults[key] = { ok: true, result };
          }
        } catch (err) {
          storeResults[key] = { ok: false, error: err };
          try { console.warn('[SyncEngine] steady-state merge error (' + key + '):', err); }
          catch (_) {}
          emit('merge-error', { store: key, error: err });
          // Continue — one bad store must not abort the loop (Risk #3).
        }
      }
    } catch (loopErr) {
      // Defensive — only reached if the iteration boundary itself
      // throws (not the per-store body). Emit a synthetic error so
      // observers know the cycle was malformed, then fall through to
      // cleanup.
      try { console.warn('[SyncEngine] dispatcher loop threw:', loopErr); } catch (_) {}
    }

    // Cleanup — restores F13 gate AND clears the in-flight latch in
    // one path (Risk #1: the pair MUST stay co-located). When all
    // store merges were sync, finalize immediately so the existing
    // E-1b test contract ("emits merge-cycle-complete exactly once per
    // cycle" — synchronously) still holds. When any merge is async,
    // defer finalization until all promises settle.
    function _finalizeCycle() {
      try { emit('merge-cycle-complete', { storeResults }); } catch (_) {}
      if (_stateFlipped) {
        try { SyncState.set('ready'); } catch (_) {}
      }
      _steadyRunInFlight = false;
    }

    if (pendingPromises.length === 0) {
      _finalizeCycle();
    } else {
      // Promise.all settles when every promise resolves OR ANY rejects.
      // We've already mapped rejections into `merge-error` per-store
      // via the wrapper above, so Promise.all here never rejects from
      // our perspective — but defensive .catch() is belt-and-suspenders
      // against a future refactor.
      Promise.all(pendingPromises).then(_finalizeCycle, _finalizeCycle);
    }
  }

  // ── E-3: real-time onSnapshot listener registry + per-store dispatch ─
  //
  // Listeners are the primary cross-device propagation mechanism per
  // Pick A on TODO #1; the 5-min `STEADY_STATE_DEFAULT_MS` poll is the
  // defensive fallback. Per-collection subscriptions (7 total — one per
  // SYNCED_STORES entry) wire up inside `startSteadyState()` next to
  // the timer arm; they tear down inside `stopSteadyState()` and
  // pause/resume on visibility + network state changes.
  //
  // Listener-driven snapshots invoke `_runMergeCycleForStore(storeKey)`
  // — a per-store dispatch seam that runs the merge fn for ONE store
  // only (vs `_runMergeCycle` which iterates all 7). Both paths share:
  //   - The `_steadyRunInFlight` re-entry guard (concurrent listener +
  //     timer cycles can't race).
  //   - The F19a `_filterFutureRecordsInSnapshot` snapshot pre-filter.
  //   - The F13 SyncState gate (early-exit on 'hydrating' / 'error').
  //
  // Trailing 1s debounce per Pick A on TODO #3: bursty snapshots from
  // another device coalesce into ONE merge call per store. `meds` burst
  // doesn't delay a single `presets` change — each store has its own
  // debouncer slot in `_storeDebouncers`.
  let _listenerUnsubs = new Map();   // storeKey → unsubscribe fn
  let _storeDebouncers = new Map();  // storeKey → timeoutId
  const LISTENER_DEBOUNCE_MS = 1000;

  function _runMergeCycleForStore(storeKey) {
    // Re-entry guard — shared with `_runMergeCycle`. A concurrent
    // listener-driven cycle MUST NOT overlap a timer-driven cycle.
    if (_steadyRunInFlight) return;

    // Preconditions — same shape as `_runMergeCycle`. We early-exit
    // silently on bail conditions so listener bursts during sign-out
    // / hydrate / error states don't spam the console.
    if (typeof SyncFlag === 'undefined' || !SyncFlag.isEnabled()) return;
    if (typeof SyncAuth !== 'undefined' && typeof SyncAuth.getCurrentUser === 'function') {
      const user = SyncAuth.getCurrentUser();
      if (!user || !user.uid) return;
    }
    if (typeof SyncState !== 'undefined' && typeof SyncState.get === 'function') {
      const state = SyncState.get();
      if (state === 'hydrating' || state === 'error') return;
    }

    // Resolve the per-store entry from SYNCED_STORES. Defensive — if
    // the storeKey doesn't match any registered entry, no-op.
    let entry = null;
    for (const e of SYNCED_STORES) {
      if (e.key === storeKey) { entry = e; break; }
    }
    if (!entry) return;

    const moduleByKey = {
      meds:         (typeof SyncMergeMeds         !== 'undefined') ? SyncMergeMeds         : null,
      history:      (typeof SyncMergeHistory      !== 'undefined') ? SyncMergeHistory      : null,
      rest_log:     (typeof SyncMergeRestLog      !== 'undefined') ? SyncMergeRestLog      : null,
      presets:      (typeof SyncMergePresets      !== 'undefined') ? SyncMergePresets      : null,
      bfrb_events:  (typeof SyncMergeBfrb         !== 'undefined') ? SyncMergeBfrb         : null,
      distractions: (typeof SyncMergeDistractions !== 'undefined') ? SyncMergeDistractions : null,
      mood_events:  (typeof SyncMergeMood         !== 'undefined') ? SyncMergeMood         : null,
    };
    const mod = moduleByKey[storeKey];
    if (!mod || typeof mod.merge !== 'function') {
      try { console.warn('[SyncEngine] per-store merge module missing:', storeKey); } catch (_) {}
      emit('merge-error', { store: storeKey, error: new Error('merge module unavailable for store: ' + storeKey) });
      return;
    }

    _steadyRunInFlight = true;

    // F13 dispatcher write gate — flip BEFORE the merge fn runs so
    // engine-side writes via `SyncState.canWrite()` are blocked while
    // the listener-driven cycle runs. Restored to 'ready' below in
    // both sync + async branches.
    let _stateFlipped = false;
    if (typeof SyncState !== 'undefined' && typeof SyncState.set === 'function') {
      try {
        if (SyncState.set('hydrating')) _stateFlipped = true;
      } catch (_) { /* defensive — partial-stub envs */ }
    }

    // F19a snapshot pre-filter — share the same gate `_runMergeCycle`
    // uses. The filtered snapshot is currently observability-only
    // (today's merge fns pass null and re-read internally) but the
    // future-proof contract is in place.
    let filteredSnapshot = null;
    const adapter = entry.adapter;
    if (adapter && typeof adapter.read === 'function') {
      try {
        const rawSnapshot = adapter.read();
        if (rawSnapshot && typeof rawSnapshot.then === 'function') {
          // Async snapshot (History) — skip the local-side gate this
          // cycle; the merge fn's cloud-side gate still protects.
          filteredSnapshot = null;
        } else {
          filteredSnapshot = _filterFutureRecordsInSnapshot(storeKey, rawSnapshot);
          if (filteredSnapshot && filteredSnapshot.__skipped > 0) {
            try {
              console.warn('[SyncEngine] dispatcher filtered '
                           + filteredSnapshot.__skipped
                           + ' future-schema local records from store: ' + storeKey);
            } catch (_) {}
          }
        }
      } catch (snapshotErr) {
        try {
          console.warn('[SyncEngine] snapshot read failed for ' + storeKey + ':', snapshotErr);
        } catch (_) {}
      }
    }

    function _finalizePerStore(result) {
      try { emit('merge-complete', { store: storeKey, result }); } catch (_) {}
      if (_stateFlipped) {
        try { SyncState.set('ready'); } catch (_) {}
      }
      _steadyRunInFlight = false;
    }

    try {
      const result = mod.merge(filteredSnapshot);
      if (result && typeof result.then === 'function') {
        result.then(
          (r) => _finalizePerStore({ ok: true, result: r }),
          (err) => {
            try { console.warn('[SyncEngine] per-store merge error (' + storeKey + '):', err); }
            catch (_) {}
            emit('merge-error', { store: storeKey, error: err });
            _finalizePerStore({ ok: false, error: err });
          }
        );
      } else {
        _finalizePerStore({ ok: true, result });
      }
    } catch (err) {
      try { console.warn('[SyncEngine] per-store merge error (' + storeKey + '):', err); }
      catch (_) {}
      emit('merge-error', { store: storeKey, error: err });
      _finalizePerStore({ ok: false, error: err });
    }
  }

  // Trailing 1s debounce per-store. First snapshot in a burst queues a
  // merge; subsequent snapshots within 1s reset the timer; one merge
  // fires 1s after the last snapshot in the burst. Per-store, so a
  // burst in `meds` doesn't delay a single change in `presets`.
  function _scheduleStoreMerge(storeKey) {
    const existing = _storeDebouncers.get(storeKey);
    if (existing != null) {
      try { clearTimeout(existing); } catch (_) {}
    }
    const timeoutId = setTimeout(() => {
      _storeDebouncers.delete(storeKey);
      try { _runMergeCycleForStore(storeKey); }
      catch (e) {
        try { console.warn('[SyncEngine] _runMergeCycleForStore threw:', e); } catch (_) {}
      }
    }, LISTENER_DEBOUNCE_MS);
    _storeDebouncers.set(storeKey, timeoutId);
  }

  function _subscribeAllStores() {
    if (typeof SyncFirestore === 'undefined' || typeof SyncFirestore.subscribe !== 'function') return;
    if (typeof SyncAuth === 'undefined' || typeof SyncAuth.getCurrentUser !== 'function') return;
    const user = SyncAuth.getCurrentUser();
    if (!user || !user.uid) return;
    const uid = user.uid;

    for (const { key } of SYNCED_STORES) {
      // Idempotent — if a listener for this store is already armed, skip.
      // Defensive against double-invocation from concurrent visibility +
      // network resume events.
      if (_listenerUnsubs.has(key)) continue;
      try {
        const captureKey = key;
        const unsub = SyncFirestore.subscribe(
          'users/' + uid + '/' + captureKey,
          function (snap) {
            // The error branch carries `{ ok: false, error }`; treat as
            // a disconnect signal so observers can update the UI status.
            if (snap && snap.ok === false) {
              try {
                emit('listener-disconnected', { store: captureKey, reason: 'error' });
              } catch (_) {}
              return;
            }
            // Happy path — debounce + dispatch to the per-store merge fn.
            _scheduleStoreMerge(captureKey);
          }
        );
        if (typeof unsub === 'function') {
          _listenerUnsubs.set(captureKey, unsub);
          try { emit('listener-connected', { store: captureKey }); } catch (_) {}
        }
      } catch (err) {
        // Per-store subscribe failure (e.g. native parity-pending throw)
        // must not break the wire-up of the other 5 stores. Surface as
        // a listener-disconnected event so the UI status reflects reality.
        try {
          emit('listener-disconnected', { store: key, reason: 'subscribe-failed' });
        } catch (_) {}
        try {
          console.warn('[SyncEngine] subscribe failed for store ' + key + ':', err);
        } catch (_) {}
      }
    }
  }

  function _unsubscribeAllStores(reason) {
    // Walk the registry calling each unsubscribe inside try/catch — a
    // failed individual unsubscribe must not block the rest. Then clear
    // the map so a fresh subscribe wires up cleanly. Idempotent: safe
    // to call when the map is already empty.
    for (const [key, unsub] of _listenerUnsubs.entries()) {
      try {
        if (typeof unsub === 'function') unsub();
      } catch (_) {}
      try {
        emit('listener-disconnected', { store: key, reason: reason || 'stopped' });
      } catch (_) {}
    }
    _listenerUnsubs.clear();

    // Clear any pending debouncers — a snapshot that arrived during the
    // tear-down window must not fire a merge after we've unsubscribed.
    for (const t of _storeDebouncers.values()) {
      try { clearTimeout(t); } catch (_) {}
    }
    _storeDebouncers.clear();
  }

  function startSteadyState() {
    // Idempotent — second call while timer is armed is a no-op.
    if (_steadyTimer != null) return;

    // E-1e: dev-flag gate removed. Steady-state arms whenever
    // `_maybeAutoStartSteady`'s four-condition gate passes — signed
    // in + master sync flag on + all-hydrated + no Stage D handoff.
    // Direct callers (e.g. dev console) also get an unconditional
    // arm here.

    const interval = _getSteadyInterval();

    // Visibility check before arming — if the tab is currently hidden,
    // wait for the next 'visible' event before starting the timer. The
    // visibilitychange handler stays registered either way so subsequent
    // visibility flips toggle the timer correctly.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      // Don't arm yet — handler below will start the timer on 'visible'.
    } else {
      _steadyTimer = setInterval(() => _runMergeCycle(), interval);
    }

    // E-3: arm the per-store onSnapshot listeners alongside the timer.
    // Defensive try/catch — listeners are the primary cross-device
    // propagation mechanism (Pick A on TODO #1) but a wire-up failure
    // (e.g. native parity-pending throw, Firestore SDK load failure)
    // must NOT prevent the defensive 5-min poll from arming. The 5-min
    // poll is the safety net for exactly this scenario.
    try { _subscribeAllStores(); } catch (_) {}

    // Wire visibilitychange — same handler reference stashed so
    // stopSteadyState() can removeEventListener cleanly (Risk #6).
    // E-3 extends the existing handler: pause-and-unsubscribe on hidden;
    // re-subscribe + one-shot catch-up `_runMergeCycle()` on visible.
    // The catch-up cycle is the safety net for the iOS Safari WebView
    // suspension case per Pick A on TODO #4.
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      _steadyVisibilityHandler = function () {
        if (document.visibilityState === 'hidden') {
          if (_steadyTimer != null) {
            clearInterval(_steadyTimer);
            _steadyTimer = null;
          }
          // E-3: tear down listeners while hidden — Firestore listeners
          // burn read budget even idle. The next 'visible' event re-arms.
          try { _unsubscribeAllStores('hidden'); } catch (_) {}
        } else if (document.visibilityState === 'visible') {
          if (_steadyTimer == null) {
            _steadyTimer = setInterval(() => _runMergeCycle(), interval);
          }
          // E-3: re-arm listeners + fire a one-shot catch-up cycle to
          // backfill anything missed while hidden. The catch-up is the
          // safety net for the iOS Safari "suspended for 30 minutes" case
          // where `onSnapshot` may not reconnect cleanly on resume.
          try { _subscribeAllStores(); } catch (_) {}
          try { _runMergeCycle(); } catch (_) {}
        }
      };
      try { document.addEventListener('visibilitychange', _steadyVisibilityHandler); }
      catch (_) { _steadyVisibilityHandler = null; }
    }

    // Feature-detect Platform.network (E-2 landed it; E-1b is
    // forward-compatible). If `onChange` returns an unsubscribe
    // function, stash it so stopSteadyState() can call it.
    try {
      if (typeof Platform !== 'undefined' && Platform &&
          Platform.network && typeof Platform.network.onChange === 'function') {
        const unsub = Platform.network.onChange(function (status) {
          // Match the visibility-handler shape: pause on offline,
          // resume on online. `status` shape is E-2's contract — defensive
          // duck-typing here.
          const online = (status && (status.connected === true || status.online === true)) ||
                         (status === 'online') || (status === true);
          if (online === false) {
            if (_steadyTimer != null) {
              clearInterval(_steadyTimer);
              _steadyTimer = null;
            }
            // E-3: tear down listeners while offline — they can't reach
            // Firestore anyway. The next 'online' event re-arms.
            try { _unsubscribeAllStores('offline'); } catch (_) {}
          } else if (online === true) {
            // Only resume if visibility says we should be active.
            const visible = (typeof document === 'undefined') ||
                            (document.visibilityState !== 'hidden');
            if (_steadyTimer == null && visible) {
              _steadyTimer = setInterval(() => _runMergeCycle(), interval);
            }
            // E-3: re-arm listeners + fire a one-shot catch-up cycle on
            // network resume (matches the visibility-resume semantic).
            // The catch-up backfills any cloud-side changes that
            // happened while we were offline.
            if (visible) {
              try { _subscribeAllStores(); } catch (_) {}
              try { _runMergeCycle(); } catch (_) {}
            }
            // E-2: also drain any buffered pending ops authored
            // during the offline window. Defensive feature-detect
            // so a missing module (legacy environments / partial
            // test stubs) doesn't break the steady-state resume.
            // Failures are logged + swallowed — buffer correctness
            // is opportunistic; the steady-state cycle will pick up
            // any remaining changes on the next tick regardless.
            try {
              if (typeof SyncBuffer !== 'undefined' && typeof SyncBuffer.drain === 'function') {
                SyncBuffer.drain().catch((err) => {
                  try { console.warn('[SyncEngine] SyncBuffer.drain failed during online handler:', err); }
                  catch (_e) {}
                });
              }
            } catch (_) {}
          }
        });
        if (typeof unsub === 'function') {
          _steadyNetworkUnsubscribe = unsub;
        }
      }
    } catch (_) {
      // Defensive — Platform.network is optional and pre-release.
    }
  }

  function stopSteadyState() {
    if (_steadyTimer != null) {
      try { clearInterval(_steadyTimer); } catch (_) {}
      _steadyTimer = null;
    }
    if (_steadyVisibilityHandler != null) {
      try {
        if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
          document.removeEventListener('visibilitychange', _steadyVisibilityHandler);
        }
      } catch (_) {}
      _steadyVisibilityHandler = null;
    }
    if (_steadyNetworkUnsubscribe != null) {
      try { _steadyNetworkUnsubscribe(); } catch (_) {}
      _steadyNetworkUnsubscribe = null;
    }
    // E-3: tear down all per-store listeners + clear pending debouncers.
    // Idempotent — safe to call when the registry is already empty.
    try { _unsubscribeAllStores('stopped'); } catch (_) {}
  }

  return {
    init, enable, disable, getState, getSnapshot,
    on, off, emit,
    // H3: user-initiated 'error'-gate recovery (the sync-error toast's Retry).
    retrySync,
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
    // E-1b: steady-state merge timer scaffold + internal dispatcher
    // (the cycle is exposed via `_runMergeCycle` for test-only direct
    // invocation; production callers use start/stop).
    startSteadyState,
    stopSteadyState,
    _runMergeCycle,
    // E-3: per-store dispatch seam + listener registry helpers
    // (exposed for test-only direct invocation; production wiring lives
    // inside startSteadyState/stopSteadyState's listener arming and
    // visibility/network handlers).
    _runMergeCycleForStore,
    _subscribeAllStores,
    _unsubscribeAllStores,
  };
})();
