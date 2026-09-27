#!/usr/bin/env bash
# Fetch Smart Turn, the model wake mode asks whether a pause is "finished" or
# "thinking". See EndOfTurn in Sources/KyberKit/SmartTurn.swift.
#
# Upstream (pipecat-ai/smart-turn-v3, BSD 2-Clause) publishes ONNX only. This
# is the compiled Core ML export of its v3.2 fp32 weights at
# aufklarer/Smart-Turn-v3.2-CoreML, pinned to one revision with every file's
# SHA-256, so a changed upload is refused rather than loaded. Checked
# 2026-09-27 against upstream's smart-turn-v3.2-gpu.onnx run through
# upstream's own inference.py: 27 predictions on nine clips, every one within
# 0.01 of upstream's.
#
# About 17 MB, into ~/.bob/smart-turn beside the Whisper model. Optional:
# without it wake mode ends a turn on its 1.1s silence timer, as it always
# did. Safe to run again: a model already there that matches is left alone.
#
#   hud/scripts/fetch-smart-turn.sh                          install or verify
#   SMART_TURN_DIR=/some/dir hud/scripts/fetch-smart-turn.sh  somewhere else
set -euo pipefail

REV="75f069717f500947195fa1945c46ddb472559cff"
BASE="https://huggingface.co/aufklarer/Smart-Turn-v3.2-CoreML/resolve/$REV"
DEST="${SMART_TURN_DIR:-$HOME/.bob/smart-turn}"
MODEL="smart_turn.mlmodelc"

# One file per line: its path inside the model, then its SHA-256.
FILES="
coremldata.bin 9245ac99889c9d738cba6c89da9e851fd16488bf8effbc15a109d06b401c9383
model.mil 41a6d9ac0f7d01d738e56ecdf4435e55f139591541b7cf1a4dba6b9ce2f1c9ef
analytics/coremldata.bin 1646746d0029e78d26be065e62602d4f89e51013ec238b653adf7d7d21057f89
weights/weight.bin b6295316741a0149e1fcab7cdf030e1b9bfb0eef778207accee91a2a9703a39c
"

# Every file present with its pinned hash.
matches() {
  local dir="$1" path sum
  while read -r path sum; do
    [ -n "$path" ] || continue
    [ -f "$dir/$path" ] || return 1
    [ "$(shasum -a 256 "$dir/$path" | cut -d' ' -f1)" = "$sum" ] || return 1
  done <<< "$FILES"
}

if matches "$DEST/$MODEL"; then
  echo "Smart Turn is already in $DEST/$MODEL"
  exit 0
fi

mkdir -p "$DEST"
# Beside the destination, so the final move is a rename and a half-finished
# download never sits where the display looks for the model.
WORK="$(mktemp -d "$DEST/.fetch.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

while read -r path sum; do
  [ -n "$path" ] || continue
  mkdir -p "$WORK/$MODEL/$(dirname "$path")"
  curl -fsSL --retry 2 "$BASE/$MODEL/$path" -o "$WORK/$MODEL/$path"
done <<< "$FILES"
curl -fsSL --retry 2 "$BASE/LICENSE" -o "$WORK/LICENSE" || true

if ! matches "$WORK/$MODEL"; then
  echo "The Smart Turn download does not match its pinned hashes. Nothing was installed." >&2
  exit 1
fi

rm -rf "${DEST:?}/$MODEL"
mv "$WORK/$MODEL" "$DEST/$MODEL"
if [ -f "$WORK/LICENSE" ]; then mv "$WORK/LICENSE" "$DEST/LICENSE"; fi
echo "Smart Turn installed in $DEST/$MODEL"
