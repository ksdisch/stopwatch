// tests/ui/support/app.js — shared helpers + attack payloads for the Proving
// Ground UI specs. Keep thin; grow as coverage grows.

// Attribute-breakout: fires only on mouseover, which headless cannot trigger,
// so specs assert attribute-INTEGRITY (no injected handler) for this payload.
const XSS_ATTR_BREAKOUT = '" onmouseover="window.__xssFired=true';
// Element-injection: the <img> onerror fires on inject with no interaction,
// so `window.__xssFired` is the DECISIVE canary for this payload.
const XSS_IMG_ONERROR = '"><img src=x onerror="window.__xssFired=true">';

// Boot the real app at a hash route with the SW blocked (config-level). The
// app's <script> tags are synchronous, so by the 'load' event every engine
// global exists; assert that explicitly so a spec fails loudly if boot ever
// regresses.
async function gotoApp(page, hash = '#/home') {
  await page.goto('/index.html' + hash, { waitUntil: 'load' });
  await page.waitForFunction(
    () =>
      typeof MedsManager !== 'undefined' &&
      typeof Analytics !== 'undefined' &&
      typeof renderMedAdherence === 'function'
  );
}

// Seed one non-as-needed med (so Analytics.getMedAdherence includes it — it
// skips 'as-needed') with a dose logged today, then persist. Runs in-page.
async function seedMed(page, name) {
  await page.evaluate((medName) => {
    const med = MedsManager.add({ name: medName, frequency: 'once-daily' });
    med.logDose(Date.now());
    MedsManager.saveAll();
  }, name);
}

module.exports = { XSS_ATTR_BREAKOUT, XSS_IMG_ONERROR, gotoApp, seedMed };
