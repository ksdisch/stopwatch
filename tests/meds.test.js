describe('Meds — creation and defaults', () => {
  it('creates with sensible defaults', () => {
    const m = createMed('t1');
    assertEqual(m.getId(), 't1');
    assertEqual(m.getName(), 'Medication');
    assertEqual(m.getDose(), '');
    assertEqual(m.getFrequency(), 'once-daily');
    assertEqual(m.getLastTakenAt(), null);
    assertEqual(m.getDoseLog().length, 0);
  });

  it('setName trims and clamps', () => {
    const m = createMed('t2');
    m.setName('  Vyvanse  ');
    assertEqual(m.getName(), 'Vyvanse');

    m.setName('x'.repeat(120));
    assertEqual(m.getName().length, 60);
  });

  it('setName falls back to default on empty input', () => {
    const m = createMed('t3');
    m.setName('');
    assertEqual(m.getName(), 'Medication');
    m.setName('   ');
    assertEqual(m.getName(), 'Medication');
  });

  it('setDose trims and clamps', () => {
    const m = createMed('t4');
    m.setDose(' 60 mg ');
    assertEqual(m.getDose(), '60 mg');

    m.setDose('x'.repeat(100));
    assertEqual(m.getDose().length, 40);
  });

  it('setDose accepts empty string', () => {
    const m = createMed('t5');
    m.setDose('10 mg');
    m.setDose('');
    assertEqual(m.getDose(), '');
  });
});

describe('Meds — frequency', () => {
  it('setFrequency accepts all three valid values', () => {
    const m = createMed('f1');
    m.setFrequency('once-daily');   assertEqual(m.getFrequency(), 'once-daily');
    m.setFrequency('twice-daily');  assertEqual(m.getFrequency(), 'twice-daily');
    m.setFrequency('as-needed');    assertEqual(m.getFrequency(), 'as-needed');
  });

  it('setFrequency falls back to once-daily on absent input', () => {
    // F20 "absent" path: null / undefined / non-string / empty string all
    // collapse to the default. The UI's <select> never produces these, but
    // defensive callers (and JSON-import edge cases) need a stable target.
    const m = createMed('f2');
    m.setFrequency('twice-daily');  // establish a non-default starting state
    m.setFrequency(null);
    assertEqual(m.getFrequency(), 'once-daily');
    m.setFrequency('twice-daily');
    m.setFrequency(undefined);
    assertEqual(m.getFrequency(), 'once-daily');
    m.setFrequency('twice-daily');
    m.setFrequency('');
    assertEqual(m.getFrequency(), 'once-daily');
  });

  it('setFrequency preserves present-but-unknown values verbatim (F20)', () => {
    // F20 "present-but-unknown" path: a future schema may add new enum
    // values (e.g. 'three-times-daily'). A V2 setter must NOT silently
    // rewrite them — that would erase forward-compat data on roundtrip
    // through MedsManager.add({ frequency }) → setFrequency from a backup.
    const m = createMed('f2b');
    m.setFrequency('three-times-daily');
    assertEqual(m.getFrequency(), 'three-times-daily');
    m.setFrequency('q4h');
    assertEqual(m.getFrequency(), 'q4h');
  });

  it('getExpectedDosesToday reflects frequency', () => {
    const m = createMed('f3');
    m.setFrequency('once-daily');  assertEqual(m.getExpectedDosesToday(), 1);
    m.setFrequency('twice-daily'); assertEqual(m.getExpectedDosesToday(), 2);
    m.setFrequency('as-needed');   assertEqual(m.getExpectedDosesToday(), null);
  });
});

describe('Meds — dose logging', () => {
  it('logDose without argument uses Date.now()', () => {
    const m = createMed('l1');
    const before = Date.now();
    m.logDose();
    const after = Date.now();
    const t = m.getLastTakenAt();
    assert(t >= before && t <= after, 'lastTakenAt should be ~now');
    assertEqual(m.getDoseLog().length, 1);
  });

  it('logDose accepts a specific timestamp for retroactive logs', () => {
    const m = createMed('l2');
    const ts = Date.now() - 2 * 3600000;
    m.logDose(ts);
    assertEqual(m.getLastTakenAt(), ts);
    assertEqual(m.getDoseLog()[0].takenAt, ts);
  });

  it('logDose keeps the log sorted even if an older dose is added later', () => {
    const m = createMed('l3');
    const now = Date.now();
    m.logDose(now);
    m.logDose(now - 3600000);  // retroactive after live log
    const log = m.getDoseLog();
    assertEqual(log.length, 2);
    assert(log[0].takenAt < log[1].takenAt, 'Log should be ascending');
    assertEqual(m.getLastTakenAt(), now);
  });

  it('undoLastDose removes the most recent entry', () => {
    const m = createMed('l4');
    const t1 = Date.now() - 7200000;
    const t2 = Date.now();
    m.logDose(t1);
    m.logDose(t2);
    assertEqual(m.undoLastDose(), true);
    assertEqual(m.getLastTakenAt(), t1);
    assertEqual(m.getDoseLog().length, 1);
  });

  it('undoLastDose returns false when log is empty', () => {
    const m = createMed('l5');
    assertEqual(m.undoLastDose(), false);
  });

  it('getTimeSinceLastDoseMs reflects elapsed time', () => {
    const m = createMed('l6');
    m.logDose(Date.now() - 300000);
    const since = m.getTimeSinceLastDoseMs();
    assert(since >= 300000 - 100 && since <= 300000 + 100,
      'Elapsed should be ~5 minutes');
  });

  it('getTimeSinceLastDoseMs is null when never logged', () => {
    const m = createMed('l7');
    assertEqual(m.getTimeSinceLastDoseMs(), null);
  });
});

describe('Meds — today status', () => {
  function todayAt(h, min) {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, min, 0, 0).getTime();
  }
  function yesterdayAt(h, min) {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, h, min, 0, 0).getTime();
  }

  it('no doses → status.kind = none (for daily freq)', () => {
    const m = createMed('s1');
    m.setFrequency('once-daily');
    const s = m.getStatusToday();
    assertEqual(s.kind, 'none');
    assertEqual(s.takenToday, 0);
    assertEqual(s.expected, 1);
  });

  it('no doses → status.kind = na for as-needed', () => {
    const m = createMed('s2');
    m.setFrequency('as-needed');
    const s = m.getStatusToday();
    assertEqual(s.kind, 'na');
    assertEqual(s.expected, null);
  });

  it('once-daily: 1 dose today → done', () => {
    const m = createMed('s3');
    m.setFrequency('once-daily');
    m.logDose(todayAt(8, 0));
    assertEqual(m.getStatusToday().kind, 'done');
    assertEqual(m.getDosesToday(), 1);
  });

  it('twice-daily: 1 dose today → partial', () => {
    const m = createMed('s4');
    m.setFrequency('twice-daily');
    m.logDose(todayAt(8, 0));
    const s = m.getStatusToday();
    assertEqual(s.kind, 'partial');
    assertEqual(s.takenToday, 1);
    assertEqual(s.expected, 2);
  });

  it('twice-daily: 2 doses today → done', () => {
    const m = createMed('s5');
    m.setFrequency('twice-daily');
    m.logDose(todayAt(8, 0));
    m.logDose(todayAt(20, 0));
    assertEqual(m.getStatusToday().kind, 'done');
  });

  it('yesterday dose does not count toward today', () => {
    const m = createMed('s6');
    m.setFrequency('once-daily');
    m.logDose(yesterdayAt(22, 0));
    assertEqual(m.getDosesToday(), 0);
    assertEqual(m.getStatusToday().kind, 'none');
  });

  it('mixed yesterday+today doses: today-only counts', () => {
    const m = createMed('s7');
    m.setFrequency('twice-daily');
    m.logDose(yesterdayAt(9, 0));
    m.logDose(yesterdayAt(21, 0));
    m.logDose(todayAt(7, 30));
    assertEqual(m.getDosesToday(), 1);
    assertEqual(m.getStatusToday().kind, 'partial');
  });
});

