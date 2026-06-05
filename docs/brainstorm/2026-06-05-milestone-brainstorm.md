# Tempo Milestone Brainstorm — Final Recommendation

**Date:** 2026-06-05
**Author:** Lead strategist (closing the milestone brainstorm)
**Decision asked:** Pick the next milestone for the Tempo PWA — the one with the best balance of real user impact and clean autonomous build + self-verify fit.

---

## Executive Summary

Tempo has spent its last ~13 merged PRs building and polishing the **Rhythm / Insights** pillar. It now *measures* the user's life with unusual richness — dose timing, sleep onset, BFRB catches, focus minutes, and an external HRV/ACWR/RHR recovery feed. Across **all five recon lenses, the single loudest unmet need converges on the same gap: the app measures correlations but never acts on them.** Every analytical surface is retrospective and descriptive; nothing is forward-looking, and nothing closes the loop into a gentle, in-the-moment nudge.

Eight candidates were evaluated against a weighted scoreboard (impact 0.30 / feasibility 0.15 / autonomy 0.30 / fit 0.15 / prereq-ease 0.10). Four candidates cluster at the top within a tenth of a point of each other (8.45–8.5), which means the tie-break is **judgment about scope discipline and how much of the value is reachable autonomously**, not raw score.

**Recommendation: ship the BFRB Closed Loop — but in disciplined slices, leading with the irreducibly-correct, fully-self-verifiable half** (antecedent capture + new triggers Insights panel + forgiving clean-streak), and treating the fuzzy real-time risk meter + recovery-signal heads-up as an explicitly opt-in, easily-cut second slice.

Why this over the (very close) Tempo Coach and the engine-tier Intelligence Engine:

- **It targets the user's stated core therapeutic concern** (BFRB recovery) with the highest-impact-per-effort substrate in the entire data inventory — `bfrb_events` is rich, consolidated, synced, and barely surfaced.
- **The hardest part is the safest part.** Antecedent fields are additive-nullable (no `SCHEMA_VERSION` bump, dedup key provably unaffected), the panel is a zero-shared-file-edit registry drop-in, and risk/streak math is pure deterministic logic — the strongest possible target for the browser-run engine test suite.
- **It avoids the clinical-prescription trap that gates Tempo Coach.** A descriptive antecedent-pattern panel and a no-shame streak don't make a dosing recommendation for a controlled stimulant. The one piece that does carry framing risk (the risk-meter copy) is cleanly isolated into the deferrable second slice.
- **It's smaller and tighter than the Intelligence Engine**, which bundles 5–7 interlocking deliverables including a 7th synced store and a cross-cutting data-source refactor.

The Tempo Coach (readiness-aware daily loop) is the strongest *strategic-fit* candidate and a very close #2 — it's the most direct answer to the central "measure but never act" gap — but its headline value (dose-timing "take it by X" window + readiness-sized Flow default) is exactly where the clinical-framing ratification gate and the n-of-1 statistical fragility bite hardest, and a third of its value depends on the often-empty `recovery_signal` feed. It is the natural *next* milestone after the BFRB loop proves the descriptive-first, slice-the-ship pattern.

---

## Recommended Milestone: BFRB Closed Loop (descriptive-first, sliced)

**Milestone statement:** Turn every BFRB catch from a bare count into a Habit-Reversal-Training loop — capture the antecedent (urge 1–3 + trigger/body-zone chip) at the single `logCatch()` chokepoint, surface the patterns in a new triggers Insights panel, and reinforce with a forgiving no-shame clean-streak — shipping the pure, fully-self-verifiable awareness-and-reinforcement half first, with the real-time relapse-risk meter as a separately-gated opt-in follow-on.

**Why it wins the tie-break:**

