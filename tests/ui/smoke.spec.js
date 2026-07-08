// tests/ui/smoke.spec.js — proves the harness boots the REAL app (index.html)
// in headless Chromium with the service worker blocked and no uncaught boot
// error. If this fails, nothing else in the suite is trustworthy.
const { test, expect } = require('@playwright/test');
const { gotoApp } = require('./support/app');

test('real app boots under a blocked service worker with no page error', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await gotoApp(page, '#/home');

  // Static shell root is present.
  await expect(page.locator('#app')).toBeAttached();
  // No service worker took control — the config blocked registration.
  const controller = await page.evaluate(
    () => !!(navigator.serviceWorker && navigator.serviceWorker.controller)
  );
  expect(controller).toBe(false);
  // Boot raised no uncaught error.
  expect(errors, errors.join('\n')).toHaveLength(0);
});
