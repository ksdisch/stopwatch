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

// ── Pomodoro + Flow expansion (backlog #4 follow-up) ────────────────────
// The pomodoro/flow Live Activity widgetURLs deep-link to these routes, and
// a "Done ✓" activity tap lands exactly in an OVERFLOWING state — where
// applyAppMode historically re-armed only running/recovery (the same freeze
// the timer spec above regressed; timer got 'overflowing' in #203, these
// two engines got it in the pomo/flow LA branch).

async function expectModeActive(page, mode) {
  await page.waitForFunction((m) => {
    const t = document.querySelector('.mode-tab.mode-tab-active');
    return !!t && t.dataset.appMode === m;
  }, mode);
}

test('#/timers/pomodoro (Live Activity deep-link) lands on Pomodoro mode', async ({ page }) => {
  await gotoApp(page, '#/timers/pomodoro');
  await expectModeActive(page, 'pomodoro');
});

test('#/timers/flow (Live Activity deep-link) lands on Flow mode', async ({ page }) => {
  await gotoApp(page, '#/timers/flow');
  await expectModeActive(page, 'flow');
});

test('overflowing pomodoro keeps painting after switching modes away and back', async ({ page }) => {
  await gotoApp(page, '#/timers/pomodoro');
  await expectModeActive(page, 'pomodoro');
  // Land the engine in 'overflowing' via the finished-while-away restore
  // path (no real 60s wait), mirroring tests/pomodoro.test.js.
  await page.evaluate(() => {
    Pomodoro.loadState({
      status: 'running', phase: 'work', cycleIndex: 0, totalCycles: 4,
      workMs: 60000, shortBreakMs: 60000, longBreakMs: 60000,
      startedAt: Date.now() - 90000, accumulatedMs: 0,
      sessionStartedAt: Date.now() - 90000, phaseStartedAt: Date.now() - 90000,
    });
  });
  await page.evaluate(() => window.switchAppMode('stopwatch'));
  await page.waitForTimeout(250);
  await page.evaluate(() => window.switchAppMode('pomodoro'));
  await page.waitForTimeout(250);
  const first = await page.locator('#time').textContent();
  // Overshoot ticks per second — 1200ms guarantees a boundary crossing.
  await page.waitForTimeout(1200);
  const second = await page.locator('#time').textContent();
  expect(second).not.toBe(first);
});

test('overflowing flow block keeps painting after switching modes away and back', async ({ page }) => {
  await gotoApp(page, '#/timers/flow');
  await expectModeActive(page, 'flow');
  await page.evaluate(() => {
    Flow.loadState({
      status: 'running', phase: 'focus', focusDurationMs: 60000,
      startedAt: Date.now() - 90000, accumulatedMs: 0,
      sessionStartedAt: Date.now() - 90000,
    });
  });
  await page.evaluate(() => window.switchAppMode('stopwatch'));
  await page.waitForTimeout(250);
  await page.evaluate(() => window.switchAppMode('flow'));
  await page.waitForTimeout(250);
  const first = await page.locator('#time').textContent();
  await page.waitForTimeout(1200);
  const second = await page.locator('#time').textContent();
  expect(second).not.toBe(first);
});
