#!/bin/bash
# blockout_ref.py must write a reference exactly as long as its spec, at any
# preview scale, with a roles block that maps every tinted proxy.
#
# WHY. The reference goes into a Seedance omni_reference job whose duration
# must equal it, and a job that runs past the reference invents footage. Two
# ways it broke on 2026-09-27: a 5 s spec rendered into a folder left by a
# 6 s one encoded 144 frames, not 120, because the %04d sequence ran on into
# the old frames; and --scale 0.5 on the 1920x822 standoff gave 960x411,
# which H.264 refused, so the half-size preview never made a video at all.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BLENDER="$(command -v blender || echo /Applications/Blender.app/Contents/MacOS/Blender)"
[ -x "$BLENDER" ] || { echo "SKIP blockout_ref: blender not installed"; exit 0; }
command -v ffmpeg >/dev/null || { echo "SKIP blockout_ref: ffmpeg not installed"; exit 0; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
cd "$TMP"
SPEC="$ROOT/skills/creative-video/blender/blockout/standoff.json"
render() { "$BLENDER" -b --factory-startup -P "$ROOT/skills/creative-video/blender/blockout_ref.py" -- "$@" >log.txt 2>&1; }
frames() { ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=nb_read_frames -of csv=p=0 "$1"; }

python3 -c "import json,sys; d=json.load(open(sys.argv[1])); d['seconds']=6; json.dump(d,open('long.json','w'))" "$SPEC"
render --spec long.json --out out --scale 0.25 || fail "6 s render failed: $(tail -3 log.txt)"
[ "$(frames out/ref.mp4)" = 144 ] || fail "6 s at 24 fps is not 144 frames"

render --spec "$SPEC" --out out --scale 0.25 || fail "5 s render failed: $(tail -3 log.txt)"
[ "$(frames out/ref.mp4)" = 120 ] || fail "stale frames leaked: $(frames out/ref.mp4) frames, wanted 120"

render --spec "$SPEC" --out half --scale 0.5 || fail "odd-height preview failed: $(grep -i error log.txt | head -2)"
[ -s half/ref.mp4 ] || fail "no ref.mp4 at --scale 0.5"
[ -s half/first.png ] && [ -s half/last.png ] || fail "first.png or last.png missing"

grep -q "coarse blockout reference" out/roles.txt || fail "roles.txt lost the blockout clause"
grep -q "blue figure" out/roles.txt && grep -q "red figure" out/roles.txt || fail "a tinted proxy has no role line"
grep -q "Duration 5 s" out/roles.txt || fail "roles.txt does not state the duration"

python3 -c "import json,sys; d=json.load(open(sys.argv[1])); d['seconds']=3; json.dump(d,open('short.json','w'))" "$SPEC"
render --spec short.json --out short && fail "a 3 s spec rendered; Seedance 2.5 takes 4 s at least"
echo "ok"
