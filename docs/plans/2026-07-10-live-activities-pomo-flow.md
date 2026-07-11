# Plan — Pomodoro + Flow Live Activities (backlog #4 follow-up)

**Date:** 2026-07-10 · **Branch:** `feat/live-activities-pomo-flow` · **Mode:** autonomous milestone
**Goal:** extend the shipped Timer Live Activity (lock screen + Dynamic Island) to the two
deep-work engines — Pomodoro and Flow Block — reusing the existing plugin/widget/bridge.

## Architecture decision (supersedes the widget-bundle comment)

**One shared `TempoTimerAttributes` type for all engines**, extended with additive optional
fields, instead of the per-engine ActivityAttributes structs sketched in
`TempoLiveActivityWidget.swift`'s MVP comment. Rationale:

- The plugin's lifecycle paths (`endAll`, registry re-adoption in `findActivity`, the
  belt-and-suspenders system sweep) are all typed `Activity<TempoTimerAttributes>` — separate
  structs would fork every one of them per engine. Shared type keeps toggle-OFF `endAll`
  complete for free.
- A pomodoro/flow lock-screen surface is ~90% the timer's (name, countdown to phase end,
  progress, PAUSED badge, Done ✓ stale state). The deltas are a phase label, a glyph/tint,
  and a per-mode deep-link — all expressible as fields.
- **No new Swift files, no pbxproj changes** → xcodebuild risk ≈ zero.

New fields (both optional → Codable decode-compat with in-flight activities from the current
build; ActivityKit re-adopts across app updates):

- `ContentState.label: String?` — updatable phase label ("Work 2/4", "Break", "Long break",
  "Focus", "Recovery"). Timer emits none → nil → rendering unchanged.
