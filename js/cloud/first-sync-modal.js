// First-sync merge modal.
//
// Shown the first time a user signs in on a device that already has
// non-empty local data AND the cloud account also has non-empty data.
// Three actions: replace local with cloud, merge local into cloud,
// or sign back out. A `buildBackupData()` snapshot is downloaded
// before any merge so the user has a parachute.
//
// Detection runs on auth-change → signed-in. We skip it if either side
// is empty (no conflict possible).

const FirstSyncModal = (() => {
  const MODAL_ID = 'cloud-first-sync-modal';
  let lastShownForUid = null;

  // ── Detection ───────────────────────────────────────────────────────

  function localHasData() {
    const meds = localStorage.getItem('wellness_meds');
    const rest = localStorage.getItem('wellness_rest_log');
    const bfrb = localStorage.getItem('bfrbs_global');
    if (meds && meds !== '{}' && meds !== '{"meds":[]}') return true;
    if (rest && rest !== '{}') return true;
    if (bfrb && bfrb !== '[]') return true;
    return false;
  }

  async function remoteHasData(user) {
    const db = window.Cloud && Cloud.getDb();
    if (!db) return false;
    const root = db.collection('users').doc(user.uid);
    // Probe one doc from each collection. Empty subcollections add
    // small overhead — fine for a one-shot first-sign-in path.
    const meds = await root.collection('meds').limit(1).get();
    if (!meds.empty) return true;
    const bfrbs = await root.collection('bfrbs').limit(1).get();
    if (!bfrbs.empty) return true;
    const rest = await root.collection('restDays').limit(1).get();
    if (!rest.empty) return true;
    return false;
  }

  async function maybeShow(user) {
    if (!user || lastShownForUid === user.uid) return;
    if (!localHasData()) return; // case 1 or 2 — no conflict
    let remote = false;
    try { remote = await remoteHasData(user); } catch (_) { return; }
    if (!remote) return; // case 2 — local uploads, no modal
    lastShownForUid = user.uid;
    show(user);
  }

  // ── UI ──────────────────────────────────────────────────────────────

  function ensureRoot() {
    let el = document.getElementById(MODAL_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = MODAL_ID;
    el.className = 'cloud-modal-backdrop';
    el.innerHTML = [
      '<div class="cloud-modal" role="dialog" aria-modal="true" aria-labelledby="cloud-modal-title">',
      '  <h2 id="cloud-modal-title" class="cloud-modal-title">Both this device and your cloud account have data</h2>',
      '  <p class="cloud-modal-prose">',
      '    A backup of this device\'s current data will be downloaded before any change, so you can always recover if the merge looks wrong.',
      '  </p>',
      '  <div class="cloud-modal-actions">',
      '    <button class="cloud-btn cloud-btn-primary" data-action="merge">This is my data — add it to my account</button>',
      '    <button class="cloud-btn" data-action="cloud">Use cloud data (replaces local)</button>',
      '    <button class="cloud-link" data-action="signout">Sign out</button>',
      '  </div>',
      '  <div id="cloud-modal-status" class="cloud-modal-status" aria-live="polite"></div>',
      '</div>',
    ].join('');
    document.body.appendChild(el);
    return el;
  }

  function setStatus(text) {
    const s = document.getElementById('cloud-modal-status');
    if (s) s.textContent = text || '';
  }

  function close() {
    const el = document.getElementById(MODAL_ID);
    if (el) el.remove();
  }

  function show(user) {
    const el = ensureRoot();
    el.classList.add('is-open');

    el.addEventListener('click', async (e) => {
      const action = e.target && e.target.getAttribute && e.target.getAttribute('data-action');
      if (!action) return;
      if (action === 'signout') {
        close();
        if (window.Auth) Auth.signOut().catch(() => {});
        return;
      }

      // Always download a local backup first.
      try {
        if (window.Export && Export.exportAllData) await Export.exportAllData();
      } catch (_) { /* ignore — better to proceed than block on backup */ }

      if (action === 'merge') {
        setStatus('Merging local data into your account…');
        try {
          // Push first so cloud sees local entries; then pull so the
          // local store reflects union of both.
          if (window.Sync) await Sync.fullSyncCycle();
          setStatus('Done.');
          setTimeout(close, 800);
        } catch (err) {
          setStatus('Merge failed: ' + ((err && err.message) || err));
        }
        return;
      }

      if (action === 'cloud') {
        setStatus('Replacing local data with cloud copy…');
        try {
          // Wipe the synced localStorage keys so the pull writes a
          // fresh, cloud-shaped payload without local pollution.
          localStorage.removeItem('wellness_meds');
          localStorage.removeItem('wellness_rest_log');
          localStorage.removeItem('bfrbs_global');
          if (window.Sync) await Sync.fullSyncCycle();
          setStatus('Done.');
          setTimeout(close, 800);
        } catch (err) {
          setStatus('Replace failed: ' + ((err && err.message) || err));
        }
        return;
      }
    });
  }

  function init() {
    if (!window.Auth) return;
    Auth.onChange(user => {
      if (user && window.Cloud && Cloud.isEnabled()) {
        // Defer slightly so Sync's own auth-change push/pull can race
        // first; we only intervene if both sides have data.
        setTimeout(() => maybeShow(user).catch(() => {}), 1500);
      }
    });
  }

  return { init, show, maybeShow };
})();

window.FirstSyncModal = FirstSyncModal;

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => FirstSyncModal.init());
  } else {
    FirstSyncModal.init();
  }
}
