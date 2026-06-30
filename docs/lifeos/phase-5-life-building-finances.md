# Life-OS Phase 5 — Life Building, Finances slice (v1)

- **Status:** 📐 Designed 2026-06-30 — approved in-session (brainstorm); **not yet built**.
- **Designed:** 2026-06-30 — all three scoring forks ratified by Kyle in-session.
- **Build branch:** `feat/p5-life-building-finances` (cut off `origin/main` when build starts).
- **Roadmap:** [`roadmap.md`](roadmap.md) §Phase 5 · **Pillar spec:** [`pillars.md`](pillars.md) §1 · **Capture map:** [`data-sources.md`](data-sources.md) §Finances
- **Contracts:** [`../contracts/synthesis-record.md`](../contracts/synthesis-record.md), [`../contracts/pillar-feed.md`](../contracts/pillar-feed.md)
- **Decisions:** [`decisions/0004-balance-importance-x-neglect.md`](decisions/0004-balance-importance-x-neglect.md) (scoring), [`decisions/0005-synthesis-record-rollup-and-token-discipline.md`](decisions/0005-synthesis-record-rollup-and-token-discipline.md) (rollup); the finance-store + scoring forks are ratified **in this doc**.
- **Mirrors:** [`phase-3-plan.md`](phase-3-plan.md) (Chickens — the seed→synthesizer graduation + the workstream pattern), [`phase-2-plan.md`](phase-2-plan.md).

> **Scope.** Roadmap Phase 5 is **two native pillars** (Life Building + Relationships). This doc is **slice 1 of Life Building: the Finances Area only.** The other Life Building Areas (Habits, Admin, Values, Goals) and the whole Relationships pillar are **later slices, each its own spec**. Finances was chosen as the first slice because it is the one execution Area with a clean server-side data path (a synced store the council reads directly), so it proves the entire Life Building vertical with zero new architectural patterns.

## Gate (slice 1 — must pass before the next Life Building slice)

> **Life Building emits a real (non-seed) `synthesis/life_building` record scored from the new `finances` store; the Life Building hub renders the Finances Area card off that record; the bubble map reflects the real score; and a staleness nudge fires when the current month's numbers are unentered.**

The Phase-1 seed (`council/seed-pillars.mjs`, mock `life_building` score) is replaced by a real council synthesizer that reads Tempo's **new `finances`** synced store server-side via the Admin SDK and writes a real `life_building` synthesis record (`state.score` + additive `areas[]` + `balance{}`). The PWA gains (a) a monthly Finances capture form, (b) a dedicated Life Building hub (a new nav tab), and (c) the live staleness nudge.

## Read-first disambiguation

- **`life_building` is already a first-class synthesis node** — in `synthesize.mjs`'s known-node list, in `synthesis-feed.js`'s `PILLAR_NODES` (line 34), in `balance.json`, and **seeded** by `seed-pillars.mjs`. Slice 1 replaces the *producer* (seed → real synthesizer); do **not** re-register the node. (Same graduation Physicals/Chickens already did.)
- **Nav-pillar ≠ synthesis-node** (the Phase-2/3 trap): the new nav tab `data-pillar-id="life-building"` is distinct from the `life_building` synthesis node the Home hub already cards. Do **not** add the nav id to `synthesis-feed.js`'s `PILLAR_NODES`.
- **The pillar producer MUST stamp `balance{}`** via `balance.mjs` (`synthesize.mjs` never re-stamps pillars) or the bubble-map Importance/Neglect lenses go flat.
- **`finances` is a client-written + council-read synced store** — the council runs server-side under the Admin SDK and can only read Firestore, so a device-local store would be invisible to it (the same reason mood had to be synced, [ADR-0008](decisions/0008-mood-event-store.md)). `finances` is the **8th synced store**.
- **`finances` is the first *editable per-period* synced store.** Its merge therefore models on **`js/sync-merge-rest-log.js` (per-key LWW)**, **not** mood's append-only `(deviceId, at)` dedup — a month's numbers get *corrected*, and the latest `updatedAt` for that month wins. The Firestore doc id **is** the month key (`YYYY-MM`).
- **No `firestore.rules` change.** The owner catch-all (`users/{userId}/{collection}/{docId=**}`) already grants per-user read/write to `finances`; only `recovery_state`/`synthesis` are excluded. No rules deploy this slice.
- **The hub has a write path** — unlike the pure render-from-cache `physicals-ui.js`/`chickens-ui.js`, the Life Building hub also *hosts the capture form*, so it models on `recovery-ui.js` (read the synthesized verdict **+** write raw inputs). The form writes raw finance numbers locally → they sync → the council reads them on its next run → the next synthesis updates the card. The hub never writes to `synthesis/*`.
- **Trend metrics need history.** Debt paydown and net-worth growth are *trajectories*, not levels — they stay `null`/inactive until **≥2 monthly snapshots** exist; never fake a trajectory from a single number. Month 1 scores from the two level metrics (savings rate, credit score) only.

