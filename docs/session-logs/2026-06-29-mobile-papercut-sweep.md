# Mobile UX papercut sweep — safe-area + tap-targets (2026-06-29; PRs #178/#179)

### What We Built

A daily-driver mobile-hardening sweep across every Tempo surface at **390×844** + **375×667** on fresh code (Recipe B: `:8770` + `?nosw=1` + a fresh Playwright `newContext`). A deterministic measurement harness swept all 13 routes + 5 wellness sub-surfaces + 10 overlay surfaces, measuring horizontal overflow, controls trapped behind the fixed tabbar, and sub-44px tap targets. Findings were adversarially verified by a 7-skeptic Workflow (each source-based, defaulting to refuted) — which **killed one over-claim** (the `.mode-tab` "clipping" is a native `overflow-x:auto` swipe carousel, not clipped) and **held every finding to MEDIUM** (none HIGH). Full ranked inventory: [`docs/bug-hunt/2026-06-29-mobile-sweep.md`](../bug-hunt/2026-06-29-mobile-sweep.md).

The one real bug class: four full-screen `position:fixed` takeover panels (`.history-panel`, `.analytics-panel`, `.presets-drawer`, `.log-past-panel`) that paint over the tabbar, **escape `#app`'s safe-area padding** (no transformed ancestor → viewport-relative), and omit `env(safe-area-inset-*)` — so on notched iOS standalone their headers/close-buttons sit under the status bar/notch and their footers under the home indicator. Three of them even share `.history-header`. **PR #178** adds the `env()` padding idiom (mirroring the in-repo `.focus-overlay`) to each panel **container** (not the shared header). **PR #179** bumps two sub-44px controls to ≥44px: Flow `.vibrate-label select` (`min-height:44px`; was ~25px) and `.recovery-quality-btn` (36→44). The `.mode-dot` clock digital/analog toggle (two 8px dots `gap:8px` apart) was **deferred** — a clean 44px hit area each would either spread the visual dots ~52px apart (regression) or overlap (ambiguous taps); a real fix needs restructuring it into a segmented control (a redesign).

Verified **clean and untouched**: settings drawer (#176 holds), Todoist picker (`max-height:70vh` + scroll), BFRB FAB (correct `env(safe-area-inset-bottom)`), focus-overlay (the fix reference), mood popover; all routes + wellness sub-views (no overflow, no trapped controls at either viewport).

### Verification result

Safe-area bugs are **invisible in-browser** (`env(safe-area-inset-*)` resolves to 0 off-device), so each panel fix was verified three ways via fresh `newContext`: (1) the `env()` rule is live in the parsed stylesheet **and** computes to `0px` at inset=0 (proves applied + no desktop/non-notched regression); (2) console clean; (3) a **simulated 47/34px inset** shows headers/footers clearing the unsafe zones. Tap-target fixes measured ≥44px at 390 + 375 with `docOverflowX:0` (no horizontal overflow). `npm test` green save the documented headless-only `_scheduleStoreMerge` steady-state flake (pre-existing on main, impossible from a CSS-only diff). **Both PRs passed full CI** (incl. engine-tests — the flake is local-headless-specific). Cache: `v143` → `v144` (#178) → `v146` (#179, merge-resolved past the sibling bump).

### Suggested Next Steps

- **FAB overlap (backlog #18):** the global BFRB FAB overlaps bottom-right primary actions (History "Clear All", Recovery "Log sleep") on takeover surfaces — hide/shift it behind takeover panels.
- **Clock toggle (backlog #19):** restructure `.mode-dot` (two 8px dots) into a segmented control for a real ≥44px tap target.
- **iOS spot-check:** confirm the safe-area padding on a real notched device after the next `npm run sync-www && npm run ios:open` — the browser can't show it.

### Commits
```
f80335a  fix(safe-area): reserve env(safe-area-inset-*) on full-screen takeover panels (PR #178)
94239b1  fix(tap-targets): bump Flow selects + sleep-quality buttons to >=44px (PR #179)
```
