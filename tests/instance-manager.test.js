// InstanceManager mutates module-level singletons (`stopwatches`, `timers`)
// and the globals `Stopwatch` / `Timer`. Each test runs inside withManagerState
// so prior localStorage (`multi_state`) is saved, a clean baseline is hydrated,
// and the original is restored in the finally block — even when assertions throw.
function withManagerState(fn) {
  const priorState = localStorage.getItem('multi_state');
  try {
    const clean = {
      stopwatches: [{ id: 'sw-default', name: 'Stopwatch', status: 'idle' }],
      primaryStopwatchId: 'sw-default',
      timers: [{ id: 'tm-default', name: 'Timer', status: 'idle' }],
      primaryTimerId: 'tm-default',
    };
    localStorage.setItem('multi_state', JSON.stringify(clean));
    InstanceManager.loadAll();
    fn();
  } finally {
    if (priorState !== null) localStorage.setItem('multi_state', priorState);
    else localStorage.removeItem('multi_state');
    InstanceManager.loadAll();
  }
}

describe('InstanceManager — defaults', () => {
  it('exposes MAX_INSTANCES constant of 5', () => {
    assertEqual(InstanceManager.MAX_INSTANCES, 5);
  });

  it('starts with one stopwatch and one timer', () => {
    withManagerState(() => {
      assertEqual(InstanceManager.getStopwatches().length, 1);
      assertEqual(InstanceManager.getTimers().length, 1);
    });
  });

  it('getStopwatches returns a defensive copy', () => {
    withManagerState(() => {
      const list = InstanceManager.getStopwatches();
      list.push({ getId: () => 'fake' });
      assertEqual(InstanceManager.getStopwatches().length, 1);
    });
  });

  it('getTimers returns a defensive copy', () => {
    withManagerState(() => {
      const list = InstanceManager.getTimers();
      list.push({ getId: () => 'fake' });
      assertEqual(InstanceManager.getTimers().length, 1);
    });
  });
});

describe('InstanceManager — stopwatch add/remove', () => {
  it('addStopwatch creates a new instance and appends it', () => {
    withManagerState(() => {
      const sw = InstanceManager.addStopwatch('My Lap');
      assert(sw !== null, 'Should return instance');
      assertEqual(sw.getName(), 'My Lap');
      assertEqual(InstanceManager.getStopwatches().length, 2);
    });
  });

  it('addStopwatch applies default numbered name when none given', () => {
    withManagerState(() => {
      const sw = InstanceManager.addStopwatch();
      assertEqual(sw.getName(), 'Stopwatch 2');
    });
  });

  it('addStopwatch refuses past MAX_INSTANCES', () => {
    withManagerState(() => {
      for (let i = 0; i < InstanceManager.MAX_INSTANCES - 1; i++) {
        InstanceManager.addStopwatch();
      }
      assertEqual(InstanceManager.getStopwatches().length, InstanceManager.MAX_INSTANCES);
      const overflow = InstanceManager.addStopwatch();
      assertEqual(overflow, null);
      assertEqual(InstanceManager.getStopwatches().length, InstanceManager.MAX_INSTANCES);
    });
  });

  it('removeStopwatch removes a non-primary instance by id', () => {
    withManagerState(() => {
      const sw = InstanceManager.addStopwatch('Disposable');
      assertEqual(InstanceManager.removeStopwatch(sw.getId()), true);
      assertEqual(InstanceManager.getStopwatches().length, 1);
    });
  });

  it('removeStopwatch refuses to remove the primary', () => {
    withManagerState(() => {
      InstanceManager.addStopwatch('Other');
      const primaryId = InstanceManager.getPrimaryStopwatch().getId();
      assertEqual(InstanceManager.removeStopwatch(primaryId), false);
      assertEqual(InstanceManager.getStopwatches().length, 2);
    });
  });

  it('removeStopwatch refuses when only one remains', () => {
    withManagerState(() => {
      const onlyId = InstanceManager.getStopwatches()[0].getId();
      assertEqual(InstanceManager.removeStopwatch(onlyId), false);
      assertEqual(InstanceManager.getStopwatches().length, 1);
    });
  });
});

