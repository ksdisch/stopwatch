# Phase 5 — Life Building / Finances (Slice 1) — Build Plan & Audit

> Working tracker for the build. **Source of truth for scope/schema** is the approved spec
> [`phase-5-life-building-finances.md`](phase-5-life-building-finances.md). This doc adds the
> exact file/line edit checklist (derived by tracing the 7th store `mood_events` + the
> council `physicals` pillar) and the orchestration DAG.

- **Branch:** `feat/p5-life-building-finances` (off `origin/main` @ `88e3815`).
- **Blast radius:** **HIGH** — adds the 8th synced store touching `sync-engine.js` core
  (two merge dispatchers, offline buffer, store registry, F19a), a *new merge shape*
  (per-month-key LWW, first editable-per-period store), and a new nav pillar. Mitigated by
  the thrice-shipped store recipe + a mandatory invariant review before PR.
- **Cache bump:** `stopwatch-v158-notification-persistence` → `stopwatch-v159-life-building-finances`.
- **Gate (must pass):** Life Building emits a real `synthesis/life_building` scored from the
  new `finances` store; the hub renders the Finances Area card off it; the bubble map reflects
  the real score; a staleness nudge fires when the current month is unentered.

## Hard stops (autonomous mode — everything else proceeds)
1. **Before the one-time prod council run** that writes the first real `synthesis/life_building` record → explicit per-action OK.
2. **Before any merge to `main`** → Kyle's explicit per-PR go-ahead.
Building, committing, pushing the branch, and opening the PR proceed autonomously with a brief at each action.

## Orchestration DAG
- **Wave 1 (parallel):** A (council, `council/**`) ∥ B (store, `js/finances.js` + `js/sync-merge-finances.js` + `sync-engine.js`/`sync-buffer.js`/`export.js`/`schema.js`). Non-overlapping file sets. Each writes + runs its own tests.
- **Wave 2:** C (hub, `js/life-building-ui.js` + `index.html` section/tab + `tempo-nav.js` + `css`) — after B (reads `Finances` + the record shape). Verifies via kapture.
- **Assembly (main thread):** central registries (`index.html` store `<script>` slots, `sw.js` ASSETS + `CACHE_NAME`, `CLAUDE.md` chain, `tests/index.html`), `app.js` init, docs → run the 3 guard checks + both suites.
- **Verify:** app-verifier (empty + seeded-cache render) + `sync-invariant-reviewer` on the diff.
- **Ship:** 3 conventional commits (council · PWA · docs) → push → PR → STOP.

## Ratified data contract (fork #1)
`finances` = 8th synced store, monthly snapshots keyed `YYYY-MM`, one Firestore doc per month, every metric optional:
```
{ month:'YYYY-MM', savingsRate?, creditScore?, debtRemaining?, netWorth?, deviceId, updatedAt, schemaVersion }
```
Editable (NOT append-only). Stamped via `js/schema.js` (F10), gated by `SyncState.canWrite` (F13), F19a honored. Merge = **per-month-key LWW** (latest `updatedAt` wins for a month), deterministic doc id = the `month` string. No F15 arrival toast.

---

