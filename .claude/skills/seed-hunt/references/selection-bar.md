# The selection bar — what qualifies a paper as the next seed

This is the living memory of the seed-hunt skill. It is updated by Phase 1 (the harvest)
at the start of every hunt, with Kyle's sign-off on the diff — never silently. Each
lesson cites the project evidence that earned it, because a bar entry without evidence is
just an opinion.

## The recipe (proven four times, as of 2026-07-14)

Take a published primitive and *reproduce and measure* a narrow slice of it honestly, at
hobby scale, under pre-committed statistical gates. The honest framing, always:
"reproduced and measured a published finding — here is the narrow, measured slice."
Never "I invented this."

## The bar

Score every candidate against each entry. A paper doesn't have to ace all of them, but a
hard fail on 1, 2, or 5 is disqualifying; the rest are weights, and *narrow* clears
become the fit-pilot's named risks in the next project's KICKOFF.

1. **"Reproduce and measure, never invent" is the entire defensibility.** Qualify a paper
   only if it offers a primitive re-implementable small AND a claim measurable as a
   narrow delta at hobby scale. *(forge-gap D1; decay-pin KICKOFF framing.)*

2. **Cheap + deterministic or it dies.** No training runs or rented-GPU dependence;
   models via OpenRouter at pennies (decay-pin's entire v1+v2: ~350+ episodes,
   single-digit dollars) **or local open-weights small enough for the laptop at
   ~$0/trial** (letter amended 2026-07-15, Kyle sign-off, at the workspace/J-lens pick —
   local activation/gradient access can be *more* deterministic than API text: outcomes
   read as logit rankings, no parse floor, no provider stalls). Success must be gradable
   by a deterministic oracle — mechanical pass/fail — never an LLM judge. Papers whose
   evaluation is inherently judge-y (open-ended generation quality) fail.
   *(forge-gap; decay-pin grader.py, D6.)*

3. **Prefer a mechanically verifiable manipulation.** decay-pin's superpower: the
   intervention (constraint evicted / present / re-injected) was verified per trial by
   string search — free, model-free, before trusting any outcome. A paper whose
   manipulation can't be checked mechanically forces you to trust the model twice.
   *(decay-pin M0 eviction gate through M5 visibility gate.)* Sharpened: a verifiable
   manipulation is necessary but not sufficient — also ask whether the verification
   *survives the model's freedom to transform the artifact*. ghost-patch's T2 verifier was
   clean (anchor matches code, target provably disjoint from the fix region, no fix leak),
   but a subject whose obedience mode is *wholesale rewriting* collapses the anchor and
   starves the verifier (deepseek: 7/9 INVALID loops anchor-unresolvable, 42.9%
   loop-INVALID — "the verifier's dilemma, iterative edition": the more destructive the
   obeyed manipulation, the less verifiable it becomes). Prefer verification by a *global
   property* over a positional anchor; else budget ≥40% INVALID slack for
   wholesale-rewriter subjects and size N after it — this attrition is a primary funnel
   driver (entry 11). *(ghost-patch M3 §5.4, Discussion §6.)*

4. **Confound hygiene.** Pick claims that can't be explained by training priors.
   decay-pin rejected destructive-op and privacy scenarios because trained aversion would
   contaminate "the in-context rule decayed." Ask of every candidate: could the effect
   exist without the paper's mechanism? *(decay-pin D2, D13.)* A second confound species:
   **intervention-wording × answer-structure**. On binary "A-before-B" puzzles, the
   directed correction "the order was wrong" *is* a flip instruction — qwen obeying it
   inflated the lossy arm and broke source_first, costing M4 its second model. Binary or
   flippable answer spaces are confound magnets; ask "could the manipulation's wording
   produce the effect by itself?" *(lossy-wall D25 outcome, M4 PARTIAL.)*

