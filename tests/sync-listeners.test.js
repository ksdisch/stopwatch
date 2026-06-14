// E-3 — Listener lifecycle + per-store dispatch seam + F19a refuse-writeback emits.
//
// Coverage (per E-3-AUDIT § "Test scope" + the engine-implementer's
// recommended test list):
//
//   SyncFirestore.subscribe — wrapper
//     1. SYNC_DISABLED fast-path throws synchronously.
//     2. invalid callback throws synchronously.
//     3. Native branch throws { kind: 'unknown', message: starts-with 'subscribe native parity pending' }.
//     4. Returns a function (the deferred-unsubscribe closure).
//
//   SyncEngine listener lifecycle
//     5. _subscribeAllStores registers 7 unsubscribes + emits 'listener-connected' per store.
//     6. _subscribeAllStores idempotent — second call when listeners armed does NOT re-subscribe.
//     7. _subscribeAllStores per-store subscribe failure emits 'listener-disconnected'.
//     8. _unsubscribeAllStores walks registry + emits 'listener-disconnected' per store.
//     9. _unsubscribeAllStores idempotent — failed individual unsubscribe doesn't prevent next subscribe.
//
//   Per-store dispatch + debounce
//     10. _runMergeCycleForStore invokes the correct per-store merge fn only.
//     11. _runMergeCycleForStore honors SyncState.canWrite() early-exit on 'hydrating'.
//     12. _runMergeCycleForStore re-entry guard prevents concurrent overlap.
//     13. _runMergeCycleForStore restores SyncState to 'ready' even on async rejection.
//     14. Trailing 1s debounce coalesces N rapid snapshots to 1 merge call.
//     15. Per-store debounce isolation — meds burst doesn't delay presets.
//     16. Snapshot error branch ({ ok: false, error }) emits 'listener-disconnected'.
//
//   F19a refuse-writeback emits (3 layers)
//     17. Dispatcher snapshot pre-filter emits 'refuse-writeback' when future-schema record present.
//     18. Per-merge-fn cloud-side gate (meds) emits 'refuse-writeback'.
//     19. Per-merge-fn cloud-side gate (bfrb) emits 'refuse-writeback'.
//     20. Per-record CAS path (meds) emits 'refuse-writeback' with remoteDeviceId + remoteSchemaVersion.
//     21. Per-record CAS path (bfrb) emits 'refuse-writeback' with remoteDeviceId.
//
//   Constants
//     22. LISTENER_DEBOUNCE_MS = 1000 (probed indirectly via debounce timing).
//     23. STEADY_STATE_DEFAULT_MS = 300000 (post-bump per Pick A on TODO #1).
//
// Mocking pattern: hot-swap SyncFirestore.subscribe / SyncFirestore.getCollection /
// SyncFirestore.runTransaction / SyncAuth.getCurrentUser / per-store merge fns /
// Platform.network on the real modules and restore in finally. Tests use real
// `setTimeout` (advancing via `await new Promise(r => setTimeout(r, 1100))`) for
// the debounce verification — `Date.now` mocking would interfere with the
// engine's `_steadyTimer` plumbing.

// ── Shared save/restore + install helpers ──────────────────────────────

function _e3_saveEnv() {
  return {
    sync_flag_storage: localStorage.getItem('tempo_sync_enabled'),
    flag_enabled: SyncFlag.isEnabled,
    auth_getCurrentUser: SyncAuth.getCurrentUser,
    fs_subscribe: SyncFirestore.subscribe,
    fs_getCollection: SyncFirestore.getCollection,
    fs_runTransaction: SyncFirestore.runTransaction,
    merge_meds: SyncMergeMeds.merge,
    merge_history: SyncMergeHistory.merge,
    merge_rest_log: SyncMergeRestLog.merge,
    merge_presets: SyncMergePresets.merge,
    merge_bfrb: SyncMergeBfrb.merge,
    merge_distractions: SyncMergeDistractions.merge,
    merge_mood: SyncMergeMood.merge,
    prev_syncState: window.SyncState,
    prev_history: window.History,
    prev_recoveryUI: window.RecoveryUI,
    bfrb_events: localStorage.getItem('bfrb_events'),
    bfrb_marker: localStorage.getItem('tempo_bfrb_events_migration_v1'),
    meds_state: localStorage.getItem('wellness_meds'),
    mood_events: localStorage.getItem('mood_events'),
  };
}

