# Tempo cloud-sync — implement PR E-1a (Stage E: tests/index.html SW cache-poisoning fix)

You're working on Tempo, a vanilla-JS PWA + Capacitor iOS app. The
cloud-sync implementation plan is at `docs/sync-impl/PLAN.md` on
`main`. Stage 0, Stage A close-out, Stage B (B-1 → B-4), Stage C
(C-1), and Stage D (D-1 + D-2) are all shipped (PRs #46–#64).

E-1a is the **first of five Stage E sub-PRs** (Option B from the
E-1 kickoff). It is **engine-/infrastructure-only** — no merge
logic, no user-visible behavior change. Its single goal is to fix
the test-harness cache-poisoning bug surfaced during D-2's
engine-tester phase so all downstream E-1b/c/d/e (and E-2 / E-3)
test cycles run reliably on the canonical `localhost:8765` port.

**E-1a does NOT** touch any merge logic, any sync engine code, any
per-store merge file, F3, F8, or D-1 reconcile retrofit. Those live
in E-1b through E-1e.

---

## What this PR ships

A targeted fix to `tests/index.html` + `sw.js` (and possibly
`js/app.js`) so that loading `tests/index.html?fresh=verify` in a
real browser on `localhost:8765` always serves fresh code, even
after the main app at `/index.html` has registered a service
worker on the same origin.

### The bug, in plain terms

The PWA service worker (`sw.js`) registers when a user loads the
main app at `/index.html` via `js/app.js:99`. Once registered, the
SW is active for the whole origin. On the canonical test workflow:

```
python3 -m http.server 8765
# load http://localhost:8765/index.html   (registers SW)
# edit js/meds.js
# load http://localhost:8765/tests/index.html
```

…the second load gets intercepted by the SW's `fetch` handler at
`sw.js:82`, which is cache-first with `caches.match(event.request,
{ ignoreSearch: true })`. The cached pre-edit copy of `js/meds.js`
is served. The fresh edit is invisible to the test harness until
the SW is unregistered or its `CACHE_NAME` bumped. Engine-testers
debug code that "should pass" for hours before realizing.

D-2's workaround was to switch to `127.0.0.1:8766` (different
origin → no SW interference). That works but every developer has
to remember it. E-1a removes the workaround.

### Approach options (sync-auditor picks during Phase 1)

The audit's affected-files table determines which option lands:

**(a) Query-param bypass — `?nosw=1` in the SW fetch handler.**
`tests/index.html` adds a `<script>` snippet (or the test runner
sets it) that ensures the URL has `?nosw=1`. The SW fetch handler
inspects `new URL(event.request.url).searchParams` and skips cache
for any request with `nosw=1`, routing straight to network.

Pros: smallest blast radius; no path changes; existing cache logic
intact for the main app. SW receives ONE conditional branch at
the top of the fetch handler.

Cons: every test request URL needs the query param appended; the
SW change must NOT use `ignoreSearch: true` for the bypass check
(the existing `caches.match` call uses `ignoreSearch: true`, but
that affects cache *lookup*, not URL inspection — these are
independent).

**(b) Path-based bypass — `/tests/*` exempt in SW fetch handler.**
SW fetch handler inspects `new URL(event.request.url).pathname`
and skips cache for any request under `/tests/` (or
`/tests/index.html`, `/tests/*.js`, etc.).

Pros: zero changes to `tests/index.html`; transparent to testers;
no URL conventions to remember.

Cons: SW logic change is slightly larger; "what counts as a test
asset?" needs a clear rule (path-prefix is the obvious one).

**(c) Path-relocation — move tests to a path the SW doesn't cache.**
Move `tests/` to `test-runner/`. SW already only caches paths
explicitly listed in `ASSETS` (verify in `sw.js`); the cache match
also has the `ignoreSearch: true` setting. If the new path
genuinely doesn't appear in `ASSETS`, the cache returns no match
and the fetch falls through to network.

Pros: arguably cleanest semantically (test infra is separate from
app); no SW changes needed.

