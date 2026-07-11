# Tempo cloud-sync — implement PR N-1 (Native parity: real-time listeners)

You're working on Tempo, a vanilla-JS PWA + Capacitor iOS app. This is the
first PR of the native-parity follow-up queued from E-1b/E-3 (backlog #3,
"last unshipped piece of the cloud-sync initiative").

**Scope decision (Kyle, 2026-07-10): LISTENER PARITY ONLY.** Discovery
confirmed `@capacitor-firebase/firestore` has **no transaction API in any
published version** (installed 6.3.1 checked via `dist/esm/definitions.d.ts`;
upstream `main` at v8.3.0 checked via the repo — `writeBatch` is write-only
atomicity, no read-inside-transaction). Native CAS via this plugin is
impossible, not pending. `runTransaction`'s native branch (the
`nativeUnsupported` throw) stays EXACTLY as-is; the backlog row gets
truthed-up in the ship phase.

## Required reading (before any code)

1. `js/sync-firestore.js` — the single Firestore SDK seam. The web branch of
   `subscribe(path, callback)` (E-3) is the contract to mirror: deferred-
   unsubscribe closure, `{docs, count}` callback shape, `{ok:false, error}`
   error shape, M2 local-echo guard.
2. `js/sync-engine.js` `_subscribeAllStores` (~line 2488) — consumes the
   seam. **Zero engine changes expected**: it already catches per-store
   subscribe failures → `listener-disconnected` → 300s-poll fallback, and
   emits `listener-connected` on success.
3. `node_modules/@capacitor-firebase/firestore/dist/esm/definitions.d.ts` —
   the plugin contract (verified 2026-07-10, v6.3.1):
   - `addCollectionSnapshotListener(options, callback)` → `Promise<CallbackId>`
     (CallbackId is a string; arrives async).
   - Callback signature: `(event | null, error)` where event =
     `{ snapshots: DocumentSnapshot[] }` and each snapshot =
     `{ id, path, data, metadata: { fromCache, hasPendingWrites } }`.
   - `removeSnapshotListener({ callbackId })` → `Promise<void>`.
4. `docs/CLOUD-SYNC-STRATEGY.md` v2.0 — invariants (F19a passthrough only;
   no merge-rule changes in this PR).
5. `tests/sync-listeners.test.js` — existing E-3 wrapper coverage to extend.
6. `iOS-BUILD.md` — device verification workflow (live-Pages payload; a
   `git push` deploy updates the shell, `npx cap sync ios` only if the
   plugin's native pod needs re-linking — it should NOT, the pod has been
   installed since S0-1).

## What this PR ships

The native branch of `SyncFirestore.subscribe(path, callback)` — replace the
"subscribe native parity pending" throw with a real implementation on
`Capacitor.Plugins.FirebaseFirestore`:

- Call `addCollectionSnapshotListener({ reference: norm }, cb)`; stash the
  `CallbackId` when the promise resolves.
- Return the unsubscribe closure **synchronously** (engine stashes it in
  `_listenerUnsubs` same tick) — reuse the web branch's deferred-unsubscribe
  pattern: if unsubscribe is called before the CallbackId resolves, set the
  cancelled flag and `removeSnapshotListener` on resolution.
- Map the event to the web-identical callback shape:
  `{ docs: [{id, data}], count }`.
- **M2 local-echo guard, adapted:** web drops snapshots where the
  query-level `metadata.hasPendingWrites` is true; the plugin exposes
  per-document metadata instead → drop the event when
  `snapshots.some(s => s.metadata && s.metadata.hasPendingWrites)`
  (query-level true ⇔ any doc pending, so semantics match web).
- Error path: plugin callback `error` arg → `callback({ ok: false,
  error: _normalizeError(err) })`, mirroring web `_onError`.
- Callback exceptions swallowed (must not break the listener), mirroring web.

**Testability refactor (same file, behavior-neutral):** `sync-firestore.js`
captures `const isNative` at IIFE-eval time, so the browser test suite can't
reach the native branch by swapping `window.Capacitor` (the sync-auth.test.js
pattern). Make the native check lazy — read `window.Capacitor` at call time,
mirroring `js/platform.js`. Auditor to confirm blast radius of this refactor
across the module's other methods (getDoc/setDoc/getCollection/runTransaction
share the same `isNative` const).

**Out of scope:** `runTransaction` native branch (stays as documented skip),
all `js/sync-merge-*.js`, `js/sync-engine.js`, merge semantics, any UI files.
Doc truth-ups (CLAUDE.md backlog row #3, docs/BACKLOG.md #3 detail) happen in
the ship phase per convention.

## Hard rules

- **Audit before code.** First artifact is
  `docs/sync-impl/audits/N-1-AUDIT.md`. STOP after the audit for review.
- **Web branch byte-equivalent.** The web path of `subscribe` must not
  change behavior (the lazy-isNative refactor must be a no-op on web).
- **Engine contract frozen.** `subscribe` still returns a synchronous
  unsubscribe fn; callback shapes are byte-identical to web.
- **`js/sync-firestore.js` is a cached web file** → `sw.js` CACHE_NAME bump
  in the same commit (hook + CI enforce).
- Engine-test plan: extend `tests/sync-listeners.test.js` — native branch
  arms via a stubbed `window.Capacitor.Plugins.FirebaseFirestore`
  (addCollectionSnapshotListener capture, event → `{docs,count}` mapping,
  per-doc hasPendingWrites drop, error → `{ok:false}`, unsubscribe →
  removeSnapshotListener with resolved CallbackId, unsubscribe-before-resolve
  cancellation, SYNC_DISABLED fast-path unchanged).

## Verification

- Full engine suite green (baseline PASS (1320)); UI suite 12 passed.
- On-device listener verification is **post-merge path-A** (Kyle's accepted
  pattern for iOS-facing work): after merge + Pages deploy, sign in on the
  iPhone, watch `#cloud-sync-status` flip from poll-only to
  `Listeners: connected`, then make a change on web and confirm sub-second
  arrival on the phone (vs the old ≤5-min poll). Remember ⌘R keeps the
  WKWebView HTTP cache — force-quit + >10 min after deploy.

## Deliverable

Branch `feat/sync-n-1-native-listener-parity`, PR against `main`.
PR title: `feat(sync): native real-time listener parity — N-1 (backlog #3)`.
