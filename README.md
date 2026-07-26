# Tempo — Stopwatch, Timers, and Wellness PWA

> A vanilla-JS Progressive Web App that started as an iPhone-style stopwatch and grew into a four-pillar productivity + wellness tool with full cross-device cloud sync. Same codebase ships to the web (GitHub Pages) and to iOS (Capacitor wrapper).

![Language](https://img.shields.io/badge/language-Vanilla_JS-yellow)
![Build](https://img.shields.io/badge/build-no_bundler-green)
![Tests](https://img.shields.io/badge/engine_tests-797_cases-blue)
![PWA](https://img.shields.io/badge/PWA-installable-purple)
![iOS](https://img.shields.io/badge/iOS-Capacitor-lightgrey)
![Sync](https://img.shields.io/badge/cloud_sync-Firestore-orange)

**Live:** https://ksdisch.github.io/stopwatch/
**Repo:** https://github.com/ksdisch/stopwatch
**iOS:** Capacitor-wrapped, signed to personal device. Not yet on the App Store.

---

## Table of Contents

- [TL;DR](#tldr)
- [What This Project Is](#what-this-project-is)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Key Flows](#key-flows)
  - [1. Drift-free stopwatch tick](#1-drift-free-stopwatch-tick)
  - [2. "I took my medication ~30 minutes ago" — the project's USP](#2-i-took-my-medication-30-minutes-ago--the-projects-usp)
  - [3. Cross-device cloud sync round trip](#3-cross-device-cloud-sync-round-trip)
  - [4. Same codebase, two targets: GitHub Pages and iOS](#4-same-codebase-two-targets-github-pages-and-ios)
- [Project History](#project-history)
  - [Milestone Summary](#milestone-summary)
  - [Decisions & Tradeoffs](#decisions--tradeoffs)
  - [Full Chronology](#full-chronology)
- [Repository Structure](#repository-structure)
- [User Guide](#user-guide)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
  - [Running locally](#running-locally)
  - [Usage examples](#usage-examples)
  - [Common workflows](#common-workflows)
  - [Troubleshooting](#troubleshooting)
  - [Deployment](#deployment)
- [A note on the repo's docs](#a-note-on-the-repos-docs)
- [License](#license)
- [Footer](#footer)

---

## TL;DR

I built **Tempo** to fix a real problem in my life: I'd take my medication, forget how long ago I took it, and have no way to count from "thirty minutes ago." Most stopwatches force you to start at zero. This one lets you start with time already on the clock — `00:30:00`, counting up — and works the same way on my laptop, my phone, and as an installable PWA.

What started as a single feature grew into a four-pillar productivity + wellness app: **Timers** (stopwatch, countdown, Pomodoro, Flow Block, Interval, Cooking), **Wellness** (Meds, Exercise, Mindful, Cooking, Recovery), **Rhythm** (a daily event timeline + a recovery-readiness band fed by an external health-data pipeline), and **Analytics**. The most interesting engineering piece is that all of it runs as vanilla HTML + CSS + JS with no build step, and the same static folder I push to GitHub Pages also wraps into a Capacitor iOS shell — and as of mid-2026, every record syncs across devices through Firebase / Firestore with my own per-store merge strategy.

---

## What This Project Is

Tempo is a single-user, cross-device productivity + wellness app. It is my own personal tool, not a commercial product. I use it daily, so I treat it as production software: I write engine tests, I document decisions, I bump service-worker cache versions on every deploy, I keep an architectural plan checked into the repo.

**Who it's for.** Me. By extension, anyone whose day involves: tracking medications by elapsed time rather than fixed clock-times, doing 90- or 120-minute deep-work blocks, running interval workouts, logging body-focused repetitive behaviors (BFRBs) like skin picking or nail biting, and wanting all of that to follow them between their laptop and phone.

**Status.** Active development. The most recent stage (cloud sync) shipped 28 sequential PRs across six stages between 2026-04 and 2026-05. The web build deploys to GitHub Pages on `git push`. The iOS build runs on my own iPhone via Capacitor + free-tier Apple ID signing.

---

## Tech Stack

| Component | Tool / Library | Why I Chose It |
|---|---|---|
| Language | Vanilla **JavaScript** (ES2020+), HTML, CSS | No build step. The script-tag order in `index.html` IS the dependency graph. I wanted to deploy by `git push` and never wrestle with a bundler. |
| Architecture | Plain global functions + factory-pattern engines (`createStopwatch(id)`, `createTimer(id)`, `createMed(id)`) + IIFE singletons (`History`, `Persistence`, `SFX`, `Themes`, `SyncEngine`) | A framework on a single-user, single-page app would have been overhead with no payoff. Globals + script order give me 60+ tightly-scoped modules without an import graph. |
| State persistence | `localStorage` for config + small structured stores, `IndexedDB` (`stopwatch_history_db.sessions`) for the session history table | `localStorage` is fast and synchronous for tiny records; IndexedDB scales for the one table that grows without bound. |
| PWA | Service worker (`sw.js`, cache-first with version-bumped `CACHE_NAME`), `manifest.json` with 6 deep-link shortcuts, web-app `standalone` display | Install on phone home-screen, run offline. The `CACHE_NAME` bump rule is a hard convention in `CLAUDE.md`: bump on every PR that changes a cached file. |
| Audio | **Web Audio API** synthetic tones (no audio files) | Bundling 30 chime variants would balloon the cache. Generating them in code costs ~200 lines of `OscillatorNode` glue and ships zero bytes of audio. |
| Animation | **`requestAnimationFrame`** render loop, CSS transforms + transitions, inline SVG (analog clock face, breathing circle) | 60 fps without a library. Render loop only updates the in-progress lap's text node, not the whole list. |
| Native shell | **Capacitor 6** (`@capacitor/core`, `@capacitor/ios`) + `@capacitor/haptics` + `@capacitor/local-notifications` + `@capacitor-firebase/authentication` + `@capacitor-firebase/firestore` | Lets the same web code wrap into a real iOS app so haptics + scheduled notifications work properly. I abstracted all 23 haptic call sites + 6 immediate-notification sites through `js/platform.js` so the web build is byte-equivalent to before. |
| Cloud backend | **Firebase / Firestore** (project `tempo-sync-6f7b2`, region `us-central1`, Spark plan), Google sign-in | Cheapest path to multi-device sync that handles auth, security rules, and per-document CAS. I considered self-hosting; the operational cost dwarfed the per-read pricing for personal use. The tradeoff is Firestore-shaped vendor lock-in (no joins, doc-level CAS only), documented in `docs/sync-review/BACKEND-SELECTION.md`. |
| Auth | Firebase Auth — Google sign-in only, web via popup, native via `@capacitor-firebase/authentication` | One provider. No password storage on my end. Google handles the rest. |
| Tests | Custom in-browser runner (`tests/test-runner.js`) — `describe / it / assert / assertEqual / assertClose / assertArrayEqual`. Opens via `tests/index.html` in any browser; the page title self-reports the live pass/fail count. **~797 engine-test cases across 32 files.** | No Node test toolchain. Engines have no DOM dependency, so they run in a vanilla page. Subagents that need to run tests use Kapture MCP to load the URL in a real browser. |
| CI / lint / typecheck | **None today** (a CI gate — headless test run + `index.html`↔`sw.js` asset-parity + cache-bump check — is the next planned addition; see [`docs/artifacts-plan.md`](docs/artifacts-plan.md)). | Single contributor, engine-test-only coverage. I rely on the tests + manual verification + a documented sync-auditor subagent flow for cloud-sync PRs. |
| Hosting (web) | **GitHub Pages** from `main` branch root | Auto-deploy on `git push`. ~1 minute to live. |
| Hosting (native) | Apple ID free-tier signing on personal device (7-day cert refresh). No App Store yet. | $99/yr Apple Developer Program enrollment + privacy nutrition labels are explicitly deferred. |

---

## Architecture

```mermaid
flowchart TB
  subgraph user_surface["User surface (index.html)"]
    nav[Tempo nav shell<br/>tempo-nav.js]
    pillars[4 pillars × sub-tabs<br/>Timers · Wellness · Rhythm · Analytics]
  end

  subgraph engines["Engines (pure data + logic)"]
    sw[stopwatch.js / timer.js<br/>createStopwatch(id), createTimer(id)<br/>InstanceManager: up to 5 each]
    pomo[pomodoro.js · flow.js · interval.js · sequence.js]
    meds[meds.js — createMed + MedsManager]
    history[history.js — IndexedDB]
    bfrb[bfrb-events.js · distractions.js]
    presets[presets.js · sequence-templates]
  end

  subgraph ui_layer["UI layer (one per engine)"]
    ui[ui.js + timer-ui.js + pomodoro-ui.js + flow-ui.js +<br/>interval-ui.js + meds-ui.js + … + analytics-ui.js]
  end

  subgraph platform["Platform abstraction"]
    platform_js[platform.js<br/>haptic() · notify()]
    bg[bg-notify.js → SW or LocalNotifications]
  end

  subgraph persist["Persistence"]
    local[localStorage<br/>multi_state · pomodoro_state · wellness_meds · …]
    idb[(IndexedDB<br/>stopwatch_history_db.sessions)]
    sw_js[sw.js<br/>cache-first SW]
  end

  subgraph sync["Cloud sync (toggle: tempo_sync_enabled)"]
    flag[sync-flag.js]
    auth[sync-auth.js<br/>Google sign-in]
    engine[sync-engine.js<br/>SYNCED_STORES × 6<br/>push · hydrate · steady-state]
    fs[sync-firestore.js<br/>web SDK / Capacitor plugin]
    merges[6 merge modules:<br/>meds · history · rest_log ·<br/>presets · bfrb · distractions]
    firestore[(Firestore<br/>users/{uid}/{store}/{record})]
  end

  user_surface --> ui_layer
  ui_layer --> engines
  engines --> persist
  engines --> platform
  platform --> platform_js
  platform_js -->|web| bg
  platform_js -->|native| caps[Capacitor plugins]

  engines --> engine
  engine --> flag
  engine --> auth
  engine --> merges
  engine --> fs
  fs --> firestore

  subgraph external["External integrations"]
    todoist["Todoist REST v2<br/>todoist.js · todoist-ui.js<br/>two-way task sync"]
    elt["personal-health-elt pipeline<br/>(separate repo, Admin SDK)"]
  end

  ui_layer --> todoist
  elt -->|writes recovery_state| firestore
  firestore -.->|recovery_state read-only| engines

  subgraph build["Build targets"]
    pages[GitHub Pages<br/>git push to main]
    capacitor[Capacitor iOS<br/>scripts/sync-www.mjs → www/ → cap copy ios]
  end

  user_surface -.-> pages
  user_surface -.-> capacitor
```

The shape I keep coming back to: **engines are pure data + logic, UI modules wire engines to the DOM, and a thin platform layer routes side effects (haptic, notify) to web or native.** Sync is bolted on top of the engines as a side channel — engines write to `localStorage` / IndexedDB as they always did, `SyncEngine` reads snapshots out and reconciles cloud writes back in.

The "mutable global proxy" pattern is worth calling out: every engine has a default singleton (`let Stopwatch = createStopwatch('sw-default')`). When a different instance is promoted to "primary" via `InstanceManager`, the `Stopwatch` global is reassigned. Every UI module that closes over `Stopwatch.start()` automatically operates on the new primary — no event bus, no observer pattern, just one mutable binding.

---

## Key Flows

### 1. Drift-free stopwatch tick

The engine never increments a counter on a timer. Elapsed time is derived from the wall clock on every read.

```
js/stopwatch.js:11   getElapsedMs():
                       elapsed = offsetMs + accumulatedMs
                       if running: elapsed += Date.now() - startedAt

js/ui.js (RAF loop)  on each animation frame:
                       read Stopwatch.getElapsedMs()
                       update only the current-lap text node
                       update gradient bar position

(pause)              accumulatedMs += Date.now() - startedAt
                     startedAt = null
                     status = 'paused'

(reload mid-run)     loadState reads startedAt from localStorage
                     getElapsedMs() recomputes against current Date.now()
                     → display picks up exactly where it left off
```

The whole engine is ~270 lines (`js/stopwatch.js`). There's no `setInterval` anywhere — that would drift and would lie after a tab sleep. The `requestAnimationFrame` loop in `js/ui.js` is purely cosmetic; the truth lives in `startedAt` + `Date.now()`.

### 2. "I took my medication ~30 minutes ago" — the project's USP

This is the single feature the rest of the app grew out of. The offset-input panel (`js/offset-input.js`) lets me type `0h 30m 0s` before pressing Start. The stopwatch begins at `00:30:00` and counts up.

```
js/offset-input.js          user enters h/m/s → validates → Stopwatch.setOffset(ms)
js/stopwatch.js:64          setOffset only allowed when status === 'idle'
js/ui.js                    Start button → Stopwatch.start()
                              startedAt = Date.now(); status = 'running'
display                     reads getElapsedMs() = offsetMs + (now - startedAt)
                              → 30:00, 30:01, 30:02, …
```

For the Meds pillar (`js/meds.js` / `js/meds-ui.js`), the same idea drives the **"Took it ~X ago"** button: I tap an offset, and the dose log gets stamped with `takenAt = Date.now() - offsetMs`. That's the difference between V1 of Meds (schedule-based, abandoned) and V2 (log-based, shipped in PR #13): V2 doesn't assume I take pills on time, it just records when I actually took them and derives "today's adherence" from the log.

### 3. Cross-device cloud sync round trip

This is the largest single subsystem in the repo — 28 sequential PRs across stages **S0 → A → B → C → D → E**, fully specified in `docs/CLOUD-SYNC-STRATEGY.md` (v2.0) and `docs/sync-impl/PLAN.md`.

```
Device A (laptop)                                Device B (phone)
─────────────                                    ─────────────
User signs in (Google)                           User signs in (same Google account)
sync-auth.js → SyncAuth.onAuthChange fires

User taps "Push to cloud" (Stage B-3)            (boots later)
sync-engine.js                                   sync-engine.js
  pushSnapshot():                                  init() → hydrateFromCloud():
    F12 mandatory local backup                       gate: signed in + flag on +
    for each of 6 SYNCED_STORES:                       not already hydrated +
      adapter.read() → snapshot                       no Stage D handoff
      stamp deviceId + updatedAt +                  pull order: rest_log →
        schemaVersion (sync-stamps)                   meds → presets → history
      write via sync-firestore.js → CDN-loaded      apply each store; per-store
        firebase/firestore SDK                       hydrated marker on success
    set tempo_sync_state='ready'                  set tempo_sync_hydrated_all='1'
                                                  startSteadyState()

                                                30s setInterval (E-1b)
                                                  _runMergeCycle() (E-1e):
                                                    F19a snapshot gate (dispatcher)
                                                    for each store:
                                                      sync-merge-meds.js
                                                      sync-merge-history.js
                                                      sync-merge-rest-log.js
                                                      sync-merge-presets.js
                                                      sync-merge-bfrb.js
                                                      sync-merge-distractions.js
                                                    each merge:
                                                      per-record F19a gate
                                                      LWW or append-merge per
                                                        strategy doc
                                                      runTransaction CAS
                                                        writeback with refuse-
                                                        writeback if cloud
                                                        schemaVersion > local
```

Per-store merge rules are intentionally different: **meds.doseLog** is append-merge dedup'd by `(deviceId, takenAt)` with a ±15-min cross-device window for clock skew (F1 + F16); **meds metadata** (name, dose, frequency) is per-record LWW; **history.sessions** is append-merge by `id` with per-field LWW on `note` / `tags`; **rest_log.naps** is append-merge by `(deviceId, startedAt)`; **presets** carry tombstones via additive `deletedAt`. Each rule is justified in `CLOUD-SYNC-STRATEGY.md` — silent LWW for editable fields, plus a non-blocking toast on health-data multi-entry arrivals (F15) so I notice if a buffered backlog of doses suddenly lands.

Three schema-evolution rules form the safety contract for downlevel-vs-uplevel clients editing the same data: **F19a** (`schemaVersion` stamp + refuse-writeback if cloud > client), **F19b** (`__forward` bag preserves unknown fields verbatim on roundtrip), **F20** (loaders distinguish "field absent → apply default" from "field present-but-unknown → preserve verbatim"). Without these, the first downlevel client to edit any record would silently strip fields written by a newer client.

### 4. Same codebase, two targets: GitHub Pages and iOS

```
repo root /
  index.html, sw.js, manifest.json, css/, js/, icons/  ← cached by SW on web
       │
       ├── git push → GitHub Pages → https://ksdisch.github.io/stopwatch/
       │
       └── scripts/sync-www.mjs (mirrors repo root → www/)
                │
                └── cap copy ios → ios/App/App/public/ → Xcode build → iPhone
```

The trick that makes this work cleanly is `js/platform.js`. It detects `window.Capacitor.isNativePlatform()`. On web it routes `Platform.haptic(pattern)` to `navigator.vibrate(pattern)` and `Platform.notify(title, opts)` to `new Notification(...)`. On native it routes to `@capacitor/haptics` (mapping the existing `navigator.vibrate`-style argument shapes to discrete `Haptics.impact` / `Haptics.notification` calls) and `@capacitor/local-notifications`. **All 23 haptic call sites + 6 notification call sites go through this abstraction** so neither the web build nor the native build needs to change when I touch the engines.

The service worker registers on web only — `js/app.js` skips registration when `Platform.isNative`. On native, scheduled notifications fire from iOS itself even when the WebView is suspended, which is the whole reason for the wrapper.

---

## Project History

### Milestone Summary

The repo is ~8 weeks old at the time of writing (created 2026-04-04; 262 commits across 100+ merged PRs, latest #105). The story is roughly: ship the core stopwatch USP, expand into wellness, harden, go cross-device, then integrate.

| Phase | PRs | What landed |
|---|---|---|
| **1. Stopwatch foundation + visual polish** | pre-#1, #4 | Drift-free engine, RAF render loop, offset input, themes, history, export, swipe-to-delete, analog face, PWA install prompt. Set up the load-order + IIFE-singleton pattern that everything else inherits. |
| **2. Flow Block deep-work mode** | #1 | 90/120-min ultradian focus block + 15-min recovery, pre-block checklist, distraction log, summary card. First mode to introduce a phase state machine beyond the binary running/paused. |
| **3. Wellness pillar buildout** | #10, #11, #12, #13, #15, #23 | Tempo rebrand → 4-pillar nav shell. Shipped Meds (V1 schedule-based, then V2 prescription-focused), Exercise (preset workout launcher → existing Interval engine), Mindful (breathing circle + meditation timers), Cooking (named multi-timer launcher), Recovery (sleep + nap dashboard). |
| **4. BFRB tracking** | #16, #18, #19, #20, #21, #39 | Body-focused repetitive behavior tally. Started as a button inside Flow + Pomodoro, became a global floating action button + keyboard shortcut + 60s competing-response countdown + configurable chime. |
| **5. Analytics dashboard** | #24–#31, #33, #34, #35 | Built per a prioritized plan: focus streak, flow completion rate, distraction leaderboard + hour-of-day heatmap, BFRB trend line with 14/30/90d toggle, BFRB hour-of-day + source breakdown, 30-day med adherence dot row, actual-work log + phase-restart card. Shared `renderCard()` helper landed alongside (#35). |
| **6. Quality-of-life + hardening** | #22, #32, #36, #38, #41, #43, #44 | "End early" partial Flow saves to history, 51 Interval engine tests, manual backup/restore (Option A — full coverage), ±3 min adjust buttons on every countdown surface, TDZ fix for cold-boot freeze, countdown overshoot (count up past zero). |
| **7. iOS via Capacitor** | #45 | `js/platform.js` abstraction, `scripts/sync-www.mjs` mirror, committed Xcode project at `ios/`. Web build stays byte-equivalent. Haptics + notifications now use real iOS APIs on native. |
| **8. Cloud-sync prereqs (Stage A)** | #46–#56 | Five prereq refactors that have to land before cloud sync is safe: doseLog cap → 1000 (F14), `(deviceId, ts, counter)` session IDs (F2), per-write `deviceId` + `updatedAt` stamping (F10), `tempo_sync_state` write gate (F13), per-record meds persistence (F18). Plus three schema-evolution rules (F20, F19a, F19b), the Phase 6 backend decision doc, and the multi-PR implementation plan. |
| **9. Cloud-sync rollout (Stage S0–E)** | #57–#72 | 16 PRs landing actual sync: Firebase project config (#57), `SyncEngine` scaffold + 6-store registry (#58), Google sign-in UI (#60), first cloud upload + F12 backup + push-to-cloud UI (#61), Device-B fresh-hydrate orchestrator + boot overlay (#62), Stage D imported-bucket reconcile (#63) + clock-skew clamp (#64), test-harness SW cache fix (#65), `startSteadyState` + CAS wrapper (#66), per-store merge bodies for meds (#68) → history (#69) → BFRB events (#70) → distractions (#71) → rest_log + presets (#72, sync goes live by default). |
| **10. Post-sync burndown + integrations** | #73–#105 | Real-time `onSnapshot` listeners (E-3) + offline buffer; native sync listener/CAS parity groundwork; the **Rhythm** pillar — a daily event timeline + a recovery-readiness band fed by an external `personal-health-elt` Firestore feed (read-only); procedural ambient noise on Flow/Pomodoro starts; Meds prescription-supply tracking with manual ±1 steppers; one-level Pomodoro phase-revert; and a two-way **Todoist** integration (Pomodoro saved tasks + a Flow per-block task list, with rename write-back). See `CLAUDE.md` and `docs/BUILD-HISTORY.md` for the per-PR detail. |

### Decisions & Tradeoffs

A handful of decisions are worth highlighting because they shaped everything that came after:

- **No build step, no framework.** The script-tag order in `index.html` is the dependency graph. I never had to write a webpack config, never had to debug a Vite cache, never had to choose a state-management library. The cost is ~60 global names in the IIFE singleton pattern + a strict "load engines before UI modules before `app.js`" rule. For a one-person SPA, the math has been firmly in favor of this tradeoff.
- **Engines are factories; everything else is a singleton.** `createStopwatch(id)` / `createTimer(id)` / `createMed(id)` exist because there can be many instances (up to 5 stopwatches + 5 timers, up to 10 meds). Pomodoro, Flow, History, Persistence, Themes, SFX, BfrbEvents, etc. are all singleton IIFEs because there's only ever one of each.
- **Mutable global proxy for "the primary instance."** `let Stopwatch = createStopwatch('sw-default')`. When `InstanceManager` swaps the primary, `Stopwatch` is reassigned. Every UI module sees the new primary without re-binding. This is uglier than an event bus but it makes the call sites unconditional: `Stopwatch.start()` always means "start the primary."
- **Drift-free derivation, not a counter.** `elapsed = offsetMs + accumulatedMs + (Date.now() - startedAt)`. No interval timer increments anything. This is the reason a closed tab can re-open mid-run and pick up exactly where it was.
- **Meds V1 → V2 within 36 hours (#10 → #13).** V1 modeled schedules ("twice a day at 9am / 9pm"). I built it, used it, hated the dishonest "you're due" notifications, deleted the schedule, and shipped V2 as a pure log. The whole feature now says "tell me when you actually took it; I'll show you when." V2 is half the code and twice as honest.
- **Cloud sync as a side channel, not a rewrite.** The engines still write to `localStorage` / IndexedDB on every mutation. `SyncEngine.pushSnapshot()` reads adapters out of those stores; merge modules write back through the same write paths. The engines have no idea sync exists — they just stamp `deviceId` + `updatedAt` + `schemaVersion` on every write (F10 + F19a) and respect the `tempo_sync_state` gate during hydrate (F13). This kept the blast radius of every sync PR small.
- **Per-store merge rules, not one-size-fits-all.** Append-merge for event streams (doseLog, BFRB events, naps), record-level LWW for templates/presets, per-field LWW for editable strings (`note`, `tags`, med name). The strategy doc spells out the rule for every store. The reason for the discipline: a single "LWW everywhere" policy would silently destroy doseLog entries on the second-fastest device.
- **Three schema-evolution rules (F20, F19a, F19b) before shipping a single byte to Firestore.** I landed these as standalone refactors before opening the first sync PR. Once a record exists in the cloud, downlevel clients can find it; without F19a's refuse-writeback contract, a downlevel client editing a future record would corrupt it. This was easier to fix as a prereq than retrofit after.
- **Subagent orchestrator for sync PRs.** The Tempo cloud-sync work runs through a five-agent pipeline defined in `.claude/orchestrator-prompt.md`: `sync-auditor` (affected-files + risks audit, written to `docs/sync-impl/audits/`), `engine-implementer` (engine code only), `engine-tester` (writes tests, runs them in a browser via Kapture), `ui-wirer` (DOM + event handlers, gated on whether the audit touches UI), `pr-shipper` (CLAUDE.md backlog + SESSION-LOG + PLAN updates, branch + commit + PR). Each PR opens with the audit. The discipline shows in commit messages — see the descriptions on #68–#72.
- **No CI, no linter, no typechecker — engine tests + a human review.** ~797 engine-test cases run in `tests/index.html` against the real engines. Sync PRs add ~15–25 new tests each. UI changes get Kapture screenshots + a manual smoke. I am the only contributor; the cost of standing up Jest + JSDOM + ESLint + tsc would have outweighed what they'd catch on a personal project this size.

### Full Chronology

<details>
<summary><strong>Cloud-sync-era PRs #1–#72, ascending by number</strong> (later work #73+ is tracked in <code>CLAUDE.md</code> and <code>docs/BUILD-HISTORY.md</code>)</summary>

| # | Merged | Title |
|---|---|---|
| #1 | 2026-04-14 | Add Flow Block mode for deep work sessions |
| #3 | 2026-04-18 | docs: weekly CLAUDE.md sync (2026-04-17) |
| #4 | 2026-04-18 | Stopwatch visual refresh: translucent tints, typography, drop pulse animations |
| #8 | 2026-05-11 | refactor: dedupe local escapeHtml in favor of shared dom-utils helper |
| #10 | 2026-04-20 | feat(wellness): Meds pillar — dose tracking with countdowns & notifications |
| #11 | 2026-04-20 | feat(wellness): Exercise pillar — workout preset launcher + activity log |
| #12 | 2026-04-20 | feat(wellness): Mindful pillar — breathing exercises + meditation timers |
| #13 | 2026-04-20 | feat(wellness): Meds V2 — prescription-focused flow, no schedule at setup |
| #15 | 2026-04-21 | feat(wellness): Cooking pillar — quick-launch preset grid + activity log |
| #16 | 2026-04-21 | feat(flow): add BFRB tally button in Flow mode |
| #17 | 2026-04-21 | fix(flow): checklist gate was disabling Start in other modes |
| #18 | 2026-04-21 | feat(pomodoro): add BFRB tally button alongside Distraction |
| #19 | 2026-04-21 | feat(bfrb): 60s competing-response countdown on each catch |
| #20 | 2026-04-21 | feat(bfrb): chime when competing-response countdown ends |
| #21 | 2026-04-22 | feat(bfrb): global floating button, keyboard shortcut, configurable chime volume |
| #22 | 2026-04-22 | feat(flow): End-early button saves partial focus block to history |
| #23 | 2026-04-22 | feat(recovery): Wellness › Recovery — rest tracking dashboard (V1) |
| #24 | 2026-04-22 | docs(analytics): prioritized analytics buildout plan |
| #25 | 2026-04-22 | feat(analytics): focus streak card (S-tier #1) |
| #26 | 2026-04-22 | feat(analytics): flow completion rate card (S-tier #2) |
| #27 | 2026-04-22 | feat(analytics): distraction leaderboard + hour-of-day heatmap (S-tier #3) |
| #28 | 2026-04-22 | feat(analytics): BFRB trend line + 14/30/90d toggle (M-tier #1) |
| #29 | 2026-04-22 | feat(analytics): 30-day med adherence dot row (M-tier #2) |
| #30 | 2026-04-22 | feat(analytics): BFRB hour-of-day + source breakdown (deferred B+C) |
| #31 | 2026-04-22 | feat(analytics): actual-work log + phase-restart card (deferred I+J) |
| #32 | 2026-04-23 | test(interval): add 51 engine tests for Interval module |
| #33 | 2026-04-23 | test(analytics): lock in the 42 inline verification scenarios |
| #34 | 2026-04-24 | test(analytics): cover the 5 pre-existing engine functions |
| #35 | 2026-04-24 | refactor(analytics): shared renderCard() helper + CSS dedupe |
| #36 | 2026-04-24 | feat(backup): manual backup/restore with full current coverage (Option A) |
| #38 | 2026-04-29 | docs(claude): reorder feature backlog by impact-vs-effort ROI |
| #39 | 2026-04-29 | feat(bfrb): show today-only count on global FAB with midnight rollover |
| #41 | 2026-04-29 | feat: add ±3 min adjust buttons to all countdown surfaces |
| #43 | 2026-04-29 | fix: TDZ ReferenceError froze countdown display on cold boot |
| #44 | 2026-05-02 | feat(overshoot): countdown timers count up past zero |
| #45 | 2026-05-03 | feat(ios): add Capacitor wrapper for native iOS build |
| #46 | 2026-05-10 | refactor(meds): raise doseLog cap to 1000 (sync prereq F14) |
| #47 | 2026-05-10 | refactor(history): migrate session IDs to deviceId-timestamp-counter (sync prereq F2) |
| #48 | 2026-05-10 | refactor(sync): stamp deviceId + updatedAt at every write site (sync prereq F10) |
| #49 | 2026-05-10 | refactor(sync): introduce tempo_sync_state write gate (sync prereq F13) |
| #50 | 2026-05-10 | refactor(meds): per-record persistence under meds/{medId} prefix (sync prereq F18) |
| #51 | 2026-05-10 | refactor(sync): preserve present-but-unknown enum values on load (F20) |
| #52 | 2026-05-10 | refactor(sync): stamp schemaVersion per record at write (F19a) |
| #53 | 2026-05-10 | refactor(sync): preserve unknown top-level fields via __forward passthrough (F19b) |
| #54 | 2026-05-10 | docs(sync): Phase 6 backend-selection decision doc (Firebase recommended) |
| #55 | 2026-05-11 | docs(sync-impl): multi-PR implementation plan for cloud sync |
| #56 | 2026-05-11 | refactor(sync): Stage A close-out — F4/F6/F7/F21 (sync prereq A-1) |
| #57 | 2026-05-11 | chore(sync): Firebase project config + plugins (S0-1) |
| #58 | 2026-05-11 | feat(sync): SyncEngine module scaffold + per-store snapshot adapters (B-1) |
| #59 | 2026-05-12 | fix(meds): preserve future-schema schemaVersion on loadState/getState (F19a-fix) |
| #60 | 2026-05-12 | feat(sync): Google sign-in + settings drawer Cloud Sync section (B-2) |
| #61 | 2026-05-12 | feat(sync): first cloud upload + F13 gap fixes + Push-to-cloud UI (B-3) |
| #62 | 2026-05-12 | feat(sync): Device B fresh hydrate orchestrator + boot overlay (C-1) |
| #63 | 2026-05-12 | feat(sync): Stage D imported-bucket reconcile (D-1) |
| #64 | 2026-05-12 | feat(sync): Stage D doseLog reconcile + clock-skew clamp (D-2) |
| #65 | 2026-05-13 | fix(tests): tests/index.html SW cache-poisoning fix (E-1a) |
| #66 | 2026-05-13 | feat(sync): startSteadyState scaffold + CAS wrapper (E-1b) |
| #67 | 2026-05-13 | chore(workflow): bake scope-expansion mechanism into engine-implementer agent def |
| #68 | 2026-05-14 | feat(sync): meds steady-state merge + D-1 retrofit + F15 counter (E-1c) |
| #69 | 2026-05-14 | feat(sync): history steady-state merge — sessions only (E-1d) |
| #70 | 2026-05-14 | feat(sync): F3 BFRB stream consolidation (E-1d-f3) |
| #71 | 2026-05-14 | feat(sync): F8 distraction sessionId-keyed migration (E-1d-f8) |
| #72 | 2026-05-14 | feat(sync): rest_log + presets merge + per-store F19a + sync goes live (E-1e) |

PR #2, #5, #6, #7, #9, #14, #37, #40, #42 are gaps in the merged-PR sequence — closed-without-merging or numbered through but not landed. Only merged PRs are shown above.

</details>

---

## Repository Structure

```
stopwatch/
├── index.html                  # App shell, all DOM. Script-tag order = dep graph.
├── manifest.json               # PWA manifest, 6 deep-link shortcuts.
├── sw.js                       # Service worker, cache-first, version-bumped per deploy.
├── package.json                # Capacitor + Firebase deps. No web build scripts.
├── capacitor.config.json       # appId=com.ksdisch.tempo, webDir=www.
├── firebase.json               # Firestore rules + indexes pointers.
├── firestore.rules             # users/{uid}/** scoped to request.auth.uid.
├── firestore.indexes.json      # (empty — no composite indexes needed)
├── CLAUDE.md                   # Project reference + backlog. Source of truth for design decisions.
├── iOS-BUILD.md                # Day-to-day Capacitor playbook (7-day cert refresh, etc.)
│
├── css/
│   ├── styles.css              # ~5,590 lines. Themes (6 presets via CSS vars), responsive, a11y, animations.
│   └── tempo-shell.css         # Tempo nav shell — pillars, sub-nav, settings drawer.
│
├── js/                          # 68 modules. Categories below.
│   │
│   │  ── Shared utilities ──
│   ├── utils.js                # Utils.formatMs(ms)
│   ├── dom-utils.js            # escapeHtml(str)
│   ├── platform.js             # haptic + notify abstraction (web vs Capacitor)
│   ├── schema.js               # F19a/b/F20 stamping + roundtrip helpers
│   │
│   │  ── Engines (data + logic, no DOM) ──
│   ├── stopwatch.js timer.js instance-manager.js
│   ├── pomodoro.js flow.js interval.js sequence.js
│   ├── meds.js history.js bfrb-events.js distractions.js
│   ├── presets.js pomodoro-stats.js analytics.js
│   ├── rhythm-engine.js recovery-feed.js   # Rhythm timeline + external recovery_state reader
│   ├── todoist.js                # Todoist REST v2 client + offline queue
│   ├── persistence.js backup.js export.js
│   │
│   │  ── UI modules (one per engine, mostly) ──
│   ├── ui.js                   # Main stopwatch UI + RAF render loop
│   ├── cards-ui.js compare-ui.js timer-ui.js pomodoro-ui.js flow-ui.js
│   ├── alert-ui.js interval-ui.js cooking-ui.js history-ui.js
│   ├── sequence-ui.js analytics-ui.js focus-ui.js presets-ui.js offset-input.js
│   ├── meds-ui.js exercise-ui.js mindful-ui.js wellness-cooking-ui.js recovery-ui.js
│   ├── rhythm-ui.js todoist-ui.js
│   ├── bfrb-recovery.js global-bfrb.js
│   ├── tempo-nav.js            # Pillar tabs, sub-nav, hash routing, settings drawer
│   ├── analog.js               # SVG analog clock face
│   ├── audio.js themes.js bg-notify.js
│   │
│   │  ── Cloud sync (S0 → E) ──
│   ├── sync-firebase-config.js sync-flag.js sync-firestore.js
│   ├── sync-buffer.js sync-engine.js sync-toast.js sync-auth.js sync-manual-dedupe.js
│   ├── sync-merge-meds.js sync-merge-history.js sync-merge-rest-log.js
│   ├── sync-merge-presets.js sync-merge-bfrb.js sync-merge-distractions.js
│   │
│   └── app.js                  # Entry point. Wires all modules. Loaded last.
│
├── tests/                       # ~797 engine-test cases (32 files), run via tests/index.html in a browser
│   ├── index.html              # Test harness. ?nosw=1 bypasses SW cache (E-1a fix).
│   ├── test-runner.js          # describe / it / assert / assertEqual / assertClose / assertArrayEqual
│   ├── stopwatch.test.js timer.test.js pomodoro.test.js flow.test.js interval.test.js
│   ├── meds.test.js presets.test.js schema.test.js
│   ├── analytics.test.js export.test.js backup.test.js
│   ├── bfrb-events.test.js distractions.test.js
│   └── sync-*.test.js          # 11 sync test files (auth, engine, hydrate,
│                               #   imported-bucket, stamps, uploader, 6 × merge)
│
├── docs/
│   ├── CLOUD-SYNC-STRATEGY.md  # v2.0 — backend-agnostic merge rules, schema rules
│   ├── TEMPO-PLAN.md           # Tempo rebrand + four-pillar plan
│   ├── ANALYTICS-PLAN.md       # Prioritized analytics buildout (S/M/deferred tiers)
│   ├── SESSION-LOG.md          # One entry per session
│   ├── sync-impl/
│   │   ├── PLAN.md             # Multi-PR sync implementation plan, source of truth
│   │   ├── FIREBASE-SETUP.md   # Manual one-time Firebase project setup
│   │   ├── F7-AUDIT.md         # loadState-recovery write-back audit
│   │   ├── audits/             # One AUDIT.md per sync PR (sync-auditor output)
│   │   └── prompts/            # One PROMPT.md per sync PR (orchestrator brief)
│   ├── sync-review/            # Three-lens adversarial review + backend selection
│   └── stopwatch-expansion-prompt.md
│
├── scripts/
│   └── sync-www.mjs            # Mirror repo root → ./www/ for `cap copy ios`
│
├── ios/                         # Committed Xcode project (Capacitor scaffold)
│   └── App/App/GoogleService-Info.plist   # committed — public iOS client config (safe per FIREBASE-SETUP.md)
│
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
│
└── .claude/                     # Subagent + orchestrator config for sync PRs
    ├── orchestrator-prompt.md
    ├── agents/                 # sync-auditor / engine-implementer / engine-tester /
    │                           #   ui-wirer / pr-shipper
    └── templates/phase-brief.md
```

`node_modules/` and `www/` are gitignored. `www/` is regenerated by `scripts/sync-www.mjs` on every Capacitor copy.

---

## User Guide

### Prerequisites

To run the **web build** locally:
- Any modern browser (Chrome, Safari, Firefox, Edge).
- Python 3 (for the dev server one-liner) OR any static file server. The app loads `js/*.js` via `<script>` tags, so opening `index.html` directly via `file://` will fail for service-worker registration but works for engine-only smoke tests.

To run the **iOS build**:
- macOS, Xcode 15+, an iPhone with iOS 16+.
- **Node 20+** (Capacitor 6 requires it).
- **CocoaPods** (`brew install cocoapods`) — required by `cap add ios`.
- A free Apple ID for signing (works on personal device; certs expire after 7 days).
- For cloud-sync development specifically: a Firebase project and a `GoogleService-Info.plist` placed at `ios/App/App/GoogleService-Info.plist` (gitignored, manual setup — see `docs/sync-impl/FIREBASE-SETUP.md`).

There is **no Node-based test runner**, no linter, no typechecker. The repo does not need `npm install` to serve the web build — it only needs npm to build the iOS app.

### Installation

```bash
git clone https://github.com/ksdisch/stopwatch.git
cd stopwatch

# Web only — no install needed. Skip to "Running locally."

# iOS — one-time setup:
npm install                # pulls Capacitor + plugins (~100 packages)
brew install cocoapods     # if not already installed
npx cap add ios            # scaffolds ios/ Xcode project (already committed,
                           #   but safe to re-run; idempotent)
```

### Configuration

The app reads its configuration from a mix of `localStorage` keys and one committed source file:

- **`js/sync-firebase-config.js`** — public Firebase Web SDK config (the snippet from your Firebase project's web-app settings). Contains only public client config, no secrets. Committed.
- **`ios/App/App/GoogleService-Info.plist`** — iOS Firebase config (downloaded from your Firebase project's iOS-app settings). **Committed** to the repo — Firebase's security model treats this as public client config, not a secret (see `docs/sync-impl/FIREBASE-SETUP.md`). You only replace it if you point the app at your own Firebase project. (Admin **service-account** keys are a different thing entirely and are gitignored — never commit those.)
- **localStorage** — every user-facing preference lives here. The full list of keys is documented in `CLAUDE.md` under "Additional localStorage keys" — themes, sound mute, BFRB volume, sync flag, presets, etc. None of these are touched by `npm install` or any build script; they're set by the app's own UI.

The **cloud-sync feature is off by default** (`localStorage.tempo_sync_enabled` is unset). To enable it: open the settings drawer (gear icon) → Cloud Sync section → toggle on → sign in with Google → tap "Push to cloud" once on your first device.

No `.env` file. No secrets in the repo.

### Running locally

```bash
# From the repo root:
python3 -m http.server 8765

# Open in any browser:
#   App:    http://localhost:8765/
#   Tests:  http://localhost:8765/tests/index.html
```

The test harness prints pass/fail counts directly to the page (and mirrors them into `document.title`). The suite is **~797 cases across 32 files**; a small number of recovery-feed cases are known-failing pending a fix (tracked in `CLAUDE.md` tech-debt). Run it in a real browser — `curl`-grepping `tests/index.html` only returns the empty shell and does *not* execute the tests.

For the iOS build:

```bash
npm run ios:open     # runs sync-www → cap copy ios → opens Xcode

# In Xcode: plug in iPhone → select it as the destination → ⌘R
```

Subsequent iterations after web-code changes:

```bash
npm run ios:copy     # sync-www → cap copy ios (Xcode already open: ⌘R)
```

### Usage examples

**Stopwatch with offset start** (the project's USP):
1. Open the app.
2. In the Stopwatch surface, expand the offset input panel ("Start with time already elapsed").
3. Type the hours/minutes/seconds you want to start from (e.g., `0 / 30 / 0`).
4. Tap Start. The display reads `00:30:00` and counts up.

**Log a medication dose retroactively**:
1. Navigate to `Wellness > Meds` (or via hash route: `#/wellness/meds`).
2. Add a med (name + optional dose + frequency).
3. On the med card, tap **"Took it ~"**.
4. Enter the offset (e.g., 0h 45m 0s) — the entry stamps `takenAt = Date.now() - offsetMs`.

**Run a Tabata workout**:
1. Navigate to `Wellness > Exercise`.
2. Tap the Tabata preset card.
3. The Interval engine loads the program; the screen routes to `Timers > Interval`.
4. Tap Start.

**Enable cross-device sync**:
1. Open the settings drawer (gear icon, top right).
2. Toggle "Cloud Sync" on.
3. Sign in with Google.
4. On your first device, tap "Push to cloud" once.
5. On a second device with the same Google account, open the app; the boot overlay shows hydrate progress.

**Run engine tests**:
1. From the repo root: `python3 -m http.server 8765`.
2. Open `http://localhost:8765/tests/index.html` in any browser.
3. Wait for "Running tests..." to be replaced by the pass/fail count.

### Common workflows

| Goal | Commands |
|---|---|
| Deploy a web change | `git push` to `main` — GitHub Pages auto-deploys in ~1 min. **Don't forget to bump `CACHE_NAME` in `sw.js`** if you changed any cached asset. |
| Update the iPhone after a web change | `npm run ios:copy` then `⌘R` in Xcode (or `npm run ios:open` if Xcode is closed). |
| Refresh the 7-day iOS dev cert | `npm run ios:open` → plug in iPhone → ▶ Run. Takes ~30 seconds. |
| Run all engine tests | `python3 -m http.server 8765` then open `http://localhost:8765/tests/index.html`. |
| Manually back up local data | Open the app → settings drawer → "Backup local copy" — produces a JSON file via Web Share API (mobile) or `<a download>` (desktop). The same export is what F12 mandatory-backup runs before the first cloud upload. |
| Disable cloud sync | Settings drawer → toggle Cloud Sync off. Engines continue writing to local storage; nothing pushes to the cloud. |

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Page looks blank after a deploy | Service worker is serving the previous cached version. | Hard-reload (Shift+Reload). If still stale: in the SW devtools, click "Unregister" then reload. Future deploys: bump `CACHE_NAME` in `sw.js`. |
| Tests don't update after editing engine code | The test harness is being served by the SW cache. | `tests/index.html` auto-appends `?nosw=1` to its URL (E-1a fix in PR #65), which the SW respects via the `?nosw=1` referrer bypass. If you hit this anyway, hard-reload or unregister the SW. |
| Engine tests fail with "X is not defined" | Script load order in `tests/index.html` doesn't satisfy the new module's deps. | Add the new `<script src="...">` line in dependency order. Mirror the order from `index.html`. |
| iOS app icon bounces back to home screen | Free-tier 7-day signing cert expired. | `npm run ios:open` → plug in iPhone → ▶ Run. Cert resets to a fresh 7 days. |
| Cloud sync says "hydrating..." forever on a second device | The hydrate write-gate (F13: `tempo_sync_state='hydrating'`) failed mid-pull. | Check the boot overlay's error text. Re-pull triggers automatically on next boot via per-store hydrated markers. If stuck, settings drawer → "Reconcile now". |
| Sync fires `[SyncEngine] reconcile history sessionId collision (cloud wins)` repeatedly | Sessions migrated from V1 (bare `Date.now()` IDs) carry both `id` and `legacyId`; the reconcile logs are noisy but harmless. | Known caveat, documented in `docs/sync-impl/PLAN.md` E-2 follow-ups. |

### Deployment

**Web** — `git push` to `main`. GitHub Pages deploys from the repo root.

The hard rule from `CLAUDE.md`: **any PR that ships a change to a cached web file (`index.html`, `css/styles.css`, `css/tempo-shell.css`, `manifest.json`, or any `js/*.js`) must bump the `CACHE_NAME` constant in `sw.js` in the same PR.** The sync orchestrator's `pr-shipper` agent enforces this automatically.

**iOS** — Currently only deployable to my personal iPhone via Xcode + free-tier signing. Explicitly out of scope (per `CLAUDE.md` § iOS build): $99/yr Apple Developer Program enrollment, App Store Connect record, TestFlight or App Store submission, privacy nutrition labels (meds + BFRB are health data), App Review screenshots, age rating, 1024×1024 app icon polish.

**Cloud sync backend** — Firebase project `tempo-sync-6f7b2`, region `us-central1`, Spark plan. Security rules ship in `firestore.rules`. Per-user data lives under `users/{uid}/{store}/{recordId}` and is enforced by `request.auth.uid == userId`. Budget alert is configured at $1/mo on the GCP billing console as the early-warning signal.

---

## A note on the repo's docs

This is a **single-author personal-production + portfolio** project, not an open-contribution one — there is no `CONTRIBUTING.md` by design. The dev loop *is* the User Guide above: edit a `js/*.js` file → `python3 -m http.server 8765` → reload; the `<script>` order in `index.html` is the dependency graph; bump `CACHE_NAME` in `sw.js` on any cached-file change; branch as `feat/` `fix/` `docs/`.

Two things a newcomer should know:
- **`CLAUDE.md`** is the canonical engineering reference (architecture file-map, state model, the full localStorage-key registry, the feature backlog). It's written as instructions for an AI agent, so it's dense — this README is the human-facing front door.
- **`.claude/`, `docs/sync-impl/`, `docs/audits/`, `docs/briefs/`** are an AI-agent orchestration apparatus (subagent prompts + a per-PR audit trail), **not** human process you need to follow. The durable cross-cutting decisions are written up as ADRs in [`docs/adr/`](docs/adr/); the doc-generation roadmap lives in [`docs/artifacts-plan.md`](docs/artifacts-plan.md).

## License

[MIT](LICENSE) © 2026 Kyle Disch. The code is MIT-licensed; the synced user data lives per-user in Firestore and is unaffected by the code license. This is a personal tool offered as-is, with no uptime or support guarantee.

## Footer

Last updated: **2026-05-30**

Promoted from the project's internal guide and refreshed against `main` at commit `7e15926` (262 commits, 100+ merged PRs through #105). Stats verified directly against the tree: 68 JS modules, ~797 engine-test cases across 32 files, `styles.css` ~5,590 lines. Sources: `CLAUDE.md`, `docs/CLOUD-SYNC-STRATEGY.md`, `docs/sync-impl/PLAN.md`, `docs/BUILD-HISTORY.md`, and direct reads of the JS modules.

Judgment calls in this draft:
- Skipped a screenshot section — there are no committed screenshot assets in the repo.
- Tech-stack table lists only the dependencies in `package.json` plus runtime APIs the code actually uses. No aspirational entries.
- Project History "Decisions & Tradeoffs" focuses on decisions visible across multiple PRs, not single-PR microdecisions.
- I didn't include a Rhythm pillar walkthrough in Key Flows — the route exists and the placeholder ships, but the engine work (`docs/TEMPO-PLAN.md` §8.10) is unimplemented.

---

📚 **Project wiki:** [PROJECT.md](PROJECT.md) — status, scope, and next actions · [Wiki/_index.md](Wiki/_index.md) — topic pages and history
