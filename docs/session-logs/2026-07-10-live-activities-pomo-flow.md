# 2026-07-10 — Live Activities: Pomodoro + Flow expansion (backlog #4 follow-up, PR #211)

Autonomous milestone (`/autonomous-milestone` triage → Kyle picked "Pomodoro+Flow Live
Activities"). Plan/tracker: `docs/plans/2026-07-10-live-activities-pomo-flow.md`.

## What We Built

The two deep-work engines now put their running phase on the lock screen + Dynamic
Island, reusing the Timer MVP's plugin/widget/bridge:

- **Shared activity type, additive fields** — `TempoTimerAttributes` gains optional
  `ContentState.label` (updatable phase label: Work 2/4 / Break / Long break / Focus /
  Recovery) + `attributes.mode` (fixed engine key → glyph/tint/deep-link). Supersedes the
  per-engine-struct sketch: a single `Activity<T>` keeps `endAll` + registry re-adoption
  complete, and nil fields render pixel-identical to the device-validated Timer look.
- **One continuous activity per engine session** (ids `pomodoro`/`flow`) — phase
  transitions update in place (`startTimer` update-routes on an existing id, so no
  end+request race at boundaries); phase zero-crossings emit **nothing** (the staleDate
  contract renders "Done ✓" across the between-phases window).
- **Engine emits** in `js/pomodoro.js` + `js/flow.js` (start/resume, pause, ticking
  adjust, revertPhase label+window update, startRecovery in-place transition,
  endFocusEarly endsAt→now, session-end endTimers incl. the 24h-cap orphan cleanup);
  new public `getPhaseLabel()` on both. +28 engine tests (suite 1332 → **1360 PASS**).
- **tempo-nav re-arm sweep** covers the two singletons (ticking states only).
- **Discovered + fixed:** `applyAppMode` didn't re-arm pomodoro/flow render loops in
  overflow states — exactly where a "Done ✓" activity tap deep-links in (the #203
  freeze class; timer already had the fix). +4 UI specs (routes + both freeze
  regressions), UI suite 12 → **16 passed**.
- `sw.js` v166 → v167. No new modules, no persisted-schema changes, zero
  `js/platform.js` changes (bridge passes args verbatim), zero routing changes
  (`TIMERS_MODES` already had both keys).

## Verification evidence

- Engine suite PASS (1360) headless, no flake this run ×2; UI suite 16/16 ×3;
  `xcodebuild` (iphonesimulator) BUILD SUCCEEDED ×2 (full + local-payload rebuild).
- **Simulator smoke (iPhone 17 Pro), fully autonomous** — local bundled payload
  (`server.url` stripped for the run, restored + re-baked after; smoke driven by a
  temporary auto-start snippet appended to the *installed container's* app.js, never
  the repo; app uninstalled from the sim afterwards):
  1. `tempo://timers/pomodoro` + `…/flow` deep-links land on the right surfaces.
  2. Pomodoro island compact: red glyph + live countdown (1:52 on a 120s phase —
     exact arithmetic).
  3. Zero-cross while backgrounded → activity **survives** → green **DONE** (the new
     between-phases contract, on screen).
  4. Fresh-process `Pomodoro.reset()` ended the DONE orphan via registry re-adoption
     (subsequent island showed only the flow activity — no multi-activity collapse).
  5. Flow island: indigo glyph + 1:29:53 on the 90-min focus phase.
- **Not verified (device-owner checks, Timer-MVP style):** expanded-island label chip +
  lock-screen large-view visuals (sim lock needs host Screen Recording / Accessibility
  grants — not granted mid-run), widget tap-through (mechanism identical to the
  #203-validated timer path), pause badge visuals, hardware toggle re-arm (pre-existing
  backlog item, now also covering the singletons).

## Suggested Next Steps

- Kyle: on-device smoke of PR #211's surfaces after merge + `npm run ios:open`
  (widget/plugin half needs the rebuild; the JS half rides Pages).
- Remaining #4 engines: Stopwatch needs a count-up ContentState variant; Interval /
  Cooking can reuse the countdown shape.
- Grant Screen Recording (computer-use) or re-grant Accessibility (osascript) before
  the next sim-driving session — both were unavailable, which is what kept the
  lock-screen large view out of this run's evidence.

## Commits

```
a033e74 docs(plan): Pomodoro + Flow Live Activities implementation plan
675ac43 feat(pomodoro): Live Activity emits — one continuous activity, phase-aware label
288f569 feat(flow): Live Activity emits — focus/recovery phases update one activity
83870af feat(nav): toggle-ON re-arm sweep covers the Pomodoro/Flow singletons
11368f8 fix(app): applyAppMode re-arms pomodoro/flow render loops in overflow states
401f207 feat(ios): phase-aware Live Activity — shared attributes gain label + mode
d383aeb test(ui): pomodoro/flow deep-link routes + overflow re-arm regressions
(+ this docs commit)
```
