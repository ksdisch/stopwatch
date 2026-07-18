---
name: notebook-merge
description: Integrate 2+ existing NotebookLM notebooks with crossover into ONE unified notebook — inventory every side, migrate sources by type (all or strategically selected, overlap-flagged), migrate notes, regenerate chosen Studio artifacts from their recorded focus prompts, propose new cross-notebook synthesis artifacts, then archive-rename the originals (deletion only behind an explicit per-notebook gate). Use when notebooks overlap and should become one, or the user wants to merge, combine, consolidate, or unify notebooks, or fold one notebook into another. Triggers on "merge notebooks", "combine notebooks", "consolidate notebooks", "unify notebooks", "fold X into Y", or "/notebook-merge".
---

# notebook-merge — Integrate N notebooks into one

Two facts shape everything here: NotebookLM has **no copy API** — sources move by *re-adding* them (method depends on type) — and **artifacts can't move at all** — they *regenerate* from the focus prompts the sidecars recorded. Handles 2+ notebooks in one pass; folding another notebook in later is just another run. Tool preference: **MCP-first** (`mcp__notebooklm-mcp__*`); `nlm` CLI fallback for aliases. Reference [[notebook-init]] for sidecar conventions and `nlm-skill` for full tool docs.

## When to use which sibling skill
- [[notebook-init]] — create a brand-new notebook from scratch
- [[notebook-assist]] — work with ONE existing notebook: refine an artifact, brainstorm, manage sources
- [[audio-series]] / [[video-series]] — generate an episodic season for an existing notebook
- **notebook-merge** (this) — fold 2+ overlapping notebooks into one unified notebook, end to end

---

## Workflow

### 0. Preflight & selection
- Auth check (`server_info` / `nlm login --check`); pick profile if >1.
- Select **2+ notebooks**: `By aliases` / `Pick from list` (10 most recent) / `By tag` (e.g. everything tagged `ai-papers`). Confirm the final set.
- Load each sidecar (`~/Projects/NotebookLMs/<alias>/`); back-fill from `notebook_describe` using [[notebook-init]]'s template if missing.
- Pull per notebook: source list (`nlm source list --full` / `--url`), artifact inventory (`studio_status` → persisted file), notes (`note` list).
- Compute the union source count vs the per-notebook cap (~50 free / ~300 Pro — approximate; treat the live error as truth).

### 1. Inventory & analysis
- **Union source manifest:** # · title · type · URL/path · origin notebook · overlap flag · fidelity note. Overlap = exact URL match or fuzzy title match.
- Optional thematic pass: `cross_notebook_query` across the set ("what themes do these share / where do they diverge?") — informs strategic selection and the synthesize list.
- **Artifact inventory, split:** *recorded focus prompt available* (recreate-able verbatim) vs *unknown provenance* (candidates for the synthesize list instead).
- Notes inventory.

