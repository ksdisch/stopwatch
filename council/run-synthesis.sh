#!/usr/bin/env bash
# Council run wrapper (Tier-2 local runtime). Captures stdout+stderr to a
# dated log file. Exits non-zero with a literal "COUNCIL FAILED" line on
# failure, and fires a best-effort Slack/Twilio alert so a silent failure
# never goes unnoticed (silent failure is the #1 risk — see ADR-0001).
#
# Ported from job-search-mas/run_nightly.sh, adapted for the Node + firebase-admin
# council runtime. Scheduled via launchd at 06:00 local time. The committed plist
# is deploy/com.ksdisch.life-os.synthesis.plist — see
# docs/runbooks/council-launchd.md.
#
# Phase 1 runs synthesize.mjs, which READS the five pillar synthesis records and
# rolls them up into the 'home' Balance record via the Admin SDK. The run mode is
# controlled by SYNTH_MODE (daily = passive nightly glance, no nudges; weekly =
# Sunday-evening recap with 1-3 cross-pillar moves). SYNTH_MODE defaults to
# "weekly" inside synthesize.mjs when unset. Each launchd plist sets SYNTH_MODE in
# its EnvironmentVariables (the daily glance plist and the weekly recap plist);
# this wrapper forwards whatever the scheduler / shell exports.

set -uo pipefail

# Resolve the repo root from this script's own path (CWD-independent), so the
# wrapper works identically under launchd, an interactive shell, or a cron line.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "${SCRIPT_DIR}/.." && pwd)"

LOG_DIR="${REPO}/council/logs/nightly"
mkdir -p "${LOG_DIR}"

DATE_TAG="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
LOG_FILE="${LOG_DIR}/${DATE_TAG}.log"

# Augment PATH for the scheduler's minimal environment. launchd (like cron)
# runs with a PATH that excludes Homebrew (/opt/homebrew/bin) and a user-local
# bin (~/.local/bin), so `node` is not found. Without this the run dies at the
# `command -v node` preflight below instead of producing a useful log.
export PATH="${HOME}/.local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:${PATH}"

# Pin node resolution to the nvm-managed install (survives Homebrew changes —
# without this launchd finds Homebrew node first, and removing Homebrew node
# would kill the preflight below). Resolve the newest installed nvm version
# dynamically and put its bin dir FIRST; the Homebrew paths above remain the
# fallback when no nvm install exists.
NVM_NODE_BIN="$(ls -d "${HOME}/.nvm/versions/node"/*/bin 2>/dev/null | sort -V | tail -n 1)"
if [[ -n "${NVM_NODE_BIN}" && -x "${NVM_NODE_BIN}/node" ]]; then
  export PATH="${NVM_NODE_BIN}:${PATH}"
fi

# ── Push-alert creds — loaded BEFORE the .env.secrets perms guard ─────────────
# notify_failure()'s Slack/Twilio creds have historically lived INSIDE
# council/.env.secrets. But the guard below refuses to source that file unless it
# is 0600 — so on the very failure it most needs to report (a bad-perms secrets
# file: the 2026-06-14..07-08 silent outage) the alert channel was itself
# unreachable. Break that chicken-and-egg by loading the alert creds from a
# SEPARATE file, sourced here (before the guard) and best-effort — never a hard
# perms-abort, which would only push the silent failure up one level. Override
# the path with ALERTS_ENV; format in council/alerts.env.example.
ALERTS_ENV="${ALERTS_ENV:-${HOME}/.config/life-os/alerts.env}"
if [[ -f "${ALERTS_ENV}" ]]; then
  # shellcheck disable=SC1090
  source "${ALERTS_ENV}" || true
fi

# ── notify_failure(msg) ──────────────────────────────────────────────────────
# Best-effort push alert on failure. Kept in BASH (not Node) on purpose: it must
# fire even when node / firebase-admin is the thing that broke — and defined HERE,
# above the perms guard, so an early abort can still reach you. Every curl is
# best-effort — a notification failure must never mask the original exit code.
notify_failure() {
  local msg="$1"

  # Slack incoming webhook — POST {"text": "..."} to the webhook URL.
  if [[ -n "${SLACK_WEBHOOK_URL:-}" ]]; then
    curl -fsS -X POST \
      -H 'Content-type: application/json' \
      --data "{\"text\": \"${msg}\"}" \
      "${SLACK_WEBHOOK_URL}" >/dev/null 2>&1 || true
  fi

  # Twilio SMS — all four TWILIO_* must be set, else skip. POST to the Messages
  # API (form-encoded), best-effort. Sibling of the Slack path.
  if [[ -n "${TWILIO_ACCOUNT_SID:-}" \
     && -n "${TWILIO_AUTH_TOKEN:-}" \
     && -n "${TWILIO_FROM_NUMBER:-}" \
     && -n "${TWILIO_TO_NUMBER:-}" ]]; then
    curl -fsS -X POST \
      "https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json" \
      --data-urlencode "From=${TWILIO_FROM_NUMBER}" \
      --data-urlencode "To=${TWILIO_TO_NUMBER}" \
      --data-urlencode "Body=${msg}" \
      -u "${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}" >/dev/null 2>&1 || true
  fi
}

