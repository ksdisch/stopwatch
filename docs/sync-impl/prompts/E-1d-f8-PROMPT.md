# Tempo cloud-sync — implement PR E-1d-f8 (Stage E: F8 distraction sessionId-keyed migration)

You're working on Tempo, a vanilla-JS PWA + Capacitor iOS app. The
cloud-sync implementation plan is at `docs/sync-impl/PLAN.md` on
`main`. Stage 0, Stage A close-out, Stage B (B-1 → B-4), Stage C
(C-1), Stage D (D-1 + D-2), and Stage E sub-PRs E-1a + E-1b + E-1c
+ E-1d + E-1d-f3 are all shipped (PRs #46–#70, plus chore PR #67).

E-1d-f8 is the **sixth of seven Stage E sub-PRs** after the E-1d
split. It ships the **F8 distraction sessionId-keyed migration**
that was deferred from E-1d. Pattern mirrors E-1d-f3 (F3 BFRB
consolidation, PR #70) but on a smaller surface (no FAB, no
analytics integration).

## What F8 is

Today, distraction entries go into ONE of two flat-array localStorage
keys based on which session is active:

- `flow_distractions` — entries for the active Flow block. Cleared at
  Flow session start/reset.
- `pomodoro_distractions` — entries for the active Pomodoro work
  cycle. Cleared at Pomo session start.

Each is a flat array of `{ category, note?, timestamp }` entries. The
shape works for the UI (current session's distractions in one
place) but is awkward for sync: there's no way to merge two devices'
distraction logs without tombstones (which entries belong to which
session? did the user delete one, or did it never sync?).

F8 reshapes both stores into **sessionId-keyed maps**:

```js
// js/flow-ui.js → flow_distractions
{
  "<sessionId-1>": [{ category, note?, timestamp, deviceId, updatedAt, schemaVersion }, ...],
  "<sessionId-2>": [...],
  ...
}

// js/pomodoro-ui.js → pomodoro_distractions
{ "<sessionId-1>": [...], "<sessionId-2>": [...], ... }
```

UI reads `flow_distractions[currentSessionId]`. Sync merges by
keying on `sessionId` (each session's array merges independently;
dedup within a session by `(deviceId, timestamp)`). Resets drop the
specific sessionId key (no tombstones needed).

The auditor's E-1d-f3 Q1 finding stands: Flow + Pomo engines expose
`getSessionStartedAt()` (not a discrete `getSessionId()`), so the
session-start timestamp doubles as the sessionId key.

## What E-1d-f8 ships (provisional, pending TODO resolutions)

1. **`js/distractions.js`** (NEW) — IIFE module owning both
   `flow_distractions` + `pomodoro_distractions` sessionId-keyed maps.
   Public API: `Distractions.log({ context: 'flow'|'pomodoro', sessionId, category, note? })`,
   `Distractions.getForSession(context, sessionId)`,
   `Distractions.clearSession(context, sessionId)`,
   `Distractions.snapshotForSync()`,
   `Distractions._reconcileWriteRaw(records)`,
   `Distractions._runMigration()`.
2. **Migration at module load** — read 2 legacy flat-arrays. For each,
   attach to the current active session's sessionId IF one is running
   (e.g., `Flow.getSessionStartedAt()` returns non-null). Otherwise,
   store under a synthetic `'pre-migration-orphan'` key. Idempotent via
   marker `tempo_distractions_migration_v1`.
3. **`js/flow-ui.js`** (MODIFY) — `logFlowDistraction()` routes through
   `Distractions.log({ context: 'flow', sessionId: Flow.getSessionStartedAt(), ... })`.
   Read sites (lines 534, 606, 664) call `Distractions.getForSession('flow', currentSessionId)`.
   Clear sites (5 call sites — lines 168, 214, 231, 276, 283) call
   `Distractions.clearSession('flow', sessionId)`.
4. **`js/pomodoro-ui.js`** (MODIFY) — same pattern for Pomo.
5. **`js/persistence.js`** (MODIFY) — line 67's
   `localStorage.removeItem('pomodoro_distractions')` becomes
   `Distractions.clearSession('pomodoro', sessionId)` (or all if no
   active session).
6. **`js/export.js`** (MODIFY) — add `flow_distractions` /
   `pomodoro_distractions` to the backup format's settings block
   (already there per current code — verify the new map shape
   round-trips through export/import correctly).
7. **`js/sync-engine.js`** (MODIFY) — add 6th `SYNCED_STORES` entry:
   `{ key: 'distractions', adapter: { read: () => Distractions.snapshotForSync(), write: writeStub } }`.
8. **`js/sync-merge-distractions.js`** (NEW) — per-store merge fn.
   Merge cloud + local maps by sessionId; within each session, union +
   dedup by `(deviceId, timestamp)`. Write back per-record via CAS.
9. **`tests/distractions.test.js`** (NEW) — migration + module API.
10. **`tests/sync-merge-distractions.test.js`** (NEW) — per-store merge.
11. **`index.html`** + **`tests/index.html`** + **`sw.js`** — script
    tag additions + CACHE_NAME bump v78 → v79.

**Phase 4 ui-wirer fires** — verify Flow distraction log + Pomo
distraction log still render correctly post-migration.

---

## TODO #1 (LOAD-BEARING) — Storage shape

PLAN.md notates `flow_distractions/{sessionId}` (with a slash). Two
literal interpretations:

**(a) Map under one key** (recommended). Single localStorage key
`flow_distractions` whose VALUE is a map: `{ [sessionId]: [entries] }`.
UI reads: `JSON.parse(localStorage.getItem('flow_distractions'))[currentSessionId]`.
Sync: snapshot reads the whole map once. Cleanup: a `clearSession`
helper deletes one map entry.

**(b) Many keys with prefix.** Many localStorage keys like
`flow_distractions/abc123` + `flow_distractions/def456`. UI reads:
`localStorage.getItem('flow_distractions/' + sessionId)`. Sync:
snapshot iterates `localStorage.keys()` looking for the prefix.
Cleanup: `localStorage.removeItem('flow_distractions/' + sessionId)`.

**Auditor's lean:** **(a)** — map under one key. PLAN.md's slash
notation is conceptual, not literal. Map shape is cleaner for sync
(one read, one parse, no key enumeration). One localStorage key
instead of N keys per user.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Map under one key.
- **Pick B** — Many keys with prefix.

---

## TODO #2 — Migration strategy

Mirrors E-1d-f3 TODO #1. Three options:

**(a) In-place at boot.** Read 2 legacy flat-arrays → write new maps
→ DELETE legacy keys. Aggressive; no rollback.

**(b) Phased — legacy keys retained for one release** (recommended).
Same approach as E-1d-f3. Migration writes new map shape; legacy
keys stay on disk; marker `tempo_distractions_migration_v1` gates
idempotency. Cleanup PR deferred per Pick C on TODO #5 of E-1d-f3.

**(c) Dual-write.** UI writes to BOTH old + new shapes during one
release. Defers benefit; not recommended.

**Auditor's lean:** **(b)** — phased. Matches the E-1d-f3 precedent.

**Kyle, pick before Phase 1:**
- **Pick A** — In-place at boot.
- **Pick B (recommended)** — Phased.
- **Pick C** — Dual-write.

---

## TODO #3 — Migration handling for orphan legacy data

At migration time, the legacy `flow_distractions` array represents
distractions for whatever session WAS active when those entries got
logged. If a session is currently running at migration time, those
entries logically belong to THAT session. If no session is running,
they're orphan (the session that owned them ended without saving
properly, or migration is running on a fresh boot).

