// scripts/run-tests.mjs — headless engine-test harness.
//
// Tempo's engine tests have NO Node runner. They run by loading
// tests/index.html in a real browser: each suite calls describe()/it()
// (tests/test-runner.js), and the bottom of tests/index.html awaits
// reportResults() (tests/index.html ~line 134), which writes the machine
// signal we read here: document.title becomes "PASS (n)" or "FAIL (n)"
// (tests/test-runner.js:80) and the full transcript lands in #results
// textContent (tests/test-runner.js:74-78).
//
// This harness is the SINGLE SOURCE OF TRUTH for the engine test count.
// It prints the title verbatim so the count can't drift from a hand-
// maintained number in the docs — CI echoes that line into the job
// summary.
//
// Mechanics:
//   1. spawn `python3 -m http.server 8765` over the repo root (the same
//      command the project docs use for local test runs).
//   2. launch headless chromium via playwright.
//   3. navigate DIRECTLY to /tests/index.html?nosw=1 — the ?nosw=1 skips
//      tests/index.html's self-redirect guard (tests/index.html:9-17),
//      which would otherwise location.replace() to re-add the param and
//      cost a round trip.
//   4. poll page.title() until it matches /^(PASS|FAIL) \(\d+\)$/, ~60s cap.
//   5. exit 0 on PASS, exit 1 on FAIL or timeout.
//
// Flake handling: the sync-engine merge-dispatch suite is timing-sensitive
// via the documented `_steadyRunInFlight` latch and very occasionally
// reports a single spurious FAIL that passes on rerun. We re-run the whole
// page ONCE on FAIL before failing the job. A genuine breakage fails twice
// and still red-lights CI; a flake clears on the retry.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const PORT = 8765;
const URL = `http://127.0.0.1:${PORT}/tests/index.html?nosw=1`;
const TITLE_RE = /^(PASS|FAIL) \((\d+)\)$/;
const TITLE_TIMEOUT_MS = 60_000;
const TITLE_POLL_MS = 250;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Start `python3 -m http.server PORT` rooted at the repo and resolve once
// it is accepting connections (poll the test URL's host with fetch).
async function startServer() {
  const proc = spawn('python3', ['-m', 'http.server', String(PORT)], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  });

  proc.on('error', (err) => {
    console.error(`[run-tests] failed to spawn python3 http.server: ${err.message}`);
  });

  // Wait for the port to answer (up to ~10s).
  const probe = `http://127.0.0.1:${PORT}/tests/index.html`;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(probe, { method: 'HEAD' });
      if (res.ok || res.status === 200) return proc;
    } catch {
      // not up yet
    }
    await sleep(150);
  }
  throw new Error(`static server did not come up on port ${PORT} within 10s`);
}

function stopServer(proc) {
  if (!proc || proc.killed) return;
  try {
    proc.kill('SIGTERM');
  } catch {
    // already gone
  }
}

// Load the page once, poll the title until it resolves PASS/FAIL or we
// time out. Returns { status, count, title, results }.
async function runOnce(browser, attemptLabel) {
  const page = await browser.newPage();
  try {
    console.log(`[run-tests] ${attemptLabel}: navigating to ${URL}`);
    await page.goto(URL, { waitUntil: 'load', timeout: TITLE_TIMEOUT_MS });

    const deadline = Date.now() + TITLE_TIMEOUT_MS;
    let title = await page.title();
    while (!TITLE_RE.test(title) && Date.now() < deadline) {
      await sleep(TITLE_POLL_MS);
      title = await page.title();
    }

    const match = TITLE_RE.exec(title);
    const results = await page
      .locator('#results')
      .textContent()
      .catch(() => null);

    if (!match) {
      return { status: 'TIMEOUT', count: null, title, results };
    }
    return { status: match[1], count: Number(match[2]), title, results };
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (err) {
    console.error(
      '[run-tests] playwright not installed. Run `npm ci` then ' +
        '`npx playwright install --with-deps chromium`.'
    );
    console.error(err.message);
    process.exit(1);
    return;
  }

  let server;
  let browser;
  try {
    server = await startServer();
    browser = await chromium.launch();

    // First attempt.
    let result = await runOnce(browser, 'attempt 1');

    // ONE retry on FAIL/TIMEOUT to absorb the documented _steadyRunInFlight
    // flake. A real breakage fails the retry too.
    if (result.status !== 'PASS') {
      console.error(
        `[run-tests] attempt 1 = ${result.title || result.status}; ` +
          'retrying once (documented _steadyRunInFlight flake guard)…'
      );
      result = await runOnce(browser, 'attempt 2 (retry)');
    }

    // Print the transcript and the canonical title line.
    if (result.results) {
      console.log('\n----- #results -----');
      console.log(result.results.trim());
      console.log('--------------------\n');
    }

    if (result.status === 'PASS') {
      console.log(`TEST RESULT: ${result.title}`);
      console.log(`TEST COUNT: ${result.count}`);
      process.exitCode = 0;
    } else if (result.status === 'FAIL') {
      console.error(`TEST RESULT: ${result.title}`);
      console.error(`TEST COUNT (failures): ${result.count}`);
      process.exitCode = 1;
    } else {
      console.error(
        `TEST RESULT: TIMEOUT — title never matched PASS/FAIL within ` +
          `${TITLE_TIMEOUT_MS / 1000}s (last title: ${JSON.stringify(result.title)})`
      );
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`[run-tests] harness error: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    stopServer(server);
  }
}

main();
