# Full-project hunt — everything that needs fixing or improving (2026-07-07)

**Scope:** whole repo · **Method:** max-effort inline sweep (multi-lens: hygiene,
tests/guards, cross-cutting invariants, post-audit diffs, docs accuracy, debt
consolidation) with an adversarial self-verify pass — every finding below was
confirmed against HEAD (`eb4ae4d`) by a fresh command this session, or is
explicitly tagged *doc-sourced*. Context: the 17-finder AUDIT-2026-06-13 was
fully remediated (all Highs/Mediums + fixable Lows shipped by 2026-06-23), so
this hunt targeted what's new, stalled, or deliberately deferred since.

> **Outcome (2026-07-07, same session):** Kyle greenlit Phases 0+1 — executed in full.
> **F8** → PR #184 (`16475f5`) · **F1** → PR #177 merged (`6883d76`, cache v149) ·
> **F2** → PR #174 merged (`7151eba`, v150; backlog row renumbered #20) · **F3** →
> PR #185 (`3348d58`, v151, suite PASS 1218) · **F4–F7** → PR #186 (docs refresh) ·
> **F9** → 17 stale remote branches deleted; 44 squash-merged local ones blocked by
> the Safety Net hook (manual `git branch -D` command handed to Kyle) · **F10** →
> open by design (Phase 3 product decision).

> **Outcome (2026-07-07, sessions 2–3):** Kyle greenlit Phases 2 and 3 — both executed
> in full. **Phase 2:** R10 → PR #187 (`3d76edd`, `_authSignOutGuard`; on-device verify
> still owed) · M5 → PR #188 (`72e8edb`, `js/button-fsm.js`, suite 1218→1232) · new
> find boot-TDZ → PR #189 (`f20f273`). **Phase 3 (spike queue, all closed):** F10 →
> PR #191 (import-side skip per Kyle's pick, v155) · `flow_bfrbs` cleanup → PR #192
> (Pick-C executed, v156) · council node pin → PR #193 · rules-env → repaired
> machine-locally (`npm run test:rules` green 14/14) · D3 → accepted · R9 → deferred
> to the Phase 4 harness · R8 → accepted-mitigated · D1 → deferred with design sketch.
> Register rows updated in place below. Suite on main: **PASS (1238)**; live Pages
> verified at `v156`. Phases 4–5 remain.

## TL;DR verdict

