// ── Compare View (Split-Screen) ──
let compareActive = false;
let compareInstanceId = null;
let compareRafId = null;

function enterCompare(instanceId) {
  const isStopwatch = appMode === 'stopwatch';
  const instances = isStopwatch ? InstanceManager.getStopwatches() : InstanceManager.getTimers();
  const target = instances.find(i => i.getId() === instanceId);
  if (!target) return;

  compareActive = true;
  compareInstanceId = instanceId;

  // Hide normal UI elements
  document.getElementById('timer-display').classList.add('hidden');
  document.getElementById('controls').classList.add('hidden');
  document.getElementById('instance-cards').classList.add('hidden');
  document.getElementById('offset-area').classList.add('hidden');
  document.getElementById('vibrate-area').classList.add('hidden');
  document.getElementById('alert-area').classList.add('hidden');
  document.getElementById('export-area').classList.add('hidden');
  document.getElementById('lap-stats').classList.add('hidden');
  document.getElementById('lap-section').classList.add('hidden');
  document.getElementById('lap-chart').classList.add('hidden');
  document.getElementById('timer-progress').classList.add('hidden');
  const timerSet = document.getElementById('timer-set-area');
  if (timerSet) timerSet.classList.add('hidden');

  // Show compare view
  const view = document.getElementById('compare-view');
  view.classList.remove('hidden');

  renderCompare();
  startCompareRenderLoop();
}

function exitCompare() {
  compareActive = false;
  compareInstanceId = null;
  stopCompareRenderLoop();

  // Hide compare view
  document.getElementById('compare-view').classList.add('hidden');

  // Restore normal UI via applyAppMode
  applyAppMode();
}

function isCompareActive() {
  return compareActive;
}

function renderCompare() {
  const view = document.getElementById('compare-view');
  if (!view || !compareActive) return;

  const isStopwatch = appMode === 'stopwatch';
  const primary = isStopwatch ? InstanceManager.getPrimaryStopwatch() : InstanceManager.getPrimaryTimer();
  const instances = isStopwatch ? InstanceManager.getStopwatches() : InstanceManager.getTimers();
  const secondary = instances.find(i => i.getId() === compareInstanceId);
  if (!secondary) { exitCompare(); return; }

  view.innerHTML = `
    <div class="compare-columns">
      ${renderCompareCol(primary, 'left', isStopwatch)}
      <div class="compare-divider"></div>
      ${renderCompareCol(secondary, 'right', isStopwatch)}
    </div>
    <button class="compare-exit" id="compare-exit-btn">Exit Compare</button>
  `;

  attachCompareHandlers(primary, secondary, isStopwatch);
}

function renderCompareCol(inst, side, isStopwatch) {
  const status = inst.getStatus();
  const ms = isStopwatch ? inst.getElapsedMs() : inst.getRemainingMs();
  const t = Utils.formatMs(ms);
  const timeStr = t.hours > 0
    ? `${t.hours}:${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`
    : `${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`;

  const statusCls = status === 'running' ? 'status-running'
    : status === 'paused' ? 'status-paused'
    : status === 'finished' ? 'status-finished'
    : 'status-idle';

  // Button state
  let leftText, leftCls, leftDisabled, rightText, rightCls;
  if (isStopwatch) {
    leftText = status === 'paused' ? 'Reset' : 'Lap';
    leftCls = status === 'paused' ? 'compare-btn' : 'compare-btn';
    leftDisabled = status === 'idle';
    rightText = status === 'running' ? 'Stop' : 'Start';
    rightCls = status === 'running' ? 'compare-btn compare-btn-stop' : 'compare-btn compare-btn-start';
  } else {
    leftText = (status === 'paused' || status === 'finished') ? 'Reset' : '--';
    leftDisabled = status === 'idle' || status === 'running';
    leftCls = 'compare-btn';
    rightText = status === 'running' ? 'Stop' : (status === 'finished' ? 'Done' : 'Start');
    rightCls = status === 'running' ? 'compare-btn compare-btn-stop' : 'compare-btn compare-btn-start';
  }

  return `<div class="compare-col" data-side="${side}" data-inst-id="${inst.getId()}">
    <span class="compare-name" contenteditable="true" spellcheck="false" data-cname-id="${inst.getId()}">${escapeCompareHtml(inst.getName())}</span>
    <div class="compare-status card-status ${statusCls}"></div>
    <div class="compare-time" data-ctime-id="${inst.getId()}">${timeStr}</div>
    <div class="compare-controls">
      <button class="compare-btn ${leftCls}" data-cleft="${inst.getId()}" ${leftDisabled ? 'disabled' : ''}>${leftText}</button>
      <button class="${rightCls}" data-cright="${inst.getId()}">${rightText}</button>
    </div>
  </div>`;
}

