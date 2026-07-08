# Tempo Proving Ground — UI/Integration Test Harness (Slice 1)

**Status:** Design approved 2026-07-07 · awaiting spec review before the implementation plan
**Origin:** 2026-07-07 full-project bug hunt, Phase 4 ("the big lever")
**Related:**
- `docs/bug-hunt/2026-07-07-full-project.md` — Phase 4 plan + the XSS/import/notification seam
- `CLAUDE.md` § Remaining Tech Debt — *"No UI/integration tests"* (this closes it)
- `docs/BACKLOG.md` — "Tempo Proving Ground — UI test harness + kit" row

---

## 1. Problem

Tempo has ~1,238 engine `it()` across ~55 `tests/*.test.js`, and **zero** UI/integration
tests. The engine harness (`tests/index.html`) loads bare modules into a `<pre id="results">`
page — there is **no real app DOM**, so it structurally cannot reach the render, import, or
service-worker seams. The 2026-07-07 hunt's own top-severity bug class lives exactly there:
attribute-XSS in render paths, malformed-import handling, and notification delivery. The hunt
named the "Tempo Proving Ground" as *the single biggest quality lever available*.

## 2. Goal & success criteria

A **CI-gated regression suite** that loads the **real `index.html`** in headless Chromium and
gates every PR to `main`, alongside the existing `engine-tests` job.

**Slice 1 (this milestone)** ships the harness plus two specs that exercise existing code:
1. **attribute-XSS render** survival, and
2. **malformed-import** survival.

Each spec either passes as a characterization lock or catches a live bug we then fix. Done =
`npm run test:ui` green locally and in CI, both specs committed, docs updated, PR opened.

**Explicitly deferred to Slice 2:** the R9 "notification tap" target. It requires a production
change first (persist pending notifications to IndexedDB + re-arm on SW wake) before there is
any durable behavior to assert; bundling it would couple brand-new test infrastructure with a
notification behavior change that has web/native divergence. Slice 2 builds R9 *on* the proven
harness.

## 3. Decisions (settled during brainstorming)

| # | Decision | Why |
|---|----------|-----|
| D1 | **CI-gated regression suite**, not an MCP agent-kit | The goal is a durable gate that runs unattended on every PR. The Playwright **MCP** is agent-driven/in-session and cannot gate CI — it can't be the artifact even though the hunt's prose said "MCP". |
| D2 | **`@playwright/test`** for the UI layer; the engine suite keeps its custom 80-line runner | UI tests need auto-waiting locators (kills timing flake), per-test context isolation, tracing, and retries. Hand-rolling those in the custom runner is exactly what makes naive UI tests flaky. The repo already depends on the `playwright` library and installs Chromium in CI, so this is a small, in-grain addition to the *test* infra (the "no build step" rule governs the shipped app, not the test tooling). |
| D3 | **Thin vertical slice**: harness + XSS + import now; R9 as Slice 2 | Prove the harness end-to-end fast (real app boots under a blocked SW → isolation → 2 real assertions → green CI job) before growing. Keeps new test infra decoupled from R9's production notification change. |
| D4 | **Playwright `serviceWorkers: 'block'`** + load real `index.html`; **zero production change** | `app.js:135-136` always registers `sw.js` on web with a fire-and-forget `.catch(()=>{})`. Blocking the SW at the browser-context layer turns that registration into a swallowed no-op — no stale cache, no app edit. Sync flag is off by default (`sync-flag.js`), so boot does no Firebase init; external hosts are route-blocked for full hermeticity. |

## 4. Architecture

### 4.1 File footprint

```
playwright.config.js               NEW   repo root
tests/ui/support/app.js            NEW   thin helpers + shared attack payloads
tests/ui/xss-render.spec.js        NEW   Slice-1 target 1
tests/ui/import-survival.spec.js   NEW   Slice-1 target 2
tests/ui/README.md                 NEW   run / add-a-spec / SW-block rationale
.github/workflows/ci.yml           EDIT  + `ui-tests` job
package.json                       EDIT  + devDep @playwright/test; + "test:ui": "playwright test"
```

