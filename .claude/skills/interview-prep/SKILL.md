---
name: interview-prep
description: Initialize and maintain a NotebookLM notebook for interview prep — auto-bundles your job-search dossier (`~/Cowork/second-brain/30-job-search/dossiers/<slug>/`), generates baseline prep artifacts (anticipated questions, STAR stories, company facts, critique audio) plus a sequential "Screen Ready" podcast season, supports multi-round updates as new debriefs/transcripts arrive. Use when prepping for a specific company/role interview.
---

# interview-prep — NotebookLM bootstrap for interview prep

One notebook per **company + role**, used across all interview rounds for that role. Auto-includes materials from your existing job-search dossier system. Tool preference: **MCP-first** (`mcp__notebooklm-mcp__*`); fall back to `nlm` CLI for things MCP doesn't cover (aliases). Reference [[notebook-init]] for the underlying notebook/sidecar conventions and `nlm-skill` for full tool docs.

## Source roots (auto-scan in order)

1. `~/Cowork/second-brain/30-job-search/dossiers/<slug>/` — primary; all .md files
2. `~/Cowork/second-brain/30-job-search/companies/<slug>.md` — single company profile if present
3. `~/Cowork/second-brain/30-job-search/materials/<slug>-*/` — any matching subdirs (one per role at the company)

## Mode detection

On invocation, derive the slug from the company name first, then:
- **First-time mode** — no `~/Projects/NotebookLMs/<slug>-interview-prep/` sidecar → run full setup (sections 1–7)
- **Round-add mode** — sidecar exists → skip to section 8

## Workflow

### 1. Preflight
- `which nlm` — abort with install instructions if missing
- Auth check via `mcp__notebooklm-mcp__server_info`. If expired, tell user to run `nlm login` in their shell
- `nlm login profile list` — if >1, ask via AskUserQuestion. Switch with `nlm login switch <profile>` if needed

### 2. Discovery interview
Ask in order:
1. **Company** — free text → derive kebab-case slug; confirm with user
2. **Role title** — free text
3. **JD** — AskUserQuestion: `URL` / `Paste text` / `Skip (research will find it)`
4. **Stage(s)** — AskUserQuestion (multiSelect): `phone-screen` / `technical` / `behavioral` / `system-design` / `onsite` / `final`
5. **Interviewer(s)** — optional, comma-separated names (skip = blank)
6. **Interview date** — optional, YYYY-MM-DD (skip = blank)

Title format: `<Company> — <Role> Interview Prep`. Alias: `<slug>-interview-prep`.

### 3. Auto-collect dossier sources
- List all .md files under the three source roots above
- For each, peek the first ~30 lines to capture title (H1 or filename) + 1-line description
- Build candidate table (see "Prepared source list format" below) — group by source root

**Decision rule:**
- **≤15 files total** — auto-include everything; show the list as confirmation; proceed
- **>15 files** — present preset bundles via AskUserQuestion:
  - `Essentials` — repo-briefs + JD + interviewer intel + 1–2 company-overview files
  - `Strong` — Essentials + STAR cards + project cards + question banks
  - `Comprehensive` — everything except round-specific transcripts/debriefs (those go in via round-add mode)
  - `Everything` — all files including round-specific
- **Dossier folder missing** — log warning; proceed with research-only flow; remind user to add dossier later

### 4. Add JD + interviewer + optional research
- **JD URL** → queue `source_add(source_type="url", url=<url>)`; if it's a LinkedIn jobs URL, warn it may fail and offer paste fallback
- **JD text** → queue `source_add(source_type="text", title="JD: <Company> <Role>", text=<content>)`
- **Interviewer names** → AskUserQuestion: `Research their LinkedIn (fast)` / `Skip`. If yes: `research_start(query="<name> LinkedIn <Company>", mode=fast)`, import High-tier hits only
- **Company research pass** — AskUserQuestion: `Yes — fast company research` / `Skip`. If yes: `research_start(query="<Company> mission product team size leadership recent news", mode=fast)`; review prepared list; import the High tier (apply preset selection rules from [[notebook-init]] if >10 candidates)

