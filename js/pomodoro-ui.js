// ── Pomodoro UI ──
let pomodoroRafId = null;

function initPomodoroUI() {
  const settingsToggle = document.getElementById('pomodoro-settings-toggle');
  const settingsPanel = document.getElementById('pomodoro-settings');
  const saveBtn = document.getElementById('pomo-settings-save');
  const cancelBtn = document.getElementById('pomo-settings-cancel');

  settingsToggle.addEventListener('click', () => {
    // Populate inputs with current config
    const cfg = Pomodoro.getConfig();
    document.getElementById('pomo-work-min').value = cfg.workMs / 60000;
    document.getElementById('pomo-short-min').value = cfg.shortBreakMs / 60000;
    document.getElementById('pomo-long-min').value = cfg.longBreakMs / 60000;
    document.getElementById('pomo-cycles').value = cfg.totalCycles;
    settingsPanel.removeAttribute('data-collapsed');
    settingsToggle.classList.add('hidden');
  });

  cancelBtn.addEventListener('click', () => {
    settingsPanel.setAttribute('data-collapsed', '');
    settingsToggle.classList.remove('hidden');
  });

  saveBtn.addEventListener('click', () => {
    const workMin = Math.max(1, Math.min(99, parseInt(document.getElementById('pomo-work-min').value, 10) || 25));
    const shortMin = Math.max(1, Math.min(30, parseInt(document.getElementById('pomo-short-min').value, 10) || 5));
    const longMin = Math.max(1, Math.min(60, parseInt(document.getElementById('pomo-long-min').value, 10) || 15));
    const cycles = Math.max(1, Math.min(10, parseInt(document.getElementById('pomo-cycles').value, 10) || 4));

    const config = {
      workMs: workMin * 60000,
      shortBreakMs: shortMin * 60000,
      longBreakMs: longMin * 60000,
      totalCycles: cycles,
    };
    Pomodoro.configure(config);
    localStorage.setItem('pomodoro_config', JSON.stringify(config));
    savePomodoroState();
    updatePomodoroUI();
    settingsPanel.setAttribute('data-collapsed', '');
    settingsToggle.classList.remove('hidden');
  });

  // Phase complete callback
  Pomodoro.onPhaseComplete((completedPhase) => {
    SFX.playAlarm();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const label = completedPhase === 'work' ? 'Work session complete! Time for a break.' : 'Break is over! Time to focus.';
      new Notification('Pomodoro', { body: label });
    } else if (typeof Notification !== 'undefined' && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
    savePomodoroState();
    updatePomodoroUI();
  });

  // Wire buttons
  document.getElementById('btn-left').addEventListener('click', onPomodoroLeft);
  document.getElementById('btn-right').addEventListener('click', onPomodoroRight);

  // Init checklists and actual work list
  renderChecklist();
  renderBreakChecklist();
  renderActualWork();
  initChecklistInput();
  initActualWorkInput();
  updateChecklistVisibility();

  // Init actions drawer
  initActionsDrawer();

  // Stats panel
  document.getElementById('pomodoro-stats-toggle')?.addEventListener('click', () => {
    const panel = document.getElementById('pomo-stats-panel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) renderPomodoroStats();
  });
  document.getElementById('pomo-stats-close')?.addEventListener('click', () => {
    document.getElementById('pomo-stats-panel').classList.add('hidden');
  });

  // Keyboard shortcuts for Pomodoro mode
  document.addEventListener('keydown', (e) => {
    if (appMode !== 'pomodoro') return;
    if (e.target.tagName === 'INPUT') return;
    const status = Pomodoro.getStatus();
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (status === 'running' || status === 'idle' || status === 'paused') {
          onPomodoroRight();
        }
        break;
      case 'KeyR':
        if (status === 'paused') onPomodoroLeft();
        break;
      case 'KeyN':
      case 'Enter':
        if (status === 'phaseComplete') {
          e.preventDefault();
          onPomodoroRight();
        }
        break;
    }
  });

  // Restore render loop if needed
  if (Pomodoro.getStatus() === 'running' && appMode === 'pomodoro') {
    startPomodoroRenderLoop();
  }
  if ((Pomodoro.getStatus() === 'phaseComplete' || Pomodoro.getStatus() === 'done') && appMode === 'pomodoro') {
    updatePomodoroUI();
  }
}