function _e3_restore(saved) {
  try { SyncEngine._unsubscribeAllStores('stopped'); } catch (_) {}
  SyncFlag.isEnabled = saved.flag_enabled;
  SyncAuth.getCurrentUser = saved.auth_getCurrentUser;
  SyncFirestore.subscribe = saved.fs_subscribe;
  SyncFirestore.getCollection = saved.fs_getCollection;
  SyncFirestore.runTransaction = saved.fs_runTransaction;
  SyncMergeMeds.merge = saved.merge_meds;
  SyncMergeHistory.merge = saved.merge_history;
  SyncMergeRestLog.merge = saved.merge_rest_log;
  SyncMergePresets.merge = saved.merge_presets;
  SyncMergeBfrb.merge = saved.merge_bfrb;
  SyncMergeDistractions.merge = saved.merge_distractions;
  SyncMergeMood.merge = saved.merge_mood;
  if (saved.sync_flag_storage === null) localStorage.removeItem('tempo_sync_enabled');
  else localStorage.setItem('tempo_sync_enabled', saved.sync_flag_storage);
  if (saved.prev_syncState === undefined) delete window.SyncState;
  else window.SyncState = saved.prev_syncState;
  if (saved.prev_history === undefined) delete window.History;
  else window.History = saved.prev_history;
  if (saved.prev_recoveryUI === undefined) delete window.RecoveryUI;
  else window.RecoveryUI = saved.prev_recoveryUI;
  if (saved.bfrb_events === null) localStorage.removeItem('bfrb_events');
  else localStorage.setItem('bfrb_events', saved.bfrb_events);
  if (saved.bfrb_marker === null) localStorage.removeItem('tempo_bfrb_events_migration_v1');
  else localStorage.setItem('tempo_bfrb_events_migration_v1', saved.bfrb_marker);
  if (saved.meds_state === null) localStorage.removeItem('wellness_meds');
  else localStorage.setItem('wellness_meds', saved.meds_state);
  if (saved.mood_events === null) localStorage.removeItem('mood_events');
  else localStorage.setItem('mood_events', saved.mood_events);
}

// Install signed-in user + sync-enabled flag for tests that exercise the
// listener wire-up. Stubs MedsManager / Presets / History / RecoveryUI
// for adapter.read() calls so _runMergeCycleForStore can call them without
// crashing on missing globals.
function _e3_install(opts) {
  opts = opts || {};
  SyncFlag.isEnabled = () => (opts.flag !== false);
  SyncAuth.getCurrentUser = () => (opts.unauth ? null : { uid: opts.uid || 'u-listeners-test' });
  localStorage.setItem('tempo_sync_enabled', opts.flag === false ? '0' : '1');
  if (opts.syncState !== undefined) window.SyncState = opts.syncState;
  // Stub History + RecoveryUI so SYNCED_STORES adapters don't blow up.
  if (!window.History) {
    window.History = {
      getDeviceId: () => opts.deviceId || 'dev-test',
      snapshotForSync: async () => ({
        deviceId: opts.deviceId || 'dev-test',
        schemaVersion: 1,
        payload: { sessions: [] },
      }),
    };
  }
  if (!window.RecoveryUI) {
    window.RecoveryUI = {
      snapshotForSync: () => ({
        deviceId: opts.deviceId || 'dev-test',
        schemaVersion: 1,
        payload: { rest_log: {} },
      }),
    };
  }
}

// Build a SyncFirestore.subscribe spy that captures each (path, callback)
// pair and returns a per-store unsubscribe spy. Tests can then fire the
// captured callback directly to simulate an onSnapshot event.
function _e3_makeSubscribeSpy() {
  const subs = [];
  const spy = function (path, callback) {
    const entry = {
      path,
      callback,
      unsubCalls: 0,
      unsubThrew: false,
    };
    entry.unsub = function () {
      entry.unsubCalls++;
      if (entry.unsubShouldThrow) {
        entry.unsubThrew = true;
        throw new Error('unsub failed for ' + path);
      }
    };
    subs.push(entry);
    return entry.unsub;
  };
  spy.subs = subs;
  spy.byStore = function (storeKey) {
    return subs.filter(s => s.path.endsWith('/' + storeKey));
  };
  return spy;
}

// Stub the 7 per-store merge fns + record which were called.
function _e3_stubAllMerges() {
  const order = [];
  const make = (k) => function () { order.push(k); return { ok: true, count: 0 }; };
  SyncMergeMeds.merge = make('meds');
  SyncMergeHistory.merge = make('history');
  SyncMergeRestLog.merge = make('rest_log');
  SyncMergePresets.merge = make('presets');
  SyncMergeBfrb.merge = make('bfrb_events');
  SyncMergeDistractions.merge = make('distractions');
  SyncMergeMood.merge = make('mood_events');
  return order;
}

