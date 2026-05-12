# C-1 · Stage C Device B fresh hydrate — pull cloud state into a brand-new client

**PR:** `feat/sync-stage-c-hydrate` → `main`
**Stacked on:** `main` (S0-1, A-1, B-1, F19a-fix, B-2, B-3 all merged).
**Scope:** Wire the first real cloud **read-back** path. `SyncEngine.hydrateFromCloud()`
runs the auth-gate → empty-local guard (Stage D handoff if local non-empty)
→ pull-in-strict-order → per-engine `hydrateFromCloud(payload)` pipeline.
Each engine module (Meds, History, Presets, RecoveryUI) gains a `hydrateFromCloud()`
method that writes the cloud payload to local storage **via a privileged
hydrate write path that bypasses the F13 `SyncState.canWrite()` gate**.
Per-store + per-`all` localStorage markers (`tempo_sync_hydrated_<store>`,
`tempo_sync_hydrated_all`) gate boot-time re-pull and unlock partial-failure
resume. `js/app.js` subscribes to the auth-change event from B-2 and
auto-triggers hydrate on first sign-in for a fresh device. The settings
drawer status row extends B-3's `data-progress` enum with new
`hydrate-rest_log`, `hydrate-meds`, `hydrate-presets`, `hydrate-history`,
and `hydrate-done` states; the boot path puts up a blocking overlay
("Loading from cloud…") while hydrate runs.

C-1 is the **second observable cross-device milestone** ("Device B with
no local data signs in and pulls down Device A's state"). It is also
the **first PR that mutates local state from cloud-supplied data**, so
the blast radius lives on the read-back side of every store. The
audit fixes that surface *before* implementation so review focuses on
the privileged-write design, the Stage D safety net, and the
partial-failure recovery contract.

---

## Goal

Land `SyncEngine.hydrateFromCloud()` (cloud → local orchestrator),
per-engine `hydrateFromCloud(payload)` write methods on `MedsManager`,
`History`, `Presets`, and `RecoveryUI`, and the boot-time hydrate
trigger in `js/app.js` (subscribed to `SyncAuth.onAuthChange`). The
pull pipeline enforces F13 (flip `tempo_sync_state` to `'hydrating'`
during the pull window — also blocks every engine module's gated
`saveAll()`), F19a (preserve future-schema records from the cloud
verbatim — never downgrade on write), the new **Stage D non-empty-local
guard** (if local has any rows, abort to Stage D handoff instead of
overwriting), and the **per-store hydrate markers** (resume after
partial failure, short-circuit on `tempo_sync_hydrated_all === '1'`).
The hydrate is **auto-triggered on first sign-in** for a fresh device;
no manual button.

---

## Orchestrator note — ui-wirer Phase 4 FIRES (small surface)

**Yes.** C-1 ships visible DOM in three places, but the surface is
intentionally small (under 60 lines of new HTML/CSS plus the
`tempo-nav.js` subscription wiring):

1. **Boot-time loading overlay** (new) — full-screen "Loading from
   cloud…" overlay shown during the boot-path hydrate. Auto-dismisses
   on `hydrate-complete`. New `<div id="cloud-hydrate-overlay">` in
   `index.html` + ~30 lines of CSS in `css/styles.css`. The overlay
   is the safer UX vs background-with-banner (no race between in-flight
   state replacement and a half-rendered UI; first-launch users see
   "Loading" rather than blank meds / empty history flashes).
2. **Settings drawer status row extension** — B-3's `.tempo-cloud-sync-status[data-progress]`
   enum gains five new values: `hydrate-rest_log`, `hydrate-meds`,
   `hydrate-presets`, `hydrate-history`, `hydrate-done`. Status row
   shows the same single-line label pattern as B-3
   ("Loading meds (3/8)…"). No new color tokens; CSS reuses
   existing accent vars.
3. **`js/tempo-nav.js` `wireCloudSync` extension** — subscribe to
   the new `SyncEngine.on('hydrate-progress', …)` and `on('hydrate-complete', …)`
   events, dispatch to `setProgress(...)` / `setStatus(...)` helpers
   already defined in `wireCloudSync` from B-3. No new helpers needed.

The iOS `Info.plist`, `Podfile`, and Capacitor plugin set are **not**
touched by C-1 — Firestore reads use the same plugin shipped in S0-1
(`@capacitor-firebase/firestore`) via the existing
`SyncFirestore.getCollection()` seam. No new SDK call surface.

Workflow: audit → engine-implementer → engine-tester → **ui-wirer
Phase 4 (boot overlay + status row hydrate states + tempo-nav
event subscriptions)** → pr-shipper.

---

## Headline findings

1. **`SyncState.canWrite()` blocks hydrate's own writes unless we
   build a privileged-write path.** This is the central design
   question for C-1. F13's gate (default `'ready'`; flipped to
   `'hydrating'` during the pull window) currently blocks ALL writes
   on every synced store — `MedsManager.saveAll()`, `History.addSession()`,
   `Presets.save/update/remove`, `RecoveryUI.saveLog()`. But hydrate
   *itself* needs to write the pulled cloud data to local. Three
   resolutions exist (see "Open questions for the user" #1):
   - **a)** Add an internal "I am the hydrate path" flag to `SyncState`
     so `canWrite()` returns true for in-engine callers during hydrate.
     Cleaner but introduces stateful coupling between the gate and
     callers.
   - **b)** Each engine module exposes a separate `_hydrateWriteRaw(payload)`
     private helper that writes directly to localStorage/IDB **without
     going through `saveAll`'s gated path**. Public `hydrateFromCloud(payload)`
     is the entry point and is the only caller of `_hydrateWriteRaw`.
   - **c)** Temporarily flip state to `'ready'` for each store write,
     then back to `'hydrating'`. Brittle; race-y; rejected.
   - **Audit recommendation: (b)** — explicit privileged hydrate path
     per engine. Each engine's `hydrateFromCloud(payload)` is the only
     public method that writes during state==='hydrating'. Internally
     it calls a private `_hydrateWriteRaw` that bypasses the gate
     entirely (writes directly to localStorage / IDB). Cleaner than
     (a) (no gate state machine to reason about) and safer than (c)
     (no race window). The privileged-write pattern is explicit in
     code (`_hydrateWriteRaw` is named distinctly) so a future PR
     can't accidentally call it from a non-hydrate path.

2. **Stage D non-empty-local guard is the critical safety net.**
   If Device B has *any* existing local data and hydrate fires
   blindly, it OVERWRITES local with cloud — a data-loss bug. C-1
   must detect "this device has its own local data" before pulling
   and route to **Stage D handoff** instead. The detection algorithm:
   - Probe `MedsManager.count() > 0`, `await History.getSessions().length > 0`,
     `Presets.getAll().length > 0`, `Object.keys(RecoveryUI.loadLog()).length > 0`.
   - If **any** is non-empty, set
     `localStorage.setItem('tempo_sync_stage_d_handoff', '1')` (re-using
     the B-3 key — D-1 owns the actual `bucket: 'imported'` migration),
     emit `hydrate-complete { ok: false, kind: 'stage-d-handoff', counts }`,
     and **do not pull**. Cloud-side data stays intact.
   - This is the symmetric counterpart to B-3's Stage D handoff
     (which detected cloud-non-empty when local was about to push).
     B-3 set the same key; C-1 reads + sets it for the inverse
     direction. **Both paths flip the same flag** — that's the
     intent. D-1 then has a single signal to drive its reconcile UI.

3. **Per-store + per-`all` markers unlock partial-failure resume.**
   localStorage keys:
   - `tempo_sync_hydrated_rest_log` = `'1'`
   - `tempo_sync_hydrated_meds` = `'1'`
   - `tempo_sync_hydrated_presets` = `'1'`
   - `tempo_sync_hydrated_history` = `'1'`
   - `tempo_sync_hydrated_all` = `'1'`
   Set after each store completes its `_hydrateWriteRaw`. The
   `_all` marker is set only after every store's per-store marker is
   set AND the success path is reached. On next boot, hydrate logic
   checks `_all` first — if set, short-circuit (no-op). If not set,
   iterate per-store markers and only re-pull stores that are
   missing. This is the resume contract: a Wi-Fi drop mid-hydrate
   leaves the user with rest_log + meds locally hydrated but presets
   + history pending; next boot resumes from presets. Five keys is
   chosen over a single JSON-object key (Option a vs b in spec §4)
   for simpler read/write primitives — no parse cost, no migration
   on field shape changes, and each marker is independently
   debuggable in dev tools.