describe('InstanceManager — stopwatch primary', () => {
  it('getPrimaryStopwatch returns the instance matching primaryId', () => {
    withManagerState(() => {
      const sw = InstanceManager.addStopwatch('Second');
      InstanceManager.setPrimaryStopwatch(sw.getId());
      assertEqual(InstanceManager.getPrimaryStopwatch().getId(), sw.getId());
    });
  });

  it('setPrimaryStopwatch reassigns the global Stopwatch binding', () => {
    withManagerState(() => {
      const sw = InstanceManager.addStopwatch('New Primary');
      InstanceManager.setPrimaryStopwatch(sw.getId());
      assertEqual(Stopwatch.getId(), sw.getId());
    });
  });

  it('setPrimaryStopwatch with unknown id is a no-op', () => {
    withManagerState(() => {
      const originalId = InstanceManager.getPrimaryStopwatch().getId();
      InstanceManager.setPrimaryStopwatch('does-not-exist');
      assertEqual(InstanceManager.getPrimaryStopwatch().getId(), originalId);
    });
  });

  it('getPrimaryStopwatch falls back to first when primaryId is stale', () => {
    const prior = localStorage.getItem('multi_state');
    try {
      localStorage.setItem('multi_state', JSON.stringify({
        stopwatches: [
          { id: 'sw-a', name: 'A', status: 'idle' },
          { id: 'sw-b', name: 'B', status: 'idle' },
        ],
        primaryStopwatchId: 'sw-ghost',
        timers: [{ id: 'tm-default', name: 'Timer', status: 'idle' }],
        primaryTimerId: 'tm-default',
      }));
      InstanceManager.loadAll();
      assertEqual(InstanceManager.getPrimaryStopwatch().getId(), 'sw-a');
    } finally {
      if (prior !== null) localStorage.setItem('multi_state', prior);
      else localStorage.removeItem('multi_state');
      InstanceManager.loadAll();
    }
  });
});

describe('InstanceManager — timer add/remove', () => {
  it('addTimer creates a new instance and appends it', () => {
    withManagerState(() => {
      const t = InstanceManager.addTimer('Egg');
      assert(t !== null, 'Should return instance');
      assertEqual(t.getName(), 'Egg');
      assertEqual(InstanceManager.getTimers().length, 2);
    });
  });

  it('addTimer applies default numbered name when none given', () => {
    withManagerState(() => {
      const t = InstanceManager.addTimer();
      assertEqual(t.getName(), 'Timer 2');
    });
  });

  it('addTimer refuses past MAX_INSTANCES', () => {
    withManagerState(() => {
      for (let i = 0; i < InstanceManager.MAX_INSTANCES - 1; i++) {
        InstanceManager.addTimer();
      }
      assertEqual(InstanceManager.getTimers().length, InstanceManager.MAX_INSTANCES);
      const overflow = InstanceManager.addTimer();
      assertEqual(overflow, null);
      assertEqual(InstanceManager.getTimers().length, InstanceManager.MAX_INSTANCES);
    });
  });

  it('removeTimer removes a non-primary timer by id', () => {
    withManagerState(() => {
      const t = InstanceManager.addTimer('Disposable');
      assertEqual(InstanceManager.removeTimer(t.getId()), true);
      assertEqual(InstanceManager.getTimers().length, 1);
    });
  });

  it('removeTimer refuses to remove the primary', () => {
    withManagerState(() => {
      InstanceManager.addTimer('Other');
      const primaryId = InstanceManager.getPrimaryTimer().getId();
      assertEqual(InstanceManager.removeTimer(primaryId), false);
      assertEqual(InstanceManager.getTimers().length, 2);
    });
  });

  it('removeTimer refuses when only one remains', () => {
    withManagerState(() => {
      const onlyId = InstanceManager.getTimers()[0].getId();
      assertEqual(InstanceManager.removeTimer(onlyId), false);
      assertEqual(InstanceManager.getTimers().length, 1);
    });
  });
});

describe('InstanceManager — timer primary', () => {
  it('setPrimaryTimer reassigns the global Timer binding', () => {
    withManagerState(() => {
      const t = InstanceManager.addTimer('New Primary Timer');
      InstanceManager.setPrimaryTimer(t.getId());
      assertEqual(Timer.getId(), t.getId());
    });
  });

  it('setPrimaryTimer with unknown id is a no-op', () => {
    withManagerState(() => {
      const originalId = InstanceManager.getPrimaryTimer().getId();
      InstanceManager.setPrimaryTimer('tm-ghost');
      assertEqual(InstanceManager.getPrimaryTimer().getId(), originalId);
    });
  });
});

