function escapeHtml(str) {
  // Escape the five HTML-significant characters. The previous element/innerHTML
  // serializer only escaped & < > (text-node context) and left " and ' raw —
  // safe inside element text, but an injection vector wherever the result is
  // interpolated into a QUOTED HTML attribute (the dominant pattern across this
  // codebase: aria-label/title/data-*/value=). Escaping quotes too closes that
  // whole attribute-context class (audit M7) and is byte-identical in text
  // context once the browser re-parses the entities. null-safe: undefined/null
  // → '' (not the literal "undefined"/"null"), matching the prior behavior the
  // wellness UIs relied on (Batch E reuse sweep). Order matters: & first so the
  // ampersands introduced by the later entities aren't double-escaped.
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// True when the event target is a text-entry surface — a real <input>,
// <textarea>, or any contenteditable element. The per-mode keydown handlers used
// to guard only on tagName === 'INPUT', so Space pressed while renaming a
// CONTENTEDITABLE field (Compare/instance-card names, Pomodoro saved-task
// rename) still fired the mode's primary action AND swallowed the space (C1).
// Shared so every mode guards identically.
function isTextEntry(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable === true;
}

// Announce a message to assistive tech via the shared #sr-announce live region
// (aria-live="assertive"). clear-then-set on the next frame so a repeated
// identical message is still re-announced. Promoted to a shared global (Batch D)
// so EVERY mode can report state changes — previously only the Stopwatch did,
// leaving Timer/Pomodoro/Flow/Interval/Cooking/Sequence silent to screen readers.
function announce(msg) {
  const el = document.getElementById('sr-announce');
  if (!el) return;
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = msg; });
}

// ── Shared modal/dialog focus management (Batch D) ────────────────────────
// Makes an already-shown container behave as a modal dialog for keyboard + SR
// users: role=dialog + aria-modal, move focus IN on open, trap Tab inside,
// Escape to close, and restore focus to the opener on close. Designed to wrap
// the app's existing `.hidden`-toggle panels/drawers/overlays with two calls —
// openModal(el, opts) right after you show it, closeModal(el) right after (or
// instead of) you hide it. Idempotent: re-opening an already-open container is a
// no-op; closing a non-open one is a no-op.
//
// Scope note: we rely on aria-modal=true + the Tab trap to keep AT/keyboard
// inside the dialog. We deliberately do NOT manually `inert` the background —
// that needs per-surface DOM knowledge and is error-prone; aria-modal is the
// SR scoping hint and the trap is the hard keyboard guarantee. (A background-
// inert pass is a follow-up that warrants real VoiceOver/NVDA verification.)
function _modalFocusables(container) {
  const sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  return [...container.querySelectorAll(sel)].filter(el => el.offsetParent !== null);
}

function openModal(container, opts = {}) {
  if (!container || container._a11yModal) return;
  const prevFocus = document.activeElement;
  if (!container.getAttribute('role')) container.setAttribute('role', 'dialog');
  container.setAttribute('aria-modal', 'true');
  if (opts.labelledBy) container.setAttribute('aria-labelledby', opts.labelledBy);
  else if (opts.label) container.setAttribute('aria-label', opts.label);

  const onKeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (typeof opts.onClose === 'function') opts.onClose();
      else closeModal(container);
      return;
    }
    if (e.key !== 'Tab') return;
    const f = _modalFocusables(container);
    if (f.length === 0) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  container.addEventListener('keydown', onKeydown);
  container._a11yModal = { prevFocus, onKeydown };

  // Move focus in: caller-specified, else first focusable, else the container.
  const f = _modalFocusables(container);
  const target = opts.initialFocus || f[0];
  if (target && target.focus) {
    target.focus();
  } else {
    container.setAttribute('tabindex', '-1');
    container.focus();
  }
}

// closeModal(container, { restoreFocus }): tears down the trap + aria-modal and
// restores focus to the opener. Pass { restoreFocus: false } when closing
// because focus has ALREADY moved on — e.g. a settings-drawer item that opened
// another panel; restoring here would steal focus back from that new panel.
function closeModal(container, opts = {}) {
  if (!container || !container._a11yModal) return;
  const { prevFocus, onKeydown } = container._a11yModal;
  container.removeEventListener('keydown', onKeydown);
  container.removeAttribute('aria-modal');
  delete container._a11yModal;
  if (opts.restoreFocus !== false && prevFocus && typeof prevFocus.focus === 'function') {
    prevFocus.focus();
  }
}