function attachCompareHandlers(primary, secondary, isStopwatch) {
  // Exit button
  document.getElementById('compare-exit-btn').addEventListener('click', exitCompare);

  // Name editing
  document.querySelectorAll('.compare-name').forEach(el => {
    el.addEventListener('blur', () => {
      const id = el.dataset.cnameId;
      const inst = [primary, secondary].find(i => i.getId() === id);
      if (inst) {
        inst.setName(el.textContent.trim().substring(0, 30) || (isStopwatch ? 'Stopwatch' : 'Timer'));
        Persistence.save();
      }
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    });
  });

  // Control buttons
  document.querySelectorAll('[data-cleft]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.cleft;
      const inst = [primary, secondary].find(i => i.getId() === id);
      if (!inst) return;
      if (isStopwatch) {
        const status = inst.getStatus();
        if (status === 'running') { inst.lap(); }
        else if (status === 'paused') { inst.reset(); }
        Persistence.save();
      } else {
        const status = inst.getStatus();
        if (status === 'paused' || status === 'finished') { inst.reset(); }
        Persistence.save();
      }
      renderCompare();
      startCompareRenderLoop();
    });
  });

  document.querySelectorAll('[data-cright]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.cright;
      const inst = [primary, secondary].find(i => i.getId() === id);
      if (!inst) return;
      if (isStopwatch) {
        const status = inst.getStatus();
        if (status === 'running') { inst.pause(); }
        else { inst.start(); }
      } else {
        const status = inst.getStatus();
        if (status === 'running') { inst.pause(); }
        else if (status === 'idle' || status === 'paused') {
          if (inst.getDurationMs() > 0) inst.start();
        }
      }
      Persistence.save();
      renderCompare();
      startCompareRenderLoop();
    });
  });
}

// ── Compare Render Loop ──
function startCompareRenderLoop() {
  if (compareRafId !== null) return;
  function tick() {
    if (!compareActive) { compareRafId = null; return; }

    const isStopwatch = appMode === 'stopwatch';
    const primary = isStopwatch ? InstanceManager.getPrimaryStopwatch() : InstanceManager.getPrimaryTimer();
    const instances = isStopwatch ? InstanceManager.getStopwatches() : InstanceManager.getTimers();
    const secondary = instances.find(i => i.getId() === compareInstanceId);

    if (!secondary) { compareRafId = null; exitCompare(); return; }

    // Update time displays
    [primary, secondary].forEach(inst => {
      const el = document.querySelector(`[data-ctime-id="${inst.getId()}"]`);
      if (el) {
        const ms = isStopwatch ? inst.getElapsedMs() : inst.getRemainingMs();
        const t = Utils.formatMs(ms);
        el.innerHTML = t.hours > 0
          ? `${t.hours}:${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`
          : `${t.minStr}:${t.secStr}<span class="centiseconds">.${t.csStr}</span>`;
      }
    });

    // Check if any instance is running to keep the loop going
    const anyRunning = primary.getStatus() === 'running' || (secondary && secondary.getStatus() === 'running');
    if (anyRunning) {
      compareRafId = requestAnimationFrame(tick);
    } else {
      compareRafId = null;
    }
  }
  compareRafId = requestAnimationFrame(tick);
}

function stopCompareRenderLoop() {
  if (compareRafId !== null) {
    cancelAnimationFrame(compareRafId);
    compareRafId = null;
  }
}

// Uses shared escapeHtml from dom-utils.js
const escapeCompareHtml = escapeHtml;
