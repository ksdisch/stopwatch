# B-3 · Stage B uploader — Device A pushes its first full snapshot to Firestore

**PR:** `feat/sync-stage-b-uploader` → `main`
**Stacked on:** `main` (B-1 #58, F19a-fix #59, and B-2 #60 are all merged).
B-3's branch is cut directly from `main`.
**Scope:** Wire the first real cloud write. `SyncEngine.pushSnapshot()`
runs the mandatory-backup → read-cloud-first → upload-snapshot
pipeline. New `js/sync-firestore.js` is the single Firestore seam
(`getDoc` / `setDoc` / `getCollection` / `runTransaction`); new
`js/backup.js` writes a full local backup file before any cloud byte
moves. The settings drawer gains a "Push to cloud" button + a
status row that color-codes `SyncState`. iOS uses the
`@capacitor-firebase/firestore` plugin; web lazy-imports
`firebase/firestore` from CDN, mirroring B-2's `Platform.auth` pattern.
**Status:** Audit-only commit. Code commit follows after human review.

B-3 is the **first PR that performs real cloud writes** and the **first
observable cross-device milestone** ("Device A pushes to cloud
successfully"). A bug here can corrupt data on disk (mid-snapshot
abort) or in the cloud (partial upload). This audit fixes blast radius
*before* implementation so review focuses on the right surfaces.

---

## Goal

Land `SyncEngine.pushSnapshot()` (cloud upload orchestrator),
`js/backup.js` (F12 mandatory local backup), `js/sync-firestore.js`
(Firestore SDK seam — web `firebase/firestore` + native
`@capacitor-firebase/firestore`), and the settings-drawer "Push to
cloud" button + status row. The push pipeline enforces F12 (backup
first), F9 (read-cloud-first guard — abort to Stage D handoff if cloud
is non-empty), F13 (flip `tempo_sync_state` to `'hydrating'` during
the upload window), and F19a (preserve future-schema records on disk,
skip them in the cloud payload). The push is **manual** (button
click) — auto-trigger ships in E-1.

---

## Orchestrator note — ui-wirer Phase 4 FIRES

**Yes.** B-3 ships visible DOM in the settings drawer Cloud Sync
section (the "Push to cloud" button + progress / final-status display)
plus CSS to color-code the progress states. Affected-files table
includes `index.html` (new button + progress row), `css/styles.css`
(extends B-2's `.tempo-cloud-sync-status` block with progress
states), and `js/tempo-nav.js` (button click handler + status
subscription). The iOS `Info.plist` is **not** touched by B-3 — the
Firebase iOS SDK reuses the auth-shipped `CFBundleURLTypes` and
needs no additional URL types for Firestore.

Workflow: audit → engine-implementer → engine-tester → **ui-wirer
Phase 4 (Push-to-cloud button + progress/status DOM + CSS state
colors + tempo-nav handler)** → pr-shipper.

---

## Headline findings

1. **F12 mandatory backup is the first step — and it must complete
   before any Firestore call.** `Backup.exportLocal()` reuses the
   existing `Export.buildBackupData()` helper (already covers every
   localStorage key the user cares about plus the full IDB sessions
   collection) and produces a single JSON file. The file is offered
   via the Web Share API on supporting browsers, and as a `<a download>`
   link on the rest. If the user **cancels** the share sheet or
   **declines** the download (rare), the upload aborts with toast
   "Local backup is required before first sync — please save the
   backup file." No Firestore byte moves until the user confirms the
   download happened. Audit calls out the UX detail because
   "did the user actually save the file" is unknowable in JS — the
   contract is "we wrote it; from here the user is responsible." See
   Risk #1.
2. **F9 read-cloud-first guard reads the entire user tree, not a
   probe.** `pullCloudSnapshot()` calls `getCollection('users/{uid}/meds')`
   + `getCollection('users/{uid}/history')` + `getCollection('users/{uid}/rest_log')`
   + `getCollection('users/{uid}/presets')` and returns
   `{ isEmpty: bool, counts: { meds, history, rest_log, presets } }`.
   If any collection returns `count > 0`, the upload aborts with a
   sentinel return value `{ kind: 'stage-d-handoff', counts: {...} }`.
   `pushSnapshot()` translates this into a UI status row "Existing
   cloud data detected — Stage D handoff will ship in a follow-up
   PR." The handoff status itself is written to a NEW localStorage
   key `tempo_sync_stage_d_handoff = '1'` so a future D-1 PR can
   detect "this device already saw cloud data on this account" and
   re-prompt for reconciliation. **B-3 does NOT modify `SyncState`
   on the handoff path** — the gate stays at `'ready'`, local writes
   continue, the user simply can't push to a non-empty cloud yet.
3. **The upload writes per-record (not per-collection) and in
   dependency order.** Order: `rest_log` → `meds` → `presets` →
   `history`. Within each collection, individual records are written
   via `setDoc(path, record)` in a loop. Per-record writes are NOT
   wrapped in a `runTransaction` (Firestore's batched writes have a
   500-write limit; the cap from F14 alone gives a meds doseLog
   1000-entry ceiling which can blow past 500). Loop with per-record
   `await` keeps order deterministic and lets us surface "Uploading
   <store>: N/M" progress in the status row. `runTransaction`
   semantics enter the picture in E-1 (per-record CAS on
   schemaVersion); B-3 is a fresh-cloud-empty upload so CAS is
   moot (no existing record to compare against).
4. **`SyncState = 'hydrating'` is set just before the first
   `setDoc` call and cleared after the last one (success path) or
   on any caught error (error path).** This gates every engine
   module's `saveAll()` via the existing F13 check. **Two
   never-gated engine modules surface as Medium-risk:**
   `js/recovery-ui.js` `saveLog()` (writes
   `wellness_rest_log`) and `js/presets.js` (writes `quick_presets`).
   Both call `localStorage.setItem` directly without consulting
   `SyncState.canWrite()`. Today this is invisible because nothing
   ever flips the gate to `'hydrating'`; B-3 is the **first PR that
   actually flips it**, so the gap becomes real. **Audit
   recommendation:** add the standard `SyncState.canWrite()` gate to
   `RecoveryUI.saveLog()` and `Presets.save()` / `Presets.update()`
   / `Presets.remove()` as part of B-3. See "Affected files" + Risk
   #4.
