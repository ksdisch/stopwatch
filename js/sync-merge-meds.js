// E-1c: SyncMergeMeds — real per-store merge implementation.
//
// Replaces E-1b's throwing stub. The merge function is self-contained
// (Pick A on E-1c-PROMPT TODO #1): it fetches the cloud's
// `users/{uid}/meds` collection itself, pre-filters future-schema
// records (F19a — Pick C on TODO #5), unions cloud ∪ local by `id`,
// delegates per-med doseLog reconcile to `MedsManager.reconcileDoseLog`
// (D-2 helper — enforces F1 / F14 / F16 / F19a per-method gate), writes
// each merged record back via `SyncFirestore.runTransaction` (E-1b's
// CAS wrapper — enforces F19a per-record gate), and emits `meds-arrival`
// on `SyncEngine.emit` for any med where ≥2 NEW remote dose entries
// arrived during this cycle (F15 — Pick A on TODO #3). After each
// per-med doseLog reassignment, `MedsManager.onMergeComplete(medId)`
// fires to re-derive `lastTakenAt` (F4) — order is critical: the
// recompute reads med.doseLog (Risk #11).
//
// Public surface (called by `_runMergeCycle` in `js/sync-engine.js`):
//   SyncMergeMeds.merge(localSnapshot)
//     → Promise<{ ok, count, skipped, remoteArrivals, warnings }>
//
//   - `localSnapshot` is currently null; the dispatcher will pass real
//     per-store snapshot in E-1e. We read local state via
//     `MedsManager.all()` regardless — defensive against the parameter
//     being null OR an array OR an envelope.
//   - `count` is the number of merged records successfully written back.
//   - `skipped` counts (a) future-schema pre-filter skips, (b) CAS
//     refuse-writeback rejections, (c) per-med error tolerance.
//   - `remoteArrivals` is a plain object `{ [medId]: count }` only
//     containing entries where count ≥ 1 (the F15 threshold ≥2 is
//     applied at emit time). Caller exposes this on the cycle result
//     for downstream observability.
//   - `warnings` is an array of strings — batched, not console-warned.
//     The dispatcher's per-store try/catch picks them up via the result.
//
// F13 write gate: the dispatcher in `_runMergeCycle` flips SyncState to
// 'hydrating' before this function runs and restores 'ready' after. We
// do NOT flip the gate here — the dispatcher owns it (Pick B on TODO #2).