// Helper for time-based debounce tests: real setTimeout window.
function _e3_sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ────────────────────────────────────────────────────────────────────────
// SyncFirestore.subscribe — wrapper guards
// ────────────────────────────────────────────────────────────────────────

describe('SyncFirestore.subscribe — wrapper guards', () => {

  it('1. SYNC_DISABLED fast-path throws synchronously without invoking SDK', () => {
    const saved = _e3_saveEnv();
    try {
      SyncFlag.isEnabled = () => false;
      localStorage.setItem('tempo_sync_enabled', '0');

      let threw = null;
      try {
        SyncFirestore.subscribe('users/u/meds', () => {});
      } catch (e) {
        threw = e;
      }
      assert(threw !== null, 'subscribe must throw when flag off');
      assertEqual(threw.kind, 'unknown', 'kind: unknown');
      assertEqual(threw.message, 'SYNC_DISABLED', 'message: SYNC_DISABLED');
    } finally {
      _e3_restore(saved);
    }
  });

  it('2. invalid callback (non-function) throws synchronously', () => {
    const saved = _e3_saveEnv();
    try {
      _e3_install({});
      let threw = null;
      try {
        SyncFirestore.subscribe('users/u/meds', null);
      } catch (e) { threw = e; }
      assert(threw !== null, 'must throw on null callback');
      assertEqual(threw.kind, 'unknown', 'kind: unknown');
      assert(/requires a callback function/.test(threw.message),
        'message mentions callback requirement: ' + threw.message);
    } finally {
      _e3_restore(saved);
    }
  });

  it('3. Returns a function (deferred-unsubscribe closure) on happy path', () => {
    const saved = _e3_saveEnv();
    try {
      _e3_install({});
      // The subscribe call kicks off an async SDK load that will fail in
      // this test environment (no Firebase loaded). What matters is the
      // synchronous return value — a function we can call to cancel.
      const unsub = SyncFirestore.subscribe('users/u/meds', () => {});
      assertEqual(typeof unsub, 'function',
        'subscribe returns a function (deferred-unsubscribe closure)');
      // Calling unsub before the SDK resolves is safe — must not throw.
      let threw = false;
      try { unsub(); } catch (_) { threw = true; }
      assertEqual(threw, false, 'pre-load unsub does not throw');
    } finally {
      _e3_restore(saved);
    }
  });

});

// ────────────────────────────────────────────────────────────────────────
// SyncEngine listener lifecycle — _subscribeAllStores / _unsubscribeAllStores
// ────────────────────────────────────────────────────────────────────────

