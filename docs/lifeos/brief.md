# Tempo Life-OS — Brief

**Status:** Approved · **Date:** 2026-06-08 · **Owner:** Kyle

---

## The vision, in plain language

Kyle wants a personal **"life-OS"**: a single place that helps him tend the whole of his life, not just one slice
of it. It is organized around **five pillars** — the major domains of a well-lived life — plus a **"home"
synthesizer** that routes between them and, more importantly, *summarizes across them* to keep his life in
**balance**.

The five pillars:

1. **Life Building** — the long game: core values, long-term goals, good habits/routines, finances, and the
   day-to-day "adulting" admin that executes on all of it.
2. **Physicals** — physical health and fitness: training load, recovery, sleep, meds.
3. **Chickens** — mental health ("tend your chickens"): focus, mindfulness, mood, stress, BFRB awareness.
4. **Relationships** — the people he loves: showing up well for his partner Marlee, family, and close friends.
5. **Growth / Learning** — deliberate learning and skill-building.

Each pillar is **recursive**: it has its own local synthesizer and sub-hubs, which can themselves nest as deep
as a domain needs. The **home synthesizer** sits on top, reads the distilled output of each pillar, and produces
a weekly **Balance** recap — *"this week leaned hard into career and growth; your chickens and relationships went
thin, and your body is already flagging it"* — plus a few concrete moves for the week ahead.

The intelligence is delivered by **"agent councils"**: small teams of Claude Code agents and scheduled routines
that read Kyle's data, synthesize it, and collaborate with him. The signature view is a **dynamic bubble map**:
the five pillars as bubbles that flex in size to reflect where his attention is needed.

This is **not a greenfield build.** The most mature project in Kyle's portfolio — the **Tempo** wellness PWA
(`~/Projects/stopwatch`) — is already a multi-pillar wellness app with a proven Firestore sync layer and an
extensible navigation shell. **Tempo evolves into the life-OS shell.** Several other existing projects plug in as
**data feeds** without being absorbed.

## What problem this solves

Kyle's life-improvement tooling is **siloed**: health data in one app, learning in another, career in a third,
relationships nowhere. Nothing looks *across* the silos to answer the only question that actually matters for a
balanced life — *"what am I neglecting right now, and does it matter?"* The life-OS exists to make that
cross-pillar judgment continuously and gently, and to help him act on it.

## Decisions locked during discovery

> Each major decision has a full ADR in `decisions/`. This is the index of *what* was decided; see the ADRs for
> *why* and the alternatives weighed.

| # | Area | Decision |
|---|---|---|
| 1 | **Runtime (Question Zero)** | **Local-first councils.** Synthesizers run as Claude Code agents + scheduled (launchd) routines on Kyle's Mac; they write distilled synthesis to Firestore; the PWA reads/captures anywhere. Remote/on-demand AI (trigger or chat from phone) is **deferred**, not abandoned. *(ADR-0001)* |
| 2 | **Pillar taxonomy** | **Five pillars.** "Adulting/admin" is **not** a sixth pillar — it is a sub-hub of **Life Building**, which is reframed as the *strategic* pillar (Values → Goals → Habits/Routines → Finances → Admin/Logistics). *(ADR-0002)* |
| 3 | **Synthesizer model** | Every node emits a small **structured synthesis record** (state · headline · signals · nudges · provenance · confidence). Roll-up is **3 levels** (Area → Hub/pillar → Home). **Parents read children's *records*, never their raw data.** Cadence: **daily glance + weekly collaboration.** *(ADR-0005)* |
| 4 | **Balance engine** | **Priority = Importance × Neglect.** Importance is **user-set** (your values, slow-moving). Neglect is **derived** (distance below each pillar's own target, time-decayed). Currency is a **normalized health score per pillar**, not raw activity counts. The council **proposes** weight/target changes for approval and **auto-tunes** nudge wording/timing. *(ADR-0004)* |
| 5 | **Data sources** | Three tiers: **established/automatic → self-defined → interview-capture.** Tier-3 interview-capture **is** the weekly collaboration ritual. Finances = **manual monthly metrics** (no aggregator in v1). Relationships = a light **"people I tend"** list with per-person **context cards** (a concierge, not a guilt-tracker). |
| 6 | **Structural vocabulary** | Four units: **Pillar › Hub › Area** (the tree) + **Module** (cross-cutting tools/integrations). New units pass a **light gate** (an architect agent classifies + redundancy-checks; you one-tap approve). *(ADR-0006)* |
| 7 | **Agent archetypes** | A small reusable library — **Synthesizer · Capturer/Interviewer · Ingester/Feed · Guard/Validator · Planner** — instantiated by config + prompt; custom agents only by exception and always auditable. |
| 8 | **Ops & token discipline** | Scheduling via **launchd + failure alerts**. Token-bloat is a first-class principle: summaries flow up (not raw data), lean single-purpose agents, tiered context windows, aggressive archiving, and a scheduled **hygiene sweep** (weekly light / monthly deep; archive, don't delete). |
| 9 | **Bubble map** | The map is the **home hero**, with synthesis cards below it. Bubble **size** ships with **three toggleable lenses** (needs-attention · importance×neglect two-channel · where-energy-went) plus a user default. |
| 10 | **Umbrella / integration** | **Federated independent repos + a thin umbrella.** Tempo's repo **evolves into the trunk** (`life-os`). Full-app pillars (e.g. `learning-hub`) **federate + deep-link** rather than being absorbed. Independence = **data-federation via versioned Firestore contracts.** *(ADR-0003, ADR-0007)* |

## What "done" looks like (for the life-OS itself, not this plan)

All five pillars live, each contributing a real normalized score to a weekly cross-pillar **Balance** recap that
renders on Kyle's phone; the home bubble map flexing off that Balance; the local councils running on a schedule
and writing synthesis to Firestore; and at least two existing projects (`personal-health-elt`, plus one of
`learning-hub` / `job-search-mas`) federated in through published contracts — proving the integration pattern at
scale. The full gated sequence is in `roadmap.md`.

## Scope of this engagement

This engagement produced **a plan only.** No repo was created, nothing was scaffolded, no code was written or
changed. Building begins later, one roadmap phase at a time.