const SyncMergeMeds = (() => {

  // Capture a (deviceId, takenAt) signature so we can diff post-merge
  // against pre-merge state and count NEW remote arrivals.
  function _sigOf(entry) {
    if (!entry || typeof entry.takenAt !== 'number') return null;
    const dev = (typeof entry.deviceId === 'string') ? entry.deviceId : '∅';
    return dev + '@' + entry.takenAt;
  }

  // Build a Set of (deviceId, takenAt) signatures from an entries array.
  // Used for both the pre-merge baseline (Risk #3 false-positive guard)
  // and the local-known set (Risk #7 idempotency guard).
  function _sigSet(entries) {
    const out = new Set();
    if (!Array.isArray(entries)) return out;
    for (const e of entries) {
      const s = _sigOf(e);
      if (s) out.add(s);
    }
    return out;
  }

  async function merge(/* localSnapshot */) {
    const warnings = [];
    let skipped = 0;
    const remoteArrivals = Object.create(null);

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
    if (typeof MedsManager === 'undefined') {
      return { ok: false, kind: 'meds-unavailable', count: 0, skipped: 0,
               remoteArrivals: {}, warnings: ['MedsManager unavailable'] };
    }

    const uid = user.uid;

    // Resolve local deviceId via MedsManager's snapshot envelope (which
    // already calls the lazy `_medsGetDeviceId` accessor / History's
    // shared `tempo_device_id` key). DO NOT introduce a new helper —
    // the audit's affected-files table explicitly forbids it.
    let localDeviceId = null;
    try {
      const env = MedsManager.snapshotForSync();
      if (env && typeof env.deviceId === 'string') localDeviceId = env.deviceId;
    } catch (_) { /* defensive */ }

    // ── Fetch cloud meds collection ──────────────────────────────────
    let cloudResult;
    try {
      cloudResult = await SyncFirestore.getCollection('users/' + uid + '/meds');
    } catch (err) {
      warnings.push('cloud fetch failed: ' + (err && err.message ? err.message : String(err)));
      return { ok: false, kind: 'cloud-fetch-error',
               count: 0, skipped: 0, remoteArrivals: {}, warnings,
               error: err };
    }
    const cloudDocs = (cloudResult && Array.isArray(cloudResult.docs)) ? cloudResult.docs : [];

    // ── F19a per-record pre-filter (Pick C on TODO #5) ───────────────
    // Skip future-schema cloud records BEFORE union. Saves a CAS
    // round-trip (the CAS gate would refuse anyway) and prevents
    // future-schema records from ever entering local-side merge state.
    // Risk #4: the predicate MUST use `Schema.isFutureRecord(data)` —
    // NOT a hand-rolled comparison.
    const cloudByIdAfterFilter = new Map();
    for (const doc of cloudDocs) {
      if (!doc || !doc.data || typeof doc.data !== 'object') continue;
      const data = doc.data;
      const recId = (typeof data.id === 'string' && data.id) ? data.id : doc.id;
      if (typeof recId !== 'string' || !recId) continue;

      if (typeof Schema !== 'undefined' && typeof Schema.isFutureRecord === 'function'
          && Schema.isFutureRecord(data)) {
        skipped++;
        warnings.push('skipped future-schema cloud record: ' + recId
                      + ' (schemaVersion=' + data.schemaVersion + ')');
        continue;
      }
      // Defensive: ensure record carries an id field (cloud doc may have
      // landed without one if it was minted via path-only).
      if (typeof data.id !== 'string' || !data.id) data.id = recId;
      cloudByIdAfterFilter.set(recId, data);
    }

    // ── Read local meds via MedsManager.all() ────────────────────────
    // We read fresh per call rather than trusting the dispatcher's
    // `localSnapshot` parameter, because (a) the dispatcher passes null
    // today and (b) reading fresh keeps the merge function self-
    // contained (Pick A on TODO #1).
    let localMeds = [];
    try {
      localMeds = MedsManager.all().map(m => (typeof m.getState === 'function' ? m.getState() : m));
    } catch (e) {
      warnings.push('local snapshot read failed: ' + (e && e.message));
      return { ok: false, kind: 'local-read-error', count: 0, skipped,
               remoteArrivals: {}, warnings, error: e };
    }

    // ── Union cloud + local by id (cloud is doseLog source) ──────────
    // LWW on the metadata envelope (name / dose / frequency / archivedAt)
    // by `updatedAt`. doseLog is APPEND-merged via reconcileDoseLog
    // regardless of LWW winner — both sides' entries contribute and
    // F1 / F16 collapse cross-device duplicates.
    const mergedById = new Map();
    const localById = new Map();
    for (const rec of localMeds) {
      if (rec && typeof rec.id === 'string' && rec.id) {
        localById.set(rec.id, rec);
      }
    }

    // Seed merged map with local records (the doseLog starts as local's).
    for (const rec of localMeds) {
      if (rec && typeof rec.id === 'string' && rec.id) {
        // Defensive shallow clone so we don't mutate MedsManager's
        // in-memory objects when we reassign doseLog below.
        mergedById.set(rec.id, Object.assign({}, rec, {
          doseLog: Array.isArray(rec.doseLog) ? rec.doseLog.slice() : [],
        }));
      }
    }

    // Walk cloud records; for each, either union into a colliding local
    // record (append cloud doseLog entries onto the local snapshot) or
    // add as a new local-side med.
    for (const [recId, cloudRec] of cloudByIdAfterFilter.entries()) {
      const localRec = mergedById.get(recId);
      const cloudDoseLog = Array.isArray(cloudRec.doseLog) ? cloudRec.doseLog : [];

      if (!localRec) {
        // No local collision — clone the cloud record into the merged
        // map. Its doseLog will still pass through reconcileDoseLog
        // below for F16 clock-skew clamping.
        mergedById.set(recId, Object.assign({}, cloudRec, {
          doseLog: cloudDoseLog.slice(),
        }));
        continue;
      }

      // Metadata LWW by `updatedAt` — cloud wins on tie (matches the
      // push-then-hydrate convergence pattern in D-1's _mergeMeds).
      const localAt = typeof localRec.updatedAt === 'number' ? localRec.updatedAt : 0;
      const cloudAt = typeof cloudRec.updatedAt === 'number' ? cloudRec.updatedAt : 0;
      if (cloudAt >= localAt) {
        // Cloud envelope wins: name / dose / frequency / etc.
        // Preserve our merged-thus-far doseLog (will be unioned with
        // cloud entries below via reconcileDoseLog).
        const mergedDoseLog = localRec.doseLog;
        mergedById.set(recId, Object.assign({}, cloudRec, {
          doseLog: mergedDoseLog,
        }));
      }
      // ELSE: local envelope wins — but we still need cloud's doseLog
      // entries for append-merge. Stash on the merged record so the
      // reconcile loop below can union them.
      const updated = mergedById.get(recId);
      // Carry the cloud-side doseLog separately as "incoming" so the
      // reconcile call below can union it against the merged doseLog.
      // Use a non-enumerable-ish marker to avoid leaking onto the
      // record's wire format. We pop it before writeback.
      updated.__incomingFromCloud = cloudDoseLog;
    }

    // ── Per-med reconcile loop ───────────────────────────────────────
    // For each merged med:
    //   1. Snapshot pre-merge doseLog (Risk #3 baseline for "new remote")
    //   2. Union with cloud incoming entries → reconcileDoseLog
    //   3. Reassign med.doseLog = result.entries (BEFORE F4 recompute)
    //   4. Call MedsManager.onMergeComplete(med.id) — F4 (Risk #11)
    //   5. Compute new-remote count by diffing post vs pre
    //   6. Stash in remoteArrivals[medId] if > 0
    const mergedRecords = Array.from(mergedById.values());
    for (const med of mergedRecords) {
      try {
        // Pre-merge baseline: signatures of doseLog entries that
        // existed locally before the merge (and ALSO entries already
        // dedup-collapsed earlier in this cycle's union). This is
        // critical for idempotency (Risk #7): the second merge with
        // the same cloud state must produce zero new arrivals.
        const beforeMerge = Array.isArray(med.doseLog) ? med.doseLog.slice() : [];
        const beforeSet = _sigSet(beforeMerge);

        // Strip the carried-in incoming marker (set on metadata-LWW-loses
        // path above). Default to the cloud doc's doseLog if a fresh
        // cloud record (no local collision) — but for fresh records,
        // beforeMerge already IS the cloud doseLog, so incoming=[] is
        // correct to avoid double-counting in reconcileDoseLog's union.
        let incoming = med.__incomingFromCloud;
        if (med.__incomingFromCloud !== undefined) {
          delete med.__incomingFromCloud;
        }
        if (!Array.isArray(incoming)) incoming = [];

        // Call D-2's reconcile helper. It handles F1 / F14 / F16 / F19a-
        // per-method. Returns a NEW array (does not mutate med.doseLog).
        const result = MedsManager.reconcileDoseLog(med, incoming);

        // Step 3: REASSIGN doseLog FIRST.
        med.doseLog = Array.isArray(result.entries) ? result.entries : [];

        // Step 4: F4 recompute. MUST happen AFTER step 3 (Risk #11).
        // Falls through cleanly when the med isn't loaded into the
        // singleton (D-2 onMergeComplete is a no-op in that case).
        if (typeof MedsManager.onMergeComplete === 'function') {
          try { MedsManager.onMergeComplete(med.id); }
          catch (e) {
            warnings.push('onMergeComplete threw for med ' + med.id + ': ' + (e && e.message));
          }
        }

        // Step 5: count NEW remote arrivals. "NEW" = (a) deviceId
        // differs from local, AND (b) signature was not in the pre-
        // merge baseline. The conjunction guards against both Risk #3
        // (same-device retries) AND Risk #7 (already-known cross-
        // device entries from a previous cycle).
        let newRemoteCount = 0;
        for (const e of med.doseLog) {
          if (!e || typeof e.takenAt !== 'number') continue;
          if (typeof e.deviceId !== 'string') continue;
          if (e.deviceId === localDeviceId) continue;
          const sig = _sigOf(e);
          if (!sig) continue;
          if (beforeSet.has(sig)) continue;
          newRemoteCount++;
        }
        if (newRemoteCount > 0) {
          remoteArrivals[med.id] = newRemoteCount;
        }

        // Surface any per-med reconcile warnings.
        if (result && Array.isArray(result.warnings) && result.warnings.length > 0) {
          for (const w of result.warnings) warnings.push(w);
        }
      } catch (e) {
        // Per-med error tolerance — one bad med must not abort the
        // whole cycle (Risk #6 inherited from E-1b CAS atomicity).
        skipped++;
        warnings.push('reconcile threw for med ' + (med && med.id) + ': '
                      + (e && e.message ? e.message : String(e)));
      }
    }

    // ── Per-record CAS writeback ─────────────────────────────────────
    // Each record's write is wrapped in `runTransaction`. The callback
    // refuses the write if `remote.schemaVersion > Schema.SCHEMA_VERSION`
    // (F19a CAS layer). Wrap each per-med call in try/catch so one
    // failure doesn't short-circuit subsequent meds (Risk #6).
    let writtenCount = 0;
    for (const med of mergedRecords) {
      if (!med || typeof med.id !== 'string' || !med.id) {
        skipped++;
        continue;
      }
      try {
        await SyncFirestore.runTransaction(async (tx) => {
          const remote = await tx.get('users/' + uid + '/meds/' + med.id);
          if (remote && remote.data
              && typeof Schema !== 'undefined'
              && typeof Schema.isFutureRecord === 'function'
              && Schema.isFutureRecord(remote.data)) {
            tx.refuseWriteback(remote.data, Schema.SCHEMA_VERSION);
          }
          // Stamp deviceId + updatedAt + schemaVersion via Schema.stamp.
          // The merged record's metadata envelope already carries deviceId
          // / updatedAt (LWW source); Schema.stamp ensures schemaVersion
          // lands on records that may have arrived without one.
          const toWrite = (typeof Schema !== 'undefined' && typeof Schema.stamp === 'function')
            ? Schema.stamp(Object.assign({}, med))
            : Object.assign({}, med);
          tx.set('users/' + uid + '/meds/' + med.id, toWrite);
        });
        writtenCount++;
      } catch (err) {
        // refuse-writeback is the F19a CAS-level gate firing. Count as
        // skipped (not error) — the on-disk future-schema record stays
        // intact (the entire point of the gate).
        if (err && err.kind === 'refuse-writeback') {
          skipped++;
          warnings.push('CAS refused writeback for med ' + med.id + ': ' + err.message);
          continue;
        }
        // Other errors (network, permission-denied, etc.) — record and
        // continue. Convergence retries next cycle.
        warnings.push('CAS write failed for med ' + med.id + ': '
                      + (err && err.message ? err.message : String(err)));
        // Don't count as skipped — these are transient failures that
        // the test #13 expectation distinguishes from refuse-writeback.
        // Audit Risk #6 (Test #13) says `skipped === 1` for network
        // error on med #1 + success on med #2. We follow the audit's
        // recipe: increment `skipped` on ANY CAS error so observers
        // see a uniform "didn't land" counter.
        skipped++;
      }
    }

    // ── F15 emit (Pick A on TODO #3) ─────────────────────────────────
    // Per-med, per-cycle, threshold ≥2 NEW remote entries. Each
    // qualifying med fires its own `meds-arrival` event. B-4's toast
    // subscriber consumes the payload.
    if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.emit === 'function') {
      for (const medId of Object.keys(remoteArrivals)) {
        const count = remoteArrivals[medId];
        if (count >= 2) {
          try { SyncEngine.emit('meds-arrival', { medId: medId, count: count }); }
          catch (_) { /* listener errors must not break the merge */ }
        }
      }
    }

    return {
      ok: true,
      count: writtenCount,
      skipped: skipped,
      remoteArrivals: Object.assign({}, remoteArrivals),
      warnings: warnings,
    };
  }

  return { merge };
})();

if (typeof window !== 'undefined') {
  window.SyncMergeMeds = SyncMergeMeds;
}
