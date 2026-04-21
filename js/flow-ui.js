// ── Flow Block UI ──
let flowRafId = null;

const FLOW_DISTRACTION_KEY = 'flow_distractions';
const FLOW_BFRB_KEY = 'flow_bfrbs';
const FLOW_CHECKLIST_STATE_KEY = 'flow_checklist_state';
const FLOW_CHECKLIST_SKIPPED_KEY = 'flow_checklist_skipped';

// Fixed pre-block checklist items. Index order must be stable — local state
// arrays are indexed by position.
const FLOW_CHECKLIST_ITEMS = [
  'Phone on Do Not Disturb',
  'Notifications silenced',
  'Tabs/apps closed',
  'Water nearby',
  'Clear goal for this block',
];

function loadFlowDistractions() {
  try { return JSON.parse(localStorage.getItem(FLOW_DISTRACTION_KEY)) || []; }
  catch (e) { return []; }
}

function saveFlowDistractions(items) {
  localStorage.setItem(FLOW_DISTRACTION_KEY, JSON.stringify(items));
}

function loadFlowBFRBs() {
  try { return JSON.parse(localStorage.getItem(FLOW_BFRB_KEY)) || []; }
  catch (e) { return []; }
}

function saveFlowBFRBs(items) {
  localStorage.setItem(FLOW_BFRB_KEY, JSON.stringify(items));
}

function loadFlowChecklistState() {
  try {
    const raw = JSON.parse(localStorage.getItem(FLOW_CHECKLIST_STATE_KEY));
    if (Array.isArray(raw) && raw.length === FLOW_CHECKLIST_ITEMS.length) return raw;
  } catch (e) {}
  return FLOW_CHECKLIST_ITEMS.map(() => false);
}

function saveFlowChecklistState(state) {
  localStorage.setItem(FLOW_CHECKLIST_STATE_KEY, JSON.stringify(state));
}

function resetFlowChecklistState() {
  localStorage.removeItem(FLOW_CHECKLIST_STATE_KEY);
  localStorage.removeItem(FLOW_CHECKLIST_SKIPPED_KEY);
  localStorage.removeItem('flow_last_saved_session');
}

function isFlowChecklistSkipped() {
  return localStorage.getItem(FLOW_CHECKLIST_SKIPPED_KEY) === '1';
}

function setFlowChecklistSkipped(skipped) {
  if (skipped) localStorage.setItem(FLOW_CHECKLIST_SKIPPED_KEY, '1');
  else localStorage.removeItem(FLOW_CHECKLIST_SKIPPED_KEY);
}

function initFlowUI() {
  // Phase complete callback
  Flow.onPhaseComplete((completedPhase) => {
    SFX.playAlarm();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const label = completedPhase === 'focus'
        ? 'Focus block complete! Time for recovery.'
        : 'Recovery complete.';
      new Notification('Flow Block', { body: label });
    } else if (typeof Notification !== 'undefined' && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }

    // Save the focus block to history as soon as focus completes
    if (completedPhase === 'focus') {
      saveFlowSessionToHistory();
    }

    saveFlowState();
    updateFlowUI();
  });

  // Wire buttons (shared btn-left / btn-right — guarded by appMode check)
  document.getElementById('btn-left').addEventListener('click', onFlowLeft);
  document.getElementById('btn-right').addEventListener('click', onFlowRight);

  // Duration toggle
  document.querySelectorAll('.flow-dur-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (Flow.getStatus() !== 'idle') return;
      const minutes = parseInt(btn.dataset.flowDur, 10);
      Flow.configure({ focusDurationMs: minutes * 60000 });
      saveFlowConfig();
      updateFlowUI();
    });
  });

  // Goal input
  const goalInput = document.getElementById('flow-goal-input');
  if (goalInput) {
    goalInput.addEventListener('input', () => {
      Flow.setGoal(goalInput.value);
      saveFlowState();
      updateFlowChecklistGate();
    });
  }

  // Pre-block checklist
  renderFlowChecklist();
  document.getElementById('flow-skip-checklist').addEventListener('click', () => {
    setFlowChecklistSkipped(true);
    updateFlowChecklistGate();
  });

  // Distraction log
  initFlowDistractionLog();

  // BFRB tally
  initFlowBFRBLog();

  // Summary card buttons
  document.getElementById('flow-start-recovery').addEventListener('click', () => {
    if (Flow.getStatus() !== 'focusComplete') return;
    Flow.startRecovery();
    saveFlowState();
    SFX.playStart();
    BgNotify.schedule('flow', Flow.getRemainingMs(), 'Flow Block', 'Recovery complete.');
    startFlowRenderLoop();
    updateFlowUI();
  });
  document.getElementById('flow-skip-recovery').addEventListener('click', () => {
    if (Flow.getStatus() !== 'focusComplete'
        && Flow.getStatus() !== 'recovery'
        && Flow.getStatus() !== 'recoveryPaused') return;
    BgNotify.cancel('flow');
    stopFlowRenderLoop();
    Flow.skipRecovery();
    Flow.reset();
    resetFlowChecklistState();
    saveFlowDistractions([]);
    saveFlowBFRBs([]);
    saveFlowState();
    updateFlowUI();
  });

  // Keyboard shortcuts (Space for primary action)
  document.addEventListener('keydown', (e) => {
    if (appMode !== 'flow') return;
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') {
      e.preventDefault();
      onFlowRight();
    } else if (e.code === 'KeyR') {
      const status = Flow.getStatus();
      if (status === 'paused' || status === 'recoveryPaused') onFlowLeft();
    }
  });

  // If the block completed while the tab was closed, persist it now so we
  // don't lose the session (the onPhaseComplete callback only fires from the
  // render loop, not from loadState recovery).
  if (Flow.getStatus() === 'focusComplete') {
    saveFlowSessionToHistory();
  }

  // Restore render loop if needed
  const st = Flow.getStatus();
  if ((st === 'running' || st === 'recovery') && appMode === 'flow') {
    startFlowRenderLoop();
  }
  if (appMode === 'flow') updateFlowUI();
}

