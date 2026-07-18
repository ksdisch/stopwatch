---
description: Generate a FULL simulated SQL mock interview as an MP3 you listen to as an observer (local two-voice TTS)
argument-hint: "[N questions] [straight|tough] [archetype focus] [male|mixed] [--play]"
allowed-tools: Bash, Read, Write, ToolSearch, mcp__plugin_voicemode_voicemode__service
---

Generate a **fully-simulated, listen-as-an-observer SQL mock interview** and render it to a single **MP3** using Kyle's local Kokoro TTS — interviewer in one voice, ideal candidate in another. This is the audio counterpart to `/mock-sql-interview` (voice, Kyle performs) and `/mock-sql-demo` (text self-play). Target: the **STEAMe Data Analytics Engineer** Postgres SQL screen. The point is for Kyle to **internalize what a strong candidate's think-aloud sounds like** by ear (commute/walk listening, spaced repetition).

## Parse `$ARGUMENTS`
- Integer → number of SQL questions (default **4**, escalating Easy→Hard). Add a short verbal/behavioral or modeling question only if asked.
- `straight` (default) | `tough` → interviewer probing intensity.
- An archetype/topic (e.g. "window functions", "retention", "rates") → bias question selection.
- `male` → both-male voices (interviewer `am_adam`, candidate `bm_george`); `mixed` (default) → `am_adam` interviewer + `af_bella` candidate.
- `--play` → also play it locally with `afplay` after rendering.

## Steps
1. **Pre-flight:** ensure Kokoro is up — load the voice tool (`ToolSearch` → `select:mcp__plugin_voicemode_voicemode__service`) and `service(kokoro, status)`; if stopped, `service(kokoro, start)`. Ensure `~/steame-sql-practice/audio/` exists.
2. **Write the script** to `~/steame-sql-practice/audio/script-<ISO-date>.txt`, every line tagged `INTERVIEWER:` or `CANDIDATE:` (the renderer ignores blank lines and `#` comments). Content rules:
   - Realistic, concise STEAMe interviewer (Thien-An Bui / Scharf vibe). **Postgres** throughout.
   - The candidate is the **model to emulate**: runs the **5-beat loop** out loud — CLARIFY (restate + ask grain/ties/NULLs/dialect) → ASSUMPTIONS → SKETCH (names the archetype) → WRITE → TEST EDGES (ties, NULLs, `100.0 *`/`NULLIF`, window frame, fan-out). Tight, no rambling. This is exactly the habit Kyle is training.
   - **Speak the SQL, don't dump code.** Expand into natural speech so it's listenable: `SELECT *` → "select star"; `COUNT(*)` → "count star"; `||` → "concatenated with"; `100.0 *` → "a hundred point zero, times"; `GROUP BY` → "group by"; `EXTRACT(YEAR FROM tweet_date) = 2022` → "where extract year from tweet date equals twenty twenty-two". Keep each spoken line a sentence or two.
   - **Escalate** across distinct archetypes (rate/conditional-aggregation, top-N per group, nth-per-entity/ROW_NUMBER, MoM-or-YoY growth via LAG, retention/cohort, dedup, gaps-and-islands). Use STEAMe's **learner domain** (programs→cohorts→students→enrollments→placements) when natural; classic tables (`tweets`, `employees`) are fine for canonical ones.
   - For each question: interviewer asks → candidate clarifies → candidate solves aloud → interviewer probes once → candidate handles it.
   - End with a **spoken DEBRIEF** (interviewer voice): 4-6 "key takeaways for Kyle" — the archetypes covered, the Postgres gotchas, and the narration phrasing to steal.
3. **Render:** run
   `cd ~/steame-sql-practice && VOICE_INTERVIEWER=<v> VOICE_CANDIDATE=<v> ./render-dialogue.sh audio/script-<date>.txt audio/mock_sql_<date>.mp3`
   (set the two voice env vars per the `male`/`mixed` choice).
4. **Deliver:** `SendUserFile` the MP3 (status proactive) with a one-line caption (length + topics). Tell Kyle it's a normal MP3 — AirDrop it or drop it in Drive for phone listening. If `--play`, run `afplay <file>`.
5. Keep scripts + MP3s in `~/steame-sql-practice/audio/` (ISO-dated; add `_v2`/`_HHMMSS` if regenerating same day).

## Notes
- This is **local, free, repeatable** — regenerate a fresh interview anytime; no quota.
- For a *conceptual* prep podcast instead (two hosts discussing how to ace the screen), that's NotebookLM's job — use the `interview-prep` skill, not this command. NotebookLM cannot perform a script verbatim, so it's the wrong tool for faithful role-play.