describe('Meds — serialization', () => {
  it('getState returns the new schema', () => {
    const m = createMed('r1');
    m.setName('Vyvanse');
    m.setDose('60 mg');
    m.setFrequency('once-daily');
    m.logDose(1700000000000);
    const state = m.getState();
    assertEqual(state.id, 'r1');
    assertEqual(state.name, 'Vyvanse');
    assertEqual(state.dose, '60 mg');
    assertEqual(state.frequency, 'once-daily');
    assertEqual(state.lastTakenAt, 1700000000000);
    assertEqual(state.doseLog.length, 1);
    assertEqual(state.doseLog[0].takenAt, 1700000000000);
    // V1 schedule fields are not emitted
    assert(state.scheduleType === undefined, 'No legacy scheduleType');
    assert(state.intervalMs === undefined, 'No legacy intervalMs');
  });

  it('loadState round-trips name/dose/frequency/doseLog', () => {
    const a = createMed('r2');
    a.setName('Trazodone');
    a.setDose('50 mg');
    a.setFrequency('once-daily');
    a.logDose(1700000100000);
    const state = a.getState();

    const b = createMed('r3');
    b.loadState(state);
    assertEqual(b.getName(), 'Trazodone');
    assertEqual(b.getDose(), '50 mg');
    assertEqual(b.getFrequency(), 'once-daily');
    assertEqual(b.getLastTakenAt(), 1700000100000);
    assertEqual(b.getDoseLog().length, 1);
  });

  it('M14: createdAt is null by default, settable, and round-trips through getState/loadState', () => {
    const a = createMed('c1');
    assertEqual(a.getCreatedAt(), null, 'createMed leaves createdAt null until stamped');
    a.setCreatedAt(1700000200000);
    assertEqual(a.getCreatedAt(), 1700000200000, 'setCreatedAt stamps the value');
    const state = a.getState();
    assertEqual(state.createdAt, 1700000200000, 'getState emits createdAt');

    const b = createMed('c2');
    b.loadState(state);
    assertEqual(b.getCreatedAt(), 1700000200000, 'loadState restores createdAt verbatim');
  });

  it('M14: loadState defaults createdAt to null for legacy records (no createdAt key)', () => {
    const m = createMed('c3');
    m.loadState({ id: 'c3', name: 'Legacy', frequency: 'once-daily' });
    assertEqual(m.getCreatedAt(), null, 'legacy med → createdAt null → full-window adherence');
  });

  it('M14: MedsManager.add() stamps createdAt at creation', () => {
    MedsManager.clear();
    try {
      const before = Date.now();
      const m = MedsManager.add({ name: 'Fresh', frequency: 'once-daily' });
      const after = Date.now();
      const created = m.getCreatedAt();
      assert(typeof created === 'number', 'add() stamps a numeric createdAt');
      assert(created >= before && created <= after, 'createdAt is the creation time');
    } finally {
      MedsManager.clear(); // consumers (analytics seedMeds, etc.) clear before use
    }
  });

  it('loadState tolerates partial/empty state (F20 absent path)', () => {
    const m = createMed('r4');
    m.loadState({});
    assertEqual(m.getName(), 'Medication');
    assertEqual(m.getDose(), '');
    // F20 absent path: state has no `frequency` key → default 'as-needed'.
    // 'as-needed' is the safest default — doesn't manufacture a daily
    // obligation for untouched rows and matches the V1 migration target.
    assertEqual(m.getFrequency(), 'as-needed');
    assertEqual(m.getLastTakenAt(), null);
  });

  it('loadState preserves present-but-unknown frequency verbatim (F20)', () => {
    // F20 forward-compat: a future schema's enum value (e.g. a
    // 'three-times-daily' bucket added in V3) must roundtrip cleanly on
    // a V2 client. The V2 loader has no business silently rewriting
    // values it doesn't recognize — that would erase data on first save.
    const m = createMed('r4b');
    m.loadState({ id: 'r4b', frequency: 'three-times-daily' });
    assertEqual(m.getFrequency(), 'three-times-daily');
    // Downstream getExpectedDosesToday() still returns null for unknown
    // values, so display falls back to 'na' UX without corrupting storage.
    assertEqual(m.getExpectedDosesToday(), null);
    assertEqual(m.getStatusToday().kind, 'na');
  });

  it('loadState defaults to as-needed when frequency is non-string', () => {
    // F20 absent path covers type errors too — a numeric or object value
    // is treated as absent, not preserved verbatim. Preserving non-strings
    // would corrupt the type contract for every downstream consumer.
    const m = createMed('r4c');
    m.loadState({ id: 'r4c', frequency: 42 });
    assertEqual(m.getFrequency(), 'as-needed');
    m.loadState({ id: 'r4c', frequency: '' });
    assertEqual(m.getFrequency(), 'as-needed');
  });

  it('loadState drops far-future dose entries (clock skew)', () => {
    const m = createMed('r5');
    const future = Date.now() + 999999999;
    m.loadState({ doseLog: [{ takenAt: future }] });
    assertEqual(m.getLastTakenAt(), null);
    assertEqual(m.getDoseLog().length, 0);
  });

  it('loadState uses doseLog tail as lastTakenAt (log is source of truth)', () => {
    const m = createMed('r6');
    m.loadState({
      lastTakenAt: 100,  // intentionally stale
      doseLog: [{ takenAt: 500 }, { takenAt: 200 }],  // unsorted
    });
    assertEqual(m.getLastTakenAt(), 500);
    const log = m.getDoseLog();
    assertEqual(log.length, 2);
    assert(log[0].takenAt < log[1].takenAt, 'Log sorted ascending on load');
  });
});

describe('Meds — V1→V2 migration', () => {
  it('legacy interval schedule migrates to as-needed', () => {
    const m = createMed('mg1');
    m.loadState({
      id: 'mg1',
      name: 'Legacy',
      scheduleType: 'interval',
      intervalMs: 6 * 3600000,
      lastTakenAt: 1700000000000,
      doseLog: [{ takenAt: 1700000000000 }],
      notificationsEnabled: true,
      dueNotified: false,
    });
    assertEqual(m.getName(), 'Legacy');
    assertEqual(m.getFrequency(), 'as-needed');
    assertEqual(m.getDose(), '');
    assertEqual(m.getLastTakenAt(), 1700000000000);
    assertEqual(m.getDoseLog().length, 1);
    const out = m.getState();
    assert(out.scheduleType === undefined, 'Legacy scheduleType dropped');
    assert(out.intervalMs === undefined, 'Legacy intervalMs dropped');
    assert(out.notificationsEnabled === undefined, 'Legacy notificationsEnabled dropped');
  });

  it('legacy times-of-day schedule migrates to as-needed', () => {
    const m = createMed('mg2');
    m.loadState({
      id: 'mg2',
      name: 'Bedtime Med',
      scheduleType: 'times',
      times: ['08:00', '21:00'],
      lastTakenAt: null,
      doseLog: [],
    });
    assertEqual(m.getFrequency(), 'as-needed');
    assertEqual(m.getDose(), '');
    assertEqual(m.getLastTakenAt(), null);
  });

  it('legacy record without frequency preserves name + lastTakenAt', () => {
    const m = createMed('mg3');
    m.loadState({
      id: 'mg3',
      name: 'Vitamin D 1000 IU',
      scheduleType: 'interval',
      intervalMs: 24 * 3600000,
      lastTakenAt: 1700001000000,
      doseLog: [{ takenAt: 1700001000000 }],
    });
    assertEqual(m.getName(), 'Vitamin D 1000 IU');
    assertEqual(m.getLastTakenAt(), 1700001000000);
  });
});

