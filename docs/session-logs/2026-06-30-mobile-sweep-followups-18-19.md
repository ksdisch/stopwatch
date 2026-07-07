# Mobile sweep follow-ups — FAB recovery-overlap + clock-toggle tap area (2026-06-30; PR #182)

### What We Built

The two LOW papercuts left dangling by the 2026-06-29 mobile sweep ([`2026-06-29-mobile-papercut-sweep.md`](2026-06-29-mobile-papercut-sweep.md)). Both are CSS/markup-only design calls — Kyle picked the recommended (lowest-risk) shape for each via an options gate before any code.

**Backlog #18 — global BFRB FAB overlapped the Recovery "Log sleep" button.** The backlog row was half-stale: PR #181 had already hidden the FAB on full-screen *takeover panels*; the only collision left was on the normal route `#/wellness/recovery`, where the FAB (`position:fixed; bottom-right; z:2000`) floats over the green `.recovery-primary-btn`. Fix mirrors the exact `:has()` idiom #181 established — one surface-scoped rule in `css/styles.css`, right beside the takeover-panel block:

```css
body:has([data-wellness-sub="recovery"]:not([hidden])) .global-bfrb-fab { display: none; }
```

Wellness sub-surfaces toggle the native `[hidden]` attribute (`js/tempo-nav.js`), so `:not([hidden])` = recovery is the active sub. Catches still have keyboard shortcut **B**; engines without `:has()` keep the FAB (harmless fallback). Considered but rejected: button-clearance (band-aids one collision, recurs elsewhere) and a global FAB reposition (touches the flagship timer screen — biggest blast radius).

**Backlog #19 — clock digital/analog toggle was two 8px tap targets.** Geometry trap: the two `.mode-dot`s sit 16px center-to-center (8px boxes, `gap:8px`), so non-overlapping ≥44px-*wide* hit areas are impossible without spreading the visible dots apart (regresses the hero timer screen) or overlapping (ambiguous taps). Kyle chose the **partial bump** — keep the dots visually identical, enlarge only the *clickable* area via a transparent `::after`:

```css
.mode-dot { position: relative; }
.mode-dot::after { content:''; position:absolute; top:-18px; bottom:-18px; left:-4px; right:-4px; }
```

Horizontal reach is capped at 4px/side so the two hit areas meet exactly at the midpoint and never overlap; vertically there's no neighbor, so it grows to a full ~44px. Net target **~16×44px** vs the old 8×8 point — visible dots unchanged. A true ≥44px-wide pair (segmented control) was intentionally not taken — it would redesign the flagship screen for a low-frequency, trivially-reversible control.

`sw.js` CACHE_NAME bumped `v147-fab-hide-takeover` → `v148-fab-recovery-clock-tap`.

### Verification result

Fresh code, both viewports (Recipe B: `:8770` + `?nosw=1` + fresh Playwright `newContext`), at **390×844** and **375×667**:

- **#18:** FAB computes to `display:none` on `#/wellness/recovery`; `display:block` on `#/wellness/meds` (control) and `#/home`. Screenshot confirms "Log sleep" unobstructed, no FAB. Identical at both viewports.
- **#19:** visible dot still exactly **8×8px** (`getComputedStyle` + `getBoundingClientRect`). `elementFromPoint` hit-tests: dot center, **±15px and +20px in Y**, and **−6px in X** all return the button (the old 8px box missed everything past 4px); `+24px Y` correctly falls through to the page (bounded, not runaway); the seam is clean (`c1+6→d1`, `c2−6→d2`, no cross-contamination). Identical at both viewports.
- Console: no 4xx and no errors on the instrumented run. CSS/markup-only diff → cannot affect the documented headless-only `_scheduleStoreMerge` sync-engine flake; `npm test` not re-run-to-green per the flake rule.

### Suggested Next Steps

- **iOS spot-check:** confirm both on a real notched device after the next `npm run sync-www && npm run ios:open` (FAB gone on recovery; dots tappable). Browser can't show device-true touch slop.
- **Mobile sweep tier is now fully shipped** — backlog rows #17/#18/#19 all closed. Next mobile work would be net-new (e.g. the deferred iOS input-zoom in draft PR #177).

### Commits
```
2810c18  fix(mobile): scope-hide FAB on recovery route (#18) + enlarge clock-toggle tap area (#19)  (PR #182)
```
