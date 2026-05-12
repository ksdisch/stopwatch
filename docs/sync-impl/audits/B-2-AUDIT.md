# B-2 · Stage B auth — Google sign-in via `@capacitor-firebase/authentication`

**PR:** `feat/sync-stage-b-auth` → `main`
**Stacked on:** `feat/sync-stage-b-engine-scaffold` (PR #58 / B-1). B-2's
branch is cut from B-1's branch, not from `main`. PR target is `main`;
when B-1 merges, GitHub auto-trims B-2's diff to B-2-only. See
"Manual setup steps" for the exact `git checkout -b ...` command the
engine-implementer runs.
**Scope:** Wire Google sign-in across web (`firebase/auth`
`signInWithPopup`) and iOS (`@capacitor-firebase/authentication`
plugin). Introduce `Platform.auth` namespace. Land a visible "Cloud
Sync" section in the settings drawer (sign-in / current-user display /
sign-out / sync-status indicator / `tempo_sync_enabled` toggle). Wire
iOS deep-link callback via `CFBundleURLTypes`. No cloud writes yet
(B-3) — but auth state changes flip the dormant `tempo_sync_state` gate
to enforce the "signed-out = no sync" contract.
**Status:** Audit-only commit. Code commit follows after human review.

This audit enumerates every site B-2's code commit will touch, the
F-invariant respect map (including the new auth-state-gates-sync
invariant introduced here), risks, and test scope. Goal is to fix
blast radius *before* writing code so review focuses on the right
surfaces.

---

## Goal

Land `js/sync-auth.js` (the `signIn` / `signOut` /
`getCurrentUser` / `onAuthChange` engine) plus a new
`Platform.auth` namespace in `js/platform.js` that switches between
web (`firebase/auth` modular SDK) and native
(`@capacitor-firebase/authentication` plugin). Ship the user-facing
"Cloud Sync" section in the settings drawer that surfaces sign-in
state and the developer toggle for `tempo_sync_enabled`. Add iOS
`CFBundleURLTypes` so the system Google sign-in sheet redirects back
into the Capacitor WebView. Wire `SyncEngine.onAuthChange` so future
PRs (B-3) can trigger the first cloud byte on successful sign-in. No
Firestore reads / writes in B-2.

---

## Orchestrator note — ui-wirer Phase 4 FIRES

**Yes.** First sync-PR session this stage that touches the user-facing
DOM. The affected-files table includes `index.html` (new settings-drawer
section), `css/styles.css` (minimal — reuses `.tempo-settings-item`
styles + a small new `.cloud-sync-section` block), `js/tempo-nav.js`
(no new wiring — drawer auto-closes via the existing
`drawer.querySelectorAll('button')` loop in `wireSettingsDrawer`, but
buttons need to opt out of auto-close in the sign-in case; documented
below), and the iOS `Info.plist` (UI-adjacent because the deep-link
scheme is the bridge that makes the system Google sheet return to the
app).

Workflow: audit → engine-implementer → engine-tester → **ui-wirer
Phase 4 (this PR's settings-drawer DOM + CSS + tempo-nav opt-out
attribute + iOS plist URL types)** → pr-shipper.

---

## Headline findings

1. **`Platform.auth` mirrors the existing `Platform.haptic` /
   `Platform.notify` shim pattern.** Web path imports `firebase/auth`
   from the modular SDK (gated behind `tempo_sync_enabled === '1'`,
   loaded lazily on first `Platform.auth.signIn()` call so the dormant
   web boot stays byte-equivalent). Native path uses
   `window.Capacitor.Plugins.FirebaseAuthentication.signInWithGoogle()`.
   `Platform.auth` is the only call surface from `sync-auth.js`. No
   call site touches the SDKs directly.
2. **`sync-auth.js` (the engine module) is platform-agnostic.** It
   wraps `Platform.auth.*` and exposes a project-internal API
   (`signIn()`, `signOut()`, `getCurrentUser()`,
   `onAuthChange(callback)`). This lets engine tests stub
   `window.Platform.auth` and exercise the state machine without
   loading Firebase. Mirrors how `tests/meds.test.js` stubs
   `window.History`.
3. **The visible developer toggle for `tempo_sync_enabled` SHIPS in
   B-2.** B-1's audit explicitly deferred this. B-2's "Cloud Sync"
   section in the settings drawer surfaces three controls:
   (a) "Enable cloud sync" toggle — flips `tempo_sync_enabled` via
   `SyncFlag.enable()` / `.disable()`;
   (b) "Sign in with Google" button (when signed out) or
   "Signed in as ..." + photo + "Sign out" button (when signed in);
   (c) "Status: Ready / Hydrating / Error" line reading
   `SyncState.get()` from `persistence.js`. Layered gate: writes
   require all three to be green (`tempo_sync_enabled === '1'` +
   `getCurrentUser() !== null` + `SyncState.canWrite() === true`).
   B-3 implements the gate in `pushSnapshot()`; B-2 only wires the
   surfaces.
