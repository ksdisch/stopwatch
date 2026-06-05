# Tempo — Feature Backlog (detailed)

This is the **full detail** for the feature backlog. `CLAUDE.md` carries a lean
summary table (priority / feature / impact / effort / one-line status) and points
here; this file holds the per-item scope, shipped post-mortems, risks, and the
resolved tech-debt history.

Reordered by impact-vs-effort ROI (best return for effort first), not
chronologically. The previous chronological numbering is preserved in the
"Added" column so the decision history stays visible.

## Candidate next milestones (2026-06-05 brainstorm)

Vetted milestone menu from [`docs/brainstorm/2026-06-05-milestone-brainstorm.md`](brainstorm/2026-06-05-milestone-brainstorm.md)
(full recon, weighted scoreboard, and deep dives there). The brainstorm's top two
recommendations have since **shipped**: #1 BFRB Closed Loop → backlog #16, #2 Tempo Coach →
backlog #15. The remaining ranked candidates are the live menu for the next autonomous milestone:

| Board | Candidate | Verdict | One-line why |
|------|-----------|---------|--------------|
| — | **BFRB Closed Loop — Slice B** | Deferred from #16 | Real-time relapse-risk meter + post-countdown debrief; the framing-risky, opt-in half intentionally cut from the shipped Slice A. |
| 8.5 | **Personal Health Hub — Weekly Review + portable doctor-ready report** | Strong, ship-soon | Cleanest autonomy (pure string-producing functions, no native/Firebase-write path); novel doctor-prep export. Docked for being a 3-feature bundle and reflective rather than forward-looking. |
| 8.45 | **Med Runway & Adherence Loop** | Strong, split-ship | Highest concrete stakes (controlled-substance refill/dose); pure runway/streak half is a clean win, nudge half is the least self-verifiable piece. |
| 8.45 | **Personal Health Intelligence Engine** | Right idea, overscoped | Correct long-term consolidation but bundles 5–7 deliverables incl. a 7th synced store + cross-cutting refactor; descope to the pure `insight-engine.js` core. |
| 6.9 | **Tempo Presence — Live Activities / widgets / Siri** | Defer / split | Overlaps backlog #4 (iOS Live Activities). Four products in a trenchcoat + long Apple-paperwork tail; ship only the web-only depleting-wedge slice standalone. |
| 6.65 | **Tempo Proving Ground — UI test harness + kit** | Sequence under, not instead | Highest-autonomy class + real velocity floor, but zero direct user payoff; ship the harness-only slice *after* a user-facing feature. |
| 6.0 | **HealthKit two-way bridge** | Sequence later | Removes the most-forgotten manual input, but a from-scratch Swift plugin with double-write risk; best paired after the intelligence loop proves out. |

## Summary table

| Priority | Feature | Impact | Effort | Added | Status |
|----------|---------|--------|--------|-------|--------|
| 1 | Native iOS app via Capacitor — App Store distribution | High | Medium | #8 | Shipped to personal device; App Store paperwork remaining |
| 2 | Todoist integration — two-way Todoist ↔ Flow/Pomodoro task lists | High | Medium | #10 | Pomo V1 shipped (#bl-2-todoist); Flow + rename in follow-ups #9/#10 below |
| 3 | Cloud sync — native CAS + listener parity (`@capacitor-firebase/firestore`) | Medium | Medium | #7 | **Unshipped** — last cloud-sync piece |
| 4 | iOS Live Activities — lock screen + Dynamic Island | High | High | #9 | **Unshipped** — unlocked by #1 |
| 5 | Pomodoro phase revert — "Go back" | Medium | Low | #11 | Shipped (PR #104) |
| 6 | Split-screen timer comparison | Medium | High | #2 | **Unshipped** |
| 7 | Voice control | Low | Medium | #3 | **Unshipped** |
| 8 | Group/team timing | Low | High | #5 | **Unshipped** — needs a backend |
| 9 | Todoist follow-up A — Flow user-task list | High | Medium | #10-A | Shipped (PR #102) |
| 10 | Todoist follow-up B — Pomo inline-rename + `updateTask` | Low | Low | #10-B | Shipped (PR #103) |
| 11 | Sleep log bedtime/wake-time schema extension | Medium | Low | #12 | Shipped 2026-06-01 (bundled with #12) |
| 12 | Rhythm insights section — multi-chart dashboard | High | Medium | #13 | Shipped 2026-06-01 (all 7 panels) |
| 13 | Bugfix: Rhythm Timeline dose dots read deleted `wellness_meds` blob | Medium | Low | #14 | Shipped 2026-06-03 |
| 15 | Tempo Coach — readiness-aware daily decision loop | High | Medium | #15 | Shipped 2026-06-05 (PR merged) |
| 16 | BFRB Closed Loop — antecedent capture + Triggers panel | High | Medium | #16 | Shipped 2026-06-05 (PR #126) |

