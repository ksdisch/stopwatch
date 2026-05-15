// E-2: SyncToast — visible toast surface for cloud-sync user notifications.
//
// First real cloud-sync visible toast in the codebase. Mirrors the existing
// `.undo-toast` DOM pattern from `js/ui.js:354-462` + `css/styles.css`'s
// `.undo-toast` block (lines 1350-1369) — single global toast surface
// appended to `document.body` so it survives route changes. No concurrent-
// toast queue; a second overflow within the visible window replaces the
// first (acceptable UX for an edge-case warning).
//
// **Current scope (E-2):**
//   - Toast.bufferOverflow(droppedCount) — paints a fixed-position toast
//     with the verbatim PLAN.md §E-2 line 389 copy:
//       'Buffered changes exceeded cap; oldest changes lost — please re-sync.'
//   - Auto-dismisses after 5s via setTimeout + 200ms transition tail for
//     the fade-out animation. The CSS rule (`.sync-toast`/`.sync-toast.sync-visible`)
//     lives in `css/styles.css` mirroring the `.undo-toast` byte-identical.
//   - Module init registers `SyncEngine.on('buffer-overflow', ...)` so the
//     buffer's `enqueue()` overflow path paints the toast without coupling
//     `js/sync-buffer.js` to DOM (engine-no-DOM rule).
//
// **Deferred:** B-4 `Toast.medsArrival(medId, count)` — the
// `sync-merge-meds.js` merge fn already emits `meds-arrival` events but no
// UI surface paints them. Audit flags this as a freebie the implementer
// MAY land in E-2. SKIPPED in this PR to keep the commit message clean
// ("E-2 offline buffer" vs "E-2 offline buffer + B-4 medsArrival
// activation"). The listener wire-up is a single-line addition in a
// future B-4 follow-up — TODO marker below.
//
// **No engine logic in this module** — pure DOM + event listener.
// Engine-implementer ships in lockstep with the buffer module; Phase 4
// ui-wirer does SMOKE-ONLY verification via a synthetic
// `SyncEngine.emit('buffer-overflow', { droppedCount: 5 })`.

const Toast = (() => {

  const TOAST_ID = 'sync-toast';
  const CSS_CLASS = 'sync-toast';
  const VISIBLE_CLASS = 'sync-visible';
  const AUTO_DISMISS_MS = 5000;
  const FADE_OUT_MS = 200;

  // Single active timeout slot so a second toast replaces the first
  // cleanly (no double-dismiss race).
  let _activeTimeout = null;

  function _hide() {
    if (_activeTimeout != null) {
      try { clearTimeout(_activeTimeout); } catch (_) {}
      _activeTimeout = null;
    }
    if (typeof document === 'undefined') return;
    const existing = document.getElementById(TOAST_ID);
    if (!existing) return;
    try { existing.classList.remove(VISIBLE_CLASS); } catch (_) {}
    // Wait the CSS transition out before removing so the fade-out is
    // visible to the user.
    setTimeout(() => {
      try {
        if (existing && existing.parentNode) {
          existing.parentNode.removeChild(existing);
        }
      } catch (_) {}
    }, FADE_OUT_MS);
  }

  function _show(text) {
    if (typeof document === 'undefined' || !document.body) return;

    // Clear any prior toast so the second overflow replaces the first
    // without double-dismissing.
    _hide();

    const toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.className = CSS_CLASS;
    // Verbatim copy — no parameterization, so no escapeHtml needed.
    toast.textContent = text;
    document.body.appendChild(toast);

    // requestAnimationFrame to add the visible class on the next frame
    // so the CSS transition runs (the .undo-toast pattern from
    // `js/ui.js:359` uses the same idiom).
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        try { toast.classList.add(VISIBLE_CLASS); } catch (_) {}
      });
    } else {
      try { toast.classList.add(VISIBLE_CLASS); } catch (_) {}
    }

    _activeTimeout = setTimeout(_hide, AUTO_DISMISS_MS);
  }

  // Public — paint the buffer-overflow warning. The droppedCount is
  // currently not surfaced in the copy (the verbatim string mentions
  // "oldest changes" without a count for cleaner UX); the param is
  // accepted for future cosmetic tweaks + listener signature parity.
  function bufferOverflow(/* droppedCount */) {
    _show('Buffered changes exceeded cap; oldest changes lost — please re-sync.');
  }

  // ── Module init: subscribe to engine events ──────────────────────────
  //
  // Lazy registration: if SyncEngine.on isn't available at script-load
  // time (e.g. wrong script order or a unit-test harness without
  // sync-engine loaded), skip the wire-up gracefully. The contract is
  // best-effort UI; correctness lives in the buffer.

  function _registerListener() {
    if (typeof SyncEngine === 'undefined' || typeof SyncEngine.on !== 'function') return;
    try {
      SyncEngine.on('buffer-overflow', (payload) => {
        const dropped = (payload && typeof payload.droppedCount === 'number')
          ? payload.droppedCount
          : 0;
        try { bufferOverflow(dropped); } catch (_) {}
      });
    } catch (_) {}

    // TODO (B-4 freebie — deferred per implementer scope decision):
    // wire `Toast.medsArrival(medId, count)` here to consume the
    // `meds-arrival` event emitted by `js/sync-merge-meds.js:10`. The
    // method body would mirror `bufferOverflow` — a single-line listener
    // registration. Splitting this into its own PR keeps the E-2 commit
    // message focused; no functional reason it couldn't land alongside.
  }

  try { _registerListener(); }
  catch (_) {}

  return {
    bufferOverflow,
    // Internal hooks exposed for tests + future surfaces.
    _hide,
    _show,
  };
})();

if (typeof window !== 'undefined') {
  window.Toast = Toast;
}
