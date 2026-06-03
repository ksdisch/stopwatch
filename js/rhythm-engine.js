// Rhythm engine: read-side aggregator that assembles a daily timeline
// from existing modules (History, Meds, BfrbEvents, rest log). Entry
// shape matches docs/TEMPO-PLAN.md §8.10.
//
// 'alert-due' is in the spec but stopwatch alert fires aren't persisted
// with a firedAt timestamp — deferred until that's wired up.
const Rhythm = (() => {

  function dayBoundsMs(date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86400000);
    return { startMs: start.getTime(), endMs: end.getTime() };
  }

  const PILLAR_BY_TYPE = {
    flow: 'productivity',
    pomodoro: 'productivity',
    stopwatch: 'productivity',
    timer: 'productivity',
    sequence: 'productivity',
    interval: 'wellness',
    cooking: 'wellness',
    nap: 'wellness',
    dose: 'wellness',
    bfrb: 'wellness',
  };

  function pillarForType(t) {
    return PILLAR_BY_TYPE[t] || 'productivity';
  }

  function formatDurationShort(ms) {
    if (!ms || ms < 0) return '';
    const totalSec = Math.round(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return s > 0 && m < 5 ? `${m}m ${s}s` : `${m}m`;
    return `${s}s`;
  }

  function labelForSessionType(t) {
    switch (t) {
      case 'flow': return 'Flow block';
      case 'pomodoro': return 'Pomodoro';
      case 'interval': return 'Workout';
      case 'cooking': return 'Cooking';
      case 'stopwatch': return 'Stopwatch';
      case 'timer': return 'Timer';
      case 'sequence': return 'Sequence';
      default: return t || 'Session';
    }
  }

  function readJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  // A session that straddles midnight appears on both days, but each day
  // only shows its in-window endpoint.
  async function getSessionEntries(startMs, endMs) {
    if (typeof History === 'undefined' || typeof History.getSessions !== 'function') {
      return [];
    }
    const sessions = await History.getSessions();
    const out = [];
    sessions.forEach(s => {
      const startedAt = s.date ? new Date(s.date).getTime() : NaN;
      if (!Number.isFinite(startedAt)) return;
      const duration = s.duration || 0;
      const endedAt = startedAt + duration;
      const type = s.type || 'stopwatch';
      const pillar = pillarForType(type);
      const label = labelForSessionType(type);
      const name = s.programName ? `${label} · ${s.programName}` : label;
      const durStr = formatDurationShort(duration);

      if (startedAt >= startMs && startedAt < endMs) {
        out.push({
          time: startedAt,
          type: 'session-start',
          module: type,
          pillar,
          summary: durStr ? `${name} started (${durStr})` : `${name} started`,
          metadata: {
            sessionType: type,
            durationMs: duration,
            programName: s.programName || null,
          },
        });
      }
      if (duration > 0 && endedAt >= startMs && endedAt < endMs) {
        out.push({
          time: endedAt,
          type: 'session-end',
          module: type,
          pillar,
          summary: durStr ? `${name} ended (${durStr})` : `${name} ended`,
          metadata: {
            sessionType: type,
            durationMs: duration,
            programName: s.programName || null,
          },
        });
      }
    });
    return out;
  }

  // Reads the LIVE meds source (MedsManager) rather than the legacy
  // `wellness_meds` blob: js/meds.js F18 per-record migration
  // (_migrateLegacyBlob) deletes that key after moving each med to its own
  // `meds/{medId}` key, so the blob is gone on any device that's migrated.
  // Mirrors the Insights Meds-vs-Sleep panel + js/rhythm-insights.js _deps,
  // which already read via MedsManager.all() + per-med getDoseLog().
  function getDoseEntries(startMs, endMs) {
    if (typeof MedsManager === 'undefined' || typeof MedsManager.all !== 'function') {
      return [];
    }
    const out = [];
    MedsManager.all().forEach(med => {
      if (!med || typeof med.getDoseLog !== 'function') return;
      const medId = (typeof med.getId === 'function' && med.getId()) || null;
      const medName = (typeof med.getName === 'function' && med.getName()) || 'Medication';
      const medDose = (typeof med.getDose === 'function' && med.getDose()) || '';
      const dose = medDose ? ` ${medDose}` : '';
      const doseLog = med.getDoseLog() || [];
      doseLog.forEach(d => {
        if (!d || typeof d.takenAt !== 'number') return;
        if (d.takenAt < startMs || d.takenAt >= endMs) return;
        out.push({
          time: d.takenAt,
          type: 'dose-logged',
          module: 'meds',
          pillar: 'wellness',
          summary: `${medName}${dose} taken`,
          metadata: { medId, medName, dose: medDose },
        });
      });
    });
    return out;
  }

  // Legacy fallback fires only when the consolidated F3 store is empty —
  // mirrors the analytics.js BfrbEvents fallback pattern. Remove when the
  // legacy bfrbs_global / flow_bfrbs / pomodoro_bfrbs cleanup PR lands.
  function getBfrbEntries(startMs, endMs) {
    const events = [];
    if (typeof BfrbEvents !== 'undefined' && typeof BfrbEvents.getAll === 'function') {
      try {
        const all = BfrbEvents.getAll();
        if (Array.isArray(all)) all.forEach(e => events.push(e));
      } catch (_) { /* malformed — skip */ }
    }
    if (events.length === 0) {
      ['bfrbs_global', 'flow_bfrbs', 'pomodoro_bfrbs'].forEach(key => {
        const arr = readJSON(key);
        if (!Array.isArray(arr)) return;
        const ctx = key === 'flow_bfrbs' ? 'flow' : key === 'pomodoro_bfrbs' ? 'pomodoro' : 'global';
        arr.forEach(e => {
          if (!e || typeof e.timestamp !== 'number') return;
          events.push({ takenAt: e.timestamp, context: ctx });
        });
      });
    }
    const out = [];
    events.forEach(e => {
      const t = typeof e.takenAt === 'number' ? e.takenAt : null;
      if (t === null) return;
      if (t < startMs || t >= endMs) return;
      out.push({
        time: t,
        type: 'habit-checked',
        module: 'bfrb',
        pillar: 'wellness',
        summary: 'BFRB caught',
        metadata: { context: e.context || 'global' },
      });
    });
    return out;
  }

  function getNapEntries(date, startMs, endMs) {
    const log = readJSON('wellness_rest_log');
    if (!log || typeof log !== 'object') return [];
    const day = log[Utils.localDateKey(date)];
    if (!day || !Array.isArray(day.naps)) return [];
    const out = [];
    day.naps.forEach(n => {
      if (!n || typeof n.startedAt !== 'number') return;
      if (n.startedAt < startMs || n.startedAt >= endMs) return;
      const dur = n.durationMs || 0;
      const durStr = formatDurationShort(dur);
      out.push({
        time: n.startedAt,
        type: 'session-start',
        module: 'nap',
        pillar: 'wellness',
        summary: durStr ? `Nap started (${durStr})` : 'Nap started',
        metadata: { durationMs: dur, endedEarly: !!n.endedEarly },
      });
      if (dur > 0) {
        const ended = n.startedAt + dur;
        if (ended >= startMs && ended < endMs) {
          out.push({
            time: ended,
            type: 'session-end',
            module: 'nap',
            pillar: 'wellness',
            summary: durStr ? `Nap ended (${durStr})` : 'Nap ended',
            metadata: { durationMs: dur, endedEarly: !!n.endedEarly },
          });
        }
      }
    });
    return out;
  }

  async function getDayTimeline(date) {
    const d = date instanceof Date ? date : new Date(date);
    const { startMs, endMs } = dayBoundsMs(d);
    const sessions = await getSessionEntries(startMs, endMs);
    const doses = getDoseEntries(startMs, endMs);
    const bfrbs = getBfrbEntries(startMs, endMs);
    const naps = getNapEntries(d, startMs, endMs);
    const all = [...sessions, ...doses, ...bfrbs, ...naps];
    all.sort((a, b) => a.time - b.time);
    return all;
  }

  // Two call shapes:
  //   getCurrentDayStatus()                  — fetch + analyze today
  //   getCurrentDayStatus(now, timeline)     — analyze a precomputed
  //                                            timeline (used by RhythmUI
  //                                            to avoid a second History
  //                                            read on every paint)
  async function getCurrentDayStatus(now, timeline) {
    if (typeof now !== 'number') now = Date.now();
    if (!Array.isArray(timeline)) {
      timeline = await getDayTimeline(new Date(now));
    }
    let activeNow = null;
    let upcoming = null;
    const startsByKey = new Map();
    for (const e of timeline) {
      if (e.type === 'session-start') {
        const key = `${e.module}|${e.metadata.durationMs || 0}|${e.time}`;
        startsByKey.set(key, e);
      } else if (e.type === 'session-end') {
        const startedAt = e.time - (e.metadata.durationMs || 0);
        const key = `${e.module}|${e.metadata.durationMs || 0}|${startedAt}`;
        const start = startsByKey.get(key);
        if (start && start.time <= now && e.time > now) {
          activeNow = { ...start, endsAt: e.time };
        }
      }
      if (!upcoming && e.time > now) upcoming = e;
    }
    return { activeNow, upcoming, totalEntries: timeline.length };
  }

  return {
    getDayTimeline,
    getCurrentDayStatus,
    _internals: { pillarForType, formatDurationShort, labelForSessionType, localDateKey: Utils.localDateKey },
  };
})();
