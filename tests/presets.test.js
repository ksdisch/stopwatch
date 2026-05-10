// F19b __forward passthrough — preset store.
//
// Unlike meds (which has a structured in-memory model that explicitly
// names every loaded field), the preset store reads raw arrays from
// localStorage and writes raw arrays back. Unknown top-level fields
// already pass through every code path naturally:
//
//   - getAll() → JSON.parse — no field filtering
//   - save(p) → presets.push(p); saveAll(presets) — pushes the caller's
//     object verbatim
//   - update(id, changes) → Object.assign(presets[idx], changes) —
//     merges changes into the existing record, preserving other fields
//   - remove(id) → filter by id — siblings keep all their fields
//   - saveAll(presets) → JSON.stringify the whole array
//
// This test file locks that behavior in so a future refactor (e.g. moving
// presets to per-record storage like F18 did for meds) can't silently
// regress unknown-field preservation. Narrow scope, mirrors the F20
// tests/flow.test.js precedent — no other engine tests for presets exist
// on main.

describe('Presets — F19b __forward passthrough', () => {
  function snapshotPresetsKey() {
    return [
      localStorage.getItem('quick_presets'),
      localStorage.getItem('presets_seeded'),
    ];
  }
  function clearPresetsKey() {
    localStorage.removeItem('quick_presets');
    localStorage.removeItem('presets_seeded');
  }
  function restorePresetsKey(snapshot) {
    const [presets, seeded] = snapshot;
    if (presets !== null) localStorage.setItem('quick_presets', presets);
    if (seeded !== null) localStorage.setItem('presets_seeded', seeded);
  }

  it('save() preserves unknown top-level fields on the new preset', () => {
    const snapshot = snapshotPresetsKey();
    clearPresetsKey();
    try {
      Presets.save({
        id: 'fp-save',
        name: 'WithFuture',
        icon: '⏱️',
        mode: 'timer',
        config: { durationMs: 5000 },
        createdAt: 1700000000000,
        futureField: 'should-survive',
        anotherUnknown: { nested: 42, list: [1, 2] },
      });
      const all = Presets.getAll();
      const saved = all.find(p => p.id === 'fp-save');
      assert(saved !== undefined, 'preset saved');
      assertEqual(saved.futureField, 'should-survive');
      assertEqual(saved.anotherUnknown.nested, 42);
      assertEqual(saved.anotherUnknown.list.length, 2);
      // F19a stamp must also be present (the storage path goes through
      // Schema.stamp). Belt-and-suspenders against a regression.
      assertEqual(saved.schemaVersion, 1);
    } finally {
      clearPresetsKey();
      restorePresetsKey(snapshot);
    }
  });

  it('update() preserves unknown fields on the existing record', () => {
    const snapshot = snapshotPresetsKey();
    clearPresetsKey();
    try {
      // Plant a preset with an unknown field directly so we exercise
      // update against existing on-disk state (not just save's path).
      localStorage.setItem('quick_presets', JSON.stringify([{
        id: 'fp-upd',
        name: 'Original',
        icon: '⏱️',
        mode: 'timer',
        config: { durationMs: 1000 },
        createdAt: 0,
        schemaVersion: 1,
        futureField: 'must-survive',
      }]));

      Presets.update('fp-upd', { name: 'Updated', config: { durationMs: 2000 } });

      const updated = Presets.getAll().find(p => p.id === 'fp-upd');
      assertEqual(updated.name, 'Updated');
      assertEqual(updated.config.durationMs, 2000);
      assertEqual(updated.futureField, 'must-survive');
    } finally {
      clearPresetsKey();
      restorePresetsKey(snapshot);
    }
  });

  it('remove() does not strip unknown fields from sibling presets', () => {
    const snapshot = snapshotPresetsKey();
    clearPresetsKey();
    try {
      localStorage.setItem('quick_presets', JSON.stringify([
        { id: 'a', name: 'A', mode: 'timer', config: {}, createdAt: 0,
          schemaVersion: 1, futureA: 'a-only' },
        { id: 'b', name: 'B', mode: 'timer', config: {}, createdAt: 1,
          schemaVersion: 1, futureB: 'b-only' },
        { id: 'c', name: 'C', mode: 'timer', config: {}, createdAt: 2,
          schemaVersion: 1, futureC: 'c-only' },
      ]));

      Presets.remove('b');

      const remaining = Presets.getAll();
      assertEqual(remaining.length, 2);
      const a = remaining.find(p => p.id === 'a');
      const c = remaining.find(p => p.id === 'c');
      assertEqual(a.futureA, 'a-only');
      assertEqual(c.futureC, 'c-only');
      assert(remaining.find(p => p.id === 'b') === undefined, 'b removed');
    } finally {
      clearPresetsKey();
      restorePresetsKey(snapshot);
    }
  });

  it('getAll() passes through unknown top-level fields from raw storage', () => {
    const snapshot = snapshotPresetsKey();
    clearPresetsKey();
    try {
      // The most basic test — raw on-disk → in-memory array must
      // include every field present in the stringified blob.
      localStorage.setItem('quick_presets', JSON.stringify([{
        id: 'fp-raw',
        name: 'Raw',
        mode: 'stopwatch',
        config: {},
        createdAt: 0,
        schemaVersion: 1,
        unknownString: 'x',
        unknownNumber: 7,
        unknownNested: { deep: { deeper: 'value' } },
      }]));

      const got = Presets.getAll().find(p => p.id === 'fp-raw');
      assert(got !== undefined, 'preset loaded');
      assertEqual(got.unknownString, 'x');
      assertEqual(got.unknownNumber, 7);
      assertEqual(got.unknownNested.deep.deeper, 'value');
    } finally {
      clearPresetsKey();
      restorePresetsKey(snapshot);
    }
  });

  it('F19a + F19b interaction: future-schema preset is read-only AND keeps unknown fields on disk', () => {
    // Mixed-rule test — a preset minted on a newer schema (schemaVersion > 1)
    // must survive update() refusal (F19a) AND its unknown fields stay
    // on disk untouched. Crucially the future record is the FIRST entry
    // here so any code that filters/rewrites the whole array gets stressed.
    const snapshot = snapshotPresetsKey();
    clearPresetsKey();
    try {
      localStorage.setItem('quick_presets', JSON.stringify([
        { id: 'fp-future', name: 'Future', mode: 'timer', config: {}, createdAt: 0,
          schemaVersion: 2, futureField: 'precious' },
        { id: 'fp-normal', name: 'Normal', mode: 'timer', config: {}, createdAt: 1,
          schemaVersion: 1 },
      ]));

      // F19a: update on future record is a silent no-op.
      Presets.update('fp-future', { name: 'Renamed' });
      const after = Presets.getAll();
      const future = after.find(p => p.id === 'fp-future');
      assertEqual(future.name, 'Future');             // not 'Renamed'
      assertEqual(future.schemaVersion, 2);
      assertEqual(future.futureField, 'precious');     // F19b passthrough

      // F19a: remove on future record is a silent no-op too.
      Presets.remove('fp-future');
      const stillThere = Presets.getAll().find(p => p.id === 'fp-future');
      assert(stillThere !== undefined, 'future preset survived remove()');
      assertEqual(stillThere.futureField, 'precious');
    } finally {
      clearPresetsKey();
      restorePresetsKey(snapshot);
    }
  });
});
