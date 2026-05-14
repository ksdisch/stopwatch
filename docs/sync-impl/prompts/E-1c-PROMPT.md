# Tempo cloud-sync — implement PR E-1c (Stage E: meds steady-state merge + D-1 retrofit + F15 counter)

You're working on Tempo, a vanilla-JS PWA + Capacitor iOS app. The
cloud-sync implementation plan is at `docs/sync-impl/PLAN.md` on
`main`. Stage 0, Stage A close-out, Stage B (B-1 → B-4), Stage C
(C-1), Stage D (D-1 + D-2), and Stage E sub-PRs E-1a + E-1b are all
shipped (PRs #46–#66, plus the chore PR #67 baking the scope-
expansion mechanism into the engine-implementer agent def).

E-1c is the **third of five Stage E sub-PRs** and the **first PR
that ships real merge logic**.

---

## RESOLUTIONS (Kyle, 2026-05-13 — all 7 TODOs accepted as recommended)

The 7 TODO blocks below describe the original decision surface. Kyle
accepted the auditor's recommended pick for each. **Engine-
implementer reads `docs/sync-impl/audits/E-1c-AUDIT.md` for the
authoritative spec; the deferral language in the TODO sections below
is preserved for historical context but overridden by the audit.**

- **TODO #1 (merge fn signature):** **Pick A** — Self-contained merge
  fn. Calls `SyncFirestore.getCollection` internally. Signature is
  `async merge(localSnapshot) → { ok, count, skipped, remoteArrivals, warnings }`.
  Dispatcher API stable from E-1b.
- **TODO #2 (F13 write gate):** **Pick B** — Dispatcher-wide flip
  around the cycle. `_runMergeCycle` calls `SyncState.set('hydrating')`
  before the per-store loop, restores `'ready'` after.
- **TODO #3 (F15 counter):** **Pick A** — Per-med, per-cycle,
  threshold ≥2 NEW remote entries. Emit `meds-arrival` with
  `{ medId, count }` per qualifying med.
- **TODO #4 (D-1 retrofit):** **Pick A** — Wire in-place at the
  existing comment seam in `js/sync-engine.js:1278-1286`. Replace
  the comment block with the 5-6 line loop.
- **TODO #5 (F19a per-record):** **Pick C** — Pre-filter future-
  schema records in merge fn (`skipped++`) AND keep
  `reconcileDoseLog`'s existing future-schema gate as backup.
- **TODO #6 (test files):** **Pick A** — New file
  `tests/sync-merge-meds.test.js` per PLAN.md spec. E-1d and E-1e
  will follow the same per-store-test-file pattern.
- **TODO #7 (dev flag):** **Pick A** — Confirmed.
  `tempo_sync_steady_state_enabled` stays default-off through E-1c
  + E-1d. E-1e removes the gate.

The audit's affected-files table will codify the exact line targets,
test-case names, and CACHE_NAME bump value.

---

Three things land:

