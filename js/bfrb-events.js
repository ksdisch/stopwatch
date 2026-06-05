// E-1d-f3: BfrbEvents — consolidated BFRB stream owner.
//
// F3 (BFRB stream consolidation): merges the three legacy localStorage
// keys (`bfrbs_global` / `flow_bfrbs` / `pomodoro_bfrbs`) into a single
// tagged stream `bfrb_events` with `context: 'global' | 'flow' | 'pomodoro'`
// (and flat optional sub-fields `sessionId?` / `phase?` / `cycleIndex?`).
//
// One-way phased migration (Pick B on E-1d-f3 TODO #1): unions the 3
// legacy keys → writes `bfrb_events` → sets idempotency marker
// `tempo_bfrb_events_migration_v1='1'`. Legacy keys are NOT deleted
// (cleanup PR deferred per Pick C on TODO #5). The marker is the
// idempotency contract — subsequent boots check it and skip the union.
// Defensive dedup by `(deviceId, takenAt)` in the union step guarantees
// that a re-run (e.g. marker write failed) produces byte-identical
// output.
//
// Public API (matches the auditor's affected-files table):
//   BfrbEvents.log({ context, sessionId?, phase?, cycleIndex?,
//                    urgeLevel?, triggerZone?, takenAt? })
//     → builds a new entry { takenAt, context, ..., deviceId, updatedAt,
//        schemaVersion }, gates through SyncState.canWrite() (F13),
//        persists, returns the entry. `urgeLevel` (1..3) + `triggerZone`
//        (short string) are the E-1g additive-nullable antecedent fields;
//        `takenAt` overrides the catch timestamp (deferred-capture flow).
//   BfrbEvents.getAll() → defensive-copy of all entries.
//   BfrbEvents.getByContext(ctx) → filtered slice (by entry.context).
//   BfrbEvents.countToday(ctx?) → entries with localDateKey(takenAt) ===
//        today; optionally filtered by context.
//   BfrbEvents.snapshotForSync() → wire envelope
//        { deviceId, schemaVersion, payload: { events: [...] } }.
//   BfrbEvents._reconcileWriteRaw(events) → D-1 raw-write hook
//        (writes verbatim, no stamping; parity with
//        MedsManager._hydrateWriteRaw).
//   BfrbEvents._runMigration() → exposed for tests; idempotent.
//
// F-invariants honored:
//   F10 stamping — every log() stamps deviceId + updatedAt + schemaVersion
//       via Schema.stamp() / module helpers. Migration-injected entries
//       inherit the local deviceId (legacy entries were minted on this
//       device by definition).
//   F13 write gate — log() consults SyncState.canWrite() (when SyncFlag
//       is enabled).
//   F19a — log() defensive-skips if the candidate entry is a future
//       record (should never happen since stamp() is the only write path,
//       but belt-and-suspenders).
//
// Marker naming: `tempo_bfrb_events_migration_v1` — explicit `_v1` suffix
// reserves namespace for hypothetical future migrations (Risk #6).

