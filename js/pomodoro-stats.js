// ── Pomodoro Stats Engine ──
const PomodoroStats = (() => {
  async function getPomodoroSessions() {
    return (await History.getSessions()).filter(s => s.type === 'pomodoro');
  }

  function getDateStr(isoDate) {
    return new Date(isoDate).toISOString().split('T')[0]; // YYYY-MM-DD
  }

  async function getCompletedCyclesThisWeek() {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay()); // Sunday
    weekStart.setHours(0, 0, 0, 0);

    return (await getPomodoroSessions())
      .filter(s => new Date(s.date) >= weekStart)
      .reduce((sum, s) => sum + (s.completedCycles || 0), 0);
  }

  async function getTotalWorkMsThisWeek() {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);

    return (await getPomodoroSessions())
      .filter(s => new Date(s.date) >= weekStart)
      .reduce((sum, s) => sum + (s.totalWorkMs || s.duration || 0), 0);
  }

  async function getCurrentStreak() {
    const sessions = (await getPomodoroSessions()).filter(s => (s.completedCycles || 0) >= 1);
    if (sessions.length === 0) return 0;

    // Get unique dates with completed cycles, sorted descending
    const dates = [...new Set(sessions.map(s => getDateStr(s.date)))].sort().reverse();

    const today = getDateStr(new Date().toISOString());
    const yesterday = getDateStr(new Date(Date.now() - 86400000).toISOString());

    // Streak must include today or yesterday
    if (dates[0] !== today && dates[0] !== yesterday) return 0;

    let streak = 1;
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1]);
      const curr = new Date(dates[i]);
      const diffDays = Math.round((prev - curr) / 86400000);
      if (diffDays === 1) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }

  async function getDailyMinutesThisWeek() {
    const now = new Date();
    const sessions = await getPomodoroSessions();
    const result = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dateStr = getDateStr(d.toISOString());
      const dayLabel = d.toLocaleDateString(undefined, { weekday: 'short' });

      const dayMs = sessions
        .filter(s => getDateStr(s.date) === dateStr)
        .reduce((sum, s) => sum + (s.totalWorkMs || s.duration || 0), 0);

      result.push({ label: dayLabel, minutes: Math.round(dayMs / 60000) });
    }
    return result;
  }

  return { getCompletedCyclesThisWeek, getTotalWorkMsThisWeek, getCurrentStreak, getDailyMinutesThisWeek };
})();
