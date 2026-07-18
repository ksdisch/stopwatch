---
description: Multi-mode structured brainstorm. Launches blind agent teams to diverge on ideas for evolving THIS project, runs a two-sided critic gate that kills the WRONG-KIND ideas for the chosen mode, refines the survivors, and — only on your go-ahead — captures each as a docs/ideas vision doc + a linked backlog stub. Pick a MODE first; each mode flips the scoring function. Modes: Moonshot (bold/visionary — the default), QuickWin, Subtract, Harden, Premortem, Friction, Delight, Positioning, Reach. Project-agnostic; uses ultracode multi-agent orchestration.
argument-hint: [mode] [seed — theme/horizon/leash, e.g. "harden trust boundaries" or "moonshot phone agency, off-leash"]
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Task, ToolSearch, WebSearch, WebFetch
---

Input (optional): $ARGUMENTS

You are running `/brainstorm` — a **multi-mode structured-brainstorm engine**. One proven skeleton
(Orient → Diverge with blind parallel lenses → a two-sided critic gate → Refine → Synthesize →
review-first Capture) runs under a **mode** the user picks. The mode is the whole point: it swaps the
**scoring function** — *what the divergence lenses hunt for* and *what the critic gate kills*. Same
engine, different target.

The engine is the deliberate descendant of `/autonomous-milestone`'s brainstorm. That command scores
by impact/effort/risk and rewards safe, shippable, high-ROI wins. **`/brainstorm` lets you flip that
scoring function per run.** Its default mode (**Moonshot**) is the inverted twin — it kills ideas for
being *too safe / derivative / timid*. But that's just mode #1: other modes hunt for cheap wins,
removals, robustness, future-failures, friction, delight, positioning, or reach — each with its own
two-sided gate.

**The unifying trick:** every mode is a critic gate with **two opposing critics** that carve a narrow
band — one kills "too little of the mode's target," the *opposite* kills "incoherent / wrong-kind /
no-buildable-move." An idea survives only by clearing **both**. Moonshot's band is
*ambitious-but-reachable*; QuickWin's is *small-but-high-leverage*; Harden's is
*plausible-break-with-a-real-guard*; and so on. **No numeric scoring, ever** — the gate is binary and
qualitative.

**Use multi-agent orchestration for the fan-out** — the **Workflow tool** (this command is your
explicit ultracode opt-in; no further permission needed) or inline `general-purpose` subagents with
the role rules embedded inline. Don't reference `.claude/agents/` by name — those are templates, not
resolvable subagent types.

---

## Mode catalog

Pick ONE. Each lists: its **lenses** (what Diverge hunts for), its **gate** (the two opposing critics
— `A ✕ B` means "Critic A kills … and Critic B kills …"; survive only by clearing both), the
**inadmissible** objection (the kill-reason that belongs to a *different* mode — discard it if a
critic raises only that), and **defaults** (leash · horizon · survivors · capture type/size).

### ◆ Generate — net-new things to build

**🌙 Moonshot** *(default)* — *What could this become that no one expects?*
- **Lenses:** Futurist · Contrarian-Inverter · Domain-Transplant · Constraint-Killer · First-Principles-Rebuilder · Emotional-Core-Amplifier
- **Gate:** Too-Timid (kills safe/derivative/incremental — "a feature not a vision," "any competent team ships this," "just turns a dial") ✕ Incoherent-Fantasy (kills ungrounded grandiosity — "no mechanism," "a different project wearing this name")
- **Inadmissible:** risk / effort / ROI / "too hard" / "no resources" — those are the *virtues* this mode hunts. Risk is a reason to seed small, never to kill.
- **Defaults:** Tethered (changeable) · next-version→5yr · 3 survivors + always keep the boldest borderline one (wildcard) · `[Exploration]` / **L**

**⚡ QuickWin** — *Highest leverage-per-hour win sitting in plain sight?*
- **Lenses:** Almost-Done (one step from a feature already mostly built) · Force-Multiplier (small change that improves many existing paths) · Free-Lunch (capability the current code/data already affords for nearly nothing) · Recurring-Tax (friction paid every session) · Cheap-Delight (high felt-payoff polish on an existing path) · Low-Hanging-Correctness (near-free robustness/UX fix)
- **Gate:** Grandiosity (kills ambitious/multi-sitting/vision-shaped — "this is a Moonshot, wrong mode") ✕ No-Payoff (kills trivial-leverage busywork — "cheap but nobody benefits," "effort saved is noise")
- **Inadmissible:** "not ambitious/impressive enough." Smallness is the *point* here; effort objections are load-bearing, the exact inverse of Moonshot.
- **Defaults:** Tethered (locked — off-leash is meaningless) · next-feature · 4–5 survivors (cheap wins come in batches) · `[Improvement]` / **S–M**

