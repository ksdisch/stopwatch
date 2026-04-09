// ── Analytics Engine ──
const Analytics = (() => {

  function getDateStr(d) {
    return d.toISOString().split('T')[0];
  }

  function startOfWeek(d) {
    const s = new Date(d);
    s.setDate(s.getDate() - s.getDay());
    s.setHours(0, 0, 0, 0);
    return s;
  }

  async function getTotalTimeByMode() {
    const sessions = await History.getSessions();
    const totals = {};
    sessions.forEach(s => {
      const mode = s.type || 'stopwatch';
      totals[mode] = (totals[mode] || 0) + (s.duration || 0);
    });
    return totals;
  }

  async function getWeeklyTotals(weekCount = 8) {
    const sessions = await History.getSessions();
    const now = new Date();
    const weeks = [];

    for (let w = weekCount - 1; w >= 0; w--) {
      const weekStart = startOfWeek(new Date(now.getTime() - w * 7 * 86400000));
      const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
      const label = weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const totals = {};

      sessions.forEach(s => {
        const d = new Date(s.date);
        if (d >= weekStart && d < weekEnd) {
          const mode = s.type || 'stopwatch';
          totals[mode] = (totals[mode] || 0) + (s.duration || 0);
        }
      });

      weeks.push({ label, totals });
    }
    return weeks;
  }

  async function getActivityHeatmap(weeks = 26) {
    const sessions = await History.getSessions();
    const now = new Date();
    const dayCount = weeks * 7;
    const start = new Date(now);
    start.setDate(start.getDate() - dayCount + 1);
    start.setHours(0, 0, 0, 0);

    const map = {};
    sessions.forEach(s => {
      const d = getDateStr(new Date(s.date));
      if (!map[d]) map[d] = { count: 0, totalMs: 0 };
      map[d].count++;
      map[d].totalMs += s.duration || 0;
    });

    const result = [];
    for (let i = 0; i < dayCount; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const key = getDateStr(d);
      const entry = map[key] || { count: 0, totalMs: 0 };
      result.push({ date: key, dayOfWeek: d.getDay(), ...entry });
    }
    return result;
  }

  async function getPersonalBests() {
    const sessions = await History.getSessions();
    if (sessions.length === 0) return null;

    let longestSession = null;
    let mostLaps = null;
    let totalSessions = sessions.length;
    let totalTimeMs = 0;

    sessions.forEach(s => {
      totalTimeMs += s.duration || 0;
      if (!longestSession || (s.duration || 0) > (longestSession.duration || 0)) {
        longestSession = s;
      }
      if (Array.isArray(s.laps) && s.laps.length > 0) {
        if (!mostLaps || s.laps.length > mostLaps.laps.length) {
          mostLaps = s;
        }
      }
    });

    return { longestSession, mostLaps, totalSessions, totalTimeMs };
  }

  async function getTrends() {
    const sessions = await History.getSessions();
    const now = new Date();
    const thisWeekStart = startOfWeek(now);
    const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 86400000);

    let thisWeekMs = 0, thisWeekCount = 0;
    let lastWeekMs = 0, lastWeekCount = 0;

    sessions.forEach(s => {
      const d = new Date(s.date);
      if (d >= thisWeekStart) {
        thisWeekMs += s.duration || 0;
        thisWeekCount++;
      } else if (d >= lastWeekStart && d < thisWeekStart) {
        lastWeekMs += s.duration || 0;
        lastWeekCount++;
      }
    });

    return {
      thisWeek: { totalMs: thisWeekMs, count: thisWeekCount },
      lastWeek: { totalMs: lastWeekMs, count: lastWeekCount },
    };
  }

  return { getTotalTimeByMode, getWeeklyTotals, getActivityHeatmap, getPersonalBests, getTrends };
})();
