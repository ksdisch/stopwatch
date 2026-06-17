// Engine tests for js/todoist.js (bl-2-todoist V1).
//
// The module talks to Todoist REST v2 via window.fetch + persists an
// offline write queue to localStorage. These tests mock both surfaces.
//
// Conventions:
//   • _resetForTests() between cases clears the in-memory queue cache +
//     listener-bound latch so each test gets a fresh module-state view.
//   • localStorage.removeItem(...) for each todoist_* key between cases
//     keeps disk state independent.
//   • window.fetch is mocked via a factory (`mockFetch`) that captures
//     calls in `_fetchCalls` and returns a fake Response object.
//   • navigator.onLine is overridden via Object.defineProperty (the spec
//     allows both — modern browsers expose a getter), restored in teardown.
//   • All async cases use `async`/`await` against the engine's promise
//     return values.

// ── Mock fetch + onLine helpers (shared across describe blocks) ──

let _originalFetch;
let _originalOnLine;
let _fetchCalls;
let _fetchResponses;     // FIFO queue of canned responses
let _fetchThrow;         // when true, mock fetch throws "network down"

function _resetMocks() {
  _fetchCalls = [];
  _fetchResponses = [];
  _fetchThrow = false;
}

function _installFetchMock() {
  _originalFetch = window.fetch;
  _resetMocks();
  window.fetch = async (url, opts) => {
    _fetchCalls.push({ url, opts: opts || {} });
    if (_fetchThrow) {
      throw new Error('mock: network down');
    }
    if (_fetchResponses.length === 0) {
      // Default: 200 OK, empty body. Tests should usually push a response.
      return _makeResponse(200, '');
    }
    return _fetchResponses.shift();
  };
}

function _restoreFetchMock() {
  window.fetch = _originalFetch;
}

function _makeResponse(status, body) {
  const ok = status >= 200 && status < 300;
  const bodyText = (typeof body === 'string') ? body : JSON.stringify(body);
  return {
    ok,
    status,
    text: async () => bodyText,
  };
}

// Queue a canned response for the next fetch call. `body` may be a string
// or any JSON-serializable value.
function _queueResponse(status, body) {
  _fetchResponses.push(_makeResponse(status, body));
}

function _setOffline(offline) {
  // Capture original ONLY on first call per test (so teardown restores
  // the real getter). Subsequent calls in the same test re-define.
  if (_originalOnLine === undefined) {
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine')
      || Object.getOwnPropertyDescriptor(navigator, 'onLine');
    _originalOnLine = desc || null;
  }
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => !offline,
  });
}

function _restoreOnLine() {
  if (_originalOnLine === undefined) return;
  if (_originalOnLine === null) {
    // No descriptor existed — best-effort delete (browsers may not allow).
    try { delete navigator.onLine; } catch (_) {}
  } else {
    try {
      Object.defineProperty(navigator, 'onLine', _originalOnLine);
    } catch (_) {
      // Fallback: install a permissive descriptor.
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => true,
      });
    }
  }
  _originalOnLine = undefined;
}

function _clearTodoistStorage() {
  localStorage.removeItem('todoist_api_token');
  localStorage.removeItem('todoist_default_project_id');
  localStorage.removeItem('todoist_default_filter');
  localStorage.removeItem('todoist_pending_ops');
}

// Standard per-case setup: clean disk + memory + mock surface.
function _setup() {
  _clearTodoistStorage();
  Todoist._resetForTests();
  _installFetchMock();
}

function _teardown() {
  _restoreFetchMock();
  _restoreOnLine();
  _clearTodoistStorage();
  Todoist._resetForTests();
}

// ── Token management ─────────────────────────────────────────────────────

