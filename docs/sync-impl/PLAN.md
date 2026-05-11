# Tempo cloud-sync implementation plan (multi-PR)

**Status:** Implementation roadmap. Backend chosen (Firebase / Firestore — see `docs/sync-review/BACKEND-SELECTION.md`). Strategy locked (`docs/CLOUD-SYNC-STRATEGY.md` v2.0). All 5 prereqs (F18 / F2 / F10 / F13 / F14) and all 3 schema-evolution rules (F20 / F19a / F19b) shipped to `main`. Stage A is **closed except for four targeted gaps** (F4 / F6 / F7 / F21) that ship in PR A-1.

**TL;DR:** 13 PRs across 6 stages. Ship Stage 0 + Stage A close-out + Stage B (6 PRs total: S0-1, A-1, B-1, B-2, B-3, B-4) first to land "Device A pushes to cloud successfully" as the first observable milestone. Stages C/D/E follow sequentially. Stage F (per-store manifest registry, F19c) is deferred indefinitely.

---

## Context

Tempo is a vanilla-JS PWA + Capacitor iOS app. Storage today is `localStorage` + `IndexedDB`, scoped per-browser per-device. The driving use case is medication tracking — logging a dose on the phone must reflect on the laptop quickly enough that the user doesn't double-dose. v2.0 of the strategy is the source of truth for per-store merge rules and Stage A → E sequencing.

Backend selection (Phase 6): Firebase / Firestore. Two accepted tradeoffs: (1) no self-serve BAA on Spark, capping any future public-launch story with other users' dose data; (2) Firestore-shaped vendor lock-in (no joins, doc-level CAS, per-read pricing).

**What's shipped (verified in `git log origin/main`):**

| F# | What | PR |
|---|---|---|
| F14 | doseLog cap → 1000 | #46 |
| F2 | Session ID `${deviceId}-${ts}-${counter}` + `legacyId` | #47 |
| F13 | `tempo_sync_state` write gate | #49 |
| F10 | `deviceId` + `updatedAt` stamping at write sites | #48 |
| F18 | Per-record meds persistence under `meds/{medId}` | #50 |
| F20 | Absent vs present-but-unknown enum split | #51 |
| F19a | `schemaVersion` stamp + refuse-writeback | #52 |
| F19b | `__forward` passthrough (top-level unknowns) | #53 |
| — | Phase 6 backend-selection decision doc | #54 |
| — | Stage 0: Firebase project + plugins + security rules | #57 |
| — | Stage B: SyncEngine module scaffold + per-store snapshot adapters | #58 |

**What's pending (sync-strategy items + wire/infra):**

Sync-strategy: F1 (per-med ±N-min reconcile), F3 (BFRB stream choice), F4 (re-derive `lastTakenAt` after merge), F6 (`phaseLog` (deviceId, phaseStartedAt) stamping), F7 (verify `loadState` recoveries never persist back), F8 (distraction tombstones vs sessionId-keyed), F9 (Stage B0 read-cloud-first), F12 (mandatory local backup before Stage B mutation), F15 (toast on ≥2-entry remote `doseLog` arrival), F16 (±15-min clock-skew clamp on non-local entries), F17 (Stage D imported bucket), F21 (`alarmFired` per-device — Device B must still chime). Also pending: **F19a-fix** — patch `createMed.getState()` (and `history.js` equivalent) to preserve original `schemaVersion` for future-schema records loaded from disk, instead of downgrading to current `Schema.SCHEMA_VERSION` on read. Surfaced by B-1's F19a passthrough test. Must land before B-3 (first PR that round-trips records).

Deferred: F19c (per-store manifest registry).

Wire/infra: auth flow (Google sign-in, web + iOS WebView; B-2); first cloud upload (B-3); offline buffer (Stage C); `tempo_sync_state` flips on real transitions (Stage C/E).

**Engine-test baseline:** 114 tests today (stopwatch 30 / timer 21 / pomodoro 25 / meds 38) via `tests/index.html`. Sync work adds 1 new engine module + 1 new test file per stage; same pattern.

---

## Hard rules (carried forward from Phase 5)

- **Audit before code.** Every implementation PR opens with an affected-files + risks audit (the F20 / F19a / F19b pattern), committed first to the branch. The audit determines blast radius and test scope.
- **One stage per PR family. Each PR is its own branch + PR, merged sequentially.**
- **Local-first stays a hard contract.** Offline must keep working. `tempo_sync_state` (F13) is the kill-switch.
- **Engine-test-only coverage.** No UI test infrastructure as part of sync.
- **Web GitHub Pages deploys stay byte-equivalent.** Same `git push` → static host flow. Firebase imports load via Capacitor plugin on native; web uses the modular SDK from CDN gated behind `tempo_sync_enabled`.
- **Native-specific code routes through `js/platform.js`.** New `Platform.auth` and `Platform.network` namespaces extend the existing pattern.
- **HIPAA / BAA:** Spark plan cannot self-serve a BAA. Documented in `docs/sync-impl/FIREBASE-SETUP.md`. Does not gate Phase 1 (single-user personal use).

---

## Backend setup (Firebase project)

These are **manual steps the user performs once**. The PR (S0-1) only commits config files that reference the project; the project itself is created via the Firebase Console.

