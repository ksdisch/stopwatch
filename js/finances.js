// Life-OS Phase 5: Finances — the monthly finance-snapshot store owner.
//
// `finances` is the 8th synced store and the FIRST editable-per-period
// store: a month's numbers get CORRECTED, and the latest updatedAt for
// that month wins (per-month-key LWW, docs/lifeos/phase-5-...md fork #1).
// It is client-WRITTEN and council-READ — the Life Building synthesizer
// reads it server-side via the Admin SDK, so a device-local store was
// never an option (same reason mood had to sync, ADR-0008).
//
// Storage shape (per-month-KEYED, mirrors `wellness_rest_log`'s per-DATE
// keying — NOT mood's append-only array): a plain object keyed by month.
//   { 'YYYY-MM': { month: 'YYYY-MM',
//                  savingsRate?: number,   // percent, e.g. 18 = 18%
//                  creditScore?: number,   // e.g. 760
//                  debtRemaining?: number, // currency, total remaining debt
//                  netWorth?: number,      // currency, can be negative
//                  deviceId, updatedAt, schemaVersion },
//     ... }
// Every metric field is optional; `setMonth` merges a partial patch into
// the existing month record (or creates it) — so a caller can update just
// the credit score without clobbering the savings rate.
//
// Public API:
//   Finances.setMonth(month, values)
//     → validates `month` is 'YYYY-MM'; merges the provided metric fields
//        (savingsRate/creditScore/debtRemaining/netWorth) into the existing
//        month record (or creates one); stamps deviceId + updatedAt +
//        schemaVersion via Schema.stamp(); gates through SyncState.canWrite()
//        (F13); persists; returns the merged record. Returns null when the
//        month key is malformed or a gate refuses the write.
//   Finances.getMonth(month) → defensive copy of one month's record, or null.
//   Finances.getAll() → defensive copy of the whole per-month map.
//   Finances.snapshotForSync() → wire envelope
//        { deviceId, schemaVersion, payload: { finances: {...map} } }
//        (mirrors RecoveryUI.snapshotForSync — the per-key precedent).
//   Finances._reconcileWriteRaw(map) → merge raw-write hook (writes the
//        map verbatim, no stamping/filter/gate; parity with
//        RecoveryUI._reconcileWriteRaw — the merge fn is the privileged
//        exception during the dispatcher's 'hydrating' window).
//
// F-invariants honored:
//   F10 stamping — every setMonth() stamps deviceId + updatedAt +
//       schemaVersion via Schema.stamp() / module helpers.
//   F13 write gate — setMonth() consults SyncState.canWrite() (when
//       SyncFlag is enabled).
//   F19a — on load AND on write, future-schema month records are dropped
//       via Schema.isFutureRecord (belt-and-suspenders; matches the Mood
//       precedent — stamp() is the only write path so it should be
//       unreachable on write).

