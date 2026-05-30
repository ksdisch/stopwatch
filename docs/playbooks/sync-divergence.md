# Playbook: two devices disagree, a record looks lost, or iOS is behind

- **Status:** Living playbook (written 2026-05-30)
- **Scope:** Cloud sync only — the six Firestore-synced stores. Local-only state (Pomodoro/Flow engine config, cooking timers, Todoist linkage) never syncs and is out of scope.
- **Audience:** the solo maintainer triaging a "my phone and laptop don't match" report against the merge layer.

This is the densest of the sync playbooks because most "divergence" reports are
**not bugs** — they are one of four documented, by-design behaviors of the
per-store merge model. The job of this playbook is to tell the expected cases
apart from a genuine lost write before you reach for a postmortem. Read it
alongside the merge-strategy ADR (`../adr/0004-per-store-merge-strategy.md`) and
the native-deferral ADR (`../adr/0009-defer-native-cas-listener-parity.md`); the
decision flow is drawn in `../diagrams/merge-decision.mmd` and the lifecycle in
`../diagrams/state-sync.mmd`.

## Symptom set

You are in the right playbook if a user reports any of:

- **Post-offline disagreement.** Both devices edited (often while offline) and after reconnecting they still don't agree.
- **An edit "vanished."** A tag, a note, a med-metadata change, or a preset rename that was definitely made no longer shows.
- **iOS lags well behind web.** The iPhone shows data minutes stale relative to the desktop, or a cross-device write takes "forever" to appear on native.
- **A logged event looks missing.** A dose, a nap, a BFRB catch, or a distraction entry that one device recorded isn't visible on the other.

Three of these four are *expected* under specific conditions. The fourth — a
truly vanished append-only event — is the only one that warrants a postmortem.

## The merge model in one paragraph

Conflict resolution is defined **per store, per record** — there is no global
last-write-wins. Six stores sync (`meds`, `history`, `rest_log`, `presets`,
`bfrb_events`, `distractions`), enumerated in the hardcoded `SYNCED_STORES`
registry (`../../js/sync-engine.js:138-145`), and each has its own bespoke merge
module (`js/sync-merge-*.js`). Two merge *shapes* exist. **Editable
metadata, presets, and the history record envelope** use **LWW by `updatedAt`,
cloud wins on tie** — the higher-timestamp record overwrites the lower one
wholesale. **Event streams** — med `doseLog`, `naps`, `bfrb_events`,
`distractions`, and history's nested `phaseLog` — use **append-merge with
dedup, never LWW**: entries union by a stable signature so the slower device's
events are added, not overwritten. The full per-store rule table is ADR 0004
(`../adr/0004-per-store-merge-strategy.md`) and the F-invariant strategy table is
`../CLOUD-SYNC-STRATEGY.md`; the wire envelope and per-store keys are in
`../reference/data-dictionary.md`.

The reason this distinction matters for triage: under LWW, **a competing edit is
supposed to lose** — that is not a bug. Under append-merge, **nothing is ever
supposed to be dropped** — a missing event there *is* a bug.

## Known, expected divergence sources (read this before suspecting a bug)

### 1. History note/tags LWW is record-level, not per-field

**What the user sees.** Device A edits a session's *tag*; Device B edits the same
session's *note* a few seconds later. After sync, only B's note edit survives and
A's tag edit is gone — even though they touched different fields.

