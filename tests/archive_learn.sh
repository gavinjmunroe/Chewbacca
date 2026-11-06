#!/usr/bin/env bash
# archive-learn puts the get-it-ready closeout in front of the model on every
# prompt and matches no words. The model reading his message decides. Phrasings
# are from 2026-10-29 and 2026-11-05: "ur an llm not an if statement".
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/.claude/hooks/archive-learn.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export CHEWBACCA_LOG_DIR="$TMP/logs" HOME="$TMP/home"; mkdir -p "$HOME"
fail=0
probe() { # name, prompt
  out=$(jq -cn --arg p "$2" '{prompt:$p}' | bash "$HOOK" 2>/dev/null)
  if echo "$out" | grep -q "get it ready"; then echo "  ok    $1"; else echo "  FAIL  $1"; fail=$((fail+1)); fi
}
probe "the 2026-10-29 ask" "Can I archive this tab and the 3 other child tabs?"
probe "the 2026-11-05 ask" "Ima archive"
probe "no archive word at all" "peace"
probe "plain work still gets the note, the model decides" "fix the css on the site"
if grep -qE 're\.(compile|search|match)|grep ' "$HOOK"; then echo "  FAIL  hook matches words"; fail=$((fail+1)); else echo "  ok    no word matching"; fi
if grep -q "KEEP THE CHILDREN" "$ROOT/.claude/rules/do-it-yourself.md"; then echo "  ok    rule names the child-session check"; else echo "  FAIL  child-session check"; fail=$((fail+1)); fi
[ "$fail" = 0 ] && echo "archive-learn ok" || exit 1
