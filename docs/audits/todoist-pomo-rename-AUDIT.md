# todoist-pomo-rename · Inline rename on Pomodoro saved tasks with Todoist write-back

## Goal
Add click-to-edit inline rename on Pomodoro saved-task rows; on commit, persist the new text locally and (for tasks carrying a `todoistId`) propagate the rename to Todoist via a new `Todoist.updateTask(id, { content })` engine method plus an idempotent `'update'` offline-queue op kind. Completes the V1 write-back surface (close/reopen/create) deferred from PR #100.

## Blast radius
**Tier:** medium

**Justification:** Two-layer touch — engine (`js/todoist.js`) + UI (`js/pomodoro-ui.js`) + css + tests + an `sw.js` cache bump — with no new persistence key, no new module/`<script>` tag, no migration, no sync-store / `js/schema.js` / `js/platform.js` / `ios/*` / `package.json` touch and no Firebase change; the cache bump and the 2-file-across-layers footprint land it squarely in the rubric's Medium band (the High triggers — multi-layer-with-new-module, persistence-key migration, sync invariants, native/schema/dep changes — are all absent).

## Affected files
| Path | Change type | Notes |
|------|-------------|-------|
| `js/todoist.js` | modify | **(a)** New public method `updateTask(id, opts)` — mirrors `closeTask` id-validation + `createTask`'s offline-enqueue-on-`_isOffline()`-or-`catch` pattern. POST `/tasks/{id}` body `{ content }`. Returns `{ok:true}` on 2xx / `{ok:true,queued:true}` on offline-enqueue / `_failFromResponse(res)` on non-2xx. Empty `content` or missing `id` → `{ok:false,...}` with no fetch. **(b)** Add an `'update'` branch in `_executeOp` (538-579) after the `'create'` branch — re-issues POST `/tasks/{id}` with `{content: op.payload.content}`; no special 2xx handling (the existing `if (res.ok) ... return 'remove'` path at 563-572 covers it — `'update'` does NOT emit `create-resolved`). **(c)** Op-kinds doc comment (lines 23-27, the `kind ∈ {'close','reopen','create'}` / "NOT `'update'` in V1" note) → `{'close','reopen','create','update'}`, drop the V1 carve-out. **(d)** Add `updateTask,` to the `return {…}` public surface (648-682), after `createTask,`. `deleteTask` STAYS absent. |
| `js/pomodoro-ui.js` | modify | Inline rename in `renderSavedTasks` (882-955). Make ONLY the saved-task text span (line 895) editable, scoped to `#pomo-saved-tasks-items` rows via a distinct hook (e.g. `data-saved-rename-idx="${i}"`) — NOT the shared `.pomo-checklist-item-text` class. Behavior per RATIFIED 5: click → `contentEditable='true'` + focus + select-all; Enter → `preventDefault()` + `blur()` (commit); Escape → restore original `textContent` + `blur()` (cancel); blur (commit) → read `textContent`, trim, strip newlines → empty-or-unchanged reverts (no write), else mutate `items[idx].text` + `saveSavedTasks` + (if `items[idx].todoistId` and no un-resolved `localTag`) `Todoist.updateTask(...).catch(()=>{})` (fire-and-forget) → `renderSavedTasks()`. Reuses `escapeChecklistHtml` (line 1568 alias of `escapeHtml`) on render. No new persistence key; `pomodoro_saved_tasks` shape (`{text, todoistId?}`) unchanged. |
| `tests/todoist.test.js` | modify (extend) | Add a `describe('Todoist — updateTask …')` block + an `'update'`-drain case in the existing `drainQueue` block, in the established `_setup`/`_teardown` + `_queueResponse` style. EXTENDS the 35-case suite — does NOT create a new file. No `tests/index.html` change (`js/todoist.js` + `todoist.test.js` already wired in). |
| `css/styles.css` | modify | Minimal editing affordance scoped to `.pomo-saved-task-item .pomo-checklist-item-text`: `cursor:text` hint + a focused/editing style on `[contenteditable="true"]` (outline or bg) using existing theme vars. No new layout, no new class beyond the contenteditable-state selector. |
| `sw.js` | cache bump | `CACHE_NAME` `'stopwatch-v102-flow-tasks'` → `'stopwatch-v103-pomo-rename'` (next free `vNNN`). All three changed web files (`js/todoist.js`, `js/pomodoro-ui.js`, `css/styles.css`) are ALREADY in `ASSETS` (lines 70/42/5) — version-string bump only, no `ASSETS` additions. pr-shipper owns this. |

**Affected file count: 5** (4 modify + 1 cache bump). No file added, no file deleted, no new module.

