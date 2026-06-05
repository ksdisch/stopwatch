# Tempo — Next-Build Brainstorm: Final Ranked Shortlist

**Date:** 2026-06-05 · **Branch context:** `feat/tempo-coach-daily-loop` (item #15 shipped, pending push to main) · **Strategist pass:** closing four recon angles + two adversarial critique lenses.

## Executive Summary

Tempo Coach — the app's first forward-looking, act-on-the-data step — is built. The next build should compound on it and finish closing the central gap every recon angle independently named: **the app measures richly but rarely acts.** Four candidates survive after merging the duplicates across angles and cutting the Apple-gated / hygiene / overscoped items.

The recommendation is **BFRB Closed Loop**. It is the only candidate that converts the app's richest, most-consolidated, fully-synced-but-barely-surfaced stream (`bfrb_events`) into the actual Habit-Reversal-Training loop for the user's single central therapeutic concern — and the hard 80% of the work is the fully self-verifiable web/JS part, with no Apple gate.

All four load-bearing technical claims were re-verified against the code on this branch before ranking (see Verification Notes).

## Scoring Weights

impact **0.30** · autonomy **0.30** · feasibility **0.15** · strategic-fit **0.15** · prereq-ease **0.10**

## Ranked Shortlist

| # | Milestone | Impact | Autonomy (self-verifies / human residue) | Effort | Risk | Score |
|---|-----------|:------:|------------------------------------------|:------:|:----:|:-----:|
| 1 | **BFRB Closed Loop** — antecedent capture + triggers panel + forgiving clean-streak | 9 | Engine/panel/streak self-verify; residue = ~6 chip labels' clinical copy | 4 | 3 | **8.8** |
| 2 | **Med Runway & Adherence Loop** (routed through `buildTodayModel`) | 8 | Pure arithmetic self-verifies; residue = <7d threshold + twice-daily streak rule | 3 | 2 | **8.5** |
| 3 | **Weekly Review + doctor-ready report** (order-15 digest) | 7 | Aggregation/render/share self-verify; residue = clinical copy tone | 3 | 2 | **8.0** |
| 4 | **Smart Daily Notification** — recurring nudge + afternoon med channel | 8 | Schedule logic self-verifies; residue = **on-device suspended-fire confirmation** | 3 | 4 | **7.3** |

## Top Recommendation — BFRB Closed Loop

**What.** At the single consolidated `logCatch()` chokepoint (`js/global-bfrb.js:115`), after `BFRBRecovery.start()` fires its 60s competing-response countdown, surface a 1–2 tap forgiving picker: urge intensity (1–3) + one trigger/body-zone chip. The values are folded into the **same** `BfrbEvents.log()` call as nullable additive fields — never a post-hoc patch. A new `js/rhythm-panel-bfrb-triggers.js` (order 45) renders top trigger contexts over 14 days plus a forgiving clean-streak hero, reusing the `renderFocusStreak` dots idiom at `js/analytics-ui.js:71`. **Phase 2 (deferred):** capture `crOutcome` (Helped/Partial/No) at the natural 60s-countdown-complete transition — same entry, same panel, zero new surface.

**Why it wins.** BFRB recovery is the user's single central therapeutic concern. `bfrb_events` already carries `context/sessionId/phase` on every catch and is fully synced, yet the only surface is a frequency line chart — the app counts catches but has never asked *why*, which is the entire substrate of HRT. A 1–2 tap capture *during the already-running competing-response countdown* is the lowest-friction window in the app. The hard part is 100% web/JS: no Apple paperwork, no on-device-only verification.

**Scope.** `js/global-bfrb.js` (inline picker → holding ref → single `log()` call) · `js/bfrb-events.js` (additive nullable fields, ride the existing Firestore path via the F19b forward-bag, **no new sync store**) · new `js/rhythm-panel-bfrb-triggers.js` (order 45, self-registering) · `index.html` script tag · `css/styles.css` · `sw.js` CACHE_NAME bump · ~20 tests across `tests/bfrb-events.test.js` + new `tests/bfrb-triggers.test.js`.

**Folded-in cleanup (load-bearing).** Define the forgiving-streak rule *before* coding: "clean" = a fixed no-catch window elapsed, **not** "no catch logged today" — the naive version rewards *not logging*, the exact opposite of the goal.

**Autonomy split.** *Self-verifies:* same-call additive write + round-trip, forgiving-streak math, panel build/render, registry isolation — browser-run engine tests + kapture visual check. *Human-only residue:* ratification of the trigger/body-zone taxonomy and intensity-label copy (clinical framing for a real BFRB-recovery user on a stimulant) — a short sign-off on ~6 labels — plus a "reads true on accumulated data" demo gate (`seed-insights.js` in the tree suggests staging is already underway).

## Runners-up

**#2 Med Runway & Adherence Loop.** Nearly tied and genuinely lower-risk. Extends the `doseStatus` that `buildTodayModel` (`js/tempo-coach.js:172`) already assembles every morning with two pure derivations — `runwayDays` (over `getSupplyRemaining()`, verified at `meds.js:299`) and `adherenceStreak` — surfacing a one-line "Refill by ~DATE" warning under 7 days and a 7-day adherence-dots hero. The cleanest compound on the shipped engine. It loses the top slot only because it *deepens* a loop the app already touches (the Today dose row), whereas #1 *opens* the loop the app has never closed — strictly higher marginal impact for the same self-verifiable effort class. Keep Today terse: one-line warning only, detail lives in #3.

**#3 Weekly Review + doctor-ready report.** The genuine last mile — a plain-language order-15 digest (order confirmed free) with a Copy-as-Markdown / share button a clinician can act on. Pure aggregation of streams the other 8 panels already compute; zero cross-cutting risk. Behind the top two only because it summarizes rather than creates new signal — and it *compounds* once #1 lands (the trigger breakdown becomes a digest line). Pre-flight check: confirm the RhythmInsights `_deps` layer exposes a meds accessor to panels before coding, so adherence% is not hidden plumbing.

**#4 Smart Daily Notification.** Highest pure-compounding ceiling — it operationalizes shipped engine output into ambient action. The existing nudge is verified one-shot (`js/tempo-nav.js:386`, scheduled once over a *snapshot* recovery row); this upgrades it to a recurring daily re-arm that re-evaluates `shouldNudge()` against the *current* row, plus an afternoon med-unlogged channel. Ranked fourth for one reason that the weighting punishes hard: its critical-path payoff — *does it fire when the iPhone is suspended?* — is the one thing kapture/browser **cannot** verify. Sequence it after #2 so the afternoon channel can draw on the runway/streak signals, and budget the on-device confirmation as an explicit human gate.

## Resolving the Two Critique Lenses

The lenses disagreed sharply on #1 (strategic-fit lens: **9, keep-strong**; autonomy lens: **6, keep-watch**). The disagreement is entirely about the capture-time clinical-copy ratification. I resolve it in favor of #1 by adopting the autonomy lens's *own* mitigation rather than its conclusion: ship the engine + panel + streak (the self-verifiable 80%) behind a terse, conservative default taxonomy, make the copy the single explicit human gate, and defer the high-arousal `crOutcome` debrief to phase 2 so two prompts never compete during a mid-urge moment. That converts the residue from a structural blocker into a bounded sign-off — exactly the shape the weighting rewards. The lenses *agreed* on #2 (most self-verifiable) and #3 (additive, residue is copy tone), so those ride through unchanged. They agreed to **cut** native sync parity (value lives in native-only branches the harness cannot run), the stale-placeholder/Analytics-tap hygiene fix (real but it is a bug, route to just-do-it not the roadmap), settings grouping / FAB label (cosmetic, single user who knows what BFRB means), and the Personal Health Intelligence Engine (overscoped — a 7th synced store + cross-cutting refactor; the merged #2 + #3 deliver its actionable subset without the refactor).

## Verification Notes (checked against this branch)

- `logCatch()` (`js/global-bfrb.js:115–132`) — single consolidated path, payload `{context, sessionId?, phase?, cycleIndex?}`, **zero** antecedent fields. ✓
- `BfrbEvents.log()` (`js/bfrb-events.js:276`) — stamps deviceId+updatedAt+schemaVersion, gates on `SyncState.canWrite()` (F13). **Blindspot confirmed:** antecedent fields must ride the *same* `log()` call — a post-hoc synced patch would race the first write through the F19b forward-bag and risk a lost update. This keeps #1 at effort-4, not effort-6. ✓
- `meds.js` — `getSupplyRemaining()` (line 299), `getStatusToday()` (317), `getExpectedDosesToday()` (311), `getDoseLog`, `getFrequency` all present and derived. ✓
- `buildTodayModel` (`js/tempo-coach.js:172`) — `doseStatus.meds[]` carries `{name, dose, kind, takenToday, expected}`, stops short of supply/runway/streak → #2 is a pure extension. ✓
- `renderFocusStreak` (`js/analytics-ui.js:71`) — `{current, longest, recent7, activeToday}` → hero + 7-day dots. Reusable for both BFRB and med streaks. ✓
- Panel orders in use: 5, 10, 20, 30, 40, 50, 60, 70 → **15 and 45 are free.** ✓
- Existing nudge (`js/tempo-nav.js:339–386`) — confirmed one-shot over a snapshot row, no recurring re-arm, no afternoon channel → #4 target accurate. ✓

## Autonomy Posture

**Build order:** #1 → #2 → #3 → #4. The first three are fully self-drivable end-to-end (engine + registry panel + browser-run tests + kapture/Playwright visual checks); #4's logic self-verifies but its payoff sits behind an on-device gate, so it goes last and explicitly budgets the user's suspended-fire confirmation. **Every survivor requires an `sw.js` CACHE_NAME bump in the same PR**, and visual checks must run on a fresh port (8770+) because kapture serves stale SW-cached JS. The recurring human-only residue across the set is consistent and small: clinical/therapeutic *framing* ratification for a real person on a stimulant, plus — for #4 only — on-device notification confirmation. Everything else is Claude-verifiable before it reaches the user.
