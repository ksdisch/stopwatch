// Tests for js/bfrb-risk.js (BfrbRisk.assess — the pure "is today clustering?" core).
//
// Contracts under test:
//   - Suppression: never assert a band without ≥ MIN_ACTIVE_DAYS of baseline.
//   - Baseline is the mean over ACTIVE days only (clean days + today excluded).
//   - 'steady' below the today floor; 'clustered' at/above ceil(baseline × factor).
//   - The strained recovery re-lens is strictly ADDITIVE (only ever makes the
//     nudge MORE available — it flips steady→clustered, never the reverse).
//   - Empty / null / malformed events never throw and never produce NaN.
//   - Recovery absent is the DEFAULT path (no feed required).

(function () {
  const HOUR = 3600000;
  const DAY = 86400000;
  // Fixed local noon so day-bucketing is boundary-stable (no DST/midnight races).
  const NOW = new Date(2026, 4, 20, 12, 0, 0, 0).getTime();

  // A catch n whole days before NOW (lands at the same local clock time → prior
  // local date). n=0 would be today; baseline helpers use n≥1.
  function daysAgo(n) { return { takenAt: NOW - n * DAY }; }
  // A catch `hoursAgo` before NOW (stays within today for small values).
  function todayCatch(hoursAgo) { return { takenAt: NOW - hoursAgo * HOUR }; }

  // Build `count` catches on each of the given day-offsets (≥1 = baseline days).
  function onDays(offsets, count) {
    const out = [];
    offsets.forEach(off => { for (let i = 0; i < count; i++) out.push({ takenAt: NOW - off * DAY - i * 60000 }); });
    return out;
  }

  function assess(events, opts) {
    return BfrbRisk.assess(Object.assign({ events: events, now: NOW }, opts || {}));
  }

  describe('BfrbRisk.assess — robustness', () => {
    it('empty / null / undefined input never throws and reports suppressed', () => {
      [undefined, {}, { events: null }, { events: [] }, { events: undefined }].forEach(inp => {
        let r, ok = true;
        try { r = BfrbRisk.assess(inp); } catch (e) { ok = false; }
        assert(ok, 'assess(' + JSON.stringify(inp) + ') did not throw');
        assertEqual(r.band, null);
        assertEqual(r.suppressed, true);
      });
    });

    it('malformed entries are skipped, never NaN', () => {
      const events = [null, {}, { takenAt: 'x' }, { takenAt: NaN }, { takenAt: NOW - 2 * HOUR }];
      const r = assess(events);
      assert(isFinite(r.baselineActiveAvg), 'baselineActiveAvg finite');
      assert(Number.isInteger(r.todayCount), 'todayCount integer');
      assertEqual(r.todayCount, 1); // only the one valid today entry
    });

    it('future-stamped catches are ignored', () => {
      const events = [{ takenAt: NOW + 5 * HOUR }, { takenAt: NOW - 1 * HOUR }];
      const r = assess(events);
      assertEqual(r.todayCount, 1);
    });
  });

  describe('BfrbRisk.assess — suppression guard (thin baseline)', () => {
    it('fewer than MIN_ACTIVE_DAYS active days → band null, suppressed', () => {
      // 3 active baseline days + a heavy today. activeDays < 4 → suppress.
      const events = onDays([1, 2, 3], 3).concat([todayCatch(1), todayCatch(2), todayCatch(3), todayCatch(4)]);
      const r = assess(events);
      assertEqual(r.activeDays, 3);
      assertEqual(r.band, null);
      assertEqual(r.suppressed, true);
      assertEqual(r.todayCount, 4); // count is still reported even while suppressed
    });

    it('exactly MIN_ACTIVE_DAYS active days → no longer suppressed', () => {
      const events = onDays([1, 2, 3, 4], 1).concat([todayCatch(1)]);
      const r = assess(events);
      assertEqual(r.activeDays, 4);
      assertEqual(r.suppressed, false);
    });
  });

  describe('BfrbRisk.assess — baseline is active-day mean (excludes clean days + today)', () => {
    it('clean days do NOT dilute the baseline', () => {
      // 5 active days × 2 catches inside the 14d window; other 9 days clean.
      const events = onDays([1, 2, 5, 8, 11], 2).concat([todayCatch(1)]);
      const r = assess(events);
      assertEqual(r.activeDays, 5);
      assertClose(r.baselineActiveAvg, 2.0, 1e-9); // 10 / 5, NOT 10 / 14
    });

    it('today catches do NOT inflate the baseline', () => {
      const events = onDays([1, 2, 3, 4], 1).concat([todayCatch(1), todayCatch(2), todayCatch(3)]);
      const r = assess(events);
      assertClose(r.baselineActiveAvg, 1.0, 1e-9); // baseline = 4 days × 1, today excluded
      assertEqual(r.todayCount, 3);
    });

    it('catches older than the 14-day window are excluded from the baseline', () => {
      const events = onDays([1, 2, 3, 4], 1).concat(onDays([20, 30], 5)).concat([todayCatch(1)]);
      const r = assess(events);
      assertEqual(r.activeDays, 4); // the day-20 / day-30 catches are out of window
    });
  });

  describe('BfrbRisk.assess — steady vs clustered', () => {
    it('below the today floor (3) → steady', () => {
      // baseline avg 1.0 (4×1); today = 2 (< floor 3) → steady, not clustered.
      const events = onDays([1, 2, 3, 4], 1).concat([todayCatch(1), todayCatch(2)]);
      const r = assess(events);
      assertEqual(r.band, 'steady');
      assertEqual(r.suppressed, false);
    });

    it('at/above ceil(baseline × 1.5) and ≥ floor → clustered', () => {
      // baseline avg 2.0 (4×2) → threshold ceil(3) = 3; today = 3 → clustered.
      const events = onDays([1, 2, 3, 4], 2).concat([todayCatch(1), todayCatch(2), todayCatch(3)]);
      const r = assess(events);
      assertEqual(r.band, 'clustered');
    });

    it('above the floor but below the cluster threshold → steady', () => {
      // baseline avg 4.0 (4×4) → threshold ceil(6) = 6; today = 4 (≥floor, <6) → steady.
      const events = onDays([1, 2, 3, 4], 4)
        .concat([todayCatch(1), todayCatch(2), todayCatch(3), todayCatch(4)]);
      const r = assess(events);
      assertEqual(r.band, 'steady');
    });
  });

  describe('BfrbRisk.assess — recovery re-lens (strictly additive)', () => {
    // baseline avg 1.0 (4×1), today = 2. Normal → steady (below floor 3).
    // Strained → floor 2, threshold ceil(1.0×1.25)=2, today 2 ≥ 2 → clustered.
    const events = onDays([1, 2, 3, 4], 1).concat([todayCatch(1), todayCatch(2)]);

    it('no recovery feed (null) is the default path → normal thresholds → steady', () => {
      const r = assess(events, { recoveryState: null });
      assertEqual(r.band, 'steady');
      assertEqual(r.strainedLens, false);
    });

    it("a 'well_recovered' / unrecognized signal is NOT strained → steady", () => {
      const r1 = assess(events, { recoveryState: { recovery_signal: 'well_recovered' } });
      const r2 = assess(events, { recoveryState: { recovery_signal: 'mystery' } });
      assertEqual(r1.band, 'steady');
      assertEqual(r1.strainedLens, false);
      assertEqual(r2.band, 'steady');
    });

    it("a 'strained' signal flips the SAME data steady → clustered (additive only)", () => {
      const r = assess(events, { recoveryState: { recovery_signal: 'strained' } });
      assertEqual(r.strainedLens, true);
      assertEqual(r.band, 'clustered');
    });

    it('the strained lens never SUPPRESSES a would-be clustered day', () => {
      // A normally-clustered day stays clustered under the strained lens.
      const big = onDays([1, 2, 3, 4], 2)
        .concat([todayCatch(1), todayCatch(2), todayCatch(3), todayCatch(4)]);
      const normal = assess(big);
      const strained = assess(big, { recoveryState: { recovery_signal: 'strained' } });
      assertEqual(normal.band, 'clustered');
      assertEqual(strained.band, 'clustered');
    });
  });
})();
