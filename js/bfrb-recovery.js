// ── BFRB Recovery Timer ──
// Competing-response routine (Habit Reversal Training): after logging a BFRB
// catch, the user performs a replacement behavior (e.g., tongue to roof of
// mouth, hands flat on thighs) for a short period. The app runs a 60s
// in-button countdown that creates cognitive friction around the habit.
//
// Keyed by element id so multiple buttons can have independent recoveries.
// Post-F3 consolidation the global BFRB FAB (js/global-bfrb.js) is the sole
// live caller of start(); the Flow/Pomodoro per-button tallies moved to that
// FAB (see flow-ui.js / pomodoro-ui.js), leaving this keying as a
// general-purpose seam for any future per-button recovery.

const BFRBRecovery = (() => {
  const DURATION_MS = 60 * 1000;
  const TICK_MS = 250;
  const sessions = new Map(); // btnId → { endsAt, intervalId, baseLabelFn }

  // ── If-then competing-response plan banner (Slice B) ──────────────────
  // The user authors a short plan in their OWN words (settings drawer →
  // bfrb_if_then_plan); we surface it during the 60s countdown as a gentle
  // reminder of the replacement behavior. User content → no framing risk, no
  // opt-in gate. Shown while ANY recovery is active, hidden once the last one
  // ends. No plan set → no banner. textContent keeps it XSS-safe.
  const PLAN_KEY = 'bfrb_if_then_plan';
  const PLAN_EL_ID = 'bfrb-recovery-plan';

  function _planText() {
    let raw = '';
    try { raw = localStorage.getItem(PLAN_KEY) || ''; } catch (_) { raw = ''; }
    return typeof raw === 'string' ? raw.trim() : '';
  }

  function _showPlan() {
    const el = document.getElementById(PLAN_EL_ID);
    if (!el) return;
    const text = _planText();
    if (!text) { el.hidden = true; return; }
    const textEl = el.querySelector('.bfrb-recovery-plan-text');
    if (textEl) textEl.textContent = text;
    else el.textContent = text;
    el.hidden = false;
  }

  // Hide the banner once no countdown is running (called after each delete).
  function _hidePlanIfIdle() {
    if (sessions.size > 0) return;
    const el = document.getElementById(PLAN_EL_ID);
    if (el) el.hidden = true;
  }

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
    _hidePlanIfIdle();
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
        _hidePlanIfIdle();
        Platform.haptic([30, 40, 30]);
        // Two-note ascending chime — short but noticeable. Respects the
        // user's global mute toggle via the SFX module.
        if (typeof SFX !== 'undefined') SFX.playBFRBEnd();
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

    // Surface the user's competing-response plan for the duration of the countdown.
    _showPlan();
  }

  function isActive(btnId) {
    return sessions.has(btnId);
  }

  return { start, cancel, isActive };
})();
