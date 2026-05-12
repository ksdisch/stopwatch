# Tempo cloud-sync — implement PR D-2 (Stage D: steady-state doseLog reconcile + clock-skew clamp)

You're working on Tempo, a vanilla-JS PWA + Capacitor iOS app. The
cloud-sync implementation plan is at `docs/sync-impl/PLAN.md` on
`main`. Stage 0, Stage A close-out, Stage B (B-1 → B-3), Stage C (C-1),
and Stage D-1 (imported bucket + reconcile flow) are all shipped
(PRs #46–#63). D-2 is the **second and final Stage D PR** — engine-only,
no UI surface, no Phase 4 ui-wirer.

## Required reading (before any code)

1. `docs/sync-impl/PLAN.md` — find the `### D-2` section (around line
   308). That is your spec, with the spec-vs-test contradictions
   resolved below.
2. `docs/CLOUD-SYNC-STRATEGY.md` v2.0 — F1 (per-med ±N-min reconcile),
   F4 (re-derive `lastTakenAt` after merge), F15 (≥2-entry doseLog
   toast), F16 (±15-min clock-skew clamp on non-local entries).
3. `docs/sync-impl/audits/A-1-AUDIT.md` — A-1 introduced the dead-code
   helpers `MedsManager.recomputeLastTakenAt(med)` and
   `MedsManager.onMergeComplete(medId)`. D-2 makes these LIVE.
4. `docs/sync-impl/audits/D-1-AUDIT.md` — D-1 documented three
   implementer judgement calls D-2 inherits unchanged:
   - Meds collision re-keying via `originDeviceId`.
   - Reconcile uploads bypass B-3's cloud-empty guard.
   - `_mergeRestLog` cloud-wins.
5. `js/meds.js`:
   - Lines 19–28 + 217–248 — `KNOWN_MED_KEYS` / `__forward` pattern.
     D-2 does NOT add new keys to this set; `reconcileDoseLog` operates
     on the in-memory `doseLog` array, not on the record envelope.
   - The doseLog cap of 1000 entries (F14, PR #46) — reconcile must
     preserve the cap.
   - The clock-skew guard on `loadState` that already drops far-future
     `takenAt` values on load — D-2's F16 clamp is the cross-device
     analog at merge time.
   - `MedsManager.recomputeLastTakenAt(med)` (A-1 dead code) — D-2's
     reconcile path calls this after each merge.
   - `MedsManager.onMergeComplete(medId)` (A-1 dead code) — D-2 fires
     this per-med after reconcile completes.
6. `js/sync-engine.js`:
   - The C-1 `_hydrateWriteRaw` privileged-write pattern + D-1's
     `_reconcileWriteRaw` extension — D-2 does NOT introduce a new
     write-path; it operates on the in-memory snapshot before whichever
     caller (D-1 reconcile today; E-1 steady-state loop in the future)
     hands data to the existing write helpers. See TODO #2 below.
7. `js/schema.js` — invariant stamping helpers. D-2 does NOT change
   record envelopes (`deviceId` / `updatedAt` / `schemaVersion`); it
   only mutates the doseLog array.
8. `tests/meds.test.js` — canonical home for med-engine tests (38+
   cases from A-1). D-2 extends this file; do NOT create a new test
   file.

## What this PR ships

The steady-state per-med doseLog reconcile (F1) and cross-device
clock-skew clamp (F16) — pure engine logic with no UI. Today, D-1's
`reconcileImportedBucket` unions cloud and local meds records by
`(medId, originDeviceId)` but does NOT touch the per-record `doseLog`
arrays for matching meds. D-2 ships the helper that collapses
near-duplicate dose entries within those arrays, plus the safety clamp
for entries with clock-skewed timestamps from other devices.

### Engine (`js/meds.js`)

**New `MedsManager.reconcileDoseLog(med, incomingEntries)` (manager-level method, NOT on the factory):**

Signature:
```js
// Returns { entries, dropped, collapsed, warnings } where:
//   entries: sorted-by-takenAt-ascending doseLog after reconcile (length ≤ 1000)
//   dropped: count of F16-clamped entries dropped (number)
//   collapsed: count of F1 ±15-min duplicates collapsed (number)
//   warnings: Array<string> of structured warning messages for console.warn
reconcileDoseLog(med, incomingEntries)
```

Algorithm (in order):

1. **Union** `med.doseLog ∪ incomingEntries`.
2. **F16 clock-skew clamp** — iterate the union; for each entry where
   `entry.deviceId !== getDeviceId()`:
   - Compute `localNow = Date.now()` (captured ONCE at the top of the
     function — do not re-call inside the loop).
   - If `|entry.takenAt - localNow| > RECONCILE_WINDOW_MS` (15min),
     drop the entry, push a warning string, increment `dropped`.
   - Same-device entries (`entry.deviceId === getDeviceId()`) are
     NEVER clamped. The on-disk loadState clock-skew guard already
     handles same-device skew at load time.
3. **Dedup by `(deviceId, takenAt)`** — exact-match collapse. Keep
   the first occurrence in array order, drop subsequent duplicates.
   Don't increment `collapsed` for exact-match dedup — that's a
   separate counter (it's noise, not a reconcile decision).
4. **F1 cross-device ±15-min reconcile** — sort the deduped union by
   `takenAt` ascending. Walk in order; for each adjacent pair `(a, b)`
   where `b.takenAt - a.takenAt ≤ RECONCILE_WINDOW_MS`:
   - **If `a.deviceId === b.deviceId`:** preserve both (intentional
     re-doses on the same device — see TODO #1 resolution).
   - **If `a.deviceId !== b.deviceId`:** keep `a` (the earlier
     entry), drop `b`, increment `collapsed`.
   - Continue from `a` (don't advance past the kept entry) — handles
     the case where 3 cross-device entries are clustered within 15min.
5. **Enforce cap** — if `entries.length > 1000`, drop oldest until
   length === 1000 (F14 cap preserved post-reconcile).
6. **Return** the result. Caller is responsible for assigning the new
   `doseLog` onto the med record and persisting.

**New module-level constant:**
```js
const RECONCILE_WINDOW_MS = 15 * 60 * 1000; // F1 + F16 shared window
```
Exposed on `MedsManager.RECONCILE_WINDOW_MS` for tests.

**Wire `MedsManager.onMergeComplete(medId)` to fire `recomputeLastTakenAt`:**

A-1 shipped these two helpers as dead code. D-2 makes them live:
- `onMergeComplete(medId)` looks up the med by id, calls
  `recomputeLastTakenAt(med)` to set `med.lastTakenAt` from the last
  doseLog entry, persists via `saveState`, and emits an
  `onMergeComplete` event via the existing event dispatch (so E-1 +
  B-4 can wire the F15 toast in a future PR).
- Caller pattern: after `reconcileDoseLog` returns, the caller
  (SyncEngine) assigns the result onto the med, persists, then calls
  `MedsManager.onMergeComplete(medId)` exactly once per med.

### Engine (`js/sync-engine.js`)

**No call-site wire-up in D-2.** Per TODO #2 resolution: D-2 ships
`reconcileDoseLog` as a callable helper. E-1's steady-state merge loop
will call it. D-1's `reconcileImportedBucket` does NOT retrofit a call
in D-2 (documented in audit; E-1 owns the retrofit).

**One exception:** add a NO-OP placeholder comment block in
`sync-engine.js` near the existing meds-merge path inside
`reconcileImportedBucket` indicating where E-1 will plug in the
`MedsManager.reconcileDoseLog` call. The comment is the seam — no
behavior change.

### Tests (extend `tests/meds.test.js`)

Append a new `describe('reconcileDoseLog')` block to the existing
`tests/meds.test.js`. Do NOT create `tests/sync-reconcile.test.js` or
similar — meds tests live in `tests/meds.test.js` (canonical home,
already 38+ cases from A-1). The new test cases:

1. **Dedup by `(deviceId, takenAt)`** — exact match collapses to a
   single entry. Two identical incoming entries → output length 1.
2. **F1 cross-device collapse** — `a.deviceId === 'A'`,
   `b.deviceId === 'B'`, `|takenAt diff| < 15min` → output keeps `a`,
   drops `b`, `result.collapsed === 1`.
3. **F1 same-device preserve** — two same-device entries 10min apart
   → output preserves both, `result.collapsed === 0`. (TODO #1
   resolution: same-device duplicates are intentional re-doses.)
4. **F16 clamp drops far-future cross-device entry** —
   `entry.deviceId !== localDeviceId`, `entry.takenAt > localNow + 15min`
   → dropped, `result.dropped === 1`, `result.warnings.length === 1`.
5. **F16 clamp drops far-past cross-device entry** — symmetric to (4)
   for `takenAt < localNow - 15min`.
6. **F16 does NOT clamp same-deviceId entries** — local entry far in
   the future (synthetic test) → preserved. Cross-device clamp is the
   policy; same-device is the loadState guard's responsibility.
7. **F1 + F16 boundary edge case** — entry exactly at
   `localNow + RECONCILE_WINDOW_MS` (boundary) → see TODO #4 resolution
   (inclusive: kept). Same for F1 window: pairs exactly 15min apart
   collapse (per TODO #4).
8. **`recomputeLastTakenAt` re-derives correctly** — after reconcile
   collapses two entries, `med.lastTakenAt` reflects the surviving
   entry's `takenAt`. Empty doseLog → `med.lastTakenAt === null`.
9. **Empty incoming entries → no-op** — `incomingEntries = []`,
   `med.doseLog` unchanged, `dropped === 0`, `collapsed === 0`.
10. **Idempotent** — running `reconcileDoseLog` twice on the same
    input produces the same output (`result1.entries` deep-equals
    `result2.entries`).
11. **Cap enforcement** — synthetic doseLog with 1500 entries →
    output length === 1000, oldest entries dropped.
12. **`onMergeComplete(medId)` fires per-med** — mock the event
    dispatcher; call `onMergeComplete('med-id-1')`; assert the event
    fired once with `{ medId: 'med-id-1' }`.
13. **Three-cluster cross-device collapse** — A@t=0, B@t=5min,
    A@t=10min (all within 15min) — depending on TODO #1 resolution:
    if same-device preserves, output keeps A@t=0, A@t=10min, collapses
    B@t=5min into A@t=0. If a different rule applies, document.

Sanity: total test count should grow by ~13 cases. Baseline before D-2
is **381** (358 C-1 + 23 D-1). Target after D-2: **~394**.

### Wire-up — Phase 4 ui-wirer SKIPPED

D-2 ships zero UI changes. The audit's affected-files table will list
ONLY `js/meds.js`, `js/sync-engine.js` (comment-only), and
`tests/meds.test.js`. Per the orchestrator-prompt autonomous
transition rule: "Phase 3 → Phase 5 if all tests pass AND audit lists
NO UI files (skip ui-wirer entirely)."

## Hard rules

- **Audit before code.** First commit on the branch is
  `docs/sync-impl/audits/D-2-AUDIT.md` listing affected files +
  risks + test scope. STOP after the audit and wait for review.
- **Engine-only.** No DOM, no CSS, no UI files. No new persistence
  keys, no new localStorage flags, no new IDB stores.
- **Reuse existing helpers.** `getDeviceId()` from `js/history.js` is
  the source of `localDeviceId`. `Schema.isFutureRecord` (F19a) is the
  refuse-writeback gate — if the med record itself is future-schema,
  reconcile MUST skip it (don't mutate future records).
- **No record-envelope changes.** `reconcileDoseLog` mutates the
  doseLog array only; the med record's `deviceId` / `updatedAt` /
  `schemaVersion` are touched by the existing `saveState` path, not by
  reconcile.
- **F13 write gate.** D-2 is called from within the existing
  `SyncState.set('hydrating')` window of the caller (D-1's reconcile
  today, E-1's merge loop in the future). D-2 itself does NOT toggle
  SyncState — that's the caller's job.
- **F14 cap preserved.** Post-reconcile doseLog length ≤ 1000.
- **F19a refuse-writeback preserved.** If `Schema.isFutureRecord(med)`
  is true, `reconcileDoseLog` returns the original `med.doseLog`
  unchanged with `dropped: 0, collapsed: 0, warnings: ['skipped:
  future-schema record']`. Don't throw — log and skip.
- **Service worker cache bump.** `sw.js` `CACHE_NAME` gets bumped
  in the same PR per repo rule (pr-shipper handles).
- **Web GitHub Pages deploy stays byte-equivalent** except for the
  intentional changes.

## IMPORTANT: D-1 (PR #63) must be merged to `main` before D-2 fires

D-1 introduces:
- `reconcileImportedBucket()` in `sync-engine.js` — D-2's eventual
  call-site seam lives inside this function (D-2 ships the
  no-op-comment-only seam; E-1 wires the actual call).
- `originDeviceId` in `KNOWN_MED_KEYS` — D-2 relies on this stamping
  being live so the meds-collision-re-keying invariant holds.
- The 358 → 381 test baseline.

D-1 is shipped (commit `4f0203e` on `main`). Branch D-2 off
freshly-merged `main`.

## Known structural test-harness gap (FROM D-1)

D-1's engine-tester surfaced a `tests/index.html` script-load gap
where loading `js/history.js` clashes with the `typeof History ===
'undefined'` fall-through pattern that ~22 pre-existing sync tests
rely on. This gap blocked 7 audit-listed History-coupled cases in
D-1. The header at `tests/sync-imported-bucket.test.js` lines 14–22
documents the gap.

**D-2 is unaffected** because:
- D-2 is engine-only on `js/meds.js` + `js/sync-engine.js` — no
  `history.js` coupling.
- `meds.js` is already loaded by `tests/index.html`;
  `tests/meds.test.js` already exists and works.
- D-2 doesn't need to test `History.*` APIs.

The harness refactor is queued for **E-1** (which DOES touch History
via its sessions-append-merge path). Document this in D-2's audit +
SESSION-LOG entry; do not refactor in D-2.

## Resolved decisions (Kyle accepted all defaults 2026-05-12)

These six decisions were flagged as open TODOs during brief draft;
Kyle accepted the default resolution for all six. They are now spec.

### Decision #1 — Same-deviceId ±15min duplicates: PRESERVE

Cross-device collapse covers the "I logged it on my phone, then again
on my laptop without realizing" case the v2.0 strategy doc was written
for. Same-device duplicates are explicitly intentional — the user
tapped "Took it now" twice on the same device with full knowledge.
Algorithm step 4 encodes this: when `a.deviceId === b.deviceId` for
adjacent entries within `RECONCILE_WINDOW_MS`, both are preserved.

### Decision #2 — Call-sites: D-2 ships helper only

D-2 commits a no-op comment seam inside `reconcileImportedBucket` in
`js/sync-engine.js` where E-1 will plug in the call. D-1's reconcile
flow is NOT retrofitted in D-2. Rationale: D-1 already shipped without
reconcile in the meds-merge path; retrofitting in D-2 expands blast
radius into the D-1 reconcile flow and would require new integration
tests. E-1 is the natural home for both call-site wire-ups (it's
already going to be the largest audit in the rollout).

### Decision #3 — Error handling: skip failing entry, continue

Inside `reconcileDoseLog`, wrap each entry's clamp/dedup logic in a
try/catch; on per-entry failure, push a warning string and drop the
entry from the result. Return normally with `warnings` populated. The
caller (SyncEngine) reads `result.warnings` and surfaces non-blocking
console output. A single bad entry must NOT abort the merge cycle or
flip `SyncState` to `'error'`.

### Decision #4 — ±15min window: INCLUSIVE at boundary

Use `<= RECONCILE_WINDOW_MS` in the F1 collapse check and `|delta| <=
RECONCILE_WINDOW_MS` in the F16 clamp check. User mental model is
"doses within 15 minutes" — they don't distinguish 14:59 from 15:00.
Test #7 asserts this boundary explicitly.

### Decision #5 — F1 + F16 share one constant

`RECONCILE_WINDOW_MS = 15 * 60 * 1000` exposed on
`MedsManager.RECONCILE_WINDOW_MS`. Tying F1 + F16 to the same window
keeps the algorithm coherent: if cross-device clock skew is bounded at
15min, then cross-device dose-spacing of ≤15min is the case to
collapse. Decoupling them would create two knobs with overlapping
semantics.

### Decision #6 — Warning log: console-only, batched per cycle

Console-only, structured string. Per-entry format:
```
[MedsManager.reconcileDoseLog] dropped entry takenAt=<ms> deviceId=<id> reason=<f16-future|f16-past|future-schema> localNow=<ms>
```
No user-visible toast — F15 (the ≥2-entry remote arrival toast) is the
only doseLog user-surface; F16 clamps are diagnostic, not actionable.
The caller collects `result.warnings` into a single batched
`console.warn` after each merge cycle (one warn per cycle, not per
entry — keeps DevTools readable).

## Deliverable

Branch `feat/sync-stage-d-reconcile`, PR against `main`. Commits:

1. `docs(sync-impl): D-2 audit + reconcile-doseLog spec` — audit
   doc with affected-files table + risks + test scope. STOP HERE.
2. After greenlight: `feat(sync): per-med doseLog reconcile +
   clock-skew clamp (D-2)` — engine + tests in one commit.

PR title once both commits land:
`feat(sync): Stage D doseLog reconcile + clock-skew clamp (D-2)`.

## Manual verification (after merge — pre-E-1 smoke)

D-2 is engine-only; manual verification is limited to running the
tests in a browser. No UI surface to exercise.

1. Open `tests/index.html?fresh=verify` in a real browser. Confirm
   total test count is ~394 (381 baseline + ~13 D-2 cases).
2. Confirm the new `describe('reconcileDoseLog')` block runs and all
   cases pass.
3. Confirm the existing 381 cases still pass (no regressions).
4. Optional: add a temporary one-off scratch test that constructs a
   med with mixed local+remote dose entries spanning the F1 / F16
   windows; verify by hand that the output matches the algorithm.
   Remove the scratch before commit.

## After D-2

D-2 ships the per-med reconcile helper. Stage D is complete. The
remaining sync work is Stage E:

- **E-1** (largest single PR of the rollout): steady-state push/pull
  merge loop. Wires D-2's `reconcileDoseLog` into the meds merge path.
  Decides F3 (BFRB stream choice) and F8 (distraction tombstones vs
  sessionId-keyed). Owns the `tests/index.html` script-load harness
  refactor queued from D-1.
- **E-2**: offline buffer (pending-op queue with `originalWallClock`
  preservation).
- **E-3**: real-time `onSnapshot` listeners + refuse-writeback toast.

After Stage E, the rollout is feature-complete; F-1 (manifest registry)
stays deferred.