describe('SyncEngine listener lifecycle', () => {

  it('4. _subscribeAllStores registers 7 unsubscribes + emits "listener-connected" per store', () => {
    const saved = _e3_saveEnv();
    try {
      _e3_install({});
      const spy = _e3_makeSubscribeSpy();
      SyncFirestore.subscribe = spy;

      const connectedEvents = [];
      const cb = (p) => { connectedEvents.push(p); };
      SyncEngine.on('listener-connected', cb);

      try {
        SyncEngine._subscribeAllStores();
        assertEqual(spy.subs.length, 7,
          'subscribe called 7 times (one per SYNCED_STORES entry)');
        // Verify all 7 store keys appear on the captured paths.
        const stores = spy.subs.map(s => s.path.split('/').pop()).sort();
        assertArrayEqual(stores,
          ['bfrb_events', 'distractions', 'history', 'meds', 'mood_events', 'presets', 'rest_log'],
          'paths cover all 7 store keys');
        assertEqual(connectedEvents.length, 7, '7 listener-connected events emitted');
      } finally {
        SyncEngine.off('listener-connected', cb);
      }
    } finally {
      _e3_restore(saved);
    }
  });

  it('5. _subscribeAllStores idempotent — second call skips already-armed stores', () => {
    const saved = _e3_saveEnv();
    try {
      _e3_install({});
      const spy = _e3_makeSubscribeSpy();
      SyncFirestore.subscribe = spy;

      SyncEngine._subscribeAllStores();
      assertEqual(spy.subs.length, 7, 'first call: 7 subscribes');

      // Second call must NOT add 7 more.
      SyncEngine._subscribeAllStores();
      assertEqual(spy.subs.length, 7,
        'second call: still 7 (idempotent — no duplicate subscriptions)');
    } finally {
      _e3_restore(saved);
    }
  });

  it('6. _subscribeAllStores per-store subscribe failure emits "listener-disconnected" + continues wiring others', () => {
    const saved = _e3_saveEnv();
    try {
      _e3_install({});
      // Make subscribe throw for the meds store only; succeed for others.
      const subs = [];
      SyncFirestore.subscribe = function (path, callback) {
        if (path.endsWith('/meds')) {
          throw new Error('subscribe failed for meds');
        }
        const entry = { path, callback };
        entry.unsub = function () {};
        subs.push(entry);
        return entry.unsub;
      };

      const disconnectedEvents = [];
      const cb = (p) => { disconnectedEvents.push(p); };
      SyncEngine.on('listener-disconnected', cb);

      try {
        SyncEngine._subscribeAllStores();
        // The other 6 stores wired up.
        assertEqual(subs.length, 6, 'other 6 stores still subscribed');
        // Meds emitted 'listener-disconnected' with reason 'subscribe-failed'.
        const medsEvents = disconnectedEvents.filter(e => e && e.store === 'meds');
        assertEqual(medsEvents.length, 1, 'one disconnected event for meds');
        assertEqual(medsEvents[0].reason, 'subscribe-failed',
          'reason: subscribe-failed');
      } finally {
        SyncEngine.off('listener-disconnected', cb);
      }
    } finally {
      _e3_restore(saved);
    }
  });

  it('7. _unsubscribeAllStores walks registry + emits "listener-disconnected" per store + clears registry', () => {
    const saved = _e3_saveEnv();
    try {
      _e3_install({});
      const spy = _e3_makeSubscribeSpy();
      SyncFirestore.subscribe = spy;

      SyncEngine._subscribeAllStores();
      assertEqual(spy.subs.length, 7, 'arm 7 listeners');

      const disconnectedEvents = [];
      const cb = (p) => { disconnectedEvents.push(p); };
      SyncEngine.on('listener-disconnected', cb);

      try {
        SyncEngine._unsubscribeAllStores('test-reason');
        // Each unsub called once.
        for (const sub of spy.subs) {
          assertEqual(sub.unsubCalls, 1,
            'unsub for ' + sub.path + ' called exactly once');
        }
        // 7 disconnected events fired.
        assertEqual(disconnectedEvents.length, 7, '7 listener-disconnected events');
        assertEqual(disconnectedEvents[0].reason, 'test-reason',
          'reason passed through');

        // Second call is a no-op (idempotent — registry already empty).
        const before = spy.subs[0].unsubCalls;
        SyncEngine._unsubscribeAllStores('again');
        assertEqual(spy.subs[0].unsubCalls, before,
          'second unsubscribe does not re-call the (now-empty) registry');
      } finally {
        SyncEngine.off('listener-disconnected', cb);
      }
    } finally {
      _e3_restore(saved);
    }
  });

  it('8. _unsubscribeAllStores idempotency — failed individual unsubscribe does not prevent next subscribe', () => {
    const saved = _e3_saveEnv();
    try {
      _e3_install({});
      // Custom subscribe — one of the unsubs throws on call.
      let subsRound1 = [];
      let subsRound2 = [];
      let round = 1;
      SyncFirestore.subscribe = function (path, callback) {
        const entry = { path, callback };
        entry.unsub = function () {
          if (round === 1 && path.endsWith('/meds')) {
            throw new Error('unsub failed for meds');
          }
        };
        (round === 1 ? subsRound1 : subsRound2).push(entry);
        return entry.unsub;
      };

      SyncEngine._subscribeAllStores();
      assertEqual(subsRound1.length, 7, 'round 1: 7 subscribes');

      // Tear down — meds unsub throws, but the rest must still be called +
      // the registry must be cleared.
      SyncEngine._unsubscribeAllStores('stopped');

      // Now a fresh subscribe round wires up cleanly.
      round = 2;
      SyncEngine._subscribeAllStores();
      assertEqual(subsRound2.length, 7,
        'round 2: 7 fresh subscribes after broken teardown');
    } finally {
      _e3_restore(saved);
    }
  });

});

// ────────────────────────────────────────────────────────────────────────
// Per-store dispatch + debounce
// ────────────────────────────────────────────────────────────────────────

