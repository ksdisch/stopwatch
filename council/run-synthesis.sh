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

# Source secret env vars (GOOGLE_APPLICATION_CREDENTIALS, TEMPO_UID,
# SLACK_WEBHOOK_URL, optionally TWILIO_*). File is gitignored — see
# council/.env.secrets.example for the format.
if [[ -f "${REPO}/council/.env.secrets" ]]; then
  # shellcheck disable=SC1091
  source "${REPO}/council/.env.secrets"
fi

# ── notify_failure(msg) ──────────────────────────────────────────────────────
# Best-effort push alert on failure. Kept in BASH (not Node) on purpose: it must
# fire even when node / firebase-admin is the thing that broke. Every curl is
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
