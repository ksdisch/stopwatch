# Session Wrap-up — 2026-05-31 — Tempo: artifacts Tier 3 + rules tests caught a live security bug

## 1. What we did

- Shipped **PR #108** (`b467735`): Tier 3 of the engineering-artifacts plan — 3 runbooks, 4 playbooks, a postmortem TEMPLATE + 1 worked example, root `CHANGELOG.md` + `ROADMAP.md`, `docs/reference/glossary.md`, and an optional `cliff.toml` + dispatch-only `release.yml`. Authored via a parallel **author → adversarial file:line verify → finalize** workflow (36 agents).
- Widened CI `markdown-links` (lychee) scope to the new docs; corrected fresh drift in `ARCHITECTURE.md` (ADRs 0005–0009 were still marked "Planned" though Tier 2 shipped them as Accepted).
- Shipped **PR #109** (`f837945`): artifacts-plan item 7 — the repo's first non-browser test suite (`tests/rules/firestore-rules.test.mjs`, `@firebase/rules-unit-testing` against the Firestore emulator) + a new `firestore-rules` CI job.
- The rules suite **caught a real security bug on its first CI run**: `firestore.rules` did not actually deny client writes to `recovery_state`. Fixed `firestore.rules` and the 4 docs/ADR that mis-described the mechanism.
- Shipped **PR #110** (`3f88c5f`): committed the one stray untracked Tier-1 session log.
- **Deployed the fixed rules live** to `tempo-sync-6f7b2` (`firebase deploy --only firestore:rules`) — the user ran the final command after the safety classifier required explicit human authorization for a production deploy.

## 2. The why

