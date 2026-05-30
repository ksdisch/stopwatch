# ADR 0002: Drift-free wall-clock timing — elapsed is DERIVED, never tick-accumulated

- **Status:** Accepted (retro-documented 2026-05-30)
- **Date:** 2026-04-04 (initial commit `f991cca` for the stopwatch; the timer adopted the identical pattern in Phase 3, `1a7bb3d`, same day)
- **Deciders:** ksdisch
- **Tags:** timing, persistence, engine, ios

## Context

A stopwatch/timer that increments a counter on a `setInterval`/`setTimeout` tick lies the moment the tab sleeps, the device suspends, or the OS throttles background timers. Browsers clamp background `setInterval` to ~1Hz (and stop it entirely when a tab is fully backgrounded or the device sleeps), so a tick-accumulated counter silently loses time and never recovers — the displayed elapsed drifts further from reality with every suspend. For a PWA whose whole reason to exist is *accurate* elapsed time — including the headline "start with N minutes already on the clock" offset feature — that failure mode is fatal.

This repo also has constraints that make tick-accumulation actively hostile: it's a no-build vanilla-JS PWA where the same code runs on a desktop tab, an installed PWA, and a Capacitor `WKWebView` (`com.ksdisch.tempo`), and it must survive a full tab close mid-run and resume showing the correct time. There is no server clock to reconcile against — the device wall clock is the only available source of truth.

The chosen invariant is the same single line in every engine: `elapsed = offsetMs + accumulatedMs + (Date.now() - startedAt)`. See `js/stopwatch.js:12-18` (`getElapsedMs`) and the structurally identical `js/timer.js:38-44` (`rawElapsedMs`). `accumulatedMs` only ever moves on an explicit `pause()` (`js/stopwatch.js:26-31`, `js/timer.js:78-83`), which folds the just-elapsed wall-clock delta into the accumulator and then drops `startedAt` — so a paused engine holds a frozen, clock-independent total, and a running engine recomputes from the live clock on every read.

## Decision

**Truth lives in `startedAt` plus a live wall-clock reading; the render loop is purely cosmetic.** No engine ever increments elapsed on a tick. `start()` stamps `startedAt = Date.now()` (`js/stopwatch.js:20-24`), `pause()` settles `accumulatedMs += Date.now() - startedAt` and nulls `startedAt` (`js/stopwatch.js:26-31`), and every consumer derives the current value on demand via `getElapsedMs()`.

The `requestAnimationFrame` loop in `js/ui.js:405-446` does exactly one thing of substance per frame: read `Stopwatch.getElapsedMs()` and paint it (`updateDisplay(...)` / `updateCurrentLap()` at `js/ui.js:438-439`). It carries **no** time state — `rafId` is the only thing it owns, and it self-terminates the instant `getStatus() !== 'running'` (`js/ui.js:441-443`). It exists only to make the digits move at 60fps; deleting it would not change a single computed elapsed value.

Tab-close resume is a free consequence, not separate code. On load, `InstanceManager.loadFromState` rehydrates each engine via `loadState` (`js/instance-manager.js:112-118`), which restores the persisted `startedAt`. Because `getElapsedMs()` reads `Date.now() - startedAt` against that restored timestamp, a stopwatch that was `running` when the tab closed auto-corrects to the true elapsed on first read — including all the wall-clock time that passed while the page didn't exist. The persisted `startedAt` is an absolute epoch timestamp precisely so this works.

`loadState` also carries the **clock-skew guard**: if a restored `running` state has `startedAt > Date.now()` (the wall clock moved backwards while the app was closed — manual clock change, timezone/DST shift, NTP correction), it drops `startedAt` and demotes the engine to `paused` rather than rendering a negative elapsed (`js/stopwatch.js:139-143`, `js/timer.js:149-152`). The timer goes further: on load it re-runs the finish check against the wall clock, so a countdown that expired while the tab was closed comes back already `finished`/`overflowing` and suppresses a stale alarm re-fire (`js/timer.js:153-184`).

## Consequences

### Positive
- **Tab-close / suspend resume works for free.** No replay log, no "time spent backgrounded" bookkeeping — the persisted `startedAt` plus a fresh `Date.now()` read at `js/stopwatch.js:14-15` reconstructs the truth on the next render. This is what the CLAUDE.md "Persistence across tab close" note describes.
- **Zero accumulated drift.** There is no counter to drift. Background throttling and `requestAnimationFrame` starvation affect only paint smoothness; the computed value is always exact to the wall clock.
- **Cheap iOS Live Activities story.** Backlog item #4 (lock-screen / Dynamic Island) becomes a thin shim: the activity stores `endsAt` (timer) or `startedAt + accumulatedMs` (stopwatch) once, and the SwiftUI lock-screen view renders `(endsAt - now)` locally with no per-tick push from JS — because the engine already treats those fields as the source of truth, not a derived cache.
- **The RAF loop is disposable and mode-safe.** Because it holds no time state, it can be stopped/started freely on `visibilitychange` (`js/ui.js:20-29`) and short-circuits across modes (`js/ui.js:408-411`) without ever risking a wrong elapsed value.
- **Pause is exact, not sampled.** `pause()` folds the precise `Date.now() - startedAt` delta into `accumulatedMs` (`js/stopwatch.js:28`), so a paused total is correct to the millisecond regardless of when the last frame painted.

