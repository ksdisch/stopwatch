// F20 unknown-vs-absent coverage for the Flow engine.
//
// Flow has two write sites that historically snapped focusDurationMs to one
// of the two presets:
//   - configure({ focusDurationMs }) — called from app.js on flow_config load
//   - loadState({ focusDurationMs })  — called from app.js on flow_state load
//
// F20 splits each into:
//   - absent / non-numeric → default FOCUS_90
//   - present numeric (incl. future values) → preserve verbatim
//
// We exercise both paths here. The broader Flow engine has no test file in
// main yet (CLAUDE.md notes flow tests live on a feature branch); this file
// is intentionally narrow — only F20 invariants — to avoid colliding with a
// future merge of the full flow suite.

describe('Flow — F20 unknown-vs-absent (focusDurationMs)', () => {
  const FOCUS_90 = 90 * 60000;
  const FOCUS_120 = 120 * 60000;

  it('loadState with absent focusDurationMs defaults to FOCUS_90', () => {
    Flow.reset();
    Flow.loadState({});
    assertEqual(Flow.getFocusDurationMs(), FOCUS_90);
  });

  it('loadState preserves FOCUS_120 verbatim', () => {
    Flow.reset();
    Flow.loadState({ focusDurationMs: FOCUS_120 });
    assertEqual(Flow.getFocusDurationMs(), FOCUS_120);
  });

  it('loadState preserves a present-but-unknown future duration (F20)', () => {
    // Forward-compat: a future schema might add a 60-min or 180-min preset.
    // A V2 client must not silently downcast unknown numeric values to
    // FOCUS_90 — that would erase forward-compat data on the next save.
    Flow.reset();
    const FOCUS_180 = 180 * 60000;
    Flow.loadState({ focusDurationMs: FOCUS_180 });
    assertEqual(Flow.getFocusDurationMs(), FOCUS_180);
  });

  it('loadState defaults to FOCUS_90 when focusDurationMs is non-numeric', () => {
    // F20 absent path covers type errors too. Strings, null, Infinity, NaN
    // are all treated as absent → default. Preserving non-numerics would
    // poison every downstream consumer that does arithmetic on the value.
    Flow.reset();
    Flow.loadState({ focusDurationMs: 'ninety' });
    assertEqual(Flow.getFocusDurationMs(), FOCUS_90);

    Flow.reset();
    Flow.loadState({ focusDurationMs: null });
    assertEqual(Flow.getFocusDurationMs(), FOCUS_90);

    Flow.reset();
    Flow.loadState({ focusDurationMs: NaN });
    assertEqual(Flow.getFocusDurationMs(), FOCUS_90);

    Flow.reset();
    Flow.loadState({ focusDurationMs: Infinity });
    assertEqual(Flow.getFocusDurationMs(), FOCUS_90);
  });

  it('configure() preserves a future numeric duration verbatim (F20)', () => {
    // configure() is the OTHER write site reached from the load path
    // (app.js parses flow_config and calls Flow.configure(...)). It used
    // to share the same snap-to-presets coercion as loadState.
    Flow.reset();
    const FOCUS_180 = 180 * 60000;
    Flow.configure({ focusDurationMs: FOCUS_180 });
    assertEqual(Flow.getFocusDurationMs(), FOCUS_180);
  });

  it('configure() defaults to FOCUS_90 when focusDurationMs is non-numeric', () => {
    Flow.reset();
    // Start from FOCUS_120 to prove the default applies even when the
    // current value isn't already FOCUS_90.
    Flow.configure({ focusDurationMs: FOCUS_120 });
    assertEqual(Flow.getFocusDurationMs(), FOCUS_120);
    Flow.configure({ focusDurationMs: 'two-hours' });
    assertEqual(Flow.getFocusDurationMs(), FOCUS_90);
  });

  it('configure() ignores absent focusDurationMs (leaves current value)', () => {
    // `if (opts.focusDurationMs !== undefined)` gates: omitting the key
    // entirely is a no-op on the engine, not a reset to FOCUS_90. This
    // matches existing behavior — configure() is an incremental setter.
    Flow.reset();
    Flow.configure({ focusDurationMs: FOCUS_120 });
    Flow.configure({});
    assertEqual(Flow.getFocusDurationMs(), FOCUS_120);
  });
});

