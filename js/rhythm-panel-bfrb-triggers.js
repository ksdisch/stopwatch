// Rhythm Insights panel: BFRB Triggers (order 45) — the antecedent breakdown +
// a forgiving clean-streak. Sits right after BFRB Frequency (order 40).
//
// Question it answers: "WHY did the catches happen, and how long have I been
// clean?" — the Habit-Reversal-Training substrate the frequency line can't show.
//
// Reads the LIVE consolidated stream via deps.getBfrbEvents() (NOT
// Analytics.getBFRBTrend, which unions a session-snapshot path that cannot
// carry the antecedent fields). The clean-streak rule is a FIXED no-catch
// WINDOW of elapsed time — never "days with no catch logged" (that rewards not
// logging). See docs/plans/2026-06-05-bfrb-closed-loop.md.
//
// Pure: build(deps) reads only the injected deps; render(model) returns one
// RI.card and must never throw.
(function () {
  if (typeof RhythmInsights === 'undefined') return; // load-order guard
  const RI = RhythmInsights;
  const KEY = 'bfrb-triggers';
  const WINDOW_DAYS = 14;
  const STREAK_DOTS = 7;

  // local 'YYYY-MM-DD' (no UTC shift — split via the local Date fields).
  function dayKeyOf(ms) {
    const d = new Date(ms);
    return d.getFullYear() + '-'
      + String(d.getMonth() + 1).padStart(2, '0') + '-'
      + String(d.getDate()).padStart(2, '0');
  }

  function prettyZone(z) {
    z = String(z == null ? '' : z);
    return z ? z.charAt(0).toUpperCase() + z.slice(1) : z;
  }

  // 'YYYY-MM-DD' → short weekday, parsed in LOCAL time (not new Date(str),
  // which would parse as UTC midnight and shift the weekday in some zones).
  function weekdayOf(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key));
    if (!m) return '';
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, { weekday: 'short' });
  }

  // Valid takenAt timestamps, ascending.
  function sortedTimes(events) {
    const out = [];
    (events || []).forEach(e => {
      if (e && typeof e.takenAt === 'number' && isFinite(e.takenAt)) out.push(e.takenAt);
    });
    out.sort((a, b) => a - b);
    return out;
  }

  // recent7: last 7 local days, newest-first (matches renderFocusStreak's
  // recent7 ordering). Each: { date(key), isToday, catchCount, clean }.
  function buildRecent7(events, now) {
    const base = new Date(now); base.setHours(0, 0, 0, 0);
    const y = base.getFullYear(), mo = base.getMonth(), da = base.getDate();
    const todayKey = dayKeyOf(now);
    const counts = {};
    (events || []).forEach(e => {
      if (!e || typeof e.takenAt !== 'number' || !isFinite(e.takenAt)) return;
      const k = dayKeyOf(e.takenAt);
      counts[k] = (counts[k] || 0) + 1;
    });
    const out = [];
    for (let i = 0; i < STREAK_DOTS; i++) {
      const key = dayKeyOf(new Date(y, mo, da - i).getTime());
      const c = counts[key] || 0;
      out.push({ date: key, isToday: key === todayKey, catchCount: c, clean: c === 0 });
    }
    return out;
  }

  // Forgiving clean-streak — a fixed no-catch WINDOW of elapsed time derived
  // purely from the most-recent catch timestamp. cleanDays = floor(hours/24).
  // longestCleanHours = the largest gap between consecutive catches in full
  // history, INCLUDING the currently-open gap (now − lastAt). Uses the whole
  // stream (not just the 14-day window) — a clean stretch can exceed 14 days.
  function computeStreak(events, now) {
    const times = sortedTimes(events);
    const recent7 = buildRecent7(events, now);
    if (!times.length) {
      return { hasData: false, hoursSinceLast: null, cleanDays: 0,
               longestCleanHours: 0, longestCleanDays: 0, recent7: recent7 };
    }
    const lastAt = times[times.length - 1];
    const hoursSinceLast = Math.max(0, (now - lastAt) / 3600000);
    let longestMs = Math.max(0, now - lastAt);
    for (let i = 1; i < times.length; i++) {
      const gap = times[i] - times[i - 1];
      if (gap > longestMs) longestMs = gap;
    }
    const longestCleanHours = longestMs / 3600000;
    return {
      hasData: true,
      hoursSinceLast: hoursSinceLast,
      cleanDays: Math.floor(hoursSinceLast / 24),
      longestCleanHours: longestCleanHours,
      longestCleanDays: Math.floor(longestCleanHours / 24),
      recent7: recent7,
    };
  }

  // Antecedent breakdown over the trailing 14-day window: trigger leaderboard,
  // untagged count, urge mix, context split.
  function computeBreakdown(events, now) {
    const win = RI.windowDays(WINDOW_DAYS, now);
    const start = win.length ? win[0].start : (now - WINDOW_DAYS * 86400000);
    const inWindow = (events || []).filter(e =>
      e && typeof e.takenAt === 'number' && isFinite(e.takenAt)
      && e.takenAt >= start && e.takenAt <= now);

    const triggerCounts = {};
    let untagged = 0;
    const urge = { 1: 0, 2: 0, 3: 0 };
    let urgeTagged = 0;
    const context = { global: 0, flow: 0, pomodoro: 0 };

    inWindow.forEach(e => {
      if (typeof e.triggerZone === 'string' && e.triggerZone) {
        triggerCounts[e.triggerZone] = (triggerCounts[e.triggerZone] || 0) + 1;
      } else {
        untagged++;
      }
      if (e.urgeLevel === 1 || e.urgeLevel === 2 || e.urgeLevel === 3) {
        urge[e.urgeLevel]++; urgeTagged++;
      }
      const c = (e.context === 'flow' || e.context === 'pomodoro') ? e.context : 'global';
      context[c]++;
    });

    const triggers = Object.keys(triggerCounts)
      .map(z => ({ zone: z, count: triggerCounts[z] }))
      .sort((a, b) => (b.count - a.count) || (a.zone < b.zone ? -1 : 1));

    return { total: inWindow.length, triggers: triggers, untagged: untagged,
             urge: urge, urgeTagged: urgeTagged, context: context };
  }

  // ── Render fragments ──────────────────────────────────────────────────

  function renderStreak(streak) {
    let heroNumber, heroLabel, sub;
    if (!streak.hasData) {
      heroNumber = '—';
      heroLabel = 'no catches yet';
      sub = 'Your clean-streak appears once you log a catch.';
    } else if (streak.cleanDays >= 1) {
      heroNumber = String(streak.cleanDays);
      heroLabel = 'day' + (streak.cleanDays === 1 ? '' : 's') + ' clean';
      const lc = streak.longestCleanDays;
      sub = (lc > streak.cleanDays)
        ? 'Longest clean stretch: ' + lc + ' day' + (lc === 1 ? '' : 's')
        : 'Personal best — keep it going';
    } else {
      heroNumber = Math.round(streak.hoursSinceLast) + 'h';
      heroLabel = 'since last catch';
      const lc = streak.longestCleanDays;
      sub = (lc >= 1)
        ? 'Longest clean stretch: ' + lc + ' day' + (lc === 1 ? '' : 's')
        : 'Every catch you log sharpens the pattern below';
    }

    const dots = [...streak.recent7].reverse().map(d => {
      const cls = ['analytics-streak-dot',
        d.clean ? 'analytics-streak-dot-on' : 'bfrb-streak-dot-catch',
        d.isToday ? 'analytics-streak-dot-today' : ''].filter(Boolean).join(' ');
      const dayLabel = d.isToday ? 'Today' : (weekdayOf(d.date) || d.date);
      const status = d.clean ? 'clean'
        : (d.catchCount + ' catch' + (d.catchCount === 1 ? '' : 'es'));
      return '<div class="' + cls + '" data-day="' + escapeHtml(d.date) + '"'
        + ' data-tip="' + escapeHtml(dayLabel + ' · ' + status) + '"'
        + ' aria-label="' + escapeHtml(dayLabel + ': ' + status) + '"></div>';
    }).join('');

    return '<div class="bfrb-streak">'
      + '<div class="analytics-streak-hero">'
      + '<div class="analytics-streak-number">' + escapeHtml(heroNumber) + '</div>'
      + '<div class="analytics-streak-hero-label">' + escapeHtml(heroLabel) + '</div>'
      + '</div>'
      + '<div class="analytics-streak-sub">' + escapeHtml(sub) + '</div>'
      + '<div class="analytics-streak-dots" role="img"'
      + ' aria-label="Last 7 days — clean vs catch">' + dots + '</div>'
      + '</div>';
  }

  function renderTriggers(breakdown) {
    const rows = breakdown.triggers.slice(0, 6);
    const hasUntagged = breakdown.untagged > 0;
    if (!rows.length && !hasUntagged) return ''; // streak-only view
    if (!rows.length && hasUntagged) {
      return '<div class="bfrb-triggers-subtitle">Tag a catch with a trigger chip'
        + ' to see your patterns.</div>';
    }
    const max = Math.max(1, rows.length ? rows[0].count : 0, breakdown.untagged);
    const rowHtml = rows.map(r => {
      const pct = (r.count / max) * 100;
      const lab = prettyZone(r.zone);
      return '<div class="analytics-distraction-row" data-tip="'
        + escapeHtml(lab + ' · ' + r.count) + '">'
        + '<div class="analytics-distraction-label">' + escapeHtml(lab) + '</div>'
        + '<div class="analytics-distraction-bar">'
        + '<div class="bfrb-trigger-bar-fill" style="width:' + pct.toFixed(1) + '%"></div></div>'
        + '<div class="analytics-distraction-count">' + r.count + '</div></div>';
    }).join('');
    let untaggedHtml = '';
    if (hasUntagged) {
      const pct = (breakdown.untagged / max) * 100;
      untaggedHtml = '<div class="analytics-distraction-row" data-tip="'
        + escapeHtml('Untagged · ' + breakdown.untagged) + '">'
        + '<div class="analytics-distraction-label">Untagged</div>'
        + '<div class="analytics-distraction-bar">'
        + '<div class="bfrb-trigger-bar-fill bfrb-trigger-bar-untagged" style="width:'
        + pct.toFixed(1) + '%"></div></div>'
        + '<div class="analytics-distraction-count">' + breakdown.untagged + '</div></div>';
    }
    return '<div class="bfrb-triggers-subtitle">TOP TRIGGERS · 14d</div>'
      + '<div class="analytics-distraction-leaderboard">' + rowHtml + untaggedHtml + '</div>';
  }

  function renderUrge(breakdown) {
    const u = breakdown.urge || { 1: 0, 2: 0, 3: 0 };
    const tagged = breakdown.urgeTagged || 0;
    if (tagged === 0) return '';
    const labels = [['Mild', 1], ['Medium', 2], ['Strong', 3]];
    const seg = labels.map(pair => {
      const n = u[pair[1]] || 0;
      const pct = (n / tagged) * 100;
      return '<div class="bfrb-urge-seg bfrb-urge-seg-' + pair[1] + '"'
        + ' style="width:' + pct.toFixed(1) + '%"'
        + ' data-tip="' + escapeHtml(pair[0] + ' · ' + n) + '"></div>';
    }).join('');
    const legend = labels.map(pair =>
      '<span class="bfrb-urge-legend-item"><i class="bfrb-urge-dot bfrb-urge-dot-'
      + pair[1] + '"></i>' + pair[0] + ' ' + (u[pair[1]] || 0) + '</span>').join('');
    return '<div class="bfrb-urge">'
      + '<div class="bfrb-triggers-subtitle">URGE INTENSITY · 14d</div>'
      + '<div class="bfrb-urge-bar">' + seg + '</div>'
      + '<div class="bfrb-urge-legend">' + legend + '</div></div>';
  }

  RI.register({
    key: KEY,
    title: 'BFRB Triggers',
    order: 45,

    build(deps) {
      const events = (deps && typeof deps.getBfrbEvents === 'function') ? deps.getBfrbEvents() : [];
      const now = (deps && typeof deps.now === 'function') ? deps.now() : Date.now();
      return {
        breakdown: computeBreakdown(events, now),
        streak: computeStreak(events, now),
      };
    },

    render(model) {
      model = model || {};
      // Normalize per-field (not just `|| default`) so a PARTIAL breakdown /
      // streak object — e.g. render({ breakdown: {}, streak: {} }) — can't throw
      // on a missing array (the registry catches throws, but panels stay robust).
      const b = model.breakdown || {};
      const breakdown = {
        total: b.total || 0,
        triggers: Array.isArray(b.triggers) ? b.triggers : [],
        untagged: b.untagged || 0,
        urge: b.urge || { 1: 0, 2: 0, 3: 0 },
        urgeTagged: b.urgeTagged || 0,
        context: b.context || {},
      };
      const s = model.streak || {};
      const streak = {
        hasData: !!s.hasData,
        hoursSinceLast: s.hoursSinceLast,
        cleanDays: s.cleanDays || 0,
        longestCleanDays: s.longestCleanDays || 0,
        longestCleanHours: s.longestCleanHours || 0,
        recent7: Array.isArray(s.recent7) ? s.recent7 : [],
      };

      if (!streak.hasData && breakdown.total === 0) {
        return RI.card({
          key: KEY, label: 'BFRB Triggers',
          body: RI.empty('No BFRB catches logged yet. Catches you log will show their '
            + 'triggers and a clean-streak here.'),
        });
      }

      const aside = breakdown.total > 0
        ? (breakdown.total + ' catch' + (breakdown.total === 1 ? '' : 'es') + ' · 14d')
        : '';

      return RI.card({
        key: KEY, label: 'BFRB Triggers', aside: aside,
        body: renderStreak(streak) + renderTriggers(breakdown) + renderUrge(breakdown),
      });
    },
  });
})();