describe('Todoist — token mgmt', () => {
  it('setToken / getToken / hasToken roundtrip', () => {
    _setup();
    try {
      assertEqual(Todoist.getToken(), null);
      assertEqual(Todoist.hasToken(), false);
      Todoist.setToken('abc');
      assertEqual(Todoist.getToken(), 'abc');
      assertEqual(Todoist.hasToken(), true);
    } finally { _teardown(); }
  });

  it('clearToken removes the token', () => {
    _setup();
    try {
      Todoist.setToken('abc');
      assertEqual(Todoist.hasToken(), true);
      Todoist.clearToken();
      assertEqual(Todoist.getToken(), null);
      assertEqual(Todoist.hasToken(), false);
    } finally { _teardown(); }
  });

  it('setToken(falsy) clears (empty string + null)', () => {
    _setup();
    try {
      Todoist.setToken('abc');
      Todoist.setToken('');
      assertEqual(Todoist.getToken(), null);
      assertEqual(Todoist.hasToken(), false);

      Todoist.setToken('xyz');
      Todoist.setToken(null);
      assertEqual(Todoist.getToken(), null);
      assertEqual(Todoist.hasToken(), false);
    } finally { _teardown(); }
  });
});

// ── No-token guard on all network methods ────────────────────────────────

describe('Todoist — no-token guard', () => {
  it('testConnection() without token returns no-token error + no fetch', async () => {
    _setup();
    try {
      const r = await Todoist.testConnection();
      assertEqual(r.ok, false);
      assertEqual(r.message, 'No token configured');
      assertEqual(r.isRetryable, false);
      assertEqual(_fetchCalls.length, 0);
    } finally { _teardown(); }
  });

  it('getProjects() without token returns no-token error + no fetch', async () => {
    _setup();
    try {
      const r = await Todoist.getProjects();
      assertEqual(r.ok, false);
      assertEqual(r.message, 'No token configured');
      assertEqual(r.isRetryable, false);
      assertEqual(_fetchCalls.length, 0);
    } finally { _teardown(); }
  });

  it('getTasks() without token returns no-token error + no fetch', async () => {
    _setup();
    try {
      const r = await Todoist.getTasks('today');
      assertEqual(r.ok, false);
      assertEqual(r.message, 'No token configured');
      assertEqual(_fetchCalls.length, 0);
    } finally { _teardown(); }
  });

  it('drainQueue() without token returns no-token error shape + no fetch', async () => {
    _setup();
    try {
      const r = await Todoist.drainQueue();
      assertEqual(r.ok, false);
      assertEqual(r.message, 'No token configured');
      assertEqual(r.isRetryable, false);
      assertEqual(r.drained, 0);
      assertEqual(r.failed, 0);
      assertEqual(_fetchCalls.length, 0);
    } finally { _teardown(); }
  });
});

// ── testConnection ───────────────────────────────────────────────────────

describe('Todoist — testConnection', () => {
  it('success: GET /projects → { ok: true }, Bearer header set', async () => {
    _setup();
    try {
      Todoist.setToken('tkn-1');
      _queueResponse(200, []);
      const r = await Todoist.testConnection();
      assertEqual(r.ok, true);
      assertEqual(_fetchCalls.length, 1);
      const call = _fetchCalls[0];
      assertEqual(call.url, 'https://api.todoist.com/rest/v2/projects');
      assertEqual(call.opts.method, 'GET');
      assertEqual(call.opts.headers['Authorization'], 'Bearer tkn-1');
    } finally { _teardown(); }
  });

  it('401 → normalized "Unauthorized" + isRetryable:false', async () => {
    _setup();
    try {
      Todoist.setToken('bad');
      _queueResponse(401, '');
      const r = await Todoist.testConnection();
      assertEqual(r.ok, false);
      assertEqual(r.status, 401);
      assertEqual(r.message, 'Unauthorized — check your Todoist token.');
      assertEqual(r.isRetryable, false);
    } finally { _teardown(); }
  });
});

// ── getProjects ──────────────────────────────────────────────────────────

