# Stopwatch PWA — Project Reference

## What This App Is

A cross-platform stopwatch PWA (Progressive Web App) that works on phone and desktop, inspired by the iPhone Clock app's stopwatch. The key differentiator is the ability to **start a stopwatch with time already elapsed** — e.g., "I took my medication ~30 minutes ago, start counting from 30:00 and count up."

**Live:** https://ksdisch.github.io/stopwatch/
**Repo:** https://github.com/ksdisch/stopwatch

## Tech Stack

Vanilla HTML + CSS + JS. No framework, no build step. The entire app is a static folder deployable to any static host. Engine modules use factory functions; UI modules are plain global functions. No IIFEs except for self-contained data modules (History, Persistence, SFX, Themes, etc.).

## Architecture

```
index.html                      — App shell, all HTML structure
css/styles.css (~3300 lines)    — All styling, dark/light themes, responsive, animations, a11y
js/utils.js                     — Utils.formatMs(ms) shared time formatting
js/dom-utils.js                 — escapeHtml(str) shared HTML-escape helper
js/stopwatch.js                 — createStopwatch(id) factory. Drift-free wall-clock timing. Alerts.
js/timer.js                     — createTimer(id) factory. Same pattern as Stopwatch.
js/instance-manager.js          — InstanceManager: manages multiple stopwatch/timer instances (up to 5 each), primary tracking, persistence.
js/pomodoro.js                  — Pomodoro engine. Work/break cycle state machine.
js/flow.js                      — Flow Block engine. Single 90/120-min focus block + 15-min recovery. Ultradian rhythm.
js/interval.js                  — Interval engine. Phase-based rounds (Tabata / HIIT / Custom).
js/persistence.js               — Persistence.save()/load() delegates to InstanceManager.saveAll()/loadAll().
js/sync-flag.js                 — SyncFlag: `tempo_sync_enabled` localStorage flag (`isEnabled()` / `enable()` / `disable()`). Owned by B-1; the visible developer toggle lands in B-2.
js/sync-engine.js               — SyncEngine: cloud-sync orchestrator scaffold. Hardcoded `SYNCED_STORES` registry (meds / history / rest_log / presets), `init()` / `getSnapshot()` / `enable()` / `disable()` / `getState()` lifecycle + event emitter. No network calls; B-3 wires the uploader.
js/sync-manual-dedupe.js        — D-1 placeholder: `ManualDedupe.scan()` surfaces history pairs with matching `(date, duration, type)` across synced and imported buckets (1.0 exact-duration match; 0.9 for `|delta| <= 5000ms`). Pre-bucketed by `(type, YYYY-MM-DD)`. UI deferred to D-2+.
js/sync-auth.js                 — SyncAuth: signIn / signOut / getCurrentUser / onAuthChange. Delegates to Platform.auth (web vs native shim). Caches normalized user; emits 'auth-change' via SyncEngine.emit on transitions. No-op when SyncFlag.isEnabled() === false.
js/sync-firestore.js            — Firestore SDK seam (single wrapper for getDoc/setDoc/getCollection/runTransaction/setBatch). Web branch lazy-imports firebase/firestore from gstatic CDN; native branch routes to window.Capacitor.Plugins.FirebaseFirestore. Errors normalized to { kind, message, isRetryable, originalError }. SYNC_DISABLED fast-path when flag is off.
js/backup.js                    — F12 mandatory local backup. Backup.exportLocal() reuses Export.buildBackupData() then offers via Web Share API (mobile) or <a download> (desktop). Backup.importLocal() ships dormant as the D-1 restore hook. Returns { ok, bytesWritten?, error? }.
js/audio.js                     — SFX module. Web Audio API synthetic sounds (no audio files). Multiple sound profiles.
js/themes.js                    — Themes module. 6 presets, applies CSS vars to :root.
js/history.js                   — History module. Session storage in IndexedDB (db: stopwatch_history_db, store: sessions). Tags, notes. Migrates legacy localStorage entries.
js/export.js                    — Export module. Clipboard, CSV download, Web Share API, full-data JSON export/import.
js/analog.js                    — Analog clock face. SVG with 60 ticks, numbers, rotating hands.
js/offset-input.js              — "Start with time already elapsed" input UI + presets.
js/ui.js (~490 lines)           — Main UI: render loop (RAF), button state machine, lap list, swipe-to-delete, vibration intervals, a11y announcements.
js/cards-ui.js                  — CardsUI: compact card rendering for non-primary stopwatch/timer instances.
js/compare-ui.js                — Compare view: split-screen two-instance comparison.
js/timer-ui.js                  — Timer mode UI: button handlers, render loop, alarm callback.
js/bfrb-recovery.js             — BFRBRecovery helper: shared 60s in-button countdown for the competing-response routine triggered on any BFRB catch. Calls SFX.playBFRBEnd on completion (louder, separately-configurable chime).
js/global-bfrb.js               — Global BFRB FAB: always-visible floating button + keyboard shortcut (B). Smart storage routing: writes to flow_bfrbs / pomodoro_bfrbs when those sessions are running, bfrbs_global otherwise. Wires the BFRB chime volume slider in the settings drawer.
js/pomodoro-ui.js               — Pomodoro mode UI: button handlers, render loop, settings, focus/break/actual-work checklists, saved tasks, templates, distraction log, timeline.
js/pomodoro-stats.js            — Pomodoro stats engine (streaks, daily/weekly aggregates).
js/flow-ui.js                   — Flow Block UI: pre-block checklist, distraction log, summary card, recovery phase.
js/alert-ui.js                  — Alert UI: add/remove/render threshold alerts for stopwatch.
js/bg-notify.js                 — Background notification bridge via service worker (for backgrounded tabs).
js/interval-ui.js               — Interval mode UI: phase list, templates, rounds, run info.
js/cooking-ui.js                — Cooking mode UI: multiple named short timers with suggestions.
js/sequence.js                  — Sequence engine (linear phase chain, sub-mode of Timer).
js/sequence-ui.js               — Sequence UI: phase setup, run info.
js/analytics.js                 — Analytics engine: aggregates history sessions by day/type.
js/analytics-ui.js              — Analytics dashboard UI panel.
js/focus-ui.js                  — Focus / ambient display mode (distraction-free full-screen view).
js/presets.js                   — Quick Presets engine: storage, apply (mode + config), migration from offset presets.
js/presets-ui.js                — Presets UI: drawer grid + quick-picks row.
js/history-ui.js                — History panel UI: session list, tag filter bar, tag/note editing, log-past-session form.
js/meds.js                      — Medications engine. createMed(id) factory + MedsManager singleton. Interval or time-of-day schedules. Dose logging with optional offset ("took it ~30 min ago"). D-2 live: `MedsManager.reconcileDoseLog(med, incomingEntries)` (F1 ±15-min cross-device collapse + F16 ±15-min clock-skew clamp + F14 1000-entry cap + F19a future-schema skip) and `MedsManager.onMergeComplete(medId)` (calls `recomputeLastTakenAt` per F4, persists, emits on SyncEngine bus).
js/meds-ui.js                   — Wellness › Meds UI: med cards with live countdown + "since last dose", add/edit form, dose logging, due-time notifications.
js/exercise-ui.js               — Wellness › Exercise UI: 6 workout preset cards (Tabata, HIIT 30/30, HIIT 40/20, EMOM 12, AMRAP 15, Steady 20). Tap applies to the Interval engine and routes to Timers › Interval. Recent Activity reads from History filtered by type='interval'.
js/mindful-ui.js                — Wellness › Mindful UI. Breathing exercises (Box / 4-7-8 / Coherence 5-5 / Calm 6-2-6) with an inline animated circle (per-step CSS transition). Meditation duration presets (3/5/10/15/20 min) that apply to the Timer engine and auto-start on Timers › Timer.
js/wellness-cooking-ui.js       — Wellness › Cooking UI: 8 named cooking presets (Pasta 10m, Rice 20m, Eggs 7m, Steak rest 5m, Oven preheat 10m, Tea steep 3m, Toast 3m, Chicken 25m). Tapping a preset spins up a named timer via the existing Cook mode (`createTimer` + `cookingTimers.push` + `cookingTimerAlarm`), auto-starts it, and routes to Timers › Cook. Recent Activity reads History filtered by type='cooking'. Cap at 8 concurrent timers matches the existing Cook mode.
js/recovery-ui.js               — Wellness › Recovery UI: rest tracking dashboard. Daily sleep log (hours + 1–5 quality), nap tracker (20/30/60/90m presets with inline countdown that plays the BFRB chime on completion), derived "Last focus block: N hours ago" status line + "Focus today: N min" total (from History). Persists to `wellness_rest_log` in localStorage as an object keyed by YYYY-MM-DD.
js/tempo-nav.js                 — Tempo shell: pillar tabs, sub-nav, hash routing, settings drawer.
js/app.js (~350 lines)          — Entry point. Wires all modules. Mode switching, sound toggle, theme picker, export button, PWA install.
sw.js                           — Service worker, cache-first, version-bumped on deploys.
manifest.json                   — PWA manifest, standalone display, shortcuts.
icons/                          — 192px and 512px PNG icons.
```