function onPomodoroLeft() {
  if (appMode !== 'pomodoro') return;
  if (pomodoroClickLock) return;
  pomodoroClickLock = true;
  setTimeout(() => { pomodoroClickLock = false; }, 100);

  const status = Pomodoro.getStatus();
  if (status === 'paused') {
    // Save session before reset
    const elapsed = Pomodoro.getElapsedMs();
    if (elapsed > 1000) {
      const cfg = Pomodoro.getConfig();
      History.addSession({
        type: 'pomodoro', duration: elapsed, laps: [],
        completedCycles: Pomodoro.getCycleIndex(),
        totalWorkMs: Pomodoro.getCycleIndex() * cfg.workMs,
        ...gatherTaskData(),
        ...gatherTimingData(),
      });
    }
    Pomodoro.reset();
    BgNotify.cancel('pomodoro');
    savePomodoroState();
    clearChecklist();
    renderChecklist();
    renderBreakChecklist();
    renderActualWork();
    SFX.playReset();
    updatePomodoroUI();
  } else if (status === 'phaseComplete') {
    // Skip — advance to next phase
    Pomodoro.nextPhase();
    savePomodoroState();
    updatePomodoroUI();
  }
}

let pomodoroClickLock = false;
function onPomodoroRight() {
  if (appMode !== 'pomodoro') return;
  if (pomodoroClickLock) return;
  pomodoroClickLock = true;
  setTimeout(() => { pomodoroClickLock = false; }, 100);

  const status = Pomodoro.getStatus();
  if (status === 'running') {
    stopPomodoroRenderLoop();
    Pomodoro.pause();
    BgNotify.cancel('pomodoro');
    savePomodoroState();
    SFX.playStop();
    updatePomodoroUI();
  } else if (status === 'idle' || status === 'paused') {
    Pomodoro.start();
    const phase = Pomodoro.getPhase();
    const phaseLabel = phase === 'work' ? 'Work session complete!' : 'Break is over!';
    BgNotify.schedule('pomodoro', Pomodoro.getRemainingMs(), 'Pomodoro', phaseLabel);
    savePomodoroState();
    SFX.playStart();
    startPomodoroRenderLoop();
    updatePomodoroUI();
  } else if (status === 'phaseComplete') {
    // Start next phase
    Pomodoro.nextPhase();
    if (Pomodoro.getStatus() === 'done') {
      const cfg = Pomodoro.getConfig();
      History.addSession({
        type: 'pomodoro', duration: getPomodoroTotalDuration(), laps: [],
        completedCycles: cfg.totalCycles,
        totalWorkMs: cfg.totalCycles * cfg.workMs,
        ...gatherTaskData(),
        ...gatherTimingData(),
      });
      savePomodoroState();
      updatePomodoroUI();
      return;
    }
    Pomodoro.start();
    savePomodoroState();
    SFX.playStart();
    startPomodoroRenderLoop();
    updatePomodoroUI();
  } else if (status === 'done') {
    Pomodoro.reset();
    savePomodoroState();
    clearChecklist();
    renderChecklist();
    renderBreakChecklist();
    renderActualWork();
    updatePomodoroUI();
  }
}

