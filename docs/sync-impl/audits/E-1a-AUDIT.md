# E-1a · Stage E test-harness SW cache-poisoning fix

**PR:** `feat/sync-stage-e-harness-fix` → `main`
**Stacked on:** `main` after D-2 (PR #64) merges. E-1a branches off freshly-merged `main`.
**Scope:** Test-infrastructure-only. Fix the cache-poisoning bug that surfaced during D-2's engine-tester phase so all downstream Stage E sub-PRs (E-1b → E-1e) and Stage E-2/E-3 test cycles run reliably on the canonical `localhost:8765` port. **No engine code, no merge logic, no F-invariant work, no UI surface.** This is the first of five Stage E sub-PRs (Option B split per the E-1 kickoff).

E-1a does NOT touch any merge logic, any sync engine code, any per-store merge file, F3, F8, F15, F19a future-schema retrofit, or D-1's reconcile flow. Those live in E-1b through E-1e.

---

## Goal

Fix the service-worker cache-poisoning bug surfaced during D-2 by adding a `?nosw=1` referrer-based bypass in `sw.js`'s fetch handler, and adding a one-time URL guard at the top of `tests/index.html` that ensures the test-harness page URL always carries `?nosw=1`. The SW inspects `event.request.referrer` (NOT `event.request.url`) for `?nosw=1` so all script-src requests fired by the test harness inherit the bypass via the `Referer` header without per-script-tag changes. The main app at `/index.html` keeps its cache-first contract intact — the bypass is a pure additive conditional at the top of the fetch handler.

---

## Affected files

| Path | Change type | Notes |
|------|-------------|-------|
| `sw.js` | **modify** | (1) Bump `CACHE_NAME` from `'stopwatch-v73-d2-doseLog-reconcile'` (line 1) to `'stopwatch-v74-e1a-test-harness-fix'`. (2) Add a single conditional at the top of the `fetch` event handler (currently lines 82–90) that inspects **`event.request.referrer`** (NOT `event.request.url`) for the `?nosw=1` bypass. Recommended shape: `if (event.request.referrer) { try { const ref = new URL(event.request.referrer); if (ref.searchParams.has('nosw')) { event.respondWith(fetch(event.request)); return; } } catch (_) { /* malformed referrer — fall through */ } }`. Use `.has('nosw')` (per Q2 resolution — binary bypass; resilient to future tokens like `?nosw=true`). The check must happen BEFORE the existing `caches.match(event.request, { ignoreSearch: true })` call. **Why referrer not URL:** the page-navigation request to `tests/index.html?fresh=verify` would carry `nosw=1` on its own URL, but subsequent `<script src="../js/meds.js">` requests do NOT inherit query params. Inspecting the **referrer** (the URL of the page that initiated the request) means every script-src request fired from a `?nosw=1` page automatically bypasses the cache via the `Referer` header — no per-script-tag suffix changes needed in `tests/index.html`. Same-origin requests on `localhost:8765` preserve the `Referer` header by default under modern browsers' default referrer policy (`strict-origin-when-cross-origin`); same-origin gets full URL with query string. Comment the new branch with `// E-1a: ?nosw=1 referrer-based bypass — when the request was initiated by a page whose URL carries ?nosw=1 (e.g., tests/index.html?nosw=1), skip the SW cache and pull straight from network. Main app at /index.html is unaffected because its referrer never carries the param.`. (3) Existing `ignoreSearch: true` cache-match behavior at line 88 is preserved unchanged for the main-app branch — the `?v=N` cache-bust convention on tempo-shell.css / tempo-nav.js script tags continues to work. |
| `tests/index.html` | **modify** | Add a tiny `<script>` block at the very top of `<head>` (BEFORE the engine-module script tags at lines 24–50) that ensures the current page URL carries `?nosw=1`. Recommended shape: a 4-line guard that checks `new URL(window.location.href).searchParams.has('nosw')` and, if absent, calls `window.location.replace(...)` with `nosw=1` appended (preserving any existing query like `fresh=verify`). The guard runs once on first load; subsequent reloads always carry the param, which then propagates via the `Referer` header to every `<script src="../js/*.js">` request. **No script-tag suffix changes** — the referrer-based SW bypass handles all script-src requests transparently. Why a guard rather than just documenting "append `?nosw=1`": testers reload by reflex via Cmd+R / Cmd+Shift+R; if the param was lost from a prior bookmark or copy-paste, the harness silently regresses to cached code without any warning. The guard makes the protection sticky. The replace is a one-time redirect — subsequent loads short-circuit. **Critically: the guard does NOT cause an extra round-trip if the URL already carries `nosw=1`** (the common case once the user lands once). **Q3 resolution: silent guard — no console warning when `?nosw=1` is missing on first load.** The URL change in the address bar is the indicator; console noise on every test load was rejected. Existing comment block at lines 23, 32–34, 36–37, 41–44 stays unchanged. The new guard is the only addition. |

**Total: 2 files** (1 SW, 1 test harness). **No `js/*.js` changes. No engine modules touched. No `tests/*.test.js` touched. No `index.html` (main app) touched. No CSS, no `js/*-ui.js`, no `js/tempo-nav.js`. No `package.json`, no `ios/*`, no `manifest.json`, no `capacitor.config.json`. No new files. No `js/app.js` changes — the SW registration call site at lines 99–100 stays unchanged (the bypass lives in the SW's fetch handler, NOT in the registration call). No script-tag suffix changes in `tests/index.html` — the referrer-based bypass handles script-src requests transparently.**

---

## Sync invariants touched

**None of F1–F21.** E-1a is test infrastructure — it does not touch any synced store, any record envelope, any merge logic, any persistence path, any clock-skew clamp, or any device-id stamp. The strategy-doc per-store table is unaffected.

The only repo invariant E-1a observes is the **Service worker cache-bump rule** from `CLAUDE.md` ("Any PR that ships a change to a cached web file (`index.html`, `css/styles.css`, `css/tempo-shell.css`, `manifest.json`, or any `js/*.js`) must bump that version string in the same PR"). E-1a's `sw.js` change itself triggers this rule independently — even though no `js/*.js` cached file changes in E-1a, modifying `sw.js` itself requires a `CACHE_NAME` bump so the new fetch-handler logic ships to existing PWA installs (the SW only updates after `CACHE_NAME` differs from the active version). Bump target documented in the affected-files table: `'stopwatch-v74-e1a-test-harness-fix'`.

`tests/index.html` is NOT in the SW's `ASSETS` list (verify lines 2–62 of `sw.js` — the list contains `./index.html` but not `./tests/index.html`). The cache-poisoning bug is NOT that the test harness is pre-cached; it's that the SW's fetch handler intercepts ALL requests on the origin and runs `caches.match` — and `caches.match` returns the pre-cached `js/meds.js` (which IS in `ASSETS`) when the test harness's `<script src="../js/meds.js">` resolves, serving the stale pre-edit copy. The referrer-based bypass short-circuits this entire path for any request whose initiating page URL carries `?nosw=1`.

---

## Risks

| Risk | Likelihood | Blast radius | Mitigation |
|------|------------|--------------|------------|
| **Main-app cache-first regression — `/index.html` loses offline support** | low | **web-bytes (HIGH if it triggers)** | The bypass conditional is purely additive — if the request's referrer is absent OR the referrer URL does not carry `?nosw=1`, the existing `caches.match(event.request, { ignoreSearch: true })` runs unchanged. The main app's `/index.html` and all assets in `ASSETS` (lines 2–62 of `sw.js`) keep their cache-first behavior because their referrer is `http://localhost:8765/index.html` (no `nosw` param). **Mitigation:** Manual verification step (in Test scope below) explicitly loads `/index.html` offline after the fix lands and confirms PWA installability + service worker registration + offline asset serving still work. The bypass branch is one conditional at the TOP of the fetch handler — if referrer-check fails, control falls through to the existing logic byte-identically. Code review: ensure the new branch uses `event.respondWith(fetch(event.request))` followed by `return` so the existing `caches.match` is NOT also called for bypassed requests. |
| **`CACHE_NAME` bump not landing — existing PWA installs serve stale `sw.js`** | low | web-bytes | If the implementer forgets to bump `CACHE_NAME` (or pr-shipper skips the bump because no `js/*.js` in the affected-files table), existing PWA installs would keep running the old `sw.js` (without the bypass) until the SW expires naturally — defeating E-1a's purpose for any developer with an existing PWA install. **Mitigation:** Affected-files table explicitly lists the `CACHE_NAME` bump target string. Sign-off checklist includes a dedicated bump-verification item. The orchestrator's pr-shipper bump rule fires on `sw.js` changes (the file IS itself a cached web file by virtue of being the SW); if the rule is misinterpreted as "bump only if `ASSETS`-listed files change," document the override in the PR description. |
| **Engine-implementer scope-expansion documentation gap** | med | low (process/workflow) | E-1a's affected-files table includes `tests/index.html` and `sw.js` — both outside the default allowed set in `.claude/agents/engine-implementer.md` (which forbids `tests/*` and `sw.js`). Per the precedent set by S0-1 (one-off scope expansion via dispatch brief override; documented in `CLAUDE.md` "Known gaps / workflow TODOs"), the orchestrator's Phase 2 dispatch brief must explicitly carry the override clause: *"If the dispatch brief's `Files in scope` list AND the audit's affected-files table both explicitly enumerate a path outside the default allowed set, treat the brief as authoritative for this PR."* If the orchestrator omits the override, engine-implementer will refuse to edit `sw.js` and the PR stalls. **Mitigation:** This audit explicitly flags the scope expansion in the "Manual setup steps" section + sign-off checklist below. Orchestrator's Phase 2 dispatch must reiterate the expansion verbatim (precedent: S0-1's audit + dispatch). |
| **Cross-browser SW + Referer behavior differences — Firefox / Safari / Chrome** | low | low | All evergreen browsers implement the SW spec for `event.request.referrer` consistently and preserve full Referer (URL with query string) for **same-origin** requests under the default referrer policy (`strict-origin-when-cross-origin`). Edge cases: (a) Safari iOS strips query strings on certain navigation types — but the bypass runs in the SW context on script-src requests, not page navigations, so the Referer received by the SW for `<script src="../js/meds.js">` requests includes the full page URL with `?nosw=1`; (b) some older browsers cache SW updates aggressively — but `CACHE_NAME` bump + `self.skipWaiting()` + `self.clients.claim()` (already present at lines 68 + 79) force the new SW to activate on next load; (c) if a future test harness sets `<meta name="referrer" content="no-referrer">` or uses `crossorigin` script tags with strict CORS, the Referer would be stripped and the bypass would fail silently — but neither pattern exists today and adding either would be visible in code review. **Mitigation:** Manual verification procedure runs in Chrome DevTools (default per project convention); a follow-up smoke in Safari + Firefox is a "nice-to-have" but not a blocker. The deliberate-broken-test reload regression check (steps 5–6) catches a Referer-stripping regression immediately because the deliberately-broken test would pass against stale cached code. |
| **Test-harness regression silently masks SW-bypass failure** | low | test-correctness | If the bypass conditional in `sw.js` is wrong (e.g., uses `event.request.url` instead of `event.request.referrer`, or fails to handle the `URL` constructor throw on a malformed referrer), or if the `tests/index.html` guard fails to fire (e.g., a syntax error), the harness would silently revert to cached code AND tests would still appear to pass against the stale code. **Mitigation:** The "deliberate-broken-test reload" verification step (step 5–6 of Manual verification in Test scope below) is the canonical regression check — if the cache fix is broken, the deliberately-broken test passes anyway because the SW served stale pre-edit code. This procedure must run on every Stage E sub-PR's engine-tester phase post-E-1a. Documented in SESSION-LOG by pr-shipper for traceability. |
| **Future test-asset additions not protected by the bypass — MITIGATED-VIA-PICK-B** | low (was low) | low (forward-compat) | **Original concern (Pick A — script-tag suffix approach):** The `?nosw=1` bypass was per-request; if a future test surface added a sub-page (e.g., `tests/perf.html`) that loaded `<script src="../js/foo.js">`, those `foo.js` requests would skip the cache only if every script tag carried `?nosw=1` AND every new tag was correctly suffixed. Default `<script src="../js/foo.js">` does NOT inherit query params from the parent URL. **MITIGATED by Pick B (referrer-based bypass):** With the SW inspecting `event.request.referrer` instead of `event.request.url`, every request fired from a page whose URL carries `?nosw=1` automatically bypasses the cache regardless of the script tag's own URL. Future test-asset additions Just Work — as long as the parent test page goes through the URL guard at the top of `tests/index.html` (or has its own equivalent guard), all script-src and asset requests inherit the bypass via the `Referer` header. The `tests/index.html` guard is the single load-bearing convention; no per-script-tag maintenance burden. **Residual risk:** if a future test page is added without a `?nosw=1` URL guard, its asset requests would NOT bypass the cache. Documented as a sign-off item: any new `tests/*.html` page must include the same URL guard. |
| **Boundary case: tester loads `/index.html` then `/tests/index.html` in same browser tab — MITIGATED-VIA-PICK-B** | low (was low) | low (test-correctness) | **Original concern (Pick A — script-tag suffix approach):** If the user navigated from `/index.html` (which registered the SW) to `/tests/index.html?fresh=verify` in the same tab, the page-navigation request got bypassed correctly via URL inspection. But the subsequent `<script src="../js/meds.js">` requests were intercepted by the SW with no `?nosw=1` on the script-src URL itself. **MITIGATED by Pick B (referrer-based bypass):** The script-src requests carry `referrer: http://localhost:8765/tests/index.html?nosw=1` (after the URL guard fires); the SW inspects the referrer's `searchParams.has('nosw')` and bypasses the cache. The boundary case is fully handled — same-tab navigation, fresh-tab navigation, and bookmark loads all behave identically because the bypass is referrer-driven, not URL-driven. **Residual:** if the user manually strips `?nosw=1` from the address bar AND reloads, the URL guard re-injects it on the next load (via `window.location.replace`), so script-src requests on the second load (post-redirect) carry the correct referrer. |

**Risk count: 7** — low: 6, med: 1, high: 0. **Risks #6 and #7 are MITIGATED by the Q1 resolution (Pick B — referrer-based bypass) but retained in the table for historical traceability.** Their effective likelihood is reduced because the script-src URL inheritance gap that motivated them is eliminated by inspecting `event.request.referrer` instead of `event.request.url`. The HIGHEST single-event impact is Risk #1 (main-app regression), mitigated by the bypass being purely additive. The MOST PROCESS-LEVEL is Risk #3 (engine-implementer scope expansion documentation) — must be repeated in Phase 2's dispatch brief. With Pick B locked in, the MOST CORRECTNESS-CRITICAL remaining risk is Risk #4 (cross-browser Referer handling) — gated by the deliberate-broken-test reload check.

---

## Test scope

**New tests required: zero automated tests.**

E-1a's fix IS the test infrastructure — adding a `tests/sw-bypass.test.js` would be circular (the SW being broken is precisely what we're fixing; if the SW serves stale code, the bypass test passes against stale assertions). Engine-tester runs the existing 396-case baseline (D-2 final count) and confirms no regressions; the harness fix is verified manually per the procedure below.

