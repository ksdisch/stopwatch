---
name: research-paper
description: End-of-project write-up for Kyle's reproduce-and-measure research projects (the forge-gap / decay-pin / ghost-patch lineage). From a COMPLETED repo's recorded results ONLY — no new measurements, no fabricated numbers, no fabricated citations — produce two Markdown deliverables and PR them for review (never merged): a professional research paper (abstract + full academic sections) and a presenter pack that makes Kyle fluent enough to defend the paper claim-by-claim. Use whenever Kyle types /research-paper, says "write the paper", "write up this project", "generate the research paper", "paper + presenter pack", "turn this repo into a paper", or closes a research project and wants the formal write-up — even if he doesn't name the skill. NOT for reading someone else's paper (paper-companion) and NOT for choosing the next project (seed-hunt). Built to run unattended (async, max effort); works interactively too.
---

# Research Paper — write up a finished project from its recorded results

You are running the write-up step in Kyle's research-reproduction pipeline: project
declared COMPLETE → **/research-paper** (this skill) → `/seed-hunt` (pick the next
paper). A project in this lineage re-implements a narrow primitive from a published
paper at hobby scale and *measures* the paper's claim honestly under pre-committed
statistical gates. The write-up must preserve exactly that honesty: it reports what
was measured — including the nulls — and nothing else.

**Deliverables:** (1) a research paper, (2) a presenter pack, (3) a review-only PR,
(4) a final report with provenance and flagged gaps. You take **no new measurements**
and you **merge nothing**.

Designed for an unattended max-effort run (cloud / autonomous session) — the
unattended rules in the global operating constraints apply. The only hard stop is in
Preflight; everything after it runs end-to-end without asking.

## Parse `$ARGUMENTS`

- **A path** → treat it as the project repo root. Default: the current repo.
- **Anything else** → operator notes: fold them into the mission (length overrides,
  emphasis, a section to add or skip, a specific audience for the pack). Notes tune
  the mission; they never override the Hard constraints below.

## Preflight

Run from the finished project's repo root. If the cwd is clearly not a project repo
(e.g. `claude-config` itself, or a repo with no recorded results anywhere) and no
path was given, stop and say so — in an unattended run, report the ambiguity as the
outcome rather than papering the wrong repo.

This skill assumes the project is **closed**. If the tree is dirty or the roadmap
shows a milestone mid-flight, surface that and stop — a paper over a moving target
misstates the record. (`/seed-hunt` Phase 0 owns the full closure audit; here one
mechanical look is enough.)

## Hard constraints (non-negotiable, in force through every phase)

1. **NO NEW MEASUREMENTS.** Do not run experiments, call any model or API, execute
   ablation scripts, or regenerate figures/results. Use only numbers already
   recorded in the repo.
2. **NO FABRICATED NUMBERS.** Every statistic — each delta, confidence interval, N,
   percentage, dollar figure — is lifted verbatim from a real file. Numbers you
   *derive* (even trivial arithmetic over recorded values) don't qualify: cite the
   recorded form or drop the claim. If a number you want isn't recorded anywhere,
   say so plainly in the text and flag it in the final report. Never estimate.
3. **NO FABRICATED CITATIONS.** Cite exactly what the repo records. If only an arXiv
   ID + title is on record (no author list), cite that and note it. If the repo
   names no source for a primitive, describe it as established/common practice and
   frame the work as reproducing a known pattern. Never invent titles, authors, or
   venues.
4. **PRESERVE THE HONESTY FRAMING (load-bearing).** The lineage's stance:
   "reproduced and measured a published primitive — not invented it"; gaps
   manufactured by injecting faults are disclosed AS manufactured; a null result (a
   mechanism that did nothing) is reported as a result, not hidden. Do not overclaim
   novelty, do not bury nulls, do not round a CI-overlapping result up into a "win."
5. **REPORT STATS HONESTLY.** Carry through the repo's recorded method — lineage
   standard: Wilson intervals per arm, a Newcombe interval on the between-arm
   difference, the N≥20 discipline, the noise-floor constraint; defer to whatever
   this repo actually recorded. A delta whose CI includes zero is a null/small
   effect and is stated as such; anything the repo pre-declared underpowered is
   stated as no-claim.
6. **CONSTRAIN LENGTH — precision over volume.** ~3,000–5,000 words for the paper,
   ~1,200–1,800 for the presenter pack. Judge on prose (`wc -w` over-counts table
   tokens). No padding, no sections the material doesn't earn.

## Phase 1 — Comprehend (read before writing a word)