1. **Real, daily, lived relief on the user's core concern.** BFRB recovery is explicitly this user's central therapeutic focus (`bfrb-recovery.js` runs a 60s HRT competing-response routine on every catch). The evidence base (ComB/SCAMP awareness training, HRT, implementation intentions) rests on *capturing the antecedent* — exactly the field Tempo throws away today. This is the biggest documented gap versus best-in-class BFRB apps (HabitAware Keen).

2. **Highest autonomy of the top cluster on the part that ships first.** The capture fields, panel, and streak are pure additive-nullable engine + zero-shared-file-edit registry work — unit-testable end-to-end, screenshot-verifiable at 390px, no native code, no Firebase write path on the critical path. The agent self-drives 100% of the first slice.

3. **It defuses the clinical-framing landmine by construction.** The risk-meter copy (the one piece needing user ratification) is cut into a second slice. The first slice is descriptive: "you logged 3 catches today; your clean-streak is 4 days" — no medical assertion.

4. **Scope is genuinely smaller than the Intelligence Engine and tighter than Tempo Coach's four-surface spread.** The first slice touches `bfrb-events.js` (additive fields) + `global-bfrb.js`/`bfrb-recovery.js` (capture UI) + one new panel + the standard lockstep wiring — and fails soft (one blanked card) if anything goes wrong.

---

## Ranked Table

All four leaders are within 0.05 of each other; ranking reflects judgment about scope discipline, clinical-framing exposure, and how much value is autonomously reachable in a first ship.

| Rank | Candidate | Board | Verdict | One-line why |
|------|-----------|-------|---------|--------------|
| 1 | **BFRB Closed Loop** | 8.5 | **Recommended** | Highest-impact-per-effort substrate on the user's core concern; the hard part (capture + panel + streak) is the safe, pure, fully-self-verifiable part, and the framing-risky risk-meter cleanly defers. |
| 2 | **Tempo Coach — readiness daily loop** | 8.5 | Strong runner-up | The most direct answer to the central "measure but never act" gap and maximal strategic fit, but its headline value sits squarely on the clinical-framing gate + n-of-1 fragility + the often-empty recovery feed. |
| 3 | **Personal Health Hub — Weekly Review + portable report** | 8.5 | Strong, ship-soon | Cleanest autonomy (pure string-producing functions, no native/Firebase-write path), genuinely novel doctor-prep export; docked for being a 3-feature bundle and reflective rather than forward-looking. |
| 4 | **Med Runway & Adherence Loop** | 8.45 | Strong, split-ship | Highest concrete real-life stakes (controlled-substance refill/dose); the pure runway/streak half is a clean win, but the nudge half is a deliberate philosophy reversal whose core promise (suspended-fire reliability) is the least self-verifiable piece. |
| 5 | **Personal Health Intelligence Engine** | 8.45 | Right idea, overscoped | The correct long-term consolidation and maximal fit, but bundles 5–7 deliverables incl. a 7th synced store + a cross-cutting data-source refactor; descope to the pure `insight-engine.js` core. |
| 6 | **Tempo Presence — Live Activities / widgets / Siri** | 6.9 | Defer / split | Transformative native presence for a time-blind user, but it's four products in a trenchcoat with a long Apple-paperwork tail; ship only the web-only depleting-wedge slice as a standalone milestone. |
| 7 | **Tempo Proving Ground — UI test harness + kit** | 6.65 | Sequence under, not instead | Highest-autonomy class and a real velocity floor, but zero direct user payoff and cuts against the gravitational direction; ship the harness-only first slice *after* a user-facing feature. |
| 8 | **HealthKit two-way bridge** | 6.0 | Sequence later | Removes the most-forgotten manual input, but it's a from-scratch Swift plugin with real double-write/silent-corruption risk, 0-for-2 native track record, and is explicitly "best paired after the intelligence loop proves out." |

### Notes on reordering vs. the raw scoreboard

The scoreboard already had a near-four-way tie at the top. I kept the board's ordering essentially intact but applied two judgment calls:

