---
name: kickoff
description: Turn a raw, half-baked project idea into a structured, de-risked launch. Runs a deep, adaptive, one-question-at-a-time discovery interview (for as long as the idea needs), pushes back on vagueness, produces an approved kickoff brief + phased plan (optionally stress-tested by a parallel ultracode pre-mortem / prior-art / scope / tech-stack panel), then — once Kyle confirms at a gate — scaffolds the project folder, git repo, and private GitHub repo with the brief inside. Use when Kyle types `/kickoff`, says "kickoff mode" / "new project idea", or describes a fuzzy idea he wants to flesh out before building (e.g. "I have an idea but it's half-baked", "help me think through a new project", "I want to start something but haven't figured out the details").
---

# Kickoff — raw idea → structured project launch

This is the **serious** end of project discovery. It takes a rough, poorly-articulated nugget of an idea and works *with* Kyle — interviewing, prompting, pushing back, iterating for **as long as it takes** — until the idea is de-risked enough to start building with a real chance of success and efficiency. Then it produces a structured brief, a phased plan, and (on confirmation) a scaffolded repo.

This is the real implementation of the "Kickoff Mode" in Kyle's global CLAUDE.md. When that section, the phrase "kickoff mode", or `/kickoff` fires, run **this skill** — don't improvise the interview inline.

**The prime directive:** get Kyle and the idea *genuinely clear* before any code. A vague idea scaffolded fast is worse than a sharp idea scaffolded slow. Bias toward more interviewing, not less.

## How this differs from `/mini`

`/mini` is the *light* version: 4–6 questions → throwaway scaffold under `~/Projects/mini/`. Use `/mini` for weekend experiments. Use `/kickoff` when the idea is meant to *matter* — it gets the full adaptive interview, a real brief, a phased plan, and a top-level repo under `~/Projects/<slug>/`. If partway through it's clear this is actually a throwaway, say so and offer to drop to `/mini`.

## Working style (non-negotiable — Kyle has ADHD; respect it)