describe('Todoist — getProjects', () => {
  it('200 returns array data', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _queueResponse(200, [{ id: 'p1', name: 'Inbox' }, { id: 'p2', name: 'Work' }]);
      const r = await Todoist.getProjects();
      assertEqual(r.ok, true);
      assertEqual(r.data.length, 2);
      assertEqual(r.data[0].id, 'p1');
    } finally { _teardown(); }
  });

  it('non-array JSON tolerated → data: []', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _queueResponse(200, { not: 'an array' });
      const r = await Todoist.getProjects();
      assertEqual(r.ok, true);
      assertArrayEqual(r.data, []);
    } finally { _teardown(); }
  });
});

// ── getTasks (filter encoding + default) ─────────────────────────────────

describe('Todoist — getTasks', () => {
  it('URL-encodes filter (today & @work)', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _queueResponse(200, []);
      await Todoist.getTasks('today & @work');
      assertEqual(_fetchCalls.length, 1);
      const expected = 'https://api.todoist.com/rest/v2/tasks?filter=today%20%26%20%40work';
      assertEqual(_fetchCalls[0].url, expected);
    } finally { _teardown(); }
  });

  it('no-arg call falls back to default filter "today"', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _queueResponse(200, []);
      await Todoist.getTasks();
      assertEqual(_fetchCalls.length, 1);
      assertEqual(_fetchCalls[0].url, 'https://api.todoist.com/rest/v2/tasks?filter=today');
    } finally { _teardown(); }
  });
});

// ── closeTask / reopenTask happy path ────────────────────────────────────

describe('Todoist — closeTask online', () => {
  it('POST /tasks/{id}/close → { ok: true }, Bearer header', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _queueResponse(204, '');
      const r = await Todoist.closeTask('XYZ');
      assertEqual(r.ok, true);
      assertEqual(_fetchCalls.length, 1);
      const call = _fetchCalls[0];
      assertEqual(call.url, 'https://api.todoist.com/rest/v2/tasks/XYZ/close');
      assertEqual(call.opts.method, 'POST');
      assertEqual(call.opts.headers['Authorization'], 'Bearer tkn');
    } finally { _teardown(); }
  });

  it('idempotent retry — two consecutive closeTask calls each fetch + ok', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _queueResponse(204, '');
      _queueResponse(204, '');
      const r1 = await Todoist.closeTask('XYZ');
      const r2 = await Todoist.closeTask('XYZ');
      assertEqual(r1.ok, true);
      assertEqual(r2.ok, true);
      assertEqual(_fetchCalls.length, 2);
    } finally { _teardown(); }
  });
});

describe('Todoist — reopenTask online', () => {
  it('POST /tasks/{id}/reopen → { ok: true }', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _queueResponse(204, '');
      const r = await Todoist.reopenTask('XYZ');
      assertEqual(r.ok, true);
      assertEqual(_fetchCalls.length, 1);
      assertEqual(_fetchCalls[0].url, 'https://api.todoist.com/rest/v2/tasks/XYZ/reopen');
      assertEqual(_fetchCalls[0].opts.method, 'POST');
    } finally { _teardown(); }
  });
});

// ── createTask ───────────────────────────────────────────────────────────

describe('Todoist — createTask', () => {
  it('POST /tasks with content body; returns data on 200', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _queueResponse(200, { id: 'abc', content: 'foo' });
      const r = await Todoist.createTask({ content: 'foo' });
      assertEqual(r.ok, true);
      assertEqual(r.data.id, 'abc');
      assertEqual(r.data.content, 'foo');
      assertEqual(_fetchCalls.length, 1);
      const call = _fetchCalls[0];
      assertEqual(call.url, 'https://api.todoist.com/rest/v2/tasks');
      assertEqual(call.opts.method, 'POST');
      assertEqual(call.opts.headers['Content-Type'], 'application/json');
      assertEqual(call.opts.body, JSON.stringify({ content: 'foo' }));
    } finally { _teardown(); }
  });

  it('uses configured default project_id when not provided', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      Todoist.setDefaultProjectId('pdef');
      _queueResponse(200, { id: 'abc' });
      await Todoist.createTask({ content: 'foo' });
      assertEqual(_fetchCalls.length, 1);
      assertEqual(_fetchCalls[0].opts.body, JSON.stringify({ content: 'foo', project_id: 'pdef' }));
    } finally { _teardown(); }
  });

  it('empty content → error without fetch', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      const r = await Todoist.createTask({ content: '' });
      assertEqual(r.ok, false);
      assertEqual(r.message, 'Empty content');
      assertEqual(r.isRetryable, false);
      assertEqual(_fetchCalls.length, 0);
    } finally { _teardown(); }
  });
});

