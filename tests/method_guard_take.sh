#!/bin/bash
# method-guard puts the take and falsifier note in front of the model on every
# prompt and matches none of his words. Whether the model reads takes right is
# measured in tests/eval_intent_notes.py.
#
# Caleb, 2026-11-03: "Fix chewbs to not assume my takes to be always correct! Same
# goes for anyone - ai is too much of a yes man by default".
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
H="$ROOT/.claude/hooks/method-guard.sh"
fail=0
run() { jq -n --arg p "$1" --arg s "take-test-$RANDOM$RANDOM" '{prompt: $p, session_id: $s}' | bash "$H" \
  | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null; }
for p in "I think it should totally be free and we just charge a fee" "ok" "Dad put 400 in my account btw"; do
  out=$(run "$p")
  case "$out" in *"carries a take"*) ;; *) echo "FAIL: no note on: $p"; fail=1 ;; esac
  case "$out" in *"wrong approach"*) ;; *) echo "FAIL: no falsifier on: $p"; fail=1 ;; esac
done
if grep -qE 'grep -E|method" pick|TAKE_RX' "$H"; then echo "FAIL: hook still matches words"; fail=1; fi
[ "$fail" = 0 ] && echo "ok: method-guard notes takes and falsifiers and matches no words"
exit "$fail"
