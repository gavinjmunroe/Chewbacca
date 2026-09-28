#!/bin/bash
# handoff-guard must refuse a reply that hands Caleb a command to run, and must
# stay out of the way when the reply runs it, or when he ASKED for something
# runnable.
#
# Why the third case exists: the guard delegates to bin/handoff-check with the
# user's own text, because "give me a prompt to paste in the other tab" makes
# handing one over the correct answer rather than the failure. A guard without
# that escape fires on the one reply that was right.
#
# This file exists because guard_two_sided.sh found handoff-guard could refuse
# and had no test at all, and that finding was itself hidden: tests/run.sh had
# a malformed line that ran the description as a filename instead of calling
# guard_two_sided.sh.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/.claude/hooks/handoff-guard.sh"
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }

command -v jq >/dev/null 2>&1 || { echo "  skip: jq not installed"; exit 0; }
[ -x "$HOOK" ] || { echo "  handoff-guard.sh not executable"; exit 1; }
[ -x "$ROOT/bin/handoff-check" ] || { echo "  skip: bin/handoff-check absent"; exit 0; }

run() {   # reply, user_text, unique prompt id -> prints exit code
  jq -n --arg m "$1" --arg u "$2" --arg p "$3" \
    '{last_assistant_message:$m, user_message:$u, prompt_id:$p}' \
    | bash "$HOOK" >/dev/null 2>&1
  echo $?
}

expect() {  # label, wanted, reply, user_text
  local got; got=$(run "$3" "${4:-}" "hg-$RANDOM-$RANDOM")
  if [ "$got" = "$2" ]; then ok "$1 (exit $got)"; else no "$1: wanted $2 got $got"; fi
}

# These are the detector's real shapes. It is deliberately conservative,
# measured against 1051 real replies, and it refuses on a second-person
# subject or a fenced block introduced as an instruction. Inline commands with
# no instruction frame are NOT matched on purpose, because "run it" and its
# neighbours produced false positives, and a guard that fires on correct
# replies gets switched off within a day.
echo "refuses a command handed over:"
expect "a fenced block introduced as an instruction" 2 \
  'Rebuild to see it:

```bash
cd ~/project && ./install.sh
```'
expect "second person plus an action" 2 \
  "You'll need to brew install jq first."
expect "an explicit instruction frame" 2 \
  'Run this: bin/closeout'

echo "stays silent otherwise:"
expect "a reply that reports a result" 0 \
  'Fixed it. The matcher was comparing a stripped key against a raw name.'
expect "an ordinary answer" 0 \
  'Your three unpushed commits are on feat/chatgpt-runtime.'

echo "permits it when he asked for something runnable:"
expect "he asked for a prompt to paste" 0 \
  'Here is the prompt: cd ~/project && bin/closeout' \
  'just push everything and give me a prompt to paste there'

printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" = 0 ]
