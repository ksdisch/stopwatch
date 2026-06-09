# ADR-0008 — Mood as a synced event store (`mood_events`)

**Status:** Accepted · **Date:** 2026-06-09

## Context

Phase 3's main build is mood/affect capture — the Tier-2 gap (`pillars.md` §3,
`open-questions.md` #5). The Chickens synthesizer runs in the council (Admin SDK on Kyle's
Mac) and can only read Firestore. Tempo has two patterns for data landing in the system:
**synced stores** (client-written, bidirectional, council-readable — meds, history, rest_log,
presets, bfrb_events, distractions) and **read-only feeds** (council/pipeline-written —
recovery_state, synthesis). Mood is the first datum that is client-*written* AND
council-*read*. Device-local capture would make the pillar's defining Area permanently
invisible to the intelligence layer.

## Decision

**`mood_events` becomes the 7th synced store:**

- Record shape: `{ at: epochMs, valence: 1..5, tags?: string[] (≤3), note?: string (≤280),
  context?: 'global'|'flow'|'pomodoro', deviceId, updatedAt, schemaVersion }` — append-only,
  immutable. Stamped via `js/schema.js` (F10), write-gated by `SyncState.canWrite` (F13),
  F19a honored. Reserved additive-nullable field: `energy?: 1..5` (the 2-axis capture
  upgrade lands later without migration).
- Merge: union-dedup by `(deviceId, at)`, deterministic Firestore doc id `deviceId-at` —
  `js/sync-merge-mood.js` clones `js/sync-merge-bfrb.js`. No F15 arrival toast
  (high-frequency precedent from bfrb_events).
- **No `firestore.rules` change:** the owner catch-all
  (`users/{userId}/{collection}/{docId=**}`) already covers new collections; only
  `recovery_state`/`synthesis` are excluded.
- Export/backup posture mirrors `bfrb_events`.

## Alternatives considered

- **Device-local v1, promote later** — rejected: the council can't see it (the Mood Area
  would be `null` at the Phase-3 gate), a cross-device trend computed from one device's
  fragment is biased, and since records are envelope-stamped either way the promotion PR is
  guaranteed *extra* work, not saved work.
- **Fold into `rest_log` (per-date `moods[]` merged like naps)** — rejected: pollutes
  RecoveryUI's per-date sleep/nap contract, invites same-blob write races between two
  modules, and un-folding later is a real migration (worse than either other path).
- **Bespoke client-written Firestore collection outside `SYNCED_STORES`** — rejected:
  re-implements offline buffering, CAS writeback, and the F19a gate ad hoc — exactly what
  the store registry exists to provide once.

## Consequences

- The "6 stores" registry language becomes **7** across CLAUDE.md, `data-dictionary.md` §3,
  `CLOUD-SYNC-STRATEGY.md`, the `js/schema.js` comment list, and the 6 store-list assertions
  in `tests/sync-engine.test.js`.
- Mood data egresses to Kyle-scoped Firestore (same privacy posture as `bfrb_events`); the
  App-Store privacy nutrition labels (backlog #1) must list mood when that paperwork happens.
- Append-only immutability means post-hoc patches are dropped on dedup collision — capture
  UX must fold optional fields into one `Mood.log()` call (the GlobalBFRB deferred-commit
  pattern). Capture UX itself (1-tap valence + optional tags, topbar popover) is recorded in
  [`../phase-3-plan.md`](../phase-3-plan.md).
