# Stopwatch PWA — Session Log

A running progress log of Claude Code sessions. Each entry summarizes what was built, what changed, and suggested next steps.

---

## Session 1 — 2026-04-08 to 2026-04-10

### What We Built

**Pomodoro Enhancements (core focus of this session)**
- Separate work/break checklists + "What I Worked On" bulleted list
- Actions drawer: Clear Focus Goals, Clear Break Tasks, Restart Phase, Finish & Reset, Clear All Tasks
- Drag-to-reorder on all checklist/bullet items
- All three lists visible at all times (work, break, actual work) for pre-planning
- Phase timing logged (start/end per work block and break)
- Auto-advance toggle with 3-second countdown between phases
- Tasks persist across Pomodoro cycles (no auto-clear)
- Save for Later (pin) — archive tasks and re-add them to any list
- Task Templates — save/load named checklist configurations
- Session Planning Timeline — visual phase bar with estimated end time
- Distraction/Interruption Log — categorized logging during focus phases with timestamps
- Retroactive session logging — full-screen panel (pencil icon) to log past Pomodoro sessions with tasks

**IndexedDB Migration**
- Moved session history from localStorage to IndexedDB (unlimited storage, no 100-session cap)
- Auto-migrates existing localStorage data on first load
- All History methods now async with race-condition guards

**10-Feature Expansion**
1. Cumulative/split lap toggle
2. History date range filter (Today/Week/Month/All)
3. Sound profiles (Classic/Soft/Sharp)
4. Pomodoro auto-advance
5. Per-instance color coding on timer cards
6. Ambient/focus display mode (fullscreen)
7. Full data export/import (JSON backup)
8. Session templates with auto-start
9. Timer chaining/sequences (sub-mode of Timer)
10. History analytics dashboard (weekly charts, heatmap, trends)

**UI Fixes**
- Moved Start/Pause/Skip buttons above checklists for mobile accessibility

### Suggested Next Steps

**Polish & Bug Fixing**
- Test all features end-to-end on mobile — the session was heavy on implementation, some interactions may need touch refinement
- The top action bar now has many icons (sound, theme, presets, log session, analytics, focus, history) — consider consolidating into a hamburger menu or grouping
- The sequence sub-mode (Timer → Sequence Mode) needs testing for edge cases like page reload mid-sequence

**High-Value Features Not Yet Built**
- Focus session reporting — post-Pomodoro summary showing planned vs actual, time per cycle, distraction count
- Lap data visualization — inline SVG bar chart below the lap list (listed in CLAUDE.md backlog)
- Voice control — Web Speech API for hands-free start/stop/lap

**Tech Debt**
- Update CLAUDE.md to reflect everything built in this session — the "What Has Been Built" and architecture sections are now significantly out of date
- pomodoro-ui.js has grown to ~1100 lines — consider splitting into focused modules (checklist-ui, timeline-ui, distraction-ui)
- Add new localStorage keys to CLAUDE.md state model docs

### Commits
```
ce2e327 Add Pomodoro task tracking, actions drawer, and restart controls
8e9ff50 Add drag-to-reorder for Pomodoro checklists
ccede2c Show break tasks checklist during idle for pre-planning
f2e7eec Log start/end times for Pomodoro sessions and individual phases
429202d Move controls above Pomodoro checklists for easier access
3ef7f2a Migrate session history from localStorage to IndexedDB
f6a1489 Add 10 features: analytics, sequences, focus mode, export, and more
8cf532d Add retroactive session logging (Log Past Session)
8643296 Add task lists to Log Past Session for Pomodoro mode
55a68a1 Show all Pomodoro checklists at all times
329f401 Move auto-advance to visible toggle in Pomodoro action links
050d5b3 Persist tasks across Pomodoro cycles, add Save for Later
f531a83 Add session planning timeline, task templates, and distraction log
f8e5910 Move Log Past Session to dedicated top-bar button and panel
```

---

## Session 2 — 2026-05-11

### What We Built

**Cloud sync foundation (S0-1 — Stage 0 backend infrastructure)**

First infrastructure PR for cross-device cloud sync. No runtime behavior change; everything ships dormant behind the unflipped `tempo_sync_enabled` flag.

- Firebase project `tempo-sync-6f7b2` created in `us-central1` (region permanent).
- Three new npm dependencies installed against the Capacitor 6 line:
  `firebase@^11.10.0`, `@capacitor-firebase/authentication@^6.3.1`,
  `@capacitor-firebase/firestore@^6.3.1`. No peer-dependency conflicts.
- Capacitor plugin config (`capacitor.config.json`): added
  `FirebaseAuthentication` block (`skipNativeAuth: false`,
  `providers: ["google.com"]`). No `FirebaseFirestore` block — plugin
  README says none required.
- Firebase CLI config: `firebase.json` + `firestore.rules` (per-user UID
  isolation via `request.auth.uid == userId`) + `firestore.indexes.json`
  (empty-but-present; E-1 populates as needed).
- Web client config (`js/sync-firebase-config.js`): passive
  `window.FirebaseConfig` assignment with real project values. No SDK
  initialization on load. NOT yet referenced from `index.html` — B-2 wires
  it behind the feature flag.
- iOS client config (`ios/App/App/GoogleService-Info.plist`): committed
  public client config (API key, project ID, GCM sender, bundle ID).
- Updated `ios/App/Podfile` via `npx cap sync ios` — adds
  `CapacitorFirebaseAuthentication` + `CapacitorFirebaseFirestore` pods.
- `.gitignore`: appended `service-account.json`, `*-firebase-adminsdk-*.json`,
  `.firebaserc` patterns to prevent accidental key commits.

**Orchestrator workflow used end-to-end for first time**

S0-1 was the first PR shipped via the 5-specialist orchestrator workflow
(`.claude/orchestrator-prompt.md` + `.claude/agents/*.md`). Two-round
dispatch handled the two-commit plan cleanly:

- Round 1: sync-auditor wrote the audit; engine-implementer wrote
  FIREBASE-SETUP.md; pr-shipper created the feat branch + opened draft PR.
- User pause: 6 manual Firebase Console steps performed using
  FIREBASE-SETUP.md as the checklist.
- Round 2: engine-implementer wrote the config files with real values;
  pr-shipper committed, pushed, and flipped the PR to ready-for-review.

