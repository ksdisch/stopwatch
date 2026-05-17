// Rhythm engine tests. Mirrors the analytics.test.js pattern: stub
// window.History per-case + write localStorage fixtures + assert on the
// returned timeline shape.

const _rhRealHistory = window.History;

function rhSetSessions(sessions) {
  window.History = { getSessions: async () => sessions };
}

function rhClearStores() {
  localStorage.removeItem('wellness_meds');
  localStorage.removeItem('wellness_rest_log');
  localStorage.removeItem('bfrb_events');
  localStorage.removeItem('bfrbs_global');
  localStorage.removeItem('flow_bfrbs');
  localStorage.removeItem('pomodoro_bfrbs');
  localStorage.removeItem('tempo_bfrb_events_migration_v1');
}

// Build a local-day timestamp at a specific (hour, minute) on a given date.
function atDate(date, hour, minute = 0) {
  const d = new Date(date);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

describe('Rhythm.getDayTimeline — empty day', () => {
  it('returns empty array when no sources have entries for the date', async () => {
    rhClearStores();
    rhSetSessions([]);
    const entries = await Rhythm.getDayTimeline(new Date());
    assertEqual(entries.length, 0);
  });
});

describe('Rhythm.getDayTimeline — session entries', () => {
  it('emits session-start + session-end for a completed flow session', async () => {
    rhClearStores();
    const today = new Date();
    const start = atDate(today, 9);
    rhSetSessions([
      { type: 'flow', date: new Date(start).toISOString(), duration: 90 * 60 * 1000 },
    ]);
    const entries = await Rhythm.getDayTimeline(today);
    assertEqual(entries.length, 2);
    assertEqual(entries[0].type, 'session-start');
    assertEqual(entries[0].module, 'flow');
    assertEqual(entries[0].pillar, 'productivity');
    assertEqual(entries[1].type, 'session-end');
    assertEqual(entries[1].time - entries[0].time, 90 * 60 * 1000);
  });

  it('skips end entry if duration is 0', async () => {
    rhClearStores();
    const today = new Date();
    const start = atDate(today, 10);
    rhSetSessions([
      { type: 'stopwatch', date: new Date(start).toISOString(), duration: 0 },
    ]);
    const entries = await Rhythm.getDayTimeline(today);
    assertEqual(entries.length, 1);
    assertEqual(entries[0].type, 'session-start');
  });

  it('only includes the in-window endpoint for sessions crossing midnight', async () => {
    rhClearStores();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Session started yesterday at 23:00, ran for 2h → ended today at 01:00
    const start = today.getTime() - 60 * 60 * 1000;
    rhSetSessions([
      { type: 'pomodoro', date: new Date(start).toISOString(), duration: 2 * 60 * 60 * 1000 },
    ]);
    const entries = await Rhythm.getDayTimeline(today);
    assertEqual(entries.length, 1);
    assertEqual(entries[0].type, 'session-end');
  });

  it('tags interval and cooking as wellness pillar', async () => {
    rhClearStores();
    const today = new Date();
    rhSetSessions([
      { type: 'interval', date: new Date(atDate(today, 7)).toISOString(), duration: 20 * 60 * 1000, programName: 'Tabata' },
      { type: 'cooking', date: new Date(atDate(today, 12)).toISOString(), duration: 10 * 60 * 1000, programName: 'Pasta' },
    ]);
    const entries = await Rhythm.getDayTimeline(today);
    const starts = entries.filter(e => e.type === 'session-start');
    assertEqual(starts.length, 2);
    assertEqual(starts.every(e => e.pillar === 'wellness'), true);
    assertEqual(starts[0].summary.includes('Tabata'), true);
  });

  it('skips sessions with unparseable date', async () => {
    rhClearStores();
    rhSetSessions([
      { type: 'flow', date: 'not-a-date', duration: 1000 },
      { type: 'flow', date: null, duration: 1000 },
    ]);
    const entries = await Rhythm.getDayTimeline(new Date());
    assertEqual(entries.length, 0);
  });
});

describe('Rhythm.getDayTimeline — dose entries', () => {
  it('emits dose-logged for each takenAt in the day', async () => {
    rhClearStores();
    rhSetSessions([]);
    const today = new Date();
    localStorage.setItem('wellness_meds', JSON.stringify({
      meds: [{
        id: 'm1', name: 'Vyvanse', dose: '60 mg', frequency: 'once-daily',
        doseLog: [
          { takenAt: atDate(today, 8) },
          { takenAt: atDate(today, 14) },
          { takenAt: atDate(today, 0) - 7200000 }, // yesterday — out of window
        ],
      }],
    }));
    const entries = await Rhythm.getDayTimeline(today);
    assertEqual(entries.length, 2);
    assertEqual(entries[0].type, 'dose-logged');
    assertEqual(entries[0].pillar, 'wellness');
    assertEqual(entries[0].summary.includes('Vyvanse'), true);
    assertEqual(entries[0].summary.includes('60 mg'), true);
  });

  it('skips entries without a numeric takenAt', async () => {
    rhClearStores();
    rhSetSessions([]);
    localStorage.setItem('wellness_meds', JSON.stringify({
      meds: [{ id: 'm1', name: 'X', doseLog: [{ takenAt: 'bad' }, { foo: 1 }] }],
    }));
    const entries = await Rhythm.getDayTimeline(new Date());
    assertEqual(entries.length, 0);
  });

  it('handles missing/malformed wellness_meds gracefully', async () => {
    rhClearStores();
    rhSetSessions([]);
    localStorage.setItem('wellness_meds', '{{not json');
    const entries = await Rhythm.getDayTimeline(new Date());
    assertEqual(entries.length, 0);
  });
});

describe('Rhythm.getDayTimeline — BFRB entries', () => {
  it('reads BfrbEvents.getAll() when available', async () => {
    rhClearStores();
    rhSetSessions([]);
    const today = new Date();
    const t = atDate(today, 11);
    // Seed the consolidated store directly so BfrbEvents.getAll reads it.
    localStorage.setItem('bfrb_events', JSON.stringify([
      { takenAt: t, context: 'flow', deviceId: 'd', updatedAt: t, schemaVersion: 1 },
    ]));
    localStorage.setItem('tempo_bfrb_events_migration_v1', '1');
    const entries = await Rhythm.getDayTimeline(today);
    assertEqual(entries.length, 1);
    assertEqual(entries[0].type, 'habit-checked');
    assertEqual(entries[0].module, 'bfrb');
    assertEqual(entries[0].metadata.context, 'flow');
  });

  it('falls back to legacy keys when BfrbEvents is empty', async () => {
    rhClearStores();
    rhSetSessions([]);
    // Force consolidated store empty
    localStorage.setItem('bfrb_events', JSON.stringify([]));
    localStorage.setItem('tempo_bfrb_events_migration_v1', '1');
    const today = new Date();
    const t = atDate(today, 15);
    localStorage.setItem('flow_bfrbs', JSON.stringify([{ timestamp: t }]));
    const entries = await Rhythm.getDayTimeline(today);
    assertEqual(entries.length, 1);
    assertEqual(entries[0].metadata.context, 'flow');
  });
});

describe('Rhythm.getDayTimeline — nap entries', () => {
  it('emits start + end for naps logged on the requested date', async () => {
    rhClearStores();
    rhSetSessions([]);
    const today = new Date();
    const dayKey = Rhythm._internals.localDateKey(today);
    const start = atDate(today, 14);
    localStorage.setItem('wellness_rest_log', JSON.stringify({
      [dayKey]: { naps: [{ startedAt: start, durationMs: 30 * 60 * 1000 }] },
    }));
    const entries = await Rhythm.getDayTimeline(today);
    assertEqual(entries.length, 2);
    assertEqual(entries[0].module, 'nap');
    assertEqual(entries[0].type, 'session-start');
    assertEqual(entries[1].type, 'session-end');
    assertEqual(entries[1].pillar, 'wellness');
  });

  it('emits only start for zero-duration naps', async () => {
    rhClearStores();
    rhSetSessions([]);
    const today = new Date();
    const dayKey = Rhythm._internals.localDateKey(today);
    localStorage.setItem('wellness_rest_log', JSON.stringify({
      [dayKey]: { naps: [{ startedAt: atDate(today, 12), durationMs: 0 }] },
    }));
    const entries = await Rhythm.getDayTimeline(today);
    assertEqual(entries.length, 1);
  });
});

describe('Rhythm.getDayTimeline — sorting + mixing', () => {
  it('sorts entries across all sources by ascending time', async () => {
    rhClearStores();
    const today = new Date();
    const dayKey = Rhythm._internals.localDateKey(today);
    rhSetSessions([
      { type: 'flow', date: new Date(atDate(today, 9)).toISOString(), duration: 90 * 60 * 1000 },
    ]);
    localStorage.setItem('wellness_meds', JSON.stringify({
      meds: [{ id: 'm', name: 'X', doseLog: [{ takenAt: atDate(today, 8) }] }],
    }));
    localStorage.setItem('wellness_rest_log', JSON.stringify({
      [dayKey]: { naps: [{ startedAt: atDate(today, 13), durationMs: 20 * 60 * 1000 }] },
    }));
    const entries = await Rhythm.getDayTimeline(today);
    // Expect: 8:00 dose, 9:00 flow-start, 10:30 flow-end, 13:00 nap-start, 13:20 nap-end
    assertEqual(entries.length, 5);
    for (let i = 1; i < entries.length; i++) {
      assert(entries[i].time >= entries[i - 1].time, 'entries should be sorted ascending');
    }
    assertEqual(entries[0].type, 'dose-logged');
    assertEqual(entries[1].type, 'session-start');
    assertEqual(entries[1].module, 'flow');
  });
});

describe('Rhythm.getCurrentDayStatus', () => {
  it('reports activeNow when a session straddles "now"', async () => {
    rhClearStores();
    const now = Date.now();
    // A flow session started 30 min ago, runs 90 min total. Still active.
    rhSetSessions([
      { type: 'flow', date: new Date(now - 30 * 60 * 1000).toISOString(), duration: 90 * 60 * 1000 },
    ]);
    const status = await Rhythm.getCurrentDayStatus(now);
    assert(status.activeNow !== null, 'expected an active session');
    assertEqual(status.activeNow.module, 'flow');
  });

  it('reports upcoming as the next entry after now', async () => {
    rhClearStores();
    const now = Date.now();
    // Session 1h in the future
    rhSetSessions([
      { type: 'pomodoro', date: new Date(now + 60 * 60 * 1000).toISOString(), duration: 25 * 60 * 1000 },
    ]);
    const status = await Rhythm.getCurrentDayStatus(now);
    assertEqual(status.activeNow, null);
    assert(status.upcoming !== null, 'expected upcoming entry');
    assertEqual(status.upcoming.type, 'session-start');
  });

  it('returns null activeNow + upcoming on an empty day', async () => {
    rhClearStores();
    rhSetSessions([]);
    const status = await Rhythm.getCurrentDayStatus();
    assertEqual(status.activeNow, null);
    assertEqual(status.upcoming, null);
    assertEqual(status.totalEntries, 0);
  });
});

// Restore stubs after the suite — analytics tests do the same.
window.History = _rhRealHistory;