- **One question at a time.** Never a wall of questions. Never multiple asks in one turn. Each turn = one focused thing.
- **React, don't generate from a blank page.** When a question risks blank-page paralysis, offer 2–4 hypotheses/options for Kyle to react to instead of demanding he produce an answer cold. Use `AskUserQuestion` for bounded choices; free-form prompts for open/generative ones.
- **Push on vagueness — gently but really.** If an answer is fuzzy ("a tool to help with stuff"), don't accept it. Ask for a concrete example, a real moment, a specific user. Reflect the vagueness back: "that's still fuzzy to me — give me one concrete instance where you'd use it."
- **Keep momentum visible.** Periodically show a short "here's what I've got so far" recap so progress feels real and it never feels like an endless quiz. Show the readiness checklist (below) when energy flags or on request.
- **No preamble, no AI slop, precision over filler.** (Kyle's standing style preference.)
- **Let Kyle steer the depth.** He can say "good enough, move on", "go deeper here", "skip that", "show me where we are". Honor it. "However long necessary" is the default, but he holds the throttle.

## The interview: de-risking dimensions

Don't march these in robotic order. **First absorb everything Kyle already said** and restate the seed idea in one line so he can correct it. Then **attack the fuzziest / riskiest gaps first.** Skip anything already answered. The goal isn't to fill every box — it's to de-risk the idea. Cover what matters; let trivial dimensions go light.

1. **The idea, in one sentence.** Strip jargon. Force a single clean sentence. If Kyle can't, that's the first thing to fix.
2. **Why / the problem — and why now.** The single most important dimension. What pain or opportunity? Why does it matter to *Kyle*? **What made him think of it today?** The *why* defines what "done" means and what to cut. Dig here hardest.
3. **Who it's for.** Name a real user, even if it's "just me." Their context, their alternative today (what do they do *now* without this?).
4. **The job-to-be-done & the moment of value.** What does the user actually accomplish? Describe the single moment where they get value — concretely.
5. **Success criteria.** What does v1-done look like, observably? How will Kyle *know* it worked? Capture both "v1 success" and "would be amazing." Make these concrete and checkable, not aspirational mush.
6. **Scope — in and OUT.** What's explicitly IN v1, and — more valuable — what's explicitly OUT / deferred / never. Naming non-goals is the highest-leverage de-risking move. Push Kyle to cut.
7. **Shape / interface.** CLI, web app, script, dashboard, notebook, API, data pipeline? What does interacting with it look like? (Kyle's world is healthcare data/analytics — pipelines, dashboards, models are common shapes; don't assume, but offer them as options.)
8. **Inputs & data.** What data/inputs does it need, from where, in what format? Is the data available? Is access a risk?
9. **Integrations & dependencies.** External APIs, services, existing tools, accounts, credentials. What has to exist for this to work?
10. **Constraints.** Time, deadline, budget, skills to learn, tech he must/can't use, environment.
11. **Riskiest assumption.** The killer question: *"What's the one thing that, if it turns out not to be true, makes this whole project pointless?"* Then: how would we test that cheaply, first? This becomes Milestone 0.
12. **Open unknowns.** What does neither of us know yet that we'd need to find out?
13. **The thinnest valuable slice.** What's the smallest thing we could build that proves the core value? (Often = Milestone 1.)

Adaptive probing rules:
- When Kyle says "I don't know," offer hypotheses to react to — never leave him staring at a blank.
- When an answer opens a bigger question, follow it. Depth over coverage.
- When two answers conflict, surface the conflict plainly and let him resolve it.
- When the idea is clearly a data/analytics project, lean into data availability, grain, refresh, and "what decision does this inform" — but keep it general for non-data ideas.

## Readiness checklist (track silently; reveal on request or when synthesizing)

Mark each ✓ / ~ / ✗. Only move to synthesis when the **starred** ones are solid (or Kyle explicitly says "good enough"):

- ★ One-sentence idea is sharp
- ★ Why / problem is concrete and motivating
- ★ A real user is named with their current alternative
- ★ v1 success is observable and checkable
- ★ Scope OUT is defined (non-goals exist)
- ★ Riskiest assumption is identified
- Shape / interface decided
- Inputs & data sourced (or flagged as a risk)
- Integrations & dependencies listed
- Constraints captured
- Thinnest valuable slice identified

If the starred items aren't solid, keep interviewing. Surface the checklist when Kyle's energy flags so he sees the finish line.

## Synthesis checkpoint (in chat, iterate to approval)

When ready, render the **full draft brief + phased plan** in chat using the template below. Then:

> Here's the kickoff brief. Read it like it's a contract with future-you. What's wrong, missing, or too vague? (or "looks right")

Iterate on "tweak X" as many rounds as needed. For **high-stakes ideas**, offer the **stress-test** (next section) before final approval. **Do not advance to scaffolding until Kyle approves the brief.** When he approves, propose a kebab-case **slug** and a **tech stack** (recommend one with a one-line rationale) — confirm both before the gate.

### Brief template

```markdown
# Kickoff Brief — <Project Name>
*Created <YYYY-MM-DD> · status: scoped*

## One-liner
<single clean sentence>

## Why now / the problem
<the pain or opportunity, why it matters to Kyle, what triggered it>

## Who it's for
<named user(s), their context, what they do today without this>

## What success looks like
- **v1 done means:** <observable, checkable>
- **Would be amazing:** <stretch>
- **Explicitly NOT trying to:** <non-goals>

## Scope
**In (v1):**
- …
**Out / deferred / never:**
- …

## Shape
<CLI / web / script / dashboard / pipeline / API — and why>

## Inputs & data
<what data, from where, format, availability/access risk>

## Integrations & dependencies
<APIs, services, tools, accounts, credentials>

## Constraints
<time, deadline, skills, tech must/can't, environment>

## Riskiest assumptions & unknowns
1. <assumption> — *cheap test:* <how we'd validate it first>
2. …

## Open questions
- …

## Phased plan
### Milestone 0 — De-risk: <the riskiest assumption>
- <the cheapest thing that proves/kills the idea>
### Milestone 1 — <thinnest valuable slice>
- …
### Milestone 2 — <next>
- …

## Tech stack
<chosen stack + one-line rationale, or "undecided — see open questions">
```

## Stress-test the brief (optional — ultracode multi-agent)

Between the synthesis draft and final approval, the brief can be stress-tested by a parallel adversarial panel. This is **opt-in, not default** — it costs real tokens and is overkill for simple ideas.

**Offer it when** the stakes are high (Kyle's sinking real time in, it's public-facing, or building the *wrong* thing would be expensive), or when Kyle says "stress-test it" / "red-team this" / "is this even worth building." Otherwise go straight to the gate.

It requires ultracode (Kyle opts in with the keyword, or says yes when offered). Run it as a **single `Workflow` fan-out on the *draft* brief**, then **fold the findings into the brief yourself** — into *Riskiest assumptions*, *Open questions*, *Scope*, and *Tech stack* — and show Kyle the enriched brief before the gate. Don't dump raw agent output on him.

Four lenses, run in parallel:
- **Pre-mortem** — "it's 6 months later and this failed — why?" → risks he didn't name.
- **Prior-art** — web-search for tools that already solve it → kill-or-differentiate signal.
- **Scope-creep critic** — attacks "In v1", proposes the leanest slice that still tests the riskiest assumption.
- **Tech-stack panel** — 2–3 stacks scored on fit / Kyle's familiarity / speed-to-v1 / risk.

Script template (pass the draft brief as `args.brief`; tune the lens prompts to the actual idea):

```js
export const meta = {
  name: 'kickoff-stress-test',
  description: 'Adversarially stress-test a draft kickoff brief before committing to build',
  phases: [{ title: 'Stress-test' }],
}

const brief = args.brief // full draft brief markdown, passed in via Workflow args

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    headline: { type: 'string', description: 'one-line bottom line for this lens' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          point: { type: 'string', description: 'the observation/risk/option' },
          soWhat: { type: 'string', description: 'what it means for the brief — a risk to add, a cut to make, a decision to force' },
        },
        required: ['point', 'soWhat'],
      },
    },
  },
  required: ['lens', 'headline', 'findings'],
}

const LENSES = [
  { key: 'premortem',   prompt: `It is 6 months from now and this project FAILED. Write the post-mortem: the most likely reasons it died. Be specific and brutal — no generic "scope was too big". Draft brief:\n\n${brief}` },
  { key: 'prior-art',   prompt: `Use web search to find existing tools/products/libraries that already solve the problem in this brief. List the closest few with links; for each, say how this idea would have to differ to be worth building. If something already nails it, say so plainly. If you cannot reach the web, answer from knowledge and FLAG that the scan was offline. Draft brief:\n\n${brief}` },
  { key: 'scope-creep', prompt: `Attack the "In (v1)" scope. Which items are NOT needed to prove the core value? What should move to "Out/deferred"? Propose the leanest v1 that still tests the riskiest assumption. Draft brief:\n\n${brief}` },
  { key: 'tech-stack',  prompt: `Propose 2-3 viable tech stacks for this brief. Score each on fit, Kyle's likely familiarity (healthcare data/analytics background — strong in Python, SQL; dbt/Snowflake/BigQuery in play), speed-to-v1, and risk. Recommend one. Draft brief:\n\n${brief}` },
]

