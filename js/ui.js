const UI = (() => {
  let timeEl, btnLeft, btnRight, lapList, timerDisplay, appEl, rafId = null;

  function init() {
    timeEl = document.getElementById('time');
    btnLeft = document.getElementById('btn-left');
    btnRight = document.getElementById('btn-right');
    lapList = document.getElementById('lap-list');
    timerDisplay = document.getElementById('timer-display');
    appEl = document.getElementById('app');

    btnLeft.addEventListener('click', onLeftClick);
    btnRight.addEventListener('click', onRightClick);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Stopwatch.getStatus() === 'running') {
        startRenderLoop();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          onRightClick();
          break;
        case 'KeyL':
          if (Stopwatch.getStatus() === 'running') onLeftClick();
          break;
        case 'KeyR':
          if (Stopwatch.getStatus() === 'paused') onLeftClick();
          break;
        case 'Escape':
          OffsetInput.hide();
          break;
      }
    });

    syncUI();
  }

  function onLeftClick() {
    const status = Stopwatch.getStatus();
    if (status === 'running') {
      Stopwatch.lap();
      Persistence.save();
      renderLaps(true);
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
    const t = Utils.formatMs(ms);
    if (t.hours > 0) {
      timeEl.innerHTML = `${t.hours}:${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`;
    } else {
      timeEl.innerHTML = `${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`;
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
        timerDisplay.classList.remove('is-running');
        appEl.classList.remove('is-running');
        break;
      case 'running':
        btnLeft.innerHTML = '<span class="btn-inner">Lap</span>';
        btnLeft.className = 'control-btn btn-lap';
        btnLeft.disabled = false;
        btnLeft.setAttribute('aria-label', 'Lap');
        btnRight.innerHTML = '<span class="btn-inner">Stop</span>';
        btnRight.className = 'control-btn btn-stop';
        btnRight.setAttribute('aria-label', 'Stop');
        timerDisplay.classList.add('is-running');
        appEl.classList.add('is-running');
        break;
      case 'paused':
        btnLeft.innerHTML = '<span class="btn-inner">Reset</span>';
        btnLeft.className = 'control-btn btn-reset';
        btnLeft.disabled = false;
        btnLeft.setAttribute('aria-label', 'Reset');
        btnRight.innerHTML = '<span class="btn-inner">Start</span>';
        btnRight.className = 'control-btn btn-start';
        btnRight.setAttribute('aria-label', 'Start');
        timerDisplay.classList.remove('is-running');
        appEl.classList.remove('is-running');
        break;
    }
  }

  function renderLaps(scrollToTop) {
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
    if (scrollToTop) {
      lapList.scrollTop = 0;
    }
  }

  function formatTime(ms) {
    const t = Utils.formatMs(ms);
    if (t.hours > 0) {
      return `${t.hours}:${t.minStr}:${t.secStr}.${t.csStr}`;
    }
    return `${t.minStr}:${t.secStr}.${t.csStr}`;
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
