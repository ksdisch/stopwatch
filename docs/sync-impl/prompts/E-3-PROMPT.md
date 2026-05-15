# Tempo cloud-sync — implement PR E-3 (Stage E reliability follow-up — real-time `onSnapshot` listeners)

You're working on Tempo, a vanilla-JS PWA + Capacitor iOS app. The
cloud-sync implementation plan is at `docs/sync-impl/PLAN.md` on
`main`. Stage 0, Stage A close-out, Stage B (B-1 → B-4), Stage C
(C-1), Stage D (D-1 + D-2), all 7 Stage E sub-PRs (E-1a → E-1e),
and E-2 (offline buffer) are shipped (PRs #46–#73, plus chore PR
#67 and iOS-fix PR #74). 565 engine tests pass on `main` at commit
`074eb09`.

E-3 is the **second of two Stage E reliability follow-ups** (E-2
offline buffer shipped 2026-05-15 as PR #73; E-3 real-time
`onSnapshot` listeners now). After E-2 shipped, ops authored during
offline windows buffer locally and drain FIFO on reconnect — the
write-path side of the 2026-05-15 validation caveats is closed. But
the **read-path side** is still broken: caveat (a) "polling
unreliable when tabs unfocused" remains because the 30s
`setInterval`-based merge cycle pauses when Chrome backgrounds the
tab and silently dies when iOS Safari suspends the WebView. The
cross-device latency floor today is ~30s under ideal conditions
and unbounded under realistic ones. E-3 replaces the polling cycle
with real-time `onSnapshot` listeners that fire on every cloud-side
change within ~1s and survive backgrounding / suspension because
the SDK reconnects on resume.

E-3 also delivers the **downlevel-client warning toast** — the
second cloud-sync visible toast surface. Refuse-writeback events
(F19a) currently fire `console.warn` only; with listeners running,
downlevel clients can encounter future-schema records frequently
enough that a user-facing message is warranted: "Your phone is on
a newer version. This device is read-only until you update."

After E-3 ships, the cloud-sync initiative reaches functional
completion. Stage F (per-store manifest registry, F19c) remains
deferred indefinitely per `docs/sync-impl/PLAN.md` §F-1. The
remaining 2026-05-15 validation caveats (b/c/d) plus the iOS
"Signing in…" label reset are small cleanup PRs that ride on top
of E-3 or land independently in any order.

---

## What E-3 ships (5 deliverables in one PR)

1. **New `SyncFirestore.subscribe(path, callback)` wrapper.** Extends
   the single-Firestore-SDK seam at `js/sync-firestore.js:289-380`
   (where E-1b's `runTransaction` lives) with a new method that wraps
   `onSnapshot`. Web branch lazy-imports `onSnapshot` from the existing
   `firebase-firestore.js` CDN module (already loaded for `getDoc` /
   `setDoc` / `getCollection` / `runTransaction`). Native branch
   routes to `window.Capacitor.Plugins.FirebaseFirestore`'s
   `addSnapshotListener` (the Capacitor plugin exposes this; native
   parity decision lives in TODO #7). Error shape normalized to the
   existing `{ kind, message, isRetryable, originalError }` envelope.
   Returns an unsubscribe function. `SYNC_DISABLED` fast-path when
   the flag is off.

2. **`js/sync-engine.js` listener-lifecycle extensions.** Six
   per-store subscriptions registered after hydrate completes (or
   after sign-in completes for users already past hydrate). On
   snapshot, dispatch to a new per-store seam that runs the existing
   per-store merge fn for the affected store only — not the full
   `_runMergeCycle()`. Debounce 1s to coalesce bulk-write bursts.
   Pause subscriptions on `visibilitychange` to hidden + on
   `Platform.network.onChange(offline)`. On `visibilitychange` to
   visible + on `Platform.network.onChange(online)`, re-subscribe AND
   fire a one-shot catch-up `_runMergeCycle()` to pull anything
   missed while paused/offline. Unsubscribe cleanly on sign-out and
   on `disable()`. The relationship between listeners and the
   existing 30s polling cycle is the most consequential design
   decision — see TODO #1.

3. **`js/sync-toast.js` extension — `Toast.downlevelWarning(remoteSchemaVersion)`.**
   Second method on the existing `Toast` IIFE that landed in E-2
   (`js/sync-toast.js:34-141`). Same DOM idiom as
   `Toast.bufferOverflow` — `.sync-toast` div appended to
   `document.body`, auto-dismisses after 5s, single-toast slot. Copy
   per PLAN.md §E-3: "Your phone is on a newer version. This device
   is read-only until you update." Listens on a new SyncEngine event
   (`'refuse-writeback'`) emitted by the per-record CAS path in
   `js/sync-firestore.js` and the per-merge-fn cloud-side gates in
   each `js/sync-merge-*.js` module. Dedup policy (fire once per
   session vs every event vs per-remote-deviceId) lives in TODO #5.

4. **`index.html` settings drawer "Sync activity" indicator.** Extends
   the existing `#cloud-sync-status` element at `index.html:167-168`
   to show last-sync time + listener connection status. Already
   `aria-live="polite"` so updates announce naturally. Placement and
   exact shape (text line vs dot indicator vs integrated-into-button)
   live in TODO #6. **Phase 4 ui-wirer fires** for this surface plus
   the `js/sync-toast.js` extension.

5. **Tests** — new `tests/sync-listeners.test.js` (~14-18 cases per
   PLAN.md §E-3 spec) + `tests/sync-toast.test.js` extension or new
   file (depending on TODO #5; ~5-8 cases for `downlevelWarning`) +
   `tests/sync-engine.test.js` extension (~6-10 cases for the
   per-store dispatch seam + lifecycle integration: subscribe on
   hydrate, unsubscribe on sign-out, pause on hidden, resume + drain
   on visible). Target post-E-3 baseline: approximately 590-600
   (current baseline 565 + ~25-35 new).

Plus:

- **`sw.js` CACHE_NAME bump** — v81 → v82 (`'stopwatch-v82-e3-listeners'`
  or similar). E-3 modifies `js/sync-firestore.js` + `js/sync-engine.js`
  + `js/sync-toast.js` + `index.html` + likely `css/styles.css` (small
  status-indicator styling). Cache-bump rule fires.
- **`tests/index.html`** — 1 new `<script>` tag for
  `sync-listeners.test.js` (and possibly `sync-toast.test.js` if it
  ships as a new file vs extending an existing one).
- **`index.html`** — no new `<script>` tags expected; all E-3 code lives
  in existing modules (`sync-firestore.js`, `sync-engine.js`,
  `sync-toast.js`). Settings-drawer markup adds 0-2 small elements to
  the existing `#cloud-sync-status` surface depending on TODO #6.
- **No `package.json` change.** The web `onSnapshot` import rides on
  the already-loaded `firebase-firestore.js` CDN module; the native
  `addSnapshotListener` is part of `@capacitor-firebase/firestore`
  installed in S0-1. No new dependency.
- **Phase 4 ui-wirer FIRES** for two surfaces: the `Toast.downlevelWarning`
  paint + the `#cloud-sync-status` indicator. SMOKE-ONLY mode —
  synthetic `SyncEngine.emit('refuse-writeback', {...})` paints the
  toast; visual check that the status indicator renders; one
  neighboring route still loads. NO real two-device connection
  required for verification; Kyle's manual two-device check is
  post-merge.

---

## RESOLUTIONS (Kyle, TBD — Phase 0 pending)

**Kyle: TODOs 1–8 need your call.** TODO #1 (listeners-vs-polling
primary) and TODO #2 (subscription granularity + module location)
are the most consequential — both shape blast radius and the
per-store dispatch contract. TODO #4 (visibility / network event
handling) controls the lifecycle complexity. TODO #5 (downlevel
toast dedup) controls UX surface. TODO #7 (native parity) controls
PR scope. **Auditor leans Pick A across the board** unless noted
otherwise inside the individual TODO. Accept all defaults with
"all defaults" or override per-TODO.

Once Kyle responds, the resolutions get codified here (replacing
this TBD block, mirroring `docs/sync-impl/prompts/E-2-PROMPT.md:84-126`)
and the audit fires next.

---

## What's true about the codebase E-3 edits

**`js/sync-firestore.js` already has the SDK-seam shape E-3 extends.**
The web branch lazy-imports `firebase/firestore` once and caches the
SDK + Firestore handle via `_loadWebSdk` + `_getWebDb` (lines
132-178). E-3's `subscribe(path, callback)` adds `onSnapshot` to the
existing `_sdk` cache and returns the SDK's native unsubscribe fn
unchanged. The native branch's pattern at lines 180-202 (`_nativePlugin`
+ defensive duck-typing) is the model for routing to
`addSnapshotListener` on Capacitor. Error normalization at lines
60-128 already handles the relevant Firestore error codes — E-3
inherits this without changes.

