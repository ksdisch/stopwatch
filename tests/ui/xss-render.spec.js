// tests/ui/xss-render.spec.js — attribute-XSS in the med-adherence render.
// A user-controlled med NAME flows into aria-label at analytics-ui.js:303
// UNESCAPED (contrast :298, which escapes the visible name). Before the fix
// the raw name breaks out of the attribute; after, escapeHtml neutralizes it.
// Exercises the real pipeline: MedsManager.add → Analytics.getMedAdherence →
// renderMedAdherence → DOM.
const { test, expect } = require('@playwright/test');
const { gotoApp, seedMed, XSS_IMG_ONERROR, XSS_ATTR_BREAKOUT } = require('./support/app');

// Render the med-adherence card (the real production functions) into the real
// #analytics-content container; return the rendered aria-label (decoded).
async function renderAdherence(page) {
  return page.evaluate(async () => {
    const adh = await Analytics.getMedAdherence(30);
    const host = document.getElementById('analytics-content');
    host.innerHTML = renderMedAdherence(adh);
    const dots = host.querySelector('.adherence-dots');
    return dots ? dots.getAttribute('aria-label') : null;
  });
}

test('element-injection med name does not execute via the adherence aria-label', async ({ page }) => {
  await gotoApp(page);
  await seedMed(page, XSS_IMG_ONERROR);

  const ariaLabel = await renderAdherence(page);

  // The onerror image auto-fires on inject — the canary is decisive here.
  const fired = await page.evaluate(() => window.__xssFired === true);
  expect(fired, 'XSS payload executed via aria-label breakout').toBe(false);
  // No injected <img> smuggled into the adherence card.
  await expect(page.locator('#analytics-content .adherence-dots img')).toHaveCount(0);
  // The aria-label carries the literal payload as inert text (present post-fix,
  // empty/truncated pre-fix because the browser terminated the attribute early).
  expect(ariaLabel).toContain(XSS_IMG_ONERROR);
});

test('attribute-breakout med name cannot inject a new event-handler attribute', async ({ page }) => {
  await gotoApp(page);
  await seedMed(page, XSS_ATTR_BREAKOUT);
  await renderAdherence(page);

  // Headless can't fire onmouseover, so assert structurally: the div carries
  // NO onmouseover attribute (a breakout would have added one).
  const hasHandler = await page.evaluate(() => {
    const el = document.querySelector('#analytics-content .adherence-dots');
    return !!el && el.hasAttribute('onmouseover');
  });
  expect(hasHandler, 'attribute breakout injected an onmouseover handler').toBe(false);
});
