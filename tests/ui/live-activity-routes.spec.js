// tests/ui/live-activity-routes.spec.js — regression specs for two
// device-smoke failures in the Live Activity tap flow (backlog #4):
//   1. The tempo://timers/timer deep-link maps to #/timers/timer, which must
//      land on Timer mode. Pre-fix, 'timer' was missing from TIMERS_MODES and
//      the route fell through the `|| TIMERS_MODES['stopwatch']` fallback.
//   2. Switching back into Timer mode with a running countdown must re-arm
//      the RAF render loop. Pre-fix, switchAppMode stopped every loop and
//      applyAppMode's timer branch never restarted it — the display froze at
//      one structural paint until the next button press.
const { test, expect } = require('@playwright/test');
const { gotoApp } = require('./support/app');

async function expectTimerModeActive(page) {
  // switchAppMode applies the mode inside a 100ms fade timeout — poll the
  // active-tab marker applyAppMode sets rather than sampling immediately.
  await page.waitForFunction(() => {
    const t = document.querySelector('.mode-tab.mode-tab-active');
    return !!t && t.dataset.appMode === 'timer';
  });
}

test('#/timers/timer (Live Activity deep-link alias) lands on Timer mode', async ({ page }) => {
  await gotoApp(page, '#/timers/timer');
  await expectTimerModeActive(page);
});

test('#/timers/countdown (canonical route) still lands on Timer mode', async ({ page }) => {
  await gotoApp(page, '#/timers/countdown');
  await expectTimerModeActive(page);
});

test('running countdown keeps painting after switching modes away and back', async ({ page }) => {
  await gotoApp(page, '#/timers/countdown');
  await expectTimerModeActive(page);
  await page.evaluate(() => {
    Timer.setDuration(5 * 60 * 1000);
    Timer.start();
  });
  // Away to Stopwatch and back — the exact path the on-device tap exposed.
  await page.evaluate(() => window.switchAppMode('stopwatch'));
  await page.waitForTimeout(250);
  await page.evaluate(() => window.switchAppMode('timer'));
  await page.waitForTimeout(250);
  const first = await page.locator('#time').textContent();
  await page.waitForTimeout(400);
  const second = await page.locator('#time').textContent();
  // The display shows centiseconds — any two samples 400ms apart differ
  // whenever the render loop is actually running.
  expect(second).not.toBe(first);
});