**`js/sync-engine.js:2033-2122` is the existing lifecycle seam.**
`startSteadyState()` arms the 30s `setInterval` + wires the
`visibilitychange` handler (lines 2055-2072) + wires
`Platform.network.onChange` (lines 2074-2122). E-3 extends this
function — listeners subscribe at the same point the timer arms.
`stopSteadyState()` at lines 2124-2141 unwires the timer, the
visibility handler, and the network listener; E-3 extends it to
also unsubscribe all 6 listeners. The four-condition auto-arm gate
inside `_maybeAutoStartSteady()` at lines 225-240 covers signed-in
+ flag-on + all-hydrated + no-Stage-D-handoff — same gate applies
to listener arming.

**`js/sync-engine.js:1812-1830` is `_runMergeCycle()`'s entry point.**
Today's cycle iterates the 6-store `SYNCED_STORES` registry. E-3's
per-store dispatch seam (per TODO #2) lifts a single store out of
this loop — a new helper `_runMergeCycleForStore(storeKey)` would
call the per-store merge fn for one store only, sharing the same
F19a snapshot gate (`_filterFutureRecordsInSnapshot` at line 297)
and the same F13 SyncState gating. The seam is small but real —
the listener-driven path runs per-store, the polling-driven path
runs all 6.

**`js/sync-engine.js:1842` has E-2's reachability follow-up.** The
`typeof SyncBuffer !== 'undefined'` defensive check is unreachable
in practice because `const SyncBuffer = (() => { ... })()` at the
top of `js/sync-buffer.js` creates a lexical binding that's always
defined when the script loads. The secondary
`typeof SyncBuffer.enqueue === 'function'` check IS the real
feature-detect. E-3 modifies the same neighborhood (the dispatcher
+ the network onChange block); bundling the symmetry fix as a
one-line cleanup is natural — see TODO #8.

**`js/sync-toast.js` extension shape is well-defined.** The
existing `Toast.bufferOverflow(droppedCount)` at lines 98-100 +
`_show(text)` at lines 66-92 + `_hide()` at lines 46-64 already
implement the full DOM lifecycle. Adding `Toast.downlevelWarning(remoteSchemaVersion)`
is a 5-line addition: define the new function calling `_show(...)`
with the verbatim PLAN.md copy, register `SyncEngine.on('refuse-writeback', ...)`
inside `_registerListener()` at lines 109-126 alongside the
existing `'buffer-overflow'` listener. Dedup policy (TODO #5)
gates whether the listener fires every event or filters via a
module-scope flag.

**`index.html:112-169` is the existing Cloud Sync drawer section.**
Five existing UI elements:
- Enable cloud sync toggle (`#cloud-sync-toggle`, lines 115-126)
- Signed-in user display (`#cloud-sync-identity`, lines 127-138, hidden until signed in)
- Sign-in button (`#cloud-sync-signin-btn`, lines 139-143, hidden when signed in)
- Push to cloud button (`#cloud-sync-push-btn`, lines 148-153, hidden until signed in)
- Reconcile now button (`#cloud-sync-reconcile-btn`, lines 161-166, hidden unless Stage D handoff)
- **Sync status div** (`#cloud-sync-status`, lines 167-168, `aria-live="polite"`, hidden by default)

The `#cloud-sync-status` div is where the engine already writes
status text via `tempo-nav.js` event subscriptions (hydrate
progress, push progress, reconcile progress). E-3's "Sync activity"
indicator is most naturally an extension of this surface — see
TODO #6 for placement options.

**`SyncEngine.emit('refuse-writeback', payload)` is NOT currently
emitted anywhere.** The F19a refuse-writeback contract has three
existing layers:
1. **Per-record CAS** (`js/sync-firestore.js:360-365` —
   `tx.refuseWriteback(remoteRecord, localSchemaVersion)` throws
   `kind: 'refuse-writeback'` inside `runTransaction`).
2. **Per-merge-fn cloud-side gate** (`Schema.isFutureRecord` filter
   inside each `js/sync-merge-*.js` body).
3. **Dispatcher snapshot pre-filter** (`_filterFutureRecordsInSnapshot`
   at `js/sync-engine.js:297-374`, E-1e addition).

All three currently `console.warn` but don't emit. E-3 introduces
the `'refuse-writeback'` event by adding `SyncEngine.emit(...)`
calls at each of the three layers. The event payload should carry
at minimum `{ store, remoteSchemaVersion, localSchemaVersion,
remoteDeviceId? }` so the toast (and tests) can dedup as TODO #5
specifies.

**Existing 565 tests baseline.** The E-2 closeout report at
`docs/SESSION-LOG.md` documents 565/565 pass (543 pre-E-2 + 14
sync-buffer + 8 sync-engine extension). E-3 lands ~25-35 new tests
(14-18 sync-listeners + 5-8 sync-toast extension + 6-10 sync-engine
extension); target post-E-3 baseline: approximately **590-600**.

**Spark plan read-budget context.** Spark plan free tier =
50,000 reads/day. At 2 dev devices polling 30s × 6 stores =
~34,560 reads/day. E-3 changes the read profile: instead of 6 reads
every 30s, listeners burn reads only on actual cloud-side changes.
For typical usage (~10-20 writes/day per device), listener reads
drop to a few hundred per day. **But:** listeners burn reads while
the tab is visible regardless of activity (the Firestore SDK
maintains an open connection and consumes some read budget for
keep-alives / first-snapshot reads on re-subscribe). Quota-wise,
E-3 should reduce daily reads significantly under realistic usage
but adds a "first re-subscribe" cost on every visibility flip +
network event — the catch-up `_runMergeCycle()` on resume is the
big-ticket cost. TODO #4 trades off catch-up cost vs missed-event
risk.

---

## TODO #1 — Listeners vs polling primary (MOST CONSEQUENTIAL)

The post-E-1e steady-state baseline is a 30s `setInterval` polling
loop that runs `_runMergeCycle()` whenever the tab is visible + the
device is online + the four-condition auto-arm gate passes. E-3
adds real-time listeners. How do listeners interact with the
existing polling cycle?

**(a) Listeners primary; long-interval polling as defensive fallback.**
Listeners do the heavy lifting; polling runs at 5-15 minutes as a
safety net for cases where listeners silently fail (network blip,
iOS Safari suspended the WebView too long for `onSnapshot` to
reconnect, dropped `addSnapshotListener` callback). The fallback
interval is long enough to be cheap on quota but short enough that
silent listener failure has a bounded recovery time. **Trade-off:**
small quota overhead for guaranteed bounded recovery time. The 30s
polling cycle becomes 5-15min; net read reduction is still ~80-90%.

**(b) Listeners primary; polling disabled when listeners connected.**
`startSteadyState()` arms listeners + does NOT arm the
`setInterval` timer. If a listener emits an error / disconnects,
the engine surfaces a one-time toast and the user must reload
manually. **Trade-off:** maximum read budget savings; zero polling
overhead. **Risk:** silent listener failure manifests as
indefinitely-stale cloud state until the user reloads. iOS Safari
WebView suspension is the canonical scary case — when iOS
backgrounds the WebView for >5 minutes, `onSnapshot` may or may
not reconnect cleanly when the user returns. Without a fallback
poll, "I tapped my phone, my dose isn't showing" surfaces as a
data-loss panic moment.

**(c) Keep polling unchanged; layer listeners as an optimization.**
Listeners trigger merge cycles on snapshot events; the 30s poll
keeps running unchanged. **Trade-off:** maximum reliability but
zero read budget savings — strictly additive cost. Doubles the
read budget under naive implementation; better than (a) for
safety but worse for quota.

**Auditor's lean: (a) — listeners primary; long-interval defensive
poll.** The 5-15min defensive poll is cheap (2 devices × 12 cycles/hour
× 6 stores × 24 hours = ~3,500 reads/day vs current ~34k) and
preserves recovery semantics for the scary iOS-suspend case. (b) is
brittle in exactly the scenario E-3 is supposed to fix; (c) burns
quota without proportional benefit. Sub-decision inside (a): default
the fallback interval to 5 minutes — short enough that a
silent-failure window is bounded to ~5 minutes max, long enough
that quota stays well under 10k reads/day at 2 devices.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Listeners primary; defensive poll at 5min.
- **Pick B** — Listeners primary; no fallback poll.
- **Pick C** — Polling unchanged; listeners as additive optimization.

---

## TODO #2 — Subscription granularity + module location

E-3 needs to decide both the **shape** of the subscription (which
Firestore primitive to call) and **where** the listener
infrastructure lives in code.

**Shape options:**

**(a) Per-collection subscription, 6 total — one per store.**
`SyncFirestore.subscribe('users/{uid}/meds', cb)` fires on any
change to any meds doc. The callback walks the full collection
snapshot and dispatches to `SyncMergeMeds.merge(...)`. Symmetric
with the existing `getCollection` pattern at the per-store merge
fns. **6 active listeners, bounded.** Each listener fires on the
collection level — large bulk writes coalesce into a single
snapshot event (Firestore batches naturally). **Per-snapshot work**:
the callback walks all docs each time, but the per-store merge fn
is already idempotent + LWW-aware, so re-processing on every
snapshot is correct.

**(b) Per-record subscription — listener per doc.**
`SyncFirestore.subscribe('users/{uid}/meds/{medId}', cb)` per
record. **Unbounded listener count.** Each med adds a listener;
each history session adds a listener; etc. At 100 meds + 1000
sessions + 90 days × 1 rest_log entry + 50 presets + 1000 BFRB
events + 500 distractions, that's ~2,750 active listeners per user.
**Firestore enforces a soft limit of ~100 active listeners per
client** before performance degrades; this option crashes through
that limit. Not actually viable at realistic data scale.

**Auditor's lean on shape: (a) — per-collection.** (b) is
structurally wrong at Tempo's data scale. Per-collection is the
only viable shape; surface this in the TODO mostly for completeness
+ to document why per-record was rejected.

**Module location options:**

**(c) Extend `js/sync-engine.js`.** Listener lifecycle lives next to
the existing `startSteadyState` / `stopSteadyState` lifecycle. ~300
LOC added to a 2166-LOC file (post-E-2). **Trade-off:** sync-engine
grows toward 2500 LOC. Tight coupling to existing lifecycle.

**(d) New `js/sync-listeners.js` module.** ~300-400 LOC IIFE
encapsulating the listener subscription registry + per-store
dispatch + visibility/network event handling. `js/sync-engine.js`
calls `SyncListeners.start(SYNCED_STORES)` and
`SyncListeners.stop()` from its existing lifecycle seam. **Trade-off:**
cleaner module boundary; one more file to load; symmetric with
`js/sync-buffer.js`'s factoring choice (E-2 chose to put the
buffer in its own module).

**Auditor's lean on location: (c) — extend `js/sync-engine.js`.**
The listener lifecycle is tightly coupled to the steady-state
lifecycle (subscribe at the same gate, unsubscribe at the same
teardown, share the visibility/network event handling). Splitting
into a new module creates two near-identical wire-ups. E-2's
`js/sync-buffer.js` factoring decision worked because the buffer is
an orthogonal concern (storage + drain); listeners are NOT
orthogonal — they're a different scheduler for the same merge
work. Sub-decision: if the LOC budget feels uncomfortable, split
the per-store dispatch seam (~50 LOC) into a helper file but keep
the lifecycle in sync-engine.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Per-collection subscriptions (6 total) + extend `js/sync-engine.js`.
- **Pick B** — Per-collection subscriptions + new `js/sync-listeners.js` module.
- **Pick C** — Per-record subscriptions (not recommended — exceeds Firestore listener limit).
- **Pick D** — Keep current polling-only architecture and ship E-3 as polling-tuning instead.

---

## TODO #3 — Throttle / debounce shape

PLAN.md §E-3 specifies "debounce 1s to avoid thrash when bulk
writes arrive in quick succession." How exactly?

**(a) Trailing 1s debounce, per-store.** First snapshot in a burst
queues a merge; subsequent snapshots within 1s reset the timer;
merge fires 1s after the last snapshot in the burst. Per-store —
a burst in `meds` doesn't delay a single change in `presets`.
**Trade-off:** worst-case latency from first cloud write to local
merge = 1s + merge time. Best for read-budget (one merge per
burst). Matches the existing `console.warn`-suppression debounce
patterns inside per-merge-fn bodies (e.g., reconcile collision
warnings).

**(b) Leading + trailing debounce, per-store.** First snapshot
fires merge immediately; subsequent snapshots within 1s queue a
trailing merge after the burst ends. **Trade-off:** first-event
latency drops to ~0 (responsive feel) but bursts fire merge twice
(immediate + trailing). Read-budget worse by ~2× under bursty
loads.

**(c) Coalesce-window — single merge per 1s rolling window.**
Snapshots accumulate in a window; one merge fires when the window
closes; new snapshot starts a new window. Mathematically
equivalent to (a) for bursty loads but with a less natural call
shape. **No advantage over (a) for Tempo's UX.**

**(d) Per-store debounce off; merge-on-every-snapshot.** Maximum
responsiveness; maximum read cost. Bulk writes to a single store
(e.g., a full re-hydrate kicked from another device) would fire
N merges instead of 1. **Read-budget-burning;** not recommended.

**Auditor's lean: (a) — trailing 1s debounce per-store.** Best
balance for the 99% case: a single user action on the other device
triggers ~1 snapshot → 1s delay → 1 merge. Bursty case (the user
edits a preset 5 times rapidly on the other device) → 5 snapshots
within ~3 seconds → 1 merge 1s after the last edit. Worst-case
latency is bounded to the debounce window, and the local user
sees the final state, not intermediate states (which is the
correct LWW semantic).

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Trailing 1s debounce, per-store.
- **Pick B** — Leading + trailing 1s debounce, per-store.
- **Pick C** — Coalesce-window 1s, per-store.
- **Pick D** — No debounce; merge per snapshot.

---

## TODO #4 — Visibility + network event handling

Listeners' lifecycle is gated by tab visibility (Chrome throttles
backgrounded tabs aggressively; iOS Safari suspends WebViews) and
network state (offline = no point holding a subscription).
`js/sync-engine.js:2055-2122` already has working visibility +
network event handlers for the polling timer; E-3's listeners need
adjacent handlers.

