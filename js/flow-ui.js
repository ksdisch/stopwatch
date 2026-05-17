// ── Flow Block UI ──
let flowRafId = null;

const FLOW_DISTRACTION_KEY = 'flow_distractions';
const FLOW_BFRB_KEY = 'flow_bfrbs';
const FLOW_CHECKLIST_STATE_KEY = 'flow_checklist_state';
const FLOW_CHECKLIST_SKIPPED_KEY = 'flow_checklist_skipped';

// Backlog #2: vibration interval for Flow focus blocks. Same RAF-loop
// check pattern as Stopwatch's `vibrate_interval` in js/ui.js — fires
// a haptic at each crossing of the configured interval. Stored under
// its own localStorage key so the user can pick different cadences
// for Stopwatch (lap-style) vs. Flow (long-block check-in style)
// without one bleeding into the other.
const FLOW_VIBRATE_INTERVAL_KEY = 'flow_vibrate_interval';
let flowVibrateIntervalMs = parseInt(
  localStorage.getItem(FLOW_VIBRATE_INTERVAL_KEY) || '0', 10
);
// Cursor for the last interval boundary we vibrated through. Reset on
// every new focus block (start) so the first haptic fires at
// `vibrateIntervalMs` elapsed, not relative to the previous session.
let flowLastVibrateMs = 0;

// Backlog #3: ambient noise profile for Flow focus blocks. Persisted
// per mode so Stopwatch / Timer / Pomodoro can carry their own
// preferences without one bleeding into the others. Empty string
// (or any unrecognized value) means "off".
const FLOW_AMBIENT_PROFILE_KEY = 'flow_ambient_profile';
let flowAmbientProfile = localStorage.getItem(FLOW_AMBIENT_PROFILE_KEY) || '';

// Fixed pre-block checklist items. Index order must be stable — local state
// arrays are indexed by position.
const FLOW_CHECKLIST_ITEMS = [
  'Phone on Do Not Disturb',
  'Notifications silenced',
  'Tabs/apps closed',
  'Water nearby',
  'Clear goal for this block',
];

