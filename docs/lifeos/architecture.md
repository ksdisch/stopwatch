# Tempo Life-OS — Architecture

**Status:** Approved · **Date:** 2026-06-08

This document describes the *shape* of the system: how it runs, how data flows, how synthesis works, how the
agent councils are structured, and how token-bloat is kept under control. Pillar specifics live in `pillars.md`;
project integration lives in `integration-plan.md`.

---

## 1. Runtime model (Question Zero)

**Decision: local-first councils.** (Full reasoning in `decisions/0001`.) This is validated by precedent —
`job-search-mas` already runs exactly this pattern in production (a nightly launchd job that drives Claude Code
over Kyle's data with human review gates).

The system is layered into three tiers:

| Tier | What runs here | Where it runs | Reach |
|---|---|---|---|
| **1 — Dashboard / data layer** | The Tempo PWA: read synthesis, capture data, see the bubble map | Any device (it just reads/writes Firestore) | **Anywhere** |
| **2 — Council runtime** | The synthesizers/councils: read data, compute Balance, write synthesis | Kyle's Mac (Claude Code + launchd) | **At the machine** |
| **3 — On-demand / remote AI** *(deferred)* | "Ask my life-OS" / trigger a synthesis from the phone | A backend or a `claude` server sidecar | *Not in v1* |

**The keystone that makes Tier 2 + Tier 1 work together:** the councils **write their synthesis back to
Firestore**, so even though the *intelligence* is tethered to the Mac, the *output* is readable on any device.
You can always read the latest Balance recap on your phone; you simply can't (yet) *trigger* a new one remotely.

**What this honestly costs:** scheduled councils only fire while the Mac is on; you cannot converse with a council
when away from it; and (per the `job-search-mas` precedent) a council fails *silently* if the Claude Code CLI auth
drifts — which is why **failure alerting (Slack/SMS) is mandatory**, not optional. Where a backend/the Claude API
would still be required is captured as Tier 3 and deferred to `open-questions.md`.

## 2. Topology — a federated "hub of hubs"

The life-OS is **not** one monolithic app and **not** a monorepo. It is a thin **trunk** (the evolved Tempo PWA)
plus a set of **federated modules/sub-apps**, all communicating over a shared **Firestore spine**.

```
                 ┌─────────────────────────────────────────────────────────────┐
                 │  TRUNK = evolved Tempo repo (life-os)                          │
                 │  • PWA shell: HOME (bubble map + synthesis cards)              │
                 │  • Native dashboards for lightweight pillars                   │
                 │  • Local councils (Claude Code agents + launchd routines)      │
                 │  • Integration CONTRACTS (Firestore schemas)                   │
                 └───────────────▲───────────────────────────▲───────────────────┘
                                 │  read/write               │  read/write
        ┌────────────────────────┴───────────────────────────┴──────────────────┐
        │                     FIRESTORE  =  the spine                            │
        │  synthesis records · pillar feeds · published marts · captured data    │
        └───▲──────────────▲───────────────────▲────────────────────▲───────────┘
            │ publishes     │ publishes          │ publishes           │ publishes
   personal-health-elt   learning-hub          DogHood           job-search-mas
   (recovery mart)       (growth summary       (visits / social   (career state)
                          + deep-link)          feed)
   [own repo, Python]    [own repo, React]     [own repo, Expo]   [own repo, Python]
```

**Native vs. federated pillars.** Lightweight pillars (Chickens, Physicals dashboards, Life Building,
Relationships) render **natively inside the Tempo shell**. "Heavy" pillars that are already full applications
(Growth = `learning-hub`) stay **federated sub-apps**: they publish a summary feed to the spine (so the home
synthesizer and bubble map can use them) and the home **deep-links** into them for the full experience. The home
works uniformly because *everything publishes a synthesis record to the spine, regardless of what stack rendered
it.* (See `decisions/0007`.)

## 3. The synthesis-record model

**Every synthesizer node — an Area, a Hub, or the Home — emits one small structured record. Parents read their
children's *records*, never the children's raw data.** This is simultaneously the recursion mechanism and the
core token-discipline mechanism (a pillar never re-reads thousands of rows; it reads a handful of one-paragraph
child summaries).

Proposed record shape (final field names to be fixed in build Phase 0):

```jsonc
{
  "node":       "physicals/sleep",            // dotted path in the Pillar›Hub›Area tree, or "home"
  "window":     "2026-06-01..2026-06-07",
  "state":      { "band": "strained", "score": 38 },   // normalized 0–100 health/attention read
  "headline":   "Training load up, recovery down — 3rd poor night in a row.",
  "signals":    ["ACWR 1.4 (high)", "HRV -12% wk/wk", "2 missed wind-downs"],  // top-N only; rest archived
  "nudges":     [{ "text": "Deload + one early night", "priority": 1 }],
  "provenance": { "sources": ["recovery_state", "rest_log"], "coverage": 0.8 },
  "confidence": "high"                         // guards against over-claiming on thin data
}
```

`confidence`/`coverage` let a parent **down-weight a thin-data child** instead of treating it as gospel — this is
how "discard non-useful info" and "checks and balances" are realized structurally.

### Roll-up (3 levels)

1. **Area synthesizer** (leaf, e.g. *Physicals/Sleep*) reads raw metrics for its slice → emits a record.
2. **Hub / pillar synthesizer** (*Physicals*) reads its Areas' records → emits a pillar record (pillar state +
   the one cross-Area insight + top nudges).
