# Stopwatch PWA — Project Reference

> **This file is the always-loaded lean core.** Deep/historical detail is relocated
> (never deleted) into linked docs that load on demand:
> - **Architecture deep-dive + ADRs + diagrams** → [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
> - **Every persisted key / store / field** → [`docs/reference/data-dictionary.md`](docs/reference/data-dictionary.md)
> - **Full feature backlog + shipped post-mortems + resolved tech-debt** → [`docs/BACKLOG.md`](docs/BACKLOG.md)
> - **Chronological build history** → [`docs/BUILD-HISTORY.md`](docs/BUILD-HISTORY.md)
> - **Glossary of terms (F-numbers, stage codes)** → [`docs/reference/glossary.md`](docs/reference/glossary.md)
> - **Cloud-sync strategy + orchestrator workflow** → `docs/CLOUD-SYNC-STRATEGY.md`, `.claude/orchestrator-prompt.md`

## What This App Is

A cross-platform stopwatch PWA (Progressive Web App) that works on phone and desktop, inspired by the iPhone Clock app's stopwatch. The key differentiator is the ability to **start a stopwatch with time already elapsed** — e.g., "I took my medication ~30 minutes ago, start counting from 30:00 and count up."

**Live:** https://ksdisch.github.io/stopwatch/
**Repo:** https://github.com/ksdisch/stopwatch

## Tech Stack

Vanilla HTML + CSS + JS. No framework, no build step. The entire app is a static folder deployable to any static host. Engine modules use factory functions; UI modules are plain global functions. No IIFEs except for self-contained data modules (History, Persistence, SFX, Themes, etc.).

## Architecture

The file-map below is a terse navigation index. For module layering, the engine
model, persistence topology, the cloud-sync component view, the platform seam, and
the ADR/diagram set, read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```
index.html                      — App shell, all HTML structure
css/styles.css (~3300 lines)    — All styling: themes, responsive, animations, a11y
js/utils.js                     — Utils.formatMs(ms) shared time formatting
js/dom-utils.js                 — escapeHtml(str) shared HTML-escape helper
js/platform.js                  — Platform abstraction (web vs Capacitor native): haptic/notify/scheduleNotification + Firebase Auth shim (Platform.auth) + network shim. Isolates all native calls.
js/schema.js                    — Sync-invariant stamping seam: SCHEMA_VERSION / stamp(record) (deviceId+updatedAt+schemaVersion) / isFutureRecord (F19a guard). ALL synced-store writes go through here.
js/stopwatch.js                 — createStopwatch(id) factory. Drift-free wall-clock timing. Alerts.
js/timer.js                     — createTimer(id) factory. Same pattern as Stopwatch.
js/instance-manager.js          — Manages multiple stopwatch/timer instances (≤5 each), primary tracking, persistence.
js/pomodoro.js                  — Pomodoro engine. Work/break cycle state machine.
js/flow.js                      — Flow Block engine. 90/120-min focus block + 15-min recovery (ultradian).
js/interval.js                  — Interval engine. Phase-based rounds (Tabata / HIIT / Custom).
js/persistence.js               — Persistence.save()/load() → InstanceManager.saveAll()/loadAll(). F13 write-gate (SyncState).
js/sync-firebase-config.js      — Committed public Firebase web config (project tempo-sync-6f7b2). Not a secret — access is enforced by firestore.rules.
js/sync-flag.js                 — SyncFlag: master cloud-sync feature flag (`tempo_sync_enabled`), off by default.
js/sync-firestore.js            — Firestore SDK seam (getDoc/setDoc/getCollection/runTransaction/subscribe). Web lazy-imports CDN; native routes to Capacitor plugin (runTransaction+subscribe web-only → backlog #3). Normalized errors.
js/sync-buffer.js               — Offline write buffer. Separate IndexedDB `tempo_sync_db v1`, store `pending_ops` (≤1000 ops). Drained FIFO when network online.
js/sync-engine.js               — SyncEngine orchestrator (~2600 lines). SYNCED_STORES = SIX stores (meds/history/rest_log/presets/bfrb_events/distractions). Lifecycle: init → auth-change → hydrateFromCloud → startSteadyState (300s poll / web onSnapshot) → per-store merge → CAS writeback. LIVE by default (E-1e).
js/sync-toast.js                — Toast: non-blocking sync notifications (e.g. F15 meds arrival toast).
js/sync-manual-dedupe.js        — D-1 placeholder: ManualDedupe.scan() surfaces matching history pairs across synced/imported buckets.
js/sync-merge-meds.js           — Per-store merge: meds metadata LWW + doseLog append-merge (F1/F16) + F19a + CAS + F15. See docs/adr/0004.
js/sync-merge-history.js        — Per-store merge: sessions union by id + record LWW; phaseLog dedup (F6).
js/sync-merge-rest-log.js       — Per-store merge: per-date key; sleep LWW, naps append-merge.
js/sync-merge-presets.js        — Per-store merge: full-record LWW + deletedAt tombstone propagation.
js/sync-merge-bfrb.js           — Per-store merge: bfrb_events union-dedup by (deviceId, takenAt); deterministic doc id.
js/sync-merge-distractions.js   — Per-store merge: distractions union-dedup by (context, sessionId, deviceId, timestamp).
js/sync-auth.js                 — SyncAuth: signIn/signOut/getCurrentUser/onAuthChange → Platform.auth. No-op when flag off.
js/backup.js                    — F12 mandatory local backup. exportLocal() reuses Export.buildBackupData(); importLocal() = D-1 restore hook.
js/audio.js                     — SFX module. Web Audio API synthetic sounds (no files). Multiple profiles.
js/themes.js                    — Themes module. 6 presets, applies CSS vars to :root.
js/history.js                   — History module. IndexedDB (db stopwatch_history_db, store sessions). Tags, notes. Migrates legacy localStorage.
js/export.js                    — Export module. Clipboard, CSV, Web Share, full-data JSON export/import.
js/analog.js                    — Analog clock face. SVG ticks/numbers/hands.
js/offset-input.js              — "Start with time already elapsed" input UI + presets.
js/ui.js (~490 lines)           — Main UI: RAF render loop, button state machine, lap list, swipe-to-delete, vibration, a11y.
js/cards-ui.js                  — Compact card rendering for non-primary stopwatch/timer instances.
js/compare-ui.js                — Compare view: split-screen two-instance comparison.
js/timer-ui.js                  — Timer mode UI: button handlers, render loop, alarm.
js/bfrb-recovery.js             — Shared 60s in-button competing-response countdown on a BFRB catch. Plays SFX.playBFRBEnd.
js/distractions.js              — Distractions data module. sessionId-keyed maps (F8) for Flow+Pomo. 6th sync store. Owns the migration.
js/bfrb-events.js               — BfrbEvents data module. F3 consolidated BFRB stream (`bfrb_events`), single source of truth. Synced; owns migration.
js/todoist.js                   — Todoist REST v2 client: token mgmt, getTasks/close/reopen/create/updateTask, offline queue. Device-local token, never synced.
js/todoist-ui.js                — Todoist UI: shared picker modal (openPicker) + settings panel. Reused by Pomo saved tasks + Flow task list.
js/global-bfrb.js               — Global BFRB FAB (always-visible + shortcut B) → bfrb_events. Wires BFRB chime volume slider.
js/pomodoro-ui.js               — Pomodoro mode UI: handlers, render loop, settings, checklists, saved tasks, templates, distractions, timeline.
js/pomodoro-stats.js            — Pomodoro stats engine (streaks, daily/weekly aggregates).
js/flow-ui.js                   — Flow Block UI: pre-block checklist, user-editable "Tasks for this block" (two-way Todoist; `flow_user_tasks`), distractions, summary, recovery, #15 readiness default.
js/alert-ui.js                  — Alert UI: add/remove/render threshold alerts for stopwatch.
js/bg-notify.js                 — Background notification bridge via service worker (backgrounded tabs).
js/interval-ui.js               — Interval mode UI: phase list, templates, rounds, run info.
js/cooking-ui.js                — Cooking mode UI: multiple named short timers with suggestions.
js/sequence.js                  — Sequence engine (linear phase chain, sub-mode of Timer).
js/sequence-ui.js               — Sequence UI: phase setup, run info.
js/analytics.js                 — Analytics engine: aggregates history sessions by day/type.
js/analytics-ui.js              — Analytics dashboard UI panel.
js/focus-ui.js                  — Focus / ambient display mode (distraction-free full-screen).
js/presets.js                   — Quick Presets engine: storage, apply (mode + config), migration from offset presets.
js/presets-ui.js                — Presets UI: drawer grid + quick-picks row.
js/history-ui.js                — History panel UI: session list, tag filter bar, tag/note editing, log-past-session form.
js/meds.js                      — Medications engine. createMed(id) + MedsManager singleton. Dose logging w/ offset; opt-in prescription supply tracking (derived remaining); D-2 reconcileDoseLog (F1/F16/F14/F19a) + onMergeComplete (F4). Detail → ARCHITECTURE.md / data-dictionary.md.
js/meds-ui.js                   — Wellness › Meds UI: med cards, add/edit, dose logging, due-time notifications, opt-in supply badge + ▲/▼ steppers + refill.
js/exercise-ui.js               — Wellness › Exercise UI: 6 workout preset cards → Interval engine. Recent Activity from History (type=interval).
js/mindful-ui.js                — Wellness › Mindful UI: breathing exercises (animated circle) + meditation duration presets → Timer.
js/wellness-cooking-ui.js       — Wellness › Cooking UI: 8 named cooking presets → Cook mode (createTimer). Recent Activity from History (type=cooking). ≤8 timers.
js/recovery-ui.js               — Wellness › Recovery UI: daily sleep log (hours+quality+bedtime/wake), nap tracker, derived focus status. Persists `wellness_rest_log`.
js/recovery-feed.js             — RecoveryFeed: READ-ONLY consumer of external personal-health-elt pipeline (Firestore recovery_state). No write path. See docs/reference/recovery-state-contract.md.
js/tempo-coach.js               — Tempo Coach engine (#15): pure singleton, zero DOM/side-effects. readinessBand / suggestFocusDurationMs / doseSleepSlope (suppression-guarded) / buildTodayModel / shouldNudge. Descriptive-first. MUST load before rhythm-panel-today + flow-ui.
js/rhythm-engine.js             — Rhythm aggregation: daily event timeline + readiness band from History / bfrb_events / distractions / RecoveryFeed.
js/rhythm-insights.js           — Rhythm Insights foundation (#12): panel registry (sorted by `order`), DI data layer (_deps), shared inline-SVG helpers, renderInto() (Promise.allSettled per-panel isolation).
js/rhythm-panel-today.js        — Insights panel (order 5, pins atop): Tempo Coach "Today" briefing. Descriptive HTML string, never touches document. Empty-state is DEFAULT path.
js/rhythm-panel-meds-sleep.js   — Insights panel (order 10): Meds-vs-Sleep scatter. Onset|Duration toggle; dot color=quality. Pairs dose[D] with sleep[D+1].
js/rhythm-panel-recovery-trends.js — Insights panel (order 20): 14-day HRV/ACWR/RHR sparklines from RecoveryFeed.
js/rhythm-panel-focus-minutes.js — Insights panel (order 30): 14-day focus-minutes bar chart (flow+pomodoro) from History.
js/rhythm-panel-bfrb-frequency.js — Insights panel (order 40): 14-day daily BFRB line+area from Analytics.getBFRBTrend (de-duped).
js/rhythm-panel-bfrb-triggers.js — Insights panel (order 45): antecedent breakdown (trigger leaderboard + urge mix 14d) + forgiving clean-streak hero, from LIVE BfrbEvents.getAll().
js/rhythm-panel-distraction-rollup.js — Insights panel (order 50): all-time distraction leaderboard + by-hour strip from Analytics.getDistractions().
js/rhythm-panel-event-zoom.js   — Insights panel (order 60): condensed 14-day activity strip (productivity vs wellness mini-bars).
js/rhythm-panel-correlations.js — Insights panel (order 70): plain-language cross-stream callouts. Conservative — only when both groups have data.
js/rhythm-ui.js                 — Rhythm pillar UI: Timeline | Insights sub-nav. Insights = RhythmInsights.renderInto().
js/tempo-nav.js                 — Tempo shell: pillar tabs, sub-nav, hash routing, settings drawer.
js/app.js (~350 lines)          — Entry point. Wires all modules. Mode switching, sound/theme/export, PWA install.
sw.js                           — Service worker, cache-first, version-bumped on deploys.
manifest.json                   — PWA manifest, standalone display, shortcuts.
icons/                          — 192px and 512px PNG icons.
```

### Script Load Order
Mirrors the `<script>` tags in `index.html` exactly (that order IS the dependency graph; keep this block and `index.html` in lockstep):
```
utils → dom-utils → platform → schema → stopwatch → timer → instance-manager → pomodoro → flow → interval → persistence → sync-firebase-config → sync-flag → sync-firestore → sync-buffer → sync-engine → sync-toast → sync-manual-dedupe → sync-merge-meds → sync-merge-history → sync-merge-rest-log → sync-merge-presets → sync-merge-bfrb → sync-merge-distractions → sync-auth → audio → themes → history → export → backup → analog → offset-input → ui → cards-ui → compare-ui → timer-ui → bfrb-recovery → distractions → todoist → todoist-ui → pomodoro-ui → tempo-coach → flow-ui → alert-ui → bg-notify → interval-ui → cooking-ui → pomodoro-stats → history-ui → sequence → analytics → focus-ui → sequence-ui → analytics-ui → presets → presets-ui → meds → meds-ui → exercise-ui → mindful-ui → wellness-cooking-ui → recovery-ui → recovery-feed → rhythm-engine → rhythm-insights → rhythm-panel-today → rhythm-panel-meds-sleep → rhythm-panel-recovery-trends → rhythm-panel-focus-minutes → rhythm-panel-bfrb-frequency → rhythm-panel-bfrb-triggers → rhythm-panel-distraction-rollup → rhythm-panel-event-zoom → rhythm-panel-correlations → rhythm-ui → bfrb-events → global-bfrb → tempo-nav → app
```

### Key Design Decisions

(ADR set with full rationale: [`docs/ARCHITECTURE.md` § Decision index](docs/ARCHITECTURE.md#decision-index).)

- **Drift-free timing:** `elapsed = offsetMs + accumulatedMs + (Date.now() - startedAt)`. Never `setInterval` to increment — always derived from wall clock.
- **Mutable global proxy pattern:** `let Stopwatch = createStopwatch('sw-default')`. When the primary instance is swapped, `Stopwatch` is reassigned — all existing code automatically operates on the new primary without changes.
- **Persistence across tab close:** On load, if status was 'running', `getElapsedMs()` auto-corrects because it reads `Date.now() - startedAt`.
- **RAF render loop:** `requestAnimationFrame` for 60fps. Only updates the current in-progress lap's text node. Self-starts on start(), self-stops on pause()/reset(). Mode guards prevent cross-mode interference.
- **Module naming:** `SFX` (not `Audio`) to avoid conflicting with the browser's native `Audio` constructor.
- **No build step:** Script load order in index.html is the dependency graph. Engine modules load before UI modules load before app.js.
- **Shared button handlers:** All modes register on the same btn-left/btn-right elements; each handler has an `appMode` guard. Pomodoro also has a click debounce lock.
- **Collapsed panels:** `.offset-input[data-collapsed]` uses a data attribute (not `.hidden`) to enable CSS max-height transitions.

### State Model

(Full persisted-datum table — every key, store, shape, synced?/export? flag — in
[`docs/reference/data-dictionary.md`](docs/reference/data-dictionary.md).)

- **Stopwatch:** `{ id, name, status: 'idle'|'running'|'paused', offsetMs, startedAt, accumulatedMs, laps[], lapStartMs, alerts[] }`
- **Timer:** `{ id, name, status: 'idle'|'running'|'paused'|'finished', durationMs, startedAt, accumulatedMs }`
- **Pomodoro:** `{ status: 'idle'|'running'|'paused'|'phaseComplete'|'done', phase: 'work'|'shortBreak'|'longBreak', cycleIndex, totalCycles, workMs, shortBreakMs, longBreakMs, startedAt, accumulatedMs, previousPhaseSnapshot: {phase,cycleIndex,accumulatedMs}|null }`. Snapshot captured at top of every `nextPhase()` → one-level undo via `revertPhase()`; cleared on `reset()`, overwritten each transition.
- **Flow Block:** `{ status: 'idle'|'running'|'paused'|'focusComplete'|'recovery'|'recoveryPaused'|'done', phase: 'focus'|'recovery', focusDurationMs (5400000|7200000), startedAt, accumulatedMs, sessionStartedAt, focusEndedAt, goal }`
- **Medication:** `{ id, name, dose, frequency: 'once-daily'|'twice-daily'|'as-needed', lastTakenAt, doseLog[{takenAt}], supplyStartCount?, supplyResetAt? }`. Supply fields nullable (null when not tracking); remaining is **derived** from doses on/after `supplyResetAt`, never stored. `MedsManager` singleton; persists to `wellness_meds`. No schedule/notifications in V2 — logging is always explicit. `loadState` migrates V1 schedule-based records to `frequency:'as-needed'`.
- **Rest log:** `wellness_rest_log`, object keyed by `YYYY-MM-DD`. Each day: `sleep: {hours, quality?, bedtime?, wakeTime?}` (bedtime/wakeTime = #11 additive-nullable `"HH:MM"`) + `naps: [{startedAt, durationMs, endedEarly?}]`. No engine — `RecoveryUI` reads/writes directly; derives focus stats from `History.getSessions()`.

### Persistence topology

- Stopwatch/timer instances → localStorage `multi_state` (via `InstanceManager.saveAll()`). Pomodoro → `pomodoro_state`/`pomodoro_config`. Flow → `flow_state`/`flow_config`. Interval → `interval_state`. Sequence → `sequence_state`/`sequence_templates`. Cooking → `cooking_timers`. Legacy single-instance keys auto-migrated.
- Session history → IndexedDB (`stopwatch_history_db`/`sessions`); legacy `stopwatch_history` localStorage migrated in on first load.
- Cloud-sync offline buffer → a **separate** IndexedDB `tempo_sync_db v1`, store `pending_ops`. Two distinct IDB DBs by design (canonical history vs transient sync infra).
- **The 6 synced stores:** `meds`, `history`, `rest_log`, `presets`, `bfrb_events`, `distractions`. ALL writes to these stamp `deviceId`+`updatedAt`+`schemaVersion` via `js/schema.js`.
- **Device-local, NEVER synced and NEVER exported (credentials):** `todoist_api_token` (+ other `todoist_*`). **NOT synced** (Todoist itself is cross-device truth): `flow_user_tasks`, `pomodoro_saved_tasks`. **Device-local, not synced, not exported:** `flow_readiness_suggest`, `tempo_coach_nudge_enabled` (#15).
- Full enumeration of every localStorage/IndexedDB/Firestore key + the sync envelope + derived-vs-stored notes: [`docs/reference/data-dictionary.md`](docs/reference/data-dictionary.md).

## What Has Been Built

Full chronological detail lives in [`docs/BUILD-HISTORY.md`](docs/BUILD-HISTORY.md). Capability summary by phase:

- **Phases 1–2** — Polish + Enhanced UX (shortcuts, haptics, analog face, lap chart, PWA install)
- **Phase 3** — Timer mode, session history, export, themes, sound effects
- **Phase 4** — Pomodoro, offset presets, multi-instance timers, tags, threshold alerts
- **Phases 5–6** — UX (swipe-to-delete, notes, a11y) + tech-debt cleanup (app.js split)
- **Phase 7** — Flow Block mode (ultradian deep-work + BFRB tally)
- **Phase 8** — Tempo rebrand + Wellness suite (Meds, Exercise, Mindful, Cooking, Recovery)
- **Phase 9** — Cloud Sync (Firebase/Firestore, 6 stores, 28 PRs)
- **Phase 10** — Post-sync burndown (Flow vibration, ambient noise, Rhythm timeline)
- **Phase 11+** — Todoist integration, Rhythm Insights dashboard (7 panels), Tempo Coach daily loop (#15), BFRB Closed Loop (#16)

## Feature Backlog

Lean summary — **full scope, shipped post-mortems, risks, and resolved tech-debt are in
[`docs/BACKLOG.md`](docs/BACKLOG.md).** Ordered by impact-vs-effort ROI; the "Added" column
preserves the original chronological numbering.

| Priority | Feature | Impact | Effort | Added | Status |
|----------|---------|--------|--------|-------|--------|
| 1 | Native iOS app via Capacitor — App Store distribution | High | Medium | #8 | Shipped to personal device; App Store paperwork remaining |
| 2 | Todoist integration — two-way Todoist ↔ Flow/Pomodoro task lists | High | Medium | #10 | Pomo V1 shipped; Flow + rename done (rows #9/#10) |
| 3 | Cloud sync — native CAS + listener parity (`@capacitor-firebase/firestore`) | Medium | Medium | #7 | **Unshipped** — last cloud-sync piece |
| 4 | iOS Live Activities — lock screen + Dynamic Island | High | High | #9 | **Unshipped** — unlocked by #1 |
| 5 | Pomodoro phase revert — "Go back" | Medium | Low | #11 | Shipped (PR #104) |
| 6 | Split-screen timer comparison | Medium | High | #2 | **Unshipped** |
| 7 | Voice control (Web Speech API) | Low | Medium | #3 | **Unshipped** |
| 8 | Group/team timing | Low | High | #5 | **Unshipped** — needs a backend |
| 9 | Todoist follow-up A — Flow user-task list | High | Medium | #10-A | Shipped (PR #102) |
| 10 | Todoist follow-up B — Pomo inline-rename + `updateTask` | Low | Low | #10-B | Shipped (PR #103) |
| 11 | Sleep log bedtime/wake-time schema extension | Medium | Low | #12 | Shipped 2026-06-01 |
| 12 | Rhythm insights section — multi-chart dashboard (7 panels) | High | Medium | #13 | Shipped 2026-06-01 |
| 13 | Bugfix: Rhythm Timeline dose dots read deleted `wellness_meds` blob | Medium | Low | #14 | Shipped 2026-06-03 |
| 15 | Tempo Coach — readiness-aware daily decision loop | High | Medium | #15 | Shipped 2026-06-05 |
| 16 | BFRB Closed Loop — antecedent capture + Triggers panel | High | Medium | #16 | Shipped 2026-06-05 (PR #126) |

## Remaining Tech Debt

Open items only. Resolved entries (the F18 `wellness_meds` orphaned-readers fixes, the
2026-05-26 browser-verification notes) are archived in
[`docs/BACKLOG.md` § Resolved tech debt](docs/BACKLOG.md#resolved-tech-debt-kept-as-migration-pattern-reference).

- **iOS sign-out doesn't fully sign out (pre-existing, surfaced 2026-05-20):** Tapping "Sign out" on iOS dismisses the popup but `SyncAuth.getCurrentUser()` still returns the account (web works). Likely the `authStateChange` listener (`js/platform.js:297-302`) races back the still-cached user because `@capacitor-firebase/authentication`'s `signOut()` returns before the Firebase iOS SDK clears its Keychain-cached state. Fix lives in the native `authSignOut` branch (await a deauth+keychain-clear, or a guard flag suppressing the next re-emit). Workaround: toggle "Enable cloud sync" off.
- **Timer button handlers are duplicated:** `onTimerLeft`/`onTimerRight` (timer-ui.js) duplicate ui.js's `onLeftClick`/`onRightClick`. Could unify into a shared state machine.
- **Engine tests only (~918 `it()` cases across 35 `tests/*.test.js`):** run via `tests/index.html` in a real browser (curl-grepping the shell does NOT execute them). Covers every timing engine, meds, analytics, Todoist client, schema helpers, distractions, bfrb-events, Tempo Coach, and the full cloud-sync stack. Suite is green in a **foreground** tab. (A `visibilityState` test-isolation gap that failed 2 sync-engine `startSteadyState` tests only in a *backgrounded* tab was fixed in PR #125.) Still no UI/integration tests.
- **renderLaps does full innerHTML on lap events:** the `updateCurrentLap` perf path only applies to the RAF tick; recording a new lap rebuilds the whole list. Low impact for typical lap counts.

## Operations

### Deployment (web → GitHub Pages)

Deployed from the `main` branch root. Push to `main` → auto-deploys in ~1 minute.

```bash
git push  # deploys to https://ksdisch.github.io/stopwatch/
```

**Service-worker cache bump rule:** `sw.js` has a `CACHE_NAME` constant. **Any change to a
cached web file (`index.html`, `css/styles.css`, `css/tempo-shell.css`, `manifest.json`, or
any `js/*.js`) must bump that version string in the same PR**, or users see stale content
until the old SW expires.

### iOS build (Capacitor)

Same web codebase wraps in a Capacitor iOS shell (haptics + scheduled notifications work
natively). Web keeps deploying via GitHub Pages unchanged; iOS is a separate target. Daily
workflow + 7-day free-cert refresh playbook: [`iOS-BUILD.md`](iOS-BUILD.md).

```bash
npm install              # one-time: Capacitor + plugins
brew install cocoapods   # one-time
npx cap add ios          # one-time: scaffolds ios/
npm run ios:open         # everyday: sync www/ → cap copy → open Xcode
```

`scripts/sync-www.mjs` mirrors static files (`index.html`, `manifest.json`, `sw.js`, `css/`,
`js/`, `icons/`) into `www/` (gitignored), which Capacitor copies into the iOS bundle.
`js/platform.js` is the web/native seam; `sw.js` is web-only (`js/app.js` skips registration
when `Platform.isNative` — on native, iOS schedules notifications even when the WebView is
suspended). Bundle ID `com.ksdisch.tempo`, app name `Tempo` (`capacitor.config.json`). App
Store paperwork (developer account, privacy nutrition labels for meds + BFRB, screenshots) not yet done.

## Conventions (always apply)

### Reuse over re-implementation

- HTML-escape: `escapeHtml` from `js/dom-utils.js`. Do NOT re-implement.
- Time formatting: `Utils.formatMs(ms)` from `js/utils.js`. Do NOT re-implement.
- Haptics: `Platform.haptic(pattern)` from `js/platform.js`. Do NOT call `navigator.vibrate` directly.
- Notifications: `Platform.notify(title, opts)` / `BgNotify.schedule(...)`. Do NOT call `new Notification(...)` directly.
- Sync-invariant stamping: helpers in `js/schema.js`. ALL writes to synced stores stamp `deviceId`+`updatedAt`+`schemaVersion` through them.

### Test commands

No Node test runner. Engine tests live in `tests/*.test.js`, executed by opening
`tests/index.html` in a **real browser** (the page title self-reports the live PASS/FAIL count).

```bash
python3 -m http.server 8765    # from repo root, then open http://localhost:8765/tests/index.html
pkill -f "python3 -m http.server 8765"   # stop when done
```

`curl`-grepping the HTML does NOT execute the tests. If you have no browser tool, ask the user
to open the URL and paste the counts. Test API: `describe` / `it` / `assert` / `assertEqual` /
`assertClose` / `assertArrayEqual` (in `tests/test-runner.js`).

### Lint / typecheck / build

None — vanilla JS, no toolchain. The script order in `index.html` IS the dependency graph.
iOS: `npm run sync-www` then `npm run ios:open`.

### Orchestrator / subagent workflow (when dispatched)

A 5-subagent sync-PR pipeline (`sync-auditor` → `engine-implementer` → `engine-tester` →
`ui-wirer` → `pr-shipper`) lives in `.claude/orchestrator-prompt.md` + `.claude/agents/`. The
`ui-wirer` phase fires only when the audit's affected-files table includes UI files
(`js/*-ui.js`, `index.html`, `css/*.css`, `js/tempo-nav.js`). `pr-shipper` always pauses for
explicit push approval. Sync-PR branches: `feat/sync-<pr-id>-<slug>`; commit prefixes
`feat`/`refactor`/`fix`/`docs`; one PR per Stage row in `docs/sync-impl/PLAN.md`, merged in
**sequential order within a stage**. The cache-bump above is applied by `pr-shipper` only when
`engine-implementer` reports `sw.js cache-bump needed: yes`.

**Where things live (doc index):**
- Architecture + ADRs + diagrams → `docs/ARCHITECTURE.md`, `docs/adr/`, `docs/diagrams/`
- Data dictionary (every persisted key) → `docs/reference/data-dictionary.md`
- Glossary (F-numbers, stage codes) → `docs/reference/glossary.md`
- Feature backlog detail → `docs/BACKLOG.md`
- Build history → `docs/BUILD-HISTORY.md`
- Cloud-sync strategy + per-store merge rules → `docs/CLOUD-SYNC-STRATEGY.md`
- Sync implementation plan (`docs/sync-impl/PLAN.md`) + audits (`docs/sync-impl/audits/<PR-ID>-AUDIT.md`, e.g. `A-1-AUDIT.md`) + per-PR briefs (`docs/sync-impl/prompts/<PR-ID>-PROMPT.md`, e.g. `S0-1-PROMPT.md`)
- Backend decision → `docs/sync-review/BACKEND-SELECTION.md`
- Session log (one entry per session) → `docs/SESSION-LOG.md`
- Orchestrator + subagent prompts → `.claude/orchestrator-prompt.md`, `.claude/agents/`, `.claude/templates/phase-brief.md`