1. **`js/sync-merge-meds.js`** — replace the E-1b throwing stub with
   the real meds-store merge function. Inputs: local snapshot for
   meds + the cloud's `users/{uid}/meds` collection (fetched via
   `SyncFirestore.getCollection`). Output: writes merged records
   back via `SyncFirestore.runTransaction` (E-1b's CAS wrapper). The
   merge calls `MedsManager.reconcileDoseLog` (D-2's per-med helper)
   to collapse cross-device ±15-min duplicates + clamp clock-skewed
   entries.

2. **D-1 reconcile retrofit** — the existing comment seam in
   `js/sync-engine.js:1278-1286` (inside `reconcileImportedBucket`)
   currently reads "E-1 plug-in seam: after `_mergeMeds()` unions
   cloud ∪ local records by `(medId, originDeviceId)`, iterate each
   merged med and call `MedsManager.reconcileDoseLog(med, incoming)`
   …" — replace the comment with the actual implementation. After
   the union step, walk each med and apply the D-2 reconcile helper;
   then call `MedsManager.onMergeComplete(medId)` once per med so
   `lastTakenAt` is re-derived from the merged log tail. No behavior
   change to the surrounding D-1 reconcile flow — this is the
   missing piece D-2 deferred to E-1.

3. **F15 ≥2-entry remote-arrival counter** — when the steady-state
   merge function (`sync-merge-meds.js`) accepts ≥2 NEW remote dose
   entries on a single med during one cycle, emit a `meds-arrival`
   event with `{ medId, count }` payload. B-4's toast subscriber
   (already shipped) listens on this event and renders a "Vyvanse:
   2 doses synced from another device" toast.

**E-1c does NOT** ship: history merge (E-1d), rest_log + presets
merge (E-1e), F3 BFRB stream consolidation (E-1d), F8 distraction
sessionId migration (E-1d), per-store snapshot-level F19a gate
(E-1e), real-time `onSnapshot` listeners (E-3), offline buffer (E-2),
removal of the `tempo_sync_steady_state_enabled` dev flag (E-1e).

E-1c keeps the dev flag default-off; you flip it manually in DevTools
to exercise the merge end-to-end. The flag is removed entirely in
E-1e once all 4 per-store merges have shipped.

---

## TODO #1 — `sync-merge-meds.js` API shape

The E-1b stub at `js/sync-merge-meds.js` documents the forward-
compat surface:

```js
// SyncMergeMeds.merge(snapshot) — applies the cloud-side meds snapshot
//                                  to local state. Returns a per-store
//                                  result `{ ok, count, skipped }`.
```

…but the dispatcher in `_runMergeCycle` calls `module.merge(snapshot[storeKey])`
where `snapshot` is the LOCAL snapshot from `SyncEngine.getSnapshot()`.
For real merge work, the merge function needs both local AND cloud
data. Three signature options:

**(a) Merge function fetches its own cloud data.** Signature:
`async merge(localSnapshot) → { ok, count, skipped, remoteArrivals }`.
The function calls `SyncFirestore.getCollection('users/{uid}/meds')`
internally, fetches cloud records, reconciles, writes back via CAS.
Pros: self-contained; dispatcher API stable; matches D-1's per-store
fetch pattern. Cons: the local snapshot passed in is partly redundant
(merge could call `MedsManager.snapshotForSync()` itself).

**(b) Dispatcher fetches cloud + passes both.** Signature:
`async merge({ local, cloud, deviceId, uid }) → { ok, ... }`. The
dispatcher in `_runMergeCycle` evolves to fetch each store's cloud
collection upfront and pass `{ local, cloud, deviceId, uid }`.
Pros: merge functions are pure (no async fetch); easier to test.
Cons: dispatcher does more work; coupling between dispatcher and
each store's collection path.

**(c) Hybrid — dispatcher passes auth context, merge fetches cloud.**
Signature: `async merge({ localSnapshot, deviceId, uid }) → { ok, ... }`.
Merge function fetches cloud itself via the provided uid. Pros: each
merge function controls its own cloud query (filters, pagination, etc.);
dispatcher stays simple. Cons: minor — same as (a) plus the uid threading.

**Auditor's lean:** **(a)** — keeps E-1b's dispatcher API stable
(`merge(snapshot[storeKey])`). The merge function pulls cloud data
itself via `SyncFirestore.getCollection`. Returns
`{ ok: bool, count: number, skipped: number, remoteArrivals: Map<medId, count>, warnings: [...] }`.
The `remoteArrivals` map feeds the F15 counter check at the end of
the function. Matches the pattern of self-contained per-store merge
functions described in PLAN.md §E-1.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Self-contained merge fn; fetches cloud
  via `SyncFirestore.getCollection` internally.
- **Pick B** — Dispatcher fetches both + passes them.
- **Pick C** — Hybrid — dispatcher passes uid, merge fetches cloud.

---

## TODO #2 — F13 write gate during the merge cycle

E-1b's dispatcher (`_runMergeCycle`) does NOT flip `SyncState` because
the stub merge functions throw before any write attempt. E-1c is the
first PR where merge functions actually write. The F13 contract says
local writes must be gated during the merge cycle so user actions
don't race the merge's CAS-wrapped writes.

**(a) Per-store flip inside merge function.** Each merge function
calls `SyncState.set('hydrating')` at the top of `merge()`, restores
to `'ready'` (or `'error'` on failure) at the bottom. Pros: stores
are self-contained; merge errors in one store don't block writes to
others. Cons: brief window where store A's gate is closed but store
B's is open — user writes to B could race B's pending merge.

**(b) Dispatcher-wide flip around the whole cycle.** `_runMergeCycle`
calls `SyncState.set('hydrating')` before the per-store loop and
restores `'ready'` after all stores finish. Pros: simplest contract
— "during any merge cycle, ALL writes are gated"; matches D-1's
reconcile flow pattern; only 1 flip site to maintain. Cons: a single
slow store gates writes to fast stores.

**(c) Hybrid — store-level flip + cross-cycle guard.** Dispatcher
holds a coarse cross-cycle re-entry latch (`_steadyRunInFlight`,
already exists from E-1b); each merge function manages its own
SyncState flip granularly. Pros: most flexible. Cons: hardest to
reason about; two state machines to keep in sync.

**Auditor's lean:** **(b)** — simplest contract, matches D-1 reconcile.
The dispatcher in `_runMergeCycle` calls `SyncState.set('hydrating')`
before the per-store loop, restores `'ready'` after the loop
finishes (or `'error'` if any store failed AND that failure is
unrecoverable). This is one new line in the dispatcher; E-1c is the
right time to add it because E-1c is the first PR with real writes.

**Kyle, pick before Phase 1:**
- **Pick A** — Per-store flip in merge function.
- **Pick B (recommended)** — Dispatcher-wide flip around the cycle.
- **Pick C** — Hybrid.

---

## TODO #3 — F15 ≥2-entry counter semantics

PLAN.md line 349: "Fires `meds-arrival` event for B-4 toast on ≥2
remote entries." But "remote entry" needs a precise definition.

**Definition options:**

**(a) Per-med, per-cycle.** Count NEW remote doseLog entries (entries
with `entry.deviceId !== localDeviceId` that did NOT exist in local
doseLog before this merge) for each med separately. If any single
med has ≥2, emit `meds-arrival` with `{ medId, count }`. Multiple
meds with ≥2 = multiple events. Matches user intent: "Vyvanse just
got 2 doses synced from my phone."

**(b) Aggregate across all meds.** Sum NEW remote entries across
ALL meds in the cycle. If total ≥2, emit one `meds-arrival` with
`{ totalCount }`. Pros: simpler. Cons: less actionable for the
toast — "2 doses synced" is ambiguous about which med.

**(c) Per-med, threshold = 2 per cycle OR cumulative since last view.**
The B-4 toast surface tracks "unseen" arrivals; the counter increments
even across cycles. Pros: handles slow-typing user case. Cons:
requires persistent state (a new localStorage key for "unseen
arrivals per med"); larger scope.

**Threshold question (≥2 vs ≥1):**

- PLAN.md spec: ≥2. Rationale: a single dose from another device is
  usually expected (e.g., user logged on phone, synced to laptop —
  noise). ≥2 means "the user clearly worked on the other device
  for a while" — worth surfacing.

**Auditor's lean:** **(a)** — per-med, per-cycle, threshold ≥2 NEW
remote entries on a single med. Emit `meds-arrival` event with
`{ medId, count }` payload. B-4's existing subscriber handles toast
batching. The reconcileDoseLog result already gives us the deltas
(its `entries` return is the post-merge union; we compute "new
remote" = `merged.entries.filter(e => e.deviceId !== localDeviceId
&& !local.entries.some(le => le.deviceId === e.deviceId && le.takenAt === e.takenAt))`).

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Per-med, per-cycle, ≥2 NEW remote entries.
- **Pick B** — Aggregate across meds.
- **Pick C** — Per-med, cumulative across cycles (needs new persistence).

---

## TODO #4 — D-1 reconcile retrofit scope

The comment seam at `js/sync-engine.js:1278-1286` documents what to
do: "after `_mergeMeds()` unions cloud ∪ local records by
`(medId, originDeviceId)`, iterate each merged med and call
`MedsManager.reconcileDoseLog(med, incomingEntries)` to collapse
cross-device ±15-min duplicates and clamp clock-skewed entries.
Then assign result.entries onto med.doseLog and call
`MedsManager.onMergeComplete(medId)` once per med."

**(a) Wire in-place at the existing comment seam.** Replace the
comment block at lines 1278-1286 with the actual loop. Each merged
med gets `reconcileDoseLog` called, doseLog reassigned, and
`onMergeComplete(medId)` fired. Pros: smallest blast radius;
matches the seam's documented intent. Cons: D-1 reconcile and
steady-state merge each have their own meds reconcile loop (DRY
violation — but the loops are 5-6 lines each).

**(b) Extract a shared helper.** New private function
`_applyMedsReconcile(mergedMeds, localDeviceId)` that both D-1 and
steady-state call into. Pros: single source of truth. Cons: new
abstraction for ~6 lines of code; bigger PR.

**(c) Defer — leave the comment seam in place, ship steady-state
only.** E-1c ships `sync-merge-meds.js` with the reconcile loop;
the D-1 retrofit stays a comment seam. A follow-up PR retrofits
D-1. Cons: leaves the seam open + violates PLAN.md spec ("E-1c
ships D-1 reconcile retrofit").

**Auditor's lean:** **(a)** — wire in-place. The seam exists
precisely so E-1c can plug in 6 lines without touching surrounding
code. DRY-violation concern is minor (5-6 lines duplicated).
PLAN.md spec is satisfied.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Wire in-place at the existing seam.
- **Pick B** — Extract shared helper.
- **Pick C** — Defer D-1 retrofit to a follow-up.

---

## TODO #5 — F19a future-record handling at the per-med level

Per E-1b's TODO #7 resolution, F19a has three layers:
- **CAS-level** (E-1b, shipped): per-record `runTransaction` refuses
  writeback when remote.schemaVersion > local SCHEMA_VERSION.
- **Per-method** (D-2, shipped): `reconcileDoseLog` returns the
  existing doseLog unchanged when the med is future-schema.
- **Per-store snapshot gate** (E-1e, deferred): the dispatcher
  skips entire future-schema records before passing them to the
  merge function.

For E-1c specifically: when `sync-merge-meds.js` fetches a cloud med
record that's future-schema, what does the merge function do?

**(a) Skip with warning + count in `skipped`.** Don't union into
local; log a structured warning; increment `result.skipped`. The
CAS-level F19a in `runTransaction` would catch a write attempt
anyway, but skipping at read-time is cheaper. Matches D-2's pattern
in `reconcileDoseLog`.

**(b) Pass through to reconcileDoseLog.** Let D-2's per-method gate
handle it — `reconcileDoseLog` already returns the existing log
unchanged for future-schema records. The merge function doesn't
need to know. Cons: still attempts a write via CAS, which then
refuses — wastes a round-trip.

**(c) Both — pre-filter AND rely on D-2's gate as the safety net.**
Merge function pre-filters future records (`skipped++`) before
calling reconcileDoseLog; reconcileDoseLog also handles them as a
belt-and-suspenders measure.

**Auditor's lean:** **(c)** — pre-filter in merge-meds + keep
reconcileDoseLog's existing gate. Saves the round-trip; defensive in
case the merge-meds filter has a bug. The future-store snapshot gate
(E-1e) makes this redundant later but doesn't hurt now.

**Kyle, pick before Phase 1:**
- **Pick A** — Skip with warning + count in `skipped`.
- **Pick B** — Pass through to D-2's gate; rely on CAS to refuse.
- **Pick C (recommended)** — Both — pre-filter + D-2 gate as backup.

---

## TODO #6 — Test scope: new file vs extend existing

PLAN.md line 359 explicitly lists `tests/sync-merge-meds.test.js`
as a new test file for E-1c. E-1b broke from this pattern by
extending existing files (`tests/sync-engine.test.js` +
`tests/sync-uploader.test.js`) per the auditor's lean. For E-1c:

**(a) New file `tests/sync-merge-meds.test.js`.** Matches PLAN.md.
Each future per-store merge (E-1d history, E-1e rest_log +
presets) gets its own test file. Easier to grep history. Cons:
breaks E-1b's "extend existing" pattern.

**(b) Extend `tests/sync-engine.test.js`** — append a new
`describe('SyncMergeMeds — merge')` block alongside the existing
steady-state dispatcher block. Pros: consistent with E-1b.
Cons: `tests/sync-engine.test.js` grows large.

**(c) Extend `tests/meds.test.js`** — since the merge logic delegates
to `MedsManager.reconcileDoseLog`, group the merge tests with the
existing meds tests. Pros: closest to the engine code under test.
Cons: cross-cuts SyncEngine concerns into a meds-engine test file.

**Auditor's lean:** **(a)** — new file per PLAN.md. E-1b's "extend
existing" was right for the scaffold PR (no new per-store engine
code); E-1c onwards adds real per-store merge engines, each deserving
its own test file. E-1d and E-1e will follow the same pattern.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — New file `tests/sync-merge-meds.test.js`.
- **Pick B** — Extend `tests/sync-engine.test.js`.
- **Pick C** — Extend `tests/meds.test.js`.

---

## TODO #7 — Confirm dev-flag carryover (no decision needed; just confirm)

Per E-1b's TODO #4 resolution, `tempo_sync_steady_state_enabled`
is a default-off dev flag that gates the steady-state auto-start.
E-1e removes the flag entirely so the loop runs by default once
all 4 per-store merges have shipped.

**E-1c keeps the flag.** Engine-tester verification + Kyle's manual
end-to-end test require flipping the flag in DevTools, calling
`SyncEngine.startSteadyState()`, observing one cycle, then
`stopSteadyState()`. The flag stays in place through E-1c + E-1d;
E-1e flips the default to on (or removes the gate).

- **Pick A (recommended)** — Confirmed. E-1c does NOT touch the flag.
- **Pick B** — Override (specify).

---

## Approach + file list (after Kyle resolves TODOs 1–7)

The audit will codify this. Provisional shape based on the auditor's
recommended picks:

**Files modified:**
- `js/sync-engine.js` — Wire the F13 write gate around `_runMergeCycle`
  (Pick B from TODO #2). Replace the comment seam at lines 1278-1286
  with the actual D-1 reconcile retrofit loop (Pick A from TODO #4).
- `js/sync-merge-meds.js` — Replace the E-1b stub body with the real
  implementation: pre-filter future-schema records (Pick C from
  TODO #5); fetch cloud collection via `SyncFirestore.getCollection`;
  union with local; per-med call `MedsManager.reconcileDoseLog`;
  write back via `SyncFirestore.runTransaction` (E-1b's CAS); count
  per-med remote arrivals; if any med hits ≥2, emit `meds-arrival`
  via `SyncEngine.emit` (Pick A from TODO #3).

**Files added:**
- `tests/sync-merge-meds.test.js` — New test file per Pick A from
  TODO #6. Cases: append-merge dedup; LWW resolves to higher
  `updatedAt`; CAS aborts on stale schemaVersion; refuse-writeback
  on future records preserves on-disk state; merge is idempotent;
  F15 ≥2-entry threshold fires `meds-arrival` event; F13 write gate
  blocks user writes during the cycle.

**`sw.js` `CACHE_NAME` bump:** Yes — E-1c modifies `js/sync-engine.js`
+ `js/sync-merge-meds.js` (both cached web files). Bump from
`'stopwatch-v75-e1b-steady-state-scaffold'` →
`'stopwatch-v76-e1c-meds-merge'` (or similar; pr-shipper finalizes).

**`index.html` `<script>` tags:** No new files added — E-1c only
modifies `sync-merge-meds.js` (already loaded via E-1b's tag).

**`tests/index.html`:** Add a new `<script src="sync-merge-meds.test.js"></script>`
tag (assuming Pick A on TODO #6).

---

## Hard rules (orchestrator + subagents read this)

- **Audit before code.** Phase 1 = sync-auditor → produces
  `docs/sync-impl/audits/E-1c-AUDIT.md`. PAUSE for Kyle to review
  audit before Phase 2 fires.
- **Phase 4 ui-wirer SKIPPED.** E-1c's affected-files table contains
  zero UI files. Phase 3 → Phase 5 directly.
- **All writes to synced stores stamp `deviceId` + `updatedAt` +
  `schemaVersion`** via `js/schema.js` helpers. E-1c's merge function
  writes meds records; each write goes through CAS which honors the
  stamping helpers via the record envelope.
- **`pr-shipper` PAUSES before push.** Kyle's standing rule.
- **F-invariant guardrails** (from `docs/CLOUD-SYNC-STRATEGY.md` v2.0):
  - F1 (±15-min cross-device dedup) — `reconcileDoseLog` handles
    inside D-2's helper.
  - F4 (`lastTakenAt` re-derive) — `MedsManager.onMergeComplete`
    handles after each med's doseLog is reassigned.
  - F13 (write gate) — dispatcher-wide flip (Pick B from TODO #2).
  - F14 (1000-entry cap) — `reconcileDoseLog` enforces.
  - F15 (≥2-entry remote-arrival toast) — this PR's third deliverable.
  - F16 (clock-skew clamp) — `reconcileDoseLog` handles.
  - F19a CAS-level — E-1b's CAS wrapper enforces (per-record).
  - F19a per-method — D-2's `reconcileDoseLog` enforces.
  - F19a per-store snapshot gate — E-1e ships (deferred).
  - F21 (alarmFired exclusion) — passes through; no new envelope
    fields added by E-1c.

---

## After E-1c merges

- **E-1d** — History steady-state merge. F3 BFRB consolidation. F8
  distraction sessionId-keyed. Sessions append-merge dedup by `id`;
  note/tags LWW per-field; phaseLog dedup by `(deviceId, phaseStartedAt)`.
- **E-1e** — Rest_log + presets steady-state merge. Per-store F19a
  snapshot gate. Remove the `tempo_sync_steady_state_enabled` dev
  flag (so the loop runs by default).
- **E-2** — Offline buffer.
- **E-3** — Real-time `onSnapshot` listeners.

---

## Branch + commit conventions

- **Branch:** `feat/sync-stage-e-meds-merge`
- **PR title:** `feat(sync): meds steady-state merge + D-1 retrofit + F15 counter (E-1c)`
- **Commit type prefix:** `feat` for the main implementation, `docs`
  for the audit + SESSION-LOG entries.

---

**Kyle: please resolve TODOs 1–7 before saying "Go" so the audit
reflects your picks. The auditor's recommended picks are documented
inline (Pick A or B depending on the TODO); you can accept all
recommended picks with a one-line "all recommended" or override
individually.**
