#!/bin/bash
# chewbacca photo check: a grayscale headshot fails, a colour one passes.
# 2026-10-29: two grayscale advisor photos shipped on FF /team ("NO B&W BRO ITS NOT A FUNERAL").
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
ok() { echo "ok    $1"; }
no() { echo "FAIL  $1"; fail=1; }
python3 -c "import PIL" 2>/dev/null || { echo "skip  PIL not installed"; exit 0; }
python3 - "$T" <<'PY'
import sys
from PIL import Image
d = sys.argv[1]
c = Image.new("RGB", (80, 100), (200, 160, 130))
for x in range(80):
    for y in range(50, 100):
        c.putpixel((x, y), (90, 140, 210))
c.save(f"{d}/colour.jpg")
c.convert("L").convert("RGB").save(f"{d}/gray.jpg")
PY
python3 "$ROOT/bin/chewbacca-photo" check "$T/colour.jpg" >/dev/null && ok "colour photo passes" || no "colour photo flagged"
python3 "$ROOT/bin/chewbacca-photo" check "$T/gray.jpg" >/dev/null && no "gray photo passed" || ok "gray photo flagged"
out="$(python3 "$ROOT/bin/chewbacca-photo" check "$T")"
echo "$out" | grep -q "GRAY.*gray.jpg" && ok "dir check names the gray file" || no "dir check missed it: $out"
echo "$out" | grep -q "ok .*colour.jpg" && ok "dir check passes the colour file" || no "dir check flagged colour"
python3 "$ROOT/bin/chewbacca-photo" --help | grep -q "paste" && ok "help names paste" || no "help missing paste"
exit $fail
