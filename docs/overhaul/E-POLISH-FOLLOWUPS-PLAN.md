# E-polish Follow-ups — Implementation Plan

> Branch: `feat/overhaul-E-polish-followups` (off `main` @ `c011765`).
> Scope: the four self-contained polish items the prior session deferred after PR #135.
> Direction: **Bold Data-Dense** (the ratified gate decision). Per-PR gate from
> `docs/overhaul/PLAN.md` applies (npm test, sw bump, screenshots, focused PR).

## The four items

| # | Item | Finding | Files | Risk |
|---|------|---------|-------|------|
| 1 | Apply `--chart-1..6` ramp + pillar tokens to chart series | E-visual E20 + Bold Data-Dense ramp | `js/analytics-ui.js`, `js/rhythm-insights.js`, `css/styles.css` | low (visible color change → verify themes) |
| 2 | Brighten dim section titles | E-visual (opacity-on-text ladder) | `css/styles.css`, `css/tempo-shell.css` | low |
| 3 | `formatDuration` → `Utils.formatHuman` | E-visual E10 (medium) | `js/utils.js`, `js/wellness-cooking-ui.js`, `js/exercise-ui.js`, `js/meds-ui.js`, `tests/utils.test.js` | low — **changes output** (see §3) |
| 4 | Shared `.tempo-card` / `.tempo-empty` base | E-visual E25 (medium) | `css/tempo-shell.css` (+ opt-in markup) | low (CSS-first, additive) |

All four bump `sw.js` `CACHE_NAME` (currently `v119` → `v120`). No synced-store writes →
`sync-invariant-reviewer` not required, but a general review fan-out gates the PR.

## §1 — Chart colors (`--chart-1..6` + pillar tokens)

The `--chart-1..6` tokens already exist (`styles.css:65-66`, light overrides `:87-88`) but are
consumed only by the E-polish hero rail. Route the panels' data-series colors through them:
- **Categorical** series (multi-series charts, e.g. analytics MODE_COLORS) → `--chart-1..6`.
- **Pillar** elements (productivity vs wellness) → `var(--productivity-accent)`/`var(--wellness-accent)`.
- **Sequential** scales (sleep-quality red→green ramp) → leave, except swap the amber step to `var(--amber)`.
- SVG `fill="#hex"` / `stroke="#hex"` **presentation attributes** must move into `style="fill:var(...)"`
  — `var()` does not resolve in SVG presentation attributes.

Exact literal→token mapping comes from the read-only mapping pass (`e-polish-followup-map` workflow).

## §2 — Brighten dim section titles

E-polish already fixed `.analytics-card-header` to: uppercase, `letter-spacing:0.06em`,
`color:var(--text)` @ `0.82` opacity, `font-weight:700`. Apply the same crisp treatment (or at
minimum the contrast bump) to the OTHER section-title/heading-role selectors still using
`var(--text-secondary)` or low opacity. Scope = heading roles only, not all secondary/body text.

## §3 — `Utils.formatHuman` (output unification)

Three divergent copies today:
- `wellness-cooking-ui.js` / `exercise-ui.js` (identical): `h>0→"Hh Mm"`, `m>0→"Mm Ss"`, else `"Ss"`.
- `meds-ui.js`: adds days `"Dd Hh"`, and notably the minutes case shows **only** `"Mm"` (no seconds).

New `Utils.formatHuman(ms, {maxUnits=2})`: largest non-zero unit + the contiguous next-lower
unit(s) up to `maxUnits`, **trimming trailing zero units**. Days→seconds tiers.

**Output change to validate per call-site (the prior session's flagged risk):**
- `wcook`/`exercise`: round durations lose the noisy trailing zero — `"5m 0s"→"5m"`, `"2h 0m"→"2h"`. Non-round unchanged (`"5m 30s"`, `"1h 30m"`).
- `meds`: the minutes case now shows seconds when present — `"Last taken 5m ago"→"5m 12s ago"` when 12s have elapsed. Hours+ unchanged.

`presets.js:formatDurationHint` (different signature/role) and `rhythm-engine.js:formatDurationShort`
(distinct rounding + `m<5` conditional-seconds rule, returns `''` on empty) are **out of scope** —
different contracts, named differently. New `tests/utils.test.js` locks `formatHuman` behavior.

## §4 — Shared `.tempo-card` / `.tempo-empty`

CSS-first per the finding: add the base classes to `tempo-shell.css` using the **dominant**
card/empty convention (from the mapping pass), then opt in only the families whose current values
already MATCH (zero visual change) as the incremental demonstration. Do NOT big-bang-migrate all
44 card + 17 empty selectors; leave a comment that the rest opt in over time.

## Sequence
1. ✅ Branch cut. 2. Mapping pass (running). 3. §3 formatHuman + tests (independent). 4. §1 chart colors. 5. §2 titles. 6. §4 card/empty base. 7. Bump `CACHE_NAME`. 8. `npm test` foreground-green + browser visual verify (themes + light + mobile width). 9. Review fan-out. 10. Open PR; pause for push/merge approval.

## Verification
- `npm test` foreground PASS (≈933; only the named sync-engine merge-cycle flakes may fail).
- Browser: Insights + Analytics render correct colors across Midnight/light + ≥1 alt theme; section titles legible; cards/empties unchanged where opted in; wellness durations + meds "last taken" read correctly.
- Adversarial review of the diff (theme correctness, output parity, no card regression, contrast).
