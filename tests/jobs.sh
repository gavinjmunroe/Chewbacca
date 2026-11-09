#!/usr/bin/env bash
# jobs: one queue for long work, with a machine budget. Heavy work waits for
# room, pauses when the Mac gets busy, resumes when it frees up, and survives
# the tab that started it. Machine state is injected, so this never depends on
# what the Mac is doing (a test that reports the weather is not a test).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
J="$ROOT/bin/chewbacca-jobs"
export JOBS_DIR; JOBS_DIR="$(mktemp -d)"
# Where a job marks itself as a background writer: never the user's own.
export CHEWBACCA_BACKGROUND_WRITERS="$JOBS_DIR/background-writers.tsv"
trap 'for d in "$JOBS_DIR"/*/; do p=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]+\"job.json\")).get(\"pid\") or \"\")" "$d" 2>/dev/null); [ -n "$p" ] && kill -CONT -"$p" 2>/dev/null; [ -n "$p" ] && kill -TERM -"$p" 2>/dev/null; done; rm -rf "$JOBS_DIR"' EXIT
fail=0
status() { python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['status'])" "$JOBS_DIR/$1/job.json"; }
check() { if [ "$2" = "$3" ]; then echo "  ok    $1"; else echo "  FAIL  $1: wanted $3 got $2"; fail=$((fail+1)); fi; }
settle() { for _ in $(seq 1 50); do [ "$(status "$1")" = "$2" ] && return; sleep 0.1; done; }

FIX="$ROOT/tests/fixtures/machine"
# The reference Mac (10P + 4E, 24 GB), someone at it, on power.
export JOBS_LOAD=1 JOBS_MEMFREE=60 MACHINE_PROFILE="$FIX/reference-14core.json"
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
# The row in the state file is the truth (job.json is its mirror), so the
# test winds the clock back there.
python3 - "$JOBS_DIR/.state.sqlite" "$idl" <<'PY'
import json,sqlite3,sys,time
db=sqlite3.connect(sys.argv[1]); j=json.loads(db.execute("SELECT body FROM jobs WHERE id=?",(sys.argv[2],)).fetchone()[0])
j["turn"]=time.time()-1000; db.execute("UPDATE jobs SET body=? WHERE id=?",(json.dumps(j),sys.argv[2])); db.commit()
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

# --after: the wait lives in the queue. 2026-10-11, two overnight claude -p jobs
# backgrounded their own wait, the session ended with the turn, and they were
# marked done having done nothing.
first=$("$J" submit -- sleep 2 | cut -d' ' -f1)
second=$("$J" submit --after "$first" -- sh -c 'echo after' | cut -d' ' -f1)
check "a job queued --after a running one waits" "$(status "$second")" queued
settle "$first" done
"$J" tick >/dev/null
settle "$second" done
check "and runs once that one has ended" "$(status "$second")" done
dead=$("$J" submit -- sh -c 'exit 3' | cut -d' ' -f1)
settle "$dead" failed
third=$("$J" submit --after "$dead" -- sh -c 'echo ran' | cut -d' ' -f1)
settle "$third" done
check "a failed job still releases what waits on it" "$(status "$third")" done
check "--after an unknown job is refused" "$("$J" submit --after 0000-nope -- true 2>&1 | grep -c 'no job')" 1

# A job writing inside a repo says so, so the write-log never credits its
# files to whatever tab's call is open. 2026-10-12: the creator-transcripts
# job (cwd raw/creators in the brain) put its transcripts on other tabs' calls.
bw="$CHEWBACCA_BACKGROUND_WRITERS"
repo=$(mktemp -d); git -C "$repo" init -q; mkdir -p "$repo/raw/creators"
repo=$(cd "$repo" && pwd -P)
inner=$(cd "$repo/raw/creators" && "$J" submit --net -- sh -c 'echo t > t.md' | cut -d' ' -f1)
settle "$inner" done
check "a net job in a repo's subfolder marks its run there" "$(cut -f1,4 "$bw" 2>/dev/null | tr '\t\n' ' ')" "begin $repo/raw/creators end $repo/raw/creators "
: > "$bw"
build=$(cd "$repo/raw/creators" && "$J" submit --build -- true | cut -d' ' -f1)
settle "$build" done
check "a build there claims nothing on its own" "$(wc -c < "$bw" | tr -d ' ')" 0
top=$(cd "$repo" && "$J" submit -- true | cut -d' ' -f1)
settle "$top" done
check "a job at a repo's top marks nothing on its own" "$(wc -c < "$bw" | tr -d ' ')" 0
named=$(cd "$repo" && "$J" submit --writes "$repo/raw" -- true | cut -d' ' -f1)
settle "$named" done
check "--writes names the folder" "$(cut -f1,4 "$bw" | tr '\t\n' ' ')" "begin $repo/raw end $repo/raw "
: > "$bw"
long=$(cd "$repo/raw/creators" && "$J" submit --net -- sh -c 'trap "echo cleaned > trapped; exit 0" TERM; sleep 30 & wait' | cut -d' ' -f1)
settle "$long" running
for _ in $(seq 1 50); do grep -q begin "$bw" 2>/dev/null && break; sleep 0.1; done
"$J" kill "$long" >/dev/null
for _ in $(seq 1 50); do grep -q end "$bw" 2>/dev/null && break; sleep 0.1; done
check "a killed job still ends its run" "$(cut -f1 "$bw" | tr '\n' ' ')" "begin end "
check "and its own TERM trap still runs" "$(cat "$repo/raw/creators/trapped" 2>/dev/null)" cleaned
rm -rf "$repo"

