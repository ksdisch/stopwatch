---
name: project-guide
description: Generate a comprehensive, point-in-time guide to ANY project at ANY stage — what it is and does right now (purpose, capabilities, architecture), the history of how it was built (big PRs, decisions, why-we-chose-X, tradeoffs), the concepts/vocabulary to discuss it fluently, and a candid recruiter/interview lens (what reads strong vs weak to a hiring manager who pokes at the repo, and how to talk about it). Built to help me learn and to be interview-ready about my own work. Saves to a dated file. Use when I want to understand, document, or prep to talk about a project as a whole — not a single session. Triggers on "project guide", "explain this whole project", "portfolio brief", "interview-prep me on this repo", "/project-guide".
allowed-tools: Bash, Read, Write, Glob, Grep, Task, Skill, ToolSearch, SendUserFile, mcp__plugin_voicemode_voicemode__service
---

# project-guide — the whole-project brief, history, and interview lens

Produce one document that lets me (a) understand a project end-to-end in its
current state, (b) tell the story of how and why it was built the way it was,
(c) build the vocabulary and mental models to discuss it fluently, and (d) walk
into a conversation with a recruiter or hiring manager who has the repo open and
hold my own — knowing both what looks good and what doesn't, and how to talk
about each honestly.

**Project-agnostic. Stage-agnostic.** Works on a 2-day-old scaffold or a
2-year-old codebase; scale the depth to what's actually there (see Scaling).
Work only from observable state — the repo, its git/PR history, its docs. Never
invent decisions or capabilities; an honest "not yet built" beats a confident
fiction (a hiring manager will run the code).

## Relationship to sibling specs
- `/wrap` — recaps **one session**; this recaps the **whole project**.
- `kickoff` — briefs a project at its **start**; this briefs it at **any point**.
- [[narrate]] — the audio engine; `--audio` here narrates the talking-points
  section so I can rehearse the pitch by ear.

## Parse `$ARGUMENTS`
- `--quick` → lighter pass: Snapshot + Capabilities + Architecture + a short
  recruiter lens. Skip the deep history mining. Good for small/early projects or
  a fast refresher.
- `--update` → a guide already exists for this project (find the latest in the
  save dir): refresh it, focusing on what changed since its date, and note the
  delta at the top rather than rewriting wholesale.
- `--audio [short|long]` → after saving, also narrate the talking-points (see
  "Audio" below). `short` = the elevator pitch; `long` = elevator + the 2–3
  headline decisions and their why.
- No args → full guide.

---

## 1. Orient silently (don't narrate the reads; mine, then write)

Gather evidence before writing a word. Pull what's cheap and high-signal first:

- **What/stack:** `README*`, `CLAUDE.md`, and manifests (`package.json`,
  `pyproject.toml`, `go.mod`, `Cargo.toml`, `requirements*.txt`, `Gemfile`,
  Dockerfiles, `*.tf`, CI workflows). These give purpose, language, deps,
  entrypoints, scripts, how it builds/runs.
- **Shape:** map the tree (top 2–3 levels; ignore `node_modules`/`dist`/`.git`).
  Identify the real source dirs, the entrypoints, the tests, the config.
- **Capabilities:** read the entrypoints and the largest/most-central modules to
  learn what it actually does today vs. what's stubbed, TODO, or feature-flagged.
- **History (the load-bearing mine):**
  - `git log --oneline --no-merges -50` and `git log --oneline --merges -30` for
    the shape of work and merge cadence.
  - `git log --stat` / `git shortlog -sn` for where the churn concentrated.
  - Tags/releases: `git tag`, and release notes if present.
  - **Pull requests** — the richest source of *why*. If `gh` is available:
    `gh pr list --state merged --limit 40` then `gh pr view <n>` on the big ones
    for titles + bodies + discussion. If `gh` is absent, use the GitHub MCP
    tools (`ToolSearch` → `search:mcp__github__list_pull_requests` /
    `pull_request_read`). Mine PR bodies for decisions, alternatives, tradeoffs.
  - **Docs of intent:** `docs/` (esp. ADRs, design docs, `docs/ideas/`,
    `docs/session-logs/` wrap logs — those already capture per-session *why*),
    `BACKLOG.md`/`TODO`, issue templates.
- **Quality signals (for the recruiter lens):** tests present + what kind,
  CI config, linters/formatters, typing, secret-handling (`.gitignore`,
  `.env.example`), commit-message hygiene, branch/PR discipline, README quality,
  license. Note both presence and absence.

If the project is large, this is the place to **fan out** (see Thorough mode).

## 2. Write the guide

Save to a dated file. Default
`docs/project-guide/YYYY-MM-DD-<project>-guide.md`; adapt to existing project
conventions if there's an obvious docs home. `<project>` = short kebab tag from
the repo/dir name. Don't dump the whole guide into chat — print the saved path,
the **elevator pitch**, and a 3–5 line "what's strong / what I'd flag" summary.
As the final step, `open <path>` (best-effort).

### Sections, in order

1. **Snapshot (TL;DR)** — 4–6 lines: what this is in one sentence, the stack,
   the current maturity (prototype / MVP / production-ish), how to run it, and
   the single most interesting thing about it. Someone should grok the project
   from this block alone.

2. **Purpose & problem** — what problem it solves, for whom, and why it's worth
   solving. The "why does this exist" a non-technical interviewer would ask.

3. **Capabilities — current state** — what it actually does **today**, as
   concrete bullets anchored to where it lives (`path:line` or module). Clearly
   separate **working** from **stubbed / planned / flagged-off**. Honesty here is
   the whole point — don't list aspirations as features.

