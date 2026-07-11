# Runbook: the local council launchd jobs (daily glance + weekly recap)

- **Status:** Active runbook, written 2026-06-08 (Phase 1)
- **Trigger:** Setting up / re-pointing the Tier-2 council on Kyle's Mac, or
  debugging why the `home` synthesis record went stale on the phone.
- **Cadence:** Manual setup (once); the jobs then fire on their launchd schedules.

## What the council is

The Tier-2 council is a local-first Node + `firebase-admin` runtime on Kyle's
Mac (`council/`). It reads the five domain-pillar synthesis records from
Firestore, rolls them up via the pure Home Synthesizer into the `home` Balance
record, and writes it back to `users/{TEMPO_UID}/synthesis/home` with the Admin
SDK (which bypasses `firestore.rules` — same trust model as `recovery_state`).
The PWA reads `home` (+ the pillar records) read-only via `js/synthesis-feed.js`.

The whole thing is tethered to the Mac: **the council only fires while the Mac is
on**, and a launchd / CLI-auth drift fails *silently*. `producedAt` on the record
is the device-side staleness tell, and the wrapper's Slack/Twilio alert
(`run-synthesis.sh` → `notify_failure`) is the producer-side one. Both matter.
See **§ Failure alerts** below for how the alert is wired (and the outage that
hardened it).

## The daily-glance vs weekly-recap split (Phase 1)

There are now **two** scheduled jobs, both running the same
`council/run-synthesis.sh` wrapper and the same `council/synthesize.mjs` entry —
they differ only by the `SYNTH_MODE` env var each plist sets:

| Job (Label) | Plist | Schedule | `SYNTH_MODE` | `producer` | Nudges? |
|---|---|---|---|---|---|
| Daily glance | `deploy/com.ksdisch.life-os.synthesis.plist` | 06:00 local, every day | `daily` | `council/nightly-glance` | **No** — passive read |
| Weekly recap | `deploy/com.ksdisch.life-os.synthesis.weekly.plist` | 18:00 local, **Sunday** (Weekday 0) | `weekly` | `council/weekly-recap` | **Yes** — top 1-3 cross-pillar moves |