describe('InstanceManager — persistence', () => {
  it('saveAll writes stopwatches and timers to localStorage', () => {
    withManagerState(() => {
      InstanceManager.addStopwatch('Save Me');
      InstanceManager.addTimer('Save Me Too');
      InstanceManager.saveAll();
      const raw = localStorage.getItem('multi_state');
      assert(raw !== null, 'multi_state should be written');
      const state = JSON.parse(raw);
      assertEqual(state.stopwatches.length, 2);
      assertEqual(state.timers.length, 2);
      assert(state.stopwatches.some(s => s.name === 'Save Me'), 'Save Me in payload');
      assert(state.timers.some(t => t.name === 'Save Me Too'), 'Save Me Too in payload');
    });
  });

  it('saveAll → loadAll round-trips stopwatch state', () => {
    withManagerState(() => {
      const sw = InstanceManager.addStopwatch('Persisted Lap');
      const id = sw.getId();
      InstanceManager.saveAll();
      InstanceManager.loadAll();

      assertEqual(InstanceManager.getStopwatches().length, 2);
      const loaded = InstanceManager.getStopwatches().find(s => s.getId() === id);
      assert(loaded !== undefined, 'Persisted Lap restored');
      assertEqual(loaded.getName(), 'Persisted Lap');
    });
  });

  it('saveAll → loadAll preserves timer duration', () => {
    withManagerState(() => {
      const t = InstanceManager.addTimer('Pasta Timer');
      t.setDuration(600000);
      InstanceManager.saveAll();
      InstanceManager.loadAll();
      const loaded = InstanceManager.getTimers().find(x => x.getName() === 'Pasta Timer');
      assert(loaded !== undefined, 'Pasta Timer restored');
      assertEqual(loaded.getDurationMs(), 600000);
    });
  });

  it('saveAll → loadAll preserves primaryStopwatchId', () => {
    withManagerState(() => {
      const sw = InstanceManager.addStopwatch('New Primary');
      InstanceManager.setPrimaryStopwatch(sw.getId());
      InstanceManager.saveAll();
      InstanceManager.loadAll();
      assertEqual(InstanceManager.getPrimaryStopwatch().getId(), sw.getId());
    });
  });

  it('saveAll → loadAll preserves primaryTimerId', () => {
    withManagerState(() => {
      const t = InstanceManager.addTimer('New Primary Timer');
      InstanceManager.setPrimaryTimer(t.getId());
      InstanceManager.saveAll();
      InstanceManager.loadAll();
      assertEqual(InstanceManager.getPrimaryTimer().getId(), t.getId());
    });
  });

  it('loadAll with empty arrays keeps existing instances intact', () => {
    withManagerState(() => {
      localStorage.setItem('multi_state', JSON.stringify({
        stopwatches: [],
        timers: [],
      }));
      InstanceManager.loadAll();
      assertEqual(InstanceManager.getStopwatches().length, 1);
      assertEqual(InstanceManager.getTimers().length, 1);
    });
  });

  it('loadAll with corrupt JSON clears the key without crashing', () => {
    const prior = localStorage.getItem('multi_state');
    try {
      localStorage.setItem('multi_state', 'not valid json');
      InstanceManager.loadAll();
      assertEqual(localStorage.getItem('multi_state'), null);
      assert(InstanceManager.getStopwatches().length >= 1, 'stopwatch still present');
      assert(InstanceManager.getTimers().length >= 1, 'timer still present');
    } finally {
      if (prior !== null) localStorage.setItem('multi_state', prior);
      else localStorage.removeItem('multi_state');
      InstanceManager.loadAll();
    }
  });
});

describe('InstanceManager — legacy migration', () => {
  it('loadAll without multi_state or legacy keys runs migration without crashing', () => {
    const priorMulti = localStorage.getItem('multi_state');
    const priorSw = localStorage.getItem('stopwatch_state');
    const priorTm = localStorage.getItem('timer_state');
    try {
      localStorage.removeItem('multi_state');
      localStorage.removeItem('stopwatch_state');
      localStorage.removeItem('timer_state');
      InstanceManager.loadAll();
      assertEqual(InstanceManager.getStopwatches().length, 1);
      assertEqual(InstanceManager.getTimers().length, 1);
    } finally {
      if (priorMulti !== null) localStorage.setItem('multi_state', priorMulti);
      if (priorSw !== null) localStorage.setItem('stopwatch_state', priorSw);
      if (priorTm !== null) localStorage.setItem('timer_state', priorTm);
      InstanceManager.loadAll();
    }
  });

  it('loadAll migrates legacy stopwatch_state into the primary and removes the key', () => {
    const priorMulti = localStorage.getItem('multi_state');
    const priorSw = localStorage.getItem('stopwatch_state');
    const priorTm = localStorage.getItem('timer_state');
    try {
      localStorage.removeItem('multi_state');
      localStorage.removeItem('timer_state');
      const legacyState = { status: 'idle', offsetMs: 42000, accumulatedMs: 0 };
      localStorage.setItem('stopwatch_state', JSON.stringify(legacyState));

      InstanceManager.loadAll();

      assertEqual(localStorage.getItem('stopwatch_state'), null);
      assertEqual(InstanceManager.getPrimaryStopwatch().getElapsedMs(), 42000);
    } finally {
      if (priorMulti !== null) localStorage.setItem('multi_state', priorMulti);
      else localStorage.removeItem('multi_state');
      if (priorSw !== null) localStorage.setItem('stopwatch_state', priorSw);
      else localStorage.removeItem('stopwatch_state');
      if (priorTm !== null) localStorage.setItem('timer_state', priorTm);
      else localStorage.removeItem('timer_state');
      InstanceManager.loadAll();
    }
  });

  it('loadAll migrates legacy timer_state into the primary and removes the key', () => {
    const priorMulti = localStorage.getItem('multi_state');
    const priorSw = localStorage.getItem('stopwatch_state');
    const priorTm = localStorage.getItem('timer_state');
    try {
      localStorage.removeItem('multi_state');
      localStorage.removeItem('stopwatch_state');
      const legacyState = { status: 'idle', durationMs: 180000 };
      localStorage.setItem('timer_state', JSON.stringify(legacyState));

      InstanceManager.loadAll();

      assertEqual(localStorage.getItem('timer_state'), null);
      assertEqual(InstanceManager.getPrimaryTimer().getDurationMs(), 180000);
    } finally {
      if (priorMulti !== null) localStorage.setItem('multi_state', priorMulti);
      else localStorage.removeItem('multi_state');
      if (priorSw !== null) localStorage.setItem('stopwatch_state', priorSw);
      else localStorage.removeItem('stopwatch_state');
      if (priorTm !== null) localStorage.setItem('timer_state', priorTm);
      else localStorage.removeItem('timer_state');
      InstanceManager.loadAll();
    }
  });
});

