# tempo-coach-daily-loop · Tempo Coach — readiness-aware daily decision loop (Today panel + readiness Flow default + opt-in morning nudge)

## Goal
Turn Tempo's already-computed correlations forward into a daily loop: a top-of-Insights "Today" briefing panel, a readiness-sized Flow focus-duration default, and an opt-in descriptive morning nudge. Every user-facing string is observational (descriptive-first), never imperative.

## Blast radius
**Tier:** high

**Justification:** Multi-layer in one PR — two NEW modules (engine `js/tempo-coach.js` + panel `js/rhythm-panel-today.js`) plus UI edits (`js/flow-ui.js`, `js/tempo-nav.js`, `index.html`, `css/styles.css`), two NEW test files, two/three new device-local persistence keys, and a mandatory `sw.js` cache bump. Per the rubric, "multi-layer touches (engine + UI + tests + new module in one PR)" alone forces high; "new module + `<script>` tag" and "`sw.js` cache bump needed" reinforce it. No sync-store, `js/schema.js`, `SYNCED_STORES`, `js/platform.js`, `package.json`, or `ios/*` changes (all explicitly out of scope), which keeps it off the F-invariants but does not lower the tier.

## Affected files

### ENGINE (engine-implementer — pure JS, no DOM)
| Path | Change type | Notes |
|------|-------------|-------|
| `js/tempo-coach.js` | add | New IIFE singleton holding ALL pure coach logic. Zero DOM, zero side-effects (returns decisions; callers act). Public surface: `readinessBand(recoveryState)` → `'well'\|'strained'\|'neutral'\|null`; `suggestFocusDurationMs(recoveryState)` → `{ ms: 5400000\|7200000\|null, band, reason }` (well→120m / strained→90m / neutral\|null→null); `doseSleepSlope(pairs)` → `{ usable, slope, intercept, nPoints, deltaMinutes, reason }` (least-squares with suppression guards: ≥5 usable pairs AND ≥1.5h x-spread AND slope stability, else `usable:false` + "not enough data yet"); `buildTodayModel(deps)` → assembled model from injected `_deps` accessors; `shouldNudge(recoveryState, now)` → `{ nudge, title, body }` (descriptive copy, no scheduling side-effect). Reuse `Utils.formatMs`; never re-derive. Mirror the well/strained classification language used by `js/rhythm-panel-correlations.js`. |
| `js/rhythm-panel-today.js` | add | New panel module. Self-registers `RhythmInsights.register({ key: 'today', title: 'Today', order: 5, build, render })` so it pins ATOP Insights (order 5 < meds-sleep's 10). `build(deps)` calls `TempoCoach.buildTodayModel` over `_deps`; `render(model)` returns a descriptive HTML **string** (never touches `document`) reusing the shared `card`/`empty`/SVG helpers. Empty-state is the DEFAULT path — renders local-only value (dose+sleep+focus) when there is no recovery feed; the recovery re-lens is strictly additive. All interpolated text via `escapeHtml`. Reuses the `firstDoseHourByDay × bedtimeHour` pairing idiom from `js/rhythm-panel-meds-sleep.js`. |

### UI (ui-wirer — DOM/wiring/styles; verify visually)
| Path | Change type | Notes |
|------|-------------|-------|
| `js/flow-ui.js` | modify | In the pre-block setup (`.flow-dur-btn` wiring near line 143–151), when `flow_readiness_suggest !== '0'`, call `TempoCoach.suggestFocusDurationMs(RecoveryFeed.getLatest())` and pre-select the matching `.flow-dur-btn` + show a one-line descriptive "why" (`reason`). User override always wins — selecting the other duration calls the existing `Flow.configure({ focusDurationMs })` path; never force-configure against the user's choice. `ms === null` → leave the existing persisted default untouched, render no "why" line. Read-only consumer of `TempoCoach.*`. **Load-order subtlety:** flow-ui loads well before the rhythm-panel block, so `js/tempo-coach.js` MUST load before `js/flow-ui.js` (see index.html note). |
| `js/tempo-nav.js` | modify | Two settings-drawer rows wired in the drawer-open path, mirroring the existing `wireCloudSync(drawer)` / `initTodoistSection(drawer)` idiom (tempo-nav.js:319–320). (1) **"Readiness suggestions"** — opt-OUT toggle (default ON), persists `flow_readiness_suggest` (`'0'`/`'1'`). (2) **"Morning readiness nudge"** — opt-IN toggle (default OFF), persists `tempo_coach_nudge_enabled`. On enable → `BgNotify.schedule(...)` with title/body from `TempoCoach.shouldNudge(...)`; on disable → `BgNotify.cancel(...)`. Reuse `[data-keep-drawer-open]` so toggling does not auto-close the drawer. |
| `index.html` | modify | (a) Two new `<script>` tags: `js/tempo-coach.js` then `js/rhythm-panel-today.js`. **`tempo-coach` must precede BOTH `rhythm-panel-today` (panel calls `TempoCoach.buildTodayModel`) AND `flow-ui` (calls `TempoCoach.suggestFocusDurationMs`).** Since `flow-ui` loads early (~line 1034 region) and the rhythm-panel block is at ~line 1116, the safe placement is `tempo-coach` early enough to precede `flow-ui`, and `rhythm-panel-today` inside the rhythm-panel block (panel order is irrelevant to `getPanels()` sort, only load-before-`rhythm-ui` matters). pr-shipper/ui-wirer finalize exact line. (b) Drawer markup: two new toggle rows inside `#tempo-settings-drawer`. |
| `css/styles.css` | modify | Today-panel layout (reuse `.rhythm-insight-card` / `.analytics-card*` / `.rhythm-callout*` rules — no new chart primitives), the "why" line under the Flow duration buttons, and the two drawer toggle rows matching the existing Cloud Sync / Todoist section spacing. No hardcoded pillar colors — CSS vars only. |

### TESTS (engine-tester — run via tests/index.html in a browser)
| Path | Change type | Notes |
|------|-------------|-------|
| `tests/tempo-coach.test.js` | add | New file. Heavily-tested pure core (see Test scope). `readinessBand` mapping, `suggestFocusDurationMs` bands + `reason`, `doseSleepSlope` happy path + all three suppression paths + boundary thresholds, `buildTodayModel` populated/sparse/empty (never throws/NaN), `shouldNudge` strained-vs-well descriptive copy + no-signal→`nudge:false`. |
| `tests/rhythm-panel-today.test.js` | add | New file. `build` over fixture `_deps` (populated / sparse / signed-out-empty); `render(model)` returns a non-empty string for each state + an empty-state card when no data; assert NO `document` references. |
| `tests/index.html` | modify (scope expansion allowed) | Add `<script src="../js/tempo-coach.js"></script>` (+ panel/`rhythm-insights` deps already present) to the engine-modules block and `<script src="tempo-coach.test.js"></script>` + `<script src="rhythm-panel-today.test.js"></script>` to the suite block. Suite must stay green (currently **815/815**). |

### DOCS + INFRA (pr-shipper — docs commit)
| Path | Change type | Notes |
|------|-------------|-------|
| `sw.js` | modify | Bump `CACHE_NAME`. Current value (line 1) is `'stopwatch-v110-rhythm-insights-foundation'` → `'stopwatch-v111-tempo-coach'` (per brief). pr-shipper validates the exact target at ship time (increment if a later `v111-` PR lands first). |
| `CLAUDE.md` | modify | Tick the milestone into the Feature Backlog; add the new keys to the State Model "Additional localStorage keys" list (`flow_readiness_suggest`, `tempo_coach_nudge_enabled`, optional `tempo_coach_today_collapsed`); add `js/tempo-coach.js` + `js/rhythm-panel-today.js` to the architecture file-map AND the Script Load Order block (in lockstep with `index.html`). **Fold in the brief's stale-caveat cleanups:** drop the obsolete "4 pre-existing recovery-feed failures" / "642/642" notes (suite is 815/815; all three F18 orphaned-`wellness_meds` readers + the recovery-feed NPE are merged). |
| `docs/SESSION-LOG.md` | modify | One session entry. **Flag (do NOT auto-close)** three stale open PRs for the user: **#104** (pomo-revert dup of merged work), **#91** (Live Activities, ~30 commits behind), **#86** (native CAS/listener parity, ~33 behind). |
| `docs/audits/tempo-coach-daily-loop-AUDIT.md` | add | This audit. |
| `docs/briefs/tempo-coach-daily-loop-BRIEF.md` | (exists) | Source brief — read-only input, listed for traceability. |

**Affected file count: 12** (2 engine add + 4 UI modify + 2 test add + 1 test-harness modify + sw.js + CLAUDE.md + SESSION-LOG.md + this audit). (The pre-existing brief is not counted as an affected file.)

## Cross-cutting invariants touched
- **DESCRIPTIVE-FIRST (the one non-negotiable)** — every user-facing string (Today panel, Flow "why" line, morning nudge) is observational, never imperative. No "take it by X" / "you should…" dosing or medical instruction anywhere, including the nudge. This is what keeps the milestone autonomously shippable (sidesteps clinical-framing ratification).
- **Empty-state-is-default** — the Today panel and every recovery-dependent surface MUST render cleanly and still add local value when `RecoveryFeed.getLatest()`/`getHistory()` is empty/stale/signed-out (the common case for an offline-leaning user). The recovery re-lens is strictly additive. This is a TESTED path, not a fallback.
- **Suppression guards on the slope** — `doseSleepSlope` never asserts a slope/correlation on thin or noisy data (≥5 usable pairs AND ≥1.5h x-spread AND slope stability, else "not enough data yet"). Mirrors the both-groups-have-data guard in `js/rhythm-panel-correlations.js`.
- **`sw.js` CACHE_NAME** — load-bearing. `index.html` + `css/styles.css` + new JS files change; cache bump mandatory or PWA installs serve stale assets indefinitely.
- **Script-load-order dependency graph** (no build step) — `js/tempo-coach.js` MUST load before `js/rhythm-panel-today.js` (panel calls `TempoCoach.*`) AND before `js/flow-ui.js` (pre-block default calls `TempoCoach.suggestFocusDurationMs`); both new files load before `js/rhythm-ui.js`. CLAUDE.md Script Load Order block + `index.html` + `tests/index.html` stay in lockstep.
- **`escapeHtml` (js/dom-utils.js)** — MANDATORY for any interpolated text in the Today panel render. Do NOT re-implement.
- **`Utils.formatMs` (js/utils.js)** — reuse for any time-formatting in copy. Do NOT re-implement.
- **`Platform.*` / `BgNotify.*` (js/bg-notify.js)** — the morning nudge schedules via `BgNotify.schedule(id, delayMs, title, body)` / cancels via `BgNotify.cancel(id)` (feature-detects web SW vs native LocalNotifications internally). Do NOT call `new Notification(...)` or `navigator.vibrate` directly.
- **Live `MedsManager` read** — dose-still-unlogged status reads `MedsManager.all()` + per-med `getDosesToday()`/`getStatusToday()`, NEVER `localStorage['wellness_meds']` (deleted post-F18 migration).
- **`js/schema.js` / `SYNCED_STORES` — explicitly NOT touched.** New keys are device-local; no `deviceId`/`updatedAt`/`schemaVersion` stamping, no synced store added. Keeps blast radius off F1–F21.
- **`js/platform.js` native bridges — not extended.** No new namespace; `BgNotify` already abstracts web-vs-native.
- **`package.json` — not touched.** No new dependency.

## Risks
| Risk | Likelihood | Blast radius | Mitigation |
|------|------------|--------------|------------|
| **Imperative/prescriptive copy slips into a string** (Today panel, Flow "why", or nudge body) — turns a descriptive insight into unratified medical instruction. | med | local-only (but milestone-blocking — re-opens clinical-framing question) | Descriptive-first is the one non-negotiable; the brief spells out allowed vs forbidden phrasings. `shouldNudge`/`buildTodayModel` copy is unit-tested for observational framing; sign-off checklist verifies no "take…"/"you should…"/dosing imperative. |
| **Recovery-dependent surface throws or renders blank when the feed is empty/signed-out** — the common offline-leaning case. | med | local-only (blanks the whole Today panel or breaks Flow pre-block) | Empty-state is the DEFAULT-rendered path, tested explicitly (`buildTodayModel` sparse/empty → valid model with empty-state flags, never NaN; `render` empty-state card). `_deps` accessors are already null-safe (`getRecoveryHistory()` → `{rows:[]}` when signed out). |
| **Slope asserted on thin/noisy data** — `doseSleepSlope` narrates a correlation that isn't there. | med | local-only (misleading insight) | Suppression guards (≥5 pairs, ≥1.5h x-spread, slope stability) with boundary-threshold tests; falls back to "not enough data yet". This is the well-tested part of the suite. |
| **`sw.js` cache-bump miss** — existing PWA installs serve stale JS, hiding the whole feature until SW expiry. | med | web-bytes | pr-shipper checklist + sign-off both verify the bump (`v110` → `v111-tempo-coach`). Smoke step 1 catches it (no "Today" panel atop Insights). |
| **Load-order regression** — `js/tempo-coach.js` placed after `js/flow-ui.js` (or after the panel) → `TempoCoach is not defined` at pre-block / panel build. | med | local-only (Flow pre-block default silently no-ops or throws) | Affected-files note pins the constraint; panel + flow-ui guard `typeof TempoCoach !== 'undefined'` (RhythmInsights panel idiom). CLAUDE.md Script Load Order + index.html + tests/index.html kept in lockstep. |
| **Morning nudge fires at the wrong time / duplicates / fails to cancel** — opt-in toggle wires `BgNotify.schedule`/`cancel` incorrectly, or stacks daily schedules. | low | local-only | Default OFF (opt-in). `shouldNudge` is a pure decision (no side-effect); the toggle owns scheduling with a single stable notification `id` so re-enable replaces rather than stacks; disable always `cancel`s. No-signal → `nudge:false` (no schedule). |
| **Flow readiness default overrides the user's explicit choice** — pre-selection force-configures and the user's manual tap is lost. | low | local-only | User override always wins: pre-selection only sets the default control; the existing `.flow-dur-btn` handler still calls `Flow.configure` on tap. `ms === null` leaves the persisted default untouched. Opt-out via `flow_readiness_suggest='0'`. |
| **New prefs leak into Export/Backup** — device-local UI prefs should not travel. | low | local-only | New keys are NOT added to `EXPORT_SETTINGS_KEYS` (opt-in allowlist in `js/export.js`). Sign-off verifies non-membership. |
| **Today panel XSS via interpolated med name / copy** — unescaped med name or recovery string in the rendered HTML string. | low | local-only | All interpolated text via `escapeHtml` (panel renders a string, RhythmInsights injects it). Sign-off verifies. |

**Risk count breakdown:** 9 total — 4 low / 5 med / 0 high.

## Test scope
- **New tests required:**
  - `tests/tempo-coach.test.js` — the heavily-tested pure core:
    - `readinessBand`: well / strained / neutral / null (no-signal) mapping.
    - `suggestFocusDurationMs`: well→120m, strained→90m, neutral/null→null (no override); `reason` present when suggesting.
    - `doseSleepSlope`: happy path (clean monotonic pairs → `usable:true`, sensible `deltaMinutes`); suppression paths — <5 pairs, insufficient x-spread, noisy/unstable slope → `usable:false` + "not enough data" reason; boundary at exactly the thresholds.
    - `buildTodayModel`: assembles correctly from fixture `deps`; empty/sparse deps → valid model with empty-state flags set, never throws/NaN.
    - `shouldNudge`: strained vs well copy (descriptive-only); no-signal → `nudge:false`.
  - `tests/rhythm-panel-today.test.js` — `build` over fixture `_deps` (populated / sparse / signed-out-empty); `render(model)` returns a non-empty string for each state and an empty-state card when there's no data; no `document` references.
- **Existing tests at risk:** none directly. The engine-test harness loads engine modules only; the UI edits (`flow-ui.js`, `tempo-nav.js`) are not under test. `tests/flow.test.js` is touched ONLY if `js/flow.js` gains a helper — the brief does not require an engine change there, so expect none. Whole suite must stay green (815/815; the old "4 pre-existing recovery-feed failures" caveat is OBSOLETE — fixed and merged).

## Manual setup steps (if any)
None required to build. Smoke verification (ui-wirer via kapture):
1. After cache bump, hard-reload; confirm a **"Today"** card renders ATOP `#/rhythm/insights` (order 5), descriptive copy only.
2. Sign out / no recovery feed → Today panel still renders local value (dose+sleep+focus), no throw, no blank.
3. Flow pre-block (`#/timers/flow`, status idle): with a `well` signal the 120-min control is pre-selected + a "why" line shows; with `strained` the 90-min control; with no signal the existing default is untouched and no "why" line. Manually tapping the other duration overrides and persists.
4. Settings drawer: "Readiness suggestions" defaults ON, toggles + persists `flow_readiness_suggest`; toggling OFF removes the pre-block pre-selection.
5. "Morning readiness nudge" defaults OFF; enabling schedules a descriptive heads-up via `BgNotify`; disabling cancels it.
6. (Optional, iOS) re-verify nudge schedules natively (LocalNotifications).

## Out of scope (explicitly NOT in this PR)
- A BFRB callout in the Today panel (would touch the bfrb_events/snapshot-divergence surface — defer).
- Any prescriptive "take it by X" dose-window recommendation (descriptive-first forbids it).
- The evening "Daily Review" ritual (separate persisted stream + state machine — its own future row).
- APNs push-to-update / native Live Activities (separate native milestone).
- Syncing the new prefs (`flow_readiness_suggest` / `tempo_coach_nudge_enabled` stay device-local; `SYNCED_STORES` untouched).
- `js/schema.js` / `SYNCED_STORES` / `js/platform.js` / `package.json` / `ios/*` changes.

## Sign-off checklist (for the implementer)
- [ ] Engine module changes match the affected-files table (`js/tempo-coach.js`, `js/rhythm-panel-today.js` added; both pure, no `document`).
- [ ] Test scope above is covered (`tests/tempo-coach.test.js` + `tests/rhythm-panel-today.test.js`); existing 815-case suite still green.
- [ ] **Descriptive-first:** no imperative dosing/medical copy in the Today panel, the Flow "why" line, or the nudge body. Verified against the brief's allowed/forbidden examples.
- [ ] **Empty-state is the default-rendered path** — Today panel + Flow pre-block render cleanly with `RecoveryFeed.getLatest()`/`getHistory()` empty/signed-out; covered by a test.
- [ ] **Suppression guards** on `doseSleepSlope` (≥5 pairs, ≥1.5h x-spread, slope stability → else "not enough data yet"); boundary cases tested.
- [ ] No re-implementation of `escapeHtml` (js/dom-utils.js) / `Utils.formatMs` (js/utils.js) / `Platform.*` / `BgNotify.*`. Meds read via live `MedsManager`, never `localStorage['wellness_meds']`.
- [ ] `sw.js` `CACHE_NAME` bumped — `'stopwatch-v110-rhythm-insights-foundation'` → `'stopwatch-v111-tempo-coach'` (or increment if a later `v111-` PR landed first).
- [ ] (Not a sync PR) `js/schema.js` unchanged, `SYNCED_STORES` unchanged — no synced-store writes; no `deviceId`/`updatedAt`/`schemaVersion` stamping on the new keys.
- [ ] New keys (`flow_readiness_suggest`, `tempo_coach_nudge_enabled`, optional `tempo_coach_today_collapsed`) are NOT added to `EXPORT_SETTINGS_KEYS`.
- [ ] Script-load order: `js/tempo-coach.js` before `js/flow-ui.js` AND before `js/rhythm-panel-today.js`; both before `js/rhythm-ui.js`. CLAUDE.md Script Load Order block + `index.html` + `tests/index.html` in lockstep.
- [ ] User override wins in Flow pre-block — pre-selection never force-`configure`s against a manual tap; `ms === null` leaves the existing default untouched.
- [ ] Drawer toggles persist correctly (Readiness suggestions default ON; Morning nudge default OFF) and use `[data-keep-drawer-open]` so flipping them does not auto-close the drawer.
- [ ] Docs cleanup folded into the docs commit: stale "642/642" / "4 pre-existing recovery-feed failures" caveats dropped; #104 / #91 / #86 flagged (NOT auto-closed) in SESSION-LOG.

## Open questions for the user
- **None blocking.** One ack to confirm at the audit pause: the brief leaves `tempo_coach_today_collapsed` (Today-panel collapse state) **optional** — include it only if a collapse toggle is added to match other panels; otherwise drop the key. Default assumption: include the toggle for parity, persisting the key.
