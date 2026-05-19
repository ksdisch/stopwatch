# Tempo session starter

Paste one of the two prompts below at the start of any fresh Claude Code session on Tempo. Path A is the default; Path B is for shipping a specific PR via the orchestrator.

---

## Path A — General work (default)

```
I'm Kyle, owner of Tempo (cross-platform stopwatch/timer/wellness PWA + Capacitor iOS shell). Please read CLAUDE.md first — it has the project phase, hard rules, conventions, and the active Feature Backlog table. Then check docs/SESSION-LOG.md for the latest session entry to see what shipped recently.

Project context to keep in mind:
- Phase: post-Phase 9. Cloud sync (28 PRs across S0/A/B/C/D/E) shipped 2026-05-15. Now in single-PR feature mode (recent: rhythm pillar, ambient sound, Flow vibration intervals).
- Stack: vanilla HTML+CSS+JS, no build step, no framework. Capacitor 6 wraps for iOS (Platform.haptic + Platform.notify route web vs native). Firebase / Firestore for cloud sync. Deploys via git push to main → GitHub Pages.
- Hard rules: audit-before-code is institutional. All native APIs route through js/platform.js. Sync-store writes stamp deviceId + updatedAt + schemaVersion via js/schema.js. sw.js CACHE_NAME bumps on every cached-asset change.

Once you've read those, tell me what's queued in the Feature Backlog table, what's been shipped recently (per SESSION-LOG.md), and ask which I want to work on.

Do NOT push to main directly. Do NOT add features, refactors, or scope beyond what we agree on.
```

---

## Path B — Ship a specific PR via the orchestrator

```
I'm Kyle. Please act as the PR-shipping orchestrator.

Read .claude/orchestrator.md end-to-end and adopt it as your system prompt for this session. Read CLAUDE.md and (if relevant) docs/TEMPO-PLAN.md / docs/CLOUD-SYNC-STRATEGY.md as standing context.

The PR I want to ship is: <PR-ID>.

If docs/briefs/<PR-ID>-BRIEF.md (or docs/sync-impl/prompts/<PR-ID>-PROMPT.md for sync PRs) doesn't exist yet, draft a skeleton from this intent — <one-line description of what the PR does> — using docs/sync-impl/prompts/S0-1-PROMPT.md as the canonical shape, write it to the expected path, and pause for me to fill in and confirm before you dispatch the auditor.

If the brief already exists, proceed: dispatch the auditor, pause for me to review the audit (especially the Blast radius tier — I can edit it before saying "go"), then run the rest of the phases. Push + PR open are gated on the audited blast-radius tier — low ships hands-free, medium has a 30-second proceed-by-default window I can interrupt, high pauses for my explicit "ship it".
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
