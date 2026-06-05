# BFRB Closed Loop — Implementation Plan

**Milestone:** #16 (next-build, selected 2026-06-05 from `docs/brainstorm/2026-06-05-milestone-brainstorm-v2.md`).
**Branch:** `feat/bfrb-closed-loop` (off `main`).
**One-line:** Capture *why* a BFRB catch happened (urge intensity + one trigger chip) at the single
`logCatch()` chokepoint, then surface trigger patterns and a forgiving clean-streak in a new
order-45 Rhythm Insights panel.

This is **Slice A** — the pure, fully self-verifiable awareness + reinforcement half. The opt-in
real-time relapse-risk meter and the post-countdown "did it help?" debrief are **explicitly out of
scope** (deferred Slice B / phase 2).

---

## The one load-bearing correctness invariant

`js/sync-merge-bfrb.js` resolves a `(deviceId, takenAt)` collision by **keep-cloud** (the merge map
is seeded with cloud records first, then any local record whose sig already exists is *skipped* —
`sync-merge-bfrb.js:158-174`). There is **no `updatedAt` LWW** on collision.

Consequence: **a log-then-patch is unsafe.** If a bare catch logs and syncs to cloud, then the user
adds antecedent fields by re-writing that same local record, the next merge cycle re-seeds from the
cloud's *field-less* copy and silently drops the patch.

→ **The antecedent fields MUST ride the same single `BfrbEvents.log()` call.** No post-hoc patch.

This forces a **deferred-single-commit** capture flow (below) rather than the simpler
immediate-log-then-refine. The flow is engineered so a catch is *never lost*: every app-lifecycle
exit flushes the pending catch through exactly one `log()`.

---

## Forgiving clean-streak — the explicit rule (defined up front)

The streak must **not** be "days with no catch *logged*" — that rewards *not logging*, the opposite
of the goal. Instead the streak is a **fixed no-catch window of elapsed time**, derived purely from
the timestamp of the most recent catch:

- `hoursSinceLast = (now − lastCatchTakenAt) / 3_600_000` — the continuous current clean window.
- `cleanDays = floor(hoursSinceLast / 24)`.
- Hero shows `cleanDays` "days clean" when ≥ 1 day, else `round(hoursSinceLast)`h "since last catch".
- `longestCleanHours` = the largest gap between consecutive catches in full history, *including* the
  currently-open gap (`now − lastAt`).
- `recent7` = the last 7 local days, each `{ dateKey, isToday, catchCount, clean }` for the dot row
  (clean day → green dot; catch day → amber dot).
- No-data state (zero catches ever): neutral "—" with "Log a catch to start tracking" — zero catches
  is genuinely good, so the copy is encouraging, not a nag.

The streak reads the **live consolidated `BfrbEvents.getAll()` stream** (via `deps.getBfrbEvents`),
NOT `Analytics.getBFRBTrend` (which unions a session-snapshot path that cannot carry antecedents).

---

## Schema — additive, no version bump

Two **nullable additive** fields on a `bfrb_events` entry, both written *only* inside `log()`:

| field | type | values | written when |
|-------|------|--------|--------------|
| `urgeLevel` | integer | 1 \| 2 \| 3 | `opts.urgeLevel` is a number in [1,3] |
| `triggerZone` | string | conservative chip set (UI-owned) | `opts.triggerZone` is a non-empty string (trimmed, length-capped) |

- **No `Schema.SCHEMA_VERSION` bump** — old clients ignore unknown fields; new fields are nullable.
- The dedup sig `_sigOf = (deviceId, takenAt)` is **unaffected** (reads only `deviceId` + `takenAt`).
  Locked by a test asserting sig invariance with/without the new fields.
- `log()` also gains an optional `opts.takenAt` override (defaults to `Date.now()`), required by the
  deferred commit so the persisted `takenAt` is the *catch* moment, not the commit moment. Also makes
  tests deterministic.

The taxonomy strings are **UI-owned** (a `TRIGGER_CHIPS` const in `global-bfrb.js`). The engine stores
whatever string it's given — so the one human-ratification residue (are these the right ~4 labels for
a real person in BFRB recovery?) lives entirely in the UI, not the engine.

---

## Capture UX — deferred single commit (no patch, never lose a catch)

State lives in `global-bfrb.js`: `let pending = null` (at most one uncommitted catch).

1. **Tap FAB / press `B`** → `logCatch()`:
   - `commitPending()` first (flush any prior pending catch — no loss, counts stay correct).
   - Build `pending = { takenAt: Date.now(), context, sessionId?, phase?, cycleIndex?, urgeLevel: null, triggerZone: null }`.
   - `Platform.haptic(20)` + `BFRBRecovery.start(...)` **immediately** (the therapeutic interrupt is
     unchanged and instant; the countdown hides the FAB count, so deferral is invisible).
   - Render the inline chip popover anchored above the FAB.
   - Arm an auto-commit fallback timer (15 s — comfortably inside the 60 s countdown).
