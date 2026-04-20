// Medications engine — dose tracking with two schedule types:
//   - interval: every N hours after the last dose
//   - times:    fixed local-time slots (e.g. 08:00, 20:00)
//
// Each medication is a factory-created object. MedsManager is the
// singleton that holds them, handles add/remove/persist, and is the API
// surface used by meds-ui.js and app.js.
//
// Storage key: wellness_meds (single JSON blob, same pattern as
// multi_state used by InstanceManager).

function createMed(id) {
  let name = 'Medication';
  let scheduleType = 'interval';                 // 'interval' | 'times'
  let intervalMs = 6 * 60 * 60 * 1000;           // default every 6h
  let times = [];                                 // HH:MM local strings
  let lastTakenAt = null;                         // ms timestamp or null
  let doseLog = [];                               // [{ takenAt }]
  let notificationsEnabled = true;
  let dueNotified = false;                        // reset on each logDose

  function getId()    { return id; }
  function getName()  { return name; }
  function setName(n) { name = (n || 'Medication').toString().slice(0, 60); }

  function getScheduleType() { return scheduleType; }
  function getIntervalMs()   { return intervalMs; }
  function getTimes()        { return times.slice(); }

  function setIntervalSchedule(ms) {
    scheduleType = 'interval';
    intervalMs = Math.max(60000, Math.floor(ms) || 0);
    dueNotified = false;
  }

  function setTimesSchedule(hhmmList) {
    scheduleType = 'times';
    times = (hhmmList || [])
      .filter(s => typeof s === 'string' && /^\d{1,2}:\d{2}$/.test(s.trim()))
      .map(s => {
        const [h, m] = s.trim().split(':').map(n => parseInt(n, 10));
        const hh = String(Math.max(0, Math.min(23, h))).padStart(2, '0');
        const mm = String(Math.max(0, Math.min(59, m))).padStart(2, '0');
        return `${hh}:${mm}`;
      })
      .sort();
    dueNotified = false;
  }

  function getLastTakenAt() { return lastTakenAt; }
  function getDoseLog()     { return doseLog.slice(); }

  function getNotificationsEnabled()  { return notificationsEnabled; }
  function setNotificationsEnabled(b) { notificationsEnabled = !!b; dueNotified = false; }

  function logDose(takenAt) {
    const when = typeof takenAt === 'number' && !isNaN(takenAt)
      ? takenAt
      : Date.now();
    lastTakenAt = when;
    doseLog.push({ takenAt: when });
    if (doseLog.length > 100) doseLog.splice(0, doseLog.length - 100);
    dueNotified = false;
  }

  function undoLastDose() {
    if (doseLog.length === 0) return false;
    doseLog.pop();
    lastTakenAt = doseLog.length > 0 ? doseLog[doseLog.length - 1].takenAt : null;
    dueNotified = false;
    return true;
  }

  // ── Schedule math ───────────────────────────────────────────────────

  function getNextDoseAt() {
    if (scheduleType === 'interval') {
      // No dose yet → due immediately so the user can log right away.
      if (lastTakenAt === null) return Date.now();
      return lastTakenAt + intervalMs;
    }
    // scheduleType === 'times'
    if (times.length === 0) return null;
    const ref = lastTakenAt !== null ? lastTakenAt : Date.now() - 1;
    return getNextScheduledTimeAfter(ref);
  }

  function getNextScheduledTimeAfter(referenceMs) {
    // Find the next HH:MM slot strictly after referenceMs, in local time.
    // Walks today and tomorrow — if nothing matches, returns null (shouldn't
    // happen because the list is sorted and tomorrow's first slot is always
    // later than any reference).
    const ref = new Date(referenceMs);
    for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
      for (const t of times) {
        const [h, m] = t.split(':').map(Number);
        const candidate = new Date(
          ref.getFullYear(), ref.getMonth(), ref.getDate() + dayOffset,
          h, m, 0, 0
        );
        if (candidate.getTime() > referenceMs) return candidate.getTime();
      }
    }
    return null;
  }

  function getTimeUntilNextDoseMs() {
    const next = getNextDoseAt();
    if (next === null) return null;
    return next - Date.now();
  }

  function getTimeSinceLastDoseMs() {
    if (lastTakenAt === null) return null;
    return Date.now() - lastTakenAt;
  }

  function isDue() {
    const untilNext = getTimeUntilNextDoseMs();
    return untilNext !== null && untilNext <= 0;
  }

  function shouldFireDueNotification() {
    return notificationsEnabled && !dueNotified && isDue();
  }

  function markDueNotified() { dueNotified = true; }

  // ── Serialization ───────────────────────────────────────────────────

  function getState() {
    return {
      id, name, scheduleType, intervalMs,
      times: times.slice(),
      lastTakenAt,
      doseLog: doseLog.slice(),
      notificationsEnabled, dueNotified,
    };
  }

  function loadState(state) {
    if (!state) return;
    name = typeof state.name === 'string' ? state.name : 'Medication';
    scheduleType = state.scheduleType === 'times' ? 'times' : 'interval';
    intervalMs = typeof state.intervalMs === 'number' && state.intervalMs > 0
      ? state.intervalMs : (6 * 60 * 60 * 1000);
    times = Array.isArray(state.times) ? state.times.slice() : [];
    lastTakenAt = typeof state.lastTakenAt === 'number' ? state.lastTakenAt : null;
    doseLog = Array.isArray(state.doseLog) ? state.doseLog.slice() : [];
    notificationsEnabled = state.notificationsEnabled !== false;
    dueNotified = !!state.dueNotified;

    // Clock-skew guard: lastTakenAt in the far future makes no sense.
    if (lastTakenAt !== null && lastTakenAt > Date.now() + 60000) {
      lastTakenAt = null;
    }
  }

  return {
    getId, getName, setName,
    getScheduleType, getIntervalMs, getTimes,
    setIntervalSchedule, setTimesSchedule,
    getLastTakenAt, getDoseLog,
    getNotificationsEnabled, setNotificationsEnabled,
    logDose, undoLastDose,
    getNextDoseAt, getTimeUntilNextDoseMs, getTimeSinceLastDoseMs,
    isDue, shouldFireDueNotification, markDueNotified,
    getState, loadState,
  };
}

// ── Multi-med manager (singleton, parallel to InstanceManager) ──────

const MedsManager = (() => {
  const STORAGE_KEY = 'wellness_meds';
  const MAX_MEDS = 10;
  let meds = [];

  function all()     { return meds.slice(); }
  function get(id)   { return meds.find(m => m.getId() === id) || null; }
  function count()   { return meds.length; }
  function canAdd()  { return meds.length < MAX_MEDS; }
  function clear()   { meds = []; }

  function add(config) {
    if (!canAdd()) return null;
    const id = 'med-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5);
    const m = createMed(id);
    if (config) {
      if (config.name) m.setName(config.name);
      if (config.scheduleType === 'times' && Array.isArray(config.times)) {
        m.setTimesSchedule(config.times);
      } else if (typeof config.intervalMs === 'number') {
        m.setIntervalSchedule(config.intervalMs);
      }
      if (config.notificationsEnabled === false) m.setNotificationsEnabled(false);
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
