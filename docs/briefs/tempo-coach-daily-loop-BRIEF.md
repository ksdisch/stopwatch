# tempo-coach-daily-loop — Tempo Coach: readiness-aware daily decision loop (v1, full loop)

You're working on **Tempo**, a vanilla-JS PWA + Capacitor iOS app. This PR turns the app's already-computed correlations *forward*: a top-of-Insights "Today" briefing, a readiness-sized Flow default, and an opt-in morning nudge. Chosen from the 2026-06-05 milestone brainstorm (`docs/brainstorm/2026-06-05-milestone-brainstorm.md`, "Tempo Coach" deep dive) at **full-loop scope**.

**PR ID:** `tempo-coach-daily-loop` (general PR, NOT a sync PR)
**Audit path:** `docs/audits/tempo-coach-daily-loop-AUDIT.md`

---

## The one non-negotiable: DESCRIPTIVE-FIRST

Every user-facing string this PR ships is **observational, never imperative**. The app reports what its own data shows; it never prescribes a medical action.

- ✅ ALLOWED: *"On your earliest-dose days this month, sleep onset averaged ~41 min earlier."*
- ✅ ALLOWED: *"Recovery signal is strained today — on similar days your focus minutes ran about half."*
- ❌ FORBIDDEN: *"Take your Vyvanse by 9:00 AM."* / *"You should…"* / any imperative dosing/medical instruction.