**The codebase itself is in genuinely good shape.** Suites green (engine
**PASS 1214/1214** headless — the known flake didn't even fire; council 94/94;
wiring guards 88=88=88; deploy current at `v148` live). No reuse-rule
violations, no unstamped synced-store writes, no new XSS surface, newest PRs
(#171–#183) clean on review. **What needs fixing is mostly rot at the edges:
two stalled CI-green PRs (one fixes a live mobile bug), one silently-dead
notification feature, stale docs/tracking, and repo hygiene** — plus a
known-open register of deliberately deferred debt that deserves a scheduled
burn-down rather than rediscovery every audit.

## Verified findings (ranked by severity × confidence)

| # | Finding | Sev | Evidence (verified at HEAD) | Suggested fix |
|---|---------|-----|------------------------------|----------------|
| F1 | **iOS focus-zoom bug is live on main** — focusing any sub-16px input (e.g. Todoist token field) zooms the WebView and it never zooms back; relaunch required. The fix exists in **draft PR #177** (CI-green) but it's `CONFLICTING` and 10 days stalled | **MED** | No `pointer: coarse` guard anywhere in css at HEAD; PR #177 diff adds it; conflict = `sw.js` CACHE_NAME (v144 vs v148) + styles.css drift | Rebase #177 on main (mechanical), re-verify, un-draft, merge |
| F2 | **PR #174 (NSDR launcher) stalled 11 days** — CI-green, `CONFLICTING`, feature Kyle requested | **MED** (process) | `gh pr view 174`: OPEN, all 6 checks SUCCESS, mergeable=CONFLICTING; touches CLAUDE.md/BACKLOG/index.html/mindful-ui/sw.js | Rebase (doc tables + CACHE_NAME), re-verify, merge on Kyle's go |
| F3 | **F15 meds-arrival toast never fires** — `sync-merge-meds.js:453` emits `meds-arrival` (emission is even tested), but no production consumer exists; `Toast.medsArrival` was deferred as the "B-4 freebie" and never landed. Six merge modules' comments defer to it as "the only F15 surface" | **LOW-MED** | Repo-wide grep: only comments + tests reference it; `sync-toast.js:285` TODO documents the intended one-line listener | Implement `Toast.medsArrival(medId, count)` + listener registration; mirror `bufferOverflow` |
| F4 | **Session logging broke down mid-June** — `docs/SESSION-LOG.md` (the convention CLAUDE.md documents) last entry 2026-06-18; newer sessions wrote dated files to `docs/session-logs/` instead; sessions of ~06-23 (C7/C5), ~06-25/26 (#173/#175/#176, NSDR) logged **nowhere** | LOW | `grep "^## 2026" SESSION-LOG.md` ends 06-18; `session-logs/` jumps 06-08 → 06-29 | Pick ONE convention, update CLAUDE.md pointer, backfill the 3-session gap from PR history |
| F5 | **Backlog is blind to all three in-flight efforts** — no rows for NSDR (#174), input-zoom (#177), or the Finances P5 build (spec merged #183, build pending) | LOW | grep of CLAUDE.md + BACKLOG.md: zero hits for nsdr / zoom / #174 / #177; table ends at row #19 | Add rows #20–#22 with status |
| F6 | **Backlog row 6 contradicts HEAD** — "Split-screen timer comparison — **Unshipped**", but `compare-ui.js` is functional (real split view + RAF loop) and wired (⇔ button per instance card, `cards-ui.js:48`) | LOW | Read of `compare-ui.js` + trigger grep | Correct row: "V1 shipped (cards ⇔); full vision open" (or enumerate what's missing) |
| F7 | **CLAUDE.md test-count drift** — "~1,070 it() across ~51 files as of 2026-06-12" vs actual **1214 across 54 files** | LOW | `npm test` PASS(1214); `ls tests/*.test.js` = 54 | Refresh numbers (doc already says PASS(n) is canonical) |
| F8 | **`firestore-debug.log` untracked and not gitignored** (emulator artifact) | LOW | `git status` + `.gitignore` read | Add to `.gitignore`, delete local file |
| F9 | **~12 stale local + ~5 stale remote branches** from squash-merged work (incl. `claude/blissful-darwin-cwbs0i`, verified content-merged as PR #173) | LOW | Branch list; `git cherry`/tree-diff on blissful-darwin; the `gh pr merge --delete-branch` worktree quirk explains local leftovers | Bulk-delete (keep the two open-PR heads) |
| F10 | **Meds hybrid-backup clobber path** — `_migrateLegacyBlob()` (`js/meds.js:594-599`) unconditionally `setItem`s blob meds over existing `meds/{id}` records; a backup carrying both a stale `wellness_meds` blob and fresher per-record keys regresses meds silently on next load. Known (session-log 06-18) but tracked nowhere | LOW | Code read at HEAD: no existence check before write | Product decision + guard (skip write when per-record key exists) or explicitly accept + document **→ Shipped 2026-07-07: PR #191, import-side skip (Kyle's pick) — `importAllData` drops the blob when `data.meds` is non-empty; legacy rollback preserved** |

## Known-open register (consolidated — deferred, accepted, or structural)

The deliberately-deferred set, now in one place with decoded IDs (the audit LOW
table uses per-category numbering):

| Item | Source | What it is |
|------|--------|------------|
| **R10 / iOS sign-out race** | audit LOW + CLAUDE.md debt `[K]` | Native `authStateChange` races the Keychain-cached user back after `signOut()`; fix belongs in `platform.js` native branch; playbook: `docs/playbooks/ios-signout.md`. **Highest user impact of the register** **→ Fix shipped 2026-07-07 (PR #187, `_authSignOutGuard`); on-device verify owed** |
| **M5(maint) / timer-handler duplication** | audit LOW + debt `[K]` | `onTimerLeft/Right` (verified at HEAD) duplicate ui.js handlers → unify into shared state machine **→ Shipped 2026-07-07 (PR #188, `js/button-fsm.js`)** |
| **D1 / record-level LWW field loss** | audit LOW spike | Concurrent note-vs-tag edits on the same history session across devices: one edit wins whole-record; per-field LWW is the documented deferral (`sync-merge-history.js` header) **→ Spiked 2026-07-07: DEFERRED with sketch — additive-nullable `fieldStamps` {note,tags} + field-wise pick in the merge; take alongside audit structural #1/#2 at the next sync touch** |
| **D3 / same-ms BFRB dedup collapse** | audit LOW spike | Migration/union dedup key `(deviceId, takenAt)` collapses two catches in the same millisecond **→ Spiked 2026-07-07: ACCEPTED — the only production log path is the serialized `global-bfrb` `commitPending()` singleton; the local store never dedups; worst case is −1 tally on OTHER devices via the sync doc-id layer** |
| **R9 / SW notification timeouts lost** | audit LOW spike | In-memory `pendingNotifications` Map dies with SW eviction **→ Spiked 2026-07-07: deferred to Phase 4. → SHIPPED 2026-07-08 (#197): `js/bg-notify-store.js` (durable `tempo_notify_db` + pure `plan()`) imported by `sw.js`; persist-on-schedule + `_rearm()` fires-overdue/re-arms on every SW wake + client `visibilitychange`→`BgNotify.rearm()` nudge. Tests: engine `tests/bg-notify-store.test.js` (12) + UI `tests/ui/notification-tap.spec.js` (3, `serviceWorkers:'allow'`, record-consumption signal). Cache v158. Web-only; native iOS schedules at the OS level and is unaffected.** |
| **R8 / SW `?v=N` revalidation** | audit LOW (unbatched) | Stale-while-revalidate + `ignoreSearch:true` can pin versioned assets until a CACHE_NAME bump — **mitigated**: the bump is hook+CI-enforced on every cached-file change. Fold into the R9 spike **→ Closed 2026-07-07: accepted-mitigated (enforced bump + stale-while-revalidate self-heal)** |
| `flow_bfrbs` legacy-key cleanup | in-code Pick-C deferrals (`flow-ui.js`, `bfrb-events.js`) | Migrated key preserved on disk; cleanup PR deferred **→ Shipped 2026-07-07 (PR #192): keys deleted at boot once the union verifiably landed; migration retained; marker-set cheap path sweeps residuals WITHOUT re-unioning** |
| `renderLaps` full innerHTML rebuild | CLAUDE.md debt | Perf-path covers only the RAF tick; low impact |
| `platform.js` + `sw.js` outside engine harness | #169 precedent | Race-prone async (wake-lock, notify bridge) ships on `node --check` + reasoning only |
| **No UI/integration tests** | CLAUDE.md debt + audit structural #3 | The XSS/import/notification bug class lives in the untested UI seam; "Tempo Proving Ground" is the named backlog candidate — **the single biggest quality lever available** |
| Council runs on Homebrew node v25 | CLAUDE.md debt | Pin node in `council/run-synthesis.sh` so removing Homebrew node can't break launchd **→ Shipped 2026-07-07 (PR #193): newest nvm bin resolved dynamically + prepended; Homebrew fallback kept** |
| Local `npm run test:rules` broken | memory (doc-sourced, not re-verified today) | npx firebase-tools@13 tree corrupted; workaround = brew `firebase` + openjdk@21. CI covers the suite (green 2026-06-27) **→ Repaired 2026-07-07: corrupted npx entry parked (`~/.npm/_npx/872b751b2f16d338.broken-2026-07-07`) + `brew link --force openjdk@21`; `npm run test:rules` green locally 14/14, verbatim** |
| Audit structural #1 & #2 | AUDIT-2026-06-13 | Uniform merge contract (`writeLocal` mandatory) + `SyncLifecycle` extraction from the 2,627-line `sync-engine.js` — take **only** when next touching sync |
| App Store paperwork | backlog #1 remainder | Dev account, privacy nutrition labels (meds + BFRB!), screenshots |
| Backlog #3 native CAS + listener parity | backlog | Last unshipped cloud-sync piece; unlocks true iOS live-sync |

## Phased remediation plan ("fix all of it")

- **Phase 0 — hygiene batch (≤1 hr).** F8 gitignore + delete log; F9 branch
  cleanup (keep `feat/nsdr-launch-log` + `claude/mobile-input-zoom-bug-9uzfx4`);
  one docs PR for F4 (pick convention + backfill 3 entries) + F5/F6/F7 table
  fixes. Ships as one hygiene PR + one docs PR.
- **Phase 1 — land the stalled work (½ day).** Rebase + merge **#177 first**
  (live bug), verify via app-verifier fresh-context recipe; rebase **#174**,
  merge on Kyle's product OK. Then **F3**: implement `Toast.medsArrival` +
  listener (+ test where harnessable). Each lands with its CACHE_NAME bump.
- **Phase 2 — highest-impact debt (1–2 sessions).** **R10 iOS sign-out** per
  playbook (needs device verify); **M5 timer-handler unification** with tests.
- **Phase 3 — spike queue (one small investigation each).** D1 per-field LWW ·
  D3 same-ms dedup · R9+R8 SW notification/versioning persistence · F10 meds
  hybrid-guard decision · `flow_bfrbs` cleanup · council node pin · local
  rules-env repair.
- **Phase 4 — structural quality (the big lever).** Build **Tempo Proving
  Ground** (UI/integration harness on the already-wired Playwright MCP; first
  dozen tests target the audit's exact seam: attribute-XSS render, malformed
  import survival, notification tap). Then audit structural #1/#2 as
  opportunistic refactors when sync is next touched — not before.
- **Phase 5 — product roadmap.** **Finances P5 build** (spec merged #183;
  fresh orchestrator session per plan) → backlog **#3 native CAS/listener
  parity** → App Store paperwork track (Kyle-gated) → **#4 Live Activities**.

## Coverage bounds (what this hunt did NOT do)

- No line-by-line re-read of `sync-engine.js` (2,627 lines), `ui.js`, or full
  CSS — relied on the June 17-finder audit + 15 verified remediation PRs +
  green suite + targeted greps/reads at HEAD.
- No live-browser/device verification this session (no new UI claims made that
  require it).
- Firestore-rules suite taken from CI evidence (green on #174/#177,
  2026-06-27), not a local run.
- No exhaustive data-dictionary ↔ localStorage-key diff.
- Single-agent inline hunt (no finder fan-out); the trade was breadth-by-agents
  for verification density — every listed finding was personally confirmed at
  HEAD this session.

## Test/guard evidence snapshot

`npm test` → **PASS (1214)** headless, 0 failures · `npm --prefix council test`
→ 94/94 · `check-asset-integrity` 88=88 OK · `check-load-order` 88=88 OK ·
`check-sw-bump` OK · live `sw.js` CACHE_NAME == local (`v148`).
