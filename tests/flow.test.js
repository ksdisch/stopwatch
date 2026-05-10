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
