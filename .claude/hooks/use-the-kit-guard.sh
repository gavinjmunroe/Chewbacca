#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init use-the-kit-guard.sh 5
# PreToolUse on Bash: a hand-rolled pipeline for a job the kit already does
# well is refused with the one command that does it.
#
# 2026-10-11 9:56pm: four briefs to PDF took minutes because a pandoc + Chrome
# --print-to-pdf pipeline waited on a Chrome that never exits after printing.
# The fix for exactly that had shipped the day before inside the GTM report,
# where nobody making a PDF looked. Caleb: "Fix chewb so u never take forever on
# smth that should take 2 seconds". Each row below is a job with a tested
# command; add a row whenever a solved job gets rebuilt by hand.

set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
cmd="$(jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0
# The kit's own tools may use the primitives they wrap.
printf '%s' "$cmd" | grep -qE 'chewbacca-pdf|tests/' && exit 0

refuse() {
  echo "use-the-kit-guard: $1" >&2
  exit 2
}
printf '%s' "$cmd" | grep -qE -- '--print-to-pdf' &&
  refuse "making a PDF by hand. Run: chewbacca pdf <file.md>... [--out <folder>] (about 2 s a file, never waits on Chrome)."
exit 0