phase('Stress-test')
const results = await parallel(
  LENSES.map(l => () => agent(l.prompt, { label: `lens:${l.key}`, phase: 'Stress-test', schema: FINDINGS_SCHEMA }))
)
return results.filter(Boolean)
```

After it returns: synthesize the findings, update the brief, and tell Kyle **what changed and why** — e.g. "pre-mortem flagged X → added to risks; prior-art found Y already covers most of this → here's the differentiator; trimmed Z from v1." If the prior-art lens reports it ran offline, say so. Then proceed to the gate.

## Kickoff gate (required — do NOT skip; this creates a public-trail repo)

Creating the GitHub repo is hard to undo silently. Gate it with `AskUserQuestion` (never a bare single-word "yes" — a lone "scaffold"/"ship"/"go" can be an instruction, not consent). Present:

- **Scaffold it now** — create `~/Projects/<slug>/`, git repo, and private GitHub repo `github.com/ksdisch/<slug>`, brief inside.
- **Save brief only, scaffold later** — write the brief to `~/Projects/_kickoffs/` and stop. (Right when the idea's still early or Kyle wants to sit on it.)
- **Keep iterating** — back to the interview.

Confirm in the same gate: final **slug**, **stack**, and **GitHub visibility** (default private). If Kyle wants no GitHub repo at all, scaffold locally and skip `gh`.

## Scaffolding (only after the gate confirms "scaffold now")

Always do these two regardless of scaffold choice:
1. Ensure `~/Projects/_kickoffs/` exists, then write the brief to `~/Projects/_kickoffs/<YYYY-MM-DD>-<slug>.md`. This is the central, browseable backlog of refined ideas.

If "scaffold now":
2. Create the repo and seed it:
   ```sh
   mkdir -p ~/Projects/<slug>/docs
   ```
   - `~/Projects/<slug>/docs/KICKOFF.md` — the full brief (verbatim copy).
   - `~/Projects/<slug>/README.md` — seeded from the brief: project name, one-liner, "Why" section, "What success looks like (v1)", status line, and a pointer to `docs/KICKOFF.md`.
   - `~/Projects/<slug>/CLAUDE.md` — **project context for future sessions** (critical for continuity): one-liner, the current milestone, link to `docs/KICKOFF.md` as source of truth, the riskiest assumption to keep front-of-mind, and a "conventions: TBD" stub. Keep it tight.
   - A stack-appropriate `.gitignore` and a **minimal** starting point matching the chosen shape (e.g. `main.py` + `requirements.txt`, or `index.html`, or a `sql/` + `notebooks/` skeleton for a data project). **Minimal** — a real starting point, not `hello world`, but do NOT build features. Real building happens in a later session.
3. Initialize and publish:
   ```sh
   cd ~/Projects/<slug>
   git init -b main
   git add -A
   git commit -m "kickoff: <slug> — scaffold from brief"
   gh repo create <slug> --private --source=. --push
   ```
4. Closer (print exactly this shape):
   ```
   ✓ <slug> is kicked off
     local:   ~/Projects/<slug>/
     github:  <url>
     brief:   ~/Projects/_kickoffs/<date>-<slug>.md  (+ docs/KICKOFF.md in repo)

   Next: open the repo and run /begin, then start Milestone 0 — <riskiest-assumption test>.
   ```

## Edge cases

- **Slug collides** with an existing `~/Projects/` folder or a GitHub repo: stop, say so, suggest a variant (append a meaningful word, not a number).
- **Idea turns out throwaway-sized** mid-interview: say so, offer to drop to `/mini` instead of over-scaffolding.
- **Idea is actually a feature for an existing project** (e.g. it belongs in `clinical-data-etl`): flag it — this might be "new feature mode" against an existing repo, not a fresh kickoff. Offer that path.
- **Kyle says "just scaffold it, skip the questions":** don't. Do a compressed pass — fill the starred checklist items from whatever he's said, fill gaps with explicit *assumptions* (labeled as such), show the brief in one shot, and still run the gate. Never skip the gate; never silently create a repo.
- **"Show me where we are":** render the readiness checklist + current partial brief, then continue.
- **No GitHub wanted:** scaffold locally (`git init`, commit, no `gh`); note he loses remote-from-anywhere access.

## Files & locations this skill touches

- `~/.claude/skills/kickoff/SKILL.md` — this file.
- `~/Projects/_kickoffs/` — central backlog of briefs (created on first run).
- `~/Projects/<slug>/` — the scaffolded serious project (top-level, not under `mini/`).
- `github.com/ksdisch/<slug>` — the private repo (via `gh`, authed as `ksdisch`).

## Note on "available everywhere"

This skill is global (`~/.claude/skills/`), so it's callable from **every local Claude Code session in any repo**. Cloud/web sessions and collaborators only see skills *vendored into a specific repo* — if Kyle ever wants `/kickoff` available inside a particular repo's cloud sessions, vendor it there with `/claudify-repo`.
