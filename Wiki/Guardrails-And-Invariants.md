# Guardrails And Invariants

## Purpose
This page collects the hard rules that are enforced by CI, pre-commit hooks, or code invariants — and explains *why* each one exists. The rules are scattered across `CLAUDE.md` (conventions, definition of done, backlog notes), `docs/reference/glossary.md` (F-invariants), `docs/adr/0004` (merge rules), and code (`js/schema.js`, `sw.js`). No single file answers "what will I silently break if I skip this?" This page is the pre-flight checklist for any code change.

## Key understanding

### Service-worker cache bump — the most common footgun

**Fact** (`CLAUDE.md` § Operations, `docs/runbooks/deploy-and-cache-bump.md`): The service worker is cache-first. Any change to a cached web file (`index.html`, `css/styles.css`, `css/tempo-shell.css`, `manifest.json`, or any `js/*.js`) **must bump `CACHE_NAME` in `sw.js` in the same PR** or users keep seeing stale content until the old SW expires.

**Fact** (`CLAUDE.md` § CI + branch protection): The `sw-cache-bump` CI job enforces this as a hard merge gate. The pre-commit guard hook also checks it before any `git commit`. Skipping the bump closes no harm for the developer but breaks the live app for every user with a cached version.

**Fact** (`docs/reference/glossary.md` § CACHE_NAME slug): The cache key is `stopwatch-vNNN-<short-slug>`. The number is the de-facto release ID (the repo has zero git tags). The slug should "name the fix" — it is the only release marker.

### The 4 wire-points for any new JS module

**Fact** (`CLAUDE.md` § Definition of done, item 3): A new `js/` module requires all four, or CI will block:
1. `index.html` `<script>` slot (in the correct load-order position)
2. `CLAUDE.md` file-map entry + script-load-order chain
3. `sw.js` ASSETS list entry
4. A registered test stub (via `/new-engine-module` or `/add-panel`)

**Fact** (`CLAUDE.md` § Key Design Decisions): The `<script>` order in `index.html` IS the dependency graph. A module may only call globals defined by a file that loaded earlier. The pre-commit guard checks for `ASSETS`/`<script>` mismatches and load-order-chain drift.

### Synced-store writes must go through `Schema.stamp`

**Fact** (`js/schema.js`, `CLAUDE.md` § Conventions — Reuse over re-implementation): ALL writes to synced stores must stamp `deviceId` + `updatedAt` + `schemaVersion` via `js/schema.js`. Direct writes bypass the F19a forward-compat guard and the LWW/dedup key infrastructure. There is no runtime enforcement — violations are silent until a multi-device merge produces wrong results.

**Fact** (`docs/reference/data-dictionary.md` §4): `stamp()` refuses to downgrade a future record (`schemaVersion > SCHEMA_VERSION`). A new synced field added without a `SCHEMA_VERSION` bump is safe only if it is **additive-nullable** (absent ⇒ feature off or legacy record) — the six existing additive-nullable fields are the reference pattern.

### F19a refuse-writeback — mandatory in every new merge module

**Fact** (`docs/adr/0004-per-store-merge-strategy.md` § Consequences — Negative): The F19a guard must appear at three layers in every merge module:
1. Cloud-side pre-filter: skip remote records where `Schema.isFutureRecord(data)` is true before they enter merge state
2. CAS `refuseWriteback` inside `runTransaction` (web only — native permanently skipped per ADR 0009)
3. Local-side filter for records that may have leaked in via JSON import

**Fact** (`docs/adr/0004` § Consequences): `Schema.isFutureRecord` must be used verbatim, not a hand-rolled comparison — this is called out as a named risk. Forgetting the guard in a new store silently reopens the downlevel-corruption hole.

### Migration paths are not dead code

**Fact** (`CLAUDE.md` § Never touch / handle with care): Migration paths in `js/history.js`, `js/meds.js`, `js/distractions.js`, `js/bfrb-events.js` keep old devices upgradable. They must never be removed. An old device that hasn't opened the app in months still needs to migrate on first boot.

### Tests are the spec — never edit a test to make a failure pass

**Fact** (`CLAUDE.md` § Conventions — Never touch / handle with care): If a test fails, fix the code or report the failure. Editing the test to pass it is prohibited. The `engine-tests` CI job treats `FAIL (n)` as a hard merge gate; the canonical pass count is the `PASS (n)` output of `npm test`, not any number written in docs.

**Fact** (`CLAUDE.md` § Test commands): 1–2 sync-engine steady-state tests fail headless-only. A visible browser tab is the source of truth for those specific cases — `npm run test:ui` is the adjudication path.

### The `doseLog` single-commit rule

