// Sync engine for `bfrbs_global` (global BFRB catch log).
//
// Append-merge by clientUuid. Each catch is stored at:
//   /users/{uid}/bfrbs/{eventId}
// where eventId is generated at log time so two devices logging within
// the same millisecond get distinct ids.
//
// The session-scoped stores (flow_bfrbs, pomodoro_bfrbs) are NOT synced
// — those are in-flight state of an active focus session and would
// corrupt the other device's session if cloned. They're archived into
// the session-history record on session end (Phase 3 territory).

(function attachBfrbSync() {
  const KEY = 'bfrbs_global';
  const SCHEMA_VERSION = 1;

  function db() { return window.Cloud && Cloud.getDb(); }

  function readLocal() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(raw) ? raw : [];
    } catch (_) { return []; }
  }

  function writeLocal(items) {
    try {
      Sync.withApplyingRemote(() => {
        localStorage.setItem(KEY, JSON.stringify(items));
      });
    } catch (_) {}
    try { document.dispatchEvent(new CustomEvent('cloud:bfrb-applied')); } catch (_) {}
  }

  // Stable id for an existing local entry — prefer eventId (newly added
  // by the sync layer for outgoing entries), then fall back to a hash
  // built from timestamp + phase. Old entries that predate the sync layer
  // get a stable derived id so they're idempotent across pushes.
  function idForEntry(entry) {
    if (!entry) return null;
    if (typeof entry.eventId === 'string' && entry.eventId) return entry.eventId;
    if (typeof entry.timestamp !== 'number') return null;
    // Derive a deterministic-ish id so re-pushing the same legacy entry
    // doesn't create duplicates server-side.
    const phase = entry.phase ? '-' + entry.phase : '';
    const cycle = (entry.cycleIndex != null) ? ('-' + entry.cycleIndex) : '';
    return 'legacy_' + entry.timestamp.toString(36) + phase + cycle;
  }

  function ensureEventIds(items) {
    let dirty = false;
    items.forEach(e => {
      if (e && typeof e.eventId !== 'string') {
        e.eventId = idForEntry(e) || ('e_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8));
        dirty = true;
      }
    });
    return dirty;
  }

  // ── Push ────────────────────────────────────────────────────────────

  async function push(user) {
    const d = db();
    if (!d) return;
    const items = readLocal();
    const dirty = ensureEventIds(items);
    if (dirty) writeLocal(items);
    const col = d.collection('users').doc(user.uid).collection('bfrbs');
    for (const entry of items) {
      const id = idForEntry(entry);
      if (!id) continue;
      const doc = window.Sync.stampDoc({
        schemaVersion: SCHEMA_VERSION,
        eventId: id,
        timestamp: entry.timestamp,
        phase: entry.phase || null,
        cycleIndex: typeof entry.cycleIndex === 'number' ? entry.cycleIndex : null,
        deletedAt: null,
      });
      await col.doc(id).set(doc, { merge: true });
    }
  }

  // ── Pull ────────────────────────────────────────────────────────────

  async function pull(user) {
    const d = db();
    if (!d) return;
    const col = d.collection('users').doc(user.uid).collection('bfrbs');
    const snap = await col.get();
    if (snap.empty && readLocal().length === 0) return;

    const localById = new Map();
    const local = readLocal();
    local.forEach(e => {
      const id = idForEntry(e);
      if (id) localById.set(id, e);
    });

    snap.forEach(doc => {
      const r = doc.data();
      if (!r || r.deletedAt) return;
      if (typeof r.timestamp !== 'number') return;
      const id = r.eventId || doc.id;
      if (!localById.has(id)) {
        localById.set(id, {
          eventId: id,
          timestamp: r.timestamp,
          phase: r.phase || undefined,
          cycleIndex: typeof r.cycleIndex === 'number' ? r.cycleIndex : undefined,
        });
      }
    });

    const merged = Array.from(localById.values())
      .filter(e => e && typeof e.timestamp === 'number')
      .sort((a, b) => a.timestamp - b.timestamp);
    writeLocal(merged);
  }

  if (!window.Sync) return;
  Sync.register({ key: KEY, push, pull });
})();
