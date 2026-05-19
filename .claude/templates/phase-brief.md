# Phase brief — orchestrator → subagent dispatch template

Reusable template the orchestrator at `.claude/orchestrator.md` fills in for each `Agent` dispatch. Fill in EVERY field. Empty `Files OUT of scope` is not allowed — at minimum, forbid every directory outside this phase's lane.

The filled-in version of this template becomes the `prompt` argument passed to the `Agent` tool, with `subagent_type` set to the matching specialist (`auditor` / `engine-implementer` / `engine-tester` / `ui-wirer` / `pr-shipper`). The `ui-wirer` phase is conditional — dispatched only when the audit's affected-files table includes UI files (`js/*-ui.js`, `index.html`, `css/*.css`, `js/tempo-nav.js`).

---

## Goal
<One sentence. Active voice. Names the PR ID.>

Example: "Produce the affected-files + blast-radius + risks audit for PR `<PR-ID>`, committed to `docs/audits/<PR-ID>-AUDIT.md` (general) or `docs/sync-impl/audits/<PR-ID>-AUDIT.md` (sync)."

## PR ID
<e.g., bl-2, E-3, rhythm-pillar-timeline>

## Audit path
<absolute path to the audit doc>

## Brief path
<absolute path to the brief doc>

## Blast radius (Phase 5 dispatch only)
<low | medium | high — read from the audit's Blast radius section>

## Required reading
<Ordered list. Be specific — exact paths, not "the relevant code". Subagents read in this order.>

- The brief at the path above
- The audit at the path above (if this is Phase 2 / 3 / 4 / 5)
- Root `CLAUDE.md` (always — durable conventions)
- `docs/CLOUD-SYNC-STRATEGY.md` v2.0 (sync PRs only — invariants live here)
- `iOS-BUILD.md` (PRs touching `ios/*` or `js/platform.js` native branch)
- <any specific code file the spec calls out>

## Files in scope (this phase MAY edit)
<Exact paths. Glob patterns OK only if every match is genuinely in scope. Write/Edit access only to what's listed here.>

- <path 1>
- <path 2>

## Files OUT of scope (this phase MUST NOT edit — read-only or untouched)
<Be explicit. List the directories the subagent's own prompt already forbids, plus any extra path the orchestrator wants doubly off-limits.>

- `js/*.js` (read only) — for auditor and engine-tester
- `tests/*.test.js` (read only) — for auditor, engine-implementer, pr-shipper
- `js/*-ui.js`, `index.html`, `css/*.css` — for all phases unless engine-implementer flags a new module
- `sw.js`, `ios/*`, `package.json` — for all phases except where explicitly allowed via scope expansion
- Any audit OTHER than `<PR-ID>-AUDIT.md` — for auditor

## Constraints (repo invariants this phase must respect)
<Default set — adjust per phase only if a constraint is loosened or tightened.>

- Vanilla JS — no new frameworks, no bundler.
- No DOM access in engine code (`js/<engine>.js` must stay pure).
- Use shared helpers: `Utils.formatMs` (js/utils.js), `escapeHtml` (js/dom-utils.js), `Platform.haptic` / `Platform.notify` (js/platform.js). Never re-implement.
- (Conditional — sync PRs only) All writes to synced stores stamp `deviceId` + `updatedAt` + `schemaVersion` via `js/schema.js`.
- (Conditional — sync PRs only) Local-first contract: `tempo_sync_state` is the kill switch — offline must keep working.
- Web bytes stay equivalent on GitHub Pages unless `sw.js` is also bumped in the same PR.
- Native-only code routes through `js/platform.js`.

## Success criteria (testable — orchestrator accepts the phase only if these are objectively satisfied)
<Concrete, measurable. Avoid "looks good" — name files, counts, behaviors.>

- <criterion 1>
- <criterion 2>
- <criterion 3>

## Return format (the subagent must emit EXACTLY this block, nothing else)
<Copy the agent's "Return format" block from `.claude/agents/<agent>.md` verbatim. The orchestrator parses this for the between-phase summary — deviations break parsing.>

```
### <Phase name> complete

**Files changed / written:**
- <path>: <one-line summary>

**<phase-specific counts or flags>:** <values>
**Open questions:** <list, or "none">
```

## Notes / phase-specific context
<Free-form. Anything unusual about this specific phase that the standard agent prompt does not cover. Examples:

- "The audit's blast-radius tier is `medium` — pr-shipper will run `sleep 30` proceed-by-default after showing summary."
- "Phase 2 must NOT delete the legacy `stopwatch_state` key; migration is read-only per the audit's risk table."
- "Tests must mock `Date.now` because this PR includes clock-skew clamping logic."
- "Scope expansion: brief + audit both enumerate `sw.js` and `tests/index.html` — engine-implementer may edit those under the scope-expansion clause.">