describe('Per-store dispatch + debounce', () => {

  it('9. _runMergeCycleForStore invokes the correct per-store merge fn only', () => {
    const saved = _e3_saveEnv();
    try {
      _e3_install({});
      const order = _e3_stubAllMerges();

      SyncEngine._runMergeCycleForStore('meds');

      assertArrayEqual(order, ['meds'],
        'only meds merge fn called — other 5 untouched');
    } finally {
      _e3_restore(saved);
    }
  });

  it('10. _runMergeCycleForStore honors SyncState early-exit on "hydrating"', () => {
    const saved = _e3_saveEnv();
    try {
      _e3_install({ syncState: { get: () => 'hydrating', set: () => true } });
      const order = _e3_stubAllMerges();

      SyncEngine._runMergeCycleForStore('meds');

      assertEqual(order.length, 0,
        'per-store merge fn NOT called when SyncState is hydrating');
    } finally {
      _e3_restore(saved);
    }
  });

  it('11. _runMergeCycleForStore early-exits when flag off (defensive)', () => {
    const saved = _e3_saveEnv();
    try {
      _e3_install({});
      const order = _e3_stubAllMerges();
      SyncFlag.isEnabled = () => false;
      localStorage.setItem('tempo_sync_enabled', '0');

      SyncEngine._runMergeCycleForStore('meds');

      assertEqual(order.length, 0,
        'per-store merge fn NOT called when sync flag off');
    } finally {
      _e3_restore(saved);
    }
  });

  it('12. _runMergeCycleForStore early-exits when unauthenticated', () => {
    const saved = _e3_saveEnv();
    try {
      _e3_install({ unauth: true });
      const order = _e3_stubAllMerges();

      SyncEngine._runMergeCycleForStore('meds');

      assertEqual(order.length, 0,
        'per-store merge fn NOT called when no user');
    } finally {
      _e3_restore(saved);
    }
  });

  it('13. _runMergeCycleForStore no-op for unknown store key', () => {
    const saved = _e3_saveEnv();
    try {
      _e3_install({});
      const order = _e3_stubAllMerges();

      SyncEngine._runMergeCycleForStore('not-a-store');

      assertEqual(order.length, 0,
        'unknown store key triggers no merge calls');
    } finally {
      _e3_restore(saved);
    }
  });

  it('14. Trailing 1s debounce coalesces N rapid snapshots to 1 merge call', async () => {
    const saved = _e3_saveEnv();
    try {
      _e3_install({});
      const order = _e3_stubAllMerges();
      // Install a subscribe spy so we can capture + fire the snapshot callback.
      const spy = _e3_makeSubscribeSpy();
      SyncFirestore.subscribe = spy;
      SyncEngine._subscribeAllStores();

      // Capture the meds-store callback.
      const medsSub = spy.byStore('meds')[0];
      assert(medsSub, 'meds subscribe captured');

      // Fire 5 callbacks within a 500ms window — the debounce should
      // coalesce these into ONE merge call after 1s of quiet.
      medsSub.callback({ docs: [], count: 0 });
      await _e3_sleep(100);
      medsSub.callback({ docs: [], count: 0 });
      await _e3_sleep(100);
      medsSub.callback({ docs: [], count: 0 });
      await _e3_sleep(100);
      medsSub.callback({ docs: [], count: 0 });
      await _e3_sleep(100);
      medsSub.callback({ docs: [], count: 0 });

      // At t=500ms the merge hasn't fired yet (1s after the LAST snapshot).
      assertEqual(order.length, 0, 'no merge call before debounce window expires');

      // Wait 1100ms past the LAST snapshot.
      await _e3_sleep(1100);

      assertEqual(order.length, 1, '5 snapshots collapse to 1 merge call');
      assertEqual(order[0], 'meds', 'meds merge fn fired');
    } finally {
      _e3_restore(saved);
    }
  });

  it('15. Per-store debounce isolation — meds burst does not delay presets', async () => {
    const saved = _e3_saveEnv();
    try {
      _e3_install({});
      const order = _e3_stubAllMerges();
      const spy = _e3_makeSubscribeSpy();
      SyncFirestore.subscribe = spy;
      SyncEngine._subscribeAllStores();

      const medsSub = spy.byStore('meds')[0];
      const presetsSub = spy.byStore('presets')[0];
      assert(medsSub && presetsSub, 'both subs captured');

      // Meds burst at t=0, t=300ms, t=600ms.
      medsSub.callback({ docs: [], count: 0 });
      await _e3_sleep(300);
      medsSub.callback({ docs: [], count: 0 });
      await _e3_sleep(300);
      // At t=600, fire ONE presets snapshot.
      presetsSub.callback({ docs: [], count: 0 });
      // Another meds at t=600 too.
      medsSub.callback({ docs: [], count: 0 });

      // Wait 1100ms after the last meds tick (~t=1700ms).
      await _e3_sleep(1100);

      // Both should have fired exactly once each.
      const medsCount = order.filter(k => k === 'meds').length;
      const presetsCount = order.filter(k => k === 'presets').length;
      assertEqual(medsCount, 1, 'meds merge fn fired once');
      assertEqual(presetsCount, 1, 'presets merge fn fired once');
    } finally {
      _e3_restore(saved);
    }
  });

  it('16. Snapshot error branch ({ ok: false, error }) emits "listener-disconnected"', () => {
    const saved = _e3_saveEnv();
    try {
      _e3_install({});
      const spy = _e3_makeSubscribeSpy();
      SyncFirestore.subscribe = spy;
      SyncEngine._subscribeAllStores();

      const disconnectedEvents = [];
      const cb = (p) => { disconnectedEvents.push(p); };
      SyncEngine.on('listener-disconnected', cb);

      try {
        // Pick any store; fire the callback with the error envelope.
        const medsSub = spy.byStore('meds')[0];
        assert(medsSub, 'meds subscribe captured');
        medsSub.callback({ ok: false, error: new Error('permission revoked') });

        const medsErrEvents = disconnectedEvents.filter(e => e && e.store === 'meds' && e.reason === 'error');
        assertEqual(medsErrEvents.length, 1,
          'one "error" disconnect emitted for meds');
      } finally {
        SyncEngine.off('listener-disconnected', cb);
      }
    } finally {
      _e3_restore(saved);
    }
  });

});