5. **F19a refuse-writeback skips future-schema records from the
   cloud payload.** During snapshot construction, any inner record
   with `Schema.isFutureRecord(rec) === true` is **excluded**
   from the upload entirely (NOT downgraded). The user gets a toast
   "1 future-schema record preserved locally; please update Tempo on
   your other device to push it." The on-disk record is untouched
   per the F19a contract (already enforced by `meds.js saveAll()`
   line 414 and `history.js` writeback paths). **Open design
   question deferred to engine-implementer (per "Open questions
   for the user"):** should B-3 abort the entire upload when a
   future-record is detected, or upload everything else and surface
   the skipped count? Audit's recommendation: upload-everything-
   else (the typical case is one or two records minted by a newer
   client on another device — aborting the whole sync would make
   the user permanently stuck until they update).
6. **`js/sync-firestore.js` is the only file that imports
   Firestore SDK symbols.** Mirrors `Platform.auth`'s lazy-load
   pattern. Web branch lazy-imports
   `https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js`
   on first call; native branch reads
   `window.Capacitor.Plugins.FirebaseFirestore`. Both branches
   normalize the SDK error shapes (`firebase/firestore`'s error
   `code` strings like `'permission-denied'` vs the plugin's
   numeric codes) into a project-internal `{ kind, message,
   isRetryable }` envelope. This is the seam that lets B-3's
   engine code stay platform-agnostic. **No call site outside
   `js/sync-firestore.js` references the Firestore SDK.**
7. **Concurrent click on "Push to cloud" must be guarded.**
   Without a re-entry guard, double-tapping the button fires two
   `pushSnapshot()` calls; the second one starts a backup, then
   races the first one's `setDoc` loop. Mitigation: a
   module-scoped `_pushInFlight` boolean in `SyncEngine`; second
   call returns the first call's promise instead of starting a
   new one. The UI also disables the button while in-flight (see
   ui-wirer's job in `tempo-nav.js`).
8. **The status row uses three semantic states beyond B-2's
   ready/hydrating/error.** B-2 shipped the `data-state="ready" |
   "hydrating" | "error"` enum on `.tempo-cloud-sync-status`. B-3
   extends this with a separate `data-progress` attribute for the
   "what step are we on" surface: `data-progress="backup" |
   "checking-cloud" | "uploading-rest_log" | "uploading-meds" |
   "uploading-presets" | "uploading-history" | "done" |
   "stage-d-handoff"`. CSS reuses existing color tokens; no new
   tokens.
9. **B-3 does NOT consume the SyncEngine `auth-change` event.**
   The "Push to cloud" button is gated behind
   `SyncFlag.isEnabled() && SyncAuth.getCurrentUser() !== null`;
   the gate is re-evaluated on every drawer-open render
   (`renderCloudSyncUI()` from B-2). No subscription needed —
   B-2 already wires the auth listener to call
   `renderCloudSyncUI()` on every transition. B-3's
   `renderCloudSyncUI()` extension just adds the
   `cloud-sync-push-btn` visibility check.
10. **`Platform.network` is NOT extended in B-3.** E-2's offline
    buffer needs `Platform.network.isOnline()` and
    `.onChange(...)`. B-3's failure mode for "no network" is the
    Firestore SDK's own thrown error (which `js/sync-firestore.js`
    normalizes to `{ kind: 'network', isRetryable: true }`). The
    user retries by clicking the button again. Deferring the
    `Platform.network` namespace to E-2 keeps B-3 scoped to the
    upload pipeline.

---

## Affected files

| Path | Change type | Notes |
|------|-------------|-------|
| `js/sync-engine.js` | **modify** | Implement `pushSnapshot()` orchestrator. Adds (a) `_pushInFlight` boolean re-entry guard; (b) `pullCloudSnapshot()` helper that calls `SyncFirestore.getCollection()` per store and returns `{ isEmpty, counts }`; (c) the orchestrator function that wires Backup → cloud probe → snapshot → per-record upload → state transitions. Emits new events `push-progress` (payload: `{ stage, store?, current?, total? }`) and `push-complete` (payload: `{ ok, stage?, error? }`). Also adds `getStageDHandoff()` / `setStageDHandoff()` helpers reading/writing the new `tempo_sync_stage_d_handoff` localStorage key (D-1 will consume this). |
| `js/sync-firestore.js` | **add** | New module — single Firestore SDK seam. Public API: `SyncFirestore.getDoc(path)` → Promise<doc \| null>; `SyncFirestore.setDoc(path, data)` → Promise<void>; `SyncFirestore.getCollection(path)` → Promise<{ docs: [{id, data}], count }>; `SyncFirestore.runTransaction(fn)` → Promise<any> (stub for E-1 — throws in B-3 to make the seam exist); `SyncFirestore.setBatch(writes)` → Promise<void> (B-3 does NOT use this — per-record loop instead — but defined for future PRs). Web branch lazy-imports `firebase/firestore` from gstatic CDN and reuses the FirebaseApp instance initialized by `Platform.auth` (so the SDK isn't re-initialized). Native branch routes to `window.Capacitor.Plugins.FirebaseFirestore`. Error normalization layer translates `firebase/firestore` error codes (`'permission-denied'`, `'unavailable'`, etc.) and `@capacitor-firebase/firestore` numeric/string codes into `{ kind: 'permission-denied' \| 'network' \| 'not-found' \| 'unknown', message, isRetryable, originalError }`. **No DOM access. Pure SDK wrapper.** |
| `js/backup.js` | **add** | New module. Public API: `Backup.exportLocal()` → Promise<{ ok, bytesWritten?, error? }>; `Backup.importLocal(jsonString)` → Promise<{ sessionsImported, settingsRestored }>. `exportLocal()` calls `Export.buildBackupData()` (existing in `js/export.js`) for the payload — DO NOT re-implement. Wraps in `Blob` + Web Share API + `<a download>` fallback. **Awaits user confirmation that the file was saved.** On web, the share sheet promise resolves when the user dismisses, but doesn't confirm save — best-effort: we treat resolution-without-throw as success. On iOS Capacitor, route via Capacitor `Filesystem` plugin if available (writes to app sandbox + uses share sheet) else fall back to `<a download>`. `importLocal` is the complementary D-1 hook (B-3 ships it dormant; not called from B-3 paths). |
| `js/persistence.js` | **modify** | One-line addition to `SyncState`: expose `SyncState.isHydrating()` convenience helper (`return get() === 'hydrating'`). Mirrors C-1's deferred plan; lands in B-3 because the UI needs it for the button-disabled state. Existing `canWrite()` unchanged. |
| `js/recovery-ui.js` | **modify** | **F13 gap fix.** `saveLog()` currently writes `wellness_rest_log` to localStorage with NO `SyncState.canWrite()` gate (verified by `grep` — zero hits). Add the standard gate: `if (typeof SyncState !== 'undefined' && !SyncState.canWrite()) return;` at the top of `saveLog()`. Without this, mid-upload writes from the recovery UI (e.g. a nap timer completing mid-push) leak into local state and race the snapshot. The `snapshotForSync()` adapter is read-only and unaffected. |
| `js/presets.js` | **modify** | **F13 gap fix.** Three write sites (`save`, `update`, `remove`) call `localStorage.setItem('quick_presets', ...)` without a `SyncState.canWrite()` gate. Add the gate at the top of each — same pattern as `meds.js saveAll()` line 409. Without this, preset edits during upload race the snapshot. (The seedDefaults `localStorage.setItem(SEEDED_KEY, '1')` on line 256 is local-only metadata — does NOT need the gate.) |
| `js/sync-engine.js` script-tag load order (re-verify) | **read-only** | No file modification; documenting that the existing order (`sync-firebase-config.js` → `sync-flag.js` → `sync-engine.js` → `sync-auth.js`) places `sync-engine.js` BEFORE `sync-auth.js`, and `sync-firestore.js` must load BEFORE `sync-engine.js` (since `pushSnapshot()` calls `SyncFirestore.*`). Recommended placement: `sync-firebase-config.js` → `sync-flag.js` → `sync-firestore.js` → `sync-engine.js` → `sync-auth.js` (sync-firestore between flag and engine; engine still loads before auth since auth depends on engine's emit for `auth-change`). `js/backup.js` loads anywhere after `js/export.js` (it depends on `Export.buildBackupData()`). |
| `index.html` | **modify** (ui-wirer) | Three edits: (1) add `<button id="cloud-sync-push-btn" class="tempo-cloud-sync-primary" hidden>Push to cloud</button>` inside the existing `.tempo-cloud-sync-section` block (between the sign-in/identity row and the existing `#cloud-sync-status` row, around line 110–115). (2) Add `<script src="js/sync-firestore.js"></script>` between `sync-flag.js` (line 863) and `sync-engine.js` (line 864 post-B-1). (3) Add `<script src="js/backup.js"></script>` after `js/export.js` (around line 873). |
| `css/styles.css` | **modify** (ui-wirer) | Extend B-2's `.tempo-cloud-sync-status` block (~25 lines added). New rules: `.tempo-cloud-sync-status[data-progress]` shows a small spinner + step label; `[data-progress="done"]` shows a green check; `[data-progress="stage-d-handoff"]` shows an info color (use `var(--accent-blue)`); `.tempo-cloud-sync-primary:disabled` styles for the button-in-flight state. No new color tokens. |
| `js/tempo-nav.js` | **modify** (ui-wirer) | Extend `wireCloudSync` (around line 309): add (a) a `pushBtn` reference; (b) a `renderPushBtn()` helper that toggles visibility based on `SyncFlag.isEnabled() && SyncAuth.getCurrentUser() !== null && !_pushInFlightLocal`; (c) `pushBtn.addEventListener('click', async () => { ... })` that calls `SyncEngine.pushSnapshot()` and translates the returned events into status-row updates via the existing `setStatus()` helper plus the new `setProgress(stage)` helper that writes the `data-progress` attribute; (d) subscribe to `SyncEngine.on('push-progress', ...)` and `SyncEngine.on('push-complete', ...)` for live progress updates. Call `renderPushBtn()` from inside `renderCloudSyncUI()` so it stays in sync with auth state. |
| `tests/sync-uploader.test.js` | **add** | New test file. ~10 cases (see "Test scope"). Mocks `window.SyncFirestore`, `window.Backup`, `window.SyncAuth`, `window.SyncFlag` per-case. Mirrors the mock-based pattern from `sync-auth.test.js`. |
| `tests/sync-firestore.test.js` | **add** (optional) | If engine-implementer splits the error-normalization layer into a testable surface, ship a 3-case test for the error mapping. Audit recommends this as optional — the SyncFirestore module is thin enough that uploader tests can exercise it indirectly. |
| `tests/backup.test.js` | **add** (optional) | If engine-implementer wants to roundtrip-test `Backup.exportLocal` → `Backup.importLocal` standalone (separate from the uploader path), ship a 1-case test. Recommended as optional; the roundtrip test can also live as a case in `sync-uploader.test.js`. |
| `tests/index.html` | **modify** (pr-shipper) | Add `<script src="../js/sync-firestore.js"></script>` and `<script src="../js/backup.js"></script>` to the engine modules block (after `sync-auth.js`). Add `<script src="sync-uploader.test.js"></script>` to the test suites block (after `sync-auth.test.js`). If the optional backup/firestore tests ship, add those too. |
| `sw.js` | **modify** (pr-shipper) | Append `'./js/sync-firestore.js'` and `'./js/backup.js'` to the `ASSETS` array. **Bump `CACHE_NAME`** from `'stopwatch-v68-sync-auth'` → `'stopwatch-v69-sync-uploader'`. |

**Total: 13 files** (4 modify under code-path, 2 add under code-path, 1 add under tests, 1 modify under tests, plus 4 ui-wirer / pr-shipper-owned: `index.html` DOM + scripts, `css/styles.css`, `js/tempo-nav.js`, `sw.js`. The two optional test files raise the maximum to 15.)

---

## Sync invariants touched

Each row records the F# status for B-3 specifically. "Pass-through" =
B-3 reads but does not mutate the invariant. "New flip" = B-3 is the
first PR that exercises a previously-dormant invariant.

| F# | Description | Status in B-3 |
|----|-------------|--------------|
| F2 | Session IDs `${deviceId}-${ts}-${counter}` + `legacyId` | **Pass-through.** Uploader reads sessions verbatim via `History.snapshotForSync()` (B-1's adapter). IDs are already F2-shaped. Audit test asserts: cloud receives sessions with the deviceId-prefixed ID shape unchanged. |
| F4 | Re-derive `lastTakenAt` after merge | **N/A — write-only path.** B-3 uploads; no merge happens. F4's `recomputeLastTakenAt` is invoked in D-2's merge path. B-3 reads `lastTakenAt` from each med's existing in-memory state via `MedsManager.snapshotForSync()` and ships it as-is. |
| F6 | `phaseLog` `(deviceId, phaseStartedAt)` per-entry stamping | **Pass-through.** Already shipped in A-1. Inner `phaseLog` entries inside `payload.sessions` carry both stamps when uploaded. |
| F7 | `loadState` recoveries never persist back | **Pass-through.** B-3 doesn't touch any `loadState` path. A-1's audits verified that recovery branches never call `Persistence.save()`. |
| F9 | **Stage B0 read-cloud-first guard** | **NEW FLIP — introduced here.** `pullCloudSnapshot()` is the implementation. Reads `users/{uid}/{meds,history,rest_log,presets}` collections; if ANY returns a non-zero count, the upload aborts to Stage D handoff. **Audit test cases #1 (cloud-empty) and #2 (cloud-non-empty) cover both branches.** Without F9, the second Device A enabling sync would silently overwrite cloud-canonical data from Device B. |
| F10 | `deviceId` + `updatedAt` at write sites | **Pass-through on inner records.** Each inner record was already stamped at its local write site (A-1 + F10 prerequisite work). The cloud payload preserves these stamps verbatim. |
| F12 | **Mandatory local backup before mutation** | **NEW FLIP — introduced here.** `Backup.exportLocal()` is the implementation. Audit test case #3 asserts backup is called BEFORE any `setDoc`. If `exportLocal()` rejects, the upload aborts with no cloud byte moved (asserted by test case #3.b). |
| F13 | `tempo_sync_state` write gate | **NEW FLIP — first PR that actually flips the gate.** Sequence: enter `pushSnapshot()` with gate at `'ready'` → after backup + cloud-empty check, `SyncState.set('hydrating')` → per-store upload loop → `SyncState.set('ready')` on success OR `SyncState.set('error')` on any caught error. **Two engine modules surface as F13 gaps and are fixed in this PR** — see Affected-files rows for `js/recovery-ui.js` + `js/presets.js`. Audit test case #4 asserts state transitions. |
| F14 | `doseLog` cap @ 1000 | **Pass-through.** Existing `MedsManager.logDose()` caps at 1000 entries. B-3 uploads `m.getState()` which respects the cap. |
| F15 | Toast on ≥2-entry remote `doseLog` arrival | **N/A.** F15 is the merge-side toast. B-3 uploads only — no merge. Lives in B-4 scaffold and lights up in E-1. |
| F16 | ±15-min clock-skew clamp on non-local entries | **N/A.** Merge-side rule; B-3 uploads only. Lives in D-2. |
| F17 | Stage D imported bucket | **Touched via stub.** B-3's Stage D handoff path sets the new `tempo_sync_stage_d_handoff = '1'` localStorage flag. D-1 ships the actual `bucket: 'imported'` migration. B-3's flag is just the signal "this device has unmerged local data AND a populated cloud; D-1 needs to reconcile." |
| F19a | `schemaVersion` stamping + refuse-writeback | **First production use of refuse-writeback on the WRITE path.** The F19a contract is "future records preserved on disk." B-3 extends to "future records preserved on disk AND skipped in the cloud payload." Implementation: snapshot loop in `pushSnapshot()` filters `payload.meds` / `payload.history.sessions` / etc. with `Schema.isFutureRecord(rec) === false` before iterating. Skipped records are counted and surfaced in the post-push toast. Audit test case #5 covers this. **Audit recommendation deferred to engine-implementer (Open question #1):** abort whole upload vs upload-everything-else when future records are present. Recommendation: upload-everything-else. |
| F19b | `__forward` passthrough (top-level unknowns) | **Pass-through.** Each record's `_forwardBag` was already merged into the wire format at its local write site. The snapshot reads the wire format verbatim, so unknown fields roundtrip cleanly into Firestore. |
| F20 | Absent vs present-but-unknown enum split | **Pass-through.** Snapshot reads existing field values verbatim. |
| F21 | `alarmFired` per-device, never synced | **Holds structurally.** None of the four synced stores carry `alarmFired`. B-1's structural test (`tests/sync-engine.test.js`) asserts this; B-3's uploader test #5 re-asserts it on the `getSnapshot()` output that gets uploaded. |
| **B-2 new** | Auth state gates cloud writes | **Honored.** `pushSnapshot()` first call inside the function: `if (!SyncAuth.getCurrentUser()) throw new Error('SIGN_IN_REQUIRED');` before any other work. Audit test case #7 covers. |

**Summary:** B-3 is the first PR that **mutates** F9, F12, and F13.
F17 gets a stub flag for D-1 to consume. F19a's contract is extended
to the write path (skip future records in cloud payload). The B-2
auth-gate invariant is honored on every push. Everything else is
pass-through.

---

## Risks

| Risk | Likelihood | Blast radius | Mitigation |
|------|------------|--------------|------------|
| **Local backup write fails or user cancels share sheet** — `Blob.size` exceeds browser quota (large IDB sessions), Web Share API throws on iOS Safari, or `<a download>` is blocked by a content blocker. | med | data-correctness (push proceeds without a safety net) | `Backup.exportLocal()` returns `{ ok: false, error }` on failure. `pushSnapshot()` checks `ok` before proceeding; aborts with toast "Local backup failed — please export manually via Settings → History → Export before retrying." No cloud byte moves. The button stays clickable for retry. Test case #3.b covers. |
| **Network failure mid-upload (Wi-Fi drops between collection N and N+1)** — `setDoc` rejects with `'unavailable'`. State stops at partial-cloud. | med | data-correctness (cloud has rest_log + meds but not presets + history; next retry hits non-empty cloud and routes to Stage D handoff INCORRECTLY because the user is retrying THE SAME upload, not bringing in a second device) | This is the **highest-stakes failure mode** in B-3. Mitigation: on caught upload error, set a NEW localStorage marker `tempo_sync_partial_upload_uid = '{currentUserUid}'` recording "this UID's cloud is mid-upload, not Stage D territory." On retry, `pullCloudSnapshot()` checks the marker FIRST: if set AND matches the current user's UID, treat cloud as empty (skip Stage D handoff, resume upload from where it left off — or simpler, restart the upload from the start). Clear the marker on successful completion. Audit test case #8 covers. **Open question for the user (#2):** is "always restart from the start on retry" acceptable, or should we resume from the failed store? Recommendation: restart from the start — the cloud is idempotent per `setDoc(path, record)` semantics (same record id → overwrite), so re-uploading already-written records is safe. |
| **Concurrent click on "Push to cloud" (double-fire)** — user taps twice quickly; two `pushSnapshot()` invocations race. | low | data-correctness (two backups, two cloud probes, doubled cloud writes — but per-record `setDoc` is idempotent so end state matches single-fire; cosmetic chaos in the status row) | Module-scoped `_pushInFlight` boolean in `SyncEngine`. Second call returns the first call's promise. UI side: button disabled while in-flight (ui-wirer adds the `aria-disabled` + `disabled` attribute). Audit test case #9 covers. |
| **`recovery-ui.js` or `presets.js` writes during the upload window** — both modules currently lack the `SyncState.canWrite()` gate (verified — see Headline #4). A nap timer completing or a preset save mid-upload writes local-only data that's NOT in the uploaded snapshot. | med | data-correctness (local diverges from cloud by the mid-upload write; next push or merge converges, but the user sees a stale cloud for one interval) | Add the standard `SyncState.canWrite()` gate to `RecoveryUI.saveLog()` (1 site) and `Presets.save()` / `Presets.update()` / `Presets.remove()` (3 sites). Both fixes are 1-line guards. Audit's Affected-files table flags them. Test case #11 (regression) asserts the gate is honored. |
| **`SyncState` already non-ready when push starts** (e.g., a previous error left it at `'error'`) — push proceeds but writes are blocked by the gate; nothing reaches Firestore. | low | local-only (push silently does nothing) | `pushSnapshot()` first checks `SyncState.get()`. If `'hydrating'`, throw `'SYNC_IN_FLIGHT'` (re-entry guard already covers this case). If `'error'`, the user-facing flow is: button shows "Retry sync" instead of "Push to cloud"; tapping it calls `SyncState.set('ready')` then `pushSnapshot()`. Audit test case #6 covers. |
| **F19a future-record skipping leaves user with NO way to push** — if a record minted on Device B with a higher schemaVersion sits on Device A's disk (synced via JSON import or some other path), every push skips it, and the user doesn't know why. | low | local-only (push succeeds but is incomplete; user UX confusion) | Surface skipped count in the post-push toast: "Synced 47 records. 1 future-schema record preserved locally — update Tempo on your other device to push it." Toast lives in B-4; B-3 surfaces the count in the status row. Audit recommends NOT aborting the whole push (Open question #1). |
| **iOS Capacitor `FirebaseFirestore` plugin errors don't match web SDK shape** — plugin throws `{ code: 'FIRESTORE/...', message }` while web throws `FirebaseError { code: 'permission-denied' }`. | med | native-build (UX confusion — error toast shows raw plugin code) | `js/sync-firestore.js`'s normalization layer maps both shapes to a unified `{ kind, message, isRetryable }`. Audit calls out the four `kind` values: `'permission-denied'`, `'network'`, `'not-found'`, `'unknown'`. Each maps to a user-friendly toast. Test case #10 covers the normalization. **Open question for the user (#3):** the audit doesn't enumerate every plugin error code today — engine-implementer pattern-matches against `@capacitor-firebase/firestore`'s README during implementation. |
| **Firestore security rules deny writes** — auth token expired mid-upload, or user's UID doesn't match `request.auth.uid`. | low | data-correctness (push fails halfway; user has to sign back in) | `SyncFirestore.setDoc()` catches `'permission-denied'` and returns `{ kind: 'permission-denied', isRetryable: false }`. `pushSnapshot()` translates this into a "Please sign in again to continue syncing" toast and routes the user back to the sign-in button. State is set to `'error'` so engine writes resume locally. Test case #12 (optional) covers. |
| **localStorage / IDB read fails mid-snapshot construction** (rare — only via storage corruption or extension interference). | very-low | data-correctness (partial snapshot uploaded if read fails after some records loaded) | Per B-1's contract, `SyncEngine.getSnapshot()` is **atomic in memory** — it builds the entire object before returning. If any store read throws inside the loop, the whole snapshot rejects and no cloud byte moves. Audit asserts this contract is preserved (test case #13 — optional; snapshot read failure aborts upload). |
| **GitHub Pages serves stale cached `sw.js` to existing PWA installs** — users don't get the "Push to cloud" button until cache invalidates. | med | web-bytes (feature gated for one cache cycle on existing installs) | `CACHE_NAME` bump from `v68` → `v69` is mandatory. ASSETS array adds `js/sync-firestore.js` + `js/backup.js`. Sign-off checklist enforces. The new SW activates on next reload; users see the button within seconds of refresh. |
| **`Backup.exportLocal()` on iOS Capacitor doesn't show the share sheet** — Filesystem plugin isn't installed; `<a download>` triggers a `WKWebView` quirk that opens a blank PDF preview instead of saving. | low | native-build (backup unavailable on iOS until fixed) | First implementation pass uses `<a download>` only (the Web Share API path). If iOS WKWebView quirks block the download, the second pass adds the Capacitor `Filesystem` plugin (requires `npx cap sync` + Cocoapods re-install). Audit calls this out as a follow-up risk; B-3 ships with `<a download>` as the iOS path and accepts the WKWebView quirk MAY require a follow-up fix. **Open question for the user (#4):** is this acceptable for B-3, or should B-3 include the `Filesystem` plugin? Recommendation: ship `<a download>` first; iterate if quirks appear in real-device testing. |
| **Service worker `fetch` handler intercepts the CDN `firebase-firestore.js` import** — the `caches.match` call with `ignoreSearch: true` returns a cached miss; `fetch(event.request)` falls through and works, BUT subsequent CDN requests pre-cache the module into the SW. After a long offline session, `firebase-firestore.js` is served from a possibly-outdated cache. | low | web-bytes (stale SDK in cache; possibly missing security fixes) | The web SDK is loaded by URL from gstatic CDN, NOT pre-cached in ASSETS. SW `fetch` handler falls through to network on miss, which is the desired behavior. The cache only ever picks up modules the user has actually fetched. If a deprecated SDK version ever ships, a `CACHE_NAME` bump invalidates everything. Documented; no mitigation needed. |
| **The settings drawer's existing height + scroll behavior overflows on small screens** (iPhone SE, 320×568) when the new "Push to cloud" button is added below the identity row. | low | web-bytes + native-build (UX papercut — button below the fold) | B-2 already verified the drawer is scrollable on small screens. The new button adds ~44px of height; total drawer height stays under viewport on the SE. Manual smoke at 320px / 375px / 414px widths plus iPad. ui-wirer Phase 4 checklist. |

**Risk count: 13** (low: 8, med: 6, high: 0 — but several med-risk
items have higher impact than the count suggests; particularly "partial
upload" (#2) and the "F13 gaps" (#4) deserve careful review attention).
For the return-format header: low 8, med 5, high 0 (treating the
very-low #9 as low).

---

## Test scope

### New tests required: `tests/sync-uploader.test.js`

Minimum 10 cases. Per-test scope (engine-tester writes the
assertions; B-3 audit enumerates the contract). All cases stub
`window.SyncFirestore`, `window.Backup`, `window.SyncAuth`,
`window.SyncFlag` per-case (no real Firebase imports). Mirrors the
mock-based pattern from `meds.test.js` and `sync-auth.test.js`.

1. **Cloud-empty path — full upload happens in dependency order.**
   Stub `SyncFirestore.getCollection` to return `{ count: 0 }` for
   all four stores. Stub `Backup.exportLocal` to resolve
   `{ ok: true }`. Stub `SyncFirestore.setDoc` to resolve and record
   call order. Call `pushSnapshot()`. Assert:
   `Backup.exportLocal` was called once; `getCollection` was called
   for all four stores BEFORE any `setDoc`; `setDoc` calls follow
   the dependency order `rest_log → meds → presets → history`;
   `SyncState` transitions `ready → hydrating → ready`;
   final return value is `{ ok: true, uploaded: { rest_log: N, meds: N, presets: N, history: N } }`.

2. **Cloud-non-empty path — abort to Stage D handoff, no `setDoc` calls.**
   Stub `SyncFirestore.getCollection` to return `{ count: 1 }` for
   the `meds` collection. Call `pushSnapshot()`. Assert:
   `Backup.exportLocal` WAS called (F12 — backup happens regardless);
   `SyncFirestore.setDoc` was NOT called (asserted via spy
   call count === 0); return value is
   `{ ok: false, kind: 'stage-d-handoff', counts: {...} }`;
   `localStorage.getItem('tempo_sync_stage_d_handoff') === '1'`;
   `SyncState` stays at `'ready'` (no `'hydrating'` transition).

3. **(a) Backup-first ordering** + **(b) backup failure aborts upload.**
   3a: Stub `Backup.exportLocal` with a spy that records timestamp.
   Stub `SyncFirestore.setDoc` with a spy that records timestamp.
   Call `pushSnapshot()` on cloud-empty path. Assert
   `Backup.exportLocal` timestamp < first `setDoc` timestamp.
   3b: Stub `Backup.exportLocal` to resolve `{ ok: false, error: 'quota exceeded' }`.
   Call `pushSnapshot()`. Assert no `setDoc` calls; return
   `{ ok: false, kind: 'backup-failed', error: ... }`; `SyncState`
   stays `'ready'`.

4. **Failure mid-upload sets `SyncState = 'error'` and writes the
   partial-upload marker.** Stub `Backup.exportLocal` resolved.
   Stub `getCollection` returns count: 0. Stub `setDoc` to resolve
   for first two calls (rest_log records) and reject on the third
   (first meds record) with `{ kind: 'network', isRetryable: true }`.
   Call `pushSnapshot()`. Assert:
   `SyncState.get() === 'error'`;
   `localStorage.getItem('tempo_sync_partial_upload_uid') === '<test-uid>'`;
   return is `{ ok: false, kind: 'upload-error', error: ... }`.
   Then in the SAME test, stub `setDoc` to resolve for all calls
   on a SECOND `pushSnapshot()` invocation. Assert: `getCollection`
   sees the partial-upload marker and DOES NOT route to Stage D
   handoff; upload completes; marker is cleared.

5. **Refuse-writeback skips future-schema records from the cloud
   payload.** Stub `MedsManager.snapshotForSync` to return a payload
   with two meds, one of which has `schemaVersion: 2`
   (`Schema.SCHEMA_VERSION === 1`). Call `pushSnapshot()`. Assert:
   `setDoc` was called once for the `schemaVersion: 1` med, NOT for
   the `schemaVersion: 2` med; return value includes
   `{ skippedFutureRecords: 1 }`. **Audit calls out:** if
   engine-implementer chooses the "abort on future record" branch
   instead (Open question #1), update the assertion to
   `{ ok: false, kind: 'future-record-detected' }`.

6. **`SyncState` non-ready at start — push is rejected.**
   Sub-cases:
   6a: `SyncState.set('hydrating')` before calling. Assert
   `pushSnapshot()` rejects with `{ ok: false, kind: 'already-in-flight' }`
   without touching backup or cloud.
   6b: `SyncState.set('error')` before calling. Assert
   `pushSnapshot()` rejects with `{ ok: false, kind: 'sync-error-state' }`
   and proposes a retry (caller checks return value).

7. **No auth → push rejected.** Stub `SyncAuth.getCurrentUser` to
   return null. Call `pushSnapshot()`. Assert reject with
   `{ ok: false, kind: 'sign-in-required' }`; no backup; no cloud;
   `SyncState` unchanged.

8. **Flag off → push rejected.** Stub `SyncFlag.isEnabled` to
   return false. Call `pushSnapshot()`. Assert reject with
   `{ ok: false, kind: 'sync-not-enabled' }`; no backup; no cloud;
   `SyncState` unchanged.

9. **Concurrent re-entry guard.** Stub `Backup.exportLocal` with a
   never-resolving promise. Call `pushSnapshot()` (don't await).
   Call `pushSnapshot()` again. Assert the second call returns the
   SAME promise as the first (or, equivalently, the second call's
   internal `Backup.exportLocal` invocation count stays at 1, not 2).

10. **`Backup.exportLocal()` + `Backup.importLocal()` roundtrip.**
    Seed localStorage with known fixture (a meds record, a sleep
    entry, a preset). Call `Backup.exportLocal()`, capture the JSON
    blob. Clear localStorage + History. Call
    `Backup.importLocal(jsonString)`. Assert sessions imported, all
    localStorage keys restored byte-equivalent. This case may
    live in `tests/backup.test.js` instead if engine-implementer
    splits.

**Optional additional cases the engine-tester can add at their
discretion:**

11. **F13 gap regression — recovery-ui + presets respect the gate.**
    Set `SyncState.set('hydrating')`. Call `RecoveryUI.saveLog({...})`.
    Assert localStorage `wellness_rest_log` was NOT updated. Same
    for `Presets.save({...})` and `Presets.update(id, {...})` and
    `Presets.remove(id)`. This is the regression test that locks in
    the B-3 F13 gap fix.

12. **`SyncFirestore` error normalization.** Lives in
    `tests/sync-firestore.test.js` (optional file). Pass each of
    the four error shapes (web `FirebaseError`, native plugin
    `{ code: '12...' }`, native plugin `{ code: 'FIRESTORE/...' }`,
    arbitrary `Error`) through the normalization layer; assert
    `{ kind, isRetryable }` is correct for each.

13. **Snapshot read failure aborts upload.** Stub
    `MedsManager.snapshotForSync` to throw. Call `pushSnapshot()`.
    Assert: backup ran (F12 happens BEFORE snapshot); no `setDoc`
    calls; `SyncState.get() === 'error'`; return is
    `{ ok: false, kind: 'snapshot-failed' }`.

### Manual end-to-end verification (reviewer + Kyle)

These run AFTER the engine tests pass. Document results in the PR
description.

**Web (Chrome + Safari):**

1. Sign in via the Cloud Sync section. Verify the "Push to cloud"
   button appears (and was hidden when signed out).
2. Click "Push to cloud". Watch the status row transition:
   `Backing up...` → `Checking cloud...` →
   `Uploading rest_log (1/N)...` → `Uploading meds (1/N)...` →
   `Uploading presets (1/N)...` → `Uploading history (1/N)...` →
   `Synced ✓` (or error). A backup file download dialog must
   appear during the "Backing up..." step.
3. Open Firebase Console → Firestore. Verify
   `users/{uid}/meds/{medId}` paths exist for every med; same for
   `history`, `rest_log`, `presets`.
4. Click "Push to cloud" again. Status row should immediately
   transition to "Existing cloud data detected" (Stage D handoff
   stub). Verify `localStorage.tempo_sync_stage_d_handoff === '1'`
   in dev tools.
5. Open dev tools → Application → Service Workers. Verify the new
   `stopwatch-v69-sync-uploader` cache is active.

**iOS (physical device via Capacitor build, per `iOS-BUILD.md`):**

6. Sign in via the system Google sheet. Verify the "Push to cloud"
   button appears.
7. Tap "Push to cloud". Verify the share sheet appears (backup
   file). Save to Files or share to mail/notes — anywhere that
   confirms the file was preserved.
8. Watch the status row transition through the same states as
   step 2. Verify Firestore Console reflects the upload.
9. Force-quit the app, reopen. Verify the user is still signed in
   AND the Cloud Sync section reflects the current state.

**Failure-mode smoke:**

10. With dev tools "Offline" simulated (or airplane mode on iOS),
    click "Push to cloud". Verify the status row shows
    "Sync error: network unavailable — retry?" and the button
    re-enables for retry.
11. After the offline test, restore network. Click "Push to cloud"
    again. Verify the upload resumes (NOT routed to Stage D).

### Existing tests at risk

- **`tests/sync-engine.test.js`** (B-1) — likely needs minor
  updates. The `getSnapshot()` shape test still holds. New
  `_pushInFlight` state may need a teardown step in tests that don't
  call `pushSnapshot()`.
- **`tests/sync-auth.test.js`** (B-2) — likely no changes. B-3
  doesn't alter the auth surface.
- **`tests/meds.test.js`** — likely no changes. Adapter contract
  preserved.
- **`tests/history.test.js`** (doesn't exist today per CLAUDE.md's
  test inventory — history snapshot exercised via sync-engine
  tests). No risk.
- **`tests/sync-stamps.test.js`** (A-1) — no changes.

No engine-test file is rewritten or restructured by B-3.

### Test-runner harness considerations

- `tests/index.html` will need `sync-firestore.js` and `backup.js`
  loaded BEFORE `sync-uploader.test.js`. pr-shipper handles the
  edit. The order is `sync-flag.js` → `sync-firestore.js` →
  `sync-engine.js` → `sync-auth.js` → `backup.js` →
  `sync-uploader.test.js`.
- `Backup.exportLocal()` calls `Export.buildBackupData()`. The
  test harness does NOT load `js/export.js` today (history-ui
  tests stub the export module). Engine-tester stubs
  `window.Export = { buildBackupData: async () => ({...}) }` per
  test case where backup is exercised.
- `Schema.SCHEMA_VERSION` is currently `1`. Future-record test
  cases stub records with `schemaVersion: 2`.

---

## Manual setup steps

### Branch setup (engine-implementer's first command)

B-3's prereqs (S0-1, A-1, B-1, B-2, F19a-fix) are all merged to
`main`. Engine-implementer runs:

```bash
git fetch origin
git checkout main
git pull origin main
git checkout -b feat/sync-stage-b-uploader
```

PR target is `main`. No stacking — B-3 is the first sync-stage-b
PR cut from a clean main since B-2 merged.

### Firebase prerequisites (verify, don't re-run)

S0-1 deliverables are already in place. B-3 only verifies:

- Firestore is **enabled** in the Firebase Console for project
  `tempo-sync-6f7b2`. Check at console.firebase.google.com →
  Build → Firestore Database. If "Get started" prompt appears,
  the user needs to complete the one-time region selection
  (us-central1) and rules deployment from S0-1's manual checklist.
- `firestore.rules` is deployed and matches the `users/{uid}`
  isolation rule (verify in Firebase Console → Firestore →
  Rules). The rule file is `firestore.rules` in repo root;
  verify byte-equivalent.
- Firebase Authentication → Google sign-in is enabled (verified
  during B-2 setup).
- `@capacitor-firebase/firestore` plugin is listed in
  `package.json` (verify with
  `cat package.json | grep firestore`). S0-1 added it; B-3
  expects it present.
- Cocoapods: if the plugin is in `package.json` but
  `pod 'CapacitorFirebaseFirestore'` is missing from
  `ios/App/Podfile`, run `npx cap sync ios`. B-3's
  engine-implementer is responsible for running this if needed.

If any verify-step fails, halt and ask the user to complete S0-1's
manual setup before B-3's code commit lands.

### After implementation

- Run `npx cap sync ios` from the repo root if the `Podfile` was
  updated (engine-implementer determines from the
  `package.json` plugin list).
- Run `tests/index.html` in a real browser (per CLAUDE.md's test
  command). Confirm pass count matches B-2 baseline + 10 new
  cases (15 if optional test files ship).
- Web smoke test: open `python3 -m http.server 8765` from repo
  root, browse to `http://localhost:8765`. Sign in via Cloud
  Sync, click Push to cloud. Verify the upload flow against the
  Firebase Console.
- iOS smoke test: `npm run ios:open`, build to a physical
  iPhone (free-cert refresh per `iOS-BUILD.md` if needed). Same
  flow as web.

### Firestore Console cleanup between manual runs

Between successive manual runs of "Push to cloud" (to re-test the
empty-cloud path), the engine-implementer needs to delete the
`users/{uid}/...` tree from Firebase Console (Firestore → Data →
collection menu → "Delete collection"). This is a UI-driven manual
step; there's no programmatic teardown in B-3. **Audit calls this
out** so the implementer doesn't waste cycles wondering why every
push after the first one routes to Stage D handoff.

---

## Out of scope (explicitly NOT in this PR)

- **No auth wiring.** B-2 shipped Google sign-in. B-3 consumes
  `SyncAuth.getCurrentUser()` only.
- **No merge logic.** All upload is fresh-cloud-empty.
  `runTransaction` + per-record CAS + LWW resolution live in E-1.
  `SyncFirestore.runTransaction()` is shipped as a stub that
  throws in B-3.
- **No offline buffer.** `Platform.network` is not extended in
  B-3. If the user is offline when they click Push, the SDK throws
  and the user retries. Offline write buffering lives in E-2.
- **No real-time listeners.** `onSnapshot` lives in E-3.
- **No `meds-arrival` toast.** F15 toast scaffold lives in B-4.
  B-3 emits the `push-progress` and `push-complete` events that
  B-4's toast layer subscribes to for the post-push summary.
- **No auto-trigger.** The push is **manual** (button click) in
  B-3. Auto-trigger on `auth-change` (first sign-in) or on a
  periodic interval lives in E-1.
- **No Stage D imported-bucket migration.** B-3 ships the
  `tempo_sync_stage_d_handoff` localStorage flag only. D-1 owns
  the actual `bucket: 'imported'` migration + UI.
- **No conflict resolution UI.** v2.0 strategy explicitly defers
  this; B-3 doesn't introduce it.
- **No `Persistence.clear()` integration.** Sign-out / push
  failures do NOT wipe local data (local-first contract).
- **No Capacitor `Filesystem` plugin integration for backup
  file writes on iOS.** Audit recommends shipping `<a download>`
  first and iterating on WKWebView quirks if they appear (Open
  question #4).
- **No new Firestore composite indexes.** S0-1 shipped an empty
  `firestore.indexes.json`; B-3's per-record-id reads don't need
  composite indexes.
- **No engine-state sync.** Per Q4 / strategy doc, engine state
  is local-only. B-3 does NOT upload `multi_state`,
  `pomodoro_state`, `flow_state`, `interval_state`, etc.

---

## Sign-off checklist (for the implementer)

- [ ] Branch cut from `main` (B-1 / F19a-fix / B-2 all merged).
      PR target is `main`. See "Manual setup steps".
- [ ] Affected files match the table above (13 paths total, 15 if
      optional `tests/backup.test.js` and `tests/sync-firestore.test.js`
      ship).
- [ ] `SyncEngine.pushSnapshot()` exposes the documented public API:
      returns `Promise<{ ok: true, uploaded: {...} } | { ok: false, kind, ... }>`.
      Sentinel `kind` values are: `'sign-in-required'`,
      `'sync-not-enabled'`, `'sync-error-state'`,
      `'already-in-flight'`, `'backup-failed'`,
      `'stage-d-handoff'`, `'upload-error'`,
      `'future-record-detected'` (only if engine-implementer chose
      abort branch), `'snapshot-failed'`.
- [ ] `SyncEngine.pushSnapshot()` emits `push-progress` events with
      `{ stage, store?, current?, total? }` and a final
      `push-complete` event with `{ ok, kind?, error? }`. ui-wirer
      subscribes for the status-row live updates.
- [ ] `SyncEngine` has a module-scoped `_pushInFlight` boolean
      re-entry guard. Second call returns first call's promise.
- [ ] `SyncEngine.getStageDHandoff()` / `setStageDHandoff()`
      helpers read/write `tempo_sync_stage_d_handoff` localStorage
      key. D-1 will consume this.
- [ ] `SyncEngine.setPartialUploadMarker(uid)` /
      `clearPartialUploadMarker()` read/write
      `tempo_sync_partial_upload_uid` localStorage key. Used by
      F9's "is this a retry or a Stage D?" resolution.
- [ ] `js/sync-firestore.js` exposes documented public API:
      `getDoc(path)`, `setDoc(path, data)`, `getCollection(path)`,
      `runTransaction(fn)` (throws in B-3), `setBatch(writes)`
      (defined but unused in B-3). No DOM access. No fetch outside
      lazy-imported SDK. Web branch lazy-imports `firebase/firestore`
      from gstatic CDN on first call; native branch reads
      `window.Capacitor.Plugins.FirebaseFirestore`. Error
      normalization layer maps both shapes to
      `{ kind: 'permission-denied' | 'network' | 'not-found' | 'unknown', message, isRetryable, originalError }`.
- [ ] **F12 check:** `Backup.exportLocal()` is called BEFORE ANY
      `SyncFirestore.setDoc()` in `pushSnapshot()`. Test case #3a
      enforces.
- [ ] **F9 check:** `SyncFirestore.getCollection()` is called for
      ALL FOUR stores BEFORE any `setDoc()`. If any returns
      `count > 0` AND the partial-upload marker doesn't match the
      current uid, route to Stage D handoff (no `setDoc`). Test
      cases #1 + #2 enforce.
- [ ] **F13 check:** `SyncState.set('hydrating')` is called BEFORE
      first `setDoc` and `SyncState.set('ready')` on success or
      `SyncState.set('error')` on any caught error. Test case #4
      enforces.
- [ ] **F13 gap fix:** `RecoveryUI.saveLog()` and `Presets.save()`,
      `Presets.update()`, `Presets.remove()` all consult
      `SyncState.canWrite()` and return early on `false`. Test
      case #11 (optional) enforces.
- [ ] **F19a check:** `pushSnapshot()` filters out
      `Schema.isFutureRecord(rec) === true` records from each
      collection's payload. Test case #5 enforces.
- [ ] **B-2 auth gate:** `pushSnapshot()` rejects with
      `{ ok: false, kind: 'sign-in-required' }` when
      `SyncAuth.getCurrentUser() === null`. Test case #7 enforces.
- [ ] **`tempo_sync_enabled` gate:** `pushSnapshot()` rejects with
      `{ ok: false, kind: 'sync-not-enabled' }` when
      `SyncFlag.isEnabled() === false`. Test case #8 enforces.
- [ ] **Re-entry guard:** double-call to `pushSnapshot()` returns
      the SAME promise. Test case #9 enforces.
- [ ] `Backup.exportLocal()` reuses `Export.buildBackupData()` —
      **no re-implementation of the export key list**. Defensive
      check.
- [ ] No re-implementation of `escapeHtml` / `Utils.formatMs` /
      `Platform.*` — `Platform.auth` is the only Platform surface
      B-3 reads.
- [ ] All writes to synced stores stamp `deviceId` + `updatedAt` +
      `schemaVersion` via `js/schema.js` — **N/A for B-3** (no new
      write sites on synced stores; B-3 reads existing stamps and
      uploads them).
- [ ] **"Push to cloud" button visible ONLY when**
      `SyncFlag.isEnabled() === true && SyncAuth.getCurrentUser() !== null`.
      ui-wirer's job. Manual smoke: sign out → button hidden;
      sign in → button visible. Disable flag → button hidden.
- [ ] **"Push to cloud" button disabled while in-flight**
      (`aria-disabled="true"` + `disabled` attribute). ui-wirer's
      job.
- [ ] Status row uses `data-progress` attribute for live progress;
      `data-state` attribute (from B-2) for the final state.
- [ ] CSS extends B-2's `.tempo-cloud-sync-status` block; no new
      color tokens.
- [ ] `js/tempo-nav.js`'s `wireCloudSync` extension wires the
      button click handler + subscribes to `push-progress` /
      `push-complete` events. Re-renders the button visibility on
      every `auth-change` (via existing `renderCloudSyncUI` hook).
- [ ] Settings drawer layout verified at 320px / 375px / 414px /
      768px widths — button does NOT push status row below the
      viewport fold on the iPhone SE.
- [ ] `sw.js` `CACHE_NAME` bumped to
      `'stopwatch-v69-sync-uploader'`; `ASSETS` array includes
      `./js/sync-firestore.js` and `./js/backup.js`.
- [ ] All engine tests pass via `tests/index.html` (manual: serve
      repo root via `python3 -m http.server 8765` and open
      `http://localhost:8765/tests/index.html`). Pass count
      expected to be B-2 baseline + 10 new cases (15 if optional
      tests ship).
- [ ] Manual end-to-end smoke on web (Chrome + Safari): sign in,
      push to cloud, verify Firestore Console has the user's data
      tree under `users/{uid}/...`.
- [ ] Manual end-to-end smoke on iPhone Capacitor build: sign in,
      push to cloud, verify Firestore Console has the user's data
      tree under `users/{uid}/...`. Share sheet appears for backup.
- [ ] Manual retry smoke: after the first push, click "Push to
      cloud" again — verify Stage D handoff status appears AND
      `tempo_sync_stage_d_handoff === '1'` in dev tools.
- [ ] Manual offline smoke: enable airplane mode (or dev tools
      "Offline"), click Push, verify error toast; restore network,
      click Push, verify upload resumes (NOT to Stage D).
- [ ] No new Firebase imports outside `js/sync-firestore.js` (web
      branch lazy-imports; native branch uses
      `window.Capacitor.Plugins`). Self-check via
      `grep -rE "import.*firestore" js/`.
- [ ] No call site outside `js/sync-firestore.js` references the
      Firestore SDK. Self-check via
      `grep -rE "getDoc\|setDoc\|getDocs\|runTransaction\|writeBatch" js/ | grep -v sync-firestore`.

---

## Rollback

Revert the PR. `Backup`, `SyncFirestore`, and the `pushSnapshot()`
extension to `SyncEngine` are unreferenced when the button is
removed from the DOM. Reverting removes:

- The settings drawer's "Push to cloud" button (UI disappears;
  rest of the Cloud Sync section unaffected — auth + toggle still
  work).
- The new `<script>` tags for `sync-firestore.js` and `backup.js`
  (no-op file references, harmless if they linger in `sw.js`
  `ASSETS` — service worker just caches two unused files).
- The F13 gap fixes in `recovery-ui.js` and `presets.js` (revert
  restores the pre-B-3 behavior of writes proceeding regardless of
  `SyncState`). **This is a regression** if a future PR re-introduces
  `tempo_sync_state = 'hydrating'`; mitigate by re-applying the
  gap fix as a standalone PR before re-attempting B-3.
- The `tempo_sync_stage_d_handoff` and
  `tempo_sync_partial_upload_uid` localStorage keys are orphaned
  but harmless — they only matter to B-3's logic. A user can clear
  them manually via dev tools if confused; they default to absent
  so a fresh state behaves correctly.

**Cloud cleanup on revert:** if any data was uploaded before the
revert, the Firestore tree at `users/{uid}/...` stays as-is.
**Manual step:** if the user wants a fully clean revert, delete
the collections in the Firebase Console (Firestore → Data → per
collection → "Delete collection"). The strategy doc's "local-first"
contract means leaving the cloud data in place doesn't harm local
state.

If `sw.js` cache bump shipped but the JS changes are reverted, the
old cache version stays in use until the next deploy bumps
`CACHE_NAME` again — no functional regression, just a one-cycle
stale-cache state on existing PWA installs.

---

## Open questions for the user

1. **F19a future-record handling — abort vs upload-everything-else?**
   When a future-schema record exists on disk, should `pushSnapshot()`
   (a) abort the whole upload with "future record detected — update
   your other device first," or (b) upload everything else and
   surface "1 future-schema record preserved locally" via toast?
   Audit recommends (b) — the user likely has at most one or two
   future-records from a newer device, and aborting the whole sync
   makes them permanently stuck until they update. Calling out the
   choice here because it affects the test assertion in case #5.

2. **Partial-upload retry semantics — restart from start, or resume
   from failed store?** When `pushSnapshot()` fails mid-upload, the
   next retry sees a non-empty cloud. The audit's recommendation is
   to use the `tempo_sync_partial_upload_uid` marker to distinguish
   "my failed retry" from "another device's existing data" and
   restart the upload from the start (cloud writes are idempotent
   per-record-id via `setDoc` overwrite semantics). The alternative
   is to track per-store completion markers and resume from the
   failed store. Recommendation: restart from the start (simpler,
   safer, idempotent). Calling out because the test assertion in
   case #4 second half depends on this choice.

3. **iOS Capacitor `FirebaseFirestore` plugin error code
   enumeration.** The audit calls for `js/sync-firestore.js` to
   normalize plugin errors into four `kind` values
   (`'permission-denied' | 'network' | 'not-found' | 'unknown'`),
   but doesn't enumerate the plugin's full error-code shape — the
   `@capacitor-firebase/firestore` README is the source of truth.
   Engine-implementer reads the plugin docs during implementation
   and adds the mappings. If the plugin's error shape is more
   exotic than expected, this may need an audit revision.

4. **Backup file write on iOS — `<a download>` first, Capacitor
   `Filesystem` plugin later?** Audit recommends shipping
   `<a download>` first and accepting that WKWebView may quirk on
   first iOS test. If quirks block the download, a follow-up PR
   adds the `Filesystem` plugin (1-2 hours of work + Cocoapods
   re-install). Recommendation: ship the simpler path first, iterate
   if quirks appear in real-device testing.

5. **Status-row UX during 4-store upload.** Audit describes a
   `data-progress="uploading-meds"` etc. enum but doesn't pin down
   whether each per-record progress (e.g. "Uploading meds (5/12)")
   shows in the same row or a sub-row. ui-wirer's call during
   Phase 4 implementation. Recommendation: same row, single
   updating text label — simpler than a multi-row progress display.

---

## Next step

Stop here. Push this audit to the branch
`feat/sync-stage-b-uploader` (cut from `main` per "Manual setup
steps") and dispatch the engine-implementer for the code commit.
Engine-implementer reads this audit + PLAN.md §B-3 + the
strategy doc's F9/F12/F13/F19a invariants + B-2's audit (the
auth-gate prerequisite) + the four engine sources
(`js/sync-engine.js`, `js/sync-auth.js`, `js/persistence.js`,
`js/export.js`) and writes the seven code files
(`sync-engine.js` extension, new `sync-firestore.js`, new
`backup.js`, `persistence.js` `isHydrating()` helper, `recovery-ui.js`
+ `presets.js` F13 gap fixes, `sync-uploader.test.js`, plus the
ui-wirer-owned settings drawer additions in `index.html` /
`styles.css` / `tempo-nav.js`). No scope additions unless audit
review flags one.
