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
js/lap-chart.js                 — Lap chart (SCAFFOLD): inline SVG bar chart of lap durations below lap list. Color-coded best/worst.
js/focus-ui.js                  — Focus / ambient display mode (distraction-free full-screen view).
js/presets.js                   — Quick Presets engine: storage, apply (mode + config), migration from offset presets.
js/presets-ui.js                — Presets UI: drawer grid + quick-picks row.
js/history-ui.js                — History panel UI: session list, tag filter bar, tag/note editing, log-past-session form.
js/app.js (~350 lines)          — Entry point. Wires all modules. Mode switching, sound toggle, theme picker, export button, PWA install.
sw.js                           — Service worker, cache-first, version-bumped on deploys.
manifest.json                   — PWA manifest, standalone display, shortcuts.
icons/                          — 192px and 512px PNG icons.
```

### Script Load Order
```
utils → dom-utils → stopwatch → timer → instance-manager → pomodoro → flow → interval → persistence → audio → themes → history → export → analog → offset-input → ui → cards-ui → compare-ui → timer-ui → pomodoro-ui → flow-ui → alert-ui → bg-notify → interval-ui → cooking-ui → pomodoro-stats → history-ui → sequence → analytics → focus-ui → sequence-ui → analytics-ui → lap-chart → presets → presets-ui → app
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

All stopwatch/timer instances persist to localStorage via `InstanceManager.saveAll()` under key `multi_state`. Pomodoro persists separately under `pomodoro_state` / `pomodoro_config`. Flow Block persists under `flow_state` / `flow_config`. Interval persists under `interval_state`. Sequence persists under `sequence_state` / `sequence_templates`. Cooking timers under `cooking_timers`. Legacy single-instance keys (`stopwatch_state`, `timer_state`) are auto-migrated.

Session history persists to IndexedDB (db `stopwatch_history_db`, store `sessions`). Legacy `stopwatch_history` localStorage entries are migrated into IndexedDB on first load.

Additional localStorage keys used for UI/config preferences:
- `app_mode`, `display_mode`, `lap_display_mode`, `vibrate_interval`, `install_dismissed`
- `sound_muted`, `sound_profile`, `theme`
- `offset_presets`, `quick_presets`, `presets_seeded`
- `pomo_auto_advance`, `pomodoro_checklist`, `pomodoro_break_checklist`, `pomodoro_actual_work`, `pomodoro_saved_tasks`, `pomodoro_task_templates`, `pomodoro_distractions`
- `flow_distractions`, `flow_checklist_state`, `flow_checklist_skipped`, `flow_last_saved_session`

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
- **Flow Block mode:** Ultradian-rhythm-based deep-work timer. Single 90- or 120-minute focus block (fixed presets) followed by optional 15-minute recovery countdown. Pre-block checklist (5 fixed items: DND, notifications, tabs, water, goal) gates the Start button — can be skipped. Session goal text input. Distraction log (Phone/Email/Interrupted/Self/Other with optional note — separate storage from Pomodoro). End-of-block summary card shows duration, goal, and distraction breakdown. Recovery phase shows encouragement text. Sessions saved to history with `type: 'flow'`. Persists to `flow_state` / `flow_config` in localStorage. Handles tab-close mid-block (loadState recovery + deduped history save).

## What's Next — Planned Improvements

### In Flight

- **Lap data visualization** *(scaffold, pending human design review)* — Inline SVG bar chart of lap times below the lap list. No library needed. Color-coded best/worst. Scaffold files: `js/lap-chart.js` (stub `LapChart.render/clear/computeStats`), `tests/lap-chart.test.js` (pending `it.skip` stubs), DOM hook `#lap-chart` already exists in `index.html`. Wired into script load order and `sw.js` ASSETS. Implementation not started.

### Feature Backlog

| Priority | Feature | Impact | Effort | Notes |
|----------|---------|--------|--------|-------|
| 1 | **Split-screen timer comparison** | Medium | High | Side-by-side two timers. Requires significant layout rework. |
| 2 | **Voice control** | Low | Medium | Web Speech API SpeechRecognition. Commands: "start", "stop", "lap", "reset". |
| 3 | **Vibration at intervals** | Low | Low | Vibrate every N minutes (configurable). Check in RAF loop. |
| 4 | **Group/team timing** | Low | High | WebRTC or shared URL with server sync. Major scope expansion — would need a backend. |
| 5 | **Home screen widget** | Low | High | Platform-specific. PWA limitations make this mostly impractical. |

### Remaining Tech Debt

- **Timer button handlers are duplicated:** `onTimerLeft`/`onTimerRight` in timer-ui.js duplicate the button-handling pattern from ui.js's `onLeftClick`/`onRightClick`. Could unify into a shared state machine.
- **Engine tests only:** 138 tests cover stopwatch (29), timer (21), pomodoro (27), and interval (61) engines. No UI/integration tests yet.
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
