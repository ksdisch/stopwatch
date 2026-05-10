# PR A-1 — Stage A close-out: affected-files + risks audit

**PR:** `feat/sync-stage-a-prereq-closeout` → `main`
**Scope:** F4 + F6 + F7 + F21 (the four remaining Stage A prereqs called out in
`docs/sync-impl/PLAN.md`).
**Status:** Audit-only commit. Code commit follows after human review.

This audit enumerates every site the code commit will touch, plus the F7 / F21
findings that don't require code changes. The intent is to fix the blast radius
*before* writing any code so review focuses on the right surfaces.

---

## Headline findings

1. **F6 is narrower than the plan implied.** Only `js/pomodoro.js` has a
   `phaseLog` field today. Flow, Interval, Sequence do not produce phaseLog
   entries — adding the field to them is a scope expansion the plan does not
   call for. The code commit stamps Pomodoro's three push sites plus the
   one phaseLog push that lives in `js/pomodoro-ui.js` (the
   end-of-session "partial:true" entry). Total: four push sites.
2. **F7 holds without code changes.** No `loadState` recovery branch in any
   of the five engines invokes `Persistence.save()` (or the per-mode
   `saveXxxState()`) at the bottom of the branch. Recovery mutations stay
   in memory until the next user action saves the engine state — and every
   engine state store is **excluded from sync** per the strategy doc.
3. **F21 holds without engine changes.** `alarmFired` lives only in
   per-mode engine state stores (`multi_state`, `pomodoro_state`,
   `flow_state`, `interval_state`), all excluded from sync. The code
   commit will add an inline `// F21: per-device, never synced` comment at
   each `alarmFired` reference so a future synced-store PR can't smuggle it
   in by accident.
4. **F4 helper proposed shape:** a per-med `recomputeLastTakenAt()` method
   on the `createMed()` factory plus a `MedsManager.onMergeComplete(medId)`
   manager-level hook. Unused until D-2 wires it; commits dead code by
   design (the plan ships this in A-1 specifically to keep D-2's PR
   focused on reconcile logic).

---

## F4 — re-derive `lastTakenAt` from `doseLog` after merge

**Strategy reference:** `docs/CLOUD-SYNC-STRATEGY.md` row 2 of the per-store
table — *"`wellness_meds.lastTakenAt` — Derived — do not sync. Re-derived from
merged `doseLog` after merge (F4)."*

**Proposed helper signature:**

```js
// js/meds.js — inside createMed(id) factory, returned in the public API.
function recomputeLastTakenAt() {
  lastTakenAt = doseLog.length > 0
    ? doseLog[doseLog.length - 1].takenAt
    : null;
}
```

Notes on the proposed shape:

- **Per-med method, not standalone function.** The helper needs to mutate the
  med's closed-over `lastTakenAt`. A factory method keeps the contract simple
  (no parameter — operates on its own state) and matches how `logDose()`,
  `undoLastDose()`, and the existing tail-derived branch inside `loadState`
  already handle the field.
- **No `touch()` call inside.** `recomputeLastTakenAt` is invoked AFTER a
  cross-device merge where the merge process is the user of the helper, not
  a user action. Bumping `updatedAt` in here would cause every merge to
  produce a write — that's the SyncEngine's call to make, not the helper's.
- **Idempotent.** Reading the tail and writing to `lastTakenAt` is safe to
  call any number of times.