### Brief line-number verification (drift corrections)
- **`js/todoist.js`** — all anchors confirmed accurate: `createTask` 341-382, `_isOffline` 386-403, `_enqueueOp` 436-459, `drainQueue` 489-531, `_executeOp` 538-579, public `return{…}` 648-682, `updateTask`+`deleteTask` ABSENT (only doc-comment refs at 16/19). Minor: `_failFromResponse` is 165-176 (brief said ~175 — fine); the op-kinds doc comment spans **lines 23-27**, not 24-25 (the `kind ∈ {…}` literal is on 24-26).
- **`js/pomodoro-ui.js`** — `renderSavedTasks` 882-955 ✓, text span at line **895** ✓, `loadSavedTasks`/`saveSavedTasks` 854-865 ✓, `saveTaskForLater` 870-880, `_stampTodoistIdByLocalTag` 718-744 ✓, saved-tasks container id `#pomo-saved-tasks-items` (line 883) ✓.
- **CORRECTION — markup selector.** The brief's body text references an assumed `<span class="text" contenteditable>` markup; the REAL markup is `<span class="pomo-checklist-item-text">…</span>` (no `class="text"`, no pre-existing `contenteditable`). The implementer must target `.pomo-checklist-item-text` (scoped, per RATIFIED 1) — NOT a `.text` selector. (The brief's *anchor* references at lines 42/69/86/95-101 already cite the correct class; only the prose-assumed shorthand was loose.)
- **CORRECTION — drag-reorder guard.** The brief's risk/guard prose says saved-task rows have "drag-reorder." They do NOT: `pomo-drag-handle` exists on the focus-checklist (line 597) and actual-work (line 792) rows only; the saved-task row (894-898) has `+Focus`/`+Break`/delete buttons and no drag handle (`onDragStart` closest-match at 1445 never matches a saved-task row). The real sibling-conflict surface to verify is the three buttons, not drag.

## Cross-cutting invariants touched
- **Shared `.pomo-checklist-item-text` class — the load-bearing scoping invariant.** VERIFIED reused by **4 renderers**: `renderChecklist` (line 599, focus checklist), `renderActualWork` (line 794), `renderSavedTasks` (line 895, the only target), and the templates renderer (line 1035). Per RATIFIED 1 the editable behavior MUST be scoped to `#pomo-saved-tasks-items` rows (a saved-task-only attribute/selector) — making the bare class editable would leak click-to-edit into focus/break/actual-work/template lists. This is the single highest-leverage constraint in the PR.
- **`escapeChecklistHtml` / `escapeHtml`** — `escapeChecklistHtml` is a module-level alias for the global `escapeHtml` (js/pomodoro-ui.js:1568; `escapeHtml` defined at js/dom-utils.js:1). Render re-applies it, so on commit the implementer stores PLAIN `textContent` (trimmed, newlines stripped) — never `innerHTML` — and the next `renderSavedTasks()` re-escapes. Do NOT re-implement either.
- **`sw.js` CACHE_NAME** — mandatory bump: 3 cached web files change. Miss = stale assets, rename never ships.
- **Script-load-order dependency graph** — unchanged. No new `<script>` tag; `js/todoist.js` already loads before `js/pomodoro-ui.js`.
- **`SYNCED_STORES` (js/sync-engine.js:138-145)** — VERIFIED 6 entries (`meds`, `history`, `rest_log`, `presets`, `bfrb_events`, `distractions`); `pomodoro_saved_tasks` NOT a member. Renaming mutates `text` in place on a non-synced store — no sync surface touched, no `deviceId`/`updatedAt`/`schemaVersion` stamping, no `js/schema.js` change, no `SCHEMA_VERSION` bump.
- **Export/Backup allowlist (`js/export.js`)** — `pomodoro_saved_tasks` IS in `EXPORT_SETTINGS_KEYS` (line 81), but lines 120-138 already STRIP `todoistId`/`localTag` at export time, persisting only `text`. Since this PR only mutates `text` (already exported) and adds no key, `js/export.js` is NOT touched and the device-local Todoist-linkage guarantee is preserved unchanged. The `todoist_*` keys remain excluded.
- **`Platform.*` native bridge** — NOT touched. No `navigator.vibrate`/`new Notification`; rename is silent like the V1 writes. `js/platform.js` unchanged.
- **`package.json` / `ios/*` / Firebase** — none touched. `fetch`-only via the existing `_fetch` wrapper; works identically on web + iOS WKWebView.

