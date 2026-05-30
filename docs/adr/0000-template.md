# ADR NNNN: <short title of the decision>

- **Status:** Proposed | Accepted | Superseded by [ADR-XXXX](XXXX-....md) | Deprecated
- **Date:** YYYY-MM-DD
- **Deciders:** ksdisch
- **Tags:** <2–4 lowercase tags, e.g. `architecture`, `sync`, `ios`>

## Context

What is the problem, and what forces are at play? Capture the constraints that are
specific to *this* repo — solo author, no-build vanilla-JS PWA, single real user,
ships to GitHub Pages (push-to-deploy) **and** a Capacitor iOS shell. Cite concrete
evidence inline (`file.js:line`, a doc under `docs/`, a PR number).

## Decision

State the decision plainly, in active voice ("We will…" / "We use…"). Point at where
the decision lives in the code with `file.js:line` anchors so a reader can verify it.

## Consequences

### Positive
- Concrete benefits, each tied to something real in the codebase.

### Negative / tradeoffs
- What this makes harder, what it forecloses, and the cost of reversing it.

## Alternatives considered

- **<alternative>** — why it was rejected *in this repo's context*.

## References

- `file.js:line` anchors, related ADRs by number, related docs under `docs/`.

---

> **Conventions.** ADRs are numbered (`000N-kebab-title.md`), append-only, and
> immutable once **Accepted** — to change a decision, write a new ADR that supersedes
> this one and update the `Status` line above to point at it. The per-PR audit trail
> (`docs/audits/`, `docs/sync-impl/audits/`) records *implementation* decisions; ADRs
> record the durable, cross-cutting ones.
