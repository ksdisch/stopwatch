# bl-11-pomo-phase-revert · Pomodoro single-level phase undo — "← Go back"

## Goal
Add a one-level undo for Pomodoro phase transitions: capture a `previousPhaseSnapshot` before each `nextPhase()` reset, expose `revertPhase()` on the engine, and render a conditionally-visible "← Go back" link in the Pomodoro actions row that restores the previous phase (with elapsed time folded back) when clicked.

## Blast radius
**Tier:** medium

**Justification:** The change touches two files in distinct layers (engine `js/pomodoro.js` + UI `js/pomodoro-ui.js`) with an optional third (`css/styles.css`), meeting the rubric's "2+ files across engine OR UI layers" threshold; `sw.js` cache bump is required because `js/pomodoro-ui.js` is a cached web file. No new localStorage key, no new module, no migration, no sync-store, no native change — nothing in the rubric pushes this to high.

## Affected files
| Path | Change type | Notes |
|------|-------------|-------|
| `js/pomodoro.js` | modify | Add `let previousPhaseSnapshot = null;` state variable. Capture snapshot in `nextPhase()` before reset block. Add `revertPhase()` function. Clear snapshot in `reset()`. Add `previousPhaseSnapshot` to `getState()` return object. Rehydrate via `state.previousPhaseSnapshot ?? null` in `loadState()`. Expose `revertPhase` on the public return object. |
| `js/pomodoro-ui.js` | modify | Add "← Go back" link to the `div.pomo-action-links` row in `updatePomodoroUI()` (or a new helper). Visibility guard: show only when `Pomodoro.getState().previousPhaseSnapshot !== null` AND `status ∈ {'running','paused'}`. Click handler: `Pomodoro.revertPhase()` + call `savePomodoroState()` + call `updatePomodoroUI()`. No new `addEventListener` on btn-left/btn-right — this is a separate link element. |
| `css/styles.css` | modify (optional) | Style the "← Go back" link to match `.offset-link` in the actions row. No new layout class required if the existing `.offset-link` class is reused directly; a minimal tweak may be needed for the arrow glyph. |
| `sw.js` | modify | Bump `CACHE_NAME`. Current value: `'stopwatch-v103-pomo-rename'`. Proposed: `'stopwatch-v104-pomo-revert'`. pr-shipper owns. |
| `tests/pomodoro.test.js` | modify | Add `describe('Pomodoro — revertPhase …')` block. 9 new cases — see Test scope section. |

**Affected file count: 5** (0 add + 4 modify + 1 modify test suite).

## Cross-cutting invariants touched
- **`sw.js` CACHE_NAME** — load-bearing. `js/pomodoro-ui.js` changes (and optionally `css/styles.css`); cache bump is mandatory or PWA installs serve stale assets.
- **Pomodoro state serialization contract** — `getState()` / `loadState()` round-trip is relied on by `savePomodoroState()` in `js/pomodoro-ui.js`. Adding `previousPhaseSnapshot` as an additive nullable field extends this contract without breaking existing persisted states (absent field loads as `null`).
- **No sync-store invariants** — `pomodoro_state` is explicitly excluded from `SYNCED_STORES` in `js/sync-engine.js`. No F1–F21 invariants from `docs/CLOUD-SYNC-STRATEGY.md` apply. No `deviceId` / `updatedAt` / `schemaVersion` stamping required.
- **Script-load-order constraint** — `js/pomodoro.js` loads before `js/persistence.js` (index.html lines 1036 vs 1039). The engine must NOT call `Persistence.save()` or `localStorage.*` directly inside `revertPhase()`. Persistence must be driven from the UI layer via `savePomodoroState()` after `revertPhase()` returns. See Audit findings below.

