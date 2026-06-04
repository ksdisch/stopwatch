// Tests for js/rhythm-panel-event-zoom.js — the 14-Day Activity Rhythm panel.
// Panel reads via injected deps, so these pass plain session data — no History
// seeding required. Sessions carry an ISO `date` string (per the panel contract).

(function () {
  const RI = RhythmInsights;
  const NOW = new Date(2026, 4, 20, 12, 0, 0).getTime(); // 2026-05-20, noon local

  // ms timestamp `daysFromToday` away at the given local hour/min.
  function atLocalDayHour(daysFromToday, hour, min) {
    const b = new Date(NOW);
    return new Date(b.getFullYear(), b.getMonth(), b.getDate() + daysFromToday, hour, min || 0, 0, 0).getTime();
  }
  function dayKeyOffset(daysFromToday) {
    const b = new Date(NOW);
    return Utils.localDateKey(new Date(b.getFullYear(), b.getMonth(), b.getDate() + daysFromToday));
  }

  // Session factory — `date` is an ISO string per the deps contract.
  function sess(id, type, daysFromToday, hour) {
    return {
      id: id,
      type: type,
      date: new Date(atLocalDayHour(daysFromToday, hour)).toISOString(),
      duration: 60000,
    };
  }

  function panel() { return RI.getPanels().find(p => p.key === 'event-zoom'); }
  function depsWith(sessions) {
    return { now: () => NOW, getSessions: async () => sessions };
  }

  describe('14-Day Activity (event-zoom) panel', () => {
    it('is registered at order 60 with the right title', () => {
      const p = panel();
      assert(p, 'event-zoom registered');
      assertEqual(p.order, 60);
      assertEqual(p.title, '14-Day Activity');
    });

    it('empty sessions → 14-length days array, grandTotal 0, maxTotal 0', async () => {
      const model = await panel().build(depsWith([]));
      assertEqual(model.days.length, 14);
      assertEqual(model.grandTotal, 0);
      assertEqual(model.maxTotal, 0);
      // every cell is a zeroed day
      model.days.forEach(d => {
        assertEqual(d.total, 0);
        assertEqual(d.productivity, 0);
        assertEqual(d.wellness, 0);
      });
    });

    it('renders an empty strip + "No sessions" note (with panel hook) and never throws on grandTotal 0', () => {
      const model = { days: RI.windowDays(14, NOW).map(w => ({ key: w.key, label: w.label, productivity: 0, wellness: 0, total: 0 })), maxTotal: 0, grandTotal: 0 };
      let html;
      html = panel().render(model);
      assertEqual(typeof html, 'string');
      assert(/data-insight-panel="event-zoom"/.test(html), 'card hook present');
      assert(/rhythm-zoom-strip/.test(html), 'strip still rendered when empty');
      assert(/No sessions in the last 14 days\./.test(html), 'empty note present');
      assert(/0 sessions · 14d/.test(html), 'aside total present');
    });

    it('classifies productivity vs wellness counts per day', async () => {
      const sessions = [
        sess('a', 'flow', 0, 9),       // today prod
        sess('b', 'pomodoro', 0, 10),  // today prod
        sess('c', 'stopwatch', 0, 11), // today prod
        sess('d', 'timer', 0, 12),     // today prod
        sess('e', 'sequence', 0, 13),  // today prod  → 5 prod today
        sess('f', 'interval', 0, 14),  // today wellness
        sess('g', 'cooking', 0, 15),   // today wellness → 2 wellness today
        sess('h', 'flow', -1, 9),      // yesterday prod
        sess('i', 'interval', -1, 10), // yesterday wellness
      ];
      const model = await panel().build(depsWith(sessions));
      const today = model.days.find(d => d.key === dayKeyOffset(0));
      const yest = model.days.find(d => d.key === dayKeyOffset(-1));
      assertEqual(today.productivity, 5);
      assertEqual(today.wellness, 2);
      assertEqual(today.total, 7);
      assertEqual(yest.productivity, 1);
      assertEqual(yest.wellness, 1);
      assertEqual(yest.total, 2);
      assertEqual(model.grandTotal, 9);
      assertEqual(model.maxTotal, 7); // busiest day = today's 7
    });

    it('ignores unrecognized session types (neither pillar)', async () => {
      const sessions = [
        sess('a', 'flow', 0, 9),         // prod
        sess('x', 'mystery', 0, 10),     // neither → not counted
        { id: 'n', type: 'flow', date: 'not-a-date', duration: 1 }, // non-finite ts → dropped
      ];
      const model = await panel().build(depsWith(sessions));
      const today = model.days.find(d => d.key === dayKeyOffset(0));
      assertEqual(today.productivity, 1);
      assertEqual(today.wellness, 0);
      assertEqual(today.total, 1);
      assertEqual(model.grandTotal, 1);
      assertEqual(model.maxTotal, 1);
    });

    it('excludes sessions outside the 14-day window', async () => {
      const sessions = [
        sess('old', 'flow', -30, 9),  // outside window
        sess('in', 'flow', -2, 9),    // inside window
      ];
      const model = await panel().build(depsWith(sessions));
      assertEqual(model.days.length, 14);
      assertEqual(model.grandTotal, 1);
      const inDay = model.days.find(d => d.key === dayKeyOffset(-2));
      assertEqual(inDay.total, 1);
      assertEqual(inDay.productivity, 1);
    });

    it('maxTotal is the busiest single day, not the grand total', async () => {
      const sessions = [
        sess('a', 'flow', -1, 9),
        sess('b', 'flow', -1, 10),
        sess('c', 'flow', -1, 11), // 3 on day -1
        sess('d', 'flow', 0, 9),   // 1 today
      ];
      const model = await panel().build(depsWith(sessions));
      assertEqual(model.grandTotal, 4);
      assertEqual(model.maxTotal, 3);
    });

    it('render(populated) returns a strip with 14 columns and stacked segments', () => {
      const days = RI.windowDays(14, NOW).map((w, i) => ({
        key: w.key, label: w.label,
        productivity: i % 2, wellness: (i % 3 === 0) ? 1 : 0,
        total: (i % 2) + ((i % 3 === 0) ? 1 : 0),
      }));
      const grandTotal = days.reduce((s, d) => s + d.total, 0);
      const maxTotal = days.reduce((m, d) => Math.max(m, d.total), 0);
      const html = panel().render({ days: days, maxTotal: maxTotal, grandTotal: grandTotal });
      assertEqual(typeof html, 'string');
      assert(/rhythm-zoom-strip/.test(html), 'strip class present');
      const colMatches = html.match(/rhythm-zoom-col/g) || [];
      assertEqual(colMatches.length, 14);
      assert(/var\(--active-accent/.test(html), 'productivity segment color present');
      assert(/var\(--green\)/.test(html), 'wellness segment color present');
      assert(new RegExp(grandTotal + ' sessions · 14d').test(html), 'aside total present');
      // populated model should NOT append the "No sessions" note
      assert(!/No sessions in the last 14 days\./.test(html), 'no empty note when populated');
    });

    it('render() never throws on a null model', () => {
      const html = panel().render(null);
      assertEqual(typeof html, 'string');
      assert(/data-insight-panel="event-zoom"/.test(html), 'card hook present even on null');
    });

    it('render(populated) includes the Productivity/Wellness legend', () => {
      const days = RI.windowDays(14, NOW).map((w, i) => ({
        key: w.key, label: w.label, productivity: i % 2, wellness: (i % 3 === 0) ? 1 : 0,
        total: (i % 2) + ((i % 3 === 0) ? 1 : 0),
      }));
      const grandTotal = days.reduce((s, d) => s + d.total, 0);
      const maxTotal = days.reduce((m, d) => Math.max(m, d.total), 0);
      const html = panel().render({ days: days, maxTotal: maxTotal, grandTotal: grandTotal });
      assert(/Productivity/.test(html), 'legend Productivity label present');
      assert(/Wellness/.test(html), 'legend Wellness label present');
    });

    it('render(populated) shows the peak/maxTotal scale reference', () => {
      const days = RI.windowDays(14, NOW).map((w, i) => ({
        key: w.key, label: w.label, productivity: (i === 0) ? 4 : 0, wellness: 0,
        total: (i === 0) ? 4 : 0,
      }));
      const grandTotal = days.reduce((s, d) => s + d.total, 0);
      const maxTotal = days.reduce((m, d) => Math.max(m, d.total), 0); // 4
      const html = panel().render({ days: days, maxTotal: maxTotal, grandTotal: grandTotal });
      assert(/peak 4 sessions/.test(html), 'peak reference reflects maxTotal');
    });

    it('peak reference singularizes "session" when maxTotal is 1', () => {
      const days = RI.windowDays(14, NOW).map((w, i) => ({
        key: w.key, label: w.label, productivity: (i === 0) ? 1 : 0, wellness: 0,
        total: (i === 0) ? 1 : 0,
      }));
      const html = panel().render({ days: days, maxTotal: 1, grandTotal: 1 });
      assert(/peak 1 session(?!s)/.test(html), 'peak reference singular for maxTotal 1');
    });

    it('columns emit data-day + data-tip and no native title= (foundation contract)', () => {
      const days = RI.windowDays(14, NOW).map((w, i) => ({
        key: w.key, label: w.label, productivity: i % 2, wellness: (i % 3 === 0) ? 1 : 0,
        total: (i % 2) + ((i % 3 === 0) ? 1 : 0),
      }));
      const grandTotal = days.reduce((s, d) => s + d.total, 0);
      const maxTotal = days.reduce((m, d) => Math.max(m, d.total), 0);
      const html = panel().render({ days: days, maxTotal: maxTotal, grandTotal: grandTotal });
      assert(/data-day="/.test(html), 'data-day attr present on columns');
      assert(/data-tip="/.test(html), 'data-tip attr present on columns');
      // the tip string still carries the rich per-day summary
      assert(/prod \/ /.test(html), 'tip retains prod/wellness breakdown');
      // the old native title= attribute is gone (replaced by data-tip)
      assert(/rhythm-zoom-col/.test(html), 'columns rendered');
      assert(!/ title="/.test(html), 'no leftover native title= attribute');
      // the data-day value should be a YYYY-MM-DD key, not the human label
      assert(new RegExp('data-day="' + days[0].key + '"').test(html), 'data-day uses the day key');
    });
  });
})();
