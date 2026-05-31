# Session Wrap-up — 2026-05-30 — Tempo: engineering-artifacts audit + Tier-1 docs shipped

## 1. What we did

- Ran a 6-agent parallel **discovery workflow** (docs-freshness · architecture · data-model · ops/infra · git-activity · test/quality) and wrote the full audit + plan to **`docs/artifacts-plan.md`** (Phase 2 project profile, Phase 3 taxonomy audit, Phase 4 tiered generation/maintenance plan).
- Executed **Tier 1** and merged it as **PR #106** (squash → `main` commit `964bf85`). Docs only — no `js/*.js`, no cached web file, so no `sw.js` cache bump.
- Promoted the gitignored `PROJECT_GUIDE.md` → committed **`README.md`** (un-ignored, renamed, original removed); refreshed every stale stat and fixed a factual error (`GoogleService-Info.plist` is committed, not local-only).
- Added an MIT **`LICENSE`**.
- Authored ADRs via a 4-agent workflow: **`docs/adr/`** `0000-template` + `0001` no-build/script-order, `0002` drift-free timing, `0003` Firestore backend, `0004` per-store merge, + index. Each carries verified `file:line` evidence.
- Fixed the ⚠️ stale-doc set: `CLAUDE.md` Script Load Order rewritten to match `index.html` + **15 missing modules** added to the file-map; `iOS-BUILD.md` dead worktree path → `git rev-parse`; `SESSION-LOG.md` orphan stub → labeled template + dual-system precedence note; archival banners on `CONSOLIDATED-FINDINGS` / `TEMPO-PLAN` / `ANALYTICS-PLAN` / `stopwatch-expansion-prompt`.
- Brought the 9 untracked dated **`docs/session-logs/`** files under version control (scanned for secrets first).

## 2. The why

- **Discovery as a parallel workflow, not serial reads.** The audit needed evidence spread across ~70 modules + 60+ docs; fanning out 6 agents with JSON-schema structured output returns *conclusions* (and `file:line` anchors), not file dumps. Tradeoff: token spend (ultracode was on) bought depth + cross-checking.
- **Paused at Phase 2 for the audience question.** Whether the repo is portfolio / personal-production / OSS is the single biggest lever on what artifacts matter, and the signal was genuinely mixed (public repo + recruiter-grade but *gitignored* guide that calls itself "a personal tool"). Aligning up front beats reworking the whole audit. Answer: **portfolio + personal-production** (not OSS) → README/LICENSE/ADRs *and* runbooks/data-contracts weighted high; OSS ceremony dropped.
- **Promote-and-patch the README, don't rewrite it.** The guide was already strong; `cp` + targeted edits preserved its voice and scoped risk to the stale spans only. Rejected: authoring a fresh README (more effort, more regression surface).
- **Retro-ADRs for shipped decisions.** ~9 hard-to-reverse decisions lived only in commit prose + `CLAUDE.md`; ADRs make the reasoning legible and are a portfolio signal. Did the 4 load-bearing ones now (M effort), deferred `0005`–`0009` to Tier 2.
- **Killed the test-count drift at the class level.** Docs variously claimed 137 / 265 / 543 / 642. Instead of picking one brittle pass-count, I quoted the **verifiable** figure (`~797 it() cases across 32 files`, grep-confirmed) and framed the runner as self-reporting — and honestly flagged ~4 known recovery-feed failures rather than claiming all-green.
- **Verified the discovery agents against disk before mutating.** Caught two wrong claims: the "phantom `rhythm-insights.js`" is only a *planned* file in backlog #13 (not in the file-map → nothing to remove), and `GoogleService-Info.plist` **is** tracked. Principle: agents locate; you confirm before you edit.
- **Surfaced `docs/session-logs/` instead of silently committing them.** They were untracked and not authored in this work; flagged for an explicit call, then folded in on your OK after a secret scan. Principle: don't absorb unreviewed content into a commit.

## 3. Concepts and vocabulary

- **ADR (Architecture Decision Record)** — a numbered, append-only doc capturing one durable decision (context / decision / consequences / alternatives). Today: `docs/adr/0001`–`0004`, MADR-lite format.
- **Mutable global proxy** — `let Stopwatch = createStopwatch(...)` reassigned on primary-instance swap so all UI follows without re-binding. Cited in ADR 0001; it's the `0005` candidate.
- **Drift-free timing** — elapsed *derived* from the wall clock (`offsetMs + accumulatedMs + (now − startedAt)`), never a `setInterval` counter; the RAF loop is cosmetic. ADR 0002.
- **LWW (last-write-wins)** — conflict resolution where the higher `updatedAt` wins the record. ADR 0004 — rejected as a *global* policy because it silently drops append-only data.
- **Append-merge / union-dedup** — merge event streams by unioning + deduping on `(deviceId, timestamp)` rather than overwriting. ADR 0004 (doseLog, naps, `bfrb_events`).
- **CAS (compare-and-swap)** — atomic conditional write (Firestore `runTransaction`) used for writeback; doc-level only, web-only on native. ADR 0003/0004; backlog #3.
- **Schema-version refuse-writeback (F19a)** — a downlevel client won't overwrite a record stamped with a higher `schemaVersion`, so it can't strip a newer client's fields. ADR 0004; `js/schema.js`.
- **No-build / script-order-as-dependency-graph** — `index.html` `<script>` order *is* the dep graph; IIFE globals + factory functions, no bundler. ADR 0001.
- **Structured-output workflow fan-out** — parallel subagents each returning a JSON-schema-validated object; validation happens at the tool layer so the model retries on mismatch. Today: the 6-agent discovery + 4-agent ADR runs.
- **Squash merge** — collapse a branch's commits into a single commit on `main`. Today: PR #106 (2 commits → `964bf85`).

