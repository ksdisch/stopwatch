// Medications engine — prescription-focused dose log.
//
// Each medication has a name, an optional dose string (e.g. "60 mg"), and
// a frequency bucket: 'once-daily' | 'twice-daily' | 'as-needed'. The
// engine tracks exactly *when* each dose was taken and derives "taken
// today" status from the doseLog. No schedules, no countdowns — logging
// is always the user's explicit action (Took it now / Took it ~X ago).
//
// Factory + manager pattern mirrors stopwatch/timer. Storage key stays
// 'wellness_meds' and migrates legacy V1 records (schedule-based) into
// V2 by defaulting frequency='as-needed' and dropping schedule fields.

// Canonical V2 enum values. Listed for documentation only — the loader and
// setter intentionally do NOT validate against this list (F20: absent →
// default, present-but-unknown → preserve verbatim, so forward-compat enum
// values like a future 'three-times-daily' roundtrip cleanly on a V2 client).
const MED_FREQUENCIES = ['once-daily', 'twice-daily', 'as-needed'];

// D-2: F1 + F16 shared window. Same constant powers both the cross-device
// ±15-min duplicate collapse (F1) and the cross-device clock-skew clamp
// (F16) — decoupling them would create two knobs with overlapping
// semantics. Inclusive at the boundary per Decision #4 (user mental model
// is "doses within 15 minutes" — they don't distinguish 14:59 from 15:00).
// Exposed on MedsManager.RECONCILE_WINDOW_MS for tests.
const RECONCILE_WINDOW_MS = 15 * 60 * 1000;

// F19b: known top-level keys on a med record. Anything NOT in this set
// gets collected into the per-med `_forwardBag` on load and merged back
// into the wire format on save, so unknown fields minted on a newer
// schema survive roundtrip on a downlevel client.
//
// Includes V1 legacy fields (scheduleType/intervalMs/times/etc.) so the
// V1→V2 migration in loadState keeps dropping them deliberately rather
// than smuggling them into __forward forever. Add a key here when a new
// field is introduced.
const KNOWN_MED_KEYS = new Set([
  // V2 schema (current)
  'id', 'name', 'dose', 'frequency',
  'lastTakenAt', 'doseLog',
  // F17 (D-1): immutable provenance marker set once at reconcile time.
  // Distinct from `deviceId` (F10) which updates on every write — this is
  // the device that authored the record pre-sync. Distinguishes "this
  // Adderall came from phone" vs "this Adderall came from laptop" when
  // both were independently created pre-sync, so `ManualDedupe.scan()`
  // can surface candidate dupes by `medId` to the user (D-2+ UI).
  'originDeviceId',
  // F10 record-level LWW stamps
  'updatedAt', 'deviceId',
  // F19a schema version
  'schemaVersion',
  // V1 legacy (intentionally dropped on migration — recognized as
  // "known to be discarded" so __forward stays clean)
  'scheduleType', 'intervalMs', 'times',
  'notificationsEnabled', 'dueNotified', 'dueNotificationAt',
]);

// F10: lazy deviceId helper. Mirrors History.getDeviceId — reads or creates
// the shared `tempo_device_id` localStorage key so meds can stamp records
// without depending on History's module load order.
function _medsGetDeviceId() {
  let id = null;
  try { id = localStorage.getItem('tempo_device_id'); } catch (e) {}
  if (!id) {
    id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : 'd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11);
    try { localStorage.setItem('tempo_device_id', id); } catch (e) {}
  }
  return id;
}

