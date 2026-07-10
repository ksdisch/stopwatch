# 2026-07-10 — Live Activities Timer MVP: merge + physical-device validation (backlog #4)

## What We Built

Took the Live Activities Timer MVP from "simulator-validated branch" to **shipped +
device-validated on Kyle's iPhone 17 Pro Max (8/9 smoke checks)**, via the path-A
merge-then-test flow Kyle chose. The physical-device smoke surfaced six real bugs across
three fix rounds — none of which the simulator or CI could catch — plus one found by
code-reading during root-cause.

**PR #201 (merge of `feat/live-activities-timer`, squash `865b735`, v160)** — the MVP
itself: in-tree `LiveActivityPlugin` + `TempoLiveActivityWidget` extension +
`Platform.liveActivity` bridge + `timer.js` emits + settings toggle + `tempo://` deep-link.

**PR #202 (docs)** — backlog row truth-up post-merge.

**PR #203 (v161) — round 1, from device checks 5/5b/6:**
- **Deep-link landed on Stopwatch:** widgetURL said `tempo://timers/timer`; the router's
  `TIMERS_MODES` only knows `countdown`, so `applyRoute` fell through its
  `|| TIMERS_MODES['stopwatch']` fallback. Fixed both sides: canonical
  `tempo://timers/countdown` in the widget + a `'timer'` alias in JS (old installed widgets
  keep working). Also `App.getLaunchUrl()` handling for cold-start deep-links.
- **Frozen timer display after switch-back:** `switchAppMode` stops every render loop but
  `applyAppMode` only re-armed flow/cooking — timer/pomodoro/interval froze at one
  structural paint when switched back into mid-run (reproducible on web too; Playwright
  regression spec added). `ui.js` visibilitychange re-arm gained `'overflowing'`.
- **Activity orphaned after finish-while-away:** `loadState`'s finished-while-away branch
  sets `alarmFired=true`, which permanently suppresses `checkFinished`'s `endTimer` emit —
  the activity lived until iOS's 8-hour cap. `loadState` now emits `endTimer` itself.
- **(Latent, would have failed the force-quit check):** the plugin's dict-only lookup lost
  activities across process relaunch — resume would duplicate, pause/end would no-op.
  `findActivity()` now falls back to ActivityKit's system registry and re-adopts.

**PR #204 (v162) — round 2, from device checks 6/8:**
- **"Done ✓" never rendered at 0:00:** iOS coalesces stale re-renders — the post-finish
  render arrived with `isStale` still false. `isDone()` now also fires for any non-paused
  render after `endsAt` (a paused activity is never "done").
- **The mystery "0:33"/"0:46" corner number:** `ProgressView(timerInterval:)`'s default
  `currentValueLabel` counts elapsed-in-window, and every resume re-emits a window of
  exactly the remaining time, so it clamps at that number. Both labels suppressed.
- **Dead-activity adoption (check 8 root-cause candidate):** round-1's registry fallback
  adopted activities regardless of `activityState`; after `endAll` a just-ended activity
  could be "updated" (documented no-op) instead of falling through to a fresh request.
  `isLive()` restricts adoption to `.active`/`.stale` (stale stays adoptable so the Done
  activity can be dismissed on resume); dead dict entries purged.
- **Toggle-ON re-arm:** flipping the setting ON re-arms a running countdown immediately.

**PR #205 (v163) — adjust-gap, found during sim validation:** ±3 min adjust changed
`durationMs` with no emit, so the lock screen counted to the *pre-adjust* end.
`adjustRemainingMs` now emits `updateTimer` with fresh `endsAt` (running only; paused picks
it up from resume). +3 engine tests (spy records `{method, args}` for all emits).

**PR #206 (v164) — temporary diagnostic** (toast the re-arm result on toggle-ON) for the
check-8 device failure. **Reverted in the closeout PR.**

**PR #207 — CLOSED unmerged (superseded):** all-instances re-arm sweep with diagnostics;
the closeout PR carries the sweep without the toasts.

**Closeout PR (v165):** diagnostic toasts removed; toggle-ON re-arm widened to ALL running
countdowns (`InstanceManager.getTimers()` + `cookingTimers`) — endAll kills every
instance's activity, so the re-arm now mirrors it symmetrically; docs truth-up.

## Verification result

- Device-confirmed (Kyle, iPhone 17 Pro Max): lock-screen render, re-lock survival,
  Dynamic Island compact + long-press expanded, **tap→`#/timers/countdown` deep-link with a
  ticking display**, pause freeze / resume single-activity / reset dismiss, finish →
  **"Done ✓"** + dismiss-on-open, force-quit persistence with no duplicate.
- Simulator-confirmed with screenshot + ActivityKit-log evidence: deep-link route,
  foreground zero-cross ends the activity, toggle OFF endAll, toggle ON re-arm (the one
  check that still fails on hardware — see below).
- Suites at close: engine **PASS (1320)** (+7 across the session), UI **12 passed** (+3:
  deep-link alias, canonical route, render-loop re-arm regression), `xcodebuild` App +
  widget **BUILD SUCCEEDED** each round. Cache v160 → v165 across the session.

## Open (backlogged by Kyle's call)

**Check 8 — settings-toggle OFF→ON re-arm on hardware.** Passes on sim; three device
attempts showed nothing. Full runbook (theories eliminated, diagnostic recipe, payload
staleness gotcha, sim-driving recipe) in `docs/BACKLOG.md` § #4 detail. Kyle: "I don't plan
on turning live activities off anyway."

## Hard-won operational lessons

- **⌘R keeps the WebView HTTP cache** — a device test right after a rebuild can pair new
  natives with a stale web payload (Pages max-age 600). Force-quit + wait out the window.
- **Sim driving without computer-use:** window AXGroup (UI element 5) position is the
  device-point origin at 1:1 scale; `simctl openurl` for deep-links; PageDown scrolls the
  drawer; screenshot-calibrate before clicking; Simulator must be re-activated before every
  click or clicks land in other apps' windows; macOS revoked osascript Accessibility
  mid-session (System Settings re-grant needed).
- **ActivityKit:** no scheduled end exists — suspended apps can't dismiss at `endsAt`;
  `staleDate` + widget-side `isStale`/endsAt-passed branch is the pattern. Registry
  (`Activity<T>.activities`) can serve corpses — always filter `activityState`.
  `ProgressView(timerInterval:)` renders a default label you probably don't want.

## Suggested Next Steps

- Backlog #3 (native Firestore CAS + listener parity) — last cloud-sync piece.
- Phase 5 Finances close-out — needs Kyle's July numbers, then the weekly council run.
- LA follow-ups: Stopwatch/Pomodoro/Flow/Interval/Cooking activities on the same bridge;
  the backlogged toggle re-arm device check.
- App Store paperwork (backlog #1 remainder).

## Commits

```
865b735 feat(ios): Live Activities for Timer mode (#201, squash)
ae2bb15 docs: backlog #4 → Timer MVP merged + live (#202, squash)
e023e66 fix(ios,timer,nav): device-smoke fixes — deep-link route, loop re-arm, end-on-restore, registry fallback (#203, squash)
e4c2b7b fix(ios): Live Activity round-2 — dead-activity adoption, robust Done state, hide window label, toggle-ON re-arm (#204, squash)
60cc65f fix(timer): adjust buttons update the Live Activity's endsAt (#205, squash)
cfb4d80 chore(diagnostic): toast the Live Activity re-arm result on toggle-ON (#206, squash; reverted in closeout)
```
