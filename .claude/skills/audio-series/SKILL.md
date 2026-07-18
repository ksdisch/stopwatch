---
name: audio-series
description: Generate an episodic series of NotebookLM audio overviews for an EXISTING notebook — a flagship "building" season (Ep 1→N, each assumes the last) plus standalone episodes — with phone-legible "Ep N —" titling, quota-aware batched generation, and optional per-episode Study Guide + Quiz. Use when the user wants a podcast/audio series, season, or audio "course" from a notebook, multiple themed audio overviews at once, or to turn a notebook into a structured listening curriculum. Triggers on "audio series", "podcast series/season", "episodic audio", "audio course", a batch of audio overviews, or "/audio-series".
---

# audio-series — Episodic NotebookLM audio overviews (+ study aids)

Turn an existing notebook into a structured listening curriculum: a flagship **building series** (each episode assumes the prior) plus **standalone** episodes, optionally each paired with a Study Guide + Quiz. Tool preference: **MCP-first** (`mcp__notebooklm-mcp__*`); `nlm` CLI fallback for aliases. Reference [[notebook-init]] for sidecar conventions and `nlm-skill` for full tool docs.

## When to use which sibling skill
- [[notebook-init]] — create a brand-new notebook from scratch
- [[notebook-assist]] — work with an existing notebook: refine ONE artifact, brainstorm, manage sources
- [[interview-prep]] — interview-prep notebook (has its own "Screen Ready" podcast season)
- **audio-series** (this) — generate a whole episodic *audio* series/season for an existing notebook, + optional per-episode study aids
- [[video-series]] — same, but *video* overviews (explainer/brief × visual styles); offers Mirror/Complement/Fresh over an existing audio season

---

## Workflow

### 1. Identify the notebook
AskUserQuestion: `Use alias` / `Pick from list` / `Most recently used`.
- **Alias** → resolve via `nlm alias list` → notebook_id
- **List** → `notebook_list`; show 10 most recent (title + alias + updated); ask which
- **Recent** → read `~/Projects/NotebookLMs/INDEX.md`; bottom-most entry; confirm

Capture `notebook_id`, `alias`, sidecar path (`~/Projects/NotebookLMs/<alias>/`). If no sidecar, offer to back-fill one from `notebook_describe` using [[notebook-init]]'s template. Pull the **existing artifacts** (`studio_status` or `notebook_describe`) so the design can dedupe against audio that already exists.

