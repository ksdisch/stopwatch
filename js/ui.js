const UI = (() => {
  let timeEl, btnLeft, btnRight, lapList, timerDisplay, appEl, rafId = null;
  let lastResetState = null;
  let undoTimeout = null;

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
      if (document.visibilityState === 'visible') {
        if ((typeof appMode === 'undefined' || appMode === 'stopwatch') && Stopwatch.getStatus() === 'running') {
          startRenderLoop();
        }
        if (typeof appMode !== 'undefined' && appMode === 'pomodoro' && typeof Pomodoro !== 'undefined' && Pomodoro.getStatus() === 'running' && typeof startPomodoroRenderLoop === 'function') {
          startPomodoroRenderLoop();
        }
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (typeof appMode !== 'undefined' && appMode !== 'stopwatch') return;
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

  function haptic(ms) {
    if (navigator.vibrate) navigator.vibrate(ms);
  }

  function announce(msg) {
    const el = document.getElementById('sr-announce');
    if (el) {
      el.textContent = '';
      requestAnimationFrame(() => { el.textContent = msg; });
    }
  }

  function onLeftClick() {
    if (typeof appMode !== 'undefined' && appMode !== 'stopwatch') return;
    const status = Stopwatch.getStatus();
    if (status === 'running') {
      Stopwatch.lap();
      Persistence.save();
      haptic(10);
      SFX.playLap();
      announce('Lap ' + Stopwatch.getLaps().length + ' recorded');
      renderLaps(true);
    } else if (status === 'paused') {
      lastResetState = Stopwatch.getState();
      Stopwatch.reset();
      Persistence.save();
      haptic(25);
      SFX.playReset();
      announce('Stopwatch reset');
      syncUI();
      showUndoToast();
    }
  }

  function onRightClick() {
    if (typeof appMode !== 'undefined' && appMode !== 'stopwatch') return;
    const status = Stopwatch.getStatus();
    if (status === 'running') {
      Stopwatch.pause();
      Persistence.save();
      haptic(25);
      SFX.playStop();
      announce('Stopwatch paused');
      stopRenderLoop();
      syncUI();
    } else {
      // idle or paused -> start
      Stopwatch.start();
      Persistence.save();
      haptic(10);
      SFX.playStart();
      announce('Stopwatch started');
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
    Analog.update(ms);
  }

  function updateButtons(status) {
    const leftText = status === 'paused' ? 'Reset' : 'Lap';
    const rightText = status === 'running' ? 'Stop' : 'Start';
    const leftClass = status === 'paused' ? 'control-btn btn-reset' : 'control-btn btn-lap';
    const rightClass = status === 'running' ? 'control-btn btn-stop' : 'control-btn btn-start';
    const isRunning = status === 'running';

    // Animate button text swap
    animateBtn(btnLeft, leftText, leftClass, status === 'idle', leftText === 'Lap' ? 'Lap' : 'Reset');
    animateBtn(btnRight, rightText, rightClass, false, rightText === 'Start' ? 'Start' : 'Stop');

    timerDisplay.classList.toggle('is-running', isRunning);
    appEl.classList.toggle('is-running', isRunning);
  }

  function animateBtn(btn, text, cls, disabled, label) {
    const currentText = btn.querySelector('.btn-inner');
    if (currentText && currentText.textContent === text) {
      // No text change — just update class/disabled
      btn.className = cls;
      btn.disabled = disabled;
      btn.setAttribute('aria-label', label);
      return;
    }

    btn.classList.add('btn-transitioning');
    setTimeout(() => {
      btn.innerHTML = `<span class="btn-inner">${text}</span>`;
      btn.className = cls;
      btn.disabled = disabled;
      btn.setAttribute('aria-label', label);
    }, 80);
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
      html += `<div class="lap-row" id="current-lap">
        <div class="lap-row-inner">
          <span class="lap-label">Lap ${laps.length + 1}</span>
          <span class="lap-time" id="current-lap-time">${formatTime(currentLapMs)}</span>
        </div>
      </div>`;
    }

    // Completed laps in reverse order
    for (let i = laps.length - 1; i >= 0; i--) {
      const lap = laps[i];
      let cls = '';
      if (i === bestIdx) cls = 'lap-best';
      else if (i === worstIdx) cls = 'lap-worst';

      const animCls = scrollToTop && i === laps.length - 1 ? ' lap-entering' : '';
      html += `<div class="lap-row lap-swipeable ${cls}${animCls}" data-lap-index="${i}">
        <div class="lap-row-delete-bg">Delete</div>
        <div class="lap-row-inner">
          <span class="lap-label">Lap ${i + 1}</span>
          <span class="lap-time">${formatTime(lap.lapMs)}</span>
        </div>
      </div>`;
    }

    lapList.innerHTML = html;
    if (scrollToTop) {
      lapList.scrollTop = 0;
    }
    renderLapStats();
    attachSwipeHandlers();
  }

  function attachSwipeHandlers() {
    const THRESHOLD = 80;
    lapList.querySelectorAll('.lap-swipeable').forEach(row => {
      const inner = row.querySelector('.lap-row-inner');
      let startX = 0, startY = 0, currentX = 0, isSwiping = false, isScrolling = false;

      row.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        currentX = 0;
        isSwiping = false;
        isScrolling = false;
        row.classList.remove('lap-row-swiping');
      }, { passive: true });

      row.addEventListener('touchmove', (e) => {
        if (isScrolling) return;
        const touch = e.touches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;

        // Determine intent on first significant move
        if (!isSwiping && !isScrolling) {
          if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 5) {
            isScrolling = true;
            return;
          }
          if (Math.abs(dx) > 5) {
            isSwiping = true;
            row.classList.add('lap-row-swiping');
          }
        }

        if (isSwiping) {
          e.preventDefault();
          currentX = Math.min(0, dx); // Only allow left swipe
          inner.style.transform = `translateX(${currentX}px)`;
        }
      }, { passive: false });

      row.addEventListener('touchend', () => {
        if (!isSwiping) return;
        row.classList.remove('lap-row-swiping');

        if (Math.abs(currentX) > THRESHOLD) {
          // Delete the lap
          const index = parseInt(row.dataset.lapIndex, 10);
          const stateBeforeDelete = Stopwatch.getState();

          row.classList.add('lap-row-removing');
          inner.style.transform = `translateX(-100%)`;

          setTimeout(() => {
            Stopwatch.deleteLap(index);
            Persistence.save();
            renderLaps();
            showDeleteUndoToast(stateBeforeDelete);
          }, 200);
        } else {
          // Snap back
          inner.style.transform = '';
        }
      }, { passive: true });
    });
  }

  function showDeleteUndoToast(savedState) {
    hideUndoToast();
    const toast = document.createElement('div');
    toast.id = 'undo-toast';
    toast.className = 'undo-toast';
    toast.innerHTML = 'Lap deleted <button id="undo-btn" class="undo-btn">Undo</button>';
    document.getElementById('app').appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('undo-visible'));

    document.getElementById('undo-btn').addEventListener('click', () => {
      if (savedState) {
        Stopwatch.loadState(savedState);
        Persistence.save();
        renderLaps();
        renderLapStats();
      }
      hideUndoToast();
    });

    undoTimeout = setTimeout(hideUndoToast, 5000);
  }

  function renderLapStats() {
    const statsEl = document.getElementById('lap-stats');
    const laps = Stopwatch.getLaps();
    if (laps.length < 2) {
      statsEl.classList.add('hidden');
      return;
    }
    const times = laps.map(l => l.lapMs);
    const best = Math.min(...times);
    const worst = Math.max(...times);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    statsEl.innerHTML = `<span>Avg ${formatTime(avg)}</span><span>Best ${formatTime(best)}</span><span>Worst ${formatTime(worst)}</span>`;
    statsEl.classList.remove('hidden');
  }

  function updateCurrentLap() {
    const el = document.getElementById('current-lap-time');
    if (el) {
      el.textContent = formatTime(Stopwatch.getCurrentLapMs());
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
      if (typeof appMode !== 'undefined' && appMode !== 'stopwatch') {
        rafId = null;
        return;
      }
      if (Stopwatch.getStatus() === 'running') {
        // Check alerts
        const firedAlerts = Stopwatch.checkAlerts();
        if (firedAlerts.length > 0) {
          firedAlerts.forEach(ms => {
            const t = Utils.formatMs(ms);
            const timeStr = t.hours > 0
              ? `${t.hours}:${t.minStr}:${t.secStr}`
              : `${t.minStr}:${t.secStr}`;
            SFX.playAlarm();
            if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              new Notification('Stopwatch Alert', { body: `${timeStr} reached` });
            }
          });
          Persistence.save();
          if (typeof renderAlerts === 'function') renderAlerts();
        }
        updateDisplay(Stopwatch.getElapsedMs());
        updateCurrentLap();
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

  function showUndoToast() {
    hideUndoToast();
    const toast = document.createElement('div');
    toast.id = 'undo-toast';
    toast.className = 'undo-toast';
    toast.innerHTML = 'Timer reset <button id="undo-btn" class="undo-btn">Undo</button>';
    document.getElementById('app').appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('undo-visible'));

    document.getElementById('undo-btn').addEventListener('click', () => {
      if (lastResetState) {
        Stopwatch.loadState(lastResetState);
        lastResetState = null;
        Persistence.save();
        syncUI();
      }
      hideUndoToast();
    });

    undoTimeout = setTimeout(hideUndoToast, 5000);
  }

  function hideUndoToast() {
    clearTimeout(undoTimeout);
    const toast = document.getElementById('undo-toast');
    if (toast) toast.remove();
    lastResetState = null;
  }

  return { init, updateDisplay, syncUI, stopRenderLoop };
})();
