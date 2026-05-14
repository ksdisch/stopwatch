// E-1d-f8: Distractions — consolidated distraction stream owner for both
// Flow + Pomodoro pillars.
//
// F8 (distraction sessionId-keyed migration): reshapes the two legacy
// localStorage keys (`flow_distractions` + `pomodoro_distractions`) from
// flat arrays into sessionId-keyed maps `{ [sessionId]: [entries] }`.
// The key names are PRESERVED — only the value shape changes. UI reads
// switch from `loadFlowDistractions()` → `Distractions.getForSession(
// 'flow', Flow.getSessionStartedAt())`.
//
// One-way phased migration (Pick B on TODO #2): reads the legacy flat
// arrays → attaches each to the currently-active Flow / Pomo session if
// one is running else under a synthetic `'pre-migration-orphan'` key
// (Pick B on TODO #3) → writes the new map shape under the same key →
// sets idempotency marker `tempo_distractions_migration_v1='1'`. Legacy
// keys are NOT deleted (cleanup PR deferred per Pick C on TODO #6).
//
// Orphan-key garbage: the synthetic `'pre-migration-orphan'` key
// accumulates ONCE on first boot when legacy data exists but no session
// is running. UI never reads this key (filters by current session), so
// user-visible behavior is unaffected. Documented gap per audit Risk #7.
//
// Public API (matches the auditor's affected-files table):
//   Distractions.log({ context, sessionId, category, note?, phase?, cycleIndex? })
//     → builds a new entry { category, note?, timestamp, phase?,
//        cycleIndex?, deviceId, updatedAt, schemaVersion }, gates
//        through SyncState.canWrite() (F13), reads + appends to
//        `map[sessionId]`, persists, returns the entry.
//   Distractions.getForSession(context, sessionId)
//     → returns `map[sessionId] || []` (defensive copy).
//   Distractions.clearSession(context, sessionId)
//     → `delete map[sessionId]; persist;`.
//   Distractions.clearAllForContext(context)
//     → empties the map for that store (used by `js/persistence.js`
//        line 67's app-mode-change path).
//   Distractions.snapshotForSync() → wire envelope
//     { deviceId, schemaVersion, payload: { flow: {...mapShape},
//                                            pomodoro: {...mapShape} } }.
//   Distractions._reconcileWriteRaw(envelope)
//     → D-1 parity hook (writes verbatim, no stamping).
//   Distractions._runMigration() → exposed for tests; idempotent.
//
// F-invariants honored:
//   F10 stamping — every log() stamps deviceId + updatedAt + schemaVersion
//       via Schema.stamp() / module helpers. Migration-derived entries
//       inherit the local deviceId (legacy entries were minted on this
//       device by definition).
//   F13 write gate — log() consults SyncState.canWrite() when SyncFlag is
//       enabled.
//   F19a — log() defensive-skips if the candidate entry is somehow a
//       future record (should never happen since stamp() is the only
//       write path, but belt-and-suspenders).
//
// Marker naming: `tempo_distractions_migration_v1` — explicit `_v1` suffix
// reserves namespace for hypothetical future migrations.