- **BFRB Closed Loop over Tempo Coach for #1** despite identical 8.5 totals. Both share the same impact (9) and autonomy (8). The deciding factor is **realized-value reachability and framing exposure**: Tempo Coach's two highest-effort thirds (dose-timing "take it by X" + readiness-sized Flow planning) are precisely the pieces blocked behind the clinical-ratification gate and the often-empty recovery feed, so its descriptive-only de-scoped v1 collapses toward "a thin Insights panel." The BFRB loop's descriptive-only v1 is **already the high-value core** (antecedent capture is the documented #1 evidence gap), and it has its own self-contained reinforcement (the streak) that doesn't depend on the external feed at all. The BFRB loop loses less when you strip it to its safe core.
- **Weekly Review held at #3** rather than promoted, even though it has the cleanest autonomy (9) of the whole field. Its impact (8) is genuinely lower — it's reflective/retrospective, the exact thing the recon repeatedly says is *not* the highest-leverage need — and the "doctor-ready" framing oversells a self-logged artifact. It's an excellent low-risk ship, just not the highest-impact one.

---

## Top Three — Deep Dives

### 1. BFRB Closed Loop (RECOMMENDED)

**Milestone statement:** Turn every BFRB catch into a Habit-Reversal-Training loop — antecedent capture at the `logCatch()` chokepoint, a triggers Insights panel, and a forgiving clean-streak — shipping the pure self-verifiable half first and gating the real-time risk meter as an opt-in follow-on.

**Scope (Slice A — ship first, fully autonomous):**
- Add additive-nullable `urge` (1–3), `trigger`, `bodyZone` fields to `BfrbEvents.log({...})` — no `SCHEMA_VERSION` bump; `sync-merge-bfrb` union-dedup key `(deviceId, takenAt)` is unaffected (assert invariance in `tests/sync-merge-bfrb.test.js`).
- One-tap capture chips on the existing `global-bfrb` FAB flow and/or the `bfrb-recovery.js` 60s competing-response card (doubles as the HRT competing-response step and the natural place to later surface an if-then plan). Chips are **secondary and dismissible** — one-tap log still works with zero chips, preserving the JITAI interrupt's frictionlessness.
- New self-registering `js/rhythm-panel-bfrb-triggers.js` — antecedent breakdown (by trigger, by body-zone, by hour-of-day, by context) + the forgiving clean-streak (clean-hours / days-since-last-catch with grace, reusing the `getFocusStreak` current/longest/alive framing).
- **Correctness invariant:** the panel and streak read the LIVE `BfrbEvents.getAll()` consolidated stream, NOT `Analytics`' session-END `s.bfrbs[]` snapshot path which can diverge/undercount. (`analytics.getBFRBTrend` already unions both sources with a documented dedup — a fixture test must assert the new panel's counts match the live store.)
- sw.js `CACHE_NAME` bump (`v110→v111-bfrb-loop`); new `<script>` in `index.html` + `tests/index.html` + the CLAUDE.md load-order block in lockstep.

**Scope (Slice B — separately gated, opt-in, may be cut):**
- A pure risk-score function hooked into the single `global-bfrb.js logCatch()` chokepoint, comparing today's running count + time-of-day pace against the de-duped `getBFRBTrend` baseline and today's `recovery_signal`; escalate via the existing non-blocking `Toast` (throttled to one band-change toast/day) + an optional strained-morning "high-risk window" heads-up.
- User-authored if-then implementation-intention plan surfaced inside the 60s competing-response countdown (device-local first: localStorage + `EXPORT_SETTINGS_KEYS`, the `flow_user_tasks` precedent).
- **Gated behind a dismissible opt-in toggle** and **only after the user ratifies the risk-meter copy/assertiveness.** Every `recovery_signal`-dependent surface degrades to a clean no-op when the feed is empty/stale/signed-out.