### 2. Interview — shape the series
Keep it to a few high-leverage AskUserQuestions:
- **Focus / weighting** — what should the series emphasize (free text). Weight content, not necessarily format.
- **Flagship series** — build a sequential "season" (Ep 1→N, each assumes the last)? How many episodes (default **6–8**)? Confirm "at least one building series" if they want a course feel.
- **Standalone breadth** — also generate re-listenable standalones across the rest of the material? Tiered: whole-topic, cross-cutting, micro/snackable, opinion.
- **Length & format mix** — lengths can be mixed (`short`/`default`/`long`); `deep_dive` is the workhorse, with `debate`/`critique`/`brief` for variety. Don't over-optimize length.
- **Source scope** — whole notebook (default) or a **subset of sources**: pass `source_ids` to `studio_create` (a HARD boundary — excluded sources can't leak in; focus_prompt alone is soft steering). Get IDs from `nlm source list` or the sidecar manifest; on merged notebooks the manifest's origin column addresses each half ("just the <X> content"). Each episode may carry its own subset.
- **Study aids** — both Study Guide + Quiz per episode / quizzes only / study guides only / none; and scope (series only vs all episodes). See Step 5.

### 3. Design the curriculum
Read the sources (`notebook_describe`) and existing artifacts. Produce a plan; **do not create anything yet**.
- **Thorough mode (optional):** if the user has opted into multi-agent orchestration (e.g. ultracode on, or they say "workflow"), fan out a design pass — drafters per lane (the flagship series; standalone lanes by theme; an opinion/critique lane) → one editor that dedupes, orders, and picks a launch batch. Otherwise design inline.
- **Output per episode:** title, `audio_format`, `audio_length`, a concrete **focus_prompt** (scoped + source-grounded; series episodes say "assumes episodes 1–N"), optional `source_ids` subset, and `seriesOrder` for the flagship.
- **Dedupe** against the 4–N existing audio episodes; differentiate overlapping angles explicitly in the focus prompts.
- Present the plan (flagship series + standalone library grouped by tier + a recommended launch batch). Get a go-ahead. Audio is expensive/outward — never create without an explicit "go".

### 4. Generate the audio — quota-aware batches
`studio_create(notebook_id, artifact_type="audio", audio_format=…, audio_length=…, focus_prompt=…, source_ids=[…] if scoped, confirm=True)`.
- **Batch ~5–6 at a time.** Concurrency cap is ~11 — firing more in one shot makes the extras fail with `Could not create audio`.
- **Poll to completion, don't defer.** Pattern: `Bash sleep` with `run_in_background:true` → `TaskOutput(block:true)` → `studio_status`. (Foreground `sleep` is blocked.)
- **`studio_status` returns the WHOLE notebook** and gets large fast — it'll be persisted to a file. Filter with `jq` on that file: `jq -c '.summary'` and `jq -r '.artifacts[] | select(.status!="completed") | "\(.status)\t\(.type)\t\(.artifact_id)"'`. (`status:"unknown"` + a non-null `audio_url` = effectively done.)
- **Rename only AFTER completion** (`studio_status action="rename"`). NotebookLM auto-titles audio at the end; renaming an in-progress artifact gets overwritten.
- **Titling for mobile (critical):** NotebookLM truncates titles in the phone app. Lead with the distinguishing bit:
  - Series → `Ep 1 — <short topic>`, `Ep 2 — <short topic>`, … (NOT a shared "<Series Name> — Ep 1:" prefix — they all truncate identically).
  - Standalones → `<short topic>` (already distinct).

#### Audio quota — the #1 gotcha
On `{"status":"error","error":"Could not create audio."}`:
1. If you just fired >~11 at once, it's **concurrency** — let the in-flight ones finish, then retry the overflow.
2. If it fails with **0 jobs in flight**, it's the **rolling ~24h account-wide audio quota** (NOT per-notebook, NOT calendar-day). Heavy days (~15–20 audio) exhaust it.
3. **Diagnose, don't hammer:** create a *non-audio* artifact (e.g. `mind_map`) — if it succeeds instantly, auth/server/creation are healthy and the block is audio-specific. To prove account-wide vs per-notebook, `notebook_create` a throwaway, `source_add` one URL with `wait:True`, attempt one audio — if it ALSO fails, it's account-wide; `notebook_delete` the throwaway. (`refresh_auth` only reloads cached tokens; a truly stale login needs `nlm login`, which only the user can run.)
4. **Defer blocked episodes:** log them in the sidecar with their focus prompts, tell the user capacity returns ~24h after the saturating batch, and offer to re-fire then. Do not loop-retry a hard quota.

### 5. Study aids (if chosen) — cheap, no audio quota
Per episode, scope a Study Guide and/or Quiz to *that episode's* topic via `focus_prompt`:
- `studio_create(artifact_type="report", report_format="Study Guide", focus_prompt=<episode topic + angle>)`
- `studio_create(artifact_type="quiz", question_count=8, difficulty="medium", focus_prompt=<episode topic>)`

These are **text artifacts → NOT subject to the audio quota**, and they tolerate large concurrent batches (14–16+ fire fine). So you can fire big waves, poll once (`jq` the persisted status file), and rename in bulk. **Study aids don't depend on the audio existing** — generate them even for episodes whose audio is quota-deferred. Title to pair: series → `Ep N — Study Guide` / `Ep N — Quiz`; standalone → `<topic> — Study Guide` / `<topic> — Quiz`. They appear under the Studio panel's Reports/Quizzes sections, separate from the audio list.

### 6. Log to the sidecar
Update `~/Projects/NotebookLMs/<alias>/README.md` (per [[notebook-init]] conventions):
- **Audio series table:** Ep · title · format · length · status · artifact ID, plus a note on the "Ep N —" display scheme.
- **Standalone backlog:** each with its verbatim focus_prompt (+ `source_ids` if scoped) and a ✅ marker once created (so future rounds just re-fire what's left).
- **Study aids section:** the naming scheme + topic tags.
- **Quota deferrals:** any episodes blocked, with prompts ready and the expected reset window.
Refresh the [[notebook-init]] INDEX entry if scope changed.

---

## Reference card — gotchas this skill exists to encode
- **Mobile titling:** lead every series episode with `Ep N —`; never a shared long prefix.
- **Audio quota:** rolling ~24h **account-wide** cap; concurrency cap ~11; batch 5–6; poll-to-completion; on failure-with-0-in-flight, defer (don't hammer); diagnose via non-audio + throwaway-notebook tests.
- **Reports/quizzes:** no audio quota, big batches OK, generate independent of audio.
- **Rename only after completion** — auto-titles overwrite early renames.
- **`studio_status` returns the whole notebook** — `jq` the persisted file for your in-flight IDs.
- **Source scoping:** `source_ids` on `studio_create`/`notebook_query` hard-limits generation to a subset (focus_prompt is soft) — the lever for merged notebooks and zoomed episodes; log any subset in the backlog beside its prompt.
- **Generate nothing without an explicit go-ahead** — audio is expensive and outward-facing.
- **Sidecar is the source of truth** — series + backlog (with prompts) + study aids + deferrals.
