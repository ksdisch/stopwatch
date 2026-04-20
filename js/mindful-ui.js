// Mindful UI — the Wellness › Mindful surface.
//
// Two sections:
//   1. Breathing exercises — 4 patterns (Box, 4-7-8, Coherence 5-5, Calm 6-2-6)
//      with an inline animated circle. The circle's CSS transition duration
//      is set per-step so inhale/hold/exhale each drive a smooth scale tween.
//      Pure DOM animation, no external runner.
//   2. Meditation timers — 5 duration presets that apply to the existing
//      Timer engine and route to Timers › Timer, auto-started.
//
// No new history type for breathing sessions in V1. Meditation timers land
// as type='timer' in the existing History store via the Timer mode's
// standard save path.

const MindfulUI = (() => {
  const BREATH_PATTERNS = [
    {
      id: 'box',
      name: 'Box 4-4-4-4',
      summary: 'Equal 4-count · steady, grounding',
      steps: [
        { label: 'Inhale', sec: 4, scale: 1.0 },
        { label: 'Hold',   sec: 4, scale: 1.0 },
        { label: 'Exhale', sec: 4, scale: 0.5 },
        { label: 'Hold',   sec: 4, scale: 0.5 },
      ],
    },
    {
      id: '4-7-8',
      name: '4-7-8',
      summary: 'Inhale 4 · hold 7 · exhale 8',
      steps: [
        { label: 'Inhale', sec: 4, scale: 1.0 },
        { label: 'Hold',   sec: 7, scale: 1.0 },
        { label: 'Exhale', sec: 8, scale: 0.5 },
      ],
    },
    {
      id: 'coherence',
      name: 'Coherence 5-5',
      summary: 'Balanced 5-in / 5-out',
      steps: [
        { label: 'Inhale', sec: 5, scale: 1.0 },
        { label: 'Exhale', sec: 5, scale: 0.5 },
      ],
    },
    {
      id: 'calm',
      name: 'Calm 6-2-6',
      summary: 'Longer inhale/exhale · soothing',
      steps: [
        { label: 'Inhale', sec: 6, scale: 1.0 },
        { label: 'Hold',   sec: 2, scale: 1.0 },
        { label: 'Exhale', sec: 6, scale: 0.5 },
      ],
    },
  ];

  const MEDITATION_PRESETS = [
    { id: 'med-3',  label: '3 min',  durationMs: 3 * 60000  },
    { id: 'med-5',  label: '5 min',  durationMs: 5 * 60000  },
    { id: 'med-10', label: '10 min', durationMs: 10 * 60000 },
    { id: 'med-15', label: '15 min', durationMs: 15 * 60000 },
    { id: 'med-20', label: '20 min', durationMs: 20 * 60000 },
  ];

  // DOM refs
  let surfaceEl, patternsEl, runnerEl, runnerCircle, runnerLabel, runnerCount, runnerCycles,
      runnerName, runnerStopBtn, medPresetsEl;

  // Breathing runner state
  let currentPattern = null;
  let currentStepIdx = 0;
  let cycleCount = 0;
  let stepTimer = null;
  let countdownTimer = null;
  let stepEndsAt = 0;

  function init() {
    surfaceEl = document.querySelector('[data-wellness-sub="mindful"]');
    if (!surfaceEl) return;

    patternsEl     = surfaceEl.querySelector('#mindful-patterns');
    runnerEl       = surfaceEl.querySelector('#mindful-runner');
    runnerCircle   = surfaceEl.querySelector('#mindful-circle');
    runnerLabel    = surfaceEl.querySelector('#mindful-phase-label');
    runnerCount    = surfaceEl.querySelector('#mindful-phase-count');
    runnerCycles   = surfaceEl.querySelector('#mindful-cycle-count');
    runnerName     = surfaceEl.querySelector('#mindful-pattern-name');
    runnerStopBtn  = surfaceEl.querySelector('#mindful-stop-btn');
    medPresetsEl   = surfaceEl.querySelector('#mindful-med-presets');

    renderPatterns();
    renderMeditationPresets();
    wireRunnerStop();

    // Stop breathing if the user navigates away from the Mindful surface —
    // leaving the runner active in the background would feel broken.
    window.addEventListener('hashchange', () => {
      if (!isSurfaceVisible() && currentPattern) stopBreathing();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && currentPattern) stopBreathing();
    });
  }

  function isSurfaceVisible() {
    if (!surfaceEl) return false;
    if (surfaceEl.hidden) return false;
    const pillar = surfaceEl.closest('.tempo-pillar');
    if (!pillar || pillar.dataset.active !== 'true') return false;
    return true;
  }

  // ── Breathing patterns ─────────────────────────────────────────────

  function renderPatterns() {
    patternsEl.innerHTML = BREATH_PATTERNS.map(p => `
      <button class="mindful-pattern-card" data-pattern-id="${p.id}" type="button">
        <div class="mindful-pattern-name">${escapeHtml(p.name)}</div>
        <div class="mindful-pattern-summary">${escapeHtml(p.summary)}</div>
      </button>
    `).join('');
    BREATH_PATTERNS.forEach(p => {
      const btn = patternsEl.querySelector(`[data-pattern-id="${p.id}"]`);
      if (btn) btn.addEventListener('click', () => startBreathing(p));
    });
  }

  function wireRunnerStop() {
    if (!runnerStopBtn) return;
    runnerStopBtn.addEventListener('click', () => stopBreathing());
  }

  function startBreathing(pattern) {
    stopBreathing();
    currentPattern = pattern;
    currentStepIdx = 0;
    cycleCount = 0;

    runnerEl.hidden = false;
    patternsEl.hidden = true;
    runnerName.textContent = pattern.name;
    runnerCycles.textContent = '0 cycles';

    // Pre-shrink circle to the starting scale before the first step begins,
    // so the very first inhale has something to grow from.
    const firstStep = pattern.steps[0];
    const prestart = firstStep.scale === 1.0 ? 0.5 : 1.0;
    runnerCircle.style.transition = 'none';
    runnerCircle.style.transform = `scale(${prestart})`;
    // Force a reflow so the browser commits that starting scale before we
    // attach the animated transition on the next tick.
    runnerCircle.offsetWidth;  // eslint-disable-line no-unused-expressions
    runStep();
  }

  function runStep() {
    if (!currentPattern) return;
    const step = currentPattern.steps[currentStepIdx];

    runnerLabel.textContent = step.label;
    runnerCircle.style.transition = `transform ${step.sec}s ease-in-out`;
    runnerCircle.style.transform = `scale(${step.scale})`;

    // Live countdown inside the circle.
    stepEndsAt = Date.now() + step.sec * 1000;
    clearInterval(countdownTimer);
    updateCountdown();
    countdownTimer = setInterval(updateCountdown, 100);

    stepTimer = setTimeout(() => {
      clearInterval(countdownTimer);
      currentStepIdx++;
      if (currentStepIdx >= currentPattern.steps.length) {
        currentStepIdx = 0;
        cycleCount++;
        runnerCycles.textContent = `${cycleCount} cycle${cycleCount === 1 ? '' : 's'}`;
      }
      runStep();
    }, step.sec * 1000);
  }

  function updateCountdown() {
    const remainMs = Math.max(0, stepEndsAt - Date.now());
    const remainSec = Math.max(1, Math.ceil(remainMs / 1000));
    runnerCount.textContent = String(remainSec);
  }

  function stopBreathing() {
    if (stepTimer) { clearTimeout(stepTimer); stepTimer = null; }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    currentPattern = null;
    currentStepIdx = 0;
    cycleCount = 0;

    if (runnerEl) runnerEl.hidden = true;
    if (patternsEl) patternsEl.hidden = false;
    if (runnerCircle) {
      runnerCircle.style.transition = 'transform 0.25s ease-out';
      runnerCircle.style.transform = 'scale(0.5)';
    }
  }

  // ── Meditation presets ─────────────────────────────────────────────

  function renderMeditationPresets() {
    medPresetsEl.innerHTML = MEDITATION_PRESETS.map(p => `
      <button class="mindful-med-card" data-med-id="${p.id}" type="button"
              aria-label="Start a ${p.label} meditation timer">
        <div class="mindful-med-duration">${escapeHtml(p.label)}</div>
        <div class="mindful-med-hint">Start timer</div>
      </button>
    `).join('');
    MEDITATION_PRESETS.forEach(p => {
      const btn = medPresetsEl.querySelector(`[data-med-id="${p.id}"]`);
      if (btn) btn.addEventListener('click', () => launchMeditation(p));
    });
  }

  function launchMeditation(preset) {
    // Stop any breathing runner before we navigate.
    if (currentPattern) stopBreathing();

    Timer.reset();
    Timer.setDuration(preset.durationMs);
    Timer.setName(`Meditation ${preset.label}`);
    if (typeof Persistence !== 'undefined') Persistence.save();

    // Route to Timers › Timer, then auto-start once the mode has settled.
    if (typeof TempoNav !== 'undefined' && TempoNav.applyRoute) {
      TempoNav.applyRoute({ pillar: 'timers', sub: 'countdown' });
    } else {
      window.location.hash = '#/timers/countdown';
    }

    // Auto-start after the mode-switch animation. The Timer UI updates
    // itself when switchAppMode finishes; we then start the countdown.
    setTimeout(() => {
      try {
        if (Timer.getStatus() === 'idle' && Timer.getDurationMs() > 0) {
          Timer.start();
          if (typeof SFX !== 'undefined') SFX.playStart();
          if (typeof startTimerRenderLoop === 'function') startTimerRenderLoop();
          if (typeof updateTimerUI === 'function') updateTimerUI();
        }
      } catch (e) { /* Timer globals not loaded yet — no-op */ }
    }, 180);
  }

  function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = String(str ?? '');
    return el.innerHTML;
  }

  return { init };
})();
