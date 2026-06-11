// Life-OS Phase 3: Mood — the mood/affect capture stream owner.
//
// `mood_events` is the 7th synced store (ADR-0008) and the first store that
// is client-WRITTEN and council-READ: the Chickens synthesizer reads it
// server-side via the Admin SDK, so device-local capture was never an option.
// Clones the BfrbEvents module shape (js/bfrb-events.js) MINUS the migration
// machinery — mood starts fresh, there are no legacy keys to consolidate.
//
// Record shape (append-only, immutable — ADR-0008):
//   { at: epochMs, valence: 1..5, tags?: string[] (≤3), note?: string (≤280),
//     context?: 'global'|'flow'|'pomodoro', deviceId, updatedAt, schemaVersion }
// Reserved additive-nullable field: `energy?: 1..5` — accepted when a caller
// provides a valid value (forward-compat with the 2-axis capture upgrade),
// but NEVER set by this module or the v1 capture UI.
//
// Public API:
//   Mood.log({ valence, tags?, note?, context?, at?, energy? })
//     → builds a new entry, stamps deviceId + updatedAt + schemaVersion,
//        gates through SyncState.canWrite() (F13), persists, returns the
//        entry. Returns null when valence is missing/out-of-range or a gate
//        refuses the write. `at` overrides the capture timestamp (the
//        deferred-commit flow in js/mood-ui.js stamps the capture moment
//        rather than the later commit moment — the optional fields MUST ride
//        this single write: sync-merge-mood keeps the CLOUD copy on a
//        (deviceId, at) collision, so a post-hoc patch is silently dropped).
//   Mood.getAll() → defensive-copy of all entries.
//   Mood.snapshotForSync() → wire envelope
//        { deviceId, schemaVersion, payload: { events: [...] } }.
//   Mood._reconcileWriteRaw(events) → D-1 raw-write hook (writes verbatim,
//        no stamping; parity with BfrbEvents._reconcileWriteRaw).
//
// F-invariants honored:
//   F10 stamping — every log() stamps deviceId + updatedAt + schemaVersion
//       via Schema.stamp() / module helpers.
//   F13 write gate — log() consults SyncState.canWrite() (when SyncFlag
//       is enabled).
//   F19a — log() defensive-skips if the candidate entry is a future
//       record (should never happen since stamp() is the only write path,
//       but belt-and-suspenders — matches the BfrbEvents precedent).

