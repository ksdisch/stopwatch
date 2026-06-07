# Session wrap — Overhaul Batch F (PWA / platform)

**Date:** 2026-06-07
**Branch / PR:** `claude/overhaul-f-pwa-0DsfF` → draft PR (base `main`)
**Scope:** Batch F of the full-app overhaul (`docs/overhaul/PLAN.md`; findings `jq '.all[]|select(.batch=="F-pwa")' docs/overhaul/audit-findings.json`)

---

## 1. What we did

Implemented all 16 Batch F (PWA / platform) findings:

- **viewport-fit=cover** (`index.html:5`) — the prerequisite that makes every existing `env(safe-area-inset-*)` rule actually fire on iOS standalone.
- **Top safe-area inset** on `.tempo-topbar` (`css/tempo-shell.css`) — `padding-top: calc(12px + env(safe-area-inset-top,0px))` so the wordmark + icons clear the notch/status bar.
- **Focus/ambient overlay insets** (`css/styles.css`) — `.focus-overlay` padded by all four insets; `.focus-hint` lifted above the home indicator.
- **Wake Lock** — new `Platform.keepAwake(on)` seam (`js/platform.js`): web `navigator.wakeLock` (feature-detected, re-acquires on `visibilitychange:visible` since the OS drops it on background), native `@capacitor-community/keep-awake` (no-op if absent). Acquired/released by every mode's render-loop start/stop (`ui.js`, `timer-ui.js`, `pomodoro-ui.js`, `flow-ui.js`, `interval-ui.js`, `cooking-ui.js`) and held for the whole Focus session (`focus-ui.js`, released on exit only if the underlying engine isn't still running).
- **SW update-to-reload** (`js/app.js`) — one-shot `controllerchange → location.reload()` guarded by a `swReloading` flag, so an open tab picks up a freshly-deployed worker instead of running stale cached modules until every tab closes.
- **SW stale-while-revalidate + navigation fallback** (`sw.js`) — serve cache, revalidate same-origin GETs in the background (self-heals a missed `CACHE_NAME` bump), and fall back to the cached app shell for offline navigations. Cross-origin (Firebase/gstatic) responses are never written back. `?nosw=1` test bypass preserved.
- **First-session background notifications** (`js/bg-notify.js`) — `postToSW()` falls back to `navigator.serviceWorker.ready.then(reg => reg.active.postMessage(...))` so a timer started before the first SW claim still schedules.
- **iOS install affordance** (`js/app.js`) — iOS + non-standalone detection shows a one-line "tap Share → Add to Home Screen" hint reusing `.install-banner` + the shared `install_dismissed` key (iPadOS-reports-as-Mac handled).
- **AudioContext resume** (`js/audio.js`) — `getCtx()` resumes a suspended context on every access and a new `SFX.resume()` is called from the `visibilitychange:visible` handler, so the completion alarm is audible after a lock/unlock.
- **Foreground render-loop resume** (`js/ui.js`) — the visibility handler now re-arms Timer/Flow/Interval/Cooking loops (previously only Stopwatch + Pomodoro), so a backgrounded-then-foregrounded view isn't frozen until the user touches it.
- **theme-color for `auto`** (`js/themes.js`) — resolves from live `prefers-color-scheme` (the `auto` preset has `vars:null`) + a media-query listener keeps the status-bar tint in sync.
- **manifest** (`manifest.json`) — dropped the "(feature branch)" placeholder description; added `id`/`scope`/`lang`/`dir`/`categories` + explicit `purpose:"any"`.
- **`<noscript>` fallback** + **`defer` on all 80 `<script>` tags** (`index.html`) — `defer` preserves the load-order dependency contract while unblocking the parser (cheapest TTI win, no bundler).
- `sw.js` `CACHE_NAME` → `stopwatch-v120-overhaul-f-pwa`.

## 2. The why

- **`defer`, not bundling.** The load-order-as-dependency-graph design relies on synchronous global side-effects at eval time, which precludes a bundler — but `defer` guarantees in-document-order execution after parse, so it matches the existing contract exactly with a one-attribute mechanical change. (`app.js` already inits at the end / against a fully-parsed DOM either way.)
- **Wake lock tied to render-loop lifetime.** The RAF loops already precisely bracket "actively counting" and self-stop on pause/reset/finish, so acquiring in start*/releasing in stop* (and in the loops' terminal branches) needs no engine-layer edits. On natural finish the lock releases; on background the OS drops it and `Platform.keepAwake` re-acquires on return.
- **Maskable icon deferred.** The 512px icon is a green ring that touches the canvas edge — declaring it `maskable` would crop the logo on Android adaptive-icon masks. Per the finding's own condition ("once a safe-zone icon exists") the maskable entry was intentionally NOT added; needs a padded safe-zone asset first.
- **SWR over pure cache-first.** A missed `CACHE_NAME` bump (a documented footgun) previously served stale code with no self-heal; background revalidation fixes freshness on the next load without abandoning offline.
- **Verify-before-fixing.** D had already removed `user-scalable=no` (pinch-zoom a11y), so F's viewport edit only adds `viewport-fit=cover` to the current meta rather than restoring the audit-quoted string.

## 3. Verification status

- All 13 modified JS files pass `node --check`; `check-asset-integrity` (80==80) and `check-sw-bump` pass; `manifest.json` parses.
- **Engine test suite NOT run in-session** — no browser MCP available and the Playwright binary download is network-blocked in this environment. Changes are UI-layer + PWA config (engine tests are engine-only). **Open `tests/index.html` in a real browser to confirm the count is still green.**
- **RUNTIME-VERIFY (device/simulator):** iOS safe-area (topbar + Focus overlay), Wake Lock behavior (varies by iOS Safari version), and the SW update-to-reload handshake should be checked on a real install.

## 4. Suggested next steps

- E-polish follow-ups (per-panel `--chart-1..6`, `Utils.formatHuman`, shared `.tempo-card`/`.tempo-empty`).
- Batch C remainder (ModeButtons C3 incremental refactor, undo-toast generalization).
- Batch D human VoiceOver/NVDA pass.
- Repo records: CLAUDE.md backlog/file-map, `CHANGELOG.md`.
- Generate a padded safe-zone icon, then add the `maskable` manifest entry.
