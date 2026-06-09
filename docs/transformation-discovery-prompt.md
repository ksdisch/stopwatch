---
title: Tempo → Multi-Pillar Life-OS — Transformation Discovery Prompt
surface: claude-code
archetype: explore-grounded discovery interview → phased plan (plan-only)
run-from: ~/Projects (portfolio root)
mode: optimize
created: 2026-06-07
updated: 2026-06-07
tags: [prompt, claude-code, planning, discovery]
---

# Transformation Discovery Prompt

**What this is:** a ready-to-run Claude Code prompt that turns the rambly "build a 5–6 pillar
life-OS that absorbs/integrates selected projects" idea into a coherent, professional, **phased
plan** — and stops there. It surveys your whole project portfolio (with a triage gate so it
doesn't deep-read everything), interviews you one question at a time, and writes a durable plan
doc set. It is **plan-only**: it writes no app code, creates no repos, and builds nothing.

**How to run it:**
1. Open a fresh Claude Code session at **`~/Projects/`** (the portfolio root — so it can reach all
   your repos), *not* inside the stopwatch repo. Running from the parent keeps the discovery
   neutral instead of pre-committing to "evolve Tempo in place."
2. Paste the **Full prompt** below. The session runs the interview interactively.
3. It writes the plan to `~/Projects/_kickoffs/tempo-lifeos-discovery/` and stops at your approval.
   Building the result is a separate, later, multi-session effort.

**Model & effort:** run the **main session on Opus at high reasoning, single-threaded — NOT
ultracode** (this is a judgment-heavy interview, not a parallel-execution job). Let the Phase 1
portfolio-sweep Explore subagents run on a **cheaper model (Sonnet/Haiku)** — they only
read-and-distill. Save ultracode / `/batch` for the eventual build phase.

---

## Full prompt

```text
<role>
You are my project-discovery and architecture partner. We are in ~/Projects — the root folder that holds ALL my projects (each is its own git repo; this folder itself is not a repo). I have a sprawling idea for a new "life-OS" that would absorb and integrate selected existing projects of mine. Your job is to turn my rambly ideas into a coherent, professional, phased PLAN — not to build anything. Push back on vagueness; do not rubber-stamp my ideas.
</role>

<framing>
This is a NEW parent initiative, not an in-place evolution of one repo. My PWA "Tempo" (~/Projects/stopwatch) is the most mature wellness app in my portfolio and a primary seed for the UI/data layer and feature set — but it is one integration candidate among several, not the container. Integration of any existing project is SELECTIVE and value-driven, never a wholesale carry-over mandate.
</framing>

<vision>
Organize the life-OS around 5 (maybe 6) pillars plus a "synthesizer/home" hub that routes between pillars and summarizes across them; each pillar recursively has its own local synthesizer + sub-hubs, cascading as deep as needed.
Pillars: 1) Life Building  2) Physicals (physical health/fitness)  3) Chickens (mental health — "tend your chickens")  4) Relationships  5) Growth/Learning.
Likely integration candidates to look at: stopwatch/Tempo (wellness PWA, the seed), personal-health-elt (strong fit for Physicals), plus others under ~/Projects/ such as constellation, learning-hub, job-search-mas, clinical-data-etl, Todoist_Gemini_Pipeline.
</vision>

<question_zero>
Resolve this BEFORE any structural planning — it changes everything else:
Are the "agent teams / councils / synthesizers" I describe a RUNTIME part of the system that I personally operate via Claude Code, a DEV-TIME construct that builds a shipped app whose in-app AI runs via the Claude API / a backend, or a HYBRID?
My current lean: a personal system I operate via Claude Code — a PWA (likely Tempo-derived) is the dashboard / data layer, and the "councils" are real Claude Code agents + scheduled routines that read my data, synthesize balance reports, and collaborate with me.
Pressure-test this lean honestly: surface the feasibility limits, the data-flow implications, exactly where a backend or the Claude API would still be required, what breaks if I'm away from my machine, and what a pragmatic hybrid looks like. Present the tradeoffs and get my decision before moving on.
</question_zero>

<workflow>
Phase 1 — Survey the portfolio (read-only), in two steps.
  1a. INVENTORY (cheap). List the project folders directly under ~/Projects/. SKIP _archive, _kickoffs, scratch, mini, and any non-project artifacts. For each remaining project, read only enough (README first lines, package/manifest) to produce a one-line "what it is." Present a portfolio map and FLAG the ones that look relevant to the pillars. Ask me to confirm/adjust which projects are integration candidates before going deeper.
  1b. DEEP-DIVE (only on greenlit candidates; cap at the 3–4 I most expect to integrate unless I say otherwise). Spawn read-only Explore subagents IN PARALLEL — one per candidate repo — to map its features, data model, reusability, and which pillar(s) it could plug into and how. Require each to return a DISTILLED structured summary, not file dumps, to protect context. Also note overlaps/redundancies across my projects. Synthesize a one-page current-state map before interviewing.

Phase 2 — Interview me, ONE question (or one tight cluster) at a time.
  Adaptive; use tappable options where helpful. Track locked vs. open; offer to synthesize once you have enough. Cover, roughly in order:
    a. Question Zero (resolve first).
    b. Pillar taxonomy: does "adulting/admin" (chores, renew license) belong with long-term goals / values / habits under Life Building, or split into its own pillar (the possible 6th)? Confirm 5 vs. 6.
    c. The synthesizer/home + recursive sub-hub model: what "synthesis" concretely produces at each level; what a weekly balance recap looks like.
    d. The "Balance" weighting logic: how importance/relevance is scored (the "meditated 0×, worked out 10×" example); user-set vs. derived weights; the self-improving feedback-loop idea.
    e. Data sources per pillar: established first (e.g. Apple Health), then self-defined metrics, then interview-style capture as fallback. Map gettable vs. needs-creative-capture.
    f. New-sub-area lifecycle: the approval/validation step; the taxonomy of structural units (pillar / hub / sub-area / and the "other unit" I couldn't name — help me name it); the dedicated init workflow; reusable agent archetypes/templates vs. custom ones.
    g. Selective integration of my projects, and the independence question (below).
    h. Reporting/scheduling cadence; archiving/cleanup; context/token-bloat discipline.
    i. The dynamic "bubble map" view (bubble size flexes with a pillar's current focus/weight).

Phase 3 — Umbrella & integration strategy (decide early, educate me).
  Because there is no host repo yet, settle the structure: a new umbrella repo, a monorepo-with-workspaces absorbing selected projects, git submodules, git subtree, or published versioned packages. Give plain-language tradeoffs focused on keeping a sub-project like personal-health-elt independently iterable WHILE integrated, plus a concrete recommendation. Decide with me whether Tempo is the seed of the umbrella or a tracked sub-project.

Phase 4 — Produce the plan (docs only).
  Write the plan to ~/Projects/_kickoffs/tempo-lifeos-discovery/ (do NOT create the umbrella repo or scaffold app structure). Propose exact filenames; at minimum:
    • brief.md — vision in plain language, decisions locked.
    • architecture.md — Question Zero's outcome, system shape, data flow, agent/council model, context/token-bloat strategy.
    • pillars.md — each pillar, sub-hubs, goals, metrics.
    • data-sources.md — per-pillar capture map.
    • integration-plan.md — which existing projects plug in where, redundancies to retire, and the chosen umbrella/repo strategy.
    • roadmap.md — a PHASED, explicitly multi-session build sequence with gates between phases.
    • decisions/ — ADRs for the big calls; open-questions.md for deferred items.
  Present the plan for my approval, then STOP.
</workflow>

<scope>
MUST: stay read-only across all of ~/Projects except for writing the planning docs in Phase 4 (and only after I approve their outline). Triage before deep-reading. Pressure-test my assumptions. Keep your own context lean by pushing repo-reading into Explore subagents that return distilled summaries.
MUST NOT: modify any file in ANY repo under ~/Projects; create the umbrella repo; scaffold app structure; create/modify repos, branches, or remotes; run builds or deploys; install dependencies; or begin implementation. This engagement STOPS at an approved plan.
If I say "just build it," remind me this session is plan-only and that building is a separate, later, multi-session effort (likely /batch or an ultracode workflow).
If the session runs long, offer /handoff to emit a clean resume prompt.
</scope>

<definition_of_done>
A reviewed, approved set of planning docs in ~/Projects/_kickoffs/tempo-lifeos-discovery/ that resolves Question Zero, sets the pillar taxonomy, defines the synthesizer + balance model, maps data sources, chooses the umbrella/integration strategy, and sequences a phased multi-session build roadmap — with an open-questions log. No code written, no repos created.
</definition_of_done>
```

---

## Quick prompt

```text
From ~/Projects (my projects root, containing all my repos), act as my planning partner — turn my rambly idea (a new 5–6 pillar "life-OS" with a synthesizer/home hub that absorbs/integrates selected projects) into an approved, phased PLAN only. (1) Inventory all projects cheaply, show me a map, and have me confirm integration candidates BEFORE deep-reading; then spawn read-only Explore subagents (cheaper model) on the greenlit ones (cap 3–4). (2) Resolve Question Zero first: are the "agent councils/synthesizers" a runtime system I operate via Claude Code (my lean), a dev-time tool for a shipped PWA whose AI is API/backend, or hybrid? — pressure-test it, don't agree by default. (3) Interview me one question at a time (pillar taxonomy, balance-weighting, data sources, new-area lifecycle, selective integration, repo strategy, reporting/cleanup, bubble-map). (4) Decide the umbrella/repo strategy with me. (5) Write the plan docs to ~/Projects/_kickoffs/tempo-lifeos-discovery/ and STOP at my approval. MUST NOT modify any repo, create the umbrella repo, scaffold, or build.
```

---

## Design notes

- **Run from the portfolio root, not inside Tempo.** Standing inside the stopwatch repo anchors the plan toward "evolve Tempo in place" — one of the very questions still open. The neutral vantage lets the identity question (new umbrella vs. Tempo-evolved) be answered honestly.
- **Triage gate before deep-reading.** Phase 1a inventories cheaply and makes *you* confirm candidates; only then does Phase 1b deep-dive (capped at 3–4). Without this, "explore all my projects" silently becomes "deep-read 20 repos" → context blowup and boil-the-ocean (the original draft's failure mode).
- **Plan-only by hard rule.** No code, no repos, no scaffolding. Building is a later multi-session effort (likely `/batch` or an ultracode workflow).
- **Question Zero up front.** Runtime-vs-dev-time architecture is the hinge; the prompt resolves and *pressure-tests* it before structural planning (stated lean: a personal Claude-Code-operated system).
- **Selective integration**, not wholesale carry-over.
- **Neutral home for output:** `~/Projects/_kickoffs/tempo-lifeos-discovery/`, since no host repo exists yet and we're not scaffolding one this session.
- **Model/effort:** Opus + high reasoning, single-threaded (not ultracode); cheap subagents for the portfolio sweep.
```