function onFlowLeft() {
  if (appMode !== 'flow') return;
  const status = Flow.getStatus();
  if (status === 'paused' || status === 'recoveryPaused') {
    // Reset — abandon session (do NOT save, since an in-progress block
    // never "completed" its focus phase)
    stopFlowRenderLoop();
    BgNotify.cancel('flow');
    Flow.reset();
    resetFlowChecklistState();
    saveFlowDistractions([]);
    saveFlowBFRBs([]);
    saveFlowState();
    SFX.playReset();
    updateFlowUI();
  }
}

function onFlowRight() {
  if (appMode !== 'flow') return;
  const status = Flow.getStatus();

  if (status === 'idle') {
    if (!canStartFlow()) return;
    // Start focus block
    const goalInput = document.getElementById('flow-goal-input');
    if (goalInput) Flow.setGoal(goalInput.value);
    saveFlowDistractions([]);  // clear any stale entries
    saveFlowBFRBs([]);
    Flow.start();
    BgNotify.schedule('flow', Flow.getRemainingMs(), 'Flow Block', 'Focus block complete! Time for recovery.');
    saveFlowState();
    SFX.playStart();
    startFlowRenderLoop();
    updateFlowUI();
  } else if (status === 'running') {
    stopFlowRenderLoop();
    Flow.pause();
    BgNotify.cancel('flow');
    saveFlowState();
    SFX.playStop();
    updateFlowUI();
  } else if (status === 'paused') {
    Flow.resume();
    BgNotify.schedule('flow', Flow.getRemainingMs(), 'Flow Block', 'Focus block complete! Time for recovery.');
    saveFlowState();
    SFX.playStart();
    startFlowRenderLoop();
    updateFlowUI();
  } else if (status === 'recovery') {
    stopFlowRenderLoop();
    Flow.pause();
    BgNotify.cancel('flow');
    saveFlowState();
    SFX.playStop();
    updateFlowUI();
  } else if (status === 'recoveryPaused') {
    Flow.resume();
    BgNotify.schedule('flow', Flow.getRemainingMs(), 'Flow Block', 'Recovery complete.');
    saveFlowState();
    SFX.playStart();
    startFlowRenderLoop();
    updateFlowUI();
  } else if (status === 'done') {
    Flow.reset();
    resetFlowChecklistState();
    saveFlowDistractions([]);
    saveFlowBFRBs([]);
    saveFlowState();
    updateFlowUI();
  }
}

function canStartFlow() {
  if (isFlowChecklistSkipped()) return true;
  const state = loadFlowChecklistState();
  return state.every(Boolean);
}

