# Tempo Life-OS — Data Sources

**Status:** Approved · **Date:** 2026-06-08

The capture model has **three tiers**, used in priority order:

1. **Tier 1 — Established / automatic.** Already gettable, low friction (Apple Health, the health marts, Todoist,
   DogHood's Supabase, the learning-hub store, Tempo's own logs).
2. **Tier 2 — Self-defined.** Metrics Kyle defines and captures semi-structured (mood scale, energy rating, the
   finance numbers, a values check).
3. **Tier 3 — Interview-capture.** The fallback for what has no sensor (relationship depth, sense of purpose).

**Tier-3 interview-capture *is* the weekly collaboration ritual** — it is not a separate chore. During the Monday
session, the home/pillar councils ask questions, Kyle answers in natural language, and the Capturer archetype
parses the answers into the structured metrics that feed Balance. One ritual, double duty.

---

## Per-pillar capture map

| Pillar | Tier 1 — automatic | Tier 2 — self-defined | Tier 3 — interview | Biggest gap |
|---|---|---|---|---|
| **Physicals** | health-elt marts (HRV/RHR/load/sleep) via Firestore; Apple Health; Tempo meds + exercise logs | energy / soreness rating | "how's the body feeling?" | — *(richest pillar)* |
| **Chickens** | BFRB stream, Flow/Mindful/Pomodoro sessions, sleep + HRV as stress proxies | **mood / affect log → build** | weekly "how are your chickens?" | **mood capture** |
| **Relationships** | DogHood (visits, meetups, social graph) | "people I tend" list + context cards | "who did you connect with / who's drifting?" | **most under-instrumented** |
| **Growth/Learning** | learning-hub (mastery, attempts, streaks, reflections); Tempo focus analytics | reading log, skill milestones | "what did you learn / want to?" | — *(strong)* |
| **Life Building** | Todoist (admin/tasks), calendar deadlines, job-search-mas (career) | habit streaks (Tempo), **finance metrics**, values check | values + goals reflection | **finances** |

## Gettable today vs. needs creative capture

- **Mostly automatic (build = wire it up):** Physicals, Growth/Learning, and the admin/career slices of Life
  Building.
- **Needs creative capture (build = design the capture):**
  - **Chickens → mood/affect** (Tier 2 — Tempo has no mood logging today; design a fast daily capture).
  - **Relationships** (Tier 2/3 — the people-list + context cards + weekly reflection; DogHood is only a sliver).
  - **Life Building → Finances** (Tier 2 — manual; see below) and **Values/Goals** (Tier 3 reflective).

## Finances (Life Building sub-hub) — manual-first

**Decision:** manual key metrics in v1, **no aggregator.** This aligns with the local-first runtime (an
aggregator like Plaid would require a backend + recurring cost + a large financial-privacy surface — exactly what
v1 avoids). Kyle updates a few numbers ~monthly, by hand or via the weekly interview:

- savings rate / amount, credit score, debt paydown, net worth.

These are enough to drive Balance and goal-tracking without a financial-data firehose. Auto-aggregation is parked
in `open-questions.md` as a possible later phase.

## Relationships — the "people I tend" model

A light list of the people who matter (Marlee, family, a few close friends). Each entry carries:

- **last meaningful contact** + an intended cadence (to catch drift),
- a **context card** — the concierge layer: saved restaurants / date-night ideas (for Marlee), gift ideas, what
  they're going through, things they've mentioned wanting. Brainstormed examples Kyle raised: restaurant lists and
  date-night ideas "to have on hand for Marlee," and analogous useful context for other loved ones.

The council uses the cards **proactively** (surfacing relevant context ahead of a planned connection), not just
reactively. This is deliberately **not** a full per-interaction CRM (rejected as transactional/creepy for intimate
relationships); it's the light middle path.

## Privacy posture

- Health data stays local (Postgres in Docker); only the small `recovery_state` mart egresses to Firestore (Kyle's
  own project). This is `personal-health-elt`'s existing, intentional design.
- **No scraping of messages/call logs** for the Relationships pillar — capture is self-report + the DogHood feed.
- Finance data is hand-entered, local, and minimal in v1.
- Firestore access is scoped to Kyle's own auth UID (Tempo's existing rules model).