**(a) Pause-and-unsubscribe on hidden / offline; re-subscribe + one-shot catch-up pull on visible / online.**
On `visibilitychange` to hidden OR `Platform.network.onChange(offline)`,
unsubscribe all 6 listeners. On `visibilitychange` to visible OR
`Platform.network.onChange(online)`, re-subscribe + fire a one-shot
`_runMergeCycle()` to catch up on whatever was missed during the
paused window. **Trade-off:** conserves Firestore reads while
hidden (Firestore listeners DO continue consuming reads while the
SDK is alive — they're not zero-cost during idle). Catch-up
`_runMergeCycle()` on resume adds 6 reads at every visibility flip
+ network event, but the alternative is missed changes.

**(b) Keep listeners armed across visibility/network state.** Browser
+ SDK handle the throttling internally; the engine doesn't actively
unsubscribe. **Trade-off:** simpler code; reads burn while backgrounded
(Chrome's keep-alive interval). On iOS, the WebView suspension may
break the listener entirely — without active resubscription, the
listener stays "dead" until the next manual reload.

**(c) Hybrid — unsubscribe on hidden but keep `Platform.network.onChange` armed.**
On hidden: unsubscribe listeners; keep network listener live but
don't trigger merges. On network change to online: trigger
`_runMergeCycle()` once but don't re-subscribe to listeners until
the tab becomes visible. **Trade-off:** middle ground — saves reads
while hidden; catches network blips while backgrounded; pays
visibility-flip cost only on actual return.

**(d) Listeners always paused while hidden; never re-subscribe on
visibility-only events; only re-subscribe when the tab is visible
AND online for >5s.** Strict cost-minimization. **Trade-off:** lots
of "I tapped to laptop and waited 5s before my dose showed up" UX
regressions. Not recommended.

**Auditor's lean: (a) — pause-and-unsubscribe + catch-up pull.**
The catch-up `_runMergeCycle()` on resume is the safety net for
the scary "iOS Safari suspended the WebView for 30 minutes" case.
The 6-read cost per visibility flip is small relative to the
~3,500 reads/day from the fallback poll. Matches the existing
visibilitychange pattern (timer pauses on hidden, resumes on
visible) so the model is consistent.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Pause-unsubscribe on hidden/offline; re-subscribe + catch-up pull on visible/online.
- **Pick B** — Keep listeners armed; SDK + browser handle throttling.
- **Pick C** — Hybrid — unsubscribe on hidden; trigger merge on network online without re-subscribing.
- **Pick D** — Strict cost-minimization; only re-subscribe when visible + online for >5s.

---

## TODO #5 — Downlevel-warning toast dedup policy

The new `Toast.downlevelWarning(remoteSchemaVersion)` fires on
refuse-writeback events (F19a). Refuse-writeback can fire from
**three independent code paths**:
- Per-record CAS in `js/sync-firestore.js:360-365`
  (`tx.refuseWriteback` throws inside `runTransaction`).
- Per-merge-fn cloud-side gate in each `js/sync-merge-*.js` body
  (`Schema.isFutureRecord` filter).
- Dispatcher snapshot pre-filter at
  `js/sync-engine.js:297-374` (`_filterFutureRecordsInSnapshot`).

With listeners running, a user whose other device has a future-
schema record will hit ALL THREE paths repeatedly. Without dedup,
the toast can fire dozens of times per minute. How to dedup?

**(a) Fire on every refuse-writeback event.** Maximum
informativeness; high noise; potentially user-hostile. Not
recommended.

**(b) Fire once per session — module-scope `_downlevelWarningShown` flag.**
First refuse-writeback event paints the toast + sets the flag.
Subsequent events `console.warn` but don't paint. Flag resets on
sign-out + page reload. **Trade-off:** clean UX; user sees one
clear message; risk that the user dismisses without noticing.

**(c) Fire once per unique remote `deviceId` that minted the
future record.** Module-scope `Set<deviceId>` of devices that
have triggered the warning this session. **Trade-off:** more
nuanced UX ("your phone is on a newer version" vs "another device
is on a newer version") but requires the refuse-writeback event
payload to carry the remote `deviceId`. The per-record CAS path
(`tx.refuseWriteback`) has access to the remote record's
`deviceId` via the `remoteRecord` argument; the per-merge-fn
cloud-side gate has it via the record's existing `deviceId`
stamp; the dispatcher snapshot pre-filter has it via
`record.deviceId`. Wire-up is mechanical.

**(d) Fire once per (remote `deviceId`, `schemaVersion`) pair.**
Dedup further so a device that previously triggered the warning
at v=2 fires again if it now mints v=3 records. **Trade-off:**
maximum informativeness; rare benefit in practice (downlevel
clients usually update once and the cycle ends).

**Auditor's lean: (b) — once per session.** Solo personal-use UX
target — Kyle is the user, the toast's job is "remind me to
update my laptop browser when I see this." Once per session
strikes the balance. (c) adds wire-up complexity for marginal
benefit (Kyle knows which device is ahead). (d) is over-
engineering. (a) is just noise.

**Module-side implementation:** `js/sync-toast.js` adds a
module-scope `let _downlevelWarningShown = false;` inside the IIFE;
`downlevelWarning(...)` checks the flag and bails if true;
SyncEngine's `signOut` path emits a `'sign-out'` event the toast
listens on to reset the flag. Tests cover: first event paints;
second event no-ops; sign-out + event paints again.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Fire once per session; reset on sign-out.
- **Pick B** — Fire on every refuse-writeback event.
- **Pick C** — Fire once per unique remote `deviceId`.
- **Pick D** — Fire once per (`deviceId`, `schemaVersion`) pair.

---

## TODO #6 — Sync activity indicator placement + shape

The existing `#cloud-sync-status` div at `index.html:167-168` is
where the engine currently writes status text (hydrate progress,
push progress, reconcile progress). It's `aria-live="polite"` so
updates announce. E-3 needs to surface listener connection status
+ last-sync time so the user can verify sync is active without
opening DevTools.

**(a) Extend `#cloud-sync-status` text content.** Single text line
like "Last sync 3 min ago · Listeners connected" or "Disconnected
· Will retry on resume". `tempo-nav.js` subscribes to
`SyncEngine.on('listener-connected'|'listener-disconnected'|'merge-complete', ...)`
and updates the text content + visibility. **Trade-off:** zero new
DOM; minimal CSS; aria-live announcements continue to work.
Limited visual hierarchy (just text).

**(b) Separate row with dot indicator.** New `<div>` inside the
Cloud Sync section with a colored dot (green = connected,
yellow = paused, red = error) + small status text. CSS: 0.5rem
circle + `background-color` per state. **Trade-off:** more
scannable at a glance; adds DOM + CSS; needs a11y treatment for
the color (use a screenreader-only text label alongside).

**(c) Integrate into the Push to cloud button.** Repurpose the
existing `#cloud-sync-push-btn` text to include last-sync info:
"Push to cloud · last sync 3 min ago". **Trade-off:** zero new
DOM; co-locates push + status; button text gets crowded; loses
the listener-status info (just covers last-sync).

**(d) New dedicated "Sync activity" sub-card inside the section.**
Heading + 2-3 lines of state: connection, last sync, fallback
poll status. **Trade-off:** richest information density;
biggest UI footprint; matches a "settings page" mental model.

**Auditor's lean: (a) — extend `#cloud-sync-status`.** Cheapest
to ship; leverages existing aria-live announcer; copy-only change.
If Kyle wants richer visual treatment, (b) ships in a follow-up.
Sub-decision: the text content should follow a stable format
parseable by tests (e.g., `Last sync: <relative time> · Listeners: <state>`)
so the kapture smoke check can assert the format without depending
on visual rendering.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Extend `#cloud-sync-status` text content.
- **Pick B** — Separate row with colored dot indicator.
- **Pick C** — Integrate into Push to cloud button text.
- **Pick D** — New dedicated "Sync activity" sub-card.

---

## TODO #7 — Native (Capacitor) parity scope

Since E-1b, `SyncFirestore.runTransaction` throws `kind: 'unknown'`
with "native parity pending" on iOS (the Capacitor Firebase Firestore
plugin's `runTransaction` shape wasn't verified). Downstream callers
defensive-skip the CAS path on `isNative === true`. E-3 adds
`SyncFirestore.subscribe(path, callback)` which has its own native
path. Bundle native parity work or not?

**(a) Ship web-only `subscribe`; document the native gap.** Native
clients get listener-less fallback (the defensive 5min poll from
TODO #1 still runs on native). **Trade-off:** ships E-3 fast;
preserves the deferred native CAS parity follow-up; iOS users wait
another PR for sub-second propagation. The 2026-05-15 caveat (a)
(setInterval unreliable when tabs unfocused) is only partially fixed
on iOS — the fallback 5min poll runs but doesn't reach sub-second.

**(b) Ship web-only `subscribe` AND web-only `runTransaction`
(unchanged).** Match the current E-1b deferral verbatim. **Same
trade-offs as (a);** explicitly documents that native CAS parity
stays deferred.

**(c) Ship `subscribe` native parity in this PR; leave
`runTransaction` deferred.** Native `addSnapshotListener` is part
of `@capacitor-firebase/firestore` and the call shape is
documented. The Capacitor plugin returns a callback handle that
exposes `.remove()` — symmetric with the web `onSnapshot`
unsubscribe fn. **Trade-off:** moderate scope expansion (~30-50
LOC in `js/sync-firestore.js`); tests need a `Platform.isNative`
mock for the native branch. Brings iOS to feature parity for
listeners; CAS parity stays as its own follow-up.

**(d) Ship BOTH `subscribe` AND `runTransaction` native parity in
this PR.** Resolves the long-standing E-1b deferral. **Trade-off:**
significant scope expansion (~150-200 LOC); CAS-parity tests need
end-to-end iOS-platform verification that's hard to automate;
extra PR review surface. Risk of slipping the E-3 ship date for
unrelated work.

**Auditor's lean: (c) — ship `subscribe` native parity, defer
CAS.** iOS users feel the polling-suspension caveat hardest; the
listener parity is exactly the fix they need. CAS-parity is a
separable concern (no E-3 functionality depends on it). Sub-
decision: file a follow-up issue for native CAS parity at the
same time, citing the E-1b/E-3 carry-forward.

**Kyle, pick before Phase 1:**
- **Pick A** — Ship web-only `subscribe`; document gap.
- **Pick B** — Web-only `subscribe`; CAS unchanged (parity stays deferred).
- **Pick C (recommended)** — `subscribe` native parity in E-3; CAS parity stays deferred.
- **Pick D** — Both `subscribe` AND `runTransaction` native parity in E-3.

---

## TODO #8 — E-2 follow-ups bundling

E-2 (PR #73) left two non-blocking opens documented at
`docs/SESSION-LOG.md` (E-2 entry, "Non-blocking open questions"):

- **(i) `typeof SyncBuffer !== 'undefined'` defensive check at
  `js/sync-engine.js:1842` is unreachable in practice.** The
  `const SyncBuffer = (() => { ... })()` declaration creates a
  lexical binding always defined when the script loads. The
  secondary `typeof SyncBuffer.enqueue === 'function'` check IS
  the real feature-detect. One-line symmetry fix.
- **(ii) Pre-existing E-1e tests #6 + #11 `visibilityState`
  flakiness in kapture/headless.** NOT introduced by E-2; exists
  on `main`. The tests assert visibility-handler behavior that's
  hard to trigger reliably in a headless browser without
  privileged APIs. Separate test-infrastructure cleanup.

Should E-3 close these?

**(a) Close (i) only — bundle the symmetry fix.** E-3 modifies
the same neighborhood (`js/sync-engine.js` lifecycle code). A
one-line fix alongside listener work is cheap + clean. (ii) is
test-infrastructure cleanup that's better kept separate so it
doesn't risk slipping E-3's ship.

**(b) Close both (i) AND (ii) in E-3.** Bundle all carry-forwards.
**Trade-off:** test cleanup adds scope; if the visibilityState
mock change breaks 5 other tests, E-3's "feat" commit grows beyond
the headline work.

**(c) Defer both to a separate cleanup PR.** Pure E-3 ship.
**Trade-off:** open questions stay open; (i) ages in the codebase.

**Auditor's lean: (a) — close (i) only.** The symmetry fix is a
one-line follow-up in a file E-3 already touches. (ii) is
orthogonal and risky to bundle.

**Kyle, pick before Phase 1:**
- **Pick A (recommended)** — Close (i) only in E-3; defer (ii).
- **Pick B** — Close both (i) and (ii) in E-3.
- **Pick C** — Defer both to a separate cleanup PR.

---

## Hard rules

- **Audit before code.** Phase 1 = sync-auditor produces
  `docs/sync-impl/audits/E-3-AUDIT.md` and Kyle reviews before
  Phase 2 fires.
- **Phase 4 ui-wirer FIRES.** Settings drawer indicator
  (`index.html`) + toast extension (`js/sync-toast.js`) + likely a
  small `css/styles.css` addition for any new status-indicator
  styling. SMOKE-ONLY mode — synthetic
  `SyncEngine.emit('refuse-writeback', {...})` paints the toast;
  visual check of the status indicator; one neighboring route
  still loads.
- **F-invariant guardrails:**
  - **F10 (envelope stamping at write)** — unchanged. E-3 is read-
    side infrastructure; no new write sites.
  - **F13 (write gate)** — listener-driven merges route through
    the existing per-store merge fns which all check
    `SyncState.canWrite()` via the dispatcher pattern. No new
    F13 path.
  - **F19a refuse-writeback** — preserved verbatim. The 3 existing
    refuse-writeback code paths gain new `SyncEngine.emit('refuse-writeback', ...)`
    calls so the toast can subscribe; no new F19a logic.
- **Local-first contract stays a hard contract.** Listeners are
  read-side; they never block local writes. If the listener
  infrastructure errors out entirely, the fallback poll (per
  TODO #1) keeps cloud-to-local propagation working at degraded
  cadence. No correctness regression from listener failure.
- **Web bytes stay equivalent on GitHub Pages unless `sw.js` is
  also bumped in the same PR.** E-3 bumps `CACHE_NAME` v81 → v82
  so this is covered.
- **Native-only code routes through `js/platform.js` and
  `js/sync-firestore.js`.** No Capacitor SDK imports outside those
  two files. Per TODO #7, `js/sync-firestore.js` is where the
  native `addSnapshotListener` wire-up lives if Kyle picks (c) or
  (d).
- **Engine-no-DOM rule.** `js/sync-engine.js` and
  `js/sync-firestore.js` continue to have zero DOM references.
  Toast paints from `js/sync-toast.js`. Status indicator updates
  fire via `SyncEngine.emit(...)` events that `tempo-nav.js`
  subscribes to (matching the existing hydrate/push/reconcile
  status update pattern).

---

## After E-3 merges

What's left in the cloud-sync initiative:

- **2026-05-15 validation caveats (b), (c), (d)** — three small
  cleanup PRs documented in `CLAUDE.md` backlog item #6:
  - **(b)** Stage D handoff re-fires on every manual "Push to
    cloud" attempt because B-3's read-cloud-first guard always
    sees cloud non-empty post-first-push. Distinguish "first sync"
    from "force re-sync."
  - **(c)** Presets drawer (and likely other surfaces) doesn't
    auto-refresh on sync — reads localStorage on open, doesn't
    subscribe to changes. E-3 listeners + a UI re-render hook
    closes this together; the UI hook may land in E-3 or in a
    fast-follow.
  - **(d)** Reconcile-pass `[SyncEngine] reconcile history
    sessionId collision (cloud wins)` warnings fire one-per-session
    (12 with current data) — should be a single summary log in
    `js/sync-merge-history.js`. Small one-file refactor.
- **iOS "Signing in…" UI label reset bug.** Deferred from PR #74.
  JS-only fix in `js/sync-auth.js` or `js/tempo-nav.js`. Small
  warm-up PR.
- **Stage F (DEFERRED INDEFINITELY)** — Per-store manifest registry (F19c).
- **Deferred legacy-key cleanup PRs** (carry-forward from
  E-1d-f3 + E-1d-f8 — `bfrbs_global` / `flow_bfrbs` /
  `pomodoro_bfrbs` + flat-array distractions + their migration
  markers). No fixed schedule.
- **Native CAS parity follow-up** (still carry-forward from
  E-1b/c/d/d-f3/d-f8/e/2; status depends on E-3's TODO #7 pick).
- **Backlog GC for preset tombstones.** When accumulated
  `deletedAt < (now - 90 days)` records become observable, add a
  periodic purge.

**Cloud-sync initiative milestone:** post-E-3, all Stage E
reliability follow-ups ship. Sub-second cross-device propagation
becomes the default. The initiative reaches functional completion.

---

## Branch + commit conventions

- **Branch:** `feat/sync-stage-e3-listeners`
- **PR title:** `feat(sync): real-time onSnapshot listeners + downlevel warning (E-3)`
- **Commit type prefix:** `feat` for the engine commit; `docs` for
  the PR-shipper post-PR PLAN.md move (matches recent precedent).

---

## Phase 4 scope

Phase 4 ui-wirer FIRES — affected-files table includes
`js/sync-toast.js` (toast extension) + `index.html` (settings
drawer indicator) + likely `css/styles.css` (status-indicator
styling). The orchestrator's standard Phase-4-trigger condition
fires automatically. Phase 4 dispatch contract:

1. Load `http://localhost:8765` in kapture (or Kyle's browser if
   kapture unavailable).
2. Verify NO console errors at boot.
3. Verify `SyncEngine.getState()` shows `{ enabled: <flag state>, initialized: true }`.
4. **Synthetic downlevel-warning test:** In DevTools Console, run
   `SyncEngine.emit('refuse-writeback', { store: 'meds', remoteSchemaVersion: 99, localSchemaVersion: 1 })`.
   Verify the toast paints with the verbatim PLAN.md copy ("Your
   phone is on a newer version. This device is read-only until you
   update."). Verify auto-dismiss after 5s.
5. **Dedup verification (per TODO #5 Pick A):** Emit a second
   `'refuse-writeback'` event immediately. Verify NO second toast
   paints (dedup flag set).
6. **Sync activity indicator verification (per TODO #6 Pick A):**
   Verify `#cloud-sync-status` renders with the expected text
   shape when the master flag is on. Stub
   `SyncEngine.emit('listener-connected', {...})` and verify the
   text updates.
7. Verify one neighboring route still renders (e.g., navigate to
   `#/wellness/meds` and confirm the surface paints without errors).
8. **NO real Firestore connection** — Kyle's two-device manual
   test post-merge is the real E2E check.

---

**Kyle: TODOs 1–8 need your call. TODO #1 (listeners-vs-polling),
TODO #2 (granularity + module location), and TODO #4 (visibility +
network event handling) are the most consequential — they shape
blast radius, the per-store dispatch contract, and the lifecycle
complexity. TODO #5 (downlevel toast dedup) controls UX surface.
TODO #7 (native parity) controls PR scope. Auditor leans all-Pick-A
across the board. Accept all defaults with "all defaults" or
override per-TODO.**
