// ── Cooking Mode UI ──
const COOKING_KEY = 'cooking_timers';
const COOKING_SUGGESTIONS = ['Rice', 'Pasta', 'Chicken', 'Veggies', 'Oven', 'Bread', 'Eggs', 'Sauce', 'Steak', 'Soup'];
const COOKING_QUICK_TIMES = [1, 3, 5, 10, 15, 20, 30];
// Different alarm frequencies per timer slot
const COOKING_TONES = [800, 1000, 1200, 600, 900];

let cookingTimers = [];
let cookingRafId = null;

function initCookingUI() {
  loadCookingTimers();

  // A2: a cook timer that crossed zero while the tab was closed reloads as
  // 'finished', but the alarm callback (the ONLY site that logs History) never
  // fires on the silent loadState recovery path (timer.js). Log any such
  // missed session once — idempotent via the persisted `logged` flag — so it
  // still shows up in History/Analytics, mirroring Flow's overflow re-save.
  let recoveredCooking = false;
  cookingTimers.forEach(ct => {
    if (ct.timer.getStatus() === 'finished' && !ct.logged && ct.timer.getDurationMs() > 0) {
      History.addSession({ type: 'cooking', duration: ct.timer.getDurationMs(), laps: [], programName: ct.timer.getName() });
      ct.logged = true;
      recoveredCooking = true;
    }
  });
  if (recoveredCooking) saveCookingTimers();

  document.getElementById('cooking-add-btn')?.addEventListener('click', addCookingTimer);

  // Restore running timers
  cookingTimers.forEach(ct => {
    if (ct.timer.getStatus() === 'running') {
      startCookingRenderLoop();
    }
  });

  renderCookingTimers();
}

function loadCookingTimers() {
  try {
    const saved = JSON.parse(localStorage.getItem(COOKING_KEY) || '[]');
    cookingTimers = saved.map((s, i) => {
      const timer = createTimer('cook-' + (s.id || i));
      timer.loadState(s.state);
      timer.setName(s.name || 'Timer');
      // Re-register alarm for each
      timer.onAlarm(() => cookingTimerAlarm(timer));
      return { id: s.id || Date.now().toString(36) + i, name: s.name || 'Timer', timer, logged: !!s.logged };
    });
  } catch (e) {
    cookingTimers = [];
  }
}

function saveCookingTimers() {
  try {
    const data = cookingTimers.map(ct => ({
      id: ct.id,
      name: ct.name,
      state: ct.timer.getState(),
      logged: !!ct.logged,
    }));
    localStorage.setItem(COOKING_KEY, JSON.stringify(data));
  } catch (e) {}
}

function addCookingTimer() {
  if (cookingTimers.length >= 8) return;
  // M10: append a short random suffix so two adds in the same millisecond
  // don't collide (handlers resolve via `.find(c => c.id === id)` — a dup id
  // controls/deletes the wrong timer). Matches the localTag pattern elsewhere.
  const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const idx = cookingTimers.length;
  const timer = createTimer('cook-' + id);
  const name = COOKING_SUGGESTIONS[idx % COOKING_SUGGESTIONS.length];
  timer.setName(name);
  timer.onAlarm(() => cookingTimerAlarm(timer));
  cookingTimers.push({ id, name, timer, logged: false });
  saveCookingTimers();
  renderCookingTimers();
}

function removeCookingTimer(id) {
  const ct = cookingTimers.find(c => c.id === id);
  if (ct) BgNotify.cancel('cook-' + ct.id);
  cookingTimers = cookingTimers.filter(c => c.id !== id);
  saveCookingTimers();
  renderCookingTimers();
}

function cookingTimerAlarm(timer) {
  // Distinct tone per slot — derive the slot from the timer's CURRENT position
  // so deleting a middle timer doesn't leave later timers playing a stale tone
  // (A13). The owning record is reused below to flag the logged episode.
  const ct = cookingTimers.find(c => c.timer === timer);
  const idx = ct ? cookingTimers.indexOf(ct) : 0;
  const freq = COOKING_TONES[idx % COOKING_TONES.length];
  // B6: play the two-tone chime through the shared SFX AudioContext instead of
  // allocating a NEW AudioContext per alarm (which was never closed — leaking a
  // context on every cook-timer finish, and stacking several when multiple
  // timers finished in the same frame). SFX.beep no-ops when muted.
  SFX.beep(freq, 500, 'sine', 0.2);
  setTimeout(() => SFX.beep(freq * 1.25, 500, 'sine', 0.2), 200);
  Platform.haptic([200, 100, 200, 100, 200]);
  Platform.notify(`${timer.getName()} Done`, { body: 'Your cooking timer has finished!' });
  announce(`${timer.getName()} timer done`); // D: SR parity with the chime/notification
  History.addSession({ type: 'cooking', duration: timer.getDurationMs(), laps: [], programName: timer.getName() });
  // Mark this finished episode logged so the tab-close→reopen recovery in
  // initCookingUI doesn't double-log it (A2).
  if (ct) ct.logged = true;
  saveCookingTimers();
  renderCookingTimers();
}

