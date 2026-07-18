---
description: Mid-session audio catch-up — narrate either the session so far or just Claude's most recent output as an MP3, then keep working. Does NOT end, wrap, or pause the session; audio is the deliverable. Project-agnostic.
argument-hint: "[last | short | long]"
allowed-tools: Bash, Read, Write, Glob, Grep, Skill, ToolSearch, SendUserFile, mcp__plugin_voicemode_voicemode__service
---

Mid-session audio catch-up.

This is **not a wrap**. Don't end the session, don't save a session log, don't
generate next-move suggestions beyond what's already live in the conversation.
The deliverable is one MP3; after delivering it, pick the work back up exactly
where it was (or, if you were waiting on me, restate in one line what you're
waiting for).

## Parse `$ARGUMENTS`

- *(none)* or `short` → **session mode**, short level (~90s).
- `long` → **session mode**, long level (~4–5 min).
- `last` → **last-output mode** (length is adaptive — see below; `short`/`long`
  don't apply).

## Session mode — catch me up on the session so far

Write a speakable script from the conversation and observable state (this
session's commits/PRs if git work happened). Orient me as someone rejoining
work in progress — present tense, not a retrospective:

1. What this session set out to do.
2. What's been done so far — concrete artifacts only (files, commits, PRs,
   decisions), highlights not inventory.
3. Where things stand **right now**: what's in flight, what's blocked, and
   whether you're waiting on anything from me (if so, say exactly what).

Levels:
- `short` (default, ~90s): the three beats above, tight.
- `long` (~4–5 min): adds the *why* behind the load-bearing decisions — what
  problem each solved, what alternative was rejected, what tradeoff was taken.

## Last-output mode (`last`) — brief me on your most recent message

Narrate my most recent **substantive** output — the last assistant message
before this command that had real content (skip trivial acknowledgments and
one-line confirmations; reach back to the last message that said something).
Fidelity is adaptive:

- If it would speak in roughly a minute or less, convert it essentially in
  full for the ear.
- If longer, condense to the load-bearing points — findings, decisions,
  recommendations — at ~1–2 min.
- Either way, if that message asked me a question or left a decision with me,
  the script must end by restating it plainly — that's the part I most need
  to hear.

## Narration and delivery (both modes)

1. Follow the narrate skill's "writing for the ear" rules: no Markdown or
   bullets, expand paths/PR numbers into speech, drop commit SHAs, describe
   code rather than reading it, short natural sentences.
2. Hand the script to the `narrate` skill (`~/.claude/skills/narrate/`) with
   `voice=am_adam` and
   `out=~/Projects/_audio/<ISO-date>-<HHMM>-<project>-catchup.mp3`
   (append `-last` before `.mp3` in last-output mode). `<project>` = short
   kebab tag from the repo/dir name, like /wrap uses. The `<HHMM>` timestamp
   is required — this command can run several times in one session and the
   files must not collide.
3. **One line in chat** with the MP3 path, then — on its own line, in a fenced
   code block — a ready-to-run play command: `afplay "<full-path>"` (the real
   absolute path), so I can copy-paste it to listen if I want to, or ignore
   it. No other output; do not print the script.
4. If Kokoro is unavailable, say so and print the script in chat instead as a
   fallback — never claim an MP3 exists if it doesn't (and print no play
   command).
5. Then resume: continue the in-flight work, or restate in one line what
   you're waiting on me for.
