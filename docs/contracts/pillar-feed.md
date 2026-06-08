# Pillar-feed contract (generalized inbound-mart federation)

> **Status:** active · **Authored:** 2026-06-08 (Life-OS Phase 2) · **Canonical instance:**
> [`../reference/recovery-state-contract.md`](../reference/recovery-state-contract.md)
> (`recovery_state`).

## What this is

A **pillar-feed** is an *inbound* data feed: an **external Module** (a separate project Kyle
owns — e.g. `personal-health-elt`) publishes a small, purpose-built mart into Tempo's Firestore
so a Life-OS pillar can consume it. This document is the **generalized template** for that
federation pattern; each concrete feed (the first being `recovery_state`) has its own
per-mart contract that *instantiates* this template.

It is the counterpart to the [`synthesis-record`](synthesis-record.md) contract:

| | Direction | Producer | Consumer | Contract |
|---|---|---|---|---|
| **synthesis** | internal | a local **council** (Admin SDK) | `js/synthesis-feed.js` | [`synthesis-record.md`](synthesis-record.md) |
| **pillar-feed** | inbound (federated) | an **external Module** (Admin SDK) | a pillar's read-only feed (`js/recovery-feed.js`, …) | this doc + the per-mart contract |

Both share the same trust model — a **privileged writer** (Admin SDK, bypasses
`firestore.rules`) and a **read-only PWA consumer** — and the same one-way, no-merge,
silently-degrading discipline. The difference is *who* produces and *where the data
originates*: a council synthesizes Tempo's own records; a Module federates data from a
separate system.

## The federation pattern

```
external Module (its own repo, Postgres/dbt/…)        Tempo PWA (this repo)
  └─ materializes a small mart                           └─ read-only feed module
  └─ pushes via Firebase Admin SDK  ───────────────►       (getDoc → localStorage cache
     to users/{uid}/{feed}/…  (bypasses rules)              → synchronous getter for the UI)
```

- The Module owns the mart's schema and is **contract-tested on its side** (e.g.
  `personal-health-elt`'s dbt `accepted_values`/`unique` tests + a guard-mart-contract hook).
- Tempo reads **only the published feed**, never the Module's internal tables, and never the
  Module's code. Iterate behind the contract; changing the published shape is the one gated act.
- Raw source data stays in the Module (local Postgres/Docker). **Only the small mart egresses**
  to Firestore, scoped to Kyle's own auth `uid`.

## Path conventions

A feed lives under the owner's user document, in a feed-named subcollection:

```
users/{uid}/{feed}/{docId}
```

- `{feed}` is the mart name (e.g. `recovery_state`).
- `{docId}` is feed-defined. Two common shapes:
  - **latest + history** (the `recovery_state` shape): a `latest` doc holding the single most
    recent row, and a `history` doc holding `{ rows: [ …recent rows ] }`.
  - **per-key docs**: one doc per natural key (e.g. a date `YYYY-MM-DD`), the same shape
    Tempo's own synced stores use.

A per-mart contract MUST pin its exact doc ids + row schema (field names, types, units,
required-vs-optional, enum domains).

## Producer model

- The Module writes via the **Firebase Admin SDK** (service-account credentials), which
  **bypasses `firestore.rules`**. The same privileged-writer model the councils use.
- Writes are the raw row object(s) — there is **no sync envelope** (`deviceId`/`updatedAt`/
  `schemaVersion`) and no client-side merge. Freshness is conveyed by an in-row field (a `day`
  date or a `producedAt` timestamp), not a wrapper.
- **Producer-side failure alerting is mandatory** (the Module must shout if its push fails) —
  the PWA degrades silently and will never surface a stale-feed warning on its own.

## Consumer model (PWA, read-only)

Each feed gets a small read-only module mirroring [`js/recovery-feed.js`](../../js/recovery-feed.js):

- **Fetch gate** — fetch only when `SyncFlag.isEnabled()` **and** `SyncAuth.getCurrentUser()`
  returns a user with a `uid` **and** `SyncFirestore.getDoc` is present. Any miss → no network
  call.
- **Cache** — write the raw payload through to a per-doc `localStorage` key so the PWA has
  something to render offline. The render path reads the cache **synchronously**; the network
  fetch (`refresh`/`refreshAll`) runs **off-render** (boot / sign-in / auth-change).
- **No write path.** The Module is authoritative.
- **Silent degradation by design** — missing doc, malformed JSON, unknown enum value, offline,
  signed-out: all blank / neutral with **no error surfaced**. A consuming UI's empty state is
  the default path, never an error branch.

## Access control

The read-only guarantee is enforced in [`firestore.rules`](../../firestore.rules) the same way
for every inbound feed and for `synthesis`:

1. **Exclude the feed from the catch-all write grant** —
   `allow write: if isOwner(userId) && collection != '{feed}' && …`. This is the
   **load-bearing** part: Firestore evaluates grants *cumulatively*, so a broad
   `{docId=**}` write grant would otherwise re-grant what a narrower `if false` block cannot
   subtract.
2. **(Optional) a dedicated block** — `match /users/{userId}/{feed}/{docId} { allow read: if
   isOwner(userId); allow write: if false; }` — documents the intent; Admin-SDK writes still
   bypass it.

Until the carve-out is **deployed** (`firebase deploy --only firestore:rules`), a client could
in principle write the feed in prod — Admin writes remain safe regardless. Treat the deploy as a
gated prod action.

## Staleness

A feed conveys freshness through an in-row field (e.g. `recovery_state`'s `day`, or a
`producedAt`). Consumers derive "as of …" from that field versus calendar today; a mart is
expected to lag the calendar by a small, contract-stated window (e.g. 1–2 days). A stale-but-
present row is shown with an "as of …" qualifier, not treated as missing.

## Versioning / change policy

- The contract is **implicit and unversioned across two separate repos** — there is no
  negotiation channel.
- **Additive-only is safe** (a new optional field needs no coordination). **Renaming or
  removing** any consumed field, or changing an enum domain or the doc shape, is a **breaking
  change** that must be coordinated manually: update the Module *and* the Tempo consumer
  together, and bump the per-mart contract.
- A breaking upstream change is **invisible from inside Tempo** (it degrades silently), so the
  per-mart contract SHOULD ship a consumer-side fixture/contract test that fails loudly when the
  shape drifts.

## Registry of inbound feeds

| Feed | Module | Consumer | Pillar | Per-mart contract |
|---|---|---|---|---|
| `recovery_state` | `personal-health-elt` | `js/recovery-feed.js` | Physicals | [`../reference/recovery-state-contract.md`](../reference/recovery-state-contract.md) |

*(New externally-federated marts are added here as later pillars come online. The Physicals
pillar synthesizer, `council/lib/physicals-synthesizer.mjs`, consumes `recovery_state`
server-side via the Admin SDK and is the first real consumer beyond the read-only PWA feed.)*

## See also

- [`synthesis-record.md`](synthesis-record.md) — the internal, council-produced feed contract
  (the outbound counterpart to this inbound one).
- [`../reference/recovery-state-contract.md`](../reference/recovery-state-contract.md) — the
  canonical first instance of this template.
- [`../lifeos/integration-plan.md`](../lifeos/integration-plan.md) §5 — the federation /
  versioned-contract independence mechanism.