function renderCookingTimers() {
  const container = document.getElementById('cooking-timer-list');
  if (!container) return;

  if (cookingTimers.length === 0) {
    container.innerHTML = '<div class="cooking-empty">Tap "Add Timer" to start cooking</div>';
    return;
  }

  container.innerHTML = cookingTimers.map((ct, idx) => {
    const status = ct.timer.getStatus();
    const remaining = ct.timer.getRemainingMs();
    const t = Utils.formatMs(remaining);
    const timeStr = t.hours > 0
      ? `${t.hours}:${t.minStr}:${t.secStr}`
      : `${t.minStr}:${t.secStr}`;
    const statusCls = status === 'running' ? 'cooking-running'
      : status === 'finished' ? 'cooking-finished'
      : status === 'paused' ? 'cooking-paused' : '';

    const quickBtns = status === 'idle' ? `<div class="cooking-quick-btns">
      ${COOKING_QUICK_TIMES.map(m => `<button class="cooking-quick-btn" data-cook-id="${ct.id}" data-quick-min="${m}">${m}m</button>`).join('')}
    </div>` : '';

    let leftBtn, rightBtn;
    if (status === 'idle') {
      leftBtn = `<button class="cooking-ctrl-btn" disabled>--</button>`;
      rightBtn = `<button class="cooking-ctrl-btn cooking-ctrl-start" data-cook-start="${ct.id}">Start</button>`;
    } else if (status === 'running') {
      leftBtn = `<button class="cooking-ctrl-btn" disabled>--</button>`;
      rightBtn = `<button class="cooking-ctrl-btn cooking-ctrl-stop" data-cook-pause="${ct.id}">Pause</button>`;
    } else if (status === 'paused') {
      leftBtn = `<button class="cooking-ctrl-btn" data-cook-reset="${ct.id}">Reset</button>`;
      rightBtn = `<button class="cooking-ctrl-btn cooking-ctrl-start" data-cook-start="${ct.id}">Resume</button>`;
    } else if (status === 'finished') {
      leftBtn = `<button class="cooking-ctrl-btn" data-cook-reset="${ct.id}">Reset</button>`;
      rightBtn = `<button class="cooking-ctrl-btn" disabled>Done</button>`;
    }

    const adjustRow = (status === 'running' || status === 'paused') ? `
      <div class="cooking-adjust-row">
        <button class="cooking-adjust-btn" data-cook-adjust="${ct.id}" data-cook-delta="-180000" ${remaining < 180000 + 1000 ? 'disabled' : ''}>&minus;3 min</button>
        <button class="cooking-adjust-btn" data-cook-adjust="${ct.id}" data-cook-delta="180000">+3 min</button>
      </div>` : '';

    return `<div class="cooking-timer-card ${statusCls}" data-cook-card="${ct.id}">
      <div class="cooking-timer-header">
        <input type="text" class="cooking-timer-name" value="${escapeHtml(ct.name)}" data-cook-name="${ct.id}" maxlength="20" spellcheck="false">
        <button class="cooking-timer-delete" data-cook-del="${ct.id}">&times;</button>
      </div>
      <div class="cooking-timer-time" data-cook-time="${ct.id}">${timeStr}</div>
      ${quickBtns}
      <div class="cooking-timer-controls">${leftBtn}${rightBtn}</div>
      ${adjustRow}
    </div>`;
  }).join('');

  attachCookingHandlers();
}

