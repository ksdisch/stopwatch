# Playbook: stale cache — deployed change not showing on the live site / installed PWA

**Scenario:** A change is merged to `main`, GitHub Pages has deployed it (~1 min), and you've confirmed the new code at the deployed URL — but a browser tab or an installed PWA still renders the *prior* build. Users report they "don't see" the change.

This is almost always the cache-first service worker (`../../sw.js`) still serving the previous `CACHE_NAME` bundle. It is the single most common "but I shipped it" false alarm in this repo.

---

## Symptom

- New code is on `main` and Pages has deployed it, but a returning browser or installed PWA shows old behavior.
- Hard to reproduce on a *fresh* browser (no prior visit) — only returning clients with an already-installed SW are affected, which is the tell.
- A device that has never opened the app sees the new build immediately; a device that has the app installed lags.

---

## Likely cause

The PWA is cache-first. The fetch handler answers from cache and only falls through to the network on a miss: `caches.match(event.request, { ignoreSearch: true }).then((cached) => cached || fetch(event.request))` (`../../sw.js:113-120`). So a client serves whatever is under its currently-installed `CACHE_NAME` until that SW is replaced. Two distinct sub-causes:

**(a) `CACHE_NAME` was not bumped for a changed cached web file.**
A user only sees changed web files after the SW cache key rotates (`const CACHE_NAME = 'stopwatch-v105-sw-schema-asset'`, `../../sw.js:1`). If the deploy changed a cached file (`index.html`, `manifest.json`, `sw.js`, `css/*.css`, `js/*.js`) but kept the same `CACHE_NAME`, the new bytes are never installed under a new key, and every returning client keeps serving the old bundle indefinitely. The `sw-cache-bump` CI job (`scripts/check-sw-bump.mjs`) catches exactly this — but **only on PRs** (`on: pull_request`, `.github/workflows/ci.yml:26-27`). **A direct push to `main` bypasses the gate entirely** and still deploys (`.github/workflows/ci.yml:8-15`). That is precisely how the flow-vibrate change shipped broken straight to `main` before being reverted (commit `8ff636d`, 2026-05-17; PR #80 `revert/flow-vibrate-direct-push`).

**(b) Bump was correct; the client just hasn't revisited.**
Even with a clean bump, a returning client keeps its old SW until it next visits, re-fetches `sw.js`, installs the new SW, and activates it. Until then it serves stale — this is normal rotation lag, not a defect.

### How the SW rotates (why a bump + one revisit flips a client)

- **install** caches the full `ASSETS` list under the *new* key: `caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))` (`../../sw.js:80-85`), followed by `self.skipWaiting()`.
- **activate** deletes every cache whose key is not the current `CACHE_NAME`: `keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))` (`../../sw.js:87-96`), followed by `self.clients.claim()`.

So a `CACHE_NAME` change plus **one revisit** is the whole mechanism: the revisit re-fetches `sw.js`, install populates the new cache, activate evicts the old one, and the client is on the new bundle. No bump means no new key, which means activate never evicts anything and the client never moves.

---

## Triage

1. **Confirm `CACHE_NAME` actually changed in the deploy.** Compare the deployed `sw.js:1` against the prior build: `git log -p -- sw.js` (or view the raw `sw.js` on the deployed site and read line 1). If the string is unchanged across a deploy that touched a cached file, you have sub-cause (a) — a missed bump.

2. **Bypass the SW to isolate cache lag from a missed bump.** Load with `?nosw=1`. The test harness uses this convention: `tests/index.html` self-redirects to add the param so every script request inherits it via the `Referer` header and bypasses the cache (`tests/index.html:9-17`), and the SW honors it in the fetch handler by serving `fetch(event.request)` directly when the referrer carries `nosw` (`../../sw.js:102-112`). If the new content **appears** under `?nosw=1` but not on a normal load, the new bytes are deployed and reachable — the problem is purely cache-rotation lag (sub-cause b), not a missing bump.

3. **Force rotation on the affected client.** Hard-reload, or use DevTools → Application → Service Workers (Update / Unregister) and Application → Storage → "Clear site data". A normal reload may keep serving the old SW for one more cycle; clearing site data drops the installed SW and caches outright.

4. **Installed iOS PWA (WKWebView).** The SW updates on the *next* visit, not while suspended — force-quit the app (swipe up from the app switcher) and reopen to trigger the re-fetch → install → activate cycle. See `../runbooks/ios-cert-refresh.md` for iOS-specific build/install context.

---

## Fix

- **If the bump was missed (sub-cause a):** ship a follow-up PR that bumps the `CACHE_NAME` string in `../../sw.js:1` (any new unique value; the convention is `stopwatch-v<n>-<slug>`). The PR routes back through `sw-cache-bump` (`.github/workflows/ci.yml:84-101`) and `asset-integrity` (`.github/workflows/ci.yml:69-81`). On merge + deploy, installed clients pick up the new bundle on their next visit. No client-side action is required beyond the revisit.

- **If it was just lag (sub-cause b):** there is no code fix. The rotation completes on revisit (and force-quit/reopen on iOS). Confirm with the `?nosw=1` check above so you don't ship a no-op "fix."

---

## Prevention

- **Never push cached-web-file changes directly to `main`.** The `sw-cache-bump` gate runs on PRs only (`.github/workflows/ci.yml:26-27`); a direct push bypasses it and Pages deploys anyway (`.github/workflows/ci.yml:8-15`). The flow-vibrate revert (commit `8ff636d`) is the standing reminder of this gap.
- **Trust the CI gates on every PR.** `sw-cache-bump` (`scripts/check-sw-bump.mjs`) fails the build when a cached file changed but `CACHE_NAME` did not — its failure message points you straight at `sw.js:1` (`scripts/check-sw-bump.mjs:92-97`). `asset-integrity` (`scripts/check-asset-integrity.mjs`) reconciles the `ASSETS` list in `../../sw.js:2-77` against the `<script>` tags in `index.html`, so a new module can't ship un-cached.
- **Follow the deploy procedure.** The cache-bump rule and the full push-to-deploy flow live in `../runbooks/deploy-and-cache-bump.md`. Bumping `CACHE_NAME` in the same change as any cached-file edit is the entire discipline.

---

## See also

- `../runbooks/deploy-and-cache-bump.md` — the deploy procedure and the `CACHE_NAME` rule it enforces.
- `../runbooks/ios-cert-refresh.md` — iOS PWA / Capacitor install specifics.
- `../../sw.js` — the cache mechanics (`CACHE_NAME`, install, activate, fetch, `?nosw` bypass).
