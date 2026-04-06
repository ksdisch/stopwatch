// ── State ──
let appMode = localStorage.getItem('app_mode') || 'stopwatch';

// ── Restore persisted state ──
Persistence.load();
const pomodoroState = JSON.parse(localStorage.getItem('pomodoro_state') || 'null');
if (pomodoroState) Pomodoro.loadState(pomodoroState);
const pomodoroConfig = JSON.parse(localStorage.getItem('pomodoro_config') || 'null');
if (pomodoroConfig) Pomodoro.configure(pomodoroConfig);

// ── Initialize modules ──
Themes.init();
OffsetInput.init();
Analog.init();
UI.init();
CardsUI.init();
initAppMode();
initTimerUI();
initPomodoroUI();
initAlertUI();
initSoundToggle();
initThemePicker();
initHistoryPanel();
initExportButton();

// ── Service worker ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ── PWA install prompt ──
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  if (localStorage.getItem('install_dismissed')) return;
  deferredPrompt = e;
  showInstallBanner();
});

function showInstallBanner() {
  const banner = document.createElement('div');
  banner.id = 'install-banner';
  banner.className = 'install-banner';
  banner.innerHTML = `
    <span>Install Stopwatch for quick access</span>
    <button id="install-btn" class="install-btn">Install</button>
    <button id="install-dismiss" class="install-dismiss">&times;</button>
  `;
  document.getElementById('app').prepend(banner);
  requestAnimationFrame(() => banner.classList.add('install-visible'));

  document.getElementById('install-btn').addEventListener('click', () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(() => { deferredPrompt = null; });
    }
    banner.remove();
  });

  document.getElementById('install-dismiss').addEventListener('click', () => {
    localStorage.setItem('install_dismissed', '1');
    banner.remove();
  });
}

// ── App Mode Switching (Stopwatch / Timer) ──
function initAppMode() {
  const tabs = document.querySelectorAll('.mode-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      switchAppMode(tab.dataset.appMode);
    });
  });
  applyAppMode();
}

function switchAppMode(mode) {
  if (mode === appMode) return;
  // Stop all render loops before switching
  UI.stopRenderLoop();
  stopTimerRenderLoop();
  stopPomodoroRenderLoop();

  // Animate transition
  const display = document.getElementById('timer-display');
  display.classList.add('mode-fade-out');
  setTimeout(() => {
    appMode = mode;
    localStorage.setItem('app_mode', mode);
    applyAppMode();
    display.classList.remove('mode-fade-out');
    display.classList.add('mode-fade-in');
    setTimeout(() => display.classList.remove('mode-fade-in'), 150);
  }, 100);
}

function applyAppMode() {
  const tabs = document.querySelectorAll('.mode-tab');
  tabs.forEach(t => t.classList.toggle('mode-tab-active', t.dataset.appMode === appMode));

  const isTimer = appMode === 'timer';
  const isPomodoro = appMode === 'pomodoro';
  const isStopwatch = appMode === 'stopwatch';

  document.getElementById('offset-area').classList.toggle('hidden', !isStopwatch);
  document.getElementById('alert-area').classList.toggle('hidden', !isStopwatch);
  document.getElementById('timer-set-area').classList.toggle('hidden', !isTimer);
  document.getElementById('pomodoro-area').classList.toggle('hidden', !isPomodoro);
  document.getElementById('timer-progress').classList.toggle('hidden',
    isStopwatch || (isTimer && Timer.getStatus() === 'idle') || (isPomodoro && Pomodoro.getStatus() === 'idle'));
  document.querySelector('.mode-toggle').classList.toggle('hidden', !isStopwatch);
  document.getElementById('export-area').classList.toggle('hidden', !isStopwatch);
  document.getElementById('lap-stats').classList.toggle('hidden', !isStopwatch);
  document.getElementById('lap-section').classList.toggle('hidden', !isStopwatch);

  document.getElementById('instance-cards').classList.toggle('hidden', isPomodoro);

  if (isTimer) {
    updateTimerUI();
  } else if (isPomodoro) {
    updatePomodoroUI();
  } else {
    UI.syncUI();
  }

  CardsUI.render();
}

// ── Timer UI ──
let timerRafId = null;