**Prereqs / cleanups folded in:**
- `global-bfrb logCatch()` single chokepoint — **confirmed** (calls `BfrbEvents.log(payload)`).
- `BfrbEvents.log` / `getAll` + additive-nullable field convention — **confirmed**.
- `sync-merge-bfrb` union-dedup by `(deviceId, takenAt)` must stay invariant under new fields — lock with a test.
- The documented Analytics session-END-snapshot vs live-store divergence — **resolve for this surface** by reading `BfrbEvents.getAll()` and asserting agreement.
- Routine lockstep housekeeping (sw.js bump, index.html + tests/index.html + CLAUDE.md in lockstep).
- One-time framing handoff: user ratifies risk-meter assertiveness BEFORE Slice B (does not block Slice A).

**Autonomy workflow sketch (phase-by-phase, with self-verification tool per phase):**
1. **Recon** — grep-confirm the `logCatch()` chokepoint, `BfrbEvents.log/getAll`, the dedup key in `sync-merge-bfrb`, the registry `register/_deps` seam, and the `getFocusStreak` streak idiom. *Self-verify: Bash grep/Read (structural).* 
2. **Plan** — write the additive-field list + panel spec + streak grace rules + the live-store invariant as the central correctness contract.
3. **Implement Slice A** — add the three nullable fields + stamping; build `js/rhythm-panel-bfrb-triggers.js`; wire capture chips; bump sw.js; lockstep `<script>` tags. *Self-verify: `node --check` syntax gate (Bash); grep that the panel calls `RhythmInsights.register` and reads `_deps`.*
4. **Engine-test** — extend `tests/bfrb-events.test.js` (new fields persist + dedup invariance), `tests/sync-merge-bfrb.test.js` (key unchanged under new fields), `tests/analytics.test.js` (live-store agreement), and a new `tests/rhythm-panel-bfrb-triggers.test.js` (risk/streak/breakdown over fixtures). *Self-verify: `python3 -m http.server 8765` + drive `tests/index.html` via **kapture/Playwright MCP**, read the self-reported PASS/FAIL count (this is the canonical run — curl does not execute the suite).* 
5. **UI-wire + visual-verify** — drive the live PWA: tap the FAB / press `B`, log a catch with chips, open Rhythm › Insights, confirm the triggers panel renders the breakdown + streak. *Self-verify: **kapture/Playwright MCP** screenshots at 390px across populated / sparse / empty states; assert capture-chip DOM and streak text.*
6. **Slice B (gated)** — implement risk score + Toast escalation + if-then surface; seed a `recovery_signal` doc to exercise the strained-day lens. *Self-verify: engine tests for the pure risk function; **kapture** to assert the Toast DOM appears on escalation and the countdown if-then line renders; **computer-use** to seed/inspect `recovery_state` in the **Firebase console**. One-time credential handoff: the user's Google sign-in for the live signed-in `recovery_state` read (treated as a handoff, not a dead end).* 
7. **Ship** — branch `feat/bfrb-closed-loop-slice-a`, open PR, pause for explicit per-push approval (standing rule). Doc/backlog edits via the `docs/<slug>` squash-merge PR path.

**Risks:**
- Scope creep — the bundle reads as five features; **mitigation: the A/B slice split is mandatory**, Slice A ships alone.
- Data-source divergence (live store vs `s.bfrbs[]` snapshot) producing a wrong risk ratio — **mitigation: read `getAll()` everywhere + a regression test asserting agreement.**
- Therapeutic-framing overreach on the risk meter ("expect 9 catches today" is anxiety-inducing) — **mitigation: risk meter is Slice B, opt-in, dismissible, and copy-ratified by the user first; Slice A is purely descriptive + reinforcing.**
- `recovery_signal` often empty for an offline-leaning user — **mitigation: every feed-dependent surface degrades to a clean no-op; Slice A doesn't touch the feed at all.**
- Friction on the FAB hot path — **mitigation: chips are optional/secondary; one-tap log is unchanged.**