## Risks
| Risk | Likelihood | Blast radius | Mitigation |
|------|------------|--------------|------------|
| **`Persistence.save()` call inside `revertPhase()`** — the brief's code sample calls `Persistence.save()` directly at the bottom of `revertPhase()`. `Persistence` is defined in `js/persistence.js` which loads AFTER `js/pomodoro.js` in the script order (index.html:1036 vs 1039). At runtime this is a global reference that exists by call time (the IIFE closes over `Persistence` by name, not by value), so it works in production — but it creates a hidden coupling that breaks engine-only tests (the test harness at `tests/index.html` does NOT load `js/persistence.js`). The existing engine test stubs would need to either add a `window.Persistence` stub or — preferably — remove the `Persistence.save()` call from the engine entirely and let the UI call `savePomodoroState()` after `revertPhase()`. | med | local-only (test harness crash) | Remove `Persistence.save()` from `revertPhase()`. The UI click handler calls `Pomodoro.revertPhase()` then `savePomodoroState()` (matching the pattern used in `initActionsDrawer` for `restartPhase`). No engine test stub needed. Implementer must resolve before merging. |
| **`cycleIndex` double-count on revert** — if `previousPhaseSnapshot` does not capture `cycleIndex` before `nextPhase()` increments it, a work→break→revert sequence restores the incremented value, leaving `cycleIndex` one ahead of where the user was during the work phase. | med | local-only (session state corruption) | Snapshot captures `{ phase, cycleIndex, accumulatedMs }` BEFORE the `cycleIndex++` in `nextPhase()`. Test case 5 (cycleIndex un-incremented) explicitly verifies this. |
| **`accumulatedMs` fold-back arithmetic error** — `currentElapsed` must be computed as `accumulatedMs + (status === 'running' && startedAt ? Date.now() - startedAt : 0)` BEFORE `accumulatedMs` is overwritten. Off-by-one if the order is wrong or the running guard is missing. | med | local-only (incorrect elapsed time) | Test cases 2 (paused fold-back) and 3 (running fold-back) verify the arithmetic. The guard on `startedAt` prevents a NaN result when `startedAt` is null (as it is when status is 'idle' or 'paused'). |
| **Persistence round-trip fails for existing saved states** — a user with a pre-upgrade `pomodoro_state` in localStorage (no `previousPhaseSnapshot` field) loads the app post-deploy; `loadState` must not throw or misread the absent field. | low | local-only | `loadState` uses `state.previousPhaseSnapshot ?? null`, which handles the missing field gracefully. Test case 9 (persistence round-trip) verifies both the save and load paths. Existing `loadState` pattern already uses `?? null` consistently for all other fields — this follows the same convention. |
| **Snapshot-null no-op guard missing** — if `revertPhase()` is called with no snapshot (e.g., before any `nextPhase()` has fired, or after a `reset()`), it must return early without mutating state. A missing guard would corrupt `phase`, `cycleIndex`, or `accumulatedMs`. | low | local-only | The first line of `revertPhase()` is `if (!previousPhaseSnapshot) return;`. Test case 7 (revert on null snapshot is a no-op) covers this. |
| **`phaseLog` left untouched** — `revertPhase()` must NOT push a new `phaseLog` entry, alter the existing log, or delete the last entry. The completed-phase log entry from `checkFinished()` stays as-is; history records the session as it played out with no special handling. A mistaken splice or push here would corrupt session timeline data. | low | local-only (history record distortion) | Brief explicitly forbids `phaseLog` mutation in `revertPhase()`. No `phaseLog` write site in the proposed implementation. Engine test case 2 or 3 can assert `getPhaseLog().length` is unchanged after revert. |
| **"← Go back" link in the already-tight actions row** — the `div.pomo-action-links` row was previously noted in CLAUDE.md tech debt as having overflowed at 5 links (Stats / Settings / Actions / Auto / Saved Tasks) before a `flex-wrap:nowrap` + `overflow-x:auto` fix. A 6th link is added, but it is visibility-toggled (`hidden` by default) — it only appears when `previousPhaseSnapshot !== null` AND status is running/paused. The visible count therefore stays at 5 in the common case and only reaches 6 during the narrow window between phase transition and the next user action. | low | local-only (layout) | Implement the link with `class="hidden"` as default and only show when the snapshot is live. Verify the 6-link layout in the manual smoke at 390px. |
| **`autoAdvanceCountdown` + revert race** — when `autoAdvance` is on, `startAutoAdvanceCountdown()` fires immediately after `nextPhase()`. If the user clicks "← Go back" while the countdown is running, `revertPhase()` fires but the countdown timer continues and may call `onPomodoroRight()` (→ `nextPhase()`) after the revert, double-advancing. | med | local-only (unexpected phase skip) | The "← Go back" click handler must call `cancelAutoAdvance()` before `Pomodoro.revertPhase()`. The pattern already exists — every `onPomodoroLeft()` and `onPomodoroRight()` call starts with `cancelAutoAdvance()`. |
| **`sw.js` cache-bump miss** — if the implementer forgets to bump `CACHE_NAME`, existing PWA installs serve the old `js/pomodoro-ui.js` (and optionally `css/styles.css`), hiding the "← Go back" link indefinitely. | low | web-bytes | pr-shipper checklist + sign-off checklist both verify. Smoke step 1 catches it (no "← Go back" link visible). |

