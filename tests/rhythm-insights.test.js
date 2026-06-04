// Tests for js/rhythm-insights.js (foundation engine + shared helpers) and the
// Meds-vs-Sleep panel's pure build(). Panels read via injected deps, so these
// pass plain data — no MedsManager / RecoveryUI seeding required.

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

  // ── windowDays ──────────────────────────────────────────────────────
  describe('RhythmInsights.windowDays', () => {
    it('returns n days oldest→newest ending today', () => {
      const w = RI.windowDays(14, NOW);
      assertEqual(w.length, 14);
      assertEqual(w[13].key, dayKeyOffset(0));
      assertEqual(w[0].key, dayKeyOffset(-13));
      assert(w[0].start < w[13].start, 'oldest first');
    });
    it('each bucket spans one local day and today contains now', () => {
      const w = RI.windowDays(3, NOW);
      w.forEach(d => assert(d.end > d.start, 'end after start'));
      assert(w[2].start <= NOW && NOW < w[2].end, 'today bucket contains now');
    });
  });

  // ── bucketByDay / sumByDay ──────────────────────────────────────────
  describe('RhythmInsights.bucketByDay', () => {
    it('buckets in-window items by local day and drops out-of-window', () => {
      const items = [
        { t: atLocalDayHour(0, 9) },
        { t: atLocalDayHour(0, 22) },
        { t: atLocalDayHour(-2, 10) },
        { t: atLocalDayHour(-30, 10) }, // outside the 14-day window
      ];
      const map = RI.bucketByDay(items, x => x.t, 14, NOW);
      assertEqual(map.get(dayKeyOffset(0)).length, 2);
      assertEqual(map.get(dayKeyOffset(-2)).length, 1);
      assertEqual(map.has(dayKeyOffset(-30)), false);
    });
    it('drops non-finite timestamps', () => {
      const map = RI.bucketByDay([{ t: NaN }, { t: atLocalDayHour(0, 9) }], x => x.t, 7, NOW);
      assertEqual(map.get(dayKeyOffset(0)).length, 1);
    });
  });

  describe('RhythmInsights.sumByDay', () => {
    it('sums per day aligned to the window and 0-fills gaps', () => {
      const items = [
        { t: atLocalDayHour(0, 9), v: 30 },
        { t: atLocalDayHour(0, 11), v: 15 },
        { t: atLocalDayHour(-1, 9), v: 20 },
      ];
      const series = RI.sumByDay(items, x => x.t, x => x.v, 14, NOW);
      assertEqual(series.length, 14);
      assertEqual(series[13].value, 45); // today
      assertEqual(series[12].value, 20); // yesterday
      assertEqual(series[0].value, 0);   // 13 days ago, empty
    });
  });

  // ── qualityColor / fmtHour ──────────────────────────────────────────
  describe('RhythmInsights.qualityColor', () => {
    it('maps 1→red, 5→green, null→secondary, all 5 distinct', () => {
      assertEqual(RI.qualityColor(1), 'var(--red)');
      assertEqual(RI.qualityColor(5), 'var(--green)');
      assertEqual(RI.qualityColor(null), 'var(--text-secondary)');
      const set = new Set([1, 2, 3, 4, 5].map(RI.qualityColor));
      assertEqual(set.size, 5);
    });
  });

  describe('RhythmInsights.fmtHour', () => {
    it('formats 12/24h boundaries and wraps', () => {
      assertEqual(RI.fmtHour(0), '12 AM');
      assertEqual(RI.fmtHour(12), '12 PM');
      assertEqual(RI.fmtHour(7), '7 AM');
      assertEqual(RI.fmtHour(13), '1 PM');
      assertEqual(RI.fmtHour(23), '11 PM');
      assertEqual(RI.fmtHour(24), '12 AM');
    });
  });

  // ── axis / gridline / niceTicks helpers ─────────────────────────────
  describe('RhythmInsights axis helpers', () => {
    const dims = RI.svgScaffold({ w: 200, h: 100, padL: 20, padR: 10, padT: 10, padB: 20 });

    it('gridlines emits one <line.rhythm-gridline> per position', () => {
      const s = RI.gridlines(dims, { ys: [30, 50], xs: [40] });
      assertEqual((s.match(/<line/g) || []).length, 3);
      assert(/class="rhythm-gridline"/.test(s), 'gridline class present');
      assert(s.indexOf('NaN') === -1, 'no NaN coords');
    });

    it('xAxis emits a baseline + tick labels, edge-anchored to avoid clipping', () => {
      const s = RI.xAxis(dims, [
        { x: dims.padL, label: '12 AM' },                          // left edge
        { x: dims.padL + dims.innerW / 2, label: '12 PM' },        // middle
        { x: dims.padL + dims.innerW, label: '12 AM' },            // right edge
      ]);
      assert(/class="rhythm-axis-line"/.test(s), 'axis baseline present');
      assert(/>12 PM<\/text>/.test(s), 'middle tick label rendered');
      assert(/text-anchor="start"/.test(s), 'left tick anchored start');
      assert(/text-anchor="end"/.test(s), 'right tick anchored end');
      assert(/text-anchor="middle"/.test(s), 'middle tick anchored middle');
    });

    it('yAxis emits a left baseline + right-anchored value labels', () => {
      const s = RI.yAxis(dims, [{ y: dims.padT, label: '8 h' }, { y: dims.padT + dims.innerH, label: '0 h' }]);
      assert(/class="rhythm-axis-line"/.test(s), 'y baseline present');
      assert(/text-anchor="end"/.test(s), 'labels right-anchored');
      assert(/>8 h<\/text>/.test(s) && />0 h<\/text>/.test(s), 'both tick labels present');
    });

    it('xAxis escapes tick labels', () => {
      const s = RI.xAxis(dims, [{ x: 50, label: '<b>x</b>' }]);
      assert(s.indexOf('<b>x</b>') === -1, 'raw markup not injected');
      assert(/&lt;b&gt;/.test(s), 'label escaped');
    });

    it('niceTicks covers 0..max with round 1/2/5 steps', () => {
      assertArrayEqual(RI.niceTicks(120, 4), [0, 50, 100, 150]);
      assertArrayEqual(RI.niceTicks(9, 4), [0, 5, 10]);
      assertArrayEqual(RI.niceTicks(6, 3), [0, 2, 4, 6]);
      const t = RI.niceTicks(0, 4); // degenerate max → falls back to 1
      assertEqual(t[0], 0);
      assert(t[t.length - 1] >= 1, 'covers the fallback max');
    });

    it('skips non-finite coords instead of emitting NaN attributes', () => {
      const g = RI.gridlines(dims, { ys: [NaN, 50], xs: [undefined] });
      assert(g.indexOf('NaN') === -1, 'no NaN in gridlines');
      assertEqual((g.match(/<line/g) || []).length, 1); // only the finite y=50 survives
      const xs = RI.xAxis(dims, [{ x: NaN, label: 'bad' }, { x: 50, label: 'ok' }]);
      assert(xs.indexOf('NaN') === -1, 'no NaN in xAxis');
      assert(/>ok<\/text>/.test(xs) && xs.indexOf('>bad<') === -1, 'bad tick skipped, good tick kept');
      const ys = RI.yAxis({ padL: NaN, padT: 0, innerW: 10, innerH: 10 }, [{ y: 5, label: 'z' }]);
      assert(ys.indexOf('NaN') === -1, 'malformed dims → no NaN, no output');
    });
  });

  // ── registry ────────────────────────────────────────────────────────
  describe('RhythmInsights registry', () => {
    it('sorts panels by order, then registration sequence', () => {
      RI.register({ key: '__ri_t_b__', title: 'B', order: 950, build: () => ({}), render: () => '' });
      RI.register({ key: '__ri_t_a__', title: 'A', order: 940, build: () => ({}), render: () => '' });
      const keys = RI.getPanels().map(p => p.key);
      assert(keys.indexOf('__ri_t_a__') < keys.indexOf('__ri_t_b__'), 'lower order renders first');
    });
    it('dedupes by key (last registration wins) + has()', () => {
      RI.register({ key: '__ri_t_dup__', title: 'first', order: 900, build: () => ({}), render: () => '' });
      RI.register({ key: '__ri_t_dup__', title: 'second', order: 901, build: () => ({}), render: () => '' });
      const dup = RI.getPanels().filter(p => p.key === '__ri_t_dup__');
      assertEqual(dup.length, 1);
      assertEqual(dup[0].title, 'second');
      assertEqual(RI.has('__ri_t_dup__'), true);
    });
    it('ignores invalid panel shapes', () => {
      const before = RI.getPanels().length;
      RI.register(null);
      RI.register({ key: 'x' }); // missing build/render
      assertEqual(RI.getPanels().length, before);
    });
  });

  // ── renderInto partial-failure isolation ────────────────────────────
  describe('RhythmInsights.renderInto', () => {
    it('isolates a failing panel without blanking the others', async () => {
      RI.register({
        key: '__ri_ok__', title: 'OK Panel', order: 990,
        build: () => ({ ok: true }),
        render: () => RI.card({ key: '__ri_ok__', label: 'OK Panel', body: '<p class="ok-body">good</p>' }),
      });
      RI.register({
        key: '__ri_fail__', title: 'Fail Panel', order: 991,
        build: () => { throw new Error('boom'); },
        render: () => '<p>should not run</p>',
      });

      const div = document.createElement('div');
      const stub = {
        now: () => NOW,
        getMeds: () => [],
        getRestLog: () => ({}),
        getSessions: async () => [],
        getRecoveryHistory: () => ({ rows: [] }),
        getBfrbEvents: () => [],
        getBfrbTrend: async () => ({ days: 14, series: [], total: 0 }),
        getDistractions: async () => ({ total: 0, top5: [], hourly: [] }),
        getDayTimeline: async () => [],
      };
      await RI.renderInto(div, { deps: stub, days: 14 });

      assert(div.querySelector('[data-insight-panel="__ri_ok__"]'), 'ok panel rendered');
      assert(div.querySelector('.ok-body'), 'ok body present');
      const failCard = div.querySelector('[data-insight-panel="__ri_fail__"]');
      assert(failCard, 'fail panel still produced a fallback card');
      assert(/Could not load/.test(failCard.textContent), 'fail panel shows fallback copy');
    });
  });

  // ── hover: shared tooltip + cross-panel day highlight ───────────────
  describe('RhythmInsights hover interactivity', () => {
    const emptyDeps = {
      now: () => NOW, getMeds: () => [], getRestLog: () => ({}), getSessions: async () => [],
      getRecoveryHistory: () => ({ rows: [] }), getBfrbEvents: () => [],
      getBfrbTrend: async () => ({ days: 14, series: [], total: 0 }),
      getDistractions: async () => ({ total: 0, top5: [], hourly: [] }), getDayTimeline: async () => [],
    };

    it('shows the cursor tooltip and highlights every same-day element across panels', async () => {
      // Two panels, each with a dot for 2026-05-20, plus one for 2026-05-19.
      RI.register({
        key: '__ri_hov_a__', title: 'A', order: 994, build: () => ({}),
        render: () => RI.card({ key: '__ri_hov_a__', label: 'A', body:
          '<svg viewBox="0 0 100 20">'
          + '<circle id="hov-a1" data-day="2026-05-20" data-tip="dose 8 AM" r="3"/>'
          + '<circle id="hov-a2" data-day="2026-05-19" data-tip="dose 9 AM" r="3"/>'
          + '</svg>' }),
      });
      RI.register({
        key: '__ri_hov_b__', title: 'B', order: 995, build: () => ({}),
        render: () => RI.card({ key: '__ri_hov_b__', label: 'B', body:
          '<div id="hov-b1" data-day="2026-05-20" data-tip="120 min">x</div>' }),
      });

      const div = document.createElement('div');
      document.body.appendChild(div);
      await RI.renderInto(div, { deps: emptyDeps, days: 14 });

      const a1 = div.querySelector('#hov-a1');
      a1.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 30, clientY: 30 }));

      // cross-panel highlight: BOTH 05-20 elements (across panels A + B) light up;
      // the 05-19 dot does not.
      assert(div.querySelector('#hov-a1').classList.contains('rhythm-day-hi'), 'hovered dot highlighted');
      assert(div.querySelector('#hov-b1').classList.contains('rhythm-day-hi'), 'same-day element in OTHER panel highlighted');
      assert(!div.querySelector('#hov-a2').classList.contains('rhythm-day-hi'), 'different-day dot not highlighted');

      // tooltip: single div on <body>, visible, showing the hovered tip text.
      const tip = document.querySelector('.rhythm-tooltip');
      assert(tip, 'tooltip element created');
      assertEqual(tip.hidden, false);
      assertEqual(tip.textContent, 'dose 8 AM');

      // leaving the container clears the highlight and hides the tooltip.
      div.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
      assert(!div.querySelector('#hov-a1').classList.contains('rhythm-day-hi'), 'highlight cleared on leave');
      assertEqual(document.querySelector('.rhythm-tooltip').hidden, true);

      document.body.removeChild(div);
    });

    it('hides the tooltip when hovering bare chart space (no data-tip ancestor)', async () => {
      RI.register({
        key: '__ri_hov_c__', title: 'C', order: 996, build: () => ({}),
        render: () => RI.card({ key: '__ri_hov_c__', label: 'C', body:
          '<svg id="hov-svg" viewBox="0 0 100 20">'
          + '<circle id="hov-c1" data-day="2026-05-20" data-tip="hi" r="3"/></svg>' }),
      });
      const div = document.createElement('div');
      document.body.appendChild(div);
      await RI.renderInto(div, { deps: emptyDeps, days: 14 });

      div.querySelector('#hov-c1').dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 5, clientY: 5 }));
      assertEqual(document.querySelector('.rhythm-tooltip').hidden, false);
      // move onto the bare <svg> (no data-tip) → tooltip hides, highlight clears.
      div.querySelector('#hov-svg').dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 60, clientY: 5 }));
      assertEqual(document.querySelector('.rhythm-tooltip').hidden, true);
      assert(!div.querySelector('#hov-c1').classList.contains('rhythm-day-hi'), 'highlight cleared off-point');

      document.body.removeChild(div);
    });

    it('re-applies the SAME-day highlight after a re-render (no stale _hiDay short-circuit)', async () => {
      RI.register({
        key: '__ri_hov_d__', title: 'D', order: 997, build: () => ({}),
        render: () => RI.card({ key: '__ri_hov_d__', label: 'D', body:
          '<svg viewBox="0 0 100 20"><circle id="hov-d1" data-day="2026-05-20" data-tip="d" r="3"/></svg>' }),
      });
      const div = document.createElement('div');
      document.body.appendChild(div);
      const fire = () => div.querySelector('#hov-d1')
        .dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 10, clientY: 10 }));

      await RI.renderInto(div, { deps: emptyDeps, days: 14 });
      fire();
      assert(div.querySelector('#hov-d1').classList.contains('rhythm-day-hi'), 'first hover highlights');

      await RI.renderInto(div, { deps: emptyDeps, days: 14 }); // rebuild destroys the old node
      assert(!div.querySelector('#hov-d1').classList.contains('rhythm-day-hi'), 'highlight cleared by rebuild');

      fire(); // re-hover the SAME day — must re-apply (regression: stale _hiDay early-returned)
      assert(div.querySelector('#hov-d1').classList.contains('rhythm-day-hi'),
        'same-day highlight re-applies after re-render');

      document.body.removeChild(div);
    });

    it('resetHover() hides the tooltip + clears highlight (consumer route-away path)', async () => {
      RI.register({
        key: '__ri_hov_e__', title: 'E', order: 998, build: () => ({}),
        render: () => RI.card({ key: '__ri_hov_e__', label: 'E', body:
          '<svg viewBox="0 0 100 20"><circle id="hov-e1" data-day="2026-05-20" data-tip="e" r="3"/></svg>' }),
      });
      const div = document.createElement('div');
      document.body.appendChild(div);
      await RI.renderInto(div, { deps: emptyDeps, days: 14 });
      div.querySelector('#hov-e1').dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 10, clientY: 10 }));
      assertEqual(document.querySelector('.rhythm-tooltip').hidden, false);

      RI.resetHover();
      assertEqual(document.querySelector('.rhythm-tooltip').hidden, true);
      assert(!div.querySelector('#hov-e1').classList.contains('rhythm-day-hi'), 'resetHover clears highlight');

      document.body.removeChild(div);
    });
  });

  // ── Meds-vs-Sleep panel build() ─────────────────────────────────────
  describe('Meds-vs-Sleep panel build', () => {
    function panel() { return RI.getPanels().find(p => p.key === 'meds-sleep'); }

    it('is registered at order 10', () => {
      const p = panel();
      assert(p, 'meds-sleep registered');
      assertEqual(p.order, 10);
    });

    it('returns {empty:true} when no meds', async () => {
      const model = await panel().build({ now: () => NOW, getMeds: () => [], getRestLog: () => ({}) });
      assertEqual(model.empty, true);
    });

    it('pairs a dose with the FOLLOWING night\'s sleep (not the prior night)', async () => {
      const deps = {
        now: () => NOW,
        getMeds: () => [stubMed('m1', 'Vyvanse', [atLocalDayHour(-5, 8, 0)])],
        getRestLog: () => ({
          [dayKeyOffset(-5)]: { sleep: { bedtime: '22:00', hours: 6, quality: 2 } }, // night BEFORE the dose — must NOT be used
          [dayKeyOffset(-4)]: { sleep: { bedtime: '23:30', hours: 7, quality: 4 } }, // night AFTER the dose
        }),
      };
      const model = await panel().build(deps);
      assertEqual(model.empty, false);
      assertEqual(model.defaultMedId, 'm1');
      const pt = model.byMed['m1'].find(x => x.doseDayKey === dayKeyOffset(-5));
      assertClose(pt.doseHour, 8, 0.001);
      assertClose(pt.bedtimeHour, 23.5, 0.001); // from D+1 sleep, NOT D's 22:00
      assertEqual(pt.hours, 7);
      assertEqual(pt.quality, 4);
    });

    it('uses the earliest dose of the day for doseHour', async () => {
      const deps = {
        now: () => NOW,
        getMeds: () => [stubMed('m1', 'Vyvanse', [atLocalDayHour(-3, 14, 0), atLocalDayHour(-3, 7, 30)])],
        getRestLog: () => ({}),
      };
      const model = await panel().build(deps);
      const pt = model.byMed['m1'].find(x => x.doseDayKey === dayKeyOffset(-3));
      assertClose(pt.doseHour, 7.5, 0.001);
    });

    it('excludes doses outside the 14-day window', async () => {
      const deps = {
        now: () => NOW,
        getMeds: () => [stubMed('m1', 'V', [atLocalDayHour(-30, 8, 0)])],
        getRestLog: () => ({}),
      };
      const model = await panel().build(deps);
      const anyDose = model.byMed['m1'].some(x => x.doseHour != null);
      assertEqual(anyDose, false);
    });

    it('defaults selection to the most-dosed med', async () => {
      const deps = {
        now: () => NOW,
        getMeds: () => [
          stubMed('few', 'Few', [atLocalDayHour(-1, 8)]),
          stubMed('many', 'Many', [atLocalDayHour(-1, 8), atLocalDayHour(-2, 8), atLocalDayHour(-3, 8)]),
        ],
        getRestLog: () => ({}),
      };
      const model = await panel().build(deps);
      assertEqual(model.defaultMedId, 'many');
    });

    it('render() returns a card and never throws on the empty model', () => {
      const html = panel().render({ empty: true }, { state: () => ({}) });
      assert(/data-insight-panel="meds-sleep"/.test(html), 'card hook present');
      assert(/No medications/.test(html), 'empty-state copy present');
    });
  });
})();