describe('Flow — Live Activity emits', () => {
  // tests/index.html does not load js/platform.js, so `Platform` is
  // undefined here by default — each case installs a spy global and
  // restores after. Flow is a SINGLETON: reset() runs BEFORE the spy
  // installs (so the hygiene reset's own endTimer emit isn't recorded) and
  // again in finally AFTER the spy restores; focusDurationMs is restored
  // too, since reset() deliberately leaves config alone.
  function withLiveActivitySpy(fn) {
    Flow.reset();
    const calls = [];
    const hadPlatform = typeof window.Platform !== 'undefined';
    const prevPlatform = hadPlatform ? window.Platform : undefined;
    const prevFlag = localStorage.getItem('live_activities_enabled');
    localStorage.removeItem('live_activities_enabled'); // absent = enabled
    const record = (method) => (args) => {
      calls.push({ method, args });
      return Promise.resolve({ ok: true });
    };
    window.Platform = {
      liveActivity: {
        startTimer: record('startTimer'),
        updateTimer: record('updateTimer'),
        endTimer: record('endTimer'),
      },
    };
    try {
      fn(calls);
    } finally {
      if (hadPlatform) window.Platform = prevPlatform; else delete window.Platform;
      if (prevFlag === null) localStorage.removeItem('live_activities_enabled');
      else localStorage.setItem('live_activities_enabled', prevFlag);
      Flow.reset();
      Flow.configure({ focusDurationMs: Flow.PRESETS.FOCUS_90 });
    }
  }

  function ofMethod(calls, m) {
    return calls.filter((c) => c.method === m);
  }
  function endsAtUpdates(calls) {
    return ofMethod(calls, 'updateTimer').filter((c) => c.args.endsAt !== undefined);
  }

  // Restores a focus phase that crossed zero while no page was alive —
  // loadState lands it in 'overflowing' without waiting a real 60s.
  function loadFocusOverflowed() {
    Flow.loadState({
      status: 'running', phase: 'focus', focusDurationMs: 60000,
      startedAt: Date.now() - 90000, accumulatedMs: 0,
      sessionStartedAt: Date.now() - 90000,
    });
  }

  it('start emits a full startTimer payload with mode + Focus label', () => {
    withLiveActivitySpy((calls) => {
      Flow.configure({ focusDurationMs: 60000 });
      Flow.start();
      const starts = ofMethod(calls, 'startTimer');
      assertEqual(starts.length, 1);
      const a = starts[0].args;
      assertEqual(a.id, 'flow');
      assertEqual(a.name, 'Flow Block');
      assertEqual(a.mode, 'flow');
      assertEqual(a.label, 'Focus');
      assertEqual(a.isPaused, false);
      assertClose(a.endsAt - Date.now(), 60000, 1500);
      assertClose(Date.now() - a.startedAt, 0, 1500);
    });
  });

  it('pause emits an isPaused update', () => {
    withLiveActivitySpy((calls) => {
      Flow.configure({ focusDurationMs: 60000 });
      Flow.start();
      Flow.pause();
      const ups = ofMethod(calls, 'updateTimer');
      assertEqual(ups.length, 1);
      assertEqual(ups[0].args.id, 'flow');
      assertEqual(ups[0].args.isPaused, true);
    });
  });

  it('resume re-emits startTimer (self-healing; native side update-routes)', () => {
    withLiveActivitySpy((calls) => {
      Flow.configure({ focusDurationMs: 60000 });
      Flow.start();
      Flow.pause();
      calls.length = 0;
      Flow.resume();
      const starts = ofMethod(calls, 'startTimer');
      assertEqual(starts.length, 1);
      assertEqual(starts[0].args.label, 'Focus');
      assertEqual(starts[0].args.isPaused, false);
    });
  });

  it('startRecovery updates the activity into a Recovery countdown', () => {
    withLiveActivitySpy((calls) => {
      loadFocusOverflowed();
      calls.length = 0;
      Flow.startRecovery();
      const starts = ofMethod(calls, 'startTimer');
      assertEqual(starts.length, 1);
      assertEqual(starts[0].args.label, 'Recovery');
      assertEqual(starts[0].args.isPaused, false);
      assertClose(starts[0].args.endsAt - Date.now(), 15 * 60000, 1500);
    });
  });

  it('recovery pause + resume emit like focus pause + resume', () => {
    withLiveActivitySpy((calls) => {
      loadFocusOverflowed();
      Flow.startRecovery();
      calls.length = 0;
      Flow.pause();
      assertEqual(Flow.getStatus(), 'recoveryPaused');
      const ups = ofMethod(calls, 'updateTimer');
      assertEqual(ups.length, 1);
      assertEqual(ups[0].args.isPaused, true);
      calls.length = 0;
      Flow.resume();
      const starts = ofMethod(calls, 'startTimer');
      assertEqual(starts.length, 1);
      assertEqual(starts[0].args.label, 'Recovery');
    });
  });

  it('endFocusEarly pulls endsAt to now (immediate Done state)', () => {
    withLiveActivitySpy((calls) => {
      Flow.configure({ focusDurationMs: 60000 });
      Flow.start();
      calls.length = 0;
      Flow.endFocusEarly();
      assertEqual(Flow.getStatus(), 'overflowing');
      const ups = endsAtUpdates(calls);
      assertEqual(ups.length, 1);
      assertEqual(ups[0].args.isPaused, false);
      assertClose(ups[0].args.endsAt - Date.now(), 0, 1500);
    });
  });

  it('skipRecovery (session over) emits endTimer', () => {
    withLiveActivitySpy((calls) => {
      loadFocusOverflowed();
      Flow.startRecovery();
      calls.length = 0;
      Flow.skipRecovery();
      assertEqual(Flow.getStatus(), 'done');
      assertEqual(ofMethod(calls, 'endTimer').length, 1);
      assertEqual(ofMethod(calls, 'endTimer')[0].args.id, 'flow');
    });
  });

  it('reset emits endTimer', () => {
    withLiveActivitySpy((calls) => {
      Flow.start();
      calls.length = 0;
      Flow.reset();
      assertEqual(ofMethod(calls, 'endTimer').length, 1);
    });
  });

  it('adjust while ticking emits updateTimer with the new endsAt', () => {
    withLiveActivitySpy((calls) => {
      Flow.configure({ focusDurationMs: 60000 });
      Flow.start();
      calls.length = 0;
      assert(Flow.adjustRemainingMs(3 * 60 * 1000), 'adjust accepted');
      const ups = endsAtUpdates(calls);
      assertEqual(ups.length, 1);
      assertEqual(ups[0].args.isPaused, false);
      assertClose(ups[0].args.endsAt - Date.now(), 240000, 1500);
    });
  });

  it('adjust while paused does not emit an endsAt update (resume re-emits)', () => {
    withLiveActivitySpy((calls) => {
      Flow.configure({ focusDurationMs: 60000 });
      Flow.start();
      Flow.pause();
      calls.length = 0;
      assert(Flow.adjustRemainingMs(60000), 'adjust accepted');
      assertEqual(endsAtUpdates(calls).length, 0);
    });
  });

  it('suppresses all emits when live_activities_enabled is "0"', () => {
    withLiveActivitySpy((calls) => {
      localStorage.setItem('live_activities_enabled', '0');
      Flow.start();
      Flow.pause();
      Flow.reset();
      assertEqual(calls.length, 0);
    });
  });

  it('loadState finished-while-away is SILENT for both phases', () => {
    withLiveActivitySpy((calls) => {
      loadFocusOverflowed();
      assertEqual(Flow.getStatus(), 'overflowing');
      assertEqual(calls.length, 0);
      Flow.reset();
      calls.length = 0;
      Flow.loadState({
        status: 'recovery', phase: 'recovery', focusDurationMs: 60000,
        startedAt: Date.now() - 16 * 60000, accumulatedMs: 0,
        sessionStartedAt: Date.now() - 90 * 60000,
      });
      assertEqual(Flow.getStatus(), 'recoveryOverflowing');
      assertEqual(calls.length, 0);
    });
  });

  it('loadState past the 24h overshoot cap ends the orphaned activity', () => {
    withLiveActivitySpy((calls) => {
      const dayPlus = 25 * 60 * 60 * 1000;
      Flow.loadState({
        status: 'overflowing', phase: 'focus', focusDurationMs: 60000,
        startedAt: Date.now() - dayPlus, accumulatedMs: 60000,
        alarmFired: true, zeroCrossedAt: Date.now() - dayPlus,
      });
      assertEqual(ofMethod(calls, 'endTimer').length, 1);
    });
  });

  it('getPhaseLabel tracks the phase', () => {
    withLiveActivitySpy(() => {
      Flow.configure({ focusDurationMs: 60000 });
      Flow.start();
      assertEqual(Flow.getPhaseLabel(), 'Focus');
      Flow.loadState({
        status: 'recovery', phase: 'recovery', focusDurationMs: 60000,
        startedAt: Date.now() - 60000, accumulatedMs: 0,
      });
      assertEqual(Flow.getPhaseLabel(), 'Recovery');
    });
  });
});
