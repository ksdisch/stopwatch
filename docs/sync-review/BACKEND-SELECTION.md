# Tempo cloud-sync backend selection (Phase 6)

**Status:** Decision doc. No code in this deliverable per the Phase 5 → Phase 6 hard rules. The user reads this and picks; implementation comes in a later phase.

**TL;DR:** **Recommend Firebase / Firestore.** Lowest implementation effort (4–6 days), free-forever at our scale with 2000× write-quota headroom, mature Capacitor auth plugin, native subcollections for `meds/{medId}/doseLog/{entryId}`. The two costs you accept are (1) no self-serve BAA, capping any future public-launch story with other users' dose data, and (2) Firestore-shaped vendor lock-in. **Runner-up: Supabase**, only worth choosing if you want a SQL data model AND you can commit to a weekly cron-ping (or $25/mo Pro plan) to defeat the free-tier auto-pause. **CloudKit is out** — the web side is effectively abandonware (CloudKit JS docs dated 2016, no GitHub, Apple's newer CKTool JS is explicitly server-only) and CloudKit user identity is not linked to Sign-in-with-Apple. **PouchDB / Cloudant Lite is a viable third place** if vendor neutrality is the dominant value — but it's 8–12 days of work, a doseLog subcollection refactor, custom merge code, and weekly cron-pings against Cloudant's 30-day-inactivity wipe.

---

## Hard requirements

Pulled from `docs/CLOUD-SYNC-STRATEGY.md` v2.0 (Q1 resolution + Stage E contract) and the Phase 6 spec.

1. **HR1 — Atomic compare-and-swap on per-record `schemaVersion`.** Writes must be conditional on the current schemaVersion. Refuse-writeback safety (F19a) depends on this. Per-record granularity is sufficient; per-field is a nice-to-have.
2. **HR2 — Auth on web + Capacitor iOS, no re-prompt per surface.** Same identity carries across the PWA and the iOS WebView wrapper for `com.ksdisch.tempo`.
3. **HR3 — Append-only subcollections.** Hot path is `meds/{medId}/doseLog/{entryId}`. Need efficient append + cheap "give me recent entries" query.
4. **HR4 — Free or near-free at 2-device / ~10 stores / ~365 doseLog writes/year** scale. The math has to be a non-issue.
5. **HR5 — Health-data residency.** Where data lives, encryption at rest, HIPAA-adjacent posture. Tempo logs real medication doses.

Additional dimensions scored per vendor:
- **Auth integration** — LOC + Capacitor plugin availability + maintenance status.
- **Conflict-resolution primitives** — CAS, LWW, CRDT, transactions, server-side merge.
- **Effort-to-ship (rough days)** — solo dev with web JS + Capacitor experience, no prior experience with the vendor, wiring against existing F19a/F19b/F20 contracts.

---

## Decision matrix

