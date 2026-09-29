#!/bin/bash
# slop-guard: format-only flags feed forward, content flags still refuse.
#
# 2026-09-29: a reply with four bold section labels was refused and re-sent
# word for word without the bold. Caleb saw it twice and asked why it was
# repeating itself. A layout-only rewrite is a pure duplicate, so those flags
# now go to voice-remind.sh for the next turn instead of exit 2.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/.claude/hooks/slop-guard.sh"
REMIND="$ROOT/.claude/hooks/voice-remind.sh"
command -v prose-check >/dev/null 2>&1 || [ -x "$ROOT/bin/prose-check" ] || { echo "skip  prose-check missing"; exit 0; }
export PATH="$ROOT/bin:$PATH"

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export CHEWBACCA_HOME="$TMP/home" TMPDIR="$TMP/"
fail=0

run() {  # $1 = reply text, $2 = prompt id
  jq -n --arg m "$1" --arg p "$2" '{last_assistant_message:$m, prompt_id:$p}' \
    | bash "$GUARD" >/dev/null 2>&1
  echo $?
}

BOLD=$'Prayer. Amen.\n\n**One thing**\n\nText here.\n\n**Two thing**\n\nMore text.\n\n**Three thing**\n\nLast text.'
code=$(run "$BOLD" p1)
if [ "$code" = 0 ] && [ -s "$CHEWBACCA_HOME/voice-flags.pending" ]; then
  echo "ok    bold scaffolding does not refuse and is queued for next turn"
else
  echo "FAIL  bold scaffolding: exit $code, pending=$(ls "$CHEWBACCA_HOME" 2>/dev/null)"; fail=1
fi

out=$(bash "$REMIND" </dev/null)
if printf '%s' "$out" | grep -q "bold-scaffolding" && [ ! -e "$CHEWBACCA_HOME/voice-flags.pending" ]; then
  echo "ok    voice-remind shows the flag once and clears it"
else
  echo "FAIL  voice-remind did not surface or clear the pending flag"; fail=1
fi

EM=$'Prayer. Amen.\n\nThis is wrong — very wrong.'
EM=$(printf 'Prayer. Amen.\n\nThis is wrong \xe2\x80\x94 very wrong.')
code=$(run "$EM" p2)
if [ "$code" = 2 ]; then
  echo "ok    an em dash still refuses"
else
  echo "FAIL  em dash exited $code, expected 2"; fail=1
fi
exit $fail