4. **Boot-trigger is event-driven, not awaited.** C-1 wires
   `SyncAuth.onAuthChange((user) => { if (user) maybeHydrate(user); })`
   inside `SyncEngine.init()`. When the user signs in for the first
   time (B-2 emits `auth-change` from the platform SDK rehydrate
   path on cold boot), the listener checks:
   - `SyncFlag.isEnabled()` AND
   - `user !== null` AND
   - `localStorage.getItem('tempo_sync_hydrated_all') !== '1'` AND
   - `localStorage.getItem('tempo_sync_stage_d_handoff') !== '1'`
   - then calls `hydrateFromCloud()`.
   The alternative (await `SyncAuth.init()` synchronously in
   `app.js`, then call `hydrateFromCloud`) is rejected because
   `Platform.auth.init()` is async and the existing app.js boot
   block is intentionally non-await (history init also awaits
   internally; auth init is fire-and-forget). The event-driven path
   matches B-2's existing `auth-change` pattern and is the same
   subscription point B-3 uses to re-render the push button.

5. **Boot-time hydrate blocks the UI behind an overlay; no
   render-then-replace.** Two options were evaluated (Open
   questions §6): (i) block-boot with a full-screen overlay
   ("Loading from cloud…") OR (ii) render UI immediately with a
   banner, then swap state mid-render. **Audit recommendation: (i),
   block-boot overlay.** The race between (1) the UI's various
   render loops querying engine state and (2) `_hydrateWriteRaw`
   replacing that state is unbounded — every engine module would
   need to handle "state was replaced mid-tick" gracefully. With a
   blocking overlay, the user sees a clear "Loading from cloud…"
   message for 2-5 seconds on first launch on a new device; on
   every subsequent launch (when `_all === '1'`), the overlay
   never shows. (ii) is a polish-PR opportunity later if first-launch
   UX feels too slow; for C-1, simpler is safer. The overlay is
   gated by `localStorage.getItem('tempo_sync_hydrated_all') !== '1' &&
   SyncFlag.isEnabled() && SyncAuth.getCurrentUser()` and self-removes
   on `hydrate-complete`.

6. **F19a future-schema records from the cloud are written as-is,
   never downgraded.** If Device A is on `schemaVersion: 2` and
   Device B is on `schemaVersion: 1`, the cloud has v2 records.
   `_hydrateWriteRaw` writes them as-is (preserving `schemaVersion:
   2` on disk) — F19a's refuse-writeback contract then keeps them
   read-only until B upgrades. This matches the existing pattern:
   `MedsManager.loadAll()` already detects future records via
   `Schema.isFutureRecord()` and sets the per-med `_fromFutureSchema`
   flag; the same code path runs after `_hydrateWriteRaw` writes
   the future record + then `loadAll()` re-reads it. **Critical
   contract:** `_hydrateWriteRaw` must NOT call `Schema.stamp()`
   on inner records (which would silently downgrade) — it writes the
   cloud record's `schemaVersion` field verbatim. F19a-fix (PR #59)
   already covers the read-side; this is the symmetric write-side
   contract that ships in C-1.

7. **Re-entry guard mirrors B-3's `_pushInFlight` pattern.**
   Two concurrent `hydrateFromCloud()` calls (e.g. boot-time
   auto-trigger races a settings-drawer manual button — not shipped
   in C-1 but defensible) → race. Mitigation:
   `_hydrateInFlight` module-scoped boolean +
   `_currentHydratePromise` in `SyncEngine`; second call returns
   the first call's promise. Same pattern as B-3's `_pushInFlight`
   (existing in `sync-engine.js` lines 32-33).

8. **Strict pull order is rest_log → meds → presets → history.**
   Matches B-3's upload order (per spec §C-1). Within each store,
   the per-record write loop is order-insensitive (each
   `_hydrateWriteRaw` call replaces the in-memory + on-disk state
   wholesale for its store). Order matters at the **store level**
   for one specific reason: `History.hydrateFromCloud()` is async
   (IDB-backed); the rest are sync. Strict serial ordering
   (`await` between stores) keeps the hydrate-progress events
   ordered and the per-store markers monotonically set. **The
   audit calls out a subtle Meds dependency**: `MedsManager.loadAll()`
   reads `tempo_device_id` for the `_medsGetDeviceId()` helper.
   `tempo_device_id` is minted by `History.init()` (line 175 in
   `history.js`) — but on a fresh Device B, `History.init()` ran
   at boot before hydrate fires, so the deviceId is already
   present. **The audit asserts in test #5:** deviceId exists in
   localStorage *before* `hydrateFromCloud()` begins. If
   `History.init()`'s deviceId mint races the auth-change handler
   (e.g. a pathologically cold boot where IDB open hangs), the
   audit's mitigation is the `_medsGetDeviceId()` helper itself —
   it mints lazily if missing. Documented; no code change.

9. **No real-time listeners. No background re-pull.** C-1 is
   one-shot. Once `tempo_sync_hydrated_all === '1'`, hydrate never
   re-fires. Steady-state ongoing sync (per-record listeners,
   periodic merge, conflict resolution) is **E-1's job**. **The
   audit's recommendation**: after C-1 ships, the user can manually
   trigger a re-hydrate by clearing `tempo_sync_hydrated_*`
   localStorage keys in dev tools — a dev-only escape hatch, no UI
   for it. E-1 ships the real listener.

10. **iOS Capacitor works identically.** Same engine code, same
    `Platform.auth`, same `SyncFirestore` (Firestore plugin
    handles native reads). iPhone is the **most common Device B**
    in real-world use (fresh install of the App Store app with
    months of web-side data already in Firestore). Manual e2e on
    iOS Capacitor with a fresh install / cleared state is a
    mandatory checklist item (see Manual setup steps).

11. **Hydrate does NOT trigger backup.** B-3's push pipeline runs
    F12 (mandatory local backup) before any cloud byte moves
    because push *mutates the cloud*. Hydrate *reads from cloud
    and writes to local* — F12 is irrelevant (cloud data is not
    at risk). However, **Stage D handoff DOES need to flag that
    local data exists**; D-1's reconcile UI will surface a
    "Backup your local data before reconciling" prompt. C-1 only
    sets the handoff flag; D-1 owns the backup prompt UX.

12. **Auth token expiry mid-hydrate routes to `'error'` state +
    surface for sign-back-in.** If the user's Firebase auth token
    expires between the boot rehydrate and the first
    `SyncFirestore.getCollection()` call, the call returns
    `{ kind: 'permission-denied' }`. C-1's catch path flips
    `SyncState.set('error')`, emits
    `hydrate-complete { ok: false, kind: 'permission-denied' }`,
    and tears down the overlay. The settings drawer status row
    surfaces "Please sign in again to continue." The user
    re-signs-in via the existing B-2 button; the auth-change
    handler re-fires; hydrate retries. **No per-store markers
    are set on this failure path** — full re-pull on retry.

---

## Affected files

