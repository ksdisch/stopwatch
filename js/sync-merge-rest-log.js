// E-1e: SyncMergeRestLog — real per-store merge for the daily rest log.
//
// Replaces E-1b's throwing stub. Mirrors `js/sync-merge-bfrb.js`'s
// self-contained pattern: feature-detects collaborators, fetches the
// cloud's `users/{uid}/rest_log` collection itself (one Firestore doc
// per `YYYY-MM-DD` key), pre-filters future-schema records (F19a
// per-record pre-filter), merges per-date-key via:
//   - sleep: LWW by updatedAt — cloud wins on tie (matches E-1c meds
//     metadata-LWW + E-1d sessions LWW precedent). Absent updatedAt
//     is treated as `-Infinity` so the side WITH a stamp always wins
//     (Risk #1 — pre-E-1e sleep entries had no envelope).
//   - naps: append-merge dedup by `(deviceId, startedAt)`. Pre-E-1e
//     naps lacked `deviceId`; the merge falls back to `'no-device'`
//     for those (Risk #2 — single-device convergence is acceptable
//     for the pre-sync window).
// Per-date-key CAS writeback via `SyncFirestore.runTransaction`. F19a
// CAS layer enforces refuse-writeback on future-schema remote records.
// Per-record try/catch — one bad day must NOT short-circuit subsequent
// days (matches E-1c recipe).
//
// **No F15 emit** for rest_log arrivals (matches Pick B precedent from
// E-1d sessions / E-1d-f3 BFRB / E-1d-f8 distractions). The
// `remoteArrivals` field stays `{}` for return-shape parity.
//
// Local writeback: after CAS succeeds, commits the merged map back to
// localStorage via `RecoveryUI._reconcileWriteRaw(mergedMap)` — the
// privileged write path that bypasses `SyncState.canWrite()` for the
// same reason hydrate does (the merge function is the explicit
// exception, same contract as hydrate).
//
// Public surface (called by `_runMergeCycle` in `js/sync-engine.js`):
//   SyncMergeRestLog.merge(localSnapshot)
//     → Promise<{ ok, count, skipped, remoteArrivals, warnings }>
//
// F13 write gate: the dispatcher in `_runMergeCycle` flips SyncState to
// 'hydrating' before this function runs and restores 'ready' after. We
// do NOT flip the gate here — the dispatcher owns it (E-1c contract).

