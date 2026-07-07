// ── ButtonFsm — shared state machine for the hero control buttons (M5) ──
//
// Single source of truth for what the primary btn-left / btn-right pair
// MEANS in each (mode, engine-status) state: label, css class, disabled
// flag, and the semantic action verb the click dispatches. ui.js
// (stopwatch) and timer-ui.js (timer) consult the same row for BOTH
// presentation and click dispatch, so label and behavior cannot drift
// apart (the pre-M5 rot shape: updateTimerUI showed "Done" on legacy
// status 'finished' while onTimerRight had no 'finished' branch — a dead
// button; the finished row below dispatches 'reset' like its label
// promises).
//
// Verbs are behavior identities, not labels: timer "Reset" and "Done" are
// the same operation (capture session + reset), so both map to 'reset'.
// The overflowing "+m:ss" overshoot suffix on Done is presentation and is
// appended by timer-ui — cells are frozen so a consumer can't decorate the
// shared table in place.
//
// Pure data — zero DOM, zero engine reads; callers pass the status in.
// Other modes (pomodoro/flow/interval/cooking) keep their bespoke handlers
// per the shared-button design decision; this table covers the two modes
// whose handlers were duplicated.
const ButtonFsm = (() => {
  function cell(label, cls, disabled, action) {
    return Object.freeze({ label, cls, disabled, action });
  }
  function row(left, right) {
    return Object.freeze({ left, right });
  }

  const TABLE = Object.freeze({
    stopwatch: Object.freeze({
      idle: row(
        cell('Lap', 'control-btn btn-lap', true, null),
        cell('Start', 'control-btn btn-start', false, 'start')
      ),
      running: row(
        cell('Lap', 'control-btn btn-lap', false, 'lap'),
        cell('Stop', 'control-btn btn-stop', false, 'pause')
      ),
      paused: row(
        cell('Reset', 'control-btn btn-reset', false, 'reset'),
        cell('Start', 'control-btn btn-start', false, 'start')
      ),
    }),
    timer: Object.freeze({
      idle: row(
        cell('--', 'control-btn btn-lap', true, null),
        cell('Start', 'control-btn btn-start', false, 'start')
      ),
      running: row(
        cell('--', 'control-btn btn-lap', true, null),
        cell('Stop', 'control-btn btn-stop', false, 'pause')
      ),
      paused: row(
        cell('Reset', 'control-btn btn-reset', false, 'reset'),
        cell('Start', 'control-btn btn-start', false, 'start')
      ),
      finished: row(
        cell('Reset', 'control-btn btn-reset', false, 'reset'),
        cell('Done', 'control-btn btn-start', false, 'reset')
      ),
      overflowing: row(
        cell('Reset', 'control-btn btn-reset', false, 'reset'),
        cell('Done', 'control-btn btn-start', false, 'reset')
      ),
    }),
  });

  function get(mode, status) {
    const m = TABLE[mode];
    return (m && m[status]) || null;
  }

  return { get };
})();
