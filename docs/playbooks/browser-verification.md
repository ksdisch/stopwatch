# Playbook: browser verification — running tests and verifying changes against FRESH code

**Scenario:** You changed `js/*.js` / `css/*` / `index.html` and need to (a) run the engine
test suite, or (b) see the change working in the real app. The #1 failure mode in this repo
is verifying against **stale code**: the cache-first service worker (`../../sw.js`) happily
serves the *pre-edit* bundle, your change "doesn't work", and you debug a ghost. This
playbook is the canonical recipe for both jobs.

---

## The three staleness layers

1. **Service worker cache (most common).** `sw.js` is cache-first: once a SW is installed
   for an origin, every request is answered from the `CACHE_NAME` bundle. Editing a file on
   disk changes nothing the browser sees until the SW is bypassed, unregistered, or rotated.
2. **Plain HTTP cache.** `python3 -m http.server` sends no cache-busting headers; a browser
   may revalidate-skip.
3. **Reused automation context.** A Playwright/browser-MCP tab opened *before* your edit can
   pin old responses even with cache disabled via CDP. Verify in a context/tab created
   *after* the edit — never trust a tab that predates the change.

The `?nosw=1` escape hatch (see `../../sw.js` fetch handler) is **referrer-based**: when the
*page URL* carries `?nosw=1`, all of that page's **subresources** (every `js/*.js`, CSS)
bypass the SW on every reload. The navigated document itself is still answered from the SW
cache (`ignoreSearch: true`) once a SW controls the origin — so `?nosw=1` alone is not
enough when `index.html` itself changed.

---

## Recipe A — run the engine test suite

**Preferred: `npm test`** (headless Chromium via `../../scripts/run-tests.mjs`; one-time
setup `npm ci` + `npx playwright install chromium`). It serves port 8765, loads
`tests/index.html?nosw=1` (the test page self-adds the param, so the suite always executes
fresh code), polls `document.title`, prints the transcript, and **auto-retries once** on
FAIL to absorb the known flake.

**Reading the verdict:**

- Title `PASS (n)` → all green; **n = total passing tests** (the canonical test count).
- Title `FAIL (n)` → **n = number of FAILURES** (not total). Failing `it()` lines are in the
  `#results` transcript / stdout.

**Known flake (headless only):** 1–2 sync-engine steady-state tests (the documented
`_steadyRunInFlight` merge-dispatch latch) occasionally fail headless and pass in a visible
tab. `npm test` already retries once. If it still reports FAIL and **every** failure is in
that sync-engine steady-state cluster, adjudicate in a visible browser:

```bash
python3 -m http.server 8765        # from repo root
# browse (Playwright MCP or human) to http://localhost:8765/tests/index.html
# wait for the title to become "PASS (n)" / "FAIL (n)"; read #results for failures
pkill -f "python3 -m http.server 8765"
```

A **visible (foregrounded) tab is the source of truth** — `visibilityState: 'hidden'`
changes app behavior (RAF throttling; sync-engine steady-state arming; see PR #125). Any
failure outside the known cluster, or one that reproduces in a visible tab, is real: report
it, don't rerun until green.

## Recipe B — verify a change in the running app

1. **Serve on a fresh port** (convention: 8770, then 8771, …) so the origin has no
   previously installed SW:

   ```bash
   python3 -m http.server 8770   # from repo root
   ```

2. **Open a fresh browser context/tab** (created after your edit) at
   `http://localhost:8770/index.html?nosw=1`. From then on every reload re-fetches all
   JS/CSS from disk — edit → reload → verify loops are safe for `js/*` and `css/*`.

3. **If `index.html` itself changed mid-session**, or you suspect the SW anyway, nuke it
   from the page console / `browser_evaluate`:

   ```js
   (async () => {
     for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
     for (const k of await caches.keys()) await caches.delete(k);
     location.reload();
   })();
   ```

4. **Always check the console** for errors before declaring success, and screenshot the
   changed surface as evidence. For mobile layouts the house check is a ~390px-wide
   viewport.

5. Kill the server when done: `pkill -f "python3 -m http.server 8770"`.

## Recipe C — verify the deployed site

Stale-after-deploy on https://ksdisch.github.io/stopwatch/ is its own playbook (missed
`CACHE_NAME` bump vs normal SW rotation lag, the `?nosw=1` triage, iOS PWA force-quit):
see [stale-cache.md](stale-cache.md) and the deploy procedure in
[deploy-and-cache-bump.md](../runbooks/deploy-and-cache-bump.md).

---

## See also

- [stale-cache.md](stale-cache.md) — deployed-site staleness triage.
- [`../runbooks/deploy-and-cache-bump.md`](../runbooks/deploy-and-cache-bump.md) — the `CACHE_NAME` discipline.
- `../../scripts/run-tests.mjs` — the headless harness (title regex, retry rationale).
- `CLAUDE.md` § Test commands — the command palette this playbook backs.