- **Assumes `doseLog` is already sorted.** `logDose()` keeps it sorted; the
  `loadState` path sorts on load; D-2's reconcile path must sort after merge
  (a precondition documented in D-2's audit).

**Manager-level hook:**

```js
// js/meds.js — MedsManager singleton.
function onMergeComplete(medId) {
  const m = get(medId);
  if (!m) return;
  m.recomputeLastTakenAt();
}
```

Plan: `MedsManager.onMergeComplete(medId)` is the surface D-2's
`SyncEngine` calls after a per-med doseLog reconcile completes. A-1
exposes the hook; D-2 wires the caller. Both fail closed (no-op) if the
med isn't found — saveAll on next user action will re-emit a clean state.

**Files touched:** `js/meds.js` only.

---

## F6 — `phaseLog` `(deviceId, phaseStartedAt)` stamping

**Strategy reference:** `docs/CLOUD-SYNC-STRATEGY.md` row 4 of the per-store
table — *"Each `phaseLog` entry is stamped `(deviceId, phaseStartedAt)` at push
time so the immutable bag has a per-entry merge key (F6)."*

### Inventory — every phaseLog.push site in the codebase

Five push sites in two files. Today's entry shape is
`{ phase, startedAt, endedAt, overshootMs? | restarted? | partial? }`.

| # | Site | Context | Today's entry shape |
|---|------|---------|---------------------|
| 1 | `js/pomodoro.js:125` (`checkFinished`) | Natural phase boundary (timer expires; engine pushes the completed phase before transitioning to `overflowing`). | `{ phase, startedAt: phaseStartedAt, endedAt: now, overshootMs: 0 }` |
| 2 | `js/pomodoro.js:176` (`restartPhase`) | User taps "Restart phase" in the Actions drawer. | `{ phase, startedAt: phaseStartedAt, endedAt: Date.now(), restarted: true }` |
| 3 | `js/pomodoro.js:256` (`loadState` recovery) | Tab closed mid-phase, reopened after `phaseDurationMs` elapsed — engine writes a synthetic completion entry so the session record reflects the missed boundary. | `{ phase, startedAt: phaseStartedAt, endedAt: now, overshootMs: 0 }` |
| 4 | `js/pomodoro-ui.js:1054` (`gatherTimingData`) | End-of-session capture: appends an open-ended entry for whichever phase is currently in progress at the moment the session is saved. | `{ phase, startedAt: phaseStart, endedAt: Date.now(), partial: true }` |

There is no `phaseLog.push` (or analogous) site in `js/flow.js`,
`js/interval.js`, `js/sequence.js`, `js/stopwatch.js`, or `js/timer.js`.

### Proposed stamping

Stamp every push with `(deviceId, phaseStartedAt)`. The existing `startedAt`
field is the phase's start timestamp by construction — `phaseStartedAt` is
added as an explicit alias so the dedup tuple in cross-device merge logic
(D-2 / E-1) reads naturally and so external readers (analytics, history
UI) can keep using `startedAt` without churn.

```js
// js/pomodoro.js — inside the factory, add a local helper near the top.
function _phaseDeviceId() {
  return typeof History !== 'undefined' && History.getDeviceId
    ? History.getDeviceId()
    : null;  // engine-tests load pomodoro.js without history.js; stays null there.
}

// At each push site:
phaseLog.push({
  phase,
  startedAt: phaseStartedAt,
  endedAt: now,
  overshootMs: 0,
  // F6: per-entry merge keys for cross-device append-merge.
  deviceId: _phaseDeviceId(),
  phaseStartedAt,
});
```

Notes:

- **Additive only.** Existing readers (`history-ui.js:248`, `analytics.js:514`)
  do not look at `deviceId` / `phaseStartedAt` today; the new fields are
  ignored by old readers and the existing `startedAt` field stays the
  display key.
- **Downlevel safety.** Per F19b passthrough rules, the schema is
  forward-compatible: a pre-F6 client reading a F6-stamped session record
  preserves the unknown fields via `__forward`. (Note: F19b's passthrough
  operates at the *top-level record* — phaseLog entries are nested inside
  the immutable history bag, so they survive verbatim by virtue of the
  parent's roundtrip, not by `__forward` per se.)
- **The `pomodoro-ui.js:1054` push site** lives in the UI module rather
  than the engine. Two options:
  - (a) Stamp it in-place in `gatherTimingData`. Pros: the UI knows
    `History.getDeviceId()` directly, no helper needed. Cons: stamping logic
    lives in two files.
  - (b) Move the push into the engine via a new `Pomodoro.snapshotPartialPhase()`
    helper, then stamp once. Pros: stamping in one place. Cons: scope creep
    (touches `gatherTimingData` semantics).
  - **Proposal:** option (a) — stamp in place. The two stamp blocks are
    a few lines each; centralizing the four sites isn't worth the engine API
    expansion for A-1.
- **The `loadState` recovery push (site #3)** is intentionally included in
  F6 stamping. F7 says recovery branches mustn't `Persistence.save()` at
  the bottom of the branch — and this push doesn't (the in-memory phaseLog
  is saved by the *next* user action's `savePomodoroState()`). The entry
  itself genuinely belongs in the session record (the phase did complete
  while the tab was closed), so dedup keys are needed on it too.

### Test surface (in tests/sync-stamps.test.js)

- F6.1: `Pomodoro.checkFinished()` push carries `deviceId` and `phaseStartedAt`.
- F6.2: `Pomodoro.restartPhase()` push carries `deviceId` and `phaseStartedAt`.
- F6.3: `Pomodoro.loadState()` recovery push carries `deviceId` and `phaseStartedAt`.
- F6.4: `gatherTimingData()` partial-phase push carries both fields (covered
  via a direct DOM-free assertion on the entry produced — see test plan).
- F6.5: Legacy phaseLog entries (no `deviceId`) load and roundtrip cleanly
  (F19b spirit — old entries survive).

---

## F7 — `loadState` recovery branches never persist back

**Strategy reference:** `docs/CLOUD-SYNC-STRATEGY.md` Stage E section —
*"`loadState` recovery branches (auto-advance, `focusEndedAt`, `alarmFired`)
are local rendering only — never persisted back (F7)."*

**Sweep methodology:** read each engine's `loadState` function, identify
recovery branches (anything that mutates state in response to wall-clock
divergence from the persisted snapshot), confirm no terminal
`Persistence.save()` / `saveXxxState()` call in the branch.

### Per-engine findings

#### `js/stopwatch.js:127–144`
- Clock-skew guard at line 140: if `startedAt > Date.now()`, sets
  `status = 'paused'` and clears `startedAt`. No save call. **OK.**

#### `js/timer.js:132–178`
- Clock-skew guard at line 143. No save. **OK.**
- Tab-closed-while-running recovery at line 148–165: mutates `accumulatedMs`,
  `startedAt`, `status`, `alarmFired`, `zeroCrossedAt`. No save. **OK.**
- 24h overshoot cap at line 169–177: snapshots `accumulatedMs`, clears
  `startedAt`. No save. **OK.**

#### `js/pomodoro.js:217–268`
- Status migration (line 222): legacy `'phaseComplete'` → `'overflowing'`.
  In-memory only. **OK.**
- Clock-skew guard at line 242. No save. **OK.**
- Tab-closed-while-running recovery at line 247–259: mutates `status`,
  `accumulatedMs`, `startedAt`, `alarmFired`, `zeroCrossedAt`, and
  **pushes to `phaseLog`** (covered in F6 above). No save call inside the
  branch. **OK** — but note: this branch contributes to the synced
  `history.sessions.phaseLog` indirectly (next user action saves engine
  state; eventual session-end pulls phaseLog into the history record).
  This is the intended behavior: the phase genuinely did complete while
  the tab was closed.
- 24h overshoot cap at line 261. No save. **OK.**

#### `js/flow.js:252–308`
- Status migration (line 256): legacy `'focusComplete'` → `'overflowing'`.
  In-memory only. **OK.**
- Clock-skew guard at line 277. No save. **OK.**
- Tab-closed-while-running recovery at line 282–299: mutates `status`,
  `accumulatedMs`, `startedAt`, `alarmFired`, `zeroCrossedAt`,
  `focusEndedAt`. No save call inside the branch. **OK.**
- **Subtle F7 note:** `focusEndedAt` set in the recovery branch (line 288)
  *does* feed downstream into a synced record via
  `flow-ui.js:saveFlowSession()` line 637, which reads
  `Flow.getFocusEndedAt()` and writes it to `history.sessions.sessionEndedAt`.
  This is acceptable under the plan's interpretation of F7 — "no
  `Persistence.save()` at the bottom of the recovery branch." The recovery
  sets a field; a *later user action* saves the session. The field is the
  best available estimate of when the focus phase ended (the tab-reopen
  time, since the natural-completion time is unknowable).
- 24h overshoot cap at line 301. No save. **OK.**

#### `js/interval.js:249–302`
- Status migration (line 255): legacy `'done'` → `'overflowing'`. **OK.**
- Clock-skew guard at line 268. No save. **OK.**
- Tab-closed-while-running recovery at line 272–292: branches on terminal
  vs mid-program. Either path stays in-memory. **OK.**
- 24h overshoot cap at line 294. No save. **OK.**

#### `js/sequence.js:130–147`
- Clock-skew guard at line 138. No save. **OK.**
- Tab-closed-while-running recovery at line 142–146: status →
  `'phaseComplete'`, accumulatedMs snapshot, clears `startedAt`. No save.
  **OK.**

### F7 conclusion

**No code changes required.** Every recovery branch ends without invoking
`Persistence.save()` or its per-mode equivalent. The next user action is
responsible for persisting the recovered state to per-mode engine state
keys, all of which are excluded from sync.

The full F7 finding will be cross-linked to `docs/sync-impl/F7-AUDIT.md`
inside the code commit, in the format the plan called for. The doc will
mirror this section verbatim plus the line-by-line citations above — no new
findings will surface there.

---

## F21 — `alarmFired` is per-device

**Strategy reference:** `docs/CLOUD-SYNC-STRATEGY.md` Stage E section —
*"`alarmFired` is intrinsically per-device — Device B must still play the
chime even after Device A fires (F21)."*

### `alarmFired` reference inventory

| File | Lines | Context |
|------|-------|---------|
| `js/timer.js` | 10, 84, 106–108, 128, 140, 158, 163 | declared, reset, set+fire in `checkFinished`, emitted in `getState`, loaded in `loadState`, set in recovery branches |
| `js/pomodoro.js` | 17, 92, 127–128, 149, 182, 212, 235, 254 | declared, reset, set+fire in `checkFinished`, reset in `nextPhase`/`restartPhase`, emitted, loaded, set in recovery branch |
| `js/flow.js` | 23, 101, 126, 149–151, 187–188, 200–201, 247, 270, 290, 298 | declared, reset, reset on `startRecovery`, set on `endFocusEarly`, set in `checkFinished` (both focus + recovery branches), emitted, loaded, set in recovery branches |
| `js/interval.js` | 16, 117, 169–170, 244, 262, 286 | declared, reset, set in `checkFinished` terminal branch, emitted, loaded (with `\|\| status === 'overflowing'` fallback), set in recovery branch |

`alarmFired` is NOT present in `js/stopwatch.js` or `js/sequence.js`.

### Cross-sync exposure check

| Engine state key | Sync inclusion |
|---|---|
| `multi_state` (timers + stopwatches) | **Excluded** (engine state, Q4) |
| `pomodoro_state` | **Excluded** (engine state, Q4) |
| `flow_state` | **Excluded** (engine state, Q4) |
| `interval_state` | **Excluded** (engine state, Q4) |

**Status:** `alarmFired` never leaves the local device today. The per-device
contract is satisfied by virtue of engine state being out of sync entirely.

### Proposed change

**No engine logic changes.** Add an inline comment marker at each
`alarmFired` reference so a future PR that adds a new synced store
(F19c, manifest registry) can't accidentally surface engine state without
the F21 contract being re-checked. Comment template (placed at the
declaration line in each of the four engines):

```js
// F21: per-device, never synced. Each device's engine fires its own
// chime independently — receiving alarmFired=true from another device
// would suppress the local alarm, violating the strategy doc's
// Stage E per-device contract.
let alarmFired = false;
```

The comment lives at the field declaration; the existing in-line usages
are left untouched. The intent is to mark the field's contract at the
single point of truth, not to spray comments across every read/write.

### Test surface (in tests/sync-stamps.test.js)

The plan's test wording asks for: *"alarmFired = true from a synced state
still triggers chime locally on Device B (mock the alarm call site,
simulate state load with alarmFired: true, verify chime is called)."*

Interpretation: today's `checkFinished()` logic gates on `if (!alarmFired)`,
so an engine loaded with `alarmFired: true` will NOT re-fire the chime. That
is the *intended* behavior on the same device (don't double-fire on
foreground-resume), but it would be a F21 violation if a cross-device sync
ever delivered `alarmFired: true`.

Since engine state is excluded from sync, we can't directly test the
cross-device path. The test plan landed on a proxy: assert that **a fresh
engine started after a reset fires its own alarm exactly once**, regardless
of any prior `alarmFired: true` state on disk. This makes the per-device
contract testable inside the engine-test harness.

Proposed test shape (one per engine that owns the field):

```js
it('F21: alarmFired contract — fresh engine fires its own alarm', () => {
  const t = createTimer('f21-t', { allowOvershoot: false });
  // Simulate a prior state where alarmFired was already set (e.g. from
  // a stale load before reset, or a hypothetical cross-device leak).
  t.loadState({ alarmFired: true });
  let fires = 0;
  t.onAlarm(() => { fires++; });
  t.reset();
  t.setDuration(1000);
  t.start();
  // Fast-forward the engine to past zero.
  Object.assign(t, {});  // (real test uses time-mock pattern from timer.test.js)
  // ... assert fires === 1
});
```

Test cases will be wired against the existing time-mock pattern in
`tests/timer.test.js`. One regression test per engine that owns
`alarmFired` (timer, pomodoro, flow, interval). Four cases total.

---

## Files touched by the code commit

| File | Change |
|---|---|
| `js/meds.js` | Add `recomputeLastTakenAt()` method on `createMed()` factory; add `MedsManager.onMergeComplete(medId)` hook. |
| `js/pomodoro.js` | F6 stamping at three push sites (lines 125, 176, 256) + F21 comment marker at declaration (line 17). |
| `js/pomodoro-ui.js` | F6 stamping at one push site (line 1054, `gatherTimingData`). |
| `js/flow.js` | F21 comment marker at declaration (line 23). No logic change. |
| `js/interval.js` | F21 comment marker at declaration (line 16). No logic change. |
| `js/timer.js` | F21 comment marker at declaration (line 10). No logic change. |
| `tests/sync-stamps.test.js` | New file. F4 + F6 + F21 tests (see test surface sections above). |
| `tests/index.html` | Add `<script src="sync-stamps.test.js"></script>` after `meds.test.js`. |
| `docs/sync-impl/F7-AUDIT.md` | New file. Mirrors the F7 section of this audit verbatim per plan §A-1 file list. |

**No changes to:** `js/stopwatch.js`, `js/sequence.js`, `js/flow.js` logic
paths (only the F21 comment), `js/history.js`, `js/persistence.js`,
`js/interval.js` logic paths.

---

## Blast radius + risk

- **Synced field surface expansion:** four phaseLog push sites get two new
  fields each. F19b-compatible — older clients ignore them, newer clients
  use them for dedup. Risk: a malformed phaseLog entry could regress the
  Pomodoro-mode display (history-ui.js:248 reads `s.phaseLog`). Mitigation:
  the stamping is purely additive; existing fields untouched. Engine
  test pass + a manual smoke (start pomodoro, complete one cycle, view
  history row) catches any regression.
- **Dead-code commit (F4):** `recomputeLastTakenAt` and
  `MedsManager.onMergeComplete` are exposed on the public API but no caller
  invokes them until D-2 lands. Acceptable per the plan — intentional
  decoupling so D-2's PR can focus on reconcile logic. Tree-shaking is not
  a concern (no build step).
- **No persistence semantics change.** No new localStorage keys, no IDB
  schema bump, no migration.
- **No native build impact.** No Capacitor / iOS bundle change.

---

## Rollback

Revert the PR. F6 stamping is purely additive — downlevel readers ignore the
new fields. F4 helper has no callers in A-1, so deleting it leaves no
orphans. F7 / F21 are documentation + comment markers only.

---

## Next step

Stop here. Push this audit to the branch and wait for human review before
writing the code commit. The code commit (commit 2 of 2 on this branch)
implements the changes inventoried above, with no scope additions unless
the audit review flags one.
