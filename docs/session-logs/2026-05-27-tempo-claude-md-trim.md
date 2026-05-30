# 2026-05-27 — Tempo: trim CLAUDE.md, extract build history

## 1. What we did

- Diagnosed the "Large CLAUDE.md will impact performance (53.6k > 40k)" warning at Claude Code startup; root cause was the always-loaded `CLAUDE.md` at **54,132 chars**.
- Bucketed `CLAUDE.md` by section to find the highest-ROI cut: the "What Has Been Built" changelog (Phases 1–10) was **~20k chars** of historical narrative — the single biggest, lowest-operational-value chunk.
- Extracted that section **verbatim** into a new file `docs/BUILD-HISTORY.md` (77 lines), then replaced it in `CLAUDE.md` with a 14-line pointer + per-phase capability TOC.
- Verified equivalence: `diff` of the extracted file against the original `CLAUDE.md` lines 126–196 was empty (byte-identical). Same check repeated against `origin/main` after `main` advanced.
- Shipped via **PR #96** (squash-merged as `a4b154e` on `main`). Final `CLAUDE.md` = **35,647 chars** — well under the 40k threshold.
- Mid-task recovery: while building this PR, a concurrent Claude session committing in the **same shared working directory** hijacked my `HEAD`. My docs commit landed on top of `feat/meds-supply-manual-adjust` instead of `docs/trim-claude-md`. Recovered by creating an isolated `git worktree add /tmp/tempo-docs-fix origin/main` and cherry-picking my docs-only commit there, then fast-forward pushing the corrected branch. PR diff was verified docs-only before merge.

## 2. The why

- **Why extract, not delete?** `CLAUDE.md` is loaded into context on every Claude Code session — its size directly affects performance and attention. Phases 1–10 are pure historical narrative; that information is *already* preserved in git history and `docs/SESSION-LOG.md`. So the right move is to relocate, not destroy. Pattern: **"always-loaded files carry only what an agent needs to act now; archive history elsewhere."**
- **Why a per-phase TOC, not just a pointer line?** A bare pointer would force every future session to open the doc to know what features exist. A 14-line capability summary preserves the "what exists" glance at ~700 chars — cheap. Tradeoff: minor duplication that must be updated when a new phase ships; mitigated by the architecture file-map (which already records the current surface) being the canonical "what exists" source.
- **Why verbatim extraction (not summary)?** The detail in the changelog had real value to humans reading it later (PR numbers, design rationale per phase). Summarizing into the TOC would lose that detail; preserving verbatim in `BUILD-HISTORY.md` keeps it indexable. Pattern: **lossless refactor for docs — preserve everything, just relocate.**
- **Why an isolated worktree to recover?** The shared checkout was actively being mutated by another session. Trying to `git checkout` my branch back would race. A fresh worktree off `origin/main` is a hermetic environment for the cherry-pick — touches no other agent's state and is trivially removable. Pattern: **when shared mutable state is racy, fork an isolated copy instead of fighting for the lock.**
- **Why cherry-pick instead of rebuilding from scratch?** My commit `8b894e0` had a clean patch (`docs/BUILD-HISTORY.md` + `CLAUDE.md` only) against its accidental parent. Cherry-pick applies just that patch, re-parented onto current `main`. Rebuilding would have worked too but risked drift if I mis-typed the splice; cherry-pick is deterministic.
- **Why squash-merge?** Repo convention for docs PRs (per the existing memory note). One clean commit on `main`, no merge bubble. Tradeoff: loses the individual commit history within the PR, which is fine here because there was only one substantive commit.

## 3. Concepts and vocabulary

