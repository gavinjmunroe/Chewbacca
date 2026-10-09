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

export JOBS_LOAD=1 JOBS_MEMFREE=60
id=$("$J" submit --title echo -- sh -c 'echo hello' | cut -d' ' -f1)
settle "$id" done
check "a light job runs and finishes" "$(status "$id")" done
check "its output is kept" "$("$J" log "$id" | tail -1)" hello

id2=$(JOBS_LOAD=13 "$J" submit --heavy -- sleep 30 | cut -d' ' -f1)
check "heavy waits while the Mac is busy" "$(JOBS_LOAD=13 status "$id2")" queued
JOBS_LOAD=1 "$J" tick >/dev/null
settle "$id2" running
check "heavy starts once there's room" "$(status "$id2")" running

id3=$("$J" submit --heavy -- sleep 30 | cut -d' ' -f1)
check "only one heavy job at a time" "$(status "$id3")" queued

JOBS_LOAD=20 "$J" tick >/dev/null
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

[ "$fail" = 0 ] && echo "jobs ok"
exit "$fail"