function initTimerUI() {
  const setToggle = document.getElementById('timer-set-toggle');
  const setInput = document.getElementById('timer-set-input');
  const setBtn = document.getElementById('timer-set-btn');
  const cancelBtn = document.getElementById('timer-cancel-btn');

  setToggle.addEventListener('click', () => {
    setInput.classList.remove('hidden');
    setToggle.classList.add('hidden');
    document.getElementById('timer-minutes').focus();
  });

  cancelBtn.addEventListener('click', () => {
    setInput.classList.add('hidden');
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
    setInput.classList.add('hidden');
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
  const status = Timer.getStatus();
  if (status === 'paused' || status === 'finished') {
    // Save session before reset
    const elapsed = Timer.getElapsedMs();
    if (elapsed > 1000) {
      History.addSession({ type: 'timer', duration: elapsed, laps: [] });
    }
    Timer.reset();
    saveTimerState();
    updateTimerUI();
  }
}

function onTimerRight() {
  if (appMode !== 'timer') return;
  const status = Timer.getStatus();
  if (status === 'running') {
    Timer.pause();
    saveTimerState();
    stopTimerRenderLoop();
    updateTimerUI();
  } else if (status === 'idle' || status === 'paused') {
    if (Timer.getDurationMs() === 0) return;
    Timer.start();
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
    if (Notification.permission === 'granted') {
      new Notification('Timer Complete', { body: 'Your countdown has finished!' });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
    saveTimerState();
    updateTimerUI();
  });
}

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
    settingsPanel.classList.remove('hidden');
    settingsToggle.classList.add('hidden');
  });

  cancelBtn.addEventListener('click', () => {
    settingsPanel.classList.add('hidden');
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
    settingsPanel.classList.add('hidden');
    settingsToggle.classList.remove('hidden');
  });

  // Phase complete callback
  Pomodoro.onPhaseComplete((completedPhase) => {
    SFX.playAlarm();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
    if (Notification.permission === 'granted') {
      const label = completedPhase === 'work' ? 'Work session complete! Time for a break.' : 'Break is over! Time to focus.';
      new Notification('Pomodoro', { body: label });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
    savePomodoroState();
    updatePomodoroUI();
  });

  // Wire buttons
  document.getElementById('btn-left').addEventListener('click', onPomodoroLeft);
  document.getElementById('btn-right').addEventListener('click', onPomodoroRight);

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
  for (let i = 0; i < total; i++) {
    let cls = 'pomodoro-dot';
    if (i < cycleIdx) {
      cls += ' pomodoro-dot-done';
    } else if (i === cycleIdx && phase === 'work' && status !== 'idle' && status !== 'done') {
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

function savePomodoroState() {
  localStorage.setItem('pomodoro_state', JSON.stringify(Pomodoro.getState()));
}

// ── Alert UI ──
function initAlertUI() {
  const toggleBtn = document.getElementById('alert-toggle');
  const inputArea = document.getElementById('alert-input');
  const setBtn = document.getElementById('alert-set');
  const cancelBtn = document.getElementById('alert-cancel');
  const hoursEl = document.getElementById('alert-hours');
  const minutesEl = document.getElementById('alert-minutes');
  const secondsEl = document.getElementById('alert-seconds');

  toggleBtn.addEventListener('click', () => {
    inputArea.classList.remove('hidden');
    toggleBtn.classList.add('hidden');
    minutesEl.focus();
    minutesEl.select();
    // Request notification permission proactively
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  });

  cancelBtn.addEventListener('click', () => {
    inputArea.classList.add('hidden');
    toggleBtn.classList.remove('hidden');
    hoursEl.value = 0;
    minutesEl.value = 0;
    secondsEl.value = 0;
  });

  setBtn.addEventListener('click', () => {
    const h = Math.min(99, Math.max(0, parseInt(hoursEl.value, 10) || 0));
    const m = Math.min(59, Math.max(0, parseInt(minutesEl.value, 10) || 0));
    const s = Math.min(59, Math.max(0, parseInt(secondsEl.value, 10) || 0));
    const ms = (h * 3600 + m * 60 + s) * 1000;
    if (ms > 0) {
      Stopwatch.addAlert(ms);
      Persistence.save();
      renderAlerts();
    }
    inputArea.classList.add('hidden');
    toggleBtn.classList.remove('hidden');
    hoursEl.value = 0;
    minutesEl.value = 0;
    secondsEl.value = 0;
  });

  // Enter key in alert fields
  [hoursEl, minutesEl, secondsEl].forEach(el => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); setBtn.click(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelBtn.click(); }
    });
  });

  renderAlerts();
}

