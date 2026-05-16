// E-1d-f8: SyncMergeDistractions — per-store merge for the consolidated
// flow_distractions + pomodoro_distractions sessionId-keyed maps.
//
// Mirrors E-1d-f3's SyncMergeBfrb self-contained pattern: fetches the
// cloud's `users/{uid}/distractions` collection itself, pre-filters
// future-schema records (F19a per-record pre-filter), unions cloud ∪
// local entries deduped by `(deviceId, timestamp)` within each
// (context, sessionId) pair, writes each merged record back via
// `SyncFirestore.runTransaction` (E-1b's CAS wrapper — enforces F19a
// per-record gate at write time), and returns
// `{ ok, count, skipped, remoteArrivals, warnings }`.
//
// **No F15 emit** for distraction events (matches Pick B precedent from
// E-1d sessions and E-1d-f3 BFRB events — distraction logs are
// high-frequency; toast noise unmanageable). The `remoteArrivals`
// field stays `{}` for return-shape parity.
//
// Entry id derivation: distraction entries don't carry a stable id
// today. We derive a deterministic Firestore document id from
//   entryId = context + '-' + sessionId + '-' + deviceId + '-' + timestamp
// — guarantees cross-device + cross-session uniqueness (engineering-zero
// collision given JS millisecond resolution). The `context` prefix
// collapses Flow + Pomo into one collection without document-id
// collision across contexts.
//
// Public surface (called by `_runMergeCycle` in `js/sync-engine.js`):
//   SyncMergeDistractions.merge(localSnapshot)
//     → Promise<{ ok, count, skipped, remoteArrivals, warnings }>
//
// F13 write gate: the dispatcher in `_runMergeCycle` flips SyncState to
// 'hydrating' before this function runs and restores 'ready' after. We
// do NOT flip the gate here — the dispatcher owns it (E-1c contract).

