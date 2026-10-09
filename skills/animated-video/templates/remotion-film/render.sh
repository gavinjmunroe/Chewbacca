#!/bin/bash
# Full render + two-pass loudness-normalize to -14 LUFS / -1.5 dBTP (Instagram). usage: ./render.sh <name>
set -e; cd "$(dirname "$0")"; n=${1:-reel}
npx tsc -p .
npx remotion render src/index.ts Film out/$n.raw.mp4 --codec h264 --crf 18 --log=error
# Pass 1 measures; pass 2 applies one linear gain (no pumping), with a limiter margin under -1.5 dBTP.
m=$(ffmpeg -hide_banner -nostats -i out/$n.raw.mp4 -af loudnorm=I=-14:TP=-2:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
v() { printf '%s' "$m" | python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
ffmpeg -y -v error -i out/$n.raw.mp4 -c:v copy -af "loudnorm=I=-14:TP=-2:LRA=11:measured_I=$(v input_i):measured_TP=$(v input_tp):measured_LRA=$(v input_lra):measured_thresh=$(v input_thresh):offset=$(v target_offset):linear=true" -ar 48000 -c:a aac -b:a 192k out/$n.mp4 && rm out/$n.raw.mp4
echo out/$n.mp4