1. **Create Firebase project** at console.firebase.google.com. Project name: `tempo-sync` (or similar). Region: `us-central1` (permanent — see BACKEND-SELECTION.md).
2. **Enable Firestore.** Production mode (security rules deny by default; we ship rules in S0-1).
3. **Enable Authentication → Google sign-in.** Add the iOS bundle ID (`com.ksdisch.tempo`) and the web origins (`https://ksdisch.github.io`, `http://localhost:*` for local dev).
4. **Add iOS app** in Firebase project settings → download `GoogleService-Info.plist` → place at `ios/App/App/GoogleService-Info.plist` (committed via S0-1).
5. **Add Web app** → copy the config snippet into `js/sync-firebase-config.js` (committed via S0-1, contains only public client config — no secrets).
6. **Set budget alert** at $1/mo on the GCP billing console (Spark plan can be paused on quota overrun; budget alert is the early-warning).

Security rules (initial draft, refined in S0-1):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

All sync data lives under `users/{uid}/...` so each user's data is isolated. Per-store paths:
- `users/{uid}/meds/{medId}` (record)
- `users/{uid}/meds/{medId}/doseLog/{entryId}` (subcollection — append-only)
- `users/{uid}/history/{sessionId}` (record; `phaseLog` embedded as immutable bag)
- `users/{uid}/rest_log/{date}` (record; `naps` array embedded)
- `users/{uid}/presets/{presetId}` (record)

---

## Auth flow design (Google sign-in)

**Web (PWA):**
1. User taps "Sign in with Google" in settings drawer.
2. `Platform.auth.signIn()` calls `firebase/auth` `signInWithPopup(GoogleAuthProvider)`.
3. On success, `auth.currentUser` is persisted by the SDK in IndexedDB (default).
4. `SyncEngine.onAuthChange` fires; if first sign-in, triggers Stage B uploader.

**iOS (Capacitor WebView):**
1. User taps "Sign in with Google" in settings drawer.
2. `Platform.auth.signIn()` calls `FirebaseAuthentication.signInWithGoogle()` from `@capacitor-firebase/authentication`.
3. The plugin uses the native iOS Firebase SDK; iOS shows the system Google sign-in sheet.
4. Token is persisted by the native SDK; the JS-side `auth.currentUser` is restored on next launch via the plugin.
5. `SyncEngine.onAuthChange` fires; same handler as web.

**Cross-device identity:** Same Google account = same Firebase UID = same Firestore path. No separate user-mapping table needed (the failure mode CloudKit had).

**Sign-out:** `Platform.auth.signOut()` calls the appropriate SDK; clears local sync flag; pull-down listeners stop. Local data is **not** wiped (local-first contract).

---

## PR breakdown

Branch convention: `feat/sync-stage-<X>-<short>`. Merge order is strictly sequential within a stage; cross-stage parallelism noted per PR.

### Stage 0 — Backend infrastructure