// ── updateTask (rename write-back, follow-up B) ──────────────────────────

describe('Todoist — updateTask', () => {
  it('online happy path — POST /tasks/{id} with content body; Bearer header; { ok: true }', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _queueResponse(200, '');
      const r = await Todoist.updateTask('XYZ', { content: 'new' });
      assertEqual(r.ok, true);
      assertEqual(_fetchCalls.length, 1);
      const call = _fetchCalls[0];
      assertEqual(call.url, 'https://api.todoist.com/rest/v2/tasks/XYZ');
      assertEqual(call.opts.method, 'POST');
      assertEqual(call.opts.headers['Content-Type'], 'application/json');
      assertEqual(call.opts.headers['Authorization'], 'Bearer tkn');
      assertEqual(call.opts.body, JSON.stringify({ content: 'new' }));
    } finally { _teardown(); }
  });

  it('missing/empty id → { ok: false } without fetch', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      let r = await Todoist.updateTask('', { content: 'new' });
      assertEqual(r.ok, false);
      assertEqual(r.message, 'Invalid task id');
      assertEqual(r.isRetryable, false);
      assertEqual(_fetchCalls.length, 0);

      // Undefined id behaves the same (no id arg).
      r = await Todoist.updateTask(undefined, { content: 'new' });
      assertEqual(r.ok, false);
      assertEqual(r.message, 'Invalid task id');
      assertEqual(_fetchCalls.length, 0);
    } finally { _teardown(); }
  });

  it('empty content → { ok: false } without fetch', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      let r = await Todoist.updateTask('XYZ', { content: '' });
      assertEqual(r.ok, false);
      assertEqual(r.message, 'Empty content');
      assertEqual(r.isRetryable, false);
      assertEqual(_fetchCalls.length, 0);

      // Missing opts entirely also short-circuits with no fetch.
      r = await Todoist.updateTask('XYZ');
      assertEqual(r.ok, false);
      assertEqual(r.message, 'Empty content');
      assertEqual(_fetchCalls.length, 0);
    } finally { _teardown(); }
  });

  it('offline → queued:true, no fetch, persisted { kind: update, payload:{id,content} }', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _setOffline(true);
      const r = await Todoist.updateTask('XYZ', { content: 'renamed' });
      assertEqual(r.ok, true);
      assertEqual(r.queued, true);
      assertEqual(_fetchCalls.length, 0);
      const raw = localStorage.getItem('todoist_pending_ops');
      assert(raw !== null, 'pending_ops written to localStorage');
      const persisted = JSON.parse(raw);
      assertEqual(persisted.length, 1);
      assertEqual(persisted[0].kind, 'update');
      assertEqual(persisted[0].payload.id, 'XYZ');
      assertEqual(persisted[0].payload.content, 'renamed');
    } finally { _teardown(); }
  });

  it('auto-enqueues an update op when fetch throws (network error path)', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _setOffline(false);
      _fetchThrow = true;
      const r = await Todoist.updateTask('XYZ', { content: 'renamed' });
      assertEqual(r.ok, true);
      assertEqual(r.queued, true);
      // fetch WAS attempted (and threw), op landed in queue.
      assertEqual(_fetchCalls.length, 1);
      const persisted = JSON.parse(localStorage.getItem('todoist_pending_ops'));
      assertEqual(persisted.length, 1);
      assertEqual(persisted[0].kind, 'update');
      assertEqual(persisted[0].payload.content, 'renamed');
    } finally { _teardown(); }
  });

  it('4xx → { ok: false, isRetryable: false } (permanent failure)', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _queueResponse(404, '');
      const r = await Todoist.updateTask('XYZ', { content: 'new' });
      assertEqual(r.ok, false);
      assertEqual(r.status, 404);
      assertEqual(r.message, 'Not Found');
      assertEqual(r.isRetryable, false);
      assertEqual(_fetchCalls.length, 1);
    } finally { _teardown(); }
  });

  it('5xx → { ok: false, isRetryable: true } (transient)', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _queueResponse(503, '');
      const r = await Todoist.updateTask('XYZ', { content: 'new' });
      assertEqual(r.ok, false);
      assertEqual(r.status, 503);
      assertEqual(r.message, 'Todoist server error (503)');
      assertEqual(r.isRetryable, true);
    } finally { _teardown(); }
  });
});