function updateFlowUI() {
  if (appMode !== 'flow') return;

  const status = Flow.getStatus();
  const phase = Flow.getPhase();
  const timeEl = document.getElementById('time');
  const btnLeft = document.getElementById('btn-left');
  const btnRight = document.getElementById('btn-right');
  const timerDisplay = document.getElementById('timer-display');
  const appEl = document.getElementById('app');
  const progressBar = document.getElementById('timer-progress');
  const progressFill = document.getElementById('timer-progress-fill');

  const setupEl = document.getElementById('flow-setup');
  const runningEl = document.getElementById('flow-running');
  const summaryEl = document.getElementById('flow-summary');
  const recoveryEl = document.getElementById('flow-recovery');

  // Section visibility
  const isIdle = status === 'idle';
  const isFocusActive = status === 'running' || status === 'paused';
  const isFocusComplete = status === 'focusComplete';
  const isRecoveryActive = status === 'recovery' || status === 'recoveryPaused';
  const isDone = status === 'done';

  setupEl.classList.toggle('hidden', !isIdle);
  runningEl.classList.toggle('hidden', !isFocusActive);
  summaryEl.classList.toggle('hidden', !isFocusComplete);
  recoveryEl.classList.toggle('hidden', !isRecoveryActive);

  // Sync setup UI to current config/goal
  if (isIdle) {
    const dur = Flow.getFocusDurationMs();
    document.querySelectorAll('.flow-dur-btn').forEach(b => {
      const m = parseInt(b.dataset.flowDur, 10);
      b.classList.toggle('flow-dur-active', m * 60000 === dur);
    });
    const goalInput = document.getElementById('flow-goal-input');
    if (goalInput && document.activeElement !== goalInput) {
      goalInput.value = Flow.getGoal();
    }
    renderFlowChecklist();
    updateFlowChecklistGate();
  }

  // Running phase label + goal display
  if (isFocusActive) {
    document.getElementById('flow-phase-text').textContent = 'Focus';
    const goalDisplay = document.getElementById('flow-goal-display');
    goalDisplay.textContent = Flow.getGoal() || '';
    updateFlowDistractionBtnVisibility();
    updateFlowBFRBBtnVisibility();
  }

  // Format remaining time
  let remaining;
  if (isFocusComplete) {
    remaining = 0;
  } else if (isDone) {
    remaining = 0;
  } else {
    remaining = Flow.getRemainingMs();
  }
  const t = Utils.formatMs(remaining);
  if (t.hours > 0) {
    timeEl.innerHTML = `${t.hours}:${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`;
  } else {
    timeEl.innerHTML = `${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`;
  }

  // Progress bar
  if (isFocusActive || isRecoveryActive) {
    progressBar.classList.remove('hidden');
    progressFill.style.width = `${Flow.getProgress() * 100}%`;
  } else {
    progressBar.classList.add('hidden');
  }

  // Visual states
  timerDisplay.classList.toggle('pomodoro-break', isRecoveryActive);
  timerDisplay.classList.toggle('pomodoro-phase-complete', isFocusComplete);
  timerDisplay.classList.remove('timer-finished');
  timerDisplay.classList.toggle('is-running', status === 'running' || status === 'recovery');
  appEl.classList.toggle('is-running', status === 'running' || status === 'recovery');

  // Render summary content when shown
  if (isFocusComplete) renderFlowSummary();

  // Button states
  switch (status) {
    case 'idle': {
      btnLeft.innerHTML = '<span class="btn-inner">--</span>';
      btnLeft.className = 'control-btn btn-lap';
      btnLeft.disabled = true;
      btnRight.innerHTML = '<span class="btn-inner">Start</span>';
      btnRight.className = 'control-btn btn-start';
      btnRight.disabled = !canStartFlow();
      break;
    }
    case 'running':
      btnLeft.innerHTML = '<span class="btn-inner">--</span>';
      btnLeft.className = 'control-btn btn-lap';
      btnLeft.disabled = true;
      btnRight.innerHTML = '<span class="btn-inner">Pause</span>';
      btnRight.className = 'control-btn btn-stop';
      btnRight.disabled = false;
      break;
    case 'paused':
      btnLeft.innerHTML = '<span class="btn-inner">Reset</span>';
      btnLeft.className = 'control-btn btn-reset';
      btnLeft.disabled = false;
      btnRight.innerHTML = '<span class="btn-inner">Resume</span>';
      btnRight.className = 'control-btn btn-start';
      btnRight.disabled = false;
      break;
    case 'focusComplete':
      btnLeft.innerHTML = '<span class="btn-inner">--</span>';
      btnLeft.className = 'control-btn btn-lap';
      btnLeft.disabled = true;
      btnRight.innerHTML = '<span class="btn-inner">--</span>';
      btnRight.className = 'control-btn btn-start';
      btnRight.disabled = true;
      break;
    case 'recovery':
      btnLeft.innerHTML = '<span class="btn-inner">--</span>';
      btnLeft.className = 'control-btn btn-lap';
      btnLeft.disabled = true;
      btnRight.innerHTML = '<span class="btn-inner">Pause</span>';
      btnRight.className = 'control-btn btn-stop';
      btnRight.disabled = false;
      break;
    case 'recoveryPaused':
      btnLeft.innerHTML = '<span class="btn-inner">Reset</span>';
      btnLeft.className = 'control-btn btn-reset';
      btnLeft.disabled = false;
      btnRight.innerHTML = '<span class="btn-inner">Resume</span>';
      btnRight.className = 'control-btn btn-start';
      btnRight.disabled = false;
      break;
    case 'done':
      btnLeft.innerHTML = '<span class="btn-inner">--</span>';
      btnLeft.className = 'control-btn btn-lap';
      btnLeft.disabled = true;
      btnRight.innerHTML = '<span class="btn-inner">Reset</span>';
      btnRight.className = 'control-btn btn-start';
      btnRight.disabled = false;
      break;
  }
}

