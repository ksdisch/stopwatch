# Analytics Module Buildout

## 1. Current state audit

`js/analytics.js` (126 lines) aggregates `session.duration` only — mode totals,
8-week stacks, 26-week heatmap, personal bests, trends. `js/analytics-ui.js`
(128 lines) renders four cards + stacked bar + heatmap.

**Works:** clean engine/UI split; heatmap reads honestly; stacked-bar mode colors.
**Thin:** every view ignores fields beyond `type`+`duration`. BFRBs (3 stores) never
aggregated. Distractions never charted. No streaks, med adherence, time-of-day,
completion rate. Flow `endedEarly`/`preBlockSkipped`/`blockDurationMs` and Pomodoro
`completedCycles`/`actualWork`/`phaseLog` are stored but unused. Empty state is
a bare placeholder — no "your first metric" affordance.

## 2. Data inventory

- **Stopwatch / Timer / Sequence:** id, date, type, duration, laps[], note, tags[].
- **Interval / Cooking:** +programName.
- **Pomodoro:** +completedCycles, totalWorkMs, focusGoals[], breakTasks[],
  actualWork[], sessionStartedAt/EndedAt, phaseLog[{phase, startedAt, endedAt,
  restarted?}], distractions[{category, note, timestamp}].
- **Flow:** +goal, blockDurationMs, preBlockSkipped, endedEarly, distractions[],
  bfrbs[{timestamp, phase?}].
- **Outside focus:** `localStorage.bfrbs_global = [{timestamp}]`.
- **Meds:** `localStorage.wellness_meds.meds[].doseLog[{takenAt}]` + frequency ∈
  once-daily / twice-daily / as-needed.

**Captured-but-unsurfaced:** `endedEarly`, `preBlockSkipped`, `actualWork`,
`phaseLog.restarted`, every distraction `category`+`timestamp`, every BFRB
`timestamp`+`phase`, the global BFRB log entirely, med `doseLog`.

## 3. Proposed features

| # | Feature | Question | Data | UI | Effort |
|---|---|---|---|---|---|
| A | BFRB trend + rate | Am I catching fewer per focus-hour over time? | Merge `flow_bfrbs`+`pomodoro_bfrbs`+`bfrbs_global`+session `bfrbs[]`; group by day; divide by daily focus-hours. | Line chart, 14/30/90d toggle. | M |
| B | BFRB hour-of-day | When do I catch most? | BFRB timestamps → hour bucket. | 24-col heat strip. | S |
| C | BFRB by source | Flow vs Pomo vs outside? | Count per store key. | 3-segment stacked bar. | S |
| D | Flow completion rate | How often do I end early? | Flow sessions: `endedEarly`; `duration/blockDurationMs`. | Donut + avg-% card. | S |
| E | Distraction leaderboard | What derails me most? | Pomo+Flow `distractions[].category`, split by mode. | Top-5 horizontal bar. | S |
| F | Distraction hour-of-day | When do I get pulled? | `distractions[].timestamp` → hour. | 24-col heat strip. | S |
| G | Focus streak | Consecutive days with ≥1 flow or pomodoro session? | Filter `type ∈ {flow, pomodoro}`; current + longest. | Big number + 7-day dots. | S |
| H | Med adherence 30d | Taking once/twice-daily meds? | `doseLog` per day vs `frequency`. | 30-day dot row per med (●/◐/○) + %. | M |
| I | Actual-work log | What did I work on this week? | Pomodoro `actualWork[]` across week. | Top-10 list. | S |
| J | Phase-restart count | Am I bailing phases? | `phaseLog[].restarted`. | Card in Pomodoro section. | S |

Skipped (low-value-high-effort): goal-text auto-clustering (needs NLP);
Interval/Cooking trends (too infrequent — weak signal).

## 4. Priority stack

**S-tier ship-first:**
1. **G — Focus streak.** Trivial math, biggest behavioral nudge, dashboard-top.
2. **D — Flow completion rate.** User just shipped end-early; first question
   they'll ask. Pure roll-up of existing fields.
3. **E + F — Distraction leaderboard + hour-of-day.** Same source, ship together.

**M-tier next:**
4. **A — BFRB trend.** Headline user concern. Needs a 3-store merge helper.
5. **H — Med adherence.** High stickiness; only one that reaches into `localStorage`.

Defer B / C / I / J until the top 5 land.

## 5. Data gaps

- **Flow goal categories** — no field categorizes a goal. Rollups by category
  need user tags. Suggest: reuse `tags[]`; surface top-5 suggested tags on
  block-complete.
- **BFRB context beyond phase** — `bfrbs_global` entries have only `timestamp`.
  "Which app was open?" would need active-window capture; probably not worth it.
- **Med timing nuance** — no `targetTimes[]`, so adherence is binary per day. To
  report "taken on time" we'd need an optional `targetTimes[]` field. Defer.
- **Distraction duration** — only a timestamp; no way to measure derail length.
  Minor.
