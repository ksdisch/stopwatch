# ADR 0004: Per-store, per-record conflict resolution instead of global last-write-wins

- **Status:** Accepted (retro-documented 2026-05-30)
- **Date:** 2026-05-13 → 2026-05-14 (implemented across E-1c/E-1d/E-1e; the rule itself was ratified earlier in `docs/CLOUD-SYNC-STRATEGY.md` v2.0)
- **Deciders:** ksdisch
- **Tags:** sync, conflict-resolution, data-integrity, schema-evolution

## Context

Tempo is a local-first PWA: every engine (meds, history, rest log, presets, BFRB events, distractions) writes to `localStorage` / IndexedDB and is correct from local state alone. Cloud sync (Firebase/Firestore) layers a multi-device merge on top of that without a backend of its own to arbitrate — the merge logic runs client-side in the WebView, the same code on web and Capacitor iOS. With a single real user across phone + desktop, the failure mode that matters is not frequent concurrent edits; it is the *silent loss of append-only health data* when two devices each logged events offline and then reconcile.

The naive policy is "LWW everywhere": stamp every record with `updatedAt`, and on collision the higher timestamp wins the whole record. That is wrong for the load-bearing data. A medication's `doseLog` is an append-only event stream — if Device A logs a dose at 8am and Device B (which never saw A's write) logs one at 8pm, LWW on the whole med record keeps one device's `doseLog` and discards the other's. The slower device's doses vanish. The strategy doc calls this out directly: the `doseLog` rule is "Append-merge, dedup by `(deviceId, takenAt)`, plus ±N-minute per-med reconcile (F1)" and is explicitly *not* LWW (`docs/CLOUD-SYNC-STRATEGY.md:31`). Event streams (BFRB catches, naps, distraction logs) have the same shape. Conversely, presets/templates genuinely want whole-record LWW with delete tombstones (`docs/CLOUD-SYNC-STRATEGY.md:38`), and editable strings like a session's `note`/`tags` want per-field LWW so a tag edit on one device doesn't clobber a note edit on another (`docs/CLOUD-SYNC-STRATEGY.md:33`).

A second constraint is forward-compatibility across mixed-version clients. With GitHub Pages auto-deploy and a separate Capacitor iOS release cadence, the two devices a single user owns can run different schema versions simultaneously. A downlevel client that blindly writes back a record minted by a newer client would strip every field it doesn't recognize. The chosen guard is `schemaVersion` stamping plus a refuse-writeback rule (F19a, `docs/CLOUD-SYNC-STRATEGY.md:57`), implemented in `js/schema.js`: `SCHEMA_VERSION = 1` (`js/schema.js:30`), `isFutureRecord(record)` returns true only for a finite numeric `schemaVersion` strictly greater than the local version (`js/schema.js:38-42`), and `stamp(record)` refuses to downgrade a future record (`js/schema.js:52-57`).

The forces, then: correctness for append-only health/event data forbids global LWW; the cost of a "review every conflict" inbox is not justified for solo use, so editable fields get silent LWW (`docs/CLOUD-SYNC-STRATEGY.md:67`); and every store must defend against future-schema records over the wire. No single policy satisfies all three.

## Decision

Conflict resolution is defined **per store, per record**, named explicitly in the strategy table (`docs/CLOUD-SYNC-STRATEGY.md:25-38`) and implemented as six hand-written, self-contained merge modules — one per entry in the `SYNCED_STORES` registry. The registry is the hardcoded source of truth (`js/sync-engine.js:138-145`):

```js
const SYNCED_STORES = [
  { key: 'meds',         adapter: { read: () => MedsManager.snapshotForSync(),  write: writeStub } },
  { key: 'history',      adapter: { read: () => History.snapshotForSync(),      write: writeStub } },
  { key: 'rest_log',     adapter: { read: () => RecoveryUI.snapshotForSync(),   write: writeStub } },
  { key: 'presets',      adapter: { read: () => Presets.snapshotForSync(),      write: writeStub } },
  { key: 'bfrb_events',  adapter: { read: () => BfrbEvents.snapshotForSync(),   write: writeStub } },
  { key: 'distractions', adapter: { read: () => Distractions.snapshotForSync(), write: writeStub } },
];
```

The steady-state dispatcher `_runMergeCycle()` iterates the registry and dispatches each store to its own merge module via a `typeof`-guarded lookup table (`js/sync-engine.js:2053-2060`, called at `js/sync-engine.js:2134`); a per-store `try/catch` means one bad merge cannot abort the cycle (`js/sync-engine.js:2154-2160`). Each module ships a *distinct* strategy:

- **`meds` (`SyncMergeMeds`)** — metadata envelope (`name`/`dose`/`frequency`) is LWW by `updatedAt`, cloud wins on tie (`js/sync-merge-meds.js:217-227`), but `doseLog` is **append-merged regardless of the LWW winner**: every merged med routes through `MedsManager.reconcileDoseLog(med, incoming)` which dedups by `(deviceId, takenAt)` and applies the F1 ±15-min reconcile + F16 clock-skew clamp (`js/sync-merge-meds.js:271-274`). `MedsManager.onMergeComplete(med.id)` then re-derives `lastTakenAt` (F4) — ordering is load-bearing: the recompute reads `med.doseLog`, so the reassignment must precede it (`js/sync-merge-meds.js:273-284`). This is the only store that emits `meds-arrival` (F15), and only when ≥2 new remote dose entries arrive (`js/sync-merge-meds.js:397-405`).
- **`history` (`SyncMergeHistory`)** — union by session `id` (F2), with **record-level** LWW by `updatedAt`, cloud wins on tie (`js/sync-merge-history.js:267-302`). The deferred per-field note/tags LWW is documented honestly as a known loss (`js/sync-merge-history.js:49-52`). Nested `phaseLog` is its own append-only stream, deduped by `(deviceId, phaseStartedAt)` per F6 *independent of the envelope winner* (`js/sync-merge-history.js:60-107`, `269-299`).
- **`rest_log` (`SyncMergeRestLog`)** — per-date-key: `sleep` is LWW by `updatedAt` (absent = `-Infinity`, cloud wins on tie — `js/sync-merge-rest-log.js:56-62`), `naps` are append-merged deduped by `(deviceId, startedAt)` (`js/sync-merge-rest-log.js:46-50`, `189-220`).
- **`presets` (`SyncMergePresets`)** — full-record LWW by `updatedAt` plus `deletedAt` tombstone propagation, with the `== null` predicate that catches `undefined`/`null` but not `0` (`js/sync-merge-presets.js:166-192`). Reads the tombstone-inclusive view so deletes can propagate to cloud (`js/sync-merge-presets.js:129-142`).
- **`bfrb_events` (`SyncMergeBfrb`)** and **`distractions` (`SyncMergeDistractions`)** — pure union-dedup event streams, keyed by `(deviceId, takenAt)` and `(context, sessionId, deviceId, timestamp)` respectively, deterministic doc ids derived from the signature (`js/sync-merge-bfrb.js:35-48`, `js/sync-merge-distractions.js:39-51`). No LWW concept at all — they are append-only.

Two invariants are required of **every** store regardless of its merge shape. First, `deviceId` + `updatedAt` + `schemaVersion` stamping at write time, funneled through `Schema.stamp` (`js/schema.js:52-57`). Second, the **F19a future-record guard at two layers**: a cloud-side pre-filter inside each merge fn that skips remote records where `Schema.isFutureRecord(data)` is true *before* they enter merge state (e.g. `js/sync-merge-meds.js:132-153`), and a per-record CAS layer where the Firestore transaction reads the current remote doc and calls `tx.refuseWriteback(remote.data, Schema.SCHEMA_VERSION)` if it is future-schema (`js/sync-merge-meds.js:334-341`, backed by `js/sync-firestore.js:365`). The dispatcher adds a third, local-side filter for records that leaked into local storage out-of-band, e.g. via JSON import (`js/sync-engine.js:313-425`).

## Consequences

### Positive
- **Health data is never silently lost on the slower device.** `doseLog` append-merge plus the F1 reconcile means cross-device doses union rather than overwrite (`js/sync-merge-meds.js:271-274`); the same shape protects naps, BFRB catches, and distraction logs.
- **Each rule is legible and independently testable.** A store's policy lives in one file with the strategy named in its header comment; the dispatcher's per-store `try/catch` isolation (`js/sync-engine.js:2154-2160`) means a regression in one merge can't corrupt the cycle for the others.
- **Mixed-version devices are safe.** The F19a refuse-writeback guard preserves future-schema records byte-clean on disk for the newer client to consume (`js/schema.js:9-15`), enforced at cloud-read, local, and CAS layers so a single bug at one site doesn't open the corruption vector.
- **Convergence is deterministic.** "Cloud wins on tie" is uniform across every LWW store (meds metadata, history records, rest_log sleep, presets), which matches the push-then-hydrate convergence direction and prevents LWW thrash; `updatedAt` is deliberately *not* bumped on writeback (`js/sync-merge-history.js:334-338`, `js/sync-merge-presets.js:220-227`).