// ── Error normalization ──────────────────────────────────────────────────

describe('Todoist — error normalization', () => {
  it('4xx → isRetryable:false with specific status messages', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');

      _queueResponse(403, '');
      let r = await Todoist.getProjects();
      assertEqual(r.ok, false);
      assertEqual(r.status, 403);
      assertEqual(r.message, 'Forbidden');
      assertEqual(r.isRetryable, false);

      _queueResponse(404, '');
      r = await Todoist.getProjects();
      assertEqual(r.status, 404);
      assertEqual(r.message, 'Not Found');
      assertEqual(r.isRetryable, false);

      _queueResponse(429, '');
      r = await Todoist.getProjects();
      assertEqual(r.status, 429);
      assertEqual(r.message, 'Rate limited — try again in a few minutes.');
      assertEqual(r.isRetryable, false);
    } finally { _teardown(); }
  });

  it('5xx → isRetryable:true with server-error message', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _queueResponse(503, '');
      const r = await Todoist.getProjects();
      assertEqual(r.ok, false);
      assertEqual(r.status, 503);
      assertEqual(r.message, 'Todoist server error (503)');
      assertEqual(r.isRetryable, true);
    } finally { _teardown(); }
  });

  it('network error on read method → _failFromNetwork shape', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _fetchThrow = true;
      const r = await Todoist.getProjects();
      assertEqual(r.ok, false);
      assertEqual(r.message, 'network error');
      assertEqual(r.isRetryable, true);
      // No `status` field on network failures.
      assertEqual(typeof r.status, 'undefined');
    } finally { _teardown(); }
  });
});

// ── Offline auto-enqueue (write methods) ─────────────────────────────────

describe('Todoist — offline auto-enqueue', () => {
  it('closeTask offline → queued:true, no fetch, persisted op', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _setOffline(true);
      const r = await Todoist.closeTask('XYZ');
      assertEqual(r.ok, true);
      assertEqual(r.queued, true);
      assertEqual(_fetchCalls.length, 0);
      const raw = localStorage.getItem('todoist_pending_ops');
      assert(raw !== null, 'pending_ops written to localStorage');
      const persisted = JSON.parse(raw);
      assertEqual(persisted.length, 1);
      assertEqual(persisted[0].kind, 'close');
      assertEqual(persisted[0].payload.id, 'XYZ');
    } finally { _teardown(); }
  });

  it('write methods auto-enqueue when fetch throws (network error path)', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _setOffline(false);
      _fetchThrow = true;
      const r = await Todoist.closeTask('XYZ');
      assertEqual(r.ok, true);
      assertEqual(r.queued, true);
      // fetch WAS called (and threw), but the op landed in the queue:
      assertEqual(_fetchCalls.length, 1);
      const persisted = JSON.parse(localStorage.getItem('todoist_pending_ops'));
      assertEqual(persisted.length, 1);
      assertEqual(persisted[0].kind, 'close');
    } finally { _teardown(); }
  });
});

// ── Queue cap + FIFO eviction ────────────────────────────────────────────

