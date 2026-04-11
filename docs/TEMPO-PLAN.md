# Tempo: Personal Productivity & Wellness Platform

## Build Plan & Architecture Reference

**Version:** 1.1
**Last Updated:** 2026-04-10
**Status:** Pre-implementation planning (audited post-April 2026 feature session)

---

## Table of Contents

1. [Vision & Product Identity](#1-vision--product-identity)
2. [Architecture Overview](#2-architecture-overview)
3. [Target Directory Structure](#3-target-directory-structure)
4. [Migration Strategy: Stopwatch to Module](#4-migration-strategy-stopwatch-to-module)
5. [Core Platform Layer](#5-core-platform-layer)
6. [Module Contract & Lifecycle](#6-module-contract--lifecycle)
7. [Data Layer & Schema](#7-data-layer--schema)
8. [Module Specifications](#8-module-specifications)
9. [Shared Components](#9-shared-components)
10. [Navigation & Routing](#10-navigation--routing)
11. [Styling & Theming](#11-styling--theming)
12. [PWA & Service Worker](#12-pwa--service-worker)
13. [Testing Strategy](#13-testing-strategy)
14. [Implementation Phases & Roadmap](#14-implementation-phases--roadmap)
15. [Key Decisions Log](#15-key-decisions-log)
16. [Risk Register](#16-risk-register)
17. [Appendix A: Current Codebase Inventory](#appendix-a-current-codebase-inventory)
18. [Appendix B: localStorage Key Migration Map](#appendix-b-localstorage-key-migration-map)
19. [Appendix C: Current Module Public APIs](#appendix-c-current-module-public-apis)

---

## 1. Vision & Product Identity

### Core Thesis

How you spend your time and how you take care of yourself are the same problem. Productivity tools ignore health. Health apps ignore workflow. **Tempo** treats them as two sides of one coin: your daily rhythm.

### Product Name

**Tempo** - Personal Productivity & Wellness Dashboard

### Differentiator

The "start with time already elapsed" offset feature is rare across all timing apps. In Tempo, this becomes a first-class platform capability used by both pillars:
- **Productivity:** "I started working ~20 min ago"
- **Wellness:** "I took my medication ~45 min ago"

### Two Co-Equal Pillars

| Productivity Pillar | Wellness Pillar |
|---|---|
| Stopwatch / Timer (existing) | Medications & Reminders |
| Pomodoro (existing) | Exercise Timing (existing interval/HIIT) |
| Time Logging | Mindfulness & Breathing |
| Habits & Streaks | Cooking Mode (existing) |
| Focus Mode | Recovery & Rest Tracking |

### Shared Layer (serves both pillars equally)

- Analytics Dashboard (unified cross-pillar insights)
- Daily Rhythm View (timeline merging both pillars)
- Notifications & Alerts Engine
- Data Layer (IndexedDB)
- App Shell, Themes, Export

---

## 2. Architecture Overview

### High-Level Architecture

```
+--------------------------------------------------------------------+
|                          APP SHELL                                  |
|  [Nav Bar]  [Settings]  [Theme Engine]  [PWA Install]              |
+--------------------------------------------------------------------+
|                                                                     |
|  +---------------------------+  +-------------------------------+   |
|  |   PRODUCTIVITY PILLAR     |  |     WELLNESS PILLAR           |   |
|  |                           |  |                               |   |
|  |  +-------+ +----------+  |  |  +----------+ +-----------+   |   |
|  |  |Stopwch| | Pomodoro |  |  |  |  Meds    | | Exercise  |   |   |
|  |  +-------+ +----------+  |  |  +----------+ +-----------+   |   |
|  |  +-------+ +----------+  |  |  +----------+ +-----------+   |   |
|  |  | Timer | | Time Log |  |  |  |Mindful   | | Cooking   |   |   |
|  |  +-------+ +----------+  |  |  +----------+ +-----------+   |   |
|  |  +-------+               |  |  +----------+                 |   |
|  |  | Habits|               |  |  | Recovery |                 |   |
|  |  +-------+               |  |  +----------+                 |   |
|  +---------------------------+  +-------------------------------+   |
|                                                                     |
+--------------------------------------------------------------------+
|                        SHARED LAYER                                 |
|  [Analytics]  [Rhythm View]  [Notifications]  [Export]             |
+--------------------------------------------------------------------+
|                       CORE PLATFORM                                 |
|  [Event Bus]  [Store/IndexedDB]  [Router]  [Offset Engine]        |
|  [Timing Engine]  [Notification Service]  [Utils]                  |
+--------------------------------------------------------------------+
```

### Key Architectural Principles

1. **ES Modules** - Native browser `import`/`export`. No bundler. No build step. Same static-deploy philosophy as the current stopwatch.
2. **Module isolation** - Each module registers with the shell via a standard contract. Modules communicate only through the event bus.
3. **Shared engines** - The offset engine, timing engine, and notification service are extracted from the current stopwatch code and made available to all modules.
4. **Progressive enhancement** - Start with stopwatch + one wellness module. Add modules incrementally. Each module is independently useful.
5. **Data-first** - IndexedDB with a unified schema designed for cross-pillar analytics queries from day one.

### Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| Language | Vanilla JS (ES2022+) | No framework overhead, same philosophy as current project |
| Modules | ES Modules (native) | `import`/`export`, browser-native, no bundler needed |
| UI | DOM manipulation + shared component helpers | Consistent with current approach, lightweight |
| Data | IndexedDB (via thin wrapper) | Async, no size limits, supports complex queries |
| Styling | CSS Custom Properties + per-module stylesheets | Extends current theme system |
| PWA | Service Worker (cache-first) | Extends current SW approach |
| Routing | Hash-based client-side router | No server needed, works with GitHub Pages |
| Testing | Existing test runner + module-level tests | Extend current 74-test engine suite |
| Deploy | GitHub Pages from `main` branch | Same as current |

---

## 3. Target Directory Structure

```
tempo/
├── index.html                        # Single app shell HTML
├── manifest.json                     # PWA manifest (updated for Tempo)
├── sw.js                             # Service worker (dynamic module-aware caching)
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
│
├── core/                             # Shared platform infrastructure
│   ├── event-bus.js                  # Pub/sub for cross-module communication
│   ├── store.js                      # IndexedDB wrapper with typed accessors
│   ├── router.js                     # Hash-based client-side router
│   ├── offset-engine.js              # Extracted from offset-input.js — shared offset primitive
│   ├── timing-engine.js              # Base timing logic (wall-clock, drift-free)
│   ├── notification-service.js       # Unified: Web Audio, Vibration, Push, Visual
│   ├── utils.js                      # formatMs, escapeHtml, debounce, etc.
│   └── dom-utils.js                  # DOM helpers, component base patterns
│
├── shell/                            # App shell UI
│   ├── nav.js                        # Bottom/top navigation bar
│   ├── settings.js                   # Global settings panel (theme, sound, notifications)
│   ├── theme-engine.js               # Generalized from current themes.js
│   ├── install.js                    # PWA install prompt logic
│   └── app.js                        # Bootstrap, module registration, init
│
├── modules/                          # Feature modules
│   ├── productivity/
│   │   ├── stopwatch/
│   │   │   ├── stopwatch-engine.js   # createStopwatch(id) factory (from stopwatch.js)
│   │   │   ├── instance-manager.js   # Multi-instance management (from instance-manager.js)
│   │   │   ├── stopwatch-ui.js       # Main stopwatch display + RAF loop (from ui.js)
│   │   │   ├── cards-ui.js           # Secondary instance cards (from cards-ui.js)
│   │   │   ├── compare-ui.js         # Split-screen comparison (from compare-ui.js)
│   │   │   ├── analog.js             # Analog clock face (from analog.js)
│   │   │   ├── offset-input.js       # Offset input UI (wraps core/offset-engine.js)
│   │   │   ├── alert-ui.js           # Alert management UI (from alert-ui.js)
│   │   │   ├── lap-chart.js          # Lap bar chart (extracted from ui.js)
│   │   │   ├── export.js             # Lap export (from export.js)
│   │   │   └── index.js              # Module entry: register, lifecycle hooks
│   │   │
│   │   ├── timer/
│   │   │   ├── timer-engine.js       # createTimer(id) factory (from timer.js)
│   │   │   ├── timer-ui.js           # Timer mode UI (from timer-ui.js)
│   │   │   └── index.js              # Module entry
│   │   │
│   │   ├── pomodoro/
│   │   │   ├── pomodoro-engine.js    # Pomodoro state machine (from pomodoro.js)
│   │   │   ├── pomodoro-ui.js        # Pomodoro UI (from pomodoro-ui.js)
│   │   │   ├── pomodoro-stats.js     # Stats/streaks (from pomodoro-stats.js)
│   │   │   └── index.js              # Module entry
│   │   │
│   │   ├── habits/
│   │   │   ├── habits-engine.js      # Streak calc, frequency tracking, check-ins
│   │   │   ├── habits-ui.js          # Check-in UI, calendar heatmap, streak display
│   │   │   └── index.js              # Module entry
│   │   │
│   │   └── time-log/
│   │       ├── time-log-engine.js    # Manual time entry, category management
│   │       ├── time-log-ui.js        # Timeline view, daily/weekly summaries
│   │       └── index.js              # Module entry
│   │
│   ├── wellness/
│   │   ├── medications/
│   │   │   ├── meds-engine.js        # Dose tracking, schedule calc, adherence
│   │   │   ├── meds-ui.js            # Dose logging UI, next-dose countdown, offset
│   │   │   └── index.js              # Module entry
│   │   │
│   │   ├── exercise/
│   │   │   ├── interval-engine.js    # Interval/HIIT engine (from interval.js)
│   │   │   ├── exercise-ui.js        # Workout UI (from interval-ui.js + templates)
│   │   │   └── index.js              # Module entry
│   │   │
│   │   ├── mindfulness/
│   │   │   ├── mindfulness-engine.js # Breathing patterns, meditation timing
│   │   │   ├── mindfulness-ui.js     # Breathing animation, meditation UI
│   │   │   └── index.js              # Module entry
│   │   │
│   │   ├── cooking/
│   │   │   ├── cooking-engine.js     # Multi-timer management (from cooking-ui.js logic)
│   │   │   ├── cooking-ui.js         # Cooking timers UI (from cooking-ui.js)
│   │   │   └── index.js              # Module entry
│   │   │
│   │   └── recovery/
│   │       ├── recovery-engine.js    # Rest tracking, cooldown calculations
│   │       ├── recovery-ui.js        # Recovery countdown, rest day tracking
│   │       └── index.js              # Module entry
│   │
│   └── shared/
│       ├── analytics/
│       │   ├── analytics-engine.js   # Aggregation queries over IndexedDB
│       │   ├── charts.js             # SVG chart rendering (bar, line, heatmap)
│       │   ├── analytics-ui.js       # Dashboard layout, date range, filters
│       │   └── index.js              # Module entry
│       │
│       ├── rhythm/
│       │   ├── rhythm-engine.js      # Daily timeline assembly from all modules
│       │   ├── rhythm-ui.js          # Timeline view, day navigation
│       │   └── index.js              # Module entry
│       │
│       └── history/
│           ├── history-engine.js     # Session storage, tag management (from history.js)
│           ├── history-ui.js         # Session list, filters, notes (from history-ui.js)
│           └── index.js              # Module entry
│
├── css/
│   ├── tokens.css                    # Design tokens (colors, spacing, typography, shadows)
│   ├── shell.css                     # App shell styles (nav, settings, install banner)
│   ├── shared.css                    # Shared component styles (buttons, inputs, toasts, cards)
│   └── modules/                      # Per-module stylesheets
│       ├── stopwatch.css
│       ├── timer.css
│       ├── pomodoro.css
│       ├── habits.css
│       ├── time-log.css
│       ├── medications.css
│       ├── exercise.css
│       ├── mindfulness.css
│       ├── cooking.css
│       ├── recovery.css
│       ├── analytics.css
│       ├── rhythm.css
│       └── history.css
│
├── tests/
│   ├── core/
│   │   ├── event-bus.test.js
│   │   ├── store.test.js
│   │   ├── router.test.js
│   │   ├── offset-engine.test.js
│   │   └── timing-engine.test.js
│   ├── modules/
│   │   ├── stopwatch-engine.test.js  # Migrated from existing tests
│   │   ├── timer-engine.test.js      # Migrated from existing tests
│   │   ├── pomodoro-engine.test.js   # Migrated from existing tests
│   │   ├── interval-engine.test.js
│   │   ├── meds-engine.test.js
│   │   ├── habits-engine.test.js
│   │   └── mindfulness-engine.test.js
│   └── test-runner.html
│
└── docs/
    ├── TEMPO-PLAN.md                 # This document
    └── stopwatch-expansion-prompt.md # Original brainstorming prompt
```

---

## 4. Migration Strategy: Stopwatch to Module

This is the most critical phase. The existing stopwatch codebase must be restructured without breaking any functionality.

### 4.1 Migration Principles

1. **No functionality loss** - Every existing feature must work identically after migration
2. **Incremental migration** - Move one module at a time, keeping the app functional at each step
3. **Data continuity** - Existing localStorage data must be auto-migrated to IndexedDB on first load
4. **URL continuity** - Existing PWA shortcuts and bookmarks must continue to work

### 4.2 Step-by-Step Migration Plan

#### Step 1: Introduce ES Modules (Non-Breaking)

Convert existing files from IIFEs/globals to ES modules one at a time. Start from the leaf modules (no dependents) and work up.

**Migration order (bottom-up from dependency graph):**

```
1. utils.js          → core/utils.js           (export { formatMs })
2. dom-utils.js      → core/dom-utils.js       (export { escapeHtml })
3. audio.js          → (keep in shell or core)  (export SFX)
4. themes.js         → shell/theme-engine.js    (export Themes)
5. export.js         → modules/productivity/stopwatch/export.js
6. history.js        → modules/shared/history/history-engine.js
7. stopwatch.js      → modules/productivity/stopwatch/stopwatch-engine.js
8. timer.js          → modules/productivity/timer/timer-engine.js
9. pomodoro.js       → modules/productivity/pomodoro/pomodoro-engine.js
10. interval.js      → modules/wellness/exercise/interval-engine.js
11. instance-manager.js → modules/productivity/stopwatch/instance-manager.js
12. persistence.js   → REMOVED (replaced by core/store.js)
13. analog.js        → modules/productivity/stopwatch/analog.js
14. offset-input.js  → Split: core/offset-engine.js + modules/.../offset-input.js
15. bg-notify.js     → core/notification-service.js (merged)
```

**For each file migration:**
```js
// BEFORE (global IIFE):
const SFX = (() => {
  // ...
  return { playStart, playStop, playLap, playReset, playAlarm, ... };
})();

// AFTER (ES module):
// core/audio.js
let ctx = null;
let muted = false; // Will be initialized from store

function getCtx() { /* same */ }
function beep(freq, duration, type = 'sine') { /* same */ }

export function playStart() { /* same */ }
export function playStop() { /* same */ }
// ... etc

export function isMuted() { return muted; }
export function toggleMute() { /* same, but persist via store instead of localStorage */ }
export function init(storedMuted) { muted = storedMuted; }
```

#### Step 2: Introduce Core Platform

Build the core layer modules that all feature modules will depend on:

1. `core/event-bus.js` - New
2. `core/store.js` - New (replaces all direct localStorage calls)
3. `core/router.js` - New
4. `core/offset-engine.js` - Extracted from `offset-input.js`
5. `core/timing-engine.js` - Extracted from shared patterns in stopwatch/timer/pomodoro
6. `core/notification-service.js` - Merged from `bg-notify.js` + notification patterns scattered across UI files

#### Step 3: Build App Shell

1. Create `index.html` with the new structure (pillar-based nav)
2. Create `shell/app.js` as the new entry point
3. Create `shell/nav.js` for navigation
4. Migrate `shell/theme-engine.js` from current themes.js
5. Migrate install logic to `shell/install.js`

#### Step 4: Wrap Stopwatch as Module

Move all stopwatch-related code into `modules/productivity/stopwatch/` and create `index.js` with the module registration contract.

#### Step 5: Wrap Remaining Existing Modes as Modules

- Timer → `modules/productivity/timer/`
- Pomodoro → `modules/productivity/pomodoro/`
- Interval → `modules/wellness/exercise/`
- Cooking → `modules/wellness/cooking/`

#### Step 6: Build New Modules

One at a time, in priority order defined in the roadmap.

### 4.3 Global Variable Elimination

The current codebase relies on mutable globals (`Stopwatch`, `Timer`, `appMode`). The migration plan:

| Current Global | Replacement |
|---|---|
| `Stopwatch` (reassigned by InstanceManager) | Each module holds its own reference; InstanceManager uses getter pattern |
| `Timer` (reassigned by InstanceManager) | Same as above |
| `Pomodoro` (singleton IIFE) | ES module with named exports |
| `Interval` (singleton IIFE) | ES module with named exports |
| `appMode` (string) | Router state: `router.getCurrentRoute()` |
| `SFX` (singleton IIFE) | ES module import: `import * as SFX from '../../core/audio.js'` |
| `Themes` (singleton IIFE) | ES module import |
| `History` (singleton IIFE) | ES module import |
| `Persistence` (singleton IIFE) | Replaced by `core/store.js` |
| `Utils` (singleton IIFE) | ES module import |
| `OffsetInput` (singleton IIFE) | Split into engine (core) + UI component (module) |
| `BgNotify` (singleton IIFE) | Merged into `core/notification-service.js` |
| `UI` (singleton IIFE) | Module-scoped, not global |
| `CardsUI`, `PresetsUI`, etc. | Module-scoped, not global |

---

## 5. Core Platform Layer

### 5.1 Event Bus (`core/event-bus.js`)

Central pub/sub for cross-module communication. Modules never import each other directly.

```js
// core/event-bus.js
const listeners = new Map();

export function on(event, callback) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(callback);
  return () => listeners.get(event).delete(callback); // returns unsubscribe fn
}

export function emit(event, data) {
  const handlers = listeners.get(event);
  if (handlers) handlers.forEach(cb => cb(data));
}

export function off(event, callback) {
  const handlers = listeners.get(event);
  if (handlers) handlers.delete(callback);
}
```

**Standard event naming convention:** `pillar:module:action`

| Event | Emitted By | Consumed By | Payload |
|---|---|---|---|
| `productivity:stopwatch:session-complete` | Stopwatch | Analytics, History, Habits | `{ duration, laps, tags, instanceId }` |
| `productivity:timer:finished` | Timer | Analytics, History | `{ duration, name }` |
| `productivity:pomodoro:phase-complete` | Pomodoro | Analytics, History, Habits | `{ phase, cycleIndex, totalCycles }` |
| `productivity:pomodoro:set-complete` | Pomodoro | Analytics, Habits | `{ completedCycles, totalWorkMs }` |
| `wellness:medication:dose-logged` | Medications | Analytics, Rhythm, Habits | `{ medName, takenAt, nextDueAt }` |
| `wellness:medication:dose-due` | Medications | Notifications | `{ medName, dueAt }` |
| `wellness:exercise:workout-complete` | Exercise | Analytics, Rhythm, Recovery | `{ type, duration, program }` |
| `wellness:mindfulness:session-complete` | Mindfulness | Analytics, Rhythm | `{ type, duration, mood? }` |
| `wellness:cooking:timer-finished` | Cooking | Notifications | `{ timerName }` |
| `shared:analytics:data-requested` | Analytics | All modules | `{ dateRange, modules[] }` |
| `shell:mode-changed` | Router/Nav | All modules | `{ from, to }` |
| `shell:theme-changed` | Theme Engine | All modules | `{ themeId }` |

### 5.2 Store (`core/store.js`)

Thin IndexedDB wrapper providing typed access. Replaces all direct localStorage calls.

> **NOTE (2026-04-10):** Session history has already been migrated to IndexedDB in the current codebase (`stopwatch_history_db` database, `sessions` store, `id` keyPath). The Tempo migration must handle migrating from this *existing* IndexedDB database to the new unified `tempo` database — not from localStorage. The existing `History.init()` and `History.getSessions()` async patterns can be reused. See the updated Appendix B for the revised migration map.

```js
// core/store.js
const DB_NAME = 'tempo';
const DB_VERSION = 1;

let db = null;

export async function init() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Sessions store (cross-pillar)
      const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
      sessions.createIndex('pillar', 'pillar');
      sessions.createIndex('module', 'module');
      sessions.createIndex('startedAt', 'startedAt');
      sessions.createIndex('pillar_startedAt', ['pillar', 'startedAt']);

      // Active state store (replaces localStorage for running timers)
      db.createObjectStore('activeState', { keyPath: 'key' });

      // Settings store
      db.createObjectStore('settings', { keyPath: 'key' });

      // Medications store
      const meds = db.createObjectStore('medications', { keyPath: 'id' });
      meds.createIndex('name', 'name');

      // Habits store
      const habits = db.createObjectStore('habits', { keyPath: 'id' });
      habits.createIndex('name', 'name');

      // Presets store
      db.createObjectStore('presets', { keyPath: 'id' });
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = () => reject(request.error);
  });
}

// ── Typed Accessors ──

export async function addSession(session) { /* put to 'sessions' store */ }
export async function getSessions(filter) { /* query 'sessions' with optional index filter */ }
export async function getSessionsByDateRange(start, end) { /* range query on startedAt index */ }
export async function getSessionsByPillar(pillar, dateRange) { /* compound index query */ }

export async function saveActiveState(key, state) { /* put to 'activeState' */ }
export async function loadActiveState(key) { /* get from 'activeState' */ }

export async function saveSetting(key, value) { /* put to 'settings' */ }
export async function loadSetting(key, defaultValue) { /* get from 'settings' */ }
export async function loadAllSettings() { /* getAll from 'settings' */ }

// ── Migration Helper ──

export async function migrateToTempo() {
  // Two-phase migration:
  // 1. Migrate from existing IndexedDB (stopwatch_history_db) → new Tempo sessions store
  // 2. Migrate remaining localStorage keys → Tempo activeState/settings stores
  //
  // The stopwatch_history_db was created in the April 2026 IndexedDB migration.
  // Sessions there have: id, date, type, duration, laps, note, tags, plus
  // pomodoro-specific fields (completedCycles, totalWorkMs, focusGoals,
  // breakTasks, actualWork, distractions, sessionStartedAt, sessionEndedAt, phaseLog).

  const migrated = await loadSetting('migrated_to_tempo');
  if (migrated) return;

  // Phase 1: Migrate sessions from existing IndexedDB
  try {
    const oldDb = await new Promise((resolve, reject) => {
      const req = indexedDB.open('stopwatch_history_db', 1);
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => resolve(null); // DB may not exist
    });
    if (oldDb) {
      const tx = oldDb.transaction('sessions', 'readonly');
      const store = tx.objectStore('sessions');
      const allSessions = await new Promise((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
      oldDb.close();
      for (const session of allSessions) {
        const pillarMap = { stopwatch: 'productivity', timer: 'productivity', pomodoro: 'productivity',
                           interval: 'wellness', cooking: 'wellness', sequence: 'productivity' };
        await addSession({
          ...session,
          pillar: pillarMap[session.type] || 'productivity',
          module: session.type,
          startedAt: session.sessionStartedAt || new Date(session.date).getTime(),
        });
      }
    }
  } catch (e) { /* old DB doesn't exist, skip */ }

  // Phase 2: Migrate localStorage keys
  const multiState = localStorage.getItem('multi_state');
  if (multiState) await saveActiveState('multi_state', JSON.parse(multiState));

  const settingsKeys = ['theme', 'sound_muted', 'sound_profile', 'display_mode',
    'vibrate_interval', 'install_dismissed', 'lap_display_mode', 'pomo_auto_advance'];
  for (const key of settingsKeys) {
    const value = localStorage.getItem(key);
    if (value !== null) await saveSetting(key, value);
  }

  const stateKeys = ['pomodoro_state', 'pomodoro_config', 'pomodoro_checklist',
    'pomodoro_break_checklist', 'pomodoro_actual_work', 'pomodoro_saved_tasks',
    'pomodoro_task_templates', 'pomodoro_distractions', 'interval_state',
    'cooking_timers', 'quick_presets', 'sequence_state', 'sequence_templates'];
  for (const key of stateKeys) {
    const val = localStorage.getItem(key);
    if (val) await saveActiveState(key, JSON.parse(val));
  }

  await saveSetting('migrated_to_tempo', true);
  // Do NOT delete old data yet — keep as fallback for one version
}
```

### 5.3 Router (`core/router.js`)

Hash-based client-side routing. Each module registers its routes.

```js
// core/router.js
const routes = new Map();
let currentRoute = null;
let currentModule = null;

export function register(path, module) {
  routes.set(path, module);
}

export function navigate(path) {
  window.location.hash = path;
}

export function getCurrentRoute() {
  return currentRoute;
}

export function getCurrentModule() {
  return currentModule;
}

export function init() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute(); // Handle initial route
}

function handleRoute() {
  const hash = window.location.hash.slice(1) || '/timers'; // default
  const module = routes.get(hash);

  if (currentModule && currentModule.deactivate) {
    currentModule.deactivate();
  }

  currentRoute = hash;
  currentModule = module;

  if (module && module.activate) {
    module.activate();
  }

  // Emit route change event
  import('./event-bus.js').then(bus => {
    bus.emit('shell:mode-changed', { route: hash });
  });
}
```

**Route map:**

| Hash | Module | Pillar Tab |
|---|---|---|
| `#/timers` (default) | Stopwatch | Timers |
| `#/timers/countdown` | Timer | Timers |
| `#/timers/pomodoro` | Pomodoro | Timers |
| `#/wellness` | Medications (default wellness) | Wellness |
| `#/wellness/exercise` | Exercise | Wellness |
| `#/wellness/mindfulness` | Mindfulness | Wellness |
| `#/wellness/cooking` | Cooking | Wellness |
| `#/wellness/recovery` | Recovery | Wellness |
| `#/rhythm` | Daily Rhythm | Rhythm |
| `#/analytics` | Analytics | Analytics |
| `#/history` | History (overlay) | Any |

### 5.4 Offset Engine (`core/offset-engine.js`)

Extracted from the current `offset-input.js`. The pure logic of "start with time already elapsed" as a reusable primitive.

```js
// core/offset-engine.js

/**
 * Parse h/m/s values into milliseconds, with validation and clamping.
 */
export function parseToMs(hours, minutes, seconds) {
  const h = Math.min(99, Math.max(0, parseInt(hours, 10) || 0));
  const m = Math.min(59, Math.max(0, parseInt(minutes, 10) || 0));
  const s = Math.min(59, Math.max(0, parseInt(seconds, 10) || 0));
  return (h * 3600 + m * 60 + s) * 1000;
}

/**
 * Format milliseconds back into { hours, minutes, seconds } for display.
 */
export function msToComponents(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return { hours, minutes, seconds };
}

/**
 * Calculate the offset milliseconds given a "taken at" timestamp.
 * e.g., "I took my medication at 2:30 PM" → offset = Date.now() - thatTimestamp
 */
export function calculateOffsetFromTimestamp(timestamp) {
  return Math.max(0, Date.now() - timestamp);
}

/**
 * Calculate next-due time given a dose interval.
 * e.g., taken at 2:30 PM, every 4 hours → next due at 6:30 PM
 */
export function calculateNextDue(takenAt, intervalMs) {
  return takenAt + intervalMs;
}
```

### 5.5 Timing Engine (`core/timing-engine.js`)

The shared drift-free wall-clock timing pattern used by stopwatch, timer, pomodoro, interval, and all new timing modules.

```js
// core/timing-engine.js

/**
 * Create a base timing context. All timing modules build on this.
 * Encapsulates: startedAt, accumulatedMs, status, wall-clock calculation.
 */
export function createTimingContext() {
  let startedAt = null;
  let accumulatedMs = 0;
  let status = 'idle'; // 'idle' | 'running' | 'paused'

  function getElapsedMs() {
    let elapsed = accumulatedMs;
    if (status === 'running' && startedAt !== null) {
      elapsed += Date.now() - startedAt;
    }
    return Math.max(0, elapsed);
  }

  function start() {
    if (status === 'running') return false;
    startedAt = Date.now();
    status = 'running';
    return true;
  }

  function pause() {
    if (status !== 'running') return false;
    accumulatedMs += Date.now() - startedAt;
    startedAt = null;
    status = 'paused';
    return true;
  }

  function reset() {
    status = 'idle';
    startedAt = null;
    accumulatedMs = 0;
  }

  function getStatus() { return status; }

  function getState() {
    return { startedAt, accumulatedMs, status };
  }

  function loadState(state) {
    if (!state) return;
    startedAt = state.startedAt ?? null;
    accumulatedMs = state.accumulatedMs ?? 0;
    status = state.status ?? 'idle';

    // Clock skew guard
    if (status === 'running' && startedAt && startedAt > Date.now()) {
      startedAt = null;
      status = 'paused';
    }
  }

  return { getElapsedMs, start, pause, reset, getStatus, getState, loadState };
}
```

### 5.6 Notification Service (`core/notification-service.js`)

Unified notification system merging audio (SFX), vibration, push notifications, and visual feedback.

```js
// core/notification-service.js

import * as store from './store.js';

let audioCtx = null;
let muted = false;

// ── Audio (from current audio.js) ──

function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function beep(freq, duration, type = 'sine') {
  if (muted) return;
  try {
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration / 1000);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + duration / 1000);
  } catch (e) { /* audio not available */ }
}

// Named sound presets
export const sounds = {
  start:       () => { beep(800, 60); setTimeout(() => beep(1200, 60), 70); },
  stop:        () => { beep(1200, 60); setTimeout(() => beep(800, 60), 70); },
  lap:         () => { beep(1000, 50); },
  reset:       () => { beep(400, 30, 'triangle'); },
  alarm:       () => { beep(800, 150); setTimeout(() => beep(1000, 150), 200); setTimeout(() => beep(1200, 300), 400); },
  phaseChange: () => { beep(1100, 80); setTimeout(() => beep(1400, 80), 100); },
  gentle:      () => { beep(440, 200, 'sine'); }, // For mindfulness
  doseDue:     () => { beep(600, 100); setTimeout(() => beep(800, 100), 150); setTimeout(() => beep(600, 100), 300); },
};

// ── Vibration ──

export function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

// Named vibration presets
export const vibrations = {
  tap:    () => vibrate(10),
  press:  () => vibrate(25),
  alert:  () => vibrate([200, 100, 200, 100, 200]),
  gentle: () => vibrate([100, 50, 100]),
};

// ── Push Notifications (via Service Worker) ──

export function requestPermission() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

export function scheduleBackground(id, delayMs, title, body) {
  if (delayMs <= 0) return;
  requestPermission();
  const sw = navigator.serviceWorker?.controller;
  if (sw) {
    sw.postMessage({ type: 'scheduleNotification', id, delayMs, title, body });
  }
}

export function cancelBackground(id) {
  const sw = navigator.serviceWorker?.controller;
  if (sw) {
    sw.postMessage({ type: 'cancelNotification', id });
  }
}

export function showImmediate(title, body) {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}

// ── Unified notify() ──

export function notify({ sound, vibratePattern, pushTitle, pushBody, scheduleId, delayMs }) {
  if (sound && sounds[sound]) sounds[sound]();
  if (vibratePattern && vibrations[vibratePattern]) vibrations[vibratePattern]();
  if (pushTitle) {
    if (delayMs && scheduleId) {
      scheduleBackground(scheduleId, delayMs, pushTitle, pushBody);
    } else {
      showImmediate(pushTitle, pushBody || '');
    }
  }
}

// ── Mute Control ──

export function isMuted() { return muted; }
export async function toggleMute() {
  muted = !muted;
  await store.saveSetting('sound_muted', muted ? '1' : '0');
  return muted;
}
export function setMuted(val) { muted = val; }
```

---

## 6. Module Contract & Lifecycle

Every module exports a registration object from its `index.js`:

```js
// modules/productivity/stopwatch/index.js

import { createStopwatch } from './stopwatch-engine.js';
import { initStopwatchUI, activateStopwatch, deactivateStopwatch } from './stopwatch-ui.js';
import * as eventBus from '../../../core/event-bus.js';
import * as store from '../../../core/store.js';

export default {
  // ── Identity ──
  id: 'stopwatch',
  name: 'Stopwatch',
  pillar: 'productivity',
  icon: '⏱',

  // ── Routing ──
  routes: ['#/timers'],          // Primary route(s) this module handles
  navGroup: 'timers',             // Which nav tab this appears under
  navPosition: 0,                 // Order within the nav group

  // ── Capabilities ──
  capabilities: ['timing', 'laps', 'alerts', 'offset', 'multi-instance'],

  // ── Lifecycle ──

  /**
   * Called once at app boot. Initialize engines, load persisted state,
   * subscribe to events. DOM may not be ready yet — don't query elements.
   */
  async init(platform) {
    // platform = { store, eventBus, notify, router }
    const savedState = await store.loadActiveState('multi_state');
    // Restore instances from saved state...
    // Subscribe to events from other modules...
  },

  /**
   * Called when this module's route is navigated to.
   * Start RAF loops, attach DOM handlers, show UI.
   */
  activate() {
    initStopwatchUI();
    activateStopwatch();
  },

  /**
   * Called when navigating away from this module's route.
   * Stop RAF loops, detach handlers, clean up.
   */
  deactivate() {
    deactivateStopwatch();
  },

  /**
   * Called on app shutdown (rare in PWA context).
   * Persist final state, clean up resources.
   */
  async destroy() {
    await store.saveActiveState('multi_state', getFullState());
  },

  // ── Data Contract ──

  /**
   * Returns session data for analytics aggregation.
   * Called by the analytics module to gather cross-pillar data.
   */
  async getSessionData(dateRange) {
    return store.getSessions({
      module: 'stopwatch',
      startedAt: { gte: dateRange.start, lte: dateRange.end },
    });
  },
};
```

### Lifecycle Flow

```
App Boot
  │
  ├── core/store.init()          ← Open IndexedDB
  ├── core/store.migrateFromLocalStorage()  ← One-time migration
  ├── core/router.init()         ← Start listening to hash changes
  │
  ├── For each registered module:
  │     └── module.init(platform) ← Load state, subscribe to events
  │
  └── router.handleRoute()       ← Activate the module for current hash
        │
        ├── previousModule.deactivate()  ← Stop RAF, hide UI
        └── currentModule.activate()     ← Start RAF, show UI
```

---

## 7. Data Layer & Schema

### 7.1 IndexedDB Object Stores

#### `sessions` Store

The unified session record for all completed activities across both pillars.

```js
{
  id: 'sess_1712534400000_abc',   // Unique ID
  pillar: 'productivity',          // 'productivity' | 'wellness'
  module: 'stopwatch',             // Source module ID
  type: 'stopwatch',               // Specific type within module
  startedAt: 1712534400000,        // Unix timestamp (ms)
  duration: 185230,                // Duration in ms
  tags: ['morning', 'workout'],    // User-applied tags
  note: 'Great focus session',     // Optional user note
  laps: [                          // Optional (stopwatch only)
    { lapMs: 32100, totalMs: 32100 },
    { lapMs: 28500, totalMs: 60600 },
  ],
  metadata: {                      // Module-specific extra data
    // Stopwatch: { offsetMs, alertsFired }
    // Pomodoro: { completedCycles, totalWorkMs, phase }
    // Timer: { originalDuration }
    // Medication: { medName, doseAmount, nextDueAt }
    // Exercise: { programName, rounds, phases }
    // Mindfulness: { breathingPattern, mood }
  },
}
```

**Indexes:**
- `pillar` — Filter by productivity or wellness
- `module` — Filter by specific module
- `startedAt` — Date range queries
- `['pillar', 'startedAt']` — Compound: "all wellness sessions this week"

#### `activeState` Store

Replaces localStorage for persisting running timer state, instance configs, etc.

```js
{
  key: 'multi_state',              // String key
  value: {                          // Any serializable value
    stopwatches: [ /* instance states */ ],
    timers: [ /* instance states */ ],
    primaryStopwatchId: 'sw-default',
    primaryTimerId: 'tm-default',
  },
}
```

**Keys used:**
| Key | Content |
|---|---|
| `multi_state` | All stopwatch/timer instance states |
| `pomodoro_state` | Pomodoro progress |
| `pomodoro_config` | Pomodoro settings |
| `pomodoro_checklist` | Pomodoro goals |
| `interval_state` | Interval training state |
| `cooking_timers` | Cooking timer states |
| `medications` | Active medication schedules |
| `offset_presets` | Saved offset presets |

#### `settings` Store

App-wide preferences. Replaces the scattered localStorage settings.

```js
{ key: 'theme', value: 'midnight' }
{ key: 'sound_muted', value: '0' }
{ key: 'display_mode', value: 'digital' }
{ key: 'vibrate_interval', value: '0' }
{ key: 'install_dismissed', value: '1' }
{ key: 'app_mode', value: 'stopwatch' }      // Legacy, maps to hash route
{ key: 'migrated_from_localstorage', value: true }
```

#### `medications` Store

Active medication schedules (wellness pillar).

```js
{
  id: 'med_abc123',
  name: 'Ibuprofen',
  dosage: '200mg',                  // Free text
  intervalMs: 14400000,             // 4 hours
  maxDailyDoses: 6,
  createdAt: 1712534400000,
  active: true,
  doses: [                          // Recent dose log (last 30 days)
    { takenAt: 1712534400000, note: '' },
    { takenAt: 1712548800000, note: 'With food' },
  ],
}
```

#### `habits` Store

Habit definitions and check-in history.

```js
{
  id: 'hab_xyz789',
  name: 'Meditate',
  pillar: 'wellness',               // Which pillar this habit belongs to
  frequency: 'daily',               // 'daily' | 'weekly' | 'custom'
  targetPerPeriod: 1,               // How many times per frequency period
  createdAt: 1712534400000,
  currentStreak: 7,
  longestStreak: 14,
  checkIns: [                       // Date-keyed check-ins
    { date: '2026-04-01', count: 1, linkedSessionId: 'sess_...' },
    { date: '2026-04-02', count: 1, linkedSessionId: null },
  ],
}
```

#### `presets` Store

Offset presets (migrated from current localStorage key).

```js
{
  id: 'pre_abc',
  name: 'Medication 30min',
  ms: 1800000,
  module: 'stopwatch',              // Which module uses this preset
  createdAt: 1712534400000,
}
```

### 7.2 Cross-Pillar Query Examples

```js
// "Show me everything I did today"
const today = new Date(); today.setHours(0,0,0,0);
const sessions = await store.getSessionsByDateRange(today.getTime(), Date.now());

// "Show me all wellness activity this week"
const weekAgo = Date.now() - 7 * 86400000;
const wellness = await store.getSessionsByPillar('wellness', { start: weekAgo, end: Date.now() });

// "How many pomodoro cycles did I complete this month?"
const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
const pomodoros = await store.getSessions({
  module: 'pomodoro',
  startedAt: { gte: monthStart.getTime() },
});
const totalCycles = pomodoros.reduce((sum, s) => sum + (s.metadata?.completedCycles || 0), 0);
```

---

## 8. Module Specifications

### 8.1 Stopwatch Module (Existing → Migrated)

**Source:** Current `stopwatch.js`, `ui.js`, `cards-ui.js`, `compare-ui.js`, `analog.js`, `offset-input.js`, `alert-ui.js`, `export.js`

**Changes from current:**
- Factory function `createStopwatch(id)` remains unchanged in logic
- `InstanceManager` stays mostly unchanged but persists via `store.saveActiveState()` instead of `localStorage.setItem()`
- `UI.syncUI()` stays the same but is scoped to this module's activate/deactivate lifecycle
- RAF loop management unchanged
- All direct `localStorage` calls replaced with `store.*` calls
- Emits `productivity:stopwatch:session-complete` on reset (instead of the polling `setInterval` in current `app.js`)
- Global `Stopwatch` variable replaced with module-scoped reference managed by `InstanceManager`

**Route:** `#/timers` (default)

### 8.2 Timer Module (Existing → Migrated)

**Source:** Current `timer.js`, `timer-ui.js`

**Changes from current:**
- Factory function `createTimer(id)` unchanged
- Timer UI initialization scoped to activate/deactivate
- Emits `productivity:timer:finished` when alarm fires
- Shares `InstanceManager` with stopwatch module (both manage multi-instance)

**Route:** `#/timers/countdown`

### 8.3 Pomodoro Module (Existing → Migrated)

**Source:** Current `pomodoro.js`, `pomodoro-ui.js`, `pomodoro-stats.js`

**Changes from current:**
- Singleton pattern converted to ES module exports
- Emits `productivity:pomodoro:phase-complete` and `productivity:pomodoro:set-complete`
- Checklist feature stays as-is
- Stats panel becomes part of analytics dashboard query

**Route:** `#/timers/pomodoro`

### 8.4 Medications Module (New)

The first new wellness module and the strongest showcase of the offset feature.

**Engine (`meds-engine.js`):**

```
State per medication:
{
  id, name, dosage (free text),
  intervalMs,            // Time between doses (e.g., 4 hours)
  maxDailyDoses,         // Safety cap
  doses: [{takenAt, note}],  // Recent dose history
  active: boolean,
}

Core operations:
- addMedication(name, dosage, intervalMs, maxDailyDoses)
- removeMedication(id)
- logDose(medId, takenAt?)        // takenAt defaults to Date.now(), can be offset
- getNextDueTime(medId)           // takenAt + intervalMs
- getRemainingMs(medId)           // nextDue - Date.now()
- getDosesToday(medId)            // Count of doses with takenAt in today's date range
- canTakeNow(medId)               // remainingMs <= 0 AND dosesToday < maxDailyDoses
- getAdherenceStreak(medId)       // Consecutive days with at least one dose
- getMedications()                // All active medications
```

**UI (`meds-ui.js`):**
- Card for each medication showing: name, dosage, last taken ago, next due countdown
- "Log Dose" button per med (big, prominent)
- "Took it X ago" offset input (reuses `core/offset-engine.js`)
- Next-dose countdown timer (reuses timer display pattern)
- Alert when next dose is due (reuses notification service)
- "Add Medication" flow: name, dosage, interval picker, max daily doses
- Adherence streak display

**Integration points:**
- Emits `wellness:medication:dose-logged` → consumed by Analytics, Rhythm, Habits
- Emits `wellness:medication:dose-due` → consumed by Notification Service
- Uses `core/offset-engine.js` for "took it X ago" calculation

**Route:** `#/wellness`

### 8.5 Exercise Module (Existing → Migrated + Enhanced)

**Source:** Current `interval.js`, `interval-ui.js`

**Enhancements:**
- Renamed from "Interval" to "Exercise" for broader scope
- Add workout template library (Tabata, HIIT, Yoga, Stretching — extends existing 3 templates)
- Post-workout session logging with program details
- Emits `wellness:exercise:workout-complete`

**Route:** `#/wellness/exercise`

### 8.6 Mindfulness Module (New)

**Engine (`mindfulness-engine.js`):**

```
Breathing patterns (timed phase sequences, reuses timing-engine.js pattern):
- Box Breathing: 4s inhale → 4s hold → 4s exhale → 4s hold
- 4-7-8 Breathing: 4s inhale → 7s hold → 8s exhale
- Calm Breathing: 4s inhale → 6s exhale
- Custom: user-defined phase durations

Meditation timer:
- Simple countdown with gentle alarm
- Optional interval bells (every N minutes)

State:
{
  mode: 'breathing' | 'meditation',
  pattern: { name, phases: [{action, durationMs}] },
  phaseIndex, cycleIndex, totalCycles,
  // Inherits from createTimingContext()
}
```

**UI (`mindfulness-ui.js`):**
- Breathing animation: expanding/contracting circle synchronized to phase timing
- Phase instruction text: "Inhale...", "Hold...", "Exhale..."
- Pattern picker
- Meditation timer: minimal UI, just countdown + optional interval bells
- Post-session mood/energy tag (optional, stored in session metadata)

**Route:** `#/wellness/mindfulness`

### 8.7 Cooking Module (Existing → Migrated)

**Source:** Current `cooking-ui.js`

**Changes:**
- Separated into engine + UI files
- Persists via `store.saveActiveState('cooking_timers')` instead of localStorage

**Route:** `#/wellness/cooking`

### 8.8 Habits Module (New)

**Engine (`habits-engine.js`):**

```
State per habit:
{
  id, name, pillar,
  frequency: 'daily' | 'weekly',
  targetPerPeriod,
  currentStreak, longestStreak,
  checkIns: [{date, count, linkedSessionId?}],
}

Core operations:
- addHabit(name, pillar, frequency, target)
- removeHabit(id)
- checkIn(habitId, date?, linkedSessionId?)  // Manual or auto-linked
- getStreak(habitId)
- getCompletionRate(habitId, days)  // e.g., "completed 5/7 days this week"
- getTodayStatus(habitId)          // {done, remaining}
```

**Auto-linking via events:**
- Subscribes to `productivity:pomodoro:set-complete` → auto-checks "Focus" habit
- Subscribes to `wellness:exercise:workout-complete` → auto-checks "Exercise" habit
- Subscribes to `wellness:medication:dose-logged` → auto-checks "Take medication" habit
- Subscribes to `wellness:mindfulness:session-complete` → auto-checks "Meditate" habit

**UI (`habits-ui.js`):**
- Habit list with today's status (done/pending)
- Streak counter per habit
- Calendar heatmap (GitHub contribution graph style, 12-week view)
- Add/edit habit form
- Manual check-in toggle

**Route:** Sub-section within Analytics or its own route (TBD)

### 8.9 Analytics Module (New)

**Engine (`analytics-engine.js`):**

```
Query functions:
- getDailySummary(date)           // All sessions grouped by module
- getWeeklySummary(weekStart)     // Totals per module per day
- getPillarBreakdown(dateRange)   // Time spent per pillar
- getModuleBreakdown(dateRange)   // Time spent per module
- getStreaks(module?)              // Longest streak per module
- getTrends(module, weeks)        // Week-over-week comparison
```

**Charts (`charts.js`):**
- Bar chart (daily session durations)
- Stacked bar (pillar breakdown per day)
- Line chart (trends over weeks)
- Calendar heatmap (activity density)

All charts rendered as inline SVG — no chart library.

**UI (`analytics-ui.js`):**
- Date range picker (today, this week, this month, custom)
- Pillar toggle (All / Productivity / Wellness)
- Summary cards: total time, session count, streak
- Charts section
- Module-level drill-down

**Route:** `#/analytics`

### 8.10 Rhythm Module (New)

**Engine (`rhythm-engine.js`):**

```
Assembles a daily timeline from all modules' session data.

Timeline entry:
{
  time: 1712534400000,      // Timestamp
  type: 'session-start' | 'session-end' | 'dose-logged' | 'habit-checked' | 'alert-due',
  module: 'stopwatch',
  pillar: 'productivity',
  summary: 'Pomodoro work session (25:00)',
  metadata: { ... },
}

Core operations:
- getDayTimeline(date)     // All entries for a date, sorted by time
- getCurrentDayStatus()    // What's active right now, what's coming up
```

**UI (`rhythm-ui.js`):**
- Vertical timeline for the day
- Color-coded by pillar (productivity = blue tones, wellness = green tones)
- Tap entry to see details
- Day navigation (< yesterday | today | tomorrow >)
- "Right now" indicator showing current time position in timeline

**Route:** `#/rhythm`

### 8.11 Time Log Module (New)

**Engine (`time-log-engine.js`):**

```
Manual time entry for activities not captured by timers.

Entry:
{
  id, category, description,
  startedAt, duration,
  pillar: 'productivity' | 'wellness',
}

Categories (user-defined):
- Default: Work, Meeting, Learning, Personal, Health

Core operations:
- addEntry(category, description, startedAt, duration)
- getEntries(dateRange, category?)
- getCategories()
- addCategory(name, pillar)
```

**Route:** Sub-section of Timers or its own route (TBD)

### 8.12 Recovery Module (New)

**Engine (`recovery-engine.js`):**

```
Rest tracking between exercise sessions.

State:
{
  recoveryTimers: [
    {
      id, exerciseType, startedAt,
      recommendedRestMs,     // e.g., 48 hours for legs
      note,
    }
  ],
}

Core operations:
- startRecovery(exerciseType, recommendedRestMs)
- getRemainingMs(id)
- isRecovered(id)           // remainingMs <= 0
- getActiveRecoveries()
```

**Auto-triggered:** Subscribes to `wellness:exercise:workout-complete`, auto-starts recovery countdown based on workout type.

**Route:** `#/wellness/recovery`

---

## 9. Shared Components

Reusable UI patterns extracted from the current codebase and generalized.

### 9.1 Time Input Component

Extracted from the current offset-input pattern (h/m/s fields with validation, auto-advance).

Used by: Stopwatch offset, Timer duration, Alert time, Medication interval, Exercise phase duration.

```js
// Conceptual API
function createTimeInput(container, { onSubmit, onCancel, maxHours = 99 }) {
  // Renders three number inputs (h/m/s) with validation
  // Returns { getMs(), setMs(ms), show(), hide(), destroy() }
}
```

### 9.2 Toast Component

Extracted from current undo-toast pattern.

```js
function showToast(message, { action, actionLabel, duration = 5000 }) {
  // Renders toast with optional action button
  // Auto-dismisses after duration
  // Returns { dismiss() }
}
```

### 9.3 Progress Bar

Extracted from current timer progress bar.

```js
function createProgressBar(container, { color, animated = true }) {
  // Returns { setProgress(0-1), setPulsing(bool), destroy() }
}
```

### 9.4 Card Component

Extracted from current cards-ui pattern.

```js
function createCard(container, { title, subtitle, statusColor, onClick, onDelete }) {
  // Returns { update(props), destroy() }
}
```

### 9.5 Slide-Up Panel

Extracted from current history-panel / presets-drawer pattern.

```js
function createPanel(container, { title, onClose }) {
  // Returns { show(), hide(), setContent(html), destroy() }
}
```

---

## 10. Navigation & Routing

### Navigation Layout

```
+--------------------------------------------------+
|  [Settings]  [Sound]  [History]                   |  ← Top actions bar
+--------------------------------------------------+
|                                                    |
|              [ Module Content Area ]               |
|                                                    |
+--------------------------------------------------+
|  [Timers]  [Wellness]  [Rhythm]  [Analytics]      |  ← Bottom nav bar
+--------------------------------------------------+
```

### Sub-Navigation

When a bottom nav tab is active, a secondary nav appears for modules within that pillar:

**Timers tab:**
```
[ Stopwatch | Timer | Pomodoro ]     ← Sub-nav (like current mode tabs)
```

**Wellness tab:**
```
[ Meds | Exercise | Mindful | Cook | Recovery ]
```

**Rhythm and Analytics:** No sub-nav (single view each).

### Route-to-Module Mapping

```js
const moduleRoutes = {
  // Timers pillar
  '#/timers':            'stopwatch',      // Default for Timers tab
  '#/timers/countdown':  'timer',
  '#/timers/pomodoro':   'pomodoro',

  // Wellness pillar
  '#/wellness':          'medications',    // Default for Wellness tab
  '#/wellness/exercise': 'exercise',
  '#/wellness/mindful':  'mindfulness',
  '#/wellness/cooking':  'cooking',
  '#/wellness/recovery': 'recovery',

  // Shared
  '#/rhythm':            'rhythm',
  '#/analytics':         'analytics',
};
```

### Legacy URL Support

Current PWA shortcuts use `?mode=stopwatch`, `?mode=timer`, etc. The app shell must handle this:

```js
// shell/app.js — during init
const urlParams = new URLSearchParams(window.location.search);
const legacyMode = urlParams.get('mode');
if (legacyMode) {
  const legacyMap = {
    'stopwatch': '#/timers',
    'timer':     '#/timers/countdown',
    'pomodoro':  '#/timers/pomodoro',
    'interval':  '#/wellness/exercise',
    'cooking':   '#/wellness/cooking',
  };
  const newHash = legacyMap[legacyMode] || '#/timers';
  window.history.replaceState({}, '', window.location.pathname + newHash);
}
```

---

## 11. Styling & Theming

### Design Token System (`css/tokens.css`)

Extends the current CSS custom properties with a structured token system:

```css
:root {
  /* ── Spacing ── */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;

  /* ── Typography ── */
  --font-mono: -apple-system, BlinkMacSystemFont, 'SF Mono', monospace;
  --font-size-xs: 11px;
  --font-size-sm: 13px;
  --font-size-md: 15px;
  --font-size-lg: 20px;
  --font-size-xl: 28px;
  --font-size-display: 48px;

  /* ── Colors (existing, unchanged) ── */
  --bg: #000000;
  --text: #ffffff;
  --text-secondary: #8e8e93;
  --green: #30d158;
  --green-dark: #0a3d1a;
  --red: #ff453a;
  --red-dark: #3d0f0c;
  --btn-bg: #1c1c1e;
  --btn-border: #38383a;
  --separator: #38383a;
  --lap-best: #30d158;
  --lap-worst: #ff453a;

  /* ── Pillar Accent Colors (new) ── */
  --productivity-accent: #007aff;      /* Blue family */
  --productivity-accent-dim: #0a2a5e;
  --wellness-accent: #30d158;          /* Green family */
  --wellness-accent-dim: #0a3d1a;

  /* ── Component Tokens ── */
  --card-bg: var(--btn-bg);
  --card-border: var(--btn-border);
  --card-radius: 12px;
  --input-bg: var(--btn-bg);
  --input-border: var(--btn-border);
  --toast-bg: #2c2c2e;

  /* ── Animation ── */
  --transition-fast: 80ms ease;
  --transition-normal: 150ms ease;
  --transition-slow: 300ms ease-out;

  /* ── Shadows ── */
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.4);
}
```

### Pillar Visual Differentiation

Subtle accent differences between pillars, achieved via CSS class on the content area:

```css
[data-pillar="productivity"] {
  --active-accent: var(--productivity-accent);
  --active-accent-dim: var(--productivity-accent-dim);
}

[data-pillar="wellness"] {
  --active-accent: var(--wellness-accent);
  --active-accent-dim: var(--wellness-accent-dim);
}
```

Applied via: `document.getElementById('content').dataset.pillar = 'wellness'` on route change.

### Theme Presets (Unchanged)

All 6 existing themes remain. The `theme-engine.js` applies CSS vars to `:root` exactly as current `themes.js` does. Pillar accents are derived from each theme's base palette.

### Per-Module Stylesheets

Each module has its own CSS file loaded in `index.html`. Styles are scoped via module-specific class names or data attributes:

```css
/* css/modules/medications.css */
.meds-card { /* ... */ }
.meds-dose-btn { /* ... */ }
.meds-countdown { /* ... */ }
```

---

## 12. PWA & Service Worker

### Updated Manifest

```json
{
  "name": "Tempo",
  "short_name": "Tempo",
  "description": "Personal productivity and wellness dashboard",
  "start_url": "./index.html#/timers",
  "display": "standalone",
  "background_color": "#000000",
  "theme_color": "#000000",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "shortcuts": [
    { "name": "Stopwatch", "url": "./index.html#/timers", "icons": [{"src": "icons/icon-192.png", "sizes": "192x192"}] },
    { "name": "Timer",     "url": "./index.html#/timers/countdown", "icons": [{"src": "icons/icon-192.png", "sizes": "192x192"}] },
    { "name": "Pomodoro",  "url": "./index.html#/timers/pomodoro", "icons": [{"src": "icons/icon-192.png", "sizes": "192x192"}] },
    { "name": "Meds",      "url": "./index.html#/wellness", "icons": [{"src": "icons/icon-192.png", "sizes": "192x192"}] },
    { "name": "Exercise",  "url": "./index.html#/wellness/exercise", "icons": [{"src": "icons/icon-192.png", "sizes": "192x192"}] }
  ]
}
```

### Service Worker Updates

The current service worker uses a hard-coded `ASSETS` array. With modules, this needs to be maintainable:

```js
// sw.js
const CACHE_NAME = 'tempo-v1';

// Organized by layer for maintainability
const CORE_ASSETS = [
  './', './index.html', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png',
  './core/event-bus.js', './core/store.js', './core/router.js',
  './core/offset-engine.js', './core/timing-engine.js',
  './core/notification-service.js', './core/utils.js', './core/dom-utils.js',
];

const SHELL_ASSETS = [
  './shell/app.js', './shell/nav.js', './shell/settings.js',
  './shell/theme-engine.js', './shell/install.js',
];

const CSS_ASSETS = [
  './css/tokens.css', './css/shell.css', './css/shared.css',
  './css/modules/stopwatch.css', './css/modules/timer.css',
  './css/modules/pomodoro.css', './css/modules/medications.css',
  './css/modules/exercise.css', './css/modules/mindfulness.css',
  './css/modules/cooking.css', './css/modules/analytics.css',
  './css/modules/rhythm.css', './css/modules/history.css',
  // Add as modules are built
];

const MODULE_ASSETS = [
  // Stopwatch module
  './modules/productivity/stopwatch/index.js',
  './modules/productivity/stopwatch/stopwatch-engine.js',
  './modules/productivity/stopwatch/instance-manager.js',
  './modules/productivity/stopwatch/stopwatch-ui.js',
  './modules/productivity/stopwatch/cards-ui.js',
  './modules/productivity/stopwatch/compare-ui.js',
  './modules/productivity/stopwatch/analog.js',
  './modules/productivity/stopwatch/offset-input.js',
  './modules/productivity/stopwatch/alert-ui.js',
  './modules/productivity/stopwatch/lap-chart.js',
  './modules/productivity/stopwatch/export.js',
  // Timer module
  './modules/productivity/timer/index.js',
  './modules/productivity/timer/timer-engine.js',
  './modules/productivity/timer/timer-ui.js',
  // ... etc for each module
];

const ASSETS = [...CORE_ASSETS, ...SHELL_ASSETS, ...CSS_ASSETS, ...MODULE_ASSETS];

// Rest of service worker logic unchanged from current sw.js
```

### Background Notification Support

The current SW `message` handler for `scheduleNotification` / `cancelNotification` remains unchanged. The `core/notification-service.js` provides the same interface that `bg-notify.js` currently does.

---

## 13. Testing Strategy

### Current State

74 existing engine tests covering `createStopwatch`, `createTimer`, and `Pomodoro`.

### Migration Plan

1. **Migrate existing tests** to ES module imports
2. **Add core tests** for event-bus, store, router, offset-engine, timing-engine
3. **Add engine tests** for each new module (meds, habits, mindfulness, recovery, analytics)
4. **Add integration tests** for cross-module event flows

### Test Structure

```
tests/
├── core/
│   ├── event-bus.test.js           # on/emit/off, multiple listeners, unsubscribe
│   ├── store.test.js               # CRUD, migration, index queries
│   ├── router.test.js              # Navigation, route matching, legacy URL handling
│   ├── offset-engine.test.js       # parseToMs, msToComponents, calculateOffset
│   └── timing-engine.test.js       # createTimingContext lifecycle
├── modules/
│   ├── stopwatch-engine.test.js    # MIGRATED from existing tests
│   ├── timer-engine.test.js        # MIGRATED from existing tests
│   ├── pomodoro-engine.test.js     # MIGRATED from existing tests
│   ├── interval-engine.test.js     # New
│   ├── meds-engine.test.js         # New: dose logging, next-due calc, adherence
│   ├── habits-engine.test.js       # New: check-in, streak calc, auto-linking
│   ├── mindfulness-engine.test.js  # New: breathing patterns, phase transitions
│   ├── analytics-engine.test.js    # New: aggregation queries
│   └── rhythm-engine.test.js       # New: timeline assembly
├── integration/
│   ├── event-flow.test.js          # Module A emits → Module B receives → Store updated
│   └── data-migration.test.js      # localStorage → IndexedDB migration
└── test-runner.html
```

---

## 14. Implementation Phases & Roadmap

### Phase 0: Architectural Foundation (Incremental)

**Goal:** Restructure existing code without adding new features. App should be functionally identical after this phase.

> **REVISED (2026-04-10 audit):** The original Phase 0 was 25 tasks in one pass — too risky for a codebase that has grown to 30+ JS files and ~10,800 lines. The revised approach breaks Phase 0 into 4 sub-phases, each leaving the app fully functional. A hybrid bridge pattern allows new ES modules to coexist with existing globals during the transition.

#### Phase 0a: Core Platform (no existing code changes)
Build the new core modules alongside the existing code. Nothing breaks because nothing imports them yet.

0a.1. Create directory structure (`core/`, `shell/`, `modules/`, `css/`)
0a.2. Build `core/event-bus.js` (new)
0a.3. Build `core/store.js` with unified IndexedDB wrapper (new — migrates from existing `stopwatch_history_db` AND localStorage, see Section 5.2)
0a.4. Build `core/router.js` with hash-based routing (new)
0a.5. Extract `core/offset-engine.js` from `offset-input.js` (pure logic, no UI)
0a.6. Extract `core/timing-engine.js` from shared patterns (pure logic)
0a.7. Build `core/notification-service.js` merging `audio.js` + `bg-notify.js` patterns
0a.8. Add core platform tests

**Exit criteria:** Core modules exist and are tested. Existing app unchanged.

#### Phase 0b: App Shell + Hybrid Bridge
Build the new shell alongside the existing app. A bridge layer exposes the new ES module APIs as globals so existing code keeps working.

0b.1. Build `shell/nav.js` (pillar-based navigation)
0b.2. Build `shell/theme-engine.js` as ES module wrapping current `themes.js` logic
0b.3. Build `shell/app.js` (new entry point with module registration)
0b.4. Build the hybrid bridge: a `bridge.js` script that imports ES modules and re-exports them as globals (`window.Stopwatch`, `window.Timer`, etc.) so existing UI code doesn't break
0b.5. Create new `index.html` with `<script type="module">` for new code, keeping `<script>` tags for existing code that loads through the bridge
0b.6. Legacy URL support (`?mode=` → `#/route`)

**Exit criteria:** New shell boots alongside existing code via bridge. Navigation works. All existing features work.

#### Phase 0c: Module Migration (one at a time)
Migrate existing modes to the module contract, one per PR. After each migration, the bridge removes one global.

0c.1. Migrate stopwatch → `modules/productivity/stopwatch/index.js` (largest, do first)
0c.2. Migrate timer → `modules/productivity/timer/index.js`
0c.3. Migrate pomodoro → `modules/productivity/pomodoro/index.js`
0c.4. Migrate interval → `modules/wellness/exercise/index.js`
0c.5. Migrate cooking → `modules/wellness/cooking/index.js`
0c.6. Migrate sequence → `modules/productivity/timer/sequence.js` (sub-module of timer)
0c.7. Migrate history → `modules/shared/history/index.js`
0c.8. Migrate analytics → `modules/shared/analytics/index.js`

**Exit criteria:** All modes are ES modules. Bridge removed. No more global variables.

#### Phase 0d: CSS Split + Cleanup
0d.1. Create `css/tokens.css`, `css/shell.css`, `css/shared.css`
0d.2. Split per-module CSS from `styles.css` (~3000 lines) into module stylesheets
0d.3. Update `sw.js` with new asset paths
0d.4. Update `manifest.json` for Tempo branding
0d.5. Migrate existing tests to ES module imports
0d.6. Final verification: all features work, all tests pass

**Exit criteria:** All existing features work. All tests pass. Clean modular architecture.

> **Alternative: Build New, Migrate Later.** If Phase 0 proves too slow, the Medications module (Phase 1) can be built as a new mode in the *current* global architecture — the same way Sequence mode was added in April 2026. This proves the product concept before committing to the full restructure. Migrate to ES modules after the product direction is validated.

### Phase 1: MVP — First Wellness Module

**Goal:** Ship the first cross-pillar feature: Medications alongside existing Stopwatch.

**Tasks:**

1.1. Build `modules/wellness/medications/meds-engine.js`
1.2. Build `modules/wellness/medications/meds-ui.js` (dose logging, offset-powered "took it X ago", next-dose countdown)
1.3. Build `modules/wellness/medications/index.js` (module registration)
1.4. Create `css/modules/medications.css`
1.5. Wire medication events: `wellness:medication:dose-logged`
1.6. Build `modules/shared/analytics/analytics-engine.js` (basic: daily summary, pillar breakdown)
1.7. Build `modules/shared/analytics/charts.js` (bar chart, basic SVG)
1.8. Build `modules/shared/analytics/analytics-ui.js` (dashboard with date picker)
1.9. Create `css/modules/analytics.css`
1.10. Wire analytics to consume events from stopwatch + medications
1.11. Add meds-engine tests
1.12. Add analytics-engine tests
1.13. End-to-end: open app, start pomodoro, log medication dose, see both on analytics dashboard

**Exit criteria:** Two pillars visible. Medications module fully functional. Analytics shows cross-pillar data.

### Phase 2: Cross-Pillar Features

**Goal:** Build the "rhythm" view and habits module that tie both pillars together.

**Tasks:**

2.1. Build `modules/shared/rhythm/rhythm-engine.js` (daily timeline assembly)
2.2. Build `modules/shared/rhythm/rhythm-ui.js` (vertical timeline, day navigation)
2.3. Create `css/modules/rhythm.css`
2.4. Build `modules/productivity/habits/habits-engine.js`
2.5. Build `modules/productivity/habits/habits-ui.js` (check-in, streaks, calendar heatmap)
2.6. Create `css/modules/habits.css`
2.7. Wire habit auto-linking: pomodoro complete → check "Focus" habit, medication dose → check "Take meds" habit
2.8. Add habits to analytics dashboard
2.9. Tests for rhythm-engine, habits-engine

**Exit criteria:** Daily rhythm view shows interleaved productivity + wellness timeline. Habits auto-track based on module events.

### Phase 3: Mindfulness & Exercise Enhancement

**Goal:** Round out the wellness pillar with mindfulness and enhanced exercise features.

**Tasks:**

3.1. Build `modules/wellness/mindfulness/mindfulness-engine.js` (breathing patterns, meditation timer)
3.2. Build `modules/wellness/mindfulness/mindfulness-ui.js` (breathing animation, pattern picker)
3.3. Create `css/modules/mindfulness.css`
3.4. Enhance exercise module with more templates and post-workout logging
3.5. Build `modules/wellness/recovery/recovery-engine.js` (rest tracking)
3.6. Build `modules/wellness/recovery/recovery-ui.js` (recovery countdowns)
3.7. Create `css/modules/recovery.css`
3.8. Wire recovery to auto-start after exercise completion
3.9. Wire mindfulness sessions to analytics and rhythm
3.10. Tests for mindfulness, recovery

**Exit criteria:** Full wellness pillar with 5 modules. All modules emit events consumed by analytics/rhythm.

### Phase 4: Time Logging & Analytics Polish

**Goal:** Round out productivity pillar and polish the analytics experience.

**Tasks:**

4.1. Build `modules/productivity/time-log/time-log-engine.js`
4.2. Build `modules/productivity/time-log/time-log-ui.js`
4.3. Create `css/modules/time-log.css`
4.4. Add line charts and calendar heatmap to analytics
4.5. Add weekly summary / trend comparison to analytics
4.6. Add cross-pillar weekly report (exportable)
4.7. Polish all module UIs for consistency
4.8. Accessibility audit (focus management, aria labels, screen reader testing)
4.9. Performance audit (IndexedDB query optimization, RAF loop efficiency)

**Exit criteria:** Both pillars fully populated. Analytics provides genuine daily-use insights.

### Phase 5: Polish & Launch

**Tasks:**

5.1. New app icon for Tempo branding
5.2. Onboarding flow (first-launch walkthrough of both pillars)
5.3. Data export (full backup to JSON, selective CSV export)
5.4. Data import (restore from backup)
5.5. Privacy controls for wellness data (optional PIN lock on wellness tab)
5.6. Cross-browser testing (Safari, Chrome, Firefox — mobile + desktop)
5.7. Performance optimization (lazy loading modules not in current route)
5.8. Update GitHub README and deploy
5.9. Update CLAUDE.md with new architecture documentation

---

## 15. Key Decisions Log

Decisions to be made before or during implementation. Update this section as decisions are finalized.

| # | Decision | Options | Status | Chosen | Rationale |
|---|---|---|---|---|---|
| 1 | Module system | ES modules (native) vs. keep globals | **Decided** | ES modules | Proper dependency graph, no global reassignment, browser-native, no bundler needed |
| 2 | Data storage | localStorage vs. IndexedDB vs. hybrid | **Decided** | IndexedDB (with localStorage migration) | Async, no size limit, supports complex queries for analytics |
| 3 | Routing | Hash-based vs. tab switching (current) | **Decided** | Hash-based | Gives each module a URL, works with GitHub Pages, supports browser back/forward |
| 4 | Repo structure | Monorepo vs. separate repos | **Decided** | Monorepo | Shared deployment, easier cross-module development |
| 5 | Pillar visual identity | Unified vs. subtly differentiated | **Decided** | Subtle differentiation via accent colors | Shared design tokens with per-pillar accent overrides |
| 6 | Medication data privacy | Open vs. encrypted | OPEN | — | Needs user input. Web Crypto API possible but adds complexity. Start unencrypted, add optional PIN lock in Phase 5? |
| 7 | Build timeline | Sprint vs. incremental | OPEN | — | Needs user input. Phases designed to be independently shippable. |
| 8 | App name / branding | "Tempo" vs. alternatives | OPEN | Tempo (working name) | Open to change. Other candidates: Cadence, Pulse, Rhythm |
| 9 | Navigation style | Bottom tab bar vs. sidebar | **Decided** | Bottom tabs (mobile-first) with responsive sidebar on desktop | Matches mobile-first design. Desktop gets sidebar at >768px |
| 10 | History module location | Standalone route vs. overlay panel | **Decided** | Keep as slide-up overlay (current pattern) accessible from any route | Consistent with current UX, history is cross-cutting |

---

## 16. Risk Register

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| **Phase 0 takes too long** | Delays all new features | Medium | REVISED: Phase 0 now split into 4 sub-phases (0a-0d), each independently shippable. Hybrid bridge pattern allows incremental migration. Alternative: build Medications in current architecture first, migrate later. |
| **Double IndexedDB migration** | Data loss or duplication during stopwatch_history_db → tempo DB migration | Medium | Migration function (Section 5.2) reads from old DB, writes to new, keeps old as fallback. Test with real user data before shipping. |
| **Global variable elimination breaks things** | Regressions from removing mutable `Stopwatch`/`Timer` globals | High | Hybrid bridge layer (Phase 0b.4) keeps globals working during transition. Remove one global at a time, test after each. The `InstanceManager.setPrimaryStopwatch()` pattern that reassigns `window.Stopwatch` will need a getter-based approach. |
| **Module isolation breaks existing features** | Regressions in stopwatch/timer/pomodoro | Medium | Run existing 74 tests after every migration step. Manual smoke test all 7 current modes (5 original + sequence + focus) |
| **Medication data sensitivity** | Privacy concerns | Low | No PII required — medication names are optional labels. No cloud sync. All data stays on-device. Add disclaimers. |
| **Scope creep in wellness modules** | Never ships | High | Each module has a minimal spec. Ship with minimal feature set, iterate. Resist adding features not in this plan. |
| **Codebase has grown significantly** | Phase 0 estimates are stale | Medium | Appendix A updated with actual 2026-04-10 line counts. pomodoro-ui.js alone is 1221 lines. styles.css is 3079 lines. Plan accordingly. |
| **Performance regression from IndexedDB** | Slower startup, laggy UI | Low | Already validated: IndexedDB migration shipped April 2026 with no performance issues. Ready() guard pattern handles race conditions. |
| **ES module support gaps** | Breaks on older browsers | Very Low | ES modules have >95% browser support (2024+). Service worker (already used) requires same browser baseline. |
| **Too many CSS files** | Maintenance burden | Low | Design tokens ensure consistency. Per-module CSS is small and scoped. No cascading conflicts. |

---

## Appendix A: Current Codebase Inventory

> **Updated 2026-04-10** — reflects all changes from the April 2026 feature session.

### Files and Line Counts

| File | Lines | Migration Target | Notes |
|---|---|---|---|
| `index.html` | 520 | New `index.html` (rewritten) | Grew significantly with new panels/forms |
| `css/styles.css` | 3079 | Split into `tokens.css` + `shell.css` + `shared.css` + per-module CSS | 2x original size |
| `js/utils.js` | 23 | `core/utils.js` | |
| `js/dom-utils.js` | 10 | `core/dom-utils.js` | |
| `js/stopwatch.js` | 172 | `modules/productivity/stopwatch/stopwatch-engine.js` | Added `color` field |
| `js/timer.js` | 114 | `modules/productivity/timer/timer-engine.js` | Added `color` field |
| `js/instance-manager.js` | 161 | `modules/productivity/stopwatch/instance-manager.js` | |
| `js/pomodoro.js` | 192 | `modules/productivity/pomodoro/pomodoro-engine.js` | Added `restartPhase`, phase timing, session timing |
| `js/interval.js` | 215 | `modules/wellness/exercise/interval-engine.js` | |
| `js/persistence.js` | 25 | **REMOVED** (replaced by `core/store.js`) | Added new keys |
| `js/audio.js` | 96 | `core/notification-service.js` (merged) | Now has 3 sound profiles (Classic/Soft/Sharp) |
| `js/themes.js` | 88 | `shell/theme-engine.js` | |
| `js/history.js` | 199 | `modules/shared/history/history-engine.js` | **Already IndexedDB** (`stopwatch_history_db`) |
| `js/export.js` | 122 | Shared export module | Added full JSON backup/import |
| `js/analog.js` | 108 | `modules/productivity/stopwatch/analog.js` | |
| `js/offset-input.js` | 221 | Split: `core/offset-engine.js` + UI | |
| `js/ui.js` | 487 | `modules/productivity/stopwatch/stopwatch-ui.js` | Added cumulative/split lap toggle |
| `js/cards-ui.js` | 277 | `modules/productivity/stopwatch/cards-ui.js` | Added per-instance color coding |
| `js/compare-ui.js` | 223 | `modules/productivity/stopwatch/compare-ui.js` | |
| `js/timer-ui.js` | 206 | `modules/productivity/timer/timer-ui.js` | Added sequence mode bridge |
| **`js/pomodoro-ui.js`** | **1221** | `modules/productivity/pomodoro/pomodoro-ui.js` | **Largest file.** Checklists, drag-reorder, save-for-later, templates, timeline, distraction log, auto-advance. **Consider splitting.** |
| `js/pomodoro-stats.js` | 81 | `modules/productivity/pomodoro/pomodoro-stats.js` | Now async |
| `js/alert-ui.js` | 88 | `modules/productivity/stopwatch/alert-ui.js` | |
| `js/bg-notify.js` | 43 | `core/notification-service.js` (merged) | |
| `js/interval-ui.js` | 368 | `modules/wellness/exercise/exercise-ui.js` | Added history logging |
| `js/cooking-ui.js` | 277 | `modules/wellness/cooking/cooking-ui.js` | Added history logging |
| `js/history-ui.js` | 454 | `modules/shared/history/history-ui.js` | Date range filter, export/import UI, log-past-session panel |
| `js/presets.js` | 271 | Shared presets module | Added auto-start, instance name capture |
| `js/presets-ui.js` | 186 | Shared presets UI | Added auto-start checkbox |
| **`js/sequence.js`** | **133** | `modules/productivity/timer/sequence-engine.js` | **NEW** — linear phase chain engine |
| **`js/sequence-ui.js`** | **310** | `modules/productivity/timer/sequence-ui.js` | **NEW** — sequence sub-mode of Timer |
| **`js/analytics.js`** | **126** | `modules/shared/analytics/analytics-engine.js` | **NEW** — weekly totals, heatmap, trends |
| **`js/analytics-ui.js`** | **128** | `modules/shared/analytics/analytics-ui.js` | **NEW** — dashboard with charts |
| **`js/focus-ui.js`** | **198** | `shell/focus-ui.js` or standalone | **NEW** — fullscreen ambient display |
| `js/app.js` | 330 | `shell/app.js` (rewritten as thin bootstrap) | |
| `sw.js` | 100 | `sw.js` (updated asset list) | 37 cached assets |
| `manifest.json` | 53 | `manifest.json` (rebranded for Tempo) | |
| **Total** | **~10,847** | | **30 JS files + HTML + CSS** |

### Current localStorage Keys

> **Updated 2026-04-10.** Session history is now in IndexedDB (`stopwatch_history_db`), not localStorage.

| Key | Current Module | Notes |
|---|---|---|
| `multi_state` | InstanceManager | Includes instance `color` field (new) |
| `pomodoro_state` | Pomodoro | Includes phase timing fields (new) |
| `pomodoro_config` | Pomodoro | |
| `pomodoro_checklist` | PomodoroUI | Persists across cycles now |
| `pomodoro_break_checklist` | PomodoroUI | |
| `pomodoro_actual_work` | PomodoroUI | "What I Worked On" list |
| `pomodoro_saved_tasks` | PomodoroUI | Save-for-later bank |
| `pomodoro_task_templates` | PomodoroUI | Named checklist templates |
| `pomodoro_distractions` | PomodoroUI | Current session distraction log |
| `pomo_auto_advance` | PomodoroUI | Auto-advance toggle state |
| `interval_state` | Interval | |
| `cooking_timers` | CookingUI | |
| `sequence_state` | Sequence | Timer chaining state |
| `sequence_templates` | SequenceUI | Saved sequence templates |
| `quick_presets` | Presets | Includes autoStart flag (new) |
| `app_mode` | app.js | |
| `install_dismissed` | app.js | |
| `display_mode` | Analog | |
| `theme` | Themes | |
| `sound_muted` | SFX | |
| `sound_profile` | SFX | Classic/Soft/Sharp |
| `vibrate_interval` | UI | |
| `lap_display_mode` | UI | split/cumulative toggle |
| `presets_seeded` | Presets | Default presets seeded flag |
| ~~`stopwatch_history`~~ | ~~History~~ | **Migrated to IndexedDB** (`stopwatch_history_db`) |
| ~~`stopwatch_state`~~ | ~~(legacy)~~ | Auto-migrated, removed |
| ~~`timer_state`~~ | ~~(legacy)~~ | Auto-migrated, removed |

---

## Appendix B: Migration Map (Revised 2026-04-10)

> **Two-source migration:** Data now lives in both an existing IndexedDB database AND localStorage. The Tempo migration must handle both.

### Source 1: Existing IndexedDB (`stopwatch_history_db`)

| Old Store | Old Key | Tempo Store | Tempo Key | Notes |
|---|---|---|---|---|
| `sessions` | `id` (keyPath) | `sessions` | Same `id` | Add `pillar`, `module`, `startedAt` fields. Session types: stopwatch, timer, pomodoro, interval, cooking, sequence. Pomodoro sessions include focusGoals, breakTasks, actualWork, distractions, phaseLog. |

### Source 2: localStorage

| localStorage Key | Tempo Store | Tempo Key | Notes |
|---|---|---|---|
| `multi_state` | `activeState` | `'multi_state'` | Now includes per-instance `color` field |
| `pomodoro_state` | `activeState` | `'pomodoro_state'` | Now includes `sessionStartedAt`, `phaseStartedAt`, `phaseLog` |
| `pomodoro_config` | `activeState` | `'pomodoro_config'` | Direct copy |
| `pomodoro_checklist` | `activeState` | `'pomodoro_checklist'` | Persists across cycles |
| `pomodoro_break_checklist` | `activeState` | `'pomodoro_break_checklist'` | Direct copy |
| `pomodoro_actual_work` | `activeState` | `'pomodoro_actual_work'` | Direct copy |
| `pomodoro_saved_tasks` | `activeState` | `'pomodoro_saved_tasks'` | Save-for-later bank |
| `pomodoro_task_templates` | `activeState` | `'pomodoro_task_templates'` | Named checklist templates |
| `pomodoro_distractions` | `activeState` | `'pomodoro_distractions'` | Current session only |
| `interval_state` | `activeState` | `'interval_state'` | Direct copy |
| `cooking_timers` | `activeState` | `'cooking_timers'` | Direct copy |
| `sequence_state` | `activeState` | `'sequence_state'` | Timer chaining state |
| `sequence_templates` | `activeState` | `'sequence_templates'` | Direct copy |
| `quick_presets` | `activeState` | `'quick_presets'` | Includes autoStart flag |
| `theme` | `settings` | `'theme'` | Direct copy |
| `sound_muted` | `settings` | `'sound_muted'` | Direct copy |
| `sound_profile` | `settings` | `'sound_profile'` | Classic/Soft/Sharp |
| `display_mode` | `settings` | `'display_mode'` | Direct copy |
| `vibrate_interval` | `settings` | `'vibrate_interval'` | Direct copy |
| `lap_display_mode` | `settings` | `'lap_display_mode'` | split/cumulative |
| `pomo_auto_advance` | `settings` | `'pomo_auto_advance'` | Direct copy |
| `install_dismissed` | `settings` | `'install_dismissed'` | Direct copy |
| `app_mode` | `settings` | `'app_mode'` | Map to hash route |

---

## Appendix C: Current Module Public APIs

These are the exact public APIs of each existing engine module. New code must maintain backward compatibility during migration.

### createStopwatch(id) — Returns:

```
start()                    pause()                   reset()
lap()                      deleteLap(index)          setOffset(ms)
getElapsedMs()             getStatus()               getLaps()
getCurrentLapMs()          addAlert(ms)              removeAlert(ms)
getAlerts()                checkAlerts()             getId()
getName()                  setName(n)                getState()
loadState(state)
getColor()                 setColor(c)               ← NEW (April 2026)
```

### createTimer(id) — Returns:

```
setDuration(ms)            start()                   pause()
reset()                    checkFinished()           getRemainingMs()
getElapsedMs()             getProgress()             getStatus()
getDurationMs()            getId()                   getName()
setName(n)                 getState()                loadState(state)
onAlarm(cb)
getColor()                 setColor(c)               ← NEW (April 2026)
```

### Pomodoro (singleton) — Exports:

```
start()                    pause()                   reset()
restartPhase()             ← NEW (April 2026)
checkFinished()            nextPhase()               getRemainingMs()
getElapsedMs()             getProgress()             getStatus()
getPhase()                 getCycleIndex()           getTotalCycles()
getCurrentPhaseDurationMs()  getConfig()             onPhaseComplete(cb)
configure(opts)            getState()                loadState(state)
getSessionStartedAt()      ← NEW (April 2026)
getPhaseLog()              ← NEW (April 2026)
getPhaseStartedAt()        ← NEW (April 2026)
```

### Sequence (singleton) — NEW (April 2026):

```
setProgram(p)              getProgram()              start()
pause()                    reset()                   checkFinished()
advancePhase()             getRemainingMs()          getElapsedMs()
getProgress()              getTotalProgress()        getCurrentPhase()
getNextPhase()             getPhaseIndex()           getPhaseCount()
getCurrentPhaseDurationMs()  getStatus()             onPhaseComplete(cb)
getState()                 loadState(state)
```

### History (singleton, async) — REVISED (April 2026):

```
init()                     getSessions()             addSession(session)
updateNote(id, note)       deleteSession(id)         addTag(sessionId, tag)
removeTag(sessionId, tag)  getAllTags()               clearAll()
```
All methods return Promises. addSession accepts optional `id` and `date` overrides for retroactive logging.

### SFX (singleton) — REVISED (April 2026):

```
playStart()   playStop()   playLap()   playReset()   playAlarm()   playPhaseChange()
isMuted()     toggleMute()
getProfile()  setProfile(id)  getProfiles()   ← NEW (sound profiles)
```

### Interval (singleton) — Exports:

```
setProgram(p)              start()                   pause()
reset()                    checkFinished()           advancePhase()
getRemainingMs()           getElapsedMs()            getProgress()
getTotalProgress()         getCurrentPhase()         getNextPhase()
getStatus()                getPhaseIndex()           getRoundIndex()
getIsResting()             getTotalPhases()          getTotalRounds()
getProgram()               onPhaseComplete(cb)       getState()
loadState(state)
```

### InstanceManager (singleton) — Exports:

```
addStopwatch(name)         removeStopwatch(id)       getStopwatches()
getPrimaryStopwatch()      setPrimaryStopwatch(id)
addTimer(name)             removeTimer(id)           getTimers()
getPrimaryTimer()          setPrimaryTimer(id)
saveAll()                  loadAll()                 MAX_INSTANCES
```

### History (singleton) — Exports:

```
getSessions()              addSession(session)       updateNote(id, note)
deleteSession(id)          clearAll()                addTag(sessionId, tag)
removeTag(sessionId, tag)  getAllTags()
```

### SFX (singleton) — Exports:

```
playStart()    playStop()     playLap()      playReset()
playAlarm()    playPhaseChange()              isMuted()
toggleMute()
```

### Themes (singleton) — Exports:

```
init()         apply(themeId)  getThemeId()   getPresets()
```

### UI (singleton) — Exports:

```
init()         updateDisplay(ms)  syncUI()   stopRenderLoop()
```

### BgNotify (singleton) — Exports:

```
schedule(id, delayMs, title, body)  cancel(id)  requestPermission()
```

### Utils — Exports:

```
formatMs(ms)   → { hours, minutes, seconds, centiseconds, minStr, secStr, csStr }
```

---

*End of plan document. This file serves as the single source of truth for the Tempo platform architecture and implementation roadmap. Update this document as decisions are made and phases are completed.*
