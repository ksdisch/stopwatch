# Session wrap — Tempo Life-OS Phase 0 (foundations)

**Date:** 2026-06-08
**Branch / PR:** `feat/lifeos-phase-0-foundations` → PR (base `main`)
**Scope:** Phase 0 of the Tempo Life-OS build (plan: `docs/lifeos/` — `brief.md` → `architecture.md` → `roadmap.md` → `decisions/0001,0003,0005`). Evolve Tempo into the `life-os` trunk *in place*: define the Firestore contracts, port the job-search-mas launchd council harness, ship a read-only synthesis feed. **Gate: a scheduled launchd job writes a synthesis record to Firestore + the PWA reads it back; failure alert fires on a forced error.**

---

## 1. What we did

Authored via a 4-agent parallel workflow (disjoint file sets, one frozen synthesis-record contract embedded in every brief), then integrated + verified + ran the live gate by hand.

- **Firestore contracts** (`docs/contracts/`): `synthesis-record.md` + `synthesis-record.schema.json` (the up-the-chain record at `users/{uid}/synthesis/{nodeId}`, nodeId = node path with `/`→`__`; fields `contractVersion/node/producer/producedAt/window/state{band,score}/headline/signals[≤5]/nudges[]/provenance{sources,coverage}/confidence`), and `pillar-feed.md` (generalizes `recovery_state` into the reusable inbound-mart contract). Field names FROZEN here per ADR-0005.
- **Security rules** (`firestore.rules`): added a `match /users/{userId}/synthesis/{docId}` block (`read: isOwner; write: if false`) **and** extended the catch-all exclusion to `collection != 'recovery_state' && collection != 'synthesis'` — the exclusion (not block order) is what makes it read-only, since Firestore evaluates rules cumulatively. Rules-unit tests added (`tests/rules/firestore-rules.test.mjs`); also corrected that file's stale "block ORDER is load-bearing" header comment.
- **Council runtime** (`council/`, Node + firebase-admin, own package.json): `synthesize.mjs` (Phase-0 writes a DUMMY `home` record via the Admin SDK), `lib/synthesis-record.mjs` (`buildSynthesisRecord`/`validateSynthesisRecord`, 11/11 unit tests). **Harness ported from job-search-mas:** `run-synthesis.sh` (PATH preflight, `COUNCIL FAILED` marker, bash `notify_failure` Slack+Twilio so it fires even if node breaks), `deploy/com.ksdisch.life-os.synthesis.plist` (launchd, ~06:00 local), `.env.secrets.example`, `README.md`, `docs/runbooks/council-launchd.md`.
- **PWA read-side** (`js/synthesis-feed.js`): read-only consumer mirroring `recovery-feed.js` (getDoc → per-node localStorage cache → `getRecord`; 3-condition gate; auth-change wiring; no write/merge). Wired all 4 touchpoints (script tag, CLAUDE.md file-map + load-order, `sw.js` ASSETS + `CACHE_NAME` → `stopwatch-v122-lifeos-phase0-synthesis`, `tests/synthesis-feed.test.js` 20/20). Temporary `#synthesis-debug` readout in the settings drawer proves the read path on a phone (REMOVE in Phase 1).
- **Trunk identity**: relocated the approved plan into `docs/lifeos/` (literal repo rename deferred per Kyle, ADR-0003). CLAUDE.md updated (Phase 12 line, file-map, doc-index, tech-debt).
- **Fixed a real gap**: Agent C's `.gitignore` edit hadn't landed — `council/{node_modules,.env.secrets,logs}` were trackable; now ignored (template + code stay tracked).

## 2. Gate verification (all green)

- **Write**: installed + `launchctl kickstart`ed `com.ksdisch.life-os.synthesis` → exit 0; log `OK: wrote … users/E8ZLWdByGhMvkXvj5G9AYOa6GoQ2/synthesis/home`.
- **In Firestore**: firebase MCP `firestore_get_document` confirmed the doc with every frozen-contract field correctly typed.
- **Read-back**: minted a custom token (Admin SDK) → signed in as the client via the Firebase **web** SDK → `getDoc` (rules-enforced) returned the doc — the identical call `SynthesisFeed` makes. Then served the branch, seeded the real record, loaded the app, and the `#synthesis-debug` readout rendered the headline + `producedAt` (Playwright `mcp__playwright`, host, `127.0.0.1:8770`).
- **Failure alert**: ran the wrapper with the key absent → `COUNCIL FAILED: GOOGLE_APPLICATION_CREDENTIALS … missing` → stderr + dated log + `notify_failure` invoked (exit 1). Live Slack POST skipped per Kyle's choice.
- **Tests**: council validator 11/11; browser `SynthesisFeed` 20/20; hook checks (load-order/assets/sw-bump) green; rules syntax validated via MCP. Only the 2 documented headless-only sync-engine `_runMergeCycleForStore` flakes remain (pass foreground).

## 3. Live state / honest caveats

- **The council is scheduled** — the launchd job is loaded and fires daily ~06:00, re-writing the dummy `home` record until Phase 1. (`launchctl bootout gui/$(id -u)/com.ksdisch.life-os.synthesis` to silence it meanwhile.)
- **Service-account key**: `~/.config/life-os/tempo-sync-adminsdk.json` (gitignored, NOT in repo). `gcloud` is not installed → key is console-minted only. Council secrets in `council/.env.secrets` (gitignored).
- **Node duality** (tech-debt): council runs under Homebrew node v25 (launchd PATH), not nvm v22 (which installed firebase-admin). Works; pin node in the wrapper later.
- **Rules emulator test** (`npm run test:rules`) needs a JRE (not installed locally) — CI-gated.
- **Literal "on the phone"** needs a deploy (reader is branch-only) — proven via the authenticated client read + the desktop DOM render; phone view is a one-tap confirm post-ship.

## 4. Suggested next steps

- Merge the Phase-0 PR (push/merge gated on Kyle), deploy, confirm `#synthesis-debug` on the phone.
- **Phase 1** (next gate): Home hub — bubble map (3 lenses) + synthesis cards + "this week's 3 moves"; the Home Synthesizer archetype + Balance engine (`Importance × Neglect`) reading pillar records; daily-glance + weekly-recap jobs (replace `synthesize.mjs`'s dummy body). Seed mock pillar records. See `docs/lifeos/roadmap.md` Phase 1.
- Pin node in `council/run-synthesis.sh`; remove the `#synthesis-debug` scaffold when Home ships.

## 5. Commits

```
feat(lifeos): Phase 0 foundations — Firestore contracts + local council/launchd harness + read-only synthesis feed
(branch feat/lifeos-phase-0-foundations; base main; gate verified — launchd write + client read-back + forced-error alert)
```
