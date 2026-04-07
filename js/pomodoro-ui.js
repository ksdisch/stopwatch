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

  // Init checklist
  renderChecklist();
  initChecklistInput();

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
      History.addSession({ type: 'pomodoro', duration: elapsed, laps: [] });
    }
    Pomodoro.reset();
    savePomodoroState();
    clearChecklist();
    renderChecklist();
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
    savePomodoroState();
    SFX.playStop();
    updatePomodoroUI();
  } else if (status === 'idle' || status === 'paused') {
    Pomodoro.start();
    savePomodoroState();
    SFX.playStart();
    startPomodoroRenderLoop();
    updatePomodoroUI();
  } else if (status === 'phaseComplete') {
    // Start next phase
    Pomodoro.nextPhase();
    if (Pomodoro.getStatus() === 'done') {
      History.addSession({ type: 'pomodoro', duration: getPomodoroTotalDuration(), laps: [] });
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

// ── Pomodoro Checklist ──
const CHECKLIST_KEY = 'pomodoro_checklist';

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
}

function renderChecklist() {
  const container = document.getElementById('pomo-checklist-items');
  if (!container) return;
  const items = loadChecklist();

  if (items.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = items.map((item, i) =>
    `<div class="pomo-checklist-item ${item.done ? 'pomo-checklist-item-done' : ''}" data-idx="${i}">
      <input type="checkbox" ${item.done ? 'checked' : ''} data-check-idx="${i}">
      <span class="pomo-checklist-item-text">${escapeChecklistHtml(item.text)}</span>
      <button class="pomo-checklist-item-delete" data-del-idx="${i}">&times;</button>
    </div>`
  ).join('');

  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const idx = parseInt(cb.dataset.checkIdx, 10);
      const items = loadChecklist();
      if (items[idx]) {
        items[idx].done = cb.checked;
        saveChecklist(items);
        renderChecklist();
      }
    });
  });

  container.querySelectorAll('.pomo-checklist-item-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.delIdx, 10);
      const items = loadChecklist();
      items.splice(idx, 1);
      saveChecklist(items);
      renderChecklist();
    });
  });
}

function initChecklistInput() {
  const input = document.getElementById('pomo-checklist-input');
  if (!input) return;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const items = loadChecklist();
      items.push({ text, done: false });
      saveChecklist(items);
      input.value = '';
      renderChecklist();
    }
  });
}

// Uses shared escapeHtml from dom-utils.js
const escapeChecklistHtml = escapeHtml;
