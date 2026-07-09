// Tests for js/rhythm-panel-today.js — the "Today" Rhythm Insights panel (order 5).
//
// The panel is a thin adapter: build(deps) resolves the async getSessions once,
// picks the latest recovery row (deps override → live RecoveryFeed fallback),
// and hands a synchronous shape to TempoCoach.buildTodayModel. render(model)
// returns a DESCRIPTIVE HTML STRING reusing the shared card/empty helpers and
// NEVER touches `document`.
//
// Coverage (per the audit Test scope):
//   - self-registers at order 5, title 'Today'
//   - build over populated / sparse / signed-out-empty _deps
//   - render returns a non-empty string per state + the empty-state card on no data
//   - render escapes interpolated text (med name with HTML)
//   - neither build nor render references `document`
//   - build prefers a deps.getRecoveryLatest override over the live RecoveryFeed

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
  function stubMed(opts) {
    return {
      getName: () => opts.name,
      getDose: () => opts.dose || '',
      getStatusToday: () => opts.status,
      getDoseLog: () => opts.doseLog || [],
    };
  }

  function panel() { return RI.getPanels().find(p => p.key === 'today'); }

  // Populated _deps: recovery well, one logged med, sleep today, a focus session.
  function populatedDeps() {
    return {
      now: () => NOW,
      getRecoveryLatest: () => ({ recovery_signal: 'well_recovered', hrv: 60 }),
      getMeds: () => [stubMed({ name: 'Vyvanse', dose: '60 mg', status: { kind: 'done', takenToday: 1, expected: 1 } })],
      getRestLog: () => ({ [dayKeyOffset(0)]: { sleep: { hours: 7.5, quality: 4, bedtime: '23:00' } } }),
      getSessions: async () => [
        { type: 'flow', date: new Date(atLocalDayHour(0, 9)).toISOString(), duration: 90 * 60000 },
      ],
    };
  }

  // Signed-out / no-data _deps: nothing local, no recovery.
  function emptyDeps() {
    return {
      now: () => NOW,
      getRecoveryLatest: () => null,
      getMeds: () => [],
      getRestLog: () => ({}),
      getSessions: async () => [],
    };
  }

  // Sparse _deps: sleep logged but no recovery feed.
  function sparseDeps() {
    return {
      now: () => NOW,
      getRecoveryLatest: () => null,
      getMeds: () => [],
      getRestLog: () => ({ [dayKeyOffset(0)]: { sleep: { hours: 6.5, quality: 3, bedtime: '23:30' } } }),
      getSessions: async () => [],
    };
  }

  describe('Today panel registration', () => {
    it('self-registers at order 5 with title "Today"', () => {
      const p = panel();
      assert(p, 'today panel registered');
      assertEqual(p.order, 5);
      assertEqual(p.title, 'Today');
    });
  });

  describe('Today panel build()', () => {
    it('populated _deps → hasRecovery:true, empty:false', async () => {
      const m = await panel().build(populatedDeps());
      assertEqual(m.hasRecovery, true);
      assertEqual(m.empty, false);
      assertEqual(m.band, 'well');
      assertEqual(m.doseStatus.hasMeds, true);
      assertEqual(m.sleep.logged, true);
      assert(m.focusTodayMs > 0, 'focus minutes resolved from async getSessions');
    });

    it('populated build → render returns a non-empty string', async () => {
      const m = await panel().build(populatedDeps());
      const html = panel().render(m);
      assertEqual(typeof html, 'string');
      assert(html.length > 0, 'non-empty render');
      assert(/data-insight-panel="today"/.test(html), 'card hook present');
    });

    it('signed-out/no-data _deps → empty:true; render returns the empty-state card', async () => {
      const m = await panel().build(emptyDeps());
      assertEqual(m.empty, true);
      assertEqual(m.hasRecovery, false);
      const html = panel().render(m);
      assertEqual(typeof html, 'string');
      assert(html.length > 0, 'non-empty render');
      assert(/rhythm-insight-empty/.test(html), 'empty-state card rendered');
      assert(/data-insight-panel="today"/.test(html), 'still a Today card, not a blank');
    });

    it('sparse _deps (sleep only, no recovery) → empty:false, hasRecovery:false; render is a non-empty local card', async () => {
      const m = await panel().build(sparseDeps());
      assertEqual(m.empty, false);
      assertEqual(m.hasRecovery, false);
      const html = panel().render(m);
      assert(html.length > 0, 'non-empty render');
      // local-only card: aside reads "local" (no recovery re-lens), sleep row present.
      assert(/>local</.test(html), 'aside is "local" when no recovery signal');
      assert(/Last night/.test(html), 'sleep row rendered from local rest log');
      assert(/rhythm-insight-empty/.test(html) === false, 'not the empty state — has local value');
    });

    it('build prefers deps.getRecoveryLatest override over the live RecoveryFeed', async () => {
      // The override returns strained; if the panel ignored it and read the live
      // feed, the band would not be 'strained' (the live feed is unset in tests).
      const deps = Object.assign(emptyDeps(), {
        getRecoveryLatest: () => ({ recovery_signal: 'strained' }),
      });
      const m = await panel().build(deps);
      assertEqual(m.band, 'strained');
      assertEqual(m.hasRecovery, true);
    });
  });

  describe('Today panel render() — escaping + descriptive copy', () => {
    it('escapes an interpolated med name containing HTML (no raw <b> in output)', async () => {
      const deps = Object.assign(emptyDeps(), {
        getMeds: () => [stubMed({
          name: '<b>Vyvanse</b>', dose: '60 mg',
          status: { kind: 'none', takenToday: 0, expected: 1 },
        })],
      });
      const m = await panel().build(deps);
      const html = panel().render(m);
      assert(html.indexOf('<b>Vyvanse</b>') === -1, 'raw <b> not injected');
      assert(/&lt;b&gt;Vyvanse&lt;\/b&gt;/.test(html), 'med name escaped');
    });

    it('render(undefined) and render({}) never throw — return the empty-state card', () => {
      const a = panel().render(undefined);
      const b = panel().render({});
      assertEqual(typeof a, 'string');
      assertEqual(typeof b, 'string');
      assert(/rhythm-insight-empty/.test(a), 'undefined model → empty card');
      assert(/rhythm-insight-empty/.test(b), 'empty model → empty card');
    });

    it('descriptive-only — rendered copy has no "take"/"you should" imperative', async () => {
      const m = await panel().build(populatedDeps());
      const html = panel().render(m);
      assert(!/\btake\b/i.test(html), 'no "take" imperative in rendered copy');
      assert(!/you should/i.test(html), 'no "you should" in rendered copy');
    });
  });

  describe('Today panel render() — supply refill line (med-runway-adherence-loop)', () => {
    function modelWithRefill(refillSoon) {
      return {
        band: null, hasRecovery: false,
        focusSuggestion: { ms: null, band: null, reason: null },
        doseStatus: {
          hasMeds: true, allLogged: true, anyUnlogged: false,
          meds: [{ name: 'Adderall', dose: '20 mg', kind: 'done', takenToday: 1, expected: 1, runwayDays: 3 }],
          refillSoon: refillSoon,
        },
        sleep: { logged: false }, focusTodayMs: 0,
        doseSleep: { usable: false }, empty: false,
      };
    }

    it('renders one refill line with the day count and a "refill by ~" date', () => {
      const html = panel().render(modelWithRefill([{ name: 'Adderall', runwayDays: 3, refillAt: NOW + 3 * 86400000 }]));
      assert(html.indexOf('about 3 days of supply left') !== -1, 'day count rendered');
      assert(html.indexOf('refill by ~') !== -1, 'refill-by date rendered');
    });

    it('runway 0 renders the runs-out-today copy', () => {
      const html = panel().render(modelWithRefill([{ name: 'Adderall', runwayDays: 0, refillAt: NOW }]));
      assert(html.indexOf('runs out today') !== -1, 'out-today copy rendered');
    });

    it('multiple low meds stay ONE line: tightest med + a count of the others', () => {
      const html = panel().render(modelWithRefill([
        { name: 'Tight', runwayDays: 1, refillAt: NOW + 86400000 },
        { name: 'Loose', runwayDays: 5, refillAt: NOW + 5 * 86400000 },
      ]));
      assert(html.indexOf('Tight: about 1 day of supply left') !== -1, 'tightest med leads');
      assert(html.indexOf('1 more med under a week of supply') !== -1, 'others summarized');
      assert(html.indexOf('Loose') === -1, 'non-tightest med not itemized');
    });

    it('empty refillSoon (and models without the field) render no refill line', () => {
      const a = panel().render(modelWithRefill([]));
      const legacy = modelWithRefill([]);
      delete legacy.doseStatus.refillSoon;
      const b = panel().render(legacy);
      assert(a.indexOf('refill') === -1, 'no refill line for empty refillSoon');
      assert(b.indexOf('refill') === -1, 'no refill line for a pre-runway model shape');
    });

    it('escapes a hostile med name in the refill line', () => {
      const html = panel().render(modelWithRefill([
        { name: '<img src=x onerror=alert(1)>', runwayDays: 2, refillAt: NOW + 2 * 86400000 },
      ]));
      assert(html.indexOf('<img') === -1, 'raw tag not present');
      assert(html.indexOf('&lt;img') !== -1, 'escaped form present');
    });
  });

  describe('Today panel — purity (no DOM)', () => {
    it('neither build nor render references `document` (no DOM access)', () => {
      const p = panel();
      assert(p.build.toString().indexOf('document') === -1, 'build does not reference document');
      assert(p.render.toString().indexOf('document') === -1, 'render does not reference document');
    });
  });
})();