## 4. Takeaways

- **Verify agent/subagent claims against ground truth before you mutate.** Agents are great locators, imperfect reporters. Today two confident claims were wrong (phantom module, plist tracking) and would have produced wrong edits.
- **Fix metric drift at the class, not the instance.** Don't hardcode the brittle number — quote the verifiable source (file count + "runner self-reports pass/fail") so the doc can't go stale on the next PR. Today: the 137/265/543/642 mess → one verifiable figure.
- **Promote-and-patch beats rewrite for a good-but-stale artifact.** Preserves voice, scopes risk to the stale spans. Today: README from `PROJECT_GUIDE.md`.
- **Surface content you didn't author; don't sweep it into a commit.** Flag it for an explicit decision, then scan for secrets before committing. Today: `docs/session-logs/`.

## 5. Suggested next moves

Tier 2 is already running in a fresh session, so these are about *sequencing within it* + adjacent cleanups:

1. **(Recommended) Land the CI workflow first inside Tier 2.** It closes the standing "a syntax error `git push`es live to Pages in ~1 min" risk and gives every other Tier-2 doc a *verifiable* headless test count (kills the drift permanently). Highest leverage, and you already opted in. Effort: **M**.
2. **Diagnose the 4 known `recovery-feed.test.js` failures.** They're the recurring "next standing cleanup" in the last several session logs and the asterisk on every test-count claim (incl. the README's). Small, high-clarity. Effort: **S–M**.
3. **Tag a release per `CACHE_NAME` slug.** Closes the zero-tags gap at ~zero cost and is the natural anchor for the Tier-2 `CHANGELOG`. Effort: **S**.
4. **Prune the ~12 merged local branches** (`feat/*`, `fix/*`, `claude/*`) flagged today — cosmetic but they clutter `git branch`. Effort: **S** (use `git branch -d`; squash-merged ones may need `-D`, which the safety net blocks — run manually).

## 6. 30-second elevator version

Today I audited my Tempo PWA for which engineering docs it *should* have, then shipped the first batch. I ran a fan-out of parallel agents to gather evidence — architecture, data model, ops, git history, test coverage — and turned that into a tiered plan committed as `docs/artifacts-plan.md`. Then I executed Tier 1: I promoted a recruiter-grade project guide that had been gitignored into a real committed README and corrected every stale number in it, added an MIT license, wrote four Architecture Decision Records for the load-bearing choices — the no-build script-order architecture, drift-free wall-clock timing, picking Firestore for sync, and the per-store merge strategy — and fixed a pile of doc drift like a file-map that was missing 15 modules. The interesting part was catching my own discovery agents in two factual errors by checking the repo before editing, and fixing the test-count drift by quoting a verifiable number instead of hardcoding another one that'd go stale. It all merged as one squash PR; Tier 2 — diagrams, data dictionary, runbooks, CI — is up next.

## 7. Active recall

1. Why did ADR 0004 reject *global* last-write-wins, and what does it use instead for medication dose logs?
2. Walk me through how the discovery → audit → Tier-1 work was structured, and why the workflow fan-out over just reading files yourself.
3. The repo had a recruiter-grade project guide already — why was it invisible on GitHub, and how did you handle that?
4. You found the docs quoted four different test counts. How did you resolve it so it won't drift again?
5. What would have gone wrong if you'd trusted the discovery agents' file-map findings verbatim?

---

*Try to answer each aloud before scrolling. Answer key below.*

### Answer key

1. **Global LWW silently destroys append-only data.** If device A logs a dose at 8am and device B (which never saw A's write) logs one at 8pm, whole-record LWW keeps one device's `doseLog` and discards the other's — the slower device's doses vanish. ADR 0004 uses **per-store** rules: `doseLog` (and naps, BFRB catches) are **append-merged + deduped on `(deviceId, takenAt)`**; only metadata/templates use LWW, and editable text wants per-field LWW. One policy can't serve event streams and editable records at once.
2. **Discovery (6 agents) → Phase-2 profile + pause for the audience question → Phase-3 audit + Phase-4 tiered plan (`docs/artifacts-plan.md`) → Tier-1 execution → squash PR #106.** The fan-out beats reading-it-myself because the evidence is smeared across ~70 modules + 60+ docs; parallel agents with JSON-schema structured output return *conclusions with `file:line` anchors* instead of raw file contents, and they cross-check each other (which is how two errors surfaced). Tradeoff: more tokens for more depth — acceptable under ultracode.
3. It was **`PROJECT_GUIDE.md`, gitignored** (an explicit `.gitignore` entry: "untracked planning doc kept locally"), so GitHub rendered nothing on the repo home and a recruiter saw a bare file tree. I **promoted** it: removed the `.gitignore` entry, `cp` to `README.md`, deleted the original (one source of truth), and made *targeted* edits only to the stale spans — preserving the good prose rather than rewriting.
4. Docs claimed 137 / 265 / 543 / 642. I stopped hardcoding a pass-count and instead quoted the **verifiable, reproducible** figure — `~797 it() cases across 32 files` (grep-confirmed) — and described the runner as **self-reporting** its live PASS/FAIL in the page title. That fixes the *class* of bug: there's no brittle number to go stale next PR. I also honestly flagged the ~4 known recovery-feed failures instead of claiming all-green. (Tier 2's CI step will print the count authoritatively.)
5. I'd have made wrong edits. The agents claimed a "phantom `js/rhythm-insights.js`" in the file-map (it only exists in backlog row #13 as a *planned* file — removing it would have deleted a legitimate plan reference) and claimed `GoogleService-Info.plist` was *not* committed (it is — the README would have shipped that error, the inverse of the bug I was fixing). Checking the repo before mutating caught both.