## Risks
| Risk | Likelihood | Blast radius | Mitigation |
|------|------------|--------------|------------|
| **Class-wide `contenteditable` leak (the big one).** Naive "make the `.pomo-checklist-item-text` span editable" wires click-to-edit into all 4 renderers (focus/break checklist, actual-work, templates) — violates RATIFIED 1. | med | local-only (UI) | Scope strictly to `#pomo-saved-tasks-items` rows via a saved-task-only hook (e.g. `data-saved-rename-idx`); wire the editable behavior ONLY inside `renderSavedTasks`. Sign-off greps that no other renderer adds `contentEditable`/edit listeners and that the editable wiring is scoped under the saved-tasks container. |
| **Re-render-during-blur race.** The commit handler calls `renderSavedTasks()`, which rebuilds `innerHTML` and destroys the element mid-blur-event — re-entrant render or a use-after-free on the edited node. | med | local-only | Read `textContent` into a local var FIRST, then mutate + persist, then re-render last; set `contentEditable='false'` before re-render. Don't read from the (about-to-be-replaced) node after the render call. ui-wirer verifies in kapture (rename → text persists, no console error). |
| **Rich-paste / newline injection.** `contenteditable` accepts pasted HTML / multi-line text; reading `innerHTML` (or un-stripped `textContent`) stores markup or newlines into `pomodoro_saved_tasks`. | med | local-only | Read `textContent` (never `innerHTML`), `trim()`, strip newlines before persist (RATIFIED 5). Render re-escapes via `escapeChecklistHtml`. |
| **Editable span swallows sibling-button clicks.** The row also has `+Focus`/`+Break`/delete buttons (siblings, NOT children of the span). A focus-trap or click-capture on the editable span could intercept them. | low | local-only | Buttons are siblings of the span — `contenteditable` on the span shouldn't capture their clicks; ui-wirer confirms `+Focus`/`+Break`/delete still fire while a span is mid-edit. (No drag-reorder on saved rows — corrected above — so no drag conflict.) |
| **`'update'` drain not idempotent / mishandled on 2xx.** A buggy `_executeOp` branch adds bespoke 2xx handling or mis-removes the op. | low | local-only | The new branch only builds the request; the existing `if (res.ok){…} return 'remove'` path (563-572) already covers `'update'` (no `create-resolved` emit needed). Re-sending the same content is a Todoist no-op, so drain retries are safe. Test case 4 asserts a clean drain (queue empty after 2xx). |
| **Mid-create rename (RATIFIED 4 — ACCEPTED edge).** Item has `localTag` but no `todoistId` (its `createTask` is still in flight) → rename updates local text only; Todoist keeps create-time content. | low | local-only | Accepted by RATIFIED 4 — guard the `Todoist.updateTask` call behind `items[idx].todoistId && !items[idx].localTag`. No queued-update-by-localTag; documented as a sub-second race. |
| **Fire-and-forget write-back hides failure.** `Todoist.updateTask(...).catch(()=>{})` swallows errors; a bad token / 4xx rename silently no-ops. | low | local-only | Intentional, mirrors V1 close/reopen. Offline/network failures auto-enqueue as an `'update'` op and drain later; 4xx drains as a permanent failure (console.warn). No UI error path by design (RATIFIED 3/5). |
| **`sw.js` cache-bump miss.** Implementer/shipper forgets the bump → existing PWA installs serve stale JS, rename never appears. | med | web-bytes | pr-shipper checklist + this audit's sign-off both verify `CACHE_NAME` → `'stopwatch-v103-pomo-rename'`. Smoke step "rename persists across reload" surfaces a miss. |
| **Empty-revert mishandled.** Trimmed-empty commit deletes or blanks the task instead of reverting. | low | local-only | RATIFIED 3: empty (or unchanged) → restore original, no local change, no Todoist call. Tempo never stores an empty task. ui-wirer smoke step 4 verifies. |

**Risk count: 9 — 5 low / 4 med / 0 high.**

## Test scope
- **New tests required:** `tests/todoist.test.js` — **~4 new cases** in a new `describe('Todoist — updateTask …')` block (+ one `'update'`-drain case in the existing `drainQueue` block), mirroring the `createTask`/`closeTask` cases via `_setup`/`_teardown` + `_queueResponse`:
  1. **Online happy path** — `setToken` → queue 200 → `updateTask('XYZ', {content:'new'})` → asserts one fetch to `https://api.todoist.com/rest/v2/tasks/XYZ`, method `POST`, body `{"content":"new"}`, `Authorization: Bearer …` header; returns `{ok:true}`.
  2. **Invalid input** — missing/empty `id` → `{ok:false}` no fetch; empty `content` → `{ok:false}` no fetch.
  3. **Offline enqueue** — `_isOffline()` true → `{ok:true,queued:true}`, no fetch, a persisted op `{kind:'update', payload:{id,content}}` in `todoist_pending_ops`.
  4. **Drain executes the update op** — enqueue an `'update'` op, online, `_queueResponse(200,…)`, `drainQueue()` → fetches `POST /tasks/{id}`, queue empty after (2xx removes), no `create-resolved` emitted.
  5. *(optional)* **Error normalization** — 4xx → `{ok:false,isRetryable:false}` (and drains as permanent failure); 5xx/network → enqueue / leave-in-queue.
