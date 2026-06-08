// ── Pomodoro UI ──
let pomodoroRafId = null;
let autoAdvance = localStorage.getItem('pomo_auto_advance') === '1';
let autoAdvanceTimer = null;

// Backlog #3: ambient noise profile for Pomodoro work phases. Empty
// string (or any unrecognized value) means "off". Persisted under its
// own key so Flow can pick a different default without overriding.
// Only fires during the 'work' phase — short / long breaks stay
// quiet by design (the break is meant to disengage from focus mode).
const POMO_AMBIENT_PROFILE_KEY = 'pomodoro_ambient_profile';
let pomoAmbientProfile = localStorage.getItem(POMO_AMBIENT_PROFILE_KEY) || '';

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
    // Backlog #3: reflect current ambient profile in the dropdown so
    // the user sees what's actually set (rather than always landing
    // on "Off" until they re-pick).
    const ambientSel = document.getElementById('pomo-ambient-profile');
    if (ambientSel) ambientSel.value = pomoAmbientProfile;
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

    // Backlog #3: persist the ambient profile alongside the work /
    // break / cycles config so a single Save click commits the whole
    // session intent. Apply mid-session too — if the user changes the
    // profile while a work phase is running, swap the playing source.
    const ambientSel = document.getElementById('pomo-ambient-profile');
    if (ambientSel) {
      pomoAmbientProfile = ambientSel.value || '';
      localStorage.setItem(POMO_AMBIENT_PROFILE_KEY, pomoAmbientProfile);
      const st = Pomodoro.getStatus();
      const phase = Pomodoro.getPhase();
      if ((st === 'running' || st === 'overflowing') && phase === 'work') {
        if (pomoAmbientProfile) SFX.startAmbient(pomoAmbientProfile);
        else SFX.stopAmbient();
      }
    }

    savePomodoroState();
    updatePomodoroUI();
    settingsPanel.setAttribute('data-collapsed', '');
    settingsToggle.classList.remove('hidden');
  });

  // Phase complete callback
  Pomodoro.onPhaseComplete((completedPhase) => {
    // Backlog #3: stop ambient noise the moment a work phase ends.
    // Breaks are meant for disengagement; the noise was an aid for
    // focused work. If the user wants noise during breaks too, that's
    // a follow-up (per-phase profiles).
    if (completedPhase === 'work') SFX.stopAmbient();
    SFX.playAlarm();
    Platform.haptic([200, 100, 200, 100, 200]);
    const label = completedPhase === 'work' ? 'Work session complete! Time for a break.' : 'Break is over! Time to focus.';
    Platform.notify('Pomodoro', { body: label });
    announce(label); // D: SR parity with the chime/notification
    savePomodoroState();
    updatePomodoroUI();

    // Auto-advance: start 3s countdown then advance
    if (autoAdvance && completedPhase !== 'longBreak') {
      startAutoAdvanceCountdown();
    }
  });

  // Wire "← Go back" phase-revert link
  const goBackBtn = document.getElementById('pomo-go-back');
  if (goBackBtn) {
    goBackBtn.addEventListener('click', () => {
      cancelAutoAdvance();
      Pomodoro.revertPhase();
      savePomodoroState();
      updatePomodoroUI();
    });
  }

  // Wire auto-advance toggle
  const autoAdvBtn = document.getElementById('pomo-auto-advance-toggle');
  if (autoAdvBtn) {
    updateAutoAdvanceLabel();
    autoAdvBtn.addEventListener('click', () => {
      autoAdvance = !autoAdvance;
      localStorage.setItem('pomo_auto_advance', autoAdvance ? '1' : '0');
      updateAutoAdvanceLabel();
    });
  }

  function updateAutoAdvanceLabel() {
    if (autoAdvBtn) {
      autoAdvBtn.textContent = autoAdvance ? 'Auto: On' : 'Auto: Off';
      autoAdvBtn.classList.toggle('offset-link-active', autoAdvance);
    }
  }

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

  // Init actions drawer, saved tasks, templates, distraction log
  initActionsDrawer();
  initSavedTasksPanel();
  initTaskTemplates();
  initDistractionLog();
  // BFRB tally now lives on the global floating button (js/global-bfrb.js).
  // The helper still writes to pomodoro_bfrbs when Pomodoro work is running,
  // so gatherTaskData() picks up per-session catches below.

  // Stats panel — D: modal-dialog focus management via the shared helper.
  const statsPanel = document.getElementById('pomo-stats-panel');
  const closeStats = () => { if (statsPanel) { statsPanel.classList.add('hidden'); closeModal(statsPanel); } };
  document.getElementById('pomodoro-stats-toggle')?.addEventListener('click', () => {
    if (!statsPanel) return;
    if (statsPanel.classList.contains('hidden')) {
      statsPanel.classList.remove('hidden');
      renderPomodoroStats();
      openModal(statsPanel, { label: 'Pomodoro stats', onClose: closeStats });
    } else {
      closeStats();
    }
  });
  document.getElementById('pomo-stats-close')?.addEventListener('click', closeStats);

  // Keyboard shortcuts for Pomodoro mode
  document.addEventListener('keydown', (e) => {
    if (appMode !== 'pomodoro') return;
    if (isTextEntry(e.target)) return;
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
        if (status === 'overflowing') {
          e.preventDefault();
          onPomodoroRight();
        }
        break;
    }
  });

  // Restore render loop if needed
  const initStatus = Pomodoro.getStatus();
  if ((initStatus === 'running' || initStatus === 'overflowing') && appMode === 'pomodoro') {
    startPomodoroRenderLoop();
  }
  if ((initStatus === 'overflowing' || initStatus === 'done') && appMode === 'pomodoro') {
    updatePomodoroUI();
  }
}

function startAutoAdvanceCountdown() {
  cancelAutoAdvance();
  let remaining = 3;
  const overlay = document.getElementById('auto-advance-overlay');
  if (overlay) {
    overlay.textContent = `Next in ${remaining}...`;
    overlay.classList.remove('hidden');
  }
  autoAdvanceTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      cancelAutoAdvance();
      if (Pomodoro.getStatus() === 'overflowing') {
        onPomodoroRight();
      }
    } else if (overlay) {
      overlay.textContent = `Next in ${remaining}...`;
    }
  }, 1000);
}