function renderAlerts() {
  const listEl = document.getElementById('alert-list');
  if (!listEl) return;
  const alerts = Stopwatch.getAlerts();
  if (alerts.length === 0) {
    listEl.innerHTML = '';
    return;
  }
  listEl.innerHTML = alerts.map(a => {
    const t = Utils.formatMs(a.ms);
    const timeStr = t.hours > 0
      ? `${t.hours}:${t.minStr}:${t.secStr}`
      : `${t.minStr}:${t.secStr}`;
    const icon = a.fired ? '✓' : '⏰';
    const cls = a.fired ? 'alert-chip alert-chip-fired' : 'alert-chip';
    return `<span class="${cls}">
      <span class="alert-chip-icon">${icon}</span>
      ${timeStr}
      <button class="alert-chip-delete" data-alert-ms="${a.ms}">&times;</button>
    </span>`;
  }).join('');

  listEl.querySelectorAll('.alert-chip-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      Stopwatch.removeAlert(Number(btn.dataset.alertMs));
      Persistence.save();
      renderAlerts();
    });
  });
}

// ── Sound Toggle ──
function initSoundToggle() {
  const btn = document.getElementById('sound-toggle');
  const icon = document.getElementById('sound-icon');
  updateSoundIcon();

  btn.addEventListener('click', () => {
    SFX.toggleMute();
    updateSoundIcon();
    if (!SFX.isMuted()) SFX.playLap(); // feedback beep
  });

  function updateSoundIcon() {
    icon.textContent = SFX.isMuted() ? '\u{1F507}' : '\u{1F50A}';
  }
}

// ── Theme Picker ──
function initThemePicker() {
  const toggleBtn = document.getElementById('theme-toggle');
  const picker = document.getElementById('theme-picker');

  toggleBtn.addEventListener('click', () => {
    picker.classList.toggle('hidden');
    if (!picker.classList.contains('hidden')) {
      renderThemePicker();
    }
  });

  function renderThemePicker() {
    const current = Themes.getThemeId();
    const presets = Themes.getPresets();
    picker.innerHTML = presets.map(p =>
      `<button class="theme-option ${p.id === current ? 'theme-option-active' : ''}" data-theme="${p.id}">${p.name}</button>`
    ).join('');

    picker.querySelectorAll('.theme-option').forEach(btn => {
      btn.addEventListener('click', () => {
        Themes.apply(btn.dataset.theme);
        renderThemePicker();
      });
    });
  }
}

// ── History Panel ──
function initHistoryPanel() {
  const toggleBtn = document.getElementById('history-toggle');
  const panel = document.getElementById('history-panel');
  const closeBtn = document.getElementById('history-close');

  toggleBtn.addEventListener('click', () => {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) renderHistory();
  });

  closeBtn.addEventListener('click', () => {
    panel.classList.add('hidden');
    activeTagFilter = null;
  });
}

let activeTagFilter = null;