**Risk count: 8 total — 4 low / 4 med / 0 high.**

## Test scope
- **New tests required:** `tests/pomodoro.test.js` — add a `describe('Pomodoro — revertPhase …')` block with 9 cases:
  1. **Snapshot captured on nextPhase** — advance engine to `overflowing`, call `nextPhase()`, assert `getState().previousPhaseSnapshot` equals `{ phase: 'work', cycleIndex: 0, accumulatedMs: <nonzero> }`.
  2. **revertPhase while paused** — advance to `overflowing`, `nextPhase()` (status → `idle`), `start()`, `pause()`, call `revertPhase()`. Assert: `phase` reverted, `cycleIndex` reverted, `accumulatedMs = snapshot.accumulatedMs + pausedElapsed`, `status === 'paused'`, `previousPhaseSnapshot === null`.
  3. **revertPhase while running** — same flow but omit `pause()`. Assert: `status === 'running'`, `startedAt` is approximately `Date.now()` (within 50ms), `accumulatedMs = snapshot.accumulatedMs + elapsed`.
  4. **revertPhase from idle (new phase not yet started)** — `nextPhase()` leaves status `'idle'`; call `revertPhase()` without calling `start()`. Assert: `status === 'paused'`, `phase` and `cycleIndex` restored, `accumulatedMs = snapshot.accumulatedMs` (zero currentElapsed).
  5. **cycleIndex un-incremented** — configure 2+ cycles, advance through work→break transition (`nextPhase()` increments to `cycleIndex: 1`), call `revertPhase()`. Assert `getCycleIndex() === 0`.
  6. **Snapshot overwritten on second nextPhase** — two transitions without revert; assert that `getState().previousPhaseSnapshot.phase` reflects the SECOND transition's pre-state, not the first.
  7. **revertPhase on null snapshot is a no-op** — call `revertPhase()` immediately after `reset()` (snapshot is null). Assert: state is unchanged, no throw.
  8. **Snapshot cleared on reset()** — set up a snapshot via `nextPhase()`, then `reset()`. Assert `getState().previousPhaseSnapshot === null` (or `getState()` does not contain the field / contains `null`).
  9. **Persistence round-trip** — call `nextPhase()` to create a snapshot, capture `getState()`, call `reset()`, call `loadState(capturedState)`. Assert `getState().previousPhaseSnapshot` is restored to the same object.

