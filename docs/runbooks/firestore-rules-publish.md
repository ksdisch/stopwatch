# Runbook: publish Firestore security rules

- **Status:** Active runbook, written 2026-05-30
- **Trigger:** Any change to `firestore.rules`, or a need to confirm what is actually enforcing in production.
- **Cadence:** Manual. There is no CI job that publishes or diffs these rules — see [The drift risk](#the-drift-risk-read-this-first) below.

## The drift risk (read this first)

The committed `firestore.rules` and the rules **actually enforcing in the
`tempo-sync-6f7b2` Firestore project are two separate sources of truth, kept in
sync only by a human running the deploy below.** Nothing automatic reconciles
them:

- **No CI publishes the rules.** The `firestore-rules` CI job
  (`.github/workflows/ci.yml`, `tests/rules/firestore-rules.test.mjs`) unit-tests
  the *committed* ruleset against the emulator — but it is a verification gate,
  not a deploy, and it cannot tell whether the live project matches. Merging a
  `firestore.rules` change to `main` deploys the *web app* via GitHub Pages
  (`CLAUDE.md` Deployment section), but it does **not** touch Firestore. The new
  rules sit dormant in git until someone runs `firebase deploy`.
- **No CI diffs the rules.** There is no job that fetches the live ruleset and
  asserts it matches the committed file. A live/repo divergence is invisible from
  inside the toolchain.
- **The Console can hot-edit live rules out from under git.** Rules can be edited
  directly in the Firebase Console Rules editor and published from there. A
  Console edit takes effect immediately and is **never written back** to
  `firestore.rules` in the repo.

So the two failure modes to keep in mind:

| You did this | What's now true |
|---|---|
| Edited `firestore.rules`, merged, did **not** run the deploy | Repo is ahead. Production still enforces the **old** rules. |
| Hot-edited rules in the Console | Production is ahead. The repo file is **stale** and a later `firebase deploy` will silently **revert** the Console edit. |

The rule of the road: **after any rules change, run the deploy below from the
committed file, and after any Console hot-edit, copy the change back into
`firestore.rules` and commit it.** Treat the committed file as the canonical
source and the deploy as the one mechanism that makes it real.

## Where the rules live

| Artifact | Path | Notes |
|---|---|---|
| Rules source | `firestore.rules` | 19 lines, committed at repo root. The only ruleset. |
| Firebase project map | `firebase.json` | 6 lines — maps `"rules": "firestore.rules"` and `"indexes": "firestore.indexes.json"` (`firebase.json:3-4`). |
| Indexes | `firestore.indexes.json` | Empty — `"indexes": []`, `"fieldOverrides": []` (`firestore.indexes.json:2-3`). No composite indexes are defined or needed. |
| Project alias | *(none)* | **There is no `.firebaserc` in the repo.** A clean checkout has no default project, so every deploy must pass `--project` explicitly. |

The Firebase project id is **`tempo-sync-6f7b2`**
(`js/sync-firebase-config.js:15`; `authDomain` at `js/sync-firebase-config.js:14`
is `tempo-sync-6f7b2.firebaseapp.com`). That config is the public web client
config — it identifies the project but grants no access; access control is the
rules themselves (`js/sync-firebase-config.js:3-6`).

Because no `.firebaserc` is committed, do **not** rely on a remembered
`firebase use` alias from a previous session — pass the project id on every
command. (The older setup doc at
[../sync-impl/FIREBASE-SETUP.md](../sync-impl/FIREBASE-SETUP.md) uses
`firebase use tempo-sync-6f7b2` followed by a `firebase deploy --only firestore:rules`; that writes
a local `.firebaserc` that is **not** in version control, which is exactly why
the explicit-`--project` form below is the reliable one for a fresh clone.)

## Deploy (the canonical path)

Prerequisites: `firebase-tools` installed and authenticated.

```bash
# one-time
npm install -g firebase-tools
firebase login                 # opens a browser for Google auth

# from the repo root, every time you publish rules
firebase deploy --only firestore:rules --project tempo-sync-6f7b2
```

The CLI reads `firestore.rules` from the repo root (per the `firebase.json`
mapping) and pushes it. The command is idempotent — re-running it republishes the
same file harmlessly, so it is safe to run whenever you are unsure whether the
live rules match the repo.

### Alternative: the Console Rules editor

Rules can also be edited and published directly in the Firebase Console (Firestore
Database → Rules → **Publish**). This is the fast path for an emergency
tightening, but it incurs the drift cost above: a Console publish is live
immediately and **does not** update `firestore.rules` in git. If you hot-edit in
the Console, immediately mirror the change back into the committed file and commit
it, or the next CLI deploy will overwrite your edit with the stale repo version.

## What the rules encode

The full ruleset is 19 lines; two match blocks under
`/databases/{database}/documents` carry the whole policy.

**1. Per-user isolation (the catch-all).** Every document under a user's tree is
readable and writable only by that signed-in user
(`firestore.rules:15-17`):

```
match /users/{userId}/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

This is what keeps the six read-write synced stores (`meds` / `history` /
`rest_log` / `presets` / `bfrb_events` / `distractions`) private per account.

**2. `recovery_state` is read-only for clients (the carve-out).** The recovery
feed has its own block, declared **before** the catch-all
(`firestore.rules:11-14`):

```
match /users/{userId}/recovery_state/{docId} {
  allow read: if request.auth != null && request.auth.uid == userId;
  allow write: if false;
}
```

`allow write: if false` denies every client write to `recovery_state`,
unconditionally. That feed is written **only** by the external
`personal-health-elt` pipeline using a **Firebase Admin service-account
credential, which bypasses these rules entirely** — so the pipeline writes freely
while no client (compromised or buggy) can poison its own readiness feed. The
read-only contract these rules enforce is specified in
[../reference/recovery-state-contract.md](../reference/recovery-state-contract.md)
(see its *Access control* section).

### Block order is load-bearing

The `recovery_state` block **must** stay declared before the
`/users/{userId}/{document=**}` catch-all. Firestore evaluates rules
**cumulatively**: once any matching rule grants an operation, it is allowed — the
more-specific block does not *subtract* the catch-all's grant. The comment in the
rules file states this rationale directly (`firestore.rules:4-10`). If you ever
reorder or restructure these blocks, the `recovery_state` write denial is the
invariant to protect: the carve-out narrows write permission to read-only for
clients precisely because it is the more specific path, declared first. (Same
carve-out rationale: [../adr/0003-firestore-sync-backend.md](../adr/0003-firestore-sync-backend.md),
§Decision.) The client-side per-store merge that rides on top of these
per-user-isolated stores is documented in
[../adr/0004-per-store-merge-strategy.md](../adr/0004-per-store-merge-strategy.md).

## Verify after a deploy

There are no rules-unit tests in this repo yet, so verification is manual. Use the
**Firebase Console → Firestore Database → Rules → Rules Playground** to assert
both guarantees:

1. **Per-user isolation holds.** Simulate an authenticated read **and** a write
   against `users/{uid}/meds/{anyDoc}` as that same `uid` → both **ALLOW**.
   Repeat the same read/write as a *different* authenticated uid → both **DENY**.
   This exercises `firestore.rules:15-17`.
2. **`recovery_state` is client-write-denied.** Simulate an authenticated write
   against `users/{uid}/recovery_state/latest` as that same `uid` → **DENY**
   (the `allow write: if false` at `firestore.rules:13`). Then simulate a
   *read* of the same path as that uid → **ALLOW** (`firestore.rules:12`). A
   client that can write `recovery_state` means the carve-out was dropped or
   reordered — stop and fix.

A quick live smoke is also available without the Playground: signed in to the app,
in DevTools, `await SyncFirestore.setDoc(\`users/${SyncAuth.getCurrentUser().uid}/_test/probe\`, { ok: true })`
should resolve silently if the catch-all is live and throw `permission-denied`
if it is not (`docs/sync-impl/FIREBASE-SETUP.md:108-116`).

### These two assertions are now automated (against the committed rules)

Both checks above are exactly what the `firestore-rules` CI job now asserts: a
`@firebase/rules-unit-testing` suite (`tests/rules/firestore-rules.test.mjs`, run
via `npm run test:rules` against the Firestore emulator) covers per-user
isolation and `recovery_state` client-write denial — Tempo's artifacts-plan
automation item 7 (`docs/artifacts-plan.md:231`, `docs/artifacts-plan.md:178`).
**Important:** that suite validates the *committed* `firestore.rules` is correct;
it does **not** verify the live project matches it. The committed-vs-live drift
risk at the top of this runbook is therefore still unmitigated by tooling — the
Rules Playground / live smoke above remain the only check that what is *deployed*
is what you think.

## Related

- [../reference/recovery-state-contract.md](../reference/recovery-state-contract.md)
  — the read-only contract these rules enforce (its *Access control* section
  quotes the same block).
- [../adr/0003-firestore-sync-backend.md](../adr/0003-firestore-sync-backend.md)
  — the backend decision and the `recovery_state` read-only carve-out.
- [../adr/0004-per-store-merge-strategy.md](../adr/0004-per-store-merge-strategy.md)
  — the client-side per-store merge that runs on top of these per-user-isolated
  stores.
- [../sync-impl/FIREBASE-SETUP.md](../sync-impl/FIREBASE-SETUP.md)
  — the original project-setup walkthrough (Console + CLI publish paths).
- [../playbooks/sync-divergence.md](../playbooks/sync-divergence.md) — what to do
  when sync itself misbehaves, as opposed to the rules.