**Fact** (`CLAUDE.md` History — Tempo Coach + BFRB era, PR #126 body): BFRB capture must commit in exactly one `log()` call because the merge resolves collisions with keep-cloud. A log-then-patch sequence would silently drop fields from the patch on a cloud collision. This extends to any store where the merge is union-dedup: multi-step writes that aren't atomic produce orphaned partial records.

### Credentials and production writes — never touch

**Fact** (`CLAUDE.md` § Never touch / handle with care):
- `js/sync-firebase-config.js` is a **committed public** web config by design; `firestore.rules` enforces access. Do not rotate or hide it.
- `service-account.json`, `*-firebase-adminsdk-*.json`, `council/.env.secrets` are gitignored credentials. Never commit, read, or print.
- `council/synthesize.mjs`, `seed-pillars.mjs`, `run-synthesis.sh` write **production Firestore**. Never run as a test — use `npm --prefix council test` instead.

### Branch protection — all 7 CI checks + PRs only

**Fact** (Decisions.md D3, `CLAUDE.md` § CI + branch protection): Since 2026-07-19, `main` is protected: PRs only, all 7 CI jobs required (`engine-tests`, `ui-tests`, `asset-integrity`, `sw-cache-bump`, `markdown-links`, `mermaid-lint`, `firestore-rules`), `enforce_admins` on. Direct pushes are rejected. The flow-vibrate incident (a direct-push direct-revert same day, 2026-05-17) is the motivating case.

**Fact** (`CLAUDE.md` § Git Workflow): repo auto-merge is enabled — land PRs with `gh pr merge --auto --squash`.

### Platform calls — use the seam, never the browser API directly

**Fact** (`CLAUDE.md` § Conventions — Reuse over re-implementation, `docs/ARCHITECTURE.md` § Platform seam):
- Haptics: `Platform.haptic(pattern)` — never `navigator.vibrate` directly (iOS no-ops it)
- Notifications: `Platform.notify(title, opts)` / `BgNotify.schedule(...)` — never `new Notification(...)` directly
- All 23 haptic call sites and 6 notification call sites in the codebase route through `js/platform.js` (ADR 0007)

### Persisted schema changes require data-dictionary updates

**Fact** (`CLAUDE.md` § Definition of done, item 4): Any change to a persisted key or shape must update `docs/reference/data-dictionary.md`. This is a CI-adjacent convention (the markdown-links job will catch broken anchors but not missing rows). The data dictionary was last verified by grep on 2026-05-30; two keys were missing from `CLAUDE.md` at that time, discovered at dictionary-authoring time.

## Sources
- `CLAUDE.md` § Conventions, § Definition of done, § Never touch / handle with care, § CI + branch protection, § Operations — the primary source for most rules
- [`docs/reference/glossary.md`](../docs/reference/glossary.md) § F-invariants — the authoritative F-number legend
- [`docs/adr/0004-per-store-merge-strategy.md`](../docs/adr/0004-per-store-merge-strategy.md) — merge correctness rules and their rationale (especially the Consequences section)
- [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) § Platform seam, § Module layering — the platform-seam and load-order constraints
- [`docs/reference/data-dictionary.md`](../docs/reference/data-dictionary.md) §4 — sync envelope and additive-nullable field pattern
- `js/schema.js` — `Schema.stamp`, `isFutureRecord`, `SCHEMA_VERSION` — code is ground truth for the F19a guard

## Uncertainties & contradictions
- **Unresolved:** the pre-commit guard hook checks three things (`check-sw-bump`, `check-asset-integrity`, `check-load-order`), but CI also runs these as separate jobs. If the hook is bypassed (e.g. `--no-verify`), CI is the last gate — there is no indication in the docs that `--no-verify` is ever authorized.
- **Unresolved:** `docs/reference/data-dictionary.md` was verified by grep on 2026-05-30; Phase 5 additions (mood_events, finances) were added after that date. The dictionary has been updated in the wiki but the "verified by grep" provenance note at the top of the file is stale and should be re-dated after the next full grep sweep.
- **Inference**: the "1–2 sync-engine steady-state flakes headless-only" note in `CLAUDE.md` suggests those tests have been marked as known flakes rather than fixed — a future session could investigate whether the root cause is isolatable.

## Related pages
- [Local-First-Data-Model](Local-First-Data-Model.md) — the F19a guard and per-store merge rules in context
- [History](History.md) — the H4 audit (2026-06-14) that found sync never wrote remote arrivals to local for 5 of 7 stores, and the direct-push incident (2026-05-17) that motivated branch protection

## Relevance to current work
This page is the pre-flight checklist for any PR. The most commonly missed rules are the cache bump (enforced by CI but easy to forget locally) and the 4 wire-points for new modules (the pre-commit guard catches mismatches, but only if the hook runs). For any new synced store — likely when P4, P6, or P7 builds begin — the F19a guard at three layers and the `Schema.stamp` requirement are mandatory starting points.

_Last reviewed: 2026-07-26_
