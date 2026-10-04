#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init repo-overlap-guard.sh 5
# PreToolUse (Edit|Write|MultiEdit|NotebookEdit): tell a session, once, when
# another session has edited the same checkout in the last 15 minutes.
#
# 2026-10-03. Three Claude tabs and Codex worked in the Chewbacca checkout at
# the same time. One rewrote tests/run.sh while another session's run of it
# was reading the file, so bash died on a syntax error that existed in neither
# version. Two pushed to main mid-run and forced two rebases and two retests.
# Nobody in any tab knew the others were there.
#
# It warns rather than refuses: two sessions in one repo is sometimes the
# plan. The fix it points at is a worktree, which is what the tabs that pushed
# cleanly that day had used. Linked worktrees are exempt, being the fix.
set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0

payload="$(cat)"
file="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')"
[ -n "$file" ] || exit 0
session="$(printf '%s' "$payload" | jq -r '.session_id // empty')"
[ -n "$session" ] || exit 0

dir="$(dirname "$file")"
while [ ! -d "$dir" ] && [ "$dir" != "/" ]; do dir="$(dirname "$dir")"; done
repo="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ "$(git -C "$repo" rev-parse --git-dir 2>/dev/null)" = "$(git -C "$repo" rev-parse --git-common-dir 2>/dev/null)" ] || exit 0

# 15 minutes: the overlaps on 2026-10-03 were all inside a few minutes of each
# other's edits. Guessed from that one afternoon, never tuned.
window_minutes=15
state="${CHEWBACCA_HOME:-$HOME/.chewbacca}/state/repo-activity/$(printf '%s' "$repo" | shasum -a 256 | cut -c1-24)"
mkdir -p "$state" 2>/dev/null || exit 0
touch "$state/$session"

warned="$state/.warned-$session"
[ -f "$warned" ] && exit 0
others="$(find "$state" -maxdepth 1 -type f ! -name '.warned-*' ! -name "$session" -mmin -"$window_minutes" 2>/dev/null | wc -l | tr -d ' ')"
[ "$others" -gt 0 ] || exit 0
touch "$warned"

msg="Another session edited $repo in the last $window_minutes minutes ($others other session(s)). Shared checkouts collide: a file can change under a running script, and a bare commit takes the other session's staged work. Do this session's work in its own worktree (git worktree add .worktrees/<slug> -b <branch>), push from there, and commit only named paths."
jq -n --arg m "$msg" '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $m}}'
exit 0
