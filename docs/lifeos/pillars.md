# Tempo Life-OS — Pillars

**Status:** Approved · **Date:** 2026-06-08

The structural vocabulary (see `decisions/0006`):

- **Pillar** — a top-level life domain (five of them). Synthesizes; fixed set.
- **Hub** — a recursive container with its *own* local synthesizer that routes to children; can nest.
- **Area** — a leaf you tend: one coherent trackable thing that produces a metric/state but has no council of its
  own. Hubs roll up Areas.
- **Module** — a cross-cutting plugged-in tool/integration/skill that *feeds* Areas (e.g. a repo, a feed). One
  Module can feed several Areas across pillars; see `integration-plan.md`.

Each pillar contributes a single **normalized score** to the home Balance engine (`architecture.md` §4). Metrics
below are the inputs to that score; targets are what `Neglect` is measured against. Data tiers (T1 automatic /
T2 self-defined / T3 interview) are detailed per-Area in `data-sources.md`.

Maturity legend: ✅ exists today · 🟡 partial today · 🔭 new build.

---

## 1. Life Building  *(native · the strategic pillar)*

The long game — explicitly **not** "the chore drawer." Reframed as Kyle's most *strategic* pillar: a top-to-bottom
stack from values down to the daily admin that executes them.

**Hubs → Areas:**
- **Values** 🔭 — defined core values; a periodic "did my choices align?" check.
- **Goals** 🔭 — long-term goals + progress.
- **Habits / Routines** 🟡 — habit streaks (can reuse Tempo engines).
- **Finances** 🔭 — manual monthly metrics: savings rate, credit score, debt paydown, net worth.
- **Admin / Logistics** 🟡 — errands, paperwork, renewals (fed by Todoist + calendar deadlines).

**Goal:** delayed-gratification wins — stability and a foundation for a future family.
**Key metrics:** goal-progress %, habit adherence, the finance metrics, admin overdue-count, a weekly
values-alignment rating.
**Existing assets:** Todoist (+ `Todoist_Gemini_Pipeline`), Tempo presets/streaks, `job-search-mas` (career — see
its own sub-hub note below). **New build:** Values/Goals/Finances capture + the sub-hub synthesizers.

> **Career** lives here as a sub-hub fed by the **`job-search-mas`** Module (and is *temporary* — it retires/
> archives when Kyle is employed; see `integration-plan.md`).

## 2. Physicals  *(native dashboard · federated data · richest pillar)*

Physical health and fitness. The best-instrumented pillar — mostly automatic data via `personal-health-elt`.

**Hubs → Areas:**
- **Recovery** ✅ — readiness from HRV / RHR / ACWR (the `recovery_state` mart).
- **Training load** ✅ — ACWR, zone distribution, workout history.
- **Sleep** 🟡 — sleep + nap log (Tempo) enriched by the health marts.
- **Meds** ✅ — dose log + adherence (Tempo).

**Goal:** train and recover sustainably; don't dig a recovery hole.
**Key metrics:** recovery signal, ACWR, sleep debt, meds adherence %.
**Module:** **`personal-health-elt`** publishes the `recovery_state` mart to Firestore (already consumed by Tempo
today). **New build:** the Physicals *pillar synthesizer* that turns these marts into a normalized score + nudges.

## 3. Chickens  *(native · Tempo's strongest existing pillar)*

Mental health / mind — *"tend your chickens."* Counter-intuitively the **best-served** pillar inside Tempo today
(behavioral tooling already exists); the gap is affect/mood capture.

**Hubs → Areas:**
- **Focus / Flow** ✅ — Flow Block (ultradian), Pomodoro.
- **Mindfulness** ✅ — Mindful breathing.
- **BFRB awareness** ✅ — body-focused-repetitive-behavior event stream + triggers (a real stress tell).
- **Mood / Affect** 🔭 — *the main build:* a fast daily mood/stress capture (Tempo has none today).

**Goal:** notice and tend mental state before it compounds; catch stress early.
**Key metrics:** mindful-session count, BFRB frequency/trend, mood/affect trend, focus minutes. Indirect signals:
sleep + HRV (borrowed from Physicals).
**Existing assets:** Flow / Pomodoro / Mindful / BFRB engines in Tempo. **New build:** mood capture + the Chickens
synthesizer + a weekly reflective Tier-3 check.

## 4. Relationships  *(native · drift-detector + concierge)*

The least sensor-able pillar — mostly self-report, with one automatic sliver. Reframed during discovery from a
"guilt-tracker" into a **concierge**: each person carries a **context card**, not just a last-contact date.

**Hubs → Areas:**
- **People I tend** 🔭 — a light list (Marlee, family, close friends) with last-meaningful-contact + a per-person
  **context card**: saved date-night spots / restaurants / things they've mentioned / gift ideas — whatever helps
  Kyle *show up well*. The council proactively surfaces it (*"date night Friday — here are 3 places you saved for
  Marlee"*).
- **Park social** ✅ — fed by the **`DogHood`** Module (park visits, meetups, social graph).

**Goal:** don't let important relationships drift; show up well for the people who matter.
**Key metrics:** per-person contact recency vs. an intended cadence, logged connection time, DogHood meetups.
**Module:** **`DogHood`** publishes a visits/social feed. **New build:** the people-list + context cards + weekly
"who did you connect with / who's drifting?" reflection.

> `constellation` (the co-op game with Marlee) is an **activity, not a feed** — it is logged manually as a
> connection event, not integrated as a system (see `integration-plan.md`).

## 5. Growth / Learning  *(federated sub-app · deep-link)*

Deliberate learning and skill-building. Already a full application — so it **federates** rather than being
rebuilt.

**Hubs → Areas:**
- **Courses / topics** ✅ — `learning-hub` catalog + mastery.
- **Mastery / review** ✅ — spaced-repetition + "review next."
- **Reading / milestones** 🟡 — reading log, skill milestones.

**Goal:** steady, retained learning — not just consumption.
**Key metrics:** mastery trend, review-queue health, streaks, lessons completed.
**Module / sub-app:** **`learning-hub`** stays its own app + repo; it publishes a **"Growth summary"** mart to the
spine (feeds the home synthesizer + bubble map) and the home **deep-links** into it for the full experience. **New
build:** just the published summary contract — the app itself is reused as-is.

---

## Cross-pillar notes

- **Borrowed signals are allowed.** Sleep and HRV originate in Physicals but inform Chickens; the synthesis-record
  model makes cross-pillar reads cheap (a child reads another pillar's *record*, not its raw data).
- **Native vs. federated is a spectrum, not a wall.** The rule of thumb: if a pillar is a lightweight dashboard,
  build it natively in the Tempo shell; if it's already a full app, federate it and deep-link. The home treats
  both identically because both publish a synthesis record.
- **Targets are per-Area and user-set initially**, then refined by the approve-on-change feedback loop. Defining
  the first set of targets is a Phase-2+ task in `roadmap.md`.
