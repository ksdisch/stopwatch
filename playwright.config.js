// playwright.config.js — Tempo Proving Ground (UI/integration harness).
//
// Loads the REAL index.html in headless Chromium with the service worker
// BLOCKED at the browser-context layer. That needs no production change:
// app.js's `navigator.serviceWorker.register('sw.js').catch(()=>{})` is
// fire-and-forget, so the blocked registration is swallowed — and no stale SW
// cache can serve old assets. A fresh Playwright context per test gives empty
// localStorage/IndexedDB for free (decisive for a state-heavy PWA).
//
// Served by `python3 -m http.server 8766` (mirrors scripts/run-tests.mjs).
// Port 8766 (not the engine suite's 8765) so `npm test` and `npm run test:ui`
// can run as concurrent CI jobs without contending for the socket.
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/ui',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8766',
    serviceWorkers: 'block',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'python3 -m http.server 8766',
    url: 'http://127.0.0.1:8766/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
