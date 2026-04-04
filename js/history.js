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
    sessions.push({
      id: Date.now(),
      date: new Date().toISOString(),
      type: session.type || 'stopwatch',
      duration: session.duration || 0,
      laps: session.laps || [],
      note: session.note || '',
      tags: session.tags || [],
    });
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

  function clearAll() {
    localStorage.removeItem(STORAGE_KEY);
  }

  return { getSessions, addSession, updateNote, deleteSession, clearAll };
})();
