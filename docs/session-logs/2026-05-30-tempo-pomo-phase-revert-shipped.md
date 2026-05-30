# Session Wrap-up — 2026-05-30 — Tempo: Pomodoro phase revert shipped (PR #104)

## 1. What we did

- Ran the full 5-phase orchestrator pipeline for backlog #11 (Pomodoro phase revert), producing PR #104 (`695700a`) — squash-merged to `feat/bl-11-pomo-phase-revert`, open against `main`.
- Wrote brief `docs/briefs/bl-11-pomo-phase-revert-BRIEF.md` from the CLAUDE.md spec before firing the auditor.
- **Phase 1 (auditor):** Produced `docs/audits/bl-11-pomo-phase-revert-AUDIT.md`; upgraded blast radius from proposed `low` to `medium` (engine + UI = 2 layers); caught `Persistence.save()` in engine as a test-harness blocker (Finding 1) and flagged `cancelAutoAdvance()` race guard requirement.
- **Phase 2 (engine-implementer):** Added `previousPhaseSnapshot` state variable, snapshot capture at top of `nextPhase()`, `revertPhase()`, `reset()` clear, `getState()`/`loadState()` round-trip, and public export to `js/pomodoro.js`.
- **Phase 3 (engine-tester):** 9 new cases in `tests/pomodoro.test.js` (snapshot capture, paused/running/idle fold-back, cycleIndex un-increment, overwrite, null no-op, reset clear, persistence round-trip). 712/716 suite pass; 4 pre-existing `recovery-feed` failures unchanged.
- **Phase 4 (ui-wirer):** Added `#pomo-go-back` button to `div.pomo-action-links` row in `index.html`; click handler + visibility toggle in `js/pomodoro-ui.js`; kapture-verified hidden while idle, visible while running/paused after a transition.
- **Phase 5 (pr-shipper):** `sw.js` bumped `v103-pomo-rename` → `v104-pomo-revert`; CLAUDE.md backlog row #5 ticked shipped; session log appended; PR #104 opened.

## 2. The why

**Snapshot before reset, not after.** `nextPhase()` immediately zeroes `accumulatedMs` and increments `cycleIndex`. Capturing the snapshot at the very top (before any mutation) means both the old elapsed time and the old cycle counter are preserved. Capturing after the reset would discard both — there'd be nothing to restore. Pattern: *snapshot at the decision point, not after the side-effect.*

**Fold-back arithmetic instead of a simple restore.** The user may have already spent time in the new phase before deciding to go back. Adding `currentElapsed` (new-phase time so far) to `snapshot.accumulatedMs` means the session clock shows a continuous total with no gap or jump. A simple restore would silently drop those minutes. Pattern: *always account for elapsed time at the transition boundary.*

**`Persistence.save()` removed from `revertPhase()` (Audit Finding 1).** The brief's sample code included a direct `Persistence.save()` call inside the engine function. At runtime this works (the global resolves at call time), but the engine test harness doesn't load `js/persistence.js` — so any test calling `revertPhase()` would throw `ReferenceError`. Resolution: the UI click handler calls `savePomodoroState()` after `revertPhase()` returns, matching the identical pattern used for `restartPhase()`. Pattern: *engine functions stay pure; persistence is the UI layer's responsibility.*

**`cancelAutoAdvance()` before `revertPhase()`.** When auto-advance is on, a countdown fires immediately after `nextPhase()`. If the user clicks "← Go back" while the countdown is running and the guard is missing, the countdown eventually calls `onPomodoroRight()` → `nextPhase()` again, double-advancing past the revert. Every Pomodoro click handler already starts with `cancelAutoAdvance()` — the guard simply follows the established pattern.

**One level of undo, snapshot overwrites.** A second `nextPhase()` call overwrites the existing snapshot (no stack). This is intentional: multi-level undo adds state-management complexity (what does "go back twice" mean when the intervening phase had work logged?), and the practical need is always "I just advanced by mistake." One level covers the use case cleanly.

**Medium blast radius, not low.** The brief proposed `low` but the feature touches two distinct layers (engine `js/pomodoro.js` + UI `js/pomodoro-ui.js` + `index.html`) plus a mandatory `sw.js` bump. The rubric's "2+ files across layers" boundary is `medium`. The upgrade matters because it triggers the 30-second proceed-by-default window in the pr-shipper, giving the user a chance to interrupt before push.

## 3. Concepts and vocabulary