4. **`js/sync-firebase-config.js` script tag — UNCONDITIONAL load.**
   The file already exists on disk (committed dormant in S0-1). B-2
   adds `<script src="js/sync-firebase-config.js"></script>` to
   `index.html` unconditionally. Rationale:
   (a) the config object is passive — assigning
   `window.FirebaseConfig` has zero side effects;
   (b) conditional script loading via `appendChild` adds boot-path
   complexity for no benefit (the bytes are ~600B);
   (c) the SDK itself stays unloaded behind the flag — only the
   config object is materialized at boot.
   The Firebase SDK is imported lazily by `Platform.auth.signIn()` on
   first invocation. See "Sign-off checklist" item enforcing this.
5. **F13 interaction — auth state DOES affect `tempo_sync_state`.**
   On sign-in success (web or native): if `tempo_sync_enabled === '1'`
   AND `tempo_sync_state !== 'hydrating'`, leave gate at `'ready'`
   (no change). On sign-out: leave gate at `'ready'` (sign-out itself
   doesn't pause writes — it just severs the cloud destination; local
   writes still proceed per local-first contract). On sign-in error:
   leave gate untouched. **B-2 does NOT flip the gate.** The gate is
   flipped by `SyncEngine.pushSnapshot()` (B-3) and
   `SyncEngine.hydrateFromCloud()` (C-1). Confirmed by re-reading
   `persistence.js` lines 1–39 and `docs/CLOUD-SYNC-STRATEGY.md`
   row 39.
6. **New invariant introduced in B-2: "auth-state gates sync writes."**
   Not in the existing F1–F21 numbering. Documented inline in this
   audit and in `sync-auth.js` as a code comment. Contract:
   `SyncEngine.pushSnapshot()` (B-3) MUST verify
   `SyncAuth.getCurrentUser() !== null` before any Firestore call.
   B-2 ships the gate-checker (`getCurrentUser()`), B-3 wires it into
   the upload path. Tracked here so a future auditor sees the
   layering: F13 = local write gate, B-2 invariant = cloud write
   gate.
7. **iOS `CFBundleURLTypes` — exact XML snippet to paste.** The
   Google sign-in sheet on native iOS redirects via the
   reversed-client-id URL scheme from `GoogleService-Info.plist`. S0-1
   shipped that plist with
   `REVERSED_CLIENT_ID =
   com.googleusercontent.apps.66959649115-583frfdoh0645dmp5sovk6visi9m5fmi`.
   B-2 adds this `<dict>` block inside the top-level `<dict>` in
   `ios/App/App/Info.plist` (anywhere before the closing `</dict>` on
   line 48):

   ```xml
   <key>CFBundleURLTypes</key>
   <array>
       <dict>
           <key>CFBundleURLSchemes</key>
           <array>
               <string>com.googleusercontent.apps.66959649115-583frfdoh0645dmp5sovk6visi9m5fmi</string>
           </array>
       </dict>
   </array>
   ```

   This is the exact value the engine-implementer pastes — no
   placeholder. The string MUST match
   `GoogleService-Info.plist`'s `REVERSED_CLIENT_ID` byte-for-byte;
   any mismatch silently fails the redirect on first sign-in.
8. **Drawer button auto-close behavior.** Existing
   `tempo-nav.js:wireSettingsDrawer` (line 255–296) loops over
   `drawer.querySelectorAll('button')` and adds a `setTimeout(close, 0)`
   listener — so EVERY button in the drawer auto-closes the drawer
   after a tap. For the sign-in button, this is fine (the user is
   about to navigate away to the Google sheet anyway). For the
   `tempo_sync_enabled` toggle, this is wrong — the user wants to
   keep the drawer open after flipping the toggle so they can see the
   new state. Fix: add `data-keep-drawer-open` attribute on the toggle
   row, and amend the loop to skip those buttons. This is a
   one-line `tempo-nav.js` edit; the audit calls it out under
   ui-wirer's scope.
9. **Recovery / future-proofing for `Platform.auth` test harness.**
   `js/platform.js` is loaded by `tests/index.html` line 28 today (it
   wraps haptic + notification call sites used by `flow.test.js`
   etc.). Adding `Platform.auth` to the same module means tests
   automatically pick it up. New `sync-auth.test.js` stubs
   `window.Platform.auth` per-case (just like meds tests stub
   `window.History`) — no real Firebase imports. Web boot itself
   stays byte-equivalent because the Firebase SDK is imported lazily
   on first `signIn()` call.

---

## Affected files

