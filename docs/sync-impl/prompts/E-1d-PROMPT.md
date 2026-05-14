# Tempo cloud-sync — implement PR E-1d (Stage E: history steady-state merge)

You're working on Tempo, a vanilla-JS PWA + Capacitor iOS app. The
cloud-sync implementation plan is at `docs/sync-impl/PLAN.md` on
`main`. Stage 0, Stage A close-out, Stage B (B-1 → B-4), Stage C
(C-1), Stage D (D-1 + D-2), and Stage E sub-PRs E-1a + E-1b + E-1c
are all shipped (PRs #46–#68, plus chore PR #67).

E-1d is the **fourth of five Stage E sub-PRs** by the original
Option B split. The original PLAN.md spec for E-1d packages three
things:

1. **`js/sync-merge-history.js`** — sessions append-merge dedup by
   `id`; note/tags LWW per-field; phaseLog dedup by
   `(deviceId, phaseStartedAt)` per F6.
2. **F3 BFRB stream consolidation** — `bfrbs_global` / `flow_bfrbs`
   / `pomodoro_bfrbs` → unified `bfrb_events` stream with
   `context: 'flow' | 'pomodoro' | 'global'`. Migration in
   `loadState`: union the three legacy keys → write `bfrb_events`;
   legacy keys removed on next save.
3. **F8 distraction sessionId-keyed migration** — move
   `flow_distractions` (flat array) → `flow_distractions/{sessionId}`
   (keyed map). Same for `pomodoro_distractions`.

**Scope problem:** items #2 and #3 each touch multiple UI files
(`js/global-bfrb.js`, `js/flow-ui.js`, `js/pomodoro-ui.js`,
`js/analytics.js`, `js/export.js`, `js/persistence.js`). Path-A
"all in one PR" would balloon E-1d to ~2500 LOC, trigger Phase 4
ui-wirer, and ship a one-way migration that's hard to roll back.

**TODO #1 below surfaces three scope-split options** for Kyle.

---

## TODO #1 — Scope split: sessions only, or sessions + F3 + F8?

**(a) Path A — all-in-one (matches PLAN.md as written).** E-1d ships
`sync-merge-history.js` + F3 BFRB consolidation + F8 distraction
migration + UI updates to read from new keys. Phase 4 ui-wirer
fires. Single ~2500 LOC PR. Pros: PLAN.md spec satisfied in one
shot. Cons: largest PR yet; harder to review; one-way migration with
big blast radius; if F3 migration loses BFRB history mid-way, no
clean recovery.

**(b) Path B — sessions only; defer F3 + F8 to follow-up sub-PRs**
(recommended). E-1d ships `sync-merge-history.js` (sessions
append-merge by `id` + note/tags LWW + phaseLog dedup) + extends
`js/history.js` if needed for snapshotForSync envelope shape. NO
F3, NO F8. Each gets its own PR:
  - **E-1d-f3** — F3 BFRB consolidation (engine migration + UI
    read-path updates + tests). Standalone PR with Phase 4 ui-wirer.
  - **E-1d-f8** — F8 distraction sessionId-keyed (engine migration
    + UI read-path updates + tests). Standalone PR with Phase 4.
  
  Then E-1e ships rest_log + presets merge + removes the dev flag.
  
  Pros: smallest E-1d (matches E-1c's pattern); migrations get
  dedicated review attention; rollback per-migration is cleaner. Cons:
  Stage E now totals 7 sub-PRs instead of 5.

**(c) Path C — sessions + F3 only; defer F8.** Middle ground. E-1d
covers sessions merge + F3 BFRB consolidation. F8 distractions
defer to a follow-up. Pros: smaller than Path A; still bundles the
"history surface" work. Cons: F3 still has big UI surface; same
review-attention concern.

**Auditor's lean:** **(b)** — split. F3 and F8 are big enough to
warrant dedicated PRs. The risk of one-way data migration deserves
isolated review. The Stage E PR count grows from 5 to 7 (E-1a, E-1b,
E-1c, **E-1d, E-1d-f3, E-1d-f8**, E-1e) but each sub-PR stays
small + reviewable + revertible.

**The rest of this brief assumes Path B was picked.** If you pick A
or C, the TODOs below need rework.

**Kyle, pick before Phase 1:**
- **Pick A** — All-in-one (matches PLAN.md as written).
- **Pick B (recommended)** — Sessions only; defer F3 + F8 to separate
  PRs (Stage E grows to 7 sub-PRs).
- **Pick C** — Sessions + F3 (defer F8 only).

---

## What E-1d ships (assuming Pick B)

1. **`js/sync-merge-history.js`** — replace the E-1b throwing stub
   with the real merge function. Inputs: `localSnapshot` (from
   `SyncEngine.getSnapshot().history`). Internally: fetches cloud
   sessions via `await SyncFirestore.getCollection('users/{uid}/history')`,
   pre-filters future-schema records (F19a, per Pick C from E-1c
   TODO #5), unions cloud ∪ local sessions, dedupes by `id` (cloud
   wins LWW on collision per existing D-1 reconcile precedent),
   applies per-field LWW to `note` and `tags` (each has its own
   `updatedAt` per A-1's session-field stamping), dedupes
   `phaseLog` entries by `(deviceId, phaseStartedAt)` per F6,
   writes merged sessions back via `SyncFirestore.runTransaction`
   (E-1b CAS), per-record. Returns
   `{ ok, count, skipped, remoteArrivals: Map<sessionId, count>, warnings }`.

2. **`js/history.js`** (potentially) — verify `snapshotForSync()`
   returns the right envelope shape. If `note` / `tags` per-field
   `updatedAt` stamping doesn't exist yet (A-1 may have stamped only
   the record-level `updatedAt`), add per-field stamping helpers.

3. **`tests/sync-merge-history.test.js`** (NEW) — 12-15 cases
   covering: sessions append-merge by `id`; cloud-wins collision;
   note/tags LWW per-field; phaseLog dedup by `(deviceId, phaseStartedAt)`;
   F19a future-record skip; F13 write gate; idempotency; CAS abort
   tolerance; F15 ≥2-entry counter (sessions-arrival event TBD per
   TODO #4).

---

## TODO #2 — note/tags per-field LWW: does A-1 already stamp these?

The audit phase needs to verify A-1's history-field-stamping work.
PLAN.md §A-1 stamps `deviceId` + `updatedAt` at the **record level**
(per F10). For per-field LWW on `note` and `tags`, each field needs
its OWN `updatedAt` stamp — otherwise we can't tell which device's
note edit is newer.

**(a) A-1 already shipped per-field stamping.** Sync-auditor confirms
during Phase 1; engine-implementer uses existing helpers.

**(b) A-1 only stamped record-level.** E-1d needs to add per-field
stamping in `js/history.js` (e.g., `noteUpdatedAt`, `tagsUpdatedAt`).
That extends the schema; needs F19b passthrough confirmation; bumps
SCHEMA_VERSION potentially.

**Auditor will determine during Phase 1** by reading `js/history.js`.
If (b), E-1d gains a schema extension; flag it as a sub-decision.

**Kyle, no pick needed up-front** — auditor surfaces during Phase 1.
But if you have a strong opinion (e.g., "don't bump SCHEMA_VERSION
in E-1d; defer per-field LWW to a follow-up"), say so.

---

## TODO #3 — F19a pre-filter at history record level

Same as E-1c TODO #5 (resolved Pick C). For E-1d:
- **Pre-filter** future-schema history records BEFORE union (`skipped++`).
- **D-2 helper layer** (reconcileDoseLog) is meds-specific; history
  doesn't have an analog. The merge fn itself is the only F19a
  enforcement at the per-record/per-field level here.
- **CAS wrapper** (E-1b) still enforces refuse-writeback at write time.

**Pick A (recommended)** — Apply the same F19a pre-filter pattern as
E-1c. No new layer.

---

## TODO #4 — F15 ≥2-entry counter for sessions: fire or skip?

E-1c shipped F15 `meds-arrival` events on ≥2 NEW remote dose entries
per med. Question for E-1d: does the history merge fire an analogous
event when ≥2 new sessions arrive from another device?

**(a) Fire sessions-arrival events.** Pattern matches E-1c — emit
`sessions-arrival` with `{ deviceId, count }` (or `{ sessionIds }`)
when ≥2 NEW remote sessions land in one cycle. UI subscriber (B-4
toast or future) renders "2 new sessions synced from your phone."

**(b) Skip F15 for sessions.** Sessions arrivals are less actionable
than meds doses (medication is high-frequency + safety-critical).
Skip the counter; history merge is silent.

**(c) Fire with higher threshold (e.g., ≥5).** Sessions are noisier;
require more before surfacing.

**Auditor's lean:** **(b)** — skip F15 for sessions. Toast noise
would be high (every Pomodoro cycle / Flow block / cooking timer
creates a session). The user already gets meds-arrival toasts (the
high-value signal). Sessions can be browsed in the history panel
on-demand; pushing them via toast is noise.

**Kyle, pick before Phase 1:**
- **Pick A** — Fire `sessions-arrival` events (mirror E-1c F15).
- **Pick B (recommended)** — Skip F15 for sessions.
- **Pick C** — Fire with threshold ≥5.

---

## TODO #5 — Per-store snapshot-level F19a gate (E-1e scope or E-1d?)

Per E-1b's TODO #7 resolution, the per-store snapshot-level F19a
gate (skip entire future-schema records before passing them to the
merge function) was deferred to E-1e. E-1d's merge function does
its own per-record pre-filter (TODO #3), matching E-1c's pattern.

**Confirm** the snapshot-level gate stays E-1e scope. E-1d does not
need a dispatcher-level filter.

**Pick A (recommended)** — Confirmed. Per-record pre-filter only in
E-1d; per-store snapshot gate ships in E-1e.

---

## TODO #6 — Test file naming

E-1c set the per-store test file pattern (`tests/sync-merge-meds.test.js`).
E-1d follows: `tests/sync-merge-history.test.js`. No decision needed
unless you want a different convention.

**Pick A (recommended)** — `tests/sync-merge-history.test.js`,
matching E-1c.

---

## TODO #7 — Dev flag carryover

Per Pick A on E-1c TODO #7, `tempo_sync_steady_state_enabled` stays
default-off through E-1d. **E-1e** removes the flag once all 4
per-store merges have shipped (or 5 if E-1d-f3 / E-1d-f8 count).

If Path B from TODO #1 is picked, the flag stays default-off through
E-1d, E-1d-f3, E-1d-f8, AND E-1e. The flag removal could move to a
later PR or stay in E-1e.

**Pick A (recommended)** — Confirmed. E-1d does NOT touch the flag.

---

## Approach + file list (after Kyle resolves TODOs 1–7, Path B
assumed)

The audit will codify this. Provisional shape:

**Files modified:**
- `js/sync-engine.js` — minor changes if any (dispatcher API stable).
- `js/sync-merge-history.js` — replace E-1b stub body.
- `js/history.js` — verify snapshotForSync envelope; possibly extend
  per-field stamping (TODO #2).
- `sw.js` — CACHE_NAME bump v76 → v77.
- `tests/index.html` — add `<script>` tag for new test file.

**Files added:**
- `tests/sync-merge-history.test.js` — new test file.

**Total files: 5-6 (no UI files; Phase 4 ui-wirer SKIPPED).**

---

## Hard rules

- **Audit before code.** Phase 1 = sync-auditor → produces
  `docs/sync-impl/audits/E-1d-AUDIT.md`. PAUSE for Kyle to review
  audit before Phase 2 fires.
- **Phase 4 ui-wirer SKIPPED** under Pick B (zero UI files). Under
  Pick A or C, ui-wirer fires for the migration UI updates.
- **F-invariant guardrails:**
  - F2 (sessionID uniqueness from A-1) — relied on for dedup by `id`.
  - F6 (phaseLog stamping from A-1) — relied on for phaseLog dedup
    by `(deviceId, phaseStartedAt)`.
  - F10 (record envelope stamping) — note/tags per-field stamping
    if TODO #2 resolves (b).
  - F13 (write gate) — dispatcher-wide flip from E-1c stays in place.
  - F15 (≥2-entry remote-arrival) — per Pick B from TODO #4, skipped
    for sessions.
  - F19a CAS-level + per-record — both layers honored.
  - F19a per-store snapshot gate — E-1e (per Pick A on TODO #5).
  - F21 (alarmFired structural exclusion) — passes through unchanged.

---

## After E-1d (Path B) merges

- **E-1d-f3** — F3 BFRB stream consolidation. Migration in loadState
  (union 3 legacy keys → write `bfrb_events`); UI updates to
  `js/global-bfrb.js`, `js/flow-ui.js`, `js/pomodoro-ui.js`,
  `js/analytics.js`. Phase 4 ui-wirer fires.
- **E-1d-f8** — F8 distraction sessionId-keyed migration. UI updates
  to `js/flow-ui.js`, `js/pomodoro-ui.js`. Phase 4 ui-wirer fires.
- **E-1e** — Rest_log + presets steady-state merge. Per-store F19a
  snapshot gate. Remove `tempo_sync_steady_state_enabled` dev flag.
- **E-2** — Offline buffer.
- **E-3** — Real-time listeners.

---

## Branch + commit conventions

- **Branch:** `feat/sync-stage-e-history-merge`
- **PR title:** `feat(sync): history steady-state merge (E-1d)`
- **Commit type prefix:** `feat` / `docs`.

---

**Kyle: please resolve TODOs 1–7 before saying "Go". The auditor's
recommended picks are documented inline. The most consequential is
TODO #1 (scope split) — it determines whether E-1d is small (Pick B)
or large (Pick A).**
