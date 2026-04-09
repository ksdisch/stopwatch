const History = (() => {
  const DB_NAME = 'stopwatch_history_db';
  const STORE_NAME = 'sessions';
  const DB_VERSION = 1;
  const LEGACY_KEY = 'stopwatch_history';

  let db = null;
  let initPromise = null;

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => {
        db = e.target.result;
        resolve(db);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function migrate() {
    return new Promise((resolve) => {
      try {
        const raw = localStorage.getItem(LEGACY_KEY);
        if (!raw) { resolve(); return; }
        const sessions = JSON.parse(raw);
        if (!Array.isArray(sessions) || sessions.length === 0) {
          localStorage.removeItem(LEGACY_KEY);
          resolve();
          return;
        }
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        sessions.forEach(s => store.put(s));
        tx.oncomplete = () => {
          localStorage.removeItem(LEGACY_KEY);
          resolve();
        };
        tx.onerror = () => {
          // Migration failed — leave localStorage intact for retry
          resolve();
        };
      } catch (e) {
        resolve();
      }
    });
  }

  function init() {
    initPromise = (async () => {
      await open();
      await migrate();
    })();
    return initPromise;
  }

  async function ready() {
    if (!initPromise) init();
    await initPromise;
  }

  function getStore(mode) {
    const tx = db.transaction(STORE_NAME, mode);
    return tx.objectStore(STORE_NAME);
  }

  async function getSessions() {
    await ready();
    return new Promise((resolve, reject) => {
      const store = getStore('readonly');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function getSession(id) {
    await ready();
    return new Promise((resolve, reject) => {
      const store = getStore('readonly');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function addSession(session) {
    await ready();
    const entry = {
      id: session.id || Date.now(),
      date: session.date || new Date().toISOString(),
      type: session.type || 'stopwatch',
      duration: session.duration || 0,
      laps: session.laps || [],
      note: session.note || '',
      tags: session.tags || [],
    };
    // Pomodoro-specific metadata
    if (session.completedCycles !== undefined) entry.completedCycles = session.completedCycles;
    if (session.totalWorkMs !== undefined) entry.totalWorkMs = session.totalWorkMs;
    if (session.focusGoals) entry.focusGoals = session.focusGoals;
    if (session.breakTasks) entry.breakTasks = session.breakTasks;
    if (session.actualWork) entry.actualWork = session.actualWork;
    if (session.sessionStartedAt) entry.sessionStartedAt = session.sessionStartedAt;
    if (session.sessionEndedAt) entry.sessionEndedAt = session.sessionEndedAt;
    if (session.phaseLog) entry.phaseLog = session.phaseLog;

    return new Promise((resolve, reject) => {
      const store = getStore('readwrite');
      const req = store.put(entry);
      req.onsuccess = () => resolve(entry);
      req.onerror = () => reject(req.error);
    });
  }

  async function updateNote(id, note) {
    await ready();
    const session = await getSession(id);
    if (!session) return;
    session.note = note;
    return new Promise((resolve, reject) => {
      const store = getStore('readwrite');
      const req = store.put(session);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteSession(id) {
    await ready();
    return new Promise((resolve, reject) => {
      const store = getStore('readwrite');
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function addTag(sessionId, tag) {
    await ready();
    const session = await getSession(sessionId);
    if (!session) return;
    if (!Array.isArray(session.tags)) session.tags = [];
    const normalized = tag.trim().toLowerCase();
    if (normalized && !session.tags.includes(normalized)) {
      session.tags.push(normalized);
      return new Promise((resolve, reject) => {
        const store = getStore('readwrite');
        const req = store.put(session);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }
  }

  async function removeTag(sessionId, tag) {
    await ready();
    const session = await getSession(sessionId);
    if (!session || !Array.isArray(session.tags)) return;
    session.tags = session.tags.filter(t => t !== tag);
    return new Promise((resolve, reject) => {
      const store = getStore('readwrite');
      const req = store.put(session);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllTags() {
    await ready();
    const sessions = await getSessions();
    const tagSet = new Set();
    sessions.forEach(s => {
      if (Array.isArray(s.tags)) {
        s.tags.forEach(t => tagSet.add(t));
      }
    });
    return Array.from(tagSet).sort();
  }

  async function clearAll() {
    await ready();
    return new Promise((resolve, reject) => {
      const store = getStore('readwrite');
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  return { init, getSessions, addSession, updateNote, deleteSession, clearAll, addTag, removeTag, getAllTags };
})();
