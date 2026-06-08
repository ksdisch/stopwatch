# Life-OS Phase 2 — Physicals (first real federated pillar)

- **Status:** In progress
- **Started:** 2026-06-08
- **Branch:** `feat/lifeos-phase-2-physicals` (cut off `origin/main` @ post-Phase-1, incl. #141)
- **Roadmap:** [`roadmap.md`](roadmap.md) §Phase 2 · **Pillar spec:** [`pillars.md`](pillars.md) §2 · **Integration:** [`integration-plan.md`](integration-plan.md) §5
- **Contracts:** [`../contracts/synthesis-record.md`](../contracts/synthesis-record.md), [`../reference/recovery-state-contract.md`](../reference/recovery-state-contract.md), and the new [`../contracts/pillar-feed.md`](../contracts/pillar-feed.md)
- **Mirrors:** [`phase-1-plan.md`](phase-1-plan.md) (the two-disjoint-workstream pattern)

## Gate (must pass before Phase 3)

> **Physicals contributes a real normalized score into Balance + the bubble map, sourced from the published mart (not mock data).**

The Phase-1 seed (`council/seed-pillars.mjs` writes a mock `physicals` score of 45) is fully
replaced by a real council synthesizer that reads the live `recovery_state` mart (plus Tempo's
own synced wellness stores) server-side via the Admin SDK and writes a real `physicals`
synthesis record — `state.score` + the additive `balance{}` stamp — so the existing Home bubble
map + Balance hero reflect the real pillar, and a new dedicated Physicals hub renders its 4
Areas.

## Read-first disambiguation

- **`physicals` is already a first-class synthesis node** — it is in `synthesize.mjs`'s
  `PILLAR_NODES` and `synthesis-feed.js`'s `PILLAR_NODES`, and in `balance.json`
  (`importance:5, target:75`). Phase 2 does **not** register the node; it replaces the *producer*
  (seed → real synthesizer).
- **Nav-pillar vs synthesis-node.** Adding a 6th top-level nav pillar `data-pillar-id="physicals"`
  (tab + route + section) is distinct from the `physicals` *synthesis node* the Home hub already
  cards. The two coexist; do **not** add the nav id to `synthesis-feed.js`'s `PILLAR_NODES`.
- **The Home bubble-map lenses read an additive `balance:{importance,neglect,priority}` field on
  each pillar record.** `synthesize.mjs` only writes `home`; it never re-stamps pillars — so the
  Physicals synthesizer **must** stamp `balance` (via `balance.mjs`) or the Importance/Neglect
  lenses go flat.

## Score model (council default — ratified by Kyle, tunable in `physicals.json`)

Trailing **14-day** window. Each Area → 0–100 sub-score or `null` (no data ≠ zero):

| Area | Server-side source | Formula | App-aligned? |
|---|---|---|---|
| **Recovery** | `recovery_state/latest.recovery_signal` | `well_recovered 90 · neutral 65 · strained 35 · insufficient_data → null` | ✅ reuses `tempo-coach readinessBand` semantics |
| **Training** | `recovery_state` `acwr` | `[0.8,1.3]→90 · (1.3,1.5]→65 · >1.5→35 · <0.8→70 · absent→null` | ✅ ACWR is the app's only load signal (same mart) |
| **Sleep** | `rest_log` (14d) | per-night `0.6·clamp(hours/7.5) + 0.4·(quality/5)`; hours-only if no quality; mean of logged nights; `null` if none | ⚠️ **7.5h target is council-invented** (app has none); quality/5 *is* app-graded |
| **Meds** | `meds.doseLog` (14d) | per-med `mean_days(min(1, taken/expected))`, `expected=once1/twice2`, exclude `as-needed`; averaged across scheduled meds; `null` if none | ✅ mirrors `analytics.getMedAdherence` (per-day cap) |

**Composite `state.score`** = `balanceScore(areas.map(a => ({score: a.score, importance: weight[a.key]})))`
— reuses the Balance engine's importance-weighted mean (weights Recovery `0.40` · Sleep `0.25` ·
Meds `0.20` · Training `0.15`; null Areas drop out, weights renormalize, `Math.round`+clamp).
All-null → `null` → band `unknown`. Band via `bandForScore`.

