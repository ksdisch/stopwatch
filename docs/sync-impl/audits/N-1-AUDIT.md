# N-1 · Native real-time listener parity for `SyncFirestore.subscribe` (backlog #3)

**PR:** `feat/sync-n-1-native-listener-parity` → `main`
**Scope decision (Kyle, 2026-07-10):** LISTENER PARITY ONLY. No plugin version of
`@capacitor-firebase/firestore` (installed 6.3.1 through upstream 8.3.0) exposes a
transaction API — native CAS is impossible via this plugin, not pending.
`runTransaction`'s native branch (the `nativeUnsupported` throw) stays byte-identical.
**Status:** Audit-only artifact. Code commit follows after human review.

## Goal

Replace the "subscribe native parity pending" throw in `js/sync-firestore.js` with a real
native branch built on `Capacitor.Plugins.FirebaseFirestore.addCollectionSnapshotListener`,
so iOS gets sub-second cross-device propagation instead of the 5-minute poll. Includes a
behavior-neutral lazy-`isNative` refactor so the browser test suite can reach the native
branch by swapping `window.Capacitor` (the `sync-auth.test.js` #8a pattern).

## Blast radius

**Tier:** medium

**Justification:** One engine-layer file (`js/sync-firestore.js`) + its test file + a
`sw.js` cache bump — the rubric's High triggers don't apply (no NEW Capacitor plugin or
`Platform.*` namespace: the FirebaseFirestore plugin is already installed and already used
by this same file's getDoc/setDoc/getCollection native branches; no schema, rules,
`ios/*`, `package.json`, or merge-semantics changes; F19a is passthrough-only).

## Affected files

| Path | Change type | Notes |
|------|-------------|-------|
| `js/sync-firestore.js` | modify | (1) Native branch of `subscribe()` (line ~434): `addCollectionSnapshotListener({ reference: norm }, cb)` + deferred-unsubscribe closure + event→`{docs,count}` mapping + per-doc `hasPendingWrites` drop + error→`{ok:false,error}`. (2) Lazy-`isNative` refactor across the whole module (see enumeration below). `runTransaction`'s throw message + `nativeUnsupported` tag stay verbatim. |
| `tests/sync-listeners.test.js` | modify | New "native subscribe" describe block, ~9 cases (see Test scope). Stubbed `window.Capacitor` with save/restore-in-finally discipline (mirrors `sync-auth.test.js:592–638`). |
| `sw.js` | modify | `CACHE_NAME` bump (currently `stopwatch-v165-live-activities-closeout`) — `js/sync-firestore.js` is a cached web file; hook + CI enforce same-commit bump. |

Ship-phase docs (NOT in the code commit, per the brief's convention): CLAUDE.md Feature
Backlog row #3 truth-up + `docs/BACKLOG.md` #3 detail — handled by `pr-shipper`.

**Zero changes to `js/sync-engine.js` — verified.** `_subscribeAllStores`
(`js/sync-engine.js:2488–2550`) already: (a) wraps each per-store subscribe in try/catch →
`listener-disconnected` with `reason: 'subscribe-failed'` (this is what currently absorbs
the native throw), (b) treats `{ ok: false }` callbacks as a disconnect + tears down + lets
the next pass re-arm (M3), (c) stashes the synchronously-returned unsubscribe in
`_listenerUnsubs` the same tick. The new native branch satisfies the exact same contract
the web branch does, so the engine sees no difference.

### Lazy-`isNative` refactor — blast-radius enumeration (brief's open design point)

Today `js/sync-firestore.js:46–48` captures three module-scope consts at IIFE-eval time:

```js
const cap = (typeof window !== 'undefined' && window.Capacitor) || null;
const isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
const plugins = (cap && cap.Plugins) || {};
```

Proposed refactor: delete all three; add a `_isNative()` helper that reads
`window.Capacitor` at call time (mirroring `js/platform.js`), and make `_nativePlugin()`
(line ~187) read `window.Capacitor.Plugins.FirebaseFirestore` lazily.

**Every call site that changes — this is the complete set:**

| Site | Line (pre-change) | Change |
|------|-------------------|--------|
| `getDoc` | 215 | `if (isNative)` → `if (_isNative())` |
| `setDoc` | 244 | `if (isNative)` → `if (_isNative())` |
| `getCollection` | 268 | `if (isNative)` → `if (_isNative())` |
| `runTransaction` | 331 | `if (isNative)` → `if (_isNative())` — ONLY mechanical swap; body/message untouched |
| `subscribe` | 434 | `if (isNative)` → `if (_isNative())` + new native implementation |
| `_nativePlugin` | 187–197 | `plugins.FirebaseFirestore` → lazy `window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FirebaseFirestore` |

**Deleting the consts is the safety mechanism:** any missed conversion becomes a
`ReferenceError` at first call, caught immediately by the existing suite (every public
method has coverage), rather than a silently-stale boolean.

**Why web behavior is unchanged:** on web, `window.Capacitor` is undefined at every call,
so `_isNative()` returns `false` on every invocation — identical branch selection to the
old const (which evaluated to `false` once). No production environment can change the
value mid-session: on native, Capacitor injects `window.Capacitor` before any script
executes; on web it never appears. The only environment where the value flips at runtime
is the test page — which is the entire point of the refactor.

**Naming constraint (existing-test hazard):** `tests/sync-uploader.test.js:1077–1081`
asserts `SyncFirestore.runTransaction.toString()` matches BOTH `/native parity pending/`
and `/isNative/`. The lazy helper MUST keep `isNative` as a name substring (`_isNative()`
satisfies the regex) and the runTransaction throw message must stay verbatim, or that
test breaks.

## Cross-cutting invariants touched

- **F19a (refuse-writeback) — passthrough only.** The seam is transport: refuse-writeback
  gates live downstream (dispatcher snapshot pre-filter + per-merge-fn cloud gates + CAS
  path, all tested in `tests/sync-listeners.test.js` #17–21). No F19a code changes;
  semantics must remain byte-identical. No F1/F6/F10/F13/F15/F16 surface — this PR writes
  nothing to synced stores.
- **M2 local-echo guard, adapted for per-doc metadata.** Web drops snapshots where the
  query-level `snapshot.metadata.hasPendingWrites` is true; the plugin exposes per-doc
  metadata only → native drops the event when
  `snapshots.some(s => s.metadata && s.metadata.hasPendingWrites)`. Semantics match:
  Firestore's query-level flag is true iff any doc in the snapshot has pending writes.
  The `s.metadata &&` guard means metadata-absent snapshots are NOT dropped (metadata is
  `@since 6.2.0`; installed 6.3.1 has it, but fail-open is the safe direction — a dropped
  legitimate event silently degrades to the 5-min poll).
- **Engine listener contract — frozen.** `subscribe` returns a synchronous unsubscribe fn;
  callback shapes `{docs: [{id, data}], count}` / `{ok: false, error: <normalized>}` are
  byte-identical to web; caller-callback exceptions swallowed.
- **Error normalization seam.** Plugin errors route through the existing
  `_normalizeError()` (which already maps `FIRESTORE/<code>` plugin patterns).

Plugin contract verified directly against
`node_modules/@capacitor-firebase/firestore/dist/esm/definitions.d.ts` (v6.3.1):
`addCollectionSnapshotListener(options, cb) → Promise<CallbackId>` (string, arrives
async); callback `(event | null, error)` with `event.snapshots: DocumentSnapshot[]`, each
`{ id, path, data: T | null, metadata: { fromCache, hasPendingWrites } }`;
`removeSnapshotListener({ callbackId })`. Matches the brief exactly. Note `data` is
nullable in the type — map `{id, data}` verbatim (parity with the native `getCollection`
branch at line 275, which does the same).

## Risks

| Risk | Likelihood | Blast radius | Mitigation |
|------|------------|--------------|------------|
| Missed `isNative` call-site conversion leaves a stale reference | low | local-only | Delete the module-scope consts so a miss is a `ReferenceError` caught by the existing suite; the 6-site table above is the exhaustive grep of the file. |
| `sync-uploader.test.js:1080` `toString()` source assertion breaks if the helper isn't named with the `isNative` substring or the runTransaction message changes | med | local-only | Hard constraint recorded above: name the helper `_isNative()`; runTransaction body untouched except the mechanical branch swap. |
| Native listener leak on unsubscribe-before-CallbackId-resolves (dead listener keeps firing into a torn-down callback → duplicate merge scheduling after the engine re-arms) | med | native-build | Clone the web deferred-unsubscribe pattern: cancelled flag checked on promise resolution → `removeSnapshotListener` immediately; post-cancel events must not be forwarded. Dedicated test case. |
| M2 echo-guard drift on native (wrong drop condition re-opens the self-triggering merge loop, or over-drops remote events) | low | native-build | `some()`-over-per-doc-metadata is provably equivalent to the query-level flag; fail-open on absent metadata; independent second half of M2/M5 (`SyncMergeEqual.recordsEqual` CAS writeback guard) still blocks redundant cloud writes even if the echo guard fails. |
| `addCollectionSnapshotListener` promise rejection (plugin missing, bad reference) surfaces as an unhandled rejection instead of a `listener-disconnected` | low | native-build | Mirror the web setup-failure path: catch inside the async closure → `callback({ok: false, error: _normalizeError(err)})` → engine emits `listener-disconnected` and the 300s poll continues as the floor. |
| Cache bump missed for `js/sync-firestore.js` | low | web-bytes | `pre-commit-guard` hook + CI `sw-cache-bump` job both enforce same-commit bump. |

Breakdown: 4 low / 2 med / 0 high. No data-loss vector: this PR adds a read-side
transport only; all write paths (CAS, merges, stamping) are untouched, and the worst
listener failure degrades to the existing 5-minute poll.

## Test scope

- **New tests required:** `tests/sync-listeners.test.js` — ~9 cases in a new
  "SyncFirestore.subscribe — native branch" describe block. Native arm = stub
  `window.Capacitor = { isNativePlatform: () => true, Plugins: { FirebaseFirestore: <stub> } }`
  with restore-in-`finally` (the `sync-auth.test.js:592–638` pattern):
  1. Native routing: `subscribe` calls `addCollectionSnapshotListener` with
     `{ reference: <normalized path> }` (leading-slash input normalized) and returns a
     function synchronously.
  2. Event mapping: plugin event `{snapshots: [{id, path, data, metadata: {fromCache: false, hasPendingWrites: false}}]}`
     → callback receives `{docs: [{id, data}], count: 1}`.
  3. Per-doc echo drop: event where ANY snapshot has `metadata.hasPendingWrites: true`
     → callback NOT invoked.
  4. Metadata-absent snapshots are NOT dropped (`s.metadata &&` fail-open guard).
  5. Error path: plugin invokes `cb(null, err)` → callback receives
     `{ok: false, error}` with normalized shape (`kind` string + `isRetryable` boolean).
  6. Unsubscribe after CallbackId resolves → `removeSnapshotListener({callbackId})`
     called with the resolved id.
  7. Unsubscribe before CallbackId resolves → cancellation honored: on resolution
     `removeSnapshotListener` fires (no leak) and no events are forwarded post-cancel.
  8. SYNC_DISABLED fast-path unchanged on native: throws synchronously, plugin never
     touched.
  9. Callback-exception swallow: caller's callback throws → listener survives (a second
     plugin event is still delivered).
- **Existing tests at risk:**
  - `tests/sync-uploader.test.js:1058–1086` — the `toString()` source assertions on
    `runTransaction` (`/isNative/` + `/native parity pending/`). Green iff the naming
    constraint above is followed.
  - `tests/sync-listeners.test.js` #1–3 (wrapper guards) — must stay green untouched;
    they prove the web-default routing is unchanged. Note the file's header comment lists
    a "native branch throws parity pending" case that was never implemented as an `it()`
    — nothing asserts the old subscribe throw, so removing it breaks no test; the
    implementer should truth-up that header comment while in the file.
  - `tests/sync-auth.test.js` #8a is the only existing test that sets `window.Capacitor`
    with `isNativePlatform: () => true`; verified it calls no `SyncFirestore` method and
    restores in `finally` — no interaction with the lazy refactor. New native tests must
    keep the same save/restore discipline or they'd flip routing for later tests.
  - Baseline: engine `PASS (1320)` via `npm test`; UI 12 passed via `npm run test:ui`.

## Manual setup steps (if any)

Post-merge device verification only (Kyle's accepted path-A pattern for iOS-facing work) —
nothing is required before or during implementation:

1. Merge + Pages deploy; wait >10 min, then force-quit Tempo on the iPhone (⌘R/warm
   relaunch keeps the WKWebView HTTP cache — known gotcha).
2. Cold-launch, sign in, watch `#cloud-sync-status` flip from poll-only to
   `Listeners: connected`.
3. Make a change on web (e.g. log a dose) and confirm sub-second arrival on the phone
   (vs the old ≤5-min poll).
4. No `npx cap sync ios` / Xcode rebuild expected: the FirebaseFirestore pod has been
   linked since S0-1 and this PR adds no plugin; `ios/*` and `capacitor.config.json` are
   untouched (per `iOS-BUILD.md`, web-code changes ride the live-Pages payload).

## Out of scope (explicitly NOT in this PR)

- **Native CAS / `runTransaction` parity — permanently out, not deferred.** No published
  plugin version through 8.3.0 has a transaction API (`writeBatch` is write-only
  atomicity). The `nativeUnsupported` throw stays; merge modules keep defensive-skipping
  the CAS writeback on native. Backlog row #3 gets truthed-up at ship.
- `js/sync-engine.js` — zero changes (contract verified above).
- All `js/sync-merge-*.js` / merge semantics / F-invariant logic.
- Any UI files (`#cloud-sync-status` already renders listener state from E-3 events) —
  no `ui-wirer` phase needed.
- `addDocumentSnapshotListener` / collection-group listeners — the engine subscribes
  per-collection only.
- Doc truth-ups (CLAUDE.md backlog row #3, `docs/BACKLOG.md`) — ship phase, per
  convention.

## Sign-off checklist (for the implementer)

- [ ] Engine module changes match the affected-files table (`js/sync-firestore.js` only;
      all 6 lazy-`isNative` sites converted; module-scope `cap`/`isNative`/`plugins`
      consts deleted)
- [ ] `runTransaction` body untouched except `isNative` → `_isNative()`; throw message +
      `nativeUnsupported` tag verbatim (`sync-uploader.test.js:1077–1081` stays green)
- [ ] Test scope above is covered (~9 native cases in `tests/sync-listeners.test.js`,
      `window.Capacitor` restored in `finally` in every case)
- [ ] No re-implementation of `escapeHtml` (js/dom-utils.js) / `Utils.formatMs`
      (js/utils.js) / `Platform.*` (js/platform.js)
- [ ] `sw.js` `CACHE_NAME` bumped in the same commit (`js/sync-firestore.js` is cached)
- [ ] (sync PR) No writes to synced stores in this PR — nothing new to stamp via
      `js/schema.js`; F19a passthrough semantics byte-identical
