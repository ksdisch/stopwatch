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

  return { formatMs, formatMsSigned, formatShort };
})();
