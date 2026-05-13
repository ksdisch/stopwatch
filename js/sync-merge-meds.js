// E-1b: SyncMergeMeds — stub for the meds per-store merge function.
//
// Ships as a throwing stub so E-1b's dispatcher (`_runMergeCycle` in
// `js/sync-engine.js`) can invoke it and exercise the per-store
// try/catch error-tolerance path. E-1c replaces `merge()` with the real
// meds metadata LWW + doseLog append-merge that delegates to
// `MedsManager.reconcileDoseLog` (D-2's helper) and fires the
// `meds-arrival` event for B-4's toast on ≥2 remote entries (F15).
//
// Public surface (forward-compat with E-1c):
//   SyncMergeMeds.merge(snapshot) — applies the cloud-side meds snapshot
//                                    to local state. Returns a per-store
//                                    result `{ ok, count, skipped }`.

const SyncMergeMeds = (() => {
  function merge(/* snapshot */) {
    throw new Error('not implemented until E-1c');
  }
  return { merge };
})();

if (typeof window !== 'undefined') {
  window.SyncMergeMeds = SyncMergeMeds;
}
