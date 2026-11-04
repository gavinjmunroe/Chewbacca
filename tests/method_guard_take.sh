#!/bin/bash
# method-guard flags a take so the agent gives its own read before building on it.
#
# Caleb, 2026-11-03: "Fix chewbs to not assume my takes to be always correct! Same
# goes for anyone - ai is too much of a yes man by default", after an agent
# reordered an outbound wave on one passing line of his and he had to say "Bro
# don't take my word as Bible maybe that isn't the best strat!".
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
H="$ROOT/.claude/hooks/method-guard.sh"
fail=0
run() { jq -n --arg p "$1" --arg s "take-test-$RANDOM$RANDOM" '{prompt: $p, session_id: $s}' | bash "$H" \
  | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null; }
for p in "I think it should totally be free and we just charge a fee" \
         "We gotta be strategic, wait on the bigger churches" \
         "maybe we hold the big ones" \
         "what's the best strat here"; do
  out=$(run "$p")
  case "$out" in *"carries a take"*) ;; *) echo "FAIL: no take flag for: $p"; fail=1 ;; esac
done
for p in "ok" "Fix the typo in the readme heading" "Dad put 400 in my account btw"; do
  out=$(run "$p")
  case "$out" in *"carries a take"*) echo "FAIL: take flag on a non-take: $p"; fail=1 ;; esac
done
[ "$fail" = 0 ] && echo "ok: method-guard flags takes and leaves facts and acks alone"
exit "$fail"