function updatePomodoroUI() {
  if (appMode !== 'pomodoro') return;

  const status = Pomodoro.getStatus();
  const phase = Pomodoro.getPhase();
  const remaining = Pomodoro.getRemainingMs();
  const timeEl = document.getElementById('time');
  const btnLeft = document.getElementById('btn-left');
  const btnRight = document.getElementById('btn-right');
  const timerDisplay = document.getElementById('timer-display');
  const appEl = document.getElementById('app');
  const progressBar = document.getElementById('timer-progress');
  const progressFill = document.getElementById('timer-progress-fill');
  const phaseLabel = document.getElementById('pomodoro-phase');
  const cycleLabel = document.getElementById('pomodoro-cycle');
  const settingsToggle = document.getElementById('pomodoro-settings-toggle');

  // Phase label
  const cycleIdx = Pomodoro.getCycleIndex();
  const totalCycles = Pomodoro.getTotalCycles();
  if (phase === 'work') {
    const displayCycle = Math.min(cycleIdx + 1, totalCycles);
    phaseLabel.textContent = 'Work';
    cycleLabel.textContent = `${displayCycle}/${totalCycles}`;
  } else if (phase === 'shortBreak') {
    phaseLabel.textContent = 'Short Break';
    cycleLabel.textContent = `${cycleIdx}/${totalCycles}`;
  } else {
    phaseLabel.textContent = 'Long Break';
    cycleLabel.textContent = '';
  }

  // Cycle dots
  renderPomodoroDots();

  // Swap focus/break checklists
  updateChecklistVisibility();

  // Format remaining time
  const t = Utils.formatMs(remaining);
  if (t.hours > 0) {
    timeEl.innerHTML = `${t.hours}:${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`;
  } else {
    timeEl.innerHTML = `${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`;
  }

  // Progress bar
  if (status !== 'idle' && status !== 'done') {
    progressBar.classList.remove('hidden');
    progressFill.style.width = `${Pomodoro.getProgress() * 100}%`;
  } else {
    progressBar.classList.add('hidden');
  }

  // Break color + phase complete flash
  timerDisplay.classList.toggle('pomodoro-break', phase !== 'work' && status === 'running');
  timerDisplay.classList.toggle('pomodoro-phase-complete', status === 'phaseComplete');
  timerDisplay.classList.remove('timer-finished');

  // Running indicator
  timerDisplay.classList.toggle('is-running', status === 'running');
  appEl.classList.toggle('is-running', status === 'running');

  // Settings visibility
  settingsToggle.classList.toggle('hidden', status !== 'idle');

  // Actions visibility (show when not idle)
  document.getElementById('pomodoro-actions-toggle').classList.toggle('hidden', status === 'idle');
  if (status === 'idle') {
    document.getElementById('pomodoro-actions').setAttribute('data-collapsed', '');
  }

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
    case 'phaseComplete':
      if (phase === 'work') {
        btnLeft.innerHTML = '<span class="btn-inner">Skip</span>';
        btnLeft.className = 'control-btn btn-reset';
        btnLeft.disabled = false;
        btnRight.innerHTML = '<span class="btn-inner">Break</span>';
        btnRight.className = 'control-btn btn-start';
      } else {
        btnLeft.innerHTML = '<span class="btn-inner">Skip</span>';
        btnLeft.className = 'control-btn btn-reset';
        btnLeft.disabled = false;
        btnRight.innerHTML = '<span class="btn-inner">Work</span>';
        btnRight.className = 'control-btn btn-start';
      }
      break;
    case 'done':
      btnLeft.innerHTML = '<span class="btn-inner">--</span>';
      btnLeft.className = 'control-btn btn-lap';
      btnLeft.disabled = true;
      btnRight.innerHTML = '<span class="btn-inner">Reset</span>';
      btnRight.className = 'control-btn btn-start';
      break;
  }
}

function renderPomodoroDots() {
  const dotsEl = document.getElementById('pomodoro-dots');
  const total = Pomodoro.getTotalCycles();
  const cycleIdx = Pomodoro.getCycleIndex();
  const phase = Pomodoro.getPhase();
  const status = Pomodoro.getStatus();

  let html = '';
  if (status === 'done') {
    for (let i = 0; i < total; i++) {
      html += `<div class="pomodoro-dot pomodoro-dot-done"></div>`;
    }
    dotsEl.innerHTML = html;
    return;
  }
  for (let i = 0; i < total; i++) {
    let cls = 'pomodoro-dot';
    if (i < cycleIdx) {
      cls += ' pomodoro-dot-done';
    } else if (i === cycleIdx && phase === 'work' && status !== 'idle') {
      cls += ' pomodoro-dot-active';
    }
    html += `<div class="${cls}"></div>`;
  }
  dotsEl.innerHTML = html;
}

function startPomodoroRenderLoop() {
  if (pomodoroRafId !== null) return;
  function tick() {
    // Guard: if loop was stopped externally, don't continue
    if (pomodoroRafId === null) return;
    if (Pomodoro.getStatus() === 'running') {
      Pomodoro.checkFinished();
      updatePomodoroUI();
      if (Pomodoro.getStatus() === 'running') {
        pomodoroRafId = requestAnimationFrame(tick);
      } else {
        pomodoroRafId = null;
      }
    } else {
      pomodoroRafId = null;
    }
  }
  pomodoroRafId = requestAnimationFrame(tick);
}

function stopPomodoroRenderLoop() {
  if (pomodoroRafId !== null) {
    cancelAnimationFrame(pomodoroRafId);
    pomodoroRafId = null;
  }
}

