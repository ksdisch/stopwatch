// Wellness › Recovery surface — rest tracking dashboard.
//
// V1 scope: a minimal daily rest log. Three components:
//   1. Sleep log for last night (hours + quality 1–5)
//   2. Nap tracker with preset durations (20 / 30 / 60 / 90 min)
//   3. Status card deriving "Last focus block: N hours ago" from History
//
// Storage lives in localStorage under `wellness_rest_log`, keyed by date
// string (YYYY-MM-DD). Naps are appended as {startedAt, durationMs}
// entries on the day they completed. No session-history writes — rest
// events are daily log rows, not session-style records, so they stay in
// localStorage and don't pollute the stopwatch-style analytics (yet).

const RecoveryUI = (() => {
  const STORAGE_KEY = 'wellness_rest_log';
  const NAP_PRESETS = [
    { label: '20 min', ms: 20 * 60 * 1000 },
    { label: '30 min', ms: 30 * 60 * 1000 },
    { label: '60 min', ms: 60 * 60 * 1000 },
    { label: '90 min', ms: 90 * 60 * 1000 },
  ];
  const QUALITY_OPTIONS = [1, 2, 3, 4, 5];

  // In-flight nap timer state. Purely local UI — no persistence across
  // reloads (if the user closes the tab mid-nap, the timer is gone).
  let napState = null; // { startedAt, durationMs, intervalId, surface }
  let refreshTickId = null;

  // ── Storage ────────────────────────────────────────────────────────

  function loadLog() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    } catch (e) { return {}; }
  }

  function saveLog(log) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  }

  function getDateStr(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  function getDayEntry(dateStr, log) {
    return log[dateStr] || { sleep: null, naps: [] };
  }

  function setSleep(dateStr, sleep) {
    const log = loadLog();
    const day = getDayEntry(dateStr, log);
    day.sleep = sleep;
    log[dateStr] = day;
    saveLog(log);
  }

  function clearSleep(dateStr) {
    const log = loadLog();
    const day = log[dateStr];
    if (!day) return;
    day.sleep = null;
    if (!day.naps || day.naps.length === 0) delete log[dateStr];
    else log[dateStr] = day;
    saveLog(log);
  }

  function addNap(dateStr, nap) {
    const log = loadLog();
    const day = getDayEntry(dateStr, log);
    day.naps = day.naps || [];
    day.naps.push(nap);
    log[dateStr] = day;
    saveLog(log);
  }

  // ── Derived status ─────────────────────────────────────────────────

  async function getSinceLastFocusLabel() {
    try {
      const sessions = await History.getSessions();
      const focusTypes = new Set(['flow', 'pomodoro']);
      const focus = sessions
        .filter(s => focusTypes.has(s.type))
        .sort((a, b) => (b.sessionEndedAt || b.date || 0) - (a.sessionEndedAt || a.date || 0));
      if (focus.length === 0) return 'No focus sessions logged yet';
      const latest = focus[0];
      const endedAt = latest.sessionEndedAt || new Date(latest.date).getTime();
      const deltaMs = Date.now() - endedAt;
      if (deltaMs < 0) return 'Focus session in progress';
      const label = formatAgo(deltaMs);
      const kind = latest.type === 'flow' ? 'Flow block' : 'Pomodoro';
      return `Last ${kind}: ${label} ago`;
    } catch (e) {
      return '—';
    }
  }

  async function getFocusMinutesToday() {
    try {
      const sessions = await History.getSessions();
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const focusTypes = new Set(['flow', 'pomodoro']);
      const total = sessions
        .filter(s => focusTypes.has(s.type))
        .filter(s => {
          const d = new Date(s.date);
          return d >= todayStart;
        })
        .reduce((sum, s) => sum + (s.duration || 0), 0);
      return Math.round(total / 60000);
    } catch (e) {
      return 0;
    }
  }

  function formatAgo(ms) {
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'moments';
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    if (h < 24) return rm === 0 ? `${h} hr` : `${h} hr ${rm} min`;
    const d = Math.floor(h / 24);
    return d === 1 ? '1 day' : `${d} days`;
  }

  function formatNapDuration(ms) {
    const m = Math.round(ms / 60000);
    return `${m} min`;
  }

  // ── Rendering ──────────────────────────────────────────────────────

  function render(surface) {
    if (!surface) return;

    const today = getDateStr();
    const log = loadLog();
    const todayEntry = getDayEntry(today, log);
    const last7 = getLast7Days(log);

    surface.innerHTML = `
      <div class="recovery-surface">
        <div id="recovery-status" class="recovery-status-card">
          <div class="recovery-status-row">
            <span class="recovery-status-label">Last focus</span>
            <span id="recovery-last-focus" class="recovery-status-value">…</span>
          </div>
          <div class="recovery-status-row">
            <span class="recovery-status-label">Focus today</span>
            <span id="recovery-today-focus" class="recovery-status-value">…</span>
          </div>
        </div>

        <section class="recovery-section">
          <h3 class="recovery-section-title">Last night's sleep</h3>
          ${renderSleepCard(todayEntry.sleep)}
        </section>

        <section class="recovery-section">
          <h3 class="recovery-section-title">Nap</h3>
          ${renderNapCard()}
        </section>

        <section class="recovery-section">
          <h3 class="recovery-section-title">Last 7 days</h3>
          ${renderTrend(last7)}
        </section>
      </div>
    `;

    wireSleepCard(surface, today);
    wireNapCard(surface);
    refreshDerivedStatus(surface);
  }

  function renderSleepCard(sleep) {
    if (sleep && typeof sleep.hours === 'number') {
      const qLabel = sleep.quality ? ` · ${sleep.quality}/5` : '';
      return `
        <div class="recovery-sleep-logged" data-sleep-logged>
          <div class="recovery-sleep-value">
            <strong>${sleep.hours}</strong> hr${qLabel}
          </div>
          <div class="recovery-sleep-actions">
            <button class="recovery-link-btn" data-sleep-edit>Edit</button>
            <button class="recovery-link-btn recovery-link-muted" data-sleep-clear>Clear</button>
          </div>
        </div>
      `;
    }
    return `
      <form class="recovery-sleep-form" data-sleep-form novalidate>
        <div class="recovery-sleep-input-row">
          <label class="recovery-sleep-input-label">
            Hours
            <input id="recovery-sleep-hours" type="number" min="0" max="24" step="0.25"
                   placeholder="7.5" inputmode="decimal" autocomplete="off">
          </label>
        </div>
        <div class="recovery-sleep-quality">
          <span class="recovery-sleep-quality-label">Quality</span>
          <div class="recovery-sleep-quality-buttons" role="radiogroup" aria-label="Sleep quality">
            ${QUALITY_OPTIONS.map(q =>
              `<button type="button" class="recovery-quality-btn" data-quality="${q}"
                       aria-label="${q} of 5" role="radio" aria-checked="false">${q}</button>`
            ).join('')}
          </div>
        </div>
        <div class="recovery-sleep-submit-row">
          <button type="submit" class="recovery-primary-btn" data-sleep-submit>Log sleep</button>
        </div>
      </form>
    `;
  }

  function renderNapCard() {
    if (napState) {
      return `
        <div class="recovery-nap-running" data-nap-running>
          <div class="recovery-nap-countdown" id="recovery-nap-countdown">—</div>
          <div class="recovery-nap-sub">${formatNapDuration(napState.durationMs)} nap</div>
          <div class="recovery-nap-actions">
            <button class="recovery-link-btn recovery-link-muted" data-nap-cancel>Cancel</button>
            <button class="recovery-link-btn" data-nap-finish>Done</button>
          </div>
        </div>
      `;
    }
    return `
      <div class="recovery-nap-presets">
        ${NAP_PRESETS.map(p =>
          `<button class="recovery-preset-btn" data-nap-ms="${p.ms}">${p.label}</button>`
        ).join('')}
      </div>
    `;
  }

  function renderTrend(last7) {
    if (last7.every(d => d.sleep === null && d.napCount === 0)) {
      return `<div class="recovery-trend-empty">No rest logged yet this week.</div>`;
    }
    return `
      <ul class="recovery-trend-list">
        ${last7.map(d => {
          const sleep = d.sleep
            ? `${d.sleep.hours} hr${d.sleep.quality ? ` · ${d.sleep.quality}/5` : ''}`
            : '—';
          const naps = d.napCount > 0
            ? ` · ${d.napCount} nap${d.napCount > 1 ? 's' : ''}`
            : '';
          return `
            <li class="recovery-trend-row">
              <span class="recovery-trend-label">${d.label}</span>
              <span class="recovery-trend-value">${sleep}${naps}</span>
            </li>
          `;
        }).join('')}
      </ul>
    `;
  }

  function getLast7Days(log) {
    const out = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getTime() - i * 86400000);
      const key = getDateStr(d);
      const entry = log[key] || { sleep: null, naps: [] };
      const label = i === 0 ? 'Today'
                  : i === 1 ? 'Yesterday'
                  : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      out.push({
        label,
        sleep: entry.sleep || null,
        napCount: Array.isArray(entry.naps) ? entry.naps.length : 0,
      });
    }
    return out;
  }

  // ── Wiring ─────────────────────────────────────────────────────────

  function wireSleepCard(surface, todayDateStr) {
    const form = surface.querySelector('[data-sleep-form]');
    if (form) {
      let quality = null;
      const qButtons = form.querySelectorAll('[data-quality]');
      qButtons.forEach(b => {
        b.addEventListener('click', () => {
          quality = Number(b.dataset.quality);
          qButtons.forEach(other => {
            const on = Number(other.dataset.quality) === quality;
            other.classList.toggle('is-selected', on);
            other.setAttribute('aria-checked', on ? 'true' : 'false');
          });
        });
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const hoursInput = form.querySelector('#recovery-sleep-hours');
        const hours = parseFloat(hoursInput.value);
        if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
          hoursInput.focus();
          return;
        }
        const sleep = { hours: Math.round(hours * 100) / 100 };
        if (quality) sleep.quality = quality;
        setSleep(todayDateStr, sleep);
        render(surface);
      });
    }

    const editBtn = surface.querySelector('[data-sleep-edit]');
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        clearSleep(todayDateStr);
        render(surface);
      });
    }
    const clearBtn = surface.querySelector('[data-sleep-clear]');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        clearSleep(todayDateStr);
        render(surface);
      });
    }
  }

  function wireNapCard(surface) {
    surface.querySelectorAll('[data-nap-ms]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ms = parseInt(btn.dataset.napMs, 10);
        startNap(surface, ms);
      });
    });

    const cancelBtn = surface.querySelector('[data-nap-cancel]');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        cancelNap();
        render(surface);
      });
    }
    const finishBtn = surface.querySelector('[data-nap-finish]');
    if (finishBtn) {
      finishBtn.addEventListener('click', () => {
        finishNap(surface, /* early */ true);
      });
    }

    if (napState) tickNapCountdown(surface);
  }

  function startNap(surface, durationMs) {
    if (napState) return;
    napState = {
      startedAt: Date.now(),
      durationMs,
      surface,
    };
    render(surface);
    napState.intervalId = setInterval(() => tickNapCountdown(surface), 500);
    if (navigator.vibrate) navigator.vibrate(20);
  }

  function tickNapCountdown(surface) {
    if (!napState) return;
    const remaining = napState.durationMs - (Date.now() - napState.startedAt);
    const el = surface.querySelector('#recovery-nap-countdown');
    if (!el) return;
    if (remaining <= 0) {
      finishNap(surface, /* early */ false);
      return;
    }
    el.textContent = formatCountdown(remaining);
  }

  function formatCountdown(ms) {
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function finishNap(surface, endedEarly) {
    if (!napState) return;
    const actualMs = endedEarly
      ? (Date.now() - napState.startedAt)
      : napState.durationMs;
    const nap = { startedAt: napState.startedAt, durationMs: actualMs };
    if (endedEarly) nap.endedEarly = true;
    clearInterval(napState.intervalId);
    napState = null;
    addNap(getDateStr(), nap);
    if (!endedEarly) {
      // End-of-nap cue: short haptic + the louder BFRB chime (user
      // already tuned its volume) since the user is likely sleeping.
      if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
      if (typeof SFX !== 'undefined' && SFX.playBFRBEnd) SFX.playBFRBEnd();
    }
    render(surface);
  }

  function cancelNap() {
    if (!napState) return;
    clearInterval(napState.intervalId);
    napState = null;
  }

  async function refreshDerivedStatus(surface) {
    const lastEl = surface.querySelector('#recovery-last-focus');
    const todayEl = surface.querySelector('#recovery-today-focus');
    if (lastEl) lastEl.textContent = await getSinceLastFocusLabel();
    if (todayEl) {
      const mins = await getFocusMinutesToday();
      todayEl.textContent = mins === 0 ? 'None yet' : `${mins} min`;
    }
  }

  // ── Public ─────────────────────────────────────────────────────────

  function init() {
    const surface = document.querySelector('[data-wellness-sub="recovery"]');
    if (!surface) return;
    render(surface);
    // Keep the "X ago" string + focus-today total fresh every 30s while
    // visible. Cheap — a couple of IDB reads and one textContent swap.
    if (refreshTickId) clearInterval(refreshTickId);
    refreshTickId = setInterval(() => {
      if (surface.offsetParent !== null) refreshDerivedStatus(surface);
    }, 30000);
  }

  return { init };
})();
