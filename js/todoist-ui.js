// bl-2-todoist: Todoist UI — settings drawer panel + shared picker modal.
//
// IIFE module exposing `window.TodoistUI`. Two public methods:
//   - renderSettingsSection(container)  — fills the settings drawer's
//                                         #settings-todoist placeholder.
//   - openPicker({ onImport })          — opens a shared modal that lists
//                                         tasks matching the configured
//                                         filter; `onImport(tasks)` is the
//                                         caller's callback for the chosen
//                                         tasks (each `{ id, content }`).
//
// All Todoist `content` rendered via `escapeHtml` from `js/dom-utils.js`
// (or via .textContent which is implicitly safe) — XSS guard against
// hostile task content.
//
// No haptics / no notifications on Todoist write paths (brief Hard rule
// #6). The settings panel is purely a config surface; the picker is
// purely a read surface that returns selections to the caller.

const TodoistUI = (() => {

  // Module-scoped references to the currently-open modal element and its
  // event listeners. Held here so _close() can clean up on cancel/import.
  let _modalEl = null;
  let _visibilityListener = null;
  let _keydownListener = null;
  let _currentTasks = [];      // last fetch result (used at confirm time)
  let _currentOnImport = null;

  // ── Settings drawer section ────────────────────────────────────────────

  // Fill the `<section id="settings-todoist">` placeholder. Idempotent —
  // safe to call multiple times (clears + re-renders).
  function renderSettingsSection(container) {
    if (!container) return;
    container.innerHTML = '';
    container.classList.add('tempo-todoist-section');

    // ── Heading ───────────────────────────────────────────────────────
    const heading = document.createElement('div');
    heading.className = 'tempo-cloud-sync-heading';
    heading.textContent = 'Todoist';
    container.appendChild(heading);

    const subhead = document.createElement('div');
    subhead.className = 'tempo-todoist-subhead';
    subhead.textContent = 'Two-way sync with your Todoist tasks';
    container.appendChild(subhead);

    // ── Token row ─────────────────────────────────────────────────────
    const tokenRow = document.createElement('div');
    tokenRow.className = 'tempo-todoist-row';

    const tokenLabel = document.createElement('label');
    tokenLabel.className = 'tempo-todoist-label';
    tokenLabel.setAttribute('for', 'todoist-token-input');
    tokenLabel.textContent = 'API token';
    tokenRow.appendChild(tokenLabel);

    const tokenInput = document.createElement('input');
    tokenInput.type = 'password';
    tokenInput.id = 'todoist-token-input';
    tokenInput.className = 'tempo-todoist-input';
    tokenInput.placeholder = 'paste token';
    tokenInput.autocomplete = 'off';
    tokenInput.spellcheck = false;
    tokenInput.setAttribute('aria-label', 'Todoist API token');
    // Pre-populate with the currently-stored token (if any), but as
    // type="password" so it doesn't show in screenshots.
    if (Todoist.hasToken()) tokenInput.value = Todoist.getToken() || '';
    tokenRow.appendChild(tokenInput);

    container.appendChild(tokenRow);

    // Help link
    const help = document.createElement('div');
    help.className = 'tempo-todoist-help';
    const helpLink = document.createElement('a');
    helpLink.href = 'https://todoist.com/app/settings/integrations/developer';
    helpLink.target = '_blank';
    helpLink.rel = 'noopener noreferrer';
    helpLink.textContent = 'Get your token from Todoist';
    help.appendChild(helpLink);
    container.appendChild(help);

    // ── Test connection button ────────────────────────────────────────
    const testBtn = document.createElement('button');
    testBtn.type = 'button';
    testBtn.id = 'todoist-test-btn';
    testBtn.className = 'tempo-todoist-secondary';
    testBtn.textContent = 'Test connection';
    testBtn.setAttribute('aria-label', 'Test Todoist connection');
    testBtn.setAttribute('data-keep-drawer-open', '');
    container.appendChild(testBtn);

    const testStatus = document.createElement('div');
    testStatus.id = 'todoist-test-status';
    testStatus.className = 'tempo-todoist-status';
    testStatus.setAttribute('aria-live', 'polite');
    container.appendChild(testStatus);

    // ── Default project row ───────────────────────────────────────────
    const projectRow = document.createElement('div');
    projectRow.className = 'tempo-todoist-row';
    const projectLabel = document.createElement('label');
    projectLabel.className = 'tempo-todoist-label';
    projectLabel.setAttribute('for', 'todoist-default-project');
    projectLabel.textContent = 'Default project';
    projectRow.appendChild(projectLabel);

    const projectSel = document.createElement('select');
    projectSel.id = 'todoist-default-project';
    projectSel.className = 'tempo-todoist-input';
    projectSel.setAttribute('aria-label', 'Default Todoist project for new tasks');
    const placeholderOpt = document.createElement('option');
    placeholderOpt.value = '';
    placeholderOpt.textContent = Todoist.hasToken() ? 'Loading…' : 'Set token to load projects';
    projectSel.appendChild(placeholderOpt);
    projectRow.appendChild(projectSel);
    container.appendChild(projectRow);

    // ── Default filter row ────────────────────────────────────────────
    const filterRow = document.createElement('div');
    filterRow.className = 'tempo-todoist-row';
    const filterLabel = document.createElement('label');
    filterLabel.className = 'tempo-todoist-label';
    filterLabel.setAttribute('for', 'todoist-default-filter');
    filterLabel.textContent = 'Default filter';
    filterRow.appendChild(filterLabel);

    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.id = 'todoist-default-filter';
    filterInput.className = 'tempo-todoist-input';
    filterInput.placeholder = 'today';
    filterInput.value = Todoist.getDefaultFilter() || 'today';
    filterInput.setAttribute('aria-label', 'Default Todoist filter');
    filterInput.autocomplete = 'off';
    filterInput.spellcheck = false;
    filterRow.appendChild(filterInput);
    container.appendChild(filterRow);

    // ── Pending-queue status ──────────────────────────────────────────
    const queueStatus = document.createElement('div');
    queueStatus.className = 'tempo-todoist-status todoist-pending-count';
    queueStatus.id = 'todoist-pending-status';
    queueStatus.setAttribute('aria-live', 'polite');
    container.appendChild(queueStatus);
    _renderPendingCount(queueStatus);

    // ── Wire interactions ─────────────────────────────────────────────
    testBtn.addEventListener('click', async () => {
      // Capture the previous token BEFORE setting the new one so a failed
      // test can restore it (otherwise a typo or stray whitespace silently
      // overwrites a previously-working token). Also disable the button
      // for the duration of the test so rapid double-clicks can't race.
      if (testBtn.disabled) return;
      testBtn.disabled = true;
      const previousToken = Todoist.getToken();
      const token = (tokenInput.value || '').trim();
      Todoist.setToken(token);
      testStatus.removeAttribute('data-error');
      testStatus.textContent = 'Testing…';
      try {
        const result = await Todoist.testConnection();
        if (result && result.ok) {
          testStatus.textContent = '✓ Connected';
          testStatus.removeAttribute('data-error');
          _populateProjects(projectSel);
        } else {
          // Restore the prior token; do NOT leave the bad value persisted.
          if (previousToken) Todoist.setToken(previousToken);
          else Todoist.clearToken();
          const msg = (result && result.message) || 'Failed to connect';
          testStatus.textContent = '✗ ' + msg;
          testStatus.setAttribute('data-error', '');
        }
      } catch (_err) {
        if (previousToken) Todoist.setToken(previousToken);
        else Todoist.clearToken();
        testStatus.textContent = '✗ network error';
        testStatus.setAttribute('data-error', '');
      } finally {
        testBtn.disabled = false;
      }
      _renderPendingCount(queueStatus);
    });

    projectSel.addEventListener('change', () => {
      const val = projectSel.value || '';
      Todoist.setDefaultProjectId(val || null);
    });

    filterInput.addEventListener('blur', () => {
      const val = (filterInput.value || '').trim();
      Todoist.setDefaultFilter(val || null);
    });
    filterInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        filterInput.blur();
      }
    });

    // Populate the project dropdown if we already have a token (skip the
    // network call otherwise).
    if (Todoist.hasToken()) {
      _populateProjects(projectSel);
    }
  }

  function _renderPendingCount(el) {
    if (!el) return;
    let count = 0;
    try {
      const raw = localStorage.getItem(Todoist.STORAGE_KEYS.pendingOps);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) count = parsed.length;
    } catch (_) {}
    if (count > 0) {
      el.textContent = count + ' queued offline writes';
      el.hidden = false;
    } else {
      el.textContent = '';
      el.hidden = true;
    }
  }

  async function _populateProjects(selectEl) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    const loading = document.createElement('option');
    loading.value = '';
    loading.textContent = 'Loading…';
    selectEl.appendChild(loading);

    let result;
    try {
      result = await Todoist.getProjects();
    } catch (_err) {
      result = { ok: false, message: 'network error' };
    }
    selectEl.innerHTML = '';
    if (!result || !result.ok) {
      const errOpt = document.createElement('option');
      errOpt.value = '';
      errOpt.textContent = 'Could not load projects';
      selectEl.appendChild(errOpt);
      return;
    }
    const projects = Array.isArray(result.data) ? result.data : [];
    // Sort Inbox first if present; remainder alphabetical.
    projects.sort((a, b) => {
      const aIsInbox = a && (a.is_inbox_project || (a.name === 'Inbox'));
      const bIsInbox = b && (b.is_inbox_project || (b.name === 'Inbox'));
      if (aIsInbox && !bIsInbox) return -1;
      if (!aIsInbox && bIsInbox) return 1;
      const an = (a && a.name) || '';
      const bn = (b && b.name) || '';
      return an.localeCompare(bn);
    });
    const currentId = Todoist.getDefaultProjectId();
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '(no default)';
    selectEl.appendChild(noneOpt);
    for (const p of projects) {
      if (!p || typeof p.id === 'undefined') continue;
      const opt = document.createElement('option');
      // Todoist returns numeric ids in v2; store + compare as strings to
      // avoid type coercion surprises.
      opt.value = String(p.id);
      opt.textContent = (typeof p.name === 'string' ? p.name : '(unnamed)');
      if (currentId && String(currentId) === opt.value) opt.selected = true;
      selectEl.appendChild(opt);
    }
  }

  // ── Shared picker modal ────────────────────────────────────────────────

  // Opens a modal listing tasks matching the user's configured default
  // filter. Multi-select; on confirm, calls `opts.onImport(selectedTasks)`
  // with the chosen task objects (`{ id, content }` shape). On cancel,
  // just closes.
  //
  // Refreshes the task list on `visibilitychange:visible` so a user who
  // checked a task off in the Todoist app and tabs back to Tempo sees it
  // disappear without re-opening the modal.
  function openPicker(opts) {
    opts = opts || {};
    // Close any existing modal first (defensive — re-opening should
    // reset state).
    if (_modalEl) _close();
    _currentOnImport = (typeof opts.onImport === 'function') ? opts.onImport : null;
    _currentTasks = [];

    const filter = Todoist.getDefaultFilter();

    // ── Build modal DOM ───────────────────────────────────────────────
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop todoist-picker-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', 'Import from Todoist');

    const modal = document.createElement('div');
    modal.className = 'todoist-picker-modal';

    // Header
    const header = document.createElement('div');
    header.className = 'todoist-picker-header';
    const title = document.createElement('h3');
    title.textContent = 'Import from Todoist';
    header.appendChild(title);
    const subhead = document.createElement('div');
    subhead.className = 'modal-subhead';
    subhead.textContent = 'Filter: ' + (filter || 'today');
    header.appendChild(subhead);
    modal.appendChild(header);

    // Body (task list / status)
    const body = document.createElement('div');
    body.className = 'todoist-picker-body';
    const status = document.createElement('div');
    status.className = 'todoist-picker-status';
    status.textContent = 'Loading…';
    body.appendChild(status);
    const list = document.createElement('div');
    list.className = 'todoist-picker-list';
    body.appendChild(list);
    modal.appendChild(body);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'todoist-picker-footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'tempo-todoist-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.setAttribute('aria-label', 'Cancel import');
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'tempo-cloud-sync-primary';
    confirmBtn.textContent = 'Add to focus';
    confirmBtn.setAttribute('aria-label', 'Add selected tasks to focus');
    confirmBtn.disabled = true;
    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);
    modal.appendChild(footer);

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    _modalEl = backdrop;

    // ── Wire handlers ─────────────────────────────────────────────────

    // Cancel: click on backdrop OR the cancel button OR Escape key.
    cancelBtn.addEventListener('click', _close);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) _close();
    });
    _keydownListener = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        _close();
      }
    };
    document.addEventListener('keydown', _keydownListener);

    confirmBtn.addEventListener('click', () => {
      const selectedIds = new Set();
      list.querySelectorAll('input[type="checkbox"][data-task-id]').forEach(cb => {
        if (cb.checked) selectedIds.add(cb.dataset.taskId);
      });
      const selected = _currentTasks.filter(t => selectedIds.has(String(t.id)));
      const onImport = _currentOnImport;
      _close();
      if (onImport && selected.length > 0) {
        try { onImport(selected); } catch (_) {}
      }
    });

    // Refresh on focus return.
    _visibilityListener = () => {
      if (document.visibilityState === 'visible' && _modalEl === backdrop) {
        _fetchAndRender(list, status, confirmBtn, filter);
      }
    };
    document.addEventListener('visibilitychange', _visibilityListener);

    // First load.
    _fetchAndRender(list, status, confirmBtn, filter);
  }

  async function _fetchAndRender(listEl, statusEl, confirmBtn, filter) {
    if (!listEl || !statusEl) return;

    // Preserve any currently-checked task ids across the re-render so a
    // user who alt-tabs to the Todoist app mid-selection doesn't lose
    // their checks when visibilitychange:visible triggers a refresh.
    const previouslyChecked = new Set();
    try {
      listEl.querySelectorAll('input[type="checkbox"][data-task-id]:checked').forEach(cb => {
        if (cb && cb.dataset && cb.dataset.taskId) {
          previouslyChecked.add(cb.dataset.taskId);
        }
      });
    } catch (_) {}

    statusEl.removeAttribute('data-error');
    statusEl.textContent = 'Loading…';
    statusEl.hidden = false;
    listEl.innerHTML = '';

    if (!Todoist.hasToken()) {
      statusEl.textContent = 'Could not load tasks. Check your Todoist token in Settings.';
      statusEl.setAttribute('data-error', '');
      _currentTasks = [];
      if (confirmBtn) confirmBtn.disabled = true;
      return;
    }

    let result;
    try {
      result = await Todoist.getTasks(filter);
    } catch (_err) {
      result = { ok: false, message: 'network error' };
    }

    if (!result || !result.ok) {
      statusEl.textContent = 'Could not load tasks. Check your Todoist token in Settings.';
      statusEl.setAttribute('data-error', '');
      _currentTasks = [];
      if (confirmBtn) confirmBtn.disabled = true;
      return;
    }

    const tasks = Array.isArray(result.data) ? result.data : [];
    _currentTasks = tasks;
    if (tasks.length === 0) {
      statusEl.textContent = 'No tasks match "' + (filter || 'today') + '".';
      statusEl.removeAttribute('data-error');
      if (confirmBtn) confirmBtn.disabled = true;
      return;
    }

    statusEl.hidden = true;
    statusEl.textContent = '';

    // Render rows. Use textContent (NOT innerHTML) for `task.content` so
    // hostile content can't inject markup.
    let restoredAnyChecked = false;
    for (const t of tasks) {
      if (!t || typeof t.id === 'undefined') continue;
      const label = document.createElement('label');
      label.className = 'todoist-picker-row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.taskId = String(t.id);
      if (previouslyChecked.has(String(t.id))) {
        cb.checked = true;
        restoredAnyChecked = true;
      }
      cb.addEventListener('change', () => {
        const anyChecked = !!listEl.querySelector('input[type="checkbox"][data-task-id]:checked');
        if (confirmBtn) confirmBtn.disabled = !anyChecked;
      });
      label.appendChild(cb);

      const text = document.createElement('span');
      text.className = 'todoist-picker-task-content';
      text.textContent = (typeof t.content === 'string') ? t.content : '';
      label.appendChild(text);

      listEl.appendChild(label);
    }
    if (confirmBtn) confirmBtn.disabled = !restoredAnyChecked;
  }

  function _close() {
    if (_keydownListener) {
      document.removeEventListener('keydown', _keydownListener);
      _keydownListener = null;
    }
    if (_visibilityListener) {
      document.removeEventListener('visibilitychange', _visibilityListener);
      _visibilityListener = null;
    }
    if (_modalEl && _modalEl.parentNode) {
      _modalEl.parentNode.removeChild(_modalEl);
    }
    _modalEl = null;
    _currentTasks = [];
    _currentOnImport = null;
  }

  return {
    renderSettingsSection,
    openPicker,
  };
})();

if (typeof window !== 'undefined') {
  window.TodoistUI = TodoistUI;
}