describe('Todoist — queue cap', () => {
  it('cap = 200; pushing 201 ops evicts the oldest entry', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _setOffline(true);
      // Suppress the per-eviction console.warn so this test doesn't spam
      // the harness output. Restored in teardown via mock-fetch's standard
      // pattern.
      const _realWarn = console.warn;
      console.warn = () => {};
      try {
        for (let i = 0; i < 201; i++) {
          await Todoist.closeTask('id-' + i);
        }
      } finally {
        console.warn = _realWarn;
      }
      const persisted = JSON.parse(localStorage.getItem('todoist_pending_ops'));
      assertEqual(persisted.length, 200);
      // Oldest (id-0) was evicted; the surviving head is id-1.
      assertEqual(persisted[0].payload.id, 'id-1');
      // Newest (id-200) retained at the tail.
      assertEqual(persisted[persisted.length - 1].payload.id, 'id-200');
    } finally { _teardown(); }
  });
});

// ── Queue persistence across module reset ────────────────────────────────

describe('Todoist — queue persistence', () => {
  it('queue survives _resetForTests (re-loaded from localStorage)', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _setOffline(true);
      await Todoist.closeTask('A');
      await Todoist.closeTask('B');

      // Drop in-memory cache + listener latch.
      Todoist._resetForTests();

      // Disk should still hold both ops.
      const persisted = JSON.parse(localStorage.getItem('todoist_pending_ops'));
      assertEqual(persisted.length, 2);
      assertEqual(persisted[0].payload.id, 'A');
      assertEqual(persisted[1].payload.id, 'B');

      // A new enqueue picks up where disk left off (push, not overwrite).
      await Todoist.closeTask('C');
      const persisted2 = JSON.parse(localStorage.getItem('todoist_pending_ops'));
      assertEqual(persisted2.length, 3);
      assertEqual(persisted2[2].payload.id, 'C');
    } finally { _teardown(); }
  });
});

// ── drainQueue branching ─────────────────────────────────────────────────

