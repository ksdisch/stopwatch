# Tempo cloud-sync — implement PR E-1e (Stage E: final sub-PR — sync goes live)

You're working on Tempo, a vanilla-JS PWA + Capacitor iOS app. The
cloud-sync implementation plan is at `docs/sync-impl/PLAN.md` on
`main`. Stage 0, Stage A close-out, Stage B (B-1 → B-4), Stage C
(C-1), Stage D (D-1 + D-2), and Stage E sub-PRs E-1a + E-1b + E-1c
+ E-1d + E-1d-f3 + E-1d-f8 are all shipped (PRs #46–#71, plus chore
PR #67). 501 engine tests pass on `main` at commit `d0ece5c`.

E-1e is the **SEVENTH AND FINAL Stage E sub-PR**. It is the
milestone PR: after this lands, steady-state cloud sync runs by
default for any user with `tempo_sync_enabled='1'` (the master flag
on the existing Cloud Sync section of the settings drawer). The
"fully cloud-synced bug-free between laptop and phone" outcome that
opened this initiative becomes real once Kyle flips the master
flag on both devices.

---

## What E-1e ships (5 deliverables in one PR)

1. **Real `js/sync-merge-rest-log.js`** — replace the throwing
   stub body (4 lines today) with the per-day sleep LWW + naps
   append-merge dedup by `(deviceId, startedAt)`. Mirrors
   E-1c/E-1d's self-contained merge pattern (fetches cloud
   itself, per-record CAS writeback). Per PLAN.md §E-1 line 359.