function cancelAutoAdvance() {
  if (autoAdvanceTimer) {
    clearInterval(autoAdvanceTimer);
    autoAdvanceTimer = null;
  }
  const overlay = document.getElementById('auto-advance-overlay');
  if (overlay) overlay.classList.add('hidden');
}

// A8: the completed-session write was duplicated inline in onPomodoroRight's
// done branch and MISSING from onPomodoroLeft's (Skip) done branch — so
// skipping the final phase's overflow advanced to 'done' WITHOUT logging the
// session. Extracted so both Skip and Break/Work write the identical record and
// can't drift again.
function logPomodoroDoneSession() {
  const cfg = Pomodoro.getConfig();
  const phaseLog = Pomodoro.getPhaseLog ? Pomodoro.getPhaseLog() : [];
  const totalOvershoot = phaseLog.reduce((sum, p) => sum + (p.overshootMs || 0), 0);
  History.addSession({
    type: 'pomodoro', duration: getPomodoroTotalDuration(), laps: [],
    completedCycles: cfg.totalCycles,
    totalWorkMs: cfg.totalCycles * cfg.workMs,
    overshootMs: totalOvershoot,
    ...gatherTaskData(),
    ...gatherTimingData(),
  });
}

function onPomodoroLeft() {
  if (appMode !== 'pomodoro') return;
  if (pomodoroClickLock) return;
  pomodoroClickLock = true;
  setTimeout(() => { pomodoroClickLock = false; }, 100);
  cancelAutoAdvance();

  const status = Pomodoro.getStatus();
  if (status === 'paused') {
    // Save session before reset.
    // Capture sessionId BEFORE Pomodoro.reset() clears it (E-1d-f8 audit Risk #3).
    const sessionIdToClear = Pomodoro.getSessionStartedAt();
    const elapsed = Pomodoro.getElapsedMs();
    if (elapsed > 1000) {
      const cfg = Pomodoro.getConfig();
      History.addSession({
        type: 'pomodoro', duration: elapsed, laps: [],
        completedCycles: Pomodoro.getCycleIndex(),
        totalWorkMs: Pomodoro.getCycleIndex() * cfg.workMs,
        overshootMs: 0,
        ...gatherTaskData(),
        ...gatherTimingData(),
      });
    }
    Pomodoro.reset();
    // Backlog #3: defensive stop on explicit Reset gesture — covers
    // any reset path where ambient might still be running (e.g.,
    // resetting from work phase directly).
    SFX.stopAmbient();
    BgNotify.cancel('pomodoro');
    savePomodoroState();
    if (typeof Distractions !== 'undefined' && sessionIdToClear != null) {
      Distractions.clearSession('pomodoro', sessionIdToClear);
    }
    savePomoBFRBs([]);
    renderChecklist();
    renderBreakChecklist();
    renderActualWork();
    SFX.playReset();
    updatePomodoroUI();
  } else if (status === 'overflowing') {
    // Skip — advance to next phase (overshoot already captured into phaseLog by
    // the engine's nextPhase()). Unlike Break/Work (right), Skip intentionally
    // does NOT auto-start the next phase — it advances and waits for the user.
    Pomodoro.nextPhase();
    // A8: but if Skip advanced the FINAL phase to 'done', still write the
    // session — previously this path reached 'done' without logging, losing
    // the record that the Break/Work path writes.
    if (Pomodoro.getStatus() === 'done') logPomodoroDoneSession();
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
  cancelAutoAdvance();

  const status = Pomodoro.getStatus();
  if (status === 'running') {
    stopPomodoroRenderLoop();
    Pomodoro.pause();
    // Backlog #3: pause ambient alongside the timer.
    SFX.stopAmbient();
    BgNotify.cancel('pomodoro');
    savePomodoroState();
    SFX.playStop();
    updatePomodoroUI();
  } else if (status === 'idle' || status === 'paused') {
    Pomodoro.start();
    const phase = Pomodoro.getPhase();
    // Backlog #3: auto-start ambient ONLY during the work phase —
    // breaks stay quiet. Covers both fresh start (idle → work) and
    // resume-from-pause (paused → running, phase preserved).
    if (pomoAmbientProfile && phase === 'work') {
      SFX.startAmbient(pomoAmbientProfile);
    }
    const phaseLabel = phase === 'work' ? 'Work session complete!' : 'Break is over!';
    BgNotify.schedule('pomodoro', Pomodoro.getRemainingMs(), 'Pomodoro', phaseLabel);
    savePomodoroState();
    SFX.playStart();
    startPomodoroRenderLoop();
    updatePomodoroUI();
  } else if (status === 'overflowing') {
    // Capture overshoot before advancing — the engine sums it into the most
    // recent phaseLog entry inside nextPhase(), but we still want it on the
    // session record at end-of-cycle (sum of all phaseLog overshoots).
    Pomodoro.nextPhase();
    if (Pomodoro.getStatus() === 'done') {
      logPomodoroDoneSession();
      savePomodoroState();
      updatePomodoroUI();
      return;
    }
    Pomodoro.start();
    // Backlog #3: now that the phase has advanced, kick the ambient
    // path: start if entering work, ensure stopped if entering break.
    // Covers both manual Skip (overflowing → next) and auto-advance.
    const newPhase = Pomodoro.getPhase();
    if (pomoAmbientProfile && newPhase === 'work') {
      SFX.startAmbient(pomoAmbientProfile);
    } else {
      SFX.stopAmbient();
    }
    savePomodoroState();
    SFX.playStart();
    startPomodoroRenderLoop();
    updatePomodoroUI();
  } else if (status === 'done') {
    // Capture sessionId BEFORE Pomodoro.reset() clears it (E-1d-f8 audit Risk #3).
    const sessionIdToClear = Pomodoro.getSessionStartedAt();
    Pomodoro.reset();
    savePomodoroState();
    if (typeof Distractions !== 'undefined' && sessionIdToClear != null) {
      Distractions.clearSession('pomodoro', sessionIdToClear);
    }
    savePomoBFRBs([]);
    renderChecklist();
    renderBreakChecklist();
    renderActualWork();
    updatePomodoroUI();
  }
}

// B1: the cheap per-frame painter. Only the time readout, progress fill, and
// the overshoot flash/steady-amber classes change every RAF frame — everything
// else (dots, timeline + its localStorage/toLocaleTimeString reads, checklists,
// buttons, labels) changes only on a phase/status transition. The RAF loop
// calls this on non-transition frames and the full updatePomodoroUI() only when
// the status actually changes. updatePomodoroUI() also delegates these bits here
// so the two can't drift.
function paintPomodoroFrame() {
  if (appMode !== 'pomodoro') return;
  const status = Pomodoro.getStatus();
  const isOver = status === 'overflowing';
  const overshootMs = isOver && Pomodoro.getOvershootMs ? Pomodoro.getOvershootMs() : 0;
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
    const t = Utils.formatMs(Pomodoro.getRemainingMs());
    timeEl.innerHTML = (t.hours > 0)
      ? `${t.hours}:${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`
      : `${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`;
  }

  if (progressBar && progressFill) {
    if (status !== 'idle' && status !== 'done') {
      progressBar.classList.remove('hidden');
      progressFill.style.width = `${Pomodoro.getProgress() * 100}%`;
    } else {
      progressBar.classList.add('hidden');
    }
  }

  if (timerDisplay) {
    // First ~3s of overshoot reuse the flash-red animation, then settle to
    // steady amber — both thresholds are crossed mid-overflow (same status), so
    // they belong in the per-frame painter.
    timerDisplay.classList.toggle('pomodoro-phase-complete', isOver && overshootMs <= 3000);
    timerDisplay.classList.toggle('overshoot', isOver && overshootMs > 1000);
  }
}

