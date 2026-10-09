#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init orphan-reap.sh 10
# SessionStart: stop jobs a dead tab left running. 2026-10-10: after Caleb
# force-quit Claude over the lag, a Clay crawler, a headless Nalana render and
# a transcription run kept going with no owner. bin/orphan-reap holds the rule
# and its tests; this only runs it, quietly, every time a tab opens.
command -v orphan-reap >/dev/null 2>&1 || exit 0
found=$(orphan-reap --kill 2>/dev/null | tail -1)
case "$found" in
  0\ *|"") ;;
  *) echo "Stopped jobs left running by a closed tab: ${found}." ;;
esac
exit 0
