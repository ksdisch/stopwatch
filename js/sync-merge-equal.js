// SyncMergeEqual — shared change-detection for the per-store CAS writeback.
//
// M2/M5 (AUDIT-2026-06-13): each steady-state merge previously re-wrote EVERY
// merged record back to Firestore every cycle, with no comparison against the
// cloud doc it had just read. Because a `tx.set` fires `onSnapshot` on every
// connected device (including the writer itself, once the write is server-
// acked), that redundant re-write re-triggers a merge → another re-write → a
// self-perpetuating loop that burns Firestore writes + bandwidth + battery on
// ZERO data change. With ≥2 devices online it becomes a perpetual ~1 Hz loop.
//
// The cure is to skip the cloud write when the record we'd write already
// equals the cloud doc just read inside the CAS transaction. This module owns
// the ONE equality contract all 7 per-store merge modules share, so the
// envelope-exclusion set can't drift per-store (the audit's chief risk).
//
// recordsEqual(a, b, excludeKeys?):
//   Structural deep-equal of two records, ignoring the sync ENVELOPE fields
//   that Schema.stamp() / the data modules re-set on every write and that must
//   NOT count as a content change: `updatedAt`, `deviceId`, `schemaVersion`
//   (TOP level only). Everything else — including nested objects/arrays
//   (meds.doseLog, history.phaseLog, rest_log.naps[]/sleep{}) and tombstone
//   fields (presets.deletedAt) — is compared structurally and DOES count.
//
//   Strict by design: it returns true ONLY when the two records are genuinely
//   identical modulo the envelope. When in doubt (type mismatch, differing
//   key set, missing key) it returns false → "treat as changed" → write anyway.
//   So this optimization can only ever skip a genuinely-redundant write; it can
//   never drop a real one (a false negative is a wasted write, never data loss).
const SyncMergeEqual = (() => {
  // The three fields Schema.stamp()/the write sites own. They differ on every
  // restamp (deviceId per device, updatedAt per write, schemaVersion lazily),
  // so including them would make every record compare as "changed" and defeat
  // the de-dup entirely. They are stripped at the TOP level only — nested
  // entries (e.g. rest_log naps each carry their own stamp) ARE content and
  // stay in the comparison.
  const DEFAULT_EXCLUDE = ['updatedAt', 'deviceId', 'schemaVersion'];

  // A plain object is one whose prototype is Object.prototype (or null) — i.e.
  // a JSON-shaped record, not a Date/Map/Set/RegExp/class instance. Object.keys
  // is [] for those exotics, so without this guard two DIFFERENT Date/Map
  // instances would deep-equal as two empty objects → a false positive in the
  // data-loss direction. Synced records are plain JSON today (numeric ms, ISO
  // strings, plain objects/arrays — no stored Date/Timestamp), but we fail
  // CLOSED here so the module honors its strict contract if that ever changes.
  function _isPlainObject(o) {
    const proto = Object.getPrototypeOf(o);
    return proto === Object.prototype || proto === null;
  }

  function _deepEqual(a, b) {
    if (a === b) return true;
    if (a === null || b === null) return a === b;
    if (typeof a !== 'object' || typeof b !== 'object') return false;
    const aIsArr = Array.isArray(a);
    const bIsArr = Array.isArray(b);
    if (aIsArr !== bIsArr) return false;
    if (aIsArr) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!_deepEqual(a[i], b[i])) return false;
      }
      return true;
    }
    // Fail closed for non-plain objects (Date, Map, Set, RegExp, class
    // instances): treat them as "changed" (→ write) rather than risk masking a
    // real difference behind an empty Object.keys().
    if (!_isPlainObject(a) || !_isPlainObject(b)) return false;
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!_deepEqual(a[k], b[k])) return false;
    }
    return true;
  }

  function recordsEqual(a, b, excludeKeys) {
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const ex = Array.isArray(excludeKeys) ? excludeKeys : DEFAULT_EXCLUDE;
    const ca = Object.assign({}, a);
    const cb = Object.assign({}, b);
    for (const k of ex) {
      delete ca[k];
      delete cb[k];
    }
    return _deepEqual(ca, cb);
  }

  return { recordsEqual, DEFAULT_EXCLUDE };
})();