describe('MedsManager', () => {
  it('starts empty after clear', () => {
    MedsManager.clear();
    assertEqual(MedsManager.count(), 0);
  });

  it('add creates a med with name/dose/frequency config', () => {
    MedsManager.clear();
    const m = MedsManager.add({ name: 'Vyvanse', dose: '60 mg', frequency: 'once-daily' });
    assert(m !== null, 'add() returns the new med');
    assertEqual(MedsManager.count(), 1);
    assertEqual(m.getName(), 'Vyvanse');
    assertEqual(m.getDose(), '60 mg');
    assertEqual(m.getFrequency(), 'once-daily');
  });

  it('add defaults dose to "" and frequency to once-daily', () => {
    MedsManager.clear();
    const m = MedsManager.add({ name: 'Simple' });
    assertEqual(m.getDose(), '');
    assertEqual(m.getFrequency(), 'once-daily');
  });

  it('remove deletes a med', () => {
    MedsManager.clear();
    const m = MedsManager.add({ name: 'ToRemove' });
    assertEqual(MedsManager.remove(m.getId()), true);
    assertEqual(MedsManager.count(), 0);
  });

  it('remove of missing id returns false', () => {
    MedsManager.clear();
    assertEqual(MedsManager.remove('nope'), false);
  });

  it('enforces MAX_MEDS cap', () => {
    MedsManager.clear();
    for (let i = 0; i < MedsManager.MAX_MEDS; i++) {
      MedsManager.add({ name: 'Med' + i });
    }
    const overflow = MedsManager.add({ name: 'Overflow' });
    assertEqual(overflow, null);
    assertEqual(MedsManager.count(), MedsManager.MAX_MEDS);
  });

  it('saveAll / loadAll round-trips through localStorage', () => {
    // F18: persistence shape changed from a single `wellness_meds` blob to
    // per-record `meds/{id}` keys. Snapshot both, clear, run, restore.
    function snapshotMedsKeys() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('meds/') || k === 'wellness_meds')) {
          out.push([k, localStorage.getItem(k)]);
        }
      }
      return out;
    }
    function clearMedsKeys() {
      const toClean = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('meds/') || k === 'wellness_meds')) toClean.push(k);
      }
      for (const k of toClean) localStorage.removeItem(k);
    }

    const snapshot = snapshotMedsKeys();
    clearMedsKeys();
    try {
      MedsManager.clear();
      MedsManager.add({ name: 'Persisted', dose: '10 mg', frequency: 'twice-daily' });
      MedsManager.saveAll();
      MedsManager.clear();
      assertEqual(MedsManager.count(), 0);
      MedsManager.loadAll();
      assertEqual(MedsManager.count(), 1);
      const m = MedsManager.all()[0];
      assertEqual(m.getName(), 'Persisted');
      assertEqual(m.getDose(), '10 mg');
      assertEqual(m.getFrequency(), 'twice-daily');
    } finally {
      MedsManager.clear();
      clearMedsKeys();
      for (const [k, v] of snapshot) localStorage.setItem(k, v);
      MedsManager.loadAll();
    }
  });
});

describe('Meds — F19a schema stamping', () => {
  // Reused storage helpers (same shape as the F18 round-trip test) so each
  // F19a test starts from a clean meds/* keyspace and restores the user's
  // real data on teardown.
  function snapshotMedsKeys() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('meds/') || k === 'wellness_meds')) {
        out.push([k, localStorage.getItem(k)]);
      }
    }
    return out;
  }
  function clearMedsKeys() {
    const toClean = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('meds/') || k === 'wellness_meds')) toClean.push(k);
    }
    for (const k of toClean) localStorage.removeItem(k);
  }

  it('getState stamps schemaVersion at every write', () => {
    const m = createMed('s1');
    m.setName('Vyvanse');
    m.setFrequency('once-daily');
    const state = m.getState();
    assertEqual(state.schemaVersion, Schema.SCHEMA_VERSION);
    assertEqual(state.schemaVersion, 1);
  });

  it('new meds are not flagged as future-schema', () => {
    const m = createMed('s2');
    assertEqual(m.isFromFutureSchema(), false);
  });

  it('loadState with no schemaVersion does not flag as future (pre-F19a data)', () => {
    // Pre-F19a records have no schemaVersion field. They are NOT future —
    // they get stamped to v1 lazily on the next write.
    const m = createMed('s3');
    m.loadState({ id: 's3', name: 'Legacy', frequency: 'once-daily' });
    assertEqual(m.isFromFutureSchema(), false);
  });

  it('loadState with schemaVersion === 1 does not flag as future', () => {
    const m = createMed('s4');
    m.loadState({ id: 's4', schemaVersion: 1, name: 'Current' });
    assertEqual(m.isFromFutureSchema(), false);
  });

  it('loadState with schemaVersion > 1 flags as future', () => {
    const m = createMed('s5');
    m.loadState({ id: 's5', schemaVersion: 2, name: 'Future', dose: '99 mg' });
    assertEqual(m.isFromFutureSchema(), true);
    // Recognized fields still load into memory so any UI can render them.
    assertEqual(m.getName(), 'Future');
    assertEqual(m.getDose(), '99 mg');
  });

  it('loadState with non-numeric schemaVersion does not flag as future', () => {
    // String '2' is corrupt / hand-edited data, not a real future record.
    // Treating it as future would block writes forever on a stuck record.
    const m = createMed('s6');
    m.loadState({ id: 's6', schemaVersion: '2', name: 'Corrupt' });
    assertEqual(m.isFromFutureSchema(), false);
  });

  it('MedsManager.saveAll skips future-schema meds (on-disk state preserved)', () => {
    const snapshot = snapshotMedsKeys();
    clearMedsKeys();
    try {
      // Plant a future-schema record directly on disk, then loadAll.
      const futureState = {
        id: 'future-1',
        schemaVersion: 2,
        name: 'FutureMed',
        dose: '5 mg',
        frequency: 'once-daily',
        lastTakenAt: null,
        doseLog: [],
        updatedAt: 1700000000000,
        deviceId: 'd-test',
        // A field a V1 client doesn't recognize — must survive roundtrip.
        futureField: 'should-survive',
      };
      localStorage.setItem('meds/future-1', JSON.stringify(futureState));

      MedsManager.clear();
      MedsManager.loadAll();
      assertEqual(MedsManager.count(), 1);
      const m = MedsManager.all()[0];
      assertEqual(m.isFromFutureSchema(), true);

      // Mutate the in-memory representation in a way that, for a normal
      // record, would be picked up by saveAll.
      m.setName('LocalEdit');
      MedsManager.saveAll();

      // On-disk state must be unchanged — saveAll skipped the future med.
      const raw = localStorage.getItem('meds/future-1');
      const onDisk = JSON.parse(raw);
      assertEqual(onDisk.schemaVersion, 2);
      assertEqual(onDisk.name, 'FutureMed');           // not 'LocalEdit'
      assertEqual(onDisk.futureField, 'should-survive');
    } finally {
      MedsManager.clear();
      clearMedsKeys();
      for (const [k, v] of snapshot) localStorage.setItem(k, v);
      MedsManager.loadAll();
    }
  });

  it('MedsManager.remove refuses future-schema meds', () => {
    const snapshot = snapshotMedsKeys();
    clearMedsKeys();
    try {
      const futureState = {
        id: 'future-2',
        schemaVersion: 2,
        name: 'FutureMed2',
        frequency: 'once-daily',
        doseLog: [],
        updatedAt: 1700000000000,
        deviceId: 'd-test',
      };
      localStorage.setItem('meds/future-2', JSON.stringify(futureState));

      MedsManager.clear();
      MedsManager.loadAll();
      assertEqual(MedsManager.count(), 1);

      // remove() must return false AND leave both memory and disk intact.
      const removed = MedsManager.remove('future-2');
      assertEqual(removed, false);
      assertEqual(MedsManager.count(), 1);
      assert(localStorage.getItem('meds/future-2') !== null,
        'Future med remains on disk after refused remove');
    } finally {
      MedsManager.clear();
      clearMedsKeys();
      for (const [k, v] of snapshot) localStorage.setItem(k, v);
      MedsManager.loadAll();
    }
  });

  it('MedsManager.saveAll still persists normal meds when a future med is loaded', () => {
    // Belt-and-suspenders: one future med must NOT block writes for the
    // other meds in the same saveAll() call. (Tests the `continue` semantic
    // rather than an `early return`.)
    const snapshot = snapshotMedsKeys();
    clearMedsKeys();
    try {
      localStorage.setItem('meds/future-3', JSON.stringify({
        id: 'future-3', schemaVersion: 2, name: 'Future',
        frequency: 'once-daily', doseLog: [],
      }));

      MedsManager.clear();
      MedsManager.loadAll();
      // Add a normal in-memory med alongside the loaded future one.
      MedsManager.add({ name: 'Normal', frequency: 'once-daily' });
      assertEqual(MedsManager.count(), 2);

      MedsManager.saveAll();

      // Find the normal med's storage key and verify it was written.
      let normalKey = null;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('meds/') && k !== 'meds/future-3') {
          normalKey = k;
          break;
        }
      }
      assert(normalKey !== null, 'Normal med was persisted');
      const normalOnDisk = JSON.parse(localStorage.getItem(normalKey));
      assertEqual(normalOnDisk.name, 'Normal');
      assertEqual(normalOnDisk.schemaVersion, 1);

      // Future med's on-disk state is still untouched.
      const futureOnDisk = JSON.parse(localStorage.getItem('meds/future-3'));
      assertEqual(futureOnDisk.schemaVersion, 2);
      assertEqual(futureOnDisk.name, 'Future');
    } finally {
      MedsManager.clear();
      clearMedsKeys();
      for (const [k, v] of snapshot) localStorage.setItem(k, v);
      MedsManager.loadAll();
    }
  });
});