const Mood = (() => {
  const STORAGE_KEY = 'mood_events';

  // Capture-UX caps (mirrored by js/mood-ui.js). Tag strings reuse the
  // 40-char cap from BfrbEvents.triggerZone; the note cap is the ADR-0008
  // contract value.
  const MAX_TAGS = 3;
  const MAX_TAG_LEN = 40;
  const MAX_NOTE_LEN = 280;

  // F10: lazy deviceId helper. Mirrors `_bfrbGetDeviceId`
  // (js/bfrb-events.js:65) — reads or creates the shared `tempo_device_id`
  // localStorage key so this module can stamp records without depending on
  // other modules' load order.
  function _moodGetDeviceId() {
    let id = null;
    try { id = localStorage.getItem('tempo_device_id'); } catch (e) {}
    if (!id) {
      id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : 'd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11);
      try { localStorage.setItem('tempo_device_id', id); } catch (e) {}
    }
    return id;
  }

  // ── Storage primitives ────────────────────────────────────────────────

  function _readStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function _writeStore(entries) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (e) {
      // quota / unavailable — surface to a once-per-call warning. Engine
      // can't recover; caller observes via subsequent getAll() drift.
      try { console.warn('[Mood] write failed: ' + (e && e.message)); }
      catch (_) {}
    }
  }

  // ── Stamping ──────────────────────────────────────────────────────────

  // Stamp an entry with deviceId / updatedAt / schemaVersion. Uses
  // Schema.stamp() when available (sets schemaVersion only); the
  // deviceId/updatedAt fields are managed locally to match the meds/bfrb
  // pattern (Schema.stamp does NOT touch them in js/schema.js).
  function _stampEntry(entry) {
    if (!entry || typeof entry !== 'object') return entry;
    entry.deviceId = _moodGetDeviceId();
    entry.updatedAt = Date.now();
    if (typeof Schema !== 'undefined' && typeof Schema.stamp === 'function') {
      Schema.stamp(entry);
    }
    return entry;
  }

  // ── Public API ────────────────────────────────────────────────────────

  function log(opts) {
    opts = opts || {};

    // valence is THE required field: integer 1..5. A roundable float is
    // accepted (matches the urgeLevel precedent); anything outside the
    // range refuses the whole log — there is no meaningful mood event
    // without a valence.
    if (typeof opts.valence !== 'number' || !isFinite(opts.valence)) {
      try { console.warn('[Mood] log refused: missing/invalid valence'); } catch (_) {}
      return null;
    }
    const valence = Math.round(opts.valence);
    if (valence < 1 || valence > 5) {
      try { console.warn('[Mood] log refused: valence out of range (' + opts.valence + ')'); } catch (_) {}
      return null;
    }

    const context = (opts.context === 'flow' || opts.context === 'pomodoro') ? opts.context : 'global';

    // `at` is captured ONCE so the (deviceId, at) dedup signature is stable
    // across the stamp() call. An explicit `opts.at` override lets the
    // deferred-commit flow (js/mood-ui.js) stamp the capture moment rather
    // than the later commit moment.
    const entry = {
      at: (typeof opts.at === 'number' && isFinite(opts.at)) ? opts.at : Date.now(),
      valence: valence,
      context: context,
    };

    // tags: optional, ≤3 trimmed non-empty strings, each length-capped.
    // Invalid members are dropped; the field is omitted entirely when no
    // valid tag survives, so a tag-less log is byte-identical to the
    // minimal shape.
    if (Array.isArray(opts.tags)) {
      const tags = [];
      for (const t of opts.tags) {
        if (typeof t !== 'string') continue;
        const trimmed = t.trim().slice(0, MAX_TAG_LEN);
        if (trimmed === '') continue;
        tags.push(trimmed);
        if (tags.length >= MAX_TAGS) break;
      }
      if (tags.length > 0) entry.tags = tags;
    }

    // note: optional, trimmed, ≤280 chars; omitted when empty.
    if (typeof opts.note === 'string') {
      const note = opts.note.trim().slice(0, MAX_NOTE_LEN);
      if (note !== '') entry.note = note;
    }

    // energy: RESERVED (ADR-0008 additive-nullable). Accepted when valid so
    // a future 2-axis capture lands without migration; never set by v1.
    if (typeof opts.energy === 'number' && isFinite(opts.energy)) {
      const en = Math.round(opts.energy);
      if (en >= 1 && en <= 5) entry.energy = en;
    }

    _stampEntry(entry);

    // F19a defensive: refuse to persist a future-schema record. Should be
    // unreachable since _stampEntry assigns SCHEMA_VERSION, but the gate
    // matches the BfrbEvents per-method invariant.
    if (typeof Schema !== 'undefined' && typeof Schema.isFutureRecord === 'function'
        && Schema.isFutureRecord(entry)) {
      try { console.warn('[Mood] log refused future-schema entry'); } catch (_) {}
      return null;
    }

    // F13 write gate: when sync is enabled, defer to SyncState.canWrite().
    // The `typeof` guards keep this usable in test contexts that don't
    // load sync-flag.js / sync-engine.js (matches bfrb-events.js pattern).
    if (typeof SyncFlag !== 'undefined' && typeof SyncFlag.isEnabled === 'function'
        && SyncFlag.isEnabled()
        && typeof SyncState !== 'undefined' && typeof SyncState.canWrite === 'function'
        && !SyncState.canWrite()) {
      try { console.warn('[Mood] log blocked by SyncState gate'); } catch (_) {}
      return null;
    }

    const entries = _readStore();
    entries.push(entry);
    _writeStore(entries);
    return entry;
  }

  function getAll() {
    // Defensive copy — _readStore already returns a fresh array from
    // JSON.parse, but the explicit slice() makes the contract obvious.
    return _readStore().slice();
  }

  function snapshotForSync() {
    const deviceId = _moodGetDeviceId();
    const schemaVersion = (typeof Schema !== 'undefined' && typeof Schema.SCHEMA_VERSION === 'number')
      ? Schema.SCHEMA_VERSION
      : 1;
    return {
      deviceId: deviceId,
      schemaVersion: schemaVersion,
      payload: {
        events: getAll(),
      },
    };
  }

  // D-1 parity hook. Writes events verbatim — no stamping, no filter,
  // no SyncState gate. Mirrors BfrbEvents._reconcileWriteRaw's contract
  // (the caller has already computed the merged cloud ∪ local snapshot
  // under a 'hydrating' gate).
  function _reconcileWriteRaw(events) {
    if (!Array.isArray(events)) events = [];
    _writeStore(events);
  }

  return {
    log,
    getAll,
    snapshotForSync,
    _reconcileWriteRaw,
    // Constant exposed for tests.
    STORAGE_KEY,
  };
})();

if (typeof window !== 'undefined') {
  window.Mood = Mood;
}
