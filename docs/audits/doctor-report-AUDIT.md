# doctor-report · Doctor-ready portable summary — 30-day meds + sleep + activity export

## Goal
Add a new `DoctorReport` engine that reads History, meds, and rest_log locally and
produces a paste-friendly plain-text summary, then exposes three generic text-delivery
helpers on `Export` (copy / share / download), and wires a single UI trigger with a
scrollable report panel (Copy / Share / Download actions).

## Blast radius
**Tier:** high

**Justification:** The PR lands in one shot: a new engine module (`js/doctor-report.js`),
modifications to an existing cached module (`js/export.js`), a new UI surface touching
`js/history-ui.js` and `index.html`, `sw.js` CACHE_NAME bump, and a new test file
registered in `tests/index.html` — multi-layer (engine + UI + tests + new module) in a
single PR, which is the definition of **high** under the blast-radius rubric regardless
of any individual layer's simplicity.

## Affected files
| Path | Change type | Notes |
|------|-------------|-------|
| `js/doctor-report.js` | add | New IIFE singleton `DoctorReport`. `buildReport({days,now})` → `Promise<string>`. Pure helpers on `_internals` for clock-pinned tests. Zero DOM, zero writes to any store. |
| `js/export.js` | modify | Add three generic text helpers: `copyText(text)`, `shareText(title, text)`, `downloadText(filename, text)`. Mirror existing clipboard / share / blob-download patterns. No changes to existing function signatures or export/import data shapes. |
| `js/history-ui.js` | modify | Wire the doctor-report trigger — add button to the History panel's `.history-actions` row; wire `DoctorReport.buildReport()` + panel/modal open; wire Copy / Share / Download action buttons to new Export helpers; Toast confirmation on copy. |
| `index.html` | modify | (1) `<script src="js/doctor-report.js" defer>` tag in load-order position (see Load-order slot below). (2) New report panel markup (scrollable, dismissible, action buttons). (3) New `<button id="history-doctor-report">` in `.history-actions`. |
| `sw.js` | modify | Bump `CACHE_NAME` from `'stopwatch-v167-live-activities-pomo-flow'` to `'stopwatch-v168-doctor-report'`. Add `'./js/doctor-report.js'` to `ASSETS`. |
| `tests/doctor-report.test.js` | add | New engine test file: stub `History.getSessions` / `MedsManager.all` / `Analytics.getMedAdherence` / `wellness_rest_log`; fixed `now`. Cover window filtering, meds section (scheduled + as-needed), sleep averages, focus aggregation, all-empty report, malformed-row resilience. |
| `tests/index.html` | modify | Add `<script src="../js/doctor-report.js"></script>` to the engine-modules block and `<script src="doctor-report.test.js"></script>` to the test-suites block. |

**Affected file count: 7**

## Load-order slot

`js/doctor-report.js` must load **after `analytics.js` and `export.js`** (it calls
`Analytics.getMedAdherence` and is exported via `Export` helpers), and **before its UI
consumer `js/history-ui.js`**.

Current `index.html` order around that zone:

```
... js/export.js (line 1274) ...
... js/history-ui.js (line 1307) ...
... js/analytics.js (line 1309) ...
```

`analytics.js` currently loads **after** `history-ui.js` in `index.html`. The new
module needs both. Two valid resolutions:

1. Insert `js/doctor-report.js` after `analytics.js` (line 1309) AND move or relocate
   the `history-ui.js` wiring of the doctor-report trigger so it initializes lazily on
   first panel open (the button element exists in the DOM but the handler fires after
   all deferred scripts have run — this is the lower-diff option and matches how other
   panels initialize at DOMContentLoaded / app.js wiring).
2. Move `js/analytics.js` to before `js/history-ui.js` and insert `js/doctor-report.js`
   between `analytics.js` and `history-ui.js`.

**Recommendation: option 1** — insert `<script src="js/doctor-report.js" defer>` immediately
after `<script src="js/analytics.js" defer>` (currently line 1309), and initialize the
doctor-report button handler inside a DOMContentLoaded or app-init hook that fires after
all deferred scripts load. This is consistent with the rest of the app's handler-wiring
pattern and avoids moving existing script tags.

The `CLAUDE.md` Script Load Order chain must be updated to insert `doctor-report`
between `analytics` and `analytics-ui` (or between `analytics` and `history-ui`,
whichever resolution is chosen). The `sw.js` ASSETS list and the `tests/index.html`
engine-modules block must change in lockstep. The pre-commit guard (`scripts/check-load-order.mjs` +
`scripts/check-asset-integrity.mjs`) enforces this and will block the commit if any of the
three are out of sync.

## UI placement recommendation

**Recommended: the History panel's `.history-actions` row (`js/history-ui.js` anchor).**

