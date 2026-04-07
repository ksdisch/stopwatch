# Stopwatch PWA Expansion — Claude Code Prompt

Paste everything below the line into your Claude Code session in Cursor's terminal.

---

I want you to formulate a detailed implementation plan for expanding my stopwatch PWA. This is a personal utility app — not a portfolio piece. The goal is to make it the timer app I actually reach for every day instead of the stock phone app. Read the full codebase first (`index.html`, all files in `js/`, `css/`, `sw.js`, `manifest.json`, and `tests/`) before planning anything.

## Current Project State

- ~3,500 lines of vanilla JS across 20 files, no framework, no bundler
- Architecture: factory pattern for stopwatch/timer instances, closure-based encapsulation, centralized InstanceManager supporting up to 5 stopwatches + 5 timers
- Three modes: Stopwatch, Timer, Pomodoro (with checklist goals, configurable work/break cycles)
- Features: analog/digital display, 5 CSS custom property themes with system preference detection, lap tracking with stats/chart/export, offset start (start with time already elapsed), multi-instance cards, split-screen compare view, session history with tags/notes/filtering, vibration intervals, time-based alerts, Web Share API export, swipe-to-delete laps
- PWA: service worker with cache-first strategy, manifest, install prompt
- Persistence: localStorage via thin abstraction layer, legacy data migration
- Rendering: requestAnimationFrame for primary display, 100ms setInterval for background cards
- Accessibility: aria-live regions, screen reader announcements, keyboard shortcuts
- No README, minimal test harness (tests/index.html with no assertion library)

## Features to Implement (in priority order)

### Priority 1: Quick-Launch Preset Cards

**What:** When you open the app, instead of (or in addition to) the current mode tabs, show a grid of saved preset cards. Each card stores a full configuration — mode (stopwatch/timer/pomodoro), duration, alerts, vibration settings, Pomodoro cycle config, offset, and a custom name + optional emoji/icon. Tapping a card loads the full config and starts immediately (or lands on the configured mode ready to start with one tap).

**Why this is Priority 1:** This is the single biggest friction reducer. Right now starting a timer for a specific use case requires: switch to correct mode → configure duration → optionally set alerts/vibration → start. Presets collapse that to one tap.

**Implementation notes:**
- Store presets in localStorage as an array of config objects. Each preset needs: `id`, `name`, `icon` (emoji string), `mode` ("stopwatch" | "timer" | "pomodoro"), and a `config` object whose shape depends on mode (timer: `{durationMs}`, pomodoro: `{workMin, shortBreakMin, longBreakMin, cycles, checklist[]}`, stopwatch: `{offsetMs, alerts[], vibrateIntervalMs}`)
- Render as a card grid above or below the mode tabs. Cards should be visually scannable — emoji + name + mode badge + duration hint
- "Save current as preset" button that captures the current mode's full configuration
- Long-press or swipe to edit/delete presets
- Consider a small set of default presets on first install: "5 min timer", "25 min Pomodoro", "Stopwatch" (blank)
- The offset preset system (`offset-input.js`) already exists — this generalizes that concept across all modes. Decide whether to keep offset presets as a separate system or migrate them into the unified preset system

### Priority 2: Interval / Workout Timer Mode

**What:** A fourth top-level mode (or a sub-mode of Timer) for structured interval sequences. User defines a sequence of named phases with durations, and the app runs through them in order with audio/vibration cues at each transition.

**Why:** No stock timer app does this well as a PWA. This fills the biggest functional gap for fitness use (HIIT, circuit training, run/walk intervals, yoga flows). The existing timer and Pomodoro infrastructure provides most of the building blocks.

**Implementation notes:**
- Data model: an Interval Program is an array of `{name: string, durationMs: number, color?: string}` phases, plus metadata like `{programName, rounds: number (how many times to repeat the full sequence), restBetweenRoundsMs?}`
- Engine: create `interval.js` following the same factory pattern as `stopwatch.js` and `timer.js`. State machine: idle → running (phaseIndex, elapsed within phase) → phase complete (auto-advance + audio cue) → program complete. Support pause/resume across phase boundaries.
- UI: `interval-ui.js` — show current phase name + time remaining prominently, next phase preview below, progress dots or bar showing position in sequence. During setup, a sortable list of phases with add/remove/reorder.
- Reuse `audio.js` for phase transition sounds (different tone than timer completion). Reuse vibration API.
- Built-in templates: "Tabata (20s/10s × 8)", "HIIT 30/30", "Custom". These could also be presets from Priority 1.
- Add "interval" to the mode selector in the top bar. Update `app.js` mode switching logic.
- Integrate with InstanceManager if multi-instance makes sense for intervals (probably not initially — start with single-instance)

### Priority 3: Persistent Background Notifications

**What:** Make timer/Pomodoro/interval completion alerts reliable even when the phone is locked or the browser tab is backgrounded.

**Why:** This is what separates "I actually depend on this app" from "cool but I still use the stock timer." If you can't trust it to alert you, you'll always fall back to the native app.

