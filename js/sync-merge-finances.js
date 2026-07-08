// Life-OS Phase 5: SyncMergeFinances — per-store merge for the finances
// stream (the 8th synced store, editable per-month LWW).
//
// Clones `js/sync-merge-rest-log.js`'s per-KEY pattern (NOT mood's
// append-only dedup): fetches the cloud's `users/{uid}/finances`
// collection itself (one Firestore doc per `YYYY-MM` month key),
// pre-filters future-schema records (F19a per-record pre-filter), merges
// per-month-key via **whole-record LWW** — the latest `updatedAt` for a
// given month wins (cloud wins on tie; absent updatedAt is `-Infinity`
// so the side WITH a stamp always wins). This differs from rest_log,
// whose per-date record has sleep/naps sub-structure merged separately;
// a finances month record is a flat metric bag, so the whole record is
// the LWW unit (fork #1 — "the latest updatedAt for that month wins").
//
// Per-month-key CAS writeback via `SyncFirestore.runTransaction`. The
// F19a CAS layer enforces refuse-writeback on future-schema remote
// records. Per-record try/catch — one bad month must NOT short-circuit
// subsequent months (matches the E-1c/E-1e recipe).
//
// **No F15 emit** for finances arrivals (matches rest_log / mood — only
// meds-arrival surfaces a toast). The `remoteArrivals` field stays `{}`
// for return-shape parity.
//
// Local writeback: after CAS, commits the merged map back to localStorage
// via `Finances._reconcileWriteRaw(mergedMap)` — the privileged write
// path that bypasses `SyncState.canWrite()` for the same reason hydrate
// does (the merge function is the explicit exception during the
// dispatcher's 'hydrating' window).
//
// Public surface (called by `_runMergeCycle` in `js/sync-engine.js`):
//   SyncMergeFinances.merge(localSnapshot)
//     → Promise<{ ok, count, skipped, remoteArrivals, warnings }>
//
// F13 write gate: the dispatcher in `_runMergeCycle` flips SyncState to
// 'hydrating' before this function runs and restores 'ready' after. We
// do NOT flip the gate here — the dispatcher owns it (E-1c contract).

