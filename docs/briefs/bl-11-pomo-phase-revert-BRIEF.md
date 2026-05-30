# Tempo — implement PR `bl-11-pomo-phase-revert`

This is **backlog priority 5** ("Pomodoro phase revert — '← Go back'"). While in
any active Pomodoro phase, a "← Go back" link in the actions row reverts the session
to the previous phase. All time elapsed in the current phase is folded back into the
previous phase's accumulated total. One level of undo only. History records the
session normally with no special handling.

## Required reading (before any code)

1. **`CLAUDE.md`** — Feature Backlog table, priority-5 row (#11); Pomodoro state
   model; sw.js cache-bump rule.
2. **`js/pomodoro.js`** (read fully — you EDIT this). Key anchors:
   - State variables: `status`, `phase`, `cycleIndex`, `accumulatedMs`, `startedAt`
     (lines 1–20 approx).
   - `nextPhase()` (line ~158) — the transition function. Only callable when
     status is `'overflowing'` or `'done'`. Resets `accumulatedMs = 0`,
     `startedAt = null`, increments `cycleIndex` on work→break transitions, sets
     `status = 'idle'`. **Snapshot must be captured BEFORE this reset block.**
   - `reset()` (line ~100 approx) — must clear the snapshot.
   - `getState()` / `loadState()` (lines ~234+) — snapshot must be serialized and
     rehydrated for persistence across tab close.
   - The `phaseLog` array — revert does NOT push a new `phaseLog` entry; the
     completed phase entry is already there from `checkFinished`.
3. **`js/pomodoro-ui.js`** (read — you EDIT this). Key anchors:
   - The actions row (search `pomo-actions`, `pomo-links` or similar) — where
     "← Go back" link gets injected.
   - `renderPomodoro()` / the RAF render loop — where visibility guard logic lives.
4. **`tests/pomodoro.test.js`** (read — you EXTEND this). Understand existing test
   patterns; add a `describe('Pomodoro — revertPhase …')` block.

## What this PR ships

A single-level undo for Pomodoro phase transitions:

- **Engine (`js/pomodoro.js`):** Before every `nextPhase()` transition, save
  `previousPhaseSnapshot = { phase, cycleIndex, accumulatedMs }` (capturing the
  state BEFORE the reset). Add `revertPhase()`:
  1. Guard: return early if no snapshot exists.
  2. Compute `currentElapsed = accumulatedMs + (status === 'running' ? Date.now() - startedAt : 0)`.
  3. Restore `phase` and `cycleIndex` from snapshot.
  4. Set `accumulatedMs = snapshot.accumulatedMs + currentElapsed`.
  5. If status was `'running'`: set `startedAt = Date.now()` (resume counting from the restored total).
  6. If status was `'idle'` or `'paused'`: set `startedAt = null`, status = `'paused'`
     (or keep 'idle' if it was 'idle' — see DECISION 4).
  7. Clear `previousPhaseSnapshot = null`.
  8. Persist state.
  Snapshot is overwritten on each new `nextPhase()` call. Cleared on `reset()` and
  when `status` becomes `'done'`.
- **UI (`js/pomodoro-ui.js`):** "← Go back" link in the Pomodoro actions row,
  visible whenever `previousPhaseSnapshot` exists AND status is `'running'` or
  `'paused'` (DECISION 4). Click calls `Pomodoro.revertPhase()` then
  re-renders.
- **`css/styles.css`** (optional): style the "← Go back" link to match the
  existing actions-row links. No new layout.
- **`sw.js`:** CACHE_NAME bump (cached files change). pr-shipper owns this.

**Out of scope (explicit):**
- No change to `phaseLog` or history session shape — history records normally.
- No multi-level undo — one snapshot only.
- No revert of the very first phase (snapshot is null until the first
  `nextPhase()` fires).
- No `restartPhase()` change — restartPhase is a separate reset-current-phase
  action, unrelated.
- No sync-store / schema / native / iOS / dependency change.
- No new persistence key — `previousPhaseSnapshot` is added to the existing
  `getState()` / `loadState()` object (no new localStorage key).

## DECISIONS — RATIFIED 2026-05-29 (Kyle)

| # | Topic | Ratified resolution |
|---|-------|---------------------|
| 1 | Snapshot capture point | Capture `{ phase, cycleIndex, accumulatedMs }` BEFORE `nextPhase()` resets `accumulatedMs = 0`. This preserves the old phase's elapsed time for fold-back. |
| 2 | Elapsed fold-back | `currentElapsed` (time spent in the new phase so far) is ADDED to the snapshot's `accumulatedMs`. Applies whether the new phase was running, paused, or idle. |
| 3 | cycleIndex restore | Snapshot captures `cycleIndex` before `nextPhase()` increments it. `revertPhase()` restores it — so work→break→revert correctly un-increments the cycle counter. |
| 4 | Status after revert | If reverting while `'running'`: stay running (update `startedAt = Date.now()`). If `'paused'` or `'idle'` (new phase not yet started): set status to `'paused'` so the session is in a resumable state (not fully idle). This matches "while in any active phase" intent and avoids resurfacing the "start break" prompt. |
| 5 | Button visibility | "← Go back" visible when `previousPhaseSnapshot !== null` AND `status ∈ {'running','paused'}`. NOT visible when `status === 'idle'` (between phases, before user starts the new phase) or `'overflowing'` or `'done'`. Cleanest: user initiates the new phase, then can go back. If user wants to go back immediately after nextPhase fires they just don't start the new phase (session log shows normal). |
| 6 | Persistence | `previousPhaseSnapshot` included in `getState()` / `loadState()` so a tab-close + reopen correctly retains the undo snapshot. |
| 7 | Phasing / auto-advance | `autoAdvance` (if implemented) calls `nextPhase()` + `start()` — snapshot fires in `nextPhase()` so the "← Go back" link appears after auto-advance transitions too. |

## Implementation

### 1. `js/pomodoro.js` (Phase 2, engine)

(a) **New state variable** (top of factory, with other `let` declarations):
```js
let previousPhaseSnapshot = null;
```

(b) **Snapshot capture** — at the TOP of `nextPhase()`, before any mutation:
```js
function nextPhase() {
  if (status !== 'overflowing' && status !== 'done') return;
  // Capture snapshot BEFORE reset, for one-level revert.
  previousPhaseSnapshot = { phase, cycleIndex, accumulatedMs };
  // ... existing code continues ...
```

(c) **`revertPhase()` function** — new function, insert after `nextPhase`:
```js
function revertPhase() {
  if (!previousPhaseSnapshot) return;
  const currentElapsed = accumulatedMs +
    (status === 'running' && startedAt ? Date.now() - startedAt : 0);
  phase = previousPhaseSnapshot.phase;
  cycleIndex = previousPhaseSnapshot.cycleIndex;
  accumulatedMs = previousPhaseSnapshot.accumulatedMs + currentElapsed;
  if (status === 'running') {
    startedAt = Date.now();
  } else {
    startedAt = null;
    status = 'paused';
  }
  previousPhaseSnapshot = null;
  Persistence.save();
}
```

(d) **Clear on `reset()`** — add `previousPhaseSnapshot = null;` in the reset body.

(e) **Serialize** — add `previousPhaseSnapshot` to `getState()` return object.

(f) **Rehydrate** — add `previousPhaseSnapshot = state.previousPhaseSnapshot ?? null;`
    in `loadState()`.

(g) **Expose** — add `revertPhase` to the public return object alongside `nextPhase`.

### 2. `js/pomodoro-ui.js` (Phase 4, UI)

Add a "← Go back" link to the Pomodoro actions row, rendered alongside existing
links ("Distraction log", "Saved Tasks", etc.). Visibility guard: render only when
`Pomodoro.getState().previousPhaseSnapshot !== null` AND status is `'running'` or
`'paused'`. On click: `Pomodoro.revertPhase()` + trigger a re-render.

### 3. `css/styles.css` (Phase 4, optional)

Match "← Go back" link style to existing actions-row links. No new layout.

### 4. `sw.js` — CACHE_NAME bump

Mandatory. pr-shipper owns.

## Engine-test plan

`tests/pomodoro.test.js` — new `describe('Pomodoro — revertPhase …')` block:

1. **Snapshot captured on nextPhase** — advance to overflowing, call `nextPhase()`,
   verify `getState().previousPhaseSnapshot` contains `{ phase:'work', cycleIndex:0,
   accumulatedMs: <nonzero> }`.
2. **revertPhase while paused** — advance to overflowing, `nextPhase()`, `start()`,
   `pause()`, call `revertPhase()`. Verify: phase reverted, cycleIndex reverted,
   accumulatedMs = snapshot.accumulatedMs + pausedElapsed, status = 'paused',
   snapshot cleared.
3. **revertPhase while running** — same flow but leave running. Verify: status stays
   'running', startedAt updated to ~now, accumulatedMs = snapshot value + elapsed.
4. **revertPhase while idle (new phase not started)** — `nextPhase()` leaves status
   'idle'. `revertPhase()` → status = 'paused', phase/cycleIndex restored.
5. **cycleIndex un-incremented** — start second work, advance to break, `nextPhase()`
   (cycleIndex becomes 1), `revertPhase()` → cycleIndex back to 0.
6. **Snapshot overwritten on second nextPhase** — two transitions without revert →
   only one snapshot (second overwrites first).
7. **revertPhase on null snapshot is a no-op** — no crash; state unchanged.
8. **Snapshot cleared on reset()** — after revert or after reset, snapshot is null.
9. **Persistence round-trip** — `getState()` includes snapshot; `loadState(getState())`
   restores it.

## Hard rules

- **Audit before code.**
- **No DOM in engine code.** `js/pomodoro.js` must stay pure.
- **No new localStorage key** — `previousPhaseSnapshot` serializes into the existing
  `pomodoro_state` via `getState()`/`loadState()`. No separate key.
- **No phaseLog mutation** — revert does NOT alter the phaseLog. The completed phase
  entry stays as-is; history records the session as it played out.
- **No `SCHEMA_VERSION` bump** — non-synced store, additive nullable field.
- **No sync-store / Firebase / native / iOS change.**
- **Use shared helpers** — `Utils.formatMs`, `escapeHtml`, `Platform.haptic` (no
  direct `navigator.vibrate`). Revert action is silent (no haptic needed).

## Phase plan

- **Phase 2 (engine-implementer):** `js/pomodoro.js` — snapshot, revertPhase, persist.
- **Phase 3 (engine-tester):** `tests/pomodoro.test.js` — 9 cases above.
- **Phase 4 (ui-wirer):** `js/pomodoro-ui.js` + optional `css/styles.css`.
- **Phase 5 (pr-shipper):** sw.js bump + CLAUDE.md backlog tick + SESSION-LOG.

## Blast radius

**Proposed tier: low.** Engine change is additive (new field + new function, no
mutation of existing logic paths). UI change is one new link in an existing row.
No migration, no new persistence key, no sync-store, no new module, no native change.
Auditor confirms.

## Deliverable

Branch `feat/bl-11-pomo-phase-revert`, PR against `main`.
PR title: `feat(pomodoro): phase revert — "← Go back" to previous phase (#11)`.
