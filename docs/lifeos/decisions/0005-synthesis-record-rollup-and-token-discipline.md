# ADR-0005 — Synthesis-record model, 3-level roll-up, token discipline

**Status:** Accepted · **Date:** 2026-06-08

## Context

The system is recursive (pillars → hubs → areas), with constant logging/reporting passed "up the chain." Kyle also
stressed **vigilant token/context-bloat discipline** so agents stay laser-focused. These two needs are solved by
one design choice.

## Decision

**Every synthesizer node emits one small structured *synthesis record*; parents read their children's records,
never the children's raw data.**

Record shape (final field names fixed in build P0):

```jsonc
{ "node": "physicals/sleep", "window": "2026-06-01..2026-06-07",
  "state": { "band": "strained", "score": 38 },
  "headline": "…", "signals": ["…top-N…"], "nudges": [{ "text": "…", "priority": 1 }],
  "provenance": { "sources": ["…"], "coverage": 0.8 }, "confidence": "high" }
```

**Roll-up is 3 levels:** Area → Hub/pillar → Home. Synthesis is **retrospective and prospective** (recap + propose).
Cadence: **daily glance** (passive cards) + **weekly collaboration** (active planning session). `confidence`/
`coverage` let a parent down-weight thin-data children.

**Token-discipline is a first-class principle**, realized by five mechanisms: (1) summaries flow up, raw data
doesn't; (2) lean single-purpose agents; (3) tiered context windows (daily = today only; weekly = pillar records
+ 1 week; deep on demand); (4) aggressive archiving of resolved nudges/old records/stale units; (5) a scheduled
hygiene sweep (adapting `trim-context`).

## Alternatives considered

- **Parents re-read children's raw data** — rejected: exactly the context-bloat Kyle wants to avoid; doesn't scale
  recursively.
- **One monolithic synthesizer over everything** — rejected: unfocused, token-heavy, not recursive.
- **Weekly-only or daily-active cadence** — rejected in favor of daily-glance + weekly-collaboration (mirrors the
  proven `mas` "nightly run → morning review" rhythm).

## Consequences

- The record schema is a **contract** on the Firestore spine (ADR-0003).
- "Checks and balances / discard non-useful info" are realized via top-N signal capping + confidence/coverage
  flags + archiving — structurally, not as bolt-ons.
- The hygiene sweep runs weekly light / monthly deep; **archive, don't delete**.
