# Tempo Life-OS — Integration Plan

**Status:** Approved · **Date:** 2026-06-08

How the existing portfolio plugs into the life-OS, which redundancies retire, the umbrella/repo strategy, and the
mechanism that keeps each sub-project independently iterable while integrated.

---

## 1. The core insight

Integration in this portfolio **already happens at the data layer, not the code layer.** Tempo and
`personal-health-elt` are integrated *today* without sharing a repo — they share a **Firestore contract**. So the
umbrella problem is a **data-federation** problem, not a "merge five codebases" problem. That is what makes the
chosen structure (federated repos + a thin umbrella) the right fit and rules out a monorepo. (See `decisions/0003`.)

## 2. Per-project integration modes

| Project | Role | Pillar | How it plugs in | Repo status |
|---|---|---|---|---|
| **stopwatch / Tempo** | **Trunk / shell** | spans all | *is* the umbrella (evolves into `life-os`) | evolves in place |
| **personal-health-elt** | **Module** | Physicals | publishes `recovery_state` mart → Firestore (already live) | independent |
| **learning-hub** | **Federated sub-app** | Growth/Learning | publishes a "Growth summary" mart + home deep-links into it | independent |
| **DogHood** | **Module** | Relationships | publishes a visits/social feed (from Supabase) → ingested | independent (mobile) |
| **job-search-mas** | **Module** | Life Building / Career | publishes career state; also the *runtime precedent* for councils | independent |
| **constellation** | activity only | Relationships | logged manually as a connection event — **not** integrated | standalone |
| **clinical-data-etl** | reference | Life Building / Growth | cited as a career achievement; **not** a data feed | standalone |
| **snowflake-econ-dashboard** | reference | Life Building / Growth | cited as a career achievement; **not** a data feed | standalone |

Notes from the deep-dives:

- **`personal-health-elt`** is the **exemplar** of integrate-but-iterate-independently: it is a standalone
  portfolio-grade repo that publishes one versioned, contract-tested mart (`users/{uid}/recovery_state/{latest,
  history}`) on a weekly cron (or on demand). Tempo already consumes it. Nothing about the life-OS changes how it's
  built; the life-OS just reads the existing feed.
- **`learning-hub`** is a full React/FastAPI/SQLite app with its own rich skill ecosystem. Rebuilding it inside the
  vanilla-JS Tempo shell would throw away working software, so it **federates + deep-links** (`decisions/0007`).
- **`DogHood`** is mobile (Expo) but its Supabase Postgres/PostGIS backend is cloud-queryable, so the platform
  mismatch is *not* a blocker — the life-OS ingests its `presences`/`invites` data (live via Realtime or batch
  export). It is the only *real* automatic feed the Relationships pillar gets.
- **`job-search-mas`** does double duty: it's the Career feed *and* the production precedent proving the local-first
  council runtime (launchd + `claude -p` + folders-as-state + human gates).
- **`constellation`** has no persistence and emits no data; its value is the shared experience, so it's logged as
  an activity, not wired in.

## 3. Redundancies to retire / consolidate

- **The career cluster** — `job-search-mas` (execution), `job-search-toolkit` (data/aggregation), `bridge-work`
  (gig/part-time income), `Todoist_Gemini_Pipeline` (task AI) — collectively map to **one** Life Building → Career
  (+ Admin) sub-hub. Recommendation: **`job-search-mas` is the integration point** (it already orchestrates and can
  read the others' outputs); the rest feed it or feed Admin, rather than each wiring into the life-OS separately.
- **Career is temporary.** When Kyle is employed, the Career sub-hub and its feeds should **archive** (the hygiene
  sweep can flag this). The life-OS is permanent; the job search is a season.
- **`clinical-data-etl` + `snowflake-econ-dashboard`** are résumé/portfolio builds, not personal-life feeds. They
  are **referenced as achievements** in Life Building/Growth, not integrated. (Primary pillar is semantics — career
  work can legitimately surface in both Life Building and Growth.)

## 4. Umbrella / repo strategy

**Chosen: federated independent repos + a thin umbrella; Tempo's repo evolves into the trunk.** (Alternatives —
monorepo, submodules, subtree, packages — and why they were rejected are in `decisions/0003`.)

- **The trunk** (`life-os`, grown from `stopwatch`) holds: the PWA shell, the native lightweight-pillar dashboards,
  the local council code, the **integration contracts** (Firestore schemas), and these docs.
- **Each federated project** keeps its own repo and lifecycle and publishes a feed to the spine.
- **Shared *code*** (if any genuinely emerges — e.g. a common metric-definition lib) can be a **published package**;
  but most sharing is *data*, so packaging is selective, not the backbone.

## 5. The independence mechanism (data-federation via versioned contracts)

This is the answer to "can I keep iterating `personal-health-elt` independently while it's integrated?" — **yes**,
and it's a standard professional pattern (service / data-mesh federation):

1. Each Module **owns its repo** and an internal data model nobody else sees.
2. It **publishes a versioned feed** (a "mart") to the spine — a thin, documented, **contract-tested** interface.
3. Consumers (the life-OS home + pillar synthesizers) read **only the published feed**, never the Module's
   internals.
4. **Iterating behind the contract is free** — add loaders, metrics, pages, refactors with zero coordination.
5. **Changing the contract is the one gated act** — update its contract tests and coordinate producer + consumers.
   `personal-health-elt` already enforces exactly this (a `guard-mart-contract` hook + dbt `accepted_values`/
   `unique` tests on `mart_recovery_state`).

The result: no shared pull requests or merges across the life-OS, no monorepo lockstep — just a small number of
stable contracts on the Firestore spine.

## 6. What the life-OS must *not* do to a sub-project

- Don't fork or vendor a Module's code into the trunk.
- Don't reach past a contract into a Module's internal tables/state.
- Don't require a Module to adopt the trunk's toolchain.

Each of these would re-introduce the coupling the federation model exists to prevent.
