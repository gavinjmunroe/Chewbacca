#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init tab-rescue.sh 5
# UserPromptSubmit: when another tab died on a usage limit, say so in whatever
# tab Caleb talks to next, with a paste prompt per dead tab. Also shuts down
# orphaned iOS simulators in the background.
#
# On 2026-10-10 two Claude Desktop tabs died at 2:47pm on another account's
# weekly limit and nothing said so for an hour. The same afternoon a headless
# simulator nobody was using held about 160 processes at load 37.
#
# Both checks are stamped: the transcript scan at most once a minute, the
# simulator sweep once per 10, so twelve tabs typing cost one scan, not twelve.

set -uo pipefail
cat >/dev/null 2>&1 || true

LOG_DIR="${CHEWBACCA_LOG_DIR:-$HOME/.chewbacca/logs}"
mkdir -p "$LOG_DIR" 2>/dev/null || true
NOW="$(date +%s)"

stamp_due() {  # stamp_due <file> <seconds>
  local last; last="$(cat "$1" 2>/dev/null || echo 0)"
  case "$last" in (*[!0-9]*|"") last=0 ;; esac
  [ $((NOW - last)) -ge "$2" ] || return 1
  echo "$NOW" > "$1"
}

SIM_REAP="${SIM_REAP_BIN:-$(command -v sim-reap 2>/dev/null)}"
if [ -n "$SIM_REAP" ] && stamp_due "$LOG_DIR/.sim-reap-stamp" "${SIM_REAP_INTERVAL:-600}"; then
  ( nice -n 19 python3 -I "$SIM_REAP" >> "$LOG_DIR/sim-reap.log" 2>&1 ) </dev/null >/dev/null 2>&1 &
  disown 2>/dev/null || true
fi

# Every agent CLI and its children at nice 10 so Caleb's apps win the CPU
# (load 37 on 14 cores, 2026-10-10). New tabs start at 0, hence once a minute.
NICER="${AGENT_NICE_BIN:-$(command -v agent-nice 2>/dev/null)}"
if [ -n "$NICER" ] && stamp_due "$LOG_DIR/.agent-nice-stamp" "${AGENT_NICE_INTERVAL:-60}"; then
  ( python3 -I "$NICER" >> "$LOG_DIR/agent-nice.log" 2>&1 ) </dev/null >/dev/null 2>&1 &
  disown 2>/dev/null || true
fi

RESCUE="${TAB_RESCUE_BIN:-$(command -v tab-rescue 2>/dev/null)}"
[ -n "$RESCUE" ] || exit 0
stamp_due "$LOG_DIR/.tab-rescue-stamp" "${TAB_RESCUE_INTERVAL:-60}" || exit 0
python3 -I "$RESCUE" --hours 12 --new --hook --notify 2>>"$LOG_DIR/tab-rescue.log"
exit 0
