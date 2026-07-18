---
name: ship-and-route
description: End-of-build "take it from here" flow — safely land any outstanding git work behind a proper review gate (only merge if the review is clean), briefly walk through the findings, then route the next move (2–3 ranked options, each with a recommendation + an honest ultracode-benefit call), let Kyle pick (or ask for more), and finally hand him a copy-paste starter prompt for a fresh session plus instructions to run it optimally. Use when Kyle types `/ship-and-route`, says "ship and route" / "land and advise" / "take care of any git stuff then tell me what's next", or finishes a chunk of work and wants Claude to land what's ready, advise on next steps, and equip a fresh session — with explicit per-invocation permission to handle pushes/commits/merges as long as the review finds no issues.
---

# Ship and Route — land what's ready, then chart what's next

This skill is the structured version of: *"if there's any git work to take care of, do it now (you have my permission, as long as the reviews come back clean) — then tell me what to do next, whether ultracode would help, and hand me a prompt to start it fresh."*

It runs in **three acts**: **(1) Gated Land**, **(2) Route**, **(3) Handoff**. Do them in order. Acts 1 and the start of 2 are autonomous; the pick at the end of Act 2 and the prompt in Act 3 are collaborative.

## Permission model (read first — this is the load-bearing rule)

- **Invoking this skill IS Kyle's explicit, per-action go-ahead** to commit / push / open PRs / merge the work that is **ready right now**. That satisfies the standing rule ("each push needs its own go-ahead; a blanket pre-approval doesn't count") — each run of the command is a fresh go-ahead for the currently-ready work, nothing more.
- The go-ahead is **conditional on the review finding no issues.** If the review surfaces a blocker you can't trivially and safely resolve, **stop and report** — do not land it.
- **Never direct-push to `main`/`master`.** A global hook hard-blocks `git push … main`, and Kyle's git rules forbid it. Always land via **feature branch → PR → server-side merge** (`gh pr merge`), which the hook permits. This is the proven path.
- This authorization covers **only** the work that's ready in this repo this moment. It does **not** authorize unrelated/future pushes, force-pushes, history rewrites, or destructive ops — confirm those separately.
- Respect any project `CLAUDE.md` git conventions (branch naming, commit/PR footers) over these defaults.

---

## Act 1 — Gated Land

### 1.1 Survey the git state
Establish exactly what's outstanding before touching anything:
```
git branch --show-current
git status --porcelain
git log --oneline <main>..HEAD          # commits not yet on the default branch
git diff <main>...HEAD --stat           # the diff that would land
git remote -v | head -2
gh pr list --state open
```
Decide what "outstanding work" means here: uncommitted changes to commit? a feature branch to PR + merge? an open PR to land? If there is **nothing to land** (clean tree, no ahead-commits, no open PR), say so plainly and skip to Act 2.

If there are **multiple independent landable units**, don't guess — land the obviously-ready one and name the others, or briefly confirm scope.