function createMed(id) {
  let name = 'Medication';
  let dose = '';
  let frequency = 'once-daily';
  let lastTakenAt = null;          // ms timestamp, convenience mirror of doseLog tail
  let doseLog = [];                 // [{ takenAt: ms, deviceId }], append-only, sorted ascending
  // F10: record-level LWW stamps. `touch()` bumps both on any mutation so
  // sync's per-field LWW for name/dose/frequency has a stable comparator.
  let updatedAt = Date.now();
  let deviceId = _medsGetDeviceId();
  // F17 (D-1): immutable provenance marker. Set once by the reconcile
  // orchestrator (sync-engine.reconcileImportedBucket) on records that
  // lacked one pre-sync; never mutated thereafter. Distinct from `deviceId`
  // (which bumps on every write). loadState reads this guarded by `!= null`
  // so re-loads of records without the field don't blow away the in-memory
  // value, and the field is emitted by getState() so MedsManager.loadAll()
  // → med.getState() roundtrips it for downstream consumers (manual-dedupe,
  // idempotency check in reconcileImportedBucket).
  let originDeviceId = null;
  // F19a: set by loadState when the on-disk record was minted on a newer
  // schema (state.schemaVersion > SCHEMA_VERSION). MedsManager.saveAll
  // and .remove consult this flag and refuse the operation, leaving the
  // future record on disk byte-clean for the newer client to consume.
  let _fromFutureSchema = false;
  // F19a: when the on-disk record is a future record, capture its exact
  // schemaVersion so getState() can re-emit it verbatim. Without this the
  // wire-format passthrough (e.g. snapshotForSync) would silently downgrade
  // future records to SCHEMA_VERSION. Null for current/legacy records.
  let _originalSchemaVersion = null;
  // F19b: unknown top-level fields collected from the on-disk record at
  // load time. getState() merges these back into the wire format so a
  // downlevel client doesn't strip future-schema fields it can't parse.
  // Null until loadState runs with at least one unrecognized key.
  let _forwardBag = null;

  function touch() {
    updatedAt = Date.now();
    deviceId = _medsGetDeviceId();
  }

  // ── Accessors ───────────────────────────────────────────────────────

  function getId()   { return id; }
  function getName() { return name; }
  function getDose() { return dose; }
  function getFrequency() { return frequency; }
  function getLastTakenAt() { return lastTakenAt; }
  function getDoseLog() { return doseLog.slice(); }
  function getUpdatedAt() { return updatedAt; }
  function getDeviceId() { return deviceId; }
  function isFromFutureSchema() { return _fromFutureSchema; }

  function setName(n) {
    name = (n == null ? '' : String(n)).trim().slice(0, 60) || 'Medication';
    touch();
  }

  function setDose(d) {
    dose = (d == null ? '' : String(d)).trim().slice(0, 40);
    touch();
  }

  function setFrequency(f) {
    // F20: split absent vs present-but-unknown.
    // - Absent (null/undefined/non-string/empty) → default 'once-daily'.
    // - Present-but-unknown (any other non-empty string) → preserve verbatim.
    // The UI uses a <select> so user input is always a known enum value;
    // the preserve path matters for the JSON-import / restore flow, which
    // routes external state through MedsManager.add({ frequency }) →
    // setFrequency. Without preservation a backup from a newer schema would
    // get silently downcast to 'once-daily' on first import.
    frequency = (typeof f === 'string' && f.length > 0) ? f : 'once-daily';
    touch();
  }

  // ── Dose logging ────────────────────────────────────────────────────

  function logDose(takenAt) {
    const when = (typeof takenAt === 'number' && !isNaN(takenAt))
      ? takenAt
      : Date.now();
    // F10: each dose entry carries its origin deviceId so cross-device
    // append-merge can dedup by (deviceId, takenAt).
    doseLog.push({ takenAt: when, deviceId: _medsGetDeviceId() });
    // Keep log sorted so getDosesToday() / getLastTakenAt() stay consistent
    // even if the user logs an earlier dose via "Took it ~" after a newer one.
    doseLog.sort((a, b) => a.takenAt - b.takenAt);
    if (doseLog.length > 1000) doseLog.splice(0, doseLog.length - 1000);
    lastTakenAt = doseLog[doseLog.length - 1].takenAt;
    touch();
  }

  function undoLastDose() {
    if (doseLog.length === 0) return false;
    doseLog.pop();
    lastTakenAt = doseLog.length > 0 ? doseLog[doseLog.length - 1].takenAt : null;
    touch();
    return true;
  }

  // F4: re-derive lastTakenAt from the doseLog tail. Strategy doc treats
  // lastTakenAt as a synced convenience mirror that must be re-derived after
  // any merge — it isn't synced directly (Row 2 of the per-store table).
  // Idempotent. Does NOT bump updatedAt: this helper is invoked by the sync
  // path (SyncEngine after reconcile), not by a user action; the caller
  // decides when persistence happens. Assumes doseLog is sorted ascending —
  // logDose/loadState already maintain that invariant; D-2's reconcile must
  // sort after merge before calling this.
  function recomputeLastTakenAt() {
    lastTakenAt = doseLog.length > 0
      ? doseLog[doseLog.length - 1].takenAt
      : null;
  }

  // ── Derived queries ─────────────────────────────────────────────────

  function getTimeSinceLastDoseMs() {
    if (lastTakenAt === null) return null;
    return Date.now() - lastTakenAt;
  }

  function startOfToday() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
  }

  function getDosesToday() {
    const cutoff = startOfToday();
    let count = 0;
    for (let i = doseLog.length - 1; i >= 0; i--) {
      if (doseLog[i].takenAt >= cutoff) count++;
      else break; // log is sorted ascending; earlier entries are older
    }
    return count;
  }

  function getExpectedDosesToday() {
    if (frequency === 'once-daily') return 1;
    if (frequency === 'twice-daily') return 2;
    return null;
  }

  function getStatusToday() {
    const expected = getExpectedDosesToday();
    const takenToday = getDosesToday();
    if (expected === null) {
      return { kind: 'na', takenToday, expected: null };
    }
    if (takenToday >= expected) return { kind: 'done',    takenToday, expected };
    if (takenToday > 0)         return { kind: 'partial', takenToday, expected };
    return                             { kind: 'none',    takenToday, expected };
  }

  // ── Serialization ───────────────────────────────────────────────────

  function getState() {
    // F19a: stamp the schema version at every write. The cloud-sync
    // engine isn't wired yet, but per-record stamping is the contract
    // that lets mixed-version devices safely share data later.
    // For future-schema records captured by loadState, emit the original
    // version verbatim so wire-format passthrough (snapshotForSync) does
    // not silently downgrade them; current/legacy records stamp to current.
    const out = {
      schemaVersion: _originalSchemaVersion ?? Schema.SCHEMA_VERSION,
      id, name, dose, frequency,
      lastTakenAt,
      updatedAt, deviceId,
      originDeviceId,
      doseLog: doseLog.slice(),
    };
    // F19b: merge __forward back into the wire format. The loader's
    // KNOWN_MED_KEYS filter guarantees the bag never contains a key that
    // collides with a known field, so a plain assign is safe.
    if (_forwardBag) Object.assign(out, _forwardBag);
    return out;
  }

  function loadState(state) {
    if (!state || typeof state !== 'object') return;

    // F19a: detect records minted on a newer schema. The engine still
    // loads them (so existing UI can show name/dose), but downstream
    // mutators (MedsManager.saveAll / .remove) consult this flag and
    // refuse — preserving the on-disk future record byte-clean for the
    // newer client to consume. Pre-F19a records (no schemaVersion) are
    // NOT future; they get stamped to v1 on their next save, lazily.
    _fromFutureSchema = Schema.isFutureRecord(state);
    // F19a: capture the exact on-disk schemaVersion for future records so
    // getState() emits it verbatim instead of downgrading to SCHEMA_VERSION.
    // Reset to null on every load so a subsequent loadState of a non-future
    // record properly forgets the prior captured value.
    _originalSchemaVersion = (_fromFutureSchema && typeof state.schemaVersion === 'number')
      ? state.schemaVersion
      : null;

    // F19b: collect unrecognized top-level fields into __forward so a
    // downlevel client doesn't strip future-schema data on roundtrip.
    // KNOWN_MED_KEYS includes V1 legacy fields too, so the bag stays
    // clean of intentionally-discarded migration cruft.
    _forwardBag = null;
    for (const key of Object.keys(state)) {
      if (!KNOWN_MED_KEYS.has(key)) {
        if (_forwardBag === null) _forwardBag = {};
        _forwardBag[key] = state[key];
      }
    }

    name = typeof state.name === 'string' ? state.name : 'Medication';
    dose = typeof state.dose === 'string' ? state.dose : '';

    // V2 frequency. F20: split absent vs present-but-unknown.
    // - Absent (no key / non-string / empty string) → default 'as-needed'.
    //   This is also the V1 migration path: legacy records had `scheduleType`
    //   / `intervalMs` / `times[]` but never `frequency`, so they land here.
    //   'as-needed' is the safest target — it doesn't manufacture a daily
    //   obligation for records the user never explicitly declared as daily.
    // - Present-but-unknown (any other non-empty string) → preserve verbatim.
    //   Forward-compat: a future schema might add 'three-times-daily' or
    //   similar; a V2 client must not silently rewrite values it doesn't
    //   recognize, or a roundtrip on this device would erase data minted on
    //   a newer one. Downstream (getExpectedDosesToday) returns null for
    //   unrecognized values, so display falls back to 'na' UX without
    //   corrupting storage.
    if (typeof state.frequency === 'string' && state.frequency.length > 0) {
      frequency = state.frequency;
    } else {
      frequency = 'as-needed';
    }

    lastTakenAt = typeof state.lastTakenAt === 'number' ? state.lastTakenAt : null;
    // F10: stamp legacy doseLog entries (no deviceId) with the local one so
    // (deviceId, takenAt) dedup has a populated tuple. Existing deviceIds
    // are preserved verbatim — sync-aware backups roundtrip cleanly.
    const localDevice = _medsGetDeviceId();
    doseLog = Array.isArray(state.doseLog)
      ? state.doseLog
          .filter(e => e && typeof e.takenAt === 'number')
          .map(e => ({
            takenAt: e.takenAt,
            deviceId: typeof e.deviceId === 'string' ? e.deviceId : localDevice,
          }))
          .sort((a, b) => a.takenAt - b.takenAt)
      : [];

    // Reconcile lastTakenAt with the log (the log is the source of truth).
    if (doseLog.length > 0) {
      lastTakenAt = doseLog[doseLog.length - 1].takenAt;
    } else {
      lastTakenAt = null;
    }

    // Clock-skew guard: if the freshest dose is far in the future (>1 min),
    // drop future entries. Preserves old data without misrepresenting "today".
    const now = Date.now();
    if (lastTakenAt !== null && lastTakenAt > now + 60000) {
      doseLog = doseLog.filter(e => e.takenAt <= now + 60000);
      lastTakenAt = doseLog.length > 0 ? doseLog[doseLog.length - 1].takenAt : null;
    }

    // F10: record-level stamp back-fill. Existing pre-F10 records lack both
    // fields — anchor `updatedAt` to lastTakenAt when available, otherwise
    // to now. `deviceId` falls back to the local device (pre-sync data is
    // single-origin by construction).
    updatedAt = typeof state.updatedAt === 'number'
      ? state.updatedAt
      : (lastTakenAt || Date.now());
    deviceId = typeof state.deviceId === 'string' ? state.deviceId : localDevice;
    // F17 (D-1): set-once-immutable provenance marker. Read guarded by
    // `!= null` so a re-load of a record that lacks the field (e.g. a
    // pre-reconcile snapshot) doesn't blow away the in-memory value.
    if (state.originDeviceId != null) originDeviceId = state.originDeviceId;
  }

  return {
    getId, getName, getDose, getFrequency,
    setName, setDose, setFrequency,
    getLastTakenAt, getDoseLog,
    getUpdatedAt, getDeviceId,
    isFromFutureSchema,
    logDose, undoLastDose,
    recomputeLastTakenAt,
    getTimeSinceLastDoseMs,
    getDosesToday, getExpectedDosesToday, getStatusToday,
    getState, loadState,
  };
}

