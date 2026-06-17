// bl-2-todoist: Todoist REST v2 client + offline write queue.
//
// Pure data + network module — NO DOM. Exposes `window.Todoist`.
// Used by `js/todoist-ui.js` (settings drawer panel + shared picker modal)
// and `js/pomodoro-ui.js` (saved-tasks integration). Designed for reuse by
// the deferred Flow follow-up PR — no Pomodoro-specific code here.
//
// **V1 write surface (this PR ships THREE methods only)**:
//   - closeTask(id)   → POST /tasks/{id}/close   (idempotent)
//   - reopenTask(id)  → POST /tasks/{id}/reopen  (idempotent)
//   - createTask({ content, project_id? })
//                      → POST /tasks            (returns new Todoist id)
//
// **updateTask(id, { content })** — added in follow-up B (rename write-
//   back). POST /tasks/{id} body `{ content }`; idempotent.
//
// **Explicitly NOT on the public surface (per the audit's sign-off
// checklist + brief Hard rules #1 + #2):**
//   - `Todoist.deleteTask` — delete in Tempo NEVER deletes in Todoist.
//     This is a one-way hard guard; a misclick in Tempo must not nuke the
//     user's real task list. There is no client method for it at all.
//
// **Offline queue** — `todoist_pending_ops` (localStorage JSON array,
// capacity 200, FIFO eviction at cap). Queue ops: `{ id, kind, payload,
// enqueuedAt }` where `kind ∈ {'close', 'reopen', 'create', 'update'}`.
// Auto-enqueue when `navigator.onLine === false` OR
// when `fetch` throws. Auto-drain on the `online` event + on
// `visibilitychange:visible`. Drain branching:
//   - 2xx → remove from queue (success).
//   - 4xx → remove from queue + console.warn (permanent: bad token,
//           deleted project, etc.). Retrying won't help.
//   - 5xx → leave in queue for next drain (transient server fault).
//   - fetch throws → leave in queue (network problem).
//
// **Error normalization** — every public async method returns one of:
//   - `{ ok: true, data?, queued? }` — success or successful enqueue.
//   - `{ ok: false, status?, message, isRetryable }` — failure.
// Callers branch on `ok`. Methods NEVER throw.
//
// **Token / settings storage** — all in localStorage, all device-local:
//   - `todoist_api_token`            — Bearer token (NOT synced, NOT
//                                      exported via Export/Backup).
//   - `todoist_default_project_id`   — default project for create ops.
//   - `todoist_default_filter`       — default filter for getTasks (e.g.
//                                      `today`, `today | overdue`).
//   - `todoist_pending_ops`          — queue JSON array (200-op cap).
//
// **Rate limit awareness** — Todoist allows 1000 req / 15 min / token.
// No polling in this client. Drain triggers are user-action-driven only
// (`online` + `visibilitychange:visible`). The settings drawer's "Test
// connection" + the picker modal's on-open fetch are explicit one-shots.
//
// **Cross-device design** — the token is device-local. Two devices
// sharing the same Todoist account reconcile against Todoist itself
// (the source of truth for tasks), NOT against each other. Token is
// excluded from `EXPORT_SETTINGS_KEYS` in `js/export.js` so it cannot
// leak via the full-data JSON export.