Cons: requires renaming a top-level directory; every test file's
relative `<script src="../js/*.js">` paths still work, but
documentation / CLAUDE.md / orchestrator-prompt references to
`tests/index.html` need updating; sw.js fetch handler still
intercepts requests under any non-`ASSETS` path and falls through
to `fetch(event.request)` — so option (c) actually works ONLY IF
the SW cache returns no match. Verify the cache-match miss path
goes to network without serving stale, which is the current
behavior at `sw.js:89`.

**Orchestrator recommendation: (a) `?nosw=1`** — smallest blast
radius; the SW fetch-handler change is one conditional; no path
renaming. The sync-auditor reviews and confirms or picks (b)/(c).

### Engine-implementer scope expansion required

E-1a's affected-files table will include:
- `tests/index.html` (always)
- `sw.js` (always under options a/b; verify under c)
- `js/app.js` (only IF option a needs registration-side coordination
  — likely NO, since the bypass is in the SW fetch handler not the
  registration call; auditor confirms)
- Possibly a top-level directory rename for option (c)

Per `.claude/agents/engine-implementer.md` default scope rules,
`tests/*` and `sw.js` are **out of scope** for engine-implementer.
**This brief explicitly expands engine-implementer's scope** for
E-1a using the same mechanism S0-1 used (one-off expansion;
documented in CLAUDE.md "Known gaps"):

> "If the dispatch brief's `Files in scope` list AND the audit's
> affected-files table both explicitly enumerate a path outside
> the default allowed set, treat the brief as authoritative for
> this PR."

The orchestrator's Phase 2 dispatch will reiterate this expansion
verbatim.

### Tests

**Automated tests:** none. The harness fix is itself the test
infrastructure — the only meaningful test is manual verification
that fresh code loads on every reload. Adding a `tests/sw-bypass.test.js`
would be circular (the SW being broken is what we're fixing).

**Manual verification (Phase 3 engine-tester runs this):**

1. Start a fresh browser profile (Chrome incognito works; clears
   service workers + caches on close).
2. `python3 -m http.server 8765 &` from repo root.
3. Load `http://localhost:8765/index.html`. The PWA registers
   its SW. Verify in DevTools → Application → Service Workers
   that the SW is "activated and running."
4. Load `http://localhost:8765/tests/index.html?fresh=verify`.
   Confirm the test runner page loads and tests execute. Capture
   the baseline pass count (expected: 396 — D-2 baseline).
5. **The actual cache-poisoning regression test:** in the editor,
   add a deliberately-broken assertion to ANY existing test
   (e.g., change an `assertEqual` in `tests/meds.test.js` to a
   value that will fail). Save.
6. Hard-reload `http://localhost:8765/tests/index.html?fresh=verify`
   (Cmd+Shift+R / Ctrl+Shift+R). Confirm the deliberately-broken
   test FAILS in the runner output. If it passes, the SW served
   the stale pre-edit version — the harness fix is broken.
7. Revert the deliberate-break edit. Reload. Confirm tests pass
   again.

Document the manual procedure in the audit and SESSION-LOG so
future testers have a regression check.

**Test count target after E-1a:** still 396. E-1a adds zero
automated tests; the existing 396 must still pass (no regressions
from the SW change).

---

## Required reading (before any code)

1. `docs/sync-impl/PLAN.md` — find the `### E-1` section (around
   line 336). E-1a is the first sub-PR of the Option-B split
   that Kyle confirmed.
2. `tests/index.html` — current script load order + page shell.
3. `sw.js` — entire file. The fix lives in the `fetch` event
   handler (lines around 82–90).
4. `js/app.js` lines 99–100 — current SW registration call site.
   Confirm whether E-1a needs to change this (likely no).
5. `docs/sync-impl/audits/D-2-AUDIT.md` — D-2 audit documents
   the harness gap as "deferred to E-1" (line ~86). E-1a is the
   resolution.
6. D-2's `docs/SESSION-LOG.md` Session-9 entry (kickoff prompt
   references this for the cache-poisoning forensic). Read for
   context on what the engine-tester actually hit.