| Path | Change type | Notes |
|------|-------------|-------|
| `js/sync-auth.js` | **add** | New engine module. Public API: `SyncAuth.init()`, `SyncAuth.signIn()` (returns `Promise<User \| null>`), `SyncAuth.signOut()` (returns `Promise<void>`), `SyncAuth.getCurrentUser()` (returns `{ uid, email, displayName, photoURL } \| null`), `SyncAuth.onAuthChange(callback)` (returns unsubscribe fn). Internally delegates to `Platform.auth.*` (which switches web/native). Caches the current user in-memory; emits `SyncEngine.emit('auth-change', user)` on every transition. `init()` is idempotent and a no-op when `SyncFlag.isEnabled() === false`. **No DOM access. No Firebase imports — all SDK access goes through `Platform.auth`.** IIFE singleton, mirrors `SyncEngine` / `SyncFlag` module style. |
| `js/platform.js` | **modify** | Extend with `Platform.auth` namespace. Mirrors existing `Platform.haptic` / `Platform.notify` shim shape. Public methods: `Platform.auth.init()`, `Platform.auth.signIn()`, `Platform.auth.signOut()`, `Platform.auth.getCurrentUser()`, `Platform.auth.onAuthChange(callback)`. Native branch reads `window.Capacitor.Plugins.FirebaseAuthentication` and calls `signInWithGoogle({ scopes: ['profile', 'email'] })`. Web branch lazily imports `firebase/auth` from CDN on first call (`https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js`), initializes the app via `window.FirebaseConfig`, calls `signInWithPopup(new GoogleAuthProvider())`. Both branches return a normalized user shape so callers stay platform-agnostic. **Returns no-op stubs when `tempo_sync_enabled === '0'`** so tests + flag-off boots don't pay any SDK cost. |
| `js/sync-engine.js` | **modify** | One-line addition: `SyncAuth.onAuthChange((user) => emit('auth-change', user))` inside `SyncEngine.init()`'s flag-on branch. Today's `init()` is documented as "still a no-op when flag-on in B-1"; B-2 lights up the first non-no-op behavior. The `emit` machinery already exists. No new public API. |
| `index.html` | **modify** (ui-wirer) | Two edits: (1) add new "Cloud Sync" section inside the existing `<div id="tempo-settings-drawer">` (after `bfrb-volume-slider` div on line 80). New section is a `<div class="tempo-settings-item tempo-cloud-sync-section">` containing: a sub-heading row, a toggle row (`<button id="cloud-sync-toggle" data-keep-drawer-open>` with role="switch" + aria-checked), a sign-in / current-user row (`<div id="cloud-sync-identity">`), a status row (`<span id="cloud-sync-status">`). (2) Add `<script src="js/sync-firebase-config.js">` and `<script src="js/sync-auth.js">` to the script-load block. Placement: `sync-firebase-config.js` between `persistence.js` (line 862) and `sync-flag.js` (line 863) so the config object exists before SyncAuth ever runs. `sync-auth.js` between `sync-engine.js` (line 864 post-B-1) and `audio.js` so SyncAuth can register its onAuthChange listener during boot. |
| `css/styles.css` | **modify** (ui-wirer) | Add `.tempo-cloud-sync-section` block (~30 lines). Reuses `.tempo-settings-item` background / hover / padding; adds an inner flex-column for the sub-rows; small styling for `.cloud-sync-status[data-state="ready" \| "hydrating" \| "error"]` (color-coded dots). No new color tokens — uses `var(--text)` / `var(--text-secondary)` / `var(--accent-error)` already defined. |
| `js/tempo-nav.js` | **modify** (ui-wirer) | One-line amendment in `wireSettingsDrawer` (around line 288): change the button loop's filter so buttons with `data-keep-drawer-open` skip the auto-close timeout. Diff is roughly: `drawer.querySelectorAll('button:not([data-keep-drawer-open])').forEach(...)`. Wiring of the actual click handlers (sign-in / sign-out / toggle) is engine-implementer's job (lives in `sync-auth.js` or a thin glue file — implementer's call; recommendation: glue lives in `sync-auth.js` so the engine owns its own DOM bindings, mirroring how `meds-ui.js` owns Meds bindings). |
| `js/app.js` | **modify** | Add `SyncAuth.init();` inside the "Initialize modules" block, after `SyncEngine.init()` (line 29). Order matters: `SyncEngine.init()` must run first to register its `onAuthChange` listener before `SyncAuth.init()` fires the initial auth-state event on cold-boot. Like `SyncEngine.init()`, `SyncAuth.init()` is a no-op when the flag is off. |
| `ios/App/App/Info.plist` | **modify** | Add `CFBundleURLTypes` key + nested arrays as shown in Headline finding #7. **Exact `REVERSED_CLIENT_ID` value:** `com.googleusercontent.apps.66959649115-583frfdoh0645dmp5sovk6visi9m5fmi`. Placement: anywhere inside the top-level `<dict>` (before the closing `</dict>` on line 48). Recommended placement: directly before `UIViewControllerBasedStatusBarAppearance` key (line 46). |
| `tests/sync-auth.test.js` | **add** | New test file. 5+ cases (see "Test scope"). Stubs `window.Platform.auth` per-case; no real Firebase imports. Mirrors the mock-based pattern from `meds.test.js`. |
| `tests/index.html` | **modify** (pr-shipper) | Add `<script src="../js/sync-auth.js"></script>` to the engine modules block (after `sync-engine.js` line 44). Add `<script src="sync-auth.test.js"></script>` to the test suites block (after `sync-engine.test.js` line 58). |
| `sw.js` | **modify** (pr-shipper) | Append `'./js/sync-auth.js'` and `'./js/sync-firebase-config.js'` to the `ASSETS` array. **Bump `CACHE_NAME`** version string — pr-shipper picks the value. Current is `'stopwatch-v66-sync-engine-scaffold'`; recommended bump `'stopwatch-v67-sync-auth'`. |

**Total: 11 files** (5 modify under code-path, 2 add under code-path,
1 add under tests, 1 modify under tests, 1 modify under iOS, plus 3
pr-shipper / ui-wirer-owned: `index.html` script tag and DOM, `sw.js`,
`tests/index.html`).

---

## Sync invariants touched

Each row records the F# status for B-2 specifically. "Pass-through" =
B-2 does not mutate the invariant; existing engine code already
satisfies it. "New" = invariant introduced by B-2.

| F# | Description | Status in B-2 |
|----|-------------|--------------|
| F2 | Session IDs `${deviceId}-${ts}-${counter}` + `legacyId` | **Pass-through.** Auth doesn't touch session records. |
| F10 | `deviceId` + `updatedAt` at write sites | **Pass-through.** No new write sites; B-2 only reads auth state. |
| F13 | `tempo_sync_state` write gate | **Not touched.** Auth state changes do NOT flip the gate. The gate is owned by the upload + hydrate paths (B-3, C-1). See Headline finding #5. **Audit test case asserts:** signing in/out does not call `SyncState.set()`. |
| F19a | `schemaVersion` stamping + refuse-writeback | **N/A.** No record writes in B-2. |
| F19b | `__forward` passthrough (top-level unknowns) | **N/A.** No record reads/writes in B-2. |
| F21 | `alarmFired` per-device, never synced | **Pass-through (structural).** No new synced field; auth state lives in Firebase SDK's IDB (not Tempo's stores), so no `alarmFired` exposure surface. |
| **B-2 new** | **Auth state gates cloud writes** | **Introduced here.** `SyncAuth.getCurrentUser()` is the gate check. Contract: `SyncEngine.pushSnapshot()` (B-3) MUST verify `getCurrentUser() !== null` before any Firestore call. B-2 ships the gate-checker; B-3 wires it. Documented inline in `sync-auth.js` as a comment block referencing this audit. |