// Sequential tests seed state via localStorage instead of calling addStopwatch
// in a tight loop — addStopwatch derives ids from Date.now(), so back-to-back
// calls within a single ms collide and removeStopwatch(id) would remove all
// colliding entries. Pre-seeding gives each fixture a distinct id.
describe('InstanceManager — sequential operations', () => {
  it('can remove a seeded stopwatch and add another under MAX_INSTANCES', () => {
    const prior = localStorage.getItem('multi_state');
    try {
      localStorage.setItem('multi_state', JSON.stringify({
        stopwatches: [
          { id: 'sw-default', name: 'Stopwatch', status: 'idle' },
          { id: 'sw-t1', name: 'Temp 1', status: 'idle' },
          { id: 'sw-t2', name: 'Temp 2', status: 'idle' },
        ],
        primaryStopwatchId: 'sw-default',
        timers: [{ id: 'tm-default', name: 'Timer', status: 'idle' }],
        primaryTimerId: 'tm-default',
      }));
      InstanceManager.loadAll();
      assertEqual(InstanceManager.getStopwatches().length, 3);

      InstanceManager.removeStopwatch('sw-t1');
      InstanceManager.addStopwatch('Temp 3');

      const names = InstanceManager.getStopwatches().map(s => s.getName());
      assert(!names.includes('Temp 1'), 'Temp 1 gone');
      assert(names.includes('Temp 2'), 'Temp 2 present');
      assert(names.includes('Temp 3'), 'Temp 3 present');
      assertEqual(InstanceManager.getStopwatches().length, 3);
    } finally {
      if (prior !== null) localStorage.setItem('multi_state', prior);
      else localStorage.removeItem('multi_state');
      InstanceManager.loadAll();
    }
  });

  it('removing a non-primary frees a slot against MAX_INSTANCES', () => {
    const prior = localStorage.getItem('multi_state');
    try {
      const stopwatches = [{ id: 'sw-default', name: 'Stopwatch', status: 'idle' }];
      for (let i = 0; i < InstanceManager.MAX_INSTANCES - 1; i++) {
        stopwatches.push({ id: 'sw-slot-' + i, name: 'Slot ' + i, status: 'idle' });
      }
      localStorage.setItem('multi_state', JSON.stringify({
        stopwatches,
        primaryStopwatchId: 'sw-default',
        timers: [{ id: 'tm-default', name: 'Timer', status: 'idle' }],
        primaryTimerId: 'tm-default',
      }));
      InstanceManager.loadAll();
      assertEqual(InstanceManager.getStopwatches().length, InstanceManager.MAX_INSTANCES);

      assertEqual(InstanceManager.addStopwatch('Overflow'), null);
      InstanceManager.removeStopwatch('sw-slot-0');
      const added = InstanceManager.addStopwatch('Now Fits');
      assert(added !== null, 'should fit after removal');
      assertEqual(InstanceManager.getStopwatches().length, InstanceManager.MAX_INSTANCES);
    } finally {
      if (prior !== null) localStorage.setItem('multi_state', prior);
      else localStorage.removeItem('multi_state');
      InstanceManager.loadAll();
    }
  });
});
