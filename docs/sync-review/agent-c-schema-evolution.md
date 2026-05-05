Agent C — Schema-Evolution Audit
Single lens: if sync transports records between client versions, what assumption breaks?

1 — No schema version tag anywhere on records
File: js/meds.js:105-111 (getState), js/history.js:95-125 (addSession), js/instance-manager.js:78-90 (saveAll), js/pomodoro.js:207-215 (getState), js/flow.js:234-241 (getState).

Broken state: Every payload the sync layer would ship is a bag of fields with no schemaVersion and no source-app version stamp. A v1.6 client that adds a field cannot tell, on read-back, whether a missing field means "v1.5 wrote this and didn't know about it" vs. "v1.6 wrote this and the user explicitly cleared it." A v1.5 client that receives a v1.6 record cannot tell that it's downlevel and should preserve unknown keys instead of round-tripping a partial copy back to the server (where an LWW write then deletes the v1.6-only field for everyone).

Fix: Stamp every synced record with schemaVersion: N (per store) at write time. On read, validation-on-read accepts <= currentVersion straight through, and > currentVersion is treated as "preserve & passthrough" — keep all unknown keys, never drop them, never write back. Combine with a forward-compatible spread: loadState keeps _unknownFields so re-serializing doesn't lose them. Without this, every additive field is a silent destroy-on-downgrade.

2 — loadState strips every field it doesn't recognize
File: js/pomodoro.js:217-269, js/flow.js:243-292, js/meds.js:113-151.

Broken state: All three engines reconstruct state from a fixed list of state.foo ?? default reads. A v1.6 record with state.cycleNumber (renamed from cycleIndex) plus a new state.workSpansCount will arrive at v1.5, get parsed, and re-emitted by getState() containing only the v1.5-known keys. The next sync push deletes v1.6's new fields server-side under any LWW-per-record strategy. This is silent, not a crash. Templates/presets row 9 of the strategy table (LWW per record by id+updatedAt) is the highest-risk spot because edits roundtrip frequently.

Fix: Either (a) freeze the field list per store and require additions to ship as a new store (cumbersome), or (b) capture state at top of loadState, store unknown keys on a __forward blob, and merge them back in getState(). Pair with #1's schemaVersion so a downlevel client knows it's seeing a future record and switches to passthrough mode.

3 — wellness_meds save is whole-document replacement, not per-record
File: js/meds.js:196-201 (saveAll writes a single { meds: [...] } blob to one localStorage key).

Broken state: The strategy's per-row table treats wellness_meds as if individual meds and doseLog entries are independently syncable. The current code serializes the entire meds array as one document. Any sync layer that writes the whole blob will race: phone's most recent save (with dose: "60 mg" edit) loses to laptop's slightly later save (with dose: "40 mg" no edit but a new dose log entry) — last-write-wins eats the dose-text edit even though the strategy says "LWW per-field."

Fix: The persistence shape needs to split before sync ships. Each med becomes its own keyed record (meds/{medId}), and the doseLog is its own append-only subcollection. Otherwise the strategy doc's per-field LWW is a fiction — there's no per-field granularity in the wire format. This is structural, not just a flag.

4 — history.sessions.id = Date.now() collides across devices today, before sync ships
File: js/history.js:96 (id: session.id || Date.now()).

Broken state: Stage D in the strategy doc acknowledges this for the future cutover, but the same risk exists now if the user uses the existing JSON export/import (js/export.js) to move data between phone and laptop manually. Two simultaneous session-ends on two devices, both currently Date.now(), produce identical IDs. IndexedDB keyPath: 'id' upserts — store.put overwrites — so the second import silently destroys the first session.

**Fix:** Migrate `id` shape to `
d
e
v
i
c
e
I
d
−
deviceId−{Date.now()}-${counter}` *before* sync ships, not as part of Stage B. Pair with a one-time backfill of existing rows. If the strategy treats Stage A as "✅ Lock," the lock should include "session IDs are device-scoped from this point forward" — otherwise the manual-import workaround that's currently in production is a corruption risk.

5 — Pomodoro phaseLog and Flow goal survive loadState but have no per-entry IDs
File: js/pomodoro.js:21,239 (phaseLog = state.phaseLog ?? []), js/flow.js:257 (goal = state.goal ?? '').

