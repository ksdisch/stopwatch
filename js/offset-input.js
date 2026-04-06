const OffsetInput = (() => {
  let toggleBtn, inputArea, hoursEl, minutesEl, secondsEl, setBtn, cancelBtn;
  let savePresetBtn, presetNameArea, presetNameEl, presetNameSave, presetNameCancel;
  let presetListEl;
  let presets = [];

  function init() {
    toggleBtn = document.getElementById('offset-toggle');
    inputArea = document.getElementById('offset-input');
    hoursEl = document.getElementById('offset-hours');
    minutesEl = document.getElementById('offset-minutes');
    secondsEl = document.getElementById('offset-seconds');
    setBtn = document.getElementById('offset-set');
    cancelBtn = document.getElementById('offset-cancel');
    savePresetBtn = document.getElementById('offset-save-preset');
    presetNameArea = document.getElementById('preset-name-input');
    presetNameEl = document.getElementById('preset-name');
    presetNameSave = document.getElementById('preset-name-save');
    presetNameCancel = document.getElementById('preset-name-cancel');
    presetListEl = document.getElementById('preset-list');

    toggleBtn.addEventListener('click', show);
    setBtn.addEventListener('click', applyOffset);
    cancelBtn.addEventListener('click', hide);
    savePresetBtn.addEventListener('click', showPresetNameInput);
    presetNameSave.addEventListener('click', savePreset);
    presetNameCancel.addEventListener('click', hidePresetNameInput);

    presetNameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); savePreset(); }
      else if (e.key === 'Escape') { e.preventDefault(); hidePresetNameInput(); }
    });

    const fields = [
      { el: hoursEl, min: 0, max: 99, next: minutesEl },
      { el: minutesEl, min: 0, max: 59, next: secondsEl },
      { el: secondsEl, min: 0, max: 59, next: setBtn },
    ];

    fields.forEach(({ el, min, max, next }) => {
      el.addEventListener('input', () => {
        const val = parseInt(el.value, 10);
        if (!isNaN(val) && val > max) {
          el.value = max;
          flashBorder(el);
        }
        // Auto-advance: if user typed 2 digits, move to next field
        if (el.value.length >= 2 && next) {
          next.focus();
          if (next.select) next.select();
        }
      });

      el.addEventListener('blur', () => {
        const val = parseInt(el.value, 10);
        if (isNaN(val) || val < min) el.value = min;
        else if (val > max) { el.value = max; flashBorder(el); }
      });

      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); applyOffset(); }
        else if (e.key === 'Escape') { e.preventDefault(); hide(); }
      });
    });

    loadPresets();
  }

  function show() {
    inputArea.removeAttribute('data-collapsed');
    toggleBtn.classList.add('hidden');
    renderPresetList();
    minutesEl.focus();
    minutesEl.select();
  }

  function hide() {
    inputArea.setAttribute('data-collapsed', '');
    toggleBtn.classList.remove('hidden');
    hidePresetNameInput();
    hoursEl.value = 0;
    minutesEl.value = 0;
    secondsEl.value = 0;
  }

  function getInputMs() {
    const h = Math.min(99, Math.max(0, parseInt(hoursEl.value, 10) || 0));
    const m = Math.min(59, Math.max(0, parseInt(minutesEl.value, 10) || 0));
    const s = Math.min(59, Math.max(0, parseInt(secondsEl.value, 10) || 0));
    return (h * 3600 + m * 60 + s) * 1000;
  }

  function applyOffset() {
    const ms = getInputMs();
    if (ms > 0) {
      Stopwatch.setOffset(ms);
      Persistence.save();
      UI.updateDisplay(Stopwatch.getElapsedMs());
    }
    hide();
  }

  function applyPreset(ms) {
    Stopwatch.setOffset(ms);
    Persistence.save();
    UI.updateDisplay(Stopwatch.getElapsedMs());
    hide();
  }

  // ── Preset Name Input ──

  function showPresetNameInput() {
    const ms = getInputMs();
    if (ms <= 0) return;
    presetNameArea.classList.remove('hidden');
    savePresetBtn.classList.add('hidden');
    presetNameEl.value = '';
    presetNameEl.focus();
  }

  function hidePresetNameInput() {
    presetNameArea.classList.add('hidden');
    savePresetBtn.classList.remove('hidden');
  }

  function savePreset() {
    const name = presetNameEl.value.trim();
    const ms = getInputMs();
    if (!name || ms <= 0) return;

    presets.push({
      id: Date.now().toString(36),
      name: name,
      ms: ms,
    });
    savePresets();
    renderPresetList();
    hidePresetNameInput();
  }

  // ── Preset List ──

  function renderPresetList() {
    if (presets.length === 0) {
      presetListEl.innerHTML = '';
      return;
    }

    presetListEl.innerHTML = presets.map(p => {
      const t = Utils.formatMs(p.ms);
      const dur = t.hours > 0
        ? `${t.hours}:${t.minStr}:${t.secStr}`
        : `${t.minStr}:${t.secStr}`;
      return `<div class="preset-row" data-preset-id="${p.id}">
        <span class="preset-name">${escapeHtml(p.name)}</span>
        <span class="preset-duration">${dur}</span>
        <button class="preset-delete" data-delete-id="${p.id}" aria-label="Delete preset">&times;</button>
      </div>`;
    }).join('');

    // Attach click handlers
    presetListEl.querySelectorAll('.preset-row').forEach(row => {
      row.addEventListener('click', (e) => {
        // Don't apply preset if delete button was clicked
        if (e.target.closest('.preset-delete')) return;
        const id = row.dataset.presetId;
        const preset = presets.find(p => p.id === id);
        if (preset) applyPreset(preset.ms);
      });
    });

    presetListEl.querySelectorAll('.preset-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.deleteId;
        presets = presets.filter(p => p.id !== id);
        savePresets();
        renderPresetList();
      });
    });
  }

  // ── Persistence ──

  function loadPresets() {
    try {
      presets = JSON.parse(localStorage.getItem('offset_presets') || '[]');
    } catch (e) {
      presets = [];
    }
  }

  function savePresets() {
    localStorage.setItem('offset_presets', JSON.stringify(presets));
  }

  // ── Helpers ──

  function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
  }

  function setVisible(visible) {
    const area = document.getElementById('offset-area');
    if (visible) {
      area.classList.remove('hidden');
    } else {
      area.classList.add('hidden');
      hide();
    }
  }

  function flashBorder(el) {
    el.style.borderColor = 'var(--red)';
    setTimeout(() => { el.style.borderColor = ''; }, 400);
  }

  return { init, hide, setVisible };
})();
