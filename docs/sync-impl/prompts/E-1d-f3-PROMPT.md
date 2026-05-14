# Tempo cloud-sync — implement PR E-1d-f3 (Stage E: F3 BFRB stream consolidation)

You're working on Tempo, a vanilla-JS PWA + Capacitor iOS app. The
cloud-sync implementation plan is at `docs/sync-impl/PLAN.md` on
`main`. Stage 0, Stage A close-out, Stage B (B-1 → B-4), Stage C
(C-1), Stage D (D-1 + D-2), and Stage E sub-PRs E-1a + E-1b + E-1c
+ E-1d are all shipped (PRs #46–#69, plus chore PR #67).

E-1d-f3 is the **fifth of seven Stage E sub-PRs** after the E-1d
scope split. It ships the **F3 BFRB stream consolidation** that was
deferred from E-1d.

## What F3 is

Today, BFRB catches go into one of three localStorage keys based on
the user's active context:

- `bfrbs_global` — catches outside any focus session (Flow / Pomo)
- `flow_bfrbs` — catches during an active Flow block
- `pomodoro_bfrbs` — catches during an active Pomodoro work phase

Each is an array of `{ timestamp, phase?, cycleIndex? }` entries.
Three separate storage shapes makes sync structurally awkward
(three merge functions instead of one) and doesn't match the user's
mental model ("how many BFRB catches today across all contexts").

F3 consolidates these into **one stream** `bfrb_events`:

```js
[
  { takenAt: 1778000000000, context: 'global', deviceId, updatedAt, schemaVersion },
  { takenAt: 1778001000000, context: 'flow',     sessionId: 'flow-...', phase: 'focus', deviceId, ... },
  { takenAt: 1778002000000, context: 'pomodoro', sessionId: 'pomo-...', phase: 'work', cycleIndex: 1, deviceId, ... },
  ...
]
```

Each entry has a `context` tag and any context-specific sub-fields
(`phase`, `cycleIndex`, `sessionId`). Sync becomes one append-merge
stream dedup'd by `(deviceId, takenAt)`. UI reads filter by context.

## What E-1d-f3 ships (provisional, pending TODO resolutions)

1. **`js/bfrb-events.js`** (NEW) — IIFE module owning the `bfrb_events`
   store. Public API: `BfrbEvents.log({ context, sessionId?, phase?, cycleIndex? })`,
   `BfrbEvents.getAll()`, `BfrbEvents.getByContext(ctx)`,
   `BfrbEvents.countToday(ctx?)`, `BfrbEvents.snapshotForSync()`,
   `BfrbEvents._reconcileWriteRaw(events)` (for D-1 retrofit symmetry).
2. **Migration at module load** — union the 3 legacy keys → write
   `bfrb_events` → set marker `tempo_bfrb_events_migration_v1 = '1'`.
   Idempotent (skips union if marker set).
3. **`js/global-bfrb.js`** (MODIFY) — `logCatch()` now writes to
   `BfrbEvents.log(...)` instead of routing to legacy keys. FAB label
   count reads from `BfrbEvents.countToday(activeContext)`.
4. **`js/flow-ui.js`** (MODIFY) — Flow session BFRB counter reads
   `BfrbEvents.getByContext('flow')` filtered to current session.
5. **`js/pomodoro-ui.js`** (MODIFY) — Pomo BFRB counter reads
   `BfrbEvents.getByContext('pomodoro')` filtered to current session.
6. **`js/analytics.js`** (MODIFY) — aggregates read from
   `BfrbEvents.getAll()` instead of unioning 3 legacy keys.
7. **`js/sync-engine.js`** (MODIFY) — add `bfrb_events` to
   `SYNCED_STORES` registry (5th entry).
8. **`js/sync-merge-bfrb.js`** (NEW) — per-store merge function
   (append-merge dedup by `(deviceId, takenAt)`).
9. **`tests/sync-merge-bfrb.test.js`** (NEW) — 10-15 cases.
10. **`tests/bfrb-events.test.js`** (NEW) — migration unit tests
    + module API tests.
11. **`tests/index.html`** + **`sw.js`** + **`index.html`** — script
    tag additions + CACHE_NAME bump.

**Phase 4 ui-wirer fires** — first time in Stage E. UI changes need
visual verification on `localhost:8765` (Flow / Pomo / global FAB
counts render correctly post-migration).

---

## TODO #1 (LOAD-BEARING) — Migration strategy

Migrations from localStorage shape A → shape B are one-way and risky.
Three options:

**(a) In-place at boot (matches PLAN.md as written).** Migration code
unions 3 legacy keys → writes `bfrb_events` → DELETES the 3 legacy
keys. Subsequent boots: marker is set, skip union. Pros: clean state
on disk; no doubled storage. Cons: zero rollback safety. If the
union code has a bug (e.g., entry timestamps lost), legacy data is
gone forever.

**(b) Phased — legacy keys retained for one release** (recommended).
Migration: union 3 legacy keys → write `bfrb_events` → set marker.
**Do NOT delete legacy keys.** Subsequent boots check the marker;
skip union if set. Legacy keys remain on disk as a safety net. A
follow-up PR (E-1d-f3-cleanup, shipped 1+ releases later after we
confirm no data loss) deletes legacy keys. Pros: rollback-safe;
recovery code can re-load from legacy if a bug surfaces. Cons:
localStorage usage doubles for BFRB data until cleanup ships.

**(c) Dual-write for one release.** Every BFRB log writes to BOTH
the legacy key AND `bfrb_events`. Read path stays on legacy keys
during E-1d-f3. UI consolidation happens in a follow-up. Pros: zero
risk of UI breakage. Cons: 2x writes; data drift if a bug causes
one to diverge from the other; doesn't actually deliver the F3
benefit (UI still reads from 3 stores) until the follow-up lands.

**Auditor's lean:** **(b)** — phased. The localStorage size cost
(probably <10 KB per user) is negligible for safety. Marker-driven
idempotency is the cleanest design. Cleanup PR can be 1-line in 1-2
releases.

**Kyle, pick before Phase 1:**
- **Pick A** — In-place at boot (matches PLAN.md; aggressive).
- **Pick B (recommended)** — Phased, legacy keys retained until cleanup PR.
- **Pick C** — Dual-write (defers UI consolidation; doesn't deliver F3 benefit).

---

## TODO #2 — Migration code location

**(a) New module `js/bfrb-events.js`** — owns store + migration +
public API. All other files call `BfrbEvents.*` instead of touching
localStorage directly. Pros: single source of truth; testable in
isolation. Cons: new module to maintain.

**(b) Inside `js/global-bfrb.js`** — extend the existing module.
Pros: no new file. Cons: `global-bfrb.js` becomes a 200+ line
file mixing UI (FAB button) with persistence + migration.

**(c) Inside `js/persistence.js`** — co-locate with other migrations.
Pros: persistence module is the "migrations live here" home. Cons:
`persistence.js` doesn't currently handle BFRB shape transformations;
adds responsibility.

**Auditor's lean:** **(a)** — new module. The F3 surface is
substantial enough (store + migration + public API + sync hook) to
warrant its own file. Matches existing factory/module patterns.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — New `js/bfrb-events.js`.
- **Pick B** — Inside `js/global-bfrb.js`.
- **Pick C** — Inside `js/persistence.js`.

---

## TODO #3 — Entry schema

Current legacy entry shapes:
- `bfrbs_global` entry: `{ timestamp }`
- `flow_bfrbs` entry: `{ timestamp, phase }`
- `pomodoro_bfrbs` entry: `{ timestamp, phase, cycleIndex }`

Consolidated `bfrb_events` entry shape options:

**(a) Flat — all fields at top level.**
```js
{ takenAt, context: 'flow'|'pomodoro'|'global', sessionId?, phase?, cycleIndex?, deviceId, updatedAt, schemaVersion }
```
Pros: simple; matches D-2 doseLog pattern. Cons: context-specific
fields cluttering top level.

**(b) Nested — context-specific fields inside a `meta` sub-object.**
```js
{ takenAt, context, deviceId, updatedAt, schemaVersion, meta: { sessionId?, phase?, cycleIndex? } }
```
Pros: cleaner top-level. Cons: extra indirection; UI reads need
`.meta.phase` instead of `.phase`.

**(c) Discriminated union — context-specific entry types.** Different
shape per context. Pros: type-safe. Cons: vanilla JS, no types; this
just means more conditional logic.

**Auditor's lean:** **(a)** — flat. Matches D-2 doseLog precedent.
Optional fields (`sessionId`, `phase`, `cycleIndex`) just get omitted
when absent. UI reads stay terse.

**Also: rename `timestamp` → `takenAt`** to match the doseLog
convention (which has `takenAt`). Legacy entries get migrated:
`entry.takenAt = entry.timestamp; delete entry.timestamp`.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Flat schema with `takenAt` field name.
- **Pick B** — Nested `meta` sub-object.
- **Pick C** — Discriminated union per context.

---

## TODO #4 — Sync wiring scope: in E-1d-f3 or separate sub-PR?

PLAN.md §E-1 lists F3 as part of the steady-state merge work. The
question: does E-1d-f3 ALSO ship the sync wiring (add `bfrb_events`
to `SYNCED_STORES` + new `js/sync-merge-bfrb.js`)?

**(a) In E-1d-f3** (recommended). F3 is "done" after this PR — the
new store is created, UI reads from it, sync merges it. Pros: F3
delivered fully in one PR. Cons: bigger PR.

**(b) In follow-up E-1d-f3-sync.** E-1d-f3 ships migration + UI only;
sync wiring lands separately. Pros: smaller E-1d-f3; Phase 4
ui-wirer can focus on UI verification. Cons: BFRB events don't sync
until follow-up; Stage E grows from 7 to 8 sub-PRs.

**Auditor's lean:** **(a)** — bundle. The sync wiring is ~50 LOC
(new file + 1 registry entry); doesn't meaningfully reduce E-1d-f3's
scope to split it.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Sync wiring in E-1d-f3.
- **Pick B** — Split to follow-up.

---

## TODO #5 — Cleanup PR timing

If TODO #1 = Pick B (phased), there's a follow-up cleanup PR that
deletes legacy keys after a safe period. When?

**(a) Schedule for 2 weeks post-merge** — gives time for any
production issue to surface. Cleanup PR = ~10-line change deleting
legacy keys + bumping schema marker.

**(b) Open the cleanup PR alongside E-1d-f3 but DON'T merge it.**
PR sits open as a reminder; merge when comfortable.

**(c) No predetermined timing.** Defer cleanup decision until Stage
E + Stage F land. Possibly never delete (small storage cost).

**Auditor's lean:** **(c)** — no rush. Legacy keys are <10 KB; the
cleanup is a backlog item, not a critical-path PR.

**Kyle, pick before Phase 1:**
- **Pick C (recommended)** — Defer cleanup, no predetermined timing.
- **Pick A** — Schedule for 2 weeks.
- **Pick B** — Open the cleanup PR now but don't merge.

---

## TODO #6 — Test scope

Two test surfaces:

1. **`tests/bfrb-events.test.js`** (NEW) — module unit tests +
   migration tests:
   - migration idempotency (re-runs are no-ops when marker set)
   - migration unions legacy entries correctly (timestamp → takenAt)
   - migration preserves phase / cycleIndex sub-fields
   - migration is skipped when all 3 legacy keys are empty
   - log() stamps deviceId / updatedAt / schemaVersion via Schema helpers
   - getByContext() filters correctly
   - countToday() respects local-date boundary
   - snapshotForSync() returns the right envelope shape

2. **`tests/sync-merge-bfrb.test.js`** (NEW) — per-store merge tests:
   - happy path append-merge
   - dedup by `(deviceId, takenAt)`
   - F19a per-record pre-filter
   - F13 write gate
   - idempotency
   - CAS abort tolerance

**Kyle, no pick needed up-front — auditor sizes both test files.
~12-18 cases total expected, pushing test count from 454 → ~470.**

---

## TODO #7 — Dev flag carryover

Per Pick A on E-1c TODO #7, `tempo_sync_steady_state_enabled` stays
default-off through E-1c + E-1d + E-1d-f3 + E-1d-f8. E-1e removes
the flag.

**Pick A (recommended)** — Confirmed. E-1d-f3 does NOT touch the flag.

---

## Hard rules (orchestrator + subagents read this)

- **Audit before code.** Phase 1 = sync-auditor → produces
  `docs/sync-impl/audits/E-1d-f3-AUDIT.md`. PAUSE for Kyle review.
- **Phase 4 ui-wirer FIRES** — first time in Stage E. UI verification
  on `localhost:8765` for Flow / Pomo / global FAB BFRB counts.
- **F-invariant guardrails:**
  - F10 (record envelope stamping) — every `BfrbEvents.log()` stamps
    `deviceId` + `updatedAt` + `schemaVersion` via `js/schema.js`.
  - F13 (write gate) — `BfrbEvents.log()` checks `SyncState.canWrite()`
    before persisting.
  - F19a CAS-level + per-record + per-method — all inherited.
  - F19a per-store snapshot gate — still E-1e scope.
- **Migration safety:** the `tempo_bfrb_events_migration_v1` marker
  is the idempotency contract. Re-running the migration must be a
  no-op. If the marker key is corrupt or missing, the union step
  re-runs against (possibly already-migrated) legacy keys + the new
  `bfrb_events` — this MUST NOT produce duplicates. Dedup the union
  result by `(deviceId, takenAt)` as a defensive step.

---

## After E-1d-f3 merges

- **E-1d-f8** — F8 distraction sessionId-keyed migration. Touches
  `js/flow-ui.js` + `js/pomodoro-ui.js`. Phase 4 fires.
- **E-1e** — Rest_log + presets merge + remove dev flag.
- **E-2** — Offline buffer.
- **E-3** — Real-time listeners.

---

## Branch + commit conventions

- **Branch:** `feat/sync-stage-e-bfrb-consolidation`
- **PR title:** `feat(sync): F3 BFRB stream consolidation (E-1d-f3)`

---

**Kyle: TODOs 1, 2, 3, 4, 5 need your call. TODO #1 (migration
strategy) is load-bearing — drives the safety profile of the PR.
Auditor's leans are documented inline. Accept all-recommended with
"all defaults" or override per-TODO.**