**Success criteria:**
- Slice A merged: new nullable fields persist + sync with the dedup key provably unchanged; the triggers panel renders breakdown + a forgiving streak from the live `BfrbEvents.getAll()` stream; engine suite green (≥815 + new cases) read via the browser harness; 390px screenshots verified across populated/sparse/empty.
- A fixture test proves the panel's counts equal the live-store counts (no snapshot divergence).
- sw.js bumped; index.html + tests/index.html + CLAUDE.md in lockstep.
- Slice B (if pursued) ships behind a dismissible opt-in with user-ratified copy and a clean empty-feed no-op.

---

### 2. Tempo Coach — readiness-aware daily decision loop (STRONG RUNNER-UP)

**Milestone statement:** Turn the app's already-computed correlations forward — a top-of-Insights "Today" briefing that re-lenses the well/strained-day math through this morning's `recovery_signal`, a personal n-of-1 dose-hour→sleep-onset observation, and an energy-sized Flow default — all gentle, dismissible, opt-in, and descriptive-first.

**Scope:**
- New self-registering `js/rhythm-panel-today.js` at a low `order` so it pins atop Rhythm › Insights, built purely over the existing `_deps` accessors: `recovery_signal` via `recovery-feed` `getLatest`/`getDayRow`; well/strained focus+BFRB deltas reused from `rhythm-panel-correlations`; the dose-hour→bedtime slope from `rhythm-panel-meds-sleep`'s `firstDoseHourByDay × bedtimeHour` pairing (**confirmed present**); `meds.getStatusToday` for "dose still unlogged."
- A small **pure least-squares slope/intercept helper** with point-count + x-spread + slope-stability guards so the dose-window line never asserts on thin data; copy it into a shared stats module rather than refactoring it out of the shipped correlations panel.
- **(Deferred to a follow-up PR)** `Flow.configure({focusDurationMs})` default-selection off the same `recovery_signal` in flow-ui pre-block setup with a one-line "why," a user override, and a settings-drawer opt-out (`flow_readiness_suggest`); optional opt-in morning nudge via `BgNotify.schedule` (default OFF, cut from v1).

**Prereqs / cleanups folded in:** recovery-feed cached reads (**confirmed**); panel registry + `_deps` + card/empty helpers; correlations delta math + both-groups guard; meds-sleep dose-hour×bedtime pairing (**confirmed**); `Flow.configure` seam (**confirmed**); resolve the BFRB snapshot-vs-live-store divergence before building the BFRB callout (read `bfrb_events`); sw.js bump + lockstep wiring. One-time clinical/copy-framing ratification (inform-not-prescribe) — a hard gate for any prescriptive copy.

**Autonomy workflow sketch:**
1. **Recon** — confirm the `_deps` accessors, the meds-sleep pairing, the correlations deltas. *Self-verify: Bash grep/Read.*
2. **Plan** — freeze the descriptive-only copy contract ("On your earliest-dose days, sleep onset averaged ~41 min earlier") — NO imperative "take it by X" in v1.
3. **Implement** — `js/rhythm-panel-today.js` + the shared slope helper with conservative suppression; sw.js bump + lockstep. *Self-verify: `node --check`; grep registry call.*
4. **Engine-test** — `tests/rhythm-panel-today.test.js` with fixture recovery/dose/sleep/focus series; **explicitly test the suppression path** on sparse/noisy/unstable-slope fixtures (the guard is the well-tested part). *Self-verify: http.server + **kapture/Playwright** reading PASS/FAIL.*
5. **Visual-verify** — render the Today card across well / strained / absent (signed-out, feed-lagged) states; the empty-state must be the DEFAULT path and still deliver value from purely-local dose+sleep+focus data. *Self-verify: **kapture/Playwright** screenshots at 390px.*
6. **Cloud round-trip** — seed/inspect `recovery_state` to exercise the re-lens. *Self-verify: **computer-use** on the **Firebase console** + a real signed-in Firestore read through the running PWA; one-time Google-credential handoff.*
7. **Ship** — branch, PR, pause for per-push approval. Flow-default + nudge land as a separate follow-up PR after framing ratification.

