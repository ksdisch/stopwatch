# Session wrap — Rhythm Insights dashboard (Tempo)

**Date:** 2026-06-03
**Branch / PR:** `feat/rhythm-insights-meds-sleep` → [PR #111](https://github.com/ksdisch/stopwatch/pull/111) (open, awaiting review/merge)
**Commits:** `f48ccbf` (feature, 24 files +2852/−26), `04fb866` (docs: backlog row #13)

---

## 1. What we did

- Shipped backlog **#12** (Rhythm Insights dashboard) + **#11** (sleep bedtime/wake schema) as one PR: the Rhythm pillar went from a single-day timeline to a 7-panel insights dashboard behind a `Timeline | Insights` sub-nav.
- Built a foundation engine `js/rhythm-insights.js` — a **panel registry** (`register`/`getPanels` by `order`), a dependency-injected data layer (`_deps`), shared inline-SVG chart helpers, and `renderInto()`.
- Wrote 7 self-registering panels (`js/rhythm-panel-*.js`): meds-sleep, recovery-trends, focus-minutes, bfrb-frequency, distraction-rollup, event-zoom, correlations. Foundation + flagship meds-sleep built in-session; the other **6 built by parallel subagents** (1 new JS + 1 test file each, zero shared-file edits).
- Added optional Bedtime/Wake `<input type="time">` to the Recovery sleep form (`js/recovery-ui.js`) with a `wake−bed` cross-check; wired the sub-nav (`tempo-nav.js`, `rhythm-ui.js`, `index.html`); bumped `sw.js` → `v106-rhythm-insights`.
- Verified in a real browser: **808 tests, 802 pass** (+59 new, all green); a stash/baseline run proved the 6 failures are all pre-existing. Visually confirmed all 7 panels at 390px.
- Ran a high-effort multi-angle code review (workflow); one finder hung, salvaged the rest, and manually refuted every flagged correctness candidate against the code — **no confirmed bugs**.
- Flagged a pre-existing bug found during the work (backlog **#13** + tech-debt) and wrote a handoff prompt for it; left it unfixed by request.

## 2. The why

- **Registry pattern over one big file.** `analytics-ui.js` is one ~760-line file; copying that would have serialized the 6 panels and caused merge conflicts. Inverting to a registry made each panel a *disjoint new file* → genuinely parallelizable across subagents and extensible later. Tradeoff: a bit more indirection (a `register` indirection + an `order` field) vs. a flat file.
- **Dependency injection layer (`_deps`).** Panels read only through an injected `deps` object (live defaults, overridable). Lets each panel's `build()` be unit-tested by passing plain data — no IndexedDB seeding or global stubbing. Kept the live-read defaults so production needs no wiring. Pattern: *seam for testing without rearchitecting.*
- **`Promise.allSettled` in `renderInto`.** One panel's `build()` throwing (e.g. a cloud read on a signed-out user) must not blank the whole dashboard; each failed panel degrades to a fallback card. Principle: *fault isolation at the composition boundary.*
- **dose[D] → sleep[D+1] pairing (meds-sleep).** A morning dose influences *that night's* sleep, which the user logs the next morning under D+1 — same-day pairing would be non-causal (the dose came after that sleep). Tradeoff: the correlations panel uses same-day sleep[D]→focus[D] (last night's sleep → today's focus) — both correct for their question, but the inconsistency is a future-dev trap, so it's documented in the file header.
- **"Night hour" onset axis.** Map bedtimes `< 12:00` to `+24` so 11 PM (23) and 12:30 AM (24.5) sit adjacent on a 6 PM→6 AM band instead of splitting across a 0–24 axis. Tradeoff: day-sleepers (10 AM bedtime) clamp to the axis edge — acceptable edge for the use case.
- **`tempo-nav` as single router.** Removed RhythmUI's own `hashchange` listener so route changes don't double-render; tempo-nav forwards the normalized sub to `RhythmUI.render(sub)`.
- **Additive-nullable #11 fields.** `bedtime`/`wakeTime` are optional strings on the existing `sleep` object → no migration, and they sync for free because `rest_log` is already a synced store. Pattern: *additive migration, not destructive.*
- **Verified "pre-existing" with a baseline.** Rather than assert the 6 failures weren't mine, I `git stash`ed the tracked changes, re-ran the suite (725/731), and diffed — proving zero new failures. Principle: *prove the baseline, don't claim it.*
- **Deferred the timeline bug.** Fixing it needs a `tests/rhythm.test.js` seed change, which would muddy the feature PR — kept cohesive and flagged in two places instead.

## 3. Concepts and vocabulary

- **Panel registry / plugin registry** — modules self-register into a central list that orders + renders them. Here: `RhythmInsights.register({key,title,order,build,render})`.
- **Dependency injection (DI)** — pass collaborators in rather than reaching for globals, so tests can substitute them. Here: `build(deps)` with `_deps()` live defaults overridable via `renderInto(el, {deps})`.
- **`Promise.allSettled`** — awaits all promises and reports each as fulfilled/rejected (never short-circuits on first reject). Here: builds all panels so one failure can't blank the board.
- **Event delegation** — one listener on a stable parent handles events from dynamic children via `closest()`. Here: a single `data-insight-action` click listener on the insights container survives `innerHTML` swaps.
- **Lexical `const` global vs. `window` property** — a top-level `const X` in a classic script is *not* a property of `window`; `window.X` is a different binding. Bit us when a test stub `window.History = …` didn't override the app's `const History` (worked in the test harness only because `history.js` isn't loaded there).
- **Additive-nullable migration** — extend a record with optional fields that old data simply lacks; no data rewrite. Here: `sleep: { hours, quality?, bedtime?, wakeTime? }`.
- **Flaky test / time-of-day flakiness** — a test whose pass/fail depends on wall-clock state. Here: two rhythm-engine "straddles now" tests fail near midnight because constructed sessions spill past day boundaries.
- **Baseline diff (stash-to-isolate)** — stash your changes, run the suite, compare failure sets to separate your regressions from pre-existing noise.
- **Adversarial / multi-angle review (find → verify)** — independent finder passes surface candidates; a verifier pass keeps only those constructible from the code. Run today as a workflow (7 finders → dedup → verify).
- **`/batch` orchestration + plan mode** — a coordinator decomposes work into independent units, gets plan sign-off, then fans out background agents. Used here as foundation-in-session → 6 parallel panel agents → one PR.

## 4. Takeaways

- **If N things share a scaffold, invert the scaffold into a registry.** Each thing becomes a disjoint file you can build/test/ship in parallel. Today: 6 panels built concurrently with zero merge conflicts because each only touched its own file.
- **Add a DI seam instead of rearchitecting for tests.** Keep live-read defaults; let tests pass plain data. Today: every panel's aggregation is unit-tested without touching IndexedDB or stubbing globals.
- **Don't trust auto-generated review findings — verify against the code and cite the line.** Today: 3 finders flagged the same "empty-string sub shows wrong surface" bug; the actual code normalizes `sub:'' → 'timeline'` one line up, refuting all three.
- **Prove the baseline before claiming "pre-existing."** A stash + re-run turns "I think those failures aren't mine" into "the baseline has exactly these 6, my branch adds zero."

## 5. Suggested next moves

1. **(Recommended) Fix backlog #13 — Rhythm Timeline dose dots.** `rhythm-engine.js` `getDoseEntries()` reads the legacy `wellness_meds` blob that `meds.js` deletes post-migration, so Timeline dose events render empty. Point it at `MedsManager.all()` + `getDoseLog()` and re-seed `tests/rhythm.test.js` via the manager. *Why first:* small, fully specified (a handoff prompt already exists), high correctness value, isolated blast radius. **Effort: ~30–60 min.**
2. **Diagnose the 4 `recovery-feed.test.js` NPEs.** Same `Cannot read properties of null (reading 'day'/'rows')` across all 4; long-standing baseline noise that masks real regressions in every run. *Why:* clearing it makes the suite a clean signal. **Effort: ~1 hr.**
3. **De-flake the 2 time-of-day rhythm-engine tests.** "straddles now" / "upcoming" fail when run late at night. Inject/freeze a fixed clock instead of `Date.now()`. *Why:* removes false negatives. **Effort: ~30 min, test-only.**
4. **Merge PR #111** (your call) — auto-deploys to GitHub Pages on merge. *Why:* unblocks using the dashboard on-device + closes the #11/#12 loop.

## 6. 30-second elevator version

Today I turned the Rhythm tab of a personal stopwatch/wellness PWA from a single-day timeline into a seven-panel insights dashboard — the headline being a meds-vs-sleep scatter that shows whether taking my morning dose earlier correlates with falling asleep earlier. The interesting bit is the architecture: instead of one big file, I built a small registry where each chart is a self-contained module that registers itself, which let me build the foundation plus the flagship panel by hand and then fan the other six out to parallel agents with zero merge conflicts. Each panel's data logic takes its inputs through a dependency-injection seam, so I could unit-test them with plain data instead of mocking a database. I verified it in a real browser — 802 of 808 tests passing, and I proved the six failures were pre-existing by stashing my changes and re-running the baseline. I also ran an adversarial multi-angle code review, and when it flagged bugs I refuted each one by citing the actual line, so it shipped clean.

## 7. Active recall

1. Walk me through how the dashboard renders seven panels, and what happens if one panel's data source throws.
2. Why a registry pattern here instead of one rendering module like the existing analytics view?
3. The meds-vs-sleep panel pairs a dose on day D with the *next* day's sleep entry — why, and how does that differ from the correlations panel?
4. You stubbed `window.History` in a browser test and it didn't take effect in the app. Why?
5. You reported 6 test failures but said zero were yours — how did you establish that?

---

*Try to answer each aloud before scrolling. Answer key below.*

### Answer key

1. `RhythmInsights.renderInto(container)` reads the registered panels (sorted by `order`), runs every panel's `build(deps)` concurrently under `Promise.allSettled`, then writes the container's HTML once and wires a single delegated click listener for toggles. Because it's `allSettled`, a rejected `build()` (or a `render()` that throws, caught per-panel) is swapped for a fallback "Could not load/render" card — the other six still render. One panel failing never blanks the board.

2. The panels share a scaffold (the engine, sub-nav, chart helpers) but are otherwise independent. A registry inverts the dependency: each panel is a disjoint `js/rhythm-panel-*.js` that calls `register(...)`, so the six non-flagship panels could be built by parallel agents touching only their own files — no contention on a shared file. A single module (the analytics-ui approach) would have serialized that work and caused merge conflicts. Cost is minor indirection.

3. A dose taken the morning of day D influences *that night's* sleep, which the user logs the next morning under date D+1 (the form says "last night's sleep"). So the causal pair is dose[D] → sleep[D+1]; pairing same-day would correlate the dose with the *previous* night, which the dose couldn't have affected. The correlations panel instead pairs sleep[D] → focus[D] — also causal, because the sleep logged under D is the night *before* day D's focus. Both are correct for their respective question; the difference is documented in the correlations file header to avoid a future-dev trap.

4. In a classic (non-module) script, a top-level `const History = …` creates a *lexical* binding that is not a property of `window`. The app's code references that lexical `History`, so assigning `window.History = stub` created a separate, unread binding — the real module kept reading IndexedDB (empty in the container) and the sessions-dependent panels showed empty states. (The unit-test harness works only because it doesn't load `history.js`, so there the bare `History` reference resolves to `window.History`.) The fix for the visual check was to use the supported `renderInto(el, {deps})` injection path instead.

5. I ran the suite on my branch (802/808), then `git stash`ed the tracked changes to get the repo back to `main`'s state, re-ran the suite (725/731), and compared the failure sets. The 6 failing test names were identical in both runs — 4 `recovery-feed` NPEs and 2 time-of-day rhythm-engine cases — and my branch's `+59` new tests all passed. Same failures before and after ⇒ zero regressions introduced.
