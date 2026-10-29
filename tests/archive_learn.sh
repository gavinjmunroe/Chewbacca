#!/usr/bin/env bash
# archive-learn puts the learn-first closeout in front of any archive ask, and
# stays silent on everything else. The first probe is the 2026-10-29 ask.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/.claude/hooks/archive-learn.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export CHEWBACCA_LOG_DIR="$TMP/logs" HOME="$TMP/home"; mkdir -p "$HOME"
fail=0
probe() { # name, prompt, want (fires|silent)
  out=$(jq -cn --arg p "$2" '{prompt:$p}' | bash "$HOOK" 2>/dev/null)
  if [ "$3" = fires ]; then echo "$out" | grep -q "LEARN FIRST" && echo "  ok    $1" || { echo "  FAIL  $1"; fail=$((fail+1)); }
  else [ -z "$out" ] && echo "  ok    $1" || { echo "  FAIL  $1: $out"; fail=$((fail+1)); }; fi
}
probe "the 2026-10-29 ask" "Can I archive this tab and the 3 other child tabs?" fires
probe "ready to archive" "Ready to archive now" fires
probe "close these tabs" "ok close these tabs" fires
probe "safe to close" "is it safe to close?" fires
probe "plain work stays silent" "fix the css on the site" silent
probe "an email archive folder is not a tab" "move that email out of the inbox" silent
[ "$fail" = 0 ] && echo "archive-learn ok" || exit 1
