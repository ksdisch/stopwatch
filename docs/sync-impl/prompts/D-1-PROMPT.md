# Tempo cloud-sync — implement PR D-1 (Stage D: imported bucket + reconcile)

You're working on Tempo, a vanilla-JS PWA + Capacitor iOS app. The
cloud-sync implementation plan is at `docs/sync-impl/PLAN.md` on
`main`. Stage 0 + Stage A close-out + Stage B (push + auth + uploader
+ toast scaffold) are shipped (PRs #46–#61). Stage C (Device B fresh
hydrate) shipped as PR #62 — **this must be merged to `main` before
D-1's audit fires.** C-1 introduces both Stage D handoff entry points
that D-1 has to satisfy, plus the dead-end UI copy D-1 has to rewire.

## Required reading (before any code)

1. `docs/sync-impl/PLAN.md` — find the `### D-1` section (around line
   283). That is your spec, with the spec-vs-code mismatches resolved
   below.
2. `docs/CLOUD-SYNC-STRATEGY.md` v2.0 — Stage D rationale ("Device B
   with existing standalone data"), F17 Alternative 2 (imported
   bucket).
3. `docs/sync-impl/audits/C-1-AUDIT.md` — Stage C audit. C-1 sets the
   `tempo_sync_stage_d_handoff` flag at two sites; D-1 owns the
   reconcile flow consumed from both.
4. `js/sync-engine.js` (on main after C-1 merges):
   - Lines around `_maybeAutoHydrate` (~133) — auto-hydrate is gated
     by `getStageDHandoff()`; clearing the flag is part of D-1's exit
     criteria.
   - Lines around 398–416 — B-3's `pushSnapshot` read-cloud-first
     `setStageDHandoff()` call site.
   - Lines around 712–733 — C-1's `hydrateFromCloud` non-empty-local
     `setStageDHandoff()` call site.
   - C-1's `_hydrateWriteRaw` privileged-write helpers on
     `MedsManager` / `History` / `Presets` / `RecoveryUI` — D-1's
     reconcile-write step mirrors this pattern.
5. `js/tempo-nav.js` lines ~485–489 and ~640–647 — dead-end drawer
   status copy "Cloud has existing data. Manual reconciliation will
   ship in a follow-up." D-1 replaces this with a "Reconcile now"
   button + flow.
6. `js/history.js`:
   - `addSession` (~line 213) uses the F19b spread pattern with
     overlay defaults (`tags`, `note`, etc.). D-1 adds `bucket` as
     another overlay field — see "Spec resolutions" #1 below.
   - `getDeviceId()` is the source of `originDeviceId` values.
7. `js/meds.js` lines 19–28 + 217–248 — `KNOWN_MED_KEYS` /
   `__forward` pattern. D-1 adds `originDeviceId` to the set so it
   roundtrips cleanly.
8. `js/history-ui.js` lines ~150–166 — existing `tag-filter-bar`
   pattern that the "Imported (pre-sync)" filter mirrors.

## What this PR ships

The reconcile flow that C-1's handoff guard stops short of: tag every
pre-existing local record as "imported (pre-sync)", pull cloud,
merge, push the combined snapshot, surface the imported entries in
the history panel with a hide/show filter, and replace C-1's
dead-end drawer copy with a working "Reconcile now" button.

### Engine (`js/sync-engine.js` + `js/history.js` + `js/meds.js`)

**`js/history.js`:**
- Add `bucket: 'synced' | 'imported'` to session records.
- `addSession` accepts an optional `bucket` parameter; the spread +
  overlay already passes through the field if the caller supplies
  it. Add an explicit overlay default in the entry literal so new
  writes default to `'synced'`:
  ```js
  bucket: session.bucket || 'synced',
  ```
  (No `KNOWN_HISTORY_KEYS` allowlist — F19b's spread pattern is
  lossless without one.)
- `snapshotForSync` needs no change — sessions are stored opaque, so
  `bucket` rides along automatically.

