// ButtonFsm — pins the shared (mode, status) → button-cell table that ui.js
// and timer-ui.js consult for both presentation and click dispatch (M5).
// Wrapped in an IIFE: test files share the page's global scope, so local
// helpers must not leak (the test-scope const-collision gotcha).
(() => {
  const SW_STATUSES = ['idle', 'running', 'paused'];
  const TIMER_STATUSES = ['idle', 'running', 'paused', 'finished', 'overflowing'];

  function assertCell(row, side, label, cls, disabled, action) {
    assert(row !== null && row !== undefined, 'row missing');
    const c = row[side];
    assert(!!c, side + ' cell missing');
    assertEqual(c.label, label);
    assertEqual(c.cls, cls);
    assertEqual(c.disabled, disabled);
    assertEqual(c.action, action);
  }

  function forEachCell(fn) {
    const modes = { stopwatch: SW_STATUSES, timer: TIMER_STATUSES };
    Object.keys(modes).forEach((mode) => {
      modes[mode].forEach((status) => {
        const row = ButtonFsm.get(mode, status);
        assert(row !== null, 'missing row: ' + mode + '/' + status);
        fn(row.left, mode, status, 'left');
        fn(row.right, mode, status, 'right');
      });
    });
  }

  describe('ButtonFsm — lookup + null safety', () => {
    it('returns null for unknown mode or status', () => {
      assertEqual(ButtonFsm.get('pomodoro', 'running'), null);
      assertEqual(ButtonFsm.get('stopwatch', 'exploded'), null);
      assertEqual(ButtonFsm.get(undefined, undefined), null);
    });

    it('has rows for all three stopwatch statuses', () => {
      SW_STATUSES.forEach((s) => {
        assert(ButtonFsm.get('stopwatch', s) !== null, 'missing stopwatch row: ' + s);
      });
    });

    it('has rows for all five timer statuses', () => {
      TIMER_STATUSES.forEach((s) => {
        assert(ButtonFsm.get('timer', s) !== null, 'missing timer row: ' + s);
      });
    });
  });

  describe('ButtonFsm — stopwatch cells (pin current ui.js behavior)', () => {
    it('idle: left Lap disabled with no action; right Start → start', () => {
      const r = ButtonFsm.get('stopwatch', 'idle');
      assertCell(r, 'left', 'Lap', 'control-btn btn-lap', true, null);
      assertCell(r, 'right', 'Start', 'control-btn btn-start', false, 'start');
    });

    it('running: left Lap → lap; right Stop → pause', () => {
      const r = ButtonFsm.get('stopwatch', 'running');
      assertCell(r, 'left', 'Lap', 'control-btn btn-lap', false, 'lap');
      assertCell(r, 'right', 'Stop', 'control-btn btn-stop', false, 'pause');
    });

    it('paused: left Reset → reset; right Start → start', () => {
      const r = ButtonFsm.get('stopwatch', 'paused');
      assertCell(r, 'left', 'Reset', 'control-btn btn-reset', false, 'reset');
      assertCell(r, 'right', 'Start', 'control-btn btn-start', false, 'start');
    });
  });

  describe('ButtonFsm — timer cells (pin current timer-ui.js behavior)', () => {
    it('idle: left -- disabled with no action; right Start → start', () => {
      const r = ButtonFsm.get('timer', 'idle');
      assertCell(r, 'left', '--', 'control-btn btn-lap', true, null);
      assertCell(r, 'right', 'Start', 'control-btn btn-start', false, 'start');
    });

    it('running: left -- disabled with no action; right Stop → pause', () => {
      const r = ButtonFsm.get('timer', 'running');
      assertCell(r, 'left', '--', 'control-btn btn-lap', true, null);
      assertCell(r, 'right', 'Stop', 'control-btn btn-stop', false, 'pause');
    });

    it('paused: left Reset → reset; right Start → start', () => {
      const r = ButtonFsm.get('timer', 'paused');
      assertCell(r, 'left', 'Reset', 'control-btn btn-reset', false, 'reset');
      assertCell(r, 'right', 'Start', 'control-btn btn-start', false, 'start');
    });

    it("finished: right Done acts as 'reset' — repairs the legacy dead button (label said Done, dispatch had no branch)", () => {
      const r = ButtonFsm.get('timer', 'finished');
      assertCell(r, 'left', 'Reset', 'control-btn btn-reset', false, 'reset');
      assertCell(r, 'right', 'Done', 'control-btn btn-start', false, 'reset');
    });

    it('overflowing: both Reset and Done → reset (the "+m:ss" overshoot suffix is presentation, added by timer-ui)', () => {
      const r = ButtonFsm.get('timer', 'overflowing');
      assertCell(r, 'left', 'Reset', 'control-btn btn-reset', false, 'reset');
      assertCell(r, 'right', 'Done', 'control-btn btn-start', false, 'reset');
    });
  });

  describe('ButtonFsm — invariants', () => {
    it('disabled cells carry no action; enabled cells always carry one', () => {
      forEachCell((c, mode, status, side) => {
        const where = mode + '/' + status + '/' + side;
        if (c.disabled) {
          assertEqual(c.action, null);
        } else {
          assert(typeof c.action === 'string' && c.action.length > 0,
            'enabled cell missing action: ' + where);
        }
      });
    });

    it('every cls is a control-btn variant', () => {
      forEachCell((c, mode, status, side) => {
        assert(c.cls.indexOf('control-btn ') === 0,
          'bad cls at ' + mode + '/' + status + '/' + side + ': ' + c.cls);
      });
    });

    it('cells are frozen — consumers cannot corrupt the shared table', () => {
      forEachCell((c) => assert(Object.isFrozen(c), 'unfrozen cell'));
      const r = ButtonFsm.get('timer', 'overflowing');
      try { r.right.label = 'Done +0:12'; } catch (_e) { /* strict-mode throw is fine */ }
      assertEqual(ButtonFsm.get('timer', 'overflowing').right.label, 'Done');
    });
  });
})();