function getPomodoroTotalDuration() {
  const cfg = Pomodoro.getConfig();
  const cycles = cfg.totalCycles;
  return (cfg.workMs * cycles) + (cfg.shortBreakMs * (cycles - 1)) + cfg.longBreakMs;
}

function savePomodoroState() {
  localStorage.setItem('pomodoro_state', JSON.stringify(Pomodoro.getState()));
}

// ── Pomodoro Checklists ──
const CHECKLIST_KEY = 'pomodoro_checklist';
const BREAK_CHECKLIST_KEY = 'pomodoro_break_checklist';

function loadChecklist() {
  try {
    return JSON.parse(localStorage.getItem(CHECKLIST_KEY)) || [];
  } catch (e) { return []; }
}

function saveChecklist(items) {
  localStorage.setItem(CHECKLIST_KEY, JSON.stringify(items));
}

function clearChecklist() {
  localStorage.removeItem(CHECKLIST_KEY);
  localStorage.removeItem(BREAK_CHECKLIST_KEY);
  localStorage.removeItem(ACTUAL_WORK_KEY);
}

function loadBreakChecklist() {
  try {
    return JSON.parse(localStorage.getItem(BREAK_CHECKLIST_KEY)) || [];
  } catch (e) { return []; }
}

function saveBreakChecklist(items) {
  localStorage.setItem(BREAK_CHECKLIST_KEY, JSON.stringify(items));
}

function renderChecklist() {
  renderChecklistInto('pomo-checklist-items', loadChecklist, saveChecklist);
}

function renderBreakChecklist() {
  renderChecklistInto('pomo-break-checklist-items', loadBreakChecklist, saveBreakChecklist);
}

function renderChecklistInto(containerId, loadFn, saveFn) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const items = loadFn();

  if (items.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = items.map((item, i) =>
    `<div class="pomo-checklist-item ${item.done ? 'pomo-checklist-item-done' : ''}" data-idx="${i}">
      <span class="pomo-drag-handle" data-drag-idx="${i}">&#x2630;</span>
      <input type="checkbox" ${item.done ? 'checked' : ''} data-check-idx="${i}">
      <span class="pomo-checklist-item-text">${escapeChecklistHtml(item.text)}</span>
      <button class="pomo-checklist-item-delete" data-del-idx="${i}">&times;</button>
    </div>`
  ).join('');

  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const idx = parseInt(cb.dataset.checkIdx, 10);
      const items = loadFn();
      if (items[idx]) {
        items[idx].done = cb.checked;
        saveFn(items);
        renderChecklistInto(containerId, loadFn, saveFn);
      }
    });
  });

  container.querySelectorAll('.pomo-checklist-item-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.delIdx, 10);
      const items = loadFn();
      items.splice(idx, 1);
      saveFn(items);
      renderChecklistInto(containerId, loadFn, saveFn);
    });
  });

  initDragReorder(container, loadFn, saveFn, () => renderChecklistInto(containerId, loadFn, saveFn));
}

function initChecklistInput() {
  initChecklistInputFor('pomo-checklist-input', loadChecklist, saveChecklist, renderChecklist);
  initChecklistInputFor('pomo-break-checklist-input', loadBreakChecklist, saveBreakChecklist, renderBreakChecklist);
}

function initChecklistInputFor(inputId, loadFn, saveFn, renderFn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const items = loadFn();
      items.push({ text, done: false });
      saveFn(items);
      input.value = '';
      renderFn();
    }
  });
}

function updateChecklistVisibility() {
  const phase = Pomodoro.getPhase();
  const status = Pomodoro.getStatus();
  const isBreak = phase === 'shortBreak' || phase === 'longBreak';
  const showBreak = isBreak && status !== 'idle' && status !== 'done';

  document.getElementById('pomo-checklist').classList.toggle('hidden', showBreak);
  document.getElementById('pomo-actual-work').classList.toggle('hidden', showBreak);
  // Always show break checklist when idle (for pre-planning) or during breaks
  const showIdle = status === 'idle' || status === 'done';
  document.getElementById('pomo-break-checklist').classList.toggle('hidden', !showBreak && !showIdle);
}

// ── "What I Worked On" Bullet List ──
const ACTUAL_WORK_KEY = 'pomodoro_actual_work';

function loadActualWork() {
  try { return JSON.parse(localStorage.getItem(ACTUAL_WORK_KEY)) || []; }
  catch (e) { return []; }
}