5. **Statistics is the binding constraint.** It was, in all eleven forge-gap stages and
   all six decay-pin stages — never the code, never the cost. Proportion outcomes need
   N≈20–40/arm; equivalence claims need 40 *clean* trials; a small promised effect nulls
   at affordable N. Prefer big expected deltas or tunable difficulty. *(forge-gap D7/D16;
   decay-pin D8, D11.)* Sharpened: effects living at the floor/ceiling (0-vs-1 rates) are
   the cheapest measurable things at hobby N — lossy-wall's M5 cliff judged decisively at
   N=20 — while mid-range rates are where hobby N dies (M4's ±0.10 equivalence needed
   ~N≥150/arm and was pre-registered unpowerable; the descriptive floor bought N=60 for
   ±11 points). Prefer claims at the extremes; treat mid-range claims as descriptive-only.
   *(lossy-wall D25, D26, D30.)*

6. **Pre-commit the gates as code — and a null is a headline.** decay-pin encoded every
   verdict (m0.py–m5.py) before any paid run and dry-ran them against real data (wrong-arm
   input exits INVALID). M4's STRATEGY-NULL was a *reportable result* because it was
   pre-committed. Prefer papers where even the null tells a story. *(decay-pin M4;
   forge-gap kill-triggers.)* Sharpened: a **falsification arm** — reproducing where the
   paper's own fix *fails* — produced lossy-wall's cleanest result (the M5 source-size
   cliff, crossovers bracketing the paper's anchors). Papers that publish their effect's
   boundary hand you that arm for free; and a PARTIAL with a *diagnosed mechanism*
   (lossy-wall M4's correction-flip confound) is a fully reportable outcome.
   *(lossy-wall D28/D29 REPRODUCED; D25 PARTIAL.)*

7. **Must be stage-able and pilot-gated.** Every project starts with a fit-pilot carrying
   kill/swap triggers, and every paid wave sits behind a free mechanical gate plus an N≈5
   smoke (decay-pin's M4 smoke caught a real crash before it could poison an arm).
   Measured-rate cost estimates beat guessing — three decay-pin stages running. The paper
   must tolerate that style. *(forge-gap S0–S11; decay-pin M0, D18, D20.)* Sharpened:
   never freeze an operational budget (token limit, timeout) measured on the *pristine*
   state for a protocol that drives the model into progressively degenerate states.
   ghost-patch froze a 3,200-token repair budget measured on clean code; on corrupted
   starts, repair responses ran 9–13k chars (length scales with corruption depth),
   dropping first-parse to 68.9% below the 80% floor and forcing parse-length INVALIDs.
   Pre-measure operational params on the *damaged* states, or budget parse slack.
   *(ghost-patch M4 §5.5.)*

8. **Range vs reuse is Kyle's call, not yours.** Reusing the harness muscle (tool loops,
   Wilson/Newcombe) is fast but "more of the same"; a new surface (RAG / memory /
   multi-agent / evals) shows range at higher build cost. Put the trade-off in the
   decision brief with the current weight stated.
   **Current weight (2026-07-14):** the Wilson/Newcombe + metered-client +
   pre-committed-gate-as-code discipline has now been reused **four** times (forge-gap
   built it → decay-pin copy-adapted → lossy-wall ported client/stats → ghost-patch
   reused it). ghost-patch *was* the last hunt's "new-surface" pick — it added
   Docker-sandboxed execution + deterministic test-grading of untrusted model-generated
   code — so **that card is now spent, and that surface is itself reusable**: a #5 in the
   code/agent-execution space would reuse *two* harnesses (even more "more of the same").
   For #5 the tilt **strengthens** toward a genuinely new evaluation surface (RAG /
   memory / multi-agent / agentic tool-use / evals-of-evals); the statistics discipline
   (entry 5) + honesty contract transfer anywhere. A fifth same-measurement-shape project
   needs an exceptional reason. Still Kyle's call at the brief, never yours.

9. **Extract the paper's released design before signing yours — and prefer papers that
   ship code.** lossy-wall's signed M5 sweep design was reversed *before any spend*
   because a free, pre-committed extraction of the author's released bench found the
   paper's actual design (grow source size at two budgets), which then reproduced
   decisively — the signed design could not have shown the paper's central claim
   (D28 A→B). Separately, the released harness powered the one-cell oracle cross-check
   that validated the whole independent build for $0.055 (AGREE, 6/6 cells — D1/D19/D20).
   Selection rule: a paper with a runnable, readable released harness outscores an
   otherwise-equal paper without one, and a verbatim design-extraction rider is a
   standard free pre-commit step in every stage brief. *(lossy-wall D1, D19, D20, D28.)*
   Sharpened by the cost case: ghost-patch's target paper shipped *no* code (promised
   appendix absent from v1), so bank, filter, prompts, and generator were all
   independently built ("ours, structure-faithful," 13 owned deviation rows) and *no
   oracle cross-check was possible* — the very validation that underwrote lossy-wall's
   independent build for $0.055 (AGREE 6/6). A code-less paper stays reproducible, but the
   validation floor is lower and comparisons can only ever be structural.
   *(ghost-patch §2, §3.3, §7.)*

