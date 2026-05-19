# native-sync-parity · Native `onSnapshot` listener parity for `@capacitor-firebase/firestore`

## Goal

Replace the `'subscribe native parity pending'` throw in
`js/sync-firestore.js` with a real native implementation that wraps
`@capacitor-firebase/firestore`'s `addCollectionSnapshotListener` so iOS
clients get sub-second cross-device propagation instead of falling back
to the 5-minute defensive poll. `runTransaction()` native CAS parity is
explicitly NOT in scope — plugin v6.3.1 does not expose `runTransaction`
and `writeBatch` is not read-conditional.

## Blast radius

**Tier:** medium

**Justification:** Single-engine, ~80-LOC change with mocked-only tests
and no UI / schema / dep changes would otherwise be **low**, but the
project-rule cache bump on `sw.js` (because `js/sync-firestore.js` is a
cached web file) trips the rubric's "`sw.js` cache bump needed → medium"
trigger and pins the tier at **medium**.

## Affected files

| Path | Change type | Notes |
|------|-------------|-------|
| `js/sync-firestore.js` | modify | Replace the `throw _wrap('unknown', 'subscribe native parity pending', …)` at lines 424–434 with a native implementation wrapping `window.Capacitor.Plugins.FirebaseFirestore.addCollectionSnapshotListener` + `removeSnapshotListener`. Mirror the web branch's deferred-unsubscribe closure shape from lines 447–496 line-for-line (closure captures `_callbackId` + `_cancelled`; synchronously-returned unsubscribe fn either calls `removeSnapshotListener({ callbackId })` or sets `_cancelled = true`). Convert plugin event shape `{ snapshots: DocumentSnapshot[] }` → web contract `{ docs: [{id, data}], count }`. Convert plugin's `(event, error) => void` callback to the web invocation pattern. Reuse the existing `_normalizeError`, `_normPath`, `_flagOn`, `_wrap` helpers. Web branch (lines 437–496) stays byte-identical. `runTransaction()` native branch at lines 331–343 stays untouched — CAS deferral is intentional. |
| `tests/sync-firestore.test.js` | add | New file. ~8–12 native-branch cases against a mocked `window.Capacitor.Plugins.FirebaseFirestore`. See "Test scope" below. |
| `tests/index.html` | modify | Add a single `<script src="sync-firestore.test.js"></script>` tag after the existing `<script src="sync-listeners.test.js"></script>` at line 109. Test-runner dependency-order is minimal; placement matches the brief. Phase-5 (`pr-shipper`) wires this per project convention — not Phase 3 (`engine-tester`). |
| `sw.js` | modify | `CACHE_NAME` bump `'stopwatch-v90-rhythm-pillar'` → `'stopwatch-v91-native-sync-parity'`. Fires per project rule because `js/sync-firestore.js` is a cached web file whose bytes change. Phase-5 ride. |

