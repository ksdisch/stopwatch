// ── Analytics Dashboard UI ──
function initAnalyticsPanel() {
  const toggleBtn = document.getElementById('analytics-toggle');
  const panel = document.getElementById('analytics-panel');
  const closeBtn = document.getElementById('analytics-close');
  if (!toggleBtn || !panel) return;

  toggleBtn.addEventListener('click', () => {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) renderAnalytics();
  });

  closeBtn?.addEventListener('click', () => {
    panel.classList.add('hidden');
  });
}

const MODE_COLORS = {
  stopwatch: '#30d158',
  timer: '#0ac7e8',
  pomodoro: '#ff6b6b',
  interval: '#f5a623',
  cooking: '#ff9f0a',
  sequence: '#af52de',
};

function fmtDuration(ms) {
  const hours = Math.floor(ms / 3600000);
  const mins = Math.round((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function renderFocusStreak(streak) {
  const { current, longest, recent7, activeToday } = streak;

  let heroNumber;
  let heroLabel;
  let sub;

  if (current === 0) {
    heroNumber = 'Start';
    heroLabel = 'your streak today';
    sub = longest > 0
      ? `Longest: ${longest} day${longest === 1 ? '' : 's'}`
      : 'Complete a Flow or Pomodoro session to begin';
  } else {
    heroNumber = String(current);
    heroLabel = `day${current === 1 ? '' : 's'}`;
    const longestLine = longest > current
      ? ` · Longest: ${longest}`
      : longest === current ? ' · Personal best!' : '';
    sub = activeToday
      ? `Locked in today ✓${longestLine}`
      : `Don't break it — focus today to reach ${current + 1}${longestLine}`;
  }

  // Dots: render oldest → newest (left → right), which means reverse recent7
  // (which is newest-first). Today is the rightmost dot, gets a ring style.
  const dots = [...recent7].reverse().map(d => {
    const cls = [
      'analytics-streak-dot',
      d.hasFocus ? 'analytics-streak-dot-on' : '',
      d.isToday ? 'analytics-streak-dot-today' : '',
    ].filter(Boolean).join(' ');
    const dayLabel = d.isToday
      ? 'Today'
      : new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' });
    const status = d.hasFocus ? 'focused' : 'no focus session';
    return `<div class="${cls}" title="${dayLabel} · ${status}" aria-label="${dayLabel}: ${status}"></div>`;
  }).join('');

  return `
    <section class="analytics-streak-card" aria-label="Focus streak">
      <div class="analytics-streak-header">FOCUS STREAK</div>
      <div class="analytics-streak-hero">
        <div class="analytics-streak-number">${heroNumber}</div>
        <div class="analytics-streak-hero-label">${heroLabel}</div>
      </div>
      <div class="analytics-streak-sub">${sub}</div>
      <div class="analytics-streak-dots" role="img" aria-label="Last 7 days of focus activity">${dots}</div>
    </section>
  `;
}

async function renderAnalytics() {
  const content = document.getElementById('analytics-content');
  if (!content) return;
  content.innerHTML = '<div class="analytics-loading">Loading...</div>';

  const [trends, bests, weekly, heatmap, streak] = await Promise.all([
    Analytics.getTrends(),
    Analytics.getPersonalBests(),
    Analytics.getWeeklyTotals(8),
    Analytics.getActivityHeatmap(26),
    Analytics.getFocusStreak(),
  ]);

  let html = '';

  // Focus streak hero — flow + pomodoro days of a run. Ship-first analytic
  // because it's the biggest behavioral nudge and needs no new data.
  html += renderFocusStreak(streak);

  // Summary cards
  const thisWeekMin = Math.round(trends.thisWeek.totalMs / 60000);
  const lastWeekMin = Math.round(trends.lastWeek.totalMs / 60000);
  const change = lastWeekMin > 0 ? Math.round(((thisWeekMin - lastWeekMin) / lastWeekMin) * 100) : 0;
  const changeStr = change > 0 ? `+${change}%` : change < 0 ? `${change}%` : '—';
  const changeColor = change > 0 ? 'var(--green)' : change < 0 ? 'var(--red)' : 'var(--text-secondary)';

  html += `<div class="analytics-summary">
    <div class="pomo-stat-card"><div class="pomo-stat-value">${fmtDuration(trends.thisWeek.totalMs)}</div><div class="pomo-stat-label">This Week</div></div>
    <div class="pomo-stat-card"><div class="pomo-stat-value">${trends.thisWeek.count}</div><div class="pomo-stat-label">Sessions</div></div>
    <div class="pomo-stat-card"><div class="pomo-stat-value" style="color:${changeColor}">${changeStr}</div><div class="pomo-stat-label">vs Last Week</div></div>
  </div>`;

  // Weekly bar chart
  const allModes = new Set();
  weekly.forEach(w => Object.keys(w.totals).forEach(m => allModes.add(m)));
  const maxWeekMs = Math.max(1, ...weekly.map(w => Object.values(w.totals).reduce((a, b) => a + b, 0)));

  html += '<div class="analytics-section-title">Weekly Activity</div>';
  html += '<div class="analytics-bar-chart">';
  weekly.forEach(w => {
    const totalMs = Object.values(w.totals).reduce((a, b) => a + b, 0);
    const heightPct = (totalMs / maxWeekMs) * 100;
    let stackHtml = '';
    allModes.forEach(mode => {
      const ms = w.totals[mode] || 0;
      if (ms > 0) {
        const pct = (ms / maxWeekMs) * 100;
        stackHtml += `<div class="analytics-bar-segment" style="height:${pct}%;background:${MODE_COLORS[mode] || '#888'}"></div>`;
      }
    });
    html += `<div class="analytics-bar-col">
      <div class="analytics-bar-stack" style="height:${Math.max(heightPct, 2)}%">${stackHtml}</div>
      <span class="analytics-bar-label">${w.label}</span>
    </div>`;
  });
  html += '</div>';

  // Mode legend
  html += '<div class="analytics-legend">';
  allModes.forEach(mode => {
    html += `<span class="analytics-legend-item"><span class="analytics-legend-dot" style="background:${MODE_COLORS[mode] || '#888'}"></span>${mode}</span>`;
  });
  html += '</div>';

  // Activity heatmap
  html += '<div class="analytics-section-title">Activity (26 weeks)</div>';
  const maxCount = Math.max(1, ...heatmap.map(d => d.count));
  const cols = Math.ceil(heatmap.length / 7);
  html += `<div class="analytics-heatmap" style="grid-template-columns:repeat(${cols},1fr)">`;
  // Reorganize into columns (weeks) with 7 rows (days)
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = col * 7 + row;
      const day = heatmap[idx];
      if (!day) {
        html += '<div class="heatmap-cell"></div>';
        continue;
      }
      const intensity = day.count > 0 ? Math.max(0.15, day.count / maxCount) : 0;
      const bg = intensity > 0 ? `rgba(48,209,88,${intensity})` : 'var(--btn-bg)';
      const title = `${day.date}: ${day.count} session${day.count !== 1 ? 's' : ''}`;
      html += `<div class="heatmap-cell" style="background:${bg}" title="${title}"></div>`;
    }
  }
  html += '</div>';

  // Personal bests
  if (bests) {
    html += '<div class="analytics-section-title">All Time</div>';
    html += '<div class="analytics-summary">';
    html += `<div class="pomo-stat-card"><div class="pomo-stat-value">${bests.totalSessions}</div><div class="pomo-stat-label">Total Sessions</div></div>`;
    html += `<div class="pomo-stat-card"><div class="pomo-stat-value">${fmtDuration(bests.totalTimeMs)}</div><div class="pomo-stat-label">Total Time</div></div>`;
    if (bests.longestSession) {
      html += `<div class="pomo-stat-card"><div class="pomo-stat-value">${fmtDuration(bests.longestSession.duration)}</div><div class="pomo-stat-label">Longest Session</div></div>`;
    }
    html += '</div>';
  }

  content.innerHTML = html;
}
