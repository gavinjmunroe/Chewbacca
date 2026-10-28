#!/usr/bin/env bash
# skim-guard refuses "read everything" when the session read a source only in
# part (2026-10-22: two ACAD 185 decks through head -260 and cut -c1-240).
set -uo pipefail
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/skim-guard.sh"
command -v jq >/dev/null 2>&1 || { echo "jq absent, skipping"; exit 0; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export CHEWBACCA_LOG_DIR="$TMP/logs"
fail=0
mkdir -p "$TMP/decks"
seq 1 500 > "$TMP/decks/W9S18 Visual Storytelling 2.txt"
seq 1 40 > "$TMP/decks/short.md"

transcript() {   # one tool_use per argument: "Bash:<command>" or "Read:<path>[:offset:limit]"
  local f="$TMP/t.jsonl"; : > "$f"
  jq -cn '{type:"user",message:{role:"user",content:"ingest all of it"}}' >> "$f"
  for spec in "$@"; do
    local kind="${spec%%:*}" rest="${spec#*:}"
    if [ "$kind" = Bash ]; then
      jq -cn --arg c "$rest" '{type:"assistant",cwd:"/",message:{content:[{type:"tool_use",name:"Bash",input:{command:$c}}]}}' >> "$f"
    else
      IFS=: read -r p off lim <<<"$rest"
      if [ -n "${lim:-}" ]; then
        jq -cn --arg p "$p" --argjson o "$off" --argjson l "$lim" '{type:"assistant",message:{content:[{type:"tool_use",name:"Read",input:{file_path:$p,offset:$o,limit:$l}}]}}' >> "$f"
      else
        jq -cn --arg p "$p" '{type:"assistant",message:{content:[{type:"tool_use",name:"Read",input:{file_path:$p}}]}}' >> "$f"
      fi
    fi
  done
  printf '%s' "$f"
}
probe() {        # name, expected exit, reply, tool specs...
  local name="$1" want="$2" reply="$3"; shift 3
  local t; t=$(transcript "$@")
  jq -cn --arg m "$reply" --arg t "$t" '{last_assistant_message:$m,transcript_path:$t}' \
    | bash "$HOOK" >/dev/null 2>&1
  local got=$?
  if [ "$got" = "$want" ]; then echo "  ok    $name"; else echo "  FAIL  $name: wanted $want got $got"; fail=$((fail+1)); fi
}
D="$TMP/decks"
CLAIM="All 17 decks are ingested, I read every line."
echo "refuses a false all:"
probe "the 2026-10-22 head -260" 2 "$CLAIM" "Bash:cd $D && grep -v x \"W9S18 Visual Storytelling 2.txt\" | cut -c1-240 | head -260"
probe "a Read with a limit" 2 "$CLAIM" "Read:$D/W9S18 Visual Storytelling 2.txt:1:100"
probe "sed chunks that stop short" 2 "$CLAIM" "Bash:sed -n 1,200p $D/short.md" "Bash:sed -n 1,200p \"$D/W9S18 Visual Storytelling 2.txt\""
echo "lets through:"
probe "a later whole read" 0 "$CLAIM" "Bash:head -50 $D/short.md" "Bash:cat $D/short.md"
probe "Read chunks that reach the last line" 0 "$CLAIM" "Read:$D/W9S18 Visual Storytelling 2.txt:1:250" "Read:$D/W9S18 Visual Storytelling 2.txt:251:300"
probe "an honest partial" 0 "13 decks read every line, the other 4 were skimmed." "Bash:head -100 $D/short.md"
probe "no coverage claim" 0 "Here's the first page." "Bash:head -100 $D/short.md"
# 2026-10-28: honest partials in plain words, refused three times.
probe "says it never read one" 0 "Python went through all 164 rows. I never read the CSV row by row." "Bash:head -100 $D/short.md"
probe "names the lines it read" 0 "I read every section, through its first 150 lines." "Bash:head -150 $D/short.md"
probe "its own append, checked" 0 "Read all of it." "Bash:printf x >> $D/short.md && tail -1 $D/short.md"
[ $fail -eq 0 ] && echo "ok: skim-guard"
exit $fail
