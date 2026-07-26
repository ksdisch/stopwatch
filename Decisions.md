# Decisions

> **Authoritative decision records live in the two ADR sets:** `docs/adr/` (repo technical ADRs 0001–0009) and `docs/lifeos/decisions/` (Life-OS ADRs 0001–0007). This table is append-only and records project-direction decisions **not** captured as an ADR, plus pointers to the pivotal ADR calls. New durable technical decisions should still become ADRs (`/adr-new`-style), then get a pointer row here only if project-shaping.

| ID | Decision | Status | Date | Source/Rationale |
|----|----------|--------|------|-----------------|
| D1 | Evolve the `stopwatch` repo in place into the Tempo Life-OS trunk; sibling repos stay independent and federate via published Firestore marts (no monorepo) | Approved | 2026-06-08 | `docs/lifeos/decisions/0003-federated-repos-evolve-tempo-as-trunk.md` |
| D2 | Agent councils are local-first: Claude Code + launchd on Kyle's Mac write distilled synthesis records to Firestore; the PWA renders from cache | Approved | 2026-06-08 | `docs/lifeos/decisions/0001-local-first-council-runtime.md` |
| D3 | Branch protection on `main`: PRs only, all 7 CI checks required, `enforce_admins` on, repo auto-merge enabled | Approved | 2026-07-19 | `docs/SESSION-LOG.md` (Arc A ②a); closes the flow-vibrate direct-push incident path |
| D4 | Arc A ① (finances close-out) parked by Kyle — nightly council will pick up July numbers whenever entered; backlog row #22 stays un-flipped until then | Approved | 2026-07-19 | `docs/SESSION-LOG.md` 2026-07-19 |
