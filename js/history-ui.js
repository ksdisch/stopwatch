// ── History Panel ──
function initHistoryPanel() {
  const toggleBtn = document.getElementById('history-toggle');
  const panel = document.getElementById('history-panel');
  const closeBtn = document.getElementById('history-close');

  toggleBtn.addEventListener('click', () => {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) renderHistory();
  });

  closeBtn.addEventListener('click', () => {
    panel.classList.add('hidden');
    activeTagFilter = null;
    activeDateRange = null;
  });

  document.getElementById('history-export-all').addEventListener('click', () => {
    Export.exportAllData();
  });

  document.getElementById('history-import').addEventListener('click', () => {
    document.getElementById('history-import-input').click();
  });

  document.getElementById('history-import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const result = await Export.importAllData(text);
      alert(`Imported ${result.sessionsImported} sessions, ${result.settingsRestored} settings. Reload to apply settings.`);
      renderHistory();
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
    e.target.value = '';
  });

  document.getElementById('history-clear-all').addEventListener('click', async () => {
    if (confirm('Delete all session history? This cannot be undone.')) {
      await History.clearAll();
      renderHistory();
    }
  });

  // Log Past Session — standalone panel
  initLogPastPanel();

  document.getElementById('log-past-cancel').addEventListener('click', () => {
    logForm.classList.add('hidden');
  });

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
    // Handle end time crossing midnight
    if (endDate <= startDate) endDate.setDate(endDate.getDate() + 1);
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
    logForm.classList.add('hidden');
    renderHistory();
  });
}

let activeTagFilter = null;
let activeDateRange = null;

async function renderHistory() {
  const list = document.getElementById('history-list');
  const filterEl = document.getElementById('history-filter');
  let sessions = (await History.getSessions()).reverse();

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

  filterEl.innerHTML = dateBarHtml + tagBarHtml;

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
    const type = s.type === 'pomodoro' ? 'Pomodoro' : s.type === 'timer' ? 'Timer' : 'Stopwatch';
    const laps = s.laps.length > 0 ? `${s.laps.length} laps` : '';
    const note = s.note
      ? `<div class="history-note" data-note-id="${s.id}">${escapeHistoryHtml(s.note)}</div>`
      : `<button class="history-add-note" data-note-id="${s.id}">+ note</button>`;

    const tags = Array.isArray(s.tags) ? s.tags : [];
    const tagsHtml = `<div class="history-tags">` +
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
    }

    return `<div class="history-row" data-id="${s.id}">
      <div class="history-row-top">
        <span class="history-type">${type}</span>
        <span class="history-dur">${dur}</span>
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
      await History.removeTag(Number(btn.dataset.sessionId), btn.dataset.tag);
      renderHistory();
    });
  });

  list.querySelectorAll('.tag-add-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sessionId = Number(btn.dataset.sessionId);
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
      const sessionId = Number(el.dataset.noteId);
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
  }

  function closePanel() {
    panel.classList.add('hidden');
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
    if (endDate <= startDate) endDate.setDate(endDate.getDate() + 1);
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
