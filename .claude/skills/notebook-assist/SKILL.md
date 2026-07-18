---
name: notebook-assist
description: Assistant for existing NotebookLM notebooks. Three modes — refine a specific artifact idea into concrete params + focus prompt, brainstorm new artifacts by reading the notebook and proposing ideas, or manage sources (add/list/refresh/remove). Use when the user wants help working *with* an existing notebook (not creating a new one — use [[notebook-init]] for that).
---

# notebook-assist — Helper for existing NotebookLM notebooks

For notebooks that already exist. Three branching workflows; user picks one (or chains them). Tool preference: **MCP-first** (`mcp__notebooklm-mcp__*`); CLI fallback for aliases. Reference [[notebook-init]] for sidecar conventions and `nlm-skill` for full tool docs.

## When to use which sibling skill

- [[notebook-init]] — create a brand-new notebook from scratch
- [[interview-prep]] — create or extend an interview-prep notebook (specialized template)
- [[audio-series]] — generate a whole episodic *audio* series/season (+ optional per-episode study aids) for an existing notebook
- **notebook-assist** (this skill) — work *with* a notebook that already exists: refine an artifact idea, brainstorm new ones, manage sources
- [[notebook-merge]] — fold 2+ overlapping notebooks into ONE (sources, notes, regenerated artifacts, archival) — bigger than a source-management job

## Workflow

### 1. Identify the notebook
AskUserQuestion: `Use alias` / `Pick from list` / `Most recently used`.
- **Alias** — ask user; resolve via `nlm alias list` → notebook_id
- **List** — call `notebook_list`; show 10 most recent (title + alias + updated date); ask which
- **Recent** — read `~/Projects/NotebookLMs/INDEX.md`; pick the bottom-most entry; confirm

Capture: `notebook_id`, `alias`, sidecar path (`~/Projects/NotebookLMs/<alias>/`).

**If no sidecar exists** — AskUserQuestion: `Create one now (back-fill from notebook state)` / `Continue without sidecar (changes won't be logged locally)`. If create: call `notebook_describe` to get sources + artifacts; write a minimal sidecar using [[notebook-init]]'s template.

### 2. Pick a mode
AskUserQuestion (single-select):
- **Refine an idea** — I have an artifact idea, help me shape it
- **Brainstorm** — I want more artifacts but don't know what
- **Manage sources** — add, list, refresh, or remove sources
- **Multiple** — chain modes (e.g., add sources then brainstorm against the new state)

If `Multiple`: run modes in order, loop "another mode?" until done.

---

## Mode A — Refine an artifact idea

### A1. Capture the idea
Ask: *"Describe the artifact you're picturing — purpose, audience, depth, format hints, anything that comes to mind."* (free text)

### A2. Map to artifact type
Read the idea. If type is ambiguous, AskUserQuestion with 2–4 likely candidates from the table below. Otherwise propose the type and confirm in one short sentence.

| Type | Best for | Key params |
|---|---|---|
| `audio` | passive consumption, podcast-style | `format` (deep_dive / brief / critique / debate), `length` (default / short / long) |
| `video` | visual explainer with narration | `format` (explainer), `length` |
| `slide_deck` | presentable summary, share-ready | `format` (detailed_deck), `length` |
| `mind_map` | structural overview of relationships | (no params) |
| `report` | written deliverable | `format` (Briefing Doc / Study Guide / Blog Post / Create Your Own) + `focus_prompt` for Create Your Own |
| `flashcards` | active recall, memorization | `difficulty` (easy / medium / hard, default medium) |
| `quiz` | knowledge check | `question_count` (int, default 5), `difficulty` (easy / medium / hard, default medium) |
| `infographic` | single-glance visual | `orientation` (portrait / landscape), `detail` (standard / in_depth), `style` (sketch_note / professional / minimal / data-driven) |
| `data_table` | structured extraction | `focus_prompt` for what to extract |

### A3. Clarify the params
Targeted asks — only the ones the type needs, only when the answer isn't already implied by the idea. Examples:
- For `audio` deep_dive: length? (default ~12min, short ~5min, long ~25min)
- For `report` Create Your Own: angle, audience, depth, length cap?
- For `infographic`: style (sketch_note feels personal; professional feels executive)?
- For `quiz`: how many questions, what difficulty (easy / medium / hard)?

### A4. Draft the focus prompt (if applicable)
For types that take a focus prompt (`report` Create Your Own, `data_table`, custom audio/video): draft a tight 2–4 sentence prompt covering scope + angle + output structure. Show it. Ask: `Use as-is` / `Tweak it` (user edits) / `I'll write it`.

### A5. Execute
`studio_create(notebook_id, artifact_type=..., confirm=True, <params>)`. Poll `studio_status` until complete (or until user wants to move on — async is fine). Surface `artifact_id`.

### A6. Update sidecar
Append a row to `## Artifacts` table with type, format, status, ID, and a 1-line note ("Custom: <idea summary>"). Append a longer entry under `## Customizations / follow-ups` with the full focus prompt used.

---

## Mode B — Brainstorm

### B1. Read current state
- `notebook_describe(notebook_id)` → sources list + existing artifacts
- Read sidecar's `## Setup notes` and `## Customizations` if present
- Note: count by source type, count by artifact type, identify what's missing

### B2. Ask 2 framing questions
1. **Purpose right now** — "What are you trying to do with this notebook in the next week or two?" (study, present, decide, share, ship)
2. **Modality preference** — AskUserQuestion: `Don't care — surprise me` / `Audio/video (passive)` / `Visual (slides/infographic/mind map)` / `Text (reports/flashcards/quiz)`

