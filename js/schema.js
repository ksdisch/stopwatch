// Schema-evolution scaffolding (F19a).
//
// The cloud-sync engine isn't wired yet, but every synced-eligible record
// now carries a `schemaVersion` field so older clients can detect data
// minted on a newer schema and refuse to overwrite it. Without this rule,
// the first downlevel client to edit a future-version record would silently
// strip every field its loader doesn't recognize.
//
// Contract:
//   - Every write to a synced-eligible store stamps `schemaVersion`.
//   - Loaders inspect the loaded record; if `schemaVersion > SCHEMA_VERSION`
//     the record was minted on a newer client. The in-memory representation
//     is flagged as such and the engine's writeback path must skip / refuse
//     to persist it (so the on-disk future record stays intact, byte-clean,
//     ready for the future client to consume).
//   - Pre-F19a records (no `schemaVersion` field) are NOT treated as future
//     — they get stamped to SCHEMA_VERSION on the next write, lazily.
//
// Synced-eligible stores (per docs/CLOUD-SYNC-STRATEGY.md, Phase 5):
//   - History sessions   (IndexedDB stopwatch_history_db / store 'sessions')
//   - Medication records (localStorage 'meds/{medId}')
//   - Quick presets      (localStorage 'quick_presets')
//   - Mood events        (localStorage 'mood_events' — Life-OS Phase 3, ADR-0008)
//   - Finances           (localStorage 'finances' — Life-OS Phase 5, per-month LWW)
//
// Explicitly NOT subject to schemaVersion stamping today: multi_state,
// pomodoro_*, flow_*, interval_state, cooking_timers, sequence_*. These
// stores are either local-only or not yet on the sync roadmap. The
// per-store manifest (F19c) will formalize this list later.

const Schema = (() => {
  const SCHEMA_VERSION = 1;

  // True iff the record carries a numeric schemaVersion higher than what
  // this client understands. The numeric+finite guard rejects strings
  // ('2'), null, undefined, NaN, Infinity — only well-formed integers
  // strictly greater than SCHEMA_VERSION qualify. A record with no
  // schemaVersion field (pre-F19a data) is NOT future; it gets stamped
  // to the current version on its next write.
  function isFutureRecord(record) {
    if (!record || typeof record !== 'object') return false;
    const v = record.schemaVersion;
    return typeof v === 'number' && isFinite(v) && v > SCHEMA_VERSION;
  }

  // Mutates the record to set schemaVersion = SCHEMA_VERSION. Returns
  // the record so call sites can write `Schema.stamp({...})` inline.
  //
  // Refuses to downgrade: if the record already carries a higher
  // schemaVersion (i.e. is a future record), it is left unchanged. The
  // writeback gate at each call site should have caught that case already
  // — this is belt-and-suspenders so a stray stamp() call can't corrupt
  // future records on roundtrip.
  function stamp(record) {
    if (record && typeof record === 'object' && !isFutureRecord(record)) {
      record.schemaVersion = SCHEMA_VERSION;
    }
    return record;
  }

  return { SCHEMA_VERSION, isFutureRecord, stamp };
})();
