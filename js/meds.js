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

  function setName(n) {
    name = (n == null ? '' : String(n)).trim().slice(0, 60) || 'Medication';
    touch();
  }

  function setDose(d) {
    dose = (d == null ? '' : String(d)).trim().slice(0, 40);
    touch();
  }

  function setFrequency(f) {
    frequency = MED_FREQUENCIES.includes(f) ? f : 'once-daily';
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
    return {
      id, name, dose, frequency,
      lastTakenAt,
      updatedAt, deviceId,
      doseLog: doseLog.slice(),
    };
  }

  function loadState(state) {
    if (!state || typeof state !== 'object') return;

    name = typeof state.name === 'string' ? state.name : 'Medication';
    dose = typeof state.dose === 'string' ? state.dose : '';

    // V2 frequency. If missing, migrate from V1: legacy records had
    // `scheduleType`/`intervalMs`/`times[]` but never `frequency`.
    if (typeof state.frequency === 'string' && MED_FREQUENCIES.includes(state.frequency)) {
      frequency = state.frequency;
    } else {
      // Safe default: as-needed. Doesn't manufacture a daily obligation
      // for records the user never explicitly declared as daily.
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
    logDose, undoLastDose,
    getTimeSinceLastDoseMs,
    getDosesToday, getExpectedDosesToday, getStatusToday,
    getState, loadState,
  };
}

// ── Multi-med manager (singleton, parallel to InstanceManager) ──────

const MedsManager = (() => {
  const STORAGE_KEY = 'wellness_meds';
  const MAX_MEDS = 10;
  let meds = [];

  function all()    { return meds.slice(); }
  function get(id)  { return meds.find(m => m.getId() === id) || null; }
  function count()  { return meds.length; }
  function canAdd() { return meds.length < MAX_MEDS; }
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
    const before = meds.length;
    meds = meds.filter(m => m.getId() !== id);
    return meds.length < before;
  }

  function saveAll() {
    // F13: cross-store write gate. Default 'ready' preserves current
    // behavior. The `typeof` guard keeps the engine usable in test contexts
    // that don't load persistence.js.
    if (typeof SyncState !== 'undefined' && !SyncState.canWrite()) return;
    try {
      const state = { meds: meds.map(m => m.getState()) };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* localStorage unavailable or full */ }
  }

  function loadAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw);
      if (!state || !Array.isArray(state.meds)) return;
      meds = state.meds
        .filter(s => s && s.id)
        .map(s => {
          const m = createMed(s.id);
          m.loadState(s);
          return m;
        });
    } catch (e) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  return { all, get, count, canAdd, clear, add, remove, saveAll, loadAll, MAX_MEDS };
})();
