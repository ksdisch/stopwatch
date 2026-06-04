// Tests for js/rhythm-panel-meds-sleep.js — the flagship Meds-vs-Sleep scatter,
// focused on the chart-polish layer (axis tick labels, gridlines) + the
// foundation hover/highlight contract (data-tip / data-day on dots, no <title>).
// The pure build() pairing logic is covered in rhythm-insights.test.js; this
// file drives render() with a fully-populated model.

(function () {
  const RI = RhythmInsights;
  const NOW = new Date(2026, 4, 20, 12, 0, 0).getTime(); // 2026-05-20, noon local

  function atLocalDayHour(daysFromToday, hour, min) {
    const b = new Date(NOW);
    return new Date(b.getFullYear(), b.getMonth(), b.getDate() + daysFromToday, hour, min || 0, 0, 0).getTime();
  }
  function dayKeyOffset(daysFromToday) {
    const b = new Date(NOW);
    return Utils.localDateKey(new Date(b.getFullYear(), b.getMonth(), b.getDate() + daysFromToday));
  }
  function stubMed(id, name, doseTimes) {
    return {
      getId: () => id,
      getName: () => name,
      getDose: () => '',
      getDoseLog: () => doseTimes.map(t => ({ takenAt: t, deviceId: 'd' })),
    };
  }

  function panel() { return RI.getPanels().find(p => p.key === 'meds-sleep'); }

  // A fresh per-panel state bag each call so a prior test's toggle can't leak.
  function ctxFor(initial) {
    const bag = Object.assign({}, initial);
    return { state: () => bag };
  }

  // Build a populated model from injected deps, then render it.
  async function buildAndRender(deps, ctxState) {
    const model = await panel().build(deps);
    return panel().render(model, ctxFor(ctxState || {}));
  }

  // Onset deps: one dose at 8am day -5, sleep logged the following morning.
  function onsetDeps() {
    return {
      now: () => NOW,
      getMeds: () => [stubMed('m1', 'Vyvanse', [atLocalDayHour(-5, 8, 0)])],
      getRestLog: () => ({
        [dayKeyOffset(-4)]: { sleep: { bedtime: '23:30', hours: 7, quality: 4 } },
      }),
    };
  }
  // Duration deps: a dose at 8am day -3, with hours-slept logged the next day.
  function durationDeps() {
    return {
      now: () => NOW,
      getMeds: () => [stubMed('m1', 'Vyvanse', [atLocalDayHour(-3, 8, 0)])],
      getRestLog: () => ({
        [dayKeyOffset(-2)]: { sleep: { hours: 8, quality: 5 } },
      }),
    };
  }

  describe('Meds-vs-Sleep panel render (chart polish)', () => {
    it('is registered at order 10 with the right title', () => {
      const p = panel();
      assert(p, 'meds-sleep registered');
      assertEqual(p.order, 10);
      assertEqual(p.title, 'Meds vs Sleep');
    });

    it('renders the empty-state card (with panel hook) when no meds', async () => {
      const html = await buildAndRender({ now: () => NOW, getMeds: () => [], getRestLog: () => ({}) });
      assert(/data-insight-panel="meds-sleep"/.test(html), 'card hook present');
      assert(/No medications/.test(html), 'empty-state copy present');
    });

    it('Onset view draws x-axis tick labels including noon + midnight', async () => {
      const html = await buildAndRender(onsetDeps(), { view: 'onset' });
      assert(/>12 PM<\/text>/.test(html), '12 PM x-axis label present');
      assert(/>12 AM<\/text>/.test(html), '12 AM x-axis label present');
      assert(/>6 AM<\/text>/.test(html), '6 AM x-axis label present');
    });

    it('Onset view draws compact night-hour y-axis labels', async () => {
      const html = await buildAndRender(onsetDeps(), { view: 'onset' });
      assert(/>12a<\/text>/.test(html), 'midnight (12a) y-axis label present');
      assert(/>6p<\/text>/.test(html), '6p y-axis label present');
      assert(/>6a<\/text>/.test(html), '6a y-axis label present');
    });

    it('Duration view draws hour y-axis labels ending in "h"', async () => {
      const html = await buildAndRender(durationDeps(), { view: 'duration' });
      assert(/>\d+h<\/text>/.test(html), 'an "Nh" y-axis label present');
      // x-axis labels are shared with the Onset view.
      assert(/>12 PM<\/text>/.test(html), '12 PM x-axis label present in Duration view');
    });

    it('emits at least one faint gridline', async () => {
      const html = await buildAndRender(onsetDeps(), { view: 'onset' });
      assert(/class="rhythm-gridline"/.test(html), 'gridline present');
    });

    it('dots carry data-day + data-tip and NO <title>', async () => {
      const html = await buildAndRender(onsetDeps(), { view: 'onset' });
      assert(/<circle[^>]*data-day="/.test(html), 'circle carries data-day');
      assert(/<circle[^>]*data-tip="/.test(html), 'circle carries data-tip');
      // The data-day uses the dose calendar day, not the sleep day.
      assert(html.indexOf('data-day="' + dayKeyOffset(-5) + '"') >= 0, 'data-day is the dose day key');
      assert(!/<title>/.test(html), 'native <title> removed from dot markup');
    });

    it('tooltip text is single-line and joins with " · "', async () => {
      const html = await buildAndRender(onsetDeps(), { view: 'onset' });
      const m = html.match(/data-tip="([^"]*)"/);
      assert(m, 'a data-tip attribute exists');
      const tip = m[1];
      assert(tip.indexOf(' · ') >= 0, 'tip uses the " · " separator');
      assert(tip.indexOf('\n') < 0, 'tip is single-line');
      assert(/dose 8 AM/.test(tip), 'tip names the dose hour');
      assert(/q4\/5/.test(tip), 'tip names the quality out of 5');
    });

    it('keeps the axis-direction caption and the quality legend', async () => {
      const html = await buildAndRender(onsetDeps(), { view: 'onset' });
      assert(/class="rhythm-ms-axis"/.test(html), 'direction caption retained');
      assert(/class="rhythm-ms-legend"/.test(html), 'quality legend retained');
    });

    it('renders the toggle radiogroup with both Onset and Duration options', async () => {
      const html = await buildAndRender(onsetDeps(), { view: 'onset' });
      assert(/data-insight-action="meds-sleep:view:onset"/.test(html), 'onset toggle action present');
      assert(/data-insight-action="meds-sleep:view:duration"/.test(html), 'duration toggle action present');
    });

    it('shows an inner empty-state when the selected view has no usable points', async () => {
      // Dose with NO matching following-night sleep → no usable onset points.
      const deps = {
        now: () => NOW,
        getMeds: () => [stubMed('m1', 'Vyvanse', [atLocalDayHour(-5, 8, 0)])],
        getRestLog: () => ({}),
      };
      const html = await buildAndRender(deps, { view: 'onset' });
      assert(/Log bedtimes/.test(html), 'onset no-data copy present');
      assert(!/class="rhythm-gridline"/.test(html), 'no gridlines when no usable points');
    });
  });
})();