## Ratified fork #1 — finance data contract

**`finances` = the 8th synced store** (localStorage key + Firestore collection). **Monthly snapshots, keyed `YYYY-MM`**, one doc per month, every metric field optional:

```
{ month: 'YYYY-MM',
  savingsRate?: number,     // percent, e.g. 18 = 18%
  creditScore?: number,     // e.g. 760
  debtRemaining?: number,   // currency, total remaining debt
  netWorth?: number,        // currency, can be negative
  deviceId, updatedAt, schemaVersion }
```

Editable (not append-only). Stamped via `js/schema.js` (F10), gated by `SyncState.canWrite` (F13), F19a honored. **Merge = per-month-key LWW** (latest `updatedAt` wins for a given month), deterministic doc id = the `month` string — `js/sync-merge-finances.js` clones `js/sync-merge-rest-log.js`'s per-key LWW path (not the mood/bfrb append-only dedup). No F15 arrival toast. Export/backup posture mirrors the other synced stores.

## Ratified fork #2 — capture UX (monthly form in the hub)

- **Surface:** an **"Update this month's numbers"** form *inside* the Life Building hub (mirroring how `recovery-ui.js` hosts "Log sleep") — **not** an always-visible topbar entry (finance capture is monthly, not high-frequency).
- **Flow:** 4 optional number inputs (savings rate %, credit score, debt remaining, net worth), prefilled from the current month's snapshot if present → Save → one `Finances.setMonth(month, values)` upsert (haptic + "Saved ✓"). Editing the same month overwrites it (LWW).
- **Budget:** ~15s, monthly. **v1 non-goals:** no reminders/notifications (capture is pull-based), no per-field history editor (correct by re-entering the month), no currency formatting beyond a thousands separator, no new settings toggle.

## Ratified fork #3 — score model (council default — tunable in `life-building.json`)

Slice 1 has **one Area (Finances)**; its four metrics blend into the Finances Area score, which (being the only Area) **is** the Life Building composite. Adding Habits/Admin later just adds entries to the same weighted mean.

| Metric | Server-side source | Formula (→ 0..1, ×100) | Target anchor | inactive / `null` when |
|---|---|---|---|---|
| **Savings rate** *(level)* | latest `finances[m].savingsRate` | `clamp(rate / target, 0, 1)` | **20%** (placeholder) | no snapshot carrying `savingsRate` |
| **Credit score** *(level)* | latest `finances[m].creditScore` | `clamp((score − floor)/(target − floor), 0, 1)` | **800** (placeholder), floor **670** | no snapshot carrying `creditScore` |
| **Debt paydown** *(trend)* | last 2 logged `debtRemaining` | down = good; score by % reduction between the two latest months | trend (down good) | < 2 months carrying `debtRemaining` |
| **Net-worth growth** *(trend)* | last 2 logged `netWorth` | up = good; score by % growth between the two latest months | trend (up good) | < 2 months carrying `netWorth` |

- **Finances Area score** = `balanceScore(...)` over the **present** metrics (inactive/`null` drop out, weights renormalize — the same importance-weighted-mean + positive-weight pre-filter as `physicals-synthesizer.mjs`). Proposed weights: savings `0.40` · credit `0.30` · debt `0.15` · net worth `0.15` (trend metrics weighted low; they contribute nothing until they have history, so month 1 is effectively savings 0.57 / credit 0.43 after renormalization).
- **Composite `state.score`** = the Finances Area score in slice 1. All-null → `null` → band `unknown`. Band via `bandForScore`.
- **`areas[]`** = one entry `{ key:'finances', label:'Finances', score, band, signal }`; the hub's Finances card breaks out the four raw numbers + a per-metric mini-status beneath the Area score.
- **`balance` stamp** = `importance/target` from `balance.json['life_building']`; `neglect = shortfall(score, target)`; `priority = importance·neglect` — via `balance.mjs`.
- **`coverage`** = contributing metrics / 4 (all four metrics — so a trend metric that hasn't activated yet counts *against* coverage, matching `physicals-synthesizer.mjs`'s `counted / AREA_KEYS.length`) → `confidence` (same thresholds as the other synthesizers). Cold-start (month 1, two level metrics) ≈ 0.5 → `medium`, never `high`.
- **Descriptive-first discipline** (mirrors `tempo-coach.js` / Physicals): every headline/signal/nudge is *observational*; no-data is an explicit empty-state, never a failing `0`.