### B3. Propose 3–5 ideas
Build proposals using these heuristics:
- **Type gaps** — what artifact types aren't represented yet
- **Depth gaps** — overview exists but a deep-dive on subtopic X would add value
- **Use-case gaps** — has study content but nothing presentation-ready (or vice versa)
- **Repurpose plays** — existing report → audio version for commute; existing audio → flashcards for retention
- **Cross-cutting angles** — comparisons, syntheses, "translate technical X for audience Y", counterarguments

Present as a short table:
| # | Type | Title/Angle | Why it'd help | Rough params |
|---|---|---|---|---|
| 1 | report (Create Your Own) | … | … | length: short |

### B4. User picks
AskUserQuestion: `Generate idea N` / `Generate multiple` / `Refine an idea` (switch to Mode A) / `None of these — try again with different angle`.

If multiple selected: loop generation, 5s between calls.

### B5. Execute + log
Same as Mode A's steps A5–A6 for each selected idea. Propose defaults for each param inline and proceed without per-parameter approval ([[feedback-workflow-propose-defaults]]) — the user already chose the idea; that earns the right to proceed.

---

## Mode C — Manage sources

### C1. Pick sub-action
AskUserQuestion: `Add sources` / `List current sources` / `Refresh Drive sources` / `Remove sources`.

### C2a. Add
Same flow as [[notebook-init]] sections 3 + 5 (Research / Provide / Both; prepared list table; preset selection for >10 candidates; `source_add` loop with 2s spacing; verify `imported_count`; log failures).

### C2b. List
`source_describe(notebook_id)` → table with index, title, type, URL/path, length/word-count if available. Show. Done.

### C2c. Refresh Drive
List Drive sources (`source_describe` filtered by type=drive). For each, call `source_sync_drive(source_id)`. Surface which were updated vs unchanged. Log to sidecar's `## Setup notes`.

### C2d. Remove
**Destructive — confirm explicitly.** List current sources with indices. AskUserQuestion: present preset bundles if >4 sources (`Remove duplicates only` / `Remove low-value (you'll review)` / `Pick specific` / `Cancel`). For `Pick specific`, ask user for comma-separated indices in free text. Show what will be removed and ask `Confirm deletion` / `Cancel`. Only then call `source_delete(source_id, confirm=True)` for each. Append removals to sidecar's `## Setup notes` with date + reason.

### C3. Update sidecar
After any add/remove/refresh, update the `## Sources` table to reflect current state. Bump `updated:` frontmatter to today.

---

## Final summary (after any mode)
- Notebook: `<title>` — `<alias>` — `https://notebooklm.google.com/notebook/<id>`
- Actions taken (bullet list)
- Sidecar updates (which sections changed)
- If artifacts are still `in_progress`: `nlm studio status <alias>` to check later

## Idea-to-params mapping cheatsheet (for Mode A)

Common idea patterns → suggested mapping:

| User says… | Type | Format | Length / params |
|---|---|---|---|
| "podcast for my commute" | `audio` | `deep_dive` | default (~12min) |
| "5-min summary I can listen to" | `audio` | `brief` | short |
| "interviewer pushback simulation" | `audio` | `critique` | default |
| "two experts disagreeing on X" | `audio` | `debate` | default |
| "explain it like a video" | `video` | `explainer` | default |
| "deck I could share with my manager" | `slide_deck` | `detailed_deck` | default |
| "one-pager I can pin to my wall" | `infographic` | — | portrait + sketch_note (personal) or professional (work) |
| "study guide" | `report` | `Study Guide` | — |
| "executive brief" | `report` | `Briefing Doc` | — |
| "blog post draft" | `report` | `Blog Post` | — |
| "memorize the key terms" | `flashcards` | — | medium |
| "test myself" | `quiz` | — | question_count=5, difficulty=medium |
| "extract a comparison table of X across sources" | `data_table` | — | focus_prompt = comparison spec |
| "show how concepts connect" | `mind_map` | — | — |

## Edge cases
- **Alias doesn't resolve** — show `nlm alias list`; ask user to pick or set a new alias
- **No sidecar AND user declines to create one** — proceed but warn that artifact logs won't persist locally
- **`studio_create` fails (rate limit, transient)** — wait 30s, retry once; if still failing, log to sidecar and ask if user wants to continue
- **Source already exists when adding** — surface; ask to skip or replace (replace = remove + add, requires confirm)
- **Remove sub-action requested but only 1–2 sources** — confirm extra carefully; this is often unintentional
- **Notebook has 0 artifacts in brainstorm mode** — propose a "starter pack" (audio deep_dive + briefing doc + mind map) rather than gap analysis
- All [[notebook-init]] edge cases also apply to the source-add path

## Rate limiting
- Source add: 2s between calls
- Studio generation: 5s between calls
- Source delete: 2s between calls
- Studio status poll: 2s

## Notes
- This skill complements [[notebook-init]] (creation) and [[interview-prep]] (specialized creation). All three share the same sidecar shape and INDEX.md convention
- Mode A is the most-used path; optimize that flow for speed (don't over-interview)
- Mode B's value depends on reading the actual notebook state first — never propose without calling `notebook_describe`
- Mode C's `Remove` is the only destructive action in any of the three sibling skills — confirm twice
- Reference `nlm-skill` for full tool/CLI documentation
