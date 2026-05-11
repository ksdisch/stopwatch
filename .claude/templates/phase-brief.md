# Phase brief — orchestrator → subagent dispatch template

Reusable template the orchestrator at `.claude/orchestrator-prompt.md`
fills in for each `Agent` dispatch. Fill in EVERY field. Empty
`Files OUT of scope` is not allowed — at minimum, forbid every
directory outside this phase's lane.

The filled-in version of this template becomes the `prompt` argument
passed to the `Agent` tool, with `subagent_type` set to the matching
specialist (`sync-auditor` / `engine-implementer` / `engine-tester` / `ui-wirer` /
`pr-shipper`). The `ui-wirer` phase is conditional — dispatched only
when the audit's affected-files table includes UI files (`js/*-ui.js`,
`index.html`, `css/*.css`, `js/tempo-nav.js`).

---

## Goal
<One sentence. Active voice. Names the PR ID.>

Example: "Produce the affected-files + risks audit for PR B-1 (Stage B
SyncEngine bootstrap), committed to `docs/sync-impl/audits/B-1-AUDIT.md`."

## PR ID
<e.g., B-1>

## Required reading
<Ordered list. Be specific — exact paths, not "the relevant code".
Subagents read in this order.>

- `docs/sync-impl/PLAN.md` — find the `### <PR ID>` section
- `docs/sync-impl/prompts/<PR-ID>-PROMPT.md`
- `docs/sync-impl/audits/<PR-ID>-AUDIT.md` (if this is Phase 2/3/4)
- `docs/CLOUD-SYNC-STRATEGY.md` v2.0 (always — invariants live here)
- <any specific code file the spec calls out>

## Files in scope (this phase MAY edit)
<Exact paths. Glob patterns OK only if every match is genuinely in
scope. Write/Edit access only to what's listed here.>

- <path 1>
- <path 2>

## Files OUT of scope (this phase MUST NOT edit — read-only or untouched)
<Be explicit. List the directories the subagent's own prompt already
forbids, plus any extra path the orchestrator wants doubly off-limits.>

- `js/*.js` (read only) — for sync-auditor and engine-tester
- `tests/*.test.js` (read only) — for sync-auditor, engine-implementer, pr-shipper
- `js/*-ui.js`, `index.html`, `css/*.css` — for all phases unless engine-implementer flags a new module
- `sw.js`, `ios/*`, `package.json` — for all phases except where explicitly allowed
- Any audit OTHER than `<PR-ID>-AUDIT.md` — for sync-auditor

## Constraints (repo invariants this phase must respect)
<Default set — adjust per phase only if a constraint is loosened or
tightened.>

- Vanilla JS — no new frameworks, no bundler.
- No DOM access in engine code (`js/<engine>.js` must stay pure).
- Use shared helpers: `Utils.formatMs` (js/utils.js), `escapeHtml`
  (js/dom-utils.js), `Platform.haptic` / `Platform.notify`
  (js/platform.js). Never re-implement.
- All writes to synced stores stamp `deviceId` + `updatedAt` +
  `schemaVersion` via `js/schema.js`.
- Local-first contract: `tempo_sync_state` is the kill switch — offline
  must keep working.
- Web bytes stay equivalent on GitHub Pages unless `sw.js` is also
  bumped in the same PR.
- Native-only code routes through `js/platform.js`.

## Success criteria (testable — orchestrator accepts the phase only if these are objectively satisfied)
<Concrete, measurable. Avoid "looks good" — name files, counts, behaviors.>

- <criterion 1>
- <criterion 2>
- <criterion 3>

## Return format (the subagent must emit EXACTLY this block, nothing else)
<Copy the agent's "Return format" block from `.claude/agents/<agent>.md`
verbatim. The orchestrator parses this for the between-phase summary —
deviations break parsing.>

```
### <Phase name> complete

**Files changed / written:**
- <path>: <one-line summary>

**<phase-specific counts or flags>:** <values>
**Open questions:** <list, or "none">
```

## Notes / phase-specific context
<Free-form. Anything unusual about this specific phase that the
standard agent prompt does not cover. Examples:

- "The A-1 audit already covers F4/F6/F7 — do not re-audit them, only
  the new B-1 surface."
- "Phase 2 must NOT delete the legacy `stopwatch_state` key; migration
  is read-only per the audit's risk table."
- "Tests must mock `Date.now` because B-1 includes clock-skew clamping
  — see `tests/sync-stamps.test.js` for the pattern."
>

- <note 1>
- <note 2>
