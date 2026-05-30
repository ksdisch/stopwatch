# 2026-05-28 — Tempo: Todoist Pomodoro V1 integration shipped (PR #100)

## 1. What we did

- Shipped backlog row #2 (Todoist integration) **V1 Pomodoro-only** as PR #100, squash-merged as `ec1faf0` on `main`.
- New engine `js/todoist.js` (686 LoC): REST v2 client, 200-op FIFO offline queue persisted to `todoist_pending_ops`, auto-drain on `Platform.network.onChange` + `visibilitychange`, `todoist:create-resolved` CustomEvent for late id-stamping. No `updateTask`, no `deleteTask` (V1 hard guards).
- New UI `js/todoist-ui.js` (506 LoC): settings drawer Todoist section + shared picker modal (multi-select, refresh-on-focus, error/empty states, `textContent`-based XSS safety).
- Edited `js/pomodoro-ui.js`: idempotent read-time shape migration `pomodoro_saved_tasks` `string[]` → `Array<{ text, todoistId? }>`; Import button on Saved Tasks panel; check/uncheck/create write-back; delete-guard preserved; late-stamp walker across three lists (focus checklist + break checklist + saved tasks).
- Engine tests `tests/todoist.test.js` (732 LoC, **35 cases**): token mgmt, no-token guards, testConnection, getProjects/getTasks, closeTask/reopenTask/createTask, error normalization, offline auto-enqueue, FIFO cap, queue persistence, drain branching, settings persistence. All pass.
- High-effort code review (7-angle, ~36 candidates → 10 verified findings) ran mid-PR; **all 10 fixes landed in commit `a99222b` before merge** rather than as follow-up PRs.
- CLAUDE.md backlog row #2 marked V1 shipped + two new follow-up rows added (Flow user-task list integration; Pomo inline-rename + `Todoist.updateTask`); 4 new device-local localStorage keys appended to State Model.
- `docs/audits/bl-2-todoist-AUDIT.md` (152 LoC) + `docs/briefs/bl-2-todoist-BRIEF.md` (255 LoC) shipped with the PR for traceability.
- `sw.js` `CACHE_NAME` bumped `v100-rhythm-per-day` → `v101-todoist-integration`; ASSETS array updated to precache the two new modules.

## 2. The why

- **Pomo-only V1 scope-trim (rejected: ship both Flow + Pomo together).** Phase-1 audit on the original brief found three brief-vs-code mismatches: Flow's "checklist" is a hardcoded 5-item ritual (`FLOW_CHECKLIST_ITEMS` at `flow-ui.js:33–39`), Pomodoro has no inline-rename UI, and `pomodoro_saved_tasks` was `string[]` not the assumed object shape. Pattern: **revise scope before code, not after.** Without the audit phase, engine-implementer would have shipped ~2700 LoC against a broken spec.

- **Idempotent read-time shape migration (rejected: one-shot eager rewrite).** `loadSavedTasks()` coerces `typeof item === 'string'` entries to `{ text: item }` at read time; saves persist the new shape. Object entries pass through unchanged. No `SCHEMA_VERSION` bump (non-synced store). Pattern: **lazy migration on read; eager would have required a one-shot code path that runs once + risks running twice on partial loads.**

- **Token kept device-local (rejected: sync via Firestore).** `todoist_api_token` is excluded from `SYNCED_STORES` AND `EXPORT_SETTINGS_KEYS`. User re-pastes on each device. Pattern: **sync user data, never credentials.** Cross-device task reconciliation works through Todoist itself as the source of truth — no architectural need to put creds in cloud storage where blast radius scales with user count.

- **Delete + update absent from public surface (rejected: flag-gated methods).** `Todoist.deleteTask` and `Todoist.updateTask` simply don't exist on `js/todoist.js`'s return object. A flag-gated method could be toggled on by a careless future commit; an absent method can't be called. Pattern: **hard guards via absence, verified by grep in the audit's sign-off checklist.**

- **`Platform.network.isOnline()` over `navigator.onLine` (caught in code review).** Tempo already has the shim for iOS WKWebView reliability — `sync-engine.js` uses it for the same reason. Feature-detect with fallback to `navigator.onLine` on web. Pattern: **when the project has a shim for a known-unreliable API, use it.**

