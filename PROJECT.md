# PROJECT.md

## Purpose
Tempo is a vanilla-JS, no-build-step PWA (stopwatch/timers + wellness tracking with cross-device Firestore sync, web + Capacitor iOS) that is being evolved **in place** into the trunk of the five-pillar **Tempo Life-OS** (Home synthesizer + Life Building, Physicals, Chickens, Relationships, Growth pillars).

## Scope
**In scope (current phase):**
- Life-OS trunk build per `docs/lifeos/roadmap.md` — next unbuilt phases: P4 (federate Growth + Career via published Firestore marts), P6 (unit lifecycle + archetype library), P7 (feedback loop + polish)
- Arc A ③: doctor-ready report slice (Personal Health Hub export) — kicked to its own `/autonomous-milestone` run per `docs/SESSION-LOG.md` 2026-07-19
- Backlog menu items in `docs/BACKLOG.md` (Med Runway, BFRB Slice B debrief remainder, etc.)

**Out / deferred / never:**
- App Store distribution ($99 Apple Developer Program + privacy labels) — explicitly deferred
- HealthKit two-way bridge — sequenced later (after intelligence loop proves out)
- Home-screen widgets / Siri shortcuts — noted under backlog #4 follow-ups, unpursued
- Merging sibling repos (personal-health-elt, home-base/learning-hub, DogHood, job-search-mas) into this repo — never; federation is by published data feeds only (`docs/lifeos/decisions/0003`)

## Current status
**Active.** Daily-driver production app for Kyle; mid-way through the Life-OS build. Guardrails trio landed 2026-07-19 (branch protection on `main` with 7 required CI checks, read-only permission allowlist, CLAUDE.md trim) plus a gitleaks secret-scan gate (#217). Life-OS: P0 gate passed 2026-06-08, P3 gate passed 2026-06-12; hub modules for P1 (Home), P2 (Physicals), P3 (Chickens), and P5 (Life Building incl. finances capture, shipped 2026-07-08) exist in `js/`; P4 not started. Note: external/kickoff docs describing the Life-OS as "plan approved, build not started" are a stale 2026-06-08 snapshot — see `Wiki/lifeos-status.md` for the reconciliation.

## Next actions
1. Kyle enters July finance numbers at `#/life-building` → nightly council picks them up → fresh session verifies + flips backlog row #22
2. Run Arc A ③ (doctor-ready report slice) as its own `/autonomous-milestone` session
3. Clear the parked device-confirm queue (one ~20-min phone session)

## Boundaries
- **No build step, ever** — script-tag order in `index.html` is the dependency graph (`docs/adr/0001`)
- Service-worker `CACHE_NAME` must be bumped on every PR that changes a cached file (hard convention in `CLAUDE.md`)
- Firestore on Spark plan, doc-level CAS only, no joins — vendor-lock tradeoff documented in `docs/sync-review/BACKEND-SELECTION.md`
- Branch protection: no direct pushes to `main`; all 7 CI checks required; land PRs with `gh pr merge --auto --squash`
- iOS runs on free-tier Apple ID signing (7-day cert refresh); single-user (Kyle), not a commercial product
- All synced-store writes go through `js/schema.js` stamping; sync-touching PRs follow the sync-auditor flow in `.claude/orchestrator.md`
