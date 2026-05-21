# Tempo cloud-sync — implement PR `meds-dose-edit` (post-Stage-E follow-up — editable + deletable dose log entries)

> **STATUS:** Skeleton brief, drafted by orchestrator 2026-05-21. Kyle to
> review + fill in the TODO blocks (R1 → R10) before the auditor is
> dispatched. Mirror format of `docs/sync-impl/prompts/E-3-PROMPT.md`.

You're working on Tempo, a vanilla-JS PWA + Capacitor iOS app. The
cloud-sync implementation plan is at `docs/sync-impl/PLAN.md` on `main`.
Stage 0 → Stage E (E-1a..E-1e, E-2, E-3) all shipped (PRs #46–#75), plus
the post-Stage-E reliability follow-ups (PRs #76–#79) and the three
top-of-backlog feature PRs (#81–#83). 628 engine tests pass on `main`.

`meds-dose-edit` is a **post-Stage-E follow-up** that closes a long-running
data-correction gap: today, once a `doseLog` entry is written (via "Took
it now" or "Took it ~X ago"), it is immutable. A mistimed tap silently
breaks the rest of the day's `Last dose at HH:MM` + status line + the
"taken today" derivation. There is no in-app way to fix the timestamp or
delete a fat-finger entry. Meds are the highest-friction surface for this
gap because doses are logged multiple times daily.

This PR introduces **edit + delete** on individual dose entries with
**sync-aware tombstones** so cross-device deletion propagates and does not
resurrect on the other device. It establishes the tombstone pattern for
the `meds` store, mirroring the additive `deletedAt` pattern already
shipped for presets in Phase 9 (the second-mover here gets the benefit of
the well-trodden seam).

---

## Required reading (before any code)

1. `docs/CLOUD-SYNC-STRATEGY.md` v2.0 — per-store merge rules (meds
   append-merge with `(deviceId, takenAt)` dedup), invariants F1 (±15-min
   cross-device collapse), F4 (`lastTakenAt` derivation from doseLog
   tail), F10 (deviceId stamping), F14 (1000-entry cap), F16 (clock-skew
   ±15-min clamp), F19a (refuse-writeback contract), F21 (structural
   exclusion). The tombstone-on-presets pattern is the precedent —
   re-read its section.
2. `docs/sync-impl/PLAN.md` — find the post-Stage-E follow-ups section.
   Add a row for `meds-dose-edit` if not already present; mark this PR
   as the work item.
3. `js/meds.js` — `createMed(id)` factory. Note the current `doseLog`
   shape: `[{ takenAt: ms, deviceId }]`. Note `logDose(takenAt)`,
   `undoLastDose()`, `recomputeLastTakenAt()`, `getDosesToday()`,
   `getStatusToday()`. **There is no entry-level `id` field today** —
   the dedup key is `(deviceId, takenAt)`. R2 / R6 below have to
   resolve whether edit semantics require introducing one.
4. `js/sync-merge-meds.js` — cloud-side `_mergeMeds` append-merge fn.
   Look at how it calls `MedsManager.reconcileDoseLog(med, incomingEntries)`
   and how `recomputeLastTakenAt` is re-derived per F4 after the
   union. The tombstone-aware union is the engine-side change.
5. `js/sync-merge-presets.js` — read the existing `deletedAt` field
   handling for tombstones. Same shape decision applies here. Note
   whether presets uses an additive field or also flips a `deleted`
   boolean.
6. `js/meds-ui.js` — current med-card rendering. Note that there is
   **no per-med dose history panel today**; doses are summarized
   ("Last dose at X PM", "1 of 2 today") but never enumerated for
   the user. R5 picks the surface where edit/delete buttons live.
7. `tests/meds.test.js` — 38 existing engine tests. Read the
   `reconcileDoseLog` test cases to understand the F1 collapse +
   F16 clock-skew + F14 cap test patterns. The new tests will
   extend those.

---

## What this PR ships (5 deliverables in one PR)

> All five are sketched at intent level. Concrete field names, surfaces,
> and merge edge cases are pinned down by Kyle in R1 → R10 below.

1. **`js/meds.js` engine extensions.**
   - New `createMed.editDose(originalTakenAt, originalDeviceId, newTakenAt)` —
     mutates the `(deviceId, takenAt)`-matched entry's `takenAt` to
     `newTakenAt`, re-sorts ascending, recomputes `lastTakenAt`. Returns
     `{ ok: bool, error?: string }`. Idempotent. Validates `newTakenAt`
     is finite, not in far-future per F16, and not older than the F14
     cap window.
   - New `createMed.deleteDose(takenAt, deviceId)` — marks the matched
     entry with a tombstone (field name + shape: R1). NOT a hard splice
     from the array — the entry stays present so it propagates as a
     tombstone via append-merge. Returns `{ ok: bool, error?: string }`.
     Idempotent (calling twice still tombstones the same entry, does
     not duplicate).
   - **R2 + R6 decision impact:** if R2 says edits need stable IDs, the
     two new methods take `entryId` as the key instead of
     `(deviceId, takenAt)`. Adjust signature accordingly. R6 then
     covers the `id` field's lazy-backfill on load for pre-PR doseLog
     entries.
   - `reconcileDoseLog(med, incomingEntries)` extended to merge
     tombstones (tombstone WINS over a live entry with the same key,
     symmetric — R3 covers the "two devices both delete same entry" /
     "one deletes, one edits" / "delete vs edit on same key" matrix).
   - `recomputeLastTakenAt` extended to skip tombstoned entries when
     deriving `lastTakenAt` (or relevant getter — see R4).
   - `getDosesToday`, `getStatusToday`, and any other doseLog
     consumers extended to ignore tombstoned entries.
   - F14 1000-entry cap: tombstones count toward the cap by default
     (additive bytes); R7 decides whether the cap window is widened
     and / or whether a GC pass removes tombstones older than N days
     (mirroring the presets backlog row).

2. **`js/sync-merge-meds.js` cloud-side merge extension.**
   - Cloud union step learns to carry tombstone field(s) from cloud
     records into the local merged record before the
     `reconcileDoseLog` call.
   - Per-record cloud-side F19a refuse-writeback gate stays as-is —
     tombstones are additive fields, so a downlevel client receiving
     a tombstoned record should still pass through F19a's
     "preserve future fields" contract. **R10 verifies the F19a path
     does not strip the tombstone field.**
   - `MedsManager.onMergeComplete(medId)` event flow unchanged: emits
     on the SyncEngine bus per existing contract; the per-surface UI
     re-render hooks in `js/meds-ui.js` (PR #78 pattern) pick up the
     change and re-render the med card.

3. **`js/meds-ui.js` UI surface — per-med dose history panel.**
   - New UI surface for enumerating doses (the surface where edit /
     delete buttons live). **R5 picks one of: (a) inline expandable
     dose history below the med card; (b) full-screen "Dose history"
     panel slide-up modal; (c) tap "Last dose at HH:MM" line to open
     a one-shot edit popover for the most recent entry only.** Default
     suggestion: **(b) full-screen panel** because it scales to weeks
     of history without crowding the med card.
   - Per-row UI: timestamp (Utils.formatMs-like absolute time +
     relative "2h ago"), deviceId origin (subtle "from iPhone" / "from
     this device" label so cross-device confusion is reduced), edit
     button (opens "took at ~" picker reusing the existing offset
     input pattern), delete button (destructive confirm — modal-or-
     swipe — R5b decides which UX).
   - Tombstoned entries are **hidden** by default with an "Show N
     deleted" toggle at the bottom for undo / audit. R8 finalizes
     whether undo (un-tombstone) is exposed or whether deletes are
     permanent from the UI's POV.
   - Live-update on `'merge-complete'` event for `store === 'meds'`
     while panel is visible (existing PR #78 pattern).

4. **`index.html` + `css/styles.css` markup + styles.**
   - New `<div id="meds-dose-history">` (or equivalent — R5 picks
     name) hooked into the `#meds-screen` panel. ARIA `role="dialog"`
     + `aria-modal="true"` + focus trap (standard pattern from the
     History panel).
   - Styles for the dose history list, edit modal, delete confirm,
     tombstone-greyed rows, "deleted" toggle. Follow the existing
     `.history-*` class naming convention to stay consistent with the
     History panel.

5. **Tests** — `tests/meds.test.js` extension.
   - New `describe('Edit + delete dose log entries')` block covering:
     editDose happy-path, editDose with stale `(deviceId, takenAt)`
     key (no-op + returns `{ ok: false, error: 'not_found' }`),
     editDose validates F16 future-clamp + F14 window-clamp,
     deleteDose happy-path + idempotency, tombstone+reconcile (delete
     local + cloud has live entry → tombstone wins), edit+reconcile
     (edit local + cloud has stale entry → newer `updatedAt` wins,
     dedup by R1's chosen key), tombstoned entries excluded from
     `getDosesToday` / `getStatusToday` / `recomputeLastTakenAt`,
     R3's edit-vs-delete conflict matrix (3-4 cases), R7's tombstone
     GC pass if it lands in this PR.
   - Target post-PR baseline: 628 → ~648 (+~20). Adjust if R2 or R6
     decisions inflate scope.

---

## Hard rules

- **Audit before code.** First commit is the audit doc at
  `docs/sync-impl/audits/meds-dose-edit-AUDIT.md`. STOP after the
  audit and wait for Kyle's review + blast-radius tier stamping.
  Expected tier: **Medium** (cross-cutting engine + UI + sync-merge,
  but additive — no breaking schema changes).
- **Web boot must not regress.** All new code is feature-additive.
  No `tempo_sync_enabled` flag changes. The new UI surface is
  unreachable from existing routes unless the dose history button
  is wired into a med card.
- **Reuse over re-implement (per CLAUDE.md § "Reuse over
  re-implementation").** Use `Utils.formatMs`, `escapeHtml` from
  `dom-utils.js`, `Platform.haptic` for destructive confirms,
  `Schema.SCHEMA_VERSION` + stamping helpers if schema is bumped
  (R9 decides). Do NOT introduce a new date formatter or HTML
  escaper.
- **F19a refuse-writeback contract.** Tombstone field must be
  treated as additive by all three F19a layers (snapshot
  dispatcher gate, per-merge-fn cloud-side gate, per-record CAS
  refuse-writeback). R9 + R10 finalize whether `SCHEMA_VERSION`
  bumps. If yes, downlevel clients should refuse the writeback,
  preserve the tombstone field, and emit the existing
  `'refuse-writeback'` event consumed by `Toast.downlevelWarning`
  (E-3).
- **No native iOS verification in scope.** Web-only verification
  via kapture. The native CAS + listener parity follow-up
  (backlog #2) is the right place to verify iOS doseLog
  tombstone propagation. This PR ships the tombstone shape; the
  native parity PR consumes it.
- **Service worker cache bump required.** `sw.js`
  `CACHE_NAME` bumps from `v90-rhythm-pillar` to
  `v91-meds-dose-edit` (or whatever the next bump string is).
  `pr-shipper` handles this.

---

## Open questions (R1 → R10) — Kyle to fill in before audit

> Each TODO below is a decision the audit + implementation depend on.
> Fill in the resolution inline, mark `R<N>: RESOLVED` once locked. The
> orchestrator will not dispatch the auditor until all R<N> blocks are
> resolved.

**R1 — Tombstone field shape.** What field(s) does a tombstoned dose
entry carry, and on which envelope level?

- TODO: pick one of: (a) entry-level additive `deletedAt: ms` on the
  doseLog entry; (b) entry-level `deleted: true` boolean + `deletedAt: ms`
  pair (matches some presets-style precedent — re-confirm against
  `sync-merge-presets.js`); (c) entry-level `tombstone: true` + `deletedAt: ms`
  + `deletedDeviceId: <id>` triple for audit clarity.
- Default suggestion: **(a) additive `deletedAt: ms`** — minimal bytes,
  presence-of-field is sufficient, matches the presets precedent.

**R2 — Stable entry IDs for edit semantics.** Today doseLog dedup key
is `(deviceId, takenAt)`. An edit that changes `takenAt` invalidates
the dedup key — cross-device, the edit could end up as
"delete-old + insert-new" which double-counts the dose if the
delete tombstone hasn't propagated yet.

- TODO: pick one of: (a) introduce a stable `id` field per doseLog
  entry (uuid generated at logDose time, backfilled lazily for
  pre-PR entries on first load), making `id` the new dedup key;
  (b) implement edit as "delete-old + insert-new" client-side,
  document the cross-device race as a known tradeoff; (c) restrict
  edit to NOT change `takenAt` (only edit a "note" field that
  doesn't exist yet — would force adding a note field, see R8).
- Default suggestion: **(a) stable `id`** because it's the cleanest
  long-term primitive and unlocks per-entry features later (notes,
  reminders, multi-dose-pack tracking). Backfill: on `loadState`,
  walk doseLog; any entry without `id` gets a new uuid + marker
  flag. Schema bump may be required — see R9.

**R3 — Edit-vs-delete cross-device conflict matrix.** Two devices,
same dose entry. Possible races:

- TODO: spell out the resolution for each:
  - A edits timestamp, B deletes → ? (tombstone wins?)
  - A deletes, B edits → ? (tombstone wins?)
  - A and B both edit to different timestamps → ? (LWW by `updatedAt`
    on the entry — but entries don't carry `updatedAt` today; see R6)
  - A and B both delete → ? (idempotent; first tombstone wins; both
    carry same `deletedAt` ≈ same time, doesn't matter)
- Default suggestion: **tombstone always wins**, edits LWW by
  per-entry `updatedAt` (forces R6).

**R4 — `lastTakenAt` derivation after delete.** When the most recent
dose is tombstoned, what does `getStatusToday` / `Last dose at HH:MM`
show?

- TODO: pick one of: (a) recompute from the next-most-recent live
  entry; (b) show "Last dose deleted — see history"; (c) show "No
  dose today" if no live entries remain today.
- Default suggestion: **(a) recompute from next-most-recent live
  entry** — keeps the existing F4 derivation working with a filter.

**R5 — UI surface.** Where does the dose history live, and how do
edit / delete buttons render?

- **R5a — Surface placement.** TODO: pick one of: (a) inline
  expandable list below each med card (tap "Last dose at X" to
  expand); (b) full-screen slide-up "Dose history" panel modal
  per-med (tap a "History" button on the med card); (c) one-shot
  edit popover on the "Last dose" line for the most recent entry
  only — no full enumeration.
- **R5b — Delete UX.** TODO: pick one of: (a) destructive confirm
  modal ("Delete this dose? This cannot be undone."); (b) swipe-
  to-delete with undo toast (mirroring lap delete from Phase 5);
  (c) trash icon → confirm prompt.
- Default suggestion: **R5a = (b) full-screen panel**, **R5b = (b)
  swipe-to-delete with undo toast** — both reuse established Tempo
  patterns.

**R6 — Per-entry `updatedAt` stamp.** Required for LWW edit
conflict resolution per R3.

- TODO: pick one of: (a) stamp `updatedAt: Date.now()` on every
  entry write (logDose + editDose + deleteDose), forcing schema
  bump; (b) rely on parent-record `updatedAt` for the whole med,
  accept that two edits within the same merge cycle on different
  devices is undefined (last-write-wins at the WHOLE-MED level);
  (c) special-case: only entries TOUCHED after this PR get
  `updatedAt`, pre-PR entries are LWW-immutable.
- Default suggestion: **(a) stamp on every entry write**, schema
  bumps (R9 reconciles).

**R7 — Tombstone retention / GC.** Tombstones accumulate forever
unless GC'd. Presets backlog has a deferred GC row.

- TODO: pick one of: (a) defer GC to a follow-up (matches presets
  posture); (b) ship a GC pass in THIS PR that removes tombstones
  older than 90 days (configurable constant); (c) cap tombstones
  at N per med (e.g., 100) with FIFO eviction.
- Default suggestion: **(a) defer GC** — matches the established
  posture for presets, smaller blast radius for this PR.

**R8 — Editable fields per dose entry.** Beyond `takenAt`, are there
other fields a user can edit?

- TODO: pick one of: (a) `takenAt` only; (b) `takenAt` + a new
  optional `note` field (per-dose context: "with food", "double
  dose by mistake"); (c) `takenAt` + `note` + `dose` override (in
  case the user took a half-dose / double-dose deviating from the
  med's default dose string).
- Default suggestion: **(a) `takenAt` only** for v1. Notes + dose
  override become follow-up PRs.

**R9 — `SCHEMA_VERSION` bump.** Does the meds store schema version
bump for this PR?

- TODO: pick one of: (a) bump (R1 + R2 + R6 add field(s) to entry
  shape that older clients don't know about — bump triggers F19a
  refuse-writeback on downlevel clients); (b) don't bump (tombstone
  + id + per-entry updatedAt are all additive, F19b "unknown
  fields preserved" covers it).
- Default suggestion: **(a) bump** — tombstones change SEMANTICS,
  not just data. A downlevel client receiving a tombstoned entry
  but not honoring `deletedAt` would resurrect the entry by
  counting it in `getDosesToday`. F19a refuse-writeback is the
  correct safety.

**R10 — F19a / F21 verification.** Confirm that the tombstone
field is NOT structurally excluded by F21 and IS preserved by F19a
across all three layers.

- TODO: walk the three F19a layers (snapshot dispatcher, per-merge
  cloud-side gate, per-record CAS) and confirm the tombstone field
  rides through. The audit doc lists the line numbers.
- Default suggestion: this should be a verification step in the
  audit, not a brand-new decision. **Mark RESOLVED if F19a's
  additive-field contract already covers it.**

---

## Deliverable

- Branch: `feat/sync-meds-dose-edit` (per CLAUDE.md sync-PR
  branch convention).
- Commit type: `feat` (new user-facing capability).
- One PR against `main`.
- Commits (expected, may consolidate):
  1. `docs(sync-impl): meds-dose-edit audit` — Phase 1 output.
  2. `feat(meds): editable + deletable dose log with sync tombstones (meds-dose-edit)` —
     engine + sync-merge work (Phase 2).
  3. `test(meds): edit + delete + tombstone reconcile coverage` —
     Phase 3 output.
  4. `feat(meds-ui): dose history panel with edit + swipe-delete` —
     Phase 4 output (if Phase 4 fires per audit).
  5. `chore: bump sw cache to v91-meds-dose-edit; update PLAN +
     SESSION-LOG + CLAUDE.md backlog row` — Phase 5 output.

PR title once shipped:
`feat(meds): editable + deletable dose log with sync tombstones`.

---

## TODO checklist before auditor dispatch

- [ ] R1 — Tombstone field shape resolved.
- [ ] R2 — Stable entry IDs decision resolved.
- [ ] R3 — Edit-vs-delete conflict matrix resolved.
- [ ] R4 — `lastTakenAt` derivation after delete resolved.
- [ ] R5a — UI surface placement resolved.
- [ ] R5b — Delete UX resolved.
- [ ] R6 — Per-entry `updatedAt` resolved.
- [ ] R7 — Tombstone retention / GC resolved.
- [ ] R8 — Editable fields per dose entry resolved.
- [ ] R9 — `SCHEMA_VERSION` bump resolved.
- [ ] R10 — F19a / F21 verification passes (audit-time check).
- [ ] Kyle has reviewed and committed this brief at
      `docs/sync-impl/prompts/meds-dose-edit-PROMPT.md` on a sandbox
      branch (e.g., `claude/orchestrator-meds-dose-edit`) before
      auditor dispatch.