# Source secret env vars (GOOGLE_APPLICATION_CREDENTIALS, TEMPO_UID). File is
# gitignored — see council/.env.secrets.example. (Slack/Twilio alert creds are
# loaded from ALERTS_ENV above; keeping a copy here too is harmless — the normal
# path re-sources and either value works.)
if [[ -f "${REPO}/council/.env.secrets" ]]; then
  # M6: the secrets file holds TEMPO_UID + the SA-key path (and may still hold a
  # Slack webhook / Twilio token). Refuse to source it unless it is locked to
  # owner-only (0600) — a world-readable secrets file on a multi-account machine
  # leaks the Firebase uid + credential path. (chmod 600 the file once on the
  # host; this preflight keeps it that way.) `stat` differs between GNU
  # (Linux, -c %a) and BSD (macOS, -f %A) — try both.
  SECRETS_PERMS="$(stat -c '%a' "${REPO}/council/.env.secrets" 2>/dev/null \
               || stat -f '%A' "${REPO}/council/.env.secrets" 2>/dev/null \
               || echo '')"
  if [[ "${SECRETS_PERMS}" != "600" ]]; then
    perms_msg="COUNCIL FAILED: council/.env.secrets has perms ${SECRETS_PERMS:-<unknown>}, expected 600 — run: chmod 600 council/.env.secrets"
    echo "${perms_msg}" >&2
    # This guard runs BEFORE the dated-log header (written below on the normal
    # path), so record the dated per-run log here too — a perms failure must be
    # visible where run outcomes are actually checked (during the
    # 2026-06-14..07-08 silent outage only launchd's unwatched err.log caught it).
    # The push alert CAN fire now: notify_failure and its Slack/Twilio creds are
    # loaded from ALERTS_ENV above, so they no longer depend on this unreadable file.
    echo "=== life-os council run ${DATE_TAG} ===" >> "${LOG_FILE}"
    echo "${perms_msg}" >> "${LOG_FILE}"
    notify_failure "${perms_msg}"
    exit 1
  fi
  # shellcheck disable=SC1091
  source "${REPO}/council/.env.secrets"
fi

# ── Preflight ────────────────────────────────────────────────────────────────
# Fail fast with a literal "COUNCIL FAILED: ..." to stderr AND the dated log,
# fire the alert, then exit 1. Surfacing the specific cause here beats letting
# node boot and die at the same lookup with a murkier message.
echo "=== life-os council run ${DATE_TAG} ===" >> "${LOG_FILE}"

preflight_fail() {
  local msg="COUNCIL FAILED: $1"
  echo "${msg}" >&2
  echo "${msg}" >> "${LOG_FILE}"
  notify_failure "${msg}"
  exit 1
}

# node must be on PATH (the council runtime is Node + firebase-admin).
if ! command -v node >/dev/null 2>&1; then
  preflight_fail "node not found on PATH (PATH=${PATH})"
fi

# TEMPO_UID must be set (synthesize.mjs writes under users/{TEMPO_UID}/...).
if [[ -z "${TEMPO_UID:-}" ]]; then
  preflight_fail "TEMPO_UID not set (provide it in council/.env.secrets)"
fi

# The service-account key must be configured AND exist on disk.
if [[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" || ! -f "${GOOGLE_APPLICATION_CREDENTIALS}" ]]; then
  preflight_fail "GOOGLE_APPLICATION_CREDENTIALS unset or file missing (${GOOGLE_APPLICATION_CREDENTIALS:-<unset>})"
fi

# ── Run ──────────────────────────────────────────────────────────────────────
# Forward SYNTH_MODE to the node entry (launchd sets it per-plist in
# EnvironmentVariables; an interactive shell can `SYNTH_MODE=daily ./run-synthesis.sh`).
# Unset → synthesize.mjs defaults to "weekly". Exported so node inherits it.
export SYNTH_MODE="${SYNTH_MODE:-}"
if SYNTH_MODE="${SYNTH_MODE}" node "${REPO}/council/synthesize.mjs" >>"${LOG_FILE}" 2>&1; then
  echo "✔ council run succeeded — see ${LOG_FILE}" >&2
  exit 0
else
  rc=$?
  msg="COUNCIL FAILED (rc=${rc}) — see ${LOG_FILE}"
  echo "${msg}" >&2
  echo "COUNCIL FAILED (rc=${rc}) at ${DATE_TAG}" >> "${LOG_FILE}"
  notify_failure "${msg}"
  exit "${rc}"
fi
