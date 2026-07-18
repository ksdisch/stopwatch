---
name: video-series
description: Generate an episodic series of NotebookLM video overviews for an EXISTING notebook — a flagship "building" season (Ep 1→N, each assumes the last) plus standalone episodes — with a per-season visual style, phone-legible "Ep N —" titling, reconnaissance-mode quota batching, and optional per-episode Study Guide + Quiz. If the notebook already has an audio season, offers Mirror / Complement / Fresh. Use when the user wants a video series, season, or video "course" from a notebook, multiple video overviews at once, or a visual second pass over an audio season. Triggers on "video series", "video season", "episodic video", "video course", a batch of video overviews, or "/video-series".
---

# video-series — Episodic NotebookLM video overviews (+ study aids)

Turn an existing notebook into a structured watching curriculum: a flagship **building season** (each episode assumes the prior) plus **standalone** episodes, optionally each paired with a Study Guide + Quiz. Built for visual-heavy material (schemas, architectures, SQL, math) and for a second-modality pass over an existing audio season. Tool preference: **MCP-first** (`mcp__notebooklm-mcp__*`); `nlm` CLI fallback for aliases. Reference [[notebook-init]] for sidecar conventions and `nlm-skill` for full tool docs.

## When to use which sibling skill
- [[notebook-init]] — create a brand-new notebook from scratch
- [[notebook-assist]] — work with an existing notebook: refine ONE artifact (including a single video), brainstorm, manage sources
- [[audio-series]] — episodic *audio* season; also the home of opinionated formats (debate/critique have no video equivalent)
- **video-series** (this) — generate a whole episodic *video* series/season for an existing notebook, + optional per-episode study aids

---

## Workflow

### 1. Identify the notebook
AskUserQuestion: `Use alias` / `Pick from list` / `Most recently used` — same as [[audio-series]]. Capture `notebook_id`, `alias`, sidecar path (`~/Projects/NotebookLMs/<alias>/`); back-fill the sidecar if missing. Pull existing artifacts (`studio_status` or `notebook_describe`) for dedupe — and **detect whether an audio season exists** (sidecar audio table or artifact list); that decides whether step 2's Mirror/Complement/Fresh branch fires.

### 2. Interview — shape the season
Keep it to a few high-leverage AskUserQuestions:
- **Focus / weighting** — what should the season emphasize (free text).
- **If an audio season exists → Mirror / Complement / Fresh:**
  - **Mirror** — same Ep 1→N arc re-expressed visually; adapt the sidecar's episode focus prompts; episode count matches the audio season.
  - **Complement** — new arc covering what audio couldn't show; avoid topic overlap; lean into diagrams/schemas/structure.
  - **Fresh** — design independently; use the audio season only for dedupe.