- **Context-load budget / system prompt size** — total characters injected into a model's context window before user input. In Claude Code, `CLAUDE.md` is part of this. Warning fired at >40k chars today.
- **Always-loaded vs on-demand documentation** — distinction between docs Claude *must* read every session (CLAUDE.md, the working agreement) vs docs Claude reads only when relevant (`docs/BUILD-HISTORY.md`, `SESSION-LOG.md`). Today's refactor moved 20k chars from the former to the latter.
- **Lossless refactor (extract-and-reference)** — relocating content without removing or rewriting it, leaving a stable pointer in place. Applied today to CLAUDE.md's changelog section.
- **Git worktree** — a second checkout of the same repo (`git worktree add <path> <ref>`) sharing one `.git` but having its own working directory and `HEAD`. Used today as an isolation primitive to escape a racy shared checkout (`/tmp/tempo-docs-fix`).
- **Cherry-pick** — apply the patch of an existing commit (diff vs its parent) onto a different branch, creating a new commit. Used to re-parent my docs commit (`8b894e0` → `a2bfcf3`) onto current `main` without dragging the unrelated meds work along.
- **Fast-forward push** — pushing a branch when the remote tip is a strict ancestor of the local tip; no `--force` needed, no rewriting of remote history. The corrected `docs/trim-claude-md` qualified because the prior empty branch (`a939b4f`) was an ancestor of the rebuilt commit.
- **Squash merge** — merging a PR by combining all its commits into one new commit on the target branch. Result: target branch sees a single atomic commit, not the PR's internal history. Why local `-d` (safe delete) refused the merged branch afterward: git doesn't recognize a squash as a merge of the original ref.
- **Race condition on shared mutable state** — when two processes mutate the same resource without coordination and the result depends on interleaving. Today's hijacked `HEAD` was a textbook case: two Claude sessions sharing one working directory both ran `git checkout`.
- **Reflog** — local-only log of every `HEAD` movement (`git reflog`). Used today as a forensic tool to reconstruct what happened during the hijack — showed the unexpected checkout between my commands.
- **Hermetic build / hermetic operation** — operation whose inputs and environment are fully controlled, no shared external state. The isolated `/tmp/tempo-docs-fix` worktree made the cherry-pick hermetic.

## 4. Takeaways

- **Treat the always-loaded prompt as a budget, not a scratchpad.** Anything an agent needs *this session* belongs there; anything it can read on demand should live in a referenced doc. Today: 20k chars of changelog moved out, warning cleared.
- **Lossless refactor beats "clean it up" when the content has future value.** Don't summarize-and-delete what you might want to read intact later. Extract verbatim, link prominently. Today: full Phases 1–10 prose preserved in `BUILD-HISTORY.md`.
- **When shared mutable state is being raced, isolate rather than synchronize.** Fighting for the working-tree lock loses; a temp worktree (or any orthogonal sandbox) cost nothing to spin up and dodged the race entirely. Generalizes to: dev databases, shared caches, any concurrent-writer scenario where coordination is harder than copying.
- **Verify the patch, not the path.** After branch chaos, the test that mattered was `git diff --stat origin/main HEAD` showing exactly `CLAUDE.md + docs/BUILD-HISTORY.md`. The route to get there (checkout, branch, cherry-pick, force-push) was incidental — the deliverable's correctness was a single content check.

## 5. Suggested next moves