### 5. Create notebook + add sources
1. `notebook_create(title="<Company> — <Role> Interview Prep")` → capture `notebook_id`
2. `nlm alias set <slug>-interview-prep <notebook_id>` (CLI)
3. `tag(action="add", notebook_id, tags=["interview-prep", "<company-slug>", "<stage-tags>"])`
4. `chat_configure(notebook_id, goal="learning_guide")`
5. Loop sources (2s between calls):
   - Local files: `source_add(source_type="file", file_path=<abs-path>, notebook_id=<id>)`
   - URLs: `source_add(source_type="url", url=<url>, notebook_id=<id>)`
   - Text: `source_add(source_type="text", title=<title>, text=<content>, notebook_id=<id>)`
6. Verify `imported_count` vs requested count. Surface gaps; log failures to sidecar (Medium.com URLs and paywalled JDs commonly fail silently — see [[notebook-init]] edge cases)

### 6. Baseline artifacts
Always generate (poll `studio_status` until all complete; log failures to sidecar and continue):

| Artifact | Type | Format / params | Focus prompt |
|---|---|---|---|
| Anticipated Questions | report | Create Your Own | "Anticipated interview questions for the **<stage(s)>** round(s) at **<Company>** for the **<Role>** position. For each: the question, why it's likely (signal/pattern), and a 1-sentence note on what they're probing for. Group by category (technical / behavioral / role-fit / culture)." |
| STAR Stories | report | Create Your Own | "Draft 5–7 STAR stories drawn from the candidate's `repo-brief-*` sources. For each: Situation, Task, Action, Result. Include which repo it's based on and what skill/competency it demonstrates. Prioritize stories that map to the JD's stated requirements." |
| Company Facts | flashcards | difficulty=medium | (no focus prompt; let NotebookLM extract) |
| Role + Company Mind Map | mind_map | — | — |
| Deep-dive Audio | audio | deep_dive, default length | — |

**Stage-conditional adds:**
- `technical` or `system-design` in stages → **Quiz** (`question_count=5`, `difficulty=medium`) on technical concepts surfaced in sources
- `behavioral` → second **flashcards** deck (`difficulty=easy`) for STAR story keywords
- `phone-screen` → also generate **brief audio** (short length) for last-minute cramming
- `onsite` → also generate **slide_deck** (detailed_deck) for comprehensive review

### 6A. "Screen Ready" podcast season (always, first-time mode)
Generate a sequential, multi-episode **audio season** the candidate can listen to like a podcast. Standing show name: **"Screen Ready"** — one season per notebook. Each episode is a NotebookLM audio overview: `studio_create(artifact_type="audio", audio_format="deep_dive", audio_length="short", confirm=True)`.

**Lineup = fixed core + stage-conditional extras** (number them in final play order).

Core (every season, in order):
1. **The Briefing** — season primer: the role, where the candidate stands, the mindset for this stage.
2. **Know the Firm** — company research; the "why <Company>" answer; explicitly flag the intel dossier's "do-not-assert" items.
3. **Meet Your Interviewer** — interviewer intel; how to calibrate. (Merge into E1 if no interviewer known.)
4. **Your Story & STARs** — positioning pitch + the STAR stories mapped to the JD.
5. **The Mock Interview** (finale — **always the last episode**) — a **role-played** simulated interview, *not* a hosts-discuss-it episode: **one host plays the interviewer** (use the named interviewer from §2 discovery — e.g. "Taylor Calloway" — or a generic recruiter if none is known) and **the other plays the candidate** (Kyle). They run a realistic mock of the *stage* start to finish — candidate's answers grounded in his real sources + prep, leading with his positioning hook — **then break character** and debrief like coaches: what went well, where the candidate could improve, and the single most important fix before the real thing, closing with the day-of checklist. Generate this one at **`audio_length="long"`** (the rest of the season is `short`).