**Summary: F1–F21 are pass-through or N/A for B-2.** B-2's contract is
read-only on Tempo's stores; the only state mutation is the Firebase
Auth SDK's own IDB (which Tempo doesn't sync). The new invariant
("auth state gates cloud writes") is layered onto F13: F13 = local
write gate (hydrate / error pause); B-2 invariant = cloud write gate
(must be signed in to push). Both gates must be green for B-3 to
upload.

---

## Risks

| Risk | Likelihood | Blast radius | Mitigation |
|------|------------|--------------|------------|
| Web `signInWithPopup` is blocked by the browser's popup blocker on first user gesture (rare — but Safari + content blockers can intercept). | med | local-only (sign-in fails silently from user's view) | `Platform.auth.signIn()` on web wraps the popup call in a try/catch; on `popup-blocked` error, surface a non-blocking inline message in the Cloud Sync section ("Popup blocked — allow popups for this site to sign in"). Engine-implementer adds the error path; ui-wirer adds the inline error DOM slot. Manual smoke: test on Safari (default popup-blocker on) + Chrome. |
| iOS `CFBundleURLTypes` `REVERSED_CLIENT_ID` typo (single character off) silently fails the redirect — user signs in via Google sheet, then app receives no callback, sits on the "Signing in..." spinner forever. | med | native-build (iOS sign-in unusable until fixed) | Audit specifies the exact byte-for-byte string above. Sign-off checklist enforces the implementer pastes verbatim and does NOT manually retype. Manual smoke: build to physical iPhone (free-cert refresh per `iOS-BUILD.md`), tap Sign in with Google, complete the sheet, verify app receives the callback within 3s. If callback never arrives, the most likely cause is a typo in `Info.plist` — `xmllint --noout ios/App/App/Info.plist` confirms valid plist syntax. |
| `@capacitor-firebase/authentication` plugin throws at runtime because its native pod isn't actually installed (Podfile updated in S0-1 but `pod install` not re-run on this machine). | low | native-build (sign-in crashes the WebView on iOS) | S0-1's PR description includes `npx cap sync ios` as a manual setup step. B-2's PR description includes a sign-off item asking the user to confirm `pod install` was run (the auto-`cap sync` runs it). The `Platform.auth` native branch defensively checks `window.Capacitor.Plugins.FirebaseAuthentication` exists before calling its methods; if missing, falls back to surfacing an error in the Cloud Sync section ("Native auth plugin unavailable — rebuild iOS app"). |
| User cancels the Google sign-in sheet mid-flow (taps Cancel or swipes the sheet down). Both SDKs throw distinct errors. | med | local-only (UX confusion if cancellation looks like a failure) | `Platform.auth.signIn()` catches the cancellation-shaped errors (`auth/popup-closed-by-user` on web, plugin-specific code `12501` on Android-style native — iOS variant TBD by implementer testing) and returns `null` instead of throwing. `sync-auth.js` treats `null` return as a no-op (no `auth-change` event fires). UI stays on the signed-out state. Test case: stub `Platform.auth.signIn` to resolve to `null`; assert no state change. |
| Sign-out called while `tempo_sync_state === 'hydrating'` (mid-pull). Sign-out severs the auth token mid-network-request, Firestore SDK errors, gate gets stuck on `hydrating`. | low | data-correctness (writes blocked until manual `tempo_sync_state` reset) | B-2 doesn't ship hydrate, so this is forward-looking. C-1 owns the resilience. **B-2 mitigation:** disable the Sign out button when `SyncState.get() === 'hydrating'`. ui-wirer adds an `aria-disabled` + `data-disabled` attribute on the button, wired to a `SyncState.get()` poll on drawer-open. Engine-implementer wires the poll. |
| Settings drawer layout regresses on small screens (iPhone SE, 320px wide) after adding the Cloud Sync section. The drawer is `position: absolute; right: 4px` with a fixed-ish `min-width: 220px` (see `tempo-shell.css` line 238). | med | web-bytes + native-build (UX) | New section reuses `.tempo-settings-item` and stays inside the same `min-width: 220px` container; identity row (email + photo) is the only widening risk. Mitigation: truncate long emails with `text-overflow: ellipsis; max-width: 160px`. Manual smoke at 320px / 375px / 414px widths plus iPad. ui-wirer test in the standard Phase 4 checklist. |
| Lazy-loaded Firebase web SDK fails to load (CDN outage, content blocker). User taps "Sign in" — nothing happens. | low | local-only (web sign-in unavailable until network/CDN recovers) | `Platform.auth.signIn()` on web awaits the dynamic import; on rejection, throws to `sync-auth.js` which surfaces a UI error message ("Sign-in service unavailable — check connection"). Native path unaffected (uses the bundled plugin). Test case: stub `import()` to reject; assert UI error path. |
| Firebase deep-link URL scheme `com.googleusercontent.apps.66959649115-...` collides with another app installed on the same iPhone. Only one app can claim a URL scheme on iOS. | very-low | native-build (sign-in might redirect to a third-party app on the same device) | URL schemes are project-unique (Firebase per-project assignment). The `66959649115` segment is the GCM_SENDER_ID for project `tempo-sync-6f7b2`, so collision requires another developer to use the identical sender ID — practically impossible. Documented; no mitigation needed. |
| `js/sync-firebase-config.js` script-tag insertion order is wrong — `sync-auth.js` runs before `window.FirebaseConfig` is assigned, web auth init throws. | low | web-bytes (web sign-in unavailable until fixed) | Audit specifies the exact placement: `sync-firebase-config.js` BEFORE `sync-flag.js` BEFORE `sync-engine.js` BEFORE `sync-auth.js`. ui-wirer's job. Sign-off checklist enforces the order. Manual smoke: open browser console post-load, type `window.FirebaseConfig`, expect the populated object. |
| Drawer button `auto-close on click` regression: forgot to honor `data-keep-drawer-open` on the toggle, so flipping the cloud-sync toggle closes the drawer. | low | local-only (UX papercut) | ui-wirer's job. The diff in `tempo-nav.js:wireSettingsDrawer` is one selector change. Sign-off checklist enforces. Manual smoke: tap toggle, assert drawer stays open. |