### Script Load Order
```
utils → dom-utils → stopwatch → timer → instance-manager → pomodoro → flow → interval → persistence → sync-firebase-config → sync-flag → sync-firestore → sync-engine → sync-manual-dedupe → sync-auth → audio → themes → history → export → backup → analog → offset-input → ui → cards-ui → compare-ui → timer-ui → bfrb-recovery → pomodoro-ui → flow-ui → alert-ui → bg-notify → interval-ui → cooking-ui → pomodoro-stats → history-ui → sequence → analytics → focus-ui → sequence-ui → analytics-ui → presets → presets-ui → meds → meds-ui → exercise-ui → mindful-ui → wellness-cooking-ui → recovery-ui → global-bfrb → tempo-nav → app
```

### Key Design Decisions

- **Drift-free timing:** `elapsed = offsetMs + accumulatedMs + (Date.now() - startedAt)`. Never uses setInterval to increment. Always derives from wall clock.
- **Mutable global proxy pattern:** `let Stopwatch = createStopwatch('sw-default')`. When the primary instance is swapped, `Stopwatch` is reassigned — all existing code in ui.js, offset-input.js, etc. automatically operates on the new primary without changes.
- **Persistence across tab close:** On page load, if status was 'running', `getElapsedMs()` auto-corrects because it reads `Date.now() - startedAt`.
- **RAF render loop:** `requestAnimationFrame` for smooth 60fps updates. Only updates the current in-progress lap's text node (not full DOM rebuild). Self-starts on start(), self-stops on pause()/reset(). Mode guards prevent cross-mode interference.
- **Module naming:** `SFX` (not `Audio`) to avoid conflicting with the browser's native `Audio` constructor.
- **No build step:** Script load order in index.html is the dependency graph. Engine modules must load before UI modules which must load before app.js.
- **Shared button handlers:** All modes (stopwatch, timer, pomodoro, flow, interval, cooking) register addEventListener on the same btn-left/btn-right elements. Each handler has an `appMode` guard to short-circuit when not active. Pomodoro also has a click debounce lock.
- **Collapsed panels:** `.offset-input[data-collapsed]` uses a data attribute (not `.hidden` class) to enable CSS max-height transitions.

### State Model

