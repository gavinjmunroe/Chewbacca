#!/bin/bash
# ratio-check fails a pinned layer whose text runs off a short window, and passes one that fits.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
python3 -c "import playwright" 2>/dev/null || { echo "  skip: playwright not installed"; exit 0; }
cat > "$TMP/good.html" <<'H'
<!doctype html><body style="margin:0"><div style="position:sticky;top:0;height:100vh;overflow:hidden"><h1 style="margin:0;font-size:5vh">Fits</h1></div></body>
H
cat > "$TMP/bad.html" <<'H'
<!doctype html><body style="margin:0"><div style="position:sticky;top:0;height:100vh;overflow:hidden"><h1 style="margin:0;margin-top:700px">Runs off short windows</h1></div></body>
H
"$ROOT/bin/ratio-check" "file://$TMP/good.html" >/dev/null 2>&1; g=$?
"$ROOT/bin/ratio-check" "file://$TMP/bad.html" >/dev/null 2>&1; b=$?
[ "$g" = 3 ] && { echo "  skip: no browser"; exit 0; }
fail=0
[ "$g" = 0 ] && echo "  ok    a layer that fits passes" || { echo "  FAIL  good page exited $g"; fail=1; }
[ "$b" = 1 ] && echo "  ok    text off a short window fails" || { echo "  FAIL  bad page exited $b"; fail=1; }
exit "$fail"
