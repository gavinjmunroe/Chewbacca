#!/bin/bash
# text-blast must send nothing without --go, and must never text anyone twice
# across a restart (2026-10-26: Jet and Andrea got a link blast twice).
set -uo pipefail
BIN="$(cd "$(dirname "$0")/.." && pwd)/bin/text-blast"
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
cat >"$T/people" <<'S'
#!/bin/bash
echo "$*" >>"$CALLS"
S
chmod +x "$T/people"
printf 'Jet\t+15550000001\nAndrea\nManny\t+15550000003\n' >"$T/list.tsv"
export CALLS="$T/calls" PEOPLE_BIN="$T/people" CHEWBACCA_NO_SEND=1

PEOPLE_BIN="$T/people" "$BIN" "$T/list.tsv" "$T/run.log" -- "hi" "link" >"$T/out" 2>&1
[ ! -s "$T/calls" ] && ok "no --go sends nothing" || no "no --go sent"
grep -q "3 to send" "$T/out" && ok "prints the count" || no "count missing"

echo "SENT Jet" >"$T/run.log"
"$BIN" "$T/list.tsv" "$T/run.log" --go --gap 0-0 -- "hi" "link" >"$T/out" 2>&1
! grep -q "^send Jet " "$T/calls" && ok "skips a name already in the log" || no "re-sent Jet"
[ "$(grep -c '^send Andrea ' "$T/calls")" = 2 ] && ok "sends every message to a new name" || no "Andrea count wrong"
grep -q -- "--to +15550000003" "$T/calls" && ok "passes the handle" || no "handle missing"
grep -qx "SENT Manny" "$T/run.log" && ok "logs each send" || no "Manny not logged"

: >"$T/calls"
"$BIN" "$T/list.tsv" "$T/run.log" --go --gap 0-0 -- "hi" "link" >"$T/out" 2>&1
[ ! -s "$T/calls" ] && ok "a rerun texts nobody twice" || no "rerun sent again"

printf '#!/bin/bash\nexit 1\n' >"$T/people"
printf 'Zed\n' >"$T/l2.tsv"
"$BIN" "$T/l2.tsv" "$T/r2.log" --go --gap 0-0 -- "hi" >"$T/out" 2>&1; rc=$?
[ $rc = 1 ] && grep -qx "FAIL Zed" "$T/r2.log" && ok "stops on a failed send" || no "kept going after a failure"

printf 'Emma\n' >"$T/l3.tsv"; echo "STARTED Emma" >"$T/r3.log"; : >"$T/calls"
cat >"$T/people" <<'S'
#!/bin/bash
echo "$*" >>"$CALLS"
S
"$BIN" "$T/l3.tsv" "$T/r3.log" --go --gap 0-0 -- "hi" >"$T/out" 2>&1
[ ! -s "$T/calls" ] && ok "a person cut off mid-send is not texted again" || no "re-sent a half-sent person"

echo "  $pass passed, $fail failed"
[ $fail = 0 ]