// E-1d-f8: legacy helpers retained for emergency rollback only. All
// active call sites switched to Distractions.log / .getForSession /
// .clearSession (sessionId-keyed map shape). The legacy `flow_distractions`
// key is preserved on disk (Pick B on TODO #2 — cleanup deferred per
// Pick C on TODO #6). These helpers read/write the legacy flat-array
// shape and are no longer wired anywhere — they exist so a hot rollback
// to pre-E-1d-f8 behavior can re-route by editing the call sites only.
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
    // Backlog #3: stop ambient noise the moment a focus phase ends.
    // Recovery is meant to be quiet and reflective — the noise was an
    // aid for the focus block itself. If the user wants noise during
    // recovery too, that's a follow-up (per-phase profiles).
    if (completedPhase === 'focus') SFX.stopAmbient();
    SFX.playAlarm();
    Platform.haptic([200, 100, 200, 100, 200]);
    const label = completedPhase === 'focus'
      ? 'Focus block complete! Time for recovery.'
      : 'Recovery complete.';
    Platform.notify('Flow Block', { body: label });

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

  // Vibration interval dropdown (backlog #2). Reads the persisted value
  // into the select on init, then mirrors any change back to localStorage.
  // The RAF tick reads flowVibrateIntervalMs each frame so the new value
  // takes effect immediately — no restart required.
  const vibrateSelect = document.getElementById('flow-vibrate-interval');
  if (vibrateSelect) {
    vibrateSelect.value = String(flowVibrateIntervalMs);
    vibrateSelect.addEventListener('change', () => {
      flowVibrateIntervalMs = parseInt(vibrateSelect.value, 10) || 0;
      localStorage.setItem(FLOW_VIBRATE_INTERVAL_KEY, String(flowVibrateIntervalMs));
    });
  }

  // Ambient noise dropdown (backlog #3). Persists the chosen profile to
  // localStorage. When changed mid-session, immediately swap the playing
  // profile (or stop, for "Off") so the user gets feedback without
  // needing to restart the block.
  const ambientSelect = document.getElementById('flow-ambient-profile');
  if (ambientSelect) {
    ambientSelect.value = flowAmbientProfile;
    ambientSelect.addEventListener('change', () => {
      flowAmbientProfile = ambientSelect.value || '';
      localStorage.setItem(FLOW_AMBIENT_PROFILE_KEY, flowAmbientProfile);
      const st = Flow.getStatus();
      if (st === 'running' || st === 'overflowing') {
        if (flowAmbientProfile) SFX.startAmbient(flowAmbientProfile);
        else SFX.stopAmbient();
      }
    });
  }
  // Resume guard: if loadState restored a 'running' / 'overflowing'
  // session (user reopened the tab mid-block), seed the in-memory
  // vibrate cursor at the current elapsed so the first tick after
  // resume doesn't fire a "catch-up" haptic for every missed interval.
  // Fresh starts reset the cursor inside Flow.start()'s click handler.
  try {
    const resumedStatus = Flow.getStatus();
    if (resumedStatus === 'running' || resumedStatus === 'overflowing') {
      flowLastVibrateMs = Flow.getElapsedMs();
    }
  } catch (_) {}

  // Pre-block checklist
  renderFlowChecklist();
  document.getElementById('flow-skip-checklist').addEventListener('click', () => {
    setFlowChecklistSkipped(true);
    updateFlowChecklistGate();
  });

  // Distraction log
  initFlowDistractionLog();

  // End focus early — saves the block to history with actual elapsed time
  // + endedEarly:true and routes into the normal focusComplete flow
  // (summary card + recovery option).
  document.getElementById('flow-end-early-btn')?.addEventListener('click', () => {
    const st = Flow.getStatus();
    if (st !== 'running' && st !== 'paused') return;
    // Stop render loop + bg notification before the state transition so nothing
    // races against the phase-complete callback that endFocusEarly fires.
    stopFlowRenderLoop();
    BgNotify.cancel('flow');
    // endFocusEarly fires Flow.onPhaseComplete('focus'), which in turn calls
    // saveFlowSessionToHistory via the callback wired in initFlowUI.
    Flow.endFocusEarly();
    saveFlowState();
    SFX.playStop();
    updateFlowUI();
  });

  // BFRB tally — now handled by the global floating button (js/global-bfrb.js).
  // The button writes into flow_bfrbs when Flow is the active running session,
  // so saveFlowSessionToHistory still captures per-session catches below.

  // Summary card buttons
  document.getElementById('flow-start-recovery').addEventListener('click', () => {
    if (Flow.getStatus() !== 'overflowing') return;
    // Capture focus overshoot before transitioning into recovery — once
    // startRecovery() runs the engine resets accumulated to 0 for the
    // recovery phase and the focus overshoot value is gone.
    saveFlowSessionToHistory();
    Flow.startRecovery();
    saveFlowState();
    SFX.playStart();
    BgNotify.schedule('flow', Flow.getRemainingMs(), 'Flow Block', 'Recovery complete.');
    startFlowRenderLoop();
    updateFlowUI();
  });
  document.getElementById('flow-skip-recovery').addEventListener('click', () => {
    const st = Flow.getStatus();
    if (st !== 'overflowing'
        && st !== 'recovery'
        && st !== 'recoveryPaused'
        && st !== 'recoveryOverflowing') return;
    // Capture sessionId BEFORE Flow.reset() clears it (E-1d-f8 audit Risk #3).
    const sessionIdToClear = Flow.getSessionStartedAt();
    // If we're skipping straight from focus overflow, capture the overshoot
    // into history before the engine resets.
    if (st === 'overflowing') saveFlowSessionToHistory();
    BgNotify.cancel('flow');
    stopFlowRenderLoop();
    Flow.skipRecovery();
    Flow.reset();
    resetFlowChecklistState();
    if (typeof Distractions !== 'undefined' && sessionIdToClear != null) {
      Distractions.clearSession('flow', sessionIdToClear);
    }
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
  if (Flow.getStatus() === 'overflowing') {
    saveFlowSessionToHistory();
  }

  // Restore render loop if needed
  const initSt = Flow.getStatus();
  if ((initSt === 'running' || initSt === 'recovery'
       || initSt === 'overflowing' || initSt === 'recoveryOverflowing')
      && appMode === 'flow') {
    startFlowRenderLoop();
  }
  if (appMode === 'flow') updateFlowUI();
}

function onFlowLeft() {
  if (appMode !== 'flow') return;
  const status = Flow.getStatus();
  if (status === 'paused' || status === 'recoveryPaused' || status === 'recoveryOverflowing') {
    // Reset — abandon session (focus block has already been saved to history
    // at focusComplete time, so we're not losing data).
    // Capture sessionId BEFORE Flow.reset() clears it (E-1d-f8 audit Risk #3).
    const sessionIdToClear = Flow.getSessionStartedAt();
    stopFlowRenderLoop();
    // Backlog #3: defensive stop in case the user resets from a state
    // where ambient might still be running (e.g. paused mid-focus and
    // then reset — Flow.pause's stop path already fires, but covering
    // the explicit Reset gesture too keeps the intent obvious).
    SFX.stopAmbient();
    BgNotify.cancel('flow');
    Flow.reset();
    resetFlowChecklistState();
    if (typeof Distractions !== 'undefined' && sessionIdToClear != null) {
      Distractions.clearSession('flow', sessionIdToClear);
    }
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
    // E-1d-f8: distractions are now sessionId-keyed. A new Flow.start()
    // mints a fresh sessionId, so the new session's bucket is naturally
    // empty — no clear needed. Past-session keys are retained (cleanup
    // PR deferred per Pick C on TODO #6).
    saveFlowBFRBs([]);
    Flow.start();
    // Backlog #2: reset the vibrate cursor so the first haptic fires
    // at vibrateIntervalMs elapsed in THIS focus block (not relative
    // to a previous session's leftover state).
    flowLastVibrateMs = 0;
    // Backlog #3: auto-start ambient noise for THIS focus block.
    if (flowAmbientProfile) SFX.startAmbient(flowAmbientProfile);
    BgNotify.schedule('flow', Flow.getRemainingMs(), 'Flow Block', 'Focus block complete! Time for recovery.');
    saveFlowState();
    SFX.playStart();
    startFlowRenderLoop();
    updateFlowUI();
  } else if (status === 'running') {
    stopFlowRenderLoop();
    Flow.pause();
    SFX.stopAmbient();
    BgNotify.cancel('flow');
    saveFlowState();
    SFX.playStop();
    updateFlowUI();
  } else if (status === 'paused') {
    Flow.resume();
    // Backlog #3: resume ambient noise alongside the timer.
    if (flowAmbientProfile) SFX.startAmbient(flowAmbientProfile);
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
  } else if (status === 'recoveryOverflowing') {
    // End recovery — capture overshoot was already in the focus history
    // record. Recovery overshoot itself isn't currently surfaced in the
    // record, but the user has acted, so we transition to done + reset.
    // Capture sessionId BEFORE Flow.reset() clears it (E-1d-f8 audit Risk #3).
    const sessionIdToClear = Flow.getSessionStartedAt();
    BgNotify.cancel('flow');
    stopFlowRenderLoop();
    Flow.skipRecovery();
    Flow.reset();
    resetFlowChecklistState();
    if (typeof Distractions !== 'undefined' && sessionIdToClear != null) {
      Distractions.clearSession('flow', sessionIdToClear);
    }
    saveFlowBFRBs([]);
    saveFlowState();
    updateFlowUI();
  } else if (status === 'done') {
    // Capture sessionId BEFORE Flow.reset() clears it (E-1d-f8 audit Risk #3).
    const sessionIdToClear = Flow.getSessionStartedAt();
    Flow.reset();
    resetFlowChecklistState();
    if (typeof Distractions !== 'undefined' && sessionIdToClear != null) {
      Distractions.clearSession('flow', sessionIdToClear);
    }
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
  const overshootMs = Flow.isOvershooting && Flow.isOvershooting() ? Flow.getOvershootMs() : 0;
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

  // Section visibility. 'overflowing' is the focus-phase overflow state and
  // surfaces the summary card (with the +M:SS overshoot reflected in the time
  // display). 'recoveryOverflowing' surfaces the recovery section.
  const isIdle = status === 'idle';
  const isFocusActive = status === 'running' || status === 'paused';
  const isFocusComplete = status === 'overflowing';
  const isRecoveryActive = status === 'recovery'
    || status === 'recoveryPaused'
    || status === 'recoveryOverflowing';
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
  }

  // End-early button visibility: running or paused focus phase only.
  const endEarlyBtn = document.getElementById('flow-end-early-btn');
  if (endEarlyBtn) {
    endEarlyBtn.classList.toggle('hidden', !isFocusActive);
  }

  // Format remaining time. Overflow shows "+M:SS.cc" — applies to focus
  // overshoot (status 'overflowing') and recovery overshoot
  // ('recoveryOverflowing'). All other states show remaining.
  if (Flow.isOvershooting && Flow.isOvershooting()) {
    const t = Utils.formatMs(overshootMs);
    if (t.hours > 0) {
      timeEl.innerHTML = `+${t.hours}:${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`;
    } else {
      timeEl.innerHTML = `+${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`;
    }
  } else {
    const remaining = isDone ? 0 : Flow.getRemainingMs();
    const t = Utils.formatMs(remaining);
    if (t.hours > 0) {
      timeEl.innerHTML = `${t.hours}:${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`;
    } else {
      timeEl.innerHTML = `${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`;
    }
  }

  // Progress bar
  if (isFocusActive || isRecoveryActive) {
    progressBar.classList.remove('hidden');
    progressFill.style.width = `${Flow.getProgress() * 100}%`;
  } else {
    progressBar.classList.add('hidden');
  }

  // Visual states. Overflow flashes red briefly (first ~3s) then settles
  // into steady amber via .overshoot.
  const isOver = Flow.isOvershooting && Flow.isOvershooting();
  timerDisplay.classList.toggle('pomodoro-break', isRecoveryActive && !isOver);
  timerDisplay.classList.toggle('pomodoro-phase-complete', isOver && overshootMs <= 3000);
  timerDisplay.classList.toggle('overshoot', isOver && overshootMs > 1000);
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
    case 'overflowing': {
      // Focus phase past zero — buttons are inactive on the main row;
      // user advances via the summary card's Start Recovery / Skip Recovery
      // buttons. Showing the overshoot in the time display is enough.
      btnLeft.innerHTML = '<span class="btn-inner">--</span>';
      btnLeft.className = 'control-btn btn-lap';
      btnLeft.disabled = true;
      btnRight.innerHTML = '<span class="btn-inner">--</span>';
      btnRight.className = 'control-btn btn-start';
      btnRight.disabled = true;
      break;
    }
    case 'recoveryOverflowing': {
      // Recovery past zero — left = Reset, right = End (capture and reset).
      btnLeft.innerHTML = '<span class="btn-inner">Reset</span>';
      btnLeft.className = 'control-btn btn-reset';
      btnLeft.disabled = false;
      btnRight.innerHTML = '<span class="btn-inner">End</span>';
      btnRight.className = 'control-btn btn-start';
      btnRight.disabled = false;
      break;
    }
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

  if (typeof updateTimeAdjustControls === 'function') updateTimeAdjustControls();
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
  // Flow shares btn-right with every other mode. If Flow isn't the active
  // mode, never touch the button — otherwise an unchecked Flow checklist
  // disables Start for Pomodoro/Timer/Interval/etc.
  if (appMode !== 'flow') return;
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
      // E-1d-f8: routes through Distractions module (sessionId-keyed map).
      // The picker button is only visible while Flow.getStatus() === 'running'
      // (see updateFlowDistractionBtnVisibility), so sessionId is guaranteed
      // non-null at log time.
      if (typeof Distractions !== 'undefined') {
        Distractions.log({
          context: 'flow',
          sessionId: Flow.getSessionStartedAt(),
          category,
          note,
          phase: Flow.getPhase(),
        });
      }
      picker.classList.add('hidden');
      Platform.haptic(30);
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

// Per-mode BFRB button and init removed in favor of the global floating button
// (js/global-bfrb.js). E-1d-f3 consolidated BFRB writes into BfrbEvents
// (`bfrb_events` localStorage store with `context: 'flow'` tag). The legacy
// `loadFlowBFRBs` / `saveFlowBFRBs` helpers above are RETAINED so the
// `saveFlowBFRBs([])` session-end clears keep working — the legacy
// `flow_bfrbs` key stays on disk per Pick B on E-1d-f3 TODO #1 (cleanup
// deferred per Pick C on TODO #5). `loadFlowBFRBs` is no longer used for
// rendering — renderFlowSummary and saveFlowSessionToHistory below read
// session-scoped BFRB entries from BfrbEvents.getByContext('flow') filtered
// by Flow.getSessionStartedAt().

// Read this Flow session's BFRB entries from the consolidated store,
// converted back to the legacy-flat shape `{ timestamp, phase }` so:
//   (a) renderFlowSummary's count + future expansion stays byte-equivalent
//   (b) saveFlowSessionToHistory persists `session.bfrbs[]` in the same
//       shape Analytics.getBFRBTrend expects (s.bfrbs.forEach(b => b.timestamp)).
// Audit Risk #4: the analytics history-record read path is NOT changed by
// E-1d-f3; the legacy-flat shape is the contract.
function getFlowSessionBFRBs() {
  if (typeof BfrbEvents === 'undefined') return [];
  if (typeof Flow === 'undefined' || typeof Flow.getSessionStartedAt !== 'function') return [];
  const sessionId = Flow.getSessionStartedAt();
  if (sessionId == null) return [];
  const all = BfrbEvents.getByContext('flow');
  const out = [];
  for (const e of all) {
    if (!e || e.sessionId !== sessionId) continue;
    const legacy = { timestamp: e.takenAt };
    if (typeof e.phase === 'string') legacy.phase = e.phase;
    out.push(legacy);
  }
  return out;
}

function renderFlowSummary() {
  const body = document.getElementById('flow-summary-body');
  if (!body) return;
  const plannedMs = Flow.getFocusDurationMs();
  const elapsedMs = Flow.getFocusElapsedMs ? Flow.getFocusElapsedMs() : plannedMs;
  const plannedMin = Math.round(plannedMs / 60000);
  const elapsedMin = Math.round(elapsedMs / 60000);
  const endedEarly = elapsedMs < plannedMs - 5000; // 5s fudge for float-rounding
  const overshootMs = (Flow.isOvershooting && Flow.isOvershooting() && Flow.getPhase() === 'focus')
    ? Flow.getOvershootMs() : 0;
  const overshootStr = overshootMs > 0 && Utils.formatShort
    ? Utils.formatShort(overshootMs)
    : '';
  const goal = Flow.getGoal();
  // E-1d-f8: distractions now filter by current sessionId from the
  // consolidated map.
  const distractions = (typeof Distractions !== 'undefined')
    ? Distractions.getForSession('flow', Flow.getSessionStartedAt())
    : [];
  const bfrbs = getFlowSessionBFRBs();

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
      <span class="flow-summary-value">${elapsedMin} min${endedEarly ? ` <span class="flow-summary-sub">(of ${plannedMin} planned · ended early)</span>` : ''}</span>
    </div>
    ${overshootStr ? `<div class="flow-summary-row">
      <span class="flow-summary-label">Overshoot</span>
      <span class="flow-summary-value flow-summary-overshoot">+${overshootStr}</span>
    </div>` : ''}
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

// Save (or update) the flow session record in history. The record id is the
// session's start timestamp so subsequent saves for the same session are
// idempotent upserts via IndexedDB `put`. We deliberately re-save on user
// advance (Start Recovery / Skip Recovery) so the overshoot field reflects
// however long the user lingered past zero — the initial save at focus
// complete writes overshoot=0, then advance updates it.
function saveFlowSessionToHistory() {
  const sessionStartedAt = Flow.getSessionStartedAt();
  if (!sessionStartedAt) return;

  const plannedMs = Flow.getFocusDurationMs();
  // Actual elapsed focus time. For naturally-completed blocks this equals
  // plannedMs (the engine sets accumulatedMs to the full duration on
  // completion). For blocks ended early, this is the real time the user spent.
  const elapsedMs = Flow.getFocusElapsedMs ? Flow.getFocusElapsedMs() : plannedMs;
  const endedEarly = elapsedMs < plannedMs;
  // E-1d-f8: distractions now filter by current sessionId from the
  // consolidated map.
  const distractions = (typeof Distractions !== 'undefined')
    ? Distractions.getForSession('flow', sessionStartedAt)
    : [];
  const bfrbs = getFlowSessionBFRBs();
  const sessionEndedAt = Flow.getFocusEndedAt() || Date.now();
  // Capture overshoot only when we're in the focus-overflow state. Once
  // recovery starts, overshoot resets — but the value at the moment of
  // user-advance is what we want to persist.
  const overshootMs = (Flow.isOvershooting && Flow.isOvershooting()
    && Flow.getPhase() === 'focus')
    ? Flow.getOvershootMs()
    : 0;

  const session = {
    id: sessionStartedAt,
    type: 'flow',
    duration: elapsedMs,
    laps: [],
    goal: Flow.getGoal() || '',
    blockDurationMs: plannedMs,
    preBlockSkipped: isFlowChecklistSkipped(),
    sessionStartedAt,
    sessionEndedAt,
    overshootMs,
  };
  if (endedEarly) session.endedEarly = true;
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
    const ticking = st === 'running' || st === 'recovery'
      || st === 'overflowing' || st === 'recoveryOverflowing';
    if (ticking) {
      Flow.checkFinished();
      updateFlowUI();
      // Backlog #2: periodic check-in haptic during the focus phase.
      // Mirrors the Stopwatch implementation at js/ui.js:429-437 —
      // fire when elapsed crosses each multiple of vibrateIntervalMs.
      // Gated on `running` only (not recovery / overflowing) so the
      // 15-min recovery countdown and post-block overflow time stay
      // quiet; the user has already finished the focus work.
      if (flowVibrateIntervalMs > 0 && st === 'running') {
        const elapsed = Flow.getElapsedMs();
        const currentInterval = Math.floor(elapsed / flowVibrateIntervalMs);
        const lastInterval = Math.floor(flowLastVibrateMs / flowVibrateIntervalMs);
        if (currentInterval > lastInterval && elapsed > flowVibrateIntervalMs) {
          Platform.haptic([100, 50, 100]);
        }
        flowLastVibrateMs = elapsed;
      }
      const after = Flow.getStatus();
      const stillTicking = after === 'running' || after === 'recovery'
        || after === 'overflowing' || after === 'recoveryOverflowing';
      if (stillTicking) {
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
