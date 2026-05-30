# Session Wrap-up — 2026-05-29 — Tempo: Todoist follow-ups A + B (orchestrated, both merged)

## 1. What we did

- Shipped **PR #102** (`ae693d3`) — Todoist follow-up A: a user-editable "Tasks for this block" list in the Flow Block (setup + running views), two-way Todoist write-back, reusing the V1 engine + picker unchanged. Squash-merged to `main`.
- Shipped **PR #103** (`8f02a23`) — Todoist follow-up B: inline click-to-edit rename on Pomodoro saved tasks, propagating to Todoist via a new `Todoist.updateTask` method. Squash-merged to `main`.
- Ran each PR through the full 5-phase orchestrator (`auditor → engine-implementer → engine-tester → ui-wirer → pr-shipper`) with the audit-pause gate and medium-tier 30s proceed-by-default ship window.
- New engine surface: `Todoist.updateTask(id, {content})` (`POST /tasks/{id}`) + an idempotent `'update'` offline-queue op kind; `Todoist.deleteTask` deliberately stays absent.
- New non-synced key `flow_user_tasks` (#102), added to `EXPORT_SETTINGS_KEYS` with Todoist-linkage stripping (DECISION 8) but kept OUT of Firestore `SYNCED_STORES`.
- 14 new engine tests total (6 in `tests/export.test.js` for #102, 8 in `tests/todoist.test.js` for #103); both PRs browser-verified via kapture, including orchestrator-driven live interaction.
- `sw.js` `CACHE_NAME` bumped twice: `v101-todoist-integration → v102-flow-tasks → v103-pomo-rename`. Backlog rows #10-A and #10-B both marked shipped; the Todoist write-back arc (V1 #100 + A #102 + B #103) is now complete.

## 2. The why

- **Audit-before-code caught false brief premises on both PRs.** #102: the brief said "keep `flow_user_tasks` out of backup like Pomo" — but the audit verified `pomodoro_saved_tasks` *is* in `EXPORT_SETTINGS_KEYS`, so "parity with Pomo" actually meant *include* it. #103: the brief assumed markup `<span class="text" contenteditable>`, but the real class is `.pomo-checklist-item-text`, shared across 4 renderers. Pattern: **the audit phase pays for itself by catching brief-vs-code drift before any code is written** — same lesson as the V1 PR (#100) that found Flow's "checklist" was a fixed ritual.

- **DECISION 8 (backup parity) — `flow_user_tasks` exported with linkage stripped, not synced.** Firestore-sync and device-backup are *different axes*: Todoist is the cross-device source of truth (so no Firestore sync), but a local backup should still round-trip the user's task text (so yes to `EXPORT_SETTINGS_KEYS`, reusing the existing `_stripTodoistLinkage` which already anticipated a `done` field). Rejected: leaving it out, which would silently drop Flow tasks on restore — an asymmetry vs. Pomo. Pattern: **separate the sync axis from the backup axis; credentials/IDs get stripped at the export boundary, user content survives.**

- **Scope-guarded `contenteditable` (#103) — the load-bearing constraint.** `.pomo-checklist-item-text` is rendered by the focus checklist, break checklist, actual-work list, *and* saved tasks. A naïve "make the span editable" would leak click-to-edit into all four. Solution: a saved-task-only `data-saved-rename-idx` hook + listeners scoped under `#pomo-saved-tasks-items`. Pattern: **when a CSS class is shared across surfaces, scope behavior to an instance hook, never the class.**

- **`Todoist.deleteTask` stays absent (hard guard, carried forward).** A rename PR has no reason to add delete, and absence (vs. a flag) means a future careless commit can't accidentally wire a Tempo misclick to nuke a real Todoist task. Pattern: **forbid destructive cross-system writes by absence, verified by grep in the sign-off.**

- **Idempotent `'update'` offline-queue op.** Re-sending the same `{content}` is a Todoist no-op, so drain retries are safe and the new `_executeOp` branch needs no special 2xx handling (unlike `'create'`, which emits `create-resolved` for late id-stamping). Pattern: **make queued mutations idempotent so FIFO drain retries are free.**

- **Orchestrator-driven live verification to close the subagent gap.** The `ui-wirer` subagent's kapture toolset has no type/eval tool, so it could only structure-verify (grep + DOM + console). The orchestrator (broader kapture toolset: `fill`/`keypress`/`click`) drove the real interaction afterward — for #102 the add→check→start→count + done-reset; for #103 the click→edit→commit + empty-revert + reload-persistence. Pattern: **verify behavior in the real app, not just structure; close tooling gaps at the orchestration layer.**

- **Squash-merge both PRs.** Keeps `main` linear and matches every recent PR; `gh pr merge --squash --delete-branch` cleaned local + remote branches in one shot (the worktree quirk that bit older sessions didn't recur).

## 3. Concepts and vocabulary

| Term | Definition | Where it appeared today |
|------|-----------|------------------------|
| **Orchestrator (Tempo-specific)** | A coordinator that dispatches specialist subagents (auditor/engine-implementer/engine-tester/ui-wirer/pr-shipper) through gated phases; writes no code itself | Drove every commit in both PRs |
| **Blast radius / tier** | Audit-stamped severity (low/medium/high) that gates whether pr-shipper auto-pushes or pauses; medium = 30s proceed-by-default window | Both PRs stamped medium |
| **Audit-before-code** | Hard rule: no engine work until an audit enumerates affected files, risks, test scope — and is reviewed | Caught false premises on both PRs |
| **Sync axis vs. backup axis** | Firestore cross-device sync and local device backup/export are independent decisions for a given key | DECISION 8: `flow_user_tasks` exported-yes / synced-no |
| **`_stripTodoistLinkage`** | Export-time helper that drops `todoistId`/`localTag` from a task array, preserving `text`/`done`, so backups are account-neutral | Reused for `flow_user_tasks` (#102) |
| **Instance-scoped hook** | Targeting behavior to a per-row data attribute (`data-saved-rename-idx`) instead of a shared class, to avoid leaking into other surfaces | Scope guard for inline rename (#103) |
| **Idempotent op (offline queue)** | A queued mutation safe to apply more than once; enables free FIFO drain retries | `'update'` op kind (#103) |
| **Hard guard (write-direction asymmetry)** | Forbidding a destructive cross-system action by making the method absent, grep-verified | `Todoist.deleteTask` never added |
| **Late-stamp / `create-resolved`** | A `create` op that drains offline resolves via a window CustomEvent carrying a `localTag`, so UI stamps the returned Todoist id later | Why `'update'` needs *no* such emit |
| **`contenteditable` commit/cancel** | Inline edit: click → editable + select-all; blur/Enter commit (read `textContent`, trim, strip newlines); Escape restores original | Pomo saved-task rename (#103) |
| **SW precache + cache bump** | `CACHE_NAME` bump + ASSETS list must move together, or offline users get stale/broken assets | Bumped `v101→v102→v103` |

## 4. Takeaways

- **Audit cost is a fraction of the code it gates, and the multiplier is highest when the brief author hasn't read every touched line.** Today both briefs had a factual error the audit caught (backup allowlist membership; shared CSS class) — fixing in the brief was minutes; fixing post-code would have been a rewrite.

- **When a key needs to move between devices, ask two separate questions: sync it? back it up?** They have different answers and different mechanisms. `flow_user_tasks`: no Firestore sync (Todoist is the source of truth), yes local backup (with IDs stripped).

- **Scope behavior to an instance hook, never a shared class.** If a class renders in N places, a class-level listener fires in all N. A `data-*` attribute on just the rows you mean is the cheap, grep-verifiable fix.

- **Structure-verification ≠ behavior-verification.** A grep proving the wiring is scoped, plus a clean DOM render, still isn't proof the feature works — drive the real interaction (or have something that can). Today the orchestrator drove kapture `fill`/`click` to actually rename a task and confirm it persisted across reload.

## 5. Suggested next moves

1. **(Recommended) Backlog #11 — Pomodoro phase-revert ("← Go back" button).** Priority 5, the highest-ROI unbuilt item; spec is fully written in CLAUDE.md. ~40 LoC across `js/pomodoro.js` (one `previousPhaseSnapshot` field + `revertPhase()`) + `js/pomodoro-ui.js` (one button). Reasoning: lowest effort × real daily friction, no dependency on unshipped infra, and it's a clean orchestrator run with a genuine engine slice. The one correctness gate: capture `cycleIndex` in the snapshot or the long-break cadence drifts. Effort: ~1–2 hrs.

2. **Diagnose the 4 `tests/recovery-feed.test.js` baseline failures.** Pre-existing since rhythm PR #98 (`Cannot read properties of null (reading 'day'/'rows')`). Reasoning: a green suite makes every future PR's test signal trustworthy; right now every run carries 4 known-red that have to be mentally subtracted. Effort: ~30 min (likely a missing localStorage seed or an un-narrowed null in the test setup).

3. **Live end-to-end Todoist smoke against the deploy with a real token.** Engine is unit-tested and UI is kapture-verified, but no token-backed close/reopen/create/update round-trip has been eyeballed on `ksdisch.github.io/stopwatch`. Reasoning: the one gap unit tests + structure checks can't cover. Effort: ~10 min once you have a token.

4. **iOS background ambient-audio on-device verification (carry-over).** PR #92's `AVAudioSession` fix is unverified on hardware. Reasoning: only matters if you're actively using ambient noise on iPhone; needs the device. Effort: 5 min smoke if device handy.

## 6. 30-second elevator version

Today I finished the Todoist integration for Tempo — my stopwatch/Pomodoro/wellness PWA — by shipping the two deferred follow-ups, both merged. The first added a user-editable task list to the Flow focus-block screen that two-way-syncs with Todoist; the second added inline click-to-rename on Pomodoro saved tasks, with the rename propagating back to Todoist through a new `updateTask` method and an idempotent offline-queue op. I ran each through a five-phase agent pipeline that gates on an audit before any code gets written — and that audit caught a factual mistake in *both* of my briefs: one about which localStorage keys actually get backed up, and one where the markup class I was going to make editable is secretly shared across four different lists, so a naïve change would've leaked click-to-edit everywhere. The interesting design call was realizing that syncing a key to the cloud and backing it up locally are two independent decisions with different answers. I verified both features live in a real browser — actually renamed a task and confirmed it survived a reload — not just by reading the diff.

## 7. Active recall

1. On the Flow task-list PR, the audit overturned a decision in your brief about backup. What was the mistake, and what's the underlying principle that resolved it?
2. The inline-rename PR scoped `contenteditable` to a `data-saved-rename-idx` hook instead of the `.pomo-checklist-item-text` class. Why does that matter — what breaks with the class-level approach?
3. Walk me through why the new `'update'` offline-queue op needed no special success handling, whereas `'create'` does.
4. Why is `Todoist.deleteTask` absent from the engine rather than present-but-guarded?
5. The `ui-wirer` reported the rename UI as "structure-verified, not driven." What did that mean, and how was the gap closed?

---

Try to answer each aloud before scrolling. Answer key below.

### Answer key

1. **The mistake + principle.** The brief said keep `flow_user_tasks` out of `EXPORT_SETTINGS_KEYS` "like `pomodoro_saved_tasks`" — but the audit verified `pomodoro_saved_tasks` *is* in that allowlist (exported with Todoist IDs stripped via `_stripTodoistLinkage`). So true parity meant *including* `flow_user_tasks`, not excluding it. The principle: **Firestore-sync and local-backup are independent axes.** A key can be non-synced (Todoist is the cross-device source of truth) yet still belong in the device backup so the user's task text round-trips a restore — with the account-bound `todoistId`/`localTag` stripped at the export boundary so a backup restored to a different Todoist account doesn't carry dangling IDs.

2. **Scope guard.** `.pomo-checklist-item-text` is rendered by four functions: the focus checklist, the break checklist, the actual-work list, and the saved-tasks panel. A click/edit listener attached at the class level would fire in all four, making every list inline-editable — scope creep and a likely source of bugs (e.g., editing a focus-checklist item with no rename semantics). Scoping to a `data-saved-rename-idx` attribute that only the saved-tasks renderer emits, with listeners queried under `#pomo-saved-tasks-items`, confines the behavior to exactly the intended rows. Verified by grep that no other renderer touches `contentEditable`.

3. **`'update'` vs `'create'` drain.** A `create` op, when it finally drains, produces a brand-new Todoist task whose `id` the local task doesn't know yet — so `_executeOp` parses the response and emits a `todoist:create-resolved` window event carrying the `localTag`, which the UI uses to late-stamp the new id onto the local entry. An `update` op targets a task whose id already exists locally; success just means "the rename landed," so the existing `if (res.ok) return 'remove'` path covers it with no event. And because re-sending the same `{content}` is a server-side no-op, the op is idempotent — a duplicate drain is harmless.

4. **Absence over guard.** Delete is a destructive cross-system action: a misclick in Tempo must never delete the user's real Todoist task. A flag-gated `deleteTask` could be flipped on by a careless future commit; a method that doesn't exist on the engine's public surface can't be called from anywhere. The absence is verified by grep in the audit sign-off (`grep deleteTask js/todoist.js` returns only a doc-comment ref). Lower blast radius, enforced structurally rather than by discipline.

5. **Structure-verified vs. driven, and closing the gap.** The `ui-wirer` subagent's kapture toolset has no type/eval tool, so it could confirm the rendered markup carried the `data-saved-rename-idx` hook, that the wiring was scoped (grep), that the page loaded with zero console errors, and that the CSS affordance was present — but it couldn't actually *type a rename and commit it*. The orchestrator, which has the fuller kapture toolset (`fill`/`keypress`/`click`), closed the gap on a fresh-origin server: it seeded a saved task (added a checklist item, pinned it), clicked the span to confirm it went `contenteditable`, filled new text and confirmed the commit persisted ("Buy groceries" → "Buy oat milk"), tested that a whitespace-only commit reverted to the original, and reloaded the page to confirm the rename survived in localStorage. (Aside: a stale browser cache initially served the pre-edit JS — resolved by switching to a brand-new origin port, which has no SW or HTTP cache.)
