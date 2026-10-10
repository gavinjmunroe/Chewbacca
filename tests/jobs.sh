#!/usr/bin/env bash
# jobs: one queue for long work, with a machine budget. Heavy work waits for
# room, pauses when the Mac gets busy, resumes when it frees up, and survives
# the tab that started it. Machine state is injected, so this never depends on
# what the Mac is doing (a test that reports the weather is not a test).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
J="$ROOT/bin/chewbacca-jobs"
export JOBS_DIR; JOBS_DIR="$(mktemp -d)"
trap 'for d in "$JOBS_DIR"/*/; do p=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]+\"job.json\")).get(\"pid\") or \"\")" "$d" 2>/dev/null); [ -n "$p" ] && kill -CONT -"$p" 2>/dev/null; [ -n "$p" ] && kill -TERM -"$p" 2>/dev/null; done; rm -rf "$JOBS_DIR"' EXIT
fail=0
status() { python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['status'])" "$JOBS_DIR/$1/job.json"; }
check() { if [ "$2" = "$3" ]; then echo "  ok    $1"; else echo "  FAIL  $1: wanted $3 got $2"; fail=$((fail+1)); fi; }
settle() { for _ in $(seq 1 50); do [ "$(status "$1")" = "$2" ] && return; sleep 0.1; done; }

export JOBS_LOAD=1 JOBS_MEMFREE=60 JOBS_CORES=14
id=$("$J" submit --title echo -- sh -c 'echo hello' | cut -d' ' -f1)
settle "$id" done
check "a light job runs and finishes" "$(status "$id")" done
check "its output is kept" "$("$J" log "$id" | tail -1)" hello

id2=$(JOBS_LOAD=25 "$J" submit --heavy -- sleep 30 | cut -d' ' -f1)
check "heavy waits while the Mac is busy" "$(JOBS_LOAD=25 status "$id2")" queued
JOBS_LOAD=15 "$J" tick >/dev/null
settle "$id2" running
check "heavy starts at the idle-tabs load of 15 on 14 cores" "$(status "$id2")" running

id3=$("$J" submit --heavy -- sleep 30 | cut -d' ' -f1)
check "only one heavy job at a time" "$(status "$id3")" queued

JOBS_LOAD=40 "$J" tick >/dev/null
check "heavy pauses when load spikes" "$(status "$id2")" paused
JOBS_MEMFREE=5 JOBS_LOAD=1 "$J" tick >/dev/null
check "stays paused while memory is short" "$(status "$id2")" paused
"$J" tick >/dev/null
check "resumes when there's room" "$(status "$id2")" running

"$J" kill "$id2" >/dev/null
check "kill marks it killed" "$(status "$id2")" killed
"$J" tick >/dev/null
settle "$id3" running
check "the next heavy job takes the slot" "$(status "$id3")" running
"$J" kill "$id3" >/dev/null

# A build takes the machine from a long heavy job and gives it back after.
idh=$("$J" submit --heavy -- sleep 60 | cut -d' ' -f1)
settle "$idh" running
idb=$("$J" submit --build -- sleep 1 | cut -d' ' -f1)
settle "$idb" running
check "a build starts with a heavy job in the slot" "$(status "$idb")" running
"$J" tick >/dev/null
check "the heavy job yields to the build" "$(status "$idh")" paused
settle "$idb" done
"$J" tick >/dev/null
settle "$idh" running
check "the heavy job resumes after the build" "$(status "$idh")" running
idb2=$(JOBS_LOAD=25 "$J" submit --build -- true | cut -d' ' -f1)
check "a build waits on a busy Mac" "$(JOBS_LOAD=25 status "$idb2")" queued
"$J" kill "$idh" >/dev/null

# Heavy jobs take turns, so a short one never waits out a long one's whole run.
# 2026-10-09: a 10-minute encode sat queued for an hour behind a paused
# transcription of 238 creators that held the only heavy slot.
idl=$("$J" submit --heavy --title long -- sleep 60 | cut -d' ' -f1)
settle "$idl" running
ids=$("$J" submit --heavy --title short -- sleep 60 | cut -d' ' -f1)
"$J" tick >/dev/null
check "a fresh heavy job doesn't cut in mid-turn" "$(status "$ids")" queued
JOBS_SLICE=0 "$J" tick >/dev/null
check "once its turn is up the long job is held" "$(status "$idl")" paused
settle "$ids" running
check "and the short job runs" "$(status "$ids")" running
JOBS_SLICE=0 "$J" tick >/dev/null
check "the short job keeps the slot because it has run less" "$(status "$ids")" running
"$J" kill "$ids" >/dev/null
"$J" tick >/dev/null
settle "$idl" running
check "the long job resumes when the short one ends" "$(status "$idl")" running
JOBS_LOAD=40 "$J" tick >/dev/null
JOBS_SLICE=0 "$J" tick >/dev/null
check "one heavy job runs after a load pause, not two" "$(python3 -c "import json,glob,sys;print(sum(json.load(open(f))['status']=='running' and json.load(open(f))['class']=='heavy' for f in glob.glob(sys.argv[1]+'/*/job.json')))" "$JOBS_DIR")" 1
"$J" kill "$idl" >/dev/null

# A load pause doesn't hand the long job a fresh turn, or a Mac that keeps
# crossing the pause line lets it hold the slot forever.
idl=$("$J" submit --heavy --title long2 -- sleep 60 | cut -d' ' -f1)
settle "$idl" running
ids=$("$J" submit --heavy --title short2 -- sleep 60 | cut -d' ' -f1)
JOBS_LOAD=40 "$J" tick >/dev/null
"$J" tick >/dev/null
check "a load-paused job resumes first" "$(status "$idl")" running
python3 - "$JOBS_DIR/$idl/job.json" <<'PY'
import json,sys,time
p=sys.argv[1]; j=json.load(open(p)); j["turn"]=time.time()-1000; json.dump(j,open(p,"w"))
PY
JOBS_LOAD=40 "$J" tick >/dev/null
JOBS_SLICE=900 "$J" tick >/dev/null
settle "$ids" running
check "and still yields when its 15 minutes were used before the pause" "$(status "$ids")" running
"$J" kill "$ids" >/dev/null; "$J" kill "$idl" >/dev/null

# One tab's pile of builds doesn't own the lane: another tab's build goes next.
da=$(mktemp -d); db=$(mktemp -d)
a1=$(cd "$da" && "$J" submit --build -- sleep 2 | cut -d' ' -f1)
a2=$(cd "$da" && "$J" submit --build -- sleep 2 | cut -d' ' -f1)
a3=$(cd "$da" && "$J" submit --build -- sleep 2 | cut -d' ' -f1)
b1=$(cd "$db" && "$J" submit --build -- sleep 2 | cut -d' ' -f1)
settle "$a1" done
"$J" tick >/dev/null
check "the other tab's build runs before the first tab's second" "$(status "$b1")-$(status "$a2")" "running-queued"
for x in $a1 $a2 $a3 $b1; do "$J" kill "$x" >/dev/null 2>&1; done
rm -rf "$da" "$db"

[ "$fail" = 0 ] && echo "jobs ok"
exit "$fail"
