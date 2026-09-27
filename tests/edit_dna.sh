#!/bin/bash
# edit-dna must find cuts where they are, call beat-locked cuts locked and
# say what chance alone would have scored, and rank a moving shot above a
# still one.
#
# WHY. Its numbers become the recipe an edit is cut to. The first pass at
# them, by hand on 2026-09-27, read a BlackShell reel's median 102 ms from
# the beat as "locked"; at 144 BPM a random cut scores that too. So the
# fixture is a click track with every cut on a click, and the chance figure
# has to come out well below the measured one.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
command -v uv >/dev/null || { echo "SKIP edit_dna: uv not installed"; exit 0; }
command -v ffmpeg >/dev/null || { echo "SKIP edit_dna: ffmpeg not installed"; exit 0; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
cd "$TMP"

# 8 s at 120 BPM: a click every 0.5 s, and a cut every 2 s, always on a click.
# Moving test pattern and flat colour alternate, so motion must alternate too.
ffmpeg -v error -y \
  -f lavfi -i "testsrc2=size=640x360:rate=24:duration=2" \
  -f lavfi -i "color=c=0x802020:size=640x360:rate=24:duration=2" \
  -f lavfi -i "testsrc=size=640x360:rate=24:duration=2" \
  -f lavfi -i "color=c=0x203080:size=640x360:rate=24:duration=2" \
  -f lavfi -i "aevalsrc='if(lt(mod(t\,0.5)\,0.02)\,sin(2*PI*1800*t)\,0)':s=44100:d=8" \
  -filter_complex "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]" -map "[v]" -map 4:a \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest fixture.mp4 || fail "could not build the fixture"

"$ROOT/bin/edit-dna" fixture.mp4 --out out >log.txt 2>&1 || fail "edit-dna exited non-zero: $(tail -3 log.txt)"
[ -s out/fixture.energy.png ] && [ -s out/fixture.sheet.jpg ] || fail "chart or sheet missing"

python3 - <<'PY' || exit 1
import json, sys
d = json.load(open("out/fixture.json"))
s, cuts = d["summary"], d["cut_times"]
want = [2.0, 4.0, 6.0]
if len(cuts) != 3 or any(abs(c - w) > 1 / 24 + 1e-6 for c, w in zip(cuts, want)):
    sys.exit(f"FAIL: cuts {cuts}, wanted {want} within a frame")
if s.get("on_beat", 0) < 0.99:
    sys.exit(f"FAIL: every cut is on a click, on_beat says {s.get('on_beat')}")
if s["on_beat_by_chance"] > 0.4:
    sys.exit(f"FAIL: chance baseline {s['on_beat_by_chance']} too high for a 50 ms window at 120 BPM")
m = [r.get("camera", 0) + r.get("subject", 0) for r in d["shots"]]
if not (m[0] > 5 * max(m[1], 1e-3) and m[2] > 5 * max(m[3], 1e-3)):
    sys.exit(f"FAIL: moving shots do not outrank still ones: {m}")
PY
echo "ok"
