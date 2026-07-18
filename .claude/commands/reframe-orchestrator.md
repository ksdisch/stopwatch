---
description: Reframe a repo's .claude/orchestrator.md from a human-paused dispatch persona into a mode-independent invariants & gates doc (keeps the pipeline as one optional mode, kills the autonomy↔pause deadlock). Docs-only. Pass an optional path to a specific file/repo.
argument-hint: [optional path to the orchestrator file or repo root]
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
---

Target (optional): $ARGUMENTS — if blank, use this repo's `.claude/orchestrator.md`.

Reframe this repo's `.claude/orchestrator.md` from a human-paused "dispatch persona" into a mode-independent invariants & gates doc — without breaking anything that references it.

Why: that file almost certainly conflates two different things —
  (1) durable INVARIANTS + GATES that should govern every change (security/privacy rules, migration/data-immutability, risk/blast-radius gating, ADR-on-decision, sync-before-branch-action, PR-only-to-main, draft-PR-on-manual-smoke), and
  (2) a single ORCHESTRATOR PERSONA that ships every scope through a fixed specialist-dispatch pipeline with MANDATORY human PAUSE checkpoints and a "you never touch code" rule.
Part (2) now conflicts with autonomous runs: a session told to "drive the orchestrator pipeline" AND to "work autonomously without pinging me" will DEADLOCK at a mandatory pause. I want the guardrails kept and the ceremony demoted.

Do this:
1. Read `.claude/orchestrator.md`, `CLAUDE.md`, and grep the repo for everything that references the orchestrator (session-start prompts, agent definitions, diagrams, glossary, any scope/skill prompts). Adapt to THIS repo — its actual rules, pipeline, and stack may differ from this description. Pull the real invariants/gates from the existing files; do NOT invent new ones.
2. Rewrite `.claude/orchestrator.md` (KEEP the filename so references don't break) into:
   - §1 Invariants — always apply, every mode.
   - §2 Gates — the risk/blast-radius tiering + the manual-smoke→draft-PR gate, restated as mode-independent.
   - §3 Operating modes — *Autonomous* (default: one session plans→builds→tests→opens a PR, does the normally-human-delegated work itself with available tools, self-checks the gates, and stops ONLY at the merge / a hard external gate) vs the original *high-oversight dispatch* pipeline, KEPT INTACT as one optional mode. The specialist agents become an ad-hoc toolbox, not a mandatory assembly line.
   - §4 Precedence — one explicit rule: invariants & gates always win; the dispatch mode's mandatory human pauses do NOT apply to an autonomous run.
   Keep it tight. Do NOT delete the pipeline or the specialist contracts — REFRAME them, so the diagram / session-start / agent references stay valid.
3. Reconcile any other "drive the pipeline" instruction (e.g. a session-start "Path B", scope or skill prompts) so it stops contradicting autonomous mode — a one-line note pointing at §3/§4 is enough; don't rewrite those files wholesale.
4. Constraints: DOCS ONLY — do not touch source, SQL, migrations, or config. Follow this repo's git rules (branch, conventional commit, open a PR; never merge or push to main without my go-ahead). If the repo has no `.claude/orchestrator.md`, or it's already mode-aware with no deadlock, STOP and tell me instead of forcing a change.
5. Report: what the file conflated, what you changed, what you deliberately left valid, the PR link, and anything repo-specific you had to adapt.
