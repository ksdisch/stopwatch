# Tempo session starter

Paste one of the two prompts below at the start of any fresh Claude Code session on Tempo. Path A is the default; Path B is for shipping a specific PR via the orchestrator.

---

## Path A — General work (default)

```
I'm Kyle, owner of Tempo (cross-platform stopwatch/timer/wellness PWA + Capacitor iOS shell).

Durable context:
- Stack: vanilla HTML+CSS+JS, no build step, no framework. Capacitor 6 wraps for iOS (Platform.haptic + Platform.notify route web vs native). Firebase / Firestore for cloud sync. Deploys via git push to main → GitHub Pages.
- Hard rules: audit-before-code is institutional. All native APIs route through js/platform.js. Sync-store writes stamp deviceId + updatedAt + schemaVersion via js/schema.js. sw.js CACHE_NAME bumps on every cached-asset change.

Catch yourself up on where the project actually is right now — read it from the repo, not from this prompt:

1. Read CLAUDE.md for the current Phase summary, conventions, and the active Feature Backlog table.
2. Read the latest entries in docs/SESSION-LOG.md to see what shipped most recently.
3. Run `git log --oneline -25 main` and cross-check against SESSION-LOG.md + the Feature Backlog table. PRs sometimes ship without a session-log entry, and backlog rows can sit marked "queued" after they've been merged. If you spot any staleness, flag it.

Then tell me:
- What the Feature Backlog table currently says is queued (with any "actually shipped" corrections you spotted from the git-log cross-check).
- What's shipped recently (per SESSION-LOG.md plus any post-log commits).
- Ask which I want to work on — give me 2–4 concrete next-step options with a recommendation and one-line merits/tradeoffs per option.

Do NOT push to main directly. Do NOT add features, refactors, or scope beyond what we agree on.
```

---

## Path B — Ship a PR via the orchestrator

Two forms — fill in whichever fields you have. The agent picks the branch based on what you supplied.

```
I'm Kyle. Please act as the PR-shipping orchestrator.

Read .claude/orchestrator.md end-to-end and adopt it as your system prompt for this session. Read CLAUDE.md and (if relevant) docs/TEMPO-PLAN.md / docs/CLOUD-SYNC-STRATEGY.md as standing context.

PR target: <PR-ID, or leave blank to have me help you pick>
Intent: <one-line description of what the PR does, or leave blank>

Behavior depending on what I gave you:

— If I supplied a PR-ID + intent:
  Follow the orchestrator's routing in `Path routing (sync vs general)`. If the brief at the routed path (`docs/sync-impl/prompts/<PR-ID>-PROMPT.md` for sync, `docs/briefs/<PR-ID>-BRIEF.md` otherwise) doesn't exist yet, follow the orchestrator's `If the brief is missing` path: draft a skeleton from the intent above using `docs/sync-impl/prompts/S0-1-PROMPT.md` as the canonical shape, leave TODO placeholders, and pause for me to fill them in before dispatching the auditor. If the brief already exists, dispatch the auditor immediately.

— If I left PR-ID and/or intent blank (e.g., "ship the next thing", "pick something good"):
  First do Path A's discovery — read CLAUDE.md (Feature Backlog), latest docs/SESSION-LOG.md entries, and `git log --oneline -25 main` to cross-check for unlogged PRs / stale backlog rows. Surface 2–4 concrete next-PR options with a recommendation and one-line tradeoffs. Once I pick, mint a PR-ID slug (kebab-case feature name, or backlog-row reference like `bl-3`, or sync-staged ID if applicable per docs/sync-impl/PLAN.md) and a one-line intent based on the pick, confirm both back to me, then enter the brief-drafting flow above.

Standard orchestrator gating applies once we're in the phase loop: pause after the audit for me to review (I can edit the Blast radius tier before saying "go"). Push + PR open are gated on the audited tier — low ships hands-free, medium has a 30-second proceed-by-default window I can interrupt, high pauses for my explicit "ship it."
```

---

## What every session should know

Files to load when relevant (only those that exist in this repo):

- `CLAUDE.md` — project phase, hard rules, conventions, stack, Feature Backlog table, State Model, Subagent conventions
- `docs/TEMPO-PLAN.md` — architecture + module specs (binding for unbuilt pillars)
- `docs/CLOUD-SYNC-STRATEGY.md` v2.0 — sync invariants F1–F21 (binding for sync PRs)
- `docs/sync-impl/PLAN.md` — sync PR roadmap (binding for sync PRs)
- `docs/SESSION-LOG.md` — cross-session handoff log
- `iOS-BUILD.md` — Capacitor iOS playbook
- `docs/ANALYTICS-PLAN.md` — analytics module buildout reference

## What no session should do automatically

- Push to `main` directly (always feature branch + PR)
- Merge a PR without explicit user approval
- Add features, refactors, or scope beyond the active brief
- Skip the audit phase when running the orchestrator
- Bypass the blast-radius gating in pr-shipper (high-tier work waits; medium-tier work has a 30s proceed-by-default window; low-tier ships hands-free)
- Call `navigator.vibrate` or `new Notification(...)` directly — always route via `Platform.haptic` / `Platform.notify`
- Re-implement `Utils.formatMs` or `escapeHtml` — use the shared helpers
- Write to a synced store without stamping `deviceId` + `updatedAt` + `schemaVersion` via `js/schema.js`
- Bump `sw.js` `CACHE_NAME` casually — only on PRs that change cached web assets

## Quick reference — where artifacts live

| Artifact | General PR | Sync PR |
|---|---|---|
| Brief | `docs/briefs/<PR-ID>-BRIEF.md` | `docs/sync-impl/prompts/<PR-ID>-PROMPT.md` |
| Audit | `docs/audits/<PR-ID>-AUDIT.md` | `docs/sync-impl/audits/<PR-ID>-AUDIT.md` |
| Plan tick-off | n/a | `docs/sync-impl/PLAN.md` |
| Session log entry | `docs/SESSION-LOG.md` | `docs/SESSION-LOG.md` |
| Backlog tick-off | `CLAUDE.md` Feature Backlog table | n/a (sync PRs track via PLAN.md) |
