# Tempo — implement PR `ambient-colors-expand`

You're working on Tempo, a vanilla-JS PWA + Capacitor iOS app. This is a small, self-contained follow-up to PR #82 (backlog #3), which shipped procedural ambient noise (white / brown / pink) auto-starting on Flow + Pomodoro session start. This PR adds four more noise colors to the same dropdown.

## Required reading (before any code)

1. `CLAUDE.md` — Phase 10 § "Ambient procedural noise on Flow + Pomodoro session start (PR #82 — backlog #3)" for the contract this PR extends.
2. `js/audio.js:127–270` — the current `startAmbient` / `stopAmbient` / `_generateAmbientBuffer` implementation. New colors slot into the same per-profile-buffer pattern; do NOT refactor the play path.
3. `js/flow-ui.js:24–170` + `js/pomodoro-ui.js:5–70` — the two UI surfaces that consume `SFX.getAmbientProfiles()` and persist the chosen profile under `flow_ambient_profile` / `pomodoro_ambient_profile`.
4. `index.html:371–377` + `index.html:542–548` — the two `<select>` blocks. The current `<option>` entries are hard-coded — this PR has to decide whether to keep them hard-coded or drive them from `getAmbientProfiles()`. **Decision in this brief: keep hard-coded.** Rationale: matches how white/brown/pink ship today; smaller diff; no JS-renders-DOM coupling introduced for a 4-entry list. The renderer in `flow-ui.js:159` already pre-selects the persisted profile, so static `<option>` markup is sufficient.

## What this PR ships

Four new ambient noise profiles added to `js/audio.js`'s `AMBIENT_PROFILES` array + buffer-generator switch, plus matching `<option>` entries in the Flow and Pomodoro `<select>` blocks. No new persistence keys, no UI restructuring, no engine-API changes beyond growing one constant array.

Concretely:

### 1. `js/audio.js`

