// ── History Panel ──
function initHistoryPanel() {
  const toggleBtn = document.getElementById('history-toggle');
  const panel = document.getElementById('history-panel');
  const closeBtn = document.getElementById('history-close');

  // D: treat the slide-up history panel as a modal dialog (focus move-in, Tab
  // trap, Escape, focus restore) via the shared openModal/closeModal helper.
  function openPanel() {
    panel.classList.remove('hidden');
    renderHistory();
    openModal(panel, { label: 'Session history', onClose: closePanel });
  }
  function closePanel() {
    panel.classList.add('hidden');
    activeTagFilter = null;
    activeDateRange = null;
    closeModal(panel);
  }

  toggleBtn.addEventListener('click', () => {
    if (panel.classList.contains('hidden')) openPanel(); else closePanel();
  });

  closeBtn.addEventListener('click', closePanel);

  document.getElementById('history-export-all').addEventListener('click', () => {
    Export.exportAllData();
  });

  document.getElementById('history-import').addEventListener('click', () => {
    document.getElementById('history-import-input').click();
  });

  document.getElementById('history-import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // Belt-and-suspenders: confirm before wiping local state. Users who hit
    // Restore by mistake get one chance to back out before IndexedDB is cleared.
    const ok = confirm(
      `Restore from "${file.name}"?\n\n` +
      `This will replace everything currently in the app with the backup's contents. ` +
      `The page will reload when done.`
    );
    if (!ok) {
      e.target.value = '';
      return;
    }
    try {
      const text = await file.text();
      const result = await Export.importAllData(text);
      alert(
        `Restored ${result.sessionsImported} session${result.sessionsImported === 1 ? '' : 's'} ` +
        `and ${result.settingsRestored} setting${result.settingsRestored === 1 ? '' : 's'}. ` +
        `Reloading…`
      );
      // Reload so every engine module (Pomodoro, Flow, Interval, Meds, etc.)
      // picks up its freshly-restored localStorage + IndexedDB state from
      // scratch. Doing this in-process would mean re-running every loadState
      // hook individually — reload is simpler and more reliable.
      location.reload();
    } catch (err) {
      alert('Restore failed: ' + err.message);
    }
    e.target.value = '';
  });

  document.getElementById('history-clear-all').addEventListener('click', async () => {
    if (confirm('Delete all session history? This cannot be undone.')) {
      await History.clearAll();
      renderHistory();
    }
  });

  // Log Past Session — standalone panel. initLogPastPanel() owns ALL of the
  // log-past wiring (#log-past-save / #log-past-cancel / open / close). The
  // duplicate save+cancel handlers that USED to live here fired on the SAME
  // click as initLogPastPanel's copy — writing each logged session TWICE and
  // stacking a second listener on every init (A3). Removed; the canonical
  // handlers in initLogPastPanel (which closePanel() + re-render only when the
  // history panel is open) remain the single source.
  initLogPastPanel();

  // Backlog #6 caveat (c): re-render the history panel when the sync
  // engine reports a history-store merge so cross-device session
  // additions / edits propagate without close+reopen. Guarded on
  // panel visibility — re-rendering a hidden panel is wasted work.
  if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.on === 'function') {
    try {
      SyncEngine.on('merge-complete', (payload) => {
        if (!payload || payload.store !== 'history') return;
        if (!panel || panel.classList.contains('hidden')) return;
        try { renderHistory(); } catch (_) {}
      });
    } catch (_) {}
  }
}

let activeTagFilter = null;
let activeDateRange = null;

// D-1: hide-imported filter persistence. localStorage key is 'history_hide_imported'
// with values '0' (default — show) or '1' (hide). Read on every renderHistory()
// call so cross-tab flips reflect immediately.
const HIDE_IMPORTED_KEY = 'history_hide_imported';

function isHideImportedActive() {
  try {
    return typeof localStorage !== 'undefined' &&
      localStorage.getItem(HIDE_IMPORTED_KEY) === '1';
  } catch (_) {
    return false;
  }
}

function setHideImportedActive(hide) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(HIDE_IMPORTED_KEY, hide ? '1' : '0');
  } catch (_) {}
}