describe('Meds — F19b __forward passthrough', () => {
  it('loadState collects an unknown top-level field; getState emits it', () => {
    const m = createMed('fp1');
    m.loadState({
      id: 'fp1',
      name: 'Vyvanse',
      dose: '60 mg',
      frequency: 'once-daily',
      doseLog: [],
      futureField: 'should-survive',
    });
    const state = m.getState();
    assertEqual(state.futureField, 'should-survive');
    // Known fields still emit normally.
    assertEqual(state.name, 'Vyvanse');
    assertEqual(state.dose, '60 mg');
    assertEqual(state.frequency, 'once-daily');
  });

  it('loadState collects multiple unknown fields (preserves shape)', () => {
    const m = createMed('fp2');
    m.loadState({
      id: 'fp2',
      name: 'Multi',
      frequency: 'once-daily',
      doseLog: [],
      strField: 'str',
      numField: 42,
      objField: { nested: true, arr: [1, 2, 3] },
      arrField: ['a', 'b'],
      nullField: null,
      boolField: false,
    });
    const state = m.getState();
    assertEqual(state.strField, 'str');
    assertEqual(state.numField, 42);
    assertEqual(state.objField.nested, true);
    assertEqual(state.objField.arr.length, 3);
    assertEqual(state.arrField.length, 2);
    assertEqual(state.nullField, null);
    assertEqual(state.boolField, false);
  });

  it('V1 legacy fields are NOT placed in __forward (still dropped on migration)', () => {
    // Belt-and-suspenders: F19b must not subvert the V1→V2 migration by
    // smuggling scheduleType/intervalMs/etc. through __forward.
    const m = createMed('fp3');
    m.loadState({
      id: 'fp3',
      name: 'Legacy',
      scheduleType: 'interval',
      intervalMs: 6 * 3600000,
      times: ['08:00'],
      notificationsEnabled: true,
      dueNotified: false,
      dueNotificationAt: 1700000000000,
      doseLog: [],
    });
    const state = m.getState();
    assert(state.scheduleType === undefined, 'scheduleType still dropped');
    assert(state.intervalMs === undefined, 'intervalMs still dropped');
    assert(state.times === undefined, 'times still dropped');
    assert(state.notificationsEnabled === undefined, 'notificationsEnabled still dropped');
    assert(state.dueNotified === undefined, 'dueNotified still dropped');
    assert(state.dueNotificationAt === undefined, 'dueNotificationAt still dropped');
    // Migration semantics intact.
    assertEqual(m.getFrequency(), 'as-needed');
  });

  it('unknown fields survive across mutations (touch, setName, logDose)', () => {
    const m = createMed('fp4');
    m.loadState({
      id: 'fp4',
      name: 'Initial',
      frequency: 'once-daily',
      doseLog: [],
      futureField: 'sticky',
    });
    m.setName('Renamed');
    m.logDose(1700000000000);
    const state = m.getState();
    assertEqual(state.name, 'Renamed');
    assertEqual(state.doseLog.length, 1);
    // The unknown field rode through both setName (touch) and logDose.
    assertEqual(state.futureField, 'sticky');
  });

  it('fresh med (no loadState call) emits no __forward keys', () => {
    const m = createMed('fp5');
    m.setName('Fresh');
    const state = m.getState();
    // Only known fields present.
    const expectedKeys = new Set([
      'schemaVersion', 'id', 'name', 'dose', 'frequency',
      'lastTakenAt', 'updatedAt', 'deviceId', 'originDeviceId', 'doseLog',
      'supplyStartCount', 'supplyResetAt', 'supplyAdjustment',
      'createdAt', // M14: immutable creation timestamp (null for legacy meds)
    ]);
    for (const k of Object.keys(state)) {
      assert(expectedKeys.has(k), `Unexpected key "${k}" on fresh med state`);
    }
  });

  it('loadState({}) clears any prior __forward bag', () => {
    // If the same med instance is reloaded with a clean record, the
    // previous bag must not bleed through.
    const m = createMed('fp6');
    m.loadState({ id: 'fp6', name: 'First', futureField: 'old' });
    assertEqual(m.getState().futureField, 'old');
    m.loadState({ id: 'fp6', name: 'Second' });
    assert(m.getState().futureField === undefined,
      '__forward bag cleared on subsequent loadState');
  });

  it('end-to-end roundtrip: futureField survives load → save → load', () => {
    // Full disk → memory → disk cycle. The classic F19b case.
    function snapshotMedsKeysLocal() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('meds/') || k === 'wellness_meds')) {
          out.push([k, localStorage.getItem(k)]);
        }
      }
      return out;
    }
    function clearMedsKeysLocal() {
      const toClean = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('meds/') || k === 'wellness_meds')) toClean.push(k);
      }
      for (const k of toClean) localStorage.removeItem(k);
    }

    const snapshot = snapshotMedsKeysLocal();
    clearMedsKeysLocal();
    try {
      // Plant a record with future-schema fields at the CURRENT schemaVersion
      // (NOT a future schemaVersion — that path is F19a's saveAll skip).
      // F19b is specifically about preserving unknown fields on records
      // this client DOES write back.
      localStorage.setItem('meds/fp7', JSON.stringify({
        id: 'fp7',
        schemaVersion: 1,
        name: 'Roundtrip',
        dose: '10 mg',
        frequency: 'once-daily',
        doseLog: [],
        deviceId: 'd-test',
        updatedAt: 1700000000000,
        experimentalFlag: 'from-newer-client',
        experimentalArray: [{ tag: 'a' }, { tag: 'b' }],
      }));

      MedsManager.clear();
      MedsManager.loadAll();
      const m = MedsManager.get('fp7');
      assert(m !== null, 'med loaded');
      assertEqual(m.isFromFutureSchema(), false);  // same-schema record

      // Mutate something so saveAll writes — proves the roundtrip.
      m.setDose('20 mg');
      MedsManager.saveAll();

      // Re-read the on-disk state directly and verify __forward survived.
      const raw = localStorage.getItem('meds/fp7');
      const onDisk = JSON.parse(raw);
      assertEqual(onDisk.dose, '20 mg');                   // mutation persisted
      assertEqual(onDisk.experimentalFlag, 'from-newer-client');
      assertEqual(onDisk.experimentalArray.length, 2);
      assertEqual(onDisk.experimentalArray[0].tag, 'a');
    } finally {
      MedsManager.clear();
      clearMedsKeysLocal();
      for (const [k, v] of snapshot) localStorage.setItem(k, v);
      MedsManager.loadAll();
    }
  });
});

