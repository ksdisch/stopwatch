---
name: notebook-init
description: Initialize a new NotebookLM notebook end-to-end — interview, source curation, creation, baseline artifact generation, local sidecar. Use when the user wants to start a new NotebookLM notebook on any topic.
---

# notebook-init — Initialize a new NotebookLM notebook

Bootstrap a NotebookLM notebook with sources, baseline artifacts, and a local sidecar in `~/Projects/NotebookLMs/`. Templates provide sensible defaults; the user can always tweak. Reference `nlm-skill` for full tool/CLI documentation. Tool preference: **MCP-first** (`mcp__notebooklm-mcp__*`), fall back to `nlm` CLI via Bash where MCP doesn't cover something.

Every template includes a baseline audio overview.

## Templates

| Template | Purpose | Chat goal | Tags | Baseline artifacts |
|---|---|---|---|---|
| `research-project` | Deep investigation of a topic | `default` | `research` | Briefing Doc + deep_dive audio (default length) |
| `learning-topic` | Personal study / skill-building | `learning_guide` | `learning` | Study Guide + flashcards (`difficulty=medium`) + quiz (`question_count=5`, `difficulty=medium`) + mind map + deep_dive audio (default length) |
| `podcast-feed` | Listen-first ingestion of articles/videos | `default` | `podcast` | Brief audio (short) + Briefing Doc |
| `knowledge-base` | Long-lived reference for a domain | `default` | `knowledge-base` | Briefing Doc + data table ("Extract key entities, dates, decisions") + deep_dive audio (default length) |
| `custom` | Anything else | (ask) | (ask) | deep_dive audio (default length) + ask for others |

## Workflow

### 1. Preflight
- `which nlm` — abort with install instructions if missing.
- Auth check via `mcp__notebooklm-mcp__server_info` (or `nlm login --check`). If expired, tell user to run `nlm login` in their shell.
- `nlm login profile list` — if >1, ask via AskUserQuestion. Switch with `nlm login switch <profile>` if needed.

### 2. Discovery interview
Ask in order:
1. **Topic** — "What's the topic or subject?" (free text)
2. **Template** — AskUserQuestion with the 5 options + descriptions
3. **Title** — propose from topic; user confirms/edits
4. **Alias** — propose kebab-case from title; check `nlm alias list` for conflicts; auto-suffix `-2`, `-3` if collision
5. **Tags** — show template defaults; ask for additions/removals
6. **Purpose** — optional one-sentence purpose for the sidecar

### 3. Sources strategy
AskUserQuestion: **Research** / **Provide** / **Both** / **Skip**

**3a. Research path**
- Ask query (default = topic).
- Mode: `deep` for `research-project`, `fast` otherwise. Confirm with user.
- Call `research_start(query, mode, source="web", title=<title>)` — if no notebook exists yet, pass `title` so it creates one; otherwise pass `notebook_id`. Capture both IDs from the response.
- Poll `research_status` (`fast`: `max_wait=60`; `deep`: `max_wait=360`).
- **Handle the deep_report**: results may include an entry with `result_type=5` (`deep_report`) containing a `report` markdown field. `research_import` will NOT import it. Save its content locally to `artifacts/deep-research-report.md`, AND upload to the notebook as a text source via `source_add(source_type="text", title="Deep Research Report: <query>", text=<content>)`. This makes the synthesis available to downstream artifact generation.
- **Build tiered prepared list** (see "Prepared source list format"): group by High/Medium/Low value.
- **Present preset selection options** via AskUserQuestion: `Essentials` (High only), `Strong academic` (High + best Mediums), `Comprehensive` (High + all Medium), `Everything` (all). Do NOT ask per-index — AskUserQuestion is capped at 4 options.
- Call `research_import(source_indices=[...])` for the selected set.
- **Verify imports**: compare `imported_count` to the number of requested indices. If gap exists, identify which sources failed (Medium.com URLs and paywalled content fail silently). Surface the gap to the user, offer to retry the URL-based ones via `source_add(source_type="url", url=...)`, and log failures to the sidecar regardless.

**3b. Provide path**
- Ask for URLs (one per line) and any local file paths
- For each URL: fetch title + brief description via WebFetch (or `defuddle` if available)
- For local files: peek first ~50 lines / file metadata to summarize
- Build prepared list

**3c. Review prepared list** — table format (see below). Confirm before adding.

