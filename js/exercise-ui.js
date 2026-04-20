// Exercise UI — the Wellness › Exercise surface.
//
// Shows a grid of workout presets (Tabata / HIIT / EMOM / AMRAP / Steady).
// Tapping a preset applies it to the existing Interval engine and routes
// the user to Timers › Interval, where the existing Interval UI runs the
// workout. No second engine or second runner — the Exercise pillar is a
// launcher + activity log that delegates timing to js/interval.js.
//
// Recent Activity reads from History (IndexedDB, type === 'interval').

const ExerciseUI = (() => {
  const RECENT_LIMIT = 5;

  // Built-in presets. Each maps to an Interval program the existing engine
  // already understands via Interval.setProgram(). Colors match the existing
  // interval CSS tokens (green for work, orange for rest).
  const PRESETS = [
    {
      id: 'tabata',
      name: 'Tabata',
      emoji: '\u26A1', // ⚡
      summary: '8 rounds · 20s work / 10s rest',
      totalLabel: '4 min',
      program: {
        name: 'Tabata',
        rounds: 8,
        restBetweenRoundsMs: 0,
        phases: [
          { name: 'Work', durationMs: 20000, color: '#30d158' },
          { name: 'Rest', durationMs: 10000, color: '#ff9f0a' },
        ],
      },
    },
    {
      id: 'hiit-30-30',
      name: 'HIIT 30/30',
      emoji: '\uD83D\uDD25', // 🔥
      summary: '10 rounds · 30s work / 30s rest',
      totalLabel: '10 min',
      program: {
        name: 'HIIT 30/30',
        rounds: 10,
        restBetweenRoundsMs: 0,
        phases: [
          { name: 'Work', durationMs: 30000, color: '#30d158' },
          { name: 'Rest', durationMs: 30000, color: '#ff9f0a' },
        ],
      },
    },
    {
      id: 'hiit-40-20',
      name: 'HIIT 40/20',
      emoji: '\uD83D\uDCAA', // 💪
      summary: '8 rounds · 40s work / 20s rest',
      totalLabel: '8 min',
      program: {
        name: 'HIIT 40/20',
        rounds: 8,
        restBetweenRoundsMs: 0,
        phases: [
          { name: 'Work', durationMs: 40000, color: '#30d158' },
          { name: 'Rest', durationMs: 20000, color: '#ff9f0a' },
        ],
      },
    },
    {
      id: 'emom-12',
      name: 'EMOM 12',
      emoji: '\u23F1\uFE0F', // ⏱
      summary: 'Every minute on the minute · 12 rounds',
      totalLabel: '12 min',
      program: {
        name: 'EMOM 12',
        rounds: 12,
        restBetweenRoundsMs: 0,
        phases: [
          { name: 'Minute', durationMs: 60000, color: '#30d158' },
        ],
      },
    },
    {
      id: 'amrap-15',
      name: 'AMRAP 15',
      emoji: '\uD83C\uDFCB\uFE0F', // 🏋️
      summary: 'As many rounds as possible · single 15-min block',
      totalLabel: '15 min',
      program: {
        name: 'AMRAP 15',
        rounds: 1,
        restBetweenRoundsMs: 0,
        phases: [
          { name: 'AMRAP', durationMs: 15 * 60000, color: '#30d158' },
        ],
      },
    },
    {
      id: 'steady-20',
      name: 'Steady 20',
      emoji: '\u2764\uFE0F', // ❤
      summary: 'Low-intensity steady state · 20-min block',
      totalLabel: '20 min',
      program: {
        name: 'Steady 20',
        rounds: 1,
        restBetweenRoundsMs: 0,
        phases: [
          { name: 'Steady', durationMs: 20 * 60000, color: '#30d158' },
        ],
      },
    },
  ];

  let surfaceEl, gridEl, recentEl, customBtn;

  function init() {
    surfaceEl = document.querySelector('[data-wellness-sub="exercise"]');
    if (!surfaceEl) return;

    gridEl    = surfaceEl.querySelector('#exercise-presets');
    recentEl  = surfaceEl.querySelector('#exercise-recent');
    customBtn = surfaceEl.querySelector('#exercise-custom-btn');

    renderPresets();
    wireCustomButton();
    renderRecent();

    // Refresh the recent list each time the user navigates to the surface,
    // since they'll typically check it after completing a workout in the
    // Timers pillar.
    window.addEventListener('hashchange', () => {
      if (isSurfaceVisible()) renderRecent();
    });
  }

  function isSurfaceVisible() {
    if (!surfaceEl) return false;
    if (surfaceEl.hidden) return false;
    const pillar = surfaceEl.closest('.tempo-pillar');
    if (!pillar || pillar.dataset.active !== 'true') return false;
    return true;
  }

  // ── Preset grid ─────────────────────────────────────────────────────

  function renderPresets() {
    gridEl.innerHTML = PRESETS.map(renderPresetCard).join('');
    PRESETS.forEach(preset => {
      const el = gridEl.querySelector(`[data-preset-id="${preset.id}"]`);
      if (!el) return;
      el.addEventListener('click', () => launchPreset(preset));
    });
  }

  function renderPresetCard(preset) {
    return `
      <button class="exercise-card" data-preset-id="${preset.id}" type="button"
              aria-label="Launch ${escapeHtml(preset.name)} workout">
        <div class="exercise-card-emoji" aria-hidden="true">${preset.emoji}</div>
        <div class="exercise-card-name">${escapeHtml(preset.name)}</div>
        <div class="exercise-card-summary">${escapeHtml(preset.summary)}</div>
        <div class="exercise-card-total">${escapeHtml(preset.totalLabel)}</div>
      </button>
    `;
  }

  function wireCustomButton() {
    if (!customBtn) return;
    customBtn.addEventListener('click', () => {
      // Reset but don't load a program — the Interval UI shows its setup
      // form when the program has no phases, letting the user build one.
      Interval.reset();
      try {
        localStorage.setItem('interval_state', JSON.stringify(Interval.getState()));
      } catch (e) {}
      navigateToInterval();
    });
  }

  function launchPreset(preset) {
    // Reset any previous program, load the preset, persist, then navigate.
    Interval.reset();
    Interval.setProgram(preset.program);
    try {
      localStorage.setItem('interval_state', JSON.stringify(Interval.getState()));
    } catch (e) {}
    if (typeof SFX !== 'undefined') SFX.playLap();
    if (navigator.vibrate) navigator.vibrate(20);
    navigateToInterval();
  }

  function navigateToInterval() {
    if (typeof TempoNav !== 'undefined' && TempoNav.applyRoute) {
      TempoNav.applyRoute({ pillar: 'timers', sub: 'interval' });
    } else {
      window.location.hash = '#/timers/interval';
    }
    // The mode-switch animation in app.js runs ~100ms after applyRoute.
    // After it settles, force the Interval setup form to re-render against
    // the freshly loaded program — renderSetupPhases() updates the phase
    // list, syncSetupInputs() updates the rounds + rest-between inputs.
    setTimeout(() => {
      try { if (typeof updateIntervalUI === 'function') updateIntervalUI(); } catch (e) {}
      try { if (typeof renderSetupPhases === 'function') renderSetupPhases(); } catch (e) {}
      try { if (typeof syncSetupInputs === 'function') syncSetupInputs(); } catch (e) {}
    }, 140);
  }

  // ── Recent Activity ─────────────────────────────────────────────────

  async function renderRecent() {
    if (!recentEl) return;
    recentEl.innerHTML = '<div class="exercise-recent-loading">Loading…</div>';
    let sessions = [];
    try {
      const all = await History.getSessions();
      sessions = all
        .filter(s => s.type === 'interval')
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, RECENT_LIMIT);
    } catch (e) {
      recentEl.innerHTML = '';
      return;
    }

    if (sessions.length === 0) {
      recentEl.innerHTML = `
        <div class="exercise-recent-empty">
          <div class="exercise-recent-empty-mark" aria-hidden="true">\uD83D\uDCC5</div>
          <p>No workouts logged yet. Pick a preset above to start.</p>
        </div>
      `;
      return;
    }

    recentEl.innerHTML = sessions.map(renderRecentRow).join('');
  }

  function renderRecentRow(session) {
    const name = escapeHtml(session.programName || 'Interval');
    const when = formatWhen(session.date);
    const dur = formatDuration(session.duration || 0);
    return `
      <div class="exercise-recent-row">
        <div class="exercise-recent-row-main">
          <div class="exercise-recent-row-name">${name}</div>
          <div class="exercise-recent-row-when">${escapeHtml(when)}</div>
        </div>
        <div class="exercise-recent-row-duration">${dur}</div>
      </div>
    `;
  }

  function formatWhen(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (sameDay)    return `Today · ${time}`;
    if (isYesterday) return `Yesterday · ${time}`;
    const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${dateStr} · ${time}`;
  }

  function formatDuration(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    if (mins > 0)  return `${mins}m ${secs}s`;
    return `${secs}s`;
  }

  function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = String(str ?? '');
    return el.innerHTML;
  }

  return { init, PRESETS };
})();
