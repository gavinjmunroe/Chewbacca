#!/usr/bin/env bash
# text-group refuses bad recipients before it touches Messages. The send itself needs a real Mac and
# real people, so this only covers the arguments; TEXT_GROUP_VALIDATE_ONLY stops before Messages.
set -uo pipefail
export CHEWBACCA_NO_SEND=1 TEXT_GROUP_VALIDATE_ONLY=1
T="${1:?path to bin/text-group}"
fail=0
refuses() { if "$T" "$@" >/dev/null 2>&1; then echo "FAIL: accepted: $*"; fail=1; fi; }
accepts() { if ! "$T" "$@" >/dev/null 2>&1; then echo "FAIL: refused: $*"; fail=1; fi; }

refuses
refuses "+15551234567" "one person is not a group"
refuses "+15551234567,+15557654321" ""
refuses "John,+15557654321" "a name is not a number"
refuses "+15551234567,+15557654321&body=x" "no smuggling into the url"
accepts "+15551234567,+15557654321" "hi"
accepts --check "+15551234567,+15557654321,+15550001111" "hi"
[ "$fail" -eq 0 ] && echo "text_group: ok"
exit "$fail"