- **`SYNTH_MODE`** is read by `synthesize.mjs` (`process.env.SYNTH_MODE`, also
  overridable with `--mode <daily|weekly>` on argv). **It defaults to `weekly`**
  when unset. Each plist pins its mode explicitly in `EnvironmentVariables`, and
  `run-synthesis.sh` forwards it to node. So:
  - `daily` → the **passive nightly glance**: rolls up the pillars, writes
    `home` with the current Balance band/score, but emits **no** nudges (a glance
    shouldn't nag).
  - `weekly` → the **Sunday recap**: same roll-up plus the top 1-3
    priority-ranked cross-pillar moves (`home.nudges`), drawn from the
    top-priority pillars' own nudges or a synthesized "Tend `<Pillar>`" move.
- Both jobs write the same document (`synthesis/home`); the **latest run wins**.
  The Sunday recap is the one that puts moves on the phone for the week; the
  nightly glance keeps the band/score fresh in between (and clears the prior
  week's stale nudges by overwriting with `[]`).

### Manual / ad-hoc runs

```bash
# from the repo root, with council/.env.secrets providing TEMPO_UID +
# GOOGLE_APPLICATION_CREDENTIALS:
SYNTH_MODE=daily  ./council/run-synthesis.sh    # one-off nightly glance
SYNTH_MODE=weekly ./council/run-synthesis.sh    # one-off weekly recap
# unset SYNTH_MODE → synthesize.mjs defaults to weekly.
```

## One-time: seed the pillar records

Until the real Area/Hub pillar synthesizers exist (Phase 2+), the five pillar
records (`synthesis/{life_building,physicals,chickens,relationships,growth}`)
don't exist yet, so the home roll-up would have nothing to read. Run the seed
**once** at the Phase-1 gate to write clearly-synthetic pillar records:

```bash
# from the repo root, with the same credential env the wrapper sources:
source council/.env.secrets      # exports TEMPO_UID + GOOGLE_APPLICATION_CREDENTIALS
node council/seed-pillars.mjs
```

`seed-pillars.mjs`:
- writes 5 records under `users/{TEMPO_UID}/synthesis/` with
  `producer: "council/seed"` and `provenance.sources: ["seed"]` (unmistakably
  synthetic), each validated against the frozen contract before the write;
- stamps an **additive** `balance: { importance, neglect, priority }` snapshot on
  each record (computed via `council/lib/balance.mjs` + `council/config/balance.json`)
  so the PWA bubble-map lenses read it directly instead of re-deriving the engine;
- is **idempotent** — `set()` by nodeId overwrites in place, so re-running just
  refreshes the seed values.

It writes to **production Firestore** and needs the service-account credential,
so it is never run from CI or tests. After seeding, run a weekly synthesis once
to populate `home`:

```bash
SYNTH_MODE=weekly ./council/run-synthesis.sh
```

## Installing / re-pointing the launchd jobs

```bash
# launchd will NOT create the log dirs — make them first or the job won't launch.
mkdir -p council/logs/launchd council/logs/nightly

# Symlink (or copy) each plist into ~/Library/LaunchAgents, then load it.
cp deploy/com.ksdisch.life-os.synthesis.plist        ~/Library/LaunchAgents/
cp deploy/com.ksdisch.life-os.synthesis.weekly.plist ~/Library/LaunchAgents/

launchctl unload ~/Library/LaunchAgents/com.ksdisch.life-os.synthesis.plist        2>/dev/null
launchctl load   ~/Library/LaunchAgents/com.ksdisch.life-os.synthesis.plist
launchctl unload ~/Library/LaunchAgents/com.ksdisch.life-os.synthesis.weekly.plist 2>/dev/null
launchctl load   ~/Library/LaunchAgents/com.ksdisch.life-os.synthesis.weekly.plist

# Verify both are registered:
launchctl list | grep life-os

# Fire one immediately to test (bypasses the calendar trigger):
launchctl start com.ksdisch.life-os.synthesis.weekly
```

The daily plist writes wrapper stdout/stderr to
`council/logs/launchd/{out,err}.log`; the weekly plist writes to
`council/logs/launchd/weekly-{out,err}.log`. Both jobs' own per-run output goes
to `council/logs/nightly/<UTC-date>.log`.

## Failure alerts (Slack/Twilio) — and why the creds live outside `.env.secrets`

A silent failure is the council's #1 risk (ADR-0001): the jobs fire unattended, so
a dead run is only noticed when the phone's `home` card goes stale days later. The
producer-side guard against that is the wrapper's push alert (`run-synthesis.sh` →
`notify_failure`: a Slack webhook + optional Twilio SMS).

**The alert creds load from a SEPARATE file, sourced *before* the `.env.secrets`
perms guard.** One-time setup per machine:

```bash
mkdir -p ~/.config/life-os
cp council/alerts.env.example ~/.config/life-os/alerts.env
# paste your Slack webhook (and/or the four Twilio values) into it, then:
chmod 600 ~/.config/life-os/alerts.env
```

Default path is `~/.config/life-os/alerts.env` (override with the `ALERTS_ENV` env
var); the format lives in `council/alerts.env.example`. Everything is optional and
best-effort — an empty/missing value just no-ops that channel and the run still
exits with the correct code.

**Why not just keep them in `.env.secrets`?** Because `run-synthesis.sh` refuses to
source `.env.secrets` unless it is `0600` (the M6 guard — that file holds the
SA-key path + `TEMPO_UID`). When the guard trips, the file is never sourced — so if
the alert creds lived *inside* it, the one failure that most needs an alert could
not send one. That is exactly the **2026-06-14 → 2026-07-08 outage**: `.env.secrets`
silently reverted to `0644`, the guard aborted every scheduled run for ~3.5 weeks,
and no alert fired because the Slack webhook was trapped behind the same guard.
Loading the alert creds from `alerts.env` *before* the guard closes that gap; PR
#199 additionally makes the perms-guard abort write the dated
`council/logs/nightly/<UTC-date>.log` so the failure is at least visible there.

> To actually receive alerts you must put a real webhook in `alerts.env`. If you
> never configured Slack/Twilio, that's a second (independent) reason a failure
> would be silent — set it up here.

## Known gotcha — node under launchd (carried from Phase 0)

launchd runs with a minimal PATH that excludes Homebrew. `run-synthesis.sh`
augments PATH with `/opt/homebrew/bin` (+ `~/.local/bin`) so `command -v node`
resolves. That means the council runs under **Homebrew node**, not Kyle's
interactive **nvm** node. `firebase-admin` is portable so both work, but if
Homebrew node is removed the `command -v node` preflight fails under launchd —
consider pinning node in `run-synthesis.sh`. (Open tech-debt item in `CLAUDE.md`.)

## See also

- `council/synthesize.mjs` — the entry (mode resolution, pillar read, home write).
- `council/lib/home-synthesizer.mjs` / `council/lib/balance.mjs` — the pure roll-up + Balance math.
- `council/config/balance.json` — per-pillar importance + target (Phase-1 placeholder targets).
- `docs/contracts/synthesis-record.md` — the frozen record contract.
- `docs/lifeos/decisions/0004-balance-importance-x-neglect.md` — the Balance ADR.
- `docs/runbooks/firestore-rules-publish.md` — the `synthesis` read-only carve-out (separate, gated).