function updatePomodoroUI() {
  if (appMode !== 'pomodoro') return;

  const status = Pomodoro.getStatus();
  const isOver = status === 'overflowing';
  const phase = Pomodoro.getPhase();
  const remaining = Pomodoro.getRemainingMs();
  const overshootMs = isOver && Pomodoro.getOvershootMs ? Pomodoro.getOvershootMs() : 0;
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

  // Timeline and distraction button
  renderPomodoroTimeline();
  updateDistractionBtnVisibility();

  // Time readout + progress fill + overshoot flash — the per-frame bits, shared
  // with the RAF loop's non-transition path so they can't drift (B1).
  paintPomodoroFrame();

  // Break color (phase/status-derived → only changes on a transition).
  timerDisplay.classList.toggle('pomodoro-break', phase !== 'work' && status === 'running');
  timerDisplay.classList.remove('timer-finished');

  // Running indicator
  timerDisplay.classList.toggle('is-running', status === 'running');
  appEl.classList.toggle('is-running', status === 'running');

  // Settings visibility (settings are idle-only — durations shouldn't change mid-session)
  settingsToggle.classList.toggle('hidden', status !== 'idle');

  // "← Go back" visibility: show only when a snapshot exists AND session is running/paused
  const goBackBtnEl = document.getElementById('pomo-go-back');
  if (goBackBtnEl) {
    const state = Pomodoro.getState();
    const showGoBack = state.previousPhaseSnapshot !== null &&
      (status === 'running' || status === 'paused');
    goBackBtnEl.classList.toggle('hidden', !showGoBack);
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
    case 'overflowing': {
      const short = Utils.formatShort && overshootMs > 0 ? ` +${Utils.formatShort(overshootMs)}` : '';
      if (phase === 'work') {
        btnLeft.innerHTML = `<span class="btn-inner">Skip${short}</span>`;
        btnLeft.className = 'control-btn btn-reset';
        btnLeft.disabled = false;
        btnRight.innerHTML = `<span class="btn-inner">Break${short}</span>`;
        btnRight.className = 'control-btn btn-start';
      } else {
        btnLeft.innerHTML = `<span class="btn-inner">Skip${short}</span>`;
        btnLeft.className = 'control-btn btn-reset';
        btnLeft.disabled = false;
        btnRight.innerHTML = `<span class="btn-inner">Work${short}</span>`;
        btnRight.className = 'control-btn btn-start';
      }
      break;
    }
    case 'done':
      btnLeft.innerHTML = '<span class="btn-inner">--</span>';
      btnLeft.className = 'control-btn btn-lap';
      btnLeft.disabled = true;
      btnRight.innerHTML = '<span class="btn-inner">Reset</span>';
      btnRight.className = 'control-btn btn-start';
      break;
  }

  if (typeof updateTimeAdjustControls === 'function') updateTimeAdjustControls();
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
    const st = Pomodoro.getStatus();
    if (st === 'running' || st === 'overflowing') {
      Pomodoro.checkFinished();
      const after = Pomodoro.getStatus();
      // B1: a full structural update (dots, timeline, checklists, buttons, the
      // toLocaleTimeString/localStorage reads) only when the status actually
      // changed (e.g. running → overflowing). Otherwise just the cheap painter.
      if (after !== st) updatePomodoroUI();
      else paintPomodoroFrame();
      if (after === 'running' || after === 'overflowing') {
        pomodoroRafId = requestAnimationFrame(tick);
      } else {
        pomodoroRafId = null;
        Platform.keepAwake(false); // F-pwa
        updatePomodoroUI(); // settle the final structural state
      }
    } else {
      pomodoroRafId = null;
      Platform.keepAwake(false); // F-pwa
    }
  }
  Platform.keepAwake(true); // F-pwa: keep screen on while timing
  pomodoroRafId = requestAnimationFrame(tick);
}

