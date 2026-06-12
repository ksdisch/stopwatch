// ── Mood capture (Life-OS Phase 3) ──
// One topbar icon that's always visible, regardless of which pillar the user
// is on. Tap (or keyboard shortcut M) opens a ≤5s capture popover: 5 emoji
// valence chips — ONE tap logs the mood — then the popover flips to optional
// tag chips + a "+ note" reveal. Everything folds into a SINGLE Mood.log()
// call via the GlobalBFRB deferred-commit pattern (js/global-bfrb.js):
// sync-merge-mood keeps the CLOUD copy on a (deviceId, at) collision, so a
// post-hoc patch of an already-synced log is silently dropped. No LWW
// rescues it — hence at most ONE uncommitted capture, committed exactly once.
//
// Commit paths (whichever fires first wins; commitPending is idempotent):
//   - Done button / click-outside / re-tap of the topbar icon (toggle-close)
//   - 30s auto-commit backstop (re-armed on every chip tap / note keystroke)
//   - hashchange / visibilitychange(hidden) / pagehide / beforeunload
//
// v1 non-goals (per the ratified fork #2): no reminders, no undo/edit/delete
// (trend means are robust to a misclick — just log again), no energy axis
// (reserved in the schema), no settings toggle.

const MoodUI = (() => {
  const BTN_ID = 'mood-toggle';
  const POPOVER_ID = 'mood-capture-popover';

  // ── Capture taxonomy ──────────────────────────────────────────────────
  // Valence anchors (1..5) with emoji labels — the ONE required dimension.
  const VALENCE_CHIPS = [
    { valence: 1, emoji: '😞', label: 'Rough' },
    { valence: 2, emoji: '😕', label: 'Off' },
    { valence: 3, emoji: '😐', label: 'OK' },
    { valence: 4, emoji: '😊', label: 'Good' },
    { valence: 5, emoji: '😄', label: 'Great' },
  ];
  // ONE editable tag list (mirrors TRIGGER_CHIPS in js/global-bfrb.js) —
  // qualitative arousal color without a required second dimension. The
  // engine stores whatever strings it's given (≤3), so relabeling needs
  // no other code change.
  const TAG_CHIPS = ['stressed', 'anxious', 'tired', 'calm', 'content', 'energized'];
  const MAX_TAGS = 3;

  // Deferred-commit backstop (mirrors GlobalBFRB.AUTO_COMMIT_MS): armed when
  // the popover opens and re-armed on every chip tap / note keystroke so it
  // never races a deliberating user. Every genuinely-lossy exit (Done,
  // click-outside, navigate, tab background/close) flushes sooner.
  const AUTO_COMMIT_MS = 30000;

  // At most ONE uncommitted capture. `at` is stamped at popover-open (the
  // capture-intent moment) and replayed via Mood.log({ at }) so the dedup
  // signature reflects when the user reached for the icon, not when the
  // 30s backstop happened to fire.
  let pending = null;
  let commitTimer = null;

  // ── Context detection (mirrors GlobalBFRB.getActiveContext) ──────────
  function isFlowRunning() {
    return typeof Flow !== 'undefined' && Flow.getStatus && Flow.getStatus() === 'running';
  }

  function isPomoWorkRunning() {
    if (typeof Pomodoro === 'undefined') return false;
    return Pomodoro.getStatus() === 'running' && Pomodoro.getPhase() === 'work';
  }

  function getActiveContext() {
    if (isFlowRunning()) return 'flow';
    if (isPomoWorkRunning()) return 'pomodoro';
    return 'global';
  }

  // ── Deferred commit ───────────────────────────────────────────────────

  // Persist the pending capture in exactly ONE Mood.log() call (tags + note
  // included), then clear it. Idempotent — safe to call from any flush hook.
  // A pending capture WITHOUT a tapped valence is discarded: there is no
  // meaningful mood event without the one required dimension (opening the
  // popover and walking away logs nothing).
  function commitPending() {
    if (commitTimer) { clearTimeout(commitTimer); commitTimer = null; }
    const p = pending;
    pending = null;
    if (p && typeof p.valence === 'number'
        && typeof Mood !== 'undefined' && typeof Mood.log === 'function') {
      const opts = { valence: p.valence, at: p.at, context: p.context };
      if (Array.isArray(p.tags) && p.tags.length > 0) opts.tags = p.tags.slice(0, MAX_TAGS);
      if (typeof p.note === 'string' && p.note.trim() !== '') opts.note = p.note;
      Mood.log(opts);
    }
    hidePicker();
  }

  function armCommitTimer(ms) {
    if (commitTimer) clearTimeout(commitTimer);
    commitTimer = setTimeout(commitPending, ms);
  }

  // Open a fresh capture. Flushes any still-pending prior capture first
  // (no loss; one log per capture stays guaranteed).
  function openCapture() {
    commitPending();
    pending = { at: Date.now(), valence: null, tags: [], note: '', context: getActiveContext() };
    showPicker();
    armCommitTimer(AUTO_COMMIT_MS);
  }

  // Topbar icon + KeyM behave as a toggle: open when hidden, commit+close
  // when visible (the natural "I'm done" gesture for a topbar control).
  function toggleCapture() {
    if (_popoverEl && !_popoverEl.hidden) {
      commitPending();
      return;
    }
    openCapture();
  }

  // ── Capture popover ───────────────────────────────────────────────────
  // Created lazily on <body> (mirrors the GlobalBFRB capture popover). Uses
  // the NEW `.mood-capture` positioning class (top-anchored under the
  // topbar — .bfrb-capture is bottom-anchored above the FAB) but REUSES the
  // position-independent .bfrb-chip / .bfrb-capture-* classes for the
  // innards so the two popovers stay visually identical.
  let _popoverEl = null;

  function _buildPopover() {
    if (_popoverEl || typeof document === 'undefined' || !document.body) return _popoverEl;
    const el = document.createElement('div');
    el.id = POPOVER_ID;
    el.className = 'mood-capture';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'Log mood');
    el.hidden = true;

    const valenceRow = VALENCE_CHIPS.map(c =>
      '<button type="button" class="bfrb-chip" data-valence="' + c.valence + '" aria-pressed="false">'
      + escapeHtml(c.emoji + ' ' + c.label) + '</button>').join('');
    const tagRow = TAG_CHIPS.map(t =>
      '<button type="button" class="bfrb-chip" data-tag="' + escapeHtml(t) + '" aria-pressed="false">'
      + escapeHtml(t.charAt(0).toUpperCase() + t.slice(1)) + '</button>').join('');

    el.innerHTML =
      '<div class="bfrb-capture-title" data-mood-title>Right now, this feels…</div>'
      + '<div class="bfrb-capture-row" data-group="valence">' + valenceRow + '</div>'
      + '<div data-mood-extras hidden>'
      + '<div class="bfrb-capture-grouplabel">Feels like (optional)</div>'
      + '<div class="bfrb-capture-row" data-group="tag">' + tagRow + '</div>'
      + '<button type="button" class="mood-note-toggle" data-note-toggle>+ note</button>'
      + '<textarea class="mood-note-input" data-mood-note maxlength="280" rows="2"'
      + ' aria-label="Note (optional)" placeholder="A few words (optional)" hidden></textarea>'
      + '<div class="bfrb-capture-actions">'
      + '<button type="button" class="bfrb-capture-done">Done</button></div>'
      + '</div>';

    el.addEventListener('click', _onPopoverClick);
    // Keep pending.note live + re-arm the backstop while the user types,
    // so a slow typist is never cut off mid-note.
    const noteEl = el.querySelector('[data-mood-note]');
    if (noteEl) {
      noteEl.addEventListener('input', () => {
        if (pending) pending.note = noteEl.value;
        armCommitTimer(AUTO_COMMIT_MS);
      });
    }
    document.body.appendChild(el);
    _popoverEl = el;
    return el;
  }

  function _onPopoverClick(e) {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('.bfrb-capture-done')) { commitPending(); return; }
    if (t.closest('[data-note-toggle]')) { _revealNote(); armCommitTimer(AUTO_COMMIT_MS); return; }
    const chip = t.closest('.bfrb-chip');
    if (!chip || !pending) return;
    if (chip.hasAttribute('data-valence')) {
      const v = parseInt(chip.getAttribute('data-valence'), 10);
      const firstPick = (pending.valence === null);
      pending.valence = v; // re-tap a different chip just moves the selection (nothing committed yet)
      if (firstPick) {
        Platform.haptic(20);
        _flipToLogged();
      }
      _syncSelected('valence');
    } else if (chip.hasAttribute('data-tag')) {
      const tag = chip.getAttribute('data-tag');
      const idx = pending.tags.indexOf(tag);
      if (idx !== -1) pending.tags.splice(idx, 1);          // toggle off
      else if (pending.tags.length < MAX_TAGS) pending.tags.push(tag);
      _syncSelected('tag');
    }
    armCommitTimer(AUTO_COMMIT_MS); // re-arm so an engaged user is never cut off
  }

  // First valence tap: confirm the log + reveal the optional extras
  // (tags + note). The valence row stays visible so a misclick can be
  // corrected before the single commit.
  function _flipToLogged() {
    if (!_popoverEl) return;
    const title = _popoverEl.querySelector('[data-mood-title]');
    if (title) {
      title.innerHTML = 'Logged ✓'
        + '<span class="bfrb-capture-sub"> — add color? (optional)</span>';
    }
    const extras = _popoverEl.querySelector('[data-mood-extras]');
    if (extras) extras.hidden = false;
  }

  function _revealNote() {
    if (!_popoverEl) return;
    const toggle = _popoverEl.querySelector('[data-note-toggle]');
    const noteEl = _popoverEl.querySelector('[data-mood-note]');
    if (toggle) toggle.hidden = true;
    if (noteEl) {
      noteEl.hidden = false;
      if (noteEl.focus) noteEl.focus();
    }
  }

  // Reflect the pending selection into each chip row's .is-selected state.
  function _syncSelected(group) {
    if (!_popoverEl) return;
    const row = _popoverEl.querySelector('.bfrb-capture-row[data-group="' + group + '"]');
    if (!row) return;
    row.querySelectorAll('.bfrb-chip').forEach(chip => {
      const on = (group === 'valence')
        ? (pending && pending.valence === parseInt(chip.getAttribute('data-valence'), 10))
        : (pending && pending.tags.indexOf(chip.getAttribute('data-tag')) !== -1);
      chip.classList.toggle('is-selected', !!on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function showPicker() {
    const el = _buildPopover();
    if (!el) return;
    // Reset to the fresh "pick a valence" state.
    el.querySelectorAll('.bfrb-chip').forEach(c => { c.classList.remove('is-selected'); c.setAttribute('aria-pressed', 'false'); });
    const title = el.querySelector('[data-mood-title]');
    if (title) title.textContent = 'Right now, this feels…';
    const extras = el.querySelector('[data-mood-extras]');
    if (extras) extras.hidden = true;
    const toggle = el.querySelector('[data-note-toggle]');
    if (toggle) toggle.hidden = false;
    const noteEl = el.querySelector('[data-mood-note]');
    if (noteEl) { noteEl.hidden = true; noteEl.value = ''; }
    el.hidden = false;
    // Move focus into the popover so keyboard/SR users can capture without
    // a pointer. Non-blocking, auto-committing — no focus trap; focus is
    // restored to the topbar icon on hide (below). Mirrors GlobalBFRB.
    const firstChip = el.querySelector('.bfrb-chip');
    if (firstChip && firstChip.focus) firstChip.focus();
  }

  function hidePicker() {
    if (!_popoverEl) return;
    // Restore focus to the topbar icon, but only if it currently sits inside
    // the popover (hidePicker is also reached from non-focus paths like the
    // auto-commit timer — we shouldn't yank focus then).
    const focusWasInside = _popoverEl.contains(document.activeElement);
    _popoverEl.hidden = true;
    if (focusWasInside) {
      const btn = document.getElementById(BTN_ID);
      if (btn && btn.focus) btn.focus();
    }
  }

  function init() {
    const btn = document.getElementById(BTN_ID);
    if (btn) btn.addEventListener('click', toggleCapture);

    // Keyboard shortcut: M (audit-confirmed free; B/R/L/N/Space taken).
    // Suppressed when focus is inside a text-entry field — including this
    // popover's own note textarea — so it never interferes with typing.
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyM') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      toggleCapture();
    });

    // Guaranteed flush — a pending capture must never be lost on app exit or
    // a route change. commitPending is idempotent, so registering it on
    // several lifecycle events is safe (whichever fires first wins).
    window.addEventListener('pagehide', commitPending);
    window.addEventListener('beforeunload', commitPending);
    window.addEventListener('hashchange', commitPending);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) commitPending();
    });

    // Click anywhere outside the popover (and not on the topbar icon)
    // dismisses it, committing the pending capture — the natural "I'm done"
    // signal, so the backstop timer never has to race a deliberating user.
    // The icon is excluded because its own handler (toggleCapture) owns
    // that path.
    document.addEventListener('click', (e) => {
      if (!_popoverEl || _popoverEl.hidden) return;
      const t = e.target;
      if (t && t.closest && (t.closest('#' + POPOVER_ID) || t.closest('#' + BTN_ID))) return;
      commitPending();
    });
  }

  // The topbar button is in the DOM before this script tag executes
  // (deferred scripts run after parse), so wiring at load is safe —
  // matches the GlobalBFRB init-at-load pattern.
  init();

  return { openCapture, toggleCapture, commitPending };
})();

if (typeof window !== 'undefined') {
  window.MoodUI = MoodUI;
}
