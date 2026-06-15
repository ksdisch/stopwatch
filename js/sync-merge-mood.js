// Life-OS Phase 3: SyncMergeMood — per-store merge for the mood_events
// stream (the 7th synced store, ADR-0008).
//
// Clones SyncMergeBfrb's self-contained pattern: fetches the cloud's
// `users/{uid}/mood_events` collection itself, pre-filters future-schema
// records (F19a per-record pre-filter), unions cloud ∪ local events deduped
// by `(deviceId, at)`, writes each merged record back via
// `SyncFirestore.runTransaction` (E-1b's CAS wrapper — enforces F19a
// per-record gate at write time), and returns
// `{ ok, count, skipped, remoteArrivals, warnings }`.
//
// **No F15 emit** for mood events (high-frequency precedent from
// bfrb_events / sessions). The `remoteArrivals` field stays `{}` for
// return-shape parity.
//
// Entry id derivation: mood entries are append-only and carry no stable id.
// We derive a deterministic Firestore document id from the dedup signature:
// `entryId = deviceId + '-' + at`. Guarantees cross-device uniqueness AND a
// stable document path; collision (same device + same millisecond) is
// engineering-zero. NOTE the field-name divergence from the bfrb clone:
// mood uses `at`, NOT `takenAt` (ADR-0008 contract).
//
// Public surface (called by `_runMergeCycle` in `js/sync-engine.js`):
//   SyncMergeMood.merge(localSnapshot)
//     → Promise<{ ok, count, skipped, remoteArrivals, warnings }>
//
// F13 write gate: the dispatcher in `_runMergeCycle` flips SyncState to
// 'hydrating' before this function runs and restores 'ready' after. We
// do NOT flip the gate here — the dispatcher owns it (E-1c contract).

