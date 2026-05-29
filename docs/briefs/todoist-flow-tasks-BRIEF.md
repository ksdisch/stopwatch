# Tempo — implement PR `todoist-flow-tasks`

You're working on Tempo, a vanilla-JS PWA + Capacitor iOS app. This is **Todoist
integration follow-up A** (backlog row #8, "Todoist integration follow-up A —
Flow user-task list + Todoist integration") — the deferred Flow half of backlog
#2. Pomodoro V1 shipped as PR #100 (`ec1faf0`, 2026-05-28); this PR brings the
same two-way Todoist surface to the Flow Block.

**Why this was deferred from V1.** The original backlog #2 covered Flow's
pre-block checklist. The Pomo-V1 audit found Flow's "checklist" is a **fixed
5-item ritual** (`FLOW_CHECKLIST_ITEMS` at `js/flow-ui.js:33–39`: Phone-on-DND,
Notifications-silenced, Tabs-closed, Water-nearby, Clear-goal), backed by a
5-boolean array in `flow_checklist_state` — NOT a user-editable task list.
Importing tasks into it makes no sense. So Flow integration was deferred to a
follow-up that adds a **new, separate user-task list** to Flow alongside the
ritual checklist. That follow-up is this PR.

**The engine + picker already exist.** `js/todoist.js` (REST v2 client, offline
queue, `todoist:create-resolved` event) and `js/todoist-ui.js` (`openPicker` +
settings section) shipped in PR #100 and are reused **unchanged**. This PR is
**almost entirely UI-layer** — no new modules — with one ~3-line data-module
change to `js/export.js` (backup parity, see DECISION 8 below, added at the audit
pause 2026-05-29).

## Required reading (before any code)

1. **`CLAUDE.md`** — Feature Backlog table, row #8 (this PR's authoritative
   scope) + row #2 (the shipped Pomo V1 it builds on). Read the State Model
   localStorage-key list (the four `todoist_*` keys + `pomodoro_saved_tasks`
   shape note).
2. **`docs/briefs/bl-2-todoist-BRIEF.md`** — the V1 brief. This PR mirrors its
   patterns (read-time shape, late-stamp walker, delete-guard, device-local
   token). Treat it as the reference implementation.
3. **`docs/audits/bl-2-todoist-AUDIT.md`** — V1 audit; the affected-files table
   + hard-guard sign-off checklist this PR's audit should parallel.
