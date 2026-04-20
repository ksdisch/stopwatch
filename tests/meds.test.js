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

  it('setFrequency falls back to once-daily on invalid input', () => {
    const m = createMed('f2');
    m.setFrequency('hourly');
    assertEqual(m.getFrequency(), 'once-daily');
    m.setFrequency(null);
    assertEqual(m.getFrequency(), 'once-daily');
    m.setFrequency(undefined);
    assertEqual(m.getFrequency(), 'once-daily');
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

  it('loadState tolerates partial/empty state', () => {
    const m = createMed('r4');
    m.loadState({});
    assertEqual(m.getName(), 'Medication');
    assertEqual(m.getDose(), '');
    // Empty state migrates to as-needed (safest default for untouched rows)
    assertEqual(m.getFrequency(), 'as-needed');
    assertEqual(m.getLastTakenAt(), null);
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
    const prior = localStorage.getItem('wellness_meds');
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
      if (prior !== null) localStorage.setItem('wellness_meds', prior);
      else localStorage.removeItem('wellness_meds');
      MedsManager.loadAll();
    }
  });
});
