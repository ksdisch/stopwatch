# Runbook: deploy the web build + bump the service-worker cache

- **Status:** Active runbook, written 2026-05-30
- **Scope:** Shipping a change to the web build (GitHub Pages). The iOS side is a separate target — see [`../runbooks/ios-cert-refresh.md`](../runbooks/ios-cert-refresh.md) and the `npx cap copy` step under [§ iOS: the same source, a second target](#ios-the-same-source-a-second-target).
- **Audience:** Anyone landing a code or asset change on `main`.

## When to run

Run this **every time you ship a change to a cached web file** — `index.html`,
`manifest.json`, `sw.js`, any `css/*.css`, or any `js/*.js`. That set is the
literal `CACHED_GLOBS` the bump-enforcement check diffs against
(`scripts/check-sw-bump.mjs:28-34`). If your change touches only docs, tests, or
CI config, the cache rule does not apply and you can skip § 3.

## Why this runbook exists (the mechanics it guards)

**The web build deploys with no build step.** GitHub Pages serves `main`'s root
directly; a `git push` to `main` auto-deploys in ~1 minute, with no compile,
bundle, or transform stage (`docs/ARCHITECTURE.md:461-466`; CLAUDE.md
"Deployment" — `git push` → deploys). The script load order in `index.html` *is*
the dependency graph — there is nothing to build.

**The PWA is cache-first, so a deploy is not a release until the cache rotates.**
The service worker pre-caches every entry in its hand-maintained `ASSETS` array
into the cache named by `CACHE_NAME` on `install`
(`sw.js:80-85`), and on `activate` it deletes every cache whose key is **not**
the current `CACHE_NAME` (`sw.js:87-96`, `keys.filter((key) => key !== CACHE_NAME)`).
The constant lives on the first line of the file
(`sw.js:1`, currently `const CACHE_NAME = 'stopwatch-v105-sw-schema-asset'`).
If you change a cached file but leave `CACHE_NAME` untouched, the SW already
installed on a user's device keeps serving the **old** cache — installed clients
see stale content until the old SW expires on its own. That footgun is the single
most common operational mistake in this repo and is called out as a hard rule in
both `docs/ARCHITECTURE.md:464-466` and CLAUDE.md ("Service worker cache bump
rule").

Two CI checks enforce the two halves of this discipline mechanically. Neither
deploys anything — CI is a **PR gate**, not a deploy pipeline
(`.github/workflows/ci.yml:1-6`).

### `sw-cache-bump` — a changed cached file MUST bump `CACHE_NAME`

`scripts/check-sw-bump.mjs` diffs the PR branch against its base ref. If any file
matching `CACHED_GLOBS` (`scripts/check-sw-bump.mjs:28-34`) changed, it requires
that the diff *also* contains an added line touching `CACHE_NAME` — the bump
detector is a regex over the `sw.js` diff: `/^\+.*\bCACHE_NAME\b/m`
(`scripts/check-sw-bump.mjs:82-90`). A missing bump exits 1 with a pointed
message naming `sw.js:1` as the fix site (`scripts/check-sw-bump.mjs:92-97`). It
no-ops (exit 0) when there's no usable git context — safe on a detached or
shallow checkout (`scripts/check-sw-bump.mjs:48-68`). Wired as the
`sw-cache-bump` job, which checks out with `fetch-depth: 0` so the PR base commit
is available for the diff (`.github/workflows/ci.yml:84-101`).

### `asset-integrity` — `sw.js` ASSETS must equal the `index.html` script set

The `ASSETS` array (`sw.js:2-78`) is hand-maintained — it has to be kept in lockstep
with the `<script src="js/*.js">` tags in `index.html` (the runtime spans
`index.html:1030-1119`, `utils.js` through `app.js`). The two lists can drift two
ways, both bad:

- **Loaded but not cached** — a `<script>` tag with no matching `ASSETS` entry
  breaks offline *silently*: online the file fetches fine, offline it 404s and
  the app is broken with no error at deploy time.
- **Cached but not loaded** — an `ASSETS` entry with no matching `<script>` tag
  is dead weight and a signal the list rotted.

`scripts/check-asset-integrity.mjs` parses both — the `<script>` set via
`scriptRe` with any `?query` suffix stripped (`scripts/check-asset-integrity.mjs:33`),
the `ASSETS` set via `assetRe` over the `./js/...` entries
(`scripts/check-asset-integrity.mjs:41`) — and fails on any symmetric difference,
printing exactly which files are on one side only
(`scripts/check-asset-integrity.mjs:54-78`). Wired as the `asset-integrity` job
(`.github/workflows/ci.yml:69-81`).

> **This exact gap is why the current cache slug exists.** `js/schema.js` was
> loaded by `index.html` but absent from `sw.js` ASSETS — a genuine pre-existing
> offline-cache hole (`scripts/check-asset-integrity.mjs:17-19`). Closing it — adding
> `./js/schema.js` to the `ASSETS` array (`sw.js:9`) — is what shipped as
> `CACHE_NAME = 'stopwatch-v105-sw-schema-asset'` (`sw.js:1`). The slug *names the fix*.

## The `CACHE_NAME` naming convention

Slugs follow `stopwatch-vNNN-<short-slug>`. The number is the de-facto release id
— the repo has **zero git tags** (`git tag` returns nothing), so the slug is the
only durable release anchor. **Numbers may skip**; the recent history goes
`…v91-ambient-colors → v94-meds-supply-optin → … → v97-meds-edit-delete-fix →
v100-rhythm-per-day → … → v104-pomo-revert → v105-sw-schema-asset` (from
`git log -p -- sw.js`). The slug, not the number, names the change — pick a short
hyphenated phrase that says what shipped.

## Procedure

1. **Branch.** Never work on `main`. Use a `feat/`, `fix/`, or `docs/` prefix per
   the Git workflow convention (CLAUDE.md "Git Workflow").

2. **Make the change.** Edit the code/asset.

3. **If a cached web file changed, bump `CACHE_NAME`.** Edit `sw.js:1` to a new
   `stopwatch-vNNN-<slug>` (increment the number — skips are fine — and name the
   slug after the change). This is what the `sw-cache-bump` job verifies.

4. **If you added a new `js/*` module, register it in BOTH lists.** Add the
   `<script src="js/<name>.js">` tag in `index.html` (in the correct load-order
   position) **and** the `'./js/<name>.js'` entry in the `sw.js` `ASSETS` array
   (`sw.js:2-78`). Adding to only one side fails `asset-integrity`. (And because
   you touched `sw.js`/`index.html`, step 3's bump is mandatory too.)

5. **Open a PR to `main`.** CI is `on: pull_request` to `main`
   (`.github/workflows/ci.yml:25-28`) — the gate only fires for PRs.

6. **Wait for CI to go green.** Five jobs run:
   - `engine-tests` — headless-browser engine suite via `scripts/run-tests.mjs`;
     the canonical test-count source of truth
     (`.github/workflows/ci.yml:34-66`, `:17-21`).
   - `asset-integrity` — `sw.js` ASSETS == `index.html` scripts
     (`.github/workflows/ci.yml:69-81`).
   - `sw-cache-bump` — changed cached file ⇒ `CACHE_NAME` bumped
     (`.github/workflows/ci.yml:84-101`).
   - `markdown-links` — lychee dead-link check over the curated public docs
     (`.github/workflows/ci.yml:106-121`).
   - `mermaid-lint` — every `docs/diagrams/*.mmd` parses
     (`.github/workflows/ci.yml:126-156`).

7. **Merge.** Pages redeploys from `main`'s root in ~1 minute
   (`docs/ARCHITECTURE.md:461-466`).

## Verification (after the merge deploys)

1. **Confirm the deployed cache key rotated.** Open
   <https://ksdisch.github.io/stopwatch/>, hard-reload, and confirm the live
   `sw.js` serves the new slug (DevTools → Application → Service Workers, or
   fetch `sw.js` and read `CACHE_NAME` at line 1). The SW's `activate` handler
   deletes the prior cache, so once the new key is active the stale content is
   gone (`sw.js:87-96`).
2. **If a client is stuck on stale content, that's the missed-bump failure
   mode.** Diagnosis and recovery live in the dedicated playbook —
   [`../playbooks/stale-cache.md`](../playbooks/stale-cache.md).
3. **`?nosw=1` is the SW escape hatch.** Appending `?nosw=1` to a URL makes the
   `fetch` handler bypass the cache (referrer-based), so the page gets fresh code
   on every reload. The test harness self-redirects to add it
   (`tests/index.html:9-17`), and `scripts/run-tests.mjs` navigates directly to
   `http://127.0.0.1:8765/tests/index.html?nosw=1` (`scripts/run-tests.mjs:40`)
   precisely so the SW never serves a stale build of the suite.

## ⚠️ The direct-push gap — read this

**CI is `on: pull_request` to `main` only** (`.github/workflows/ci.yml:25-28`),
plus a manual `workflow_dispatch` trigger. A **direct push to `main` bypasses the
gate entirely** — `pull_request` never fires for a push that skips the PR flow,
and Pages **still deploys that push**. None of the three correctness checks
(`engine-tests`, `asset-integrity`, `sw-cache-bump`) run.

This is not hypothetical: it is **exactly how the flow-vibrate revert incident
shipped broken**. A change went straight to `main`, deployed with no gate, and had
to be reverted via `revert/flow-vibrate-direct-push` (PR #80, commit `8ff636d`,
2026-05-17), then re-landed properly through PR #81 (`6990878`). The CI header
comment documents this incident as the motivating example for the gap
(`.github/workflows/ci.yml:8-15`).

**The mitigation is process + branch protection, NOT anything in the workflow
file.** There is no YAML change that can make a `pull_request`-triggered workflow
run on a push that never opened a PR. Always open a PR (step 5), and configure a
GitHub branch-protection rule on `main` requiring these checks to pass before
merge — that rule, not the workflow, is what makes the gate non-bypassable.

## iOS: the same source, a second target

The web deploy above does not touch the iOS app. iOS ships from the *same* source
via a separate path: `scripts/sync-www.mjs` mirrors the static files into `www/`,
`npx cap copy` bundles them, and Xcode builds `com.ksdisch.tempo`
(`docs/ARCHITECTURE.md:468-470`). The everyday command is `npm run ios:open`
(`npm run sync-www` then `cap copy ios && cap open ios`). The free personal
signing cert needs a 7-day refresh — that cadence and its playbook live in
`iOS-BUILD.md` and the dedicated runbook
[`../runbooks/ios-cert-refresh.md`](../runbooks/ios-cert-refresh.md).

## Related

- [`../playbooks/stale-cache.md`](../playbooks/stale-cache.md) — the failure mode
  when the `CACHE_NAME` bump is missed, and how to recover stuck clients.
- [`../runbooks/ios-cert-refresh.md`](../runbooks/ios-cert-refresh.md) — the iOS
  side of shipping (7-day cert refresh, `cap copy`).
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — § Deployment and operations
  (`docs/ARCHITECTURE.md:461-473`).
- [`../postmortems/2026-05-17-cloud-sync-race-fix-cluster.md`](../postmortems/2026-05-17-cloud-sync-race-fix-cluster.md)
  — each fix in that 2026-05-17 cluster bumped `CACHE_NAME`, a worked example of
  the slug-as-release-anchor pattern (`a010abb`, `40df03d`, `f2eed1e`).
- `iOS-BUILD.md` — the native copy step and full daily iOS workflow.
