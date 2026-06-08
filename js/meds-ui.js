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

  // A5: dose logging ("Took it now" / apply offset) has no double-tap guard —
  // a fast double-tap logs the dose twice, double-counting adherence AND
  // double-decrementing the derived prescription-supply remaining. Pomodoro
  // already debounces its primary action; meds (safety-relevant) did not. A
  // brief per-med lock collapses an accidental double-tap into one dose.
  const _doseLocks = new Set();
  function _tryLockDose(id) {
    if (_doseLocks.has(id)) return false;
    _doseLocks.add(id);
    setTimeout(() => _doseLocks.delete(id), 600);
    return true;
  }

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
    // The supply section (badge + "New prescription" refill) only renders for
    // meds the user has opted into tracking via the form checkbox. Tracking is
    // flagged by supplyStartCount !== null (enabling seeds it; disabling clears it).
    const tracked = med.getSupplyStartCount() !== null;
    const supplyBadge = tracked ? `
        <div class="med-supply" data-supply hidden>
          <div class="med-supply-main">
            <div class="med-supply-count" data-supply-count></div>
            <div class="med-supply-meta" data-supply-meta></div>
          </div>
          <div class="med-supply-stepper">
            <button class="med-supply-step" data-action="supply-inc" type="button" aria-label="Add one to remaining count" title="Add one">▲</button>
            <button class="med-supply-step" data-action="supply-dec" type="button" aria-label="Remove one from remaining count" title="Remove one">▼</button>
          </div>
        </div>` : '';
    const supplyControls = tracked ? `
        <button class="med-supply-reset" data-action="new-prescription" type="button">New prescription</button>
        <div class="med-supply-input" data-supply-input hidden>
          <label class="med-supply-input-label">
            <span>Pills in this prescription</span>
            <input type="number" min="1" max="1000" value="30" data-supply-qty inputmode="numeric">
          </label>
          <div class="med-supply-input-actions">
            <button class="med-btn med-btn-primary" data-action="apply-supply">Save count</button>
            <button class="med-btn med-btn-ghost" data-action="cancel-supply">Cancel</button>
          </div>
        </div>` : '';
    return `
      <article class="tempo-card med-card" data-med-id="${id}">
        <header class="med-card-header">
          <div class="med-card-heading">
            <h3 class="med-card-name">${name}</h3>
            <div class="med-card-dose">${subtitle}</div>
          </div>
          <div class="med-card-actions">
            <button class="med-icon-btn" data-action="edit" aria-label="Edit ${name}" title="Edit">✎</button>
            <button class="med-icon-btn" data-action="delete" aria-label="Delete ${name}" title="Delete">×</button>
          </div>
        </header>${supplyBadge}
        <div class="med-card-status" data-status>—</div>
        <div class="med-card-last" data-last></div>
        <div class="med-card-buttons">
          <button class="med-btn med-btn-primary" data-action="log-now">Took it now</button>
          <button class="med-btn med-btn-secondary" data-action="log-offset">Took it ~</button>
        </div>${supplyControls}
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
        statusText = `Last taken ${Utils.formatHuman(sinceMs)} ago`;
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

    refreshCardSupply(med, card);
  }

  // Prominent "doses remaining" badge. Hidden until the user starts tracking
  // a prescription via the "New prescription" button. Color shifts amber when
  // low (≤5) and red at 0 to flag getting ahead of the script.
  function refreshCardSupply(med, card) {
    const wrap = card.querySelector('[data-supply]');
    if (!wrap) return;
    const remaining = med.getSupplyRemaining();
    if (remaining === null) {
      wrap.hidden = true;
      wrap.classList.remove('med-supply-low', 'med-supply-empty');
      return;
    }
    const total = med.getSupplyStartCount();
    const resetAt = med.getSupplyResetAt();
    wrap.hidden = false;
    card.querySelector('[data-supply-count]').innerHTML =
      `<strong>${remaining}</strong> left`;
    const meta = [`of ${total}`];
    if (resetAt) meta.push(`since ${formatSupplyDate(resetAt)}`);
    card.querySelector('[data-supply-meta]').textContent = meta.join(' · ');
    wrap.classList.toggle('med-supply-low', remaining > 0 && remaining <= 5);
    wrap.classList.toggle('med-supply-empty', remaining === 0);
    // Down arrow is a no-op at 0 — disable it so that's visually obvious.
    const decBtn = wrap.querySelector('[data-action="supply-dec"]');
    if (decBtn) decBtn.disabled = remaining <= 0;
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
        if (!_tryLockDose(med.getId())) return; // A5: ignore double-tap
        med.logDose();
        MedsManager.saveAll();
        refreshCardStatus(med);
        flash(card);
        if (typeof SFX !== 'undefined') SFX.playLap();
        Platform.haptic(30);

      } else if (action === 'log-offset') {
        // Prefill with 30 min (user can adjust). No schedule to derive
        // a smarter default from.
        toggleSupplyInput(card, false);
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
        if (offsetMs > 0 && _tryLockDose(med.getId())) { // A5: ignore double-tap
          med.logDose(Date.now() - offsetMs);
          MedsManager.saveAll();
          refreshCardStatus(med);
          flash(card);
          if (typeof SFX !== 'undefined') SFX.playLap();
          Platform.haptic(30);
        }
        toggleOffset(card, false);

      } else if (action === 'new-prescription') {
        // Reveal the count input. Prefill with the last prescription size
        // (or 30) so a routine monthly refill is one tap + Enter.
        toggleOffset(card, false);
        const qtyEl = card.querySelector('[data-supply-qty]');
        qtyEl.value = med.getSupplyStartCount() || 30;
        toggleSupplyInput(card, true);
        qtyEl.focus();
        qtyEl.select?.();

      } else if (action === 'cancel-supply') {
        toggleSupplyInput(card, false);

      } else if (action === 'apply-supply') {
        applySupply(med, card);

      } else if (action === 'supply-inc' || action === 'supply-dec') {
        // Manual ±1 nudge on the remaining count — corrects a miscount or a
        // lost/extra pill without logging a phantom dose. Lighter haptic
        // than dose logging (15 vs 30 ms) to signal the smaller action.
        med.adjustSupply(action === 'supply-inc' ? 1 : -1);
        MedsManager.saveAll();
        refreshCardSupply(med, card);
        Platform.haptic(15);

      } else if (action === 'edit') {
        openEditForm(med);

      } else if (action === 'delete') {
        // Destructive — also drops the dose history. Match the app's
        // native-confirm convention (see history-ui restore/clear).
        const ok = confirm(
          `Delete "${med.getName()}"?\n\n` +
          `This removes the medication and its dose history. This can't be undone.`
        );
        // MedsManager.remove returns false for future-schema records (F19a
        // refuse-writeback) — leave those in place rather than silently no-op
        // re-render. Only refresh + buzz on an actual removal.
        if (ok && MedsManager.remove(med.getId())) {
          Platform.haptic(30);
          render();
        }
      }
    });

    // Enter confirms / Escape cancels in the supply count field, matching
    // the add/edit form's keyboard UX.
    const qtyEl = card.querySelector('[data-supply-qty]');
    if (qtyEl) {
      qtyEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); applySupply(med, card); }
        else if (e.key === 'Escape') { e.preventDefault(); toggleSupplyInput(card, false); }
      });
    }
  }

  function applySupply(med, card) {
    const qty = parseInt(card.querySelector('[data-supply-qty]').value, 10);
    med.setSupply(qty > 0 ? qty : 30);
    MedsManager.saveAll();
    toggleSupplyInput(card, false);
    refreshCardStatus(med);
    flash(card);
    Platform.haptic(30);
  }

  function toggleOffset(card, show) {
    const panel = card.querySelector('[data-offset]');
    if (panel) panel.hidden = !show;
  }

  function toggleSupplyInput(card, show) {
    const panel = card.querySelector('[data-supply-input]');
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

    // Reveal the "pills per prescription" input only when tracking is checked.
    const trackEl = formEl.querySelector('[data-field-supply-track]');
    if (trackEl) trackEl.addEventListener('change', syncSupplyQtyRow);

    formEl.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); saveForm(); }
        else if (e.key === 'Escape') { e.preventDefault(); closeForm(); }
      });
    });
  }

  // Show/hide the pills-per-prescription row to match the checkbox state.
  function syncSupplyQtyRow() {
    const trackEl = formEl.querySelector('[data-field-supply-track]');
    const qtyRow = formEl.querySelector('[data-field-supply-qty-row]');
    if (qtyRow) qtyRow.hidden = !(trackEl && trackEl.checked);
  }

  function openAddForm() {
    editingId = null;
    formEl.querySelector('[data-form-title]').textContent = 'Add medication';
    formEl.querySelector('[data-field-name]').value = '';
    formEl.querySelector('[data-field-dose]').value = '';
    formEl.querySelector('[data-field-frequency]').value = 'once-daily';
    formEl.querySelector('[data-field-supply-track]').checked = false;
    formEl.querySelector('[data-field-supply-qty]').value = 30;
    syncSupplyQtyRow();
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
    const tracked = med.getSupplyStartCount() !== null;
    formEl.querySelector('[data-field-supply-track]').checked = tracked;
    formEl.querySelector('[data-field-supply-qty]').value = med.getSupplyStartCount() || 30;
    syncSupplyQtyRow();
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
    const track = formEl.querySelector('[data-field-supply-track]').checked;
    const qty = parseInt(formEl.querySelector('[data-field-supply-qty]').value, 10) || 30;

    if (!name) {
      nameEl.focus();
      flashInput(nameEl);
      return;
    }

    let med;
    if (editingId) {
      med = MedsManager.get(editingId);
      if (med) {
        med.setName(name);
        med.setDose(dose);
        med.setFrequency(frequency);
      }
    } else {
      med = MedsManager.add({ name, dose, frequency });
    }

    // Apply the supply-tracking choice. Enabling (or changing the count)
    // seeds a fresh prescription; disabling clears it. An unchanged count on
    // an already-tracked med is left alone so editing the name doesn't reset
    // the running tally.
    if (med) {
      const wasTracked = med.getSupplyStartCount() !== null;
      if (track) {
        if (!wasTracked || med.getSupplyStartCount() !== qty) med.setSupply(qty);
      } else if (wasTracked) {
        med.clearSupply();
      }
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
  // Duration humanizer: shared Utils.formatHuman (E-polish follow-up E10
  // dedup). Replaced the local days/hours/mins/secs copy; the days tier is
  // covered by formatHuman so "Last taken 3d 4h ago" still renders.

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

  function formatSupplyDate(ts) {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'today';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // escapeHtml: shared global from js/dom-utils.js (Batch E reuse dedup).

  return { init };
})();