**Risk count: 10** (low: 5, med: 5, high: 0, very-low: 1 counted as
low for breakdown). Breakdown for return-format header: low 6, med 5,
high 0.

---

## Test scope

### New tests required: `tests/sync-auth.test.js`

Minimum 6 cases. Per-test scope (engine-tester writes the assertions;
B-2 audit enumerates the contract). All cases stub
`window.Platform.auth` per-case (no real Firebase imports). Mirrors
the mock-based pattern from `meds.test.js`.

1. **`signIn()` success path stores the user.** Stub
   `Platform.auth.signIn` to resolve with
   `{ uid: 'test-uid', email: 'k@example.com', displayName: 'Kyle',
   photoURL: null }`. Call `SyncAuth.signIn()`. Assert
   `getCurrentUser()` returns the stored user; `SyncEngine.emit` was
   called once with `('auth-change', <user>)`.
2. **`signOut()` clears the user.** Sign in first (per case 1), then
   stub `Platform.auth.signOut` to resolve void; call
   `SyncAuth.signOut()`. Assert `getCurrentUser()` returns `null`;
   `SyncEngine.emit` was called with `('auth-change', null)`.
3. **`onAuthChange(callback)` fires on every transition.** Register
   a callback via `SyncAuth.onAuthChange`. Stub `Platform.auth` to
   simulate sign-in then sign-out. Assert callback was called twice
   with the right args (user, null). Assert the unsubscribe fn
   returned by `onAuthChange` actually unsubscribes (third transition
   doesn't fire the callback).
4. **Auth state persists across module reload (web path semantics).**
   Stub `Platform.auth.getCurrentUser` to return the previously
   signed-in user (simulates the Firebase SDK rehydrating from IDB
   on cold boot). Call `SyncAuth.init()`. Assert `getCurrentUser()`
   returns the rehydrated user without calling `signIn()`. Asserts
   the cold-boot path correctly delegates to the platform shim.
5. **Web platform path vs native platform path.** Two sub-cases:
   (a) stub `window.Capacitor = { isNativePlatform: () => true }` and
   inject a fake `FirebaseAuthentication` plugin into
   `window.Capacitor.Plugins`; call `Platform.auth.signIn()` (or
   `SyncAuth.signIn()` going through it); assert the native plugin's
   `signInWithGoogle` was called.
   (b) stub `window.Capacitor = null` and stub a fake dynamic-import
   for `firebase/auth`; assert the web path tries to call
   `signInWithPopup`.
   This is the critical test that catches a future regression where
   the shim leaks a native call onto web (or vice versa).
6. **Sign-in cancellation returns null, fires no event.** Stub
   `Platform.auth.signIn` to resolve `null` (simulating the user
   tapping Cancel). Call `SyncAuth.signIn()`. Assert
   `getCurrentUser()` is still null AFTER the call; assert
   `SyncEngine.emit` was NOT called with `'auth-change'`. Guards the
   cancellation UX contract.
7. **F13 guard — auth state changes do NOT flip
   `tempo_sync_state`.** Spy on `SyncState.set` (the persistence.js
   module). Sign in, sign out, sign in again — assert
   `SyncState.set` was never called. This is the audit-headline
   assertion that prevents future "convenience" code from
   accidentally entangling auth state with the write gate.

Optional additional cases the engine-tester can add at their
discretion:

- **`init()` is a no-op when `tempo_sync_enabled === '0'`.** Set
  flag to `'0'`; call `SyncAuth.init()`; assert
  `Platform.auth.getCurrentUser` was NOT called.
- **`init()` is idempotent.** Call twice; assert the second call
  doesn't register a duplicate `onAuthChange` listener.

Real-platform auth flow (full end-to-end Google sign-in) is tested
manually per platform — documented in PR description with steps for
web + iOS.

### Existing tests at risk

- **`tests/sync-engine.test.js`** (B-1) — likely needs zero changes.
  B-2 adds ONE line to `SyncEngine.init()` (the `onAuthChange` wiring
  inside the flag-on branch), which is no-op'd when the test stubs
  `SyncAuth` or `Platform.auth` to absent. Verify by running the
  full suite after implementation.
- **`tests/flow.test.js` / `tests/timer.test.js`** — likely needs
  zero changes. `Platform.haptic` / `Platform.notify` paths
  unchanged.
- **`tests/sync-stamps.test.js`** (A-1) — likely needs zero
  changes.

No engine-test file is rewritten or restructured by B-2.

### Test-runner harness considerations

- `tests/index.html` already loads `platform.js` (line 28) and
  `sync-engine.js` (line 44). B-2 adds `sync-auth.js` after
  `sync-engine.js`.
- `Platform.auth` is automatically picked up because tests load
  `platform.js` already. New tests stub
  `window.Platform.auth = { signIn: ..., ... }` per-case (overriding
  the live Platform namespace). The override is set in a `beforeEach`
  / `setup()` block and torn down in `afterEach` / `teardown()` — the
  test runner doesn't have hooks (per `test-runner.js`'s existing
  shape), so the pattern is "stub at the top of each `it()` block."
  Engine-tester pattern-matches `meds.test.js` for the canonical
  shape.