const SyncMergeMood = (() => {

  // Signature for dedup: (deviceId, at). Identical convention to
  // `_sigOf` in js/sync-merge-bfrb.js:35 — only the timestamp field
  // name differs (mood records use `at`).
  function _sigOf(entry) {
    if (!entry || typeof entry.at !== 'number') return null;
    const dev = (typeof entry.deviceId === 'string') ? entry.deviceId : '∅';
    return dev + '@' + entry.at;
  }

  // Document id from signature. Replaces '∅' with a literal so the
  // resulting id is filesystem/Firestore-safe (Firestore doc ids can't
  // contain certain chars but ASCII text is fine).
  function _entryIdOf(entry) {
    if (!entry || typeof entry.at !== 'number') return null;
    const dev = (typeof entry.deviceId === 'string' && entry.deviceId) ? entry.deviceId : 'no-device';
    return dev + '-' + entry.at;
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
    if (typeof Mood === 'undefined') {
      return { ok: false, kind: 'mood-unavailable', count: 0, skipped: 0,
               remoteArrivals: {}, warnings: ['Mood unavailable'] };
    }

    const uid = user.uid;

    // ── Fetch cloud mood_events collection ───────────────────────────
    let cloudResult;
    try {
      cloudResult = await SyncFirestore.getCollection('users/' + uid + '/mood_events');
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
        // F19a observability emit — surface the cloud-side
        // refuse-writeback event so `js/sync-toast.js`'s
        // `downlevelWarning` listener can paint a user-facing message.
        if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.emit === 'function') {
          try {
            SyncEngine.emit('refuse-writeback', {
              store: 'mood_events',
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
        // Bad cloud entry (missing at / etc.) — skip + warn but
        // continue. Defensive against malformed cloud state.
        skipped++;
        warnings.push('skipped malformed cloud entry: ' + (doc.id || 'unknown'));
        continue;
      }
      cloudBySig.set(sig, data);
    }

    // ── Read local events via Mood.getAll() ──────────────────────────
    // We read fresh per call (matches E-1c / E-1d self-contained contract).
    let localEvents = [];
    try {
      localEvents = Mood.getAll();
      if (!Array.isArray(localEvents)) localEvents = [];
    } catch (e) {
      warnings.push('local snapshot read failed: ' + (e && e.message));
      return { ok: false, kind: 'local-read-error', count: 0, skipped,
               remoteArrivals: {}, warnings, error: e };
    }

    // ── Append-merge dedup by (deviceId, at) ─────────────────────────
    // Build the unified map. Seed with cloud (post-filter) — cloud wins
    // on sig collision (matches the bfrb_events precedent; mood records
    // are append-only/immutable per ADR-0008, so a collision means the
    // same event and the cloud copy is canonical).
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
        mergedBySig.set('local-only-' + Math.random().toString(36).slice(2, 11), local);
        continue;
      }
      if (mergedBySig.has(sig)) continue;
      mergedBySig.set(sig, local);
    }

    // Sort merged entries by `at` ascending so writeback order is
    // deterministic (helps with debugging + test assertions).
    const mergedRecords = Array.from(mergedBySig.values());
    mergedRecords.sort((a, b) => {
      const aT = (a && typeof a.at === 'number') ? a.at : -Infinity;
      const bT = (b && typeof b.at === 'number') ? b.at : -Infinity;
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
        // Local-only entry without (deviceId, at) — can't write to
        // cloud. Already in local store via _readStore() so no data loss;
        // just skip the CAS step.
        skipped++;
        continue;
      }
      // Stash the remote record from inside the transaction so the
      // catch block can include `remoteSchemaVersion` + `remoteDeviceId`
      // on the F19a `'refuse-writeback'` emit.
      let _remoteForEmit = null;
      try {
        await SyncFirestore.runTransaction(async (tx) => {
          const remote = await tx.get('users/' + uid + '/mood_events/' + entryId);
          if (remote && remote.data
              && typeof Schema !== 'undefined'
              && typeof Schema.isFutureRecord === 'function'
              && Schema.isFutureRecord(remote.data)) {
            _remoteForEmit = remote.data;
            tx.refuseWriteback(remote.data, Schema.SCHEMA_VERSION);
          }
          // Stamp schemaVersion via Schema.stamp on a copy. The merged
          // entry already carries deviceId (the dedup key) and `at`;
          // Schema.stamp ensures schemaVersion lands on records that may
          // have arrived without one. We do NOT bump updatedAt here —
          // the local stamp at log() time is the source of truth.
          const toWrite = (typeof Schema !== 'undefined' && typeof Schema.stamp === 'function')
            ? Schema.stamp(Object.assign({}, entry))
            : Object.assign({}, entry);
          // M2/M5 (AUDIT-2026-06-13): skip the redundant cloud write when the
          // stamped record already equals the cloud doc just read. A tx.set
          // fires onSnapshot on every device → re-merge → re-write, so
          // re-writing an unchanged entry feeds the steady-state loop.
          // recordsEqual excludes the stamp envelope (`at`/`deviceId` are the
          // doc-id identity and always match on a self-echo). Drops ONLY the
          // redundant cloud write; the local apply is unaffected.
          if (remote && remote.data
              && typeof SyncMergeEqual !== 'undefined'
              && typeof SyncMergeEqual.recordsEqual === 'function'
              && SyncMergeEqual.recordsEqual(toWrite, remote.data)) {
            return;
          }
          tx.set('users/' + uid + '/mood_events/' + entryId, toWrite);
        });
        writtenCount++;
      } catch (err) {
        // refuse-writeback is the F19a CAS-level gate firing. Count as
        // skipped (not error) — the on-disk future-schema record stays
        // intact (the entire point of the gate).
        if (err && err.kind === 'refuse-writeback') {
          skipped++;
          warnings.push('CAS refused writeback for entry ' + entryId + ': ' + err.message);
          // F19a observability emit at the per-record CAS layer.
          if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.emit === 'function') {
            try {
              SyncEngine.emit('refuse-writeback', {
                store: 'mood_events',
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
        // M9 (AUDIT-2026-06-13): the native (iOS) runTransaction parity gap
        // (backlog #3) throws here for EVERY record. Surface it ONCE per store
        // via the event bus instead of silently swallowing it, then fall
        // through to the same skipped++ accounting as any other CAS error.
        if (err && err.nativeUnsupported) {
          if (typeof SyncEngine !== 'undefined'
              && typeof SyncEngine.emitNativeWritebackUnsupportedOnce === 'function') {
            try { SyncEngine.emitNativeWritebackUnsupportedOnce('mood_events'); } catch (_) {}
          }
          warnings.push('CAS native-unsupported for entry ' + entryId + ': '
                        + (err && err.message ? err.message : String(err)));
          skipped++;
          continue;
        }
        warnings.push('CAS write failed for entry ' + entryId + ': '
                      + (err && err.message ? err.message : String(err)));
        skipped++;
      }
    }

    // ── H4: apply the merged set to LOCAL storage ────────────────────
    // (Identical contract to sync-merge-bfrb.js — see there for the full
    // rationale.) The CAS loop above converges the CLOUD; this converges
    // LOCAL. Without it, a mood logged on another device never lands in the
    // local mood_events array (a reload won't fix it — hydrate short-circuits
    // on the persisted marker). Apply the SAME merged set the CAS loop wrote,
    // strictly AFTER it, via the privileged _reconcileWriteRaw that bypasses
    // the F13 canWrite() gate (the dispatcher holds SyncState='hydrating' for
    // the whole cycle). mergedRecords is the full cloud ∪ local union; mood is
    // append-only/immutable (ADR-0008), so the full-array overwrite is a
    // lossless superset. Non-fatal: failure is a warning, not a thrown merge.
    if (typeof Mood._reconcileWriteRaw === 'function') {
      try {
        Mood._reconcileWriteRaw(mergedRecords);
      } catch (e) {
        warnings.push('local reconcile writeback failed: ' + (e && e.message ? e.message : String(e)));
      }
    }

    // ── No F15 emit ──────────────────────────────────────────────────
    // High-frequency precedent (bfrb_events / sessions): mood logs would
    // produce toast noise. The only F15 surface remains `meds-arrival`.

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
  window.SyncMergeMood = SyncMergeMood;
}
