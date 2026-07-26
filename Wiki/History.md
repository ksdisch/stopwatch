# History — Tempo (stopwatch)

> How this project got here: a chronological narrative of eras and milestones,
> reconstructed from merged PRs, git history, wrap logs, and ADRs.
> PR numbers, merge dates, tags, and SHAs are **Fact** by construction; rationale
> lines carry explicit labels (**Fact** when quoted from a PR body/ADR, **Inference**
> when reconstructed). Decisions are anchored by ID to the project's decision
> ledger — never restated here. **Append-only:** new milestones are added at the
> bottom (above the Mining coverage footer); existing entries are never rewritten.

## Origin — 2026-04
Started 2026-04-04 (first commit `f991cca`, "Initial commit: stopwatch PWA with offset start feature") as a vanilla-JS, no-build stopwatch PWA whose differentiator was **starting with time already elapsed** ("took my meds ~30 min ago — start at 30:00"). No kickoff brief exists — the earliest intent doc is `CLAUDE.md` (added 2026-04-06, commit `2b3812b`). Phases 1–3 (polish, enhanced UX, timer/themes/history/export) landed as direct commits on day one; Pomodoro, presets, and multi-instance followed pre-PR-workflow.

## Era: Stopwatch → Tempo — focus + wellness (2026-04 – 2026-05-02)
The single-purpose stopwatch became "Tempo": deep-work modes, a Wellness suite, BFRB support, and an analytics layer.

