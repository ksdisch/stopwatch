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

  // If timer was running or already overflowing, restart render loop.
  if ((Timer.getStatus() === 'running' || Timer.getStatus() === 'overflowing')
      && appMode === 'timer') {
    startTimerRenderLoop();
  }
  if ((Timer.getStatus() === 'finished' || Timer.getStatus() === 'overflowing')
      && appMode === 'timer') {
    updateTimerUI();
  }
}

function onTimerLeft() {
  if (appMode !== 'timer') return;
  if (sequenceMode) { onSequenceLeft(); return; }
  const status = Timer.getStatus();
  if (status === 'paused' || status === 'finished' || status === 'overflowing') {
    // Save session before reset. Read overshoot BEFORE reset() clears it.
    const elapsed = Timer.getElapsedMs();
    const overshootMs = Timer.getOvershootMs ? Timer.getOvershootMs() : 0;
    if (elapsed > 1000 || overshootMs > 0) {
      History.addSession({
        type: 'timer',
        duration: elapsed,
        laps: [],
        overshootMs,
      });
    }
    Timer.reset();
    BgNotify.cancel('timer-' + Timer.getId());
    saveTimerState();
    stopTimerRenderLoop();
    updateTimerUI();
  }
}

function onTimerRight() {
  if (appMode !== 'timer') return;
  if (sequenceMode) { onSequenceRight(); return; }
  const status = Timer.getStatus();
  if (status === 'running' || status === 'overflowing') {
    // 'overflowing' right-button is "Done" — same effect as the legacy
    // 'finished' Done: capture and reset.
    if (status === 'overflowing') { onTimerLeft(); return; }
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

// B4: cheap per-frame painter (time + progress + overshoot flash). The buttons,
// is-running class, and set-area visibility change only on a status transition,
// so the RAF loop calls this on non-transition frames and the full
// updateTimerUI() only when the status flips. updateTimerUI() delegates these
// bits here so they can't drift.
function paintTimerFrame() {
  if (appMode !== 'timer') return;
  const status = Timer.getStatus();
  const isOver = status === 'overflowing';
  const overshootMs = isOver ? Timer.getOvershootMs() : 0;
  const timeEl = document.getElementById('time');
  const progressBar = document.getElementById('timer-progress');
  const progressFill = document.getElementById('timer-progress-fill');
  const timerDisplay = document.getElementById('timer-display');
  if (!timeEl) return;

  if (isOver) {
    const t = Utils.formatMs(overshootMs);
    timeEl.innerHTML = (t.hours > 0)
      ? `+${t.hours}:${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`
      : `+${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`;
  } else {
    const t = Utils.formatMs(Timer.getRemainingMs());
    timeEl.innerHTML = (t.hours > 0)
      ? `${t.hours}:${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`
      : `${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`;
  }

  if (progressBar && progressFill) {
    if (status !== 'idle') {
      progressBar.classList.remove('hidden');
      progressFill.style.width = `${Timer.getProgress() * 100}%`;
    } else {
      progressBar.classList.add('hidden');
    }
  }

  if (timerDisplay) {
    timerDisplay.classList.toggle('timer-finished', status === 'finished' || (isOver && overshootMs <= 3000));
    timerDisplay.classList.toggle('overshoot', isOver && overshootMs > 1000);
  }
}

function updateTimerUI() {
  if (appMode !== 'timer') return;

  const status = Timer.getStatus();
  const isOver = status === 'overflowing';
  const timeEl = document.getElementById('time');
  const btnLeft = document.getElementById('btn-left');
  const btnRight = document.getElementById('btn-right');
  const timerDisplay = document.getElementById('timer-display');
  const appEl = document.getElementById('app');
  const progressBar = document.getElementById('timer-progress');
  const progressFill = document.getElementById('timer-progress-fill');

  // Time + progress + overshoot flash — the per-frame bits, shared with the RAF
  // loop's non-transition path so they can't drift (B4).
  paintTimerFrame();

  // overshoot magnitude for the overflow button suffix below.
  const overshootMs = isOver ? Timer.getOvershootMs() : 0;

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
    case 'overflowing': {
      const short = Utils.formatShort ? Utils.formatShort(overshootMs) : '';
      const suffix = short ? ` +${short}` : '';
      btnLeft.innerHTML = '<span class="btn-inner">Reset</span>';
      btnLeft.className = 'control-btn btn-reset';
      btnLeft.disabled = false;
      btnRight.innerHTML = `<span class="btn-inner">Done${suffix}</span>`;
      btnRight.className = 'control-btn btn-start';
      break;
    }
  }

  if (typeof updateTimeAdjustControls === 'function') updateTimeAdjustControls();
}

function startTimerRenderLoop() {
  if (timerRafId !== null) return;
  function tick() {
    const st = Timer.getStatus();
    if (st === 'running' || st === 'overflowing') {
      Timer.checkFinished();
      const after = Timer.getStatus();
      // B4: full structural update only on a status change (e.g. running →
      // overflowing/finished); otherwise the cheap per-frame painter.
      if (after !== st) updateTimerUI();
      else paintTimerFrame();
      if (after === 'running' || after === 'overflowing') {
        timerRafId = requestAnimationFrame(tick);
      } else {
        timerRafId = null;
        updateTimerUI(); // settle final structural state (e.g. → finished)
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
    Platform.haptic([200, 100, 200, 100, 200]);
    Platform.notify('Timer Complete', { body: 'Your countdown has finished!' });
    saveTimerState();
    updateTimerUI();
  });
}