Recorded workflow gap in CLAUDE.md § "Known gaps / workflow TODOs"
(commit ea44b44 on main): the engine-implementer subagent's default scope
forbids `docs/*` and `ios/*`, which doesn't fit config-only / infrastructure
PRs like S0-1 or B-2. Worked around via a per-PR dispatch-brief scope
override. Durable fix (amend the agent's system prompt) is parked for B-2.

**HIPAA / BAA posture documented**

Spark plan cannot self-serve a BAA. Single-user personal use is fine;
public-launch with other users' dose data is blocked until paid GCP plan
+ signed BAA or migration off Firestore. Captured in
`docs/sync-impl/FIREBASE-SETUP.md` and acknowledged in the PR body.

### Suggested Next Steps

**Sync stage progression (per `docs/sync-impl/PLAN.md`)**
- **B-1** (`feat/sync-stage-b-engine-scaffold`) — SyncEngine module skeleton, `snapshotForSync()` adapters on each engine. Parallel-safe with S0-1; no Firebase imports yet.
- **B-2** (`feat/sync-stage-b-auth`) — Wire Google sign-in via `@capacitor-firebase/authentication`. Adds `<script src="js/sync-firebase-config.js">` to `index.html` behind `tempo_sync_enabled`. Touches settings drawer for sign-in UI.
- **B-3** (`feat/sync-stage-b-uploader`) — Stage B0 read-cloud-first guard (F9) + mandatory backup before mutation (F12) + first cloud upload.
- **B-4** — Health-data arrival toast (F15) on remote doseLog entries.

**iOS verification (request reviewer)**
- Web boot byte-equivalence: load `index.html` incognito, confirm no Firebase network requests.
- iOS Xcode build: `npm run ios:open`, Build, confirm `.ipa` produces against new Podfile.
- All 114 engine tests still pass via `tests/index.html`.
- `firestore.rules` syntax: Firebase Console validates on deploy, or
  `firebase emulators:start --only firestore` locally.

**Workflow improvements (deferred)**
- Amend `.claude/agents/engine-implementer.md` to allow brief-driven scope expansion when both audit + dispatch brief enumerate paths outside the default lane. Trigger: next infrastructure PR (likely B-2's `Info.plist` URL types).
- Decide whether to leave Google Analytics enabled at the Firebase project level (currently on — `measurementId G-QY51PWQDCR`). The `js/sync-firebase-config.js` does NOT load the analytics SDK, but analytics is active at project scope. Toggle off via Firebase Console → Project Settings → Integrations → Google Analytics if desired.

### Commits
```
ea44b44 docs(claude): record subagent-scope workflow gap as a known TODO
d141ded docs(sync-impl): S0-1 audit + Firebase setup guide
53c2cf9 chore(sync): Firebase project config + plugins (S0-1)
30aec90 docs(sync-impl): move S0-1 to shipped
d31783a Merge pull request #57 from ksdisch/feat/sync-stage-0-firebase-setup
```

---

## Session 3 — 2026-05-11

### What We Built

**Cloud sync scaffold (B-1 — Stage B SyncEngine module)**

Second sync infrastructure PR. SyncEngine scaffold + read-only snapshot adapters on the 4 synced stores. Zero network calls, zero behavior change behind `tempo_sync_enabled='0'`.

- New `js/sync-flag.js` — tiny IIFE singleton, owns `tempo_sync_enabled` localStorage key. Default absent → `isEnabled()` returns false. `enable()` / `disable()` write `'1'` / `'0'` (explicit opt-out, not `removeItem`).
- New `js/sync-engine.js` — IIFE singleton exposing `init / enable / disable / getState / getSnapshot / on / off / emit`. Hardcoded `SYNCED_STORES` registry (4 entries: meds, history, rest_log, presets), each with `read` (calls store's `snapshotForSync()`) + `write` stub (B-3 implements). `init()` is idempotent and a no-op in B-1 regardless of flag — no DOM, no network, no store reads.
- `snapshotForSync()` adapters on `MedsManager`, `History` (async), `Presets`, `RecoveryUI`. Each returns `{ deviceId, schemaVersion, payload }` envelope; inner records pass through with their existing per-record stamps. Read-only on local state — verified by defensive-copy contract test.
- One-line wiring in `js/app.js`: `SyncEngine.init();` after `Persistence.load()` and before `Themes.init()`. No-op since flag is off.
- 21 engine tests in `tests/sync-engine.test.js` (747 lines): SyncFlag basics, init lifecycle (3 cases — off / idempotent / on stays no-op), getState, getSnapshot shape, defensive-copy contracts (meds + history), F21 structural exclusion, F2 ID passthrough, F19a future-record passthrough (placeholder — deferred per gap below), F19b unknown-field passthrough, emitter (3 cases). Full suite: 296/296 pass via kapture.
- `sw.js` cache bumped to `stopwatch-v66-sync-engine-scaffold`; 2 new paths added to `ASSETS`.
- 2 new `<script>` tags in `index.html` (between persistence.js and audio.js).

**F19a future-record passthrough gap surfaced**

While writing tests, the F19a passthrough case caught a pre-existing bug in `js/meds.js`: `createMed.getState()` unconditionally writes `schemaVersion: Schema.SCHEMA_VERSION`, downgrading future-schema records on read. Bug predates B-1 (shipped in PR #52's F19a implementation). `History.snapshotForSync()` was audited and confirmed NOT affected (addSession preserves future schemaVersion; getSessions is raw IDB pass-through). Presets is unaffected (`getAll()` reads raw localStorage).

Deferred to a dedicated follow-up PR (`feat/sync-stage-a-f19a-passthrough-fix`) before B-3. Failing test was converted to a passing placeholder in `tests/sync-engine.test.js` with a TODO comment pointing at the fix. New row added to `docs/sync-impl/PLAN.md` § "What's pending."

**Orchestrator workflow improvements**

- Pre-emptively flagged the Auto-Mode-does-not-skip-pause rule in pr-shipper's brief (mitigates the S0-1 round 2 protocol breach where pr-shipper auto-pushed). Working as intended for B-1.
- Engine-implementer's scope override (per CLAUDE.md § "Known gaps / workflow TODOs") used again for `recovery-ui.js` — explicitly authorized by the audit's R1 decision.

### Suggested Next Steps

- **F19a-fix follow-up** — dedicated patch PR for the future-record passthrough gap. Touches `meds.js` only (history.js confirmed clean). Must land before B-3.
- **B-2** (`feat/sync-stage-b-auth`) — Google sign-in via `@capacitor-firebase/authentication`. Adds settings-drawer "Cloud Sync" section + the visible toggle for `tempo_sync_enabled`. iOS `Info.plist` URL types for reverse-client-id deep link.
- **B-3** — first cloud upload (Stage B0 read-cloud-first guard F9 + mandatory backup F12 + `pushSnapshot()`).
- **B-4** — health-data arrival toast (F15).

**Workflow tweaks deferred**
- Amend `.claude/agents/engine-implementer.md` to allow brief-driven scope expansion (parked in CLAUDE.md § "Known gaps / workflow TODOs" since S0-1; second motivating case is `recovery-ui.js` in B-1).

### Commits
```
a3c3f19 feat(sync): SyncEngine module scaffold + per-store snapshot adapters (B-1)
d703cc8 docs(sync-impl): move B-1 to shipped + add F19a-fix to pending
```

---

## Session 4 — 2026-05-11

### What We Built

**F19a future-record schemaVersion passthrough fix (F19a-fix)**

Targeted engine patch for the bug B-1's tests surfaced. `js/meds.js` `createMed.loadState` now captures the on-disk `schemaVersion` in a private `_originalSchemaVersion` field when it exceeds `Schema.SCHEMA_VERSION`; `getState()` emits `_originalSchemaVersion ?? Schema.SCHEMA_VERSION` so future-schema records round-trip through the wire format without being downgraded. New `isFromFutureSchema()` accessor for tests.

- `js/history.js` was audited and confirmed clean (no equivalent bug — `addSession` preserves the future stamp; `getSessions` is raw IDB pass-through).
- `js/presets.js` unaffected (existing tests in `tests/presets.test.js` already cover the raw-localStorage read path that surfaces future stamps naturally).
- 7 new cases in `tests/sync-stamps.test.js` (future preserved / current regression / legacy regression / far-future / F19a+F19b interaction / idempotence / MedsManager.loadAll integration roundtrip).
- B-1's placeholder test in `tests/sync-engine.test.js` un-placeholdered now that B-1 is merged. Real assertion: seed `schemaVersion: Schema.SCHEMA_VERSION + 1` med to localStorage, `loadAll()`, `snapshotForSync()`, assert envelope stays at current `Schema.SCHEMA_VERSION` while inner record preserves future stamp.
- Full suite: 303/303 pass via kapture (was 296/296 in B-1).

**Unblocks B-3.** With F19a-fix merged, B-3's first cloud upload will round-trip records cleanly without silently downgrading future-schema entries.

### Suggested Next Steps

- **B-2** (`feat/sync-stage-b-auth`) — Google sign-in + settings drawer Cloud Sync section. Currently auditing-in-progress in parallel; dispatch implementer once F19a-fix's PR lands.
- **B-3** — first cloud upload (Stage B0 read-cloud-first guard F9 + mandatory backup F12 + `pushSnapshot()`). Now unblocked by F19a-fix.
- **B-4** — health-data arrival toast (F15).

### Commits
```
c853b1b fix(meds): preserve future-schema schemaVersion on loadState/getState (F19a-fix)
4d1ce13 docs(sync-impl): move F19a-fix to shipped
992836d Merge pull request #59 from ksdisch/feat/sync-stage-a-f19a-passthrough-fix
```

---

## Session 5 — 2026-05-11

### What We Built

**Cloud sync auth (B-2 — Google sign-in + settings drawer Cloud Sync section)**

Third sync infrastructure PR. Adds Google sign-in via `@capacitor-firebase/authentication` on native + `firebase/auth` popup flow on web, plus a visible Cloud Sync section in the settings drawer with a toggle, sign-in button, current-user display, and status row.

**Engine layer (Phase 2):**
- New `js/sync-auth.js` — IIFE singleton. Public API: `init / signIn / signOut / getCurrentUser / onAuthChange`. Caches normalized user shape (`{ uid, email, displayName, photoURL }`). Delegates to `Platform.auth.*`. Emits `'auth-change'` via `SyncEngine.emit` on every transition. No-op when `SyncFlag.isEnabled() === false`. Idempotent `init()`.
- Extended `js/platform.js` with `Platform.auth` namespace mirroring the existing `haptic` / `notify` shim shape. **Web path lazy-imports** `firebase-app` + `firebase-auth` from gstatic CDN v11.10.0 on first `init()`/`signIn()` — boot stays byte-equivalent for flag-off users. **Native path** routes to `window.Capacitor.Plugins.FirebaseAuthentication.signInWithGoogle({ scopes: ['profile','email'] })`. Both normalize to the user shape; cancellation returns `null` (no throw).
- One-line wire in `js/app.js`: `SyncAuth.init();` after `SyncEngine.init();`.
- Defensive on missing native plugin: degrades silently with a `console.warn` if `Capacitor.Plugins.FirebaseAuthentication` is undefined.
- Auth state does NOT toggle `tempo_sync_state` (F13 write gate) — that's B-3's job.

**Tests (Phase 3):**
- 14 new cases in `tests/sync-auth.test.js` covering: flag-off no-op, idempotent init, signIn/signOut success paths, onAuthChange subscription/unsubscribe, cancellation returns null, cold-boot rehydrate, web vs native routing (native via stubbed plugin), F13 guard. Web dynamic-import case is a placeholder (stubbing top-level `import()` requires import-maps or SW intercept — out of test-harness scope).
- Async-aware helpers introduced (`async ... return await fn(...)`) to fix a real bug discovered during testing where sync try/finally pattern restored stubs before awaited callbacks completed.
- Full suite: **310/310 pass** via kapture against real Chrome.

**UI wire-up (Phase 4):**
- New "Cloud Sync" section in the settings drawer (after BFRB chime slider). 13 new CSS classes (all using CSS vars; no hardcoded hex except white toggle thumb).
- Toggle row uses `data-keep-drawer-open` so flipping it doesn't auto-close the drawer.
- Identity row (sign-in user, photo, email, display name) shows when signed in; sign-in button when signed out; both hidden when flag is off.
- Status row shows transient messages (`"Signing in…"`, `"Sign-in error: …"`) with `aria-live="polite"`.
- `js/tempo-nav.js` extended: `wireSettingsDrawer` honors `[data-keep-drawer-open]` (filter for the existing auto-close button loop); new `wireCloudSync` subscribes to `SyncAuth.onAuthChange` and re-renders on every drawer open.
- iOS `Info.plist`: added `CFBundleURLTypes` with the verbatim `REVERSED_CLIENT_ID` from `GoogleService-Info.plist` for the OAuth deep-link callback. Validated with `xmllint --noout`.
- Visual verification via kapture: toggle works (aria-checked flips, primary button appears/disappears), no console errors, neighbor route `#/wellness/meds` regression-tests cleanly.

**Coordination note:** S0-1 + B-1 + F19a-fix have all merged to main during this session. B-2 branched from main after S0-1+B-1 landed; rebased once after F19a-fix merged to resolve a CACHE_NAME line conflict in sw.js (resolved by keeping v68-sync-auth, the higher version).

### Suggested Next Steps

- **B-3** (`feat/sync-stage-b-uploader`) — first cloud upload. Stage B0 read-cloud-first guard (F9) + mandatory backup (F12) + `pushSnapshot()`. Now fully unblocked.
- **B-4** — health-data arrival toast (F15) on remote doseLog entries.
- **Manual physical-device verification** (request reviewer): walk through Google sign-in on (a) Chrome/Safari incognito, (b) iPhone via the `iOS-BUILD.md` 7-day free-cert refresh path. Confirm the OAuth round-trip completes + the user identity surfaces correctly in the Cloud Sync section.

### Commits
```
3ae0c03 feat(sync): Google sign-in + settings drawer Cloud Sync section (B-2)
<SHA>   docs(sync-impl): move B-2 to shipped
```

---

## Session 6 — 2026-05-12

### What We Built

**First cloud upload (B-3 — Stage B uploader)**

**The first PR that performs real cloud writes.** Device A can now push its full snapshot to Firestore. First observable cross-device milestone.

**Engine layer (Phase 2):**
- New `js/sync-firestore.js` — Firestore SDK seam (single wrapper for getDoc/setDoc/getCollection/runTransaction/setBatch). Web branch lazy-imports `firebase/firestore` from gstatic CDN v11.10.0 and reuses `Platform.auth`'s FirebaseApp via `getApps()`; native branch routes through `window.Capacitor.Plugins.FirebaseFirestore`. Errors normalized to `{ kind, message, isRetryable, originalError }` (4 kinds: `permission-denied`, `network`, `not-found`, `unknown`). `SYNC_DISABLED` fast-path bypasses SDK load when flag is off.
- New `js/backup.js` — F12 mandatory local backup. `exportLocal()` reuses `Export.buildBackupData()` then offers via Web Share API (mobile) or `<a download>` (desktop / WKWebView fallback). `importLocal()` ships dormant as the D-1 restore hook. Returns `{ ok, bytesWritten?, error? }` for the uploader's hard gate.
- Extended `js/sync-engine.js` with `pushSnapshot()` orchestrator (~330 lines): F12 mandatory backup → F9 read-cloud-first guard with partial-upload-marker resume → F13 gate flip → atomic in-memory snapshot → per-store upload loop (`rest_log → meds → presets → history`) with F19a future-record skipping. New events `push-progress { stage, store?, current?, total? }` and `push-complete { ok, kind?, ... }`. Module-scoped `_pushInFlight` re-entry guard returns the in-flight promise to the second caller.
- Two new persistence keys: `tempo_sync_partial_upload_uid` (resume marker — set on failure, cleared on success), `tempo_sync_stage_d_handoff` (flag set when cloud is non-empty from another device; D-1 will consume).
- Added `SyncState.isHydrating()` helper to `js/persistence.js`.

**F13 gap fixes (engine):**
- `js/recovery-ui.js` `saveLog()` and `js/presets.js` `save`/`update`/`remove` now consult `SyncState.canWrite()` before writing localStorage. Without these gates, mid-upload writes from the recovery UI (e.g. nap timer completing) or preset edits would leak into local state and race the snapshot. B-3 is the first PR that actually flips `tempo_sync_state = 'hydrating'`, so these latent gaps became real. Both fixes are 1-line guards matching the existing `js/meds.js saveAll()` pattern.

**Tests (Phase 3):**
- 18 new cases in `tests/sync-uploader.test.js`: cloud-empty path uploads in dependency order; cloud-non-empty without marker → Stage D handoff; cloud-non-empty WITH marker for same UID → resume upload; F12 backup-first ordering; F12 backup-failure abort; F19a future-record skipping with count surfaced; SyncState transitions on success + failure; snapshot read failure abort; re-entry guard; sentinel rejections (no auth, flag off, hydrating, error state); F13 gap regressions for Presets save/update/remove; 2 SyncFirestore stub-seam tests.
- F13 gap regression for `RecoveryUI.saveLog` was skipped — `recovery-ui.js` isn't loaded by `tests/index.html`; manual e2e covers it.
- Web SDK dynamic-import error-normalization tests deferred (same dynamic-import-stubbing limitation as B-2).
- Full suite: **335/335 pass** via kapture against real Chrome (was 317 post-B-2).

**UI wire-up (Phase 4):**
- New "Push to cloud" button in Cloud Sync section (between sign-in button and status row). Visible only when flag enabled + signed in.
- Status row extended with `data-progress` state attribute: `backup` → "Backing up local data…", `checking-cloud` → "Checking cloud…", `uploading` → "Uploading <store>…", `done` → green "Synced ✓" (or "Synced. N newer records kept local…"), `error` → red, `stage-d-handoff` → info blue.
- `js/tempo-nav.js` `wireCloudSync` extended: push button handler, `renderPushBtn()` visibility logic (gated on `SyncFlag.isEnabled() && SyncAuth.getCurrentUser() && !SyncState.isHydrating()`), subscriptions to `SyncEngine.on('push-progress')` + `SyncEngine.on('push-complete')` for live status updates.
- CSS extends B-2's `.tempo-cloud-sync-status` block with `[data-progress]` state colors using existing CSS vars. Button disabled state styled via `:disabled` + `[aria-disabled="true"]`.
- Kapture verification: app boots without console errors; push button DOM exists; correctly hidden when signed out; renders in Cloud Sync section as designed; neighbor route `#/wellness/meds` regression-tests cleanly.
- iOS `Info.plist` NOT touched in B-3 — Firebase iOS SDK reuses the B-2-shipped `CFBundleURLTypes`.

**`sw.js` cache bump:** `stopwatch-v68-sync-auth` → `stopwatch-v69-sync-uploader`. Added `./js/sync-firestore.js` + `./js/backup.js` to `ASSETS`.

**Audit:** `docs/sync-impl/audits/B-3-AUDIT.md` (788 lines, 13 affected files, 13 risks: 8 low / 5 med / 0 high).

### Suggested Next Steps

- **Manual physical-device end-to-end verification** (this is the key milestone for B-3): on Chrome / Safari incognito, flip on Cloud Sync → Sign in with Google → click Push to cloud → verify status row progresses through stages → verify Firestore Console shows `users/{uid}/...` paths populated. Repeat on iPhone via `iOS-BUILD.md` free-cert refresh path.
- **B-4** — health-data arrival toast (F15). Lights up in E-1 when remote doseLog entries arrive; for B-3 it's still dormant.
- **C-1** (`feat/sync-stage-c-hydrate`) — Device B fresh hydrate. Pulls down the snapshot B-3 just uploaded.
- **Stage D / E** — the rest of the sync rollout (imported bucket, reconcile + clock-skew clamp, steady-state merge loop, offline buffer, real-time listeners).

### Commits
```
<SHA>   feat(sync): first cloud upload + F13 gap fixes + Push-to-cloud UI (B-3)
<SHA>   docs(sync-impl): move B-3 to shipped
```

---

## Session 7 — 2026-05-12

### What We Built

**Device B fresh hydrate (C-1 — Stage C cloud-to-local pull path)**

**Second observable cross-device milestone.** Device B with no local data signs in, pulls cloud state in strict dependency order, lands as canonical local state. Symmetric counterpart to B-3's push.

**Engine layer:**
- Extended `js/sync-engine.js` with `hydrateFromCloud()` orchestrator (~400 lines): F13 SyncState.set('hydrating') → Stage D non-empty-local guard → strict-order pull (`rest_log → meds → presets → history`) → per-store `_hydrateWriteRaw` dispatch with F19a future-record preservation → 5 markers (`tempo_sync_hydrated_<store>` + `_all`) → SyncState.set('ready'). Module-scoped `_hydrateInFlight` re-entry guard. New events `hydrate-progress { stage, store }` and `hydrate-complete { ok, kind, ... }`.
- Added `MedsManager.hydrateFromCloud(records)` + `_hydrateWriteRaw(records)` — direct localStorage write bypassing `SyncState.canWrite()` gate; reloads in-memory state via existing `loadAll()` so F19a `_originalSchemaVersion` populates correctly.
- Added `History.hydrateFromCloud(records)` + async `_hydrateWriteRaw(records)` — single IDB readwrite transaction clears `sessions` store, bulk-puts each cloud record verbatim.
- Added `Presets.hydrateFromCloud(records)` + `_hydrateWriteRaw(records)` — writes `quick_presets` localStorage verbatim; also sets `presets_seeded=1` to prevent default-seeding from re-merging over cloud data on next boot.
- Added `RecoveryUI.hydrateFromCloud(restLogMap)` + `_hydrateWriteRaw(restLogMap)` — writes `wellness_rest_log` localStorage verbatim (scope override for `*-ui.js` per audit's R1 rationale).
- `SyncEngine.init()` subscribes to `SyncAuth.onAuthChange` to auto-trigger hydrate on first sign-in. `js/app.js` adds belt-and-suspenders backstop subscription (harmless double-fire prevented by `_hydrateInFlight`).
- Stage D non-empty-local guard: ignores default-seeded presets (otherwise every first-time user would hit Stage D); checks meds OR history OR rest_log non-empty → routes to handoff, sets `tempo_sync_stage_d_handoff` flag, NO writes.

**Tests (21 new cases in `tests/sync-hydrate.test.js`):**
- Strict pull order, per-store markers, partial-failure recovery.
- F13 gate behavior + `_hydrateWriteRaw` bypass (writes succeed when SyncState='hydrating').
- Stage D handoff for non-empty meds / history / rest_log / all-four scenarios.
- Presets-only-non-empty STILL hydrates (corrected per engine-implementer's pragmatic call — default seeds are not user data).
- F19a future-schema record from cloud written verbatim, F19a-fix machinery captures `_originalSchemaVersion` on post-write `loadAll`.
- Re-entry guard, `_all` short-circuit, sentinel rejections (no auth / flag off / state hydrating / state error), state transitions (`ready → hydrating → ready` on success / `→ error` on failure), boot trigger smoke, malformed-record skipping, empty cloud handling.
- Full suite: **358/358 pass** via kapture (337 baseline + 21 new C-1).

**UI:**
- New boot-time `#tempo-hydrate-overlay` — full-screen blocking modal with spinner, title "Loading from cloud…", live progress text ("Loading medications…"), and error state with Retry + Skip for now buttons.
- `prefers-reduced-motion` fallback for the spinner (opacity pulse instead of rotation).
- 5 new `data-progress` states on the existing `.tempo-cloud-sync-status` block (hydrate-rest_log / hydrate-meds / hydrate-presets / hydrate-history / hydrate-done) so the settings drawer status row tracks hydrate in parallel.
- `js/tempo-nav.js` `wireCloudSync` extended with `SyncEngine.on('hydrate-progress')` + `on('hydrate-complete')` subscriptions. Complete event routes by `kind`: `done` auto-hides after 1s with "Loaded ✓"; `stage-d-handoff` hides overlay, surfaces B-3 drawer copy; `error` reveals overlay error state with Retry + Skip; `already-hydrated` quietly hides; sentinels quietly hide.
- All user-controllable text passes through `escapeHtml`.

**5 new persistence keys:** `tempo_sync_hydrated_rest_log`, `_meds`, `_presets`, `_history`, `_all`.

**`sw.js` cache bump:** `stopwatch-v70-sync-uploader-share-fallback` → `stopwatch-v71-sync-hydrate`.

**Audit:** `docs/sync-impl/audits/C-1-AUDIT.md` (14 affected files, 12 risks: 0 high / 4 med / 8 low).

### Suggested Next Steps

- **Manual physical-device verification** (the canonical proof — first real laptop-to-phone data flow): on iPhone, install the latest build via Capacitor, fresh-install (clear app data if it has anything), enable Cloud Sync, sign in. Hydrate overlay should appear with "Loading from cloud…", progress through each store, then dismiss revealing your data (the meds + history + presets + rest_log you pushed from the laptop via B-3). This is THE moment that proves laptop-to-phone sync works.
- **B-4** — health-data arrival toast (F15). Will light up in E-1.
- **D-1** (`feat/sync-stage-d-imported-bucket`) — handles the case where Device B has its OWN local data + cloud also has data. Currently routes to handoff with a dead-end status message; D-1 ships the proper "Imported (pre-sync)" bucket migration + UI.
- **D-2** — doseLog reconcile + clock-skew clamp (engine-only).
- **E-1** — steady-state merge loop (the actual "ongoing bidirectional sync" engine).

**Doc TODOs (carry forward from earlier sessions):**
- Patch `docs/sync-impl/FIREBASE-SETUP.md` to include the "Deploy firestore.rules via Console" step. (Bit Kyle during B-3 manual e2e.)

### Commits
```
<SHA>   feat(sync): Device B fresh hydrate orchestrator + boot overlay (C-1)
<SHA>   docs(sync-impl): move C-1 to shipped
```

---

## Session 8 — 2026-05-12

### What We Built

**Stage D imported-bucket reconcile (D-1 — third observable cross-device milestone)**

C-1 landed Device B fresh-hydrate but left Stage D (Device B with pre-existing local data + cloud also non-empty) as a dead-end status message in the settings drawer. D-1 ships the actual reconcile flow that C-1's `tempo_sync_stage_d_handoff` guard short-circuits to: tag local rows as "imported (pre-sync)" → pull cloud → merge per per-store collision rules → write combined snapshot to local + cloud → clear handoff flag. F17 Alternative 2 (separate-bucket imported history) is the strategy implemented here.

**Engine layer (Phase 2):**
- Extended `js/sync-engine.js` with `reconcileImportedBucket()` orchestrator (~400 lines, 9-step contract): (1) `SyncState.set('hydrating')` → (2) stamp local idempotently (history rows get `bucket: 'imported'`, meds get immutable `originDeviceId`) with F19a future-record skip → (3) pull cloud per-store via `_pullCloudStore` → (4) merge per collision rules (history append-merge by `id`; meds LWW by `updatedAt` with same-id+different-origin re-key to `${id}@${cloudOriginDeviceId}`; rest_log cloud-wins per day; presets LWW array) → (5) write combined to local + cloud via new `_reconcileWriteRaw` privileged helpers + push back to cloud → (6) set 5 hydrate markers → (7) clear `tempo_sync_stage_d_handoff` → (8) `SyncState.set('ready')` → (9) emit `reconcile-complete`. Failure path leaves handoff flag set + markers unset for idempotent re-run.
- `js/history.js` — added `bucket: session.bucket || 'synced'` overlay default in `addSession`'s entry literal (spread pattern, no `KNOWN_HISTORY_KEYS` allowlist needed); new async `_reconcileWriteRaw(records)` twin of C-1's `_hydrateWriteRaw`. Bucket field is structural; `getAllTags()` continues to skip it.
- `js/meds.js` — added `'originDeviceId'` to `KNOWN_MED_KEYS` (V2 block); new `let originDeviceId = null` closure with set-once-immutable read in `loadState`; emitted from `getState()`; new `_reconcileWriteRaw(records)` helper on `MedsManager`.
- New `js/sync-manual-dedupe.js` — D-2+ hook surface placeholder. `ManualDedupe.scan()` reads `History.getSessions()`, partitions by bucket, pre-buckets by `(type, YYYY-MM-DD)`, yields `{ a, b, similarity }` pairs (1.0 exact-duration match; 0.9 for `|delta| <= 5000ms`).

**UI wire-up (Phase 4):**
- `js/history-ui.js` — new `.imported-filter-bar` filter chip (only renders when `hasImported`); persists toggle to `history_hide_imported`; prepends non-interactive `.history-tag-imported` chip (dashed outline, muted color) on imported session rows.
- `js/tempo-nav.js` — replaced both dead-end "Manual reconciliation will ship in a follow-up" sites (B-3 push handler + C-1 hydrate-complete handler) with new `#cloud-sync-reconcile-btn` element + handler. Visibility gated on `SyncFlag.isEnabled() && SyncAuth.getCurrentUser() && tempo_sync_stage_d_handoff === '1'`. Subscribed to `reconcile-progress` / `reconcile-complete` events with per-stage status copy.
- `css/styles.css` — `.history-tag-imported` + `.imported-filter-bar` blocks. Reused existing `.tempo-cloud-sync-primary` button class.
- `index.html` — added `<script src="js/sync-manual-dedupe.js">` between sync-engine.js and sync-auth.js; added `#cloud-sync-reconcile-btn` element inside Cloud Sync drawer section.

**Tests (Phase 3):**
- 23 new cases in `tests/sync-imported-bucket.test.js`: MedsManager `_reconcileWriteRaw` (3); orchestrator happy path (5); failure paths (4); re-entry + events (3); merge collision rules (2); `ManualDedupe.scan` (6).
- One downstream `tests/meds.test.js` regression patched: added `'originDeviceId'` to `expectedKeys` Set in the "fresh med (no loadState call) emits no __forward keys" test.
- Full suite: **381/381 pass** via kapture (358 C-1 baseline + 23 new D-1 cases).

**Headline findings — 5 spec-vs-code mismatches resolved at audit time** (documented in `docs/sync-impl/audits/D-1-AUDIT.md`):

1. `KNOWN_HISTORY_KEYS` does not exist on `main` — `history.js:235` uses an F19b spread-then-overlay pattern instead, so `bucket` ships as a single overlay default (no allowlist edit needed).
2. `originDeviceId` DOES need a `KNOWN_MED_KEYS` entry (V2 block) — meds.js uses the F19b allowlist+`__forward` pattern, unlike history; without the entry, `originDeviceId` would round-trip through `_forwardBag` as an opaque blob.
3. The reconcile-flow ordering is pull → merge → push in 9 explicit steps — PLAN.md §D-1's "tag local … then upload" wording is shorthand; the audit re-sequenced it.
4. `_reconcileWriteRaw` mirrors C-1's `_hydrateWriteRaw` line-for-line — future unification PR may collapse them into one `_privilegedWriteRaw(reason: 'hydrate' | 'reconcile')`.
5. `js/sync-manual-dedupe.js` lives at the flat repo path, not `js/sync-impl/manual-dedupe.js` as PLAN.md §D-1 §"Files touched" suggested (the codebase doesn't use the `js/sync-impl/` subfolder).

**Known harness gap (recommend follow-up before D-2):** Loading `js/history.js` in `tests/index.html` declares `const History` at script scope, which breaks ~22 pre-existing sync tests that mock `window.History`. As a result, 7 audit-listed D-1 cases that exercise the REAL History module (Test scope #1, #2, #3, #5, #11, #12, plus `getAllTags` regression) can't run — they're enforced manually via the audit's "Manual setup steps". A follow-up test-harness refactor PR (lazy-load History only inside isolated `describe` blocks, or move History tests to a separate `tests/history.html` page) should land before D-2 to fully exercise these paths.

**`sw.js` cache bump:** `stopwatch-v71-sync-hydrate` → `stopwatch-v72-d1-reconcile`. Added `./js/sync-manual-dedupe.js` to `ASSETS`.

**Audit:** `docs/sync-impl/audits/D-1-AUDIT.md` (already committed at `f2f4639` per A-1 precedent).

### Suggested Next Steps

- **Manual physical-device end-to-end verification (the canonical D-1 proof):** on Device B with pre-existing local data (meds, history, rest_log, presets), flip on Cloud Sync → sign in with the same Google account as Device A → C-1 hydrate routes to Stage D handoff → tap "Reconcile now" in the drawer → confirm: (1) status row progresses through `tagging` → `pulling-<store>` → `merging` → `writing` → `uploading-<store>` → `done`; (2) history panel shows "Imported (pre-sync)" chips on Device B's pre-existing rows + hide-imported filter chip in filter bar; (3) Device A's cloud-merged history is now visible; (4) Firestore Console shows the merged snapshot.
- **Test-harness refactor (before D-2):** lazy-load History in `tests/index.html` so the 7 manual-only D-1 cases can be enforced. Likely scope: ~50 lines in `tests/index.html` + small `tests/test-runner.js` extension.
- **D-2** (`feat/sync-stage-d-reconcile`) — per-med ±15-min doseLog reconcile (F1) + clock-skew clamp (F16). Engine-only PR. Builds on D-1's reconcile pipeline; touches `js/meds.js` only.
- **B-4** — health-data arrival toast (F15). Lights up in E-1.
- **E-1** (`feat/sync-stage-e-merge-loop`) — steady-state push/pull loop. The actual "ongoing bidirectional sync" engine. Largest PR of the rollout; touches every synced store with per-store merge files.

**Coordination note:** D-1 branched from `feat/sync-stage-c-hydrate` (C-1's PR #62, still open at session start). The D-1 PR diff against `main` will include C-1's commits until C-1 merges; after the merge, GitHub auto-updates the PR view to show only D-1's diff. No rebase needed unless C-1 merges with conflict-touching changes.

**Doc TODOs (carry forward from earlier sessions):**
- Patch `docs/sync-impl/FIREBASE-SETUP.md` to include the "Deploy firestore.rules via Console" step (bit Kyle during B-3 manual e2e).
- Amend `.claude/agents/engine-implementer.md` to make the brief-driven scope-expansion mechanism explicit (still TODO since S0-1).

### Commits
```
<SHA>   feat(sync): Stage D imported-bucket reconcile (D-1)
<SHA>   docs(sync-impl): move D-1 to shipped
```

---

## Session 9 — 2026-05-12

### What We Built

**Stage D doseLog reconcile + clock-skew clamp (D-2 — final Stage D PR)**

D-1 landed the imported-bucket reconcile pipeline but left per-record `doseLog`
arrays untouched on collision. D-2 ships the per-med reconcile helper that
collapses cross-device near-duplicates (F1) and clamps clock-skewed entries
(F16), plus wires A-1's dead-code `MedsManager.onMergeComplete(medId)` /
`recomputeLastTakenAt(med)` helpers live for the first time. Engine-only —
no UI, no DOM, no new persistence keys. Phase 4 ui-wirer skipped per
audit-driven autonomous transition (zero UI files in the affected-files
table). D-1's `reconcileImportedBucket()` is NOT retrofitted to call the new
helper in D-2 (Decision #2 — E-1 owns both wire-up sites); only a no-op
comment seam lands inside D-1's meds-merge path.

**Engine layer (Phase 2):**
- `js/meds.js` — new module-level `const RECONCILE_WINDOW_MS = 15 * 60 * 1000`
  exposed on `MedsManager.RECONCILE_WINDOW_MS` for tests (Decision #5 ties
  F1 + F16 to one shared constant). New `MedsManager.reconcileDoseLog(med,
  incomingEntries)` pure helper returning `{ entries, dropped, collapsed,
  warnings }`. Algorithm in order: F19a refuse-writeback gate (returns
  unchanged with `'skipped: future-schema record'` warning if
  `Schema.isFutureRecord(med)`) → union `med.doseLog ∪ incomingEntries` →
  capture `localNow = Date.now()` ONCE → F16 clamp non-local entries outside
  `localNow ± RECONCILE_WINDOW_MS` (inclusive boundary per Decision #4) →
  dedup by `(deviceId, takenAt)` exact-match → sort ascending by `takenAt` →
  F1 walk: for each adjacent pair within window, if same `deviceId` PRESERVE
  both (Decision #1 — intentional same-device re-doses), else keep `a` +
  drop `b` + increment `collapsed`, continue from `a` (handles 3-entry
  cross-device clusters) → F14 cap enforcement (drop oldest until length ≤
  1000). Per-entry try/catch wraps clamp/dedup logic per Decision #3 — a
  single bad entry pushes a warning but never aborts the merge cycle.
  No mutation of input `med.doseLog`; caller assigns `result.entries` and
  persists.
- `js/meds.js` — wires A-1's dead-code `MedsManager.onMergeComplete(medId)`
  live: looks up the med, calls `recomputeLastTakenAt(med)` to re-derive
  `lastTakenAt` from the doseLog tail per F4 (or `null` for empty doseLog),
  persists via `saveState`, emits an `onMergeComplete` event on
  `SyncEngine.emit` so E-1 + B-4's future toast subscriber can wire the F15
  ≥2-entry remote-arrival surface.
- `js/sync-engine.js` — comment-only seam inside `reconcileImportedBucket()`
  near the `_mergeMeds` call site documenting where E-1 will plug in the
  `MedsManager.reconcileDoseLog` + `MedsManager.onMergeComplete` calls per
  Decision #2. No behavior change.

**Six decisions resolved up-front** (Kyle accepted all defaults during D-2
brief draft):
1. Same-`deviceId` ±15min duplicates → PRESERVE (intentional re-doses).
2. Call-sites → D-2 ships helper only; no retrofit of D-1's reconcile flow.
3. Per-entry error handling → skip failing entry, push warning, continue.
4. ±15min window boundary → INCLUSIVE (`<=`, not `<`).
5. F1 + F16 → one shared `RECONCILE_WINDOW_MS` constant.
6. Warning log → console-only, batched per merge cycle (no toast).

**Tests (Phase 3):**
- 15 new cases under `describe('reconcileDoseLog')` in `tests/meds.test.js`
  (14 audit-mandated + 1 `RECONCILE_WINDOW_MS` sanity assertion the dispatch
  brief explicitly requested): exact-match dedup; F1 cross-device collapse;
  F1 same-device preserve; F16 far-future drop; F16 far-past drop; F16
  does-NOT clamp same-device; F1+F16 inclusive boundary; `recomputeLastTakenAt`
  re-derives correctly; empty-incoming no-op; idempotent (reconcile twice =
  same result, critical mitigation for Risk #1); F14 cap enforcement (1500
  → 1000, oldest dropped); `onMergeComplete(medId)` event fires once
  per-med; three-cluster cross-device walk rule; F19a future-schema skip
  case.
- Full suite: **396/396 pass** via kapture against real Chrome (381 baseline
  + 15 new D-2 cases). Run verified in a real browser per the no-Node-runner
  convention.

**Tooling observation worth flagging for E-1:** The engine-tester hit
service-worker cache poisoning on `http://localhost:8765` during the test
verification run — the SW registered by `js/app.js` had cached D-1's
`tests/meds.test.js` and `js/meds.js`, masking the new D-2 test cases until
the tester switched to `http://127.0.0.1:8766`. Worth folding into the
`tests/index.html` harness refactor queued for E-1: either honor a
`?nosw=1` query param that skips SW registration, or add a `tests/` path
exemption in the SW fetch handler. (Independent of the inherited
`History`-coupling harness gap from D-1.)

**`sw.js` cache bump:** `stopwatch-v72-d1-reconcile` →
`stopwatch-v73-d2-doseLog-reconcile`. No new `ASSETS` entries (D-2 modifies
existing cached files only).

**Audit:** `docs/sync-impl/audits/D-2-AUDIT.md`. **Per-PR brief:**
`docs/sync-impl/prompts/D-2-PROMPT.md` (mirrors D-1's commit `f2f4639`
two-file docs commit).

**Stage D is now complete.** After D-2 merges, the remaining sync work is
Stage E: E-1 (steady-state merge loop — largest single PR of the rollout;
wires D-2's `reconcileDoseLog` into both call sites + retrofits D-1's
reconcile path; owns the harness refactor) → E-2 (offline buffer with
`originalWallClock` preservation) → E-3 (real-time `onSnapshot` listeners
+ refuse-writeback toast). After Stage E ships, cloud-sync is feature-
complete; F19c manifest registry stays deferred.

### Suggested Next Steps

- **E-1** (`feat/sync-stage-e-merge-loop`) — steady-state push/pull merge
  loop. Wires D-2's `reconcileDoseLog` into both the D-1 `reconcileImportedBucket`
  meds-merge path AND the new steady-state merge path. Decides F3 (BFRB
  stream consolidation) and F8 (distraction tombstones vs sessionId-keyed).
  Owns the `tests/index.html` harness refactor (History-coupling gap from
  D-1 + SW cache-poisoning gap surfaced in D-2).
- **E-2** (`feat/sync-stage-e-offline-buffer`) — pending-op queue in
  IndexedDB with `originalWallClock` preservation + op compaction + cap.
- **E-3** (`feat/sync-stage-e-listeners`) — real-time `onSnapshot`
  listeners + `Toast.downlevelWarning` for refuse-writeback events.
- **Manual smoke (optional pre-E-1):** wire up a temporary scratch fixture
  with a med whose doseLog has mixed local+remote entries spanning F1/F16
  windows; call `MedsManager.reconcileDoseLog` directly from DevTools;
  verify output by hand before discarding.

**Doc TODOs (carry forward from earlier sessions):**
- Patch `docs/sync-impl/FIREBASE-SETUP.md` to include the "Deploy
  firestore.rules via Console" step (bit Kyle during B-3 manual e2e).
- Amend `.claude/agents/engine-implementer.md` to make the brief-driven
  scope-expansion mechanism explicit (still TODO since S0-1).
- Fold the SW cache-poisoning workaround into E-1's harness refactor —
  either `?nosw=1` query param or `tests/` path exemption in the SW fetch
  handler.

### Commits
```
<SHA>   docs(sync-impl): D-2 audit + per-PR brief
<SHA>   feat(sync): Stage D doseLog reconcile + clock-skew clamp (D-2)
<SHA>   docs(sync-impl): move D-2 to shipped
```

---

## Session 10 — 2026-05-13

### What We Built

**Stage E test-harness SW cache-poisoning fix (E-1a — first of five Stage E sub-PRs)**

D-2's engine-tester surfaced a service-worker cache-poisoning bug: when the
test harness ran on `http://localhost:8765`, the SW registered by the main
app intercepted `<script src="../js/*.js">` requests from `tests/index.html`
and served pre-cached copies — masking new test cases until the tester
manually switched to `127.0.0.1:8766`. E-1a ships the surgical fix so all
downstream Stage E sub-PRs (E-1b → E-1e) and Stage E-2/E-3 test cycles run
reliably on the canonical port. Engine-only — no engine code, no merge
logic, no F-invariant work, no UI surface. Phase 4 ui-wirer skipped per the
autonomous-transition rule (zero UI files in the affected-files table).

**Implementation (engine-implementer Phase 2):**
- `sw.js` — bumped `CACHE_NAME` from `'stopwatch-v73-d2-doseLog-reconcile'`
  to `'stopwatch-v74-e1a-test-harness-fix'`. Added a 9-line referrer-based
  bypass at the top of the `fetch` event handler (lines 82–96) BEFORE the
  existing `caches.match(event.request, { ignoreSearch: true })` call. The
  branch inspects `event.request.referrer` (NOT `event.request.url`) and
  calls `searchParams.has('nosw')`; on match it short-circuits to
  `event.respondWith(fetch(event.request))` and returns. Malformed referrer
  falls through to the existing cache logic via try/catch. Main-app
  cache-first contract preserved — `/index.html` and all `ASSETS`-listed
  files keep offline support because their referrer never carries `?nosw=1`.
- `tests/index.html` — added a silent 4-line URL guard at the very top of
  `<head>` (lines 6–17). Checks `new URL(window.location.href).searchParams.has('nosw')`
  and, if absent, calls `window.location.replace(...)` with `nosw=1`
  appended (preserving existing query like `fresh=verify`). No console
  warning — the URL change in the address bar is the indicator per Q3.

**Six resolutions baked in by Kyle 2026-05-13 (before Phase 2 fired):**
1. Q1 → Pick B (referrer-based bypass; rejected per-script-tag suffix approach).
2. Q2 → `.has('nosw')` binary check (resilient to future tokens like `?nosw=true`).
3. Q3 → Silent guard (no `console.warn` on first load).

**Engine-implementer scope expansion precedent — second use.** E-1a's
affected-files table lists `sw.js` and `tests/index.html` — both outside
the engine-implementer agent's default allowed set (which forbids `tests/*`
and `sw.js`). Per the precedent set by S0-1's Firebase setup, the Phase 2
dispatch brief carried the verbatim override clause from
`CLAUDE.md` "Known gaps / workflow TODOs":
*"If the dispatch brief's `Files in scope` list AND the audit's
affected-files table both explicitly enumerate a path outside the default
allowed set, treat the brief as authoritative for this PR."* Documented
in the PR description for traceability.

**Tests (Phase 3 — manual verification only, zero automated additions):**
Adding a `tests/sw-bypass.test.js` would be circular (the SW being broken
is precisely the bug; stale code masks the assertion). Engine-tester ran
the canonical 9-step manual verification procedure documented in the audit
Test scope section, gated on the deliberate-broken-test reload check
(steps 5–6). Kyle ran the procedure and confirmed:

- Step 3: SW activated with `'stopwatch-v74-e1a-test-harness-fix'`.
- Step 4: `tests/index.html` URL bar auto-injected `?nosw=1`; Network tab
  showed `Referer: http://localhost:8765/tests/index.html?nosw=1` on
  script-src requests; baseline pass count **396/396**.
- Step 5–6: Deliberate-broken-test reload FAIL(1) confirms the bypass
  actually fetches fresh code; revert + reload returns to PASS(396).
- Step 8: Main-app offline reload of `/index.html` works — cache-first
  contract preserved.

Test count target unchanged: **still 396**.

**Audit:** `docs/sync-impl/audits/E-1a-AUDIT.md` (212 lines, 7 risks: 6 low
+ 1 med + 0 high). Med-tier risk was the scope-expansion documentation
gap; mitigated via the dispatch brief override (precedent: S0-1).

**`sw.js` cache bump:** `stopwatch-v73-d2-doseLog-reconcile` →
`stopwatch-v74-e1a-test-harness-fix`. No `ASSETS` additions.

### Manual verification procedure (canonical regression check)

The deliberate-broken-test reload (steps 5–6 of the audit's Test scope
section) is the load-bearing assertion for every Stage E sub-PR's
engine-tester phase post-E-1a. Without it, a buggy bypass would let
downstream tests appear green against stale code. Future Stage E sub-PRs
(E-1b → E-1e, E-2, E-3) must run this check on every PR's Phase 3.

### Suggested Next Steps

- **E-1b** (`feat/sync-stage-e-merge-loop-scaffold`) — `SyncEngine.startSteadyState()`
  + per-store merge dispatcher + `sync-firestore.js` `runTransaction` CAS
  wrapper. Engine-only; no F-invariant decisions yet.
- **E-1c** — D-1 reconcile flow retrofit (wires D-2's
  `MedsManager.reconcileDoseLog` into D-1's reconcile path) + F15
  ≥2-entry remote-arrival counter (B-4 owns the toast UI subscriber).
- **E-1d** — F3 BFRB stream consolidation + F8 distraction sessionId-keyed
  migration.
- **E-1e** — F19a refuse-writeback gate for non-meds stores + final
  steady-state merge-loop wire-up.
- **E-2** (`feat/sync-stage-e-offline-buffer`) — pending-op queue in
  IndexedDB with `originalWallClock` preservation + op compaction + cap.
- **E-3** (`feat/sync-stage-e-listeners`) — real-time `onSnapshot`
  listeners + `Toast.downlevelWarning` for refuse-writeback events.

**Doc TODOs (carry forward from earlier sessions):**
- Patch `docs/sync-impl/FIREBASE-SETUP.md` to include the "Deploy
  firestore.rules via Console" step (bit Kyle during B-3 manual e2e).
- Amend `.claude/agents/engine-implementer.md` to make the brief-driven
  scope-expansion mechanism explicit (still TODO since S0-1; E-1a is the
  second motivating case, after recovery-ui.js in B-1).

### Commits
```
f6f0800 docs(sync-impl): E-1 brief skeleton — 7 TODO blocks for Kyle
2b2adcc docs(sync-impl): re-shard E-1 brief into E-1a (Kyle picked Option B)
e92401d docs(sync-impl): E-1a audit + Kyle's Q1-Q3 resolutions baked in
10c84ce feat(sync): tests/index.html SW cache-poisoning bypass (E-1a, Phase 2)
<SHA>   docs(sync-impl): E-1a SESSION-LOG + PLAN.md status update
```

---

## 2026-05-13 — E-1b: startSteadyState scaffold + CAS wrapper

### What We Built

**Stage E-1b: steady-state merge-loop scaffold + per-record CAS wrapper.**
Second of five Stage E sub-PRs (Option B split per the E-1 kickoff).
Engine-only scaffolding — no per-store merge logic, no F3 / F8 / F15
wire-up, no UI surface. Ships ten files: (a)
`SyncEngine.startSteadyState()` / `stopSteadyState()` / `_runMergeCycle()`
in `js/sync-engine.js` — a `setInterval`-based dispatcher (default 30s,
clamped 10s–600s) that iterates the existing `SYNCED_STORES` registry,
invokes each store's `merge(snapshot)` inside a per-store try/catch so
one bad store can't abort the loop, and emits `merge-error` /
`merge-cycle-complete` events; (b) 4 new `js/sync-merge-{meds,history,rest-log,presets}.js`
IIFE stubs whose `merge()` body throws `not implemented until E-1{c,d,e}`
— they exist so the dispatcher is exercise-able in isolation; (c) the
real `SyncFirestore.runTransaction(fn)` CAS wrapper at
`js/sync-firestore.js` replacing B-3's stub at lines 284-285 — reads the
remote doc inside the transaction via `tx.get`, parses `schemaVersion`,
refuses writeback if `remote.schemaVersion > local SCHEMA_VERSION` (new
normalized error `kind: 'refuse-writeback'`), else writes the new
record; (d) extensions to `tests/sync-engine.test.js` (new
`describe('SyncEngine — startSteadyState')` block, ~16 cases) and
`tests/sync-uploader.test.js` (replaced the B-3 stub-throws block with
~7 CAS wrapper cases). Default-off — the steady-state timer is gated
behind a new `tempo_sync_steady_state_enabled` localStorage flag (strict
`=== '1'` equality, no Boolean coercion), so boot is byte-identical to
pre-E-1b when the flag is absent. CAS wrapper is web-only in E-1b;
native parity is a documented follow-up (the native branch throws an
explicit "native parity pending" normalized error). All 7 TODOs in
`docs/sync-impl/prompts/E-1b-PROMPT.md` resolved by Kyle on 2026-05-13
with the auditor's recommended pick for each — the RESOLUTIONS block at
the top of the brief is authoritative.

**Engine-implementer scope expansion precedent — third use.** E-1b's
affected-files table lists three paths outside the engine-implementer
agent's default allowed set: `index.html` (4 new `<script>` tags after
`sync-manual-dedupe.js`), `tests/index.html` (matching script tags so
test cases find the globals), and `sw.js` (CACHE_NAME bump v74 → v75 +
ASSETS additions for the 4 merge files). Per the precedent set by S0-1
(Firebase setup) and E-1a (`sw.js` + `tests/index.html` for the SW
cache-poisoning bypass), the Phase 2 dispatch brief carried the
verbatim override clause from `CLAUDE.md` "Known gaps / workflow TODOs":
*"If the dispatch brief's `Files in scope` list AND the audit's
affected-files table both explicitly enumerate a path outside the
default allowed set, treat the brief as authoritative for this PR."*
This is the third recorded use; the TODO in CLAUDE.md to bake the
mechanism into `.claude/agents/engine-implementer.md` is now well-past
the "two motivating cases" threshold.

### Verification result

- **Test count: 421 / 421 PASS** (baseline 396 + 25 new cases — 16 in
  `describe('SyncEngine — startSteadyState')` plus the replacement
  ~7-case `describe('E-1b SyncFirestore.runTransaction — CAS wrapper')`
  block plus 2 incidental adds elsewhere).
- **Verification method: Kyle's Cmd+Shift+R in Chrome incognito** at
  `http://localhost:8765/tests/index.html?fresh=verify` with E-1a's
  `?nosw=1` referrer-based SW bypass in effect — screenshots on record.
  The E-1a deliberate-broken-test reload regression check ran clean
  before the green baseline was accepted.
- **`sw.js` cache bump:** `stopwatch-v74-e1a-test-harness-fix` →
  `stopwatch-v75-e1b-steady-state-scaffold`. 4 new merge files added to
  `ASSETS`.
- **Audit:** `docs/sync-impl/audits/E-1b-AUDIT.md` (188 lines, 7 risks:
  all low — CAS atomicity, native plugin gap, dispatcher abort,
  boot-regression flag check, interval-clamp boundary, listener leak,
  cache-bump miss). Highest impact (Risk #1 CAS atomicity) mitigated by
  mandating `tx.get` inside the transaction body.

### Suggested Next Steps

- **E-1c** — D-1 reconcile retrofit wiring D-2's
  `MedsManager.reconcileDoseLog` into `SyncEngine.reconcileImportedBucket()`
  + replace the `sync-merge-meds.js` stub with the real meds metadata
  LWW + doseLog append-merge + F15 ≥2-entry remote-arrival counter (B-4
  owns the toast UI subscriber, plumbed from D-2's `onMergeComplete`
  hook surface).
- **E-1d** — Replace `sync-merge-history.js` stub with sessions
  append-merge dedup by `id` + note/tags LWW per-field + phaseLog
  dedup by `(deviceId, phaseStartedAt)`. Also lands F3 BFRB stream
  consolidation (unified `bfrb_events` with `context` tag) and F8
  distraction sessionId-keyed migration.
- **E-1e** — Replace `sync-merge-rest-log.js` + `sync-merge-presets.js`
  stubs with the real merge logic (sleep LWW per-day + naps
  append-merge; record LWW + `deletedAt` tombstones). Adds the per-store
  snapshot F19a gate (skip future-schema records before passing them to
  the merge function). Removes the dev-flag gate by auto-invoking
  `startSteadyState()` from `SyncEngine.init()` after hydrate completes.
- **Native CAS parity follow-up.** `runTransaction` is web-only in
  E-1b; native iOS Capacitor branch throws an explicit "native parity
  pending" error. Queue a follow-up PR for the
  `@capacitor-firebase/firestore` `runTransaction` shape before E-3
  listeners ship (or E-3 may force it sooner if listener integration
  needs CAS on native).

**Doc TODOs (carry forward from earlier sessions):**
- Patch `docs/sync-impl/FIREBASE-SETUP.md` to include the "Deploy
  firestore.rules via Console" step (bit Kyle during B-3 manual e2e).
- Amend `.claude/agents/engine-implementer.md` to make the brief-driven
  scope-expansion mechanism explicit — three motivating cases now on
  record (S0-1, E-1a, E-1b). Threshold long since crossed.

### Commits
```
0ecaff9 docs(sync-impl): E-1b brief skeleton — 7 TODO blocks for Kyle
b0d0374 docs(sync-impl): E-1b brief — Kyle's 7 TODO resolutions baked in
5537e2a docs(sync-impl): E-1b audit + Kyle's 7 TODO resolutions codified
23979cd feat(sync): startSteadyState scaffold + CAS wrapper (E-1b, Phase 2)
<SHA>   docs(sync-impl): E-1b SESSION-LOG + PLAN.md status update
```

---

## 2026-05-13 — E-1c: meds steady-state merge + D-1 retrofit + F15 counter

### What We Built

**Stage E-1c: first real per-store merge logic.** Third of five Stage E
sub-PRs (Option B split per the E-1 kickoff). Three deliverables in one
PR: (a) **`js/sync-merge-meds.js` real body** — replaces E-1b's
`throw new Error('not implemented until E-1c')` stub at lines 15-20
with ~360 LOC of real merge: resolve `uid` via
`SyncAuth.getCurrentUser()`, fetch cloud meds via
`SyncFirestore.getCollection('users/{uid}/meds')`, F19a per-record
pre-filter via `Schema.isFutureRecord(data)` (`skipped++` + warning +
continue), union cloud + local meds with LWW on the metadata envelope
(`name` / `dose` / `frequency` / `archivedAt`), per-med call D-2's
`MedsManager.reconcileDoseLog(med, cloudDoseEntries)` to collapse
±15-min cross-device duplicates (F1) and clamp clock-skewed entries
(F16), assign result.entries onto `med.doseLog` BEFORE calling
`MedsManager.onMergeComplete(med.id)` (F4 ordering — Risk #11), snapshot
the pre-merge doseLog and compute `newRemoteCount` as the diff against
it (the F15 idempotency-preserving predicate — Risk #7), per-record CAS
writeback via `SyncFirestore.runTransaction` (the E-1b wrapper), and
emit `meds-arrival` with `{ medId, count }` for any med where
`newRemoteCount >= 2` (F15 per-med per-cycle threshold — B-4's existing
toast subscriber renders it); (b) **F13 dispatcher-wide write gate** —
wraps `_runMergeCycle`'s per-store loop in
`try { SyncState.set('hydrating'); …loop…; emit('merge-cycle-complete') } finally { SyncState.set('ready'); _steadyRunInFlight = false; }`
so user writes are gated DURING the cycle (the existing entry-guard
gates the cycle's start). The `finally` block is the Risk #1 mitigation
— a throw inside the loop would otherwise leave `SyncState ===
'hydrating'` and permanently block local writes; (c) **D-1 reconcile
retrofit** — replaces the 9-line comment seam at `js/sync-engine.js:1278-1286`
(documented in D-2's brief as "deferred to E-1") with the actual
reconcile loop that walks `mergedMeds` post-`_mergeMeds()`, calls
`MedsManager.reconcileDoseLog` + `onMergeComplete` per med, and absorbs
errors per-med so one bad record doesn't abort the imported-bucket
flow. New test file `tests/sync-merge-meds.test.js` ships 16 cases (the
audit said 12-15; test #10 split into 10a/10b for the F13 success-path
vs exception-path sub-cases of the gate release assertion). E-1c is
engine-only: no UI files, no CSS, no `js/app.js` changes, default-off
behavior preserved — `tempo_sync_steady_state_enabled` stays the gate
through E-1c and E-1d; E-1e removes it.

**Engine-implementer scope expansion — now baked in.** E-1c is the
first PR to ship after PR #67 amended `.claude/agents/engine-implementer.md`
with the brief-driven scope-expansion clause (S0-1 + E-1a + E-1b were
the three motivating cases). The E-1c affected-files table lists
`tests/index.html` (one new `<script>` tag for the new test file) and
`sw.js` (CACHE_NAME bump v75 → v76) — both outside the default allowed
set. The Phase 2 dispatch brief did NOT need to carry a per-PR override
clause this time; the agent definition now handles it natively. All 7
TODOs in `docs/sync-impl/prompts/E-1c-PROMPT.md` were resolved by Kyle
on 2026-05-13 with the auditor's recommended pick for each (Pick A on
TODOs #1 / #3 / #4 / #6 + Pick B on TODO #2 + Pick C on TODO #5 + Pick
A on TODO #7 deferring per-store snapshot gate to E-1e) — the
RESOLUTIONS block at the top of the brief is authoritative.

### Verification result

- **Test count: 437 / 437 PASS** (baseline 421 + 16 new cases in
  `describe('SyncMergeMeds — merge')`).
- **Verification method: Kyle's Cmd+Shift+R in Chrome incognito** at
  `http://localhost:8765/tests/index.html?fresh=verify` with E-1a's
  `?nosw=1` referrer-based SW bypass in effect — screenshots on record.
- **Mid-run test bug found + fixed.** Test #12 in `tests/sync-merge-meds.test.js`
  conflated F1 (cross-device ±15-min collapse) with F16 (clock-skew
  clamp) — the assertion was checking for the wrong helper's behavior.
  Engine-tester surfaced it on the first browser load; fix landed in
  follow-up commit `1319b89` (test file only, zero engine changes); the
  re-verified 437/437 green baseline was accepted after.
- **`sw.js` cache bump:** `stopwatch-v75-e1b-steady-state-scaffold` →
  `stopwatch-v76-e1c-meds-merge`. No `ASSETS` list changes —
  `sync-merge-meds.js` was added to the manifest in E-1b's bump.
- **Audit:** `docs/sync-impl/audits/E-1c-AUDIT.md` (8 risks: 5 low + 3
  med; highest single-event impact is Risk #1 SyncState-stuck-in-hydrating,
  mitigated by mandating try/finally; most data-sensitive is Risk #4
  F19a-comparison-inversion, mitigated by mandating
  `Schema.isFutureRecord(data)`; most user-visible is Risk #7
  idempotency-double-counting, mitigated by the pre-merge snapshot
  pattern).

### Suggested Next Steps

- **E-1d** — Replace `sync-merge-history.js` stub with sessions
  append-merge dedup by `id` + note/tags LWW per-field + phaseLog
  dedup by `(deviceId, phaseStartedAt)`. Also lands F3 BFRB stream
  consolidation (unified `bfrb_events` with `context` tag) and F8
  distraction sessionId-keyed migration. Same per-store-test-file
  pattern as E-1c.
- **E-1e** — Replace `sync-merge-rest-log.js` + `sync-merge-presets.js`
  stubs with the real merge logic (sleep LWW per-day + naps
  append-merge; record LWW + `deletedAt` tombstones). Adds the per-store
  snapshot F19a gate (skip future-schema records before passing them to
  the merge function — Pick A on E-1b TODO #7 deferred to E-1e).
  Removes the dev-flag gate by auto-invoking `startSteadyState()` from
  `SyncEngine.init()` after hydrate completes.
- **Native CAS parity follow-up.** `runTransaction` is still web-only
  after E-1c (E-1b shipped the web branch + a "native parity pending"
  throw on the native branch). The first cycle of real cross-device
  meds sync exercises CAS in production — queue the Capacitor follow-up
  before E-3 listeners ship.

**Doc TODOs (carry forward from earlier sessions):**
- Patch `docs/sync-impl/FIREBASE-SETUP.md` to include the "Deploy
  firestore.rules via Console" step (bit Kyle during B-3 manual e2e).

### Commits
```
1f92a84 docs(sync-impl): E-1c brief skeleton — 7 TODO blocks for Kyle
dd250fa docs(sync-impl): E-1c brief — Kyle's 7 TODO resolutions baked in
3ff2270 docs(sync-impl): E-1c audit + Kyle's 7 TODO resolutions codified
9966b99 feat(sync): meds steady-state merge + D-1 retrofit + F15 counter (E-1c, Phase 2)
03bf64a fix(tests): correct test #12 in sync-merge-meds — F1 vs F16 conflation
<SHA>   docs(sync-impl): E-1c SESSION-LOG + PLAN.md status update
```

---

## 2026-05-14 — E-1d: history steady-state merge (sessions only)

### What We Built

**Stage E-1d: history steady-state merge — sessions only.** Fourth of
the (now) seven Stage E sub-PRs. Replaces E-1b's stub body in
`js/sync-merge-history.js` (~310 LOC of real merge): resolve `uid` via
`SyncAuth.getCurrentUser()`, fetch cloud sessions via
`SyncFirestore.getCollection('users/{uid}/history')`, F19a per-record
pre-filter via `Schema.isFutureRecord(data)` (`skipped++` + warning +
continue), union cloud + local sessions with whole-record LWW on the
metadata envelope (note + tags LWW the whole record per TODO #2
deferral — per-field stamping in `js/history.js` is a separate
follow-up), tombstone-aware delete propagation, and per-record CAS
writeback via E-1b's `SyncFirestore.runTransaction`. Default-off
behavior preserved — `tempo_sync_steady_state_enabled` still gates the
cycle; E-1e removes the dev-flag gate.

**Stage E sub-PR count: 5 → 7 (scope split on TODO #1).** Pick B on
E-1d TODO #1 split off F3 BFRB stream consolidation (unified
`bfrb_events` with `context` tag) into **E-1d-f3** and F8 distraction
sessionId-keyed migration into **E-1d-f8** — both deferred as separate
sub-PRs after E-1d, before E-1e. The original E-1d brief tried to ship
all three in one PR; the scope-discipline pick keeps each merge surface
isolated and audit-shaped (one engine + one test file + one audit per
PR). Pick B on TODO #4 keeps `meds-arrival` as the only F15 emit for
this PR — `sessions-arrival` is not added; the existing meds-arrival
toast subscriber is sufficient signal until BFRB and distractions land.
No changes to `js/sync-engine.js` (E-1c's F13 gate already in place);
no changes to `js/history.js` (TODO #2 deferral).

**Engine-implementer scope expansion — fifth use, first time clean.**
E-1d's affected-files table lists `tests/index.html` (one new
`<script>` tag) + `sw.js` (CACHE_NAME bump v76 → v77) — both outside
the default allowed set. After PR #67 baked the brief-driven
scope-expansion clause into `.claude/agents/engine-implementer.md`, the
Phase 2 dispatch brief did NOT need a per-PR override citation this
time (E-1c was the first natively-scoped run; E-1d is the first where
the citation footprint disappeared entirely from the brief copy). All
7 TODOs in `docs/sync-impl/prompts/E-1d-PROMPT.md` were resolved by
Kyle on 2026-05-13 — RESOLUTIONS block at the top of the brief is
authoritative.

### Verification result

- **Test count: 454 / 454 PASS** (baseline 437 + 17 new cases in
  `describe('SyncMergeHistory — sessions merge')`; the audit said
  12-15, the test file ran longer to cover the tombstone + LWW
  whole-record cases).
- **Verification method: kapture-driven browser load** at
  `http://localhost:8765/tests/index.html?fresh=verify` — **first try
  PASS, no hard-reload needed** (E-1a's referrer-based SW bypass
  continues to do its job).
- **`sw.js` cache bump:** `stopwatch-v76-e1c-meds-merge` →
  `stopwatch-v77-e1d-history-merge`. No `ASSETS` list changes —
  `sync-merge-history.js` was added to the manifest in E-1b's bump.
- **Audit:** `docs/sync-impl/audits/E-1d-AUDIT.md` (TODO #1 Pick B scope
  split is the largest deviation from the original E-1 brief; all
  remaining risks carry forward from E-1c's risk register — same
  merge-loop shape, different store).

### Suggested Next Steps

- **E-1d-f3** — Land F3 BFRB stream consolidation. Unify
  `bfrbs_global` / `flow_bfrbs` / `pomodoro_bfrbs` into a single
  `bfrb_events` synced collection with a `context: 'global' | 'flow' |
  'pomodoro'` tag. Append-merge dedup by `(deviceId, capturedAt)`. Same
  per-store-test-file pattern.
- **E-1d-f8** — Land F8 distraction sessionId-keyed migration.
  Re-key existing distraction entries by parent sessionId so cloud
  merge can append-and-tombstone without ambiguity. Migration runs
  once via the existing per-store hydrate markers.
- **E-1e** — Replace `sync-merge-rest-log.js` + `sync-merge-presets.js`
  stubs with real merge logic (sleep LWW per-day + naps append-merge;
  record LWW + `deletedAt` tombstones). Adds the per-store snapshot
  F19a refuse-writeback gate. Removes the dev-flag gate by
  auto-invoking `startSteadyState()` from `SyncEngine.init()` after
  hydrate completes.
- **Native CAS parity follow-up.** `runTransaction` is still web-only
  after E-1d (native branch still throws). E-1d adds the second store
  exercising CAS in production — queue the Capacitor follow-up before
  E-3 listeners ship.

**Doc TODOs (carry forward from earlier sessions):**
- Patch `docs/sync-impl/FIREBASE-SETUP.md` to include the "Deploy
  firestore.rules via Console" step (bit Kyle during B-3 manual e2e).
- Update `js/history.js` per-field stamping (TODO #2 deferral from
  E-1d) — currently sessions LWW the whole record. Per-field stamping
  for `note` vs `tags` is a future enhancement once the cross-device
  edit-collision pattern is observed in practice.

### Commits
```
c887ad8 docs(sync-impl): E-1d brief skeleton — 7 TODO blocks for Kyle
79d2a01 docs(sync-impl): E-1d brief — Kyle's 7 TODO resolutions baked in
2888ee6 docs(sync-impl): E-1d audit + Kyle's 7 TODO resolutions codified
ad8dc67 feat(sync): history steady-state merge — sessions only (E-1d, Phase 2)
<SHA>   docs(sync-impl): E-1d SESSION-LOG + PLAN.md status update
```

---

## 2026-05-14 — E-1d-f3: F3 BFRB stream consolidation (migration + UI + sync wiring)

### What We Built

**Stage E-1d-f3: F3 BFRB stream consolidation.** Fifth of the seven
Stage E sub-PRs and the first Stage E PR with UI surface changes —
hence the first Phase 4 ui-wirer fire in Stage E. Adds a new
`js/bfrb-events.js` module (~395 LOC) that owns a single `bfrb_events`
localStorage stream, replacing the three legacy buckets
(`bfrbs_global` / `flow_bfrbs` / `pomodoro_bfrbs`) as the single source
of truth for BFRB sync. Each entry stamps `{ takenAt, context,
sessionId?, phase?, cycleIndex?, deviceId, updatedAt, schemaVersion }`
via `Schema.stampWrite`; `context ∈ 'global' | 'flow' | 'pomodoro'`
preserves the bucket distinction inside the unified stream. A phased
migration (Pick B on TODO #1) runs once on module init, gated by a
`tempo_bfrb_events_migration_v1` localStorage marker — union the three
legacy arrays, stamp, write to `bfrb_events`, set marker `'1'`. Legacy
keys retained for one release pending a deferred cleanup PR (Pick C on
TODO #5, no schedule yet). Adds `bfrb_events` as the 5th
`SYNCED_STORES` entry in `js/sync-engine.js` + a new
`js/sync-merge-bfrb.js` per-store merge fn (~244 LOC) doing
append-merge dedup keyed by `(deviceId, takenAt)`. Updates 4 UI
surfaces — `js/global-bfrb.js` (FAB routes through `BfrbEvents.log()`
+ reads `countToday`/`getByContext`), `js/flow-ui.js` +
`js/pomodoro-ui.js` (session counters filter by current session's
`sessionStartedAt` instead of reading the legacy array directly), and
`js/analytics.js` (BFRB-trend chart reads `BfrbEvents.getAll()` with a
context→legacy-source mapping).

**Phase 4 ui-wirer fired — first Stage E PR with verified UI
surfaces.** Four surfaces verified via kapture + Kyle's manual session
counter check: FAB live count, Flow session counter (BFRB ×2), Pomo
session counter (BFRB ×3→×5 across cycles), Analytics BFRB-trend chart
post-migration. Zero console errors. The auto-applying scope-expansion
clause from PR #67 fired cleanly for **three paths simultaneously** —
`index.html` (new `<script>` tag) + `tests/index.html` (new `<script>`
tag) + `sw.js` (CACHE_NAME bump v77 → v78 + 2 new ASSETS entries).
Sixth use of the clause overall and first time it covered three
brief-listed paths in a single PR with zero override copy.

### Verification result

- **Test count: 476 / 476 PASS** (baseline 454 + 22 new cases — 10 in
  `tests/bfrb-events.test.js`, 12 in `tests/sync-merge-bfrb.test.js`).
- **Verification method: Kyle Cmd+Shift+R on `tests/index.html`.**
  Engine-tester reported PASS first; Kyle's hard reload re-ran to
  confirm post-cache-bump.
- **Phase 4 verification:** kapture-driven boot of `index.html`, FAB
  click → `BFRB ×1`; manual session-flow verification (start Flow
  block → `BFRB ×2` after two taps; start Pomo → `BFRB ×3` first
  cycle, `BFRB ×5` after second cycle). Analytics surface renders the
  trend chart with the migrated entries.
- **Mid-run test-stub fix.** During Phase 3, adding the 5th
  `SYNCED_STORES` entry broke six F13 dispatcher tests in
  `tests/sync-merge-meds.test.js` + `tests/sync-merge-history.test.js`
  (they instantiated `SyncEngine` and the dispatcher expected
  `SyncMergeBfrb.merge` to exist). Patched via commit `422a09e` with
  a stubbed `SyncMergeBfrb.merge` in those test files — test-only
  collateral, no engine impact.
- **`sw.js` cache bump:** `stopwatch-v77-e1d-history-merge` →
  `stopwatch-v78-e1d-f3-bfrb-consolidation`. ASSETS list gained
  `js/bfrb-events.js` + `js/sync-merge-bfrb.js`.
- **Audit:** `docs/sync-impl/audits/E-1d-f3-AUDIT.md` (10 risks —
  7 low / 3 med / 0 high). Med-risk items: (1) phased-migration
  idempotency under tab-close race, (2) legacy-key retention window
  with no scheduled cleanup, (3) analytics context-mapping correctness
  for pre-migration entries.

### Suggested Next Steps

- **E-1d-f8** — Land F8 distraction sessionId-keyed migration. Re-key
  existing distraction entries by parent sessionId so cloud merge can
  append-and-tombstone without ambiguity. Migration runs once via the
  existing per-store hydrate markers. Same per-store-test-file pattern
  as E-1d-f3 — minus the new UI counters (distraction surfaces already
  filter by sessionId).
- **E-1e** — Replace `sync-merge-rest-log.js` + `sync-merge-presets.js`
  stubs with real merge logic. Adds the per-store snapshot F19a
  refuse-writeback gate. Removes the dev-flag gate by auto-invoking
  `startSteadyState()` from `SyncEngine.init()` after hydrate
  completes. After E-1e, Stage E is fully shipped (7/7 sub-PRs).
- **Deferred legacy-key cleanup PR.** Once one release of E-1d-f3 has
  bedded in, drop the three legacy buckets (`bfrbs_global` /
  `flow_bfrbs` / `pomodoro_bfrbs`) and the migration marker. No
  schedule per Pick C on TODO #5 — file as tech-debt entry, schedule
  after a real-world soak.
- **Native CAS parity follow-up** (carry forward). `runTransaction` is
  still web-only after E-1d-f3 (native branch still throws). Queue the
  Capacitor follow-up before E-3 listeners ship.

**Doc TODOs (carry forward from earlier sessions):**
- Patch `docs/sync-impl/FIREBASE-SETUP.md` to include the "Deploy
  firestore.rules via Console" step.
- Update `js/history.js` per-field stamping (TODO #2 deferral from
  E-1d) — currently sessions LWW the whole record.

**Stage E progress: 5 of 7 sub-PRs shipped** (E-1a / E-1b / E-1c /
E-1d / E-1d-f3 done; E-1d-f8 + E-1e remaining).

### Commits
```
f1ed7e1 docs(sync-impl): E-1d-f3 brief skeleton — 7 TODO blocks for Kyle
6e62eb2 docs(sync-impl): E-1d-f3 brief — Kyle's 5 TODO resolutions baked in
bc67c44 docs(sync-impl): E-1d-f3 audit + Kyle's 5 TODO resolutions codified
f3e6206 feat(sync): F3 BFRB stream consolidation (E-1d-f3, Phase 2)
7da3f28 fix(tests): stub SyncMergeBfrb.merge in F13 dispatcher tests
<SHA>   docs(sync-impl): E-1d-f3 SESSION-LOG + PLAN + CLAUDE.md status update
```

---

## 2026-05-14 — E-1d-f8: F8 distraction sessionId-keyed migration (migration + UI + sync wiring)

### What We Built

- **F8 distraction sessionId-keyed migration.** The Flow + Pomo
  distraction logs moved from flat arrays under `flow_distractions`
  / `pomodoro_distractions` to sessionId-keyed maps
  (`{ [sessionId]: [entries] }`) so cloud merge can append-and-
  tombstone unambiguously. Each entry now carries
  `{ category, note?, timestamp, deviceId, updatedAt, schemaVersion }`.
  Phased migration runs once on first load post-upgrade; idempotency
  marker `tempo_distractions_migration_v1='1'` short-circuits all
  subsequent boots. Pre-migration entries without a parent sessionId
  land under a stable orphan-key fallback.
- **New module — `js/distractions.js` (~482 LOC).** Owns the keyed
  map abstraction: `add()` / `getForSession()` / `getAll()` /
  `setAll()` plus the `_runMigration` boot hook. Prefers
  `window.Flow` / `window.Pomodoro` over bare const-binding so test
  stubs at `window.*` resolve correctly (fixed mid-Phase-3 via
  commit `fa06683` — bare reads were invisible to the test stubs).
- **New module — `js/sync-merge-distractions.js` (~255 LOC).** Per-
  store merge function for the 6th `SYNCED_STORES` entry. Treats the
  sessionId-keyed map as a union per session: per-key append-and-
  tombstone, F1 ±15-min cross-device dedup within a single session,
  F16 ±15-min clock-skew clamp on `timestamp`, F19a future-schema
  skip.
- **UI rewires (`js/flow-ui.js` + `js/pomodoro-ui.js`).** Eight call
  sites total updated to read/write via `Distractions.*` API instead
  of touching localStorage directly. Distraction pickers render from
  the current session's bucket; Phase 4 ui-wirer verified both Flow
  + Pomo pickers boot clean with zero console errors.
- **Persistence semantic widened (`js/persistence.js`).** The app-
  mode-change clear path now uses `clearAllForContext` so leaving
  Flow/Pomo no longer nukes the entire keyed map — only entries for
  the departing context's sessionId range. Required to keep
  cross-mode distraction history intact.
- **Sync registry — `js/sync-engine.js`.** Added `distractions` as
  the 6th `SYNCED_STORES` entry. `tests/sync-engine.test.js`
  assertions updated from 5→6 stores (6 cases touched).
- **Export header comments (`js/export.js`).** Header comments only
  — the map already round-trips through `JSON.stringify` so no
  shape change needed.
- **Test coverage.** New `tests/distractions.test.js` (12 cases) +
  `tests/sync-merge-distractions.test.js` (13 cases). Plus six F13
  dispatcher tests in `tests/sync-merge-meds.test.js` +
  `tests/sync-merge-history.test.js` patched with stubbed
  `SyncMergeDistractions.merge` (test-only collateral, no engine
  impact). **PASS 501/501 via kapture after the mid-run fix.**
- **`sw.js` cache bump:** `stopwatch-v78-e1d-f3-bfrb-consolidation`
  → `stopwatch-v79-e1d-f8-distractions-migration`. ASSETS list
  gained `js/distractions.js` + `js/sync-merge-distractions.js`.
- **Audit:** `docs/sync-impl/audits/E-1d-f8-AUDIT.md` — Kyle's 7
  TODO resolutions codified.

### Suggested Next Steps

- **E-1e** — Last Stage E sub-PR. Replace
  `sync-merge-rest-log.js` + `sync-merge-presets.js` stubs with real
  merge logic. Adds the per-store snapshot F19a refuse-writeback
  gate. Removes the dev-flag gate by auto-invoking
  `startSteadyState()` from `SyncEngine.init()` after hydrate
  completes. After E-1e, Stage E is fully shipped (7/7 sub-PRs).
- **Deferred legacy-key cleanup PRs (carry forward).** One soak
  release after E-1d-f3 / E-1d-f8 each, drop legacy keys
  (`bfrbs_global` / `flow_bfrbs` / `pomodoro_bfrbs` and any pre-
  migration flat-array distraction shape) plus migration markers.
  File as tech-debt; no fixed schedule.
- **Native CAS parity follow-up** (still carry forward).
  `runTransaction` is web-only; queue Capacitor branch before E-3
  listeners ship.

**Doc TODOs (carry forward from earlier sessions):**
- Patch `docs/sync-impl/FIREBASE-SETUP.md` to include the "Deploy
  firestore.rules via Console" step.
- Update `js/history.js` per-field stamping (TODO #2 deferral from
  E-1d) — currently sessions LWW the whole record.

**Stage E progress: 6 of 7 sub-PRs shipped** (E-1a / E-1b / E-1c /
E-1d / E-1d-f3 / E-1d-f8 done; only E-1e remaining).

### Commits
```
e5f2608 docs(sync-impl): E-1d-f8 brief skeleton — 7 TODO blocks for Kyle
0756d3d docs(sync-impl): E-1d-f8 brief — Kyle's 7 TODO resolutions baked in
59f1e09 docs(sync-impl): E-1d-f8 audit + Kyle's 7 TODO resolutions codified
24ad66e feat(sync): F8 distraction sessionId-keyed migration (E-1d-f8, Phase 2)
fa06683 fix: distractions migration window.* reads + 6-store stub patches
<SHA>   docs(sync-impl): E-1d-f8 SESSION-LOG + PLAN + CLAUDE.md status update
```

---

## 2026-05-14 — E-1e: rest_log + presets merge + per-store F19a + sync goes live (Stage E 7/7 SHIPPED)

### What We Built

Five deliverables in one PR that flips steady-state cloud sync from
"dormant behind dev flag" to "default-on for any user with the master
flag set." **E-1e is the seventh and FINAL Stage E sub-PR.** After this
merges + Kyle flips `tempo_sync_enabled='1'` on both devices, the
"fully cloud-synced bug-free between laptop and phone" outcome that
opened this initiative is real for the steady-state polling path.

- **Real `js/sync-merge-rest-log.js` (~283 LOC).** Replaces the throwing
  stub from E-1b. Per-day sleep LWW by `updatedAt` (absent treated as
  `-Infinity` so the stamped side always wins — Risk #1) + naps
  append-merge dedup by `(deviceId, startedAt)` (fallback sig
  `'no-device@<startedAt>'` for pre-E-1e naps without `deviceId` —
  Risk #2). One Firestore doc per `YYYY-MM-DD` key. Per-record F19a
  cloud-side pre-filter + per-record CAS writeback (`runTransaction`)
  with per-record try/catch — refuse-writeback → `skipped++` + warning
  + continue. Mirrors `js/sync-merge-bfrb.js`'s self-contained pattern.
- **Real `js/sync-merge-presets.js` (~253 LOC).** Replaces the throwing
  stub. Full-record LWW by `(id, updatedAt)` + tombstone propagation
  (`deletedAt` field — cloud-deleted wins on pull, local-deleted wins
  on CAS push, both-deleted-newer-wins). Comparison uses `== null`
  (catches both `undefined` and `null` but NOT `0`/`''`) per Risk #8.
  Per-record F19a + per-record CAS writeback. Mirrors
  `js/sync-merge-history.js`'s pattern.
- **`js/presets.js` rewritten on four fronts (additive schema —
  no SCHEMA_VERSION bump per Pick A on TODO #2).** `remove(id)` now
  sets `target.deletedAt = Date.now()` + `Schema.stamp(target)` +
  `saveAll(presets)` instead of hard-filtering — tombstone soft-delete.
  `getAll()` filters tombstones via `.filter(p => p.deletedAt == null)`
  so the UI never sees deleted records. New `_getAllIncludingTombstones()`
  sibling helper for the sync snapshot adapter (UI must never call it).
  `snapshotForSync()` swapped to use the new helper so cloud propagates
  tombstones.
- **`js/recovery-ui.js` gains envelope stamping at two write sites.**
  `setSleep` now stamps `sleep` via `Schema.stamp` before persisting.
  `addNap` stamps the nap AND backfills `deviceId` via
  `History.getDeviceId()` (typeof-guarded fallback to `'unknown-device'`
  for tests that don't load `history.js`). Today's writes had no
  envelope stamps; the new merge function's sleep LWW + naps dedup
  need them. New `_reconcileWriteRaw` helper added for the merge
  writeback path (parallel to existing `_hydrateWriteRaw`).
- **`js/sync-engine.js` — three surgical edits.** **(1) F19a
  dispatcher snapshot gate (Pick C on TODO #4):** new
  `_filterFutureRecordsInSnapshot(key, snapshot)` helper called from
  `_runMergeCycle()` BEFORE each per-store merge fn. Walks payload per
  store key, filters future-schema records, logs skip counts via
  `console.warn` for observability. Existing per-merge-fn cloud-side
  gates STAY — two layers, different vectors. **(2) Dev flag removal
  (Pick A on TODO #5):** delete `STEADY_STATE_ENABLED_KEY` constant +
  `_isSteadyStateEnabled()` function + the gate check inside
  `startSteadyState()`. **(3) Auto-invoke (Pick C on TODO #6):** new
  `_maybeAutoStartSteady(user)` helper gates on all 4 conditions
  (signed-in + `SyncFlag.isEnabled()` + `isAllHydrated()` + no Stage D
  handoff). Called from BOTH `init()` end (cold-boot: marker already
  set, user already signed in via SDK rehydrate) AND
  `_maybeAutoHydrate.then()` post-hydrate block (first-sign-in:
  hydrate just completed, marker just got set). Idempotent via
  `startSteadyState`'s existing `if (_steadyTimer != null) return;`
  guard. NO call from inside the `.catch()` block — a failed hydrate
  must NOT auto-arm steady-state.
- **Phase 3 testing — 543/543 pass via kapture (fresh-origin port
  8766).** Three mid-Phase-3 failure-and-fix cycles before greenwave:
  **(a) Cache poisoning:** initial run via port 8765 returned stale
  pre-E-1e bytes — fixed by hopping to a fresh-origin port 8766 +
  hard-reload. **(b) Test #12 audit inconsistency:** the audit
  documented "only null/undefined alive" but test #12 initially asserted
  `0`/`''` were alive — rewritten to match engine semantics (`p.deletedAt
  == null` predicate hides `0`/`''` as tombstones per Risk #8). **(c)
  Visibility helper override:** kapture's iframe loader hides the test
  output container; added a visibility helper override so the in-browser
  asserts surface their results. Final: **543/543 pass**.
- **Phase 4 ui-wirer SMOKE-ONLY (Pick A on TODO #8).** Third
  invocation in Stage E. NO edits — verification only. Confirmed:
  fresh boot path clean + 0 console errors + master flag toggle works
  + Cloud Sync drawer renders + neighbor route renders. `CACHE_NAME`
  verified at `stopwatch-v80-e1e-stage-e-complete`. Dev flag fully
  removed.
- **Orchestrator sandbox branch pattern.** This PR ran on
  `claude/orchestrator-e1e` as the orchestrator's scratch space —
  the brief + audit landed there first (commits `530b212`, `33adf7e`,
  `92201f8`), then the feat branch `feat/sync-stage-e-complete` was
  created from that sandbox so it inherits the audit + brief commits
  + carries the engine/test changes forward. Sandbox branch is NOT
  merged.
- **`sw.js` cache bump:** `stopwatch-v79-e1d-f8-distractions-migration`
  → `stopwatch-v80-e1e-stage-e-complete`. No `ASSETS` list changes —
  both merge files already exist on disk and were precached in E-1b.
- **Audit:** `docs/sync-impl/audits/E-1e-AUDIT.md` — all 8 Kyle
  resolutions codified (Picks A/A/A/C/A/C/A/A).
- **8th use of the brief-driven scope-expansion clause**
  (`.claude/agents/engine-implementer.md` lines 30-44). Paths
  covered: `tests/index.html` (2 new `<script>` tags) + `sw.js`
  (CACHE_NAME bump). Both explicitly enumerated in the audit AND
  the brief.

### Suggested Next Steps

- **Kyle's two-device manual validation post-merge.** Sign in on
  phone + laptop with `tempo_sync_enabled='1'`. Edit a preset on
  phone; verify propagation to laptop within 30s. Log a nap on
  laptop; verify it appears on phone. Delete a preset on phone;
  verify tombstone propagates and the preset disappears from laptop.
  This is the real E2E check that closes out the initiative.
- **Quota verification.** Spark plan free tier is 50k reads/day.
  Two dev devices polling 30s × 6 stores ≈ ~34k reads/day. Margin
  is tight — if quota becomes a real problem post-launch, the 30s
  interval at `STEADY_STATE_DEFAULT_MS` is a one-line bump.
- **E-2 (offline buffer).** Steady-state polling currently silently
  drops writes during offline windows. E-2 adds a buffer.
- **E-3 (real-time `onSnapshot` listeners).** Drops polling latency
  from <30s to <1s and eliminates polling read costs entirely.
- **Deferred legacy-key cleanup PRs (carry forward).** One soak
  release after E-1d-f3 / E-1d-f8 each, drop legacy buckets
  (`bfrbs_global` / `flow_bfrbs` / `pomodoro_bfrbs`, pre-migration
  flat-array distractions) plus migration markers. File as
  tech-debt; no fixed schedule.
- **Native CAS parity follow-up** (still carry forward).
  `runTransaction` is web-only; queue Capacitor branch before E-3
  listeners ship.
- **Backlog GC for preset tombstones.** When accumulated
  `deletedAt < (now - 90 days)` records become observable (e.g., a
  user with 200+ deleted presets), add a periodic purge. Not in
  scope for E-1e.

**Doc TODOs (carry forward from earlier sessions):**
- Patch `docs/sync-impl/FIREBASE-SETUP.md` to include the "Deploy
  firestore.rules via Console" step.
- Update `js/history.js` per-field stamping (TODO #2 deferral from
  E-1d) — currently sessions LWW the whole record.

**Stage E progress: 7 of 7 sub-PRs SHIPPED.** Initiative milestone
reached.

### Commits
```
530b212 docs(sync-impl): E-1e brief skeleton with 8 TODO blocks
33adf7e docs(sync-impl): E-1e RESOLUTIONS codified (Kyle, all 8 TODOs)
92201f8 docs(sync-impl): E-1e audit (sync-auditor Phase 1)
<SHA>   feat(sync): rest_log + presets merge + per-store F19a + sync goes live (E-1e)
<SHA>   docs(sync-impl): move E-1e to shipped, mark Stage E 7/7 complete
```

---

## 2026-05-15 — E-2: offline buffer + Platform.network shim (Stage E reliability follow-up 1/2)

### What We Built

Stage E shipped end-to-end last session, but two reliability caveats
remained on the table: (1) buffered ops while offline silently
dropped, and (2) `setInterval` polling unreliable when tabs unfocus
(Chrome throttles; iOS Safari suspends). E-2 closes the offline-write
gap with a pending-op queue in a dedicated IDB DB + a new
`Platform.network` shim; E-3 (real-time listeners) is the proper fix
for the polling caveat and lands next.

- **New `js/sync-buffer.js` (~441 LOC IIFE).** Owns a new IndexedDB
  database `tempo_sync_db v1` with a single `pending_ops` object store
  (`keyPath: 'id'` autoincrement + `enqueuedAt` index). Public API:
  `enqueue({ store, recordId, originalWallClock })`, `drain()`,
  `count()`, `_open()`. Hard cap at `PENDING_OP_CAP = 1000` ops; on
  overflow, evicts oldest by `enqueuedAt` ascending and emits
  `SyncEngine.emit('buffer-overflow', { droppedCount })`. Per-field-LWW
  op compaction over 4 chatty stores
  (`history-note` / `history-tags` / `rest_log-sleep` / `presets`) — if
  the queue already contains a pending op for the same `(store,
  recordId)` and the store is in `COMPACTABLE_STORES`, the older op is
  replaced (saves quota on rapid edits).
- **New `js/sync-toast.js` (~141 LOC IIFE).** First real cloud-sync
  visible toast surface. `Toast.bufferOverflow(droppedCount)` paints a
  `.sync-toast` div at module init with the verbatim PLAN.md copy
  ("Buffered changes exceeded cap; oldest changes lost — please
  re-sync."), auto-dismisses after 5s with a 200ms fade. DOM idiom
  mirrors the existing undo-toast in `js/ui.js:354-462`. Module init
  registers `SyncEngine.on('buffer-overflow', ...)` so the listener is
  live as soon as `sync-toast.js` loads. `Toast.medsArrival` deferred
  with a TODO marker per scope decision (B-4 ticket carries forward).
- **`js/platform.js` extension (+148 LOC).** New
  `Platform.network = { isOnline, onChange }` namespace mirroring the
  existing `Platform.auth` web-vs-native pattern. Web branch uses
  `navigator.onLine` + `window 'online'/'offline'` events. Native
  branch routes to `window.Capacitor.Plugins.Network`
  (`@capacitor/network@^6.0.0` newly installed via `npm install` +
  `npx cap sync ios` to regen `ios/App/Podfile`). The engine-side
  `Platform.network.onChange` block in `js/sync-engine.js` was wired
  back in E-1b but dormant — it activates retroactively now that the
  shim lands.
- **`js/sync-engine.js` extensions (~180 LOC added across 4 surgical
  edits).** Dispatcher-level offline-branch in `_runMergeCycle`:
  enumerates dirty records per synced store via the new
  `_enqueueDirtyRecordsForStore` helper + the `_maybeBufferOnOffline`
  early-return gate; on the online path (current default), behaves
  exactly as before. Online-event drain trigger lands inside the
  existing `Platform.network.onChange` block — one-line `SyncBuffer.drain()`
  call. Steady-state pause-on-offline + resume-on-online behavior
  activates retroactively.
- **+22 tests** (baseline 543 → 565, all passing via kapture on a
  fresh-origin port 8767 to bypass cache poisoning).
  `tests/sync-buffer.test.js` (14 new cases): compaction, FIFO,
  cap-overflow + buffer-overflow emit, cross-restart persistence,
  IDB-unavailable fast-path, `SYNC_DISABLED` + unauthenticated
  short-circuits, per-store dedup. `tests/sync-engine.test.js`
  extension (8 new cases): dispatcher offline-branch hook fires
  `SyncBuffer.enqueue`, online-event drain trigger, no-op when
  flag-off / signed-out, F13 gate coordination,
  `Platform.network` feature-detect, drain-failure non-fatal in
  online handler, toast listener integration.
- **`sw.js` bump:** `stopwatch-v80-e1e-stage-e-complete` →
  `stopwatch-v81-e2-offline-buffer`; two new `ASSETS` entries
  (`./js/sync-buffer.js` + `./js/sync-toast.js`).
- **9th use of the brief-driven scope-expansion clause**
  (`.claude/agents/engine-implementer.md` lines 30-44). Paths covered:
  `tests/index.html` (3 new `<script>` tags) + `sw.js` (CACHE_NAME +
  ASSETS) + `package.json` + `package-lock.json` + `ios/App/Podfile` +
  `index.html` (2 new script tags) + `css/styles.css` (`.sync-toast`
  rule block). All explicitly enumerated in both the audit and the
  brief.
- **Orchestrator sandbox branch pattern.** Sandbox branch
  `claude/orchestrator-e2` carried the brief skeleton (`164ca99`),
  resolutions (`ce9cd74`), and audit (`0be15e9`) before the feat
  branch `feat/sync-stage-e2-offline-buffer` was created from it. The
  3 sandbox commits ride along to main with the feat merge; the
  sandbox itself is not merged.

### Suggested Next Steps

- **E-3 (real-time `onSnapshot` listeners).** Closes caveat (a) at the
  source — drops polling latency from <30s to <1s and eliminates the
  iOS-Safari-suspends-`setInterval` reliability gap. Includes the
  downlevel-client warning toast (`Toast.downlevelWarning`) and a
  per-store subscribe-on-hydrate registry. Last big sync work item.
- **Caveat (b) cleanup PR.** Distinguish "first sync" from "force
  re-sync" in B-3's read-cloud-first guard so Stage D handoff stops
  re-firing on every manual "Push to cloud" attempt after first push.
- **Caveat (c) cleanup PR.** Wire a UI re-render hook into
  `SyncEngine.on('merge-complete', ...)` so the Presets drawer (and
  similar surfaces) refreshes without close + reopen. E-3 listeners +
  this hook are complementary — both should land together.
- **Caveat (d) cleanup PR.** Coalesce the 12-per-cycle
  `[SyncEngine] reconcile history sessionId collision (cloud wins)`
  log spam in `js/sync-merge-history.js` into a single summary line.
  Small warm-up PR.
- **Backlog GC.** Drop legacy `bfrbs_global` / `flow_bfrbs` /
  `pomodoro_bfrbs` buckets + `tempo_bfrb_events_migration_v1` marker
  (E-1d-f3 carry-over); drop pre-migration flat-array distractions +
  `tempo_distractions_migration_v1` marker (E-1d-f8 carry-over). No
  fixed schedule.
- **Native CAS parity follow-up.** `runTransaction` is still web-only
  (queued from E-1b). Worth queuing the Capacitor branch before E-3
  listeners ship.
- **Kyle's two-device manual validation for E-2.** Phone DevTools →
  Network → "Offline"; log a dose; confirm `SyncBuffer.count() === 1`
  in console. Toggle back online; confirm the doseLog entry shows up
  on laptop within ~30s. Real E2E offline-write check.

**Non-blocking open questions surfaced this session (post-merge
follow-up):**
- `typeof SyncBuffer !== 'undefined'` defensive check at
  `js/sync-engine.js:1842` is unreachable in practice (const
  declaration creates lexical binding; `delete window.SyncBuffer`
  doesn't make `typeof SyncBuffer` become `'undefined'`). The
  secondary `typeof SyncBuffer.enqueue === 'function'` check IS the
  real feature-detect. Worth revisiting for symmetry with the audit's
  wording.
- Pre-existing E-1e tests #6 + #11 flakiness around `visibilityState`
  mocking in kapture/headless — NOT introduced by E-2; exists on
  main. Worth a separate small-cleanup PR.

### Commits
```
164ca99 docs(sync-impl): E-2 brief skeleton with 7 TODO blocks
ce9cd74 docs(sync-impl): E-2 RESOLUTIONS codified (Kyle, all 7 TODOs)
0be15e9 docs(sync-impl): E-2 audit (sync-auditor Phase 1)
<SHA>   feat(sync): offline buffer + Platform.network shim (E-2)
<SHA>   docs(sync-impl): move E-2 to shipped, mark PR #<N>
```

---

## 2026-05-15 — E-3: real-time onSnapshot listeners + downlevel-warning toast (Stage E reliability follow-up 2/2)

### What We Built

E-2 closed the offline-write gap last session; E-3 closes the polling-
latency + tab-suspension caveat at its source. Real-time `onSnapshot`
listeners now drive cross-device propagation (sub-second) and the
30-second `setInterval` polling cycle demotes to a 5-minute defensive
fallback. The F19a refuse-writeback contract gains its first
user-visible UX surface via a new downlevel-warning toast. This is the
second and final Stage E reliability follow-up; the cloud-sync
initiative is now functionally complete (Stage F deferred
indefinitely).

- **New `SyncFirestore.subscribe(path, callback)` wrapper
  (`js/sync-firestore.js` +118 LOC).** Extends the single-Firestore-SDK
  seam alongside the existing `getDoc` / `setDoc` / `getCollection` /
  `runTransaction` / `setBatch` methods. **Web branch:** lazy-imports
  `onSnapshot` via the existing `_loadWebSdk` cache; resolves
  per-collection refs; the inner callback walks
  `snapshot.forEach(d => docs.push({ id: d.id, data: d.data() }))`
  matching the existing `getCollection` shape; returns the SDK's
  unsubscribe fn verbatim. A deferred-unsubscribe closure handles the
  SDK-lazy-load race (unsubscribe-before-load resolves to a no-op).
  **Native branch:** throws `kind: 'unknown'` with "native parity
  pending" message mirroring the existing `runTransaction` native
  branch — filed as a tracked carry-forward alongside the long-deferred
  native CAS parity. `SYNC_DISABLED` fast-path matches existing
  methods.
- **`js/sync-engine.js` listener lifecycle + per-store dispatch seam
  (~367 LOC across 5 surgical edits).** New module-scope state:
  `_listenerUnsubs = new Map()` (storeKey → unsubscribe fn) +
  `_storeDebouncers = new Map()` (storeKey → timeoutId) +
  `LISTENER_DEBOUNCE_MS = 1000`. Four new helpers:
  `_runMergeCycleForStore(storeKey)` lifts a single store out of the
  existing `_runMergeCycle()` loop (sharing the F19a
  `_filterFutureRecordsInSnapshot` gate + F13 SyncState gating);
  `_subscribeAllStores()` walks the 6 `SYNCED_STORES` keys and arms
  per-collection subscriptions with the trailing-1s-debounce callback;
  `_scheduleStoreMerge(storeKey)` is the per-store trailing debounce;
  `_unsubscribeAllStores(reason)` walks the registry, calls each
  unsubscribe fn inside try/catch, emits per-store
  `'listener-disconnected'`, and clears all pending debouncers.
  `startSteadyState()` / `stopSteadyState()` extend with
  arm/teardown calls. Visibility (`visibilitychange`) + network
  (`Platform.network.onChange`) handlers extend symmetrically: pause-
  on-hidden / pause-on-offline unsubscribes the 6 stores; resume-on-
  visible / resume-on-online re-subscribes AND fires a one-shot
  `_runMergeCycle()` catch-up to backfill anything missed while
  paused. **`STEADY_STATE_DEFAULT_MS` bumped 30000 → 300000
  (5 minutes).** Listeners are now primary; the timer is a defensive
  fallback. Event vocabulary extended with `'refuse-writeback'`,
  `'listener-connected'`, `'listener-disconnected'`. E-2 follow-up
  symmetry fix at line 1842 closed as a one-line ride-along
  (`typeof SyncBuffer !== 'undefined' && typeof SyncBuffer.enqueue ===
  'function'` → just `typeof SyncBuffer.enqueue === 'function'`; the
  outer guard was unreachable because the `const SyncBuffer = (() =>
  {...})()` binding is always defined when the script loads). Listener
  helpers exposed on the public API so tests can invoke them directly.
- **F19a observability — 3 new `SyncEngine.emit('refuse-writeback',
  payload)` call sites across 3 layers, byte-identical underlying
  refuse-writeback semantics.** **(a)** Dispatcher snapshot pre-filter:
  inside `_filterFutureRecordsInSnapshot` in `js/sync-engine.js`,
  emit per filtered record with the highest skipped `schemaVersion`.
  **(b)** Per-merge-fn cloud-side gate: one new emit in each
  `js/sync-merge-{meds,history,rest-log,presets,bfrb,distractions}.js`
  body at the `Schema.isFutureRecord` filter call site. **(c)** Per-
  record CAS path: one new emit in each sync-merge file at the
  `try/catch` block that handles `err.kind === 'refuse-writeback'`,
  using a stashed `_remoteForEmit` to surface the remote record's
  `schemaVersion` + `deviceId`. **F19a logic is byte-identical** — the
  new emits are pure observability.
- **`js/sync-toast.js` extension (+113 LOC).** New module-scope
  `_downlevelWarningShown = false` flag + public method
  `downlevelWarning(remoteSchemaVersion)` paints the verbatim
  PLAN.md §E-3 copy ("Your phone is on a newer version. This device is
  read-only until you update."), 5s auto-dismiss + 200ms fade, and
  sets the dedup flag so subsequent emits in the same session no-op.
  Two new listeners inside `_registerListener()`:
  `SyncEngine.on('refuse-writeback', payload => downlevelWarning(...))`
  and `SyncEngine.on('auth-change', user => { if (!user)
  _downlevelWarningShown = false; })` (re-uses the existing
  `'auth-change'` event from `js/sync-auth.js:48-50` rather than
  introducing a new `'sign-out'` event). `_resetForTests()` test hook
  exposed. Module header comment extended with an "E-3 scope"
  subsection.
- **`js/tempo-nav.js` extension (+83 LOC).** Inside `wireCloudSync(...)`
  closure, 3 new `SyncEngine.on(...)` subscribers
  (`'merge-complete'` / `'listener-connected'` /
  `'listener-disconnected'`) + closure-scoped state `_lastMergeAt` +
  `_listenerStateByStore` + helper `_formatSyncStatus()` paints the
  stable text `Last sync: <relative time> · Listeners: <state>` via
  the existing `setStatus(text, false)` helper. Aggregation:
  `pending` / `disconnected` / `connected`. Reuses `Utils.formatMs`
  via the new `_humanizeRelative` helper (`just now` / `N sec ago` /
  `N min ago` / `N hr ago`). No new DOM; no new CSS; the existing
  `#cloud-sync-status` div + `.tempo-cloud-sync-status` rule carry
  the new content.
- **Tests: baseline 565 → 605 (+40).** New
  `tests/sync-listeners.test.js` (22 cases) covers `SyncFirestore.
  subscribe` happy-path / SYNC_DISABLED fast-path / native branch
  throw / per-store dispatch / trailing 1s debounce / per-store
  isolation / subscribe-on-`startSteadyState` / unsubscribe-on-
  `stopSteadyState` / visibility pause-resume + catch-up cycle /
  network pause-resume + catch-up cycle / 3-layer refuse-writeback
  emits / legacy environment fallback (`Platform.network` undefined) /
  cleanup idempotency. New `tests/sync-toast.test.js` (9 cases) covers
  `downlevelWarning` copy + auto-dismiss + dedup-via-flag /
  sign-out-reset (`SyncEngine.emit('auth-change', null)`) /
  refuse-writeback listener integration / concurrent `bufferOverflow`
  + `downlevelWarning` single-slot semantic / retroactive
  `bufferOverflow` symmetry cases. `tests/sync-engine.test.js`
  extension (9 new cases in `describe('E-3 — listener lifecycle +
  per-store dispatch')`) covers per-store dispatch seam /
  shared-F19a-gate / shared-F13-gate / re-entry-guard / constant bump
  300_000ms / lifecycle / visibility-resume / network-resume / line
  1842 symmetry verification. 2 existing assertions updated for the
  bumped constant. **All 605/605 passing via kapture on a fresh-origin
  port 8765 with `?nosw=1` bypass + cache buster `?fresh=verify3`.**
- **`sw.js` bump:** `stopwatch-v81-e2-offline-buffer` →
  `stopwatch-v82-e3-listeners`. **No new ASSETS entries** — all E-3
  code lives in existing modules (no new JS files).
- **No new persistence keys.** All listener state is in-memory;
  refuse-writeback emits are in-memory only and never persisted or
  synced.
- **Scope-expansion clause use count: unchanged at 9.** All 9 engine
  files (Phase 2) were `js/*.js` default-allowed; Phase 4 stayed
  inside `js/*-ui.js` + `js/tempo-nav.js` adjacent; only `sw.js`
  required pr-shipper's standard scope (NOT the brief-driven
  expansion clause). E-3 is the second consecutive Stage E sub-PR
  with no scope-expansion-clause usage.
- **Orchestrator sandbox branch pattern.** Sandbox branch
  `claude/orchestrator-e3` carried the brief skeleton (`d38f56e`),
  resolutions (`dbb9b91`), and audit (`4c0a0d4`) before the feat
  branch `feat/sync-stage-e3-listeners` was created from it. The 3
  sandbox commits ride along to main with the feat merge; the sandbox
  itself is not merged.

### Suggested Next Steps

- **Caveat (b) cleanup PR.** Distinguish "first sync" from "force
  re-sync" in B-3's read-cloud-first guard so Stage D handoff stops
  re-firing on every manual "Push to cloud" attempt after first
  push.
- **Caveat (c) cleanup PR — per-surface re-render hooks.** Wire
  `SyncEngine.on('merge-complete', ...)` subscribers into the Presets
  drawer, History panel, Meds list, etc. so each surface refreshes
  without close + reopen. E-3 now emits `'merge-complete'` sub-second
  via listeners; the remaining work is per-surface plumbing.
- **Caveat (d) cleanup PR.** Coalesce the 12-per-cycle
  `[SyncEngine] reconcile history sessionId collision (cloud wins)`
  log spam in `js/sync-merge-history.js` into a single summary line.
  Small warm-up PR.
- **iOS "Signing in…" label reset bug from PR #74 deferred
  follow-up.** Unchanged by E-3 — flagged for a separate fix.
- **Native CAS + listener parity follow-up (carry-forward grew with
  E-3).** `runTransaction` was queued from E-1b; `subscribe` now
  also defers native parity. Pair `addSnapshotListener` +
  `runTransaction` for `@capacitor-firebase/firestore` in one
  follow-up PR.
- **Backlog GC for preset tombstones (carry-forward).** Same as
  prior sessions.
- **Deferred legacy-key cleanup PRs (carry-forward from E-1d-f3 +
  E-1d-f8).** Drop legacy `bfrbs_global` / `flow_bfrbs` /
  `pomodoro_bfrbs` buckets + `tempo_bfrb_events_migration_v1`
  marker; drop pre-migration flat-array distractions +
  `tempo_distractions_migration_v1` marker. No fixed schedule.
- **Future cleanup: `SyncEngine._resetForTests()` helper.** Mirror
  `Toast._resetForTests()` so sync-engine extension tests don't need
  to pre-await `setTimeout(100)` to flush leaked microtasks from
  prior E-2 tests #7/#8 (engine-tester open question; test-side
  workaround; engine behavior correct).
- **Kyle's two-device manual validation for E-3.** Phone DevTools →
  Network → throttle Wi-Fi to "Slow 3G" then back to no-throttle;
  observe the catch-up `_runMergeCycle` fires + `#cloud-sync-status`
  text updates. Phone → log a dose; observe sub-second propagation
  to laptop via the listener (vs the prior 30s-polling delay).

**Non-blocking open questions surfaced this session (post-merge
follow-up):**
- Sync-engine extension tests #1/#3/#6/#7 pre-await `setTimeout(100)`
  to flush leaked microtasks from prior E-2 tests #7/#8 — test-side
  workaround; engine behavior correct. Future cleanup could expose
  `SyncEngine._resetForTests()` mirroring `Toast._resetForTests()`.
- Toast "single-slot" semantic test #6 documents a transient 200ms
  two-toast window during fade-out. Pre-existing E-2 design choice;
  not new in E-3.

### Commits
```
d38f56e docs(sync-impl): E-3 brief skeleton with 8 TODO blocks
dbb9b91 docs(sync-impl): E-3 RESOLUTIONS codified (Kyle, all 8 TODOs)
4c0a0d4 docs(sync-impl): E-3 audit (sync-auditor Phase 1)
5f6f039 feat(sync): real-time onSnapshot listeners + downlevel warning (E-3)
<SHA>   docs(sync-impl): move E-3 to shipped, mark PR #75
```

---

## 2026-05-17 — Post-Stage-E burndown: four cloud-sync caveats + three top-of-backlog features (PRs #76–#83)

### What We Built

Stage E's 2026-05-15 two-device validation surfaced four reliability caveats (a/b/c/d) plus an iOS "Signing in…" label reset bug deferred from PR #74. All five shipped over the night of 2026-05-17, followed by the next three top-of-backlog features the same morning + afternoon. Eight PRs total, all merged to main.

**Cloud-sync caveat burndown (PRs #76–#79, 02:54–03:25):**

- **PR #76 — cold-boot listener rearm (commit `a010abb`).** E-3 onSnapshot listeners depend on `_maybeAutoStartSteady` running once the 4-condition gate (signed-in + flag-on + all-hydrated + no-Stage-D) is satisfied. Two seams left the gate unwatched after that moment had passed: (1) cold boot with pre-existing hydrate markers — `init()` probes `SyncAuth.getCurrentUser()` at line 186 and only fires `_maybeAutoStartSteady` if non-null; SDK rehydrates async, so currentUser is usually null at init time; the later `onAuthChange` callback called `_maybeAutoHydrate` which bailed early on `isAllHydrated()` and never reached the `.then(() => _maybeAutoStartSteady(user))` line; (2) in-session Reconcile without reload — `reconcileImportedBucket` step 7 set hydrate markers and step 8 cleared Stage D (gate satisfied) but no one re-fired `_maybeAutoStartSteady` at that moment. **Fix:** `_maybeAutoHydrate` now calls `_maybeAutoStartSteady(user)` when bailing on `isAllHydrated()` with a non-null user (Stage D bail untouched per D-1 contract); `reconcileImportedBucket` step 9 now reads `SyncAuth.getCurrentUser()` inside a defensive try/catch and fires `_maybeAutoStartSteady(currentUser)`. Idempotent via existing `_steadyTimer != null` guard. Discovered via two-tab kapture validation 2026-05-17. Adds Group G in `tests/sync-imported-bucket.test.js` (1 case). Total 606/606. `sw.js` → `v83-listener-cold-boot-rearm`.
- **PR #77 — collision-log coalesce + SyncAuth timeout race (commits `64623e3` + `40df03d`).** Two unrelated fixes in one PR. **(d)** `_mergeHistory` was emitting one `console.warn` per sessionId collision during Stage D Reconcile (13 warnings in a 1ms burst captured 2026-05-17). Replaced with a single summary log at the end of the merge: `[SyncEngine] reconcile history: N sessionId collision(s) resolved cloud-wins; ids=[...]`. Preview cap at 10 IDs + "+M more" suffix. Per-record debug fidelity preserved for the first 10. Two tests updated/added (1 existing case asserting exactly one summary warning, 1 new 13-collision-burst case asserting count + preview + "+3 more" + 11th+ IDs absent). **iOS sign-in fix** — `SyncAuth.signIn` now races `Platform.auth.signIn` against `SIGN_IN_TIMEOUT_MS = 60000` setTimeout that rejects with `{ code: 'auth/timeout', message: 'Sign-in timed out. Try again.' }`. 60s comfortably covers interactive OAuth (account picker + password + 2FA). `tempo-nav.js` auth-change subscriber now clears the status row when transitioning to a non-null user — self-heal contract for "Platform.auth.signIn eventually succeeds AFTER the timeout race already lost on slow networks". Two new tests in `tests/sync-auth.test.js` (timeout case uses sync setTimeout stub so test never actually waits 60s; happy-path regression guard). Total 609/609 across the two commits. `sw.js` → `v84-reconcile-log-coalesce` → `v85-signin-timeout`. **Closes the deferred follow-up flagged in PR #74's description** + closes backlog caveat (d).
- **PR #78 — per-surface UI re-render on merge-complete (commit `552ae76`, caveat c).** Each affected UI module now subscribes to `SyncEngine.on('merge-complete', ...)` so cross-device data arrivals reflect in the rendered surface without a close+reopen. Consistent pattern across 5 modules: typeof-guard `SyncEngine` for test-harness friendliness; filter on `payload.store === <store>`; visibility gate (drawer/panel currently rendered) avoids burning cycles on hidden surfaces; defensive try/catch around the re-render call. Subscribers: `presets-ui` (presets → `renderQuickPicks` always + `renderGrid` if drawer open), `history-ui` (history → `renderHistory` if panel visible), `recovery-ui` (rest_log + history → `render(surface)` if visible; hooks BOTH because the dashboard derives "Last focus block" from `History.getSessions`), `exercise-ui` + `wellness-cooking-ui` (history → `renderRecent` if surface visible). **Meds UI intentionally NOT hooked** — already has a render loop keeping the live countdown fresh; cross-device dose log changes pick up on next tick. **Distractions log in Flow/Pomo UI intentionally NOT hooked** — session-scoped, UI only displays during in-progress sessions, cross-device same-session editing is an edge case not worth the wire-up. Total 609/609 (no UI tests in this repo; emitter behavior tested at engine layer). `sw.js` → `v86-ui-rerender-on-merge`.
- **PR #79 — Push skips Stage D when cloud has only this-device writes (commit `f2eed1e`, caveat b).** F9 read-cloud-first guard in `pushSnapshot()` used "cloud non-empty + partial-upload marker absent" as the Stage D trigger. After the FIRST successful push from any device, the marker is cleared on success — so every subsequent Push landed in Stage D handoff even when cloud only contained this device's own previous pushes. Caught at 2026-05-17 two-tab kapture validation. **Fix:** inspect cloud `deviceId` stamps. Three sub-paths: (1) "my failed retry" — partial-upload marker matches this user, proceed (existing); (2) "all cloud docs are my own previous pushes" — marker gone but every deviceId stamp matches THIS device, NEW — skip Stage D, re-upload via idempotent setDoc; (3) "genuine Stage D" — cloud carries at least one FOREIGN deviceId, hand off to D-1 (existing). `_pullCloudSnapshot` now returns `deviceIds` (Set<string>) alongside the existing `isEmpty` + counts; reaches into nested structures via a recursive walker because some stores (rest_log day records) stamp deviceId on inner array entries (`naps[]`) rather than the top-level doc. Uses `History.getDeviceId()` as this-device's id (canonical F10 source). Pre-F10 cloud docs (no deviceId at all) treated as neutral. Three tests in `tests/sync-uploader.test.js` (1 existing renamed + updated to use realistic F10-stamped cloud doc; 1 new for path 2; 1 new for nested-array regression guard). Total 611/611. `sw.js` → `v87-push-skip-stage-d-self`.

**Top-of-backlog feature burndown (PRs #81–#83, 04:24–13:44):**

- **PR #81 — Flow vibration intervals (commit `05d7a5f`, backlog #2).** See Phase 10 in CLAUDE.md for details. `sw.js` → `v88-flow-vibrate-intervals`. Total 611/611 (no engine modules changed; existing convention is to not unit-test vibration logic).
- **PR #82 — Ambient procedural noise on Flow + Pomodoro session start (commit `9c6de75`, backlog #3).** See Phase 10 in CLAUDE.md for details. First-pass scope is procedural Web Audio noise only; bundled MP3 loops + YouTube IFrame Player API deferred to follow-ups. `sw.js` → `v89-ambient-noise-procedural`. Total 611/611 (no engine modules changed; `js/audio.js` has no existing test coverage in this repo).
- **PR #83 — Rhythm pillar daily timeline (commit `5be4bfb`, backlog #4).** See Phase 10 in CLAUDE.md for details. Pure read-side aggregation, no new persistence. **17 new engine tests** in `tests/rhythm.test.js`. `sw.js` → `v90-rhythm-pillar`. **Total 628/628.**

**Doc + chore ride-alongs:**
- PR #85 (`3d524f3`) — marked "Lap data visualization" as already-shipped (was delivered in commit `313b78e` on 2026-04-06 but never moved off the backlog).
- PR #84 (`257429d`) — ignore local `PROJECT_GUIDE.md`.
- Direct-to-main `a9e9486` — generalize orchestrator system prompt for non-sync PRs (the orchestrator was sync-PR-specific; this opened it up for non-sync feature work like the three backlog features above).

### Verification result

All eight feature/fix PRs verified via two-tab kapture validation on 2026-05-17 (no formal Phase 4 ui-wirer pass — these were direct PRs, not orchestrator runs). Test counts progressed 605 → 606 (#76) → 607 (#77a) → 609 (#77b) → 611 (#79) → 628 (#83). `sw.js` cache bumped on every PR per project rule (`v82-e3-listeners` → `v83` → `v84` → `v85` → `v86` → `v87` → `v88` → `v89` → `v90-rhythm-pillar`).

### Suggested Next Steps

**Cloud sync — last unshipped piece:**
- **Native CAS + listener parity for `@capacitor-firebase/firestore`.** Pair `addSnapshotListener` + `runTransaction` for the Capacitor branch in one follow-up PR. iOS sync currently works through the 5-min defensive polling path + per-record `setDoc` fallback — fully functional but degraded vs web. Requires Xcode + device for verification.

**Top-of-backlog features (per CLAUDE.md table after this grooming pass):**
- **Split-screen timer comparison (#6 in old numbering, #3 now).** Side-by-side two timers. Significant layout rework — would need responsive grid + per-pane controls + a "compare these two instances" picker UI.
- **Voice control (#7 in old numbering, #4 now).** Web Speech API SpeechRecognition. Commands: start/stop/lap/reset.

**Carry-forward tech debt:**
- Legacy-key cleanup PRs (`bfrbs_global` / `flow_bfrbs` / `pomodoro_bfrbs` + `tempo_bfrb_events_migration_v1` marker; pre-migration flat-array distractions + `tempo_distractions_migration_v1` marker). No fixed schedule.
- Backlog GC for preset tombstones (when accumulated `deletedAt < (now - 90 days)` records become observable, e.g., a user with 200+ deleted presets — add a periodic purge).
- `SyncEngine._resetForTests()` helper (mirror `Toast._resetForTests()` so sync-engine extension tests can drop the `setTimeout(100)` workaround for flushing leaked microtasks from prior E-2 tests).
- Phase 9's `js/history.js` per-field stamping deferral (TODO #2 from E-1d) — sessions currently LWW the whole record; per-field stamping for `note` vs `tags` once cross-device edit-collision pattern observed in practice.

### Commits
```
a010abb fix(sync): arm listeners after cold-boot async-rehydrate + Reconcile  (PR #76)
64623e3 refactor(sync): coalesce reconcile history collision warnings into one summary log  (PR #77)
40df03d fix(sync): SyncAuth.signIn timeout race + self-heal of stale error status  (PR #77)
552ae76 feat(sync): per-surface UI re-render on merge-complete  (PR #78)
f2eed1e fix(sync): Push skips Stage D when cloud has only this-device writes  (PR #79)
05d7a5f feat(flow): vibration intervals during focus blocks (backlog #2)  (PR #81)
9c6de75 feat(audio): ambient procedural noise on Flow + Pomodoro session start  (PR #82)
5be4bfb feat(rhythm): daily timeline pillar (backlog #4)  (PR #83)
3d524f3 docs(backlog): mark lap data visualization as already shipped  (PR #85)
257429d chore: ignore local PROJECT_GUIDE.md  (PR #84)
a9e9486 chore(claude): generalize orchestrator system for non-sync PRs  (direct to main)
```

*Note: this entry was backfilled in a 2026-05-19 doc grooming pass — the eight feature/fix PRs above all shipped directly without a per-PR SESSION-LOG entry at the time. Detail is reconstructed from commit messages.*

---

## 2026-05-20 — Ambient noise palette expansion (PR #88, follow-up to PR #82)

### What We Built

Follow-up extension of PR #82's procedural ambient noise (backlog #3). The original PR shipped white / brown / pink — this PR expands the palette to 7 colors by adding four more profiles to `js/audio.js`'s `AMBIENT_PROFILES`:

- **green** — RBJ biquad bandpass on white noise, center 500 Hz, Q=1.0, x4 amplitude compensation. Mid-band "forest" / "Otto-style" feel; qualitatively distinct from pink (broadband) and brown (LF-emphasized).
- **blue** — single-difference differentiator on white (`data[i] = white[i] - white[i-1]`), x0.5 amp comp. +3 dB/oct HF emphasis; masks low-pitched distractions.
- **violet** — double-difference (differentiator applied twice), x0.25 amp comp. +6 dB/oct extreme HF; distinct tinnitus-masking profile.
- **gray** — Paul Kellet pink generator post-processed through a 2 kHz Q=0.7 biquad notch. Perceptually flatter U-shape spectrum (LF + HF emphasized, mid-band notched) — psychoacoustic approximation of A-weighting inverse.

Pure additive change: the play path (`startAmbient` / `stopAmbient` / `_stopAmbientNode`) is byte-equivalent, public API unchanged, no new persistence keys, no schema bump, no sync-store touch, no native code, no new dependencies. Existing `flow_ambient_profile` / `pomodoro_ambient_profile` localStorage values continue to resolve unchanged.

UI: both `<select>` blocks (`#flow-ambient-profile` + `#pomo-ambient-profile`) gained four new `<option>` entries; the existing 3 entries had " noise" suffix stripped from their text content for consistency ("Brown noise" → "Brown", etc.). The parent label "Ambient sound" already conveys context. `value` attributes unchanged, so persisted profile ids continue to resolve correctly.

`sw.js` CACHE_NAME bumped from `v90-rhythm-pillar` → `v91-ambient-colors`.

### Verification result

- 2 new engine tests in `tests/audio.test.js` (profile registration order + capitalized name labels). Total: 628 → 630, all passing locally via `tests/index.html`.
- Both Flow + Pomodoro routes verified via kapture browser: 8 options each in correct order; zero console errors; `#/wellness/meds` neighbor route regression-check passes.
- Manual smoke (post-merge): pick each new color in Flow + Pomodoro and confirm each plays a distinct sound at default `ambient_volume = 0.05`. See `docs/audits/ambient-colors-expand-AUDIT.md` § Manual setup steps for the 10-step plan.

### Suggested Next Steps

- **Bundled royalty-free MP3 loops** (rain, café, ocean) — still deferred from backlog #3's option b. Would need a storage/streaming strategy and a license-source decision.
- **YouTube IFrame Player API** for lo-fi / focus-music streams — still deferred (option c); carries ToS review.
- **Per-phase ambient profiles** (e.g., one color for focus, a different one for break / recovery) — currently Flow stops ambient at focus→recovery, Pomodoro stops at work→break; no `pomodoro_break_ambient_profile` key. Deferred.
- **PR #86 follow-through** (native-sync-listener-parity) — still awaiting Kyle's iOS smoke; this PR ships in parallel.
- Carry-forward tech debt unchanged from 2026-05-17 entry.

### Commits
```
<SHA>   feat(audio): expand ambient noise colors (green/blue/violet/gray)  (PR #88)
```

---

## 2026-05-22 — iOS Live Activities — Timer MVP (PR `live-activities-timer-mvp`, foundational PR for backlog #3/#9)

### What We Built

Foundational PR for iOS Live Activities (CLAUDE.md backlog priority #3 / chronological #9). Scaffolds the entire JS↔ActivityKit pipeline end-to-end for the `Timer` engine, so subsequent PRs can extend to Stopwatch / Pomodoro / Flow / Interval / Cooking without re-litigating the bridge or the Widget Extension setup. Six surfaces of change: (1) **new in-tree custom Capacitor plugin** (first non-Firebase / non-Capacitor-official plugin in the repo) at `ios/App/App/Plugins/LiveActivity/{LiveActivityPlugin.swift,LiveActivityPlugin.m,TempoTimerAttributes.swift}` — Swift plugin class with `isSupported` / `startTimer` / `updateTimer` / `endTimer` / `endAll`, internal `[String: Activity<TempoTimerAttributes>]` dict for resume-from-pause routing, Obj-C `CAP_PLUGIN(LiveActivityPlugin, "LiveActivity", ...)` registration bridge, shared `TempoTimerAttributes` struct with target-membership in BOTH App + Widget targets; (2) **new `TempoLiveActivityWidget` Xcode target** at `ios/App/TempoLiveActivityWidget/` — deployment-target-isolated at iOS 16.1 (main App stays at 13.0), SwiftUI lock-screen layout (Option B: name + PAUSED badge top, large `Text(timerInterval:)` countdown center, `ProgressView(timerInterval:)` bottom — all OS-rendered, no per-tick push), Dynamic Island compact / expanded / minimal layouts with `.widgetURL(URL(string: "tempo://timers/timer"))` deep-link on the expanded view; (3) **`js/platform.js` extension** — new `Platform.liveActivity` namespace mirroring the established `Platform.auth` / `Platform.network` module-pattern with web-side `{ supported: false }` / `{ ok: false, reason: 'web' }` no-op shapes and `_liveActivityNativeUnavailableLogged` one-time-warn on plugin-missing; (4) **`js/timer.js` engine wiring** — 4 fire-and-forget emit points inside `createTimer()` (`start` / `pause` / `reset` / `checkFinished`-alarm), each gated on `localStorage.getItem('live_activities_enabled') !== '0'` and ending with `.catch(() => {})` so engine state mutations are never blocked on the bridge; (5) **`ios/App/App/Info.plist` additions** — `NSSupportsLiveActivities = true` AND a second `<dict>` sibling inside `CFBundleURLTypes` registering `tempo://` URL scheme (existing Google OAuth callback untouched); (6) **settings drawer toggle + deep-link listener** — new `#live-activities-section` block in `#tempo-settings-drawer` after Cloud Sync, `wireLiveActivities(drawer)` reveals the section only when `Platform.isNative && (await Platform.liveActivity.isSupported()).supported`, `wireAppUrlOpen()` subscribes to `appUrlOpen` and maps `tempo://<host>/<path>` → `window.location.hash = '#/<host>/<path>'`. Web-side is byte-equivalent: section stays `hidden`, listener no-ops, Timer engine emits resolve to silent `{ ok: false, reason: 'web' }`. **Verification:** xcodebuild on both targets (Xcode 26.5 / Swift 6.3.2) → `** BUILD SUCCEEDED **` zero errors / warnings; full engine test suite 630 / 630 (no regressions); kapture web smoke confirms Live Activities section correctly hidden on web with zero console errors. New persistence key: `live_activities_enabled` (per-device toggle; default `'1'` ON; NOT synced — like `bfrb_volume` / `ambient_volume`). `sw.js` → `v92-live-activities-timer`.

### Verification result

- xcodebuild on Xcode 26.5 / Swift 6.3.2: `** BUILD SUCCEEDED **` for both `App` target and the new `TempoLiveActivityWidget` target. Zero errors / zero warnings.
- Engine tests: 630 / 630 passing locally via `tests/index.html` (no regressions from the Timer engine's 4 new emit points — they're fire-and-forget `.catch(() => {})` and never block engine state).
- Web kapture smoke: Live Activities section is `hidden` on web (correct gate via `Platform.isNative && isSupported`); no console errors; neighbor route `#/timers/countdown` regression-check passes.
- Manual iOS device smoke: NOT YET — pending Kyle's device for first post-merge `npm run ios:sync && npx cap sync ios`. 16-step smoke plan documented in the audit: `docs/audits/live-activities-timer-mvp-AUDIT.md` § Manual setup steps.

### Suggested Next Steps

**Live Activities feature follow-ups (the rest of backlog #3):**
- **PR 2 — Stopwatch count-up Live Activity.** Add `TempoStopwatchAttributes` struct + corresponding SwiftUI view (count-up layout, no progress bar — just elapsed time). Reuses the existing `Platform.liveActivity` namespace + plugin + Widget Extension target.
- **PR 3+ — Pomodoro / Flow / Interval / Cooking integration.** Each engine adds its own attributes struct + view; bridge surface stays the same.
- **iOS device smoke this PR.** Run the 16-step manual smoke plan from the audit on Kyle's iPhone post-merge. Critical checks: (smoke 13) force-quit-persists-activity validates ActivityKit's 8-hour OS-managed lifetime; (smoke 15) `tempo://` deep-link lands on `#/timers/timer`. If smoke 13 fails (activity vanishes within seconds), add `Background Modes` entitlement to `App.entitlements` — deferred from audit Risk #10.

**Backlog #1 revisit — Apple Developer Program enrollment closed first item on "Remaining for App Store distribution" list:**
- The brief's locked Q4 decision confirms Kyle's $99/yr Dev Program enrollment is now active. This closes the first remaining bullet on backlog row #1's "Remaining for App Store distribution" list (the $99/yr enrollment line). **This PR did NOT edit backlog #1** (out of scope — backlog edits stay their own doc PR per project convention). **Next session:** open a tiny `docs/backlog-#1-grooming` PR that (a) removes the $99/yr Apple Developer Program enrollment bullet from backlog row #1's "Remaining for App Store distribution" list, and (b) re-evaluates the remaining items (App Store Connect record, TestFlight or App Store submission, privacy nutrition labels for meds + BFRB health data, App Review screenshots, age rating, 1024×1024 app icon polish) for status updates. The TestFlight / App Store submission flow is the natural next step after the Dev Program activates.

**Tech debt surfaced this PR — sync test harness pollution blocks future Platform.X unit tests:**
- The 18 sync tests (`tests/sync-engine.test.js`, `tests/sync-listeners.test.js`, `tests/sync-auth.test.js`) stub `window.Platform = {...}` wholesale and rely on `Platform` being undefined globally in the harness. This means `js/platform.js` cannot currently be loaded by `tests/index.html` — which blocks unit-testing any future additions to the `Platform.X` namespaces. Surfaced concretely during this PR's Phase 3: engine-tester wrote `tests/platform.test.js` (6 cases for `Platform.liveActivity` web-branch contract) that passed in isolation but had to be dropped to keep the 18 sync tests green. **Recommended fix (single doc PR, a few hours of test refactoring):** refactor the 18 sync tests to stub `Platform.auth.X` / `Platform.network.X` properties directly via `Object.defineProperty` or simple assignment, instead of replacing `window.Platform` wholesale. Unblocks unit tests for `Platform.liveActivity` AND any future `Platform.X` additions (e.g., next custom Capacitor plugin).

**Cloud sync — last unshipped piece (carry-forward from prior sessions):**
- **Native CAS + listener parity for `@capacitor-firebase/firestore`.** `SyncFirestore.runTransaction` (queued from E-1b) and `SyncFirestore.subscribe` (queued from E-3) are both web-only — the native branches throw an explicit "native parity pending" normalized error. Pair `addSnapshotListener` + `runTransaction` for the Capacitor branch in one follow-up PR. Requires Xcode + device for verification.

**Carry-forward tech debt (unchanged from prior sessions):**
- iOS sign-out bug (PR #86 smoke surfaced; `js/platform.js:297-302` race against Firebase iOS SDK Keychain cache).
- Legacy-key cleanup PRs (`bfrbs_global` / `flow_bfrbs` / `pomodoro_bfrbs` + migration markers; pre-migration flat-array distractions).
- Backlog GC for preset tombstones.
- `SyncEngine._resetForTests()` helper.
- Phase 9's `js/history.js` per-field stamping deferral.

### Commits
```
<SHA>   docs(briefs/audits): live-activities-timer-mvp brief + audit  (PR live-activities-timer-mvp)
<SHA>   feat(ios): Live Activity custom Capacitor plugin + shared attributes  (PR live-activities-timer-mvp)
<SHA>   feat(ios): Live Activity Widget Extension target + SwiftUI views  (PR live-activities-timer-mvp)
<SHA>   feat(timer): emit Live Activity events on start/pause/reset/finish (web no-op)  (PR live-activities-timer-mvp)
<SHA>   feat(ui): settings drawer Live Activities toggle + tempo:// deep-link listener  (PR live-activities-timer-mvp)
<SHA>   docs(backlog): mark Live Activities Timer MVP shipped; flag paid-Dev-Program + sync-harness tech debt  (PR live-activities-timer-mvp)
```

---

*To add a new session: copy the template below and fill it in at the end of a session.*

## Session N — YYYY-MM-DD

### What We Built
- ...

### Suggested Next Steps
- ...

### Commits
```
...
```