- Extend `AMBIENT_PROFILES` from `['white', 'brown', 'pink']` to `['white', 'brown', 'pink', 'green', 'blue', 'violet', 'gray']`.
- Add four new branches to `_generateAmbientBuffer(c, profile)`:
  - **`green`** — bandpass-filtered white noise centered around 500 Hz (mid-frequency emphasis, "Otto-style" forest / nature feel). Implementation: 2-pole resonant IIR bandpass on white noise. Target center ~500 Hz, Q ~ 1.0, amplitude compensation to match the loudness of pink (~0.11–0.15 scaling factor — tune by ear during smoke).
  - **`blue`** — high-frequency-emphasized white noise (+3 dB/oct). Implementation: simple differentiator — `data[i] = whiteCurrent - whitePrev`. Output is fundamentally louder than white at high frequencies; apply amplitude compensation (~0.5 scaling).
  - **`violet`** — extreme high-frequency emphasis (+6 dB/oct), aka "purple noise". Implementation: differentiator applied twice, or equivalently second-difference of white. Amplitude compensation ~0.3.
  - **`gray`** — perceptually flat (compensates for the ear's frequency response — A-weighting-shaped). Implementation: apply a dual-shelf approximation that emphasizes the low end (<250 Hz) and high end (>4 kHz) while attenuating the mid-band. A simple approach: 2-band peaking filter, or a "U-shape" combination of a low-shelf boost + high-shelf boost + mid-band attenuation. Tune amplitude to match white-noise loudness.
- Keep the existing lazy-cache pattern: `_ambientBuffers[profile]` is generated on first start and held for the AudioContext lifetime. ~880 KB per profile × 7 profiles = ~6 MB peak — well within budget.
- `getAmbientProfiles()` already maps `AMBIENT_PROFILES` to `{ id, name }` pairs by capitalizing the first letter; the new colors will render as "Green" / "Blue" / "Violet" / "Gray" automatically. No code change needed for the API surface.

### 2. `index.html` (Flow dropdown + Pomodoro dropdown)

Add four new `<option>` entries to both `<select id="flow-ambient-profile">` (line 372) and `<select id="pomo-ambient-profile">` (line 543), in the same order as `AMBIENT_PROFILES`:

```html
<option value="green">Green</option>
<option value="blue">Blue</option>
<option value="violet">Violet</option>
<option value="gray">Gray</option>
```

Place them after the existing `<option value="pink">Pink</option>` line in each block. No CSS changes.

### 3. `sw.js` — CACHE_NAME bump

Per the hard rule in CLAUDE.md, any cached-asset change requires a `CACHE_NAME` version bump in the same PR. `js/audio.js` + `index.html` are both cached. Bump from `v91-native-sync-parity` to `v92-ambient-colors`.

### 4. (Optional) `tests/audio.test.js`

Audio code has no existing unit tests (Web Audio is non-trivial to mock; convention is "ship + smoke"). The minimal sanity test worth adding: `getAmbientProfiles()` returns 7 entries with IDs `['white', 'brown', 'pink', 'green', 'blue', 'violet', 'gray']` in order. This catches the most likely regression — someone adds a color but forgets to register it in `AMBIENT_PROFILES`. **Engine-tester's call** whether to add this; orchestrator should treat tests as optional for this PR.

## Hard rules

- **Audit before code.** First commit on the branch is `docs/audits/ambient-colors-expand-AUDIT.md` listing affected files, blast-radius tier, and the manual smoke plan (steps to actually hear each new color). STOP after the audit and wait for review.
- **Do NOT refactor the play path.** Keep `startAmbient` / `stopAmbient` / `_stopAmbientNode` byte-equivalent. The new colors are pure buffer-generation additions inside the existing switch.
- **Do NOT modify the UI rendering layer.** Hard-coded `<option>` entries in `index.html` — do not introduce a JS-renders-DOM coupling for a 4-entry list change.
- **Do NOT bump `SCHEMA_VERSION` or add a persistence key.** Existing `flow_ambient_profile` / `pomodoro_ambient_profile` keys store the chosen profile id; new ids work transparently. (Old persisted "pink" / "brown" continue to work; if a future client somehow persists "green" and downgrade-loads on a pre-PR client, the unrecognized profile falls through to `stopAmbient()` per the existing `AMBIENT_PROFILES.includes(profile)` guard — graceful degrade.)
- **`sw.js` CACHE_NAME MUST bump** to `v92-ambient-colors`. Cached files changing without a cache-bump means existing PWA installs would serve stale JS.
- **No new dependencies.** Pure Web Audio API additions, no npm package changes.
- **No platform-specific code.** All four generators run in JS; both web and iOS Capacitor consume the same `audio.js`. Smoke on both surfaces — but no `js/platform.js` changes.

## Engine-test plan

Optional. If `engine-tester` adds anything, scope is one new `tests/audio.test.js` with a single assertion: `SFX.getAmbientProfiles().map(p => p.id)` equals `['white', 'brown', 'pink', 'green', 'blue', 'violet', 'gray']`. This requires the test harness to load `js/audio.js` (currently not in `tests/index.html`'s script list — check before adding). If loading audio.js in the harness pulls in `getCtx()` and that croaks without a real AudioContext, scope the test to a pure registration check and skip generator invocation.

If the test would require non-trivial harness changes, **skip the test**. Smoke replaces it.

## Manual smoke (in audit doc)

After the engine + UI ship and `npm run sync-www` runs:

1. Open the app in a browser. Navigate to `#/timers/flow`.
2. In the Flow setup view, open the "Ambient sound" dropdown and confirm 7 options visible in order: Off / White / Brown / Pink / Green / Blue / Violet / Gray. (The empty "Off" entry already exists.)
3. Pick "Green" — start a Flow block — confirm green-noise plays (mid-band, "natural" feel; should sound qualitatively different from pink/brown).
4. Pause Flow — confirm green-noise stops.
5. Resume — confirm green-noise restarts.
6. Reset Flow — confirm green-noise stops.
7. Repeat steps 3–6 for Blue, Violet, Gray. Each should sound qualitatively distinct from the others and from white/brown/pink. If two colors sound indistinguishable, the implementation has a bug — flag and pause.
8. Navigate to `#/timers/pomodoro`. Open settings panel, pick each new color from the "Ambient sound" dropdown, save settings, start Pomodoro. Confirm noise starts on `phase === 'work'` only (not on break phases).
9. Toggle global mute via the speaker icon mid-session — confirm ambient stops. Unmute — confirm ambient resumes with the same profile.
10. On iOS (if the build is current): run `npm run ios:open`, build to device, repeat the basic smoke (one color in each mode) to confirm no platform-specific regression in WKWebView audio playback.

## Blast radius (auditor sets, but pre-estimated)

**Tier: medium.**

Drivers:
- `sw.js` CACHE_NAME bump → forces medium per orchestrator rubric.
- Touches ≥2 files (`js/audio.js`, `index.html`, `sw.js`).
- No UI structural change, no schema, no new persistence, no platform code, no new deps → not high.

## Deliverable

Branch `feat/ambient-colors-expand`, PR against `main`. Commits:

1. `docs(briefs): audit for ambient-colors-expand` — audit doc only. STOP.
2. After greenlight: `feat(audio): green/blue/violet/gray procedural noise + UI` — engine + UI + `sw.js` bump in one commit (small enough to bundle cleanly).
3. (Optional) `test(audio): profile registration sanity` — if engine-tester chose to ship the minimal test.
4. `docs(backlog): mark ambient colors expansion shipped` — CLAUDE.md backlog/Phase 10 update + SESSION-LOG entry. pr-shipper handles this.

PR title: `feat(audio): expand ambient noise colors (green/blue/violet/gray)`.
