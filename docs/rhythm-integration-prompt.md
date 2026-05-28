# Rhythm Integration Assessment — Prompt

Paste this prompt into a Claude Code session that has access to both the
`personal-health-elt` and `stopwatch` repositories. It asks the assistant to
investigate whether the `personal-health-elt` codebase can be refactored into
the **Rhythm** module of Tempo/Stopwatch, and to produce either an integration
plan or an explanation + alternatives.

---

You have two repositories available in this session:

- `personal-health-elt` — a server-side Python ELT pipeline (uv, PostgreSQL,
  dbt, Prefect, Streamlit) that ingests Apple Health / HealthKit exports and
  serves health analytics (recovery signals, training load, sleep).
- `stopwatch` (branded "Tempo") — a vanilla-JS Progressive Web App with no
  framework and no build step, storing data in localStorage + IndexedDB
  (optional Firebase). It has a module called **Rhythm**.

MY HYPOTHESIS (test it — do not assume it's true): I suspect the
`personal-health-elt` code could be refactored and merged into the **Rhythm**
portion of Tempo relatively easily. I might be wrong; the two may not fit at
all. Your job is to investigate and give me an honest, evidence-based verdict,
not to confirm my hunch. If my hypothesis is wrong, say so plainly.

STEP 1 — Investigate before judging. Actually read both codebases. For each,
establish: language(s) and runtime, build/deploy model, architecture and module
organization, the data model and where data is stored, how it runs, and key
dependencies. Study the **Rhythm** module in depth (its files, what it does
today, the data it reads, its current scope and gaps) and the full
personal-health-elt pipeline (extract → load → transform → serve, and what each
layer produces). Cite specific file paths as evidence. Do not assert
compatibility or incompatibility you haven't verified in the code.

STEP 2 — Assess fit across these dimensions:
  1. Runtime/language compatibility — can the code run in the same environment,
     or would it need rewriting?
  2. Architectural fit — server/pipeline vs. client/PWA, build step, deps.
  3. Data-model fit — what each side stores and produces; could one feed the other?
  4. Conceptual/feature overlap — do they solve related problems?
  5. Effort vs. value of integrating.
Consider the FULL spectrum of "integration," not just a code port: literal code
reuse, rewriting logic in the target's stack, consuming one as a data source for
the other, or porting only concepts/algorithms. My hypothesis assumes a
code-level refactor; tell me if a different form of integration makes more sense.

STEP 3 — Deliver the verdict and the matching output.
Begin with:
  • Verdict: one of `Viable as imagined` / `Viable in a different form` / `Not viable`
  • Confidence: low / medium / high, with a one-sentence reason
  • Summary: 3–5 sentences a non-technical reader could follow

Then, based on the verdict:

  If VIABLE (as imagined or in a different form) — produce a concrete plan:
    - what specifically moves into Rhythm/Tempo, and in what form (ported as-is,
      rewritten, consumed as data, concept-only)
    - what must be rewritten or replaced, and why
    - phased, sequenced steps with a rough effort estimate per phase
    - a data/schema mapping between the two sides
    - risks, unknowns, and decisions you'd need from me
    - the smallest valuable first slice to build

  If NOT VIABLE — produce:
    - a specific, code-grounded explanation of why (not generic hand-waving)
    - the 2–4 biggest blockers
    - 2–4 alternative ways to get the value I'm probably after (e.g., share data,
      reuse concepts, a separate integration), each with its tradeoffs

CONSTRAINTS:
  - Do NOT write, modify, or commit any code in this task. Produce a written
    assessment only.
  - Ground every claim in what's actually in the repos; cite file paths.
  - If something is genuinely ambiguous or needs my decision, ask instead of guessing.
  - Be direct and concise. Lead with the verdict.