| Dimension | Firebase / Firestore | Supabase | CloudKit | PouchDB + Cloudant Lite |
|---|---|---|---|---|
| **HR1 — Atomic CAS on schemaVersion** | 🟡 Partial — `runTransaction` gives doc-level CAS; field-level requires read + JS check + write-or-abort, costs 1 extra read per write | ✅ Pass — `.update().eq('schemaVersion', N).select()` is true per-row atomic CAS via PostgREST `WHERE` clause | 🟡 Partial — `recordChangeTag` is whole-record CAS via `.ifServerRecordUnchanged` save policy, not field-level | 🟡 Partial — `_rev` MVCC on whole doc; stale `_rev` → 409 reliably; concurrent diff-field writes still race |
| **HR2 — Auth web + Capacitor** | ✅ Pass — `@capacitor-firebase/authentication` v8.2.0, capawesome-team, ~15k weekly downloads | 🟡 Partial — magic-link is clean (~30 LOC); OAuth has 3 documented Capacitor traps fixable in ~60 LOC | ❌ **Fail** — CloudKit JS is functionally abandoned (docs dated 2016, no GitHub); CloudKit user ≠ Sign-in-with-Apple identity | 🟡 Partial — WKWebView cookies broken on iOS 14+; recommended pattern is Basic Auth via custom `fetch` (~15 LOC) |
| **HR3 — Append-only subcollections** | ✅ Pass — native subcollections; `collection('meds').doc(id).collection('doseLog').add()`; 1 write unit each | ✅ Pass — child table with FK + index on `(med_id, taken_at desc)`; O(log n) queries, no per-read cost | 🟡 Partial — `CKRecord.Reference` back to parent, no native subcollection model | 🟡 Partial — refactor doseLog to top-level docs `doseLog/{medId}/{entryId}` + Mango index |
| **HR4 — Cost at our scale** | ✅ Pass — Spark plan: 20k writes/day cap vs ~10 writes/day actual = **2000× headroom**. Free forever. | ✅ Pass — free tier: 500 MB Postgres, 5 GB egress; we use <0.2% of every dimension | ✅ Pass — $0 dev cost (user's iCloud quota), **BUT $99/yr Apple Developer Program is mandatory** | ✅ Pass — Cloudant Lite permanently free; 10 writes/sec cap fine; **30-day inactivity wipe** mitigable via cron-ping |
| **HR5 — Health-data residency** | 🟡 Partial — AES-256 at rest, region selectable but permanent; HIPAA-eligible **but BAA requires sales engagement, no self-serve on Spark** | 🟡 Partial — AES-256 at rest, AWS-hosted, region selectable on all plans; HIPAA via Team ($599/mo) + ~$350/mo add-on | ✅ Pass (qualified) — Apple's trust boundary; standard CloudKit encryption; user can opt into ADP for E2EE on encrypted fields | ✅ Pass — Cloudant HIPAA-compliant; EU-managed-service option for residency |
| **Auth integration (LOC + plugin)** | ~30–60 LOC. `@capacitor-firebase/authentication` actively maintained against Capacitor 8 | ~30 LOC for magic-link, ~60 LOC for OAuth. `@supabase/supabase-js` works directly in Capacitor WebView | ~50–100 LOC web + **~200–400 LOC of Swift bridge** for iOS (no real Capacitor CRUD plugin exists) | ~25 LOC (basic-auth fetch wrapper + settings UI for API key) |
| **Conflict-resolution primitives** | `runTransaction` (optimistic, ~5 retries); `FieldValue.serverTimestamp/arrayUnion/increment`; no CRDT, no server-side merge | True per-field CAS via SQL `WHERE`; transactions; upsert; Postgres RPC for multi-statement; Realtime via logical replication | `recordChangeTag` CAS; `serverRecordChanged` returns 3-way merge candidates; zone-level change tokens; iOS-only `CKQuerySubscription` push | MVCC `_rev`; `_conflicts` array on read; deterministic winner by rev-tree depth; you write per-field merge yourself |
| **Effort-to-ship (rough days)** | **4–6 days** | **5–7 days** | **14–20 days** (long tail = own Swift bridge for iOS CRUD) | **8–12 days** for Cloudant combo; +3–5 days if Fly.io; **+20–40 days** if Workers/DO (not recommended) |

---

## Per-vendor evaluations

### Firebase / Firestore

**What it's good at for Tempo.** Free at our scale with absurd headroom — 10 writes/day actual against a 20,000/day cap is a 2000× margin. Auth ergonomics on Capacitor are excellent thanks to `@capacitor-firebase/authentication` (capawesome-team, ~15k weekly downloads, Capacitor 8 support): one Google sign-in covers both the web PWA and the iOS WebView using the native iOS Firebase SDK. Subcollections fit `meds/{medId}/doseLog/{entryId}` directly with no schema gymnastics — and real-time `onSnapshot` listeners would give cross-device sync without polling, the literal "log a dose on phone, see it on laptop" pattern.

**Where it falls short.** Transactions provide CAS on document version, not on a specific field. We can still get refuse-writeback semantics — read inside `runTransaction`, check `schemaVersion` in JS, write or abort — but every conditional write costs one extra read (a billable read on the free tier). This is *cleaner* than CloudKit's whole-record changeTag but *less clean* than Supabase's `.eq('schemaVersion', N)`. There's no built-in CRDT or server-side merge; conflict logic lives in client transactions, or in Cloud Functions (cold-start + extra cost).

**Killer caveat (day 2 surprise).** HIPAA. Firestore *is* a BAA-eligible GCP service, but obtaining the BAA requires direct Google Cloud sales contact and typically a paid commitment. Spark-plan personal projects cannot self-serve a BAA. For Tempo's "log my own meds" personal use this is a posture call (your data, encrypted at rest, never shared) — but you cannot truthfully market the app as HIPAA-compliant if you ever onboard other users with their own dose data.

**Gotchas:**
- Database region is **permanent**. Pick `us-central1` or `nam5` once and you're stuck.
- CAS is per-document, not per-field. Two concurrent writes touching different fields of the same med will still cause a transaction retry. Fine at 2-device scale.
- 1 sustained write/sec per document soft limit. Never hit at human medication scale.
- Reads cost too. Two devices each waking up and listening to ~20 records ≈ ~80 reads per app-open. Within budget, but `onSnapshot` listeners running in the background creep.
- Spark plan **can be shut off mid-month** if any quota is exceeded — set budget alerts even on free tier.
- `@capacitor-firebase/firestore` doesn't explicitly document `runTransaction` support — may force fallback to the JS Firestore SDK in WebView (loses native offline persistence).
- **Transactions require network connectivity** — fully-offline writes fail. Conflicts with Tempo's local-first baseline; plan to fall back to LWW + version check on next online sync.
- Firestore's query model (no joins, composite-index gotchas) doesn't translate to Postgres/SQLite later. Moving off = rewrite, not port.

**Sources:** firebase.google.com/pricing, firebase.google.com/docs/firestore/{quotas,manage-data/transactions,locations}, github.com/capawesome-team/capacitor-firebase, cloud.google.com/security/compliance/hipaa-compliance.

---

### Supabase

**What it's good at for Tempo.** The Postgres backend gives true atomic compare-and-swap via plain `.update().eq('schemaVersion', N)` — no client-side race, no eventual-consistency mental model. Append-only `doseLog` collapses to an indexed child table; reads cost millicents at our scale. The free tier swallows our entire footprint with four orders of magnitude of headroom (30 KB of a 500 MB allowance). Magic-link auth wired against `kstan.disch@gmail.com` is ~30 LOC and works identically in Safari and the iOS WebView.

**Where it falls short.** HIPAA gates are hard, not soft. Supabase signs a BAA only on Team ($599/mo) or Enterprise plus a separate HIPAA add-on (~$350/mo per third-party reporting; exact pricing requires sales contact). For personal use it's a non-issue; for any future public launch with other users' dose data, you're either upgrading or keeping records device-local.

**Killer caveat (day 2 surprise).** **The free-tier 1-week project pause.** A Supabase project that sees no database activity for 7 days is auto-paused, requiring a manual dashboard click to resume. Tempo's traffic is sporadic — if you don't open the laptop for a vacation, the project sleeps and the next phone-side write fails until you log into the dashboard. Workarounds: (a) GitHub Action that pings the project on a cron, (b) Pro plan ($25/mo) removes the pause, (c) `/auth/v1/health` ping from a service worker / iOS background fetch. None are free + automatic.

**Gotchas:**
- **Free-tier 1-week pause** as above.
- **No backups on free tier** — local-first hedges against this, but worth a manual "Export full state" alongside any Supabase wiring.
- **Capacitor OAuth has 3 documented landmines** (SFSafariViewController custom-scheme handling, WKWebView cookie clearing kills PKCE verifier, `window.location.href` ejects to external Safari). Magic-link dodges all.
- `.update()` returns empty array on no-match by default — **MUST chain `.select()` and check `data.length === 0`** to detect stale-version conflict; otherwise PostgREST silently no-ops.
- `.update()` without a filter is blocked — good (prevents accidental full-table writes).
- HIPAA add-on pricing is sales-quoted, not published.
- `@supabase/supabase-js` is ~120 KB minified+gzipped — significant for a vanilla-JS app currently at zero deps. Loaded via CDN `<script>` tag still adds noticeable cold-start cost on cellular.
- Realtime `postgres_changes` needs RLS enabled on tables to filter broadcasts correctly — enable RLS day 1 (~1 line per table) to avoid a refactor later.

**Sources:** supabase.com/pricing, supabase.com/docs/reference/javascript/{update,eq}, supabase.com/docs/guides/security/hipaa-compliance, supabase.com/docs/guides/auth/native-mobile-deep-linking, supabase.com/docs/guides/troubleshooting/pausing-pro-projects-vNL-2a, github.com/Cap-go/capacitor-supabase, github.com/travisvn/supabase-pause-prevention.

---

### CloudKit (Apple iCloud)

**What it's good at for Tempo.** *Backend* part is great. The private database is free for the developer, scales to the user's iCloud quota, has real optimistic concurrency via `recordChangeTag`, and lives inside Apple's iCloud trust boundary — the right story for a meds tracker. For an iPhone-only single user, CloudKit would be the obvious choice: zero ongoing cost beyond the $99 you're already paying for App Store distribution, no auth UI to design, and silent push subscriptions wake the iOS app on remote changes for free.

**Where it falls short.** The web side. **CloudKit JS is functionally abandonware.** Apple's CloudKit Catalog example page is dated 2016-09-13, the documentation pages carry "no longer updated" banners, and there's no GitHub repo / changelog / release notes. The library still works (served from `cdn.apple-cloudkit.com/ck/2/cloudkit.js`) but you'd be coding against a snapshot of 2016-era JavaScript with promises bolted on. Apple's newer CKTool JS (2022) is explicitly server-side only.

**Killer caveat (day 2 surprise).** **CloudKit user identity is NOT Sign-in-with-Apple identity.** Per Apple's own forum docs, the iOS-side `CKContainer` call returns an opaque per-container token, and the web-side `setUpAuth()` flow returns a different `userInfo` shape. Reconciling "the laptop user is the same person as the phone user" is not first-class — you either trust that both ends are signed into the same iCloud (and accept the asymmetry) or build your own user-mapping table. Combined with the dormant web SDK, the "laptop is Chrome on Windows" case is fragile in a way you'd only discover after committing.

**Gotchas:**
- **$99/yr Apple Developer Program is a hard prerequisite.** Lapse = sync stops.
- **CloudKit JS is effectively unmaintained.** Stale docs, no upstream fixes incoming.
- **No Capacitor plugin with real CRUD.** `capacitor-cloudkit` v3.0.0 only ships `authenticate()` + `fetchRecord()`. For real CRUD from JS on iOS, you write your own Swift bridge (~200–400 LOC). Adds ~5 days.
- **No web push.** `CKQuerySubscription` is iOS-only. Laptop must poll `CKFetchRecordZoneChangesOperation` with stored change tokens.
- **Origin allowlist per-container in CloudKit Dashboard.** Local dev, GitHub Pages, preview environments each need registration.
- Web auth token rotates every request; lose it = dead session.
- **Schema changes require manual Dashboard promotion** (Development → Production), not a code change.
- **Account holder can revoke** by toggling off iCloud — sync stops with opaque error.
- **Cross-platform user trapped:** Android phone + Windows laptop is fragile. CloudKit only really wins when at least one side is iOS/macOS native.

**Sources:** developer.apple.com/documentation/cloudkitjs, developer.apple.com/library/archive/.../CloudKitWebServicesReference, agallio.xyz/post/cloudkit-with-nextjs (2024 — confirms CloudKit JS is "no longer updated"), steveharrison.dev/exploring-cloudkit-js (notes "designed before Promises and async/await"), npmjs.com/package/capacitor-cloudkit.

---

### PouchDB + Cloudant Lite (recommended self-host combo)

**Server-side hosting options compared.** Cloudant Lite is permanently free at our scale (1 GB storage, 10 writes/sec, 20 reads/sec, 30-day-inactivity wipe). Fly.io killed its free tier in October 2024; a CouchDB instance + volume + egress runs ~$3–5/month. Cloudflare Workers + Durable Objects as a CouchDB-compatible remote is not realistic — no open-source CouchDB-Workers shim exists, you'd implement the CouchDB replication protocol from scratch (~20–40 days of work).

**Recommended combo: PouchDB (browser) + Cloudant Lite.** Eliminates ops, free forever, the 30-day-inactivity wipe is the one gotcha and mitigable by a weekly cron ping. Fly.io is a defensible runner-up if you ever need long-term reliability without IBM lock-in.

**What it's good at for Tempo.** PouchDB 9.0 (May 2024) is actively maintained under Apache governance with biweekly community triage in 2026 — not abandoned. The sync protocol is mature: `localDb.sync(remoteDb, { live: true, retry: true })` once, then offline writes queue, conflicts surface as `_conflicts` arrays you can resolve in JS, retries are automatic. Cloudant Lite has real throughput headroom for personal use and is the rare permanently-free plan.

**Where it falls short.** CouchDB's MVCC is whole-document, not field-level — doesn't fit Tempo's per-field-LWW design natively; you'll write merge code yourself but it stays local in your engine. The bigger architectural cost is reshaping doseLog from a med subcollection into top-level docs with a view index — a real refactor of `meds.js`.

**Killer caveat (day 2 surprise).** **Capacitor WKWebView + cookies is broken** enough that you'll abandon CouchDB's default `_session` cookie auth within an hour and switch to Basic Auth via a custom `fetch`. This is well-documented and fixable, but every CouchDB tutorial online uses `_session`, so you'll waste half a day discovering why the tutorial path doesn't work on iOS.

**Gotchas:**
- **WKWebView cookie hell** — plan Basic Auth + custom `fetch` from day one.
- **MVCC ≠ field CAS** — `_rev` is per-document; concurrent writes to different fields of the same doc still race.
- **No subcollections** — doseLog refactor is unavoidable.
- **Cloudant Lite 30-day-inactivity wipe** — needs weekly cron-ping (GitHub Action).
- **Cloudant Lite hard throughput caps** (10 writes/sec): bulk-import migrations need pacing.
- **Fly.io no longer free** — pre-2024 docs are stale; ~$3–5/mo floor.
- **CouchDB self-hosted has no native encryption at rest** — trust Fly's volume LUKS or app-level `crypto-pouch`. Cloudant handles this.
- **PouchDB 9.0 changed `.find()` default limit** to 25 — explicitly pass `limit: Infinity` when migrating from 8.x.
- **Conflict resolution is your problem** — PouchDB hands you `_conflicts: [rev, rev]` and walks away.
- **You own the ops if Fly.io path** — version upgrades, backups, cert renewals.

**Sources:** pouchdb.com/2024/05/24/pouchdb-9.0.0.html, blog.couchdb.org/2026/02/03/couchdb-digest, fly.io/docs/about/pricing, community.fly.io/t/free-tier-is-dead, ibm.com/cloud/cloudant/pricing, docs.couchdb.org/en/stable/replication/conflicts.

---

## Recommendation

**Pick Firebase / Firestore.**

### Why

For Tempo's actual constraints — one user, two devices, ~10 writes a day, never plans to onboard other people's dose data — Firebase wins on the dimensions that actually matter:

1. **Lowest effort to ship (4–6 days).** Half the time of PouchDB/Cloudant (8–12d), a third of CloudKit (14–20d). Mature Capacitor plugin (`@capacitor-firebase/authentication` v8.2.0, ~15k weekly downloads, Capacitor 8 support) removes the auth integration risk that bites the other three vendors.
2. **Native subcollections fit Tempo's data model directly.** `meds/{medId}/doseLog/{entryId}` lands on Firestore with no schema gymnastics. PouchDB would require a top-level-doc refactor; CloudKit needs `CKRecord.Reference` plumbing.
3. **Free-tier headroom is comically large.** 2000× margin on write quota, 100× margin on storage. The free tier is *truly* free — no auto-pause (Supabase's killer), no $99/yr prerequisite (CloudKit's killer), no monthly VM cost (Fly's killer), no 30-day-inactivity wipe (Cloudant's killer).
4. **CAS granularity matches our actual need.** The F19a refuse-writeback contract operates per record (a med record, a history row, a preset record) — not per field. Firestore's doc-level CAS via `runTransaction` is exactly the right granularity. Supabase's field-level CAS is *cleaner* but solves a problem we don't actually have.
5. **Real-time listeners are free and trivial.** `onSnapshot` gives cross-device sync without polling — the "log a dose on phone, see it on laptop" UX comes for free.

### Top 2 tradeoffs you accept

1. **No self-serve BAA.** Firestore is HIPAA-eligible but the BAA is gated behind Google Cloud sales engagement — Spark-plan personal projects cannot self-serve. **Implication:** Tempo cannot ever be truthfully marketed as HIPAA-compliant while running on Spark. For your personal use this is a posture call (your data, encrypted at rest, never shared) — but it caps the product's distribution story. If you ever decide to launch publicly with other users' dose data, you're either upgrading to a paid GCP plan + signing a BAA, or migrating off Firestore.
2. **Firestore-shaped vendor lock-in.** The query model (no joins, composite-index gotchas, no SQL) and the pricing model (per-read / per-write) don't translate to Postgres or SQLite later. Moving off is a rewrite, not a port. If portability ever becomes a goal — "I want to self-host on a $5 VPS" — you're starting over. Supabase / PouchDB don't have this lock-in problem; Firebase does.

### Runner-up: Supabase

Worth choosing only if **both** are true:
- You strongly prefer a SQL data model (familiarity, portability, sharper CAS primitive).
- You can commit to a weekly cron-ping (10 LOC GitHub Action) OR $25/mo Pro plan to defeat the 1-week free-tier auto-pause.

If either is shaky, Firebase is the more pragmatic call.

### Eliminated: CloudKit

CloudKit fails HR2 hard. CloudKit JS is abandonware (2016 docs, no GitHub, no Capacitor plugin with real CRUD), and CloudKit user identity isn't linked to Sign-in-with-Apple, so the "this laptop user is the same person as this phone user" mapping is your problem to solve. Even if those resolved, the $99/yr Apple Developer Program prerequisite and ~14–20 day effort estimate (writing your own Swift bridge) make this the highest-cost path. Reconsider only if Tempo ever pivots to iOS-only with no web access.

### Third place: PouchDB + Cloudant Lite

Defensible if the dominant value is *vendor neutrality* — PouchDB is open source, the CouchDB protocol is open, you can swap hosts (Cloudant Lite → Fly.io CouchDB → self-host) without rewriting client code. The cost is 8–12 days of work, a non-trivial doseLog refactor, custom field-level merge logic, the WKWebView cookie workaround, and a weekly cron ping against Cloudant's 30-day-inactivity wipe.

---

## Out of scope (per Phase 6 hard rules)

- **No sync code.** Implementation comes in a later phase per the user's "DO NOT wire sync code until I approve a backend" rule.
- **No vendor sign-up / project creation.** The user picks; setup belongs to the implementation phase.
- **No F19c — per-store manifest registry.** Deferred per strategy doc; the hardcoded key list works for the current store count.
- **No backend-side schema definition.** That's an implementation detail once the vendor is chosen.

---

## Methodology

Four parallel `general-purpose` research agents (one per vendor) each consumed the vendor's docs + pricing pages + recent third-party reporting (2024–2026) and returned a structured evaluation against the 5 hard requirements + 3 matrix dimensions. The agents had no prior context on Tempo's architecture beyond what the prompt included; the matrix dimensions and per-record / append-merge constraints were lifted directly from `docs/CLOUD-SYNC-STRATEGY.md` v2.0.

This author then cross-checked the per-vendor verdicts, resolved disagreements in interpretation (e.g., Firestore's doc-level vs field-level CAS impedance), and consolidated into the matrix + 1-page recommendation. All cited URLs come from the agents' research; this doc inherits their verifications.

Re-running the methodology against new vendors (DynamoDB, Replicache, Liveblocks, etc.) is straightforward — spawn a new agent with the same prompt template, swap the vendor-specific notes section, and slot the result into the matrix.

---

## Sources

### Firebase / Firestore
- https://firebase.google.com/pricing
- https://firebase.google.com/docs/firestore/quotas
- https://firebase.google.com/docs/firestore/manage-data/transactions
- https://firebase.google.com/docs/firestore/transaction-data-contention
- https://firebase.google.com/docs/firestore/locations
- https://firebase.google.com/support/privacy
- https://cloud.google.com/security/compliance/hipaa-compliance
- https://github.com/capawesome-team/capacitor-firebase

### Supabase
- https://supabase.com/pricing
- https://supabase.com/docs/reference/javascript/update
- https://supabase.com/docs/guides/security/hipaa-compliance
- https://supabase.com/docs/guides/auth/native-mobile-deep-linking
- https://supabase.com/docs/guides/troubleshooting/pausing-pro-projects-vNL-2a
- https://medium.com/@vpodugu/supabase-pkce-oauth-in-capacitor-ios-why-your-code-verifier-disappears-and-how-to-fix-it-29a4747dce9e
- https://github.com/Cap-go/capacitor-supabase
- https://github.com/travisvn/supabase-pause-prevention
- https://www.accountablehq.com/post/is-supabase-hipaa-compliant-in-2026-baa-phi-and-security-explained

### CloudKit
- https://developer.apple.com/documentation/cloudkitjs
- https://developer.apple.com/library/archive/documentation/DataManagement/Conceptual/CloudKitWebServicesReference/ModifyRecords.html
- https://developer.apple.com/documentation/cloudkit/ckmodifyrecordsoperation
- https://developer.apple.com/documentation/cloudkit/ckrecord/1462195-recordchangetag
- https://developer.apple.com/forums/thread/119159 (Sign in with Apple ≠ CloudKit user)
- https://developer.apple.com/programs/whats-included/ ($99/yr)
- https://www.npmjs.com/package/capacitor-cloudkit
- https://agallio.xyz/post/cloudkit-with-nextjs (2024 — CloudKit JS abandonment signal)
- https://steveharrison.dev/exploring-cloudkit-js/ (2024 — "designed before Promises")
- https://cdn.apple-cloudkit.com/cloudkit-catalog/ (dated 2016-09-13)

### PouchDB + Cloudant / Fly.io
- https://pouchdb.com/2024/05/24/pouchdb-9.0.0.html
- https://blog.couchdb.org/2026/02/03/couchdb-digest-december-2025-january-2026/
- https://fly.io/docs/about/pricing/
- https://community.fly.io/t/free-tier-is-dead/20651
- https://www.ibm.com/cloud/cloudant/pricing
- https://github.com/ibm-cloud-docs/Cloudant/blob/master/faqs/pricing-faq.md
- https://docs.couchdb.org/en/stable/replication/conflicts.html
- https://pouchdb.com/guides/conflicts.html
- https://github.com/pouchdb-community/pouchdb-authentication
- https://github.com/ionic-team/capacitor/issues/6813 (iOS 16.6 cookie regression)

---

*This doc is a snapshot of vendor positioning as of the date of the most recent merged PR on `origin/main`. Pricing tiers, plugin status, and HIPAA postures change — re-run the methodology if the decision is reconsidered more than 6 months from this doc's commit date.*