- **Existing tests at risk:**
  - `tests/pomodoro.test.js` — existing 25 cases are read-only from the engine's public API and do not assert on fields absent in the current `getState()`. Adding `previousPhaseSnapshot: null` to `getState()` is additive; no existing assertion will fail. However, any case that calls `getState()` and does a deep-equality check against a hardcoded expected shape would need updating. Scan for such checks before merging.
  - `tests/index.html` — `pomodoro.test.js` is already linked (line 103). No harness change needed; `revertPhase` tests are pure engine calls with no DOM or `Persistence` dependency.
  - **Baseline failures (pre-existing, unrelated):** 4 failures in `tests/recovery-feed.test.js` from the rhythm PR (#98) are pre-existing and unrelated to this PR. The engine-tester must report new failures only against the pre-PR baseline minus these 4. Any new failure in `pomodoro.test.js` or `tests/index.html` is a regression to fix before shipping.

## Manual setup steps
1. Open the Pomodoro tab. Confirm "← Go back" link is NOT visible while idle (no snapshot yet).
2. Start a work session. Click "Pause". Confirm "← Go back" is still NOT visible (no phase transition has fired yet, so `previousPhaseSnapshot` is null).
3. Let the work phase overflow (or set `workMs` to a short value via the Settings panel). Advance to the break via the right button. Confirm status transitions to `idle` (new phase not started) and "← Go back" is NOT visible yet (DECISION 5: link only shows when status is running or paused).
4. Start the break phase. Confirm "← Go back" IS now visible.
5. Click "← Go back". Confirm: the engine reverts to the work phase, the timer continues counting from the folded-back total, `cycleIndex` is restored, and the link disappears.
6. Repeat with the auto-advance toggle ON: let work overflow; auto-advance fires (3-second countdown). While the auto-advance countdown is running, click "← Go back". Confirm the countdown cancels and the engine reverts cleanly.
7. Verify that the `phaseLog` in History (logged at session end) does NOT grow an extra entry from the revert — history records the session as played out.
8. Verify the "← Go back" link is NOT visible in `status === 'overflowing'` (between zero-cross and user advancing).
9. Confirm no layout overflow of the actions row at 390px with the "← Go back" link visible alongside the existing 5 links.

## Out of scope (explicitly NOT in this PR)
- Multi-level undo — one snapshot only; second `nextPhase()` overwrites the first.
- Revert of the very first phase — `previousPhaseSnapshot` is null until the first `nextPhase()` fires.
- Changes to `phaseLog` or history session shape.
- `restartPhase()` changes — this is a separate reset-current-phase action, unrelated.
- Any sync-store / Firebase / `js/schema.js` / `js/platform.js` / `ios/*` / `package.json` changes.
- App Store re-submission — this PR changes no iOS-binary-relevant code.

## Audit findings (discrepancies between brief and actual code)

**Finding 1 — BLOCKER: `Persistence.save()` must be removed from `revertPhase()` engine code.**
The brief's implementation sample calls `Persistence.save()` as the last line of `revertPhase()` inside `js/pomodoro.js`. `Persistence` is defined in `js/persistence.js`, which loads at `index.html:1039` — three script tags after `js/pomodoro.js` at `index.html:1036`. In production the global reference resolves at call time (not at IIFE-load time), so the UI works. However, `tests/index.html` does NOT load `js/persistence.js` at all, so any test that calls `revertPhase()` inside the engine test suite would throw `ReferenceError: Persistence is not defined`.

Resolution (matching the existing `restartPhase()` pattern): remove `Persistence.save()` from `revertPhase()` entirely. The UI click handler in `js/pomodoro-ui.js` calls `Pomodoro.revertPhase()` then immediately calls `savePomodoroState()` (which calls `localStorage.setItem('pomodoro_state', JSON.stringify(Pomodoro.getState()))`). This is the identical pattern used for `Pomodoro.restartPhase()` in `initActionsDrawer()` at `js/pomodoro-ui.js:1463–1468`.

**Finding 2 — placement clarification for the "← Go back" link.**
The brief says "link in the actions row" but does not specify whether this is in the `div.pomo-action-links` (the always-visible row of small links at the top: Stats / Settings / Actions / Auto / Saved Tasks) or inside `div#pomodoro-actions` (the collapsible actions drawer with the grid buttons: Clear Focus / Clear Break / Restart Phase / Finish & Reset / Clear All Tasks).

The DECISION 5 visibility rule ("NOT visible when status === 'idle' or 'overflowing' or 'done'") and the brief's stated intent ("while in any active Pomodoro phase, visible when running or paused") point to the `pomo-action-links` row — a persistent, directly-accessible link like the existing "Stats" or "Settings" links, not buried inside a collapsible drawer.

If placed inside the drawer, the user would need to open Actions to see it, which adds friction after every phase transition and conflicts with "Auto: On" flow (the auto-advance fires without the user opening the drawer). The `pomo-action-links` row placement is consistent with the brief's intent and the UI pattern.

Implementer should render the link in `pomo-action-links` with `class="offset-link hidden"` and toggle visibility in `updatePomodoroUI()`. The link's default-hidden state means the row stays at 5 visible items in all non-revert states; 6 items appear only during the running/paused window after a phase transition.

**Finding 3 — `nextPhase()` has an early-return path for `longBreak → done` that must also capture the snapshot.**
In the current `js/pomodoro.js:183–189`, the `longBreak → done` branch sets `status = 'done'` and returns before the common reset block. The brief's snapshot capture instruction says to place it "at the TOP of `nextPhase()`" before any mutation — this naturally covers the early-return path too. Verify the implementer places the snapshot line at the very top (before the `phase === 'longBreak'` branch), not after it. A snapshot captured before `longBreak → done` would have `{ phase: 'longBreak', cycleIndex: N, accumulatedMs: M }` — technically valid, but DECISION 5 says the "← Go back" link is NOT shown when `status === 'done'`, so this snapshot is captured but never surfaced. No behavior risk; just confirm placement.

## Sign-off checklist (for the implementer)
- [ ] Engine module changes match the affected-files table (`js/pomodoro.js`, `js/pomodoro-ui.js`, optionally `css/styles.css`, `sw.js`)
- [ ] `revertPhase()` does NOT call `Persistence.save()` or `localStorage.*` — persistence is the UI layer's responsibility (call `savePomodoroState()` from the click handler, not from the engine)
- [ ] `previousPhaseSnapshot` captured at the VERY TOP of `nextPhase()`, before any mutation (covers both the common path and the `longBreak → done` early-return path)
- [ ] `revertPhase()` clears `previousPhaseSnapshot = null` at the end of a successful revert
- [ ] `reset()` clears `previousPhaseSnapshot = null`
- [ ] `getState()` includes `previousPhaseSnapshot`; `loadState()` restores it via `state.previousPhaseSnapshot ?? null`
- [ ] `revertPhase` is on the public return object alongside `nextPhase`
- [ ] "← Go back" click handler calls `cancelAutoAdvance()` BEFORE `Pomodoro.revertPhase()` (auto-advance race guard)
- [ ] "← Go back" link visibility is toggled in `updatePomodoroUI()` — visible only when `previousPhaseSnapshot !== null` AND `status ∈ {'running','paused'}`
- [ ] Test scope above is covered (9 new cases in `tests/pomodoro.test.js`)
- [ ] No test case calls `Persistence.*` — engine tests are pure (no `js/persistence.js` in `tests/index.html`)
- [ ] Pre-existing 4 baseline failures in `tests/recovery-feed.test.js` are noted and not counted as regressions
- [ ] No re-implementation of `escapeHtml` (js/dom-utils.js) / `Utils.formatMs` (js/utils.js) / `Platform.*` (js/platform.js)
- [ ] Revert action is silent — no `Platform.haptic(...)` call and no `SFX.*` call on the revert path (brief: "Revert action is silent")
- [ ] `sw.js` `CACHE_NAME` bumped from `'stopwatch-v103-pomo-rename'` to `'stopwatch-v104-pomo-revert'` (or next increment if a v104 PR landed first)
- [ ] No new localStorage key — `previousPhaseSnapshot` serializes into the existing `pomodoro_state` key
- [ ] `SYNCED_STORES` in `js/sync-engine.js` is unchanged (still 6 entries: `meds`, `history`, `rest_log`, `presets`, `bfrb_events`, `distractions`)
- [ ] `js/schema.js` unchanged — no `SCHEMA_VERSION` bump
- [ ] `js/platform.js` unchanged
- [ ] `package.json` unchanged
- [ ] Manual smoke (9 steps above) executed; layout at 390px verified (6-link row with "← Go back" visible)
- [ ] CLAUDE.md Feature Backlog row #5 ticked as shipped
