---
description: Land the current work as a Tempo PR — pre-flight the Definition of Done, pre-run the three pre-commit guard checks, branch/commit with the house conventions, push and open the PR with CI expectations set, and stop before any merge (merging main always needs Kyle's explicit per-PR go-ahead). Optional argument: a one-line scope/title for the PR.
---

Ship the working tree as a PR. Optional scope/title: `$ARGUMENTS`

## 1. Pre-flight — Definition of Done (CLAUDE.md § Conventions)

Review `git status` + `git diff` and confirm each that applies:

- [ ] Engine behavior covered in `tests/<module>.test.js`; suite green (`/run-tests` rules).
- [ ] Cached web file changed ⇒ `CACHE_NAME` bumped in `sw.js` in this change.
- [ ] New `js/` module ⇒ all 4 wire-points (index.html `<script>` slot, CLAUDE.md file-map +
      load-order chain, `sw.js` ASSETS, `tests/` stub registered in `tests/index.html`).
- [ ] Persisted key/shape changed ⇒ `docs/reference/data-dictionary.md` updated. Synced-store
      writes stamp via `js/schema.js`.
- [ ] UI-visible change browser-verified (`docs/playbooks/browser-verification.md`).
- [ ] Shipping a backlog item ⇒ CLAUDE.md Feature Backlog row + `docs/BACKLOG.md` status
      updated; substantial session ⇒ `docs/SESSION-LOG.md` entry.

## 2. Pre-run the commit guards (the hook will block on these anyway)

```bash
npm run check:sw-bump && npm run check:assets && npm run check:load-order
```

Fix anything red in the same change. Green here ⇒ the pre-commit hook won't block.

## 3. Branch + commit

- Branch: `feat/<slug>` | `fix/<slug>` | `refactor/<slug>` | `docs/<slug>` (sync-pipeline
  PRs: `feat/sync-<pr-id>-<slug>`). Never commit to `main`.
- Commit style (match `git log`): `<type>(<scope>): <summary>` — e.g. `feat(lifeos): …`,
  `fix(rhythm): …`, `docs(backlog): …`.

## 4. Push + open the PR

```bash
git push -u origin <branch>
gh pr create --title "<type>(<scope>): <summary>" --body "<what/why + test evidence>"
```

PR body: what + why, test counts (`PASS (n)` line), browser-verification evidence for UI
changes. CI will run 6 jobs on the PR: `engine-tests`, `asset-integrity`, `sw-cache-bump`,
`markdown-links` (relative links in curated docs must resolve), `mermaid-lint`,
`firestore-rules`. CI only gates PRs — a direct push to `main` bypasses it and still
deploys, which is exactly why everything ships via PR.

## 5. Merge etiquette — STOP here by default

- **Never merge or push `main` without Kyle's explicit go-ahead for THIS PR.** Blanket
  prior approvals don't carry over.
- Doc-only changes (CLAUDE.md / docs/** only): the standing pattern is a tiny `docs/<slug>`
  branch + squash-merge PR — for routine backlog/docs curation that pattern includes the
  squash-merge; anything bigger, ask.
- When authorized to merge: `gh pr merge --squash --delete-branch`. Known quirk: local
  branch cleanup can fail when `main` is checked out in another worktree — the **remote**
  merge still succeeded; clean up with `git push origin --delete <branch>` and ignore the
  local error. Stacked PRs: retarget children onto `main` **before** merging/deleting their
  base branch (base deletion auto-closes child PRs).
- After a merge to `main`: GitHub Pages deploys in ~1 min; if "it's not showing", that's
  `docs/playbooks/stale-cache.md`, not a failed deploy.

## 6. Report

Branch, PR URL, CI status (link), and what remains gated on Kyle (merge / paperwork).
