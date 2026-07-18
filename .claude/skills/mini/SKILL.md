---
name: mini
description: Kick off a new mini coding project under ~/Projects/mini/ — runs a short discovery interview (idea, problem it solves, what triggered the idea, scope, tech) and then scaffolds the folder, git repo, and private GitHub repo via the `new-mini` helper. Use when the user invokes `/mini` or asks to start a new mini / scratch / experiment / weekend project.
---

# Mini project kickoff

This skill takes a half-formed idea and turns it into a scaffolded mini project under `~/Projects/mini/` with a local folder, git repo, and a private GitHub repo at `github.com/ksdisch/<slug>`.

The goal: **get Kyle and Claude on the same page before any code is written**, then hand off to the `new-mini` helper to do the mechanical scaffolding.

## When this skill fires

- User types `/mini` (possibly followed by an idea or a slug)
- User says something like "start a new mini project", "new scratch project", "let's prototype X as a mini"

## What this skill does NOT do

- This is **not** Kickoff Mode from Kyle's global CLAUDE.md. Kickoff Mode is for serious projects with full discovery. Mini projects are smaller-scope experiments — keep the interview tight (4–6 questions max). If the user wants the deeper interview, they'll say "kickoff mode" instead.
- Don't write production-grade scaffolding. These are throwaway-friendly experiments. A `main.py` with a `TODO` is fine; a fully wired CLI framework is overkill.

## The discovery flow

Ask questions **one at a time** using the AskUserQuestion tool, keeping each focused. Cover these five topics in order — but skip any the user has already answered in their initial prompt:

1. **The idea in one sentence.** "In one sentence, what's the mini project?"
2. **What problem does it solve / what made you think of it?** This is the most important question — the *why* tells you what "done" looks like and what to cut. If the user gave a vague idea ("I want to play with X"), ask what made them want to play with X today specifically.
3. **What does success look like?** A working demo? A specific output? Something to show someone? Just learning? Knowing this prevents over-engineering.
4. **Tech / template.** Offer the four templates as options:
   - `python-script` — single-file Python utility, has `main.py` + `requirements.txt`
   - `html-demo` — `index.html` + `style.css` + `script.js`, served locally
   - `node-cli` — Node.js CLI with `package.json` + `index.js`
   - `blank` — just a README, you decide the structure
   If the idea clearly maps to one (e.g. "a script that…" → python-script), recommend that one as the first option.
5. **Slug.** Propose a kebab-case slug derived from the idea. Confirm or let the user override. The slug becomes both the folder name suffix (`YYYY-MM-DD-<slug>/`) and the GitHub repo name.

Use AskUserQuestion with structured options where the choices are bounded (template selection, slug confirmation). Use free-form follow-ups for open questions (idea, problem, success).

If the user gave enough info in their initial prompt to answer multiple questions, skip those — don't make them repeat themselves.

## The spec checkpoint (required)

After the interview, **before** running `new-mini`, summarize back to the user in this exact shape:

```
**Mini project plan**

- Idea: <one-line>
- Why: <what problem / what triggered it>
- Done means: <what success looks like>
- Template: <python-script | html-demo | node-cli | blank>
- Slug: <kebab-case>
- Will create: ~/Projects/mini/YYYY-MM-DD-<slug>/  +  github.com/ksdisch/<slug> (private)

Look right? (yes / tweak X)
```

Wait for confirmation. If they ask for tweaks, adjust and re-summarize. **Do not** run `new-mini` until they confirm.

## Scaffolding (after confirmation)

1. Run the helper:
   ```sh
   ~/Projects/mini/new-mini <slug> <template>
   ```
   The script does: `cp` from template → `{{NAME}}` substitution → `git init` + commit → `gh repo create --private --source=. --push` → updates the index README.

2. After the helper succeeds, **flesh out the scaffold** to match the spec, but keep it minimal:
   - Replace the placeholder `main.py` / `index.html` / `index.js` with a starting point that reflects the actual idea (not just `hello from template`).
   - Update the project's `README.md`: replace the "TODO: one-line description" with the real description from the spec, and add a `## Why` section with the problem/motivation.
   - **Don't** add features beyond what the spec calls for. Don't add tests, CI, or extra dependencies unless the user asked.

3. Commit the fleshed-out scaffold with a message like `"scaffold: <slug> starting point"` and push.

4. Print a short closer:
   ```
   ✓ <slug> is live
     local:  ~/Projects/mini/YYYY-MM-DD-<slug>/
     github: <url>

   Open the GitHub repo in Claude Code on web/phone to keep working from anywhere.
   ```

## Edge cases

- **Slug collides** with an existing folder or GitHub repo: tell the user, suggest a variant (append a word, not a number).
- **User wants no GitHub repo**: respect it. Skip the `gh repo create` step by running `new-mini` and then immediately running `gh repo delete` is wrong — instead, scaffold manually (`cp`, `git init`, commit, no `gh`). Note that they'll lose the remote-control benefit.
- **User says "just make it, skip questions"**: pick reasonable defaults from whatever they did say, summarize the plan in one line, and wait for a yes/no before scaffolding. Never skip the confirmation checkpoint entirely — the scaffold creates a public-trail GitHub repo, which is hard to undo silently.

## Files this skill touches

- `~/Projects/mini/` — the mini-projects parent folder
- `~/Projects/mini/new-mini` — the scaffolding helper script (don't modify; just call it)
- `~/Projects/mini/_templates/` — template directories (don't modify mid-flow; suggest edits as a separate task)
- `~/Projects/mini/README.md` — auto-updated by `new-mini`