### Flow Block mode — 2026-04-14
- **Landed:** first merged PR: ultradian 90/120-min focus blocks with pre-block checklist, distraction log, summary card, 15-min recovery (PR #1)
- **Why:** deep-work sessions as a first-class mode, not a repurposed timer [Fact — PR #1 body]

### Wellness suite (Meds, Exercise, Mindful, Cooking, Recovery) — 2026-04-20 → 2026-04-22
- **Landed:** five wellness pillars in one week (PRs #10–#15, #23), Meds V2 pivoting to a prescription-focused flow (PR #13)
- **Why:** Meds "took it ~" offset logging deliberately reuses the app's core USP [Fact — PR #10 body]

### BFRB tracking loop v1 — 2026-04-21 → 2026-04-29
- **Landed:** BFRB tally in Flow/Pomodoro, 60s competing-response countdown + chime, global floating button with keyboard shortcut and today-count (PRs #16–#22, #39)
- **Why:** habit-reversal support attached to the focus modes where catches happen [Inference — rationale spread across PR titles]

### Analytics buildout + test lock-in — 2026-04-22 → 2026-04-24
- **Landed:** prioritized plan then S/M-tier cards (streaks, completion rate, leaderboards, adherence, BFRB trends) (PRs #24–#31), then 42 verification scenarios + engine tests locked in (PRs #32–#34), manual backup/restore (PR #36)
- **Why:** plan-first buildout with tests added immediately after the feature burst [Inference — PR sequence]

### Overshoot — 2026-05-02
- **Landed:** countdown timers count up past zero in amber `+M:SS`; overshoot captured to history + analytics card (PR #44)
- **Tradeoff:** opt-in `allowOvershoot` so Cook mode keeps halt-at-zero behavior [Fact — PR #44 body]

## Era: Going native + the cloud-sync campaign (2026-05-03 – 2026-05-17)
The defining engineering campaign: a Capacitor iOS shell, then a ~28-PR staged cloud-sync build on Firestore.

### Capacitor iOS wrapper — 2026-05-03
- **Landed:** native iOS shell + `js/platform.js` seam; 29 call sites migrated to `Platform.haptic`/`Platform.notify` (PR #45)
- **Why:** iOS Safari no-ops `navigator.vibrate` and kills Web Notifications when the WebView suspends [Fact — PR #45 body]; decision recorded as `docs/adr/0007-capacitor-native-wrapper.md`

### Sync-prereq invariant wave (the F-numbers) — 2026-05-10 → 2026-05-11
- **Landed:** eight refactor PRs establishing sync invariants before any backend code: deviceId+updatedAt stamping, write gate, per-record persistence, schemaVersion, `__forward` passthrough (PRs #46–#53, #56)
- **Why:** make every store merge-ready before choosing a backend [Inference — "sync prereq F-n" naming across the wave]

### Backend selection: Firebase/Firestore — 2026-05-10
- **Landed:** doc-only decision PR — `docs/sync-review/BACKEND-SELECTION.md`, Firestore over Supabase/CloudKit/PouchDB (PR #54)
- **Why:** 4–6 days to ship, mature Capacitor plugin, subcollections fit the doseLog model, doc-level CAS matches the refuse-writeback contract [Fact — PR #54 body]; recorded as `docs/adr/0003-firestore-sync-backend.md`
- **Tradeoff:** no self-serve BAA (caps any HIPAA story) + Firestore-shaped vendor lock-in [Fact — PR #54 body]

### Staged sync build S0→E — 2026-05-11 → 2026-05-14
- **Landed:** Firebase config (PR #57), SyncEngine scaffold (PR #58), Google sign-in + first upload (PRs #60–#61), Device-B hydrate (PR #62), Stage D imported-bucket reconcile — the project's largest PR at +6289 (PR #63), steady-state per-store merges (PRs #66–#71)
- **Why:** one PR per stage row of `docs/sync-impl/PLAN.md`, each behind an audit, via the 5-subagent orchestrator pipeline [Fact — PR #63/#72 bodies]; merge strategy recorded as `docs/adr/0004-per-store-merge-strategy.md`

### Sync goes live — 2026-05-14
- **Landed:** rest_log + presets merges complete the set; dev flag removed; steady-state auto-starts for any flagged user (PR #72)
- **Tradeoff:** went live with ~34k reads/day against the 50k Spark free tier — "margin is tight but within budget" [Fact — PR #72 body]

### Real-time listeners + the direct-push incident — 2026-05-16 → 2026-05-17
- **Landed:** web onSnapshot listeners with visibility/network lifecycle (PR #75), validation follow-ups (PRs #76–#79); a flow-vibration feature was direct-pushed and reverted the same day (PRs #80–#81)
- **Why:** native listener/CAS parity consciously deferred [Fact — PR #75 body] — recorded as `docs/adr/0009-defer-native-cas-listener-parity.md`; the direct-push incident later motivated branch protection — see D3 in `Decisions.md`

## Era: Integrations & insight (2026-05-17 – 2026-06-05)
Post-sync burndown of the feature backlog: audio, Todoist, an engineering-docs push, and the Rhythm intelligence layer.

### Ambient audio + Rhythm timeline — 2026-05-17 → 2026-05-20
- **Landed:** procedural ambient noise on Flow/Pomodoro plus color/volume controls (PRs #82, #88–#89); daily timeline pillar (PR #83)

### Todoist two-way integration — 2026-05-28 → 2026-05-30
- **Landed:** Pomodoro saved-tasks V1 with offline queue (PR #100), Flow user-task list (PR #102), inline rename (PR #103)
- **Why:** personal API token kept device-local — never synced, never exported (PR #100) [Fact — PR #100 body]; recorded as `docs/adr/0008-todoist-personal-token-not-oauth.md`
- **Tradeoff:** users re-paste the token per device, in exchange for no OAuth infrastructure [Fact — PR #100 body]

### Engineering-artifacts push — 2026-05-30 → 2026-05-31
- **Landed:** README + MIT LICENSE + retro-ADRs 0001–0004 (PR #106), ADRs 0005–0009 + ARCHITECTURE + data dictionary + CI (PR #107), runbooks/postmortems/CHANGELOG/ROADMAP (PR #108), Firestore-rules tests + emulator CI job (PR #109)
- **Why:** three-tier execution of `docs/artifacts-plan.md`; ADRs written retroactively with file:line evidence [Fact — PR #106 body]

### Rhythm Insights dashboard — 2026-06-03 → 2026-06-04
- **Landed:** 7-panel registry-pattern dashboard over a DI data layer (PR #111), then per-panel axis/tooltip/highlight polish (PRs #117–#123)
- **Why:** panels self-register and touch zero shared files — built partly by parallel subagents [Fact — PR #111 body]

### Tempo Coach + BFRB Closed Loop — 2026-06-05 → 2026-06-06
- **Landed:** readiness-aware daily loop: Today panel, readiness-sized Flow default, opt-in nudge (PR #124); antecedent capture + Triggers panel + forgiving clean-streak (PR #126), in-the-moment pace support (PR #131)
- **Why:** first features that *act* on what Insights measures; copy is descriptive-first, never imperative, to sidestep clinical framing [Fact — PR #124 body]
- **Tradeoff:** BFRB capture must commit in exactly one `log()` call because the merge resolves collisions keep-cloud — a log-then-patch would silently drop fields [Fact — PR #126 body]

## Era: Full-app overhaul (2026-06-06 – 2026-06-08)
### Overhaul batches A–F — 2026-06-07 → 2026-06-08
- **Landed:** 124-finding parallel audit executed as batches: correctness (incl. a critical export/backup BFRB data-loss fix), performance (RAF painter split), design-token system, accessibility, PWA (safe-area, wake-lock, SW update-to-reload) (PRs #133–#136)
- **Why:** consolidated stacked overhaul work planned in `docs/overhaul/PLAN.md` [Fact — PR #133 body]

## Era: Life-OS trunk — P0 through P3 (2026-06-08 – 2026-06-12)
Tempo's biggest identity shift: the PWA becomes the trunk of a five-pillar personal Life-OS fed by local agent councils. Plan approved 2026-06-08 (kickoff archive: `~/Projects/_kickoffs/tempo-lifeos-discovery/`).

### Phase 0 foundations — 2026-06-08
- **Landed:** Firestore synthesis-record contracts, read-only rules carve-out, `council/` Node runtime on launchd, `js/synthesis-feed.js` read side; gate verified end-to-end (PR #139)
- **Why:** evolve Tempo in place as the trunk — see D1 in `Decisions.md`; councils run local-first on Kyle's Mac — see D2 in `Decisions.md`

### Phases 1–2: Home hub + Physicals — 2026-06-08
- **Landed:** Home synthesizer + bubble map as default landing (PRs #140–#141); Physicals, the first real federated pillar (PR #142)

### Phase 3: Chickens — 2026-06-11 → 2026-06-12
- **Landed:** `mood_events` 7th synced store, ≤5s mood capture, council synthesizer, Chickens hub, stress nudge (PRs #144–#146); gate passed with prod smoke (PR #146)
- **Why:** built to the ratified `docs/lifeos/phase-3-plan.md`; store shape recorded as `docs/lifeos/decisions/0008-mood-event-store.md` [Fact — PR #145 body]

## Era: Audit, hunts, and hardening (2026-06-13 – 2026-07-08)
A deliberate quality campaign: a principal-engineer audit, its burndown, a mobile sweep, a bug hunt, and a UI test harness.

### Principal-engineer deep audit — 2026-06-14
- **Landed:** `AUDIT-2026-06-13.md` — 17 finders → adversarial verification → 68 verified findings, 4 Highs, no Criticals (PR #148)
- **Why:** risk concentrated in the steady-state sync layer; headline: live sync never wrote remote arrivals to local for 5 of 7 stores [Fact — PR #148 body]

### H4 headline fix + remediation burndown — 2026-06-14 → 2026-06-23
- **Landed:** uniform cloud→local writeback across all merges (PR #150), write-gate silent-drop fix (PR #151), then a numbered burndown through the Medium/Low tiers (PRs #149, #153–#172)
- **Why:** local-apply runs strictly after the CAS loop so a CAS failure never leaves local ahead of cloud [Fact — PR #150 body]

### Mobile papercut sweep — 2026-06-30
- **Landed:** iOS safe-area on takeover panels, ≥44px tap targets, FAB overlap fixes (PRs #178–#182)

### Bug hunt + Proving Ground — 2026-07-07 → 2026-07-08
- **Landed:** full-project hunt report + fix wave (PRs #184–#194); UI/integration Playwright harness slices 1–2 incl. durable notification persistence (PRs #195–#197)
- **Why:** UI seams had no automated coverage — the engine suite alone missed render-layer bugs [Inference — harness design spec PR #195 preceding the slices]

## Era: Life-OS Phase 5 + native maturity (2026-07-08 – 2026-07-11)
### Phase 5: Life Building / Finances — 2026-07-08
- **Landed:** `finances` 8th synced store, council `life_building` synthesizer, Life Building hub with monthly capture form (PR #198)
- **Why:** first editable-per-period store — per-month LWW because a month's numbers get *corrected*, not appended [Fact — PR #198 body]

### iOS Live Activities — 2026-07-10 → 2026-07-11
- **Landed:** Timer-mode lock-screen + Dynamic Island MVP, device-validated on iPhone (PRs #201–#208); Pomodoro + Flow expansion, sim-validated (PR #211)

### Native real-time listener parity — 2026-07-11
- **Landed:** native `subscribe()` is real-time on iOS (PR #209)
- **Tradeoff:** native CAS stays permanently skipped — the Capacitor Firestore plugin exposes no transaction API through 8.3.0; web devices converge the cloud [Fact — CLAUDE.md backlog row 3]

## Era: Governance & knowledge layer (2026-07-18 – 2026-07-26)
### Tooling, hygiene, and branch protection — 2026-07-18 → 2026-07-21
- **Landed:** vendored Claude tooling sweep (PR #212), backlog hygiene + CLAUDE.md trim (PRs #213, #215), CI enforced as a merge gate + gitleaks secret scan (PR #217)
- **Why:** PRs-only with all 7 CI checks required — see D3 in `Decisions.md`; finances close-out parked pending July numbers — see D4 in `Decisions.md`

### Project wiki initialized — 2026-07-26
- **Landed:** PROJECT.md, HANDOFF.md, Sources.md, Decisions.md, `Wiki/` with the lifeos-status reconciliation page (PR #218)

### What remains of the approved Life-OS plan — as of 2026-07-26
- **Fact:** the 2026-06-08 plan (kickoff archive `~/Projects/_kickoffs/tempo-lifeos-discovery/`) is partially built: P0–P3 and the P5 Finances slice shipped; P4 (federate Growth/Career), P6 (unit lifecycle), P7 (feedback loop), and the Relationships remainder of P5 are approved but unbuilt — reconciliation and open questions in [[lifeos-status]].

---

## Mining coverage
_Backfilled 2026-07-26 by project-wiki BACKFILL. Entries after this date are
appended live by MAINTAIN._
- PR title sweep: all 203 merged PRs — no cap (limit 300, unsaturated; PR numbers run to #218, the gap is closed-unmerged PRs)
- Deep reads: 20 of 203 PRs (size top-decile / title signal; cap 20; first and most recent included: #1, #10, #44, #45, #54, #63, #72, #75, #100, #106, #111, #124, #126, #133, #139, #145, #148, #150, #198, #218)
- Also swept: git log (66 merge / 322 non-merge commits), git tags (none exist), `Decisions.md` ledger (D1–D4; rows anchor onward to `docs/adr/` 0001–0009 and `docs/lifeos/decisions/` 0001–0008 — cited by ledger row where one exists, single hop), `CLAUDE.md` phase history + backlog, `Wiki/lifeos-status.md`, kickoff archive `~/Projects/_kickoffs/tempo-lifeos-discovery/brief.md` (header), `docs/session-logs/` (19 dated wrap logs — titles swept, not deep-read)
- Not mined: closed-unmerged PRs, GitHub issues, `docs/BUILD-HISTORY.md` and `docs/SESSION-LOG.md` bodies (exist; complementary chronologies), `CHANGELOG.md`
