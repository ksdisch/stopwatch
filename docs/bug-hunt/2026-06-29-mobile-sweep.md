# Mobile UX papercut sweep — Tempo PWA (≤390px)

**Date:** 2026-06-29 · **Scope:** every surface @ **390×844** + **375×667** ·
**Method:** deterministic fresh-code measurement harness (Playwright `newContext`,
served on `:8770` + `?nosw=1` per `docs/playbooks/browser-verification.md` Recipe B)
→ candidate findings → **7-skeptic adversarial-verification Workflow** (`wf_f03b857a-550`,
each verifier source-based and **defaulting to refuted**) → this report.

> Reference fix this sweep emulates: PR #176 / commit `4650c90` (settings-drawer scroll)
> and the in-repo safe-area idiom `.focus-overlay` (`css/styles.css:4409-4424`).

> **Outcome (2026-06-30):** Batch 1 → **PR #178** (safe-area) and Batch 2 → **PR #179**
> (tap-targets) both merged to `main` (final cache `v146`). `.mode-dot` clock toggle
> deferred → backlog #19. The BFRB-FAB-over-bottom-actions overlap was newly observed
> → backlog #18.

## TL;DR

- **Routes are clean.** All 13 routes + 5 wellness sub-surfaces: **no** horizontal
  overflow, **no** controls trapped behind the tabbar, at **both** viewports, **zero**
  console errors. `#app { padding-bottom: calc(tabbar + safe-area + 8px) }`
  (`css/tempo-shell.css:50`) does its job — the #176 *class* does **not** reproduce on
  normal-flow content.
- **One confirmed bug class:** full-screen **takeover panels** (`position:fixed; inset:0`,
  z 300–1000, painting over the tabbar) that omit `env(safe-area-inset-*)`. On a notched
  iPhone (standalone PWA / Capacitor) their **headers/close-buttons sit under the status
  bar/notch** and their **footers/last-items under the home indicator**. **4 surfaces, all
  MEDIUM, one shared root cause, one mechanical fix.**
- **Adversarial pass killed 1 over-claim** (`.mode-tab` "clipping" → native swipe carousel)
  and **downgraded the initial HIGH** on History to MEDIUM (content stays reachable; the
  defect is crowding, not a trap). **No finding earned HIGH.**
- **Verified clean (won't touch):** settings drawer (#176), Todoist picker, BFRB FAB,
  focus-overlay, mood popover.

## Ranked inventory (verified)

| # | Surface | Issue | Sev | Verdict | Root cause (file:line) | Fix |
|---|---------|-------|-----|---------|------------------------|-----|
| 1 | `.history-panel` | header (title + `×` close) under notch; footer (Backup/Restore/Clear) under home indicator | **MED** | confirmed | `styles.css:4474` fixed inset:0, no `env`; header `.history-header:4487`, footer `.history-actions:5335` | `env()` padding on container |
| 2 | `.analytics-panel` | same — and it's **LIVE** (`#/analytics` CTA → `#analytics-toggle` → `openPanel`) | **MED** | confirmed | `styles.css:4508` fixed inset:0, no `env` | `env()` padding on container |
| 3 | `.presets-drawer` | header (`×`) under notch; last preset under home indicator (body scrolls) | **MED** | confirmed | `styles.css:301` fixed inset:0; body `:314`; header reuses `.history-header` | `env()` padding on container |
| 4 | `.log-past-panel` | header (`×`) under notch; Save cramped (`padding-bottom:40px` is inset-blind) | **MED** | confirmed | `styles.css:5347`; form `:5358` | `padding-top:env` on panel + `calc(40px + env(...bottom))` on form |
| 5 | tap targets (surgical) | flow selects 25px tall, recovery-quality 36px, clock digital/analog dot 8×8 | **LOW** | partial | `styles.css` ~`1639` / ~`2418` / ~`607` | `min-height:44` / hit-area pad (the **worst few only**) |
| — | `.mode-tab` strip | Interval/Cook off-screen @390 | NONE | **refuted** | `.tempo-subnav-scroll` `overflow-x:auto; scroll-snap` (`tempo-shell.css:145`) — native swipe carousel | n/a |
| — | settings (#176), Todoist picker, BFRB FAB, focus-overlay, mood | — | NONE | **clean** | each carries its cap / `env` guard at HEAD | n/a |

## The class (root cause)

All four panels are full-screen `position:fixed` takeovers that **escape `#app`** (no
transformed ancestor → they pin to the viewport, so `#app{padding-bottom:env(...)}` cannot
reach them — the verifiers grep-confirmed no `transform/filter/perspective/contain` on
`#app`/`body`/wrappers). Three of them (history, presets, log-past) **share the
`.history-header` class** for their top bar — so "header under the notch" is literally one
shared element. None reserve safe-area. The **correct in-repo idiom already exists**:
`.focus-overlay` (`styles.css:4409-4424`) pads all four `env(safe-area-inset-*)`; the
topbar, BFRB FAB, and #176 settings-drawer use it too.

## Fix approach (mirror `.focus-overlay`)

Per-container `padding: env(safe-area-inset-top) env(...right) env(...bottom) env(...left)`
on each panel — scoped to the **container**, NOT the shared `.history-header` (so siblings
aren't double-padded). For `.log-past-panel`: `padding-top:env(...)` on the panel +
`calc(40px + env(...bottom))` on the form. **Bump `sw.js CACHE_NAME` in the same commit**
(cached CSS changed — hook + CI enforce).

## Verification caveat (important)

This class is **invisible to browser screenshots** — `env(safe-area-inset-*)` resolves to
`0` off-device. Each fix is verified three ways: (1) CSS correctness vs the `.focus-overlay`
reference; (2) **no-regression** screenshot at inset=0 (layout unchanged on non-notched);
(3) **simulated-inset** screenshot (injected 47px / 34px bands) showing the header/footer
now clear the unsafe zones. Device truth = the iOS app, via the same `env()` the
topbar/FAB/focus already rely on.

## Evidence

33 screenshots in `/tmp/tempo-audit/` — incl. `sim-history.png` / `sim-presets.png` /
`sim-log-past.png` (simulated-inset proofs), `ov-*-390.png`, `ov375-*.png`, `r-*-390.png`,
`wellness-*.png`. Full per-finding verifier reasoning: Workflow `wf_f03b857a-550` transcript.

## Out of scope (per Kyle's brief)

iOS input-zoom (owned by **draft PR #177**), settings IA restructure, feature/engine
changes, app-wide tap-target redesign (blanket 44px), PR #174.
