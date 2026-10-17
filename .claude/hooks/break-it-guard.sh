#!/bin/bash
# Stop hook: a reply that says the work is done gets attacked before it stands.
#
# Caleb, 2026-10-16, 4:47 to 4:49pm: "I need you to see when a session is
# complete, bc often times it is a false positive there's more stuff to do and
# things that were broken that were missed". "When they build something and say
# it's done, chewbs should attack it from every angle trying to break it before
# it concludes anything!!!!!!!!!". "Fix chewbs".
#
# It fires only on a done claim (done, landed, shipped, pushed, complete,
# finished, live, all pass) in the reply or the wrap_up recap, and only when
# this turn wrote files inside a git repository. Then tools/break_it.py stop:
#
#   - a full `chewbacca break-it run` receipt for this exact tree, with every
#     open break named in the reply, lets it stand
#   - otherwise it attacks on the spot: the touched commands fed garbage, a
#     wrong-shaped JSON and a missing path (8 s budget), the added lines grepped
#     for TODO, [NEED, client names and swallowed errors, the files it wrote
#     checked for being uncommitted or not the copy that runs, and each claim
#     in the reply matched to something that ran
#
# Measured on the 2026-10-16 transcripts before it was wired: see
# tests/fixtures/break_it/REPLAY.md for the numbers and the cases.
#
# Exit 2 blocks the turn and hands the reason back. Fires once per turn.

# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init break-it-guard.sh 18

set -uo pipefail

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0
[ "${BREAK_IT_GUARD:-on}" = "off" ] && exit 0

MSG=$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // empty' 2>/dev/null)
[ -n "$MSG" ] || exit 0

PROMPT_ID=$(printf '%s' "$INPUT" | jq -r '.prompt_id // .session_id // "unknown"' 2>/dev/null)
GUARD="${TMPDIR:-/tmp}/break-it-guard-$PROMPT_ID"
[ -f "$GUARD" ] && exit 0

# Found the way vibe-guard finds closeout: setup.sh COPIES this file to
# ~/.claude/hooks, where ../../tools is ~/tools, so the checkout comes from
# d1-config.sh when the relative path misses.
REPO="${CHEWBACCA_REPO_DIR:-}"
if [ -z "$REPO" ] && [ -f "$HOME/.claude/d1-config.sh" ]; then
  REPO="$(. "$HOME/.claude/d1-config.sh" 2>/dev/null; printf '%s' "${CHEWBACCA_REPO_DIR:-}")"
fi
TOOL=""
for c in "$(dirname "${BASH_SOURCE[0]}")/../../tools/break_it.py" \
         ${REPO:+"$REPO/tools/break_it.py"} \
         "$HOME/code/chewbacca/tools/break_it.py"; do
  [ -f "$c" ] && { TOOL="$c"; break; }
done
[ -n "$TOOL" ] || exit 0

OUT=$(printf '%s' "$INPUT" | python3 -I "$TOOL" stop 2>&1)
CODE=$?
[ "$CODE" -eq 2 ] || exit 0
: > "$GUARD"
printf '%s\n' "$OUT" >&2
exit 2
