// E-1d: SyncMergeHistory — real per-store merge implementation (sessions only).
//
// Replaces E-1b's throwing stub. Per Pick B on TODO #1 (Kyle's
// 2026-05-14 resolution), this PR ships SESSIONS-ONLY append-merge.
// F3 BFRB stream consolidation (E-1d-f3) and F8 distraction
// sessionId-keyed migration (E-1d-f8) ship in their own follow-up PRs.
//
// The merge function is self-contained (mirrors E-1c's SyncMergeMeds
// pattern verbatim): it fetches the cloud's `users/{uid}/history`
// collection itself, pre-filters future-schema records (F19a — Pick A
// on TODO #3), unions cloud ∪ local sessions by `id` (F2), applies
// **record-level** LWW using `updatedAt` (TODO #2 deferral: per-field
// note/tags stamping ships later — record-level LWW means whichever
// record's `updatedAt` is higher wins on the WHOLE record), dedupes
// nested `phaseLog` entries by `(deviceId, phaseStartedAt)` per F6,
// writes each merged record back via `SyncFirestore.runTransaction`
// (E-1b's CAS wrapper — enforces F19a per-record gate at write time),
// and returns `{ ok, count, skipped, remoteArrivals, warnings }`.
//
// **No F15 emit** (Pick B on TODO #4 — sessions arrivals are silent;
// the only F15 surface remains `meds-arrival` from E-1c). The
// `remoteArrivals` field in the return shape stays `{}` for parity
// with the meds merge contract.
//
// Public surface (called by `_runMergeCycle` in `js/sync-engine.js`):
//   SyncMergeHistory.merge(localSnapshot)
//     → Promise<{ ok, count, skipped, remoteArrivals, warnings }>
//
//   - `localSnapshot` is currently null; the dispatcher will pass real
//     per-store snapshot in E-1e. We read local state via
//     `History.getSessions()` regardless — defensive against the
//     parameter being null OR an envelope.
//   - `count` is the number of merged records successfully written back.
//   - `skipped` counts (a) future-schema pre-filter skips, (b) CAS
//     refuse-writeback rejections, (c) per-session error tolerance.
//   - `remoteArrivals` is always `{}` — F15 is NOT fired for sessions.
//   - `warnings` is an array of strings — batched, not console-warned.
//     The dispatcher's per-store try/catch picks them up via the result.
//
// F13 write gate: the dispatcher in `_runMergeCycle` flips SyncState to
// 'hydrating' before this function runs and restores 'ready' after. We
// do NOT flip the gate here — the dispatcher owns it (E-1c contract).
//
// Risk #2 documentation: on session.id collision (engineering-zero per
// F2's `${deviceId}-${Date.now()}-${counter}` shape), CLOUD WINS on
// `cloudAt >= localAt` tie. Matches D-1 reconcile precedent + the E-1c
// meds metadata-LWW pattern.
//
// Risk #3 documentation: LWW is RECORD-LEVEL, not per-field. If Device
// A edits a tag at T=100 and Device B edits a note at T=110, B's note
// edit wins on the WHOLE record — A's tag edit is lost. Per-field
// stamping ships in a separate follow-up PR (TODO #2 finding deferred).