- **(Recommended) Stop running multiple Claude sessions in the same git working directory.** Today's hijack will recur. Two safer options: (a) `git worktree add ../tempo-<purpose>` per session, each with its own checked-out branch; (b) the Claude Code agent option `isolation: "worktree"`. Effort: ~5 min of habit change; high blast-radius prevention.
- **Audit the next-largest CLAUDE.md section: per-file architecture annotations (~19k chars, lines 14–73).** Several `sync-*` and `meds.js` entries have grown from one-liners into paragraphs. Trimming back to one-liners while moving deep detail to a referenced `docs/MODULES.md` would reclaim another ~5–8k chars and give headroom for future growth. Effort: 30–60 min; needs care so invariants survive.
- **Add a CLAUDE.md size guardrail to CI or a pre-commit hook.** A script that fails if `wc -c CLAUDE.md` exceeds, say, 38k would catch regressions before they hit the warning. Effort: 15 min; cheap insurance against the file creeping back to 54k.
- **Document the worktree-recovery pattern.** Today's recovery (`git worktree add <tmp> origin/main && cherry-pick && push && remove`) is a reusable playbook for any "I committed on the wrong branch" situation. Half a page in `docs/` or in CLAUDE.md's "Subagent conventions" would help future sessions (yours or Claude's). Effort: 10 min.

## 6. 30-second elevator version

I trimmed Tempo's `CLAUDE.md` — the project context file Claude Code reads on every session — from 54k to 36k characters so it stops blowing past the 40k warning threshold. The cut was the "What Has Been Built" changelog, about 20k characters of historical narrative; I moved that verbatim into a new `docs/BUILD-HISTORY.md` and left a one-line-per-phase capability TOC in its place. Halfway through, another Claude session committing in the same shared checkout hijacked my `HEAD` and my docs commit landed on the wrong branch, so I recovered by spinning up an isolated `git worktree` off `origin/main`, cherry-picking just my docs-only patch, and fast-forward-pushing the corrected branch. The PR — #96 — squash-merged cleanly. The biggest takeaway is that the project-context file is a budget, not a scratchpad: history belongs in `docs/` and git, not in the always-loaded prompt.

## 7. Active recall

1. Why extract the changelog instead of deleting or summarizing it?
2. Walk me through how you recovered when your commit landed on the wrong branch — what tools, in what order, and why?
3. Why is a `git worktree` the right primitive for isolating from a racy shared checkout, as opposed to, say, `git stash` or just creating a new branch?
4. After the squash-merge, `git branch -d docs/trim-claude-md` refused to delete the local branch. Why? And why was `-D` safe to use here?
5. If you had to write a one-paragraph rule for what belongs in CLAUDE.md vs. what belongs in a referenced doc, what would it say?

---

Try to answer each aloud before scrolling. Answer key below.

### Answer key

1. **Verbatim extract** preserves the detail (PR numbers, design rationale per phase) for anyone reading it later, while a summary would lose it. Deleting would discard knowledge that's still useful, just rarely. The cost of keeping it isn't storage — it's the cost of *loading it into every Claude session*, which the extraction eliminates by moving it to a file Claude reads only when relevant.

2. (a) Diagnosed via `git reflog` — it showed a `checkout` between my commands that I hadn't issued, meaning a concurrent process moved `HEAD`. (b) Confirmed my commit `8b894e0` had a clean docs-only diff vs its accidental parent (`git show --stat 8b894e0`). (c) Created an isolated worktree off current `origin/main` (`git worktree add /tmp/tempo-docs-fix origin/main`) — this is a fresh checkout that doesn't share working-tree state with the racing session. (d) Cherry-picked `8b894e0` there; cherry-pick re-applies just the commit's patch (diff vs parent) onto the new base. (e) Verified `git diff --stat origin/main HEAD` showed only the two intended files. (f) Pushed the new commit to `docs/trim-claude-md` as a fast-forward (the old branch tip was an ancestor of the new commit since `main` had moved forward). (g) Opened PR #96, verified diff, squash-merged.

3. `git stash` stashes uncommitted work but doesn't help when the problem is *which branch you're on* — and any operation that touches the working tree still races the other session. A new branch in the same checkout has the same problem: the `HEAD` is shared with whoever else is operating in this directory. A `git worktree` gives you a separate working directory and a separate `HEAD` while sharing the object database, so you can `checkout`/`commit`/`cherry-pick` in complete isolation. It's the smallest unit of "different working tree" git offers.

4. `git branch -d` (safe) refuses to delete a branch that isn't an ancestor of `HEAD` or upstream — i.e., it thinks there are commits on the branch that would be lost. A squash merge produces a *new* commit on `main` that has the *same content* as the PR's commit but a *different SHA*, so the original commit (`a2bfcf3`) isn't in `main`'s history. From git's perspective, the branch was never "merged." `-D` (force) was safe here because we know the content is on `main` via the squash — even though git can't prove it.

5. CLAUDE.md is the part of the prompt that gets injected on every session — it's working memory for an agent acting *right now*, not a history of how the project got here. Anything an agent needs to act correctly without further reading (current architecture, invariants, conventions, live backlog) belongs in CLAUDE.md. Anything that's a record of what already shipped, design rationale for past decisions, or detail an agent would only need when investigating something specific belongs in a referenced doc that gets read on demand. Rule of thumb: if you can imagine a session where this content is irrelevant, it doesn't belong in the always-loaded file.