**`balance` stamp** = `importance/target` from `balance.json['physicals']` (5 / 75); `neglect =
shortfall(score, target)`; `priority = importance·neglect` — via `balance.mjs`, exactly like
`seed-pillars.mjs`.

**Descriptive-first discipline** (mirrors `tempo-coach.js`): every headline/signal/nudge is
*observational*, never an imperative medical/training instruction. No-data is an explicit
empty-state, never a failing `0`.

## Architecture decisions

1. **Areas-in-one-record** — the synthesizer emits an additive `areas:[{key,label,score,band,signal}]`
   field on the single `physicals` record (contract allows additive fields). → **no
   `synthesis-feed.js` change** (physicals already fetched), one Firestore doc. Sub-node
   `physicals/<area>` docs are a future graduation.
2. **Single scrolling hub** — 4 stacked Area cards (mirror Home's `_pillarCardsHtml`), not a
   Rhythm-style sub-nav.
3. **Fold the synthesizer into `synthesize.mjs`** as a pre-step *before* the pillar-read loop →
   the existing daily+weekly launchd jobs refresh physicals automatically; **no launchd re-point**.
4. **Reuse productivity-blue accent** for v1 (zero token work).

## Workstream A — Council

| File | Action | Purpose |
|---|---|---|
| `council/lib/physicals-synthesizer.mjs` | new (pure) | `buildPhysicalsRecord(...)` + pure Area helpers → composite + `areas[]` + `balance{}` stamp → validate/throw |
| `council/lib/physicals-synthesizer.test.mjs` | new | `node --test`: each Area formula, composite null-drop, balance stamp, empty→null/`unknown`, validator |
| `council/config/physicals.json` | new | window, Area weights, recovery/ACWR bands, sleep target, meds expected-doses |
| `council/synthesize.mjs` | edit | Admin-SDK read `recovery_state`+`meds`+`history`+`rest_log`; build+validate+write `synthesis/physicals` **before** the pillar-read loop |
| `council/seed-pillars.mjs` | edit | drop `physicals` from the mock seed list |

## Workstream B — PWA

| File | Action | Purpose |
|---|---|---|
| `js/physicals-ui.js` | new | `PhysicalsUI` (mirror `home-ui.js`): render-from-cache, 4 Area cards from `getRecord('physicals').areas`, empty-state default, `onUpdate` repaint, `_internals` |
| `index.html` | edit | `<section data-pillar-id="physicals">` + 6th tabbar button + `<script>` tag |
| `js/tempo-nav.js` | edit | `'physicals'` in whitelist + `applyRoute` dispatch → `PhysicalsUI.render()` |
| `js/app.js` | edit | `PhysicalsUI.init()` (guarded) after `HomeUI.init()` |
| `css/styles.css` | edit | `.physicals-pillar-body` + `.physicals-area-card` (reuse `.home-card` + `--home-band-*`) |
| `sw.js` | edit | ASSETS entry + `CACHE_NAME` → `stopwatch-v125-physicals-pillar` |
| `tests/physicals-ui.test.js` + `tests/index.html` | new/edit | browser tests for the pure `_internals` helpers |
| `CLAUDE.md` | edit | file-map + Script Load Order chain (lockstep — pre-commit hook) |

## Workstream C — Docs + deferred items

- **`docs/contracts/pillar-feed.md`** — author the generalized inbound-mart contract (generalizes
  `recovery_state`); resolves the 2 dangling links + the 3 prose mentions.
- **`firestore.rules` deploy** — already committed/tested (#139); sequence `npm run test:rules` →
  drift-check live → `firebase deploy --only firestore:rules --project tempo-sync-6f7b2`
  (⛔ prod — explicit per-action OK) → verify via Rules Playground.
- `docs/SESSION-LOG.md` + CLAUDE.md backlog at ship.

## Sequence & gates

1. Plan doc committed → 2. Implement (A ∥ B) → 3. Verify (`node --test` green; browser suite green
incl. new tests; Playwright renders the hub off a **real** record; bubble map reflects real
physicals; phone confirm) → 4. Adversarial multi-lens review → fix → re-verify → 5. Conventional
commits (council · PWA · docs), push, open the Phase 2 PR, **stop at the merge boundary**.

**Prod/persistence actions, each pausing for an explicit per-action OK:** (a) the one-time council
run that writes the real `physicals` record; (b) the `firestore.rules` deploy; (c) merge to main.