- **CustomEvent `todoist:create-resolved` for late stamping (rejected: await the createTask Promise).** Queued ops can drain hours after the original call site is gone — the original Promise's consumer can't survive that long. The walker pattern on three lists keyed by `localTag` is correctly decoupled. Trade-off acknowledged: the codebase has a `SyncEngine.emit()` event-bus pattern that could have been reused for consistency.

- **10 review fixes pre-merge (rejected: follow-up PR).** Once authorized to review + merge, fixing on the same branch is cheaper than another full PR cycle (no doc roundtrip, no SESSION-LOG entry, no second cache bump). Pattern: **fix small findings inline when permission allows.**

- **Squash-merge (rejected: merge commit).** Keeps `main` history linear and matches every other recent PR (`#88`, `#92`, `#93`, `#97`, `#98`). The 3-commit split within the branch (engine / UI / docs) is still readable via `gh pr view 100`.

## 3. Concepts and vocabulary

- **Orchestrator pattern (Tempo-specific)** — A single coordinator dispatches specialist subagents (auditor → engine-implementer → engine-tester → ui-wirer → pr-shipper) through gated phases. Defined in `.claude/orchestrator.md`. Drove every commit on this PR.
- **Blast radius (PR-level)** — Audit-stamped severity tier (`low` / `medium` / `high`) that gates whether pr-shipper auto-pushes or pauses for explicit "ship it." Today: `high` triggered pause checkpoint #4.
- **Audit-before-code** — Hard rule that no engine work begins until an audit doc enumerates affected files, risks, test scope, and is reviewed. Caught the 4 false-assumption mismatches in this PR.
- **Idempotent read-time coercion (lazy migration)** — Pattern for evolving on-disk shape without a one-shot migration pass. Read maps old → new; write persists new. Used here for `string[]` → `Array<{ text, todoistId? }>`. Industry synonyms: "format versioning at the edges," "data-shape adapter pattern."
- **Late-stamp event correlation** — When an async op's resolution happens on a separate channel (here: offline-queue drain), tag the local entity with a correlation id at enqueue; the drain handler emits an event carrying that id; UI walks state to stamp matched entries. Used today via `localTag` + `todoist:create-resolved` CustomEvent.
- **Service-worker precache invariant** — `CACHE_NAME` bump alone is insufficient if the `ASSETS` list omits new files. Offline reload then fails silently because cached `index.html` references files no SW knows about; `typeof X !== 'undefined'` guards short-circuit the feature. Caught in today's code review at `sw.js`.
- **Hard guard (write-direction asymmetry)** — Forbidding a destructive method by absence rather than flag-gating, verified by grep in the sign-off checklist. Today: `Todoist.deleteTask` + `Todoist.updateTask` both absent from V1 surface so a misclick in Tempo cannot nuke real Todoist tasks.
- **Token device-locality** — API credentials live in localStorage only; never serialized into cross-device sync, exports, or backups. Today: `todoist_api_token` and the three other `todoist_*` keys excluded from both `SYNCED_STORES` and `EXPORT_SETTINGS_KEYS`.
- **Platform shim** — Project-local abstraction layer that wraps a known-unreliable browser/native API (e.g., `Platform.network.isOnline()` vs raw `navigator.onLine`). Mirrors `Platform.auth`, `Platform.haptic`, `Platform.notify` in the same file.
- **Squash-merge** — PR's N commits collapse to one new commit on main with a new SHA. Local `git branch -d` of the merged branch refuses (the original commits aren't in main's history); needs `-D` or gh's `--delete-branch` (which handles both local + remote).

## 4. Takeaways

- **The audit phase pays for itself by catching false brief assumptions.** Today: an unrun audit on the original brief would have produced ~2700 LoC of engine + UI code against three wrong assumptions (Flow checklist user-editable, Pomo inline-rename exists, saved tasks are objects). Rule of thumb: audit cost is a small fraction of the engine-build cost it gates, and the multiplier is highest when the brief author hasn't read every line of the touched files.

