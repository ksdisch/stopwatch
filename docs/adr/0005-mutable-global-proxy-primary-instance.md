# ADR 0005: Mutable global proxy for the primary stopwatch / timer instance

- **Status:** Accepted (retro-documented 2026-05-30)
- **Date:** ~2026-03 (introduced with multi-instance support / `InstanceManager`, Phase 4 of the backlog; the `let Stopwatch` global predates it as the single-instance default and was retrofitted into the proxy)
- **Deciders:** ksdisch
- **Tags:** architecture, state, no-build

## Context

Tempo grew from a single stopwatch into a multi-instance app: `InstanceManager` holds up to five stopwatches and five timers (`js/instance-manager.js:2`), with one of each marked "primary". The primary is the instance the main UI is bound to — the big display, the lap list, the offset input, the alert checks. The entire ~490-line main UI (`js/ui.js`) and the offset-input module (`js/offset-input.js`) were written against a *single* engine handle named `Stopwatch`, e.g. `Stopwatch.getStatus()` (`js/ui.js:79`), `Stopwatch.lap()` (`js/ui.js:81`), `Stopwatch.getElapsedMs()` (`js/ui.js:125`), `Stopwatch.setOffset(ms)` (`js/offset-input.js:96`). The timer UI is the same shape against `Timer` (`js/timer-ui.js:27`, `:43`, `:56`).

The forces specific to this repo:

- **No ES modules, no build step.** The `<script>` tag order in `index.html` *is* the dependency graph (`index.html:1034-1062`). There is no import graph to re-point when the primary changes — every `.js` file shares one global lexical scope, evaluated top to bottom. A symbol declared with `let` at the top level of one script is visible (and mutable) from every script that loads after it.
- **The default engine handles are top-level `let` bindings.** `let Stopwatch = createStopwatch('sw-default')` lives at `js/stopwatch.js:172` (comment: "Default instance — backward compatible global"); `let Timer = createTimer('tm-default', { allowOvershoot: true })` at `js/timer.js:199`. Both load *before* `instance-manager.js` (`index.html:1034-1036`), so by the time `InstanceManager`'s IIFE runs, the bindings exist and seed its arrays (`js/instance-manager.js:5-8`).
- **The swap must be O(1) and invisible to the UI.** Switching primary happens on a card tap (`js/cards-ui.js:151,155`) and on cloud-restore at boot (`js/instance-manager.js:118,129`). The UI code that reads `Stopwatch`/`Timer` must keep working with zero edits per swap — there are dozens of read sites in `ui.js` alone (`Stopwatch.` appears 20+ times).

The problem: how does a primary swap re-point the ~490-line UI at the new instance without threading the instance through every function or touching every call site?

## Decision

We use the engine handles `Stopwatch` and `Timer` as a **mutable global proxy**: a top-level `let` binding that `InstanceManager` *reassigns* when the primary changes. Because every call site reads the live global at call time (late binding), reassigning the `let` transparently re-points all of `ui.js`, `offset-input.js`, `timer-ui.js`, and `app.js` at the new primary in a single statement.

The swap is exactly that — one assignment:

```js
function setPrimaryStopwatch(id) {
  const instance = stopwatches.find(sw => sw.getId() === id);
  if (!instance) return;
  primaryStopwatchId = id;
  Stopwatch = instance;          // ← the whole mechanism
}
```

`setPrimaryStopwatch` reassigns at `js/instance-manager.js:40`; `setPrimaryTimer` does the same at `js/instance-manager.js:73`. The boot-time restore path also reassigns through the `getPrimary*` accessors: `Stopwatch = getPrimaryStopwatch()` (`js/instance-manager.js:118`), `Timer = getPrimaryTimer()` (`js/instance-manager.js:129`). This is possible only because `Stopwatch`/`Timer` are declared with `let` (not `const`) in an earlier-loaded sibling script, and `instance-manager.js` runs in the same global scope.

Call sites never reference `InstanceManager.getPrimaryStopwatch()` directly for the hot path — they read the bare global. `js/ui.js`'s render loop reads `Stopwatch.getLaps()` (`js/ui.js:180`), `Stopwatch.getElapsedMs()` (`js/ui.js:438`); the offset UI reads `Stopwatch.getElapsedMs()` (`js/offset-input.js:98`); `app.js` reads `Stopwatch.getLaps()` (`js/app.js:449`) and `Timer.getStatus()` (`js/app.js:215`). All of them follow the reassignment for free. CLAUDE.md documents this under "Key Design Decisions → Mutable global proxy pattern" (`CLAUDE.md:101`); this ADR records the mechanism and its sharp edge.

The one thing the proxy does *not* carry across a swap is **state captured on the old instance object**. `Timer`'s alarm callback is registered on the instance via `Timer.onAlarm(cb)` (`js/timer.js:121`, called from `js/timer-ui.js:233`). That closure is held by whatever instance `Timer` pointed at *when `onAlarm` ran* — reassigning the `let` does not move it. So the swap path explicitly re-registers it on the new primary: `swapPrimary` calls `initTimerAlarm()` immediately after `setPrimaryTimer(id)` (`js/cards-ui.js:155-157`). Render loops are likewise stopped before the swap and restarted after against the new handle (`js/cards-ui.js:150-152` for stopwatch, `:154-161` for timer).

## Consequences

### Positive

