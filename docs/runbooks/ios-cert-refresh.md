# Runbook: iOS 7-day signing cert refresh

- **Scope:** Native iPhone build only. The web build is unaffected — see [Web is unaffected](#web-is-unaffected).
- **Cadence:** Weekly (every ≤7 days). Manual chore — there is no reminder.
- **Owner:** ksdisch (solo).
- **Last verified:** 2026-05-30.
- **Source of truth:** [`iOS-BUILD.md`](../../iOS-BUILD.md) → "The 7-day signing cert (free Apple ID limitation)" (`iOS-BUILD.md:66-86`). This runbook is the distilled operational view; the fuller playbook (Podfile gotchas, daily cheat sheet) lives there.

## When / why

Tempo is signed for on-device install with a **free Apple ID**, which issues a **7-day** development cert (`iOS-BUILD.md:68`). After 7 days the cert expires and iOS revokes the app: tapping the Tempo icon on the iPhone **bounces straight back to the home screen** instead of launching (`iOS-BUILD.md:68`).

There is no system reminder and no in-app warning — the cert just silently dies on the 7th day. That silence is the entire reason this runbook exists: refreshing the cert is a recurring manual chore the operator has to remember to do. Re-deploying from Xcode re-signs the app and resets the clock to a fresh 7 days (`iOS-BUILD.md:77`).

The paid escape hatch ([$99/yr Apple Developer Program](#escape-hatch)) replaces the 7-day cert with a 1-year cert and removes the weekly chore; it is currently out of scope for solo personal use.

## Symptom

- Tapping the **Tempo** icon on the iPhone bounces back to the home screen; the app never opens (`iOS-BUILD.md:68`).
- It has been ≥7 days since the last Xcode `Run` to the device.
- Nothing is wrong with the code or the web build — the **web app keeps working normally** at <https://ksdisch.github.io/stopwatch/> (`iOS-BUILD.md:3`). A broken icon on the phone while the web app is fine is the tell.

## Steps

Run from any checkout or worktree — `git rev-parse --show-toplevel` resolves to the repo root, so these commands are path-agnostic (`iOS-BUILD.md:24`, `iOS-BUILD.md:73`):

```bash
cd "$(git rev-parse --show-toplevel)"   # repo root — works from any checkout or worktree
npm run ios:open                         # copy web assets into the iOS bundle, then open Xcode
```

`npm run ios:open` = `npm run ios:copy && cap open ios` (`package.json:9`), and `ios:copy` = `npm run sync-www && cap copy ios` (`package.json:8`). So the one command mirrors the repo root into `www/` via `scripts/sync-www.mjs` (`package.json:7`), pushes `www/` into the iOS bundle with `cap copy ios`, then opens the Xcode project. **No Podfile regeneration happens** — that is deliberate (see [What NOT to run](#what-not-to-run)).

Then, in Xcode:

1. Plug in your iPhone via USB.
2. Select the iPhone as the run destination from the **top-center dropdown** (`iOS-BUILD.md:77`).
3. Hit **▶ Run** (`⌘R`).

The build + install takes **~30 seconds** (`iOS-BUILD.md:77`). On completion, Xcode has re-signed the app against a fresh development cert.

## Verify

- Xcode reports a successful build + install (no signing errors in the activity bar).
- On the iPhone, tapping the **Tempo** icon now **launches the app** instead of bouncing to the home screen — the inverse of the [Symptom](#symptom) (`iOS-BUILD.md:68`).
- The cert is good for another 7 days from this run (`iOS-BUILD.md:77`).

## Cadence

- **Refresh at least once every 7 days.** The cert is hard-capped at 7 days from the last device deploy (`iOS-BUILD.md:68`).
- **Early re-deploys are free.** You can refresh any time before expiry — there is **no penalty for re-deploying early** (`iOS-BUILD.md:79`). In practice the cleanest habit is to piggyback the refresh on any normal web-asset push to the phone (`npm run ios:copy` then `⌘R`, per the daily cheat sheet at `iOS-BUILD.md:104`), so the 7-day clock effectively never runs out during active development. The dedicated weekly run only matters during a gap where you haven't touched the native build.

## What NOT to run

- **Do not use `npm run ios:sync` for a routine cert refresh.** `ios:sync` = `npm run sync-www && cap sync ios` (`package.json:10`), and `cap sync` regenerates the `capacitor_pods` function block inside `ios/App/Podfile` (`iOS-BUILD.md:36`). Any manual Podfile edit gets overwritten — including the standalone `GoogleSignIn` entry and `post_install` hook that make `signInWithGoogle` build on this CocoaPods version (`iOS-BUILD.md:38`, `iOS-BUILD.md:43-49`).
- `ios:sync` is only for when you **add or remove a Capacitor plugin** via `npm install` (`iOS-BUILD.md:64`). A cert refresh changes no dependencies, so it must use the copy-only path (`ios:copy` / `ios:open`), which **does not regenerate the Podfile** (`iOS-BUILD.md:64`).

## Web is unaffected {#web-is-unaffected}

This runbook is **native-only**. The web build deploys **separately and instantly** via `git push` to GitHub Pages and is **byte-equivalent** to before the Capacitor wrapper landed (`iOS-BUILD.md:3`, `iOS-BUILD.md:32`, `iOS-BUILD.md:90`). The Capacitor wrapper is purely additive: on web, `Platform.haptic` / `Platform.notify` delegate to `navigator.vibrate` / `new Notification` exactly as before, and the service worker still registers (gated on `!Platform.isNative`) (`iOS-BUILD.md:92`, `iOS-BUILD.md:94`).

A dead cert on the phone never affects web users — the live site keeps serving. For the web deploy + service-worker cache-bump procedure, see [`deploy-and-cache-bump.md`](./deploy-and-cache-bump.md).

## Escape hatch {#escape-hatch}

To stop refreshing weekly, enroll in the **$99/yr Apple Developer Program**, which provides (`iOS-BUILD.md:81-84`):

- **1-year certs** — renew once a year instead of weekly.
- **TestFlight** — share with up to 10,000 beta testers without App Store review.
- **App Store distribution** — anyone with an iPhone can install.

For solo personal use this is **overkill** (`iOS-BUILD.md:86`), so it stays deliberately out of scope. The Developer Program and everything it unlocks (App Store Connect record, privacy nutrition labels for the meds + BFRB health data, App Review screenshots, age rating, 1024×1024 icon polish) are listed under "Out of scope for the current build" (`iOS-BUILD.md:110-118`). The same "shipped to personal device; App Store paperwork remaining" status is tracked as the App Store distribution roadmap item (`CLAUDE.md:173`, backlog row #1; Capacitor wrapper landed in commit `72eb338`, PR #45). The roadmap framing of that upgrade lives in [`ROADMAP.md`](../../ROADMAP.md).

## Related

- [`iOS-BUILD.md`](../../iOS-BUILD.md) — the fuller native playbook: Podfile gotchas, daily workflow cheat sheet, out-of-scope list.
- [`deploy-and-cache-bump.md`](./deploy-and-cache-bump.md) — the web side: `git push` → GitHub Pages, `CACHE_NAME` bump.
- [ADR 0007 — Capacitor iOS shell](../adr/0007-capacitor-native-wrapper.md) — why there is a native target at all (no-build web app wrapped in Capacitor, not a rewrite).
- [`ROADMAP.md`](../../ROADMAP.md) — App Store distribution as a roadmap item.
