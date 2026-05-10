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
  // F19a: set by loadState when the on-disk record was minted on a newer
  // schema (state.schemaVersion > SCHEMA_VERSION). MedsManager.saveAll
  // and .remove consult this flag and refuse the operation, leaving the
  // future record on disk byte-clean for the newer client to consume.
  let _fromFutureSchema = false;

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
    return {
      schemaVersion: Schema.SCHEMA_VERSION,
      id, name, dose, frequency,
      lastTakenAt,
      updatedAt, deviceId,
      doseLog: doseLog.slice(),
    };
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
  }

  return {
    getId, getName, getDose, getFrequency,
    setName, setDose, setFrequency,
    getLastTakenAt, getDoseLog,
    getUpdatedAt, getDeviceId,
    isFromFutureSchema,
    logDose, undoLastDose,
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

  return { all, get, count, canAdd, clear, add, remove, saveAll, loadAll, MAX_MEDS };
})();
