# Smoke test — Life-OS Phase 3: Chickens (live, post-#145 merge, sw v126)

**Target:** the Phase 3 surface on production (https://ksdisch.github.io/stopwatch/): mood capture → `mood_events` sync, the Chickens hub, the Home bubble map, the meditation-name regression fix, and (optionally) the stress nudge. Step 5 doubles as **the gated one-time council run** — doing it yourself closes the Phase 3 gate.

**Tabs:** ① the live app (`#/home`) · ② Firebase console → Firestore data (project `tempo-sync-6f7b2`).

**Preconditions:** signed in with cloud sync ON (Settings drawer) so mood events sync; your uid in Firestore is `E8ZLWdByGhMvkXvj5G9AYOa6GoQ2`.

## Steps

- [x] **1. Update lands.** Tab ①: hard-reload (the SW update-to-reload should offer the new version — accept it). Expect: **7 tabs** in the bottom bar, with a **Chickens** tab (chicken icon) between Physicals and Rhythm, and a new **smiley icon** in the topbar left of the History icon.
- [x] **2. Mood capture, happy path.** Tap the smiley. Expect a popover under the topbar: *"Right now, this feels…"* + 5 emoji chips (😞 Rough … 😄 Great). Tap **😊 Good**. Expect a light haptic (phone) and the title flips to *"Logged ✓ — add color? (optional)"* with 6 tag chips. Tap **calm**, then **Done**. Popover closes.
- [x] **3. Keyboard path (desktop).** Press **M** → popover opens; click anywhere outside → it closes (the optional fields commit into the same single log — no second entry).
- [x] **4. The log synced.** Tab ②: navigate to `users/E8ZLWdByGhMvkXvj5G9AYOa6GoQ2/mood_events`. Within ~5 min (the 300s steady-state cycle; a reload forces it sooner) expect **one doc** id `<deviceId>-<epochMs>` with `valence: 4`, `tags: ["calm"]`, `context: "global"`, `deviceId/updatedAt/schemaVersion`. One mood tap = one doc (the tag/Done taps must NOT create extras).
- [x] **5. GATED — the one-time council run (closes the gate).** Tab ①: open the **Chickens** tab first — expect the empty state (*"Your headspace, at a glance / No chickens synthesis yet…"*). Then in a terminal:
  `cd ~/Projects/stopwatch/council && set -a && . ./.env.secrets && set +a && SYNTH_MODE=weekly node synthesize.mjs`
  Expect a clean exit; in Tab ② a new doc at `users/…/synthesis/chickens` with `state.score`, `areas` (5 entries), `balance{}`, `producedAt` ≈ now.
- [x] **6. The hub goes real.** Tab ①: reload, open **Chickens**. Expect: hero card with a band chip + score (NOT the old mock 68) + a descriptive headline; **5 Area cards** (Mood / Mindfulness / BFRB regulation / Focus engagement / Stress load). Honest expectations: **Mood shows "Unknown —"** until you have ≥3 mood logs in 14 days; Stress load reads your real physicals record; BFRB/Focus read your real history. Weekly mode adds a "This week's moves" card.
- [x] **7. Home reflects it.** Open **Home**. Expect the Chickens bubble + synthesis card driven by the real record (band color, headline) — no longer the seed.
- [x] **8. Meditation-name regression (the review's major — worth a human check).** Wellness › Mindful → launch a meditation preset (e.g. 5 min) → let it run ~10s → Done. History should show a session **"Meditation 5 min"**. Now run a **plain** timer (any quick preset), finish it, Done. Expect its History entry to NOT carry the Meditation name — if it does, the one-shot name consume regressed.
- [x] **9. Breathing logs.** Wellness › Mindful → start a breathing pattern → complete **at least one full cycle** → Stop. Expect a new History session tagged `mindful` (visible in the session's tag chips). Stopping mid-first-cycle should log nothing.
- [x] **10. Small-screen fit (if you have a narrow phone).** At ≤374px width the 7 tabs go **icon-only** and must not overflow/wrap.
- [x] **11. (Optional, advanced) Stress nudge live-fire.** It only triggers at a BFRB catch when catches are clustered AND last night ran short (<6.5h, or ≥1h under your 14-day mean) AND the support toggle is on — verified on fixtures in CI. If tonight qualifies: log the catch and expect the tappable toast *"Catches are clustering and last night ran short. A 5-minute breather is one tap away."* → **Open** routes to Wellness › Mindful. A single ordinary catch should show **no** escalated toast (suppression).

## TL;DR

- **Really verifying:** the first client-written + council-read store works end-to-end in prod — a mood tap on your phone becomes a Firestore doc, the council turns it (plus your real BFRB/focus/sleep data) into a Chickens score, and the PWA renders it.
- **Pass/fail bar:** steps 4–7 — one stamped `mood_events` doc, a real `synthesis/chickens` record, and the hub + bubble map rendering it. That **is** the Phase 3 gate.
- **Most likely to be broken:** sync timing on step 4 (give it the 5-min cycle or a reload), and step 8 — the sticky-Meditation-name fix is the one place a regression silently corrupts synced history.
- Ratification while you're in there: the popover strings/tag words, the nudge copy, the hub empty-state copy, and the chicken icon are all working drafts — flag anything you want reworded.