const SyncMergeRestLog = (() => {

  // Signature for nap dedup: (deviceId, startedAt). Pre-E-1e naps
  // without deviceId fall back to `'no-device@startedAt'` so they
  // dedup by startedAt alone — acceptable for the single-device
  // pre-sync window. Returns null for entries missing startedAt
  // (skipped + warned by the caller).
  function _napSigOf(nap) {
    if (!nap || typeof nap.startedAt !== 'number') return null;
    const dev = (typeof nap.deviceId === 'string' && nap.deviceId) ? nap.deviceId : 'no-device';
    return dev + '@' + nap.startedAt;
  }

  // Compare two `updatedAt` values for sleep LWW. Absent values are
  // treated as `-Infinity` so the side WITH a stamp always wins
  // (Risk #1). Cloud wins on tie (matches the E-1c meds metadata-LWW
  // + E-1d sessions LWW precedent).
  function _cloudWinsSleep(cloudSleep, localSleep) {
    const cloudAt = (cloudSleep && typeof cloudSleep.updatedAt === 'number')
      ? cloudSleep.updatedAt : -Infinity;
    const localAt = (localSleep && typeof localSleep.updatedAt === 'number')
      ? localSleep.updatedAt : -Infinity;
    return cloudAt >= localAt;
  }

  async function merge(/* localSnapshot */) {
    const warnings = [];
    let skipped = 0;

    // ── Defensive feature-detect ─────────────────────────────────────
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
    if (typeof RecoveryUI === 'undefined' || typeof RecoveryUI.loadLog !== 'function') {
      return { ok: false, kind: 'recovery-ui-unavailable', count: 0, skipped: 0,
               remoteArrivals: {}, warnings: ['RecoveryUI unavailable'] };
    }
    if (typeof Schema === 'undefined') {
      return { ok: false, kind: 'schema-unavailable', count: 0, skipped: 0,
               remoteArrivals: {}, warnings: ['Schema unavailable'] };
    }

    const uid = user.uid;

    // ── Fetch cloud rest_log collection ──────────────────────────────
    let cloudResult;
    try {
      cloudResult = await SyncFirestore.getCollection('users/' + uid + '/rest_log');
    } catch (err) {
      warnings.push('cloud fetch failed: ' + (err && err.message ? err.message : String(err)));
      return { ok: false, kind: 'cloud-fetch-error',
               count: 0, skipped: 0, remoteArrivals: {}, warnings,
               error: err };
    }
    const cloudDocs = (cloudResult && Array.isArray(cloudResult.docs)) ? cloudResult.docs : [];

    // ── F19a per-record pre-filter ───────────────────────────────────
    // Skip future-schema cloud records BEFORE union. The id IS the
    // date key (e.g., '2026-05-13'). Saves a CAS round-trip and
    // prevents future-schema records from ever entering local-side
    // merge state.
    const cloudByDate = new Map();
    for (const doc of cloudDocs) {
      if (!doc || !doc.data || typeof doc.data !== 'object') continue;
      const data = doc.data;
      const dateKey = (typeof doc.id === 'string' && doc.id) ? doc.id : null;
      if (!dateKey) {
        skipped++;
        warnings.push('skipped cloud entry without date key');
        continue;
      }
      if (typeof Schema.isFutureRecord === 'function' && Schema.isFutureRecord(data)) {
        skipped++;
        warnings.push('skipped future-schema cloud record: ' + dateKey
                      + ' (schemaVersion=' + data.schemaVersion + ')');
        // E-3: F19a observability emit — surface the cloud-side
        // refuse-writeback event so `js/sync-toast.js`'s
        // `downlevelWarning` listener can paint a user-facing message.
        if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.emit === 'function') {
          try {
            SyncEngine.emit('refuse-writeback', {
              store: 'rest_log',
              remoteSchemaVersion: data.schemaVersion,
              localSchemaVersion: (typeof Schema !== 'undefined' && typeof Schema.SCHEMA_VERSION === 'number')
                ? Schema.SCHEMA_VERSION : 0,
              remoteDeviceId: (typeof data.deviceId === 'string') ? data.deviceId : undefined,
            });
          } catch (_) { /* listener errors must not break the merge */ }
        }
        continue;
      }
      cloudByDate.set(dateKey, data);
    }

    // ── Read local rest_log map via RecoveryUI.loadLog() ─────────────
    let localLog;
    try {
      localLog = RecoveryUI.loadLog();
      if (!localLog || typeof localLog !== 'object' || Array.isArray(localLog)) {
        localLog = {};
      }
    } catch (e) {
      warnings.push('local snapshot read failed: ' + (e && e.message));
      return { ok: false, kind: 'local-read-error', count: 0, skipped,
               remoteArrivals: {}, warnings, error: e };
    }

    // ── Per-date-key merge loop ──────────────────────────────────────
    // Iterate union of cloud + local keys. For each YYYY-MM-DD:
    //   - sleep: LWW by updatedAt (cloud wins on tie; absent = -Infinity)
    //   - naps: append-merge dedup by (deviceId, startedAt)
    const mergedMap = {};
    const allKeys = new Set();
    for (const k of cloudByDate.keys()) allKeys.add(k);
    for (const k of Object.keys(localLog)) allKeys.add(k);

    for (const dateKey of allKeys) {
      const cloudDay = cloudByDate.get(dateKey) || null;
      const localDay = (localLog[dateKey] && typeof localLog[dateKey] === 'object'
                        && !Array.isArray(localLog[dateKey])) ? localLog[dateKey] : null;

      // ── Sleep LWW ──
      let mergedSleep = null;
      const cloudSleep = (cloudDay && cloudDay.sleep && typeof cloudDay.sleep === 'object')
        ? cloudDay.sleep : null;
      const localSleep = (localDay && localDay.sleep && typeof localDay.sleep === 'object')
        ? localDay.sleep : null;
      if (cloudSleep && localSleep) {
        mergedSleep = _cloudWinsSleep(cloudSleep, localSleep) ? cloudSleep : localSleep;
      } else if (cloudSleep) {
        mergedSleep = cloudSleep;
      } else if (localSleep) {
        mergedSleep = localSleep;
      }

      // ── Naps append-merge dedup ──
      const napsBySig = new Map();
      const cloudNaps = (cloudDay && Array.isArray(cloudDay.naps)) ? cloudDay.naps : [];
      const localNaps = (localDay && Array.isArray(localDay.naps)) ? localDay.naps : [];
      // Seed with cloud naps (post-filter; cloud wins on sig collision).
      for (const nap of cloudNaps) {
        if (!nap || typeof nap !== 'object') continue;
        const sig = _napSigOf(nap);
        if (sig === null) {
          // Malformed nap (no startedAt) — drop with skip count.
          skipped++;
          continue;
        }
        napsBySig.set(sig, nap);
      }
      // Walk local naps; skip if sig collides (cloud wins).
      for (const nap of localNaps) {
        if (!nap || typeof nap !== 'object') continue;
        const sig = _napSigOf(nap);
        if (sig === null) {
          skipped++;
          continue;
        }
        if (napsBySig.has(sig)) continue;
        napsBySig.set(sig, nap);
      }
      // Sort by startedAt ascending for deterministic writeback.
      const mergedNaps = Array.from(napsBySig.values());
      mergedNaps.sort((a, b) => {
        const aT = (a && typeof a.startedAt === 'number') ? a.startedAt : -Infinity;
        const bT = (b && typeof b.startedAt === 'number') ? b.startedAt : -Infinity;
        return aT - bT;
      });

      // Build the merged day entry. Use null for absent sleep so the
      // shape matches `RecoveryUI.getDayEntry` defaults; empty naps
      // array if neither side had any.
      mergedMap[dateKey] = { sleep: mergedSleep, naps: mergedNaps };
    }

    // ── Per-record CAS writeback ─────────────────────────────────────
    // Each date key's write is wrapped in `runTransaction`. The
    // callback refuses the write if `remote.schemaVersion >
    // Schema.SCHEMA_VERSION` (F19a CAS layer). Per-record try/catch
    // so one bad day doesn't short-circuit subsequent days.
    let writtenCount = 0;
    for (const dateKey of Object.keys(mergedMap)) {
      const mergedDay = mergedMap[dateKey];
      // E-3: stash the remote record from inside the transaction so
      // the catch block can include `remoteSchemaVersion` +
      // `remoteDeviceId` on the F19a `'refuse-writeback'` emit.
      let _remoteForEmit = null;
      try {
        await SyncFirestore.runTransaction(async (tx) => {
          const remote = await tx.get('users/' + uid + '/rest_log/' + dateKey);
          if (remote && remote.data
              && typeof Schema.isFutureRecord === 'function'
              && Schema.isFutureRecord(remote.data)) {
            _remoteForEmit = remote.data;
            tx.refuseWriteback(remote.data, Schema.SCHEMA_VERSION);
          }
          // Stamp the merged day entry. Schema.stamp only sets
          // schemaVersion; the inner sleep/naps already carry their
          // own (deviceId, updatedAt, schemaVersion) stamps from the
          // RecoveryUI.setSleep / addNap call sites. The outer
          // envelope's schemaVersion is what F19a CAS gates on.
          const toWrite = (typeof Schema.stamp === 'function')
            ? Schema.stamp(Object.assign({}, mergedDay))
            : Object.assign({}, mergedDay);
          tx.set('users/' + uid + '/rest_log/' + dateKey, toWrite);
        });
        writtenCount++;
      } catch (err) {
        if (err && err.kind === 'refuse-writeback') {
          skipped++;
          warnings.push('CAS refused writeback for date ' + dateKey + ': ' + err.message);
          // E-3: F19a observability emit at the per-record CAS layer.
          if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.emit === 'function') {
            try {
              SyncEngine.emit('refuse-writeback', {
                store: 'rest_log',
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
        warnings.push('CAS write failed for date ' + dateKey + ': '
                      + (err && err.message ? err.message : String(err)));
        skipped++;
      }
    }

    // ── Write merged map back to local ───────────────────────────────
    // The reconcile write path bypasses the F13 gate for the same
    // reason hydrate does — the merge function is the explicit
    // exception during the dispatcher's 'hydrating' window.
    if (typeof RecoveryUI._reconcileWriteRaw === 'function') {
      try {
        RecoveryUI._reconcileWriteRaw(mergedMap);
      } catch (e) {
        warnings.push('local reconcile writeback failed: '
                      + (e && e.message ? e.message : String(e)));
      }
    }

    // ── No F15 emit ──────────────────────────────────────────────────
    // rest_log arrivals are silent (matches Pick B precedent from
    // E-1d sessions / E-1d-f3 BFRB / E-1d-f8 distractions). The only
    // F15 surface remains `meds-arrival` from E-1c.

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
  window.SyncMergeRestLog = SyncMergeRestLog;
}
