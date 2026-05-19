// native-sync-parity — SyncFirestore.subscribe native-branch tests.
//
// Coverage (per docs/sync-impl/audits/native-sync-parity-AUDIT.md § "Test scope"):
//   1. Native happy path — addCollectionSnapshotListener event → caller gets
//      { docs: [{id, data}, ...], count: N }
//   2. Native unsubscribe-before-load race — sync unsubscribe() called before
//      addCollectionSnapshotListener resolves; assert no callback fires +
//      removeSnapshotListener called exactly once
//   3. Native error mid-stream — plugin callback fired as (null, error);
//      caller receives { ok: false, error: { kind: 'permission-denied', ... } }
//   4. Native callback-throw safety — caller's callback throws on event 1;
//      event 2 still arrives (listener stays alive)
//   5. Native SYNC_DISABLED fast-path — flag off → subscribe() throws
//      { kind: 'unknown', message: 'SYNC_DISABLED' } synchronously
//   6. Native path normalization — '/users/foo/meds' and 'users/foo/meds'
//      both produce reference: 'users/foo/meds' in plugin options
//   7. Native isNative=false fallthrough sanity — source-level check that the
//      `if (isNative)` branch exists + the web branch is reachable
//   8. removeSnapshotListener resilience — stub throws/rejects on tear-down;
//      unsubscribe fn does not propagate
//
// Test harness setup (CRITICAL — see "Native branch unlock" below):
//   The native branch at sync-firestore.js:439 is gated on `isNative`, a
//   const captured at module load from `window.Capacitor.isNativePlatform()`.
//   To exercise the native branch, tests/index.html now includes an inline
//   pre-script ABOVE the sync-firestore.js <script> tag that sets:
//     window.Capacitor = { isNativePlatform: () => true, Plugins: {} };
//   The closure-captured `plugins` reference is the SAME OBJECT as
//   window.Capacitor.Plugins, so mutating `window.Capacitor.Plugins.FirebaseFirestore`
//   per-test propagates into the closure's `_nativePlugin()` helper.
//
//   This pre-script does NOT affect other tests because:
//     - js/platform.js is not loaded in tests/index.html (no haptic routing).
//     - All other sync tests stub SyncFirestore.* methods directly.
//     - SyncEngine and SyncBuffer do not capture isNative anywhere.
//
//   Case 7 (web fallthrough) can't be runtime-verified because we can't
//   un-flip `isNative` post-load. We use source-level (.toString()) checks
//   instead — same convention as tests/sync-uploader.test.js:1080-1081 for
//   the documented-native-gap test.

// ── Shared helpers ──────────────────────────────────────────────────────

function _nsp_saveEnv() {
  return {
    sync_flag_storage: localStorage.getItem('tempo_sync_enabled'),
    flag_enabled: SyncFlag.isEnabled,
    plugin: (window.Capacitor && window.Capacitor.Plugins)
      ? window.Capacitor.Plugins.FirebaseFirestore
      : undefined,
  };
}

function _nsp_restore(saved) {
  SyncFlag.isEnabled = saved.flag_enabled;
  if (saved.sync_flag_storage === null) localStorage.removeItem('tempo_sync_enabled');
  else localStorage.setItem('tempo_sync_enabled', saved.sync_flag_storage);
  if (window.Capacitor && window.Capacitor.Plugins) {
    if (saved.plugin === undefined) delete window.Capacitor.Plugins.FirebaseFirestore;
    else window.Capacitor.Plugins.FirebaseFirestore = saved.plugin;
  }
}

// Install signed-in flag + reset plugin to a clean per-test stub. Returns
// the plugin object so tests can attach addCollectionSnapshotListener +
// removeSnapshotListener stubs to it.
function _nsp_install() {
  SyncFlag.isEnabled = () => true;
  localStorage.setItem('tempo_sync_enabled', '1');
  if (!window.Capacitor || !window.Capacitor.Plugins) {
    throw new Error('pre-script in tests/index.html must set up window.Capacitor.Plugins — native-branch tests require it');
  }
  const plugin = {};
  window.Capacitor.Plugins.FirebaseFirestore = plugin;
  return plugin;
}

