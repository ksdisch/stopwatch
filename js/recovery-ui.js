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
    // F13: cross-store write gate. Default 'ready' preserves current
    // behavior. The `typeof` guard keeps the UI usable in test contexts
    // that don't load persistence.js. Without this, a nap completing
    // mid-upload would write `wellness_rest_log` between the snapshot
    // read and the per-record setDoc loop, leaving local divergence the
    // upload doesn't see.
    if (typeof SyncState !== 'undefined' && !SyncState.canWrite()) return;
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
    // E-1e F10: stamp the sleep entry with deviceId + updatedAt +
    // schemaVersion so the new per-store rest_log merge can perform LWW
    // by updatedAt and dedup by deviceId. Schema.stamp() only sets
    // schemaVersion; the merge function reads updatedAt from this
    // explicit stamp here.
    const stamped = (sleep && typeof sleep === 'object') ? Object.assign({}, sleep) : sleep;
    if (stamped && typeof stamped === 'object') {
      stamped.updatedAt = Date.now();
      if (typeof History !== 'undefined' && typeof History.getDeviceId === 'function') {
        try { stamped.deviceId = History.getDeviceId(); }
        catch (_) { stamped.deviceId = stamped.deviceId || 'unknown-device'; }
      } else if (!stamped.deviceId) {
        stamped.deviceId = 'unknown-device';
      }
      if (typeof Schema !== 'undefined' && typeof Schema.stamp === 'function') {
        Schema.stamp(stamped);
      }
    }
    day.sleep = stamped;
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
    // E-1e F10: stamp the nap entry with deviceId + updatedAt +
    // schemaVersion. The merge function's append-dedup keys on
    // (deviceId, startedAt) — without the deviceId backfill, naps
    // from two devices logged at the same millisecond would collapse
    // to one (Risk #2). Pre-E-1e naps still lack deviceId until
    // their next save; the merge's fallback `'no-device@' + startedAt`
    // signature collapses them by startedAt alone.
    const stamped = (nap && typeof nap === 'object') ? Object.assign({}, nap) : nap;
    if (stamped && typeof stamped === 'object') {
      if (!stamped.deviceId) {
        if (typeof History !== 'undefined' && typeof History.getDeviceId === 'function') {
          try { stamped.deviceId = History.getDeviceId(); }
          catch (_) { stamped.deviceId = 'unknown-device'; }
        } else {
          stamped.deviceId = 'unknown-device';
        }
      }
      stamped.updatedAt = Date.now();
      if (typeof Schema !== 'undefined' && typeof Schema.stamp === 'function') {
        Schema.stamp(stamped);
      }
    }
    day.naps.push(stamped);
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

  // ── #11 bedtime / wake-time helpers ────────────────────────────────

  // "HH:MM" → minutes since midnight (0..1439), or null if malformed.
  function parseHHMM(s) {
    if (typeof s !== 'string') return null;
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = +m[1], min = +m[2];
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  // Hours in bed from bedtime → wakeTime, wrapping past midnight. null if
  // either time is missing/malformed.
  function timeDiffHours(bedtime, wakeTime) {
    const b = parseHHMM(bedtime), w = parseHHMM(wakeTime);
    if (b == null || w == null) return null;
    let diff = w - b;
    if (diff <= 0) diff += 24 * 60; // crosses midnight
    return diff / 60;
  }

  function formatTimeLabel(hhmm) {
    const mins = parseHHMM(hhmm);
    if (mins == null) return '';
    const h = Math.floor(mins / 60), m = mins % 60;
    const ampm = h < 12 ? 'AM' : 'PM';
    const h12 = (h % 12 === 0) ? 12 : (h % 12);
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  // Bedtime → wake line under the logged value, with an in-bed cross-check
  // against the manually entered hours when both times are present. Returns
  // '' when no times were logged.
  function renderSleepTimes(sleep) {
    if (!sleep || (!sleep.bedtime && !sleep.wakeTime)) return '';
    let line;
    if (sleep.bedtime && sleep.wakeTime) {
      const inBed = timeDiffHours(sleep.bedtime, sleep.wakeTime);
      const cross = (inBed != null) ? ` · in bed ${Math.round(inBed * 10) / 10}h` : '';
      line = `${formatTimeLabel(sleep.bedtime)} → ${formatTimeLabel(sleep.wakeTime)}${cross}`;
    } else if (sleep.bedtime) {
      line = `Bedtime ${formatTimeLabel(sleep.bedtime)}`;
    } else {
      line = `Wake ${formatTimeLabel(sleep.wakeTime)}`;
    }
    return `<div class="recovery-sleep-times-display">${escapeHtml(line)}</div>`;
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
          ${renderSleepTimes(sleep)}
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
        <div class="recovery-sleep-times">
          <label class="recovery-sleep-time-label">
            Bedtime
            <input id="recovery-sleep-bedtime" type="time" autocomplete="off">
          </label>
          <label class="recovery-sleep-time-label">
            Wake
            <input id="recovery-sleep-wake" type="time" autocomplete="off">
          </label>
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
        // #11: optional bedtime / wake-time (raw "HH:MM" strings). Additive
        // nullable — only attached when filled; rest_log already syncs the
        // whole sleep object, so the new fields round-trip with no registry
        // change. Feeds the Rhythm Insights Meds-vs-Sleep "onset" view.
        const bedtimeEl = form.querySelector('#recovery-sleep-bedtime');
        const wakeEl = form.querySelector('#recovery-sleep-wake');
        const bedtime = bedtimeEl && bedtimeEl.value ? bedtimeEl.value : '';
        const wakeTime = wakeEl && wakeEl.value ? wakeEl.value : '';
        if (bedtime) sleep.bedtime = bedtime;
        if (wakeTime) sleep.wakeTime = wakeTime;
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
    Platform.haptic(20);
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
      Platform.haptic([120, 80, 120]);
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

    // Backlog #6 caveat (c): re-render when sync brings in remote
    // rest_log or history changes so the recovery dashboard (sleep
    // card, nap list, "Last focus" derived line) reflects cross-device
    // updates without leaving + returning to the surface. Two stores
    // matter here:
    //   - rest_log: direct render data (sleep entries, naps)
    //   - history:  drives the "Last focus block: N hours ago" +
    //               "Focus today: N min" lines via History.getSessions
    // Guarded on visibility (offsetParent) so background merges don't
    // burn cycles re-rendering hidden surfaces.
    if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.on === 'function') {
      try {
        SyncEngine.on('merge-complete', (payload) => {
          if (!payload) return;
          if (payload.store !== 'rest_log' && payload.store !== 'history') return;
          if (surface.offsetParent === null) return;
          try { render(surface); } catch (_) {}
        });
      } catch (_) {}
    }
  }

  // B-1: snapshot adapter, no DOM access — loadLog() is a pure
  // localStorage read. See docs/sync-impl/audits/B-1-AUDIT.md
  // § "Recovery decision" for R1 rationale (R2 — extract a separate
  // js/recovery.js engine — was deferred indefinitely; this adapter
  // lives on the UI module by design until then).
  //
  // Defensive-copy contract: loadLog() returns a fresh JSON.parse of
  // localStorage on every call, so the entire object graph (including
  // each day's naps array) is already fresh. No further cloning needed.
  // No Schema.stamp() — rest_log records don't carry schemaVersion
  // today (the strategy doc keeps the rest_log payload as the raw
  // YYYY-MM-DD-keyed object; the envelope's schemaVersion is the
  // wrapper version).
  function snapshotForSync() {
    return {
      deviceId: History.getDeviceId(),
      schemaVersion: Schema.SCHEMA_VERSION,
      payload: {
        rest_log: loadLog(),
      },
    };
  }

  // C-1: hydrate adapter — bypasses SyncState.canWrite (privileged write
  // path; cloud is canonical during hydrate). Per the R1 scope decision
  // documented in B-1's audit, RecoveryUI owns the rest_log state directly
  // (no separate engine module), so its `_hydrateWriteRaw` lives here.
  //
  // Cloud stores one Firestore doc per `YYYY-MM-DD` key; the orchestrator
  // (SyncEngine.hydrateFromCloud) converts the array of cloud docs into
  // the local `{YYYY-MM-DD: {sleep, naps}}` map shape and passes it here.
  // We strip the redundant `date` field that B-3's upload path stamped
  // onto each inner record (the date is the doc key itself).
  function _hydrateWriteRaw(restLogMap) {
    if (!restLogMap || typeof restLogMap !== 'object' || Array.isArray(restLogMap)) {
      restLogMap = {};
    }
    // Defensive: rebuild the on-disk shape from the supplied map. Drops
    // entries whose value isn't an object (e.g. a corrupt cloud doc that
    // somehow came through as null). The `date` field that B-3's upload
    // shim added to each inner record (so per-record merge code in E-1
    // can find it without re-deriving) is stripped here because the local
    // map's key IS the date.
    const out = {};
    let written = 0;
    let skipped = 0;
    for (const key of Object.keys(restLogMap)) {
      const entry = restLogMap[key];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        skipped++;
        continue;
      }
      // Shallow copy + drop `date` (it's redundant once the map key is the date).
      const clean = Object.assign({}, entry);
      delete clean.date;
      // Also drop the Firestore doc `id` if it leaked through (the
      // orchestrator's array→map conversion shouldn't include it, but be
      // defensive — `id` is metadata, not a rest_log field).
      delete clean.id;
      out[key] = clean;
      written++;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
    } catch (e) {
      skipped += written;
      written = 0;
    }
    if (skipped > 0) {
      try { console.warn('[RecoveryUI] hydrate skipped ' + skipped + ' malformed/un-writable record(s)'); }
      catch (e) {}
    }
    return { written, skipped };
  }

  function hydrateFromCloud(restLogMap) {
    if (!restLogMap || typeof restLogMap !== 'object') {
      return Promise.reject(new Error('hydrateFromCloud: restLogMap must be an object'));
    }
    const { written, skipped } = _hydrateWriteRaw(restLogMap);
    return Promise.resolve({ ok: true, count: written, skipped });
  }

  // E-1e: privileged reconcile write path. Mirrors `_hydrateWriteRaw`'s
  // contract (bypasses the `SyncState.canWrite()` gate that saveLog
  // consults). Used by `js/sync-merge-rest-log.js` after the per-day
  // CAS writeback completes — the merge function commits the merged
  // {YYYY-MM-DD → {sleep, naps}} map back to localStorage via this
  // helper. Same defensive shape-coercion as the hydrate path: drops
  // entries whose value isn't an object, strips the redundant `date`/`id`
  // metadata fields that B-3's upload shim added.
  function _reconcileWriteRaw(restLogMap) {
    if (!restLogMap || typeof restLogMap !== 'object' || Array.isArray(restLogMap)) {
      restLogMap = {};
    }
    const out = {};
    let written = 0;
    let skipped = 0;
    for (const key of Object.keys(restLogMap)) {
      const entry = restLogMap[key];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        skipped++;
        continue;
      }
      const clean = Object.assign({}, entry);
      delete clean.date;
      delete clean.id;
      out[key] = clean;
      written++;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
    } catch (e) {
      skipped += written;
      written = 0;
    }
    return { written, skipped };
  }

  // C-1: expose loadLog so SyncEngine.isLocalEmpty() can probe rest_log
  // for the Stage D guard without reaching into DOM-bound surfaces. Pure
  // localStorage read, no DOM touch — safe to expose alongside the
  // snapshot adapter.
  return {
    init, snapshotForSync,
    hydrateFromCloud, _hydrateWriteRaw,
    _reconcileWriteRaw,
    loadLog,
  };
})();
