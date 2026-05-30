# Tempo — implement PR `todoist-pomo-rename`

You're working on Tempo, a vanilla-JS PWA + Capacitor iOS app. This is **Todoist
integration follow-up B** (backlog table priority 10, "Added #10-B"): inline
click-to-edit rename on Pomodoro saved tasks, with the rename propagating to
Todoist via a new `Todoist.updateTask` engine method. It completes the V1
write-back surface (V1 shipped `closeTask`/`reopenTask`/`createTask` only — PR
#100, `ec1faf0`). Follow-up A (Flow user-task list) shipped as PR #102 (`ae693d3`).

**Why deferred from V1.** The V1 audit found Pomodoro had no inline-rename UI, so
rename write-back was dropped from V1; Todoist-side renames flow into Tempo on
next picker refresh, but Tempo→Todoist rename was left for this follow-up.

## Required reading (before any code)

1. **`CLAUDE.md`** — Feature Backlog table, priority-10 row ("follow-up B"); the
   `todoist_*` State Model keys; `pomodoro_saved_tasks` shape note
   (`Array<{ text, todoistId? }>` after the V1 migration); sw.js cache-bump rule.
2. **`docs/briefs/bl-2-todoist-BRIEF.md`** + **`docs/briefs/todoist-flow-tasks-BRIEF.md`** —
   the two prior Todoist briefs. This PR mirrors their patterns (offline-queue op
   kind, fire-and-forget write-back, device-local token untouched). Reference impls.
3. **`docs/audits/bl-2-todoist-AUDIT.md`** — V1 audit; parallel its hard-guard
   sign-off rigor.
4. **`js/todoist.js`** (read fully — you EDIT this). Key anchors:
   - Op-kinds doc comment: lines **24–25** (`kind ∈ {'close','reopen','create'}` —
     "NOT `'update'` in V1") — UPDATE to include `'update'`.
   - `createTask(opts)`: lines **341–382** — the closest analog for `updateTask`'s
     offline-enqueue-on-`_isOffline()`-or-catch pattern.
   - `_isOffline()` (386–403), `_enqueueOp` (436+), `_failFromResponse` (~175),
     `_fetch` / `_parseJson` helpers.
   - `drainQueue` (489–531) + **`_executeOp(op)` (538–579)** — the per-`kind`
     dispatch switch; add an `'update'` branch.
   - Public return surface: the `return { … }` block (~line 648) exposing
     `getToken … getTasks, closeTask, reopenTask, createTask, drainQueue, …` —
     add `updateTask` after `createTask`.
   - **VERIFIED: `Todoist.updateTask` and `Todoist.deleteTask` are ABSENT** (only
     referenced in comments at lines 16/19 as deferred). This PR adds `updateTask`;
     `deleteTask` STAYS absent (hard guard).
5. **`js/pomodoro-ui.js`** (read — you EDIT this). Key anchors:
   - `renderSavedTasks()`: lines **882–955** — the saved-tasks panel. The task text
     span is `<span class="pomo-checklist-item-text">${escapeChecklistHtml(item.text)}</span>`
     at **line 895** inside a `.pomo-saved-task-item` row.
   - `loadSavedTasks` / `saveSavedTasks`: 854–865.
   - `_stampTodoistIdByLocalTag`: 718–744 (the mid-create localTag edge — see
     DECISION 4).
   - `escapeChecklistHtml` — the existing escape helper this file uses for task text.
6. **`tests/todoist.test.js`** (read — you EXTEND this). Structure: `Todoist._resetForTests()`
   between cases (lines 111/119), a `mockFetch` factory capturing requests, one
   `describe(...)` block per method (`closeTask` 300, `reopenTask` 331, `createTask`
   348, offline-enqueue 451). Add a `describe('Todoist — updateTask …')` block in
   the same style.
7. **Todoist REST v2** — rename endpoint: `POST https://api.todoist.com/rest/v2/tasks/{id}`
   with JSON body `{ content }`, `Authorization: Bearer <token>`. Returns 200 with
   the updated task object. Idempotent (re-sending the same content is a no-op).

## What this PR ships

Inline rename on Pomodoro **saved tasks**: click the task text → it becomes
editable in place → commit (blur or Enter) persists locally AND, for tasks
carrying a `todoistId`, calls `Todoist.updateTask(id, { content })`; Escape
cancels. Plus the engine method + an `'update'` offline-queue op kind so renames
made offline drain later.

**Out of scope (explicit):**
- **No `Todoist.deleteTask`.** Stays absent (the V1 hard guard — delete in Tempo
  never deletes in Todoist).
- **Rename limited to the saved-tasks panel** (DECISION 1) — NOT the focus/break
  checklists, the actual-work list, or templates (all of which happen to share the
  `.pomo-checklist-item-text` class — see the scoping rule in §2).
- **No new persistence key** — `pomodoro_saved_tasks` shape is unchanged
  (`{ text, todoistId? }`); rename just mutates `text` in place.
- **No `SCHEMA_VERSION` bump** (non-synced store).
- **No `js/flow-ui.js` change** — Flow user tasks (follow-up A, PR #102) are not
  in scope here, even though they could later reuse `updateTask` (a future tiny
  follow-up if desired).
- **No new module, no Firebase/sync/native/iOS change.**

## DECISIONS — RATIFIED 2026-05-29 (Kyle)

All six settled before the audit. Decisions 1 + 3 confirmed via explicit pick;
2, 4, 5, 6 taken as recommended. CLOSED — the auditor / implementer / ui-wirer
treat them as binding, not open questions.

| # | Topic | Ratified resolution |
|---|-------|---------------------|
| 1 | Rename scope | **Saved-tasks panel ONLY** — not focus/break checklists, actual-work, or templates. Scope the editable behavior to `#pomo-saved-tasks-items` rows; do NOT make the shared `.pomo-checklist-item-text` class editable class-wide. |
| 2 | Checklist-copy propagation | No propagation — renaming a saved task updates that row + Todoist only, not any `+Focus`/`+Break` copy. |
| 3 | Empty-after-edit | **Revert to original** — trim on commit; empty → restore original, no local change, no Todoist call. |
| 4 | Mid-create rename | Un-stamped item (`localTag`, no `todoistId`) → local-only update; no `updateTask` (no id yet). |
| 5 | Commit/cancel | Blur + Enter commit (Enter `preventDefault`); Escape cancels (restore textContent). |
| 6 | `updateTask` return | `{ok:true}` on 2xx / `{ok:true,queued:true}` on offline-enqueue / `{ok:false,…}` via `_failFromResponse`. |

Original rationale for each is preserved below.

1. **Rename scope = saved-tasks panel ONLY.** _Recommend: yes._ The backlog row says
   "Pomodoro saved-task `.text` spans." The class `.pomo-checklist-item-text` is
   REUSED by `renderChecklist`/`renderActualWork`/`renderSavedTasks`/templates, so
   the implementer must scope the editable behavior to `.pomo-saved-task-item` rows
   only (e.g. a distinct attribute like `data-saved-rename-idx` on the saved-task
   span, or a selector scoped under `#pomo-saved-tasks-items`). NOT applied
   class-wide. (Alt: also make focus/break checklist items renamable — rejected,
   scope creep; those are transient session copies, the saved list is the durable one.)

2. **Rename does NOT propagate to checklist copies.** _Recommend: yes (no propagation)._
   If a saved task was already `+Focus`'d into the focus checklist (a separate
   `{ text, todoistId }` entry), renaming the saved-tasks row updates only that row
   + Todoist. The checklist copy keeps its old text until re-added. (Propagating
   across all lists sharing a `todoistId` is follow-up scope; the late-stamp walker
   `_stampTodoistIdByLocalTag` is id-stamping only, not text-sync.)

3. **Empty-after-edit reverts to the original.** _Recommend: yes._ On commit, `trim()`
   the text; if empty, restore the original text (no Todoist call, no local change).
   Tempo never allows an empty task. (Alt: delete the task on empty — rejected,
   surprising + collides with the delete hard guard.)

4. **Mid-create rename (localTag, no `todoistId` yet) updates local only.** _Recommend:
   yes._ If the user renames a saved task whose `createTask` is still in flight
   (has `localTag`, no `todoistId`), update local text only — do NOT fire `updateTask`
   (there's no id yet). The Todoist task keeps its create-time content. Rare edge;
   acceptable. (Alt: queue an update keyed by localTag to fire after the create
   resolves — rejected, disproportionate complexity for a sub-second race.)

5. **Commit/cancel triggers.** _Recommend:_ blur commits; Enter commits (+ `preventDefault`,
   no newline); Escape cancels (restore original textContent + blur). On commit,
   read `textContent`, trim, strip newlines, then persist + re-render (render
   re-applies `escapeChecklistHtml`, so stored text stays plain).

6. **`updateTask` return shape.** _Recommend:_ `{ ok: true }` on 2xx (the caller
   doesn't need the returned task), `{ ok: true, queued: true }` on offline/error
   enqueue, `{ ok: false, … }` via `_failFromResponse` on non-2xx — matching
   `closeTask`/`reopenTask`.

## Implementation

### 1. `js/todoist.js` (edit) — `updateTask` + `'update'` op kind (Phase 2, engine)

**(a) New method `updateTask(id, opts)`** — mirror `createTask` (341–382) + the
`closeTask` id-validation (287–303):

```js
// POST /tasks/{id}. Body: { content }. Renames a Todoist task. Idempotent
// (re-sending the same content is a no-op server-side), so offline retries
// are safe. Returns { ok:true } on 2xx, { ok:true, queued:true } on
// offline/network enqueue, or a normalized failure on non-2xx.
async function updateTask(id, opts) {
  opts = opts || {};
  const content = (typeof opts.content === 'string') ? opts.content : '';
  if (!id) return { ok: false, message: 'Invalid task id', isRetryable: false };
  if (!content) return { ok: false, message: 'Empty content', isRetryable: false };
  if (_isOffline()) {
    _enqueueOp({ kind: 'update', payload: { id, content } });
    return { ok: true, queued: true };
  }
  let res;
  try {
    res = await _fetch('/tasks/' + encodeURIComponent(id), {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  } catch (err) {
    _enqueueOp({ kind: 'update', payload: { id, content } });
    void err;
    return { ok: true, queued: true };
  }
  if (!res.ok) return _failFromResponse(res);
  return { ok: true };
}
```

**(b) `_executeOp` (538–579)** — add an `'update'` branch in the dispatch (after
the `'create'` branch):

```js
} else if (op.kind === 'update') {
  res = await _fetch('/tasks/' + encodeURIComponent(op.payload.id), {
    method: 'POST',
    body: JSON.stringify({ content: op.payload.content }),
  });
}
```

No special 2xx handling needed (unlike `'create'`, which emits `create-resolved`)
— `'update'` just removes the op on success; the existing `if (res.ok) return 'remove'`
path covers it.

**(c) Op-kinds doc comment (24–25)** — change `kind ∈ {'close','reopen','create'}`
(NOT `'update'` in V1) → `kind ∈ {'close','reopen','create','update'}` and drop the
"NOT in V1" note.

**(d) Public surface** — add `updateTask,` after `createTask,` in the `return { … }`
block (~648).

No DOM, no new persistence key, no schema stamping (Todoist client is not a synced store).

### 2. `js/pomodoro-ui.js` (edit) — inline rename on saved tasks (Phase 4, UI)

In `renderSavedTasks()` (882–955), make the saved-task text span editable **scoped
to saved-task rows only**. Per DECISION 1, add a distinct hook on the saved-tasks
span (e.g. `data-saved-rename-idx="${i}"`) so the click/edit wiring targets ONLY
`#pomo-saved-tasks-items` rows — never the shared `.pomo-checklist-item-text` in
the focus/break/actual-work/template renderers.

Behavior (DECISION 5):
- **Click** the saved-task text → `contentEditable = 'true'`, focus, select all.
- **Enter** → `preventDefault()` + `blur()` (commit).
- **Escape** → restore `textContent` to the original + `blur()` (cancel, no commit).
- **Blur (commit)** → read `textContent`, `trim()`, strip newlines. If empty or
  unchanged → revert to original, no Todoist call. Else: update `items[idx].text`,
  `saveSavedTasks`, and **if `items[idx].todoistId`** (and no un-resolved `localTag`,
  per DECISION 4) → `Todoist.updateTask(items[idx].todoistId, { content }).catch(()=>{})`
  (fire-and-forget; offline queue absorbs failures). Then `renderSavedTasks()`.
- Set `contentEditable = 'false'` after commit/cancel.

Reuse: `escapeChecklistHtml` on render (already there); `Todoist.hasToken()` is NOT
required for `updateTask` (unlike create — a rename only fires when a `todoistId`
already exists, which implies the task was linked). No `Platform.haptic` change
(keep existing behavior; rename is silent like the V1 writes).

**Guard:** the saved-task rows also have `+Focus`/`+Break`/delete buttons and
drag-reorder — confirm making the text span editable doesn't break those (the
buttons are sibling elements; `contenteditable` on the span shouldn't intercept
their clicks, but verify in kapture).

### 3. `css/styles.css` (edit)

- A subtle editing affordance on the saved-task span: `cursor: text` (or a hover
  hint), and a focused/editing style (e.g. outline or background) when
  `[contenteditable="true"]` on `.pomo-saved-task-item .pomo-checklist-item-text`.
- Keep it minimal; reuse existing theme vars. No new layout.

### 4. `sw.js` — CACHE_NAME bump

Mandatory (cached web files change: `js/todoist.js`, `js/pomodoro-ui.js`,
`css/styles.css`). Current value at ship time (read it) — bump to
`'stopwatch-v103-pomo-rename'` (or next free `vNNN-`). All three files are already
in `ASSETS` — version-string bump only, no ASSETS additions. pr-shipper owns this.

## Hard rules

- **Audit before code.** Audit at `docs/audits/todoist-pomo-rename-AUDIT.md`,
  reviewed before code.
- **`Todoist.deleteTask` stays absent.** Do NOT add it. Rename does not delete.
- **Rename scope = saved-tasks panel only.** Do NOT make the shared
  `.pomo-checklist-item-text` class editable globally — scope to
  `#pomo-saved-tasks-items` rows (DECISION 1).
- **Token device-local — untouched.** No `todoist_*` key changes; no export/sync
  allowlist changes.
- **Use shared helpers.** `escapeChecklistHtml` for rendered text; `_fetch`/
  `_enqueueOp`/`_failFromResponse` for the engine path. No re-implementation. No
  `navigator.vibrate` / `new Notification`.
- **`fetch`-only**, via the existing `_fetch` wrapper. No new deps.
- **No `SCHEMA_VERSION` bump, no new persistence key, no sync-store touch, no
  `js/platform.js`/`ios/*`/`package.json` change, no polling.**
- **Idempotent `'update'` op** — drain retries re-send the same content safely
  (matches the V1 close/reopen idempotency).

## Phase plan (full pipeline)

Unlike PR #102 (UI-heavy), this PR has a real engine slice:

- **Phase 2 (engine-implementer):** `js/todoist.js` — `updateTask` + `'update'`
  op-kind branch + doc comment + public export.
- **Phase 3 (engine-tester):** `tests/todoist.test.js` — 3–4 new cases (below).
  Run via `tests/index.html` in a browser; report pass/fail.
- **Phase 4 (ui-wirer):** `js/pomodoro-ui.js` inline-rename + `css/styles.css`.
  Visually verify at `#/timers/pomodoro` via kapture.
- **Phase 5 (pr-shipper):** sw.js bump + docs + branch + commit + gated push.

## Engine-test plan

`tests/todoist.test.js` — new `describe('Todoist — updateTask …')` block, mirroring
the `createTask`/`closeTask` cases:
1. **Online happy path** — `updateTask('XYZ', { content: 'new' })` → `POST /tasks/XYZ`
   with body `{ content: 'new' }` + Bearer header; returns `{ ok: true }`.
2. **Invalid input** — missing id → `{ ok:false }`; empty content → `{ ok:false }`;
   no fetch fired.
3. **Offline enqueue** — `_isOffline()` true → `{ ok:true, queued:true }`, no fetch,
   a persisted op with `kind: 'update'`, `payload: { id, content }`.
4. **Drain executes the update op** — enqueue an `'update'` op, go online, `drainQueue()`
   → fetches `POST /tasks/{id}`, queue empty after (2xx removes).
5. **(optional) Error normalization** — 4xx → `{ ok:false, isRetryable:false }` (also
   drains as permanent failure); 5xx / network throw → enqueue / leave-in-queue.
6. **Regression** — existing close/reopen/create cases still pass.

Target ~4 new cases. Note the existing suite has ~4 pre-existing `tests/recovery-feed.test.js`
baseline failures (rhythm PR #98) — NOT this PR's; the tester separates them.

## Manual smoke

1. **Rename local-only saved task** (no token). Saved Tasks panel → click a task's
   text → edit → Enter → text updates + persists across reload. No network.
2. **Rename Todoist-linked task** (token configured). Import a task → rename it →
   Enter → the task renames in Todoist.
3. **Escape cancels.** Click → type → Escape → original text restored, no Todoist call.
4. **Empty reverts.** Click → clear all text → blur → original restored.
5. **Offline rename.** Disconnect → rename a linked task → no UI error → reconnect →
   queue drains → Todoist task renamed.
6. **Scope guard.** Confirm focus-checklist / break-checklist / actual-work / template
   text is NOT editable (only saved-tasks rows are).
7. **No regression.** `+Focus`/`+Break`/delete/drag-reorder on saved-task rows still
   work; V1 create/close/reopen still work.

## Blast radius

**Proposed tier: medium.** Drivers: 2+ files across engine (`js/todoist.js`) + UI
(`js/pomodoro-ui.js`) + tests + css + sw bump; no new persistence key, no new module,
no migration, no sync-store / schema / native / dependency touch. Auditor confirms.

## Deliverable

Branch `feat/todoist-pomo-rename`, PR against `main`. Suggested commit split:
1. `feat(todoist): updateTask + 'update' offline-queue op` — `js/todoist.js` +
   `tests/todoist.test.js`.
2. `feat(pomodoro): inline rename on saved tasks with Todoist write-back` —
   `js/pomodoro-ui.js` + `css/styles.css` + `sw.js` bump.
3. `docs: ship Todoist follow-up B + audit/brief` — CLAUDE.md backlog tick-off +
   SESSION-LOG entry + audit/brief docs. pr-shipper handles.

PR title: `feat(todoist): inline rename on Pomodoro saved tasks (backlog follow-up B)`.
