# Life-OS Primitives

## Purpose
This page captures the structural vocabulary and runtime model of the Tempo Life-OS in one place. The concepts are scattered across four plan documents (`docs/lifeos/architecture.md`, `docs/lifeos/pillars.md`, `docs/lifeos/roadmap.md`, `CLAUDE.md`) and the shipped code. No single file answers: what do "Pillar / Hub / Area / Module" mean precisely, how do synthesis records flow upward, how does the Balance engine actually score pillars, and what council archetypes run in production today? This page synthesizes those and links to [lifeos-status](lifeos-status.md) for the plan-vs-shipped reconciliation rather than re-deriving it.

## Key understanding

### The structural vocabulary

**Fact** (`docs/lifeos/pillars.md` preamble, `docs/lifeos/decisions/0006`):

| Term | Definition |
|---|---|
| **Pillar** | A top-level life domain. There are exactly five: Life Building, Physicals, Chickens, Relationships, Growth/Learning. Fixed set; Tempo synthesizes across all five. |
| **Hub** | A recursive container with its own local synthesizer that routes to children. Can nest (a Pillar is a Hub over its Areas). |
| **Area** | A leaf you tend: one coherent trackable thing that produces a metric/state but has no council of its own. Hubs roll up Areas. |
| **Module** | A cross-cutting plugged-in tool/integration/skill that *feeds* Areas. One Module can feed several Areas across pillars. Examples: `personal-health-elt` feeds Physicals/Recovery and Physicals/Training; `job-search-mas` feeds Life Building/Career. |

**Decision** (`docs/lifeos/decisions/0001`, Decisions.md D1): councils are local-first — Claude Code + launchd on Kyle's Mac write synthesis records to Firestore; the PWA renders from cache. This means synthesis only fires while the Mac is on. Remote/on-demand triggering (Tier 3) is deferred to post-v1.

**Decision** (Decisions.md D1, `docs/lifeos/decisions/0003`): the `stopwatch` repo evolves in place as the Life-OS trunk. Federated modules/sub-apps stay in their own repos and communicate over a shared Firestore spine — no monorepo.

### The synthesis-record model

**Fact** (`docs/lifeos/architecture.md` §3): every synthesizer node (Area, Hub, or Home) emits one small structured record. Parents read their children's *records*, never the children's raw data. This is simultaneously the recursion mechanism and the token-discipline mechanism.

Record shape (approved at Phase 0, `PR #139`):
```jsonc
{
  "node":       "physicals/sleep",     // dotted path in the Pillar›Hub›Area tree
  "window":     "2026-06-01..2026-06-07",
  "state":      { "band": "strained", "score": 38 },  // normalized 0–100 score
  "headline":   "Training load up, recovery down.",
  "signals":    ["ACWR 1.4 (high)", "HRV -12% wk/wk"],  // top-N; rest archived
  "nudges":     [{ "text": "Deload + one early night", "priority": 1 }],
  "provenance": { "sources": ["recovery_state", "rest_log"], "coverage": 0.8 },
  "confidence": "high"
}
```

**Inference**: `confidence`/`coverage` let a parent silently down-weight a thin-data child (e.g. no mood data for three days) without surfacing an error — this is how the system avoids over-claiming.

Roll-up has three levels (Fact, `docs/lifeos/architecture.md` §3):
1. Area synthesizer reads raw metrics → emits a record
2. Hub/pillar synthesizer reads its Areas' records → emits a pillar record
3. Home synthesizer reads the five pillar records → emits the Balance read + 1–3 cross-pillar moves

### The Balance engine

**Fact** (`docs/lifeos/architecture.md` §4, `docs/lifeos/decisions/0004`):

```
For each pillar p:
    Importance(p)   — user-set, slow-moving (encodes values; revised quarterly)
    Neglect(p)      — derived: time-decayed accumulation of how far p's score ran below target
    Priority(p)     = Importance(p) × Neglect(p)
```

The home synthesizer ranks pillars by `Priority` to decide what to surface. Deliberate result: important AND neglected → rises; neglected but consciously down-weighted → stays quiet; important but well-tended → stays quiet.

**Decision** (`docs/lifeos/architecture.md` §4): nudge wording/timing is auto-tuned (low stakes); Importance weights and targets are **proposed for human approval, never applied automatically** — the system never silently re-weights values. A fully-automated reward loop was explicitly rejected as opaque.

### Council archetypes (the reusable library)

**Fact** (`docs/lifeos/architecture.md` §5): five archetypes, instantiated by config + prompt; custom agents only by exception:

| Archetype | Job |
|---|---|
| **Synthesizer** | Reads child records (or raw metrics at a leaf) → emits this node's synthesis record. One per Hub/pillar/Home. |
| **Capturer / Interviewer** | Tier-3 capture: asks questions, parses NL answers into structured metrics. One per Area needing self-report. |
| **Ingester / Feed** | Pulls from an external source, publishes a versioned mart to the spine. One per Module. |
| **Guard / Validator** | Deterministic sanity checks. Passive — surfaces issues, never auto-acts. |
| **Planner** | Turns the Home's prioritized moves into concrete suggestions during the weekly session. |

