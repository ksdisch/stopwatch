# ambient-colors-expand · Expand procedural ambient noise from 3 colors to 7 (add green/blue/violet/gray)

## Goal
Extend PR #82's procedural ambient noise feature by adding four new noise-color profiles (green, blue, violet, gray) to `SFX.AMBIENT_PROFILES`, surfacing them as `<option>` entries in both the Flow and Pomodoro ambient-sound dropdowns. Pure additive change — no engine-API surface change, no new persistence keys, no UI structural rework.

## Blast radius
**Tier:** medium

**Justification:** `sw.js` `CACHE_NAME` MUST bump because `js/audio.js` + `index.html` are both cached web assets that change — per the orchestrator rubric, a cache-bump-required PR is automatically medium even though only 3 files actually change. No schema bump, no sync-store touch, no native code, no new dependencies, no new persistence keys — so not high.

## Affected files
| Path | Change type | Notes |
|------|-------------|-------|
| `js/audio.js` | modify | Extend `AMBIENT_PROFILES` array from 3 → 7 entries; add four new `else if` branches inside `_generateAmbientBuffer(c, profile)` for `green` (bandpass-filtered white ~500 Hz, Q~1.0), `blue` (single differentiator, +3 dB/oct), `violet` (double differentiator, +6 dB/oct), `gray` (dual-shelf U-curve approximating A-weighting inverse). Per-color amplitude compensation tuned by ear during smoke. Keep `_stopAmbientNode`, `startAmbient`, `stopAmbient`, `getAmbientProfile`, `setAmbientVolume`, `getAmbientProfiles` byte-equivalent — additive-only. |
| `index.html` | modify | Add four `<option>` entries to `<select id="flow-ambient-profile">` at line 372–377 AND to `<select id="pomo-ambient-profile">` at line 542–548. Decision: keep `<option>` markup hard-coded (matches existing 3-color rendering; avoids JS-renders-DOM coupling for a 4-entry list). **Order question flagged** — see Risks below. |
| `sw.js` | modify | Bump `CACHE_NAME` constant on line 1. **Current value is `'stopwatch-v90-rhythm-pillar'`** — the brief assumed prior value `v91-native-sync-parity`, which is off-by-one. Implementer should bump to `v91-ambient-colors` (or `v92-ambient-colors` if a `v91-native-sync-parity` PR lands first). pr-shipper picks the correct increment at ship time. |
| `tests/audio.test.js` | add (optional) | New file IF engine-tester elects to add the minimal sanity test: assert `SFX.getAmbientProfiles().map(p => p.id)` equals `['white','brown','pink','green','blue','violet','gray']`. Requires harness changes (see next row). Recommended **deferred** — see Test scope below. |
| `tests/index.html` | modify (conditional) | Add `<script src="../js/audio.js"></script>` to the engine-modules block AND `<script src="audio.test.js"></script>` to the test-suites block. ONLY if the optional test ships. Adds a new dependency on Web Audio inside the test harness — `getCtx()` would lazily instantiate `AudioContext` if any test invoked a generator path, but the proposed sanity test only reads the static `AMBIENT_PROFILES` map, so the AudioContext should never get created. |

**Confirmed minimum file count: 3** (`js/audio.js`, `index.html`, `sw.js`). Maximum with optional test: 5.