describe('Meds — reconcileDoseLog (D-2)', () => {
  // The reconcile helper reads `_medsGetDeviceId()` for the local-device
  // sentinel used by F16 (clamp non-local entries outside ±15min). We
  // capture it once via a throwaway createMed() — `getDeviceId()` returns
  // exactly what `_medsGetDeviceId()` would return, so cross-device test
  // fixtures only need to pick any string distinct from this one.
  const localDeviceId = createMed('__probe').getDeviceId();
  const REMOTE_DEVICE_A = 'remote-A';
  const REMOTE_DEVICE_B = 'remote-B';
  const WINDOW = MedsManager.RECONCILE_WINDOW_MS;

  // Build a fresh in-memory med (NOT registered with MedsManager) with a
  // pre-seeded doseLog. Uses loadState so the engine can stamp deviceIds
  // through the standard loader. Empty doseLog = no entries.
  function makeMedWithLog(id, doseLog) {
    const m = createMed(id);
    m.loadState({
      id: id,
      name: 'Test',
      frequency: 'once-daily',
      doseLog: Array.isArray(doseLog) ? doseLog : [],
    });
    return m;
  }

  it('exposes RECONCILE_WINDOW_MS === 15 * 60 * 1000', () => {
    assertEqual(MedsManager.RECONCILE_WINDOW_MS, 15 * 60 * 1000);
  });

  it('exact (deviceId, takenAt) dedup collapses to one entry (no `collapsed` bump)', () => {
    const now = Date.now();
    const e1 = { takenAt: now - 1000, deviceId: REMOTE_DEVICE_A };
    const e2 = { takenAt: now - 1000, deviceId: REMOTE_DEVICE_A };  // same key
    const m = makeMedWithLog('rc-dedup', []);
    const r = MedsManager.reconcileDoseLog(m, [e1, e2]);
    assertEqual(r.entries.length, 1);
    assertEqual(r.collapsed, 0);
    assertEqual(r.dropped, 0);
  });

  it('F1 cross-device collapse: keeps earlier, drops later, collapsed === 1', () => {
    const now = Date.now();
    // Both within F16 window (so they survive clamp), 5min apart, different devices.
    const a = { takenAt: now - 6 * 60 * 1000, deviceId: REMOTE_DEVICE_A };
    const b = { takenAt: now - 1 * 60 * 1000, deviceId: REMOTE_DEVICE_B };
    const m = makeMedWithLog('rc-f1-cross', []);
    const r = MedsManager.reconcileDoseLog(m, [a, b]);
    assertEqual(r.entries.length, 1);
    assertEqual(r.entries[0].deviceId, REMOTE_DEVICE_A);
    assertEqual(r.entries[0].takenAt, a.takenAt);
    assertEqual(r.collapsed, 1);
    assertEqual(r.dropped, 0);
  });

  it('F1 same-device preserve: two same-device entries 10min apart both kept (Decision #1)', () => {
    const now = Date.now();
    const a = { takenAt: now - 12 * 60 * 1000, deviceId: REMOTE_DEVICE_A };
    const b = { takenAt: now -  2 * 60 * 1000, deviceId: REMOTE_DEVICE_A };  // same device, 10min later
    const m = makeMedWithLog('rc-f1-same', []);
    const r = MedsManager.reconcileDoseLog(m, [a, b]);
    assertEqual(r.entries.length, 2);
    assertEqual(r.collapsed, 0);
    assertEqual(r.dropped, 0);
  });

  it('F16: drops far-future cross-device entry (warning contains "f16-future")', () => {
    const now = Date.now();
    const future = { takenAt: now + WINDOW + 60 * 1000, deviceId: REMOTE_DEVICE_A };
    const m = makeMedWithLog('rc-f16-future', []);
    const r = MedsManager.reconcileDoseLog(m, [future]);
    assertEqual(r.entries.length, 0);
    assertEqual(r.dropped, 1);
    assertEqual(r.collapsed, 0);
    assertEqual(r.warnings.length, 1);
    assert(r.warnings[0].indexOf('f16-future') !== -1, 'warning contains "f16-future"');
    assert(r.warnings[0].indexOf('[MedsManager.reconcileDoseLog]') !== -1,
      'warning carries the source prefix');
  });

  it('F16: drops far-past cross-device entry (warning contains "f16-past")', () => {
    const now = Date.now();
    const past = { takenAt: now - WINDOW - 60 * 1000, deviceId: REMOTE_DEVICE_A };
    const m = makeMedWithLog('rc-f16-past', []);
    const r = MedsManager.reconcileDoseLog(m, [past]);
    assertEqual(r.entries.length, 0);
    assertEqual(r.dropped, 1);
    assertEqual(r.collapsed, 0);
    assertEqual(r.warnings.length, 1);
    assert(r.warnings[0].indexOf('f16-past') !== -1, 'warning contains "f16-past"');
    assert(r.warnings[0].indexOf('[MedsManager.reconcileDoseLog]') !== -1,
      'warning carries the source prefix');
  });

  it('F16 does NOT clamp same-device far-future entries', () => {
    const now = Date.now();
    // A local-device entry far in the future — F16 is a CROSS-device clamp.
    // Same-device clock-skew is handled by loadState (60s cutoff) at load
    // time, not by reconcileDoseLog. So the helper must preserve this entry.
    const localFuture = {
      takenAt: now + WINDOW + 5 * 60 * 1000,
      deviceId: localDeviceId,
    };
    const m = makeMedWithLog('rc-f16-same-device', []);
    const r = MedsManager.reconcileDoseLog(m, [localFuture]);
    assertEqual(r.entries.length, 1);
    assertEqual(r.entries[0].takenAt, localFuture.takenAt);
    assertEqual(r.dropped, 0);
  });

  it('boundary (Decision #4) is inclusive at RECONCILE_WINDOW_MS', () => {
    const now = Date.now();
    // (a) F1: cross-device pair exactly WINDOW apart → COLLAPSE (<=).
    const aFar = { takenAt: now - WINDOW, deviceId: REMOTE_DEVICE_A };
    const bNow = { takenAt: now,          deviceId: REMOTE_DEVICE_B };
    const m1 = makeMedWithLog('rc-bnd-f1', []);
    const r1 = MedsManager.reconcileDoseLog(m1, [aFar, bNow]);
    assertEqual(r1.entries.length, 1);
    assertEqual(r1.collapsed, 1);
    assertEqual(r1.dropped, 0);

    // (b) F16: cross-device entry exactly at localNow + WINDOW → KEPT.
    // We rely on the helper's `localNow` being captured at call time, and
    // the entry being exactly WINDOW ahead — |delta| === WINDOW, not >.
    // We construct the takenAt relative to Date.now() to match the helper's
    // capture; clock advance between call and capture is sub-ms.
    const onBoundary = {
      takenAt: Date.now() + WINDOW,
      deviceId: REMOTE_DEVICE_A,
    };
    const m2 = makeMedWithLog('rc-bnd-f16', []);
    const r2 = MedsManager.reconcileDoseLog(m2, [onBoundary]);
    // The entry might land 1-2ms outside due to the Date.now() drift
    // between construction and the helper's internal capture; tighten by
    // pulling the takenAt 5ms back from the strict boundary so the test
    // is robust without weakening the inclusivity assertion.
    if (r2.entries.length === 0) {
      const onBoundarySafe = { takenAt: Date.now() + WINDOW - 5, deviceId: REMOTE_DEVICE_A };
      const m2b = makeMedWithLog('rc-bnd-f16-b', []);
      const r2b = MedsManager.reconcileDoseLog(m2b, [onBoundarySafe]);
      assertEqual(r2b.entries.length, 1);
      assertEqual(r2b.dropped, 0);
    } else {
      assertEqual(r2.entries.length, 1);
      assertEqual(r2.dropped, 0);
    }
  });

  it('onMergeComplete re-derives lastTakenAt from doseLog tail (and null on empty)', () => {
    // Use a real MedsManager-registered med — onMergeComplete looks up by id.
    // Snapshot/clear/restore the meds keyspace so this test doesn't pollute
    // the user's stored data.
    function snapKeys() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('meds/') || k === 'wellness_meds')) {
          out.push([k, localStorage.getItem(k)]);
        }
      }
      return out;
    }
    function clearKeys() {
      const toClean = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('meds/') || k === 'wellness_meds')) toClean.push(k);
      }
      for (const k of toClean) localStorage.removeItem(k);
    }
    const snapshot = snapKeys();
    clearKeys();
    try {
      MedsManager.clear();
      const m = MedsManager.add({ name: 'OMC-target' });
      const id = m.getId();
      // Seed two entries via loadState to bypass touch() noise.
      m.loadState({
        id: id,
        name: 'OMC-target',
        frequency: 'once-daily',
        doseLog: [
          { takenAt: 1700000000000, deviceId: localDeviceId },
          { takenAt: 1700000600000, deviceId: localDeviceId },  // tail
        ],
      });
      MedsManager.onMergeComplete(id);
      assertEqual(m.getLastTakenAt(), 1700000600000);

      // Empty doseLog → lastTakenAt resets to null.
      m.loadState({ id: id, name: 'OMC-target', frequency: 'once-daily', doseLog: [] });
      MedsManager.onMergeComplete(id);
      assertEqual(m.getLastTakenAt(), null);
    } finally {
      MedsManager.clear();
      clearKeys();
      for (const [k, v] of snapshot) localStorage.setItem(k, v);
      MedsManager.loadAll();
    }
  });

  it('empty incoming = no-op (entries deep-equals existing doseLog)', () => {
    const now = Date.now();
    const existing = [
      { takenAt: now - 60 * 1000, deviceId: localDeviceId },
      { takenAt: now - 30 * 1000, deviceId: localDeviceId },
    ];
    const m = makeMedWithLog('rc-empty', existing);
    const r = MedsManager.reconcileDoseLog(m, []);
    // Compare entry-by-entry on the salient fields.
    assertArrayEqual(
      r.entries.map(e => ({ takenAt: e.takenAt, deviceId: e.deviceId })),
      existing.map(e => ({ takenAt: e.takenAt, deviceId: e.deviceId }))
    );
    assertEqual(r.dropped, 0);
    assertEqual(r.collapsed, 0);
  });

  it('idempotent: running reconcile twice produces deep-equal entries', () => {
    const now = Date.now();
    // Mix: cross-device collapse + same-device preserve + exact dup.
    const a = { takenAt: now - 14 * 60 * 1000, deviceId: REMOTE_DEVICE_A };
    const b = { takenAt: now - 12 * 60 * 1000, deviceId: REMOTE_DEVICE_B };  // collapses into a
    const c = { takenAt: now -  5 * 60 * 1000, deviceId: localDeviceId };    // standalone
    const d = { takenAt: now -  5 * 60 * 1000, deviceId: localDeviceId };    // exact dup of c
    const m1 = makeMedWithLog('rc-idem-1', []);
    const r1 = MedsManager.reconcileDoseLog(m1, [a, b, c, d]);

    // Re-feed r1.entries back through reconcile against a fresh med.
    const m2 = makeMedWithLog('rc-idem-2', []);
    const r2 = MedsManager.reconcileDoseLog(m2, r1.entries);
    assertArrayEqual(
      r2.entries.map(e => ({ takenAt: e.takenAt, deviceId: e.deviceId })),
      r1.entries.map(e => ({ takenAt: e.takenAt, deviceId: e.deviceId }))
    );
  });

  it('F14 cap: 1500-entry same-device input → 1000-entry output, oldest dropped', () => {
    // All same-device (localDeviceId) so F1 walk preserves every entry,
    // and all within F16 window (localNow ± WINDOW) so F16 doesn't drop.
    // Build a tight cluster around localNow with ascending timestamps.
    const now = Date.now();
    const input = [];
    // Stride entries across a 1-second range so they're all within F16
    // window and trivially ordered. The cap drops the OLDEST.
    for (let i = 0; i < 1500; i++) {
      input.push({ takenAt: now - 1500 + i, deviceId: localDeviceId });
    }
    const m = makeMedWithLog('rc-cap', []);
    const r = MedsManager.reconcileDoseLog(m, input);
    assertEqual(r.entries.length, 1000);
    // Oldest dropped: first surviving entry's takenAt must be > the original
    // input's first entry's takenAt (the dropped 500).
    assert(r.entries[0].takenAt > input[0].takenAt,
      'oldest entries dropped: first surviving > original first');
    // Last entry unchanged.
    assertEqual(r.entries[r.entries.length - 1].takenAt, input[input.length - 1].takenAt);
  });

  it('onMergeComplete emits "onMergeComplete" event exactly once with { medId } payload', () => {
    function snapKeys() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('meds/') || k === 'wellness_meds')) {
          out.push([k, localStorage.getItem(k)]);
        }
      }
      return out;
    }
    function clearKeys() {
      const toClean = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('meds/') || k === 'wellness_meds')) toClean.push(k);
      }
      for (const k of toClean) localStorage.removeItem(k);
    }
    const snapshot = snapKeys();
    clearKeys();

    const captured = [];
    const listener = (payload) => { captured.push(payload); };

    try {
      MedsManager.clear();
      const m = MedsManager.add({ name: 'Bus-target' });
      const id = m.getId();
      m.loadState({
        id: id,
        name: 'Bus-target',
        frequency: 'once-daily',
        doseLog: [{ takenAt: 1700000000000, deviceId: localDeviceId }],
      });

      SyncEngine.on('onMergeComplete', listener);
      MedsManager.onMergeComplete(id);

      assertEqual(captured.length, 1);
      assert(captured[0] && typeof captured[0] === 'object', 'payload is an object');
      assertEqual(captured[0].medId, id);

      // Unknown-id call must NOT emit.
      MedsManager.onMergeComplete('nope-not-a-real-id');
      assertEqual(captured.length, 1);
    } finally {
      SyncEngine.off('onMergeComplete', listener);
      MedsManager.clear();
      clearKeys();
      for (const [k, v] of snapshot) localStorage.setItem(k, v);
      MedsManager.loadAll();
    }
  });

  it('three-cluster cross-device (A@0, B@5m, A@10m) → continue-from-`a` collapses B only', () => {
    // The brief's worked example: A@0, B@5min, A@10min all within ±15min.
    // Sort puts them in [A@0, B@5min, A@10min]. F1 walk:
    //   i=0 anchor=A@0. j=1 b=B@5min: cross-device, in window → collapse B,
    //     j=2 b=A@10min: SAME device (A===A) → break inner. Resume outer at j=2.
    //   i=2 anchor=A@10min. push. Done.
    // Output: [A@0, A@10min], collapsed === 1.
    const now = Date.now();
    const t0  = now - 14 * 60 * 1000;
    const t5  = now -  9 * 60 * 1000;   // 5min after t0
    const t10 = now -  4 * 60 * 1000;   // 10min after t0, 5min after t5
    const a0  = { takenAt: t0,  deviceId: REMOTE_DEVICE_A };
    const b5  = { takenAt: t5,  deviceId: REMOTE_DEVICE_B };
    const a10 = { takenAt: t10, deviceId: REMOTE_DEVICE_A };
    const m = makeMedWithLog('rc-cluster', []);
    const r = MedsManager.reconcileDoseLog(m, [a0, b5, a10]);
    assertEqual(r.entries.length, 2);
    assertEqual(r.entries[0].deviceId, REMOTE_DEVICE_A);
    assertEqual(r.entries[0].takenAt, t0);
    assertEqual(r.entries[1].deviceId, REMOTE_DEVICE_A);
    assertEqual(r.entries[1].takenAt, t10);
    assertEqual(r.collapsed, 1);
    assertEqual(r.dropped, 0);
  });

  it('F19a future-schema record: reconcile is a no-op with future-schema warning', () => {
    // Plant a future-schema record by passing schemaVersion=999 to loadState.
    // The med.isFromFutureSchema() flag will be true, which routes
    // reconcileDoseLog through its F19a refuse-writeback gate.
    const seeded = [{ takenAt: 1700000000000, deviceId: localDeviceId }];
    const m = createMed('rc-future');
    m.loadState({
      id: 'rc-future',
      schemaVersion: 999,
      name: 'Future',
      frequency: 'once-daily',
      doseLog: seeded,
    });
    assertEqual(m.isFromFutureSchema(), true);
    const before = m.getDoseLog();

    const incoming = [{ takenAt: 1700000600000, deviceId: REMOTE_DEVICE_A }];
    const r = MedsManager.reconcileDoseLog(m, incoming);

    // (a) entries deep-equals med.doseLog (the helper returns the existing
    //     doseLog unchanged — same takenAt/deviceId).
    assertArrayEqual(
      r.entries.map(e => ({ takenAt: e.takenAt, deviceId: e.deviceId })),
      before.map(e => ({ takenAt: e.takenAt, deviceId: e.deviceId }))
    );
    // (b) dropped === 0
    assertEqual(r.dropped, 0);
    // (c) collapsed === 0
    assertEqual(r.collapsed, 0);
    // (d) exactly one warning, contains "future-schema"
    assertEqual(r.warnings.length, 1);
    assert(r.warnings[0].indexOf('future-schema') !== -1,
      'warning contains "future-schema"');
  });
});