### 2. Merge plan — the single creation gate
Present ONE plan; **create nothing without an explicit "go"**:
- **Topology recommendation + reasoning:** absorb into the richest notebook (one side clearly dominates) vs create a new umbrella notebook (comparable contributions or a genuinely new identity; default at N≥3). User confirms. Umbrella path proposes title/alias/tags (union) per [[notebook-init]] conventions.
- **Union count vs cap**, prominently. Over cap → strategic selection is mandatory.
- **Source mode:** `All` / `Strategic`. Strategic uses [[notebook-init]]'s value tiers with preset selection — `Everything` / `Dedupe only` / `High-value only` / `Hand-pick` (AskUserQuestion caps at 4 options; collect hand-picked indices as free text).
- **Artifact menu, two lists:**
  - *Recreate* — old artifacts re-fired from recorded prompts, titles adapted. Skip whole-notebook generics (e.g. a plain Briefing Doc) — re-synthesize those over the union instead. Absorb topology: only the non-survivors' artifacts (the survivor's are already live).
  - *Synthesize* — 3–5 NEW cross-notebook artifacts only the merge makes possible (bridge deep_dive connecting the halves, comparative report, combined mind map, …). This is the merge's payoff — always propose some.
  - Either list may scope an artifact to a **source subset** via `source_ids` on `studio_create` (a HARD boundary — excluded sources can't leak in). The manifest's origin column makes each original notebook's half addressable post-merge ("a deep_dive over just the <A> sources"), so recreated artifacts can match their original scope exactly.
- **Disposal preview:** which originals get archive-renamed; the delete decision is deferred to Phase 5.

### 3. Migrate
Umbrella path first: `notebook_create` → `nlm alias set` → `tag(action="add")` → `chat_configure`. Then re-add the selected sources (absorb path: only the non-survivors'), per type:

| Origin type | Transfer method | Fidelity |
|---|---|---|
| URL / YouTube | `source_add(source_type="url", url=…)` | Perfect (re-fetched) |
| Drive doc | `source_add(source_type="drive", document_id=…)` | Perfect (stays synced) |
| Pasted text | `source_get_content` → `source_add(source_type="text", title=<same>)` | Perfect |
| Uploaded file | Local original from sidecar `sources/` → `source_add(source_type="file")`; else `source_get_content` → text re-add | Fallback loses formatting/media — flag in manifest |

- **2s between adds** (rate limit). Then **verify count parity** (planned vs present); retry stragglers once — Medium.com and paywalled URLs fail *silently* — and log failures to the sidecar regardless.
- Migrate notes: `note` list per origin → `note_create` in the target.

### 4. Regenerate artifacts — quota-aware
Fire the approved menu only:
- **Text artifacts** (reports, quizzes, flashcards, mind maps, data tables): no audio/video quota — big concurrent batches are fine.
- **Audio:** follow [[audio-series]]'s reference card — batch 5–6, ~11-concurrency ceiling, rolling ~24h account-wide quota, poll to completion, rename only after completion, `Ep N —` titling if serialized.
- **Video:** follow [[video-series]]'s recon posture — solo smoke test if the sidecar has no video-quota observations, then batches of 2–3, log observations.
- Poll via the persisted `studio_status` file with `jq` (it returns the whole notebook).
- Quota-blocked items → sidecar backlog with verbatim prompts; defer, don't hammer.
- A whole NEW season for the merged notebook is not this skill's job — route to [[audio-series]] / [[video-series]] afterward.

### 5. Archive & disposal
- `notebook_rename` each original to `[MERGED → <alias>] <old title>`; update its sidecar (status + merged-into pointer) and its `INDEX.md` entry.
- **Delete gate, per notebook:** AskUserQuestion listing exactly what dies with it — every artifact NOT recreated in Phase 4. Default is keep-archived. **Never delete without this per-notebook confirm.**

### 6. Verify & summarize
- Re-check source count parity; run one spot-check chat query whose answer must ground in content from **each** origin notebook.
- Write the merged notebook's sidecar: provenance header ("merged from <A>, <B>, … on YYYY-MM-DD"), full manifest with per-source outcomes, artifact log, backlog/deferrals. Add its `INDEX.md` entry.
- Summary: notebook URL, alias, sidecar path, what's backlogged.

## Edge cases
- **Auth expiry mid-flow** — pause; user runs `nlm login`; resume where left off.
- **Abort mid-flow** — write the sidecar capturing whatever completed; originals are untouched until Phase 5.
- **Union over cap and user insists on Everything** — hard stop with the numbers; NotebookLM rejects the overflow anyway.

---

## Reference card — gotchas this skill exists to encode
- **Sources move by re-adding** (matrix above); uploaded files prefer the sidecar `sources/` original; the text-extract fallback is a flagged fidelity loss.
- **Artifacts regenerate from recorded prompts** — sidecars are the memory; no recorded prompt → synthesize list, not recreate list.
- **Deleting an original kills its un-recreated artifacts** — the delete gate must list them by name.
- **Two gates:** one creation gate (Phase 2), one destructive gate per notebook (Phase 5). Nothing outward without them.
- **Cap check before anything**; strategic selection is the pressure valve.
- **2s add spacing; count-parity verification** — silent add failures are real (Medium, paywalls).
- **Cross-notebook synthesis artifacts are the payoff** — always propose them, don't just restore parity.
- **Post-merge, the halves stay addressable** — filter the manifest by origin → `source_ids` for hard-scoped artifacts and queries; merging never costs the ability to study one side alone.
- **Sidecar + INDEX stay truthful at every phase** — provenance, outcomes, backlog, merged-into pointers.
