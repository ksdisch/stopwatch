// R9 — BgNotifyStore: durable notification persistence + rearm planning.
//
// The service worker's in-memory `pendingNotifications` Map (sw.js) dies with
// SW eviction, so a notification scheduled minutes out is silently lost. This
// module is the durable backbone of the fix: a pure `plan()` (which persisted
// records are overdue vs. still upcoming) plus IndexedDB CRUD on a dedicated
// `tempo_notify_db`. It touches only `indexedDB`/`self`, so it loads in BOTH
// the page (these engine tests, via <script>) and the SW (sw.js, via
// importScripts) from the same bytes.
//
// Test-scope note: every top-level identifier is `_bns_`-prefixed because the
// harness evaluates all test files in one shared global scope.

const _bns_DB_NAME = 'tempo_notify_db';

// Wipe the DB between async cases so each `it()` starts empty. The module
// caches its connection with an onversionchange handler that closes + drops
// the cache when a concurrent deleteDatabase fires, so this is sufficient.
async function _bns_resetDb() {
  return new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.deleteDatabase(_bns_DB_NAME);
    } catch (_) {
      resolve();
      return;
    }
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

// ── plan() — pure overdue/upcoming split ──────────────────────────────────

describe('BgNotifyStore.plan — overdue vs upcoming split', () => {

  it('empty / nullish records → { fire:[], arm:[] }', () => {
    const a = BgNotifyStore.plan([], 1000);
    assertEqual(a.fire.length, 0, 'empty → no fire');
    assertEqual(a.arm.length, 0, 'empty → no arm');
    const b = BgNotifyStore.plan(null, 1000);
    assertEqual(b.fire.length, 0, 'null → no fire');
    assertEqual(b.arm.length, 0, 'null → no arm');
  });

  it('a record whose fireAt is in the past goes to fire', () => {
    const rec = { id: 'a', fireAt: 500, title: 'T', body: 'B' };
    const { fire, arm } = BgNotifyStore.plan([rec], 1000);
    assertEqual(fire.length, 1, 'one overdue fires');
    assertEqual(fire[0].id, 'a', 'the overdue record is returned intact');
    assertEqual(arm.length, 0, 'nothing armed');
  });

  it('fireAt exactly === now counts as overdue (fires)', () => {
    const { fire, arm } = BgNotifyStore.plan([{ id: 'a', fireAt: 1000 }], 1000);
    assertEqual(fire.length, 1, 'boundary (fireAt===now) fires');
    assertEqual(arm.length, 0, 'nothing armed at the boundary');
  });

  it('a future record is armed with the remaining delay', () => {
    const { fire, arm } = BgNotifyStore.plan([{ id: 'a', fireAt: 1500 }], 1000);
    assertEqual(fire.length, 0, 'nothing overdue');
    assertEqual(arm.length, 1, 'one armed');
    assertEqual(arm[0].record.id, 'a', 'armed record is returned');
    assertEqual(arm[0].delayMs, 500, 'delayMs = fireAt - now');
  });

  it('a malformed fireAt (missing / non-numeric) fires so a reminder is never lost', () => {
    const { fire, arm } = BgNotifyStore.plan(
      [{ id: 'a' }, { id: 'b', fireAt: 'not-a-number' }],
      1000
    );
    assertEqual(fire.length, 2, 'both malformed records fall to the fire bucket');
    assertEqual(arm.length, 0, 'nothing armed with a bad timestamp');
  });

  it('null entries in the array are skipped', () => {
    const { fire, arm } = BgNotifyStore.plan([null, { id: 'a', fireAt: 2000 }], 1000);
    assertEqual(fire.length, 0, 'null entry does not fire');
    assertEqual(arm.length, 1, 'only the real record is armed');
    assertEqual(arm[0].record.id, 'a');
  });

  it('a mixed batch splits correctly and preserves every record', () => {
    const recs = [
      { id: 'past', fireAt: 200 },
      { id: 'future', fireAt: 5000 },
      { id: 'now', fireAt: 1000 },
    ];
    const { fire, arm } = BgNotifyStore.plan(recs, 1000);
    const fireIds = fire.map((r) => r.id).sort();
    assertArrayEqual(fireIds, ['now', 'past'], 'past + boundary fire');
    assertEqual(arm.length, 1, 'only the future record is armed');
    assertEqual(arm[0].record.id, 'future');
    assertEqual(arm[0].delayMs, 4000, 'future delay = 5000 - 1000');
  });

});

// ── IndexedDB persistence (tempo_notify_db) ───────────────────────────────

describe('BgNotifyStore — IndexedDB persistence (tempo_notify_db)', () => {

  it('put then all returns the persisted record verbatim', async () => {
    try {
      await _bns_resetDb();
      await BgNotifyStore.put({ id: 'p1', fireAt: 1234, title: 'T', body: 'B' });
      const all = await BgNotifyStore.all();
      assertEqual(all.length, 1, 'one record persisted');
      assertEqual(all[0].id, 'p1', 'id round-trips');
      assertEqual(all[0].fireAt, 1234, 'fireAt round-trips');
      assertEqual(all[0].title, 'T', 'title round-trips');
      assertEqual(all[0].body, 'B', 'body round-trips');
    } finally {
      await _bns_resetDb();
    }
  });

  it('put with an existing id replaces (keyPath id) — no duplicate', async () => {
    try {
      await _bns_resetDb();
      await BgNotifyStore.put({ id: 'dup', fireAt: 100, title: 'first' });
      await BgNotifyStore.put({ id: 'dup', fireAt: 900, title: 'second' });
      const all = await BgNotifyStore.all();
      assertEqual(all.length, 1, 'same id overwrites — replace semantics');
      assertEqual(all[0].fireAt, 900, 'latest fireAt wins');
      assertEqual(all[0].title, 'second', 'latest title wins');
    } finally {
      await _bns_resetDb();
    }
  });

  it('remove deletes a persisted record by id, leaving the rest', async () => {
    try {
      await _bns_resetDb();
      await BgNotifyStore.put({ id: 'x', fireAt: 1 });
      await BgNotifyStore.put({ id: 'y', fireAt: 2 });
      await BgNotifyStore.remove('x');
      const all = await BgNotifyStore.all();
      assertEqual(all.length, 1, 'one record left after remove');
      assertEqual(all[0].id, 'y', 'the untouched record remains');
    } finally {
      await _bns_resetDb();
    }
  });

  it('all on an empty store returns []', async () => {
    try {
      await _bns_resetDb();
      const all = await BgNotifyStore.all();
      assertEqual(all.length, 0, 'empty store → empty array');
    } finally {
      await _bns_resetDb();
    }
  });

  it('remove on a missing id is a no-op (does not throw)', async () => {
    try {
      await _bns_resetDb();
      await BgNotifyStore.put({ id: 'keep', fireAt: 1 });
      await BgNotifyStore.remove('nonexistent');
      const all = await BgNotifyStore.all();
      assertEqual(all.length, 1, 'still one record after removing a missing id');
      assertEqual(all[0].id, 'keep');
    } finally {
      await _bns_resetDb();
    }
  });

});