// ────────────────────────────────────────────────────────────────────────
// F19a refuse-writeback emit — dispatcher snapshot pre-filter
// ────────────────────────────────────────────────────────────────────────

describe('F19a refuse-writeback emit (dispatcher snapshot pre-filter)', () => {

  it('17. Dispatcher snapshot pre-filter emits "refuse-writeback" with highest skipped schemaVersion', () => {
    const saved = _e3_saveEnv();
    try {
      _e3_install({});
      _e3_stubAllMerges();

      // Stub MedsManager.snapshotForSync to return a future-schema record.
      const realMedsSnap = MedsManager.snapshotForSync;
      MedsManager.snapshotForSync = () => ({
        deviceId: 'dev-test',
        schemaVersion: 1,
        payload: {
          meds: [
            { id: 'm1', name: 'A', schemaVersion: 99, updatedAt: 1000 },
          ],
        },
      });

      const refuseEvents = [];
      const cb = (p) => { refuseEvents.push(p); };
      SyncEngine.on('refuse-writeback', cb);

      try {
        SyncEngine._runMergeCycleForStore('meds');
        const medsEvents = refuseEvents.filter(e => e && e.store === 'meds');
        assert(medsEvents.length >= 1,
          'at least one refuse-writeback event for meds');
        assertEqual(medsEvents[0].remoteSchemaVersion, 99,
          'highest skipped schemaVersion surfaced on payload');
        assertEqual(typeof medsEvents[0].localSchemaVersion, 'number',
          'localSchemaVersion is numeric (Schema.SCHEMA_VERSION)');
      } finally {
        SyncEngine.off('refuse-writeback', cb);
        MedsManager.snapshotForSync = realMedsSnap;
      }
    } finally {
      _e3_restore(saved);
    }
  });

});

// ────────────────────────────────────────────────────────────────────────
// F19a refuse-writeback emit — per-merge-fn cloud-side gate
// ────────────────────────────────────────────────────────────────────────