// Sanity guard — bail out of native-branch tests early if the pre-script
// didn't install Capacitor (e.g., tests/index.html edits weren't applied).
function _nsp_isNativeHarness() {
  return !!(window.Capacitor &&
            typeof window.Capacitor.isNativePlatform === 'function' &&
            window.Capacitor.isNativePlatform());
}

// Wait one event-loop tick so the (async () => { ... })() IIFE inside
// subscribe() runs and registers the listener. We pass a small extra
// delay so any awaited plugin promise has a chance to settle.
function _nsp_tick(ms) {
  return new Promise(r => setTimeout(r, ms || 5));
}

// ── Pre-flight harness check ────────────────────────────────────────────

describe('SyncFirestore native branch — harness setup', () => {

  it('pre-script installed window.Capacitor with isNativePlatform=true', () => {
    assert(_nsp_isNativeHarness(),
      'tests/index.html must include the native pre-script BEFORE sync-firestore.js');
  });

});

// ── Native happy path + path normalization ──────────────────────────────

describe('SyncFirestore.subscribe — native happy path', () => {

  it('1. native happy path — plugin event converts to { docs, count } shape', async () => {
    const saved = _nsp_saveEnv();
    try {
      if (!_nsp_isNativeHarness()) {
        throw new Error('native pre-script missing in tests/index.html');
      }
      const plugin = _nsp_install();

      let registeredCallback = null;
      let registeredOptions = null;
      plugin.addCollectionSnapshotListener = (options, cb) => {
        registeredOptions = options;
        registeredCallback = cb;
        return Promise.resolve({ callbackId: 'cb-1' });
      };
      plugin.removeSnapshotListener = () => Promise.resolve();

      const received = [];
      const unsub = SyncFirestore.subscribe('users/u/meds', (payload) => {
        received.push(payload);
      });
      assertEqual(typeof unsub, 'function', 'subscribe returns a function');

      // Let the async IIFE register the listener.
      await _nsp_tick(10);
      assert(registeredCallback !== null,
        'addCollectionSnapshotListener was called');
      assertEqual(registeredOptions.reference, 'users/u/meds',
        'options.reference is the normalized path');

      // Fire a synthetic plugin event with two docs.
      registeredCallback(
        { snapshots: [
          { id: 'a', data: { name: 'A', schemaVersion: 1 } },
          { id: 'b', data: { name: 'B', schemaVersion: 1 } },
        ] },
        null
      );

      assertEqual(received.length, 1,
        'caller callback invoked exactly once');
      assertEqual(received[0].count, 2, 'count is 2');
      assert(Array.isArray(received[0].docs), 'docs is an array');
      assertEqual(received[0].docs.length, 2, 'docs.length is 2');
      assertEqual(received[0].docs[0].id, 'a', 'docs[0].id is "a"');
      assertEqual(received[0].docs[0].data.name, 'A', 'docs[0].data is the data property');
      assertEqual(received[0].docs[1].id, 'b', 'docs[1].id is "b"');
      assertEqual(received[0].docs[1].data.name, 'B', 'docs[1].data is the data property');

      // Tear down cleanly.
      unsub();
    } finally {
      _nsp_restore(saved);
    }
  });

  it('6. native path normalization — leading slash stripped via _normPath', async () => {
    const saved = _nsp_saveEnv();
    try {
      if (!_nsp_isNativeHarness()) {
        throw new Error('native pre-script missing in tests/index.html');
      }
      const plugin = _nsp_install();

      const captured = [];
      plugin.addCollectionSnapshotListener = (options, _cb) => {
        captured.push(options.reference);
        return Promise.resolve({ callbackId: 'cb-' + captured.length });
      };
      plugin.removeSnapshotListener = () => Promise.resolve();

      const unsub1 = SyncFirestore.subscribe('/users/foo/meds', () => {});
      const unsub2 = SyncFirestore.subscribe('users/foo/meds', () => {});
      await _nsp_tick(10);

      assertEqual(captured.length, 2, 'both subscribes registered');
      assertEqual(captured[0], 'users/foo/meds',
        'leading-slash form normalized to users/foo/meds');
      assertEqual(captured[1], 'users/foo/meds',
        'no-slash form normalized to users/foo/meds');
      assertEqual(captured[0], captured[1],
        'both forms produce identical reference strings');

      unsub1();
      unsub2();
    } finally {
      _nsp_restore(saved);
    }
  });

});

