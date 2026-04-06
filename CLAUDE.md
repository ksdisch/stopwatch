# Stopwatch PWA — Project Reference

## What This App Is

A cross-platform stopwatch PWA (Progressive Web App) that works on phone and desktop, inspired by the iPhone Clock app's stopwatch. The key differentiator is the ability to **start a stopwatch with time already elapsed** — e.g., "I took my medication ~30 minutes ago, start counting from 30:00 and count up."

**Live:** https://ksdisch.github.io/stopwatch/
**Repo:** https://github.com/ksdisch/stopwatch

## Tech Stack

Vanilla HTML + CSS + JS. No framework, no build step. The entire app is a static folder deployable to any static host. All modules use the IIFE pattern exposing a single global object.

## Architecture

```
index.html                 — App shell, all HTML structure
css/styles.css (761 lines) — All styling, dark/light themes, responsive, animations
js/utils.js                — Utils.formatMs(ms) shared time formatting
js/stopwatch.js            — Stopwatch engine (pure logic, no DOM). Drift-free wall-clock timing.
js/timer.js                — Timer (countdown) engine. Same pattern as Stopwatch.
js/persistence.js          — Persistence.save()/load() via localStorage
js/audio.js                — SFX module. Web Audio API synthetic sounds (no audio files).
js/themes.js               — Themes module. 6 presets, applies CSS vars to :root.
js/history.js              — History module. Session storage in localStorage (last 100).
js/export.js               — Export module. Clipboard, CSV download, Web Share API.
js/analog.js               — Analog clock face. SVG with 60 ticks, rotating hands.
js/offset-input.js         — "Start with time already elapsed" input UI.
js/ui.js (276 lines)       — Main UI: render loop (RAF), button state machine, lap list, lap stats.
js/app.js (452 lines)      — Entry point. Wires all modules. Mode switching, timer UI, theme picker, history panel, export button, sound toggle, PWA install prompt.
sw.js                      — Service worker, cache-first, version-bumped on deploys.
manifest.json              — PWA manifest, standalone display.
icons/                     — 192px and 512px PNG icons.
```

### Key Design Decisions

- **Drift-free timing:** `elapsed = offsetMs + accumulatedMs + (Date.now() - startedAt)`. Never uses setInterval to increment. Always derives from wall clock.
- **Persistence across tab close:** On page load, if status was 'running', `getElapsedMs()` auto-corrects because it reads `Date.now() - startedAt`.
- **RAF render loop:** `requestAnimationFrame` for smooth 60fps updates. Only updates the current in-progress lap's text node (not full DOM rebuild). Self-starts on start(), self-stops on pause()/reset().
- **Module naming:** `SFX` (not `Audio`) to avoid conflicting with the browser's native `Audio` constructor.
- **No build step:** All modules are IIFEs. Script load order in index.html is the dependency graph: utils → stopwatch → timer → persistence → audio → themes → history → export → analog → offset-input → ui → app.

### State Model

**Stopwatch:** `{ status: 'idle'|'running'|'paused', offsetMs, startedAt, accumulatedMs, laps[], lapStartMs }`
**Timer:** `{ status: 'idle'|'running'|'paused'|'finished', durationMs, startedAt, accumulatedMs }`

Both persist to localStorage. Timer state key: `timer_state`. Stopwatch state key: `stopwatch_state`.

## What Has Been Built (Phases 1-3)

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

## What's Next — Planned Improvements

### Feature Backlog (Ranked by Impact / Effort)