const BfrbEvents = (() => {
  const STORAGE_KEY = 'bfrb_events';
  const MIGRATION_MARKER_KEY = 'tempo_bfrb_events_migration_v1';
  const LEGACY_KEYS = ['bfrbs_global', 'flow_bfrbs', 'pomodoro_bfrbs'];
  // Map legacy key → context tag for the consolidated stream.
  const LEGACY_KEY_TO_CONTEXT = {
    'bfrbs_global': 'global',
    'flow_bfrbs': 'flow',
    'pomodoro_bfrbs': 'pomodoro',
  };

  // F10: lazy deviceId helper. Mirrors `_medsGetDeviceId` (js/meds.js:60)
  // and `History.getDeviceId` — reads or creates the shared
  // `tempo_device_id` localStorage key so this module can stamp records
  // without depending on those modules' load order.
  function _bfrbGetDeviceId() {
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

  // Local-date key (YYYY-MM-DD in user's local timezone). Matches the
  // identical helper in js/global-bfrb.js (lines 69-74) so countToday()
  // produces byte-equivalent output to the legacy `countForLabel` filter.
  function _localDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
  }

  // Signature for dedup: (deviceId, takenAt). Matches the meds doseLog
  // dedup convention in `_sigOf` (js/sync-merge-meds.js:43).
  function _sigOf(entry) {
    if (!entry || typeof entry.takenAt !== 'number') return null;
    const dev = (typeof entry.deviceId === 'string') ? entry.deviceId : '∅';
    return dev + '@' + entry.takenAt;
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
      try { console.warn('[BfrbEvents] write failed: ' + (e && e.message)); }
      catch (_) {}
    }
  }

  // ── Stamping ──────────────────────────────────────────────────────────

  // Stamp an entry with deviceId / updatedAt / schemaVersion. Uses
  // Schema.stamp() when available (sets schemaVersion only); the
  // deviceId/updatedAt fields are managed locally to match the meds
  // pattern (Schema.stamp does NOT touch them in js/schema.js).
  function _stampEntry(entry) {
    if (!entry || typeof entry !== 'object') return entry;
    entry.deviceId = _bfrbGetDeviceId();
    entry.updatedAt = Date.now();
    if (typeof Schema !== 'undefined' && typeof Schema.stamp === 'function') {
      Schema.stamp(entry);
    }
    return entry;
  }

  // ── Migration ─────────────────────────────────────────────────────────

  // Idempotent. Run at module load AND exposed for tests.
  //
  // Algorithm:
  //   1. If marker is set → no-op (cheap path).
  //   2. Read 3 legacy keys.
  //   3. For each entry in each key: per-entry try/catch transform to the
  //      consolidated shape (`bfrbs_global` → context='global'; `flow_bfrbs`
  //      → context='flow' + phase; `pomodoro_bfrbs` → context='pomodoro' +
  //      phase + cycleIndex). Bad entries are skipped + warned, not
  //      propagated (Risk #1).
  //   4. Read CURRENT `bfrb_events` store (defensive — partial prior
  //      migration with marker not yet set).
  //   5. Union legacy-transformed + current bfrb_events. Dedup by
  //      (deviceId, takenAt) — guarantees re-run idempotency (Risk #2).
  //   6. Write merged to `bfrb_events`.
  //   7. Set marker.
  //   8. DO NOT delete legacy keys (Pick B — phased; cleanup deferred).
  //
  // Write order is critical: bfrb_events BEFORE marker. If the marker
  // write fails, next boot re-runs and self-heals via dedup.
  function _runMigration() {
    let marker = null;
    try { marker = localStorage.getItem(MIGRATION_MARKER_KEY); } catch (_) {}
    if (marker === '1') return { migrated: false, count: 0, skipped: 0 };

    const localDeviceId = _bfrbGetDeviceId();
    const stampedNow = Date.now();
    const schemaVer = (typeof Schema !== 'undefined' && typeof Schema.SCHEMA_VERSION === 'number')
      ? Schema.SCHEMA_VERSION
      : 1;
    const warnings = [];
    let skipped = 0;
    const transformed = [];

    for (const key of LEGACY_KEYS) {
      const context = LEGACY_KEY_TO_CONTEXT[key];
      let legacy = null;
      try {
        const raw = localStorage.getItem(key);
        legacy = raw ? JSON.parse(raw) : null;
      } catch (e) {
        warnings.push('migration: failed to parse legacy key ' + key + ': ' + (e && e.message));
        continue;
      }
      if (!Array.isArray(legacy)) continue;

      for (const legacyEntry of legacy) {
        try {
          if (!legacyEntry || typeof legacyEntry !== 'object') {
            skipped++;
            warnings.push('migration: skipped non-object entry in ' + key);
            continue;
          }
          if (typeof legacyEntry.timestamp !== 'number' || !isFinite(legacyEntry.timestamp)) {
            skipped++;
            warnings.push('migration: skipped malformed entry in ' + key
                          + ' (timestamp=' + legacyEntry.timestamp + ')');
            continue;
          }
          // Build consolidated entry. Legacy `timestamp` → `takenAt`
          // (matches doseLog convention per Pick A on TODO #3).
          const out = {
            takenAt: legacyEntry.timestamp,
            context: context,
            deviceId: localDeviceId,
            updatedAt: stampedNow,
            schemaVersion: schemaVer,
          };
          if (context === 'flow' && typeof legacyEntry.phase === 'string') {
            out.phase = legacyEntry.phase;
          } else if (context === 'pomodoro') {
            if (typeof legacyEntry.phase === 'string') out.phase = legacyEntry.phase;
            if (typeof legacyEntry.cycleIndex === 'number') out.cycleIndex = legacyEntry.cycleIndex;
          }
          transformed.push(out);
        } catch (e) {
          skipped++;
          warnings.push('migration: try/catch caught entry in ' + key + ': ' + (e && e.message));
        }
      }
    }

    // Defensive: read CURRENT bfrb_events in case of partial prior
    // migration (marker write failed mid-flight on a previous boot). Risk #2.
    const current = _readStore();

    // Union + dedup by (deviceId, takenAt). Iteration order: current
    // first (preserve them on collision), then transformed.
    const seen = new Set();
    const merged = [];
    for (const e of current) {
      if (!e || typeof e !== 'object') continue;
      const sig = _sigOf(e);
      if (sig === null) {
        // No usable key — keep verbatim (can't dedup, can't drop).
        merged.push(e);
        continue;
      }
      if (seen.has(sig)) continue;
      seen.add(sig);
      merged.push(e);
    }
    for (const e of transformed) {
      const sig = _sigOf(e);
      if (sig === null) {
        merged.push(e);
        continue;
      }
      if (seen.has(sig)) continue;
      seen.add(sig);
      merged.push(e);
    }

    // Order by takenAt ascending so downstream readers get a stable view.
    merged.sort((a, b) => {
      const aT = (a && typeof a.takenAt === 'number') ? a.takenAt : -Infinity;
      const bT = (b && typeof b.takenAt === 'number') ? b.takenAt : -Infinity;
      return aT - bT;
    });

    // STEP 6: write the merged store BEFORE the marker (Risk #2).
    _writeStore(merged);

    // STEP 7: set the marker. If this fails, next boot re-runs the union
    // against the same legacy keys + the (already-correct) bfrb_events
    // store and the dedup collapses the duplicate union — byte-identical
    // output, observable no-op.
    try { localStorage.setItem(MIGRATION_MARKER_KEY, '1'); }
    catch (e) {
      warnings.push('migration: failed to set marker: ' + (e && e.message));
    }

    if (warnings.length > 0) {
      try { console.warn('[BfrbEvents] migration warnings: ' + warnings.length, warnings); }
      catch (_) {}
    }

    return { migrated: true, count: merged.length, skipped };
  }

  // ── Public API ────────────────────────────────────────────────────────

  function log(opts) {
    opts = opts || {};
    const context = (opts.context === 'flow' || opts.context === 'pomodoro') ? opts.context : 'global';

    // Build the entry. takenAt is captured ONCE so subsequent dedup
    // signatures are stable across the stamp() call. An explicit
    // `opts.takenAt` override lets the deferred antecedent-capture flow
    // (js/global-bfrb.js) stamp the *catch* moment rather than the later
    // commit moment — the antecedent fields below MUST ride this single
    // write: sync-merge-bfrb keeps the CLOUD copy on a (deviceId, takenAt)
    // collision (js/sync-merge-bfrb.js:158-174), so a post-hoc patch of an
    // already-synced catch is silently dropped. No LWW rescues it.
    const entry = {
      takenAt: (typeof opts.takenAt === 'number' && isFinite(opts.takenAt)) ? opts.takenAt : Date.now(),
      context: context,
    };
    if (opts.sessionId !== undefined && opts.sessionId !== null) {
      entry.sessionId = opts.sessionId;
    }
    if (typeof opts.phase === 'string') entry.phase = opts.phase;
    if (typeof opts.cycleIndex === 'number') entry.cycleIndex = opts.cycleIndex;

    // Antecedent capture (E-1g, additive + nullable — NO SCHEMA_VERSION bump).
    //   urgeLevel: integer 1..3 (Mild / Medium / Strong).
    //   triggerZone: a short UI-owned taxonomy string (trimmed, length-capped).
    // Both are omitted entirely when absent/invalid, so a field-less one-tap
    // catch is byte-identical to the pre-feature shape and the
    // (deviceId, takenAt) dedup signature is provably unchanged.
    if (typeof opts.urgeLevel === 'number' && isFinite(opts.urgeLevel)) {
      const u = Math.round(opts.urgeLevel);
      if (u >= 1 && u <= 3) entry.urgeLevel = u;
    }
    if (typeof opts.triggerZone === 'string') {
      const tz = opts.triggerZone.trim().slice(0, 40);
      if (tz !== '') entry.triggerZone = tz;
    }

    _stampEntry(entry);

    // F19a defensive: refuse to persist a future-schema record. Should be
    // unreachable since _stampEntry assigns SCHEMA_VERSION, but the gate
    // matches the audit's per-method invariant.
    if (typeof Schema !== 'undefined' && typeof Schema.isFutureRecord === 'function'
        && Schema.isFutureRecord(entry)) {
      try { console.warn('[BfrbEvents] log refused future-schema entry'); } catch (_) {}
      return null;
    }

    // F13 write gate: when sync is enabled, defer to SyncState.canWrite().
    // The `typeof` guards keep this usable in test contexts that don't
    // load sync-flag.js / sync-engine.js (matches meds.js:438 pattern).
    if (typeof SyncFlag !== 'undefined' && typeof SyncFlag.isEnabled === 'function'
        && SyncFlag.isEnabled()
        && typeof SyncState !== 'undefined' && typeof SyncState.canWrite === 'function'
        && !SyncState.canWrite()) {
      try { console.warn('[BfrbEvents] log blocked by SyncState gate'); } catch (_) {}
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

  function getByContext(context) {
    const all = _readStore();
    return all.filter(e => e && e.context === context);
  }

  function countToday(context) {
    const today = _localDateKey(new Date());
    const all = _readStore();
    let count = 0;
    for (const e of all) {
      if (!e || typeof e.takenAt !== 'number') continue;
      if (typeof context === 'string' && e.context !== context) continue;
      if (_localDateKey(new Date(e.takenAt)) !== today) continue;
      count++;
    }
    return count;
  }

  function snapshotForSync() {
    const deviceId = _bfrbGetDeviceId();
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
  // no SyncState gate. Mirrors MedsManager._hydrateWriteRaw's contract
  // (the caller — sync-engine reconcileImportedBucket — has already
  // computed the merged cloud ∪ local snapshot under a 'hydrating' gate).
  function _reconcileWriteRaw(events) {
    if (!Array.isArray(events)) events = [];
    _writeStore(events);
  }

  // Auto-run migration at module-load time. The IIFE wrapping
  // executes synchronously when this script tag loads, BEFORE any
  // UI module reads from bfrb_events (script order in index.html
  // places this before js/global-bfrb.js + UI modules per the audit's
  // affected-files table).
  try { _runMigration(); }
  catch (e) {
    try { console.warn('[BfrbEvents] migration threw at load: ' + (e && e.message)); }
    catch (_) {}
  }

  return {
    log,
    getAll,
    getByContext,
    countToday,
    snapshotForSync,
    _reconcileWriteRaw,
    _runMigration,
    // Constants exposed for tests.
    STORAGE_KEY,
    MIGRATION_MARKER_KEY,
    LEGACY_KEYS,
  };
})();

if (typeof window !== 'undefined') {
  window.BfrbEvents = BfrbEvents;
}