---

## Unshipped (forward-looking)

### #3 — Cloud sync: native CAS + listener parity for `@capacitor-firebase/firestore` (Medium / Medium)

**Last unshipped piece of the cloud-sync initiative.** `SyncFirestore.runTransaction`
(queued from E-1b) and `SyncFirestore.subscribe` (queued from E-3) are both web-only —
the native branches throw an explicit "native parity pending" normalized error. Single
follow-up PR should pair `addSnapshotListener` + `runTransaction` for
`@capacitor-firebase/firestore` so iOS sync uses real-time listeners + atomic CAS like
the web build does. Currently on native, sync still works through the 5-min defensive
polling path + per-record `setDoc` fallback — fully functional but degraded. Requires
Xcode + device for verification.

### #4 — iOS Live Activities: running timers on the lock screen + Dynamic Island (High / High)

iOS-only via ActivityKit (iOS 16.1+). User wants the active timer / stopwatch glanceable
on the lock screen without unlocking — Dynamic Island support comes free with the same
activity. Setting in the Tempo drawer to toggle on/off (default ON, since iOS prompts for
permission on first activity anyway). **Scope to confirm at implementation:** which engines
start an activity — minimum ask is `Timer` + `Stopwatch`; `Pomodoro` / `Flow Block` /
`Interval` / `Cooking` all plausibly benefit from lock-screen presence. One activity at a
time (when the primary instance changes, swap) vs concurrent (iOS allows multiple but gets
noisy — recommend one). **Implementation outline:** new Widget Extension target in
`ios/App/App.xcodeproj`, SwiftUI views for lock-screen + compact/expanded Dynamic Island
layouts, `NSSupportsLiveActivities = true` in `Info.plist`. JS-side bridge: custom Capacitor
plugin (preferred for control) or `@capacitor-community/live-activity` (community, spotty).
Engines emit start/end via `Platform.liveActivity.{start,update,end}` keyed by instance id.
Drift-free engines make this cheap — the activity stores `endsAt` (timer) or
`startedAt + accumulatedMs` (stopwatch) and the lock-screen UI renders `(endsAt - now)`
locally, no per-tick push needed. **Out of scope first pass:** APNs Push-to-Update (local
ActivityKit updates suffice for drift-free engines), Android "ongoing notification"
equivalent (separate effort). **Unlocked by:** item #1 (Capacitor wrapper already shipped).

### #6 — Split-screen timer comparison (Medium / High)

Side-by-side two timers. Requires significant layout rework.

### #7 — Voice control (Low / Medium)

Web Speech API SpeechRecognition. Commands: "start", "stop", "lap", "reset".

### #8 — Group/team timing (Low / High)

WebRTC or shared URL with server sync. Major scope expansion — would need a backend.

---

## Shipped (post-mortems)

### #1 — Native iOS app via Capacitor — App Store distribution (High / Medium)

