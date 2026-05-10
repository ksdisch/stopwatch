const History = (() => {
  const DB_NAME = 'stopwatch_history_db';
  const STORE_NAME = 'sessions';
  const DB_VERSION = 1;
  const LEGACY_KEY = 'stopwatch_history';
  const DEVICE_ID_KEY = 'tempo_device_id';

  let db = null;
  let initPromise = null;
  let _deviceId = null;
  let _idCounter = 0;

  // Persistent device ID (UUID v4). Generated on first launch and stored in
  // localStorage. Used as a stable per-device prefix for session IDs so
  // cross-device sync can dedup without collisions. F10 will reuse it.
  function getDeviceId() {
    if (_deviceId) return _deviceId;
    let id = null;
    try { id = localStorage.getItem(DEVICE_ID_KEY); } catch (e) {}
    if (!id) {
      id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        // Fallback only fires in browsers without crypto.randomUUID (very rare
        // today). Keeps the deviceId shape distinct from numeric legacy IDs.
        : 'd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11);
      try { localStorage.setItem(DEVICE_ID_KEY, id); } catch (e) {}
    }
    _deviceId = id;
    return id;
  }

  function generateSessionId() {
    return `${getDeviceId()}-${Date.now()}-${_idCounter++}`;
  }

  // Pre-F2 IDs were bare `Date.now()` numbers; JSON import paths can surface
  // them as numeric strings. Anything else is already-migrated.
  function isLegacyId(id) {
    if (typeof id === 'number') return true;
    if (typeof id === 'string' && /^\d+$/.test(id)) return true;
    return false;
  }

  // F13: consult the cross-store write gate before persisting. Defaults open
  // ('ready') so behavior is unchanged today. The `typeof` guard keeps the
  // engine usable in test contexts that don't load persistence.js.
  function canWrite() {
    return typeof SyncState === 'undefined' || SyncState.canWrite();
  }

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

  // Rewrite legacy `Date.now()` IDs to `${deviceId}-${Date.now()}-${counter}`.
  // Cross-device sync (and the existing JSON export/import path) needs
  // collision-resistant keys. Idempotent — already-migrated rows are skipped.
  // Each rewritten row preserves its original id as `legacyId` so Stage D
  // sync reconcile can pair pre-migration records across devices. Uses IDB
  // delete+put because keyPath: 'id' makes in-place mutation impossible.
  function migrateSessionIds() {
    return new Promise((resolve) => {
      try {
        const readTx = db.transaction(STORE_NAME, 'readonly');
        const req = readTx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => {
          const sessions = req.result || [];
          const toMigrate = sessions.filter(s => isLegacyId(s.id));
          if (toMigrate.length === 0) { resolve(); return; }

          const writeTx = db.transaction(STORE_NAME, 'readwrite');
          const store = writeTx.objectStore(STORE_NAME);
          for (const s of toMigrate) {
            const legacyId = typeof s.id === 'string' ? Number(s.id) : s.id;
            store.delete(s.id);
            // F19a: stamp the rewritten row. Schema.stamp is a no-op if
            // the row already carries a future schemaVersion (defensive —
            // legacy rows here predate F19a so this is a fresh stamp in
            // practice).
            store.put(Schema.stamp({ ...s, id: generateSessionId(), legacyId }));
          }
          writeTx.oncomplete = () => resolve();
          writeTx.onerror = () => resolve();
        };
        req.onerror = () => resolve();
      } catch (e) { resolve(); }
    });
  }

  // Stage B back-fill (F10): rows that pre-date stamping lack `deviceId` and
  // `updatedAt`. Stamp them once so cross-device LWW has a baseline. Idempotent
  // — rows that already carry both fields are skipped. Per spec, fallback
  // formula is `sessionEndedAt || date || Date.now()`.
  function backfillMetadata() {
    return new Promise((resolve) => {
      try {
        const readTx = db.transaction(STORE_NAME, 'readonly');
        const req = readTx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => {
          const sessions = req.result || [];
          // F19a: also backfill schemaVersion on rows that lack it. Pre-F19a
          // rows have no schemaVersion; Schema.stamp sets it to 1. Future
          // rows (schemaVersion > 1) won't appear in this filter because
          // they already carry the field — and even if they slipped through,
          // Schema.stamp refuses to downgrade.
          const toStamp = sessions.filter(s =>
            s.updatedAt == null || s.deviceId == null || s.schemaVersion == null
          );
          if (toStamp.length === 0) { resolve(); return; }

          const writeTx = db.transaction(STORE_NAME, 'readwrite');
          const store = writeTx.objectStore(STORE_NAME);
          for (const s of toStamp) {
            const updatedAt = s.updatedAt
              || s.sessionEndedAt
              || (s.date ? Date.parse(s.date) : 0)
              || Date.now();
            const deviceId = s.deviceId || getDeviceId();
            store.put(Schema.stamp({ ...s, deviceId, updatedAt }));
          }
          writeTx.oncomplete = () => resolve();
          writeTx.onerror = () => resolve();
        };
        req.onerror = () => resolve();
      } catch (e) { resolve(); }
    });
  }

  function init() {
    initPromise = (async () => {
      await open();
      // Mint deviceId on first launch (per strategy doc), not lazily on first
      // save. Guarantees the localStorage key exists before any user gesture.
      getDeviceId();
      await migrate();
      await migrateSessionIds();
      await backfillMetadata();
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
    if (!canWrite()) return null;
    // If a caller hands us an id, only trust it when it's already in the new
    // shape (non-numeric string). Numeric / numeric-string ids are legacy —
    // assign a fresh id and stash the original under `legacyId` so JSON
    // backups roundtrip cleanly through this path.
    const providedId = session.id;
    const useProvidedId = typeof providedId === 'string' && !isLegacyId(providedId);
    const entry = {
      // F19a: stamp schemaVersion at write. Preserve a caller-provided
      // future schemaVersion (e.g. JSON import from a newer client) so the
      // record roundtrips cleanly; otherwise stamp to the current version.
      schemaVersion: Schema.isFutureRecord(session)
        ? session.schemaVersion
        : Schema.SCHEMA_VERSION,
      id: useProvidedId ? providedId : generateSessionId(),
      // F10: deviceId + updatedAt support per-field LWW for mutable fields
      // (note, tags). Preserve caller-provided values so JSON imports keep
      // their original stamps.
      deviceId: session.deviceId || getDeviceId(),
      updatedAt: session.updatedAt || Date.now(),
      date: session.date || new Date().toISOString(),
      type: session.type || 'stopwatch',
      duration: session.duration || 0,
      laps: session.laps || [],
      note: session.note || '',
      tags: session.tags || [],
    };
    if (session.legacyId !== undefined) {
      entry.legacyId = session.legacyId;
    } else if (!useProvidedId && providedId !== undefined && isLegacyId(providedId)) {
      entry.legacyId = typeof providedId === 'string' ? Number(providedId) : providedId;
    }
    // Pomodoro-specific metadata
    if (session.completedCycles !== undefined) entry.completedCycles = session.completedCycles;
    if (session.totalWorkMs !== undefined) entry.totalWorkMs = session.totalWorkMs;
    if (session.focusGoals) entry.focusGoals = session.focusGoals;
    if (session.breakTasks) entry.breakTasks = session.breakTasks;
    if (session.actualWork) entry.actualWork = session.actualWork;
    if (session.sessionStartedAt) entry.sessionStartedAt = session.sessionStartedAt;
    if (session.sessionEndedAt) entry.sessionEndedAt = session.sessionEndedAt;
    if (session.phaseLog) entry.phaseLog = session.phaseLog;
    if (session.distractions) entry.distractions = session.distractions;
    // Flow-block specific metadata
    if (session.goal) entry.goal = session.goal;
    if (session.blockDurationMs !== undefined) entry.blockDurationMs = session.blockDurationMs;
    if (session.preBlockSkipped !== undefined) entry.preBlockSkipped = session.preBlockSkipped;
    if (session.endedEarly !== undefined) entry.endedEarly = session.endedEarly;
    if (session.bfrbs) entry.bfrbs = session.bfrbs;
    // Interval / Exercise metadata
    if (session.programName) entry.programName = session.programName;
    // Countdown overshoot (Timer / Pomodoro / Flow / Interval). Optional;
    // pre-existing rows lack the field and the badge guards on > 0.
    if (session.overshootMs !== undefined) entry.overshootMs = session.overshootMs;

    return new Promise((resolve, reject) => {
      const store = getStore('readwrite');
      const req = store.put(entry);
      req.onsuccess = () => resolve(entry);
      req.onerror = () => reject(req.error);
    });
  }

  async function updateNote(id, note) {
    await ready();
    if (!canWrite()) return;
    const session = await getSession(id);
    if (!session) return;
    // F19a: refuse to overwrite future-schema records. A downlevel client
    // would strip fields it doesn't recognize on writeback. Silent no-op
    // so existing callers don't change behavior on normal records.
    if (Schema.isFutureRecord(session)) return;
    session.note = note;
    session.updatedAt = Date.now();
    session.deviceId = getDeviceId();
    Schema.stamp(session);
    return new Promise((resolve, reject) => {
      const store = getStore('readwrite');
      const req = store.put(session);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteSession(id) {
    await ready();
    if (!canWrite()) return;
    // F19a: refuse to delete future-schema records. The downlevel client
    // may not understand the record's semantics on the newer schema, so
    // deleting it could lose data we can't represent. Silent no-op.
    const existing = await getSession(id);
    if (existing && Schema.isFutureRecord(existing)) return;
    return new Promise((resolve, reject) => {
      const store = getStore('readwrite');
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function addTag(sessionId, tag) {
    await ready();
    if (!canWrite()) return;
    const session = await getSession(sessionId);
    if (!session) return;
    // F19a: refuse to overwrite future-schema records (see updateNote).
    if (Schema.isFutureRecord(session)) return;
    if (!Array.isArray(session.tags)) session.tags = [];
    const normalized = tag.trim().toLowerCase();
    if (normalized && !session.tags.includes(normalized)) {
      session.tags.push(normalized);
      session.updatedAt = Date.now();
      session.deviceId = getDeviceId();
      Schema.stamp(session);
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
    if (!canWrite()) return;
    const session = await getSession(sessionId);
    if (!session || !Array.isArray(session.tags)) return;
    // F19a: refuse to overwrite future-schema records (see updateNote).
    if (Schema.isFutureRecord(session)) return;
    session.tags = session.tags.filter(t => t !== tag);
    session.updatedAt = Date.now();
    session.deviceId = getDeviceId();
    Schema.stamp(session);
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
    if (!canWrite()) return;
    return new Promise((resolve, reject) => {
      const store = getStore('readwrite');
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  return { init, getSessions, addSession, updateNote, deleteSession, clearAll, addTag, removeTag, getAllTags, getDeviceId };
})();
