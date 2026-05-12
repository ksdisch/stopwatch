// D-1: ManualDedupe — placeholder hook surface for surfacing candidate
// history-session pairs across the `synced` and `imported` buckets.
//
// D-1 ships the engine only — no UI is wired. `ManualDedupe.scan()` is a
// console-only entry point that returns candidate pairs by similarity.
// D-2+ will consume this from a settings-drawer "Find duplicate records"
// panel that lets the user pick a winner per pair.
//
// Scope discipline:
//   - No DOM access.
//   - No write paths — `scan()` is pure read over `History.getSessions()`.
//   - No external dependencies beyond `History` (read-only).
//
// Public API:
//   ManualDedupe.scan() : Promise<Array<{ a, b, similarity }>>
//     - `a` is a session record with `bucket === 'synced'` (or absent)
//     - `b` is a session record with `bucket === 'imported'`
//     - `similarity` ∈ [0, 1]: 1.0 = exact duration match, 0.9 = within ±5s
//     - Pairs require identical `(roundedDate, type)` keys.
//     - Returns `[]` when no imported rows exist.

const ManualDedupe = (() => {
  // ±5 sec window for "near-match" candidate pairs. Tight enough to avoid
  // false positives on stopwatch sessions that genuinely differ; loose
  // enough to catch round-trip drift through legacy export paths.
  const NEAR_MATCH_WINDOW_MS = 5000;

  function _roundedDate(session) {
    // `YYYY-MM-DD` day key. `session.date` is the ISO timestamp set by
    // `History.addSession`. Defensive on malformed input — return null so
    // the pair-iteration loop skips this session entirely.
    if (!session || typeof session.date !== 'string') return null;
    try {
      const d = new Date(session.date);
      const iso = d.toISOString();
      if (typeof iso !== 'string' || iso.length < 10) return null;
      return iso.slice(0, 10);
    } catch (e) {
      return null;
    }
  }

  function _similarity(durA, durB) {
    if (typeof durA !== 'number' || typeof durB !== 'number') return 0;
    const delta = Math.abs(durA - durB);
    if (delta === 0) return 1.0;
    if (delta <= NEAR_MATCH_WINDOW_MS) return 0.9;
    return 0;
  }

  async function scan() {
    if (typeof History === 'undefined' || typeof History.getSessions !== 'function') {
      return [];
    }
    let sessions;
    try {
      sessions = await History.getSessions();
    } catch (e) {
      return [];
    }
    if (!Array.isArray(sessions) || sessions.length === 0) return [];

    // Partition into synced (or absent-bucket) and imported buckets.
    // Records with absent `bucket` are treated as `synced` for the
    // candidate-pair iteration — they pre-date D-1's authoring and the
    // reconcile pass back-tags them, so the only time a paired `a` lacks
    // `bucket` is in a transient pre-reconcile snapshot.
    const synced = [];
    const imported = [];
    for (const s of sessions) {
      if (!s || typeof s !== 'object') continue;
      if (s.bucket === 'imported') {
        imported.push(s);
      } else {
        synced.push(s);
      }
    }
    if (imported.length === 0) return [];

    // Cartesian product within (type, roundedDate) buckets is O(N²) but N
    // is bounded by the user's local history size and the pairs filter is
    // tight — for typical accounts this completes in single-digit ms.
    // Pre-group synced rows by `(type, roundedDate)` so the iteration over
    // imported is O(N_imported * avg_synced_per_bucket).
    const syncedByKey = new Map();
    for (const a of synced) {
      const day = _roundedDate(a);
      if (day === null || typeof a.type !== 'string') continue;
      const key = a.type + '|' + day;
      let bucket = syncedByKey.get(key);
      if (!bucket) {
        bucket = [];
        syncedByKey.set(key, bucket);
      }
      bucket.push(a);
    }

    const pairs = [];
    for (const b of imported) {
      const day = _roundedDate(b);
      if (day === null || typeof b.type !== 'string') continue;
      const key = b.type + '|' + day;
      const candidates = syncedByKey.get(key);
      if (!candidates) continue;
      for (const a of candidates) {
        const sim = _similarity(a.duration, b.duration);
        if (sim > 0) {
          pairs.push({ a, b, similarity: sim });
        }
      }
    }

    return pairs;
  }

  return { scan };
})();

if (typeof window !== 'undefined') {
  window.ManualDedupe = ManualDedupe;
}