### Negative / tradeoffs
- **Six hand-written merge functions to maintain, plus the dispatcher.** Every new synced store adds a `SYNCED_STORES` entry *and* a bespoke merge module *and* the F19a guard at three layers. There is no shared merge engine — the modules share a copy-pasted skeleton (defensive feature-detect block, cloud fetch, pre-filter, union, CAS writeback) rather than a common base, so a fix to that skeleton must be applied six times.
- **History note/tags LWW is record-level, not per-field — a known, accepted data-loss window.** If Device A edits a tag at T=100 and Device B edits a note at T=110, B's note edit wins the *whole* record and A's tag edit is lost (`js/sync-merge-history.js:49-52`, `263-266`). The strategy table calls for per-field LWW here (`docs/CLOUD-SYNC-STRATEGY.md:33`); it ships as a deferred follow-up.
- **The F19a guard is mandatory boilerplate everywhere.** Every merge module carries the cloud-side pre-filter, the CAS `refuseWriteback` call, and the observability emit — and `Schema.isFutureRecord` must be used verbatim, not a hand-rolled comparison (flagged as a risk in the merge headers). Forgetting it in a future store reopens the downlevel-corruption hole silently.
- **CAS is web-only.** `runTransaction` (and the listener `subscribe`) throw "native parity pending" on Capacitor iOS (`js/sync-firestore.js:339`, `:431`), so the per-record CAS refuse-writeback gate degrades to the 5-min defensive poll + plain `setDoc` on native (open backlog item #3). The append-merge correctness still holds; the atomicity guarantee does not.
- **`rest_log` and `presets` are absent from the hydrate/Stage-D ordering's marker set in some paths**, and the rest_log `sleep` LWW relies on `updatedAt` stamps that pre-E-1e entries lacked (`js/sync-merge-rest-log.js:9-15`), so single-device convergence is the documented fallback for that pre-sync window.

## Alternatives considered
- **Global last-write-wins on `updatedAt`.** Rejected: silently destroys `doseLog` entries on the slower device and every other append-only stream. The whole reason the strategy table enumerates per-store rules is that this one policy is wrong for the load-bearing data (`docs/CLOUD-SYNC-STRATEGY.md:31`).
- **CRDTs (e.g. OR-Sets / LWW-registers per field).** Rejected for this codebase: a no-build vanilla-JS PWA with one real user does not justify the bundle weight, the per-field metadata overhead, or the conceptual cost. Append-merge-with-dedup-by-`(deviceId, ts)` is a CRDT-flavored grow-only set for exactly the streams that need it, hand-rolled without a library.
- **Server-side merge.** Rejected: Tempo has no backend. Firestore is used as a dumb per-record document store; all merge logic is client-side by design (the same reason the Todoist integration uses a personal token rather than OAuth — no server to hold a secret). A merge tier would mean standing up and operating a service for a single-user app.
- **A "review conflicts" inbox surfacing every LWW race.** Rejected per the v2.0 UX rule: "Silent LWW is the default... the cost of surfacing every race exceeds the cost of the rare wrong winner" (`docs/CLOUD-SYNC-STRATEGY.md:67`). The one carve-out is health data — F15 toasts on ≥2-entry `doseLog` arrivals (`docs/CLOUD-SYNC-STRATEGY.md:68`, `js/sync-merge-meds.js:397-405`).

## References
- `js/schema.js:30` (`SCHEMA_VERSION`), `:38-42` (`isFutureRecord`), `:52-57` (`stamp`)
- `js/sync-engine.js:138-145` (`SYNCED_STORES` six-store registry), `:2053-2060` (per-store module dispatch table), `:2134` (merge call), `:2154-2160` (per-store isolation), `:313-425` (`_filterFutureRecordsInSnapshot` local-side F19a gate)
- `js/sync-merge-meds.js:132-153` (cloud-side F19a pre-filter), `:217-227` (metadata LWW), `:271-284` (doseLog append-merge + F4), `:334-341` (CAS refuse-writeback), `:397-405` (F15 meds-arrival)
- `js/sync-merge-history.js:49-52` (record-level LWW caveat), `:60-107` (phaseLog F6 dedup), `:267-302` (union + LWW)
- `js/sync-merge-rest-log.js:46-62` (nap dedup + sleep LWW), `:189-220` (per-date merge)
- `js/sync-merge-presets.js:129-142` (tombstone-inclusive read), `:166-192` (LWW + `deletedAt` tombstone propagation)
- `js/sync-merge-bfrb.js:35-48` (`(deviceId, takenAt)` dedup + doc id), `js/sync-merge-distractions.js:39-51` (`(context, sessionId, deviceId, timestamp)` dedup)
- `js/sync-firestore.js:325` / `:365` (`runTransaction` + `refuseWriteback` CAS seam), `:339` / `:431` (native parity-pending throws)
- `docs/CLOUD-SYNC-STRATEGY.md:25-38` (per-store merge table), `:57-59` (F19a/F19b/F20 schema rules), `:67-68` (silent-LWW default + F15 health-data toast), `:103` (F1 reconcile applies in steady-state)
- Related: backlog item #3 — "native CAS + listener parity for `@capacitor-firebase/firestore`" (the unshipped piece this ADR's CAS layer depends on)
