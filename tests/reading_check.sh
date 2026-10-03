#!/bin/bash
# reading-check must FAIL when a due reading has no file on disk, the hooks
# intro on 2026-09-30, and PASS once the file is there.
set -uo pipefail
CHECK="$(dirname "$0")/../bin/reading-check"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
ok()  { printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no()  { printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }

mkdir -p "$TMP/readings/node_modules"
cat > "$TMP/due.json" <<'EOF'
{"overdue": [], "upcoming": [
  {"course": "WRIT 150", "name": "Read bell hooks, Introduction (Teaching to Transgress)", "date": "2026-09-30", "type": "reading", "status": "todo"},
  {"course": "WRIT 150", "name": "Read Freire, Chapter 2 (Pedagogy of the Oppressed)", "date": "2026-09-30", "type": "reading", "status": "todo"},
  {"course": "ACAD 185", "name": "A9 Presentation", "date": "2026-09-29", "type": "assignment", "status": "todo"}
]}
EOF
: > "$TMP/readings/freire-ch2.pdf"
mkdir -p "$TMP/wp2" && : > "$TMP/wp2/POST-HOOKS-V3.md"   # his response, not the reading
: > "$TMP/readings/node_modules/hooks.md"

READINGS_DIRS="$TMP/readings:$TMP/wp2" "$CHECK" --from "$TMP/due.json" > "$TMP/out" 2>&1
[ $? -eq 1 ] && ok "missing hooks reading exits 1" || no "missing hooks reading should exit 1"
grep -q "MISSING.*bell hooks" "$TMP/out" && ok "names the missing reading" || no "should name bell hooks as missing"
grep -q "ok .*Freire" "$TMP/out" && ok "finds Freire by surname" || no "should find freire-ch2.pdf"
grep -q "A9" "$TMP/out" && no "non-reading items should be ignored" || ok "ignores non-reading items"

: > "$TMP/readings/hooks-teaching-to-transgress-intro.pdf"
READINGS_DIRS="$TMP/readings" "$CHECK" --from "$TMP/due.json" >/dev/null 2>&1
[ $? -eq 0 ] && ok "all readings present exits 0" || no "all present should exit 0"

echo '{"upcoming": []}' > "$TMP/none.json"
READINGS_DIRS="$TMP/readings" "$CHECK" --from "$TMP/none.json" >/dev/null 2>&1
[ $? -eq 0 ] && ok "no readings due exits 0" || no "empty list should exit 0"

echo 'not json' > "$TMP/bad.json"
READINGS_DIRS="$TMP/readings" "$CHECK" --from "$TMP/bad.json" >/dev/null 2>&1
[ $? -eq 2 ] && ok "bad input exits 2" || no "bad input should exit 2"

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
