---
description: Repo-tuned bug-fix loop for Tempo — triage against the known-failure playbooks first (stale SW cache is the #1 false alarm), root-cause before editing, add a regression test, fix minimally per the repo conventions, verify in a fresh browser context, and land on a fix/ branch. Pass the bug description (symptom + where seen) as the argument.
---

Fix a bug the Tempo way. Bug report: `$ARGUMENTS`

Work the steps in order; don't skip the triage or the root-cause statement — most "bugs"
here are either stale-cache false alarms or persisted-state shape mismatches.

## 1. Triage against known failure classes (before touching code)

- "I shipped it but the change isn't showing" / works-in-fresh-browser-only →
  `docs/playbooks/stale-cache.md`. Verifying locally? Follow
  `docs/playbooks/browser-verification.md` — never trust a tab opened before the edit.
- iOS sign-out leaves a user signed in → `docs/playbooks/ios-signout.md` (known, documented).
- Recovery band blank → `docs/playbooks/recovery-band-blank.md`. Sync data diverged between
  devices → `docs/playbooks/sync-divergence.md`.
- If a playbook fully explains the report, say so and stop — no code change.

## 2. Locate and root-cause

- Navigate by the CLAUDE.md file map (module-per-file; `js/<x>.js` engine vs `js/<x>-ui.js`).
- Persisted data involved? Check the exact key/shape in `docs/reference/data-dictionary.md`
  — a classic Tempo bug class is reading a deleted/migrated key (e.g. the old
  `wellness_meds` blob; see docs/BACKLOG.md resolved tech debt). F-numbers / stage codes →
  `docs/reference/glossary.md`.
- State the root cause in one sentence before editing. If you can't, keep digging — do not
  "fix" symptoms.

## 3. Regression test first (engine-level bugs)

Add a failing test to `tests/<module>.test.js` reproducing the bug (API: `describe` / `it` /
`assert` / `assertEqual` / `assertClose` / `assertArrayEqual`). Confirm it fails for the
right reason, then fix. UI-only bugs (no engine seam) skip this — verification is step 5.

## 4. Fix minimally, per conventions

- Scope discipline: the fix only — no adjacent refactors or cleanup.
- Reuse, never re-implement: `escapeHtml` (js/dom-utils.js), `Utils.formatMs`,
  `Platform.haptic`/`Platform.notify` (never `navigator.vibrate` / `new Notification`).
- Writes to any of the 7 synced stores (`meds`, `history`, `rest_log`, `presets`,
  `bfrb_events`, `distractions`, `mood_events`) stamp via `js/schema.js`.
- Don't delete migration code paths — old devices still upgrade through them.

## 5. Verify

- `npm test` (flake rule: `.claude/commands/run-tests.md` step 2).
- UI-visible bug ⇒ reproduce-then-verify in the real app per
  `docs/playbooks/browser-verification.md` Recipe B (fresh port + `?nosw=1` + console clean
  + screenshot evidence).

## 6. Land

- Cached web file changed (`index.html`, `css/*`, `js/*`, `manifest.json`) ⇒ bump
  `CACHE_NAME` in `sw.js` in the same commit — the pre-commit hook blocks you otherwise.
- Branch `fix/<slug>`, commit `fix(<area>): <summary>`. Do NOT push or open a PR unless
  asked — that's `/ship-pr`.

## 7. Report

Root cause (the one sentence), the fix, and the evidence: test counts before/after, the
visible-browser verdict, screenshots for UI bugs. If anything is unverified, say so plainly.