### 4.2 `playwright.config.js`

- `testDir: './tests/ui'`
- `use: { baseURL: 'http://127.0.0.1:8766', serviceWorkers: 'block', trace: 'on-first-retry' }`
- `webServer: { command: 'python3 -m http.server 8766', url: 'http://127.0.0.1:8766/index.html', reuseExistingServer: !process.env.CI }`
- `fullyParallel: true`, `retries: process.env.CI ? 1 : 0`
- **Port 8766** (not the engine suite's 8765) so `npm test` and `npm run test:ui` can run as
  concurrent CI jobs without contending for the socket. Serving via `python3 -m http.server`
  deliberately mirrors `scripts/run-tests.mjs` — the same serving model the repo already trusts.

### 4.3 How a spec touches the app (two levers)

Because the app is all globals (no ES modules), specs can drive it from both ends:
- **Setup via engine globals** — `page.evaluate(() => MedsManager.createMed({...}))`,
  `page.evaluate(json => Export.importAllData(json), payload)`. This *is* the integration seam:
  engine state → UI render.
- **Assert via the real DOM** — locators, attribute reads, and an injected-execution canary
  (`window.__xssFired`).

### 4.4 Isolation & hermeticity

- `serviceWorkers: 'block'` + a **fresh Playwright context per test** ⇒ no stale SW and empty
  `localStorage`/IndexedDB on every test — free, and decisive for a state-heavy PWA.
- `context.route()` blocks external hosts (Firebase CDN, Todoist, YouTube). Sync-off already
  prevents Firebase init; the route block is belt-and-suspenders.

### 4.5 Compatibility with existing guards

- `check-asset-integrity` / `check-load-order` / `check-sw-bump` inspect `sw.js` ASSETS,
  `index.html` `<script>` tags, and the load-order chain. The harness touches none of those, so
  scaffolding-only commits trip no guard.
- **`sw.js` CACHE_NAME:** harness-only commits need **no** bump (nothing cached changes). A
  caught-bug *fix* edits a cached file (`analytics-ui.js` for XSS, `export.js` for import) and
  **that** commit bumps CACHE_NAME — next value **v157**.
- The new CI job is additive/parallel; the engine suite, its runner, and its canonical count are
  untouched.

## 5. The two specs (Slice 1)

### 5.1 `xss-render.spec.js` — attribute-XSS

**Target sink:** `analytics-ui.js:303/289` interpolate a **med name** (user-controlled) into
`aria-label="${m.name} …"` / `title="${label}"` with no `escapeHtml` (contrast `cards-ui.js:46`,
which escapes).

**Flow:** fresh context → add a med whose name is a hostile payload:
- attribute-breakout: `" onmouseover="window.__xssFired=true`
- element-injection: `"><img src=x onerror="window.__xssFired=true">`

→ navigate to the Analytics med-adherence view → assert (note which check is *decisive* for
which payload — a canary that structurally cannot fire is not a pass):
- `window.__xssFired` stays falsy — **decisive for the `onerror` image payload**, which
  auto-fires on injection with no user interaction;
- the `aria-label` holds the literal name as inert text and no extra attribute broke out —
  **decisive for the `onmouseover` payload** (headless Chromium fires no mouseover, so the
  structural attribute-integrity check is the real signal here);
- no injected `<img>` exists in the container.

**If it fails:** fix = attribute-safe escaping of `m.name`. Verify `dom-utils.escapeHtml`
escapes quotes (`"`/`'`) — it **must**, or `aria-label` breakout survives escaping. Fix commit
bumps CACHE_NAME.

### 5.2 `import-survival.spec.js` — malformed import

**Target:** `Export.importAllData(jsonString)` (`export.js:245-246`) does an **unguarded
`JSON.parse`** at the entry. Each payload runs in a fresh context and asserts *survive + no
corruption*:

| Payload | Assertion |
|---------|-----------|
| Malformed JSON (`'{ not json'`) | Clean handled failure; page still interactive (no unhandled throw that bricks the caller). |
| Prototype pollution (`'{"__proto__":{"polluted":true}}'`) | `({}).polluted` is `undefined` after import. |
| Wrong-typed fields (`{"meds":"x","history":42}`) | Existing state still readable; no crash. |
| XSS-in-string smuggled via backup, then rendered | Inert — defense-in-depth cross-check with §5.1. |

**If a payload breaks something:** fix = guard the import boundary (try/catch + `__proto__`
rejection / shape validation) and lock it with the test.

## 6. Harness robustness (its own anti-flake)

- A shared fixture wires `page.on('pageerror')` + console-error capture → **any uncaught app
  error fails the test**. This canary quietly upgrades every UI spec into a boot smoke test.
- Auto-waiting locators + `expect.poll` (no `sleep`); `retries: CI?1:0` mirrors the engine
  runner's one-retry flake absorption; `trace:'on-first-retry'` yields a full DOM+network trace
  artifact on any CI failure.

## 7. CI wiring

New `ui-tests` job in `.github/workflows/ci.yml`, mirroring `engine-tests`:
`actions/checkout` → `setup-node@20` → `npm ci` → `npx playwright install --with-deps chromium`
→ `npm run test:ui`. Additive and parallel to the other six jobs.

## 8. Non-goals (out of scope for Slice 1)

- **No R9 fix** (Slice 2).
- **No MCP verification kit** (rejected as the primary artifact in D1; a reusable MCP recipe may
  be documented later, not built here).
- **No engine-suite changes** — the custom runner and its canonical count stay as-is.
- **No app-shell duplication** — we load the real `index.html`, never a forked harness page.

## 9. Growth path (documented, not built now)

- **Slice 2 = R9:** persist pending notifications to IndexedDB + re-arm/fire-overdue on SW wake;
  verify with `notification-tap.spec.js` using a per-spec `serviceWorkers:'allow'` override
  (documented in the README). Web-only; native iOS schedules at the OS level and is unaffected.
- **Beyond:** one spec per high-risk render seam; `support/app.js` helpers accrete as coverage
  grows.

## 10. Definition of Done

1. `tests/ui/` scaffolding + `playwright.config.js` + `ui-tests` CI job; `npm run test:ui` green
   locally **and** in CI.
2. Both specs committed — each passes as characterization or catches a live bug we then fix (fix
   commit bumps CACHE_NAME **v157** and names the cached file).
3. Docs: flip CLAUDE.md's *"No UI/integration tests"* debt entry → describe the harness +
   `test:ui`; add a § Test commands line; update the Proving Ground row in `docs/BACKLOG.md`;
   add a `docs/SESSION-LOG.md` entry.
4. `tests/ui/README.md` written (run + add-a-spec + SW-block rationale).
5. Feature branch + PR per house convention; **merge is Kyle-gated** (per-PR go-ahead).

> The DoD "4-file wiring" rule (script tag + CLAUDE.md map + `sw.js` ASSETS + test stub) is for a
> new `js/` **engine module** — Slice 1 adds no production module, so it does not apply to the
> harness. Only a caught-bug fix touches cached `js/` files, needing just the CACHE_NAME bump.

## 11. Open items to pin at implementation

- Exact Analytics route/trigger that renders the med-adherence `aria-label` (sink line known;
  user path to render it pinned when writing Spec 1).
- Verify `dom-utils.escapeHtml` escapes quotes (attribute-safety precondition for the §5.1 fix).
- Confirm the `importAllData` caller's guard behavior (`history-ui.js` reloads after import) to
  frame "survive" precisely for §5.2.