- **Existing tests at risk:** none directly. The 35-case Todoist suite is additive-only; the engine harness loads engine modules only (UI not under test). Note: the broader suite carries ~4 pre-existing `tests/recovery-feed.test.js` baseline failures (rhythm PR #98) UNRELATED to this PR — the tester must separate them from the green Todoist count.

## Manual setup steps (if any)
- **Optional, for full write-back smoke only:** a personal Todoist API token (free, from Todoist › Settings › Integrations › Developer), pasted into the Tempo settings drawer. Local-only rename (no token) needs no setup. iOS re-paste is device-local. Not required for the engine tests (mock fetch).

## Out of scope (explicitly NOT in this PR)
- **`Todoist.deleteTask`** — stays absent permanently (V1 hard guard; delete in Tempo never deletes in Todoist).
- **Rename anywhere but the saved-tasks panel** — focus/break checklists, actual-work, and templates (all sharing `.pomo-checklist-item-text`) are NOT made editable (RATIFIED 1).
- **Checklist-copy propagation** — renaming a saved task does NOT update any `+Focus`/`+Break` copy already in a checklist (RATIFIED 2); those keep their old text until re-added.
- **Queued-update-by-localTag for in-flight creates** — mid-create rename is local-only (RATIFIED 4).
- **New persistence key / `SCHEMA_VERSION` bump** — `pomodoro_saved_tasks` shape unchanged; rename mutates `text` in place.
- **`js/flow-ui.js`** — Flow user tasks (follow-up A, PR #102) could later reuse `updateTask` but are NOT touched here.
- **Sync of Pomo task lists via Firestore** — `SYNCED_STORES` untouched; Todoist is the cross-device source of truth.
- **New module, Firebase/sync/`js/schema.js`/`js/platform.js`/`ios/*`/`package.json` change, polling, OAuth.**

## Sign-off checklist (for the implementer)
- [ ] Engine module changes match the affected-files table (`updateTask` added to `js/todoist.js`; `'update'` branch in `_executeOp`; doc comment + public export updated).
- [ ] `Todoist.updateTask` IS exported on the public `return {…}` surface (after `createTask`); `Todoist.deleteTask` is STILL absent — `grep -n "deleteTask" js/todoist.js` returns only the doc-comment ref at line 19.
- [ ] `'update'` branch present in `_executeOp` and idempotent — drain re-send of the same content is safe; no bespoke 2xx handling (no `create-resolved` emit for `'update'`).
- [ ] **Inline-rename wiring is scoped to saved-task rows ONLY** — `grep -n "contentEditable\|contenteditable" js/pomodoro-ui.js` shows edit wiring only inside `renderSavedTasks` / scoped under `#pomo-saved-tasks-items`; the shared `.pomo-checklist-item-text` class is NOT made editable in `renderChecklist` (599) / `renderActualWork` (794) / templates (1035).
- [ ] Commit reads `textContent` (not `innerHTML`), trims + strips newlines; empty-or-unchanged reverts with no Todoist call; re-render runs last (no use-after-free on the edited node).
- [ ] `Todoist.updateTask` call is guarded by `items[idx].todoistId && !items[idx].localTag` and is fire-and-forget (`.catch(()=>{})`).
- [ ] `escapeChecklistHtml` reused on render; no re-implementation of `escapeHtml` (js/dom-utils.js) / `Utils.formatMs` (js/utils.js) / `Platform.*` (js/platform.js). No `navigator.vibrate` / `new Notification` on the rename path.
- [ ] No new persistence key; `pomodoro_saved_tasks` shape (`{text, todoistId?}`) unchanged; no `SCHEMA_VERSION` bump.
- [ ] `SYNCED_STORES` (js/sync-engine.js) and `EXPORT_SETTINGS_KEYS` (js/export.js) unchanged — no new key, no `todoist_*` key added to either.
- [ ] `js/schema.js`, `js/platform.js`, `ios/*`, `package.json` unchanged.
- [ ] Test scope above is covered (~4 new `updateTask` cases + drain case; existing Todoist suite still green — recovery-feed baseline failures separated out).
- [ ] `sw.js` `CACHE_NAME` bumped `'stopwatch-v102-flow-tasks'` → `'stopwatch-v103-pomo-rename'` (ASSETS list unchanged — all 3 web files already present).
