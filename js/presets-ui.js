// ── Presets UI — Card Grid ──
const PresetsUI = (() => {
  let grid;
  let saveArea;

  function init() {
    grid = document.getElementById('presets-grid');
    saveArea = document.getElementById('preset-save-area');
    render();
    initSaveButton();
  }

  function render() {
    if (!grid) return;
    const presets = Presets.getAll();
    const modeColors = { stopwatch: 'var(--green)', timer: '#5ac8fa', pomodoro: '#ff6b6b', interval: '#ff9f0a', cooking: '#ff6347' };
    const modeLabels = { stopwatch: 'SW', timer: 'TMR', pomodoro: 'POMO', interval: 'INT', cooking: 'COOK' };

    grid.innerHTML = presets.map(p => {
      const hint = Presets.formatDurationHint(p);
      const color = modeColors[p.mode] || 'var(--text-secondary)';
      return `<button class="preset-card" data-preset-id="${p.id}">
        <span class="preset-card-icon">${p.icon || '⏱️'}</span>
        <span class="preset-card-info">
          <span class="preset-card-name">${escapeHtml(p.name)}</span>
          <span class="preset-card-hint">${escapeHtml(hint)}</span>
        </span>
        <span class="preset-card-mode" style="background:${color}">${modeLabels[p.mode] || ''}</span>
      </button>`;
    }).join('') +
    `<button class="preset-card preset-card-add" id="preset-add-btn">
      <span class="preset-card-icon">+</span>
      <span class="preset-card-info">
        <span class="preset-card-name">Save Current</span>
        <span class="preset-card-hint">as preset</span>
      </span>
    </button>`;

    // Tap to apply preset
    grid.querySelectorAll('.preset-card[data-preset-id]').forEach(card => {
      // Tap
      card.addEventListener('click', () => {
        Presets.applyPreset(card.dataset.presetId);
        render();
      });

      // Long-press to delete
      let pressTimer = null;
      card.addEventListener('touchstart', (e) => {
        pressTimer = setTimeout(() => {
          pressTimer = null;
          const id = card.dataset.presetId;
          const preset = Presets.get(id);
          if (!preset) return;
          showDeleteConfirm(card, id, preset.name);
        }, 600);
      }, { passive: true });
      card.addEventListener('touchend', () => {
        if (pressTimer) clearTimeout(pressTimer);
      }, { passive: true });
      card.addEventListener('touchmove', () => {
        if (pressTimer) clearTimeout(pressTimer);
      }, { passive: true });
    });

    // Add button
    const addBtn = document.getElementById('preset-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', showSaveForm);
    }
  }

  function showDeleteConfirm(card, id, name) {
    // Show inline delete confirmation
    const original = card.innerHTML;
    card.innerHTML = `<span class="preset-card-confirm">Delete "${escapeHtml(name)}"?
      <button class="preset-confirm-yes" data-confirm-id="${id}">Delete</button>
      <button class="preset-confirm-no">Cancel</button>
    </span>`;
    card.querySelector('.preset-confirm-yes').addEventListener('click', (e) => {
      e.stopPropagation();
      Presets.remove(id);
      render();
    });
    card.querySelector('.preset-confirm-no').addEventListener('click', (e) => {
      e.stopPropagation();
      card.innerHTML = original;
      // Re-render to restore handlers
      render();
    });
  }

  function showSaveForm() {
    if (!saveArea) return;
    const captured = Presets.captureCurrentConfig();
    const modeLabel = captured.mode === 'stopwatch' ? 'Stopwatch' : captured.mode === 'timer' ? 'Timer' : 'Pomodoro';
    const defaultIcon = captured.mode === 'stopwatch' ? '⏱️' : captured.mode === 'timer' ? '⏲️' : '🍅';

    saveArea.classList.remove('hidden');
    saveArea.innerHTML = `
      <div class="preset-save-form">
        <input type="text" id="preset-save-icon" class="preset-save-icon-input" value="${defaultIcon}" maxlength="2">
        <input type="text" id="preset-save-name" class="preset-save-name-input" placeholder="${modeLabel} preset" maxlength="30">
        <div class="offset-buttons">
          <button id="preset-save-confirm" class="offset-btn">Save</button>
          <button id="preset-save-cancel" class="offset-btn">Cancel</button>
        </div>
      </div>
    `;

    const nameInput = document.getElementById('preset-save-name');
    nameInput.focus();

    document.getElementById('preset-save-confirm').addEventListener('click', () => {
      const name = nameInput.value.trim() || `${modeLabel} preset`;
      const icon = document.getElementById('preset-save-icon').value.trim() || defaultIcon;
      Presets.save({
        name,
        icon,
        mode: captured.mode,
        config: captured.config,
      });
      saveArea.classList.add('hidden');
      saveArea.innerHTML = '';
      render();
    });

    document.getElementById('preset-save-cancel').addEventListener('click', () => {
      saveArea.classList.add('hidden');
      saveArea.innerHTML = '';
    });

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); document.getElementById('preset-save-confirm').click(); }
      else if (e.key === 'Escape') { e.preventDefault(); document.getElementById('preset-save-cancel').click(); }
    });
  }

  function initSaveButton() {
    // The save form is triggered from the "+" card in the grid
  }

  return { init, render };
})();
