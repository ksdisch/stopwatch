# Tempo UI/UX Overhaul — Orchestrator Prompt

> **Purpose:** paste this into a fresh Claude Code session to run a comprehensive,
> full-app UI/UX + design + performance + correctness overhaul of Tempo as a
> multi-subagent orchestration, delivered as a stack of small themed PRs behind a
> human approval gate.
>
> **Provenance:** the **Ground truth** block below was empirically verified on
> **2026-06-06** against `main` @ `855f550` during a baseline-prep pass (see that
> session's readiness report). It is pre-verified so the orchestrator does not burn a
> discovery cycle re-deriving it — or guess wrong. If you are reading this long after
> that date, re-confirm the baseline (clean tree, test gate, open-PR list) before
> trusting the specifics.
>
> **Decisions baked in:** scope = **full app, design-system-first**; delivery =
> **one `feat/overhaul` branch with stacked, themed PRs**.

---

## Mission

You are the ORCHESTRATOR for a comprehensive UI/UX, design, performance, and
correctness overhaul of **Tempo** — a vanilla-JS stopwatch / timer / wellness PWA.
Operate at MAXIMUM effort. Use parallel subagents (the Task tool) as your team. Goal:
find + fix bugs, improve everything non-buggy, make it look and feel significantly
better, make it faster and more reliable — **WITHOUT regressing what works**. Scope is
the **full app** (every pillar/mode below), sequenced **design-system-first** so
shared-layer changes propagate before per-screen polish.

## Ground truth (PRE-VERIFIED — trust this; don't re-derive)

- **Stack:** Vanilla HTML/CSS/JS. **No framework, no build step, no bundler, no
  TypeScript, no ESLint/Prettier.** ~80 `<script>` tags in `index.html` whose **order
  IS the dependency graph**. ONE `css/styles.css` (~3300 lines). ONE `index.html`
  (~63k). Engine modules = factory functions; UI modules = global functions;
  self-contained data modules = IIFEs.
- **Baseline:** `main` @ `855f550`, clean tree, **0 open PRs**. Engine suite =
  **PASS (933) in a foreground browser tab**.
- **Test gate (READ CAREFULLY):** `npm test` → `scripts/run-tests.mjs` (headless
  Playwright Chromium → `tests/index.html?nosw=1`, reads `document.title` =
  `PASS (n)` / `FAIL (n)`). **Requires `npx playwright install chromium` once.**
  **On clean `main`, headless `npm test` is RED** — it fails exactly 2 sync-engine
  `_runMergeCycleForStore` merge-dispatch tests (failure count jitters 1↔2) due to
  headless / background timer-throttling. **This is a documented pre-existing flake,
  NOT a regression.** Gate every change on *"no NEW failures beyond those 2,"* and
  confirm true green by loading the suite in a **foreground** tab (PASS 933). New
  engine tests go in `tests/<module>.test.js`, registered in `tests/index.html`;
  API = `describe / it / assert / assertEqual / assertClose / assertArrayEqual`.
  **No UI/integration test harness exists** — do not build one; verify UI via
  screenshots + manual / kapture checks.
- **"Lint" analog (both green on clean main, both hook-enforced):**
  `node scripts/check-asset-integrity.mjs` (`sw.js` ASSETS set == `index.html`
  `<script>` set) and `node scripts/check-sw-bump.mjs` (any changed cached file
  requires a `CACHE_NAME` bump).
- **CACHE-BUMP RULE:** ANY change to `index.html`, `css/*.css`, `js/*.js`,
  `manifest.json`, or `sw.js` MUST bump `CACHE_NAME` in `sw.js` **in the same commit**.
  A committed `pre-commit-guard` hook **blocks** commits that violate this or the
  asset-integrity rule. Expect to bump on nearly every PR.
- **Timing is already drift-free:**
  `elapsed = offsetMs + accumulatedMs + (Date.now() - startedAt)`; a RAF render loop
  updates only the current lap's text node; it **never** uses `setInterval` to
  increment. **Verify / harden this — do NOT rewrite it.** Known engine tech-debt to
  consider (not mandates): `renderLaps` does a full `innerHTML` rebuild on each lap
  event; `onTimerLeft/Right` duplicate `onLeftClick/Right`.

## Constraints

- **FIREBASE/FIRESTORE SYNC LAYER IS FROZEN.** Do not redesign / rewrite cloud sync,
  auth, or Firestore rules. Only surgical, well-tested, clearly-isolated bug fixes
  there. **Avoid rewriting `js/sync-firestore.js` and `js/sync-toast.js`** — they hold
  parked, unmerged work on **closed PR #86** (native listener parity); touching them
  seeds a future conflict. There are **no open PRs** to collide with.
- **Preserve the sync invariant:** every write to the 6 synced stores (`meds`,
  `history`, `rest_log`, `presets`, `bfrb_events`, `distractions`) MUST stamp
  `deviceId` + `updatedAt` + `schemaVersion` via `js/schema.js` (`schema.stamp()`).
  Run the repo's `sync-invariant-reviewer` agent before any PR that touches a synced
  store or adds a module.
- **Stay vanilla — NO build step.** Do not introduce a bundler, framework, transpiler,
  npm runtime dependency, or minifier. It is a deliberate ADR ("script order in
  index.html is the dependency graph").
- **Reuse, never re-implement:** `escapeHtml` (`js/dom-utils.js`), `Utils.formatMs`
  (`js/utils.js`), `Platform.haptic` / `Platform.notify` /
  `Platform.scheduleNotification` (`js/platform.js` — never call `navigator.vibrate`
  or `new Notification` directly). If you add a JS module, use the
  **`/new-engine-module`** skill so all 4 touch-points get wired (script tag at the
  right load-order slot, CLAUDE.md file-map + load-order chain, `sw.js` ASSETS +
  `CACHE_NAME` bump, test stub in `tests/index.html`) — a half-wired module fails the
  asset-integrity hook.
- **Don't break existing behavior.** Preserve + extend tests; never delete a test to
  make it pass.
- **iOS / Capacitor wrap must keep working:** `js/platform.js` is the web/native seam;
  `sw.js` is web-only; `www/` is generated by `scripts/sync-www.mjs`. Respect
  safe-area / notch insets for standalone; don't assume browser-only APIs.
- **Git:** branch from `main`; prefixes `feat/` / `fix/` / `refactor/` / `docs/`;
  **never push to `main` without explicit per-push approval** (a blanket pre-approval
  doesn't count). Commit trailer `Co-Authored-By: Claude...`; PR-body trailer
  `🤖 Generated with Claude Code`.

## Full-app surface (audit + cover ALL of this)

- **Timing modes:** Stopwatch, Timer, Pomodoro, Flow Block, Interval, Cooking,
  Sequence. Plus **Compare** (split-screen) and **Focus / ambient** mode.
- **Wellness pillar:** Meds, Exercise, Mindful, Recovery (sleep / nap log).
- **Rhythm pillar:** Timeline + Insights (9 panels incl. Today / Tempo-Coach,
  meds-sleep, recovery-trends, focus-minutes, bfrb-frequency, bfrb-triggers,
  distraction-rollup, event-zoom, correlations).
- **Cross-cutting:** Global BFRB FAB + recovery countdown, Todoist integration,
  Analytics, History (+ tags / notes), Presets, Offset-input, 6 Themes + dark mode,
  SFX, PWA install.
- **Shell:** `js/tempo-nav.js` — pillar tabs, sub-nav, hash routing, settings drawer.
  (Enumerate exact routes / states from `tempo-nav.js` + the CLAUDE.md file-map.)

## Phase 0 — Baseline & safety net (before any changes)

- Confirm clean tree (it is: `main` @ `855f550`); create the overhaul branch
  `feat/overhaul` off `main`.
- Establish the gate baseline: `npx playwright install chromium` if needed, then
  `npm test` (expect the 2 known flakes → record them as the baseline-red set),
  `node scripts/check-asset-integrity.mjs`, `node scripts/check-sw-bump.mjs`. Confirm
  **PASS (933)** in a foreground tab as the true-green reference.
- **Regression baseline:** screenshot (or written behavior-inventory) **every key
  state across the full surface above** — per timing mode: idle / running / paused /
  lap- or phase-heavy / finished / reset; plus signed-out / signed-in / offline /
  sync-conflict; plus each Wellness + Rhythm screen; light + dark theme; mobile +
  desktop width; reduced-motion. This is your before/after reference.
- **Browser-verify env note:** serve on a **fresh port** (e.g. 8770 / 8771) and/or use
  `?nosw=1` to dodge stale service-worker cache; timing-sensitive views must be checked
  in a **foreground / visible** tab (a backgrounded tab reports
  `visibilityState:"hidden"` and changes behavior). kapture (localhost, can't
  `evaluate`) and Playwright-MCP (Docker → `host.docker.internal:<port>`, can
  `evaluate` / seed localStorage) **conflict if both attach** — pick one stack per pass.

## Phase 1 — Parallel audit (READ-ONLY; NO code changes)

Spawn subagents IN PARALLEL, one per lens (use `Explore` / general agents). Each reads
code **and runs the app across the full surface**, and returns findings as
`{issue, severity, evidence (file:line + screenshot), root cause, proposed fix,
est. effort, risk, sync-touch? y/n}`:

1. **Correctness & bugs** — per-mode state machines (start / stop / lap / reset /
   phase-transition / revert), **state restore on reload** (verify the wall-clock
   auto-correct holds), offline behavior, races with the sync merge cycle, error
   handling. **Confirm** the existing drift-free model is intact under background-tab
   throttling; flag deviations rather than rewriting.
2. **Performance** — per-tick re-render churn (esp. `renderLaps` full-`innerHTML` on
   lap events), animation jank, RAF correctness + self-stop guards, interval / listener
   leaks, **`<script>` count + service-worker cache strategy + PWA load / TTI** (NOT
   "bundle size" — there's no bundle), memory growth over long sessions.
3. **UX & interaction** — primary-action ergonomics + hit targets, lap / phase-list
   usability, keyboard shortcuts (Space = start/stop, B = BFRB), gestures
   (swipe-to-delete), empty / onboarding states, sign-in friction, sync conflict /
   error UX, cross-mode nav clarity.
4. **Accessibility** — `aria-live` timer + lap / phase announcements, focus management
   across route changes + the settings drawer, contrast (all 6 themes), reduced-motion,
   44px+ touch targets, full keyboard operability.
5. **Visual / design system** — **tabular / monospaced numerals** so digits don't
   jitter, typography scale, color / theme tokens, dark mode, spacing & rhythm, motion
   design, iconography, responsive layout, polish. Because there's ONE `styles.css`,
   propose a **coherent token / system change first**, then per-screen. **Propose 2–3
   distinct design directions** for the human to pick at the gate.
6. **PWA & platform** — manifest, SW caching / offline-first + the cache-bump
   discipline, install prompt, iOS standalone quirks, viewport / safe-area (notch),
   **wake-lock** to keep the screen on while timing.
7. **Information architecture & consistency** — naming, component reuse vs one-off
   patterns across the now-large surface, and the documented tech-debt
   (`onTimerLeft/Right` duplication).

## Phase 2 — Synthesis & PLAN  ←  APPROVAL GATE, STOP HERE

- Merge findings; dedupe; resolve cross-agent conflicts. Write the plan to
  **`docs/overhaul/PLAN.md`** (durable, reviewable — matches how this repo records
  audits).
- Prioritize by **impact × effort × risk**. Group into themed batches:
  **(A) bugs / correctness, (B) performance, (C) UX, (D) accessibility,
  (E) visual / design-system, (F) PWA / platform.** Because front-end batches all touch
  `index.html` + `css/styles.css`, **declare file-ownership per batch and a serialized
  write-order for the shared files** (parallel worktrees only for genuinely
  non-overlapping engine work).
- Present ONE prioritized plan: batch contents, **the stacked-PR sequence**, the chosen
  design direction (the human's pick), anything deferred, risky items flagged.
- **THEN STOP and wait for approval / edits before writing ANY implementation code.**
  Do not proceed past this gate on your own.

## Phase 3 — Implementation (AFTER approval)

- Implement batch by batch in the approved sequence (bugs first, aesthetics last, or as
  directed).
- **Stacked-PR model — do it safely:** each batch = a PR stacked on the previous
  (`feat/overhaul-A-bugs` → `feat/overhaul-B-perf` → …, each branched off the prior).
  **Before merging the stack, retarget each child PR's base to `main`** (deleting a
  base branch on merge auto-closes its children otherwise). The Bash env **blocks**
  `push --force`, `reset --hard`, and `branch -D` — if a branch diverges, reconcile via
  a temp branch + `merge -X ours` + fast-forward push, never a force-push. Keep PRs
  small and themed; **no mega-PR**.
- **Per batch:** implement → run the gate (`npm test` = no NEW failures vs the 2
  baseline flakes + foreground PASS check; `check-asset-integrity`; `check-sw-bump`) →
  **bump `CACHE_NAME`** if any cached file changed → add engine tests for every logic
  fix + new behavior → run `sync-invariant-reviewer` if a synced store / module was
  touched → refresh the screenshot / behavior baseline → open a focused PR (what / why,
  before/after evidence, risk, test coverage). **Never run two writer agents on
  `index.html` or `css/styles.css` at once.**
- **Brief check-in after each PR** before starting the next batch.

## Reporting

- After the gate and after each PR: concise status (what shipped, evidence,
  what's next).
- Keep repo records current as you go: **CLAUDE.md** backlog / file-map,
  **`docs/SESSION-LOG.md`**, **`CHANGELOG.md`** (conventional-commit driven via
  `cliff.toml`).
- Final summary: all PRs, bugs fixed, improvements, before/after screenshots, perf
  deltas, deferred backlog.