**Risks:** clinical/medical overreach (the load-bearing risk — a "take it by X" line crosses descriptive→prescriptive); n-of-1 statistical fragility (a confident slope fitted to 6 noisy points is actively harmful); payoff depends on the usually-empty recovery feed; scope creep across four surfaces; refactor-coupling if delta math is pulled out of the shipped correlations panel; the snapshot-vs-live-store divergence trap.

**Success criteria:** the Today panel ships descriptive-only with a conservative, unit-tested suppression path; mandatory empty-state is the default-rendered path delivering local-only value; BFRB callout reads the consolidated `bfrb_events` stream with a fixture test asserting agreement; engine suite green via the browser harness; 390px verified across well/strained/absent.

---

### 3. Personal Health Hub — Weekly Review + portable doctor-ready report (STRONG, SHIP-SOON)

**Milestone statement:** Elevate the Rhythm engine into a personal-health hub — a once-a-week narrated "your week in focus, sleep, meds, BFRB, and recovery" digest with plain-language wins/watch-items, plus a date-ranged Markdown + per-stream CSV export — the human-legible artifact you keep or hand a clinician.

**Scope:**
- Weekly Review as an **order-15 Insights panel** (the recommended path — dodges any tempo-nav router/allowlist touch and inherits the `Promise.allSettled` per-panel failure isolation).
- Week-delta math as a pure function over the injectable `_deps` accessors (`sumByDay`/`windowDays` + `getFocusStreak`/`getMedAdherence`/`getBFRBTrend`/`getWeeklyTotals` + recovery-feed `getHistory` day-mix), reusing the conservative both-groups-have-data callout idiom for wins / watch-items / one suggested adjustment.
- **Portable Health Report** extends the `export.js buildBackupData` spine + `backup.js` Web-Share/`<a download>` plumbing into a date-ranged Markdown summary + tidy per-stream CSVs. **MUST read meds via the live `collectMedRecords()`/`MedsManager` path, NOT the deleted `wellness_meds` blob** (the F18-orphan fixes are already in main).
- **Cut from this milestone:** the optional Daily Review evening ritual — it shares no code with the digest/report and introduces a new persisted stream + streak state machine. Ship it as its own row later.

**Prereqs / cleanups folded in:** `_deps` data layer + card/empty + `sumByDay`/`windowDays`; the analytics getters + recovery-feed `getHistory`; the `export.js`/`backup.js` spine + `collectMedRecords()` meds sweep (live path); CSV bundling decision (prefer a single combined download or the `backup.js` Web-Share path over N separate `<a download>` clicks, which some browsers/WKWebView throttle); sw.js bump + lockstep wiring. The F18 meds-reader fixes and the recovery-feed NPE fixes are already merged — **do not re-fold them.**

**Autonomy workflow sketch:**
1. **Recon** — confirm `_deps` accessors, the analytics getters, the export spine, and the live meds path. *Self-verify: Bash grep/Read.*
2. **Plan** — pick the order-15-panel route; decide the single-combined-download CSV approach; freeze "personal longitudinal record" framing (drop over-strong "doctor-ready" clinical positioning).
3. **Implement** — the digest panel + the report/CSV builders as pure string-producing functions; sw.js bump + lockstep. *Self-verify: `node --check`; grep registry call + the live `collectMedRecords` read.*
4. **Engine-test** — `tests/rhythm-review.test.js` + `tests/report.test.js`: assert the delta object, each narrated sentence, Markdown tables, CSV headers/rows, the sparse-window "not enough data" path, and a regression test that the report ignores a lingering deleted `wellness_meds` blob. *Self-verify: http.server + **kapture/Playwright** PASS/FAIL.*
5. **Visual + download-verify** — render the digest at 390px; drive the actual download/share on the live PWA, intercept the blob via `browser_evaluate`, assert filename + content. *Self-verify: **kapture/Playwright**.*
6. **Ship** — branch, PR, pause for per-push approval.

