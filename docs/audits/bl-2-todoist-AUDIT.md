# bl-2-todoist · Pomodoro-only V1 of Todoist integration (Flow + rename deferred)

## Goal
Build a Pomodoro-only V1 of the Todoist integration: settings-drawer token + project + filter config, a shared picker modal that imports tasks into the Pomodoro saved-tasks panel, and check / uncheck / create write-back to Todoist (delete remains local-only by design). Flow integration and rename write-back are deferred to follow-up PRs.

## Blast radius
**Tier:** high

**Justification:** Two new JS modules (`js/todoist.js`, `js/todoist-ui.js`) + edits to 5 existing files spanning engine, UI, and chrome layers, four new persistence keys, an `sw.js` cache bump, a third-party network surface, and a `pomodoro_saved_tasks` shape migration. Per the rubric, "multi-layer touches (engine + UI + tests + new module in one PR)" alone pushes to high; the cache bump + persistence-key migration reinforce it. No sync-store / `js/schema.js` / `js/platform.js` / `package.json` / `ios/*` touches (all explicitly out of scope).

## Affected files
| Path | Change type | Notes |
|------|-------------|-------|
| `js/todoist.js` | add | New IIFE module. REST v2 client + offline queue (200-op FIFO cap, persisted to `todoist_pending_ops`). **V1 public surface (write side ships three methods only):** token mgmt, `testConnection`, `getProjects`, `getTasks(filter)`, `closeTask`, `reopenTask`, `createTask`, `drainQueue`. **Explicitly NOT shipped in V1:** `Todoist.updateTask` (deferred to the rename follow-up PR) and `Todoist.deleteTask` (forbidden by design — delete in Tempo never propagates). Queue op `kind ∈ {'close', 'reopen', 'create'}`. `visibilitychange:visible` + `online` listeners drain the queue + emit `Todoist.onTasksMaybeStale`. Pure data + network (no DOM). |
| `js/todoist-ui.js` | add | New IIFE module. Two pieces: (a) settings-drawer section renderer (`TodoistUI.renderSettingsSection`) — token input + Test-connection button + project dropdown + filter input; (b) shared picker modal (`TodoistUI.openPicker({ onImport })`) — refresh-on-open + refresh-on-focus reconciliation. Reused by the Pomo integration in this PR and the deferred Flow follow-up. Uses `escapeHtml` from `js/dom-utils.js` for all Todoist-content rendering (XSS guard against Todoist `content` field). |
| `js/pomodoro-ui.js` | modify | Final scope: (i) shape migration `pomodoro_saved_tasks` `string[]` → `Array<{ text, todoistId? }>` via read-time coercion in `loadSavedTasks` (or equivalent read site) — idempotent, no `SCHEMA_VERSION` bump (non-synced store); (ii) "Import from Todoist" button on the Saved Tasks panel (`pomo-saved-tasks` at `index.html:515`) wired to `TodoistUI.openPicker`; (iii) close-on-check / reopen-on-uncheck via the `+Focus` / `+Break` add-to-checklist handlers (`pomodoro-ui.js:790–815`) plus the corresponding checklist checkbox handler (`pomodoro-ui.js:605–615`); (iv) create-on-Enter via `pomo-checklist-input` (`pomodoro-ui.js:654–665`) — the *checklist* input, NOT a saved-tasks input (there is none); (v) delete-guard at the delete handler (`pomodoro-ui.js:632–641`) — array entry removed locally, NO Todoist call; (vi) **NO rename write-back** — Pomo has no inline-rename UI; adding one is a deferred follow-up. |
| `js/tempo-nav.js` | modify | Add a `TodoistUI.renderSettingsSection(drawer)` call to the drawer-open path, placed immediately below the Cloud Sync section (index.html line 169). Existing pattern: `initCloudSyncSection(drawer)` at tempo-nav.js:316. Add analogous `initTodoistSection(drawer)` wrapper. |
| `index.html` | modify | Two changes: (a) add an empty `<section id="settings-todoist"></section>` placeholder inside `#tempo-settings-drawer`, placed after the Cloud Sync section's closing `</div>` (currently at index.html:169); (b) script-load order — insert `js/todoist.js` then `js/todoist-ui.js` between `js/distractions.js` (currently `index.html:1033`) and `js/pomodoro-ui.js` (currently `index.html:1034`). Both must also load before `js/tempo-nav.js` (currently `index.html:1075`) so `TodoistUI.renderSettingsSection` is defined when the drawer wires up. Updated chain fragment: `distractions → todoist → todoist-ui → pomodoro-ui → flow-ui → ...`. |
| `css/styles.css` | modify | Picker modal layout (header / body / footer, backdrop, max-height scroll on task list), settings section spacing matching `.tempo-cloud-sync-section` block, secondary-button styling for "Import from Todoist" entry points. No visual marker on imported tasks per brief decision #1. |
| `sw.js` | modify | Bump `CACHE_NAME`. Current value (line 1) is `'stopwatch-v100-rhythm-per-day'`. Propose `'stopwatch-v101-todoist-integration'`. pr-shipper validates the exact target at ship time (if a `v101-` PR lands first, increment to v102). |
| `tests/todoist.test.js` | add | New file (~17 cases). See **Test scope** below for the breakdown. Existing engine-test total per recent session log = 642; new total ~659. |
| `tests/index.html` | modify (scope expansion allowed) | Add `<script src="../js/todoist.js"></script>` to the engine-modules block (mock `fetch` in the test harness) and `<script src="todoist.test.js"></script>` to the suite block. No new dependencies on Web APIs beyond `fetch` (mockable). |

