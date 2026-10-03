#!/usr/bin/env bash
# The stale-read guard must REFUSE a reply calling a command silent or empty
# while background jobs of the session have not reported completion, and must
# stay silent on honest bad news.
#
# 2026-09-26: closeout was called "dying silently" after four reads of a
# zero-byte output file. It was buffering every print until the end of a twenty
# minute run. A wrong diagnosis reached the user as an instruction to go change
# working code, which is the cost this test exists to keep paid once.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/.claude/hooks/stale-read-guard.sh"
[ -x "$HOOK" ] || { echo "stale-read-guard.sh not executable"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq absent, skipping"; exit 0; }

T=$(mktemp)
# three jobs launched, one reported: two still outstanding
printf '{"run_in_background": true}\n{"run_in_background": true}\n{"run_in_background": true}\n<task-notification>\n' > "$T"
trap 'rm -f "$T"' EXIT

fail=0
probe() {                     # name, message, expected exit
  local out code
  out=$(jq -Rn --arg m "$2" --arg t "$T" \
        '{last_assistant_message:$m, transcript_path:$t}' | "$HOOK" 2>&1)
  code=$?
  if [ "$code" = "$3" ]; then
    printf '  ok    %s (exit %s)\n' "$1" "$code"
  else
    printf '  FAIL  %s: wanted exit %s got %s\n' "$1" "$3" "$code"
    printf '%s\n' "$out" | head -3 | sed 's/^/        /'
    fail=$((fail + 1))
  fi
}

echo "refuses a silence claim while jobs are outstanding:"
probe "the literal 9/26 claim" \
      "closeout produced no output and the process is gone, so it is dying silently." 2
probe "zero bytes"          "The output file was empty, zero bytes." 2
probe "printed nothing"     "It ran and printed nothing at all." 2

echo "stays silent when the reply is honest:"
probe "says it is unfinished" "closeout has not finished yet, so the file is still empty." 0
probe "ordinary failure"      "The tests failed with three named errors." 0
probe "unrelated"             "Pushed everything, the repo is clean." 0

# With nothing outstanding the claim is answerable, so it must pass.
printf '{"run_in_background": true}\n<task-notification>\n' > "$T"
echo "stays silent once every job has reported:"
probe "all jobs reported"     "closeout produced no output and exited 144." 0

[ "$fail" = 0 ] || exit 1
echo "stale-read guard: all probes passed."
