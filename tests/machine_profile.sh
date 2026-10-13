#!/usr/bin/env bash
# machine_profile: one owner for every load and memory limit, each a share of
# the Mac it runs on. Fake Macs come from MACHINE_PROFILE, so no case here
# depends on what this Mac is doing (a test that reports the weather is not
# a test). Only the "reads this Mac" case touches the live machine, and it
# checks shape, never a value.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIX="$ROOT/tests/fixtures/machine"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fail=0
ok() { if eval "$2"; then echo "  ok    $1"; else echo "  FAIL  $1"; fail=$((fail+1)); fi; }
get() { MACHINE_PROFILE="$1" /usr/bin/python3 -I "$ROOT/bin/lib/machine_profile.py" --get "${@:2}"; }
variant() { /usr/bin/python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); r.update(json.loads(sys.argv[2])); json.dump(r, open(sys.argv[3], "w"))' "$1" "$2" "$3"; }

REF="$FIX/reference-14core.json"; LAP="$FIX/laptop-8core.json"
variant "$REF" '{"idle_s": 3600}' "$T/ref-away.json"
variant "$REF" '{"idle_s": 599}' "$T/ref-reading.json"
variant "$REF" '{"on_battery": true}' "$T/ref-battery.json"
variant "$REF" '{"on_battery": true, "idle_s": 3600}' "$T/ref-battery-away.json"
variant "$REF" '{"thermal": true}' "$T/ref-hot.json"
variant "$LAP" '{"idle_s": 3600}' "$T/lap-away.json"

# The reference Mac, someone at it, on power, gives exactly the numbers the
# hooks carried before, each measured there. Nothing moved for the one Mac
# they came from.
ok "reference, present: the measured numbers, unchanged" \
   '[ "$(get "$REF" warm_load hot_load admit_load pause_load busy_load suite_load)" = "14.0 28.0 18.2 35.0 8.0 50.0" ]'
ok "reference, present: memory floors 20 and 10" '[ "$(get "$REF" warm_mem hot_mem admit_mem pause_mem)" = "20 10 20 10" ]'
# 4P + 4E is 6 weighted cores: half the reference.
ok "8-core laptop: half the reference" \
   '[ "$(get "$LAP" warm_load hot_load admit_load pause_load busy_load suite_load)" = "7.0 14.0 9.1 17.5 4.0 25.0" ]'
ok "nobody at the reference Mac: near full use" \
   '[ "$(get "$T/ref-away.json" mode admit_load pause_load warm_load hot_load)" = "away 30.0 54.0 30.0 54.0" ]'
ok "nobody at the laptop: scales the same way" '[ "$(get "$T/lap-away.json" admit_load pause_load)" = "15.0 27.0" ]'
ok "9 minutes 59 without input is still present" '[ "$(get "$T/ref-reading.json" mode)" = present ]'
ok "on battery: every load limit cut to 60%" '[ "$(get "$T/ref-battery.json" warm_load admit_load busy_load)" = "8.4 10.9 4.8" ]'
ok "on battery, nobody there: still cut, never raised" '[ "$(get "$T/ref-battery-away.json" mode admit_load)" = "present 10.9" ]'
ok "thermal limit: cut like battery" '[ "$(get "$T/ref-hot.json" admit_load)" = "10.9" ]'

# Levels come from the same numbers.
lvl() { variant "$1" "$2" "$T/l.json"; get "$T/l.json" level; }
ok "level: calm under warm" '[ "$(lvl "$REF" "{\"load\": 13}")" = calm ]'
ok "level: warm at warm_load" '[ "$(lvl "$REF" "{\"load\": 14}")" = warm ]'
ok "level: hot at hot_load" '[ "$(lvl "$REF" "{\"load\": 28}")" = hot ]'
ok "level: low memory alone is warm" '[ "$(lvl "$REF" "{\"mem_free\": 15}")" = warm ]'
ok "level: critical memory alone is hot" '[ "$(lvl "$REF" "{\"mem_free\": 9}")" = hot ]'
ok "level: away keeps more memory in use" '[ "$(lvl "$T/ref-away.json" "{\"mem_free\": 16}")" = calm ]'
ok "room and pause follow admit and pause" '[ "$(lvl "$REF" "{\"load\": 20}" >/dev/null; get "$T/l.json" room pause)" = "false false" ]'

# The live read, shape only.
live=$(/usr/bin/python3 -I "$ROOT/bin/lib/machine_profile.py" --json)
ok "reads this Mac: cores, memory, idle, power" \
   'printf %s "$live" | /usr/bin/python3 -c "import json,sys; p=json.load(sys.stdin)[\"profile\"]; assert p[\"p_cores\"]>=1 and p[\"e_cores\"]>=0 and p[\"mem_gb\"]>0 and p[\"idle_s\"]>=0 and isinstance(p[\"on_battery\"], bool) and 0<=p[\"mem_free\"]<=100"'
ok "plain words name the cores and who is at it" \
   '/usr/bin/python3 -I "$ROOT/bin/lib/machine_profile.py" | grep -qE "performance \+ [0-9]+ efficiency cores.*(someone is using it|nobody has touched it)"'
ok "an unknown key is an error, not a blank" '! get "$REF" nope 2>/dev/null'
ok "a broken MACHINE_PROFILE falls back to the live read" \
   'echo "{" > "$T/bad.json"; [ -n "$(get "$T/bad.json" level)" ]'

# One owner. Nothing else in the kit reads the load or memory to decide, and
# no hook or queue carries a fixed load number of its own again.
# Comments that cite the old readers as evidence don't count.
owners=$(cd "$ROOT" && grep -HnE "getloadavg|memorystatus_level|memory_pressure|load averages?:" \
           .claude/hooks/*.sh bin/chewbacca-jobs bin/lib/*.py 2>/dev/null \
         | grep -vE "^[^:]+:[0-9]+:[[:space:]]*#" | grep -v "^bin/lib/machine_profile.py:")
ok "nothing but machine_profile.py reads load or free memory to decide" '[ -z "$owners" ] || { echo "    $owners"; false; }'
ok "load-guard has no fixed load limit" '! grep -qE "load_int\" -ge [0-9]|busy:-0}\" -ge [0-9]" "$ROOT/.claude/hooks/load-guard.sh"'
ok "the jobs queue has no fixed share of cores" '! grep -qE "[0-9.]+ \* CORES" "$ROOT/bin/chewbacca-jobs"'
ok "machine-budget has no fixed share of cores" '! grep -qE "[0-9]+ \* cores|load >= cores" "$ROOT/.claude/hooks/machine-budget.sh"'
ok "runs on the stock macOS Python" '/usr/bin/python3 -c "import sys; sys.path.insert(0, \"$ROOT/bin/lib\"); import machine_profile"'

[ "$fail" -eq 0 ] && echo "machine-profile ok" || { echo "machine-profile: $fail failed"; exit 1; }
