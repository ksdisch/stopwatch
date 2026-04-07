// ── Presets UI — Drawer + Quick Picks ──
const PresetsUI = (() => {
  let grid, saveArea, quickRow, drawer;
  const MAX_QUICK = 3;
  const modeColors = { stopwatch: 'var(--green)', timer: '#5ac8fa', pomodoro: '#ff6b6b', interval: '#ff9f0a', cooking: '#ff6347' };
  const modeLabels = { stopwatch: 'SW', timer: 'TMR', pomodoro: 'POMO', interval: 'INT', cooking: 'COOK' };

  function init() {
    grid = document.getElementById('presets-grid');
    saveArea = document.getElementById('preset-save-area');
    quickRow = document.getElementById('presets-quick');
    drawer = document.getElementById('presets-drawer');

    // Drawer toggle
    document.getElementById('presets-toggle')?.addEventListener('click', () => {
      drawer.classList.toggle('hidden');
      if (!drawer.classList.contains('hidden')) renderGrid();
    });
    document.getElementById('presets-drawer-close')?.addEventListener('click', () => {
      drawer.classList.add('hidden');
    });

    renderQuickPicks();
  }

  // ── Quick Picks (main screen, top 3) ──
  function renderQuickPicks() {
    if (!quickRow) return;
    const presets = Presets.getAll().slice(0, MAX_QUICK);

    if (presets.length === 0) {
      quickRow.innerHTML = '';
      return;
    }

    quickRow.innerHTML = presets.map(p => {
      const hint = Presets.formatDurationHint(p);
      const color = modeColors[p.mode] || 'var(--text-secondary)';
      return `<button class="preset-quick-chip" data-preset-id="${p.id}">
        <span class="preset-quick-icon">${p.icon || '⏱️'}</span>
        <span class="preset-quick-name">${escapeHtml(p.name)}</span>
      </button>`;
    }).join('');

    quickRow.querySelectorAll('.preset-quick-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        Presets.applyPreset(chip.dataset.presetId);
      });
    });
  }

  function updateQuickVisibility() {
    if (!quickRow) return;
    // Hide quick picks when something is running
    const anyRunning =
      Stopwatch.getStatus() === 'running' ||
      Timer.getStatus() === 'running' ||
      Pomodoro.getStatus() === 'running' ||
      (typeof Interval !== 'undefined' && Interval.getStatus() === 'running');
    quickRow.classList.toggle('hidden', anyRunning);
  }

  // ── Full Grid (inside drawer) ──
  function renderGrid() {
    if (!grid) return;
    const presets = Presets.getAll();

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

    // Tap to apply
    grid.querySelectorAll('.preset-card[data-preset-id]').forEach(card => {
      card.addEventListener('click', () => {
        Presets.applyPreset(card.dataset.presetId);
        drawer.classList.add('hidden');
        renderQuickPicks();
      });

      // Long-press to delete
      let pressTimer = null;
      card.addEventListener('touchstart', () => {
        pressTimer = setTimeout(() => {
          pressTimer = null;
          const id = card.dataset.presetId;
          const preset = Presets.get(id);
          if (!preset) return;
          showDeleteConfirm(card, id, preset.name);
        }, 600);
      }, { passive: true });
      card.addEventListener('touchend', () => { if (pressTimer) clearTimeout(pressTimer); }, { passive: true });
      card.addEventListener('touchmove', () => { if (pressTimer) clearTimeout(pressTimer); }, { passive: true });
    });

    // Add button
    document.getElementById('preset-add-btn')?.addEventListener('click', showSaveForm);
  }

  function showDeleteConfirm(card, id, name) {
    const original = card.innerHTML;
    card.innerHTML = `<span class="preset-card-confirm">Delete "${escapeHtml(name)}"?
      <button class="preset-confirm-yes" data-confirm-id="${id}">Delete</button>
      <button class="preset-confirm-no">Cancel</button>
    </span>`;
    card.querySelector('.preset-confirm-yes').addEventListener('click', (e) => {
      e.stopPropagation();
      Presets.remove(id);
      renderGrid();
      renderQuickPicks();
    });
    card.querySelector('.preset-confirm-no').addEventListener('click', (e) => {
      e.stopPropagation();
      renderGrid();
    });
  }

  function showSaveForm() {
    if (!saveArea) return;
    const captured = Presets.captureCurrentConfig();
    const modeName = { stopwatch: 'Stopwatch', timer: 'Timer', pomodoro: 'Pomodoro', interval: 'Interval', cooking: 'Cooking' };
    const modeLabel = modeName[captured.mode] || 'Preset';
    const modeIcon = { stopwatch: '⏱️', timer: '⏲️', pomodoro: '🍅', interval: '🏋️', cooking: '🍳' };
    const defaultIcon = modeIcon[captured.mode] || '⏱️';

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
      Presets.save({ name, icon, mode: captured.mode, config: captured.config });
      saveArea.classList.add('hidden');
      saveArea.innerHTML = '';
      renderGrid();
      renderQuickPicks();
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

  function render() {
    renderQuickPicks();
    updateQuickVisibility();
  }

  return { init, render, renderQuickPicks, updateQuickVisibility };
})();