**Out of the affected-files table (and out of scope):**
`index.html` (the `<script src="js/sync-firestore.js">` tag already exists, no changes needed), `package.json` (`@capacitor-firebase/firestore@^6.3.1` already a dep since S0-1 / PR #46), any `js/*-ui.js` (no UI surface touched — Phase 4 ui-wirer never fires), `js/sync-engine.js` (downstream caller already branches on `payload.ok === false`; native payload shape will match web verbatim so no engine-side change needed), all `js/sync-merge-*.js` (F19a cloud-side gates unchanged), `js/platform.js` (no `Platform.firestore` shim refactor in this PR per brief hard rule), `ios/*` + `capacitor.config.json` (no native config change), `js/schema.js` (no SCHEMA_VERSION bump — no envelope change). Doc updates (CLAUDE.md backlog row #2 reframe, SESSION-LOG entry, PLAN.md follow-up row) ride in Phase 5 alongside the cache bump.

## Cross-cutting invariants touched

- **F10 (deviceId + updatedAt + schemaVersion envelope stamping)** — passthrough. Native listener delivers cloud records verbatim; envelope fields ride through unchanged. No stamping decisions live in this wrapper.
- **F13 (offline buffer / pending ops)** — passthrough. Listener wire-up is read-only; the offline buffer (`js/sync-buffer.js`) is untouched. Native still gets the buffer flush on `Platform.network.onChange(online)`.
- **F19a (refuse-writeback contract)** — preserved verbatim. Native CAS deferral keeps F19a best-effort on iOS via cloud-side gates (per-store dispatcher snapshot pre-filter + per-merge-fn schemaVersion check before `setDoc` in each `js/sync-merge-*.js` module) — this is the status quo since E-1b shipped 2026-05-13. This PR introduces zero regression: cloud-side gates continue to enforce schemaVersion checks; the listener wrapper sits upstream of them. The Toast.downlevelWarning hook (E-3 user-visible surface) continues to fire on `'refuse-writeback'` events on both branches.
- **F19b (forward-compatibility / `__forward` passthrough)** — passthrough. Listener delivers raw doc shapes to the merge layer; `__forward` stripping/restoring lives in `js/schema.js` and is invariant to which subscribe branch produced the snapshot.
- **F21 (`alarmFired` per-device)** — not touched. Engine state is excluded from sync entirely; subscribe wraps cloud collections, not local engine state.

No invariant changes. No `schema.js` SCHEMA_VERSION bump. No new persistence key. No new `tempo_sync_*` flag.

## Risks

| Risk | Likelihood | Blast radius | Mitigation |
|------|------------|--------------|------------|
| iOS smoke-test verification gap — engine tests mock `window.Capacitor.Plugins.FirebaseFirestore` so they cannot catch real plugin-shape regressions (e.g. plugin v6.3.1 → v6.x.y diff in `DocumentSnapshot.data` accessor). | med | native-build | Manual smoke per the brief's "Manual iOS verification" section is required before merge. Kyle's iPhone runs the 7-step smoke (log a dose on web, verify ~1–2s propagation to iPhone foreground; reverse direction; background/foreground re-arm check; Xcode console scan for `removeSnapshotListener` errors). Smoke must be marked ✓ in `docs/SESSION-LOG.md` before the PR merges. |
| Native vs web callback-shape divergence — if the native branch's `{ docs, count }` conversion deviates even slightly (extra fields, different key names, snapshot iteration semantics) downstream `js/sync-engine.js` could silently skip records or double-process. | med | data-loss | Implementer mirrors the web branch's `snapshot.forEach(d => docs.push({ id: d.id, data: d.data() }))` shape line-for-line, using the plugin's `event.snapshots.forEach(s => docs.push({ id: s.id, data: s.data }))` equivalent (plugin returns `data` as a property, not a method — per `DocumentSnapshot<T>` shape at `definitions.d.ts:477`). Test case in tests/sync-firestore.test.js asserts the exact `{ docs: [...], count: N }` shape with `docs[i].id` + `docs[i].data` keys. Sign-off criterion: side-by-side diff of native+web branches must show identical callback-invocation shape. |
| Deferred-unsubscribe race on native — caller invokes `unsubscribe()` before `addCollectionSnapshotListener` resolves; the closure must (a) flag `_cancelled = true`, (b) call `removeSnapshotListener({ callbackId })` when the async resolution lands, and (c) not leak a listener. Symmetry with web's `_realUnsub` pattern is the contract. | med | local-only | Mirror the web branch's `_cancelled` flag + post-await check at lines 473–478 line-for-line in the native branch. Test case: "unsubscribe-before-load race" — stub `addCollectionSnapshotListener` to resolve on a delay, call `subscribe()` then synchronous `unsubscribe()`, assert no callback fires AND `removeSnapshotListener` is called exactly once. |
| Callback-throw mid-stream breaks the listener — caller's callback throws on a snapshot event; if not caught, the plugin's listener loop dies and iOS silently drops to defensive-poll latency without surfacing the error. | low | local-only | Wrap both branches of the plugin callback (`event != null` and `error != null`) in the same try/catch pattern as the web branch at lines 457–471 (silent swallow inside the listener; the contract is "must not break the listener"). Test case: caller's callback throws on event 1; assert event 2 still arrives. |
| `removeSnapshotListener` tear-down throws — plugin v6.3.1's `removeSnapshotListener` can reject when called with a stale `callbackId` (e.g. plugin re-init during tear-down). If propagated, the unsubscribe fn would throw at the caller, leaking listener-registry state in `js/sync-engine.js`. | low | local-only | Wrap the tear-down call in `try { await plugins.FirebaseFirestore.removeSnapshotListener({ callbackId }); } catch (_) {}` matching the web branch's `try { _realUnsub(); } catch (_) {}` shape at line 493. Test case asserts the unsubscribe fn never throws even when `removeSnapshotListener` is stubbed to reject. |
| Plugin error-code coverage gap — `_normalizeError` was written against web FirebaseError codes + a best-effort `FIRESTORE/<error-code>` substring match (lines 91–104). Native plugin error codes may emerge as `kind: 'unknown'` instead of the more-specific `permission-denied` / `network` / `not-found`, masking signal in the Toast layer. | low | local-only | Existing `_normalizeError` already has a best-effort `FIRESTORE/...` prefix matcher; new test case asserts a stubbed plugin error with `code: 'FIRESTORE/permission-denied'` normalizes to `kind: 'permission-denied'`. Unknown shapes fall through to `kind: 'unknown'` — acceptable. Real-world plugin error shape discovery happens during iOS smoke; if a new pattern emerges, log it as a follow-up rather than block this PR. |
| Cache-bump miss — `js/sync-firestore.js` bytes change; if `sw.js` `CACHE_NAME` isn't bumped, native users would see stale JS via the SW until the old cache expires (web is unaffected since native skips SW registration entirely per project rule). | low | web-bytes | Phase-5 `pr-shipper` handles the bump (`v90` → `v91`). Sign-off checklist item below. Engine-implementer reports "sw.js cache-bump needed: yes" to the orchestrator. |

**Risk count:** 6 (3 medium, 3 low; 0 high). The deferred native `runTransaction` CAS parity is NOT listed as a risk — it's a scope boundary documented in the Out-of-scope section, not a regression vector.

## Test scope

**New file:** `tests/sync-firestore.test.js` — 8 cases against a mocked `window.Capacitor.Plugins.FirebaseFirestore`. The test sets `window.Capacitor.isNativePlatform = () => true` for the native-branch cases and restores `false` (or removes the stub) for the fallthrough case. Uses the existing `describe / it / assert / assertEqual` test-runner API.

1. **Native happy path** — stub `addCollectionSnapshotListener` to resolve `{ callbackId: 'cb-1' }` and immediately invoke the registered callback with a synthetic `event = { snapshots: [{ id: 'a', data: {...} }, { id: 'b', data: {...} }] }`; assert caller's callback receives `{ docs: [{id:'a',data:...},{id:'b',data:...}], count: 2 }`.
2. **Native unsubscribe-before-load race** — stub `addCollectionSnapshotListener` to resolve `{ callbackId: 'cb-2' }` on a delayed promise; call `subscribe()`, synchronously call the returned unsubscribe fn before the stub resolves, then let the stub resolve; assert (a) no callback fires, (b) `removeSnapshotListener({ callbackId: 'cb-2' })` is called exactly once.
3. **Native error mid-stream** — fire the plugin callback as `(null, { code: 'FIRESTORE/permission-denied', message: '…' })`; assert caller receives `{ ok: false, error: { kind: 'permission-denied', message, isRetryable: false, originalError } }`.
4. **Native callback-throw safety** — caller's `subscribe` callback throws on event 1; fire event 2; assert event 2's callback invocation still arrives (listener stays alive).
5. **Native `SYNC_DISABLED` fast-path** — with `SyncFlag.isEnabled() === false`, assert `subscribe()` throws `{ kind: 'unknown', message: 'SYNC_DISABLED' }` synchronously and does NOT call `addCollectionSnapshotListener` at all.
6. **Native path normalization** — call `subscribe('/users/foo/meds', cb)` and `subscribe('users/foo/meds', cb)`; assert both produce the same `reference: 'users/foo/meds'` in the `addCollectionSnapshotListener` options (via `_normPath`).
7. **Native `isNative=false` fallthrough sanity** — with `window.Capacitor.isNativePlatform = () => false` (or `window.Capacitor` removed entirely), assert the web branch is reached — smoke check that the native branch doesn't intercept when it shouldn't. Don't re-test the full web path (already covered elsewhere).
8. **`removeSnapshotListener` resilience** — stub `removeSnapshotListener` to throw / reject; call `subscribe()`, then the returned unsubscribe fn; assert the unsubscribe fn does not propagate the throw (matches web's `try { _realUnsub(); } catch (_) {}` shape).

**Total engine tests post-PR:** 628 (baseline on `main` @ `dc1b6b2`) + 8 = **636** in `tests/index.html`.

**Existing tests at risk:**
- `tests/sync-engine.test.js` — exercises the listener registry that calls `SyncFirestore.subscribe`. The web branch is unchanged; native-branch tests run only when `isNative === true` is stubbed in. Existing sync-engine tests run in default (web) mode and should be unaffected. Implementer must verify all 628 existing tests still pass after the implementation lands.
- `tests/sync-listeners.test.js` (if it covers the deferred-unsubscribe pattern via the web branch) — should be untouched by the native branch addition. Verify count stays the same.

## Manual setup steps (if any)

**Pre-merge iOS smoke test (required, blocking).** Engine tests cover the native branch only via mocked plugins. Real-device verification is required because plugin v6.3.1's runtime behavior (especially `removeSnapshotListener` semantics under WKWebView backgrounding) cannot be reproduced in the in-browser test harness.

1. `npm run ios:open` — sync `www/` and open Xcode.
2. Build to a physical iPhone via Xcode (free-cert is fine; refresh every 7 days per `iOS-BUILD.md`).
3. Sign in with the test Google account on iPhone.
4. On a laptop already signed in via web, log a dose for any med.
5. Verify the dose appears on iPhone within ~1–2 s while iPhone is foregrounded. (Pre-PR latency floor was ~5 min — defensive poll path.)
6. On iPhone, log a different dose. Verify it appears on web within ~1–2 s.
7. Background the iPhone for 30+ seconds, then foreground; verify the listener re-arms cleanly (existing `visibilitychange` handler in `js/sync-engine.js` calls `_subscribeAllStores` again — no errors expected).
8. Check Xcode console for any `removeSnapshotListener` errors during the catch-up `_runMergeCycle`. Expected: zero.

If smoke fails: revert the PR. Do not merge until all 7 steps pass. Mark "smoke ✓" in `docs/SESSION-LOG.md` before merging.

## Out of scope (explicitly NOT in this PR)

- **Native `runTransaction()` CAS parity at `js/sync-firestore.js:325–385`.** Plugin v6.3.1 does not expose a `runTransaction` API; the closest atomic primitive (`writeBatch`, plugin `@since 6.1.0`) writes multiple operations atomically but has no read-conditional check, which is what CAS requires. All three paths to native CAS — wait for upstream plugin support, contribute the wrapper upstream, or emulate CAS via `getDocument` + conditional `setDocument` (rejected because non-atomic; would silently break F19a) — remain deferred. F19a refuse-writeback continues to enforce on iOS via the existing cloud-side gates in each `js/sync-merge-*.js` module (status quo since E-1b). The native throw at lines 331–343 stays in place.
- **`Platform.firestore` namespace shim.** The native + web branches of `js/sync-firestore.js` continue routing directly to `window.Capacitor.Plugins.FirebaseFirestore` / dynamic `import('…firebase-firestore.js')` per the existing convention at lines 215, 244, 268. A `Platform.firestore` abstraction would be a separate scope-expansion PR.
- **SCHEMA_VERSION bump.** No envelope changes; F10 stamps ride through verbatim.
- **`index.html` script-tag changes.** The `<script src="js/sync-firestore.js">` tag is already present.
- **`package.json` changes.** `@capacitor-firebase/firestore@^6.3.1` already installed since S0-1 (PR #46).
- **New `tempo_sync_*` localStorage flag.** None needed; native parity is unconditional once flag-on + signed-in.
- **`js/sync-engine.js` listener-registry changes.** Downstream caller already branches on `payload.ok === false` from web testing; native payload matches verbatim by construction.
- **UI surface changes.** No `js/*-ui.js`, `index.html`, `css/*.css`, or `tempo-nav.js` edits. Phase-4 ui-wirer is skipped entirely; workflow jumps from engine-tester (Phase 3) directly to pr-shipper (Phase 5).
- **`addDocumentSnapshotListener` parity.** Tempo's sync architecture only subscribes at the collection level (per-store collection paths `users/{uid}/{store}`). The per-document listener variant is not needed and stays unwired.
- **`addCollectionGroupSnapshotListener` parity.** Not used by the SyncEngine.

## Sign-off checklist (for the implementer)

- [ ] `js/sync-firestore.js` `subscribe()` native branch replaces the throw at lines 424–434 with a real implementation; web branch at lines 437–496 stays byte-identical (`git diff` of the web branch should be empty).
- [ ] Native branch mirrors the web branch's deferred-unsubscribe closure shape line-for-line: `_cancelled` flag, `_realUnsub` / `_callbackId` capture, post-await cancellation check, synchronously-returned unsubscribe fn.
- [ ] Native plugin event-shape conversion (`{ snapshots: DocumentSnapshot[] }` → `{ docs: [{id, data}], count }`) uses `event.snapshots.forEach(s => docs.push({ id: s.id, data: s.data }))` — note `data` is a property on the plugin's `DocumentSnapshot`, not a method like the web SDK's `snap.data()`.
- [ ] Native error path (`error != null` in plugin callback) routes through the existing `_normalizeError` helper and surfaces as `{ ok: false, error: <normalized> }` via the caller's callback — matching the web branch's `_onError` shape at lines 465–471.
- [ ] Native path-normalization uses the existing `_normPath` helper; `reference` field is the normalized string (no leading slash).
- [ ] Native `SYNC_DISABLED` fast-path: the existing throw at line 418 fires pre-`isNative` check, so it just works; verify no native-only bypass was introduced.
- [ ] `removeSnapshotListener` tear-down wrapped in `try { … } catch (_) {}` matching web's line 493.
- [ ] `runTransaction()` native throw at lines 331–343 stays in place (verbatim).
- [ ] No re-implementation of `escapeHtml` (js/dom-utils.js) / `Utils.formatMs` (js/utils.js) / `Platform.*` (js/platform.js) / `_normalizeError` / `_normPath` / `_flagOn` / `_wrap` — all existing helpers reused.
- [ ] No `Platform.firestore` shim introduced.
- [ ] No new `tempo_sync_*` localStorage flag.
- [ ] `js/schema.js` SCHEMA_VERSION unchanged.
- [ ] `tests/sync-firestore.test.js` added with all 8 cases listed above; passes locally via `tests/index.html` in a real browser; total engine-test count = 636.
- [ ] All 628 existing engine tests still pass (no regression in `sync-engine.test.js`, `sync-listeners.test.js`, or any other suite).
- [ ] `sw.js` `CACHE_NAME` bumped `'stopwatch-v90-rhythm-pillar'` → `'stopwatch-v91-native-sync-parity'` (Phase-5 ride).
- [ ] `tests/index.html` `<script src="sync-firestore.test.js"></script>` added after line 109's `<script src="sync-listeners.test.js"></script>` (Phase-5 ride).
- [ ] All writes to synced stores stamp `deviceId` + `updatedAt` + `schemaVersion` via `js/schema.js` — N/A here (no synced-store writes added; listener is read-only).
- [ ] Manual iOS smoke (7 steps above) marked ✓ in `docs/SESSION-LOG.md` before merge.
- [ ] CLAUDE.md backlog row #2 reframe (listener half shipped, CAS still deferred) + PLAN.md new follow-up row + SESSION-LOG entry — Phase-5 rides.
