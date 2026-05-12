# F19a-fix · Preserve future-record `schemaVersion` through `createMed.getState()`

**PR:** `feat/sync-stage-a-f19a-passthrough-fix` → `main`
**Scope:** Small, focused patch. `js/meds.js` `createMed.getState()`
currently writes `schemaVersion: Schema.SCHEMA_VERSION` unconditionally,
silently downgrading future-schema records when callers read the wire
format (e.g. `MedsManager.snapshotForSync()`). Fix: capture the on-disk
`schemaVersion` for future records in a closed-over private field on
`loadState`, and emit that captured version from `getState()` instead of
re-stamping. **Must land before B-3** — B-3 is the first PR that
round-trips records through cloud (`pushSnapshot()` reads via
`snapshotForSync()` → would push a downgraded `schemaVersion: 1`
wrapper around payloads containing the older `_forwardBag`, defeating
the F19a contract on roundtrip).
**Status:** Audit-only commit. Code commit follows after human review.

---

## Goal

Patch `createMed.getState()` in `js/meds.js` so future-schema records
loaded from disk (`schemaVersion > Schema.SCHEMA_VERSION`) preserve
their original `schemaVersion` when re-emitted as wire format. Backward-
compatible with current-version and missing-`schemaVersion` records
(they continue to get stamped to `Schema.SCHEMA_VERSION` as today). Add
F19a passthrough tests to `tests/sync-stamps.test.js`. Un-placeholder
the deferred test stub in `tests/sync-engine.test.js` (B-1 has already
shipped to `main`, so this PR has access to the file).

---

## Orchestrator note — does ui-wirer Phase 4 fire?

**No.** The affected-files table contains no `js/*-ui.js` file, no DOM
surface, and no CSS. This is an engine-only patch on `js/meds.js` + the
two test files. Workflow: audit → engine-implementer → engine-tester →
**skip ui-wirer** → pr-shipper.

---

## Headline findings

1. **The bug is `meds.js`-only — `history.js` is NOT analogously
   broken.** The dispatch suspected the same downgrade pattern in
   `history.js`, but a careful read of every code path that re-emits a
   history record contradicts that:
   - `addSession` (line 235–249) **explicitly preserves** future
     `schemaVersion`:
     `schemaVersion: Schema.isFutureRecord(session) ? session.schemaVersion : Schema.SCHEMA_VERSION`.
   - `updateNote` / `addTag` / `removeTag` / `deleteSession` each call
     `Schema.isFutureRecord(session) → return` (refuse-writeback) before
     any mutation or `Schema.stamp()` call, so a future record on disk
     is never re-written through them.
   - `getSessions()` is a raw IDB `getAll()`; structured-cloned records
     preserve whatever `schemaVersion` is on disk.
   - `snapshotForSync()` is a pure pass-through over `getSessions()`.
   - The `migrateSessionIds()` and `backfillMetadata()` paths both use
     `Schema.stamp(...)`, which by contract **refuses to downgrade**
     (see `js/schema.js` lines 52–57). The `backfillMetadata` filter
     `s.schemaVersion == null` excludes already-stamped records from the
     loop entirely.

   **Conclusion: the F19a-fix patch only touches `js/meds.js`** (plus
   the two test files). History pull-out is **out of scope** — adding
   redundant `_originalSchemaVersion` machinery there would be dead
   code today. If a future refactor introduces a history `loadState` /
   `getState` round-trip akin to meds, re-audit at that time.

2. **`presets.js` and `recovery-ui.js` are unaffected.** Confirmed:
   - `Presets.getAll()` reads raw localStorage and returns the parsed
     array verbatim (`js/presets.js:5–9`); per-record `schemaVersion`
     stamps survive intact. `Presets.update()` refuses-writeback for
     future records (`js/presets.js:43`). `Presets.snapshotForSync()`
     just passes `getAll()` through.
   - `rest_log` records don't carry per-record `schemaVersion` — the
     payload is a `YYYY-MM-DD`-keyed object, stamped only at the
     envelope level (`js/recovery-ui.js:455`). No per-record concern.

