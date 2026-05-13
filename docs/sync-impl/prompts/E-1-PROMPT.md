# Tempo cloud-sync — implement PR E-1 (Stage E: steady-state merge loop)

You're working on Tempo, a vanilla-JS PWA + Capacitor iOS app. The
cloud-sync implementation plan is at `docs/sync-impl/PLAN.md` on
`main`. Stage 0, Stage A close-out, Stage B (B-1 → B-4), Stage C
(C-1), and Stage D (D-1 + D-2) are all shipped (PRs #46–#64). E-1 is
the **first and largest Stage E PR** — it lights up the periodic
push/pull merge loop and wires every per-store merge function. After
E-1, Stage E still owes E-2 (offline buffer) + E-3 (real-time
listeners + downlevel toast).

> **THIS BRIEF IS A SKELETON DRAFT.** Per the orchestrator-prompt
> "If per-PR brief is missing" rule, the orchestrator drafted this
> from `docs/sync-impl/PLAN.md` § E-1 (around line 336). Seven open
> TODOs are flagged below for Kyle to resolve before Phase 1 (audit)
> fires. **TODO #0 (mega-PR vs split) is the cascading decision** — it
> changes whether this brief stays as one giant E-1 or gets re-drafted
> as E-1a's first.

---

## Open TODOs — resolve before audit fires

### TODO #0 — Mega-PR vs sub-PR split (META; resolve first)

PLAN.md § E-1 ships everything in one PR. Kickoff orchestrator
recommendation flags this as the largest single PR of the rollout
(4 new merge files + 2 user-visible migrations + harness refactor +
steady-state scaffold + D-1 reconcile retrofit). Two options:

- **Option A — single mega-PR.** Audit lists every file; one ship
  cycle covers everything. Pros: one merge, one rollback target.
  Cons: massive blast radius; if any merge function is wrong, every
  synced store could corrupt; review burden is high.
- **Option B — 5 sequential sub-PRs.** Each sub-PR has its own audit,
  per-PR brief, branch, and PR. Sequence:
  - **E-1a** — `tests/index.html` SW cache-poisoning harness fix
    (de-risks every downstream test cycle). Engine-only on test
    infra; very small.
  - **E-1b** — `SyncEngine.startSteadyState()` scaffold +
    per-store merge dispatcher + `sync-firestore.js`
    `runTransaction` CAS wrapper. No real merge logic; dispatchers
    are stubs.
  - **E-1c** — `js/sync-merge-meds.js` (wires D-2's
    `reconcileDoseLog` at both call sites including D-1's
    reconcile retrofit + F15 toast subscriber).
  - **E-1d** — `js/sync-merge-history.js` + F3 BFRB consolidation
    + F8 distraction sessionId-keyed (largest single sub-PR;
    touches user-visible state via migration).
  - **E-1e** — `js/sync-merge-rest-log.js` + `js/sync-merge-presets.js`
    + presets `deletedAt` tombstone semantics.

**Orchestrator recommendation: Option B.** Matches the rollout's
"one PR per Stage row" pattern from Stage B (B-1 / B-2 / B-3 / B-4
were each their own PR despite the original spec bundling them).
Keeps each sub-PR's blast radius small enough to revert cleanly.
E-1a in particular pays for itself: D-2's engine-tester burned hours
chasing the SW cache issue; doing the fix as its own PR first means
every downstream sub-PR's test cycle is reliable.

**If Kyle picks Option A:** orchestrator re-drafts THIS file as a
single mega-PR brief covering everything below in one audit cycle.
**If Kyle picks Option B:** orchestrator deletes this file and
re-drafts as `E-1a-PROMPT.md`, then `E-1b-PROMPT.md` etc. become
their own kickoffs (one per sub-PR, sequential merge).

> ⚠️ Every TODO below assumes the answer feeds into a single audit.
> If Option B wins, TODO #1 / #2 / #4 / #7 get partitioned across
> sub-PRs (e.g., TODO #1 lives in E-1d's brief; TODO #4 lives in
> E-1c's; TODO #7 lives in E-1a's). The orchestrator will re-shard
> at re-draft time.

---

### TODO #1 — F3 BFRB stream choice

PLAN.md § E-1 recommends consolidating `bfrbs_global` / `flow_bfrbs` /
`pomodoro_bfrbs` into a single tagged stream `bfrb_events` with
`context: 'flow' | 'pomodoro' | 'global'`. Alternatives:

- **(a)** Consolidate into `bfrb_events`. Single sync surface, single
  query for "today's BFRBs across all contexts." Migration runs once
  in `loadState`. Idempotency required (don't double-count if
  migration runs twice; legacy keys deleted only after `bfrb_events`
  write succeeds).
- **(b)** Keep three separate streams; sync each independently. No
  migration; three sync surfaces; analytics has to union them
  manually (current behavior in `js/analytics.js:302–335`).

Sub-questions if (a) wins:
- **Migration semantics:** delete legacy keys on next save, or keep
  for one release? Kickoff PLAN.md note (line 363) says "keep
  legacy keys for one release before deleting" — confirm.
- **Idempotency:** what guard prevents a re-run from double-counting
  legacy entries already migrated? (Suggested: write
  `bfrb_events` version marker + skip migration if marker exists.)
- **Schema:** `bfrb_events: [{ takenAt, context, sessionId?,
  deviceId, updatedAt, schemaVersion }]`?  `sessionId` only when
  `context !== 'global'`?

**Orchestrator recommendation: (a) consolidate**, matches PLAN.md
default. **TODO for Kyle: confirm (a) or pick (b); resolve migration
semantics + idempotency guard.**

---

### TODO #2 — F8 distraction log choice

PLAN.md § E-1 recommends moving distraction logs to `sessionId`-keyed
storage (`flow_distractions/{sessionId}` and
`pomodoro_distractions/{sessionId}`). Alternatives:

- **(a)** sessionId-keyed maps. UI filters by current session. Reset
  is implicit (drop the key when session resets). No tombstones.
- **(b)** Keep flat list (current behavior) + add tombstones for
  deletes (`{ id, deletedAt }`).

Sub-questions if (a) wins:
- **Reset semantics:** does the sessionId key get deleted on session
  reset, or kept forever for analytics history?
- **Read path:** `Flow.start()` writes new entries to
  `flow_distractions/{currentSessionId}`; on `Flow.reset()`, drop
  the key? Or carry it forward into history under the saved-session
  record?

**Orchestrator recommendation: (a) sessionId-keyed**, matches
PLAN.md default. **TODO for Kyle: confirm (a) or pick (b); resolve
reset semantics + read path.**

---

### TODO #3 — Steady-state loop cadence

PLAN.md § E-1 says "default 30s when foregrounded; paused when
backgrounded via `Platform.network.onChange` + `visibilitychange`."

- **(a)** Fixed 30s for all stores.
- **(b)** Per-store cadence — meds + history more often (15s?),
  presets + rest_log less often (60s?).
- **(c)** Adaptive — back off when no recent local writes; speed up
  on user-action.

Until E-3 ships real-time `onSnapshot` listeners, polling is the only
sync mechanism. 30s is a reasonable starting point.

**Orchestrator recommendation: (a) fixed 30s for all stores in E-1**,
revisit in E-3 when listeners replace polling. **TODO for Kyle:
confirm 30s, or set a different default.**

---

### TODO #4 — F15 toast wiring readiness

B-4 shipped the toast UI scaffold (PR #61). E-1's meds merge fires
the toast when ≥2 remote `doseLog` entries arrive in a single merge
cycle. D-2 wired the `onMergeComplete` event-emit hook (PR #64);
E-1c's meds merge counts arrivals + emits the F15-eligible signal.

- **(a)** E-1 (or E-1c) wires the toast subscriber. User sees a
  toast on cross-device dose arrivals.
- **(b)** Defer toast subscriber to E-3. E-1 emits the event but
  no UI-visible behavior change.

**Orchestrator recommendation: (a) wire in E-1c**, since the toast
UI scaffold is already shipped and unsubscribed. Confirms the
end-to-end loop before E-2 (offline buffer) lands. **TODO for Kyle:
confirm B-4's toast surface is ready to consume the event, or defer
to E-3.**

---

### TODO #5 — CAS refuse-writeback user surface

If Device B reads a meds record with `schemaVersion: 2` from a
future Device A, B's `runTransaction` aborts and refuses to write
back (per-record CAS). What does the user see?

- **(a)** Nothing in E-1. Event is emitted; UI surface ships in E-3
  (per PLAN.md § E-3 line 393, `Toast.downlevelWarning`).
- **(b)** Show a non-blocking console warning in E-1, no toast.
- **(c)** Ship a minimal toast in E-1; iterate in E-3.

**Orchestrator recommendation: (a) defer toast to E-3**, matches
PLAN.md § E-3. E-1 emits the event for E-3 to consume. **TODO for
Kyle: confirm.**

---

### TODO #6 — Backgrounding semantics

PLAN.md § E-1 says the loop "pauses when backgrounded via
`Platform.network.onChange` + `visibilitychange`." Native iOS pauses
the WebView anyway. Edge case: user backgrounds the app at t=29s
into a 30s cycle, foregrounds at t=31s.

- **(a)** On foreground resume, kick off a merge cycle immediately
  (catch-up).
- **(b)** Wait for the next scheduled 30s tick (could be up to 30s
  late).
- **(c)** Track time-since-last-merge; if > cadence, fire immediately
  on resume; else wait for next tick.

UX implication: "did my dose log on phone show up the moment I
opened laptop?" Option (a) and (c) make this feel instant; (b) can
delay up to 30s.

**Orchestrator recommendation: (c) tracked catch-up**, balances
"feel instant on resume" with "don't double-fire on rapid
fore/background toggles." **TODO for Kyle: confirm or pick simpler
(a).**

---

### TODO #7 — Harness refactor approach

D-2's engine-tester surfaced an SW cache-poisoning issue:
`tests/index.html` on `localhost:8765` (same origin as the app)
caches stale `js/*.js` because `js/app.js` registers the SW. Three
proposed fixes (orchestrator does not prescribe — sync-auditor picks
during Phase 1, but flag the choice here for visibility):

- **(a)** `tests/index.html` adds `?nosw=1` query param the SW
  honors as a skip-registration flag. Smallest blast radius;
  `sw.js` fetch handler unchanged.
- **(b)** `sw.js` fetch handler exempts `/tests/*` paths
  unconditionally. Cleanest at runtime; touches the SW which
  is risky if the version-bump logic is mis-handled.
- **(c)** `tests/index.html` runs at a different path
  (`/test-runner/`) the SW doesn't cache. Requires moving files
  + updating script `src=`s.
- **(d)** Some fourth path the audit identifies.

D-2's workaround (run on `127.0.0.1:8766` instead of `localhost:8765`)
is NOT a fix — different origin tricks the SW, but it's a manual
override every tester has to remember. The harness fix makes the
default `tests/index.html?fresh=verify` reliable.

**Orchestrator recommendation: (a)** smallest blast radius; SW
behavior change is one conditional. Audit confirms or picks (b)/(c).
**TODO for Kyle: confirm (a), or let sync-auditor pick during
Phase 1.**

---

## Required reading (before any code)

1. `docs/sync-impl/PLAN.md` — find the `### E-1` section (around
   line 336). That is your spec, with the spec-vs-test
   contradictions resolved by TODOs above + decisions Kyle locks in.
2. `docs/CLOUD-SYNC-STRATEGY.md` v2.0 — per-store merge rules. The
   F-numbered invariants E-1 makes live: F1 (per-med ±15-min, D-2
   helper), F3 (BFRB stream consolidation — TODO #1), F8
   (distraction sessionId-keyed — TODO #2), F15 (≥2-entry toast —
   TODO #4), F16 (clock-skew clamp, D-2 helper). F-numbered
   invariants E-1 preserves: F4 (re-derive `lastTakenAt`, D-2
   wired), F13 (write gate), F14 (1000-entry cap), F19a
   (refuse-writeback), F19b (history spread pattern).
3. `docs/sync-impl/audits/D-2-AUDIT.md` — D-2 shipped
   `MedsManager.reconcileDoseLog` + `onMergeComplete` as a
   callable helper. E-1c's meds merge is the first live call site.
4. `docs/sync-impl/audits/D-1-AUDIT.md` — D-1 shipped
   `reconcileImportedBucket` with the no-op seam at
   `js/sync-engine.js:1253–1261`. E-1c retrofits the actual
   `reconcileDoseLog` call at that seam (per D-2 Decision #2).
5. `docs/sync-impl/audits/C-1-AUDIT.md` — `_hydrateWriteRaw`
   privileged-write pattern. E-1's steady-state merge uses the same
   `SyncState.canWrite()` gate; merge writes go through whatever
   pattern the audit picks (suggested: extend with
   `_mergeWriteRaw` mirroring `_hydrateWriteRaw` /
   `_reconcileWriteRaw`).
6. `js/sync-engine.js`:
   - Lines 1253–1261 — the D-2 plug-in seam comment block. E-1c
     replaces this with the actual call.
   - The existing `_mergeMeds`, `_mergeHistory`, `_mergeRestLog`,
     `_mergeLWWArray` functions used in `reconcileImportedBucket` —
     these are the per-store merge primitives E-1 either keeps or
     extracts into the new `js/sync-merge-*.js` files.
   - `SyncState` / `canWrite()` gate from F13.
   - The existing event-dispatch via `emit(...)` — `onMergeComplete`
     hook fires through this.
7. `js/meds.js` — D-2's `reconcileDoseLog(med, incomingEntries)`
   helper (lines around 19–28 + 217–248 for `KNOWN_MED_KEYS` and
   the F19a refuse-writeback gate). E-1c calls this.
8. `js/schema.js` — invariant stamping helpers
   (`Schema.stampForWrite`, `Schema.isFutureRecord`). ALL writes
   from E-1's merge functions go through `stampForWrite`.
9. `js/history.js`, `js/recovery-ui.js`, `js/presets.js` — the
   other three synced stores. E-1 ships per-store merge files
   that union cloud ∪ local for each.
10. `js/global-bfrb.js`, `js/analytics.js:302–335`, `js/export.js`
    (lines 82, 86, 100) — current BFRB storage call sites.
    F3 migration (TODO #1) touches all of these IF Kyle picks
    consolidate.
11. `js/flow.js`, `js/flow-ui.js`, `js/pomodoro.js`,
    `js/pomodoro-ui.js` — current distraction-log storage
    (`flow_distractions` / `pomodoro_distractions` keys). F8
    migration (TODO #2) touches these IF Kyle picks sessionId-keyed.
12. `tests/index.html` script load order + `sw.js` fetch handler —
    E-1a's harness fix (TODO #7) touches one or both depending on
    which option wins.

---

## What this PR ships

### CRITICAL: SW cache-poisoning harness refactor (E-1a if split)

D-2's engine-tester surfaced this. The fix MUST land in E-1's first
commit (or E-1a's only commit if split), BEFORE any merge-logic
work, so all downstream test cycles are reliable. See TODO #7 for
approach choice.

**Test scope:** manual — clear browser data → load
`tests/index.html?fresh=verify` → confirm a `js/meds.js` edit shows
up on next reload without needing a SW re-register. Automated test
not feasible since this IS the test harness.

### Engine — periodic merge loop scaffold (E-1b if split)

**`js/sync-engine.js`:**
- New `SyncEngine.startSteadyState({ cadenceMs = 30000 } = {})`:
  - Iterates `SYNCED_STORES` registry (already hardcoded in B-1).
  - For each store, calls the per-store merge function (dispatch
    table maps `'meds' → SyncMergeMeds.merge`, `'history' →
    SyncMergeHistory.merge`, etc.).
  - Cadence loop via `setTimeout` (NOT `setInterval` — avoid
    queuing under load). On `visibilitychange` to hidden, cancel
    pending timeout. On visible, see TODO #6 for resume behavior.
  - Per-cycle: `SyncState.set('syncing')` → run merges →
    `SyncState.set('ready')`. Block concurrent
    `pushSnapshot` / `hydrate` / `reconcile` calls via existing
    `canWrite()` gate.
- `SyncEngine.stopSteadyState()` — cancels the pending timeout,
  emits `'steady-state-stopped'`.
- Emits `'steady-state-cycle'` `{ ok, durations, storesProcessed,
  errors }` after every cycle.

**`js/sync-firestore.js`:**
- New `Firestore.runTransaction(path, txnFn)` wrapper:
  - Web: lazy-import `runTransaction` from gstatic SDK.
  - Native: route to `window.Capacitor.Plugins.FirebaseFirestore`
    transaction API (verify shape; may need adapter).
  - Per-record CAS pattern: txnFn reads remote `schemaVersion`, if
    `remote > local`, return `null` (txnFn convention for "no
    write"). Wrapper converts that into a structured
    `{ kind: 'refuse-writeback', remoteSchemaVersion, localSchemaVersion }`
    return value. Errors normalized to existing
    `{ kind, message, isRetryable, originalError }` shape (B-1).
  - SYNC_DISABLED fast-path when flag is off (mirror existing
    `getDoc` / `setDoc` wrappers).

### Engine — per-store merge files (E-1c / E-1d / E-1e if split)

**`js/sync-merge-meds.js`** (E-1c):
- `SyncMergeMeds.merge({ localRecords, cloudRecords, localDeviceId })`
  → returns `{ merged, arrivals, refuseWritebacks }`.
- Algorithm:
  1. Metadata LWW: for each med, pick the record with higher
     `updatedAt`. Tie-breaker: higher `deviceId` lex order
     (deterministic).
  2. doseLog append-merge: for each merged med, union local +
     cloud `doseLog` arrays. Call
     `MedsManager.reconcileDoseLog(med, cloudIncoming)` (D-2
     helper) — passes the cloud-side entries as `incomingEntries`.
  3. F19a refuse-writeback gate: if `Schema.isFutureRecord(med)`,
     skip the record (don't write back). Increment
     `refuseWritebacks`.
  4. Stamp every merged record via `Schema.stampForWrite` before
     persistence.
  5. Count `arrivals` = (cloud entries written into local doseLog
     that weren't already there). If `arrivals >= 2`, emit the
     F15 toast event (`'meds-arrival' { medId, arrivalCount }`).
- **Retrofit D-1's reconcile seam:** replace the no-op comment
  block at `js/sync-engine.js:1253–1261` with the actual
  `MedsManager.reconcileDoseLog(...)` call on each merged med,
  followed by `MedsManager.onMergeComplete(medId)`. Per D-2
  Decision #2: E-1 owns this retrofit.
- F15 toast subscriber: B-4 shipped the toast UI;
  `js/sync-merge-meds.js` (or a new `js/sync-toast-bridge.js`)
  subscribes to `'meds-arrival'` and routes to `Toast.show(...)`.
  See TODO #4.

**`js/sync-merge-history.js`** (E-1d):
- `SyncMergeHistory.merge({ localRecords, cloudRecords })` →
  returns `{ merged, addedFromCloud, refuseWritebacks }`.
- Algorithm:
  1. Sessions append-merge by `id` (device-prefixed IDs from F2 —
     no cross-device collisions expected).
  2. For each surviving session: `note` and `tags` resolve LWW
     per-field via their existing `updatedAt` (F19b spread
     pattern preserves per-field timestamps).
  3. `phaseLog` dedup by `(deviceId, phaseStartedAt)` — A-1
     already stamps these.
  4. F19a refuse-writeback gate as in meds.
  5. Stamp via `Schema.stampForWrite`.
- Reuses existing `_mergeHistory` primitive in `sync-engine.js` if
  algorithm matches; otherwise extracts.

**`js/sync-merge-rest-log.js`** (E-1e):
- `SyncMergeRestLog.merge({ localRecords, cloudRecords })` →
  returns `{ merged }`.
- Algorithm:
  1. Sleep LWW per-day (key: `YYYY-MM-DD` date string).
  2. Naps append-merge dedup by `(deviceId, startedAt)`.

**`js/sync-merge-presets.js`** (E-1e):
- `SyncMergePresets.merge({ localRecords, cloudRecords })` →
  returns `{ merged }`.
- Algorithm:
  1. Full-record LWW by `id` + `updatedAt`.
  2. Tombstones: if either side has `deletedAt`, surviving record
     keeps `deletedAt` (never resurrect a deleted preset).
- **Schema change:** add `deletedAt: null` to presets envelope.
  `js/presets.js` writes `deletedAt: Date.now()` on delete instead
  of dropping the record. UI filters out `deletedAt != null` from
  the rendered list. KNOWN_PRESET_KEYS (if exists; otherwise add)
  includes `deletedAt`.

### Engine — F3 BFRB stream consolidation (E-1d if split)

Depends on TODO #1 resolution. If consolidate:
- `js/global-bfrb.js`: migration runs once in module-init. Reads
  `bfrbs_global`, `flow_bfrbs`, `pomodoro_bfrbs`; writes
  unioned `bfrb_events` array with `context` tag per entry. Marker
  key `bfrb_events_migrated = '1'` prevents re-run. Legacy keys
  deleted only after `bfrb_events` write succeeds (idempotent).
- All read sites (`js/global-bfrb.js`, `js/analytics.js:302–335`,
  `js/flow-ui.js`, `js/pomodoro-ui.js`) read from `bfrb_events`
  filtered by `context`.
- All write sites write to `bfrb_events` with context tag.
- `js/export.js` (lines 82, 86, 100) — backup includes
  `bfrb_events`, legacy keys included for one release per kickoff
  note (`PLAN.md` § E-1 rollback line 363).

### Engine — F8 distraction sessionId-keyed (E-1d if split)

Depends on TODO #2 resolution. If sessionId-keyed:
- `js/flow.js` / `js/flow-ui.js`: writes to
  `flow_distractions/{currentSessionId}` instead of flat
  `flow_distractions`. On `Flow.reset()`, key is dropped (or
  rolled forward into the saved-session record).
- `js/pomodoro.js` / `js/pomodoro-ui.js`: analogous.
- Migration: on first load, read legacy flat list, write into
  `flow_distractions/legacy` and `pomodoro_distractions/legacy`,
  delete the flat keys after migration succeeds.
- UI: filters by current session id (existing UI already reads
  by session implicitly — refactor confirms the filter).

### Tests — new test files (split across sub-PRs)

For each new merge file, a parallel test file under `tests/`:

- **`tests/sync-merge-meds.test.js`** (E-1c) — ~12–15 cases:
  - Metadata LWW resolves to higher `updatedAt`.
  - doseLog append-merge calls D-2's `reconcileDoseLog` exactly
    once per med.
  - F15 toast fires when `arrivals >= 2`; does NOT fire when
    `arrivals < 2`.
  - F19a refuse-writeback skips future-schema records,
    increments `refuseWritebacks` counter.
  - Idempotent: running merge twice produces same output.
  - CAS abort on stale `schemaVersion` returns
    `refuse-writeback` and preserves on-disk state.
  - D-1 reconcile retrofit: `reconcileImportedBucket` (called
    after E-1 ships) calls `reconcileDoseLog` per merged med +
    fires `onMergeComplete`.

- **`tests/sync-merge-history.test.js`** (E-1d) — ~8–10 cases:
  - Sessions append-merge by `id`.
  - Note/tags LWW per-field.
  - phaseLog dedup by `(deviceId, phaseStartedAt)`.
  - F19a refuse-writeback skips future-schema sessions.
  - Idempotent.

- **`tests/sync-merge-rest-log.test.js`** (E-1e) — ~5–6 cases:
  - Sleep LWW per-day.
  - Naps append-merge dedup by `(deviceId, startedAt)`.
  - Idempotent.

- **`tests/sync-merge-presets.test.js`** (E-1e) — ~6–8 cases:
  - LWW by `id` + `updatedAt`.
  - Tombstone preserved (`deletedAt` never re-set to null).
  - Resurrection prevented (local delete + remote update →
    deletedAt wins).
  - UI filters `deletedAt != null` out.
  - Idempotent.

- **`tests/sync-bfrb-migration.test.js`** (E-1d, IF TODO #1 = (a)) —
  ~5–7 cases:
  - Legacy three-bucket data unions cleanly into `bfrb_events`.
  - Migration is idempotent (re-run guard via marker).
  - Legacy keys deleted only after successful `bfrb_events` write.
  - Read sites return same counts pre/post migration.

- **`tests/sync-distractions-sessionid.test.js`** (E-1d, IF TODO #2 = (a)) —
  ~5–7 cases:
  - New writes go to `{flow,pomodoro}_distractions/{sessionId}`.
  - Legacy flat list migrates to `legacy` bucket on first load.
  - Session reset drops the key.
  - UI filters by current session id.

- **`tests/sync-steady-state.test.js`** (E-1b) — ~6–8 cases:
  - `startSteadyState()` schedules first cycle after `cadenceMs`.
  - `visibilitychange` to hidden cancels pending timeout.
  - Resume on visible behaves per TODO #6.
  - `runTransaction` wraps CAS correctly; `refuse-writeback`
    surfaces as structured return value.
  - Cycle event emitted with `{ ok, durations, storesProcessed,
    errors }`.

**Baseline before E-1: 396** (verify via
`tests/index.html?fresh=verify` in a real browser; 381 D-2 baseline
+ 15 D-2 cases). **Target after E-1 (full mega-PR):** ~440–460
depending on F3/F8 test counts.

### UI wire-up (Phase 4 ui-wirer)

E-1's audit's affected-files table determines whether Phase 4 fires.
Expected UI touches:

- **`js/sync-toast.js` or similar** (existing B-4 surface): E-1c's
  F15 toast subscriber wires the `'meds-arrival'` event to the
  toast UI. If subscriber lives in engine, may be engine-only.
  TODO #4 resolves this.
- **`index.html`** drawer markup IF the settings drawer gets a
  "Last sync: X seconds ago" indicator (PLAN.md § E-3 owns this;
  not E-1). E-1 should NOT add this — defer to E-3.
- **`js/tempo-nav.js`** route registration — none expected; E-1
  has no new pillar/route.
- **`css/styles.css`** — toast styles already exist from B-4; E-1
  does not add new styles.

**If the audit lists ONLY engine + test files, Phase 4 SKIPS** per
orchestrator-prompt autonomous transition rule. Likely outcome for
E-1c/d/e/b/a sub-PRs.

---

## Hard rules

- **Audit before code.** First commit on the branch is
  `docs/sync-impl/audits/<PR-ID>-AUDIT.md` listing affected files +
  risks + test scope. STOP after the audit and wait for review.
- **One mega-PR OR sub-PRs sequential merge.** Whichever wins TODO
  #0, do NOT mix — branches stay independent; each ships, merges,
  then next branches off freshly-merged main.
- **Reuse over re-implementation.** D-2's `reconcileDoseLog`,
  C-1's `_hydrateWriteRaw`, D-1's `_reconcileWriteRaw`, B-1's
  Firestore wrappers, A-1's phaseLog stamping, F19b's history
  spread pattern, `Schema.stampForWrite` — every merge function
  uses these primitives. Do NOT re-implement.
- **F13 write gate.** `SyncEngine.startSteadyState()` flips
  `SyncState` to `'syncing'` for the duration of each cycle and
  back to `'ready'` on completion. Block concurrent engine writes
  via the existing `canWrite()` gate. On cycle error, set to
  `'error'`, emit failure event, retry next cycle.
- **F14 cap preserved.** Post-merge meds doseLog length ≤ 1000.
  D-2's `reconcileDoseLog` enforces this; E-1c relies on it.
- **F19a refuse-writeback preserved.** Every per-store merge skips
  future-schema records and increments a counter. No silent
  mutation.
- **Per-record CAS via `runTransaction`.** Stale-schemaVersion
  writes abort cleanly. E-1's CAS surface emits
  `'refuse-writeback'` events for E-3 to consume.
- **F15 toast hook only in E-1.** Toast UI ships in B-4 (already
  live); E-1 wires the subscriber per TODO #4. No new toast UI in
  E-1.
- **No new persistence keys without explicit decision.** F3 adds
  `bfrb_events` + `bfrb_events_migrated`; F8 changes
  distraction-log key shape. Both gated on TODOs #1 / #2. NO other
  new keys.
- **Service worker cache bump.** `sw.js` `CACHE_NAME` gets bumped
  in EVERY sub-PR that changes a cached web file (pr-shipper
  handles).
- **Web GitHub Pages deploy stays byte-equivalent** except for the
  intentional changes per sub-PR.

---

## IMPORTANT: D-2 (PR #64) is shipped on main

D-2 shipped:
- `MedsManager.reconcileDoseLog(med, incomingEntries)` — pure
  helper. E-1c's first live call site.
- `MedsManager.onMergeComplete(medId)` — wired to fire
  `recomputeLastTakenAt` (F4) + emit `onMergeComplete` event. E-1c
  subscribes for F15 toast routing.
- The no-op comment seam at `js/sync-engine.js:1253–1261`. E-1c
  retrofits this with the actual call.
- 15 new test cases (381 → 396 baseline).

Branch E-1 (or E-1a if split) off freshly-merged `main` at
`b0fb615`.

---

## Test-harness gap — RESOLVED IN E-1a (TODO #7)

D-2's engine-tester surfaced the SW cache-poisoning issue. The
workaround (run on `127.0.0.1:8766`) is fragile. E-1a's harness fix
makes `tests/index.html?fresh=verify` reliable on the canonical
`localhost:8765` port. See TODO #7.

After E-1a ships, all subsequent E-1b/c/d/e test cycles use the
default port without the workaround.

---

## Deliverable

### If Option A (mega-PR) wins TODO #0:

Branch `feat/sync-stage-e-merge-loop`, PR against `main`. Commits:

1. `docs(sync-impl): E-1 audit + steady-state merge spec` — audit
   doc with affected-files table + risks + test scope. STOP HERE.
2. After greenlight: harness fix + steady-state scaffold + all
   per-store merges + F3 + F8 + tests in one branch. May land as
   multiple commits but one PR.

PR title once all commits land:
`feat(sync): Stage E steady-state merge loop (E-1)`.

### If Option B (sub-PR split) wins TODO #0:

Five separate branches + PRs, sequential merge:

1. **E-1a — `feat/sync-stage-e-harness-fix`**
   - Commits: `docs(sync-impl): E-1a audit + harness-fix spec`
     → `fix(tests): SW cache-poisoning skip for tests/* (E-1a)`.
   - PR title: `fix(tests): tests/index.html SW cache-poisoning fix (E-1a)`.
2. **E-1b — `feat/sync-stage-e-merge-loop`**
   - Commits: `docs(sync-impl): E-1b audit + steady-state spec`
     → `feat(sync): startSteadyState + runTransaction CAS (E-1b)`.
   - PR title: `feat(sync): steady-state merge loop scaffold (E-1b)`.
3. **E-1c — `feat/sync-stage-e-meds-merge`**
   - Commits: `docs(sync-impl): E-1c audit + meds-merge spec`
     → `feat(sync): meds metadata LWW + doseLog reconcile (E-1c)`.
   - PR title: `feat(sync): meds merge + D-1 reconcile retrofit + F15 toast (E-1c)`.
4. **E-1d — `feat/sync-stage-e-history-merge`**
   - Commits: `docs(sync-impl): E-1d audit + history/F3/F8 spec`
     → `feat(sync): history merge + BFRB consolidate + distraction sessionId (E-1d)`.
   - PR title: `feat(sync): history merge + F3 BFRB + F8 distractions (E-1d)`.
5. **E-1e — `feat/sync-stage-e-rest-presets-merge`**
   - Commits: `docs(sync-impl): E-1e audit + rest_log/presets spec`
     → `feat(sync): rest_log merge + presets LWW + tombstones (E-1e)`.
   - PR title: `feat(sync): rest_log + presets merge with tombstones (E-1e)`.

Each branches off freshly-merged `main`. pr-shipper PAUSES before
each push.

---

## Manual verification (after E-1 merge — pre-E-2 smoke)

E-1 ships the first user-observable cross-device sync behavior. Full
verification requires two physical devices.

### Smoke (single-device, browser-only)

1. Run `tests/index.html?fresh=verify` in a real browser. Confirm
   total test count matches target (~440–460 if mega-PR ships, or
   per-sub-PR target if split).
2. Confirm all new `describe('sync-merge-*')` blocks run + pass.
3. Confirm baseline 396 still passes (no regressions).
4. F3 migration smoke (IF TODO #1 = (a)): load app in fresh
   profile with synthetic `flow_bfrbs` + `pomodoro_bfrbs` +
   `bfrbs_global` entries; confirm `bfrb_events` has the union;
   confirm legacy keys deleted; confirm marker set.
5. F8 distraction smoke (IF TODO #2 = (a)): start a Flow session,
   log a distraction, confirm write lands in
   `flow_distractions/{sessionId}`. Reset session, confirm key
   dropped or rolled forward.

### End-to-end (two devices)

1. Sign in on Device A (laptop). Log a med dose.
2. Sign in on Device B (phone via Capacitor) with same Google
   account. Wait up to 30s (or however TODO #3 resolves cadence).
   Confirm dose appears.
3. On Device A, edit a session note. Wait 30s. Confirm Device B
   shows updated note (LWW per-field).
4. F15 toast: log ≥2 doses on Device A within 30s; on Device B,
   confirm toast fires when both arrive in single merge cycle.
5. CAS refuse-writeback: manually set `schemaVersion: 999` on one
   med on Device A. Device B's merge skips the record (no
   mutation); structured event emitted (no toast in E-1 per TODO
   #5).
6. Backgrounding (TODO #6 verification): background Device B for
   60s, foreground; confirm sync behavior matches resolved
   TODO #6 option.

---

## After E-1

E-1 ships the steady-state merge loop. The remaining sync work is
Stage E:

- **E-2** — offline buffer (`js/sync-buffer.js` pending-op queue
  in IndexedDB with `originalWallClock` preservation; FIFO drain
  on reconnect; op compaction; 1000-op cap).
- **E-3** — real-time `onSnapshot` listeners (replace 30s polling
  with push-based updates) + refuse-writeback toast
  (`Toast.downlevelWarning` consumes E-1's emitted event).

After Stage E, the rollout is feature-complete. F-1 (manifest
registry) stays deferred indefinitely.
