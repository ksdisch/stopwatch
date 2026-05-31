# ADR 0003: Firebase/Firestore as the cloud-sync backend

- **Status:** Accepted (retro-documented 2026-05-30)
- **Date:** Phase 6 (backend selection) → Phase 9 (28-PR cloud-sync build). The decision was made when `docs/sync-review/BACKEND-SELECTION.md` landed and was ratified at PR S0-1, when the committed config (`js/sync-firebase-config.js`) and rules (`firestore.rules`) entered the repo.
- **Deciders:** ksdisch
- **Tags:** cloud-sync, backend, firebase, vendor-lock-in

## Context

Tempo is a vanilla-JS, no-build PWA deployed to GitHub Pages, wrapped for iOS via Capacitor (`com.ksdisch.tempo`). After the Wellness suite (Meds, Recovery) shipped, the app needed multi-device sync — "log a dose on my phone, see it on my laptop." The author is a solo dev with **no backend server** and a single real user (two devices). That framing is decisive: every requirement is sized for one person, not a SaaS.

The hard requirements were lifted from `docs/CLOUD-SYNC-STRATEGY.md` v2.0 and enumerated in `docs/sync-review/BACKEND-SELECTION.md:9-18`: (HR1) atomic compare-and-swap on a per-record `schemaVersion` to power the F19a refuse-writeback contract; (HR2) one auth identity spanning the web PWA and the iOS WebView with no per-surface re-prompt; (HR3) efficient append-only subcollections for the hot path `meds/{medId}/doseLog/{entryId}`; (HR4) free or near-free at ~10 writes/day; (HR5) health-data residency, since Tempo logs real medication doses.

The constraint that shaped the *whole* evaluation is "no backend server." Without a server, there is nowhere to hold an OAuth client secret, no place to run a merge daemon, and no host to keep alive — so the backend itself has to supply auth, per-user security rules, and per-doc conflict primitives directly from the client. That ruled the field down to managed BaaS or a CouchDB-replication model.

Four vendors were evaluated in parallel against a 5-requirement matrix (`BACKEND-SELECTION.md:28-37`): Firebase/Firestore, Supabase, CloudKit, and PouchDB + Cloudant Lite. The recommendation — Firebase — and its two accepted tradeoffs are stated at `BACKEND-SELECTION.md:140-155`.

## Decision

Use **Firebase Authentication (Google sign-in) + Cloud Firestore** as the sync backend. The Firestore document shape `users/{uid}/{store}/{record}` is baked into the engine and is not abstracted behind a vendor-neutral interface.

The public web client config is committed verbatim — project `tempo-sync-6f7b2`, `js/sync-firebase-config.js:12-20`. This is deliberate: Firebase's security model puts all access control behind server-side rules, not behind hiding the API key (`js/sync-firebase-config.js:2-9`). Enforcement is per-user UID isolation in `firestore.rules:30-33`:

```
match /users/{userId}/{collection}/{docId=**} {
  allow read: if isOwner(userId);
  allow write: if isOwner(userId) && collection != 'recovery_state';
}
```

with a read-only carve-out for the server-written recovery feed so a compromised client cannot poison it (`firestore.rules:21-24` — `allow write: if false` on `recovery_state`, which an Admin service-account ELT pipeline writes and the client only reads). That read-only guarantee is enforced by the `collection != 'recovery_state'` exclusion in the catch-all above — *not* by declaration order, since Firestore evaluates rules cumulatively. (Corrected 2026-05-31: the original of this ADR described the guarantee as coming from declaring the carve-out block "before" the catch-all; that was wrong — block order has no effect, and the un-excluded recursive catch-all silently re-granted the client write. A rules-unit test now pins the behavior: `tests/rules/firestore-rules.test.mjs`.)

The `users/{uid}/{store}/{record}` path is hardcoded across the sync layer, not parameterized: `js/sync-engine.js:801` (`users/${user.uid}/${storeKey}/${id}`), and per-store at `:1673` (history), `:1685` (meds), `:1703` (rest_log), `:1717` (presets). Reads use the same shape — `js/sync-engine.js:571,957`. The web-vs-native split lives in one seam, `js/sync-firestore.js`: the web branch lazy-imports the Firestore SDK from the gstatic CDN (`js/sync-firestore.js:43-44`, pinned to `firebasejs/11.10.0`) so a zero-dep PWA stays zero-dep until sync is enabled; the native branch routes to `window.Capacitor.Plugins.FirebaseFirestore`. Cross-device identity is "same Google account → same Firebase UID → same Firestore path," with no separate user-mapping table (`docs/sync-impl/FIREBASE-SETUP.md:132`).

CAS granularity is doc-level (per record), which `BACKEND-SELECTION.md:149` argues is exactly the F19a need — F19a operates per med/history/preset record, not per field. The Spark free tier runs with ~2000× write-quota headroom and a $1/month budget alert as an early-warning trip-wire (`docs/sync-impl/FIREBASE-SETUP.md:185`). The region (`us-central1`) is chosen once at project creation and is permanent (`docs/sync-impl/FIREBASE-SETUP.md:51-53`).

## Consequences

### Positive

