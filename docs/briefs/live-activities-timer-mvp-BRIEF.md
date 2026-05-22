# Tempo — implement PR `live-activities-timer-mvp`

You're working on Tempo, a vanilla-JS PWA + Capacitor iOS app. This is the **foundational PR** in a multi-PR initiative to add iOS Live Activities (lock-screen + Dynamic Island UI for running timers). It scaffolds the entire JS↔ActivityKit pipeline end-to-end for one engine (Timer), so subsequent PRs can extend to Stopwatch / Pomodoro / Flow / Interval / Cooking without re-litigating the bridge or the Widget Extension setup.

**Backlog row:** CLAUDE.md Feature Backlog priority 3 (#9) — "iOS Live Activities — running timers on the lock screen + Dynamic Island."

**Out of scope (deferred to follow-up PRs):**
- Stopwatch integration (PR 2 — count-up layout)
- Pomodoro / Flow / Interval / Cooking integration (PR 3+)
- APNs Push-to-Update (engines are drift-free; local ActivityKit updates suffice)
- Android equivalent ("ongoing notification") — separate effort
- TestFlight / App Store distribution gating (still part of backlog #1)

## Required reading (before any code)

1. `CLAUDE.md` § "iOS build (Capacitor)" — confirms appId `com.ksdisch.tempo`, the `Platform.haptic` / `Platform.notify` abstraction pattern, the `sw.js` cache-bump rule, and the Capacitor sync workflow.
2. `iOS-BUILD.md` — operational notes, especially the Podfile-regeneration gotcha (cap sync regenerates `capacitor_pods` block but leaves target-level entries alone — relevant when adding a new Xcode target).
3. `js/platform.js:1–596` — existing native-bridge abstraction. New `Platform.liveActivity` namespace mirrors the established `Platform.haptic` / `Platform.notify` / `Platform.auth` / `Platform.network` pattern: `const isNative = ...; if (isNative) { ... } else { ... }` per method, with both branches normalized to the same return shape.
4. `js/timer.js:1–199` — `createTimer(id)` factory. State machine: `idle → running → paused → finished`. Drift-free elapsed via `elapsed = durationMs - (Date.now() - startedAt + accumulatedMs)`. The activity emit points are inside `start()`, `pause()`, `reset()`, `_onFinish()`.
5. `ios/App/App/AppDelegate.swift` — confirms `FirebaseApp.configure()` runs in `didFinishLaunchingWithOptions`. The Live Activity plugin doesn't depend on this, but the Widget Extension target may need its own bundle-id namespace under `com.ksdisch.tempo.*`.
6. **Apple ActivityKit reference:** the SDK is iOS 16.1+. Lock-screen rendering works on all iPhone X+ devices that support iOS 16.1+; Dynamic Island layouts only render on iPhone 14 Pro+ but Apple's framework auto-selects per device — one set of code handles both.

## What this PR ships

A working end-to-end Live Activity for the **Timer** engine: when the user starts a countdown timer on an iPhone running iOS 16.1+, a SwiftUI activity appears on the lock screen with a live countdown rendered locally by the OS (no per-tick push needed). On iPhone 14 Pro+, the same activity appears in the Dynamic Island. When the timer finishes (or the user resets), the activity ends. A settings drawer toggle (default ON) lets the user disable activities globally.

Concretely, **six** code surfaces change:

### 1. New Capacitor plugin (Swift) — JS↔ActivityKit bridge

**Files:**
- `ios/App/App/Plugins/LiveActivity/LiveActivityPlugin.swift` (new — ~150 LOC)
- `ios/App/App/Plugins/LiveActivity/LiveActivityPlugin.m` (new — Objective-C bridge registration, ~10 LOC)
- `ios/App/App/Plugins/LiveActivity/TempoTimerAttributes.swift` (new — shared between App + Widget Extension targets, ~30 LOC)

**Public JS API surface** (called via `window.Capacitor.Plugins.LiveActivity`):

```swift
@objc(LiveActivityPlugin) public class LiveActivityPlugin: CAPPlugin {
  @objc func isSupported(_ call: CAPPluginCall)       // returns { supported: Bool }
  @objc func startTimer(_ call: CAPPluginCall)        // args: { id, name, endsAt, isPaused }
  @objc func updateTimer(_ call: CAPPluginCall)       // args: { id, endsAt?, isPaused? }
  @objc func endTimer(_ call: CAPPluginCall)          // args: { id }
  @objc func endAll(_ call: CAPPluginCall)            // ends all live activities
}
```

`isSupported` returns `false` if `ActivityAuthorizationInfo().areActivitiesEnabled` is `false` OR the OS is below 16.1 (gated via `if #available(iOS 16.1, *)`). All other methods no-op silently if `isSupported` is false (do NOT throw — JS callers don't need to check).

**Shared activity schema** (`TempoTimerAttributes.swift`):

```swift
struct TempoTimerAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var startedAt: Date   // absolute start time — used by ProgressView(timerInterval:) for OS-level % rendering
    var endsAt: Date      // absolute end time — used by Text(timerInterval:) + ProgressView for OS-level countdown
    var isPaused: Bool    // true → freeze countdown + freeze progress bar
  }
  var timerId: String     // matches Timer.id (e.g. "timer-default")
  var timerName: String   // user-facing label (e.g. "Tea steep", "Focus break")
}
```

**Why `startedAt` is in `ContentState`:** the lock-screen layout (Q1 → Option B) renders both the countdown text AND a progress bar. Apple's `ProgressView(timerInterval: startedAt...endsAt)` consumes the interval directly and updates at OS-level cadence — no JS-side ticking. Including `startedAt` in `ContentState` (not just `attributes`) means a pause→resume transition can mutate the start time atomically with the end time, which the bar re-renders against cleanly.

This file must have **target membership in BOTH** the main App target AND the new Widget Extension target — the same struct is referenced by both the plugin (which calls `Activity<TempoTimerAttributes>.request(...)`) and the widget (which renders `TempoTimerAttributes.ContentState`).

**iOS gating:** every method body wraps its ActivityKit calls in `if #available(iOS 16.1, *) { ... } else { call.resolve() }`. The deployment target stays at 13.0. Older iOS users see no Live Activities (no error) — graceful degrade.

### 2. New Widget Extension Xcode target

**Target name:** `TempoLiveActivityWidget`
**Bundle ID:** `com.ksdisch.tempo.TempoLiveActivityWidget`
**Deployment target:** iOS 16.1 (Widget Extension only — main App target stays 13.0)

**Files (all new):**
- `ios/App/TempoLiveActivityWidget/TempoLiveActivityWidget.swift` (widget bundle, ~15 LOC)
- `ios/App/TempoLiveActivityWidget/TempoTimerLiveActivity.swift` (SwiftUI activity views — lock-screen + Dynamic Island compact + expanded, ~120 LOC)
- `ios/App/TempoLiveActivityWidget/Info.plist` (Widget Extension manifest; `NSExtensionPointIdentifier = com.apple.widgetkit-extension`)

**Lock-screen layout (locked: Option B — time + progress bar):**
- Top row: small Tempo logo or app icon on the left, timer name (e.g. "Tea steep") next to it. Trailing-right: small "PAUSED" badge if `isPaused = true` (hidden otherwise).
- Center: large monospaced countdown via `Text(timerInterval: Date.now()...endsAt, countsDown: true)`. When `isPaused = true`, swap to static `Text` of the remaining duration (frozen).
- Bottom: thin horizontal progress bar via `ProgressView(timerInterval: startedAt...endsAt)` — Apple-rendered, OS-driven updates, auto-clamps to 0–1. When `isPaused = true`, replace with a static `ProgressView(value: elapsedFraction)` (a fixed bar position).
- Background: Tempo's existing dark-theme palette to match Tempo's brand. Pure SwiftUI, no images / no asset catalog.

**Dynamic Island layouts (locked: my recommended defaults):**
- **Compact leading:** Tempo's "T" or app-icon glyph (use a small SF Symbol like `timer` if asset rendering proves finicky in the compact size — Apple recommends ≤ ~16pt).
- **Compact trailing:** countdown via `Text(timerInterval: Date.now()...endsAt, countsDown: true)` — Apple auto-formats this short (`2:34`, no leading zero on minutes).
- **Expanded:** larger countdown center, timer name top, progress bar bottom, "Tap to open Tempo" affordance applied via `.widgetURL(URL(string: "tempo://timers/timer"))` on the root expanded view. Paused-state badge if `isPaused = true`.
- **Minimal (system fallback when multiple activities active):** countdown only — same as compact trailing.

### 3. Main App target — `Info.plist` changes (two additions)

**Addition A — Live Activities opt-in:**

```xml
<key>NSSupportsLiveActivities</key>
<true/>
```

Place between the existing `LSRequiresIPhoneOS` and `UILaunchStoryboardName` entries (alphabetical-ish). This is the iOS opt-in flag — without it, `Activity<...>.request(...)` silently fails.

**Addition B — `tempo://` URL scheme registration (for activity-tap deep-link):**

A `CFBundleURLTypes` array already exists in `Info.plist` (for the Google OAuth reverse-client-id callback at line 46–54). Add a SECOND `<dict>` sibling inside that array:

```xml
<dict>
  <key>CFBundleURLName</key>
  <string>com.ksdisch.tempo</string>
  <key>CFBundleURLSchemes</key>
  <array>
    <string>tempo</string>
  </array>
</dict>
```

This registers `tempo://` so that when the user taps the Live Activity (which carries `.widgetURL(URL(string: "tempo://timers/timer"))`), iOS routes the URL into the Tempo app. The Capacitor `@capacitor/app` plugin's `appUrlOpen` event fires in JS — see surface 5 below for the listener wiring.

### 4. `js/platform.js` — bridge extension

Add a new `Platform.liveActivity` namespace following the existing module-pattern (mirrors `Platform.haptic` / `Platform.network` / `Platform.auth` at line 13 → 596). API surface:

```js
Platform.liveActivity = {
  isSupported: async () => Boolean,          // false on web; calls native isSupported on iOS
  startTimer: async ({ id, name, endsAt, isPaused }) => { ok: Boolean },
  updateTimer: async ({ id, endsAt, isPaused }) => { ok: Boolean },
  endTimer: async ({ id }) => { ok: Boolean },
  endAll: async () => { ok: Boolean },
}
```

**Web branch:** every method resolves to `{ ok: false, reason: 'web' }` (or `{ supported: false }` for `isSupported`). No throws. No console noise.

**Native branch:** delegates to `window.Capacitor.Plugins.LiveActivity.{method}(args)`. Wrapped in try/catch; on plugin-missing returns `{ ok: false, reason: 'plugin-missing' }` and logs once via `console.warn('[Platform.liveActivity] Live Activity plugin unavailable — rebuild iOS app via `npx cap sync ios`.')`. Mirrors the existing one-time-warn pattern in `Platform.auth` (line 276) and `Platform.network` (line 486).

### 5. `js/timer.js` — engine wiring + `js/tempo-nav.js` deep-link handler

**5a. Engine wiring in `js/timer.js`** — four touch points inside `createTimer(id)`:

- **`start()`** (line ~50): after the existing `_emit('change')` call, fire `Platform.liveActivity.startTimer({ id, name, startedAt: Date.now(), endsAt: Date.now() + remainingMs, isPaused: false }).catch(() => {})`. Use `.catch` not `await` — engine state must not block on the bridge.
- **`pause()`** (line ~70): after the state mutation, fire `Platform.liveActivity.updateTimer({ id, isPaused: true }).catch(() => {})`. Note: the lock-screen layout freezes via `isPaused`, no need to mutate `endsAt`.
- **`reset()`** (line ~85): fire `Platform.liveActivity.endTimer({ id }).catch(() => {})`.
- **`_onFinish()`** (line ~145): fire `Platform.liveActivity.endTimer({ id }).catch(() => {})`. The existing alarm callback still fires — activity end is in addition, not instead.

**Resume-from-pause edge case:** when the user un-pauses, the engine's `start()` re-fires. The bridge's `startTimer` (native side) must detect that an activity for this `id` already exists and update it (new `startedAt`, new `endsAt`, `isPaused: false`) rather than creating a duplicate. Implementation: track active activities in a `[String: Activity<TempoTimerAttributes>]` dictionary keyed by `timerId`; on `startTimer` with an existing id, call `.update(...)` instead of `.request(...)`.

**Gating:** Every emit reads the settings flag synchronously before calling: `if (localStorage.getItem('live_activities_enabled') !== '0') { Platform.liveActivity... }`. Default `'1'` (key absent → ON), to match the backlog row's "default ON" requirement. The flag is read inside the engine (not at module init) so the user can toggle live and the next emit picks up the new value.

**No `Platform.liveActivity.endTimer` call on `loadState()` reconstruction.** A tab-close-then-reopen-mid-timer should NOT spuriously kill the activity. If the activity was already running on the device (started before the tab closed), iOS continues showing it via the `endsAt` date — no JS call needed. If the activity was never running (user cold-boots on a different device), the next `start()` call after the reconstructed state will create one cleanly.

**5b. Deep-link listener in `js/tempo-nav.js`** — new function `initAppUrlOpenListener()` called inside the existing tempo-nav init flow. Subscribes to the Capacitor `@capacitor/app` plugin's `appUrlOpen` event:

```js
// In tempo-nav.js init, after the existing route handler is wired:
const App = window.Capacitor?.Plugins?.App;
if (App && typeof App.addListener === 'function') {
  App.addListener('appUrlOpen', (event) => {
    // event.url e.g. "tempo://timers/timer"
    try {
      const url = new URL(event.url);
      // host = "timers", pathname = "/timer" → hash = "#/timers/timer"
      const path = (url.host || '') + (url.pathname || '');
      if (path) {
        window.location.hash = '#/' + path.replace(/^\/+/, '');
      }
    } catch (_e) { /* malformed URL — ignore */ }
  });
}
```

**Web branch / non-native:** `window.Capacitor?.Plugins?.App` is `undefined` on web, the whole block no-ops. No web-side regression.

**Scope:** this listener is wired ONCE at init. It must survive the rest of this PR untouched — future Live Activity PRs (Stopwatch, Pomodoro, etc.) can deep-link to other routes via the same `tempo://` scheme without changing the listener.

### 6. Settings drawer toggle (`index.html` + `tempo-nav.js`)

**`index.html`:** new `<div class="tempo-settings-item tempo-live-activities-section">` block placed AFTER the Cloud Sync section (line ~191) and BEFORE the closing `</div>` of `#tempo-settings-drawer`. Mirrors the Cloud Sync row's structure — heading + a row containing label + toggle switch. The toggle uses the same `tempo-cloud-sync-toggle` CSS class for visual parity (or a new aliased class — UI wirer's call).

Visibility rule: the section is `hidden` by default; `js/tempo-nav.js` reveals it only when `Platform.isNative === true && (await Platform.liveActivity.isSupported()).supported === true`. On web or non-iOS-16.1+ devices, the section stays hidden — no dead UI.

**`tempo-nav.js`:** new init function `initLiveActivitiesSection()` called inside the existing settings-drawer wiring. Reads `localStorage.getItem('live_activities_enabled')` on mount; binds the toggle's click to `localStorage.setItem('live_activities_enabled', enabled ? '1' : '0')`. When toggling OFF, fire `Platform.liveActivity.endAll().catch(() => {})` so any in-flight activity disappears immediately rather than waiting for the next timer event.

### 7. `sw.js` — CACHE_NAME bump

`js/platform.js` AND `index.html` change → both cached web assets → cache bump required. Current value is `'stopwatch-v94-ambient-auto-resume'`. Bump to `'stopwatch-v95-live-activities-timer'`. pr-shipper picks the exact next-integer increment at ship time.

**Note:** `js/timer.js` is also cached. Its change reinforces the bump requirement — no separate bump needed for that file.

## Hard rules

- **Audit before code.** First commit on the branch is `docs/audits/live-activities-timer-mvp-AUDIT.md` listing all affected files, blast-radius tier, manual smoke plan, and any risks. STOP after the audit and wait for review.
- **Do NOT touch any other engine** (`stopwatch.js`, `pomodoro.js`, `flow.js`, `interval.js`, `cooking-ui.js`'s timer creation). This PR is Timer-only by design.
- **Do NOT add APNs / push-notification capability** to the App target. ActivityKit local updates are sufficient — adding APNs would require a new entitlement, server-side keypair, and is explicitly out of scope.
- **Do NOT bypass `Platform.liveActivity`.** Engine code never references `window.Capacitor.Plugins.LiveActivity` directly. Mirrors the existing rule for `Platform.haptic` / `Platform.notify`.
- **Do NOT bump the main App target's deployment target.** Stays at 13.0. Only the Widget Extension target gets 16.1. Code paths in the App that touch ActivityKit are `@available(iOS 16.1, *)`-gated.
- **`sw.js` CACHE_NAME MUST bump** in the same commit as the JS + HTML changes. Cached files changing without a cache-bump means existing PWA installs serve stale JS.
- **No new npm dependencies.** Custom Capacitor plugin is in-tree Swift — no `@capacitor-community/live-activity` or similar.
- **Widget Extension target additions must survive `npx cap sync ios`.** Capacitor regenerates the `capacitor_pods` function block inside `ios/App/Podfile` but leaves target-level entries alone. The new Widget Extension target lives in the `.xcodeproj` project file, NOT in the Podfile, so cap sync should leave it intact — but the implementer must verify by running `npx cap sync ios` after adding the target and confirming the project still opens cleanly in Xcode + the widget target still appears.
- **No Capacitor Preferences migration.** localStorage works in `WKWebView` and persists across launches — `live_activities_enabled` stays in localStorage like `bfrb_volume`, `ambient_volume`, etc.
- **Settings drawer toggle must not appear on web.** The `Platform.liveActivity.isSupported()` gate is the source of truth — section is `hidden` by default, only revealed when `isSupported()` returns true.

## Engine-test plan

Two new tests, both in a new `tests/platform.test.js` (the existing `tests/index.html` does not yet load `js/platform.js` — adding it is a precedent-setting harness change, parallel to PR #88's addition of `js/audio.js`):

1. **`Platform.liveActivity.isSupported()` returns `{ supported: false }` on web.** Assert via `await Platform.liveActivity.isSupported()`. Validates the web-branch no-op.
2. **`Platform.liveActivity.startTimer({...})` returns `{ ok: false, reason: 'web' }` on web.** Same pattern, validates that the web branch never throws and always returns the documented shape.

**Timer engine tests:** the existing `tests/timer.test.js` (21 tests) currently constructs the timer via `createTimer('timer-test')` and exercises `start()` / `pause()` / `reset()` directly. Adding live-activity emits to those methods does NOT break any existing test because `Platform.liveActivity.startTimer(...).catch(() => {})` resolves to a Promise that's never awaited. **No changes required to `tests/timer.test.js`.** If the implementer finds a regression, flag it — but the design is non-blocking by construction.

**ActivityKit / Widget Extension testing:** there is no in-harness Swift test runner. Validation is via the manual smoke plan on a real device. The Widget Extension target builds as part of the iOS app build — a compile failure in the SwiftUI views OR the plugin Swift code blocks the build, which IS a form of test.

## Manual smoke (iOS device — REQUIRED for this PR)

This PR cannot ship without device validation. The web build's behavior is "no Live Activities, no toggle, no regression" which is verified by web smoke; the actual feature only works on iPhone 16.1+ with a Widget Extension target compiled and signed. Kyle has a paid Apple Developer Program account (Q4), so smoke is normal — no 7-day cert refresh choreography needed.

1. After all code commits land, run `npm run sync-www && npx cap sync ios && npm run ios:open` (the `cap sync ios` step is critical — it must register the new Widget Extension target's plist + bundle into the iOS bundle).
2. In Xcode, select the Tempo target (not the Widget Extension target) + a real iPhone destination. Build + Run. Confirm the app launches without crash and the Settings drawer shows a new "Live Activities" section with an ON toggle.
3. Navigate to `#/timers/timer`. Set a 1-minute countdown. Tap Start. Lock the phone (side button).
4. **Lock-screen check:** wake the phone (don't unlock). Confirm a Live Activity appears with: timer name (or "Timer" default), a live-counting-down time display, Tempo's brand color accent. The countdown ticks at OS-level refresh (~1 Hz on lock screen — Apple-managed, not app-managed).
5. Unlock the phone briefly, lock again. Confirm the activity is still showing (didn't get killed by the lock-unlock cycle).
6. (Dynamic Island device only — iPhone 14 Pro+) Confirm the compact pill near the camera cutout shows the countdown (trailing) + Tempo glyph (leading). Long-press the pill — confirm the expanded view rolls down with the timer name + larger countdown + progress bar. Tap the expanded view — confirm Tempo opens and routes to `#/timers/timer` (verifies the deep-link via `tempo://`).
7. Wait for the timer to finish. Confirm: the existing alarm sound + vibration fire (no regression), AND the Live Activity disappears within ~1 second.
8. Start another 1-minute timer. After ~10 seconds, tap Pause inside the app. Confirm the Live Activity's countdown freezes (does not keep counting down on the lock screen).
9. Tap Resume. Confirm the countdown resumes from the paused remaining time, not from the original duration.
10. Tap Reset. Confirm the Live Activity disappears immediately.
11. Open Settings drawer (gear icon). Toggle "Live Activities" to OFF. Start a new timer. Confirm NO Live Activity appears (lock screen + Dynamic Island both empty).
12. Toggle Live Activities back ON. Start a new timer. Confirm activity appears.
13. Start a 1-minute timer. Force-quit Tempo (swipe up from bottom, swipe Tempo away). Confirm: the Live Activity continues showing the countdown (Apple keeps activities alive for up to 8 hours after the app exits — drift-free `endsAt` is what makes this possible).
14. Re-open Tempo. Confirm the Timer engine's reconstructed state matches the lock-screen activity (same remaining time displayed in-app + on activity). No spurious second activity gets created.
15. Lock the phone with a timer running. From a different app, tap the Live Activity on the lock screen → confirm Tempo opens AND lands on `#/timers/timer` (not on the default Stopwatch screen). This validates the `tempo://` URL scheme + Info.plist registration + `appUrlOpen` JS listener end-to-end.
16. Web smoke (regression check): in a desktop browser, navigate to `#/timers/timer`, start a timer, confirm normal behavior (no errors in console, no settings-drawer "Live Activities" section visible). Open the settings drawer — confirm only the existing items (Theme, Sound, Presets, Log past session, Focus mode, BFRB volume, Ambient sound, Cloud Sync) are visible. The Live Activities section must NOT appear on web.

## Blast radius (pre-estimated)

**Tier: HIGH.**

Drivers:
- **New Xcode target** (`TempoLiveActivityWidget`) — modifies `ios/App/App.xcodeproj/project.pbxproj`, a structural change that touches Xcode's build graph. Capacitor sync interaction needs verification (see Hard rules).
- **New custom Capacitor plugin** in Swift — first non-Firebase / non-Capacitor-official plugin in the repo. Sets precedent for future custom-plugin work.
- **`js/platform.js` extension** — adds a new abstraction-layer namespace. Web build runs the same code path; behavior must stay byte-equivalent on web.
- **`js/timer.js` engine touch** — engine-layer change in a tested module. Tests must remain green.
- **New persistence key** (`live_activities_enabled`) — additive only, no migration risk, but new key counts.
- **`sw.js` CACHE_NAME bump** — required (already a medium-tier driver on its own).
- **`Info.plist` modification** — `NSSupportsLiveActivities = true` is a low-risk additive change, but anything in the main app's plist touches the production iOS bundle's manifest.

Why not just medium: the **new Xcode target** is the high-tier driver. Adding a target changes the iOS project structure in a way that's easy to break and hard to verify outside Xcode. Per the orchestrator gating rubric, Phase 5 PAUSES for explicit "ship it" before push when tier is high. This is correct for this PR.

If during implementation the Widget Extension target proves unstable / requires significant project.pbxproj surgery, the implementer should pause and flag — adding a target via Xcode UI vs. editing the .pbxproj by hand is a real fork in the road.

## Decisions (locked by Kyle 2026-05-22, before audit)

The five open questions in the original skeleton have been resolved. Decisions baked into the brief above; recorded here for traceability:

1. **Q1 (Lock-screen layout) → Option B (time + progress bar).** `ContentState` includes both `startedAt` and `endsAt`. Lock-screen renders countdown text + thin progress bar at the bottom. Apple's `ProgressView(timerInterval: startedAt...endsAt)` handles the bar with OS-driven updates — no per-tick JS push needed. Recorded in "1. New Capacitor plugin" → Shared activity schema, and "2. New Widget Extension target" → Lock-screen layout.
2. **Q2 (Dynamic Island layouts) → Tempo glyph (compact leading), countdown (compact trailing), expanded view with timer name + countdown + progress bar + tap-to-open, minimal fallback = countdown only.** Recorded in "2. New Widget Extension target" → Dynamic Island layouts.
3. **Q3 (Deep-link on tap) → opens Tempo + routes to `#/timers/timer` via `tempo://timers/timer`.** Requires (a) `<dict>` sibling addition to `CFBundleURLTypes` in `Info.plist`, (b) `appUrlOpen` listener in `js/tempo-nav.js`. Recorded in surface 3 (Info.plist additions B) and surface 5b (`tempo-nav.js` listener). The listener is generic — future Live Activity PRs for Stopwatch / Pomodoro / etc. can reuse the same scheme without changing it.
4. **Q4 (Cert + smoke) → Kyle has enrolled in the $99/yr Apple Developer Program.** This means stable 1-year certs (no 7-day refresh cycle), TestFlight access, and a clear path to App Store distribution if desired later. **Out-of-scope side-effect:** this closes the first item on backlog row #1's "Remaining for App Store distribution" list. The pr-shipper's SESSION-LOG entry for this PR will flag the unlock so backlog #1 gets revisited next session (NOT updated in this PR — backlog edits remain their own doc PR).
5. **Q5 (Paused-state visual) → swap `Text(timerInterval:)` for static `Text(remaining)` + small "PAUSED" badge.** Same swap applied to the progress bar (static `ProgressView(value:)` while paused). Recorded in "2. New Widget Extension target" → Lock-screen layout.

## Deliverable

Branch `feat/live-activities-timer-mvp`, branched off **`main`** (not the current `feat/ambient-drawer-controls`), PR against `main`. Commits:

1. `docs(briefs): audit for live-activities-timer-mvp` — audit doc only. STOP for review of blast-radius + manual-setup steps. (Phase 1)
2. After audit greenlight: `feat(ios): Live Activity custom Capacitor plugin + shared attributes` — plugin Swift + shared `TempoTimerAttributes.swift` + `Info.plist` `NSSupportsLiveActivities` key. (Phase 2 partial)
3. `feat(ios): Live Activity Widget Extension target + SwiftUI views` — new Xcode target + widget + activity SwiftUI views. (Phase 2 partial)
4. `feat(timer): emit Live Activity events on start/pause/reset/finish` — `js/timer.js` wiring + `js/platform.js` bridge + settings flag default. (Phase 2 partial)
5. `test(platform): web-branch no-op contract for Platform.liveActivity` — new `tests/platform.test.js` + harness `<script>` add to `tests/index.html`. (Phase 3)
6. `feat(ui): settings drawer Live Activities toggle + tempo:// deep-link listener` — `index.html` section + `tempo-nav.js` wiring for both the toggle and the `appUrlOpen` listener. (Phase 4)
7. `docs(backlog): mark Live Activities Timer MVP shipped + add follow-up rows for Stopwatch / Pomodoro / Flow extensions; flag paid-Dev-Program unlock` — CLAUDE.md tick-off, SESSION-LOG entry, sw.js cache bump. The SESSION-LOG entry must call out that the $99/yr Apple Developer enrollment closed the first remaining item on backlog #1's "App Store distribution" list — backlog #1 itself stays in this PR's "out of scope," but the unlock is recorded for next session to act on. (Phase 5)

PR title once all commits land: `feat(ios): Live Activities for Timer mode (lock-screen + Dynamic Island)`.
