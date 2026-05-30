# Tempo — Roadmap

Tempo is a solo-built, production PWA — I use it every day on my own phone and
desktop — that grew out of a single stopwatch idea into a focus-and-wellness
suite: stopwatch, timer, Pomodoro, Flow Block, Interval, Cooking, plus a Wellness
pillar (Meds, Exercise, Mindful, Recovery) and a Rhythm dashboard. It is vanilla
HTML/CSS/JS with no build step and a Capacitor iOS shell, deployed to GitHub Pages
on every push (live at <https://ksdisch.github.io/stopwatch/>).

This roadmap is **ordered by return-on-effort, not by calendar**. There are no
committed dates — it is a single-maintainer portfolio project, so the order
reflects which work unlocks the most value for the least risk, and the buckets
shift as priorities do. For *what already shipped* see the changelog
(`CHANGELOG.md`, generated from git history); for *how the app is built* see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the longer backstory in
[`docs/BUILD-HISTORY.md`](docs/BUILD-HISTORY.md).

---

## Recently shipped

A tight list of the most recent landings, so this roadmap doesn't re-promise done
work. Full detail lives in the changelog.

- **Todoist two-way integration** — pull tasks from Todoist into the Pomodoro
  saved-task list and the Flow "Tasks for this block" list; check / uncheck /
  create / rename all write back to Todoist; **delete stays local** (a slip in
  Tempo must never nuke your real task list). Shipped in three slices:
  Pomodoro V1 (PR #100, `ec1faf0`), Flow user-task list (PR #102, `ae693d3`), and
  Pomodoro inline-rename via `Todoist.updateTask` (PR #103, `8f02a23`).
- **Pomodoro phase revert** — a one-level "← Go back" undo that folds elapsed
  time from the new phase back into the phase you left (PR #105, feature commit
  `7e15926`).
- **Meds prescription-supply tracking** — opt-in per medication: set a
  pill count, watch a derived "N left" badge decrement as you log doses, and
  nudge it with ±1 steppers when reality drifts from the math. Landed across the
  opt-in + supply work (PR #92, `ca11744`), the ±1 stepper adjustment (PR #94,
  `19f12f5`), the clamp-to-`[0, MAX_SUPPLY]` fix (PR #95, `8567c83`), and the
  card edit/delete wiring (PR #97, `c63a045`).
- **Rhythm readiness band** — the Rhythm tab now shows a daily recovery band
  (well-recovered / neutral / strained) sourced read-only from an external
  `personal-health-elt` pipeline (PR #98, `c8f86a0`). See
  [`docs/reference/recovery-state-contract.md`](docs/reference/recovery-state-contract.md)
  for the data contract.
- **Cloud Sync** — the largest single initiative in the project's history:
  Firebase/Firestore sync across six stores (meds, history, rest log, presets,
  BFRB events, distractions), built over stages B–E in roughly 28 PRs and live
  behind the off-by-default `tempo_sync_enabled` flag. The strategy is documented
  in [`docs/CLOUD-SYNC-STRATEGY.md`](docs/CLOUD-SYNC-STRATEGY.md).
- **iOS Capacitor wrapper** — the same web codebase wraps in a Capacitor shell so
  haptics and scheduled notifications work natively on iPhone; shipped to my
  personal device (PR #45, `72eb338`). App Store distribution is still open —
  see *Later* below.

---

## Now / Next / Later

Three buckets. *Now* is what's active or next-up with groundwork already in
flight; *Next* is the queued near-term work; *Later* is real but not imminent.

### Now

- **Cloud-sync native parity — real-time listeners + atomic CAS on iOS.**
  This is the last unshipped piece of the cloud-sync initiative. On the web build,
  cross-device changes propagate in about a second via Firestore `onSnapshot`
  listeners, and concurrent writes are guarded by an atomic compare-and-swap
  transaction. On native iOS, both of those primitives are still web-only — the
  `@capacitor-firebase/firestore` branches throw an explicit "native parity
  pending" error (`js/sync-firestore.js:339`, `:431`), so iOS instead runs a
  **functional-but-degraded** path: a 5-minute defensive poll
  (`STEADY_STATE_DEFAULT_MS = 300000`, `js/sync-engine.js:99`) plus per-record
  `setDoc` writeback. *Why now:* sync already works on iOS — this closes the last
  gap so phone and desktop converge in seconds with the same atomicity guarantee
  the web build has. *Why it's bounded but not yet done:* it needs Xcode and a
  physical device to verify the plugin's transaction/listener shapes, which the
  web test harness can't exercise. The full decision and the engine's
  absorb-and-fall-back scaffolding are documented in
  [`docs/adr/0009-defer-native-cas-listener-parity.md`](docs/adr/0009-defer-native-cas-listener-parity.md).

### Next

- **Sleep bedtime / wake-time schema extension.** Add optional `bedtime` and
  `wakeTime` timestamp fields to each day's `sleep` entry in `wellness_rest_log`
  (so the shape becomes `sleep: { hours, quality?, bedtime?, wakeTime? }`).
  Additive and nullable, so there's no migration and existing hours+quality
  logging is untouched; the two new fields ride the existing `rest_log` sync store
  for free. *Why:* it's the prerequisite for the Rhythm insights dashboard — the
  Meds-vs-Sleep chart needs sleep *onset timing*, not just duration, to show
  whether earlier doses correlate with earlier sleep.

- **Rhythm insights dashboard.** Overhaul the Rhythm tab from a single-day event
  list into a multi-panel insights view: a Meds-vs-Sleep correlation chart,
  14-day recovery trend sparklines (HRV / ACWR / RHR), focus-minutes-per-day bars,
  BFRB-frequency trend, a distraction-category rollup, and derived plain-language
  correlation callouts (e.g. "avg focus +40% on well-recovered days"). All the
  data already lives locally, so there are no new network calls, and the charts
  are hand-rolled inline SVG to stay inside the no-build-step constraint. *Why:*
  it turns the wellness and focus streams Tempo already records into something
  actionable — the whole point of logging meds, sleep, and focus in one app.

### Later

- **iOS App Store distribution.** The Capacitor wrapper already ships to my
  device; what remains is the distribution paperwork: $99/yr Apple Developer
  Program enrollment, an App Store Connect record, privacy nutrition labels
  (meds and BFRB data are health data and must be disclosed), App Review
  screenshots, an age rating, and a polished 1024×1024 icon. *Why later:* it's
  process and cost, not engineering — the app itself already runs natively.

- **iOS Live Activities.** Surface a running timer or stopwatch on the lock screen
  and in the Dynamic Island via ActivityKit (iOS 16.1+). *Why:* glanceable timing
  without unlocking the phone. *Unlocked by* the Capacitor wrapper that already
  shipped; the drift-free engines make it cheap, since the activity can store
  `endsAt` and render the countdown locally with no per-tick push.

- **Split-screen timer comparison.** A side-by-side two-instance view for
  comparing two running timers. *Why later:* it needs significant layout rework to
  do well, which is high effort relative to how often it's needed.

- **Voice control.** Web Speech API recognition for "start", "stop", "lap",
  "reset". *Why:* hands-free control while cooking or exercising — a natural fit
  for a timer, but a nice-to-have rather than a gap.

- **Group / team timing.** Shared timing across multiple people via a shared URL
  or WebRTC. *Why later:* it would require a backend, which is a major scope
  expansion for a deliberately backend-light static app — the largest single item
  on the list and the least aligned with the solo-use design.

---

## Known issues

A couple of load-bearing issues are kept roadmap-visible rather than buried, so
the honest state of the app is in plain sight.

- **iOS "Sign out" doesn't fully sign out.** On the iOS shell, tapping "Sign out"
  in the Cloud Sync drawer dismisses the dialog but leaves the account still
  signed in — the Firebase iOS SDK's Keychain-cached auth state races back after
  the JS-side sign-out. Web sign-out works correctly. Workaround: toggle "Enable
  cloud sync" off to pause sync without an auth tear-down. Full diagnosis and the
  candidate fix are in
  [`docs/playbooks/ios-signout.md`](docs/playbooks/ios-signout.md).

- **No UI or integration tests yet.** The engine test suite is substantial — on
  the order of 900 `it()` cases across the 32 `tests/*.test.js` files, covering
  every timing engine, meds, analytics, the Todoist client, and the full
  cloud-sync stack — but it is **browser-run** (open `tests/index.html` in a real
  browser; `curl`-grepping the HTML does not execute it) and there is still no
  automated UI or end-to-end coverage. Pre-ship UI verification is manual.

---

## How this roadmap is maintained

This roadmap is groomed periodically (roughly quarterly) and reordered by ROI as
priorities move. The authoritative working backlog — with the full
implementation detail, file-level scope, and agent-facing conventions — lives in
the project's `CLAUDE.md`. This file is the human-readable product view of that
same backlog. Terminology used here (BFRB, Flow Block, ACWR, CAS, and the rest)
is defined in the project glossary (`docs/reference/glossary.md`).
