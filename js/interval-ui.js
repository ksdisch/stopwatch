// ── Interval UI ──
let intervalRafId = null;

function initIntervalUI() {
  // Restore state
  try {
    const saved = JSON.parse(localStorage.getItem('interval_state') || 'null');
    if (saved) Interval.loadState(saved);
  } catch (e) {
    localStorage.removeItem('interval_state');
  }

  // Phase complete callback
  Interval.onPhaseComplete((type) => {
    if (type === 'done') {
      SFX.playAlarm();
      if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('Interval Complete', { body: 'Workout finished!' });
      }
    } else {
      SFX.playPhaseChange();
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    }
    saveIntervalState();
    // Auto-advance on phase complete (start next phase immediately)
    if (type === 'phase' || type === 'rest' || type === 'roundEnd') {
      Interval.advancePhase();
      Interval.start();
      BgNotify.schedule('interval', Interval.getRemainingMs(), 'Interval', 'Phase complete!');
      saveIntervalState();
      startIntervalRenderLoop();
    }
    updateIntervalUI();
  });

  // Wire buttons
  document.getElementById('btn-left').addEventListener('click', onIntervalLeft);
  document.getElementById('btn-right').addEventListener('click', onIntervalRight);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (appMode !== 'interval') return;
    if (e.target.tagName === 'INPUT') return;
    const status = Interval.getStatus();
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (status === 'running' || status === 'idle' || status === 'paused') onIntervalRight();
        break;
      case 'KeyR':
        if (status === 'paused') onIntervalLeft();
        break;
    }
  });

  // Template buttons
  document.getElementById('interval-tpl-tabata')?.addEventListener('click', () => {
    loadTemplate('tabata');
  });
  document.getElementById('interval-tpl-hiit')?.addEventListener('click', () => {
    loadTemplate('hiit');
  });
  document.getElementById('interval-tpl-custom')?.addEventListener('click', () => {
    loadTemplate('custom');
  });

  // Add phase button
  document.getElementById('interval-add-phase')?.addEventListener('click', addPhaseFromInput);
  document.getElementById('interval-phase-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addPhaseFromInput(); }
  });
  document.getElementById('interval-phase-sec')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addPhaseFromInput(); }
  });

  // Rounds input
  document.getElementById('interval-rounds')?.addEventListener('change', () => {
    updateProgramFromUI();
  });
  document.getElementById('interval-rest-sec')?.addEventListener('change', () => {
    updateProgramFromUI();
  });

  // Restore render loop if running or overflowing (terminal phase past zero)
  const initSt = Interval.getStatus();
  if ((initSt === 'running' || initSt === 'overflowing') && appMode === 'interval') {
    startIntervalRenderLoop();
  }

  updateIntervalUI();
}

function loadTemplate(type) {
  if (Interval.getStatus() !== 'idle') return;
  let program;
  switch (type) {
    case 'tabata':
      program = {
        name: 'Tabata',
        rounds: 8,
        restBetweenRoundsMs: 0,
        phases: [
          { name: 'Work', durationMs: 20000, color: '#30d158' },
          { name: 'Rest', durationMs: 10000, color: '#ff9f0a' },
        ],
      };
      break;
    case 'hiit':
      program = {
        name: 'HIIT 30/30',
        rounds: 10,
        restBetweenRoundsMs: 0,
        phases: [
          { name: 'Work', durationMs: 30000, color: '#30d158' },
          { name: 'Rest', durationMs: 30000, color: '#ff9f0a' },
        ],
      };
      break;
    default:
      program = { name: 'Custom', rounds: 1, restBetweenRoundsMs: 0, phases: [] };
  }
  Interval.setProgram(program);
  saveIntervalState();
  updateIntervalUI();
  renderSetupPhases();
  syncSetupInputs();
}

function addPhaseFromInput() {
  if (Interval.getStatus() !== 'idle') return;
  const nameEl = document.getElementById('interval-phase-name');
  const secEl = document.getElementById('interval-phase-sec');
  const name = (nameEl.value.trim() || 'Phase');
  const sec = Math.max(1, parseInt(secEl.value, 10) || 30);

  const prog = Interval.getProgram();
  prog.phases.push({ name, durationMs: sec * 1000 });
  Interval.setProgram(prog);
  saveIntervalState();
  nameEl.value = '';
  secEl.value = '30';
  renderSetupPhases();
  nameEl.focus();
}

