# ADR-0003 — Federated repos + thin umbrella; evolve Tempo into the trunk

**Status:** Accepted · **Date:** 2026-06-08

## Context

There is no host repo yet (`~/Projects` is not a repo; each project is its own repo). The portfolio is polyglot
and multi-runtime (vanilla-JS Tempo, Python `personal-health-elt`, React/FastAPI `learning-hub`, Expo `DogHood`).
Kyle explicitly wants to keep iterating a sub-project like `personal-health-elt` **independently** while it's
integrated — without shared merges/PRs across everything.

The deciding insight: integration **already happens at the data layer, not the code layer.** Tempo and
`personal-health-elt` are integrated today via a shared **Firestore contract**, not a shared repo. This is a
data-federation problem, not a codebase-merge problem.

## Decision

**Federated independent repos + a thin umbrella**, and **Tempo's repo evolves into the trunk** (`life-os`).

- The trunk holds: the PWA shell, native lightweight-pillar dashboards, the local council code, the integration
  **contracts** (Firestore schemas), and the planning docs.
- Every other project stays its own repo + lifecycle and **publishes a versioned feed** to the Firestore spine.
- Genuinely shared *code* (if any) may become a published package — selective, not the backbone.

Tempo becomes the trunk (not a tracked sub-project) because the shell *is* the evolved Tempo (proven sync, 918
tests, extensible nav); bootstrapping a new shell would discard that for no data-layer benefit.

## Alternatives considered

- **Monorepo + workspaces** — assumes a shared language/build; fights the polyglot reality, couples independent
  deploys, and re-introduces the cross-everything merge burden Kyle wants to avoid.
- **Git submodules** — nests sub-repos by pinned commit; fiddly, and implies the umbrella builds *from* their
  code, but integration is via data. Friction without payoff.
- **Git subtree** — vendors sub-repo code into the umbrella — exactly the shared-merge burden to avoid.
- **Published packages as the backbone** — right idea, wrong layer; most sharing is data, not code.
- **New umbrella repo with Tempo tracked** — cleaner separation but relocates/rebuilds the shell for no benefit.

## Consequences

- Independence is preserved by **contracts**: iterate behind a contract freely; changing a contract is the one
  gated act (its tests + consumer coordination). See `integration-plan.md` §5.
- The `stopwatch` repo is grown in place into `life-os`; existing tests/sync are retained.
- The system is a "hub of hubs" — see ADR-0007 for how full-app pillars attach.
