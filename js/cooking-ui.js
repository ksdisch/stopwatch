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
      timer.onAlarm(() => cookingTimerAlarm(timer, i));
      return { id: s.id || Date.now().toString(36) + i, name: s.name || 'Timer', timer };
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
    }));
    localStorage.setItem(COOKING_KEY, JSON.stringify(data));
  } catch (e) {}
}

function addCookingTimer() {
  if (cookingTimers.length >= 8) return;
  const id = Date.now().toString(36);
  const idx = cookingTimers.length;
  const timer = createTimer('cook-' + id);
  const name = COOKING_SUGGESTIONS[idx % COOKING_SUGGESTIONS.length];
  timer.setName(name);
  timer.onAlarm(() => cookingTimerAlarm(timer, idx));
  cookingTimers.push({ id, name, timer });
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

function cookingTimerAlarm(timer, idx) {
  // Distinct tone per slot
  const freq = COOKING_TONES[idx % COOKING_TONES.length];
  if (!SFX.isMuted()) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
      // Second beep
      setTimeout(() => {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.frequency.value = freq * 1.25;
        gain2.gain.setValueAtTime(0.2, ctx.currentTime);
        gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start();
        osc2.stop(ctx.currentTime + 0.5);
      }, 200);
    } catch (e) {}
  }
  if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(`${timer.getName()} Done`, { body: 'Your cooking timer has finished!' });
  }
  History.addSession({ type: 'cooking', duration: timer.getDurationMs(), laps: [], programName: timer.getName() });
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
      if (typeof navigator.vibrate === 'function') navigator.vibrate(15);
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
    }
  }
  cookingRafId = requestAnimationFrame(tick);
}

function stopCookingRenderLoop() {
  if (cookingRafId !== null) {
    cancelAnimationFrame(cookingRafId);
    cookingRafId = null;
  }
}
