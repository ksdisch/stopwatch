function escapeHtml(str) {
  const el = document.createElement('span');
  // null-safe: undefined/null → '' (not the literal "undefined"/"null"). This
  // matches the behavior the wellness UIs had open-coded before they were
  // de-duped to this shared helper (Batch E reuse sweep).
  el.textContent = String(str ?? '');
  return el.innerHTML;
}
