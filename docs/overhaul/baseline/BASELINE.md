# Overhaul — Phase 0 Baseline & Behavior Inventory

> Captured 2026-06-06 on `feat/overhaul` (off `main` @ `f2ca225`). This is the **before** reference
> for the full-app UI/UX/perf/correctness overhaul. Live verification via Playwright (Docker MCP →
> `host.docker.internal:8770`, served with `python3 -m http.server 8770`, `?nosw=1` to bypass the SW).

## Gate baseline (the safety net)

| Check | Command | Result on clean main |
|-------|---------|----------------------|
| Engine tests (headless) | `npm test` | **RED by design** — 1–3 failures, ALL in the sync-engine steady-state merge-cycle family (`_runMergeCycleForStore invokes correct per-store merge fn`, `flips SyncState to "ready"`, `Network online resume … catch-up _runMergeCycle`). Headless timer-throttling flake. |
| Engine tests (foreground) | open `tests/index.html` in a real tab | **PASS (933)** — true-green reference |
| Asset integrity | `node scripts/check-asset-integrity.mjs` | OK — 80 `<script>` == 80 sw.js ASSETS |
| SW cache-bump | `node scripts/check-sw-bump.mjs` | OK — no cached file changed |
| `CACHE_NAME` | `sw.js:1` | `stopwatch-v113-bfrb-risk-support` |

**Regression rule for this overhaul:** the *only* permitted test failures are that named sync-engine
merge-cycle family. A failure of **any other** test = a regression I introduced, even if total count ≤ 3.
(This is stricter and more sensitive than a bare "≤ 2 failures" count gate.)

### Ground-truth corrections vs the mission brief
- HEAD is `f2ca225` (PR #132 — the orchestrator-prompt doc), not `855f550`.
- `css/styles.css` is **6090 lines** (not ~3300) and there is a **second** stylesheet
  `css/tempo-shell.css` (1533 lines). Shared-file write-ownership planning must cover **both**.
- `index.html` is 1234 lines, **80** `<script>` tags (matches sw.js ASSETS).

## Information architecture (verified live from `tempo-nav.js` routing)

Four pillars. Desktop = left sidebar; mobile (≤ ~viewport) = bottom tab bar (responsive shift confirmed).

| Pillar (route) | Sub-nav | Notes |
|----------------|---------|-------|
| **Timers** `#/timers` | Stopwatch, Timer, Pomodoro, Flow, Interval, Cook | default landing = `#/timers` → Stopwatch |
| **Wellness** `#/wellness` | Meds, Exercise, Mindful, Cooking, Recovery | default → `#/wellness/meds` |
| **Rhythm** `#/rhythm` | Timeline, Insights | Insights = 9 panels |
| **Analytics** `#/analytics` | (single) | |
| Cross-cutting | Global BFRB FAB (bottom-right), settings drawer (gear), history (icon), 6 themes | FAB persists on every screen |

Themes (`Themes.getPresets()`): `auto, midnight, ocean, sunset, minimal, oled` (6). `Themes.apply(id)`,
persisted to `localStorage.theme`. `<body data-pillar="…">` drives per-pillar accenting.

## Confirmed-WORKING behaviors (must NOT regress)

- **State restore / wall-clock auto-correct WORKS.** Started stopwatch (~00:15), full page reload →
  resumed at `02:44` with laps intact. The drift-free model is live-correct.
- **Engine runs clean** — only console errors are `favicon.ico` 404 (no favicon declared). No runtime
  errors on Start/Lap/route-change.
- **Hero digits are tabular** — main time display: `font-variant-numeric: tabular-nums`,
  `ui-monospace` stack, weight 250. (Secondary displays — lap rows, Avg/Best/Worst — NOT yet verified
  tabular; flagged for visual lens.)
- **Empty states are thoughtful** — Meds ("No medications yet"), all 9 Insights panels have descriptive
  empty copy, Recovery "Last 7 days" empty state, etc.
- **Pomodoro is information-rich** — cycle bar (W1│SB│W2│…│LB), "2h10m total", "Est. end: 11:28 AM".

## Per-screen observations (seed findings — audit will deepen)

Screenshots captured live (viewport-relative; inline-reviewed):
`baseline-01` Stopwatch idle desktop-light · `baseline-02` Stopwatch running+laps desktop-light ·
`baseline-03` Pomodoro mobile-light · `baseline-04` Wellness/Meds mobile-light ·
`baseline-05` Rhythm/Insights mobile-light · `baseline-06` Insights mobile-midnight ·
`baseline-07` Stopwatch mobile-midnight.

- **Stopwatch (desktop):** narrow centered column squishes two rows so text collides —
  `Lap 3` + time renders as `Lap 300:01.11`; summary renders as `Avg 00:07.04Best 00:06.29Worst …`
  (no separators/space-between). **Mobile is fine** (proper space-between) → desktop-width layout bug.
- **Desktop generally:** huge wasted vertical whitespace; the hero column doesn't use the wide canvas.
- **Green action-text links** ("Start with time already elapsed", "Add alert at time", "Export Laps",
  "+ Add Stopwatch", Pomodoro's Stats/Settings/Actions/Saved Tasks) — green-on-light contrast concern.
- **BFRB FAB occludes content** — overlaps the bottom nav + nearby content (lap rows on mobile;
  Bedtime/Wake inputs on Wellness). z-index / safe-gutter issue.
- **Mystery glyph** — two small grey dots trail the centiseconds (`.20 • •`) on the stopwatch; purpose
  unclear (pulse indicator?). Verify intent.
- **Insights panels are visually monotonous** — every one of the 9 panels is an identical grey card;
  the "Today" hero looks the same as the rest (no hierarchy); section titles are dim grey uppercase
  (low contrast, both light + dark).
- **Pomodoro:** large empty gap above the timer; action row (Stats/Settings/Actions/Auto/Saved Tasks)
  is cramped green text.

## Verification environment notes
- Serve fresh port + `?nosw=1` to dodge stale SW cache (per repo memory).
- Timing views must be checked in a **foreground/visible** tab (backgrounded → `visibilityState:hidden`
  throttles RAF and changes behavior — this is also the source of the headless `npm test` flake).
- Docker Playwright MCP reaches the host at `host.docker.internal`, can `evaluate`/seed localStorage.
  kapture uses `localhost` but can't evaluate; the two conflict if both attach — one stack per pass.
