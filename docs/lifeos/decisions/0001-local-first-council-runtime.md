# ADR-0001 — Local-first council runtime (Question Zero)

**Status:** Accepted · **Date:** 2026-06-08

## Context

The foundational question ("Question Zero") was whether the "agent councils/synthesizers" are a **runtime** Kyle
operates via Claude Code, a **dev-time** construct that ships an app whose in-app AI runs via the Claude API/a
backend, or a **hybrid**. This decision shapes everything else: data flow, where compute lives, and what breaks
when Kyle is away from his machine.

The portfolio gave real evidence rather than speculation:

- **`job-search-mas`** already runs the exact pattern Kyle described — a nightly launchd job that drives Claude
  Code (`claude -p`) over his data, with folders-as-state and human review gates. It has run in production for
  6+ weeks. It is **fully local** and cannot run headless/remote without a `claude` server sidecar, and it fails
  *silently* if CLI auth drifts.
- **`personal-health-elt`** shows the other patterns: a scheduled data pipeline (Prefect cron) plus an in-app
  "Ask" page that calls the Anthropic API directly.
- **Tempo** is a pure client-side PWA + Firestore — a data/dashboard layer with no AI runtime of its own.

## Decision

Adopt a **local-first hybrid**, layered into three tiers:

1. **Dashboard/data layer (anywhere):** the Tempo PWA reads synthesis and captures data on any device.
2. **Council runtime (local):** synthesizers run as Claude Code agents + launchd routines on Kyle's Mac and
   **write their output back to Firestore.**
3. **On-demand/remote AI (deferred):** triggering/conversing with a council from the phone — requires a backend or
   a `claude` sidecar; **not in v1.**

The keystone: councils **write synthesis to Firestore**, so the *output* is readable anywhere even though the
*intelligence* is tethered to the Mac.

## Alternatives considered

- **Local + thin cloud trigger** — add a minimal backend now so synthesis can be triggered/queried from the phone.
  Rejected for v1: adds always-on infra, cost, and a second AI path to maintain from day one. Parked as deferred.
- **Full shipped-app backend** — server-side app with in-app AI via the Anthropic API. Rejected: most infra/cost,
  furthest from Kyle's Claude-Code-operated vision, over-built for a single user.

## Consequences

- **Mandatory:** failure alerting (Slack/SMS) on council runs — silent failure is the #1 risk (per `mas`).
- Scheduled councils only fire while the Mac is on; no remote trigger/chat in v1.
- The Firestore "write synthesis back" pattern becomes load-bearing and is specified in `architecture.md` §1, §3.
- Reuse the `job-search-mas` launchd harness rather than inventing one.
