const Export = (() => {

  function formatMs(ms) {
    const t = Utils.formatMs(ms);
    if (t.hours > 0) return `${t.hours}:${t.minStr}:${t.secStr}.${t.csStr}`;
    return `${t.minStr}:${t.secStr}.${t.csStr}`;
  }

  function lapsToText(laps, totalElapsed) {
    let text = 'Lap\tTime\n';
    text += '---\t----\n';
    laps.forEach((lap, i) => {
      text += `Lap ${i + 1}\t${formatMs(lap.lapMs)}\n`;
    });
    text += `---\t----\n`;
    text += `Total\t${formatMs(totalElapsed)}\n`;
    return text;
  }

  function lapsToCSV(laps, totalElapsed) {
    let csv = 'Lap,Time (ms),Time (formatted)\n';
    laps.forEach((lap, i) => {
      csv += `${i + 1},${lap.lapMs},${formatMs(lap.lapMs)}\n`;
    });
    csv += `Total,${totalElapsed},${formatMs(totalElapsed)}\n`;
    return csv;
  }

  async function copyToClipboard(laps, totalElapsed) {
    const text = lapsToText(laps, totalElapsed);
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      return false;
    }
  }

  function downloadCSV(laps, totalElapsed) {
    const csv = lapsToCSV(laps, totalElapsed);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stopwatch-laps-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function share(laps, totalElapsed) {
    const text = lapsToText(laps, totalElapsed);
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Stopwatch Laps', text });
        return true;
      } catch (e) { return false; }
    }
    return copyToClipboard(laps, totalElapsed);
  }

  function canShare() {
    return !!navigator.share;
  }

  return { copyToClipboard, downloadCSV, share, canShare, lapsToText, lapsToCSV };
})();
