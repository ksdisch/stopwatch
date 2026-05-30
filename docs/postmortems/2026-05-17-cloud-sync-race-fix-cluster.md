# Postmortem: the cloud-sync race-fix cluster (2026-05-17)

**Date:** 2026-05-17
**Status:** Final
**Author(s):** ksdisch (with Claude Code)
**Severity:** Sev-3 — caught in deliberate two-tab validation, no daily-use exposure.
**Affected surface(s):** `js/sync-engine.js` steady-state listener arming + `pushSnapshot()` Stage-D guard + `_mergeHistory` collision logging; `js/sync-auth.js` `SyncAuth.signIn`; the `#cloud-sync-status` drawer row (`js/tempo-nav.js`); the five merge-driven UI surfaces (`presets-ui`, `history-ui`, `recovery-ui`, `exercise-ui`, `wellness-cooking-ui`).

> This is the worked example referenced by the [postmortem template](./TEMPLATE.md). It fills the same sections in order; read the two side by side as form-vs-instance.

## 1. Summary

Two days after the E-3 real-time-listener ship (PR #75, commit `5f6f039`, 2026-05-15), a deliberate two-tab "kapture" validation session ran the multi-device flows that single-device testing never exercises. It surfaced a *cluster* of five latent cloud-sync defects — none had reached daily use — ranging from listeners that silently never armed after a cold boot, through a Stage-D handoff that mis-fired on every push, to a sign-in path with no JS-side timeout. All five were diagnosed and fixed the same night across five commits (`a010abb`, `64623e3`, `40df03d`, `552ae76`, `f2eed1e`), each shipped under its own `CACHE_NAME` slug (`v83`→`v87`), and the original adversarial flow was re-run green. The value of this writeup is the RCA and the *detection story* — deliberate adversarial validation finding a cluster of races — not blast radius, which was zero.

## 2. Impact

**No real-world exposure. No data loss. No user-visible breakage in daily use.** This is a single-user portfolio app; the entire cluster was found and closed inside one deliberate validation session on the author's own two browser tabs against the shared Firestore project (`tempo-sync-6f7b2`, `CLAUDE.md:30`), the same day E-3's listeners had been live for. The honest framing: these were *burndown caveats* of the still-young E-3 listener path, surfaced on purpose, not an outage.

Had they shipped to daily multi-device use unfixed, the worst of them would have been Sev-2 (user-visible, not data-loss): a device stuck silently on the 5-minute defensive poll instead of real-time listeners (`a010abb`), a Push button that always painted "Cloud has existing data. Tap Reconcile now…" after the first sync (`f2eed1e`), cross-device arrivals not reflecting in a rendered panel without a close+reopen (`552ae76`), and a settings drawer that could wedge on "Signing in…" forever (`40df03d`). None of these destroy synced data — the per-store merge guards (append-only `doseLog`/naps/BFRB/distractions unions, F19a refuse-writeback) sit underneath all of them (see [ADR 0004](../adr/0004-per-store-merge-strategy.md)). The blast radius was "me, on my own devices, in a validation session," and the answer to "who was affected in production" is *no one, because the validation pass caught it first.*

## 3. Timeline

All times local (the repo history's zone). Commit timestamps are exact; the validation-session times are approximate, reconstructed from the commit bodies and the backfilled session-log entry (`c0ed7a2`, [`docs/SESSION-LOG.md`](../SESSION-LOG.md)).

| When (`YYYY-MM-DD HH:MM`) | Event | Evidence |
|---------------------------|-------|----------|
| 2026-05-15 | E-3 real-time `onSnapshot` listeners ship; polling demoted to a 5-min defensive fallback. This is the change that *introduced the listener-arming gate* the cluster orbits. | PR #75, commit `5f6f039`; `STEADY_STATE_DEFAULT_MS = 300000` (`js/sync-engine.js:99`) |
| 2026-05-17 ~02:30 | Detection. Two-tab kapture validation: clicked "Push to cloud" → reproduced the Stage-D handoff → Reconcile → reloaded both tabs → `#cloud-sync-status` stayed empty + hidden across ~3 min on both tabs, proving listeners never armed. | `a010abb` commit body |
| 2026-05-17 02:54 | Fix #1 shipped — cold-boot + post-Reconcile listener rearm. | PR #76, commit `a010abb`, `sw.js` → `v83-listener-cold-boot-rearm` |
| 2026-05-17 ~03:00 | Same session captured a 13-`console.warn` burst in ~1ms during one Reconcile pass, and confirmed `SyncAuth.signIn` had no JS-side timeout. | `64623e3` / `40df03d` commit bodies |
| 2026-05-17 03:10 | Fix #2 + #3 shipped together — reconcile collision-log coalesce, plus `SyncAuth.signIn` timeout race + self-heal. | PR #77, commits `64623e3` (`v84-reconcile-log-coalesce`) + `40df03d` (`v85-signin-timeout`) |
| 2026-05-17 ~03:15 | Confirmed cross-device data arrivals didn't repaint the rendered surface without a close+reopen. | `552ae76` commit body |
| 2026-05-17 03:20 | Fix #4 shipped — per-surface UI re-render on `merge-complete`. | PR #78, commit `552ae76`, `sw.js` → `v86-ui-rerender-on-merge` |
| 2026-05-17 03:25 | Fix #5 shipped — Push skips Stage D when cloud holds only this-device writes. | PR #79, commit `f2eed1e`, `sw.js` → `v87-push-skip-stage-d-self` |
| 2026-05-17 (after) | Verification. The original adversarial flow re-run: the same Push → Stage-D → Reconcile → reload now paints `Last sync: just now · Listeners: connected`. Engine suite green: 611/611 after the last fix. | `a010abb` / `f2eed1e` commit bodies |

## 4. Root cause(s)

There is no single root cause — this is the canonical shape the template describes (§4): a feature seam (E-3 listeners) plus a handful of independent latent conditions that the same multi-device exercise happened to expose at once. Grouped by mechanism:

**(1) Async auth rehydration left the steady-state gate unwatched** *(trigger: cold boot; latent cause: an ordering assumption).* E-3's listeners arm only when `_maybeAutoStartSteady` runs after the 4-condition gate (signed-in + flag-on + all-hydrated + no-Stage-D) is satisfied (`js/sync-engine.js:241`). `init()` probes `SyncAuth.getCurrentUser()` and fires `_maybeAutoStartSteady` only if it's non-null (`js/sync-engine.js:184-186`) — but Firebase Auth rehydrates asynchronously, so on a cold boot `currentUser` is null at init time. The user arrives later via `onAuthChange` → `_maybeAutoHydrate`, which, when it bailed early on `isAllHydrated()`, never reached the `.then(() => _maybeAutoStartSteady(user))` line (`js/sync-engine.js:222`) — so on a returning device with pre-existing hydrate markers, listeners silently never armed and the user sat on the 5-min poll. A second instance of the same gap: in-session Reconcile set the markers + cleared Stage D (gate now satisfied) but nothing re-fired `_maybeAutoStartSteady` at that moment. Fixed in `a010abb`: `_maybeAutoHydrate` now calls `_maybeAutoStartSteady(user)` on the all-hydrated bail (`js/sync-engine.js:216`), and `reconcileImportedBucket` re-fires it after the success emit (`js/sync-engine.js:1766`), idempotent via the existing `_steadyTimer != null` guard.

**(2) A marker lifecycle assumption broke the Stage-D trigger** *(trigger: any push after the first; latent cause: a marker that clears on success).* The F9 read-cloud-first guard in `pushSnapshot()` used "cloud non-empty + partial-upload marker (`tempo_sync_partial_upload_uid`) absent" as the Stage-D handoff trigger. But that marker clears on a *successful* push — so after the first successful push from any device, every subsequent Push fell into Stage-D handoff and painted "Cloud has existing data. Tap Reconcile now…" even when the only cloud data was this device's own prior pushes (`f2eed1e` commit body). The fix inspects cloud `deviceId` stamps instead: `_pullCloudSnapshot` now returns a `deviceIds` Set (`js/sync-engine.js:583`), collected by a recursive walker `_collectDeviceIds` (`js/sync-engine.js:546`) that reaches into nested arrays — necessary because some stores stamp `deviceId` on inner entries (`rest_log` day records stamp it on `naps[]`, not the top-level doc). Push skips Stage D when every stamp matches `History.getDeviceId()` (`js/sync-engine.js:718-723`) and only hands off on a genuinely foreign stamp.

**(3) Missing event subscriptions for cross-device arrivals** *(latent cause: an absent wire-up).* The engine emitted `merge-complete` after each per-store merge, but no UI surface listened, so a cross-device arrival merged into local state without the rendered panel repainting until a manual close+reopen. Fixed in `552ae76`: five UI modules now subscribe to `SyncEngine.on('merge-complete', …)`, filtered on `payload.store` and visibility-gated — `presets-ui.js:33`, `history-ui.js:132`, `recovery-ui.js:497` (hooks both `rest_log` and `history` because the dashboard derives "Last focus block" from `History.getSessions`), `exercise-ui.js:139`, and `wellness-cooking-ui.js:54`. Meds UI is intentionally *not* hooked — it has its own render loop that picks up dose-log changes on the next tick (`552ae76` commit body).

**(4) No JS-side timeout on an async native call** *(latent cause: an absent guard).* `SyncAuth.signIn` awaited `Platform.auth.signIn` with no timeout, so a wedged native promise could hang the drawer on "Signing in…" forever. Fixed in `40df03d`: `SyncAuth.signIn` now races against `SIGN_IN_TIMEOUT_MS = 60000` (`js/sync-auth.js:40`), rejecting with a structured `{ code: 'auth/timeout' }` (`js/sync-auth.js:123`); 60s comfortably covers an interactive OAuth flow. A companion self-heal in `js/tempo-nav.js:988-994` clears the stale "Sign-in error…" status row when `onAuthChange` later delivers a real user — covering the slow-network case where `Platform.auth.signIn` resolves *after* the timeout race already lost.

**(5) Log hygiene under burst** *(not a defect — an observability cost).* `_mergeHistory` emitted one `console.warn` per sessionId collision during a Stage-D Reconcile; the validation session captured 13 warnings in a ~1ms burst in a single pass, burying the rest of the reconcile-cycle output. Fixed in `64623e3`: one summary line at the end of the merge — `[SyncEngine] reconcile history: N sessionId collision(s) resolved cloud-wins; ids=[…]` (`js/sync-engine.js:1285-1287`) — with a 10-id preview cap + "+M more" suffix.

## 5. Detection

**Deliberate adversarial validation.** This is the part worth remembering: every item in the cluster was found by *purposely* driving the two-device flows on a single-user app — two browser tabs under kapture, signed into the same account, pushing and reconciling against shared Firestore — not by hitting them in daily use and not by luck. The detection trail is concrete: the cold-boot listener gap was caught by "Push → Stage-D handoff → Reconcile → reload both tabs → `#cloud-sync-status` stayed empty + hidden across ~3 min" (`a010abb`); the 13-warning burst was *captured live* during one Reconcile pass (`64623e3`); the always-fires Stage-D bug was "Push button always painted '…Tap Reconcile now…' after the first sync, no matter how many times the user clicked" (`f2eed1e`). None of these is reachable with one tab. Single-device testing is structurally blind to the multi-device race surface — which is the entire argument for the action items below.

## 6. Resolution

Resolved by a cluster of five commits, all 2026-05-17, each carrying its own `CACHE_NAME` slug (`sw.js:1`) so the per-fix release trail is unambiguous:

| Fix | Commit / PR | `CACHE_NAME` slug | Closed |
|-----|-------------|-------------------|--------|
| Cold-boot + post-Reconcile listener rearm | `a010abb` / PR #76 | `v83-listener-cold-boot-rearm` | listeners-never-arm gap |
| Reconcile collision-log coalesce | `64623e3` / PR #77 | `v84-reconcile-log-coalesce` | backlog #6 caveat (d) |
| `SyncAuth.signIn` timeout + self-heal | `40df03d` / PR #77 | `v85-signin-timeout` | deferred PR #74 follow-up |
| Per-surface UI re-render on `merge-complete` | `552ae76` / PR #78 | `v86-ui-rerender-on-merge` | backlog #6 caveat (c) |
| Push skips Stage D for this-device-only cloud | `f2eed1e` / PR #79 | `v87-push-skip-stage-d-self` | backlog #6 caveat (b) |

(PRs #77's two commits shipped under the same PR — `64623e3` then `40df03d` — bumping the slug twice, `v84`→`v85`.) Each PR bumped `CACHE_NAME` per the cache-bump rule; shipping any of these cached-file changes *without* a bump would itself be a latent stale-code incident (see the [deploy runbook](../runbooks/deploy-and-cache-bump.md)). The engine suite progressed 606→607→609→611/611 across the cluster; verification re-ran the original adversarial flow to green.

**Residual risk:** the fixes hardened the *web* listener + CAS path. On native iOS, sync still runs through the very 5-min defensive poll and per-record `setDoc` writeback these fixes shored up, because `runTransaction` and `subscribe` remain web-only — tracked, not closed (see §9 and [ADR 0009](../adr/0009-defer-native-cas-listener-parity.md)).

## 7. What went well

- **The merge layer was never at risk.** Every defect in this cluster was a *propagation/UX* race (when listeners arm, when Stage D fires, when a panel repaints) — none touched the per-store merge correctness that guards synced data. Append-only health data still unioned, F19a still refused downlevel writebacks. The [per-store merge isolation](../adr/0004-per-store-merge-strategy.md) meant the blast-radius ceiling was Sev-2, not Sev-1, no matter how the races shook out.
- **The fallback poll was a real safety net, not a dead branch.** Because E-3 demoted polling to a 5-min defensive fallback (`STEADY_STATE_DEFAULT_MS = 300000`, `js/sync-engine.js:99`) rather than deleting it, a device whose listeners silently failed to arm (`a010abb`) was *degraded, not broken* — it still synced, just slowly. That is the same degradation contract [ADR 0009](../adr/0009-defer-native-cas-listener-parity.md) leans on for native.
- **Idempotent, guarded fixes.** The listener rearm rode the existing `_steadyTimer != null` re-entry guard, so firing `_maybeAutoStartSteady` from new call sites couldn't double-arm (`js/sync-engine.js:241`). The `merge-complete` subscribers are visibility-gated and `typeof`-guarded so they're inert in test harnesses and on hidden surfaces (`js/presets-ui.js:33`).
- **The `CACHE_NAME`-slug-per-fix discipline.** Five fixes, five named slugs (`v83`→`v87`) — each slug *names its fix*, giving a clean, greppable per-fix release anchor that ties straight to the [deploy runbook](../runbooks/deploy-and-cache-bump.md) and the backfilled session log ([`docs/SESSION-LOG.md`](../SESSION-LOG.md)).

## 8. What went wrong / contributing factors

Blameless, systems-focused:

- **The listener-arming gate had no explicit "who re-checks me after this transition" owner.** Two separate seams (async auth rehydration, in-session Reconcile) each satisfied the 4-condition gate at a moment when nothing re-evaluated it. The gate was treated as a thing you *pass through once at init*, not a condition that can become true later — an ordering assumption that wasn't written down anywhere until `a010abb` added it (`js/sync-engine.js:197-216`).
- **A lifecycle marker was overloaded as both "upload in progress" and "this cloud is foreign."** `tempo_sync_partial_upload_uid` clearing on success quietly broke the Stage-D trigger that read its absence (`f2eed1e`). The real question — "did data I didn't write land in cloud?" — needed `deviceId` provenance, not a transient upload flag.
- **The harness cannot exercise the multi-device surface.** There is no Node test runner; engine tests run by opening `tests/index.html` in a browser (`CLAUDE.md` test-commands), and that's single-context. The races here only appear with two clients against shared Firestore — a surface the automated suite structurally can't reach, which is why this needed a manual two-tab pass to find at all.
- **Adjacent same-day process gap (different incident, same lesson).** The *same day* also saw the Flow-vibrate feature pushed straight to `main`, bypassing CI, and reverted: the original direct push (`431bc52`), the revert via PR #80 (`8ff636d`), and the proper re-land via PR #81 (`05d7a5f`). That is the canonical example of the **direct-push-bypasses-CI gap** — `pull_request`-triggered CI never fires for a push that skips the PR flow, yet Pages still deploys it. It is unrelated to the sync races (zero overlap in code), but it underscores the same root theme: this app's safety nets are *process*, and a path that skips the process skips the net. See the [deploy runbook's direct-push gap section](../runbooks/deploy-and-cache-bump.md).

## 9. Action items

| Item | Owner | Status / Date |
|------|-------|---------------|
| Rearm listeners on async-auth + post-Reconcile gate-satisfaction | ksdisch | `Done 2026-05-17` — `a010abb` |
| Coalesce reconcile collision warnings into one summary log | ksdisch | `Done 2026-05-17` — `64623e3` (closes backlog #6(d)) |
| Add JS-side `SyncAuth.signIn` timeout + stale-error self-heal | ksdisch | `Done 2026-05-17` — `40df03d` |
| Subscribe merge-driven UI surfaces to `merge-complete` | ksdisch | `Done 2026-05-17` — `552ae76` (closes backlog #6(c)) |
| Push skips Stage D when cloud holds only this-device writes | ksdisch | `Done 2026-05-17` — `f2eed1e` (closes backlog #6(b)) |
| Native CAS + listener parity for `@capacitor-firebase/firestore` (native still on the poll path these fixes hardened) | ksdisch | `Open — tracked by CLAUDE.md backlog #3 / `[ADR 0009](../adr/0009-defer-native-cas-listener-parity.md)`; needs Xcode + device` |
| Make the direct-push CI gap non-bypassable via `main` branch protection | ksdisch | `Open — process, tracked by `[deploy runbook](../runbooks/deploy-and-cache-bump.md)` direct-push section` |

## 10. Lessons learned

- **Deliberate two-tab adversarial validation finds latent multi-device races that single-device testing cannot.** This cluster of five was invisible to the entire automated engine suite (green the whole time — 605/605 → 611/611 across the cluster) because the suite is single-context. The races lived in *when* things fire across two clients against shared state. For any sync-touching change, a purposeful multi-device pass is not optional polish — it is the only detection mechanism that reaches the relevant surface. Luck is not a strategy; *scheduled adversarial validation* is.
- **Lifecycle gates need an explicit "who re-checks this after each transition" owner.** Two of the five bugs (`a010abb`, `f2eed1e`) were the same shape: a condition became true at a moment when nothing re-evaluated it. When a gate can be satisfied at more than one point in a lifecycle, every transition that can satisfy it must be wired to re-fire the check — and that re-check must be idempotent (the `_steadyTimer != null` guard is what made the multiple call sites safe).
- **Don't overload a transient flag as durable provenance.** `tempo_sync_partial_upload_uid` was an "upload in progress" marker; reading its *absence* to mean "this cloud is foreign" coupled two unrelated lifecycles. Provenance questions ("did someone else write this?") want provenance data (`deviceId` stamps), not the absence of an in-flight flag.
- **The `CACHE_NAME`-slug-per-fix discipline turns a fix cluster into a legible release trail.** Five fixes under five named slugs (`v83`→`v87`) gave each change a durable, greppable anchor that ties the postmortem, the [session log](../SESSION-LOG.md), and the [deploy runbook](../runbooks/deploy-and-cache-bump.md) together. The slug *names the fix* — that convention is what makes a same-night burndown reconstructable two weeks later.
- **An app whose safety nets are process must guard the paths that skip the process.** The adjacent flow-vibrate revert is the standing reminder: a direct push to `main` deploys with no CI gate. Branch protection, not workflow YAML, is the only fix — see the [deploy runbook](../runbooks/deploy-and-cache-bump.md).