Rationale: the History panel is already the app's data-export surface (Backup / Restore /
Clear All buttons live there), and `history-ui.js` already imports and calls `Export`
functions — adding one more `Export`-backed button here is the smallest coherent blast (one
file for the handler, one new button in the existing action row, one new modal/panel in
`index.html`) while remaining discoverable to a user explicitly in "data review" mode
before a doctor appointment. The ui-wirer would touch `js/history-ui.js` + `index.html`
only. The Wellness hub alternative would require touching `js/meds-ui.js` or
`js/wellness-cooking-ui.js` or `js/recovery-ui.js` (none of which currently have export
seams), adding a higher-diff surface for the same button.

## Cross-cutting invariants touched
- **`sw.js` CACHE_NAME** — `js/doctor-report.js`, `js/export.js`, `js/history-ui.js`,
  and `index.html` are all cached web assets; the cache bump is mandatory and is the
  primary blast-radius driver.
- **Script Load Order** — `CLAUDE.md` chain + `sw.js` ASSETS + `index.html` `<script>`
  tags must stay in lockstep; the pre-commit guard enforces this.
- **`Export` public API surface** — three new exported methods (`copyText`, `shareText`,
  `downloadText`) are additive; no existing function signatures change. Callers of the
  existing `copyToClipboard` / `share` / `downloadCSV` functions are unaffected.
- **No sync-store invariants** — `DoctorReport` is strictly read-only; it touches no
  synced store, no `js/schema.js`, no sync-engine or merge modules.

## Risks
| Risk | Likelihood | Blast radius | Mitigation |
|------|------------|--------------|------------|
| `analytics.js` loads AFTER `history-ui.js` in the current `index.html` order; `doctor-report.js` depends on both — naive insertion between them would produce a load-order violation where `DoctorReport.buildReport` calls `Analytics.getMedAdherence` before `Analytics` is defined. | high | local-only | The handler must be wired lazily (DOMContentLoaded / first-open init) so all deferred scripts have already executed before the engine is called. This is the standard pattern for the rest of the app. The pre-commit guard checks `<script>` order against CLAUDE.md but not runtime call-time ordering — implementer must verify manually by opening the panel. |
| `getMedAdherence` returns `{ meds: [] }` when `MedsManager` is undefined; `DoctorReport` must handle this gracefully and render "No medications logged." rather than throwing. | med | local-only | Brief's defensive conventions (malformed rows skipped, missing stores render an empty-state line) already require this. Engine tests must include the all-empty fixture to cover it. |
| `wellness_rest_log` is a raw `localStorage.getItem` key (not a module API); `DoctorReport` must parse JSON and handle `null` + malformed date keys. | med | local-only | Expose the raw-parse path via `_internals.parseRestLog(raw)` so tests can inject fixture strings without touching `localStorage`. |
| New `Export.shareText` calls `navigator.share` — this API is unavailable in some desktop browsers and in the headless test harness; missing guard causes an uncaught TypeError. | med | local-only | Mirror the existing `share()` guard: check `canShare()` (which tests `!!navigator.share`) and fall back to `copyText`. Brief already specifies this fallback. |
| `downloadText` creates a temporary `<a>` element and calls `.click()` — in the headless test harness this is a no-op but may log a navigation warning. | low | local-only | Test suite does not test the download path (no meaningful assertion possible on blob-URL clicks in headless); the engine test only covers `buildReport`'s string output, not the delivery helpers. |
| Report string may expose health-sensitive data (med names, dose logs) if accidentally sent to an unintended destination via `shareText`. | low | local-only | This is by design — the report is explicitly user-initiated for doctor-visit use. The footer disclaimer ("descriptive only, no medical interpretation") is the only required mitigation. No additional privacy gate needed. |
| Cache bump forgotten — new `js/doctor-report.js` added to `index.html` but not to `sw.js` ASSETS, or CACHE_NAME not bumped. Existing PWA installs (web + iOS WKWebView) serve stale code; new module 404s on first load after SW update. | med | web-bytes | Pre-commit guard (`check-sw-bump.mjs` + `check-asset-integrity.mjs`) blocks the commit if CACHE_NAME is not bumped or if ASSETS diverges from the `<script>` set. pr-shipper checklist also enforces this. |

## Test scope
- **New tests required:** `tests/doctor-report.test.js` — covering window filtering
  (sessions/doses/sleep outside the 30-day window excluded), meds section (scheduled med
  with adherence %, as-needed med with count only), sleep averages (avg hours, avg quality,
  nap count + total nap time, bedtime/wake range), focus aggregation (flow + pomodoro total
  ms, session count, mindful tag count, interval count, cooking excluded), all-empty report
  (every store empty → all "No X logged" lines present, no throw), and malformed-row
  resilience (null/missing fields skipped). Top-level `const` names must be file-unique
  (shared test-scope collision risk, flagged in CLAUDE.md memory). Fixed `now` for all
  date-windowing assertions.