**Fact** (CLAUDE.md `council/` description, `docs/SESSION-LOG.md` 2026-07-19): In production today the `council/life-building-weekly` synthesizer runs nightly via launchd, writing `life_building` synthesis records to Firestore. Pillar synthesizers for Physicals, Chickens, and Home also run — the full set is in `council/` directory.

### What is shipped vs. planned today

**Fact** (see [lifeos-status](lifeos-status.md) for full reconciliation): P0 (foundations), P1 (Home hub), P2 (Physicals), P3 (Chickens + mood_events), and the P5 Finances slice of Life Building are shipped. P4 (federate Growth + Career), P6 (unit lifecycle), P7 (feedback loop), and the Relationships half of P5 are approved-but-unbuilt.

**Fact** (CLAUDE.md file map): shipped hub modules are `js/home-ui.js` (P1), `js/physicals-ui.js` (P2), `js/chickens-ui.js` (P3), `js/life-building-ui.js` (P5 partial). The 8th synced store `finances` (P5) is live. No `relationships-ui.js` or `growth-ui.js` exists.

### How the Firestore spine is partitioned

**Fact** (`docs/lifeos/architecture.md` §3, `js/synthesis-feed.js`): synthesis records are stored at `users/{uid}/synthesis/{nodeId}` where '/' in the node path becomes '__' (e.g. `physicals__sleep`). `SynthesisFeed.refreshAll()` fetches the `PILLAR_NODES` set and caches results in `localStorage` per-node. The PWA renders **from cache only** — `home-ui.js`, `physicals-ui.js`, `chickens-ui.js`, and `life-building-ui.js` all have "render-from-cache, no fetch path" semantics. The one exception is `life-building-ui.js`, which also has a write path for the monthly finance capture form (→ `Finances.setMonth`).

### Federation contract pattern

**Fact** (`docs/lifeos/architecture.md` §7, `docs/lifeos/integration-plan.md`): each federated project publishes a **versioned, contract-tested feed** to the Firestore spine. The contract — the shape of what's published, not the code that produces it — is the only coupling point. Changing a contract is a gated act (tests updated, producer and consumers coordinated); changing anything behind the contract is free. The `personal-health-elt` pipeline (recovery_state mart) is the reference implementation of this pattern and the only active federation in production.

## Sources
- [`docs/lifeos/architecture.md`](../docs/lifeos/architecture.md) — runtime model (three tiers), synthesis-record shape, Balance engine formula, council archetype library, token-discipline strategy, integration contract pattern
- [`docs/lifeos/pillars.md`](../docs/lifeos/pillars.md) — Pillar/Hub/Area/Module vocabulary, per-pillar Areas and data sources, cross-pillar notes
- [`docs/lifeos/roadmap.md`](../docs/lifeos/roadmap.md) — phase sequence and gate conditions; source of truth for phase ordering
- `CLAUDE.md` § What Has Been Built, file map — shipped hub modules and their render-from-cache semantics
- [`js/synthesis-feed.js`](../js/synthesis-feed.js) — `PILLAR_NODES`, Firestore path encoding (node '/'→'__'), localStorage cache
- `docs/SESSION-LOG.md` 2026-07-19 — evidence that `council/life-building-weekly` is running nightly in production

## Uncertainties & contradictions
- **Unresolved:** which specific council jobs are active and on what launchd schedule — the council directory exists but `docs/SESSION-LOG.md` only confirms `life-building-weekly` explicitly. A future session should enumerate all active launchd jobs.
- **Unresolved:** the Relationships pillar has no hub module and no council. The P5 gate ("all five pillars live") should not be considered passed until it ships (confirmed in [lifeos-status](lifeos-status.md)).
- **Unresolved:** `PILLAR_NODES` in `js/synthesis-feed.js` — the exact list of node IDs in the production constant is not confirmed here; read the file directly before wiring a new pillar node.
- **Inference** (not stated in docs): the `finances` council synthesizer reads `finances` collection on the Firestore spine server-side; the exact council name and schedule are not confirmed in this review.

## Related pages
- [lifeos-status](lifeos-status.md) — plan-vs-shipped reconciliation; which phases are genuinely open
- [Local-First-Data-Model](Local-First-Data-Model.md) — how pillar data stores (mood_events, finances, synthesis records) flow through the sync and storage model

## Relevance to current work
Any session picking up P4 (Growth/Career federation), the Relationships half of P5, P6 (unit lifecycle), or P7 (feedback loop) needs this vocabulary to understand where a new Area/Hub/Module fits, how to write a synthesis record contract, and which archetype to instantiate. The Balance engine formula governs how a new pillar affects the home bubble map once its `state.score` is published.

_Last reviewed: 2026-07-26_