## Workstream A — Council  (`council/**`)
| File | Action | Exact target |
|---|---|---|
| `council/lib/life-building-synthesizer.mjs` | **new (pure)** | Clone `physicals-synthesizer.mjs`. `buildLifeBuildingRecord({financesDocs, config, balanceConfig, mode, now})` → metric helpers (savings level, credit level w/ floor, debt trend ≥2mo, net-worth trend ≥2mo, staleness) → `balanceScore` over present metrics (weights renormalize) → composite `state.score` + `areas:[{key:'finances',...}]` + `balance{}` stamp via `balance.mjs` + `coverage`=counted/4 → `confidence`; validate/throw. All-null → `null`/`unknown`. Staleness nudge (priority 1) when latest `month` ≠ current month (weekly mode only). |
| `council/lib/life-building-synthesizer.test.mjs` | **new** | `node --test`: each formula, trend-needs-2-months gating, weight renormalization, level-target normalization (savings/target, (score−floor)/(target−floor)), staleness, balance stamp, empty→null/unknown, validator. |
| `council/config/life-building.json` | **new** | Clone `physicals.json` shape. `window`, metric weights (savings 0.40 · credit 0.30 · debt 0.15 · netWorth 0.15), savings target 20, credit target 800 + floor 670. |
| `council/synthesize.mjs` | **edit** | `:30` add `import { buildLifeBuildingRecord } from './lib/life-building-synthesizer.mjs';`. `:37` `life_building` already in `PILLAR_NODES` — DO NOT re-add. Add a physicals-shaped block (read `finances` collection via Admin SDK → build → validate → write `users/${uid}/synthesis/life_building`) placed AFTER chickens, BEFORE the roll-up loop `:261`; NON-FATAL posture (log + continue on the prior record). |
| `council/seed-pillars.mjs` | **edit** | Remove the `node: 'life_building'` seed entry `:55` + update the `:8` comment (mirror how physicals `:11` / chickens `:15` graduated). |
| `council/config/balance.json` | **verify (no change)** | `:3` `"life_building": { "importance": 4, "target": 70 }` already present. |

## Workstream B — PWA store  (`js/**`)
| File | Action | Exact target |
|---|---|---|
| `js/finances.js` | **new** | Clone `js/mood.js` scaffolding; swap append-only `log()` for keyed **`setMonth(month, values)` upsert** + `getMonth(month)` + `getAll()` + `snapshotForSync()` + `_reconcileWriteRaw`. `STORAGE_KEY='finances'`. F10 stamp, F13 `SyncState.canWrite` gate, F19a. |
| `js/sync-merge-finances.js` | **new** | Clone `js/sync-merge-rest-log.js` (per-key LWW), NOT mood's append-only dedup. `SyncMergeFinances`; doc id = the `month` string; latest `updatedAt` per month wins; F19a future-record pre-filter; CAS writeback via `SyncMergeEqual.recordsEqual`. No F15. `window.SyncMergeFinances = …`. |
| `js/sync-engine.js` | **edit** | `:155` add `{ key:'finances', adapter:{ read:()=>Finances.snapshotForSync(), write: writeStub } }` to SYNCED_STORES (append as 8th). `:2116` add `finances:null` to `storeResults`. **`:2147` AND `:2343`** add `finances: (typeof SyncMergeFinances!=='undefined')?SyncMergeFinances:null` to BOTH dispatcher maps. `:2017`/`:2024` add finances offline-buffer branch. `:445` per-key hydrate branch + `:353` payload doc comment. F19a filter parity. |
| `js/sync-buffer.js` | **edit** | `:434` add a `finances`→`SyncMergeFinances.merge` drain-routing branch. Note `:42` comment: finances is NOT append-only — keep the LWW distinction. |
| `js/export.js` | **edit** | `:143` add `'finances'` to the backup store list (after `'mood_events'`) + a one-line comment (8th synced store, editable per-month). |
| `js/schema.js` | **edit** | `:23` add a `Finances (localStorage 'finances' — Life-OS Phase 5)` line to the synced-store comment list. |

