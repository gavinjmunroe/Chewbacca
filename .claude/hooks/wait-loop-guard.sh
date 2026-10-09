#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init wait-loop-guard.sh 5
# PreToolUse on Bash: refuse a polling loop that has no way to stop.
#
# Written 2026-10-09. A deploy wait, `until <railway check> && [ "$t" \> "01:20" ];
# do sleep 10; done`, hit a zsh parse error on `\>` so its condition could never
# pass. The tool call timed out, got moved to the background, and polled Railway
# every 10 seconds for over an hour after the deploy had finished, until Caleb saw
# a task still running at 3am and asked what it was: "Fix chewb that should never
# happen."
#
# A wait has to end on its own: put a cap in it (`for i in $(seq 1 60); do check
# && break; sleep 10; done`), or use `timeout`. Override for a loop that really
# must run unbounded: WAIT_LOOP_OK='<reason>' in the command.

set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
cmd="$(jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0
case "$cmd" in *WAIT_LOOP_OK=*) exit 0 ;; esac

# An until/while loop whose body sleeps: that's a poll.
printf '%s' "$cmd" | grep -qE '\b(until|while)\b' || exit 0
printf '%s' "$cmd" | grep -qE '\bsleep\b' || exit 0

# Bounded if it counts or is wrapped in a timeout: a seq/for counter, an
# arithmetic or -lt/-le/-gt/-ge comparison on a counter, or `timeout`/`gtimeout`.
if printf '%s' "$cmd" | grep -qE '\bfor [A-Za-z_][A-Za-z0-9_]* in \$\(seq|\(\( *[A-Za-z_]+ *(<|<=|>|>=|\+\+|\+=)|-(lt|le|gt|ge) +[0-9]|\b(g?timeout) +[0-9]|SECONDS *-?(gt|ge|lt|le)?|\$SECONDS'; then
  exit 0
fi

echo "wait-loop-guard: refusing an until/while polling loop with no cap. If its condition can never pass (a typo, a shell parse error, a check against the wrong thing) it polls forever in the background; on 2026-10-09 one hit Railway every 10s for an hour after the deploy finished. Bound it: for i in \$(seq 1 60); do <check> && break; sleep 10; done (this Mac has no timeout command). A loop that truly must be unbounded: add WAIT_LOOP_OK='<reason>' to the command." >&2
exit 2
