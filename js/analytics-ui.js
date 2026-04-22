// ── Analytics Dashboard UI ──

// Selected BFRB-trend window in days. Module-level so it survives re-renders
// when the user toggles 14 / 30 / 90.
let bfrbTrendDays = 30;

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

  // Event delegation for the BFRB-trend window toggle. Content innerHTML is
  // replaced on re-render but the #analytics-content element itself stays.
  const content = document.getElementById('analytics-content');
  if (content) {
    content.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-bfrb-window]');
      if (!btn) return;
      const next = parseInt(btn.dataset.bfrbWindow, 10);
      if (!Number.isFinite(next) || next === bfrbTrendDays) return;
      bfrbTrendDays = next;
      renderAnalytics();
    });
  }
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

const DISTRACTION_LABELS = {
  phone: 'Phone',
  email: 'Email',
  interrupted: 'Interrupted',
  self: 'Self',
  other: 'Other',
};

function hourLabel(h) {
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  if (h < 12) return h + ' AM';
  return (h - 12) + ' PM';
}

function renderDistractions(dist) {
  const { total, top5, hourly } = dist;
  if (total === 0) return '';

  const maxCategory = top5[0]?.total || 1;
  const maxHour = Math.max(1, ...hourly);

  const leaderboard = top5.map(row => {
    const flowPct = (row.flow / maxCategory) * 100;
    const pomoPct = (row.pomodoro / maxCategory) * 100;
    const modeSubtext = row.flow > 0 && row.pomodoro > 0
      ? ` <span class="analytics-distraction-split">${row.flow}f · ${row.pomodoro}p</span>`
      : '';
    const label = DISTRACTION_LABELS[row.category] || row.category;
    return `
      <div class="analytics-distraction-row">
        <div class="analytics-distraction-label">${label}</div>
        <div class="analytics-distraction-bar">
          <div class="analytics-distraction-bar-flow" style="width:${flowPct.toFixed(1)}%"></div>
          <div class="analytics-distraction-bar-pomo" style="width:${pomoPct.toFixed(1)}%"></div>
        </div>
        <div class="analytics-distraction-count">${row.total}${modeSubtext}</div>
      </div>
    `;
  }).join('');

  // 24 cells; each opacity scales with count. Same red as Pomodoro but a bit
  // softer so the strip reads as "when pressure is highest" not "alarm".
  const hourCells = hourly.map((count, h) => {
    const intensity = count > 0 ? Math.max(0.18, count / maxHour) : 0;
    const bg = intensity > 0
      ? `rgba(255, 107, 107, ${intensity.toFixed(2)})`
      : 'var(--btn-border)';
    return `<div class="analytics-distraction-hour" style="background:${bg}" title="${hourLabel(h)} — ${count}"></div>`;
  }).join('');

  // Find peak hour (for a short insight line)
  let peakHour = -1, peakCount = 0;
  hourly.forEach((c, h) => { if (c > peakCount) { peakCount = c; peakHour = h; } });
  const peakLine = peakHour >= 0 && peakCount > 0
    ? `Peak: ${hourLabel(peakHour)} (${peakCount})`
    : '';

  const hasFlow = top5.some(r => r.flow > 0);
  const hasPomo = top5.some(r => r.pomodoro > 0);
  const legend = hasFlow && hasPomo
    ? `<div class="analytics-distraction-legend">
         <span><span class="analytics-distraction-legend-dot is-flow"></span>Flow</span>
         <span><span class="analytics-distraction-legend-dot is-pomo"></span>Pomodoro</span>
       </div>`
    : '';

  return `
    <section class="analytics-distraction-card" aria-label="Distraction patterns">
      <div class="analytics-distraction-header">DISTRACTIONS</div>
      <div class="analytics-distraction-subtitle">${total} logged across Flow + Pomodoro</div>
      <div class="analytics-distraction-leaderboard">${leaderboard}</div>
      ${legend}
      <div class="analytics-distraction-hour-title">BY HOUR OF DAY</div>
      <div class="analytics-distraction-hour-strip" role="img"
           aria-label="Distraction count by hour of day, 12 AM to 11 PM">${hourCells}</div>
      <div class="analytics-distraction-hour-axis">
        <span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>11p</span>
      </div>
      ${peakLine ? `<div class="analytics-distraction-peak">${peakLine}</div>` : ''}
    </section>
  `;
}