const SyncMergeDistractions = (() => {

  // Signature for dedup: (context, sessionId, deviceId, timestamp).
  // The context + sessionId prefix isolates per-session merges; the
  // deviceId + timestamp suffix matches the meds / BFRB convention.
  function _sigOf(context, sessionId, entry) {
    if (!entry || typeof entry.timestamp !== 'number') return null;
    const dev = (typeof entry.deviceId === 'string') ? entry.deviceId : '∅';
    return context + '|' + String(sessionId) + '|' + dev + '@' + entry.timestamp;
  }

  // Document id from (context, sessionId, deviceId, timestamp). Collapses
  // Flow + Pomo into one Firestore collection without doc-id collision.
  function _entryIdOf(context, sessionId, entry) {
    if (!entry || typeof entry.timestamp !== 'number') return null;
    const dev = (typeof entry.deviceId === 'string' && entry.deviceId) ? entry.deviceId : 'no-device';
    return context + '-' + String(sessionId) + '-' + dev + '-' + entry.timestamp;
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
    if (typeof Distractions === 'undefined') {
      return { ok: false, kind: 'distractions-unavailable', count: 0, skipped: 0,
               remoteArrivals: {}, warnings: ['Distractions unavailable'] };
    }

    const uid = user.uid;

    // ── Fetch cloud distractions collection ──────────────────────────
    let cloudResult;
    try {
      cloudResult = await SyncFirestore.getCollection('users/' + uid + '/distractions');
    } catch (err) {
      warnings.push('cloud fetch failed: ' + (err && err.message ? err.message : String(err)));
      return { ok: false, kind: 'cloud-fetch-error',
               count: 0, skipped: 0, remoteArrivals: {}, warnings,
               error: err };
    }
    const cloudDocs = (cloudResult && Array.isArray(cloudResult.docs)) ? cloudResult.docs : [];

    // ── F19a per-record pre-filter ───────────────────────────────────
    // Skip future-schema cloud records BEFORE union. Each cloud doc is
    // expected to carry a `context` + `sessionId` field — same shape we
    // write back in step 7. Defensive: malformed cloud entries (missing
    // either field) are skipped + warned.
    const cloudBySig = new Map();
    for (const doc of cloudDocs) {
      if (!doc || !doc.data || typeof doc.data !== 'object') continue;
      const data = doc.data;

      if (typeof Schema !== 'undefined' && typeof Schema.isFutureRecord === 'function'
          && Schema.isFutureRecord(data)) {
        skipped++;
        warnings.push('skipped future-schema cloud record: '
                      + (doc.id || 'unknown')
                      + ' (schemaVersion=' + data.schemaVersion + ')');
        // E-3: F19a observability emit — surface the cloud-side
        // refuse-writeback event so `js/sync-toast.js`'s
        // `downlevelWarning` listener can paint a user-facing message.
        if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.emit === 'function') {
          try {
            SyncEngine.emit('refuse-writeback', {
              store: 'distractions',
              remoteSchemaVersion: data.schemaVersion,
              localSchemaVersion: (typeof Schema !== 'undefined' && typeof Schema.SCHEMA_VERSION === 'number')
                ? Schema.SCHEMA_VERSION : 0,
              remoteDeviceId: (typeof data.deviceId === 'string') ? data.deviceId : undefined,
            });
          } catch (_) { /* listener errors must not break the merge */ }
        }
        continue;
      }

      const ctx = (data.context === 'flow' || data.context === 'pomodoro') ? data.context : null;
      const sid = (data.sessionId !== undefined && data.sessionId !== null) ? String(data.sessionId) : null;
      if (!ctx || sid === null) {
        skipped++;
        warnings.push('skipped malformed cloud entry: ' + (doc.id || 'unknown')
                      + ' (context/sessionId missing)');
        continue;
      }

      const sig = _sigOf(ctx, sid, data);
      if (sig === null) {
        skipped++;
        warnings.push('skipped malformed cloud entry: ' + (doc.id || 'unknown'));
        continue;
      }
      cloudBySig.set(sig, { context: ctx, sessionId: sid, data });
    }

    // ── Read local maps via Distractions.snapshotForSync().payload ───
    let localPayload = null;
    try {
      const snap = Distractions.snapshotForSync();
      localPayload = (snap && snap.payload && typeof snap.payload === 'object') ? snap.payload : null;
    } catch (e) {
      warnings.push('local snapshot read failed: ' + (e && e.message));
      return { ok: false, kind: 'local-read-error', count: 0, skipped,
               remoteArrivals: {}, warnings, error: e };
    }
    if (!localPayload) localPayload = { flow: {}, pomodoro: {} };
    const localFlow = (localPayload.flow && typeof localPayload.flow === 'object') ? localPayload.flow : {};
    const localPomo = (localPayload.pomodoro && typeof localPayload.pomodoro === 'object') ? localPayload.pomodoro : {};

    // ── Per-(context, sessionId) append-merge dedup ──────────────────
    // Build the unified map. Seed with cloud (post-filter) — cloud wins
    // on sig collision (matches the meds metadata-LWW + history record-
    // LWW precedent). For each local entry, skip if sig already present.
    const mergedBySig = new Map();
    for (const [sig, rec] of cloudBySig.entries()) {
      mergedBySig.set(sig, rec);
    }

    // Local entries — iterate flow + pomo maps and inject (context, sessionId)
    // alongside each entry. The sig key carries the context + sessionId,
    // so dedup is automatically per-session.
    function _ingestLocal(context, contextMap) {
      for (const sidKey of Object.keys(contextMap)) {
        const arr = contextMap[sidKey];
        if (!Array.isArray(arr)) continue;
        for (const local of arr) {
          if (!local || typeof local !== 'object') continue;
          const sig = _sigOf(context, sidKey, local);
          if (sig === null) {
            // No usable key — carry through under a random sig so it ends
            // up in mergedBySig but can't be CAS-written (entryId returns
            // null too). Rare; entries pre-F10 missing deviceId could
            // land here.
            mergedBySig.set('local-only-' + Math.random().toString(36).slice(2, 11),
                            { context, sessionId: sidKey, data: local });
            continue;
          }
          if (mergedBySig.has(sig)) continue;
          mergedBySig.set(sig, { context, sessionId: sidKey, data: local });
        }
      }
    }
    _ingestLocal('flow', localFlow);
    _ingestLocal('pomodoro', localPomo);

    // Sort merged entries by timestamp ascending so writeback order is
    // deterministic (helps with debugging + test assertions).
    const mergedRecords = Array.from(mergedBySig.values());
    mergedRecords.sort((a, b) => {
      const aT = (a && a.data && typeof a.data.timestamp === 'number') ? a.data.timestamp : -Infinity;
      const bT = (b && b.data && typeof b.data.timestamp === 'number') ? b.data.timestamp : -Infinity;
      return aT - bT;
    });

    // ── Per-record CAS writeback ─────────────────────────────────────
    // Each record's write is wrapped in `runTransaction`. The callback
    // refuses the write if `remote.schemaVersion > Schema.SCHEMA_VERSION`
    // (F19a CAS layer). Wrap each per-record call in try/catch so one
    // failure doesn't short-circuit subsequent entries.
    let writtenCount = 0;
    for (const { context, sessionId, data: entry } of mergedRecords) {
      const entryId = _entryIdOf(context, sessionId, entry);
      if (entryId === null) {
        skipped++;
        continue;
      }
      // E-3: stash the remote record from inside the transaction so
      // the catch block can include `remoteSchemaVersion` +
      // `remoteDeviceId` on the F19a `'refuse-writeback'` emit.
      let _remoteForEmit = null;
      try {
        // Stamp context + sessionId onto the cloud-bound record so the
        // pre-filter on the next merge cycle can route by context. These
        // fields are NOT on the local in-map entries (they're keyed by
        // session in the map structure itself); we hydrate them onto the
        // cloud document for collection-level merging.
        const toWriteBase = Object.assign({}, entry, {
          context: context,
          sessionId: sessionId,
        });
        await SyncFirestore.runTransaction(async (tx) => {
          const remote = await tx.get('users/' + uid + '/distractions/' + entryId);
          if (remote && remote.data
              && typeof Schema !== 'undefined'
              && typeof Schema.isFutureRecord === 'function'
              && Schema.isFutureRecord(remote.data)) {
            _remoteForEmit = remote.data;
            tx.refuseWriteback(remote.data, Schema.SCHEMA_VERSION);
          }
          const toWrite = (typeof Schema !== 'undefined' && typeof Schema.stamp === 'function')
            ? Schema.stamp(toWriteBase)
            : toWriteBase;
          tx.set('users/' + uid + '/distractions/' + entryId, toWrite);
        });
        writtenCount++;
      } catch (err) {
        if (err && err.kind === 'refuse-writeback') {
          skipped++;
          warnings.push('CAS refused writeback for entry ' + entryId + ': ' + err.message);
          // E-3: F19a observability emit at the per-record CAS layer.
          if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.emit === 'function') {
            try {
              SyncEngine.emit('refuse-writeback', {
                store: 'distractions',
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
        warnings.push('CAS write failed for entry ' + entryId + ': '
                      + (err && err.message ? err.message : String(err)));
        skipped++;
      }
    }

    // ── No F15 emit ──────────────────────────────────────────────────
    // Matches Pick B precedent from E-1d sessions / E-1d-f3 BFRB events.

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
  window.SyncMergeDistractions = SyncMergeDistractions;
}
