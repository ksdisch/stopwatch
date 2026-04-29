// ── Sequence UI (sub-mode of Timer) ──
let sequenceMode = false;
let sequenceRafId = null;
const SEQ_TEMPLATES_KEY = 'sequence_templates';
const SEQ_STATE_KEY = 'sequence_state';

function initSequenceUI() {
  const toggle = document.getElementById('seq-mode-toggle');
  if (!toggle) return;

  toggle.addEventListener('click', () => {
    sequenceMode = !sequenceMode;
    applySequenceMode();
  });

  // Phase complete callback
  Sequence.onPhaseComplete((phase) => {
    SFX.playPhaseChange();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    saveSequenceState();

    // Auto-advance to next
    Sequence.advancePhase();
    if (Sequence.getStatus() === 'done') {
      // Log to history
      const prog = Sequence.getProgram();
      const totalMs = prog.phases.reduce((s, p) => s + p.durationMs, 0);
      History.addSession({ type: 'sequence', duration: totalMs, laps: [] });
      SFX.playAlarm();
      stopSequenceRenderLoop();
      saveSequenceState();
      updateSequenceUI();
      return;
    }
    Sequence.start();
    saveSequenceState();
    updateSequenceUI();
  });

  // Template buttons
  document.getElementById('seq-tpl-warmup')?.addEventListener('click', () => {
    loadSeqTemplate([
      { name: 'Warm Up', durationMs: 5 * 60000 },
      { name: 'Work', durationMs: 25 * 60000 },
      { name: 'Cool Down', durationMs: 5 * 60000 },
    ], 'Warm Up + Work');
  });
  document.getElementById('seq-tpl-cooking')?.addEventListener('click', () => {
    loadSeqTemplate([
      { name: 'Sear', durationMs: 3 * 60000 },
      { name: 'Simmer', durationMs: 20 * 60000 },
      { name: 'Rest', durationMs: 5 * 60000 },
    ], 'Sear + Simmer + Rest');
  });
  document.getElementById('seq-tpl-custom')?.addEventListener('click', () => {
    loadSeqTemplate([], 'Custom');
  });

  // Add phase button
  document.getElementById('seq-add-phase')?.addEventListener('click', addSeqPhaseFromInput);

  // Restore state
  try {
    const saved = JSON.parse(localStorage.getItem(SEQ_STATE_KEY) || 'null');
    if (saved) Sequence.loadState(saved);
  } catch (e) {}

  // Wire keyboard shortcuts for sequence mode
  document.addEventListener('keydown', (e) => {
    if (appMode !== 'timer' || !sequenceMode) return;
    if (e.target.tagName === 'INPUT') return;
    const status = Sequence.getStatus();
    if (e.code === 'Space') {
      e.preventDefault();
      onSequenceRight();
    } else if (e.code === 'KeyR' && status === 'paused') {
      onSequenceLeft();
    }
  });
}

function applySequenceMode() {
  const toggle = document.getElementById('seq-mode-toggle');
  const singleArea = document.getElementById('timer-set-area');
  const seqArea = document.getElementById('sequence-area');

  if (sequenceMode) {
    toggle.textContent = 'Single Timer';
    singleArea?.classList.add('hidden');
    seqArea?.classList.remove('hidden');
    updateSequenceUI();
  } else {
    toggle.textContent = 'Sequence Mode';
    singleArea?.classList.remove('hidden');
    seqArea?.classList.add('hidden');
    stopSequenceRenderLoop();
  }
}

function loadSeqTemplate(phases, name) {
  Sequence.reset();
  Sequence.setProgram({ name, phases });
  renderSeqSetup();
  saveSequenceState();
}

function addSeqPhaseFromInput() {
  const nameInput = document.getElementById('seq-phase-name');
  const secInput = document.getElementById('seq-phase-sec');
  if (!nameInput || !secInput) return;
  const name = nameInput.value.trim() || 'Phase';
  const sec = Math.max(1, parseInt(secInput.value, 10) || 30);
  const prog = Sequence.getProgram();
  prog.phases.push({ name, durationMs: sec * 1000 });
  Sequence.setProgram(prog);
  nameInput.value = '';
  secInput.value = '30';
  renderSeqSetup();
  saveSequenceState();
}

function renderSeqSetup() {
  const listEl = document.getElementById('seq-phase-list');
  if (!listEl) return;
  const prog = Sequence.getProgram();
  if (prog.phases.length === 0) {
    listEl.innerHTML = '<div class="interval-empty">No phases added yet</div>';
    return;
  }
  listEl.innerHTML = prog.phases.map((p, i) => {
    const sec = Math.round(p.durationMs / 1000);
    const label = sec >= 60 ? `${Math.floor(sec / 60)}m ${sec % 60 ? sec % 60 + 's' : ''}` : `${sec}s`;
    return `<div class="interval-phase-row">
      <span class="interval-phase-name">${escapeHtml(p.name)}</span>
      <span class="interval-phase-dur">${label}</span>
      <button class="interval-phase-del" data-seq-del="${i}">&times;</button>
    </div>`;
  }).join('');

  listEl.querySelectorAll('[data-seq-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.seqDel, 10);
      const prog = Sequence.getProgram();
      prog.phases.splice(idx, 1);
      Sequence.setProgram(prog);
      renderSeqSetup();
      saveSequenceState();
    });
  });
}