describe('Todoist — drainQueue', () => {
  it('FIFO drain — three ops, all 2xx → drained:3, empty queue', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _setOffline(true);
      await Todoist.closeTask('A');
      await Todoist.closeTask('B');
      await Todoist.closeTask('C');
      _setOffline(false);

      _queueResponse(204, '');
      _queueResponse(204, '');
      _queueResponse(204, '');
      const r = await Todoist.drainQueue();
      assertEqual(r.ok, true);
      assertEqual(r.drained, 3);
      assertEqual(r.failed, 0);
      // Three fetch calls in enqueue order.
      assertEqual(_fetchCalls.length, 3);
      assert(_fetchCalls[0].url.indexOf('/tasks/A/close') >= 0, 'A drained first');
      assert(_fetchCalls[1].url.indexOf('/tasks/B/close') >= 0, 'B drained second');
      assert(_fetchCalls[2].url.indexOf('/tasks/C/close') >= 0, 'C drained third');
      // Queue empty after drain.
      const persisted = JSON.parse(localStorage.getItem('todoist_pending_ops'));
      assertArrayEqual(persisted, []);
    } finally { _teardown(); }
  });

  it('2xx branch — op removed from queue after success', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _setOffline(true);
      await Todoist.closeTask('A');
      _setOffline(false);
      _queueResponse(200, '');
      await Todoist.drainQueue();
      const persisted = JSON.parse(localStorage.getItem('todoist_pending_ops'));
      assertArrayEqual(persisted, []);
    } finally { _teardown(); }
  });

  it('4xx branch — op removed + console.warn logged (permanent failure)', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _setOffline(true);
      await Todoist.closeTask('A');
      _setOffline(false);
      _queueResponse(401, '');

      // Capture console.warn calls so we can assert + suppress noise.
      const _realWarn = console.warn;
      let warnCalls = 0;
      console.warn = () => { warnCalls++; };
      try {
        const r = await Todoist.drainQueue();
        assertEqual(r.ok, true);
        assertEqual(r.drained, 1);  // counted as processed (removed)
        assertEqual(r.failed, 0);
      } finally {
        console.warn = _realWarn;
      }
      assert(warnCalls >= 1, 'console.warn fired for permanent failure');
      const persisted = JSON.parse(localStorage.getItem('todoist_pending_ops'));
      assertArrayEqual(persisted, []);
    } finally { _teardown(); }
  });

  it('5xx branch — op LEFT in queue, drain stops at that op', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _setOffline(true);
      await Todoist.closeTask('A');
      await Todoist.closeTask('B');
      _setOffline(false);

      _queueResponse(503, '');   // A fails transiently
      // No further canned response — the test asserts the loop bails out.
      const r = await Todoist.drainQueue();
      assertEqual(r.ok, true);
      assertEqual(r.drained, 0);
      assert(r.failed > 0, 'failed count surfaced');
      // Only ONE fetch was made — the drain stopped at the transient failure.
      assertEqual(_fetchCalls.length, 1);
      const persisted = JSON.parse(localStorage.getItem('todoist_pending_ops'));
      assertEqual(persisted.length, 2);
      // FIFO order preserved.
      assertEqual(persisted[0].payload.id, 'A');
      assertEqual(persisted[1].payload.id, 'B');
    } finally { _teardown(); }
  });

  it('network throw branch — op LEFT in queue, drain stops', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _setOffline(true);
      await Todoist.closeTask('A');
      await Todoist.closeTask('B');
      _setOffline(false);

      _fetchThrow = true;
      const r = await Todoist.drainQueue();
      assertEqual(r.ok, true);
      assertEqual(r.drained, 0);
      // Both ops still on disk.
      const persisted = JSON.parse(localStorage.getItem('todoist_pending_ops'));
      assertEqual(persisted.length, 2);
    } finally { _teardown(); }
  });

  it('skips when offline — returns drained:0 without fetch', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _setOffline(true);
      await Todoist.closeTask('A');
      // Still offline when drain runs.
      const r = await Todoist.drainQueue();
      assertEqual(r.ok, true);
      assertEqual(r.drained, 0);
      assertEqual(r.failed, 0);
      assertEqual(_fetchCalls.length, 0);
      // Queue preserved.
      const persisted = JSON.parse(localStorage.getItem('todoist_pending_ops'));
      assertEqual(persisted.length, 1);
    } finally { _teardown(); }
  });

  it('create op emits todoist:create-resolved on success', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _setOffline(true);
      await Todoist.createTask({ content: 'foo', localTag: 'tag-1' });
      _setOffline(false);

      let received = null;
      const handler = (e) => { received = e.detail; };
      window.addEventListener('todoist:create-resolved', handler);
      try {
        _queueResponse(200, { id: 'new-id', content: 'foo' });
        const r = await Todoist.drainQueue();
        assertEqual(r.drained, 1);
      } finally {
        window.removeEventListener('todoist:create-resolved', handler);
      }
      assert(received !== null, 'create-resolved event fired');
      assertEqual(received.localTag, 'tag-1');
      assertEqual(received.todoistId, 'new-id');
    } finally { _teardown(); }
  });

  it('update op — POST /tasks/{id}, removed on 2xx, NO create-resolved emitted', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _setOffline(true);
      await Todoist.updateTask('XYZ', { content: 'renamed' });
      _setOffline(false);

      // An 'update' drain must NOT signal create-resolved (create-only).
      let createResolvedFired = false;
      const handler = () => { createResolvedFired = true; };
      window.addEventListener('todoist:create-resolved', handler);
      try {
        _queueResponse(200, '');
        const r = await Todoist.drainQueue();
        assertEqual(r.ok, true);
        assertEqual(r.drained, 1);
        assertEqual(r.failed, 0);
        // Exactly one fetch, to the rename endpoint with the right body.
        assertEqual(_fetchCalls.length, 1);
        assertEqual(_fetchCalls[0].url, 'https://api.todoist.com/rest/v2/tasks/XYZ');
        assertEqual(_fetchCalls[0].opts.method, 'POST');
        assertEqual(_fetchCalls[0].opts.body, JSON.stringify({ content: 'renamed' }));
      } finally {
        window.removeEventListener('todoist:create-resolved', handler);
      }
      assertEqual(createResolvedFired, false);
      // Queue empty after a successful drain (2xx removes).
      const persisted = JSON.parse(localStorage.getItem('todoist_pending_ops'));
      assertArrayEqual(persisted, []);
    } finally { _teardown(); }
  });
});

