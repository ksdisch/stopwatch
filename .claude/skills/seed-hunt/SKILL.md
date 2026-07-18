---
name: seed-hunt
description: End-of-project seed hunt for Kyle's reproduce-and-measure research projects (the forge-gap / decay-pin lineage). Verifies the just-finished repo is truly closed, harvests its hard-won lessons into the living selection bar (references/selection-bar.md), sweeps arXiv for candidate papers, scores a 3–5 item shortlist against the bar, presents a decision brief for Kyle's pick, and closes with a /handoff prompt routed toward /kickoff. Builds NOTHING. Use whenever Kyle types /seed-hunt, says "seed hunt", "find my next paper", "what should I reproduce next", "ready for the next project", or wraps up a research-reproduction project and asks what to build next — even if he doesn't name the skill.
---

# Seed Hunt — find the paper the next project reproduces

You are running the between-projects step in Kyle's research-reproduction pipeline. A
project in this lineage takes one published paper (or a 2–3-paper set forming one thesis),
re-implements a narrow primitive from it at hobby scale, and *measures* the paper's claim
honestly under pre-committed statistical gates. The recipe's track record lives in
`references/selection-bar.md`, alongside the selection bar itself.

**You BUILD NOTHING in this skill.** The deliverables are: (1) an updated selection bar,
(2) a vetted shortlist, (3) Kyle's sign-off on one pick, (4) a closing `/handoff` prompt
for the planning session. Design, thesis, and stage-ladder belong to the NEXT session,
routed through `/kickoff`.

Kyle's global CLAUDE.md binds throughout: plain English, define every jargon term on
first use, decision-brief format for real choices (2–3 options, trade-offs, one
"(Recommended)"). Kyle decides; you recommend.

## Parse `$ARGUMENTS`
- `--audio [short|long]` → when the Phase 3 decision brief is ready, also narrate it as
  an MP3 so Kyle can weigh the shortlist by ear before picking (see "Audio brief" in
  Phase 3). `short` (default) = each candidate in a sentence or two plus the
  recommendation and its why (~2 min); `long` = the full brief — per-candidate merits
  and trade-offs against the bar, plus the single-vs-set and reuse-vs-range calls
  (~4–5 min). Without `--audio`, ignore all audio steps — the skill behaves exactly
  as before.

## Phase 0 — verify the project is actually closed

Run from the just-finished project's repo root. If invoked elsewhere, ask which repo just
finished before doing anything.

Check mechanically, don't assume:
- `git status` clean on the main branch; no open PRs (`gh pr list`).
- The final milestone is declared DONE in `ROADMAP.md` (or the repo's equivalent), with a
  decision on record for *why* the project closed (decay-pin's D21 is the model).

If any check fails, STOP and surface what you found — offer `/ship-and-route` (to land
loose work) or `/wrap` (to close the session properly) instead. A hunt started mid-project
splits attention, and the handoff prompt it produces would lie about the starting state.

## Phase 1 — harvest lessons into the selection bar

The bar is a living file: `references/selection-bar.md` in this skill's directory. It
compounds across projects — this is how forge-gap's lessons survive even though that repo
is archived. The harvest is what keeps it alive; skipping it is how the bar goes stale.

1. Read `references/selection-bar.md` in full.
2. Read the finished repo's `ROADMAP.md`, `DECISIONS.md`, `README.md`, and
   `docs/KICKOFF.md` (or equivalents). You're looking for lessons that generalize to
   *paper selection* — not implementation trivia. Signals: decisions that rejected options
   for reasons that would apply to any paper (confounds, gradability, statistics),
   surprises that changed the plan, risks that fired or conspicuously didn't.
3. Draft the harvest as a diff against the bar: **new** lessons, **sharpened** existing
   ones (add this project's evidence), **retired or downgraded** ones (say why — e.g.,
   decay-pin downgraded forge-gap's "capability cliff" concern after all three cheap
   models held clean floors). Also draft the new row for the project ledger.
4. Present the diff to Kyle in plain terms and get his sign-off — this is a gate. Then
   apply it to `references/selection-bar.md`, including the ledger row and the "current
   weight" note on the range-vs-reuse entry.

## Phase 2 — the arXiv sweep

Work from the updated bar. Read a candidate's PDF only once it's shortlisted — titles and
abstracts are enough to score against the bar for a first pass.

- Start at `https://arxiv.org/catchup` — group **Computer Science**, category
  **Artificial Intelligence** (cs.AI), recent days→weeks. If the catchup form is awkward
  to drive, `https://arxiv.org/list/cs.AI/recent` is an equivalent listing — adapt, don't
  stall. Sweep cs.CL too if cs.AI runs thin.
- For each plausible candidate, open the abstract page and score it against the bar. Keep
  brief per-candidate notes (one line per bar criterion it clears or fails) — these feed
  the decision brief.
- Shortlist 3–5 candidates. A 2–3-paper set counts as one candidate when the papers
  combine into a single thesis; say explicitly why they cohere.

## Phase 3 — the decision brief

Present the shortlist via AskUserQuestion: 2–4 options, each with plain-English merits
and trade-offs, one "(Recommended)" with the reason. The brief must explicitly cover:

- **The pick** — which paper (or set) becomes the seed.
- **Single paper vs set** — if a set is on the table, why it's one thesis and not two
  projects.
- **Reuse-harness vs new-surface** — reusing the tool-loop + Wilson/Newcombe harness is
  fast but "more of the same"; a new surface (RAG / memory / multi-agent / evals) shows
  range at higher build cost. State the current weight of this trade-off from the bar
  file (it shifts as the harness gets reused more times). This is Kyle's call, never
  yours.

### Audio brief (only if `--audio` was passed)
Before presenting the AskUserQuestion gate, write a speakable version of the brief at
the requested level and hand it to the `narrate` skill (`~/.claude/skills/narrate/`,
`voice=am_adam`, `out=~/Projects/_audio/<ISO-date>-seed-hunt-brief.mp3`). Follow
narrate's "writing for the ear" rules — no Markdown or bullets, prefer paper titles
over arXiv IDs (speak an ID only if it's the natural handle), short natural sentences.
One line in chat with the MP3 path, then — on its own line, in a fenced code block — a
ready-to-run play command: `afplay "<full-path>"` (the real absolute path), so Kyle can
copy-paste it to listen if he wants to, or ignore it. Then present the gate. If Kokoro
is down, say so and continue — the written brief stands; never claim an MP3 exists if
it doesn't (and print no play command).

PENDING-KYLE: the pick. Don't proceed past this gate without it.

## Phase 4 — hand off

After sign-off, run `/handoff` to produce the prompt for the NEXT session. That session's
job is the new project's skeleton, thesis, and stage-ladder — likely routed through
Kyle's `/kickoff` skill (deep interview, then scaffolds `~/Projects/<slug>` + private
GitHub repo). The handoff prompt should carry: the chosen paper(s) with arXiv IDs and
one-paragraph summaries, the scoring notes from Phase 2 (why it cleared the bar, and any
bar criteria it only *narrowly* cleared — those become the fit-pilot's risks), the
reuse-vs-range decision, and a pointer to `references/selection-bar.md` as the honesty
contract the new KICKOFF must inherit.

The hunt ends when the handoff prompt is delivered. Do not start designing the project.