### Staleness nudge (the gate's third clause)

Computed **in the synthesizer** (no client-side nudge module, unlike Chickens' stress nudge). When the latest snapshot's `month` ≠ the current month → one observational nudge, `priority 1`: *"Finances haven't been updated this month."* Otherwise no nudge. (Weekly mode only.)

## Architecture decisions

1. **`finances` as the 8th synced store, editable per-month LWW** — models on `rest_log` (per-key LWW), not mood (append-only). Doc id = the `YYYY-MM` month key (fork #1).
2. **Monthly snapshots, not a single overwritten "current" record** — preserves the history the trend metrics (and future charts) need.
3. **Capture form in the hub** (recovery-ui pattern), not the topbar (fork #2).
4. **Areas-in-one-record** — additive `areas[]` on the single `life_building` record (mirror P2/P3); one Area (`finances`) now, no sub-node docs → **no `synthesis-feed.js` change**.
5. **Single scrolling hub mirroring `physicals-ui.js` + a capture form** — a read/write hybrid; render-from-cache for the verdict, one write path for capture (fork #2).
6. **Fold the synthesizer into `synthesize.mjs`** (build + write `synthesis/life_building` before the home roll-up); **remove `life_building` from `seed-pillars.mjs`**. Existing daily+weekly launchd jobs refresh it; **no launchd re-point** (mirror P2/P3).
7. **Trend metrics activate at ≥2 snapshots; level targets ship as placeholders** (savings 20% / credit 800), tunable in `life-building.json` and later via the P7 approve-on-change loop (fork #3).
8. **Staleness is the only nudge in v1** (fork #3), computed synthesizer-side.

## Workstream A — Council

| File | Action | Purpose |
|---|---|---|
| `council/lib/life-building-synthesizer.mjs` | new (pure) | `buildLifeBuildingRecord(...)` + pure metric helpers (savings/credit level, debt/net-worth trend, staleness) → Finances Area score → composite + `areas[]` + `balance{}` stamp → validate/throw (clone `physicals-synthesizer.mjs`) |
| `council/lib/life-building-synthesizer.test.mjs` | new | `node --test`: each metric formula, trend-needs-2-months gating, weight renormalization, level-target normalization, staleness nudge, balance stamp, empty→`null`/`unknown`, validator |
| `council/config/life-building.json` | new | window, metric weights, savings/credit targets + credit floor |
| `council/synthesize.mjs` | edit | Admin-SDK read of `finances`; build+validate+write `synthesis/life_building` before the pillar-read/home roll-up; import `buildLifeBuildingRecord` |
| `council/seed-pillars.mjs` | edit | drop `life_building` from the mock seed list |
| `council/config/balance.json` | verify | confirm `life_building` `importance`/`target` entry (already present for the seed) |

## Workstream B — PWA capture + store

| File | Action | Purpose |
|---|---|---|
| `js/finances.js` | new | `Finances` data module: `setMonth(month, values)` upsert, `getMonth(month)`, `getAll`, `snapshotForSync`, `_reconcileWriteRaw`, F10 stamping, F13 gate, F19a (clone `js/mood.js` scaffolding, swap append-only `log` for keyed upsert) |
| `js/sync-merge-finances.js` | new | per-month-key LWW merge, doc id = `month` (clone `js/sync-merge-rest-log.js`) |
| `js/sync-engine.js` | edit | 8th `SYNCED_STORES` entry + dispatcher map + payload doc + offline-buffer path |
| `tests/finances.test.js`, `tests/sync-merge-finances.test.js`, `tests/sync-engine.test.js`, `tests/index.html` | new/edit | module + merge tests; update the store-list assertions (7 → 8) |

## Workstream C — PWA hub

| File | Action | Purpose |
|---|---|---|
| `js/life-building-ui.js` | new | `LifeBuildingUI` (mirror `physicals-ui.js`): render-from-cache composite hero + Finances Area card from `getRecord('life_building').areas` + nudges + **the capture form** (the one write path), empty-state default, `onUpdate` repaint, `_internals` |
| `index.html` | edit | `<section data-pillar-id="life-building">` + new tabbar button + `<script>` tags |
| `js/tempo-nav.js` | edit | `'life-building'` in the route whitelist + `applyRoute` dispatch → `LifeBuildingUI.render()` |
| `js/app.js` | edit | `LifeBuildingUI.init()` (guarded) after the other hub inits |
| `css/styles.css` | edit | `.life-building-*` reusing `.home-card` + `--home-band-*` tokens; the capture-form styles |
| `sw.js` | edit | ASSETS entries (`finances.js`, `sync-merge-finances.js`, `life-building-ui.js`) + `CACHE_NAME` bump |
| `tests/life-building-ui.test.js` + `tests/index.html` | new/edit | browser tests for the pure `_internals` helpers |
| `CLAUDE.md` | edit | file-map + Script Load Order chain (lockstep with `index.html` — the pre-commit hook enforces) |

**Proposed script load-order slots** (verify against the load-order hook at build): merge cluster `… → sync-merge-mood → sync-merge-finances → sync-auth → …`; data module + hub `… → synthesis-feed → finances → home-ui → physicals-ui → chickens-ui → life-building-ui → …` (data module loads before the hub that consumes it; both used only at runtime, so exact slots are flexible within the hook's lockstep rule).

## Workstream D — Docs

- `docs/reference/data-dictionary.md` — `finances` rows + 8-store registry language.
- `docs/CLOUD-SYNC-STRATEGY.md` — 8th store row + the per-month-key LWW merge rule.
- `js/schema.js` — synced-eligible comment list.
- `docs/SESSION-LOG.md` + the CLAUDE.md backlog row at ship.

## Sequence & gates

1. **Spec committed** (this PR) → 2. **Implement** (A ∥ B; C after B) → 3. **Verify** (`npm --prefix council test` green; browser suite green incl. new tests; Playwright renders the hub off a **real** record; bubble map reflects the real `life_building` score; staleness nudge fires on a fixture; phone confirm) → 4. **Adversarial multi-lens review** → fix → re-verify → 5. **Conventional commits** (council · PWA · docs), push, open the slice-1 PR, **stop at the merge boundary**.

**Prod/persistence actions, each pausing for an explicit per-action OK:** (a) the one-time council run that writes the first real `life_building` record; (b) merge to `main`. *(No `firestore.rules` deploy this slice.)*

## Risks

- **sync-engine blast radius** (the store-list assertions + dispatcher/buffer maps) — mitigated by the thrice-shipped store recipe (`bfrb_events`, `distractions`, `mood_events`). The known 1–2 headless steady-state flakes live in this suite; a foreground tab is the green path.
- **First editable per-period store** — the per-month-key LWW merge is a *new* merge shape for this codebase (all prior stores are append-only or whole-record LWW). Extra test care on the same-month edit/collision path; `rest_log`'s sleep-LWW is the closest precedent.
- **A one-Area pillar looks sparse, and finance numbers move slowly**, so the hub will feel static until slice 2 (Habits/Admin) lands. Accepted — it's the price of a clean thin vertical slice.
- **Placeholder targets** (20% / 800) need Kyle's real numbers to make the score meaningful; tunable in `life-building.json`, refined by P7.
- **Privacy:** raw finance numbers ride Kyle-scoped Firestore (same posture as `meds`/`bfrb_events`/`mood_events`); App-Store privacy nutrition labels (backlog #1) must add finance data if Tempo is ever submitted publicly.
- **New-module 4-file wiring ×3** (`finances`, `sync-merge-finances`, `life-building-ui`) — the pre-commit guard enforces sw.js/ASSETS/load-order lockstep.

## Open items to confirm at the build gate

- Real savings-rate + credit-score targets (placeholders ship otherwise).
- Hub empty-state + capture-form copy (human-owned strings).
- Exact trend-score formula for debt/net-worth (% delta bands), ratified against `life-building.json` like `physicals.json` was.