function attachCookingHandlers() {
  const container = document.getElementById('cooking-timer-list');

  // Quick-set buttons
  container.querySelectorAll('.cooking-quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.cookId;
      const min = parseInt(btn.dataset.quickMin, 10);
      const ct = cookingTimers.find(c => c.id === id);
      if (ct && ct.timer.getStatus() === 'idle') {
        ct.timer.setDuration(min * 60000);
        saveCookingTimers();
        renderCookingTimers();
      }
    });
  });

  // Start/resume
  container.querySelectorAll('[data-cook-start]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ct = cookingTimers.find(c => c.id === btn.dataset.cookStart);
      if (ct && ct.timer.getDurationMs() > 0) {
        ct.logged = false; // fresh run / resume — re-arm missed-session logging (A2)
        ct.timer.start();
        BgNotify.schedule('cook-' + ct.id, ct.timer.getRemainingMs(), `${ct.name} Done`, 'Cooking timer finished!');
        saveCookingTimers();
        renderCookingTimers();
        startCookingRenderLoop();
      }
    });
  });

  // Pause
  container.querySelectorAll('[data-cook-pause]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ct = cookingTimers.find(c => c.id === btn.dataset.cookPause);
      if (ct) {
        ct.timer.pause();
        BgNotify.cancel('cook-' + ct.id);
        saveCookingTimers();
        renderCookingTimers();
      }
    });
  });

  // Reset
  container.querySelectorAll('[data-cook-reset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ct = cookingTimers.find(c => c.id === btn.dataset.cookReset);
      if (ct) {
        ct.logged = false; // reset clears the logged-episode flag (A2)
        ct.timer.reset();
        BgNotify.cancel('cook-' + ct.id);
        saveCookingTimers();
        renderCookingTimers();
      }
    });
  });

  // Delete
  container.querySelectorAll('[data-cook-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      removeCookingTimer(btn.dataset.cookDel);
    });
  });

  // ±3 min adjust per timer
  container.querySelectorAll('[data-cook-adjust]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ct = cookingTimers.find(c => c.id === btn.dataset.cookAdjust);
      if (!ct) return;
      const delta = parseInt(btn.dataset.cookDelta, 10);
      const ok = ct.timer.adjustRemainingMs(delta);
      if (!ok) return;
      if (ct.timer.getStatus() === 'running') {
        BgNotify.schedule('cook-' + ct.id, ct.timer.getRemainingMs(), `${ct.name} Done`, 'Cooking timer finished!');
      }
      saveCookingTimers();
      Platform.haptic(15);
      if (typeof SFX !== 'undefined' && SFX.playLap) SFX.playLap();
      renderCookingTimers();
    });
  });

  // Name editing
  container.querySelectorAll('.cooking-timer-name').forEach(input => {
    input.addEventListener('change', () => {
      const id = input.dataset.cookName;
      const ct = cookingTimers.find(c => c.id === id);
      if (ct) {
        ct.name = input.value.trim() || 'Timer';
        ct.timer.setName(ct.name);
        saveCookingTimers();
      }
    });
  });
}

// ── Cooking Render Loop ──
function startCookingRenderLoop() {
  if (cookingRafId !== null) return;
  function tick() {
    if (cookingRafId === null) return;
    let anyRunning = false;
    cookingTimers.forEach(ct => {
      if (ct.timer.getStatus() === 'running') {
        ct.timer.checkFinished();
        const el = document.querySelector(`[data-cook-time="${ct.id}"]`);
        if (el) {
          const remaining = ct.timer.getRemainingMs();
          const t = Utils.formatMs(remaining);
          el.textContent = t.hours > 0
            ? `${t.hours}:${t.minStr}:${t.secStr}`
            : `${t.minStr}:${t.secStr}`;
          // Refresh ‑3 disabled state without rebuilding the card
          const minusBtn = document.querySelector(`[data-cook-adjust="${ct.id}"][data-cook-delta="-180000"]`);
          if (minusBtn) minusBtn.disabled = remaining < 180000 + 1000;
        }
        if (ct.timer.getStatus() === 'running') anyRunning = true;
      }
    });
    if (anyRunning) {
      cookingRafId = requestAnimationFrame(tick);
    } else {
      cookingRafId = null;
      Platform.keepAwake(false); // F-pwa
    }
  }
  Platform.keepAwake(true); // F-pwa: keep screen on while timing
  cookingRafId = requestAnimationFrame(tick);
}

function stopCookingRenderLoop() {
  if (cookingRafId !== null) {
    cancelAnimationFrame(cookingRafId);
    cookingRafId = null;
  }
  Platform.keepAwake(false); // F-pwa
}
