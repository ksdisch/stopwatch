// E-3 — Toast.downlevelWarning + Toast.bufferOverflow (retroactive E-2 coverage)
//
// Coverage (per E-3-AUDIT § "Test scope"):
//
//   Toast.downlevelWarning (NEW IN E-3)
//     1. Paints toast with verbatim PLAN.md §E-3 copy.
//     2. Second call within session no-ops (dedup flag set).
//     3. Sign-out via SyncEngine.emit('auth-change', null) resets the flag → re-arms.
//     4. SyncEngine.emit('auth-change', { uid: 'x' }) does NOT reset (only null).
//     5. SyncEngine.emit('refuse-writeback', {...}) triggers downlevelWarning via listener.
//     6. Concurrent bufferOverflow + downlevelWarning — second replaces first (single-slot).
//     7. _resetForTests clears dedup flag AND tears down any visible toast.
//
//   Toast.bufferOverflow (retroactive E-2 coverage — no test file shipped in E-2)
//     8. Paints toast with verbatim E-2 copy.
//     9. SyncEngine.emit('buffer-overflow', { droppedCount }) triggers via listener.
//
// Mocking pattern: Toast is a DOM helper (allowed DOM access by phase brief).
// We probe document.body for the toast element by id ('sync-toast'). Each
// case calls Toast._resetForTests() in finally to clear the dedup flag +
// any visible toast. The auto-dismiss 5s timer is left alone — tests
// either wait for it (rare) or call _resetForTests() which clears it.

const TOAST_ID = 'sync-toast';
const DOWNLEVEL_COPY = 'Your phone is on a newer version. This device is read-only until you update.';
const BUFFER_COPY = 'Buffered changes exceeded cap; oldest changes lost — please re-sync.';

function _toast_getEl() {
  return document.getElementById(TOAST_ID);
}

