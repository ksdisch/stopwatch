# Tempo cloud-sync — implement PR E-1b (Stage E: steady-state scaffold + CAS wrapper)

You're working on Tempo, a vanilla-JS PWA + Capacitor iOS app. The
cloud-sync implementation plan is at `docs/sync-impl/PLAN.md` on
`main`. Stage 0, Stage A close-out, Stage B (B-1 → B-4), Stage C
(C-1), Stage D (D-1 + D-2), and Stage E sub-PR E-1a are all shipped
(PRs #46–#65).

E-1b is the **second of five Stage E sub-PRs**. It is engine-only
scaffolding — no merge decisions, no F3 / F8 / F15 wire-up, no
end-user-visible behavior change. Its single goal is to land the
plumbing that E-1c/d/e will fill in:

1. `SyncEngine.startSteadyState()` — periodic merge timer scaffold
2. Per-store merge dispatcher — iterates the existing `SYNCED_STORES`
   registry and calls a per-store merge function
3. `SyncFirestore.runTransaction(fn)` — replace the B-3 stub with a
   real CAS wrapper that does the per-record schemaVersion-refuse-
   writeback check before write
4. (Possibly) Skeleton merge files at `js/sync-merge-{meds,history,
   rest-log,presets}.js` — see TODO #1 for whether these land in
   E-1b or are deferred to E-1c/d/e

**E-1b does NOT** ship any per-store merge logic, F3 BFRB
consolidation, F8 distraction sessionId migration, F15 toast counter,
D-1 reconcile retrofit, real-time listeners (E-3), offline buffer
(E-2), or any UI surface. Those live in E-1c through E-1e + E-2/E-3.

---

## TODO #1 — Scope split: do skeleton merge files land in E-1b or
                 defer to E-1c/d/e? (Kyle, resolve before Phase 1)

**The PLAN.md line 40 description for E-1b is:**

> **E-1b** (scaffold + `SyncEngine.startSteadyState()` + per-store
> merge dispatcher + `sync-firestore.js` `runTransaction` CAS wrapper)

Per-store merge implementations are explicitly E-1c (meds, calls
`reconcileDoseLog`), E-1d (history + F3 BFRB + F8 distractions),
E-1e (rest_log + presets + final wire-up). But there's ambiguity in
what the "per-store merge dispatcher" calls: does it call into
**files that exist with skeletons**, or **files that don't exist
yet**?

**Two options:**

**(a) Defer all merge files to E-1c/d/e.** E-1b's dispatcher
references the merge files by name but tolerates their absence at
boot (feature-detect + skip-with-warning). E-1c then creates
`js/sync-merge-meds.js` with the real implementation; the dispatcher
auto-picks it up. Smallest E-1b PR. Cons: the dispatcher pattern is
half-built and not exercise-able until E-1c lands.

**(b) Ship 4 skeleton merge files in E-1b.** Each file (`js/sync-
merge-{meds,history,rest-log,presets}.js`) ships with an IIFE that
exposes a `merge(snapshot)` function that throws
`Error('not implemented until E-1c/d/e')`. Dispatcher invokes them
all. Tests verify the dispatcher correctly catches + reports per-
store failures without breaking the loop. Slightly bigger E-1b PR
but the scaffold is exercise-able + testable. Cons: 4 new files just
to throw — minor noise.

**Auditor's lean:** **(b)** — the dispatcher pattern is the load-
bearing piece of E-1b; making it testable in isolation (without
waiting for E-1c) increases confidence the scaffold is correct. The
4 stub files are ~10 lines each.

**Kyle, pick before Phase 1:**
- **Pick A** — Defer merge files; E-1b dispatcher is feature-detect.
- **Pick B (recommended)** — Ship 4 stub merge files in E-1b.
- **Pick C** — Override (specify).

---

## TODO #2 — Background pause mechanism for the steady-state timer

**The PLAN.md line 346 description says:**

> `startSteadyState()` — periodic timer (configurable interval;
> default 30s when foregrounded, paused when backgrounded via
> `Platform.network.onChange` + `visibilitychange`).

But `Platform.network.onChange` doesn't exist yet — PLAN.md §E-2
(line 379) introduces it. For E-1b, what does the pause mechanism
look like?

**Three options:**

**(a) `visibilitychange` only.** Timer pauses when
`document.visibilityState !== 'visible'`. No network detection.
When E-2 adds `Platform.network`, the timer adds a second pause
condition. Simplest, least scope creep.

**(b) `visibilitychange` + feature-detect `Platform.network`.**
Timer pauses on either visibility change OR `Platform.network`
absence (if `Platform.network` exists). If `Platform.network` is
missing, only `visibilitychange` applies. Forward-compatible —
when E-2 lands `Platform.network`, E-1b's timer auto-picks it up
with no code change.

**(c) No pause logic — hard 30s interval.** Simplest. Timer fires
every 30s regardless of foreground/background/network state. Tests
each per-store merge. Pause logic deferred entirely to E-3 (which
needs it for `onSnapshot` listener throttling anyway).

**Auditor's lean:** **(b)** — feature-detect is forward-compatible,
matches the rest of the codebase's `typeof X !== 'undefined'`
defensive patterns (see `SyncEngine.init`'s SyncAuth check at line
115). Tests are straightforward (mock the global).

**Kyle, pick before Phase 1:**
- **Pick A** — `visibilitychange` only.
- **Pick B (recommended)** — `visibilitychange` + feature-detect
  `Platform.network`.
- **Pick C** — No pause logic for E-1b.

---

## TODO #3 — Interval configurability and storage

**PLAN.md says "configurable interval; default 30s when foregrounded".**

E-1b ships no UI, so the configuration surface is one of:

**(a) Hardcoded constant.** `const STEADY_STATE_INTERVAL_MS = 30000;`
inside `js/sync-engine.js`. Settings drawer wiring (when it lands)
would change the constant; until then, nobody can tune the interval.

**(b) localStorage key.** `tempo_sync_steady_interval_ms` (numeric
string, default `'30000'`). Engine reads on `startSteadyState()` and
clamps to a sane range (e.g., `[10000, 600000]` — 10s minimum,
10-minute maximum). Tunable via DevTools without code. Settings
drawer in a later PR writes to this key.

**(c) Both — constant default + localStorage override.** Read the
key; fall back to constant if absent or invalid. Most forgiving.

**Auditor's lean:** **(c)** — matches the pattern in `js/persistence.
js` (constants with localStorage override) and `js/sync-flag.js`
(localStorage-backed primitive). One extra localStorage read at
startup is negligible.

**Kyle, pick before Phase 1:**
- **Pick A** — Hardcoded only.
- **Pick B** — localStorage only.
- **Pick C (recommended)** — Constant default + localStorage override.

---

## TODO #4 — Does `startSteadyState()` get *called* from `init()` yet?

**The lifecycle question:** E-1b defines and exports
`SyncEngine.startSteadyState()`. Should `SyncEngine.init()` (the
current boot entry point) auto-invoke it after the auth-change
gate fires (matching the existing `_maybeAutoHydrate` pattern at
`js/sync-engine.js:135-150`)?

**Three options:**

**(a) Auto-start from `init()` after hydrate.** Mirrors C-1's
auto-hydrate pattern. Pros: end-to-end sync works once auth + hydrate
complete. Cons: with Pick B from TODO #1, each timer tick throws 4
"not implemented" errors per store. Noisy console; could be filtered
to debug-only.

**(b) Define and export only; no caller until E-1e.** `init()` does
NOT call `startSteadyState()`. Tests invoke it directly. E-1e wires
the auto-start once all merge logic is implemented. Cleanest
boundary — no noisy errors in production console until the actual
merge logic ships.

**(c) Auto-start gated behind a new localStorage flag** (e.g.,
`tempo_sync_steady_state_enabled = '1'`, default off). Lets Kyle
manually enable steady-state polling on his laptop for end-to-end
testing without polluting other users' consoles. Default off means
E-1b ships dormant in production.

**Auditor's lean:** **(c)** — matches the `tempo_sync_enabled`
master-switch precedent. Default-off means E-1b ships zero behavior
change for any user. Kyle can flip the dev flag to exercise the
scaffold end-to-end on his laptop. E-1e flips the default to `'1'`
or removes the gate entirely.

**Kyle, pick before Phase 1:**
- **Pick A** — Auto-start from `init()` post-hydrate (loud errors).
- **Pick B** — Define + export only; no caller until E-1e.
- **Pick C (recommended)** — Auto-start gated behind
  `tempo_sync_steady_state_enabled` (default off).

---

## TODO #5 — `runTransaction` CAS wrapper: schemaVersion check
                granularity + native plugin support

**PLAN.md line 355-357 spec:**

> Read schemaVersion → if remote > local, abort (refuse-writeback).
> Else, write new record with bumped `updatedAt`.

**Three implementation sub-decisions:**

**5a. Schema read granularity.** Inside the transaction, do we:
- (i) Read the full remote document, parse its `schemaVersion`, then
  compare — works for both web SDK and Capacitor plugin, but reads
  the entire record (potentially large for `history`).
- (ii) Read only the `schemaVersion` field via Firestore's field
  selector — saves bytes but the web SDK's `runTransaction.get()`
  doesn't support field-mask; we'd have to use a separate `getDoc`
  with field-mask outside the transaction (loses atomicity).

**Lean:** (i). Field-mask micro-optimization isn't worth losing CAS
atomicity. The records are small (meds: <1 KB; history sessions:
~500 bytes; presets: <200 bytes). History sessions are individual
docs, not a single fat doc.

**5b. Native plugin parity.** The `@capacitor-firebase/firestore`
plugin's `runTransaction` shape may differ from the web SDK. Confirm
the plugin exposes a `runTransaction` method; if not, we either:
- Implement web-only CAS in E-1b and queue a follow-up for native.
- Use the plugin's per-write conditional-update (if it has one) as
  a CAS substitute.
- Native parity is a known follow-up (call it out in the audit's
  Risks section).

**Lean:** Web-only E-1b CAS; native parity is a follow-up audit
item. Kyle's iPhone use case during E-1b verification is acceptable-
read-only (browser tests cover the CAS path). Native write path
ships in a follow-up.

**5c. Error normalization.** Reuse `_normalizeError` + `_wrap` for
all CAS error paths. Add a new `kind: 'refuse-writeback'` (or
`kind: 'cas-stale-schema'`) to distinguish the F19a abort case from
generic permission-denied / network / not-found errors. UI surfaces
(B-4 toast, future downlevel warning in E-3) can branch on this kind.

**Lean:** Add `kind: 'refuse-writeback'`. Distinct from the existing
4 kinds in `js/sync-firestore.js:56-114`.

**Kyle:** Accept all three leans, or override any?
- **Pick A (recommended)** — Accept 5a (i) + 5b (web-only +
  documented follow-up) + 5c (`kind: 'refuse-writeback'`).
- **Pick B** — Override (specify which).

---

## TODO #6 — Test file structure: new files vs extend existing?

**The existing engine test files for sync:**

```
tests/sync-stamps.test.js       (A-1)
tests/sync-engine.test.js       (B-1, B-3 push, C-1 hydrate, D-1)
tests/sync-auth.test.js         (B-2)
tests/sync-uploader.test.js     (B-3)
tests/sync-hydrate.test.js      (C-1)
tests/sync-imported-bucket.test.js (D-1)
```

**Two options for E-1b tests:**

**(a) Extend existing files.**
- `tests/sync-engine.test.js` gets a new `describe('SyncEngine —
  startSteadyState')` block.
- `tests/sync-uploader.test.js` gets a new `describe('SyncFirestore
  — runTransaction CAS')` block (replacing the existing "stub
  throws documented error" test).
- Pros: aligns with the project's "tests live near the engine" pattern.

**(b) New per-PR test files.**
- `tests/sync-steady-state.test.js` — `startSteadyState`, dispatcher,
  pause/resume.
- `tests/sync-cas-wrapper.test.js` — `runTransaction` CAS, refuse-
  writeback, error normalization.
- Pros: clear PR-to-test mapping; easier to grep history for
  "what did E-1b add?".

**Auditor's lean:** **(a)** — matches D-2's pattern (extended
`tests/meds.test.js` with new describe blocks rather than creating
`tests/meds-reconcile.test.js`). Keeps the test surface tight.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Extend existing files.
- **Pick B** — New per-PR test files.

---

## TODO #7 — F19a refuse-writeback gate layering

**Per `docs/CLOUD-SYNC-STRATEGY.md` v2.0:**

F19a is the refuse-writeback gate that prevents a Device A on
schema v1 from overwriting a future schema v2 record on the cloud
that came from Device B (newer client). D-2 already shipped F19a at
the **`reconcileDoseLog`** level (the doseLog merge skips future-
schema entries). E-1e is supposed to ship the **broader merge-loop
F19a** for non-meds stores.

**The question for E-1b:** does the `runTransaction` CAS wrapper's
schemaVersion check satisfy part of F19a, or is it a separate layer?

**Answer (auditor's read):** the `runTransaction` CAS check is the
**per-record** F19a gate — it prevents a stale-schema record from
being overwritten one record at a time. E-1e ships the **per-store**
F19a (when reading a snapshot, skip any entire records whose
schemaVersion > local SCHEMA_VERSION before passing them to the
merge function).

Both layers are needed:
- CAS-level F19a (E-1b) — protects writes one record at a time;
  fires on the actual write attempt.
- Store-level F19a (E-1e) — protects reads at the snapshot level;
  prevents the merge function from ever seeing a future record.

**Kyle, confirm:** E-1b ships **CAS-level F19a only** (single record
at write time). E-1e ships the per-store snapshot gate.
- **Pick A (recommended)** — Confirmed. Two layers, this PR is only
  the CAS layer.
- **Pick B** — Override (specify).

---

## Approach + file list (after Kyle resolves TODOs 1–7)

The audit will codify this. Provisional shape based on the auditor's
recommended picks:

**Files modified:**
- `js/sync-engine.js` — Add `startSteadyState()`, `stopSteadyState()`,
  `_runMergeCycle()` (the dispatcher), `_setupVisibilityListener()`,
  `_setupNetworkListener()` (feature-detect). Add new localStorage
  keys: `tempo_sync_steady_state_enabled`, `tempo_sync_steady_interval_ms`.
- `js/sync-firestore.js` — Replace `runTransaction` stub (line
  284-285) with real CAS implementation. Add `kind: 'refuse-writeback'`
  to the error-kind union. Comment-document the native parity
  follow-up.

**Files created (Pick B from TODO #1):**
- `js/sync-merge-meds.js` — IIFE exposing `merge(snapshot)` that
  throws `not implemented until E-1c`.
- `js/sync-merge-history.js` — same, throws `not implemented until
  E-1d`.
- `js/sync-merge-rest-log.js` — same, throws `not implemented until
  E-1e`.
- `js/sync-merge-presets.js` — same, throws `not implemented until
  E-1e`.

**Tests modified (Pick A from TODO #6):**
- `tests/sync-engine.test.js` — Add `SyncEngine — startSteadyState`
  describe block covering: timer lifecycle, dispatcher iteration,
  per-store error tolerance, visibilitychange pause, feature-detect
  Platform.network pause, localStorage interval override, dev-flag
  gating.
- `tests/sync-uploader.test.js` — Replace the existing
  `runTransaction — stub throws` test with `runTransaction — CAS
  wrapper` describe block covering: success path, schemaVersion-
  abort-writeback, error normalization for the new `kind: 'refuse-
  writeback'`, web SDK lazy-load path, native plugin documented gap.

**`sw.js` `CACHE_NAME` bump:** Yes — E-1b modifies `js/sync-engine.js`
(cached web file). Bump from `'stopwatch-v74-e1a-test-harness-fix'`
→ `'stopwatch-v75-e1b-steady-state-scaffold'` (or similar; pr-
shipper finalizes the exact string).

**`index.html` `<script>` tags:** If Pick B from TODO #1 ships 4
new `js/sync-merge-*.js` files, add 4 new `<script>` tags after the
existing `<script src="js/sync-manual-dedupe.js"></script>` line
(see CLAUDE.md script load order). Tests will need them in
`tests/index.html` too (for the engine-tester phase).

---

## Hard rules (orchestrator + subagents read this)

- **Audit before code.** Phase 1 = sync-auditor → produces
  `docs/sync-impl/audits/E-1b-AUDIT.md`. PAUSE for Kyle to review
  audit + Kyle's TODO resolutions baked in before Phase 2 fires.
- **No Phase 4 ui-wirer.** E-1b's affected-files table contains zero
  UI files (`js/*-ui.js`, `index.html`, `css/*.css`, `js/tempo-nav.js`).
  Phase 3 → Phase 5 directly.
- **All writes to synced stores stamp `deviceId` + `updatedAt` +
  `schemaVersion`** via `js/schema.js` helpers. E-1b's CAS wrapper
  must verify `schemaVersion` BEFORE writing, and the write itself
  must stamp the standard envelope.
- **`pr-shipper` PAUSES before push.** Kyle's standing rule.
- **F-invariant guardrails** (from `docs/CLOUD-SYNC-STRATEGY.md` v2.0):
  - F13 write gate honored — steady-state writes route through
    `SyncState.canWrite()` (or its equivalent for the merge path).
  - F19a refuse-writeback — at the CAS layer (this PR's scope).
  - F21 alarmFired structural exclusion — confirmed unaffected by
    this PR (no new fields stamped on sync envelopes).

---

## After E-1b merges

- **E-1c** — Meds steady-state merge implementation. Wires
  `reconcileDoseLog` (D-2) into the merge dispatcher. Adds F15
  ≥2-entry remote-arrival counter for the toast surface.
- **E-1d** — History steady-state merge. F3 BFRB consolidation
  (`bfrbs_global` / `flow_bfrbs` / `pomodoro_bfrbs` → unified
  `bfrb_events` stream). F8 distraction sessionId-keyed migration.
- **E-1e** — Rest_log + presets steady-state merge. Final wire-up
  of `startSteadyState()` auto-invoke from `SyncEngine.init()`
  (removes the `tempo_sync_steady_state_enabled` gate).
- **E-2** — Offline buffer (`js/sync-buffer.js`).
- **E-3** — Real-time listeners (`onSnapshot`) + downlevel-client
  toast.

---

## Branch + commit conventions

- **Branch:** `feat/sync-stage-e-steady-scaffold`
- **PR title:** `feat(sync): startSteadyState scaffold + CAS wrapper (E-1b)`
- **Commit type prefix:** `feat` for the main implementation, `docs`
  for the audit + SESSION-LOG entries.

---

**Kyle: please resolve TODOs 1–7 before saying "Go" so the audit
reflects your picks. The auditor's recommended picks are
(a)/(b)/(c) per each TODO; you can accept all defaults with a one-
line "all recommended picks" or override individually.**
