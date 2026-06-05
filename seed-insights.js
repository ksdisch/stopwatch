// Local-only sample-data seeder for the Rhythm Insights dashboard.
// Served by the dev server (python3 -m http.server 8765) and loaded from the
// DevTools console via:
//
//   fetch('/seed-insights.js').then(r => r.text()).then(eval)
//
// Writes ONLY to the localhost:8765 origin (IndexedDB history + a few
// localStorage keys) — it never touches your real data on the live site or iOS.
// To wipe it later: DevTools > Application > Storage > "Clear site data".
(async () => {
  const U = Utils;
  const now = new Date();
  const y = now.getFullYear(), mo = now.getMonth(), d = now.getDate();
  const dayDate = (i) => new Date(y, mo, d - i);
  const keyFor = (i) => U.localDateKey(dayDate(i));
  const at = (i, hour) => {
    const t = dayDate(i);
    t.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
    return t.getTime();
  };
  const hhmm = (hf) => {
    let h = hf % 24;
    if (h < 0) h += 24;
    const H = Math.floor(h), M = Math.round((h - H) * 60);
    return String(H).padStart(2, '0') + ':' + String(M % 60).padStart(2, '0');
  };

  // 1. Recovery cache -> Recovery Trends panel + recovery correlations
  const rows = [];
  for (let i = 13; i >= 0; i--) {
    const strained = (i % 3 === 0);
    rows.push({
      day: keyFor(i),
      hrv_ms: strained ? 50 + (i % 4) : 64 + (i % 7),
      acwr: +((strained ? 1.32 - (i % 3) * 0.04 : 0.92 + (i % 4) * 0.04).toFixed(2)),
      rhr_bpm: strained ? 58 - (i % 3) : 49 + (i % 3),
      recovery_signal: strained ? 'strained' : 'well_recovered',
    });
  }
  localStorage.setItem('tempo_recovery_state_history', JSON.stringify({ rows }));
  localStorage.setItem('tempo_recovery_state_latest', JSON.stringify(rows[rows.length - 1]));

  // 2. Meds + sleep (shared gradient: earlier dose -> earlier + better sleep)
  const restLog = {};
  let med = null;
  if (typeof MedsManager !== 'undefined') {
    MedsManager.clear();
    med = MedsManager.add({ name: 'Vyvanse', dose: '60 mg', frequency: 'once-daily' });
  }
  for (let D = 13; D >= 1; D--) {
    const g = (13 - D) / 12;                 // 0 (earliest dose hour) .. 1 (latest)
    if (med) med.logDose(at(D, 7 + g * 2.5)); // dose hour 7:00 -> 9:30
    const bed = 21.75 + g * 3;                // bedtime 21:45 -> 00:45
    const hrs = Math.round((8.3 - g * 2.3) * 10) / 10; // 8.3h -> 6.0h
    const q = Math.max(1, Math.min(5, Math.round(5 - g * 3)));
    restLog[keyFor(D - 1)] = {               // dose[D] pairs with night D-1
      sleep: { hours: hrs, quality: q, bedtime: hhmm(bed), wakeTime: hhmm(bed + hrs) },
      naps: [],
    };
  }
  if (med) MedsManager.saveAll();
  localStorage.setItem('wellness_rest_log', JSON.stringify(restLog));

  // 3. History sessions -> Focus Minutes, 14-Day Activity, Distractions, BFRB
  const cats = ['phone', 'email', 'notification', 'self', 'interrupted'];
  let count = 0;
  if (typeof History !== 'undefined') {
    await History.clearAll();
    for (let i = 13; i >= 0; i--) {
      const strained = (i % 3 === 0);
      if (i % 2 === 0) {                       // Flow block every other day
        const start = at(i, 10);
        const nd = strained ? 4 : 2, nb = strained ? 3 : 1;
        const dist = [], bf = [];
        for (let k = 0; k < nd; k++) dist.push({ category: cats[k % cats.length], timestamp: start + k * 600000 });
        for (let k = 0; k < nb; k++) bf.push({ timestamp: start + k * 900000 });
        await History.addSession({ type: 'flow', date: new Date(start).toISOString(), duration: 5400000, distractions: dist, bfrbs: bf });
        count++;
      }
      const pomos = (i % 4 === 0) ? 1 : (strained ? 2 : 4);
      for (let p = 0; p < pomos; p++) {
        const start = at(i, 13 + p * 0.5);
        const dist = (p === 0) ? [{ category: cats[(i + p) % cats.length], timestamp: start + 300000 }] : [];
        const bf = (strained && p === 0) ? [{ timestamp: start + 200000 }] : [];
        await History.addSession({ type: 'pomodoro', date: new Date(start).toISOString(), duration: 1500000, distractions: dist, bfrbs: bf });
        count++;
      }
      if (i % 3 === 1) { await History.addSession({ type: 'interval', date: new Date(at(i, 17)).toISOString(), duration: 1200000 }); count++; }
      if (i % 4 === 2) { await History.addSession({ type: 'cooking', date: new Date(at(i, 18.5)).toISOString(), duration: 600000 }); count++; }
    }
  }

  // 4. Route to Rhythm > Insights and force a fresh render
  location.hash = '#/rhythm/insights';
  if (typeof RhythmUI !== 'undefined' && RhythmUI.render) RhythmUI.render('insights');
  const surface = document.querySelector('.rhythm-insights-surface');
  if (surface && typeof RhythmInsights !== 'undefined') {
    await RhythmInsights.renderInto(surface, { days: 14 });
  }
  console.log('%c✅ Tempo Insights seeded', 'color:#34c759;font-weight:bold',
    '— ' + (med ? med.getDoseLog().length : 0) + ' doses, '
    + Object.keys(restLog).length + ' sleep nights, '
    + count + ' sessions, ' + rows.length + ' recovery days. '
    + 'Toggle Onset/Duration and hover the dots.');
})();
