// InstanceManager tests (M12 — AUDIT-2026-06-13).
//
// InstanceManager persists the app's primary surface (multi_state: the
// multi-stopwatch/timer instances + primary tracking + tab-close survival) and
// had ZERO test coverage — the highest criticality-vs-coverage gap in the app.
//
// Reset strategy: the module exposes no reset, but loadAll() with a seeded
// multi_state deterministically rebuilds the in-memory arrays to a known
// baseline (1 primary stopwatch + 1 primary timer). Each test calls _im_reset()
// first. Note: setPrimaryStopwatch / loadFromState reassign the GLOBAL
// Stopwatch / Timer proxies — that's expected (it's the mutable-global-proxy
// pattern), and no other test file consumes those globals (ui.js/timer-ui.js
// aren't loaded in the harness).

function _im_reset() {
  localStorage.setItem('multi_state', JSON.stringify({
    stopwatches: [{ id: 'sw-default' }],
    primaryStopwatchId: 'sw-default',
    timers: [{ id: 'tm-default' }],
    primaryTimerId: 'tm-default',
  }));
  InstanceManager.loadAll();
}

describe('InstanceManager — MAX_INSTANCES cap', () => {
  it('addStopwatch fills to the cap then refuses the (cap+1)th', () => {
    _im_reset();
    assertEqual(InstanceManager.getStopwatches().length, 1, 'baseline: 1 stopwatch');
    const cap = InstanceManager.MAX_INSTANCES;
    for (let i = 1; i < cap; i++) {
      assert(InstanceManager.addStopwatch('S' + i) !== null, 'add #' + i + ' succeeds');
    }
    assertEqual(InstanceManager.getStopwatches().length, cap, 'at the cap');
    assertEqual(InstanceManager.addStopwatch('over'), null, 'over-cap add returns null');
    assertEqual(InstanceManager.getStopwatches().length, cap, 'count stays at the cap');
  });

  it('addTimer fills to the cap then refuses the (cap+1)th', () => {
    _im_reset();
    const cap = InstanceManager.MAX_INSTANCES;
    for (let i = 1; i < cap; i++) {
      assert(InstanceManager.addTimer('T' + i) !== null, 'add timer #' + i + ' succeeds');
    }
    assertEqual(InstanceManager.getTimers().length, cap, 'at the cap');
    assertEqual(InstanceManager.addTimer('over'), null, 'over-cap timer add returns null');
    assertEqual(InstanceManager.getTimers().length, cap, 'count stays at the cap');
  });

  it('addStopwatch mints unique ids even on same-millisecond adds (A18 _idSeq)', () => {
    _im_reset();
    const a = InstanceManager.addStopwatch('A');
    const b = InstanceManager.addStopwatch('B');
    assert(a.getId() !== b.getId(), 'distinct ids for back-to-back adds');
  });
});

describe('InstanceManager — primary tracking', () => {
  it('setPrimaryStopwatch swaps the primary AND reassigns the global Stopwatch proxy', () => {
    _im_reset();
    const s2 = InstanceManager.addStopwatch('Second');
    InstanceManager.setPrimaryStopwatch(s2.getId());
    assertEqual(InstanceManager.getPrimaryStopwatch().getId(), s2.getId(), 'primary points at the new instance');
    assertEqual(Stopwatch.getId(), s2.getId(), 'global Stopwatch proxy reassigned to the new primary');
  });

  it('setPrimaryStopwatch ignores an unknown id (no-op)', () => {
    _im_reset();
    const before = InstanceManager.getPrimaryStopwatch().getId();
    InstanceManager.setPrimaryStopwatch('does-not-exist');
    assertEqual(InstanceManager.getPrimaryStopwatch().getId(), before, 'primary unchanged on unknown id');
  });

  it('setPrimaryTimer swaps the primary AND reassigns the global Timer proxy', () => {
    _im_reset();
    const t2 = InstanceManager.addTimer('Second');
    InstanceManager.setPrimaryTimer(t2.getId());
    assertEqual(InstanceManager.getPrimaryTimer().getId(), t2.getId(), 'primary timer swapped');
    assertEqual(Timer.getId(), t2.getId(), 'global Timer proxy reassigned');
  });
});