Stage-conditional inserts (added **before** the Mock Interview finale, continuing the numbering):
- `phone-screen` → **Talking Money** (comp deflection, floor/target, logistics)
- `technical` / `system-design` → **Technical Deep Dive** (the JD's tech decoded; whiteboard/system-design framing; owning any tool/skill gaps)
- `behavioral` → **Behavioral & STAR Drill** (competency themes; failure/conflict/leadership stories)
- `onsite` / `final` → **Panel & Logistics** (multi-interviewer day; what each round wants; energy management)

**Focus-prompt conventions (every episode):**
- Open by naming the show + episode: "This is 'Screen Ready,' episode N: <title>…".
- State it's prep for "<Candidate>'s <Role> <stage> at <Company>" (name the interviewer if known).
- Reference the previous episode and tee up the next (continuity).
- Ground answers in the candidate's real sources (resume, `repo-brief-*`, prep dossier); two hosts, conversational; honest, no overclaiming.
- For E2 (company facts), prefer CONFIRMED facts and avoid the dossier's "unconfirmed / do-not-assert" items.

**Generate → recover → label → save loop:**
1. Create all episodes (5s between `studio_create` calls).
2. Poll `studio_status` until each is `completed`. **Expect a status-flip lag** — a finished audio reports `status:"unknown"` with a live `audio_url` for several minutes before flipping to `completed`; downloads fail during that window. Poll patiently (~2–3 min between checks); do **not** tight-loop, and never curl the `audio_url` (returns an auth interstitial, not the MP3).
3. **Recovery:** if any episode is `status:"failed"`, regenerate it once (same focus prompt), then `studio_delete` the failed artifact.
4. **Rename** each completed episode to `Screen Ready S1E<n> — <Title>` (`studio_status(action="rename")`) so the Studio panel sorts in order.
5. **Download** each to `<sidecar>/artifacts/podcast-series/S1E<n>-<slug>.mp3` (best-effort once `completed`; the notebook copy is canonical). Write `SEASON-1.md` (episode table + IDs + files + a suggested listen order).

This is the slow part of setup — kick the whole season off, then poll while doing the §7 sidecar work; surface partial progress rather than blocking. Episodes are playable in the notebook even if a local download lags.

### 7. Local sidecar
Create `~/Projects/NotebookLMs/<slug>-interview-prep/`:
- `README.md` (template below)
- `sources/` (empty — staging for files added later)
- `artifacts/` (empty — for downloads)
- `rounds/` (empty — for per-round notes saved during round-add mode)

Append to `~/Projects/NotebookLMs/INDEX.md`:
`- [<Company> — <Role> Interview Prep](<slug>-interview-prep/README.md) — <stage(s)>, interview <date or "TBD"> — YYYY-MM-DD`

### 8. Round-add flow (subsequent invocations)
Sidecar exists → skip discovery; proceed:

1. **Identify the round** — AskUserQuestion: `phone-screen` / `technical` / `onsite` / `final` (or custom label via "Other"). Capture date.
2. **Delta scan** — list .md files in dossier roots whose `mtime` is newer than the sidecar's `updated:` frontmatter (or its `created:` if never updated). Show diff. AskUserQuestion: `Add all new files` / `Pick subset` / `Skip`.
3. **Add the new sources** to the existing notebook (same `source_add` loop)
4. **Append a "Screen Ready" episode for this round** (automatic, per §6A) — one new episode continuing the season's numbering, titled for the round (e.g. `Screen Ready S1E<next> — <Round> Game Plan`, or `… Debrief` when a round debrief/transcript exists in the dossier). Same generate → recover-if-`failed` → rename → download loop as §6A. Do **not** re-render the whole season on round-add.
5. **Round-specific artifacts** — AskUserQuestion (multiSelect):
   - Updated anticipated questions (factors in latest sources)
   - Critique audio for this round (interviewer pushback simulation)
   - Translate technical concepts (critique format)
   - Mock interview script
   - Updated mind map
   - Thank-you note draft
   - Done

Use propose-defaults for each selection ([[feedback-workflow-propose-defaults]]). Append to sidecar's `## Rounds` section with date, sources added, artifacts generated.

Update sidecar frontmatter: `updated: YYYY-MM-DD`.

### 9. Customization round (first-time mode only — round-add has its own)
Show summary (notebook URL, sources imported, artifacts kicked off, sidecar path). AskUserQuestion (multiSelect):
- Translate technical concepts (critique audio)
- Mock interview script (report)
- Question bank for the candidate to ask interviewers (report)
- Slide deck for cramming
- Thank-you note template (report)
- Additional audio format (debate / brief)
- Done

For each selected, propose focus prompt inline and proceed without per-parameter approval ([[feedback-workflow-propose-defaults]]). Append to sidecar's `## Customizations` section.

### 10. Final summary
- Notebook URL: `https://notebooklm.google.com/notebook/<id>`
- Alias: `<slug>-interview-prep`
- Sidecar: `~/Projects/NotebookLMs/<slug>-interview-prep/`
- Sources imported / requested (with gap if any)
- Artifacts kicked off (with statuses)
- Podcast season: <N> episodes (`Screen Ready S1E1…`) with statuses + a suggested listen order

## Prepared source list format

| # | Title | Type | Path/URL | Description | Root |
|---|---|---|---|---|---|
| 1 | … | file | … | 1-sentence summary | dossiers/<slug> |

Roots: `dossiers/<slug>` / `companies` / `materials/<slug>-<role>` / `research-web` / `provided`.

## Sidecar README.md template

```markdown
---
notebook_id: <uuid>
alias: <slug>-interview-prep
title: <Company> — <Role> Interview Prep
template: interview-prep
company: <Company>
company_slug: <slug>
role: <Role>
stages: [<stage1>, <stage2>]
interviewers: [<name1>, <name2>]
interview_date: <YYYY-MM-DD or "TBD">
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [interview-prep, <company-slug>, <stage-tags>]
profile: <profile-name>
---

# <Company> — <Role> Interview Prep

**Company:** <Company>
**Role:** <Role>
**Stage(s):** <stages>
**Interviewer(s):** <names>
**Interview date:** <date>
**NotebookLM:** https://notebooklm.google.com/notebook/<id>

## Sources
| # | Title | Type | Source | Round | Notes |
|---|---|---|---|---|---|

### Sources requested but not imported
| Title | URL/Path | Failure note |
|---|---|---|

## Artifacts
| Type | Format | Status | Artifact ID | Round | Notes |
|---|---|---|---|---|---|

## Podcast season — "Screen Ready"
Local: `artifacts/podcast-series/` · index: `SEASON-1.md`

| Ep | Title | Stage tag | Status | Artifact ID | File |
|---|---|---|---|---|---|

## Rounds

### Round 1 — <stage> — YYYY-MM-DD
- **Sources added:** <count> (`<file1>`, `<file2>`, …)
- **Artifacts generated:** <list with IDs>
- **Outcome / debrief:** <link to debrief file in dossier, if exists>

## Setup notes
- **Dossier path:** `~/Cowork/second-brain/30-job-search/dossiers/<slug>/`
- **JD source:** <url or "pasted" or "research-only">
- **Files at setup:** <count>
- **Research pass:** <yes/no>; <N> sources imported

## Customizations / follow-ups
(append as user requests more artifacts)
```

## Edge cases
- **Dossier folder missing** — proceed with research-only flow; warn user; suggest creating `~/Cowork/second-brain/30-job-search/dossiers/<slug>/` and re-running in round-add mode later
- **Slug collision with existing notebook** — switch to round-add mode (do NOT create new notebook); confirm intent before adding
- **Interviewer research returns nothing useful** — skip silently; log gap in setup notes
- **JD URL is LinkedIn / paywalled** — surface failure immediately; ask for paste fallback before continuing
- **Round-add mode but no new files since last update** — surface this; offer to proceed with artifact regen only, or skip
- **Multiple roles at same company** — slugs collide. Suggest `<company>-<role-slug>` (e.g., `steame-data-analytics-engineer`) for the second one; first one keeps the bare `<company>` slug
- **Audio status-flip lag (§6A)** — a finished Audio Overview reports `status:"unknown"` with a live `audio_url` for several minutes before flipping to `completed`; `download_artifact`/`nlm download audio` fail until then. Poll patiently; never curl the `audio_url` directly (auth interstitial, not the MP3). Leave episodes playable in the notebook; download once `completed`.
- **Failed audio episode (§6A)** — `studio_create` for audio occasionally ends `status:"failed"` (more likely in big batches). Detect via `studio_status`, regenerate once, and `studio_delete` the failed artifact so the Studio panel stays clean.
- All [[notebook-init]] edge cases also apply (silent import failures, `deep_report` handling for research pass, alias conflicts, mid-flow aborts)

## Rate limiting
- Source add: 2s between calls
- Studio generation: 5s between calls
- Research poll: 2s

## Notes
- This skill is sibling to [[notebook-init]] — same sidecar shape, same INDEX.md convention, same MCP-first preference, same propose-defaults pattern
- Never deletes user content — only creates and appends. **Exception:** removes its own `failed` audio artifacts during podcast-season recovery (§6A).
- The dossier system at `~/Cowork/second-brain/30-job-search/` is the source of truth for prep materials; the NotebookLM is the *consumer* that turns those materials into active-recall artifacts (audio, flashcards, mock questions, etc.)
- Round-add mode is the intended workflow for the multi-round interview lifecycle: setup once at the start, then re-run after each round once debriefs/transcripts land in the dossier
- Reference `nlm-skill` for full tool/CLI documentation
