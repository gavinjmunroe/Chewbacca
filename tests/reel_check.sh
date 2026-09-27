#!/bin/bash
# reel-check must pass a good vertical video and fail the three ways a Reel
# is broken before anyone watches it; reel-assemble must produce one that
# passes, with its caption on screen only inside its window.
#
# WHY. Both tools are the gate in the creative-video skill. A checker that
# passes everything looks exactly like one that works, so each failure it
# exists to catch has a fixture: landscape, no audio stream, and a black
# silent first frame (the three found while making the domino reel,
# 2026-09-27).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
command -v ffmpeg >/dev/null || { echo "SKIP reel_check: ffmpeg not installed"; exit 0; }
python3 -c "import PIL, numpy" 2>/dev/null || { echo "SKIP reel_check: Pillow or numpy missing"; exit 0; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
cd "$TMP"

ffmpeg -v error -y -f lavfi -i "testsrc2=size=1080x1920:rate=30:duration=4" \
  -f lavfi -i "sine=frequency=440:duration=4" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest good.mp4
ffmpeg -v error -y -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=4" -c:v libx264 -pix_fmt yuv420p wide.mp4
ffmpeg -v error -y -f lavfi -i "color=c=black:size=1080x1920:rate=30:duration=4" \
  -f lavfi -i "anullsrc=r=48000:cl=stereo" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest black.mp4

"$ROOT/bin/reel-check" good.mp4 >out.txt || fail "good video failed: $(grep FAIL out.txt)"
"$ROOT/bin/reel-check" wide.mp4 >out.txt && fail "landscape video passed"
grep -q "FAIL  aspect" out.txt || fail "landscape not named as the aspect"
grep -q "FAIL  audio" out.txt || fail "missing audio stream not caught"
"$ROOT/bin/reel-check" black.mp4 >out.txt && fail "black silent video passed"
grep -q "FAIL  first frame" out.txt || fail "black first frame not caught"
grep -q "silent" out.txt || fail "silent audio not caught"

# reel-assemble: 60 grey frames, a tone, one caption from 0.5 s to 1.2 s.
mkdir frames
ffmpeg -v error -y -f lavfi -i "testsrc2=size=1080x1920:rate=30:duration=2" frames/f_%04d.png
ffmpeg -v error -y -f lavfi -i "sine=frequency=330:duration=2" tone.wav
FONT="$(fc-match -f '%{file}' 'Helvetica:bold' 2>/dev/null)"
[ -f "$FONT" ] || FONT="$(ls /System/Library/Fonts/Supplemental/Arial\ Bold.ttf 2>/dev/null)"
[ -f "$FONT" ] || { echo "SKIP reel_assemble: no font found"; exit 0; }
cat > edit.json <<JSON
{"out": "made.mp4", "size": "1080x1920", "fps": 30, "seconds": 2,
 "frames": "frames/f_%04d.png",
 "audio": [{"file": "tone.wav", "at": 0}],
 "captions": [{"text": "CAPTION", "from": 0.5, "to": 1.2}],
 "caption_style": {"font": "$FONT", "size": 120, "y": 0.34}}
JSON
"$ROOT/bin/reel-assemble" edit.json >/dev/null || fail "reel-assemble exited non-zero"
"$ROOT/bin/reel-check" made.mp4 >out.txt || fail "assembled video failed: $(grep FAIL out.txt)"
python3 - <<'PY' || exit 1
import subprocess, sys
from io import BytesIO
import numpy as np
from PIL import Image
def band(im):
    return np.asarray(im.convert("L"), dtype=np.int16)[560:740, :]
def video(t):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(t), "-i", "made.mp4", "-frames:v", "1",
                          "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True).stdout
    return band(Image.open(BytesIO(raw)))
source = lambda n: band(Image.open(f"frames/f_{n:04d}.png"))
# 30 fps and ffmpeg numbers frames from 1: 0.8 s is f_0025, 1.6 s is f_0049.
inside = np.abs(video(0.8) - source(25)).mean()
outside = np.abs(video(1.6) - source(49)).mean()
if inside < 8:
    sys.exit(f"FAIL: caption not drawn inside its window (change {inside:.1f})")
if outside > 4:
    sys.exit(f"FAIL: caption still on screen after its window (change {outside:.1f})")
PY
echo "ok"
