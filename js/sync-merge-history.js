// E-1b: SyncMergeHistory — stub for the history per-store merge function.
//
// Ships as a throwing stub so E-1b's dispatcher can invoke it. E-1d
// will implement:
//   - Sessions append-merge dedup by `id` (each session id is unique
//     per F2 — collisions force cloud-wins LWW).
//   - Per-field LWW for note + tags using each field's own
//     `updatedAt` stamp.
//   - phaseLog dedup by `(deviceId, phaseStartedAt)` per F6.
//   - F3 BFRB stream consolidation — the decision between unified
//     `bfrb_events` stream vs three legacy keys lands in E-1d.
//   - F8 distraction sessionId-keyed migration for `flow_distractions`
//     / `pomodoro_distractions` (tombstones vs sessionId-keyed maps —
//     E-1d picks).

const SyncMergeHistory = (() => {
  function merge(/* snapshot */) {
    throw new Error('not implemented until E-1d');
  }
  return { merge };
})();

if (typeof window !== 'undefined') {
  window.SyncMergeHistory = SyncMergeHistory;
}