3. **Exact bug mechanism in `meds.js`:**
   - On `loadState(state)` (line 216–299): `_fromFutureSchema =
     Schema.isFutureRecord(state)` correctly tags the in-memory record
     as future. **But `state.schemaVersion` is never captured into a
     closed-over field** — it's just consulted via `isFutureRecord` and
     discarded.
   - `KNOWN_MED_KEYS` (line 28–40) explicitly includes `'schemaVersion'`,
     so the load-time `_forwardBag` collector (line 232–237) skips it —
     meaning future-record `schemaVersion` values are NOT preserved in
     `_forwardBag` either.
   - On `getState()` (line 198–214): the output literal hardcodes
     `schemaVersion: Schema.SCHEMA_VERSION` and then `Object.assign`s
     `_forwardBag` on top. Since the bag never contained `schemaVersion`,
     the assign doesn't restore it. **Result: a future-schema record
     re-emitted as wire format is downgraded to the current version.**

4. **Recommended fix mechanism (option `a`): closed-over
   `_originalSchemaVersion` field.** On `loadState`, when
   `Schema.isFutureRecord(state)` is true, capture
   `_originalSchemaVersion = state.schemaVersion`. On `getState()`,
   emit `_originalSchemaVersion ?? Schema.SCHEMA_VERSION` instead of
   the unconditional constant. Rationale (vs option `b`, a
   `_fromFutureSchema` boolean + branching in `getState`):
   - Option (a) is one field + one ternary. Option (b) duplicates the
     `_fromFutureSchema` flag's role and requires `getState` to
     reach for `state.schemaVersion` indirectly.
   - Option (a) gracefully handles a hypothetical "future record with
     unrecognized `schemaVersion: 99`" — preserves the exact integer.
     Option (b) would require additional storage to do the same.
   - Option (a) is symmetric with how the engine already preserves
     other future fields via `_forwardBag`. The "what's preserved on
     load → what's emitted on save" contract becomes:
     `_forwardBag` for unknown keys; `_originalSchemaVersion` for the
     `schemaVersion` key (which is "known" but versioned).

5. **`MedsManager.saveAll()` refuse-writeback still applies.** The
   existing F19a contract (refuse to save a future record to disk) is
   independent of `getState()`'s shape. `saveAll` checks
   `m.isFromFutureSchema() → continue` (line 399) BEFORE writing — so
   `getState`'s output never reaches disk for future records.
   `getState`'s consumers that DO matter are: (a) `snapshotForSync()`
   for cloud upload (B-3); (b) hypothetical JSON-export paths
   (not in current scope — `export.js` exports localStorage values
   directly, not via `getState`).

6. **B-1 has already merged to `main` (commit `a3c3f19`).** The
   placeholder test in `tests/sync-engine.test.js` (lines 632–649) is
   thus accessible to this branch. **Recommendation flip from the
   dispatch:** un-placeholder the test in this PR. The original "leave
   alone" recommendation assumed B-1 was un-merged; that assumption no
   longer holds.

7. **`sw.js` `CACHE_NAME` bump IS required.** `js/meds.js` is in
   `ASSETS` (line 46 of `sw.js`). The cache strategy is cache-first via
   `caches.match()`. Content changes to a cached file without a
   `CACHE_NAME` bump leave PWA users on the old cache forever (until
   some unrelated PR happens to bump). **Bump the version string** —
   current is `'stopwatch-v66-sync-engine-scaffold'`; pr-shipper picks
   the new value (recommend `'stopwatch-v67-f19a-passthrough'`).

8. **Independent of B-1.** B-1 has merged; this PR cuts from current
   `main`. The only B-1-introduced surface this PR touches is the
   placeholder test in `tests/sync-engine.test.js` — and the merge
   conflict surface is zero (this PR adds content; doesn't delete or
   move anything). Can be reviewed and merged independently of any
   other in-flight sync PR.

---

## Affected files