**Stopwatch:** `{ id, name, status: 'idle'|'running'|'paused', offsetMs, startedAt, accumulatedMs, laps[], lapStartMs, alerts[] }`
**Timer:** `{ id, name, status: 'idle'|'running'|'paused'|'finished', durationMs, startedAt, accumulatedMs }`
**Pomodoro:** `{ status: 'idle'|'running'|'paused'|'phaseComplete'|'done', phase: 'work'|'shortBreak'|'longBreak', cycleIndex, totalCycles, workMs, shortBreakMs, longBreakMs, startedAt, accumulatedMs }`
**Flow Block:** `{ status: 'idle'|'running'|'paused'|'focusComplete'|'recovery'|'recoveryPaused'|'done', phase: 'focus'|'recovery', focusDurationMs (5400000|7200000), startedAt, accumulatedMs, sessionStartedAt, focusEndedAt, goal }`
**Medication:** `{ id, name, dose (e.g. "60 mg"), frequency: 'once-daily'|'twice-daily'|'as-needed', lastTakenAt, doseLog[{takenAt}] }`. Managed by `MedsManager` singleton; all meds persist to localStorage under `wellness_meds`. No schedule / no notifications in V2 — logging is always the user's explicit action via "Took it now" or "Took it ~X ago". Status derived from doseLog (`getDosesToday()` / `getStatusToday()`). `loadState` migrates V1 records (schedule-based) to `frequency: 'as-needed'` and drops legacy schedule fields.
**Rest log (Recovery):** localStorage `wellness_rest_log`, an object keyed by `YYYY-MM-DD`. Each day entry has `sleep: { hours, quality? }` (optional) and `naps: [{ startedAt, durationMs, endedEarly? }]`. No engine — `RecoveryUI` reads/writes the log directly and derives "last focus" / "focus today" from `History.getSessions()`.

All stopwatch/timer instances persist to localStorage via `InstanceManager.saveAll()` under key `multi_state`. Pomodoro persists separately under `pomodoro_state` / `pomodoro_config`. Flow Block persists under `flow_state` / `flow_config`. Interval persists under `interval_state`. Sequence persists under `sequence_state` / `sequence_templates`. Cooking timers under `cooking_timers`. Legacy single-instance keys (`stopwatch_state`, `timer_state`) are auto-migrated.

Session history persists to IndexedDB (db `stopwatch_history_db`, store `sessions`). Legacy `stopwatch_history` localStorage entries are migrated into IndexedDB on first load.