**Why it's by design.** The history merge resolves a colliding session record by
whole-record LWW on `updatedAt`, cloud wins on tie — it does **not** diff
field-by-field. The caveat is documented verbatim in the merge module header
(`../../js/sync-merge-history.js:49-52`): "If Device A edits a tag at T=100 and
Device B edits a note at T=110, B's note edit wins on the WHOLE record — A's tag
edit is lost." Per-field stamping is an explicitly deferred follow-up, recorded
as an accepted data-loss window in ADR 0004's Negative/tradeoffs section
(`../adr/0004-per-store-merge-strategy.md` → "History note/tags LWW is
record-level, not per-field"). The strategy table calls for per-field LWW here
(`../CLOUD-SYNC-STRATEGY.md`) and it ships later.

**Triage verdict.** Expected. Not a bug. The losing edit is gone and is not
recoverable from cloud — the window is narrow (two devices editing the *same*
session within the same sync cycle) and accepted for solo use.

### 2. Native CAS + listener gap — iOS is structurally behind

**What the user sees.** The iPhone is minutes stale relative to web; a desktop
write takes up to ~5 minutes to surface on native; web-to-web propagation feels
near-instant by comparison.

**Why it's by design.** Two Firestore primitives are **web-only**. The
transactional CAS gate (`runTransaction`) and the real-time listener
(`subscribe`/`onSnapshot`) both throw a typed "native parity pending" error on the
`@capacitor-firebase/firestore` branch
(`../../js/sync-firestore.js:339` for `runTransaction`,
`../../js/sync-firestore.js:431` for `subscribe`). With no listener, native has no
real-time push — it relies entirely on the defensive poll, which fires every
`STEADY_STATE_DEFAULT_MS = 300000` ms (5 minutes;
`../../js/sync-engine.js:99`) — and writeback degrades to plain per-record
`setDoc` with no atomic write-race gate. The full decision is ADR 0009
(`../adr/0009-defer-native-cas-listener-parity.md`) and it's tracked as backlog
row #3 in `../../CLAUDE.md`. Append-merge correctness still holds on native — only
*latency* (real-time → 5 min) and *atomicity* (CAS gone) degrade.

**Triage verdict.** On native, "behind by a few minutes" is expected, not
divergence. **Wait one full 5-minute poll cycle before suspecting anything.** If
both devices still disagree after a poll tick *and* the disagreement is in an
append-only stream, then escalate.

### 3. F19a future-record skip — a newer device's record won't propagate down

**What the user sees.** A record edited on a device running a *newer* schema
version appears to "not propagate" to an older device — the older client never
shows it, or shows a stale prior version.

**Why it's by design.** A downlevel client refuses to write back any record
stamped with a higher `schemaVersion` than it understands. `Schema.isFutureRecord`
returns true only for a finite numeric `schemaVersion` strictly greater than the
local `SCHEMA_VERSION` (`../../js/schema.js:38-42`; `SCHEMA_VERSION = 1` at
`../../js/schema.js:30`), and `Schema.stamp` refuses to downgrade such a record on
roundtrip (`../../js/schema.js:52-57`). This is the F19a mixed-version-safety
guard: with GitHub Pages auto-deploy and a separate iOS release cadence, the two
devices a single user owns can run different schema versions at once, and a blind
writeback by the older client would strip every field it doesn't recognize. The
guard runs at three layers (cloud-side pre-filter, local-side filter, and — on
web — the CAS refuse-writeback gate); see ADR 0004's "F19a future-record guard"
discussion (`../adr/0004-per-store-merge-strategy.md`).

**Triage verdict.** Expected whenever the two devices are on different schema
versions. The record is preserved byte-clean for the newer client; it simply
won't surface on the older one until that client updates. Not a bug.

### 4. Pre-E-1e rest_log / presets records lacked `updatedAt` stamps

**What the user sees.** Old sleep entries or presets created *before* cloud sync
shipped don't converge cleanly across devices — whichever device authored them
locally "wins" rather than a clean timestamp-based merge.

**Why it's by design.** The `rest_log` sleep LWW resolves by `updatedAt`, treating
an absent stamp as `-Infinity` so the side *with* a stamp always wins — and
pre-E-1e sleep entries had no envelope at all (`../../js/sync-merge-rest-log.js:9-15`,
Risk #1/#2 in that header). For that pre-sync window the fallback is
single-device convergence, documented as a tradeoff in ADR 0004
(`../adr/0004-per-store-merge-strategy.md` → the rest_log/presets pre-E-1e note).

**Triage verdict.** Expected for data created before sync existed. Re-saving the
entry on one device stamps it and lets normal LWW take over from there.

## Triage steps

Run these in order. Most reports resolve at step 1 or 2.

1. **Confirm sync is actually on for BOTH devices.** Sync requires four
   conditions, gated by `_maybeAutoStartSteady` (`../../js/sync-engine.js:241-256`):
   the master flag `SyncFlag.isEnabled()` (`tempo_sync_enabled === '1'`) is on,
   the user is signed in, hydrate has fully completed
   (`tempo_sync_hydrated_all === '1'`, checked via `isAllHydrated()`), and there
   is no pending Stage-D handoff (`getStageDHandoff()` false). If **either** device
   fails any of these, it isn't merging — that, not the merge logic, is your
   divergence. Check `localStorage.tempo_sync_hydrated_all` on each device first.

2. **On native, wait one 5-minute poll cycle before suspecting a bug.** There is
   no real-time listener on iOS (source #2 above) — propagation waits for the next
   `STEADY_STATE_DEFAULT_MS = 300000` ms poll (`../../js/sync-engine.js:99`).
   Backgrounding/foregrounding the app or toggling network can trigger a catch-up,
   but a fresh write simply isn't expected to appear on native for up to five
   minutes.

3. **Check the console for the coalesced reconcile summary.** A history merge that
   resolved id collisions logs a single line at the end of the cycle:
   `[SyncEngine] reconcile history: N sessionId collision(s) resolved cloud-wins; ids=[…]`
   (`../../js/sync-engine.js:1285-1287`, emitted from `_mergeHistory` at
   `../../js/sync-engine.js:1246`). This was coalesced from per-collision warnings
   in the 2026-05-17 race-fix work (commit `64623e3`). If you see it, the engine
   *did* reconcile and "cloud wins" is the intended outcome — the local edit it
   displaced is the expected LWW loss from source #1, not a dropped write.

4. **For imported pre-sync data, the Stage-D handoff owns the merge.** If a device
   carried local data from before it ever synced, the all-hydrated short-circuit
   defers to the Stage-D reconcile path rather than blindly pulling cloud over
   local — it sets `tempo_sync_stage_d_handoff = '1'` and returns without flipping
   sync state (`../../js/sync-engine.js:853-856`). While that flag is set,
   steady-state does **not** auto-arm (`getStageDHandoff()` short-circuits
   `_maybeAutoStartSteady`, `../../js/sync-engine.js:246`). Divergence on a device
   mid-handoff is expected until the import reconcile completes.

5. **Remember append-only streams UNION — a "missing" event should reappear.** A
   dose, nap, BFRB catch, or distraction that's absent on one device should appear
   after the next merge cycle, because those stores append-merge and never LWW
   (`../../js/sync-merge-rest-log.js:9-15` for naps; the dose/BFRB/distraction
   dedup rules are in ADR 0004, `../adr/0004-per-store-merge-strategy.md`). Give it
   one merge cycle (instant on web, up to 5 min on native). **If the event truly
   vanished after a clean merge cycle on both devices — that is a real bug** and
   the only symptom in this playbook worth a postmortem, because append-merge has
   no code path that is *supposed* to drop an event.

## Escalation

If you reach step 5 and an append-only event genuinely disappeared after a clean
merge on both devices, you have a real merge bug — escalate to a postmortem. The
worked example of how these surface and get fixed is the **2026-05-17 race-fix
cluster** (`../postmortems/2026-05-17-cloud-sync-race-fix-cluster.md`): five
sync fixes landed that day, three of them relevant here — the `SyncAuth.signIn`
timeout race and stale-error
self-heal (commit `40df03d`), coalescing the reconcile-history collision warnings
into the single summary log you check in triage step 3 (commit `64623e3`), and
making Push skip the Stage-D handoff when cloud holds only this-device writes
(commit `f2eed1e`). That cluster is the template: reproduce with two tabs, watch
the reconcile summary log, and isolate which store's merge dropped the entry.

## See also

- `../adr/0004-per-store-merge-strategy.md` — the per-store, per-record merge decision and every store's rule.
- `../adr/0009-defer-native-cas-listener-parity.md` — why native runs the degraded 5-min-poll path.
- `../diagrams/merge-decision.mmd` — the LWW-vs-append-merge decision flow.
- `../diagrams/state-sync.mmd` — the hydrate → steady-state → merge lifecycle.
- `../postmortems/2026-05-17-cloud-sync-race-fix-cluster.md` — the worked escalation example.
- `../reference/data-dictionary.md` — the sync envelope and per-store record shapes.
- `../CLOUD-SYNC-STRATEGY.md` — the F-invariant strategy table (F1/F4/F15/F16/F19a).
