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
  });
}

let activeTagFilter = null;

function renderHistory() {
  const list = document.getElementById('history-list');
  const filterEl = document.getElementById('history-filter');
  let sessions = History.getSessions().reverse();

  // Render filter bar
  const allTags = History.getAllTags();
  if (allTags.length > 0) {
    filterEl.innerHTML = `<button class="filter-chip ${activeTagFilter === null ? 'filter-chip-active' : ''}" data-filter-tag="">All</button>` +
      allTags.map(tag =>
        `<button class="filter-chip ${activeTagFilter === tag ? 'filter-chip-active' : ''}" data-filter-tag="${escapeHistoryHtml(tag)}">${escapeHistoryHtml(tag)}</button>`
      ).join('');

    filterEl.querySelectorAll('.filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const tag = btn.dataset.filterTag;
        activeTagFilter = tag || null;
        renderHistory();
      });
    });
  } else {
    filterEl.innerHTML = '';
  }

  // Apply filter
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
      if (sections.length > 0) {
        taskHtml = `<div class="history-tasks">${sections.join('')}</div>`;
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
      ${taskHtml}
      ${tagsHtml}
    </div>`;
  }).join('');

  // Attach tag handlers
  list.querySelectorAll('.tag-chip-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      History.removeTag(Number(btn.dataset.sessionId), btn.dataset.tag);
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

      function commitTag() {
        const tag = input.value.trim().toLowerCase();
        if (tag) {
          History.addTag(sessionId, tag);
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

      function commitNote() {
        const note = input.value.trim();
        History.updateNote(sessionId, note);
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