// ── Settings persistence ─────────────────────────────────────────────────

describe('Todoist — settings persistence', () => {
  it('setDefaultProjectId / getDefaultProjectId roundtrip + clear', () => {
    _setup();
    try {
      assertEqual(Todoist.getDefaultProjectId(), null);
      Todoist.setDefaultProjectId('p1');
      assertEqual(Todoist.getDefaultProjectId(), 'p1');
      Todoist.setDefaultProjectId(null);
      assertEqual(Todoist.getDefaultProjectId(), null);
    } finally { _teardown(); }
  });

  it('setDefaultFilter / getDefaultFilter roundtrip; default is "today"', () => {
    _setup();
    try {
      // First read with no setter call returns the default.
      assertEqual(Todoist.getDefaultFilter(), 'today');
      Todoist.setDefaultFilter('today | overdue');
      assertEqual(Todoist.getDefaultFilter(), 'today | overdue');
      Todoist.setDefaultFilter(null);
      // Cleared → back to default.
      assertEqual(Todoist.getDefaultFilter(), 'today');
    } finally { _teardown(); }
  });
});

// ── drainQueue failed-count (R7 — AUDIT-2026-06-13) ──────────────────────
//
// A transient ('leave') failure stops the drain to preserve FIFO order, but
// the not-yet-attempted ops are DEFERRED, not failed. Pre-fix the 'leave'
// branch set `failed = queue.length`, reporting every remaining op as a
// failure (e.g. 3 queued, op #1 stalls → failed:3 instead of 1).

describe('Todoist — drainQueue failed-count (R7)', () => {
  it('a transient stop on the first op counts failed:1, not the whole queue', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _setOffline(true);
      await Todoist.closeTask('A');
      await Todoist.closeTask('B');
      await Todoist.closeTask('C');
      _setOffline(false);

      _queueResponse(503, ''); // A fails transiently; B and C never attempted
      const r = await Todoist.drainQueue();
      assertEqual(r.ok, true);
      assertEqual(r.drained, 0, 'nothing drained — stopped at the first op');
      assertEqual(r.failed, 1, 'only the one transient op counts as failed (was queue.length=3)');
      assertEqual(_fetchCalls.length, 1, 'drain stopped after the first failure');
      const persisted = JSON.parse(localStorage.getItem('todoist_pending_ops'));
      assertEqual(persisted.length, 3, 'all three ops remain queued for retry');
    } finally { _teardown(); }
  });

  it('counts only the transient op even after earlier ops drained', async () => {
    _setup();
    try {
      Todoist.setToken('tkn');
      _setOffline(true);
      await Todoist.closeTask('A');
      await Todoist.closeTask('B');
      await Todoist.closeTask('C');
      _setOffline(false);

      _queueResponse(204, ''); // A succeeds
      _queueResponse(503, ''); // B stalls transiently; C never attempted
      const r = await Todoist.drainQueue();
      assertEqual(r.drained, 1, 'A drained');
      assertEqual(r.failed, 1, 'only B counted as failed — C was never attempted (pre-fix this was 2)');
      assertEqual(_fetchCalls.length, 2, 'stopped after B');
      const persisted = JSON.parse(localStorage.getItem('todoist_pending_ops'));
      assertEqual(persisted.length, 2, 'B and C remain queued');
    } finally { _teardown(); }
  });
});
