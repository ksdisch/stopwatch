// SyncMergeEqual.recordsEqual() unit tests (M2/M5 — AUDIT-2026-06-13).
//
// recordsEqual is the ONE equality contract all 7 per-store merge modules
// share to skip redundant CAS writebacks. The contract:
//   - deep-equal two records, EXCLUDING the top-level stamp envelope
//     (updatedAt, deviceId, schemaVersion);
//   - count everything else, including nested arrays/objects and tombstones;
//   - strict: return true ONLY when genuinely equal (a false negative wastes a
//     write; a false positive would DROP a real write → data loss). So every
//     "differs" case below must return false.

describe('SyncMergeEqual.recordsEqual — envelope exclusion', () => {

  it('1. identical bodies, differing envelope → equal (skip the write)', () => {
    const a = { id: 'x', payload: 42, updatedAt: 1000, deviceId: 'dev-A', schemaVersion: 1 };
    const b = { id: 'x', payload: 42, updatedAt: 9999, deviceId: 'dev-B', schemaVersion: 1 };
    assertEqual(SyncMergeEqual.recordsEqual(a, b), true,
      'same body, only updatedAt/deviceId differ → equal');
  });

  it('2. schemaVersion-only difference → equal', () => {
    const a = { id: 'x', v: 1, schemaVersion: 1 };
    const b = { id: 'x', v: 1 }; // pre-F19a record with no schemaVersion
    assertEqual(SyncMergeEqual.recordsEqual(a, b), true,
      'absent vs present schemaVersion is excluded → equal');
  });

  it('3. differing body field → NOT equal (must still write)', () => {
    const a = { id: 'x', payload: 42, updatedAt: 1000 };
    const b = { id: 'x', payload: 43, updatedAt: 1000 };
    assertEqual(SyncMergeEqual.recordsEqual(a, b), false, 'payload differs → not equal');
  });

  it('4. extra body key on one side → NOT equal', () => {
    const a = { id: 'x', note: 'hi', updatedAt: 1 };
    const b = { id: 'x', updatedAt: 1 };
    assertEqual(SyncMergeEqual.recordsEqual(a, b), false, 'key-set mismatch → not equal');
  });
});

describe('SyncMergeEqual.recordsEqual — nested structures', () => {

  it('5. identical nested doseLog array → equal (meds)', () => {
    const a = { id: 'm1', doseLog: [{ takenAt: 1 }, { takenAt: 2 }], deviceId: 'A', updatedAt: 5 };
    const b = { id: 'm1', doseLog: [{ takenAt: 1 }, { takenAt: 2 }], deviceId: 'B', updatedAt: 6 };
    assertEqual(SyncMergeEqual.recordsEqual(a, b), true, 'identical doseLog → equal');
  });

  it('6. appended doseLog entry → NOT equal (meds — a new dose must write)', () => {
    const a = { id: 'm1', doseLog: [{ takenAt: 1 }, { takenAt: 2 }] };
    const b = { id: 'm1', doseLog: [{ takenAt: 1 }] };
    assertEqual(SyncMergeEqual.recordsEqual(a, b), false, 'doseLog length differs → not equal');
  });

  it('7. grown phaseLog array → NOT equal (history — F6 union growth must write)', () => {
    const a = { id: 's1', phaseLog: [{ at: 1, phase: 'work' }, { at: 2, phase: 'break' }] };
    const b = { id: 's1', phaseLog: [{ at: 1, phase: 'work' }] };
    assertEqual(SyncMergeEqual.recordsEqual(a, b), false, 'phaseLog grew → not equal');
  });

  it('8. rest_log nested naps[] differ on inner field → NOT equal', () => {
    // The outer envelope is excluded, but inner nap entries (their own
    // deviceId/updatedAt) are content and stay in scope.
    const a = { sleep: { hours: 8 }, naps: [{ startedAt: 100, durationMs: 600000, deviceId: 'A' }], updatedAt: 1, deviceId: 'A' };
    const b = { sleep: { hours: 8 }, naps: [{ startedAt: 100, durationMs: 900000, deviceId: 'A' }], updatedAt: 2, deviceId: 'B' };
    assertEqual(SyncMergeEqual.recordsEqual(a, b), false, 'nap durationMs differs → not equal');
  });

  it('9. rest_log identical nested content, differing outer envelope → equal', () => {
    const a = { sleep: { hours: 8, quality: 4 }, naps: [{ startedAt: 100, durationMs: 600000 }], updatedAt: 1, deviceId: 'A', schemaVersion: 1 };
    const b = { sleep: { hours: 8, quality: 4 }, naps: [{ startedAt: 100, durationMs: 600000 }], updatedAt: 2, deviceId: 'B', schemaVersion: 1 };
    assertEqual(SyncMergeEqual.recordsEqual(a, b), true, 'same nested content → equal');
  });
});

describe('SyncMergeEqual.recordsEqual — tombstones + guards', () => {

  it('10. presets deletedAt flip → NOT equal (tombstone must propagate)', () => {
    const a = { id: 'p1', name: 'Deep work', deletedAt: 1700, updatedAt: 1, deviceId: 'A' };
    const b = { id: 'p1', name: 'Deep work', updatedAt: 1, deviceId: 'A' };
    assertEqual(SyncMergeEqual.recordsEqual(a, b), false,
      'deletedAt is NOT excluded → tombstone change writes');
  });

  it('11. null / non-object inputs → NOT equal (fail-closed → write)', () => {
    assertEqual(SyncMergeEqual.recordsEqual(null, { id: 'x' }), false, 'null a');
    assertEqual(SyncMergeEqual.recordsEqual({ id: 'x' }, null), false, 'null b');
    assertEqual(SyncMergeEqual.recordsEqual('x', 'x'), false, 'non-object a');
    assertEqual(SyncMergeEqual.recordsEqual(undefined, undefined), false, 'both undefined');
  });

  it('12. nested key-set mismatch → NOT equal', () => {
    const a = { id: 'x', meta: { a: 1, b: 2 } };
    const b = { id: 'x', meta: { a: 1 } };
    assertEqual(SyncMergeEqual.recordsEqual(a, b), false, 'nested object key-set differs → not equal');
  });

  it('13. custom excludeKeys override is honored', () => {
    const a = { id: 'x', score: 10, ephemeral: 'A' };
    const b = { id: 'x', score: 10, ephemeral: 'B' };
    assertEqual(SyncMergeEqual.recordsEqual(a, b), false, 'default keeps ephemeral → not equal');
    assertEqual(SyncMergeEqual.recordsEqual(a, b, ['ephemeral']), true, 'override excludes ephemeral → equal');
  });

  it('14. array-vs-object at same key → NOT equal (type guard)', () => {
    const a = { id: 'x', data: [1, 2] };
    const b = { id: 'x', data: { 0: 1, 1: 2 } };
    assertEqual(SyncMergeEqual.recordsEqual(a, b), false, 'array vs object → not equal');
  });

  it('15. non-plain objects (Date) fail closed → NOT equal (no empty-keys false positive)', () => {
    // Object.keys(new Date()) is [] — without the plain-object guard two
    // different Dates would compare as equal. Fail closed in the data-loss
    // direction: treat ANY non-plain object as "changed" (→ write).
    assertEqual(SyncMergeEqual.recordsEqual({ t: new Date(5) }, { t: new Date(99999) }), false,
      'different Dates must not be masked as equal');
    assertEqual(SyncMergeEqual.recordsEqual({ t: new Date(5) }, { t: new Date(5) }), false,
      'even equal-valued Dates fail closed (conservative → write, never drop)');
  });
});
