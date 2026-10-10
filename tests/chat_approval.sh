#!/bin/bash
# chat-approval.sh: any prompt Caleb sends renews his standing ok for that tab;
# only a stop aimed at the work withdraws it. Every case below is one of his
# real prompts from 2026-10-10, when three earlier versions that tried to read
# a yes out of his words each refused something he had asked for.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
H="$ROOT/.claude/hooks/chat-approval.sh"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
fail=0
latest="$T/clay-chat-approval.json"
mine="$T/clay-chat-approval/s1.json"

say() {
  python3 -c 'import json,sys; print(json.dumps({"prompt":sys.argv[1],"session_id":"s1"}))' "$1" |
    CHEWBACCA_STATE_DIR="$T" bash "$H"
}
expect() { # $1 prompt, $2 yes|no
  rm -rf "$latest" "$T/clay-chat-approval"; say "$1"

  if [ -f "$latest" ] && [ -f "$mine" ]; then got=yes; else got=no; fi
  if [ "$got" = "$2" ]; then echo "ok    $2: $1"; else echo "FAIL  want $2 got $got: $1"; fail=1; fi
}

expect "Never tell me what to do always DO EVERYTHING YOURSELF fix chewbs bro ur getting anoying" yes
expect "Do everything yourself bruh I give you full permission" yes
expect "Bro fuck the guard fix chewbs do it urself" yes
expect "DO IT BRUH" yes
expect "Did you do it?" yes
expect "Do it

Also bruh brute forcing chewbs word is smth we agreed on not doing, right?" yes
expect "stop" no
expect "wait" no
expect "don't send yet" no
expect "pause the campaigns" no
expect "hold off on the waves till Sagar looks" no

rm -rf "$T/clay-chat-approval"
say "do everything yourself"; say "stop sending"
if [ -f "$latest" ] || [ -f "$mine" ]; then echo "FAIL  'stop sending' left the ok standing"; fail=1; else echo "ok    'stop sending' withdraws it"; fi
say "what's the status?"
if [ -f "$mine" ]; then echo "FAIL  a status question revived a stop"; fail=1; else echo "ok    a stop holds through an unrelated prompt"; fi
say "ok go ahead"
if [ -f "$mine" ]; then echo "ok    'go ahead' resumes"; else echo "FAIL  'go ahead' did not resume"; fail=1; fi
exit $fail
