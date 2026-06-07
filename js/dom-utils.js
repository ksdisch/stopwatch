function escapeHtml(str) {
  const el = document.createElement('span');
  // null-safe: undefined/null → '' (not the literal "undefined"/"null"). This
  // matches the behavior the wellness UIs had open-coded before they were
  // de-duped to this shared helper (Batch E reuse sweep).
  el.textContent = String(str ?? '');
  return el.innerHTML;
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
