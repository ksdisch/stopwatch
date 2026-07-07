const UI = (() => {
  let timeEl, btnLeft, btnRight, lapList, timerDisplay, appEl, rafId = null;
  let lastResetState = null;
  let undoTimeout = null;
  let showCumulative = localStorage.getItem('lap_display_mode') === 'cumulative';
  let vibrateIntervalMs = parseInt(localStorage.getItem('vibrate_interval') || '0', 10);
  let lastVibrateMs = 0;

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
      if (document.visibilityState !== 'visible') return;
      // F-pwa: a backgrounded AudioContext stays suspended on return; resume
      // it so the completion alarm is audible after a lock/unlock.
      if (typeof SFX !== 'undefined' && typeof SFX.resume === 'function') SFX.resume();

      // F-pwa: re-arm the active mode's render loop. RAF is throttled while
      // hidden, so the display is frozen until something ticks again. Only the
      // running engine for the current mode is restarted (mirrors applyAppMode).
      const mode = (typeof appMode !== 'undefined') ? appMode : 'stopwatch';
      if (mode === 'stopwatch' && Stopwatch.getStatus() === 'running') {
        startRenderLoop();
      } else if (mode === 'pomodoro' && typeof Pomodoro !== 'undefined' && Pomodoro.getStatus() === 'running' && typeof startPomodoroRenderLoop === 'function') {
        startPomodoroRenderLoop();
      } else if (mode === 'timer' && typeof Timer !== 'undefined' && Timer.getStatus() === 'running' && typeof startTimerRenderLoop === 'function') {
        startTimerRenderLoop();
      } else if (mode === 'flow' && typeof Flow !== 'undefined' && (Flow.getStatus() === 'running' || Flow.getStatus() === 'recovery') && typeof startFlowRenderLoop === 'function') {
        startFlowRenderLoop();
      } else if (mode === 'interval' && typeof Interval !== 'undefined' && Interval.getStatus() === 'running' && typeof startIntervalRenderLoop === 'function') {
        startIntervalRenderLoop();
      } else if (mode === 'cooking' && typeof cookingTimers !== 'undefined' && typeof startCookingRenderLoop === 'function'
                 && cookingTimers.some(ct => ct.timer.getStatus() === 'running')) {
        startCookingRenderLoop();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (isTextEntry(e.target)) return;
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

    // Vibrate interval selector
    const vibrateSelect = document.getElementById('vibrate-interval');
    if (vibrateSelect) {
      vibrateSelect.value = vibrateIntervalMs;
      vibrateSelect.addEventListener('change', () => {
        vibrateIntervalMs = parseInt(vibrateSelect.value, 10);
        localStorage.setItem('vibrate_interval', vibrateIntervalMs);
        lastVibrateMs = 0;
      });
    }

    syncUI();
  }

  function haptic(ms) {
    Platform.haptic(ms);
  }

  // announce(): shared global from js/dom-utils.js (Batch D — promoted so all
  // modes can use the same #sr-announce live region).

  // M5: click dispatch reads the same ButtonFsm row as updateButtons, so the
  // rendered label and the fired action can't drift apart.
  function onLeftClick() {
    if (typeof appMode !== 'undefined' && appMode !== 'stopwatch') return;
    const row = ButtonFsm.get('stopwatch', Stopwatch.getStatus());
    if (row) dispatchAction(row.left.action);
  }

  function onRightClick() {
    if (typeof appMode !== 'undefined' && appMode !== 'stopwatch') return;
    const row = ButtonFsm.get('stopwatch', Stopwatch.getStatus());
    if (row) dispatchAction(row.right.action);
  }

  function dispatchAction(action) {
    switch (action) {
      case 'lap':
        Stopwatch.lap();
        Persistence.save();
        haptic(10);
        SFX.playLap();
        announce('Lap ' + Stopwatch.getLaps().length + ' recorded');
        renderLaps(true);
        break;
      case 'reset':
        lastResetState = Stopwatch.getState();
        Stopwatch.reset();
        Persistence.save();
        haptic(25);
        SFX.playReset();
        announce('Stopwatch reset');
        syncUI();
        showUndoToast();
        break;
      case 'pause':
        Stopwatch.pause();
        Persistence.save();
        haptic(25);
        SFX.playStop();
        announce('Stopwatch paused');
        stopRenderLoop();
        syncUI();
        break;
      case 'start':
        Stopwatch.start();
        Persistence.save();
        haptic(10);
        SFX.playStart();
        announce('Stopwatch started');
        startRenderLoop();
        syncUI();
        break;
    }
  }

  function syncUI() {
    const status = Stopwatch.getStatus();
    if (status === 'idle') lastVibrateMs = 0;
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
    const row = ButtonFsm.get('stopwatch', status);
    if (!row) return;
    const isRunning = status === 'running';

    // Animate button text swap
    animateBtn(btnLeft, row.left.label, row.left.cls, row.left.disabled, row.left.label);
    animateBtn(btnRight, row.right.label, row.right.cls, row.right.disabled, row.right.label);

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

    const modeLabel = showCumulative ? 'Cumulative' : 'Lap Time';
    let html = `<div class="lap-header"><span class="lap-header-toggle" id="lap-mode-toggle">${modeLabel} &#x25BE;</span></div>`;

    // Current (in-progress) lap at top
    if (status === 'running') {
      const currentLapMs = Stopwatch.getCurrentLapMs();
      const currentElapsed = Stopwatch.getElapsedMs();
      const displayMs = showCumulative ? currentElapsed : currentLapMs;
      html += `<div class="lap-row" id="current-lap" role="listitem" aria-label="Current lap">
        <div class="lap-row-inner">
          <span class="lap-label">Lap ${laps.length + 1}</span>
          <span class="lap-time" id="current-lap-time">${formatTime(displayMs)}</span>
        </div>
      </div>`;
    }

    // Completed laps in reverse order
    for (let i = laps.length - 1; i >= 0; i--) {
      const lap = laps[i];
      let cls = '';
      if (i === bestIdx) cls = 'lap-best';
      else if (i === worstIdx) cls = 'lap-worst';

      const displayMs = showCumulative ? lap.totalMs : lap.lapMs;
      const animCls = scrollToTop && i === laps.length - 1 ? ' lap-entering' : '';
      html += `<div class="lap-row lap-swipeable ${cls}${animCls}" data-lap-index="${i}" role="listitem" tabindex="0" aria-label="Lap ${i + 1}, ${formatTime(displayMs)}" aria-keyshortcuts="Delete">
        <div class="lap-row-delete-bg">Delete</div>
        <div class="lap-row-inner">
          <span class="lap-label">Lap ${i + 1}</span>
          <span class="lap-time">${formatTime(displayMs)}</span>
        </div>
      </div>`;
    }

    lapList.innerHTML = html;

    const toggleBtn = document.getElementById('lap-mode-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        showCumulative = !showCumulative;
        localStorage.setItem('lap_display_mode', showCumulative ? 'cumulative' : 'split');
        renderLaps();
      });
    }

    if (scrollToTop) {
      lapList.scrollTop = 0;
    }
    renderLapStats();
    renderLapChart();
    attachSwipeHandlers();
  }

  function renderLapChart() {
    const chartEl = document.getElementById('lap-chart');
    const laps = Stopwatch.getLaps();
    if (laps.length < 2) {
      chartEl.classList.add('hidden');
      chartEl.innerHTML = '';
      return;
    }
    chartEl.classList.remove('hidden');

    const times = laps.map(l => l.lapMs);
    const maxTime = Math.max(...times);
    const bestIdx = times.indexOf(Math.min(...times));
    const worstIdx = times.indexOf(maxTime);
    const barCount = times.length;
    const gap = 2;
    const barWidth = Math.max(4, (100 / barCount) - gap);
    const totalWidth = barCount * (barWidth + gap) - gap;
    const offsetX = Math.max(0, (100 - totalWidth) / 2);

    let bars = '';
    times.forEach((ms, i) => {
      const height = maxTime > 0 ? (ms / maxTime) * 70 : 0;
      const x = offsetX + i * (barWidth + gap);
      const y = 75 - height;
      let cls = 'lap-chart-bar';
      if (i === bestIdx) cls = 'lap-chart-bar lap-chart-bar-best';
      else if (i === worstIdx) cls = 'lap-chart-bar lap-chart-bar-worst';
      bars += `<rect class="${cls}" x="${x}" y="${y}" width="${barWidth}" height="${height}" rx="1"/>`;
    });

    chartEl.innerHTML = `<svg viewBox="0 0 100 80" preserveAspectRatio="none">${bars}</svg>`;
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

      // D: keyboard/SR-operable delete — rows are focusable (tabindex=0); Delete
      // or Backspace runs the SAME delete path as the swipe. Swipe stays a
      // touch-only progressive enhancement.
      row.addEventListener('keydown', (e) => {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return;
        e.preventDefault();
        const index = parseInt(row.dataset.lapIndex, 10);
        const stateBeforeDelete = Stopwatch.getState();
        Stopwatch.deleteLap(index);
        Persistence.save();
        renderLaps();
        announce('Lap ' + (index + 1) + ' deleted');
        showDeleteUndoToast(stateBeforeDelete);
      });

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
      const ms = showCumulative ? Stopwatch.getElapsedMs() : Stopwatch.getCurrentLapMs();
      el.textContent = formatTime(ms);
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
            Platform.haptic([200, 100, 200, 100, 200]);
            Platform.notify('Stopwatch Alert', { body: `${timeStr} reached` });
          });
          Persistence.save();
          if (typeof renderAlerts === 'function') renderAlerts();
        }
        // Check vibration interval
        if (vibrateIntervalMs > 0) {
          const elapsed = Stopwatch.getElapsedMs();
          const currentInterval = Math.floor(elapsed / vibrateIntervalMs);
          const lastInterval = Math.floor(lastVibrateMs / vibrateIntervalMs);
          if (currentInterval > lastInterval && elapsed > vibrateIntervalMs) {
            Platform.haptic([100, 50, 100]);
          }
          lastVibrateMs = elapsed;
        }
        updateDisplay(Stopwatch.getElapsedMs());
        updateCurrentLap();
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = null;
        Platform.keepAwake(false);   // F-pwa: release when no longer running
      }
    }
    Platform.keepAwake(true);        // F-pwa: keep screen on while timing
    rafId = requestAnimationFrame(tick);
  }

  function stopRenderLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    Platform.keepAwake(false);       // F-pwa: release wake lock on pause/reset
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