const SyncMergeHistory = (() => {

  // Build a (deviceId, phaseStartedAt) signature for phaseLog dedup
  // per F6. Legacy entries without deviceId fall back to phaseStartedAt-
  // only matching (F19b passthrough spirit — A-1 stamped the four push
  // sites but pre-A-1 entries in the IDB store may lack deviceId).
  function _phaseLogSig(entry) {
    if (!entry || typeof entry.phaseStartedAt !== 'number') return null;
    const dev = (typeof entry.deviceId === 'string') ? entry.deviceId : '∅';
    return dev + '@' + entry.phaseStartedAt;
  }

  // Union two phaseLog arrays into a single deduped array, ordered by
  // phaseStartedAt. Keeps the first occurrence on collision (matches
  // the meds reconcileDoseLog dedup precedent).
  function _mergePhaseLogs(localArr, cloudArr) {
    const local = Array.isArray(localArr) ? localArr : [];
    const cloud = Array.isArray(cloudArr) ? cloudArr : [];
    if (local.length === 0 && cloud.length === 0) return [];
    const out = [];
    const seen = new Set();
    // Walk local first so its entries land first on tied signatures.
    for (const e of local) {
      if (!e || typeof e !== 'object') continue;
      const sig = _phaseLogSig(e);
      if (sig === null) {
        // No usable key (missing phaseStartedAt). Keep verbatim — we
        // can't dedup it but we also can't drop it.
        out.push(e);
        continue;
      }
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(e);
    }
    for (const e of cloud) {
      if (!e || typeof e !== 'object') continue;
      const sig = _phaseLogSig(e);
      if (sig === null) {
        out.push(e);
        continue;
      }
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(e);
    }
    // Order by phaseStartedAt (entries without the field sort first).
    out.sort((a, b) => {
      const aT = (a && typeof a.phaseStartedAt === 'number') ? a.phaseStartedAt : -Infinity;
      const bT = (b && typeof b.phaseStartedAt === 'number') ? b.phaseStartedAt : -Infinity;
      return aT - bT;
    });
    return out;
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
    if (typeof History === 'undefined') {
      return { ok: false, kind: 'history-unavailable', count: 0, skipped: 0,
               remoteArrivals: {}, warnings: ['History unavailable'] };
    }

    const uid = user.uid;

    // Resolve local deviceId via History.getDeviceId() — the canonical
    // accessor for the shared `tempo_device_id` localStorage key.
    let localDeviceId = null;
    try {
      if (typeof History.getDeviceId === 'function') {
        localDeviceId = History.getDeviceId();
      }
    } catch (_) { /* defensive */ }

    // ── Fetch cloud history collection ───────────────────────────────
    let cloudResult;
    try {
      cloudResult = await SyncFirestore.getCollection('users/' + uid + '/history');
    } catch (err) {
      warnings.push('cloud fetch failed: ' + (err && err.message ? err.message : String(err)));
      return { ok: false, kind: 'cloud-fetch-error',
               count: 0, skipped: 0, remoteArrivals: {}, warnings,
               error: err };
    }
    const cloudDocs = (cloudResult && Array.isArray(cloudResult.docs)) ? cloudResult.docs : [];

    // ── F19a per-record pre-filter (Pick A on TODO #3) ───────────────
    // Skip future-schema cloud records BEFORE union. Saves a CAS
    // round-trip (the CAS gate would refuse anyway) and prevents
    // future-schema records from ever entering local-side merge state.
    // Risk #6: the predicate MUST use `Schema.isFutureRecord(data)` —
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
      // Defensive: ensure record carries an id field (cloud doc may
      // have landed without one if it was minted via path-only).
      if (typeof data.id !== 'string' || !data.id) data.id = recId;
      cloudByIdAfterFilter.set(recId, data);
    }

    // ── Read local sessions via History.getSessions() ────────────────
    // We read fresh per call rather than trusting the dispatcher's
    // `localSnapshot` parameter, because (a) the dispatcher passes null
    // today and (b) reading fresh keeps the merge function self-
    // contained (matches E-1c's self-contained contract).
    let localSessions = [];
    try {
      const result = History.getSessions();
      localSessions = (result && typeof result.then === 'function')
        ? await result
        : (Array.isArray(result) ? result : []);
      if (!Array.isArray(localSessions)) localSessions = [];
    } catch (e) {
      warnings.push('local snapshot read failed: ' + (e && e.message));
      return { ok: false, kind: 'local-read-error', count: 0, skipped,
               remoteArrivals: {}, warnings, error: e };
    }

    // ── Union cloud + local by id (F2 dedup) ─────────────────────────
    // Record-level LWW on the session envelope (note / tags / etc.) by
    // `updatedAt`. **Cloud wins on cloudAt >= localAt tie** (matches
    // D-1 reconcile precedent + E-1c meds metadata-LWW pattern). When
    // the local record wins, we still carry the cloud's phaseLog
    // entries forward into a union (F6 dedup).
    const mergedById = new Map();

    // Seed merged map with local sessions (defensive shallow clone so
    // we don't mutate IDB-returned objects when we mutate phaseLog).
    for (const rec of localSessions) {
      if (!rec || typeof rec.id !== 'string' || !rec.id) continue;
      const seeded = Object.assign({}, rec);
      if (Array.isArray(rec.phaseLog)) {
        // Defensive clone of phaseLog so the union step doesn't alias
        // the IDB record's array.
        seeded.phaseLog = rec.phaseLog.slice();
      }
      // Don't introduce an explicit `phaseLog: undefined` field on
      // sessions that lack it (stopwatch / timer / cooking / interval /
      // flow / sequence). Preserves wire-format parity with the
      // non-pomodoro record shape.
      mergedById.set(rec.id, seeded);
    }

    // Walk cloud records; for each, either union into a colliding local
    // record (LWW + phaseLog dedup) or add as a new local-side session.
    for (const [recId, cloudRec] of cloudByIdAfterFilter.entries()) {
      const localRec = mergedById.get(recId);

      if (!localRec) {
        // No local collision — clone the cloud record into the merged
        // map. PhaseLog (if any) passes through verbatim.
        const seeded = Object.assign({}, cloudRec);
        if (Array.isArray(cloudRec.phaseLog)) {
          seeded.phaseLog = cloudRec.phaseLog.slice();
        }
        mergedById.set(recId, seeded);
        continue;
      }

      // Record-level LWW by `updatedAt` — cloud wins on tie.
      // Risk #3 documented: this means a stale note overwrites a fresh
      // tag edit when the record's updatedAt is older. Per-field
      // stamping ships in a follow-up (TODO #2 deferred).
      const localAt = typeof localRec.updatedAt === 'number' ? localRec.updatedAt : 0;
      const cloudAt = typeof cloudRec.updatedAt === 'number' ? cloudRec.updatedAt : 0;

      // Compute phaseLog union BEFORE picking the winner so both sides'
      // phaseLog entries contribute regardless of which envelope wins
      // (F6 contract: phaseLog is append-merged independently of LWW).
      const localPhaseLog = Array.isArray(localRec.phaseLog) ? localRec.phaseLog : null;
      const cloudPhaseLog = Array.isArray(cloudRec.phaseLog) ? cloudRec.phaseLog : null;
      const hasAnyPhaseLog = (localPhaseLog && localPhaseLog.length > 0)
                          || (cloudPhaseLog && cloudPhaseLog.length > 0);
      const mergedPhaseLog = hasAnyPhaseLog
        ? _mergePhaseLogs(localPhaseLog, cloudPhaseLog)
        : null;

      let winner;
      if (cloudAt >= localAt) {
        // Cloud envelope wins: note / tags / and the whole record body.
        winner = Object.assign({}, cloudRec);
      } else {
        // Local envelope wins.
        winner = Object.assign({}, localRec);
      }
      // Apply the unioned phaseLog (overrides whichever envelope's
      // phaseLog was carried along). If neither side had a phaseLog,
      // leave the field absent (stopwatch / timer / cooking sessions
      // don't own phaseLog).
      if (mergedPhaseLog !== null) {
        winner.phaseLog = mergedPhaseLog;
      } else if (Array.isArray(winner.phaseLog)) {
        // Defensive: clone in case the winner is the cloud record (we
        // don't want to alias cloudRec.phaseLog).
        winner.phaseLog = winner.phaseLog.slice();
      }

      mergedById.set(recId, winner);
    }

    // ── Per-record CAS writeback ─────────────────────────────────────
    // Each record's write is wrapped in `runTransaction`. The callback
    // refuses the write if `remote.schemaVersion > Schema.SCHEMA_VERSION`
    // (F19a CAS layer). Wrap each per-record call in try/catch so one
    // failure doesn't short-circuit subsequent sessions (Risk #5).
    const mergedRecords = Array.from(mergedById.values());
    let writtenCount = 0;
    for (const session of mergedRecords) {
      if (!session || typeof session.id !== 'string' || !session.id) {
        skipped++;
        continue;
      }
      try {
        await SyncFirestore.runTransaction(async (tx) => {
          const remote = await tx.get('users/' + uid + '/history/' + session.id);
          if (remote && remote.data
              && typeof Schema !== 'undefined'
              && typeof Schema.isFutureRecord === 'function'
              && Schema.isFutureRecord(remote.data)) {
            tx.refuseWriteback(remote.data, Schema.SCHEMA_VERSION);
          }
          // Stamp deviceId + updatedAt + schemaVersion via Schema.stamp.
          // The merged record's envelope already carries deviceId /
          // updatedAt (LWW source); Schema.stamp ensures schemaVersion
          // lands on records that may have arrived without one.
          // F10: `session.updatedAt` is PRESERVED (LWW winner's value),
          // NOT bumped — bumping every cycle would cause LWW thrash.
          const toWrite = (typeof Schema !== 'undefined' && typeof Schema.stamp === 'function')
            ? Schema.stamp(Object.assign({}, session))
            : Object.assign({}, session);
          tx.set('users/' + uid + '/history/' + session.id, toWrite);
        });
        writtenCount++;
      } catch (err) {
        // refuse-writeback is the F19a CAS-level gate firing. Count as
        // skipped (not error) — the on-disk future-schema record stays
        // intact (the entire point of the gate).
        if (err && err.kind === 'refuse-writeback') {
          skipped++;
          warnings.push('CAS refused writeback for session ' + session.id + ': ' + err.message);
          continue;
        }
        // Other errors (network, permission-denied, etc.) — record and
        // continue. Convergence retries next cycle. We follow the E-1c
        // recipe: increment `skipped` on ANY CAS error so observers see
        // a uniform "didn't land" counter.
        warnings.push('CAS write failed for session ' + session.id + ': '
                      + (err && err.message ? err.message : String(err)));
        skipped++;
      }
    }

    // ── No F15 emit (Pick B on TODO #4) ──────────────────────────────
    // Sessions-arrival is intentionally SILENT. The only F15 surface
    // remains `meds-arrival` from E-1c. Rationale: session creation is
    // high-frequency (every Pomodoro cycle / Flow block / cooking timer
    // / interval round creates one) — toast noise would be high.
    // Users browse sessions on-demand in the history panel.

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
  window.SyncMergeHistory = SyncMergeHistory;
}