// Remove every #sync-toast element from the DOM immediately. Used in
// before/after each case to drop any toasts that earlier tests left
// behind (the _hide setTimeout(removeChild, 200) may still be pending
// when the test runs synchronously).
function _toast_purge() {
  Toast._resetForTests();
  // _resetForTests calls _hide which schedules a 200ms removeChild.
  // Run it ourselves immediately so DOM state is deterministic.
  const all = document.querySelectorAll('#' + TOAST_ID);
  for (const el of all) {
    if (el.parentNode) el.parentNode.removeChild(el);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Toast.downlevelWarning
// ────────────────────────────────────────────────────────────────────────

describe('Toast.downlevelWarning', () => {

  it('1. paints toast with verbatim PLAN.md §E-3 copy', () => {
    try {
      _toast_purge();
      Toast.downlevelWarning(99);
      const all = document.querySelectorAll('#' + TOAST_ID);
      assertEqual(all.length, 1, 'exactly one toast in DOM (got ' + all.length + ')');
      const el = all[0];
      assertEqual(el.id, TOAST_ID, 'id is "sync-toast"');
      assertEqual(el.textContent, DOWNLEVEL_COPY,
        'textContent matches verbatim PLAN.md §E-3 line 409 copy (got: ' + JSON.stringify(el.textContent) + ')');
    } finally {
      _toast_purge();
    }
  });

  it('2. dedup — second call within session no-ops (only one toast painted across two calls)', () => {
    try {
      _toast_purge();
      Toast.downlevelWarning(99);
      const first = _toast_getEl();
      assert(first != null, 'first call paints toast');

      // Remove from DOM directly (simulating auto-dismiss completing) but
      // keep the dedup flag set. The second call should NOT paint a new toast.
      if (first.parentNode) first.parentNode.removeChild(first);

      Toast.downlevelWarning(99);
      const after = document.querySelectorAll('#' + TOAST_ID);
      assertEqual(after.length, 0,
        'second downlevelWarning within session does NOT paint (dedup flag set)');
    } finally {
      _toast_purge();
    }
  });

  it('3. sign-out via SyncEngine.emit("auth-change", null) resets the dedup flag', () => {
    try {
      _toast_purge();
      Toast.downlevelWarning(99);
      assert(_toast_getEl() != null, 'first call paints');
      // Remove the DOM element manually.
      const el = _toast_getEl();
      if (el && el.parentNode) el.parentNode.removeChild(el);

      // Emit sign-out — resets the dedup flag.
      SyncEngine.emit('auth-change', null);

      Toast.downlevelWarning(99);
      const refreshed = _toast_getEl();
      assert(refreshed != null,
        'after sign-out reset, next downlevelWarning paints again');
    } finally {
      _toast_purge();
    }
  });

  it('4. signed-in auth-change does NOT reset the dedup flag (only null triggers reset)', () => {
    try {
      _toast_purge();
      Toast.downlevelWarning(99);
      const el = _toast_getEl();
      if (el && el.parentNode) el.parentNode.removeChild(el);

      // Emit a SIGNED-IN auth change (truthy user) — must NOT reset flag.
      SyncEngine.emit('auth-change', { uid: 'u-signed-in' });

      Toast.downlevelWarning(99);
      const after = document.querySelectorAll('#' + TOAST_ID);
      assertEqual(after.length, 0,
        'signed-in auth-change preserves dedup flag — no second toast');
    } finally {
      _toast_purge();
    }
  });

  it('5. SyncEngine.emit("refuse-writeback", {...}) triggers downlevelWarning via the registered listener', () => {
    try {
      _toast_purge();
      // Confirm the listener IS registered (Toast IIFE wires it on load).
      SyncEngine.emit('refuse-writeback', {
        store: 'meds',
        remoteSchemaVersion: 99,
        localSchemaVersion: 1,
      });
      const el = _toast_getEl();
      assert(el != null, 'refuse-writeback event painted toast via listener');
      assertEqual(el.textContent, DOWNLEVEL_COPY,
        'toast carries the downlevel-warning copy (got: ' + JSON.stringify(el.textContent) + ')');
    } finally {
      _toast_purge();
    }
  });

  it('6. concurrent bufferOverflow + downlevelWarning — second replaces first (single-slot semantic after fade tail)', async () => {
    try {
      _toast_purge();
      Toast.bufferOverflow(5);
      const first = _toast_getEl();
      assert(first != null, 'bufferOverflow painted first toast');
      assertEqual(first.textContent, BUFFER_COPY,
        'first toast has bufferOverflow copy (got: ' + JSON.stringify(first.textContent) + ')');

      // Immediately paint a downlevel warning — replaces the first. The
      // implementation has a 200ms FADE_OUT_MS window during which both
      // elements coexist (the new toast is appended while the old waits
      // for its fade-out removeChild). The "single-slot" contract holds
      // AFTER the fade-out tail completes.
      Toast.downlevelWarning(99);

      // Wait past the 200ms fade-out so the first toast's removeChild fires.
      await new Promise(r => setTimeout(r, 300));

      const all = document.querySelectorAll('#' + TOAST_ID);
      assertEqual(all.length, 1, 'only one toast in DOM after fade tail (got ' + all.length + ')');
      assertEqual(all[0].textContent, DOWNLEVEL_COPY,
        'remaining toast has downlevelWarning copy (got: ' + JSON.stringify(all[0].textContent) + ')');
    } finally {
      _toast_purge();
    }
  });

  it('7. _resetForTests clears dedup flag AND tears down any visible toast', () => {
    try {
      _toast_purge();
      Toast.downlevelWarning(99);
      assert(_toast_getEl() != null, 'toast painted pre-reset');

      _toast_purge();

      // The toast removal happens after a FADE_OUT_MS (200ms) setTimeout —
      // verify dedup flag is reset by calling downlevelWarning again
      // immediately and asserting a NEW toast paints.
      Toast.downlevelWarning(99);
      const el = _toast_getEl();
      assert(el != null, 'post-reset, downlevelWarning paints again (dedup flag cleared)');
      assertEqual(el.textContent, DOWNLEVEL_COPY,
        'verbatim copy painted on reset+repaint');
    } finally {
      _toast_purge();
    }
  });

});

// ────────────────────────────────────────────────────────────────────────
// Toast.bufferOverflow — retroactive E-2 coverage (no test file shipped in E-2)
// ────────────────────────────────────────────────────────────────────────

describe('Toast.bufferOverflow — retroactive E-2 coverage', () => {

  it('8. paints toast with verbatim E-2 copy', () => {
    try {
      _toast_purge();
      Toast.bufferOverflow(5);
      const all = document.querySelectorAll('#' + TOAST_ID);
      assertEqual(all.length, 1, 'one toast in DOM (got ' + all.length + ')');
      const el = all[0];
      assertEqual(el.id, TOAST_ID, 'id is "sync-toast"');
      assertEqual(el.textContent, BUFFER_COPY,
        'textContent matches verbatim PLAN.md §E-2 line 389 copy (got: ' + JSON.stringify(el.textContent) + ')');
    } finally {
      _toast_purge();
    }
  });

  it('9. SyncEngine.emit("buffer-overflow", { droppedCount }) triggers via the registered listener', () => {
    try {
      _toast_purge();
      SyncEngine.emit('buffer-overflow', { droppedCount: 10 });
      const el = _toast_getEl();
      assert(el != null, 'buffer-overflow event painted toast via listener');
      assertEqual(el.textContent, BUFFER_COPY,
        'toast carries the bufferOverflow copy (got: ' + JSON.stringify(el.textContent) + ')');
    } finally {
      _toast_purge();
    }
  });

});

// ────────────────────────────────────────────────────────────────────────
// Toast.action (Phase 3 — tappable variant for the stress nudge)
// ────────────────────────────────────────────────────────────────────────

describe('Toast.action', () => {

  it('1. paints message + a tappable button; tap hides the toast and invokes onTap', () => {
    try {
      _toast_purge();
      let taps = 0;
      Toast.action('Breather is one tap away.', 'Open', () => { taps++; });
      const el = _toast_getEl();
      assert(el !== null, 'toast painted');
      assert(el.textContent.indexOf('Breather is one tap away.') !== -1, 'message text present');
      const btn = el.querySelector('.sync-toast-action-btn');
      assert(btn !== null, 'action button present');
      assertEqual(btn.textContent, 'Open', 'button label');
      btn.click();
      assertEqual(taps, 1, 'onTap invoked exactly once');
    } finally {
      _toast_purge();
    }
  });

  it('2. missing handler/label degrades to a message-only toast (no button)', () => {
    try {
      _toast_purge();
      Toast.action('Just a message.', 'Open', null);
      let el = _toast_getEl();
      assert(el !== null, 'toast painted without handler');
      assertEqual(el.querySelector('.sync-toast-action-btn'), null, 'no button without handler');
      _toast_purge();
      Toast.action('Still a message.', '', () => {});
      el = _toast_getEl();
      assert(el !== null, 'toast painted without label');
      assertEqual(el.querySelector('.sync-toast-action-btn'), null, 'no button without label');
    } finally {
      _toast_purge();
    }
  });

  it('3. a throwing onTap does not propagate out of the click handler', () => {
    try {
      _toast_purge();
      Toast.action('Trouble.', 'Open', () => { throw new Error('boom'); });
      const btn = _toast_getEl().querySelector('.sync-toast-action-btn');
      let threw = false;
      try { btn.click(); } catch (_) { threw = true; }
      assertEqual(threw, false, 'click swallows the onTap throw');
    } finally {
      _toast_purge();
    }
  });

  it('4. second action replaces the first (single TOAST_ID slot)', () => {
    try {
      _toast_purge();
      Toast.action('First.', 'Open', () => {});
      Toast.action('Second.', 'Go', () => {});
      // _hide() removes the replaced toast on a 200ms fade timeout, so the
      // old element may still be mid-removal — assert on the NEWEST one.
      const all = document.querySelectorAll('#' + TOAST_ID);
      const newest = all[all.length - 1];
      assert(newest.textContent.indexOf('Second.') !== -1, 'newest toast wins the slot');
      assertEqual(newest.querySelector('.sync-toast-action-btn').textContent, 'Go', 'newest button label');
    } finally {
      _toast_purge();
    }
  });

});

// ────────────────────────────────────────────────────────────────────────
// H3 — sync-error recovery toast. The write gate enters 'error' on a sync
// failure (and deliberately doesn't auto-clear). SyncState.set emits
// 'sync-error' on that transition; sync-toast paints a tappable "Retry" toast
// whose tap runs SyncEngine.retrySync (clears the gate → re-attempts sync).
// This exercises the FULL chain with the REAL retrySync (window.SyncState is
// stubbed only so the gate write is observable).
// ────────────────────────────────────────────────────────────────────────
describe('Toast — sync-error recovery (H3)', () => {

  it('SyncEngine.emit("sync-error") paints a Retry toast whose tap clears the gate to ready', () => {
    const realState = window.SyncState;
    const sets = [];
    window.SyncState = {
      get: () => 'error',
      set: (s) => { sets.push(s); return true; },
      canWrite: () => false,
      isHydrating: () => false,
    };
    try {
      _toast_purge();
      SyncEngine.emit('sync-error', {});
      const el = _toast_getEl();
      assert(el, 'sync-error toast painted via the registered listener');
      assert(el.textContent.indexOf('Sync paused') !== -1, 'recovery message surfaced');
      const btn = el.querySelector('.sync-toast-action-btn');
      assert(btn, 'Retry button present (tappable toast)');
      assertEqual(btn.textContent, 'Retry', 'button label is Retry');

      // Tap → the REAL SyncEngine.retrySync runs → clears the gate to 'ready'.
      btn.click();
      assert(sets.indexOf('ready') !== -1,
        'tapping Retry clears the error gate to ready (real retrySync path)');
    } finally {
      window.SyncState = realState;
      _toast_purge();
    }
  });

  it('a throwing retrySync never strands the tap handler', () => {
    const realState = window.SyncState;
    const realRetry = SyncEngine.retrySync;
    window.SyncState = { get: () => 'error', set: () => true, canWrite: () => false, isHydrating: () => false };
    SyncEngine.retrySync = () => { throw new Error('boom'); };
    try {
      _toast_purge();
      SyncEngine.emit('sync-error', {});
      const btn = _toast_getEl().querySelector('.sync-toast-action-btn');
      let threw = false;
      try { btn.click(); } catch (_) { threw = true; }
      assertEqual(threw, false, 'click swallows a throwing retrySync');
    } finally {
      SyncEngine.retrySync = realRetry;
      window.SyncState = realState;
      _toast_purge();
    }
  });

});