const Todoist = (() => {

  const BASE_URL = 'https://api.todoist.com/rest/v2';
  const QUEUE_CAP = 200;

  const STORAGE_KEYS = {
    token: 'todoist_api_token',
    defaultProjectId: 'todoist_default_project_id',
    defaultFilter: 'todoist_default_filter',
    pendingOps: 'todoist_pending_ops',
  };

  // In-memory queue cache, lazily hydrated from localStorage on first
  // access. `_resetForTests` clears this cache (but NOT the localStorage
  // entry — tests must clear localStorage themselves for a clean slate).
  let _queueCache = null;

  // Bind-once latch for the `online` + `visibilitychange` listeners.
  // Tests reset this via `_resetForTests` so re-init doesn't double-bind.
  let _listenersBound = false;

  // Monotonic queue-id counter. Local correlation id, NOT the Todoist
  // server id. Used so the UI can match a `todoist:create-resolved`
  // event back to the local task entry that triggered the queued create.
  let _opIdCounter = 1;

  // ── Token management ──────────────────────────────────────────────────

  function getToken() {
    try {
      const t = localStorage.getItem(STORAGE_KEYS.token);
      return (typeof t === 'string' && t.length > 0) ? t : null;
    } catch (_) {
      return null;
    }
  }

  function setToken(token) {
    try {
      if (token && typeof token === 'string') {
        localStorage.setItem(STORAGE_KEYS.token, token);
      } else {
        localStorage.removeItem(STORAGE_KEYS.token);
      }
    } catch (_) {}
  }

  function clearToken() {
    try { localStorage.removeItem(STORAGE_KEYS.token); } catch (_) {}
  }

  function hasToken() {
    return getToken() !== null;
  }

  // ── Config getters/setters ────────────────────────────────────────────

  function getDefaultProjectId() {
    try {
      const v = localStorage.getItem(STORAGE_KEYS.defaultProjectId);
      return (typeof v === 'string' && v.length > 0) ? v : null;
    } catch (_) {
      return null;
    }
  }

  function setDefaultProjectId(id) {
    try {
      if (id && typeof id === 'string') {
        localStorage.setItem(STORAGE_KEYS.defaultProjectId, id);
      } else {
        localStorage.removeItem(STORAGE_KEYS.defaultProjectId);
      }
    } catch (_) {}
  }

  function getDefaultFilter() {
    try {
      const v = localStorage.getItem(STORAGE_KEYS.defaultFilter);
      // Default to 'today' on first read. We do NOT auto-persist the
      // default — the user only writes to localStorage when they
      // explicitly set a filter via the settings drawer. This keeps
      // first-read transparent and means clearing localStorage restores
      // the default cleanly.
      if (typeof v === 'string' && v.length > 0) return v;
      return 'today';
    } catch (_) {
      return 'today';
    }
  }

  function setDefaultFilter(filter) {
    try {
      if (filter && typeof filter === 'string') {
        localStorage.setItem(STORAGE_KEYS.defaultFilter, filter);
      } else {
        localStorage.removeItem(STORAGE_KEYS.defaultFilter);
      }
    } catch (_) {}
  }

  // ── HTTP helpers ──────────────────────────────────────────────────────

  // Build a normalized failure result from an HTTP response. 4xx is
  // permanent (bad token / forbidden / not-found / bad-request);
  // callers should NOT blind-retry. 5xx is transient.
  function _failFromResponse(res, fallbackMessage) {
    const status = (res && typeof res.status === 'number') ? res.status : 0;
    const isRetryable = status >= 500 && status < 600;
    let message = fallbackMessage || ('HTTP ' + status);
    // Common diagnostic shorthand for the settings drawer.
    if (status === 401) message = 'Unauthorized — check your Todoist token.';
    else if (status === 403) message = 'Forbidden';
    else if (status === 404) message = 'Not Found';
    else if (status === 429) message = 'Rate limited — try again in a few minutes.';
    else if (status >= 500) message = 'Todoist server error (' + status + ')';
    return { ok: false, status, message, isRetryable };
  }

  function _failFromNetwork(err) {
    return {
      ok: false,
      message: 'network error',
      isRetryable: true,
      // `status` deliberately omitted — there was no HTTP response.
      _error: err,
    };
  }

  // Single fetch wrapper. Adds Bearer auth + JSON content-type when
  // appropriate. Returns the raw `Response` to the caller so each method
  // can decide whether to parse JSON (GET) or treat as opaque-2xx
  // (POST /close, /reopen). Throws on network error — callers MUST
  // try/catch and route to `_failFromNetwork`.
  async function _fetch(path, opts) {
    opts = opts || {};
    const url = BASE_URL + path;
    const headers = Object.assign({}, opts.headers || {});
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (opts.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    // Use window.fetch explicitly so test harnesses can mock it via
    // `window.fetch = fn`.
    return window.fetch(url, {
      method: opts.method || 'GET',
      headers,
      body: opts.body,
    });
  }

  // Parse a JSON response body, tolerating empty bodies.
  async function _parseJson(res) {
    try {
      const text = await res.text();
      if (!text) return undefined;
      return JSON.parse(text);
    } catch (_) {
      return undefined;
    }
  }

  // ── Read API ──────────────────────────────────────────────────────────

  // Cheap account-anonymous connectivity check. Calls GET /projects (a
  // tokens-only endpoint that returns an empty array for accounts with
  // no projects). Per brief decision #3, we do NOT separately call /user
  // — the success path is "✓ Connected" with no email/name surfacing.
  async function testConnection() {
    if (!hasToken()) {
      return { ok: false, message: 'No token configured', isRetryable: false };
    }
    let res;
    try {
      res = await _fetch('/projects');
    } catch (err) {
      return _failFromNetwork(err);
    }
    if (res.ok) return { ok: true };
    return _failFromResponse(res);
  }

  // GET /projects — returns the full project list for the connected
  // account. Used to populate the default-project dropdown in settings.
  async function getProjects() {
    if (!hasToken()) {
      return { ok: false, message: 'No token configured', isRetryable: false };
    }
    let res;
    try {
      res = await _fetch('/projects');
    } catch (err) {
      return _failFromNetwork(err);
    }
    if (!res.ok) return _failFromResponse(res);
    const data = await _parseJson(res);
    return { ok: true, data: Array.isArray(data) ? data : [] };
  }

  // GET /tasks?filter=<encoded>. The filter syntax is Todoist's own
  // free-form filter DSL (e.g. `today`, `today | overdue`, `@work`,
  // `p1 & today`). We pass it through unchanged via encodeURIComponent.
  // Returns `{ ok: true, data: Array<{id, content, project_id, ... }> }`.
  async function getTasks(filter) {
    if (!hasToken()) {
      return { ok: false, message: 'No token configured', isRetryable: false };
    }
    const f = (typeof filter === 'string' && filter.length > 0) ? filter : getDefaultFilter();
    const path = '/tasks?filter=' + encodeURIComponent(f);
    let res;
    try {
      res = await _fetch(path);
    } catch (err) {
      return _failFromNetwork(err);
    }
    if (!res.ok) return _failFromResponse(res);
    const data = await _parseJson(res);
    return { ok: true, data: Array.isArray(data) ? data : [] };
  }

  // ── Write API (close / reopen / create / update) ──────────────────────

  // Auto-enqueue when offline; otherwise issue POST /tasks/{id}/close.
  // Idempotent — Todoist returns 204 on success regardless of whether
  // the task was already closed. Retrying is safe.
  async function closeTask(id) {
    if (typeof id !== 'string' || id.length === 0) {
      return { ok: false, message: 'Invalid task id', isRetryable: false };
    }
    if (_isOffline()) {
      _enqueueOp({ kind: 'close', payload: { id } });
      return { ok: true, queued: true };
    }
    let res;
    try {
      res = await _fetch('/tasks/' + encodeURIComponent(id) + '/close', { method: 'POST' });
    } catch (err) {
      // Network error caught — enqueue for retry rather than surfacing
      // an error to the caller (the user's local action already completed).
      _enqueueOp({ kind: 'close', payload: { id } });
      void err;
      return { ok: true, queued: true };
    }
    if (res.ok) return { ok: true };
    return _failFromResponse(res);
  }

  // POST /tasks/{id}/reopen — idempotent. Same offline handling as close.
  async function reopenTask(id) {
    if (typeof id !== 'string' || id.length === 0) {
      return { ok: false, message: 'Invalid task id', isRetryable: false };
    }
    if (_isOffline()) {
      _enqueueOp({ kind: 'reopen', payload: { id } });
      return { ok: true, queued: true };
    }
    let res;
    try {
      res = await _fetch('/tasks/' + encodeURIComponent(id) + '/reopen', { method: 'POST' });
    } catch (err) {
      _enqueueOp({ kind: 'reopen', payload: { id } });
      void err;
      return { ok: true, queued: true };
    }
    if (res.ok) return { ok: true };
    return _failFromResponse(res);
  }

  // POST /tasks. Body: `{ content, project_id? }`. If `project_id` is
  // omitted, falls back to `getDefaultProjectId()` (the user-configured
  // default from the settings drawer). On success, returns the newly-
  // created task object (which includes the Todoist `id`) so the caller
  // can stamp it onto the local task. On offline auto-enqueue, the
  // returned shape is `{ ok: true, queued: true }` and the local task
  // will be stamped later via the `todoist:create-resolved` window event
  // emitted from `_drainQueue` when the create finally lands.
  //
  // `opts.localTag` is an OPTIONAL caller-supplied correlation id (any
  // string) — when present, the queued op stores it in `payload` so the
  // `todoist:create-resolved` event payload can carry it back to the
  // caller for late stamping.
  async function createTask(opts) {
    opts = opts || {};
    const content = (typeof opts.content === 'string') ? opts.content : '';
    if (!content) {
      return { ok: false, message: 'Empty content', isRetryable: false };
    }
    const projectId = opts.project_id || getDefaultProjectId();
    const body = { content };
    if (projectId) body.project_id = projectId;
    if (_isOffline()) {
      _enqueueOp({
        kind: 'create',
        payload: {
          content,
          project_id: projectId || null,
          localTag: opts.localTag || null,
        },
      });
      return { ok: true, queued: true };
    }
    let res;
    try {
      res = await _fetch('/tasks', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    } catch (err) {
      _enqueueOp({
        kind: 'create',
        payload: {
          content,
          project_id: projectId || null,
          localTag: opts.localTag || null,
        },
      });
      void err;
      return { ok: true, queued: true };
    }
    if (!res.ok) return _failFromResponse(res);
    const data = await _parseJson(res);
    return { ok: true, data: data || {} };
  }

  // POST /tasks/{id}. Body: `{ content }`. Renames a Todoist task.
  // Idempotent — re-sending the same content is a no-op server-side, so
  // offline retries are safe (matches close/reopen). Mirrors `createTask`'s
  // offline-enqueue-on-`_isOffline()`-or-`catch` pattern + `closeTask`'s
  // id-validation. The caller doesn't need the returned task, so the
  // success result is bare `{ ok: true }`. Empty `content` or missing `id`
  // short-circuit with `{ ok: false, ... }` and fire no request.
  async function updateTask(id, opts) {
    opts = opts || {};
    const content = (typeof opts.content === 'string') ? opts.content : '';
    if (!id) {
      return { ok: false, message: 'Invalid task id', isRetryable: false };
    }
    if (!content) {
      return { ok: false, message: 'Empty content', isRetryable: false };
    }
    if (_isOffline()) {
      _enqueueOp({ kind: 'update', payload: { id, content } });
      return { ok: true, queued: true };
    }
    let res;
    try {
      res = await _fetch('/tasks/' + encodeURIComponent(id), {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
    } catch (err) {
      _enqueueOp({ kind: 'update', payload: { id, content } });
      void err;
      return { ok: true, queued: true };
    }
    if (!res.ok) return _failFromResponse(res);
    return { ok: true };
  }

  // ── Offline queue ─────────────────────────────────────────────────────

  function _isOffline() {
    // Prefer Platform.network.isOnline() when available — it's the
    // canonical Tempo abstraction (used by sync-engine.js) and on iOS
    // Capacitor it routes to @capacitor/network for reliable status
    // updates that navigator.onLine misses in WKWebView. Falls back to
    // navigator.onLine on web builds without the shim. Code paths still
    // catch fetch network errors and enqueue from there; this gate just
    // skips the doomed fetch when we already know we're offline.
    try {
      if (typeof Platform !== 'undefined' && Platform && Platform.network
          && typeof Platform.network.isOnline === 'function') {
        return Platform.network.isOnline() === false;
      }
      return typeof navigator !== 'undefined' && navigator.onLine === false;
    } catch (_) {
      return false;
    }
  }

  function _loadQueue() {
    if (_queueCache !== null) return _queueCache;
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.pendingOps);
      if (!raw) {
        _queueCache = [];
      } else {
        const parsed = JSON.parse(raw);
        _queueCache = Array.isArray(parsed) ? parsed : [];
      }
    } catch (_) {
      _queueCache = [];
    }
    // Bump the in-memory id counter past any persisted entries so newly
    // enqueued ops don't collide with persisted ids on the same session.
    if (_queueCache.length > 0) {
      let maxId = 0;
      for (const op of _queueCache) {
        if (op && typeof op.id === 'number' && op.id > maxId) maxId = op.id;
      }
      if (maxId >= _opIdCounter) _opIdCounter = maxId + 1;
    }
    return _queueCache;
  }

  function _persistQueue() {
    try {
      localStorage.setItem(STORAGE_KEYS.pendingOps, JSON.stringify(_queueCache || []));
    } catch (_) {}
  }

  function _enqueueOp(op) {
    const queue = _loadQueue();
    const entry = {
      id: _opIdCounter++,
      kind: op.kind,
      payload: op.payload || {},
      enqueuedAt: Date.now(),
    };
    queue.push(entry);
    // Cap enforcement: FIFO eviction. If at/over cap, drop the OLDEST
    // entries until we're back under. We push first then evict so the
    // newest op is always retained (the user just performed this
    // action; the oldest pending one is the most stale).
    while (queue.length > QUEUE_CAP) {
      const dropped = queue.shift();
      try {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[Todoist] queue cap reached; evicted oldest op', dropped);
        }
      } catch (_) {}
    }
    _persistQueue();
    return entry;
  }

  // Emit `todoist:create-resolved` as a `CustomEvent` on `window` so the
  // UI layer can stamp the returned Todoist id onto the local task that
  // triggered the create. Best-effort — no observable failure mode if
  // the listener isn't registered.
  function _emitCreateResolved(localTag, todoistId) {
    if (typeof window === 'undefined') return;
    try {
      const evt = new CustomEvent('todoist:create-resolved', {
        detail: { localTag, todoistId },
      });
      window.dispatchEvent(evt);
    } catch (_) {
      // Older browsers / test environments may not support CustomEvent
      // construction. Fall back silently.
    }
  }

  // Process the offline queue FIFO. Per the audit:
  //   - 2xx → remove from queue.
  //   - 4xx → remove + console.warn (permanent failure).
  //   - 5xx → leave in queue (retry next opportunity).
  //   - fetch throws → leave in queue.
  //
  // For `create` ops, on 2xx we emit `todoist:create-resolved` with
  // the new Todoist id + the caller's `localTag` so the UI can late-
  // stamp.
  //
  // Returns `{ ok: true, drained, failed }` for inspectability.
  async function drainQueue() {
    if (!hasToken()) {
      return { ok: false, message: 'No token configured', isRetryable: false, drained: 0, failed: 0 };
    }
    if (_isOffline()) {
      // Don't even try — we'd just stack network failures and keep
      // every op in place. Drain will be retried on the next `online`
      // event.
      return { ok: true, drained: 0, failed: 0 };
    }
    const queue = _loadQueue();
    if (queue.length === 0) return { ok: true, drained: 0, failed: 0 };

    let drained = 0;
    let failed = 0;
    // We walk a copy because we'll mutate `queue` in place (removing
    // successful + permanently-failed entries) and want a stable order
    // for the for-loop.
    const snapshot = queue.slice();
    for (const op of snapshot) {
      const result = await _executeOp(op);
      if (result === 'remove') {
        _removeOpById(op.id);
        drained++;
      } else if (result === 'remove-permanent-failure') {
        _removeOpById(op.id);
        drained++; // counted as processed; the op is gone from the queue
        try {
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('[Todoist] permanent failure on queued op; removed', op);
          }
        } catch (_) {}
      } else {
        // 'leave' — transient (5xx) or network error. Stop draining here to
        // preserve FIFO order; the remaining ops stay in queue for the next
        // drain. Only THIS op failed — the not-yet-attempted ops are deferred,
        // not failed, so count 1 (was `queue.length`, which overstated every
        // unattempted op as a failure).
        failed = 1;
        break;
      }
    }
    _persistQueue();
    return { ok: true, drained, failed };
  }

  // Execute one queued op against the network. Returns one of:
  //   'remove'                    — 2xx, op is done.
  //   'remove-permanent-failure'  — 4xx, op will never succeed (bad
  //                                 token, deleted project, etc.).
  //   'leave'                     — 5xx OR network error; retry later.
  async function _executeOp(op) {
    if (!op || typeof op.kind !== 'string') return 'remove-permanent-failure';
    let res;
    try {
      if (op.kind === 'close') {
        res = await _fetch('/tasks/' + encodeURIComponent(op.payload.id) + '/close', { method: 'POST' });
      } else if (op.kind === 'reopen') {
        res = await _fetch('/tasks/' + encodeURIComponent(op.payload.id) + '/reopen', { method: 'POST' });
      } else if (op.kind === 'create') {
        const body = { content: op.payload.content };
        if (op.payload.project_id) body.project_id = op.payload.project_id;
        res = await _fetch('/tasks', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      } else if (op.kind === 'update') {
        // Rename. Idempotent re-send; no special 2xx handling — the
        // shared `if (res.ok) return 'remove'` path below covers it, and
        // (unlike 'create') 'update' does NOT emit `create-resolved`.
        res = await _fetch('/tasks/' + encodeURIComponent(op.payload.id), {
          method: 'POST',
          body: JSON.stringify({ content: op.payload.content }),
        });
      } else {
        // Unknown kind — treat as permanent failure so a forward-incompat
        // op shape from a future release doesn't get stuck in the queue
        // on a downgrade.
        return 'remove-permanent-failure';
      }
    } catch (err) {
      void err;
      return 'leave';
    }
    if (res.ok) {
      if (op.kind === 'create') {
        const data = await _parseJson(res);
        const todoistId = (data && typeof data.id !== 'undefined') ? String(data.id) : null;
        if (todoistId !== null) {
          _emitCreateResolved(op.payload.localTag || null, todoistId);
        }
      }
      return 'remove';
    }
    const status = (typeof res.status === 'number') ? res.status : 0;
    if (status >= 400 && status < 500) return 'remove-permanent-failure';
    if (status >= 500 && status < 600) return 'leave';
    // Unrecognized non-2xx (e.g. 3xx that fetch didn't auto-follow) —
    // treat as transient.
    return 'leave';
  }

  function _removeOpById(id) {
    const queue = _loadQueue();
    for (let i = 0; i < queue.length; i++) {
      if (queue[i] && queue[i].id === id) {
        queue.splice(i, 1);
        return;
      }
    }
  }

  // ── Listener install (bind-once) ──────────────────────────────────────

  function _bindListeners() {
    if (_listenersBound) return;
    if (typeof window === 'undefined') return;
    // Prefer Platform.network.onChange when available so iOS WKWebView
    // reconnects (which navigator.onLine misses) still drain the queue.
    let onlineSourceBound = false;
    try {
      if (typeof Platform !== 'undefined' && Platform && Platform.network
          && typeof Platform.network.onChange === 'function') {
        Platform.network.onChange((status) => {
          if (status && status.connected === true) {
            drainQueue().catch(() => {});
          }
        });
        onlineSourceBound = true;
      }
    } catch (_) {}
    if (!onlineSourceBound) {
      try {
        window.addEventListener('online', () => {
          // Best-effort drain. Errors swallowed — surface is event-driven.
          drainQueue().catch(() => {});
        });
      } catch (_) {}
    }
    try {
      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            drainQueue().catch(() => {});
          }
        });
      }
    } catch (_) {}
    // Set the latch AFTER both binds so a synchronous failure in any
    // listener install doesn't lock out a future re-bind attempt.
    _listenersBound = true;
  }

  // ── Test seam ─────────────────────────────────────────────────────────

  // Clears IN-MEMORY caches and resets the listener-bound latch so a
  // subsequent module init in the same page binds listeners again.
  // Does NOT clear localStorage — tests that want a clean slate must
  // `localStorage.removeItem(...)` themselves.
  function _resetForTests() {
    _queueCache = null;
    _listenersBound = false;
    _opIdCounter = 1;
  }

  // Bind listeners once on module load. Wrapped in a try so a failure
  // in a non-browser test harness doesn't blow up the IIFE.
  try { _bindListeners(); } catch (_) {}

  return {
    // Constants (exposed for tests + UI).
    BASE_URL,
    QUEUE_CAP,
    STORAGE_KEYS,

    // Token management.
    getToken,
    setToken,
    clearToken,
    hasToken,

    // Config.
    getDefaultProjectId,
    setDefaultProjectId,
    getDefaultFilter,
    setDefaultFilter,

    // Read API.
    testConnection,
    getProjects,
    getTasks,

    // Write API.
    closeTask,
    reopenTask,
    createTask,
    updateTask,

    // Queue control.
    drainQueue,

    // Test seam.
    _resetForTests,
  };
})();

if (typeof window !== 'undefined') {
  window.Todoist = Todoist;
}
