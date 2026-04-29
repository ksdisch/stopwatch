// ── Timer UI ──
let timerRafId = null;

function initTimerUI() {
  const setToggle = document.getElementById('timer-set-toggle');
  const setInput = document.getElementById('timer-set-input');
  const setBtn = document.getElementById('timer-set-btn');
  const cancelBtn = document.getElementById('timer-cancel-btn');

  setToggle.addEventListener('click', () => {
    setInput.removeAttribute('data-collapsed');
    setToggle.classList.add('hidden');
    document.getElementById('timer-minutes').focus();
  });

  cancelBtn.addEventListener('click', () => {
    setInput.setAttribute('data-collapsed', '');
    setToggle.classList.remove('hidden');
  });

  setBtn.addEventListener('click', () => {
    const h = Math.min(99, Math.max(0, parseInt(document.getElementById('timer-hours').value, 10) || 0));
    const m = Math.min(59, Math.max(0, parseInt(document.getElementById('timer-minutes').value, 10) || 0));
    const s = Math.min(59, Math.max(0, parseInt(document.getElementById('timer-seconds').value, 10) || 0));
    const ms = (h * 3600 + m * 60 + s) * 1000;
    if (ms > 0) {
      Timer.reset();
      Timer.setDuration(ms);
      saveTimerState();
      updateTimerUI();
    }
    setInput.setAttribute('data-collapsed', '');
    setToggle.classList.remove('hidden');
  });

  initTimerAlarm();

  // Wire buttons for timer mode
  document.getElementById('btn-left').addEventListener('click', onTimerLeft);
  document.getElementById('btn-right').addEventListener('click', onTimerRight);

  // If timer was running, restart render loop
  if (Timer.getStatus() === 'running' && appMode === 'timer') {
    startTimerRenderLoop();
  }
  if (Timer.getStatus() === 'finished' && appMode === 'timer') {
    updateTimerUI();
  }
}

function onTimerLeft() {
  if (appMode !== 'timer') return;
  if (sequenceMode) { onSequenceLeft(); return; }
  const status = Timer.getStatus();
  if (status === 'paused' || status === 'finished') {
    // Save session before reset
    const elapsed = Timer.getElapsedMs();
    if (elapsed > 1000) {
      History.addSession({ type: 'timer', duration: elapsed, laps: [] });
    }
    Timer.reset();
    BgNotify.cancel('timer-' + Timer.getId());
    saveTimerState();
    updateTimerUI();
  }
}

function onTimerRight() {
  if (appMode !== 'timer') return;
  if (sequenceMode) { onSequenceRight(); return; }
  const status = Timer.getStatus();
  if (status === 'running') {
    Timer.pause();
    BgNotify.cancel('timer-' + Timer.getId());
    saveTimerState();
    stopTimerRenderLoop();
    updateTimerUI();
  } else if (status === 'idle' || status === 'paused') {
    if (Timer.getDurationMs() === 0) return;
    Timer.start();
    BgNotify.schedule('timer-' + Timer.getId(), Timer.getRemainingMs(), 'Timer Complete', 'Your countdown has finished!');
    saveTimerState();
    SFX.playStart();
    startTimerRenderLoop();
    updateTimerUI();
  }
}

function updateTimerUI() {
  if (appMode !== 'timer') return;

  const status = Timer.getStatus();
  const remaining = Timer.getRemainingMs();
  const timeEl = document.getElementById('time');
  const btnLeft = document.getElementById('btn-left');
  const btnRight = document.getElementById('btn-right');
  const timerDisplay = document.getElementById('timer-display');
  const appEl = document.getElementById('app');
  const progressBar = document.getElementById('timer-progress');
  const progressFill = document.getElementById('timer-progress-fill');

  // Format remaining time
  const t = Utils.formatMs(remaining);
  if (t.hours > 0) {
    timeEl.innerHTML = `${t.hours}:${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`;
  } else {
    timeEl.innerHTML = `${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`;
  }

  // Progress bar
  if (status !== 'idle') {
    progressBar.classList.remove('hidden');
    progressFill.style.width = `${Timer.getProgress() * 100}%`;
  } else {
    progressBar.classList.add('hidden');
  }

  // Finished state
  if (status === 'finished') {
    timerDisplay.classList.add('timer-finished');
  } else {
    timerDisplay.classList.remove('timer-finished');
  }

  // Running indicator
  timerDisplay.classList.toggle('is-running', status === 'running');
  appEl.classList.toggle('is-running', status === 'running');

  // Timer set area visibility
  document.getElementById('timer-set-area').classList.toggle('hidden', status !== 'idle');

  // Buttons
  switch (status) {
    case 'idle':
      btnLeft.innerHTML = '<span class="btn-inner">--</span>';
      btnLeft.className = 'control-btn btn-lap';
      btnLeft.disabled = true;
      btnRight.innerHTML = '<span class="btn-inner">Start</span>';
      btnRight.className = 'control-btn btn-start';
      break;
    case 'running':
      btnLeft.innerHTML = '<span class="btn-inner">--</span>';
      btnLeft.className = 'control-btn btn-lap';
      btnLeft.disabled = true;
      btnRight.innerHTML = '<span class="btn-inner">Stop</span>';
      btnRight.className = 'control-btn btn-stop';
      break;
    case 'paused':
      btnLeft.innerHTML = '<span class="btn-inner">Reset</span>';
      btnLeft.className = 'control-btn btn-reset';
      btnLeft.disabled = false;
      btnRight.innerHTML = '<span class="btn-inner">Start</span>';
      btnRight.className = 'control-btn btn-start';
      break;
    case 'finished':
      btnLeft.innerHTML = '<span class="btn-inner">Reset</span>';
      btnLeft.className = 'control-btn btn-reset';
      btnLeft.disabled = false;
      btnRight.innerHTML = '<span class="btn-inner">Done</span>';
      btnRight.className = 'control-btn btn-start';
      break;
  }

  if (typeof updateTimeAdjustControls === 'function') updateTimeAdjustControls();
}

function startTimerRenderLoop() {
  if (timerRafId !== null) return;
  function tick() {
    if (Timer.getStatus() === 'running') {
      Timer.checkFinished();
      updateTimerUI();
      if (Timer.getStatus() === 'running') {
        timerRafId = requestAnimationFrame(tick);
      } else {
        timerRafId = null;
      }
    } else {
      timerRafId = null;
    }
  }
  timerRafId = requestAnimationFrame(tick);
}

function stopTimerRenderLoop() {
  if (timerRafId !== null) {
    cancelAnimationFrame(timerRafId);
    timerRafId = null;
  }
}

function saveTimerState() {
  Persistence.save();
}

function initTimerAlarm() {
  Timer.onAlarm(() => {
    SFX.playAlarm();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('Timer Complete', { body: 'Your countdown has finished!' });
    } else if (typeof Notification !== 'undefined' && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
    saveTimerState();
    updateTimerUI();
  });
}
