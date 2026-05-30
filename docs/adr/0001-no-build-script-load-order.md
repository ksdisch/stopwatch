# ADR 0001: No build step; script load order in index.html IS the dependency graph (IIFE globals + factory functions, not ES modules)

- **Status:** Accepted (retro-documented 2026-05-30)
- **Date:** Early in project history (the pattern predates the first committed history and is the foundational architecture decision; reaffirmed continuously through Phase 9 cloud-sync and Phase 10, e.g. `js/distractions.js` / `js/bfrb-events.js` load-order comments added during E-1d)
- **Deciders:** ksdisch
- **Tags:** architecture, no-build, vanilla-js, deployment

## Context

Tempo is a solo-authored, single-real-user PWA with a "vanilla HTML + CSS + JS. No framework, no build step" mandate. The entire app is a static folder. Deployment is `git push` → GitHub Pages auto-deploy (`CLAUDE.md` "Deployment": *"Push to `main` → auto-deploys in ~1 minute"*). There is no CI, no transpile, no bundler, and `CLAUDE.md:239` records the web build as literally *"none. `index.html` loads `js/*.js` in script order; the script order in `index.html` IS the dependency graph."*

The forces: a solo dev optimizing for the shortest possible edit→deploy loop, on a project that has nonetheless grown to **68 JS modules** under `js/` (verified `ls js/*.js | wc -l` = 68). Introducing a toolchain (npm install, a bundler config, a build artifact, source maps, a deploy step that runs the build) would add operational surface and a failure mode between "save file" and "live on GitHub Pages" — for a one-user app, that cost is hard to justify.

The chosen mechanism is a flat list of `<script>` tags in dependency order. `index.html:1030-1119` is that list: `utils → dom-utils → platform → schema → stopwatch → timer → instance-manager → … → tempo-nav → app`. Ordering constraints that the browser would otherwise discover at runtime are instead enforced by hand and documented inline — e.g. `index.html:1067-1069` ("Distractions … MUST load BEFORE pomodoro-ui.js + flow-ui.js"), `index.html:1071-1074` (Todoist before pomodoro-ui / tempo-nav), and `index.html:1114-1115` (bfrb-events before global-bfrb.js).

Each module is either a self-contained IIFE that assigns a single global (`const InstanceManager = (() => { … })()` at `js/instance-manager.js:1`) or a factory function plus a trailing mutable global (`function createStopwatch(id){…}` at `js/stopwatch.js:1`, then `let Stopwatch = createStopwatch('sw-default')` at `js/stopwatch.js:172`). Because there is no module system, every file assumes its dependencies are already-parsed globals on `window` — `js/instance-manager.js:5-7` reads `Stopwatch` / `Timer` at IIFE-init time, which only works because `stopwatch.js` and `timer.js` appear earlier in the tag list.

## Decision

**Ship a no-build static app where the `<script>` ordering in `index.html` is the dependency graph, modules are IIFE singletons or factory functions exposing plain globals (no `import`/`export`), and `js/app.js`, loaded last, is the composition root.**

- **Factory + mutable-global proxy.** `js/stopwatch.js:1` defines `createStopwatch(id)`; `js/stopwatch.js:172` declares `let Stopwatch = createStopwatch('sw-default')`. Because it is `let`, not `const`, the primary instance can be hot-swapped: `js/instance-manager.js:36-41` `setPrimaryStopwatch(id)` ends with `Stopwatch = instance`, and every downstream consumer (ui.js, offset-input.js) automatically operates on the new primary with zero code changes.
- **IIFE singletons reading earlier globals.** `js/instance-manager.js:1` `const InstanceManager = (() => {…` initializes its `stopwatches` array from the `Stopwatch` global at parse time (`js/instance-manager.js:5`: `let stopwatches = [Stopwatch];`). This only parses correctly because `stopwatch.js` (tag at `index.html:1034`) precedes `instance-manager.js` (tag at `index.html:1036`).
- **Composition root last.** `js/app.js` is the final tag (`index.html:1119`). It restores state (`Persistence.load()` at `js/app.js:8`) then wires every module: `SyncEngine.init()` / `SyncAuth.init()` (`js/app.js:29-30`), `UI.init()` / `CardsUI.init()` / `PresetsUI.init()` (`js/app.js:65-67`), `TempoNav.init()` (`js/app.js:91`). It can reference all of them as bare globals precisely because it loads after all of them.
- **Hand-curated ordering, enforced only by convention.** The constraints live as inline HTML comments (`index.html:1067-1069`, `1071-1074`, `1114-1115`) and as the "Script Load Order" arrow-chain in `CLAUDE.md:74`. No tool validates them.

## Consequences

### Positive

