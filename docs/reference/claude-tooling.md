# Claude tooling catalog

Full annotated catalog of the repo's vendored Claude Code tooling. Relocated verbatim from
CLAUDE.md § "Claude tooling for this repo" on 2026-07-19 (`/trim-context`) — CLAUDE.md keeps
the lean summary; this file is the on-demand detail. **💻 = local-only** (needs a browser
MCP / local dev server, local TTS/voice, or the local `nlm` CLI / NotebookLM MCP; won't work
in a cloud/web session).

## Commands (`.claude/commands/`)

- `/begin` — open a session: orient on branch/commits/open PRs, recap the last `/wrap` log, route into `.claude/session-start.md`.
- `/wrap` — end-of-session wrap-up: recap + why, active-recall quiz, next moves; saves a dated log (pairs with `docs/SESSION-LOG.md`).
- `/handoff` — generate a self-contained handoff prompt for a fresh session, then stop.
- `/explore-plan <task>` — explore → plan → confirm before any code; proposes 2–3 ranked approaches and waits for your pick.
- `/tdd <module + behavior>` — test-first loop: write failing tests, confirm they fail for the right reason, then code until green **without** editing the tests (engine tests run via `npm test`).
- `/trim-context` — find + fix CLAUDE.md / memory / always-loaded token bloat, then apply the fixes.
- `/autonomous-milestone [target]` — with a target: plan/build/test/verify end-to-end; with none: triage the backlog into ranked candidates. Uses ultracode multi-agent orchestration (higher token cost).
- 💻 `/screenshot-iterate <mock + what to build>` — visual loop: implement → screenshot the running app → compare to a mock → iterate. Needs a browser MCP + local dev server.
- `/new-engine-module <name + desc>` — **repo-specific.** Scaffold a `js/<name>.js` the Tempo way and wire all four touch-points in one shot: `<script>` tag at the correct load-order slot, CLAUDE.md file-map + load-order chain, `sw.js` ASSETS + `CACHE_NAME` bump, and a `tests/<name>.test.js` stub registered in `tests/index.html`.
- `/fix-bug <symptom + where>` — **repo-specific.** Bug loop: triage vs the known playbooks (stale-SW first), root-cause before edit, regression test, conventions checklist, fresh-context verify, `fix/` branch.
- `/run-tests [scope]` — **repo-specific.** Suite execution + interpretation: `npm test`, the headless-flake adjudication rule, rules + council variants. Never edits to get green.
- `/ship-pr [scope]` — **repo-specific.** DoD pre-flight, pre-runs the 3 guard checks, branch/commit conventions, push + `gh pr create`, CI expectations, merge etiquette (worktree `--delete-branch` quirk). Stops before merge.
- `/add-panel <key + question>` — **repo-specific.** Scaffold a Rhythm Insights panel: registry contract (pure build/render via injected deps), `order` pick, 4-point wiring, clock-pinned tests.
- `/brainstorm` — multi-mode structured brainstorm (Moonshot default) → `docs/ideas/` vision docs + backlog stubs.
- `/claudify-repo` — vendor global commands/skills into this repo and/or brainstorm repo-specific automations.
- `/prompt-optimize` — one-shot prompt rewrite: workflow archetype + model + effort + ready-to-paste prompt. Advisory only.
- `/reframe-orchestrator` — reframe `.claude/orchestrator.md` into a mode-independent invariants & gates doc.
- `/mock-sql-demo` — text self-play mock SQL interview (interviewer + ideal candidate), then a debrief.
- 💻 `/boot_server` — detect how the project is served, start the dev server, open it in Chrome.
- 💻 `/catchup` — mid-session audio catch-up as an MP3 (local TTS); keeps working after.
- 💻 `/envsetup` — open `.env` + the credential's generation page in Chrome, key stub pre-added.
- 💻 `/mock-sql-audio` — full simulated SQL mock interview as an MP3 (local two-voice TTS).
- 💻 `/mock-sql-interview` — live voice mock SQL interview (local voice mode).
- 💻 `/smoke-test` — manual smoke test setup: opens pages in Chrome, do-this-see-that checklist under `docs/smoke/`.

