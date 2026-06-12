// E-2 + E-3: SyncToast — visible toast surface for cloud-sync user notifications.
//
// First real cloud-sync visible toast in the codebase. Mirrors the existing
// `.undo-toast` DOM pattern from `js/ui.js:354-462` + `css/styles.css`'s
// `.undo-toast` block (lines 1350-1369) — single global toast surface
// appended to `document.body` so it survives route changes. No concurrent-
// toast queue; a second toast within the visible window replaces the
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
// **E-3 scope additions:**
//   - Toast.downlevelWarning(remoteSchemaVersion) — paints the F19a
//     refuse-writeback warning with the verbatim PLAN.md §E-3 line 409
//     copy: 'Your phone is on a newer version. This device is read-only
//     until you update.' The `remoteSchemaVersion` parameter is accepted
//     for parity with the `'refuse-writeback'` event payload but NOT
//     surfaced in the copy (matches `bufferOverflow`'s `droppedCount`
//     pattern — Kyle's UX choice).
//   - Once-per-session dedup via the module-scope `_downlevelWarningShown`
//     flag (Pick A on E-3-PROMPT TODO #5). The F19a contract has THREE
//     code paths that emit `'refuse-writeback'` (per-record CAS in each
//     of the 6 sync-merge files, per-merge-fn cloud-side gate in each
//     file, and the dispatcher snapshot pre-filter in `js/sync-engine.js`);
//     without dedup the user could see dozens of toasts per cycle. The
//     flag resets on `'auth-change'` with `null` (the existing sign-out
//     contract from `js/sync-auth.js:48-50`) so the warning re-arms on
//     next sign-in.
//   - `_resetForTests()` — test-only escape hatch returned on the public
//     API. Resets the dedup flag + tears down any visible toast so each
//     test case starts from a clean baseline. NOT production API; tests
//     under `tests/sync-toast.test.js` consume it directly.
//
// **Deferred:** B-4 `Toast.medsArrival(medId, count)` — the
// `sync-merge-meds.js` merge fn already emits `meds-arrival` events but no
// UI surface paints them. Audit flags this as a freebie the implementer
// MAY land in E-2; explicitly NOT bundled in E-3 either (separate PR).
//
// **No engine logic in this module** — pure DOM + event listener.
// Engine-implementer ships in lockstep with the engine modules; Phase 4
// ui-wirer does SMOKE-ONLY verification via synthetic
// `SyncEngine.emit('buffer-overflow', { droppedCount: 5 })` /
// `SyncEngine.emit('refuse-writeback', { store: 'meds', remoteSchemaVersion: 99 })`.