function renderActualWorkLog(aw) {
  const { days, total, top10 } = aw;
  if (!top10 || top10.length === 0) return '';

  const windowLabel = days === 7 ? 'LAST 7 DAYS' : `LAST ${days} DAYS`;
  const rows = top10.map(row => `
    <li class="analytics-aw-row">
      <span class="analytics-aw-text">${escapeHtml(row.display)}</span>
      <span class="analytics-aw-count">${row.count}</span>
    </li>
  `).join('');

  return `
    <section class="analytics-aw-card" aria-label="Actual work log">
      <div class="analytics-aw-header-row">
        <div class="analytics-aw-header">ACTUAL WORK</div>
        <div class="analytics-aw-window">${windowLabel}</div>
      </div>
      <div class="analytics-aw-meta">${total} log entr${total === 1 ? 'y' : 'ies'} across Pomodoros</div>
      <ol class="analytics-aw-list">${rows}</ol>
    </section>
  `;
}

const PHASE_LABELS = {
  work: 'Work',
  shortBreak: 'Short break',
  longBreak: 'Long break',
};

function renderPhaseRestarts(pr) {
  const { days, total, byPhase } = pr;
  if (total === 0) return '';

  const breakdown = Object.entries(byPhase)
    .filter(([, count]) => count > 0)
    .map(([phase, count]) => `<span class="analytics-pr-seg"><span class="analytics-pr-count">${count}</span> ${PHASE_LABELS[phase] || phase}</span>`)
    .join('<span class="analytics-pr-sep">·</span>');

  // Tone: more-than-6 restarts in 30d is worth flagging; under that is normal
  const tone = total >= 6
    ? `You've restarted ${total} phase${total === 1 ? '' : 's'} in the last ${days} days. A shorter preset might help.`
    : `${total} phase restart${total === 1 ? '' : 's'} in the last ${days} days.`;

  return `
    <section class="analytics-pr-card" aria-label="Phase restarts">
      <div class="analytics-pr-header-row">
        <div class="analytics-pr-header">PHASE RESTARTS</div>
        <div class="analytics-pr-window">LAST ${days} DAYS</div>
      </div>
      <div class="analytics-pr-number-row">
        <div class="analytics-pr-number">${total}</div>
        <div class="analytics-pr-breakdown">${breakdown}</div>
      </div>
      <div class="analytics-pr-tone">${tone}</div>
    </section>
  `;
}

function renderMedAdherence(adh) {
  const { meds } = adh;
  if (!meds || meds.length === 0) return '';

  const FREQ_LABEL = { 'once-daily': 'Once daily', 'twice-daily': 'Twice daily' };

  const rows = meds.map(m => {
    const doseStr = m.dose ? `${escapeHtml(m.dose)} · ` : '';
    const freqLabel = FREQ_LABEL[m.frequency] || m.frequency;
    const dots = m.dots.map(d => {
      const label = `${d.date} — ${d.taken} of ${d.expected}`;
      return `<div class="adherence-dot adherence-dot-${d.status}" title="${label}" aria-label="${label}"></div>`;
    }).join('');
    // Color-code the percentage so the user can scan at a glance.
    let pctClass = 'adherence-pct-low';
    if (m.adherencePct >= 90) pctClass = 'adherence-pct-high';
    else if (m.adherencePct >= 70) pctClass = 'adherence-pct-mid';
    return `
      <div class="adherence-row">
        <div class="adherence-row-header">
          <div class="adherence-name">${escapeHtml(m.name)}</div>
          <div class="adherence-meta">${doseStr}${freqLabel}</div>
          <div class="adherence-pct ${pctClass}">${m.adherencePct}%</div>
        </div>
        <div class="adherence-dots" role="img"
             aria-label="${m.name} adherence last 30 days">${dots}</div>
      </div>
    `;
  }).join('');

  return `
    <section class="analytics-adherence-card" aria-label="Medication adherence">
      <div class="analytics-adherence-header-row">
        <div class="analytics-adherence-header">MED ADHERENCE</div>
        <div class="analytics-adherence-window-label">30 DAYS</div>
      </div>
      <div class="analytics-adherence-legend">
        <span><span class="adherence-dot adherence-dot-full"></span>Taken</span>
        <span><span class="adherence-dot adherence-dot-partial"></span>Partial</span>
        <span><span class="adherence-dot adherence-dot-missed"></span>Missed</span>
      </div>
      <div class="analytics-adherence-body">${rows}</div>
    </section>
  `;
}