- **Lowest effort to ship (4–6 days est., `BACKEND-SELECTION.md:37`).** The mature Capacitor auth plugin (`@capacitor-firebase/authentication`) removed the integration risk that bit every other vendor — the one piece a no-backend PWA cannot fake.
- **No backend to run.** Auth, per-user security rules (`firestore.rules`), and per-doc CAS all ship from the client. The committed public config (`js/sync-firebase-config.js`) plus server-side rules is the entire trust boundary.
- **Native subcollections fit the data model directly.** `meds/{medId}/doseLog/{entryId}` lands with no schema gymnastics (`BACKEND-SELECTION.md:147`); PouchDB would have forced a top-level-doc refactor of `meds.js`.
- **Free tier is *truly* free at this scale** — no auto-pause (Supabase's killer), no $99/yr prerequisite (CloudKit's), no idle-wipe (Cloudant's). The $1 budget alert is a canary, not a cost (`docs/sync-impl/FIREBASE-SETUP.md:185`).
- **The committed-config posture is correct, not a leak.** Documented at `js/sync-firebase-config.js:2-9` and `docs/sync-impl/FIREBASE-SETUP.md:20-34`: the API key identifies the project, it does not grant access; `firestore.rules` is the real gate.

### Negative / tradeoffs

- **Vendor lock-in — "moving off = rewrite, not port" (`BACKEND-SELECTION.md:59,155`).** The `users/{uid}/{store}/{record}` path is hardcoded across `js/sync-engine.js` (e.g. `:801`, `:1673-1717`) and the Firestore-shaped query model (no joins, composite-index gotchas, per-read/per-write pricing) doesn't translate to Postgres/SQLite. Self-hosting on a cheap VPS later is a from-scratch rebuild.
- **Doc-level CAS only — no per-field merge, no server-side merge (`BACKEND-SELECTION.md:47,54`).** Two concurrent writes to different fields of the same record still trigger a transaction retry. Acceptable at two-device scale; every conditional write also costs one extra billable read.
- **HIPAA / BAA gap (`docs/sync-impl/FIREBASE-SETUP.md:245-259`).** Spark plan cannot self-serve a Business Associate Agreement, yet Tempo logs real medication doses. Fine for single-user personal use, but it caps the product: onboarding any second user with their own dose data forces upgrade-to-paid-GCP + signed BAA, or migration off Firestore.
- **Permanent region (`docs/sync-impl/FIREBASE-SETUP.md:51-53`).** `us-central1` is locked for the project's lifetime; changing it means export → delete → recreate → re-import.
- **Native parity still incomplete.** `SyncFirestore.runTransaction` and `SyncFirestore.subscribe` are web-only — the native branches throw an explicit "native parity pending" error (`js/sync-firestore.js:13-14,338-340,430-432`). iOS sync currently degrades to 5-min defensive polling + per-record `setDoc`. (Tracked as backlog row #3.)

## Alternatives considered

- **Supabase (runner-up, `BACKEND-SELECTION.md:65-83`).** True per-row CAS via `.update().eq('schemaVersion', N)` and a SQL/portable data model. Rejected because the free-tier 7-day inactivity auto-pause (`:71`) would silently break sync after any vacation, requiring a cron-ping or $25/mo Pro plan — and the ~120 KB `supabase-js` bundle is a real cost for a currently zero-dep app (`:80`). Worth it only if SQL portability were the dominant value.
- **CloudKit (eliminated, `BACKEND-SELECTION.md:87-106`).** Fails HR2 hard: CloudKit JS is effectively abandonware (2016-dated docs, no GitHub), CloudKit user identity is not linked to Sign-in-with-Apple so the "same person on laptop and phone" mapping is unsolved, and there is no Capacitor plugin with real CRUD (would need a ~200–400 LOC Swift bridge). Also requires the $99/yr Apple Developer Program just to sync.
- **PouchDB + Cloudant Lite (third place, `BACKEND-SELECTION.md:110-134`).** The vendor-neutral pick — open protocol, swappable host. Rejected as 8–12 days of work requiring a `doseLog` subcollection-to-top-level refactor, hand-written field merge, the WKWebView cookie/Basic-Auth workaround, and a weekly cron-ping against Cloudant's 30-day-inactivity wipe. Defensible only if vendor neutrality outranked time-to-ship.
- **Self-hosted (Fly.io CouchDB / Workers+DO).** Rejected: Fly.io killed its free tier (~$3–5/mo floor) and a Workers/Durable-Objects CouchDB shim is ~20–40 days of protocol implementation (`BACKEND-SELECTION.md:112`). Contradicts the "no backend server / no ops" constraint outright.

## References

- `docs/sync-review/BACKEND-SELECTION.md` — decision matrix (`:28-37`), recommendation + two accepted tradeoffs (`:140-155`)
- `js/sync-firebase-config.js:2-20` — committed public web config (project `tempo-sync-6f7b2`)
- `firestore.rules:21-33` — per-user UID isolation + `recovery_state` read-only carve-out (the `collection != 'recovery_state'` exclusion)
- `js/sync-firestore.js:13-14,43-44,320-347,408-432` — web CDN-lazy-import vs Capacitor-plugin seam; web-only `runTransaction`/`subscribe`
- `js/sync-engine.js:801,1673-1717` — hardcoded `users/{uid}/{store}/{record}` document shape
- `docs/sync-impl/FIREBASE-SETUP.md:51-53,185,245-259` — region permanence, $1 budget alert, HIPAA/BAA posture
- Related: `docs/CLOUD-SYNC-STRATEGY.md` v2.0 (HR1–HR5 + per-store merge rules); backlog row #3 (native CAS + listener parity)