---

## Manual setup steps

### Branch setup (engine-implementer's first command)

B-2 is **stacked on B-1**. Engine-implementer runs:

```bash
git fetch origin
# Checkout B-1's branch as the local base
git checkout feat/sync-stage-b-engine-scaffold
git pull origin feat/sync-stage-b-engine-scaffold
# Cut B-2's branch from B-1's head
git checkout -b feat/sync-stage-b-auth
```

PR target is `main`. While B-1 is unmerged, GitHub will show B-1's
diff + B-2's diff in the PR view; once B-1 merges to `main`, GitHub
auto-trims to B-2-only. Pr-shipper opens the PR with a note linking
back to B-1's PR.

**Important:** If B-1 is force-pushed (e.g., post-review fixup),
engine-implementer must rebase B-2 on top of the new B-1 head:
`git rebase --onto feat/sync-stage-b-engine-scaffold OLD_SHA`.

### Firebase + iOS prerequisites

The following are S0-1 deliverables. **B-2 verifies but does not
re-run them.** If any of these is missing, B-2 cannot proceed:

- `js/sync-firebase-config.js` exists with the populated
  `window.FirebaseConfig` object (verified — Firebase project
  `tempo-sync-6f7b2` in us-central1).
- `capacitor.config.json` has the `FirebaseAuthentication` plugin
  block with `skipNativeAuth: false` and `providers: ["google.com"]`
  (verified).
- `ios/App/App/GoogleService-Info.plist` exists with the
  REVERSED_CLIENT_ID
  `com.googleusercontent.apps.66959649115-583frfdoh0645dmp5sovk6visi9m5fmi`
  (verified).