function saveActualWork(items) {
  localStorage.setItem(ACTUAL_WORK_KEY, JSON.stringify(items));
}

function renderActualWork() {
  const container = document.getElementById('pomo-actual-work-items');
  if (!container) return;
  const items = loadActualWork();

  if (items.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = items.map((text, i) =>
    `<div class="pomo-bullet-item" data-idx="${i}">
      <span class="pomo-drag-handle" data-drag-idx="${i}">&#x2630;</span>
      <span class="pomo-bullet-marker">\u2022</span>
      <span class="pomo-checklist-item-text">${escapeChecklistHtml(text)}</span>
      <button class="pomo-checklist-item-delete" data-del-idx="${i}">&times;</button>
    </div>`
  ).join('');

  container.querySelectorAll('.pomo-checklist-item-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.delIdx, 10);
      const items = loadActualWork();
      items.splice(idx, 1);
      saveActualWork(items);
      renderActualWork();
    });
  });

  initDragReorder(container, loadActualWork, saveActualWork, renderActualWork);
}

function initActualWorkInput() {
  const input = document.getElementById('pomo-actual-work-input');
  if (!input) return;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const items = loadActualWork();
      items.push(text);
      saveActualWork(items);
      input.value = '';
      renderActualWork();
    }
  });
}

// ── Task & Timing Data Gathering ──
function gatherTaskData() {
  return {
    focusGoals: loadChecklist().filter(i => i.done).map(i => i.text),
    breakTasks: loadBreakChecklist().filter(i => i.done).map(i => i.text),
    actualWork: loadActualWork(),
  };
}

function gatherTimingData() {
  const log = Pomodoro.getPhaseLog().slice();
  // If a phase is currently in progress, include it as open-ended
  const phaseStart = Pomodoro.getPhaseStartedAt();
  if (phaseStart) {
    log.push({ phase: Pomodoro.getPhase(), startedAt: phaseStart, endedAt: Date.now(), partial: true });
  }
  return {
    sessionStartedAt: Pomodoro.getSessionStartedAt(),
    sessionEndedAt: Date.now(),
    phaseLog: log,
  };
}

// ── Actions Drawer ──
function initActionsDrawer() {
  const toggle = document.getElementById('pomodoro-actions-toggle');
  const panel = document.getElementById('pomodoro-actions');

  toggle.addEventListener('click', () => {
    if (panel.hasAttribute('data-collapsed')) {
      panel.removeAttribute('data-collapsed');
    } else {
      panel.setAttribute('data-collapsed', '');
    }
  });

  document.getElementById('pomo-clear-focus').addEventListener('click', () => {
    saveChecklist([]);
    renderChecklist();
  });

  document.getElementById('pomo-clear-break').addEventListener('click', () => {
    saveBreakChecklist([]);
    renderBreakChecklist();
  });

  document.getElementById('pomo-restart-phase').addEventListener('click', () => {
    const status = Pomodoro.getStatus();
    if (status === 'idle' || status === 'done') return;
    stopPomodoroRenderLoop();
    BgNotify.cancel('pomodoro');
    Pomodoro.restartPhase();
    savePomodoroState();
    updatePomodoroUI();
    panel.setAttribute('data-collapsed', '');
  });

  document.getElementById('pomo-finish').addEventListener('click', () => {
    const elapsed = Pomodoro.getElapsedMs();
    const cfg = Pomodoro.getConfig();
    const cycleIdx = Pomodoro.getCycleIndex();
    const phase = Pomodoro.getPhase();
    if (elapsed > 1000 || cycleIdx > 0) {
      History.addSession({
        type: 'pomodoro',
        duration: elapsed,
        laps: [],
        completedCycles: cycleIdx,
        totalWorkMs: cycleIdx * cfg.workMs + (phase === 'work' ? elapsed : 0),
        ...gatherTaskData(),
        ...gatherTimingData(),
      });
    }
    stopPomodoroRenderLoop();
    BgNotify.cancel('pomodoro');
    Pomodoro.reset();
    savePomodoroState();
    clearChecklist();
    renderChecklist();
    renderBreakChecklist();
    renderActualWork();
    updatePomodoroUI();
    panel.setAttribute('data-collapsed', '');
  });
}

