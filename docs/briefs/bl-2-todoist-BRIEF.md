# Tempo — implement PR `bl-2-todoist`

You're working on Tempo, a vanilla-JS PWA + Capacitor iOS app. This is **backlog row #2** (the explicit highest-ROI unbuilt feature per `CLAUDE.md`): a two-way Todoist integration between Tempo's Pomodoro saved tasks and the user's Todoist account.

**Scope trim (post-audit, 2026-05-28):** The original backlog row also covered Flow's pre-block checklist. The auditor found that Flow's "checklist" is a **fixed 5-item ritual** (Phone-on-DND etc.), not a user-editable list — incompatible with importing tasks. Kyle resolved this by **deferring Flow integration to a follow-up PR** (which will add a new user-task list to Flow alongside the existing ritual checklist) and shipping **Pomodoro-only V1** here. The auditor also found that Pomodoro has no inline-rename UI, so **rename write-back is dropped from V1**; Todoist-side renames still propagate to Tempo on next refresh.

The full feature scope is specified in the CLAUDE.md backlog table row (added in PR #99 on 2026-05-27). This brief restates that scope in implementation shape, applies the post-audit V1 trim, and resolves the open decisions needed before code.

## Required reading (before any code)

1. **`CLAUDE.md`** — Feature Backlog table, row #2 ("Todoist integration"), end-to-end. That row is the authoritative scope (read it with the post-audit Pomo-only trim in mind).
2. **`docs/audits/bl-2-todoist-AUDIT.md`** — the canonical affected-files table, risks, test scope, and sign-off checklist for this PR. Implementer's primary scope document.
3. **`js/pomodoro-ui.js`** — saved-tasks panel rendering + `pomodoro_saved_tasks` persistence (auditor located: `items.push(text)` at line 768; checklist checkbox handler line 605–615; `+Focus` / `+Break` add-to-checklist handlers line 790–815; delete handler line 632–641; `pomo-checklist-input` enter handler line 654–665). **Important — auditor finding:** saved tasks are flat `string[]`, NOT objects. This PR migrates the shape to `Array<{ text, todoistId? }>` via read-time coercion. There is also no inline-rename UI; rename write-back is OUT of scope.
4. **`js/sync-engine.js`** — `SYNCED_STORES` constant (auditor verified at line 138–145: `meds`, `history`, `rest_log`, `presets`, `bfrb_events`, `distractions`). `pomodoro_saved_tasks` is NOT in this set; safe to evolve its on-disk shape without sync invariants.
5. **`js/export.js` + `js/backup.js`** — auditor verified: `EXPORT_SETTINGS_KEYS` at `js/export.js:74–113` is an opt-in allowlist; new `todoist_*` keys are excluded by default. F12 backup (`js/backup.js:30–138`) reuses `Export.buildBackupData()`, so the same protection applies. **The implementer MUST NOT add `todoist_api_token` (or any other `todoist_*` key) to `EXPORT_SETTINGS_KEYS`.**
6. **`js/tempo-nav.js`** — settings drawer structure. Existing pattern: `initCloudSyncSection(drawer)` at `tempo-nav.js:316`. Add an analogous `initTodoistSection(drawer)` wrapper that calls `TodoistUI.renderSettingsSection(drawer)`. The Todoist `<section>` markup is placed immediately below the Cloud Sync section in `index.html` (after the section's closing `</div>` at line 169).
7. **`index.html`** — settings drawer markup + script-load order block. New modules must be inserted into the dependency graph (per CLAUDE.md, script order IS the dependency graph). **Auditor-corrected insertion point:** `js/todoist.js` + `js/todoist-ui.js` go between `js/distractions.js` (line 1033) and `js/pomodoro-ui.js` (line 1034) — i.e., BEFORE both `pomodoro-ui.js` and `flow-ui.js`, so their UI code can synchronously call `Todoist.*` at load time.
8. **Todoist REST API v2 docs** — endpoints needed: `GET /tasks?filter=...`, `POST /tasks` (create), `POST /tasks/{id}/close`, `POST /tasks/{id}/reopen`, `GET /projects` (for the default-project picker). Base URL: `https://api.todoist.com/rest/v2`. Auth: `Authorization: Bearer <token>` header. Rate limit: 1000 requests / 15 min / token. **`POST /tasks/{id}` (rename) is NOT used in V1.**

## What this PR ships

A **Pomodoro-only V1** of the Todoist integration: settings-drawer token + project + filter config; a shared picker modal that pulls tasks matching the configured filter; multi-select import into Pomodoro's saved-tasks panel; check / uncheck / create propagation back to Todoist; offline write queue; refresh-on-modal-open + refresh-on-focus reconciliation policy. The shared engine (`js/todoist.js`) and picker UI (`js/todoist-ui.js`) are designed to be reused unchanged by the follow-up Flow PR.

**Out of V1 (explicit deferrals to follow-up PRs):**
- **Flow integration.** Adds a new user-task list to Flow alongside the existing 5-item ritual checklist, then wires the picker into it.
- **Rename write-back.** Requires adding an inline-rename UI to Pomodoro saved tasks first; this PR ships none of that. Todoist-side renames still flow into Tempo on next refresh (the picker re-pulls).

**Deletion is intentionally NOT propagated** (delete in Tempo unlinks locally; the real Todoist task is preserved — a misclick in Tempo must never nuke the user's actual task list).

### 1. `js/todoist.js` (new) — REST v2 client

A self-contained module (IIFE-style, exposing `window.Todoist`) wrapping the Todoist REST v2 API. No DOM. Pure data + network.

Required surface:

- **Token management**: `Todoist.getToken()` / `Todoist.setToken(token)` / `Todoist.clearToken()` reading/writing `todoist_api_token` in localStorage. `Todoist.hasToken()` boolean shortcut.
- **Connection test**: `Todoist.testConnection()` → calls `GET /projects` (cheap, tokens-only endpoint), returns `{ ok: true }` on 2xx, `{ ok: false, status, message }` on non-2xx or network error.
- **Config getters/setters**: `Todoist.getDefaultProjectId()` / `Todoist.setDefaultProjectId(id)` reading/writing `todoist_default_project_id`. Same shape for `Todoist.getDefaultFilter()` / `Todoist.setDefaultFilter(filter)` against `todoist_default_filter` (default `'today'`).
- **Read**: `Todoist.getTasks(filter)` → `GET /tasks?filter=<encoded>`; returns array of `{ id, content, project_id, is_completed, created_at }` (Todoist's shape, lightly trimmed).
- **Project list**: `Todoist.getProjects()` → `GET /projects` (for the default-project dropdown in settings).
- **Write surface (V1 = three methods only; `updateTask` deferred to the rename follow-up PR)**:
  - `Todoist.closeTask(id)` → `POST /tasks/{id}/close` (idempotent — safe to retry).
  - `Todoist.reopenTask(id)` → `POST /tasks/{id}/reopen` (idempotent).
  - `Todoist.createTask({ content, project_id? })` → `POST /tasks`; uses configured `default_project_id` if `project_id` omitted; returns the new Todoist `id` on success (callers stamp it onto the local task object).
  - **Do NOT ship `Todoist.updateTask` in this PR.** It's part of the deferred rename follow-up. (If you reflexively add it for "completeness", the sign-off checklist will catch it; delete before commit.)
- **Offline queue**:
  - In-memory + persisted to `todoist_pending_ops` localStorage as an array of `{ id, kind, payload, enqueuedAt }` where `kind ∈ {'close', 'reopen', 'create'}` (NOT `'update'` in V1).
  - Cap at 200 ops; when at cap, evict the oldest op (FIFO eviction) to make room for the new one. (Mirrors sync-buffer's 1000-op cap, scaled to lower expected write frequency.)
  - All write APIs auto-enqueue on `navigator.onLine === false` or on a network-error catch, then return `{ ok: true, queued: true }` so callers don't error-cascade.
  - `Todoist.drainQueue()` is called from the `online` event listener + the `visibilitychange:visible` listener; processes ops FIFO; idempotent retries via `close` / `reopen`; create ops have a tag for the local task id so callers can stamp the Todoist id back on after drain.
  - Drained ops are removed from the queue on 2xx; left in place on 5xx or network error (retry next opportunity); removed and logged on 4xx (permanent failure — bad token, deleted project, etc.).
- **Error normalization**: all client methods return one of two shapes — `{ ok: true, data?, queued? }` or `{ ok: false, status?, message, isRetryable }`. Callers branch on `ok`.
- **Refresh on focus**: module installs the `visibilitychange` listener and calls `drainQueue()` + emits a `Todoist.onTasksMaybeStale` event for the picker UI to re-fetch.

### 2. `js/todoist-ui.js` (new) — settings panel + picker modal

A second IIFE module (`window.TodoistUI`) for all DOM work. Two pieces:

**(a) Settings drawer section** — rendered into the settings drawer immediately below the "Cloud Sync" section (Cloud Sync is the primary multi-device concern; Todoist is peripheral):
- Section header: "Todoist".
- Input row: `<input type="password">` for API token (so it doesn't show in screenshots). Help text linking to `https://todoist.com/app/settings/integrations/developer` (the user gets their token there).
- "Test connection" button → calls `Todoist.testConnection()`; inline result text below (`✓ Connected` on success / `✗ <error message>` on failure). Do NOT add a separate `/user` call solely to display the account email — the success path is account-anonymous by design.
- Default project: `<select>` populated from `Todoist.getProjects()`; first option is "Inbox" (Todoist always has an Inbox project). Persists to `todoist_default_project_id`.
- Default filter: `<input type="text">` with placeholder "today"; persists to `todoist_default_filter`. (Free-form Todoist filter syntax — user can use anything like `today | overdue`, `@work`, `p1 & today`, etc.)
- Status row: "<N> queued offline writes" if `todoist_pending_ops.length > 0`; otherwise omitted.

**(b) Shared picker modal** — single modal element, rendered once, reused for both Flow + Pomo. Exposes `TodoistUI.openPicker({ onImport })` where `onImport(tasks)` is the caller's callback receiving the chosen tasks. The modal:
- Header: "Import from Todoist". Subheader: current filter, e.g., `Filter: today`.
- Body: list of `<label><input type="checkbox"> {content}</label>` rows.
- Empty state: "No tasks match <filter>".
- Error state: "Could not load tasks. Check your Todoist token in Settings."
- Footer: "Add to focus" button (primary), "Cancel" button.
- On open: calls `Todoist.getTasks(Todoist.getDefaultFilter())`; renders rows.
- On focus return (`visibilitychange:visible`): re-fetches.
- On confirm: calls `onImport(selectedTasks)`; closes.

### 3. `js/pomodoro-ui.js` (edit) — saved-tasks integration + shape migration

Two pieces: (a) migrate the persistence shape so each saved task can carry a `todoistId`, then (b) wire the import button + write-back.

**(a) Shape migration — `pomodoro_saved_tasks`: `string[]` → `Array<{ text, todoistId? }>`.**

Today (`pomodoro-ui.js:768`), saved tasks are stored as flat strings: `items.push(text)`. To attach a Todoist id, evolve the on-disk shape to objects. Use read-time coercion at the `loadSavedTasks()` (or equivalent) read site:

```js
function loadSavedTasks() {
  const raw = JSON.parse(localStorage.getItem('pomodoro_saved_tasks') || '[]');
  return raw.map(item => typeof item === 'string' ? { text: item } : item);
}
```

Writes always persist the object shape going forward. Old `string[]` data is coerced on first load post-deploy. The migration is **idempotent** (coercing already-object entries is a no-op). No `SCHEMA_VERSION` bump (non-synced store; auditor verified `pomodoro_saved_tasks` is NOT in `SYNCED_STORES`). Engine-test case 8 covers the coercion.

Update CLAUDE.md "State Model" line for `pomodoro_saved_tasks` from "array of strings" → "Array<{ text, todoistId? }>" — pr-shipper handles this in Phase 5.

**(b) Import button + write-back wiring.**

Add an "Import from Todoist" button to the Saved Tasks panel (`pomo-saved-tasks` at `index.html:515`). Button handler:

```js
TodoistUI.openPicker({
  onImport: (tasks) => {
    const items = loadSavedTasks();
    tasks.forEach(t => items.push({ text: t.content, todoistId: t.id }));
    persistSavedTasks(items);
    renderSavedTasks();
  }
});
```

Wire write-back on existing handlers (line numbers from auditor's read):

- **Check off** (mark task done; via `+Focus` / `+Break` add-to-checklist handlers at `pomodoro-ui.js:790–815` plus the corresponding checklist checkbox handler at `pomodoro-ui.js:605–615`) → `if (task.todoistId) { Todoist.closeTask(task.todoistId); }` (fire-and-forget; offline queue handles failures).
- **Uncheck** (toggle back; same checkbox handler) → `if (task.todoistId) { Todoist.reopenTask(task.todoistId); }`.
- **Delete** (delete handler at `pomodoro-ui.js:632–641`) → **NO** Todoist call. Just remove the array entry as before; the local `todoistId` is discarded with it. This is the hard guard.
- **Create new task in Tempo** (the `pomo-checklist-input` enter handler at `pomodoro-ui.js:654–665` — note: this is the **checklist input**, not a separate "saved-tasks add input"; auditor caught that the brief's original phrasing was wrong because Pomo has no dedicated saved-tasks input) → if token is configured, call `Todoist.createTask({ content: text })`; on success stamp the returned id onto the new local task; offline-queue if offline.
- **Rename is NOT wired in V1.** No inline-rename UI exists; adding one is a deferred follow-up. Todoist-side renames still flow into Tempo on next picker refresh.

### 4. Flow integration — **deferred to follow-up PR**

The auditor verified that Tempo's Flow pre-block checklist is a hardcoded 5-item ritual (`FLOW_CHECKLIST_ITEMS` at `flow-ui.js:33–39`: Phone-on-DND, Notifications-silenced, etc.) with `flow_checklist_state` storing a 5-boolean array — NOT a user-editable task list. Importing Todoist tasks into it makes no sense.

**This PR does NOT touch `js/flow-ui.js`.** A follow-up PR (working title: "Flow user-task list + Todoist integration") will (i) add a new user-task list section to Flow's setup view alongside the ritual checklist, (ii) persist to a new `flow_user_tasks` localStorage key, and (iii) reuse the same `TodoistUI.openPicker` from this PR's `js/todoist-ui.js`. No engine-side changes will be required in that follow-up.

### 5. `js/tempo-nav.js` (edit) — settings drawer wiring

Add a call to `TodoistUI.renderSettingsSection(<drawer-container>)` from the drawer-open path. Placement: immediately below the "Cloud Sync" section.

### 6. `index.html` (edit)

Two changes:

**(a) Settings drawer markup** — add an empty `<section id="settings-todoist"></section>` placeholder where `TodoistUI` will render the form. Placement matches the `tempo-nav.js` wiring above.

**(b) Script load order** — insert two new `<script>` tags. **Auditor-corrected insertion point** (the brief's original suggestion was wrong — it would have placed `todoist.js` AFTER `pomodoro-ui.js`, breaking the dependency chain):

Insert `js/todoist.js` then `js/todoist-ui.js` immediately AFTER `js/distractions.js` (currently `index.html:1033`) and BEFORE `js/pomodoro-ui.js` (currently `index.html:1034`). Both must also load before `js/tempo-nav.js` (currently `index.html:1075`) so `TodoistUI.renderSettingsSection` is defined when the drawer wires up.

Updated chain fragment:

```
... → distractions → todoist → todoist-ui → pomodoro-ui → flow-ui → ... → tempo-nav → app
```

### 7. `css/styles.css` (edit)

- Picker modal layout (header / body / footer; backdrop; max-height with overflow scroll on the task list).
- Settings section spacing matching the existing Cloud Sync block.
- "Import from Todoist" button styling matching existing secondary buttons.

**No visual marker on imported tasks.** Imported (Todoist-linked) tasks render visually identical to local-only tasks — no badge, no icon, no color shift. The integration should feel native; the user sees them as Tempo tasks that happen to be linked. (If a follow-up reveals a UX need to distinguish them, that's a separate PR.)

### 8. `sw.js` — CACHE_NAME bump

Mandatory per CLAUDE.md hard rule (multiple cached files change). **Current value** (auditor read at audit time): `'stopwatch-v100-rhythm-per-day'`. **Bump to**: `'stopwatch-v101-todoist-integration'`. If a `v101-` PR lands first, pr-shipper increments to `v102-todoist-integration` at ship time.

## Hard rules

- **Audit before code.** Audit doc at `docs/audits/bl-2-todoist-AUDIT.md` already exists and has been reviewed. Implementer reads it end-to-end before writing code.
- **Delete in Tempo does NOT delete in Todoist.** This is a one-way guard. The delete handler in Pomodoro saved-tasks must NOT call `Todoist.deleteTask` — there should not even be a `Todoist.deleteTask` method on the client. (If you add one for "completeness", remove it before commit.)
- **No `Todoist.updateTask` in V1.** Rename write-back is the deferred rename follow-up; the engine surface this PR ships does NOT include `updateTask`. (Add it in the follow-up alongside an inline-rename UI for Pomo saved tasks.)
- **No edits to `js/flow-ui.js` in this PR.** Flow integration is deferred to a follow-up that adds a user-task list to Flow.
- **Token is device-local.** Do NOT add `todoist_api_token` to any synced store; do NOT stamp it with `deviceId`/`updatedAt`/`schemaVersion`; do NOT include it in any export/backup JSON. Users re-paste on each device. (Verify by grepping `js/export.js` + `js/backup.js` for any localStorage-key allowlist and confirm the new keys are absent.)
- **No new persistence keys go into the Firestore sync set.** `tempo_sync_db` (offline buffer DB) and the four synced Firestore stores (`meds`, `history`, `rest_log`, `presets`) remain untouched. Confirm by reading `js/sync-engine.js`'s `SYNCED_STORES` constant and verifying no new entry is added.
- **Use the platform-agnostic `fetch`.** No `XMLHttpRequest`, no third-party HTTP client. CORS works against `api.todoist.com` from both web (browser) and iOS (`WKWebView` via Capacitor) — no native plugin needed.
- **Use shared helpers.** `escapeHtml` from `js/dom-utils.js` for any task content rendered as HTML (Todoist allows fancy characters in `content`; sanitize). Time formatting via `Utils.formatMs` if any duration is displayed (probably none in this PR).
- **No haptics or notifications routed through Todoist write paths.** Existing Tempo behavior on task completion (any haptic or chime) stays unchanged; the Todoist call is silently added after the existing behavior fires.
- **No `SCHEMA_VERSION` bump.** The additive `todoistId?` field is on non-synced stores; no schema migration is needed.
- **Rate limit: don't poll.** Per the backlog row, refresh policy is on-modal-open + on-tab-focus only. Do NOT add `setInterval` polling against Todoist.
- **No `package.json` change.** No new npm deps; this is a `fetch`-only client.
- **No iOS-specific code.** WKWebView handles `fetch` against `api.todoist.com` without any Capacitor plugin. `js/platform.js` is NOT touched.

## Engine-test plan

`tests/todoist.test.js` (new) — pure engine tests against a mocked `fetch`. Test scope (auditor's full list of ~17 cases is in `docs/audits/bl-2-todoist-AUDIT.md` § Test scope; abbreviated here):

1. **Token mgmt** — set/get/clear roundtrip; `hasToken()` booleans.
2. **API contract** — each V1 method (`testConnection`, `getProjects`, `getTasks`, `closeTask`, `reopenTask`, `createTask`) calls expected URL + method + Bearer header on mock fetch success. (NOTE: `updateTask` is OUT of V1; do NOT add a test case for it.)
3. **Error normalization (non-2xx)** — 4xx → `{ ok: false, isRetryable: false }`; 5xx → `{ ok: false, isRetryable: true }`.
4. **Error normalization (network)** — `fetch` throws → `{ ok: false, isRetryable: true }`.
5. **Idempotent retry** — two consecutive `closeTask(id)` calls each result in one fetch + `{ ok: true }`.
6. **Offline queue enqueue** — `closeTask(id)` with `navigator.onLine === false` enqueues + returns `{ ok: true, queued: true }` without calling fetch.
7. **Offline queue drain** — `drainQueue()` after going online dequeues + fetches; queue empty after.
8. **Pomodoro saved-tasks shape migration** — `loadSavedTasks()` coerces legacy `string[]` to `Array<{ text }>` on read. Object entries pass through unchanged.
9. **Queue cap 200 + FIFO eviction at cap.**
10. **Queue persistence** — queue survives module reset (re-read from localStorage).
11. **Drain failure branching** — 4xx removes + logs the op; 5xx leaves in queue; network throw leaves in queue.
12. **Create task stamps returned Todoist id.**
13. **`testConnection()` success (200) → `{ ok: true }`.**
14. **`testConnection()` failure (401) → `{ ok: false, status: 401 }`.**
15. **`getTasks(filter)` URL-encodes the filter string** (e.g., `today & @work`).
16. **Picker render `escapeHtml`** — XSS guard on Todoist `content` field.
17. **Settings persistence** — `setDefaultProjectId` / `setDefaultFilter` roundtrip through localStorage.

Target: ~17 test cases. Existing test total per session log = 642; new total ~659.

No UI tests (Tempo has no UI test harness). UI verification is manual smoke per the audit doc.

## Manual smoke

The canonical smoke checklist (post-trim) lives in `docs/audits/bl-2-todoist-AUDIT.md` § Manual setup steps. Condensed here for quick reference:

1. **Token setup.** Settings drawer → paste invalid token → "Test connection" → `✗ Unauthorized`. Paste real token (from `todoist.com/app/settings/integrations/developer`) → `✓ Connected`.
2. **Default project picker.** Project dropdown loads; Inbox is first.
3. **Default filter.** `today` default; editable; persists.
4. **Pomo picker.** `#/timers/pomodoro` → Saved Tasks panel → "Import from Todoist" → modal lists today's tasks → multi-select 2–3 → "Add to focus".
5. **Pomo write-back close.** Check off an imported task (via `+Focus` → checklist checkbox). Verify task closes in Todoist.
6. **Pomo write-back reopen.** Uncheck. Verify task reopens in Todoist.
7. **Pomo create.** Add a new task via `pomo-checklist-input` (the only free-form Pomo input). Expect it in Todoist's default project.
8. **Pomo delete.** Delete an imported task in Tempo. It remains in Todoist (hard guard).
9. **Refresh on focus.** With picker open in Tempo, complete a task in Todoist app, switch back to Tempo → task disappears from picker on next focus.
10. **Offline write.** Disconnect network → check off a task → no UI error → reconnect → queue drains (Todoist task closes).
11. **Token cleared.** Clear token in settings → picker errors gracefully ("Could not load tasks. Check your Todoist token in Settings.").
12. **No-regression sanity.** Pomodoro saved-tasks panel works without a token (local-only tasks unchanged). Flow pre-block ritual checklist is untouched.
13. **(iOS, optional this PR.)** Repeat basic Pomo write-back smoke (one create + one close) on iOS. Re-paste token because device-local.

**No rename smoke step** (rename write-back is deferred to follow-up).
**No Flow smoke step** (Flow integration is deferred to follow-up).

## Blast radius

**Tier (auditor-stamped): high.** Drivers: 2 new modules + 5 modified files (after Flow drop), 4 new persistence keys, `sw.js` cache bump, multi-layer surface (engine + UI + chrome + tests). Not driven by any sync-store / native / schema-version touch (all explicitly out of scope).

## Resolved decisions (recorded for audit reference)

Kyle resolved twelve decisions across two review cycles on 2026-05-28:

**Pre-audit brief review (8 decisions):**
1. **Visual treatment**: imported tasks are visually identical to local tasks. No badge, no icon, no color shift.
2. **Settings section placement**: immediately below "Cloud Sync" in the drawer.
3. **`testConnection()` identity**: success path is `✓ Connected` (account-anonymous). No separate `/user` call.
4. **Flow checklist rename**: superseded by post-audit decision #9 (Flow deferred entirely).
5. **Offline queue cap**: 200 ops, FIFO eviction at cap.
6. **First-pass scope**: superseded by post-audit decision #9 (Pomo-only V1).
7. **Picker filter input**: V1 uses the settings-default filter only. The modal does NOT expose a per-open filter override. (Follow-up if Kyle wants it.)
8. **`sw.js` next CACHE_NAME**: auditor reads current value at audit time and proposes the next → `'stopwatch-v101-todoist-integration'`.

**Post-audit review (4 decisions, after auditor surfaced brief-vs-code mismatches):**
9. **Flow integration**: deferred to a follow-up PR. The follow-up adds a new user-task list to Flow alongside the existing 5-item ritual checklist, then reuses this PR's `TodoistUI.openPicker`. This PR does NOT touch `js/flow-ui.js`.
10. **Pomo rename write-back**: dropped from V1. Adding it requires first adding an inline-rename UI to Pomodoro saved tasks (no rename UI exists today). Deferred to a follow-up. Engine-side: `Todoist.updateTask` is NOT shipped in V1.
11. **`pomodoro_saved_tasks` shape migration**: migrate in place via read-time coercion (`string[]` → `Array<{ text, todoistId? }>`). Idempotent. No `SCHEMA_VERSION` bump (non-synced store).
12. **Script-load order**: corrected to insert `js/todoist.js` + `js/todoist-ui.js` between `js/distractions.js` and `js/pomodoro-ui.js` (BEFORE both pomodoro-ui and flow-ui), not after `recovery-ui` as the brief originally suggested. (Audit doc carries the corrected ordering.)

## Deliverable

Branch `feat/bl-2-todoist`, PR against `main`. Commits (audit already exists on `main`):

1. `feat(todoist): REST v2 client + offline queue` — `js/todoist.js` + `tests/todoist.test.js` + `tests/index.html` script-tag insert for the engine.
2. `feat(todoist): settings panel + shared picker modal` — `js/todoist-ui.js` + CSS + drawer wiring in `tempo-nav.js` + `<section id="settings-todoist"></section>` markup in `index.html` + the two engine/UI `<script>` tags inserted between `distractions` and `pomodoro-ui`.
3. `feat(todoist): Pomodoro saved-tasks integration` — edits to `js/pomodoro-ui.js` (shape migration + import button + write-back wiring) + `sw.js` cache bump to `'stopwatch-v101-todoist-integration'`.
4. `docs(backlog): mark Todoist Pomo V1 shipped + add Flow follow-up row + add rename follow-up row` — CLAUDE.md backlog row update (mark Pomo V1 done; add follow-ups for Flow integration and Pomo inline-rename) + SESSION-LOG.md entry + State Model line update for `pomodoro_saved_tasks` shape. pr-shipper handles this.

PR title: `feat(todoist): Pomodoro saved-tasks two-way integration (backlog #2 V1; Flow + rename deferred)`.

**Commit split rationale:** 3 implementation commits (engine / UI+chrome / Pomo integration) + 1 doc commit. Per-layer review possible; Kyle confirmed three-commit split at brief-review time. `js/flow-ui.js` is NOT in any commit.