### ◆ Reduce — make it better by being smaller

**✂️ Subtract** — *What is this hiding under, that it would be better without?*
- **Lenses:** Dead-Weight (a feature/option nobody uses or that doesn't earn its conceptual weight) · Merge (two concepts that should be one) · Default-over-Choice (a setting that should just be a good default) · Conceptual-Tax (an idea the user must learn that earns less than it costs) · Dependency-Cut (a lib/integration whose value no longer exceeds its drag) · Soul-Distillation (what survives if you delete everything non-essential — the cheapest-shippable-version lens)
- **Gate:** Soul-Amputation (kills cuts that remove something load-bearing — "this IS the product," "you cut the heart") ✕ Trivial-Tidy (kills cosmetic removals with no real gain — "deleting a dead var is not a brainstorm," "savings are noise")
- **Inadmissible:** "but someone uses it" / "it works fine as-is." Usage is not the same as *earning its keep*; survival requires the removal making the product **meaningfully better**, not just cleaner.
- **Defaults:** Tethered (locked — the point is to find the soul *by* subtraction) · next-version · 3 survivors · `[Improvement]` / **S–M** (a big merge may be `[Exploration]` / M)

### ◆ Fortify — protect what exists

**🛡️ Harden** — *How does this break, and what's the smallest guard?*
- **Lenses:** Hostile-Actor (a user/peer who griefs or abuses a trust boundary) · Hostile-Environment (flaky network, refresh mid-session, clock skew, device sleep) · Silent-Wrongness (corruption/drift that fails without an error) · Boundary-Violation (input/version/state crossing a contract unchecked) · Source-of-Truth-Drift (two stores that disagree over time) · Missing-Guardrail (an irreversible bad default with no undo)
- **Gate:** Paranoia (kills implausible threats this product will never face — "a cozy couch toy is not defending nation-states," "no one will ever do this") ✕ Security-Theater (kills guards that don't close the hole or have no concrete fix — "names a fear, ships no guard," "cosmetic")
- **Inadmissible:** "this adds code/complexity." Robustness costs code by definition; survival requires a **plausible break paired with a small, verifiable guard**.
- **Defaults:** Tethered (locked) · next-feature→version · 4 survivors (each paired with its guard) · `[Improvement]` / `[Bug]` / **S**

**💀 Premortem** — *It's 12 months dead — what killed it, and what's the antibody?*
- **Lenses:** Abandonment (maintainer burnout / "not worth my weekends" / recurring cost or toil) · Irrelevance (the field moved; it no longer matters) · Never-Found (it was good but no stranger ever discovered it) · Quiet-Rot (a dependency or platform assumption decayed silently) · Wrong-Bet (the core premise was never what the user actually wanted) · One-Person-Bus (all knowledge/momentum lived in one head)
- **Gate:** Optimism (kills comfortable deaths that dodge the project's real blind spot — "that won't happen to us," "a death we'd obviously catch") ✕ Doom-Without-a-Move (kills fatalism with no antibody — "names a death, proposes nothing buildable")
- **Inadmissible:** "we'd see it coming" / optimism of any kind. Survival requires a **plausible death paired with a concrete antibody / de-risk move**.
- **Defaults:** Tethered · 12 months (the framing *is* the horizon) · 3 survivors (the three likeliest deaths) · `[Exploration]` antibody / **M**

### ◆ Experience — how it feels to use

**🌊 Friction** — *Where does a real person wince, stall, or repeat themselves?*
- **Lenses:** First-Run-Wince (where a newcomer stalls in the first minute) · Repeated-Friction (the same small annoyance paid over and over) · Stall-Point (where the user hesitates because the next step is unclear) · Dead-End/Trap (a path that traps with no escape or undo) · Confusion/Wrong-Mental-Model (where the UI implies the wrong model) · Papercut (a tiny persistent irritation everyone tolerates)
- **Gate:** Invented-Pain (kills friction no real user of *this* product actually hits — "you made up a user") ✕ No-Smoothing-Move (kills "this is annoying" with no concrete fix attached — a complaint, not a brainstorm)
- **Inadmissible:** "users can just learn it / RTFM." Friction is real even when learnable; that a workaround exists does not make the friction admissible-to-keep.
- **Defaults:** Tethered (locked) · next-feature · 4–5 survivors · `[Improvement]` / **S–M**

**✨ Delight** — *Where does a moment pass with no reward, that could sing?*
- **Lenses:** Silent-Success (a win with no acknowledgement) · Unreacted-Action (an input that produces no feedback) · Missed-Milestone (an achievement that passes unmarked) · Personality-Gap (a flat surface that could carry voice/character) · Anticipation (a moment that could build then pay off) · Surprise-Reward (room for an unexpected small gift)
- **Gate:** Scope-Creep (kills new features masquerading as polish — the delight must ride an *existing* path, not add a new one) ✕ Hollow-Polish (kills decoration with no felt payoff — "prettier but you feel nothing")
- **Inadmissible:** "it's not strictly necessary / it's just polish." Necessity is not the bar — *felt payoff on an existing footprint* is. (But genuinely new scope is still a valid Scope-Creep kill.)
- **Defaults:** Tethered (locked) · next-feature · 4 survivors · `[Improvement]` / **S**

### ◆ Position — win an audience (the outward-facing axis)

**🎯 Positioning** — *Why pick THIS over the alternative a user would reach for instead?*
- **Lenses:** Substitute-It-Loses-To (the thing a user does *instead* — name it, then beat it) · Table-Stakes-Missing (the baseline the category has that this lacks) · Moat-Only-This-Can-Build (the advantage a rival can't or won't copy) · Category-Convention-to-Break (a genre default to defy on purpose) · Comparison-the-User-Runs (the head-to-head they run in their mind) · Wedge (the narrow thing it wins decisively)
- **Gate:** Valueless-Distinction (kills differentiators that are real but no user values — "a distinction nobody pays attention to") ✕ Copyable-Non-Moat (kills "advantages" the substitute already has or could trivially copy)
- **Inadmissible:** "we shouldn't worry about competitors / just build." The comparison the user runs is real whether or not you look at it; refusing to look is not a kill.
- **Defaults:** Tethered→Long leash (positioning may push identity — flag identity-shifts) · next-version · 3 survivors · `[Exploration]` / **M**

**📣 Reach** — *How does a stranger who'd love this ever find out it exists?*
- **Lenses:** Show-a-Friend-Artifact (the screenshot/result/keepsake worth sharing) · Invite-Moment (how one user pulls in the next) · 30-Second-Pitch-Surface (the landing/store page/trailer that must sell it cold) · Organic-Loop (a reason using it spreads it) · Discoverability-Tax (what makes it un-findable today) · First-Impression-Cold (the demo that sells it to someone who's never heard of it)
- **Gate:** Growth-Hacky-Foreign (kills virality tactics foreign to the soul — "referral-bribe spam on a cozy toy") ✕ Nobody-Would-Share (kills "shareable" artifacts no one would actually share — vanity output with no social charge)
- **Inadmissible:** "if it's good they'll come" / "marketing is gross." Distribution is part of the product, not a betrayal of it; refusing to design it is not a kill.
- **Defaults:** Tethered→Long leash · next-version · 3 survivors · `[Exploration]` / **M**

> **Not modes (on purpose):** backlog-operations (groom/prune/sequence/decompose/coverage) operate on the
> *backlog corpus*, not the product — a Diverge→critic-gate engine is the wrong shape for a dedup/sort/checklist
> task. They belong in a future `/backlog-hygiene`, not here.

---

## Orient  (always first — light, no fan-out)

Read the project; **don't assume a stack**. Auto-discover and skim: `CLAUDE.md` / `README` (identity,
tone, conventions), the backlog file (`BACKLOG.md` or equivalent), any roadmap/plan docs and the ideas
dir (`docs/ideas/` or equivalent), recent `git log`, and open issues (`gh issue list` if a remote
exists). Distill a ~10-line **soul brief**: what this project fundamentally *is*, its core loop/value,
who its user is, and 4–6 load-bearing assumptions you can infer. Put the existing backlog + ideas
titles in the brief so the team can self-censor anything already shipped, planned, or shelved. If the
brief is large, write it to a scratch file so subagents read it instead of re-deriving it.

## Pick a mode  (you + me — light, no fan-out)

Resolve the mode **before** Steer (the mode decides which gate and lenses load, so its params can't be
asked first):

1. **If the first token of the input matches a mode** (case-insensitive: `moonshot`, `quickwin`,
   `subtract`, `harden`, `premortem`, `friction`, `delight`, `positioning`, `reach`) → select it,
   pass the rest of the input as the seed, skip the menu.
2. **Else present the grouped menu** (the catalog above, condensed to one line per mode under its
   family header) and ask the user to reply with a mode name. Mark **Moonshot** as the default.
   *(Nine modes exceed a 4-option `AskUserQuestion`, so present them as a compact text menu, not a
   forced multiple-choice.)*
3. **Bare `/brainstorm` with no input and no reply** → default to **Moonshot** (preserves the original
   behavior).

Echo a one-line confirmation: *"Mode: <name> — hunting <its target>, killing <its wrong-kind>."*

## Steer  (you + me — light, no fan-out)

The chosen mode **pre-seeds** the steering defaults (leash · horizon · survivors from its catalog
entry; respect any **locked** param — e.g. QuickWin/Harden/Subtract/Friction/Delight lock Tethered,
Premortem pins 12-month). Open ONE `AskUserQuestion` to **confirm or tweak** only the unlocked axes
(prefill from the seed). Echo a one-line steering summary and **confirm before any fan-out**.

For Moonshot specifically, the leash question still matters most:
*Tethered* (bold but unmistakably this project; soul inviolable) · *Long leash* (may drift into
adjacent domains/platform shifts — flag each as an identity-shift) · *Off-leash* (pivots/forks/
reinventions — survivors marked speculative). Be honest that **tethered is the least bold setting**;
on off-leash, actually relax soul-fit, don't relabel the same pipeline.

## Diverge  (heavy — bounded, single blind round)

Run **6 lenses (9 max)** — **the chosen mode's lens set** — in parallel, **blind to each other**
(independence is what guarantees spread; if they see each other they anchor and converge). Each lens
is a different *transform on the project*, written in project/user/value terms.

**Divergence rules (every lens, every mode):**
- Produce **2–3 candidates**; **≥1 must explicitly target a stated load-bearing assumption** (name which).
- Each candidate must name **what is genuinely new for the mode's target** — for Moonshot a new verb
  / premise shift (not "more / bigger"); for Subtract a real removal that improves the product (not a
  cosmetic tidy); for Harden a plausible break (not an imagined one); etc. Strip the filler words
  ("more, bigger, also, at scale, 10x" for Moonshot; "cleaner, tidier" for Subtract); if nothing of
  substance remains, drop it.
- Self-test against the mode: *"would a veteran of this project flinch / nod / wince correctly?"* If
  every candidate is comfortable for that mode's target, the round is too weak — push the thinnest
  lenses once more.

Then, **on the main thread** (cheap): **dedup on the move axis** — two candidates that make the same
move the same way are one; keep the stronger. Ensure the pool spans **≥3 lenses**. (Optional: merge
two into a hybrid *only if* it's stronger-for-the-mode than both parents **and** carries its own
credible first step; otherwise keep the parents — never ship the safe midpoint.)

## Validate  (heavy — the two-sided gate)

Run **independent skeptics**: batch candidates (~3–5 per call, **never one agent per idea**) and
**never show one critic another's verdict** (consensus kills the outliers you want). Load the chosen
mode's **two opposing critics from the catalog**, plus a repo-grounded **Soul-Keeper** (`sonnet`) that
flags soul-fit and **auto-kills literal duplicates** of an existing backlog/ideas item (name which).
Run the two killing critics on `opus`.

A candidate **survives only if it clears BOTH** of the mode's critics — too much of the target to
dismiss as wrong-kind on one side, too grounded to dismiss as incoherent on the other. That two-sided
gate carves the narrow band this mode exists to find.

**Two non-negotiables — put both verbatim in every critic's inline prompt:**
1. **The mode's INADMISSIBLE objection is barred.** Quote the chosen mode's *Inadmissible* line. If a
   critic's only objection is the inadmissible one, discard the objection and keep the idea.
2. **Credible first wedge — scaled to the horizon.** Every survivor must name a believable first step.
   Near-term horizon → a small concrete change to a real file/area in *this* codebase, shippable in
   ~one sitting. Multi-year horizon → the first step may itself be substantial; judge "is the first
   step *believable*," not "is it small." No credible path at all = cut.

**No numeric scoring** — a weighted composite is false precision. Judge against the mode's bar
qualitatively. Keep the **N survivors** the steering asked for. If fewer than N clear both gates,
**say so and stop** — never promote wrong-kind filler to hit the quota. **Counter-pressure:** always
keep the single most *on-target* survivor even if borderline on a gate (the wildcard) — so the output
isn't uniformly the safe midpoint.

## Refine  (moderate — 1 `opus` pass per survivor; 2 max only with a stated reason)

Steelman each survivor — strengthen it against the critics' surviving objections by making it **more
itself, not safer** (if sharpening it blunts the mode's target, you sharpened it wrong). For each:
**name the bet** (the one thing that must be true for it to be worth it), **pin the first wedge** to a
real file/area, and **pre-fill the vision-doc fields** so Capture starts warm.

## Synthesize  (you + me — HARD STOP before any write)

Present every survivor inline as a **card**, framed for the mode:

- **What it is** — one concrete sentence.
- **The bet** — which assumption it targets; what would make a veteran of this project react (flinch
  for Moonshot, nod for QuickWin, wince-in-recognition for Friction/Harden, …).
- **Why now** — what about the current project state makes this timely.
- **Credible first step** — the smallest believable move that proves it's real (scaled to horizon).
- **Fit** — tethered / stretch / identity-shift; if it shifts, name what changes in what-this-project-IS.
- **What it changes** — the part of the project's experience/value that gets rewritten.

Flag if two survivors could merge into something stronger. Then ask **which to write up — one /
several / all / none.** Adding to the backlog is the deliverable, but it's a **review-first** write:
**do not write any file before this go-ahead.** A blanket prior approval doesn't count — this run
needs its own. "None" ends the run cleanly (ideas stay in chat).

## Capture  (light — only after explicit go-ahead)

For each approved survivor:

1. **Vision doc** → the ideas dir. Auto-discover: `docs/ideas/` → else `docs/` / `notes/` / `ideas/`
   → else create `docs/ideas/` and say so. **If an ideas doc already exists there, mirror ITS section
   shape**; otherwise use this default:
   `# <Title>` · **Status:** Idea — not committed. Added by `/brainstorm` (`<mode>` mode) on `<date>`. ·
   **Premise** · **The bet** · **Decisions / open questions** · **Credible first step** ·
   **Dependencies** · **Explicitly out of scope (revisit later)** · **Identity/positioning note**
   (tethered → "none"; else name what shifts). Filename: `<kebab-title>.md`.
2. **Backlog stub** → append under `## Open` only (**never edit existing items**). Auto-discover the
   backlog file (`BACKLOG.md` → else `TODO.md` / `ROADMAP.md` / `docs/backlog.md` → else propose
   creating `BACKLOG.md` and confirm). Use the **chosen mode's capture type + size** (see catalog —
   e.g. Moonshot `[Exploration]`/L, QuickWin `[Improvement]`/S–M, Harden `[Improvement]`|`[Bug]`/S,
   Premortem `[Exploration]` antibody/M):
   ```
   ### [<Type>] <Title>
   - **Why:** <the bet, one sentence>. See [`docs/ideas/<kebab-title>.md`](docs/ideas/<kebab-title>.md) for the full write-up.
   - **Acceptance:** <Moonshot/Positioning/Reach/Premortem: "Prototype the credible first step and judge whether the bet holds." · QuickWin/Subtract/Harden/Friction/Delight: the concrete change + how you'd confirm it landed.>
   - **Size:** <S | M | L per the mode>
   - **Added:** <YYYY-MM-DD>
   ```

**Report** every file written (absolute paths) + the mode used + any auto-discovery fallback chosen —
the report should be the only thing I need to read to know what landed.

---

## Token discipline & fan-out ceiling

- **Orient + Pick + Steer:** light, no fan-out. **Diverge:** the wide-but-shallow spend — 6 lenses
  default (9 max), 2–3 paragraph-seeds each, **single blind round**, no recursive spawning.
  **Validate:** `opus` only for the mode's two killing critics; `sonnet` for the Soul-Keeper; critics
  **batched to ≤3 calls total**. **Refine:** 1 `opus` pass per survivor (2 max, with a reason).
  **Capture:** `sonnet` formatting only.
- **Default-run ceiling: ≤ ~6 lens + ≤3 critic + N refine subagents** (~12 calls, most on `opus` only
  where novelty/verdicts are won). **State the actual count + the mode when you launch.**
- Keep the main thread lean: subagents return **compact cases, not transcripts**; write large
  intermediates to a scratch file; `/compact` at the **Validate → Refine** and **Synthesize** seams.

## Autonomy boundary

- ✅ **Without asking:** read anything, run `git` / `gh` to orient, spawn the brainstorm/critique
  subagents, present the menu / interview / cards.
- ⛔ **Never without an explicit per-run go-ahead:** write to the ideas dir or backlog file; create
  `docs/ideas/` or `BACKLOG.md`; commit, push, or open a PR.
- ⛔ **Never:** merge to `main`; edit existing backlog items (append only); write to production anything.
