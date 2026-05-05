// Sync engine for SHOULD-sync scalar preferences.
//
// Scope (Phase 1):
//   theme, sound_muted, sound_profile, bfrb_volume, vibrate_interval,
//   lap_display_mode, display_mode, pomo_auto_advance, app_mode
//
// All eight live as fields on a single Firestore doc:
//
//   /users/{uid}/prefs/main
//
// Per-field LWW: each pref carries its own clientUpdatedAt_<field>
// timestamp so two devices editing different prefs don't clobber each
// other (e.g. set theme on laptop while iOS only adjusts bfrb_volume).
//
// The MutationObserver-style hook is just `Sync.notifyLocalChange('<key>')`
// invoked from the SHOULD-sync write paths. Each call updates that one
// field on the prefs doc using `set({merge: true})` — no full-doc reads.

(function attachPrefsSync() {
  const PREF_KEYS = [
    'theme',
    'sound_muted',
    'sound_profile',
    'bfrb_volume',
    'vibrate_interval',
    'lap_display_mode',
    'display_mode',
    'pomo_auto_advance',
    'app_mode',
  ];

  // Inverted index — used by sync-registry to know whether an arbitrary
  // localStorage key is owned by the prefs handler.
  const PREF_KEY_SET = new Set(PREF_KEYS);

  function prefsRef(user) {
    const db = window.Cloud && Cloud.getDb();
    if (!db) return null;
    return db.collection('users').doc(user.uid).collection('prefs').doc('main');
  }

  // Build the partial doc to push for one specific field. We always use
  // set({merge:true}) so concurrent edits to *other* fields don't get
  // clobbered.
  function buildFieldPatch(key) {
    const value = localStorage.getItem(key);
    const stamp = (window.Cloud && Cloud.nowSkewed) ? Cloud.nowSkewed() : Date.now();
    const fb = window.firebase;
    const patch = {
      schemaVersion: 1,
      clientId: window.Cloud ? Cloud.getClientId() : 'unknown',
    };
    patch[key] = value;
    patch['clientUpdatedAt_' + key] = stamp;
    patch.clientUpdatedAt = stamp; // doc-level last-touched (used as cursor)
    if (fb && fb.firestore && fb.firestore.FieldValue) {
      patch.updatedAt = fb.firestore.FieldValue.serverTimestamp();
    }
    return patch;
  }

  // Push: write the changed field to Firestore. evt.payload may carry
  // the specific field name; fall back to syncing all known prefs if
  // someone calls notifyLocalChange('prefs') with no payload (full sync).
  async function push(user, evt) {
    const ref = prefsRef(user);
    if (!ref) return;
    const key = (evt && (evt.payload || evt.key)) || null;
    // Only one specific known pref → one targeted write.
    if (typeof key === 'string' && PREF_KEY_SET.has(key)) {
      await ref.set(buildFieldPatch(key), { merge: true });
      return;
    }
    // Fallback: push every known pref in a single merge. Used by the
    // full-sync cycle right after sign-in.
    const fb = window.firebase;
    const stamp = (window.Cloud && Cloud.nowSkewed) ? Cloud.nowSkewed() : Date.now();
    const merged = {
      schemaVersion: 1,
      clientId: window.Cloud ? Cloud.getClientId() : 'unknown',
      clientUpdatedAt: stamp,
    };
    PREF_KEYS.forEach(k => {
      const v = localStorage.getItem(k);
      if (v !== null) {
        merged[k] = v;
        merged['clientUpdatedAt_' + k] = stamp;
      }
    });
    if (fb && fb.firestore && fb.firestore.FieldValue) {
      merged.updatedAt = fb.firestore.FieldValue.serverTimestamp();
    }
    await ref.set(merged, { merge: true });
  }

  // Pull: read the prefs doc, compare each remote field's
  // clientUpdatedAt_<field> against the local equivalent we last
  // applied. Newer remote wins.
  async function pull(user) {
    const ref = prefsRef(user);
    if (!ref) return;
    const snap = await ref.get();
    if (!snap.exists) return;
    const data = snap.data() || {};
    let appliedCount = 0;
    Sync.withApplyingRemote(() => {
      PREF_KEYS.forEach(key => {
        if (!Object.prototype.hasOwnProperty.call(data, key)) return;
        const remoteStamp = Number(data['clientUpdatedAt_' + key]) || 0;
        const localStampKey = 'cloud_local_stamp__' + key;
        const localStamp = Number(localStorage.getItem(localStampKey)) || 0;
        if (remoteStamp <= localStamp) return; // already applied or older
        const remoteValue = data[key];
        // Defensive: localStorage stores strings; coerce non-strings.
        const valueStr = (remoteValue == null) ? null : String(remoteValue);
        if (valueStr === null) {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(key, valueStr);
        }
        localStorage.setItem(localStampKey, String(remoteStamp));
        appliedCount++;
      });
    });
    if (appliedCount > 0) {
      // Best-effort: re-apply visual prefs without forcing a reload.
      // The user's UI still shows the old theme until they navigate
      // otherwise — we trigger a re-apply for the obvious ones.
      try { window.Themes && Themes.apply(localStorage.getItem('theme') || 'auto'); } catch (_) {}
      // Notify any general listeners so other modules can refresh.
      try {
        document.dispatchEvent(new CustomEvent('cloud:prefs-applied', { detail: { count: appliedCount } }));
      } catch (_) {}
    }
  }

  // Register one handler per pref key — that way notifyLocalChange('theme')
  // routes to this push() with key='theme', matching how meds.js / etc.
  // fire individual writes after their localStorage.setItem call.
  if (!window.Sync) return; // sync-registry must already be loaded
  PREF_KEYS.forEach(key => {
    Sync.register({
      key,
      push: (user, evt) => push(user, { key, payload: key, ...(evt || {}) }),
      pull,
    });
  });
})();