### 1.2 Deterministic gate (facts, not opinions)
Detect and run whatever the repo supports — never assume script names; read `package.json` / `Makefile` / `pyproject.toml` etc. first:
- typecheck / build
- the test suite
- lint (if configured)
- **secret / sensitive-file check**: confirm nothing private is tracked (`git ls-files | grep -iE '\.env$|\.(db|sqlite|sqlite3)$|secrets|credentials'`, plus any patterns the project's `.gitignore` / pre-commit guard protects). Local-first projects guard real data files — verify they're untracked, and confirm a `core.hooksPath` guard is active if the repo ships one.

Any deterministic failure is an automatic **NO-GO** — fix or report; do not proceed to merge.

### 1.3 Adversarial review gate (the "conduct the reviews properly" part)
Scale the review to the change:
- **Substantial change** (new subsystem, many files, anything touching data integrity / privacy / money / auth, or Kyle has opted into ultracode): run a **multi-agent release-gate Workflow** over the diff vs the default branch. Use independent adversarial lenses appropriate to the project (correctness/ship-blockers, security/privacy, plus any project-specific invariants — e.g. an "iron rule" or portability contract stated in `CLAUDE.md`), **verify each blocking/high finding independently**, then synthesize one **GO / NO-GO** with `decision`, `blockers[]`, `followUps[]`. This skill's instructions authorize the Workflow call.
  - **Bounded-block on the workflow** (`TaskOutput` with `block: true`, generous timeout) — do **not** end the turn and defer the merge to a background notification. The merge depends on the verdict; wait for it in-turn.
- **Small/trivial change**: a thorough inline adversarial read of the diff is enough — but still actively try to *refute* the change, don't just skim it.

### 1.4 Resolve and re-gate
- **GO (zero confirmed blockers):** proceed to land.
- **NO-GO with trivial, in-pattern blockers** (e.g. a missing guard that every sibling function already has, a stale doc, an obvious off-by-one): this is squarely "take care of it for me." **Fix them, matching existing repo patterns**, re-run the deterministic checks, **commit the fix**, and **re-run the gate** until it returns GO. Also sweep up cheap non-blocking nits while you're in there.
- **NO-GO with a non-trivial / risky / ambiguous blocker** (design-level, behavior-changing, unclear fix): **stop. Do not land.** Report the blocker and ask how to proceed.

### 1.5 Land it
Once the gate is clean:
```
git push -u origin <feature-branch>
gh pr create --base <main> --head <feature-branch> --title "…" --body "…"
gh pr merge <#> --rebase --delete-branch     # match the repo's precedent (rebase/squash/merge)
git fetch origin && verify local == origin/<main>, tree clean, tests still green on <main>
```
- End commit messages and PR bodies with the project's required footers (check `CLAUDE.md` — e.g. a `Co-Authored-By:` line on commits and a generated-with line on PR bodies).
- Never commit gitignored/private data (real seed files, DBs, `.env`).

---

## Act 2 — Route the next move

### 2.1 Briefly walk through the review findings
For anything you merged, give Kyle a **tight** recap (he asked for brief): what the gate caught, what you fixed to get to GO, and any non-blocking follow-ups worth noting. Don't dump the full review.

### 2.2 Read where the project actually is
Ground the recommendation in reality, not vibes: read the project's source-of-truth docs (`CLAUDE.md`, any `KICKOFF.md` / plan / milestone tracker), the current milestone, the **riskiest unproven assumption**, and any prerequisite state that gates the obvious next step (e.g. a missing API key, thin seed data, an un-run migration). Check these quickly rather than assuming.

### 2.3 Present options with honest ultracode calls
Offer **2–3 distinct next-step options** (occasionally 4). For **each**:
- a short label + 1–2 sentence merits/tradeoffs,
- **why** it matters now (tie to the riskiest assumption / milestone discipline — don't recommend building ahead of validation),
- an explicit **ultracode-benefit verdict: low / moderate / high**, and *where* it would help (e.g. "low — this is your-voice judgment; the one useful workflow is a final safety scan" vs. "high — a failure-mode audit + parallel fixes is a clean fan-out").
- Mark your **(Recommended)** pick first, and say plainly what you'd do.
- Name any tempting-but-premature path and why you'd hold it (and offer to design it later with an ultracode panel once it's earned).

### 2.4 Let Kyle choose
Use `AskUserQuestion` to capture the pick. The auto "Other" option covers **"none of these"** → if he declines all, propose **2–3 fresh options** and ask again. Do not proceed to Act 3 until he's picked one.

---

## Act 3 — Handoff: the starter prompt

Once Kyle picks, produce **two things**:

### 3.1 A copy-paste starter prompt (in a fenced code block)
Self-contained enough for a **cold** session to orient fast, tuned to the chosen path. Include:
- the **goal** of that session, stated in one or two lines,
- **orientation**: which files/docs to read first (source-of-truth, the relevant module, the relevant plan section) and a "summarize back to me before changing anything" beat,
- the **non-negotiable constraints** that apply (pull the project's iron rules / privacy / local-first / git rules from `CLAUDE.md` — restate them so the cold session can't miss them),
- the **ordered steps**, including any prerequisite (key, data, migration) handled first and *proven* before investing further,
- an explicit **out-of-scope** list (so the fresh session doesn't wander into the next milestone),
- a clear **definition of done** for that session,
- guidance on **whether/where to use ultracode** in that session (matching your Act 2 verdict — and a note to stay collaborative if it's judgment work).

### 3.2 "How to run it optimally" (prose, outside the block)
Practical advice for getting the best result: when to run it (be present / reflective vs. fire-and-forget), prerequisites to pre-load, whether **voice mode** (`/converse`) suits it (great for conversational / extract-from-your-head work), rough time budget, whether to keep it collaborative vs. let it orchestrate, and what stays private/uncommitted. Close by naming the **natural session after that one**, and offer to generate its starter prompt when he's ready.

---

## Guardrails / lessons baked in
- **Don't yield while a review workflow runs** — bounded-block and finish in-turn. The merge is gated on the verdict; deferring it to a background task is incomplete work.
- **PR + `gh pr merge`, never `git push … main`** — the direct push is hook-blocked by design.
- **Clean tree only.** Re-verify `main` is in sync with origin, clean, and green after the merge — report it plainly.
- **Trivial blockers: fix and re-gate. Real blockers: stop and ask.** "Find no issues" means *resolve* them to clean or *surface* them — never merge with known issues.
- **Honest reporting.** If tests fail, say so with output. If you skipped a step, say so. State "shipped and verified" only when it's true.
- **At most one merge cycle per invocation** unless Kyle widens scope.