function updateProgramFromUI() {
  if (Interval.getStatus() !== 'idle') return;
  const rounds = Math.max(1, parseInt(document.getElementById('interval-rounds')?.value, 10) || 1);
  const restSec = Math.max(0, parseInt(document.getElementById('interval-rest-sec')?.value, 10) || 0);
  const prog = Interval.getProgram();
  prog.rounds = rounds;
  prog.restBetweenRoundsMs = restSec * 1000;
  Interval.setProgram(prog);
  saveIntervalState();
}

function renderSetupPhases() {
  const listEl = document.getElementById('interval-phase-list');
  if (!listEl) return;
  const prog = Interval.getProgram();

  if (prog.phases.length === 0) {
    listEl.innerHTML = '<div class="interval-empty">No phases added yet</div>';
    return;
  }

  listEl.innerHTML = prog.phases.map((ph, i) => {
    const sec = Math.round(ph.durationMs / 1000);
    return `<div class="interval-phase-row">
      <span class="interval-phase-color" style="background:${ph.color || 'var(--green)'}"></span>
      <span class="interval-phase-label">${escapeHtml(ph.name)}</span>
      <span class="interval-phase-dur">${sec}s</span>
      <button class="interval-phase-del" data-phase-idx="${i}">&times;</button>
    </div>`;
  }).join('');

  listEl.querySelectorAll('.interval-phase-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.phaseIdx, 10);
      const prog = Interval.getProgram();
      prog.phases.splice(idx, 1);
      Interval.setProgram(prog);
      saveIntervalState();
      renderSetupPhases();
    });
  });
}

function syncSetupInputs() {
  const prog = Interval.getProgram();
  const roundsEl = document.getElementById('interval-rounds');
  const restEl = document.getElementById('interval-rest-sec');
  if (roundsEl) roundsEl.value = prog.rounds;
  if (restEl) restEl.value = Math.round(prog.restBetweenRoundsMs / 1000);
}

function onIntervalLeft() {
  if (appMode !== 'interval') return;
  const status = Interval.getStatus();
  if (status === 'paused' || status === 'overflowing') {
    const elapsed = Interval.getElapsedMs();
    const overshootMs = Interval.getOvershootMs ? Interval.getOvershootMs() : 0;
    if (elapsed > 1000 || overshootMs > 0) {
      const prog = Interval.getProgram();
      // For overflowing (terminal) reset, capture the full program total so
      // the duration field reflects what the user actually completed.
      const duration = status === 'overflowing'
        ? prog.phases.reduce((s, p) => s + p.durationMs, 0) * (prog.rounds || 1)
        : elapsed;
      History.addSession({
        type: 'interval',
        duration,
        laps: [],
        programName: prog.name,
        overshootMs,
      });
    }
    Interval.reset();
    BgNotify.cancel('interval');
    saveIntervalState();
    SFX.playReset();
    stopIntervalRenderLoop();
    updateIntervalUI();
    renderSetupPhases();
    syncSetupInputs();
  }
}

function onIntervalRight() {
  if (appMode !== 'interval') return;
  const status = Interval.getStatus();
  if (status === 'running') {
    stopIntervalRenderLoop();
    Interval.pause();
    BgNotify.cancel('interval');
    saveIntervalState();
    SFX.playStop();
    updateIntervalUI();
  } else if (status === 'idle' || status === 'paused') {
    if (Interval.getTotalPhases() === 0) return;
    Interval.start();
    BgNotify.schedule('interval', Interval.getRemainingMs(), 'Interval', 'Phase complete!');
    saveIntervalState();
    SFX.playStart();
    startIntervalRenderLoop();
    updateIntervalUI();
  } else if (status === 'overflowing') {
    // Terminal overflow — Reset/Done. Capture overshoot into history then
    // reset. (Same path as paused, but with the program-total duration.)
    const prog = Interval.getProgram();
    const totalMs = prog.phases.reduce((s, p) => s + p.durationMs, 0) * (prog.rounds || 1);
    const overshootMs = Interval.getOvershootMs ? Interval.getOvershootMs() : 0;
    History.addSession({
      type: 'interval',
      duration: totalMs,
      laps: [],
      programName: prog.name,
      overshootMs,
    });
    Interval.reset();
    BgNotify.cancel('interval');
    saveIntervalState();
    stopIntervalRenderLoop();
    updateIntervalUI();
    renderSetupPhases();
    syncSetupInputs();
  }
}