function stopPomodoroRenderLoop() {
  if (pomodoroRafId !== null) {
    cancelAnimationFrame(pomodoroRafId);
    pomodoroRafId = null;
  }
  Platform.keepAwake(false); // F-pwa
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
      <button class="pomo-checklist-item-save" data-save-idx="${i}" title="Save for later">&#x1F4CC;</button>
      <button class="pomo-checklist-item-delete" data-del-idx="${i}">&times;</button>
    </div>`
  ).join('');

  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const idx = parseInt(cb.dataset.checkIdx, 10);
      const items = loadFn();
      if (items[idx]) {
        items[idx].done = cb.checked;
        // bl-2-todoist: write-back to Todoist for items that carry a
        // todoistId. Fire-and-forget — the engine auto-enqueues on
        // network failure, and close/reopen are idempotent so retries
        // are safe. The user's local action completes regardless.
        if (items[idx].todoistId && typeof Todoist !== 'undefined') {
          if (cb.checked) {
            Todoist.closeTask(items[idx].todoistId).catch(() => {});
          } else {
            Todoist.reopenTask(items[idx].todoistId).catch(() => {});
          }
        }
        saveFn(items);
        renderChecklistInto(containerId, loadFn, saveFn);
      }
    });
  });

  container.querySelectorAll('.pomo-checklist-item-save').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.saveIdx, 10);
      const items = loadFn();
      if (items[idx]) {
        // bl-2-todoist: forward todoistId / localTag so the saved-tasks
        // row keeps its Todoist link after "pin for later".
        const extras = {};
        if (items[idx].todoistId) extras.todoistId = items[idx].todoistId;
        if (items[idx].localTag) extras.localTag = items[idx].localTag;
        saveTaskForLater(items[idx].text, extras);
        items.splice(idx, 1);
        saveFn(items);
        renderChecklistInto(containerId, loadFn, saveFn);
        renderSavedTasks();
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
  // bl-2-todoist: Todoist write-back is scoped to the FOCUS checklist only.
  // The break-checklist input shares this handler factory but break tasks
  // are local-only — they must not pollute the user's actual Todoist list.
  const createsTodoistTasks = (inputId === 'pomo-checklist-input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const items = loadFn();
      const newItem = { text, done: false };
      // bl-2-todoist: when a token is configured AND this is the focus
      // checklist input, create a Todoist task alongside the local one
      // and stamp the returned id on success. localTag correlates the
      // late-stamp event (from the offline-queue drain) back to this
      // specific local item even if the user adds more items before the
      // queue drains.
      if (createsTodoistTasks && typeof Todoist !== 'undefined' && Todoist.hasToken()) {
        const localTag = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
          ? 'pomo-' + crypto.randomUUID()
          : 'pomo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        newItem.localTag = localTag;
        Todoist.createTask({ content: text, localTag }).then(result => {
          if (result && result.ok && result.data &&
              typeof result.data.id !== 'undefined') {
            _stampTodoistIdByLocalTag(localTag, String(result.data.id));
          }
        }).catch(() => {});
      }
      items.push(newItem);
      saveFn(items);
      input.value = '';
      renderFn();
    }
  });
}

// bl-2-todoist: late-stamp helper. Walks the three lists that can carry
// a `localTag` (focus checklist + break checklist + saved tasks; the
// actual-work list is still a flat string[] and cannot carry a localTag)
// and stamps the Todoist id on every matching entry. Persists + re-renders
// any list that changed. Called from both:
//   - the synchronous createTask success path (one local item)
//   - the `todoist:create-resolved` window event (offline-queue drain)
// Idempotent: only touches entries whose localTag matches AND that don't
// already have a todoistId. Stamps EVERY match (not just the first) so a
// task that's been pinned-then-+Focused before the create response lands
// gets stamped on both the saved-task entry and the checklist copy.
function _stampTodoistIdByLocalTag(localTag, todoistId) {
  if (!localTag || !todoistId) return;
  let dirty = false;

  function walk(loadList, saveList, renderList) {
    const list = loadList();
    let changed = false;
    for (const item of list) {
      if (item && item.localTag === localTag && !item.todoistId) {
        item.todoistId = todoistId;
        delete item.localTag;
        changed = true;
      }
    }
    if (changed) {
      saveList(list);
      try { renderList(); } catch (_) {}
      dirty = true;
    }
  }

  walk(loadChecklist, saveChecklist, renderChecklist);
  walk(loadBreakChecklist, saveBreakChecklist, renderBreakChecklist);
  walk(loadSavedTasks, saveSavedTasks, renderSavedTasks);

  return dirty;
}

// bl-2-todoist: subscribe once at module load to the offline-queue's
// create-resolved event. The engine emits this when a queued createTask
// finally lands successfully (after the device comes back online or the
// tab regains visibility). The detail payload carries the localTag the
// caller stamped at enqueue time + the new Todoist id.
if (typeof window !== 'undefined') {
  window.addEventListener('todoist:create-resolved', (e) => {
    if (!e || !e.detail) return;
    const { localTag, todoistId } = e.detail;
    if (localTag && todoistId) {
      _stampTodoistIdByLocalTag(String(localTag), String(todoistId));
    }
  });
}

function updateChecklistVisibility() {
  // All three lists are always visible so users can add/manage tasks at any time
  document.getElementById('pomo-checklist').classList.remove('hidden');
  document.getElementById('pomo-actual-work').classList.remove('hidden');
  document.getElementById('pomo-break-checklist').classList.remove('hidden');
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
      <button class="pomo-checklist-item-save" data-save-idx="${i}" title="Save for later">&#x1F4CC;</button>
      <button class="pomo-checklist-item-delete" data-del-idx="${i}">&times;</button>
    </div>`
  ).join('');

  container.querySelectorAll('.pomo-checklist-item-save').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.saveIdx, 10);
      const items = loadActualWork();
      if (items[idx]) {
        saveTaskForLater(items[idx]);
        items.splice(idx, 1);
        saveActualWork(items);
        renderActualWork();
        renderSavedTasks();
      }
    });
  });

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

// ── Saved Tasks (Save for Later) ──
const SAVED_TASKS_KEY = 'pomodoro_saved_tasks';