**Status: shipped to personal device; App Store paperwork remaining.** Capacitor wrapper
landed in #45 (commit `72eb338`): `capacitor.config.json` (appId `com.ksdisch.tempo`,
appName "Tempo"), committed Xcode project at `ios/`, `js/platform.js` abstraction layer
wrapping all 23 haptic call sites + 6 notification sites (web → `navigator.vibrate` /
`new Notification`; native → `@capacitor/haptics` + `@capacitor/local-notifications`),
`scripts/sync-www.mjs` mirrors repo root → `www/` for `cap copy`. Web build is
byte-equivalent — same `git push` → GitHub Pages flow. Daily workflow + 7-day free-cert
refresh playbook lives in `iOS-BUILD.md`. **Remaining for App Store distribution:** $99/yr
Apple Developer Program enrollment, App Store Connect record, TestFlight or App Store
submission, privacy nutrition labels (meds + BFRB are health data), App Review screenshots,
age rating, 1024×1024 app icon polish. **Explicitly out of scope:** `BGTaskScheduler` (not
needed — `LocalNotifications` schedules at OS level + engines are drift-free), Capacitor
Preferences migration (`localStorage` survives in `WKWebView`). **Background ambient audio
(addressed 2026-05-26):** ambient noise used to stop the instant Tempo was backgrounded
because iOS suspends WKWebView Web Audio. Fixed natively — `Info.plist` `UIBackgroundModes`=`audio`
+ `AVAudioSession` `.playback` (no `.mixWithOthers`, so noise takes over the now-playing
session) set in `AppDelegate.didFinishLaunchingWithOptions`. Category-only (no `setActive`)
so the WebView activates the session on play rather than grabbing audio focus at launch.
**Needs on-device verification** (couldn't be tested in the web-only session that shipped
it); if background playback still cuts out, the follow-up is explicit session activation
tied to `SFX.startAmbient` (likely a tiny Capacitor plugin).

### #2 — Todoist integration — two-way sync between Todoist and Flow / Pomodoro task lists (High / Medium)