**Affected file count: 9** (2 add + 5 modify + 1 add test + 1 modify test harness).

## Cross-cutting invariants touched
- **`sw.js` CACHE_NAME** — load-bearing. `index.html` + `css/styles.css` + multiple JS files change; cache bump is mandatory or PWA installs serve stale assets indefinitely.
- **Script-load-order dependency graph** (per CLAUDE.md "no build step") — `js/todoist.js` MUST load before any UI that calls `Todoist.*` synchronously. The audit's affected-files table specifies the exact insertion point (between `js/distractions.js` and `js/pomodoro-ui.js`).
- **`escapeHtml` from `js/dom-utils.js`** — MANDATORY for any rendered Todoist `content` field (XSS guard — Todoist permits markdown-flavored text in task content). Do NOT re-implement.
- **`Utils.formatMs(ms)` from `js/utils.js`** — not used in this PR (no time-formatting surface).
- **`Platform.haptic` / `Platform.notify`** — not used in this PR (no haptics on Todoist write paths per brief Hard rule #6). Do NOT call `navigator.vibrate` directly.
- **`js/schema.js` (sync invariant stamping)** — explicitly NOT touched. New keys are non-synced; `deviceId` / `updatedAt` / `schemaVersion` stamping is NOT applied to `todoist_*` keys.
- **Firestore sync stores (`SYNCED_STORES`)** — **VERIFIED**: `pomodoro_saved_tasks` is NOT in `SYNCED_STORES` (read at `js/sync-engine.js:138–145` — the 6 entries are `meds`, `history`, `rest_log`, `presets`, `bfrb_events`, `distractions`). Safe to evolve its on-disk shape from `string[]` to `Array<{ text, todoistId? }>` without touching the sync surface.
- **Export/Backup allowlist (`EXPORT_SETTINGS_KEYS`)** — **VERIFIED**: `js/export.js:74–113` uses an opt-in allowlist; `todoist_api_token`, `todoist_default_project_id`, `todoist_default_filter`, `todoist_pending_ops` are NOT in the list and therefore **will NOT leak into the full-data JSON export** by default. The implementer must NOT add the new keys to `EXPORT_SETTINGS_KEYS`. `js/backup.js:30–138` reuses `Export.buildBackupData()`, so the same allowlist protects the F12 backup file. This is the device-local guarantee per brief Hard rule #2.
- **`js/platform.js` native bridges** — explicitly NOT touched. `fetch` against `api.todoist.com` works identically on web and iOS Capacitor WKWebView (CORS-OK, no plugin needed).
- **`package.json`** — explicitly NOT touched. No new npm dependency.

## Risks
| Risk | Likelihood | Blast radius | Mitigation |
|------|------------|--------------|------------|
| **Todoist API token leaks into Export JSON or F12 backup file.** Token would be reusable by anyone with the export file. | low | data-loss (account-level — affects user's Todoist data, not Tempo data) | The allowlist in `js/export.js:74–113` is opt-in; new `todoist_*` keys are excluded by default. Sign-off checklist explicitly verifies non-membership. Brief Hard rule #2 forbids adding them. |
| **Accidental delete-propagation** — implementer adds `Todoist.deleteTask` "for completeness" and the existing delete handler in Pomodoro saved-tasks wires to it. A misclick in Tempo nukes the real Todoist task. | med | data-loss | Brief Hard rule #1 explicitly forbids `Todoist.deleteTask` even existing on the client. Sign-off checklist verifies absence. Engine tests must NOT include any delete-write-back case. |
| **Todoist rate-limit exhaustion** (1000 req / 15min / token). With the no-polling design + on-demand drains, single-user volume is far below the cap, but a bug (e.g. drainQueue infinite retry on 5xx) could burn through it. | low | local-only (UI errors, no data loss) | drainQueue retries are FIFO with explicit branching: 2xx removes the op, 4xx removes + logs (permanent — bad token, deleted project), 5xx / network leaves in place for next focus/online event. Test case 11 ("drain failure branching") covers this. |
| **Offline queue cap reached** (200 ops) — user offline for an extended period generates more writes than the cap; FIFO eviction drops the oldest pending op silently. | low | local-only | 200 ops corresponds to ~200 task interactions while offline — extreme but bounded. Eviction emits a console warn. Brief decision #5 binds the cap. Test case 9 explicitly asserts the eviction. |
| **Network outage mid-write** — `fetch` throws or hangs after enqueue, before the response is read. UI assumes success. | med | local-only | All write methods catch network errors + auto-enqueue. The fire-and-forget pattern in the UI write-back wrappers means the user's local action (check off in Pomodoro) completes regardless. The only user-visible signal is the "N queued offline writes" status row in settings. |
| **Todoist server-side breaking change** (REST v2 deprecation, response shape change, auth header rename). Tempo's client breaks; all writes fail silently. | low | local-only (Tempo continues to work; only Todoist sync breaks) | Out of Tempo's control. Mitigation: error normalization shape (`{ ok: false, status, message, isRetryable }`) surfaces 4xx as a permanent failure; the settings drawer's "Test connection" lets the user diagnose. Long-term mitigation: pin to REST v2 (not "latest"). |
| **`sw.js` cache-bump miss** — implementer forgets to bump `CACHE_NAME` and existing PWA installs serve stale JS, hiding the Todoist integration indefinitely until SW expiry. | med | web-bytes | pr-shipper checklist + Sign-off checklist both verify the bump. Smoke step 1 catches it (settings drawer shows no Todoist section). |
| **Cross-device token drift** — user pastes token on Device A; Device B is unconfigured. The two devices' local task lists diverge because Pomodoro saved-tasks are not in `SYNCED_STORES`. | low | local-only | **Documented design** (brief Hard rule #2): Todoist itself is the cross-device source of truth for tasks. Device B picks up the same Todoist tasks once its token is configured. This is an acceptable trade-off because syncing API credentials via Firestore is a worse failure mode (credential leak via cloud breach). Confirmation written into brief but the auditor flags it for explicit Kyle ack. |
| **Pomodoro saved-tasks shape migration breaks existing users.** Migrating `string[]` → `Array<{ text, todoistId? }>` requires a read-time coercion. A bug in the coercion drops user tasks on first load post-deploy. | med | local-only (saved-tasks loss; checklist + history unaffected) | Standard read-time migration pattern: `loadSavedTasks()` returns `items.map(i => typeof i === 'string' ? { text: i } : i)`. Test case 8 (new) asserts the coercion. Saves never persist back the old shape. Idempotent (coercing already-object entries is a no-op). |
| **Picker modal `escapeHtml` miss** — Todoist `content` field rendered as innerHTML without escape; malicious task content (or fancy emoji) breaks layout / triggers XSS. | low | local-only | Sign-off checklist verifies `escapeHtml` use. Engine test case for the picker's render function asserts that a `content: '<script>alert(1)</script>'` task renders as escaped text. |

**Risk count breakdown:** 10 total — 5 low / 5 med / 0 high.

## Test scope
- **New tests required:** `tests/todoist.test.js` — ~17 cases covering:
  1. Token mgmt: set/get/clear roundtrip; `hasToken()` boolean.
  2. **API contract** — each V1 public method (`testConnection`, `getProjects`, `getTasks`, `closeTask`, `reopenTask`, `createTask`) calls expected URL + method + Bearer header on mock fetch success. (`updateTask` is OUT of V1; do NOT add a test case for it.)
  3. Error normalization (non-2xx): returns `{ ok: false, status, message, isRetryable: false }` on 4xx; `isRetryable: true` on 5xx.
  4. Error normalization (network): `fetch` throws → returns `{ ok: false, isRetryable: true }`.
  5. Idempotent retry: two consecutive `closeTask(id)` calls each result in one fetch + `{ ok: true }`.
  6. Offline queue enqueue: `closeTask(id)` with `navigator.onLine === false` enqueues + returns `{ ok: true, queued: true }` without calling fetch.
  7. Offline queue drain: `drainQueue()` after going online dequeues + fetches; queue empty after.
  8. **Pomodoro saved-tasks shape migration**: `loadSavedTasks()` coerces legacy `string[]` to `Array<{ text }>` on read. Object entries pass through unchanged (idempotency).
  9. Queue cap 200 + FIFO eviction at cap.
  10. Queue persistence: queue survives module-level reset (re-read from localStorage).
  11. Drain failure branching: 4xx removes + logs the op; 5xx leaves in queue for retry; network throw leaves in queue.
  12. Create task stamps returned Todoist id: `createTask({ content })` mock returns `{ id: 'abc' }`; assert callback receives the id (or returned-value contract is met).
  13. `testConnection()` success: `GET /projects` returns 200 → `{ ok: true }`.
  14. `testConnection()` failure: 401 → `{ ok: false, status: 401, message }`.
  15. `getTasks(filter)` URL-encodes the filter string (e.g., `today & @work` → `today%20%26%20%40work`).
  16. Picker render escapes HTML in `content` (XSS guard).
  17. Settings persistence: `setDefaultProjectId` / `setDefaultFilter` roundtrip through localStorage.
- **Existing tests at risk:**
  - None directly. Engine-test harness loads engine modules only; UI files are not under test. The shape migration in `js/pomodoro-ui.js` has no engine test coverage today, so no existing test breaks.
  - `tests/index.html` script-load order requires the new `todoist.js` entry; verify the existing suite (642 cases) still runs green after the addition.

## Manual setup steps
13 steps — the brief's smoke plan is the canonical list. Reproduced here in condensed form:

1. **Token setup.** Open settings drawer. Paste an invalid token, click "Test connection" — expect `✗ Unauthorized`. Paste the real token (from `todoist.com/app/settings/integrations/developer`). Expect `✓ Connected`.
2. **Default project picker.** Open the project dropdown — Todoist projects load; Inbox is the first option.
3. **Default filter.** Confirm `today` default; can be edited; persists.
4. **Pomo picker.** Navigate to `#/timers/pomodoro`. Open the Saved Tasks panel. Click "Import from Todoist". Modal shows today's tasks; multi-select 2–3; click "Add to focus".
5. **Pomo write-back close.** Check off one imported task (via the `+Focus` → checklist checkbox path). Verify the same task closes in the Todoist app.
6. **Pomo write-back reopen.** Uncheck. Verify Todoist task reopens.
7. **Pomo create.** Add a brand-new task via the **checklist input** (`pomo-checklist-input`). With token configured, expect it to appear in Todoist's default project. (Note: the checklist input is the only free-form Pomo input; there is no separate saved-tasks add input.)
8. **Pomo delete.** Delete an imported task in Tempo. Verify it remains in Todoist (hard guard).
9. **Refresh on focus.** With the picker open, complete a task in the Todoist app, switch back to Tempo. Expect the task to disappear from the picker on next focus.
10. **Offline write.** Disconnect network. Check off a task. No UI error. Reconnect. Verify queue drains (Todoist task closes).
11. **Token cleared.** Clear the token. Picker errors gracefully ("Could not load tasks. Check your Todoist token in Settings.").
12. **No-regression sanity.** Confirm Pomodoro saved-tasks still works without a token (local-only tasks unchanged). Flow pre-block ritual checklist is untouched.
13. **(Optional, iOS.)** Repeat basic Pomo write-back smoke (one create + one close) on the iOS build. Re-paste token because it's device-local.

## Out of scope (explicitly NOT in this PR)
- **Flow integration** — deferred to a follow-up PR that adds a new user-task list to Flow alongside the existing 5-item ritual checklist, then reuses this PR's `TodoistUI.openPicker`. This PR does NOT touch `js/flow-ui.js`.
- **Pomodoro inline rename** — auditor finding; adding inline-rename UI to Pomodoro is deferred to a follow-up. This PR does NOT ship `Todoist.updateTask`.
- **Flow inline rename** — moot here because Flow integration is deferred entirely.
- **Deletion propagation** — delete in Tempo never deletes in Todoist. Hard rule.
- **OAuth 2.0** — personal API token only; no backend to hold OAuth client secret.
- **Sync of Pomo / Flow task lists via Firestore** — `SYNCED_STORES` untouched. Todoist itself is the cross-device source of truth for tasks.
- **Polling against Todoist** — refresh policy is on-modal-open + on-tab-focus + on-network-restore only. No `setInterval`.
- **Per-modal filter override UI** — picker uses the settings-default filter only (brief decision #7).
- **iOS-specific code paths** — `js/platform.js` untouched; no Capacitor plugin; pure `fetch` via WKWebView.
- **Visual marker on imported tasks** — imported and local tasks are visually identical (brief decision #1).
- **`/user` identity probe** — `testConnection()` is account-anonymous (brief decision #3); no `GET /sync/v9/user` call.
- **Schema version bump** — `js/schema.js` untouched. Additive nullable `todoistId?` field on non-synced stores; no F19 migration needed.
- **`js/platform.js` extension** — no new namespace.
- **`package.json` change** — no new npm dependency.
- **App Store re-submission** — this PR doesn't change anything iOS-binary-relevant. The web bytes the WKWebView loads change, which is handled by `npm run sync-www` per the iOS-build playbook; no archive bump.

## Sign-off checklist (for the implementer)
- [ ] Engine module changes match the affected-files table (`js/todoist.js`, `js/todoist-ui.js`, `js/pomodoro-ui.js`, `js/tempo-nav.js`, `index.html`, `css/styles.css`, `sw.js`).
- [ ] **`js/flow-ui.js` is NOT modified by this PR.** Flow integration is the deferred follow-up.
- [ ] Test scope above is covered (~17 cases in `tests/todoist.test.js`; existing 642-case suite still green).
- [ ] No re-implementation of `escapeHtml` (js/dom-utils.js) / `Utils.formatMs` (js/utils.js) / `Platform.*` (js/platform.js).
- [ ] `sw.js` `CACHE_NAME` bumped — current value is `'stopwatch-v100-rhythm-per-day'`, bump to `'stopwatch-v101-todoist-integration'` (or increment if a `v101-` PR landed first).
- [ ] `Todoist.deleteTask` does NOT exist on `js/todoist.js`'s public surface. No call site invokes a delete write-back.
- [ ] **`Todoist.updateTask` is NOT present on `js/todoist.js`'s public surface (V1 ships close / reopen / create only). Rename write-back is the deferred follow-up.**
- [ ] `todoist_api_token`, `todoist_default_project_id`, `todoist_default_filter`, `todoist_pending_ops` are NOT added to `EXPORT_SETTINGS_KEYS` in `js/export.js`. Verified via `grep` — none of those literals appear in the file.
- [ ] `SYNCED_STORES` in `js/sync-engine.js` is unchanged (still the 6 entries: `meds`, `history`, `rest_log`, `presets`, `bfrb_events`, `distractions`).
- [ ] `js/schema.js` is unchanged. No `SCHEMA_VERSION` bump.
- [ ] `js/platform.js` is unchanged.
- [ ] `package.json` is unchanged. No `npm install` step.
- [ ] Script-load order in `index.html` places `js/todoist.js` + `js/todoist-ui.js` BEFORE `js/pomodoro-ui.js` and `js/flow-ui.js` (between `js/distractions.js` and `js/pomodoro-ui.js`).
- [ ] Settings drawer markup includes `<section id="settings-todoist"></section>` placed immediately after the Cloud Sync section.
- [ ] No haptics or notifications added to Todoist write paths (brief Hard rule #6).
- [ ] All Todoist `content` field renders via `escapeHtml`.
- [ ] Browser smoke (steps 1–13 above) executed end-to-end; iOS step 13 deferred if Xcode build not current.

## Resolutions (post-audit, 2026-05-28)
Kyle resolved the 4 open questions surfaced in the initial audit pass. Recorded here for traceability:

1. **Flow integration shape** → **Option (a) — defer Flow to follow-up PR.** Ship Pomodoro-only this PR. The shared `js/todoist.js` engine + `js/todoist-ui.js` picker are designed for reuse by the Flow follow-up; no Flow code in this PR.
2. **Pomodoro inline-rename feasibility** → **Option (a) — drop rename write-back from V1.** Engine surface does NOT ship `Todoist.updateTask`. Todoist-side renames still flow into Tempo on next picker refresh.
3. **Pomodoro saved-tasks shape migration** → **Option (a) — migrate `string[]` → `Array<{ text, todoistId? }>` in place via read-time coercion.** Idempotent. No `SCHEMA_VERSION` bump.
4. **Script-load order** → ack the auditor's correction (insertion between `js/distractions.js` and `js/pomodoro-ui.js`). The brief now agrees with the audit.

---

### Audit summary

| Field | Value |
|---|---|
| **Affected files** | 9 (2 add + 5 modify + 1 add test + 1 modify test harness) |
| **Risk count** | 10 (5 low / 5 med / 0 high) |
| **Test scope** | ~17 new cases in `tests/todoist.test.js`; harness expansion in `tests/index.html` |
| **`sw.js` next CACHE_NAME** | `'stopwatch-v101-todoist-integration'` (current: `'stopwatch-v100-rhythm-per-day'`) |
| **Verified: `SYNCED_STORES` membership** | `pomodoro_saved_tasks` NOT in sync set. Brief claim CORRECT. |
| **Verified: Export/Backup allowlist exclusion** | Allowlist is opt-in; new `todoist_*` keys excluded by default. Implementer must NOT add them. Brief Hard rule #2 honored. |
| **Verified: V1 write surface** | `closeTask` / `reopenTask` / `createTask` only. `updateTask` deferred to rename follow-up. `deleteTask` forbidden permanently. |
| **Verified: Flow scope** | `js/flow-ui.js` NOT in this PR. Flow's 5-item ritual checklist is incompatible with Todoist import; follow-up will add a user-task list. |
| **Manual setup required** | Yes — user provides a personal Todoist API token (free, generated at `todoist.com/app/settings/integrations/developer`); pastes into the Tempo settings drawer per smoke step 1. |
