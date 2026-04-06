// ── Alert UI ──
function initAlertUI() {
  const toggleBtn = document.getElementById('alert-toggle');
  const inputArea = document.getElementById('alert-input');
  const setBtn = document.getElementById('alert-set');
  const cancelBtn = document.getElementById('alert-cancel');
  const hoursEl = document.getElementById('alert-hours');
  const minutesEl = document.getElementById('alert-minutes');
  const secondsEl = document.getElementById('alert-seconds');

  toggleBtn.addEventListener('click', () => {
    inputArea.removeAttribute('data-collapsed');
    toggleBtn.classList.add('hidden');
    minutesEl.focus();
    minutesEl.select();
    // Request notification permission proactively
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  });

  cancelBtn.addEventListener('click', () => {
    inputArea.setAttribute('data-collapsed', '');
    toggleBtn.classList.remove('hidden');
    hoursEl.value = 0;
    minutesEl.value = 0;
    secondsEl.value = 0;
  });

  setBtn.addEventListener('click', () => {
    const h = Math.min(99, Math.max(0, parseInt(hoursEl.value, 10) || 0));
    const m = Math.min(59, Math.max(0, parseInt(minutesEl.value, 10) || 0));
    const s = Math.min(59, Math.max(0, parseInt(secondsEl.value, 10) || 0));
    const ms = (h * 3600 + m * 60 + s) * 1000;
    if (ms > 0) {
      Stopwatch.addAlert(ms);
      Persistence.save();
      renderAlerts();
    }
    inputArea.setAttribute('data-collapsed', '');
    toggleBtn.classList.remove('hidden');
    hoursEl.value = 0;
    minutesEl.value = 0;
    secondsEl.value = 0;
  });

  // Enter key in alert fields
  [hoursEl, minutesEl, secondsEl].forEach(el => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); setBtn.click(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelBtn.click(); }
    });
  });

  renderAlerts();
}

function renderAlerts() {
  const listEl = document.getElementById('alert-list');
  if (!listEl) return;
  const alerts = Stopwatch.getAlerts();
  if (alerts.length === 0) {
    listEl.innerHTML = '';
    return;
  }
  listEl.innerHTML = alerts.map(a => {
    const t = Utils.formatMs(a.ms);
    const timeStr = t.hours > 0
      ? `${t.hours}:${t.minStr}:${t.secStr}`
      : `${t.minStr}:${t.secStr}`;
    const icon = a.fired ? '✓' : '⏰';
    const cls = a.fired ? 'alert-chip alert-chip-fired' : 'alert-chip';
    return `<span class="${cls}">
      <span class="alert-chip-icon">${icon}</span>
      ${timeStr}
      <button class="alert-chip-delete" data-alert-ms="${a.ms}">&times;</button>
    </span>`;
  }).join('');

  listEl.querySelectorAll('.alert-chip-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      Stopwatch.removeAlert(Number(btn.dataset.alertMs));
      Persistence.save();
      renderAlerts();
    });
  });
}