- `ios/App/Podfile` has
  `pod 'CapacitorFirebaseAuthentication'` (verified — auto-added by
  S0-1's `npx cap sync ios`).
- Firebase Console → Authentication → Google sign-in is ENABLED
  (manual user step from S0-1's `FIREBASE-SETUP.md`).
- iOS bundle ID `com.ksdisch.tempo` is registered in the Firebase
  iOS app (manual user step from S0-1's setup doc).
- Web origins (`https://ksdisch.github.io`, `http://localhost:*` for
  testing) are added to the Firebase Authentication authorized
  domains list (manual user step from S0-1's setup doc).

If any verify-step fails, halt and ask the user to complete S0-1's
manual setup before B-2's code commit lands.

### After implementation

- Run `npx cap sync ios` from the repo root to pull
  `Info.plist` changes into the iOS project's actual build target.
  (The committed `Info.plist` is the source of truth; `cap sync`
  copies it. Engine-implementer or pr-shipper runs this.)
- Open the Xcode project (`npm run ios:open`) and verify the
  CFBundleURLTypes entry appears under Targets → App → Info → URL
  Types. If it doesn't, the cap-sync step failed silently.

---

## Out of scope (explicitly NOT in this PR)

- **No cloud writes.** No `setDoc`, no `runTransaction`, no
  Firestore SDK imports. B-3 ships the first cloud byte.
- **No `pushSnapshot()` integration.** B-2's auth state is the
  prerequisite for B-3's upload; B-3 calls `SyncAuth.getCurrentUser()`
  in `pushSnapshot()` before any Firestore call.
- **No real-time listeners (`onSnapshot`).** Lives in E-3.
- **No Apple ID / email / phone sign-in.** Google only per PLAN.md
  §"Auth flow design (Google sign-in)". Other providers are deferred
  to a future PR if requested.
- **No sign-up flow.** Firebase Auth uses existing Google accounts;
  there is no user-creation surface — the user signs in with their
  existing Google identity, period.
- **No password / token-recovery flow.** Out of scope; sign-in is
  delegated entirely to Google.
- **No multi-user / family-account / share-with-others UI.** v2.0
  strategy explicitly defers these (`docs/CLOUD-SYNC-STRATEGY.md`
  §"What's deferred").
- **No account-deletion flow.** Out of scope. Local data is never
  wiped on sign-out (local-first contract — see PLAN.md
  §"Sign-out").
- **No `tempo_sync_state` flips in B-2.** The gate stays at `'ready'`
  through every B-2 transition. B-3 flips to `'hydrating'` during
  the first upload; C-1 flips to `'hydrating'` during pull-down; E-1
  flips to `'error'` on merge failure. B-2 only reads
  `SyncState.get()` to color the status indicator.
- **No `meds-arrival` toast (F15).** Lives in B-4.
- **No `Persistence.clear()` integration.** Sign-out does NOT clear
  local data (local-first contract — see PLAN.md auth flow
  section).
- **No background sign-in / silent re-auth on cold boot beyond what
  the Firebase Auth SDK does automatically.** Both SDKs (web modular
  `firebase/auth` and native `@capacitor-firebase/authentication`)
  rehydrate the current user from local persistence on cold boot via
  `onAuthStateChanged`. B-2 just subscribes to that signal.

---

## Sign-off checklist (for the implementer)

- [ ] Branch cut from `feat/sync-stage-b-engine-scaffold` (B-1), not
      from `main`. PR target is `main`. See "Manual setup steps".
- [ ] Affected files match the table above (11 paths total: 5
      modify under code-path, 2 add under code-path, 1 add under
      tests, 1 modify under iOS, plus 3 ui-wirer / pr-shipper-owned).
- [ ] `js/sync-auth.js` exposes the documented public API: `init()`,
      `signIn()` (returns `Promise<User \| null>`), `signOut()`
      (returns `Promise<void>`), `getCurrentUser()`,
      `onAuthChange(callback)` (returns unsubscribe fn).
- [ ] `js/platform.js` has a new `Platform.auth` namespace mirroring
      the existing shim shape (`isNative` check; web vs native
      branches per method). **No re-implementation of
      `navigator.vibrate` / `Notification` / etc. — `Platform.auth`
      is the new abstraction layer.**
- [ ] Firebase web SDK is **lazily imported** on first
      `Platform.auth.signIn()` call (dynamic
      `import('https://www.gstatic.com/firebasejs/.../firebase-auth.js')`
      or similar). Web boot bytes do NOT include the SDK on cold boot
      when the flag is off.
- [ ] `js/sync-firebase-config.js` is loaded **unconditionally** via
      `<script>` tag in `index.html`. The config object is passive —
      assigning to `window.FirebaseConfig` has no side effects on
      load.
- [ ] `index.html` has script-tag order: `persistence.js` →
      `sync-firebase-config.js` → `sync-flag.js` → `sync-engine.js`
      → `sync-auth.js` → `audio.js` (ui-wirer / pr-shipper edit).
- [ ] `ios/App/App/Info.plist` has `CFBundleURLTypes` key with the
      reversed-client-id
      `com.googleusercontent.apps.66959649115-583frfdoh0645dmp5sovk6visi9m5fmi`
      pasted verbatim (no manual retyping — copy from this audit or
      from `ios/App/App/GoogleService-Info.plist`).
- [ ] Engine-implementer runs `npx cap sync ios` after the
      `Info.plist` change so the iOS project's effective Info.plist
      reflects the new URL types.
- [ ] `xmllint --noout ios/App/App/Info.plist` exits zero (valid
      plist syntax).
- [ ] `SyncAuth.signIn()` cancellation path returns `null` (not
      throws); no `auth-change` event fires on cancellation (test
      case 6).
- [ ] `SyncAuth` does NOT call `SyncState.set()` anywhere. Auth
      state changes do not flip the F13 gate (test case 7).
- [ ] Settings drawer "Cloud Sync" section: toggle row has
      `data-keep-drawer-open`; sign-in row + sign-out button do NOT
      (those are navigation-onward actions, so auto-close is the
      right UX).
- [ ] `js/tempo-nav.js:wireSettingsDrawer` button-loop honors
      `data-keep-drawer-open` (one-line selector change).
- [ ] Sign-out button is disabled when
      `SyncState.get() === 'hydrating'` (ui-wirer-owned).
- [ ] Settings drawer layout verified at 320px / 375px / 414px / 768px
      widths — no horizontal overflow, no clipping (ui-wirer manual
      smoke).
- [ ] Email truncation: long emails clip with `text-overflow: ellipsis;
      max-width: 160px;` so the row doesn't widen the drawer.
- [ ] No re-implementation of `escapeHtml` / `Utils.formatMs` —
      defensive line item (B-2 doesn't touch either, but Cloud Sync
      identity row displays user-provided strings, so any HTML
      injection of `displayName` / `email` MUST go through
      `escapeHtml` from `js/dom-utils.js`).
- [ ] No re-implementation of `navigator.vibrate` / `Notification` —
      `Platform.haptic` / `Platform.notify` (and the new
      `Platform.auth`) are the only call surfaces.
- [ ] All writes to synced stores stamp `deviceId` + `updatedAt` +
      `schemaVersion` via `js/schema.js` — **N/A for B-2** (no
      synced-store writes). Sign-off item retained for the checklist
      template's sake.
- [ ] `sw.js` `CACHE_NAME` bumped to a new version string
      (recommended `'stopwatch-v67-sync-auth'`); `ASSETS` array
      includes `./js/sync-auth.js` and `./js/sync-firebase-config.js`.
- [ ] All engine tests pass via `tests/index.html` (manual: serve
      repo root via `python3 -m http.server 8765` and open
      `http://localhost:8765/tests/index.html`). Pass count expected
      to be the B-1 baseline + the 6 new B-2 cases.
- [ ] Manual end-to-end sign-in tested on web (Chrome + Safari) —
      sign in, sign out, sign in again, refresh page, verify user
      persisted.
- [ ] Manual end-to-end sign-in tested on iOS (physical device per
      `iOS-BUILD.md`'s free-cert refresh playbook) — sign in via
      Google sheet, sign out, verify deep-link callback works.
- [ ] No new Firebase imports outside `Platform.auth` (web branch
      uses dynamic import inside the namespace; native branch uses
      `window.Capacitor.Plugins`; nothing else in the codebase imports
      `firebase/*`). Self-check via
      `grep -rE "import.*firebase|require.*firebase" js/`.

---

## Rollback

Revert the PR. `SyncAuth` and `Platform.auth` are dead code when
`tempo_sync_enabled === '0'` (the default). Reverting removes:

- The settings drawer's Cloud Sync section (UI disappears; rest of
  drawer unaffected — uses unique CSS class).
- The `<script>` tags for `sync-firebase-config.js` and
  `sync-auth.js` (no-op file references, harmless if they linger in
  `sw.js` `ASSETS` — service worker just caches two unused files).
- The `Info.plist` `CFBundleURLTypes` block (iOS build unaffected;
  the scheme registration only matters during sign-in, which is
  unreachable post-revert).
- The `SyncEngine.init()` flag-on `onAuthChange` wiring (B-1's
  scaffold remains as the no-op it was originally).

No data movement happens in B-2, so there is **nothing to clean up
on Firestore**. Firebase Auth's own IDB state (cached user) is
harmless and can be cleared via browser dev tools if desired.

If `sw.js` cache bump shipped but the JS changes are reverted, the
old cache version stays in use until the next deploy bumps
`CACHE_NAME` again — no functional regression, just a one-cycle
stale-cache state on existing PWA installs.

---

## Open questions for the user

1. **Visible toggle placement.** Audit recommends the
   `tempo_sync_enabled` toggle ships as a regular row inside the
   "Cloud Sync" section (alongside sign-in / sign-out), NOT as a
   hidden "Developer" sub-section. Rationale: Stage B's goal is to
   make sync user-discoverable; gating discovery behind a hidden
   sub-section adds friction for the user (Kyle) doing real testing
   on physical devices. If the user prefers a hidden developer
   surface, swap the visible toggle for a long-press-only / 5-tap
   reveal pattern.
2. **Cloud Sync section visual style.** Audit recommends reusing
   `.tempo-settings-item` row styles + adding a sub-heading row
   ("Cloud Sync") rendered as a small all-caps label, mirroring how
   `tempo-shell.css` already styles section headers in the
   wellness pillar (e.g., `.wellness-section-title`). If the user
   wants a distinct visual treatment (e.g., a card-with-border
   block, an accent stripe), call that out before ui-wirer ships
   final CSS.
3. **Deep-link callback URL behavior on Capacitor WebView.** The
   Firebase iOS plugin handles the OAuth redirect natively (the
   system Google sheet returns to the app via the URL scheme;
   nothing reaches the WebView's `window.location`). Audit confirms
   no extra wiring needed beyond `CFBundleURLTypes` + the plugin's
   own internals. If end-to-end testing on a physical device reveals
   a "callback doesn't return to the app" symptom, the most likely
   cause is the URL scheme typo (Risk #2) — debugging steps in
   `iOS-BUILD.md` or the
   `@capacitor-firebase/authentication` README.

---

## Next step

Stop here. Push this audit to the branch
`feat/sync-stage-b-auth` (cut from `feat/sync-stage-b-engine-scaffold`
per "Manual setup steps") and dispatch the engine-implementer for
the code commit. Engine-implementer reads this audit + PLAN.md §B-2 +
the platform.js + sync-engine.js sources + B-1's audit (the
"stacked PR on" parent) and writes the eight code files
(`sync-auth.js`, `platform.js` extension, `sync-engine.js` line,
`app.js` line, `Info.plist` URL types, `sync-auth.test.js`, plus the
ui-wirer-owned settings drawer additions in `index.html` / `styles.css`
/ `tempo-nav.js`). No scope additions unless audit review flags one.