**Status: Pomo V1 shipped (PR #bl-2-todoist, 2026-05-28). Flow integration + Pomo
inline-rename deferred to follow-up rows #9/#10.** Pull tasks from Todoist directly into the
Flow pre-block checklist and the Pomodoro saved-task list, with completion / rename / create
propagating back to Todoist. **Scope:** (1) Settings drawer "Todoist" section — paste personal
API token (from Todoist › Settings › Integrations), "Test connection" button, default project
picker for new tasks (defaults to Inbox), editable default filter (defaults to `today`).
(2) Shared picker modal (`js/todoist-ui.js`) — opened by an "Import from Todoist" button in
both Flow pre-block + Pomodoro saved tasks; lists tasks matching the user's filter,
multi-select, "Add to focus". (3) Imported tasks store the Todoist `id` on the local task
object (additive nullable `todoistId?` on Pomodoro saved tasks + Flow checklist items — no
`SCHEMA_VERSION` bump). (4) **Write-back surface:** check off in Tempo → `POST /tasks/{id}/close`;
uncheck → `POST /tasks/{id}/reopen`; new task in Tempo → `POST /tasks` with `content` +
configured `project_id`; rename in Tempo → `POST /tasks/{id}` with new `content`. **Hard guard:**
delete in Tempo does NOT delete in Todoist — just unlinks locally (an oops in Tempo must not
nuke the user's real task list). (5) **Refresh policy:** re-pull on import-modal open AND on
tab refocus (`visibilitychange:visible`); reconciles imported-but-still-active session tasks
against any closures the user did in the Todoist app itself. No polling. (6) **Offline writes**
queue in `todoist_pending_ops` localStorage; drained on `online` + visibility-visible.
Idempotent close/reopen makes retries safe. **Files:** `js/todoist.js` (REST v2 client — token
mgmt, getTasks/closeTask/reopenTask/createTask/updateTask, offline queue, normalized errors);
`js/todoist-ui.js` (picker modal + settings panel wiring); edits to `js/pomodoro-ui.js`,
`js/flow-ui.js`, `js/tempo-nav.js`, `index.html`, `css/styles.css`; sw.js cache bump.
**iOS:** zero extra work — pure REST/CORS via `fetch`, WKWebView handles it. **Token storage:**
localStorage `todoist_api_token` — **device-local, NOT synced via Firestore** (don't sync
credentials). User re-pastes on each device. **Cloud sync interaction:** Pomodoro task lists +
Flow checklist remain outside the Firestore sync set (unchanged); two devices reconcile via
Todoist itself as the source of truth on next refresh. **Risks:** (a) deletion guard above;
(b) text-edit last-write-wins — Todoist refresh wins ties (unlikely to edit both within the
same second in practice); (c) task deleted in Todoist mid-session → show "Removed from Todoist"
tooltip on next refresh, don't auto-remove from active session; (d) rate limit (Todoist:
1000 req / 15 min / token — single-user app is nowhere near). **Tests:** mock-fetch coverage of
API client, offline-queue drain, idempotent retry. **Auth alternative considered:** OAuth 2.0 —
rejected because Tempo has no backend to hold the OAuth client secret; personal API token is
the standard pattern for PWAs against Todoist.

### #5 — Pomodoro phase revert — "Go back" to previous work or break phase (Medium / Low)

**Status: shipped (PR #104, 2026-05-29).** Single-level undo for Pomodoro phase transitions.
`js/pomodoro.js` captures `previousPhaseSnapshot = { phase, cycleIndex, accumulatedMs }` at the
top of every `nextPhase()` call; `revertPhase()` folds elapsed time from the new phase back into
the restored phase's accumulated total. "← Go back" link in the `pomo-action-links` row — visible
only when snapshot exists AND status is `'running'`\|`'paused'`. Click handler calls
`cancelAutoAdvance()` → `revertPhase()` → `savePomodoroState()` → `updatePomodoroUI()`. One-level
undo; snapshot clears on `reset()` and on each subsequent `nextPhase()`. 9 new engine tests in
`tests/pomodoro.test.js` (the recovery-feed failures noted at ship time were since fixed
2026-06-03 — suite is now fully green). **Shipped files:** `js/pomodoro.js`, `js/pomodoro-ui.js`,
`index.html`, `tests/pomodoro.test.js`, sw.js cache bump (`v103-pomo-rename` → `v104-pomo-revert`).

### #9 — Todoist integration follow-up A — Flow user-task list + Todoist integration (High / Medium)

**Status: shipped (PR #102, 2026-05-29).** Deferred half of backlog row #2. Tempo's Flow
pre-block "checklist" is a hardcoded 5-item ritual (`FLOW_CHECKLIST_ITEMS` in `js/flow-ui.js`),
not a user-editable list — so the Pomo V1 PR (#bl-2-todoist, 2026-05-28) couldn't add Todoist
imports there directly. This follow-up added a user-editable "Tasks for this block" section to
the Flow setup + running views alongside the ritual checklist (new localStorage key
`flow_user_tasks` — shape `Array<{ text, todoistId?, done, localTag? }>`, non-synced), wired it
into the Flow active session UI (per-block "Tasks: N/M done" count + a "Tasks N/M" summary-card
row + conditional history capture), and reused `TodoistUI.openPicker({ onImport })` from PR
#bl-2-todoist unchanged (no engine changes — `js/todoist.js` already shipped everything required).
Two-way write-back: check/uncheck → `closeTask`/`reopenTask`; add → `createTask`; **delete stays
local (hard guard — never deletes in Todoist).** Per RATIFIED DECISION 8, `flow_user_tasks` is
included in `EXPORT_SETTINGS_KEYS` with Todoist linkage stripped (backup parity with
`pomodoro_saved_tasks`) while staying OUT of Firestore `SYNCED_STORES`. **Shipped files:**
`js/flow-ui.js`, `index.html`, `css/styles.css`, `js/export.js` (+`tests/export.test.js` —
6 new cases), sw.js cache bump (`v101` → `v102-flow-tasks`).

### #10 — Todoist integration follow-up B — Pomo inline-rename + Todoist updateTask (Low / Low)

**Status: shipped (PR #103, 2026-05-29).** Deferred from backlog row #2 V1. Added click-to-edit
on Pomodoro saved-task rows scoped to `#pomo-saved-tasks-items` via a `data-saved-rename-idx`
hook (NOT the shared `.pomo-checklist-item-text` class — audit drift correction: the real markup
is `<span class="pomo-checklist-item-text">`, and saved rows have no drag-reorder handle): click →
`contentEditable` + select-all, Enter commits, Escape cancels, blur commits with trim/newline-strip
+ empty-or-unchanged revert. On commit, persists locally + fire-and-forget
`Todoist.updateTask(todoistId, { content })` guarded by `todoistId && !localTag`. Added
`Todoist.updateTask(id, { content })` to `js/todoist.js` (V1 shipped
`closeTask`/`reopenTask`/`createTask` only) + a new idempotent offline-queue op kind `'update'`
(same `todoist_pending_ops` key, no schema bump). `deleteTask` stays absent (hard guard).
**Shipped files:** `js/todoist.js`, `js/pomodoro-ui.js`, `css/styles.css`, `tests/todoist.test.js`
(8 new cases), sw.js cache bump (`v102-flow-tasks` → `v103-pomo-rename`).

### #11 — Sleep log bedtime/wake-time schema extension (Medium / Low)

**Status: shipped 2026-06-01 (Rhythm Insights dashboard PR — bundled with #12).** Shipped in
`js/recovery-ui.js`: optional Bedtime + Wake `<input type="time">` on the sleep form (additive
nullable `"HH:MM"`, no migration), captured only when filled, with a `wake−bed mod 24` "in bed Nh"
cross-check line in the logged view. `setSleep` unchanged (Object.assign carries the new keys;
`rest_log` already syncs). Prerequisite for backlog row #12 (Rhythm insights). Adds optional
`bedtime` and `wakeTime` timestamp fields to each day's `sleep` entry in `wellness_rest_log`
(shape becomes `sleep: { hours, quality?, bedtime?, wakeTime? }`). Additive nullable — no migration
needed, existing hours+quality logging is unchanged. **UI:** two optional time-picker inputs
("Bedtime" + "Wake time") in the Recovery sleep log form; if both are filled, `wakeTime - bedtime`
is shown as a cross-check against the manually entered `hours`. **Why this is its own row:** the
Meds vs. Sleep chart in row #12 needs sleep *onset timing* (not just duration/quality) to show
whether earlier Vyvanse doses correlate with earlier sleep; without these timestamps the
correlation is blind to when sleep actually happened. **Sync:** `wellness_rest_log` is already in
`SYNCED_STORES` (`rest_log`) — the new fields sync automatically with no registry change.
**Files:** `js/recovery-ui.js` (form inputs + persist), `css/styles.css`.

### #12 — Rhythm insights section — multi-chart dashboard (High / Medium)

**Status: shipped 2026-06-01 (Rhythm Insights dashboard PR — all 7 panels).** Built via a
registry pattern: a `js/rhythm-insights.js` foundation (registry + DI data layer + shared
inline-SVG helpers + `renderInto` with per-panel `Promise.allSettled` isolation) plus seven
self-registering `js/rhythm-panel-*.js` modules (meds-sleep / recovery-trends / focus-minutes /
bfrb-frequency / distraction-rollup / event-zoom / correlations). `RhythmUI.render(sub)` gained a
Timeline\|Insights sub-nav (tempo-nav single-router). The foundation + flagship Meds-vs-Sleep panel
were built in-session; the other 6 panels by parallel subagents (1 new JS + 1 test file each, zero
shared-file edits — wired centrally). Tests: +59 cases (`tests/rhythm-insights.test.js` + 6
`tests/rhythm-panel-*.test.js`), browser-verified 808 total / 802 pass (the 6 failures are the
pre-existing recovery-feed + time-of-day rhythm-engine flakies). All 7 panels visually verified at
390px. sw.js `v105→v106-rhythm-insights`. Overhaul the Rhythm tab from a single-day event list into
a multi-panel insights dashboard with trend charts and correlation callouts. **Panels (in
ship-priority order):** (1) **Meds vs. Sleep chart** *(requires row #11 first)* — scatter/overlay
over 14 days: x-axis = Vyvanse dose time (hour of day), y-axis = sleep onset (bedtime), dot size =
sleep duration, dot color = quality score (1–5, red→green gradient). Goal: visually surface whether
earlier doses correlate with earlier sleep onset, so the user can fine-tune dosing timing to improve
sleep. (2) **Recovery trends** — 14-day sparklines for HRV (ms), ACWR, and RHR already cached in
`recovery-feed.js`; just need rendering. (3) **Focus minutes per day** — bar chart from
`History.getSessions()` aggregated by day, filtered to productivity types (flow/pomodoro).
(4) **BFRB frequency** — line chart from `bfrb_events` by day, 14-day window. (5) **Distraction
rollup** — category breakdown from `flow_distractions` + `pomodoro_distractions` (top categories,
trends over time). (6) **Multi-day event zoom-out** — week/month condensed view of the existing
event timeline. (7) **Correlation callouts** — derived plain-language insights cross-referencing
data streams (e.g., "avg focus +40% on well-recovered days", "BFRB catches 2× higher on strained
days"). **Architecture:** new `js/rhythm-insights.js` aggregation engine + new insights panel section
inside `js/rhythm-ui.js`. All data already available locally — no new network calls. Charts via
vanilla SVG (inline, no charting library — consistent with no-build-step constraint). Sub-nav toggle
between "Timeline" (current daily view) and "Insights" (new panel).

### #13 — Bugfix: Rhythm Timeline dose dots read the deleted legacy `wellness_meds` blob (Medium / Low)

**Status: shipped 2026-06-03 (`fix(rhythm)` PR, branch `fix/rhythm-timeline-meds-source`).**
`js/rhythm-engine.js` `getDoseEntries()` now reads the live `MedsManager.all()` + each med's
`getDoseLog()` (mirroring the Insights Meds-vs-Sleep panel + `js/rhythm-insights.js` `_deps`)
instead of `localStorage['wellness_meds']`, which `js/meds.js`'s F18 per-record migration
(`_migrateLegacyBlob`, `meds.js:549`) deletes after migrating to `meds/{medId}`. Pre-fix, the
Rhythm **Timeline** view silently rendered **no medication dose events** post-migration; the
Insights panel was already unaffected. Emitted entry shape is unchanged (`{ time,
type:'dose-logged', module:'meds', pillar:'wellness', summary, metadata:{ medId, medName, dose } }`).
`tests/rhythm.test.js` re-seeds the dose cases via the live manager (`MedsManager.clear()` →
`add()` → `med.logDose()`) and adds a regression-lock test that proves the engine ignores a
lingering `wellness_meds` blob; browser-verified green (the recovery-feed NPE failures were fixed
2026-06-03 — suite is now fully green), plus a live smoke (logged dose → ◆ dose dot on Timeline).
**Follow-up (all three FIXED 2026-06-03):** the two *other* readers of the same deleted blob —
`js/analytics.js` `getMedAdherence()` and `js/export.js` (`buildBackupData` + restore `meds/*`
sweep) — are now both fixed and merged; see "Resolved tech debt" below.

### #15 — Tempo Coach — readiness-aware daily decision loop (High / Medium)

**Status: shipped 2026-06-05 (`feat(rhythm)` PR, branch `feat/tempo-coach-daily-loop`; HIGH blast
radius).** Turns Tempo's already-computed correlations *forward* into a daily loop, all strings
**descriptive-first** (observational, never imperative — sidesteps clinical-framing ratification).
Three surfaces: (1) a top-of-Insights **"Today"** briefing panel (`js/rhythm-panel-today.js`,
order 5 — pins atop; empty-state is the DEFAULT path, delivering local-only dose+sleep+focus value
when there's no recovery feed, recovery re-lens strictly additive); (2) a **readiness-sized Flow
focus default** (`js/flow-ui.js` pre-block pre-selects 120m on a `well` signal / 90m on `strained`
with a one-line descriptive "why"; user override always wins; `ms === null` leaves the persisted
default untouched; opt-out via `flow_readiness_suggest`); (3) an **opt-in morning nudge** (default
OFF, `tempo_coach_nudge_enabled`; schedules a descriptive heads-up via `BgNotify.schedule(...)`,
cancels on disable). All pure logic lives in the new `js/tempo-coach.js` engine (`readinessBand` /
`suggestFocusDurationMs` / `doseSleepSlope` with ≥5-pairs + ≥1.5h-x-spread + slope-stability
suppression guards / `buildTodayModel` / `shouldNudge` — zero DOM, zero side-effects). No sync-store /
`js/schema.js` / `SYNCED_STORES` / `package.json` / `ios/*` changes (new keys are device-local, NOT
synced, NOT in `EXPORT_SETTINGS_KEYS`). **Shipped files:** `js/tempo-coach.js`,
`js/rhythm-panel-today.js`, `js/flow-ui.js`, `js/tempo-nav.js`, `index.html`, `css/styles.css`,
`tests/tempo-coach.test.js`, `tests/rhythm-panel-today.test.js`, `tests/index.html`, sw.js cache
bump (`v110-rhythm-insights-foundation` → `v111-tempo-coach`). **Tests:** all 46 new Tempo Coach
cases pass; suite **895/895 green** (foreground tab). Independently browser-verified 2026-06-05
incl. live Today panel + Flow readiness pre-select. (2 sync-engine `startSteadyState` tests fail
ONLY when `tests/index.html` runs in a *backgrounded* tab — a pre-existing `visibilityState`
test-isolation gap, NOT this PR; root-caused + fixed in PR #125.)

### #16 — BFRB Closed Loop — antecedent capture + Triggers panel + forgiving clean-streak (High / Medium)

**Status: shipped 2026-06-05 (`feat(bfrb)` PR #126, branch `feat/bfrb-closed-loop`).** Turns every
BFRB catch from a bare count into a Habit-Reversal-Training loop — captures *why* (urge 1–3 + one
trigger chip) and surfaces the patterns + a forgiving clean-streak. **Slice A only** (the risk-meter
+ post-countdown debrief are a deferred Slice B). **Engine** (`js/bfrb-events.js`): nullable additive
`urgeLevel` (1–3) + `triggerZone` (short string) + an optional `takenAt` override, all folded into
the SAME `log()` call — **no `SCHEMA_VERSION` bump**, `(deviceId, takenAt)` dedup sig provably
unchanged (test-locked). The single-call rule is load-bearing: `sync-merge-bfrb` keeps the CLOUD copy
on a sig collision (no LWW), so a post-hoc patch of an already-synced catch is silently dropped —
forcing a **deferred-single-commit** capture. **Capture UI** (`js/global-bfrb.js`): an optional 1–2
tap urge+trigger popover above the FAB; the catch is held as one `pending` entry and committed once on
Done / click-outside / a new catch / any app-lifecycle exit (`pagehide`/`visibilitychange`/`beforeunload`/route)
/ a 30s idle backstop — never lost, never racing the user; the 60s competing-response countdown +
haptic still fire instantly. `TRIGGER_CHIPS` (`stress·bored·tired·focused·idle`) is the single
human-ratification surface. **Panel** (`js/rhythm-panel-bfrb-triggers.js`, order 45): reads the LIVE
`BfrbEvents.getAll()` stream via `deps.getBfrbEvents`; a forgiving clean-streak hero (**a fixed
no-catch WINDOW of elapsed time** — never "days with no catch logged", which would reward not-logging),
a 14d trigger leaderboard + untagged bucket, and an urge mix. Reuses `.analytics-streak-*` +
`.analytics-distraction-*` CSS; catch days get an amber dot. **Shipped files:** `js/bfrb-events.js`,
`js/global-bfrb.js`, `js/rhythm-panel-bfrb-triggers.js`, `css/styles.css`, `index.html`,
`tests/index.html`, `CLAUDE.md`, `tests/bfrb-events.test.js` (+6), `tests/bfrb-triggers.test.js`
(+17, new), sw.js cache bump (`→ v112-bfrb-closed-loop`). **Tests:** suite **918/918 green** after
merging main. Live-verified at 390px: all commit paths (chips+Done, click-outside, new-catch flush),
populated/empty panel states, no console errors.

---

## Resolved tech debt (kept as migration-pattern reference)

These were live entries in CLAUDE.md's "Remaining Tech Debt" section; they are now
fixed and retained here for the migration patterns they demonstrate. Git history
preserves the full narrative.

### Browser-verified 2026-05-26 (Playwright MCP at 390px + 360px)

The Pomodoro Actions-always-visible change and the Meds prescription-supply counter (incl.
opt-in) were all confirmed in a real browser. Canonical engine run `tests/index.html` was green
at the time. Pomodoro: Actions link visible + drawer opens/usable while idle; the 5-link row was
caught **overflowing into the fixed bottom tab bar** (the added 5th link forced a wrap) and fixed
by keeping the row to one non-wrapping line (`flex-wrap:nowrap` + `overflow-x:auto` safety + smaller
font/padding) and shortening the "Auto-advance: Off" label to "Auto: Off". Meds: untracked meds
render no supply UI; tracked med shows the prominent badge + New prescription refill; dose logging
decrements 30→29; low (≤5) paints amber, empty (0) paints red. **Pre-existing (NOT caused by these
changes, visible in original screenshots):** the global BFRB FAB partially overlaps the rightmost
Pomodoro action link ("Saved Tasks") at the bottom-right — left as-is.

### Orphaned readers of the deleted `wellness_meds` blob after the F18 meds migration (ALL 3 FIXED 2026-06-03)

`js/meds.js`'s F18 per-record migration (`_migrateLegacyBlob`, `meds.js:549`) deletes the legacy
`localStorage['wellness_meds']` key after moving each med to its own `meds/{medId}` key — three
consumers read the old blob. **(1) `js/rhythm-engine.js` `getDoseEntries()` — FIXED** (backlog #13,
`fix/rhythm-timeline-meds-source`): reads `MedsManager.all()` + per-med `getDoseLog()`, so the Rhythm
*Timeline* dose dots render again. **(2) `js/analytics.js` `getMedAdherence()` — FIXED**
(`fix/analytics-meds-adherence-source`): now reads `MedsManager.all()` +
`getDoseLog()`/`getFrequency()`/`getName()`/`getDose()` (MedsManager is loaded at startup via
`MedsUI.init`→`loadAll`, `app.js:92`, so the adherence card is populated before any tab requests it);
stale "reads localStorage directly" comment rewritten; `tests/analytics.test.js` re-seeds via the
manager. **(3) `js/export.js` `buildBackupData()` + `importAllData()` — FIXED** (`fix/export-meds-records`):
added a `collectMedRecords()` sweep that enumerates `meds/{id}` localStorage keys into a new
`payload.meds` array on export, and a restore path that clears stale `meds/*` keys then writes each
backed-up record (picked up by `loadAll` on the post-import reload). `wellness_meds` stays in
`EXPORT_SETTINGS_KEYS` so **pre-F18 backups still restore** (the blob is written back and re-migrated
on reload). This also fixes the F12 mandatory pre-push backup (`sync-engine.js:666` reuses
`buildBackupData`). Pre-fix, local backups/exports silently omitted all medications post-migration —
data-loss for users not on cloud sync.

---

## If migrating to ES modules

If the file count keeps growing, consider migrating from IIFEs/globals to ES modules:

```html
<script type="module" src="js/app.js"></script>
```

Then each module uses `import`/`export`. No bundler needed — browsers support this natively.
Benefits: proper dependency graph, tree shaking if you add a bundler later, easier testing.