10. **Name the effect's precondition at selection time — it's a per-model,
    per-structure risk.** When a claim conditions on the model first *doing* something
    (lossy-wall: accepting a planted wrong value — "drift take"), that precondition can
    fail three distinct ways, all observed: a capable model refuses it outright
    (qwen-7b re-derived the correct total, D8 trigger; llama pure-abstained on logic,
    D24); it biases the sample composition (deepseek took only ordering puzzles →
    ordering-heavy bank → a stratified two-model test went underpowered); and it can
    close off whole design regions (take collapsed on 24-item receipts — that grid
    point became unmeasurable, D27/D30). Ask of every candidate: what must the model
    do *first*, and what plausibly refuses? *(lossy-wall D8, D24, D27.)* Sharpened: a
    claim of the form *"the model knows X yet does Y"* is really two capabilities — the
    discrimination (knowing) and the behavior (doing) — and the cheap tier can fail the
    *knowing* half while the *doing* half sits at ceiling. ghost-patch: obedience
    near-ceiling (region-compliance 129/150, 127/146) but 0/6 models could label the
    wrong-location instruction INCORRECT in the evaluator role, including the paper's own
    Kimi K2.5 at ~25% vs its reported 63% — blindness, not blind obedience. For any
    "aware-but-does-wrong-thing" paper the awareness leg is the fragile one at the cheap
    tier: make it the fit-pilot's first gate and expect it may null (a headline, but it
    decapitates the chain's framing). *(ghost-patch M0 §5.1; KICKOFF risk 1c.)*

11. **Chained-thesis papers: power the funnel's END, and check it survives an early
    null.** When a paper's thesis is a chain of conditional claims (each link's population
    is a filtered subset of the previous link's output), honest per-trial attrition
    compounds *multiplicatively* down the chain — so the terminal link, usually the
    paper's punchline, is the *hardest* to power, not the easiest. ghost-patch sized its
    bank forward from M0's obedience rates, but INVALID drops + escapes were not in that
    model, and M4 entry starved to 2/16 clean states (both < 20) → chain gate
    UNDERPOWERED ×2, pre-declared at M3 close. Two riders: (a) size N from the *terminal*
    link backward, not the entry link forward — or prefer a terminal claim that sits at a
    floor/ceiling (entry 5) where small N decides; (b) score whether downstream links
    survive an *early*-link null — ghost-patch's M2/M3/M4 stayed measurable after M0/M1
    nulled, because "recovery from corrupted states" does not require the model to have
    been *aware* it was misled. A chain whose late links strictly require an early
    precondition is fragile; one whose links are independently measurable degrades
    gracefully. Weight class with a design rider, not a disqualifier; interacts with
    entries 3 and 5. *(ghost-patch M3-close pre-declaration; §5.4; M0/M1 re-scope.)*

## Watchlist (downgraded, not forgotten)

