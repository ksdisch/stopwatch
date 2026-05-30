# Engineering Artifacts — Audit & Generation Plan

> **Status:** Source of truth for the follow-up *generation* session. This file is the **plan only** — no artifacts (READMEs, ADRs, diagrams) were generated in the session that produced it, and no source code was modified.
> **Created:** 2026-05-30
> **Repo:** Tempo (a.k.a. `stopwatch`) — `github.com/ksdisch/stopwatch` · live at `https://ksdisch.github.io/stopwatch/`
> **Method:** 6-agent parallel discovery sweep (docs-freshness · architecture/decisions · data-model · ops/infra · git-activity · test/quality) → profile → audit → plan.

## Confirmed scope decisions (from Phase 2)

These four answers drive the weighting throughout this plan:

1. **Audience = Portfolio + Personal-production (NOT public OSS).** Weight the *visible credibility* artifacts (README, LICENSE, ADRs, C4/sync diagrams, CHANGELOG) **and** the *operational reality* artifacts (runbooks, playbooks, data dictionary, the `recovery_state` contract) high. Skip OSS ceremony (CONTRIBUTING, CODE_OF_CONDUCT, issue/PR templates) and team-process artifacts (OKR/RACI/sprint/Gantt). The meds/BFRB-as-health-data HIPAA/BAA question stays dormant — single real user.
2. **README = promote `PROJECT_GUIDE.md` → committed `README.md`** (un-ignore, rename, refresh stale stats).
3. **ADRs = retro-document the ~9 significant past decisions, then keep appending** (numbered, append-only).
4. **External pipeline = document the `recovery_state` data contract in this repo** (the consumer contract belongs here even though the producer lives in `personal-health-elt`).

> **Changes since last version (2026-05-30, Tier 1 execution):**
> - Recorded the three remaining decisions: **License = MIT**; **worked-postmortem subject = the 2026-05-17 cloud-sync race-fix cluster** (richer RCA than the flow-vibrate revert — chosen for the Tier-2 example); **CI = opted in** (GitHub Actions, Tier 2 item 15).
> - **Tier 1 shipped** (see the status box below): `README.md` (promoted), `LICENSE` (MIT), ADR scaffold (`0000`–`0004` + index), and all ⚠️ stale-doc corrections.
>
> ### ✅ Tier 1 status — shipped on branch `docs/artifacts-tier1`
> | Item | State | Notes |
> |---|---|---|
> | `README.md` | ✅ | Promoted from `PROJECT_GUIDE.md` (un-ignored, renamed, original removed). Refreshed: badge/test count → ~797 cases/32 files; PRs 63→100+/#105; commits 241→262; modules 60+→68; `styles.css` ~5,000→5,590; Rhythm "placeholder"→shipped; **fixed factual error** (`GoogleService-Info.plist` is committed, not local-only); added Phase 10 row, Todoist+ELT nodes to the arch diagram, a License section, and an "agent-machinery is not human process" note. |
> | `LICENSE` | ✅ | MIT © 2026 Kyle Disch. |
> | ADRs | ✅ | `docs/adr/0000-template.md` + `0001`–`0004` (no-build, drift-free timing, Firestore backend, per-store merge) + `README.md` index. Authored via a 4-agent workflow; each carries verified `file:line` evidence. |
> | Stale-doc fixes | ✅ | `CLAUDE.md` Script Load Order rewritten to match `index.html` + 15 missing modules added to the file-map + `sync-engine.js`/test-count descriptions corrected; `iOS-BUILD.md` dead worktree path → `git rev-parse --show-toplevel` + test count; `SESSION-LOG.md` empty stub → labeled template + dual-system precedence note; archival banners on `CONSOLIDATED-FINDINGS.md`, `TEMPO-PLAN.md`, `ANALYTICS-PLAN.md`, `stopwatch-expansion-prompt.md`. |
> | Discovery-agent corrections | ✅ | Verified against disk: the "phantom `rhythm-insights.js`" only appears in backlog row #13 as a *planned* file (not in the file-map) — nothing removed; `GoogleService-Info.plist` **is** tracked. |
>
> **Not in Tier 1 (Tier 2+):** remaining ADRs `0005`–`0009`, `ARCHITECTURE.md`, diagrams, data dictionary, `recovery-state-contract.md`, runbooks/playbooks, postmortem template + worked example, `CHANGELOG.md`, `ROADMAP.md`, CI workflow.
>
> ---
>
> **Original (planning) version:** First version of this file.

