const History = (() => {
  const STORAGE_KEY = 'stopwatch_history';

  function getSessions() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) { return []; }
  }

  function saveSessions(sessions) {
    try {
      // Keep last 100 sessions
      const trimmed = sessions.slice(-100);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) { /* storage full */ }
  }

  function addSession(session) {
    const sessions = getSessions();
    const entry = {
      id: Date.now(),
      date: new Date().toISOString(),
      type: session.type || 'stopwatch',
      duration: session.duration || 0,
      laps: session.laps || [],
      note: session.note || '',
      tags: session.tags || [],
    };
    // Pomodoro-specific metadata
    if (session.completedCycles !== undefined) entry.completedCycles = session.completedCycles;
    if (session.totalWorkMs !== undefined) entry.totalWorkMs = session.totalWorkMs;
    if (session.focusGoals) entry.focusGoals = session.focusGoals;
    if (session.breakTasks) entry.breakTasks = session.breakTasks;
    if (session.actualWork) entry.actualWork = session.actualWork;
    if (session.sessionStartedAt) entry.sessionStartedAt = session.sessionStartedAt;
    if (session.sessionEndedAt) entry.sessionEndedAt = session.sessionEndedAt;
    if (session.phaseLog) entry.phaseLog = session.phaseLog;
    sessions.push(entry);
    saveSessions(sessions);
  }

  function updateNote(id, note) {
    const sessions = getSessions();
    const session = sessions.find(s => s.id === id);
    if (session) {
      session.note = note;
      saveSessions(sessions);
    }
  }

  function deleteSession(id) {
    const sessions = getSessions().filter(s => s.id !== id);
    saveSessions(sessions);
  }

  function addTag(sessionId, tag) {
    const sessions = getSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      if (!Array.isArray(session.tags)) session.tags = [];
      const normalized = tag.trim().toLowerCase();
      if (normalized && !session.tags.includes(normalized)) {
        session.tags.push(normalized);
        saveSessions(sessions);
      }
    }
  }

  function removeTag(sessionId, tag) {
    const sessions = getSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (session && Array.isArray(session.tags)) {
      session.tags = session.tags.filter(t => t !== tag);
      saveSessions(sessions);
    }
  }

  function getAllTags() {
    const sessions = getSessions();
    const tagSet = new Set();
    sessions.forEach(s => {
      if (Array.isArray(s.tags)) {
        s.tags.forEach(t => tagSet.add(t));
      }
    });
    return Array.from(tagSet).sort();
  }

  function clearAll() {
    localStorage.removeItem(STORAGE_KEY);
  }

  return { getSessions, addSession, updateNote, deleteSession, clearAll, addTag, removeTag, getAllTags };
})();
