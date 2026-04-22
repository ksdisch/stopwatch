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

  // Local-date key (YYYY-MM-DD in the user's local timezone). The existing
  // getDateStr uses UTC, which would mis-bucket evening sessions — fine for
  // rough heatmap intensity, wrong for "did I focus today" streak math.
  function localDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  // Focus streak: consecutive local-calendar days with at least one focus
  // session (flow or pomodoro). Returns current streak, longest ever, and
  // a 7-day "did I focus?" strip for the dashboard dots.
  //
  // "Current" has a 1-day grace: if today has no session yet but yesterday
  // did, the streak is still alive (the user can still hit today before
  // midnight). We expose `activeToday` so the UI can distinguish between
  // "streak at 3 — locked in today" vs "streak at 3 — don't break it today."
  async function getFocusStreak() {
    const sessions = await History.getSessions();
    const FOCUS_TYPES = new Set(['flow', 'pomodoro']);
    const focusDays = new Set();
    sessions.forEach(s => {
      if (!FOCUS_TYPES.has(s.type)) return;
      if (!s.date) return;
      focusDays.add(localDateKey(new Date(s.date)));
    });

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayKey = localDateKey(today);
    const activeToday = focusDays.has(todayKey);

    // Current streak: walk backward from today (or yesterday if today empty)
    // while each day is a focus day.
    let current = 0;
    const cursor = new Date(today);
    if (!activeToday) {
      // 1-day grace: start from yesterday instead
      cursor.setDate(cursor.getDate() - 1);
    }
    while (focusDays.has(localDateKey(cursor))) {
      current++;
      cursor.setDate(cursor.getDate() - 1);
    }

    // Longest streak: scan all focus days in chronological order.
    const sortedDays = [...focusDays].sort();
    let longest = 0;
    let run = 0;
    let prevKey = null;
    for (const key of sortedDays) {
      if (prevKey === null) { run = 1; }
      else {
        const diff = Math.round(
          (new Date(key) - new Date(prevKey)) / 86400000
        );
        run = diff === 1 ? run + 1 : 1;
      }
      if (run > longest) longest = run;
      prevKey = key;
    }

    // Recent 7 days, newest first. UI renders oldest-first as dots.
    const recent7 = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      recent7.push({
        date: localDateKey(d),
        hasFocus: focusDays.has(localDateKey(d)),
        isToday: i === 0,
      });
    }

    return { current, longest, recent7, activeToday };
  }

  // Flow completion rate (ANALYTICS-PLAN § D).
  // For every saved Flow session, compare planned (blockDurationMs) to actual
  // (duration) and check the endedEarly flag. Returns:
  //   total, completed, endedEarly, completionRate (0–1),
  //   avgDurationPct (0–1, avg of actual/planned across sessions that have both).
  //
  // Notes:
  // - Flow sessions are only persisted once the focus phase completes or the
  //   user clicks "End Early" — Flow.reset() on a paused abandoned block does
  //   NOT write to History. So every session in this stream was a real attempt.
  // - Pre-end-early sessions (merged before PR #22) lack endedEarly. Default
  //   to `false` (they DID complete, that was the only path to history then).
  // - Sessions lacking blockDurationMs (shouldn't happen, but defensive) are
  //   skipped from avgDurationPct but still counted in totals.
  async function getFlowCompletion() {
    const sessions = await History.getSessions();
    const flows = sessions.filter(s => s.type === 'flow');
    const total = flows.length;
    let endedEarly = 0;
    let pctSum = 0;
    let pctCount = 0;
    flows.forEach(s => {
      if (s.endedEarly === true) endedEarly++;
      if (s.blockDurationMs && s.duration) {
        pctSum += Math.min(1, s.duration / s.blockDurationMs);
        pctCount++;
      }
    });
    const completed = total - endedEarly;
    return {
      total,
      completed,
      endedEarly,
      completionRate: total > 0 ? completed / total : 0,
      avgDurationPct: pctCount > 0 ? pctSum / pctCount : 0,
    };
  }

  // Distraction patterns (ANALYTICS-PLAN § E + F).
  // Collects every distraction entry across Pomodoro + Flow sessions, then
  // produces:
  //   - top5 categories, split by source mode (flow vs pomodoro)
  //   - hourly[0..23] counts (local time)
  //   - total across all time
  //
  // Time window is all-time. Distraction counts per session are low, so a
  // rolling window would too often be empty. If Analytics grows a
  // time-selector later, this function can accept a `days` arg.
  async function getDistractions() {
    const sessions = await History.getSessions();
    const entries = [];
    sessions.forEach(s => {
      if (!Array.isArray(s.distractions)) return;
      if (s.type !== 'flow' && s.type !== 'pomodoro') return;
      s.distractions.forEach(d => {
        entries.push({
          category: d.category || 'other',
          timestamp: d.timestamp,
          mode: s.type,
        });
      });
    });

    // Top 5 categories, with per-mode split so the UI can show a stacked bar.
    const byCategory = {};
    entries.forEach(e => {
      const slot = byCategory[e.category] || { flow: 0, pomodoro: 0 };
      slot[e.mode] = (slot[e.mode] || 0) + 1;
      byCategory[e.category] = slot;
    });
    const top5 = Object.entries(byCategory)
      .map(([category, counts]) => ({
        category,
        flow: counts.flow || 0,
        pomodoro: counts.pomodoro || 0,
        total: (counts.flow || 0) + (counts.pomodoro || 0),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    // Hour-of-day histogram (local time). Entries without a timestamp are
    // skipped — they predate the log schema and can't be bucketed.
    const hourly = new Array(24).fill(0);
    entries.forEach(e => {
      if (typeof e.timestamp !== 'number') return;
      const h = new Date(e.timestamp).getHours();
      hourly[h]++;
    });

    return {
      total: entries.length,
      top5,
      hourly,
    };
  }

  return {
    getTotalTimeByMode, getWeeklyTotals, getActivityHeatmap,
    getPersonalBests, getTrends, getFocusStreak, getFlowCompletion,
    getDistractions,
  };
})();