## Skills (`.claude/skills/`, auto-trigger or invoke explicitly)

- `artifacts-audit` — audit which engineering artifacts (READMEs, ADRs, runbooks, ERDs…) the repo should have; writes `docs/artifacts-plan.md`. Plans only, no source edits.
- `artifacts-generate` — generate artifacts from a prior `docs/artifacts-plan.md` (one-at-a-time or batch). Companion to `artifacts-audit`.
- 💻 `match-the-mock` — auto-triggering visual loop (paste a mock / Figma link): implement → screenshot → compare → iterate. Needs a browser MCP + local dev server.
- `bug-hunt` — proactive bug hunt: fan out finder agents, adversarially verify findings, ranked triage list.
- `kickoff` — deep discovery interview → approved kickoff brief + phased plan → scaffold a new project + GitHub repo.
- `mini` — kick off a new mini project under `~/Projects/mini/` (short interview + scaffold).
- `project-guide` — comprehensive point-in-time guide to the project (architecture, history, interview lens); dated file.
- `research-paper` — end-of-project research paper + presenter pack from recorded results; opens a PR, never merges.
- `seed-hunt` — end-of-project seed hunt: verify closure, harvest lessons, sweep arXiv, decision brief.
- `ship-and-route` — land outstanding git work behind a review gate, walk findings, route the next move.
- 💻 `narrate` — turn a short brief into a single-voice MP3 narration (local Kokoro TTS).
- 💻 `audio-series` / `video-series` — episodic NotebookLM audio/video series for an existing notebook (need `nlm`/NotebookLM MCP).
- 💻 `interview-prep` — init/maintain a NotebookLM interview-prep notebook (needs `nlm`/NotebookLM MCP).
- 💻 `nlm-skill` — expert guide for the NotebookLM CLI (`nlm`) and MCP server.
- 💻 `notebook-assist` / `notebook-init` / `notebook-merge` — manage / create / merge NotebookLM notebooks (need `nlm`/NotebookLM MCP).

## Subagents (`.claude/agents/`) — beyond the 5-subagent sync-PR pipeline

- `sync-invariant-reviewer` — read-only reviewer of a branch diff for the three cross-cutting invariants the pipeline doesn't mechanically gate: synced-store `schema.stamp()` coverage, reuse-over-reimplementation (`Platform.haptic`/`Platform.notify`/`escapeHtml`/`Utils.formatMs`), and new-module 4-file wiring. Reports findings; never edits.
- `test-runner` — runs the suites and reports verdict + failures verbatim; knows the headless-flake adjudication rule. Read-only; pinned to haiku.
- `app-verifier` — drives the real app via the playwright MCP on the fresh-context recipe; returns observed-vs-expected + screenshots + console findings. Read-only.
- `council-tester` — runs `npm --prefix council test` (Life-OS validators); hard-forbidden from `synthesize.mjs`/`seed-pillars.mjs` (production Firestore writers). Read-only; haiku.

## Hooks (`.claude/settings.json`, committed)

- `pre-commit-guard` (`PreToolUse` on `Bash`, script `scripts/hooks/pre-commit-guard.mjs`) — before any `git commit`, runs `scripts/check-sw-bump.mjs` + `scripts/check-asset-integrity.mjs` + `scripts/check-load-order.mjs` and **blocks** the commit if a cached web file changed without a `CACHE_NAME` bump, if `sw.js` ASSETS and the `index.html` `<script>` set disagree, or if the `CLAUDE.md` "Script Load Order" chain drifts from the `index.html` `<script>` order.

## MCP servers (`.mcp.json`, committed)

Project-scoped so cloud/web sessions + collaborators inherit them; Claude Code prompts to
approve project MCP servers on first use.

- `playwright` (`npx @playwright/mcp@latest`) — deterministic browser for any session: run the engine suite, drive/screenshot the app, sidestep the stale-SW trap. Makes the 💻 commands work in cloud/web too.
- `firebase` (`npx firebase-tools@latest experimental:mcp --only firestore,auth`) — in-session Firestore/Auth queries (sync debugging per `docs/playbooks/sync-divergence.md`); reuses the firebase-tools wired for `npm run test:rules`.
