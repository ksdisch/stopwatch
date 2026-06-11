# Life-OS Phase 3 — Chickens (the build-heavy native pillar)

- **Status:** Design approved (build not started)
- **Designed:** 2026-06-09 — both forks ratified by Kyle in-session
- **Build branch:** `feat/lifeos-phase-3-chickens` (cut off `origin/main` when build starts)
- **Roadmap:** [`roadmap.md`](roadmap.md) §Phase 3 · **Pillar spec:** [`pillars.md`](pillars.md) §3 · **Capture map:** [`data-sources.md`](data-sources.md)
- **Contracts:** [`../contracts/synthesis-record.md`](../contracts/synthesis-record.md), [`../contracts/pillar-feed.md`](../contracts/pillar-feed.md)
- **Decisions:** [`decisions/0008-mood-event-store.md`](decisions/0008-mood-event-store.md) (fork #1); fork #2 (capture UX) is ratified in this doc
- **Mirrors:** [`phase-2-plan.md`](phase-2-plan.md) (the workstream pattern)

## Gate (must pass before Phase 4)

> **Chickens produces a real score and a stress nudge fires (e.g. BFRB-up + sleep-down → a suggested mindful session).**

The Phase-1 seed (`council/seed-pillars.mjs`, mock `chickens` score 68) is replaced by a real
council synthesizer that reads Tempo's synced stores — including the **new `mood_events`** —
plus the `physicals` *record* server-side via the Admin SDK and writes a real `chickens`
synthesis record (`state.score` + additive `areas[]` + `balance{}`). The PWA gains (a) a ≤5s
mood capture available on every pillar, (b) a dedicated Chickens hub (7th nav tab), and
(c) the live stress nudge.

## Read-first disambiguation

- **`chickens` is already a first-class synthesis node** — in `synthesize.mjs`'s and
  `synthesis-feed.js`'s `PILLAR_NODES`, in `balance.json` (`importance: 5, target: 75`), and
  seeded. Phase 3 replaces the *producer* (seed → real synthesizer); do **not** re-register
  the node.
- **Nav-pillar ≠ synthesis-node** (same trap as Phase 2): the 7th nav tab
  `data-pillar-id="chickens"` is distinct from the synthesis node the Home hub already cards.
  Do **not** add the nav id to `synthesis-feed.js`'s `PILLAR_NODES`.
- **The pillar producer MUST stamp `balance{}`** via `balance.mjs` (`synthesize.mjs` never
  re-stamps pillars) or the bubble-map Importance/Neglect lenses go flat.
- **`mood_events` is the first client-written + council-read store.** Tempo's two landing
  patterns are *synced store* (client-writable, council-readable) and *read-only feed*
  (council-written). Device-local data is invisible to the Admin-SDK council, so mood must be
  a synced store ([ADR-0008](decisions/0008-mood-event-store.md)).
- **No `firestore.rules` change.** The owner catch-all
  (`users/{userId}/{collection}/{docId=**}`) already covers `mood_events`; only
  `recovery_state`/`synthesis` are excluded. No rules deploy this phase.
- **Mindful sessions are invisible in History today:** `timer-ui.js` saves
  `{type:'timer', duration, laps, overshootMs}` with **no name**, and breathing exercises log
  **nothing** (`mindful-ui.js:11`). The Mindfulness Area needs the two engine deltas in
  Workstream B.
- **Borrowed signals read the `physicals` RECORD, not raw stores** (the contract's recursion
  rule). Council run order becomes physicals → chickens → home, all inside the existing
  launchd jobs — no re-point.
- **Post-hoc patches of synced event records are silently dropped** on a `(deviceId, at)`
  collision (the merge keeps the cloud copy — `js/global-bfrb.js:63-68` precedent), so the
  capture popover's optional fields must fold into **one** `Mood.log()` call via the
  GlobalBFRB deferred-commit pattern.

## Ratified fork #1 — mood data contract ([ADR-0008](decisions/0008-mood-event-store.md))

**`mood_events` = the 7th synced store** (localStorage key + Firestore collection):

```
{ at: epochMs, valence: 1..5, tags?: string[] (≤3), note?: string (≤280),
  context?: 'global'|'flow'|'pomodoro', deviceId, updatedAt, schemaVersion }
```

Append-only, immutable. Stamped via `js/schema.js` (F10), gated by `SyncState.canWrite`
(F13), F19a honored. Merge = union-dedup by `(deviceId, at)`, deterministic doc id
`deviceId-at` — `js/sync-merge-mood.js` clones `js/sync-merge-bfrb.js`. No F15 arrival toast
(high-frequency precedent). Reserved additive-nullable field: `energy?: 1..5` (lets the
2-axis capture upgrade land later without migration). Export/backup posture mirrors
`bfrb_events`.

## Ratified fork #2 — capture UX (1-tap valence + optional tags)

- **Surface:** a mood icon in `tempo-topbar-actions` (next to History/Settings — visible on
  every pillar) + keyboard shortcut **M** (only `B`/`R`/`Space` are taken; verify at build).
  Popover lazy-created on `<body>`, mirroring the BFRB capture popover.
- **Flow:** tap icon → 5 emoji-labeled valence chips → **one tap logs it** (haptic +
  "Logged ✓"), popover flips to optional tag chips + a "+ note" reveal → auto-commit in 30s /
  on dismiss / on lifecycle exit — all folded into a single `Mood.log()` (deferred-commit).
- **Tag vocabulary** (ONE editable list, mirroring `TRIGGER_CHIPS`):
  `stressed · anxious · tired · calm · content · energized` — qualitative arousal color
  without a required second dimension.
- **Budget:** ~2 taps, 2–4s — comfortably ≤5s from any screen.
- **v1 non-goals:** no reminders/notifications (capture is pull-based), no undo/edit/delete
  (trend means are robust to a misclick — just log again), no energy axis (reserved), no new
  settings toggle.

## Score model (council default — tunable in `chickens.json`, ratify at gate)

Trailing **14-day** window. Five Areas → 0–100 sub-score or `null` (no data ≠ zero):

| Area | Server-side source | Formula | Target anchor | `null` when |
|---|---|---|---|---|
| **Mood** | `mood_events` | mean valence → `(mean−1)/4×100`; hub card shows a 7d-vs-prior-7d delta chip (display only) | mean ≈ 3.8/5 → 70 | <3 logs in window |
| **Mindfulness** | `history` | `min(100, count/4 × 100)`; count = sessions tagged `mindful` OR `type:'timer'` + `programName` starting `Meditation` | ≥4 sessions/14d | history empty in window |
| **BFRB regulation** | `bfrb_events` | trend ratio r = last-7d / prior-7d catches: `≤0.7→90 · ≤1.15→70 · ≤1.6→50 · else→30`; <5 catches total → 85 ("quiet stream") | steady-or-better (70) | stream empty |
| **Focus engagement** | `history` | `min(100, flow+pomodoro minutes / 600 × 100)`; no overwork penalty in v1 (strain is Physicals' job via recovery) | 600 min/14d | history empty in window |
| **Stress load** *(borrowed)* | `synthesis/physicals` record | mean of that record's `recovery` + `sleep` Area scores (null-tolerant) | inherits Physicals targets | record absent / both areas null |

**Composite `state.score`** = `balanceScore(...)` — the same importance-weighted mean +
positive-weight pre-filter pattern as `physicals-synthesizer.mjs` (weights: mood `0.30` ·
bfrb `0.25` · mindfulness `0.20` · focus `0.15` · borrowed stress `0.10` — deliberately low
so Chickens isn't dominated by Physicals double-counting; null Areas drop out, weights
renormalize). All-null → `null` → band `unknown`. Band via `bandForScore`.

**`balance` stamp** = `importance/target` from `balance.json['chickens']` (5 / 75);
`neglect = shortfall(score, target)`; `priority = importance·neglect` — via `balance.mjs`.
Additive `areas[]` (the hub's 5 cards), `coverage = counted/5` → confidence, weekly nudges =
up to 2 observational lines for Areas <60 (mirror `buildNudges`).

**Descriptive-first discipline** (mirrors `tempo-coach.js` / Phase 2): every
headline/signal/nudge is *observational*; no-data is an explicit empty-state, never a
failing `0`.

## Stress nudge (the gate's second half)

Client-side, at the catch moment, extending the Slice-B machinery — **reuse, not
duplication**:

- **Decision (pure, `js/bfrb-risk.js`):** `assess()` gains an optional `restRow` input
  (today's `wellness_rest_log` row) and two outputs: `sleepDown` (hours ≤ 14d personal mean
  − 1.0h when ≥5 logged nights, else absolute < 6.5h; **no row → false** — never assert on
  missing data) and `mindfulSuggested` (= `band === 'clustered' && !suppressed && sleepDown`).
  Same code path ⇒ the suppression guards (`MIN_ACTIVE_DAYS`, `MIN_TODAY_FLOOR`, the
  strained re-lens) are *literally shared*. The module keeps its non-negotiable: bands and
  numbers only, zero copy.
- **Wiring (`js/global-bfrb.js` `maybeOfferSupport`):** `mindfulSuggested` → paint the
  escalated **ratified copy** (ONE new human-owned string, Kyle signs off at build; working
  draft: *"Catches are clustering and last night ran short. A 5-minute breather is one tap
  away."*) as a **tappable** toast → `TempoNav.applyRoute({pillar:'wellness', sub:'mindful'})`
  (route exists). Otherwise clustered-only → the existing `SUPPORT_COPY`. **Reuses**
  `bfrb_support_enabled` (one opt-in governs both variants) + the once-per-day throttle key
  (the mindful variant takes precedence when both qualify).
- **Build detail:** `Toast` needs a tappable/action variant (small `sync-toast.js`
  extension).
- The weekly chickens record complements it with the slow-cadence observational line (e.g.
  "BFRB trend up while sleep ran short this week").

## Architecture decisions

1. **`mood_events` as the 7th synced store** — ADR-0008 (fork #1, ratified 2026-06-09).
2. **1-tap valence + deferred-commit capture in the topbar** (fork #2, ratified 2026-06-09).
3. **Areas-in-one-record** — additive `areas[]` on the single `chickens` record (mirror P2
   §1); sub-node docs are a future graduation. → no `synthesis-feed.js` change.
4. **Single scrolling hub** — 5 stacked Area cards mirroring `physicals-ui.js` (mirror P2 §2).
5. **Fold the synthesizer into `synthesize.mjs`** after `synthesizePhysicals`, before the
   home roll-up — existing daily+weekly launchd jobs refresh it; **no launchd re-point**
   (mirror P2 §3). Chickens reads the physicals record back from Firestore (decoupled;
   honest provenance `synthesis/physicals`).
6. **Stress nudge extends `BfrbRisk.assess()`** rather than adding a parallel module —
   guards shared by construction, one new pure input + two outputs.
7. **Thin Tier-3 reflection:** `council/data/reflections/chickens.json`
   (`{weekKey: {rating: 1..5, note}}`, **gitignored** — public repo) written during the
   Monday ritual; folds into the record's confidence/headline only, **not** a scored Area.
   The full Capturer archetype is P6.

## Workstream A — Council

| File | Action | Purpose |
|---|---|---|
| `council/lib/chickens-synthesizer.mjs` | new (pure) | `buildChickensRecord(...)` + pure Area helpers → composite + `areas[]` + `balance{}` stamp → validate/throw |
| `council/lib/chickens-synthesizer.test.mjs` | new | `node --test`: each Area formula, ratio bands, borrowed-record read, null-drop/renormalize, balance stamp, empty→`null`/`unknown`, validator |
| `council/config/chickens.json` | new | window, Area weights, mood/mindful/bfrb/focus targets + ratio bands |
| `council/synthesize.mjs` | edit | Admin-SDK read `mood_events`+`bfrb_events`+`history`+`rest_log`+the `physicals` record; build+validate+write `synthesis/chickens` after physicals, before the pillar-read loop; fold the reflection file in |
| `council/seed-pillars.mjs` | edit | drop `chickens` from the mock seed list |
| `council/data/reflections/` + `.gitignore` | new | thin Tier-3 reflection slot (gitignored) |

## Workstream B — PWA capture + store

| File | Action | Purpose |
|---|---|---|
| `js/mood.js` | new | `Mood` data module: `log`/`getAll`/`snapshotForSync`, F10 stamping, F13 gate (clone `bfrb-events.js` minus migration) |
| `js/mood-ui.js` | new | topbar popover: valence chips → tag chips → note, deferred-commit, `KeyM`, haptic via `Platform.haptic` |
| `js/sync-merge-mood.js` | new | union-dedup by `(deviceId, at)`, doc id `deviceId-at` (clone `sync-merge-bfrb.js`) |
| `js/sync-engine.js` | edit | 7th `SYNCED_STORES` entry + dispatcher maps + payload doc + offline-buffer path |
| `js/timer-ui.js` | edit | session saves include `programName: Timer.getName()` (additive; F19b spread keeps it lossless) |
| `js/mindful-ui.js` | edit | breathing runner logs a History session on stop when ≥1 full cycle (`tags:['mindful']` + pattern name) |
| `index.html` | edit | topbar mood icon + `<script>` tags (slots below) |
| `js/export.js` / `js/backup.js` | verify/edit | mirror `bfrb_events` export/backup posture |
| `tests/mood.test.js`, `tests/sync-merge-mood.test.js`, `tests/sync-engine.test.js`, `tests/index.html` | new/edit | module + merge tests; update the 6 store-list assertions |

**Script load-order slots** (CLAUDE.md chain + `index.html` in lockstep — pre-commit hook
enforces): `sync-merge-distractions → sync-merge-mood → sync-auth`; `… bfrb-events →
bfrb-risk → global-bfrb → mood → mood-ui → tempo-nav → app`.

## Workstream C — PWA hub

| File | Action | Purpose |
|---|---|---|
| `js/chickens-ui.js` | new | `ChickensUI` (mirror `physicals-ui.js`): render-from-cache, composite hero + 5 Area cards from `getRecord('chickens').areas` + nudges, empty-state default, `onUpdate` repaint, `_internals` |
| `index.html` | edit | `<section data-pillar-id="chickens">` + 7th tabbar button + `<script>` tag (`home-ui → physicals-ui → chickens-ui`) |
| `js/tempo-nav.js` | edit | `'chickens'` in the route whitelist + `applyRoute` dispatch → `ChickensUI.render()` |
| `js/app.js` | edit | `ChickensUI.init()` (guarded) after `PhysicalsUI.init()` |
| `css/styles.css` | edit | `.chickens-*` reusing `.home-card` + `--home-band-*` tokens |
| `sw.js` | edit | ASSETS entries (`mood.js`, `mood-ui.js`, `sync-merge-mood.js`, `chickens-ui.js`) + `CACHE_NAME` bump |
| `tests/chickens-ui.test.js` + `tests/index.html` | new/edit | browser tests for the pure `_internals` helpers |
| `CLAUDE.md` | edit | file-map + Script Load Order chain (lockstep) |

## Workstream D — Stress nudge

| File | Action | Purpose |
|---|---|---|
| `js/bfrb-risk.js` | edit | optional `restRow` input; `sleepDown` + `mindfulSuggested` outputs (guards shared, numbers-only) |
| `js/global-bfrb.js` | edit | escalated ratified copy, tappable toast → `#/wellness/mindful`, shared toggle + daily throttle |
| `js/sync-toast.js` | edit | tappable/action toast variant |
| `tests/bfrb-risk.test.js` | edit | conjunct truth-table + suppression cases (no row / thin nights / personal-relative vs absolute) |

## Workstream E — Docs

- `docs/reference/data-dictionary.md` — `mood_events` rows (§1c, §3), 7-store registry language.
- `docs/CLOUD-SYNC-STRATEGY.md` — 7th store row + merge rule.
- `js/schema.js` — synced-eligible comment list.
- `docs/SESSION-LOG.md` + CLAUDE.md backlog at ship.

## Sequence & gates

1. Plan + ADR committed (this PR) → 2. Implement (A ∥ B+D; C after B) → 3. Verify
(`node --test` green; browser suite green incl. new tests; Playwright renders the hub off a
**real** record; bubble map reflects real chickens; stress nudge fires on a fixture; phone
confirm) → 4. Adversarial multi-lens review → fix → re-verify → 5. Conventional commits
(council · PWA · docs), push, open the Phase 3 PR, **stop at the merge boundary**.

**Prod/persistence actions, each pausing for an explicit per-action OK:** (a) the one-time
council run that writes the real `chickens` record; (b) merge to main. *(No `firestore.rules`
deploy this phase.)*

## Risks

- **sync-engine blast radius** (135-case suite; 6 store-list assertions) — mitigated by the
  twice-shipped store recipe (`bfrb_events`, `distractions`). The 2 pre-existing headless
  flakes live in this suite; a foreground tab is the green path.
- **7 tabs may squeeze the phone tabbar** — check at build; icon-only / tighter padding
  fallback.
- **Privacy:** mood rides Kyle-scoped Firestore (same posture as `bfrb_events`); reflections
  stay local-gitignored; App-Store privacy nutrition labels (backlog #1) must add mood.
- **Ratification surface at the gate:** `chickens.json` targets/weights + the stress-nudge
  copy + the hub empty-state copy need Kyle sign-off, like `physicals.json` was.
- **New-module 4-file wiring ×4** (`mood`, `mood-ui`, `sync-merge-mood`, `chickens-ui`) —
  the pre-commit guard enforces sw.js/ASSETS/load-order lockstep.