// ── Native error path ──────────────────────────────────────────────────

describe('SyncFirestore.subscribe — native error mid-stream', () => {

  it('3. native error mid-stream — plugin error code normalizes to permission-denied', async () => {
    const saved = _nsp_saveEnv();
    try {
      if (!_nsp_isNativeHarness()) {
        throw new Error('native pre-script missing in tests/index.html');
      }
      const plugin = _nsp_install();

      let registeredCallback = null;
      plugin.addCollectionSnapshotListener = (_opts, cb) => {
        registeredCallback = cb;
        return Promise.resolve({ callbackId: 'cb-3' });
      };
      plugin.removeSnapshotListener = () => Promise.resolve();

      const received = [];
      const unsub = SyncFirestore.subscribe('users/u/meds', (payload) => {
        received.push(payload);
      });
      await _nsp_tick(10);
      assert(registeredCallback !== null, 'listener registered');

      // Fire the plugin callback with an error envelope.
      const pluginErr = {
        code: 'FIRESTORE/permission-denied',
        message: 'Missing or insufficient permissions.',
      };
      registeredCallback(null, pluginErr);

      assertEqual(received.length, 1, 'caller callback invoked once on error');
      assertEqual(received[0].ok, false, 'payload.ok is false');
      assert(received[0].error, 'payload.error is present');
      assertEqual(received[0].error.kind, 'permission-denied',
        'kind: permission-denied (FIRESTORE/* prefix matched)');
      assertEqual(received[0].error.isRetryable, false,
        'permission-denied is not retryable');
      assert(received[0].error.message.indexOf('Missing or insufficient permissions') !== -1,
        'message preserved through normalization');
      assertEqual(received[0].error.originalError, pluginErr,
        'originalError preserved verbatim');

      unsub();
    } finally {
      _nsp_restore(saved);
    }
  });

});

// ── Native callback-throw safety ───────────────────────────────────────

describe('SyncFirestore.subscribe — native callback-throw safety', () => {

  it('4. caller callback throws on event 1 — event 2 still arrives (listener alive)', async () => {
    const saved = _nsp_saveEnv();
    try {
      if (!_nsp_isNativeHarness()) {
        throw new Error('native pre-script missing in tests/index.html');
      }
      const plugin = _nsp_install();

      let registeredCallback = null;
      plugin.addCollectionSnapshotListener = (_opts, cb) => {
        registeredCallback = cb;
        return Promise.resolve({ callbackId: 'cb-4' });
      };
      plugin.removeSnapshotListener = () => Promise.resolve();

      let eventCount = 0;
      const unsub = SyncFirestore.subscribe('users/u/meds', (payload) => {
        eventCount++;
        if (eventCount === 1) {
          // Throw on the first event — the listener must catch it.
          throw new Error('caller blew up');
        }
        // Stash the second event for assertion.
        payload._seen = true;
      });
      await _nsp_tick(10);

      // Event 1 — caller throws inside the listener callback.
      registeredCallback(
        { snapshots: [{ id: 'x', data: { v: 1 } }] },
        null
      );
      assertEqual(eventCount, 1, 'event 1 invoked the caller');

      // Event 2 — must still arrive. If the listener died on event 1, this
      // would never reach the caller.
      registeredCallback(
        { snapshots: [{ id: 'y', data: { v: 2 } }] },
        null
      );
      assertEqual(eventCount, 2,
        'event 2 still arrived — listener survived caller throw on event 1');

      unsub();
    } finally {
      _nsp_restore(saved);
    }
  });

});

