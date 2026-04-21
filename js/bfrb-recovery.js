// ── BFRB Recovery Timer ──
// Competing-response routine (Habit Reversal Training): after logging a BFRB
// catch, the user performs a replacement behavior (e.g., tongue to roof of
// mouth, hands flat on thighs) for a short period. The app runs a 60s
// in-button countdown that creates cognitive friction around the habit.
//
// Shared between Flow and Pomodoro BFRB buttons. Per-button state is keyed
// by element id so multiple buttons can have independent recoveries.

const BFRBRecovery = (() => {
  const DURATION_MS = 60 * 1000;
  const TICK_MS = 250;
  const sessions = new Map(); // btnId → { endsAt, intervalId, baseLabelFn }

  function cancel(btnId) {
    const s = sessions.get(btnId);
    if (!s) return;
    clearInterval(s.intervalId);
    sessions.delete(btnId);
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.classList.remove('bfrb-recovery-active');
      btn.style.removeProperty('--bfrb-recovery-progress');
      if (s.baseLabelFn) btn.textContent = s.baseLabelFn();
    }
  }

  function start(btnId, baseLabelFn) {
    const btn = document.getElementById(btnId);
    if (!btn) return;

    cancel(btnId);

    const endsAt = Date.now() + DURATION_MS;
    btn.classList.add('bfrb-recovery-active');

    const tick = () => {
      const remaining = endsAt - Date.now();
      if (remaining <= 0) {
        const s = sessions.get(btnId);
        clearInterval(s?.intervalId);
        sessions.delete(btnId);
        btn.classList.remove('bfrb-recovery-active');
        btn.style.removeProperty('--bfrb-recovery-progress');
        btn.textContent = baseLabelFn();
        if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
        // Two-note ascending chime — short but noticeable. Respects the
        // user's global mute toggle via the SFX module.
        if (typeof SFX !== 'undefined') SFX.playPhaseChange();
        return;
      }
      const progress = remaining / DURATION_MS; // 1 → 0
      btn.style.setProperty('--bfrb-recovery-progress', progress.toFixed(3));
      const secs = Math.ceil(remaining / 1000);
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      btn.textContent = `${m}:${String(s).padStart(2, '0')}`;
    };

    tick();
    const intervalId = setInterval(tick, TICK_MS);
    sessions.set(btnId, { endsAt, intervalId, baseLabelFn });
  }

  function isActive(btnId) {
    return sessions.has(btnId);
  }

  return { start, cancel, isActive };
})();