- **Author → adversarial-verify → finalize workflow (not solo authoring).** Each doc carries `file.js:line` evidence; a separate adversarial agent re-greps every anchor + git hash against disk before a finalize agent fixes drift. Pattern: *trust-but-verify with an independent checker*. Caught two agent errors I'd otherwise have shipped — a CHANGELOG citing an **off-main** commit (`695700a`, an unmerged PR #104 branch) instead of the squash that actually landed (`7e15926`), and a one-line cross-doc range mismatch. Tradeoff: ~2.3M agent tokens for depth + cross-checking (ultracode was on).
- **CHANGELOG keyed to `CACHE_NAME` build slugs, not invented semver.** The repo has 0 git tags; the `sw.js` `CACHE_NAME` slug (`stopwatch-vNNN-slug`) is the de-facto release id. Keying to reality beats fabricating version numbers. Rejected: git-cliff auto-generation as the source of truth (it groups by tags, which don't exist) — shipped it as an optional *drafting aid* instead.
- **Rules-unit tests revealed `recovery_state` was client-writable.** Firestore evaluates rules **cumulatively** (a write is allowed if *any* matching rule grants it; block order is irrelevant). The recursive catch-all `/users/{userId}/{document=**}` (`allow read, write`) also matched `recovery_state/*`, OR-overriding its `allow write: if false`. The `if false` was a no-op. The old docs' "declared before / block order is load-bearing" explanation was simply wrong about Firestore semantics.
- **Fix = exclude `recovery_state` from the catch-all's write grant**, not reorder. Switched the catch-all to `/users/{userId}/{collection}/{docId=**}` with `allow write: if isOwner(userId) && collection != 'recovery_state'`. A more-specific `if false` *cannot subtract* a broader grant — the only way to deny is to ensure no matching rule grants. Verified regression-free: every Tempo write is depth-2 `users/{uid}/{store}/{id}` (`js/sync-engine.js:801,1673-1717`), all still matched.
- **Corrected an Accepted ADR with a transparent dated note, not a silent rewrite.** ADR 0003's embedded snippet was the *buggy* version and its mechanism claim was false. ADRs are immutable-once-Accepted by convention, so I added a `(Corrected 2026-05-31: …)` note rather than pretending the original was right. Principle: *append correction, don't erase history.*
- **Did NOT auto-deploy the rules.** Deploying live security rules is outward-facing + hard-to-reverse; the safety classifier (correctly) required an explicit human "yes" and the user's own browser-OAuth credential. The committed-vs-live gap is exactly what the new `firestore-rules-publish` runbook warns about — and it was real until the user ran the deploy.

## 3. Concepts and vocabulary

- **Cumulative rule evaluation** — Firestore allows an operation if *any* matching `match` block grants it; there is no "deny wins" and **block order is irrelevant**. The root cause of today's bug.
- **Recursive wildcard (`{document=**}` / `{docId=**}`)** — a path segment that matches one-or-more sub-segments, so a catch-all silently matches deeply-nested docs (incl. `recovery_state/latest`). Why the carve-out had to be an *exclusion*, not a reorder.
- **Security-rules unit testing** — asserting `firestore.rules` against the **Firestore emulator** with `@firebase/rules-unit-testing` (`assertFails`/`assertSucceeds`, `withSecurityRulesDisabled` to seed Admin-style data). Today: `tests/rules/firestore-rules.test.mjs`, 8 cases.
- **Committed-vs-live drift** — the rules file in git and the rules enforced in the live project are two sources of truth synced only by a manual `firebase deploy`. The `firestore-rules-publish` runbook's central risk; made concrete today.
- **`CACHE_NAME` build slug** — `sw.js`'s cache key (`stopwatch-vNNN-slug`) doubling as the release id (the repo has 0 git tags). The anchor the new `CHANGELOG.md` sections key to.
- **Adversarial verification (agent workflow)** — a separate agent whose job is to *disprove* the author's citations, re-deriving each from disk. Caught the off-main commit hash. Industry-adjacent: "red-team / independent review."
- **Demo project (`demo-tempo`)** — a `demo-`-prefixed Firebase projectId runs the emulator fully offline with no real credentials; keeps rules tests from touching prod `tempo-sync-6f7b2`.
- **Blameless postmortem** — incident write-up focused on systems/process, not individuals; dated filename, links commits/PRs. Today's worked example: the 2026-05-17 cloud-sync race-fix cluster.
- **Non-interactive shell** — the Claude Code session shell (and `! `-prefixed commands) has no TTY, so `firebase login` (needs a browser + prompts) refuses with "Cannot run login in non-interactive mode." `deploy` is non-interactive and works once the credential is cached.

## 4. Takeaways

- **Tests that encode an *intended invariant* find bugs that match-the-current-behavior tests can't.** Today's suite asserted "recovery_state denies client writes" (the *intent*) and immediately failed against reality. Rule of thumb: write the assertion you *want* to be true, not the one you *observe*.
- **You can't subtract a permission grant — you can only avoid granting it.** In any allow-list/OR-evaluated policy (Firestore rules, IAM, RLS), a narrow "deny" never overrides a broad "allow." Express the exclusion in the broad rule itself.
- **An independent verifier beats a more-careful author.** The finalize agent re-deriving anchors from disk caught a confident-but-wrong commit hash the author "fixed" in the wrong direction. Generalizes to code review, fact-checking, CI gates: separate the producer from the checker.
- **Outward-facing deploys are a human checkpoint by design.** The safety classifier blocking the rules deploy until explicit authorization wasn't friction to route around — it's the line between "fix committed" and "fix live." Match: feature-flag/approval-gated rollout.

## 5. Suggested next moves

1. **(Recommended) Verify the live rules in the Rules Playground.** Simulate an authed client write to `users/{uid}/recovery_state/latest` → expect **DENY**; an owner read → **ALLOW**. *Why:* the deploy + server-side compile + emulator tests all agree, but a 60-second live spot-check closes the loop on a security change with zero ambiguity. *Effort: XS.*
2. **Diagnose the 4 known `recovery-feed.test.js` failures.** *Why:* they're the asterisk on every test-count claim (README/CLAUDE.md) and have recurred as "next cleanup" across several session logs; now that CI prints the canonical count, fixing them removes the last caveat. *Effort: S–M.*
3. **Tag releases per `CACHE_NAME` slug.** *Why:* the new `CHANGELOG.md` + `cliff.toml` are keyed to slugs, and `git-cliff` only groups by tags — cutting one annotated tag per slug at deploy time would make the auto-CHANGELOG actually slug-sectioned (today it'd emit one `[unreleased]` block). Closes the zero-tags gap at ~zero cost. *Effort: S.*
4. **Backfill a rules-unit test as a deploy gate habit.** *Why:* the suite proves the *committed* rules, not the *live* ones — consider a lightweight checklist or note in the runbook so "merge rules change" always pairs with "run `firebase deploy`." *Effort: XS (process, not code).*

## 6. 30-second elevator version

Today I finished the documentation-hardening pass on Tempo — my stopwatch/wellness PWA — shipping the last batch of engineering artifacts: runbooks, playbooks, a postmortem template with a worked example, a changelog, a roadmap, and a glossary, all generated by a workflow that fans out a writer agent and an adversarial verifier agent per document so every claim has a verified file-and-line citation. Then I added the repo's first security-rules unit tests — running the real Firestore emulator against my `firestore.rules` — and on the very first CI run they caught an actual bug: my "recovery state" feed, which is supposed to be read-only for clients, was silently writable. The cause is that Firestore evaluates rules cumulatively, so my recursive catch-all rule was OR-overriding the `if false` deny. I fixed it by excluding that path from the catch-all's write grant instead of relying on the more-specific deny, corrected the four docs and the ADR that had described the mechanism wrong, and deployed the fixed rules live. The nice part is the framing for an interview: I asked for "the optional heavier test item," and it paid for itself immediately by turning a confidently-wrong doc claim into a caught-and-fixed production security gap.

## 7. Active recall

1. Walk me through the `recovery_state` bug: what was wrong, and why did `allow write: if false` not prevent it?
2. Why fix it by adding `collection != 'recovery_state'` to the catch-all instead of reordering the blocks or relying on the `if false`?
3. The author agent "corrected" a CHANGELOG commit hash and got it wrong. How did the workflow catch that, and what was actually wrong?
4. Why does `firebase deploy` work from the Claude Code session but `firebase login` doesn't — and why did the deploy still require your explicit authorization?
5. Why is the CHANGELOG keyed to `CACHE_NAME` slugs instead of semver, and what does that imply for the `git-cliff` automation you added?

---

*Try to answer each aloud before scrolling. Answer key below.*

### Answer key

1. **`recovery_state` is meant to be a read-only feed** (an external Admin-SDK pipeline writes it; clients only read). The rules had a specific block `match /users/{uid}/recovery_state/{docId}` with `allow write: if false`, but **Firestore evaluates rules cumulatively** — a write is allowed if *any* matching block grants it. The general catch-all `/users/{userId}/{document=**}` used a recursive wildcard that *also* matched `recovery_state/latest` and granted `read, write` to the owner, so it OR-overrode the `if false`. The deny was a no-op; the owner could write their own feed. The emulator test (`assertFails` on the write) caught it.
2. Because in an OR-evaluated policy **a more-specific deny cannot subtract a broader grant** — you can only deny by ensuring *no* matching rule grants. Reordering does nothing (block order is irrelevant in Firestore). So the exclusion has to live *in the broad rule itself*: `allow write: if isOwner(userId) && collection != 'recovery_state'`. Switched the catch-all to `{collection}/{docId=**}` so `collection` is bindable for the comparison. Verified regression-free because every real write is depth-2 `users/{uid}/{store}/{id}`.
3. The workflow runs an **adversarial verify** agent per doc that re-derives every git hash with `git show -s` against disk, then a finalize agent. The CHANGELOG author had "corrected" the v104 commit to `695700a` — but that's the **unmerged PR #104 feature branch commit, not on main**. The verifier/ROADMAP cross-check surfaced the disagreement; ground truth was that pomo-revert shipped to main via the squash `7e15926` (PR #105). Lesson: the independent checker beat the careful author.
4. **`firebase login` is interactive** — it needs a TTY for prompts and to drive a browser-OAuth handshake; the Claude Code session shell (and `! ` commands) is non-interactive, so it errors out. **`firebase deploy` is non-interactive** and only needs the credential already cached on disk (from a prior `login` in a real terminal). The deploy *still* required explicit authorization because **pushing live security rules to a production project is a high-severity, outward-facing action** — the safety classifier demands an unambiguous human "yes," not an inferred one from "can you take care of it."
5. The repo has **0 git tags**; its real release anchor is the `sw.js` `CACHE_NAME` slug (`stopwatch-vNNN-slug`), bumped on every cached-file change. Keying the CHANGELOG to that matches reality instead of inventing semver. Implication: **`git-cliff` groups commits by git tag**, so until you cut one tag per slug, a `git-cliff` run produces a single `[unreleased]` section — which is why I shipped it as an optional *drafting aid*, honest about the prerequisite, not as the canonical CHANGELOG.
