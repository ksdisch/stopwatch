---
description: Scaffold a new Rhythm Insights panel the Tempo way — a pure, deps-injected js/rhythm-panel-<key>.js registered via RhythmInsights.register, wired through all four touch-points (index.html slot, CLAUDE.md map + chain, sw.js ASSETS + CACHE_NAME bump, deps-overridden test file), and verified. Pass the panel key + what question it answers as the argument.
---

Add a Rhythm Insights panel. Argument: `$ARGUMENTS` (e.g. `mood-trend — 14-day mood valence
line from mood_events`).

Panels are the most-templated module kind in the repo (9 exist). Clone the idiom exactly —
`js/rhythm-panel-focus-minutes.js` + `tests/rhythm-panel-focus-minutes.test.js` are the
cleanest reference pair.

## 1. The panel contract (js/rhythm-insights.js)

```js
(function () {
  if (typeof RhythmInsights === 'undefined') return; // load-order guard
  RhythmInsights.register({
    key: '<key>', title: '<Title>', order: <n>,
    async build(deps, ctx) { /* read ONLY via deps; return a plain model */ },
    render(model, ctx)     { /* return card HTML string; NEVER throw, NEVER touch document */ },
  });
})();
```

- **Pure**: `build` reads only the injected `deps` accessors (`getSessions`, `getMeds`,
  `getRestLog`, `getRecoveryHistory`, `getBfrbEvents`, `getBfrbTrend`, `getDistractions`,
  `getDayTimeline`, `now`) — never module globals directly; that's what makes tests
  seed-free. `render` is a string producer.
- **Empty state is the DEFAULT path** — a fresh install with zero data must render a
  helpful card, not a blank/throw. `renderInto` isolates panels via `Promise.allSettled`,
  but "never throw" is still the contract.
- `escapeHtml` every user-originated string. Reuse the shared helpers on `RhythmInsights`
  (`windowDays`, `bucketByDay`, the inline-SVG axis/tooltip helpers) — do not re-implement.
- Per-panel UI state (toggles) goes in `ctx.state(key)`, never the URL hash.

## 2. Pick `order`

Taken: 5 today · 10 meds-sleep · 20 recovery-trends · 30 focus-minutes · 40 bfrb-frequency ·
45 bfrb-triggers · 50 distraction-rollup · 60 event-zoom · 70 correlations. Unset defaults
to 100. Pick a slot that places the panel sensibly and say why.

## 3. Wire ALL four touch-points (same ritual as /new-engine-module)

1. `index.html` — `<script src="js/rhythm-panel-<key>.js"></script>` after the last
   `rhythm-panel-*` tag and **before** `js/rhythm-ui.js`.
2. `CLAUDE.md` — file-map line (`Insights panel (order n): …`) + insert into the Script
   Load Order chain at the same position (hook-enforced lockstep with index.html).
3. `sw.js` — add `'./js/rhythm-panel-<key>.js'` to `ASSETS` **and** bump `CACHE_NAME`.
4. `tests/rhythm-panel-<key>.test.js` — register in `tests/index.html` near the other
   panel suites (before the `reportResults()` script).

## 4. Tests (deps-injected, clock-pinned)

Mirror `tests/rhythm-panel-focus-minutes.test.js`: pin a fixed `NOW`
(`new Date(2026, 4, 20, 12, 0, 0).getTime()` style — never the real clock), pass fixture
data through overridden `deps`, assert on the `build()` model and on `render()` output
containing the expected markup/numbers, and cover the empty state explicitly.

## 5. Verify

```bash
npm run check:assets && npm run check:load-order   # wiring
npm test                                           # suite green (flake rule in /run-tests)
```

Visual check per `docs/playbooks/browser-verification.md` Recipe B: fresh port, navigate to
`#/rhythm`, open the Insights sub-tab, confirm the panel renders (with data AND empty),
console clean, screenshot.

## 6. Recap

List files created/changed, the chosen `order` + slot, and test counts. Do NOT commit
unless asked — landing is `/ship-pr`.
