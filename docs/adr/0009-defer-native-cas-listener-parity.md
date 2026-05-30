# ADR 0009: Defer native CAS + real-time listener parity — ship web-first, run a degraded native path

- **Status:** Accepted (retro-documented 2026-05-30)
- **Date:** 2026-05-13 → 2026-05-14 (decided when E-1b's CAS wrapper and E-3's onSnapshot wrapper both shipped web-only; the runTransaction native branch landed in E-1b, the subscribe native branch in E-3)
- **Deciders:** ksdisch
- **Tags:** sync, ios, capacitor, scope

## Context

Cloud sync was the largest single initiative in Tempo's history — ~28 PRs across stages B through E. The same merge code runs in two environments: the web build (GitHub Pages, push-to-deploy) and the Capacitor iOS shell (a WKWebView running byte-identical JS). Two Firestore primitives carry the high-value half of the sync design:

- **`runTransaction` (CAS).** The F19a refuse-writeback guard's *transactional* gate — the Firestore transaction reads the current remote doc inside the transaction body and aborts the write if `remote.schemaVersion > Schema.SCHEMA_VERSION`, so a downlevel client can't clobber a future-schema record under a concurrent multi-device write (`js/sync-firestore.js:303-317`). Queued from E-1b.
- **`subscribe` (onSnapshot).** Real-time per-collection listeners — the *primary* cross-device propagation mechanism. When another device writes, Firestore pushes the changed collection and the engine runs a per-store merge within ~1s instead of waiting for the next poll. Queued from E-3.

The web SDK exposes both directly — they are pulled into the lazy-loaded SDK cache alongside the existing imports (`js/sync-firestore.js:151` `runTransaction`, `:155` `onSnapshot`) and wired into the web branches of the wrapper (`js/sync-firestore.js:345-385`, `:437-497`). The native plugin `@capacitor-firebase/firestore` has different shapes — `runTransaction` had not been verified against the plugin at all, and the listener equivalent (`addSnapshotListener`) needs its own wire-up + teardown contract.

The forces specific to this repo:

1. **The hard half can't be verified in the harness.** There is no Node test runner — engine tests run by opening `tests/index.html` in a browser (`CLAUDE.md` test-commands). The web CAS and listener paths are exercised that way. The *native* paths require Xcode + a physical iPhone to verify the plugin's transaction/listener shapes — the solo author cannot unit-test them in the web harness, so shipping them blind would mean shipping unverified code as the gate on the entire feature.
2. **The web half is the larger value and the safer ship.** Real-time propagation + atomic CAS is most of what "good sync" means, and it's the half that *is* testable. Blocking the whole 28-PR initiative on the unverifiable native half inverts the risk.
3. **Native degrades gracefully — the feature still works.** The steady-state design already carries a defensive fallback: a 5-min poll (`STEADY_STATE_DEFAULT_MS = 300000`, `js/sync-engine.js:99`) and a per-record `setDoc` writeback loop (`js/sync-engine.js:801`, `:1673-1717`). On native, sync runs through exactly that path — merges still happen, append-only health data still unions. Only atomicity (CAS) and latency (real-time → 5-min) degrade.

## Decision

We consciously **defer native parity** for `runTransaction` and `subscribe` and ship the web build with real-time listeners + atomic CAS, letting native iOS run a functional-but-degraded path until a single follow-up PR wires `addSnapshotListener` + `runTransaction` for `@capacitor-firebase/firestore`.

The native branches of both wrappers throw an explicit, normalized "native parity pending" error rather than silently no-op'ing:

- `runTransaction(fn)` — the native branch throws `_wrap('unknown', 'runTransaction native parity pending — web-only in E-1b; see follow-up issue', false, null)` (`js/sync-firestore.js:331-343`). The web branch runs the real transaction with the `tx.get`/`tx.set`/`tx.refuseWriteback` adapter (`js/sync-firestore.js:345-385`).
- `subscribe(path, callback)` — the native branch throws `_wrap('unknown', 'subscribe native parity pending — web-only in E-3; see follow-up issue', false, null)` (`js/sync-firestore.js:424-435`). The web branch registers `onSnapshot` and returns the SDK's unsubscribe verbatim (`js/sync-firestore.js:447-497`).

The header comment marks both as web-only at the API contract level (`js/sync-firestore.js:13-14`).

The engine is built to *absorb* those throws so native stays functional:

- **Listener wire-up is fault-isolated per store.** `_subscribeAllStores()` wraps each `SyncFirestore.subscribe` call in try/catch — the native parity-pending throw is caught, emits `listener-disconnected` with `reason: 'subscribe-failed'`, and **does not break the wire-up of the other stores** (`js/sync-engine.js:2388-2398`). The comment names the native throw as the exact scenario this guards (`js/sync-engine.js:2389`).
- **The 5-min poll is the explicit safety net.** `startSteadyState()` arms the `setInterval` poll first (`js/sync-engine.js:2444`), then calls `_subscribeAllStores()` inside its own try/catch — the comment states a listener wire-up failure "must NOT prevent the defensive 5-min poll from arming. The 5-min poll is the safety net for exactly this scenario" (`js/sync-engine.js:2447-2453`). So on native, all six `subscribe` calls throw, all six listeners report disconnected, and the poll carries propagation alone.
- **Writeback degrades to `setDoc`.** The per-record cloud write path is plain `SyncFirestore.setDoc` (`js/sync-engine.js:801`), reused by the merge writeback loop (`js/sync-engine.js:1673-1717`). On native there is no CAS transaction around it — the F19a guard still runs via the cloud-side pre-filter and the local-side filter, but the transactional refuse-writeback gate is absent.

