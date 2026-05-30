# Playbook — Rhythm readiness band is blank or stale

- **Symptom:** The Rhythm tab's readiness band shows nothing, or shows an old `· as of <date>` suffix.
- **Severity:** Almost always benign. See the framing below before you start debugging.
- **Authoritative source:** [`../reference/recovery-state-contract.md`](../reference/recovery-state-contract.md). This playbook is its operator-facing triage front-end — it does not restate the contract, it routes you through it.

## The one thing to internalize first

**Every blank or stale state here is silent by design.** There is no error, no
toast, no console diagnostic. The `RecoveryFeed` module documents this in its own
header comment — it "degrades silently" across a known set of conditions
(`js/recovery-feed.js:14-18`). So "the band is blank" is *not* a crash report; it
is one of a small set of benign conditions until proven otherwise.

The corollary, and the real risk: because failure is silent, a **breaking
upstream shape change is invisible from inside Tempo** — the band just blanks
with no diagnostic (`../reference/recovery-state-contract.md` §*Contract risk —
silent degradation*, lines 186-192). If you exhaust the benign conditions below
and the band is still blank, that is the case to suspect. Skip to
[§Nothing benign applies](#nothing-benign-applies).

The band is a **read-only** consumer of an external pipeline. Tempo never writes
`recovery_state` (`docs/adr/0003-firestore-sync-backend.md:30`,
`docs/diagrams/data-topology.mmd:30`,`55-56`). It has no control over whether a
row exists — only over whether it can fetch and render one.

## Silent-degrade matrix (the benign set)

These are the conditions under which the band renders nothing — no error — and
each is expected behavior, not a bug. The contract owns the canonical table
(`../reference/recovery-state-contract.md:157-169`); reproduced here as the
triage checklist:

| Condition                        | Cause                                   | Band result                                            |
|----------------------------------|-----------------------------------------|--------------------------------------------------------|
| Sync flag off                    | User hasn't opted into cloud sync       | `_canFetch` → null; a prior cached row may still show  |
| Signed out                       | `getCurrentUser()` is null              | `_canFetch` → null; sign-out also clears the cache     |
| No doc yet                       | Pipeline hasn't pushed for this user    | `getDoc` returns `data: null`; cache left untouched    |
| Offline                          | Network gone                            | Cached value still serves the band                     |
| Future / non-today day selected  | Mart only describes the past            | Band hidden                                            |
| Stale latest row (`day` < today) | Mart lags 1–2 days behind the calendar  | Band shows the row with an `· as of …` suffix          |

Work the decision tree below top to bottom. The first match is your answer.

## Decision tree

### 1. Is cloud sync enabled AND the user signed in?

This is the most common cause. `RecoveryFeed` gates every fetch on a
three-condition check before it touches the network (`_canFetch`,
`js/recovery-feed.js:53-60`):

1. `SyncFlag.isEnabled()` is true (`js/recovery-feed.js:54`),
2. a `SyncAuth` singleton with `getCurrentUser` is present
   (`js/recovery-feed.js:55`),
3. `SyncAuth.getCurrentUser()` returns a user with a `uid`
   (`js/recovery-feed.js:57-58`).

Any condition false → `_canFetch()` returns `null` → `refresh()` short-circuits
and makes **no network call** (`js/recovery-feed.js:97-98`). The band may still
show a previously cached row, or nothing if the cache is empty.

**Check:** open the settings drawer — is "Enable cloud sync" on, and is an
account signed in? If either is off, that is the answer. (Note: signing *out*
also wipes the cache, so the band goes blank immediately — see
[§Refresh behaviour](#refresh-behaviour-the-non-obvious-nuance).)

### 2. Has the external pipeline actually pushed a row for this user?

Tempo cannot tell this from the inside. The `recovery_state` documents are
written by an **external** repo, `personal-health-elt`, via the Firebase Admin
SDK — a separate codebase with no negotiation channel back to Tempo
(`../reference/recovery-state-contract.md:207-213`,
`docs/diagrams/data-topology.mmd:55`).

When the `latest` doc doesn't exist yet, `SyncFirestore.getDoc` resolves with
`data: null`. `refresh()` then leaves the cache **untouched** (the write-through
is guarded by `if (latestSnap && latestSnap.data)`, `js/recovery-feed.js:107-110`)
and returns `null` (`js/recovery-feed.js:119`). With no cached row,
`getLatest()` returns `null` and `paintReadiness` hides the band entirely
(`js/recovery-feed.js:66-68`, `js/rhythm-ui.js:148`,`169-173`).

**Check:** if sync is on and signed in but the band has *never* appeared on this
account, the pipeline likely hasn't pushed for this `uid`. There is no in-app
way to confirm — verify in the `personal-health-elt` repo / Firestore console
that `users/{uid}/recovery_state/latest` exists.

### 3. Is the selected day in the future, or today with no data?

The Rhythm day-picker allows forward navigation, but the mart only describes the
past. `paintReadiness` hides the band outright when the active day is after today
(`js/rhythm-ui.js:131-140` — ISO `YYYY-MM-DD` strings compare lexicographically
the same as chronologically). A future-dated `latest` row (clock skew or a test
fixture) is also bailed out rather than shown (`js/rhythm-ui.js:149-156`).

**Check:** tap the `‹` / `›` day-nav back to **Today**. If the band returns,
you were simply on a future day — working as designed.

### 4. Stale-but-present — the `· as of <date>` case

This is *not* a failure. The mart's newest `day` commonly lags the calendar by
1–2 days (the Apple Health export hasn't loaded, or the dbt build hasn't run
today). Rather than hide a usable signal, the band renders the most-recent row
with a relative-date suffix (`js/rhythm-ui.js:144-158`, suffix built by
`formatStaleDate`, `js/rhythm-ui.js:107-121`). So `· as of yesterday` /
`· as of 2d ago` is the mart lagging, **not** a Tempo bug.

**Check:** if the band is present but suffixed `· as of …`, nothing is broken on
the Tempo side. If freshness matters, the fix is upstream — get
`personal-health-elt` to push a row for today.

### 5. Malformed cache — band hides instead of throwing

If the cached JSON is corrupt, `_readJSON` catches the parse error and returns
`null` rather than throwing (`js/recovery-feed.js:27-35`). Downstream,
`getLatest()` / `getDayRow()` return `null` and the band hides
(`js/rhythm-ui.js:169-173`). A bad cache will self-heal on the next successful
`refresh()`, which overwrites both keys.

**Check / fix:** inspect (and, if corrupt, clear) the two cache keys —
`tempo_recovery_state_latest` and `tempo_recovery_state_history`
(`js/recovery-feed.js:20-21`). Clearing them, then triggering a refresh (sign-out
→ sign-in, or reload while signed in), re-pulls clean copies.

## Inspecting the cache directly

The band renders **entirely from the localStorage cache** — `getLatest()`,
`getHistory()`, and `getDayRow()` are synchronous cache reads, never live
Firestore calls (`js/recovery-feed.js:64-85`). So the cache is the ground truth
for what the band *can* show:

| Key                              | Holds                                            | Read by                         |
|----------------------------------|--------------------------------------------------|---------------------------------|
| `tempo_recovery_state_latest`    | The single most-recent day row (object)          | `getLatest()` (`js/recovery-feed.js:66-68`) |
| `tempo_recovery_state_history`   | `{ rows: [ …last ~14 days ] }`                   | `getHistory()` / `getDayRow()` (`js/recovery-feed.js:71-85`) |

In the browser console:

```js
JSON.parse(localStorage.getItem('tempo_recovery_state_latest'))
// → { day: "2026-05-29", recovery_signal: "neutral", hrv_ms: …, … } | null
```

- `latest` present with `day` ≈ today → band should render. If it doesn't,
  re-check the day-picker is on Today (step 3).
- `latest` present with an old `day` → expect the `· as of …` suffix (step 4).
- `latest` is `null` → step 1 (gate closed / signed out cleared it) or step 2
  (pipeline never pushed).

The row's consumed shape (`day`, `recovery_signal`, `hrv_ms`, `acwr`, `rhr_bpm`)
and the `recovery_signal` enum are pinned in
[`../reference/recovery-state-contract.md`](../reference/recovery-state-contract.md)
§*Row schema*. An unknown `recovery_signal` does **not** blank the band — it
falls through to `insufficient_data` (white circle) and still renders
(`js/rhythm-ui.js:175-179`).

## Refresh behaviour (the non-obvious nuance)

`RecoveryFeed.refresh()` is triggered only on a small set of events
(`init`, `js/recovery-feed.js:132-155`):

- **Sign-in** (`auth-change` with a user) → `refresh()`
  (`js/recovery-feed.js:141-143`; the event is emitted from
  `js/sync-auth.js:57-58`).
- **Boot while already signed in** → a best-effort `refresh()`
  (`js/recovery-feed.js:151-154`).
- **Sign-out** (`auth-change` with null) → `_clearCache()`, so a different
  account's stale band can't bleed through (`js/recovery-feed.js:144-147`).

**There is no tab-refocus / `visibilitychange` auto-refresh, and no polling.**
This matters operationally: if the pipeline pushes a fresh row *mid-session*, the
band will **not** update until the next refresh trigger — i.e. a sign-out/sign-in
cycle or a full page reload. "The band is a day behind even though the pipeline
ran" is therefore expected between refresh triggers, not a bug. The fix is a
reload, not a code change.

## Nothing benign applies

If you've ruled out steps 1–5 — sync is on, signed in, on Today, the pipeline
*has* pushed (verified in Firestore), the cache parses cleanly, and you've
reloaded to force a fresh `refresh()` — and the band is **still** blank, suspect a
**breaking upstream shape change**.

Because the contract is implicit and has no compile-time link between the two
repos, renaming `day`, `recovery_signal`, `hrv_ms`, `acwr`, or `rhr_bpm`, or
changing `history` away from `{ rows: [...] }`, produces **no error** — the band
just hides or drops readouts (`../reference/recovery-state-contract.md:186-192`,
`:217-224`). Specifically: if the new payload no longer carries a `day` field,
`paintReadiness` hides the band on the falsy-`day` guard
(`js/rhythm-ui.js:169-173`); if `history` is no longer `{ rows: [...] }`,
`getDayRow` returns `null` for every past day (`js/recovery-feed.js:82-84`).

**Action:** check the `personal-health-elt` repo for a recent change to
`mart_recovery_state`'s output shape. Coordinate the fix upstream — Tempo will
not warn you, by design.

## See also

- [`../reference/recovery-state-contract.md`](../reference/recovery-state-contract.md)
  — the authoritative contract this playbook fronts (silent-degrade matrix,
  failure modes, row schema, versioning policy).
- [`../adr/0003-firestore-sync-backend.md`](../adr/0003-firestore-sync-backend.md)
  — ADR 0003, the Firestore backend decision and the `recovery_state` read-only
  carve-out (`docs/adr/0003-firestore-sync-backend.md:30`,`65`).
- [`../diagrams/data-topology.mmd`](../diagrams/data-topology.mmd) — where
  `recovery_state` sits in the data flow (external Admin-SDK write → Firestore →
  `RecoveryFeed` cache → band).
