// Cloud sync UI — the Settings drawer panel.
//
// Renders a small "Cloud sync" section into the existing Tempo settings
// drawer (#tempo-settings-drawer in index.html). Three states:
//   1. Cloud sync disabled — single "Enable cloud sync" toggle.
//   2. Enabled, signed out — Sign in with Apple + Sign in with Google.
//   3. Enabled, signed in   — show email + Sign out + sync status line.
//
// Hard-fails gracefully: if Firebase isn't loaded or the config is still
// the placeholder, the panel renders a small "Not configured" badge with
// a pointer to firebase-config.js. The rest of the app keeps working.

const CloudUI = (() => {
  let mounted = false;

  function buildPanel() {
    const el = document.createElement('div');
    el.className = 'tempo-settings-item tempo-cloud-panel';
    el.id = 'cloud-sync-panel';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'Cloud sync');
    el.innerHTML = [
      '<div class="cloud-panel-header">',
      '  <span class="cloud-panel-title">Cloud sync</span>',
      '  <span class="cloud-panel-status" id="cloud-status-text">…</span>',
      '</div>',
      '<div class="cloud-panel-body" id="cloud-panel-body"></div>',
    ].join('');
    return el;
  }

  function ensureMounted() {
    if (mounted) return;
    const drawer = document.getElementById('tempo-settings-drawer');
    if (!drawer) return;
    drawer.appendChild(buildPanel());
    mounted = true;
    render();
  }

  function setBody(html) {
    const body = document.getElementById('cloud-panel-body');
    if (body) body.innerHTML = html;
  }

  function setStatus(text) {
    const el = document.getElementById('cloud-status-text');
    if (el) el.textContent = text;
  }

  function ago(ts) {
    if (!ts) return '';
    const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (sec < 5) return 'just now';
    if (sec < 60) return sec + 's ago';
    const min = Math.round(sec / 60);
    if (min < 60) return min + 'm ago';
    const hr = Math.round(min / 60);
    if (hr < 24) return hr + 'h ago';
    return new Date(ts).toLocaleDateString();
  }

  function render() {
    if (!mounted) return;

    // Cloud SDK availability check.
    if (!window.Cloud || !window.Auth) {
      setStatus('Unavailable');
      setBody('<div class="cloud-empty">Cloud modules failed to load. Check the Firebase script tags in index.html.</div>');
      return;
    }
    Cloud.init();
    const cloudStatus = Cloud.getStatus();
    if (cloudStatus.error === 'firebase-config-not-set') {
      setStatus('Not configured');
      setBody('<div class="cloud-empty">Edit <code>firebase-config.js</code> with values from your Firebase project, then reload.</div>');
      return;
    }
    if (cloudStatus.error === 'firebase-sdk-not-loaded') {
      setStatus('SDK missing');
      setBody('<div class="cloud-empty">Firebase scripts didn\'t load. Check your network connection or the SDK URLs.</div>');
      return;
    }

    // Disabled (feature flag off) — show enable toggle.
    if (!cloudStatus.enabled) {
      setStatus('Off');
      setBody([
        '<div class="cloud-row cloud-row-prose">',
        '  Sync your medications, BFRB log, sleep tracking, and preferences across phone and laptop.',
        '</div>',
        '<button id="cloud-enable-btn" class="cloud-btn cloud-btn-primary" type="button">Enable cloud sync</button>',
      ].join(''));
      const btn = document.getElementById('cloud-enable-btn');
      if (btn) btn.addEventListener('click', () => {
        Cloud.setEnabled(true);
        if (window.Sync) Sync.init();
        render();
      });
      return;
    }

    // Enabled, signed-in?
    const user = Auth.getCurrentUser();
    if (!user) {
      setStatus('Signed out');
      setBody([
        '<div class="cloud-row">',
        '  <button id="cloud-signin-apple" class="cloud-btn cloud-btn-apple" type="button">',
        '     <span aria-hidden="true">&#xF8FF;</span> Sign in with Apple',
        '  </button>',
        '</div>',
        '<div class="cloud-row">',
        '  <button id="cloud-signin-google" class="cloud-btn cloud-btn-google" type="button">',
        '     <span aria-hidden="true">G</span> Sign in with Google',
        '  </button>',
        '</div>',
        '<div class="cloud-row cloud-row-meta">',
        '  <button id="cloud-disable-btn" class="cloud-link" type="button">Disable cloud sync</button>',
        '</div>',
      ].join(''));
      bindSignIn();
      return;
    }

    // Signed in — show identity + status.
    const sync = window.Sync ? Sync.getStatus() : { syncing: false, pendingCount: 0, lastSyncedAt: null };
    const email = user.email || user.displayName || '(signed in)';
    const statusLine = sync.syncing
      ? 'Syncing…'
      : (sync.pendingCount > 0)
        ? ('Pending: ' + sync.pendingCount)
        : (sync.lastSyncedAt ? ('Synced ' + ago(sync.lastSyncedAt)) : 'Ready');
    setStatus(statusLine);
    setBody([
      '<div class="cloud-row cloud-row-identity">',
      '  <span class="cloud-identity-icon" aria-hidden="true">&#x2601;</span>',
      '  <span class="cloud-identity-email"></span>', // text injected below to avoid HTML injection
      '</div>',
      '<div class="cloud-row cloud-row-meta">',
      '  <button id="cloud-sync-now" class="cloud-link" type="button">Sync now</button>',
      '  <button id="cloud-signout" class="cloud-link" type="button">Sign out</button>',
      '</div>',
      '<div class="cloud-row cloud-row-meta">',
      '  <button id="cloud-disable-btn" class="cloud-link" type="button">Disable cloud sync</button>',
      '</div>',
    ].join(''));
    const emailEl = document.querySelector('#cloud-panel-body .cloud-identity-email');
    if (emailEl) emailEl.textContent = email;

    const syncBtn = document.getElementById('cloud-sync-now');
    if (syncBtn) syncBtn.addEventListener('click', () => {
      if (window.Sync) Sync.fullSyncCycle().catch(() => {});
    });
    const outBtn = document.getElementById('cloud-signout');
    if (outBtn) outBtn.addEventListener('click', () => {
      Auth.signOut().catch(() => {});
    });
    const disableBtn = document.getElementById('cloud-disable-btn');
    if (disableBtn) disableBtn.addEventListener('click', () => {
      Cloud.setEnabled(false);
      Auth.signOut().catch(() => {});
      render();
    });
  }

  function bindSignIn() {
    const a = document.getElementById('cloud-signin-apple');
    if (a) a.addEventListener('click', () => {
      a.disabled = true;
      Auth.signInApple().catch(() => {/* swallow; render() reflects state */}).finally(() => {
        a.disabled = false;
        render();
      });
    });
    const g = document.getElementById('cloud-signin-google');
    if (g) g.addEventListener('click', () => {
      g.disabled = true;
      Auth.signInGoogle().catch(() => {}).finally(() => {
        g.disabled = false;
        render();
      });
    });
    const disableBtn = document.getElementById('cloud-disable-btn');
    if (disableBtn) disableBtn.addEventListener('click', () => {
      Cloud.setEnabled(false);
      render();
    });
  }

  function init() {
    ensureMounted();
    if (window.Auth) Auth.onChange(() => render());
    if (window.Sync) Sync.onStatus(() => render());
    // Cheap clock so "Synced 2s ago" stays accurate without burning RAF.
    setInterval(() => {
      const txt = document.getElementById('cloud-status-text');
      if (txt && document.body.contains(txt)) render();
    }, 30000);
  }

  return { init, render };
})();

window.CloudUI = CloudUI;

// Auto-init on DOMContentLoaded; safe to be a no-op if the drawer isn't
// in the DOM yet (e.g. early test environments without index.html).
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => CloudUI.init());
  } else {
    CloudUI.init();
  }
}