const Finances = (() => {
  const STORAGE_KEY = 'finances';

  // The four optional metric fields a month record can carry. Only these
  // are copied from a setMonth() patch; anything else is ignored so a
  // caller can't smuggle arbitrary keys into a synced record.
  const METRIC_FIELDS = ['savingsRate', 'creditScore', 'debtRemaining', 'netWorth'];

  // YYYY-MM validator. Exactly four digits, a hyphen, then a 01..12 month.
  const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

  // F10: lazy deviceId helper. Mirrors `_moodGetDeviceId`
  // (js/mood.js:55) — reads or creates the shared `tempo_device_id`
  // localStorage key so this module can stamp records without depending
  // on other modules' load order.
  function _finGetDeviceId() {
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

  // Read the per-month map. Returns a plain object (never an array); a
  // corrupt/array/missing value normalizes to {}. F19a: future-schema
  // month records are dropped on read so a downlevel client never surfaces
  // data minted on a newer schema (matches the Schema.isFutureRecord
  // contract — the on-disk record stays intact for the future client, we
  // simply don't hydrate it into memory here).
  function _readStore() {
    let parsed;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      parsed = JSON.parse(raw);
    } catch (e) {
      return {};
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const key of Object.keys(parsed)) {
      const rec = parsed[key];
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
      if (typeof Schema !== 'undefined' && typeof Schema.isFutureRecord === 'function'
          && Schema.isFutureRecord(rec)) {
        // F19a: skip the future-schema record — it must survive on disk
        // untouched, so we DON'T rewrite the store here (that would strip
        // it). We just omit it from the in-memory view.
        continue;
      }
      out[key] = rec;
    }
    return out;
  }

  function _writeStore(map) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch (e) {
      // quota / unavailable — surface to a once-per-call warning. Engine
      // can't recover; caller observes via subsequent getAll() drift.
      try { console.warn('[Finances] write failed: ' + (e && e.message)); }
      catch (_) {}
    }
  }

  // ── Stamping ──────────────────────────────────────────────────────────

  // Stamp a month record with deviceId / updatedAt / schemaVersion. Uses
  // Schema.stamp() when available (sets schemaVersion only); the
  // deviceId/updatedAt fields are managed locally to match the
  // meds/mood/rest_log pattern (Schema.stamp does NOT touch them).
  function _stampRecord(rec) {
    if (!rec || typeof rec !== 'object') return rec;
    rec.deviceId = _finGetDeviceId();
    rec.updatedAt = Date.now();
    if (typeof Schema !== 'undefined' && typeof Schema.stamp === 'function') {
      Schema.stamp(rec);
    }
    return rec;
  }

  // ── Public API ────────────────────────────────────────────────────────

  function setMonth(month, values) {
    // `month` is THE required key: a well-formed 'YYYY-MM'. There is no
    // meaningful finance snapshot without a month to key it on.
    if (typeof month !== 'string' || !MONTH_RE.test(month)) {
      try { console.warn('[Finances] setMonth refused: invalid month key (' + String(month) + ')'); } catch (_) {}
      return null;
    }
    values = (values && typeof values === 'object' && !Array.isArray(values)) ? values : {};

    const store = _readStore();
    // Merge onto the EXISTING month record so a partial patch (e.g. just
    // creditScore) doesn't clobber previously-entered metrics. Start from
    // a copy of the prior record (or a fresh { month }).
    const prior = (store[month] && typeof store[month] === 'object' && !Array.isArray(store[month]))
      ? store[month] : null;
    const rec = prior ? Object.assign({}, prior) : {};
    rec.month = month;

    // Copy ONLY the recognized metric fields, and only when the provided
    // value is a finite number. A null/undefined/NaN value leaves the
    // prior value in place (this is a merge/patch, not a replace).
    for (const field of METRIC_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(values, field)) continue;
      const v = values[field];
      if (typeof v === 'number' && isFinite(v)) {
        rec[field] = v;
      }
    }

    _stampRecord(rec);

    // F19a defensive: refuse to persist a future-schema record. Should be
    // unreachable since _stampRecord assigns SCHEMA_VERSION, but the gate
    // matches the Mood per-method invariant.
    if (typeof Schema !== 'undefined' && typeof Schema.isFutureRecord === 'function'
        && Schema.isFutureRecord(rec)) {
      try { console.warn('[Finances] setMonth refused future-schema record'); } catch (_) {}
      return null;
    }

    // F13 write gate: when sync is enabled, defer to SyncState.canWrite().
    // The `typeof` guards keep this usable in test contexts that don't
    // load sync-flag.js / sync-engine.js (matches the mood.js pattern).
    if (typeof SyncFlag !== 'undefined' && typeof SyncFlag.isEnabled === 'function'
        && SyncFlag.isEnabled()
        && typeof SyncState !== 'undefined' && typeof SyncState.canWrite === 'function'
        && !SyncState.canWrite()) {
      try { console.warn('[Finances] setMonth blocked by SyncState gate'); } catch (_) {}
      return null;
    }

    store[month] = rec;
    _writeStore(store);
    return Object.assign({}, rec);
  }

  function getMonth(month) {
    if (typeof month !== 'string') return null;
    const store = _readStore();
    const rec = store[month];
    return (rec && typeof rec === 'object' && !Array.isArray(rec)) ? Object.assign({}, rec) : null;
  }

  function getAll() {
    // _readStore already returns a fresh object from JSON.parse; the
    // explicit per-record copy makes the defensive-copy contract obvious
    // and prevents callers mutating nested records in place.
    const store = _readStore();
    const out = {};
    for (const key of Object.keys(store)) {
      out[key] = Object.assign({}, store[key]);
    }
    return out;
  }

  function snapshotForSync() {
    const deviceId = _finGetDeviceId();
    const schemaVersion = (typeof Schema !== 'undefined' && typeof Schema.SCHEMA_VERSION === 'number')
      ? Schema.SCHEMA_VERSION
      : 1;
    return {
      deviceId: deviceId,
      schemaVersion: schemaVersion,
      payload: {
        finances: getAll(),
      },
    };
  }

  // Merge parity hook. Writes the per-month map verbatim — no stamping,
  // no filter, no SyncState gate. Mirrors RecoveryUI._reconcileWriteRaw's
  // contract (the caller has already computed the merged cloud ∪ local
  // map under the dispatcher's 'hydrating' gate). A non-object input
  // normalizes to an empty map.
  function _reconcileWriteRaw(map) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) map = {};
    _writeStore(map);
  }

  return {
    setMonth,
    getMonth,
    getAll,
    snapshotForSync,
    _reconcileWriteRaw,
    // Constant exposed for tests.
    STORAGE_KEY,
  };
})();

if (typeof window !== 'undefined') {
  window.Finances = Finances;
}
