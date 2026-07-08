// tests/ui/import-survival.spec.js — the import boundary is ALREADY hardened
// (export.js:245-322 validates version/shape; history-ui.js:62 catches). These
// specs LOCK that safety against regression AND prove the XSS fix holds against
// the import DELIVERY vector (a hostile med name smuggled in a backup).
const { test, expect } = require('@playwright/test');
const { gotoApp, XSS_IMG_ONERROR } = require('./support/app');

// Call the real import engine directly; capture whether it threw.
async function importJson(page, json) {
  return page.evaluate(async (j) => {
    try { return { ok: true, result: await Export.importAllData(j) }; }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  }, json);
}

test('malformed JSON is rejected without an uncaught page error', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await gotoApp(page);

  const r = await importJson(page, '{ not valid json');

  expect(r.ok).toBe(false);          // importAllData threw (JSON.parse)...
  expect(errors, errors.join('\n')).toHaveLength(0); // ...nothing escaped.
  const alive = await page.evaluate(() => typeof MedsManager.all === 'function');
  expect(alive).toBe(true);          // app still responsive.
});

test('a __proto__ key in a valid backup does not pollute Object.prototype', async ({ page }) => {
  await gotoApp(page);

  const r = await importJson(
    page,
    '{"version":1,"__proto__":{"polluted":true},"sessions":[],"settings":{},"meds":[]}'
  );

  expect(r.ok).toBe(true);
  const polluted = await page.evaluate(() => ({}).polluted);
  expect(polluted).toBeUndefined();
});

test('a hostile med name delivered via import renders inert (XSS-delivery cross-check)', async ({ page }) => {
  await gotoApp(page);
  const now = Date.now();
  const backup = JSON.stringify({
    version: 1,
    sessions: [],
    settings: {},
    meds: [{
      id: 'xss-import', name: XSS_IMG_ONERROR, dose: '',
      frequency: 'once-daily', lastTakenAt: now, doseLog: [{ takenAt: now }],
    }],
  });

  const r = await importJson(page, backup);
  expect(r.ok).toBe(true);

  // Reload meds from the freshly-written localStorage, then render the sink.
  await page.evaluate(async () => {
    MedsManager.loadAll();
    const adh = await Analytics.getMedAdherence(30);
    document.getElementById('analytics-content').innerHTML = renderMedAdherence(adh);
  });

  const fired = await page.evaluate(() => window.__xssFired === true);
  expect(fired, 'imported hostile med name executed on render').toBe(false);
  await expect(page.locator('#analytics-content .adherence-dots img')).toHaveCount(0);
});