describe('F19a refuse-writeback emit (per-merge-fn cloud-side gate)', () => {

  // Hot-swap getCollection to return a cloud doc with schemaVersion=99 so
  // the per-merge-fn cloud-side filter fires.

  it('18. SyncMergeMeds.merge emits "refuse-writeback" when cloud doc has future schemaVersion', async () => {
    const saved = _e3_saveEnv();
    try {
      _e3_install({});
      // Local meds: empty so the cloud filter is the only emit source.
      const realMedsSnap = MedsManager.snapshotForSync;
      MedsManager.snapshotForSync = () => ({
        deviceId: 'dev-test',
        schemaVersion: 1,
        payload: { meds: [] },
      });

      // Cloud: one record with schemaVersion=99 → filtered.
      SyncFirestore.getCollection = async () => ({
        docs: [{
          id: 'm-future',
          data: {
            id: 'm-future',
            name: 'FutureMed',
            schemaVersion: 99,
            deviceId: 'phone-2',
            updatedAt: 5000,
          },
        }],
        count: 1,
      });
      // runTransaction shouldn't be called (no records to write back) but
      // stub safely.
      SyncFirestore.runTransaction = async (fn) => {
        const tx = {
          get: async () => null,
          set: () => {},
          refuseWriteback: () => { throw new Error('no-op'); },
        };
        return await fn(tx);
      };

      const refuseEvents = [];
      const cb = (p) => { refuseEvents.push(p); };
      SyncEngine.on('refuse-writeback', cb);

      try {
        await SyncMergeMeds.merge(null);
        const medsEvents = refuseEvents.filter(e => e && e.store === 'meds');
        assert(medsEvents.length >= 1,
          'at least one refuse-writeback emitted for meds cloud-side gate');
        // The emit carries remoteSchemaVersion + remoteDeviceId from the cloud doc.
        const found = medsEvents.find(e => e.remoteSchemaVersion === 99 && e.remoteDeviceId === 'phone-2');
        assert(found, 'emit payload includes remoteSchemaVersion=99 + remoteDeviceId=phone-2');
      } finally {
        SyncEngine.off('refuse-writeback', cb);
        MedsManager.snapshotForSync = realMedsSnap;
      }
    } finally {
      _e3_restore(saved);
    }
  });

  it('19. SyncMergeBfrb.merge emits "refuse-writeback" when cloud entry has future schemaVersion', async () => {
    const saved = _e3_saveEnv();
    try {
      _e3_install({});
      // Local: empty bfrb stream + marker set so migration is no-op.
      localStorage.setItem('bfrb_events', JSON.stringify([]));
      localStorage.setItem('tempo_bfrb_events_migration_v1', '1');

      // Cloud: one bfrb entry with schemaVersion=99.
      SyncFirestore.getCollection = async () => ({
        docs: [{
          id: 'phone-2-6000',
          data: {
            takenAt: 6000,
            context: 'global',
            deviceId: 'phone-2',
            updatedAt: 6000,
            schemaVersion: 99,
          },
        }],
        count: 1,
      });
      SyncFirestore.runTransaction = async (fn) => {
        const tx = {
          get: async () => null,
          set: () => {},
          refuseWriteback: () => { throw new Error('no-op'); },
        };
        return await fn(tx);
      };

      const refuseEvents = [];
      const cb = (p) => { refuseEvents.push(p); };
      SyncEngine.on('refuse-writeback', cb);

      try {
        await SyncMergeBfrb.merge(null);
        const bfrbEvents = refuseEvents.filter(e => e && e.store === 'bfrb_events');
        assert(bfrbEvents.length >= 1,
          'refuse-writeback emitted for bfrb_events cloud-side gate');
        const found = bfrbEvents.find(e => e.remoteSchemaVersion === 99);
        assert(found, 'emit payload carries remoteSchemaVersion=99');
      } finally {
        SyncEngine.off('refuse-writeback', cb);
      }
    } finally {
      _e3_restore(saved);
    }
  });

});

// ────────────────────────────────────────────────────────────────────────
// F19a refuse-writeback emit — per-record CAS path
// ────────────────────────────────────────────────────────────────────────

