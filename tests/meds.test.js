describe('Meds — creation and defaults', () => {
  it('creates with expected defaults', () => {
    const m = createMed('t1');
    assertEqual(m.getId(), 't1');
    assertEqual(m.getName(), 'Medication');
    assertEqual(m.getScheduleType(), 'interval');
    assertEqual(m.getLastTakenAt(), null);
    assertEqual(m.getDoseLog().length, 0);
    assert(m.getIntervalMs() > 0, 'Default interval should be positive');
  });

  it('allows setting name', () => {
    const m = createMed('t2');
    m.setName('Ibuprofen');
    assertEqual(m.getName(), 'Ibuprofen');
  });

  it('truncates long names to 60 chars', () => {
    const m = createMed('t3');
    m.setName('x'.repeat(200));
    assertEqual(m.getName().length, 60);
  });
});

describe('Meds — interval schedule', () => {
  it('setIntervalSchedule changes type and value', () => {
    const m = createMed('ti1');
    m.setIntervalSchedule(4 * 3600000);
    assertEqual(m.getScheduleType(), 'interval');
    assertEqual(m.getIntervalMs(), 4 * 3600000);
  });

  it('clamps interval below 1 minute up to 1 minute', () => {
    const m = createMed('ti2');
    m.setIntervalSchedule(1000);
    assertEqual(m.getIntervalMs(), 60000);
  });

  it('next dose is roughly now when never taken', () => {
    const m = createMed('ti3');
    m.setIntervalSchedule(6 * 3600000);
    const next = m.getNextDoseAt();
    assertClose(next, Date.now(), 200, 'Next dose should be ≈ now');
  });

  it('next dose = lastTakenAt + interval', () => {
    const m = createMed('ti4');
    m.setIntervalSchedule(4 * 3600000);
    const taken = Date.now() - 3600000; // 1h ago
    m.logDose(taken);
    assertEqual(m.getNextDoseAt(), taken + 4 * 3600000);
  });

  it('isDue true after interval has passed', () => {
    const m = createMed('ti5');
    m.setIntervalSchedule(3600000);
    m.logDose(Date.now() - 2 * 3600000); // 2h ago, but interval 1h
    assert(m.isDue(), 'Should be due');
  });

  it('isDue false within interval', () => {
    const m = createMed('ti6');
    m.setIntervalSchedule(3600000);
    m.logDose(Date.now());
    assert(!m.isDue(), 'Should not be due');
  });
});

describe('Meds — time-of-day schedule', () => {
  it('setTimesSchedule normalizes and sorts times', () => {
    const m = createMed('tt1');
    m.setTimesSchedule(['20:00', '8:00', '14:30']);
    const times = m.getTimes();
    assertEqual(times.length, 3);
    assertEqual(times[0], '08:00');
    assertEqual(times[1], '14:30');
    assertEqual(times[2], '20:00');
  });

  it('filters non-HH:MM strings; clamps numeric out-of-range', () => {
    const m = createMed('tt2');
    m.setTimesSchedule(['08:00', 'abc', '25:99', '14:30', '']);
    // 'abc' and '' fail the regex. '25:99' passes the shape then clamps to 23:59.
    const times = m.getTimes();
    assertEqual(times.length, 3);
    assert(times.includes('08:00'), 'kept 08:00');
    assert(times.includes('14:30'), 'kept 14:30');
    assert(times.includes('23:59'), 'clamped 25:99 → 23:59');
  });

  it('clamps out-of-range values into valid 24h ranges', () => {
    const m = createMed('tt3');
    m.setTimesSchedule(['25:70']);
    assertEqual(m.getTimes()[0], '23:59');
  });

  it('next dose is in the future', () => {
    const m = createMed('tt4');
    m.setTimesSchedule(['08:00', '20:00']);
    const next = m.getNextDoseAt();
    assert(next > Date.now(), 'Next scheduled time should be in the future');
  });

  it('next dose picks later slot on the same day when last dose was earlier', () => {
    const m = createMed('tt5');
    m.setTimesSchedule(['08:00', '20:00']);
    const now = new Date();
    const taken = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 5).getTime();
    m.logDose(taken);
    const next = new Date(m.getNextDoseAt());
    assertEqual(next.getHours(), 20);
    assertEqual(next.getMinutes(), 0);
  });

  it('next dose rolls to tomorrow when all today slots passed', () => {
    const m = createMed('tt6');
    m.setTimesSchedule(['08:00']);
    const now = new Date();
    const taken = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0).getTime();
    m.logDose(taken);
    const next = new Date(m.getNextDoseAt());
    // 8am the following day (relative to 9am today)
    assertEqual(next.getHours(), 8);
    assertEqual(next.getDate(), now.getDate() + 1 - (now.getDate() + 1 > new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() ? 0 : 0));
  });

  it('returns null getNextDoseAt when no times configured', () => {
    const m = createMed('tt7');
    m.setTimesSchedule([]);
    assertEqual(m.getNextDoseAt(), null);
  });
});

