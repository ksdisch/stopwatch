// Sync engine for `wellness_rest_log` (sleep + naps by day).
//
// Firestore layout:
//   /users/{uid}/restDays/{YYYY-MM-DD}             ← day doc, sleep field
//   /users/{uid}/restDays/{YYYY-MM-DD}/naps/{napId} ← append-only naps
//
// Sleep is a single mutable scalar per day → per-day LWW with merge:true
// writes (so naps subcollection isn't clobbered).
// Naps are append-only → set-union by `napId = startedAt.toString(36)`.

(function attachRestSync() {
  const KEY = 'wellness_rest_log';
  const SCHEMA_VERSION = 1;

  function db() { return window.Cloud && Cloud.getDb(); }

  function readLocal() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    } catch (_) { return {}; }
  }

  function writeLocal(log) {
    try {
      Sync.withApplyingRemote(() => {
        localStorage.setItem(KEY, JSON.stringify(log));
      });
    } catch (_) {}
    try { document.dispatchEvent(new CustomEvent('cloud:rest-applied')); } catch (_) {}
  }

  function napKey(nap) {
    if (!nap || typeof nap.startedAt !== 'number') return null;
    return Math.round(nap.startedAt).toString(36);
  }

  // ── Push ────────────────────────────────────────────────────────────

  async function push(user) {
    const d = db();
    if (!d) return;
    const log = readLocal();
    const root = d.collection('users').doc(user.uid).collection('restDays');
    for (const dateStr of Object.keys(log)) {
      const day = log[dateStr] || {};
      const ref = root.doc(dateStr);
      // Sleep + meta on the day doc — merge:true preserves naps subcollection.
      const dayDoc = window.Sync.stampDoc({
        schemaVersion: SCHEMA_VERSION,
        date: dateStr,
        sleep: day.sleep || null,
        deletedAt: null,
      });
      await ref.set(dayDoc, { merge: true });

      if (Array.isArray(day.naps)) {
        for (const nap of day.naps) {
          const k = napKey(nap);
          if (!k) continue;
          const napDoc = window.Sync.stampDoc({
            schemaVersion: SCHEMA_VERSION,
            startedAt: nap.startedAt,
            durationMs: typeof nap.durationMs === 'number' ? nap.durationMs : 0,
            endedEarly: !!nap.endedEarly,
            deletedAt: null,
          });
          await ref.collection('naps').doc(k).set(napDoc, { merge: true });
        }
      }
    }
  }

  // ── Pull ────────────────────────────────────────────────────────────

  async function pull(user) {
    const d = db();
    if (!d) return;
    const root = d.collection('users').doc(user.uid).collection('restDays');
    const snap = await root.get();
    if (snap.empty && Object.keys(readLocal()).length === 0) return;

    const local = readLocal();
    const out = {}; // dateStr -> day entry

    // Seed with locally-known days so naps logged offline aren't lost.
    Object.keys(local).forEach(dateStr => {
      const d0 = local[dateStr] || {};
      out[dateStr] = {
        sleep: d0.sleep || null,
        naps: Array.isArray(d0.naps) ? d0.naps.slice() : [],
        _cloudStamp: 0,
      };
    });

    for (const dayDoc of snap.docs) {
      const data = dayDoc.data();
      if (!data) continue;
      const dateStr = data.date || dayDoc.id;
      const cur = out[dateStr] || { sleep: null, naps: [], _cloudStamp: 0 };

      // LWW for sleep field.
      const remoteStamp = Number(data.clientUpdatedAt) || 0;
      if (remoteStamp > (cur._cloudStamp || 0)) {
        cur.sleep = data.sleep || null;
        cur._cloudStamp = remoteStamp;
      }

      // Naps subcollection: union by key.
      const napsSnap = await dayDoc.ref.collection('naps').get();
      const napMap = new Map();
      cur.naps.forEach(n => {
        const k = napKey(n);
        if (k) napMap.set(k, n);
      });
      napsSnap.forEach(nd => {
        const r = nd.data();
        if (!r || r.deletedAt) return;
        const k = napKey(r);
        if (!k) return;
        if (!napMap.has(k)) {
          napMap.set(k, {
            startedAt: r.startedAt,
            durationMs: typeof r.durationMs === 'number' ? r.durationMs : 0,
            endedEarly: !!r.endedEarly,
          });
        }
      });
      cur.naps = Array.from(napMap.values()).sort((a, b) => a.startedAt - b.startedAt);

      out[dateStr] = cur;
    }

    // Strip the internal _cloudStamp before writing — it's an in-memory
    // bookkeeping field, not part of the public log shape.
    const cleaned = {};
    Object.keys(out).forEach(k => {
      const day = out[k];
      cleaned[k] = { sleep: day.sleep || null, naps: day.naps || [] };
    });
    writeLocal(cleaned);
  }

  if (!window.Sync) return;
  Sync.register({ key: KEY, push, pull });
})();
