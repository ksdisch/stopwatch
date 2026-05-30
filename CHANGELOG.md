# Changelog

All notable product changes to Tempo (a.k.a. "stopwatch"), the cross-platform
stopwatch / focus / wellness PWA. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), **adapted**: there is
no SemVer here.

**"Versions" are `sw.js` `CACHE_NAME` slugs** — `stopwatch-vNNN-<short-slug>`,
the repo's actual release anchor. A push to `main` only becomes a *release* when
the service-worker cache rotates, because the PWA is cache-first
(`sw.js:1`, currently `const CACHE_NAME = 'stopwatch-v105-sw-schema-asset'`; see
[docs/runbooks/deploy-and-cache-bump.md](docs/runbooks/deploy-and-cache-bump.md)
for why the slug *is* the release id). There are **0 git tags** in this repo —
the `CACHE_NAME` slug is the de-facto release id by design (see `ROADMAP.md` and
the maintenance cadence in
[docs/artifacts-plan.md](docs/artifacts-plan.md)). The slug number is
monotonic but **gaps are expected** — a number may be absent here when its ship
was test/infra/docs-only or got folded into a neighboring product entry.

Entries here begin at **`v62-adjust-time-buttons`** (`2026-04-29`, PR #41), the
point where the repo adopted consistent Conventional Commits. Everything before
`v62` predates that convention and is **intentionally not backfilled here** — the
full pre-history (Phases 1–8) lives in
[docs/BUILD-HISTORY.md](docs/BUILD-HISTORY.md). Most-recent first.
`docs`/`chore`/`test`-only commits are omitted — they are not product changes.

---

## [v105-sw-schema-asset] - 2026-05-30

### Fixed
- Offline cache integrity: `js/schema.js` (the sync-stamping seam, loaded by
  `index.html` but absent from the cached asset list) was added to the `sw.js`
  `ASSETS` precache array so the sync stamper is available offline; `CACHE_NAME`
  bumped `v104 → v105` (commit `4630284`).

## [v104-pomo-revert] - 2026-05-30

### Added
- Pomodoro phase revert: a "← Go back" link does a single-level undo of a phase
  transition, folding elapsed time from the new phase back into the restored
  phase. Visible only while a snapshot exists and the engine is
  running/paused (backlog #11; shipped to main in the #105 squash, commit
  `7e15926`).

## [v103-pomo-rename] - 2026-05-29

### Added
- Todoist: inline click-to-edit rename on Pomodoro saved-task rows; a commit
  fire-and-forwards `Todoist.updateTask(id, { content })` (and queues an
  idempotent offline `update` op when offline) — delete still stays local, never
  touching the real Todoist list (PR #103, commit `8f02a23`).

## [v102-flow-tasks] - 2026-05-29

### Added
- Todoist: a user-editable "Tasks for this block" list in Flow Block, two-way
  integrated with Todoist (import via the shared picker; check/uncheck and create
  write back; delete stays local). New non-synced `flow_user_tasks` store; in
  local backup/export with Todoist linkage stripped (PR #102, commit `ae693d3`).

## [v101-todoist-integration] - 2026-05-28

### Added
- Todoist integration V1: pull tasks into the Pomodoro saved-task list, with
  check-off / reopen / create propagating back to Todoist. Settings-drawer
  Todoist panel (API token, test connection, default project + filter), a shared
  picker modal, an offline write queue (`todoist_pending_ops`), and the
  device-local `todoist_api_token` (never synced) (PR #100, commit `ec1faf0`).

## [v100-rhythm-per-day] - 2026-05-28

### Added
- Rhythm: a recovery-readiness band, sourced from the external
  `personal-health-elt` pipeline's read-only `recovery_state` Firestore feed
  (PR #98, commit `c8f86a0`). Tempo is a read-only consumer of this feed; see
  [docs/reference/recovery-state-contract.md](docs/reference/recovery-state-contract.md).

## [v97-meds-edit-delete-fix] - 2026-05-27

### Fixed
- Meds: the edit and delete buttons on medication cards were not wired up — they
  are now functional (PR #97, commit `c63a045`).

## [v96-meds-supply-stepper] - 2026-05-27

### Added
- Meds: inline ▲/▼ steppers on the prescription-supply badge for a manual ±1
  correction (down-arrow disabled at 0) (PR #94, commit `19f12f5`).

### Fixed
- Meds: supply-adjustment clamp fix so `adjustSupply` lands the *displayed*
  remaining on the new target even when consumed exceeds the start count
  (PR #95, commit `8567c83`).

## [v95-pomo-timeline-fix] - 2026-05-26

### Fixed
- Pomodoro: corrected the timeline phase highlight and the "Est. end" calculation
  during break phases (PR #93, commit `a939b4f`).

## [v94-meds-supply-optin] - 2026-05-26

### Added
- Meds: opt-in prescription-supply tracking — a "Track prescription supply"
  checkbox in the add/edit form; only opted-in cards render the supply badge
  ("N left" of M, with low/empty color states) and the "New prescription" refill
  input (PR #92, commit `ca11744`).
- iOS: background ambient audio — `UIBackgroundModes=audio` + an `AVAudioSession`
  `.playback` category so procedural noise keeps playing when Tempo is
  backgrounded (native only; needs on-device verification) (PR #92).

### Changed
- Pomodoro: the Actions links row is always visible (including while idle), kept
  to a single non-wrapping line so the added link can't overflow into the bottom
  tab bar (PR #92).

## [v91-ambient-colors] - 2026-05-20

### Added
- Ambient noise color palette: green / blue / violet / gray procedural-noise
  variants (PR #88, commit `1724d47`).

## [v90-rhythm-pillar] - 2026-05-17

### Added
- Rhythm pillar: a daily event timeline assembling History, `bfrb_events`, and
  distractions into one day view (backlog #4, commit `5be4bfb`).

## [v89-ambient-noise-procedural] - 2026-05-17

### Added
- Procedural ambient noise (Web Audio, no audio files) that starts on Flow Block
  and Pomodoro start (commit `9c6de75`).

## [v88-flow-vibrate-intervals] - 2026-05-17

### Added
- Flow Block: periodic vibration intervals during focus blocks (backlog #2,
  commit `05d7a5f`).

> _This ship was reverted once mid-day (`8ff636d`) and re-shipped the same day —
> the canonical example of the direct-push-to-main / CI-bypass risk that the
> later CI bump-detector exists to catch (see the `sw-cache-bump` check in
> [docs/runbooks/deploy-and-cache-bump.md](docs/runbooks/deploy-and-cache-bump.md))._

## [v87-push-skip-stage-d-self] - 2026-05-17

### Fixed
- Sync: first-upload Push now skips the Stage D imported-bucket handoff when the
  cloud holds only this device's own writes (commit `f2eed1e`).

## [v86-ui-rerender-on-merge] - 2026-05-17

### Added
- Sync: per-surface UI re-render on `merge-complete`, so a cross-device merge
  refreshes the affected view without a manual reload (commit `552ae76`).

## [v85-signin-timeout] - 2026-05-17

### Fixed
- Sync: `SyncAuth.signIn` timeout race + self-heal (commit `40df03d`).

## [v84-reconcile-log-coalesce] - 2026-05-17

### Changed
- Sync: coalesce reconcile-collision warnings instead of logging each one
  (commit `64623e3`).

## [v83-listener-cold-boot-rearm] - 2026-05-17

### Fixed
- Sync: re-arm real-time listeners after a cold-boot rehydrate + Reconcile, so a
  fresh tab gets live updates without a manual refresh (commit `a010abb`).

> _**`v83`–`v87` are the 2026-05-17 cloud-sync race-fix cluster** — five ships in
> one stabilization night closing listener / auth / push-path races surfaced once
> sync went live. Full RCA:
> [docs/postmortems/2026-05-17-cloud-sync-race-fix-cluster.md](docs/postmortems/2026-05-17-cloud-sync-race-fix-cluster.md)._

## [v82-e3-listeners] - 2026-05-15

### Added
- Sync: real-time `onSnapshot` per-store listeners (web), with a downlevel
  warning when a remote record is stamped at a higher `schemaVersion` (E-3,
  commit `5f6f039`). Native listeners are deferred — see
  [docs/adr/0009-defer-native-cas-listener-parity.md](docs/adr/0009-defer-native-cas-listener-parity.md).

## [v81-e2-offline-buffer] - 2026-05-15

### Added
- Sync: offline write buffer (`tempo_sync_db` IndexedDB, FIFO drain) plus the
  `Platform.network` online/offline shim (E-2, commit `988e8e9`).

## [v80-e1e-stage-e-complete] - 2026-05-14

### Added
- Sync: `rest_log` + `presets` per-store merges and per-store F19a guards,
  completing Stage E. **Cloud sync goes live by default** for any signed-in user
  with the master flag on — up to here it was dormant scaffolding (E-1e,
  commit `3dcb070`).

## [v79-e1d-f8-distractions-migration] - 2026-05-14

### Changed
- Sync: F8 distraction migration — flat array → `sessionId`-keyed map for Flow +
  Pomodoro distractions, enabling distractions as the 6th synced store (E-1d,
  commit `24ad66e`).

## [v78-e1d-f3-bfrb-consolidation] - 2026-05-14

### Changed
- Sync: F3 BFRB stream consolidation — three legacy BFRB buckets unified into one
  `bfrb_events` stream as the single synced source of truth (E-1d, commit
  `f3e6206`).

## [v77-e1d-history-merge] - 2026-05-14

### Added
- Sync: history steady-state merge — sessions union by id with record-level LWW
  and phaseLog dedup (E-1d, commit `e23b2ce`).

## [v76-e1c-meds-merge] - 2026-05-13

### Added
- Sync: meds steady-state merge with the D-1 retrofit and the F15
  multi-entry-arrival counter/toast (E-1c, commit `9966b99`).

## [v75-e1b-steady-state-scaffold] - 2026-05-13

### Added
- Sync: `startSteadyState` scaffold + the compare-and-swap (CAS) writeback wrapper
  (E-1b, commit `23979cd`). The CAS `runTransaction` is web-only; native is
  deferred — see
  [docs/adr/0009-defer-native-cas-listener-parity.md](docs/adr/0009-defer-native-cas-listener-parity.md).

## [v73-d2-doseLog-reconcile] - 2026-05-12

### Added
- Sync: Stage D `doseLog` cross-device reconcile — ±15-min collapse + clock-skew
  clamp so the same dose logged on two devices doesn't double-count (D-2, commit
  `4612a94`).

## [v72-d1-reconcile] - 2026-05-12

### Added
- Sync: Stage D imported-bucket reconcile — surfaces likely duplicate history
  pairs between synced and pre-sync imported rows (D-1, commit `1d11906`).

## [v71-sync-hydrate] - 2026-05-12

### Added
- Sync: Device B fresh-hydrate orchestrator + boot overlay — a second device
  pulls existing cloud data on first sign-in (C-1, commit `dbc3011`).

## [v70-sync-uploader-share-fallback] - 2026-05-12

### Fixed
- Backup: `<a download>` fallback when the Web Share API rejects, so the mandatory
  local backup always lands somewhere (commit `2e94702`).

## [v69-sync-uploader] - 2026-05-12

### Added
- Sync: first cloud upload + "Push to cloud" UI — the device's local data is
  pushed to Firestore (B-3, commit `3d3ef70`).

## [v68-sync-auth] - 2026-05-11

### Added
- Sync: Google sign-in and the settings-drawer "Cloud Sync" section (B-2, commit
  `1db244c`).

## [v67-f19a-passthrough-fix] - 2026-05-11

### Fixed
- Meds: preserve a future-schema record's `schemaVersion` on load instead of
  downstamping it, so a downlevel client can't strip a newer client's data (F19a,
  commit `c853b1b`).

## [v66-sync-engine-scaffold] - 2026-05-11

### Added
- Sync: the `SyncEngine` module scaffold + per-store `snapshotForSync()` adapters
  — the orchestrator skeleton for the whole initiative, shipped behind the
  `tempo_sync_enabled` flag (off by default) (B-1, commit `d224668`).

### Changed
- **Sync-prerequisite schema refactors** (`#46`–`#53`, 2026-05-10, all
  `refactor(...)` not `feat`): doseLog cap 200 → 1000 (F14, `25682f6`), session
  IDs migrated to `${deviceId}-${ts}-${counter}` (F2, `0067cba`), per-write
  `deviceId` + `updatedAt` stamping (F10, `0f99fac`), the `tempo_sync_state`
  write gate (F13, `104cfdb`), per-record meds persistence under `meds/{medId}`
  (F18, `4f5912a`), present-but-unknown enum preservation (F20, `749c19a`),
  per-record `schemaVersion` stamping (F19a, `92d91d2`), and unknown-top-level-
  field passthrough (F19b, `342dbf9`). **Invisible to users** — pure groundwork
  to make the existing local stores safely mergeable across devices. These ship
  without their own cache slug (no cached-file change).

> _Cloud sync was built across stages B → E (~28 PRs); `v66`–`v82` and the
> `v83`–`v87` cluster are that initiative. It shipped behind a flag, **off by
> default**, and only "goes live" at `v80-e1e`. Strategy + per-store merge rules:
> [docs/CLOUD-SYNC-STRATEGY.md](docs/CLOUD-SYNC-STRATEGY.md);
> backend decision:
> [docs/adr/0003-firestore-sync-backend.md](docs/adr/0003-firestore-sync-backend.md);
> merge strategy:
> [docs/adr/0004-per-store-merge-strategy.md](docs/adr/0004-per-store-merge-strategy.md);
> native deferral:
> [docs/adr/0009-defer-native-cas-listener-parity.md](docs/adr/0009-defer-native-cas-listener-parity.md)._

## [v65-platform-abstraction] - 2026-05-03

### Added
- iOS: Capacitor wrapper for a native iOS build, plus the `js/platform.js`
  abstraction layer that routes haptics + notifications to native or web. The web
  build keeps deploying byte-equivalent via GitHub Pages (PR #45, commit
  `72eb338`).

## [v64-overshoot] - 2026-05-02

### Added
- Countdown timers count up past zero (overshoot) instead of stopping at 0:00
  (PR #44, commit `86784d5`).

## [v63-adjust-tdz-fix] - 2026-04-29

### Fixed
- Avoid a temporal-dead-zone crash by inlining `ADJUST_DELTA_MS` as a function
  (PR #43, commit `65a1bdd`).

## [v62-adjust-time-buttons] - 2026-04-29

### Added
- ±3-minute adjust buttons on all countdown surfaces (PR #41, commit `2d4a2d6`).

---

_What's next: see [`ROADMAP.md`](ROADMAP.md) for the now/next/later view._
_Pre-`v62` history: [docs/BUILD-HISTORY.md](docs/BUILD-HISTORY.md)._
