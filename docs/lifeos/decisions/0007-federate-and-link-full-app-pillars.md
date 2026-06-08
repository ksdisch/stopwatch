# ADR-0007 — Federate + deep-link full-app pillars

**Status:** Accepted · **Date:** 2026-06-08

## Context

The trunk shell is the evolved Tempo: **vanilla JS, no build step, Firestore.** But some pillars are already full
applications on different stacks — notably `learning-hub` (React + FastAPI + SQLite, with its own rich skill
ecosystem). This creates a real fork: absorb such an app into the vanilla-JS shell, or keep it standalone?

## Decision

**Federate + deep-link** full-app pillars. A full-app pillar:

1. **stays its own app + repo** (unchanged stack);
2. **publishes a summary mart** to the Firestore spine (so the home synthesizer + bubble map can use it);
3. is reached via a **deep-link** from the home for the full experience.

This makes the life-OS a **"hub of hubs":** lightweight pillars render **natively** inside the Tempo shell; heavy
full-app pillars are **federated**. The home treats both identically because **both publish a synthesis record to
the spine, regardless of the stack that rendered them.**

## Alternatives considered

- **Absorb / rebuild into Tempo** — rebuild `learning-hub` as a native vanilla-JS pillar for one uniform app.
  Rejected: discards a working React/FastAPI app + its skill ecosystem, is a large rebuild, and re-poses the same
  choice for the next full-app pillar.

## Consequences

- Resolves the Tempo-vs-learning-hub stack tension without a rebuild.
- The only new work for a federated pillar is its **published summary contract** (a roadmap P4 task for
  `learning-hub`).
- Sets a reusable rule for future pillars: *lightweight → native; full app → federate + deep-link.*
- Consistent with ADR-0003 (data-federation) and ADR-0005 (everything publishes a synthesis record).