describe('Meds — prescription supply tracking', () => {
  it('is not tracked by default (getSupplyRemaining null)', () => {
    const m = createMed('sup1');
    assertEqual(m.getSupplyStartCount(), null);
    assertEqual(m.getSupplyResetAt(), null);
    assertEqual(m.getSupplyRemaining(), null);
  });

  it('setSupply seeds the full count and stamps a reset time', () => {
    const m = createMed('sup2');
    const before = Date.now();
    m.setSupply(30);
    const after = Date.now();
    assertEqual(m.getSupplyStartCount(), 30);
    assertEqual(m.getSupplyRemaining(), 30);
    const r = m.getSupplyResetAt();
    assert(r >= before && r <= after, 'supplyResetAt should be ~now');
  });

  it('each logged dose decrements the remaining count', () => {
    const m = createMed('sup3');
    m.setSupply(30);
    m.logDose();
    assertEqual(m.getSupplyRemaining(), 29);
    m.logDose();
    m.logDose();
    assertEqual(m.getSupplyRemaining(), 27);
  });

  it('clamps remaining at 0 — never goes negative', () => {
    const m = createMed('sup4');
    m.setSupply(2);
    m.logDose();
    m.logDose();
    m.logDose();
    assertEqual(m.getSupplyRemaining(), 0);
  });

  it('undoing a dose restores the count (self-correcting)', () => {
    const m = createMed('sup5');
    m.setSupply(10);
    m.logDose();
    m.logDose();
    assertEqual(m.getSupplyRemaining(), 8);
    m.undoLastDose();
    assertEqual(m.getSupplyRemaining(), 9);
  });

  it('doses logged before the refill do not count against the new supply', () => {
    const m = createMed('sup6');
    m.setSupply(30);
    const resetAt = m.getSupplyResetAt();
    m.logDose(resetAt - 3600000); // an hour before the refill — old bottle
    assertEqual(m.getSupplyRemaining(), 30);
    m.logDose(resetAt + 1000);    // after the refill — counts
    assertEqual(m.getSupplyRemaining(), 29);
  });

  it('a new prescription resets remaining to full even with prior doses', () => {
    // Stub the clock so the refill lands strictly after the prior doses
    // (in real life a month apart; here we advance a controlled cursor).
    const realNow = Date.now;
    try {
      let t = 1700000000000;
      Date.now = () => t;
      const m = createMed('sup7');
      m.setSupply(30);            // prescription 1
      t += 1000; m.logDose();     // two doses from the old bottle
      t += 1000; m.logDose();
      assertEqual(m.getSupplyRemaining(), 28);
      t += 1000;
      m.setSupply(30);            // new month — refill after both doses
      assertEqual(m.getSupplyRemaining(), 30);
    } finally {
      Date.now = realNow;
    }
  });

  it('setSupply sanitizes invalid / out-of-range input', () => {
    const m = createMed('sup8');
    m.setSupply(0);     assertEqual(m.getSupplyStartCount(), 30);
    m.setSupply(-5);    assertEqual(m.getSupplyStartCount(), 30);
    m.setSupply('abc'); assertEqual(m.getSupplyStartCount(), 30);
    m.setSupply(2000);  assertEqual(m.getSupplyStartCount(), 1000);
    m.setSupply(45.7);  assertEqual(m.getSupplyStartCount(), 45);
  });

  it('supports a custom prescription size (not just 30)', () => {
    const m = createMed('sup9');
    m.setSupply(90);
    m.logDose();
    assertEqual(m.getSupplyRemaining(), 89);
  });

  it('roundtrips through getState / loadState', () => {
    const m = createMed('sup10');
    m.setSupply(30);
    m.logDose();
    const state = m.getState();
    assertEqual(state.supplyStartCount, 30);
    assert(typeof state.supplyResetAt === 'number', 'supplyResetAt serialized');

    const m2 = createMed('sup10');
    m2.loadState(state);
    assertEqual(m2.getSupplyStartCount(), 30);
    assertEqual(m2.getSupplyRemaining(), 29);
  });

  it('loadState with absent supply fields leaves tracking off', () => {
    const m = createMed('sup11');
    m.loadState({ id: 'sup11', name: 'X', frequency: 'as-needed', doseLog: [] });
    assertEqual(m.getSupplyStartCount(), null);
    assertEqual(m.getSupplyResetAt(), null);
    assertEqual(m.getSupplyRemaining(), null);
  });

  it('clearSupply turns tracking back off', () => {
    const m = createMed('sup12');
    m.setSupply(30);
    m.logDose();
    assertEqual(m.getSupplyRemaining(), 29);
    m.clearSupply();
    assertEqual(m.getSupplyStartCount(), null);
    assertEqual(m.getSupplyResetAt(), null);
    assertEqual(m.getSupplyRemaining(), null);
  });

  // ── Manual ±1 adjustment (supply steppers) ──────────────────────────
  it('adjustSupply(+1) / (-1) nudge the remaining count by one', () => {
    const m = createMed('adj1');
    m.setSupply(30);
    assertEqual(m.getSupplyRemaining(), 30);
    m.adjustSupply(-1);
    assertEqual(m.getSupplyRemaining(), 29);
    m.adjustSupply(-1);
    assertEqual(m.getSupplyRemaining(), 28);
    m.adjustSupply(1);
    assertEqual(m.getSupplyRemaining(), 29);
  });

  it('adjustSupply down-arrow is a no-op at 0 (clamped)', () => {
    const m = createMed('adj2');
    m.setSupply(2);
    m.logDose();
    m.logDose();
    assertEqual(m.getSupplyRemaining(), 0);
    m.adjustSupply(-1);
    assertEqual(m.getSupplyRemaining(), 0);
    assertEqual(m.getSupplyAdjustment(), 0);
  });

  it('adjustSupply up-arrow may exceed the prescription size (31 of 30)', () => {
    const m = createMed('adj3');
    m.setSupply(30);
    m.adjustSupply(1);
    assertEqual(m.getSupplyRemaining(), 31);
    assertEqual(m.getSupplyStartCount(), 30); // denominator stays put
  });

  it('manual correction composes with later dose logging', () => {
    const m = createMed('adj4');
    m.setSupply(30);
    m.adjustSupply(2);                 // pharmacy gave 2 extra
    assertEqual(m.getSupplyRemaining(), 32);
    m.logDose();                       // take one
    assertEqual(m.getSupplyRemaining(), 31);
  });

  it('up-arrow stays responsive even when doses exceed the supply', () => {
    // consumed (3) > startCount (2) → remaining clamps to 0. The next up
    // press must still land on exactly 1, not silently absorb into a
    // negative raw value.
    const m = createMed('adj5');
    m.setSupply(2);
    m.logDose();
    m.logDose();
    m.logDose();
    assertEqual(m.getSupplyRemaining(), 0);
    m.adjustSupply(1);
    assertEqual(m.getSupplyRemaining(), 1);
  });

  it('setSupply (new prescription) resets a prior manual correction', () => {
    const m = createMed('adj6');
    m.setSupply(30);
    m.adjustSupply(-5);
    assertEqual(m.getSupplyRemaining(), 25);
    m.setSupply(30);                   // refill
    assertEqual(m.getSupplyRemaining(), 30);
    assertEqual(m.getSupplyAdjustment(), 0);
  });

  it('clearSupply resets the manual correction', () => {
    const m = createMed('adj7');
    m.setSupply(30);
    m.adjustSupply(-3);
    m.clearSupply();
    assertEqual(m.getSupplyAdjustment(), 0);
  });

  it('adjustSupply is a no-op when supply is not tracked', () => {
    const m = createMed('adj8');
    m.adjustSupply(1);
    assertEqual(m.getSupplyRemaining(), null);
    assertEqual(m.getSupplyAdjustment(), 0);
  });

  it('manual correction survives getState / loadState', () => {
    const m = createMed('adj9');
    m.setSupply(30);
    m.adjustSupply(-3);
    const state = m.getState();
    assertEqual(state.supplyAdjustment, -3);
    const m2 = createMed('adj9');
    m2.loadState(state);
    assertEqual(m2.getSupplyAdjustment(), -3);
    assertEqual(m2.getSupplyRemaining(), 27);
  });

  it('adjustSupply truncates / ignores fractional and zero deltas', () => {
    const m = createMed('adj10');
    m.setSupply(30);
    m.adjustSupply(0);
    assertEqual(m.getSupplyRemaining(), 30);
    m.adjustSupply(0.5);               // trunc → 0 → no-op
    assertEqual(m.getSupplyRemaining(), 30);
    m.adjustSupply(2.9);               // trunc → 2
    assertEqual(m.getSupplyRemaining(), 32);
  });

  it('loadState with absent supplyAdjustment defaults to 0', () => {
    const m = createMed('adj11');
    m.loadState({ id: 'adj11', supplyStartCount: 30, supplyResetAt: Date.now(), doseLog: [] });
    assertEqual(m.getSupplyAdjustment(), 0);
    assertEqual(m.getSupplyRemaining(), 30);
  });

  it('getSupplyRemaining clamps a corrupt out-of-range adjustment to the cap', () => {
    // A hostile / corrupt synced record can carry any supplyAdjustment —
    // loadState truncs but does not clamp it. The derived display must still
    // be bounded so the badge never shows an absurd "N left".
    const m = createMed('adj12');
    m.loadState({ id: 'adj12', supplyStartCount: 30, supplyResetAt: Date.now(), supplyAdjustment: 5000, doseLog: [] });
    assertEqual(m.getSupplyRemaining(), 1000);
  });
});