4. **Architecture & how it works** — the mental model: major components and how
   they fit, the data/control flow, key external dependencies and why they're
   there, and the one or two non-obvious mechanisms worth understanding. A small
   ASCII or Mermaid diagram if it earns its place. Name the architectural style
   (e.g. "thin CLI over a service layer", "event-driven", "RAG pipeline").

5. **Build history & key decisions** — the narrative. Walk the milestones in
   rough order (anchor to PRs/tags/commits). For each significant decision:
   - **What** was decided and **when** (link the PR/commit).
   - **Why** — the reasoning, the constraints at the time.
   - **The alternative(s) rejected** and the **tradeoff** taken (e.g. "chose
     server-side validation over client trust — more latency, less attack
     surface"; "additive migration over destructive — slower rollout, zero data
     loss"). Name the pattern/principle if one applies.
   - Skip the trivia; surface the load-bearing calls. This is what makes me able
     to answer "walk me through why it's built this way."

6. **Concepts & vocabulary** — 6–12 terms that show up in this project, each a
   one-line definition + a one-line anchor to where it appears here. List the
   common industry name alongside any local jargon. This is the fluency layer.

7. **Recruiter & hiring-manager lens** — candid, two-sided, per area. A hiring
   manager may clone this and poke around; be ready. For the notable parts:
   - **Reads as a strength** — what an experienced reviewer would respect, and
     *why* (e.g. "tests gate CI", "clean separation of concerns", "thoughtful
     PR descriptions show decision-making", "honest README scoping").
   - **Reads as a weakness / risk / 'junior smell'** — be honest: missing tests,
     a god-module, secrets risk, copy-paste, no error handling, over-engineering
     for a toy, thin commit messages, an abandoned half-feature. Don't flatter.
   - **How to talk about it** — the honest framing for each weak spot: what I'd
     say, what I'd fix first, what tradeoff justified it at the time. Framing is
     *honest context*, never spin — the goal is to discuss it credibly, not hide
     it. Flag anything I should fix **before** showing this repo to anyone.

8. **Interview readiness** — 5–8 questions a sharp interviewer would ask about
   *this* project ("walk me through the architecture", "why X over Y", "what
   breaks at 100× scale", "what would you do differently", "show me the part
   you're proudest of"). List questions first; then a separator and a per-
   question answer scaffold (bullets I can speak from, grounded in the repo).

9. **Talking points** — two ready-to-speak blocks:
   - **Elevator (~30–60s, spoken):** what it is, why it's interesting, my role.
   - **Deep cut (~2 min):** the one architecture story + the one decision story
     I'd lead with. Sound spoken, not written. (This is what `--audio` narrates.)

10. **Gaps, debt & next moves** — what's half-done, the known tech debt, and the
    2–4 things I'd do next or differently, prioritized with rough effort. Owning
    this is itself a strong signal; it also pre-empts the "what's missing?" probe.

11. **Map of the codebase** — a short table of the key files/dirs and what each
    is for, so I can navigate fast when someone says "show me where X happens."

## 3. Audio (only if `--audio` was passed)
After saving, hand the **Talking points** (short) or Talking points + the top
decisions from §5 (long) to the [[narrate]] skill (`~/.claude/skills/narrate/`,
`voice=am_adam`, `out=~/Projects/_audio/<ISO-date>-<project>-guide.mp3`). Follow
narrate's "writing for the ear" rules — convert paths/PR numbers to speech, drop
SHAs. One line in chat with the MP3 path, then — on its own line, in a fenced
code block — a ready-to-run play command: `afplay "<full-path>"` (the real
absolute path), so I can copy-paste it to listen if I want to, or ignore it. If
Kokoro is down, say so and continue — the written guide stands; never claim an
MP3 exists if it doesn't (and print no play command).

---

## Thorough mode (large repos, or when I've opted into multi-agent)
If the repo is big **and** I've opted into orchestration (ultracode on, or I say
"workflow"/"thorough"), fan out the orientation in §1 instead of reading serially:
- One reader per subsystem (by top-level source dir) → returns a structured
  capability + architecture summary for its area.
- One **historian** agent → mines git + merged PRs into the decision timeline.
- One **recruiter-lens** agent → audits quality signals (tests, CI, secrets,
  hygiene) and drafts the two-sided §7.
- Then synthesize into the single guide above, deduping overlap.
Otherwise, do it inline. Never spawn agents for a small project — it's slower
than just reading it.

## Scaling
- **Tiny / early project** (days old, few files, little history): lean hard on
  Snapshot + Capabilities + Architecture; the history section may be 2–3 bullets
  and that's fine — say so rather than padding. Consider suggesting `--quick`.
- **Mature project**: prioritize the load-bearing decisions and the highest-
  signal recruiter notes over exhaustively listing every feature/PR. A guide
  past ~2500 words is usually including trivia — cut to what teaches or what
  I'd be asked about.

## Honesty rules (non-negotiable)
- Work from evidence; cite it (`path:line`, PR #, commit, tag). If you can't find
  the *why* behind a decision, say "rationale not recorded — likely X" and mark
  it a guess, don't fabricate a clean story.
- The recruiter lens must name real weaknesses, not just strengths. A guide that
  only flatters is useless for interview prep.
- Flag half-done work, debt, and anything risky to show (e.g. committed secrets,
  a broken build) prominently — those are the things that bite in an interview.
- Name tradeoffs explicitly; "we chose A" is incomplete without "over B, paying
  the cost of C."

## Output discipline
Match my `CLAUDE.md` preferences: structured (headings/tables/lists), concise but
thorough, explain reasoning, name tradeoffs, no filler or flattery. The artifact
is the deliverable — keep the chat reply to the path, the elevator pitch, and the
strong/flag summary.