// ── Drag-to-Reorder ──
function initDragReorder(container, loadFn, saveFn, renderFn) {
  let dragEl = null;
  let placeholder = null;
  let startY = 0;
  let offsetY = 0;
  let fromIdx = -1;

  function getY(e) {
    return e.touches ? e.touches[0].clientY : e.clientY;
  }

  function onStart(e) {
    const handle = e.target.closest('.pomo-drag-handle');
    if (!handle) return;
    e.preventDefault();

    dragEl = handle.closest('[data-idx]');
    fromIdx = parseInt(dragEl.dataset.idx, 10);
    const rect = dragEl.getBoundingClientRect();
    startY = getY(e);
    offsetY = startY - rect.top;

    // Create placeholder
    placeholder = document.createElement('div');
    placeholder.className = 'pomo-drag-placeholder';
    placeholder.style.height = rect.height + 'px';
    dragEl.parentNode.insertBefore(placeholder, dragEl);

    // Float the dragged element
    dragEl.classList.add('pomo-dragging');
    dragEl.style.width = rect.width + 'px';
    dragEl.style.top = rect.top + 'px';
    dragEl.style.left = rect.left + 'px';

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  }

  function onMove(e) {
    if (!dragEl) return;
    e.preventDefault();
    const y = getY(e);
    dragEl.style.top = (y - offsetY) + 'px';

    // Find which item we're over
    const siblings = Array.from(container.querySelectorAll('[data-idx]:not(.pomo-dragging)'));
    for (const sib of siblings) {
      const rect = sib.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (y < mid) {
        container.insertBefore(placeholder, sib);
        return;
      }
    }
    // Past all items — put placeholder at end
    container.appendChild(placeholder);
  }

  function onEnd() {
    if (!dragEl) return;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);

    // Determine new index from placeholder position
    const allChildren = Array.from(container.children);
    let toIdx = allChildren.indexOf(placeholder);
    // Adjust: if placeholder is after original position, account for the dragged element still being in DOM
    if (toIdx > fromIdx) toIdx--;

    dragEl.classList.remove('pomo-dragging');
    dragEl.style.width = '';
    dragEl.style.top = '';
    dragEl.style.left = '';
    placeholder.remove();

    if (toIdx !== fromIdx && toIdx >= 0) {
      const items = loadFn();
      const [moved] = items.splice(fromIdx, 1);
      items.splice(toIdx, 0, moved);
      saveFn(items);
      renderFn();
    }

    dragEl = null;
    placeholder = null;
  }

  container.addEventListener('mousedown', onStart);
  container.addEventListener('touchstart', onStart, { passive: false });
}

async function renderPomodoroStats() {
  const content = document.getElementById('pomo-stats-content');
  if (!content) return;

  const streak = await PomodoroStats.getCurrentStreak();
  const cyclesThisWeek = await PomodoroStats.getCompletedCyclesThisWeek();
  const workMsThisWeek = await PomodoroStats.getTotalWorkMsThisWeek();
  const workMinThisWeek = Math.round(workMsThisWeek / 60000);
  const daily = await PomodoroStats.getDailyMinutesThisWeek();
  const maxMin = Math.max(1, ...daily.map(d => d.minutes));

  const chartBars = daily.map(d => {
    const height = d.minutes > 0 ? Math.max(4, (d.minutes / maxMin) * 80) : 0;
    return `<div class="pomo-stat-bar-col">
      <div class="pomo-stat-bar" style="height:${height}px"></div>
      <span class="pomo-stat-bar-label">${d.label}</span>
    </div>`;
  }).join('');

  content.innerHTML = `
    <div class="pomo-stat-cards">
      <div class="pomo-stat-card">
        <div class="pomo-stat-value">${streak}</div>
        <div class="pomo-stat-label">Day Streak</div>
      </div>
      <div class="pomo-stat-card">
        <div class="pomo-stat-value">${cyclesThisWeek}</div>
        <div class="pomo-stat-label">Cycles This Week</div>
      </div>
      <div class="pomo-stat-card">
        <div class="pomo-stat-value">${workMinThisWeek}m</div>
        <div class="pomo-stat-label">Focus Time</div>
      </div>
    </div>
    <div class="pomo-stat-chart-title">Daily Focus (minutes)</div>
    <div class="pomo-stat-chart">${chartBars}</div>
  `;
}

// Uses shared escapeHtml from dom-utils.js
const escapeChecklistHtml = escapeHtml;
