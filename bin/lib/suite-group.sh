#!/usr/bin/env bash
# One group of the full suite, run with a deadline.
#
#   suite-group.sh <runner> <outdir> <group>
#
# Runs `bash <runner> <group>` with its output in <outdir>/<group>.log and its
# exit code in <outdir>/<group>.rc, and prints one line when it ends. A group
# still running at the deadline is killed with everything it started, its
# exit code is 124, and its log ends with what was still running and the
# group's last lines, so the run says which group hung and on what.
#
# 2026-10-13: a full suite queued as job 1013-094230-c180 ran 3 h 35 min at
# load 170 with an empty log until someone killed it. Its pytest group had
# printed nothing the whole time (pytest -q writes its verdict at the end, and
# check() holds the output until the command exits), so nothing said which
# group was stuck or that anything was. The next suite job sat queued behind
# it for 3 h 22 min.
set -uo pipefail
runner="$1"; outdir="$2"; group="$3"
# The slowest groups took 170 to 300 s on an unloaded Mac (2026-10-03) and
# hud took 2560 s at load 170 (2026-10-13), so 1200 s is four times the
# slowest normal group. A group past it at load is a result nobody should
# trust anyway (team memory feedback_high_load_reads_as_bugs).
deadline="${CHEWBACCA_SUITE_GROUP_DEADLINE:-1200}"
log="$outdir/$(printf %s "$group" | tr -c 'A-Za-z0-9' _)"
t=$SECONDS

# Every process below <pid>, deepest first, so a child can't be reparented
# out from under the kill.
tree() {
  local kid
  for kid in $(pgrep -P "$1" 2>/dev/null); do tree "$kid"; echo "$kid"; done
}

# Job control gives the group its own process group, so one kill reaches a
# test's children too.
set -m
bash "$runner" "$group" >"$log.log" 2>&1 &
pid=$!
set +m
timed_out=0
while kill -0 "$pid" 2>/dev/null; do
  if [ $((SECONDS - t)) -ge "$deadline" ]; then
    timed_out=1
    kids=$(tree "$pid")
    {
      echo ""
      echo "TIMED OUT: group \"$group\" was still running after ${deadline}s (CHEWBACCA_SUITE_GROUP_DEADLINE) and was killed."
      echo "Still running at the deadline:"
      # shellcheck disable=SC2086
      [ -n "$kids" ] && ps -o pid=,etime=,command= -p $(echo $kids | tr ' ' ',') 2>/dev/null | cut -c1-200 | sed 's/^/  /'
    } >>"$log.log"
    kill -TERM -- "-$pid" 2>/dev/null
    # shellcheck disable=SC2086
    [ -n "$kids" ] && kill -TERM $kids 2>/dev/null
    sleep 2
    kill -KILL -- "-$pid" 2>/dev/null
    # shellcheck disable=SC2086
    [ -n "$kids" ] && kill -KILL $kids 2>/dev/null
    break
  fi
  sleep 1
done
wait "$pid" 2>/dev/null; rc=$?
[ "$timed_out" = 1 ] && rc=124
echo "$rc" >"$log.rc"
if [ "$rc" -eq 0 ]; then mark="ok  "; elif [ "$rc" -eq 124 ]; then mark="HUNG"; else mark="FAIL"; fi
printf "  %s  %-22s %3ss\n" "$mark" "$group" "$((SECONDS - t))"
exit "$rc"
