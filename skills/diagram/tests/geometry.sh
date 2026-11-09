#!/usr/bin/env bash
# diagram: the two vendored checkers pass a clean diagram and refuse a broken one.
#
# 2026-10-03: the first draft of fixtures/good.html put 60px label masks in a
# 32px gap between nodes, and verify-geometry.py flagged all three. bad.html
# keeps one of those masks 8px inside the node painted after it.
#
#   bash skills/diagram/tests/geometry.sh [repo-root]
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/../../.." && pwd)}"
SKILL="$ROOT/skills/diagram"
FIX="$SKILL/tests/fixtures"
fail=0

ok()  { echo "ok    $1"; }
bad() { echo "FAIL  $1"; fail=1; }

python3 "$SKILL/scripts/verify-geometry.py" "$FIX/good.html" >/dev/null 2>&1 \
  && ok "verify-geometry passes the clean diagram" || bad "verify-geometry refused good.html"

out=$(python3 "$SKILL/scripts/verify-geometry.py" "$FIX/bad.html" 2>&1); code=$?
[ "$code" -eq 1 ] && printf '%s' "$out" | grep -q "clipped by node" \
  && ok "verify-geometry refuses a label mask under a later node" || bad "bad.html passed (exit $code)"

python3 "$SKILL/scripts/self_check.py" "$FIX/good.html" >/dev/null 2>&1 \
  && ok "self_check passes the accessible-SVG contract" || bad "self_check refused good.html"

# A diagram with no <title> must fail the accessibility contract.
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
sed -e '/<title id=/d' "$FIX/good.html" > "$tmp/untitled.html"
python3 "$SKILL/scripts/self_check.py" "$tmp/untitled.html" >/dev/null 2>&1 \
  && bad "self_check passed an svg with no <title>" || ok "self_check refuses an svg with no <title>"

# Every shipped example stays clean, so a bad edit to an asset is caught too.
python3 "$SKILL/scripts/verify-geometry.py" --all >/dev/null 2>&1 \
  && ok "every vendored asset passes verify-geometry" || bad "a vendored asset has a clipped label"

exit $fail
