// ── Focus / Ambient Display Mode ──
const FocusUI = (() => {
  let active = false;
  let rafId = null;
  let overlay = null;
  let lastTap = 0;

  function enter() {
    if (active) return;
    active = true;

    overlay = document.createElement('div');
    overlay.id = 'focus-overlay';
    overlay.className = 'focus-overlay';
    overlay.innerHTML = `
      <div class="focus-time" id="focus-time"></div>
      <div class="focus-status" id="focus-status"></div>
      <div class="focus-hint">Tap: pause/resume &middot; Double-tap: lap &middot; Swipe down: exit</div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('focus-visible'));

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

    // Escape key
    document.addEventListener('keydown', onEscape);

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

    document.removeEventListener('keydown', onEscape);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange);

    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.webkitFullscreenElement) document.webkitExitFullscreen();
    } catch (e) { /* ignore */ }
  }

  function isActive() { return active; }

  function handleTap() {
    const now = Date.now();
    if (now - lastTap < 300) {
      // Double tap → lap (stopwatch only)
      lastTap = 0;
      if (appMode === 'stopwatch' && Stopwatch.getStatus() === 'running') {
        Stopwatch.lap();
        Persistence.save();
        SFX.playLap();
      }
      return;
    }
    lastTap = now;
    setTimeout(() => {
      if (lastTap === 0) return; // was double tap
      // Single tap → pause/resume
      if (appMode === 'stopwatch') {
        if (Stopwatch.getStatus() === 'running') {
          Stopwatch.pause();
          SFX.playStop();
        } else {
          Stopwatch.start();
          SFX.playStart();
        }
        Persistence.save();
      } else if (appMode === 'timer') {
        if (Timer.getStatus() === 'running') {
          Timer.pause();
          SFX.playStop();
        } else if (Timer.getStatus() === 'paused' || Timer.getStatus() === 'idle') {
          Timer.start();
          SFX.playStart();
        }
      } else if (appMode === 'pomodoro') {
        if (Pomodoro.getStatus() === 'running') {
          Pomodoro.pause();
          SFX.playStop();
        } else if (Pomodoro.getStatus() === 'idle' || Pomodoro.getStatus() === 'paused') {
          Pomodoro.start();
          SFX.playStart();
        }
      }
      updateFocus();
    }, 300);
  }

  function onEscape(e) {
    if (e.key === 'Escape') exit();
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