function renderFlowChecklist() {
  const container = document.getElementById('flow-checklist-items');
  if (!container) return;
  const state = loadFlowChecklistState();

  container.innerHTML = FLOW_CHECKLIST_ITEMS.map((text, i) =>
    `<label class="flow-check-row">
      <input type="checkbox" data-flow-check="${i}" ${state[i] ? 'checked' : ''}>
      <span>${escapeHtml(text)}</span>
    </label>`
  ).join('');

  container.querySelectorAll('input[data-flow-check]').forEach(cb => {
    cb.addEventListener('change', () => {
      const idx = parseInt(cb.dataset.flowCheck, 10);
      const cur = loadFlowChecklistState();
      cur[idx] = cb.checked;
      saveFlowChecklistState(cur);
      // Any manual interaction clears the skip flag
      setFlowChecklistSkipped(false);
      updateFlowChecklistGate();
    });
  });
}

function updateFlowChecklistGate() {
  const btnRight = document.getElementById('btn-right');
  if (Flow.getStatus() !== 'idle') return;
  btnRight.disabled = !canStartFlow();
  const skipBtn = document.getElementById('flow-skip-checklist');
  if (skipBtn) {
    const allChecked = loadFlowChecklistState().every(Boolean);
    skipBtn.classList.toggle('hidden', allChecked);
  }
}

function initFlowDistractionLog() {
  const btn = document.getElementById('flow-distraction-btn');
  const picker = document.getElementById('flow-distraction-picker');
  const noteInput = document.getElementById('flow-distraction-note');
  if (!btn || !picker) return;

  btn.addEventListener('click', () => {
    picker.classList.toggle('hidden');
    if (!picker.classList.contains('hidden') && noteInput) noteInput.value = '';
  });

  picker.querySelectorAll('.flow-distraction-cat').forEach(catBtn => {
    catBtn.addEventListener('click', () => {
      const category = catBtn.dataset.cat;
      const note = noteInput ? noteInput.value.trim() : '';
      const items = loadFlowDistractions();
      items.push({
        category,
        note,
        timestamp: Date.now(),
        phase: Flow.getPhase(),
      });
      saveFlowDistractions(items);
      picker.classList.add('hidden');
      if (navigator.vibrate) navigator.vibrate(30);
    });
  });
}

function updateFlowDistractionBtnVisibility() {
  const btn = document.getElementById('flow-distraction-btn');
  if (!btn) return;
  const show = Flow.getStatus() === 'running';
  btn.classList.toggle('hidden', !show);
  if (!show) {
    document.getElementById('flow-distraction-picker')?.classList.add('hidden');
  }
}

function initFlowBFRBLog() {
  const btn = document.getElementById('flow-bfrb-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const items = loadFlowBFRBs();
    items.push({ timestamp: Date.now(), phase: Flow.getPhase() });
    saveFlowBFRBs(items);
    renderFlowBFRBBtn();
    btn.classList.add('flow-bfrb-pulse');
    setTimeout(() => btn.classList.remove('flow-bfrb-pulse'), 150);
    if (navigator.vibrate) navigator.vibrate(20);
  });
}