- `attributes.mode: String?` — fixed engine key ("pomodoro" | "flow"); drives glyph, tint,
  and `.widgetURL("tempo://timers/<mode>")`. nil → "countdown" (today's hardcode).

**One continuous activity per engine session; phase transitions are in-place updates.**
`startTimer` already update-routes when a live activity exists for the id, so no end+request
churn at phase boundaries (which would race the async `end` Task against registry
re-adoption — the documented "adopting a corpse" class). Phase zero-crossings emit
**nothing**: the shipped `staleDate = endsAt` contract flips the widget to "Done ✓", which
reads as "phase done — act when ready". Engine ids: `'pomodoro'`, `'flow'` (singletons; no
collision with `tm-*`/`sw-*` instance ids). Progress windows are synthesized truthfully as
`startedAt: now - getElapsedMs(), endsAt: now + getRemainingMs()` (better than timer's
remaining-only window; safe because the widget's ProgressView labels are already suppressed).

## Emit maps (all gated on `live_activities_enabled !== '0'` + `Platform.liveActivity`, fire-and-forget)

### Pomodoro (`js/pomodoro.js`, id `'pomodoro'`, name `'Pomodoro'`)
| Engine event | Emit |
|---|---|
| `start()` (fresh or resume) | `startTimer({id, name, mode, label, startedAt: now-elapsed, endsAt: now+remaining, isPaused:false})` |
| `pause()` | `updateTimer({id, isPaused:true})` |
| `adjustRemainingMs()` while running | `updateTimer({id, startedAt: now-elapsed, endsAt: now+remaining, isPaused:false})`; paused → no emit (resume re-emits) |
| `checkFinished()` → overflowing | **no emit** (staleDate → Done ✓) |
| `nextPhase()` → status `'done'` | `endTimer({id})`; mid-session boundary → no emit (next `start()` updates in place) |
| `revertPhase()` | `updateTimer({id, label, startedAt: now-elapsed, endsAt: now+remaining, isPaused: status==='paused'})` |
| `restartPhase()` | `endTimer({id})` (abandoned window; next start re-requests) |
| `reset()` | `endTimer({id})` |
| `loadState()` finished-while-away → overflowing | **no emit** (contrast Timer: phase-done ≠ session-done) |
| `loadState()` 24h overshoot cap hit | `endTimer({id})` (day-old Done ✓ orphan cleanup) |

New public getter `getPhaseLabel()` → `Work ${cycleIndex+1}/${totalCycles}` / `Break` /
`Long break` (also consumed by the tempo-nav re-arm sweep).

### Flow (`js/flow.js`, id `'flow'`, name `'Flow Block'`)
| Engine event | Emit |
|---|---|
| `start()` | `startTimer({..., label:'Focus', ...})` |
| `resume()` (both phases) | `startTimer(full payload)` — self-healing (re-requests if force-quit lost it) |
| `pause()` (both phases) | `updateTimer({id, isPaused:true})` |
| `startRecovery()` | `startTimer({..., label:'Recovery', startedAt: now, endsAt: now+15min})` (updates the Done ✓ focus activity in place) |
| `endFocusEarly()` | `updateTimer({id, endsAt: now, isPaused:false})` → immediate Done ✓ (kills the dead future countdown) |
| `checkFinished()` (both overflows) | **no emit** |
| `skipRecovery()` | `endTimer({id})` (session over; UI's follow-up `reset()` end is a safe noop) |
| `reset()` | `endTimer({id})` |
| `adjustRemainingMs()` while running/recovery | `updateTimer` new window; paused variants no emit |
| `loadState()` away-overflow branches | no emit; 24h cap → `endTimer({id})` |

New public getter `getPhaseLabel()` → `'Focus'` / `'Recovery'`.

## Swift deltas (no new files)

1. `TempoTimerAttributes.swift` — add `label: String?` (ContentState) + `mode: String?`
   (attributes).
2. `LiveActivityPlugin.swift` — `startTimer`: parse `label`/`mode` into the two structs;
   `updateTimer`: merge `label` (`call.getString("label") ?? currentState.label`).
   `endTimer`/`endAll` copy existing state — unchanged.
3. `TempoTimerLiveActivity.swift` — per-mode helpers: glyph (`timer` / `repeat.circle` /
   `brain.head.profile`), tint (green / red / indigo), deep-link URL
   (`tempo://timers/{countdown|pomodoro|flow}`); label chip in lock-screen top row + DI
   expanded center. Compact/minimal layouts unchanged.
4. `TempoLiveActivityWidget.swift` — comment truth-up only (shared-attributes decision).

## JS deltas beyond engines

- `js/tempo-nav.js` — toggle-ON re-arm sweep: also re-arm `Pomodoro` (status `running`) and
  `Flow` (status `running` | `recovery`) with their label/mode payloads. Deep-links need no
  routing changes (`TIMERS_MODES` already has `pomodoro`/`flow`; mapping is generic).
- `js/platform.js` — **no changes** (verbatim args pass-through).
- `index.html` — **no changes** (copy already generic).
- `sw.js` — CACHE_NAME bump (pomodoro.js, flow.js, tempo-nav.js changed).

## Tests

Clone `withLiveActivitySpy` (tests/timer.test.js:404) into `tests/pomodoro.test.js` +
`tests/flow.test.js`. Cases per engine: start payload (label/mode/window), pause flag,
resume re-emit, adjust running vs paused vs rejected, boundary silences (checkFinished,
mid-session nextPhase, away-overflow loadState), session-end emits (reset, nextPhase→done,
skipRecovery, restartPhase, endFocusEarly endsAt≈now, 24h cap), flag-off suppression.
Re-arm sweep stays sim/device-verified (status quo — wireLiveActivities is DOM-bound and
tests/index.html doesn't load tempo-nav).

## Verification

1. `npm test` (headless-flake adjudication rule applies) + `npm run test:ui`.
2. `xcodebuild` on ios/App (scheme per iOS-BUILD.md) — must stay green.
3. Simulator best-effort: the shell loads the **live Pages payload** (`server.url`), so local
   JS needs the local-payload override documented in iOS-BUILD.md before sim runs mean
   anything. Then: `simctl openurl` deep-links `tempo://timers/pomodoro|flow`, drive the app
   UI (computer-use on Simulator.app), lock + `simctl io screenshot` for lock-screen render.
   Whatever can't be reached autonomously is reported, not claimed.
4. On-device confirm remains Kyle's (accepted at milestone pick).

## Sequenced steps

1. ~~Blast-radius deep dive~~ ✅
2. ~~Plan doc + branch~~ ✅ `a033e74`
3. ~~`js/pomodoro.js` emits + `tests/pomodoro.test.js`~~ ✅ `675ac43` — suite PASS (1346)
4. ~~`js/flow.js` emits + `tests/flow.test.js`~~ ✅ `288f569` — suite PASS (1360)
5. Swift: attributes/plugin/widget deltas ✅ (edits in); xcodebuild pending
6. ~~`js/tempo-nav.js` re-arm sweep extension~~ ✅ `83870af`
6b. ~~Discovered fix: applyAppMode re-arms pomodoro/flow overflow states~~ ✅ `11368f8` (UI suite 12/12 after)
7. Suites ✅ (engine 1360, UI 12) + sim validation pending
8. Docs (CLAUDE.md + BACKLOG #4 + SESSION-LOG) + cache bump (done, v167 in `675ac43`) + PR — **no merge**

## Risks

- **Stale-payload trap on sim** (⌘R keeps WebView HTTP cache; CDN lag) — use the local
  override + force-quit discipline from BACKLOG #4's runbook.
- **ContentState decode-compat**: optional fields decode nil from old payloads — verified
  pattern (synthesized Codable uses decodeIfPresent for optionals).
- **Auto-advance overlay** (pomodoro-ui) calls `nextPhase()`+`start()` back-to-back — safe
  under in-place updates (no end+request race by design).
- Widget renders for `mode == nil` must stay pixel-identical to shipped Timer (regression
  guard is the device-validated MVP).
