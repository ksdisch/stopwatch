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
  // getDoseEntries now reads the live MedsManager (not the wellness_meds
  // blob, which meds.js deletes post-migration). Reset the in-memory
  // singleton so each case starts with zero meds.
  if (typeof MedsManager !== 'undefined' && MedsManager.clear) MedsManager.clear();
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
  it('emits dose-logged for each in-window takenAt, excluding out-of-window doses', async () => {
    rhClearStores();
    rhSetSessions([]);
    const today = new Date();
    // Seed via the LIVE manager — getDoseEntries reads MedsManager.all(),
    // not the deleted wellness_meds blob.
    const med = MedsManager.add({ name: 'Vyvanse', dose: '60 mg', frequency: 'once-daily' });
    med.logDose(atDate(today, 8));
    med.logDose(atDate(today, 14));
    med.logDose(atDate(today, 0) - 7200000); // yesterday — out of window
    const entries = await Rhythm.getDayTimeline(today);
    assertEqual(entries.length, 2);
    assertEqual(entries[0].type, 'dose-logged');
    assertEqual(entries[0].module, 'meds');
    assertEqual(entries[0].pillar, 'wellness');
    assertEqual(entries[0].summary.includes('Vyvanse'), true);
    assertEqual(entries[0].summary.includes('60 mg'), true);
    assertEqual(entries[0].metadata.medName, 'Vyvanse');
    assertEqual(entries[0].metadata.dose, '60 mg');
  });

  it('uses a half-open [start, end) window — keeps the day-start dose, drops the day-end dose', async () => {
    rhClearStores();
    rhSetSessions([]);
    const today = new Date();
    const dayStart = new Date(today); dayStart.setHours(0, 0, 0, 0);
    const startMs = dayStart.getTime();
    const endMs = startMs + 86400000;
    const med = MedsManager.add({ name: 'EdgeMed' });
    // Deterministic regardless of wall-clock: logDose stores timestamps
    // verbatim (no future-dose guard), so the endMs dose is dropped by
    // getDoseEntries' own `>= endMs` window check, not at log time.
    med.logDose(startMs); // exactly the day start → included (>= startMs)
    med.logDose(endMs);   // exactly the next day's start → excluded (>= endMs)
    const entries = await Rhythm.getDayTimeline(today);
    assertEqual(entries.length, 1);
    assertEqual(entries[0].type, 'dose-logged');
    assertEqual(entries[0].time, startMs);
  });

  it('ignores the legacy wellness_meds blob — reads MedsManager only (regression lock for backlog #13)', async () => {
    rhClearStores(); // clears MedsManager + removes wellness_meds
    rhSetSessions([]);
    const today = new Date();
    // A pre-migration blob lingering in storage must NOT be read: meds.js
    // deletes this key post-migration, and the live source is MedsManager.
    // With the manager empty, the timeline shows no dose events.
    localStorage.setItem('wellness_meds', JSON.stringify({
      meds: [{ id: 'm1', name: 'Ghost', dose: '10 mg',
               doseLog: [{ takenAt: atDate(today, 9) }] }],
    }));
    const entries = await Rhythm.getDayTimeline(today);
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

  it('ignores legacy keys — consolidated store is the only source (Pick-C cleanup)', async () => {
    rhClearStores();
    rhSetSessions([]);
    // Consolidated store empty + a residual legacy key present: pre-cleanup
    // this fell back to reading flow_bfrbs; post-cleanup the legacy keys are
    // dead input (bfrb-events.js deletes them at boot) and must NOT surface.
    localStorage.setItem('bfrb_events', JSON.stringify([]));
    localStorage.setItem('tempo_bfrb_events_migration_v1', '1');
    const today = new Date();
    const t = atDate(today, 15);
    localStorage.setItem('flow_bfrbs', JSON.stringify([{ timestamp: t }]));
    const entries = await Rhythm.getDayTimeline(today);
    assertEqual(entries.length, 0);
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
    const med = MedsManager.add({ name: 'X' });
    med.logDose(atDate(today, 8));
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
  // These cases pass an explicit, constructed `now` so the whole computation
  // anchors to that timestamp (getDayTimeline(new Date(now)) clips to now's
  // local day) — never to the wall clock. Building fixtures off Date.now()
  // used to flake within ~30 min of local midnight, where the relative
  // offsets crossed the day boundary and got clipped out of the timeline.
  it('reports activeNow when a session straddles "now"', async () => {
    rhClearStores();
    const now = atDate(new Date(), 12); // noon today → offsets stay same-day
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
    const now = atDate(new Date(), 12); // noon today → +1h stays same-day
    // Session 1h in the future
    rhSetSessions([
      { type: 'pomodoro', date: new Date(now + 60 * 60 * 1000).toISOString(), duration: 25 * 60 * 1000 },
    ]);
    const status = await Rhythm.getCurrentDayStatus(now);
    assertEqual(status.activeNow, null);
    assert(status.upcoming !== null, 'expected upcoming entry');
    assertEqual(status.upcoming.type, 'session-start');
  });

  it('detects a session active across local midnight (start clipped to yesterday)', async () => {
    rhClearStores();
    // now = 00:15 local; a 90-min flow block began at 23:45 yesterday and ends
    // at 01:15 today. getDayTimeline(today) holds only the session-END (the
    // start was clipped to yesterday's window), so the detection must
    // reconstruct activeNow from the end entry rather than miss it.
    const now = atDate(new Date(), 0, 15);
    const startedAt = now - 30 * 60 * 1000; // 23:45 yesterday
    rhSetSessions([
      { type: 'flow', date: new Date(startedAt).toISOString(), duration: 90 * 60 * 1000 },
    ]);
    // Precondition: only the in-window end survives.
    const timeline = await Rhythm.getDayTimeline(new Date(now));
    assertEqual(timeline.length, 1);
    assertEqual(timeline[0].type, 'session-end');
    const status = await Rhythm.getCurrentDayStatus(now);
    assert(status.activeNow !== null, 'expected the cross-midnight session to read as active');
    assertEqual(status.activeNow.module, 'flow');
    assertEqual(status.activeNow.endsAt, startedAt + 90 * 60 * 1000);
    // Banner must read like a same-day active session, not "... ended".
    assertEqual(status.activeNow.summary, 'Flow block started (1h 30m)');
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
// Leave the in-memory meds singleton clean for any later suite.
if (typeof MedsManager !== 'undefined' && MedsManager.clear) MedsManager.clear();
