# F7 audit — `loadState` recovery branches never persist back

Companion to PR A-1 (`docs/sync-impl/audits/A-1-AUDIT.md` §F7). Captures the
per-engine sweep findings so future sync work can re-check the contract
without re-reading every `loadState`.

**Strategy reference:** `docs/CLOUD-SYNC-STRATEGY.md` Stage E — *"`loadState`
recovery branches (auto-advance, `focusEndedAt`, `alarmFired`) are local
rendering only — never persisted back (F7)."*

**Methodology:** read each engine's `loadState`, identify recovery branches
(state mutations triggered by wall-clock divergence from the persisted
snapshot), confirm no terminal `Persistence.save()` / per-mode `saveXxxState()`
call inside the branch. The contract is about the branch *itself* — what
fields it mutates is fine; what matters is whether the branch writes those
mutations to disk before the user does something.

## Result: F7 holds without code changes

Every recovery branch in every engine stays in memory. None invoke
`Persistence.save()` (or `saveTimerState` / `savePomodoroState` /
`saveFlowState` / `saveIntervalState` / `saveSequenceState`) inside the
branch. The recovered state persists to disk only on the *next* user action,
which writes to a per-mode engine state key — every one of those keys is
in the **Excluded from sync** bucket per the strategy doc's Q4 resolution.

## Per-engine findings

### `js/stopwatch.js` (loadState lines 127–144)

- **Line 140 — clock-skew guard.** If `startedAt > Date.now()` (state was
  written on a device with a future clock), reset `startedAt = null` and
  `status = 'paused'`. In-memory only. No save. **OK.**

No other recovery branch.

### `js/timer.js` (loadState lines 132–178)

- **Line 143 — clock-skew guard.** Same shape as stopwatch. No save. **OK.**
- **Lines 148–165 — tab-closed-while-running recovery.** If the timer
  should have finished while the page was closed, mutate `accumulatedMs`,
  `startedAt`, `status`, `alarmFired`, `zeroCrossedAt`. Branches on
  `allowOvershoot`: overshooting timers continue to tick in `overflowing`;
  non-overshoot timers snap to `finished`. No save inside the branch. **OK.**
- **Lines 169–177 — 24h overshoot cap.** Snapshot `accumulatedMs` at the
  cap; clear `startedAt`. No save. **OK.**

### `js/pomodoro.js` (loadState lines 217–268)

- **Line 222 — legacy status migration.** `'phaseComplete'` →
  `'overflowing'`. In-memory only. **OK.**
- **Line 242 — clock-skew guard.** Same shape as above. No save. **OK.**
- **Lines 247–259 — tab-closed-while-running recovery.** Mutates `status`,
  `accumulatedMs`, `startedAt`, `alarmFired`, `zeroCrossedAt`, and **pushes
  to `phaseLog`** (the synthesized "the phase did complete while the tab
  was closed" entry). No save inside the branch. **OK.**
  - The pushed phaseLog entry is now F6-stamped (`deviceId`,
    `phaseStartedAt`). The push contributes to `history.sessions.phaseLog`
    *only via* a later user action — the engine doesn't write to history
    here.
- **Lines 261–268 — 24h overshoot cap.** Snapshot `accumulatedMs`; clear
  `startedAt`. No save. **OK.**

### `js/flow.js` (loadState lines 252–308)

- **Line 256 — legacy status migration.** `'focusComplete'` →
  `'overflowing'`. **OK.**
- **Line 277 — clock-skew guard.** **OK.**
- **Lines 282–299 — tab-closed-while-running recovery (both focus and
  recovery phases).** Mutates `status`, `accumulatedMs`, `startedAt`,
  `alarmFired`, `zeroCrossedAt`, and `focusEndedAt`. No save. **OK.**
- **Subtle note — `focusEndedAt` does feed into a synced record.** The
  recovery branch sets `focusEndedAt = focusEndedAt || now` (line 288).
  `js/flow-ui.js:saveFlowSession` (line 637) reads
  `Flow.getFocusEndedAt()` and writes it to
  `history.sessions.sessionEndedAt`. This is acceptable under F7 as
  written — the contract is "no `Persistence.save()` at the bottom of
  the recovery branch." The recovery sets a field; the *next user action*
  saves the session. The field is the best available estimate of when
  the focus phase ended (tab-reopen time, since the natural-completion
  time is unknowable). If a future change tightens F7 to "recovery
  branches must not influence any synced field," this is the site to
  revisit.
- **Lines 301–308 — 24h overshoot cap.** **OK.**

### `js/interval.js` (loadState lines 249–302)

- **Line 255 — legacy status migration.** `'done'` → `'overflowing'`.
  **OK.**
- **Line 268 — clock-skew guard.** **OK.**
- **Lines 272–292 — tab-closed-while-running recovery.** Branches on
  terminal (final round/phase) vs mid-program. Terminal: transition to
  `overflowing`, set `alarmFired = true`. Mid-program: snap to
  `phaseComplete` so the UI's auto-advance handler picks up. No save in
  either path. **OK.**
- **Lines 294–301 — 24h overshoot cap.** **OK.**

### `js/sequence.js` (loadState lines 130–147)

- **Line 138 — clock-skew guard.** **OK.**
- **Lines 142–146 — tab-closed-while-running recovery.** Mutate `status`
  to `'phaseComplete'`, snap `accumulatedMs` to the phase duration. No
  save. **OK.**

### `js/meds.js` (loadState lines 202–285)

`MedsManager.loadAll` is a different shape — it's a multi-record loader,
not a single engine. Its in-flight `loadState` per-med (lines 202–285)
does have one quasi-recovery branch:

- **Lines 269–275 — clock-skew dose filter.** Drops `doseLog` entries
  with `takenAt > now + 60s`. This mutates `doseLog` and `lastTakenAt`
  in-memory. No save inside `loadState` itself, but the *next* `saveAll`
  will persist the cleaned state to `meds/{id}` — meaning a corrupt-data
  cleanup *does* roundtrip through disk.

This is intentional: corrupt clock-skew dose entries shouldn't survive
across page loads. The strategy doc allows the cleanup; F4's
`recomputeLastTakenAt` covers the convergence guarantee on the synced
side (re-derived from the merged log, so any cleanup on one device gets
applied consistently across devices via the doseLog merge path).

## What this audit does NOT cover

- **F19a refuse-writeback** for future-schema records — separate contract
  (covered in `tests/meds.test.js`'s F19a suite).
- **F19b `__forward` passthrough** — separate (same suite).
- **F21 `alarmFired` per-device contract** — see A-1-AUDIT.md §F21 and the
  inline comment markers added in this PR.

## Conclusion

F7 holds across all six persisted engines. No fixes required. The audit is
preserved here so a future PR (most likely the manifest registry F19c
work, or any PR that adds a new synced store) can re-validate the contract
without re-reading every `loadState` from scratch.
