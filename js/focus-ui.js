// ── Focus / Ambient Display Mode ──
const FocusUI = (() => {
  let active = false;
  let rafId = null;
  let overlay = null;
  let lastTap = 0;
  let prevFocus = null; // D: restore focus to the opener when the overlay exits

  function enter() {
    if (active) return;
    active = true;

    prevFocus = document.activeElement; // D: restore on exit
    overlay = document.createElement('div');
    overlay.id = 'focus-overlay';
    overlay.className = 'focus-overlay';
    // D: full-screen modal surface for AT. The time ticks every frame, so it's
    // aria-hidden (a per-frame live region would spam SR); state changes go
    // through the polite #focus-status + announce() in togglePrimary/doLap.
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Focus display');
    overlay.tabIndex = -1;
    overlay.innerHTML = `
      <div class="focus-time" id="focus-time" aria-hidden="true"></div>
      <div class="focus-status" id="focus-status" aria-live="polite"></div>
      <div class="focus-hint">Tap or Space: pause/resume &middot; Double-tap or L: lap &middot; Esc / swipe down: exit</div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => { overlay.classList.add('focus-visible'); overlay.focus(); });

    // Gestures
    let touchStartY = 0;
    overlay.addEventListener('touchstart', (e) => {
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    overlay.addEventListener('touchend', (e) => {
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (dy > 80) {
        exit();
        return;
      }
      handleTap();
    }, { passive: true });

    overlay.addEventListener('click', (e) => {
      // Mouse fallback (desktop)
      if (e.pointerType === 'touch') return;
      handleTap();
    });

    // Keyboard: Escape exits; Space/Enter pause-resume; L lap (parity with tap).
    document.addEventListener('keydown', onKeydown);

    // Fullscreen
    try {
      const el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch (e) { /* fullscreen not available */ }

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);

    startLoop();
    updateFocus();
  }

  function exit() {
    if (!active) return;
    active = false;
    stopLoop();

    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus(); // D: restore focus
    prevFocus = null;

    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange);

    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.webkitFullscreenElement) document.webkitExitFullscreen();
    } catch (e) { /* ignore */ }
  }

  function isActive() { return active; }

  // D: lap (double-tap / "L") and pause-resume (single-tap / Space) extracted so
  // the keyboard handler can invoke the identical actions.
  function doLap() {
    if (appMode === 'stopwatch' && Stopwatch.getStatus() === 'running') {
      Stopwatch.lap();
      Persistence.save();
      SFX.playLap();
      announce('Lap recorded');
    }
  }

  function togglePrimary() {
    if (appMode === 'stopwatch') {
      if (Stopwatch.getStatus() === 'running') { Stopwatch.pause(); SFX.playStop(); announce('Paused'); }
      else { Stopwatch.start(); SFX.playStart(); announce('Started'); }
      Persistence.save();
    } else if (appMode === 'timer') {
      if (Timer.getStatus() === 'running') { Timer.pause(); SFX.playStop(); announce('Paused'); }
      else if (Timer.getStatus() === 'paused' || Timer.getStatus() === 'idle') { Timer.start(); SFX.playStart(); announce('Started'); }
    } else if (appMode === 'pomodoro') {
      if (Pomodoro.getStatus() === 'running') { Pomodoro.pause(); SFX.playStop(); announce('Paused'); }
      else if (Pomodoro.getStatus() === 'idle' || Pomodoro.getStatus() === 'paused') { Pomodoro.start(); SFX.playStart(); announce('Started'); }
    }
    updateFocus();
  }

  function handleTap() {
    const now = Date.now();
    if (now - lastTap < 300) {
      lastTap = 0;        // double tap → lap
      doLap();
      return;
    }
    lastTap = now;
    setTimeout(() => {
      if (lastTap === 0) return; // was double tap
      togglePrimary();           // single tap → pause/resume
    }, 300);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') { exit(); return; }
    if (e.key === ' ' || e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); togglePrimary(); return; }
    if (e.key === 'l' || e.key === 'L') { e.preventDefault(); doLap(); }
  }

  function onFullscreenChange() {
    if (!document.fullscreenElement && !document.webkitFullscreenElement && active) {
      exit();
    }
  }

  function getTimeMs() {
    if (appMode === 'stopwatch') return Stopwatch.getElapsedMs();
    if (appMode === 'timer') return Timer.getRemainingMs();
    if (appMode === 'pomodoro') return Pomodoro.getRemainingMs();
    if (appMode === 'interval' && typeof Interval !== 'undefined') return Interval.getRemainingMs();
    return 0;
  }

  function getStatusText() {
    let engine;
    if (appMode === 'stopwatch') engine = Stopwatch;
    else if (appMode === 'timer') engine = Timer;
    else if (appMode === 'pomodoro') engine = Pomodoro;
    else return '';

    const s = engine.getStatus();
    if (s === 'running') return '';
    if (s === 'paused') return 'Paused';
    if (s === 'idle') return 'Ready';
    if (s === 'phaseComplete') return 'Phase Complete';
    if (s === 'done') return 'Done';
    if (s === 'finished') return 'Finished';
    return '';
  }

  function updateFocus() {
    if (!overlay) return;
    const ms = getTimeMs();
    const t = Utils.formatMs(ms);
    const timeEl = overlay.querySelector('#focus-time');
    const statusEl = overlay.querySelector('#focus-status');
    if (timeEl) {
      if (t.hours > 0) {
        timeEl.textContent = `${t.hours}:${t.minStr}:${t.secStr}`;
      } else {
        timeEl.textContent = `${t.minStr}:${t.secStr}`;
      }
    }
    if (statusEl) statusEl.textContent = getStatusText();
  }

  function startLoop() {
    if (rafId !== null) return;
    function tick() {
      if (!active) { rafId = null; return; }
      updateFocus();
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  return { enter, exit, isActive };
})();
