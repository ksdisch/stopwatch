---
description: Run the Tempo test suites and report a trustworthy verdict — npm test (headless engine suite) with the documented flake-adjudication rule, plus the Firestore-rules and Life-OS council suites when their files are in play. Reports failures verbatim; never edits code or tests to get to green.
---

Run the right test suites for the change at hand and report. Optional scope hint: `$ARGUMENTS`
(e.g. `engine`, `rules`, `council`, or file paths — default is the engine suite, adding the
others when the diff touches `firestore.rules`/`tests/rules/` or `council/`).

The full background (why headless lies sometimes, what the title means) is
`docs/playbooks/browser-verification.md`. Short version below — follow it exactly.

## 1. Engine suite (default)

```bash
npm test
```

- One-time setup if it errors about playwright: `npm ci` then `npx playwright install chromium`.
- Exit 0 ⇒ green. The line `TEST RESULT: PASS (n)` is the canonical test count.
- `FAIL (n)` ⇒ **n = failure count**, and the failing `describe → it` lines are in the
  printed `#results` transcript. `npm test` already auto-retried once before reporting FAIL.

## 2. Adjudicate a FAIL before believing it

- If **every** failure is in the sync-engine steady-state cluster (the documented
  `_steadyRunInFlight` latch — names mention steady state / merge dispatch), it may be the
  known headless-only flake. Adjudicate in a **visible** browser (playbook Recipe A):
  serve `python3 -m http.server 8765`, open `http://localhost:8765/tests/index.html` via the
  playwright MCP, wait for the title `PASS (n)` / `FAIL (n)`, read `#results`. Kill the
  server after (`pkill -f "python3 -m http.server 8765"`).
- Any failure outside that cluster, or one that reproduces in the visible tab, is REAL.

## 3. Other suites (when in scope)

```bash
npm run test:rules            # firestore.rules / tests/rules changed — needs Java (emulator)
npm --prefix council test     # council/** changed — pure node --test, no Firestore access
```

Never run `council/synthesize.mjs` or `council/seed-pillars.mjs` as a "test" — they write
production Firestore.

## 4. Report

- Verdict per suite run: `PASS (n)` / `FAIL (n)` with the verbatim title line.
- On failure: the failing `describe → it` list, grouped by test file, plus whether the
  flake-adjudication rule was applied and what the visible-tab verdict was.
- Do NOT edit code or tests inside this command to silence failures — report and stop.
  (Fix loops belong to `/fix-bug` or `/tdd`.)