# The budget is a share of the Mac it runs on (bin/lib/machine_profile.py).
# Before 2026-10-13 the queue used os.cpu_count(), so an 8-core laptop was
# given the room of 8 whole cores and a Mac nobody had touched for hours
# still held heavy work at the present-day limit.
python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); json.dump(dict(r, idle_s=3600), open(sys.argv[2], "w")); json.dump(dict(r, idle_s=3600, on_battery=True), open(sys.argv[3], "w"))' \
  "$FIX/reference-14core.json" "$JOBS_DIR/away.json" "$JOBS_DIR/away-battery.json"
for d in "$JOBS_DIR"/*/; do p=$(python3 -c "import json,sys;j=json.load(open(sys.argv[1]+'job.json'));print(j.get('pid') or '' if j['status'] in ('running','paused') else '')" "$d" 2>/dev/null); [ -n "$p" ] && kill -CONT -"$p" 2>/dev/null; [ -n "$p" ] && kill -TERM -"$p" 2>/dev/null; done
"$J" tick >/dev/null
lap=$(MACHINE_PROFILE="$FIX/laptop-8core.json" JOBS_LOAD=12 "$J" submit --heavy -- sleep 30 | cut -d' ' -f1)
check "8-core laptop: heavy waits at load 12" "$(status "$lap")" queued
"$J" kill "$lap" >/dev/null
aw=$(MACHINE_PROFILE="$JOBS_DIR/away.json" JOBS_LOAD=25 "$J" submit --heavy -- sleep 30 | cut -d' ' -f1)
settle "$aw" running
check "nobody at the Mac: heavy starts at load 25" "$(status "$aw")" running
MACHINE_PROFILE="$JOBS_DIR/away.json" JOBS_LOAD=40 "$J" tick >/dev/null
check "nobody at the Mac: keeps running at load 40" "$(status "$aw")" running
JOBS_LOAD=40 "$J" tick >/dev/null
check "someone comes back at load 40: it pauses" "$(status "$aw")" paused
"$J" kill "$aw" >/dev/null
ab=$(MACHINE_PROFILE="$JOBS_DIR/away-battery.json" JOBS_LOAD=15 "$J" submit --heavy -- sleep 30 | cut -d' ' -f1)
check "on battery, away or not: heavy waits at load 15" "$(status "$ab")" queued
"$J" kill "$ab" >/dev/null

# Break-it, 2026-10-19: `--heavvy` was dropped and the job ran at once as
# light, and killing a finished job rewrote it to killed.
out=$("$J" submit --heavvy -- sleep 3 2>&1); rc=$?
check "a misspelled class flag is refused" "$rc" 1
check "and names the flag" "$(printf '%s' "$out" | grep -c heavvy)" 1
out=$("$J" submit --title -- true 2>&1); rc=$?
check "--title with no value is refused, not a traceback" "$rc$(printf '%s' "$out" | grep -c Traceback)" 10
"$J" kill "$id" >/dev/null 2>&1; rc=$?
check "killing a finished job is refused" "$rc" 1
check "and it stays done" "$(status "$id")" done

# 2026-11-05: a speed job showed running for 8 hours after its output stopped at
# 20 of 1041 rows. The list has to show that, and leave out what's quiet by design.
qdir=$(mktemp -d); touch -t 202601010000 "$qdir/old.jsonl"
qid=$(cd "$qdir" && "$J" submit --heavy -- sleep 30 | cut -d' ' -f1); settle "$qid" running
lid=$(cd "$qdir" && "$J" submit --title server -- sleep 30 | cut -d' ' -f1); settle "$lid" running
sleep 3
check "a batch job with stale output is flagged" "$(JOBS_QUIET_AFTER_S=2 "$J" list | grep "$qid" | grep -c 'QUIET')" 1
check "a light job is never flagged, servers are quiet by design" "$(JOBS_QUIET_AFTER_S=2 "$J" list | grep "$lid" | grep -c 'QUIET')" 0
touch "$qdir/old.jsonl"
check "fresh output clears the flag" "$(JOBS_QUIET_AFTER_S=2 "$J" list | grep "$qid" | grep -c 'QUIET')" 0
rm -rf "$qdir"
check "a deleted cwd doesn't break the list" "$(JOBS_QUIET_AFTER_S=2 "$J" list | grep -c "$qid")" 1
"$J" kill "$qid" >/dev/null; "$J" kill "$lid" >/dev/null
exit "$fail"