**(a) Attach to current session if one is running; drop orphan data.**
At migration time, check `Flow.getSessionStartedAt()` /
`Pomodoro.getSessionStartedAt()`. If non-null, attach legacy array
to that sessionId. Otherwise, discard. Cleanest disk state but
orphan distractions are lost.

**(b) Attach to current session if running, store orphans under
synthetic key** (recommended). Same as (a) but orphan data lives
under a `'pre-migration-orphan'` sessionId key. UI never reads this
key (it filters by current session). User retains pre-migration
distractions if they care to recover them (e.g., from an Export
backup). Follow-up cleanup PR can drop the orphan entries.

**(c) Always discard.** No attempt to attach. Simplest. User loses
in-flight distractions that weren't saved to history.

**Auditor's lean:** **(b)** — attach + orphan-key fallback. Matches
the safety profile of Pick B on TODO #2.

**Kyle, pick before Phase 1:**
- **Pick A** — Attach if active; drop otherwise.
- **Pick B (recommended)** — Attach if active; orphan-key otherwise.
- **Pick C** — Always discard.

---

## TODO #4 — New module location

**(a) New module `js/distractions.js`** (recommended) — mirrors
`js/bfrb-events.js` (E-1d-f3). Owns both Flow + Pomo distraction
stores in one module. Public API + migration + sync hook.

