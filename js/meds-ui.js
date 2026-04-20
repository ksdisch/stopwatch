// Meds UI — the Wellness › Meds surface.
//
// Renders cards for each medication with live-updating countdowns,
// dose-logging buttons (now or ~X ago), and an add/edit form.
//
// Notifications: a single 1s poll runs for the session lifetime (not
// gated on pillar visibility), so dose-due alerts fire even when the
// user is on Timers or another pillar.

const MedsUI = (() => {
  let surfaceEl, addBtn, formEl, listEl, emptyEl;
  let editingId = null;
  let pollTimer = null;
  let notifPermissionAsked = false;

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
    startPoll();
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
      updateCardTimes(med);
      wireCardButtons(med);
    });
  }

  function renderCard(med) {
    const id = med.getId();
    const name = escapeHtml(med.getName());
    return `
      <article class="med-card" data-med-id="${id}">
        <header class="med-card-header">
          <div class="med-card-heading">
            <h3 class="med-card-name">${name}</h3>
            <div class="med-card-schedule">${escapeHtml(scheduleLabel(med))}</div>
          </div>
          <div class="med-card-actions">
            <button class="med-icon-btn" data-action="edit" aria-label="Edit ${name}" title="Edit">✎</button>
            <button class="med-icon-btn" data-action="delete" aria-label="Delete ${name}" title="Delete">×</button>
          </div>
        </header>
        <div class="med-card-countdown" data-countdown>—</div>
        <div class="med-card-since" data-since>Never taken</div>
        <div class="med-card-buttons">
          <button class="med-btn med-btn-primary" data-action="log-now">Log dose now</button>
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

  function scheduleLabel(med) {
    if (med.getScheduleType() === 'interval') {
      const h = med.getIntervalMs() / 3600000;
      if (h >= 24 && Math.abs(h % 24) < 0.001) {
        const days = Math.round(h / 24);
        return `Every ${days} day${days === 1 ? '' : 's'}`;
      }
      if (Number.isInteger(h)) return `Every ${h} h`;
      return `Every ${h.toFixed(1)} h`;
    }
    const t = med.getTimes();
    return t.length ? `At ${t.join(', ')}` : 'No times set';
  }

  function updateCardTimes(med) {
    const card = listEl.querySelector(`[data-med-id="${med.getId()}"]`);
    if (!card) return;

    const cd = card.querySelector('[data-countdown]');
    const since = card.querySelector('[data-since]');

    const until = med.getTimeUntilNextDoseMs();
    if (until === null) {
      cd.textContent = 'No schedule set';
      cd.className = 'med-card-countdown med-card-countdown-empty';
    } else if (until <= 0) {
      const overdue = -until;
      if (overdue < 60000 || med.getLastTakenAt() === null) {
        cd.textContent = 'Due now';
        cd.className = 'med-card-countdown med-card-countdown-due';
      } else {
        cd.textContent = `Overdue by ${formatDuration(overdue)}`;
        cd.className = 'med-card-countdown med-card-countdown-overdue';
      }
    } else {
      cd.textContent = `Next dose in ${formatDuration(until)}`;
      cd.className = 'med-card-countdown';
    }

    const sinceMs = med.getTimeSinceLastDoseMs();
    if (sinceMs === null) {
      since.textContent = 'Never taken';
    } else {
      since.textContent = `${formatDuration(sinceMs)} since last dose`;
    }

    card.classList.toggle('med-card-is-due', med.isDue() && med.getLastTakenAt() !== null);
    card.classList.toggle('med-card-never-taken', med.getLastTakenAt() === null);
  }

  function updateAllCards() {
    MedsManager.all().forEach(updateCardTimes);
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
        updateCardTimes(med);
        flash(card);
        if (typeof SFX !== 'undefined') SFX.playLap();
        if (navigator.vibrate) navigator.vibrate(30);

      } else if (action === 'log-offset') {
        // Prefill with the most likely "when did I actually take it" value:
        //   - times schedule → time since the most recent scheduled slot
        //   - interval + overdue → overdue amount
        //   - otherwise → 30 minutes (quick-edit baseline)
        const defMs = defaultOffsetMs(med);
        const hh = Math.floor(defMs / 3600000);
        const mm = Math.floor((defMs % 3600000) / 60000);
        card.querySelector('[data-offset-h]').value = String(hh);
        card.querySelector('[data-offset-m]').value = String(mm);
        toggleOffset(card, true);
        card.querySelector('[data-offset-m]').focus();
        card.querySelector('[data-offset-m]').select?.();

      } else if (action === 'cancel-offset') {
        toggleOffset(card, false);

      } else if (action === 'apply-offset') {
        const h = parseInt(card.querySelector('[data-offset-h]').value, 10) || 0;
        const mm = parseInt(card.querySelector('[data-offset-m]').value, 10) || 0;
        const offsetMs = (h * 3600 + mm * 60) * 1000;
        if (offsetMs > 0) {
          med.logDose(Date.now() - offsetMs);
          MedsManager.saveAll();
          updateCardTimes(med);
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

  function defaultOffsetMs(med) {
    const FALLBACK = 30 * 60000;
    const now = Date.now();

    if (med.getScheduleType() === 'times') {
      const times = med.getTimes();
      if (times.length === 0) return FALLBACK;
      // Search today and yesterday for the most recent scheduled slot
      // that's already in the past. Clamp at 48h to match the input max.
      let mostRecent = null;
      for (let dayOffset = 0; dayOffset >= -1; dayOffset--) {
        for (const t of times) {
          const [h, m] = t.split(':').map(Number);
          const d = new Date();
          d.setDate(d.getDate() + dayOffset);
          d.setHours(h, m, 0, 0);
          if (d.getTime() < now && (mostRecent === null || d.getTime() > mostRecent)) {
            mostRecent = d.getTime();
          }
        }
      }
      if (mostRecent === null) return FALLBACK;
      const ago = Math.min(now - mostRecent, 48 * 3600000);
      return Math.max(0, ago);
    }

    // interval schedule: if overdue, default to overdue amount
    const last = med.getLastTakenAt();
    if (last === null) return FALLBACK;
    const nextDue = last + med.getIntervalMs();
    if (now > nextDue) return Math.min(now - nextDue, 48 * 3600000);
    return FALLBACK;
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
    formEl.querySelector('[data-field-schedule-type]').addEventListener('change', syncFormVisibility);
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
    formEl.querySelector('[data-field-schedule-type]').value = 'interval';
    formEl.querySelector('[data-field-interval]').value = '6';
    formEl.querySelector('[data-field-times]').value = '';
    formEl.hidden = false;
    addBtn.hidden = true;
    syncFormVisibility();
    formEl.querySelector('[data-field-name]').focus();

    maybeRequestNotificationPermission();
  }

  function openEditForm(med) {
    editingId = med.getId();
    formEl.querySelector('[data-form-title]').textContent = 'Edit medication';
    formEl.querySelector('[data-field-name]').value = med.getName();
    formEl.querySelector('[data-field-schedule-type]').value = med.getScheduleType();
    formEl.querySelector('[data-field-interval]').value =
      String(med.getIntervalMs() / 3600000);
    formEl.querySelector('[data-field-times]').value = med.getTimes().join(', ');
    formEl.hidden = false;
    addBtn.hidden = true;
    syncFormVisibility();
    formEl.querySelector('[data-field-name]').focus();
    formEl.querySelector('[data-field-name]').select?.();
  }

  function closeForm() {
    formEl.hidden = true;
    addBtn.hidden = false;
    editingId = null;
  }

  function syncFormVisibility() {
    const type = formEl.querySelector('[data-field-schedule-type]').value;
    formEl.querySelector('[data-field-interval-row]').hidden = (type !== 'interval');
    formEl.querySelector('[data-field-times-row]').hidden = (type !== 'times');
  }

  function saveForm() {
    const name = formEl.querySelector('[data-field-name]').value.trim();
    const type = formEl.querySelector('[data-field-schedule-type]').value;
    if (!name) {
      const el = formEl.querySelector('[data-field-name]');
      el.focus();
      flashInput(el);
      return;
    }

    let patch;
    if (type === 'interval') {
      const hours = parseFloat(formEl.querySelector('[data-field-interval]').value);
      if (isNaN(hours) || hours <= 0) {
        flashInput(formEl.querySelector('[data-field-interval]'));
        return;
      }
      patch = { scheduleType: 'interval', intervalMs: Math.round(hours * 3600000) };
    } else {
      const timesRaw = formEl.querySelector('[data-field-times]').value;
      const times = timesRaw.split(',').map(s => s.trim()).filter(Boolean);
      if (times.length === 0) {
        flashInput(formEl.querySelector('[data-field-times]'));
        return;
      }
      patch = { scheduleType: 'times', times };
    }

    if (editingId) {
      const med = MedsManager.get(editingId);
      if (med) {
        med.setName(name);
        if (patch.scheduleType === 'times') med.setTimesSchedule(patch.times);
        else med.setIntervalSchedule(patch.intervalMs);
      }
    } else {
      MedsManager.add({ name, ...patch });
    }
    MedsManager.saveAll();
    closeForm();
    render();
  }

  function flashInput(el) {
    el.classList.add('med-input-invalid');
    setTimeout(() => el.classList.remove('med-input-invalid'), 400);
  }

  // ── Notifications / polling ─────────────────────────────────────────

  function maybeRequestNotificationPermission() {
    if (notifPermissionAsked) return;
    notifPermissionAsked = true;
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try { Notification.requestPermission(); } catch (e) { /* some browsers require user gesture only */ }
    }
  }

  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(tick, 1000);
    tick();
  }

  function tick() {
    MedsManager.all().forEach(med => {
      if (med.shouldFireDueNotification()) {
        fireDue(med);
        med.markDueNotified();
        MedsManager.saveAll();
      }
    });
    // Only touch the DOM if the Meds surface is visible — cheap guard
    // avoids unnecessary paints when the user is on another pillar.
    if (isSurfaceVisible()) updateAllCards();
  }

  function isSurfaceVisible() {
    if (!surfaceEl) return false;
    if (surfaceEl.hidden) return false;
    const pillar = surfaceEl.closest('.tempo-pillar');
    if (!pillar || pillar.dataset.active !== 'true') return false;
    return true;
  }

  function fireDue(med) {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        const n = new Notification(`${med.getName()} dose due`, {
          body: 'Time for your medication',
          tag: 'meds-' + med.getId(),
          icon: './icons/icon-192.png',
          badge: './icons/icon-192.png',
          renotify: true,
        });
        n.onclick = () => { window.focus(); n.close(); };
      } catch (e) { /* notifications not supported */ }
    }
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    if (typeof SFX !== 'undefined') SFX.playAlarm();
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  function formatDuration(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const days  = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins  = Math.floor((totalSec % 3600) / 60);
    const secs  = totalSec % 60;
    if (days > 0)  return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    if (mins > 0)  return `${mins}m ${secs}s`;
    return `${secs}s`;
  }

  function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = String(str ?? '');
    return el.innerHTML;
  }

  return { init };
})();
