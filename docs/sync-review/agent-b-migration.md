Agent B — Migration Audit
Single lens: walk a real user through state transitions and find what breaks.

Scenario 1 — First-time enable (Stage B)
Walk. Kyle has 6 months of local data on phone. He taps "Enable sync." Per the strategy:

Generate deviceId → write to tempo_device_id.
Retroactively stamp every existing record with deviceId.
Rewrite history.sessions.id from bare Date.now() to ${deviceId}-${Date.now()}-${counter}.
Upload one-shot snapshot.
Broken assumptions.

No "is cloud empty?" check is specified. Stage B assumes cloud is virgin — "single source of truth, no merge." But the doc never describes what checks this. If Kyle previously enabled sync from a forgotten device (test build, an earlier laptop, a sibling installing on his account by mistake), Stage B silently overwrites cloud with phone. That is a one-shot data-loss event and the user is never told. Stage D's reconcile prompt only triggers for Device B — Stage B has no equivalent.
Step 3 (rewrite session IDs) mutates the IndexedDB primary key. js/history.js:14 declares keyPath: 'id' on the sessions store. You cannot mutate id in place; you must delete + put. The strategy reads as if this is a free pass. If the rewrite is interrupted (tab close, OOM, quota), some sessions have new IDs and some keep Date.now(). Subsequent merges will treat the latter as new rows and the former as overwrites.
addSession (js/history.js:96) defaults id: Date.now() when not provided. Any session-end firing during the Stage B rewrite (e.g. Kyle's flow block was running when he tapped Enable) gets a bare-int ID into a store that's mid-migration. That row is invisible to the rewrite pass.
updatedAt fields don't exist anywhere yet. Strategy Row 1 ("LWW per-field with updatedAt") and Row 4 (note/tags LWW) require a timestamp the engines don't write. History.updateNote (js/history.js:134) and addTag (js/history.js:157) mutate without stamping. Stage B has no plan to back-fill these — without it, every existing note/tag has updatedAt = undefined, and the first cloud write from any device overwrites them all.
No backup before mutation. Doc itself flags this as ❓. Confirming: there is no current code path that exports state to file before stamping. Persistence.clear() (js/persistence.js:10) is the closest thing and it deletes — it doesn't snapshot.
Strategy-level fixes.

Add Stage B0: "Read cloud first; if non-empty, route through Stage D reconcile path even though local user thinks this is first enable." Treat all enables as potentially-second-device.
Mandate a local backup file written before any mutation begins. If Stage B fails partway, restore-from-backup is the rollback.
Define updatedAt back-fill explicitly: at stamping time, set every record's updatedAt = sessionEndedAt || date || Date.now() so server LWW has a baseline.
Block all writes (engine starts, dose logs, note edits) while stamping is in flight — same pattern Stage C is asking for.
Data-loss risk: HIGH if cloud was previously seeded. MEDIUM otherwise (interrupted rewrite leaves IDs split).

Scenario 2 — New device install (Stage C)
Walk. Phone has sync. Kyle installs on laptop, signs in. Laptop's localStorage and IndexedDB are both empty. Strategy says "pull-down hydrate. Trivial."

Broken assumptions.

App boots before pull completes. js/app.js calls Persistence.load() and MedsManager.loadAll() on init — these are synchronous reads of localStorage. They run before any network round-trip. Result: app paints with empty meds list, empty history, no presets, no rest log. If Kyle taps "Took it now" in those first 2 seconds, MedsManager.add (js/meds.js:177) generates a new med ID with the laptop's deviceId — and that record will fight the about-to-arrive cloud meds list when pull completes. We get duplicate med rows, not merged ones.
InstanceManager.loadAll (js/instance-manager.js:92) silently falls through to migrateLegacy() on empty storage. That's harmless on a fresh device, but it documents the assumption: "no multi_state ⇒ assume fresh install." There is no concept of "no multi_state yet, pull is pending."
The doc's footnote on Stage C ("UI shows a sync indicator and blocks new writes until pull completes") is the right fix but is still marked ❓. It needs to be Locked, and the lock needs to specify which writes are blocked — the engines don't share a write gateway. Every module (MedsManager, History, Persistence, BFRBRecovery, etc.) writes to its own store directly.
Partial pull failure has no recovery. History is an IndexedDB getAll() round-trip; meds is a single localStorage blob; rest log is another blob; presets are more blobs. If meds arrives but history times out, the laptop is in a half-hydrated state with no marker. Next boot, loadAll() finds non-empty meds storage and assumes "this device is hydrated" — the missing history is now invisible until something forces a full re-pull.
History id collisions on partial hydrate. Cloud has rows with ${deviceId}-${ts}-${ctr} IDs. If pull is interrupted mid-batch and the laptop logs a session with bare Date.now() (the not-yet-migrated default — see history.js:96), the next pull-merge can't tell that local row from cloud rows from other devices.
Strategy-level fixes.

Promote the parenthetical Stage C lock (block writes during hydrate) to a hard requirement. Add a tempo_sync_state localStorage key with values { hydrating, ready, error } — every engine reads it before any write. Hydrate failure leaves the device in error state, not ready-but-empty.
Stage C must hydrate in a strict order: rest-log → meds → presets → history. Reason: history is the largest payload; if it fails partway, everything else is already correct. Mark each store as hydrated independently.
A new device should generate deviceId before the first user gesture, even before pull starts, so any in-flight session-end during hydrate produces a properly-shaped ID, not a bare Date.now().
Data-loss risk: LOW for the canonical happy path. MEDIUM for partial-pull-then-write — produces phantom rows that survive forever.

Scenario 3 — Offline merge (Stage E)
Walk. Phone offline 24h, Kyle logs 4 doses (logDose at meds.js:45 appends to doseLog). Laptop logs 1 dose during that window. Phone reconnects.

Per strategy Row 2: doseLog is append-merge, dedup by (deviceId, takenAt). Open-questions section ✅-locks: "Buffered writes always preserve the original wall-clock timestamp."

Broken assumptions.

doseLog entries do not currently carry deviceId. meds.js:49 stores { takenAt: when } — nothing else. Strategy Row 2's dedup key cannot be computed against existing rows. Offline buffering of new doses can stamp deviceId, but the cross-device dedup against pre-stamped rows is undefined. Two phones logging at the exact same takenAt (rare but possible — twice-daily med, set alarm at 8:00:00, both phones log when alarm fires) will get one of them dropped if dedup is naive.
5 doses × 4 fields will silently arrive on laptop with no UI. Strategy ✅-locks "silent LWW" for non-medical race conflicts but doesn't address append-merge surprise — Kyle on the laptop will see his "1 dose taken today" suddenly become "5 doses taken today" with no indicator that 4 of them came from his offline phone. The getStatusToday derivation (meds.js:92) goes from partial to done mid-glance. For prescription compliance, the user needs to know this happened — even a one-line toast.
MedsManager.saveAll is a single blob (meds.js:196). It serializes the entire med list and overwrites wellness_meds localStorage atomically. There is no per-dose write granularity. So when the laptop pulls 4 phone-doses, the merge has to:
Read full local meds blob.
Append phone's 4 entries into the matching med's doseLog.
Sort + truncate (the engine itself caps at 200 entries — meds.js:53).
Write blob back.
Step 3 is dangerous: if the user is at 197 entries locally and 4 sync in, the truncation drops the oldest 1, silently. The strategy's "append-merge, never lossy" promise is violated by an engine constraint nobody has reconciled.
Partial failure mid-merge has no transactional boundary. localStorage writes are synchronous and atomic per-key, but if Kyle has 5 meds and the merge writes to 5 different blobs (it doesn't, but consider per-store), interrupted merges leave the user in a state where one med is updated and another isn't. With the single-blob design it's atomic — but then you can't apply partial cloud data either.
Clock-skew guard (meds.js:147) drops entries > now + 60000. If the laptop's clock is 5 minutes behind the phone's, legitimate future-dated dose entries from the phone get dropped on loadState. Sync makes cross-device clock mismatch normal; the engine still treats it as corruption.
Flow loadState (flow.js:243) and Pomodoro loadState (pomodoro.js:217) auto-advance state when remaining ≤ 0. If Row 7 lands on "sync engine state," a stale snapshot from offline phone (hours-old startedAt) pulled into laptop will instantly transition to overflowing on load — phantom session completions written to history.
Strategy-level fixes.

Lock deviceId stamping into logDose itself before any sync work begins. Migrate existing entries by stamping with a sentinel legacy deviceId. Without this, Row 2's dedup key is a fiction.
Surface append-merge results: a non-blocking toast ("4 doses from your phone synced") for any append-merge that adds ≥2 entries. Health-data silent merges are dangerous even when "correct."
Replace the 200-entry truncate with a soft cap that warns instead of silently dropping. Or: raise to 1000. doseLog is the only health record — losing oldest entries to merge pressure is unacceptable.
Replace the ±60s future-clamp with a wider tolerance (±15 min) when a record carries a non-local deviceId — distinguish "my clock skewed" from "another device's clock differs."
Reaffirm the doc's own "exclude live engine state from sync" alternative on Row 7. Engine-state snapshots have an inherent staleness problem that no arbitration scheme cleanly fixes; only-sync-completed-history is the safe call.
Data-loss risk: HIGH for the doseLog truncation at the 200-entry boundary. MEDIUM for clock-skew false-drops. LOW for the silent-merge UX issue (data is correct; user awareness is not).

Cross-cutting findings
No engine writes updatedAt today. Every LWW row in the strategy assumes a field that doesn't exist. This is the single biggest gap.
No engine writes deviceId today. tempo_device_id is a localStorage key the strategy plans — it is not in the codebase.
History session IDs are integers. history.js:96 falls through to Date.now() — used as IndexedDB primary key. Any rewrite must coordinate with active session-end callers across app.js, cooking-ui.js, flow-ui.js, pomodoro-ui.js, interval-ui.js. Strategy underestimates this surface.
Stage D's ±60s reconcile prompt is correct in spirit but operationally hard. With 6 months × twice-daily = ~360 doses on each device, a prompt-per-collision UI is unrealistic. Recommend Alternative 2 (separate-bucket "imported" history visible alongside synced) as the safer default, with an opt-in "merge & dedupe" tool later.