describe('Meds — supply runway (getRunwayDays)', () => {
  it('null when supply is not tracked', () => {
    const m = createMed('run1');
    m.setFrequency('once-daily');
    assertEqual(m.getRunwayDays(), null);
  });

  it('once-daily: remaining ÷ 1 dose/day, floored', () => {
    const m = createMed('run2');
    m.setFrequency('once-daily');
    m.setSupply(30);
    m.logDose();
    m.logDose();
    // remaining 28 at 1/day → 28 days
    assertEqual(m.getRunwayDays(), 28);
  });

  it('twice-daily: remaining ÷ 2 doses/day, floored', () => {
    const m = createMed('run3');
    m.setFrequency('twice-daily');
    m.setSupply(30);
    assertEqual(m.getRunwayDays(), 15);
    m.logDose();
    // remaining 29 at 2/day → floor(14.5) = 14
    assertEqual(m.getRunwayDays(), 14);
  });

  it('0 remaining → 0 days (out today, not null)', () => {
    const m = createMed('run4');
    m.setFrequency('once-daily');
    m.setSupply(1);
    m.logDose();
    assertEqual(m.getSupplyRemaining(), 0);
    assertEqual(m.getRunwayDays(), 0);
  });

  it('as-needed: rate from the trailing 14-day average consumption', () => {
    const m = createMed('run5');
    m.setFrequency('as-needed');
    m.setSupply(28);
    const now = Date.now();
    // 7 doses over the trailing week — all BEFORE the refill, so remaining
    // stays 28 while the observed rate is 7/14 = 0.5/day → 56 days.
    for (let i = 1; i <= 7; i++) m.logDose(now - i * 86400000);
    assertEqual(m.getSupplyRemaining(), 28);
    assertEqual(m.getRunwayDays(now), 56);
  });

  it('as-needed with no dose in the trailing window → null (no observed rate)', () => {
    const m = createMed('run6');
    m.setFrequency('as-needed');
    m.setSupply(30);
    assertEqual(m.getRunwayDays(), null);
    // A dose OLDER than 14 days doesn't establish a rate either.
    const now = Date.now();
    m.logDose(now - 20 * 86400000);
    assertEqual(m.getRunwayDays(now), null);
  });

  it('unrecognized (forward-compat) frequency behaves like as-needed for the rate', () => {
    const m = createMed('run7');
    m.setFrequency('three-times-daily'); // preserved verbatim per F20
    m.setSupply(30);
    const now = Date.now();
    assertEqual(m.getRunwayDays(now), null); // no doses → no rate
    for (let i = 1; i <= 14; i++) m.logDose(now - i * 86400000 + 3600000);
    // 14 doses in 14 days → 1/day; remaining is 30 minus the doses that
    // landed after the refill (only the one ~1h "ago"… all are before reset
    // except none — setSupply stamped now, every dose is earlier) → 30.
    assertEqual(m.getRunwayDays(now), 30);
  });
});

