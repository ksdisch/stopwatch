# ADR-0002 — Five pillars; admin is a Life Building sub-hub

**Status:** Accepted · **Date:** 2026-06-08

## Context

Kyle's open taxonomy question: "Life Building" was originally conceived as "adulting" (chores, renew license), but
he also wanted it to hold the *big* strategic things (values, long-term goals, habits, finances, delayed
gratification). Those felt mismatched in scope — so should admin/adulting be its own (sixth) pillar, or live with
the strategic material under one pillar?

## Decision

**Five pillars.** Admin/adulting is **not** a sixth pillar — it is a **sub-hub of Life Building**, which is
reframed as Kyle's most *strategic* pillar with a top-to-bottom stack:

> Values → Goals → Habits/Routines → Finances → Admin/Logistics

The five pillars: **Life Building, Physicals, Chickens (mental health), Relationships, Growth/Learning.**

## Rationale (the deciding lens)

The top-level pillars are exactly what the **Balance** engine weighs against each other, so they must be
**commensurable life-domains of similar existential weight.** If "Admin" were a peer pillar, Balance could report
*"you did 8 errands but only 1 mental-health act — balanced!"* — a false reading, because errands are not the same
currency as tending one's mental health. Admin therefore must not sit at the top level. The recursive sub-hub
model solves the original tension: admin becomes a first-class sub-hub (its own synthesizer + Todoist/calendar
feed + real visibility) without inflating the pillar count or distorting Balance.

## Alternatives considered

- **Six pillars (Admin its own top-level pillar)** — rejected: distorts Balance (trivial-but-urgent competes with
  existential domains) and crowds the top-level map.
- **Five pillars + a cross-cutting Tasks/Obligations plane** (admin as a horizontal layer the home routes per
  task) — elegant and noted as a possible *evolution* of the sub-hub, but more abstract/more to build; not chosen
  for v1.

## Consequences

- Life Building is the "strategic" pillar, not the chore drawer; its sub-hubs are Values/Goals/Habits/Finances/
  Admin (`pillars.md` §1).
- The other four pillars are locked in name and scope.
- Career (job search) lives as a *temporary* sub-hub under Life Building and archives when Kyle is employed.
