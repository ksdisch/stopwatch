// ── Lap Chart (inline SVG bar chart of lap times) ──
// SCAFFOLD — implementation pending.
// See CLAUDE.md § "In Flight" → "Lap data visualization" for the backlog row
// this module was scaffolded from. Ready for human design review before
// implementation.
const LapChart = (() => {
  // Renders an inline SVG bar chart of lap durations into the given container.
  // Expected shape: laps = [{ durationMs: number, ... }, ...] (matches stopwatch laps).
  // No-op when fewer than 2 laps (single lap / no laps = nothing to visualize).
  function render(_containerEl, _laps) {
    // SCAFFOLD: pending implementation.
    // Build inline <svg> with one <rect> per lap, widths proportional to
    // durationMs, with best/worst color-coded. No external library.
  }

  // Clears any previously-rendered chart from the container and hides it.
  function clear(_containerEl) {
    // SCAFFOLD: pending implementation.
  }

  // Returns summary stats for an array of laps: { best, worst, avg } in ms.
  // Returns null when laps is empty or invalid — so UI code can early-return.
  function computeStats(_laps) {
    // SCAFFOLD: pending implementation.
    return null;
  }

  return { render, clear, computeStats };
})();
