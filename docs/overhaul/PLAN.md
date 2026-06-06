# Tempo Full-App Overhaul — Plan (Phase 2)

> **Status: AWAITING APPROVAL.** No implementation code is written until you sign off on
> (1) the design direction, (2) the batch sequence, (3) scope/depth on the big refactors.
> Branch `feat/overhaul` is cut from `main` @ `f2ca225`. Baseline + safety net: `docs/overhaul/baseline/BASELINE.md`.
> Full raw findings (124, machine-readable): `docs/overhaul/audit-findings.json`.

## How this plan was produced

8 read-only audit agents (7 lenses + a completeness critic) swept the full surface in parallel
(~1.35M tokens, 278 tool calls). I independently verified the headline bug and the live baseline
behaviors (state-restore, tabular digits, IA routes) in a foreground browser. Every finding is
file:line-cited with a constraint-aware fix (no bundler, reuse `escapeHtml`/`Utils.formatMs`/`Platform.*`,
frozen sync layer, cache-bump per change).

## Findings at a glance — 124 total

| Batch | Findings | crit | high | med | low | Headline |
|-------|---------:|----:|----:|---:|---:|----------|
| **A — Bugs / correctness** | 22 | 1 | 4 | 6 | 11 | BFRB catches lost on export/backup (data loss) |
| **B — Performance** | 17 | – | 3 | 4 | 10 | Pomodoro/Flow rebuild full innerHTML 60×/sec; always-on 500ms poller |
| **C — UX / interaction** | 27 | – | 3 | 8 | 16 | Space key breaks rename fields; destructive actions irreversible outside Stopwatch |
| **D — Accessibility** | 17 | – | 7 | 6 | 4 | No SR announcements outside Stopwatch; panels aren't dialogs; AA contrast fails |
| **E — Visual / design-system** | 25 | – | 2 | 8 | 15 | Phantom token vocabulary; amber hardcoded 32×; no spacing/type/radius/z scales |
| **F — PWA / platform** | 16 | – | 4 | 4 | 8 | No `viewport-fit=cover` (all safe-area math dead); no wake-lock; stale-SW trap |

7 findings touch synced stores (`meds`/`history`/`bfrb_events`/`distractions`) → each such PR runs
`sync-invariant-reviewer` before opening.

---

## 🔴 The one critical (independently verified)

**A1 — Backup/export omits `bfrb_events`; all post-migration BFRB catches are silently lost.**
`js/export.js:74` `EXPORT_SETTINGS_KEYS` lists only the *legacy* BFRB keys (`pomodoro_bfrbs`,
`flow_bfrbs`, `bfrbs_global`) — never `bfrb_events`, which `js/bfrb-events.js:51` established as the F3
single source of truth. The migration writes to `bfrb_events` and keeps legacy keys but every *new*
catch goes only to `bfrb_events`, which `buildBackupData()` never captures. `backup.js` reuses
`buildBackupData` for the **F12 mandatory pre-push backup**, so the safety net misses it too.
*Verified:* `grep bfrb_events js/export.js js/backup.js` → nothing.
**Fix (S/low-risk):** add `'bfrb_events'` to `EXPORT_SETTINGS_KEYS`; restore it in `importAllData`;
add an export-suite test asserting it's in `getSettingsKeys()`. Health-relevant data — ships in A's first PR.

---

## Batch contents

Finding IDs are `<batch><n>`, sorted by severity. Highs/criticals carry a one-line fix; med/low are
titled (full detail in `audit-findings.json`). Items marked ⟳ are subsumed by a shared refactor.