function renderFlowBFRBBtn() {
  const btn = document.getElementById('flow-bfrb-btn');
  if (!btn) return;
  const count = loadFlowBFRBs().length;
  btn.textContent = count > 0 ? `BFRB ×${count}` : 'BFRB';
}

function updateFlowBFRBBtnVisibility() {
  const btn = document.getElementById('flow-bfrb-btn');
  if (!btn) return;
  const show = Flow.getStatus() === 'running';
  btn.classList.toggle('hidden', !show);
  if (show) renderFlowBFRBBtn();
}

function renderFlowSummary() {
  const body = document.getElementById('flow-summary-body');
  if (!body) return;
  const durMin = Math.round(Flow.getFocusDurationMs() / 60000);
  const goal = Flow.getGoal();
  const distractions = loadFlowDistractions();
  const bfrbs = loadFlowBFRBs();

  // Group distractions by category for a breakdown
  const counts = {};
  distractions.forEach(d => { counts[d.category] = (counts[d.category] || 0) + 1; });
  const catOrder = ['phone', 'email', 'interrupted', 'self', 'other'];
  const catLabels = {
    phone: 'Phone', email: 'Email', interrupted: 'Interrupted',
    self: 'Self', other: 'Other',
  };
  const breakdown = catOrder
    .filter(k => counts[k])
    .map(k => `${catLabels[k]} ${counts[k]}`)
    .join(' · ');

  body.innerHTML = `
    <div class="flow-summary-row">
      <span class="flow-summary-label">Duration</span>
      <span class="flow-summary-value">${durMin} min</span>
    </div>
    ${goal ? `<div class="flow-summary-row">
      <span class="flow-summary-label">Goal</span>
      <span class="flow-summary-value">${escapeHtml(goal)}</span>
    </div>` : ''}
    <div class="flow-summary-row">
      <span class="flow-summary-label">Distractions</span>
      <span class="flow-summary-value">${distractions.length}${breakdown ? ` <span class="flow-summary-sub">(${breakdown})</span>` : ''}</span>
    </div>
    <div class="flow-summary-row">
      <span class="flow-summary-label">BFRB catches</span>
      <span class="flow-summary-value">${bfrbs.length}</span>
    </div>
  `;
}

const FLOW_LAST_SAVED_KEY = 'flow_last_saved_session';

function saveFlowSessionToHistory() {
  const sessionStartedAt = Flow.getSessionStartedAt();
  if (!sessionStartedAt) return;
  // Dedupe: don't save the same session twice (e.g., if the user reopens the
  // tab after the block already completed, and again after clicking through).
  if (localStorage.getItem(FLOW_LAST_SAVED_KEY) === String(sessionStartedAt)) return;

  const durationMs = Flow.getFocusDurationMs();
  const distractions = loadFlowDistractions();
  const bfrbs = loadFlowBFRBs();
  const sessionEndedAt = Flow.getFocusEndedAt() || Date.now();

  const session = {
    type: 'flow',
    duration: durationMs,
    laps: [],
    goal: Flow.getGoal() || '',
    blockDurationMs: durationMs,
    preBlockSkipped: isFlowChecklistSkipped(),
    sessionStartedAt,
    sessionEndedAt,
  };
  if (distractions.length > 0) session.distractions = distractions;
  if (bfrbs.length > 0) session.bfrbs = bfrbs;

  History.addSession(session);
  localStorage.setItem(FLOW_LAST_SAVED_KEY, String(sessionStartedAt));
}

function startFlowRenderLoop() {
  if (flowRafId !== null) return;
  function tick() {
    if (flowRafId === null) return;
    const st = Flow.getStatus();
    if (st === 'running' || st === 'recovery') {
      Flow.checkFinished();
      updateFlowUI();
      const after = Flow.getStatus();
      if (after === 'running' || after === 'recovery') {
        flowRafId = requestAnimationFrame(tick);
      } else {
        flowRafId = null;
      }
    } else {
      flowRafId = null;
    }
  }
  flowRafId = requestAnimationFrame(tick);
}

function stopFlowRenderLoop() {
  if (flowRafId !== null) {
    cancelAnimationFrame(flowRafId);
    flowRafId = null;
  }
}

function saveFlowState() {
  localStorage.setItem('flow_state', JSON.stringify(Flow.getState()));
}

function saveFlowConfig() {
  localStorage.setItem('flow_config', JSON.stringify(Flow.getConfig()));
}
