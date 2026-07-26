# Sources

| Source | Location | Type | Authoritative for |
|--------|----------|------|-------------------|
| CLAUDE.md (lean core) | `CLAUDE.md` | reference | Current architecture file-map, state model, hard conventions (cache-bump rule, script order) |
| Architecture deep-dive | `docs/ARCHITECTURE.md` | design doc | Module layering, engine model, persistence topology, sync component view, platform seam |
| Repo ADRs | `docs/adr/` (0001–0009) | ADRs | Foundational technical decisions (no-build, drift-free timing, Firestore backend, per-store merge, Capacitor, etc.) |
| Life-OS plan (relocated source-of-truth) | `docs/lifeos/` | brief / spec / roadmap / ADRs | The Life-OS vision, five pillars, federation architecture, phased roadmap, decisions 0001–0007. **Status headers are a stale 2026-06-08 "plan-only" snapshot — see `Wiki/lifeos-status.md`** |
| Life-OS kickoff archive | `~/Projects/_kickoffs/tempo-lifeos-discovery/` | brief / archive | Original discovery output; superseded by `docs/lifeos/` per its relocation note |
| Data dictionary | `docs/reference/data-dictionary.md` | reference | Every persisted key / store / field |
| Glossary | `docs/reference/glossary.md` | reference | F-numbers, stage codes, project vocabulary |
| Backlog | `docs/BACKLOG.md` | backlog | Full feature backlog, shipped post-mortems, Parked/Retired history |
| Build history | `docs/BUILD-HISTORY.md` | history | Chronological build record |
| Session log | `docs/SESSION-LOG.md` + `docs/session-logs/` | log | What happened in each work session; most recent state claims |
| Cloud-sync strategy | `docs/CLOUD-SYNC-STRATEGY.md` + `docs/sync-review/` | spec | Sync design, backend selection rationale |
| Backlog hygiene briefs | `docs/backlog-hygiene/` | decision brief | Arc selection rationale (e.g. 2026-07-19 Arc A) |
| README | `README.md` | overview | Public-facing narrative, tech-stack rationale, milestone summary |
