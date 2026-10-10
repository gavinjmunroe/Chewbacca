#!/usr/bin/env bash
# ui-proof writes a pixel receipt and its check refuses a stale, failing,
# missing or tampered one. Local fixture over localhost only, no network.
# Exit 0 with a "skip:" line when no headless browser can start, so a machine
# without Chromium reports the gap instead of a failure or a fake pass.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UP="$ROOT/bin/ui-proof"
T="$(mktemp -d)"; SRV=""
cleanup() { [ -n "$SRV" ] && kill "$SRV" 2>/dev/null; wait 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# No browser is reported as unverified (exit 3), never as a pass.
PLAYWRIGHT_BROWSERS_PATH="$T/none" python3 "$UP" probe >/dev/null 2>"$T/nb.err"; rc=$?
[ "$rc" -eq 3 ] || fail "probe with no browser exited $rc, want 3"
grep -q "no browser available" "$T/nb.err" || fail "no-browser message missing"

if ! python3 "$UP" probe >/dev/null 2>&1; then
  echo "skip: no headless browser here (python3 -m playwright install chromium)"; exit 0
fi

PROJ="$T/proj"; mkdir -p "$PROJ"
cp "$ROOT/tests/fixtures/ui-proof/"*.html "$PROJ/"
# Backdate the pages so the receipt is unambiguously newer on a coarse clock.
touch -t 202001010000 "$PROJ/good.html" "$PROJ/bad.html"
PORT=$((20000 + RANDOM % 20000))
( cd "$PROJ" && exec python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 ) & SRV=$!
for _ in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$PORT/good.html" && break; sleep 0.2; done
URL="http://127.0.0.1:$PORT"

# 1. No receipt yet: refused.
python3 "$UP" check --root "$PROJ" >/dev/null 2>"$T/e"; [ $? -eq 1 ] || fail "check passed with no receipt"
grep -q "no receipt" "$T/e" || fail "no-receipt reason missing"

# 2. Clean capture: both widths, hashes match the files on disk.
python3 "$UP" capture "$URL/good.html" --out "$PROJ/.ui-proof" >"$T/cap" 2>&1 || { cat "$T/cap"; fail "clean capture failed"; }
R="$PROJ/.ui-proof/receipt.json"
python3 - "$R" <<'PY' || exit 1
import hashlib, json, os, sys
r = json.load(open(sys.argv[1])); base = os.path.dirname(sys.argv[1])
assert r["ok"] is True, r
assert sorted(s["width"] for s in r["shots"]) == [375, 1440], r["shots"]
for s in r["shots"]:
    p = os.path.join(base, s["file"])
    assert open(p, "rb").read(8) == b"\x89PNG\r\n\x1a\n", p
    assert hashlib.sha256(open(p, "rb").read()).hexdigest() == s["sha256"], p
assert r["console_errors"] == [] and r["page_errors"] == []
assert r["created_at"] >= r["started_at"] > 0
PY
python3 "$UP" check --root "$PROJ" >"$T/o" 2>&1 || { cat "$T/o"; fail "fresh receipt refused"; }

# 3. A UI edit after the capture makes the receipt stale.
sleep 1; touch "$PROJ/good.html"
python3 "$UP" check --root "$PROJ" >/dev/null 2>"$T/e"; [ $? -eq 1 ] || fail "stale receipt passed"
grep -q "stale" "$T/e" || fail "stale reason missing"
# --files narrows the comparison to what changed: the untouched page still passes.
python3 "$UP" check --root "$PROJ" --files "$PROJ/bad.html" >/dev/null 2>&1 || fail "--files on an older file refused"

# 4. A tampered screenshot is refused.
python3 "$UP" capture "$URL/good.html" --out "$PROJ/.ui-proof" >/dev/null 2>&1 || fail "recapture failed"
python3 "$UP" check --root "$PROJ" >/dev/null 2>&1 || fail "recapture did not clear stale"
printf 'x' >> "$PROJ/.ui-proof/mobile.png"
python3 "$UP" check --root "$PROJ" >/dev/null 2>"$T/e"; [ $? -eq 1 ] || fail "tampered screenshot passed"
grep -q "hash mismatch" "$T/e" || fail "hash reason missing"

# 5. A page with console errors fails capture and its receipt fails check.
python3 "$UP" capture "$URL/bad.html" --out "$PROJ/.ui-proof" >"$T/cap" 2>&1; [ $? -eq 1 ] || fail "bad page capture exited 0"
grep -q "planted console error" "$T/cap" || fail "console error not reported"
grep -q "planted late exception" "$T/cap" || fail "late exception not reported"
python3 "$UP" check --root "$PROJ" >/dev/null 2>"$T/e"; [ $? -eq 1 ] || fail "failing receipt passed"
grep -q "capture failed" "$T/e" || fail "failed-capture reason missing"

# 6. A 404 is a failed capture, not proof.
python3 "$UP" capture "$URL/missing.html" --out "$T/r404" >/dev/null 2>&1; [ $? -eq 1 ] || fail "404 capture exited 0"

# 7. A project with no UI files has nothing to prove.
mkdir -p "$T/empty"; echo x > "$T/empty/notes.txt"
python3 "$UP" check --root "$T/empty" >/dev/null 2>&1 || fail "empty project refused"

echo "ui-proof: all checks passed"