| Priority | Feature | Impact | Effort | Notes |
|----------|---------|--------|--------|-------|
| 1 | **Notifications at time thresholds** | High | Low | "Alert me at 30:00". Check in RAF loop, use Notification API. Great for the medication use case. |
| 2 | **Presets** (saved offset configs) | High | Low | Named offsets like "Medication (30 min)", "Laundry (45 min)". Quick-pick list in offset area. Saves to localStorage. |
| 3 | **Pomodoro mode** | High | Medium | 25/5/15 min work/break cycle with auto-transitions. Reuses Timer engine. New "Pomodoro" tab in mode selector. |
| 4 | **Multiple simultaneous timers** | High | High | Refactor Stopwatch from singleton IIFE to factory `createStopwatch(id)`. Primary timer full-screen, secondary timers as compact card rows. Editable names. Persist under keyed localStorage. Limit ~5. This is the biggest refactor — touches stopwatch.js, ui.js, persistence.js, app.js. |
| 5 | **Lap data visualization** | Medium | Medium | Inline SVG bar chart of lap times below the lap list. No library needed. Color-coded best/worst. |
| 6 | **Categories/tags for sessions** | Medium | Low | Tag chips in the session history view. Filterable. Extend History module's session schema. |
| 7 | **Split-screen timer comparison** | Medium | High | Side-by-side two timers. Requires significant layout rework. |
| 8 | **Voice control** | Low | Medium | Web Speech API SpeechRecognition. Commands: "start", "stop", "lap", "reset". |
| 9 | **Vibration at intervals** | Low | Low | Vibrate every N minutes (configurable). Check in RAF loop. |
| 10 | **Group/team timing** | Low | High | WebRTC or shared URL with server sync. Major scope expansion — would need a backend. |
| 11 | **Home screen widget** | Low | High | Platform-specific. PWA limitations make this mostly impractical. |
| 12 | **Pomodoro session checklist** | Medium | Low | Basic goal checklist visible before/during a Pomodoro session. Add/check-off items to stay on track. Persists per session. |

### Known Issues / Tech Debt

- **app.js is too large (452 lines):** The mode-switching, timer UI, history panel, theme picker, and export button logic all live in app.js. Should be broken into dedicated UI modules (e.g., `timer-ui.js`, `history-ui.js`, `theme-ui.js`).
- **Session history uses localStorage:** For 100+ sessions with lap arrays, should migrate to IndexedDB (async, no size limit). Current limit is 100 sessions.
- **Offset input hidden class override:** `.offset-input.hidden` uses `display: flex !important; max-height: 0; opacity: 0` to enable CSS transitions. This is a specificity hack — could be cleaner with a data attribute or separate class.
- **No data migration strategy:** If persisted state shape changes, old localStorage data could break. Should add a version field to stored state.
- **Analog tick marks double-init guard:** `init()` checks `tickGroup.children.length === 0` to prevent duplicate ticks if called twice. Root cause is that `Analog.init()` shouldn't be callable twice.
- **Timer button handlers are duplicated:** `onTimerLeft`/`onTimerRight` in app.js duplicate the button-handling pattern from ui.js's `onLeftClick`/`onRightClick`. Should unify into a shared state machine.
- **No tests:** Modules aren't easily testable. Consider adding a simple test runner or migrating to ES modules with `<script type="module">` for better testability.
- **Clock skew guard is incomplete:** `stopwatch.js` line 87 has `accumulatedMs += 0` which is a no-op. Should just set `startedAt = null` without the pointless addition.
- **renderLaps still does full innerHTML on lap events:** The perf optimization (updateCurrentLap) only applies to the RAF tick. When a new lap is recorded, the entire list is still rebuilt. Could use `insertAdjacentHTML` for the new row and only re-render best/worst highlighting.

### UX Improvements Still Worth Doing

- **Swipe-to-delete laps** with undo
- **Long-press on history session** to add notes/tags
- **Smooth animated transition** when switching between Stopwatch and Timer modes
- **Accessibility audit:** Ensure all interactive elements have proper focus styles, screen reader announces state changes
- **Better analog face:** Add numbers at 5-second intervals, make the face larger on desktop, add a subtle shadow on the hands
- **Desktop layout:** On wide screens (>768px), could show stopwatch and timer side-by-side instead of switching modes

### If Migrating to ES Modules

If the file count keeps growing, consider migrating from IIFEs to ES modules:
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