async function renderHistory() {
  const list = document.getElementById('history-list');
  const filterEl = document.getElementById('history-filter');
  let sessions = (await History.getSessions()).reverse();

  // D-1: detect whether any imported-bucket rows exist so we only
  // render the hide-imported toggle when it's actually useful. Avoids
  // surface clutter on pre-reconcile (and post-reconcile-empty) accounts.
  const hasImported = sessions.some(s => s && s.bucket === 'imported');
  const hideImported = isHideImportedActive();

  // Render date range pills
  const ranges = [
    { key: null, label: 'All' },
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
  ];
  const dateBarHtml = `<div class="date-filter-bar">${ranges.map(r =>
    `<button class="filter-chip ${activeDateRange === r.key ? 'filter-chip-active' : ''}" data-date-range="${r.key || ''}">${r.label}</button>`
  ).join('')}</div>`;

  // Render tag filter bar
  const allTags = await History.getAllTags();
  let tagBarHtml = '';
  if (allTags.length > 0) {
    tagBarHtml = `<div class="tag-filter-bar"><button class="filter-chip ${activeTagFilter === null ? 'filter-chip-active' : ''}" data-filter-tag="">All Tags</button>` +
      allTags.map(tag =>
        `<button class="filter-chip ${activeTagFilter === tag ? 'filter-chip-active' : ''}" data-filter-tag="${escapeHistoryHtml(tag)}">${escapeHistoryHtml(tag)}</button>`
      ).join('') + '</div>';
  }

  // D-1: hide-imported toggle. Lives in its own row so it doesn't
  // shove the date or tag chips off-screen on narrow viewports.
  // Mirrors the .filter-chip / .filter-chip-active pattern.
  let importedBarHtml = '';
  if (hasImported) {
    importedBarHtml = `<div class="imported-filter-bar"><button class="filter-chip ${hideImported ? 'filter-chip-active' : ''}" data-filter-imported="1" aria-label="${hideImported ? 'Show imported sessions' : 'Hide imported sessions'}" aria-pressed="${hideImported ? 'true' : 'false'}">${hideImported ? 'Show imported' : 'Hide imported'}</button></div>`;
  }

  filterEl.innerHTML = dateBarHtml + tagBarHtml + importedBarHtml;

  filterEl.querySelectorAll('[data-date-range]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeDateRange = btn.dataset.dateRange || null;
      renderHistory();
    });
  });

  filterEl.querySelectorAll('[data-filter-tag]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTagFilter = btn.dataset.filterTag || null;
      renderHistory();
    });
  });

  filterEl.querySelectorAll('[data-filter-imported]').forEach(btn => {
    btn.addEventListener('click', () => {
      setHideImportedActive(!isHideImportedActive());
      renderHistory();
    });
  });

  // Apply date range filter
  if (activeDateRange) {
    const now = new Date();
    let rangeStart;
    if (activeDateRange === 'today') {
      rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (activeDateRange === 'week') {
      rangeStart = new Date(now);
      rangeStart.setDate(now.getDate() - now.getDay());
      rangeStart.setHours(0, 0, 0, 0);
    } else if (activeDateRange === 'month') {
      rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    if (rangeStart) {
      sessions = sessions.filter(s => new Date(s.date) >= rangeStart);
    }
  }

  // Apply tag filter
  if (activeTagFilter) {
    sessions = sessions.filter(s =>
      Array.isArray(s.tags) && s.tags.includes(activeTagFilter)
    );
  }

  // D-1: apply hide-imported filter. Reads from localStorage each render
  // so a cross-tab flip or a fresh reconcile-complete reflects immediately.
  if (hideImported) {
    sessions = sessions.filter(s => s.bucket !== 'imported');
  }

  if (sessions.length === 0) {
    list.innerHTML = activeTagFilter
      ? '<div class="history-empty">No sessions with this tag</div>'
      : '<div class="history-empty">No sessions yet</div>';
    return;
  }

  list.innerHTML = sessions.map(s => {
    const date = new Date(s.date);
    const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const t = Utils.formatMs(s.duration);
    const dur = t.hours > 0 ? `${t.hours}:${t.minStr}:${t.secStr}` : `${t.minStr}:${t.secStr}`;
    const type = s.type === 'pomodoro' ? 'Pomodoro'
      : s.type === 'timer' ? 'Timer'
      : s.type === 'flow' ? 'Flow Block'
      : 'Stopwatch';
    const laps = s.laps.length > 0 ? `${s.laps.length} laps` : '';
    const note = s.note
      ? `<div class="history-note" data-note-id="${s.id}">${escapeHistoryHtml(s.note)}</div>`
      : `<button class="history-add-note" data-note-id="${s.id}">+ note</button>`;

    const tags = Array.isArray(s.tags) ? s.tags : [];
    // D-1: "Imported (pre-sync)" chip for rows reconciled from this
    // device's pre-sync local data. Non-interactive (no delete button),
    // visually distinct from user-editable tag-chips. The chip renders
    // inside the existing .history-tags container so it shares the same
    // wrap/spacing as the user tag chips beside it.
    const importedChipHtml = s.bucket === 'imported'
      ? `<span class="history-tag-imported" aria-label="Imported from pre-sync local data">Imported (pre-sync)</span>`
      : '';
    const tagsHtml = `<div class="history-tags">` +
      importedChipHtml +
      tags.map(tag =>
        `<span class="tag-chip">${escapeHistoryHtml(tag)}<button class="tag-chip-delete" data-session-id="${s.id}" data-tag="${escapeHistoryHtml(tag)}">&times;</button></span>`
      ).join('') +
      `<button class="tag-add-btn" data-session-id="${s.id}">+ tag</button></div>`;

    let taskHtml = '';
    let timingHtml = '';
    if (s.type === 'pomodoro') {
      const sections = [];
      if (Array.isArray(s.focusGoals) && s.focusGoals.length > 0) {
        sections.push(`<div class="history-task-section"><span class="history-task-label">Completed Goals</span><ul class="history-task-list">${s.focusGoals.map(g => `<li>${escapeHistoryHtml(g)}</li>`).join('')}</ul></div>`);
      }
      if (Array.isArray(s.breakTasks) && s.breakTasks.length > 0) {
        sections.push(`<div class="history-task-section"><span class="history-task-label">Break Tasks Done</span><ul class="history-task-list">${s.breakTasks.map(t => `<li>${escapeHistoryHtml(t)}</li>`).join('')}</ul></div>`);
      }
      if (Array.isArray(s.actualWork) && s.actualWork.length > 0) {
        sections.push(`<div class="history-task-section"><span class="history-task-label">What I Worked On</span><ul class="history-task-list">${s.actualWork.map(w => `<li>${escapeHistoryHtml(w)}</li>`).join('')}</ul></div>`);
      }
      if (Array.isArray(s.distractions) && s.distractions.length > 0) {
        const fmtTime = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        sections.push(`<div class="history-task-section"><span class="history-task-label">Distractions (${s.distractions.length})</span><ul class="history-task-list">${s.distractions.map(d => `<li>${escapeHistoryHtml(d.category)}${d.note ? ' — ' + escapeHistoryHtml(d.note) : ''} <span class="history-phase-time">${fmtTime(d.timestamp)}</span></li>`).join('')}</ul></div>`);
      }
      if (sections.length > 0) {
        taskHtml = `<div class="history-tasks">${sections.join('')}</div>`;
      }
      if (s.sessionStartedAt && Array.isArray(s.phaseLog) && s.phaseLog.length > 0) {
        const fmtTime = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        const phaseNames = { work: 'Work', shortBreak: 'Short Break', longBreak: 'Long Break' };
        const rows = s.phaseLog.map(p => {
          const name = phaseNames[p.phase] || p.phase;
          const suffix = p.restarted ? ' (restarted)' : p.partial ? ' (partial)' : '';
          return `<div class="history-phase-row"><span class="history-phase-name">${name}${suffix}</span><span class="history-phase-time">${fmtTime(p.startedAt)} – ${fmtTime(p.endedAt)}</span></div>`;
        }).join('');
        timingHtml = `<div class="history-timing"><span class="history-task-label">Session ${fmtTime(s.sessionStartedAt)} – ${fmtTime(s.sessionEndedAt)}</span>${rows}</div>`;
      }
    } else if (s.type === 'flow') {
      const sections = [];
      if (s.goal) {
        sections.push(`<div class="history-task-section"><span class="history-task-label">Goal</span><div class="history-flow-goal">${escapeHistoryHtml(s.goal)}</div></div>`);
      }
      if (Array.isArray(s.distractions) && s.distractions.length > 0) {
        const fmtTime = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        sections.push(`<div class="history-task-section"><span class="history-task-label">Distractions (${s.distractions.length})</span><ul class="history-task-list">${s.distractions.map(d => `<li>${escapeHistoryHtml(d.category)}${d.note ? ' — ' + escapeHistoryHtml(d.note) : ''} <span class="history-phase-time">${fmtTime(d.timestamp)}</span></li>`).join('')}</ul></div>`);
      }
      if (s.preBlockSkipped) {
        sections.push(`<div class="history-task-section"><span class="history-task-label">Pre-block checklist</span><div class="history-flow-goal">Skipped</div></div>`);
      }
      if (s.endedEarly && s.blockDurationMs) {
        const elapsedMin = Math.round((s.duration || 0) / 60000);
        const plannedMin = Math.round(s.blockDurationMs / 60000);
        sections.push(`<div class="history-task-section"><span class="history-task-label">Ended early</span><div class="history-flow-goal">${elapsedMin} of ${plannedMin} min</div></div>`);
      }
      if (sections.length > 0) {
        taskHtml = `<div class="history-tasks">${sections.join('')}</div>`;
      }
    }

    const overshootMs = (s.overshootMs || 0);
    const overshootBadge = overshootMs > 0
      ? `<span class="history-overshoot" title="Time past zero before you reset">+${Utils.formatShort ? Utils.formatShort(overshootMs) : Math.round(overshootMs / 1000) + 's'} over</span>`
      : '';

    return `<div class="history-row" data-id="${s.id}">
      <div class="history-row-top">
        <span class="history-type">${type}</span>
        <span class="history-dur">${dur}</span>
        ${overshootBadge}
        <span class="history-date">${dateStr}</span>
      </div>
      <div class="history-row-bottom">
        <span class="history-laps">${laps}</span>
        ${note}
      </div>
      ${timingHtml}
      ${taskHtml}
      ${tagsHtml}
    </div>`;
  }).join('');

  // Attach tag handlers
  list.querySelectorAll('.tag-chip-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await History.removeTag(btn.dataset.sessionId, btn.dataset.tag);
      renderHistory();
    });
  });

  list.querySelectorAll('.tag-add-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sessionId = btn.dataset.sessionId;
      // Replace button with input
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'tag-input';
      input.placeholder = 'tag name';
      input.maxLength = 20;
      btn.replaceWith(input);
      input.focus();

      async function commitTag() {
        const tag = input.value.trim().toLowerCase();
        if (tag) {
          await History.addTag(sessionId, tag);
        }
        renderHistory();
      }
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitTag(); }
        else if (e.key === 'Escape') { e.preventDefault(); renderHistory(); }
      });
      input.addEventListener('blur', commitTag);
    });
  });

  // Note editing — tap existing note or "+ note" button
  list.querySelectorAll('.history-note, .history-add-note').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const sessionId = el.dataset.noteId;
      const currentNote = el.classList.contains('history-note') ? el.textContent : '';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'note-input';
      input.value = currentNote;
      input.placeholder = 'Add a note...';
      input.maxLength = 100;
      el.replaceWith(input);
      input.focus();

      async function commitNote() {
        const note = input.value.trim();
        await History.updateNote(sessionId, note);
        renderHistory();
      }
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitNote(); }
        else if (e.key === 'Escape') { e.preventDefault(); renderHistory(); }
      });
      input.addEventListener('blur', commitNote);
    });
  });
}