### 4. Create notebook + add sources
1. `notebook_create(title)` → capture `notebook_id`
2. `nlm alias set <alias> <notebook_id>` (CLI; MCP doesn't expose aliases)
3. `tag(action="add", notebook_id, tags)`
4. `chat_configure(notebook_id, goal=<template-default>)`
5. Loop sources: `source_add(...)` with 2s delay between calls

### 5. Baseline artifact generation
For each artifact in the template's baseline list: `studio_create(artifact_type=..., notebook_id, confirm=True, ...)`. Poll `studio_status` until all complete. If any fail, log to sidecar and continue.

### 6. Local sidecar
Create `~/Projects/NotebookLMs/<alias>/`:
- `README.md` (template below)
- `sources/` (empty dir for staging local files)
- `artifacts/` (empty dir for downloads)

Append to `~/Projects/NotebookLMs/INDEX.md`:
`- [<title>](<alias>/README.md) — <one-line purpose> — YYYY-MM-DD`

### 7. Customization round
Show summary (notebook URL, artifacts, sidecar). Then AskUserQuestion (multiSelect):
- Customize a report with a focus prompt
- Generate slides
- Generate video
- Generate infographic
- Additional audio format (debate / critique)
- Done

**Propose-defaults pattern**: for each selected customization, propose sensible defaults inline (focus prompt drafted from topic + template; slide format `detailed_deck`; infographic `sketch_note` style for learning topics, `professional` for knowledge bases; etc.) and **proceed without per-parameter approval**. Only stop to ask if the user explicitly indicates they want to change something. Per-parameter prompting fragments the flow.

Loop until "Done." Append every customization (with the actual prompts/params used) to the sidecar.

### 8. Final summary
- Notebook URL: `https://notebooklm.google.com/notebook/<id>`
- Alias: `<alias>` — use with any `nlm <command> <alias>`
- Sidecar: `~/Projects/NotebookLMs/<alias>/`

## Prepared source list format

| # | Title | Type | URL/path | Description | Why valuable | Value |
|---|---|---|---|---|---|---|
| 1 | ... | url | ... | 1–2 sentence summary | 1 sentence | High |

**Value tier heuristics:**
- **High** — authoritative (primary research, recognized publication/expert), directly on-topic, recent (<2y for fast-moving domains)
- **Medium** — solid secondary source, reasonable authority, partial topical fit
- **Low** — tangential, dated, or low-authority

**Preset selection** (use for research returning >10 sources):
- **Essentials** — High tier only
- **Strong academic** — High tier + best Mediums (~50%)
- **Comprehensive** — High tier + all Medium
- **Everything** — All tiers including Low

Present these 4 options via AskUserQuestion. The tool is capped at 4 options total, so do NOT try to enumerate individual indices.

## Sidecar README.md template

```markdown
---
notebook_id: <uuid>
alias: <alias>
title: <title>
template: <template-name>
created: YYYY-MM-DD
tags: [<tag1>, <tag2>]
profile: <profile-name>
---

# <title>

**Purpose:** <one-sentence purpose>
**NotebookLM:** https://notebooklm.google.com/notebook/<id>
**Template:** `<template-name>`

## Sources
| # | Title | Type | URL/Path | Notes |
|---|---|---|---|---|

## Artifacts
| Type | Format | Status | ID | Notes |
|---|---|---|---|---|

## Setup notes
<focus prompts used, research query, customization decisions>

## Customizations / follow-ups
(append as user requests more artifacts)
```

## Edge cases
- **Auth expired mid-flow** — pause; tell user to run `nlm login`; continue
- **Research returns nothing relevant** — offer retry with different query, switch to Provide, or Skip
- **Silent `research_import` failures** — `imported_count` < requested count means some URLs failed silently (Medium.com is a frequent culprit; paywalled content too). Compare counts, list which sources failed by title/URL, offer `source_add(source_type="url", ...)` retry, log to sidecar regardless.
- **`deep_report` not auto-importable** — `research_status` may return a `result_type=5` "deep_report" entry with synthesized content in its `report` field. `research_import` silently ignores it. Save locally to `artifacts/deep-research-report.md` AND upload as a text source via `source_add(source_type="text", title="Deep Research Report: <query>", text=<content>)` so it's available for downstream artifact generation.
- **Artifact generation fails** — log to sidecar, continue remaining, surface in summary
- **Alias conflict** — auto-suffix `-2`, `-3`; confirm with user
- **Title duplicates an existing notebook** — warn; offer rename or continue
- **User aborts mid-flow** — write minimal sidecar capturing whatever completed

## Rate limiting
- Source add: 2s between calls
- Generation call: 5s
- Research poll: 2s

## Notes
- This skill never deletes — only creates.
- All artifact generation uses `confirm=True` per nlm requirements.
- Reference `nlm-skill` for full tool/CLI documentation.
