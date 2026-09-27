#!/bin/bash
# edit-cut must put every cut on the song's own beat grid, find the drop,
# never use the same stretch of footage twice, and come out exactly as long
# as asked with the title card where the drop is.
#
# WHY. Its first version laid an even grid from one tempo read off the first
# 20 s of the song. On ELECTRIC's track that intro read 112 BPM against 129
# for the whole, and the cuts were off the beat within four bars while the
# tool reported them locked (2026-09-27). The card also came out a sixth of
# the frame high where the reference fills it.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
command -v uv >/dev/null || { echo "SKIP edit_cut: uv not installed"; exit 0; }
command -v ffmpeg >/dev/null || { echo "SKIP edit_cut: ffmpeg not installed"; exit 0; }
[ -f /System/Library/Fonts/HelveticaNeue.ttc ] || { echo "SKIP edit_cut: needs macOS Helvetica Neue"; exit 0; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
cd "$TMP"
mkdir clips

# Six clips that differ in motion, from a still bar chart to a moving pattern.
n=0
for src in "testsrc2=size=640x360:rate=30" "testsrc=size=640x360:rate=30" \
  "rgbtestsrc=size=640x360:rate=30" "smptehdbars=size=640x360:rate=30" \
  "mandelbrot=size=640x360:rate=30" "cellauto=size=640x360:rate=30:rule=30"; do
  n=$((n + 1))
  ffmpeg -v error -y -f lavfi -t 12 -i "$src" -c:v libx264 -pix_fmt yuv420p "clips/c$n.mp4" \
    || fail "could not build clip $n from $src"
done

# 30 s at 120 BPM: a click every 0.5 s, quiet until 4 s, loud with a hat after.
ffmpeg -v error -y -f lavfi -i "aevalsrc='(if(lt(t\,4)\,0.15\,0.9))*if(lt(mod(t\,0.5)\,0.03)\,sin(2*PI*90*t)\,0)+if(lt(t\,4)\,0\,0.3)*if(lt(mod(t+0.25\,0.5)\,0.01)\,sin(2*PI*6000*t)\,0)':s=44100:d=30" \
  song.wav || fail "could not build the song"

"$ROOT/bin/edit-cut" clips --song song.wav --style electric --title "DIRECTORS REEL*" \
  --seconds 10 --seed 3 --no-check --out edit.mp4 >log.txt 2>&1 || fail "edit-cut exited non-zero: $(tail -3 log.txt)"
[ -s edit.mp4 ] && [ -s edit.edl.json ] || fail "no video or no edit list"

frames=$(ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=nb_read_frames,width,height -of csv=p=0 edit.mp4)
[ "$frames" = "1440,1080,240" ] || fail "wanted 1440x1080 and 240 frames (10 s at 24), got $frames"

python3 - <<'PY' || exit 1
import json, sys
e = json.load(open("edit.edl.json"))
slots = e["slots"]
frame = 1 / 24
if abs(e["drop"] - 4.0) > frame + 0.01:
    sys.exit(f"FAIL: the drop is at 4.0 s, edit-cut found {e['drop']}")
if abs(60 / e["beat"] - 120) > 3:
    sys.exit(f"FAIL: 120 BPM song read as {60 / e['beat']:.1f}")
# every boundary on the half-beat grid (multiples of 0.25 s), within a frame
off = [s["t"] for s in slots if min(s["t"] % 0.25, 0.25 - s["t"] % 0.25) > frame + 0.01]
if off:
    sys.exit(f"FAIL: cuts off the half-beat grid at {off}")
kinds = [s["kind"] for s in slots]
if "card" not in kinds or not any(s.get("hero") for s in slots):
    sys.exit(f"FAIL: no card or no hero shot in {kinds}")
card = next(s for s in slots if s["kind"] == "card")
if abs(card["t"] - e["drop"]) > 0.01:
    sys.exit(f"FAIL: card at {card['t']}, drop at {e['drop']}")
# no stretch of footage used twice
used = {}
for s in slots:
    for src, t0, dur in ((s.get("source"), s.get("in"), s["dur"] * s.get("speed", 1.0)),
                         (s.get("flash_source"), s.get("flash_in"), frame)):
        if src is None:
            continue
        for a, b in used.get(src, []):
            if t0 < b - 1e-6 and t0 + dur > a + 1e-6:
                sys.exit(f"FAIL: {src} reused at {t0:.2f} (already {a:.2f} to {b:.2f})")
        used.setdefault(src, []).append((t0, t0 + dur))
print(json.dumps({"card_at": card["t"]}))
PY

# the card fills the frame: at its midpoint over a tenth of the pixels are red
t=$(python3 -c "import json; e=json.load(open('edit.edl.json')); c=next(s for s in e['slots'] if s['kind']=='card'); print(c['t']+c['dur']/2)")
ffmpeg -v error -y -ss "$t" -i edit.mp4 -frames:v 1 -vf scale=144:108 -f rawvideo -pix_fmt rgb24 card.rgb
python3 - <<'PY' || exit 1
import sys
b = open("card.rgb", "rb").read()
px = [b[i:i + 3] for i in range(0, len(b), 3)]
red = sum(1 for r, g, bl in px if r > 140 and g < 70 and bl < 70) / len(px)
if red < 0.25:
    sys.exit(f"FAIL: card is {red:.0%} red; the full-frame card is over 25%")
PY
echo "ok"