const SyncMergeFinances = (() => {

  // Compare two `updatedAt` values for per-month whole-record LWW. Absent
  // values are treated as `-Infinity` so the side WITH a stamp always wins.
  // Cloud wins on tie (matches the rest_log sleep-LWW + meds/sessions LWW
  // precedent).
  function _cloudWins(cloudRec, localRec) {
    const cloudAt = (cloudRec && typeof cloudRec.updatedAt === 'number')
      ? cloudRec.updatedAt : -Infinity;
    const localAt = (localRec && typeof localRec.updatedAt === 'number')
      ? localRec.updatedAt : -Infinity;
    return cloudAt >= localAt;
  }

  async function merge(/* localSnapshot */) {
    const warnings = [];
    let skipped = 0;

    // ── Defensive feature-detect ─────────────────────────────────────
    // Each typeof check matches the dispatcher's tolerance contract — a
    // missing collaborator returns a structured `{ ok: false }` instead
    // of throwing, so the per-store try/catch in `_runMergeCycle` doesn't
    // have to distinguish "missing module" from "merge logic error".
    if (typeof SyncFlag === 'undefined' || !SyncFlag.isEnabled()) {
      return { ok: false, kind: 'sync-not-enabled', count: 0, skipped: 0,
               remoteArrivals: {}, warnings: ['SyncFlag disabled'] };
    }
    if (typeof SyncAuth === 'undefined' || typeof SyncAuth.getCurrentUser !== 'function') {
      return { ok: false, kind: 'unauthenticated', count: 0, skipped: 0,
               remoteArrivals: {}, warnings: ['SyncAuth unavailable'] };
    }
    const user = SyncAuth.getCurrentUser();
    if (!user || !user.uid) {
      return { ok: false, kind: 'unauthenticated', count: 0, skipped: 0,
               remoteArrivals: {}, warnings: ['no signed-in user'] };
    }
    if (typeof SyncFirestore === 'undefined') {
      return { ok: false, kind: 'firestore-unavailable', count: 0, skipped: 0,
               remoteArrivals: {}, warnings: ['SyncFirestore unavailable'] };
    }
    if (typeof Finances === 'undefined' || typeof Finances.getAll !== 'function') {
      return { ok: false, kind: 'finances-unavailable', count: 0, skipped: 0,
               remoteArrivals: {}, warnings: ['Finances unavailable'] };
    }
    if (typeof Schema === 'undefined') {
      return { ok: false, kind: 'schema-unavailable', count: 0, skipped: 0,
               remoteArrivals: {}, warnings: ['Schema unavailable'] };
    }

    const uid = user.uid;

    // ── Fetch cloud finances collection ──────────────────────────────
    let cloudResult;
    try {
      cloudResult = await SyncFirestore.getCollection('users/' + uid + '/finances');
    } catch (err) {
      warnings.push('cloud fetch failed: ' + (err && err.message ? err.message : String(err)));
      return { ok: false, kind: 'cloud-fetch-error',
               count: 0, skipped: 0, remoteArrivals: {}, warnings,
               error: err };
    }
    const cloudDocs = (cloudResult && Array.isArray(cloudResult.docs)) ? cloudResult.docs : [];

    // ── F19a per-record pre-filter ───────────────────────────────────
    // Skip future-schema cloud records BEFORE union. The id IS the month
    // key (e.g., '2026-07'). Saves a CAS round-trip and prevents
    // future-schema records from ever entering local-side merge state.
    // Risk: the predicate MUST use `Schema.isFutureRecord(data)` — NOT a
    // hand-rolled comparison.
    const cloudByMonth = new Map();
    for (const doc of cloudDocs) {
      if (!doc || !doc.data || typeof doc.data !== 'object') continue;
      const data = doc.data;
      const monthKey = (typeof doc.id === 'string' && doc.id) ? doc.id : null;
      if (!monthKey) {
        skipped++;
        warnings.push('skipped cloud entry without month key');
        continue;
      }
      if (typeof Schema.isFutureRecord === 'function' && Schema.isFutureRecord(data)) {
        skipped++;
        warnings.push('skipped future-schema cloud record: ' + monthKey
                      + ' (schemaVersion=' + data.schemaVersion + ')');
        // F19a observability emit — surface the cloud-side
        // refuse-writeback event so `js/sync-toast.js`'s
        // `downlevelWarning` listener can paint a user-facing message.
        if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.emit === 'function') {
          try {
            SyncEngine.emit('refuse-writeback', {
              store: 'finances',
              remoteSchemaVersion: data.schemaVersion,
              localSchemaVersion: (typeof Schema !== 'undefined' && typeof Schema.SCHEMA_VERSION === 'number')
                ? Schema.SCHEMA_VERSION : 0,
              remoteDeviceId: (typeof data.deviceId === 'string') ? data.deviceId : undefined,
            });
          } catch (_) { /* listener errors must not break the merge */ }
        }
        continue;
      }
      cloudByMonth.set(monthKey, data);
    }

    // ── Read local finances map via Finances.getAll() ────────────────
    // We read fresh per call (matches the E-1c/E-1e self-contained
    // contract).
    let localMap;
    try {
      localMap = Finances.getAll();
      if (!localMap || typeof localMap !== 'object' || Array.isArray(localMap)) {
        localMap = {};
      }
    } catch (e) {
      warnings.push('local snapshot read failed: ' + (e && e.message));
      return { ok: false, kind: 'local-read-error', count: 0, skipped,
               remoteArrivals: {}, warnings, error: e };
    }

    // ── Per-month-key whole-record LWW ───────────────────────────────
    // Iterate the union of cloud + local month keys. For each 'YYYY-MM'
    // the record with the newer `updatedAt` wins (cloud wins on tie;
    // absent updatedAt = -Infinity so a stamped side always wins).
    const mergedMap = {};
    const allKeys = new Set();
    for (const k of cloudByMonth.keys()) allKeys.add(k);
    for (const k of Object.keys(localMap)) allKeys.add(k);

    for (const monthKey of allKeys) {
      const cloudRec = cloudByMonth.get(monthKey) || null;
      const localRec = (localMap[monthKey] && typeof localMap[monthKey] === 'object'
                        && !Array.isArray(localMap[monthKey])) ? localMap[monthKey] : null;
      let winner = null;
      if (cloudRec && localRec) {
        winner = _cloudWins(cloudRec, localRec) ? cloudRec : localRec;
      } else if (cloudRec) {
        winner = cloudRec;
      } else if (localRec) {
        winner = localRec;
      }
      if (winner) mergedMap[monthKey] = winner;
    }

    // ── Per-record CAS writeback ─────────────────────────────────────
    // Each month key's write is wrapped in `runTransaction`. The callback
    // refuses the write if `remote.schemaVersion > Schema.SCHEMA_VERSION`
    // (F19a CAS layer). Per-record try/catch so one bad month doesn't
    // short-circuit subsequent months.
    let writtenCount = 0;
    for (const monthKey of Object.keys(mergedMap)) {
      const mergedRec = mergedMap[monthKey];
      // Stash the remote record from inside the transaction so the catch
      // block can include `remoteSchemaVersion` + `remoteDeviceId` on the
      // F19a `'refuse-writeback'` emit.
      let _remoteForEmit = null;
      try {
        await SyncFirestore.runTransaction(async (tx) => {
          const remote = await tx.get('users/' + uid + '/finances/' + monthKey);
          if (remote && remote.data
              && typeof Schema.isFutureRecord === 'function'
              && Schema.isFutureRecord(remote.data)) {
            _remoteForEmit = remote.data;
            tx.refuseWriteback(remote.data, Schema.SCHEMA_VERSION);
          }
          // Stamp schemaVersion via Schema.stamp on a copy. The merged
          // record already carries its own (deviceId, updatedAt,
          // schemaVersion) from the setMonth() call site; Schema.stamp
          // ensures schemaVersion lands on records that may have arrived
          // without one. We do NOT bump updatedAt here — the local stamp
          // at setMonth() time is the source of truth for LWW.
          const toWrite = (typeof Schema.stamp === 'function')
            ? Schema.stamp(Object.assign({}, mergedRec))
            : Object.assign({}, mergedRec);
          // M2/M5 (AUDIT-2026-06-13 precedent): skip the redundant cloud
          // write when the stamped record already equals the cloud doc
          // just read. A tx.set fires onSnapshot on every device →
          // re-merge → re-write, so re-writing an unchanged month feeds
          // the steady-state loop. recordsEqual strips the stamp envelope
          // (updatedAt/deviceId/schemaVersion) and deep-compares the
          // metric fields, so a corrected month still writes. Drops ONLY
          // the redundant cloud write; the local _reconcileWriteRaw apply
          // below is unaffected.
          if (remote && remote.data
              && typeof SyncMergeEqual !== 'undefined'
              && typeof SyncMergeEqual.recordsEqual === 'function'
              && SyncMergeEqual.recordsEqual(toWrite, remote.data)) {
            return;
          }
          tx.set('users/' + uid + '/finances/' + monthKey, toWrite);
        });
        writtenCount++;
      } catch (err) {
        // refuse-writeback is the F19a CAS-level gate firing. Count as
        // skipped (not error) — the on-disk future-schema record stays
        // intact (the entire point of the gate).
        if (err && err.kind === 'refuse-writeback') {
          skipped++;
          warnings.push('CAS refused writeback for month ' + monthKey + ': ' + err.message);
          // F19a observability emit at the per-record CAS layer.
          if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.emit === 'function') {
            try {
              SyncEngine.emit('refuse-writeback', {
                store: 'finances',
                remoteSchemaVersion: (_remoteForEmit && typeof _remoteForEmit.schemaVersion === 'number')
                  ? _remoteForEmit.schemaVersion : 0,
                localSchemaVersion: (typeof Schema !== 'undefined' && typeof Schema.SCHEMA_VERSION === 'number')
                  ? Schema.SCHEMA_VERSION : 0,
                remoteDeviceId: (_remoteForEmit && typeof _remoteForEmit.deviceId === 'string')
                  ? _remoteForEmit.deviceId : undefined,
              });
            } catch (_) { /* listener errors must not break the merge */ }
          }
          continue;
        }
        // M9 (AUDIT-2026-06-13 precedent): the native (iOS) runTransaction
        // parity gap (backlog #3) throws here for EVERY record. Surface it
        // ONCE per store via the event bus instead of silently swallowing
        // it, then fall through to the same skipped++ accounting as any
        // other CAS error.
        if (err && err.nativeUnsupported) {
          if (typeof SyncEngine !== 'undefined'
              && typeof SyncEngine.emitNativeWritebackUnsupportedOnce === 'function') {
            try { SyncEngine.emitNativeWritebackUnsupportedOnce('finances'); } catch (_) {}
          }
          warnings.push('CAS native-unsupported for month ' + monthKey + ': '
                        + (err && err.message ? err.message : String(err)));
          skipped++;
          continue;
        }
        warnings.push('CAS write failed for month ' + monthKey + ': '
                      + (err && err.message ? err.message : String(err)));
        skipped++;
      }
    }

    // ── Write merged map back to local ───────────────────────────────
    // The reconcile write path bypasses the F13 gate for the same reason
    // hydrate does — the merge function is the explicit exception during
    // the dispatcher's 'hydrating' window. Converges LOCAL (the CAS loop
    // above converged the CLOUD): without it, a month corrected on
    // another device never lands in the local finances map (a reload
    // won't fix it — hydrate short-circuits on the persisted marker).
    // Non-fatal: failure is a warning, not a thrown merge.
    if (typeof Finances._reconcileWriteRaw === 'function') {
      try {
        Finances._reconcileWriteRaw(mergedMap);
      } catch (e) {
        warnings.push('local reconcile writeback failed: '
                      + (e && e.message ? e.message : String(e)));
      }
    }

    // ── No F15 emit ──────────────────────────────────────────────────
    // finances arrivals are silent (matches rest_log / mood). The only
    // F15 surface remains `meds-arrival`.

    return {
      ok: true,
      count: writtenCount,
      skipped: skipped,
      remoteArrivals: {},
      warnings: warnings,
    };
  }

  return { merge };
})();

if (typeof window !== 'undefined') {
  window.SyncMergeFinances = SyncMergeFinances;
}