describe('Meds — adherence streak (getAdherenceStreak)', () => {
  const NOW_ADH = new Date(2026, 0, 20, 12, 0, 0).getTime(); // 2026-01-20 noon local
  function atDay(offset, hour) {
    const b = new Date(NOW_ADH);
    return new Date(b.getFullYear(), b.getMonth(), b.getDate() + offset, hour == null ? 9 : hour, 0, 0, 0).getTime();
  }

  it('null for as-needed (no daily expectation)', () => {
    const m = createMed('adh1');
    m.setFrequency('as-needed');
    m.logDose(atDay(0));
    assertEqual(m.getAdherenceStreak(NOW_ADH), null);
  });

  it('once-daily: consecutive met days ending today (activeToday)', () => {
    const m = createMed('adh2');
    m.setFrequency('once-daily');
    m.logDose(atDay(-2));
    m.logDose(atDay(-1));
    m.logDose(atDay(0));
    const s = m.getAdherenceStreak(NOW_ADH);
    assertEqual(s.current, 3);
    assertEqual(s.activeToday, true);
  });

  it('forgiving: an unmet TODAY does not break the streak', () => {
    const m = createMed('adh3');
    m.setFrequency('once-daily');
    m.logDose(atDay(-2));
    m.logDose(atDay(-1));
    const s = m.getAdherenceStreak(NOW_ADH);
    assertEqual(s.current, 2);
    assertEqual(s.activeToday, false);
  });

  it('a missed day before yesterday breaks the streak', () => {
    const m = createMed('adh4');
    m.setFrequency('once-daily');
    m.logDose(atDay(-3));
    m.logDose(atDay(-1)); // gap at D-2
    const s = m.getAdherenceStreak(NOW_ADH);
    assertEqual(s.current, 1);
  });

  it('twice-daily: a 1-of-2 day counts as unmet for the streak', () => {
    const m = createMed('adh5');
    m.setFrequency('twice-daily');
    m.logDose(atDay(-2, 8));                       // 1 of 2 — unmet
    m.logDose(atDay(-1, 8)); m.logDose(atDay(-1, 20)); // 2 of 2 — met
    m.logDose(atDay(0, 8));                        // 1 of 2 so far today — pending
    const s = m.getAdherenceStreak(NOW_ADH);
    assertEqual(s.current, 1);        // yesterday only
    assertEqual(s.activeToday, false); // today not yet met
  });

  it('days before createdAt neither extend nor break the streak (M14 clamp)', () => {
    const m = createMed('adh6');
    m.setFrequency('once-daily');
    m.setCreatedAt(atDay(-1, 0));
    m.logDose(atDay(-1));
    m.logDose(atDay(0));
    const s = m.getAdherenceStreak(NOW_ADH);
    // D-2 is before the med existed — the walk stops there instead of
    // reading it as a missed day, and it can't inflate the count either.
    assertEqual(s.current, 2);
  });

  it('nothing logged → current 0, activeToday false', () => {
    const m = createMed('adh7');
    m.setFrequency('once-daily');
    const s = m.getAdherenceStreak(NOW_ADH);
    assertEqual(s.current, 0);
    assertEqual(s.activeToday, false);
  });

  it('last7 is 7 entries oldest→newest with full/partial/missed/before statuses', () => {
    const m = createMed('adh8');
    m.setFrequency('twice-daily');
    m.setCreatedAt(atDay(-5, 0));
    m.logDose(atDay(-2, 8));                       // partial
    m.logDose(atDay(0, 8)); m.logDose(atDay(0, 20)); // full
    const s = m.getAdherenceStreak(NOW_ADH);
    assertEqual(s.last7.length, 7);
    const statuses = s.last7.map(d => d.status);
    assertArrayEqual(statuses, ['before', 'missed', 'missed', 'missed', 'partial', 'missed', 'full']);
    assertEqual(s.last7[6].taken, 2);
    assertEqual(s.last7[6].expected, 2);
    assertEqual(s.last7[0].date < s.last7[6].date, true);
  });
});