| Term | Definition | Where it appeared |
|------|-----------|------------------|
| **Snapshot (undo pattern)** | A frozen copy of mutable state captured before a destructive transition, used to restore that state on undo. Here: `{ phase, cycleIndex, accumulatedMs }` captured at the top of `nextPhase()`. | `js/pomodoro.js` — `previousPhaseSnapshot` |
| **Fold-back / elapsed fold-back** | Adding time spent in the new (unwanted) phase back into the restored phase's accumulated total, so the session clock shows a continuous total with no gap. | `revertPhase()` arithmetic: `snapshot.accumulatedMs + currentElapsed` |
| **`cycleIndex`** | 0-based counter tracking which work session the user is on within the configured cycle count. Governs when a long break fires vs. a short break. Must be captured in the snapshot or a revert would leave the counter one ahead of where it should be. | `js/pomodoro.js:175`, snapshot capture |
| **Engine purity / pure engine** | Engine modules (`js/pomodoro.js`) contain zero DOM access and zero direct persistence calls. All side-effects (saving state, updating UI) are triggered by the UI layer after the engine returns. Makes the engine independently testable without loading the full app. | Audit Finding 1; `Persistence.save()` removal |
| **`cancelAutoAdvance()` guard** | Every Pomodoro click handler calls this first to stop any in-flight auto-advance countdown before taking action. Without it, a user interaction races against the countdown's eventual `nextPhase()` call. | `js/pomodoro-ui.js` click handler, audit risk table |
| **`pomo-action-links` row** | The always-visible row of small text links at the top of the Pomodoro view (Stats / Settings / Actions / Auto / Saved Tasks). Distinct from the collapsible `#pomodoro-actions` drawer. "← Go back" was placed here so it's accessible without opening the drawer — critical for auto-advance flow where the drawer isn't open. | `index.html`, Audit Finding 2 |
| **Blast radius tier (orchestrator)** | Audit-stamped severity (`low` / `medium` / `high`) that gates pr-shipper behavior: low → auto-push; medium → 30s window; high → explicit "ship it". Prevents accidental deploys of large changes. | Auditor upgrade from `low` → `medium` |
| **`savePomodoroState()`** | UI-layer function in `js/pomodoro-ui.js` that writes `Pomodoro.getState()` to localStorage under `pomodoro_state`. Called from click handlers after engine mutations — never from inside the engine itself. | `restartPhase()` and `revertPhase()` patterns |
| **Additive nullable field** | A new field added to an existing serialized state object with a `?? null` fallback on load. Existing saved states (missing the field) load cleanly; no migration or schema bump required. | `previousPhaseSnapshot` in `getState()`/`loadState()` |

## 4. Takeaways

**Capture the snapshot before any mutation, not at the "natural" end of setup.** It's tempting to place snapshot capture after guard checks but before "the real work." But in `nextPhase()`, the guard is a 2-line status check — everything after it is mutation. Placing the snapshot at the absolute top (line 1 of the function body) makes it trivially obvious and covers early-return branches (the `longBreak → done` path) for free.

**Engine purity pays off at test time, not just in theory.** The `Persistence.save()` issue wasn't theoretical — it would have caused a `ReferenceError` in every one of the 9 new engine tests, making the test suite useless. The brief's sample code had the bug; the audit caught it. Rule: if a function in an engine module references a name not defined in that file's own scope, it has a hidden coupling that will break isolated tests.

**The audit phase earns its cost by catching brief-vs-code drift.** Today: the brief's proposed blast radius was wrong (low → medium), the `Persistence.save()` pattern was wrong (engine vs. UI responsibility), and the button placement needed clarification (always-visible row vs. collapsible drawer). All three were caught before any code was written. Correcting in the brief takes minutes; correcting post-implementation takes a rewrite.

**When a click handler races with an auto-running timer, the guard must come first — always.** The `cancelAutoAdvance()` call isn't defensive programming; it's a hard correctness requirement. Missing it means two code paths can call `nextPhase()` on overlapping timelines, producing state mutations that are non-deterministic and hard to reproduce. Checking the existing patterns (every other handler starts with the cancel) is how you find this requirement — the convention is self-documenting.

## 5. Suggested next moves

1. **(Recommended) Merge PR #104 and verify on deploy.** Status: PR is open at https://github.com/ksdisch/stopwatch/pull/104, branch `feat/bl-11-pomo-phase-revert`. The feature is fully built and tested. Merging deploys to `ksdisch.github.io/stopwatch` in ~1 minute. Do a quick smoke: start a Pomodoro, let it overflow, advance, then click "← Go back" to confirm the revert works on the live PWA. Effort: 5 min.

