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
    paintStatus(container, status);
    paintTimeline(container, timeline);

    stopTick();
    if (isToday(activeDate)) startTick();
    lastRenderedDayKey = Utils.localDateKey(activeDate);
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
