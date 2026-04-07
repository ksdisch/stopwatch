// ── State ──
let appMode = localStorage.getItem('app_mode') || 'stopwatch';

// ── Restore persisted state ──
Persistence.load();
try {
  const pomodoroState = JSON.parse(localStorage.getItem('pomodoro_state') || 'null');
  if (pomodoroState) Pomodoro.loadState(pomodoroState);
  const pomodoroConfig = JSON.parse(localStorage.getItem('pomodoro_config') || 'null');
  if (pomodoroConfig) Pomodoro.configure(pomodoroConfig);
} catch (e) {
  localStorage.removeItem('pomodoro_state');
  localStorage.removeItem('pomodoro_config');
}

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

// ── App Mode Switching (Stopwatch / Timer / Pomodoro) ──
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
  // Exit compare mode if active
  if (typeof isCompareActive === 'function' && isCompareActive()) {
    exitCompare();
    return; // exitCompare calls applyAppMode again
  }

  const tabs = document.querySelectorAll('.mode-tab');
  tabs.forEach(t => t.classList.toggle('mode-tab-active', t.dataset.appMode === appMode));

  const isTimer = appMode === 'timer';
  const isPomodoro = appMode === 'pomodoro';
  const isStopwatch = appMode === 'stopwatch';

  document.getElementById('offset-area').classList.toggle('hidden', !isStopwatch);
  document.getElementById('vibrate-area').classList.toggle('hidden', !isStopwatch);
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
