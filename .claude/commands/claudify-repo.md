---
description: Set up this repo's Claude Code tooling. Run at a repo root — pick which of your global slash commands/skills to vendor into the repo (so they work in cloud/web sessions and for collaborators), and/or brainstorm new repo-specific automations via the recommender. Updates CLAUDE.md with a tooling reference section.
argument-hint: [optional: "port", "brainstorm", or blank for the menu]
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Task
---

Requested mode (optional): $ARGUMENTS

You are setting up Claude Code tooling for the repository at the current working
directory. First confirm you're at a repo root (a `.git` dir is present). If not,
say so and stop.

## Orient first (do this silently — don't narrate the reads)
- **Inventory my global tooling:** list `~/.claude/commands/` (each is a `*.md`) and
  `~/.claude/skills/` (each a folder with a `SKILL.md`). Read each one's frontmatter
  `description` so you can summarize them for me.
- **Inventory what's already in this repo:** `.claude/commands/` and `.claude/skills/`.
  Anything already vendored here should be marked as such — don't offer to re-add it.
- **Understand the repo:** skim its `CLAUDE.md` (or note the absence), README, package
  manifest, and top-level dirs — enough to know the stack and conventions.

## Pick a mode
Unless I named one in the argument above, ask me (AskUserQuestion) which to do:
- **Port** — vendor selected global commands/skills into this repo. *(Agent-free and
  cheap — just a picker + file copy.)*
- **Brainstorm** — propose new repo-specific automations. *(This is the only mode that
  spawns subagents — via the recommender — so it costs more; use it when you want it.)*
- **Both** — port first, then brainstorm.

---

## Mode: PORT — vendor global tooling into the repo

1. **Present the menu.** Show my global commands and skills as a multi-select
   (AskUserQuestion), each with its one-line description, skipping anything already in
   this repo. For each, flag:
   - ✅ **cloud-safe** — pure reasoning + repo edits; works in cloud/web sessions.
   - 💻 **local-only** — needs local tools (browser MCP / `kapture`, `computer-use`,
     Playwright/Puppeteer, screenshots, or a running local dev server). It can still be
     vendored, but it will NOT work in a cloud/web session — say so plainly so I'm not
     misled. Heuristic: scan the command/skill body for those tool references.
2. **Vendor what I pick** — copy faithfully, don't edit contents:
   - A command → copy `~/.claude/commands/<name>.md` → `.claude/commands/<name>.md`.
   - A skill → copy the whole `~/.claude/skills/<name>/` folder → `.claude/skills/<name>/`.
   - **Always, regardless of selection:** copy `~/.claude/operating-constraints.md`
     → `.claude/operating-constraints.md` (overwrite if present, to refresh a stale
     copy), so cloud/web sessions get the operating constraints too.
3. **Update CLAUDE.md.** Add or update a single section titled
   `## Claude tooling for this repo` listing the repo-local commands/skills with their
   one-liners, marking any that are local-only. Make it **idempotent** — if the section
   already exists, edit it in place rather than duplicating. If there's no CLAUDE.md,
   create a minimal one containing just this section. Also ensure CLAUDE.md contains
   this exact section (append at the end if missing — idempotent):

   ```markdown
   ## Operating Constraints

   @.claude/operating-constraints.md
   ```
4. **Commit.** Follow this repo's git conventions (branch naming + commit style from its
   CLAUDE.md). Create a branch if its rules call for one. **Stage only the files you
   added/changed** (the vendored files + CLAUDE.md) — never `git add -A`; the working
   tree may hold unrelated in-progress work. Do NOT push unless I explicitly say so.

---

## Mode: BRAINSTORM — new repo-specific automations

Don't reinvent this — route to the existing recommender:
- Invoke the **`claude-automation-recommender`** skill (via the Skill tool) to analyze
  this repo and propose Claude Code automations (commands, skills, hooks, subagents,
  MCP) tailored to it.
- When it returns proposals, present them and ask which (if any) to scaffold.
- For each I approve: create the command/skill under `.claude/commands/` or
  `.claude/skills/`, add it to the `## Claude tooling for this repo` section, and commit
  (same git rules as PORT — stage only what you created, don't push).

---

## Wrap up
Report what you vendored and/or scaffolded, the CLAUDE.md section you wrote, the branch +
commit, and anything local-only that won't run in cloud/web sessions.