**Risks:** 3-feature bundle (cut the Daily Review ritual); clinical-framing oversell ("doctor-ready"); the analytics data-source divergence baked into the substrate (pick one canonical source per stream and assert it); empty/sparse-window fragility (make "not enough data" a first-class, tested state); CSV multi-`<a download>` browser/WKWebView fragility (prefer single download); low marginal novelty over the existing correlations panel.

**Success criteria:** the digest renders as an order-15 panel with honest sparse-window handling; the report builds correct Markdown + CSV over the live meds path (regression test proves it ignores the deleted blob); the download/share works on the live PWA (blob intercepted and asserted); engine suite green via the browser harness; "personal record" framing (not "clinical authority").

---

## Full Candidate List

| Candidate ID | Name | Board | One-line |
|---|---|---|---|
| `bfrb-closed-loop` | BFRB Closed Loop — antecedent capture, real-time relapse-risk meter, forgiving streak | 8.5 | **Recommended.** Highest-impact-per-effort substrate on the user's core concern; hard part is the safe self-verifiable part; framing-risky risk-meter defers cleanly. |
| `tempo-coach-daily-loop` | Tempo Coach — readiness-aware daily decision loop | 8.5 | Most direct answer to the central "measure but never act" gap and maximal fit; headline value sits on the clinical-framing gate + n-of-1 fragility + the often-empty recovery feed. |
| `weekly-review-portable-report` | Personal Health Hub — Weekly Review digest + portable doctor-ready report | 8.5 | Cleanest autonomy, genuinely novel doctor-prep export; a 3-feature bundle and reflective rather than forward-looking. |
| `med-runway-adherence-loop` | Med Runway & Adherence Loop — supply forecast, refill-by date, daily nudge, adherence streak | 8.45 | Highest concrete stakes (controlled-substance); pure runway/streak half is clean, nudge half is a philosophy reversal whose core promise is least self-verifiable. |
| `personal-health-intelligence-engine` | Personal Health Intelligence Engine — guarded correlation core + n-of-1 experiments | 8.45 | The correct long-term consolidation, but bundles 5–7 deliverables incl. a 7th synced store + a cross-cutting refactor; descope to the pure engine core. |
| `tempo-presence-native` | Tempo Presence — Live Activities, widgets, Siri/App Intents | 6.9 | Transformative native presence for a time-blind user; four products in a trenchcoat with a long Apple-paperwork tail. Ship only the web-only depleting-wedge slice. |
| `ui-test-harness-and-kit` | Tempo Proving Ground — headless UI/DOM test harness + shared UI kit | 6.65 | Highest-autonomy class and a real velocity floor; zero direct user payoff. Sequence the harness-only slice UNDER a user-facing feature. |
| `healthkit-bridge` | HealthKit two-way bridge — write doses/mindful/sleep, auto-fill sleep-onset | 6.0 | Removes the most-forgotten manual input; from-scratch Swift plugin with double-write/silent-corruption risk and a 0-for-2 native track record. Sequence later. |

---

## Appendix A — Prereqs & Tech-Debt Folded In

