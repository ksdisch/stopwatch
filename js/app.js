// ── State ──
let appMode = localStorage.getItem('app_mode') || 'stopwatch';

// ── Restore persisted state ──
Persistence.load();
const timerState = JSON.parse(localStorage.getItem('timer_state') || 'null');
if (timerState) Timer.loadState(timerState);

// ── Initialize modules ──
Themes.init();
OffsetInput.init();
Analog.init();
UI.init();
initAppMode();
initTimerUI();
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
  appMode = mode;
  localStorage.setItem('app_mode', mode);
  applyAppMode();
}

function applyAppMode() {
  const tabs = document.querySelectorAll('.mode-tab');
  tabs.forEach(t => t.classList.toggle('mode-tab-active', t.dataset.appMode === appMode));

  const isTimer = appMode === 'timer';

  document.getElementById('offset-area').classList.toggle('hidden', isTimer);
  document.getElementById('timer-set-area').classList.toggle('hidden', !isTimer);
  document.getElementById('timer-progress').classList.toggle('hidden', !isTimer || Timer.getStatus() === 'idle');
  document.querySelector('.mode-toggle').classList.toggle('hidden', isTimer);

  // Update button labels for timer mode
  if (isTimer) {
    updateTimerUI();
  } else {
    UI.syncUI();
  }
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

  // Timer alarm callback
  Timer.onAlarm(() => {
    SFX.playAlarm();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
    // Try notification
    if (Notification.permission === 'granted') {
      new Notification('Timer Complete', { body: 'Your countdown has finished!' });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
    saveTimerState();
    updateTimerUI();
  });

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
  localStorage.setItem('timer_state', JSON.stringify(Timer.getState()));
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

  closeBtn.addEventListener('click', () => panel.classList.add('hidden'));
}

function renderHistory() {
  const list = document.getElementById('history-list');
  const sessions = History.getSessions().reverse();

  if (sessions.length === 0) {
    list.innerHTML = '<div class="history-empty">No sessions yet</div>';
    return;
  }

  list.innerHTML = sessions.map(s => {
    const date = new Date(s.date);
    const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const t = Utils.formatMs(s.duration);
    const dur = t.hours > 0 ? `${t.hours}:${t.minStr}:${t.secStr}` : `${t.minStr}:${t.secStr}`;
    const type = s.type === 'timer' ? 'Timer' : 'Stopwatch';
    const laps = s.laps.length > 0 ? `${s.laps.length} laps` : '';
    const note = s.note ? `<div class="history-note">${s.note}</div>` : '';

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
    </div>`;
  }).join('');
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
};

// Hook into stopwatch reset to save history
const originalOnLeftClick = document.getElementById('btn-left').onclick;
document.getElementById('btn-left').addEventListener('click', () => {
  if (appMode !== 'stopwatch') return;
  // Check if we just reset (status went to idle and we had state)
  // This is handled by checking after the fact
});

// Save stopwatch sessions on reset - patch via MutationObserver on status
let lastKnownStatus = Stopwatch.getStatus();
let lastKnownElapsed = 0;
let lastKnownLaps = [];

setInterval(() => {
  const status = Stopwatch.getStatus();
  if (status !== 'idle') {
    lastKnownElapsed = Stopwatch.getElapsedMs();
    lastKnownLaps = Stopwatch.getLaps();
  }
  if (lastKnownStatus !== 'idle' && status === 'idle' && lastKnownElapsed > 1000) {
    History.addSession({
      type: 'stopwatch',
      duration: lastKnownElapsed,
      laps: lastKnownLaps,
    });
    lastKnownElapsed = 0;
    lastKnownLaps = [];
  }
  lastKnownStatus = status;
}, 500);