## Workstream B — tests  (`tests/**`, prefix new top-level ids `_fin_`)
| File | Action | Exact target |
|---|---|---|
| `tests/finances.test.js` | **new** | Clone `tests/mood.test.js`: setMonth upsert, same-month overwrite (LWW), getMonth/getAll, snapshotForSync shape + stamping (deviceId/updatedAt/schemaVersion), F13 gate, F19a. |
| `tests/sync-merge-finances.test.js` | **new** | Clone `tests/sync-merge-mood.test.js` but per-month-key LWW: same-month newer-updatedAt wins, older loses, distinct months coexist, doc-id = month, F19a filter, CAS skip when equal. |
| `tests/sync-engine.test.js` | **edit** | 7→8: `:405` keys.length, `:412`-style `keys[7]==='finances'`, `:1044`/`:1051`/`:1086`/`:1091` (8 stubs/errors), `:2229` mergeCalls, `:2543`/`:2587` subs.length. Add `finances`/`SyncMergeFinances` to the save/restore merge blocks (`:838`/`:1437`/`:1964`) + ordered-list assertions. |
| `tests/sync-listeners.test.js` | **edit** | 7→8 subs.length + connected/disconnected counts (`:266/:273/:290/:294/:346/:360/:397/:406`); add finances to the save/restore + `make('finances')` set. |
| `tests/sync-merge-history.test.js`, `tests/sync-merge-meds.test.js`, `tests/sync-buffer.test.js` | **edit** | Add `finances: SyncMergeFinances.merge` to each save/restore-all-merges enumeration so the 8th store's merge is stubbed (else it executes live). |
| `tests/index.html` | **edit (assembly owns final)** | register `../js/finances.js` + `../js/sync-merge-finances.js` (module) + `finances.test.js` + `sync-merge-finances.test.js` (specs). |

## Workstream C — PWA hub  (`js/**`, `index.html`, `css`)
| File | Action | Exact target |
|---|---|---|
| `js/life-building-ui.js` | **new** | Clone `js/physicals-ui.js` (render-from-cache composite hero + Area cards + nudges + `_internals` + `onUpdate` repaint) AND fold `js/recovery-ui.js`'s write-form pattern for **"Update this month's numbers"** (4 optional inputs prefilled from current month → `Finances.setMonth` upsert + `Platform.haptic` + "Saved ✓"). Reads `SynthesisFeed.getRecord('life_building').areas`. Empty-state = DEFAULT. |
| `js/life-building-ui.test.js` | **new** | Browser tests for the pure `_internals` (card model from a seeded record, empty-state, form prefill/serialize). |
| `index.html` | **edit** | `<section data-pillar-id="life-building">` + tabbar `<button>` + hub `<script>` slot (Workstream C owns the hub markup; assembly adds the store-module `<script>` slots). |
| `js/tempo-nav.js` | **edit** | add `'life-building'` to the route whitelist + `applyRoute` dispatch → `LifeBuildingUI.render()`. |
| `css/styles.css` | **edit** | `.life-building-*` reusing `.home-card` + `--home-band-*` tokens + the capture-form styles. |

## Assembly (main thread) — registries + init
- `index.html`: `<script>` slots for `js/finances.js` + `js/sync-merge-finances.js` (real app load).
- `sw.js`: ASSETS entries for the 3 new js + bump `CACHE_NAME` → `stopwatch-v159-life-building-finances`.
- `CLAUDE.md`: file-map rows + **Script Load Order** chain (lockstep with `index.html`; proposed slots: `… sync-merge-mood → sync-merge-finances → sync-auth …` and `… synthesis-feed → finances → home-ui → physicals-ui → chickens-ui → life-building-ui …`).
- `js/app.js`: `LifeBuildingUI.init()` (guarded) after the other hub inits.
- Guards: `node scripts/check-asset-integrity.mjs && node scripts/check-load-order.mjs && node scripts/check-sw-bump.mjs`.

## Workstream D — docs
- `docs/reference/data-dictionary.md` — `finances` rows (localStorage + Firestore) + "8 synced stores" language.
- `docs/CLOUD-SYNC-STRATEGY.md` — 8th store row + the per-month-key LWW merge rule.
- `docs/SESSION-LOG.md` — session entry. `CLAUDE.md` backlog row #22 → status shipped-pending-merge.

## Build-gate open items (ship placeholders, surface — do NOT block)
- Real savings-rate / credit-score targets (placeholders 20% / 800 in `life-building.json`).
- Hub empty-state + capture-form copy (human-owned strings — reasonable defaults, flag for Kyle).
- Exact debt/net-worth trend-score % bands (ratify against `life-building.json`).