**Already done in main — do NOT re-fold (CLAUDE.md is stale on these):**
- All 3 F18 orphaned `wellness_meds` readers are fixed and merged (rhythm-engine `getDoseEntries` #112, analytics `getMedAdherence` #116, export/backup per-record sweep #114) — they now read live `MedsManager.all()`.
- The 4 recovery-feed NPE baseline failures are fixed (#115); the suite is **815/815 green**. The "4 pre-existing failures" caveat is obsolete.
- Backlog #5 (Pomodoro phase revert) is shipped in main via another branch.

**Stale-PR housekeeping to flag (agent flags, human decides):**
- PR #104 (pomo revert) — orphaned open duplicate of already-merged work; **close it.** (Confirmed open, 18+ commits behind.)
- PR #91 (Live Activities) — open, never merged, 30 commits behind, zero `liveActivity` refs in main; **abandon and start clean** if Tempo Presence is ever pursued. (Confirmed open.)
- PR #86 (native CAS/listener parity) — open, never merged, 33 commits behind; both native branches still throw "native parity pending." (Confirmed open.)

**Folded into the recommended milestone (BFRB Closed Loop):**
- Resolve the Analytics session-END-snapshot vs live-store divergence *for the BFRB surface* — read `BfrbEvents.getAll()`, assert agreement with a fixture test. (This is the documented data-correctness watch-item; the chosen scope tackles it head-on rather than inheriting it.)
- Lock the `sync-merge-bfrb` `(deviceId, takenAt)` dedup invariance under the new additive fields with a test.
- Standard lockstep: sw.js `CACHE_NAME` bump (`v110→v111-bfrb-loop`), `<script>` in index.html + tests/index.html + the CLAUDE.md load-order block.

---

## Appendix B — Autonomy Posture

**What the agent self-drives (no human needed):**
- **Engine/data logic** — additive nullable fields, dedup invariance, risk/streak math, slope/delta helpers, report/CSV builders: pure functions, unit-tested by extending `tests/*.test.js`, run via `python3 -m http.server 8765` + driving `tests/index.html` with the **kapture/Playwright MCP** and reading the page's self-reported PASS/FAIL (curl does not execute the suite). `node --check` is a cheap syntax gate.
- **In-browser UI** — new Insights panels, capture chips, the Today/Weekly cards: no automated UI tests exist, but fully agent-verifiable by driving the live PWA with **kapture/Playwright** and screenshotting at 390px/360px (the repo's documented practice). The registry's `Promise.allSettled` isolation means a broken panel fails soft (one blanked card), easing spot-checks.
- **Cloud-sync / Firestore** — enable the sync flag, do a real auth sign-in + Firestore round-trip through the running PWA, inspect docs in the **Firebase console** via **computer-use**, simulate two-device convergence with two browser contexts. Seed `recovery_state` via the console / `seed-insights.js` to exercise the read path.
- **Deploy ops** — branch/commit, `npm run sync-www`, local http.server. (Push to main always requires explicit per-push approval — standing rule; blanket pre-approval doesn't count.)

**One-time credential handoffs (handoff, not a dead end):**
- The user's Google sign-in/biometrics for the live signed-in Firebase Auth + Firestore `recovery_state` round-trip (needed only for the recovery-feed-dependent surfaces — Slice B of the BFRB loop and the Tempo Coach re-lens).

**Genuinely human-only residue (flag, don't pretend to clear):**
- **Clinical/therapeutic framing ratification** — whether a relapse-risk message, a dose-timing "take it by X" line, or a med-reminder copy is clinically sane and non-coercive for a real person on a controlled stimulant in active BFRB recovery. The agent computes the number; the user owns the framing. *This is why the recommendation ships descriptive-first and gates every prescriptive surface behind explicit ratification.*
- **Real-data truth check** — confirming a callout "reads true" rather than as n-of-1 noise needs this user's accumulated weeks of lived dose/sleep/recovery data; the agent can only fixture-test.
- **Native iOS suspended-fire confirmation** — that a `BgNotify`/LocalNotification actually fires while WKWebView is suspended (relevant only to deferred/optional nudge surfaces; default OFF, so not on any v1 critical path).
- **Apple Developer enrollment + App Store paperwork + physical-device code-signing** — relevant only to the deferred Tempo Presence / HealthKit candidates, not to the recommended milestone.

**Net:** the recommended BFRB Closed Loop Slice A has **zero human-only residue on its critical path** — it's pure engine + a registry panel + a streak, all self-verifiable through the engine test harness and the browser MCP. Slice B's only residue is the framing ratification (a one-time handoff) and the optional feed-dependent surfaces (clean no-op when absent).