const Toast = (() => {

  const TOAST_ID = 'sync-toast';
  const CSS_CLASS = 'sync-toast';
  const VISIBLE_CLASS = 'sync-visible';
  const AUTO_DISMISS_MS = 5000;
  const FADE_OUT_MS = 200;

  // E-3: once-per-session dedup flag for `downlevelWarning`. The F19a
  // refuse-writeback contract has 3 code paths that can emit; without
  // this flag the user could see N toasts per cycle. Flag resets on
  // `'auth-change'` with `null` (sign-out) so the warning re-arms on
  // next sign-in.
  let _downlevelWarningShown = false;

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

  // E-3 public — paint the downlevel-client warning. Triggered by the
  // `'refuse-writeback'` event emitted from the F19a contract's three
  // existing layers (per-record CAS, per-merge-fn cloud-side gate,
  // dispatcher snapshot pre-filter). Once-per-session dedup via the
  // module-scope `_downlevelWarningShown` flag (Pick A on TODO #5):
  // first event paints + sets the flag; subsequent events `console.warn`
  // only. Flag resets on the sign-out signal so the warning re-arms on
  // next sign-in. The `remoteSchemaVersion` param is accepted for
  // parity with the event payload but NOT surfaced in the copy.
  function downlevelWarning(/* remoteSchemaVersion */) {
    if (_downlevelWarningShown) {
      try { console.warn('[Toast] downlevel-warning suppressed (already shown this session)'); }
      catch (_) {}
      return;
    }
    // Verbatim PLAN.md §E-3 line 409 copy.
    _show('Your phone is on a newer version. This device is read-only until you update.');
    _downlevelWarningShown = true;
  }

  // Public — paint an arbitrary non-blocking notice. Used by surfaces beyond
  // cloud sync (e.g. the BFRB pace-support nudge in js/global-bfrb.js, which
  // owns its own once-per-day throttle). `_show` uses textContent, so a
  // parameterized string is XSS-safe with no escaping needed. No-ops on a
  // falsy/blank string.
  function notice(text) {
    if (typeof text !== 'string' || text.trim() === '') return;
    _show(text);
  }

  // Public — paint a TAPPABLE notice with a single action button (Phase 3
  // stress nudge: 'Open' → Wellness › Mindful). Deliberately a PARALLEL
  // code path to `_show` rather than a refactor of it: same TOAST_ID /
  // CSS_CLASS / auto-dismiss single-slot pattern, but the message rides a
  // <span> (textContent — XSS-safe) plus a <button> child so the toast
  // stays non-blocking while offering one optional tap. The button hides
  // the toast FIRST, then invokes `onTap` in a try/catch (a throwing
  // handler never strands a visible toast). No-ops on a falsy/blank
  // message, mirroring `notice`; with no valid btnLabel/onTap it degrades
  // to a plain message toast.
  function action(text, btnLabel, onTap) {
    if (typeof text !== 'string' || text.trim() === '') return;
    if (typeof document === 'undefined' || !document.body) return;

    // Clear any prior toast (single active slot — same as _show).
    _hide();

    const toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.className = CSS_CLASS;
    const msgEl = document.createElement('span');
    msgEl.textContent = text;
    toast.appendChild(msgEl);
    if (typeof btnLabel === 'string' && btnLabel && typeof onTap === 'function') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sync-toast-action-btn';
      btn.textContent = btnLabel;
      btn.addEventListener('click', () => {
        _hide();
        try { onTap(); } catch (_) {}
      });
      toast.appendChild(btn);
    }
    document.body.appendChild(toast);

    // Same next-frame visible-class idiom as `_show` so the CSS
    // transition runs.
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        try { toast.classList.add(VISIBLE_CLASS); } catch (_) {}
      });
    } else {
      try { toast.classList.add(VISIBLE_CLASS); } catch (_) {}
    }

    _activeTimeout = setTimeout(_hide, AUTO_DISMISS_MS);
  }

  // Test-only escape hatch — resets the dedup flag + tears down any
  // visible toast so each test case starts from a clean baseline.
  // Production callers SHOULD NOT call this — the natural reset path
  // is `SyncEngine.emit('auth-change', null)` (the sign-out signal).
  function _resetForTests() {
    try { _downlevelWarningShown = false; } catch (_) {}
    try { _hide(); } catch (_) {}
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

    // E-3: downlevel-warning listener. Consumes the `'refuse-writeback'`
    // event emitted by the F19a contract's three layers (per-record CAS
    // in each of 6 sync-merge files, per-merge-fn cloud-side gate in
    // each file, and the dispatcher snapshot pre-filter in
    // `js/sync-engine.js`). Dedup happens inside `downlevelWarning` via
    // the module-scope flag; this listener fires on every event but
    // paints at most once per session.
    try {
      SyncEngine.on('refuse-writeback', (payload) => {
        const ver = (payload && typeof payload.remoteSchemaVersion === 'number')
          ? payload.remoteSchemaVersion
          : 0;
        try { downlevelWarning(ver); } catch (_) {}
      });
    } catch (_) {}

    // E-3: sign-out reset listener. The existing `'auth-change'` event
    // from `js/sync-auth.js:48-50` carries the new user (or `null` on
    // sign-out). When `null` arrives, reset the dedup flag so the
    // downlevel warning re-arms on next sign-in. We re-use this
    // existing event rather than introducing a brand-new `'sign-out'`
    // event (matches the audit's recommended shape — fewer cross-module
    // contracts to maintain).
    try {
      SyncEngine.on('auth-change', (user) => {
        if (!user) {
          _downlevelWarningShown = false;
        }
      });
    } catch (_) {}

    // TODO (B-4 freebie — deferred per implementer scope decision):
    // wire `Toast.medsArrival(medId, count)` here to consume the
    // `meds-arrival` event emitted by `js/sync-merge-meds.js:10`. The
    // method body would mirror `bufferOverflow` — a single-line listener
    // registration. Splitting this into its own PR keeps the E-2/E-3
    // commit messages focused; no functional reason it couldn't land
    // alongside.
  }

  try { _registerListener(); }
  catch (_) {}

  return {
    bufferOverflow,
    downlevelWarning,
    notice,
    action,
    // Test-only escape hatch — see `_resetForTests` definition above.
    _resetForTests,
    // Internal hooks exposed for tests + future surfaces.
    _hide,
    _show,
  };
})();

if (typeof window !== 'undefined') {
  window.Toast = Toast;
}