// ── Native SYNC_DISABLED fast-path ──────────────────────────────────────

describe('SyncFirestore.subscribe — SYNC_DISABLED fast-path', () => {

  it('5. SYNC_DISABLED — throws { kind: unknown, message: SYNC_DISABLED } synchronously without plugin call', () => {
    const saved = _nsp_saveEnv();
    try {
      // Flag OFF — the SYNC_DISABLED check at line 433 fires BEFORE the
      // `if (isNative)` branch, so this works regardless of native state.
      SyncFlag.isEnabled = () => false;
      localStorage.setItem('tempo_sync_enabled', '0');

      // Plant a tripwire on the plugin — if subscribe ever calls into it,
      // the test fails.
      let pluginCalled = false;
      if (window.Capacitor && window.Capacitor.Plugins) {
        window.Capacitor.Plugins.FirebaseFirestore = {
          addCollectionSnapshotListener: () => { pluginCalled = true; return Promise.resolve({ callbackId: 'nope' }); },
          removeSnapshotListener: () => Promise.resolve(),
        };
      }

      let threw = null;
      try {
        SyncFirestore.subscribe('users/u/meds', () => {});
      } catch (e) { threw = e; }
      assert(threw !== null, 'subscribe must throw when flag off');
      assertEqual(threw.kind, 'unknown', 'kind: unknown');
      assertEqual(threw.message, 'SYNC_DISABLED', 'message: SYNC_DISABLED');
      assertEqual(pluginCalled, false,
        'addCollectionSnapshotListener was NOT called');
    } finally {
      _nsp_restore(saved);
    }
  });

});

// ── Native unsubscribe-before-load race ─────────────────────────────────

describe('SyncFirestore.subscribe — unsubscribe-before-load race', () => {

  it('2. sync unsubscribe before addCollectionSnapshotListener resolves — no callback fires + removeSnapshotListener called once', async () => {
    const saved = _nsp_saveEnv();
    try {
      if (!_nsp_isNativeHarness()) {
        throw new Error('native pre-script missing in tests/index.html');
      }
      const plugin = _nsp_install();

      // Hold the addCollectionSnapshotListener promise open via a manual
      // resolver so we can call unsubscribe() BEFORE it settles.
      let resolveAddListener = null;
      let registeredCallback = null;
      plugin.addCollectionSnapshotListener = (_opts, cb) => {
        registeredCallback = cb;
        return new Promise((resolve) => { resolveAddListener = resolve; });
      };
      let removeCalls = 0;
      let removeArgs = null;
      plugin.removeSnapshotListener = (args) => {
        removeCalls++;
        removeArgs = args;
        return Promise.resolve();
      };

      const received = [];
      const unsub = SyncFirestore.subscribe('users/u/meds', (payload) => {
        received.push(payload);
      });

      // Synchronously unsubscribe BEFORE the plugin promise resolves.
      // Per the engine contract, this should flag _cancelled = true so the
      // post-await teardown fires.
      unsub();

      // Now let the plugin promise resolve.
      assert(resolveAddListener, 'addCollectionSnapshotListener registered');
      resolveAddListener({ callbackId: 'cb-2' });

      // Let the IIFE finish its post-await tear-down.
      await _nsp_tick(15);

      // Caller's callback must NOT have been invoked — registration was
      // cancelled before any event could fire.
      assertEqual(received.length, 0,
        'no callback fired after unsubscribe-before-load');

      // removeSnapshotListener called exactly once with the captured id.
      assertEqual(removeCalls, 1,
        'removeSnapshotListener called exactly once on cancellation');
      assertEqual(removeArgs.callbackId, 'cb-2',
        'removeSnapshotListener called with the captured callbackId');

      // Calling unsub again must be safe — _callbackId was nulled on the
      // first tear-down, so the second call is a no-op.
      const before = removeCalls;
      unsub();
      assertEqual(removeCalls, before,
        'second unsub call is a no-op (already torn down)');
      // The fact that registeredCallback exists but was never invoked is
      // not directly observable — we rely on received.length === 0 above.
      void registeredCallback;
    } finally {
      _nsp_restore(saved);
    }
  });

});