// bl-2-todoist: shape migration `pomodoro_saved_tasks`: `string[]` →
// `Array<{ text, todoistId? }>`. Applied as read-time coercion so legacy
// flat-string entries surface as `{ text }` objects without a one-shot
// migration pass. Idempotent — object entries pass through unchanged.
// No `SCHEMA_VERSION` bump (non-synced store; auditor verified).
function loadSavedTasks() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_TASKS_KEY)) || [];
    return raw.map(item =>
      typeof item === 'string' ? { text: item } : item
    );
  } catch (e) { return []; }
}

function saveSavedTasks(items) {
  localStorage.setItem(SAVED_TASKS_KEY, JSON.stringify(items));
}

// bl-2-todoist: saved tasks now persist as `{ text, todoistId? }` objects.
// Includes-dedupe matches on `.text` only (todoistId is metadata; two
// saved-tasks rows with the same text should still collapse to one).
function saveTaskForLater(text, extras) {
  const items = loadSavedTasks();
  const exists = items.some(it => it && it.text === text);
  if (!exists) {
    const entry = { text };
    if (extras && extras.todoistId) entry.todoistId = extras.todoistId;
    if (extras && extras.localTag) entry.localTag = extras.localTag;
    items.push(entry);
    saveSavedTasks(items);
  }
}

function renderSavedTasks() {
  const container = document.getElementById('pomo-saved-tasks-items');
  if (!container) return;
  const items = loadSavedTasks();
  if (items.length === 0) {
    container.innerHTML = '<div class="pomo-saved-empty">No saved tasks</div>';
    return;
  }
  // bl-2-todoist: items are now `{ text, todoistId? }` objects after the
  // shape migration. Render via `.text`. NO visual marker on imported
  // tasks per brief decision #1 — imported and local tasks look identical.
  // todoist-pomo-rename: the saved-task text span carries a saved-task-only
  // hook (`data-saved-rename-idx`) so the inline-rename wiring below targets
  // ONLY these rows — never the shared `.pomo-checklist-item-text` class,
  // which is also rendered by the focus/break/actual-work/template lists.
  container.innerHTML = items.map((item, i) =>
    `<div class="pomo-saved-task-item">
      <span class="pomo-checklist-item-text" data-saved-rename-idx="${i}" title="Click to rename" aria-label="Saved task. Click to rename.">${escapeChecklistHtml(item.text)}</span>
      <button class="pomo-saved-task-add" data-saved-idx="${i}" title="Add to focus goals">+Focus</button>
      <button class="pomo-saved-task-add-break" data-saved-idx="${i}" title="Add to break tasks">+Break</button>
      <button class="pomo-checklist-item-delete" data-saved-del="${i}">&times;</button>
    </div>`
  ).join('');

  container.querySelectorAll('.pomo-saved-task-add').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.savedIdx, 10);
      const items = loadSavedTasks();
      if (items[idx]) {
        const checklist = loadChecklist();
        // bl-2-todoist: propagate todoistId + localTag from saved task to
        // checklist item so check/uncheck writes through to Todoist AND
        // late-stamping (from an in-flight createTask) lands on this copy
        // as well as the saved-tasks entry.
        const entry = { text: items[idx].text, done: false };
        if (items[idx].todoistId) entry.todoistId = items[idx].todoistId;
        if (items[idx].localTag) entry.localTag = items[idx].localTag;
        checklist.push(entry);
        saveChecklist(checklist);
        renderChecklist();
      }
    });
  });

  container.querySelectorAll('.pomo-saved-task-add-break').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.savedIdx, 10);
      const items = loadSavedTasks();
      if (items[idx]) {
        const checklist = loadBreakChecklist();
        // bl-2-todoist: propagate todoistId + localTag to break checklist
        // (same reasoning as the focus path above).
        const entry = { text: items[idx].text, done: false };
        if (items[idx].todoistId) entry.todoistId = items[idx].todoistId;
        if (items[idx].localTag) entry.localTag = items[idx].localTag;
        checklist.push(entry);
        saveBreakChecklist(checklist);
        renderBreakChecklist();
      }
    });
  });

  container.querySelectorAll('[data-saved-del]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.savedDel, 10);
      const items = loadSavedTasks();
      // bl-2-todoist hard guard: delete in Tempo NEVER deletes in Todoist.
      // We simply discard the array entry; the local todoistId goes with
      // it. NO Todoist.* call here — by design.
      items.splice(idx, 1);
      saveSavedTasks(items);
      renderSavedTasks();
    });
  });

  // todoist-pomo-rename: inline click-to-edit rename, scoped to saved-task
  // rows only (via `data-saved-rename-idx`). Click → contentEditable; Enter
  // commits (no newline); Escape cancels (restore original); blur commits.
  // On commit: read textContent, trim, strip newlines → empty-or-unchanged
  // reverts with NO write/Todoist call; else persist `text` + (for linked,
  // already-stamped tasks) fire-and-forget `Todoist.updateTask`, then
  // re-render LAST (so we never read from the about-to-be-replaced node).
  container.querySelectorAll('[data-saved-rename-idx]').forEach(span => {
    let original = '';
    let cancelled = false;

    span.addEventListener('click', () => {
      if (span.getAttribute('contenteditable') === 'true') return;
      original = span.textContent;
      cancelled = false;
      span.contentEditable = 'true';
      span.focus();
      // select-all the span contents so a fresh type replaces the text
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(span);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });

    span.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        span.blur(); // commit
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelled = true;
        span.textContent = original; // restore before blur fires
        span.blur(); // cancel
      }
    });

    span.addEventListener('blur', () => {
      if (span.getAttribute('contenteditable') !== 'true') return;
      span.contentEditable = 'false';
      // Escape path already restored textContent — do not commit.
      if (cancelled) {
        cancelled = false;
        span.textContent = original;
        return;
      }
      // Read PLAIN text (never innerHTML), trim, collapse any newlines to a
      // single space before persisting.
      const newText = span.textContent.trim().replace(/\s*\n\s*/g, ' ');
      const oldText = original.trim();
      if (!newText || newText === oldText) {
        // empty or unchanged → revert, no write, no Todoist call.
        span.textContent = original;
        return;
      }
      const idx = parseInt(span.dataset.savedRenameIdx, 10);
      const items = loadSavedTasks();
      if (!items[idx]) { renderSavedTasks(); return; }
      items[idx].text = newText;
      saveSavedTasks(items);
      // Write-back only for tasks already linked to Todoist (DECISION 4: a
      // mid-create item carries `localTag` but no `todoistId` yet → local
      // only). Fire-and-forget — the engine auto-enqueues on failure and
      // re-sending the same content is idempotent.
      if (items[idx].todoistId && !items[idx].localTag && typeof Todoist !== 'undefined') {
        Todoist.updateTask(items[idx].todoistId, { content: newText }).catch(() => {});
      }
      renderSavedTasks(); // re-render LAST; never touch `span` after this.
    });
  });
}

