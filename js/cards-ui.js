const CardsUI = (() => {
  let container;
  let cardTickId = null;

  function init() {
    container = document.getElementById('instance-cards');
  }

  function render() {
    if (!container) return;

    const isStopwatch = appMode === 'stopwatch';
    const isTimer = appMode === 'timer';

    if (!isStopwatch && !isTimer) {
      container.innerHTML = '';
      stopCardTick();
      return;
    }

    const instances = isStopwatch ? InstanceManager.getStopwatches() : InstanceManager.getTimers();
    const primaryId = isStopwatch
      ? InstanceManager.getPrimaryStopwatch().getId()
      : InstanceManager.getPrimaryTimer().getId();
    const max = InstanceManager.MAX_INSTANCES;
    const modeLabel = isStopwatch ? 'Stopwatch' : 'Timer';

    let html = '';

    // Render non-primary instances as cards
    instances.forEach(inst => {
      if (inst.getId() === primaryId) return;
      const status = inst.getStatus();
      const time = formatCardTime(inst, isTimer);
      const statusCls = status === 'running' ? 'status-running'
        : status === 'paused' ? 'status-paused'
        : status === 'finished' ? 'status-finished'
        : 'status-idle';

      html += `<div class="instance-card" data-instance-id="${inst.getId()}">
        <span class="card-status ${statusCls}"></span>
        <span class="card-name" contenteditable="true" spellcheck="false" data-name-id="${inst.getId()}">${escapeHtml(inst.getName())}</span>
        <span class="card-time" data-time-id="${inst.getId()}">${time}</span>
        <button class="card-delete" data-delete-id="${inst.getId()}" aria-label="Delete">&times;</button>
      </div>`;
    });

    // Add button
    if (instances.length < max) {
      html += `<button class="instance-add-btn" id="add-instance-btn">+ Add ${modeLabel}</button>`;
    }

    container.innerHTML = html;
    attachHandlers(isStopwatch);

    // Start/stop tick based on whether any non-primary is running
    const hasRunning = instances.some(inst =>
      inst.getId() !== primaryId && inst.getStatus() === 'running'
    );
    if (hasRunning) {
      startCardTick();
    } else {
      stopCardTick();
    }
  }

  function attachHandlers(isStopwatch) {
    // Card tap → swap to primary
    container.querySelectorAll('.instance-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.card-delete') || e.target.closest('.card-name')) return;
        const id = card.dataset.instanceId;
        swapPrimary(id, isStopwatch);
      });
    });

    // Delete buttons
    container.querySelectorAll('.card-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.deleteId;
        if (isStopwatch) {
          InstanceManager.removeStopwatch(id);
        } else {
          InstanceManager.removeTimer(id);
        }
        Persistence.save();
        render();
      });
    });

    // Name editing
    container.querySelectorAll('.card-name').forEach(el => {
      el.addEventListener('blur', () => {
        const id = el.dataset.nameId;
        const newName = el.textContent.trim().substring(0, 30) || (isStopwatch ? 'Stopwatch' : 'Timer');
        const instances = isStopwatch ? InstanceManager.getStopwatches() : InstanceManager.getTimers();
        const inst = instances.find(i => i.getId() === id);
        if (inst) {
          inst.setName(newName);
          Persistence.save();
        }
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      });
    });

    // Add button
    const addBtn = document.getElementById('add-instance-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        if (isStopwatch) {
          InstanceManager.addStopwatch();
        } else {
          InstanceManager.addTimer();
        }
        Persistence.save();
        render();
      });
    }
  }

  function swapPrimary(id, isStopwatch) {
    if (isStopwatch) {
      // Stop stopwatch render loop before swap
      UI.stopRenderLoop();
      InstanceManager.setPrimaryStopwatch(id);
      UI.syncUI();
    } else {
      stopTimerRenderLoop();
      InstanceManager.setPrimaryTimer(id);
      // Re-register alarm callback on the new primary Timer
      initTimerAlarm();
      updateTimerUI();
      if (Timer.getStatus() === 'running') {
        startTimerRenderLoop();
      }
    }
    Persistence.save();
    render();
  }

  // ── Card Time Tick ──

  function startCardTick() {
    if (cardTickId !== null) return;
    cardTickId = setInterval(updateCardTimes, 100);
  }

  function stopCardTick() {
    if (cardTickId !== null) {
      clearInterval(cardTickId);
      cardTickId = null;
    }
  }

  function updateCardTimes() {
    const isStopwatch = appMode === 'stopwatch';
    const isTimer = appMode === 'timer';
    if (!isStopwatch && !isTimer) { stopCardTick(); return; }

    const instances = isStopwatch ? InstanceManager.getStopwatches() : InstanceManager.getTimers();
    const primaryId = isStopwatch
      ? InstanceManager.getPrimaryStopwatch().getId()
      : InstanceManager.getPrimaryTimer().getId();

    let anyRunning = false;
    instances.forEach(inst => {
      if (inst.getId() === primaryId) return;
      const el = container.querySelector(`[data-time-id="${inst.getId()}"]`);
      if (el) {
        el.textContent = formatCardTime(inst, isTimer);
      }
      // Update status dot
      const card = container.querySelector(`[data-instance-id="${inst.getId()}"]`);
      if (card) {
        const dot = card.querySelector('.card-status');
        if (dot) {
          const status = inst.getStatus();
          dot.className = 'card-status ' + (
            status === 'running' ? 'status-running'
            : status === 'paused' ? 'status-paused'
            : status === 'finished' ? 'status-finished'
            : 'status-idle'
          );
        }
      }
      if (inst.getStatus() === 'running') anyRunning = true;
    });

    if (!anyRunning) stopCardTick();
  }

  // ── Helpers ──

  function formatCardTime(inst, isTimer) {
    let ms;
    if (isTimer) {
      ms = inst.getRemainingMs ? inst.getRemainingMs() : 0;
    } else {
      ms = inst.getElapsedMs();
    }
    const t = Utils.formatMs(ms);
    if (t.hours > 0) {
      return `${t.hours}:${t.minStr}:${t.secStr}`;
    }
    return `${t.minStr}:${t.secStr}.${t.csStr}`;
  }

  function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
  }

  return { init, render };
})();