const Distractions = (() => {
  const FLOW_KEY = 'flow_distractions';
  const POMO_KEY = 'pomodoro_distractions';
  const MIGRATION_MARKER_KEY = 'tempo_distractions_migration_v1';
  const ORPHAN_SESSION_ID = 'pre-migration-orphan';

  const KEY_BY_CONTEXT = {
    flow: FLOW_KEY,
    pomodoro: POMO_KEY,
  };

  // F10: lazy deviceId helper. Mirrors `_bfrbGetDeviceId` (js/bfrb-events.js:62)
  // — reads or creates the shared `tempo_device_id` localStorage key so
  // this module can stamp records without depending on other modules'
  // load order.
  function _distractionsGetDeviceId() {
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

  // Signature for dedup: (deviceId, timestamp). Matches the meds doseLog
  // / BfrbEvents convention.
  function _sigOf(entry) {
    if (!entry || typeof entry.timestamp !== 'number') return null;
    const dev = (typeof entry.deviceId === 'string') ? entry.deviceId : '∅';
    return dev + '@' + entry.timestamp;
  }

  // ── Storage primitives ────────────────────────────────────────────────

  // Read the map under a context's localStorage key. Defensive: returns
  // {} if the value is missing, malformed JSON, or a non-object (e.g.
  // pre-migration flat array). Callers can detect the pre-migration shape
  // separately if they need it (migration does — see _runMigration).
  function _readMap(contextKey) {
    try {
      const raw = localStorage.getItem(contextKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
      // If it's an array (pre-migration shape) or anything else, return
      // empty — the migration will collapse this case. Defensive readers
      // shouldn't crash.
      return {};
    } catch (e) {
      return {};
    }
  }

  function _writeMap(contextKey, map) {
    try {
      localStorage.setItem(contextKey, JSON.stringify(map));
    } catch (e) {
      try { console.warn('[Distractions] write failed for ' + contextKey + ': ' + (e && e.message)); }
      catch (_) {}
    }
  }

  // Resolve a context tag to a localStorage key. Returns null on invalid
  // input so callers can early-return.
  function _resolveKey(context) {
    if (context === 'flow' || context === 'pomodoro') return KEY_BY_CONTEXT[context];
    return null;
  }

  // ── Stamping ──────────────────────────────────────────────────────────

  function _stampEntry(entry) {
    if (!entry || typeof entry !== 'object') return entry;
    entry.deviceId = _distractionsGetDeviceId();
    entry.updatedAt = Date.now();
    if (typeof Schema !== 'undefined' && typeof Schema.stamp === 'function') {
      Schema.stamp(entry);
    }
    return entry;
  }

  // ── Migration ─────────────────────────────────────────────────────────

  // Idempotent. Run at module load AND exposed for tests.
  //
  // Algorithm (per audit § Migration logic):
  //   1. If marker is set → no-op (cheap path).
  //   2. For each of the 2 legacy keys (flow + pomo):
  //      (a) read the current value
  //      (b) if it's already a map (object), set the marker (defensive —
  //          a prior partial run completed) and continue — the migration
  //          step for this key is already done; defensive dedup-merge in
  //          the union step would no-op since legacy-transformed is empty.
  //      (c) if it's a flat array (legacy shape), determine the target
  //          sessionId: call `Flow.getSessionStartedAt()` /
  //          `Pomodoro.getSessionStartedAt()` via typeof-guarded probes.
  //          Non-null number → that's the sessionId; otherwise use the
  //          synthetic `'pre-migration-orphan'` key (Pick B on TODO #3).
  //      (d) per-entry try/catch transform: preserve `category` + `note`
  //          + `timestamp` + `phase` + `cycleIndex` verbatim; stamp
  //          `deviceId` + `updatedAt` + `schemaVersion`. Malformed entries
  //          are skipped + warned, NOT propagated (Risk #1).
  //      (e) read CURRENT map (defensive against partial prior migration)
  //          and union legacy-transformed entries into
  //          `map[targetSessionId]`. Dedup by (deviceId, timestamp).
  //      (f) write the merged map back to the same key.
  //   3. Set the marker.
  //   4. DO NOT delete legacy keys (Pick B — phased; cleanup deferred).
  //
  // Write order: maps BEFORE marker. If marker write fails, next boot
  // re-runs and the defensive shape detection + dedup self-heals to a
  // byte-identical output.
  function _runMigration() {
    let marker = null;
    try { marker = localStorage.getItem(MIGRATION_MARKER_KEY); } catch (_) {}
    if (marker === '1') return { migrated: false, count: 0, skipped: 0 };

    const localDeviceId = _distractionsGetDeviceId();
    const stampedNow = Date.now();
    const schemaVer = (typeof Schema !== 'undefined' && typeof Schema.SCHEMA_VERSION === 'number')
      ? Schema.SCHEMA_VERSION
      : 1;
    const warnings = [];
    let totalSkipped = 0;
    let totalCount = 0;

    // Per-context migration. Process flow first, pomodoro second.
    const contexts = [
      { context: 'flow', key: FLOW_KEY },
      { context: 'pomodoro', key: POMO_KEY },
    ];

    for (const { context, key } of contexts) {
      let legacy = null;
      try {
        const raw = localStorage.getItem(key);
        legacy = raw ? JSON.parse(raw) : null;
      } catch (e) {
        warnings.push('migration: failed to parse legacy key ' + key + ': ' + (e && e.message));
        continue;
      }
      if (legacy === null) continue;

      // Already a map? (Partial prior run finished writing the map but
      // the marker write failed.) Defensive: we still want the union +
      // dedup step to run so any unstaged legacy array entries get
      // dedup-merged. But if there's no flat array left, we have nothing
      // to transform — fall through with empty transformed[].
      const isMap = !Array.isArray(legacy) && typeof legacy === 'object';
      const isArray = Array.isArray(legacy);

      const transformed = [];

      if (isArray) {
        // Determine target sessionId. Call the engine's accessor via
        // typeof-guarded probes so test contexts that omit Flow / Pomodoro
        // fall through to the orphan key. Read via `window.Flow` /
        // `window.Pomodoro` so test stubs that replace the global on
        // window are honored — bare `Flow` resolves to the classic-script
        // `const Flow = ...` binding from js/flow.js which tests can't
        // override.
        let activeSessionId = null;
        try {
          const FlowRef = (typeof window !== 'undefined' && window.Flow) ? window.Flow
            : (typeof Flow !== 'undefined' ? Flow : null);
          const PomoRef = (typeof window !== 'undefined' && window.Pomodoro) ? window.Pomodoro
            : (typeof Pomodoro !== 'undefined' ? Pomodoro : null);
          if (context === 'flow'
              && FlowRef
              && typeof FlowRef.getSessionStartedAt === 'function') {
            const v = FlowRef.getSessionStartedAt();
            if (typeof v === 'number' && isFinite(v)) activeSessionId = v;
          } else if (context === 'pomodoro'
              && PomoRef
              && typeof PomoRef.getSessionStartedAt === 'function') {
            const v = PomoRef.getSessionStartedAt();
            if (typeof v === 'number' && isFinite(v)) activeSessionId = v;
          }
        } catch (_) { /* defensive: probe never throws */ }

        const targetKey = (activeSessionId !== null) ? String(activeSessionId) : ORPHAN_SESSION_ID;

        for (const legacyEntry of legacy) {
          try {
            if (!legacyEntry || typeof legacyEntry !== 'object') {
              totalSkipped++;
              warnings.push('migration: skipped non-object entry in ' + key);
              continue;
            }
            if (typeof legacyEntry.timestamp !== 'number' || !isFinite(legacyEntry.timestamp)) {
              totalSkipped++;
              warnings.push('migration: skipped malformed entry in ' + key
                            + ' (timestamp=' + legacyEntry.timestamp + ')');
              continue;
            }
            const out = {
              category: (typeof legacyEntry.category === 'string') ? legacyEntry.category : 'other',
              timestamp: legacyEntry.timestamp,
              deviceId: localDeviceId,
              updatedAt: stampedNow,
              schemaVersion: schemaVer,
            };
            if (typeof legacyEntry.note === 'string' && legacyEntry.note.length > 0) {
              out.note = legacyEntry.note;
            }
            if (typeof legacyEntry.phase === 'string') {
              out.phase = legacyEntry.phase;
            }
            if (typeof legacyEntry.cycleIndex === 'number') {
              out.cycleIndex = legacyEntry.cycleIndex;
            }
            // Tag the target sessionId on the entry so the union step
            // below can route it to the right map key.
            out._targetSessionId = targetKey;
            transformed.push(out);
          } catch (e) {
            totalSkipped++;
            warnings.push('migration: try/catch caught entry in ' + key + ': ' + (e && e.message));
          }
        }
      }

      // Defensive: read CURRENT map shape (in case of partial prior
      // migration). If legacy was already a map, this gets us the existing
      // map; if legacy was an array (now being migrated), this gets us
      // an empty map (since _readMap returns {} on non-object input).
      const currentMap = _readMap(key);

      // Union transformed[] into currentMap by targetSessionId.
      // Dedup per-session by (deviceId, timestamp).
      for (const entry of transformed) {
        const target = entry._targetSessionId;
        delete entry._targetSessionId;
        const arr = Array.isArray(currentMap[target]) ? currentMap[target] : [];
        const seen = new Set();
        for (const e of arr) {
          const sig = _sigOf(e);
          if (sig !== null) seen.add(sig);
        }
        const sig = _sigOf(entry);
        if (sig !== null && seen.has(sig)) {
          // Duplicate — skip (idempotent re-run).
          continue;
        }
        arr.push(entry);
        currentMap[target] = arr;
      }

      // Sort each session's entries by timestamp ascending for stable
      // downstream reads.
      for (const sid of Object.keys(currentMap)) {
        if (Array.isArray(currentMap[sid])) {
          currentMap[sid].sort((a, b) => {
            const aT = (a && typeof a.timestamp === 'number') ? a.timestamp : -Infinity;
            const bT = (b && typeof b.timestamp === 'number') ? b.timestamp : -Infinity;
            return aT - bT;
          });
          totalCount += currentMap[sid].length;
        }
      }

      _writeMap(key, currentMap);
    }

    // STEP 7: set the marker. If this fails, next boot re-runs the union
    // against the same legacy keys + the already-correct maps; dedup
    // collapses the duplicate union to a byte-identical output.
    try { localStorage.setItem(MIGRATION_MARKER_KEY, '1'); }
    catch (e) {
      warnings.push('migration: failed to set marker: ' + (e && e.message));
    }

    if (warnings.length > 0) {
      try { console.warn('[Distractions] migration warnings: ' + warnings.length, warnings); }
      catch (_) {}
    }

    return { migrated: true, count: totalCount, skipped: totalSkipped };
  }

  // ── Public API ────────────────────────────────────────────────────────

  function log(opts) {
    opts = opts || {};
    const key = _resolveKey(opts.context);
    if (!key) {
      try { console.warn('[Distractions] log: invalid context ' + opts.context); } catch (_) {}
      return null;
    }
    if (opts.sessionId === undefined || opts.sessionId === null) {
      try { console.warn('[Distractions] log: missing sessionId'); } catch (_) {}
      return null;
    }

    // Build the entry. timestamp is captured ONCE so subsequent dedup
    // signatures are stable across the stamp() call.
    const entry = {
      category: (typeof opts.category === 'string') ? opts.category : 'other',
      timestamp: Date.now(),
    };
    if (typeof opts.note === 'string' && opts.note.length > 0) {
      entry.note = opts.note;
    }
    if (typeof opts.phase === 'string') entry.phase = opts.phase;
    if (typeof opts.cycleIndex === 'number') entry.cycleIndex = opts.cycleIndex;

    _stampEntry(entry);

    // F19a defensive: refuse to persist a future-schema record. Should be
    // unreachable since _stampEntry assigns SCHEMA_VERSION, but the gate
    // matches the audit's per-method invariant.
    if (typeof Schema !== 'undefined' && typeof Schema.isFutureRecord === 'function'
        && Schema.isFutureRecord(entry)) {
      try { console.warn('[Distractions] log refused future-schema entry'); } catch (_) {}
      return null;
    }

    // F13 write gate: when sync is enabled, defer to SyncState.canWrite().
    if (typeof SyncFlag !== 'undefined' && typeof SyncFlag.isEnabled === 'function'
        && SyncFlag.isEnabled()
        && typeof SyncState !== 'undefined' && typeof SyncState.canWrite === 'function'
        && !SyncState.canWrite()) {
      try { console.warn('[Distractions] log blocked by SyncState gate'); } catch (_) {}
      return null;
    }

    const sidKey = String(opts.sessionId);
    const map = _readMap(key);
    const arr = Array.isArray(map[sidKey]) ? map[sidKey] : [];
    arr.push(entry);
    map[sidKey] = arr;
    _writeMap(key, map);
    return entry;
  }

  function getForSession(context, sessionId) {
    const key = _resolveKey(context);
    if (!key) return [];
    if (sessionId === undefined || sessionId === null) return [];
    const map = _readMap(key);
    const sidKey = String(sessionId);
    const arr = Array.isArray(map[sidKey]) ? map[sidKey] : [];
    // Defensive copy so callers can mutate without bleeding back to disk.
    return arr.slice();
  }

  function clearSession(context, sessionId) {
    const key = _resolveKey(context);
    if (!key) return;
    if (sessionId === undefined || sessionId === null) return;
    const map = _readMap(key);
    const sidKey = String(sessionId);
    if (Object.prototype.hasOwnProperty.call(map, sidKey)) {
      delete map[sidKey];
      _writeMap(key, map);
    }
  }

  function clearAllForContext(context) {
    const key = _resolveKey(context);
    if (!key) return;
    _writeMap(key, {});
  }

  function snapshotForSync() {
    const deviceId = _distractionsGetDeviceId();
    const schemaVersion = (typeof Schema !== 'undefined' && typeof Schema.SCHEMA_VERSION === 'number')
      ? Schema.SCHEMA_VERSION
      : 1;
    return {
      deviceId: deviceId,
      schemaVersion: schemaVersion,
      payload: {
        flow: _readMap(FLOW_KEY),
        pomodoro: _readMap(POMO_KEY),
      },
    };
  }

  // D-1 parity hook. Writes verbatim — no stamping, no filter, no
  // SyncState gate. Mirrors BfrbEvents._reconcileWriteRaw's contract
  // (the caller has already computed the merged cloud ∪ local snapshot
  // under a 'hydrating' gate).
  //
  // Accepts either the envelope shape (`{ payload: { flow, pomodoro } }`)
  // or the raw payload object (`{ flow, pomodoro }`).
  function _reconcileWriteRaw(envelopeOrPayload) {
    if (!envelopeOrPayload || typeof envelopeOrPayload !== 'object') return;
    const payload = (envelopeOrPayload.payload && typeof envelopeOrPayload.payload === 'object')
      ? envelopeOrPayload.payload
      : envelopeOrPayload;
    if (payload.flow && typeof payload.flow === 'object' && !Array.isArray(payload.flow)) {
      _writeMap(FLOW_KEY, payload.flow);
    }
    if (payload.pomodoro && typeof payload.pomodoro === 'object' && !Array.isArray(payload.pomodoro)) {
      _writeMap(POMO_KEY, payload.pomodoro);
    }
  }

  // Auto-run migration at module-load time. The IIFE wrapping executes
  // synchronously when this script tag loads, BEFORE any UI module reads
  // from `flow_distractions` / `pomodoro_distractions` (script order in
  // index.html places this before js/flow-ui.js + js/pomodoro-ui.js per
  // the audit's affected-files table).
  try { _runMigration(); }
  catch (e) {
    try { console.warn('[Distractions] migration threw at load: ' + (e && e.message)); }
    catch (_) {}
  }

  return {
    log,
    getForSession,
    clearSession,
    clearAllForContext,
    snapshotForSync,
    _reconcileWriteRaw,
    _runMigration,
    // Constants exposed for tests.
    FLOW_KEY,
    POMO_KEY,
    MIGRATION_MARKER_KEY,
    ORPHAN_SESSION_ID,
  };
})();

if (typeof window !== 'undefined') {
  window.Distractions = Distractions;
}