**(b) Inside `js/flow-ui.js` + `js/pomodoro-ui.js`** — each UI file
owns its own distraction store + migration. Splits the work but
duplicates patterns.

**Auditor's lean:** **(a)** — single module, matches the E-1d-f3
precedent. Keeps the migration logic in one place.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — New `js/distractions.js`.
- **Pick B** — Inside `js/flow-ui.js` + `js/pomodoro-ui.js`.

---

## TODO #5 — Sync wiring scope

Same question as E-1d-f3 TODO #4. **(a) Bundle into E-1d-f8** vs
**(b) Defer to follow-up.**

**Auditor's lean:** **(a)** — bundle. ~50 LOC of new sync merge fn +
1 SYNCED_STORES entry; doesn't shrink E-1d-f8 meaningfully to split.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Sync wiring in E-1d-f8.
- **Pick B** — Defer to follow-up.

---

## TODO #6 — Cleanup PR timing

Same question as E-1d-f3 TODO #5. **(c) Defer cleanup, no
predetermined timing** is the established precedent.

**Auditor's lean:** **(c)** — defer.

**Kyle, pick before Phase 1:**
- **Pick C (recommended)** — Defer cleanup.
- **Pick A** — Schedule for 2 weeks.
- **Pick B** — Open the cleanup PR now but don't merge.

---

## TODO #7 — Dev flag carryover

Per Pick A on E-1c TODO #7 (and E-1d / E-1d-f3 carryover),
`tempo_sync_steady_state_enabled` stays default-off. E-1e (the LAST
Stage E sub-PR) flips the default on and removes the gate.

**Pick A (recommended)** — Confirmed. E-1d-f8 does NOT touch the flag.

---

## Hard rules

- **Audit before code.** Phase 1 = sync-auditor.
- **Phase 4 ui-wirer FIRES** — second time in Stage E. Verify Flow
  distraction log + Pomo distraction log render post-migration.
- **F-invariant guardrails:**
  - F10 (record envelope stamping) — every
    `Distractions.log()` stamps `deviceId` + `updatedAt` +
    `schemaVersion` via `js/schema.js`.
  - F13 (write gate) — `Distractions.log()` checks
    `SyncState.canWrite()`.
  - F19a CAS-level + per-record — inherited.
  - F19a per-store snapshot gate — E-1e scope.
- **Migration safety:** marker-first-then-write ordering. Defensive
  dedup by `(deviceId, timestamp)` per session on re-run.

---

## After E-1d-f8 merges

- **E-1e** — Rest_log + presets steady-state merge. Per-store F19a
  snapshot gate. **Remove `tempo_sync_steady_state_enabled` dev
  flag** — steady-state runs by default.
- **E-2** — Offline buffer.
- **E-3** — Real-time listeners.

After E-1e, you're 2 PRs from "fully cloud-synced bug-free between
laptop and phone."

---

## Branch + commit conventions

- **Branch:** `feat/sync-stage-e-distractions-migration`
- **PR title:** `feat(sync): F8 distraction sessionId-keyed migration (E-1d-f8)`

---

**Kyle: TODOs 1–7 need your call. TODO #1 (storage shape) is
load-bearing — drives the API surface. Auditor leans all-recommended.
Accept all defaults with "all defaults" or override per-TODO.**