- **Flagship season** — sequential Ep 1→N, default **4–6 episodes** (video quota is scarcer than audio and watching costs foreground attention).
- **Season visual style** — pick ONE explicit `visual_style` for the whole flagship season (its visual identity): classic, whiteboard, watercolor, anime, kawaii, retro_print, heritage, paper_craft. **Never `auto_select` for series episodes** — per-episode auto picks can break coherence. Standalones may vary freely.
- **Format mix** — `explainer` is the workhorse (series episodes, whole-topic standalones); `brief` for the micro/snackable tier. **No opinion lane** — users wanting debate/critique go to [[audio-series]].
- **Source scope** — whole notebook (default) or a **subset of sources**: pass `source_ids` to `studio_create` (a HARD boundary — excluded sources can't leak in; focus_prompt alone is soft steering). Get IDs from `nlm source list` or the sidecar manifest; on merged notebooks the manifest's origin column addresses each half ("just the <X> content"). Each episode may carry its own subset.
- **Study aids** — both Study Guide + Quiz per episode / quizzes only / guides only / none; and scope. **Mirror seasons skip study aids the audio season already generated** (same topics → duplicates).

### 3. Design the curriculum
Read the sources (`notebook_describe`) and existing artifacts. Produce a plan; **do not create anything yet**.
- **Output per episode:** title, `video_format`, `visual_style`, a concrete **focus_prompt** (scoped + source-grounded; series episodes say "assumes episodes 1–N"), optional `source_ids` subset, and `seriesOrder` for the flagship.
- **Video-only prompt lever:** focus prompts should also direct the *visual treatment* — "show the schema as a diagram; walk the join step by step". Use it in every episode prompt.
- **Dedupe** across BOTH audio and video titles. Mirror seasons intentionally reuse the audio arc's `Ep N — <topic>` titles — audio and video sit in separate Studio-panel sections, so identical titles pair rather than collide.
- **Thorough mode (optional):** if the user has opted into multi-agent orchestration, fan out drafters per lane → one editor that dedupes, orders, and picks a launch batch. Otherwise design inline.
- Present the plan (flagship season + standalones by tier + recommended launch batch). Get a go-ahead. Video is expensive/outward — **never create without an explicit "go"**.

### 4. Generate the video — reconnaissance batching
`studio_create(notebook_id, artifact_type="video", video_format=…, visual_style=…, focus_prompt=…, source_ids=[…] if scoped, confirm=True)`.
- **Smoke test first:** on any run where the sidecar has no prior video-quota observations, fire ONE video solo before batching — validates params and confirms rename-after-completion behavior.
- **Batch 2–3 at a time** (video limits are undocumented — unlike audio's known ~11-concurrent / rolling-24h caps — so start conservative). Poll each batch to completion before the next: `Bash sleep` with `run_in_background:true` → `TaskOutput(block:true)` → `studio_status`. (Foreground `sleep` is blocked.)
- **`studio_status` returns the WHOLE notebook** — `jq` the persisted file: `jq -c '.summary'` and `jq -r '.artifacts[] | select(.status!="completed") | "\(.status)\t\(.type)\t\(.artifact_id)"'`.
- **Expectation-setting:** ~3–7+ min per video; a 5-episode season ≈ 30–45+ min wall-clock. Keep polling; don't defer mid-run.
- **Rename only AFTER completion** (`studio_status action="rename"`) — assume audio's auto-title-overwrite behavior until the smoke test confirms.
- **Titling for mobile (critical):** series → `Ep 1 — <short topic>`, `Ep 2 — <short topic>` (never a shared long prefix — they truncate identically); standalones → `<short topic>`.

#### Video quota — unknown by design (recon posture)
On a video creation failure:
1. Jobs in flight → likely **concurrency**; let them finish, retry the overflow.
2. Failure with **0 in flight** → daily/rolling **video quota**. Diagnose, don't hammer: create a cheap non-video artifact (`mind_map`) — instant success proves auth/server health and isolates the block to video. Throwaway-notebook test (create → one source `wait:True` → one video → delete) proves account-wide vs per-notebook. (`refresh_auth` only reloads cached tokens; a stale login needs user-run `nlm login`.)
3. **Defer blocked episodes** to the sidecar with prompts intact; offer to re-fire later. Never loop-retry a hard quota.
4. **Learn-and-encode:** log every quota-boundary observation (batch size, in-flight count, error text, timing) to the sidecar's "Video quota observations" section. Once numbers are confirmed across runs, propose a PR updating THIS skill's reference card — claude-config is its home.

### 5. Study aids (if chosen) — cheap, no video quota
Identical to [[audio-series]] step 5: per episode, `studio_create(artifact_type="report", report_format="Study Guide", focus_prompt=…)` and/or `studio_create(artifact_type="quiz", question_count=8, difficulty="medium", focus_prompt=…)`. Text artifacts — big concurrent batches fine, independent of whether the video exists yet. Titles: `Ep N — Study Guide` / `Ep N — Quiz`; standalone → `<topic> — Study Guide` / `<topic> — Quiz`. Mirror-skip rule from step 2 applies.

### 6. Log to the sidecar
Update `~/Projects/NotebookLMs/<alias>/README.md` (per [[notebook-init]] conventions):
- **Video series table:** Ep · title · **format** · **style** · status · artifact ID, plus a note on the "Ep N —" display scheme and season style.
- **Standalone backlog:** verbatim focus prompts (+ `source_ids` if scoped), ✅ once created.
- **Study aids section:** naming scheme + topic tags.
- **Quota deferrals + Video quota observations:** blocked episodes with prompts ready; the empirical quota log (until confirmed numbers graduate into this skill).
Refresh the [[notebook-init]] INDEX entry if scope changed.

---

## Reference card — gotchas this skill exists to encode
- **Video quota is UNKNOWN:** smoke-test 1 → batch 2–3 → observe → log to sidecar → PR confirmed numbers back into this skill.
- **Style = season identity:** one explicit style per flagship season; never `auto_select` for series episodes.
- **Focus prompts direct the visuals**, not just the content — video's extra lever.
- **Source scoping:** `source_ids` on `studio_create`/`notebook_query` hard-limits generation to a subset (focus_prompt is soft) — the lever for merged notebooks and zoomed episodes; log any subset in the backlog beside its prompt.
- **No debate/critique in video** — opinion content routes to [[audio-series]].
- **Mirror seasons** reuse the audio arc's titles (pairing is intentional) and skip already-generated study aids.
- **Mobile titling:** lead with `Ep N —`; never a shared long prefix.
- **Rename only after completion**; `jq` the persisted `studio_status` file; poll to completion, don't defer mid-run.
- **Generate nothing without an explicit go-ahead** — video is expensive and outward-facing.
- **Sidecar is the source of truth** — season + backlog + study aids + deferrals + quota observations.