2. **Real `js/sync-merge-presets.js`** — replace the throwing
   stub body with full-record LWW by `(id, updatedAt)` + tombstone
   delete propagation. Adds `deletedAt: null` to preset records
   (schema extension — see TODO #2). Per PLAN.md §E-1 line 360.
3. **Per-store snapshot-level F19a gate** — in
   `_runMergeCycle()` dispatcher in `js/sync-engine.js`, filter
   local snapshot records whose `schemaVersion > SCHEMA_VERSION`
   BEFORE passing them to each per-store merge function. Per
   E-1b TODO #7 deferral.
4. **Remove `tempo_sync_steady_state_enabled` dev flag** —
   delete the `STEADY_STATE_ENABLED_KEY` constant + the
   `_isSteadyStateEnabled()` function + the gate check at
   `js/sync-engine.js:1689` inside `startSteadyState()`. After
   this lands, the steady-state timer arms unconditionally
   (gated only by sync-flag + signed-in user + SyncState).
5. **Auto-invoke `startSteadyState()` from `SyncEngine.init()`** —
   per E-1b TODO #4 carryover. Mirror the existing
   `_maybeAutoHydrate(user)` pattern: gate on (sync flag on +
   signed-in user + all-hydrated marker + not Stage D handoff)
   and fire `startSteadyState()` either at init() time (if
   cold-boot has the hydrate marker already) or after the first
   hydrate completes.

Plus:

- **New tests** — `tests/sync-merge-rest-log.test.js` +
  `tests/sync-merge-presets.test.js` (each ~12-16 cases), plus
  ~6-10 new cases extending `tests/sync-engine.test.js` for the
  dispatcher F19a gate + auto-invoke + flag-removal.
- **`sw.js` CACHE_NAME bump** — v79 → v80
  (`'stopwatch-v80-e1e-stage-e-complete'` or similar).
- **`tests/index.html`** — 2 new `<script>` tags for the new
  test files.
- **No new `js/*.js` script tags in `index.html`** — both merge
  modules already have tags (added in E-1b's scaffold PR).
- **Phase 4 ui-wirer fires** — but only as a SMOKE check
  (verify the main app boots clean, no console errors, SyncState
  transitions cleanly, no Cloud-Sync UI regressions). Real
  end-to-end Firestore connection is Kyle's manual two-device
  test post-merge (see TODO #8).

---

## RESOLUTIONS (Kyle, 2026-05-14 — all 8 TODOs resolved as auditor-recommended)

All 8 TODOs resolved as auditor-recommended (Pick A across the
board, with Pick A on TODO #4 meaning "dispatcher + preserve
per-merge-fn cloud gates"). **Engine-implementer reads
`docs/sync-impl/audits/E-1e-AUDIT.md` for the authoritative spec;
the deferral language in the TODO sections below is preserved for
historical context but overridden by the audit.**

- **TODO #1 (scope split):** **Pick A** — One PR. All 5 deliverables
  ship in `feat/sync-stage-e-complete` together.
- **TODO #2 (presets `deletedAt` + SCHEMA_VERSION):** **Pick A** —
  Keep `Schema.SCHEMA_VERSION = 1`. `deletedAt` is an additive
  optional field; F19b `__forward` covers downlevel safety; absence
  of the field IS the "alive" state.
- **TODO #3 (tombstone UI filter location):** **Pick A** — Filter
  inside `Presets.getAll()` engine-level. Add a sibling
  `Presets._getAllIncludingTombstones()` internal helper for the
  sync snapshot adapter so tombstones still propagate to cloud.
- **TODO #4 (per-store F19a gate location):** **Pick C** —
  Dispatcher-level snapshot gate + preserve the existing per-merge-fn
  cloud-side gates. Two layers cover different vectors.
- **TODO #5 (flag removal mechanics):** **Pick A** — Delete the
  `STEADY_STATE_ENABLED_KEY` constant + `_isSteadyStateEnabled()`
  function + the gate check at line 1689 entirely. No dead code.
- **TODO #6 (auto-invoke trigger):** **Pick C** — Both. Helper
  `_maybeAutoStartSteady(user)` gates on all 4 conditions (signed in
  + flag on + all-hydrated + not Stage D handoff). Called from both
  `init()` (cold-boot with marker already set) and
  `_maybeAutoHydrate()`'s post-hydrate `.then()` (first sign-in
  completed hydrate). Idempotent — `startSteadyState`'s existing
  `if (_steadyTimer != null) return;` guard makes double-invocation
  safe.
- **TODO #7 (test file structure):** **Pick A** — Two new test files
  + `tests/sync-engine.test.js` extension. Mirrors E-1c/d/d-f3/d-f8
  precedent.
- **TODO #8 (Phase 4 ui-wirer scope):** **Pick A** — Smoke check
  only (boot path, console clean, SyncState transitions, drawer UI,
  master flag toggle). Real E2E Firestore validation is Kyle's
  manual two-device test post-merge.

The audit's affected-files table will codify the exact line targets,
test-case names, and CACHE_NAME bump value.

---

## What's true about the codebase E-1e edits

**`js/sync-merge-rest-log.js` (19 lines, throwing stub at lines 10-12).**
The real merge function will mirror `js/sync-merge-bfrb.js`'s
self-contained pattern: feature-detect (SyncFlag / SyncAuth /
SyncFirestore / RecoveryUI), `await SyncFirestore.getCollection('users/' + uid + '/rest_log')`,
per-record pre-filter on `Schema.isFutureRecord(data)`, merge by
`YYYY-MM-DD` key. **For each date key:**
- `sleep` (LWW): pick whichever side has the higher
  `sleep.updatedAt`. Today's `RecoveryUI.setSleep` writes a flat
  `{hours, quality?}` object without `updatedAt` — engine-implementer
  must add the stamp (via `Schema.stamp(sleep)`) at the
  `RecoveryUI.setSleep` call site OR rely on the wrapper-envelope's
  `updatedAt`. The audit will pin which.
- `naps` (append-merge dedup by `(deviceId, startedAt)`): union
  arrays. Today's nap entries are `{startedAt, durationMs, endedEarly?}`
  without `deviceId` — engine-implementer adds `Schema.stamp(nap)` at
  the `RecoveryUI.addNap` call site so naps carry envelope stamps.

**`js/sync-merge-presets.js` (19 lines, throwing stub at lines 10-12).**
Mirrors `js/sync-merge-history.js`'s self-contained merge: fetch
cloud → F19a pre-filter → union by `id` → full-record LWW by
`updatedAt` per record → CAS writeback. **Tombstones:** if cloud's
copy has `deletedAt: <timestamp>` AND local's copy is intact (no
deletedAt or deletedAt < cloud's), local's copy gains the same
`deletedAt`. If local's copy was deleted (deletedAt set) and cloud's
is intact, the CAS writeback pushes local's deletedAt to cloud.
`Presets.remove(id)` today calls `saveAll(presets.filter(...))` — a
hard delete that leaves no tombstone. **E-1e must rewrite
`Presets.remove(id)`** to set `target.deletedAt = Date.now()` +
`Schema.stamp(target)` instead of filtering out, then call `saveAll(presets)`.
**UI filter location** is TODO #3.

**`_runMergeCycle()` dispatcher in `js/sync-engine.js:1540-1682`** —
the F13 write-gate flip wraps the per-store loop already (E-1c work,
verified at lines 1572-1576 + 1664-1670). The per-store snapshot
F19a gate slots in BEFORE the `for (const { key } of SYNCED_STORES)`
iteration. **Proposed shape:**
```
for (const { key, adapter } of SYNCED_STORES) {
  const snapshot = await Promise.resolve(adapter.read());
  // Filter local snapshot records whose schemaVersion > SCHEMA_VERSION
  // before passing to merge fn. Defensive belt-and-suspenders against
  // future-schema records leaking from JSON import / etc.
  const filteredSnapshot = _filterFutureRecordsInSnapshot(key, snapshot);
  const result = mod.merge(filteredSnapshot);
  ...
}
```
Today's merge functions all pass `null` to `merge()` and re-read
internally. With the snapshot gate in place, **engine-implementer
must decide** whether to: (a) keep the existing self-contained
pattern and have the gate be a no-op pass-through (the local
snapshot gets filtered, but merge fns don't read it), or (b) actually
use the filtered snapshot inside each merge fn (refactor each merge
fn to accept a snapshot arg). Lean: **(a)** — preserves the E-1c/d
contract that merge fns are self-contained; the gate is the new
defensive layer at the boundary even if today's merge fns don't
consume the local snapshot. The gate's value comes from logging
skipped records for observability, not from blocking local-side
data.

**Flag removal mechanics.** Grep confirms `STEADY_STATE_ENABLED_KEY`
+ `_isSteadyStateEnabled` live only inside `js/sync-engine.js` (no
external callers). Safe to delete. The localStorage key
`tempo_sync_steady_state_enabled` itself will become an
unrecognized-by-anyone localStorage entry on existing dev installs —
harmless, no cleanup PR needed.

**Auto-invoke from `init()`.** Today's `SyncEngine.init()` subscribes
to `SyncAuth.onAuthChange((user) => _maybeAutoHydrate(user))`. The
analogous pattern for steady-state is to extend
`_maybeAutoHydrate(user)` (or add a sibling `_maybeAutoStartSteady(user)`)
that gates on: signed in + flag on + `isAllHydrated() === true` +
`!getStageDHandoff()`. Fires `startSteadyState()` after the gate
passes. **Trigger point** is TODO #6.

---

## TODO #1 — Scope split

E-1e is doing 5 things at once (real rest_log merge + real presets
merge + per-store F19a gate + flag removal + init auto-invoke).
PLAN.md §E-1 line 46 says "one PR (E-1e)" but doesn't formally
preclude splitting.

**(a) One PR (recommended).** All 5 items ship together. Each piece
is small individually; flag removal + init auto-invoke are
co-dependent (flipping the default on without auto-invoke leaves
steady-state armed but never started). Touching one merge fn per
PR (E-1e-rest, E-1e-presets, E-1e-final) triples the audit/test
overhead with no real risk reduction.

**(b) Two PRs: E-1e (merges) + E-1f (gate + flag removal + init).**
Splits the "make it run" piece from the "implement the merges"
piece. Lets the merge logic bed in for a release before flipping
the dev flag default.

**(c) Three PRs: E-1e-rest, E-1e-presets, E-1f (final).** Maximum
isolation, maximum sequencing overhead. Worth it only if either
merge is unusually risky.

**Auditor's lean:** **(a)** — one PR. Stage E was already split 5
→ 7 in E-1d-f3/f8; further splitting here would be more session
overhead than risk reduction.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — One PR.
- **Pick B** — Two PRs.
- **Pick C** — Three PRs.

---

## TODO #2 — Presets `deletedAt` field + SCHEMA_VERSION

Adding `deletedAt: null` to preset records is a schema extension.
Two questions: does it bump `Schema.SCHEMA_VERSION` from 1 to 2?
How do existing presets without the field behave?

**(a) Keep SCHEMA_VERSION=1, `deletedAt` is an additive optional
field (recommended).** Existing presets without `deletedAt` are
treated as not-deleted (the absence of the field IS the "alive"
state). F19b's `__forward` passthrough already covers downlevel
safety: if a downlevel client ever sees a record with `deletedAt`,
it'll preserve the field verbatim on writeback even though it
doesn't act on it. Rationale: SCHEMA_VERSION bumps are reserved for
**breaking** schema changes (e.g., a field type changes, a required
field is added). Additive optional fields are exactly what F19a/b
are designed to handle without a version bump.

**(b) Bump SCHEMA_VERSION to 2.** Treats the addition of
`deletedAt` as a versioned change. Downside: every existing preset
record on every device is now "schemaVersion 1" while the new code
writes "schemaVersion 2" — this triggers the F19a per-record
refuse-writeback gate (newer records refuse downlevel writeback)
in a way that may cause confusion. Forces a one-time stamp pass
to upgrade all existing presets to v2 at next save.

**Auditor's lean:** **(a)** — `deletedAt` is additive. Every other
Stage E sub-PR has stayed at SCHEMA_VERSION=1. Bumping now would
break that pattern for a field that doesn't structurally need it.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Keep SCHEMA_VERSION=1, `deletedAt`
  is additive.
- **Pick B** — Bump SCHEMA_VERSION to 2.

---

## TODO #3 — Tombstone UI filter location

Presets with `deletedAt: <timestamp>` set must NOT render in the
presets drawer UI. The filter has two natural homes:

**(a) Filter inside `Presets.getAll()` (recommended — engine-level).**
`getAll()` becomes `JSON.parse(raw).filter(p => !p.deletedAt)`. Every
caller (drawer UI, `applyPreset`, `formatDurationHint`) benefits
automatically. Add a sibling `Presets._getAllIncludingTombstones()`
internal helper for the snapshot adapter so sync can still see
tombstones to write to cloud. This is the cleanest separation — UI
never sees tombstones; sync always does.

**(b) Filter inside `js/presets-ui.js` only (UI-level).** Each UI
read site adds `.filter(p => !p.deletedAt)`. More invasive (3-4
sites), but the engine's `getAll()` stays unchanged. Risk: a new UI
surface that forgets to add the filter renders tombstones as ghost
presets.

**(c) Both.** Filter in `getAll()` AND in the UI. Belt-and-suspenders.

**Auditor's lean:** **(a)** — engine-level filter. Single source of
truth, cleanest contract: "if you see a preset from `getAll()`, it's
alive."

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Filter in `Presets.getAll()` engine.
- **Pick B** — Filter in `js/presets-ui.js` only.
- **Pick C** — Both.

---

## TODO #4 — Per-store F19a gate location

Per E-1b TODO #7 resolution, E-1e ships the "per-store
snapshot-level F19a gate." Two interpretations:

**(a) Dispatcher-level (recommended).** Add a
`_filterFutureRecordsInSnapshot(key, snapshot)` helper in
`js/sync-engine.js` called from `_runMergeCycle()` BEFORE invoking
each merge fn. The helper walks the snapshot's payload, identifies
which inner field holds the record array/map per store key (meds →
`payload.meds[]`; history → `payload.sessions[]`; rest_log →
`payload.rest_log{date}`; presets → `payload.presets[]`; bfrb_events →
`payload.events[]`; distractions → `payload.flow{} + payload.pomodoro{}`),
filters records whose `schemaVersion > Schema.SCHEMA_VERSION`,
returns the filtered snapshot. The merge fn never sees future-schema
local records. **Skipped records get logged** so observers see the
count.

**(b) Inside each merge fn.** Each merge fn re-implements the
filter on its own snapshot read. Duplicates the per-record cloud-side
pre-filter pattern (already in E-1c/d/d-f3/d-f8). More
locality-of-reasoning but 6× duplication.

**(c) Both — dispatcher gate AND per-merge-fn cloud gate retained.**
The dispatcher gate operates on the local snapshot side; each
merge fn keeps its existing CLOUD-side pre-filter (which is what
shipped in E-1c onward). This isn't really a choice between (a) and
(b) — it's "(a) for local + keep what's already there for cloud."

**Auditor's lean:** **(c)** — the existing per-merge-fn cloud
pre-filters STAY (they protect against cloud-side future-schema
records arriving over the wire), and the new dispatcher gate ADDS
local-side snapshot filtering. Both layers cover different vectors;
neither is redundant.

**Kyle, pick before Phase 1:**
- **Pick A** — Dispatcher-level only (replaces per-merge-fn gates).
- **Pick B** — Each merge fn does its own snapshot filter.
- **Pick C (recommended)** — Dispatcher local-snapshot gate +
  preserve per-merge-fn cloud-side gates.

---

## TODO #5 — Flag removal mechanics

The `tempo_sync_steady_state_enabled` localStorage flag has been the
default-off gate since E-1b. Two ways to remove it:

**(a) Delete entirely (recommended).** Remove
`STEADY_STATE_ENABLED_KEY` constant (line 97), the
`_isSteadyStateEnabled()` function (lines 1530-1538), and the gate
check at line 1689 inside `startSteadyState()`. Grep confirms no
other consumers. Cleanest removal.

**(b) Keep constant + function, no-op the gate.** Leave the dead
code in place; remove only the `if (!_isSteadyStateEnabled()) return;`
line. Preserves a quick way to re-enable the gate via a one-line
revert if E-1e steady-state misbehaves in production.

**Auditor's lean:** **(a)** — clean delete. Dead code rots; the
one-line revert advantage of (b) is offset by the cognitive cost
of explaining "this constant exists but isn't used."

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Delete entirely.
- **Pick B** — Keep dead constant + no-op the gate.

---

## TODO #6 — Auto-invoke trigger

When should `startSteadyState()` auto-invoke from `SyncEngine.init()`?

**(a) Immediately at end of `init()`.** Call `startSteadyState()`
synchronously after the auth subscription is registered.
Steady-state checks its own preconditions internally (flag on +
signed-in user + SyncState not busy/errored), so a premature call
is a no-op until conditions are met. Simplest.

**(b) After first hydrate completes (recommended).** Extend
`_maybeAutoHydrate(user)` to call `startSteadyState()` in its
`.then()` block after `hydrateFromCloud()` succeeds. Guarantees
hydrate runs BEFORE steady-state. Mirrors the C-1 pattern that
gates hydrate behind auth-change. Skipped on cold-boot if hydrate
is already done (`isAllHydrated() === true`) — in that case
`init()` calls `startSteadyState()` directly because the gate is
satisfied.

**(c) Both (a) and (b) gated on `isAllHydrated()`.** A helper
`_maybeAutoStartSteady(user)` gates on all 4 conditions (signed in
+ flag on + all-hydrated + not Stage D). Called from both
`init()` (in case cold-boot already has the marker) and from
`_maybeAutoHydrate()`'s post-hydrate `.then()` (in case first sign-in
just completed hydrate).

**Auditor's lean:** **(c)** — defensive belt-and-suspenders pattern,
matches the existing `_maybeAutoHydrate` shape. Idempotent
(startSteadyState's existing `if (_steadyTimer != null) return;`
guard makes double-invocation a no-op).

**Kyle, pick before Phase 1:**
- **Pick A** — Immediately at end of `init()`, no gating.
- **Pick B** — After first hydrate completes only.
- **Pick C (recommended)** — Both, gated on all 4 conditions.

---

## TODO #7 — Test file structure

Each prior Stage E sub-PR adopted "one new test file per real per-
store merge" (E-1c → meds, E-1d → history, E-1d-f3 → bfrb,
E-1d-f8 → distractions). Two new merges in E-1e:

**(a) Two new test files (recommended) + extend sync-engine.test.js.**
- `tests/sync-merge-rest-log.test.js` — ~12-16 cases covering
  sleep LWW + naps append-merge dedup + F19a filter + idempotency
  + CAS error tolerance.
- `tests/sync-merge-presets.test.js` — ~12-16 cases covering
  full-record LWW + tombstone propagation + tombstone hiding in UI
  filter + F19a filter + idempotency + CAS error tolerance.
- Extend `tests/sync-engine.test.js` with ~6-10 new cases: dispatcher
  per-store F19a gate behavior, flag-removal regression (the existing
  18 dev-flag tests at lines 817-1328 need pruning), auto-invoke
  behavior under each of the 4 gate conditions.

**(b) Bundle into `tests/sync-engine.test.js`.** Keep all new tests
in the existing file. Avoids 2 new test files. Worse for
locality-of-reasoning (a developer fixing a rest_log merge bug
shouldn't have to scan 1300 lines of unrelated dispatcher tests).

**Auditor's lean:** **(a)** — matches the E-1c/d/d-f3/d-f8
precedent. The existing 18 dev-flag tests get pruned to ~4-6
"flag is gone / steady-state auto-arms" regression tests.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Two new files + sync-engine.test.js
  extension.
- **Pick B** — Bundle everything into sync-engine.test.js.

---

## TODO #8 — Phase 4 ui-wirer scope

Once the dev flag is removed, steady-state auto-arms on every boot
with the master flag on + signed in. Phase 4 ui-wirer can verify
this in two ways:

**(a) Smoke check only (recommended).** Load `localhost:8765` in
kapture, verify no console errors at boot, verify SyncState
transitions cleanly (`ready` → `hydrating` → `ready` during merge
cycles), verify the Cloud Sync settings drawer section still
renders, verify the master flag toggle still works. NO real
Firestore connection — Kyle's two-device manual test is the
real E2E check, scheduled post-merge.

**(b) End-to-end with Kyle in the loop.** Phase 4 asks Kyle to
sign in via OAuth in a real browser (kapture can't drive Google
OAuth), then verifies the merge cycle fires + cloud writes succeed
+ a known cross-device update propagates. Higher confidence, but
synchronous Kyle-time during the ui-wirer phase.

**Auditor's lean:** **(a)** — smoke check only. Real E2E is the
manual post-merge validation. Phase 4's job is to confirm "this
PR doesn't crash the boot path," not "cross-device sync works end-
to-end on real Firestore."

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Smoke check only.
- **Pick B** — End-to-end with Kyle's OAuth in the loop.

---

## Hard rules

- **Audit before code.** Phase 1 = sync-auditor produces
  `docs/sync-impl/audits/E-1e-AUDIT.md` and Kyle reviews before
  Phase 2 fires.
- **Phase 4 ui-wirer FIRES** — third time in Stage E. Scope per
  TODO #8.
- **F-invariant guardrails:**
  - F10 (envelope stamping at write) — `RecoveryUI.setSleep` +
    `RecoveryUI.addNap` + `Presets.save` + `Presets.update` +
    `Presets.remove` all stamp `deviceId` + `updatedAt` +
    `schemaVersion` via `js/schema.js`. **`Presets.remove` becomes
    a tombstone-set, not a hard delete.**
  - F13 (write gate) — `RecoveryUI.setSleep` + `addNap` already
    check `SyncState.canWrite()` (verified at line 45 of
    `recovery-ui.js`); `Presets.save` / `update` / `remove` already
    check `canWrite()` (verified at lines 24, 40, 56 of
    `presets.js`). No new gate sites in this PR.
  - F19a CAS-level + per-record cloud — inherited.
  - **F19a per-store snapshot gate (NEW) — TODO #4.**
- **Master flag stays the only public gate.** After E-1e,
  `tempo_sync_enabled === '1'` is the sole "user wants cloud sync"
  toggle. The dev flag is gone.

---

## After E-1e merges

Stage E is **fully shipped** (7/7 sub-PRs). What's left in the
cloud-sync initiative:

- **E-2** — Offline buffer (`js/sync-buffer.js`, pending-op queue
  in IDB with `originalWallClock` preservation). Required for
  reliable cross-device sync when one device is offline.
- **E-3** — Real-time `onSnapshot` listeners. Today's polling
  cadence is 30s; listeners drop the latency to <1s. Also includes
  the downlevel-client warning toast for refuse-writeback events.
- **Stage F (DEFERRED)** — Per-store manifest registry (F19c).

After E-1e merges and Kyle runs the two-device validation, the
"fully cloud-synced bug-free between laptop and phone" outcome that
opened this whole initiative is **achieved for the
steady-state polling path**. E-2 + E-3 are reliability
enhancements (offline-resilience and lower latency), not feature
prerequisites.

---

## Branch + commit conventions

- **Branch:** `feat/sync-stage-e-complete` (or
  `feat/sync-stage-e-rest-presets-go-live` if Kyle prefers more
  descriptive)
- **PR title:** `feat(sync): rest_log + presets merge + per-store F19a + sync goes live (E-1e)`

---

**Kyle: TODOs 1–8 need your call. TODOs #2 (deletedAt + SCHEMA_VERSION)
and #4 (per-store F19a location) are the most consequential —
schema version stamping cascades to every existing record on every
device. Auditor leans all-recommended. Accept all defaults with
"all defaults" or override per-TODO.**