function initSavedTasksPanel() {
  const toggle = document.getElementById('pomo-saved-tasks-toggle');
  const panel = document.getElementById('pomo-saved-tasks');
  if (!toggle || !panel) return;

  toggle.addEventListener('click', () => {
    const isHidden = panel.classList.toggle('hidden');
    if (!isHidden) renderSavedTasks();
  });

  // bl-2-todoist: "Import from Todoist" button on the saved-tasks panel.
  // Opens the shared picker modal; on selection, append the chosen tasks
  // to the saved-tasks list with their Todoist ids attached. The picker
  // surfaces its own error state if no token is configured.
  const importBtn = document.getElementById('pomo-import-todoist');
  if (importBtn && typeof TodoistUI !== 'undefined') {
    importBtn.addEventListener('click', () => {
      TodoistUI.openPicker({
        onImport: (tasks) => {
          if (!Array.isArray(tasks) || tasks.length === 0) return;
          const items = loadSavedTasks();
          for (const t of tasks) {
            if (!t || typeof t.content !== 'string') continue;
            // De-dupe by Todoist id (re-import of same Todoist task) OR by
            // text when no local entry has a Todoist id yet (the user pinned
            // 'Write tests' locally and is now importing the matching
            // Todoist task — should link, not duplicate).
            const tid = t.id ? String(t.id) : null;
            const existingByTid = tid && items.some(it => it && it.todoistId === tid);
            if (existingByTid) continue;
            const existingByText = items.some(it =>
              it && it.text === t.content && !it.todoistId
            );
            if (existingByText && tid) {
              // Link the existing local entry instead of appending a dupe.
              for (const it of items) {
                if (it && it.text === t.content && !it.todoistId) {
                  it.todoistId = tid;
                  break;
                }
              }
              continue;
            }
            if (existingByText) continue;
            const entry = { text: t.content };
            if (tid) entry.todoistId = tid;
            items.push(entry);
          }
          saveSavedTasks(items);
          renderSavedTasks();
        },
      });
    });
  }
}

// ── Task Templates ──
const TASK_TEMPLATES_KEY = 'pomodoro_task_templates';

function loadTaskTemplates() {
  try { return JSON.parse(localStorage.getItem(TASK_TEMPLATES_KEY)) || []; }
  catch (e) { return []; }
}

function saveTaskTemplates(templates) {
  localStorage.setItem(TASK_TEMPLATES_KEY, JSON.stringify(templates));
}

function renderTaskTemplates() {
  const container = document.getElementById('pomo-task-templates');
  if (!container) return;
  const templates = loadTaskTemplates();
  if (templates.length === 0) {
    container.innerHTML = '<div class="pomo-saved-empty">No templates saved</div>';
    return;
  }
  container.innerHTML = templates.map((tpl, i) =>
    `<div class="pomo-template-item">
      <span class="pomo-checklist-item-text">${escapeChecklistHtml(tpl.name)}</span>
      <button class="pomo-saved-task-add" data-tpl-load="${i}">Load</button>
      <button class="pomo-checklist-item-delete" data-tpl-del="${i}">&times;</button>
    </div>`
  ).join('');

  container.querySelectorAll('[data-tpl-load]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.tplLoad, 10);
      const tpl = loadTaskTemplates()[idx];
      if (!tpl) return;
      // Load focus goals
      if (Array.isArray(tpl.focusGoals)) {
        const items = tpl.focusGoals.map(text => ({ text, done: false }));
        saveChecklist(items);
        renderChecklist();
      }
      // Load break tasks
      if (Array.isArray(tpl.breakTasks)) {
        const items = tpl.breakTasks.map(text => ({ text, done: false }));
        saveBreakChecklist(items);
        renderBreakChecklist();
      }
    });
  });

  container.querySelectorAll('[data-tpl-del]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.tplDel, 10);
      const templates = loadTaskTemplates();
      templates.splice(idx, 1);
      saveTaskTemplates(templates);
      renderTaskTemplates();
    });
  });
}

function initTaskTemplates() {
  const saveBtn = document.getElementById('pomo-template-save-btn');
  const nameInput = document.getElementById('pomo-template-name');
  if (!saveBtn || !nameInput) return;

  saveBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) return;
    const templates = loadTaskTemplates();
    templates.push({
      name,
      focusGoals: loadChecklist().map(i => i.text),
      breakTasks: loadBreakChecklist().map(i => i.text),
    });
    saveTaskTemplates(templates);
    nameInput.value = '';
    renderTaskTemplates();
  });

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
  });

  renderTaskTemplates();
}

// ── Distraction / Interruption Log ──
// E-1d-f8: legacy helpers retained for emergency rollback only. All
// active call sites switched to Distractions.log / .getForSession /
// .clearSession (sessionId-keyed map shape). The legacy
// `pomodoro_distractions` key is preserved on disk (Pick B on TODO #2
// — cleanup deferred per Pick C on TODO #6). These helpers read/write
// the legacy flat-array shape and are no longer wired anywhere.
const DISTRACTION_LOG_KEY = 'pomodoro_distractions';

function loadDistractions() {
  try { return JSON.parse(localStorage.getItem(DISTRACTION_LOG_KEY)) || []; }
  catch (e) { return []; }
}

