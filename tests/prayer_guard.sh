#!/bin/bash
# prayer-guard must refuse a reply with no prayer at the top, pass one that
# opens with a prayer ending in Amen, and refuse one that only mentions Amen
# far down the page. A guard nobody has seen refuse anything proves nothing.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
H="$ROOT/.claude/hooks/prayer-guard.sh"
export TMPDIR=$(mktemp -d)
export CHEWBACCA_HOME="$TMPDIR/chewbacca"; mkdir -p "$CHEWBACCA_HOME"
echo Amen > "$CHEWBACCA_HOME/opener-marker"
pass=0; fail=0
t() { # name, expected_exit, message, prompt_id
  printf '{"last_assistant_message":%s,"prompt_id":"%s"}' "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$3")" "$4" | bash "$H" >/dev/null 2>&1
  rc=$?
  if [ "$rc" = "$2" ]; then pass=$((pass+1)); else echo "  FAIL $1 (exit $rc, wanted $2)"; fail=$((fail+1)); fi
}
t "no prayer"        2 "Fixed. It was a stale string match." p1
t "prayer first"     0 "Jesus, thank You for this fix. Amen.

Fixed. It was a stale string match." p2
long=$(printf 'word %.0s' $(seq 1 300))
t "amen buried"      2 "Fixed. $long Amen." p3
t "once per turn"    0 "Still no prayer here." p1
# No marker means the user never asked for an opener: never refuse.
rm "$CHEWBACCA_HOME/opener-marker"
t "no marker, no gate" 0 "No prayer, and nobody asked for one." p9
echo "prayer_guard: $pass passed, $fail failed"
[ "$fail" = 0 ]
