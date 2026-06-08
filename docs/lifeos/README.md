# Tempo Life-OS — Discovery & Plan

**Status:** Plan approved (discovery complete) · **Date:** 2026-06-08 · **Stage:** plan-only, no code written

This folder is the **approved planning output** for evolving the Tempo wellness PWA (`~/Projects/stopwatch`)
into a personal **life-OS** organized around five life pillars plus a cross-pillar "home" synthesizer.

It is a **plan, not an implementation.** No umbrella repo has been created, nothing has been scaffolded,
and no source code has been written or changed. Building is a separate, later, explicitly multi-session
effort (see `roadmap.md`).

---

## How to read this

Read in this order:

1. **`brief.md`** — the vision in plain language and the full list of locked decisions. Start here.
2. **`architecture.md`** — how the system is shaped: the runtime model, the federated "hub of hubs,"
   the Firestore data spine, the synthesis-record model, the Balance engine, the agent/council model,
   and the token-discipline strategy.
3. **`pillars.md`** — the five pillars, their hubs and Areas, goals, and metrics.
4. **`data-sources.md`** — where each pillar's data comes from (the three-tier capture model).
5. **`integration-plan.md`** — how the existing projects plug in, which redundancies retire, and the
   umbrella/repo strategy that keeps each sub-project independently iterable.
6. **`roadmap.md`** — the phased, gated, multi-session build sequence.
7. **`decisions/`** — Architecture Decision Records (ADRs) for the big calls, with alternatives + consequences.
8. **`open-questions.md`** — everything deliberately deferred.

## The one-paragraph summary

The life-OS is the **evolved Tempo PWA acting as a "home" shell** that routes between and summarizes across
five pillars — **Life Building, Physicals, Chickens (mental health), Relationships, Growth/Learning** — with a
cross-pillar **synthesizer** that produces a weekly **Balance** recap and daily nudges. The "agent councils" are
**local-first**: Claude Code agents + scheduled (launchd) routines that run on Kyle's Mac, read his data, write
distilled synthesis back to **Firestore**, which the PWA reads anywhere. Existing projects
(`personal-health-elt`, `learning-hub`, `DogHood`, `job-search-mas`) stay **independent repos** and integrate by
**publishing versioned data feeds** to the shared Firestore spine — not by merging code. This is data-federation,
not a monorepo.

## When you're ready to build

Hand `roadmap.md` Phase 0 to a fresh build session (a `/batch` run or an ultracode workflow). Each roadmap phase
is sized to be its own session with an explicit gate before the next begins.

---

## Relocation note (relocated source-of-truth)

> **This folder is the relocated source-of-truth for the Tempo Life-OS plan.**
> Copied into the trunk repo (`~/Projects/stopwatch`, the evolving `life-os`) on **2026-06-08**
> from the original discovery folder at `~/Projects/_kickoffs/tempo-lifeos-discovery/`.
>
> Per **ADR-0003** (`decisions/0003-federated-repos-evolve-tempo-as-trunk.md`), the trunk holds the
> integration **contracts** and the planning docs, so the single source of truth **travels with the
> repo** — it is versioned alongside the code it governs and reaches cloud/web sessions and
> collaborators who never see `~/Projects/_kickoffs/`.
>
> The `_kickoffs/tempo-lifeos-discovery/` copy is the **historical original** (the kickoff archive); this
> in-repo copy is now **canonical**. Make all further edits here. The Firestore integration contracts
> derived from these docs live one level up in [`../contracts/`](../contracts/) — see
> [`../contracts/synthesis-record.md`](../contracts/synthesis-record.md) and
> [`../contracts/pillar-feed.md`](../contracts/pillar-feed.md).