function updateIntervalUI() {
  if (appMode !== 'interval') return;

  const status = Interval.getStatus();
  const isOver = status === 'overflowing';
  const overshootMs = isOver && Interval.getOvershootMs ? Interval.getOvershootMs() : 0;
  const remaining = Interval.getRemainingMs();
  const timeEl = document.getElementById('time');
  const btnLeft = document.getElementById('btn-left');
  const btnRight = document.getElementById('btn-right');
  const timerDisplay = document.getElementById('timer-display');
  const appEl = document.getElementById('app');
  const progressBar = document.getElementById('timer-progress');
  const progressFill = document.getElementById('timer-progress-fill');
  const setupArea = document.getElementById('interval-setup');
  const runArea = document.getElementById('interval-run-info');

  // Show/hide setup vs running info
  const isActive = status !== 'idle';
  if (setupArea) setupArea.classList.toggle('hidden', isActive);
  if (runArea) runArea.classList.toggle('hidden', !isActive);

  // Current phase info
  if (isActive && runArea) {
    const phase = Interval.getCurrentPhase();
    const next = Interval.getNextPhase();
    const phaseLabel = document.getElementById('interval-current-phase');
    const nextLabel = document.getElementById('interval-next-phase');
    const roundLabel = document.getElementById('interval-round-label');

    if (phaseLabel && phase) {
      phaseLabel.textContent = phase.name;
      phaseLabel.style.color = phase.color || 'var(--green)';
    }
    if (nextLabel) {
      nextLabel.textContent = next ? `Next: ${next.name}` : 'Last phase';
    }
    if (roundLabel) {
      roundLabel.textContent = `Round ${Interval.getRoundIndex() + 1}/${Interval.getTotalRounds()}`;
    }
  }

  // Time display: standard during running phases, "+M:SS.cc" during overflow.
  if (isOver) {
    const t = Utils.formatMs(overshootMs);
    if (t.hours > 0) {
      timeEl.innerHTML = `+${t.hours}:${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`;
    } else {
      timeEl.innerHTML = `+${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`;
    }
  } else {
    const t = Utils.formatMs(remaining);
    if (t.hours > 0) {
      timeEl.innerHTML = `${t.hours}:${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`;
    } else {
      timeEl.innerHTML = `${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`;
    }
  }

  // Progress bar (full when overflowing)
  if (isActive && !isOver) {
    progressBar.classList.remove('hidden');
    progressFill.style.width = `${Interval.getProgress() * 100}%`;
  } else if (isOver) {
    progressBar.classList.remove('hidden');
    progressFill.style.width = '100%';
  } else {
    progressBar.classList.add('hidden');
  }

  // Running indicator
  timerDisplay.classList.toggle('is-running', status === 'running');
  appEl.classList.toggle('is-running', status === 'running');
  timerDisplay.classList.remove('pomodoro-break');
  // Overflow visual: brief flash via timer-finished, then steady amber.
  timerDisplay.classList.toggle('timer-finished', isOver && overshootMs <= 3000);
  timerDisplay.classList.toggle('overshoot', isOver && overshootMs > 1000);
  timerDisplay.classList.toggle('pomodoro-phase-complete', isOver && overshootMs <= 3000);

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
      btnRight.innerHTML = '<span class="btn-inner">Pause</span>';
      btnRight.className = 'control-btn btn-stop';
      break;
    case 'paused':
      btnLeft.innerHTML = '<span class="btn-inner">Reset</span>';
      btnLeft.className = 'control-btn btn-reset';
      btnLeft.disabled = false;
      btnRight.innerHTML = '<span class="btn-inner">Resume</span>';
      btnRight.className = 'control-btn btn-start';
      break;
    case 'overflowing': {
      const short = Utils.formatShort && overshootMs > 0 ? ` +${Utils.formatShort(overshootMs)}` : '';
      btnLeft.innerHTML = '<span class="btn-inner">--</span>';
      btnLeft.className = 'control-btn btn-lap';
      btnLeft.disabled = true;
      btnRight.innerHTML = `<span class="btn-inner">Reset${short}</span>`;
      btnRight.className = 'control-btn btn-start';
      break;
    }
  }

  if (typeof updateTimeAdjustControls === 'function') updateTimeAdjustControls();
}

function startIntervalRenderLoop() {
  if (intervalRafId !== null) return;
  function tick() {
    if (intervalRafId === null) return;
    const st = Interval.getStatus();
    if (st === 'running' || st === 'overflowing') {
      Interval.checkFinished();
      updateIntervalUI();
      const after = Interval.getStatus();
      if (after === 'running' || after === 'overflowing') {
        intervalRafId = requestAnimationFrame(tick);
      } else {
        intervalRafId = null;
      }
    } else {
      intervalRafId = null;
    }
  }
  intervalRafId = requestAnimationFrame(tick);
}

function stopIntervalRenderLoop() {
  if (intervalRafId !== null) {
    cancelAnimationFrame(intervalRafId);
    intervalRafId = null;
  }
}

function saveIntervalState() {
  localStorage.setItem('interval_state', JSON.stringify(Interval.getState()));
}
