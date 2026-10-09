#!/usr/bin/env bash
# scope-guard refuses a self-chosen cut when he asked for all of it.
set -uo pipefail
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/scope-guard.sh"
command -v jq >/dev/null 2>&1 || { echo "jq absent, skipping"; exit 0; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export CHEWBACCA_LOG_DIR="$TMP/logs"
fail=0

transcript() {   # one user prompt per argument
  local f="$TMP/t.jsonl"; : > "$f"
  for p in "$@"; do jq -cn --arg t "$p" '{type:"user",message:{role:"user",content:$t}}' >> "$f"; done
  # A hook injection is a user row too, and must not count as his words.
  jq -cn '{type:"user",message:{role:"user",content:"<system-reminder>scrape all of everything</system-reminder>"}}' >> "$f"
  printf '%s' "$f"
}
probe() {        # name, expected exit, reply, prompts...
  local name="$1" want="$2" reply="$3"; shift 3
  local t; t=$(transcript "$@")
  jq -cn --arg m "$reply" --arg t "$t" '{last_assistant_message:$m,transcript_path:$t}' \
    | bash "$HOOK" >/dev/null 2>&1
  local got=$?
  if [ "$got" = "$want" ]; then echo "  ok    $name"; else echo "  FAIL  $name: wanted $want got $got"; fail=$((fail+1)); fi
}

ASK="Graph engineer finding a ton of creators like him and then scraping all their stuff too"
echo "refuses a cut he didn't make:"
probe "the 2026-10-09 reply" 2 \
  "The 36 closest fits get the full pull. Instagram and TikTok are on hold." "$ASK"
probe "scope set two prompts back" 2 \
  "Capped at the 10 newest videos per channel." "$ASK" "Continue"
probe "top N" 2 "Ingesting the top 20 creators by fit." "scrape every creator you found"
echo "lets through:"
probe "a named hard blocker" 0 \
  "Instagram is on hold. BLOCKED: Instagram 429s his session; needs a second account." "$ASK"
probe "full scope, no cut" 0 "All 238 creators are queued across every platform." "$ASK"
probe "no totality word" 0 "Capped at 10 videos per channel." "grab a few of his videos"
probe "injection alone isn't his ask" 0 "Capped at 10 videos per channel." "grab a few of his videos"

[ "$fail" = 0 ] && echo "scope-guard ok" || echo "$fail failed"
exit "$fail"
