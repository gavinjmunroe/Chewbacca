#!/bin/bash
# chat-approval.sh: Caleb's reply to an explicit "Clay go-ahead:" ask approves
# it; a no revokes; nothing approves without an ask. The two phrase-list
# versions missed "DO IT BRUH" and a two-line "Do it ..." on 2026-10-10.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
H="$ROOT/.claude/hooks/chat-approval.sh"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
fail=0
rec="$T/clay-chat-approval.json"
tr="$T/transcript.jsonl"

transcript() { # $1 = the agent's last reply text
  python3 -c 'import json,sys
print(json.dumps({"type":"user","message":{"content":"earlier ask"}}))
print(json.dumps({"type":"assistant","message":{"content":[{"type":"text","text":sys.argv[1]}]}}))' "$1" > "$tr"
}
say() {
  python3 -c 'import json,sys; print(json.dumps({"prompt":sys.argv[1],"session_id":"s1","transcript_path":sys.argv[2]}))' "$1" "$tr" |
    CHEWBACCA_STATE_DIR="$T" bash "$H"
}
expect() { # $1 agent reply, $2 his prompt, $3 yes|no
  rm -f "$rec"; transcript "$1"; say "$2"
  if [ -f "$rec" ]; then got=yes; else got=no; fi
  if [ "$got" = "$3" ]; then echo "ok    $3: $2"; else echo "FAIL  want $3 got $got: $2"; fail=1; fi
}
ASK=$'Ready to build Monday.\nClay go-ahead: verify 1,119 leads, build 8 campaigns, Start after the gate passes.'

expect "$ASK" "Do it

Also bruh brute forcing chewbs word is smth we agreed on not doing, right?" yes
expect "$ASK" "DO IT BRUH" yes
expect "$ASK" "ya go" yes
expect "$ASK" "don't send yet" no
expect "$ASK" "wait" no
expect "Fixed the CSS." "do it yourself" no
expect "Here are the numbers." "DO IT BRUH" no

# The harness may log this prompt before the hook runs; it is not an earlier turn.
transcript "$ASK"; printf '%s\n' '{"type":"user","message":{"content":"go"}}' >> "$tr"; rm -f "$rec"; say "go"
if [ -f "$rec" ]; then echo "ok    the prompt already in the transcript still answers the ask"; else echo "FAIL  the logged prompt hid the ask"; fail=1; fi
transcript "$ASK"; say "go"; say "hold off"
if [ -f "$rec" ]; then echo "FAIL  'hold off' left the approval standing"; fail=1; else echo "ok    'hold off' revokes"; fi
exit $fail