## Cross-cutting invariants touched
- **`sw.js` CACHE_NAME** — load-bearing. Any cached web file change without a cache bump means existing PWA installs (web + iOS WKWebView) serve stale JS until SW expires, hiding the new options indefinitely. This is THE tier-medium driver.
- **`AMBIENT_PROFILES` includes-guard contract** — `startAmbient(profile)` already calls `AMBIENT_PROFILES.includes(profile)` and falls through to `stopAmbient()` when the value is unrecognized. Extending the array is the ONLY way to add a valid profile. Persisted values (`flow_ambient_profile` / `pomodoro_ambient_profile`) that hold a new id (e.g. `"green"`) will graceful-degrade to "off" on any pre-PR client without the new array entry — no migration needed.
- **`getAmbientProfiles()` API surface** — capitalizes first letter of each id. New ids render as "Green" / "Blue" / "Violet" / "Gray" automatically. No code change to the function itself.
- **Web Audio Buffer footprint** — ~880 KB per profile at 44.1 kHz mono × 7 profiles = ~6 MB peak (only realized if user actually plays all 7 during one session, since `_ambientBuffers[profile]` is lazy-cached). Well within budget per the existing comment in `js/audio.js:133–134`.
- **Sync invariants:** none touched. Profile choice is per-device user preference (like `bfrb_volume`, `sound_profile`); intentionally excluded from cloud-sync stores.
- **Native bridges:** none. Pure Web Audio works identically on web + iOS Capacitor WKWebView (PR #82 already validated this surface).

## Risks
| Risk | Likelihood | Blast radius | Mitigation |
|------|------------|--------------|------------|
| Cache-bump trap — `sw.js` CACHE_NAME forgotten in same commit as `audio.js` + `index.html` changes. Existing PWA installs serve stale JS; users see only the original 3 options indefinitely. | med | web-bytes | pr-shipper's checklist explicitly catches this. The implementer's commit must bundle all three files atomically. Smoke step 2 detects it (only 4 options visible instead of 8). |
| Amplitude mismatch across profiles — new colors play noticeably louder or quieter than white/brown/pink at the same `ambient_volume`. User has to ride the volume slider when switching colors mid-session. | high | local-only | Brief's tuning ranges are starting points (green ~0.11–0.15, blue ~0.5, violet ~0.3, gray TBD). Engine-implementer must subjectively level-match against pink (which itself is `* 0.11`) — smoke steps 3, 7 explicitly call for "qualitatively distinct" comparisons. If two profiles sound indistinguishable OR one is wildly louder, flag and re-tune before PR ship. |
| Option-order ambiguity in `<select>` blocks. Brief says "place after the existing pink line" (which suggests Off → Brown → Pink → Green → Blue → Violet → Gray on alphabetical-like existing order), but the smoke-step-2 list reads "Off / White / Brown / Pink / Green / Blue / Violet / Gray" (which would require also reordering the existing 3 entries). | med | local-only | Recommendation: **keep existing 3 entries in their current alphabetical order (Brown / Pink / White) and append the 4 new ones in the brief's stated order (Green / Blue / Violet / Gray)**. Final visual order: Off / Brown / Pink / White / Green / Blue / Violet / Gray. This minimizes diff (no reorder of existing options) and matches "place them after the existing pink line." Smoke step 2's listed order should be amended in this audit. Flagged as an open question. |
| `blue` and `violet` profiles emit unusable high-frequency hiss. Differentiator-based generation has known high-pass characteristics; at the default `0.05` volume they may be fine, but raising the slider could feel painful through earbuds. | med | local-only | Smoke must validate at multiple volume levels (0.05 default + at least one higher level the user might pick). If unusable, ship anyway (user can pick another color), but document in CLAUDE.md Phase 10 update. |
| `gray` profile implementation lacks a concrete formula in the brief — "dual-shelf approximation that emphasizes the low end (<250 Hz) and high end (>4 kHz) while attenuating the mid-band" is qualitative. Engine-implementer may need to iterate on coefficients during smoke. | low | local-only | Acceptable for a non-test-covered audio routine. The reference implementation can stay rough; smoke is the canonical validator. If gray ends up too close to white perceptually, flag and re-tune. |
| `tests/audio.test.js` triggers `AudioContext` instantiation if any code path invokes `getCtx()` during the test load — could fail in headless test contexts (CI). | low | local-only | Mitigated by scoping the test to a pure registration-array assertion: `SFX.getAmbientProfiles().map(p => p.id)`. This path never calls `getCtx()` (the function is a pure synchronous map over a constant array). If the test ships and any test-runner step still trips on AudioContext init, drop the test (smoke replaces it). |

## Test scope
- **New tests required:** none mandatory. Audio code has no existing unit-test coverage — convention is ship + smoke. The optional `tests/audio.test.js` is **recommended deferred** because:
  - The harness change to load `js/audio.js` is a new dependency on Web Audio for the test surface (precedent-setting for downstream audio tests).
  - The only sane assertion (profile registration order) is trivial — easier caught by smoke step 2.
  - The implementer is unlikely to add a new color and forget to register it in `AMBIENT_PROFILES`, because the same diff that adds the `else if` branch in `_generateAmbientBuffer` would need a matching array entry anyway (the array IS the contract).
  - Engine-tester gets the final call. If they do ship the test, see the conditional row in the affected-files table for the required harness change.
- **Existing tests at risk:** none. No existing test imports `js/audio.js`. All 605 sync + engine tests remain green.

## Manual setup steps (10 steps — canonical smoke plan)
1. After the engine + UI ship, run `npm run sync-www` to mirror repo root → `www/` for Capacitor.
2. Open the app in a desktop browser. Navigate to `#/timers/flow`. In the Flow setup view, open the "Ambient sound" dropdown — confirm 8 options visible in order: Off / Brown / Pink / White / Green / Blue / Violet / Gray. (See Risks: order ambiguity — implementer's final pick must be documented in this PR's commit message.)
3. Pick "Green" — start a Flow block — confirm green-noise plays (mid-band, "natural"/"forest" feel; qualitatively distinct from pink and brown).
4. Pause Flow — confirm green-noise stops mid-loop cleanly (no click / pop on stop).
5. Resume Flow — confirm green-noise restarts at the same profile.
6. Reset Flow — confirm green-noise stops.
7. Repeat steps 3–6 for Blue, Violet, Gray. **Acceptance bar:** each should sound qualitatively distinct from the others and from white/brown/pink. If two colors sound indistinguishable, the implementation has a bug — flag and re-tune amplitude / filter coefficients before PR ship.
8. Navigate to `#/timers/pomodoro`. Open settings panel, pick each new color from the "Ambient sound" dropdown, save settings, start Pomodoro. Confirm noise starts on `phase === 'work'` only (not on `shortBreak` / `longBreak` transitions).
9. Toggle global mute via the speaker icon mid-session — confirm ambient stops. Unmute — confirm ambient resumes with the same profile (the `toggleMute` resume path in `audio.js:97–107` already handles this for white/brown/pink; new profiles inherit the same idempotent path automatically).
10. (Optional, iOS-build-dependent) Run `npm run ios:open`, build to a real device via Xcode, repeat steps 3 and 8 with at least one new color in each mode. Confirms no Capacitor WKWebView regression in Web Audio buffer-source playback. Skip if the iOS build isn't current — the web smoke is the authoritative validator for procedural audio.

## Decisions (orchestrator-stamped after user review, 2026-05-20)

The audit flagged three open questions in the affected-files / risks sections. Resolved as follows before Phase 2 fired:

1. **`sw.js` CACHE_NAME bump target → `'stopwatch-v91-ambient-colors'`** (current is `v90-rhythm-pillar`; PR #86 still open at v90). If PR #86 lands first, pr-shipper auto-bumps to `v92-`.
2. **`<option>` order → append-only.** Existing 3 entries (Brown / Pink / White) keep their current order; the 4 new entries (Green / Blue / Violet / Gray) are appended at the end. Final visible order: Off / Brown / Pink / White / Green / Blue / Violet / Gray. Note: visible UI order intentionally differs from `AMBIENT_PROFILES` array order — the array is the `includes()`-contract, not the render source; the static `<option>` markup IS the render source.
3. **Label format → no " noise" suffix on ANY entry.** Existing 3 entries get their labels stripped from "Brown noise" / "Pink noise" / "White noise" → "Brown" / "Pink" / "White". New 4 entries are "Green" / "Blue" / "Violet" / "Gray". Rationale: the parent label "Ambient sound" already conveys context; trailing " noise" is redundant. This expands the `index.html` diff slightly (the 3 existing options also change text content) but the `value` attributes are unchanged, so persisted profile ids in localStorage continue to resolve correctly.

These decisions apply to Phase 4 (ui-wirer) and Phase 5 (pr-shipper). Phase 2 (engine-implementer) is unaffected — engine work is `js/audio.js`-only.

## Out of scope (explicitly NOT in this PR)
- **Bundled royalty-free MP3 loops** (rain, café, ocean, etc.) — deferred from backlog #3's "option b" / follow-up scope.
- **YouTube IFrame Player API integration** for lo-fi / focus-music streams — deferred from backlog #3's "option c" / follow-up scope; carries ToS risk that needs separate review.
- **User-uploaded ambient audio (BYO file)** — deferred; would need storage strategy + format validation + persistence layer rework.
- **Per-phase ambient profiles** (e.g., one color for focus, a different one for break / recovery) — deferred. Current behavior: Flow stops ambient at focus→recovery transition; Pomodoro stops at work→break transition. No `pomodoro_break_ambient_profile` key.
- **Ambient volume slider in settings drawer** — already shipped in #82. This PR does not touch volume UI.
- **Driving `<option>` markup from `getAmbientProfiles()` JS render** — explicit no per brief. Hard-coded `<option>` entries stay; renderer in `flow-ui.js:159` continues to pre-select the persisted profile from static markup.
- **Schema version bump or new persistence keys** — explicit no. Existing `flow_ambient_profile` / `pomodoro_ambient_profile` localStorage keys carry new ids transparently.
- **`js/platform.js` extension** — explicit no. Pure Web Audio works on both web + iOS Capacitor WKWebView.

## Sign-off checklist (for the implementer)
- [ ] `AMBIENT_PROFILES` in `js/audio.js` extended to exactly 7 entries: `['white', 'brown', 'pink', 'green', 'blue', 'violet', 'gray']` (order matters for `getAmbientProfiles()` dropdown rendering even though static `<option>` markup is the actual UI).
- [ ] Four new `else if` branches added to `_generateAmbientBuffer(c, profile)` — one each for green / blue / violet / gray. Each branch is self-contained (does NOT call into other branches or refactor the existing white/brown/pink branches).
- [ ] `_stopAmbientNode`, `startAmbient`, `stopAmbient`, `getAmbientProfile`, `setAmbientVolume`, `getAmbientProfiles` are byte-equivalent to pre-PR (additive-only). **Do NOT refactor the play path.**
- [ ] Four new `<option>` entries added to BOTH `<select id="flow-ambient-profile">` (line 372–377) AND `<select id="pomo-ambient-profile">` (line 542–548). Same option order in both blocks.
- [ ] `sw.js` `CACHE_NAME` bumped in same commit as the JS + HTML changes. **Current value is `'stopwatch-v90-rhythm-pillar'`** — bump to `'stopwatch-v91-ambient-colors'` (or `'stopwatch-v92-ambient-colors'` if a v91-named PR landed in between). pr-shipper validates the exact target.
- [ ] No `npm` package additions. No `js/platform.js` touch. No `js/schema.js` touch. No sync-store touch.
- [ ] No re-implementation of `escapeHtml` / `Utils.formatMs` / `Platform.*` (none should be needed — pure audio code).
- [ ] Smoke plan executed end-to-end: all 8 options render; each of the 4 new colors plays distinct sound; pause/resume/reset/mute behave per existing 3-color contract; Pomodoro work-only gating still holds.
- [ ] (If optional test ships) `tests/index.html` updated to load `js/audio.js` + `audio.test.js`; assertion passes; no AudioContext instantiation during test load.