// ── removeSnapshotListener resilience ──────────────────────────────────

describe('SyncFirestore.subscribe — removeSnapshotListener resilience', () => {

  it('8. removeSnapshotListener throws on tear-down — unsubscribe fn swallows + does not propagate', async () => {
    const saved = _nsp_saveEnv();
    try {
      if (!_nsp_isNativeHarness()) {
        throw new Error('native pre-script missing in tests/index.html');
      }
      const plugin = _nsp_install();

      plugin.addCollectionSnapshotListener = (_opts, _cb) => {
        return Promise.resolve({ callbackId: 'cb-8' });
      };
      // Throw synchronously on tear-down — the wrapper's try { ... } catch (_) {}
      // pattern must swallow it.
      plugin.removeSnapshotListener = () => {
        throw new Error('removeSnapshotListener exploded');
      };

      const unsub = SyncFirestore.subscribe('users/u/meds', () => {});
      // Let the async IIFE register the listener so _callbackId is set.
      await _nsp_tick(10);

      // Now tear down — must not propagate the throw.
      let propagatedErr = null;
      try {
        unsub();
      } catch (e) {
        propagatedErr = e;
      }
      assert(propagatedErr === null,
        'unsubscribe fn must swallow removeSnapshotListener throws (try/catch (_) {} contract)');
    } finally {
      _nsp_restore(saved);
    }
  });

});

// ── Native isNative=false fallthrough sanity (source-level) ────────────

describe('SyncFirestore.subscribe — isNative=false fallthrough sanity', () => {

  it('7. source-level — subscribe() contains `if (isNative)` guard + a web fallthrough using _getWebDb / onSnapshot', () => {
    // We can't runtime-test the `isNative === false` branch from the same
    // module-load session that the pre-script flipped to native. Instead
    // we verify the code STRUCTURE — the same pattern tests/sync-uploader.test.js
    // uses at the documented-native-gap test (lines 1077-1081).
    const src = SyncFirestore.subscribe.toString();

    // Native branch is the `if (isNative)` block — guards the native path.
    assert(/if\s*\(\s*isNative\s*\)/.test(src),
      'subscribe must branch on `if (isNative)` so non-native callers fall through to the web path');

    // Web fallthrough uses _getWebDb (cached lazy SDK load) + sdk.onSnapshot.
    assert(/_getWebDb/.test(src),
      'web fallthrough uses _getWebDb for the lazy-loaded Firestore handle');
    assert(/onSnapshot/.test(src),
      'web fallthrough invokes onSnapshot from the cached SDK reference');

    // Both branches share the deferred-unsubscribe closure shape.
    assert(/_cancelled/.test(src),
      'shared deferred-unsubscribe pattern uses a _cancelled flag');

    // Web fallthrough is reachable — there must be code AFTER the
    // `if (isNative)` block that doesn't sit inside the native branch.
    // The pattern is: native block ends with `return function unsubscribe() { ... };`
    // then the web code follows.
    const nativeReturnIdx = src.indexOf('return function unsubscribe');
    assert(nativeReturnIdx > 0,
      'native branch ends with a return statement');
    const remainder = src.slice(nativeReturnIdx);
    assert(/onSnapshot/.test(remainder),
      'web fallthrough code (onSnapshot) appears after the native return — fallthrough is reachable');
  });

});
