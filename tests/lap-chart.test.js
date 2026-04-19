// SCAFFOLD — pending test stubs for the Lap Chart module.
// Acceptance criteria inferred from CLAUDE.md § "In Flight" → "Lap data
// visualization" (was Feature Backlog row 1): inline SVG bar chart of lap
// times below the lap list, no library, color-coded best/worst.

describe('LapChart — computeStats (pending)', () => {
  it.skip('returns null for empty laps', () => {
    // assertEqual(LapChart.computeStats([]), null);
  });

  it.skip('returns { best, worst, avg } in ms for 2+ laps', () => {
    // const stats = LapChart.computeStats([{ durationMs: 1000 }, { durationMs: 3000 }, { durationMs: 2000 }]);
    // assertEqual(stats.best, 1000);
    // assertEqual(stats.worst, 3000);
    // assertEqual(stats.avg, 2000);
  });
});

describe('LapChart — render (pending)', () => {
  it.skip('renders an <svg> with one <rect> per lap when laps.length >= 2', () => {
    // const el = document.createElement('div');
    // LapChart.render(el, [{ durationMs: 1000 }, { durationMs: 2000 }]);
    // const svg = el.querySelector('svg');
    // assert(svg !== null, 'svg should be present');
    // assertEqual(svg.querySelectorAll('rect').length, 2);
  });

  it.skip('renders nothing when laps.length < 2', () => {
    // const el = document.createElement('div');
    // LapChart.render(el, [{ durationMs: 1000 }]);
    // assertEqual(el.querySelector('svg'), null);
  });

  it.skip('color-codes the best (shortest) and worst (longest) lap distinctly', () => {
    // const el = document.createElement('div');
    // LapChart.render(el, [{ durationMs: 1000 }, { durationMs: 3000 }, { durationMs: 2000 }]);
    // const rects = el.querySelectorAll('rect');
    // // Fastest lap (1000ms) and slowest (3000ms) should have distinct classes/fills
    // // from the middle lap.
    // assert(rects[0].getAttribute('class') !== rects[2].getAttribute('class'));
    // assert(rects[1].getAttribute('class') !== rects[2].getAttribute('class'));
  });

  it.skip('bar widths scale proportionally to lap durationMs', () => {
    // const el = document.createElement('div');
    // LapChart.render(el, [{ durationMs: 1000 }, { durationMs: 2000 }]);
    // const rects = el.querySelectorAll('rect');
    // const w0 = parseFloat(rects[0].getAttribute('width'));
    // const w1 = parseFloat(rects[1].getAttribute('width'));
    // assertClose(w1 / w0, 2, 0.01);
  });
});
