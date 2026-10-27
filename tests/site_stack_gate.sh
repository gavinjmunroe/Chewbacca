#!/bin/bash
# site-stack-gate: a landing page written as hand-rolled HTML is refused until
# ux-pick ran and the repo has the house stack or a research receipt; utility
# pages and the finished receipts pass. 2026-10-27: a Kyber landing page went
# out as a Tailwind CDN index.html with the UX engine never run.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
H="$ROOT/.claude/hooks/site-stack-gate.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export CHEWBACCA_HOME="$TMP/home" CHEWBACCA_LOG_DIR="$TMP/logs"
mkdir -p "$CHEWBACCA_HOME/state" "$TMP/repo/.git" "$TMP/repo/public"
fail=0
cdn_page=$(python3 -c 'print("<script src=\"https://cdn.tailwindcss.com\"></script>"); print("<div></div>\n" * 200)')
utility=$(python3 -c 'print("<div class=\"swatch\"></div>\n" * 200)')
: > "$TMP/t.jsonl"
call() { # file content
  jq -n --arg f "$1" --arg c "$2" --arg tp "$TMP/t.jsonl" \
    '{session_id:"s1", tool_name:"Write", transcript_path:$tp, tool_input:{file_path:$f, content:$c}}' | bash "$H"
}
denied() { printf '%s' "$1" | grep -q '"permissionDecision": "deny"'; }

out=$(call "$TMP/repo/public/index.html" "$cdn_page"); rc=$?
if denied "$out" && [ $rc -eq 0 ] && printf '%s' "$out" | grep -q 'ux-pick' \
   && printf '%s' "$out" | grep -q 'site-gate research' && printf '%s' "$out" | grep -q 'lenis'; then
  echo "ok   a Tailwind CDN index.html is refused, exit 0, naming ux-pick, the stack and site-gate research"
else echo "FAIL CDN landing page not refused ($rc): $out"; fail=1; fi

out=$(call "$TMP/repo/taste.html" "$utility")
denied "$out" && { echo "FAIL utility taste.html refused: $out"; fail=1; } || echo "ok   a 200-line taste.html utility page passes"

# The refusal text names ux-pick; that must not count as having run it.
printf '%s\n' "$out" "$(call "$TMP/repo/public/index.html" "$cdn_page")" > "$TMP/t.jsonl"
mkdir -p "$TMP/repo/research"; echo "- home" > "$TMP/repo/research/INDEX.md"
out=$(call "$TMP/repo/public/index.html" "$cdn_page")
denied "$out" && echo "ok   its own refusal text is not a ux-pick run" || { echo "FAIL refusal text counted as a run"; fail=1; }

echo '{"type":"tool_use","name":"Bash","input":{"command":"apps/ux-engine/bin/ux-pick \"phone app landing\""}}' >> "$TMP/t.jsonl"
out=$(call "$TMP/repo/public/index.html" "$cdn_page")
denied "$out" && { echo "FAIL refused after ux-pick + research"; fail=1; } || echo "ok   passes once ux-pick ran and research/INDEX.md exists"

rm -rf "$TMP/repo/research"
out=$(call "$TMP/repo/public/index.html" "$cdn_page")
denied "$out" && echo "ok   ux-pick alone is not enough without the stack" || { echo "FAIL passed without stack"; fail=1; }
echo '{"dependencies":{"next":"15","motion":"12","lenis":"1"}}' > "$TMP/repo/package.json"
out=$(call "$TMP/repo/public/index.html" "$cdn_page")
denied "$out" && { echo "FAIL refused with the house stack"; fail=1; } || echo "ok   passes with the house stack package.json"

grep -q 'site-stack-gate.sh' "$ROOT/setup.sh" && echo "ok   setup registers it" || { echo "FAIL not registered in setup.sh"; fail=1; }
exit $fail
