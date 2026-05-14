// E-1e: SyncMergePresets — real per-store merge for quick presets.
//
// Replaces E-1b's throwing stub. Mirrors `js/sync-merge-history.js`'s
// self-contained merge pattern: fetches the cloud's
// `users/{uid}/presets` collection itself, pre-filters future-schema
// records (F19a per-record pre-filter), unions cloud ∪ local presets
// by `id` (F2 dedup), applies full-record LWW by `updatedAt` (cloud
// wins on tie — matches E-1d sessions LWW precedent + D-1 reconcile
// precedent), propagates `deletedAt` tombstones cross-device, writes
// each merged record back via `SyncFirestore.runTransaction` (E-1b's
// CAS wrapper — enforces F19a per-record gate at write time), and
// returns `{ ok, count, skipped, remoteArrivals, warnings }`.
//
// **Tombstone propagation rules:**
//   - cloud `deletedAt != null`, local `deletedAt == null` (or absent
//     local) → merged record gains cloud's `deletedAt` (cloud-deleted
//     wins on push to local).
//   - local `deletedAt != null`, cloud `deletedAt == null` → CAS
//     writeback pushes local's `deletedAt` to cloud (local-deleted
//     wins on push to cloud).
//   - Both sides have `deletedAt`: newer (higher numeric) wins.
//   - Predicate uses `== null` (catches `undefined` + `null` but NOT
//     `0`/`''`) per Risk #8.
//
// **No F15 emit** for presets arrivals (matches Pick B precedent from
// E-1d sessions / E-1d-f3 BFRB / E-1d-f8 distractions). The
// `remoteArrivals` field stays `{}` for return-shape parity.
//
// Local writeback: after CAS succeeds, commits the merged set back to
// localStorage via `Presets._reconcileWriteRaw(records)` — the
// privileged write path that bypasses `SyncState.canWrite()`. Same
// contract as hydrate.
//
// Public surface (called by `_runMergeCycle` in `js/sync-engine.js`):
//   SyncMergePresets.merge(localSnapshot)
//     → Promise<{ ok, count, skipped, remoteArrivals, warnings }>
//
// F13 write gate: the dispatcher in `_runMergeCycle` flips SyncState to
// 'hydrating' before this function runs and restores 'ready' after. We
// do NOT flip the gate here — the dispatcher owns it (E-1c contract).

