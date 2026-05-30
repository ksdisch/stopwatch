# Postmortem template

> **How to use this file.** Copy it to a dated, slugged filename — `docs/postmortems/YYYY-MM-DD-<short-incident-slug>.md` (the date is the day the incident was *resolved*, not the day this writeup happens). Keep this `TEMPLATE.md` itself unchanged; it is the form, not an instance.
>
> **Blameless, always.** Postmortems here describe systems and process, never individuals. The question is "what about the system let this happen and ship," not "who wrote the line." A solo portfolio app has exactly one author — naming a person adds zero signal and corrodes the habit, so don't. Write about the code path, the test gap, the missing guard, the review step that wasn't there.
>
> **Link the evidence.** Every fix references the commit or PR that shipped it, and the `CACHE_NAME` slug it shipped under (`sw.js` carries a version string — currently `stopwatch-v105-sw-schema-asset`, `sw.js:1` — that bumps on every cached-file change; recording it pins the incident to a deployable artifact). This mirrors the [ADR discipline](../adr/README.md): a claim without an anchor is a defect.

---

**Date:** *Resolution date, `YYYY-MM-DD`. Same value as the filename's date prefix.*
**Status:** *`Draft` while still being written/verified → `Final` once the timeline and action items are settled.*
**Author(s):** *Who wrote the postmortem. (Authorship of the writeup is fine to name; blame for the incident is not — see the blameless note above.)*
**Severity:** *One of the scale below.*
**Affected surface(s):** *The modules / stores / UI panels touched, by name — e.g. `js/sync-engine.js` steady-state, the `meds` synced store, the Rhythm readiness band. Be specific; "sync" is not a surface.*

### Severity scale

A deliberately small scale, sized for a single-user portfolio app where the blast radius is "me, on my own devices":

| Sev   | Meaning                          | Example                                                                 |
|-------|----------------------------------|-------------------------------------------------------------------------|
| Sev-3 | Caught in validation             | A race or regression found by deliberate review/testing *before* it reached daily use. No real-world exposure. |
| Sev-2 | User-visible                     | Reached the running app and was noticed in normal use — wrong countdown, a band that wouldn't render, a sync that silently no-op'd. |
| Sev-1 | Data loss / corruption           | Synced or persisted user data was destroyed, overwritten, or made unrecoverable — the one outcome the merge + schema guards exist to prevent. |

---

## 1. Summary

*Two to four sentences: what happened, the blast radius, and how it was resolved. A reader should be able to stop here and know the shape of the incident. Write it last.*

## 2. Impact

*Who and what was actually affected, in concrete terms. For a single-user app, be honest about scope rather than inflating it — "caught in validation before any daily-use exposure" is a complete and valid impact statement, and so is "no synced data was lost; the regression only blanked a read-only band." State which devices, which stores, and which time window were in play, and explicitly note when the answer is "none, because X caught it first."*

## 3. Timeline

*Dated/timestamped events in order: detection → diagnosis → fix(es) → verification. One line per event. Link the commit or PR on the fix/verification rows. Use a consistent zone (the repo's history is in local time); approximate timestamps are fine if that's all you have — say so.*

| When (`YYYY-MM-DD HH:MM`) | Event | Evidence |
|---------------------------|-------|----------|
| *timestamp* | *Detection — the moment the problem became visible.* | *how (review note, test run, app behavior)* |
| *timestamp* | *Diagnosis — root cause understood.* | *the file:line or reasoning* |
| *timestamp* | *Fix shipped.* | *commit `<hash>` / PR #N* |
| *timestamp* | *Verification — confirmed fixed.* | *test count, browser check, or commit* |

## 4. Root cause(s)

*The technical "why," in the same evidence-anchored register as the ADRs: every causal claim carries a `file.js:line` or commit anchor pointing at the real code path. List multiple contributing causes when they exist — most incidents are a primary cause plus a couple of conditions that let it through (a missing guard, an untested branch, an ordering assumption). Distinguish the **trigger** (what fired it) from the **latent cause** (what made the trigger dangerous).*

## 5. Detection

*How it was actually found — and be precise about the difference, because it predicts whether the next one gets caught. Was it **deliberate validation** (a review pass, a test you wrote on purpose, an audit step), a **user report** (you hit it in daily use), or **luck** (you noticed it incidentally while doing something unrelated)? Luck is not a detection strategy; if that's the honest answer, say so plainly — it's the strongest argument for the action items below.*

## 6. Resolution

*The fix or fixes that shipped, each with its commit/PR anchor and the `CACHE_NAME` slug it deployed under (`sw.js:1`). If the incident was resolved by a cluster of commits, list each one with the specific thing it closed. State explicitly whether the fix is complete or whether residual risk remains (and if so, link the tracking item in §9). Note any service-worker cache bump, since on this app a cached-file change that ships without a `CACHE_NAME` bump leaves users on stale code — itself a latent incident.*

## 7. What went well

*The systems and habits that limited the damage or sped the fix — name them so they're reinforced. The drift-free engines, the per-store merge isolation, the typed-error degradation, the schema guard, the review pass that caught it: whatever actually helped, credit the mechanism (not a person).*

## 8. What went wrong / contributing factors

*Blameless, process- and systems-focused. The gaps that let the problem form or ship: a missing test for a branch, an absent guard, an ordering assumption that wasn't documented, a verification step that doesn't exist in the harness (e.g. native paths that can't be exercised without Xcode + a device). Each gap is a candidate action item below.*

## 9. Action items

*Concrete, owned, trackable follow-ups — one row each. "Be more careful" is not an action item; "add a fixture test asserting X" is. Mark each as done with a date, or open with a tracker (backlog row, issue, ADR). It is honest and common for the list to include items that stay open — say so.*

| Item | Owner | Status / Date |
|------|-------|---------------|
| *concrete follow-up* | *who* | *`Done YYYY-MM-DD` / `Open — tracked by <ref>`* |

## 10. Lessons learned

*The durable takeaways — what this incident teaches that outlives the specific bug. Aim for transferable principles a future change should internalize ("append-only health data must never go through a last-write-wins path," "any branch that can't be exercised in the web harness needs an explicit typed-error degradation, not a silent no-op"), not a restatement of the fix.*

---

*For the expected density and tone — every behavioral claim carrying a real `file.js:line` or commit anchor, honest scoping, blameless framing — see the worked example: [`2026-05-17-cloud-sync-race-fix-cluster.md`](./2026-05-17-cloud-sync-race-fix-cluster.md). It fills in these same sections in order, so this template and that instance read as the same form blank-vs-completed. The discipline is the sibling of the [decision-record practice](../adr/README.md): durable, append-only, anchored.*