- **Zero rewiring on swap.** A primary change is one assignment (`js/instance-manager.js:40`, `:73`); the 20+ `Stopwatch.` read sites in `ui.js` and the `Timer.` sites in `timer-ui.js` need no edits. The UI was written as if there were one engine and stays that way.
- **No parameter threading.** The render loop, button handlers, lap renderer, alert checker, and offset input all keep their original single-engine signatures. None of them gained an `instance` argument when multi-instance landed.
- **Backward-compatible by construction.** The globals existed first as the single-instance default (`js/stopwatch.js:171` comment "backward compatible global"). Multi-instance was retrofitted by making `InstanceManager` *own* the reassignment rather than rewriting the consumers — the cheapest possible migration for a no-build app.
- **The swap is genuinely O(1).** Find-by-id plus one assignment (`js/instance-manager.js:37-40`). No listener re-subscription for the read path, no DOM rebind, no diff.

### Negative / tradeoffs

- **Captured references go stale — the central footgun.** Any closure that grabs the *instance* (not the live global) before a swap keeps pointing at the old primary. This is exactly why `Timer.onAlarm` requires manual re-registration (`js/cards-ui.js:157`): the alarm fires on whichever Timer object held the callback, so without the re-register the new primary would have a silent, non-firing alarm. The rule "read the live binding at call time, never capture `const t = Timer`" is invisible in the type system and enforced only by discipline.
- **Implicit coupling across files.** `instance-manager.js` mutates a binding *declared in `stopwatch.js`/`timer.js`* (`js/instance-manager.js:40` vs `js/stopwatch.js:172`). The dependency is real but invisible — nothing in `instance-manager.js` names the file the `let` came from, and it only works because of the `index.html` script order (`index.html:1034-1036`). Reorder those tags and the IIFE seed (`js/instance-manager.js:5-8`) throws on an undefined `Stopwatch`.
- **Hard to unit-test in isolation.** A consumer that reads the bare `Stopwatch` global can't be handed a fixture instance through a parameter; the test has to reassign the global, which is why the engine test suites target the `createStopwatch(id)` *factory* directly rather than the proxy. The proxy itself has no test coverage.
- **`const` is forbidden for these two bindings forever.** The whole pattern dies if anyone "tidies" `let Stopwatch` to `const Stopwatch`. There is no lint rule guarding it (the repo has no linter).
- **Two writers to the same handle.** Both `setPrimary*` (`js/instance-manager.js:40`, `:73`) and the restore path (`:118`, `:129`) assign `Stopwatch`/`Timer`. They never run concurrently (single-threaded JS, no async between them), but the binding has more than one author, which a reader has to hold in their head.

## Alternatives considered

- **Thread the active instance as a parameter through every UI function.** Rejected: it would change the signature of every function in `ui.js`, `offset-input.js`, and `timer-ui.js` that touches the engine — dozens of call sites — and every internal caller of those functions, for no behavioral gain. The proxy achieves the same outcome with one assignment.
- **A `getPrimary()` accessor called at every site** (`InstanceManager.getPrimaryStopwatch().getElapsedMs()`). Rejected: it works (the accessor exists at `js/instance-manager.js:32` and *is* used by the card/compare UIs, e.g. `js/cards-ui.js:24`, `js/compare-ui.js:59`), but converting the ~490-line main UI to it means rewriting every `Stopwatch.` site, adds a call + property lookup per hot-loop tick, and abandons the "the global just works" idiom the UI was built on. The accessor is the right tool for *non-primary* card rendering; the proxy is the right tool for the *primary* UI.
- **An event-bus / observer that re-binds listeners on swap.** Rejected as over-engineered for a no-backend, single-user app: it reintroduces the exact re-subscription cost the proxy avoids (you'd re-bind every listener on every swap, which is the `onAlarm` problem generalized to *everything* instead of the one callback that actually needs it). The proxy localizes that cost to the single piece of captured state that exists.
- **Full ES-module refactor with a reactive store** (`<script type="module">`, a `primaryStore` with subscribers). Rejected: it violates the project's load-bearing "no build step / script order is the dependency graph" constraint (`CLAUDE.md` "No build step"), would touch every file's import surface, and buys nothing a single mutable `let` doesn't already provide for one real user. CLAUDE.md keeps this on the table only as a *future* migration "if the file count keeps growing" — not warranted now.

## References

- `js/instance-manager.js:5-8` (globals seed the manager's arrays), `:32-34` (`getPrimaryStopwatch` accessor), `:36-41` (`setPrimaryStopwatch` reassigns at `:40`), `:65-67` (`getPrimaryTimer`), `:69-74` (`setPrimaryTimer` reassigns at `:73`), `:118` / `:129` (restore-path reassignment), `:153-160` (exports)
- `js/stopwatch.js:171-172` (`let Stopwatch = createStopwatch('sw-default')` — the canonical declaration)
- `js/timer.js:197-199` (`let Timer = createTimer('tm-default', …)`), `:121` (`onAlarm` registers a callback *on the instance*)
- `js/ui.js:79` / `:81` / `:125` / `:180` / `:438` (bare-global `Stopwatch.` read sites that follow the swap)
- `js/offset-input.js:96` / `:98` / `:104` / `:106` (`Stopwatch.setOffset` / `getElapsedMs` read sites)
- `js/timer-ui.js:27` / `:43` / `:56` (bare-global `Timer.` reads), `:233` (`Timer.onAlarm(...)` captures the instance)
- `js/cards-ui.js:151` / `:155` (`setPrimary*` invoked on card tap), `:147-165` (`swapPrimary` — stop loop → reassign → `initTimerAlarm()` re-register → restart loop)
- `js/app.js:215` (`Timer.getStatus()`), `:449` (`Stopwatch.getLaps()`)
- `index.html:1034-1036` (load order: `stopwatch.js` → `timer.js` → `instance-manager.js`), `:1061-1062` (`offset-input.js` → `ui.js`)
- `CLAUDE.md:101` ("Mutable global proxy pattern" design-decision note)
- Related: ADR 0001 (no build step; script load order in `index.html` is the dependency graph) — the proxy is a direct consequence of the no-ES-module constraint that ADR records.
