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
js/sync-firestore.js            — Firestore SDK seam (getDoc/setDoc/getCollection/runTransaction/subscribe). Web lazy-imports CDN; native routes to Capacitor plugin (runTransaction+subscribe web-only → backlog #3). Normalized errors.
js/sync-buffer.js               — Offline write buffer. Separate IndexedDB `tempo_sync_db v1`, store `pending_ops` (≤1000 ops). Drained FIFO when network online.
js/sync-engine.js               — SyncEngine orchestrator (~2600 lines). SYNCED_STORES = the EIGHT stores. init → auth-change → hydrateFromCloud → startSteadyState (300s poll / web onSnapshot) → per-store merge → CAS writeback. LIVE by default (E-1e).
js/sync-toast.js                — Toast: non-blocking sync notifications (e.g. F15 meds arrival toast) + Toast.action(text, btnLabel, onTap) tappable variant (stress nudge).
js/sync-manual-dedupe.js        — D-1 placeholder: ManualDedupe.scan() surfaces matching history pairs across synced/imported buckets.
js/sync-merge-equal.js          — Shared change-detection for CAS writeback: SyncMergeEqual.recordsEqual(a,b) deep-equals two records minus the stamp envelope (updatedAt/deviceId/schemaVersion). All 7 merge modules call it to skip redundant cloud writes (M2/M5 — kills the self-triggering merge loop).
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
js/button-fsm.js                — ButtonFsm: pure shared button state machine (M5). get(mode, status) → frozen {left, right} cell specs (label/cls/disabled/action) for stopwatch+timer; ui.js + timer-ui.js derive presentation AND dispatch from it.
js/ui.js (~500 lines)           — Main UI: RAF render loop, ButtonFsm-driven buttons, lap list, swipe-to-delete, vibration, a11y.
js/cards-ui.js                  — Compact card rendering for non-primary stopwatch/timer instances.
js/compare-ui.js                — Compare view: split-screen two-instance comparison.
js/timer-ui.js                  — Timer mode UI: button handlers, render loop, alarm. Session saves carry `programName: Timer.getName()` (Chickens Mindfulness Area path 2).
js/bfrb-recovery.js             — Shared 60s in-button competing-response countdown on a BFRB catch. Plays SFX.playBFRBEnd.
js/distractions.js              — Distractions data module. sessionId-keyed maps (F8) for Flow+Pomo. 6th sync store. Owns the migration.
js/bfrb-events.js               — BfrbEvents data module. F3 consolidated BFRB stream (`bfrb_events`), single source of truth. Synced; owns migration.
js/bfrb-risk.js                 — BFRB Closed Loop Slice B: pure `BfrbRisk.assess()` — clustered vs steady vs suppressed from the live stream + optional recovery/sleep inputs → sleepDown + mindfulSuggested (stress-nudge decision). Zero DOM/copy.
js/todoist.js                   — Todoist REST v2 client: token mgmt, getTasks/close/reopen/create/updateTask, offline queue. Device-local token, never synced.
js/todoist-ui.js                — Todoist UI: shared picker modal (openPicker) + settings panel. Reused by Pomo saved tasks + Flow task list.
js/global-bfrb.js               — Global BFRB FAB (always-visible + shortcut B) → bfrb_events; chime volume slider. Stress nudge: mindfulSuggested → tappable toast → #/wellness/mindful (opt-in + daily throttle).
js/mood.js                      — Mood data module. Owns `mood_events`, the 7th synced store (ADR-0008): log/getAll/snapshotForSync, F10 stamping, F13 gate. Clone of bfrb-events minus migration.
js/finances.js                  — Finances data module. Owns `finances`, the 8th synced store (Phase 5): per-month YYYY-MM snapshots, editable (setMonth upsert/partial-merge), per-month-key LWW. snapshotForSync/getMonth/getAll, F10 stamping, F13 gate, F19a. Council reads it server-side.
js/mood-ui.js                   — Mood capture UI (Life-OS P3): topbar popover (valence chips → tags → note), deferred-commit into ONE Mood.log, shortcut M, Platform.haptic.
js/pomodoro-ui.js               — Pomodoro mode UI: handlers, render loop, settings, checklists, saved tasks, templates, distractions, timeline.
js/pomodoro-stats.js            — Pomodoro stats engine (streaks, daily/weekly aggregates).
js/flow-ui.js                   — Flow Block UI: pre-block checklist, user task list (two-way Todoist; `flow_user_tasks`), distractions, summary, recovery, #15 readiness default.
js/alert-ui.js                  — Alert UI: add/remove/render threshold alerts for stopwatch.
js/bg-notify.js                 — Background notification bridge via service worker (backgrounded tabs). R9: `rearm()` nudge + visibilitychange listener.
js/bg-notify-store.js           — R9 durable notification store: pure `plan(records,now)` (overdue→fire / upcoming→arm) + `tempo_notify_db` IDB CRUD (put/remove/all). SW-safe (indexedDB/self only); sw.js loads the same bytes via importScripts so scheduled notifications survive worker eviction.
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
js/mindful-ui.js                — Wellness › Mindful UI: breathing exercises + meditation presets → Timer + NSDR Restore card (external YouTube launch, auto-logs tags ['mindful','nsdr']). Breathing logs a History session (tags ['mindful']) on stop when ≥1 full cycle.
js/wellness-cooking-ui.js       — Wellness › Cooking UI: 8 named cooking presets → Cook mode (createTimer). Recent Activity from History (type=cooking). ≤8 timers.
js/recovery-ui.js               — Wellness › Recovery UI: daily sleep log + nap tracker + derived focus status. Persists `wellness_rest_log`.
js/recovery-feed.js             — RecoveryFeed: READ-ONLY consumer of the external personal-health-elt pipeline (Firestore recovery_state). No write path. Contract: docs/reference/.
js/synthesis-feed.js            — SynthesisFeed: READ-ONLY consumer of council synthesis records (users/{uid}/synthesis/{nodeId}; '/'→'__'). getDoc → per-node localStorage cache → getRecord; PILLAR_NODES + refreshAll() + getAllPillarRecords() feed the hubs. No write path. See docs/contracts/.
js/home-ui.js                   — HomeUI (Life-OS P1): Home hub + default landing. Render-from-cache only: bubble map (3 lenses, inline SVG), Balance hero + per-pillar synthesis cards, "this week's 3 moves", empty-state-as-DEFAULT. Pure helpers on _internals; never touches Firestore on render.
js/physicals-ui.js              — PhysicalsUI (Life-OS P2): Physicals pillar hub (6th nav tab #/physicals). Render-from-cache (mirrors home-ui): composite hero + 4 Area cards (Recovery/Sleep/Meds/Training load) from the council `physicals` record's `areas[]` + nudges; reuses .home-card chips + onUpdate repaint. No fetch path.
js/chickens-ui.js               — ChickensUI (Life-OS P3): Chickens pillar hub (7th nav tab #/chickens). Render-from-cache (mirrors physicals-ui): composite hero + 5 Area cards (Mood/Mindfulness/BFRB/Focus/Stress) from the council `chickens` record's `areas[]` + nudges. No fetch path.
js/life-building-ui.js          — LifeBuildingUI (Life-OS P5): Life Building pillar hub (8th nav tab #/life-building). Render-from-cache (mirrors physicals-ui): composite hero + Finances Area card from the council `life_building` record's `areas[]` + nudges, PLUS the monthly finance capture form (write path → Finances.setMonth). Read/write hybrid (mirrors recovery-ui). No fetch path.
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
- **Medication:** `{ id, name, dose, frequency: 'once-daily'|'twice-daily'|'as-needed', lastTakenAt, doseLog[{takenAt}], supplyStartCount?, supplyResetAt? }`. Supply fields nullable; remaining **derived** from doses on/after `supplyResetAt`, never stored. `MedsManager` singleton; persists **per-record** (`meds/{medId}` keys — the legacy `wellness_meds` blob was deleted in the F18 migration; never read or recreate it). Logging is always explicit; V1 schedule records migrate to `as-needed`.
- **Rest log:** `wellness_rest_log`, keyed `YYYY-MM-DD`: `sleep: {hours, quality?, bedtime?, wakeTime?}` (additive-nullable `"HH:MM"`) + `naps: [{startedAt, durationMs, endedEarly?}]`. No engine — `RecoveryUI` reads/writes directly; focus stats derived from History.

### Persistence topology

- Stopwatch/timer instances → localStorage `multi_state` (via `InstanceManager.saveAll()`). Pomodoro → `pomodoro_state`/`pomodoro_config`. Flow → `flow_state`/`flow_config`. Interval → `interval_state`. Sequence → `sequence_state`/`sequence_templates`. Cooking → `cooking_timers`. Legacy single-instance keys auto-migrated.
- Session history → IndexedDB (`stopwatch_history_db`/`sessions`); legacy `stopwatch_history` localStorage migrated in on first load.
- Cloud-sync offline buffer → a **separate** IndexedDB `tempo_sync_db v1`, store `pending_ops`. Three distinct IDB DBs by design (canonical history vs transient sync infra vs SW notification queue).
- **Web notification queue (R9)** → a **separate** IndexedDB `tempo_notify_db v1`, store `pending_notifications` (`{ id, fireAt, title, body }`). Persists web scheduled notifications so they survive SW eviction; `js/bg-notify-store.js` owns it, `sw.js` fires-overdue + re-arms on every SW wake. Web-only (native schedules at the OS level), never synced/exported.
- **The 8 synced stores:** `meds`, `history`, `rest_log`, `presets`, `bfrb_events`, `distractions`, `mood_events` (ADR-0008 — timestamp field is `at`, not `takenAt`), `finances` (Life-OS Phase 5 — per-month `YYYY-MM` **editable** LWW; doc id = the month string). ALL writes to these stamp `deviceId`+`updatedAt`+`schemaVersion` via `js/schema.js`.
- **Device-local, NEVER synced/exported:** `todoist_api_token` + other `todoist_*` (credentials); `flow_user_tasks`, `pomodoro_saved_tasks` (Todoist itself is cross-device truth); `flow_readiness_suggest`, `tempo_coach_nudge_enabled` (#15).
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
- **Phase 12 — Tempo Life-OS (Phases 0–3)** — evolved Tempo into the `life-os` trunk *in place* (ADR-0003). **P0 (#139):** Firestore contracts (`docs/contracts/`), local **council** runtime + launchd harness (`council/`, writes `users/{uid}/synthesis/*` via Admin SDK), read-only `js/synthesis-feed.js`. **P1 (#140/#141):** Home hub (`js/home-ui.js`) — default landing; bubble map + per-pillar cards + "this week's 3 moves", render-from-cache. **P2 (#142):** Physicals pillar — council synthesizer reads `recovery_state` + synced `meds`/`rest_log`/`history` server-side, writes `synthesis/physicals` (4 Areas → 0–100 composite); hub `js/physicals-ui.js` (`#/physicals`). **P3 (#144–#146):** Chickens pillar — `mood_events` 7th synced store (ADR-0008) + topbar mood capture (shortcut M), `chickens` synthesizer (5 Areas), hub `js/chickens-ui.js` (`#/chickens`), stress nudge (BfrbRisk → tappable toast → `#/wellness/mindful`). Full detail relocated to [`docs/BUILD-HISTORY.md`](docs/BUILD-HISTORY.md); plan + ADRs → [`docs/lifeos/`](docs/lifeos/); roadmap → [`docs/lifeos/roadmap.md`](docs/lifeos/roadmap.md).

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
| 6 | Split-screen timer comparison | Medium | High | #2 | **V1 shipped** (⇔ on instance cards → split Compare view, `js/compare-ui.js`); fuller two-independent-controls vision open — status corrected by 2026-07-07 hunt F6 |
| 7 | Voice control (Web Speech API) | Low | Medium | #3 | **Unshipped** |
| 8 | Group/team timing | Low | High | #5 | **Unshipped** — needs a backend |
| 9 | Todoist follow-up A — Flow user-task list | High | Medium | #10-A | Shipped (PR #102); mid-block add (PR #173) |
| 10 | Todoist follow-up B — Pomo inline-rename + `updateTask` | Low | Low | #10-B | Shipped (PR #103) |
| 11 | Sleep log bedtime/wake-time schema extension | Medium | Low | #12 | Shipped 2026-06-01 |
| 12 | Rhythm insights section — multi-chart dashboard (7 panels) | High | Medium | #13 | Shipped 2026-06-01 |
| 13 | Bugfix: Rhythm Timeline dose dots read deleted `wellness_meds` blob | Medium | Low | #14 | Shipped 2026-06-03 |
| 15 | Tempo Coach — readiness-aware daily decision loop | High | Medium | #15 | Shipped 2026-06-05 |
| 16 | BFRB Closed Loop — antecedent capture + Triggers panel | High | Medium | #16 | Shipped 2026-06-05 (PR #126) |
| 17 | Mobile UX papercut sweep — safe-area on takeover panels + ≥44px tap targets | Medium | Low | #17 | Shipped 2026-06-30 (PR #178 safe-area, #179 tap-targets) |
| 18 | Mobile follow-up: BFRB FAB overlaps bottom-right actions (History "Clear All", Recovery "Log sleep") | Low | Low | #18 | Shipped 2026-06-30 — takeover panels via PR #181; recovery route (`#/wellness/recovery`) via PR #182 (surface-scoped `:has([data-wellness-sub="recovery"])` hide) |
| 19 | Mobile follow-up: clock `.mode-dot` toggle (two 8px dots) → bigger tap target | Low | Low–Med | #19 | Shipped 2026-06-30 (PR #182) — partial hit-area bump: transparent `::after` enlarges the tap target to ~16×44px with the visible 8px dots unchanged. Full ≥44px-wide pair (segmented control) intentionally not taken — would redesign the hero timer screen |
| 20 | NSDR launcher — one-tap Restore card → YouTube + auto-logged mindful session | Medium | Low | #20 | Shipped 2026-07-07 (PR #174) |
| 21 | Mobile follow-up: iOS focus-zoom on sub-16px inputs trapped the viewport zoomed (Todoist token field) | Medium | Low | #21 | Shipped 2026-07-07 (PR #177) — 16px floor on text controls under `pointer: coarse`; desktop compact sizing kept |
| 22 | Life Building — Finances slice (8th synced store, per-month LWW) | High | High | #22 | Slice 1 **built** 2026-07-08 (branch `feat/p5-life-building-finances`) — `finances` 8th synced store + council `life_building` synthesizer + Life Building hub (`#/life-building`) w/ monthly capture form. PR + merge + first prod council run pending. |

## Remaining Tech Debt

Open items only. Resolved entries (the F18 `wellness_meds` orphaned-readers fixes, the
2026-05-26 browser-verification notes) are archived in
[`docs/BACKLOG.md` § Resolved tech debt](docs/BACKLOG.md#resolved-tech-debt-kept-as-migration-pattern-reference).

- **iOS sign-out race — fix landed 2026-07-07, on-device verify pending:** the native `authStateChange` listener raced the Keychain-cached user back after `signOut()`; `js/platform.js` now arms `_authSignOutGuard` on native sign-out and swallows stale non-null re-emits until the SDK's null teardown emit. Native-Keychain-specific, so it shipped on `node --check` + reasoning (#169 precedent) — confirm on device via the playbook's Diagnosis recipe, then drop this entry. Playbook: [`docs/playbooks/ios-signout.md`](docs/playbooks/ios-signout.md).
- **UI/integration coverage is a thin first slice:** the Tempo Proving Ground shipped 2026-07-07 (`@playwright/test` specs in `tests/ui/` load the real `index.html` under a blocked service worker — `npm run test:ui`, CI job `ui-tests`). Slice 1 = boot smoke + attribute-XSS render (caught + fixed a live bug at `analytics-ui.js:303`) + malformed-import survival. Slice 2 = R9 notification-persistence shipped 2026-07-08 (`tests/ui/notification-tap.spec.js` under `serviceWorkers:'allow'`; durable `tempo_notify_db` + SW rearm-on-wake, `js/bg-notify-store.js`). Open: one spec per high-risk render seam.
- **renderLaps does full innerHTML on lap events:** the perf path only covers the RAF tick; a new lap rebuilds the list. Low impact.

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

### CI (PR gate ONLY — a direct push to main bypasses it and still deploys)

`.github/workflows/ci.yml` runs on PRs to `main`: `engine-tests` (canonical count via `npm test`),
`asset-integrity`, `sw-cache-bump`, `markdown-links` (lychee over curated docs — relative links
must resolve), `mermaid-lint`, `firestore-rules`. Always ship via PR — the flow-vibrate incident
(`docs/playbooks/stale-cache.md`) is what a direct push costs.

### iOS build (Capacitor)

Same web codebase wraps in a Capacitor iOS shell (haptics + scheduled notifications work
natively). The iOS shell loads the **live GitHub Pages payload at runtime** (`server.url` in
`capacitor.config.json`), so a `git push` deploy updates the app on next cold launch — no
rebuild for web-code changes (bundle still ships but is not an offline fallback). Daily
workflow + live-payload tradeoffs + cert-refresh playbook: [`iOS-BUILD.md`](iOS-BUILD.md).

```bash
npm install              # one-time: Capacitor + plugins
brew install cocoapods   # one-time
npx cap add ios          # one-time: scaffolds ios/
npm run ios:open         # activate a native/config change (web code auto-updates via Pages)
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

**Known flake:** 1–2 sync-engine steady-state `it()`s (`_steadyRunInFlight` latch) fail
**headless-only**; a visible tab is the source of truth — adjudication recipe + the full
fresh-code discipline live in
[`docs/playbooks/browser-verification.md`](docs/playbooks/browser-verification.md) (or run
`/run-tests`). On `FAIL (n)`, n = failure count, not total. `curl`-grepping the HTML does NOT
execute tests. Test API: `describe` / `it` / `assert` / `assertEqual` / `assertClose` /
`assertArrayEqual` (`tests/test-runner.js`).

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
`ui-wirer` → `pr-shipper`) lives in `.claude/orchestrator.md` (general + sync routing;
`.claude/orchestrator-prompt.md` is the sync-era variant) + `.claude/agents/`. The
`ui-wirer` phase fires only when the audit's affected-files table includes UI files
(`js/*-ui.js`, `index.html`, `css/*.css`, `js/tempo-nav.js`). `pr-shipper` always pauses for
explicit push approval. Sync-PR branches: `feat/sync-<pr-id>-<slug>`; commit prefixes
`feat`/`refactor`/`fix`/`docs`; one PR per Stage row in `docs/sync-impl/PLAN.md`, merged in
**sequential order within a stage**. `pr-shipper` applies the cache bump when the
implementer reports it needed.

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
- Orchestrator + subagent prompts → `.claude/orchestrator.md` (general+sync), `.claude/orchestrator-prompt.md` (sync-era), `.claude/agents/`, `.claude/templates/phase-brief.md`

## Claude tooling for this repo

Repo-local commands (`/<name>`), skills, and agents vendored into `.claude/` so they work in
cloud/web sessions and for collaborators. **💻 = local-only** (needs a browser MCP / local dev
server; won't work in a cloud/web session).

**Commands** (`.claude/commands/`):
- `/begin` — open a session: orient on branch/commits/open PRs, recap the last `/wrap` log, route into `.claude/session-start.md`.
- `/wrap` — end-of-session wrap-up: recap + why, active-recall quiz, next moves; saves a dated log (pairs with `docs/SESSION-LOG.md`).
- `/handoff` — generate a self-contained handoff prompt for a fresh session, then stop.
- `/explore-plan <task>` — explore → plan → confirm before any code; proposes 2–3 ranked approaches and waits for your pick.
- `/tdd <module + behavior>` — test-first loop: write failing tests, confirm they fail for the right reason, then code until green **without** editing the tests (engine tests run via `npm test`).
- `/trim-context` — find + fix CLAUDE.md / memory / always-loaded token bloat, then apply the fixes.
- `/autonomous-milestone [target]` — with a target: plan/build/test/verify end-to-end; with none: triage the backlog into ranked candidates. Uses ultracode multi-agent orchestration (higher token cost).
- 💻 `/screenshot-iterate <mock + what to build>` — visual loop: implement → screenshot the running app → compare to a mock → iterate. Needs a browser MCP + local dev server.
- `/new-engine-module <name + desc>` — **repo-specific.** Scaffold a `js/<name>.js` the Tempo way and wire all four touch-points in one shot: `<script>` tag at the correct load-order slot, CLAUDE.md file-map + load-order chain, `sw.js` ASSETS + `CACHE_NAME` bump, and a `tests/<name>.test.js` stub registered in `tests/index.html`.
- `/fix-bug <symptom + where>` — **repo-specific.** Bug loop: triage vs the known playbooks (stale-SW first), root-cause before edit, regression test, conventions checklist, fresh-context verify, `fix/` branch.
- `/run-tests [scope]` — **repo-specific.** Suite execution + interpretation: `npm test`, the headless-flake adjudication rule, rules + council variants. Never edits to get green.
- `/ship-pr [scope]` — **repo-specific.** DoD pre-flight, pre-runs the 3 guard checks, branch/commit conventions, push + `gh pr create`, CI expectations, merge etiquette (worktree `--delete-branch` quirk). Stops before merge.
- `/add-panel <key + question>` — **repo-specific.** Scaffold a Rhythm Insights panel: registry contract (pure build/render via injected deps), `order` pick, 4-point wiring, clock-pinned tests.

**Skills** (`.claude/skills/`, auto-trigger or invoke explicitly):
- `artifacts-audit` — audit which engineering artifacts (READMEs, ADRs, runbooks, ERDs…) the repo should have; writes `docs/artifacts-plan.md`. Plans only, no source edits.
- `artifacts-generate` — generate artifacts from a prior `docs/artifacts-plan.md` (one-at-a-time or batch). Companion to `artifacts-audit`.
- 💻 `match-the-mock` — auto-triggering visual loop (paste a mock / Figma link): implement → screenshot → compare → iterate. Needs a browser MCP + local dev server.

**Subagents** (`.claude/agents/`) — repo-specific, beyond the 5-subagent sync-PR pipeline:
- `sync-invariant-reviewer` — read-only reviewer of a branch diff for the three cross-cutting invariants the pipeline doesn't mechanically gate: synced-store `schema.stamp()` coverage, reuse-over-reimplementation (`Platform.haptic`/`Platform.notify`/`escapeHtml`/`Utils.formatMs`), and new-module 4-file wiring. Reports findings; never edits.
- `test-runner` — runs the suites and reports verdict + failures verbatim; knows the headless-flake adjudication rule. Read-only; pinned to haiku.
- `app-verifier` — drives the real app via the playwright MCP on the fresh-context recipe; returns observed-vs-expected + screenshots + console findings. Read-only.
- `council-tester` — runs `npm --prefix council test` (Life-OS validators); hard-forbidden from `synthesize.mjs`/`seed-pillars.mjs` (production Firestore writers). Read-only; haiku.

**Hooks** (`.claude/settings.json`, committed — repo-specific):
- `pre-commit-guard` (`PreToolUse` on `Bash`, script `scripts/hooks/pre-commit-guard.mjs`) — before any `git commit`, runs `scripts/check-sw-bump.mjs` + `scripts/check-asset-integrity.mjs` + `scripts/check-load-order.mjs` and **blocks** the commit if a cached web file changed without a `CACHE_NAME` bump, if `sw.js` ASSETS and the `index.html` `<script>` set disagree, or if the `CLAUDE.md` "Script Load Order" chain drifts from the `index.html` `<script>` order.

**MCP servers** (`.mcp.json`, committed — project-scoped so cloud/web sessions + collaborators inherit them; Claude Code prompts to approve project MCP servers on first use):
- `playwright` (`npx @playwright/mcp@latest`) — deterministic browser for any session: run the engine suite, drive/screenshot the app, sidestep the stale-SW trap. Makes the 💻 commands work in cloud/web too.
- `firebase` (`npx firebase-tools@latest experimental:mcp --only firestore,auth`) — in-session Firestore/Auth queries (sync debugging per `docs/playbooks/sync-divergence.md`); reuses the firebase-tools wired for `npm run test:rules`.

## Operating Constraints

@.claude/operating-constraints.md