// Uses shared escapeHtml from dom-utils.js
const escapeHistoryHtml = escapeHtml;

// ── Log Past Session Panel ──
function initLogPastPanel() {
  const panel = document.getElementById('log-past-panel');
  const logModeSelect = document.getElementById('log-past-mode');
  const pomoFields = document.getElementById('log-past-pomo-fields');

  let logPastFocusGoals = [];
  let logPastBreakTasks = [];
  let logPastActualWork = [];

  function initLogPastList(inputId, arr, listId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        arr.push(text);
        input.value = '';
        renderLogPastList(arr, listId);
      }
    });
  }

  function renderLogPastList(arr, listId) {
    const el = document.getElementById(listId);
    if (!el) return;
    if (arr.length === 0) { el.innerHTML = ''; return; }
    el.innerHTML = arr.map((text, i) =>
      `<div class="log-past-list-item"><span>${escapeHistoryHtml(text)}</span><button data-log-del="${i}">&times;</button></div>`
    ).join('');
    el.querySelectorAll('[data-log-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        arr.splice(parseInt(btn.dataset.logDel, 10), 1);
        renderLogPastList(arr, listId);
      });
    });
  }

  initLogPastList('log-past-focus-input', logPastFocusGoals, 'log-past-focus-goals');
  initLogPastList('log-past-break-input', logPastBreakTasks, 'log-past-break-tasks');
  initLogPastList('log-past-actual-input', logPastActualWork, 'log-past-actual-work');

  function openPanel() {
    panel.classList.remove('hidden');
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('log-past-date').value = today;
    document.getElementById('log-past-start').value = '';
    document.getElementById('log-past-end').value = '';
    document.getElementById('log-past-note').value = '';
    document.getElementById('log-past-tags').value = '';
    document.getElementById('log-past-cycles').value = '1';
    document.getElementById('log-past-work-min').value = '25';
    logPastFocusGoals.length = 0;
    logPastBreakTasks.length = 0;
    logPastActualWork.length = 0;
    renderLogPastList(logPastFocusGoals, 'log-past-focus-goals');
    renderLogPastList(logPastBreakTasks, 'log-past-break-tasks');
    renderLogPastList(logPastActualWork, 'log-past-actual-work');
    updateLogPastPomoVisibility();
    openModal(panel, { label: 'Log past session', onClose: closePanel }); // D: modal focus mgmt
  }

  function closePanel() {
    panel.classList.add('hidden');
    closeModal(panel); // D: restore focus + tear down trap
  }

  // Top bar button
  document.getElementById('log-session-toggle').addEventListener('click', openPanel);

  // Close button
  document.getElementById('log-past-close').addEventListener('click', closePanel);

  logModeSelect.addEventListener('change', updateLogPastPomoVisibility);

  function updateLogPastPomoVisibility() {
    pomoFields.classList.toggle('hidden', logModeSelect.value !== 'pomodoro');
  }

  document.getElementById('log-past-cancel').addEventListener('click', closePanel);

  document.getElementById('log-past-save').addEventListener('click', async () => {
    const mode = logModeSelect.value;
    const dateStr = document.getElementById('log-past-date').value;
    const startTime = document.getElementById('log-past-start').value;
    const endTime = document.getElementById('log-past-end').value;

    if (!dateStr || !startTime || !endTime) {
      alert('Please fill in date, start time, and end time.');
      return;
    }

    const startDate = new Date(`${dateStr}T${startTime}`);
    const endDate = new Date(`${dateStr}T${endTime}`);
    // M4: reject identical start/end BEFORE the cross-midnight rollover.
    // The rollover below is meant for sessions that ran past midnight (end
    // time earlier than start time). When start === end, rolling the end
    // forward a day would silently record a 24-hour session, and the
    // `durationMs <= 0` guard further down would become dead code (the
    // rollover already forced end > start). Catch it on the raw inputs first.
    if (endDate.getTime() === startDate.getTime()) {
      alert('End time must be after start time.');
      return;
    }
    if (endDate < startDate) endDate.setDate(endDate.getDate() + 1);
    const durationMs = endDate.getTime() - startDate.getTime();

    if (durationMs <= 0) {
      alert('End time must be after start time.');
      return;
    }

    const note = document.getElementById('log-past-note').value.trim();
    const tagsRaw = document.getElementById('log-past-tags').value.trim();
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : [];

    const session = {
      id: startDate.getTime(),
      date: startDate.toISOString(),
      type: mode,
      duration: durationMs,
      laps: [],
      note,
      tags,
      sessionStartedAt: startDate.getTime(),
      sessionEndedAt: endDate.getTime(),
    };

    if (mode === 'pomodoro') {
      const cycles = Math.max(0, parseInt(document.getElementById('log-past-cycles').value, 10) || 0);
      const workMin = Math.max(1, parseInt(document.getElementById('log-past-work-min').value, 10) || 25);
      session.completedCycles = cycles;
      session.totalWorkMs = cycles * workMin * 60000;
      if (logPastFocusGoals.length > 0) session.focusGoals = logPastFocusGoals.slice();
      if (logPastBreakTasks.length > 0) session.breakTasks = logPastBreakTasks.slice();
      if (logPastActualWork.length > 0) session.actualWork = logPastActualWork.slice();
    }

    await History.addSession(session);
    closePanel();
    // Re-render history if it's open
    const historyPanel = document.getElementById('history-panel');
    if (historyPanel && !historyPanel.classList.contains('hidden')) renderHistory();
  });
}
