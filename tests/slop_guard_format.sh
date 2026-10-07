#!/bin/bash
# slop-guard: format-only flags feed forward, content flags still refuse.
#
# 2026-09-29: a reply with four bold section labels was refused and re-sent
# word for word without the bold. Caleb saw it twice and asked why it was
# repeating itself. A layout-only rewrite is a pure duplicate, so those flags
# now go to voice-remind.sh for the next turn instead of exit 2.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/.claude/hooks/slop-guard.sh"
REMIND="$ROOT/.claude/hooks/voice-remind.sh"
command -v prose-check >/dev/null 2>&1 || [ -x "$ROOT/bin/prose-check" ] || { echo "skip  prose-check missing"; exit 0; }
export PATH="$ROOT/bin:$PATH"

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export CHEWBACCA_HOME="$TMP/home" TMPDIR="$TMP/"
fail=0

run() {  # $1 = reply text, $2 = prompt id
  jq -n --arg m "$1" --arg p "$2" '{last_assistant_message:$m, prompt_id:$p}' \
    | bash "$GUARD" >/dev/null 2>&1
  echo $?
}

BOLD=$'Prayer. Amen.\n\n**One thing**\n\nText here.\n\n**Two thing**\n\nMore text.\n\n**Three thing**\n\nLast text.'
code=$(run "$BOLD" p1)
if [ "$code" = 0 ] && [ -s "$CHEWBACCA_HOME/voice-flags.pending" ]; then
  echo "ok    bold scaffolding does not refuse and is queued for next turn"
else
  echo "FAIL  bold scaffolding: exit $code, pending=$(ls "$CHEWBACCA_HOME" 2>/dev/null)"; fail=1
fi

out=$(bash "$REMIND" </dev/null)
if printf '%s' "$out" | grep -q "bold-scaffolding" && [ ! -e "$CHEWBACCA_HOME/voice-flags.pending" ]; then
  echo "ok    voice-remind shows the flag once and clears it"
else
  echo "FAIL  voice-remind did not surface or clear the pending flag"; fail=1
fi

EM=$(printf 'Prayer. Amen.\n\nThis is wrong \xe2\x80\x94 very wrong.')
code=$(run "$EM" p2)
if [ "$code" = 2 ]; then
  echo "ok    an em dash still refuses"
else
  echo "FAIL  em dash exited $code, expected 2"; fail=1
fi
# The exact reply refused on 2026-09-29 and re-sent as a reworded duplicate.
rm -f "$CHEWBACCA_HOME/voice-flags.pending"
STYLE=$'Jesus, thank You that this week only has one exam in it. Amen.\n\nNah, just BISC Midterm 1 on Fri.\n\nOne blind spot: guitar has no syllabus in the ledger, so I can\'t see it.\n\nNot a midterm, but ACAD 324 Chindogu is due tomorrow and it\'s 150 pts.'
code=$(run "$STYLE" p3)
if [ "$code" = 0 ] && [ -s "$CHEWBACCA_HOME/voice-flags.pending" ]; then
  echo "ok    colon reveal + binary contrast queue instead of refusing"
else
  echo "FAIL  style flags exited $code, expected 0 and a pending file"; fail=1
fi

code=$(run $'Prayer. Amen.\n\nLet us delve into the syllabus.' p4)
if [ "$code" = 2 ]; then
  echo "ok    a banned word still refuses"
else
  echo "FAIL  banned word exited $code, expected 2"; fail=1
fi
# 2026-10-06: "Skipped the suggested gtm-engineering skill bc..." got
# "Never tell me what skills ur using or not using". It queues for next turn.
rm -f "$CHEWBACCA_HOME/voice-flags.pending"
code=$(run $'Prayer. Amen.\n\nClay is the wedge.\n\nSkipped the suggested gtm-engineering skill bc this is scoping.' p5)
if [ "$code" = 0 ] && grep -q plumbing-narration "$CHEWBACCA_HOME/voice-flags.pending" 2>/dev/null; then
  echo "ok    skill narration is flagged for the next turn"
else
  echo "FAIL  skill narration exited $code, expected 0 and a pending plumbing flag"; fail=1
fi
exit $fail