**Test count target after E-1a: still 396.** No automated test additions or removals.

### Manual verification procedure (Phase 3 engine-tester runs this)

This is the canonical regression check — verbatim from `E-1a-PROMPT.md` lines 134–162. It must run on every Stage E sub-PR's engine-tester phase post-E-1a so future cache-poisoning regressions surface immediately.

1. **Start a fresh browser profile.** Chrome incognito works (clears service workers + caches on close). For paranoia, also clear DevTools → Application → Storage → "Clear site data" before step 2.
2. **Start the local server:** `python3 -m http.server 8765 &` from repo root.
3. **Load the main app** at `http://localhost:8765/index.html`. The PWA registers its SW. Verify in **DevTools → Application → Service Workers** that the SW is "activated and running" with `CACHE_NAME` matching the new value (`'stopwatch-v74-e1a-test-harness-fix'`). If the old `CACHE_NAME` shows, the bump didn't land — STOP and investigate.
4. **Load the test harness** at `http://localhost:8765/tests/index.html?fresh=verify`. Confirm the test runner page loads, tests execute, and the URL bar shows BOTH `fresh=verify` AND `nosw=1` (the `tests/index.html` guard injects the latter on first load). **Verify in DevTools → Network tab** that script-src requests for `../js/meds.js` (etc.) show `Referer: http://localhost:8765/tests/index.html?nosw=1` (or `?fresh=verify&nosw=1`) in the request headers — this confirms the Referer is being preserved and the SW will see `?nosw=1` via referrer inspection. Capture the baseline pass count: **expected 396** (D-2 baseline).
5. **The actual cache-poisoning regression test:** in your editor, add a deliberately-broken assertion to ANY existing test (e.g., change an `assertEqual` value in `tests/meds.test.js` to a value that will fail). Save.
6. **Hard-reload** `http://localhost:8765/tests/index.html?fresh=verify` (Cmd+Shift+R / Ctrl+Shift+R). Confirm the deliberately-broken test FAILS in the runner output. If it passes, the SW served the stale pre-edit version — the harness fix is broken (likely Referer is being stripped or the SW's referrer inspection has a bug). STOP and investigate.
7. **Revert the deliberate-break edit.** Reload (regular reload — Cmd+R / Ctrl+R is fine). Confirm tests pass again at the 396 baseline.
8. **Main-app offline regression check** (verifies Risk #1 mitigation): in DevTools → Network tab, switch to "Offline." Reload `http://localhost:8765/index.html`. The PWA should still load fully (cache-first behavior preserved — referrer for `/index.html` is empty or carries no `nosw=1`, so cache hits). Switch back to "Online" when done.
9. **Cleanup:** `pkill -f "python3 -m http.server 8765"`.

Document the manual procedure in `docs/SESSION-LOG.md` so future engine-testers have a regression check. The deliberate-broken-test reload (steps 5–6) is the load-bearing assertion — without it, a buggy bypass would let downstream tests appear green against stale code.

### Existing tests at risk

**None.** E-1a touches no `tests/*.test.js` files. The full 396-case D-2 baseline (358 C-1 + 23 D-1 + ~13 D-2 + harness reconciliation) should pass byte-identically. If any test count drift is observed post-E-1a, investigate immediately — the count drift would itself be a signal that the SW is serving inconsistent assets across reloads.

---

## Manual setup steps (if any)

E-1a requires explicit **engine-implementer scope expansion**. This is the second one-off expansion (precedent: S0-1's Firebase-config setup). The orchestrator's Phase 2 dispatch must carry the override clause verbatim:

> **Engine-implementer scope expansion authorized for E-1a.** Per `CLAUDE.md` "Known gaps / workflow TODOs": *"If the dispatch brief's `Files in scope` list AND the audit's affected-files table both explicitly enumerate a path outside the default allowed set, treat the brief as authoritative for this PR."* For E-1a, `tests/index.html` and `sw.js` are explicitly in scope despite being outside the engine-implementer agent's default allowed set. No other files outside the default scope are authorized. Document the expansion in the PR description for traceability.

No other manual setup is required:

- **No Firebase console action** (no new collections, no rule changes).
- **No Capacitor / iOS rebuild** (no `Platform.*` surface touched; SW is web-only per `js/app.js:99` Platform.isNative guard).
- **No new localStorage keys or IDB stores.**
- **No new persistence flags or migration logic.**
- **No service worker pre-deployment action beyond the `CACHE_NAME` bump** (pr-shipper handles in the same PR per repo cache-bump rule).

---

## Out of scope (explicitly NOT in this PR)

E-1a is the FIRST of five Stage E sub-PRs (Option B split). The following are explicitly deferred:

- **All merge logic.** No changes to `js/sync-engine.js`, `js/sync-firestore.js`, `js/sync-merge-meds.js` (doesn't exist yet — E-1c creates it), `js/sync-merge-history.js` (doesn't exist — E-1d), `js/sync-merge-rest-log.js` (doesn't exist — E-1e), `js/sync-merge-presets.js` (doesn't exist — E-1e), `js/schema.js`, `js/meds.js`, `js/history.js`. These live in E-1b through E-1e.
- **`SyncEngine.startSteadyState()` scaffold.** E-1b ships this + the per-store merge dispatcher + `sync-firestore.js` `runTransaction` CAS wrapper.
- **`runTransaction` CAS wrapper.** E-1b.
- **D-1 reconcile flow retrofit** (wiring D-2's `MedsManager.reconcileDoseLog` into D-1's reconcile path). E-1c.
- **F3 BFRB stream consolidation.** E-1d. (Decision between unified `bfrb_events` stream vs three legacy keys.)
- **F8 distraction sessionId-keyed migration.** E-1d. (Decision between tombstones vs sessionId-keyed maps for `flow_distractions` / `pomodoro_distractions`.)
- **F15 ≥2-entry remote-arrival toast.** E-1c (call-site) + B-4 (UI subscriber). D-2 wired the `onMergeComplete` event emit; E-1c counts arrivals + fires the toast.
- **F19a refuse-writeback gate.** D-2 already shipped the gate inside `reconcileDoseLog`; E-1b/c wires the broader merge-loop equivalent for non-meds stores.
- **`js/app.js` SW registration changes.** The SW registration call at `js/app.js:99` stays unchanged. The bypass lives in the SW's fetch handler, not in the registration. (Verified by reading `js/app.js:90–101`.)
- **`tests/index.html` script-load harness refactor.** D-1 surfaced a `typeof History === 'undefined'` fall-through pattern in ~22 sync tests. E-1d's history-merge work owns the refactor. E-1a does NOT touch script load order or the History stub pattern.
- **Phase 4 ui-wirer SKIPPED.** E-1a's affected-files table lists ZERO UI files (`js/*-ui.js`, `index.html`, `css/*.css`, `js/tempo-nav.js`). Per the orchestrator-prompt autonomous transition rule: Phase 3 → Phase 5 if the audit lists no UI files. E-1a ships zero user-visible bytes (the test harness is internal infrastructure).
- **E-2 offline buffer + E-3 onSnapshot listeners.** Stage E's remaining work after E-1 ships completely.
- **F19c manifest registry.** Deferred per PLAN.md §F-1 "DEFERRED" status.

---

## Open questions for the user (REQUIRES KYLE'S CALL BEFORE PHASE 2 FIRES)

**Q1 (RESOLVED 2026-05-13 — Pick B): The SW fetch handler inspects `event.request.referrer` (NOT `event.request.url`) for `?nosw=1`. The `tests/index.html` change reduces to ONLY the URL guard — no script-tag suffix changes.** Per Kyle's call, the most elegant referrer-based bypass is the chosen approach. The `tests/index.html` URL guard ensures the page URL carries `?nosw=1`, which then propagates via the `Referer` header to all subsequent script-src requests; the SW inspects that referrer and bypasses the cache for any request initiated from a `?nosw=1` page. Zero per-script-tag suffix maintenance burden.

— Original analysis (preserved for traceability) —

**Q1 — Option (a) `?nosw=1` script-src URL inheritance gap (Risk #6).** The `?nosw=1` bypass works cleanly for the page-navigation request to `tests/index.html?fresh=verify` but does NOT automatically propagate to the `<script src="../js/meds.js">` requests fired by the test harness. Each script-src request is a separate `fetch` event with its own URL — and that URL does NOT carry `?nosw=1` by default. The SW's `caches.match` for `js/meds.js` then returns the pre-cached stale copy, which is precisely the bug E-1a is trying to fix.

**Three paths forward:**

1. **(a-extended) Append `?nosw=1` to every script tag in `tests/index.html`.** Mechanical — change `<script src="../js/meds.js">` to `<script src="../js/meds.js?nosw=1">` for all 19 engine-module + test-suite script tags (lines 24–72 of `tests/index.html`). The SW fetch handler sees `nosw=1` on every asset request and bypasses the cache. Pros: works correctly, single bypass mechanism. Cons: every future test-asset addition needs the param appended.

2. **(b) Pivot to path-based bypass — `/tests/*` exempt in SW fetch handler.** Inspect `new URL(event.request.url).pathname.startsWith('/tests/')` (or `/stopwatch/tests/` for GitHub Pages — verify the deployed origin's path prefix) and skip cache for any matching request. Pros: zero changes to `tests/index.html`; transparent to testers; future test-asset additions Just Work. Cons: SW logic change is slightly larger; "what counts as a test asset?" needs a clear rule. **However:** the script tags in `tests/index.html` use relative paths like `../js/meds.js` — those resolve to `/js/meds.js`, NOT `/tests/js/meds.js`. So path-based bypass on `/tests/*` would NOT cover script-src requests for engine modules either. Same gap as option (a). **The only way path-based bypass fully works is if all test-loaded assets live under `/tests/`** — which means option (b) reduces to option (c) in practice.

3. **(c) Path-relocation — move `tests/` to a path the SW doesn't cache OR move all engine modules to live alongside the test harness.** Most invasive. Largest blast radius (CLAUDE.md script-load-order references, orchestrator-prompt mentions, every doc that mentions `tests/index.html` would need updating). Probably overkill for the single bug E-1a fixes.

**Auditor's recommendation: option (a-extended)** — the mechanical script-tag-suffix change. Pros: smallest blast radius (still just `tests/index.html` + `sw.js`); the bypass mechanism is uniform (one SW conditional, one harness convention); no path renaming; no SW path-prefix rule to reason about. Cons: every future test-asset addition needs `?nosw=1` appended — but the test harness is a small, stable surface (one file, ~20 script tags) and the convention is easy to document in CLAUDE.md "Test commands" section.

**Alternative to consider:** option (b) **with the script-src bypass via `event.request.referrer`** — the SW fetch handler inspects `event.request.referrer` (the URL of the page that initiated the request) and, if the referrer carries `?nosw=1`, skips cache for the asset request. This is the most elegant fix because:
- The page-navigation request to `tests/index.html?fresh=verify` already triggers the bypass via `event.request.url` inspection.
- Subsequent script-src requests for `../js/meds.js` carry `referrer: http://localhost:8765/tests/index.html?nosw=1` — the SW inspects `new URL(event.request.referrer).searchParams.has('nosw')` and bypasses cache.
- Zero changes to `tests/index.html` script tags. The guard at the top of `tests/index.html` still ensures the page URL carries `?nosw=1`, which then propagates via `Referer` to all script-src requests.
- **Caveat:** browsers MAY strip the `Referer` header for cross-origin requests or under strict referrer policies. For same-origin requests on `localhost:8765`, the Referer is preserved by default. Verify in Chrome DevTools.

**Kyle, please pick before Phase 2 fires:**
- **Pick A (recommended):** Option (a-extended) — mechanical script-tag suffix on all `<script src="../js/*.js">` tags in `tests/index.html`. Smallest blast radius, fully deterministic.
- **Pick B (most elegant):** Option (b)-via-referrer — SW inspects `event.request.referrer` for `?nosw=1`, no script-tag changes. Slightly larger SW change; depends on Referer header preservation.
- **Pick C (override):** Some other approach — please specify.

The audit currently documents **Pick A's affected-files table** (the safest assumption). If Kyle picks B, the implementer changes `sw.js`'s conditional to inspect `event.request.referrer` instead of `event.request.url`, and the `tests/index.html` change reduces to just the `?nosw=1` URL guard (no script-tag suffixes needed).

---

**Q2 (RESOLVED 2026-05-13 — `.has('nosw')`): The SW fetch handler uses `searchParams.has('nosw')` for the bypass check.** Binary bypass; resilient to future tokens (`?nosw`, `?nosw=1`, `?nosw=true` all match). Strict-equality alternative was rejected.

— Original analysis (preserved for traceability) —

**Q2 — `?nosw=1` token format.** The audit recommends `searchParams.has('nosw')` (any value matches: `?nosw`, `?nosw=1`, `?nosw=true`, `?nosw=disable-the-cache`). Alternative: strict `?nosw=1` match for forward-compat (if a future bypass adds `nosw=verbose` or `nosw=replay`, strict match avoids false positives). Auditor's preference: `.has('nosw')` for resilience; the bypass is binary (cache or no-cache), no partial states needed.

---

**Q3 (RESOLVED 2026-05-13 — Silent guard): The `tests/index.html` URL guard does NOT log a console warning when `?nosw=1` is missing on first load.** The URL change in the address bar (after the guard's `window.location.replace`) is the indicator. Console noise on every test load was rejected.

— Original analysis (preserved for traceability) —

**Q3 — Should the `tests/index.html` URL guard log a console warning if `?nosw=1` is missing?** Pros: makes the harness fix discoverable to developers reading DevTools. Cons: console noise on every test load. Auditor's preference: silent guard; the user-visible URL change is the indicator.

---

**All three questions resolved by Kyle 2026-05-13. Phase 2 (engine-implementer) authorized to proceed with Pick B + `.has('nosw')` + silent guard.**

---

## Sign-off checklist (for the implementer)

- [ ] Engine module changes match the affected-files table — `sw.js` modify + `tests/index.html` modify. **No `js/*.js` files touched.** No new files. **No script-tag suffix changes in `tests/index.html`** (Pick B handles script-src requests via the referrer, not via per-tag suffixes).
- [ ] Test scope above is covered — zero automated test additions; manual verification procedure documented in SESSION-LOG.
- [ ] No re-implementation of `escapeHtml` / `Utils.formatMs` / `Platform.*`. (N/A — E-1a doesn't touch any helper surface.)
- [ ] `sw.js` `CACHE_NAME` bumped — from `'stopwatch-v73-d2-doseLog-reconcile'` to `'stopwatch-v74-e1a-test-harness-fix'` (or equivalent E-1a-tagged string per implementer's preference).
- [ ] All writes to synced stores stamp `deviceId` + `updatedAt` + `schemaVersion` via `js/schema.js`. (N/A — E-1a touches no synced stores.)
- [ ] **SW main-app cache-first behavior preserved.** Manual offline test of `/index.html` (step 8 of Manual verification) passes — PWA still installs, SW still registers, offline asset serving still works for the main app.
- [ ] **Engine-implementer scope expansion documented in PR description.** Cite the override clause from `CLAUDE.md` "Known gaps / workflow TODOs" and the precedent (S0-1's audit + dispatch).
- [ ] **Deliberate-broken-test reload regression check passes** — steps 5–6 of Manual verification confirm the bypass fix actually fetches fresh code, not just the page URL.
- [ ] **`sw.js` fetch handler inspects `event.request.referrer` (NOT `event.request.url`) for `searchParams.has('nosw')` and short-circuits to `fetch(event.request)` before the existing `caches.match` call.** Pick B (referrer-based bypass) is the chosen approach per Kyle's Q1 resolution 2026-05-13. The implementer must wrap the URL parse in a try/catch (malformed referrer must fall through to the existing cache logic, not throw inside the SW).
- [ ] **`tests/index.html` URL guard injects `?nosw=1` if absent and is silent (no console.warn).** Q3 resolution: the URL change in the address bar is the indicator.
- [ ] **No changes to `js/app.js`.** SW registration call at lines 99–100 stays untouched. (Verified by reading the file in audit phase; documented in affected-files table.)
- [ ] **No changes to `js/sync-engine.js`, `js/sync-firestore.js`, `js/schema.js`, `js/meds.js`, `js/history.js`** — those are E-1b/c/d/e scope. If the implementer finds themselves editing any, STOP — that's out of scope.
- [ ] **PR title:** `fix(tests): tests/index.html SW cache-poisoning fix (E-1a)` per `E-1a-PROMPT.md` line 246.
- [ ] **Branch name:** `feat/sync-stage-e-harness-fix` per `E-1a-PROMPT.md` line 237.
- [ ] **Phase 4 ui-wirer skipped.** Affected-files table contains zero UI files; orchestrator's autonomous transition rule routes Phase 3 → Phase 5.