describe('InstanceManager — remove guards', () => {
  it('removeStopwatch refuses the primary and the last remaining instance', () => {
    _im_reset();
    const s2 = InstanceManager.addStopwatch('S2'); // 2 total; primary = sw-default
    const primaryId = InstanceManager.getPrimaryStopwatch().getId();
    assertEqual(InstanceManager.removeStopwatch(primaryId), false, 'cannot remove the primary');
    assertEqual(InstanceManager.getStopwatches().length, 2, 'still 2 after refused removal');
    assertEqual(InstanceManager.removeStopwatch(s2.getId()), true, 'removes a non-primary instance');
    assertEqual(InstanceManager.getStopwatches().length, 1, 'back to 1');
    assertEqual(InstanceManager.removeStopwatch(InstanceManager.getPrimaryStopwatch().getId()), false,
      'cannot remove the last remaining instance');
  });

  it('removeTimer refuses the primary and the last remaining instance', () => {
    _im_reset();
    const t2 = InstanceManager.addTimer('T2');
    assertEqual(InstanceManager.removeTimer(InstanceManager.getPrimaryTimer().getId()), false, 'cannot remove primary timer');
    assertEqual(InstanceManager.removeTimer(t2.getId()), true, 'removes a non-primary timer');
    assertEqual(InstanceManager.getTimers().length, 1, 'back to 1 timer');
  });
});

describe('InstanceManager — saveAll → loadAll round-trip', () => {
  it('persists instances + primary tracking and reloads them (dropping unsaved mutations)', () => {
    _im_reset();
    const focus = InstanceManager.addStopwatch('Focus');
    InstanceManager.setPrimaryStopwatch(focus.getId());
    const savedPrimaryId = focus.getId();
    InstanceManager.addTimer('Tea');
    assertEqual(InstanceManager.getStopwatches().length, 2, '2 stopwatches before save');
    assertEqual(InstanceManager.getTimers().length, 2, '2 timers before save');

    InstanceManager.saveAll(); // persist the current state to multi_state

    // Mutate in-memory WITHOUT saving — loadAll must discard this.
    InstanceManager.addStopwatch('Ephemeral');
    assertEqual(InstanceManager.getStopwatches().length, 3, 'in-memory mutated to 3 (unsaved)');

    InstanceManager.loadAll(); // reload the saved snapshot

    const sws = InstanceManager.getStopwatches();
    assertEqual(sws.length, 2, 'loadAll restored the saved 2 (the unsaved 3rd is gone)');
    assertEqual(InstanceManager.getPrimaryStopwatch().getId(), savedPrimaryId, 'primary survived the round-trip');
    assert(sws.some(s => s.getName() === 'Focus'), 'the named instance survived serialization');
    assertEqual(InstanceManager.getTimers().length, 2, '2 timers restored');
  });

  it('saveAll then a corrupt multi_state falls back without throwing', () => {
    _im_reset();
    InstanceManager.addStopwatch('X');
    localStorage.setItem('multi_state', '{ not valid json');
    // loadAll must swallow the parse error (and clear the bad key) — not throw.
    let threw = null;
    try { InstanceManager.loadAll(); } catch (e) { threw = e; }
    assertEqual(threw, null, 'loadAll tolerates corrupt multi_state');
  });
});