Broken state: phaseLog is an array of { phase, startedAt, endedAt, overshootMs }. No entry IDs. A "single active device" arbitration model means the engine state shouldn't merge — but if the strategy ever loosens to "let each device contribute phase entries to the same session," there's no merge key. Two devices that both completed a phase log will produce two arrays the merge layer can't reconcile.

Fix: Even under the ✅-locked "server-arbitrated single active device" model, this is a gotcha when a device is briefly offline and writes phaseLog locally before knowing it lost the lease. Stamp each phaseLog entry with (deviceId, phaseStartedAt) at push time so reconciliation can dedup or at least surface duplicates. Same fix for flow.phaseLog if added later.

6 — alarmFired boolean has no transport semantics
File: js/pomodoro.js:235 (alarmFired = state.alarmFired === true), js/flow.js:253 (same pattern).

Broken state: alarmFired is a device-local fact: "this device has already played the chime and shown the notification." Synced verbatim, it tells Device B "the chime already played" when in fact only Device A played it, suppressing the alarm on the device the user is actually looking at. The strategy table treats engine state as one row with one rule, but alarmFired is the field that breaks that abstraction — it's per-device, not per-session.

Fix: Split engine state on the way out: alarmFired (and similarly device-local fields like the recovery zeroCrossedAt if shown in a per-device toast) are not synced, even when accumulatedMs and startedAt are. Strategy needs to acknowledge that "engine state" is a heterogeneous bucket and per-field exclusion is mandatory, not optional.

7 — V1→V2 migration in meds.loadState writes ambiguous frequency
File: js/meds.js:121-127.

Broken state: When a record lacks frequency, the loader sets it to 'as-needed'. If a v1.6 client introduces a fourth frequency ('three-times-daily'), and sends a record with frequency: 'three-times-daily', a v1.5 client hits the MED_FREQUENCIES.includes(state.frequency) check (line 121), fails it, and silently rewrites the user's "twice-daily" → "as-needed" on roundtrip. The MED_FREQUENCIES allowlist is a destroy-on-unknown trap.

Fix: Loader must distinguish "field absent" (apply default) from "field present but unknown" (preserve unknown verbatim, do not normalize). Pair with #1's schemaVersion: an unknown frequency from a higher schema version goes into passthrough; from a same-or-lower version, it gets flagged for a conflict-review surface (or LWW with a banner per the doc's open question on conflict UI).

8 — cycleIndex rename or totalCycles semantic shift has no detection
File: js/pomodoro.js:227-228.

Broken state: Hypothetical: v1.6 renames cycleIndex → cycleNumber (1-based instead of 0-based). v1.5 reads state.cycleNumber as undefined, falls through to ?? 0, displays "cycle 1 of 4" when it's actually "cycle 3 of 4" and immediately rolls into the wrong phase via nextPhase. There is no version tag and no schema validator that would catch the rename. Strategy doc mentions Stage E "steady-state" assuming this kind of evolution; it doesn't say how.

Fix: Schema-tag-on-record (#1) plus a refusal rule: if record.schemaVersion > clientVersion, never apply LWW writeback to that record from this client. Read-only display until the client updates. Without that, every rename is a corruption event for the lagging device.

9 — New pillar's localStorage keys: drop, store blindly, or break?
File: js/persistence.js:11-21 (clear() enumerates known keys explicitly).

Broken state: Persistence.clear() lists every store by name. If v1.7 ships a new pillar with wellness_sleep_log, v1.6's clear() won't wipe it on a "factory reset" — leaving stale data the user thinks they deleted. Worse, on the sync side: if the sync layer's serializer is also explicit-keyed, v1.6 will silently not sync the new key. Sync-layer fix is structural; the strategy doc has no provision for it.

Fix: Strategy needs a per-store registry — stores enumerate themselves on init (publish their key + schemaVersion to a central manifest). The sync layer iterates the manifest, never a hardcoded list. Persistence.clear() likewise iterates the manifest. New pillars register on load; downlevel clients see "unknown store at v1.7" and either passthrough-mirror or refuse-and-flag, not silently ignore.