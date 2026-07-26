# Stopwatch PWA — Project Reference

> **This file is the always-loaded lean core.** Deep/historical detail is relocated
> (never deleted) into linked docs that load on demand:
> - **Architecture deep-dive + ADRs + diagrams** → [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
> - **Every persisted key / store / field** → [`docs/reference/data-dictionary.md`](docs/reference/data-dictionary.md)
> - **Full feature backlog + shipped post-mortems + resolved tech-debt** → [`docs/BACKLOG.md`](docs/BACKLOG.md)
> - **Chronological build history** → [`docs/BUILD-HISTORY.md`](docs/BUILD-HISTORY.md)
> - **Glossary of terms (F-numbers, stage codes)** → [`docs/reference/glossary.md`](docs/reference/glossary.md)
> - **Cloud-sync strategy + orchestrator workflow** → `docs/CLOUD-SYNC-STRATEGY.md`, `.claude/orchestrator.md`
> - **Run tests / verify the app on FRESH code (stale-SW traps)** → [`docs/playbooks/browser-verification.md`](docs/playbooks/browser-verification.md)

## What This App Is

A cross-platform stopwatch/timer/wellness PWA (phone + desktop), grown into the Tempo Life-OS. Original differentiator: **start a stopwatch with time already elapsed** ("took my meds ~30 min ago — start at 30:00 and count up").

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
js/platform.js                  — Platform abstraction (web vs Capacitor native): haptic/notify/scheduleNotification + Firebase Auth shim (Platform.auth) + network shim + keepAwake wake lock. Isolates ALL native calls.
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
js/sync-firestore.js            — Firestore SDK seam (getDoc/setDoc/getCollection/runTransaction/subscribe). Web lazy-imports CDN; native → Capacitor plugin. subscribe real-time BOTH platforms (N-1); runTransaction web-only forever. Normalized errors.
js/sync-buffer.js               — Offline write buffer. Separate IndexedDB `tempo_sync_db v1`, store `pending_ops` (≤1000 ops). Drained FIFO when network online.
js/sync-engine.js               — SyncEngine orchestrator (~2600 lines). SYNCED_STORES = the EIGHT stores. init → auth-change → hydrateFromCloud → startSteadyState (300s poll / web onSnapshot) → per-store merge → CAS writeback. LIVE by default (E-1e).
js/sync-toast.js                — Toast: non-blocking sync notifications (e.g. F15 meds arrival toast) + Toast.action(text, btnLabel, onTap) tappable variant (stress nudge).
js/sync-manual-dedupe.js        — D-1 placeholder: ManualDedupe.scan() surfaces matching history pairs across synced/imported buckets.
js/sync-merge-equal.js          — SyncMergeEqual.recordsEqual(a,b): deep-equal minus the stamp envelope; all merge modules call it to skip redundant CAS cloud writes (M2/M5 — kills the self-triggering merge loop).
js/sync-merge-meds.js           — Per-store merge: meds metadata LWW + doseLog append-merge (F1/F16) + F19a + CAS + F15. See docs/adr/0004.
js/sync-merge-history.js        — Per-store merge: sessions union by id + record LWW; phaseLog dedup (F6).
js/sync-merge-rest-log.js       — Per-store merge: per-date key; sleep LWW, naps append-merge.
js/sync-merge-presets.js        — Per-store merge: full-record LWW + deletedAt tombstone propagation.
js/sync-merge-bfrb.js           — Per-store merge: bfrb_events union-dedup by (deviceId, takenAt); deterministic doc id.
js/sync-merge-distractions.js   — Per-store merge: distractions union-dedup by (context, sessionId, deviceId, timestamp).
js/sync-merge-mood.js           — Per-store merge: mood_events union-dedup by (deviceId, at); deterministic doc id deviceId-at (clone of sync-merge-bfrb). No F15 toast.
js/sync-merge-finances.js       — Per-store merge: finances per-month-key LWW (latest updatedAt per YYYY-MM wins); doc id = the month string (clone of sync-merge-rest-log). No F15 toast.
js/sync-auth.js                 — SyncAuth: signIn/signOut/getCurrentUser/onAuthChange → Platform.auth. No-op when flag off.
js/backup.js                    — F12 mandatory local backup. exportLocal() reuses Export.buildBackupData(); importLocal() = D-1 restore hook.
js/audio.js                     — SFX module. Web Audio API synthetic sounds (no files). Multiple profiles.
js/themes.js                    — Themes module. 6 presets, applies CSS vars to :root.
js/history.js                   — History module. IndexedDB (db stopwatch_history_db, store sessions). Tags, notes. Migrates legacy localStorage.
js/export.js                    — Export module. Clipboard, CSV, Web Share, full-data JSON export/import.
js/analog.js                    — Analog clock face. SVG ticks/numbers/hands.
js/offset-input.js              — "Start with time already elapsed" input UI + presets.
js/button-fsm.js                — ButtonFsm: pure shared button state machine (M5). get(mode, status) → frozen {left,right} cell specs; ui.js + timer-ui.js derive presentation AND dispatch from it.
js/ui.js (~500 lines)           — Main UI: RAF render loop, ButtonFsm-driven buttons, lap list, swipe-to-delete, vibration, a11y.
js/cards-ui.js                  — Compact card rendering for non-primary stopwatch/timer instances.
js/compare-ui.js                — Compare view: split-screen two-instance comparison.
js/timer-ui.js                  — Timer mode UI: button handlers, render loop, alarm. Session saves carry `programName: Timer.getName()`.
js/bfrb-recovery.js             — Shared 60s in-button competing-response countdown on a BFRB catch. Plays SFX.playBFRBEnd.
js/distractions.js              — Distractions data module. sessionId-keyed maps (F8) for Flow+Pomo. 6th sync store. Owns the migration.
js/bfrb-events.js               — BfrbEvents data module. F3 consolidated BFRB stream (`bfrb_events`), single source of truth. Synced; owns migration.
js/bfrb-risk.js                 — BFRB Closed Loop Slice B: pure `BfrbRisk.assess()` → sleepDown + mindfulSuggested (stress-nudge decision) from the live stream + recovery/sleep inputs. Zero DOM/copy.
js/todoist.js                   — Todoist REST v2 client: token mgmt, getTasks/close/reopen/create/updateTask, offline queue. Device-local token, never synced.
js/todoist-ui.js                — Todoist UI: shared picker modal (openPicker) + settings panel. Reused by Pomo saved tasks + Flow task list.
js/global-bfrb.js               — Global BFRB FAB (always-visible + shortcut B) → bfrb_events; chime volume slider. Stress nudge: mindfulSuggested → tappable toast → #/wellness/mindful (opt-in + daily throttle).
js/mood.js                      — Mood data module. Owns `mood_events`, the 7th synced store (ADR-0008): log/getAll/snapshotForSync, F10 stamping, F13 gate. Clone of bfrb-events minus migration.
js/finances.js                  — Finances data module. Owns `finances`, the 8th synced store: editable per-month YYYY-MM snapshots (setMonth upsert), per-month-key LWW, F10/F13/F19a. Council reads it server-side.
js/mood-ui.js                   — Mood capture UI (Life-OS P3): topbar popover (valence chips → tags → note), deferred-commit into ONE Mood.log, shortcut M, Platform.haptic.
js/pomodoro-ui.js               — Pomodoro mode UI: handlers, render loop, settings, checklists, saved tasks, templates, distractions, timeline.
js/pomodoro-stats.js            — Pomodoro stats engine (streaks, daily/weekly aggregates).
js/flow-ui.js                   — Flow Block UI: pre-block checklist, user task list (two-way Todoist; `flow_user_tasks`), distractions, summary, recovery, #15 readiness default.
js/alert-ui.js                  — Alert UI: add/remove/render threshold alerts for stopwatch.
js/bg-notify.js                 — Background notification bridge via service worker (backgrounded tabs). R9: `rearm()` nudge + visibilitychange listener.
js/bg-notify-store.js           — R9 durable notification store: pure `plan(records,now)` + `tempo_notify_db` IDB CRUD. SW-safe; sw.js loads the same bytes via importScripts so scheduled notifications survive worker eviction.
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
js/meds.js                      — Medications engine. createMed(id) + MedsManager singleton. Dose logging w/ offset; opt-in supply tracking (derived remaining); D-2 reconcileDoseLog + onMergeComplete (F1/F16/F14/F19a/F4). Detail → data-dictionary.
js/meds-ui.js                   — Wellness › Meds UI: med cards, add/edit, dose logging, due-time notifications, opt-in supply badge + ▲/▼ steppers + refill.
js/exercise-ui.js               — Wellness › Exercise UI: 6 workout preset cards → Interval engine. Recent Activity from History (type=interval).
js/mindful-ui.js                — Wellness › Mindful UI: breathing + meditation presets → Timer; NSDR Restore card (YouTube launch, auto-logs ['mindful','nsdr']); breathing logs a History session at ≥1 full cycle.
js/wellness-cooking-ui.js       — Wellness › Cooking UI: 8 named cooking presets → Cook mode (createTimer). Recent Activity from History (type=cooking). ≤8 timers.
js/recovery-ui.js               — Wellness › Recovery UI: daily sleep log + nap tracker + derived focus status. Persists `wellness_rest_log`.
js/recovery-feed.js             — RecoveryFeed: READ-ONLY consumer of the external personal-health-elt pipeline (Firestore recovery_state). No write path. Contract: docs/reference/.
js/synthesis-feed.js            — SynthesisFeed: READ-ONLY consumer of council synthesis records (users/{uid}/synthesis/{nodeId}; '/'→'__'): getDoc → per-node localStorage cache; PILLAR_NODES + refreshAll() feed the hubs. See docs/contracts/.
js/home-ui.js                   — HomeUI (Life-OS P1): Home hub + default landing, render-from-cache only: bubble map (3 lenses), Balance hero + per-pillar cards, "this week's 3 moves", empty-state-as-DEFAULT. Never touches Firestore on render.
js/physicals-ui.js              — PhysicalsUI (P2): Physicals pillar hub (#/physicals), render-from-cache: composite hero + 4 Area cards from the council `physicals` record's `areas[]` + nudges; onUpdate repaint. No fetch path.
js/chickens-ui.js               — ChickensUI (P3): Chickens pillar hub (#/chickens), render-from-cache: composite hero + 5 Area cards from the council `chickens` record's `areas[]` + nudges. No fetch path.
js/life-building-ui.js          — LifeBuildingUI (P5): Life Building pillar hub (#/life-building), render-from-cache PLUS the monthly finance capture form (write path → Finances.setMonth). Read/write hybrid. No fetch path.
js/tempo-coach.js               — Tempo Coach engine (#15): pure singleton, zero DOM. readinessBand / suggestFocusDurationMs / doseSleepSlope / buildTodayModel / shouldNudge. MUST load before rhythm-panel-today + flow-ui.
js/rhythm-engine.js             — Rhythm aggregation: daily event timeline + readiness band from History / bfrb_events / distractions / RecoveryFeed.
js/rhythm-insights.js           — Rhythm Insights foundation (#12): panel registry (sorted by `order`), DI data layer (_deps), shared inline-SVG helpers, renderInto() (per-panel isolation).
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
utils → dom-utils → platform → schema → stopwatch → timer → instance-manager → pomodoro → flow → interval → persistence → sync-firebase-config → sync-flag → sync-firestore → sync-buffer → sync-engine → sync-toast → sync-manual-dedupe → sync-merge-equal → sync-merge-meds → sync-merge-history → sync-merge-rest-log → sync-merge-presets → sync-merge-bfrb → sync-merge-distractions → sync-merge-mood → sync-merge-finances → sync-auth → audio → themes → history → export → backup → analog → offset-input → button-fsm → ui → cards-ui → compare-ui → timer-ui → bfrb-recovery → distractions → todoist → todoist-ui → pomodoro-ui → tempo-coach → flow-ui → alert-ui → bg-notify → bg-notify-store → interval-ui → cooking-ui → pomodoro-stats → history-ui → sequence → analytics → focus-ui → sequence-ui → analytics-ui → presets → presets-ui → meds → meds-ui → exercise-ui → mindful-ui → wellness-cooking-ui → recovery-ui → recovery-feed → synthesis-feed → finances → home-ui → physicals-ui → chickens-ui → life-building-ui → rhythm-engine → rhythm-insights → rhythm-panel-today → rhythm-panel-meds-sleep → rhythm-panel-recovery-trends → rhythm-panel-focus-minutes → rhythm-panel-bfrb-frequency → rhythm-panel-bfrb-triggers → rhythm-panel-distraction-rollup → rhythm-panel-event-zoom → rhythm-panel-correlations → rhythm-ui → bfrb-events → bfrb-risk → global-bfrb → mood → mood-ui → tempo-nav → app
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
- **Pomodoro:** `{ status: 'idle'|'running'|'paused'|'phaseComplete'|'done', phase: 'work'|'shortBreak'|'longBreak', cycleIndex, totalCycles, workMs, shortBreakMs, longBreakMs, startedAt, accumulatedMs, previousPhaseSnapshot|null }`. Snapshot taken each `nextPhase()` → one-level `revertPhase()`; cleared on `reset()`.
- **Flow Block:** `{ status: 'idle'|'running'|'paused'|'focusComplete'|'recovery'|'recoveryPaused'|'done', phase: 'focus'|'recovery', focusDurationMs (5400000|7200000), startedAt, accumulatedMs, sessionStartedAt, focusEndedAt, goal }`
- **Medication:** `{ id, name, dose, frequency: 'once-daily'|'twice-daily'|'as-needed', lastTakenAt, doseLog[{takenAt}], supplyStartCount?, supplyResetAt? }`. Supply remaining is **derived** (doses on/after `supplyResetAt`), never stored. `MedsManager` persists **per-record** (`meds/{medId}` — the legacy `wellness_meds` blob was deleted in F18; never read or recreate it). Logging is always explicit.
- **Rest log:** `wellness_rest_log`, keyed `YYYY-MM-DD`: `sleep: {hours, quality?, bedtime?, wakeTime?}` (additive-nullable `"HH:MM"`) + `naps: [{startedAt, durationMs, endedEarly?}]`. No engine — `RecoveryUI` reads/writes directly; focus stats derived from History.

### Persistence topology

- Stopwatch/timer instances → localStorage `multi_state` (via `InstanceManager.saveAll()`). Pomodoro → `pomodoro_state`/`pomodoro_config`. Flow → `flow_state`/`flow_config`. Interval → `interval_state`. Sequence → `sequence_state`/`sequence_templates`. Cooking → `cooking_timers`. Legacy single-instance keys auto-migrated.
- Session history → IndexedDB (`stopwatch_history_db`/`sessions`); legacy `stopwatch_history` localStorage migrated in on first load.
- Cloud-sync offline buffer → a **separate** IndexedDB `tempo_sync_db v1`, store `pending_ops`. Three distinct IDB DBs by design (canonical history vs transient sync infra vs SW notification queue).
- **Web notification queue (R9)** → a **separate** IndexedDB `tempo_notify_db v1` (`pending_notifications`): persists scheduled web notifications across SW eviction; `js/bg-notify-store.js` owns it, `sw.js` fires-overdue + re-arms on every wake. Web-only, never synced/exported.
- **The 8 synced stores:** `meds`, `history`, `rest_log`, `presets`, `bfrb_events`, `distractions`, `mood_events` (ADR-0008 — timestamp field is `at`, not `takenAt`), `finances` (Life-OS Phase 5 — per-month `YYYY-MM` **editable** LWW; doc id = the month string). ALL writes to these stamp `deviceId`+`updatedAt`+`schemaVersion` via `js/schema.js`.
- **Device-local, NEVER synced/exported:** `todoist_api_token` + other `todoist_*` (credentials); `flow_user_tasks`, `pomodoro_saved_tasks` (Todoist itself is cross-device truth); `flow_readiness_suggest`, `tempo_coach_nudge_enabled` (#15); `live_activities_enabled` (#4 iOS Live Activities toggle, default ON when absent — per-device preference).
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
- **Phase 12 — Tempo Life-OS (P0–P3 + P5 slice 1)** — evolved Tempo into the `life-os` trunk *in place* (ADR-0003): Firestore contracts + local **council** runtime (launchd; Admin SDK writes `users/{uid}/synthesis/*`) + read-only `js/synthesis-feed.js` (P0 #139) · Home hub default landing (P1 #140/#141) · Physicals pillar — first real federated synthesizer + hub (P2 #142) · Chickens pillar — `mood_events` 7th store + mood capture + hub + stress nudge (P3 #144–#146) · Life Building — `finances` 8th store + synthesizer + hub w/ capture form (P5 #198). Detail → [`docs/BUILD-HISTORY.md`](docs/BUILD-HISTORY.md); plan + ADRs → [`docs/lifeos/`](docs/lifeos/); roadmap → [`docs/lifeos/roadmap.md`](docs/lifeos/roadmap.md).

## Feature Backlog

Lean summary — **full scope, shipped post-mortems, risks, and resolved tech-debt are in
[`docs/BACKLOG.md`](docs/BACKLOG.md).** Ordered by impact-vs-effort ROI; the "Added" column
preserves the original chronological numbering.

| Priority | Feature | Impact | Effort | Added | Status |
|----------|---------|--------|--------|-------|--------|
| 1 | Native iOS app via Capacitor — App Store distribution | High | Medium | #8 | Shipped to personal device; App Store paperwork remaining |
| 2 | Todoist integration — two-way Todoist ↔ Flow/Pomodoro task lists | High | Medium | #10 | Pomo V1 shipped; Flow + rename done (rows #9/#10) |
| 3 | Cloud sync — native CAS + listener parity (`@capacitor-firebase/firestore`) | Medium | Medium | #7 | **Listener parity SHIPPED 2026-07-10** (PR #209, cache v166) — native `subscribe()` is real-time on iOS. **Native CAS permanently IMPOSSIBLE** (plugin has no transaction API through 8.3.0): CAS writeback stays skipped on native; web devices converge the cloud. Detail → `docs/BACKLOG.md` § Shipped post-mortems. |
| 4 | iOS Live Activities — lock screen + Dynamic Island | High | High | #9 | **Timer MVP SHIPPED + device-validated 2026-07-10** (PRs #201–#205, cache v165; 8/9 smoke checks on iPhone 17 Pro Max). **Pomodoro+Flow expansion built + sim-validated** (PR #211, cache v167; device-owner checks parked). Open: toggle OFF→ON re-arm (parked; runbook in `docs/BACKLOG.md` #4 detail) + Stopwatch/Interval/Cooking engines. |
| 5 | Pomodoro phase revert — "Go back" | Medium | Low | #11 | Shipped (PR #104) |
| 6 | Split-screen timer comparison | Medium | High | #2 | **V1 shipped** (⇔ on instance cards → Compare view, `js/compare-ui.js`); fuller two-independent-controls vision open |
| 7 | Voice control (Web Speech API) | Low | Medium | #3 | **Parked 2026-07-19** — low ROI, dormant since the stopwatch era; see `docs/BACKLOG.md` § Parked / Retired |
| 8 | Group/team timing | Low | High | #5 | **Parked 2026-07-19** — needs a backend the PWA deliberately lacks; see `docs/BACKLOG.md` § Parked / Retired |
| 9 | Todoist follow-up A — Flow user-task list | High | Medium | #10-A | Shipped (PR #102); mid-block add (PR #173) |
| 10 | Todoist follow-up B — Pomo inline-rename + `updateTask` | Low | Low | #10-B | Shipped (PR #103) |
| 11 | Sleep log bedtime/wake-time schema extension | Medium | Low | #12 | Shipped 2026-06-01 |
| 12 | Rhythm insights section — multi-chart dashboard (7 panels) | High | Medium | #13 | Shipped 2026-06-01 |
| 13 | Bugfix: Rhythm Timeline dose dots read deleted `wellness_meds` blob | Medium | Low | #14 | Shipped 2026-06-03 |
| 15 | Tempo Coach — readiness-aware daily decision loop | High | Medium | #15 | Shipped 2026-06-05 |
| 16 | BFRB Closed Loop — antecedent capture + Triggers panel | High | Medium | #16 | Shipped 2026-06-05 (PR #126) |
| 17 | Mobile UX papercut sweep — safe-area on takeover panels + ≥44px tap targets | Medium | Low | #17 | Shipped 2026-06-30 (PR #178 safe-area, #179 tap-targets) |
| 18 | Mobile follow-up: BFRB FAB overlaps bottom-right actions | Low | Low | #18 | Shipped 2026-06-30 (PRs #181/#182) — detail in `docs/BACKLOG.md` |
| 19 | Mobile follow-up: clock `.mode-dot` toggle → bigger tap target | Low | Low–Med | #19 | Shipped 2026-06-30 (PR #182) — hit-area bump to ~16×44px; full segmented-control pair intentionally not taken (detail in `docs/BACKLOG.md`) |
| 20 | NSDR launcher — one-tap Restore card → YouTube + auto-logged mindful session | Medium | Low | #20 | Shipped 2026-07-07 (PR #174) |
| 21 | Mobile follow-up: iOS focus-zoom trap on sub-16px inputs | Medium | Low | #21 | Shipped 2026-07-07 (PR #177) — 16px floor on text controls under `pointer: coarse` |
| 22 | Life Building — Finances slice (8th synced store, per-month LWW) | High | High | #22 | Slice 1 **LIVE** (PR #198, 2026-07-08); council green nightly (2026-07-19 weekly wrote the honest empty-state — `finances` collection still empty). Close-out (Arc A ①, awaiting Kyle's July numbers) = capture-form entry → nightly council → verify the hub renders real data. |

## Remaining Tech Debt

Open items only. Resolved entries (the F18 `wellness_meds` orphaned-readers fixes, the
2026-05-26 browser-verification notes) are archived in
[`docs/BACKLOG.md` § Resolved tech debt](docs/BACKLOG.md#resolved-tech-debt-kept-as-migration-pattern-reference).

- **iOS sign-out race — fix landed 2026-07-07, on-device verify pending:** `js/platform.js` arms `_authSignOutGuard` on native sign-out to swallow the Keychain-cached user's stale re-emit until the SDK's null teardown. Keychain-specific, so it shipped on `node --check` + reasoning — confirm on device via the Diagnosis recipe in [`docs/playbooks/ios-signout.md`](docs/playbooks/ios-signout.md), then drop this entry.
- **UI/integration coverage is a thin first slice:** Proving Ground slices 1–2 shipped 2026-07-07/08 (#196/#197 — boot smoke, attribute-XSS render, malformed-import survival, R9 notification persistence; specs in `tests/ui/`, `npm run test:ui`, CI job `ui-tests`). Open: one spec per high-risk render seam.
- **renderLaps does full innerHTML on lap events:** the perf path only covers the RAF tick; a new lap rebuilds the list. Low impact.

## Operations

### Deployment (web → GitHub Pages)

Deployed from the `main` branch root — a merge to `main` auto-deploys to
https://ksdisch.github.io/stopwatch/ in ~1 minute.

**Service-worker cache bump rule:** `sw.js` has a `CACHE_NAME` constant. **Any change to a
cached web file (`index.html`, `css/styles.css`, `css/tempo-shell.css`, `manifest.json`, or
any `js/*.js`) must bump that version string in the same PR**, or users see stale content
until the old SW expires.

### CI + branch protection

`.github/workflows/ci.yml` runs 7 jobs on PRs to `main`: `engine-tests` (canonical count via
`npm test`), `ui-tests`, `asset-integrity`, `sw-cache-bump`, `markdown-links` (lychee over
curated docs — relative links must resolve), `mermaid-lint`, `firestore-rules`. **Branch
protection (2026-07-19) requires all 7 + `enforce_admins`: direct pushes to `main` are
rejected** — the flow-vibrate incident path (`docs/playbooks/stale-cache.md`) is closed.
Repo auto-merge is enabled: land PRs with `gh pr merge --auto --squash`.

### iOS build (Capacitor)

Same web codebase wraps in a Capacitor iOS shell (native haptics + scheduled
notifications). The shell loads the **live GitHub Pages payload at runtime** (`server.url`
in `capacitor.config.json`), so a Pages deploy updates the app on next cold launch — no
rebuild for web-code changes. Daily workflow + cert-refresh playbook: [`iOS-BUILD.md`](iOS-BUILD.md).

```bash
npm install              # one-time: Capacitor + plugins
brew install cocoapods   # one-time
npx cap add ios          # one-time: scaffolds ios/
npm run ios:open         # activate a native/config change (web code auto-updates via Pages)
```

`scripts/sync-www.mjs` mirrors static files into `www/` (gitignored) for the iOS bundle.
`js/platform.js` is the web/native seam; `sw.js` is web-only (`js/app.js` skips registration
when `Platform.isNative` — iOS schedules notifications even with the WebView suspended).
Bundle ID `com.ksdisch.tempo`, app name `Tempo`. App Store paperwork not yet done.

## Conventions (always apply)

### Reuse over re-implementation

- HTML-escape: `escapeHtml` from `js/dom-utils.js`. Do NOT re-implement.
- Time formatting: `Utils.formatMs(ms)` from `js/utils.js`. Do NOT re-implement.
- Haptics: `Platform.haptic(pattern)` from `js/platform.js`. Do NOT call `navigator.vibrate` directly.
- Notifications: `Platform.notify(title, opts)` / `BgNotify.schedule(...)`. Do NOT call `new Notification(...)` directly.
- Sync-invariant stamping: helpers in `js/schema.js`. ALL writes to synced stores stamp `deviceId`+`updatedAt`+`schemaVersion` through them.

### Never touch / handle with care

- `www/`, `ios/` build products, `node_modules/` — generated; never hand-edit.
- `js/sync-firebase-config.js` is a **committed public** web config by design (`firestore.rules` enforces access) — do not "fix"/rotate/hide it.
- Service-account keys (`service-account.json`, `*-firebase-adminsdk-*.json`, `council/.env.secrets`) — gitignored credentials; never commit, read, or print.
- `council/synthesize.mjs` / `seed-pillars.mjs` / `run-synthesis.sh` write **production Firestore** — never run them as a test (that's `npm --prefix council test`).
- Tests are the spec: never edit a test to make a failure pass — fix the code or report the failure.
- Migration paths in data modules (History, meds, distractions, bfrb-events) keep old devices upgradable — not dead code; don't remove.

### Test commands

Engine tests (~1,238 `it()` across ~55 `tests/*.test.js` as of 2026-07-07) execute **in a real
browser** — no Node assertion runner. `npm test` drives headless Chromium over the same page;
its `PASS (n)` line (echoed by the CI `engine-tests` job) is the canonical count — trust it
over any number written in docs.

```bash
npm test                      # headless: serves :8765, loads tests/index.html, polls title "PASS (n)"/"FAIL (n)"; one auto-retry
npm run test:ui               # UI/integration suite (@playwright/test; loads real index.html headless, SW blocked; CI job ui-tests)
python3 -m http.server 8765   # manual: open http://localhost:8765/tests/index.html (title = live verdict)
npm run test:rules            # Firestore security-rules suite (emulator; needs Java)
npm --prefix council test     # Life-OS council validator suite (pure node --test)
```

**Known flake:** 1–2 sync-engine steady-state `it()`s fail **headless-only**; a visible tab
is the source of truth — adjudication + fresh-code discipline in
[`docs/playbooks/browser-verification.md`](docs/playbooks/browser-verification.md) (or
`/run-tests`). On `FAIL (n)`, n = failure count. `curl`-grepping the HTML does NOT execute
tests. Test API: `describe`/`it`/`assert`/`assertEqual`/`assertClose`/`assertArrayEqual`
(`tests/test-runner.js`).

### Lint / typecheck / build

None — vanilla JS, no toolchain. The script order in `index.html` IS the dependency graph.
iOS: `npm run sync-www` then `npm run ios:open`.

### Definition of done (any code change)

1. Engine behavior covered in `tests/<module>.test.js`; suite green per § Test commands.
2. Cached web file changed ⇒ `CACHE_NAME` bumped in `sw.js` **in the same commit** (hook + CI enforce).
3. New `js/` module ⇒ all 4 wire-points: `index.html` `<script>` slot, CLAUDE.md file-map + chain, `sw.js` ASSETS, registered test stub (`/new-engine-module` / `/add-panel`).
4. Synced-store writes stamp via `js/schema.js`; persisted key/shape changes update `docs/reference/data-dictionary.md`.
5. UI-visible changes verified on FRESH code per [`docs/playbooks/browser-verification.md`](docs/playbooks/browser-verification.md) — console clean + screenshot evidence.
6. Shipping a backlog item ⇒ update the Feature Backlog row here + `docs/BACKLOG.md`; substantial session ⇒ `docs/SESSION-LOG.md` entry.
7. Feature branch + PR (`feat/`/`fix/`/`refactor/`/`docs/`); **never merge or push `main` without Kyle's explicit per-PR go-ahead** (`/ship-pr` walks the flow).

### Orchestrator / subagent workflow (when dispatched)

A 5-subagent PR pipeline (`auditor`/`sync-auditor` → `engine-implementer` → `engine-tester` →
`ui-wirer` → `pr-shipper`) lives in `.claude/orchestrator.md` + `.claude/agents/`
(`.claude/orchestrator-prompt.md` is the sync-era variant). `ui-wirer` fires only when the
audit's affected-files include UI files (`js/*-ui.js`, `index.html`, `css/*.css`,
`js/tempo-nav.js`); `pr-shipper` always pauses for explicit push approval and applies the
cache bump when the implementer reports it needed. Sync-PR branches `feat/sync-<pr-id>-<slug>`;
one PR per Stage row in `docs/sync-impl/PLAN.md`, merged sequentially within a stage.

**Where things live** (beyond the header-block doc index): sync plan/audits/briefs →
`docs/sync-impl/` (`PLAN.md`, `audits/<PR-ID>-AUDIT.md`, `prompts/<PR-ID>-PROMPT.md`);
backend decision → `docs/sync-review/BACKEND-SELECTION.md`; session log →
`docs/SESSION-LOG.md`; orchestrator + subagent prompts → `.claude/orchestrator.md`,
`.claude/agents/`, `.claude/templates/phase-brief.md`.

## Claude tooling for this repo

Commands, skills, agents, hooks, and MCP servers are vendored into `.claude/` so they work
in cloud/web sessions and for collaborators. The harness lists what's invocable each
session; the **full annotated catalog** (per-item descriptions, 💻 local-only flags) lives
in [`docs/reference/claude-tooling.md`](docs/reference/claude-tooling.md).

- **Repo-specific commands:** `/begin` `/wrap` `/new-engine-module` `/fix-bug` `/run-tests`
  `/ship-pr` `/add-panel`, plus the vendored global set (`/handoff`, `/explore-plan`, `/tdd`,
  `/trim-context`, `/autonomous-milestone`, `/brainstorm`, `/claudify-repo`, …).
- **Subagents** (`.claude/agents/`): the 5-subagent PR pipeline + `sync-invariant-reviewer`,
  `test-runner`, `app-verifier`, `council-tester` — all read-only reporters.
- **Hook** (`.claude/settings.json`): `pre-commit-guard` — before any `git commit`, runs the
  3 guard checks (`check-sw-bump` / `check-asset-integrity` / `check-load-order`) and blocks
  the commit on a missing cache bump, an ASSETS/`<script>` mismatch, or load-order-chain drift.
- **MCP servers** (`.mcp.json`, committed): `playwright` (deterministic browser — engine
  suite, app driving, stale-SW sidestep) + `firebase` (in-session Firestore/Auth reads per
  `docs/playbooks/sync-divergence.md`).

## Operating Constraints

@.claude/operating-constraints.md

## Project Wiki

This project uses the project-wiki skill. When integrating new sources, recording decisions, or pausing work:
- Update `PROJECT.md` status and next actions
- Update `HANDOFF.md` with what changed and what's next
- Add durable understanding to `Wiki/` topic pages
- Record decisions in `Decisions.md`
- Keep `Wiki/_index.md` current

(`Wiki/`, `Decisions.md`, and `Sources.md` are created on first need — templates live in the skill.)

Invoke the `project-wiki` skill when wiki updates are needed.
