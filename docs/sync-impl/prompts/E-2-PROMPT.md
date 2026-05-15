# Tempo cloud-sync — implement PR E-2 (Stage E reliability follow-up — offline buffer)

You're working on Tempo, a vanilla-JS PWA + Capacitor iOS app. The
cloud-sync implementation plan is at `docs/sync-impl/PLAN.md` on
`main`. Stage 0, Stage A close-out, Stage B (B-1 → B-4), Stage C
(C-1), Stage D (D-1 + D-2), and all 7 Stage E sub-PRs (E-1a → E-1e)
are shipped (PRs #46–#72, plus chore PR #67). 543 engine tests pass
on `main` at commit `4ccd814`.

E-2 is the **first of two Stage E reliability follow-ups** (E-2
offline buffer + E-3 real-time `onSnapshot` listeners). After Stage E
shipped, steady-state cloud sync runs by default for any user with
`tempo_sync_enabled='1'` — but the 30s `setInterval`-based merge
cycle is unreliable when a device is offline. **Caveat (a) from the
2026-05-15 two-device validation** is the user-visible symptom: tab
backgrounding under Chrome / WebView suspension under iOS Safari
silently drop polling cycles, and ops authored during offline
windows propagate at the original wall-clock only by virtue of the
local store already being stamped at user-action time (Schema.stamp
+ inline `deviceId` / `updatedAt`).

**The strategy doc Q3 lock** (`docs/CLOUD-SYNC-STRATEGY.md:116`):
"buffered writes always preserve the original wall-clock timestamp."
Pending-op cap, op compaction, and optimistic-vs-ack write semantics
were deferred to implementation. E-2 makes those decisions.

E-3 (real-time listeners) is the NEXT PR and is explicitly out of
scope for E-2. The 30s polling cadence stays as-is post-E-2; only
the offline-replay-on-reconnect path is new.

---

## What E-2 ships (4 deliverables in one PR)

1. **New `js/sync-buffer.js`** — pending-op queue. Each op tagged with
   `originalWallClock` (captured at enqueue time, not at drain time).
   Persisted in IndexedDB so a tab close + later reopen still drains
   on next online event. Drain replays FIFO; cap = 1000 with toast
   warning on overflow; op compaction for per-field-LWW stores.

2. **`js/sync-engine.js` extensions** — hook the buffer at the
   per-store write sites (or alternative scope per TODO #1). On
   `online` event, drain. Existing feature-detect hooks at
   `js/sync-engine.js:1911-1942` already check `Platform.network`
   on `startSteadyState` — E-2 fills in the Platform.network shim
   that those hooks reference.

3. **`js/platform.js` extension** — new `Platform.network` namespace.
   `Platform.network.isOnline()` returns `boolean`;
   `Platform.network.onChange(callback)` returns an unsubscribe fn;
   web branch uses `navigator.onLine` + `window.addEventListener('online'/'offline')`;
   native branch routes to `@capacitor/network` plugin's
   `Network.addListener('networkStatusChange', ...)`. Mirrors the
   existing `Platform.auth` / `Platform.haptic` / `Platform.notify`
   shim pattern.

4. **Tests** — `tests/sync-buffer.test.js` (new, ~14-18 cases per
   PLAN.md §E-2 spec) + `tests/sync-engine.test.js` extension
   (~6-10 cases for the buffer-engine integration: write-site hook,
   online-event drain, immediate merge on reconnect, no-op when flag
   off or signed out).

Plus:

- **`package.json` + `package-lock.json`** — add
  `@capacitor/network@^6.0.0` dep (Capacitor 6 line, matches the
  existing 5 Capacitor plugins). Run `npm install` + `npx cap sync ios`
  in the implementer phase; commit both files.
- **`sw.js` CACHE_NAME bump** — v80 → v81
  (`'stopwatch-v81-e2-offline-buffer'` or similar).
- **`index.html`** — 1 new `<script>` tag for `js/sync-buffer.js`
  (between `sync-firestore.js` and `sync-engine.js` per
  CLAUDE.md script-load-order rule). Possibly 1 more for
  `js/sync-toast.js` if TODO #5 lands on the new-module option.
- **`tests/index.html`** — 1 new `<script>` tag for `sync-buffer.test.js`.
- **Phase 4 ui-wirer FIRES OR SKIPS** depending on TODO #5: if the
  overflow toast surface is a new `js/sync-toast.js` module, Phase 4
  fires; if engine emits a `buffer-overflow` event with no UI in
  this PR, Phase 4 skips. The brief codifies the trigger per Kyle's
  pick.

---

## What's true about the codebase E-2 edits

**`js/sync-engine.js:1911-1942` already feature-detects `Platform.network`.**
The E-1b steady-state scaffold landed a forward-compatible hook —
when `Platform.network.onChange` is callable, the timer pauses on
offline and resumes on online (via duck-typed `status.connected` /
`status.online`). E-2's `Platform.network` implementation must
match that duck-typing shape so the existing wire-up keeps working
without engine-side edits. The hook today is a no-op (`Platform.network`
is undefined); after E-2 it activates retroactively for steady-state
pause-on-offline behavior, which is a small bonus on top of the
buffer-drain wire-up.

**`js/history.js:1-66` owns the only IDB connection today.**
`DB_NAME = 'stopwatch_history_db'`, `DB_VERSION = 1`, single store
`'sessions'` opened in `History.open()`'s `onupgradeneeded` handler.
Adding a `pending_ops` store has two paths (TODO #2): bump
`stopwatch_history_db` to v2 + extend the `onupgradeneeded` handler
in `History.open()`, OR open a separate DB inside `js/sync-buffer.js`
(e.g., `tempo_sync_db` v1) with its own connection.

**`js/schema.js` only stamps `schemaVersion`.** Per-record `deviceId`
and `updatedAt` are set inline at every synced-store write site
(e.g., `meds.js:155` `doseLog.push({ takenAt: when, deviceId: _medsGetDeviceId() })`;
`presets.js:331` `deviceId: History.getDeviceId(), updatedAt: Date.now()`).
The buffer's `originalWallClock` capture therefore happens at the
buffer-enqueue site, not via a `Schema.*` helper. PLAN.md §E-2's
"originalWallClock preserved" lock is honored by: (i) the local record
is already stamped at user-action time with its own `updatedAt`;
(ii) the buffer entry references the record + captures
`Date.now()` at enqueue time as an audit-trail field that the
implementer can choose to use or ignore depending on TODO #1.

**`js/sync-toast.js` does NOT exist on disk.** The "Toast.medsArrival"
references in `sync-merge-*.js` are emit-only — there is no listener
that paints a visible toast yet. B-4's toast spec lived in PLAN.md
but was deferred (the merge fns emit `meds-arrival`, but no UI surface
consumes the event). E-2's overflow warning is therefore the first
real cloud-sync visible toast — TODO #5 decides whether to ship the
new `js/sync-toast.js` module here (and wire up the deferred
`meds-arrival` listener as a freebie), reuse the existing
`undo-toast` DOM pattern from `js/ui.js:354-462` (engine creates DOM
inline — violates the engine-no-DOM rule), or defer entirely to
E-3.

**Existing engine write sites that may need buffer hooks** (per
TODO #1):
- `MedsManager.logDose` — `js/meds.js:155` (doseLog push).
- `MedsManager.update` — `js/meds.js:~270` (med metadata edit).
- `MedsManager.remove` — meds tombstone-set (E-1c).
- `History.addSession` — `js/history.js:~241` (session append).
- `History.updateNote` — `js/history.js:~286` (per-session note LWW).
- `History.addTag` / `removeTag` — `js/history.js:~324, ~344` (per-session tags).
- `RecoveryUI.setSleep` — `js/recovery-ui.js:60-66` (per-day sleep LWW).
- `RecoveryUI.addNap` — `js/recovery-ui.js:78-85` (naps append).
- `Presets.save` / `update` / `remove` — `js/presets.js:24, 40, 56` (full-record LWW + tombstone).
- `BfrbEvents.log` — `js/bfrb-events.js:~150` (BFRB events append).
- `Distractions.log` — `js/distractions.js:~120` (per-session distractions append).

That's **11 write sites across 6 synced stores**. TODO #1 decides
whether all 11 get hooks (Pick (b)), or whether the buffer reads
"intent" from a higher level (Pick (a) — pointer-to-record entries
populated lazily by the steady-state cycle when it detects offline).

**Existing 543 tests baseline.** The E-1e closeout report at
`docs/SESSION-LOG.md:1244-1389` documents 543/543 pass across
stopwatch (30) / timer (21) / pomodoro (25) / meds (38) / + sync
modules. E-2 lands ~20-28 new tests (14-18 sync-buffer + 6-10
sync-engine extension); target post-E-2 baseline: approximately
**563-571**.

---

## TODO #1 — Buffer's scope of capture (MOST CONSEQUENTIAL)

PLAN.md §E-2 says "On any write, if offline (per
`Platform.network.isOnline()`), enqueue op." Three interpretations:

**(a) Op = pointer to local record state (lazy-resolved).** Buffer
entry shape: `{ store, recordId, originalWallClock, enqueuedAt }`.
On drain, the buffer reads the current local state for that record
and pushes to cloud. No data duplication — local state remains
canonical. **Hook sites:** the dispatcher in `_runMergeCycle()`
detects offline (via `Platform.network.isOnline()`) and short-
circuits the cloud-write step, enqueueing a pointer per dirty
record instead. The 11 engine write sites stay untouched.
**Implication:** compaction is trivial (dedup by `recordId`); cap
enforcement = N distinct record-pointers; ordering is
last-write-wins on the pointer (FIFO drain still preserves wall
clock via the local record's own `updatedAt`).

**(b) Op = atomic write intent (eager-capture at write site).**
Buffer entry shape: `{ op: 'logDose'|'updateNote'|..., args, originalWallClock }`.
On drain, the buffer replays the op against the engine's write API.
**Hook sites:** all 11 engine write sites add a one-liner
`SyncBuffer.enqueue(...)` when `Platform.network.isOnline() === false`.
Per-op shape is per-store (logDose carries `{medId, takenAt}`,
updateNote carries `{sessionId, note}`, etc.). **Implication:**
compaction means collapsing repeated writes on same `(store, op,
recordId, field)` tuples; cap enforcement = N total intents;
ordering is FIFO.

**(c) Op = full record snapshot at action time (eager copy).**
Buffer entry shape: `{ store, recordId, record, originalWallClock }`
where `record` is a full deep copy of the record state at user-
action time. On drain, push the captured state to cloud verbatim.
**Hook sites:** all 11 engine write sites add a hook that deep-copies
the post-write record. **Implication:** compaction is dedup by
`recordId` (last copy wins); buffer storage grows with op count
(but bounded by 1000 cap); ordering is FIFO.

**Auditor's lean: (a) — pointer-to-record.** The 6 synced stores
all use idempotent LWW or append-merge based on local state
(established across E-1c through E-1e). A pointer-to-record buffer
preserves that contract: drain reads local state (which is already
correctly stamped at user-action time) and routes to the per-store
merge fn's cloud-write step. Compaction is trivial. The 11 write
sites stay untouched. **Trade-off:** offline windows that span an
edit-then-undo on the same field (note edit A → B → A) will replay
only the final state (A), losing the intermediate edits' audit
trail — but that's the correct semantic for idempotent LWW.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Op = pointer to local record state.
- **Pick B** — Op = atomic write intent (replay-against-engine-API).
- **Pick C** — Op = full record snapshot at action time.

---

## TODO #2 — IDB store ownership

The buffer needs persistent storage that survives tab close. IDB
is the obvious choice; localStorage's 5 MB cap would constrain
the 1000-op cap path. **Two ownership options:**

**(a) Bump `stopwatch_history_db` from v1 to v2, add `pending_ops`
store inside `js/history.js`'s `open()` `onupgradeneeded` handler.**
Single DB connection shared across modules. **Risk:** history.js
gains a non-history responsibility; the upgrade handler now manages
two stores; if E-3 (or future PRs) adds more IDB-backed sync state,
the version bumps cascade through history.js.

**(b) Open a new DB `tempo_sync_db` v1 inside `js/sync-buffer.js`.**
Separate connection, fully owned by sync-buffer. **Risk:** two IDB
connections at runtime (history's `stopwatch_history_db` + sync-
buffer's `tempo_sync_db`). Browsers handle this without issue, but
the two DBs are now two upgrade paths instead of one. **Boon:**
clean module boundary; sync-buffer is independently revertable
without touching history.

**Auditor's lean: (b) — separate DB.** Cleaner module boundary
matches the existing pattern (meds / presets / bfrb_events /
distractions all own their localStorage keys independently). The
two-open-connections cost is negligible. Failure-mode independence
matters more — if E-2 misbehaves, reverting it doesn't touch the
history DB.

**Kyle, pick before Phase 1:**
- **Pick A** — Bump `stopwatch_history_db` to v2, add store inside `js/history.js`.
- **Pick B (recommended)** — New `tempo_sync_db` v1 inside `js/sync-buffer.js`.

---

## TODO #3 — Op-compaction policy

PLAN.md §E-2 line 396: "Op compaction: collapse repeated single-field
LWW writes on same record (keep only the latest)." Which stores
actually benefit from compaction in practice?

Per-field-LWW stores (real benefit):
- **history note** — user typing a note re-runs `updateNote` per
  keystroke if the UI debounces on blur instead of debouncing
  before write. Worst case: ~50 ops for a 50-character note.
- **history tags** — `addTag` + `removeTag` rapid fire on tag chip
  taps. Maybe 5-10 ops in a flurry.
- **rest_log sleep** — per-day `setSleep` overwrites; rapid edits
  on the hours/quality sliders could fire ~5 ops.
- **presets** — full-record LWW; user editing a preset's duration
  + name in the same modal would fire 2-3 ops.

Append-only stores (no benefit — each entry is unique):
- meds doseLog, BFRB events, distractions, history sessions.

**Three policy options:**

**(a) Compaction on per-field-LWW stores only.** Engine-implementer
documents the store list in a `COMPACTABLE_STORES` constant. Drain
post-processes the buffer: for each `(store, recordId)` pair in
COMPACTABLE_STORES, keep only the latest pointer/intent/snapshot.

**(b) Compaction on every store, scoped by per-store dedup key.**
Each store registers its own dedup key (e.g., meds = `(medId,
takenAt)`, history sessions = `id`, history notes = `(sessionId,
'note')`). Drain dedups within each scope. Maximum reuse; more code.

**(c) No compaction.** Drain replays every op in FIFO order. The
1000-op cap protects against unbounded growth; the cloud-side
idempotent merge handles re-application via LWW per record.

**Auditor's lean: (a) — per-field-LWW stores only (history note +
tags, rest_log sleep, presets).** The other 4 stores are append-only
with sub-second timestamps — collision is vanishingly unlikely. (b)
is over-engineering for the realistic UX. (c) bloats the buffer
disproportionately on chatty note edits.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Per-field-LWW stores only (history note + tags, rest_log sleep, presets).
- **Pick B** — Every store via per-store dedup key.
- **Pick C** — No compaction; rely on cap + cloud-side LWW.

---

## TODO #4 — Pending-op cap = 1000 vs configurable

PLAN.md §E-2 line 389: "Lock pending-op cap at 1000 (configurable)."
Two ways to expose the cap:

**(a) Constant `PENDING_OP_CAP = 1000` in `js/sync-buffer.js`.**
Immutable per release. Bumping the cap requires a code change +
new release. Simplest, easiest to reason about.

**(b) Constant default + localStorage override
(`tempo_sync_buffer_cap`).** Power-user / future-tuning hook.
Parse on module init; clamp to a sane range (`[100, 10000]`?). No
visible UI to set it — only via DevTools.

**Auditor's lean: (a) — constant.** Override is theoretical
complexity; no observed UX has surfaced a need. If quota becomes a
real problem post-launch, a one-line bump + cache rotation gets
the new cap into production within a day.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Constant `PENDING_OP_CAP = 1000`.
- **Pick B** — Constant default + localStorage override.

---

## TODO #5 — Toast UX for the overflow warning

When the buffer hits 1000 ops, the oldest gets dropped. PLAN.md
§E-2 line 389: "On overflow, drop oldest with toast warning
('Buffered changes exceeded cap; oldest changes lost — please
re-sync')." How to surface that warning?

**(a) New `js/sync-toast.js` module with `Toast.bufferOverflow(droppedCount)`.**
Mirrors the existing `undo-toast` DOM pattern from `js/ui.js:354-462`
+ `css/styles.css:1350-1369` but lives in its own module so future
cloud-sync toasts (E-3's downlevel-warning, the deferred B-4
meds-arrival listener) land in the same place. **Phase 4 ui-wirer
fires.** Wires up the buffer-overflow event listener + paints the
visible toast. **Bonus opportunity:** the deferred `meds-arrival`
listener can land in this same PR as a freebie.

**(b) Reuse `undo-toast` DOM inline in `js/sync-engine.js`.** Engine
creates the toast DOM directly. **Violates the engine-no-DOM rule**
codified in `.claude/agents/engine-implementer.md` lines 46-48. Not
recommended.

**(c) `SyncEngine.emit('buffer-overflow', { droppedCount })` +
`console.warn`. No visible UI in E-2.** Defer the toast surface
entirely to E-3 alongside the downlevel-warning toast. Phase 4 ui-
wirer skips.

**Auditor's lean: (a) — new `js/sync-toast.js` module.** First
real cloud-sync visible toast lands here. Future cloud-sync
toasts collect in the same module. Phase 4 ui-wirer fires for
the one new surface. The deferred `meds-arrival` listener landing
as a freebie is a small UX win.

**Note on Phase 4 coupling:** if Kyle picks (c), Phase 4 SKIPS
entirely (no UI files in scope). The orchestrator pattern reads
the audit's affected-files table to decide whether to dispatch
ui-wirer — so this TODO directly controls workflow phasing.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — New `js/sync-toast.js`; Phase 4 fires.
- **Pick B** — Inline DOM in `js/sync-engine.js` (violates engine-no-DOM rule).
- **Pick C** — Event-emit + console.warn only; Phase 4 skips.

---

## TODO #6 — Optimistic-vs-ack write semantics

Strategy doc Q3 (`docs/CLOUD-SYNC-STRATEGY.md:116`) locked
"original wall-clock preserved" but deferred optimistic-vs-ack to
implementation. What does the UI show during offline windows?

**(a) Optimistic.** Local write happens immediately; UI reflects
the change instantly; buffer enqueues the cloud-push for replay
on reconnect. **No "pending sync" indicator** unless TODO #5 is (a)
and Kyle wants a sync-status surface in the settings drawer (out of
scope for E-2; revisit in E-3).

**(b) Ack-based.** UI waits for cloud confirmation before
reflecting the change. **Solo single-user PWA UX disaster** — a
"did my dose log save?" stale-spinner on every write would be
intolerable. Not recommended; flagged for completeness.

**(c) Hybrid — optimistic local, ack-display.** Local state shows
immediately; a small "pending sync" badge appears next to records
that haven't yet round-tripped to cloud. Badge clears on successful
push. **Phase 4 scope expands** to wire the per-record badge into
each UI surface. Out of scope for E-2 (badge UI is a separate
ship); revisit in E-3 alongside the downlevel-warning toast.

**Auditor's lean: (a) — optimistic.** Locked by use-case constraint;
(b) is wrong; (c) is interesting but out of scope.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Optimistic. Local writes reflect immediately.
- **Pick B** — Ack-based (not recommended).
- **Pick C** — Hybrid optimistic-local + ack-display (out of scope; revisit E-3).

---

## TODO #7 — Native Network plugin install

PLAN.md §E-2 line 388: "On `online` event (via `Capacitor
Network.addListener` on native, `window.online` on web)." Two paths:

**(a) Install `@capacitor/network@^6.0.0` in this PR.** Add to
`package.json` dependencies; run `npm install` to update
`package-lock.json`; run `npx cap sync ios` to update
`ios/App/Podfile` and pull the plugin's native module. Web branch
uses `navigator.onLine` + `window.addEventListener('online'/'offline')`.
Native branch routes to `window.Capacitor.Plugins.Network`. The
`Platform.network` shim in `js/platform.js` mirrors the existing
`Platform.auth` shim's web-vs-native branch.

**(b) Web-only Platform.network for E-2; native plugin in a
follow-up PR.** `Platform.network` returns `false` for
`isOnline()` and silently drops `onChange` callbacks on native.
Drain-on-reconnect only works on web in E-2. **Lossy contract** —
native users get a degraded experience but the buffer still works
on cold-start drain (next steady-state cycle picks up pending ops).

**Auditor's lean: (a) — install both branches at once.** Plugin
install is mechanical; the cost is ~30s of `npx cap sync ios`. Web
branch alone leaves iOS users without the immediate-drain-on-
reconnect win that's the whole point of E-2.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Install `@capacitor/network`; web + native both wired.
- **Pick B** — Web-only Platform.network; defer native plugin.

---

## Hard rules

- **Audit before code.** Phase 1 = sync-auditor produces
  `docs/sync-impl/audits/E-2-AUDIT.md` and Kyle reviews before
  Phase 2 fires.
- **Phase 4 ui-wirer fires OR skips per TODO #5.** If Pick A, fires
  for the new `js/sync-toast.js` surface. If Pick C, skips.
- **F-invariant guardrails:**
  - **F10 (envelope stamping at write)** — buffer entries do NOT
    re-stamp the underlying record. The record's existing
    `deviceId` + `updatedAt` + `schemaVersion` (set inline at the
    engine write site) is what flows through on drain.
  - **F13 (write gate)** — the buffer ENQUEUE path bypasses the
    cross-store write gate (offline writes shouldn't be blocked by
    `SyncState='hydrating'`). The DRAIN path runs through the
    existing merge fns, which already honor F13 via the dispatcher
    in `_runMergeCycle`.
  - **F19a refuse-writeback** — preserved by routing drain through
    the per-store merge fns. The buffer doesn't add a third F19a
    layer.
- **Local-first contract stays a hard contract.** The buffer is
  an opportunistic OPTIMIZATION over local-state-as-source-of-truth.
  If the buffer module errors out entirely, the steady-state merge
  cycle still picks up pending changes within 30s when network
  returns. No correctness regression from buffer failure.
- **Web bytes stay equivalent on GitHub Pages unless `sw.js` is
  also bumped in the same PR.** E-2 bumps `CACHE_NAME` so this is
  covered.
- **Native-only code routes through `js/platform.js`.** The new
  `Platform.network` namespace follows the existing pattern; no
  Capacitor SDK imports in any other module.

---

## After E-2 merges

What's left in the cloud-sync initiative:

- **E-3 — Real-time `onSnapshot` listeners.** Drops polling
  latency from <30s to <1s and eliminates polling read costs
  entirely. Also includes the downlevel-client warning toast for
  refuse-writeback events. **Fixes 2026-05-15 validation caveat
  (a)** (setInterval polling unreliable when tabs unfocused) at
  the source.
- **2026-05-15 validation caveats (b), (c), (d)** — three small
  cleanup PRs documented in `CLAUDE.md` backlog item #6:
  (b) Stage D handoff re-fires on manual Push to cloud, (c) Presets
  drawer doesn't auto-refresh on sync, (d) Reconcile-pass
  collision warnings should be a single summary log. All small;
  good warm-up candidates between E-2 and E-3 if Kyle wants to
  bed E-2 in before tackling E-3.
- **Stage F (DEFERRED)** — Per-store manifest registry (F19c).
- **Deferred legacy-key cleanup PRs** (carry-forward from
  E-1d-f3 + E-1d-f8 — `bfrbs_global` / `flow_bfrbs` /
  `pomodoro_bfrbs` + flat-array distractions + their migration
  markers). No fixed schedule.
- **Native CAS parity follow-up** (still carry-forward from
  E-1b/c/d/d-f3/d-f8/e). `runTransaction` is web-only; queue the
  Capacitor branch before E-3 listeners ship.
- **Backlog GC for preset tombstones.** When accumulated
  `deletedAt < (now - 90 days)` records become observable, add a
  periodic purge. Not in scope for E-2.

---

## Branch + commit conventions

- **Branch:** `feat/sync-stage-e2-offline-buffer`
- **PR title:** `feat(sync): offline buffer + Platform.network shim (E-2)`
- **Commit type prefix:** `feat` for the engine commit; `docs` for
  the PR-shipper post-PR PLAN.md move (matches recent precedent).

---

## Phase 4 scope (conditional)

Two scenarios depending on TODO #5:

**Scenario A — TODO #5 Pick A (new `js/sync-toast.js`):**
Phase 4 ui-wirer fires for the new toast surface. SMOKE-ONLY
verification: load `localhost:8765` in kapture, verify boot path
clean, manually trigger a synthetic overflow via DevTools
(`SyncEngine.emit('buffer-overflow', { droppedCount: 5 })`),
verify the toast paints with the expected message, verify it
auto-dismisses after 5s, verify one neighboring route still
renders (e.g., `#/wellness/meds`). NO real Firestore connection.

**Scenario B — TODO #5 Pick C (no toast surface):**
Phase 4 SKIPS entirely. Orchestrator dispatches Phase 5
(pr-shipper) directly after Phase 3 tests green.

---

**Kyle: TODOs 1–7 need your call. TODO #1 (buffer scope of capture)
and TODO #2 (IDB store ownership) are the most consequential —
both shape blast radius. TODO #5 (toast surface) controls whether
Phase 4 fires. Auditor leans all-recommended (Picks A across the
board). Accept all defaults with "all defaults" or override per-
TODO.**
