Agent A — Data-Integrity Audit
Single lens: where can a sync merge silently double-count, drop, or corrupt a record?

1. doseLog dedup key uses (deviceId, takenAt) — fails the central use case
Cite: strategy doc Row 2 + js/meds.js:45-55 (logDose).

Scenario: Kyle takes his 60 mg morning pill at 9:00 AM. He logs it on his phone (deviceId=A, takenAt=9:00:03). Two minutes later he opens his laptop, sees no green check (laptop hasn't pulled yet), worries he forgot, and re-logs the same physical pill with "Took it ~ 2 min ago" (deviceId=B, takenAt=9:00:00). Both rows have different deviceId values, so (deviceId, takenAt) treats them as distinct doses. After sync, getDosesToday() returns 2. For a "twice-daily" prescription, status flips to done and Kyle skips his real evening dose.

v1.0 problem: Row 2's dedup key only catches the self-collision case (same device replays the same record). The cross-device duplicate-entry case — which is the high-stakes scenario the doc is supposedly designed for — is exactly what the key fails on. The Stage D ±60s prompt is the only line of defense, and it fires only at one-time migration, not in steady state.

Fix (strategy): Promote the steady-state dose-merge contract to match Stage D: any two doseLog entries within ±N minutes for the same med should trigger a "same dose or separate?" reconcile, regardless of deviceId. Either (a) auto-collapse if within a tight window (e.g., ±90s) and flag wider near-collisions in a per-med "review" badge, or (b) require explicit user disambiguation for any pair within ±5 min on different devices. The dedup key alone cannot protect the medication record.

2. history.sessions.id migration in Stage D can rewrite IDs that already exist on Device A
Cite: js/history.js:96 (id: session.id || Date.now()); strategy Stage D.

Scenario: Device A has been running standalone for 6 months. It writes a Pomodoro session at id=1735000000000. Six months later Kyle enables sync on Device A (Stage B), then signs in on Device B which has its own offline history including a session with id=1735000000000 (same ms, different content — different timezone, different device, plausible over a long horizon). Stage D says "rewrite colliding session IDs on Device B." But Device A's row was already uploaded with the bare numeric ID under Stage B. After Stage B, Device A's history rows are untagged-but-canonical. Now Device B uploads a row keyed B-1735000000000-0 for the same physical session Kyle remembers logging from a phone that was syncing to Device A's account, and the cloud now has two history rows for one session.

v1.0 problem: Stage B "retroactively stamp every existing record, rewrite session IDs" is described as low risk, but it changes the keyspace before Stage D ever runs. Device B can't detect that a Stage-B-rewritten cloud row corresponds to one of its own pre-sync rows because the pre-rewrite ID is gone.

Fix (strategy): During Stage B, preserve the original bare Date.now() ID as a secondary index field (e.g., legacyId) on every rewritten row, kept until Stage D completes for all paired devices. Stage D's reconcile pass joins on (legacyId, duration, type) before falling back to ID rewrites. Without this, the only safety net is duration+type heuristics, which don't disambiguate two same-day Pomodoros.

3. bfrbs_global / flow_bfrbs / pomodoro_bfrbs — strategy lists "BFRB / distraction logs" as one row but they live in three storage keys with runtime routing
Cite: CLAUDE.md storage map (bfrbs_global, flow_bfrbs, pomodoro_bfrbs); strategy Row 6.

Scenario: Kyle starts a Flow block on his phone. He catches a nail-biting episode and taps the global BFRB FAB. js/global-bfrb.js routes the entry to flow_bfrbs because a Flow session is running. He then resets Flow on the phone, syncs, and opens the laptop where Flow is also mid-session (Row 7 server-arbitration unresolved — see finding 5). The laptop has its own flow_bfrbs snapshot and its own bfrbs_global. After sync: which bucket does the entry live in? If both devices flush their flow_bfrbs at session-end into session.bfrbs for history (per CLAUDE.md), the count gets written into the history row twice — once per device's local view of the in-flight session.

v1.0 problem: Row 6 treats BFRB as one logical stream but the three storage keys have runtime routing semantics (which key receives the write depends on whether a Flow/Pomodoro session is running locally). Sync merging the three keys independently doesn't reproduce that routing logic.

Fix (strategy): Either (a) treat the three keys as a single logical append-only stream tagged with context: 'flow'|'pomodoro'|'global' at write time, sync as one stream, and let the UI filter; or (b) explicitly exclude flow_bfrbs and pomodoro_bfrbs from sync — they are session-local scratchpads that fold into session.bfrbs on session-end and the synced history row is the source of truth. The current "Append-merge, dedup by (deviceId, loggedAt)" cannot model the routing.

4. wellness_meds.lastTakenAt is a derived mirror but gets serialized — sync will fight it
Cite: js/meds.js:54, js/meds.js:105-110, js/meds.js:138-142 (lastTakenAt = doseLog[doseLog.length - 1].takenAt).

Scenario: Phone logs a 9:00 AM dose. lastTakenAt = 9:00. Laptop logs an earlier "Took it ~ 4 hours ago" entry at 5:30 AM (real morning dose Kyle forgot to log). Locally, loadState re-derives lastTakenAt from the sorted log so it lands on 9:00. But the serialized state uploaded by each device contains lastTakenAt: 9:00 (phone) and lastTakenAt: 5:30 (laptop, before the merge runs). Under Row 1's "LWW per-field with updatedAt" rule, the older lastTakenAt: 5:30 write could win the field merge if its updatedAt happens to be later. The synced state then has lastTakenAt: 5:30 while doseLog ends at 9:00 — internally inconsistent.

v1.0 problem: Row 1 treats med fields as independent LWW scalars, but lastTakenAt isn't a primary field — it's a cache of doseLog[len-1].takenAt. Syncing it as LWW lets the cache and the source of truth disagree.

Fix (strategy): Mark lastTakenAt as non-synced / derived-on-load. Each device re-derives it from the merged doseLog after the doseLog merge completes. Same applies to any cached counters. The strategy's per-store table needs a "derived (do not sync)" column.

5. multi_state.primaryStopwatchId is a single value with no version — and Stopwatch/Timer are live module bindings
Cite: js/instance-manager.js:7-8, js/instance-manager.js:36-41, js/instance-manager.js:86; strategy Row 7 marked ❓.

Scenario: Kyle has 3 stopwatches on his phone (A, B, C; primary=A). He pulls down on his laptop, where he had primary=B. LWW silently picks one. Worse: setPrimaryStopwatch reassigns the module-global Stopwatch binding (Stopwatch = instance), and per CLAUDE.md "all existing code in ui.js, offset-input.js, etc. automatically operates on the new primary." A sync that swaps primaryStopwatchId mid-render can swap which engine Stopwatch.start() calls reach. If a user taps Start exactly as the sync lands, the Start can register against a different instance than the one shown on screen.

v1.0 problem: Row 7's "server-arbitrated, single active device" treats engine state as a snapshot, but primaryStopwatchId isn't engine state — it's per-device UI focus. There's no single right answer that applies to both devices. Adding updatedAt makes it LWW-arbitrary.

Fix (strategy): Treat primaryStopwatchId and primaryTimerId as per-device UI prefs — exclude from sync, keep them on the low-stakes block alongside theme and display_mode. Sync the list of stopwatch instances and their states (under whatever Row 7 resolves to) but let each device pick its own primary. This also resolves the live-binding race because primary swaps stay local.

6. Pomodoro phaseLog is append-only inside an LWW snapshot — merges will eat phase-end records
Cite: js/pomodoro.js:21, js/pomodoro.js:125, js/pomodoro.js:138-143, js/pomodoro.js:175-176, js/pomodoro.js:207-215; strategy Row 7.

Scenario: Kyle starts a Pomodoro on his phone. Work phase completes; phaseLog gets an entry pushed (pomodoro.js:125). He then walks to his laptop, which had a stale pomodoro_state snapshot from yesterday's reset (empty phaseLog). The laptop wakes up, fires periodic sync, and writes its snapshot with updatedAt = Date.now() — after the phone's snapshot. Under Row 7's "server-arbitrated single active device" the laptop is rejected only if the server knows the phone is the active device. But what if the laptop's local sync timer fires between the phone's two phase-end events? The laptop has no idea Pomodoro is even running on the phone; its snapshot is "valid." Server arbitration based on deviceId == active requires both devices to agree on who is active — that handshake is undefined in v1.0.

v1.0 problem: Row 7 says "single active device, stale snapshots from others must yield" but doesn't define how a non-active device's idle snapshot gets prevented from overwriting the active device's running snapshot. The doc's ❓ on Row 7 captures this, but the fallback "exclude live state from sync" alternative doesn't address the embedded phaseLog array — that's history-relevant data accumulated during the session, not just engine state.

Fix (strategy): Split Row 7. Engine position (startedAt, accumulatedMs, status) follows server-arbitration or device-exclusion (your call). Engine event history accumulated during the session (phaseLog, phaseStartedAt-derived breadcrumbs) writes to a separate append-only stream keyed by (deviceId, sessionStartedAt, phaseStartedAt) and folds into the final history.sessions row at session-end. This makes the cross-device-mid-session handoff a non-event for phaseLog.

7. Flow.endFocusEarly and checkFinished write accumulatedMs from in-flight clock — duplicate triggers across devices double-count
Cite: js/flow.js:138-153, js/flow.js:178-207.

Scenario: Kyle has a Flow block running on his phone. The phone's tab goes to background and the OS suspends the WebView. He opens the laptop, signs in, and (per Stage E) the laptop pulls the latest flow_state. The laptop's loadState runs the "phase should have finished while page was closed" branch (flow.js:265-273), advances to overflowing, sets focusEndedAt = now, and alarmFired = true. The phone wakes up, runs its own identical "should have finished while closed" branch on its stale local state, and also sets focusEndedAt = now with a different timestamp. Now the cloud has two flow_state snapshots, both claiming end-of-focus, with different focusEndedAt. Whichever wins, the eventual history row (session.blockDurationMs, endedEarly, overshootMs) reflects only one device's view of when zero-cross happened.

v1.0 problem: loadState treating "phase should have finished" as a local mutation means every device that loads stale state can independently fire the alarm and stamp focusEndedAt. Row 7's arbitration doesn't catch this because both devices believe they're recovering, not competing.

Fix (strategy): State loadState recovery actions (auto-advance to overflowing, stamping focusEndedAt, marking alarmFired) must not be persisted back to the cloud. They are local rendering decisions. Only an explicit user action (startRecovery, skipRecovery, endFocusEarly) writes back. Equivalently: all engine state stores need a "last meaningful user action" timestamp distinct from "last serialized," and only the former participates in merge.

8. pomodoro_distractions / flow_distractions cleared on session-start can resurrect via sync
Cite: CLAUDE.md ("clears alongside distractions on session start/reset/complete"); strategy Row 6.

Scenario: Phone has 3 distractions logged from this morning's Flow session. Phone clears flow_distractions to [] when the session resets. Phone goes offline before sync. Laptop, last synced an hour ago, still has the old non-empty flow_distractions (it's append-merge per Row 6). Laptop syncs first; cloud now holds the 3-distraction array. Phone reconnects, append-merges its empty array against the cloud, and the 3 distractions resurrect — now attached to a fresh session that didn't generate them. Either they fold into the next history row's distractions field (corrupt), or they appear in the in-progress UI (confusing).

v1.0 problem: Append-merge of an event stream is correct, but the storage key isn't actually append-only — it's reset to [] on session boundaries. Append-merge cannot represent a "reset" event without tombstones, and Row 6 doesn't define them for distraction streams.

Fix (strategy): Either (a) make distraction storage truly append-only (never clear; instead key entries by sessionId and have UI filter to current session), or (b) emit an explicit session-cleared tombstone event into the same stream when reset fires, so other devices' merges can drop pre-reset entries. Row 6's "Append-merge, dedup by (deviceId, loggedAt)" is incomplete without one of these.