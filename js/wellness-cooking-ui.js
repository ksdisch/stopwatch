// Wellness › Cooking surface.
//
// Quick-launch grid of named cooking presets. Tapping a card spins up a
// named timer in the existing Cooking mode (js/cooking-ui.js) with the
// right duration, then routes to Timers › Cook where the multi-timer UI
// runs it. No second engine, no state duplication — the preset launcher
// just calls `createTimer`, appends to the global `cookingTimers` array,
// reuses the existing alarm wiring, and hands off to the Cooking mode.
//
// Recent Activity reads History (type === 'cooking') and shows the last
// five completed timers by name + duration.

const WellnessCookingUI = (() => {
  const RECENT_LIMIT = 5;
  const MAX_COOKING_TIMERS = 8;  // mirrors js/cooking-ui.js addCookingTimer()

  const PRESETS = [
    { id: 'pasta',   name: 'Pasta',         emoji: '\uD83C\uDF5D', durationMs: 10 * 60000, label: '10 min' },
    { id: 'rice',    name: 'Rice',          emoji: '\uD83C\uDF5A', durationMs: 20 * 60000, label: '20 min' },
    { id: 'eggs',    name: 'Eggs',          emoji: '\uD83E\uDD5A', durationMs:  7 * 60000, label: '7 min'  },
    { id: 'steak',   name: 'Steak rest',    emoji: '\uD83E\uDD69', durationMs:  5 * 60000, label: '5 min'  },
    { id: 'oven',    name: 'Oven preheat',  emoji: '\uD83D\uDD25', durationMs: 10 * 60000, label: '10 min' },
    { id: 'tea',     name: 'Tea steep',     emoji: '\uD83E\uDED6', durationMs:  3 * 60000, label: '3 min'  },
    { id: 'toast',   name: 'Toast',         emoji: '\uD83C\uDF5E', durationMs:  3 * 60000, label: '3 min'  },
    { id: 'chicken', name: 'Chicken',       emoji: '\uD83C\uDF57', durationMs: 25 * 60000, label: '25 min' },
  ];

  let surfaceEl, gridEl, recentEl, capNoticeEl;

  function init() {
    surfaceEl = document.querySelector('[data-wellness-sub="cooking"]');
    if (!surfaceEl) return;

    gridEl      = surfaceEl.querySelector('#wellness-cooking-presets');
    recentEl    = surfaceEl.querySelector('#wellness-cooking-recent');
    capNoticeEl = surfaceEl.querySelector('#wellness-cooking-cap-notice');

    renderPresets();
    renderRecent();

    // Refresh the recent list whenever the user navigates back to this
    // surface — cooking timers typically finish while the user is in
    // Timers › Cook, so the history changes between visits.
    window.addEventListener('hashchange', () => {
      if (isSurfaceVisible()) renderRecent();
    });
  }

  function isSurfaceVisible() {
    if (!surfaceEl || surfaceEl.hidden) return false;
    const pillar = surfaceEl.closest('.tempo-pillar');
    if (!pillar || pillar.dataset.active !== 'true') return false;
    return true;
  }

  // ── Preset grid ─────────────────────────────────────────────────────

  function renderPresets() {
    gridEl.innerHTML = PRESETS.map(renderPresetCard).join('');
    PRESETS.forEach(p => {
      const el = gridEl.querySelector(`[data-preset-id="${p.id}"]`);
      if (el) el.addEventListener('click', () => launchPreset(p));
    });
  }

  function renderPresetCard(preset) {
    return `
      <button class="wcook-card" data-preset-id="${preset.id}" type="button"
              aria-label="Start a ${escapeHtml(preset.name)} timer for ${escapeHtml(preset.label)}">
        <div class="wcook-card-emoji" aria-hidden="true">${preset.emoji}</div>
        <div class="wcook-card-name">${escapeHtml(preset.name)}</div>
        <div class="wcook-card-duration">${escapeHtml(preset.label)}</div>
      </button>
    `;
  }

  function launchPreset(preset) {
    // Reach into the globals defined by js/cooking-ui.js. If cooking-ui
    // hasn't initialised yet (shouldn't happen, but guard anyway), bail.
    if (typeof cookingTimers === 'undefined' ||
        typeof createTimer !== 'function' ||
        typeof cookingTimerAlarm !== 'function' ||
        typeof saveCookingTimers !== 'function') {
      return;
    }

    if (cookingTimers.length >= MAX_COOKING_TIMERS) {
      showCapNotice();
      return;
    }

    // Build the timer and append to cooking-ui.js's array so its render
    // loop and persistence layer pick it up seamlessly.
    const id = Date.now().toString(36);
    const idx = cookingTimers.length;
    const timer = createTimer('cook-' + id);
    timer.setName(preset.name);
    timer.setDuration(preset.durationMs);
    timer.onAlarm(() => cookingTimerAlarm(timer, idx));
    cookingTimers.push({ id, name: preset.name, timer });

    // Start immediately — the user tapped a preset, they want it running.
    timer.start();
    saveCookingTimers();

    if (typeof SFX !== 'undefined') SFX.playStart();
    if (navigator.vibrate) navigator.vibrate(20);

    // Route to Timers › Cook where the existing multi-timer UI runs it.
    if (typeof TempoNav !== 'undefined' && TempoNav.applyRoute) {
      TempoNav.applyRoute({ pillar: 'timers', sub: 'cook' });
    } else {
      window.location.hash = '#/timers/cook';
    }

    // After the mode-switch animation settles, force the cooking UI to
    // re-render (pick up the new timer) and start its render loop if it
    // isn't already running.
    setTimeout(() => {
      try { if (typeof renderCookingTimers === 'function') renderCookingTimers(); } catch (e) {}
      try { if (typeof startCookingRenderLoop === 'function') startCookingRenderLoop(); } catch (e) {}
    }, 140);
  }

  function showCapNotice() {
    if (!capNoticeEl) return;
    capNoticeEl.hidden = false;
    setTimeout(() => { capNoticeEl.hidden = true; }, 3500);
  }

  // ── Recent Activity ─────────────────────────────────────────────────

  async function renderRecent() {
    if (!recentEl) return;
    recentEl.innerHTML = '<div class="wcook-recent-loading">Loading…</div>';
    let sessions = [];
    try {
      const all = await History.getSessions();
      sessions = all
        .filter(s => s.type === 'cooking')
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, RECENT_LIMIT);
    } catch (e) {
      recentEl.innerHTML = '';
      return;
    }

    if (sessions.length === 0) {
      recentEl.innerHTML = `
        <div class="wcook-recent-empty">
          <div class="wcook-recent-empty-mark" aria-hidden="true">\uD83D\uDD52</div>
          <p>No finished cooking timers yet. Tap a preset above to start.</p>
        </div>
      `;
      return;
    }

    recentEl.innerHTML = sessions.map(renderRecentRow).join('');
  }

  function renderRecentRow(session) {
    const name = escapeHtml(session.programName || 'Cooking timer');
    const when = formatWhen(session.date);
    const dur = formatDuration(session.duration || 0);
    return `
      <div class="wcook-recent-row">
        <div class="wcook-recent-row-main">
          <div class="wcook-recent-row-name">${name}</div>
          <div class="wcook-recent-row-when">${escapeHtml(when)}</div>
        </div>
        <div class="wcook-recent-row-duration">${dur}</div>
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