2. **Chip taps** mutate `pending.urgeLevel` / `pending.triggerZone` (toggle selected state); a tap
   re-arms the idle timer. The popover has a **"✓ Done"** (commit now) and the catch is implicitly
   logged regardless — chips are *optional*. One-tap-and-ignore still logs (field-less) via fallback.
3. **`commitPending()`** = exactly one `BfrbEvents.log({ ...pending })`, then clear `pending`, hide
   the popover, `renderLabel()`. Idempotent (`if (!pending) return`).
4. **Guaranteed flush hooks** (so a catch is never lost): `pagehide`, `visibilitychange→hidden`,
   `beforeunload`, route `hashchange`, a new catch, the auto-commit timer, and explicit "Done".

This keeps the hot path frictionless (one tap = instant haptic + countdown), the fields on a single
`log()`, and zero catch loss across tab-close / background / navigation.

---

## New panel — `js/rhythm-panel-bfrb-triggers.js` (order 45)

Self-registers via `RhythmInsights.register`. Order 45 sits right after BFRB Frequency (40) and is
free (orders in use: 5,10,20,30,40,50,60,70). Pure: `build(deps)` reads only `deps.getBfrbEvents()`
+ `deps.now()`; `render(model)` returns one `RI.card` and never throws.

Card body:
1. **Forgiving clean-streak hero** — reuses the `.analytics-streak-*` CSS (hero number + label + sub
   + 7 dots). Clean day → `.analytics-streak-dot-on` (green); catch day → new `.bfrb-streak-dot-catch`.
2. **Top triggers leaderboard** — `triggerZone` breakdown over the last 14 days, reusing
   `.analytics-distraction-row/-label/-bar/-count`; an "untagged" row when some catches have no chip.
3. **Urge mix** — a compact mild/medium/strong tally (only when any urge data exists).

Empty state: when there are no catches in 14 days AND no streak data → `RI.empty(...)`.

---

## Lockstep housekeeping (same PR)

- `index.html`: add `<script src="js/rhythm-panel-bfrb-triggers.js">` after `bfrb-frequency` (before
  `rhythm-ui.js`); add the capture-popover container near the FAB.
- `tests/index.html`: add the panel `<script>` + the new test `<script>`.
- `CLAUDE.md`: add the module to the script-load-order block + the file-map.
- `sw.js`: bump `CACHE_NAME` (`stopwatch-v110-rhythm-insights-foundation` → `stopwatch-v111-bfrb-closed-loop`).
- `css/styles.css`: capture popover + chips + the catch-dot modifier.

> Note: this branch is off `main`, so its `CACHE_NAME` base is `v110` (the `v111-tempo-coach` bump
> lives on the unmerged #15 branch). At merge time the two `v111-*` names conflict trivially; resolve
> by picking a single final name.

---

## Tests (browser-run via `tests/index.html`)

- `tests/bfrb-events.test.js` (extend): `log()` persists `urgeLevel`/`triggerZone` when valid, omits
  them when absent/invalid; `opts.takenAt` override; **sig invariance** — `(deviceId, takenAt)` and the
  derived doc id are byte-identical with vs without the new fields; future-field values are rejected
  (urge 0/4/'x', empty/over-long triggerZone).
- `tests/bfrb-triggers.test.js` (new): registration at order 45; trigger leaderboard counts + untagged
  bucket; urge mix; **forgiving-streak math** — `hoursSinceLast`/`cleanDays`/`longestClean`, the
  no-catch-logged-today does NOT inflate the streak, empty/sparse/all-in-one-day fixtures; `render()`
  never throws on empty/missing model; reads the live store (not a snapshot).

Canonical run: `python3 -m http.server` + open `tests/index.html` in a real browser (kapture), read
the page's self-reported PASS/FAIL. `node --check` is the cheap syntax gate.

## Visual verify (kapture, 390px, fresh port to dodge stale SW cache)

Log a catch with chips → open Rhythm › Insights → confirm the triggers panel renders the streak hero +
leaderboard across populated / sparse / empty states; confirm the one-tap-no-chip path still logs.

## Autonomy split

Self-verifies: engine fields + sig invariance + streak math + panel render (engine tests + kapture).
Human-only residue: ratify the ~4 `TRIGGER_CHIPS` labels + urge wording for a real BFRB-recovery user
(a bounded copy sign-off, not a structural blocker) — shipped behind a conservative default taxonomy.