2. **Diagnose the 4 pre-existing `tests/recovery-feed.test.js` baseline failures.** Every PR currently ships against a suite with 4 known-red tests that have to be mentally subtracted. The failures are `Cannot read properties of null (reading 'day'/'rows')` — likely a missing localStorage seed in the test setup (rhythm PR #98 context). Fixing makes future test signal trustworthy. Effort: ~30 min (read the test, add the missing seed, confirm 716/716).

3. **Live Todoist smoke against the deploy.** The Todoist engine is unit-tested and kapture-verified, but no token-backed close/reopen/create/update round-trip has been observed on the live site. One device with a real Todoist API token, 10 minutes. Effort: 10 min.

4. **Backlog #3 — cloud sync native CAS + listener parity (PR #86, open).** PR #86 (`feat/sync-native-listener-parity`) has been open for ~11 days. It's the last unshipped piece of the sync initiative. Requires Xcode + device for verification, which is why it's stalled. Only worth picking up if you have hardware access. Effort: medium (verification-gated).

## 6. 30-second elevator version

Today I shipped backlog item #11 for Tempo — a single-level undo for Pomodoro phase transitions. When you're in a focus session and accidentally advance to the break, there's now a "← Go back" link in the action row that reverts you to the previous phase, folding any time you spent in the break back into your work total so the session records cleanly. The interesting engineering was making sure the snapshot gets captured before `nextPhase()` resets the accumulated time and cycle counter — put it one line too late and you've already lost both values. I also had to keep the engine function pure: a first draft of the code had it calling `Persistence.save()` directly, which works at runtime but breaks isolated engine tests because the test harness doesn't load the persistence module. The audit phase caught both issues before any code was written. The whole thing ran through a five-phase agent pipeline — audit, engine, tests, UI wiring, and PR ship — and landed as PR #104 with 9 new engine tests all passing.

## 7. Active recall

1. Why must the snapshot be captured at the very top of `nextPhase()`, before the guard checks complete?
2. What is the fold-back arithmetic in `revertPhase()`, and what would go wrong if you just restored `snapshot.accumulatedMs` directly without adding `currentElapsed`?
3. Why was `Persistence.save()` removed from `revertPhase()`, and what's the correct place to call persistence after a `revertPhase()` invocation?
4. What race condition does `cancelAutoAdvance()` prevent, and why is it called *before* `Pomodoro.revertPhase()` rather than after?
5. The auditor upgraded blast radius from `low` to `medium`. What's the rubric boundary, and why does it matter for how the pr-shipper behaves?

---

Try to answer each aloud before scrolling. Answer key below.

### Answer key

1. **Snapshot placement.** The guard (`if (status !== 'overflowing' && status !== 'done') return`) is the only line before the mutations. Every subsequent line in `nextPhase()` is a mutation: `accumulatedMs = 0`, `startedAt = null`, `cycleIndex++`, phase reassignment. If the snapshot were placed after the guard but before a specific mutation, it would capture partially-modified state. Placed at the absolute top, it captures the state the user was actually in — and it covers the `longBreak → done` early-return branch for free, since that branch returns before reaching the reset block anyway.

2. **Fold-back arithmetic.** `revertPhase()` computes `currentElapsed = accumulatedMs + (status === 'running' && startedAt ? Date.now() - startedAt : 0)` — the time spent in the new phase since it started. Then it sets `accumulatedMs = snapshot.accumulatedMs + currentElapsed`. If you restored `snapshot.accumulatedMs` directly, any time the user spent in the new phase (even 30 seconds of a break) would silently vanish from the session record. The fold-back ensures the session clock is continuous: old-phase time + new-phase time = total elapsed, and it all shows under the restored phase.

3. **Engine purity / persistence responsibility.** `js/pomodoro.js` loads at `index.html:1036`; `js/persistence.js` loads at `index.html:1039`. At runtime the global reference resolves at call time, so it works in production. But the engine test harness (`tests/index.html`) doesn't load `js/persistence.js` at all — any call to `Persistence` from within the engine throws `ReferenceError: Persistence is not defined` and crashes every test in the suite. The fix: remove `Persistence.save()` from `revertPhase()`; the UI click handler calls `savePomodoroState()` after `Pomodoro.revertPhase()` returns. This is the identical pattern used for `restartPhase()`.

4. **`cancelAutoAdvance()` race.** When auto-advance is on, `startAutoAdvanceCountdown()` fires immediately after `nextPhase()`. It sets a timeout that will eventually call `onPomodoroRight()` → `nextPhase()`. If the user clicks "← Go back" during this countdown, `revertPhase()` reverts the phase — but the countdown is still running. When it expires it calls `nextPhase()` again, undoing the revert and advancing the user past where they wanted to be. Calling `cancelAutoAdvance()` first clears the countdown before `revertPhase()` runs, so there's no in-flight call left to fire. It must be called before, not after, because the timeout could theoretically fire in the gap between `revertPhase()` and a hypothetical post-revert cancel.

5. **Blast radius rubric.** The threshold for `medium` is "2+ files across engine OR UI layers." This PR touches `js/pomodoro.js` (engine layer) and `js/pomodoro-ui.js` + `index.html` (UI layer) — two distinct layers, so `medium`. The practical consequence: `low` triggers auto-commit + auto-push + auto-open PR with no pause; `medium` triggers auto-commit, then a 30-second proceed-by-default window where the user can interrupt before the push happens. `high` requires an explicit "ship it." The tier is stamped by the auditor and enforced by pr-shipper — the orchestrator cannot override it.