| Path | Change type | Notes |
|------|-------------|-------|
| `js/meds.js` | **modify** | (1) Add `let _originalSchemaVersion = null;` to the closed-over fields near `_fromFutureSchema` (line 71). (2) In `loadState`, after the `_fromFutureSchema = Schema.isFutureRecord(state)` line, add `_originalSchemaVersion = _fromFutureSchema && typeof state.schemaVersion === 'number' ? state.schemaVersion : null;`. (3) In `getState`, change `schemaVersion: Schema.SCHEMA_VERSION` to `schemaVersion: _originalSchemaVersion ?? Schema.SCHEMA_VERSION`. (4) Update the inline F19a comment block above `getState` (line 199–201) to document the passthrough. Total: ~5 line edits. No public API change. |
| `js/history.js` | **NOT MODIFIED** | After verification (see "Headline findings" #1), history's read+write paths already handle future records correctly. No patch needed. Listed here only to make the no-touch decision explicit. |
| `tests/sync-stamps.test.js` | **modify** | Append a new `describe('F19a — Meds future-record passthrough', ...)` block at end-of-file with the test cases enumerated in "Test scope" below. Mirrors the existing F4 / F6 / F21 sectioning style. |
| `tests/sync-engine.test.js` | **modify** | Un-placeholder the existing `MedsManager.snapshotForSync — F19a future-record passthrough` describe block (lines 630–650). Replace the `assert(true, 'F19a passthrough test deferred to follow-up PR')` line + comment with the real assertion: stub a med whose on-disk record has `schemaVersion: 2`, call `MedsManager.snapshotForSync()`, assert `result.payload.meds[0].schemaVersion === 2` AND `result.schemaVersion === Schema.SCHEMA_VERSION`. Pattern follows the existing F19b test at lines 654–689 (snapshotMedsKeys / clearMedsKeys / restoreMedsKeys helpers already exist in the file). |
| `sw.js` | **modify** (pr-shipper) | Bump `CACHE_NAME` version string. No `ASSETS` array change (the two modified JS files are already in the list). |

**Total: 4 files** (1 engine modify, 2 test modifies, 1 pr-shipper-owned cache bump).

---

## Sync invariants touched

Each row records the F# status for F19a-fix specifically. "Pass-through"
= F19a-fix does not change the invariant's behavior; existing engine
code already satisfies it.

| F# | Description | Status in F19a-fix |
|----|-------------|--------------------|
| F2 | Session IDs `${deviceId}-${ts}-${counter}` + `legacyId` | **Pass-through.** Patch doesn't touch `history.js` write paths. |
| F4 | Re-derive `lastTakenAt` after merge | **Pass-through.** Patch doesn't touch `recomputeLastTakenAt` or `onMergeComplete`. |
| F6 | `phaseLog` `(deviceId, phaseStartedAt)` stamping | **Pass-through.** Patch doesn't touch pomodoro/flow phaseLog code. |
| F10 | `deviceId` + `updatedAt` at write sites | **Pass-through.** `getState` still emits the existing `updatedAt` / `deviceId` from closed-over vars unchanged. The patch adds nothing that disturbs F10's stamping invariant. **Regression test in scope:** assert that snapshotting a normal (current-schema) med still emits the local `updatedAt` and `deviceId`. |
| F13 | `tempo_sync_state` write gate | **Pass-through.** `MedsManager.saveAll` still checks `SyncState.canWrite()`. No change. |
| F14 | `doseLog` cap @ 1000 | **Pass-through.** Patch doesn't touch `logDose` or `loadState`'s log filter. |
| F18 | Per-record meds persistence under `meds/{medId}` | **Pass-through.** No persistence-layout change. |
| F19a | `schemaVersion` stamping + refuse-writeback | **PRIMARY SUBJECT.** Patch fixes the previously-broken read-side passthrough for future records. Refuse-writeback contract on `MedsManager.saveAll` (line 399) and `MedsManager.remove` (line 355) is unchanged. The fix makes the F19a contract *complete* on the meds engine: future records are (a) loaded into memory, (b) flagged, (c) refused on writeback to disk, AND now also (d) re-emitted via `getState()` with their original `schemaVersion` preserved so cloud snapshot and any future read-side consumer sees the correct version. |
| F19b | `__forward` passthrough (top-level unknowns) | **Pass-through, structurally compatible.** `_forwardBag` mechanism unchanged. The `schemaVersion` key remains in `KNOWN_MED_KEYS` (so the bag still doesn't collect it — that would create a double-emission risk via the `Object.assign(out, _forwardBag)` line). The new `_originalSchemaVersion` field is the dedicated capture site for the one "known but versioned" field. **Regression test in scope:** assert that an unknown future-schema field (e.g. `customFutureField`) still rides through `_forwardBag → getState → snapshot` (mirrors the existing F19b test at sync-engine.test.js:654). |
| F20 | Absent vs present-but-unknown enum split | **Pass-through.** `loadState`'s frequency-preservation block unchanged. |
| F21 | `alarmFired` per-device, never synced | **Pass-through.** Meds doesn't have `alarmFired`; F21 is structurally satisfied by virtue of the field's absence from synced records. |

**Summary: F19a is the primary subject (made complete); F10 + F19b
flagged as regression-test-in-scope (no behavior change expected, but
worth asserting); all others pass-through.**

---

## Risks

| Risk | Likelihood | Blast radius | Mitigation |
|------|------------|--------------|------------|
| Backward-compat regression: the patch accidentally changes how current-schema records (`schemaVersion === Schema.SCHEMA_VERSION`) or missing-`schemaVersion` records emit their wire format. | low | data-correctness on every saved med (every record on disk) | The patch's `loadState` change is guarded: `_originalSchemaVersion` is set only when `_fromFutureSchema === true` AND `state.schemaVersion` is a number. For current-version records and pre-F19a records (no `schemaVersion`), `_originalSchemaVersion` stays `null` and `getState` emits `Schema.SCHEMA_VERSION` via the `??` fallback — byte-equivalent to today's behavior. **Explicit regression test in scope** (Test #2 below): load a current-schema record, call getState, assert `schemaVersion === Schema.SCHEMA_VERSION`. **Explicit pre-F19a test** (Test #3): load a record with no `schemaVersion` field, call getState, assert `schemaVersion === Schema.SCHEMA_VERSION`. |
| F10 regression: the patch accidentally touches the `updatedAt` / `deviceId` emit path in `getState`. | low | data-correctness on every saved med | The patch is one line in `getState` (the `schemaVersion:` line) plus the new closed-over field declaration. `updatedAt` / `deviceId` lines are not touched. **Test in scope:** Test #4 (current-schema regression) asserts `out.updatedAt` / `out.deviceId` carry the closed-over values. |
| F19b regression: the `_forwardBag` mechanism gets broken (e.g. an unknown future field stops round-tripping). | low | data-loss on roundtrip for future records on downlevel client | The `_forwardBag` collection loop in `loadState` and the `Object.assign(out, _forwardBag)` line in `getState` are not touched by the patch. The new `_originalSchemaVersion` is captured separately and read separately. **Test in scope:** Test #5 (future-record roundtrip with extra unknown field) asserts both `schemaVersion` AND the extra field survive. |
| `MedsManager.saveAll`'s `isFromFutureSchema() → continue` skip is bypassed somehow, causing a future record to be written back to disk with the in-memory shape (which would drop unknown V3+ fields not in `_forwardBag`). | low | data-loss on disk for future records | The patch doesn't touch `saveAll` or `isFromFutureSchema`. The pre-existing safeguard holds. **Note for engine-implementer:** the patch's `getState` output is only consumed by `snapshotForSync` (cloud upload) and JSON-export paths; `saveAll` still uses the unconditional `JSON.stringify(m.getState())` BUT only after the `isFromFutureSchema()` skip. Worst case the snapshot output is technically "richer" than what's on disk — that's an improvement, not a regression. |
| B-1 placeholder un-placeholder coordination: the placeholder test at `tests/sync-engine.test.js:632–650` references the future fix PR's branch name. The audit's recommended branch name (`feat/sync-stage-a-f19a-passthrough-fix`) matches the placeholder's comment exactly, so no inconsistency surfaces. | low | doc-only | Engine-implementer keeps the branch name consistent with the placeholder's comment text. If the implementer renames the branch, also update the un-placeholdered test's surrounding comment to mention the actual PR ref. |
| The `??` operator (nullish coalescing) is used in the fix but isn't already present in `js/meds.js`. Older browsers (pre-Chrome 80, pre-Safari 13.1) lack support. | very low | web-bytes (browser compat) | Tempo targets evergreen browsers; the iOS Capacitor WebView is modern (`WKWebView` from iOS 13+). All currently-supported browsers handle `??`. `js/sync-engine.js` (B-1) already uses modern syntax. If the implementer wants to be conservative, `_originalSchemaVersion !== null ? _originalSchemaVersion : Schema.SCHEMA_VERSION` is byte-equivalent. |
| `sw.js` cache bump forgotten: PWA users on the v66 cache continue serving the buggy `js/meds.js` indefinitely. | med | web-bytes (deployed PWAs stay broken) | pr-shipper enforces the bump via sign-off checklist. The `sw.js` `CACHE_NAME` line is hardcoded at line 1 — visible in the diff. |
| Audit-suspected history.js bug turns out to be real after all (I missed a path). | low | data-correctness on history-snapshot roundtrip | Engine-implementer is invited to double-check `js/history.js` against the verification chain in "Headline findings" #1 during implementation. If a new path is found, audit is wrong and implementer should add `js/history.js` to the affected-files table and update the test scope before writing code. Reviewer (pr-shipper) does the same verification before merge. |

**Risk count: 8** (very low: 1, low: 6, med: 1, high: 0).

---

## Test scope

### New tests required: append to `tests/sync-stamps.test.js`

Add a new `describe('F19a — Meds future-record schemaVersion passthrough', ...)`
block. **Five cases**, covering the bug-fix contract plus the
backward-compat regression surface:

1. **Future-record schemaVersion preserved on `getState`.** Load a med
   with on-disk state `{ id, name, schemaVersion: 2, ...rest }` via
   `createMed(id).loadState(state)`. Call `getState()`. Assert
   `result.schemaVersion === 2`. Also assert `isFromFutureSchema() ===
   true` (regression on the existing flag — should still be true).

2. **Current-schema record stays at current version** (regression).
   Load a med with `schemaVersion: Schema.SCHEMA_VERSION` (which is `1`).
   Call `getState()`. Assert `result.schemaVersion === 1`. Asserts
   the fix didn't change behavior for already-correct records.

3. **Missing-`schemaVersion` record gets stamped to current**
   (regression). Load a med with NO `schemaVersion` field (pre-F19a
   record shape). Call `getState()`. Assert
   `result.schemaVersion === Schema.SCHEMA_VERSION` (`1`). Asserts
   the fix didn't break the F19a stamping contract for legacy data.

4. **Far-future schema version preserved exactly** (range check).
   Load a med with `schemaVersion: 99`. Call `getState()`. Assert
   `result.schemaVersion === 99`. Catches an off-by-one or truthiness
   bug in the `??` ternary.

5. **Future-record + unknown forward field roundtrip together**
   (F19a + F19b interaction). Load a med with
   `{ schemaVersion: 2, customFutureField: 'hi', ...rest }`. Call
   `getState()`. Assert BOTH `result.schemaVersion === 2` AND
   `result.customFutureField === 'hi'`. Verifies the two preservation
   mechanisms (`_originalSchemaVersion` and `_forwardBag`) don't
   collide and that schemaVersion isn't accidentally smuggled into
   `_forwardBag` (which would cause double-emission).

Optional sixth case (engine-tester discretion):

6. **Idempotence under repeated load.** Call `loadState(stateA)` with
   `schemaVersion: 2`, then `loadState(stateB)` with no
   `schemaVersion`. Call `getState()`. Assert
   `result.schemaVersion === Schema.SCHEMA_VERSION` (the second load
   should reset `_originalSchemaVersion` back to `null`). Verifies
   loadState properly clears the captured value on a fresh load — a
   stale `_originalSchemaVersion` from a prior load would be a subtle
   leak.

### Un-placeholder the existing test in `tests/sync-engine.test.js`

The placeholder test at lines 630–650 should become a real test that
exercises the full snapshot path:

7. **`MedsManager.snapshotForSync` inner-record `schemaVersion=2`
   survives; envelope stays at current.** Use the existing
   `snapshotMedsKeys` / `clearMedsKeys` / `restoreMedsKeys` helpers
   (already in the file). Set `localStorage.setItem('meds/m1',
   JSON.stringify({ id: 'm1', schemaVersion: 2, ...rest }))`. Call
   `MedsManager.loadAll()`. Stub `History.getDeviceId` via
   `stubHistoryForSync` (existing helper). Call
   `MedsManager.snapshotForSync()`. Assert
   `result.schemaVersion === Schema.SCHEMA_VERSION` (envelope is the
   wrapper version) AND `result.payload.meds[0].schemaVersion === 2`
   (inner record's original schemaVersion preserved end-to-end through
   load → getState → snapshot).

This restores the test the B-1 audit deferred. The B-1 author's comment
in the placeholder (lines 634–648) describes exactly this shape; the
implementer's job is to translate it to assertion form.

### Existing tests at risk

- **`tests/meds.test.js`** (38 cases): zero changes expected. The
  patch's `loadState` line is additive (sets a new closed-over field
  alongside `_fromFutureSchema`); the `getState` line keeps the same
  output shape for current-schema records (`??` fallback). If any
  existing test asserted `out.schemaVersion === Schema.SCHEMA_VERSION`
  for a current-schema fixture, it continues to pass.
- **`tests/sync-engine.test.js`** (10+ cases): one case
  un-placeholdered (#7 above); other cases unaffected. The existing
  F19b passthrough test (lines 654–689) is a good template and a
  regression check (must still pass after the fix).
- **`tests/sync-stamps.test.js`** (15 cases): zero changes to existing
  F4 / F6 / F21 sections. Patch appends one new F19a section.
- **`tests/presets.test.js`** / **`tests/schema.test.js`**: zero
  changes. Patch doesn't touch presets, doesn't touch `Schema.stamp`
  / `Schema.isFutureRecord`.

### Test-runner harness considerations

- `tests/index.html` already loads `js/schema.js`, `js/meds.js`, and
  `tests/sync-stamps.test.js` (per A-1's already-shipped state). No
  index.html edits required for the new F19a section.
- `sync-engine.test.js` already has the helpers needed
  (`snapshotMedsKeys`, `stubHistoryForSync`, etc.) per B-1.
- All test cases run synchronously except `MedsManager.snapshotForSync`
  (case #7) — `snapshotForSync` for meds is synchronous (only history's
  adapter is async).

---

## Manual setup steps

**None.** F19a-fix is pure code + tests + cache bump. No Firebase
project state changes; no new localStorage keys; no migration; no
manual user action.

---

## Out of scope (explicitly NOT in this PR)

- **`js/history.js` patch.** After verification, history.js does NOT
  exhibit the analogous bug (see "Headline findings" #1). If a future
  refactor introduces a history `loadState`/`getState` round-trip akin
  to meds, re-audit at that time. Adding redundant
  `_originalSchemaVersion` machinery to history.js now would be dead
  code.
- **`js/presets.js` patch.** `Presets.getAll()` reads raw localStorage
  records; per-record `schemaVersion` stamps survive intact through
  `snapshotForSync()`. Confirmed.
- **`js/recovery-ui.js` patch.** `rest_log` records don't carry
  per-record `schemaVersion`. The envelope-level stamp in
  `snapshotForSync()` is the only schemaVersion concern, and it's
  written directly as `Schema.SCHEMA_VERSION` (correct).
- **F19a redesign.** This is a patch, not a rewrite. The
  `_fromFutureSchema` flag + `MedsManager.saveAll`'s refuse-writeback
  skip are preserved as-is; the only change is preserving the original
  `schemaVersion` value for read-side consumers.
- **F19c per-store manifest registry.** Deferred indefinitely per
  `docs/CLOUD-SYNC-STRATEGY.md` Known limitations section. Out of
  scope for any Stage A close-out work.
- **JSON-export integration.** `js/export.js`'s full-data export
  serializes localStorage values directly (not via engine `getState`).
  The fix improves `snapshotForSync()` output (cloud upload path) but
  doesn't change export.js behavior. If export.js is ever rewired to
  route through `MedsManager.snapshotForSync()`, this fix incidentally
  makes that path correct too.
- **Adding `schemaVersion` to `_forwardBag`.** Tempting alternative
  fix, but would create a double-emission risk: `getState`'s
  `Object.assign(out, _forwardBag)` would re-emit the bag's
  `schemaVersion`, potentially conflicting with `out.schemaVersion`.
  Cleaner to use a dedicated closed-over field.
- **Updating `KNOWN_MED_KEYS`.** No changes needed — `'schemaVersion'`
  stays in the set (it's a known, structurally-meaningful field; the
  forward bag should not collect it).

---

## Sign-off checklist (for the implementer)

- [ ] Engine module changes match the affected-files table:
  `js/meds.js` only (one `let` declaration, one `loadState` line, one
  `getState` line, one updated comment block). No `js/history.js`
  change.
- [ ] `loadState` change: `_originalSchemaVersion` is set only when
  `_fromFutureSchema === true` AND `typeof state.schemaVersion ===
  'number'`. Set to `null` otherwise (covers fresh `createMed` →
  pre-`loadState` state too).
- [ ] `loadState` resets `_originalSchemaVersion = null` on every call
  (NOT just when future), so a second loadState of a non-future
  record properly forgets the prior captured value (test case #6).
- [ ] `getState` change: `schemaVersion: _originalSchemaVersion ??
  Schema.SCHEMA_VERSION` (or the explicit ternary form if
  conservativeness is preferred).
- [ ] `_forwardBag` mechanism untouched. `KNOWN_MED_KEYS` still
  includes `'schemaVersion'`.
- [ ] `MedsManager.saveAll` and `.remove` `isFromFutureSchema()` checks
  untouched.
- [ ] New `describe('F19a — Meds future-record schemaVersion
  passthrough', ...)` block in `tests/sync-stamps.test.js` covers at
  least 5 cases (the first five enumerated above; #6 optional).
- [ ] Placeholder test in `tests/sync-engine.test.js` (lines 630–650)
  replaced with a real assertion (case #7 above). The `assert(true,
  ...)` line is gone; real `MedsManager.snapshotForSync()` call +
  envelope/inner-record assertions are in.
- [ ] All engine tests pass via `tests/index.html` (manual: serve repo
  root via `python3 -m http.server 8765`, open
  `http://localhost:8765/tests/index.html`, read pass/fail counts).
- [ ] No re-implementation of `escapeHtml` / `Utils.formatMs` /
  `Platform.*`. (None expected — patch is engine-internal.)
- [ ] `sw.js` `CACHE_NAME` bumped (pr-shipper) — recommended
  `'stopwatch-v67-f19a-passthrough'` or similar; ASSETS array is
  unchanged (`js/meds.js` is already in the list at line 46).
- [ ] All writes to synced stores stamp `deviceId` + `updatedAt` +
  `schemaVersion` via `js/schema.js` — **already complies**. This
  PR's patch is read-side; write sites (`logDose`, `touch`,
  `addSession`, etc.) are unchanged.
- [ ] **Branch independence:** PR opens against current `main`. No
  rebase needed; no merge conflict with any in-flight branch
  expected.
- [ ] **History.js verification:** before writing code, implementer
  re-confirms (via grep + read) that `js/history.js` has no
  analogous read-side downgrade path. If found, audit is wrong —
  pause, update affected-files + test scope, then proceed.

---

## Rollback

Revert the PR. The patch is read-side only — `getState`'s output is
only consumed by `snapshotForSync()` (B-1, already merged, cloud-upload
not yet wired) and any future export integration. Reverting leaves
future-schema records back in their pre-fix downgrade state on the
snapshot path; since cloud upload (B-3) hasn't shipped yet, no on-disk
or on-cloud data is affected by the revert.

The `tests/sync-engine.test.js` un-placeholder revert restores the
`assert(true, ...)` stub — engine test counts drop by 1 but no
existing test fails.

The `sw.js` cache bump revert: if the bumped version shipped but the
JS change is reverted, the old cache version stays in use until the
next deploy bumps `CACHE_NAME` again — no functional regression, just
a one-cycle stale-cache state on existing PWA installs (mirrors B-1's
revert behavior).

---

## Next step

Stop here. Push this audit to the branch (commit 1 of 2 on the F19a-fix
branch) and dispatch the engine-implementer for the code commit (commit
2 of 2). Engine-implementer reads this audit + `js/schema.js` +
`js/meds.js` (lines 198–299) + the placeholder at
`tests/sync-engine.test.js:630–650` and writes the patch + test cases.
No scope additions unless audit review flags one.
