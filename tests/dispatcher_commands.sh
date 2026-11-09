#!/usr/bin/env bash
# 2026-11-06: c92034be landed a stale bin/chewbacca and dropped 15 commands from
# main, break-it among them, with no failing check. This reads the dispatcher
# and runs only break-it, because --help isn't proven harmless on the others.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
failed=0
for cmd in break-it mcp platforms people-check name-check whoop call-doc photo discovery case-study \
           llms-txt rfp-extract gtme-investors claude-jobs cloud lockdown present recipe; do
  if grep -Eq "(^|\|)$cmd(\||\))" "$ROOT/bin/chewbacca"; then
    echo "ok   chewbacca $cmd has a dispatch line"
  else
    echo "FAIL chewbacca $cmd has no dispatch line"
    failed=1
  fi
done
if bash "$ROOT/bin/chewbacca" break-it --help 2>&1 </dev/null | grep -q "unknown command"; then
  echo "FAIL chewbacca break-it is unknown"
  failed=1
else
  echo "ok   chewbacca break-it runs"
fi
exit "$failed"
