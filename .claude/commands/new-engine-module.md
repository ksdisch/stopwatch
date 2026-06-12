---
description: Scaffold a new js/<name>.js module the Tempo way and wire ALL of its touch-points in one shot — the <script> tag in index.html at the correct load-order slot, the CLAUDE.md file-map + Script Load Order chain, the sw.js ASSETS entry + CACHE_NAME bump, and a tests/<name>.test.js stub registered in tests/index.html. Pass the module name + a one-line description as the argument.
---

Scaffold and fully wire a new Tempo module. Argument: `$ARGUMENTS`
(e.g. `streak-engine — tracks consecutive clean days for BFRB` or
`recovery-panel-ui — Insights panel for X`).

"Script load order in index.html IS the dependency graph" — a half-wired module breaks
offline caching or load order silently. This command exists so all four touch-points land
together. Do NOT skip any step; if you can't complete one, stop and say which.

## 1. Resolve intent (ask only if ambiguous)
From `$ARGUMENTS`, determine:
- **name** — kebab-case file stem → `js/<name>.js`.
- **kind** — one of:
  - **engine factory** (`createX(id)` returning a state object; e.g. stopwatch, timer, flow);
  - **IIFE data/singleton module** (self-contained, e.g. History, SFX, Themes, schema, distractions);
  - **UI module** (`<name>-ui.js`, plain global functions wiring DOM/handlers to a tested engine).
- **synced?** — will it write to one of the 7 synced stores (meds/history/rest_log/presets/bfrb_events/distractions/mood_events)? If yes, it MUST stamp via `js/schema.js`.

If name or kind is unclear, ask one concise question before writing anything.

## 2. Pick the load-order slot
Read the **Script Load Order** chain in `CLAUDE.md` and the `<script>` tags in `index.html`
(lines ~1072–1185). Place the new module so every dependency loads before it:
- engines load before UI; UI loads before `app.js` (always last).
- mirror any documented ordering constraints (e.g. `tempo-coach` before `rhythm-panel-today`
  and `flow-ui`; data modules before their UI). State the chosen slot and why.

## 3. Create `js/<name>.js`
Scaffold in the repo idiom for the chosen kind. Reuse, never re-implement:
`escapeHtml` (js/dom-utils.js), `Utils.formatMs` (js/utils.js), `Platform.haptic` /
`Platform.notify` (js/platform.js). If **synced**, route every store write through
`js/schema.js` `stamp(...)`. Keep it engine-pure if it's an engine (no DOM).

## 4. Wire the four touch-points (all of them)
1. **index.html** — add `<script src="js/<name>.js"></script>` at the slot from step 2.
2. **CLAUDE.md** — add a file-map line (terse, one sentence) AND insert `<name>` into the
   Script Load Order chain at the same position. These two must stay in lockstep with index.html.
3. **sw.js** — add `'./js/<name>.js'` to the `ASSETS` array AND bump `CACHE_NAME`
   (the cache-bump rule: any cached-file change needs a new CACHE_NAME in the same PR).
4. **tests/<name>.test.js** — create a minimal stub using the repo's test API
   (`describe`/`it`/`assert`/`assertEqual`/`assertClose`), and register it with
   `<script src="<name>.test.js"></script>` in `tests/index.html` (near the other 40+ entries).

## 5. Verify the wiring
```bash
node scripts/check-asset-integrity.mjs   # index.html <script> set == sw.js ASSETS js set
node scripts/check-sw-bump.mjs           # cached file changed ⇒ CACHE_NAME bumped
npm test                                 # engine suite still green (headless)
```
Report the results. The repo's committed pre-commit hook runs the first two automatically at
commit time, so green here means the commit won't be blocked.

## 6. Recap
List the files created/changed, the load-order slot chosen, and any follow-ups (e.g. "this is
a synced store — confirm the per-store merge module + firestore.rules cover it"). Do NOT commit
unless asked — leave that to the normal flow / pr-shipper.