Additional localStorage keys used for UI/config preferences:
- `app_mode`, `display_mode`, `lap_display_mode`, `vibrate_interval`, `install_dismissed`
- `sound_muted`, `sound_profile`, `theme`, `bfrb_volume`, `bfrbs_global`, `wellness_rest_log`
- `offset_presets`, `quick_presets`, `presets_seeded`
- `pomo_auto_advance`, `pomodoro_checklist`, `pomodoro_break_checklist`, `pomodoro_actual_work`, `pomodoro_saved_tasks`, `pomodoro_task_templates`, `pomodoro_distractions`, `pomodoro_bfrbs`
- `flow_distractions`, `flow_bfrbs`, `flow_checklist_state`, `flow_checklist_skipped`, `flow_last_saved_session`
- `tempo_sync_enabled` (B-1; cloud-sync feature flag, off by default — separate from `tempo_sync_state` which gates writes in `persistence.js`)
- `tempo_sync_partial_upload_uid` (B-3; mid-upload marker — set on push failure, cleared on success. On retry, if marker matches current user's UID, resume upload instead of routing to Stage D handoff.)
- `tempo_sync_stage_d_handoff` (B-3; flag set when B-3's read-cloud-first guard detects existing cloud data from another device. D-1 will consume this to trigger the imported-bucket migration UI.)
- `tempo_sync_hydrated_rest_log` / `tempo_sync_hydrated_meds` / `tempo_sync_hydrated_presets` / `tempo_sync_hydrated_history` (C-1; per-store hydrate completion markers, set to `'1'` after each cloud-pull store finishes; missing markers trigger re-pull on next boot.)
- `tempo_sync_hydrated_all` (C-1; set to `'1'` after all 4 per-store markers complete. Acts as the short-circuit gate — once set, `SyncEngine.hydrateFromCloud()` is a no-op.)
- `history_hide_imported` (D-1; UI toggle in the History panel filter bar. `'0'` (default) shows imported pre-sync rows; `'1'` filters them out of the rendered list. Only the chip + filter bar are gated on the presence of any imported rows.)
- `bfrb_events` (E-1d-f3; F3 consolidated BFRB stream. Replaces the three legacy buckets (`bfrbs_global` / `flow_bfrbs` / `pomodoro_bfrbs`) as the single source of truth for BFRB sync. Each entry: `{ takenAt, context, sessionId?, phase?, cycleIndex?, deviceId, updatedAt, schemaVersion }`. `context` ∈ `'global'|'flow'|'pomodoro'`. Legacy 3 keys retained for one release pending a deferred cleanup PR — no scheduled removal yet (Pick C on TODO #5).)
- `tempo_bfrb_events_migration_v1` (E-1d-f3; phased-migration idempotency marker. Set to `'1'` once the union+write of legacy buckets into `bfrb_events` completes on first load post-upgrade. Module skips migration on subsequent loads.)
- `flow_distractions` (E-1d-f8; F8 sessionId-keyed map `{ [sessionId]: [entries] }` where each entry is `{ category, note?, timestamp, deviceId, updatedAt, schemaVersion }`. Was a flat array pre-E-1d-f8 — migrated in place under a stable orphan-key fallback for entries without a sessionId. Synced as the 6th store via `js/sync-merge-distractions.js`.)
- `pomodoro_distractions` (E-1d-f8; same shape as `flow_distractions` — sessionId-keyed map. Migrated in place by `js/distractions.js`. Synced as part of the 6th sync store.)
- `tempo_distractions_migration_v1` (E-1d-f8; F8 phased-migration idempotency marker. Set to `'1'` once the legacy-flat-array → sessionId-keyed-map migration completes for both Flow + Pomo on first load post-upgrade. Module skips migration on subsequent loads.)
- `tempo_sync_steady_state_enabled` (**REMOVED in E-1e** — was the dev-only gate that kept steady-state polling dormant during E-1b/c/d. After E-1e, steady-state runs by default for any user with the master flag `tempo_sync_enabled='1'` set, gated on the 4-condition auto-invoke helper (signed-in + flag-on + all-hydrated + no Stage D handoff). Any orphan entry on existing dev installs is harmless — no read sites remain.)

## What Has Been Built

### Phase 1: Polish
- Shared `Utils.formatMs()` (DRY'd time formatting)
- Button micro-interactions (scale 0.92 + colored glow on press)
- Visual running indicator (pulsing green text-shadow + animated gradient bar at top)
- Keyboard shortcuts: Space (start/stop), L (lap), R (reset), Escape (close offset)
- Offset input validation (clamp h:0-99, m:0-59, s:0-59; red flash on invalid; Enter to submit)
- Typography refinement (.centiseconds larger and more legible)
- Lap list auto-scroll (newest lap always visible)
- Service worker cache fix (icons added)

### Phase 2: Enhanced UX
- Lap rendering perf: RAF only updates current lap text, not full innerHTML rebuild
- Lap entry animation: slide-down fade (0.25s ease-out)
- Button state transition animation: scale/fade micro-animation on text change
- Haptic feedback: navigator.vibrate() on start/stop/lap/reset
- Undo reset: toast with "Undo" button, auto-dismiss 5s, restores full state
- Analog clock face: SVG with 60 tick marks, second + minute hands, digital/analog toggle via mode dots
- PWA install prompt: beforeinstallprompt banner with dismiss persistence
- Lap statistics bar: Avg/Best/Worst when 2+ laps exist
- Smooth offset input: auto-advance focus between h/m/s fields

### Phase 3: Feature Expansion
- **Timer mode (countdown):** Segmented "Stopwatch | Timer" control. Progress bar. Notification API + vibration alarm on zero. Display flashes red.
- **Session history:** Saves stopwatch and timer sessions on reset (if elapsed > 1s). Slide-up history panel with date/duration/laps.
- **Export laps:** Copy to clipboard, CSV download, or Web Share API. Button appears when laps exist.
- **Customizable themes:** 6 presets (Auto, Midnight, Ocean, Sunset, Minimal, OLED). Gear icon opens picker. CSS vars applied to documentElement. Persists to localStorage.
- **Sound effects:** Web Audio API synthetic beeps/tones for start, stop, lap, reset, and timer alarm. Speaker icon toggle. Mute preference persisted.

### Phase 4: Major Features
- **Pomodoro mode:** 25/5/15 min work/short break/long break cycles. Configurable durations and cycle count. Phase transitions with alarm, vibration, notifications. Cycle progress dots. Session checklist for tracking goals.
- **Offset presets:** Save/load named offset configs (e.g., "Medication 30:00"). Inline creation flow via "Save as Preset" button. Delete with ✕.
- **Multiple simultaneous timers:** Factory pattern refactor (`createStopwatch(id)`, `createTimer(id)`). Up to 5 stopwatch and 5 timer instances. Compact card UI for non-primary instances. Tap to swap primary. Editable names. InstanceManager handles persistence, creation, deletion.
- **Categories/tags for sessions:** Add/remove tags on history entries. Deduplicated filter bar at top of history panel. Tags persist per session.
- **Notifications at time thresholds:** Set alerts at specific elapsed times on stopwatch (e.g., "alert at 30:00"). Fires Notification API + alarm sound + vibration. Alert chips shown below controls. Persisted per instance.

### Phase 5: UX Improvements
- **Swipe-to-delete laps:** Touch-drag left reveals red "Delete" background. Snap past threshold to delete with undo toast. `deleteLap()` method on engine.
- **History notes:** Tap "+ note" or existing note to edit inline. Persists via `History.updateNote()`.
- **Animated mode switching:** Fade-out/fade-in transition on timer display when switching tabs.
- **Accessibility:** Global `:focus-visible` outlines, `.sr-only` announcer for state changes (start/stop/lap/reset), improved light mode contrast (#636366), aria-labels on interactive elements, semantic aria regions.
- **Better analog face:** Numbers at 5-second intervals, larger on desktop (280px), drop shadows on hands.
- **Desktop layout:** Wider container (720px) at >768px, adjusted spacing.

### Phase 6: Tech Debt Cleanup
- **app.js split:** From 995 lines to 242 lines. Extracted timer-ui.js, pomodoro-ui.js, alert-ui.js, history-ui.js.
- **Offset input hack fixed:** Replaced `.offset-input.hidden` specificity hack with `data-collapsed` attribute.
- **Analog double-init fixed:** Root cause fix with `initialized` flag instead of children.length guard.
- **Clock skew no-op removed:** `accumulatedMs += 0` removed from stopwatch loadState.

### Phase 7: Flow Block Mode
- **Flow Block mode:** Ultradian-rhythm-based deep-work timer. Single 90- or 120-minute focus block (fixed presets) followed by optional 15-minute recovery countdown. Pre-block checklist (5 fixed items: DND, notifications, tabs, water, goal) gates the Start button — can be skipped. Session goal text input. Distraction log (Phone/Email/Interrupted/Self/Other with optional note — separate storage from Pomodoro). **BFRB tally** — one-tap button next to Distraction for logging body-focused repetitive behaviors caught in the moment (cheek chewing, nail biting/picking, skin picking, etc.). Label increments live as `BFRB ×N`, persists to `flow_bfrbs`, clears alongside distractions on session start/reset/complete, and shows as a "BFRB catches" count in both the summary card and the saved history session (`session.bfrbs`). End-of-block summary card shows duration, goal, distraction breakdown, and BFRB count. Recovery phase shows encouragement text. Sessions saved to history with `type: 'flow'`. Persists to `flow_state` / `flow_config` in localStorage. Handles tab-close mid-block (loadState recovery + deduped history save).

### Phase 8: Tempo Rebrand + Wellness Suite (Meds, Exercise, Mindful)
- **Tempo navigation shell** (`js/tempo-nav.js` + `css/tempo-shell.css`): Four-pillar architecture — Timers / Wellness / Rhythm / Analytics. Hash-based routing (`#/timers/pomodoro`, `#/wellness/meds`, etc.) with legacy `?mode=X` migration. Wellness sub-nav has 5 tabs (Meds, Exercise, Mindful, Cooking, Recovery). Pillar accent tokens: productivity blue (`#007aff`), wellness green (`#30d158`) — auto-applied via `data-pillar` attribute on body/app.
- **Meds module (Wellness › Meds — V2, prescription-focused):** Multi-medication tracking (up to 10). Each med has `name`, optional `dose` string (e.g. "60 mg"), and a `frequency` bucket: Once daily / Twice daily / As-needed. **No schedule at setup** — the user tracks *when* they took it, not when they're supposed to. Per-med card shows: bold name + "60 mg · Once daily" subtitle, a **today status** line (`Taken today ✓`, `1 of 2 today`, `Not taken today`, or `Last taken X ago` for as-needed), and the last-dose timestamp (`Last dose at 5:28 PM`). Two log actions per card: **Took it now** (logs `Date.now()`) and **Took it ~** (retroactive offset input — reuses the app's core USP). Status is derived from the `doseLog` ({takenAt} entries) by counting doses falling in the current local calendar day. Edit/delete per med. Persists to `wellness_meds` localStorage key. Clock-skew guard on loadState drops far-future dose entries. `loadState` migrates V1 schedule-based records to `frequency: 'as-needed'` (safe default — no fabricated daily obligation). **38 engine tests** (tests/meds.test.js).
- **Exercise pillar (Wellness › Exercise):** Workout launcher. Six built-in presets: Tabata, HIIT 30/30, HIIT 40/20, EMOM 12, AMRAP 15, Steady 20. Tapping a preset applies its program to the existing `Interval` engine (`Interval.setProgram(...)`) and routes to `#/timers/interval` so the existing Interval UI runs the workout. A `+ Custom` button routes to the same Interval screen with a blank program for user customization. Below the grid, **Recent Activity** reads `History.getSessions()`, filters by `type === 'interval'`, and shows the 5 most recent sessions (name, "Today / Yesterday / date", duration). Interval sessions now include `programName` in the history record so the log shows the actual workout name. No new engine — Exercise is a launcher + log that delegates timing to `js/interval.js`.
- **Mindful pillar (Wellness › Mindful):** Two sections. **Breathing** — four patterns (Box 4-4-4-4, 4-7-8, Coherence 5-5, Calm 6-2-6) with an inline animated circle. Tapping a pattern shows a runner: the circle scales via CSS `transform: scale()` with `transition-duration` set per step, so inhale/hold/exhale drive a smooth tween; a live countdown number and phase label track inside the circle, and a cycle counter increments each full loop. Auto-stops when the user leaves the surface (hashchange or `visibilitychange`). Honors `prefers-reduced-motion` by freezing the circle. **Meditation** — five duration presets (3/5/10/15/20 min). Tap → `Timer.setDuration(...)` + route to Timers › Timer, auto-started. No new engine — breathing is pure DOM animation + setTimeout, meditation reuses the Timer engine.

- **Cooking pillar (Wellness › Cooking):** Quick-launch grid of 8 named cooking presets (Pasta 10m, Rice 20m, Eggs 7m, Steak rest 5m, Oven preheat 10m, Tea steep 3m, Toast 3m, Chicken 25m). Tapping a preset builds a timer via `createTimer`, appends it to the global `cookingTimers` array that the existing Cook mode owns, registers the alarm handler via `cookingTimerAlarm`, calls `timer.start()`, persists with `saveCookingTimers`, and routes to `#/timers/cook`. The existing multi-timer UI in `js/cooking-ui.js` renders and ticks it. Cap at 8 concurrent timers matches `addCookingTimer`'s existing guard — a cap notice appears on the Wellness surface if the user tries to launch a 9th. **Recent Activity** reads `History.getSessions()` filtered by `type === 'cooking'` and shows the 5 most recent finished timers (name, when, duration). Cooking sessions now include `programName` in the history record so the log names the timer ("Pasta · 10m 0s") instead of the generic "Cooking".

### Phase 9: Cloud Sync (Tempo cross-device, Stage E shipped)
- **Cross-device cloud sync via Firebase / Firestore (PRs #46–#72, shipped 2026-04 through 2026-05-15):** 28 sequential PRs across 6 stages (S0 → A → B → C → D → E) landed full bidirectional sync of meds, history, rest_log, presets, BFRB events, and distractions between any signed-in devices. Backend: Firebase project `tempo-sync-6f7b2` (us-central1, Spark plan). Auth via Google sign-in (web + iOS Capacitor via `@capacitor-firebase/authentication`). Storage: per-user UID-scoped Firestore tree (`users/{uid}/{store}/{recordId}`) with a single security rule (`request.auth.uid == userId`). Every synced record carries `deviceId` + `updatedAt` + `schemaVersion` envelope stamps (F10) and is gated through the F19a refuse-writeback contract so downlevel clients can't strip fields they don't recognize. Per-store merge strategies: append-merge with `(deviceId, takenAt)` dedup for doseLog / BFRB events / naps; full-record LWW for meds metadata + presets; sessions append-merge by `id` with per-field LWW on `note` / `tags`; distractions session-keyed map merge. Tombstones via additive `deletedAt` field on presets (no SCHEMA_VERSION bump). Multi-stage flow: Stage B Device A first-push with F12 mandatory local backup; Stage C Device B fresh hydrate in strict order (rest_log → meds → presets → history) gated by `tempo_sync_state='hydrating'`; Stage D imported-bucket handoff for Device B with existing standalone data + `ManualDedupe.scan()` placeholder. Steady-state via 30s `setInterval` polling (E-1e), default-on for any user with `tempo_sync_enabled='1'` after first sign-in completes hydrate; per-store snapshot F19a gate at the dispatcher + per-record cloud-side gate at each merge fn + CAS-level refuse-writeback inside `runTransaction` form three independent layers. Strategy + per-store merge rules: `docs/CLOUD-SYNC-STRATEGY.md` v2.0. Implementation plan: `docs/sync-impl/PLAN.md`. Subagent orchestrator workflow: `.claude/orchestrator-prompt.md` + `.claude/agents/{sync-auditor,engine-implementer,engine-tester,ui-wirer,pr-shipper}.md`. Two-device validation completed 2026-05-15 with PR #72 (E-1e merge): Test 1 laptop→phone ✓, Test 2 phone→laptop ✓, Test 3 tombstone propagation ✓. **543 engine tests** across 6 sync-merge modules + sync-engine + sync-uploader + sync-stamps + sync-hydrate + sync-toast. **Caveats observed at validation, captured under table item #6 below:** (1) polling unreliable when tabs unfocused, (2) Stage D handoff over-fires on manual push, (3) UI doesn't auto-refresh on sync, (4) reconcile-pass log verbosity.

## What's Next — Planned Improvements

### Feature Backlog

Reordered by impact-vs-effort ROI (best return for effort first), not chronologically. The previous chronological numbering is preserved in the "Added" column so the decision history stays visible.

| Priority | Feature | Impact | Effort | Added | Notes |
|----------|---------|--------|--------|-------|-------|
| 1 | **Native iOS app via Capacitor** | High | Medium | #8 | **Status: shipped to personal device (in-progress for App Store).** Capacitor wrapper landed in #45 (commit `72eb338`): `capacitor.config.json` (appId `com.ksdisch.tempo`, appName "Tempo"), committed Xcode project at `ios/`, `js/platform.js` abstraction layer wrapping all 23 haptic call sites + 6 notification sites (web → `navigator.vibrate` / `new Notification`; native → `@capacitor/haptics` + `@capacitor/local-notifications`), `scripts/sync-www.mjs` mirrors repo root → `www/` for `cap copy`. Web build is byte-equivalent — same `git push` → GitHub Pages flow, SW still registers on web only. Engine tests (265 cases) unchanged. **Real haptics now work on iPhone.** Daily workflow + 7-day free-cert refresh playbook lives in `iOS-BUILD.md`. **Remaining for App Store distribution:** $99/yr Apple Developer Program enrollment, App Store Connect record, TestFlight or App Store submission, privacy nutrition labels (meds + BFRB are health data), App Review screenshots, age rating, 1024×1024 app icon polish. **Explicitly out of scope for current build:** `BGTaskScheduler` (not needed — `LocalNotifications` schedules at OS level + engines are drift-free), audio session control (Web Audio still gets cut by music on native — revisit if annoying), Capacitor Preferences migration (`localStorage` survives in `WKWebView`). |
| 2 | **Vibration at intervals** | Low | Low | #4 | Vibrate every N minutes (configurable). Check in RAF loop. Cheap win — small effort, modest payoff. |
| 3 | **Ambient sound auto-start on session start** | Medium | Medium | #9 | Auto-start a focus soundtrack (white/brown/pink noise, rain, named YouTube videos like *Healing Sounds by Otto*) the moment a Flow Block or Pomodoro session begins, so starting a session is one click instead of three. Auto-stop on pause/reset/phase-complete (e.g., when Flow transitions to recovery). Three technical paths, recommended hybrid: **(a) procedural noise** via Web Audio API for white/brown/pink — zero file size, infinite duration, no licensing, leverages existing `js/audio.js` infra; **(b) bundled royalty-free loops** for rain/coffee-shop/forest — small MP3s (~100–300 KB each), reliable offline, no ads; **(c) YouTube IFrame Player API** for user-saved video IDs — free, preserves "Otto's vibe" use case, but caveats: requires user-gesture autoplay (start-session click satisfies it), ads interrupt non-Premium users, iOS Safari throttles iframe audio when tab is backgrounded, videos can be taken down. Settings drawer entry to manage a list of soundtrack presets (name + source type + value), plus a per-mode default ("Flow → brown noise", "Pomodoro work → Otto video, breaks → silent"). Wires into `Flow.start()` / `Pomodoro.start()` callbacks in `js/flow-ui.js` and `js/pomodoro-ui.js`. Volume slider + mute persisted alongside existing `sound_muted` / `bfrb_volume` keys. **Open question:** start with procedural + bundled only (faster to ship, fully offline, no ToS risk) and add YouTube embed in a follow-up, or do all three at once. |
| 4 | **Lap data visualization** | Medium | Medium | #1 | Inline SVG bar chart of lap times below the lap list. No library needed. Color-coded best/worst. |
| 5 | **Rhythm pillar — daily timeline view** | Medium | Medium | #10 | Ship the actual Rhythm pillar instead of the current placeholder surface. Plumbing already exists (route `#/rhythm`, bottom-tab, accent token, placeholder copy in `index.html`). Build per `docs/TEMPO-PLAN.md` §8.10: a new `js/rhythm-engine.js` that aggregates a daily timeline from existing sources — `History.getSessions()` (stopwatch / timer / pomodoro / flow / interval / cooking), `MedsManager` doseLog, stopwatch alert fires, BFRB tallies (`bfrbs_global` / `flow_bfrbs` / `pomodoro_bfrbs`), and rest log naps (`wellness_rest_log`). Entry shape `{ time, type, module, pillar, summary, metadata }` with `type ∈ session-start | session-end | dose-logged | habit-checked | alert-due`. Public API: `getDayTimeline(date)` + `getCurrentDayStatus()` (what's active now, what's coming up). UI (`js/rhythm-ui.js`): vertical day timeline, pillar-colored entries (productivity blue / wellness green via existing `data-pillar` tokens), `< yesterday \| today \| tomorrow >` day-nav header, "right now" line that auto-scrolls into view, tap-to-expand for entry details. **No new persistence — pure read-side aggregation**, so blast radius is small and the pillar grows automatically as new modules emit history. Effort is Medium not Low because each source has a different record shape (interval `programName`, cooking timer name, dose log entries lack a `name` field, alert metadata is per-instance) so the engine needs per-module adapters to normalize into the entry shape. Good first feature to validate the timeline pattern before adding `Time Log Module` (§8.11) for manual entries. |
| 6 | **Cloud sync polish — E-2 + E-3 + UX caveats** | Medium-High | Medium-High | #7 | **Baseline sync substantially shipped (Phase 9 above).** Remaining work in `docs/sync-impl/PLAN.md`: **E-2 (offline buffer)** — `js/sync-buffer.js` pending-op queue in IDB with `originalWallClock` preserved at user-action time + replay-on-`online` event + FIFO drain + 1000-op cap with toast warning + op compaction for chatty fields; required for reliable cross-device sync when a device is offline. **E-3 (real-time `onSnapshot` listeners)** — drops steady-state polling latency from 30s to <1s and fixes the iOS-Safari-suspends-`setInterval` reliability caveat at the source; includes the downlevel-client warning toast for refuse-writeback events. **UX caveats observed at 2026-05-15 two-device validation:** (a) `setInterval` steady-state polling unreliable when tabs unfocused — Chrome throttles, iOS Safari suspends; manual `SyncEngine._runMergeCycle()` is the current escape hatch (E-3 is the proper fix). (b) Stage D handoff re-fires on every manual "Push to cloud" attempt because the B-3 read-cloud-first guard always sees cloud non-empty post-first-push — confusing UX, probably worth distinguishing "first sync" from "force re-sync" with a separate code path. (c) Presets drawer (and likely other surfaces) doesn't auto-refresh on sync — reads localStorage on open, doesn't subscribe to changes; close + reopen required to see new merge results. E-3 listeners + a UI re-render hook fix this together. (d) Reconcile-pass `[SyncEngine] reconcile history sessionId collision (cloud wins)` warnings fire one-per-session (12 with current data) — should be a single summary log in `js/sync-merge-history.js`; small cleanup chore, good warm-up PR. **Stage F (per-store manifest registry, F19c) remains deferred indefinitely** per `PLAN.md` §F-1. |
| 7 | **Split-screen timer comparison** | Medium | High | #2 | Side-by-side two timers. Requires significant layout rework. |
| 8 | **Voice control** | Low | Medium | #3 | Web Speech API SpeechRecognition. Commands: "start", "stop", "lap", "reset". |
| 9 | **Group/team timing** | Low | High | #5 | WebRTC or shared URL with server sync. Major scope expansion — would need a backend. |
| 10 | **Home screen widget** | Low | High | #6 | Platform-specific. PWA limitations make this mostly impractical. Strong candidate for removal from backlog entirely. |

### Remaining Tech Debt

- **Timer button handlers are duplicated:** `onTimerLeft`/`onTimerRight` in timer-ui.js duplicate the button-handling pattern from ui.js's `onLeftClick`/`onRightClick`. Could unify into a shared state machine.
- **Engine tests only:** 114 tests cover stopwatch (30), timer (21), pomodoro (25), and meds (38) engines — run via `tests/index.html` in a browser. No UI/integration tests yet. Flow and Interval engine tests live on feature branches but haven't been merged to main.
- **renderLaps still does full innerHTML on lap events:** The perf optimization (updateCurrentLap) only applies to the RAF tick. When a new lap is recorded, the entire list is still rebuilt. Low impact for typical lap counts.

### If Migrating to ES Modules

If the file count keeps growing, consider migrating from IIFEs/globals to ES modules:
```html
<script type="module" src="js/app.js"></script>
```
Then each module uses `import`/`export`. No bundler needed — browsers support this natively. Benefits: proper dependency graph, tree shaking if you add a bundler later, easier testing.

### Deployment

The app is deployed via GitHub Pages from the `main` branch root. Push to `main` → auto-deploys in ~1 minute.

```bash
git push  # deploys to https://ksdisch.github.io/stopwatch/
```

Service worker cache must be version-bumped (`CACHE_NAME` in sw.js) on every deploy that changes cached files, or users will see stale content until the old SW expires.

### iOS build (Capacitor)

The same web codebase wraps in a Capacitor iOS shell so haptics + scheduled notifications work properly on iPhone. The web build keeps deploying via GitHub Pages unchanged; iOS is a separate target.

```bash
npm install              # one-time: pulls Capacitor + plugins
brew install cocoapods   # one-time: required by `cap add ios`
npx cap add ios          # one-time: scaffolds ios/ Xcode project
npm run ios:open         # everyday: sync www/ → cap copy → open Xcode
```

`scripts/sync-www.mjs` mirrors the static files (`index.html`, `manifest.json`, `sw.js`, `css/`, `js/`, `icons/`) into `www/`, which is what Capacitor copies into the iOS bundle. `www/` is gitignored.

`js/platform.js` is the abstraction layer — `Platform.haptic(pattern)` and `Platform.notify(title, opts)` route to `navigator.vibrate` + `Notification` on web, and to `@capacitor/haptics` + `@capacitor/local-notifications` on native (Capacitor injects `window.Capacitor.Plugins.*` into the WebView, so no bundler is required). All 23 haptic call sites + 6 immediate-notification call sites now go through `Platform`. `BgNotify.schedule` / `BgNotify.cancel` feature-detect internally and route to `LocalNotifications` on native, so existing call sites in `app.js` / `cooking-ui.js` / etc. don't change.

The SW (`sw.js`) is web-only — `js/app.js` skips registration when `Platform.isNative`. On native, scheduled notifications are handled by iOS itself even when the WebView is suspended (this is the whole reason for the wrapper).

Bundle ID is `com.ksdisch.tempo`. App name is `Tempo`. Configured in `capacitor.config.json`. App Store paperwork (developer account, privacy nutrition labels for meds + BFRB, screenshots) is not yet done.

---

## Subagent conventions (orchestrator workflow)

The orchestrator at `.claude/orchestrator-prompt.md` coordinates a sync PR across five specialist subagents in `.claude/agents/` (`sync-auditor`, `engine-implementer`, `engine-tester`, `ui-wirer`, `pr-shipper`). The `ui-wirer` phase (Phase 4) fires only when the audit's affected-files table includes UI surface files (`js/*-ui.js`, `index.html`, `css/*.css`, `js/tempo-nav.js`); otherwise it is skipped and the workflow jumps from tests directly to PR ship. When subagents are dispatched, the following are enforceable rules in addition to everything above.

### Test commands

There is no Node-based test runner. Engine tests live in `tests/*.test.js` and are executed by opening `tests/index.html` in a real browser.

```bash
# from repo root
python3 -m http.server 8765 &
# then open http://localhost:8765/tests/index.html in any browser
# read the pass/fail counts in the rendered output
# stop the server when done:
pkill -f "python3 -m http.server 8765"
```

`curl`-grepping the HTML does NOT execute the tests — it only returns the empty shell. A real browser load is the canonical answer. If a subagent has no browser tool available, it must ask the user to open the URL and paste the pass/fail counts back.

The in-repo test API is `describe(...)`, `it(...)`, `assert(...)`, `assertEqual(...)`, `assertClose(...)`, `assertArrayEqual(...)` — defined in `tests/test-runner.js`.

### Lint / typecheck / build

- **Lint:** none. Vanilla JS, no toolchain.
- **Typecheck:** none.
- **Web build:** none. `index.html` loads `js/*.js` in script order; the script order in `index.html` IS the dependency graph.
- **iOS build:** `npm run sync-www` mirrors repo root → `www/`; `npm run ios:open` runs `cap copy ios && cap open ios`. Subagents should only touch `www/` indirectly via the script.

### Reuse over re-implementation

- HTML-escape: `escapeHtml` from `js/dom-utils.js`. Do NOT re-implement.
- Time formatting: `Utils.formatMs(ms)` from `js/utils.js`. Do NOT re-implement.
- Haptics: `Platform.haptic(pattern)` from `js/platform.js`. Do NOT call `navigator.vibrate` directly.
- Notifications: `Platform.notify(title, opts)` / `BgNotify.schedule(...)`. Do NOT call `new Notification(...)` directly.
- Sync invariant stamping: helpers in `js/schema.js`. ALL writes to synced stores (`meds`, `history`, `rest_log`, `presets`) stamp `deviceId` + `updatedAt` + `schemaVersion` through these helpers.

### Where things live (orchestrator + subagents read from these)

- Audit docs: `docs/sync-impl/audits/<PR-ID>-AUDIT.md` (canonical example: `A-1-AUDIT.md`).
- Per-PR briefs: `docs/sync-impl/prompts/<PR-ID>-PROMPT.md` (canonical example: `S0-1-PROMPT.md`).
- Implementation plan (source of truth): `docs/sync-impl/PLAN.md`.
- Strategy + per-store merge rules: `docs/CLOUD-SYNC-STRATEGY.md` v2.0.
- Backend decision: `docs/sync-review/BACKEND-SELECTION.md`.
- Session log (one entry per Claude session): `docs/SESSION-LOG.md`.
- Orchestrator system prompt: `.claude/orchestrator-prompt.md`.
- Subagent system prompts: `.claude/agents/{sync-auditor,engine-implementer,engine-tester,ui-wirer,pr-shipper}.md`.
- Phase brief template (orchestrator → subagent dispatch): `.claude/templates/phase-brief.md`.

### Service worker cache bump rule

`sw.js` contains a `CACHE_NAME` constant. **Any PR that ships a change to a cached web file (`index.html`, `css/styles.css`, `css/tempo-shell.css`, `manifest.json`, or any `js/*.js`) must bump that version string in the same PR.** The orchestrator's `pr-shipper` handles this — but only when `engine-implementer` reports `sw.js cache-bump needed: yes`.

### Branch + commit conventions for sync PRs

- Branch name: `feat/sync-<pr-id-lowercased>-<short-slug>` (e.g., `feat/sync-b1-uploader`).
- Commit type prefix: `feat` / `refactor` / `fix` / `docs` (matches recent history — see commit `cc363b8`).
- One PR per Stage row in `docs/sync-impl/PLAN.md`. Sequential merge order within a stage.
- `pr-shipper` always pauses before pushing for explicit user approval.

### Known gaps / workflow TODOs

_(None currently open. Resolved gaps are removed from this section once the fix lands; git history preserves the narrative.)_
