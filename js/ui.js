const UI = (() => {
  let timeEl, btnLeft, btnRight, lapList, rafId = null;

  function init() {
    timeEl = document.getElementById('time');
    btnLeft = document.getElementById('btn-left');
    btnRight = document.getElementById('btn-right');
    lapList = document.getElementById('lap-list');

    btnLeft.addEventListener('click', onLeftClick);
    btnRight.addEventListener('click', onRightClick);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Stopwatch.getStatus() === 'running') {
        startRenderLoop();
      }
    });

    syncUI();
  }

  function onLeftClick() {
    const status = Stopwatch.getStatus();
    if (status === 'running') {
      Stopwatch.lap();
      Persistence.save();
      renderLaps();
    } else if (status === 'paused') {
      Stopwatch.reset();
      Persistence.save();
      syncUI();
    }
  }

  function onRightClick() {
    const status = Stopwatch.getStatus();
    if (status === 'running') {
      Stopwatch.pause();
      Persistence.save();
      stopRenderLoop();
      syncUI();
    } else {
      // idle or paused -> start
      Stopwatch.start();
      Persistence.save();
      startRenderLoop();
      syncUI();
    }
  }

  function syncUI() {
    const status = Stopwatch.getStatus();
    updateDisplay(Stopwatch.getElapsedMs());
    updateButtons(status);
    renderLaps();
    OffsetInput.setVisible(status === 'idle');

    if (status === 'running') {
      startRenderLoop();
    }
  }

  function updateDisplay(ms) {
    const totalCs = Math.floor(ms / 10);
    const cs = totalCs % 100;
    const totalSeconds = Math.floor(totalCs / 100);
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);

    const csStr = String(cs).padStart(2, '0');
    const secStr = String(seconds).padStart(2, '0');
    const minStr = String(minutes).padStart(2, '0');

    if (hours > 0) {
      timeEl.innerHTML = `${hours}:${minStr}:${secStr}<span class="centiseconds">.${csStr}</span>`;
    } else {
      timeEl.innerHTML = `${minStr}:${secStr}<span class="centiseconds">.${csStr}</span>`;
    }
  }

  function updateButtons(status) {
    switch (status) {
      case 'idle':
        btnLeft.innerHTML = '<span class="btn-inner">Lap</span>';
        btnLeft.className = 'control-btn btn-lap';
        btnLeft.disabled = true;
        btnLeft.setAttribute('aria-label', 'Lap');
        btnRight.innerHTML = '<span class="btn-inner">Start</span>';
        btnRight.className = 'control-btn btn-start';
        btnRight.setAttribute('aria-label', 'Start');
        break;
      case 'running':
        btnLeft.innerHTML = '<span class="btn-inner">Lap</span>';
        btnLeft.className = 'control-btn btn-lap';
        btnLeft.disabled = false;
        btnLeft.setAttribute('aria-label', 'Lap');
        btnRight.innerHTML = '<span class="btn-inner">Stop</span>';
        btnRight.className = 'control-btn btn-stop';
        btnRight.setAttribute('aria-label', 'Stop');
        break;
      case 'paused':
        btnLeft.innerHTML = '<span class="btn-inner">Reset</span>';
        btnLeft.className = 'control-btn btn-reset';
        btnLeft.disabled = false;
        btnLeft.setAttribute('aria-label', 'Reset');
        btnRight.innerHTML = '<span class="btn-inner">Start</span>';
        btnRight.className = 'control-btn btn-start';
        btnRight.setAttribute('aria-label', 'Start');
        break;
    }
  }

  function renderLaps() {
    const laps = Stopwatch.getLaps();
    const status = Stopwatch.getStatus();

    if (laps.length === 0 && status !== 'running') {
      lapList.innerHTML = '';
      return;
    }

    // Find best/worst lap times (only when 2+ completed laps)
    let bestIdx = -1, worstIdx = -1;
    if (laps.length >= 2) {
      let bestMs = Infinity, worstMs = -1;
      laps.forEach((lap, i) => {
        if (lap.lapMs < bestMs) { bestMs = lap.lapMs; bestIdx = i; }
        if (lap.lapMs > worstMs) { worstMs = lap.lapMs; worstIdx = i; }
      });
    }

    let html = '';

    // Current (in-progress) lap at top
    if (status === 'running') {
      const currentLapMs = Stopwatch.getCurrentLapMs();
      html += `<div class="lap-row">
        <span class="lap-label">Lap ${laps.length + 1}</span>
        <span class="lap-time">${formatTime(currentLapMs)}</span>
      </div>`;
    }

    // Completed laps in reverse order
    for (let i = laps.length - 1; i >= 0; i--) {
      const lap = laps[i];
      let cls = '';
      if (i === bestIdx) cls = 'lap-best';
      else if (i === worstIdx) cls = 'lap-worst';

      html += `<div class="lap-row ${cls}">
        <span class="lap-label">Lap ${i + 1}</span>
        <span class="lap-time">${formatTime(lap.lapMs)}</span>
      </div>`;
    }

    lapList.innerHTML = html;
  }

  function formatTime(ms) {
    const totalCs = Math.floor(ms / 10);
    const cs = totalCs % 100;
    const totalSeconds = Math.floor(totalCs / 100);
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);

    const csStr = String(cs).padStart(2, '0');
    const secStr = String(seconds).padStart(2, '0');
    const minStr = String(minutes).padStart(2, '0');

    if (hours > 0) {
      return `${hours}:${minStr}:${secStr}.${csStr}`;
    }
    return `${minStr}:${secStr}.${csStr}`;
  }

  function startRenderLoop() {
    if (rafId !== null) return;
    function tick() {
      if (Stopwatch.getStatus() === 'running') {
        updateDisplay(Stopwatch.getElapsedMs());
        renderLaps();
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = null;
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  function stopRenderLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  return { init, updateDisplay, syncUI };
})();
