const Utils = (() => {
  function formatMs(ms) {
    const totalCs = Math.floor(ms / 10);
    const cs = totalCs % 100;
    const totalSeconds = Math.floor(totalCs / 100);
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);

    return {
      hours,
      minutes,
      seconds,
      centiseconds: cs,
      minStr: String(minutes).padStart(2, '0'),
      secStr: String(seconds).padStart(2, '0'),
      csStr: String(cs).padStart(2, '0'),
    };
  }

  // Signed formatter for countdown surfaces that overflow past zero.
  // When elapsed <= duration, returns the standard formatMs result for the
  // remaining time. Once elapsed > duration, returns the overshoot duration
  // pre-formatted with a leading "+" for the seconds portion.
  function formatMsSigned(elapsedMs, durationMs) {
    const overshoot = Math.max(0, elapsedMs - durationMs);
    const isOvershoot = overshoot > 0;
    if (!isOvershoot) {
      const remaining = Math.max(0, durationMs - elapsedMs);
      const t = formatMs(remaining);
      return { ...t, isOvershoot: false, overshootMs: 0, prefix: '' };
    }
    const t = formatMs(overshoot);
    return { ...t, isOvershoot: true, overshootMs: overshoot, prefix: '+' };
  }

  // Compact "M:SS" formatter for badges (no centiseconds, no leading-zero
  // hours). Used by history list rows and analytics summaries.
  function formatShort(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // Human-readable duration: the largest non-zero unit plus the contiguous
  // next-lower unit(s) up to maxUnits (default 2), trimming trailing zero
  // units. Spans days → seconds. Unifies the three divergent wellness
  // formatDuration() copies (E-visual E10) so the same duration renders
  // identically on every surface (cooking/exercise durations, meds "last
  // taken … ago"). Examples (maxUnits 2): 0→"0s", 45s→"45s", 5m30s→"5m 30s",
  // 5m0s→"5m", 2h0m→"2h", 2h5m→"2h 5m", 1h0m30s→"1h" (no zero-skipping),
  // 3d4h→"3d 4h", 3d0h→"3d".
  function formatHuman(ms, opts) {
    const maxUnits = (opts && opts.maxUnits) || 2;
    const totalSec = Math.max(0, Math.floor((ms || 0) / 1000));
    const units = [
      [Math.floor(totalSec / 86400), 'd'],
      [Math.floor((totalSec % 86400) / 3600), 'h'],
      [Math.floor((totalSec % 3600) / 60), 'm'],
      [totalSec % 60, 's'],
    ];
    const top = units.findIndex((u) => u[0] > 0);
    if (top === -1) return '0s';
    // Contiguous window from the top unit, then trim trailing zero units so
    // round durations read "2h" not "2h 0m" — but never skip an interior
    // zero (1h0m30s → "1h", not "1h 30s").
    const win = units.slice(top, top + maxUnits);
    while (win.length > 1 && win[win.length - 1][0] === 0) win.pop();
    return win.map(([v, u]) => `${v}${u}`).join(' ');
  }

  // YYYY-MM-DD in the user's local timezone. Used for day-bucketing across
  // analytics, rhythm, and any other read-side aggregator that needs to
  // group events by calendar day (UTC keys mis-bucket evening sessions).
  function localDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  return { formatMs, formatMsSigned, formatShort, formatHuman, localDateKey };
})();
