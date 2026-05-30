# Session Wrap-up — 2026-05-29 — Pomodoro Phase Revert Backlog Entry

## What we did

- Discussed and specified a new Pomodoro feature: a "← Go back" button that reverts to the previous phase and folds all elapsed time in the current phase back into the previous phase's accumulated total
- Clarified scope: works both directions (Work→Break and Break→Work), available indefinitely (no grace-period cutoff), history records as one continuous session with no special handling
- Added backlog entry #11 to `CLAUDE.md` at priority 5 (Low effort / Medium impact), with engine design, UI surface, and a concrete risk note about `cycleIndex`
- Renumbered the existing backlog rows 5–9 → 6–10 to make room
- Shipped via `docs/pomo-phase-revert-backlog` branch → PR #101 → immediate squash-merge (doc-only change, standard flow)

---

## The why

**Priority 5 (above Split-screen at 6, Voice control at 7):** The feature is Low effort — one snapshot field on the engine, one button in the UI — and Medium impact because it maps directly to a recurring real workflow friction point. Impact/effort ratio beats the two items it displaced, both of which are Medium-or-Low impact at Medium-or-High effort. The `#11` Added tag preserves chronological history without disturbing the ROI ordering.

**One level of undo only:** Storing only the most recent `previousPhaseSnapshot` keeps the engine state simple. Multi-level undo would require a stack and complicates the state model for a case that's essentially never needed (you'd have to flip phases three times in quick succession). The tradeoff accepted: reverting twice in a row is not supported — the second revert just undoes the first revert, since the snapshot is overwritten on each `nextPhase()` call.

**No history changes:** Because the feature works by adjusting `accumulatedMs` on the in-memory engine state before the session ends, History sees the correct totals naturally. No new history schema fields, no migration, no special session-split logic. Pattern: push complexity to the engine, keep the persistence layer dumb.

**`cycleIndex` in the snapshot (risk flag):** The Pomodoro engine uses `cycleIndex` to decide when to insert a long break (every N work cycles). If a revert restores the phase but not `cycleIndex`, the cycle count drifts — a user could revert from a long-break phase and find themselves stuck in an infinite short-break loop. Flagged explicitly in the backlog notes as the one correctness invariant to verify at implementation time.

---

## Concepts and vocabulary

| Term | Definition | Where it appeared today |
|------|-----------|------------------------|
| **Phase revert / undo phase transition** | Restoring the Pomodoro engine to its state immediately before the last `nextPhase()` call, with elapsed time from the abandoned phase folded back in | The feature we specified |
| **`previousPhaseSnapshot`** | A plain object `{ phase, cycleIndex, accumulatedMs }` saved on every `nextPhase()` call; the revert source of truth | Engine design in backlog entry |
| **Accumulated time (`accumulatedMs`)** | The sum of all wall-clock durations across all `start→pause` spans in a session; combined with `Date.now() - startedAt` (when running) to get total elapsed | Core of the fold-back math |
| **`cycleIndex`** | Pomodoro engine counter tracking how many work phases have completed in the current session; governs long-break cadence | Named as the key invariant to capture in the snapshot |
| **Impact/effort ROI ordering** | Backlog priority scheme: rank by (impact ÷ effort), not by when ideas were added. High impact + Low effort = top of list | How we chose priority 5 for the new entry |
| **Squash-merge (doc-only PR)** | Single-commit merge that collapses the feature branch into one commit on main; used for all `docs/` branches in this project to keep git log clean | PR #101 flow |
| **One level of undo** | A redo/undo design constraint: only the most recent state transition is reversible; older history is not recoverable | Accepted tradeoff for snapshot simplicity |

---

## Takeaways

**1. Clarify direction and time-bound before writing a backlog entry.** "Go back" sounds simple but has two hidden dimensions: which direction(s) does it work, and for how long is it available? Both have meaningful implementation consequences. A two-minute conversation collapsed weeks of potential scope ambiguity.

**2. Fold complexity into the engine, not the persistence layer.** The revert feature needs zero history schema changes because the engine absorbs the complexity (`accumulatedMs` adjustment) before the session is ever written out. When adding state-manipulation features, ask first: can the engine handle this before the data hits storage?

**3. Flag invariants explicitly in the backlog, not just "TODO."** The `cycleIndex` risk is specific enough that it could silently break the long-break cadence if missed. A backlog note that names the exact invariant is more actionable than "test edge cases."

