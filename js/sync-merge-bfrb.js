// E-1d-f3: SyncMergeBfrb — per-store merge for the consolidated bfrb_events
// stream.
//
// Mirrors E-1c's SyncMergeMeds / E-1d's SyncMergeHistory self-contained
// pattern: fetches the cloud's `users/{uid}/bfrb_events` collection itself,
// pre-filters future-schema records (F19a per-record pre-filter), unions
// cloud ∪ local events deduped by `(deviceId, takenAt)` (Pick A on TODO #4),
// writes each merged record back via `SyncFirestore.runTransaction`
// (E-1b's CAS wrapper — enforces F19a per-record gate at write time),
// and returns `{ ok, count, skipped, remoteArrivals, warnings }`.
//
// **No F15 emit** for BFRB events (matches Pick B precedent from E-1d
// sessions; BFRB catches are high-frequency by nature). The
// `remoteArrivals` field stays `{}` for return-shape parity.
//
// Entry id derivation: BFRB entries don't carry a stable id (legacy
// shape is `{ timestamp, phase? }`). We derive a deterministic Firestore
// document id from the dedup signature: `entryId = deviceId + '-' + takenAt`.
// Guarantees cross-device uniqueness AND a stable document path; collision
// (same device + same millisecond) is engineering-zero.
//
// Public surface (called by `_runMergeCycle` in `js/sync-engine.js`):
//   SyncMergeBfrb.merge(localSnapshot)
//     → Promise<{ ok, count, skipped, remoteArrivals, warnings }>
//
// F13 write gate: the dispatcher in `_runMergeCycle` flips SyncState to
// 'hydrating' before this function runs and restores 'ready' after. We
// do NOT flip the gate here — the dispatcher owns it (E-1c contract).

