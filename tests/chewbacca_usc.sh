#!/bin/bash
# chewbacca usc must show a student's week from any machine: due items from
# the newest term only, labelled by course code, the dining hall, and today's
# events. One section failing (not signed in) prints one line and the others
# still render. The engine is faked: no network, no USC account.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
no() { echo "FAIL: $*"; fail=1; }

mkdir -p "$T/bin" "$T/kit" "$T/engine"
cat > "$T/bin/api-anything" <<'SH'
#!/bin/bash
[ "$1" = call ] || { echo '{"ok":true}'; exit 0; }
case "$2 $3" in
  "brightspace myCourses")
    [ -n "${FAKE_SIGNED_OUT:-}" ] && { echo '{"ok":false,"class":"auth"}'; exit 0; }
    echo '{"ok":true,"data":[{"orgUnitId":1,"code":"20253_1","name":"20253_1 OLD-101: Last term","active":true},{"orgUnitId":2,"code":"20263_2","name":"20263_2 ACAD-324: Design","active":true}]}' ;;
  "brightspace upcoming")
    case "$*" in *orgUnitIds=2\ *) ;; *) echo '{"ok":false,"class":"input","reason":"wrong ids '"$*"'"}'; exit 0;; esac
    echo '{"ok":true,"data":[{"title":"Mash Up","courseCode":"20263_2","due":"2026-10-14T17:30:00.000Z"}]}' ;;
  usc-dining\ menu*)
    echo '{"ok":true,"data":[{"station":"Grill","menu":[{"item":"Turkey Burger"}]}]}' ;;
  "usc-events upcoming")
    echo '{"ok":true,"data":[{"title":"Trojan Talk","start":"2026-10-10T19:00:00-07:00","location":"Doheny"}]}' ;;
  *) echo '{"ok":false,"class":"error","reason":"unexpected '"$*"'"}' ;;
esac
SH
chmod +x "$T/bin/api-anything"
export PATH="$T/bin:$PATH" API_ANYTHING_HOME="$T/engine" CHEWBACCA_API_SITES="$T/kit" \
  CHEWBACCA_USC_CONFIG="$T/usc.json" CHEWBACCA_ROOT="$ROOT"

out="$(bash "$ROOT/bin/chewbacca" usc 2>&1)"
printf '%s' "$out" | grep -q "ACAD-324 *Mash Up" || no "due item missing or not labelled by course code: $out"
printf '%s' "$out" | grep -q "OLD-101" && no "last term's course leaked into this week"
printf '%s' "$out" | grep -q "Grill: Turkey Burger" || no "dining hall section missing"
printf '%s' "$out" | grep -q "Trojan Talk (Doheny)" || no "events section missing"

# Signed out of Brightspace: one line saying what to do, the rest still shows.
out="$(FAKE_SIGNED_OUT=1 bash "$ROOT/bin/chewbacca" usc 2>&1)"
printf '%s' "$out" | grep -q "not signed in: open brightspace.usc.edu" || no "signed-out Brightspace gave no sign-in line"
printf '%s' "$out" | grep -q "Trojan Talk" || no "a Brightspace failure took the other sections down"

# The hall choice is remembered.
bash "$ROOT/bin/chewbacca" usc --hall evk >/dev/null 2>&1
grep -q '"evk"' "$T/usc.json" || no "--hall was not remembered"
bash "$ROOT/bin/chewbacca" usc 2>&1 | grep -q " at evk" || no "the remembered hall was not used"

# --json is data.
bash "$ROOT/bin/chewbacca" usc --json 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); assert set(d) == {"due","food","events"}' \
  || no "--json is not the three-section report"

[ "$fail" -eq 0 ] && echo "chewbacca usc: ok"
exit "$fail"