### A — Bugs & correctness (22)
- **A1 [CRIT]** `bfrb_events` excluded from export/backup → data loss. *(see above)*
- **A2 [high, sync]** Cooking timer finishing while tab closed loses its History session — `loadState` recovery never re-fires the alarm callback that logs history. Fix: log missed cooking sessions on init, idempotent via a persisted `loggedAt` flag.
- **A3 [high, sync]** Log-Past-Session save/cancel wired **twice** (`history-ui.js:69/73` + `:518/520`) → duplicate sessions + double listeners. Fix: delete the duplicate block.
- **A4 [high]** Analytics dashboard `Promise.all` with no isolation — one corrupt query bricks the panel forever on `"Loading…"`. Fix: `Promise.allSettled` per-card (mirror `rhythm-insights.js`).
- **A5 [high]** Meds dose logging has no double-tap debounce → double-counts a medication + supply badge. Fix: ~600ms per-card lock (mirror the Pomodoro debounce).
- A6–A11 [med]: missed-completion-on-reload for Timer/Interval/**Sequence** (Sequence can get stuck mid-chain); Stopwatch session can drop on fast pause→reset between 500ms polls; Pomodoro overflow Skip vs Break inconsistency; hand-rolled `YYYY-MM-DD` in 5+ files vs `Utils.localDateKey`; `TempoNav.onAppModeChanged` exported-never-called (hash desync); `switchAppMode` never updates the URL hash (breaks deep-link/back).
- A12–A22 [low]: dead `focusComplete` branch (`app.js:217`); cooking alarm bound to stale array index; interval auto-advance no appMode recheck; Pomodoro `revertPhase` time-travel artifact; `deleteLap` lapStartMs desync; `Date.now().toString(36)` id collision on rapid add; RAF not restarted on refocus for Interval/Timer/Cooking/Sequence; clock-skew guard misses corrupt `accumulatedMs`/durations; Meds midnight bucketing vs supply; Flow re-save race; dead code in `app.js`.

### B — Performance (17)
- **B1 [high]** Pomodoro RAF rebuilds dots + full timeline innerHTML **+ reads localStorage + `toLocaleTimeString` every frame** (~60×/sec). Fix: split into a cheap per-frame *painter* (time + progress width + class) and a *structural* updater called only on transitions. (Mirrors the Stopwatch `updateCurrentLap` pattern.)
- **B2 [high]** Flow RAF calls full `updateFlowUI()` → re-`innerHTML`s **two** task lists and re-binds listeners every frame. Fix: same painter/structural split; task lists only on mutation/phase entry.
- **B3 [high]** Always-on `setInterval(…,500)` (`app.js:489`) polls every stopwatch forever, even when hidden / not in stopwatch mode. Fix: capture session synchronously at reset (event-driven) and drop the poller, or gate it on `visible && stopwatch mode && non-idle`.
- B4–B7 [med]: Timer & Interval rebuild button innerHTML every frame; `renderLaps` full rebuild + swipe re-bind on every lap event (prepend-only fix); Cooking opens a **new AudioContext per alarm** (route through shared `SFX` ctx); Pomodoro per-frame localStorage/`toLocaleTimeString` (⟳ B1).
- B8–B17 [low]: `lastKnownStates` Map never evicts; meds 30s ticker never stops; CardsUI dot recompute on 100ms interval; Insights one giant innerHTML; `applyAppMode` ~25 layout writes per switch; Compare RAF/handler churn; `Analog.update()` runs while hidden; Global-BFRB relabel on every focus/hashchange; 9 always-live keydown listeners fan out every keypress; multi-cooking-alarm AudioContext storm.

### C — UX & interaction (27)
- **C1 [high]** Space key hijacks contenteditable rename fields (Compare/Cards/Pomodoro saved-tasks) — handlers guard only `INPUT`. Fix: shared `isTextEntry(target)` helper (incl. `isContentEditable`, mirror `global-bfrb.js:406`) used in all 5 mode keydown handlers.
- **C2 [high]** Destructive actions undoable in Stopwatch but **instant & irreversible** everywhere (Pomodoro/Flow/Interval reset, clear-all-tasks). Fix: `confirm()` on the data-discarding ones + generalize the existing undo-toast into a reusable `showUndoToast(label,onUndo)`.
- **C3 [high, IA]** Six modes each re-implement the `btn-left/btn-right` state machine (65 `appMode` guards, copy-pasted `btn-inner` innerHTML). Fix: a lightweight `ModeButtons` helper + single delegating click-router; migrate one mode at a time behind the existing guard. **(Largest refactor — scope decision needed.)** ⟳ absorbs the documented `onTimerLeft/onTimerRight` debt.
- C4–C11 [med]: swipe+undo only on laps (no parity elsewhere); offset feature is a low-contrast link (flagship feature, undersold); Compare discoverability; sign-in no spinner/retry; no empty/onboarding for Pomodoro/Flow/Interval; Flow Start silently disabled w/ no reason; ⟳ onTimerLeft/Right dup; Focus mode only supports 3 of the modes.
- C12–C27 [low]: cooking can't re-arm a finished timer; silent auto-advance countdowns; Timeline empty-state has no next-action; inconsistent button-press feedback; cooking/nap in-flight lost on close; drawer auto-close mid-interaction; undiscoverable L/R shortcuts; interval no rest-gate; BFRB popover/banner corner collision; Analytics needs a 2nd tap; input auto-advance no way back; **3 toast systems**; Recent-Activity duplicated (Exercise/Cooking); notification copy triplicated; two cooking surfaces; no body-scroll-lock behind overlays.

### D — Accessibility (17)
- **D1 [high]** No SR state announcements outside Stopwatch (`announce()` exists but only Stopwatch calls it). Fix: promote to shared helper, call on every transition (timer finish/overflow, pomo phase, flow, interval, cooking, sequence).
- **D2 [high]** Slide-up panels aren't dialogs (no focus move/trap/Escape/`inert`). Fix: ~40-line shared modal helper reused by all 5 panels + drawer.
- **D3 [high]** `prefers-reduced-motion` almost entirely uncovered; Mindful breathing uses inline JS transitions a media query can't override. Fix: global reduced-motion block + `matchMedia` gate in Mindful.
- **D4 [high]** WCAG AA contrast fails: OLED & Minimal `--text-secondary`, Minimal link green. Fix: bump those token values per theme (verify vs bg **and** btn-bg).
- **D5 [high]** Tiny tap targets (~16–24px) on all delete/chip controls. Fix: shared `.icon-delete-btn` ≥44px hit area, glyph stays small.
- **D6 [high]** Lap delete is swipe-only — no keyboard/SR path. Fix: per-row delete button (aria-label) on same `deleteLap` path; keep swipe as enhancement.
- **D7 [high]** Focus/Ambient overlay invisible to SR, no focus mgmt. Fix: `role=dialog`+`aria-modal`, `aria-live` on time, focus in/out, inert background, keyboard pause/lap.
- D8–D13 [med]: settings drawer invalid `role=menu`; drawer + BFRB popover no focus trap/return; sub-44px mode-dots/close-buttons; no heading structure (zero h1); `user-scalable=no` blocks pinch-zoom; BFRB FAB countdown static aria-label.
- D14–D17 [low]: `role=list` with non-listitem children; mode-scoped undiscoverable shortcuts; hidden aria-live region clobbered; picker/phase-row/chip labels.

### E — Visual / design-system (25)
**Foundation (E0) — the shared substrate everything else paints on:**
- **E1 [high]** Phantom token vocabulary — the **entire Rhythm pillar** references `--surface/--text-primary/--accent/--text-muted`, *defined nowhere* (silently using fallback hex; Rhythm never re-themes). Fix: alias to existing tokens (`--btn-bg`/`--text`/`--red`/`--text-secondary`) or define them in every preset.
- **E2 [high]** Amber `#ff9f0a` hardcoded **32×** despite an unused `--orange` token → BFRB/meds amber stays dark-value in light mode. Fix: introduce `--amber`(+tints), sweep all 32 literals.
- E3–E10 [med]: `--productivity-accent` half-wired (blue tab, green chrome) — resolve the green/blue clash; **no spacing scale** (17 ad-hoc px); **noisy type scale** (~34 rem + 11 px sizes); stale `theme-color` meta in auto/light; themes define only 12 vars (non-default themes partially un-themed); `escapeHtml` re-implemented in 4 wellness modules; `formatDuration` re-implemented 3× → `Utils.formatHuman`.
- E11–E25 [low]: no radius scale (16 values); inconsistent display weight/mono stacks; no elevation system; phantom `--dur-color`; no z-index scale (+ a `z-index:9999` outlier); hardcoded danger/warn rgba; opacity-on-text vs token ladder; pillar colors hardcoded in charts; mixed letter-spacing units; icon stroke drift + emoji in drawer; redundant fallback hex; 4 active-state class names; relative-time humanizer in 5 files; 3 visibility-toggle idioms; native `confirm()/alert()` vs app modal vocab; **no shared `.card`/`.empty-state` base** (44 card + 17 empty bespoke selectors).

### F — PWA & platform (16)
- **F1 [high]** Viewport meta lacks `viewport-fit=cover` → **every** `env(safe-area-inset-*)` resolves to 0 on iOS standalone (all existing inset math is dead). Fix: add it — prerequisite for F2.
- **F2 [high]** Sticky top bar has no top safe-area inset → draws under the notch/status bar. Fix: `padding-top: calc(12px + env(safe-area-inset-top))` (needs F1).
- **F3 [high]** No Wake Lock — screen sleeps mid-timing; in-page audio alarm + RAF die when display locks. Fix: `Platform.keepAwake(on)` seam (web `navigator.wakeLock`, native keep-awake), acquire on start/Focus.enter, release on pause/reset/exit.
- **F4 [high]** No SW update-to-reload — open tabs run stale cached code after deploy (the "stale SW cache" trap). Fix: one-time `controllerchange`→reload guard, or stale-while-revalidate for js/css.
- F5–F8 [med]: 80 render-blocking serial `<script>`s with no `defer` (single mechanical sweep, in-order preserved); first-session bg notifications dropped (use `serviceWorker.ready`); no iOS install affordance (feature-detect + hint); AudioContext never `resume()`d (silent alarms after backgrounding).
- F9–F16 [low]: cache-first no runtime update path; stale `theme-color` on auto; Focus overlay ignores safe-area; manifest ships `"(feature branch)"` description; manifest missing `id/scope/maskable/lang/categories`; no offline nav fallback; render loops not restarted on foreground (Timer/Flow/Interval/Cooking); no `<noscript>`/first-paint fallback.

---

## Recommended stacked-PR sequence

Stacked because nearly every front-end batch edits the **shared files** — so the stack itself
serializes writes to them. Each batch = one branch off the prior; small themed PRs within a batch.

```
main
 └─ feat/overhaul-A-bugs        (correctness; incl. the critical data-loss fix)
     └─ feat/overhaul-B-perf    (RAF painter/structural splits, kill 500ms poller, leaks)
         └─ feat/overhaul-E-system   (DESIGN-SYSTEM FOUNDATION: token layer + phantom/amber/theme fixes
             │                         + shared .card/.empty-state + escapeHtml/formatDuration dedup)
             └─ feat/overhaul-D-a11y       (announcements, modal helper, touch targets, reduced-motion,
                 │                            contrast — consumes E's contrast/focus tokens)
                 └─ feat/overhaul-C-ux     (isTextEntry guard, undo/confirm parity, empty states,
                     │                        ModeButtons refactor — consumes E tokens + shared modal/toast)
                     └─ feat/overhaul-F-pwa  (viewport-fit, safe-area, wake-lock, SW-update, manifest, iOS install)
                         └─ feat/overhaul-E-polish  (per-screen visual polish + chosen design direction on the foundation)
```

**Why this order (resolving "bugs-first" vs "design-system-first"):** A (correctness) and B (perf,
mostly JS, low CSS contention) lead. Then the **design-system foundation (E-system) lands early** so the
a11y contrast work (D) and UX visual consistency (C) build on *real tokens*, not literals — otherwise
contrast gets fixed as hex in D and re-tokenized in E, doing it twice. Full visual *polish* + the chosen
design direction stays last (E-polish). F (platform: `index.html`/`sw.js`/`manifest`/`platform.js`) slots
late with low CSS contention.

*Alternative if you prefer the brief's literal order:* `A → B → C → D → E → F` (strict). Costs the
double-work on contrast and lands visual consistency on shifting tokens. I recommend the split above.

### Shared-file write-ownership (the serialization contract)
| Shared file | Touched by | Rule |
|-------------|-----------|------|
| `css/styles.css` (6090 ln) | B,C,D,E,F | One writer at a time; only the active batch's branch edits it. |
| `css/tempo-shell.css` (1533 ln) | D,E,F | Same. |
| `index.html` | A,B(defer),D,F | Same; F owns the viewport/meta region. |
| `js/themes.js` | D(contrast),E(tokens) | E owns the token expansion; D's contrast values land in E-system or rebase onto it. |
| `js/ui.js`, `js/app.js` | A,B,C,D | Serialized via the stack; B owns the poller removal in app.js. |
| `sw.js` | **every batch** (CACHE_NAME bump) | Bumped once per PR; pre-commit-guard enforces. |

Genuinely independent **engine-JS** work (e.g. `meds.js` debounce, `cooking-ui.js` history fix,
`audio.js` ctx reuse) *can* fan out to parallel subagents in worktrees — but **never two writers on
`styles.css`/`tempo-shell.css`/`index.html` at once.**

### Per-PR gate (every PR)
implement → `npm test` (**only** the named sync-engine merge-cycle flakes may fail; any other failure =
regression) + foreground PASS(933) spot-check → `check-asset-integrity` + `check-sw-bump` → bump
`CACHE_NAME` → add engine tests for every logic fix/new behavior → `sync-invariant-reviewer` if a synced
store/module is touched → refresh screenshots → open focused PR (what/why, before/after, risk, coverage).
**Brief check-in after each PR before the next batch.** No push to `main` without your explicit per-push OK.

---

## Design directions — pick one (drives E-polish)

| | **Refined Minimal** *(recommended)* | **Warm Focused** | **Bold Data-Dense** |
|---|---|---|---|
| Philosophy | Keep the calm iOS-stopwatch character; fix the system underneath. Inconsistencies disappear, look barely changes. | Warmer dark base, lower contrast for long focus, clock-as-hero, pillars as soft surface tints not saturated accents. | Quantified-self instrument: timing stays clean, Rhythm/Analytics become a dense high-contrast chart-forward grid. |
| Color | Rename `--green`→`--accent-primary`; resolve green/blue clash; add `--amber/--danger/--surface`. | Single warm amber-gold accent; pillars = 6% surface tint; collapses the 3-accent clash. | Dedicated `--chart-1..6` categorical ramp reused by all panels (kills per-panel literals). |
| Risk | **Lowest** — ships token-first then mechanical sweeps; fixes light-mode/multi-theme breakage immediately. | Higher taste risk + most rework (re-map every green/blue button); low-contrast needs WCAG validation. | Scoped to data pillars; denser UI needs careful phone responsive collapse + contrast verification. |
| Best if you want… | Consistency + correctness, minimal wow. | A distinctive wellness mood. | The 9-panel Insights investment to look premium. |

All three sit on the **same token foundation** (E-system) — the foundation is direction-agnostic, so
A→E-system can proceed while you decide; the choice only changes E-polish.

---

## Deferred / flagged

- **Frozen sync layer** — `sync-firestore.js`/`sync-toast.js` untouched (parked PR #86 work). A2/A6 sync-store
  *writes* go through `schema.stamp()`; merge logic unchanged.
- **ModeButtons refactor (C3)** is the one **L/med-risk** structural change — recommend incremental,
  one mode per PR behind the existing `appMode` guard, engine timing untouched. Could be deferred entirely
  if you want a lower-risk pass; say so at the gate.
- **Two cooking surfaces (C: low)** and **`user-scalable=no` removal (D: med)** are product/taste calls —
  flagged, not auto-applied.
- **Native iOS verification** of F1/F2/F3 (safe-area, wake-lock) needs a device/simulator pass; web is
  verifiable now, iOS noted as RUNTIME-VERIFY.
- Anything not in A–F (new features) is out of scope for this overhaul.

## Decisions I need at the gate
1. **Design direction** (Refined Minimal / Warm Focused / Bold Data-Dense).
2. **Sequence** — recommended (A→B→E-system→D→C→F→E-polish) or strict brief order (A→B→C→D→E→F)?
3. **ModeButtons (C3)** — do the shared-controller refactor, or defer and keep per-mode handlers?
4. **Depth** — fix through *medium* severity app-wide and cherry-pick high-value lows, or grind every low too?
