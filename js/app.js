// ── State ──
let appMode = localStorage.getItem('app_mode') || 'stopwatch';

// ── Initialize IndexedDB for history (async, non-blocking) ──
History.init().catch(e => console.error('History DB init failed:', e));

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
try {
  const flowState = JSON.parse(localStorage.getItem('flow_state') || 'null');
  if (flowState) Flow.loadState(flowState);
  const flowConfig = JSON.parse(localStorage.getItem('flow_config') || 'null');
  if (flowConfig) Flow.configure(flowConfig);
} catch (e) {
  localStorage.removeItem('flow_state');
  localStorage.removeItem('flow_config');
}

// ── Initialize modules ──
Themes.init();
Presets.init();
OffsetInput.init();
Analog.init();
UI.init();
CardsUI.init();
PresetsUI.init();
initAppMode();
initTimerUI();
initPomodoroUI();
initFlowUI();
initIntervalUI();
initCookingUI();
initAlertUI();
initSoundToggle();
initThemePicker();
initSequenceUI();
initHistoryPanel();
initAnalyticsPanel();
initExportButton();
document.getElementById('focus-toggle').addEventListener('click', () => FocusUI.enter());

// Tempo shell navigation (pillars + sub-nav + hash routing).
// Must run AFTER initAppMode — the sub-nav buttons are the old .mode-tab
// elements, already wired to switchAppMode, and TempoNav only decorates
// them. PWA `?mode=X` shortcuts are remapped inside
// TempoNav.migrateLegacyQuery, so the legacy handler that lived here has
// moved out. switchAppMode is exposed on window so TempoNav can dispatch
// mode changes when a hash route is applied.
window.switchAppMode = switchAppMode;
TempoNav.init();
MedsUI.init();

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
    <span>Install Tempo for quick access</span>
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
  stopFlowRenderLoop();
  stopIntervalRenderLoop();
  stopCookingRenderLoop();

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
  const isFlow = appMode === 'flow';
  const isStopwatch = appMode === 'stopwatch';
  const isInterval = appMode === 'interval';
  const isCooking = appMode === 'cooking';

  document.getElementById('offset-area').classList.toggle('hidden', !isStopwatch);
  document.getElementById('vibrate-area').classList.toggle('hidden', !isStopwatch);
  document.getElementById('alert-area').classList.toggle('hidden', !isStopwatch);
  document.getElementById('timer-set-area').classList.toggle('hidden', !isTimer || sequenceMode);
  document.getElementById('seq-mode-area').classList.toggle('hidden', !isTimer);
  document.getElementById('sequence-area').classList.toggle('hidden', !isTimer || !sequenceMode);
  document.getElementById('pomodoro-area').classList.toggle('hidden', !isPomodoro);
  document.getElementById('pomodoro-lists').classList.toggle('hidden', !isPomodoro);
  document.getElementById('flow-area').classList.toggle('hidden', !isFlow);
  document.getElementById('interval-area').classList.toggle('hidden', !isInterval);
  document.getElementById('cooking-area').classList.toggle('hidden', !isCooking);
  document.getElementById('timer-progress').classList.toggle('hidden',
    isStopwatch || isCooking
    || (isTimer && Timer.getStatus() === 'idle')
    || (isPomodoro && Pomodoro.getStatus() === 'idle')
    || (isFlow && (Flow.getStatus() === 'idle' || Flow.getStatus() === 'focusComplete' || Flow.getStatus() === 'done'))
    || (isInterval && Interval.getStatus() === 'idle'));
  document.querySelector('.mode-toggle').classList.toggle('hidden', !isStopwatch);
  document.getElementById('export-area').classList.toggle('hidden', !isStopwatch);
  document.getElementById('lap-stats').classList.toggle('hidden', !isStopwatch);
  document.getElementById('lap-section').classList.toggle('hidden', !isStopwatch);
  document.getElementById('lap-chart').classList.toggle('hidden', !isStopwatch);
  document.getElementById('timer-display').classList.toggle('hidden', isCooking);
  document.getElementById('controls').classList.toggle('hidden', isCooking);

  document.getElementById('instance-cards').classList.toggle('hidden', isPomodoro || isFlow || isInterval || isCooking);

  if (isTimer) {
    updateTimerUI();
  } else if (isPomodoro) {
    updatePomodoroUI();
  } else if (isFlow) {
    updateFlowUI();
    const st = Flow.getStatus();
    if (st === 'running' || st === 'recovery') startFlowRenderLoop();
  } else if (isInterval) {
    updateIntervalUI();
  } else if (isCooking) {
    renderCookingTimers();
    const anyRunning = cookingTimers.some(ct => ct.timer.getStatus() === 'running');
    if (anyRunning) startCookingRenderLoop();
  } else {
    UI.syncUI();
  }

  CardsUI.render();
  PresetsUI.updateQuickVisibility();
}

// ── Sound Toggle ──
function initSoundToggle() {
  const btn = document.getElementById('sound-toggle');
  const icon = document.getElementById('sound-icon');
  const picker = document.getElementById('sound-picker');
  updateSoundIcon();

  btn.addEventListener('click', () => {
    SFX.toggleMute();
    updateSoundIcon();
    if (!SFX.isMuted()) SFX.playLap();
  });

  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    picker.classList.toggle('hidden');
    if (!picker.classList.contains('hidden')) renderSoundPicker();
  });

  // Long-press for mobile
  let pressTimer = null;
  btn.addEventListener('touchstart', () => {
    pressTimer = setTimeout(() => {
      pressTimer = null;
      picker.classList.toggle('hidden');
      if (!picker.classList.contains('hidden')) renderSoundPicker();
    }, 500);
  }, { passive: true });
  btn.addEventListener('touchend', () => {
    if (pressTimer) clearTimeout(pressTimer);
  }, { passive: true });

  function updateSoundIcon() {
    icon.textContent = SFX.isMuted() ? '\u{1F507}' : '\u{1F50A}';
  }

  function renderSoundPicker() {
    const profiles = SFX.getProfiles();
    const current = SFX.getProfile();
    picker.innerHTML = profiles.map(p =>
      `<button class="theme-option ${p.id === current ? 'theme-option-active' : ''}" data-profile="${p.id}">${p.name}</button>`
    ).join('');
    picker.querySelectorAll('.theme-option').forEach(btn => {
      btn.addEventListener('click', () => {
        SFX.setProfile(btn.dataset.profile);
        renderSoundPicker();
        SFX.playStart();
      });
    });
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
  PresetsUI.updateQuickVisibility();
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
