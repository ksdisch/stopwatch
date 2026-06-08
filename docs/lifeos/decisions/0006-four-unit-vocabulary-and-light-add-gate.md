# ADR-0006 — Four-unit vocabulary + light add-gate

**Status:** Accepted · **Date:** 2026-06-08

## Context

Kyle had an informal vocabulary (pillar / hub / sub-area) and an "other unit I couldn't name." He also wanted an
agent-led approval/validation step before a new thing is created, plus reusable agent archetypes for consistency
and repeatability. Two pieces were actually missing, which is why it felt slippery: the *leaf* unit, and the
*plugged-in tool* unit.

## Decision

**Four structural units:**

- **Pillar** — a top-level life domain (the five). Synthesizes; fixed set.
- **Hub** — a recursive container with its own local synthesizer that routes to children; can nest.
- **Area** — *the previously-unnamed leaf:* one coherent trackable thing that produces a metric/state but has no
  council of its own. Hubs roll up Areas.
- **Module** — a cross-cutting plugged-in tool/integration/skill that *feeds* Areas (a repo, a feed, a skill); one
  Module can feed several Areas across pillars.

`Pillar › Hub › Area` is the organizational tree; **Module** is the orthogonal capability layer (this is how the
existing repos relate to pillars). Names are placeholders — rename freely before P0.

**New-unit lifecycle (light gate):** *propose → classify → spec → init/scaffold → trial.* An architect agent
classifies (Hub? Area? Module? fold-in?) with a redundancy + Balance-distortion check; **Kyle one-tap approves**;
the init workflow scaffolds it. The heavier "trial → keep/merge/archive" rigor runs as part of the periodic
hygiene sweep, **not** as friction on every addition.

**Agent archetypes (reusable library):** Synthesizer · Capturer/Interviewer · Ingester/Feed · Guard/Validator ·
Planner — instantiated by config + prompt; custom agents only by exception and always able to cite why they exist.

## Alternatives considered

- **Three units (tools are just Areas)** — rejected: blurs life-domain vs. software and gets awkward when one tool
  feeds several pillars (e.g. Apple Health touches Physicals *and* Chickens).
- **Keep it loose / don't formalize Module** — rejected: the init workflow needs something to stand on.
- **Structured up-front gate (audit + trial on every add)** — rejected: too much ceremony for small additions.
- **Fully manual classification** — rejected: no automated redundancy/balance check.

## Consequences

- The init workflow and archetype library are a roadmap phase (P6).
- Modules integrate via contracts (ADR-0003); the architect agent's redundancy check guards against unit sprawl.
