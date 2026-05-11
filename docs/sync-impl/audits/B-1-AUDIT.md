# B-1 · Stage B SyncEngine module scaffold

**PR:** `feat/sync-stage-b-engine-scaffold` → `main`
**Scope:** Land the SyncEngine module skeleton + hardcoded store registry +
read-only `snapshotForSync()` adapters on each synced store. Zero network
calls, zero behavior change when `tempo_sync_enabled = '0'`.
**Status:** Audit-only commit. Code commit follows after human review.

This audit enumerates every site the code commit will touch, the
Recovery / `recovery-ui.js` decision, F-invariant respect map, risks, and
test scope. Goal is to fix blast radius *before* writing code so review
focuses on the right surfaces.

---

## Goal

Land `js/sync-engine.js` (registry + lifecycle) and `js/sync-flag.js`
(`tempo_sync_enabled` localStorage key + getter/setter) plus
`snapshotForSync()` adapters on the four synced stores
(`meds`, `history`, `rest_log`, `presets`). The module is dead code
behind the off-by-default `tempo_sync_enabled` flag; B-2 wires auth, B-3
ships the first cloud byte.

---

## Orchestrator note — does ui-wirer Phase 4 fire?

**No.** The affected-files table contains no `js/*-ui.js` file and no
new DOM surface beyond a one-line `<script>` tag insertion in
`index.html` (the script-tag edit is pr-shipper's job per the audit
contract, not ui-wirer's). The hidden developer toggle for
`tempo_sync_enabled` (see "Out of scope" below) is **deferred** — B-1
ships the localStorage flag plus a getter/setter, and the visible
settings-drawer toggle lands in B-2's "Cloud Sync" section instead.
Workflow: audit → engine-implementer → engine-tester → **skip ui-wirer**
→ pr-shipper.

---

## Headline findings

1. **Recovery decision — choose R1 (snapshot directly on
   `recovery-ui.js`).** The plan's snippet writes
   `Recovery.snapshotForSync()` but the module today is
   `RecoveryUI` per CLAUDE.md State Model (no separate engine —
   `recovery-ui.js` owns `wellness_rest_log` directly via `loadLog()` /
   `saveLog()`). Pulling out an engine module just to host
   `snapshotForSync()` is scope creep that pushes another PR ahead of
   B-1. R1 is justified because (a) `snapshotForSync()` is a **pure read**
   over `localStorage.getItem('wellness_rest_log')` — no DOM access, no
   UI dependency; (b) the existing `loadLog()` is already a pure
   localStorage read that can be reused verbatim; (c) the registry-key
   for B-1's plan is `rest_log`, not `recovery` — the engine/UI naming
   mismatch is cosmetic. Audit registers the adapter as
   `RecoveryUI.snapshotForSync()` and notes the naming discrepancy.
2. **`SYNCED_STORES` registry key rename.** PLAN.md's snippet calls the
   adapter `Recovery.snapshotForSync()`. Use `RecoveryUI.snapshotForSync()`
   verbatim — `RecoveryUI` is the existing singleton name. The wire-format
   store key stays `rest_log` to match `docs/CLOUD-SYNC-STRATEGY.md` and
   the Firestore path in `docs/sync-impl/PLAN.md` §S0-1
   (`users/{uid}/rest_log/{date}`).
3. **`History.snapshotForSync()` is async.** History already lives in
   IndexedDB; `getSessions()` returns a `Promise`. The adapter contract
   therefore returns a Promise too — registry consumers (B-3's
   `pushSnapshot`) `await` every adapter read uniformly. The other three
   adapters are synchronous (`MedsManager`, `Presets`, `RecoveryUI` all
   read localStorage). Wrapping them in `Promise.resolve()` inside the
   adapter `read` callback keeps the registry's iterator code uniform —
   the implementer's choice is whether to make all four `async` or to
   `await` whatever each one returns. Either is fine; the audit
   recommends the uniform `async` shape for B-3's iterator simplicity.
4. **`tempo_sync_enabled` vs `tempo_sync_state`.** Two separate
   localStorage keys, two separate roles. `tempo_sync_state` (F13,
   already shipped in `js/persistence.js`) is the **runtime write
   gate** — gates engine writes during hydrate/stamping. The new
   `tempo_sync_enabled` (B-1) is the **feature flag** — gates whether
   `SyncEngine.init()` does anything at all. B-1 touches only the new
   flag; the existing gate stays as-is.
5. **`snapshotForSync()` adapter contract:** each returns
   `{ deviceId, schemaVersion, payload }`. `deviceId` comes from
   `History.getDeviceId()` (the shared `tempo_device_id` localStorage
   key minted by either History or Meds — see meds.js
   `_medsGetDeviceId()`). `schemaVersion` comes from
   `Schema.SCHEMA_VERSION` (already a public field). `payload` is the
   store-specific structure. **Stamping is on the envelope, not on each
   inner record** — inner records are already stamped at write time per
   F19a (verified in history.js / meds.js / presets.js).
6. **F21 contract:** `alarmFired` lives only on engine state stores
   (`multi_state`, `pomodoro_state`, `flow_state`, `interval_state`),
   all **excluded from sync**. None of the four B-1 adapters
   (`meds`, `history`, `rest_log`, `presets`) read from those stores —
   so `alarmFired` is structurally absent from `snapshotForSync()`
   output by construction. The audit calls out an explicit test case
   (see "Test scope") so a future regression that smuggles engine state
   into a snapshot fails loudly.

---

## Affected files

| Path | Change type | Notes |
|------|-------------|-------|
| `js/sync-engine.js` | **add** | New module. Public API: `init()`, `enable()`, `disable()`, `getState()`, `getSnapshot()`, event emitter (`on`/`off`/`emit` for future `auth-change` / `merge-complete` / `meds-arrival` hooks). Hardcoded `SYNCED_STORES` registry (4 entries). `write` callback in each adapter is a documented stub (no-op until B-3). `init()` is a no-op when `SyncFlag.isEnabled() === false` (off by default). Idempotent — guards against double-init. **No DOM access. No network. No Firebase imports.** Engine module discipline (factory or IIFE singleton — match existing module style; recommend IIFE since SyncEngine is a singleton). |
| `js/sync-flag.js` | **add** | Tiny module. Public API: `SyncFlag.isEnabled()`, `SyncFlag.enable()`, `SyncFlag.disable()`. Reads/writes `tempo_sync_enabled` localStorage key (`'0'` default, `'1'` when on). Separate file from `sync-engine.js` because the engine reads the flag but doesn't own the UI surface that flips it (B-2 owns the visible toggle). |
| `js/meds.js` | **modify** | Add `MedsManager.snapshotForSync()` method to the public API. Returns `{ deviceId, schemaVersion, payload: { meds: [...] } }` where `payload.meds` is the array of `m.getState()` outputs for each loaded med. **Read-only.** No state mutation. Respects existing per-med `getState()` (which is already F19a/F19b-correct: stamps `schemaVersion`, preserves `_forwardBag`). Respects `MAX_MEDS` / `doseLog` 1000-entry cap by reading from in-memory state (no extra truncation needed — `logDose()` already caps at 1000 per F14). |
| `js/history.js` | **modify** | Add `History.snapshotForSync()` async method to the public API. Returns `Promise<{ deviceId, schemaVersion, payload: { sessions: [...] } }>`. Internally `await getSessions()` (existing). Sessions are already F2-shaped IDs, already F6-stamped phaseLog entries (per A-1), already F10-stamped with `deviceId` + `updatedAt`, already F19a-stamped with `schemaVersion` (per history.js backfill). The adapter is just a pass-through wrapper that adds the envelope. **No `Schema.stamp()` call inside** — inner sessions are already stamped at write time; double-stamping would no-op anyway. |
| `js/presets.js` | **modify** | Add `Presets.snapshotForSync()` method to the public API. Returns `{ deviceId, schemaVersion, payload: { presets: [...] } }` where `payload.presets` is `getAll()` (already returns the raw array with per-record stamps). **Read-only.** |
| `js/recovery-ui.js` | **modify** | Add `RecoveryUI.snapshotForSync()` method to the public API. Returns `{ deviceId, schemaVersion, payload: { rest_log: {...} } }` where `payload.rest_log` is `loadLog()` (the existing pure localStorage-reading helper). **No DOM access — `loadLog()` is already pure.** `deviceId` reads from `History.getDeviceId()`. This is the only synced store whose adapter lives in a `-ui.js` file; tagged with an inline comment `// B-1: snapshot adapter, no DOM access — see audit §Recovery decision` so future cleanup (R2) has context. |
| `index.html` | **modify** (pr-shipper) | Add `<script src="js/sync-flag.js"></script>` and `<script src="js/sync-engine.js"></script>` **after** `<script src="js/persistence.js">` (line 862) and **before** the UI modules (line 869+) so the engine is in scope when `app.js` calls `SyncEngine.init()`. Recommended insertion point: between line 862 (`persistence.js`) and line 863 (`audio.js`). Order: `sync-flag.js` first (`sync-engine.js` reads it on init), `sync-engine.js` second. **pr-shipper-owned edit per workflow contract.** |
| `js/app.js` | **modify** | Add one `SyncEngine.init();` call inside the "Initialize modules" block — recommended after `Persistence.load()` (line 8) and before `Themes.init()` (line 29). `init()` is a no-op when the flag is off, so adding it unconditionally is safe and is the documented wiring point for B-2 and beyond. |
| `tests/sync-engine.test.js` | **add** | New test file. 4+ cases covering `getSnapshot()` shape, per-store adapter contract, flag-gating, idempotence, F21 exclusion. See "Test scope" for the case list. |
| `tests/index.html` | **modify** (pr-shipper) | Add `<script src="../js/sync-flag.js"></script>` and `<script src="../js/sync-engine.js"></script>` to the engine modules block, plus `<script src="sync-engine.test.js"></script>` to the test suites block. Recommended after `recovery-ui.js` doesn't apply — `recovery-ui.js` isn't loaded by tests today; for the `RecoveryUI.snapshotForSync()` test the runner stubs `window.RecoveryUI` per-case (mirrors how `analytics.test.js` stubs `window.History`). |
| `sw.js` | **modify** (pr-shipper) | Append `'./js/sync-flag.js'` and `'./js/sync-engine.js'` to the `ASSETS` array. **Bump `CACHE_NAME`** version string (pr-shipper picks the value — current is `'stopwatch-v65-platform-abstraction'`). |

**Total: 11 files** (4 modify under code-path, 2 add under code-path, 1 add under tests, 1 modify under tests, plus 3 pr-shipper-owned: `index.html` / `sw.js` / commit metadata).

---

## Sync invariants touched

Each row records the F# status for B-1 specifically. "Pass-through" = B-1
does not mutate the invariant; existing engine code already satisfies it
and `snapshotForSync()` reads the already-stamped state.

| F# | Description | Status in B-1 |
|----|-------------|--------------|
| F2 | Session IDs `${deviceId}-${ts}-${counter}` + `legacyId` | **Pass-through.** `History.snapshotForSync()` returns sessions verbatim — IDs are already in F2 shape (verified by `history.js` `migrateSessionIds()` running on init). The audit's test case asserts no ID rewriting happens in the snapshot path. |
| F4 | Re-derive `lastTakenAt` after merge | **N/A — read path.** `MedsManager.snapshotForSync()` reads existing `lastTakenAt` from each med's `getState()`. The F4 helper (`recomputeLastTakenAt()` added in A-1) is invoked only on the **merge** path, which B-1 does not touch. Audit asserts: the adapter does **not** call `recomputeLastTakenAt()`. |
| F6 | `phaseLog` `(deviceId, phaseStartedAt)` per-entry stamping | **Pass-through.** Already shipped in A-1 — pomodoro.js phaseLog pushes carry both stamps. `History.snapshotForSync()` reads sessions verbatim, so the stamps surface in `payload.sessions[].phaseLog[]` unchanged. |
| F10 | `deviceId` + `updatedAt` at write sites | **Pass-through.** Already shipped at every write site (history.js `addSession` / `updateNote` / `addTag` / `removeTag`; meds.js `touch()`; presets.js `save` / `update`). Snapshot reads these stamps and re-emits them on the envelope's inner records. |
| F13 | `tempo_sync_state` write gate | **Not touched.** B-1 introduces `tempo_sync_enabled` (separate key — feature flag, not write gate). The existing `SyncState` module in `persistence.js` stays as-is. `SyncEngine.init()` does **not** read or write `tempo_sync_state`. |
| F14 | `doseLog` cap @ 1000 | **Pass-through.** `MedsManager.snapshotForSync()` reads `m.getState().doseLog` verbatim; `logDose()` already enforces the 1000-entry cap at write time. Snapshot does not bypass or re-truncate. |
| F19a | `schemaVersion` stamping + refuse-writeback | **Pass-through on inner records.** Each inner record is already stamped at write time (verified across `history.js` line 239, `meds.js` line 203, `presets.js` line 29). The **envelope** also carries `schemaVersion: Schema.SCHEMA_VERSION` so a future-cloud consumer can refuse-writeback on the snapshot wrapper itself. **No call to `Schema.stamp()` inside `snapshotForSync()`** — stamps are read, not added. |
| F19b | `__forward` passthrough (top-level unknowns) | **Pass-through.** `meds.js getState()` already merges `_forwardBag` back into the wire format; `history.js addSession` already uses the full-spread pattern; `presets.js` already preserves unknown fields on per-record reads. Snapshot reads the wire format verbatim, so future-schema fields roundtrip cleanly. |
| F20 | Absent vs present-but-unknown enum split | **Pass-through.** Snapshot reads existing field values verbatim; no normalization. `meds.js loadState` already implements F20 for `frequency`; `snapshotForSync()` re-emits whatever value is in memory. |
| F21 | `alarmFired` per-device, never synced | **Holds structurally.** None of the four synced stores (`meds`, `history`, `rest_log`, `presets`) carry an `alarmFired` field — the field lives only on `multi_state` / `pomodoro_state` / `flow_state` / `interval_state` (all excluded from sync per Q4 / strategy doc). Audit asserts an explicit test case that walks `getSnapshot()` output and fails if any inner record has an `alarmFired` key. |

**Summary: all 10 F-invariants are pass-through or N/A for B-1.** B-1's
contract is read-only on existing stamped state — no new stamping, no
new mutation. The first PR that **changes** how an invariant is
satisfied is B-3 (upload + back-fill).

---

## Risks

| Risk | Likelihood | Blast radius | Mitigation |
|------|------------|--------------|------------|
| `SyncEngine.init()` fires during boot before `History.init()` resolves, and the registry's read fails because `History.getDeviceId()` hasn't minted a deviceId yet. | low | local-only (boot path) | `init()` runs **after** `Persistence.load()` and `History.init()` (kicked off line 5 of `app.js`). `getDeviceId()` is lazy and synchronous — first call mints the ID synchronously into localStorage and returns it, independent of `History.init()`'s async IDB open. Audit recommends `init()` does NOT call `getSnapshot()` itself — snapshot is taken later by B-3's `pushSnapshot()` when the user signs in, by which time IDB is open. Test case asserts `init()` doesn't read any store. |
| `snapshotForSync()` accidentally mutates state (e.g. sorts the doseLog in place, normalizes a string, etc.). | med | data-loss if buggy mutation persists via the next `saveAll()` | Each adapter MUST return a **defensive copy** of mutable structures (`doseLog`, `sessions`, `presets`, `rest_log.naps`). The existing `getState()` / `getDoseLog()` / `getAll()` / `loadLog()` already return shallow-copied arrays — adapters just compose envelopes around them. Audit test case: snapshot a state, mutate the snapshot output, assert the in-memory store is unchanged. |
| `tempo_sync_enabled` flag gets flipped to `'1'` in production by a stray dev tool action, and B-1's no-op behavior turns into… still no-op (because the engine has no real network code yet). | low | local-only (dead code path) | `init()` when enabled is a no-op stub in B-1 (the engine reads the flag but has nothing to do until B-2/B-3 ship). Audit test asserts: `init()` with flag enabled + flag disabled produces identical state (no-op either way). The first PR that does anything on enable is B-2 (auth). |
| New `RecoveryUI.snapshotForSync()` method in a `-ui.js` file violates the convention "engine modules are pure, no DOM access." | low | local-only | `loadLog()` (the function the adapter wraps) is already a pure localStorage read with no DOM access. The adapter inherits that purity. Audit decision (R1) accepts the convention bend; comment in code references this audit. If the convention bend becomes a recurring pain point, R2 (extract `js/recovery.js`) is the documented follow-up. |
| `index.html` script-tag insertion order is wrong — `sync-engine.js` loads before `history.js`, `History.getDeviceId` is undefined when `SyncEngine.init()` runs. | low | web-bytes (boot fails) | Pr-shipper inserts the tags **between `persistence.js` and `audio.js`** (line 862–863). `history.js` loads at line 865, **after** sync-engine.js. But `SyncEngine.init()` is called from `app.js` (last script loaded), which runs after every module is in scope — so even though `sync-engine.js` loads before `history.js`, the `init()` call happens after both. The order of `<script>` tags matters only for **module-definition time**; `History` is referenced inside `init()`'s body, not at module-definition time. Audit recommends pr-shipper double-check by running `tests/index.html` after the cache-bump. |
| `sw.js` `CACHE_NAME` not bumped — cached PWA installs serve the old `sw.js` indefinitely and never pre-cache the new `sync-engine.js` / `sync-flag.js` files, so a network-offline boot fails. | med | web-bytes (offline PWA boot) | Pr-shipper's job. Bump `CACHE_NAME` version string in the same commit that touches `sw.js`. Sign-off checklist enforces this. |
| `snapshotForSync()` returns the `_forwardBag` contents flat-merged (already the behavior of `meds.js getState()`) but the envelope wrapper accidentally introduces a `schemaVersion` collision because both the envelope AND the inner record carry the key. | low | local-only (schema confusion downstream) | The envelope's `schemaVersion` is at the **outer level** (`{ deviceId, schemaVersion, payload }`); inner records carry their own `schemaVersion` inside `payload.sessions[i].schemaVersion` etc. No flat-merge — the structures are nested. Audit test asserts the envelope and inner records each carry independent `schemaVersion` values (envelope always `Schema.SCHEMA_VERSION`; inner can be `> SCHEMA_VERSION` if a future-record exists on disk per F19a, in which case the snapshot still surfaces it). |
| F21 regression: a future PR adds a new synced store that smuggles `alarmFired` (or another per-device field) into a snapshot, but no test catches it because B-1's test only checks today's four stores. | low | data-correctness (Device B's chime suppressed) | Audit adds a **structural test** that walks `getSnapshot()` output recursively and fails on any key matching `/alarmFired|zeroCrossedAt|focusEndedAt/` at any depth. Engine-tester implements this as the F21 contract test. Catches future regressions automatically as long as a new store's snapshot result feeds through `getSnapshot()`. |

**Risk count: 8** (low: 6, med: 2, high: 0).

---

## Test scope

### New tests required: `tests/sync-engine.test.js`

Minimum 7 cases. Per-test scope (engine-tester writes the assertions; B-1
audit enumerates the contract):

1. **`init()` is a no-op when `tempo_sync_enabled = '0'`.** Default-flag
   path. Assert: `init()` does not read any store, does not throw, does
   not mutate `tempo_sync_state`. Implementer can spy on `History.getSessions`
   / `MedsManager.all` to confirm zero invocations.
2. **`init()` is idempotent.** Call twice; assert the second call is a
   no-op (no second registration of any internal listener, state
   unchanged). Prevents double-init on hot-reload edge cases.
3. **`init()` with flag enabled stays a no-op in B-1.** Set
   `tempo_sync_enabled = '1'`; call `init()`; assert no network call
   (no `fetch` invoked — implementer stubs `window.fetch` and asserts
   zero calls), no `getSnapshot()` invocation, no state mutation. This
   guards the "scaffold, not behavior" contract.
4. **`getSnapshot()` shape.** Call with all four stores stubbed.
   Assert: returns
   `{ meds: {...}, history: {...}, rest_log: {...}, presets: {...} }`
   (keys match `SYNCED_STORES` registry); each value has
   `{ deviceId, schemaVersion, payload }`; `deviceId` matches
   `History.getDeviceId()`; `schemaVersion === Schema.SCHEMA_VERSION` at
   every level. Async — the test `await`s `getSnapshot()`.
5. **Per-store `snapshotForSync()` defensive-copy contract.** Snapshot
   each of the four stores; mutate the returned `payload` (e.g. push to
   `payload.meds[0].doseLog`); re-read the store; assert the in-memory
   state is unchanged. Catches accidental aliasing of mutable arrays.
6. **F21 structural exclusion.** Recursively walk
   `getSnapshot()` output (envelope + payloads + nested arrays). Assert
   no object at any depth carries an `alarmFired`, `zeroCrossedAt`, or
   `focusEndedAt` key. This is the regression test that catches future
   PRs that smuggle engine state into a synced store.
7. **F2 ID shape preservation.** Stub `History.getSessions` with one
   session carrying a properly-shaped id
   (`${deviceId}-${ts}-${counter}`); call `History.snapshotForSync()`;
   assert the id is returned byte-equivalent. Catches a regression where
   the adapter accidentally re-derives or normalizes the id.

Optional additional cases the engine-tester can add at their discretion:

- F4 regression — assert `MedsManager.snapshotForSync()` does NOT call
  `recomputeLastTakenAt()` (spy on the method).
- F19a future-record passthrough — load a med with `schemaVersion: 2`
  on disk; snapshot; assert the inner record's `schemaVersion` is still
  `2` (envelope's stays at `1`). Verifies the snapshot doesn't silently
  rewrite the inner record's version.
- F19b unknown-field passthrough — load a med with
  `customFutureField: "hi"` on disk; snapshot; assert the inner record's
  payload still contains `customFutureField: "hi"`.

### Existing tests at risk

- **`tests/meds.test.js`** — likely needs zero changes. Meds module gains
  one new public method; existing tests don't touch it. Verify by running
  the full suite after implementation.
- **`tests/sync-stamps.test.js`** (A-1) — likely needs zero changes.
  Stamps are read-side in B-1.
- **`tests/presets.test.js`** — likely needs zero changes. New method
  added, existing methods untouched.

No engine-test file is rewritten or restructured by B-1.

### Test-runner harness considerations

- `tests/index.html` does NOT load `history.js` today; tests that need
  History stub `window.History` per-case (per the file's comment on
  line 36–37). The `sync-engine.test.js` file follows the same pattern:
  stub `window.History`, `window.MedsManager`, `window.RecoveryUI`,
  `window.Presets`, plus `window.localStorage` for the flag.
- `recovery-ui.js` is not loaded in tests; engine-tester stubs
  `window.RecoveryUI = { snapshotForSync: () => ({...}) }` for the
  registry test.
- `sync-engine.js` and `sync-flag.js` MUST be added to `tests/index.html`
  before the `sync-engine.test.js` suite — see "Affected files" notes.

---

## Manual setup steps

**None.** B-1 is pure code + tests + cache bump. No Firebase project
state changes; no new localStorage keys to seed manually (the flag
defaults to `'0'` via `SyncFlag.isEnabled()` returning `false` when the
key is absent — no migration needed).

---

## Out of scope (explicitly NOT in this PR)

- **No network calls.** No Firebase SDK imports, no `firebase/app`
  initialization, no `setDoc`, no `getDoc`. B-3 ships the first cloud
  byte.
- **No auth.** No `signIn` / `signOut` / `getCurrentUser`. B-2 wires
  Google sign-in.
- **No Stage B0 read-cloud-first guard (F9).** Lives in B-3's
  `pushSnapshot()`.
- **No mandatory local backup (F12).** Lives in B-3 alongside the
  uploader.
- **No `meds-arrival` toast (F15).** Lives in B-4 (`sync-toast.js`).
- **No real-time listeners (`onSnapshot`).** Lives in E-3.
- **No write semantics in `SYNCED_STORES[].write` callback.** The
  callback signature is defined (`(record) => Promise<void>`) but the
  implementation is a stub that throws or no-ops. B-3 wires the real
  implementation.
- **No visible developer toggle in the settings drawer.** The
  `tempo_sync_enabled` flag is a programmatic API in B-1
  (`SyncFlag.enable()` / `SyncFlag.disable()` callable from the browser
  console for testing). The visible "Cloud Sync" section that includes
  the toggle ships in B-2. Rationale: B-2 already touches the settings
  drawer DOM; one settings-drawer edit per PR keeps blast radius
  bounded.
- **No `recovery.js` engine extraction (R2).** Deferred indefinitely
  per the Recovery decision above. If the convention bend becomes a
  pain point, ship R2 as a standalone PR (not bundled into a sync PR).
- **No `Persistence.clear()` integration.** The engine registry could
  feed `Persistence.clear()` (F19c manifest-registry direction), but
  F19c is deferred per the strategy doc — B-1 just hardcodes the
  registry like the rest of the codebase.

---

## Sign-off checklist (for the implementer)

- [ ] Affected files match the table above (11 paths total: 6 code-path, 2 test-path, 3 pr-shipper-owned).
- [ ] `js/sync-engine.js` exposes the documented public API: `init()`, `enable()`, `disable()`, `getState()`, `getSnapshot()` (async), plus event-emitter hooks.
- [ ] `SYNCED_STORES` registry has 4 entries, keyed `meds`, `history`, `rest_log`, `presets`, in that order (matches Stage C hydrate order minus `rest_log` → `meds` → `presets` → `history`; for snapshot order doesn't matter, but consistency helps future readers).
- [ ] `js/sync-flag.js` exposes `isEnabled()`, `enable()`, `disable()`. Reads/writes localStorage key `tempo_sync_enabled` with `'0'` / `'1'` values. Default (key absent) returns `false`.
- [ ] `MedsManager.snapshotForSync()`, `History.snapshotForSync()`, `Presets.snapshotForSync()`, `RecoveryUI.snapshotForSync()` each return the documented envelope `{ deviceId, schemaVersion, payload }`.
- [ ] Each adapter is read-only on local state (no `set` / `save` / `logDose` / `touch` / `Schema.stamp` calls inside the adapter).
- [ ] Each adapter returns **defensive copies** of mutable structures (test #5 verifies this).
- [ ] `Schema.SCHEMA_VERSION` and `History.getDeviceId()` are used directly — no re-implementation. Audit confirms both are public APIs already (verified in `js/schema.js` line 59, `js/history.js` line 371).
- [ ] No re-implementation of `escapeHtml` / `Utils.formatMs` / `Platform.*` (B-1 doesn't touch any of those surfaces — purely defensive line item).
- [ ] `js/app.js` calls `SyncEngine.init()` once during boot, after `Persistence.load()` and before the UI inits.
- [ ] `index.html` has `<script src="js/sync-flag.js">` and `<script src="js/sync-engine.js">` after `persistence.js` and before `audio.js`. (pr-shipper edit.)
- [ ] `tests/index.html` has the two new `<script>` tags for the engine modules plus the `sync-engine.test.js` suite tag. (pr-shipper edit, but engine-tester verifies the file boots without errors.)
- [ ] `sw.js` `CACHE_NAME` bumped to a new version string (pr-shipper picks the value); `ASSETS` array includes `./js/sync-flag.js` and `./js/sync-engine.js`.
- [ ] All writes to synced stores stamp `deviceId` + `updatedAt` + `schemaVersion` via `js/schema.js` — **N/A for B-1** (B-1 is read-only on synced stores; the existing write sites already comply per A-1 + F10 + F19a). Sign-off item retained for the checklist template's sake.
- [ ] `tempo_sync_enabled` flag defaults to `'0'` (off). Web boot is byte-equivalent to pre-B-1 main.
- [ ] **F21 contract:** no `alarmFired` / `zeroCrossedAt` / `focusEndedAt` field appears anywhere in `getSnapshot()` output (test #6 enforces).
- [ ] All engine tests pass via `tests/index.html` (manual: serve repo root via `python3 -m http.server 8765` and open `http://localhost:8765/tests/index.html`).
- [ ] No new Firebase imports, no `firebase/app` references, no `fetch` calls in B-1 code (engine-implementer self-checks via `grep -r firebase\|fetch js/sync-engine.js js/sync-flag.js`).

---

## Rollback

Revert the PR. `SyncEngine` and `SyncFlag` are unreferenced by any UI
surface — flipping `tempo_sync_enabled` to `'1'` in B-1's world is a
no-op. The four `snapshotForSync()` methods are additive read-only
helpers; nothing calls them. `index.html` / `sw.js` / `app.js` revert
to single-line removals.

If the `sw.js` cache bump shipped but the JS changes are reverted, the
old cache version stays in use until the next deploy bumps `CACHE_NAME`
again — no functional regression, just a one-cycle stale-cache state on
existing PWA installs.

---

## Next step

Stop here. Push this audit to the branch (commit 1 of 2 on the B-1
branch) and dispatch the engine-implementer for the code commit (commit
2 of 2). Engine-implementer reads this audit + the four required-reading
sources (PLAN.md §B-1, CLOUD-SYNC-STRATEGY.md per-store table, schema.js,
the four target store files) and writes `js/sync-engine.js` +
`js/sync-flag.js` + the four `snapshotForSync()` adapters. No scope
additions unless audit review flags one.