function onSequenceLeft() {
  if (appMode !== 'timer' || !sequenceMode) return;
  const status = Sequence.getStatus();
  if (status === 'paused' || status === 'done') {
    Sequence.reset();
    stopSequenceRenderLoop();
    saveSequenceState();
    updateSequenceUI();
  }
}

function onSequenceRight() {
  if (appMode !== 'timer' || !sequenceMode) return;
  const status = Sequence.getStatus();
  if (status === 'running') {
    Sequence.pause();
    stopSequenceRenderLoop();
    SFX.playStop();
    saveSequenceState();
    updateSequenceUI();
  } else if (status === 'idle' || status === 'paused') {
    if (Sequence.getProgram().phases.length === 0) return;
    Sequence.start();
    SFX.playStart();
    startSequenceRenderLoop();
    saveSequenceState();
    updateSequenceUI();
  }
}

function updateSequenceUI() {
  if (appMode !== 'timer' || !sequenceMode) return;

  const status = Sequence.getStatus();
  const phase = Sequence.getCurrentPhase();
  const btnLeft = document.getElementById('btn-left');
  const btnRight = document.getElementById('btn-right');
  const timeEl = document.getElementById('time');
  const timerDisplay = document.getElementById('timer-display');
  const appEl = document.getElementById('app');
  const progressBar = document.getElementById('timer-progress');
  const progressFill = document.getElementById('timer-progress-fill');
  const seqInfo = document.getElementById('seq-run-info');
  const seqSetup = document.getElementById('seq-setup');

  // Show/hide setup vs. run info
  if (status === 'idle' && Sequence.getPhaseIndex() === 0) {
    seqSetup?.classList.remove('hidden');
    seqInfo?.classList.add('hidden');
    renderSeqSetup();
  } else {
    seqSetup?.classList.add('hidden');
    seqInfo?.classList.remove('hidden');
  }

  // Phase info
  const phaseLabel = document.getElementById('seq-current-phase');
  const nextLabel = document.getElementById('seq-next-phase');
  const countLabel = document.getElementById('seq-phase-count');
  if (phaseLabel) phaseLabel.textContent = phase ? phase.name : (status === 'done' ? 'Done!' : '');
  if (nextLabel) {
    const next = Sequence.getNextPhase();
    nextLabel.textContent = next ? `Next: ${next.name}` : '';
  }
  if (countLabel) countLabel.textContent = `${Sequence.getPhaseIndex() + 1}/${Sequence.getPhaseCount()}`;

  // Time display
  const remaining = Sequence.getRemainingMs();
  const t = Utils.formatMs(remaining);
  if (t.hours > 0) {
    timeEl.innerHTML = `${t.hours}:${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`;
  } else {
    timeEl.innerHTML = `${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`;
  }

  // Progress
  if (status !== 'idle' && status !== 'done') {
    progressBar.classList.remove('hidden');
    progressFill.style.width = `${Sequence.getProgress() * 100}%`;
  } else {
    progressBar.classList.add('hidden');
  }

  timerDisplay.classList.toggle('is-running', status === 'running');
  appEl.classList.toggle('is-running', status === 'running');

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
    case 'done':
      btnLeft.innerHTML = '<span class="btn-inner">Reset</span>';
      btnLeft.className = 'control-btn btn-reset';
      btnLeft.disabled = false;
      btnRight.innerHTML = '<span class="btn-inner">--</span>';
      btnRight.className = 'control-btn btn-lap';
      btnRight.disabled = true;
      break;
  }

  if (typeof updateTimeAdjustControls === 'function') updateTimeAdjustControls();
}

function startSequenceRenderLoop() {
  if (sequenceRafId !== null) return;
  function tick() {
    if (sequenceRafId === null) return;
    if (Sequence.getStatus() === 'running') {
      Sequence.checkFinished();
      updateSequenceUI();
      if (Sequence.getStatus() === 'running') {
        sequenceRafId = requestAnimationFrame(tick);
      } else {
        sequenceRafId = null;
      }
    } else {
      sequenceRafId = null;
    }
  }
  sequenceRafId = requestAnimationFrame(tick);
}

function stopSequenceRenderLoop() {
  if (sequenceRafId !== null) {
    cancelAnimationFrame(sequenceRafId);
    sequenceRafId = null;
  }
}

function saveSequenceState() {
  localStorage.setItem(SEQ_STATE_KEY, JSON.stringify(Sequence.getState()));
}

// Get saved templates
function getSeqTemplates() {
  try { return JSON.parse(localStorage.getItem(SEQ_TEMPLATES_KEY)) || []; }
  catch (e) { return []; }
}

function saveSeqTemplates(templates) {
  localStorage.setItem(SEQ_TEMPLATES_KEY, JSON.stringify(templates));
}