const SyncMergeBfrb = (() => {

  // Signature for dedup: (deviceId, takenAt). Identical to the meds
  // doseLog convention in `_sigOf` (js/sync-merge-meds.js:43) and the
  // BfrbEvents module's internal signature.
  function _sigOf(entry) {
    if (!entry || typeof entry.takenAt !== 'number') return null;
    const dev = (typeof entry.deviceId === 'string') ? entry.deviceId : '∅';
    return dev + '@' + entry.takenAt;
  }

  // Document id from signature. Replaces '∅' with a literal so the
  // resulting id is filesystem/Firestore-safe (Firestore doc ids can't
  // contain certain chars but ASCII text is fine).
  function _entryIdOf(entry) {
    if (!entry || typeof entry.takenAt !== 'number') return null;
    const dev = (typeof entry.deviceId === 'string' && entry.deviceId) ? entry.deviceId : 'no-device';
    return dev + '-' + entry.takenAt;
  }

  async function merge(/* localSnapshot */) {
    const warnings = [];
    let skipped = 0;

    // ── Defensive feature-detect ─────────────────────────────────────
    // Each typeof check matches the dispatcher's tolerance contract —
    // a missing collaborator returns a structured `{ ok: false }`
    // instead of throwing, so the per-store try/catch in
    // `_runMergeCycle` doesn't have to distinguish "missing module"
    // from "merge logic error".
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
    if (typeof BfrbEvents === 'undefined') {
      return { ok: false, kind: 'bfrb-events-unavailable', count: 0, skipped: 0,
               remoteArrivals: {}, warnings: ['BfrbEvents unavailable'] };
    }

    const uid = user.uid;

    // ── Fetch cloud bfrb_events collection ───────────────────────────
    let cloudResult;
    try {
      cloudResult = await SyncFirestore.getCollection('users/' + uid + '/bfrb_events');
    } catch (err) {
      warnings.push('cloud fetch failed: ' + (err && err.message ? err.message : String(err)));
      return { ok: false, kind: 'cloud-fetch-error',
               count: 0, skipped: 0, remoteArrivals: {}, warnings,
               error: err };
    }
    const cloudDocs = (cloudResult && Array.isArray(cloudResult.docs)) ? cloudResult.docs : [];

    // ── F19a per-record pre-filter ───────────────────────────────────
    // Skip future-schema cloud records BEFORE union. Saves a CAS
    // round-trip (the CAS gate would refuse anyway) and prevents
    // future-schema records from ever entering local-side merge state.
    // Risk: the predicate MUST use `Schema.isFutureRecord(data)` —
    // NOT a hand-rolled comparison.
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
              store: 'bfrb_events',
              remoteSchemaVersion: data.schemaVersion,
              localSchemaVersion: (typeof Schema !== 'undefined' && typeof Schema.SCHEMA_VERSION === 'number')
                ? Schema.SCHEMA_VERSION : 0,
              remoteDeviceId: (typeof data.deviceId === 'string') ? data.deviceId : undefined,
            });
          } catch (_) { /* listener errors must not break the merge */ }
        }
        continue;
      }

      const sig = _sigOf(data);
      if (sig === null) {
        // Bad cloud entry (missing takenAt / etc.) — skip + warn but
        // continue. Defensive against malformed cloud state.
        skipped++;
        warnings.push('skipped malformed cloud entry: ' + (doc.id || 'unknown'));
        continue;
      }
      cloudBySig.set(sig, data);
    }

    // ── Read local events via BfrbEvents.getAll() ────────────────────
    // We read fresh per call (matches E-1c / E-1d self-contained contract).
    let localEvents = [];
    try {
      localEvents = BfrbEvents.getAll();
      if (!Array.isArray(localEvents)) localEvents = [];
    } catch (e) {
      warnings.push('local snapshot read failed: ' + (e && e.message));
      return { ok: false, kind: 'local-read-error', count: 0, skipped,
               remoteArrivals: {}, warnings, error: e };
    }

    // ── Append-merge dedup by (deviceId, takenAt) ────────────────────
    // Build the unified map. Seed with cloud (post-filter) — cloud wins
    // on sig collision (matches the meds metadata-LWW + history record-
    // LWW precedent). For each local entry, skip if sig already present.
    const mergedBySig = new Map();
    for (const [sig, rec] of cloudBySig.entries()) {
      mergedBySig.set(sig, rec);
    }
    for (const local of localEvents) {
      if (!local || typeof local !== 'object') continue;
      const sig = _sigOf(local);
      if (sig === null) {
        // No usable key — keep verbatim, but it won't be CAS-written
        // because _entryIdOf will also return null for it.
        // Push into a separate carry-through array (rare path; entries
        // pre-F10 missing deviceId could land here).
        mergedBySig.set('local-only-' + Math.random().toString(36).slice(2, 11), local);
        continue;
      }
      if (mergedBySig.has(sig)) continue;
      mergedBySig.set(sig, local);
    }

    // Sort merged entries by takenAt ascending so writeback order is
    // deterministic (helps with debugging + test assertions).
    const mergedRecords = Array.from(mergedBySig.values());
    mergedRecords.sort((a, b) => {
      const aT = (a && typeof a.takenAt === 'number') ? a.takenAt : -Infinity;
      const bT = (b && typeof b.takenAt === 'number') ? b.takenAt : -Infinity;
      return aT - bT;
    });

    // ── Per-record CAS writeback ─────────────────────────────────────
    // Each record's write is wrapped in `runTransaction`. The callback
    // refuses the write if `remote.schemaVersion > Schema.SCHEMA_VERSION`
    // (F19a CAS layer). Wrap each per-record call in try/catch so one
    // failure doesn't short-circuit subsequent entries.
    let writtenCount = 0;
    for (const entry of mergedRecords) {
      const entryId = _entryIdOf(entry);
      if (entryId === null) {
        // Local-only entry without (deviceId, takenAt) — can't write to
        // cloud. Already in local store via _readStore() so no data loss;
        // just skip the CAS step.
        skipped++;
        continue;
      }
      // E-3: stash the remote record from inside the transaction so
      // the catch block can include `remoteSchemaVersion` +
      // `remoteDeviceId` on the F19a `'refuse-writeback'` emit.
      let _remoteForEmit = null;
      try {
        await SyncFirestore.runTransaction(async (tx) => {
          const remote = await tx.get('users/' + uid + '/bfrb_events/' + entryId);
          if (remote && remote.data
              && typeof Schema !== 'undefined'
              && typeof Schema.isFutureRecord === 'function'
              && Schema.isFutureRecord(remote.data)) {
            _remoteForEmit = remote.data;
            tx.refuseWriteback(remote.data, Schema.SCHEMA_VERSION);
          }
          // Stamp deviceId + updatedAt + schemaVersion via Schema.stamp.
          // The merged entry already carries deviceId (the dedup key) and
          // takenAt; Schema.stamp ensures schemaVersion lands on records
          // that may have arrived without one. We do NOT bump updatedAt
          // here — the local stamp at log() time is the LWW source.
          const toWrite = (typeof Schema !== 'undefined' && typeof Schema.stamp === 'function')
            ? Schema.stamp(Object.assign({}, entry))
            : Object.assign({}, entry);
          tx.set('users/' + uid + '/bfrb_events/' + entryId, toWrite);
        });
        writtenCount++;
      } catch (err) {
        // refuse-writeback is the F19a CAS-level gate firing. Count as
        // skipped (not error) — the on-disk future-schema record stays
        // intact (the entire point of the gate).
        if (err && err.kind === 'refuse-writeback') {
          skipped++;
          warnings.push('CAS refused writeback for entry ' + entryId + ': ' + err.message);
          // E-3: F19a observability emit at the per-record CAS layer.
          if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.emit === 'function') {
            try {
              SyncEngine.emit('refuse-writeback', {
                store: 'bfrb_events',
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
        // Other errors (network, permission-denied, etc.) — record and
        // continue. Convergence retries next cycle. Matches the E-1c
        // recipe: increment `skipped` on ANY CAS error so observers see
        // a uniform "didn't land" counter.
        warnings.push('CAS write failed for entry ' + entryId + ': '
                      + (err && err.message ? err.message : String(err)));
        skipped++;
      }
    }

    // ── H4: apply the merged set to LOCAL storage ────────────────────
    // The CAS loop above converges the CLOUD; this step converges LOCAL.
    // Without it the steady-state merge never writes cloud-origin arrivals
    // back into the local bfrb_events array — a catch logged on another
    // device would stay invisible on this device forever (a reload won't
    // fix it: hydrateFromCloud short-circuits on the persisted
    // tempo_sync_hydrated_all marker). Mirrors the two correct stores
    // (rest_log / presets): apply the SAME merged set the CAS loop just
    // wrote, strictly AFTER it (so a CAS failure never leaves local ahead
    // of cloud), via the privileged _reconcileWriteRaw that bypasses the
    // F13 canWrite() gate — the dispatcher holds SyncState='hydrating' for
    // the whole cycle, so the normal gated writers would silently no-op.
    // mergedRecords is the full cloud ∪ local union (cloud wins on sig
    // collision; local-only carry-through entries preserved), so the
    // full-array overwrite is lossless. Non-fatal: a failure is a warning,
    // not a thrown merge.
    if (typeof BfrbEvents._reconcileWriteRaw === 'function') {
      try {
        BfrbEvents._reconcileWriteRaw(mergedRecords);
      } catch (e) {
        warnings.push('local reconcile writeback failed: ' + (e && e.message ? e.message : String(e)));
      }
    }

    // ── No F15 emit ──────────────────────────────────────────────────
    // Matches Pick B precedent from E-1d sessions: high-frequency events
    // would produce toast noise. The only F15 surface remains
    // `meds-arrival` from E-1c.

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
  window.SyncMergeBfrb = SyncMergeBfrb;
}