- **Existing tests at risk:**
  - `tests/export.test.js` — the three new `Export` helpers are additive; existing tests
    remain green. The test file should add cases for `copyText`, `shareText`, `downloadText`
    but this is in scope for the engine-tester to decide.
  - `tests/analytics.test.js` — no change to `getMedAdherence`; existing cases unaffected.
  - Load-order change to `tests/index.html` (adding `js/doctor-report.js` to the
    engine-modules block) must preserve the existing script sequence for all other modules.

## Manual setup steps (if any)
1. After the full PR ships, run `npm run sync-www` to mirror updated web assets into `www/`
   for Capacitor (no rebuild required — iOS loads the live GitHub Pages payload at runtime,
   but keeping `www/` current avoids a stale bundle on next `ios:open`).
2. Open the app on a fresh port (e.g. 8770) to bypass a stale SW. Open the History panel
   (`clock` icon or `H` shortcut). Confirm the "Doctor report" button appears in the
   `.history-actions` row alongside Backup / Restore / Clear All.
3. With at least one med, one sleep log entry, and one focus session in the last 30 days,
   tap "Doctor report". Confirm the report panel opens with Header / Medications / Sleep /
   Activity / Footer sections, and that the data matches the stored values.
4. Test Copy: tap Copy button, paste into a text editor, confirm plain-text output is clean.
5. Test Share (mobile / Safari): tap Share, confirm the native share sheet opens. On
   desktop Chrome where `navigator.share` is absent, confirm Share falls back to clipboard.
6. Test Download: tap Download, confirm a `.txt` file downloads with the expected filename
   (`tempo-health-report-YYYY-MM-DD.txt` or similar).
7. Test empty state: clear all sessions and meds, generate report, confirm all sections
   render "No X logged in this window." without throwing.

## Out of scope (explicitly NOT in this PR)
- **Synced-store writes** — `DoctorReport` is read-only; no Firestore, no `js/schema.js`
  stamp, no sync-engine or merge-module edits.
- **New persisted keys** — no `data-dictionary.md` change; no new localStorage or IDB key.
- **Native code** — no `js/platform.js` extension, no `ios/*` change, no Capacitor plugin.
- **PDF export** — plain text only; no third-party PDF library.
- **Server-side / council integration** — the report is purely client-local; it does not
  write to Firestore or feed the council synthesizer.
- **Recurring / scheduled report generation** — no background job, no notification trigger.
- **Wellness hub placement** — the UI trigger lives on the History panel surface, not the
  Wellness hub; the Wellness hub route (`#/wellness`) and its sub-pages are untouched.
- **Interval / Cooking session details in the report** — the Activity section shows
  exercise/interval session count only; cooking sessions are explicitly excluded per brief.
- **Data-dictionary update** — no new keys means no update needed.
- **CLAUDE.md backlog row** — tracking this new capability in the Feature Backlog is a
  docs-only follow-up, not part of this code PR.

## Sign-off checklist (for the implementer)
- [ ] Engine module changes match the affected-files table
- [ ] Test scope above is covered (`tests/doctor-report.test.js` green in `npm test`)
- [ ] No re-implementation of `escapeHtml` (js/dom-utils.js) / `Utils.formatMs` (js/utils.js) / `Platform.*` (js/platform.js) / `Analytics.getMedAdherence` (js/analytics.js)
- [ ] `sw.js` `CACHE_NAME` bumped from `v167` to `v168-doctor-report` in the same commit as all cached web file changes; `js/doctor-report.js` added to `ASSETS` list
- [ ] `index.html` `<script>` tag for `doctor-report.js` inserted after `analytics.js`, before `analytics-ui.js` (or after `analytics.js` with lazy init pattern — see Load-order slot); CLAUDE.md Script Load Order chain updated to match
- [ ] `tests/index.html` engine-modules block and test-suites block updated for `doctor-report.js` / `doctor-report.test.js`
- [ ] `DoctorReport.buildReport` handler wired lazily (post-DOMContentLoaded or first-open init) to avoid calling `Analytics.getMedAdherence` before `analytics.js` has executed
- [ ] Report panel is dismissible; all action buttons meet ≥44px tap target (mobile-sweep norm)
- [ ] `Export.shareText` falls back to `copyText` when `canShare()` is false; no uncaught TypeError on desktop Chrome
- [ ] All-empty report renders placeholder lines for every section without throwing
- [ ] No synced-store writes; no `js/schema.js` touch; no sync-engine/merge-module edits; no new persisted keys; no native code changes
