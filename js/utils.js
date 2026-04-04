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

  return { formatMs };
})();