This is tracked as the **last unshipped piece of the cloud-sync initiative** in the feature backlog (`CLAUDE.md:175`, backlog row #3): "native CAS + listener parity for `@capacitor-firebase/firestore`" — a single follow-up PR pairing `addSnapshotListener` + `runTransaction`. ADR 0004 records the downstream *consequence* of this deferral on the merge layer (`docs/adr/0004-per-store-merge-strategy.md:55`); this ADR is the decision record for the deferral itself.

## Consequences

### Positive
- **The whole sync feature shipped instead of stalling on its hardest-to-verify half.** Web users got real-time + atomic sync without waiting on Xcode-and-device verification of the native plugin's transaction/listener shapes.
- **The web build keeps its strongest guarantees.** Real-time onSnapshot propagation (`js/sync-firestore.js:447-497`) and the transactional F19a CAS gate (`js/sync-firestore.js:345-385`) are not weakened to match the weaker platform.
- **Append-merge correctness survives on native.** The poll still runs every merge fn; `doseLog`, naps, BFRB catches, and distractions still union rather than overwrite, because that correctness lives in the merge modules, not in CAS. Native sync is degraded, not broken.
- **The degradation is loud, not silent.** The native branches throw a *typed* "native parity pending" error (`js/sync-firestore.js:339`, `:431`) and the engine emits `listener-disconnected` (`js/sync-engine.js:2393`) rather than failing quietly — the UI status can reflect reality, and the follow-up is impossible to forget.
- **The follow-up is bounded.** It's a single PR touching two native branches in one seam file (`js/sync-firestore.js`); the engine already has the absorb-and-fallback scaffolding, so no engine rewrite is needed once the plugin shapes are wired.

### Negative / tradeoffs
- **Native has a wider write-race window.** With no per-record CAS, two devices writing the same record concurrently while one holds a future-schema copy can race — the transactional refuse-writeback gate is gone. F19a still defends via the cloud-side pre-filter and the local-side filter, but the *atomic* gate that the web build has is absent on native (`docs/adr/0004-per-store-merge-strategy.md:55`).
- **Native cross-device latency is up to 5 minutes.** Without listeners, propagation waits for the next poll tick (`STEADY_STATE_DEFAULT_MS = 300000`, `js/sync-engine.js:99`) plus the visibility/network catch-up cycle, vs ~1s on web. Acceptable for a single-user app reconciling phone ↔ desktop, but it is a real regression from the web experience.
- **The deferral is open-ended.** There is no scheduled date — it's tracked only by backlog row #3 (`CLAUDE.md:175`). The "native parity pending" throws are durable load-bearing branches, not temporary scaffolding, and will stay until someone with Xcode + a device closes the loop.
- **Two divergent code paths to reason about.** Every future change to the CAS or listener contract has to consider that native takes the throw-and-fall-back branch — the web and native behaviors are no longer symmetric, which is a standing cognitive cost when debugging sync.

## Alternatives considered

- **Block the sync ship until native parity is done.** Rejected: it gates the entire ~28-PR initiative on its single hardest-to-verify half — the one half the solo author cannot exercise in the web harness (`CLAUDE.md` test-commands). Inverts the risk; delays everything for the riskiest piece.
- **Downgrade *both* platforms to REST/5-min polling for symmetry.** Rejected: it throws away working, testable web real-time propagation and atomic CAS to match the weaker platform. Symmetry is not worth surrendering the web build's strongest guarantees (`js/sync-firestore.js:345-385`, `:447-497`).
- **Drop native sync entirely.** Rejected: iOS is a first-class target (ADR 0007), and the Capacitor shell exists precisely so the native build is a real product surface, not an afterthought. Disabling sync there would make the two builds functionally different apps. The chosen path keeps native sync *working* — degraded, but correct on the append-merge dimension that matters most.
- **Hand-roll a native CAS shim out of `getDoc` + `setDoc`.** Rejected: a read-then-write outside a real transaction has no atomicity — it reintroduces the exact write-after-read race the CAS wrapper exists to close (`js/sync-firestore.js:313-317`). A fake CAS is worse than an honest degraded path, because it would *look* atomic while silently racing.

## References
- `js/sync-firestore.js:13-14` (header marks runTransaction + subscribe web-only), `:151` / `:155` (web SDK pulls in `runTransaction` / `onSnapshot`), `:303-317` (F19a CAS gate contract + write-after-read race note), `:325` (`runTransaction` def), `:331-343` (native parity-pending throw), `:345-385` (web CAS transaction adapter), `:417` (`subscribe` def), `:424-435` (native parity-pending throw), `:447-497` (web onSnapshot wiring)
- `js/sync-engine.js:99` (`STEADY_STATE_DEFAULT_MS = 300000` defensive poll), `:801` (per-record `setDoc` writeback), `:1673-1717` (merge writeback `setDoc` loop), `:2355` (`_subscribeAllStores`), `:2388-2398` (per-store subscribe-failure absorb → `listener-disconnected`), `:2444` (poll arms first), `:2447-2453` (listener wire-up failure must not block the poll — the 5-min poll is the safety net)
- `CLAUDE.md:175` (backlog row #3 — native CAS + listener parity, the forward tracker), `CLAUDE.md:32` (sync-firestore seam description)
- Related ADRs: ADR 0004 (per-store merge strategy — records the downstream consequence of this deferral at `docs/adr/0004-per-store-merge-strategy.md:55`); ADR 0003 (Firestore sync backend); ADR 0007 (iOS as a first-class Capacitor target — the reason native sync is not dropped)
- Related docs: `docs/CLOUD-SYNC-STRATEGY.md` (F19a schema-guard rules); `docs/sync-impl/PLAN.md` (E-1b / E-3 stage rows)