### Negative / tradeoffs
- **One derivation underpins the whole app.** Every engine (`stopwatch`, `timer`, and by extension `pomodoro`/`flow`/`interval`/`sequence`, which follow the same `startedAt + accumulatedMs` model per CLAUDE.md), persistence reload (`js/instance-manager.js:107-131`), and notification scheduling (`BgNotify.schedule(id, delayMs, ...)` in `js/bg-notify.js:37-54`, whose `delayMs` is computed from the engine's remaining time) all sit on top of it. Switching to tick-accumulation would be an app-wide rewrite, not a localized change — there is no abstraction seam to swap.
- **Correctness is hostage to the device clock.** With no server time, a user (or OS) moving the clock backwards forces the demote-to-paused fallback (`js/stopwatch.js:140-143`); a forward jump is silently absorbed as "real" elapsed. The 24h overshoot cap in `js/timer.js:175-183` exists specifically to stop a pathological forward jump (or a week-long abandoned session) from polluting analytics — a band-aid the wall-clock model requires.
- **Display granularity needs the RAF loop to feel live.** Because nothing increments on its own, the centisecond digits only move while the RAF loop paints. If that loop fails to restart (e.g. a missed `visibilitychange` re-entry at `js/ui.js:20-29`), the *value* stays correct but appears frozen until the next read — a UX papercut that wouldn't exist if a tick were driving the number.
- **Background notifications can't lean on the in-page loop.** Since the RAF loop dies when the tab backgrounds, anything that must fire while suspended (timer alarms) must be pre-scheduled out-of-process — the service-worker `setTimeout` path or, on native, `@capacitor/local-notifications` (`js/bg-notify.js:39-42`). The wall-clock model makes the *resume* correct but does nothing for *firing while away*; that's a separate mechanism the design forces you to build.

## Alternatives considered
- **`setInterval` tick-accumulation (`elapsed += 10` every 10ms).** The conventional stopwatch implementation. Rejected because it drifts under background throttling and is simply *wrong* after any tab sleep or device suspend — and it would still need an absolute timestamp to repair itself on reload, at which point you've reinvented the wall-clock derivation anyway but with a redundant, drift-prone counter alongside it.
- **`performance.now()` as the time source.** Monotonic and immune to wall-clock changes, which is appealing. Rejected because it's a since-page-load relative clock that resets on every reload and does not advance across a closed tab — it cannot reconstruct elapsed-while-closed, which is the core persistence requirement. `Date.now()` is the only reading that survives a page lifecycle and that a future Live Activity / `LocalNotifications` schedule can also reason about.
- **Web Worker timer to dodge main-thread throttling.** Adds machinery and still doesn't run while the tab is fully suspended on mobile, so it doesn't actually solve the backgrounded-resume case — pure cost for partial coverage. Rejected against the no-build, minimal-moving-parts constraint of this repo.

## References
- `js/stopwatch.js:12-18` — `getElapsedMs` derivation (`offsetMs + accumulatedMs + (Date.now() - startedAt)`)
- `js/stopwatch.js:20-24`, `:26-31` — `start()` timestamp stamp, `pause()` accumulation
- `js/stopwatch.js:139-143` — clock-skew guard in `loadState`
- `js/timer.js:38-44`, `:46-56` — `rawElapsedMs` / `getRemainingMs` / `getElapsedMs` (same pattern)
- `js/timer.js:149-184` — load-time skew guard + finished-while-closed reconciliation + 24h overshoot cap
- `js/ui.js:405-446` — cosmetic-only RAF render loop; `:441-443` self-terminate; `:20-29` `visibilitychange` re-entry
- `js/instance-manager.js:107-131` — `loadFromState` rehydrates engines via `loadState`, restoring `startedAt`
- `js/bg-notify.js:37-54` — `BgNotify.schedule(delayMs, ...)`, the out-of-process fire path the model forces
- CLAUDE.md → "Key Design Decisions": "Drift-free timing" and "Persistence across tab close"
- Backlog item #4 (iOS Live Activities) — the cheap-shim consequence above