function saveDistractions(items) {
  localStorage.setItem(DISTRACTION_LOG_KEY, JSON.stringify(items));
}

function initDistractionLog() {
  const btn = document.getElementById('pomo-distraction-btn');
  const picker = document.getElementById('pomo-distraction-picker');
  const noteInput = document.getElementById('pomo-distraction-note');
  if (!btn || !picker) return;

  btn.addEventListener('click', () => {
    picker.classList.toggle('hidden');
    if (!picker.classList.contains('hidden') && noteInput) noteInput.value = '';
  });

  picker.querySelectorAll('.pomo-distraction-cat').forEach(catBtn => {
    catBtn.addEventListener('click', () => {
      const category = catBtn.dataset.cat;
      const note = noteInput ? noteInput.value.trim() : '';
      // E-1d-f8: routes through Distractions module (sessionId-keyed map).
      // The picker button is only visible while Pomodoro.getStatus() === 'running'
      // and phase === 'work' (see updateDistractionBtnVisibility), so
      // sessionId is guaranteed non-null at log time.
      if (typeof Distractions !== 'undefined') {
        Distractions.log({
          context: 'pomodoro',
          sessionId: Pomodoro.getSessionStartedAt(),
          category,
          note,
          phase: Pomodoro.getPhase(),
          cycleIndex: Pomodoro.getCycleIndex(),
        });
      }
      picker.classList.add('hidden');
      Platform.haptic(30);
    });
  });
}

function updateDistractionBtnVisibility() {
  const btn = document.getElementById('pomo-distraction-btn');
  if (!btn) return;
  const status = Pomodoro.getStatus();
  const phase = Pomodoro.getPhase();
  // Show during running work phases
  btn.classList.toggle('hidden', !(status === 'running' && phase === 'work'));
  // Hide picker if button hides
  if (btn.classList.contains('hidden')) {
    document.getElementById('pomo-distraction-picker')?.classList.add('hidden');
  }
}

// ── BFRB Tally (Pomodoro) ──
const POMO_BFRB_KEY = 'pomodoro_bfrbs';

function loadPomoBFRBs() {
  try { return JSON.parse(localStorage.getItem(POMO_BFRB_KEY)) || []; }
  catch (e) { return []; }
}

function savePomoBFRBs(items) {
  localStorage.setItem(POMO_BFRB_KEY, JSON.stringify(items));
}

// Per-mode BFRB button and init removed in favor of the global floating button
// (js/global-bfrb.js). E-1d-f3 consolidated BFRB writes into BfrbEvents
// (`bfrb_events` localStorage store with `context: 'pomodoro'` tag). The
// legacy `loadPomoBFRBs` / `savePomoBFRBs` helpers above are RETAINED so the
// `savePomoBFRBs([])` session-end clears keep working — the legacy
// `pomodoro_bfrbs` key stays on disk per Pick B on E-1d-f3 TODO #1 (cleanup
// deferred per Pick C on TODO #5). `loadPomoBFRBs` is no longer used for
// rendering — gatherTaskData below reads session-scoped BFRB entries from
// BfrbEvents.getByContext('pomodoro') filtered by Pomodoro.getSessionStartedAt().

// Read this Pomodoro session's BFRB entries from the consolidated store,
// converted back to the legacy-flat shape `{ timestamp, phase, cycleIndex }`
// so the saved history `session.bfrbs[]` field stays byte-equivalent (the
// analytics history-record read path in js/analytics.js:325-332 reads
// s.bfrbs as flat `{ timestamp }` objects). Audit Risk #4.
function getPomoSessionBFRBs() {
  if (typeof BfrbEvents === 'undefined') return [];
  if (typeof Pomodoro === 'undefined' || typeof Pomodoro.getSessionStartedAt !== 'function') return [];
  const sessionId = Pomodoro.getSessionStartedAt();
  if (sessionId == null) return [];
  const all = BfrbEvents.getByContext('pomodoro');
  const out = [];
  for (const e of all) {
    if (!e || e.sessionId !== sessionId) continue;
    const legacy = { timestamp: e.takenAt };
    if (typeof e.phase === 'string') legacy.phase = e.phase;
    if (typeof e.cycleIndex === 'number') legacy.cycleIndex = e.cycleIndex;
    out.push(legacy);
  }
  return out;
}

