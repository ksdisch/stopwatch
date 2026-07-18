---
name: narrate
description: Turn a short written brief into a single-voice audio narration (MP3) you can listen to on a walk or commute, using the local Kokoro TTS from the voicemode plugin. Reusable engine — given already-condensed spoken text, it renders the MP3, saves it, and delivers it to the phone/desktop. Use when a command wants an audio version of an explanation (e.g. /handoff --audio, /wrap --audio) or when the user asks to "listen to" / "make audio of" a summary, brief, or recap. Triggers on "narrate", "audio version", "read it to me", "make an MP3 of this".
allowed-tools: Bash, Read, Write, ToolSearch, SendUserFile, mcp__plugin_voicemode_voicemode__service
---

# narrate — written brief → single-voice MP3 (local Kokoro)

The reusable audio engine behind `/handoff --audio`, `/wrap --audio`, and any
future command that wants a listenable explanation. **Local Kokoro only** (via
the `voicemode` plugin): free, repeatable, no quota, no network. Single voice,
narration — not a NotebookLM two-host podcast. NotebookLM cannot perform a
script verbatim; this can, which is the whole point.

**Engine, not author.** The *caller* decides what to say and hands this skill a
clean spoken script. This skill renders it, saves it, and delivers it. If a
caller hands you a raw artifact instead of a script, condense it first using the
"Writing for the ear" rules below.

---

## Inputs (from the caller)
- **`script`** — the text to speak, already written for the ear (see rules below).
- **`voice`** — Kokoro voice id; default `am_adam`. Other common ids: `af_bella`
  (female), `bm_george` (male). Override per call or via `NARRATE_VOICE`.
- **`out`** — desired MP3 path. If the caller doesn't give one, default to
  `~/Projects/_audio/<ISO-date>-<slug>.mp3` (create the dir). When narration
  accompanies a saved artifact (e.g. a `/wrap` log), prefer saving the MP3
  next to it with the same basename so the pair stays together.
- **`deliver`** — whether to `SendUserFile` the result (default yes).

---

## Workflow

### 1. Pre-flight — ensure Kokoro is up
Load the voice tool (deferred): `ToolSearch` →
`select:mcp__plugin_voicemode_voicemode__service`. Then `service(kokoro, status)`;
if stopped, `service(kokoro, start)`. The status output reports the local
endpoint/port — if it differs from the default `http://127.0.0.1:8880`, pass the
full speech URL to the renderer via `KOKORO_URL`. If voice is unavailable and
can't be started, **say so and stop** — don't silently skip the deliverable.

### 2. Write the script to a temp file
Write the spoken script to `~/Projects/_audio/.script-<ISO-date>-<slug>.txt`
(or a scratch path). One clean block of prose; the renderer reads the whole file.

### 3. Render
```
skills/narrate/render-narration.sh <script.txt> <out.mp3> <voice>
```
(Resolve the script's path from `~/.claude/skills/narrate/` — it's symlinked
there by `install.sh`.) The script POSTs to Kokoro's OpenAI-compatible
`/v1/audio/speech` and writes the MP3. It encodes the text with `jq`, so quotes,
newlines, and Unicode are safe. Env overrides: `KOKORO_URL`, `KOKORO_MODEL`,
`NARRATE_VOICE`, `NARRATE_SPEED`. On failure it prints the HTTP code and the URL
it tried — surface that, don't pretend it rendered.

### 4. Deliver
`SendUserFile` the MP3 (status `proactive`) with a one-line caption naming the
source and rough length (e.g. "Handoff brief — ~90s, single voice"). These
sessions often run in an ephemeral remote container, so the saved path alone
won't reach the user's phone — `SendUserFile` is what gets it there. If running
locally and the user wants it opened, `open <out.mp3>`.

---

## Writing for the ear (apply if you must condense a raw artifact)
A document written for the eye reads badly aloud. Convert before rendering:
- **Lead with the gist**, then detail. No headings, no bullet characters, no
  Markdown — speak in short sentences and natural paragraphs.
- **Expand symbols and code into speech.** `~/.claude/settings.json` → "the
  settings dot json file"; `PR #42` → "P R forty-two"; `100.0 *` → "a hundred
  point zero, times"; `-->` / arrows → "leads to"; `claude/foo-bar` branch →
  "the foo-bar branch". Never read a raw path or code block character-by-character.
- **Drop the unspeakable.** Commit SHAs, long URLs, exact line numbers, and
  paste-able command blocks are for the eye — summarize their intent instead
  ("a small fix to the install script") or omit them.
- **Keep it tight.** ~150 words ≈ 60–90 seconds; ~600 words ≈ ~4–5 minutes.
  Past ~750 words a single request may strain; trim rather than dump.
- **Frame conversationally.** Open with orientation ("Here's where things stand…")
  and close with the one next thing, so it lands as a briefing, not a file read.

---

## Gotchas this skill encodes
- **Local Kokoro, not NotebookLM** — verbatim single-voice narration; no quota,
  no two-host podcast. For a conceptual two-host overview, that's NotebookLM's
  job (`audio-series` / `interview-prep`), not this.
- **Confirm the port** via `service(kokoro, status)` and pass `KOKORO_URL` if it
  isn't the 8880 default — don't assume and silently fail.
- **Deliver via `SendUserFile`** — a saved path in a remote container never
  reaches the phone on its own.
- **Render with `jq`-built JSON** (the script already does this) — the brief can
  contain quotes and apostrophes that would otherwise corrupt the request.
- **Don't fake success** — if Kokoro is down or the render errors, report it;
  never claim an MP3 exists when it doesn't.
