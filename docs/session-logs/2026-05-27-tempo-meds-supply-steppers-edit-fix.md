# 2026-05-27 — Tempo: meds supply steppers + edit/delete fix

## 1. What we did

- **Shipped PR #94** (squash `19f12f5`): manual ±1 steppers on the medication supply badge. New signed `supplyAdjustment` field on each med record + `adjustSupply(delta)` engine method + vertical ▲/▼ buttons in the badge, down-arrow disabled at 0, 15 ms haptic. +11 engine tests.
- **Shipped PR #95** (squash `8567c83`): hardening from #94's code review. Extracted `MAX_SUPPLY = 1000` const (was hardcoded in two places) and clamped `getSupplyRemaining()`'s upper bound. +1 engine test.
- **Shipped PR #97** (squash `c63a045`): wired the ✎ edit and × delete buttons on med cards — they rendered but had **no handler** since the meds V2 surface shipped. Discovered during this session; fixed UI-only (the engine methods already existed).
- **High-effort code review of #94** via two parallel reviewer agents. One brute-forced 375,150 state combinations of the `adjustSupply` math (zero failures); the other audited DOM selectors, event delegation, the `:disabled` button path, CSS layout, and the `sw.js` ASSETS list. One low/cosmetic finding → became #95.
- **Engine test count 642 → 654.** Full suite green in real Chrome (the one transient `_steadyRunInFlight` merge-dispatch flake is the one CLAUDE.md already documents — passes on rerun).
- **`sw.js` CACHE_NAME bumped v95 → v96 (#94) → v97 (#97).** Honest flag: **#95 should have bumped too** — it edited `js/meds.js`, which is in the cached ASSETS list, but I called it "engine-only, no bump needed" in the PR body. Practical impact ≈ zero (any user who installed v96 between the #95 and #97 deploys was on stale `meds.js` for ~20 minutes, and the missing piece was a hostile-data cosmetic clamp). Worth remembering: the project rule is "any cached file changed → bump CACHE_NAME in the same PR," and `js/*.js` is *all* cached.
- **Recovered cleanly from a concurrent-session collision** where another Claude session committed `docs/trim-claude-md` work onto my meds branch mid-flight. Kept #94 clean (stray commit never pushed), the other session later landed its work as PR #96 (`a4b154e`).

## 2. The why

**`supplyAdjustment` as a signed offset, not a stored "remaining" counter.** The supply count is *derived* from the dose log so cross-device sync stays canonical (the doseLog is append-merged with `(deviceId, takenAt)` dedup, which only works if the log is the source of truth). Storing a separate "remaining" counter would have created a second source of truth and broken the sync invariant. Instead the offset folds into the derivation: `remaining = startCount − dosesSinceReset + supplyAdjustment`, clamped. Pattern: **additive derivation over stored mutable state**.

**Solve for the offset rather than incrementing it.** Naive `supplyAdjustment += delta` is unresponsive when `consumed > startCount` (raw remaining is negative; clamps at 0; up-presses absorb into the negative range invisibly). Instead `adjustSupply` computes `target = clamp(displayed + delta, 0, MAX_SUPPLY)` and *sets* `supplyAdjustment = target − startCount + consumed` — the algebraic inverse of the derivation. Each tap moves the *visible* number by exactly one, no matter what the internal state was. Composes correctly with later dose logging because the adjustment stays a fixed offset while `consumed` grows.

**Up-arrow allowed to exceed the prescription size** (e.g. "31 left of 30"). The alternative (cap at `startCount`) would no-op from the just-refilled default state — broken first impression. The denominator "of 30" is the *prescription size*, a fixed reference, not a ceiling on what the user actually has. Tradeoff: occasional "weird"-looking numbers; gain: arrows always do what they say.

**`setSupply` resets the adjustment to 0.** A fresh prescription should read exactly "N left," not "N ± leftover correction." Same reasoning for `clearSupply`.

**Additive nullable field, no `SCHEMA_VERSION` bump.** Matches the precedent set by `supplyStartCount`/`supplyResetAt` and the `deletedAt` tombstone. Downlevel clients that don't know the field just ignore it; the derivation gracefully falls back. Bumping the schema would invoke F19a refuse-writeback unnecessarily for a strictly additive field. Pattern: **additive migrations don't bump schema**.

**PR #95: clamp at the derivation point, not just at the writes.** The review found that `getSupplyRemaining` clamped the floor (≥0) but not the ceiling. `setSupply` and `adjustSupply` both clamp at write time, but corrupt data can enter via cloud sync, JSON-restore, future-schema records, or hand-edited localStorage — paths that don't touch the writes. Clamping in `getSupplyRemaining` itself is one line and bounds every code path. Defense at the *altitude where the value is consumed*, not just where it's produced. The constant extraction (`MAX_SUPPLY`) DRY'd a third hardcoded `1000`.

**PR #97: `confirm()` for delete + boolean guard on `MedsManager.remove()`.** `confirm()` matches `history-ui`'s convention (no need for a custom modal — the cost/value didn't justify it). The `if (ok && MedsManager.remove(id))` guard matters because `remove()` returns `false` for future-schema records (F19a refuse-writeback) — without the guard, the user would see a "successful" re-render with the card still present, looking like a silent failure.

## 3. Concepts and vocabulary

- **Derived state**: state computed on-demand from other state, never stored independently. Today: `getSupplyRemaining()` is a function of `supplyStartCount`, `doseLog`, and `supplyAdjustment` — never cached.
- **Additive migration**: a schema change that only adds fields, so older clients can still read the data (they ignore unknown fields). Today: `supplyAdjustment` added without bumping `SCHEMA_VERSION`.
- **LWW (last-write-wins)**: a sync conflict policy where the newer write replaces the older one, compared by an `updatedAt` stamp. Today: meds metadata (including `supplyAdjustment`) syncs via per-record LWW.
- **Append-merge with dedup tuple**: a sync strategy for log-shaped data where entries are unioned and deduped by `(deviceId, takenAt)` rather than overwritten. Today: `doseLog` is append-merge; `supplyAdjustment` deliberately is *not* — it's LWW metadata.
- **F19a refuse-writeback**: a contract where a downlevel client refuses to mutate a record carrying a `schemaVersion` higher than what it understands, leaving "future" records byte-clean for the newer client. Today: `MedsManager.remove()` returns `false` for such records; #97's delete handler honors that.
- **Inverse-equation UI**: solving `f⁻¹(target) = state` so the next render produces exactly `target`. Today: `supplyAdjustment = target − startCount + consumed` is the inverse of the derivation formula.
- **Defense-in-depth at the derivation point**: bounds-checking where a value is *computed and read*, not just where it's written. Today: PR #95's upper clamp in `getSupplyRemaining`.
- **Squash merge**: GitHub's "Squash and merge" collapses a feature branch's commits into one commit on `main`. Today: all 4 PRs (#94/#95/#96/#97) shipped this way; `git branch -d` won't see them as merged because the SHA differs from the original branch tip.
- **Service-worker cache versioning**: bumping `CACHE_NAME` in `sw.js` so the SW evicts old caches on activation and pre-caches the current asset list. Today: v95 → v97 across three deploys; I missed the v96→v96.5 bump on #95 (honesty note above).
- **Concurrent-session race**: when two coding sessions share a working directory, they share `HEAD`. The other session's commit landed on whichever branch was checked out at that moment. Mitigation in this codebase: git worktrees (`feat/cloud-sync` already uses one).

## 4. Takeaways

- **Derived state survives sync; stored state fights it.** When multi-device sync uses merge semantics, prefer recomputing display values from source-of-truth logs over storing them. The "signed offset folded into the derivation" pattern lets you mutate the display without breaking the log invariant. Today: `supplyAdjustment` instead of a stored `remaining`.
- **When a UI control transforms the displayed value, make the *engine* solve the inverse problem.** Don't increment the internal state and hope the clamps line up. Compute the new displayed target and back-solve the internal state. Today: `adjustSupply` solves; the handler just calls it.
- **Bounds-check at the derivation point, not just at the writes.** Validating only on input paths leaves you exposed to anything that arrives by side channel — sync, restore, hand-edits. Today: PR #95's upper clamp in `getSupplyRemaining` is one line and catches every path.
- **Concurrent agents on a shared working directory is a structural hazard, not a fluke.** They share `HEAD`. Today's recovery worked (preserve the commit, branch surgery) but the fix is structural: use git worktrees, or one agent per repo.

## 5. Suggested next moves

1. **(Recommended) Resume PR #91 — iOS Live Activities (Timer MVP).** You just ran `npm run ios:open`; Xcode is already in front of you. The PR has been open since 2026-05-22 (5 days). The Capacitor wrapper dependency is shipped, so it's unblocked. **Why now:** sunk cost on having Xcode loaded, longest-stale open PR, and CLAUDE.md ranks Live Activities #3 on the impact-vs-effort backlog. **Effort:** high — Widget Extension target in `ios/App/App.xcodeproj`, SwiftUI views for lock-screen + Dynamic Island, custom Capacitor plugin (or the spotty community lib) to bridge from JS engines. Needs a real device for verification.
2. **PR #86 — native onSnapshot + runTransaction parity for `@capacitor-firebase/firestore`.** Open since 2026-05-19 (8 days). Today iOS sync falls back to the 5-min defensive polling path because the native branches of `SyncFirestore.subscribe` and `runTransaction` throw "native parity pending." **Why next:** closes the last unshipped piece of the cloud-sync initiative; could be batched with #91 in the same Xcode session. **Effort:** medium.
3. **App Store paperwork (backlog #1).** Personal-device deploy works; remaining is the Apple Developer Program enrollment ($99/yr) + privacy nutrition labels (meds + BFRB are health data) + App Review screenshots + the 1024×1024 icon polish. **Why:** the only thing blocking distribution beyond your own device. **Effort:** medium, mostly bureaucratic.
4. **Trivial housekeeping:** `git branch -D feat/meds-supply-manual-adjust feat/meds-supply-clamp fix/meds-edit-delete-buttons` to clear the three local merged branches the safety hook wouldn't let me force-delete. ~5 seconds.

## 6. 30-second elevator version

Today I shipped manual ±1 steppers on the medication supply badge — two arrows on each med card that let you bump the "pills remaining" count up or down without logging a fake dose or starting a new prescription. The interesting part was the engine math: remaining is derived from the dose log because of cloud sync, so I couldn't just store a counter. Instead the steppers solve for a signed offset that, when folded into the derivation, makes the displayed number land exactly on the target — even at zero or above the prescription size, which would otherwise feel broken. High-effort code review caught one low-severity edge — getSupplyRemaining clamped the floor but not the ceiling, so a corrupt synced adjustment could briefly render an absurd number. Fixed in a follow-up by DRY-ing the cap into a constant and clamping at the derivation point. While testing I also discovered the edit and delete buttons on med cards had been completely unwired since the feature shipped — opened a third PR to fix that. All three landed: 654 engine tests passing, browser-verified end-to-end.

## 7. Active recall

**Try to answer each aloud before scrolling. Answer key below.**

1. Why did you compute `supplyAdjustment = target − startCount + consumed` instead of just doing `supplyAdjustment += delta` each tap?
2. Why not bump `SCHEMA_VERSION` when adding the new `supplyAdjustment` field?
3. The review found that `getSupplyRemaining` clamped the lower bound but not the upper. Why does that matter if `adjustSupply` already caps at 1000?
4. What would break if your delete handler didn't check the return value of `MedsManager.remove()`?
5. The up-arrow is allowed to push the count above the prescription size (so "31 left of 30" is possible). Why is that the right call, not a bug?

---

### Answer key

1. **Naive `+= delta` is unresponsive at boundary conditions.** If `consumed > startCount`, the raw value `startCount − consumed + supplyAdjustment` is already negative — clamped to 0 for display. Adding +1 to the adjustment might still keep raw negative, so the user clicks up and sees no change. By computing `target = clamp(displayed + delta)` and *solving* `supplyAdjustment = target − startCount + consumed`, every tap moves the displayed number by exactly one. The internal state floats to whatever produces the correct display. It also composes with later dose logging because the adjustment stays a fixed offset while `consumed` keeps growing.
2. **Because `supplyAdjustment` is additive and nullable.** A downlevel client that doesn't know about the field just ignores it on read, and the derivation `startCount − consumed + supplyAdjustment` gracefully falls back to `startCount − consumed` when the field is absent (defaulted to 0). Bumping `SCHEMA_VERSION` would invoke F19a refuse-writeback — downlevel clients would refuse to mutate the record at all, which is heavy-handed for a strictly additive field. The precedent is `supplyStartCount`/`supplyResetAt` and the `deletedAt` tombstone — same pattern.
3. **Because corrupt or hostile data can enter through paths that don't touch the writes.** Cloud sync (a malicious or buggy peer device), JSON-import restore, future-schema records, hand-edited localStorage. Validating only at `setSupply` and `adjustSupply` catches what you write yourself. Clamping at `getSupplyRemaining` bounds every code path that produces a display value. Defense-in-depth at the right altitude — one line, catches everything downstream.
4. **`MedsManager.remove()` returns `false` for future-schema records** (the F19a refuse-writeback contract: a downlevel client shouldn't delete a record carrying a `schemaVersion` higher than it understands). Without the guard, I'd call `render()` after a no-op deletion — the user clicks ×, confirms, sees the same card unchanged, no error, no explanation. With the guard, the haptic and re-render fire only on a real removal, and a protected record visibly stays put.
5. **From the just-refilled default state, capping at `startCount` would make the up-arrow no-op on the very first tap** — broken-feeling first impression. The semantics are also honest: if the pharmacy gave 31 instead of the prescribed 30, the user genuinely has 31 left of a "30-pill" prescription. The denominator "of 30" is the *prescription size*, a fixed reference, not a ceiling on what the user actually possesses. The tradeoff (occasional weird-looking "31 of 30") is much smaller than the broken-first-tap UX.
