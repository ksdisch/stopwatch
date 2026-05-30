# ADR 0007: Wrap the existing no-build web app in a Capacitor iOS shell, not a React Native rewrite or PWA-only

- **Status:** Accepted (retro-documented 2026-05-30)
- **Date:** 2026-05-03 (Capacitor wrapper shipped in PR #45, commit `72eb338`; the background-audio addendum landed later, ~2026-05-26, see below)
- **Deciders:** ksdisch
- **Tags:** ios, capacitor, platform-abstraction, architecture

## Context

Tempo is a no-build vanilla-JS PWA (ADR 0001) deployed to GitHub Pages from `main` root, push-to-deploy in ~1 minute. The web app already works. The single real user wants three things a web PWA on iOS Safari cannot reliably deliver:

1. **Real iOS haptics.** The web build calls `navigator.vibrate` (`js/platform.js:79-80`), which iOS Safari ignores entirely — there is no Vibration API on iOS WebKit. The 23 haptic call sites that animate every button press, phase tick, and alarm produce nothing on an iPhone.
2. **OS-level scheduled notifications that fire while the app is suspended.** A meds-due reminder or a finished cooking timer must alert the user when Tempo is *not* foregrounded. A web PWA's notifications depend on the page (or its service worker) being alive; iOS aggressively suspends backgrounded WebViews, so a `setTimeout`-driven or SW-driven notification is dropped the moment the tab sleeps. Only a notification scheduled at the OS level survives suspension.
3. **Background ambient focus audio.** The Flow / Pomodoro ambient noise is Web Audio rendered in the WebView; iOS suspends WebView audio the instant the app leaves the foreground, so the noise cut out whenever the user switched apps or locked the screen.

The constraint that frames the whole decision: the no-build / vanilla-JS architecture (ADR 0001) is load-bearing — `index.html`'s `<script>` order *is* the dependency graph, there is no bundler, and the web build must keep deploying byte-equivalent via `git push`. Whatever delivers native iOS capability must not fork the codebase, introduce a build step on the web path, or double the maintenance surface for a solo author who has to keep web and iOS in lockstep from one source tree.

There is also an existing seam to build on: `js/platform.js` already centralizes the platform-specific calls. `Platform.isNative` is computed once at module load from `window.Capacitor.isNativePlatform()` (`js/platform.js:13-14`), and every haptic/notify/auth/network primitive branches on it.

## Decision

We wrap the existing web app in a **Capacitor 6 iOS shell** — a WKWebView running the *same* JavaScript bundle, byte-equivalent to the web build — rather than rewriting the app in React Native / Flutter or shipping PWA-only.

One codebase, two ships. The web path is untouched: `scripts/sync-www.mjs` mirrors the repo root (`index.html`, `manifest.json`, `sw.js`, `css/`, `js/`, `icons/`) into a gitignored `www/` directory (`scripts/sync-www.mjs:15-37`), which is what `cap copy` loads into the iOS bundle. The repo root is still what GitHub Pages serves; `www/` is a derived mirror, never edited by hand. The `npm run ios:copy` / `ios:open` / `ios:sync` scripts chain `sync-www` to `cap copy`/`cap open`/`cap sync` (`package.json:7-10`). App identity is `appId: com.ksdisch.tempo`, `appName: Tempo`, `webDir: www` (`capacitor.config.json:2-4`).

All native-vs-web divergence is funneled through a single abstraction layer, `js/platform.js`, which mirrors the same web→native branch in every primitive:

- **Haptics** — `haptic(pattern)` routes to `@capacitor/haptics` (`window.Capacitor.Plugins.Haptics`) on native, mapping the existing `navigator.vibrate`-style argument to discrete Capacitor impact/notification haptics inside `dispatchNativeHaptic` (`js/platform.js:27-72`), and falls back to `navigator.vibrate(pattern)` on web (`js/platform.js:74-82`). Call sites pass the same `number | number[]` they always did — translation happens inside `Platform.haptic`, so the 23 sites don't change.
- **Notifications** — `notify(title, opts)` fires through `@capacitor/local-notifications` on native and `new Notification(title, opts)` on web (`js/platform.js:102-121`). `scheduleNotification(id, delayMs, title, body)` is the load-bearing one: on native it schedules at the OS level via `LocalNotifications.schedule({ schedule: { at: new Date(Date.now() + delayMs) } })` (`js/platform.js:123-140`), so iOS delivers it even with the WebView suspended; on web it falls through to `BgNotify` (SW + `setTimeout`).
- **Auth** — `Platform.auth` is a lazy Firebase shim with the same web/native split: web lazy-imports the modular Firebase Auth SDK from the gstatic CDN on first use (`js/platform.js:201-202`, `336-377`), native routes to `@capacitor-firebase/authentication`'s `FirebaseAuthentication` plugin (`js/platform.js:268-282`, `339-355`). Both return the same normalized `{ uid, email, displayName, photoURL }` shape so callers stay platform-agnostic.
- **Network** — `Platform.network` mirrors the pattern again: web uses `navigator.onLine` + `window` `online`/`offline` events, native routes to `@capacitor/network`'s plugin with a cached synchronous read (`js/platform.js:441-579`).

The dependency set is committed in `package.json`: `@capacitor-firebase/authentication` and `@capacitor-firebase/firestore` at `^6.3.1` (`package.json:13-14`), `@capacitor/core` / `@capacitor/ios` / `@capacitor/haptics` / `@capacitor/local-notifications` / `@capacitor/network` all `^6.0.0` (`package.json:15-20`), plus `firebase ^11.10.0` for the web SDK (`package.json:21`). `node_modules/` and `www/` are gitignored; the Xcode project at `ios/` is committed.

The service worker is web-only and is explicitly skipped on native — `js/app.js:104` gates registration on `!Platform.isNative` (the WKWebView loads from `capacitor://`, has no HTTP origin, and would log an install error). Native scheduled notifications cover what the SW did on web, and `Platform.requestNotificationPermission()` is requested once at boot on native (`js/app.js:112-114`).

**Background audio** (the addendum, ~2026-05-26, separate from PR #45's `72eb338`) is solved natively, not in JS: `Info.plist` declares `UIBackgroundModes` = `audio` (`ios/App/App/Info.plist:57-59`), and `AppDelegate.didFinishLaunchingWithOptions` sets the shared `AVAudioSession` category to `.playback` (`ios/App/App/AppDelegate.swift:30-34`). Category-only, no `setActive` and no `.mixWithOthers` — the WebView activates the session itself when playback begins (so merely opening Tempo doesn't grab audio focus), and when the noise starts it takes over the now-playing session.

## Consequences

### Positive
- **The web app is reused wholesale, byte-for-byte.** The iOS shell runs the exact same JS in a WKWebView; there is no port, no second UI layer, no parallel feature implementation. A feature shipped once works on both targets (`scripts/sync-www.mjs:2-4` — "keep these two outputs identical").
- **No-build is preserved on both paths.** The web build still has zero toolchain; the iOS build adds Capacitor + Xcode but no bundler for the JS itself — Capacitor injects `window.Capacitor.Plugins.*` into the WebView at native boot, so the plugins are reachable without an `import` step (`js/platform.js:5-6`, `15`). ADR 0001 stays intact.
- **All divergence lives behind one seam.** `Platform.isNative` is computed once (`js/platform.js:13-14`) and every primitive branches on it in one file. The rest of the codebase — engines, UI, sync — is platform-blind. Adding a native capability means adding a branch in `js/platform.js`, not threading conditionals through call sites.
- **The native capabilities that justified the wrapper are delivered.** OS-level scheduled notifications survive WebView suspension (`js/platform.js:123-140`); real iOS impact/notification haptics replace the no-op `navigator.vibrate` (`js/platform.js:27-72`); ambient noise keeps playing backgrounded via `AVAudioSession.playback` + `UIBackgroundModes=audio` (`ios/App/App/AppDelegate.swift:30-34`, `ios/App/App/Info.plist:57-59`).
- **Drift-free engines make the wrapper cheap.** Because every engine derives elapsed time from the wall clock (ADR 0002), no native background-execution machinery (`BGTaskScheduler`) is needed — the engine recomputes correctly on resume, and `LocalNotifications` handles the only thing that must run while suspended. This is an explicit out-of-scope item, not an oversight (`iOS-BUILD.md:119`).

### Negative / tradeoffs
- **A second, manual release cadence with no CI.** Web is `git push` → GitHub Pages in ~1 min; iOS is `npm run ios:copy` → `⌘R` in Xcode by hand (`iOS-BUILD.md:99-106`). Worse for a free Apple ID: development certs expire every **7 days**, after which the app on the phone won't launch until it's re-signed via `npm run ios:open` → Run (`iOS-BUILD.md:66-79`). There is no automated build/deploy for the native target.
- **A class of native-only bugs the web build never sees.** The Podfile needs a hand-maintained `post_install` hook + a standalone `GoogleSignIn` pod to make `signInWithGoogle` compile, because the plugin's subspec selection is broken on this CocoaPods version (`iOS-BUILD.md:34-49`). And there is a known, still-open native-only defect: iOS "Sign out" dismisses the popup but leaves `SyncAuth.getCurrentUser()` returning the signed-in account — a race in the `authStateChange` re-emit after manual sign-out (`js/platform.js:296-302`, web sign-out works); see Remaining Tech Debt in `CLAUDE.md`.
- **Cloud-sync native parity is deferred, not delivered.** `SyncFirestore.runTransaction` and `SyncFirestore.subscribe` throw "native parity pending" on native (`js/sync-firestore.js:339`, `:431`), so on iOS the per-record CAS writeback degrades to defensive polling + plain `setDoc`, and real-time `onSnapshot` listeners are web-only. Fully functional but degraded; tracked as backlog item #3 and the subject of ADR 0009.
- **App Store distribution is still outstanding paperwork.** Free signing covers personal use, but $99/yr Developer Program enrollment, an App Store Connect record, TestFlight/submission, privacy nutrition labels (meds + BFRB are health data), App Review screenshots, age rating, and a 1024×1024 icon are all not done (`iOS-BUILD.md:110-118`).
- **The background-audio fix needs on-device verification.** It shipped from a web-only session and couldn't be tested on hardware; if playback still cuts out, the follow-up is explicit `AVAudioSession.setActive` tied to ambient start (`CLAUDE.md` backlog row #1).

## Alternatives considered

- **React Native / Flutter rewrite.** Rejected: throws away the working, shipping web app and reimplements every screen in a new UI paradigm; introduces a build step and a bundler, directly violating the load-bearing no-build constraint (ADR 0001); and doubles the maintenance surface — two codebases to keep in lockstep — for a solo author with one user. Capacitor reuses 100% of the existing JS unchanged.
- **PWA-only / Add-to-Home-Screen.** Rejected: this is exactly what fails to deliver the three capabilities that motivated going native. iOS Safari has no Vibration API (haptics are silently dropped — `js/platform.js:79-80`), cannot reliably schedule local notifications that fire while the WebView is suspended, and throttles/suspends background Web Audio. The wrapper exists precisely because the PWA path cannot do these (`js/app.js:100-103`).
- **Apache Cordova.** Rejected: Capacitor is Cordova's modern successor with first-class native-plugin ergonomics (`window.Capacitor.Plugins.*` injection, typed plugin APIs, an actively maintained iOS toolchain). The plugins Tempo needs — `@capacitor/haptics`, `@capacitor/local-notifications`, `@capacitor-firebase/authentication`/`firestore` — are the maintained-by-the-ecosystem Capacitor variants.
- **A thin custom WKWebView app without Capacitor.** Rejected: it would mean hand-rolling the haptics, local-notifications, Firebase Auth/Firestore, and network JS↔Swift bridges that Capacitor's plugins already provide and inject into the WebView for free (`js/platform.js:5-6`). No benefit for a solo author over the off-the-shelf bridge layer.

**Explicitly out of scope (not deferred — deliberately not needed):**
- `BGTaskScheduler` for long-running native background work — unnecessary because `LocalNotifications` schedules at the OS level and the engines are drift-free, so they recompute correctly on resume (`iOS-BUILD.md:119`).
- Capacitor Preferences migration — `localStorage` survives in `WKWebView` across launches, so the existing persistence keys need no migration (`iOS-BUILD.md:121`).

## References

- `js/platform.js:13-14` (`isNative` detection), `:27-72` (`dispatchNativeHaptic`), `:74-82` (`haptic` web/native branch), `:102-121` (`notify`), `:123-140` (`scheduleNotification` OS-level native schedule), `:201-202` / `:268-282` / `:336-377` (`Platform.auth` Firebase shim), `:296-302` (native `authStateChange` listener — iOS sign-out race), `:441-579` (`Platform.network` shim)
- `js/app.js:104` (SW registration gated on `!Platform.isNative`), `:112-114` (native notification permission at boot)
- `package.json:7-10` (`ios:copy`/`ios:open`/`ios:sync` scripts), `:13-21` (Capacitor + Firebase deps)
- `capacitor.config.json:2-4` (`appId` / `appName` / `webDir`)
- `scripts/sync-www.mjs:2-4` (mirror-equivalence intent), `:15-37` (repo-root → `www/` copy)
- `ios/App/App/AppDelegate.swift:30-34` (`AVAudioSession.playback` background audio), `ios/App/App/Info.plist:57-59` (`UIBackgroundModes` = `audio`)
- `js/sync-firestore.js:339` (`runTransaction` native parity-pending throw), `:431` (`subscribe` native parity-pending throw)
- `iOS-BUILD.md:34-49` (Podfile post_install hook), `:66-79` (7-day cert refresh), `:99-106` (daily workflow), `:110-121` (out-of-scope incl. `BGTaskScheduler`, Preferences)
- PR #45 / commit `72eb338` ("feat(ios): add Capacitor wrapper for native iOS build", 2026-05-03)
- Related: ADR 0001 (no-build / script-load-order — the constraint this decision preserves), ADR 0002 (drift-free wall-clock timing — why `BGTaskScheduler` is unnecessary), ADR 0003 (Firestore sync backend), ADR 0009 (defer native CAS + listener parity — the degraded native sync path this wrapper accepts)
- Related docs: `iOS-BUILD.md` (day-to-day native build playbook), `CLAUDE.md` → "iOS build (Capacitor)" + Feature Backlog row #1 + Remaining Tech Debt (iOS sign-out bug), `docs/artifacts-plan.md:104` (platform-seam diagram backing this ADR)
