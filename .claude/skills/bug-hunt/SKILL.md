---
name: bug-hunt
description: Proactively HUNT for bugs you don't know about yet — audit a codebase, subsystem, or diff by fanning out specialized finder agents, adversarially verifying every finding, presenting a ranked triage list, and then optionally handing the bugs you pick to systematic-debugging for the fix. Use whenever the user wants to find bugs proactively rather than react to a known one: "find bugs in X", "audit/sweep this codebase", "what's broken in the quiz module", "review this for defects before I ship", "hunt for issues", "is anything wrong with this code", "do a bug audit". This is the PROACTIVE counterpart to systematic-debugging (which fixes a KNOWN bug) — reach for bug-hunt when there is no specific bug in hand yet but the user wants to discover them. Effort is dialable from a quick single-agent pass to a full multi-agent ultracode fan-out with adversarial verification. Leaves systematic-debugging completely untouched and offers to invoke it at the end.
---

# Bug Hunt

A **proactive** bug-finding front-end. Where `systematic-debugging` takes a *known* bug and drives the hypothesis-first fix loop, `bug-hunt` answers the question that comes *before* it: **"what bugs are even in here?"** It surfaces them, proves they're real, lets you triage, and then — only if you say so — hands the ones you care about to `systematic-debugging`.

It is **composable, not a fork.** It never modifies or reaches into `systematic-debugging`; it just offers to invoke it at the end. That keeps the Obra skill pristine and upstream-updatable, and keeps this skill's job narrow: *find and prove*, not *fix*.

## The four phases

Run these in order. The gates between them are the point — the deliverable is a *trustworthy, triaged* list, not a firehose of maybes.

### 1. Aim — scope + effort tier

Pick **what** to hunt over and **how hard** to look. Propose a sensible default from context and confirm in one line rather than interrogating — the user usually knows the target; don't make them spell out every dimension.

**Scope:** the whole repo, a subsystem / path (e.g. `backend/app/quiz/`), or the current diff / branch (a good pre-merge sweep).

**Effort tier** — the dial the whole skill rotates on:

| Tier | Shape | Catches | Cost | Reach for it when |
|------|-------|---------|------|-------------------|
| **Solo** | one agent, one pass | obvious stuff in the code it reads | low | quick sanity check, a small diff |
| **Max-effort solo** | one agent, deepest reasoning, reads a subsystem end-to-end | subtle logic bugs in a *focused* scope | medium | "go deep on this one module" |
| **Ultracode fan-out** | N finders (diverse lenses) in parallel → adversarial verify → synthesize | breadth + cross-cutting bugs, false-positives filtered out | high | whole-codebase audit, or you want *confidence* in the list |

"Max-effort" (per-agent reasoning depth) and "ultracode" (number of agents) are **independent axes** — an ultracode fan-out can also run each finder at max effort. Don't present them as one slider.

### 2. Hunt — run the chosen tier

**Solo / max-effort solo:** read the target directly. Trace real execution paths, read the tests to learn *intended* behavior, then hunt the cases the tests *don't* cover — uncovered edges are where bugs live. Report concrete bugs with `file:line`, severity, and a why-it's-real. Not style nits.

**Ultracode fan-out:** this is where the leverage is. Adapt the bundled template at `references/hunt-engine.template.js` and launch it via the **Workflow** tool. The template encodes the proven pattern — *finders → adversarial verify → synthesize*. Your job:

1. **Derive the dimensions.** Slice the target into finder assignments along *subsystem × lens*: each finder gets one slice and one focus, so coverage doesn't overlap and blind spots differ. See `references/lenses-and-severity.md` for the lens catalog and how to map it onto a given codebase.
2. **Set `ROOT`** to the target path and fill the `DIMENSIONS` array.
3. **Keep the structure intact.** `pipeline(DIMENSIONS, find, verify-each)` then a synthesis agent. The adversarial verify step is *non-negotiable* — it's what turns "an LLM listed 30 plausible bugs" into a calibrated, reproduced list. Each verifier opens the real code and is told to **default to refuted** unless it can confirm from the source.

Scale the finder count to the scope and the stated effort — a few for a subsystem, 6+ for a whole repo. If you bound coverage (top-N files, single verify round), **say so**; silent truncation reads as "I checked everything" when you didn't.

### 3. Triage gate — present, then STOP

Present the surviving findings as a **ranked, verified** list. Then **stop.** Do not fix anything, do not open files to edit, do not start the next thing.

Rank by real-world impact (severity × confidence). For each: a one-line title, `file:line`, severity, a one-line *why it matters*, and the suggested fix. Lead with the highest-impact one. Surface the **themes** across findings too — a recurring root cause is often worth more than any single fix.

Save the full list to a dated report at `docs/bug-hunt/<YYYY-MM-DD>-<scope>.md` in the target repo, so it survives the session regardless of what the user picks.

Then ask which findings are worth acting on. **The user picks. Nothing auto-fixes.** This gate exists because a bug list is cheap to generate and expensive to act on blindly — the human's judgment on *which* bugs matter is the whole point.

### 4. Conclusion — offer the handoff

Once the user has picked, ask plainly:

> "Want me to kick off `systematic-debugging` on these now?"

- **Yes** → for each picked finding, invoke the **unmodified** `superpowers:systematic-debugging` skill (via the Skill tool), handing it the finding as the known bug to drive its reproduce → isolate → fix → verify loop. One finding at a time; let its own gates do their work.
- **No** → you're done. The dated report is saved; the user can return to it anytime.

This offer is the clean seam between the two skills: `bug-hunt` proves what's broken, `systematic-debugging` fixes it, and neither needs the other's internals.

## Why it's shaped this way

- **Find and fix are different shapes.** Hunting wants breadth and parallelism; fixing wants depth and discipline. Fusing them yields a tool mediocre at both. Separating them (with an explicit handoff) lets each be excellent.
- **The verify step is the trust.** Unverified LLM bug lists are mostly noise. The adversarial pass — open the real code, default to refuted, reproduce the scary ones, downgrade over-rated severities — is what makes the output worth a human's attention.
- **The triage gate respects your time.** Spend your judgment on *which* bugs matter, not on wading through false positives or having a fix applied you never asked for.