describe('InstanceManager — unique default names (C4 — AUDIT-2026-06-13)', () => {
  it('default stopwatch names stay unique after removing a middle instance', () => {
    _im_reset(); // baseline: ['Stopwatch'] (sw-default)
    const s2 = InstanceManager.addStopwatch(); // 'Stopwatch 2'
    const s3 = InstanceManager.addStopwatch(); // 'Stopwatch 3'
    assertEqual(s2.getName(), 'Stopwatch 2', 'second add numbered 2');
    assertEqual(s3.getName(), 'Stopwatch 3', 'third add numbered 3');

    assertEqual(InstanceManager.removeStopwatch(s2.getId()), true, 'removed the middle instance');
    // Pre-fix: length is now 2 → next add was 'Stopwatch ' + (2+1) = 'Stopwatch 3',
    // colliding with the surviving s3. Post-fix the scan skips the taken number.
    const s4 = InstanceManager.addStopwatch();
    assert(s4.getName() !== 'Stopwatch 3', 'new add avoids the surviving "Stopwatch 3"');
    const names = InstanceManager.getStopwatches().map(s => s.getName());
    assertEqual(new Set(names).size, names.length, 'all default names unique: ' + names.join(','));
  });

  it('default timer names also stay unique after a middle removal', () => {
    _im_reset();
    const t2 = InstanceManager.addTimer(); // 'Timer 2'
    InstanceManager.addTimer();            // 'Timer 3'
    assertEqual(InstanceManager.removeTimer(t2.getId()), true, 'removed the middle timer');
    InstanceManager.addTimer();            // must not collide with 'Timer 3'
    const names = InstanceManager.getTimers().map(t => t.getName());
    assertEqual(new Set(names).size, names.length, 'unique timer names: ' + names.join(','));
  });

  it('an explicit name argument still wins over the default', () => {
    _im_reset();
    const s = InstanceManager.addStopwatch('My Focus');
    assertEqual(s.getName(), 'My Focus', 'explicit name is not overridden by the default helper');
  });
});

describe('InstanceManager — loadFromState cap clamp (R4 — AUDIT-2026-06-13)', () => {
  it('clamps an oversized persisted multi_state to MAX_INSTANCES', () => {
    const cap = InstanceManager.MAX_INSTANCES;
    const big = { stopwatches: [], primaryStopwatchId: 'sw-0', timers: [], primaryTimerId: 'tm-0' };
    for (let i = 0; i < cap + 2; i++) {
      big.stopwatches.push({ id: 'sw-' + i });
      big.timers.push({ id: 'tm-' + i });
    }
    localStorage.setItem('multi_state', JSON.stringify(big));
    InstanceManager.loadAll();
    // The add-path caps at MAX_INSTANCES; the load path must share that bound so
    // a tampered/oversized state can't smuggle in a 6th+ instance.
    assertEqual(InstanceManager.getStopwatches().length, cap, 'stopwatches clamped to the cap');
    assertEqual(InstanceManager.getTimers().length, cap, 'timers clamped to the cap');
    // The kept slice is the head, so the persisted primary (sw-0/tm-0) survives.
    assertEqual(InstanceManager.getPrimaryStopwatch().getId(), 'sw-0', 'primary preserved within the kept slice');
    assertEqual(InstanceManager.getPrimaryTimer().getId(), 'tm-0', 'primary timer preserved');
  });

  it('reconciles a primary id that the clamp sliced off (no dangling primary)', () => {
    const cap = InstanceManager.MAX_INSTANCES;
    // Persisted primary points BEYOND the cap, so the clamp slices it away.
    const big = {
      stopwatches: [], primaryStopwatchId: 'sw-' + (cap + 1),
      timers: [], primaryTimerId: 'tm-' + (cap + 1),
    };
    for (let i = 0; i < cap + 2; i++) {
      big.stopwatches.push({ id: 'sw-' + i });
      big.timers.push({ id: 'tm-' + i });
    }
    localStorage.setItem('multi_state', JSON.stringify(big));
    InstanceManager.loadAll();

    const primaryId = InstanceManager.getPrimaryStopwatch().getId();
    const keptIds = InstanceManager.getStopwatches().map(s => s.getId());
    assert(keptIds.indexOf(primaryId) >= 0, 'primary resolves to a kept instance');
    assertEqual(Stopwatch.getId(), primaryId, 'global proxy matches the resolved primary');
    // The decisive check: primaryStopwatchId was reconciled to the resolved
    // primary, so removeStopwatch's guard now protects it. Pre-reconcile the id
    // still dangled at sw-{cap+1}, so this guard would NOT fire and the de-facto
    // primary (stopwatches[0]) would be removable.
    assertEqual(InstanceManager.removeStopwatch(primaryId), false, 'reconciled primary is guarded against removal');
    const primaryTimerId = InstanceManager.getPrimaryTimer().getId();
    assertEqual(InstanceManager.removeTimer(primaryTimerId), false, 'reconciled primary timer is guarded too');
  });
});
