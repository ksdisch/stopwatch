# Tempo cloud-sync — implement PR `native-sync-parity` (Capacitor Firestore: native `onSnapshot` listener parity)

You're working on Tempo, a vanilla-JS PWA + Capacitor iOS app. The
cloud-sync implementation plan is at `docs/sync-impl/PLAN.md` on
`main`. Stage 0, Stage A, Stages B–E (including both reliability
follow-ups E-2 + E-3), and the 2026-05-17 burndown PRs (#76–#79) are
all shipped. The cloud-sync initiative is **functionally complete on
web**: real-time `onSnapshot` listeners (sub-second propagation), F19a
refuse-writeback via atomic CAS, 6 synced stores, 628 engine tests
passing on main at commit `dc1b6b2`.

This PR closes the **listener** half of the last unshipped piece
flagged in the 2026-05-15 E-3 ship note and reiterated in the
2026-05-17 backlog grooming pass (CLAUDE.md backlog row #2): the
`subscribe()` native deferral in `js/sync-firestore.js`. Currently
that wrapper throws `kind: 'unknown'` with "subscribe native parity
pending" when `window.Capacitor.isNativePlatform() === true`. On
native today, iOS sync still works because `_subscribeAllStores`'
outer try/catch swallows the throw and iOS falls back to the 5-min
defensive poll (`STEADY_STATE_DEFAULT_MS = 300000`).

iOS sync is therefore **fully functional but degraded**: latency floor
is ~5 min instead of ~1s. This PR brings the listener side to web
parity using `@capacitor-firebase/firestore@^6.3.1`'s
`addCollectionSnapshotListener` (already a transitive dep since S0-1
— PR #46).

## What is NOT in scope (CAS parity stays deferred)

The sibling deferral — `runTransaction()` at
`js/sync-firestore.js:325-385` — does NOT ship in this PR. Reason:
plugin v6.3.1 does not expose a `runTransaction` API. The closest
atomic primitive (`writeBatch`, added in plugin 6.1.0) writes
multiple operations atomically but has no read-conditional check,
which is exactly what CAS requires. The three paths to native CAS
are all out of scope here:

- Wait for the Capacitor plugin to add `runTransaction` upstream.
- Contribute the wrapper upstream to `@capacitor-firebase/firestore`.
- Emulate CAS with `getDocument` + conditional `setDocument` — this
  is NOT atomic; a write-after-read race can clobber a future-schema
  record between the schemaVersion check and the conditional write.
  Would silently break F19a's atomicity guarantee. Rejected.

**Cost of leaving CAS deferred:** F19a refuse-writeback on iOS
remains best-effort via the cloud-side gates that already exist in
each `js/sync-merge-*.js` module (dispatcher snapshot pre-filter +
per-merge-fn schemaVersion check before `setDoc`). This is the
status quo since E-1b shipped 2026-05-13 — this PR introduces no
regression. The deferral is documented in
`docs/sync-impl/PLAN.md` (this PR adds a row continuing that
documentation).

---

## What this PR ships (1 deliverable + tests)

1. **Native `SyncFirestore.subscribe(path, callback)`.** Replace the
   `throw _wrap('unknown', 'subscribe native parity pending', …)` at
   `js/sync-firestore.js:424-434` with a real implementation wrapping
   `window.Capacitor.Plugins.FirebaseFirestore.addCollectionSnapshotListener`.
   The wrapper must:

   - Return an unsubscribe fn **synchronously** so callers can stash it
     in the listener registry before the next event loop tick. The
     plugin's `addCollectionSnapshotListener` returns
     `Promise<{ callbackId }>`, so the existing deferred-unsubscribe
     pattern from the web branch (`js/sync-firestore.js:443-496`)
     must be mirrored: a closure captures `_callbackId` + `_cancelled`,
     and the synchronously-returned unsubscribe fn either calls
     `removeSnapshotListener({ callbackId: _callbackId })` (if the
     async registration finished) or sets `_cancelled = true` (if it
     didn't — the async resolution callback then no-ops or
     immediately calls `removeSnapshotListener`).

   - Convert the plugin's collection-snapshot event shape
     (`{ snapshots: DocumentSnapshot<T>[] }` per `definitions.d.ts:280`)
     to the web-branch contract `{ docs: [{ id, data }], count }`.
     `DocumentSnapshot` exposes `{ id, data, metadata, path }`; the
     `id` and `data` map directly.

   - Convert the plugin's callback signature
     `(event, error) => void` (per `definitions.d.ts:406`) to the
     web-branch invocation shape: on `event != null`, fire
     `callback({ docs, count })`; on `error != null`, fire
     `callback({ ok: false, error: _normalizeError(error) })`. Match
     the web branch's "callback throw must not break the listener"
     try/catch wrapping at `js/sync-firestore.js:457-471`.

   - Normalize plugin errors via the existing `_normalizeError`
     helper. Test that the plugin's error code patterns at
     `js/sync-firestore.js:90-100` (already commented) catch the
     native cases the same way they catch the web cases.

   - Path shape: the plugin's `reference` option takes a string path
     like `users/{uid}/{store}` (same as web). Use the existing
     `_normPath` helper to normalize leading slashes.

   - `SYNC_DISABLED` fast-path — already at the top of the web
     branch, applies on native too (the throw at line 418 is
     pre-`isNative` check, so this just works).

2. **Engine tests.** Create a new file `tests/sync-firestore.test.js`
   covering the native branch. Cases:

   - Native happy path: stub `window.Capacitor.Plugins.FirebaseFirestore.addCollectionSnapshotListener` to immediately resolve `{ callbackId: 'cb-1' }` and fire a snapshot, assert callback receives `{ docs, count }`.
   - Native unsubscribe-before-load race: call `subscribe()`, immediately call the returned unsubscribe fn before the stubbed `addCollectionSnapshotListener` resolves, assert no callback fires AND `removeSnapshotListener` is called once registration completes.
   - Native error mid-stream: fire `(null, error)` callback, assert caller receives `{ ok: false, error: <normalized> }`.
   - Native callback-throw safety: caller's callback throws, assert listener stays alive (next snapshot still arrives).
   - Native `SYNC_DISABLED` fast-path: with flag off, assert throw.
   - Native path normalization: pass `/users/foo/meds` vs `users/foo/meds`, both produce same `reference`.
   - Native isNative=false fallthrough: with `isNative === false`, assert the web branch is reached (smoke — no need to test web exhaustively here, that's already done elsewhere).
   - `removeSnapshotListener` resilience: `removeSnapshotListener` throws on tear-down, assert the unsubscribe fn doesn't propagate (matches web `try { _realUnsub(); } catch (_) {}` shape).

   Target: ~8-12 cases. Total engine tests after this PR: ~636-640
   (current baseline 628 on `main`).

Plus:

- **`sw.js` CACHE_NAME bump** — v90 → v91. Suggested name:
  `'stopwatch-v91-native-sync-parity'`. `js/sync-firestore.js` is a
  cached web file; web bytes change → bump per project rule.
- **`tests/index.html`** — 1 new `<script>` tag for
  `sync-firestore.test.js`. Slot after the existing
  `sync-listeners.test.js` script tag (alphabetical ordering broken
  elsewhere but the file is read top-to-bottom so order matters only
  for test-runner dependency, which is minimal here).
- **`index.html`** — no changes expected; the existing
  `<script src="js/sync-firestore.js">` tag is already present.
- **No `package.json` change.** `@capacitor-firebase/firestore@^6.3.1`
  already installed since S0-1.
- **Phase 4 ui-wirer NEVER FIRES.** The audit's affected-files table
  will only list `js/sync-firestore.js` + `tests/sync-firestore.test.js`
  + `tests/index.html` + `sw.js`. No UI surface changes. The
  orchestrator skips Phase 4 entirely.

---

## Plugin API reference (verified against `node_modules/@capacitor-firebase/firestore@6.3.1/dist/esm/definitions.d.ts`)

```ts
// Method we wire (definitions.d.ts:82-86):
addCollectionSnapshotListener<T extends DocumentData = DocumentData>(
  options: AddCollectionSnapshotListenerOptions,
  callback: AddCollectionSnapshotListenerCallback<T>
): Promise<CallbackId>;

// Teardown (definitions.d.ts:94-98):
removeSnapshotListener(options: RemoveSnapshotListenerOptions): Promise<void>;

// AddCollectionSnapshotListenerOptions (definitions.d.ts:383, extends SnapshotListenerOptions):
//   { reference: string, ...compositeFilter, ...queryConstraints, ...source }
// AddCollectionSnapshotListenerCallback (definitions.d.ts:406):
//   (event: AddCollectionSnapshotListenerCallbackEvent<T> | null, error: any) => void
// AddCollectionSnapshotListenerCallbackEvent<T> = GetCollectionResult<T>
// GetCollectionResult<T> (definitions.d.ts:314):
//   { snapshots: DocumentSnapshot<T>[] }
// DocumentSnapshot<T> (definitions.d.ts:477):
//   { id, data, metadata, path }
// RemoveSnapshotListenerOptions (definitions.d.ts:449):
//   { callbackId: CallbackId }
// CallbackId is a string
```

The two methods we need are both `@since 5.2.0`, so they're stable
across all v6.x of the plugin. `writeBatch` (the closest CAS analogue,
`@since 6.1.0`) is intentionally not used because batched writes are
atomic but not read-conditional.

---

## Hard rules

- **Audit before code.** First commit on the branch is
  `docs/sync-impl/audits/native-sync-parity-AUDIT.md` listing
  affected files + blast-radius tier + risks. STOP after the audit
  and wait for Kyle's review.
- **Web behavior must not regress.** The web branch of `subscribe()`
  is the F19a-adjacent contract source of truth. This PR only ADDS
  code inside the `if (isNative) { ... }` block at `js/sync-firestore.js:424-434`
  (replacing the throw with the real implementation). The web branch
  below it stays byte-identical. Tests include the isNative=false
  fallthrough sanity case.
- **F19a contract.** Native listener wire-up does NOT touch the
  refuse-writeback path. Cloud-side gates in the merge fns continue
  to enforce schemaVersion checks. The native CAS deferral note in
  PLAN.md is updated, not closed.
- **Callback contract byte-identical to web.** Downstream code in
  `js/sync-engine.js` calls `subscribe(path, cb)` with a callback
  that branches on `payload.ok === false`. The native branch must
  produce identical payload shapes (`{ docs, count }` for snapshots,
  `{ ok: false, error: <normalized> }` for errors).
- **Deferred-unsubscribe pattern symmetric with web.** Same closure
  shape, same idempotency, same try/catch on `removeSnapshotListener`
  failure. Subagents should read `js/sync-firestore.js:447-496` and
  mirror it line-for-line in the native branch.
- **No `Platform.firestore` namespace refactor.** This PR keeps the
  existing convention inside `js/sync-firestore.js` of routing
  directly to `window.Capacitor.Plugins.FirebaseFirestore` (matching
  lines 215, 244, 268). A `Platform.firestore` shim would be a
  separate scope-expansion PR.
- **Cache-bump rule fires.** `sw.js` CACHE_NAME bumps to
  `v91-native-sync-parity`.
- **No SCHEMA_VERSION bump.** No envelope changes.

---

## Manual iOS verification (post-PR, before merge)

Engine tests cover the native branch only via mocked
`window.Capacitor.Plugins.FirebaseFirestore`. Real native
verification requires Kyle's Xcode + iPhone.

Smoke test plan (mark "smoke ✓" in `docs/SESSION-LOG.md` before
merging):

1. `npm run ios:open` → build to physical iPhone via Xcode.
2. Sign in with the test Google account on iPhone.
3. On a laptop (already signed in via web), log a dose for any med.
4. Verify the dose appears on iPhone within ~1-2s while the iPhone
   WebView is in the foreground. (Pre-PR latency floor was ~5 min.)
5. On iPhone, log a different dose. Verify it appears on web within
   ~1-2s.
6. Background the iPhone for 30+ seconds, then foreground →
   verify the listener re-arms (the existing `visibilitychange`
   handler in `js/sync-engine.js` calls `_subscribeAllStores` again).
7. Check Xcode console for any `removeSnapshotListener` errors during
   the catch-up `_runMergeCycle`. Expected: zero errors.

If smoke fails: revert the PR, open a follow-up to investigate. Do
not merge until smoke is green.

---

## Deliverable

Branch: `feat/sync-native-listener-parity`
PR title: `feat(sync): native onSnapshot listener parity for @capacitor-firebase/firestore`

Commit sequence (after orchestrator phase gates):
1. `docs(sync-impl): native-sync-parity audit` — produced by `auditor`. STOP for Kyle review.
2. `feat(sync): wire @capacitor-firebase/firestore addCollectionSnapshotListener into native subscribe()` — produced by `engine-implementer`.
3. `test(sync): native-branch coverage for subscribe wrapper` — produced by `engine-tester`.
4. `chore: bump sw.js cache + ship native listener parity` — produced by `pr-shipper`, includes:
   - `sw.js` CACHE_NAME bump v90 → v91.
   - `tests/index.html` `<script>` tag for new test file.
   - CLAUDE.md backlog row #2 update — recast to note CAS still deferred (listener half shipped) and link the new PLAN.md row.
   - `docs/SESSION-LOG.md` new session entry covering this PR.
   - `docs/sync-impl/PLAN.md` new row in the post-Stage-E follow-ups section.

Tier expectation (auditor will stamp the canonical tier):
**Low-to-medium.** Single engine module, ~80 LOC added, mocked tests,
no UI, no new deps, no schema bump. The narrow scope + the parallel
web-branch contract as a reference design argue for **low**. The
mock-only test coverage (real native verification still requires
Kyle's iPhone smoke) argues for **medium**. Auditor's call.
