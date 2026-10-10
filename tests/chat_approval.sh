#!/bin/bash
# chat-approval.sh: which of Caleb's prompts approve Clay work, and which revoke.
# The first version (42d642db) approved "run it" and read "don't send it" as a
# yes; both are pinned here.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
H="$ROOT/.claude/hooks/chat-approval.sh"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
fail=0
rec="$T/clay-chat-approval.json"

say() { printf '{"prompt": %s, "session_id": "s1"}' "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1")" |
  CHEWBACCA_STATE_DIR="$T" bash "$H"; }
expect() { # $1 prompt, $2 yes|no
  rm -f "$rec"
  say "$1"
  if [ -f "$rec" ]; then got=yes; else got=no; fi
  if [ "$got" = "$2" ]; then echo "ok    $2: $1"; else echo "FAIL  want $2 got $got: $1"; fail=1; fi
}

expect "Bro fuck the guard fix chewbs do it urself" yes
expect "do it yourself" yes
expect "you have my ok, launch the campaigns" yes
expect "DO IT BRUH" yes
expect "do it" yes
expect "do it and fix the tests" no
expect "run it again" no
expect "start them up and run the tests" no
expect "send it to Sagar" no
expect "don't send it" no
expect "do it yourself but don't launch yet" no
expect "what's due this week" no

# A revoke deletes a standing approval.
say "do it yourself"
say "wait, hold off"
if [ -f "$rec" ]; then echo "FAIL  'hold off' left the approval standing"; fail=1; else echo "ok    'hold off' revokes"; fi
exit $fail
