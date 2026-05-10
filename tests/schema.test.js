// Schema module unit tests (F19a).
//
// Exercise the contract that powers per-store schemaVersion stamping:
// - SCHEMA_VERSION pinned at 1 (regression guard)
// - isFutureRecord: numeric & finite & strictly greater than SCHEMA_VERSION
// - stamp: idempotent, no-downgrade, returns the record for chaining

describe('Schema — SCHEMA_VERSION', () => {
  it('is pinned at 1', () => {
    // Regression guard: bumping this is a coordinated change that has to
    // be paired with a sync-side migration plan. Catch accidental bumps.
    assertEqual(Schema.SCHEMA_VERSION, 1);
  });
});

describe('Schema — isFutureRecord', () => {
  it('returns false for null / undefined / non-object', () => {
    assertEqual(Schema.isFutureRecord(null), false);
    assertEqual(Schema.isFutureRecord(undefined), false);
    assertEqual(Schema.isFutureRecord('hello'), false);
    assertEqual(Schema.isFutureRecord(42), false);
    assertEqual(Schema.isFutureRecord(true), false);
  });

  it('returns false for an empty record (no schemaVersion field)', () => {
    // Pre-F19a records have no schemaVersion → not future. They get
    // stamped to v1 lazily on the next write, not flagged read-only.
    assertEqual(Schema.isFutureRecord({}), false);
    assertEqual(Schema.isFutureRecord({ name: 'foo' }), false);
  });

  it('returns false when schemaVersion equals SCHEMA_VERSION', () => {
    assertEqual(Schema.isFutureRecord({ schemaVersion: 1 }), false);
  });

  it('returns false when schemaVersion is less than SCHEMA_VERSION', () => {
    assertEqual(Schema.isFutureRecord({ schemaVersion: 0 }), false);
    assertEqual(Schema.isFutureRecord({ schemaVersion: -1 }), false);
  });

  it('returns true when schemaVersion is strictly greater', () => {
    assertEqual(Schema.isFutureRecord({ schemaVersion: 2 }), true);
    assertEqual(Schema.isFutureRecord({ schemaVersion: 100 }), true);
    // Fractional versions are unusual but valid for the comparator.
    assertEqual(Schema.isFutureRecord({ schemaVersion: 1.5 }), true);
  });

  it('returns false for non-numeric or non-finite schemaVersion', () => {
    // String '2' isn't a number per the typeof guard. Treating it as
    // future would let a corrupt or hand-edited record block every write.
    assertEqual(Schema.isFutureRecord({ schemaVersion: '2' }), false);
    assertEqual(Schema.isFutureRecord({ schemaVersion: NaN }), false);
    assertEqual(Schema.isFutureRecord({ schemaVersion: Infinity }), false);
    assertEqual(Schema.isFutureRecord({ schemaVersion: null }), false);
  });
});

describe('Schema — stamp', () => {
  it('sets schemaVersion to SCHEMA_VERSION on an unstamped record', () => {
    const r = { id: 'x', name: 'foo' };
    const out = Schema.stamp(r);
    assertEqual(out.schemaVersion, 1);
    // Returns the same reference for chaining.
    assert(out === r, 'stamp returns the same object reference');
  });

  it('is idempotent on a v1 record', () => {
    const r = { schemaVersion: 1, id: 'x' };
    Schema.stamp(r);
    assertEqual(r.schemaVersion, 1);
    Schema.stamp(r);
    assertEqual(r.schemaVersion, 1);
  });

  it('does NOT downgrade a future record', () => {
    // Defense-in-depth. Call sites are supposed to gate on isFutureRecord
    // before stamping, but if a stray stamp() reaches a future record it
    // must leave the version intact — otherwise the writeback gate's
    // protection has a hole.
    const r = { schemaVersion: 2, id: 'x' };
    Schema.stamp(r);
    assertEqual(r.schemaVersion, 2);
  });

  it('returns null / non-object values unmodified', () => {
    assertEqual(Schema.stamp(null), null);
    assertEqual(Schema.stamp(undefined), undefined);
    assertEqual(Schema.stamp('not-an-object'), 'not-an-object');
    assertEqual(Schema.stamp(42), 42);
  });

  it('preserves unrelated fields on the record', () => {
    const r = { id: 'x', name: 'foo', nested: { a: 1 }, arr: [1, 2, 3] };
    Schema.stamp(r);
    assertEqual(r.id, 'x');
    assertEqual(r.name, 'foo');
    assertEqual(r.nested.a, 1);
    assertEqual(r.arr.length, 3);
    assertEqual(r.schemaVersion, 1);
  });
});