- **Hard guards beat flag guards for destructive write surfaces.** A flag can be toggled on by a careless future PR; an absent method can't be called from anywhere. When the blast-radius asymmetry is large (a misclick destroys real data outside your system), make the destructive method literally absent and verify via grep in the sign-off. Today: `Todoist.deleteTask` is not on the public surface; `Todoist.updateTask` is not on the public surface.

- **Sync user data, never credentials.** Personal API tokens belong device-local with grep-verifiable exclusion from sync sets and exports/backups. The user re-pastes on each device; the third-party service itself is the cross-device source of truth for whatever the token grants access to. Trade-off: minor setup friction; in exchange, credential blast radius is zero across the user base.

- **Cache-bump and precache list updates are not independent — they must move together.** A `CACHE_NAME` bump tells the SW to install a new cache; if the `ASSETS` list omits new scripts, offline users get a degraded app silently because their cached `index.html` references files that aren't in the cache and can't be fetched. Today's code review caught this exact bug in `sw.js`.

## 5. Suggested next moves

- **(Recommended) Manual end-to-end smoke against the live deploy.** Generate a Todoist personal API token at `todoist.com/app/settings/integrations/developer`, paste into Settings, run audit's smoke steps 1–12 on `ksdisch.github.io/stopwatch`. Effort: 10–20 min. Reasoning: the engine tests are pure unit-level; before relying on the feature for real work you want device-level confirmation that the network path works, the offline queue drains, the picker re-fetches on focus, and the device-local token round-trips correctly.

- **Diagnose `tests/recovery-feed.test.js` NPE failures.** 4 pre-existing tests fail with `Cannot read properties of null (reading 'day'/'rows')`. Predate this PR; surfaced as noise during today's test runs. Effort: ~30 min. Reasoning: a green test signal matters more than the actual bug (likely a missing localStorage seed or a mocked `null` not being narrowed before access); future PRs have to triage these every run otherwise.

- **Todoist follow-up A: Flow user-task list + Todoist integration.** Add a new user-task list section to Flow's setup view (new `flow_user_tasks` localStorage key) alongside the existing 5-item ritual checklist; reuse `TodoistUI.openPicker` unchanged — no engine changes needed. Effort: 2–3 hours. Reasoning: completes the original backlog #2 scope; the engine + picker are already battle-tested.

- **Todoist follow-up B: Pomo inline-rename + `Todoist.updateTask`.** Add click-to-edit on saved-task `.text` spans; on blur, persist locally + call `Todoist.updateTask(todoistId, { content })` (engine method also needs adding). Effort: ~1 hour, ~50 LoC. Reasoning: rounds out the write-back surface; smallest of the follow-ups.

## 6. 30-second elevator version

I shipped a two-way Todoist integration into Tempo — a personal stopwatch / Pomodoro PWA — so when you import tasks from Todoist into the Pomodoro saved-tasks panel, checking them off in Tempo closes them in Todoist, and creating new ones syncs the other way. I scoped it to Pomodoro-only V1 after the audit phase caught that Flow's so-called "checklist" is actually a fixed 5-item ritual rather than a user-editable list — that one scope-trim saved probably half a day of wasted engine work. The interesting bits are an offline queue with FIFO eviction, an idempotent read-time shape migration from `string[]` to `Array<{ text, todoistId? }>`, and a late-stamp event correlation pattern that handles the case where a `create` op resolves through the offline queue rather than the synchronous path. I ran a high-effort code review on the diff before merging and found ten real bugs — including a service-worker precache miss that would have broken the feature for every offline user — and fixed all ten in one commit before squash-merging. Shipped as PR #100.

## 7. Active recall

1. Walk me through the idempotent read-time shape migration in `pomodoro_saved_tasks`. Why not do a one-shot eager rewrite on first load post-deploy?
2. The offline queue caps at 200 ops with FIFO eviction. Why FIFO and not LIFO? What's the failure mode of each choice?
3. Why is the Todoist API token kept device-local instead of synced via the existing Firestore sync layer?
4. Walk me through the `todoist:create-resolved` CustomEvent flow. Why a window event and not just awaiting the `createTask` Promise?
5. The code review found that `sw.js`'s `ASSETS` list was missing the two new modules even though `CACHE_NAME` was bumped to `v101`. Why is that a silent failure rather than an immediate crash?