- **The capability cliff** *(forge-gap S7/S8)*: strong models ace simple mechanical tasks;
  weak ones fail wholesale at 0%. Downgraded after decay-pin's M0 — all three cheap
  models held clean ~0% floors, so the cliff didn't bite there. Still: if a candidate's
  phenomenon *requires model failures*, flag the plausibility that a cheap model exhibits
  them, and make it the fit-pilot's first question. lossy-wall added the cliff's mirror,
  the **competence ceiling**: a model can be too capable or skeptical to exhibit the
  *precondition* (bar entry 10's three examples). Both directions bit lossy-wall's
  roster but never its verdicts — tiered pilot triggers were armed first. Either
  direction of the cliff stays the fit-pilot's first question. ghost-patch adds a third
  axis: the cliff/ceiling is not one-dimensional — a model can sit *above* the cliff on
  task execution (obeys, often fixes the real bug) while sitting *below* it on the
  *discrimination* a precondition needs (cannot classify the manipulation as wrong). Flag
  both capabilities separately at pilot. *(ghost-patch M0.)*

## Project ledger

| project | paper / seed | span | headline outcome | closed |
|---|---|---|---|---|
| forge-gap (`~/Desktop/forge-gap`, archived) | the "Forge" self-hosted-reliability framing | S0–S11 | reproduced + measured the reliability gap; recipe established | S11, PR #18, merge `ed4c08f` (~2026-06) |
| decay-pin (`~/Projects/decay-pin`) | arXiv 2606.22528 — Governance Decay + Constraint Pinning | M0–M5 | 0%→100%→0% arc (floor/truncate/pinned) on 3 models, replicated on a 2nd task; v2 strategy axis: truncate 20/20 · summarize 2/40 (STRATEGY-NULL) · head-tail 0/40 (PROTECTIVE) | M5, PR #18, merge `5ae1a0a` (2026-07-06) |
| lossy-wall (`~/Projects/lossy-wall`) | arXiv 2606.25449 — Brittle Memory / reclaim eval | M0–M5 | v1 claims 1–3 REPRODUCED + independent-build cross-check AGREE 6/6; M4 logic PARTIAL (deepseek clears; correction-flip confound); M5 boundary REPRODUCED (cliff tracks the budget: N=4@300 → N=12@600); ≈$2.13 total | M5+D31, PR #33, merge `2de5b4d` (2026-07-09) |
| ghost-patch (`~/Projects/ghost-patch`) | arXiv 2607.04537 — "Obey, Diverge, Collapse" repair-failure chain | M0–M4 | chain closed end-to-end on 2 cheap models: obey NULL ×2 (awareness precondition NULL across 6 models incl. paper's Kimi ~25% vs 63%; single-pass drop +4.0/+3.6 pts) → recover REPORTED ×2 (78.3%/52.6%, pass-1 front-loaded) → compound REPORTED-qwen (pass-1-only escape 30.4%, curve [7,7,7,7,7]) / UNDERPOWERED-deepseek (wholesale-rewrite verifier starvation) → collapse UNDERPOWERED ×2 pre-declared + descriptive IDR 6/12 = 50% stuck-half; ~$1.42 total | M4 + close-out, PRs #13–15, merge `0cafc77` (2026-07-14) |

**Queue note (2026-07-15):** the #5 slot was re-decided at this date's hunt. Pick = the
Anthropic workspace/J-lens paper ("Verbalizable Representations Form a Global Workspace
in Language Models", transformer-circuits.pub/2026/workspace — no arXiv ID; internals/
interpretability surface, local open-weights). It displaced the same-morning-scaffolded
**blind-cite** (arXiv 2607.09349, Deceptive Grounding, RAG surface), which is **parked
next-in-queue** with its approved KICKOFF intact at `~/Projects/blind-cite` — park, not
kill; zero spend, no lessons to harvest. Both were range picks; deciding factors were
timeliness (workspace paper 9 days old, ecosystem replicating fast) and the internals
skill axis. The next hunt should treat blind-cite as the default #6 before sweeping.