**Implementation notes:**
- The service worker (`sw.js`) can receive messages from the main thread and fire notifications via `self.registration.showNotification()`. This works even when the tab is backgrounded.
- When a timer starts, post a message to the service worker with the target completion time (absolute timestamp, not relative). The SW sets a `setTimeout` or uses the `alarm` API (if available) to fire the notification.
- Fallback chain: Notification API (SW-triggered) → Notification API (page-triggered) → audio beep → vibration
- Handle the case where the user returns to the tab after a timer completed while backgrounded — show a visual "Timer finished X minutes ago" state rather than the timer sitting at 0:00 with no context
- Request notification permission proactively on first timer use, with a clear explanation of why
- Test thoroughly: tab backgrounded, phone locked, app minimized, multiple timers running

### Priority 4: Cooking Mode (Multi-Timer UX Skin)

**What:** A specialized view of the multi-timer system optimized for kitchen use: large text, high contrast, named timers with big countdown displays, loud distinct alerts per timer.

**Why:** Cooking is one of the most common real-world multi-timer scenarios. The multi-instance system already exists — this is a UX layer on top of it.

**Implementation notes:**
- Could be a fifth mode tab or a toggle within Timer mode
- Render all active timers in a vertical stack with large, glanceable displays (think: readable from 6 feet away while your hands are covered in flour)
- Each timer gets a name input (auto-suggestions: "rice", "pasta", "chicken", "veggies", "oven", etc.)
- Distinct alert sounds per timer so you know which one finished without looking
- "Add another timer" button always visible at the bottom
- Quick-set buttons for common cooking times: 1, 3, 5, 10, 15, 20, 30 min
- No need for the analog display, lap tracking, or other stopwatch-specific UI in this view — keep it stripped down

### Priority 5: Pomodoro Stats & Streaks

**What:** A stats view accessible from the Pomodoro mode showing: completed cycles this week, total deep work minutes, current streak (consecutive days with at least one completed Pomodoro), and a simple weekly heatmap or bar chart.

**Implementation notes:**
- Extend `history.js` to tag Pomodoro sessions with structured metadata: `{type: "pomodoro", completedCycles: number, totalWorkMs: number, date: string}`
- New `pomodoro-stats.js` engine that queries history and computes aggregates
- UI: a slide-up panel (similar to history panel) with the stats. Keep it lightweight — this should motivate, not overwhelm. A streak counter + "X cycles this week" + small bar chart of daily minutes is plenty.
- Streak logic: a day counts if at least one full work cycle was completed. Streak breaks if a day is missed.

### Priority 6: Dog Walk / Puppy Training Presets

**What:** Not a separate feature — just a set of thoughtfully designed default presets (from Priority 1) for dog-related timing. These should be available out of the box or easily importable.

**Examples:**
- "Milhouse Crate" — Timer, 15 min (with a note to gradually increase)
- "Louis Walk" — Stopwatch with 30-min vibration alert
- "Puppy Potty" — Timer, 45 min (repeating reminder cycle)
- "Training Session" — Timer, 10 min with 2-min interval vibrations

### Priority 7: PWA Shortcut Integration

**What:** Add a `shortcuts` array to `manifest.json` so long-pressing the app icon on the home screen shows quick actions like "Start Stopwatch", "Start Pomodoro", "Start Timer".

**Implementation notes:**
- `manifest.json` supports a `shortcuts` array with `name`, `short_name`, `url`, and `icons`
- Each shortcut URL should include a query parameter or hash that `app.js` reads on load to auto-select the mode (e.g., `./index.html?mode=pomodoro`)
- This is a small change with high usability impact

## Existing Issues to Fix Along the Way

Address these as you encounter the relevant code during feature work — don't make a separate pass:

1. **Input validation** — `timer.js`'s `setDuration()` accepts negative values, `pomodoro.js`'s `configure()` doesn't validate cycle counts, offset fields lack bounds checking. Add guard clauses.
2. **localStorage error handling** — `persistence.js` doesn't handle quota exceeded, access denied (private browsing), or malformed JSON. Wrap in try/catch.
3. **DOM query caching** — `ui.js`, `cards-ui.js`, `history-ui.js` call querySelector inside render loops. Cache element references at init.
4. **Service worker cache** — Hard-coded ASSETS array with no cache invalidation. Consider a version hash or network-first strategy for the HTML entry point.
5. **Code duplication** — Time formatting and escapeHtml are repeated across files. Extract to a shared `dom-utils.js`.

## Constraints

- Stay vanilla JS — no framework, no TypeScript, no bundler. This is a deliberate choice. The app should remain a single `index.html` entry point with script tags.
- Follow the existing patterns: factory functions for engines, IIFE modules for UI, InstanceManager for coordination, localStorage for persistence.
- Mobile-first — this gets used on a phone. Touch targets, legibility, one-handed operation.
- PWA integrity — everything must work offline after first load. Update the service worker cache list when adding new files.
- Keep the file structure flat under `js/` — one file per module, named `{feature}.js` for engines and `{feature}-ui.js` for UI layers.

## Deliverable

Create a phased implementation plan. For each phase:
1. Which files are created or modified
2. What the data model / state changes look like
3. Key implementation decisions and tradeoffs
4. Testing approach
5. Estimated complexity (S/M/L)

Group the priorities into logical phases where features build on each other (e.g., presets should land before dog-walk presets, interval mode should land before workout preset templates). Identify any architectural changes needed to support multiple features (e.g., if the preset system and interval mode both need changes to InstanceManager, plan those together).
