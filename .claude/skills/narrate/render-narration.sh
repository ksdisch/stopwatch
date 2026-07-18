#!/usr/bin/env bash
# render-narration.sh — single-voice text → MP3 via local Kokoro TTS.
#
# Renders a plain-text script (already written for the EAR — see SKILL.md) to a
# single MP3 using the Kokoro OpenAI-compatible /v1/audio/speech endpoint that
# the voicemode plugin runs locally. No cloud, no quota, repeatable.
#
#   render-narration.sh <input.txt> <output.mp3> [voice]
#
# Env (all optional):
#   KOKORO_URL    full speech endpoint (default http://127.0.0.1:8880/v1/audio/speech)
#   KOKORO_MODEL  model name           (default kokoro)
#   NARRATE_VOICE default voice if arg 3 omitted (default am_adam)
#   NARRATE_SPEED playback speed        (default 1.0)
#
# Requires: curl, jq. Ensure Kokoro is running first — the caller checks via the
# voicemode `service(kokoro, status)` tool and starts it if stopped.
set -euo pipefail

IN="${1:?usage: render-narration.sh <input.txt> <output.mp3> [voice]}"
OUT="${2:?usage: render-narration.sh <input.txt> <output.mp3> [voice]}"
VOICE="${3:-${NARRATE_VOICE:-am_adam}}"

KOKORO_URL="${KOKORO_URL:-http://127.0.0.1:8880/v1/audio/speech}"
KOKORO_MODEL="${KOKORO_MODEL:-kokoro}"
NARRATE_SPEED="${NARRATE_SPEED:-1.0}"

command -v curl >/dev/null 2>&1 || { echo "error: curl not found" >&2; exit 3; }
command -v jq   >/dev/null 2>&1 || { echo "error: jq not found"   >&2; exit 3; }
[ -s "$IN" ] || { echo "error: input script '$IN' is missing or empty" >&2; exit 2; }

mkdir -p "$(dirname "$OUT")"

# Build the JSON body with jq so quotes/newlines/Unicode in the script are
# encoded safely (never hand-interpolate the text into JSON).
payload="$(jq -n \
  --rawfile input "$IN" \
  --arg model "$KOKORO_MODEL" \
  --arg voice "$VOICE" \
  --argjson speed "$NARRATE_SPEED" \
  '{model:$model, voice:$voice, input:$input, response_format:"mp3", speed:$speed}')"

http_code="$(curl -sS -o "$OUT" -w '%{http_code}' \
  -X POST "$KOKORO_URL" \
  -H 'Content-Type: application/json' \
  -d "$payload" 2>/tmp/render-narration.curlerr || true)"

if [ "$http_code" != "200" ] || [ ! -s "$OUT" ]; then
  echo "error: Kokoro render failed (HTTP ${http_code:-none}) against $KOKORO_URL" >&2
  [ -s /tmp/render-narration.curlerr ] && sed 's/^/  curl: /' /tmp/render-narration.curlerr >&2
  echo "  Is Kokoro up? Check the voicemode service(kokoro, status) tool, or override KOKORO_URL." >&2
  rm -f "$OUT"
  exit 1
fi

bytes="$(wc -c < "$OUT" | tr -d ' ')"
echo "rendered $OUT (${bytes} bytes, voice=$VOICE)"
