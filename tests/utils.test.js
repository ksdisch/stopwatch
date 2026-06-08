// Utils.formatHuman — the unified duration humanizer that replaced the three
// divergent formatDuration() copies in wellness-cooking-ui / exercise-ui /
// meds-ui (E-polish follow-up, E-visual finding E10). Locks the contiguous
// top-unit + trim-trailing-zero behavior so a future change can't silently
// re-diverge the wellness/meds duration output.

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

describe('Utils.formatHuman — unified duration humanizer', () => {
  it('zero / falsy / negative → "0s"', () => {
    assertEqual(Utils.formatHuman(0), '0s');
    assertEqual(Utils.formatHuman(null), '0s');
    assertEqual(Utils.formatHuman(undefined), '0s');
    assertEqual(Utils.formatHuman(-5000), '0s');
    assertEqual(Utils.formatHuman(999), '0s'); // <1s floors to 0
  });

  it('seconds-only', () => {
    assertEqual(Utils.formatHuman(1 * S), '1s');
    assertEqual(Utils.formatHuman(45 * S), '45s');
    assertEqual(Utils.formatHuman(59 * S), '59s');
  });

  it('minutes: shows seconds only when non-zero (trims trailing 0s)', () => {
    assertEqual(Utils.formatHuman(5 * M), '5m');            // was "5m 0s" in wcook/exercise
    assertEqual(Utils.formatHuman(5 * M + 30 * S), '5m 30s');
    assertEqual(Utils.formatHuman(1 * M + 1 * S), '1m 1s');
    assertEqual(Utils.formatHuman(59 * M + 59 * S), '59m 59s');
  });

  it('hours: shows minutes only when non-zero (trims trailing 0m)', () => {
    assertEqual(Utils.formatHuman(2 * H), '2h');            // was "2h 0m"
    assertEqual(Utils.formatHuman(2 * H + 5 * M), '2h 5m');
    assertEqual(Utils.formatHuman(1 * H + 30 * M), '1h 30m');
  });

  it('does not skip an interior zero unit (1h 0m 30s → "1h", never "1h 30s")', () => {
    assertEqual(Utils.formatHuman(1 * H + 0 * M + 30 * S), '1h');
    assertEqual(Utils.formatHuman(3 * D + 0 * H + 30 * M), '3d');
  });

  it('days tier (meds "last taken … ago")', () => {
    assertEqual(Utils.formatHuman(3 * D + 4 * H), '3d 4h');
    assertEqual(Utils.formatHuman(1 * D), '1d');            // trims trailing 0h
    assertEqual(Utils.formatHuman(2 * D + 0 * H), '2d');
  });

  it('maxUnits option widens the window (default 2)', () => {
    assertEqual(Utils.formatHuman(2 * H + 5 * M + 30 * S), '2h 5m');           // default 2
    assertEqual(Utils.formatHuman(2 * H + 5 * M + 30 * S, { maxUnits: 3 }), '2h 5m 30s');
    assertEqual(Utils.formatHuman(1 * D + 2 * H + 5 * M, { maxUnits: 3 }), '1d 2h 5m');
    // trailing-zero trim still applies inside a wider window
    assertEqual(Utils.formatHuman(2 * H + 5 * M, { maxUnits: 3 }), '2h 5m');
  });

  it('matches the old meds days/hours output for the hours+ range it shared', () => {
    // meds old: hours>0 → "Hh Mm"; days>0 → "Dd Hh". Unchanged by the merge.
    assertEqual(Utils.formatHuman(5 * H + 12 * M), '5h 12m');
    assertEqual(Utils.formatHuman(10 * D + 3 * H), '10d 3h');
  });
});