4. **`js/flow-ui.js`** (entire file, 871 lines) — the only file this PR adds
   logic to. Key anchors:
   - `FLOW_CHECKLIST_ITEMS` + ritual checklist helpers: lines 33–91.
   - `initFlowUI()`: lines 93–282 (where the new list's listeners get wired).
   - `renderFlowChecklist()`: lines 588–611 (the pattern the new
     `renderFlowUserTasks()` mirrors — `escapeHtml`, `data-` index attrs,
     per-row change listeners).
   - `updateFlowUI()`: lines 405–586 (section visibility — `isIdle` shows
     `#flow-setup`, `isFocusActive` shows `#flow-running`; the new list renders
     in setup, its progress count renders in running).
   - `onFlowRight()` start path: lines 311–336 (block start — where the
     in-session task progress initializes).
   - `saveFlowSessionToHistory()`: lines 772–815 (where a `tasksCompleted` /
     `tasksPlanned` summary field would be stamped onto the history record).
   - `renderFlowSummary()`: lines 706–762 (the summary card — where a "Tasks"
     count row would render, mirroring the existing Distractions / BFRB rows).
   - Reset/clear paths: `onFlowLeft()` 284–309, `flow-skip-recovery` 230–252,
     `onFlowRight()` `done`/`recoveryOverflowing` branches 368–396 — these
     decide whether the user-task list survives a block reset (see DECISION 5).
5. **`js/pomodoro-ui.js`** — the reference reuse pattern (do NOT edit it):
   - `loadSavedTasks()` / `saveSavedTasks()` read-time coercion: lines 854–865.
   - `initChecklistInputFor()` create-task + `localTag` path: lines 667–705.
   - `_stampTodoistIdByLocalTag()` late-stamp walker: lines 718–744.
   - `todoist:create-resolved` window listener: lines 751–759.
   - `renderSavedTasks()` check/+Focus/delete handlers + **delete hard guard**:
     lines 882–955 (note line 947–953: delete NEVER calls Todoist).
   - `initSavedTasksPanel()` Import-button wiring + `openPicker` `onImport`
     dedupe-by-id/text: lines 957–1000+.
6. **`js/todoist.js`** (read-only, reused unchanged) — confirm the surface this
   PR calls: `hasToken()`, `getTasks(filter)`, `closeTask(id)`, `reopenTask(id)`,
   `createTask({ content, localTag })`, and the `todoist:create-resolved`
   CustomEvent contract. **`updateTask` and `deleteTask` do NOT exist** — V1
   hard guard; this PR does not add them.
7. **`js/todoist-ui.js`** (read-only, reused unchanged) — `openPicker({ onImport })`
   contract (lines 289–380+): `onImport(selectedTasks)` receives Todoist task
   objects `{ id, content, project_id, ... }`. Same callback Pomo uses.
8. **`index.html`** — Flow setup markup `#flow-setup` (lines 357–396), running
   view `#flow-running` (398–418), summary card `#flow-summary` (420–427). The
   Pomo Import button markup at line 527 (`class="tempo-todoist-secondary"`) is
   the styling to reuse. Script load order is unchanged (both Todoist modules
   already load before `flow-ui.js` at line 1055).

## What this PR ships

A user-editable **"Tasks for this block"** list in the Flow Block, with the same
two-way Todoist surface Pomo got in V1:

- A new task-list section in the Flow **setup** view (`#flow-setup`), below the
  pre-block ritual checklist: free-form add input + a list of checkable rows +
  an **"Import from Todoist"** button reusing `TodoistUI.openPicker` unchanged.
- The list rendered in the Flow **running** view as a live, checkable progress
  surface (check tasks off as you work; a "Tasks: N/M done" count updates live).
- **Two-way Todoist write-back** mirroring Pomo: check off a Todoist-linked task
  → `Todoist.closeTask`; uncheck → `Todoist.reopenTask`; add a new task with a
  token configured → `Todoist.createTask` + late-stamp the returned id.
- New localStorage key **`flow_user_tasks`**, shape
  `Array<{ text, todoistId?, done }>` (brand-new key — no legacy migration; but
  a defensive read-time coercion of any stray `string` entry keeps it robust).
  **Not** synced via Firestore (`SYNCED_STORES`), but **included** in local
  backup/export (`EXPORT_SETTINGS_KEYS`) with Todoist linkage stripped — exact
  parity with `pomodoro_saved_tasks` (DECISION 8).
- Flow history record gains `tasksCompleted` / `tasksPlanned` (DECISION 4) + a
  summary-card "Tasks" row.

**Out of scope (explicit):**
- **No engine logic changes / no new module.** `js/todoist.js` ships everything
  required. The only non-UI edit is a ~3-line additive change to `js/export.js`
  (add the key to the allowlist + broaden the existing strip call — DECISION 8).
- **No `Todoist.updateTask` / inline-rename.** That's follow-up B (backlog #9).
  Flow user-task text is add/delete only in this PR (edit = delete + re-add).
- **No `js/todoist-ui.js` changes.** `openPicker` is reused verbatim.
- **No `js/pomodoro-ui.js` changes.** Pomo V1 is untouched.
- **Deletion is NOT propagated** — delete in Flow unlinks locally; the real
  Todoist task is preserved (the V1 hard guard, carried forward).
- **No `js/user-task-list.js` extraction** (DECISION 7) unless Kyle opts in.
- **The fixed ritual checklist is unchanged.** The new list is additive and
  sits alongside it.

## DECISIONS — RATIFIED 2026-05-29 (Kyle)

All seven settled before the audit. Decisions 1, 2, 6, 7 taken as recommended;
decisions 3, 4, 5 confirmed via explicit pick. These are CLOSED — the auditor and
ui-wirer treat them as binding, not open questions.

| # | Topic | Ratified resolution |
|---|-------|---------------------|
| 1 | List placement | Below the ritual checklist (recommended). |
| 2 | Start gating | Tasks do NOT gate Start; only the ritual does (recommended). |
| 3 | In-session behavior | **Checkable in-block** — running view renders live checkboxes + "Tasks: N/M done"; ticking closes in Todoist. |
| 4 | History capture | **Yes** — `tasksPlanned` + `tasksCompleted` on the record + a "Tasks N/M" summary row (counts only). |
| 5 | Reset semantics | **Text survives, `done` resets** — list text persists across blocks; every item resets to unchecked on a fresh `Flow.start()`. |
| 6 | Write-back timing | Fire-and-forget on check, like Pomo (recommended). |
| 7 | Shared helper | No `js/user-task-list.js` extraction this PR (recommended). |
| 8 | Backup parity | **Include `flow_user_tasks` in `EXPORT_SETTINGS_KEYS`** with `_stripTodoistLinkage` reuse — matches Pomo. (Added at audit pause: the brief originally said "exclude," but the auditor verified `pomodoro_saved_tasks` IS exported; excluding Flow would silently drop its tasks on backup/restore. Kyle chose parity. Adds `js/export.js` to scope; tier stays medium.) |

Original rationale for decisions 1–7 is preserved below; decision 8's rationale
is the parenthetical above + §4 of Implementation.

1. **List placement in the setup view.** _Recommend: below the ritual checklist_
   as a distinct "Tasks for this block" section. The ritual is the gating
   prerequisite (checked → Start enables); tasks are optional planning, so they
   read naturally as the secondary block. (Alt: above the ritual — rejected, it
   buries the Start gate.)

2. **Do user-tasks gate the Start button?** _Recommend: NO._ Only the ritual
   checklist gates `canStartFlow()` (line 399–403). Tasks are optional; an empty
   or unchecked task list must never block starting a focus block. No change to
   `canStartFlow` / `updateFlowChecklistGate`.

3. **In-session interaction.** _Recommend: the list is checkable during the
   running block_, not just setup. Render it (or a compact version) in
   `#flow-running` with checkboxes; ticking one fires the Todoist close + updates
   the live "Tasks: N/M done" count. This is the point of a task list during
   focus. (Alt: read-only progress display — rejected, you'd have to leave the
   focus screen to check things off.)

4. **Persist task completion to the Flow history record?** _Recommend: YES._
   `saveFlowSessionToHistory()` adds `tasksPlanned` (count) + `tasksCompleted`
   (count of `done`), and `renderFlowSummary()` adds a "Tasks N/M" row mirroring
   the existing Distractions / BFRB rows. Small, high-value, matches the block's
   reflective summary. Counts only — not the task text (keeps the history record
   lean; text isn't needed for analytics).

5. **Does the task list survive a block reset?** _Recommend: list TEXT survives;
   `done` flags reset to false on a fresh `Flow.start()`._ Tasks are a planning
   artifact you reuse across blocks (like Pomo saved tasks, which never
   auto-clear). But completion is per-block, so a new block starts everything
   unchecked. Concretely: do NOT clear `flow_user_tasks` in the reset paths
   (`onFlowLeft`, `flow-skip-recovery`, `onFlowRight` done branches); DO reset
   each item's `done:false` in the `onFlowRight` idle→start path (line ~325).
   (Alt A: clear the whole list on reset — rejected, destroys planning. Alt B:
   carry `done` across blocks — rejected, stale checkmarks confuse the count.)

6. **Write-back timing for in-session check-off.** _Recommend: fire-and-forget
   immediately on check_, exactly like Pomo (`closeTask(id).catch(()=>{})`). The
   offline queue absorbs failures. Existing Flow haptics/sounds are unchanged;
   the Todoist call is added silently after.

7. **Extract a shared `js/user-task-list.js` helper?** _Recommend: NO for this
   PR._ Pomo's saved-tasks shape (`{ text, todoistId? }`, no `done`) differs from
   Flow's (`{ text, todoistId?, done }`), and the late-stamp walker is coupled to
   each surface's specific lists. Premature extraction couples two
   independently-evolving UIs. Keep `flow-ui.js` self-contained, mirror the
   patterns. Revisit if a third consumer appears.

## Implementation

### 1. `js/flow-ui.js` (edit) — the user-task list

All new logic lives here. Mirror the Pomo patterns; do not invent new ones.

**(a) Persistence helpers** (near the other Flow `load*/save*` helpers, ~line 64):

```js
const FLOW_USER_TASKS_KEY = 'flow_user_tasks';

// Shape: Array<{ text, todoistId?, done, localTag? }>. Brand-new key (no
// legacy migration needed), but coerce stray string entries defensively so a
// hand-edited localStorage value can't crash the render. Mirrors
// pomodoro-ui.js loadSavedTasks().
function loadFlowUserTasks() {
  try {
    const raw = JSON.parse(localStorage.getItem(FLOW_USER_TASKS_KEY)) || [];
    return raw.map(item =>
      typeof item === 'string' ? { text: item, done: false } : item
    );
  } catch (e) { return []; }
}
function saveFlowUserTasks(items) {
  localStorage.setItem(FLOW_USER_TASKS_KEY, JSON.stringify(items));
}
```

**(b) `renderFlowUserTasks()`** — mirrors `renderFlowChecklist()` (line 588):
- Renders into a new `#flow-user-tasks-items` container (setup) and, if
  DECISION 3 = in-session, the running-view mirror `#flow-running-tasks-items`.
- Each row: a checkbox (`data-flow-task="${i}"`, `checked` from `item.done`),
  `escapeHtml(item.text)` via the shared helper, and a delete `×` button
  (`data-flow-task-del="${i}"`). **NO visual marker on Todoist-linked tasks**
  (carry V1 decision #1 — imported and local tasks look identical).
- Checkbox `change` handler:
  - toggle `item.done`, persist, re-render, update the running count;
  - **write-back**: `if (item.todoistId && typeof Todoist !== 'undefined')`
    → `item.done ? Todoist.closeTask(id) : Todoist.reopenTask(id)` (both
    `.catch(()=>{})`); offline queue handles failures.
- Delete `×` handler: **hard guard** — splice the entry, persist, re-render.
  **NO `Todoist.*` call.** (Mirror `pomodoro-ui.js:947–953` verbatim in intent.)

**(c) Add-task input** — mirrors `initChecklistInputFor()` (line 667), the
focus-checklist branch that creates Todoist tasks:
- New `#flow-user-task-input` in the setup view; Enter commits.
- Build `newItem = { text, done: false }`. If `Todoist.hasToken()`, mint a
  `localTag` (`'flow-' + crypto.randomUUID()` with the same fallback as
  `pomodoro-ui.js:688–690`), set `newItem.localTag`, call
  `Todoist.createTask({ content: text, localTag })`, and on success
  `_stampFlowTaskTodoistId(localTag, id)`.

**(d) `_stampFlowTaskTodoistId(localTag, todoistId)`** — a Flow-local late-stamp
walker mirroring `_stampTodoistIdByLocalTag` (line 718), but walking only
`flow_user_tasks`. Idempotent: only stamps entries whose `localTag` matches and
that lack a `todoistId`; deletes the `localTag` after stamping; re-renders.

**(e) `todoist:create-resolved` listener** — at module load (mirror
`pomodoro-ui.js:751–759`), add a window listener that calls
`_stampFlowTaskTodoistId` so offline-queued creates stamp the Flow list when
they finally drain. **Guard against double-handling:** Pomo already has a
listener; both fire on every event but each only stamps its own lists (the
`localTag` prefix `'flow-'` vs `'pomo-'` and the `!item.todoistId` guard make
cross-list stamping a no-op). Confirm this in the audit.

**(f) Import button** — new `#flow-import-todoist` handler (mirror
`initSavedTasksPanel` lines 971–1000+):
```js
TodoistUI.openPicker({
  onImport: (tasks) => {
    const items = loadFlowUserTasks();
    for (const t of tasks) {
      if (!t || typeof t.content !== 'string') continue;
      const tid = t.id ? String(t.id) : null;
      // de-dupe by id, then link-by-text, then skip-by-text — copy V1 logic
      ...
      items.push({ text: t.content, todoistId: tid, done: false });
    }
    saveFlowUserTasks(items);
    renderFlowUserTasks();
  }
});
```
Reuse V1's three-branch dedupe (`existingByTid` / link `existingByText && tid` /
skip `existingByText`) verbatim — see `pomodoro-ui.js:984–1000`.

**(g) Wire-up in `initFlowUI()`** — render the list on init; attach the
input/import listeners; render again inside `updateFlowUI()`'s `isIdle` block
(line ~451, next to `renderFlowChecklist()`).

**(h) In-session count** (DECISION 3/4) — in `updateFlowUI()`'s `isFocusActive`
branch (line ~456), compute `done/total` and write a "Tasks: N/M" element in
`#flow-running`; render the checkable mirror list there too.

**(i) Start-path `done` reset** (DECISION 5) — in `onFlowRight()` idle→start
(line ~325, after `Flow.start()`), map `flow_user_tasks` to `done:false` and
persist, so a fresh block starts unchecked. Do NOT clear the list text.

**(j) History capture** (DECISION 4) — in `saveFlowSessionToHistory()`
(line 797–811), add `session.tasksPlanned = tasks.length` and
`session.tasksCompleted = tasks.filter(t => t.done).length` (only when
`tasks.length > 0`, matching the conditional-field style of `distractions` /
`bfrbs`). Add the "Tasks" row to `renderFlowSummary()` (line ~757).

### 2. `index.html` (edit) — markup only

**(a) Setup view** — inside `#flow-setup`, below `.flow-checklist` (after line
395), add a "Tasks for this block" section: a labeled container, the
`#flow-user-task-input`, the `#flow-user-tasks-items` list container, and the
`#flow-import-todoist` button (`class="tempo-todoist-secondary"`, reusing V1's
button style).

**(b) Running view** (DECISION 3) — inside `#flow-running` (after line 402),
add a `#flow-running-tasks` block: the "Tasks: N/M" count + the
`#flow-running-tasks-items` checkable mirror.

**No script-order change** — both Todoist modules already load before
`flow-ui.js` (verified: `index.html:1052–1055`).

### 3. `css/styles.css` (edit)

- Style the new setup task-list section to match `.flow-checklist` spacing.
- Style the checkable task rows (reuse `.flow-check-row` patterns where
  possible) + the running-view count + mirror list.
- The picker-modal CSS already exists (V1). The `.tempo-todoist-secondary`
  button class already exists (V1) — the import button reuses it.

### 4. `js/export.js` (edit) — backup parity (DECISION 8, Phase 2)

This is the one non-UI change, owned by **engine-implementer (Phase 2)** — it is
a data module, not a `-ui.js` file. Two additive edits, ~3 lines total:

1. Add `'flow_user_tasks'` to the `EXPORT_SETTINGS_KEYS` array (the "Flow Block"
   group, after `flow_last_saved_session` at `js/export.js:94`).
2. In `buildBackupData()` (`js/export.js:150–158`), broaden the existing
   linkage-strip condition from `if (key === 'pomodoro_saved_tasks')` to also
   match `flow_user_tasks` (e.g. `if (key === 'pomodoro_saved_tasks' || key ===
   'flow_user_tasks')`).

**No change to `_stripTodoistLinkage` itself** — verified it already preserves
non-Todoist fields (its comment at `js/export.js:130` explicitly anticipates a
`done` field) and drops `todoistId` + `localTag`. So Flow tasks export with
`text` + `done` preserved, Todoist linkage stripped — identical treatment to
Pomo saved tasks. The token-account-neutrality rationale (a `todoistId` 404s if
restored to a device on a different Todoist account) applies equally to Flow.

`flow_user_tasks` still must NOT be added to `SYNCED_STORES` (`js/sync-engine.js`)
— Firestore sync and device backup are different axes (Todoist is the
cross-device source of truth; backup is the user's own-device portability).

### 5. `sw.js` — CACHE_NAME bump

Mandatory (cached web files change). Current value (read at ship time;
`v101-todoist-integration` per `sw.js:1`). Bump to
`'stopwatch-v102-flow-tasks'` (or next free `vNNN-` if a higher version landed
first). `flow-ui.js` is already in the `ASSETS` array (line 43); no new files,
so no ASSETS additions — but the bump itself is required.

## Hard rules

- **Audit before code.** Audit at `docs/audits/todoist-flow-tasks-AUDIT.md`,
  reviewed + committed before any code.
- **No engine changes.** `js/todoist.js`, `js/todoist-ui.js`,
  `js/pomodoro-ui.js`, `js/flow.js` are all read-only. If you think you need to
  touch one, stop and raise it — the design says you don't.
- **Delete in Flow does NOT delete in Todoist.** The delete handler must NOT call
  any `Todoist.*` method. (`Todoist.deleteTask` does not exist; keep it that way.)
- **No `Todoist.updateTask`.** Rename write-back is follow-up B. Do not add the
  engine method or any inline-rename UI here.
- **Token is device-local — already handled.** Do NOT add any `todoist_*`
  credential key anywhere new. `flow_user_tasks` itself carries no credential.
- **`flow_user_tasks` axis split (DECISION 8).** Do NOT add it to `SYNCED_STORES`
  (`js/sync-engine.js`) — no Firestore sync, no `deviceId`/`updatedAt`/
  `schemaVersion` stamping. DO add it to `EXPORT_SETTINGS_KEYS` (`js/export.js`)
  with Todoist linkage stripped via the existing `_stripTodoistLinkage`, exactly
  like `pomodoro_saved_tasks`. Sign-off greps confirm: present in `export.js`,
  absent from `sync-engine.js`.
- **No `SCHEMA_VERSION` bump.** `flow_user_tasks` is non-synced.
- **Use shared helpers.** `escapeHtml` (`js/dom-utils.js`) for all rendered task
  text. `Platform.haptic` for any haptic. No `navigator.vibrate`, no
  `new Notification`.
- **Use `fetch` only** — already true; all network goes through `js/todoist.js`,
  which this PR only calls, never modifies.
- **Reuse `openPicker` unchanged.** If the picker needs a change, that's a
  separate concern — raise it; don't fork it.
- **No iOS-specific code.** WKWebView handles `fetch`; `js/platform.js` untouched.
- **No polling.** Refresh is on-picker-open + on-focus, both already in
  `js/todoist.js` / `js/todoist-ui.js`.

## Phase plan (note for the orchestrator)

This is a **mostly-UI PR** with one small data-module change. The audit's
affected-files table lists `js/export.js` (data), `js/flow-ui.js` (UI),
`index.html`, `css/styles.css`, `sw.js`. Therefore (revised at the audit pause
after DECISION 8 added `js/export.js`):

- **Phase 2 (engine-implementer): `js/export.js` only** — the ~3-line backup-parity
  change in §4 above (add the key + broaden the strip call). Pure data/logic, no
  DOM. Nothing else; `js/flow-ui.js` is the ui-wirer's, not the implementer's.
- **Phase 3 (engine-tester): extend `tests/export.test.js`** — add 1–2 cases
  asserting `flow_user_tasks` is exported with `todoistId`/`localTag` stripped and
  `text`/`done` preserved (mirrors the existing `pomodoro_saved_tasks` strip
  coverage). `tests/export.test.js` already exists. Run via `tests/index.html`,
  report pass/fail. (The Flow UI logic in `js/flow-ui.js` remains harness-free —
  verified by manual smoke, not engine tests.)
- **Phase 4 (ui-wirer): the main implementing phase.** Does all of `js/flow-ui.js`
  + `index.html` + `css/styles.css`, visually verifies via kapture
  (`#/flow` route renders; add → check → count updates; import modal opens;
  one neighbor route still renders).
- **Phase 5 (pr-shipper): docs + cache bump + branch + commit + gated push.**

The audit should confirm this routing. If the auditor classifies any work as
true engine logic, normal Phase 2/3 apply.

## Engine-test plan

**1–2 new cases in `tests/export.test.js`** (DECISION 8): assert `flow_user_tasks`
round-trips through `buildBackupData()` with `todoistId`/`localTag` stripped and
`text`/`done` preserved — mirrors the existing `pomodoro_saved_tasks` strip
coverage. Run via `tests/index.html` in a browser; report pass/fail.

The reused Todoist client is already covered by `tests/todoist.test.js` (35
cases) — unchanged here. The Flow UI logic in `js/flow-ui.js` is harness-free
(engine-tests-only repo); it's verified by manual smoke below, not engine tests.

## Manual smoke

1. **Setup list renders.** `#/flow` idle → "Tasks for this block" section shows
   below the ritual checklist; empty state reads cleanly.
2. **Add local task.** Type + Enter (no token) → row appears, checkable.
3. **Check/uncheck (local).** Toggling updates the row; no errors; no network.
4. **Import from Todoist.** Configure token in Settings (from V1). "Import from
   Todoist" → picker lists filter tasks → multi-select → tasks appear in the
   Flow list.
5. **Write-back close.** Check off an imported task → it closes in Todoist.
6. **Write-back reopen.** Uncheck → it reopens in Todoist.
7. **Create write-back.** Add a new task with token set → appears in Todoist's
   default project; the local row gets its `todoistId` stamped (re-import
   doesn't duplicate it).
8. **Delete guard.** Delete an imported task in Flow → it REMAINS in Todoist.
9. **Start gating unaffected (DECISION 2).** Start enables on ritual-checklist
   completion regardless of the task list's state.
10. **In-session list (DECISION 3).** Start a block → running view shows the
    checkable list + "Tasks: N/M done"; checking one updates the count + closes
    in Todoist.
11. **`done` reset on new block (DECISION 5).** Complete some tasks, end/reset
    the block, start a new one → list text persists, all unchecked.
12. **Summary card (DECISION 4).** End a block → summary shows "Tasks N/M".
13. **Offline write.** Disconnect → check a task → no UI error → reconnect →
    queue drains → Todoist task closes.
14. **Backup parity (DECISION 8).** Add a few Flow tasks (some Todoist-linked) →
    Export full backup JSON → confirm `flow_user_tasks` is present with `text` +
    `done` but NO `todoistId`/`localTag` → import the backup on a fresh state →
    tasks reappear (text + done), unlinked. Then confirm `flow_user_tasks` is
    NOT in the Firestore sync payload.
15. **No regression.** Ritual checklist + distraction log + recovery flow + Pomo
    saved-tasks (V1) all still work.
16. **(iOS, optional.)** One create + one close on device (re-paste token).

## Blast radius

**Tier: medium** (auditor-confirmed 2026-05-29). Drivers: single feature, 5
modified files (`js/export.js`, `js/flow-ui.js`, `index.html`, `css/styles.css`,
`sw.js`) + cache bump, 1 new localStorage key, reuses the battle-tested V1 engine
+ picker unchanged, no new modules. Lower than V1's `high` because there's no
engine module, no sync-store touch, no schema-version concern, and one key
instead of four. The DECISION 8 `js/export.js` change is additive (allowlist
entry + reuse of an existing stripper), not new logic — keeps it medium.
pr-shipper gates on this tier (medium = 30s proceed-by-default window).

## Deliverable

Branch `feat/todoist-flow-tasks`, PR against `main`. Suggested commit split:

1. `feat(export): include flow_user_tasks in backup with linkage stripping` —
   `js/export.js` + `tests/export.test.js` (Phase 2 + 3).
2. `feat(todoist): Flow user-task list + Todoist write-back` — `js/flow-ui.js` +
   `index.html` + `css/styles.css` + `sw.js` cache bump (Phase 4).
3. `docs: mark Todoist follow-up A shipped + state-model key` — CLAUDE.md
   backlog row #8 tick-off + `flow_user_tasks` added to the State Model key list
   (noting: synced=no, exported=yes) + SESSION-LOG.md entry. pr-shipper handles
   this.

PR title: `feat(todoist): Flow user-task list two-way integration (backlog follow-up A)`.
