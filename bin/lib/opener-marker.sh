#!/bin/bash
# Decides whether prayer-guard.sh and prayer-remind.sh are live, by writing or
# removing ~/.chewbacca/opener-marker. setup.sh calls it on every run.
#
#   opener-marker.sh [path to CLAUDE.md]    prints on, off or unchanged
#
# On when the CLAUDE.md asks for a prayer ending in Amen. Off for good when
# ~/.chewbacca/opener-off exists, whatever the CLAUDE.md says. The installed
# CLAUDE.md carries the author's own prayer section in its standards region, so
# the CLAUDE.md test alone matched on installs whose owner never asked for an
# opener. On 2026-11-09 Gavin had four replies in one turn refused until each
# opened with a prayer, and deleting the marker only lasted until the next
# setup, which rewrote it.
set -u

home="${CHEWBACCA_HOME:-$HOME/.chewbacca}"
claude_md="${1:-$HOME/.claude/CLAUDE.md}"

if [ -e "$home/opener-off" ]; then
  rm -f "$home/opener-marker"
  echo off
elif grep -qiE "prayer|pray" "$claude_md" 2>/dev/null && grep -q "Amen" "$claude_md" 2>/dev/null; then
  mkdir -p "$home"
  echo "Amen" > "$home/opener-marker"
  echo on
else
  echo unchanged
fi
