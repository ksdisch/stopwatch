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