const SyncMergePresets = (() => {

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
    if (typeof Presets === 'undefined' || typeof Presets._getAllIncludingTombstones !== 'function') {
      return { ok: false, kind: 'presets-unavailable', count: 0, skipped: 0,
               remoteArrivals: {}, warnings: ['Presets unavailable'] };
    }
    if (typeof Schema === 'undefined') {
      return { ok: false, kind: 'schema-unavailable', count: 0, skipped: 0,
               remoteArrivals: {}, warnings: ['Schema unavailable'] };
    }

    const uid = user.uid;

    // ── Fetch cloud presets collection ───────────────────────────────
    let cloudResult;
    try {
      cloudResult = await SyncFirestore.getCollection('users/' + uid + '/presets');
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
    const cloudById = new Map();
    for (const doc of cloudDocs) {
      if (!doc || !doc.data || typeof doc.data !== 'object') continue;
      const data = doc.data;
      const recId = (typeof data.id === 'string' && data.id) ? data.id : doc.id;
      if (typeof recId !== 'string' || !recId) {
        skipped++;
        warnings.push('skipped cloud preset without id');
        continue;
      }
      if (typeof Schema.isFutureRecord === 'function' && Schema.isFutureRecord(data)) {
        skipped++;
        warnings.push('skipped future-schema cloud record: ' + recId
                      + ' (schemaVersion=' + data.schemaVersion + ')');
        continue;
      }
      // Defensive: ensure record carries an id field (cloud doc may
      // have landed without one if it was minted via path-only).
      if (typeof data.id !== 'string' || !data.id) data.id = recId;
      cloudById.set(recId, data);
    }

    // ── Read local presets via tombstone-inclusive view ──────────────
    // The merge MUST see tombstones so it can push them to cloud (per
    // tombstone propagation contract above). UI callers use
    // `Presets.getAll()` which filters tombstones — we use the
    // `_getAllIncludingTombstones()` sibling here.
    let localPresets = [];
    try {
      localPresets = Presets._getAllIncludingTombstones();
      if (!Array.isArray(localPresets)) localPresets = [];
    } catch (e) {
      warnings.push('local snapshot read failed: ' + (e && e.message));
      return { ok: false, kind: 'local-read-error', count: 0, skipped,
               remoteArrivals: {}, warnings, error: e };
    }

    // ── Union by id — full-record LWW by updatedAt + tombstone merge ─
    const mergedById = new Map();

    // Seed with local presets (defensive shallow clone).
    for (const rec of localPresets) {
      if (!rec || typeof rec.id !== 'string' || !rec.id) continue;
      mergedById.set(rec.id, Object.assign({}, rec));
    }

    // Walk cloud presets; either union into colliding local record
    // (LWW + tombstone propagation) or add as a new local-side preset.
    for (const [recId, cloudRec] of cloudById.entries()) {
      const localRec = mergedById.get(recId);

      if (!localRec) {
        // No local collision — clone the cloud record into the merged
        // map verbatim. Tombstone (if any) propagates by virtue of
        // copying the field.
        mergedById.set(recId, Object.assign({}, cloudRec));
        continue;
      }

      // Full-record LWW by updatedAt — cloud wins on tie.
      const localAt = typeof localRec.updatedAt === 'number' ? localRec.updatedAt : 0;
      const cloudAt = typeof cloudRec.updatedAt === 'number' ? cloudRec.updatedAt : 0;
      let winner = (cloudAt >= localAt)
        ? Object.assign({}, cloudRec)
        : Object.assign({}, localRec);

      // Tombstone propagation — independent of the LWW envelope winner.
      // Both predicates use `== null` (catches undefined + null but
      // NOT 0/''). Risk #8.
      const cloudDel = (cloudRec.deletedAt == null) ? null : cloudRec.deletedAt;
      const localDel = (localRec.deletedAt == null) ? null : localRec.deletedAt;
      if (cloudDel != null && localDel != null) {
        // Both deleted — newer wins.
        winner.deletedAt = (cloudDel >= localDel) ? cloudDel : localDel;
      } else if (cloudDel != null && localDel == null) {
        // Cloud deleted, local intact — local gains cloud's deletedAt.
        winner.deletedAt = cloudDel;
      } else if (localDel != null && cloudDel == null) {
        // Local deleted, cloud intact — CAS writeback will push
        // local's deletedAt to cloud. Carry the deletedAt on the
        // winner regardless of which envelope LWW picked.
        winner.deletedAt = localDel;
      }
      // Both clean — no tombstone to carry.

      mergedById.set(recId, winner);
    }

    // ── Per-record CAS writeback ─────────────────────────────────────
    // Each record's write is wrapped in `runTransaction`. The callback
    // refuses the write if `remote.schemaVersion > Schema.SCHEMA_VERSION`
    // (F19a CAS layer). Per-record try/catch so one bad record doesn't
    // short-circuit subsequent presets.
    const mergedRecords = Array.from(mergedById.values());
    let writtenCount = 0;
    for (const preset of mergedRecords) {
      if (!preset || typeof preset.id !== 'string' || !preset.id) {
        skipped++;
        continue;
      }
      try {
        await SyncFirestore.runTransaction(async (tx) => {
          const remote = await tx.get('users/' + uid + '/presets/' + preset.id);
          if (remote && remote.data
              && typeof Schema.isFutureRecord === 'function'
              && Schema.isFutureRecord(remote.data)) {
            tx.refuseWriteback(remote.data, Schema.SCHEMA_VERSION);
          }
          // Stamp deviceId/updatedAt are NOT bumped here — bumping every
          // cycle would cause LWW thrash. The merged record's envelope
          // already carries the LWW winner's updatedAt; Schema.stamp
          // only sets schemaVersion (no-op if already present).
          const toWrite = (typeof Schema.stamp === 'function')
            ? Schema.stamp(Object.assign({}, preset))
            : Object.assign({}, preset);
          tx.set('users/' + uid + '/presets/' + preset.id, toWrite);
        });
        writtenCount++;
      } catch (err) {
        if (err && err.kind === 'refuse-writeback') {
          skipped++;
          warnings.push('CAS refused writeback for preset ' + preset.id + ': ' + err.message);
          continue;
        }
        warnings.push('CAS write failed for preset ' + preset.id + ': '
                      + (err && err.message ? err.message : String(err)));
        skipped++;
      }
    }

    // ── Write merged set back to local ───────────────────────────────
    // The reconcile write path bypasses the F13 gate for the same
    // reason hydrate does — the merge function is the explicit
    // exception during the dispatcher's 'hydrating' window.
    if (typeof Presets._reconcileWriteRaw === 'function') {
      try {
        Presets._reconcileWriteRaw(mergedRecords);
      } catch (e) {
        warnings.push('local reconcile writeback failed: '
                      + (e && e.message ? e.message : String(e)));
      }
    }

    // ── No F15 emit ──────────────────────────────────────────────────
    // presets arrivals are silent (matches Pick B precedent from
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
  window.SyncMergePresets = SyncMergePresets;
}