| Path | Change type | Notes |
|------|-------------|-------|
| `js/sync-engine.js` | **modify** | Implement `hydrateFromCloud()` orchestrator mirroring B-3's `pushSnapshot()`. Adds (a) `_hydrateInFlight` boolean + `_currentHydratePromise` re-entry guard; (b) `_probeLocalEmpty()` helper that returns `{ isEmpty, counts }` (mirror of B-3's `_pullCloudSnapshot` shape) by calling each engine's count getter (`MedsManager.count()`, `(await History.getSessions()).length`, `Presets.getAll().length`, `Object.keys(RecoveryUI.loadLog()).length`); (c) `_pullStore(uid, storeKey)` helper calling `SyncFirestore.getCollection(`users/${uid}/${storeKey}`)`; (d) per-store hydrate marker helpers `_getHydratedMarker(store) / _setHydratedMarker(store) / _getHydratedAllMarker() / _setHydratedAllMarker()` reading/writing `tempo_sync_hydrated_<store>` and `tempo_sync_hydrated_all`; (e) the orchestrator function itself wiring auth-check → stage-D-probe → state.set('hydrating') → strict-pull loop → per-engine `hydrateFromCloud()` invocation → marker set → state.set('ready'). Emits two new events: `hydrate-progress` (payload `{ stage, store?, current?, total? }`) and `hydrate-complete` (payload `{ ok, kind?, error?, hydrated? }`). Also extends `SyncEngine.init()` to subscribe to `SyncAuth.onAuthChange` and call a private `_maybeAutoHydrate(user)` helper. |
| `js/meds.js` | **modify** | Add `MedsManager.hydrateFromCloud(payload)` public method. Signature: `(payload: { docs: [{id, data}], count }) => Promise<{ ok: true, count }>`. Internally calls a new private `_hydrateWriteRaw(records)` helper that: (1) clears `meds = []` in memory; (2) writes each cloud record to `localStorage[STORAGE_PREFIX + record.id]` via direct `localStorage.setItem` — **bypassing `saveAll`'s `SyncState.canWrite()` gate**; (3) calls `loadAll()` to re-read from disk into memory (ensures the `_fromFutureSchema` / `_originalSchemaVersion` / `_forwardBag` per-record flags get populated correctly by the loader); (4) returns `{ ok: true, count }`. **Critical contract:** `_hydrateWriteRaw` does NOT call `Schema.stamp()` on inner records — cloud records carry their own `schemaVersion` field and must be written verbatim (F19a). Defensive payload validation: skip records lacking `id` or `data`; log a single warning if any record is malformed. |
| `js/history.js` | **modify** | Add `History.hydrateFromCloud(payload)` async method. Signature: `async (payload: { docs: [{id, data}], count }) => { ok: true, count }`. Internally calls `_hydrateWriteRaw(records)` async helper that: (1) awaits `ready()`; (2) clears the `sessions` IDB store via a single `store.clear()` in a `readwrite` transaction — **bypassing `canWrite()` gate**; (3) `store.put(record)` for each cloud doc's `data` field (the doc id is already in the record's `id` field per B-3's upload contract); (4) returns count. **Critical contract:** `_hydrateWriteRaw` does NOT call `Schema.stamp()` (verbatim write). Defensive: skip records lacking `id`; warn on malformed. |
| `js/presets.js` | **modify** | Add `Presets.hydrateFromCloud(payload)` method. Signature: `(payload: { docs: [{id, data}], count }) => { ok: true, count }`. Internally calls `_hydrateWriteRaw(records)` that: (1) maps cloud docs to preset records (the doc id is in `record.id`); (2) writes the full array to `localStorage[STORAGE_KEY] = JSON.stringify(presets)` via direct `localStorage.setItem` — **bypassing `saveAll`'s `SyncState.canWrite()` gate**; (3) returns count. No `Schema.stamp()` call. |
| `js/recovery-ui.js` | **modify** | Add `RecoveryUI.hydrateFromCloud(payload)` method. Signature: `(payload: { docs: [{id, data}], count }) => { ok: true, count }`. Reverses B-3's per-record upload shape: the cloud has one Firestore doc per `YYYY-MM-DD` key (B-3's `_extractRecords` for `rest_log` extracts the date as the doc id). `_hydrateWriteRaw` rebuilds the `wellness_rest_log` object: for each cloud doc, `log[doc.id] = doc.data` (strip the `date` field B-3 added to the inner record — it's redundant once the key is `doc.id`). Then writes the rebuilt log via direct `localStorage.setItem` — **bypassing `saveLog`'s gate**. Per B-1's R1 decision: RecoveryUI is the "engine" for rest_log even though it's a UI file. |
| `js/persistence.js` | **modify** (small) | No new public API. `SyncState.isHydrating()` already exists from B-3. Audit asserts the existing gate semantics: when `SyncState.get() === 'hydrating'`, every gated engine write path (`MedsManager.saveAll`, `History.addSession`, `Presets.save/update/remove`, `RecoveryUI.saveLog`) returns early. **C-1's hydrate methods explicitly bypass these gates** by going through `_hydrateWriteRaw` (direct localStorage / direct IDB transaction), not through the standard `saveAll`/`saveLog` paths. Documented here; no code change. |
| `js/app.js` | **modify** | Two boot-block additions: (1) Before `SyncEngine.init()` (line 29), call a new `mountHydrateOverlay()` helper if `localStorage.getItem('tempo_sync_hydrated_all') !== '1' && SyncFlag.isEnabled() && SyncAuth.getCurrentUser() !== null`. The overlay is a fixed-position `<div id="cloud-hydrate-overlay">` with a "Loading from cloud…" label. Auto-dismiss on `SyncEngine.on('hydrate-complete', …)`. (2) The actual `SyncEngine.hydrateFromCloud()` trigger lives **inside** `SyncEngine.init()` via the `SyncAuth.onAuthChange` subscription — `app.js` only owns the overlay mount/unmount. This split keeps `app.js` from leaking sync-engine semantics into the boot flow. |
| `index.html` | **modify** (ui-wirer) | Two edits: (1) Add `<div id="cloud-hydrate-overlay" class="cloud-hydrate-overlay" hidden><div class="cloud-hydrate-message">Loading from cloud…</div></div>` near the top of `<body>` (above `<div id="app">`) so it stacks above all rendering. (2) No new `<script>` tags — C-1 only modifies existing modules. The `cloud-sync-status` row from B-3 picks up the new `data-progress` enum values automatically via the existing CSS attribute selectors (extended below). |
| `css/styles.css` | **modify** (ui-wirer) | Two blocks (~30 lines). (1) New `.cloud-hydrate-overlay` rules: `position: fixed; inset: 0; background: var(--bg, #000); z-index: 1000; display: flex; align-items: center; justify-content: center;` + `.cloud-hydrate-overlay[hidden] { display: none; }` + `.cloud-hydrate-message { font: var(--font-display, 18px system-ui); color: var(--fg, #fff); animation: cloud-hydrate-pulse 1.5s ease-in-out infinite; }` + the `@keyframes cloud-hydrate-pulse` block. (2) Extend B-3's `.tempo-cloud-sync-status[data-progress]` attribute selectors with five new values: `hydrate-rest_log`, `hydrate-meds`, `hydrate-presets`, `hydrate-history`, `hydrate-done`. Same visual treatment as B-3's `uploading-*` states (small spinner + step label). No new color tokens. |
| `js/tempo-nav.js` | **modify** (ui-wirer) | Extend `wireCloudSync` (line 309) at the existing event subscription block (line 519). Add two new subscriptions: `SyncEngine.on('hydrate-progress', (payload) => { setProgress('hydrate-' + payload.store); /* optional: setStatus('Loading ' + payload.store + ' (' + payload.current + '/' + payload.total + ')'); */ })` and `SyncEngine.on('hydrate-complete', (payload) => { if (payload.ok) { setProgress('hydrate-done'); setStatus('Synced from cloud', false); } else if (payload.kind === 'stage-d-handoff') { setProgress('stage-d-handoff'); setStatus('Existing local data — reconcile required (D-1)', false); } else { setProgress('error'); setStatus('Sync error: ' + (payload.error?.message ?? payload.kind), true); } renderCloudSyncUI(); })`. The `app.js` overlay also subscribes (separately, via a direct `SyncEngine.on('hydrate-complete', …)` listener registered in `mountHydrateOverlay()`) to remove the overlay. Both subscriptions coexist — emitter fan-out is preserved. |
| `tests/sync-hydrate.test.js` | **add** | New test file. Mocks `window.SyncFirestore`, `window.SyncAuth`, `window.SyncFlag`, `window.MedsManager`, `window.History`, `window.Presets`, `window.RecoveryUI` per-case. Mirrors the mock-based pattern from `sync-uploader.test.js`. **14+ cases (see "Test scope").** |
| `tests/sync-hydrate-engines.test.js` | **add** (optional) | If engine-implementer wants per-engine `hydrateFromCloud` roundtrip tests (separate from the orchestrator), ship a 4-case file: one case per engine asserting `_hydrateWriteRaw` actually replaces in-memory + on-disk state and a follow-up `loadAll()` re-reads it correctly (including F19a future-record preservation). Recommended; the orchestrator test can mock the engine `hydrateFromCloud` calls, but per-engine tests catch the privileged-write contract violations directly. |
| `tests/index.html` | **modify** (pr-shipper) | Add `<script src="sync-hydrate.test.js"></script>` (and optionally `sync-hydrate-engines.test.js`) to the test suites block (after `sync-uploader.test.js`). |
| `sw.js` | **modify** (pr-shipper) | **Bump `CACHE_NAME`** from `'stopwatch-v70-sync-uploader-share-fallback'` → `'stopwatch-v71-sync-hydrate'`. No new ASSETS entries — C-1 only modifies existing files; no new modules to cache. |

**Total: 14 files** (5 modify under code-path, 0 add under code-path,
1 add under tests, 1 modify under tests, plus 5 ui-wirer / pr-shipper-owned:
`index.html` DOM, `css/styles.css`, `js/tempo-nav.js`, `js/app.js`
overlay mount, `sw.js`. The one optional test file raises the maximum
to 15.)

---

## Sync invariants touched

Each row records the F# status for C-1 specifically. "Pass-through" =
C-1 reads but does not mutate the invariant. "New flip" = C-1 is the
first PR that exercises a previously-dormant invariant.

| F# | Description | Status in C-1 |
|----|-------------|---------------|
| F2 | Session IDs `${deviceId}-${ts}-${counter}` + `legacyId` | **Pass-through.** Hydrate writes cloud session records verbatim to IDB; their IDs were minted on Device A (already F2-shaped). Test #14 asserts: cloud-shaped IDs survive roundtrip through `History.hydrateFromCloud`. |
| F4 | Re-derive `lastTakenAt` after merge | **Hydrate-side touch.** `MedsManager.hydrateFromCloud → _hydrateWriteRaw` calls `loadAll()` after writing, which runs the loader's `lastTakenAt = doseLog[doseLog.length - 1].takenAt` reconciliation per med (line 293 of `meds.js`). So F4's invariant holds without an explicit `recomputeLastTakenAt` call. Audit test #6 asserts. |
| F6 | `phaseLog` `(deviceId, phaseStartedAt)` per-entry stamping | **Pass-through.** Inner phaseLog entries inside session records are written to IDB verbatim. Already stamped at Device A's write time per A-1's adapter contract. |
| F7 | `loadState` recoveries never persist back | **Pass-through.** Hydrate writes go through `_hydrateWriteRaw` (direct disk writes), NOT through `loadState`-triggered persistence. The post-write `loadAll()` call IS a `loadState` invocation per-record, but its job is in-memory rehydrate — it doesn't call `saveAll`. F7 holds. |
| F9 | Stage B0 read-cloud-first guard | **Pass-through.** F9 is the inverse direction (B-3 reads cloud before pushing). C-1 reads cloud as the *primary action*; no F9 check applies. The symmetric check in C-1 is the new Stage D non-empty-LOCAL guard (a different invariant — see "B-2 new" row below). |
| F10 | `deviceId` + `updatedAt` at write sites | **Pass-through with caveat.** `_hydrateWriteRaw` writes cloud records verbatim — including their `deviceId` and `updatedAt` fields, which were stamped on Device A. **C-1 does NOT re-stamp these fields with Device B's deviceId** (that would lose the cross-device origin attribution F1/F10 depend on for dedup). Critical contract: cloud records keep Device A's `deviceId` on disk. F10 holds. |
| F12 | Mandatory local backup before mutation | **N/A — read-from-cloud path.** F12 protects cloud mutations (B-3's push). Hydrate does not mutate the cloud, so F12 does not apply. The complementary backup-of-local before *Stage D reconcile* is D-1's job — C-1 only flags Stage D, doesn't reconcile. |
| F13 | `tempo_sync_state` write gate | **NEW USAGE — hydrate-side flip.** B-3 was the first to flip the gate (to `'hydrating'` during push). C-1 is the SECOND flipper, also to `'hydrating'`, during pull. The gate blocks every gated engine's `saveAll`/`addSession`/`saveLog`/etc. — keeping mid-hydrate UI events from racing the per-store replace. **C-1's privileged-write contract:** the per-engine `_hydrateWriteRaw` helpers EXPLICITLY bypass the gate (direct localStorage / direct IDB writes, not via `saveAll`). The gate stops UI-originated writes; the hydrate path is its own privileged channel. Audit tests #3 + #4 enforce. |
| F14 | doseLog cap @ 1000 | **Pass-through.** Cloud doseLog payloads were capped on Device A at upload time. Hydrate writes the (already-capped) record. No re-cap. |
| F15 | Toast on ≥2-entry remote doseLog arrival | **N/A.** F15 is the merge-side toast for steady-state arrivals (E-1 territory). Hydrate is one-shot; the user is intentionally consuming all cloud data at once. No toast — too noisy. The B-4 scaffold (the `meds-arrival` event hook) is NOT emitted by C-1. |
| F16 | ±15-min clock-skew clamp on non-local entries | **N/A.** Merge-side rule (D-2). Hydrate is wholesale-replace, not merge. Cloud records are written verbatim including any future-stamped entries (which were already clamped on Device A at write time). |
| F17 | Stage D imported bucket | **Flag-flip via existing key.** When hydrate detects non-empty local, it sets `tempo_sync_stage_d_handoff = '1'` (the SAME key B-3 set on the inverse path). D-1 consumes this flag and runs the actual `bucket: 'imported'` migration. C-1 only flips the flag — it does NOT migrate. **The audit calls out the safety contract:** when the flag is set, `hydrateFromCloud()` short-circuits on every subsequent call until D-1 clears it. The boot-time auto-hydrate explicitly checks both `tempo_sync_hydrated_all !== '1'` AND `tempo_sync_stage_d_handoff !== '1'`. |
| F19a | `schemaVersion` stamping + refuse-writeback | **NEW EXTENSION on the hydrate write path.** F19a-fix (PR #59) covered the engine read-back path. C-1 extends to: **`_hydrateWriteRaw` writes cloud records' `schemaVersion` field verbatim** — never re-stamping with `SCHEMA_VERSION`, never calling `Schema.stamp()` on cloud-supplied records. Future records flow through unchanged; the post-write `loadAll()` then surfaces them as `_fromFutureSchema = true` per-record, and the standard refuse-writeback contract (engine `saveAll` skips them; `remove` rejects them) holds. Audit test #8 asserts the future-schema cloud record's `schemaVersion: 2` survives roundtrip onto disk. |
| F19b | `__forward` passthrough (top-level unknowns) | **Pass-through.** Cloud records carry their `_forwardBag` fields already merged into the wire format (per B-3's upload contract). Hydrate writes them verbatim; the post-write `loadAll()` then re-collects unknowns into `_forwardBag` per the loader's standard logic. |
| F20 | Absent vs present-but-unknown enum split | **Pass-through.** Hydrate writes cloud record values verbatim. The per-engine loader's F20 logic (e.g. `setFrequency` preserving unknown enum values) runs on the post-write `loadAll()` re-read. |
| F21 | `alarmFired` per-device, never synced | **Holds structurally.** None of the four synced stores carry `alarmFired`. Hydrate cannot receive `alarmFired` from the cloud because nothing uploaded it. The per-engine post-`_hydrateWriteRaw` `loadAll()` doesn't introduce one either (it's a runtime engine-state field, not a persisted one). |
| **B-2 new** | Auth state gates cloud reads | **Honored.** `hydrateFromCloud()` first call: `if (!SyncAuth.getCurrentUser()) return { ok: false, kind: 'sign-in-required' };`. Auth-change subscription is the sole boot-time trigger — hydrate never fires without a current user. Audit test #12 enforces. |
| **C-1 new** | **Stage D non-empty-local guard** | **NEW INVARIANT — introduced here.** Before any cloud read or local mutation, C-1 probes every synced store for local data. If ANY store is non-empty, hydrate aborts to Stage D handoff (writes `tempo_sync_stage_d_handoff = '1'`, emits `hydrate-complete { ok: false, kind: 'stage-d-handoff' }`, does NOT pull, does NOT mutate any local store, does NOT flip `SyncState`). This is the symmetric counterpart to B-3's F9 (cloud-empty probe) and is the load-bearing data-loss prevention for the common-case "user installed iOS app after months of web use" scenario. Audit test #7 enforces. |
| **C-1 new** | **Per-store hydrate markers + `_all` short-circuit** | **NEW INVARIANT — introduced here.** Per-store markers (`tempo_sync_hydrated_<store>`) are set after each store's `hydrateFromCloud()` resolves. The `_all` marker is set ONLY after every store completes AND the success branch is reached. Subsequent `hydrateFromCloud()` calls short-circuit when `_all === '1'`. Boot-time auto-trigger checks `_all !== '1'`. Audit tests #1 + #2 + #4 + #14 enforce. |

**Summary:** C-1 introduces TWO new project invariants — the Stage D
non-empty-local guard and the per-store hydrate markers — and is the
SECOND PR to flip F13 (after B-3). F19a is extended to the hydrate
write path. F12, F15, F16 are explicitly N/A. The B-2 auth gate is
honored on every hydrate trigger.

---

## Risks

| Risk | Likelihood | Blast radius | Mitigation |
|------|------------|--------------|------------|
| **Boot-path bug breaks app start on Device B** — a thrown error inside `hydrateFromCloud()` or the boot-overlay mount that doesn't get caught propagates up and either freezes the loading screen or aborts the entire JS bundle. | med | data-loss + UX (app doesn't start; user can't even sign out without dev tools) | Defensive try/catch around the entire `_maybeAutoHydrate(user)` body in `SyncEngine.init()` — any thrown error logs to console, flips `SyncState.set('error')`, removes the overlay, and surfaces a "Cloud sync error — local mode active" status. The overlay's auto-dismiss listener is registered with a fallback timeout (10 second hard cap; if `hydrate-complete` doesn't fire within 10s, force-dismiss the overlay). Engine tests + manual e2e on a fresh browser profile + iOS fresh-install both required. **Highest-stakes risk in C-1.** |
| **Hydrate overwrites existing local data** — Stage D guard fails to detect non-empty local; user loses their data on first sign-in. | low | **data-loss (HIGH)** | The Stage D probe runs **before** `SyncState.set('hydrating')` and BEFORE any `SyncFirestore.getCollection()` call. The probe must check ALL FOUR stores; missing one is a data-loss bug. Audit test #7 covers each store individually (meds-only-non-empty, history-only-non-empty, presets-only-non-empty, rest_log-only-non-empty all route to Stage D). **Manual sanity:** before merging, the implementer must verify the probe runs against each engine's *count* getter (not its in-memory cache, which might be stale on cold boot). For `History` specifically, `await getSessions().length` is the source of truth (IDB is the canonical store). |
| **Partial hydrate leaves user with broken state** — Wi-Fi drops between meds (complete) and presets (failed); user has meds from cloud + no presets locally. Worse: a subsequent local preset edit writes to a local-only preset list that diverges from cloud. | med | data-correctness | Per-store markers (`tempo_sync_hydrated_<store>`) are written ONLY after each store's `hydrateFromCloud()` resolves successfully. On next boot, missing markers trigger re-pull of just those stores. The `_all` marker is the all-or-nothing signal. **Critically:** if a store mid-failure left memory in a half-replaced state (cleared but not refilled), the post-`_hydrateWriteRaw` `loadAll()` re-reads disk, so memory + disk are always consistent at the store-level boundary. Audit test #4 (partial-failure recovery) is mandatory. |
| **Cloud has corrupt or malformed records** — a record lacks `id`, a record has a non-numeric `updatedAt`, a record's `schemaVersion` is a string. | low | data-correctness | Each engine's `_hydrateWriteRaw` runs defensive payload validation: skip records lacking `id` or `data`; log a single warning batch (not per-record) summarizing how many were skipped. The post-write `loadAll()` runs the standard loader (which itself defensively handles malformed disk records). Audit test #11 covers. |
| **Firestore rules deny read mid-hydrate** — auth token expires between meds (success) and presets (denied). | low | UX disruption | `SyncFirestore.getCollection()` throws normalized `{ kind: 'permission-denied' }`. The catch path in `hydrateFromCloud()` flips `SyncState.set('error')`, emits `hydrate-complete { ok: false, kind: 'permission-denied' }`, tears down the overlay. Per-store markers for already-completed stores ARE set (meds in this scenario), so resume after re-sign-in skips meds and picks up at presets. Status row prompts "Please sign in again." Audit test #13 covers. |
| **F19a future-schema record from cloud written wrong (downgraded)** — `_hydrateWriteRaw` accidentally calls `Schema.stamp()` and rewrites `schemaVersion: 2` → `schemaVersion: 1`, then F19a-fix's read-side refuse-writeback no longer detects it as a future record and the user loses access to fields. | low | data-correctness | Audit-mandated unit test #8: cloud payload includes a `schemaVersion: 2` med record; after hydrate, `localStorage[meds/{id}]` has `schemaVersion: 2` on disk (NOT `1`). Sign-off checklist explicit. Engine-implementer is reminded in the affected-files table: "No `Schema.stamp()` call in `_hydrateWriteRaw`." |
| **Re-entry: boot auto-trigger races a manual settings-drawer button** (latter not shipped in C-1 but defensible against follow-up PRs) | low | data-correctness | `_hydrateInFlight` module-scoped boolean + `_currentHydratePromise`; second call returns first call's promise. Same pattern as B-3's `_pushInFlight` (which already lives in `sync-engine.js`). Audit test #10. |
| **iOS Capacitor WebView's IDB persistence loses state** — `_hydrateWriteRaw` clears IDB store, then the WKWebView restarts mid-pull (e.g. iOS killed the app to reclaim memory). | low | data-correctness on iOS | Per Capacitor docs, IDB persists across app suspends; only `localStorage.clear()` from JS truly wipes it. `_hydrateWriteRaw` clears the `sessions` store within a single `readwrite` transaction that's atomic per IDB spec — either the clear+put loop all commits or none does. **However:** if WKWebView is killed mid-transaction, IDB rolls back the transaction (good) but the per-store hydrate marker was set BEFORE the transaction (bad). **Mitigation contract:** the per-store hydrate marker is set AFTER `_hydrateWriteRaw` resolves, not before. So a mid-flight kill leaves the marker absent → next boot re-pulls history. Audit test #5 covers the marker-write ordering. |
| **GitHub Pages SW cache lags** — existing PWA installs see stale `sync-engine.js` for one cache cycle. | med | web-bytes | `CACHE_NAME` bump from `v70` → `v71-hydrate`. No new ASSETS entries (no new files). Existing installs get hydrate code on next reload after the SW updates. Sign-off checklist enforces. |
| **Boot-time hydrate takes 5-10 seconds on slow networks** — user sees the overlay for "Loading from cloud…" longer than feels right. | med | UX papercut | (a) The overlay's `cloud-hydrate-pulse` animation keeps it from feeling stuck. (b) The overlay's auto-dismiss listener also unmounts on a 10-second hard cap (Risk #1's mitigation doubles for this). After 10s, the user sees the partial state + a status-row error; can manually re-click sign-in to retry. (c) Per-store progress events fire so a future polish PR can show "Loading meds (3/8)…" inside the overlay (audit recommends adding this in C-1 because it's a 5-line change — see Open question #5). |
| **`History.hydrateFromCloud` IDB transaction can fail under quota pressure** — Device B has many sessions to hydrate AND limited disk; `store.put` rejects. | low | data-correctness | The single `readwrite` transaction either all commits or rolls back. On rollback, IDB is left in pre-hydrate state. The catch path treats this as a normal hydrate error (`SyncState.set('error')`, no per-store marker). Status row surfaces "Quota exceeded — please clear browser storage and retry." Audit test #11 covers (mock IDB rejection). |
| **Auth-change handler fires multiple times during boot** — `Platform.auth.init()` may fire `onAuthChange` twice (once for the SDK cold-boot rehydrate, once for the platform shim's seed). | low | data-correctness (re-entry already covers) | The `_hydrateInFlight` re-entry guard handles this case automatically — second fire's `hydrateFromCloud` call returns the first call's promise. Stage D handoff flag check (set on first call) also short-circuits the second call. Documented; no code change beyond the re-entry guard. |

**Risk count: 12** (low: 8, med: 4, high: 0 — but Risk #2 "data
overwrite via missed Stage D guard" carries the highest single-event
impact; reviewers should treat the Stage D guard tests as
non-negotiable). For the return-format header: low 8, med 4, high 0.

---

## Test scope

### New tests required: `tests/sync-hydrate.test.js`

Minimum **14 cases**. All cases stub `window.SyncFirestore`,
`window.SyncAuth`, `window.SyncFlag`, `window.MedsManager`,
`window.History`, `window.Presets`, `window.RecoveryUI` per-case.
Mirrors the mock-based pattern from `sync-uploader.test.js`. Each
test resets `localStorage` markers and `SyncState` in `before()`.

1. **Strict pull order verified.** Stub `SyncFirestore.getCollection`
   with a spy that records call order. Stub all engine
   `hydrateFromCloud` methods to resolve. Call
   `SyncEngine.hydrateFromCloud()`. Assert calls happen in order
   `users/{uid}/rest_log → users/{uid}/meds → users/{uid}/presets
   → users/{uid}/history`.

2. **Per-store markers set after each store completes.**
   Same setup as #1. Stub `getCollection` to return one doc per
   store. After hydrate resolves, assert
   `localStorage.getItem('tempo_sync_hydrated_rest_log') === '1'`,
   same for meds, presets, history. And
   `localStorage.getItem('tempo_sync_hydrated_all') === '1'`.

3. **Writes blocked during hydrate (F13 gate held).** Stub
   `SyncFirestore.getCollection` with a never-resolving promise.
   Stub `SyncState.set` with a spy. Call `hydrateFromCloud()`
   without awaiting; immediately call `MedsManager.saveAll()` on
   a fixture med. Assert `localStorage[meds/{id}]` was NOT
   updated (the gate's `canWrite()` returned false). Cancel the
   never-resolving promise; clean up SyncState.

4. **Missing marker on next init triggers re-pull.** Pre-set
   `localStorage.tempo_sync_hydrated_rest_log = '1'` and
   `localStorage.tempo_sync_hydrated_meds = '1'`, leave the rest
   unset. Call `SyncEngine.hydrateFromCloud()` (simulating boot).
   Assert `SyncFirestore.getCollection` was called ONLY for
   `users/{uid}/presets` and `users/{uid}/history` — NOT for
   rest_log or meds. After resolve, assert all four per-store
   markers set + `_all` marker set.

5. **DeviceId exists before hydrate starts.** Clear all
   localStorage. Stub `History.init` to mint deviceId synchronously
   (mirrors the real init path). Call
   `SyncEngine.hydrateFromCloud()`. Assert
   `localStorage.getItem('tempo_device_id')` is non-null when
   hydrate begins (spy on the first `SyncFirestore.getCollection`
   call site).

6. **F4 — `lastTakenAt` re-derived after meds hydrate.** Stub
   `MedsManager.hydrateFromCloud` to write a med with
   `doseLog: [{ takenAt: T1 }, { takenAt: T3 }, { takenAt: T2 }]`
   (unsorted). Spy on the post-hydrate in-memory med. Assert
   `med.getLastTakenAt() === T3` (the loader sorts ascending and
   re-derives from the tail).

7. **Stage D handoff — non-empty local routes correctly.**
   Sub-cases (one per store):
   - 7a: Pre-populate `MedsManager` with one med (via `add({name: 'x'})`).
     Call `hydrateFromCloud()`. Assert: NO `SyncFirestore.getCollection`
     calls; `localStorage.getItem('tempo_sync_stage_d_handoff') === '1'`;
     `SyncState.get() === 'ready'` (not `'hydrating'`); return is
     `{ ok: false, kind: 'stage-d-handoff', counts: {...} }`.
   - 7b: Same for `History.addSession({...})` pre-populated → handoff.
   - 7c: Same for `Presets.save({...})` pre-populated → handoff.
   - 7d: Same for `RecoveryUI` rest_log pre-populated → handoff.
   - 7e: ALL FOUR pre-populated → handoff with counts reflecting all.
   - 7f: NONE pre-populated → proceeds to full pull (positive control).

8. **Future-schema record from cloud preserved verbatim.** Stub
   `SyncFirestore.getCollection('users/{uid}/meds')` to return one
   doc with `data.schemaVersion: 2` (where
   `Schema.SCHEMA_VERSION === 1`). Hydrate. Assert:
   `localStorage.getItem('meds/{id}')` parses to a record with
   `schemaVersion === 2` (NOT `1`); the in-memory med (via
   `MedsManager.get(id)`) reports `isFromFutureSchema() === true`.

9. **`_hydrateWriteRaw` bypasses the `saveAll` gate.** Set
   `SyncState.set('hydrating')` manually. Call
   `MedsManager.hydrateFromCloud({ docs: [{id, data}], count: 1 })`
   directly (bypass orchestrator). Assert: the med IS written to
   `localStorage.meds/{id}` even though the gate is closed
   (privileged-write contract).

10. **Re-entry guard.** Stub `SyncFirestore.getCollection` to
    return a never-resolving promise. Call
    `SyncEngine.hydrateFromCloud()` (don't await). Call
    `SyncEngine.hydrateFromCloud()` again. Assert the second call
    returns the SAME promise as the first (or the internal
    `getCollection` invocation count stays at 1 for the first
    store, not 2).

11. **Cloud returns malformed record — skip + warn, don't abort.**
    Stub `SyncFirestore.getCollection('users/{uid}/meds')` to
    return `[{ id: 'm1', data: { name: 'good' } }, { /* no id, no data */ }]`.
    Hydrate. Assert: the good record is written; the bad record
    is skipped; the result is `{ ok: true, hydrated: { meds: 1 } }`;
    a single console warning is logged.

12. **No auth → hydrate rejected.** Stub `SyncAuth.getCurrentUser`
    to return null. Call `SyncEngine.hydrateFromCloud()`. Assert
    return is `{ ok: false, kind: 'sign-in-required' }`; no
    `getCollection` calls; `SyncState` unchanged.

13. **`SyncState` transitions on failure.** Stub `getCollection`
    for rest_log to resolve, stub for meds to reject with
    `{ kind: 'permission-denied' }`. Hydrate. Assert: `SyncState`
    transitioned `ready → hydrating → error`;
    `tempo_sync_hydrated_rest_log === '1'` (already completed);
    `tempo_sync_hydrated_meds` is NOT set; `_all` is NOT set;
    return is `{ ok: false, kind: 'permission-denied' }`.

14. **`tempo_sync_hydrated_all === '1'` short-circuits.** Pre-set
    the marker. Call `SyncEngine.hydrateFromCloud()`. Assert: no
    `getCollection` calls; `SyncState` unchanged; return is
    `{ ok: true, kind: 'already-hydrated' }`.

**Optional additional cases the engine-tester can add:**

15. **`SyncFlag` off → hydrate rejected.** Stub `SyncFlag.isEnabled`
    false. Call `hydrateFromCloud()`. Assert reject with
    `{ ok: false, kind: 'sync-not-enabled' }`.

16. **Auth-change subscription auto-triggers hydrate on first sign-in.**
    Stub `SyncAuth.onAuthChange` to capture the handler. Call
    `SyncEngine.init()`. Invoke the captured handler with a fixture
    user. Assert `SyncFirestore.getCollection` was called for the
    first store within one tick.

### Optional per-engine roundtrip tests: `tests/sync-hydrate-engines.test.js`

One case per engine (4 total). Each case:
- Builds a payload with one record (including F19a future-record
  variant for the meds + history cases).
- Calls the engine's `hydrateFromCloud(payload)` directly.
- Re-reads via the engine's standard load path
  (`MedsManager.loadAll()`, `History.getSessions()`,
  `Presets.getAll()`, `RecoveryUI.loadLog()`).
- Asserts the record's contents survived byte-equivalent
  (preserving `schemaVersion`, `deviceId`, all known fields, and
  `_forwardBag` unknown fields).

Recommended; catches `_hydrateWriteRaw` contract violations
(forgotten `Schema.stamp` removal, missed defensive validation,
wrong field copy) at the engine-unit level before the orchestrator
test exercises them indirectly.

### Existing tests at risk

- **`tests/sync-engine.test.js`** (B-1) — likely needs minor
  updates if `_hydrateInFlight` state leaks between tests. Add a
  teardown `_clearHydrateState()` test helper if needed.
- **`tests/sync-uploader.test.js`** (B-3) — likely no changes.
  C-1 doesn't alter `pushSnapshot()`. The `tempo_sync_stage_d_handoff`
  key is now written from two paths (B-3's push + C-1's hydrate);
  B-3's tests that pre-set or check the key are unaffected because
  each test isolates `localStorage`.
- **`tests/sync-auth.test.js`** (B-2) — likely no changes. C-1
  subscribes to `onAuthChange` but doesn't alter the auth surface.
- **`tests/meds.test.js`** — likely no changes. The
  `hydrateFromCloud` method is additive. Audit recommends adding
  ONE new test in `meds.test.js` covering the `_hydrateWriteRaw`
  + `loadAll` roundtrip preserves `_forwardBag` and
  `_fromFutureSchema`.
- **`tests/sync-stamps.test.js`** (A-1) — no changes.

No engine-test file is rewritten or restructured by C-1.

### Test-runner harness considerations

- `tests/index.html` will need `sync-hydrate.test.js` loaded after
  `sync-uploader.test.js`. pr-shipper handles the edit. Existing
  engine-module load order is sufficient (no new modules).
- `SyncFirestore.getCollection` mocks return the documented shape
  `{ docs: [{id, data}], count }` matching the real seam.
- `RecoveryUI.hydrateFromCloud` tests stub `RecoveryUI` directly
  rather than the IDB harness — rest_log is localStorage-backed.
- The `Schema.SCHEMA_VERSION` constant is `1`; future-record test
  cases mint records with `schemaVersion: 2`.

### Manual end-to-end verification (reviewer + Kyle)

These run AFTER engine tests pass. Document in PR description.

**Web (Chrome + Safari) — fresh-profile flow:**

1. Open a **fresh incognito window** (no Tempo data). Visit the
   deployed GitHub Pages URL.
2. Settings drawer → Cloud Sync → toggle ON → Sign in with Google
   (your account, which has cloud data from B-3's prior push).
3. Verify the **boot-time overlay** appears: "Loading from
   cloud…". Status row in settings drawer shows
   `Loading rest_log…` → `Loading meds…` → `Loading presets…` →
   `Loading history…` → `Synced from cloud`.
4. Overlay self-dismisses on `hydrate-complete`. The Wellness ›
   Meds surface now shows all your meds (from cloud). History
   panel shows all your sessions. Quick Presets row shows all
   your presets. Recovery dashboard shows your sleep / nap logs.
5. Dev tools → Application → Local Storage. Verify
   `tempo_sync_hydrated_all === '1'` plus per-store markers.
6. Close the tab. Reopen the incognito URL. Verify NO overlay
   appears (short-circuit working).

**Stage D path — pre-existing local data:**

7. Open a **second fresh incognito window**. Manually
   pre-populate one med via Wellness › Meds before signing in.
8. Toggle Cloud Sync ON → Sign in. Verify NO overlay appears.
   Status row shows "Existing local data — reconcile required (D-1)."
9. Dev tools: `tempo_sync_stage_d_handoff === '1'`; per-store
   hydrate markers absent; `SyncState === 'ready'`. The
   pre-populated med is STILL in the meds list (no overwrite).

**iOS (physical device via Capacitor build, per `iOS-BUILD.md`):**

10. After deploying the web build, run `npm run ios:open`. In
    Xcode, do a clean build (Product → Clean Build Folder) and
    delete the app from the test device. Re-install fresh.
11. Open the app. Sign in via the system Google sheet. Verify the
    overlay appears + status transitions match step 3 + meds /
    history / presets / rest_log populate.
12. Force-quit the app, reopen. Verify NO overlay (short-circuit
    working on Capacitor WKWebView too).

**Failure-mode smoke:**

13. After successful hydrate, dev tools → Application → Local
    Storage. **Clear** `tempo_sync_hydrated_all` and
    `tempo_sync_hydrated_history`. Reload the tab. Verify ONLY
    `SyncFirestore.getCollection('users/{uid}/history')` is
    called (other markers still set). Per-store resume.
14. With dev tools "Offline" simulated, clear ALL hydrate markers
    + reload. Verify status row shows "Sync error: network
    unavailable" and the overlay self-dismisses within 10s
    (hard-cap fallback). Restore network; reload. Verify hydrate
    fires + completes.

---

## Manual setup steps

### Branch setup (engine-implementer's first command)

C-1's prereqs (S0-1, A-1, B-1, F19a-fix, B-2, B-3) are all merged
to `main`. Engine-implementer runs:

```bash
git fetch origin
git checkout main
git pull origin main
git checkout -b feat/sync-stage-c-hydrate
```

PR target is `main`. No stacking — C-1 is cut from a clean main
since B-3 merged.

### Cloud-side prerequisite (verify, don't re-run)

C-1 requires that B-3 has been run at least once with the user's
test account, OR the user has manually populated
`users/{uid}/{meds,history,rest_log,presets}` in the Firestore
Console. **Without cloud data, hydrate succeeds with zero records
hydrated** (no error — just `{ ok: true, hydrated: { meds: 0, ... } }`).
The test path is fine for engine-tests (mocked Firestore), but
manual e2e requires real cloud data.

If you have NOT yet run B-3's "Push to cloud" on the test account:
1. On Device A (or a non-fresh browser profile), sign in.
2. Open Wellness › Meds → add at least one med.
3. Open Settings → Cloud Sync → "Push to cloud." Wait for "Synced ✓."
4. Verify in Firebase Console → Firestore → `users/{uid}/meds/{id}`.

### Fresh-profile testing prerequisite

C-1's defining test is "fresh Device B." To exercise this
locally:
- **Chrome / Safari:** open a fresh incognito window. The
  incognito session has its own localStorage + IDB.
- **iOS Capacitor:** delete the app from the test device, then
  re-install via Xcode. WKWebView's localStorage + IDB live in
  the app sandbox; uninstalling clears them.
- **`localStorage.clear()` + `indexedDB.deleteDatabase('stopwatch_history_db')`**
  in dev tools is the lightest-weight "factory reset" for the
  current tab WITHOUT closing it — but the auth SDK may keep its
  own IDB user cache; you may also need to sign out via the
  settings drawer to fully reset.

### After implementation

- No `npx cap sync ios` needed — C-1 doesn't add Capacitor
  plugins.
- Run `tests/index.html` in a real browser (per CLAUDE.md's test
  command). Confirm pass count matches B-3 baseline + 14 new
  cases (18 if optional `sync-hydrate-engines.test.js` ships).
- Web smoke test: `python3 -m http.server 8765` from repo root.
  Open in a fresh incognito tab. Follow the manual e2e steps
  above.
- iOS smoke test: `npm run ios:open`, fresh install on physical
  iPhone, follow the manual e2e steps.

### Firestore Console cleanup between successive Stage D tests

To re-test the Stage D handoff path, between successive manual
runs the engine-implementer can either:
- Clear `tempo_sync_stage_d_handoff` and `tempo_sync_hydrated_*`
  keys in dev tools → fresh-cloud test path runs.
- Pre-populate local meds/history before signing in →
  Stage-D-handoff path runs.

---

## Out of scope (explicitly NOT in this PR)

- **No steady-state merge loop.** C-1 is one-shot
  cloud → local. Periodic push/pull, per-record CAS via
  `runTransaction`, LWW resolution for individual fields all live
  in **E-1**.
- **No offline buffer.** `Platform.network` is not extended in
  C-1. If the user is offline at boot, the
  `SyncFirestore.getCollection` call throws and the user sees an
  error status. Offline-aware retry buffering lives in E-2.
- **No real-time listeners.** `onSnapshot` lives in E-3.
- **No D-1 imported-bucket migration.** C-1 only sets the
  `tempo_sync_stage_d_handoff` flag. D-1 owns the actual
  `bucket: 'imported'` tagging + UI surface for reconciliation.
- **No D-2 doseLog reconcile.** C-1 doesn't merge meds across
  devices; it replaces local with cloud (Stage D path). D-2
  handles per-doseLog ±15-min dedup.
- **No `meds-arrival` toast (B-4).** Hydrate is intentionally
  silent on per-store progress (one overlay covers it). B-4's
  toast covers ongoing arrivals (E-1 territory), not hydrate.
- **No manual "Pull from cloud" button.** C-1 ships
  auto-on-first-sign-in only. A manual button could be added in
  a polish PR if the auto-trigger feels insufficient (e.g. for
  testing or for a re-hydrate after dev-tools clearing of
  markers).
- **No backup-of-local-before-Stage-D-flag.** D-1's
  reconcile UI will surface a backup prompt before discarding
  imported records. C-1 only sets the flag.
- **No conflict resolution UI.** v2.0 strategy explicitly defers
  this.
- **No engine-state sync.** Per Q4 / strategy doc, engine state
  is local-only. C-1 does NOT hydrate `multi_state`,
  `pomodoro_state`, `flow_state`, `interval_state`, etc.
- **No `Schema.stamp()` on cloud-supplied records.** C-1
  preserves `schemaVersion` verbatim per F19a. Re-stamping is
  explicitly prohibited inside `_hydrateWriteRaw`.

---

## Sign-off checklist (for the implementer)

- [ ] Branch cut from `main` (S0-1 / A-1 / B-1 / F19a-fix / B-2 /
      B-3 all merged). PR target is `main`. See "Manual setup
      steps".
- [ ] Affected files match the table above (14 paths total, 15 if
      optional `tests/sync-hydrate-engines.test.js` ships).
- [ ] `SyncEngine.hydrateFromCloud()` exposes the documented
      public API: returns
      `Promise<{ ok: true, hydrated: {...} } | { ok: false, kind, ... }>`.
      Sentinel `kind` values are: `'sign-in-required'`,
      `'sync-not-enabled'`, `'stage-d-handoff'`,
      `'permission-denied'`, `'already-in-flight'`,
      `'already-hydrated'`, `'network'`, `'unknown'`.
- [ ] `SyncEngine.hydrateFromCloud()` emits `hydrate-progress`
      events with `{ stage, store?, current?, total? }` and a
      final `hydrate-complete` event with
      `{ ok, kind?, error?, hydrated? }`. ui-wirer subscribes for
      status-row + overlay updates.
- [ ] `SyncEngine` has a module-scoped `_hydrateInFlight` boolean
      + `_currentHydratePromise` re-entry guard. Second call
      returns first call's promise.
- [ ] `SyncEngine` auto-subscribes to `SyncAuth.onAuthChange`
      inside `init()` and calls a private `_maybeAutoHydrate(user)`
      helper that checks the four-condition gate
      (`SyncFlag.isEnabled() && user && !hydrated_all && !stage_d_handoff`)
      before invoking `hydrateFromCloud()`.
- [ ] **Stage D non-empty-local guard (NEW INVARIANT) is checked
      BEFORE any `SyncFirestore.getCollection()` call AND BEFORE
      `SyncState.set('hydrating')`.** If ANY of the four stores
      is non-empty, route to handoff (set
      `tempo_sync_stage_d_handoff = '1'`, emit
      `hydrate-complete { ok: false, kind: 'stage-d-handoff' }`,
      return without pulling, without flipping SyncState). Test
      #7 (all sub-cases) enforces.
- [ ] **F13 flip:** `SyncState.set('hydrating')` is called
      BEFORE first per-store `hydrateFromCloud` call;
      `SyncState.set('ready')` on success; `SyncState.set('error')`
      on any caught error. Test #13 enforces.
- [ ] **F19a check:** `_hydrateWriteRaw` writes cloud records
      verbatim; **no `Schema.stamp()` call** inside any engine's
      `_hydrateWriteRaw`. Future-schema records on disk preserve
      `schemaVersion: 2`. Test #8 enforces.
- [ ] **Privileged-write contract:** `_hydrateWriteRaw` writes
      directly to localStorage / IDB (bypasses `saveAll`'s
      `canWrite()` gate). Test #9 enforces.
- [ ] **Per-store markers:** `tempo_sync_hydrated_<store>`
      written ONLY after each store's `hydrateFromCloud` resolves
      successfully. `tempo_sync_hydrated_all` written ONLY after
      every store completes. Tests #2 + #4 enforce.
- [ ] **Short-circuit:** if `tempo_sync_hydrated_all === '1'`,
      `hydrateFromCloud()` returns `{ ok: true, kind: 'already-hydrated' }`
      without pulling. Test #14 enforces.
- [ ] **B-2 auth gate:** `hydrateFromCloud()` rejects with
      `{ ok: false, kind: 'sign-in-required' }` when
      `SyncAuth.getCurrentUser() === null`. Test #12 enforces.
- [ ] **`tempo_sync_enabled` gate:** `hydrateFromCloud()` rejects
      with `{ ok: false, kind: 'sync-not-enabled' }` when
      `SyncFlag.isEnabled() === false`. Test #15 (optional)
      enforces.
- [ ] **Re-entry guard:** double-call to `hydrateFromCloud()`
      returns the SAME promise. Test #10 enforces.
- [ ] **Defensive payload validation:** malformed records (no
      `id`, no `data`, non-object `data`) are skipped with a
      single batch warning, NOT crashing the hydrate. Test #11
      enforces.
- [ ] **Boot-time overlay:** `mountHydrateOverlay()` in `app.js`
      gates on the four-condition check before mounting. Self-dismisses
      on `hydrate-complete`. Hard-cap timeout (10s) force-dismisses
      if `hydrate-complete` never fires.
- [ ] **Status row extension:** B-3's
      `.tempo-cloud-sync-status[data-progress]` enum gains five
      new values: `hydrate-rest_log`, `hydrate-meds`,
      `hydrate-presets`, `hydrate-history`, `hydrate-done`. CSS
      reuses existing color tokens.
- [ ] `js/tempo-nav.js`'s `wireCloudSync` extension subscribes
      to `hydrate-progress` + `hydrate-complete` events; updates
      status row via `setProgress(...)` / `setStatus(...)`.
- [ ] No re-implementation of `escapeHtml` /
      `Utils.formatMs` / `Platform.*` — engine writes go through
      the privileged `_hydrateWriteRaw` path; `Platform.auth` is
      the only Platform surface read.
- [ ] All writes to synced stores stamp `deviceId` + `updatedAt`
      + `schemaVersion` via `js/schema.js` — **N/A for C-1**.
      Hydrate writes cloud-supplied records verbatim, preserving
      Device A's stamps. C-1 explicitly does NOT re-stamp during
      hydrate (would lose origin attribution).
- [ ] Settings drawer layout verified at 320px / 375px / 414px /
      768px widths — overlay covers viewport on all sizes;
      status row text fits on the SE.
- [ ] `sw.js` `CACHE_NAME` bumped to
      `'stopwatch-v71-sync-hydrate'`. No new ASSETS entries.
- [ ] All engine tests pass via `tests/index.html` (manual: serve
      repo root via `python3 -m http.server 8765` and open
      `http://localhost:8765/tests/index.html`). Pass count
      expected to be B-3 baseline + 14 new cases (18 if optional
      tests ship).
- [ ] Manual end-to-end smoke on web (Chrome + Safari, fresh
      incognito): sign in, verify overlay → hydrate → cloud
      data populates.
- [ ] Manual end-to-end smoke on iPhone Capacitor build (fresh
      install): sign in, verify overlay → hydrate → cloud data
      populates.
- [ ] Manual Stage D smoke: fresh incognito + pre-populate one
      med, sign in, verify Stage D handoff path (no overlay, no
      overwrite).
- [ ] Manual partial-resume smoke: after successful hydrate,
      clear `tempo_sync_hydrated_history` only + reload — verify
      only history re-pulls.
- [ ] No new Firestore SDK imports outside
      `js/sync-firestore.js` (B-3 already enforced this).
      Self-check via `grep -rE "import.*firestore" js/`.
- [ ] No call site outside `js/sync-firestore.js` references the
      Firestore SDK directly.

---

## Rollback

Revert the PR. The per-engine `hydrateFromCloud` methods become
unreferenced. `SyncEngine.hydrateFromCloud()`, the auth-change
subscription, and the boot overlay all disappear. Reverting
removes:

- The boot-time overlay (UI disappears).
- The settings drawer status row's `hydrate-*` enum values
  (CSS attribute selectors with no matching values are inert).
- The `_hydrateInFlight` re-entry guard + the auth-change
  subscription inside `SyncEngine.init()`.
- The `tempo_sync_hydrated_*` localStorage keys become orphaned
  but harmless — only C-1's logic reads them. A user can clear
  them manually via dev tools.

**Cloud-side cleanup on revert:** none. Hydrate only reads from
cloud. Reverting leaves the cloud tree untouched.

**Local-side cleanup on revert:** if hydrate ran successfully
before the revert, the user's local meds / history / presets /
rest_log already reflect cloud data. Reverting doesn't undo
those writes — local data persists. To fully revert to
pre-hydrate local state, the user must restore from a backup
file (the B-3 backup taken before push, or a manual
Settings → Export full backup before this device was set up).

If `sw.js` cache bump shipped but the JS changes are reverted,
the old cache version stays in use until the next deploy bumps
`CACHE_NAME` again — no functional regression, just a one-cycle
stale-cache state on existing PWA installs.

---

## Open questions for the user

1. **Privileged-write path design — internal flag, per-engine
   `_hydrateWriteRaw`, or transient state flip?** The audit
   recommends **per-engine `_hydrateWriteRaw`** (Option b in
   Headline #1) — each engine module gets a private write helper
   that bypasses `saveAll`'s gate via direct
   localStorage/IDB writes. Cleaner than an internal flag on
   `SyncState` (Option a) because it keeps gate logic stateless;
   safer than transient state flips (Option c) because there's
   no race window. Calling out because this is the
   architectural keystone of C-1 — wrong choice here is
   expensive to undo. Engine-implementer should follow the audit
   recommendation unless they see a concrete reason not to.

2. **Stage D non-empty-local guard — strict empty check, or
   thresholded?** Audit recommends **strict empty check** —
   ANY single local record in ANY store routes to Stage D.
   Alternative: a threshold (e.g. "if local has <3 records,
   silently merge cloud over"). The threshold version is
   tempting for the "user manually added a test med, then
   signed in for real" case — but it's a slippery slope (what's
   the threshold? does it differ per store? does the user notice
   their test med got overwritten?). **Audit position:** strict
   is safer; D-1 will own the reconcile UX for users who do hit
   the handoff.

3. **Boot overlay UX — blocking modal, or background-with-banner?**
   Audit recommends **blocking modal**. Background-with-banner
   forces every render loop + engine getter to handle "state
   replaced mid-tick" gracefully, which is a much wider blast
   radius than a 2-5 second overlay. Calling out because the
   blocking modal is a noticeable first-launch UX papercut on
   slow networks — but the alternative is a much harder
   correctness problem. A polish PR can iterate to background
   later.

4. **Per-store marker storage — separate keys, or single JSON
   object?** Audit recommends **separate keys**
   (`tempo_sync_hydrated_<store>` x 4 + `tempo_sync_hydrated_all`)
   for simpler primitives, no parse cost, easier debugging in
   dev tools. The single-object alternative
   (`tempo_sync_hydrated = '{"meds":"ts","history":"ts","all":"ts"}'`)
   is half as many keys but adds parse logic and migration cost
   if the shape ever changes. Calling out because this is a
   storage-shape decision that's hard to migrate later.

5. **Status row UX during 4-store hydrate — per-store progress
   inside the overlay too, or only in the settings drawer status
   row?** The overlay currently shows a single "Loading from
   cloud…" label. The settings drawer status row shows
   per-store progress via the `hydrate-progress` events.
   **Audit recommendation:** also surface per-store progress
   inside the overlay (one extra `<div class="cloud-hydrate-detail">`
   below the main label, updated by the same
   `SyncEngine.on('hydrate-progress', …)` subscription
   `app.js` already needs for unmount). 5 lines of JS, gives the
   user a clearer "this is making progress" signal. Calling out
   because it's a small scope addition over the bare minimum.

6. **F19a future-record handling — abort, skip, or write
   verbatim?** Audit recommends **write verbatim** — preserves
   the cloud's stamp on disk; F19a-fix's read-side
   refuse-writeback then keeps them read-only locally until
   Device B upgrades. The alternatives (abort entire hydrate /
   skip future records silently) both have worse failure modes
   than verbatim-preserve. Calling out because this is the
   inverse of B-3's open question on push (B-3 recommended
   upload-everything-else and skip future records in the cloud
   payload). The directions are different because cloud is
   the source of truth on hydrate, and we want to preserve it.

7. **Re-hydrate semantics — one-shot, or re-pull on every
   sign-in?** Audit recommends **one-shot**. Once
   `tempo_sync_hydrated_all === '1'`, no more hydrates. E-1
   ships steady-state ongoing sync. Calling out because some
   users may expect "Sign out + sign back in" to refresh from
   cloud — they would have to clear localStorage manually for
   that. Acceptable for C-1 because E-1 will provide proper
   sync; calling out so it's a known limitation.

8. **Manual "Pull from cloud" button — ship now, or defer?**
   Audit recommends **defer**. C-1 is auto-on-first-sign-in.
   A manual button is useful for testing and re-hydrate after
   dev-tools clearing, but adds UI surface and a re-entry guard
   exercise. Polish PR or E-1 can add it. Calling out because
   some implementers may want it for their own testing.

---

## Next step

Stop here. Push this audit to the branch
`feat/sync-stage-c-hydrate` (cut from `main` per "Manual setup
steps") and dispatch the engine-implementer for the code commit.
Engine-implementer reads this audit + PLAN.md §C-1 + the
strategy doc's F9/F13/F19a invariants + B-3's audit (the
push-pipeline mirror) + the five engine sources (`js/sync-engine.js`,
`js/meds.js`, `js/history.js`, `js/presets.js`, `js/recovery-ui.js`)
and writes the seven code files (sync-engine.js extension,
per-engine `hydrateFromCloud` methods x 4, app.js overlay mount,
`sync-hydrate.test.js`, plus the ui-wirer-owned settings drawer
additions in `index.html` / `styles.css` / `tempo-nav.js`). No
scope additions unless audit review flags one.