**4. Low effort + Medium impact beats Medium impact + High effort every time.** The phase revert feature jumped above Split-screen because the ROI math is simple — same user benefit tier, fraction of the implementation cost. When prioritizing, always compare effort explicitly, not just impact.

---

## Suggested next moves

1. **(Recommended) Implement backlog #11 — Pomodoro phase revert.** The spec is fully written in `CLAUDE.md`. Low effort, real daily friction, no dependencies on unshipped infrastructure. Engine change is ~30 LoC in `js/pomodoro.js`, UI change is ~10 LoC in `js/pomodoro-ui.js`. Verify `cycleIndex` capture as the one correctness gate.

2. **Backlog #10-B — Pomo inline rename + Todoist `updateTask`.** Tiny self-contained follow-up to the Todoist V1 that shipped yesterday (#100). ~50 LoC, no new dependencies, completes the write-back surface. Good session filler if you want a quick win without engine risk.

3. **Backlog #10-A — Flow user-task list + Todoist integration.** Larger but well-scoped deferred half of the Todoist feature. Unblocked now that `js/todoist.js` is complete. Medium effort, high impact for the Flow workflow.

4. **iOS background ambient audio on-device verification.** PR #92 shipped the `AVAudioSession` fix but couldn't be verified in a web-only session. If you have the device handy, a 5-minute smoke test either closes this out or surfaces the follow-up (explicit session activation tied to `SFX.startAmbient`).

---

## 30-second elevator version

Today was a short backlog grooming session for Tempo, my personal productivity PWA. I realized I keep hitting the "end work phase" button in Pomodoro mode before I'm actually done, then wanting to go back. So I specced out and logged a new feature — a "Go back" button that reverts to the previous Pomodoro phase and folds all the time you spent in the current phase back into the previous one, so your session history stays accurate. The key design decision was keeping it one level of undo only — no stack — to keep the engine simple. I also flagged the one correctness risk: the cycle counter that governs long breaks has to be included in the snapshot, or you can get into a bad state on revert. The spec is in the backlog now at priority 5, above split-screen and voice control, because it's genuinely low effort for the value it delivers.

---

## Active recall

1. Walk me through the math of how "fold elapsed time back in" works when reverting a Pomodoro phase.
2. Why store only one level of undo instead of a full phase history stack?
3. What breaks if `cycleIndex` is not captured in the `previousPhaseSnapshot`?
4. Why does the history layer need zero changes to support this feature?
5. How did you decide this feature belongs at priority 5 rather than lower?

---

*Try to answer each aloud before scrolling. Answer key below.*

---

### Answer key

**1. Fold-back math:**
When `revertPhase()` is called, it first computes how much time has elapsed in the *current* (unwanted) phase: `elapsedInCurrentPhase = accumulatedMs + (status === 'running' ? Date.now() - startedAt : 0)`. It then restores `previousPhaseSnapshot` (which includes the previous phase's `accumulatedMs`), and adds `elapsedInCurrentPhase` to the restored `accumulatedMs`. The net effect: the previous phase now "remembers" all the time that was spent in both the original work span and the accidentally-started break span.

**2. One level of undo:**
A snapshot stack adds state complexity (size management, edge cases when the stack is empty, persistence questions) for a scenario that has essentially never happened in practice — a user would need to flip phases three times in quick succession and want multi-step undo. The accepted tradeoff: reverting twice just undoes the first revert (the snapshot is overwritten on each `nextPhase()` call), which is a reasonable degraded behavior for a very rare case.

**3. Missing `cycleIndex`:**
The Pomodoro engine increments `cycleIndex` on each completed work phase and uses it to decide when to schedule a long break (e.g., every 4 cycles). If the snapshot restores `phase` and `accumulatedMs` but not `cycleIndex`, the engine's cycle counter stays at the post-transition value. The user could revert from a phase that completed a cycle, and the next `nextPhase()` call would see a stale `cycleIndex` — potentially skipping or duplicating a long break.

**4. History needs no changes:**
The feature operates entirely on in-memory engine state. `revertPhase()` adjusts `accumulatedMs` before the session is ever persisted. When the session eventually ends and gets written to IndexedDB, History sees the final accumulated totals as if the phase flip never happened. No new fields, no migration, no session-split logic required.

**5. Priority 5 reasoning:**
The existing priority 5 was Split-screen (Medium impact, High effort). The phase revert is also Medium impact but Low effort — a strictly better ROI by the impact/effort formula the backlog uses. So it displaced Split-screen to priority 6. The features above it (iOS App Store, Todoist, Live Activities) are all High impact, which outweighs the effort difference.
