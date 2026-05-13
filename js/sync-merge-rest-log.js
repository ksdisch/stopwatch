// E-1b: SyncMergeRestLog — stub for the rest_log per-store merge function.
//
// Ships as a throwing stub so E-1b's dispatcher can invoke it. E-1e
// will implement:
//   - Sleep entries LWW per-day on the YYYY-MM-DD key.
//   - Naps append-merge dedup by `(deviceId, startedAt)` so cross-device
//     nap logs union cleanly without double-counting a single nap.

const SyncMergeRestLog = (() => {
  function merge(/* snapshot */) {
    throw new Error('not implemented until E-1e');
  }
  return { merge };
})();

if (typeof window !== 'undefined') {
  window.SyncMergeRestLog = SyncMergeRestLog;
}