7. CLAUDE.md "Known gaps" section — engine-implementer scope
   expansion mechanism precedent (S0-1).

---

## Hard rules

- **Audit before code.** First commit on the branch is
  `docs/sync-impl/audits/E-1a-AUDIT.md` listing affected files +
  risks + the chosen approach (a/b/c) with rationale. STOP after
  the audit and wait for Kyle's review.
- **Zero merge-logic scope.** No changes to `js/sync-engine.js`,
  `js/sync-firestore.js`, `js/sync-merge-*.js` (those don't exist
  yet — E-1b creates them), `js/schema.js`, `js/meds.js`,
  `js/history.js`. If you find yourself editing any of these,
  stop — that's E-1b/c/d/e scope.
- **No F3, F8, no D-1 retrofit.** Those live in E-1d / E-1c.
- **SW correctness preserved.** The main app at `/index.html`
  must still cache-first on its asset list. The bypass only
  applies to test requests. Verify by loading `/index.html`
  offline after the fix lands.
- **Engine-implementer scope expansion authorized.** The audit's
  affected-files table is the authoritative list — `tests/index.html`
  and `sw.js` are explicitly in scope for this PR despite being
  outside engine-implementer's default rule set.
- **Service worker cache bump.** `sw.js` `CACHE_NAME` gets
  bumped in this PR per repo rule (pr-shipper handles). The
  current value is `'stopwatch-v73-d2-doseLog-reconcile'`
  (`sw.js:1`). E-1a bumps to `'stopwatch-v74-e1a-test-harness-fix'`
  or equivalent.
- **Web GitHub Pages deploy stays byte-equivalent** except for
  the intentional changes to `tests/index.html` and `sw.js`.
- **Phase 4 ui-wirer SKIPPED.** The audit's affected-files table
  will list `tests/index.html` + `sw.js` only — no `js/*-ui.js`,
  no `css/*.css`, no `js/tempo-nav.js`. Per orchestrator-prompt
  autonomous transition rule: Phase 3 → Phase 5 skips Phase 4.

---

## IMPORTANT: D-2 (PR #64) is shipped on main

D-2 shipped at `b0fb615`. E-1a branches off freshly-merged `main`.

The harness gap E-1a fixes was surfaced DURING D-2's engine-tester
phase but NOT fixed there (D-2 used the `127.0.0.1:8766` workaround
to ship). E-1a is the proper fix.

---

## Deliverable

Branch `feat/sync-stage-e-harness-fix`, PR against `main`. Commits:

1. `docs(sync-impl): E-1a audit + harness-fix spec` — audit doc
   with affected-files table + risks + chosen approach (a/b/c)
   with rationale + manual-verification procedure. STOP HERE.
2. After greenlight: `fix(tests): tests/index.html SW
   cache-poisoning bypass (E-1a)` — the actual fix + manual
   verification in the SESSION-LOG.

PR title: `fix(tests): tests/index.html SW cache-poisoning fix (E-1a)`.

---

## After E-1a

E-1a unblocks the rest of Stage E. With the harness reliable,
sequential sub-PRs follow per Option B:

- **E-1b** — `SyncEngine.startSteadyState()` scaffold +
  per-store merge dispatcher + `sync-firestore.js`
  `runTransaction` CAS wrapper. Stub merge functions; no real
  logic. Branches off freshly-merged E-1a.
- **E-1c** — `js/sync-merge-meds.js` (wires D-2's
  `reconcileDoseLog` + D-1 reconcile retrofit + F15 toast hook).
- **E-1d** — `js/sync-merge-history.js` + F3 BFRB consolidation
  + F8 distraction sessionId-keyed. Largest single sub-PR.
- **E-1e** — `js/sync-merge-rest-log.js` + `js/sync-merge-presets.js`
  + presets `deletedAt` tombstone semantics.

Each sub-PR gets its own kickoff prompt + per-PR brief drafted by
the orchestrator off PLAN.md § E-1, with the relevant TODOs
(F3/F8/cadence/F15/CAS/backgrounding) inherited from the E-1
kickoff and resolved by Kyle before that sub-PR's audit fires.