3. **Home synthesizer** reads the five pillar records → emits the **Balance** read + the week's headline + 1–3
   prioritized **cross-pillar** moves.

Synthesis is **retrospective and prospective**: it recaps what happened *and* proposes what's next.

## 4. The Balance engine

(Full reasoning in `decisions/0004`.) Balance does **not** count activities — *10 workouts ≠ 1 therapy session*.
The currency is each pillar's **normalized health score** (`state.score` above), computed *relative to that
pillar's own target/baseline*, so domains are comparable without comparing apples to oranges.

```
For each pillar p:
    Importance(p)   — USER-SET, slow-moving (encodes Kyle's values; revised quarterly / on life changes)
    Neglect(p)      — DERIVED: time-decayed accumulation of how far p's score has run below its target
    Priority(p)     = Importance(p) × Neglect(p)
```

The home synthesizer ranks pillars by `Priority` to decide what to surface and nudge. The result:

- **important AND neglected** → rises to the top of the recap and swells on the bubble map;
- **neglected but consciously down-weighted** (low Importance) → stays quiet (a deliberate season is respected);
- **important but well-tended** (low Neglect) → also stays quiet.

**Self-improving feedback loop (deliberately modest).** The council *tracks nudge → outcome* and **auto-tunes
nudge wording/timing** (low stakes). Any change to **Importance weights or targets** is **proposed for human
approval**, never applied automatically — the system never silently re-weights Kyle's values. A fully-automated
reward loop was explicitly rejected as opaque and prone to optimizing a proxy.

## 5. Council / agent model

Councils are **Claude Code agents + scheduled routines**, structured from a small library of **reusable
archetypes** (instantiated by config + prompt; custom agents only by exception, always able to cite why they
exist):

| Archetype | Job |
|---|---|
| **Synthesizer** | Reads child records (or raw metrics, at a leaf) → emits this node's synthesis record. One per Hub/pillar/Home. |
| **Capturer / Interviewer** | Runs Tier-3 capture — asks questions, parses NL answers into structured metrics. One per Area that needs self-report. |
| **Ingester / Feed** | Pulls from an external source and publishes a versioned mart to the spine (the `personal-health-elt` pattern). One per Module. |
| **Guard / Validator** | Deterministic checks (data sanity, redundancy, balance-distortion). Passive — surfaces issues, doesn't auto-act. (The `job-search-mas` voice/format guard pattern.) |
| **Planner** | Turns the Home's prioritized moves into concrete suggestions / schedule entries during the weekly session. |

**Scheduling.** launchd jobs on the Mac (the proven `job-search-mas` mechanism): a **nightly light synthesis**
(updates daily-glance cards) and a **Sunday-night weekly recap** build, each wrapped with a PATH-preflight and
**Slack/SMS failure alerts**.

**New-unit lifecycle** (light gate — `decisions/0006`): *propose → classify (architect agent: Hub? Area? Module?
fold-in? + redundancy check) → spec → init/scaffold → trial.* The heavier "trial → keep/merge/archive" rigor runs
as part of the periodic hygiene sweep, not as friction on every addition.

## 6. Token-discipline strategy

A first-class architecture concern (Kyle's explicit priority), realized through five mechanisms:

1. **Summaries flow up, raw data doesn't** — parents read children's synthesis records, never their rows.
2. **Lean, single-purpose agents** — each archetype instance gets only its slice + its own small prompt;
   archetype reuse keeps prompts consistent *and* short.
3. **Tiered context windows** — daily glance = today's records only; weekly = pillar records + a 1-week window;
   deep history is loaded only on demand.
4. **Aggressive archiving** — resolved nudges, old records, and stale Areas move to a cold archive (queryable,
   out of active context).
5. **Scheduled hygiene sweep** — adapts the existing `trim-context` skill to flag bloated CLAUDE.md/config,
   oversized memory, and dead units, then propose trims for approval. Cadence: weekly light, monthly deep;
   **archive, don't delete** (reversible).

## 7. Integration contracts

Each federated project owns its repo and publishes a **versioned, contract-tested feed** to the spine. The
contract — *the shape of what's published, not the code that produces it* — is the only coupling point. Changing a
contract is a deliberate, gated act (its tests must be updated and both producer and consumers coordinated);
changing anything *behind* the contract is free. This is what lets `personal-health-elt` (and every Module) keep
iterating independently while integrated. Details and the worked `personal-health-elt` example are in
`integration-plan.md`.
