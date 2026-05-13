// E-1b: SyncMergePresets — stub for the presets per-store merge function.
//
// Ships as a throwing stub so E-1b's dispatcher can invoke it. E-1e
// will implement:
//   - Full-record LWW by `id` + `updatedAt`.
//   - Tombstones for deletes — presets gain a `deletedAt: null` field
//     in E-1e so cross-device delete events propagate.

const SyncMergePresets = (() => {
  function merge(/* snapshot */) {
    throw new Error('not implemented until E-1e');
  }
  return { merge };
})();

if (typeof window !== 'undefined') {
  window.SyncMergePresets = SyncMergePresets;
}
