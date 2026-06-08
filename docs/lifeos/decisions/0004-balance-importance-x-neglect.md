# ADR-0004 — Balance = Importance × Neglect

**Status:** Accepted · **Date:** 2026-06-08

## Context

The home synthesizer must weigh pillars against each other to detect imbalance. Kyle's shorthand was activity-
counting ("meditated 0×, worked out 10× → bump mental health"). Taken literally that breaks in four ways:
(1) activities aren't one currency (10 workouts ≠ 1 therapy session); (2) balance ≠ equal (a deliberate hard
season is often correct); (3) counts have no reference (0 is only bad relative to a target); (4) neglect
compounds over time.

## Decision

**Priority = Importance × Neglect**, computed on a **normalized per-pillar health score** (not raw counts):

- **Currency:** each pillar's `state.score` (from its synthesis record), computed *relative to that pillar's own
  target/baseline* — so pillars are comparable without comparing apples to oranges.
- **Importance(p):** **user-set**, slow-moving (encodes Kyle's values; revised quarterly / on life changes).
- **Neglect(p):** **derived** — time-decayed accumulation of how far the pillar's score has run below its target.
- **Priority(p) = Importance(p) × Neglect(p)** ranks what the home surfaces and how the bubble map flexes.

**Self-improving feedback loop (modest):** the council auto-tunes **nudge wording/timing** from nudge→outcome
tracking, but any change to **Importance weights or targets** is **proposed for human approval** — never applied
automatically.

## Rationale

This realizes Kyle's intuition while fixing all four failure modes: relative-to-target (not counts), time-decayed
(not snapshot), and respectful of consciously-set priorities (a down-weighted pillar stays quiet even when
neglected; a deliberate career season isn't nagged).

## Alternatives considered

- **Raw activity counts** — rejected (the four failure modes above).
- **Fully-derived weights** (no user-set Importance) — rejected: can misread a deliberate push as imbalance; less
  user control.
- **Fully manual each cycle** — rejected: becomes a chore; loses the "notices the drift you can't" value.
- **Fully-automated self-tuning of weights** — rejected: opaque, and risks optimizing a proxy (e.g. engagement)
  and silently drifting from Kyle's real values.

## Consequences

- Every pillar must define **targets/baselines** so `Neglect` has a yardstick (authored per-pillar in P2+).
- The home keeps a small **nudge-efficacy table** (low-stakes learning) and a **weight-change proposal** flow
  (human-approved). Built in roadmap P7.
