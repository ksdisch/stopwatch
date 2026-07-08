# Tempo Proving Ground (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a CI-gated `@playwright/test` UI/integration suite that loads the real `index.html` under a blocked service worker, fix the live attribute-XSS bug it catches in the med-adherence render, and lock the (already-hardened) import boundary against regression.

**Architecture:** New `tests/ui/` suite driven by `@playwright/test`. `serviceWorkers:'block'` (browser-context level) neutralizes `sw.js` with zero production change; a fresh Playwright context per test gives free `localStorage`/IndexedDB isolation. Specs exercise the real app globals (`MedsManager`, `Analytics`, `Export`, `renderMedAdherence`, `renderAnalytics`) and assert on the real DOM. A 7th CI job (`ui-tests`) gates every PR.

**Tech Stack:** `@playwright/test` (reuses the Chromium already installed), `python3 -m http.server` on port 8766 (mirrors `scripts/run-tests.mjs`), vanilla JS app under test.

**Design spec:** `docs/superpowers/specs/2026-07-07-tempo-proving-ground-design.md`

---

## Reality deltas found during planning (READ FIRST)

The design spec's §5 hypotheses were verified against HEAD. Two updates:

1. **`escapeHtml` already escapes quotes** (`js/dom-utils.js:12-17` — all five of `& < > " '`, per "audit M7"). So the XSS fix is a plain `escapeHtml(m.name)` wrap; no helper change needed.
2. **The import boundary is already hardened**, not unguarded. `Export.importAllData` (`js/export.js:245-322`) validates `version`, filters session shapes before the destructive `clearAll()`, wraps each record in try/catch, and only writes allowlisted string settings; the caller `js/history-ui.js:49-64` wraps the whole thing in try/catch and `alert`s on failure. So the import spec (Task 3) is a **regression-lock + XSS-delivery cross-check**, not a bug hunt — it is expected to pass green on first run (after Task 2's fix). This is a deliberate, surfaced deviation from the spec's "catch a live bug" framing for that spec; the XSS spec (Task 2) is where the real bug is.

Net: **one real bug fix (Task 2)** + **the harness + a security-boundary regression lock (Tasks 1, 3, 4)**.

---

## File structure

| File | Responsibility |
|------|----------------|
| `playwright.config.js` (create) | Runner config: testDir, `serviceWorkers:'block'`, baseURL, `webServer` (python http.server :8766), CI retries. |
| `package.json` (modify) | Add `@playwright/test` devDep + `"test:ui": "playwright test"`. |
| `tests/ui/support/app.js` (create) | Shared helpers (`gotoApp`, `seedMed`) + attack payloads. Thin; grows with coverage. |
| `tests/ui/smoke.spec.js` (create) | Proves the harness boots the real app under a blocked SW with no page error. |
| `tests/ui/xss-render.spec.js` (create) | Attribute-XSS in the med-adherence aria-label; catches + locks the fix. |
| `tests/ui/import-survival.spec.js` (create) | Malformed-import survival + `__proto__` safety + XSS-delivery cross-check. |
| `tests/ui/README.md` (create) | How to run, add a spec, and why the SW is blocked. |
| `js/analytics-ui.js:303` (modify) | The XSS fix: wrap `m.name` in `escapeHtml`. |
| `sw.js:1` (modify) | CACHE_NAME bump v156 → v157 (same commit as the analytics-ui fix). |
| `.github/workflows/ci.yml` (modify) | Add the `ui-tests` job. |
| `CLAUDE.md`, `docs/BACKLOG.md`, `docs/SESSION-LOG.md` (modify) | DoD doc touch-points. |

---

## Task 1: Harness skeleton + smoke spec

**Files:**
- Create: `playwright.config.js`, `tests/ui/support/app.js`, `tests/ui/smoke.spec.js`
- Modify: `package.json`

- [ ] **Step 1: Install `@playwright/test`**

```bash
npm install --save-dev @playwright/test@^1.49.0
npx playwright install chromium
```

- [ ] **Step 2: Add the `test:ui` script to `package.json`**

In the `"scripts"` block (after the existing `"test"` line), add:

```json
    "test:ui": "playwright test",
```

- [ ] **Step 3: Create `playwright.config.js`** (CommonJS — the repo has no `"type":"module"`, so `require`/`module.exports` is unambiguous)

```js
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
```

- [ ] **Step 4: Create `tests/ui/support/app.js`**

```js
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
```

- [ ] **Step 5: Create `tests/ui/smoke.spec.js`**

```js
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
```

- [ ] **Step 6: Run the smoke spec**

Run: `npm run test:ui -- smoke.spec.js`
Expected: `1 passed`. (If it fails on `#app` not attached, the webServer/baseURL is wrong; if `controller` is truthy, `serviceWorkers:'block'` isn't taking effect.)

- [ ] **Step 7: Commit**

```bash
git add playwright.config.js package.json package-lock.json tests/ui/support/app.js tests/ui/smoke.spec.js
git commit -m "$(cat <<'EOF'
feat(proving-ground): @playwright/test harness skeleton + boot smoke spec

Slice 1 of the Tempo Proving Ground. Loads the real index.html in headless
Chromium with serviceWorkers:'block' (zero production change) and a fresh
context per test. Port 8766 so it runs beside the engine suite (8765).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Attribute-XSS spec + fix (the real bug)

**Files:**
- Create: `tests/ui/xss-render.spec.js`
- Modify: `js/analytics-ui.js:303`, `sw.js:1`

- [ ] **Step 1: Write the failing spec**

Create `tests/ui/xss-render.spec.js`:

```js
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
```

- [ ] **Step 2: Run to verify it FAILS for the right reason**

Run: `npm run test:ui -- xss-render.spec.js`
Expected: the first test FAILS — `window.__xssFired` is `true` (the injected `<img onerror>` executed) and the `img` locator has count 1. This proves the live bug at `analytics-ui.js:303`.

- [ ] **Step 3: Fix the sink in `js/analytics-ui.js`**

At line 303, wrap the med name in `escapeHtml` (matching the already-escaped visible name at line 298):

```js
        <div class="adherence-dots" role="img"
             aria-label="${escapeHtml(m.name)} adherence last 30 days">${dots}</div>
```

- [ ] **Step 4: Bump the service-worker cache (same commit as the fix)**

In `sw.js:1`, change:

```js
const CACHE_NAME = 'stopwatch-v156-bfrb-legacy-cleanup';
```
to:
```js
const CACHE_NAME = 'stopwatch-v157-analytics-aria-escape';
```

> If `main` has advanced past v156 by execution time, use the current version + 1 with this slug.

- [ ] **Step 5: Run to verify it PASSES**

Run: `npm run test:ui -- xss-render.spec.js`
Expected: `2 passed`. `__xssFired` stays falsy, zero injected `img`, and the aria-label now contains the literal payload as inert text.

- [ ] **Step 6: Commit**

```bash
git add tests/ui/xss-render.spec.js js/analytics-ui.js sw.js
git commit -m "$(cat <<'EOF'
fix(analytics): escape med name in adherence aria-label (attribute-XSS)

The med-adherence render interpolated a user-controlled med name into
aria-label unescaped (analytics-ui.js:303) while escaping the visible name one
line up (:298). A med named with a quote-breakout payload injected a live
attribute / <img onerror>. Wrap the name in escapeHtml (already quote-safe per
dom-utils M7). Locked by tests/ui/xss-render.spec.js. Cache bump v157.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Import-survival spec (regression-lock + XSS-delivery cross-check)

**Files:**
- Create: `tests/ui/import-survival.spec.js`

- [ ] **Step 1: Write the spec** (expected to pass green — see "Reality deltas")

Create `tests/ui/import-survival.spec.js`:

```js
// tests/ui/import-survival.spec.js — the import boundary is ALREADY hardened
// (export.js:245-322 validates version/shape; history-ui.js:62 catches). These
// specs LOCK that safety against regression AND prove the Task-2 XSS fix holds
// against the import DELIVERY vector (a hostile med name smuggled in a backup).
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
```

- [ ] **Step 2: Run to verify it PASSES**

Run: `npm run test:ui -- import-survival.spec.js`
Expected: `3 passed`. (Characterization: the import boundary + the Task-2 fix already make these safe. If the cross-check test fails, Task 2's fix regressed — re-check `analytics-ui.js:303`.)

- [ ] **Step 3: Run the whole suite**

Run: `npm run test:ui`
Expected: `6 passed` (1 smoke + 2 xss + 3 import).

- [ ] **Step 4: Commit**

```bash
git add tests/ui/import-survival.spec.js
git commit -m "$(cat <<'EOF'
test(proving-ground): lock the import boundary + XSS-delivery cross-check

Regression-locks the already-hardened Export.importAllData: malformed JSON is
caught, a __proto__ key doesn't pollute Object.prototype, and a hostile med
name smuggled via a backup renders inert (defense-in-depth against the Task-2
sink via the import delivery vector).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: CI job + docs + README

**Files:**
- Modify: `.github/workflows/ci.yml`, `CLAUDE.md`, `docs/BACKLOG.md`, `docs/SESSION-LOG.md`
- Create: `tests/ui/README.md`

- [ ] **Step 1: Add the `ui-tests` job to `.github/workflows/ci.yml`**

After the `engine-tests` job (before `asset-integrity`), add:

```yaml
  # UI/integration regression suite — the Tempo Proving Ground. Loads the real
  # index.html in headless Chromium with the service worker blocked and asserts
  # the render/import seams the engine suite structurally can't reach. Mirrors
  # engine-tests (installs Chromium; runs a node-driven headless suite).
  ui-tests:
    name: ui-tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install deps
        run: npm ci

      - name: Install Playwright chromium
        run: npx playwright install --with-deps chromium

      - name: Run UI/integration tests (Tempo Proving Ground)
        run: npm run test:ui
```

- [ ] **Step 2: Create `tests/ui/README.md`**

```markdown
# Tempo Proving Ground — UI/integration tests

`@playwright/test` specs that load the **real `index.html`** in headless
Chromium and assert on the render/import seams the engine suite (`tests/`)
cannot reach.

## Run

```bash
npm run test:ui                       # whole suite
npm run test:ui -- xss-render.spec.js # one file
npx playwright test --ui              # interactive (local debugging)
```

The `webServer` in `playwright.config.js` starts `python3 -m http.server 8766`
automatically (mirrors the engine runner; distinct port so both suites run
together).

## Why the service worker is blocked

`use.serviceWorkers: 'block'` neutralizes `sw.js` at the browser-context layer,
so no stale cache can serve old assets and no production change is needed
(`app.js`'s `register().catch()` swallows the block). A fresh context per test
gives empty `localStorage`/IndexedDB — decisive for a state-heavy PWA.

## Add a spec

1. Create `tests/ui/<name>.spec.js`; `require('@playwright/test')` +
   `require('./support/app')`.
2. `await gotoApp(page, '#/route')` to boot the app, then drive it via engine
   globals (`MedsManager`, `Export`, `Analytics`, …) and assert on the DOM.
3. Wire `page.on('pageerror', …)` and assert zero errors — it doubles as a boot
   smoke check.

## Growth path

Slice 2 = R9 notification-tap (persist pending notifications to IndexedDB +
re-arm on SW wake), which needs a per-spec `serviceWorkers:'allow'` override.
```

- [ ] **Step 3: Update `CLAUDE.md` — flip the tech-debt entry**

Replace the "No UI/integration tests" bullet under **## Remaining Tech Debt** with:

```markdown
- **UI/integration tests — Tempo Proving Ground (Slice 1 shipped):** `@playwright/test`
  specs in `tests/ui/` load the real `index.html` under a blocked service worker (`npm run
  test:ui`; CI job `ui-tests`). Slice 1 covers attribute-XSS render + malformed-import
  survival. Slice 2 (R9 notification-tap) pending. Engine suite unaffected.
```

And under **### Test commands**, after the `npm test` block, add a line:

```markdown
npm run test:ui               # UI/integration suite (@playwright/test, headless; loads real index.html, SW blocked)
```

- [ ] **Step 4: Update `docs/BACKLOG.md` — the Proving Ground row**

Update the "Tempo Proving Ground" row (grep `Tempo Proving Ground`) to note **Slice 1 shipped 2026-07-07 (harness + attribute-XSS fix + import regression-lock); Slice 2 = R9 notification-tap pending.**

- [ ] **Step 5: Add a `docs/SESSION-LOG.md` entry**

Add a dated entry summarizing: brainstormed + specced the Proving Ground; shipped Slice 1 (harness, XSS fix at `analytics-ui.js:303`, import regression-lock); R9 deferred to Slice 2.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml tests/ui/README.md CLAUDE.md docs/BACKLOG.md docs/SESSION-LOG.md
git commit -m "$(cat <<'EOF'
ci(proving-ground): add ui-tests job + docs for Slice 1

7th CI job runs npm run test:ui on every PR. Flips the "No UI/integration
tests" debt entry, documents test:ui in CLAUDE.md, updates the backlog row, and
adds tests/ui/README.md + a session-log entry.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Push + open PR (Kyle-gated merge)

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feat/proving-ground-slice1
gh pr create --base main --title "feat(proving-ground): Slice 1 — UI/integration harness + attribute-XSS fix" --body "<summary: harness, XSS fix, import lock, ui-tests CI job; links the spec + plan>"
```

- [ ] **Step 2: Verify CI is green** (poll `check-runs` on the pushed SHA; `ui-tests`, `engine-tests`, `sw-cache-bump`, `asset-integrity` all pass). **Do NOT merge — merging `main` is Kyle-gated (per-PR go-ahead).**

---

## Self-review checklist (run before execution)

- **Spec coverage:** §2 goal → Tasks 1-4; §4 architecture → Task 1 config/support; §5.1 XSS → Task 2; §5.2 import → Task 3; §6 robustness → `pageerror` canaries + retries in config; §7 CI → Task 4 Step 1; §10 DoD → Tasks 1-5; §9 growth → README. ✅ (import reframed per "Reality deltas" — surfaced, not silent.)
- **Placeholder scan:** every code step shows complete code; the only free-text is Task 4 Steps 4-5 (doc-table/session-log wording, which is prose by nature) and the PR body. No TBD/TODO. ✅
- **Type/name consistency:** `gotoApp`/`seedMed`/`XSS_IMG_ONERROR`/`XSS_ATTR_BREAKOUT` defined in `support/app.js` (Task 1) and used identically in Tasks 2-3; `renderMedAdherence`/`Analytics.getMedAdherence`/`MedsManager.add`/`.loadAll`/`.saveAll`/`med.logDose` match the verified source. ✅

## Watch-points for the implementer

- `renderMedAdherence(adh)` needs `adh.meds[].dots` (built by `getMedAdherence`); always call the real `Analytics.getMedAdherence(30)` to build the input — do **not** hand-construct `adh` (it would bypass the real pipeline).
- If the smoke spec's `#app` wait flakes, confirm the `webServer` came up on 8766 (`reuseExistingServer` is false in CI).
- Only `js/analytics-ui.js` (Task 2) is a cached web file → it is the only commit that bumps `CACHE_NAME`. Test files, config, CI yaml, and docs are not cached — no bump.
