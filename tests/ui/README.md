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
together). `@playwright/test` is pinned to the same version as `playwright` so
the engine suite's browser is unaffected.

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

## Coverage (Slice 1)

- `smoke.spec.js` — real app boots under a blocked SW, no page error.
- `xss-render.spec.js` — attribute-XSS in the med-adherence `aria-label` is
  neutralized (caught + fixed a live bug at `analytics-ui.js:303`).
- `import-survival.spec.js` — malformed JSON, `__proto__` safety, and a
  hostile med name delivered via import renders inert.

## Growth path

Slice 2 = R9 notification-tap (persist pending notifications to IndexedDB +
re-arm on SW wake), which needs a per-spec `serviceWorkers:'allow'` override.