// ── Multi-med manager (singleton, parallel to InstanceManager) ──────

const MedsManager = (() => {
  // F18: per-record persistence. Each med is its own localStorage key under
  // the `meds/{medId}` prefix. The old single-blob key (`wellness_meds`) is
  // migrated once on first loadAll and then deleted. Per-record persistence
  // is what unlocks per-field LWW for name/dose/frequency at the wire format
  // (see CLOUD-SYNC-STRATEGY.md — Row 1 of the per-store table).
  const STORAGE_PREFIX = 'meds/';
  const LEGACY_BLOB_KEY = 'wellness_meds';
  const MAX_MEDS = 10;
  let meds = [];

  function all()    { return meds.slice(); }
  function get(id)  { return meds.find(m => m.getId() === id) || null; }
  function count()  { return meds.length; }
  function canAdd() { return meds.length < MAX_MEDS; }
  // `clear` is in-memory only by design — loadAll restores from persistence.
  // Removing per-record keys is the explicit job of `remove(id)`.
  function clear()  { meds = []; }

  function add(config) {
    if (!canAdd()) return null;
    const id = 'med-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5);
    const m = createMed(id);
    if (config) {
      if (config.name) m.setName(config.name);
      if (config.dose !== undefined) m.setDose(config.dose);
      if (config.frequency) m.setFrequency(config.frequency);
    }
    meds.push(m);
    return m;
  }

  function remove(id) {
    // F19a: refuse to delete future-schema records. The downlevel client
    // may not understand semantics the newer client attached to the
    // record; deleting could lose data we can't represent. Returns false
    // (same shape as "id not found") so existing callers don't crash.
    const target = meds.find(m => m.getId() === id);
    if (target && target.isFromFutureSchema()) return false;

    const before = meds.length;
    meds = meds.filter(m => m.getId() !== id);
    const removed = meds.length < before;
    if (removed) {
      // Per-record model — orphan keys would leak forever without explicit
      // cleanup. The old blob model got this "for free" via overwrite.
      try { localStorage.removeItem(STORAGE_PREFIX + id); } catch (e) {}
    }
    return removed;
  }

  // One-shot migration from the F14-era single blob. Writes each med to its
  // own key, then deletes the source so it never runs again. Idempotent — a
  // restored backup of the old blob would re-trigger the migration on the
  // next load and converge to the same state.
  function _migrateLegacyBlob() {
    let raw;
    try { raw = localStorage.getItem(LEGACY_BLOB_KEY); } catch (e) { return; }
    if (!raw) return;
    try {
      const blob = JSON.parse(raw);
      if (blob && Array.isArray(blob.meds)) {
        for (const s of blob.meds) {
          if (s && s.id) {
            try { localStorage.setItem(STORAGE_PREFIX + s.id, JSON.stringify(s)); }
            catch (e) { /* skip on quota */ }
          }
        }
      }
    } catch (e) { /* corrupt blob — drop it below */ }
    try { localStorage.removeItem(LEGACY_BLOB_KEY); } catch (e) {}
  }

  function saveAll() {
    // F13: cross-store write gate. Default 'ready' preserves current
    // behavior. The `typeof` guard keeps the engine usable in test contexts
    // that don't load persistence.js.
    if (typeof SyncState !== 'undefined' && !SyncState.canWrite()) return;
    for (const m of meds) {
      // F19a: future-schema records keep their on-disk shape. Writing the
      // downlevel in-memory representation would strip fields this client
      // doesn't know about (the loader only restores fields it recognizes).
      if (m.isFromFutureSchema()) continue;
      try {
        localStorage.setItem(STORAGE_PREFIX + m.getId(), JSON.stringify(m.getState()));
      } catch (e) { /* quota or unavailable — keep going for other meds */ }
    }
  }

  function loadAll() {
    _migrateLegacyBlob();

    // Enumerate every meds/* key. Snapshot the key list first because
    // we're reading values within the loop and per-record persistence
    // means we won't mutate storage here, but defensive copies cost
    // nothing at MAX_MEDS scale.
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
      }
    } catch (e) { /* localStorage unavailable */ }

    meds = [];
    for (const k of keys) {
      try {
        const raw = localStorage.getItem(k);
        const state = raw ? JSON.parse(raw) : null;
        if (state && state.id) {
          const m = createMed(state.id);
          m.loadState(state);
          meds.push(m);
        }
      } catch (e) { /* corrupt entry — skip and let the next save overwrite */ }
    }
  }

  // F4: post-merge hook called by SyncEngine after a per-med doseLog merge
  // (steady-state) or full hydrate (Stage C). Re-derives lastTakenAt from
  // the merged log so cross-device convergence stays consistent. No-op if
  // the med isn't loaded — saveAll on the next user action will re-emit a
  // clean state.
  //
  // D-2: wired live. Looks up the med, calls recomputeLastTakenAt, persists
  // via saveAll (single-record persist via per-med localStorage write), and
  // emits an 'onMergeComplete' event on SyncEngine's bus so E-1's
  // steady-state merge loop + B-4's F15 ≥2-entry remote-arrival toast can
  // subscribe. F13 write gate: the caller (D-1 reconcile or E-1 merge loop)
  // is responsible for holding SyncState at 'hydrating' across the merge
  // cycle. We do not toggle SyncState here. The per-record save below is
  // gated by the standard saveAll → SyncState.canWrite() path; during a
  // reconcile this is a no-op (gate closed) and the caller's
  // _reconcileWriteRaw has already persisted the merged doseLog. During a
  // post-merge replay outside the gate, the user-action save wins.
  function onMergeComplete(medId) {
    const m = get(medId);
    if (!m) return;
    m.recomputeLastTakenAt();
    // Persist the recomputed lastTakenAt + (caller-assigned) doseLog. The
    // F13 write gate decides whether this actually touches disk; either
    // way the in-memory state is authoritative for any subsequent emit
    // subscriber that reads from MedsManager.get(medId).
    saveAll();
    // Emit via the existing SyncEngine event bus. Guarded by typeof so
    // engine-only unit tests that don't load sync-engine.js still pass.
    if (typeof SyncEngine !== 'undefined'
        && SyncEngine
        && typeof SyncEngine.emit === 'function') {
      try { SyncEngine.emit('onMergeComplete', { medId: medId }); }
      catch (e) { /* listener errors must not break the merge cycle */ }
    }
  }

  // D-2: per-med doseLog reconcile + cross-device clock-skew clamp.
  //
  // Pure helper. Returns a NEW array; does NOT mutate `med.doseLog`.
  // Caller assigns the result onto `med.doseLog` and persists.
  //
  // Algorithm (in order, per audit row for js/meds.js):
  //   0. F19a refuse-writeback gate. If Schema.isFutureRecord(med) is true,
  //      return the original med.doseLog unchanged. Do NOT throw — a
  //      downlevel client must not mutate a future-schema record's
  //      doseLog because the newer client may have attached semantics we
  //      don't understand.
  //   1. Union med.doseLog ∪ incomingEntries. Capture localNow = Date.now()
  //      ONCE at the top (not re-called inside the loop).
  //   2. F16 clamp: for each entry where entry.deviceId !== localDeviceId,
  //      drop if |entry.takenAt - localNow| > RECONCILE_WINDOW_MS. Push a
  //      structured warning; increment `dropped`. Same-device entries are
  //      NEVER clamped — the loadState clock-skew guard is the same-device
  //      analog at load time. Boundary is INCLUSIVE per Decision #4.
  //   3. Exact-match dedup by (deviceId, takenAt). Keep first occurrence;
  //      do NOT increment `collapsed` (this is noise, not a reconcile
  //      decision — exact duplicates are most likely a re-push of the same
  //      record from a transient retry).
  //   4. Sort ascending by takenAt.
  //   5. F1 walk: for each adjacent pair (a, b) where
  //      `b.takenAt - a.takenAt <= RECONCILE_WINDOW_MS`:
  //      - If a.deviceId === b.deviceId: PRESERVE both (Decision #1 —
  //        same-device duplicates are intentional re-doses).
  //      - Else: keep `a` + drop `b` + increment `collapsed`. Continue
  //        from `a` (do NOT advance past the kept entry) so a 3-entry
  //        cross-device cluster within 15min collapses correctly.
  //   6. F14 cap: if entries.length > 1000, drop OLDEST until length===1000
  //      (preserve the most recent dose history — the F14 contract).
  //
  // Per-entry try/catch wraps the clamp + dedup loops so a single bad
  // entry never aborts the merge cycle (Decision #3). The caller batches
  // result.warnings into a single console.warn after each merge cycle
  // (Decision #6 — console-only, no toast).
  //
  // F13 write gate: this helper is pure; it never writes. The caller
  // holds the gate. F10 record envelope (deviceId / updatedAt /
  // schemaVersion) is NOT touched here — that's the saveState path's job.
  function reconcileDoseLog(med, incomingEntries) {
    // F19a refuse-writeback. The med may be either a createMed() instance
    // (with .isFromFutureSchema()) or a wire-format plain object (with
    // .schemaVersion). Schema.isFutureRecord handles the wire-format case;
    // also honor the instance accessor when present.
    let isFuture = false;
    try {
      if (med && typeof med.isFromFutureSchema === 'function') {
        isFuture = med.isFromFutureSchema();
      } else if (typeof Schema !== 'undefined'
                 && typeof Schema.isFutureRecord === 'function') {
        isFuture = Schema.isFutureRecord(med);
      }
    } catch (e) { /* defensive — fall through to non-future path */ }
    if (isFuture) {
      // Surface the existing doseLog unchanged. Pull via the instance
      // accessor when available (returns a defensive copy); otherwise
      // copy the plain-object array.
      let existing;
      if (med && typeof med.getDoseLog === 'function') {
        existing = med.getDoseLog();
      } else if (med && Array.isArray(med.doseLog)) {
        existing = med.doseLog.slice();
      } else {
        existing = [];
      }
      return {
        entries: existing,
        dropped: 0,
        collapsed: 0,
        warnings: ['skipped: future-schema record'],
      };
    }

    // Capture localNow ONCE — avoids skew if Date.now() advances during a
    // long-running merge cycle (the clamp window would shift, producing
    // non-deterministic output).
    const localNow = Date.now();
    const localDeviceId = _medsGetDeviceId();

    // Source the existing doseLog. Instance accessor (defensive copy) is
    // preferred; fall back to direct array for plain-object meds.
    let existing;
    if (med && typeof med.getDoseLog === 'function') {
      existing = med.getDoseLog();
    } else if (med && Array.isArray(med.doseLog)) {
      existing = med.doseLog.slice();
    } else {
      existing = [];
    }
    const incoming = Array.isArray(incomingEntries) ? incomingEntries : [];

    const warnings = [];
    let dropped = 0;
    let collapsed = 0;

    // Step 1: union. We allocate a fresh array — never alias internal state.
    const union = existing.concat(incoming);

    // Step 2: F16 clamp (cross-device only) + drop malformed entries.
    // Per-entry try/catch (Decision #3): a single bad entry pushes a
    // warning and is dropped; the merge cycle continues.
    const clamped = [];
    for (let i = 0; i < union.length; i++) {
      const e = union[i];
      try {
        if (!e || typeof e.takenAt !== 'number' || !isFinite(e.takenAt)) {
          // Malformed entry — drop with a warning but don't count as
          // F16 dropped (that's the clock-skew counter specifically).
          warnings.push(
            '[MedsManager.reconcileDoseLog] dropped entry takenAt='
            + (e && e.takenAt) + ' deviceId=' + (e && e.deviceId)
            + ' reason=malformed localNow=' + localNow
          );
          continue;
        }
        const entryDeviceId = typeof e.deviceId === 'string' ? e.deviceId : null;
        // F16 applies only to non-local entries. Same-device far-future /
        // far-past values are handled by loadState's clock-skew guard at
        // load time (60-second future cutoff).
        if (entryDeviceId !== null && entryDeviceId !== localDeviceId) {
          const delta = e.takenAt - localNow;
          const absDelta = delta < 0 ? -delta : delta;
          // Decision #4: inclusive boundary. > (strict greater) means an
          // entry exactly at localNow ± RECONCILE_WINDOW_MS is kept.
          if (absDelta > RECONCILE_WINDOW_MS) {
            const reason = delta > 0 ? 'f16-future' : 'f16-past';
            warnings.push(
              '[MedsManager.reconcileDoseLog] dropped entry takenAt='
              + e.takenAt + ' deviceId=' + entryDeviceId
              + ' reason=' + reason + ' localNow=' + localNow
            );
            dropped++;
            continue;
          }
        }
        clamped.push(e);
      } catch (err) {
        warnings.push(
          '[MedsManager.reconcileDoseLog] dropped entry takenAt='
          + (e && e.takenAt) + ' deviceId=' + (e && e.deviceId)
          + ' reason=exception localNow=' + localNow
        );
      }
    }

    // Step 3: exact-match dedup by (deviceId, takenAt). Keep first
    // occurrence (preserve array order so a same-device duplicate from
    // `existing` survives over an `incoming` re-push). Does NOT increment
    // `collapsed` — exact-match dedup is noise, not a reconcile decision.
    const seen = new Set();
    const deduped = [];
    for (let i = 0; i < clamped.length; i++) {
      const e = clamped[i];
      try {
        const key = (e.deviceId == null ? '∅' : String(e.deviceId)) + '@' + e.takenAt;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(e);
      } catch (err) {
        // Per-entry safety net — see Decision #3.
        warnings.push(
          '[MedsManager.reconcileDoseLog] dropped entry takenAt='
          + (e && e.takenAt) + ' deviceId=' + (e && e.deviceId)
          + ' reason=dedup-exception localNow=' + localNow
        );
      }
    }

    // Step 4: sort ascending by takenAt. Stable sort isn't guaranteed in
    // all engines, but exact-match dedup already removed (deviceId, takenAt)
    // duplicates, so the ordering of equal-takenAt entries from different
    // devices is fine either way (downstream F1 will preserve same-device,
    // collapse cross-device — and an exact takenAt match cross-device is
    // legitimately a reconcile decision, not noise).
    deduped.sort((x, y) => x.takenAt - y.takenAt);

    // Step 5: F1 walk. continue-from-`a` rule handles 3-entry clusters
    // like A@t=0, B@t=5m, A@t=10m correctly: B collapses into A@t=0, then
    // the walk stays on A@t=0 and checks A@t=10m — same-device → preserve.
    const collapsedOut = [];
    let i = 0;
    while (i < deduped.length) {
      const a = deduped[i];
      collapsedOut.push(a);
      let j = i + 1;
      while (j < deduped.length) {
        const b = deduped[j];
        if (b.takenAt - a.takenAt > RECONCILE_WINDOW_MS) break;
        // Decision #1: same-device entries within ±15min are intentional
        // re-doses. Preserve both — and advance so future iterations can
        // still collapse `b`'s cross-device neighbours.
        if (a.deviceId === b.deviceId) {
          // Don't collapse — break the inner walk; the outer loop picks
          // up at `b` next iteration so we don't lose b's collapse window
          // against subsequent entries.
          break;
        }
        // Cross-device within window: keep `a`, drop `b`. Continue
        // checking subsequent entries against `a` (continue-from-`a`).
        collapsed++;
        j++;
      }
      // If we broke out at a same-device boundary, resume the outer loop
      // at `j` (so `b` is the next anchor). Otherwise `j` is past every
      // entry collapsed into `a`, and we advance to `j` too.
      i = j;
    }

    // Step 6: F14 cap. Drop OLDEST. The F14 contract preserves recent
    // dose history; trimming from the tail would discard the user's
    // most-recent doses, which is the opposite of intent.
    let final = collapsedOut;
    if (final.length > 1000) {
      final = final.slice(final.length - 1000);
    }

    return {
      entries: final,
      dropped: dropped,
      collapsed: collapsed,
      warnings: warnings,
    };
  }

  // B-1: read-only snapshot adapter for SyncEngine.getSnapshot().
  // Returns the per-store envelope { deviceId, schemaVersion, payload }
  // where `payload.meds` is the array of wire-format records. Defensive-
  // copy contract holds because:
  //   - `all()` returns `meds.slice()` — fresh array.
  //   - per-med `getState()` builds a fresh object literal and slices
  //     doseLog before returning (see line ~207 of this file).
  // So mutating the snapshot output never aliases internal state.
  //
  // No `Schema.stamp()` call here — inner records are already stamped at
  // write time per F19a, and the envelope's schemaVersion is the wrapper
  // version, not a per-record stamp.
  function snapshotForSync() {
    return {
      deviceId: History.getDeviceId(),
      schemaVersion: Schema.SCHEMA_VERSION,
      payload: {
        meds: all().map(m => m.getState()),
      },
    };
  }

  // C-1: privileged hydrate write path. Cloud is canonical during hydrate
  // — `_hydrateWriteRaw` writes directly to localStorage, bypassing the
  // `SyncState.canWrite()` gate that `saveAll` consults. The orchestrator
  // (SyncEngine.hydrateFromCloud) flips state to 'hydrating' BEFORE calling
  // any engine's hydrateFromCloud, so the gate is closed; this path is the
  // explicit, named exception. F19a: records are written verbatim — no
  // `Schema.stamp()` call, so a future-schema cloud record (schemaVersion=2)
  // lands on disk with its original version intact and loadAll() then
  // surfaces it as `_fromFutureSchema = true`.
  //
  // Accepts the raw `records` array (each entry is the cloud doc's `data`
  // field). Defensive-validates: an entry must be a non-null object with a
  // string `id` field. Malformed entries are skipped and counted; a single
  // batched warning is logged if any were dropped.
  function _hydrateWriteRaw(records) {
    if (!Array.isArray(records)) records = [];
    // First clear every existing meds/* key so a stale local record (e.g.
    // pre-existing default doesn't somehow shadow cloud) doesn't survive.
    // Stage D guard already runs upstream, so we know local was empty for
    // the audit's "empty hydrate target" contract — this clear is belt-and-
    // suspenders for the resume path (mid-failure rerun).
    try {
      const keysToClear = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(STORAGE_PREFIX)) keysToClear.push(k);
      }
      for (const k of keysToClear) {
        try { localStorage.removeItem(k); } catch (e) {}
      }
    } catch (e) { /* localStorage unavailable */ }

    let written = 0;
    let skipped = 0;
    for (const rec of records) {
      if (!rec || typeof rec !== 'object' || typeof rec.id !== 'string' || !rec.id) {
        skipped++;
        continue;
      }
      try {
        // Verbatim write — no Schema.stamp, no field allowlist. The cloud
        // record's schemaVersion (including future versions) survives onto
        // disk; loadAll then re-reads via the standard loader, which
        // populates _fromFutureSchema / _forwardBag correctly.
        localStorage.setItem(STORAGE_PREFIX + rec.id, JSON.stringify(rec));
        written++;
      } catch (e) {
        // Quota or unavailable — count as skipped so partial writes surface
        // up via the result count rather than silently succeeding.
        skipped++;
      }
    }
    if (skipped > 0) {
      try { console.warn('[MedsManager] hydrate skipped ' + skipped + ' malformed/un-writable record(s)'); }
      catch (e) {}
    }
    // Re-read disk into in-memory state. loadAll respects F19a (the loader
    // populates _fromFutureSchema for any record with schemaVersion > current).
    loadAll();
    return { written, skipped };
  }

  // Public hydrate entry point. Sync — no async work happens inside
  // (localStorage is synchronous). Returns the resolved promise to match
  // History.hydrateFromCloud's async signature so the orchestrator can
  // `await` uniformly across all four engines.
  function hydrateFromCloud(records) {
    if (!Array.isArray(records)) {
      return Promise.reject(new Error('hydrateFromCloud: records must be an array'));
    }
    const { written, skipped } = _hydrateWriteRaw(records);
    return Promise.resolve({ ok: true, count: written, skipped });
  }

  // D-1: privileged reconcile write path. Twin of `_hydrateWriteRaw`
  // (kept as a named pair for grep-clarity per the audit's "do not
  // unify" decision). The reconcile orchestrator has already (a) flipped
  // SyncState to 'hydrating', and (b) computed the merged cloud ∪
  // tagged-local snapshot. This path bypasses the `SyncState.canWrite()`
  // gate that `saveAll` consults.
  //
  // Caller intent differs from hydrate: hydrate writes a verbatim cloud
  // payload onto an empty-local target; reconcile writes the merged
  // tagged-local-∪-cloud payload, where the meds collision rule keeps
  // BOTH records (distinguished by `originDeviceId`). The wire shape is
  // identical (per-med localStorage keys under `meds/{medId}`), so the
  // clear-then-bulk-write algorithm is structurally the same.
  //
  // F19a: records are written verbatim — no `Schema.stamp()` call.
  // Future-schema cloud records keep their original schemaVersion on
  // disk; loadAll() re-reads them and the standard loader populates
  // `_fromFutureSchema` / `_forwardBag`.
  function _reconcileWriteRaw(records) {
    if (!Array.isArray(records)) records = [];
    // Clear every existing meds/* key. The reconcile orchestrator passes
    // the merged snapshot (tagged-local-∪-cloud) so a stale local record
    // not in the merge must not survive.
    try {
      const keysToClear = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(STORAGE_PREFIX)) keysToClear.push(k);
      }
      for (const k of keysToClear) {
        try { localStorage.removeItem(k); } catch (e) {}
      }
    } catch (e) { /* localStorage unavailable */ }

    let written = 0;
    let skipped = 0;
    for (const rec of records) {
      if (!rec || typeof rec !== 'object' || typeof rec.id !== 'string' || !rec.id) {
        skipped++;
        continue;
      }
      try {
        localStorage.setItem(STORAGE_PREFIX + rec.id, JSON.stringify(rec));
        written++;
      } catch (e) {
        skipped++;
      }
    }
    if (skipped > 0) {
      try { console.warn('[MedsManager] reconcile skipped ' + skipped + ' malformed/un-writable record(s)'); }
      catch (e) {}
    }
    loadAll();
    return { written, skipped };
  }

  return {
    all, get, count, canAdd, clear, add, remove, saveAll, loadAll,
    onMergeComplete,
    reconcileDoseLog,
    snapshotForSync,
    hydrateFromCloud,
    _hydrateWriteRaw,
    _reconcileWriteRaw,
    MAX_MEDS,
    // D-2: exposed for tests + E-1 call-site reuse. Module-scope const
    // is the source of truth; this is a read-only mirror.
    RECONCILE_WINDOW_MS: RECONCILE_WINDOW_MS,
  };
})();
