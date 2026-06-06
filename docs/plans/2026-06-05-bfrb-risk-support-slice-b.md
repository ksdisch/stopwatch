# BFRB Closed Loop — Slice B (in-the-moment support) — Implementation Plan

**Milestone:** #16 Slice B (the deferred half of the BFRB Closed Loop).
**Branch:** `feat/bfrb-risk-support` (off `main`).
**Selected:** 2026-06-05 via `/autonomous-milestone` (Slice A shipped in PR #126).
**One-line:** Close the BFRB loop *in the moment* — a gentle, opt-in "support offered" nudge when
today's catches cluster above the user's personal baseline, plus a user-authored if-then
competing-response plan surfaced during the 60s recovery countdown.

This is **Slice B** — the framing-risky, opt-in half intentionally cut from the shipped Slice A
(antecedent capture + Triggers panel + clean-streak, PR #126).

---

## Ratified framing decision (the one human-owned call)

The in-the-moment pace surface uses the **Supportive offer** tone (user-ratified 2026-06-05):

> "A few catches close together today. Your 60-second reset is here whenever you want it."

- **No count shown, no prediction, no judgment.** Warm, tool-offering.
- Throttled to **once per day**.
- Fires **only when the opt-in toggle is ON** (default OFF).

This single string is the human-ratification surface; it lives as a clearly-labelled `const` in
`js/global-bfrb.js` (alongside `TRIGGER_CHIPS`, the existing "one ratification surface" comment).

---

## Two surfaces

### Surface 1 — Pace support nudge (opt-in, default OFF)

A pure engine (`js/bfrb-risk.js`) decides whether today is *clustered* vs the user's recent
baseline; the wiring layer paints the ratified supportive toast on a fresh cluster.

**`BfrbRisk.assess({ events, now, recoveryState })` → decision object.** Pure, DOM-free,
fixture-testable. Reads the **live consolidated `BfrbEvents.getAll()` stream** (passed in), never
the session-snapshot path.

- `todayCount` = catches with `takenAt` in `[localMidnight(now), now]`.
- `baselineActiveAvg` = mean catches per **active day** (days with ≥1 catch) over the trailing
  `WINDOW_DAYS` (14), **excluding today**. Active-day mean (not all-day mean) avoids zero-inflation
  from clean days — it answers "on days you do catch, how many?".
- `activeDays` = count of active days in that window.

**Suppression guards (never assert on thin data — mirrors `TempoCoach.doseSleepSlope`):**
1. `activeDays < MIN_ACTIVE_DAYS` (4) → `band: null, suppressed: true` (no baseline yet).
2. `todayCount < MIN_TODAY_FLOOR` (3) → `band: 'steady'` (don't nag on the 2nd catch).
3. Otherwise `band: 'clustered'` when `todayCount >= ceil(baselineActiveAvg * CLUSTER_FACTOR)`
   (1.5), else `band: 'steady'`.

**Recovery re-lens (strictly additive, cleanly no-ops when feed empty):** when
`readinessBand(recoveryState) === 'strained'`, lower `MIN_TODAY_FLOOR` to 2 and `CLUSTER_FACTOR`
to 1.25 (slightly more attentive on a strained day). `null`/`well`/`neutral`/absent feed → no
change. The re-lens only ever makes the nudge *more* available, never suppresses, and is never
required for Surface 1 to work.

Returns: `{ band: 'clustered'|'steady'|null, todayCount, baselineActiveAvg, activeDays,
suppressed, strainedLens }`.

**Wiring (`js/global-bfrb.js`):** in `commitPending()` (after the catch is persisted), if
`bfrb_support_enabled === '1'`, call `BfrbRisk.assess({ events: BfrbEvents.getAll(), now,
recoveryState: RecoveryFeed.getLatest?.() })`. On `band === 'clustered'` AND not already toasted
today (`bfrb_support_last_toast_day` !== todayKey) → `Toast.notice(SUPPORT_COPY)` + stamp the day
key. Throttle = one supportive toast/day.

### Surface 2 — If-then competing-response plan (always available, no gate)

The user authors a short plan in their own words → surfaced during the 60s recovery countdown.
User content, so **no framing risk and no opt-in gate**.

- **Storage:** `bfrb_if_then_plan` (plain string, device-local). Added to
  `EXPORT_SETTINGS_KEYS` (user content → backed up for device portability, like `flow_user_tasks`);
  **NOT** synced (not in `SYNCED_STORES`), **NOT** stamped via `js/schema.js`.
- **Authoring UI:** a text input in a new settings-drawer "BFRB support" section.
- **Surface:** `js/bfrb-recovery.js` shows a fixed companion banner (`#bfrb-recovery-plan`) with the
  plan text while any recovery countdown is active; hidden when the `sessions` map empties. No plan
  set → no banner.

---

## Files

**New:**
- `js/bfrb-risk.js` — pure `BfrbRisk.assess(...)` engine (band logic + suppression + re-lens).
- `tests/bfrb-risk.test.js` — suppression on thin data, clustered/steady thresholds, active-day
  baseline math, additive strained re-lens, null/empty safety, recovery-feed-absent default path.

**Modified:**
- `js/global-bfrb.js` — `SUPPORT_COPY` ratified const; post-commit risk assessment + throttled toast.
- `js/bfrb-recovery.js` — show/hide the if-then plan banner across the countdown lifecycle.
- `js/sync-toast.js` — add a generic `Toast.notice(text)` public method (textContent, XSS-safe).
- `js/tempo-nav.js` — `wireBfrbSupport(drawer)`: opt-in toggle (`bfrb_support_enabled`, default OFF)
  + if-then plan input (`bfrb_if_then_plan`).
- `js/export.js` — add `bfrb_if_then_plan` to `EXPORT_SETTINGS_KEYS`.
- `index.html` — `<script src="js/bfrb-risk.js">` before `global-bfrb.js`; the `#bfrb-recovery-plan`
  banner element near the FAB; the "BFRB support" drawer section.
- `css/styles.css` — drawer section input + the recovery-plan banner.
- `sw.js` — `CACHE_NAME` bump (`v112-bfrb-closed-loop` → `v113-bfrb-risk-support`) + add
  `./js/bfrb-risk.js` to `ASSETS`.
- `tests/index.html` — register `js/bfrb-risk.js` + `tests/bfrb-risk.test.js`.
- `CLAUDE.md` — file-map entry + Script Load Order chain (insert `bfrb-risk` between `bfrb-events`
  and `global-bfrb`).

## Load order

`... → rhythm-ui → bfrb-events → **bfrb-risk** → global-bfrb → tempo-nav → app`.
`bfrb-risk` is pure (no load-order deps — events are passed in), placed next to its only consumer.

## Persisted keys (device-local, NOT synced)

| key | type | default | exported? |
|-----|------|---------|-----------|
| `bfrb_support_enabled` | `'0'`/`'1'` | OFF (absent) | no (preference, like `tempo_coach_nudge_enabled`) |
| `bfrb_if_then_plan` | string | absent | **yes** (user content, like `flow_user_tasks`) |
| `bfrb_support_last_toast_day` | `'YYYY-MM-DD'` | absent | no (transient throttle) |

## Tests (browser-run via `tests/index.html`)

- `tests/bfrb-risk.test.js` (new): suppression below `MIN_ACTIVE_DAYS`; `steady` below the today
  floor; `clustered` at/above the factor; active-day baseline excludes today + clean days; strained
  re-lens lowers the floor (additive only); `null`/empty/malformed events never throw; recovery
  absent is the default path.

Canonical run: `python3 -m http.server` + open `tests/index.html` in a real browser (kapture), read
the page's self-reported PASS/FAIL. `node --check` is the cheap syntax gate.

## Visual verify (kapture, 390px, fresh port to dodge stale SW cache)

1. Drawer → BFRB support: toggle ON, author an if-then plan.
2. Log catches until clustered → confirm the supportive toast paints once (and not again that day).
3. Confirm the if-then banner renders during the 60s countdown and hides after.
4. Toggle OFF → confirm no toast fires on further clustered catches.

## Autonomy split

Self-verifies: `BfrbRisk.assess` logic (engine tests) + toast/banner DOM + throttle (kapture).
Human-only residue: the supportive copy tone — **ratified up front** (Supportive offer). Recovery
re-lens needs a live `recovery_state` to exercise the strained path end-to-end, but it is strictly
additive and the default (feed-absent) path is the tested critical path.
