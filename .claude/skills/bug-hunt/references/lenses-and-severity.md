# Lenses, dimensions, and severity

Reference for the **Hunt** phase — how to slice a target into finder assignments, what each lens hunts for, how to calibrate severity, and how the adversarial-verify step must behave.

## Slicing: subsystem × lens

A good finder assignment is one *slice* of the codebase seen through one *lens*. Slicing by subsystem keeps finders from overlapping; assigning each a distinct lens makes their blind spots differ, so together they cover more than N identical passes would. Map the lenses below onto whatever subsystems the target actually has — don't force lenses that don't apply (a pure library has no "integration seam"; a CLI has no "frontend state").

## Lens catalog

- **Correctness / logic** — off-by-one, wrong branch, partial-credit / empty-input edges, rounding, state desync between steps. Read the tests for intended behavior, then hunt the cases they don't cover.
- **Integration / API seam** — contract drift between caller and callee (e.g. TS types vs server models), field name / casing mismatch, wrong status-code handling, CORS / proxy / base-URL config, empty-state and pagination assumptions.
- **Data-integrity / persistence math** — SQL correctness (joins, missing `WHERE`, string-formatted injection), migration ordering / idempotency, transaction & commit gaps, race conditions on concurrent writes, and any domain math (scheduling, scoring, aggregation) on empty or degenerate inputs.
- **Parsing / external-call robustness** — malformed input (encoding, BOM, truncation), unhandled exceptions from external calls, missing timeouts / retries, bare `except` swallowing errors, path handling / traversal.
- **Frontend state** — effect dependency bugs (stale closures, missing deps, infinite loops), updates after unmount, async fetch races, unguarded null/undefined access on fetched data, missing error/loading states, list keying.
- **Security** — injection, path traversal, missing input validation / size limits, secrets in logs or responses, over-permissive CORS, unsafe deserialization, command injection. Weight findings by the app's realistic deployment model.

## Severity rubric

- **critical** — data loss, security breach, or a crash on a common path.
- **high** — wrong results / corruption on a realistic path, or a security issue with real exposure.
- **medium** — a feature silently misbehaves for a reachable cohort, or a bounded data issue.
- **low** — display-only, narrow-trigger, self-healing, or latent issues with no live impact today.

Most real findings land low/medium. Resist inflation: a calibrated-low list is far more useful than one where everything is "high." The synthesizer should rank by severity × confidence and lead with the highest-impact finding.

## The adversarial-verify contract

Every finding gets an independent verifier whose job is to **refute, not confirm**:

- **Open the actual file and read the surrounding code** before ruling. Never rule from the finder's description alone.
- **Default to `isReal: false`** unless the code genuinely exhibits the bug.
- **Reproduce the scary ones** (security, data-integrity) where feasible — an empirically reproduced finding is worth ten plausible ones.
- **Adjust severity** down (or up) if the finder mis-rated it. Over-rating is the common failure mode; downgrading inflated mediums to low is normal and healthy.

This step is the difference between a list a human can act on without re-checking every line, and noise. It is the heart of why this skill is worth running.