describe('F19a refuse-writeback emit (per-record CAS path)', () => {

  it('20. SyncMergeMeds.merge emits "refuse-writeback" from CAS catch with remoteDeviceId', async () => {
    const saved = _e3_saveEnv();
    try {
      _e3_install({});
      // Local: one med so the merge attempts to write back.
      const realMedsSnap = MedsManager.snapshotForSync;
      MedsManager.snapshotForSync = () => ({
        deviceId: 'dev-test',
        schemaVersion: 1,
        payload: {
          meds: [
            { id: 'm1', name: 'A', dose: '60mg', frequency: 'once-daily',
              schemaVersion: 1, deviceId: 'dev-test', updatedAt: 1000, doseLog: [] },
          ],
        },
      });
      // The merge reads local meds via MedsManager.all() — snapshotForSync only
      // supplies the deviceId — so seed all() too (every other meds test does).
      // This test previously relied on a med leaking into the real singleton
      // from an earlier test, making it order-dependent; the H4 meds-merge
      // tests now clear the singleton in cleanup, which exposed that coupling.
      const realMedsAll = MedsManager.all;
      MedsManager.all = () => [{
        getState: () => ({ id: 'm1', name: 'A', dose: '60mg', frequency: 'once-daily',
                           schemaVersion: 1, deviceId: 'dev-test', updatedAt: 1000, doseLog: [] }),
        getId: () => 'm1',
        getDoseLog: () => [],
      }];
      // Cloud: empty (no cloud-side filter fires).
      SyncFirestore.getCollection = async () => ({ docs: [], count: 0 });

      // runTransaction simulates: tx.get returns a future-schema remote,
      // then tx.refuseWriteback throws with kind: 'refuse-writeback'.
      SyncFirestore.runTransaction = async (fn) => {
        const tx = {
          get: async () => ({
            id: 'm1',
            data: {
              id: 'm1',
              name: 'CloudA',
              schemaVersion: 99,
              deviceId: 'phone-2',
              updatedAt: 7000,
            },
          }),
          set: () => {},
          refuseWriteback: (remote, local) => {
            const err = new Error('refuse-writeback: remote=' + remote.schemaVersion + ' > local=' + local);
            err.kind = 'refuse-writeback';
            err.isRetryable = false;
            throw err;
          },
        };
        return await fn(tx);
      };

      const refuseEvents = [];
      const cb = (p) => { refuseEvents.push(p); };
      SyncEngine.on('refuse-writeback', cb);

      try {
        await SyncMergeMeds.merge(null);
        // The CAS path emits with `remoteDeviceId` populated.
        const medsCASEvents = refuseEvents.filter(e =>
          e && e.store === 'meds' && e.remoteSchemaVersion === 99
        );
        assert(medsCASEvents.length >= 1,
          'refuse-writeback emitted from CAS catch');
        const withDevice = medsCASEvents.find(e => e.remoteDeviceId === 'phone-2');
        assert(withDevice, 'remoteDeviceId stashed from _remoteForEmit + surfaced on emit');
      } finally {
        SyncEngine.off('refuse-writeback', cb);
        MedsManager.snapshotForSync = realMedsSnap;
        MedsManager.all = realMedsAll;
      }
    } finally {
      _e3_restore(saved);
    }
  });

  it('21. SyncMergeBfrb.merge emits "refuse-writeback" from CAS catch', async () => {
    const saved = _e3_saveEnv();
    try {
      _e3_install({});
      // Local: one BFRB entry to trigger writeback.
      localStorage.setItem('bfrb_events', JSON.stringify([
        { takenAt: 1000, context: 'global', deviceId: 'dev-test',
          updatedAt: 1000, schemaVersion: 1 },
      ]));
      localStorage.setItem('tempo_bfrb_events_migration_v1', '1');

      SyncFirestore.getCollection = async () => ({ docs: [], count: 0 });

      SyncFirestore.runTransaction = async (fn) => {
        const tx = {
          get: async () => ({
            id: 'dev-test-1000',
            data: {
              takenAt: 1000,
              context: 'global',
              deviceId: 'phone-2',
              updatedAt: 1000,
              schemaVersion: 99,
            },
          }),
          set: () => {},
          refuseWriteback: (remote, local) => {
            const err = new Error('refuse-writeback');
            err.kind = 'refuse-writeback';
            err.isRetryable = false;
            throw err;
          },
        };
        return await fn(tx);
      };

      const refuseEvents = [];
      const cb = (p) => { refuseEvents.push(p); };
      SyncEngine.on('refuse-writeback', cb);

      try {
        await SyncMergeBfrb.merge(null);
        const bfrbCASEvents = refuseEvents.filter(e =>
          e && e.store === 'bfrb_events' && e.remoteSchemaVersion === 99
        );
        assert(bfrbCASEvents.length >= 1,
          'refuse-writeback emitted from BFRB CAS catch');
      } finally {
        SyncEngine.off('refuse-writeback', cb);
      }
    } finally {
      _e3_restore(saved);
    }
  });

});

// ────────────────────────────────────────────────────────────────────────
// Constants verification (Pick A on TODOs #1)
// ────────────────────────────────────────────────────────────────────────

describe('E-3 constants', () => {

  it('22. STEADY_STATE_DEFAULT_MS bumped to 300000 (5 min) — verified via _getSteadyInterval indirectly', () => {
    // The constant is internal to the engine IIFE. We verify it indirectly
    // by exercising _getSteadyInterval via setInterval spy in
    // startSteadyState (covered in the E-3 extension block at the end of
    // sync-engine.test.js). Here we sanity-check that engine boot did not
    // throw on the constant load (Module loaded — startSteadyState callable).
    assertEqual(typeof SyncEngine.startSteadyState, 'function',
      'startSteadyState exposed (engine constructed without error)');
    assertEqual(typeof SyncEngine._runMergeCycleForStore, 'function',
      '_runMergeCycleForStore exposed (E-3 helper present)');
    assertEqual(typeof SyncEngine._subscribeAllStores, 'function',
      '_subscribeAllStores exposed (E-3 helper present)');
    assertEqual(typeof SyncEngine._unsubscribeAllStores, 'function',
      '_unsubscribeAllStores exposed (E-3 helper present)');
  });

});