**`js/meds.js`:**
- Add `originDeviceId` to `KNOWN_MED_KEYS` so it roundtrips through
  `getState` / `loadState` and never lands in `__forward`.
- No change to existing `deviceId` (F10) stamping behavior.
  `originDeviceId` is a separate, immutable field set once at
  reconcile time; `deviceId` continues to update on every write.

**`js/sync-engine.js`** — new privileged reconcile function:
- New `reconcileImportedBucket()` (exposed via the module's return
  object). Pull-merge-push semantics in one orchestrated call,
  bypassing both B-3's read-cloud-first guard AND C-1's
  non-empty-local guard via the same privileged-write path C-1
  introduced for hydrate. Steps:
  1. `SyncState.set('hydrating')` — block concurrent engine writes
     (mirror C-1's pattern).
  2. **Stamp local (idempotent):**
     - For each history row: if `bucket` field is absent, set
       `bucket: 'imported'` and `originDeviceId: getDeviceId()`. If
       `bucket` is already set, leave the row alone. Skip rows where
       `Schema.isFutureRecord(session)` is true (F19a refuse-writeback).
     - For each med record: if `originDeviceId` is absent, set
       `originDeviceId: getDeviceId()`. Idempotent — don't overwrite
       existing values.
     - Use `_reconcileWriteRaw` privileged writes (new method on
       `MedsManager` / `History`, modeled on C-1's
       `_hydrateWriteRaw`) so the `SyncState.canWrite()` gate doesn't
       block these stamps.
  3. **Pull cloud per-store** in the same dependency order as C-1's
     hydrate: rest_log → meds → presets → history. Reuse C-1's
     `_pullCloudStore` helper.
  4. **Merge** — for each store, union (cloud records ∪ tagged local
     records). Collisions on record id resolve as follows:
     - **history (`sessionId`):** No collision expected in normal
       case (device-prefixed IDs differ). If a collision does occur,
       prefer cloud and log a warning — the local copy was already
       under sync. Tagged-imported rows have device-prefixed IDs that
       won't collide with other devices' cloud rows.
     - **meds (`medId`, user-defined):** Collisions ARE possible (two
       devices independently created "Adderall"). Keep BOTH records,
       distinguished by `originDeviceId`. The user can later use
       `ManualDedupe.scan()` to surface candidate pairs and pick a
       winner.
     - **rest_log (date-keyed):** Collisions resolve LWW via
       `updatedAt`. D-2 will refine; D-1 ships the simple rule.
     - **presets (`presetId`):** Same as rest_log — LWW via
       `updatedAt`.
  5. **Write combined snapshot** — privileged writes to local IDB /
     localStorage (mirror `_hydrateWriteRaw`) AND `setDoc` writes to
     Firestore in the same dependency order. Per-record CAS where
     supported by the underlying store (re-use whatever B-3 / C-1
     already wired).
  6. **Set all 5 hydrate markers** (`tempo_sync_hydrated_rest_log`,
     `_meds`, `_presets`, `_history`, `_all`) so subsequent boots
     don't re-trigger hydrate.
  7. **Clear `tempo_sync_stage_d_handoff`** so future boots don't
     gate on it.
  8. `SyncState.set('ready')`.
  9. Emit `reconcile-complete` event with `{ ok, kind, counts }` —
     `kind: 'reconciled' | 'reconcile-error' | 'skipped'`.
- Emit `reconcile-progress` events during step 3–5 (mirror C-1's
  `hydrate-progress { stage, store }` shape).
- Failure handling: on any step failure, `SyncState.set('error')`,
  emit `reconcile-complete { ok: false, kind: 'reconcile-error' }`,
  leave the handoff flag set so the user can retry. Partial-progress
  hydrate markers (set in step 6) are NOT written until success.

### Tests (`tests/sync-imported-bucket.test.js`)

New file under `tests/` (don't forget to register it in
`tests/index.html`):
- `bucket` field roundtrips through `History.addSession` →
  `getSessions` → JSON backup export → import.
- `bucket` defaults to `'synced'` on `addSession` when caller doesn't
  supply one.
- Reconcile tags every pre-existing history row missing `bucket` with
  `bucket: 'imported'` + `originDeviceId: getDeviceId()`.
- Reconcile leaves rows that already have `bucket: 'synced'` alone
  (idempotency for post-D-1 records authored between B-3 push and
  reconcile).
- Reconcile is idempotent: running twice doesn't double-tag, doesn't
  re-stamp `originDeviceId` on already-tagged records.
- Reconcile skips rows where `Schema.isFutureRecord(session)` is true
  (F19a refuse-writeback regression test).
- Reconcile clears `tempo_sync_stage_d_handoff`.
- Meds reconcile stamps `originDeviceId` on every record missing it;
  preserves existing values when present.
- `originDeviceId` roundtrips through `MedsManager.getState` /
  `loadState` without landing in `__forward` (KNOWN_MED_KEYS
  regression test).
- DOM render test: `bucket: 'imported'` rows show the "Imported
  (pre-sync)" chip; `bucket: 'synced'` and absent-`bucket` rows do
  not.
- Hide-imported filter toggle correctly filters DOM.
- History tag filter ignores `bucket` (it must not surface
  `synced` / `imported` as user-selectable tags). Regression test
  against `getAllTags` / the tag-bar logic at `js/history-ui.js:150`.

### UI wire-up (Phase 4 ui-wirer)

**`js/history-ui.js`:**
- Add "Imported (pre-sync)" badge/chip on session rows where
  `bucket === 'imported'`. Visually distinct from user tags
  (subdued/outlined chip).
- Add a hide/show toggle in the filter bar at the same level as the
  tag-filter chips. Persist toggle state to localStorage key
  `history_hide_imported` ('0' | '1', default '0').

**`js/tempo-nav.js`:**
- At both call sites (~lines 485–489 and ~640–647), replace the
  dead-end "Manual reconciliation will ship in a follow-up." copy
  with a "Reconcile now" button + handler that calls
  `SyncEngine.reconcileImportedBucket()`.
- Show progress while running. Re-use C-1's
  `#sync-hydrate-overlay` if appropriate; or render the progress
  inline in the drawer status row.
- On success, swap to "Imported X past sessions. Synced ✓"
  (X from `result.counts.history`). On failure, "Reconcile failed
  (kind): message" with a Retry button (calling the same function).

**`index.html`:**
- Drawer markup for the Reconcile now button (likely inside the
  existing Cloud Sync section that B-2 added).

**`css/styles.css`:**
- Style the imported-bucket badge (subdued color, outlined, smaller
  than user tags).
- Style the hide/show filter toggle (mirror tag-filter chip).
- Style the Reconcile now button (use existing settings-drawer
  button styles).

### Placeholder for D-2+

**New `js/sync-manual-dedupe.js`** (flat path, not `js/sync-impl/`,
to match existing `js/sync-*.js` convention):
- Single IIFE module exposing `window.ManualDedupe = { scan }`.
- `ManualDedupe.scan()` returns candidate pairs — for now, history
  rows with same `(roundedDate, duration, type)` across `synced` and
  `imported` buckets. Returns `Array<{ a, b, similarity }>` where
  `a` / `b` are session records and `similarity` is a numeric score
  (0–1). UI is deferred.
- Add `<script src="js/sync-manual-dedupe.js"></script>` to
  `index.html` after `sync-engine.js`.
- Add a one-liner under the SyncEngine entry in CLAUDE.md's "Script
  Load Order" + a file-level entry in CLAUDE.md's architecture
  block.
- Tests: minimal coverage — `scan()` returns empty when no imported
  rows exist; returns candidate pairs when an `(imported, synced)`
  match exists; doesn't surface pairs across types.

## Hard rules

- **Audit before code.** First commit on the branch is
  `docs/sync-impl/audits/D-1-AUDIT.md` listing affected files +
  risks + test scope. STOP after the audit and wait for review.
- **Local-first stays a hard contract.** If reconcile fails
  mid-flight, the user's local data must not be corrupted. The flag
  stays set, hydrate markers stay unset, and the operation is
  retryable. No partial bucket-tag stamps if step 4+ fail (rollback
  via in-memory transaction — or accept idempotent re-run as the
  cheap fix; document the choice in the audit).
- **F13 write gate.** `tempo_sync_state` flips to `'hydrating'` for
  the entire reconcile and back to `'ready'` on completion. Block
  concurrent engine writes via the existing `canWrite` gate.
- **F19a refuse-writeback preserved.** Future-schema session records
  (`schemaVersion > 1`) must NOT have `bucket` added by a downlevel
  client — the stamping loop calls `Schema.isFutureRecord(session)`
  and skips those rows. Count them and surface as
  `result.skippedFutureRecords` for parity with B-3 / C-1 output.
- **Service worker cache bump.** `sw.js` `CACHE_NAME` gets bumped
  in the same PR per repo rule (pr-shipper handles).
- **Web GitHub Pages deploy stays byte-equivalent** except for the
  intentional changes. Same `git push` → static host flow.

## IMPORTANT: C-1 (PR #62) must merge to `main` before D-1 fires

C-1 introduces:
- `tempo_sync_stage_d_handoff` localStorage flag set at two sites in
  `sync-engine.js` that D-1's reconcile clears.
- `_hydrateWriteRaw` privileged-write pattern that D-1 mirrors as
  `_reconcileWriteRaw`.
- Dead-end drawer copy at two call sites in `tempo-nav.js` that D-1
  rewires.
- 21 new tests (358 total baseline on C-1 vs 337 on main).

Branch D-1 off freshly-merged `main`. Rebase pain is non-trivial if
D-1 branches off unmerged C-1.

## Deliverable

Branch `feat/sync-stage-d-imported-bucket`, PR against `main`.
Commits:

1. `docs(sync-impl): D-1 audit + imported-bucket spec` — audit doc
   with affected-files table + risks + test scope. STOP HERE.
2. After greenlight: `feat(sync): imported bucket + reconcile flow
   (D-1)` — engine + tests + UI in one commit, or split engine vs
   UI if size warrants. pr-shipper decides at Phase 5.

PR title once both commits land:
`feat(sync): Stage D imported-bucket reconcile (D-1)`.

## Manual verification (after merge — pre-D-2 smoke)

Hard to fully simulate without two devices. Minimum manual checks:

1. Fresh-install browser (Chrome incognito with localStorage + IDB
   cleared) → add a local med + log a couple of doses + create a
   stopwatch session that lands in history. Don't sign in to sync
   yet.
2. Enable Cloud Sync → sign in with Google. C-1's Stage D guard
   should catch the non-empty local and route to handoff (overlay
   should NOT fire; drawer should show the new "Reconcile now"
   button instead of the dead-end copy).
3. Tap Reconcile now. Progress indicator runs. On completion,
   history panel shows all past rows with "Imported (pre-sync)"
   chips; toggle the filter to hide/show them.
4. On a second browser signed into the same Google account, verify
   the imported-tagged rows from device 1 land alongside synced
   rows in cloud. (D-2 + E-1 will handle steady-state merge.)
5. F19a skip-path: manually insert a `schemaVersion: 999` row into
   IDB (via dev tools), run reconcile, verify the row is NOT
   tagged with `bucket: 'imported'`. `result.skippedFutureRecords`
   should be 1.
6. Idempotency: run reconcile a second time on the same data,
   verify no double-tagging and no fresh `originDeviceId`
   re-stamps.

## After D-1

D-1 ships the imported-bucket + reconcile UX. The remaining Stage D
work is D-2 (per-med doseLog reconcile + ±15-min clock-skew clamp,
engine-only). After D-2, Stage E (steady-state merge loop) is the
final rock toward "live, bidirectional, bug-free."