#### S0-1 · `feat/sync-stage-0-firebase-setup`
- **Goal:** Land Firebase project config, plugins, security rules, and decision doc; no behavior change yet.
- **Audit first:** Open branch with `docs/sync-impl/audits/S0-1-AUDIT.md` listing affected files + manual setup steps performed.
- **Files touched:**
  - `package.json` + `package-lock.json` (add `firebase`, `@capacitor-firebase/authentication`, `@capacitor-firebase/firestore`)
  - `capacitor.config.json` (Firebase plugin config block)
  - `ios/App/App/GoogleService-Info.plist` (Firebase iOS config — bundle ID `com.ksdisch.tempo`)
  - `ios/App/Podfile` (auto-updated by `npx cap sync`)
  - New `firebase.json`, `firestore.rules`, `firestore.indexes.json` (empty — no composite indexes needed yet)
  - New `js/sync-firebase-config.js` (public web config snippet, gated behind `tempo_sync_enabled` so it doesn't load on prod)
  - New `docs/sync-impl/FIREBASE-SETUP.md` (HIPAA posture, manual setup checklist, region pick rationale, budget alert, the BAA gap callout)
  - `.gitignore` (any Firebase Admin keys or `service-account.json` if they appear locally)
- **Engine-test plan:** None (config-only PR). Manual verification: `npm install` succeeds; `npx cap sync` succeeds; web app boots byte-equivalent; iOS build still produces ipa.
- **Blast radius:** Web boot must not regress. iOS Cocoapods must still resolve. The `GoogleService-Info.plist` and `firebase-config.js` are public client config (no secrets) — safe to commit.
- **Prereqs:** none.
- **Rollback:** Revert PR; archive (don't delete) the Firebase project from console — preserves the decision audit.

---

### Stage A close-out — remaining prereqs

#### A-1 · `feat/sync-stage-a-prereq-closeout`
- **Goal:** Ship F4 + F6 + F7 + F21 in one bundled PR so Stage B can safely upload.
- **Audit first:** `docs/sync-impl/audits/A-1-AUDIT.md` enumerates every `phaseLog` push site (Flow / Pomodoro / Interval / Sequence) and every `loadState` recovery branch.
- **Files touched:**
  - `js/meds.js` — F4: `recomputeLastTakenAt(med)` exposed on `MedsManager`. Sets `med.lastTakenAt = doseLog[doseLog.length-1].takenAt` (or null). Wire it into a hook `MedsManager.onMergeComplete()` that SyncEngine calls in D-2.
  - `js/flow.js` — F6: stamp `(deviceId, phaseStartedAt)` on every `phaseLog.push(...)` site. Use `History.getDeviceId()` (already exists; no new module).
  - `js/pomodoro.js` — F6 (pomodoro phase transitions push to history's phaseLog at session-end).
  - `js/interval.js` — F6 (interval program-tracking).
  - `js/sequence.js` — F6 (sequence phaseLog).
  - `js/stopwatch.js`, `js/timer.js`, `js/pomodoro.js`, `js/flow.js`, `js/interval.js` — F21 audit: confirm `alarmFired` (where present) is set in render-loop branches that never persist back. Add an inline comment `// F21: per-device, never synced` above each occurrence so future PRs don't accidentally pull it into sync.
  - F7 sweep: read `loadState` in stopwatch / timer / pomodoro / flow / interval. Verify auto-advance, `focusEndedAt`, `alarmFired` are set in memory only and never trigger `Persistence.save()` or equivalent. Document findings in `docs/sync-impl/F7-AUDIT.md`. If a recovery branch DOES write back, fix it (likely a missed `Persistence.save()` at the bottom of a recovery code path).
- **Engine-test plan:** New `tests/sync-stamps.test.js`:
  - F4: `recomputeLastTakenAt` matches `doseLog[doseLog.length-1].takenAt`; null when log empty; recomputes correctly after splicing entries.
  - F6: phaseLog entries always carry `deviceId` + `phaseStartedAt`; entries without these fields fail the test.
  - F21: `alarmFired = true` from a synced state still triggers chime locally on Device B (mock the alarm call site, simulate state load with `alarmFired: true`, verify chime is called).
  - F7: regression test that asserts `loadState` recoveries don't bump `Persistence.save()` call count (mock `Persistence.save`).
- **Blast radius:** Touches 5 engine modules. Engine state writeback paths in 4–5 engines. RAF render loops touch phase data — a malformed phaseLog entry could regress mode displays. Run full test suite + manual smoke (start each mode, verify timer ticks, complete a session, verify history row).
- **Prereqs:** none (parallel-safe with S0-1).
- **Rollback:** Revert. F6 stamping is additive (downlevel reads ignore the new fields per F19b). F4 helper is unused until D-2 calls it. F7/F21 are audits; their fixes (if any) are isolated.

---

### Stage B — Device A first sync

#### B-1 · `feat/sync-stage-b-engine-scaffold`
- **Goal:** Land the SyncEngine module skeleton with hardcoded store registry; no network calls.
- **Audit first:** `docs/sync-impl/audits/B-1-AUDIT.md`.
- **Files touched:**
  - New `js/sync-engine.js` — module: `init()`, `getSnapshot()`, `enable()`, `disable()`, `getState()` (mirrors `tempo_sync_state`), event-emitter pattern for `onAuthChange`, `onMergeComplete`, etc.
  - Hardcoded `SYNCED_STORES` registry inside `js/sync-engine.js`:
    ```
    [
      { key: 'meds',      adapter: { read: () => MedsManager.snapshotForSync(), write: ... } },
      { key: 'history',   adapter: { read: () => History.snapshotForSync(), write: ... } },
      { key: 'rest_log',  adapter: { read: () => Recovery.snapshotForSync(), write: ... } },
      { key: 'presets',   adapter: { read: () => Presets.snapshotForSync(), write: ... } },
    ]
    ```
  - Add `snapshotForSync()` to each engine module (`meds.js`, `history.js`, `recovery-ui.js`, `presets.js`) — returns `{ deviceId, schemaVersion, payload }`.
  - `index.html` — add `<script src="js/sync-engine.js"></script>` after `persistence.js` and before any UI module that references it.
  - `js/app.js` — wire `SyncEngine.init()` (no-op behind feature flag).
  - New `js/sync-flag.js` — `tempo_sync_enabled` localStorage flag (off by default), exposed in settings drawer behind a hidden "developer" toggle for testing.
- **Engine-test plan:** New `tests/sync-engine.test.js`:
  - `getSnapshot()` reads each store via its registry adapter and produces the documented shape.
  - `snapshotForSync()` on each store produces a record matching the per-store contract (deviceId stamped, schemaVersion stamped).
  - `enable()` requires `tempo_sync_enabled = '1'`; otherwise no-op.
  - `init()` is idempotent.
- **Blast radius:** New module + 1 line in `index.html` + 1 line in `app.js`. No existing flows touched. The new `snapshotForSync()` methods on engine modules are read-only — they don't mutate state.
- **Prereqs:** none (S0-1 is parallel-safe; scaffold has no Firebase imports).
- **Rollback:** Revert. Module is unused until B-2.

#### B-2 · `feat/sync-stage-b-auth`
- **Goal:** Wire Google sign-in via `@capacitor-firebase/authentication`; identity persists across sessions and devices.
- **Audit first:** `docs/sync-impl/audits/B-2-AUDIT.md`.
- **Files touched:**
  - New `js/sync-auth.js` — module: `signIn()`, `signOut()`, `getCurrentUser()`, `onAuthChange(callback)`.
  - `js/platform.js` — extend with `Platform.auth` namespace that switches between `firebase/auth` (web) and `FirebaseAuthentication` plugin (native). Mirrors the existing `Platform.haptic` / `Platform.notify` shim pattern.
  - `index.html` — add settings-drawer "Cloud Sync" section: sign-in button, current-user display (email + photo), sign-out, sync status indicator (reads `tempo_sync_state`).
  - `css/styles.css` — minimal styling for the new section (matches existing settings-drawer rows).
  - `js/tempo-nav.js` — if settings drawer is opened from sub-nav, add the section.
  - `js/app.js` — call `Platform.auth.init()` on boot (no-op if `tempo_sync_enabled = '0'`).
  - iOS: `ios/App/App/Info.plist` — add `CFBundleURLTypes` for Firebase reverse-client-id deep link.
- **Engine-test plan:** New `tests/sync-auth.test.js` (mock-based since real Google flow can't run in test harness):
  - `signIn()` success path stores user; mock SDK returns user object → `getCurrentUser()` returns it.
  - `signOut()` clears user; `getCurrentUser()` returns null.
  - Auth state persists across module reload (mock localStorage / IndexedDB read).
  - Real auth flow tested manually per platform — documented in PR description.
- **Blast radius:** Settings drawer UI now has a new section; verify drawer layout doesn't regress on small screens (responsive smoke test). iOS `Info.plist` edit could break build if URL scheme malformed — verify `npx cap sync` and Xcode build before merge. No data movement yet.
- **Prereqs:** S0-1 (plugins must be installed).
- **Rollback:** Revert. Auth flow is gated behind `tempo_sync_enabled`; no records change.

#### B-3 · `feat/sync-stage-b-uploader`
- **Goal:** First real cloud write — Device A pushes its full snapshot, with B0 read-cloud-first guard (F9) and mandatory backup (F12).
- **Audit first:** `docs/sync-impl/audits/B-3-AUDIT.md`.
- **Files touched:**
  - `js/sync-engine.js` — implement `pushSnapshot()`:
    1. `Backup.exportLocal()` writes a full local backup file (F12).
    2. `pullCloudSnapshot()` reads the user's Firestore tree (F9 — Stage B0 guard).
    3. If cloud non-empty, route to Stage D handoff (D-1 stub) — abort upload.
    4. If cloud empty, `SyncState.set('hydrating')`, write snapshot to Firestore in dependency order (rest_log → meds → presets → history), `SyncState.set('ready')`.
    5. On error: `SyncState.set('error')`, surface user-facing error toast.
  - New `js/backup.js` — `exportLocal()` serializes every persisted store to a single JSON file (reuses parts of existing `js/export.js`), prompts download via Web Share API or download link. `importLocal()` is the complementary restore path (D-1 also uses it for the rare case the user wants to restore from backup mid-Stage-D).
  - New `js/sync-firestore.js` — wraps `@capacitor-firebase/firestore` (native) and `firebase/firestore` (web): `getDoc(path)`, `setDoc(path, data, options)`, `runTransaction(fn)`, `getCollection(path)`, `setBatch(writes)`. Single seam between SyncEngine and Firestore so SDK swaps are local.
  - `index.html` — add "Push to cloud" button in settings (manual trigger for now; auto-trigger comes later in E-1).
  - Settings UI updates to show progress + final status.
- **Engine-test plan:** New `tests/sync-uploader.test.js` with a mocked Firestore client:
  - Cloud-empty path uploads full snapshot (assert `setDoc` called per store).
  - Cloud-non-empty path triggers Stage D handoff (returns sentinel error, does NOT write).
  - `SyncState` transitions `ready → hydrating → ready` on success.
  - Backup file is written before any cloud call (assert call order via mock spy).
  - Failure mid-upload leaves `SyncState = error` (assert).
  - Refuse-writeback: if local has a `schemaVersion > 1` record (simulated future), it's preserved on disk and skipped in upload.
- **Blast radius:** First PR that performs cloud writes. `tempo_sync_state = hydrating` blocks all engine writes during upload — verify no UI lock-up (the gate exists in `persistence.js` but hasn't been flipped in production). Backup file writes ~50–500 KB to user disk; verify quota fallback path (graceful failure if Web Share API unavailable). On iOS, `LocalFileSystem` access via Capacitor Filesystem plugin if needed for backup — or fall back to share sheet.
- **Prereqs:** S0-1, B-1, B-2, A-1 (needs F6 phaseLog stamping for clean upload).
- **Rollback:** Revert + manually delete the Firestore project's `users/{uid}/...` tree from the console. Local backup is safe to leave in place.

#### B-4 · `feat/sync-stage-b-toast`
- **Goal:** Ship the toast surface for ≥2-entry remote `doseLog` arrival (F15). No merge engine yet — toast scaffold only.
- **Audit first:** `docs/sync-impl/audits/B-4-AUDIT.md`.
- **Files touched:**
  - New `js/sync-toast.js` — `Toast.medsArrival(count, deviceId)` slides up a non-blocking banner per the existing toast pattern (mirrors the undo-toast in `ui.js`). Auto-dismiss after 5s; tap to expand for details.
  - `css/styles.css` — toast styles (extend existing `.toast` if present).
  - `js/sync-engine.js` — emit a `meds-arrival` event hook with `(count, deviceId)` payload; SyncToast subscribes via `SyncEngine.on('meds-arrival', handler)`.
- **Engine-test plan:** New `tests/sync-toast.test.js`:
  - Toast fires once when count ≥2.
  - Does NOT fire for count == 1 (silent — ≥2 is the F15 threshold).
  - Does NOT fire for local-origin entries (filters on `deviceId !== getDeviceId()`).
  - Auto-dismisses after configured timeout.
  - Multiple rapid arrivals coalesce into a single toast (no toast spam).
- **Blast radius:** New toast UI; won't fire until merge engine (E-1) actually calls the hook. Visual regression: verify toast styling matches existing app aesthetic.
- **Prereqs:** B-3.
- **Rollback:** Revert. Toast never fires without E-1.

---

### Stage C — Device B fresh hydrate

#### C-1 · `feat/sync-stage-c-hydrate`
- **Goal:** Device B with no local data signs in and pulls down full state in strict order.
- **Audit first:** `docs/sync-impl/audits/C-1-AUDIT.md`.
- **Files touched:**
  - `js/sync-engine.js` — `hydrateFromCloud()`:
    1. `SyncState.set('hydrating')` — blocks all engine writes.
    2. Pull in strict order: rest-log → meds → presets → history.
    3. After each store completes, set `tempo_sync_hydrated/<store> = '1'` localStorage marker.
    4. On all-store completion, `tempo_sync_hydrated/all = '1'`, `SyncState.set('ready')`.
    5. On failure mid-hydrate, leave partial markers; on next boot, missing `all` marker triggers re-pull (forced re-hydrate of stores without per-store markers).
  - `js/app.js` — on boot, if signed in + `tempo_sync_hydrated/all` missing, trigger hydrate after `Platform.auth.init()` resolves.
  - `js/persistence.js` — verify `SyncState.canWrite()` blocks during hydrate (already does); add `SyncState.isHydrating()` convenience helper.
  - `js/history.js` — confirm `getDeviceId()` runs at module init (it does, via `History.init()`'s explicit call) — so deviceId is minted before any user gesture during hydrate.
  - Each engine's `loadAll()` / `loadState()` consumes the pull-down payload via a new `hydrateFromCloud(payload)` method that mirrors `loadState` but skips any in-memory state merge (cloud is canonical during Stage C).
- **Engine-test plan:** New `tests/sync-hydrate.test.js`:
  - Strict pull order verified via mocked Firestore (assert call sequence).
  - Per-store markers set after each completes.
  - Writes blocked during hydrate (mock a write attempt mid-hydrate, assert it's gated).
  - Missing marker on next init triggers re-pull.
  - DeviceId exists before hydrate starts.
  - Partial-failure recovery: kill mid-hydrate, re-init, verify only missing-marker stores re-pull.
- **Blast radius:** Boot path — a bug here breaks app start on Device B. Add a "force local-only" escape hatch in settings (manual `tempo_sync_enabled = '0'` toggle) for emergency. Manual smoke: install fresh on a second browser/device, sign in, verify all data lands.
- **Prereqs:** B-3 (cloud has data to pull).
- **Rollback:** Revert. `tempo_sync_hydrated` markers can be cleared manually via dev tools; local-only mode resumes.

---

### Stage D — Device B with existing standalone data

#### D-1 · `feat/sync-stage-d-imported-bucket`
- **Goal:** Device B with existing local data keeps its history in an "imported" bucket alongside synced data (F17 Alternative 2).
- **Audit first:** `docs/sync-impl/audits/D-1-AUDIT.md`.
- **Files touched:**
  - `js/history.js` — add `bucket: 'synced' | 'imported'` field on session records; default `'synced'` for new writes; `addSession` accepts an optional `bucket` parameter; add to `KNOWN_HISTORY_KEYS` so F19b doesn't smuggle it into `__forward`.
  - `js/history-ui.js` — show "Imported (pre-sync)" tag on entries with `bucket: 'imported'`; filter toggle to hide/show. Mirror the existing tag-bar pattern.
  - `js/sync-engine.js` — Stage D handoff (called from B-3's read-cloud-first path):
    1. Tag every existing local history row with `bucket: 'imported'` and `originDeviceId: getDeviceId()`.
    2. Mark every existing local meds record with `originDeviceId: getDeviceId()` for the manual-dedupe tool to use later.
    3. Then upload fresh snapshot (which now includes the imported-tagged rows alongside whatever pulls down from cloud).
  - New `js/sync-impl/manual-dedupe.js` — placeholder module exposing `ManualDedupe.scan()` returning candidate pairs (history rows with same `(date, duration, type)` across `synced` and `imported` buckets). Full UI deferred — ships if user requests it.
- **Engine-test plan:** New `tests/sync-imported-bucket.test.js`:
  - Stage D handoff tags pre-sync rows.
  - `bucket` field roundtrips through `getState()` / `loadState`.
  - UI renders bucket tag (DOM assertion).
  - Hide-imported filter works.
  - Tag filter logic in `addTag` / `removeTag` ignores `bucket` (it's a structural field, not a user tag).
- **Blast radius:** `history-ui.js` panel layout changes. Tag filter logic must distinguish `bucket` from user tags (the existing tag-bar logic dedups against `getAllTags()` — verify it doesn't accidentally surface `synced` / `imported` as user-selectable tags).
- **Prereqs:** B-3 (Stage D handoff hook exists in `pushSnapshot()`).
- **Rollback:** Revert. `bucket` field defaults to undefined → existing UI ignores it. Pre-sync rows stay in local IDB.

#### D-2 · `feat/sync-stage-d-reconcile`
- **Goal:** Steady-state per-med doseLog reconcile (F1) and clock-skew clamp (F16). Engine logic only.
- **Audit first:** `docs/sync-impl/audits/D-2-AUDIT.md`.
- **Files touched:**
  - `js/meds.js` — `reconcileDoseLog(med, incomingEntries)` helper:
    1. Dedup by `(deviceId, takenAt)` — exact-match wins.
    2. F16: clamp non-local entries (`entry.deviceId !== localDeviceId`) to `localNow ± 15min` window — drop entries outside this window with a warning log.
    3. F1: per-med ±15-min reconcile — collapse two entries with same medId + within ±15 min, regardless of deviceId (covers "I forgot, let me re-log it" cross-device case). Keep the earlier of the two; drop the duplicate.
    4. Returns deduped + reconciled list.
  - `js/sync-engine.js` — calls `reconcileDoseLog` after every meds pull/merge before writing back to local `MedsManager`.
  - `js/meds.js` — `recomputeLastTakenAt(med)` (added in A-1) called after reconcile (F4).
  - Expose `MedsManager.onMergeComplete(medId)` hook that fires after each med's doseLog is reconciled — used by E-1 to trigger F15 toast.
- **Engine-test plan:** Extend `tests/meds.test.js`:
  - Dedup by `(deviceId, takenAt)` works.
  - ±15-min reconcile collapses near-duplicates with different deviceIds.
  - ±15-min reconcile does NOT collapse entries with same deviceId (those are independent doses).
  - ±15-min clock-skew clamp on non-local entries (mock far-future entry → drop with log).
  - `lastTakenAt` re-derived correctly after merge.
  - Empty incoming entries produce no-op.
  - Idempotent: running reconcile twice on the same input produces the same output.
- **Blast radius:** Touches the most-used MedsManager path. Bug here corrupts dose history. Tests must cover edge cases (empty log, single entry, all-local, all-remote, mixed). Manual smoke: log dose on Device A → wait → log dose on Device B within ±15 min → verify only one survives reconcile.
- **Prereqs:** A-1 (F4 helper), B-3 (sync-engine exists).
- **Rollback:** Revert. Reconcile only runs during sync; without it, raw append-merge still works (just may have ±15-min duplicates the user has to manually clean up).

---

### Stage E — Steady-state

#### E-1 · `feat/sync-stage-e-merge-loop`
- **Goal:** Periodic push/pull loop with append-merge for streams + LWW for fields + per-record CAS via `runTransaction`. Decides F3 (BFRB stream choice) and F8 (distraction tombstone vs sessionId-keyed).
- **Audit first:** `docs/sync-impl/audits/E-1-AUDIT.md` — the largest audit; covers every synced store + the F3 / F8 decisions with rationale.
- **Files touched:**
  - `js/sync-engine.js`:
    - `startSteadyState()` — periodic timer (configurable interval; default 30s when foregrounded, paused when backgrounded via `Platform.network.onChange` + `visibilitychange`).
    - Iterates store registry, calls per-store merge.
  - Per-store merge functions (split into separate files for testability):
    - `js/sync-merge-meds.js` — meds metadata LWW + doseLog append-merge (calls `reconcileDoseLog` from D-2). Fires `meds-arrival` event for B-4 toast on ≥2 remote entries.
    - `js/sync-merge-history.js` — sessions append-merge dedup by `id`; note/tags LWW per-field; phaseLog already stamped (A-1) so dedup by `(deviceId, phaseStartedAt)` works.
    - `js/sync-merge-rest-log.js` — sleep LWW per-day; naps append-merge dedup by `(deviceId, startedAt)`.
    - `js/sync-merge-presets.js` — full-record LWW by `id` + `updatedAt`; tombstones for deletes (presets need `deletedAt` field — adds `deletedAt: null` to schema in this PR).
    - **F3 decision (documented in audit):** Consolidate `bfrbs_global` / `flow_bfrbs` / `pomodoro_bfrbs` into one tagged stream `bfrb_events` with `context: 'flow' | 'pomodoro' | 'global'`. Migration in `loadState`: union the three legacy keys → write `bfrb_events`; legacy keys removed on next save. Rationale: a single stream is structurally simpler for sync and matches the user's mental model ("how many BFRBs today across all contexts").
    - **F8 decision (documented in audit):** Move distraction logs to `sessionId`-keyed storage (`flow_distractions/{sessionId}` and `pomodoro_distractions/{sessionId}`). UI filters by current session. Reset is implicit (drop the key when session resets). Rationale: tombstones add a moving part; sessionId-keyed maps cleanly to the history record's `id`.
  - `js/sync-firestore.js` — wrap `runTransaction` for per-record CAS:
    - Read schemaVersion → if remote > local, abort (refuse-writeback).
    - Else, write new record with bumped `updatedAt`.
- **Engine-test plan:** New per-store test files:
  - `tests/sync-merge-meds.test.js` — append-merge dedup; LWW resolves to higher `updatedAt`; CAS aborts on stale schemaVersion; refuse-writeback on future records preserves on-disk state; merge is idempotent; F15 toast fires for ≥2 remote arrivals.
  - `tests/sync-merge-history.test.js` — sessions append-merge by `id`; note/tags LWW; phaseLog dedup by `(deviceId, phaseStartedAt)`.
  - `tests/sync-merge-rest-log.test.js` — sleep LWW; naps append-merge.
  - `tests/sync-merge-presets.test.js` — record LWW + tombstone deletes.
  - `tests/sync-bfrb-migration.test.js` — F3: legacy three-bucket data unions cleanly into `bfrb_events`.
  - `tests/sync-distractions-sessionid.test.js` — F8: sessionId-keyed; reset by removing key.
- **Blast radius:** Largest PR. Touches every synced store. Can corrupt data if merge logic is wrong. Heavy test coverage required. Manual end-to-end test (web + iOS) before merge: log dose / save session / edit note on Device A → verify on Device B within steady-state interval. F3 migration runs once on first load post-merge; if it fails partway, BFRB counts could double — add idempotency checks (legacy keys only deleted after `bfrb_events` write succeeds).
- **Prereqs:** A-1, B-3, B-4, C-1, D-2.
- **Rollback:** Revert + flip `tempo_sync_enabled = '0'` in settings to stop sync. Local data unaffected (per-record CAS prevents corruption mid-flight). F3 migration is one-way — if reverted, the unioned `bfrb_events` stays on disk but the engine reads only from `bfrbs_global` etc. as before; counts may show 0 until next merge. Mitigation: keep legacy keys for one release before deleting.

#### E-2 · `feat/sync-stage-e-offline-buffer`
- **Goal:** Q3-locked: buffered ops always preserve original wall-clock timestamp; op compaction; pending-op cap.
- **Audit first:** `docs/sync-impl/audits/E-2-AUDIT.md`.
- **Files touched:**
  - New `js/sync-buffer.js` — pending-op queue in IndexedDB (separate store `pending_ops` in `stopwatch_history_db`). Each op tagged with `originalWallClock` (captured at user-action time, not at sync time).
  - `js/sync-engine.js`:
    - On any write, if offline (per `Platform.network.isOnline()`), enqueue op.
    - On `online` event (via `Capacitor Network.addListener` on native, `window.online` on web), drain buffer in FIFO order.
    - Lock pending-op cap at 1000 (configurable). On overflow, drop oldest with toast warning ("Buffered changes exceeded cap; oldest changes lost — please re-sync").
    - Op compaction: collapse repeated single-field LWW writes on same record (keep only the latest).
  - `js/platform.js` — extend with `Platform.network.isOnline()` + `Platform.network.onChange(callback)`.
- **Engine-test plan:** New `tests/sync-buffer.test.js`:
  - Op queued while offline.
  - `originalWallClock` preserved verbatim through enqueue → drain.
  - Drain replays in FIFO order.
  - Compaction collapses repeated LWW writes on same record.
  - Cap drops oldest with toast warning.
  - Cross-restart: ops persisted in IDB survive a tab close.
- **Blast radius:** Adds a new IDB store. Boot must not fail if pending ops exist from a previous version (forward-compat). On iOS, `Network` plugin needs Cocoapods entry — verify `npx cap sync`.
- **Prereqs:** E-1.
- **Rollback:** Revert. Pending-op store can be cleared manually via dev tools.

#### E-3 · `feat/sync-stage-e-listeners`
- **Goal:** Real-time `onSnapshot` listeners + UX when refuse-writeback fires (downlevel-client warning).
- **Audit first:** `docs/sync-impl/audits/E-3-AUDIT.md`.
- **Files touched:**
  - `js/sync-firestore.js` — `subscribe(path, callback)` wrapping `onSnapshot`.
  - `js/sync-engine.js` — subscribe per-store on hydrate; on snapshot, run merge; throttle to avoid thrash (debounce 1s).
  - `js/sync-toast.js` — extend with `Toast.downlevelWarning(remoteSchemaVersion)` for refuse-writeback events: "Your phone is on a newer version. This device is read-only until you update."
  - `index.html` — settings drawer "Sync activity" indicator showing last-sync time + listener status.
- **Engine-test plan:** New `tests/sync-listeners.test.js`:
  - Subscribe registered per store on hydrate.
  - Snapshot triggers merge.
  - Refuse-writeback on receipt of future record triggers `Toast.downlevelWarning`.
  - Listener cleanup on sign-out.
  - Throttle: rapid snapshots coalesce into single merge call.
- **Blast radius:** Network/battery — `onSnapshot` listeners burn cellular data + battery. Pause when backgrounded (`visibilitychange`). On iOS, listeners are auto-paused when WebView is suspended; verify reconnect works on resume.
- **Prereqs:** E-1, E-2.
- **Rollback:** Revert. Polling (E-1) still works without listeners.

---

### Stage F — Optional cleanup (DEFERRED)

#### F-1 · `feat/sync-stage-f-manifest-registry`
- **Status:** **DEFERRED**. Ship only when adding a new sync-eligible store.
- **Goal:** Replace hardcoded store list in `Persistence.clear()` and `js/sync-engine.js` registry with a self-registering `StoreManifest`.
- **Files touched (when shipped):** `js/persistence.js`, `js/sync-engine.js`, every engine module (each calls `StoreManifest.register({...})` at module init).
- **Engine-test plan:** New `tests/sync-manifest.test.js`.
- **Blast radius:** Touches every persistence module — risky refactor.
- **Prereqs:** E-3.
- **Rollback:** Revert.

---

## Recommendation: ship Stage 0 + Stage A close-out + Stage B first

**The first 6 PRs (S0-1, A-1, B-1, B-2, B-3, B-4) get us to "Device A pushes to cloud successfully" — the first observable milestone.** Stage A close-out (A-1) sequences ahead of B but is a single bundled PR. Then Stage B is 4 small PRs of plumbing before the first cloud byte lands.

**Why this order despite Stage B looking slow:**

1. **Stage B is the foundation.** Stages C, D, and E all assume cloud data exists. Without B, the test surface for everything downstream is empty.
2. **Each B PR is small + isolated.** B-1 is a scaffold module (no behavior change). B-2 is auth (no data movement). B-3 is the upload wire (gated behind `tempo_sync_enabled`). B-4 is a toast surface (no engine logic). Splitting them keeps blast radius per PR low and makes review tractable.
3. **The `tempo_sync_state` kill switch (F13) is already shipped.** If anything in B-3 misbehaves, flipping the gate to `error` halts all writes immediately. Local-first contract holds.
4. **A-1 is small but mandatory.** F4 / F6 / F7 / F21 are the last sync prereqs; without them, B-3's snapshot would either lack `phaseLog` deduplication keys (F6) or push data that violates the per-device contract (F21). A-1 ships in a single PR because all four items are read-side stamps + audits — low-risk bundling.
5. **Cross-stage parallelism is safe after B-4.** C-1 and D-1 can develop in parallel (they touch different surfaces), but ship sequentially per the Phase 5 cadence rule.

**What ships per session:**

- **Session 1 (foundation):** S0-1 + A-1 in parallel branches. Two PRs. Manual setup of Firebase project happens during S0-1 review.
- **Session 2 (Stage B engine):** B-1 + B-2 in parallel branches. Two PRs.
- **Session 3 (Stage B uploader + toast):** B-3 then B-4 sequentially. Two PRs.
- **Session 4 (Stage C):** C-1. One PR.
- **Session 5 (Stage D):** D-1 then D-2. Two PRs.
- **Session 6 (Stage E):** E-1 then E-2 then E-3. Three PRs.

Total: 12 PRs across 6 sessions. F-1 (manifest registry) is deferred indefinitely.

**Open decisions deferred to E-1:**

- F3 (BFRB stream consolidation vs `session.bfrbs`-canonical) — recommended choice: consolidate into `bfrb_events`. Documented in PR audit.
- F8 (distraction tombstones vs sessionId-keyed) — recommended choice: sessionId-keyed. Documented in PR audit.

If either of these decisions needs to escalate to the user, the audit comment in the PR is the surface for it.

---

## Verification — how to test end-to-end

Per-PR engine tests are listed inline above. End-to-end verification of "Device A pushes, Device B pulls" requires manual testing across two physical devices:

1. **Stage B verify:** On Device A (laptop), sign in via web, manually trigger "Push to cloud" from settings. Verify Firestore console shows the user's data tree under `users/{uid}/...`.
2. **Stage C verify:** On Device B (iPhone via Capacitor), sign in with the same Google account on a fresh install. Verify all data appears within the hydrate window. Verify no writes are accepted during hydrate (try logging a dose mid-hydrate; should be silently gated).
3. **Stage D verify:** On Device B (a second laptop with existing local data), sign in. Verify pre-existing data lands in "Imported" bucket, fresh writes go to "Synced" bucket. Verify both render in history.
4. **Stage E verify:** Log a dose on Device A; within 30s (steady-state interval) verify it appears on Device B. Verify the F15 toast fires when ≥2 doses arrive in one merge cycle. Verify offline writes on Device B replay on reconnect with original timestamps preserved.

---

## What's deferred / out of scope

- **F19c (per-store manifest registry).** Hardcoded store list works at current store count. Refactor only when adding a new sync-eligible store.
- **HIPAA BAA.** Spark plan can't self-serve. Personal-use posture is fine; public-launch story would require a paid GCP plan.
- **Multi-user sharing / read-only viewers / family accounts.** Not in v2.0 strategy; out of scope.
- **End-to-end encryption.** Firestore at-rest encryption only. Out of scope; revisit if HIPAA story formalizes.
- **Conflict-resolution inbox UI.** v2.0 explicitly chose silent LWW for editable fields. The F15 toast is the only conflict-surface UX.
- **Server-side merge / Cloud Functions.** All merge logic runs client-side in `js/sync-engine.js`. Out of scope; revisit if client merge becomes a bottleneck.

---

## Sources

- `docs/CLOUD-SYNC-STRATEGY.md` v2.0 — per-store merge rules, Stage A → E, F-numbering.
- `docs/sync-review/BACKEND-SELECTION.md` — Firebase / Firestore decision, the two tradeoffs.
- `docs/sync-review/CONSOLIDATED-FINDINGS.md` — three-lens adversarial review feeding into v2.0.
- Firebase docs: pricing, quotas, transactions, locations.
- Capacitor plugins: `@capacitor-firebase/authentication`, `@capacitor-firebase/firestore`.

---

*This plan is a snapshot post-Phase 6. Re-run the methodology if scope changes (new sync-eligible store, multi-user requirement, public-launch decision).*
