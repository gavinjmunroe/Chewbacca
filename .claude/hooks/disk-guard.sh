#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init disk-guard.sh 5
# UserPromptSubmit: when the data volume runs low, clear the caches that
# rebuild themselves, in the background, before anything starts failing.
#
# The disk filled three times on 2026-10-09 with a dozen tabs running. The
# third time it had 238 MB left and the Bash tool itself could not start,
# because every command writes its output to a file first: the agent was
# locked out of the shell it needed to clean up. Each time somebody cleared
# the same caches by hand (reference_disk_full_cleanup in team memory), and
# uv's cache had grown back to 6 GB within the hour.
#
# So this checks free space on every prompt (one df, a few ms) and, below
# DISK_LOW_GB, starts one detached prune of the safe list. Only regenerable
# caches: never Messages, the iMovie library, Downloads or the Trash, which are
# the user's. A lock keeps twelve tabs from pruning at once, and a stamp keeps
# it to once per 10 minutes.

set -uo pipefail
cat >/dev/null 2>&1 || true

LOG_DIR="${CHEWBACCA_LOG_DIR:-$HOME/.chewbacca/logs}"
mkdir -p "$LOG_DIR" 2>/dev/null || true
LOG="$LOG_DIR/disk-guard.log"

# 20 GB: at about 3 GB an hour of growth seen that night, it leaves several
# hours before tools start failing. 5 GB is where the agent should stop and
# say so rather than start anything large.
LOW_GB="${DISK_LOW_GB:-20}"
CRIT_GB="${DISK_CRIT_GB:-5}"

if [ -n "${CHEWBACCA_DISK_FREE_KB:-}" ]; then
  FREE_KB="$CHEWBACCA_DISK_FREE_KB"
else
  VOL=/System/Volumes/Data; [ -d "$VOL" ] || VOL=/
  FREE_KB="$(df -k "$VOL" 2>/dev/null | awk 'NR==2 {print $4}')"
fi
case "$FREE_KB" in (""|*[!0-9]*) exit 0 ;; esac
FREE_GB=$((FREE_KB / 1048576))
[ "$FREE_GB" -lt "$LOW_GB" ] || exit 0

STAMP="$LOG_DIR/.disk-guard-stamp"
NOW="$(date +%s)"
LAST="$(cat "$STAMP" 2>/dev/null || echo 0)"
case "$LAST" in (*[!0-9]*|"") LAST=0 ;; esac
STARTED=""
if [ $((NOW - LAST)) -ge "${DISK_PRUNE_INTERVAL:-600}" ] && mkdir "$LOG_DIR/.disk-guard-lock" 2>/dev/null; then
  echo "$NOW" > "$STAMP"
  PRUNE="${CHEWBACCA_DISK_PRUNE_CMD:-}"
  if [ -z "$PRUNE" ]; then
    # The documented safe list. uv needs --force or it waits forever on another
    # tab's lock (it hung 10 minutes once).
    PRUNE='command -v uv >/dev/null && uv cache prune --force;
      rm -rf "$HOME/Library/Caches/pip";
      command -v brew >/dev/null && brew cleanup -s --prune=all;
      command -v npm >/dev/null && npm cache clean --force;
      command -v pnpm >/dev/null && pnpm store prune;
      true'
  fi
  ( trap 'rmdir "$LOG_DIR/.disk-guard-lock" 2>/dev/null' EXIT
    echo "$(date -u +%FT%TZ) ${FREE_GB} GB free, pruning" >> "$LOG"
    nice -n 19 bash -c "$PRUNE" >> "$LOG" 2>&1
    echo "$(date -u +%FT%TZ) pruned" >> "$LOG" ) </dev/null >/dev/null 2>&1 &
  disown 2>/dev/null || true
  STARTED=1
fi

MSG="Disk is low: ${FREE_GB} GB free on this Mac."
[ -n "$STARTED" ] && MSG="$MSG Clearing regenerable caches (uv, pip, brew, npm) in the background now."
if [ "$FREE_GB" -lt "$CRIT_GB" ]; then
  MSG="$MSG Below ${CRIT_GB} GB: don't start downloads, renders or large builds until it recovers. Messages, iMovie, Downloads and the Trash are the user's to clear, never yours."
fi
MSG="$MSG" python3 -I -c '
import json, os
print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit",
      "additionalContext": os.environ["MSG"]}}))'
exit 0