This is what keeps the milestone autonomously shippable (it sidesteps clinical-framing ratification). The morning nudge copy (Slice's riskiest surface) is **opt-in, default OFF**, and also descriptive ("Today's recovery signal is strong — a good window for a long focus block" — not "Do X").

---

## Required reading (before any code)

1. This brief + `docs/brainstorm/2026-06-05-milestone-brainstorm.md` (the "Tempo Coach" deep dive — scope, risks, success criteria).
2. Root `CLAUDE.md` — durable conventions, State Model, Script Load Order.
3. `js/rhythm-insights.js` — the panel **registry** (`register({ key, title, order, build, render })`), the **`_deps()`** dependency-injection data layer, and the shared inline-SVG/`card`/`empty` helpers. New panels self-register and `render` returns an **HTML string** (RhythmInsights.renderInto injects it — panels never touch `document`).
4. `js/rhythm-panel-meds-sleep.js` — reuse the `firstDoseHourByDay` × `bedtimeHour` pairing logic (dose-hour vs that-night's-bedtime) as the basis for the dose→sleep-onset slope.
5. `js/rhythm-panel-correlations.js` — reuse the well/strained delta math + the **both-groups-have-data guard** (never emit a callout on one-sided/empty data).
6. `js/recovery-feed.js` — `getLatest()` / `getDayRow(dateKey)` / `getHistory()` (READ-ONLY external recovery_state; HRV/ACWR/RHR + a derived `recovery_signal`). Often **empty** (signed-out / offline-leaning user) — every recovery-dependent surface MUST degrade to a clean no-op.
7. `js/flow.js` — `Flow.configure({ focusDurationMs })`, `getFocusDurationMs()`, `getConfig()`; durations are `FOCUS_90` (5400000) / `FOCUS_120` (7200000).
8. `js/meds.js` — `getStatusToday()` / `getDosesToday()` (for the "dose still unlogged" status; read the LIVE `MedsManager`, never the deleted `wellness_meds` blob).
9. `js/bg-notify.js` — `BgNotify.schedule(id, delayMs, title, body)` / `BgNotify.cancel(...)` (feature-detects web vs native LocalNotifications internally).
10. `js/flow-ui.js` — the pre-block setup surface (where the readiness-sized default is pre-selected) and `FLOW_CHECKLIST_ITEMS`.
11. `js/tempo-nav.js` — the settings drawer (`#tempo-settings-drawer`) where the two toggles live; an existing toggle wiring (e.g. the BFRB volume slider via `global-bfrb.js`, or Todoist panel) is the idiom to match.
12. Existing tests: `tests/rhythm-insights.test.js` + any `tests/rhythm-panel-*.test.js` for the panel-test idiom; `tests/flow.test.js` for the flow-engine idiom.

---

## What this PR ships

### Engine layer (engine-implementer — pure JS, no DOM)

**NEW `js/tempo-coach.js`** — a singleton/IIFE holding ALL the pure "coach" logic, consumed by the panel + flow-ui. Zero DOM, zero side-effects (returns decisions; callers act):
- `TempoCoach.readinessBand(recoveryState)` → `'well' | 'strained' | 'neutral' | null` (null when no signal). Derive from the recovery-feed `recovery_signal` / available metrics; mirror however `rhythm-panel-correlations.js` already classifies well/strained so the language is consistent.
- `TempoCoach.suggestFocusDurationMs(recoveryState)` → `{ ms: 5400000|7200000|null, band, reason }`. `well` → 120-min, `strained` → 90-min, `neutral`/null → `null` (no suggestion → flow-ui keeps the user's last default). `reason` is a short descriptive string.
- `TempoCoach.doseSleepSlope(pairs)` → `{ usable, slope, intercept, nPoints, deltaMinutes, reason }`. Least-squares over `{ doseHour, bedtimeHour }` pairs with **suppression guards**: require ≥5 usable pairs AND a minimum x-spread (e.g. ≥1.5h between earliest/latest dose hour) AND basic slope stability; if any guard fails, `usable=false` + a "not enough data yet" `reason`. `deltaMinutes` = the descriptive "earliest-vs-latest-dose-day onset difference" used in the copy. **Never assert a slope on thin/noisy data.**
- `TempoCoach.buildTodayModel(deps)` → the assembled model object for the panel (readiness summary, re-lensed focus expectation, dose→sleep observation, dose-logged status). Pulls from injected `deps` (the `_deps` accessors) so it is unit-testable with fixtures.
- `TempoCoach.shouldNudge(recoveryState, now)` → `{ nudge: bool, title, body }` — pure decision for the opt-in morning heads-up (descriptive copy only). No scheduling side-effect here.

**NEW `js/rhythm-panel-today.js`** — self-registers `RhythmInsights.register({ key: 'today', title: 'Today', order: 5, build, render })` so it pins ATOP Insights. `build(deps)` calls `TempoCoach.buildTodayModel` over `_deps`; `render(model)` returns a descriptive HTML string reusing the shared `card`/`empty`/SVG helpers. **Empty-state is the DEFAULT path:** with no recovery feed the panel still delivers value from purely-local dose+sleep+focus data; the recovery re-lens is strictly additive. Use `escapeHtml` for any interpolated text.

### UI layer (ui-wirer — DOM/wiring/styles; visually verify via kapture)

- **`js/flow-ui.js`** — in the pre-block setup, when `flow_readiness_suggest !== '0'`, call `TempoCoach.suggestFocusDurationMs(RecoveryFeed.getLatest())` and pre-select the matching focus-duration control, with a one-line descriptive "why" (`reason`) and a clear user override (selecting the other duration wins; never force `Flow.configure` against the user's choice). No suggestion (`ms === null`) → leave the existing default untouched, show no "why" line.
- **`js/tempo-nav.js` + `index.html` + `css/styles.css`** — two settings-drawer rows:
  1. **"Readiness suggestions"** — opt-OUT toggle (default ON), persists `flow_readiness_suggest`.
  2. **"Morning readiness nudge"** — opt-IN toggle (default OFF), persists `tempo_coach_nudge_enabled`. When enabled, wire a daily heads-up via `BgNotify.schedule(...)` whose title/body come from `TempoCoach.shouldNudge(...)`; when disabled, `BgNotify.cancel(...)`. Reuse the existing drawer-toggle idiom; do not hardcode pillar colors (CSS vars).
- **`index.html`** — `<script>` tags for the two new modules (engine-implementer flags this; pr-shipper or ui-wirer adds them in load-order: `tempo-coach` before `rhythm-panel-today`, both in the rhythm-panel block before `rhythm-ui`). Drawer toggle markup.

### New persistence keys (device-local, NOT synced — flag for pr-shipper to document in CLAUDE.md)
- `flow_readiness_suggest` — `'0'`/`'1'` (default ON when absent). Flow readiness-sized-default opt-out.
- `tempo_coach_nudge_enabled` — `'0'`/`'1'` (default OFF when absent). Morning nudge opt-in.
- (optional) `tempo_coach_today_collapsed` — panel collapse state, if you add a collapse toggle matching other panels.

---

## Hard rules

- **Descriptive-first** (see top). No imperative medical/dosing copy anywhere, including the nudge.
- **Empty-state is the default-rendered path.** The Today panel and every recovery-dependent surface must render cleanly (and still add local value) when `RecoveryFeed.getLatest()`/`getHistory()` is empty/stale/signed-out. This MUST be a tested path.
- **Suppression guards on the slope** — never narrate a slope/correlation on thin or noisy data; fall back to "not enough data yet." This is the well-tested part.
- **No sync-store changes.** Tempo Coach reads existing data and adds device-local UI prefs only. Do NOT add a synced store, do NOT touch `js/schema.js`, do NOT touch `SYNCED_STORES`. (Keeps the blast radius off the F-invariants.)
- **Reuse, don't re-implement:** `escapeHtml` (js/dom-utils.js), `Utils.formatMs` (js/utils.js), `Platform.*`/`BgNotify.*`. Read meds via the live `MedsManager`, never `localStorage['wellness_meds']` (deleted post-F18).
- **No DOM in engine code** (`js/tempo-coach.js`, `js/rhythm-panel-today.js` stay pure — `render` returns a string).
- **`sw.js` cache bump required** (cached web files change): `stopwatch-v110-rhythm-insights-foundation` → `stopwatch-v111-tempo-coach`.
- **Lockstep wiring:** new `<script>` tags in `index.html` AND `tests/index.html` (if a new test file) AND the CLAUDE.md "Script Load Order" block must stay in sync.

## Test scope (engine-tester — extend the suite, run via tests/index.html in a browser)

- **NEW `tests/tempo-coach.test.js`** — the pure logic is the heavily-tested core:
  - `readinessBand`: well / strained / neutral / null (no-signal) mapping.
  - `suggestFocusDurationMs`: well→120m, strained→90m, neutral/null→null (no override); `reason` present when suggesting.
  - `doseSleepSlope`: happy path (clean monotonic pairs → `usable:true`, sensible `deltaMinutes`); **suppression paths** — <5 pairs, insufficient x-spread, noisy/unstable slope → `usable:false` + "not enough data" reason. Boundary at exactly the thresholds.
  - `buildTodayModel`: assembles correctly from fixture `deps`; **empty/sparse deps → a valid model with the empty-state flags set, never throws/NaN.**
  - `shouldNudge`: strained vs well copy, descriptive-only; no-signal → `nudge:false`.
- **NEW `tests/rhythm-panel-today.test.js`** — `build` over fixture `_deps` (populated / sparse / signed-out-empty); `render(model)` returns a non-empty string for each state and an empty-state card when there's no data; no `document` references.
- **`tests/flow.test.js`** (extend, if `js/flow.js` gains any helper) — only if engine code changed there; otherwise none.
- Whole suite must stay green (currently **815/815** — see the note below; the old "4 pre-existing failures" caveat is OBSOLETE).

## Out of scope (explicitly NOT in this PR — defer to follow-ups)

- A BFRB callout in the Today panel (would touch the bfrb_events/snapshot-divergence surface — defer).
- Any prescriptive "take it by X" dose-window recommendation (descriptive-first forbids it).
- The evening "Daily Review" ritual (separate persisted stream + state machine — its own future row).
- APNs push-to-update / native Live Activities (separate native milestone).
- Syncing the new prefs.

## Cleanups to fold in (pr-shipper, in the docs commit)

- Correct stale `CLAUDE.md` / tech-debt caveats surfaced by the brainstorm: the suite is **815/815 green** and all three F18 orphaned-`wellness_meds` readers + the recovery-feed NPE are merged — drop the "4 pre-existing recovery-feed failures" / "642/642" stale caveats where they appear in the backlog notes.
- In the SESSION-LOG entry, **flag (do NOT auto-close)** three stale open PRs for the user: **#104** (pomo-revert dup of merged work), **#91** (Live Activities, ~30 commits behind, zero refs in main), **#86** (native CAS/listener parity, ~33 behind).
- Tick the new milestone into the CLAUDE.md backlog/state-model (new keys: `flow_readiness_suggest`, `tempo_coach_nudge_enabled`, optional `tempo_coach_today_collapsed`).

## Deliverable

Branch `feat/tempo-coach-daily-loop`. **Commit on the branch, then STOP — do NOT push, do NOT open a PR** (the user approves the push separately; blast radius is HIGH). One commit: `feat(rhythm): Tempo Coach daily loop — Today panel + readiness Flow default + opt-in nudge`.