- **Zero deploy friction for a solo/one-user app.** Edit a `js/*.js` file, `git push`, live in ~1 min on GitHub Pages — no install, no bundle, no build artifact to keep in sync (`CLAUDE.md:239`, "Deployment" section).
- **Tests run the production source unmodified.** `tests/index.html:36-94` loads the *same* files by `<script src="../js/stopwatch.js">` etc. There is no test build and no risk of test-vs-prod transform drift — the test harness is just another HTML page with its own (smaller) hand-ordered tag list plus `tests/*.test.js`.
- **Trivially debuggable in any browser.** Files served as-is means DevTools shows the real source with real line numbers; no source maps to misconfigure.
- **The mutable-global proxy is genuinely elegant for the primary-instance use case.** Reassigning `Stopwatch` (`js/instance-manager.js:40`) reroutes the entire UI to a new instance without a single subscriber update — a pattern that would need explicit re-binding or a store under ES modules.
- **The iOS/Capacitor target inherits this for free.** `scripts/sync-www.mjs` mirrors the static files into `www/` for `cap copy`; the web build is byte-equivalent, so there is no separate bundling step for the native shell either.

### Negative / tradeoffs

- **Every module assumes its globals exist at parse time, and nothing checks it.** A mis-ordered tag fails only at runtime (and possibly only on a code path that touches the missing global) — e.g. moving `instance-manager.js` above `stopwatch.js` makes `js/instance-manager.js:5` throw `Stopwatch is not defined`. The dependency graph is real but invisible to tooling.
- **Ordering correctness is documented in three places that can desync.** The truth is `index.html:1030-1119`; it is *also* transcribed in the `CLAUDE.md:74` arrow-chain and partially in per-file comments. The test harness (`tests/index.html`) maintains a *fourth*, independent ordering. Adding a module means manually editing at least two of these and risking the docs going stale.
- **No tree-shaking, no minification, no HTTP/2-friendly bundling.** 68 separate script requests on first load (mitigated by the service-worker cache, but the cold-start cost is real). Globals pollute `window` and can collide — the codebase already had to rename to `SFX` to avoid the native `Audio` constructor (`CLAUDE.md` "Module naming" decision).
- **The migration cost grows with module count.** The `CLAUDE.md:175-179` "If Migrating to ES Modules" note acknowledges the escape hatch (`<script type="module" src="js/app.js">` + per-file `import`/`export`), but executing it now means touching all 68 files to add explicit imports, converting the mutable-global proxy (`let Stopwatch`) into an exported-binding or store pattern, and rewriting the test harness's tag list into module imports. Each new module raises that bill.
- **No static analysis safety net.** No lint, no typecheck (`CLAUDE.md` "Lint / typecheck / build": both *"none"*). A typo'd global reference is caught only by running `tests/index.html` in a real browser, since the repo's only test execution path is browser-loaded (curl-grepping the HTML returns the empty shell).

## Alternatives considered

- **Native ES modules (`<script type="module">`, no bundler).** Browser-supported, would give a real, tool-checkable dependency graph and scoped names instead of `window` globals. Explicitly noted as the future path in `CLAUDE.md:175-179`. Rejected for the initial/ongoing architecture because (a) the mutable-global proxy pattern (`let Stopwatch` reassignment, `js/stopwatch.js:172` + `js/instance-manager.js:40`) is cleaner as a shared mutable binding than as an exported live binding, and (b) converting 68 already-shipped files is pure migration cost with no user-facing benefit for a one-user app. It remains the recommended move *if the file count keeps growing*.
- **A bundler (Vite / webpack / esbuild).** Would add minification, tree-shaking, and a single artifact. Rejected: it inserts a build step between `git push` and GitHub Pages, breaks the "static folder deployable to any host" property, requires `node_modules` and CI to be trustworthy, and would force the byte-equivalent Capacitor `www/` mirror (`scripts/sync-www.mjs`) to instead mirror build output — net new operational surface for zero user value at this scale.
- **A framework (React/Vue/Svelte).** Rejected outright by the project mandate (`CLAUDE.md`: *"Vanilla HTML + CSS + JS. No framework, no build step."*). The drift-free engines and RAF render loop are small, hand-tuned, and have no need for a virtual DOM or reactivity runtime; a framework would add a dependency, a build step, and a learning/maintenance tax with no offsetting benefit for a solo author.

## References

- `index.html:1030-1119` — the flat `<script>` dependency-ordered tag block; inline MUST-load-BEFORE comments at `index.html:1067-1069`, `:1071-1074`, `:1114-1115`
- `js/stopwatch.js:1` (`createStopwatch` factory) and `js/stopwatch.js:172` (`let Stopwatch = createStopwatch('sw-default')` mutable global)
- `js/instance-manager.js:1` (IIFE singleton), `:5-7` (reads `Stopwatch`/`Timer` globals at parse time), `:36-41` (`setPrimaryStopwatch` reassigns the `Stopwatch` global)
- `js/app.js:8` (`Persistence.load()`), `:29-30` / `:65-67` / `:91` (composition-root wiring), loaded last at `index.html:1119`
- `tests/index.html:36-94` — test harness loads the same `js/*.js` source files via independent ordered `<script>` tags
- `CLAUDE.md:74` ("Script Load Order" arrow-chain), `:86` ("No build step" key design decision), `:175-179` ("If Migrating to ES Modules"), `:239` ("Web build: none")
