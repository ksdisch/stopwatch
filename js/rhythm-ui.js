// Rhythm UI — view for the daily timeline produced by the Rhythm engine.
// TempoNav.applyRoute() calls render() when the rhythm pillar activates.
const RhythmUI = (() => {
  let activeDate = null;
  let currentTickInterval = null;
  let lastRenderedDayKey = null;

  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function isToday(d) {
    return Utils.localDateKey(d) === Utils.localDateKey(new Date());
  }

  function labelForDate(d) {
    const today = startOfDay(new Date());
    const target = startOfDay(d);
    const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === -1) return 'Yesterday';
    if (diff === 1) return 'Tomorrow';
    return target.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function formatClockTime(ms) {
    return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function iconForType(type, module) {
    if (type === 'dose-logged') return '◆';
    if (type === 'habit-checked') return '◇';
    if (module === 'nap') return '☾';
    if (type === 'session-end') return '◯';
    return '●';
  }

  async function render() {
    const container = document.querySelector('.tempo-pillar[data-pillar-id="rhythm"]');
    if (!container) return;
    if (!activeDate) activeDate = startOfDay(new Date());

    if (!container.querySelector('.rhythm-root')) {
      container.innerHTML = `
        <div class="rhythm-root">
          <div class="rhythm-header">
            <button class="rhythm-nav-btn" data-rhythm-nav="prev" aria-label="Previous day">‹</button>
            <div class="rhythm-day-label" data-rhythm-day-label></div>
            <button class="rhythm-nav-btn" data-rhythm-nav="next" aria-label="Next day">›</button>
          </div>
          <div class="rhythm-readiness-band" data-rhythm-readiness hidden></div>
          <div class="rhythm-status" data-rhythm-status></div>
          <div class="rhythm-timeline" data-rhythm-timeline></div>
        </div>
      `;
      container.querySelectorAll('[data-rhythm-nav]').forEach(btn => {
        btn.addEventListener('click', () => {
          const dir = btn.dataset.rhythmNav === 'prev' ? -1 : 1;
          activeDate = startOfDay(new Date(activeDate.getTime() + dir * 86400000));
          render();
        });
      });
    }

    container.querySelector('[data-rhythm-day-label]').textContent = labelForDate(activeDate);

    const timeline = await Rhythm.getDayTimeline(activeDate);
    const status = isToday(activeDate)
      ? await Rhythm.getCurrentDayStatus(Date.now(), timeline)
      : null;
    paintReadiness(container);
    paintStatus(container, status);
    paintTimeline(container, timeline);

    stopTick();
    if (isToday(activeDate)) startTick();
    lastRenderedDayKey = Utils.localDateKey(activeDate);
  }

  // Readiness band — surfaces today's row from RecoveryFeed (one-way data
  // feed from personal-health-elt's mart_recovery_state). Hidden when:
  //   - viewing a non-today day (the band is a "right now" signal)
  //   - RecoveryFeed isn't loaded / signed out / no cached row
  //   - the cached row's `day` doesn't match the active date
  // The cache survives offline reloads, so the band stays meaningful when
  // the network is gone.
  const READINESS_SIGNAL_EMOJI = {
    well_recovered: '\u{1F7E2}',     // green circle
    neutral: '\u{1F7E1}',            // yellow circle
    strained: '\u{1F534}',           // red circle
    insufficient_data: '⚪',     // white circle
  };
  const READINESS_SIGNAL_LABEL = {
    well_recovered: 'Well-recovered',
    neutral: 'Neutral',
    strained: 'Strained',
    insufficient_data: 'Insufficient data',
  };

  // Build a relative-date label for stale readiness rows. The mart's latest
  // day often lags today's calendar date by 1–2 days (Apple Health export
  // hasn't been loaded yet, or dbt build hasn't run today). Rather than hide
  // the band entirely, show the most recent available signal with an "as of
  // <date>" suffix so the user knows it isn't fresh.
  function formatStaleDate(isoDay) {
    if (typeof isoDay !== 'string') return '';
    const parts = isoDay.split('-').map(Number);
    if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return isoDay;
    const [y, m, d] = parts;
    const rowDate = new Date(y, m - 1, d);
    rowDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((today.getTime() - rowDate.getTime()) / 86400000);
    if (diff <= 0) return '';
    if (diff === 1) return 'yesterday';
    if (diff < 7) return diff + 'd ago';
    return rowDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function paintReadiness(container) {
    const el = container.querySelector('[data-rhythm-readiness]');
    if (!el) return;
    if (!isToday(activeDate) || typeof RecoveryFeed === 'undefined') {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    const row = RecoveryFeed.getLatest();
    if (!row || !row.day) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    // The mart's latest day often lags today's calendar date by 1–2 days
    // (today's Apple Health CSV isn't loaded yet, or dbt build hasn't run).
    // Show the latest available signal with an "as of …" suffix so the user
    // knows the band reflects a past day's data. Drop the band entirely if
    // the row is from the future (clock skew or test fixture) — that's a
    // genuine "don't trust this" case.
    const todayKey = Utils.localDateKey(activeDate);
    let staleSuffix = '';
    if (row.day !== todayKey) {
      const label = formatStaleDate(row.day);
      if (!label) {
        // Future-dated row or unparseable date — bail rather than mislead.
        el.hidden = true;
        el.textContent = '';
        return;
      }
      staleSuffix = ' · as of ' + label;
    }

    const signal = typeof row.recovery_signal === 'string'
      ? row.recovery_signal
      : 'insufficient_data';
    const emoji = READINESS_SIGNAL_EMOJI[signal] || READINESS_SIGNAL_EMOJI.insufficient_data;
    const label = READINESS_SIGNAL_LABEL[signal] || READINESS_SIGNAL_LABEL.insufficient_data;

    // Secondary readouts. Only include the ones present + numeric — a missing
    // HRV reading shouldn't print "HRV — ms".
    const parts = [];
    if (typeof row.hrv_ms === 'number') {
      parts.push('HRV ' + row.hrv_ms.toFixed(1) + ' ms');
    }
    if (typeof row.acwr === 'number') {
      parts.push('ACWR ' + row.acwr.toFixed(2));
    }
    if (typeof row.rhr_bpm === 'number' && parts.length < 2) {
      parts.push('RHR ' + Math.round(row.rhr_bpm) + ' bpm');
    }
    const detail = (parts.length ? ' · ' + parts.join(' · ') : '') + staleSuffix;

    el.hidden = false;
    el.className = 'rhythm-readiness-band rhythm-readiness-band--' + signal;
    el.innerHTML =
      '<span class="rhythm-readiness-emoji" aria-hidden="true">' + emoji + '</span>' +
      '<span class="rhythm-readiness-label">' + escapeHtml(label) + '</span>' +
      '<span class="rhythm-readiness-detail">' + escapeHtml(detail) + '</span>';
  }

  function paintStatus(container, status) {
    const el = container.querySelector('[data-rhythm-status]');
    if (!el) return;
    if (!status) {
      el.textContent = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    if (status.activeNow) {
      const remainMs = status.activeNow.endsAt - Date.now();
      el.textContent = `Active: ${status.activeNow.summary} — ${Rhythm._internals.formatDurationShort(remainMs)} left`;
    } else if (status.upcoming) {
      el.textContent = `Next: ${status.upcoming.summary} at ${formatClockTime(status.upcoming.time)}`;
    } else if (status.totalEntries === 0) {
      el.textContent = 'Nothing logged yet today.';
    } else {
      el.textContent = 'No upcoming entries today.';
    }
  }

  function paintTimeline(container, entries) {
    const el = container.querySelector('[data-rhythm-timeline]');
    if (!el) return;
    if (!entries.length) {
      el.innerHTML = '<div class="rhythm-empty">No entries on this day.</div>';
      return;
    }
    const now = Date.now();
    const showNowLine = isToday(activeDate);
    let nowLineInserted = false;
    let html = '';
    entries.forEach(e => {
      if (showNowLine && !nowLineInserted && e.time > now) {
        html += renderNowLine(now);
        nowLineInserted = true;
      }
      html += renderEntry(e);
    });
    if (showNowLine && !nowLineInserted) {
      html += renderNowLine(now);
    }
    el.innerHTML = html;
    const nowEl = el.querySelector('.rhythm-now-line');
    if (nowEl && lastRenderedDayKey !== Utils.localDateKey(activeDate)) {
      nowEl.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  }

  function renderEntry(e) {
    const cls = `rhythm-entry rhythm-entry--${e.pillar} rhythm-entry--${e.type}`;
    const time = formatClockTime(e.time);
    const icon = iconForType(e.type, e.module);
    const summary = escapeHtml(e.summary || '');
    return `<div class="${cls}" role="listitem">
      <span class="rhythm-time">${time}</span>
      <span class="rhythm-dot" aria-hidden="true">${icon}</span>
      <span class="rhythm-summary">${summary}</span>
    </div>`;
  }

  function renderNowLine(now) {
    return `<div class="rhythm-now-line"><span class="rhythm-now-label">Now · ${formatClockTime(now)}</span></div>`;
  }

  function startTick() {
    if (currentTickInterval) return;
    currentTickInterval = setInterval(() => {
      if (TempoNav && TempoNav.getPillar() === 'rhythm' && isToday(activeDate)) {
        render();
      } else {
        stopTick();
      }
    }, 30000);
  }

  function stopTick() {
    if (currentTickInterval) {
      clearInterval(currentTickInterval);
      currentTickInterval = null;
    }
  }

  function init() {
    window.addEventListener('hashchange', () => {
      if (TempoNav && TempoNav.getPillar() === 'rhythm') {
        activeDate = startOfDay(new Date());
        render();
      }
    });
    if (TempoNav && TempoNav.getPillar() === 'rhythm') {
      render();
    }
  }

  return { init, render };
})();