describe('Meds — dose logging', () => {
  it('logDose updates lastTakenAt and appends to log', () => {
    const m = createMed('td1');
    m.logDose();
    assert(m.getLastTakenAt() !== null, 'lastTakenAt should be set');
    assertEqual(m.getDoseLog().length, 1);
  });

  it('logDose accepts a custom timestamp for offset logging', () => {
    const m = createMed('td2');
    const t = Date.now() - 30 * 60 * 1000;
    m.logDose(t);
    assertEqual(m.getLastTakenAt(), t);
  });

  it('undoLastDose rolls back to previous dose', () => {
    const m = createMed('td3');
    const t1 = Date.now() - 60000;
    const t2 = Date.now();
    m.logDose(t1);
    m.logDose(t2);
    assertEqual(m.undoLastDose(), true);
    assertEqual(m.getLastTakenAt(), t1);
    assertEqual(m.getDoseLog().length, 1);
  });

  it('undoLastDose when no doses returns false', () => {
    const m = createMed('td4');
    assertEqual(m.undoLastDose(), false);
  });

  it('time-since-last-dose reflects elapsed time', () => {
    const m = createMed('td5');
    m.logDose(Date.now() - 120000);
    const since = m.getTimeSinceLastDoseMs();
    assert(since >= 120000 - 100, 'Time since should be ≥ 2 minutes');
  });
});

describe('Meds — notifications', () => {
  it('shouldFireDueNotification true when due and not yet notified', () => {
    const m = createMed('tn1');
    m.setIntervalSchedule(3600000);
    m.logDose(Date.now() - 2 * 3600000);
    assert(m.shouldFireDueNotification(), 'Should want to notify');
  });

  it('markDueNotified prevents re-fires until next logDose', () => {
    const m = createMed('tn2');
    m.setIntervalSchedule(3600000);
    m.logDose(Date.now() - 2 * 3600000);
    m.markDueNotified();
    assert(!m.shouldFireDueNotification(), 'Should not re-fire');
  });

  it('logDose resets the dueNotified latch', () => {
    const m = createMed('tn3');
    m.setIntervalSchedule(3600000);
    m.logDose(Date.now() - 2 * 3600000);
    m.markDueNotified();
    m.logDose(Date.now() - 2 * 3600000); // another "past" dose
    assert(m.shouldFireDueNotification(), 'New logDose should allow notifying again');
  });

  it('notifications disabled → never fires', () => {
    const m = createMed('tn4');
    m.setIntervalSchedule(3600000);
    m.setNotificationsEnabled(false);
    m.logDose(Date.now() - 2 * 3600000);
    assert(!m.shouldFireDueNotification(), 'Should not fire when disabled');
  });
});

describe('Meds — serialization', () => {
  it('getState returns complete snapshot', () => {
    const m = createMed('ts1');
    m.setName('Vitamin D');
    m.setIntervalSchedule(8 * 3600000);
    m.logDose(1000000);
    const state = m.getState();
    assertEqual(state.id, 'ts1');
    assertEqual(state.name, 'Vitamin D');
    assertEqual(state.intervalMs, 8 * 3600000);
    assertEqual(state.lastTakenAt, 1000000);
    assertEqual(state.doseLog.length, 1);
  });

  it('loadState restores name, schedule, history', () => {
    const a = createMed('ts2');
    a.setName('Metformin');
    a.setTimesSchedule(['09:00', '21:00']);
    a.logDose(1234567);
    const state = a.getState();

    const b = createMed('ts3');
    b.loadState(state);
    assertEqual(b.getName(), 'Metformin');
    assertEqual(b.getScheduleType(), 'times');
    assertEqual(b.getTimes().length, 2);
    assertEqual(b.getLastTakenAt(), 1234567);
  });

  it('loadState tolerates partial/empty state', () => {
    const m = createMed('ts4');
    m.loadState({});
    assertEqual(m.getName(), 'Medication');
    assertEqual(m.getScheduleType(), 'interval');
    assertEqual(m.getLastTakenAt(), null);
  });

  it('loadState drops far-future lastTakenAt (clock skew)', () => {
    const m = createMed('ts5');
    m.loadState({ lastTakenAt: Date.now() + 999999999 });
    assertEqual(m.getLastTakenAt(), null);
  });

  it('loadState preserves notificationsEnabled=false', () => {
    const m = createMed('ts6');
    m.loadState({ notificationsEnabled: false });
    assertEqual(m.getNotificationsEnabled(), false);
  });
});

describe('MedsManager', () => {
  it('starts empty after clear', () => {
    MedsManager.clear();
    assertEqual(MedsManager.count(), 0);
    assertEqual(MedsManager.all().length, 0);
  });

  it('add creates a med with config', () => {
    MedsManager.clear();
    const m = MedsManager.add({ name: 'Added', intervalMs: 60000 });
    assert(m !== null, 'add() should return the new med');
    assertEqual(MedsManager.count(), 1);
    assertEqual(m.getName(), 'Added');
  });

  it('add with times config creates time-of-day med', () => {
    MedsManager.clear();
    const m = MedsManager.add({ name: 'Timed', scheduleType: 'times', times: ['08:00', '20:00'] });
    assertEqual(m.getScheduleType(), 'times');
    assertEqual(m.getTimes().length, 2);
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
    // Snapshot any real user data so the test doesn't clobber it.
    const prior = localStorage.getItem('wellness_meds');
    try {
      MedsManager.clear();
      MedsManager.add({ name: 'Persisted', intervalMs: 4 * 3600000 });
      MedsManager.saveAll();
      MedsManager.clear();
      assertEqual(MedsManager.count(), 0);
      MedsManager.loadAll();
      assertEqual(MedsManager.count(), 1);
      assertEqual(MedsManager.all()[0].getName(), 'Persisted');
    } finally {
      MedsManager.clear();
      if (prior !== null) localStorage.setItem('wellness_meds', prior);
      else localStorage.removeItem('wellness_meds');
      MedsManager.loadAll();
    }
  });
});
