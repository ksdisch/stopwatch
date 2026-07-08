// R9 — BgNotifyStore: durable backing store for background notifications.
//
// The service worker schedules web notifications with an in-memory setTimeout
// + a `pendingNotifications` Map (sw.js). Both die when the browser evicts the
// idle SW, so a notification scheduled minutes out is silently lost. This
// module persists each pending notification to a dedicated IndexedDB
// (`tempo_notify_db`) so it survives eviction, and exposes a pure `plan()` that
// splits persisted records into "fire now" (overdue) vs "re-arm" (still
// upcoming) — the decision the SW replays every time it wakes.
//
// SW-safe by construction: it references only `indexedDB` and `self`, both of
// which exist in the ServiceWorkerGlobalScope AND on the page. sw.js pulls in
// the same bytes via `importScripts('./js/bg-notify-store.js')`; the engine
// test harness loads it as a page <script>. Native iOS never touches this —
// Platform.scheduleNotification hands native schedules to the OS, which fires
// them even while the WebView is suspended.
//
// Record shape: { id, fireAt, title, body } — keyPath 'id'.

const BgNotifyStore = (() => {

  const DB_NAME = 'tempo_notify_db';
  const DB_VERSION = 1;
  const STORE_NAME = 'pending_notifications';

  // Cached connection. Opens lazily on first put/remove/all.
  let _dbCache = null;

  // ── Pure planning ──────────────────────────────────────────────────────

  // Split persisted records against `now`:
  //   fire: overdue (fireAt <= now) OR malformed (non-finite fireAt — fired
  //         rather than silently lost); the record is returned intact to show.
  //   arm:  still upcoming — { record, delayMs } with delayMs = fireAt - now
  //         (always > 0). The SW re-creates a setTimeout for each.
  function plan(records, now) {
    const fire = [];
    const arm = [];
    const list = Array.isArray(records) ? records : [];
    for (const rec of list) {
      if (!rec) continue;
      const fireAt = Number(rec.fireAt);
      if (!Number.isFinite(fireAt) || fireAt <= now) {
        fire.push(rec);
      } else {
        arm.push({ record: rec, delayMs: fireAt - now });
      }
    }
    return { fire, arm };
  }

  // ── IndexedDB (lazy, cached) ───────────────────────────────────────────

  function _idbAvailable() {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  }

  function _open() {
    if (_dbCache) return Promise.resolve(_dbCache);
    if (!_idbAvailable()) {
      return Promise.reject(new Error('indexedDB unavailable'));
    }
    return new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = function (event) {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () {
        _dbCache = req.result;
        // Defensive: on version-change from another tab / a test's
        // deleteDatabase, drop the cache so the next call re-opens fresh.
        try {
          _dbCache.onversionchange = function () {
            try { _dbCache.close(); } catch (_) {}
            _dbCache = null;
          };
        } catch (_) {}
        resolve(_dbCache);
      };
      req.onerror = function () {
        reject(req.error || new Error('indexedDB open failed'));
      };
      req.onblocked = function () {
        reject(new Error('indexedDB open blocked'));
      };
    });
  }

  function _wrapReq(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IDB request failed'));
    });
  }

  // Persist one pending notification. keyPath 'id' → re-putting the same id
  // overwrites (replace semantics — matches the SW's "cancel existing then
  // reschedule" for a re-armed timer id).
  async function put(record) {
    const db = await _open();
    const store = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);
    await _wrapReq(store.put(record));
  }

  // Delete by id. A missing id resolves without error (delete is a no-op).
  async function remove(id) {
    const db = await _open();
    const store = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);
    await _wrapReq(store.delete(id));
  }

  // All persisted records (order unspecified — callers use plan()).
  async function all() {
    const db = await _open();
    const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
    return await _wrapReq(store.getAll());
  }

  return { plan, put, remove, all, _open };
})();

// Expose on the global object (self === window on a page,
// ServiceWorkerGlobalScope in the SW) so both `importScripts` and page
// <script> consumers reach it.
if (typeof self !== 'undefined') {
  self.BgNotifyStore = BgNotifyStore;
}