// ── Session Planning Timeline ──
function renderPomodoroTimeline() {
  const el = document.getElementById('pomo-timeline');
  if (!el) return;

  const cfg = Pomodoro.getConfig();
  const status = Pomodoro.getStatus();
  const cycleIdx = Pomodoro.getCycleIndex();
  const phase = Pomodoro.getPhase();
  const cycles = cfg.totalCycles;

  // Build phase sequence
  const phases = [];
  for (let i = 0; i < cycles; i++) {
    phases.push({ type: 'work', label: `W${i + 1}`, durationMs: cfg.workMs, cycle: i });
    if (i < cycles - 1) {
      phases.push({ type: 'shortBreak', label: 'SB', durationMs: cfg.shortBreakMs, cycle: i });
    } else {
      phases.push({ type: 'longBreak', label: 'LB', durationMs: cfg.longBreakMs, cycle: i });
    }
  }

  const totalMs = phases.reduce((s, p) => s + p.durationMs, 0);
  const now = new Date();
  const endTime = new Date(now.getTime() + totalMs - (status === 'idle' ? 0 : getElapsedTotalMs(cfg, cycleIdx, phase)));

  function getElapsedTotalMs(cfg, ci, ph) {
    // The engine increments cycleIndex at the START of a break (nextPhase),
    // so during a break `ci` already points at the NEXT work block, not the
    // one that just finished. Count fully-elapsed phases accordingly:
    //   work        → ci work blocks + ci short breaks done before it
    //   shortBreak  → ci work blocks done, (ci - 1) short breaks done
    //   longBreak   → all work blocks + all (cycles - 1) short breaks done
    let ms;
    if (ph === 'work') {
      ms = ci * cfg.workMs + ci * cfg.shortBreakMs;
    } else if (ph === 'shortBreak') {
      ms = ci * cfg.workMs + (ci - 1) * cfg.shortBreakMs;
    } else { // longBreak
      ms = cfg.totalCycles * cfg.workMs + (cfg.totalCycles - 1) * cfg.shortBreakMs;
    }
    ms += Pomodoro.getElapsedMs();
    return ms;
  }

  // Determine current phase index in the sequence. cycleIndex is incremented
  // at the START of a break (engine nextPhase), so during a short break it
  // already points at the NEXT work block — the active break is the one that
  // FOLLOWS work block (cycleIdx - 1). Match against the prebuilt `phases`
  // array (whose .cycle is the 0-based work-block index each segment belongs
  // to) so the highlight stays in lockstep with the engine.
  let activeIdx = -1;
  if (status !== 'idle' && status !== 'done') {
    if (phase === 'work') {
      activeIdx = phases.findIndex(p => p.type === 'work' && p.cycle === cycleIdx);
    } else if (phase === 'shortBreak') {
      activeIdx = phases.findIndex(p => p.type === 'shortBreak' && p.cycle === cycleIdx - 1);
    } else { // longBreak
      activeIdx = phases.findIndex(p => p.type === 'longBreak');
    }
  }

  // Get focus goals for assignment hints
  const goals = loadChecklist();

  const fmtMin = (ms) => {
    const m = Math.round(ms / 60000);
    return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? m % 60 + 'm' : ''}` : `${m}m`;
  };

  const endStr = endTime.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  let html = '<div class="pomo-timeline-bar">';
  phases.forEach((p, i) => {
    const widthPct = (p.durationMs / totalMs) * 100;
    const isWork = p.type === 'work';
    const isDone = i < activeIdx;
    const isActive = i === activeIdx;
    let cls = 'pomo-tl-seg';
    if (isWork) cls += ' pomo-tl-work';
    else cls += ' pomo-tl-break';
    if (isDone) cls += ' pomo-tl-done';
    if (isActive) cls += ' pomo-tl-active';

    // Show goal assignment for work phases
    let goalHint = '';
    if (isWork && goals.length > 0) {
      const goalIdx = p.cycle;
      if (goals[goalIdx] && !goals[goalIdx].done) {
        goalHint = ` title="${escapeChecklistHtml(goals[goalIdx].text)}"`;
      }
    }

    html += `<div class="${cls}" style="width:${widthPct}%"${goalHint}><span class="pomo-tl-label">${p.label}</span></div>`;
  });
  html += '</div>';
  html += `<div class="pomo-timeline-info"><span>${fmtMin(totalMs)} total</span><span>Est. end: ${endStr}</span></div>`;

  el.innerHTML = html;
}

// ── Task & Timing Data Gathering ──
function gatherTaskData() {
  const data = {
    focusGoals: loadChecklist().filter(i => i.done).map(i => i.text),
    breakTasks: loadBreakChecklist().filter(i => i.done).map(i => i.text),
    actualWork: loadActualWork(),
  };
  // E-1d-f8: distractions now filter by current sessionId from the
  // consolidated map.
  const distractions = (typeof Distractions !== 'undefined')
    ? Distractions.getForSession('pomodoro', Pomodoro.getSessionStartedAt())
    : [];
  if (distractions.length > 0) data.distractions = distractions;
  const bfrbs = getPomoSessionBFRBs();
  if (bfrbs.length > 0) data.bfrbs = bfrbs;
  return data;
}

function gatherTimingData() {
  const log = Pomodoro.getPhaseLog().slice();
  // If a phase is currently in progress, include it as open-ended.
  // F6: stamp deviceId + phaseStartedAt for cross-device append-merge dedup.
  // History.getDeviceId is always defined by the time a session ends (UI runs
  // post-boot; History.init has fired). Mirrors the stamping in pomodoro.js.
  const phaseStart = Pomodoro.getPhaseStartedAt();
  if (phaseStart) {
    log.push({
      phase: Pomodoro.getPhase(),
      startedAt: phaseStart,
      endedAt: Date.now(),
      partial: true,
      deviceId: History.getDeviceId ? History.getDeviceId() : null,
      phaseStartedAt: phaseStart,
    });
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

  document.getElementById('pomo-clear-all-tasks').addEventListener('click', () => {
    // C2: this wipes the user's focus goals + break tasks + actual-work lists
    // for the session with no undo — confirm before discarding. (Stopwatch
    // reset/lap-delete get an undo toast; this destructive action had nothing.)
    if (!confirm('Clear all goals, break tasks, and what-you-worked-on for this session?')) return;
    clearChecklist();
    renderChecklist();
    renderBreakChecklist();
    renderActualWork();
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
    const phaseLog = Pomodoro.getPhaseLog ? Pomodoro.getPhaseLog() : [];
    const totalOvershoot = phaseLog.reduce((sum, p) => sum + (p.overshootMs || 0), 0)
      + (Pomodoro.isOvershooting && Pomodoro.isOvershooting() ? Pomodoro.getOvershootMs() : 0);
    // Capture sessionId BEFORE Pomodoro.reset() clears it (E-1d-f8 audit Risk #3).
    const sessionIdToClear = Pomodoro.getSessionStartedAt();
    if (elapsed > 1000 || cycleIdx > 0) {
      History.addSession({
        type: 'pomodoro',
        duration: elapsed,
        laps: [],
        completedCycles: cycleIdx,
        totalWorkMs: cycleIdx * cfg.workMs + (phase === 'work' ? elapsed : 0),
        overshootMs: totalOvershoot,
        ...gatherTaskData(),
        ...gatherTimingData(),
      });
    }
    stopPomodoroRenderLoop();
    BgNotify.cancel('pomodoro');
    Pomodoro.reset();
    savePomodoroState();
    if (typeof Distractions !== 'undefined' && sessionIdToClear != null) {
      Distractions.clearSession('pomodoro', sessionIdToClear);
    }
    savePomoBFRBs([]);
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