function renderBFRBTrend(trend, selectedDays) {
  const { days, series, total, focusHours, ratePerHour, hourly, bySource } = trend;

  const windows = [14, 30, 90];
  const toggle = windows.map(d => {
    const cls = d === selectedDays
      ? 'analytics-bfrb-window analytics-bfrb-window-active'
      : 'analytics-bfrb-window';
    return `<button class="${cls}" data-bfrb-window="${d}">${d}d</button>`;
  }).join('');

  // SVG line-with-area chart. The chart always renders (even empty) so the
  // window toggle doesn't jump around as the user flips between windows.
  const W = 320, H = 88;
  const PAD_L = 4, PAD_R = 4, PAD_T = 6, PAD_B = 14;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const maxCount = Math.max(1, ...series.map(d => d.count));

  let chartBody = '';
  if (series.length > 0) {
    const points = series.map((d, i) => {
      const x = PAD_L + (series.length === 1 ? innerW / 2 : (i * innerW) / (series.length - 1));
      const y = PAD_T + innerH - (d.count / maxCount) * innerH;
      return { x, y, count: d.count, date: d.date };
    });
    const poly = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaPoly = `${PAD_L},${PAD_T + innerH} ${poly} ${PAD_L + innerW},${PAD_T + innerH}`;
    const dots = points
      .filter(p => p.count > 0)
      .map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2" fill="#ff9f0a"><title>${p.date}: ${p.count}</title></circle>`)
      .join('');
    chartBody = `
      <polygon points="${areaPoly}" fill="rgba(255,159,10,0.18)"/>
      <polyline points="${poly}" fill="none" stroke="#ff9f0a" stroke-width="1.5" stroke-linejoin="round"/>
      ${dots}
    `;
  }

  // Axis: oldest date on the left, today on the right
  const firstLabel = series[0]?.date
    ? new Date(series[0].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '';
  const lastLabel = 'Today';

  // Summary numbers
  const rateFmt = ratePerHour > 0 ? ratePerHour.toFixed(2) : '—';
  const hoursFmt = focusHours > 0
    ? (focusHours >= 10 ? focusHours.toFixed(0) : focusHours.toFixed(1))
    : '0';

  // Trend direction: compare first half of window vs second half (raw counts).
  // Enough signal only if the user has ≥ 4 catches across the window.
  let trendNote = '';
  if (total >= 4) {
    const mid = Math.floor(series.length / 2);
    const firstHalf = series.slice(0, mid).reduce((s, d) => s + d.count, 0);
    const secondHalf = series.slice(mid).reduce((s, d) => s + d.count, 0);
    if (firstHalf > 0) {
      const pctChange = Math.round(((secondHalf - firstHalf) / firstHalf) * 100);
      if (pctChange <= -15) trendNote = `↓ ${Math.abs(pctChange)}% vs first half — catching less`;
      else if (pctChange >= 15) trendNote = `↑ ${pctChange}% vs first half — catching more`;
      else trendNote = 'Roughly steady vs first half';
    }
  }

  // Empty state keeps the chart shape intact but swaps the chart body.
  const emptyOverlay = total === 0
    ? `<div class="analytics-bfrb-empty">No BFRB catches in the last ${days} day${days === 1 ? '' : 's'}.</div>`
    : '';

  // § B — hour-of-day heat strip. 24 cells, amber intensity scales to max hour.
  let hourSection = '';
  if (total > 0 && hourly) {
    const maxHour = Math.max(1, ...hourly);
    const hourCells = hourly.map((count, h) => {
      const intensity = count > 0 ? Math.max(0.18, count / maxHour) : 0;
      const bg = intensity > 0
        ? `rgba(255, 159, 10, ${intensity.toFixed(2)})`
        : 'var(--btn-border)';
      return `<div class="analytics-bfrb-hour" style="background:${bg}" title="${hourLabel(h)} — ${count}"></div>`;
    }).join('');
    let peakH = -1, peakC = 0;
    hourly.forEach((c, h) => { if (c > peakC) { peakC = c; peakH = h; } });
    const peakLabel = peakH >= 0 && peakC > 0
      ? `<span class="analytics-bfrb-hour-peak">Peak: ${hourLabel(peakH)} (${peakC})</span>`
      : '';
    hourSection = `
      <div class="analytics-bfrb-sub-title">BY HOUR OF DAY</div>
      <div class="analytics-bfrb-hour-strip" role="img" aria-label="BFRB catches by hour of day">${hourCells}</div>
      <div class="analytics-bfrb-hour-axis">
        <span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>11p</span>
      </div>
      ${peakLabel ? `<div class="analytics-bfrb-hour-peak-wrap">${peakLabel}</div>` : ''}
    `;
  }

  // § C — source breakdown. Only renders when at least two sources have
  // catches; a single-source bar isn't informative.
  let sourceSection = '';
  if (bySource) {
    const sourceEntries = [
      { key: 'flow',     label: 'Flow',     color: '#007aff', count: bySource.flow || 0 },
      { key: 'pomodoro', label: 'Pomodoro', color: '#ff6b6b', count: bySource.pomodoro || 0 },
      { key: 'idle',     label: 'Idle',     color: '#8e8e93', count: bySource.idle || 0 },
    ];
    const nonZero = sourceEntries.filter(s => s.count > 0);
    if (nonZero.length >= 2) {
      const srcTotal = nonZero.reduce((a, b) => a + b.count, 0);
      const segs = nonZero.map(s => {
        const pct = (s.count / srcTotal) * 100;
        return `<div class="analytics-bfrb-source-seg" style="width:${pct.toFixed(1)}%;background:${s.color}" title="${s.label}: ${s.count}"></div>`;
      }).join('');
      const legend = nonZero.map(s => {
        const pct = Math.round((s.count / srcTotal) * 100);
        return `<span><span class="analytics-bfrb-source-dot" style="background:${s.color}"></span>${s.label} <span class="analytics-bfrb-source-count">${s.count} · ${pct}%</span></span>`;
      }).join('');
      sourceSection = `
        <div class="analytics-bfrb-sub-title">BY SOURCE</div>
        <div class="analytics-bfrb-source-bar">${segs}</div>
        <div class="analytics-bfrb-source-legend">${legend}</div>
      `;
    }
  }

  return `
    <section class="analytics-bfrb-card" aria-label="BFRB trend">
      <div class="analytics-bfrb-header-row">
        <div class="analytics-bfrb-header">BFRB TREND</div>
        <div class="analytics-bfrb-toggle" role="radiogroup" aria-label="Window">${toggle}</div>
      </div>
      <div class="analytics-bfrb-numbers">
        <div class="analytics-bfrb-primary">
          <span class="analytics-bfrb-primary-value">${total}</span>
          <span class="analytics-bfrb-primary-label">catches · last ${days}d</span>
        </div>
        <div class="analytics-bfrb-secondary">
          <span class="analytics-bfrb-secondary-value">${rateFmt}</span>
          <span class="analytics-bfrb-secondary-label">per focus-hour</span>
        </div>
      </div>
      <div class="analytics-bfrb-chart-wrap">
        <svg class="analytics-bfrb-chart" viewBox="0 0 ${W} ${H}"
             preserveAspectRatio="none" width="100%" height="${H}">${chartBody}</svg>
        ${emptyOverlay}
      </div>
      <div class="analytics-bfrb-axis">
        <span>${firstLabel}</span>
        <span>${lastLabel}</span>
      </div>
      <div class="analytics-bfrb-foot">
        <span>${hoursFmt} focus hour${hoursFmt === '1' ? '' : 's'} in window</span>
        ${trendNote ? `<span class="analytics-bfrb-trend-note">${trendNote}</span>` : ''}
      </div>
      ${hourSection}
      ${sourceSection}
    </section>
  `;
}

function renderFlowCompletion(comp) {
  const { total, completed, endedEarly, completionRate, avgDurationPct } = comp;

  // Hide the section entirely if no Flow sessions yet — nothing meaningful to show.
  if (total === 0) return '';

  const completionPct = Math.round(completionRate * 100);
  const avgPct = Math.round(avgDurationPct * 100);

  // SVG donut: a single ring showing "completed" as the filled portion and
  // "ended early" as the remaining. Stroke-dashoffset is what draws the arc.
  // Radius 40 → circumference ≈ 251.33. Dasharray uses that value for math.
  const C = 2 * Math.PI * 40; // ≈ 251.33
  const filled = C * completionRate;
  const unfilled = C - filled;

  const ruleLine = total === 1
    ? '1 block · ' + (endedEarly ? 'ended early' : 'completed')
    : `${completed} of ${total} completed · ${endedEarly} ended early`;

  // Special-case copy for the extremes.
  let tone = '';
  if (total >= 3 && endedEarly === 0) {
    tone = 'Never ended a block early — impressive.';
  } else if (total >= 3 && completed === 0) {
    tone = 'Every block ended early. Shorter preset next?';
  }

  return `
    <section class="analytics-flow-card" aria-label="Flow completion rate">
      <div class="analytics-flow-header">FLOW COMPLETION</div>
      <div class="analytics-flow-body">
        <div class="analytics-flow-donut-wrap" aria-hidden="true">
          <svg class="analytics-flow-donut" viewBox="0 0 100 100" width="108" height="108">
            <circle cx="50" cy="50" r="40" fill="none"
                    stroke="var(--btn-border)" stroke-width="12"/>
            <circle cx="50" cy="50" r="40" fill="none"
                    stroke="var(--green)" stroke-width="12"
                    stroke-dasharray="${filled.toFixed(2)} ${unfilled.toFixed(2)}"
                    stroke-dashoffset="${(C / 4).toFixed(2)}"
                    stroke-linecap="butt" transform="rotate(-90 50 50)"/>
            <text x="50" y="50" class="analytics-flow-donut-label"
                  text-anchor="middle" dominant-baseline="central">${completionPct}%</text>
          </svg>
        </div>
        <dl class="analytics-flow-stats">
          <div class="analytics-flow-stat-row">
            <dt>Completed</dt>
            <dd>${completed} of ${total} (${completionPct}%)</dd>
          </div>
          <div class="analytics-flow-stat-row">
            <dt>Avg duration</dt>
            <dd>${avgPct}% of planned</dd>
          </div>
          <div class="analytics-flow-stat-row">
            <dt>Ended early</dt>
            <dd>${endedEarly}</dd>
          </div>
        </dl>
      </div>
      <div class="analytics-flow-foot">${tone || ruleLine}</div>
    </section>
  `;
}

async function renderAnalytics() {
  const content = document.getElementById('analytics-content');
  if (!content) return;
  content.innerHTML = '<div class="analytics-loading">Loading...</div>';

  const [trends, bests, weekly, heatmap, streak, flowComp, distractions, bfrbTrend, medAdh, actualWork, phaseRestarts] = await Promise.all([
    Analytics.getTrends(),
    Analytics.getPersonalBests(),
    Analytics.getWeeklyTotals(8),
    Analytics.getActivityHeatmap(26),
    Analytics.getFocusStreak(),
    Analytics.getFlowCompletion(),
    Analytics.getDistractions(),
    Analytics.getBFRBTrend(bfrbTrendDays),
    Analytics.getMedAdherence(30),
    Analytics.getActualWork(7),
    Analytics.getPhaseRestarts(30),
  ]);

  let html = '';

  // Focus streak hero — flow + pomodoro days of a run. Ship-first analytic
  // because it's the biggest behavioral nudge and needs no new data.
  html += renderFocusStreak(streak);

  // Flow completion rate — surfaces the new end-early signal alongside the
  // avg % of planned duration. Hidden when the user has zero Flow sessions.
  html += renderFlowCompletion(flowComp);

  // BFRB trend — headline ADHD-adjacent analytic. Line chart of daily
  // catches with 14 / 30 / 90 day window toggle and a catches-per-focus-hour
  // secondary metric.
  html += renderBFRBTrend(bfrbTrend, bfrbTrendDays);

  // Distraction leaderboard + hour-of-day heatmap. Hidden if no distractions
  // have ever been logged.
  html += renderDistractions(distractions);

  // Med adherence dot row (30d). Hidden when the user has no scheduled meds.
  html += renderMedAdherence(medAdh);

  // Actual-work log — top-10 Pomodoro actual-work entries in last 7 days.
  // Hidden when no actual-work items logged in window.
  html += renderActualWorkLog(actualWork);

  // Phase-restart count — how often the user bailed on a Pomo phase.
  // Hidden when no restarts in window.
  html += renderPhaseRestarts(phaseRestarts);

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
