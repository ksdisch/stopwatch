# D-1 · Stage D imported-bucket reconcile — affected-files + risks audit

**PR:** `feat/sync-stage-d-imported-bucket` → `main`
**Stacked on:** `main` after C-1 (PR #62) merges. Branch D-1 off the
freshly-merged commit; rebase pain is non-trivial if D-1 branches off
unmerged C-1.
**Scope:** Land the **reconcile flow** that C-1's `tempo_sync_stage_d_handoff`
guard short-circuits to. Tag every pre-existing local record as
"imported (pre-sync)", pull cloud, merge cloud ∪ tagged-local, push the
combined snapshot, surface imported entries in the history panel with a
hide/show toggle, and replace C-1's dead-end "Manual reconciliation will
ship in a follow-up" drawer copy with a working **Reconcile now** button.
F17 Alternative 2 (separate-bucket imported history) is the strategy
implemented here.

D-1 is the **third observable cross-device milestone** ("Device B with
pre-existing local data signs in, reconciles, and ends up with cloud + local
unified in one tree"). It is the **second PR after C-1 that mutates local
state via the privileged-write path** — `_reconcileWriteRaw` mirrors C-1's
`_hydrateWriteRaw` exactly, plus a new pull/merge/push orchestrator on
top.

---

## Goal

Land `SyncEngine.reconcileImportedBucket()` (pull → merge → push
orchestrator), per-engine `_reconcileWriteRaw` privileged-write helpers on
`MedsManager` / `History` (mirror C-1's `_hydrateWriteRaw` pattern), the
`bucket: 'synced' | 'imported'` field on `History` session records, the
`originDeviceId` field on `MedsManager` records (added to `KNOWN_MED_KEYS`
so it roundtrips cleanly through `__forward`), the history-panel
"Imported (pre-sync)" chip + hide/show filter, and the "Reconcile now"
button in the settings drawer (rewires C-1's two dead-end copy sites). A
placeholder `ManualDedupe.scan()` module ships under
`js/sync-manual-dedupe.js` to give D-2+ a hook surface; full ManualDedupe
UI is explicitly deferred. C-1's `tempo_sync_stage_d_handoff` flag is
cleared on reconcile success; failure leaves it set so the user can retry.

---

## Headline findings — spec-vs-code resolutions

The orchestrator pre-resolved 5 spec/code mismatches in the D-1 brief
(`docs/sync-impl/prompts/D-1-PROMPT.md`). They are documented here so the
engine-implementer reads the audit alone for ground truth and doesn't
re-litigate them by chasing PLAN.md §D-1's earlier wording.

1. **`KNOWN_HISTORY_KEYS` does not exist on `main`.** PLAN.md §D-1
   (~line 289) references adding `bucket` to a `KNOWN_HISTORY_KEYS`
   allowlist analogous to `meds.js`'s `KNOWN_MED_KEYS`. That set never
   shipped — `js/history.js:235` uses the F19b spread-then-overlay
   pattern instead (the entry literal at line 235 spreads the caller's
   session first and then overlays computed/normalized fields). The
   spread is lossless for any present field without an allowlist. **D-1
   resolution:** no `KNOWN_HISTORY_KEYS`. Add `bucket` as a single
   overlay default in `addSession` (mirrors the existing `tags`, `note`,
   `type`, `duration` overlay defaults at lines 244–248):
   ```js
   bucket: session.bucket || 'synced',
   ```
   New writes get `'synced'`; explicit `'imported'` from the reconcile
   path is preserved verbatim; absent `bucket` on legacy records stays
   absent on read until the reconcile pass back-tags them.

2. **`originDeviceId` does need a KNOWN_MED_KEYS entry.** `js/meds.js:28`
   uses the F19b allowlist+`__forward` pattern (the spread pattern was not
   adopted here). Without the entry, `originDeviceId` would be diverted
   into `_forwardBag` and round-trip as an opaque blob — readable but not
   accessible to the engine's named getters and not visible to the cloud
   merge logic. **D-1 resolution:** add `originDeviceId` to the V2 schema
   block of `KNOWN_MED_KEYS` (between the `lastTakenAt, doseLog` line and
   the F10 stamps line). It's an immutable field set once at reconcile
   time; `deviceId` (F10) continues to update on every write.

3. **The reconcile-flow ordering is pull → merge → push, in 9 steps.**
   PLAN.md §D-1 hints at "tag every existing local history row with
   `bucket: 'imported'` … then upload fresh snapshot" but doesn't
   sequence the cloud pull-down explicitly. The brief lays out the full
   9-step sequence: (1) `SyncState.set('hydrating')` → (2) stamp local
   idempotently → (3) pull cloud per-store → (4) merge with collision
   rules → (5) write combined to local + cloud → (6) set 5 hydrate
   markers → (7) clear `tempo_sync_stage_d_handoff` → (8)
   `SyncState.set('ready')` → (9) emit `reconcile-complete`. **D-1
   resolution:** the brief's 9-step contract is authoritative; the
   audit's affected-files notes for `js/sync-engine.js` reference these
   step numbers.

4. **`_reconcileWriteRaw` is a new helper mirroring `_hydrateWriteRaw`
   line-for-line.** C-1 introduced the privileged-write pattern
   (`feat/sync-stage-c-hydrate:js/meds.js:498`,
   `feat/sync-stage-c-hydrate:js/history.js` near tail,
   `feat/sync-stage-c-hydrate:js/presets.js:325`,
   `feat/sync-stage-c-hydrate:js/recovery-ui.js:479`) — direct
   localStorage/IDB writes bypassing the `SyncState.canWrite()` gate
   while state is `'hydrating'`. D-1's reconcile needs the same gate
   bypass for the tag-stamp step (step 2) AND the merged-snapshot write
   step (step 5). The two helpers are structurally similar enough that
   a future unification PR may collapse them into one
   `_privilegedWriteRaw(reason: 'hydrate' | 'reconcile')` — see "Open
   questions" below; D-1 ships them as twins for now to keep the diff
   reviewable.

5. **Idempotency is the rollback strategy.** PLAN.md §D-1 doesn't speak
   to mid-flight failure recovery; the brief specifies "the operation is
   retryable. No partial bucket-tag stamps if step 4+ fail (rollback via
   in-memory transaction — or accept idempotent re-run as the cheap fix;
   document the choice in the audit)." **D-1 resolution:** idempotent
   re-run is the cheap fix. The stamp loop in step 2 uses
   `if (bucket == null) set 'imported'` (not unconditional set), and the
   meds analogue uses `if (originDeviceId == null) set deviceId`. On
   retry, already-stamped records are no-ops. Hydrate markers (step 6)
   and `tempo_sync_stage_d_handoff` clear (step 7) happen ONLY after the
   cloud-and-local writes both succeed, so a failed retry resumes at the
   tag/merge/push loop from scratch with the partial stamps already
   in-place from the previous attempt — no inconsistency. This is the
   same "leave markers absent on failure" contract C-1 ships for
   hydrate.

---

## Orchestrator note — ui-wirer Phase 4 FIRES

**Yes.** D-1 ships visible DOM at three sites: (a) `js/history-ui.js`
adds an "Imported (pre-sync)" chip on session rows where `bucket ===
'imported'` and a hide/show filter toggle in the filter bar at
`js/history-ui.js:~150`; (b) `js/tempo-nav.js` replaces the dead-end
copy at lines 485–489 and 640–647 with a "Reconcile now" button +
handler; (c) `index.html` may need new drawer markup for the
"Reconcile now" button (or it slots into the existing Cloud Sync
section that B-2 added at lines 81–128); (d) `css/styles.css` gets the
chip + filter-toggle + button styles.

Workflow: audit (this file) → engine-implementer (the engine + tests +
`sync-manual-dedupe.js` placeholder) → engine-tester (verify test pass
counts) → **ui-wirer Phase 4** (chip, filter toggle, Reconcile-now
button, drawer copy rewire) → pr-shipper.

---

## Affected files

| Path | Change type | Notes |
|------|-------------|-------|
| `js/history.js` | **modify** | Add `bucket: 'synced' \| 'imported'` field via a single overlay default in `addSession` (line 235 entry literal — add `bucket: session.bucket \|\| 'synced',` alongside the existing `tags`, `note`, `type`, `duration` overlays at lines 244–248). **No `KNOWN_HISTORY_KEYS` allowlist** — the F19b spread pattern is lossless without one (Headline #1). Add a new `_reconcileWriteRaw(records)` async helper mirroring C-1's `_hydrateWriteRaw` (`feat/sync-stage-c-hydrate:js/history.js` near tail). The reconcile helper bypasses `SyncState.canWrite()` exactly like hydrate; the only difference is purpose — reconcile writes the **tagged-then-merged** snapshot, not a verbatim cloud replace. Export both `hydrateFromCloud` (existing) and `reconcileWriteRaw` (or expose as part of a new `reconcileBuckets({ stamp, merge })` method — engine-implementer decides shape). `snapshotForSync` needs no change (`bucket` rides along inside the opaque session). `getAllTags` (line 348) does NOT need code changes — `bucket` is read from `session.bucket`, not `session.tags`, so the existing tag-union loop ignores it. Regression test enforces. |
| `js/meds.js` | **modify** | Add `originDeviceId` to `KNOWN_MED_KEYS` (line 28 — in the V2 schema block between `'lastTakenAt', 'doseLog',` and `'updatedAt', 'deviceId',`). Per Headline #2: without this entry, `originDeviceId` lands in `_forwardBag` and the cloud merge logic can't see it for `medId` collision distinction. Add a `_reconcileWriteRaw(records)` helper mirroring C-1's `_hydrateWriteRaw` at `feat/sync-stage-c-hydrate:js/meds.js:498`. The contract is identical (clear localStorage `meds/*` keys, write each cloud record verbatim, call `loadAll()` to rehydrate in-memory state) — what differs is the caller: reconcile passes the **merged cloud-∪-tagged-local snapshot**, not a verbatim cloud payload. No change to existing `deviceId` (F10) `touch()` behavior; `originDeviceId` is a separate, immutable field set once at reconcile time. |
| `js/sync-engine.js` | **modify** | Major new function `reconcileImportedBucket()` per the brief's 9-step contract (Headline #3): (1) re-entry guard + preconditions (sign-in, flag, gate not already 'hydrating') mirroring `hydrateFromCloud` at `feat/sync-stage-c-hydrate:js/sync-engine.js:657` — add `_reconcileInFlight` boolean + `_currentReconcilePromise` (lines ~36–40 region). (2) `SyncState.set('hydrating')` before any stamp/pull/push. (3) **Stamp local idempotently:** for each `History` row where `bucket == null` AND `!Schema.isFutureRecord(session)`, set `bucket: 'imported'` + `originDeviceId: History.getDeviceId()`. For each med where `originDeviceId == null`, set it. Skip future-schema rows; count them as `result.skippedFutureRecords`. Writes go through `_reconcileWriteRaw` (privileged path bypassing F13). (4) **Pull cloud per-store** via existing C-1 `_pullCloudStore(uid, storeKey)` helper at `feat/sync-stage-c-hydrate:js/sync-engine.js:624`, in the same dependency order (rest_log → meds → presets → history). (5) **Merge** per collision rules (see "Sync invariants" section): history collisions on `sessionId` prefer cloud + log warning (rare — device-prefixed IDs differ across devices); meds collisions on `medId` keep BOTH records (distinguished by `originDeviceId`); rest_log + presets resolve LWW via `updatedAt`. (6) **Write merged snapshot** to local via `_reconcileWriteRaw` AND to Firestore via `SyncFirestore.setDoc` per record (reuse B-3's per-record CAS pattern at lines 469). (7) **Set all 5 hydrate markers** (`tempo_sync_hydrated_rest_log`, `_meds`, `_presets`, `_history`, `_all`) so subsequent boots short-circuit. (8) **Clear `tempo_sync_stage_d_handoff`** (call new `clearStageDHandoff()` helper that mirrors the existing `setStageDHandoff()` at `feat/sync-stage-c-hydrate:js/sync-engine.js:246`). (9) `SyncState.set('ready')` and `emit('reconcile-complete', { ok, kind, counts, skippedFutureRecords })`. Emit `reconcile-progress { stage, store?, current?, total? }` events during steps 3–6 (mirror C-1's `hydrate-progress` shape at line 745). Failure handling: on any step failure, `SyncState.set('error')`, emit `reconcile-complete { ok: false, kind: 'reconcile-error', error }`, leave the handoff flag set + hydrate markers unset so the user can retry (Headline #5 — idempotent re-run as rollback). |
| `js/sync-manual-dedupe.js` | **add** | New flat-path module (`js/sync-manual-dedupe.js`, NOT `js/sync-impl/`, to match the existing `js/sync-*.js` convention — see `js/sync-engine.js`, `js/sync-auth.js`, `js/sync-firestore.js`, `js/sync-flag.js`). Single IIFE exposing `window.ManualDedupe = { scan }`. `scan()` is the only public method for D-1; it returns candidate pairs as `Array<{ a, b, similarity }>` where `a` and `b` are session records (`a` = synced, `b` = imported) with the same `(roundedDate, duration, type)` triple. `similarity` is a numeric score 0–1; for D-1 a single algorithm suffices: exact triple match = 1.0; if duration is within ±5 sec, similarity = 0.9. No UI is wired — `ManualDedupe.scan()` is a console-only hook for D-2+ to consume. Minimum test coverage: empty when no imported rows; pair detection on triple match; doesn't surface pairs across types (cooking ≠ stopwatch even if duration matches). |
| `index.html` | **modify** | Two edits: (1) Add `<script src="js/sync-manual-dedupe.js"></script>` to the sync-modules block (after `js/sync-engine.js`, before `js/sync-auth.js`). (2) **Optionally** add a `<button id="cloud-sync-reconcile-btn">Reconcile now</button>` element inside the existing Cloud Sync section (between lines 124 and 128 — alongside the push button — gated by `hidden` and shown via `tempo-nav.js` only when `tempo_sync_stage_d_handoff === '1'`). The ui-wirer may instead choose to dynamically insert the button in `tempo-nav.js` for symmetry with the existing dynamic status row; either is acceptable, but a static markup element is easier to test and style. |
| `js/tempo-nav.js` | **modify** | At both dead-end sites (~lines 485–489 and ~640–647 on the C-1 branch, line numbers may shift after merge — `grep` for "Manual reconciliation will ship in a follow-up"): replace the static status text with a "Reconcile now" button + handler that calls `SyncEngine.reconcileImportedBucket()`. Hook into the existing `wireCloudSync` block (the same function that wires push and hydrate events). Subscribe to two new events from `SyncEngine.on('reconcile-progress', …)` and `SyncEngine.on('reconcile-complete', …)`; route to the existing `setProgress()` / `setStatus()` helpers. On success, status becomes `"Imported N past sessions. Synced ✓"` (`N` from `result.counts.history`); on failure, `"Reconcile failed (kind): message"` with a Retry button. Re-use C-1's `#cloud-hydrate-overlay` for in-progress display OR render inline in the drawer status row (engine-implementer decides — overlay is heavier but matches C-1's UX; inline is lighter but slightly disjointed). Also subscribe to `SyncEngine.on('reconcile-complete', …)` to call `renderCloudSyncUI()` after the flag clear so the button hides on success. |
| `js/history-ui.js` | **modify** | Two changes in `renderHistory()`: (1) Around line 220 (where session row HTML is built), add an "Imported (pre-sync)" chip for rows where `s.bucket === 'imported'`. The chip is visually distinct from user tags (subdued/outlined; smaller; non-interactive — no delete `×`). It renders inside the existing `.history-tags` container or as a sibling chip just before `.history-tags`. (2) Around line 150 (the existing tag-filter-bar pattern), add a hide/show toggle as a new `filter-chip` adjacent to the existing date-range chips ("Hide imported"). Persist toggle state to localStorage key `history_hide_imported` (`'0'` or `'1'`, default `'0'`). When `'1'`, the existing `sessions` filter chain (lines 186–195) gets an additional `sessions = sessions.filter(s => s.bucket !== 'imported')` step. The toggle's active-state styling mirrors the existing `filter-chip-active` class. **No change to `History.getAllTags()` consumers** — `bucket` is read from `s.bucket`, not `s.tags`, so the existing tag-filter logic at line 191 is unaffected. Regression test in `tests/sync-imported-bucket.test.js` enforces. |
| `css/styles.css` | **modify** | Three blocks (~40 lines total): (1) `.history-tag-imported` chip — outlined border, muted color, `font-size: 0.75rem`, `pointer-events: none`. Distinct from `.tag-chip` so it doesn't look like a user-editable tag. (2) `.filter-chip[data-filter-imported]` for the hide-imported toggle — extends existing `.filter-chip` and `.filter-chip-active` rules with no new tokens. (3) `.tempo-cloud-sync-reconcile-primary` button (if a new class is needed; engine-implementer may reuse `.tempo-cloud-sync-primary` from B-2 lines 111–124 for visual parity with the push button). The chip and toggle are the two visible-bytes additions. |
| `tests/sync-imported-bucket.test.js` | **add** | New test file. ~12 cases per the brief's enumeration (see "Test scope" below). Mocks `window.SyncFirestore`, `window.SyncAuth`, `window.SyncFlag`, `window.MedsManager`, `window.History`, `window.Presets`, `window.RecoveryUI` per case, mirroring `sync-hydrate.test.js` from C-1. Each test resets `localStorage` (especially `tempo_sync_stage_d_handoff` + hydrate markers) and `SyncState` in `before()`. |
| `tests/index.html` | **modify** | Add `<script src="sync-imported-bucket.test.js"></script>` to the test suites block (after `sync-hydrate.test.js` from C-1; before `presets.test.js` to keep sync tests grouped). |
| `sw.js` | **modify** | **Bump `CACHE_NAME`** from C-1's `'stopwatch-v71-sync-hydrate'` → `'stopwatch-v72-sync-reconcile'` (or `'stopwatch-v72-imported-bucket'` — pr-shipper picks). Multiple cached web files change (`js/sync-engine.js`, `js/history.js`, `js/meds.js`, `js/history-ui.js`, `js/tempo-nav.js`, `css/styles.css`, `index.html`) so without a bump existing PWA installs see stale sync code. Also add `'./js/sync-manual-dedupe.js'` to the `ASSETS` array since it's a new cached file. |
| `CLAUDE.md` | **modify** (pr-shipper) | Two entries: (1) **Script Load Order** block — insert `sync-manual-dedupe` between `sync-engine` and `sync-auth` so the load order documentation matches the new `index.html` order. (2) **Architecture/file listing** — add a one-line entry for `js/sync-manual-dedupe.js` between the `sync-firestore.js` line and the `backup.js` line describing it as "D-1 placeholder: `ManualDedupe.scan()` surfaces history pairs with matching `(date, duration, type)` across `synced` and `imported` buckets. UI deferred to D-2+." Optionally: extend the `localStorage` keys list (~line 158) with `history_hide_imported` and the `tempo_sync_hydrated_*` key family (though C-1 already added the latter family). |
| `docs/sync-impl/PLAN.md` | **modify** (pr-shipper) | Move D-1 from the pending list (~line 32–33) into the shipped table (line 16) once the PR merges. The shipped table row should match the format of the existing rows: `\| F17 \| Stage D imported bucket + reconcile \| #<PR-number> \|`. Also strike "F17 (Stage D imported bucket)" from the "What's pending" list at line 36. |
| `docs/SESSION-LOG.md` | **modify** (pr-shipper) | New session entry summarizing the audit + implementation + merge. Match the existing entry format. |

**Total: 13 files** (5 modify under code-path: `js/sync-engine.js`,
`js/history.js`, `js/meds.js`, `js/history-ui.js`, `js/tempo-nav.js`. 1
add under code-path: `js/sync-manual-dedupe.js`. 1 add under tests:
`tests/sync-imported-bucket.test.js`. 1 modify under tests:
`tests/index.html`. 1 modify under cached assets: `index.html`. 1
modify under CSS: `css/styles.css`. 1 modify under SW: `sw.js`. 3
documentation: `CLAUDE.md`, `docs/sync-impl/PLAN.md`,
`docs/SESSION-LOG.md`.)

---

## Sync invariants touched

| F# | Description | Status in D-1 |
|----|-------------|---------------|
| F13 | `tempo_sync_state` write gate | **Third flip.** B-3 was the first flipper (push), C-1 the second (hydrate). D-1 flips to `'hydrating'` for the entire 9-step reconcile flow and back to `'ready'` on completion, `'error'` on failure. The new `_reconcileWriteRaw` helpers (mirroring C-1's `_hydrateWriteRaw`) explicitly bypass the gate — they are the privileged-write channel during reconcile. F13 holds: UI-originated writes are blocked; the reconcile path is named-and-explicit. |
| F17 | Stage D imported bucket | **NEW — implemented here.** This is the load-bearing invariant for D-1. The `bucket: 'synced' \| 'imported'` field on history rows is the on-disk shape; `'imported'` is set on every pre-existing row at reconcile time and surfaced as the "Imported (pre-sync)" chip in the history panel. The reconcile orchestrator implements F17 Alternative 2 (separate-bucket imported history) per `docs/CLOUD-SYNC-STRATEGY.md:101`. The complementary `originDeviceId` field on meds records gives the D-2+ ManualDedupe tool a way to distinguish "this Adderall came from device A" vs "this Adderall came from device B" when the two were independently created. |
| F19a | `schemaVersion` refuse-writeback | **Skip-path enforced.** Step 2 of the reconcile (stamp local) MUST call `Schema.isFutureRecord(session)` and skip any future-schema records. Without this, a downlevel client running D-1 would add `bucket: 'imported'` to a `schemaVersion: 2` record and a fields it doesn't recognize get silently fixed when round-tripping back through `addSession`'s spread. The skip is mandatory per Hard rules. Count skipped future records and surface as `result.skippedFutureRecords` for parity with B-3's push (`feat/sync-stage-c-hydrate:js/sync-engine.js:448`) and C-1's hydrate. Audit test #5 enforces. |
| F19b | `__forward` passthrough (top-level unknowns) | **Pass-through.** Cloud records pulled in step 4 carry their `_forwardBag` fields already merged into the wire format (per B-3's upload contract). The merge step writes them verbatim through `_reconcileWriteRaw`, and the post-write `loadAll()` re-collects unknowns into `_forwardBag` per the loader's standard logic. For history, the spread pattern in `addSession` (which D-1 modifies) IS the F19b mechanism — adding `bucket` as a top-level field is safe because legacy/downlevel clients silently ignore unknown top-level fields on read. |

D-1 does NOT touch F1 (per-med doseLog reconcile — that's D-2), F4
(re-derive `lastTakenAt` — already wired in A-1, called by D-2), F6
(phaseLog stamping — already wired in A-1), F8 (distraction tombstones —
E-1), F9 (read-cloud-first guard — B-3), F10 (deviceId/updatedAt
stamping — passes through), F12 (mandatory local backup — B-3 owns; D-1
relies on the user's local data still being intact via local-first
contract), F14 (doseLog cap — passes through), F15 (toast on ≥2-entry
remote — N/A, no merge yet), F16 (±15-min clock-skew clamp — D-2), F18
(per-record meds persistence — passes through), F20 (absent vs
present-but-unknown enum — passes through), F21 (`alarmFired` per-device
— passes through, no engine state in synced stores).

---

## Risks

| Risk | Likelihood | Blast radius | Mitigation |
|------|------------|--------------|------------|
| **Reconcile fails mid-flight; user's local data corrupted** | low | **data-loss (HIGH)** | The reconcile is **idempotent by design** (Headline #5). The tag-stamp step uses `if (bucket == null) set 'imported'` (not unconditional set); the meds analogue uses `if (originDeviceId == null) set deviceId`. Hydrate markers (step 6) and `tempo_sync_stage_d_handoff` clear (step 7) happen ONLY after both local + cloud writes complete. A failed retry resumes at the tag/merge/push loop from scratch with any partial stamps from the previous attempt already in-place — no inconsistency. **No transaction snapshot/rollback needed.** Audit test #4 (idempotency) + #6 (clear-on-success) enforce. |
| **Reconcile is non-idempotent; re-running double-tags records** | low | data-correctness | Same mitigation as Risk #1: the if-absent stamp rule guarantees re-runs are no-ops on already-tagged records. **Audit test #4** runs `reconcileImportedBucket()` twice on the same fixture data and asserts (a) no double-tagging on history rows, (b) `originDeviceId` is NOT re-stamped on already-stamped meds records, (c) `result.counts.history` reflects only the newly-tagged-this-run count, (d) `result.counts.meds` similarly. |
| **`bucket` field accidentally surfaced as a user-selectable tag** | med | UI regression | `History.getAllTags()` at `js/history.js:348` reads from `s.tags` (the user-tag array), never from `s.bucket` (the structural field). The existing tag-filter-bar logic in `js/history-ui.js:147` builds chips from `History.getAllTags()` and the tag-filter at line 191 filters on `session.tags.includes(tag)`. Neither path can surface `'synced'` or `'imported'` as a tag option. **Audit test #11** is a regression test: create a session with `bucket: 'imported'` + `tags: ['focus']`, call `getAllTags()`, assert returned list contains `'focus'` but does NOT contain `'imported'` or `'synced'`. |
| **F19a future-schema records have `bucket` field added by downlevel client** | low | **data-correctness (data-loss-adjacent)** | Step 2 of reconcile calls `Schema.isFutureRecord(session)` and skips any record with `schemaVersion > 1`. Without this skip, a downlevel client running D-1 would mutate a `schemaVersion: 2` record (adding `bucket: 'imported'`); even with the spread pattern preserving other fields, the `_reconcileWriteRaw` path bypasses `Schema.stamp()` so the `schemaVersion: 2` is preserved on disk, but the *act of adding `bucket`* to a record minted on a newer schema means the future-client now sees a known field with downlevel semantics it didn't author. **Audit test #5** inserts a `schemaVersion: 999` row into IDB, runs reconcile, and asserts (a) the row is NOT tagged with `bucket: 'imported'`, (b) the row's `schemaVersion: 999` survives intact, (c) `result.skippedFutureRecords === 1`. |
| **Cloud write succeeds, local write fails (or vice versa); local and cloud diverge silently** | low | data-correctness | The reconcile writes local FIRST (steps 2 + 5a — privileged-write via `_reconcileWriteRaw`), then cloud (step 5b — `SyncFirestore.setDoc`). On local-write failure mid-loop, the catch path transitions `SyncState` to `'error'`, emits `reconcile-complete { ok: false, kind: 'reconcile-error' }`, and leaves both the handoff flag AND hydrate markers absent. On retry, the orchestrator re-stamps + re-merges + re-pushes from scratch — the local-side writes are idempotent (already-stamped records no-op), and the cloud-side writes are idempotent per record id (Firestore `setDoc` overwrites by id). On cloud-write failure mid-loop, hydrate markers are NOT set, so the next boot's auto-trigger sees missing markers and re-runs the entire orchestrator. **Per-record CAS is not required for D-1** because the local stamps are if-absent and cloud writes are full-record setDoc — both sides converge on idempotent re-run. |
| **Meds collisions on `medId` produce duplicate records in UI** | med | UI papercut | When two devices independently create "Adderall" with the user-typed `medId`, the merge in step 5 keeps BOTH records (per spec resolution #3 in the brief). The UI will show both side-by-side in the meds panel; the user sees two "Adderall" cards distinguished only by their dose logs. **Mitigation deferred to ManualDedupe.scan() (D-1 placeholder) + ManualDedupe UI (D-2+).** D-1 ships only `ManualDedupe.scan()` and exposes the surface for the user to find dupes via dev tools / future UI. The audit explicitly accepts this UX cost for D-1's scope — fixing it would require a full dedupe flow which is out-of-scope. Surfacing it here so the implementer doesn't try to auto-merge meds on collision. |
| **`sw.js` `CACHE_NAME` not bumped; users see stale JS** | med | web-bytes | Multiple cached files change in D-1 (`js/sync-engine.js`, `js/history.js`, `js/meds.js`, `js/history-ui.js`, `js/tempo-nav.js`, `css/styles.css`, `index.html`, plus new `js/sync-manual-dedupe.js`). Without a `CACHE_NAME` bump, existing PWA installs would see C-1's `'stopwatch-v71-sync-hydrate'` for one cache cycle and call the OLD `SyncEngine` (which doesn't export `reconcileImportedBucket`). The drawer's "Reconcile now" button click would throw. **Mitigation:** pr-shipper bumps to `'stopwatch-v72-sync-reconcile'` (or similar) AND adds `'./js/sync-manual-dedupe.js'` to `ASSETS`. Sign-off checklist enforces. |
| **Boot-path race: reconcile triggered during C-1's auto-hydrate window** | low | data-correctness | C-1's `_maybeAutoHydrate(user)` at `feat/sync-stage-c-hydrate:js/sync-engine.js:128` short-circuits when `getStageDHandoff() === true`, so once C-1 sets the flag, auto-hydrate stops. D-1's reconcile clears the flag in step 7; **between step 7 and step 9 (state.set('ready')), there is a brief window where auto-hydrate could fire** — but the `_reconcileInFlight` guard + `SyncState.get() === 'hydrating'` precondition on `hydrateFromCloud` both block this. The reconcile holds the gate at `'hydrating'` until step 9. Audit test #10 covers re-entry. |
| **History collision in step 4 merge (same sessionId across devices)** | low | data-correctness | Per brief: device-prefixed sessionIDs (F2: `${deviceId}-${ts}-${counter}`) make collisions vanishingly unlikely. If one does occur (e.g. JSON-import roundtripping a legacy ID that was re-minted to the same value on two devices), the brief specifies "prefer cloud and log a warning." Audit test #12 (optional) covers — implementer may skip if the engine code path raises a `console.warn` and the test is just confirming the visible behavior. |
| **History tag-filter regression** | low | UI regression | Adding a chip element next to `.history-tags` could change the row layout enough to break the existing chip positioning. Visual smoke test required — the ui-wirer manually verifies the row renders cleanly on web + iOS at narrow widths (320 px). No automated test; the chip is a small DOM addition. |
| **Hide-imported toggle hides newly-imported rows the user wanted to keep** | low | UX papercut | The toggle's default state is `'0'` (show imported). Users who want to hide them opt-in. Persisted state means it survives reloads — the engine-implementer must remember to read `localStorage.history_hide_imported` on every `renderHistory()` call (not just on initial mount). Audit test #9 covers persistence. |

**Risk count: 11** — low: 7, med: 4, high: 0. The highest single-event
impact is Risk #1 (mid-flight reconcile failure corrupts local data),
mitigated by the idempotent-re-run rollback strategy per Headline #5.
Risk #6 (meds dup UI) is the most user-visible papercut, accepted for
D-1 scope and addressed by the ManualDedupe.scan() placeholder.

---

## Test scope

### New tests required: `tests/sync-imported-bucket.test.js`

Minimum **12 cases**. All cases stub `window.SyncFirestore`,
`window.SyncAuth`, `window.SyncFlag`, `window.MedsManager`,
`window.History`, `window.Presets`, `window.RecoveryUI` per-case
(mirrors C-1's `sync-hydrate.test.js` pattern). Each test resets
`localStorage` (especially `tempo_sync_stage_d_handoff` + hydrate
markers) and `SyncState` in `before()`.

1. **`bucket` field roundtrips through write → read.** Call
   `History.addSession({ ..., bucket: 'imported' })`, read back via
   `History.getSessions()`, assert the session has `bucket: 'imported'`.
   Then export-import roundtrip via JSON backup
   (`Export.buildBackupData()` then `History.addSession()` re-import),
   assert `bucket` survives.

2. **`bucket` defaults to `'synced'` on `addSession` when caller doesn't
   supply one.** Call `History.addSession({ duration: 1000 })` (no
   `bucket`), assert returned entry has `bucket: 'synced'`. Legacy
   `addSession` callers (the entire app) don't break.

3. **Reconcile tags every pre-existing history row missing `bucket`.**
   Pre-populate two history rows with no `bucket` field. Call
   `SyncEngine.reconcileImportedBucket()`. Assert both rows now have
   `bucket: 'imported'` AND `originDeviceId: History.getDeviceId()`.

4. **Idempotency — running reconcile twice doesn't double-tag.**
   Pre-populate one row with `bucket: 'imported'` and
   `originDeviceId: 'device-A'` (simulating a successful prior
   reconcile). Run reconcile. Assert the row's `bucket` is still
   `'imported'` and `originDeviceId` is STILL `'device-A'` (NOT
   re-stamped to the local device's id). Also assert
   `result.counts.history === 0` (no new tags applied on the second
   run).

5. **Reconcile skips F19a future-schema records.** Insert a row with
   `schemaVersion: 999` (and no `bucket`) into IDB. Run reconcile.
   Assert: (a) the row's `bucket` is still absent; (b) the row's
   `schemaVersion: 999` is intact; (c) `result.skippedFutureRecords ===
   1`; (d) other (non-future) rows ARE tagged.

6. **Reconcile clears `tempo_sync_stage_d_handoff` on success.**
   Pre-set the flag. Run reconcile. After resolve, assert
   `localStorage.getItem('tempo_sync_stage_d_handoff') === null`. Also
   assert all 5 hydrate markers (`tempo_sync_hydrated_rest_log`, `_meds`,
   `_presets`, `_history`, `_all`) are set to `'1'`.

7. **Reconcile leaves the handoff flag set on failure.** Pre-set the
   flag. Stub `SyncFirestore.setDoc` to reject for the history store.
   Run reconcile. Assert: (a) the handoff flag is STILL `'1'`; (b)
   `tempo_sync_hydrated_all` is NOT set; (c) `SyncState.get() === 'error'`;
   (d) result is `{ ok: false, kind: 'reconcile-error' }`. Retry-path
   verified.

8. **Meds reconcile stamps `originDeviceId` on every record missing
   it.** Pre-populate two meds — one with `originDeviceId: 'device-A'`
   (idempotency check) and one without. Run reconcile. Assert: (a)
   `device-A` is preserved verbatim; (b) the other med now has
   `originDeviceId: History.getDeviceId()`; (c) `_forwardBag` on the
   loaded record is NOT populated with `originDeviceId` (KNOWN_MED_KEYS
   regression — see test #9 below).

9. **`originDeviceId` roundtrips through `MedsManager.getState` /
   `loadState` without landing in `__forward`.** Set
   `originDeviceId: 'device-X'` on a med via `_reconcileWriteRaw`, call
   `MedsManager.loadAll()`, read the med back. Assert: (a)
   `med.getOriginDeviceId() === 'device-X'` (or whichever accessor is
   added); (b) `med._forwardBag === null` (no smuggled fields). KNOWN_MED_KEYS
   regression test for Headline #2.

10. **DOM render test (Phase 4 territory but enforced here for
    contract):** A session with `bucket: 'imported'` produces a row
    containing the "Imported (pre-sync)" chip; a session with
    `bucket: 'synced'` does not; a session with absent `bucket` does not.
    Use the existing `tests/index.html` DOM-fixture pattern.

11. **Hide-imported filter toggle correctly filters DOM.** Pre-populate
    two sessions (one `imported`, one `synced`). Set
    `localStorage.history_hide_imported = '1'`. Call `renderHistory()`.
    Assert the DOM has only one row (the `synced` one). Toggle to
    `'0'`, re-render, assert two rows.

12. **History `getAllTags()` ignores `bucket`.** Create a session with
    `bucket: 'imported'` AND `tags: ['focus', 'work']`. Call
    `History.getAllTags()`. Assert: (a) returned array contains
    `'focus'` and `'work'`; (b) does NOT contain `'imported'` or
    `'synced'`. The tag-filter-bar can't accidentally surface bucket
    values as user-selectable tags.

### Optional additional cases (engine-tester may add):

13. **History sessionId collision in merge prefers cloud + logs
    warning.** Pre-populate local with sessionId `dev-X-100-0` and
    cloud with the same id (different data). Run reconcile. Assert:
    (a) local now has the cloud's version; (b) one `console.warn` was
    logged. (Rare in practice — device-prefixed IDs differ — but
    documents the collision rule.)

14. **Meds collision on `medId` keeps BOTH records.** Pre-populate
    local with med id `adderall` (originDeviceId set to local
    device); cloud has med id `adderall` from another device. Run
    reconcile. Assert: (a) both records present after reconcile; (b)
    they have different `originDeviceId` values. (`MedsManager.all()`
    returns 2 entries.)

15. **`reconcileImportedBucket()` re-entry guard.** Stub
    `SyncFirestore.setDoc` to never resolve. Call reconcile (don't
    await). Call again. Assert: the second call returns the SAME
    promise as the first (or the internal `setDoc` invocation count
    stays at 1 for the first record, not 2).

### Tests for `js/sync-manual-dedupe.js`

Minimum **3 cases** (can be in the same `sync-imported-bucket.test.js`
file or a separate `sync-manual-dedupe.test.js` — engine-tester
decides):

- `scan()` returns `[]` when no imported rows exist.
- `scan()` returns one candidate pair when a `synced` session and an
  `imported` session share `(roundedDate, duration, type)`.
- `scan()` does NOT surface pairs across types (cooking ≠ stopwatch).

---

## Manual setup steps

1. **PR #62 (C-1) MUST be merged to `main` before D-1's branch is
   created.** C-1 introduces `tempo_sync_stage_d_handoff`,
   `_hydrateWriteRaw`, and the dead-end drawer copy that D-1 rewires.
   Branching D-1 off unmerged C-1 makes the rebase painful and may
   cause silent merge conflicts in `js/sync-engine.js` (D-1's
   `reconcileImportedBucket` lives directly below C-1's
   `hydrateFromCloud`).

2. **Cross-device "imported rows land on device 2" cannot be fully
   automated.** This requires two browsers signed into the same
   Google account, each with different pre-existing local data. The
   audit's test scope covers the per-device engine contract via
   mocks; the actual cross-device propagation is a manual e2e check.
   Run after merge but before declaring the PR shipped:
   - Browser A: clear all sync state. Add 2 meds + 3 history rows
     locally (no sign-in yet).
   - Enable Cloud Sync → sign in. C-1's Stage D guard catches the
     non-empty local; drawer shows "Reconcile now" button (NOT
     dead-end copy).
   - Tap Reconcile now. After completion, history panel shows the 3
     rows with "Imported (pre-sync)" chips.
   - Browser B (Chrome incognito, fresh): sign in with same Google
     account. C-1's auto-hydrate fires (local is empty). Verify the
     3 imported-tagged rows land alongside whatever else is in
     cloud. The `bucket: 'imported'` field survives the cloud
     roundtrip.

3. **F19a future-record manual smoke is a dev-tools IDB insertion.**
   Open the app → DevTools → Application → IndexedDB →
   `stopwatch_history_db` → `sessions`. Manually add a row with
   `schemaVersion: 999`. Run `SyncEngine.reconcileImportedBucket()`
   from the console. Verify (a) the manually-inserted row's
   `schemaVersion: 999` is intact, (b) it has NO `bucket` field, (c)
   `result.skippedFutureRecords === 1`.

4. **Idempotency manual smoke.** Run
   `SyncEngine.reconcileImportedBucket()` twice in a row from the
   console (e.g. after the cross-device test above). Verify the
   second call returns
   `{ ok: true, kind: 'already-reconciled' }` (or similar
   already-done short-circuit), no records are double-tagged, and
   the imported chips don't multiply in the history panel.

5. **`ManualDedupe.scan()` console verification.** With imported +
   synced rows of the same triple existing, run
   `ManualDedupe.scan()` from the console. Verify it returns an
   array of candidate pairs. (No UI yet; this is the developer-only
   entry point for D-2+.)

6. **Service worker cache verification.** After merge, hard-refresh
   the live app and confirm DevTools → Application → Service Workers
   shows the new `CACHE_NAME` (e.g. `stopwatch-v72-sync-reconcile`).
   Existing PWA installs need a reload to pick up the new version.

---

## Out of scope (explicitly NOT in D-1)

- **D-2: Per-med doseLog reconcile + ±15-min clock-skew clamp.**
  Steady-state per-med dedup (F1) and the non-local-entry clamp (F16)
  are D-2's engine work. D-1's reconcile does NOT touch doseLog
  contents — it preserves them verbatim through the merge.

- **Full ManualDedupe UI.** D-1 ships only `ManualDedupe.scan()` as a
  console-only hook surface. The settings-drawer "Find duplicate
  records" panel that surfaces candidate pairs + lets the user pick a
  winner is deferred to D-2+ (or a follow-up polish PR).

- **E-1 steady-state merge loop.** Periodic push/pull (F3 BFRB stream
  consolidation, F8 distraction tombstones, per-record CAS via
  `runTransaction`) is the entire Stage E. D-1 reconciles ONCE on
  user-initiated trigger; ongoing sync is E-1's territory.

- **F-1 manifest registry.** Still deferred per PLAN.md §F (line 404).

- **iOS-specific reconcile UX.** D-1 changes are byte-equivalent on
  Capacitor iOS — same `SyncFirestore` plugin path, same `Platform.*`
  shims. No iOS-only code lands.

- **Auto-triggered reconcile.** D-1 reconcile fires ONLY on user click
  of the "Reconcile now" button. There is no boot-time auto-trigger —
  the user must explicitly opt in to the reconcile because the
  imported-bucket UX changes the history panel visibly.

- **`bucket` on meds / presets / rest_log records.** Only `History`
  sessions get the `bucket` field in D-1. Meds get `originDeviceId`
  (a different, immutable provenance marker). Presets and rest_log are
  merged LWW without provenance tracking — the spec doesn't require
  bucket-tagging them because (a) presets are user-defined templates
  with no per-user history, (b) rest_log is date-keyed so collisions
  are inherently same-day same-resource.

- **`KNOWN_HISTORY_KEYS` allowlist.** Not added. PLAN.md §D-1's earlier
  wording referenced it; the F19b spread pattern in `history.js`
  makes it unnecessary (Headline #1).

- **Reconcile of cloud-only data into a synced+imported tree.** D-1
  reconciles local-only-data device's view; the inverse case (local
  has data, cloud has different data both authored locally pre-sync)
  surfaces as the merge collision rule in step 4, but the UX of
  showing the user "your phone's history vs your laptop's history" is
  not separately surfaced. The "Imported (pre-sync)" chip is one-way
  — it tags THIS device's pre-sync rows; other devices' rows that
  arrive via cloud are tagged `'synced'` regardless of when they were
  originally authored.

---

## Sign-off checklist (for the implementer)

- [ ] Engine module changes match the affected-files table — no new
      synced-store fields beyond `bucket` (history) and
      `originDeviceId` (meds)
- [ ] Test scope above is covered — minimum 12 cases in
      `tests/sync-imported-bucket.test.js`
- [ ] No re-implementation of `escapeHtml` / `Utils.formatMs` /
      `Platform.*` — the existing helpers handle every UI need
- [ ] `sw.js` `CACHE_NAME` bumped from C-1's
      `'stopwatch-v71-sync-hydrate'` to a fresh version; new
      `'./js/sync-manual-dedupe.js'` added to `ASSETS`
- [ ] All writes to synced stores stamp `deviceId` + `updatedAt` +
      `schemaVersion` via `js/schema.js` — the privileged
      `_reconcileWriteRaw` path bypasses the F13 write gate but does
      NOT bypass `Schema.stamp()` for newly-stamped fields (the
      `originDeviceId` set carries the existing stamp; `bucket: 'imported'`
      tagging preserves the record's existing `schemaVersion` /
      `deviceId` / `updatedAt`)
- [ ] F19a refuse-writeback: future-schema records (`schemaVersion > 1`)
      are NOT tagged with `bucket: 'imported'`; the
      `Schema.isFutureRecord(session)` skip is the explicit guard;
      `result.skippedFutureRecords` is surfaced for parity with B-3 +
      C-1
- [ ] Idempotency: re-running `reconcileImportedBucket()` is a
      complete no-op for already-tagged records (no double-stamping,
      no `originDeviceId` overwrite, no fresh hydrate-marker writes
      that hadn't fired already)
- [ ] C-1's two dead-end copy sites in `js/tempo-nav.js` (lines
      ~485–489 and ~640–647) BOTH replaced with the working
      "Reconcile now" button + handler — neither site is left
      orphaned with the old "Manual reconciliation will ship in a
      follow-up" string
- [ ] `tempo_sync_stage_d_handoff` is cleared on reconcile success
      (step 7) and left set on reconcile failure (so retry resumes)
- [ ] All 5 hydrate markers (`tempo_sync_hydrated_<store>` + `_all`)
      are set on reconcile success — subsequent boots short-circuit
      C-1's auto-hydrate
- [ ] `History.getAllTags()` regression test passes — `bucket` values
      do NOT surface as user-selectable tag-filter chips
- [ ] `js/sync-manual-dedupe.js` ships with minimum 3 test cases
      verifying `scan()` returns `[]`/pair/cross-type-skip; the module
      is loaded in `index.html` after `sync-engine.js`
- [ ] `CLAUDE.md` Script Load Order block updated to include
      `sync-manual-dedupe` between `sync-engine` and `sync-auth`
- [ ] `docs/sync-impl/PLAN.md` D-1 row moved from pending to shipped
      (pr-shipper handles)
- [ ] Manual cross-device e2e smoke run (one browser as Device A,
      one as Device B) confirming imported-tagged rows from Device A
      land on Device B alongside synced rows after sign-in

---

## Next step

Stop here. Commit this audit to the branch as the first commit
(`docs(sync-impl): D-1 audit + imported-bucket spec`). Wait for human
review before writing engine code. The second commit
(`feat(sync): imported bucket + reconcile flow (D-1)`) implements the
changes inventoried above; the ui-wirer's Phase 4 commit handles the
chip + filter + drawer rewire (or pr-shipper may bundle them
depending on size). No scope additions unless the audit review
flags one.
