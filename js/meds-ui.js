// Meds UI — the Wellness › Meds surface (V2, prescription-focused).
//
// Each medication card shows name + dose + frequency, a "today" status
// (Taken today ✓ / 1 of 2 today / Not taken today / Last taken X ago),
// and two logging actions:
//   - "Took it now"  → logDose(Date.now())
//   - "Took it ~"    → retroactive offset input → logDose(now - offset)
// No live countdown. A coarse ~30s tick keeps "X ago" strings fresh for
// as-needed meds and handles midnight rollover for daily meds.

const MedsUI = (() => {
  const FREQ_OPTIONS = [
    { value: 'once-daily',  label: 'Once daily' },
    { value: 'twice-daily', label: 'Twice daily' },
    { value: 'as-needed',   label: 'As-needed' },
  ];
  const FREQ_LABEL = Object.fromEntries(FREQ_OPTIONS.map(o => [o.value, o.label]));

  let surfaceEl, addBtn, formEl, listEl, emptyEl;
  let editingId = null;
  let tickTimer = null;

  function init() {
    surfaceEl = document.querySelector('[data-wellness-sub="meds"]');
    if (!surfaceEl) return;

    MedsManager.loadAll();

    addBtn  = surfaceEl.querySelector('#meds-add-btn');
    formEl  = surfaceEl.querySelector('#meds-add-form');
    listEl  = surfaceEl.querySelector('#meds-list');
    emptyEl = surfaceEl.querySelector('#meds-empty');

    wireAddButton();
    wireForm();
    render();
    startTick();
  }

  // ── Rendering ───────────────────────────────────────────────────────

  function render() {
    const meds = MedsManager.all();
    if (meds.length === 0) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    listEl.innerHTML = meds.map(renderCard).join('');
    meds.forEach(med => {
      refreshCardStatus(med);
      wireCardButtons(med);
    });
  }

  function renderCard(med) {
    const id = med.getId();
    const name = escapeHtml(med.getName());
    const dose = med.getDose();
    const freq = FREQ_LABEL[med.getFrequency()] || 'Once daily';
    const subtitle = dose ? `${escapeHtml(dose)} · ${freq}` : freq;
    return `
      <article class="med-card" data-med-id="${id}">
        <header class="med-card-header">
          <div class="med-card-heading">
            <h3 class="med-card-name">${name}</h3>
            <div class="med-card-dose">${subtitle}</div>
          </div>
          <div class="med-card-actions">
            <button class="med-icon-btn" data-action="edit" aria-label="Edit ${name}" title="Edit">✎</button>
            <button class="med-icon-btn" data-action="delete" aria-label="Delete ${name}" title="Delete">×</button>
          </div>
        </header>
        <div class="med-card-status" data-status>—</div>
        <div class="med-card-last" data-last></div>
        <div class="med-card-buttons">
          <button class="med-btn med-btn-primary" data-action="log-now">Took it now</button>
          <button class="med-btn med-btn-secondary" data-action="log-offset">Took it ~</button>
        </div>
        <div class="med-offset" data-offset hidden>
          <div class="med-offset-row">
            <label>
              <span>Hours</span>
              <input type="number" min="0" max="48" value="0" data-offset-h>
            </label>
            <label>
              <span>Minutes</span>
              <input type="number" min="0" max="59" value="30" data-offset-m>
            </label>
          </div>
          <div class="med-offset-actions">
            <button class="med-btn med-btn-primary" data-action="apply-offset">Log dose</button>
            <button class="med-btn med-btn-ghost" data-action="cancel-offset">Cancel</button>
          </div>
        </div>
      </article>
    `;
  }

  function refreshCardStatus(med) {
    const card = listEl.querySelector(`[data-med-id="${med.getId()}"]`);
    if (!card) return;

    const statusEl = card.querySelector('[data-status]');
    const lastEl   = card.querySelector('[data-last]');

    const { kind, takenToday, expected } = med.getStatusToday();
    let statusText, statusClass;

    if (kind === 'done') {
      statusText = 'Taken today ✓';
      statusClass = 'med-status-done';
    } else if (kind === 'partial') {
      statusText = `${takenToday} of ${expected} today`;
      statusClass = 'med-status-partial';
    } else if (kind === 'none') {
      statusText = 'Not taken today';
      statusClass = 'med-status-none';
    } else {
      // kind === 'na' (as-needed)
      const sinceMs = med.getTimeSinceLastDoseMs();
      if (sinceMs === null) {
        statusText = 'Never taken';
        statusClass = 'med-status-none';
      } else {
        statusText = `Last taken ${formatDuration(sinceMs)} ago`;
        statusClass = 'med-status-asneeded';
      }
    }

    statusEl.textContent = statusText;
    statusEl.className = 'med-card-status ' + statusClass;

    // Secondary "Last dose at H:MM AM/PM today|yesterday|MMM D"
    const last = med.getLastTakenAt();
    if (last === null) {
      lastEl.textContent = '';
    } else {
      lastEl.textContent = formatLastDose(last);
    }
  }

  function refreshAllCards() {
    MedsManager.all().forEach(refreshCardStatus);
  }

  // ── Card button handlers ────────────────────────────────────────────

  function wireCardButtons(med) {
    const card = listEl.querySelector(`[data-med-id="${med.getId()}"]`);
    if (!card) return;

    card.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;

      if (action === 'log-now') {
        med.logDose();
        MedsManager.saveAll();
        refreshCardStatus(med);
        flash(card);
        if (typeof SFX !== 'undefined') SFX.playLap();
        if (navigator.vibrate) navigator.vibrate(30);

      } else if (action === 'log-offset') {
        // Prefill with 30 min (user can adjust). No schedule to derive
        // a smarter default from.
        card.querySelector('[data-offset-h]').value = '0';
        card.querySelector('[data-offset-m]').value = '30';
        toggleOffset(card, true);
        card.querySelector('[data-offset-m]').focus();
        card.querySelector('[data-offset-m]').select?.();

      } else if (action === 'cancel-offset') {
        toggleOffset(card, false);

      } else if (action === 'apply-offset') {
        const h  = parseInt(card.querySelector('[data-offset-h]').value, 10) || 0;
        const mm = parseInt(card.querySelector('[data-offset-m]').value, 10) || 0;
        const offsetMs = (h * 3600 + mm * 60) * 1000;
        if (offsetMs > 0) {
          med.logDose(Date.now() - offsetMs);
          MedsManager.saveAll();
          refreshCardStatus(med);
          flash(card);
          if (typeof SFX !== 'undefined') SFX.playLap();
          if (navigator.vibrate) navigator.vibrate(30);
        }
        toggleOffset(card, false);

      } else if (action === 'delete') {
        if (confirm(`Delete "${med.getName()}"?`)) {
          MedsManager.remove(med.getId());
          MedsManager.saveAll();
          render();
        }

      } else if (action === 'edit') {
        openEditForm(med);
      }
    });
  }

  function toggleOffset(card, show) {
    const panel = card.querySelector('[data-offset]');
    if (panel) panel.hidden = !show;
  }

  function flash(card) {
    card.classList.add('med-card-flash');
    setTimeout(() => card.classList.remove('med-card-flash'), 600);
  }

  // ── Add / Edit form ─────────────────────────────────────────────────

  function wireAddButton() {
    if (!addBtn) return;
    addBtn.addEventListener('click', () => openAddForm());
  }

  function wireForm() {
    if (!formEl) return;
    formEl.querySelector('[data-form-save]').addEventListener('click', saveForm);
    formEl.querySelector('[data-form-cancel]').addEventListener('click', closeForm);

    formEl.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); saveForm(); }
        else if (e.key === 'Escape') { e.preventDefault(); closeForm(); }
      });
    });
  }

  function openAddForm() {
    editingId = null;
    formEl.querySelector('[data-form-title]').textContent = 'Add medication';
    formEl.querySelector('[data-field-name]').value = '';
    formEl.querySelector('[data-field-dose]').value = '';
    formEl.querySelector('[data-field-frequency]').value = 'once-daily';
    formEl.hidden = false;
    if (addBtn) addBtn.hidden = true;
    formEl.querySelector('[data-field-name]').focus();
  }

  function openEditForm(med) {
    editingId = med.getId();
    formEl.querySelector('[data-form-title]').textContent = 'Edit medication';
    formEl.querySelector('[data-field-name]').value = med.getName();
    formEl.querySelector('[data-field-dose]').value = med.getDose();
    formEl.querySelector('[data-field-frequency]').value = med.getFrequency();
    formEl.hidden = false;
    if (addBtn) addBtn.hidden = true;
    formEl.querySelector('[data-field-name]').focus();
    formEl.querySelector('[data-field-name]').select?.();
  }

  function closeForm() {
    formEl.hidden = true;
    if (addBtn) addBtn.hidden = false;
    editingId = null;
  }

  function saveForm() {
    const nameEl = formEl.querySelector('[data-field-name]');
    const doseEl = formEl.querySelector('[data-field-dose]');
    const freqEl = formEl.querySelector('[data-field-frequency]');

    const name = nameEl.value.trim();
    const dose = doseEl.value.trim();
    const frequency = freqEl.value;

    if (!name) {
      nameEl.focus();
      flashInput(nameEl);
      return;
    }

    if (editingId) {
      const med = MedsManager.get(editingId);
      if (med) {
        med.setName(name);
        med.setDose(dose);
        med.setFrequency(frequency);
      }
    } else {
      MedsManager.add({ name, dose, frequency });
    }
    MedsManager.saveAll();
    closeForm();
    render();
  }

  function flashInput(el) {
    el.classList.add('med-input-invalid');
    setTimeout(() => el.classList.remove('med-input-invalid'), 400);
  }

  // ── Ticker (coarse refresh, ~30s) ───────────────────────────────────

  function startTick() {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
      if (isSurfaceVisible()) refreshAllCards();
    }, 30000);
  }

  function isSurfaceVisible() {
    if (!surfaceEl || surfaceEl.hidden) return false;
    const pillar = surfaceEl.closest('.tempo-pillar');
    if (!pillar || pillar.dataset.active !== 'true') return false;
    return true;
  }

  // ── Formatting helpers ──────────────────────────────────────────────

  function formatDuration(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const days  = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins  = Math.floor((totalSec % 3600) / 60);
    const secs  = totalSec % 60;
    if (days > 0)  return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    if (mins > 0)  return `${mins}m`;
    return `${secs}s`;
  }

  function formatLastDose(ts) {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (sameDay)     return `Last dose at ${time}`;
    if (isYesterday) return `Last dose yesterday at ${time}`;
    const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `Last dose ${dateStr} at ${time}`;
  }

  function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = String(str ?? '');
    return el.innerHTML;
  }

  return { init };
})();