**First, map this repo's actual ledger of record.** Layouts differ across the
lineage — never assume this repo matches the last one (past mission templates have
named a sibling repo's artifacts):

- Candidates: kickoff/milestone briefs; `docs/` writeups (ROADMAP / DECISIONS /
  LEARNING / session logs); committed result files (`docs/figures/*-data.json`,
  `data/*_results.json`, or equivalents); committed outputs of stats/ablation
  scripts.
- Prefer **nearest-to-raw**: committed result files over prose; briefs over
  `CLAUDE.md` (a guide, not the ledger). Where two sources disagree, trust the one
  nearest the raw result and note the discrepancy.
- Distrust stale directories — anything holding overwritten or mixed-session
  trajectories (historically `runs/`) is not a number source.
- You will state the chosen sources of truth in the final report.

Then read the project modules (agent, scenario, oracle, faults, stats, ablation —
or this repo's equivalents), the tests, the result files, and any figure images.
Build an accurate model of: the thesis, the task, each mechanism/arm, each
experiment — including which came back null — and the exact measured numbers.

## Phase 2 — Claims ledger (internal)

Before drafting, list every load-bearing factual claim the paper will make, and
beside each the exact number and the source file it comes from. This ledger is what
Phase 5 verifies against and what distills into the pack's provenance table.

## Phase 3 — The paper → `docs/paper/<slug>-paper.md`

Create `docs/paper/` (no `docs/`? use `paper/` at repo root). `<slug>` = repo
directory name. Empirical-methods structure, adapted to the material:

- **Title + Abstract** (150–250 words: problem, method, headline measured results
  with numbers, contribution)
- **Introduction** — the reliability-gap problem and the honest contribution
  ("reproduce and measure a published primitive; report the narrow, measured delta")
- **Background & Method** — the target paper's claim; the reproduced primitive; the
  arms/mechanisms; the measurement discipline as recorded (interval method, N
  discipline, noise floor, pre-committed gates)
- **Experimental Setup** — models tested, the task, each testbed as the repo defines
  them (clean / injected-fault / natural-gap / …); manufactured gaps labeled
  manufactured here and again in Results
- **Results** — every measured delta with its CI, INCLUDING the nulls, plus a
  results table. Embed existing figure images with honest captions and correct
  relative paths — captions must match what the figures actually show. If the repo
  has no figures, the paper is tables-only and its preamble says so; never generate
  figures.
- **Discussion** — the thesis as measured (e.g. matched-guardrail: each mechanism
  against the gap it targets), what the nulls mean, the un-validatable residual
- **Threats to validity / Limitations**
- **Reproducibility** — how a reader would re-run it; recorded costs if any
- **References** — honest ones only (constraint 3)

## Phase 4 — The presenter pack → `docs/paper/<slug>-presenter-pack.md`

Goal: Kyle can defend the paper claim-by-claim in front of a mentor.

- **60-second story** — the whole project in one spoken paragraph
- **Results at a glance** — the headline table (per-experiment verdicts)
- **Provenance table** — claim → number → source file, so any figure can be traced
  live
- **Anticipated Q&A** with crisp answers — at minimum: Why manufacture the gap? Why
  is a null a result? Why Wilson intervals? What is the un-validatable residual?
  Why these models? What would you do next / what are the roads not taken?
- **Vocabulary crib** — every jargon term in the paper, one plain-English line each

## Phase 5 — Verify (refute your own draft)

Walk the claims ledger against both finished files. Mechanically where possible:
every load-bearing number must grep or parse out of its named source — and since
pretty-printing defeats string-matching, **parse JSON sources rather than grepping
them** before calling a number missing. Hunt these specific failure modes (each has
been caught in a real run of this mission):

- **Derived-not-lifted numbers** — arithmetic you did that no file records → remove
  or replace with the recorded form
- **Imputed denominators** — a fraction whose denominator you inferred → cite the
  recorded form
- a CI-straddling delta stated as a win → restate as null
- a manufactured gap missing its "manufactured" label; a null missing from Results
- an invented or embellished citation

Fix everything that fails and re-verify. Do not claim done until this passes.

## Phase 6 — Deliver

- Create a `docs/paper` feature branch (suffix it if one already exists), commit
  both files with a descriptive message, push, open a PR.
- **Do NOT merge and do NOT push to `main`.** This PR is for Kyle's review — an
  explicit gate that overrides the global merge-autonomously workflow. Leave the
  repo on its default branch with a clean tree.
- **Final report:** both file paths; the PR link; the headline results exactly as
  written in the paper; the sources of truth you used; every flagged gap (numbers
  that weren't recorded, adaptations you made because this repo's layout differed
  from the mission's examples).

## Definition of done

Two Markdown files exist under `docs/paper/` (or `paper/`); every statistic in them
traces to a real repo file and survived the Phase 5 mechanical check; the honesty
framing, all nulls, and honest citations are intact; figure captions match what the
figures actually show (or the paper is declared tables-only); length targets are
respected on prose; a review-only PR is open; and the final report gives paths + PR
link + headline results + sources of truth + flagged gaps.