function renderHistory() {
  const list = document.getElementById('history-list');
  const filterEl = document.getElementById('history-filter');
  let sessions = History.getSessions().reverse();

  // Render filter bar
  const allTags = History.getAllTags();
  if (allTags.length > 0) {
    filterEl.innerHTML = `<button class="filter-chip ${activeTagFilter === null ? 'filter-chip-active' : ''}" data-filter-tag="">All</button>` +
      allTags.map(tag =>
        `<button class="filter-chip ${activeTagFilter === tag ? 'filter-chip-active' : ''}" data-filter-tag="${escapeHistoryHtml(tag)}">${escapeHistoryHtml(tag)}</button>`
      ).join('');

    filterEl.querySelectorAll('.filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const tag = btn.dataset.filterTag;
        activeTagFilter = tag || null;
        renderHistory();
      });
    });
  } else {
    filterEl.innerHTML = '';
  }

  // Apply filter
  if (activeTagFilter) {
    sessions = sessions.filter(s =>
      Array.isArray(s.tags) && s.tags.includes(activeTagFilter)
    );
  }

  if (sessions.length === 0) {
    list.innerHTML = activeTagFilter
      ? '<div class="history-empty">No sessions with this tag</div>'
      : '<div class="history-empty">No sessions yet</div>';
    return;
  }

  list.innerHTML = sessions.map(s => {
    const date = new Date(s.date);
    const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const t = Utils.formatMs(s.duration);
    const dur = t.hours > 0 ? `${t.hours}:${t.minStr}:${t.secStr}` : `${t.minStr}:${t.secStr}`;
    const type = s.type === 'pomodoro' ? 'Pomodoro' : s.type === 'timer' ? 'Timer' : 'Stopwatch';
    const laps = s.laps.length > 0 ? `${s.laps.length} laps` : '';
    const note = s.note
      ? `<div class="history-note" data-note-id="${s.id}">${escapeHistoryHtml(s.note)}</div>`
      : `<button class="history-add-note" data-note-id="${s.id}">+ note</button>`;

    const tags = Array.isArray(s.tags) ? s.tags : [];
    const tagsHtml = `<div class="history-tags">` +
      tags.map(tag =>
        `<span class="tag-chip">${escapeHistoryHtml(tag)}<button class="tag-chip-delete" data-session-id="${s.id}" data-tag="${escapeHistoryHtml(tag)}">&times;</button></span>`
      ).join('') +
      `<button class="tag-add-btn" data-session-id="${s.id}">+ tag</button></div>`;

    return `<div class="history-row" data-id="${s.id}">
      <div class="history-row-top">
        <span class="history-type">${type}</span>
        <span class="history-dur">${dur}</span>
        <span class="history-date">${dateStr}</span>
      </div>
      <div class="history-row-bottom">
        <span class="history-laps">${laps}</span>
        ${note}
      </div>
      ${tagsHtml}
    </div>`;
  }).join('');

  // Attach tag handlers
  list.querySelectorAll('.tag-chip-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      History.removeTag(Number(btn.dataset.sessionId), btn.dataset.tag);
      renderHistory();
    });
  });

  list.querySelectorAll('.tag-add-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sessionId = Number(btn.dataset.sessionId);
      // Replace button with input
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'tag-input';
      input.placeholder = 'tag name';
      input.maxLength = 20;
      btn.replaceWith(input);
      input.focus();

      function commitTag() {
        const tag = input.value.trim().toLowerCase();
        if (tag) {
          History.addTag(sessionId, tag);
        }
        renderHistory();
      }
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitTag(); }
        else if (e.key === 'Escape') { e.preventDefault(); renderHistory(); }
      });
      input.addEventListener('blur', commitTag);
    });
  });

  // Note editing — tap existing note or "+ note" button
  list.querySelectorAll('.history-note, .history-add-note').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const sessionId = Number(el.dataset.noteId);
      const currentNote = el.classList.contains('history-note') ? el.textContent : '';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'note-input';
      input.value = currentNote;
      input.placeholder = 'Add a note...';
      input.maxLength = 100;
      el.replaceWith(input);
      input.focus();

      function commitNote() {
        const note = input.value.trim();
        History.updateNote(sessionId, note);
        renderHistory();
      }
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitNote(); }
        else if (e.key === 'Escape') { e.preventDefault(); renderHistory(); }
      });
      input.addEventListener('blur', commitNote);
    });
  });
}

function escapeHistoryHtml(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

// ── Export Button ──
function initExportButton() {
  const area = document.getElementById('export-area');
  const btn = document.getElementById('export-btn');

  btn.addEventListener('click', async () => {
    const laps = Stopwatch.getLaps();
    const elapsed = Stopwatch.getElapsedMs();
    if (laps.length === 0) return;

    if (Export.canShare()) {
      await Export.share(laps, elapsed);
    } else {
      const ok = await Export.copyToClipboard(laps, elapsed);
      if (ok) {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Export Laps'; }, 1500);
      }
    }
  });
}

// ── Hook into UI to show/hide export and save history on reset ──
const originalSyncUI = UI.syncUI;
UI.syncUI = function() {
  originalSyncUI();
  const laps = Stopwatch.getLaps();
  const area = document.getElementById('export-area');
  if (laps.length > 0 && appMode === 'stopwatch') {
    area.classList.remove('hidden');
  } else {
    area.classList.add('hidden');
  }
  if (appMode === 'stopwatch') renderAlerts();
};

// Hook into stopwatch reset to save history
const originalOnLeftClick = document.getElementById('btn-left').onclick;
document.getElementById('btn-left').addEventListener('click', () => {
  if (appMode !== 'stopwatch') return;
  // Check if we just reset (status went to idle and we had state)
  // This is handled by checking after the fact
});

// Save stopwatch sessions on reset — track per-instance status
const lastKnownStates = new Map();

setInterval(() => {
  // Track all stopwatch instances
  InstanceManager.getStopwatches().forEach(sw => {
    const id = sw.getId();
    const status = sw.getStatus();
    const prev = lastKnownStates.get(id) || { status: 'idle', elapsed: 0, laps: [] };

    if (status !== 'idle') {
      prev.elapsed = sw.getElapsedMs();
      prev.laps = sw.getLaps();
    }
    if (prev.status !== 'idle' && status === 'idle' && prev.elapsed > 1000) {
      History.addSession({
        type: 'stopwatch',
        duration: prev.elapsed,
        laps: prev.laps,
      });
      prev.elapsed = 0;
      prev.laps = [];
    }
    prev.status = status;
    lastKnownStates.set(id, prev);
  });
}, 500);
