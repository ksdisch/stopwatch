# D-2 · Stage D steady-state doseLog reconcile + clock-skew clamp

**PR:** `feat/sync-stage-d-reconcile` → `main`
**Stacked on:** `main` after D-1 (PR #63) merges. Branch D-2 off the
freshly-merged commit so the no-op comment seam lands in D-1's just-shipped
`reconcileImportedBucket()` body without rebase pain.
**Scope:** Ship the per-med `MedsManager.reconcileDoseLog(med, incomingEntries)`
helper (F1 collapse + F16 clock-skew clamp) and wire the A-1-shipped
`onMergeComplete(medId)` hook to fire `recomputeLastTakenAt` per-med. Engine-only.
Zero UI changes. No new call sites — D-1's reconcile flow is NOT retrofitted in
D-2; only a no-op comment seam lands in `js/sync-engine.js` to mark where E-1
will plug in the call.

D-2 is the **final Stage D PR**. After D-2 ships, Stage E (E-1 merge loop →
E-2 offline buffer → E-3 listeners) is the remaining sync work.

---

## Goal

Add `MedsManager.reconcileDoseLog(med, incomingEntries)` — a pure helper that
unions local + incoming doseLog entries, clamps non-local entries to the
`localNow ± 15 min` window (F16), collapses cross-device near-duplicates within
the same 15-min window (F1, preserving same-device entries per Decision #1),
deduplicates by `(deviceId, takenAt)`, and enforces the F14 1000-entry cap.
Make the A-1 dead-code helpers `MedsManager.recomputeLastTakenAt(med)` and
`MedsManager.onMergeComplete(medId)` live by wiring `onMergeComplete` to fire
`recomputeLastTakenAt` + emit an `onMergeComplete` event. Add ~13 cases to
`tests/meds.test.js` covering the algorithm + idempotency + cap + future-schema
skip. The audit's affected-files table lists **no UI files**, which routes the
orchestrator's autonomous Phase 3 → Phase 5 transition (skip ui-wirer).

---

## Affected files

| Path | Change type | Notes |
|------|-------------|-------|
| `js/meds.js` | **modify** | (1) Add module-level constant `const RECONCILE_WINDOW_MS = 15 * 60 * 1000;` near the top of the file (alongside `MED_FREQUENCIES` and `KNOWN_MED_KEYS`). Expose on `MedsManager.RECONCILE_WINDOW_MS` for tests. (2) Add `MedsManager.reconcileDoseLog(med, incomingEntries)` — manager-level method (NOT on the factory) per D-2 brief. Returns `{ entries, dropped, collapsed, warnings }`. Algorithm (in order): F19a refuse-writeback gate (if `Schema.isFutureRecord(med)` → return `{ entries: med.doseLog, dropped: 0, collapsed: 0, warnings: ['skipped: future-schema record'] }`); union `med.doseLog ∪ incomingEntries`; capture `localNow = Date.now()` ONCE at top; F16 clamp non-local entries outside `localNow ± RECONCILE_WINDOW_MS` (inclusive, per Decision #4); dedup by `(deviceId, takenAt)` exact-match (kept in array order, not counted as `collapsed`); sort ascending by `takenAt`; F1 walk: for each adjacent pair where `b.takenAt - a.takenAt <= RECONCILE_WINDOW_MS`, if `a.deviceId === b.deviceId` PRESERVE both (Decision #1), else keep `a` + drop `b` + increment `collapsed`, continue from `a` (handles 3-entry cross-device clusters); F14 cap enforcement (if `entries.length > 1000`, drop oldest until 1000). Per-entry try/catch with warnings push on failure (Decision #3 — no merge-cycle abort). NO mutation of the record envelope (`deviceId` / `updatedAt` / `schemaVersion`) — those are touched by `saveState`. Caller is responsible for assigning the result onto `med.doseLog` and calling `saveState`. (3) Wire the A-1 dead-code `MedsManager.onMergeComplete(medId)` hook so it (a) looks up the med by id, (b) calls `recomputeLastTakenAt(med)` to set `med.lastTakenAt` from the doseLog tail per F4, (c) persists via `saveState`, (d) emits an `onMergeComplete` event via the existing event dispatch (E-1 + B-4 will subscribe for the F15 toast). A-1 already audited the existence of both helpers (`A-1-AUDIT.md` §F4) — D-2 does not re-audit; it only makes them live. (4) Uses `_medsGetDeviceId()` (line 52, already present) as the source of `localDeviceId` so the F16 clamp comparison `entry.deviceId !== localDeviceId` works without a `History` dependency. No new keys added to `KNOWN_MED_KEYS` — `reconcileDoseLog` operates on the in-memory `doseLog` array, not on record-envelope fields. |
| `js/sync-engine.js` | **modify (comment-only)** | Add a NO-OP placeholder comment block inside `reconcileImportedBucket()` near the existing `_mergeMeds(localRecords, cloudRecords, localDeviceId)` call site (line 968) and the meds-merge path (around lines 880–885 and 1159–1181). The comment is the seam — no behavior change. Per Decision #2, D-1's reconcile flow is NOT retrofitted with the actual call in D-2; E-1's steady-state merge loop owns the wire-up at both sites (D-1 reconcile + E-1 steady-state). The comment template: `// E-1 plug-in seam: after _mergeMeds() unions cloud ∪ local records by (medId, originDeviceId), iterate each merged med and call MedsManager.reconcileDoseLog(med, incomingEntries) to collapse cross-device ±15-min duplicates and clamp clock-skewed entries. Then assign result.entries onto med.doseLog and call MedsManager.onMergeComplete(medId) once per med. F1 + F16 are not enforced in D-1's reconcile path — D-2 ships the helper only; E-1 wires both call sites.` |
| `tests/meds.test.js` | **modify** | Extend the existing file (canonical home for med-engine tests — already 38+ cases from A-1; do NOT create a new test file). Append a `describe('reconcileDoseLog')` block with ~13 new cases enumerated in the Test scope section below. Baseline test count before D-2 is **381** (358 C-1 + 23 D-1). Target after D-2: **~394**. |

**Total: 3 files** (2 engine modify, 1 test modify). **No UI files. No CSS. No
`index.html`. No `sw.js` cache bump from D-2 itself — pr-shipper will still bump
`CACHE_NAME` because cached web files change (`js/meds.js`, `js/sync-engine.js`)
per repo cache-bump rule. No `docs/SESSION-LOG.md` / `docs/sync-impl/PLAN.md`
edits in the engine commit — pr-shipper owns those.**

---

## Sync invariants touched

| F# | Description | Status in D-2 |
|----|-------------|---------------|
| F1 | Per-med ±15-min doseLog reconcile | **NEW — implemented here.** The F1 walk in `reconcileDoseLog` is the load-bearing invariant for D-2. Algorithm step 4: sort union ascending by `takenAt`; for each adjacent pair `(a, b)` where `b.takenAt - a.takenAt <= RECONCILE_WINDOW_MS`, if `a.deviceId === b.deviceId` preserve both (Decision #1 — intentional same-device re-doses), else keep `a` + drop `b` + increment `collapsed`. Continue from `a` (not `b`) so three cross-device entries clustered within 15min collapse correctly. Decision #4 makes the boundary inclusive (`<=`). |
| F4 | Re-derive `lastTakenAt` from doseLog tail after merge | **Wired live here.** A-1 shipped `med.recomputeLastTakenAt()` and `MedsManager.onMergeComplete(medId)` as dead code (`A-1-AUDIT.md` lines 41–92). D-2 makes them live: `onMergeComplete(medId)` calls `recomputeLastTakenAt(med)` to set `med.lastTakenAt` from `doseLog[tail].takenAt` (or `null` for empty doseLog), persists via `saveState`, and emits an `onMergeComplete` event. |
| F14 | doseLog 1000-entry cap | **Preserved post-reconcile.** Algorithm step 5: if `entries.length > 1000`, drop oldest until length === 1000. Cap test (Test #11) verifies a synthetic 1500-entry input produces a 1000-entry output with oldest entries dropped. |
| F15 | ≥2-entry remote-arrival toast | **Hook only — toast ships in E-1/B-4.** D-2 wires the `onMergeComplete(medId)` event-emit so E-1's steady-state merge loop + B-4's UI subscriber can fire the toast when ≥2 remote entries arrive in a single merge cycle. D-2 itself does NOT ship the toast — that's E-1's call-site to count remote arrivals and B-4's UI to render. |
| F16 | ±15-min cross-device clock-skew clamp | **NEW — implemented here.** Algorithm step 2: for each entry where `entry.deviceId !== localDeviceId`, if `|entry.takenAt - localNow| > RECONCILE_WINDOW_MS`, drop the entry, push a structured warning string, increment `dropped`. Same-device entries (`entry.deviceId === localDeviceId`) are NEVER clamped — the on-disk `loadState` clock-skew guard at `js/meds.js` is the same-device analog at load time. Decision #4 makes the boundary inclusive (`|delta| <= RECONCILE_WINDOW_MS`). Decision #5 ties F1 + F16 to one shared constant. |
| F19a | `schemaVersion` refuse-writeback gate | **Skip-path enforced.** If `Schema.isFutureRecord(med)` returns true, `reconcileDoseLog` returns immediately with `{ entries: med.doseLog, dropped: 0, collapsed: 0, warnings: ['skipped: future-schema record'] }`. Do NOT throw — log and skip per Decision #3. Without this gate, D-2 could silently mutate a `schemaVersion: 2` record's doseLog on a downlevel client. Test #5/#6/equivalent covers. |

D-2 does NOT touch F2 (sessionID uniqueness — history-side), F3 (BFRB stream
choice — E-1), F6 (phaseLog stamping — A-1 + passes through), F7 (loadState
recovery — passes through), F8 (distraction tombstones — E-1), F9 (read-cloud
guard — B-3), F10 (deviceId/updatedAt stamping — passes through; D-2 doesn't
touch record envelope), F12 (mandatory local backup — B-3), F13 (write gate —
caller responsibility; D-2 itself doesn't toggle SyncState — D-1's reconcile or
E-1's merge loop hold the gate at `'hydrating'`), F17 (imported bucket — D-1),
F18 (per-record meds persistence — passes through), F19b (`__forward`
passthrough — passes through; no new envelope fields), F19c (manifest registry
— deferred), F20 (frequency enum forward-compat — passes through), F21
(`alarmFired` per-device — N/A, no engine state).

---

## Risks

| Risk | Likelihood | Blast radius | Mitigation |
|------|------------|--------------|------------|
| **Per-record doseLog mutation corruption** | low | **data-loss (HIGH)** | `reconcileDoseLog` is the most-used MedsManager path once E-1 wires it. A bug here silently corrupts dose history (the user's primary use case — "did I take my Adderall?"). **Mitigation:** D-2 ships the helper as **pure** (returns a new array; caller assigns onto `med.doseLog`). No mutation of the input `med.doseLog`. Per-entry try/catch (Decision #3) prevents a single bad entry from aborting the merge. Comprehensive idempotency test (Test #10) — running reconcile twice on the same input deep-equals. Cap-enforcement test (Test #11). Empty-input no-op test (Test #9). Algorithm correctness tests for each rule in isolation (Tests #1–#6). **Manual smoke required:** after D-2 merge and before E-1, exercise the helper via a temporary scratch fixture (a med with mixed local+remote dose entries spanning F1/F16 windows) and verify output by hand before discarding the scratch. |
| **F14 cap drift — post-reconcile doseLog exceeds 1000** | low | **data-loss (silent)** | If algorithm step 5 is omitted or off-by-one, the doseLog could grow unbounded on a high-frequency med (rare but possible for an as-needed med with frequent cross-device re-logs). Above 1000, the existing append-merge guards in `logDose()` would start dropping new entries, but the cap-overflow path is silent. **Mitigation:** Test #11 enforces a 1500-entry synthetic input produces exactly 1000 output entries, with the **oldest** entries dropped (not newest — the F14 contract preserves recent dose history). Algorithm step 5 is explicit in the brief and audit. |
| **Same-device-vs-cross-device collapse rule confusion** | med | **data-correctness (med)** | The wrong rule = the wrong daily-dose count. Decision #1 explicitly preserves same-device entries within 15min (intentional re-doses on the same device — the user tapped "Took it now" twice with full knowledge) and collapses cross-device entries (the v2.0 strategy's "I logged it on phone, then again on laptop" case). Mis-applying the rule (e.g. collapsing same-device duplicates) would silently undercount intentional re-doses — bad for medication adherence tracking. **Mitigation:** Test #3 (same-device PRESERVE, two entries 10min apart → output keeps both, `collapsed === 0`) and Test #2 (cross-device COLLAPSE, A@t=0 + B@t=5min → output keeps A, `collapsed === 1`) explicitly assert the boundary. Test #13 (three-cluster cross-device: A@t=0, B@t=5min, A@t=10min) verifies the continue-from-`a` walking rule on mixed clusters. |
| **F19a future-schema records silently corrupted by reconcile** | low | **data-correctness (data-loss-adjacent)** | If a downlevel D-2 client runs against a record with `schemaVersion > 1`, mutating its doseLog (even via collapse/clamp) would corrupt a future-schema record the downlevel client doesn't fully understand. **Mitigation:** F19a refuse-writeback gate at the top of `reconcileDoseLog` — if `Schema.isFutureRecord(med)` is true, return the original `med.doseLog` unchanged with `warnings: ['skipped: future-schema record']`. Do NOT throw. Test #5 (or equivalent — implementer's choice on numbering) inserts a `schemaVersion: 999` med, runs reconcile, asserts (a) `med.doseLog` is byte-identical to input, (b) `result.dropped === 0`, (c) `result.collapsed === 0`, (d) `result.warnings.length === 1` with `'future-schema'` substring. |
| **F13 write gate violated by D-2 itself** | low | data-correctness | D-2 is called from within the caller's `SyncState.set('hydrating')` window (D-1's reconcile today; E-1's merge loop in the future). D-2 itself does NOT toggle `SyncState`. **Mitigation:** Already enforced by D-1's reconcile path — `reconcileImportedBucket()` sets `'hydrating'` before any meds work. E-1 will do the same. `reconcileDoseLog` is pure (returns a new array) — it does not call `saveState` itself, so the F13 gate is not material to `reconcileDoseLog`'s correctness. The caller's `saveState` (post-`onMergeComplete`) is what touches disk, and the caller owns the gate. Audit + brief both flag this contract; no per-entry assertion needed in tests. |
| **`onMergeComplete` event listener leak across merge cycles** | low | low (memory) | If E-1 subscribes via `MedsManager.on('onMergeComplete', …)` and doesn't unsubscribe between merge cycles, listener counts could grow unbounded. **Mitigation:** D-2's `onMergeComplete` emit is a single per-med call within a merge cycle — listener accumulation is E-1's call-site concern, not D-2's. The brief defers this to E-1. Test #12 mocks the event dispatcher and asserts the event fired exactly once per `onMergeComplete(medId)` call — not for repeat-subscription correctness. |
| **`tests/index.html` script-load harness gap (inherited from D-1)** | low | low (test-only) | D-1's engine-tester surfaced a script-load gap where ~22 sync tests rely on `typeof History === 'undefined'` fall-through. **D-2 unaffected** — D-2 is engine-only on `js/meds.js` + `js/sync-engine.js`; `meds.js` is already loaded by `tests/index.html`; `tests/meds.test.js` already exists and works; D-2 doesn't touch `history.js` or its test surface. The harness refactor is queued for E-1 (which DOES touch History via its sessions-append-merge path). **Mitigation:** None needed in D-2 — document in audit risks for traceability. |
| **Boundary off-by-one (inclusive vs exclusive)** | low | data-correctness | Decision #4 specifies inclusive at `RECONCILE_WINDOW_MS` boundary (`<=` not `<`). User mental model is "doses within 15 minutes" — they don't distinguish 14:59 from 15:00. An exclusive boundary would silently fail to collapse pairs exactly 15 minutes apart, leaving a cross-device duplicate the user expected merged. **Mitigation:** Test #7 (boundary edge case — pairs exactly `RECONCILE_WINDOW_MS` apart collapse on cross-device, preserve on same-device; F16 clamp at exact `localNow + RECONCILE_WINDOW_MS` is kept). |

**Risk count: 8** — low: 7, med: 1, high: 0. The highest single-event impact is
Risk #1 (per-record doseLog mutation corruption), mitigated by purity (helper
returns a new array, doesn't mutate input) + comprehensive idempotency test +
per-entry try/catch. Risk #3 (same-device-vs-cross-device collapse rule) is the
most user-visible — wrong rule produces wrong dose counts — mitigated by
explicit tests for both branches.

---

## Test scope

### New tests required: extend `tests/meds.test.js`

Append a new `describe('reconcileDoseLog')` block with ~13 cases. Baseline
before D-2 is **381**. Target after D-2: **~394**.

1. **Dedup by `(deviceId, takenAt)`** — exact-match collapses to a single
   entry. Two identical incoming entries with the same `deviceId` + `takenAt`
   → output length 1. Don't increment `collapsed` for exact-match dedup
   (it's noise, not a reconcile decision per brief algorithm step 3).

2. **F1 cross-device collapse** — `a.deviceId === 'A'`, `b.deviceId === 'B'`,
   `|takenAt diff| < 15min` → output keeps `a` (the earlier entry), drops
   `b`, `result.collapsed === 1`, `result.dropped === 0`.

3. **F1 same-device preserve** — two same-device entries 10min apart → output
   preserves both, `result.collapsed === 0`. Decision #1 — same-device
   duplicates are intentional re-doses.

4. **F16 clamp drops far-future cross-device entry** — `entry.deviceId !==
   localDeviceId`, `entry.takenAt > localNow + 15min` → dropped,
   `result.dropped === 1`, `result.warnings.length === 1` with `'f16-future'`
   or equivalent reason marker in the warning string per Decision #6 format.

5. **F16 clamp drops far-past cross-device entry** — symmetric to #4 for
   `takenAt < localNow - 15min` (e.g., a remote device with a clock 20min
   behind). Same drop + warning behavior.

6. **F16 does NOT clamp same-deviceId entries** — local entry far in the
   future (synthetic test) → preserved. Cross-device clamp is the policy;
   same-device far-future entries are handled by `loadState`'s clock-skew
   guard at load time, not by `reconcileDoseLog`.

7. **F1 + F16 boundary edge case (inclusive)** — entry exactly at
   `localNow + RECONCILE_WINDOW_MS` (boundary) → kept (Decision #4
   inclusive). Pairs exactly 15min apart collapse cross-device + preserve
   same-device.

8. **`recomputeLastTakenAt` re-derives correctly** — after reconcile collapses
   two entries, calling `MedsManager.onMergeComplete(medId)` causes the
   med's `lastTakenAt` to reflect the surviving (tail) entry's `takenAt`.
   For an empty doseLog post-reconcile, `med.lastTakenAt === null`.

9. **Empty incoming entries → no-op** — `incomingEntries = []`, `med.doseLog`
   unchanged in shape, `result.entries` deep-equals the original `med.doseLog`,
   `dropped === 0`, `collapsed === 0`.

10. **Idempotent** — running `reconcileDoseLog` twice on the same input
    produces the same output (`result1.entries` deep-equals
    `result2.entries`). Critical mitigation for Risk #1.

11. **Cap enforcement (F14)** — synthetic doseLog with 1500 entries →
    output length === 1000, oldest entries dropped (assert
    `output[0].takenAt > input[0].takenAt`).

12. **`onMergeComplete(medId)` fires per-med** — mock the event dispatcher;
    call `MedsManager.onMergeComplete('med-id-1')`; assert the event fired
    once with `{ medId: 'med-id-1' }` payload. Also assert
    `recomputeLastTakenAt` was called once on the looked-up med.

13. **Three-cluster cross-device collapse (Decision #1 + walk rule)** —
    A@t=0, B@t=5min, A@t=10min (all within 15min). Decision #1 preserves
    same-device entries; the cross-device collapse walks continue-from-`a`.
    Expected output: A@t=0, A@t=10min (B@t=5min collapsed into A@t=0),
    `collapsed === 1`. Verifies the brief's continue-from-`a` walking
    rule handles mixed same/cross-device clusters.

### F19a future-schema skip case

In addition to the 13 cases above, include a future-schema record skip case
(may be numbered as #5b, #14, or merged into the structure — engine-tester's
call): insert a med with `schemaVersion: 999` (synthetic via direct
`MedsManager._reconcileWriteRaw` write or a test-only `__forwardBag` fixture);
call `reconcileDoseLog(med, [validIncomingEntry])`; assert (a) `result.entries`
is byte-identical to `med.doseLog`, (b) `result.dropped === 0`, (c)
`result.collapsed === 0`, (d) `result.warnings.length === 1` with
`'future-schema'` substring. This is the F19a refuse-writeback gate enforcer.

### Existing tests at risk

**None.** D-2 adds a new method (`MedsManager.reconcileDoseLog`) and wires
two A-1 dead-code helpers (`recomputeLastTakenAt` + `onMergeComplete`) to a
new event emit. No existing method signature changes; no existing logic
changes in `loadDose` / `logDose` / `undoLastDose` / `saveState` / `loadAll`.
The A-1 dead-code helpers were exposed on the public API in A-1 with no
callers — D-2 adds the first call path inside `onMergeComplete` itself,
which is also dead-code-callable until E-1. The full 38+ A-1 meds tests should
pass byte-identically.

If `tests/meds.test.js`'s top-level `before` / `beforeEach` hook does any
fixture-state setup that touches doseLog tails, verify that adding the new
`describe('reconcileDoseLog')` block does NOT introduce cross-test pollution
(e.g., the new tests should set up their own fixture meds, not share a
top-level fixture).

---

## Manual setup steps (if any)

**None.** D-2 is engine-only:

- No Firebase console action (no new collections, no rule changes).
- No Capacitor / iOS rebuild (no `Platform.*` surface touched).
- No new localStorage keys or IDB stores.
- No new persistence flags or migration logic.
- No service worker pre-deployment action (pr-shipper bumps `CACHE_NAME` in
  the same PR per repo rule — cached web files DO change because
  `js/meds.js` + `js/sync-engine.js` are cached web files).

Manual verification after merge (pre-E-1 smoke) is limited to running the
tests in a real browser per the project's no-Node-runner convention:

1. `python3 -m http.server 8765 &` from repo root.
2. Open `http://localhost:8765/tests/index.html?fresh=verify` in any browser.
3. Confirm the new `describe('reconcileDoseLog')` block runs and all ~13
   cases pass; confirm total test count is ~394 (381 baseline + ~13 D-2).
4. Confirm the existing 381 cases still pass (no regressions).
5. `pkill -f "python3 -m http.server 8765"`.

---

## Out of scope (explicitly NOT in this PR)

- **D-1 reconcile call-site retrofit.** Per Decision #2, D-1's
  `reconcileImportedBucket()` does NOT plug in `MedsManager.reconcileDoseLog`
  in D-2. D-2 ships only the no-op comment seam inside D-1's meds-merge path.
  E-1 owns the retrofit at both sites (D-1 reconcile + E-1 steady-state).
  Rationale: D-1 already shipped without reconcile in its meds-merge path;
  retrofitting in D-2 expands blast radius into the D-1 flow and would
  require new integration tests outside the engine-only contract.

- **Phase 4 ui-wirer SKIPPED.** The audit's affected-files table lists NO UI
  files (`js/*-ui.js`, `index.html`, `css/*.css`, `js/tempo-nav.js`). Per the
  orchestrator-prompt autonomous transition rule: "Phase 3 → Phase 5 if all
  tests pass AND audit lists NO UI files (skip ui-wirer entirely)." D-2
  ships zero user-visible bytes.

- **F15 ≥2-entry remote-arrival toast.** D-2 wires the `onMergeComplete`
  event emit (the hook surface) but does NOT ship the toast UI. E-1's
  steady-state merge loop counts remote arrivals per merge cycle and fires
  the toast via B-4's subscriber. D-2 is the hook publisher; B-4 + E-1 are
  the subscribers.

- **`tests/index.html` script-load harness refactor.** Inherited gap from
  D-1 (`tests/sync-imported-bucket.test.js` lines 14–22 documents the
  `typeof History === 'undefined'` fall-through pattern that blocks ~22
  sync tests when `history.js` is loaded in the test page). D-2 is
  unaffected because D-2 doesn't touch `history.js` or its test surface.
  Refactor is queued for E-1, which DOES touch History via its
  sessions-append-merge path.

- **E-1 steady-state merge loop.** The remaining sync work after D-2 is:
  - **E-1**: steady-state push/pull merge loop (largest single PR of the
    rollout). Wires D-2's `reconcileDoseLog` into the meds-merge path AND
    retrofits the D-1 reconcile flow. Decides F3 (BFRB stream choice) and
    F8 (distraction tombstones vs sessionId-keyed). Owns the
    `tests/index.html` harness refactor.
  - **E-2**: offline buffer (pending-op queue with `originalWallClock`
    preservation).
  - **E-3**: real-time `onSnapshot` listeners + refuse-writeback toast.
  After Stage E ships, the cloud-sync rollout is feature-complete; F19c
  manifest registry stays deferred.

- **D-1 inherited implementer judgement calls (unchanged in D-2).** D-1
  documented three judgement calls in its audit (D-1-AUDIT.md): (a) meds
  collision re-keying via `originDeviceId`, (b) reconcile uploads bypass
  B-3's cloud-empty guard, (c) `_mergeRestLog` cloud-wins. **D-2 does NOT
  change any of them.** They pass through unchanged.

- **A-1 dead-code helpers re-audit.** A-1 already audited the existence of
  `MedsManager.recomputeLastTakenAt(med)` and `MedsManager.onMergeComplete(medId)`
  as shipped dead code (`A-1-AUDIT.md` §F4, lines 41–92). D-2 does NOT
  re-audit them; D-2 only makes them live by wiring `onMergeComplete` to
  call `recomputeLastTakenAt` + emit an event.

---

## Sign-off checklist (for the implementer)

- [ ] Engine module changes match the affected-files table (`js/meds.js`
  modify, `js/sync-engine.js` comment-only modify, `tests/meds.test.js`
  modify). No UI files touched. No new files.
- [ ] Test scope above is covered — new `describe('reconcileDoseLog')` block
  in `tests/meds.test.js` with ~13 cases including the F19a future-schema
  skip case. Total test count post-D-2 is ~394.
- [ ] No re-implementation of `escapeHtml` / `Utils.formatMs` / `Platform.*`.
- [ ] `sw.js` `CACHE_NAME` bumped if any cached web file changed (pr-shipper
  handles — `js/meds.js` + `js/sync-engine.js` are cached, so bump is
  required).
- [ ] All writes to synced stores stamp `deviceId` + `updatedAt` +
  `schemaVersion` via `js/schema.js` — D-2 does NOT add new writes; the
  helper is pure (returns a new array; caller assigns + persists). The
  caller's `saveState` path is the actual write site and is unchanged.
- [ ] `RECONCILE_WINDOW_MS` constant lives at module scope in `js/meds.js`
  and is exposed on `MedsManager.RECONCILE_WINDOW_MS` for tests.
- [ ] F19a refuse-writeback gate (`Schema.isFutureRecord(med)`) is the
  first check inside `reconcileDoseLog` — returns original doseLog unchanged
  with `warnings: ['skipped: future-schema record']`. Does NOT throw.
- [ ] F14 cap enforcement (1000 entries) is the LAST algorithm step before
  return. Oldest entries dropped, not newest.
- [ ] Per-entry try/catch wraps clamp/dedup logic per Decision #3. A single
  bad entry pushes a warning + drops, never aborts the merge cycle.
- [ ] Decision #1 encoded: when `a.deviceId === b.deviceId` for adjacent
  entries within `RECONCILE_WINDOW_MS`, both are PRESERVED. When
  `a.deviceId !== b.deviceId`, keep `a` + drop `b` + increment `collapsed`,
  continue from `a` (not `b`).
- [ ] Decision #4 encoded: `<=` (inclusive) at the boundary, not `<`.
- [ ] `onMergeComplete(medId)` looks up the med, calls
  `recomputeLastTakenAt(med)`, persists via `saveState`, emits an
  `onMergeComplete` event with `{ medId }` payload.
- [ ] `js/sync-engine.js` comment seam landed inside
  `reconcileImportedBucket()` near the `_mergeMeds` call site — no behavior
  change.
- [ ] Manual verification: open `tests/index.html?fresh=verify` in a real
  browser, confirm test count ~394, all reconcileDoseLog cases green, all
  existing 381 cases unchanged.