---

Try to answer each aloud before scrolling. Answer key below.

### Answer key

1. **`loadSavedTasks()` coerces at read time** with `raw.map(item => typeof item === 'string' ? { text: item } : item)`. Object entries pass through unchanged → idempotent. Saves go through `saveSavedTasks` which writes the object shape, so the persisted format upgrades naturally over time without ever scanning the whole store. **Eager rewrite would need a one-shot migration code path** that runs once + needs a guard so it doesn't run twice + has a risk of running on a partially-loaded store. Lazy migration: less code, naturally idempotent, no `SCHEMA_VERSION` bump because the new shape is structurally compatible (anyone reading `.text` works against both flavors after coercion).

2. **FIFO evicts the OLDEST op when at cap, so dropped ops are the user's old actions.** Trade: oldest ops have had time for the user to forget about them anyway. LIFO would drop the NEWEST op — the user's most recent intent — which is the worse failure mode because that's the action they're most likely to retry or notice. With Todoist's server-side idempotency (close/reopen are safe to retry), FIFO + drop-then-warn is the right answer. The 200-op cap maps to ~200 task interactions while offline (extreme but bounded); past that, dropping old ops is preferable to dropping new ones.

3. **Two reasons.** (1) Credentials in cloud sync = credentials in cloud storage = blast radius scales with the number of users in your Firestore bucket. If the bucket is breached, you've leaked everyone's third-party tokens, not just their task data. (2) There's no architectural need — Todoist itself is the cross-device source of truth for tasks. Each device pastes its own token (one-time, cheap); the actual task data flows through Todoist's API on every picker open + on every focus event. Cross-device task reconciliation works correctly without ever putting credentials in the sync set. Trade-off: the user has to paste the token on each new device; in exchange, credential blast radius is zero across the user base.

4. **The picker / saved-tasks panel calls `Todoist.createTask({ content, localTag })`.** Online path: `fetch` succeeds, returns `{ ok: true, data: { id } }`, the call site's `.then(...)` handler runs `_stampTodoistIdByLocalTag(localTag, id)` which walks three lists (focus checklist, break checklist, saved tasks) and stamps every matching entry. Offline path: the engine enqueues the op with `localTag` in payload + returns `{ ok: true, queued: true }` immediately. Later when `Platform.network.onChange` fires `connected: true` or `visibilitychange:visible` triggers, `drainQueue` processes the op FIFO. On 2xx, the engine dispatches `window.dispatchEvent(new CustomEvent('todoist:create-resolved', { detail: { localTag, todoistId } }))`. A window listener installed at pomodoro-ui module init walks the lists and stamps. **Why CustomEvent vs awaited Promise:** the queued path can outlive the original call site by hours or days — across page reloads even — so the original Promise consumer is gone. Decoupled event delivery is the right altitude. The codebase also has a `SyncEngine.emit()` event-bus pattern that could have been reused for consistency, which is a fair code-review point but not what we shipped.

5. **The service worker pre-caches the `ASSETS` array at install time.** Bumping `CACHE_NAME` invalidates the old cache + installs a new one keyed by the new name. If the new `ASSETS` array omits a new file, that file loads from the network on first visit (fine, online). User goes offline + reloads → SW serves cached `index.html` → cached HTML references `<script src='js/todoist.js'>` → SW intercepts the request, `caches.match` returns undefined, fallback `fetch(event.request)` fails because the user is offline. **The script tag silently fails to load** — browsers don't crash on a missing script, they just continue parsing. Then the `typeof Todoist !== 'undefined'` guards in `pomodoro-ui.js` and `tempo-nav.js` correctly short-circuit, so the feature degrades silently rather than throwing. The user sees no Todoist UI, no error, no haptic, and crucially the offline-queue auto-enqueue path is dead — *exactly when offline buffering should matter most.* The fix is a 2-line addition to the `ASSETS` array; the bug is a permanent reminder that cache-bump and precache-list updates must move together.