---

## Phase 2 — Project profile (confirmed)

| Field | Value |
|---|---|
| **Shape** | Client-side **PWA application** + **native iOS shell** (Capacitor) + a thin **read-only consumer** of an external Firestore-fed data pipeline. Not a library/service/CLI/monorepo. |
| **Primary language(s)** | JavaScript — vanilla, ~26k lines / ~70 modules, **no framework, no build step, no bundler**. Swift (Capacitor shell, mostly generated); HTML/CSS (~3.3k-line `styles.css`). |
| **Stack** | Web Audio (synthetic SFX/ambient), SVG, RAF render loop; IIFE-globals + factory-function modules; `index.html` `<script>` order **is** the dependency graph. Capacitor 6 (`@capacitor-firebase/auth`+`firestore`, haptics, local-notifications, network); Firebase JS SDK 11 (lazy CDN import on web). |
| **Datastores** | `localStorage` (~50 keys); **two IndexedDB DBs** — `stopwatch_history_db/sessions` (canonical) + `tempo_sync_db/pending_ops` (offline buffer); **Firestore** per-user subcollections — 6 synced stores + 1 read-only `recovery_state` feed. |
| **Deployment / orchestration** | Web → **GitHub Pages from `main` root**, push-to-deploy ~1 min, no build, stale-cache guarded only by a `CACHE_NAME`-bump convention. iOS → `cap copy` → Xcode Run, recurring **7-day free-cert refresh**. **No CI/CD.** Firestore rules deployed **manually** (can drift). |
| **Audience** | **Portfolio + Personal-production** (confirmed). Public repo + recruiter-grade (gitignored) `PROJECT_GUIDE.md`; one real user for the health data. |
| **Maturity** | **Production** (live daily-use web + author's iPhone), but solo and **release-less** (0 tags, no CHANGELOG). |
| **Team size** | **Solo** — 258/262 commits one human (two identities) + 4 Claude-bot commits. |
| **Active areas** | Pomodoro (timeline/revert/Todoist-rename), Todoist integration (+2 follow-ups), Meds supply, cloud-sync **stabilization** (native CAS/listener parity), Rhythm/Recovery readiness band. Cadence **decelerating** off a mid-May cloud-sync peak into fix/docs burndown. |
| **Existing docs** | Rich internal trail: `CLAUDE.md`, gitignored `PROJECT_GUIDE.md`, `BUILD-HISTORY.md`, `CLOUD-SYNC-STRATEGY.md v2.0`, `sync-impl/PLAN.md` + 17 audits + 12 briefs, `sync-review/` (backend selection + 3-lens review), `SESSION-LOG.md` + 9 session-logs, stale `TEMPO-PLAN`/`ANALYTICS-PLAN`, `iOS-BUILD.md`, `FIREBASE-SETUP.md`, `.claude/` orchestrator + 5 agents. **Conventional Commits** consistent since ~PR #41. |
| **Notable gaps** | No README/LICENSE/CHANGELOG/CONTRIBUTING/`.github/`; best intro is gitignored; **0 ADRs** for ≥9 hard-to-reverse decisions; **0 git tags** / ~105 PRs; test-count drift (137/265/543/642 vs actual ≈796); `CLAUDE.md` file-map omits 10 modules + lists 1 phantom (`rhythm-insights.js`); `recovery_state` contract undocumented in-repo; no CI gate / no rollback / no rules-unit tests / UI untested; `iOS-BUILD.md` dead worktree path. |

---

## Phase 3 — Audit & recommendation

Legend: ✅ present/good · ⚠️ stale/thin · 🟢 recommended (missing, clear benefit) · 🟡 optional · ⛔ not applicable.

### Repo hygiene

| Artifact | Status | Target | Evidence-tied justification |
|---|---|---|---|
| README.md | 🟢 | `README.md` (root) | **No top-level README** → `github.com/ksdisch/stopwatch` renders a bare file tree. The strongest intro (`PROJECT_GUIDE.md`, ~46KB, badges + Mermaid diagram + user guide) is **gitignored**, so it never reaches GitHub. Promote it (Q2). |
| LICENSE | 🟢 | `LICENSE` (root) | `gh` reports `licenseInfo=null`; a **public** portfolio repo with no license is "all rights reserved" by default — the most concrete external-facing gap and an easy credibility win. |
| CHANGELOG.md | 🟢 | `CHANGELOG.md` (root) | ~105 merged PRs, **0 git tags**, no release history outside commit messages. Conventional Commits are consistent from ~PR #41, so a generator (`git-cliff`) can backfill Added/Fixed/Changed cleanly; portfolio + release legibility. |
| CONTRIBUTING.md | ⛔ | — | Solo (258/262 commits one human), **not OSS** (Q1). A standalone CONTRIBUTING would be "ceremony with no audience" (test-quality agent). Fold a 15-line **Dev loop** section into the README instead. |
| CODE_OF_CONDUCT.md | ⛔ | — | No external contributor community (Q1 excluded OSS). |
| .env.example | ⛔ | — | No env-var config: web Firebase config is **committed public client config** (`js/sync-firebase-config.js`); device-local tokens (Todoist) are user-pasted. Replace with a **"Run sync locally"** README subsection. |
| PR / issue templates | ⛔ | — | No `.github/`, not OSS. |
| Makefile / Taskfile / justfile | 🟡 | `package.json` scripts | `package.json` has `ios:*`/`sync-www` but **no `test` script**. Add npm scripts (`test:serve`, headless test) — more idiomatic to this stack than a Makefile. |

### Decision & design

| Artifact | Status | Target | Evidence-tied justification |
|---|---|---|---|
| ADRs | 🟢 | `docs/adr/000N-*.md` | **≥9 hard-to-reverse decisions live only in commit prose + `CLAUDE.md`**: no-build/script-order (`index.html:1030-1119`), drift-free wall-clock timing (`stopwatch.js:12-18`), mutable-global-proxy (`instance-manager.js:38-41`), Firestore backend (`docs/sync-review/BACKEND-SELECTION.md`), per-store merge rules (`sync-engine.js:1246-1398`), Capacitor-over-RN (`platform.js`), Todoist personal-token-over-OAuth (`todoist.js:40-53`), deferred native CAS (`sync-firestore.js:325-347`), split persistence (2 IndexedDB DBs). Retro + forward (Q3). |
| Design Doc / RFC / Tech Spec | 🟡 | `docs/design/<feature>.md` | `docs/sync-impl/PLAN.md` + per-PR `*-PROMPT.md` + `CLOUD-SYNC-STRATEGY.md` already serve this for sync. Adopt `docs/design/` as the **go-forward** template for the next non-trivial feature (Rhythm insights #13, Live Activities #4). Not retro. |
| PRD | 🟡 | — | The `CLAUDE.md` backlog rows already carry per-feature "what & why." A standalone PRD is overkill solo; the ROADMAP extraction covers the product angle. |
| Postmortem / RCA (template + worked example) | 🟢 / 🟡 | `docs/postmortems/TEMPLATE.md` + `docs/postmortems/YYYY-MM-DD-*.md` | Real mini-incidents exist: flow-vibrate **direct-push-to-main revert** (`8ff636d`), **iOS sign-out bug** (unfixed, `CLAUDE.md` tech-debt), cloud-sync **race-fix cluster** on 2026-05-17 (3 fixes), **meds clamp regression** (#95, day after #94). Template = low effort, 🟢; one worked example = strong portfolio signal, 🟡. |

### Planning

| Artifact | Status | Target | Evidence-tied justification |
|---|---|---|---|
| Roadmap (now/next/later) | 🟢 | `ROADMAP.md` (root) | The `CLAUDE.md` "Feature Backlog" table is a de-facto ROI-sorted now/next/later, but buried in an agent-facing doc. Extract a clean public ROADMAP (portfolio signal + decouples product direction from agent instructions). |
| BACKLOG.md / user stories | 🟡 | `docs/BACKLOG.md` | Backlog already lives in `CLAUDE.md`; extraction is optional once ROADMAP exists. User stories ⛔ (solo). |
| Sprint plan / WBS / RACI / OKR / Gantt / Kanban | ⛔ | — | Solo, no team cadence or accountability split to model. |

### Diagrams (default Mermaid)

| Artifact | Status | Target | Evidence-tied justification |
|---|---|---|---|
| C4 — Context | 🟢 | `docs/diagrams/c4-context.mmd` | One view of Tempo + its 3 external boundaries: Firebase Auth/Firestore, Todoist REST, and the read-only `personal-health-elt` `recovery_state` feed. |
| C4 — Container | 🟢 | `docs/diagrams/c4-container.mmd` | **Highest-value diagram** (arch agent): PWA (Pages) + iOS WebView running the **same JS**, talking to Firebase (6 synced stores) + Todoist, reading `recovery_state`. Captures every boundary at once. |
| C4 — Component | 🟡 | `docs/diagrams/c4-component-sync.mmd` | A component view of the cloud-sync stack (2600-line `sync-engine.js` + `sync-firestore` + `sync-buffer` + 6 `sync-merge-*`) would earn its keep; otherwise the layering diagram suffices. |
| C4 — Code | ⛔ | — | Too granular; no value at this size. |
| Sequence | 🟢 | `docs/diagrams/seq-*.mmd` | (a) **primary-instance-swap** — `setPrimaryStopwatch(id)` reassigning the global `Stopwatch` so UI transparently follows (most non-obvious idiom); (b) **sync upload/hydrate** flow. |
| Flowchart | 🟢 | `docs/diagrams/merge-decision.mmd` | Per-store conflict resolution (history=cloud-wins-on-id, meds=keep-both-via-originDeviceId, rest_log/presets=LWW) + the `deviceId/updatedAt/schemaVersion` stamp + F19a future-record gate. |
| State machine | 🟢 | `docs/diagrams/state-sync.mmd` + `state-engines.mmd` | **2nd-highest value** (arch agent): SyncEngine lifecycle (disabled→init→auth-change→hydrate→steady-state→offline-buffer→drain, + Stage-D handoff/partial-upload branches) and the engine status machines (`idle/running/paused/[phaseComplete]/done`). |
| Module-layering / component (UML) | 🟢 | `docs/diagrams/layers.mmd` | The 5 load-order tiers (utils → platform/schema → engine factories+singletons → IIFE data/infra → UI globals → `app.js` root). Pairs directly with the no-build ADR. |
| DFD — persistence/sync topology | 🟢 | `docs/diagrams/data-topology.mmd` | The **load-bearing data diagram** (data-model agent): how each store lives across `localStorage` / IndexedDB×2 / Firestore, with `migrate`/`sync`/`cache`/`export` edges (e.g. `flow_user_tasks` = local+export-stripped but NOT synced; `recovery_state` = external-write→client-read→cache). Replaces an ERD. |
| Data lineage | 🟡 | inline in `recovery-state-contract.md` | `recovery_state` lineage: `personal-health-elt` → Firestore → client cache → Rhythm band. Small; pairs with the contract doc. |
| Platform-seam diagram | 🟡 | `docs/diagrams/platform-seam.mmd` | `Platform.haptic/notify/auth/network` web-vs-native branches funneling 23 haptic + 6 notification sites. Backs the Capacitor ADR. |
| Swimlane / activity / UML class / UML deployment | 🟡 | — | Low marginal value over the sequence + state + container set; deployment overlaps C4-container, class adds little over the factory description. |
| **ERD (relational)** | ⛔ | — | **No relational DB, no FKs** (data-model agent explicit). Crow's-Foot/DBML would imply joins + referential integrity that don't exist and would mislead. Use the topology DFD instead. |
| Dimensional model (star/snowflake) | ⛔ | — | The analytics warehouse lives in the **external** `personal-health-elt` repo, not here. |
| Pipeline / DAG | ⛔ | — | The ELT DAG is in `personal-health-elt`; this repo only consumes the output → document the **contract**, not the DAG. |
| Network/topology · Cloud architecture | 🟡 | — | Overlap C4-container; only draw if the container diagram proves too dense. |
| Wireframes / mockups (Excalidraw/Figma) | ⛔ | — | App is built and shipped; UI is verified via `docs/MANUAL-SMOKE-TESTS.html` + Playwright, not design-driven. No DBML/Figma justification. |

### Ops & reliability

| Artifact | Status | Target | Evidence-tied justification |
|---|---|---|---|
| Runbooks | 🟢 | `docs/runbooks/<op>.md` | Recurring/risky manual ops with no automation: **deploy + SW cache-bump** (push→Pages, `CACHE_NAME` + `index.html`↔`sw.js` ASSETS parity), **iOS 7-day cert refresh** (weekly, no reminder), **Firestore rules publish** (manual; committed file can drift from live). 9 candidates surfaced. |
| Playbooks | 🟢 | `docs/playbooks/<scenario>.md` | Scenario responses: **stale cache after deploy**, **sync divergence** (LWW/CAS, web-only-CAS native gap), **recovery band blank/stale** (no `visibilitychange` refresh), **iOS sign-out broken** (known bug). 10 candidates surfaced. |
| Postmortem template | 🟢 | `docs/postmortems/TEMPLATE.md` | See Decision & Design (cross-listed). |
| SLI / SLO / SLA | 🟡→⛔ | — | Single user, no uptime obligation. A one-line "best-effort, no guarantee" note in README is sufficient; a formal SLO doc is overkill. |
| On-call / escalation | ⛔ | — | Solo. |

### Knowledge

| Artifact | Status | Target | Evidence-tied justification |
|---|---|---|---|
| Data dictionary | 🟢 | `docs/reference/data-dictionary.md` | **Single highest-leverage reference** (data-model agent). ~50 `localStorage` keys + 6 synced stores + 2 IndexedDB stores, with non-obvious semantics: derived-vs-stored (meds `remaining`/`supplyAdjustment`, Pomodoro `previousPhaseSnapshot`), the `deviceId/updatedAt/schemaVersion` envelope + future-record rule, LWW-vs-append-vs-tombstone per store, additive-nullable fields (`todoistId`, `bedtime/wakeTime`, `deletedAt`). |
| Integration / data contract (`recovery_state`) | 🟢 | `docs/reference/recovery-state-contract.md` | (Q4) `personal-health-elt` writes `users/{uid}/recovery_state/{latest,history}` via Admin SDK (bypasses rules); Tempo reads only. The shape is an **implicit contract documented only in `recovery-feed.js:1-19` + `firestore.rules` comments** — `grep` for `personal-health-elt`/`mart_recovery_state` across `docs/` returns nothing. Bad/missing docs render silently. |
| Onboarding doc | 🟡 | (fold into README) | Mostly subsumed by the promoted README + Dev-loop section + glossary. `CLAUDE.md` is **agent-facing** (instructions), not a human narrative — but a separate `ONBOARDING.md` would duplicate the README. Cover the rationale ("why the weird stuff is intentional"), the `?nosw=1` gotcha, and "`.claude/` is agent machinery, not human process" inside README. |
| Glossary | 🟡 | `docs/reference/glossary.md` | Dense domain + project jargon: BFRB, Flow Block/ultradian, ACWR/HRV/RHR, Pomodoro phases, "offset"/"drift-free", LWW/CAS, Stage-D handoff, F1–F21 sync invariants. Helps parse `CLAUDE.md` + the sync docs. Low effort. |
| API docs (OpenAPI/Swagger) | ⛔ | — | Tempo exposes **no server/HTTP API** — it is a *client* of Firestore + Todoist REST. Those integration contracts are covered by the data-contract doc, not OpenAPI. |
| Wiki | ⛔ | — | `docs/` already functions as the wiki. |

### Existing docs needing correction (⚠️ STALE/THIN)

These aren't missing — they exist and undermine credibility through drift. Cheap, high-value fixes (do in the generation session; all are docs, not source):

| Doc | Status | Fix |
|---|---|---|
| `CLAUDE.md` architecture file-map | ⚠️ | Omits 10 real modules (`rhythm-engine.js`, `recovery-feed.js`, `bfrb-events.js`, `sync-toast.js`, `sync-firebase-config.js`, 5× `sync-merge-*.js`); **lists 1 phantom** (`js/rhythm-insights.js`, only a backlog plan). Reconcile to `index.html`'s script order. |
| Test count (everywhere) | ⚠️ | Claimed as 137 / 265 / 543 / 642 across `CLAUDE.md`, `iOS-BUILD.md`, `PROJECT_GUIDE.md`; actual loaded suite ≈ **796** across 32 files. Pick one source of truth (or de-number the prose) — ideally a CI step prints it. |
| `CLAUDE.md` tech-debt "Engine tests only: 137…" | ⚠️ | Badly stale: Interval tests **are** on main (`interval.test.js`, 59 cases); only the broad Flow suite is unmerged. Update. |
| `iOS-BUILD.md` (lines 24, 73) | ⚠️ | Dead hardcoded worktree path `.claude/worktrees/charming-spence-31e861` (current is `objective-hermann-dda45f`). Make path-agnostic. |
| `docs/SESSION-LOG.md` | ⚠️ | Ends with an unfilled `## Session N — YYYY-MM-DD` template stub; numbering stops at Session 10 while body runs to 2026-05-29. Two parallel session-log systems (monolith vs `docs/session-logs/*`) with no stated precedence. Pick one canonical going forward. |
| `docs/sync-review/CONSOLIDATED-FINDINGS.md` | ⚠️ | Titled "Strategy v1.0 Review" but fed into v2.0. Add an "archived — superseded by v2.0" banner. |
| `docs/TEMPO-PLAN.md`, `docs/ANALYTICS-PLAN.md`, `docs/stopwatch-expansion-prompt.md` | ⚠️ | Pre-implementation plans describing target states that have since shipped. Add "archival snapshot (date)" banners so they aren't mistaken for current. |

---

## Phase 4 — Generation & maintenance plan

### 1. Priority order (leverage-to-effort, dual portfolio + production weighting)

**This week — highest leverage, mostly small, closes the embarrassing gaps + biggest visible wins**

1. **`README.md`** — promote `PROJECT_GUIDE.md` (un-ignore → rename → refresh stale stats + add a "Run sync locally" + "Dev loop" section). *The single biggest visible gap.* — **S–M**
2. **`LICENSE`** — pick + drop in. *Removes the all-rights-reserved ambiguity on a public repo.* — **XS**
3. **Stale-doc corrections** (the ⚠️ table) — file-map, test-count single-source, `iOS-BUILD.md` path, archival banners. *Cheap; protects every other doc's credibility.* — **S**
4. **ADR scaffold + the 4 load-bearing ADRs** — `docs/adr/` + template + `0001` no-build/script-order, `0002` drift-free timing, `0003` Firestore backend, `0004` per-store merge. — **M**

**This month — the substance: decisions, diagrams, contracts, ops**

5. **Remaining 5 ADRs** — mutable-global-proxy, split persistence, Capacitor, Todoist-token, deferred native CAS. — **M**
6. **`docs/ARCHITECTURE.md`** — narrative + embeds C4 Context + Container + module-layering diagrams. — **M**
7. **Sync state machine + persistence/sync topology DFD** (`docs/diagrams/`). — **M**
8. **`docs/reference/recovery-state-contract.md`** (Q4) — the read-only `recovery_state` interface + failure modes + lineage. — **S**
9. **`docs/reference/data-dictionary.md`** — the highest-leverage reference. — **M**
10. **Runbooks** — `deploy-and-cache-bump.md`, `ios-cert-refresh.md`, `firestore-rules-publish.md`. — **S each**
11. **Playbooks** — `stale-cache.md`, `sync-divergence.md`, `recovery-band-blank.md`, `ios-signout.md`. — **S each**
12. **Postmortem template + 1 worked example** (flow-vibrate direct-push revert *or* the 2026-05-17 sync-stabilization night). — **S**
13. **`CHANGELOG.md`** — backfill from ~PR #41 conventional commits via `git-cliff`. — **M**
14. **`ROADMAP.md`** — extract + reframe from the `CLAUDE.md` backlog. — **S**
15. **CI (GitHub Actions)** — headless test run + `index.html`↔`sw.js` ASSETS parity + SW-bump enforcement + markdown link-check. *Closes the "syntax error ships live in 1 min" risk.* — **M**

**Nice to have**

16. Remaining diagrams — primary-instance-swap sequence, platform seam, merge-decision flowchart, C4 component (sync). — **S each**
17. `docs/reference/glossary.md`. — **S**
18. Firestore rules-unit tests (`@firebase/rules-unit-testing`) — verify per-user isolation + `recovery_state` read-only. — **M**
19. Auto-CHANGELOG automation — `git-cliff` config + release Action keyed to `CACHE_NAME` build versions. — **S–M**
20. `npm run test:serve` + headless test script + Mermaid lint step. — **S**

### 2. Per-artifact spec

| Artifact | Target path | Format | Effort | Dependencies |
|---|---|---|---|---|
| README | `README.md` | Markdown (+ embedded Mermaid) | S–M | Reuses `PROJECT_GUIDE.md`; needs corrected test/file counts (item 3) |
| LICENSE | `LICENSE` | text | XS | Author picks license (see Open Questions) |
| ADR template | `docs/adr/0000-template.md` | Markdown (MADR-style) | XS | — |
| ADRs 0001–0009 | `docs/adr/000N-<slug>.md` | Markdown | M (×2 rounds) | Template first; `0006` (merge) ↔ data-dictionary cross-ref |
| Architecture doc | `docs/ARCHITECTURE.md` | Markdown + Mermaid | M | C4 + layering diagrams; ADRs 1–9 give the "why" links |
| C4 Context / Container | `docs/diagrams/c4-context.mmd`, `c4-container.mmd` | Mermaid (`C4Context`/`flowchart`) | S each | recovery-state contract for the external boundary label |
| Module-layering | `docs/diagrams/layers.mmd` | Mermaid flowchart | S | Mirrors `index.html` script order |
| Sync state machine | `docs/diagrams/state-sync.mmd` | Mermaid `stateDiagram-v2` | M | Read `sync-engine.js` lifecycle |
| Engine state machine | `docs/diagrams/state-engines.mmd` | Mermaid `stateDiagram-v2` | S | State Model in `CLAUDE.md` |
| Persistence/sync DFD | `docs/diagrams/data-topology.mmd` | Mermaid flowchart | M | Data dictionary (shared field list) |
| Merge-decision flowchart | `docs/diagrams/merge-decision.mmd` | Mermaid flowchart | S | ADR 0004/0006 |
| Sequence (instance-swap, sync) | `docs/diagrams/seq-*.mmd` | Mermaid `sequenceDiagram` | S each | — |
| Data dictionary | `docs/reference/data-dictionary.md` | Markdown table | M | Authoritative localStorage-key list (verify vs grep, not just `CLAUDE.md`) |
| `recovery_state` contract | `docs/reference/recovery-state-contract.md` | Markdown + small Mermaid | S | Read `recovery-feed.js` + `firestore.rules` |
| Glossary | `docs/reference/glossary.md` | Markdown | S | — |
| Roadmap | `ROADMAP.md` | Markdown | S | Extract from `CLAUDE.md` backlog |
| CHANGELOG | `CHANGELOG.md` | Markdown (Keep-a-Changelog) | M | `git-cliff`; choose the ~PR #41 cutoff |
| Runbooks | `docs/runbooks/<op>.md` | Markdown | S each | — |
| Playbooks | `docs/playbooks/<scenario>.md` | Markdown | S each | — |
| Postmortem template + example | `docs/postmortems/{TEMPLATE,YYYY-MM-DD-*}.md` | Markdown | S | Pick the incident |
| CI workflow | `.github/workflows/ci.yml` | YAML + small Node/Playwright script | M | Headless harness (`tests/index.html` waits for `document.title` PASS/FAIL; follow the `?nosw=1` redirect) |

### 3. Maintenance cadence

- **Per PR:** README (when run-steps/architecture touched); `CHANGELOG` entry (or auto-generated from the conventional-commit subject); the **inline architecture/diagram** updated when the module it depicts changes; **SW `CACHE_NAME` bump** whenever a cached web file changes (already mandated — make it a CI gate, item 15).
- **Per release (≈ each `CACHE_NAME` bump / shippable PR):** finalize the `CHANGELOG` section; optionally cut a **git tag** mirroring the `CACHE_NAME` slug (closes the zero-tags gap at no cost).
- **Per significant decision:** append a new **numbered ADR** (never edit a decided one — supersede with a new ADR that links back).
- **Per incident:** write a **postmortem** from the template (reverts, hotfix clusters, data-divergence, auth bugs).
- **Triggered:**
  - **Schema change** → update data dictionary + the relevant `sync-merge-*` ADR; if a sync store's shape changes, bump `SCHEMA_VERSION` discipline note.
  - **Topology change** (new datastore, new external integration) → C4 Container + persistence DFD.
  - **`recovery_state` shape change upstream** → the contract doc (and ideally a contract-validation test).
  - **New module added to `index.html`** → layering diagram + `CLAUDE.md` file-map + `sw.js` ASSETS (CI-enforced).
- **Quarterly:** groom `ROADMAP.md`; re-verify runbook steps (dates at top of each runbook); reconcile the data dictionary against a fresh `grep` of `localStorage` keys.

### 4. Suggested automation

All run in GitHub Actions (the repo has **none** today — highest-ROI single addition):

1. **Headless engine tests** — Playwright loads `http://localhost:8765/tests/index.html?nosw=1`, waits for `document.title` to flip to `PASS (n)`/`FAIL (n)`, fails the job on `FAIL`. *(The only machine-readable signal; no Node runner, no exit code.)* Add a retry for the one documented `_steadyRunInFlight` flaky.
2. **Asset-integrity check** — script asserting every `js/*.js` in `index.html` `<script>` tags is also in `sw.js` `ASSETS` (and vice-versa). *Prevents silent offline breakage.*
3. **SW cache-bump enforcement** — fail the PR if any cached web file (`js/*.js`, `css/*.css`, `index.html`, `manifest.json`) changed without a `CACHE_NAME` bump in the same diff.
4. **Markdown link-checker** (`lycheeverse/lychee-action`) — catches the dead-path class of bug (`iOS-BUILD.md` worktree path).
5. **Mermaid lint/render** — validate `docs/diagrams/*.mmd` parse on PR.
6. **Auto-CHANGELOG** — `git-cliff` (or `release-please`) scoped to commits after the #41 convention-adoption point, dropping `docs`/`chore` from the public log, keyed to `CACHE_NAME`-style build versions (not invented semver).
7. **Firestore rules-unit tests** (`@firebase/rules-unit-testing` in the test job) — assert per-user isolation + `recovery_state` client-write denial.
8. *(Optional)* pre-commit hook enforcing ADR filename numbering (`000N-`).

> **No silent caps:** CI here is a *gate before* `git push`-to-Pages, not a deploy pipeline (Pages auto-deploys from `main` regardless). Document that the gate runs on PRs, and that a direct push to `main` bypasses it — which is exactly the failure mode behind the flow-vibrate revert incident.

### 5. Naming conventions & structure

The repo already nests under `docs/` with `audits/`, `briefs/`, `session-logs/`, `sync-impl/`, `sync-review/`. Add, consistent with that:

```
README.md                              # promoted from PROJECT_GUIDE.md
LICENSE
CHANGELOG.md
ROADMAP.md
docs/
  ARCHITECTURE.md                      # narrative + embeds key diagrams
  artifacts-plan.md                    # THIS FILE
  adr/
    0000-template.md
    0001-no-build-script-load-order.md
    0002-drift-free-wall-clock-timing.md
    0003-firestore-sync-backend.md
    0004-per-store-merge-strategy.md
    0005-mutable-global-proxy-primary-instance.md
    0006-split-localstorage-indexeddb-persistence.md
    0007-capacitor-native-wrapper.md
    0008-todoist-personal-token-not-oauth.md
    0009-defer-native-cas-listener-parity.md
  design/<feature>.md                  # go-forward design docs (not retro)
  diagrams/<name>.mmd                   # Mermaid source; embed in ARCHITECTURE.md/README
  runbooks/<operation>.md
  playbooks/<scenario>.md
  postmortems/TEMPLATE.md
  postmortems/YYYY-MM-DD-<incident>.md
  reference/
    data-dictionary.md
    recovery-state-contract.md
    glossary.md
  # existing dirs unchanged: audits/ briefs/ session-logs/ sync-impl/ sync-review/
```

**Conventions:**
- **ADRs:** `000N-kebab-title.md`, MADR-style (Context / Decision / Status / Consequences), append-only; supersede via a new ADR that links the old one. The existing `docs/sync-impl/audits/*` + `docs/audits/*` stay the **per-PR** trail; ADRs capture the **cross-cutting, durable** decisions.
- **Diagrams:** Mermaid `.mmd` source in `docs/diagrams/`, embedded into `ARCHITECTURE.md`/README via fenced ```` ```mermaid ```` blocks so GitHub renders them. No DBML, no Excalidraw, no Figma (justified above).
- **Postmortems:** dated filename, blameless, link the commits/PRs.
- **Session logs:** pick the dated `docs/session-logs/*.md` convention as canonical going forward; archive the monolithic `SESSION-LOG.md` with a pointer.

---

## Open questions for the generation session

1. **License choice** — MIT/Apache-2.0 (typical portfolio default, signals "look at my work") vs an explicit proprietary "all rights reserved" (keeps the health app closed). *Recommend MIT for the portfolio goal; the health *data* is per-user in Firestore and unaffected by the code license.*
2. **Versioning** — keep `CACHE_NAME` slugs as the canonical release id (lowest friction, matches reality), or introduce real semver git tags (`vX.Y.Z`)? *Recommend tagging each deploy with the `CACHE_NAME` slug — closes zero-tags at zero process cost — and only adopt semver if you later want `BREAKING CHANGE` semantics.*
3. **`PROJECT_GUIDE.md` after promotion** — once it becomes `README.md`, delete the gitignored original or keep it as a longer-form local scratchpad? *Recommend deleting; one source of truth.*
4. **Worked postmortem subject** — the flow-vibrate **direct-push-to-main revert** (clean process story) or the **2026-05-17 cloud-sync race-fix cluster** (richer technical RCA)? Either works; pick one for the example.
5. **CI hosting** — adding `.github/workflows/` is the first `.github/` content; confirm you want Actions enabled on the repo (free for public repos).
