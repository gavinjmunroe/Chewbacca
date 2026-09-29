#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init slop-guard.sh 10
# Stop hook: read back what Claude just wrote and refuse the turn if it is slop.
#
# The house writing rules already live in CLAUDE.md, and CLAUDE.md is a user
# message that competes with everything else in a long session. By hour three
# the bolded drama beats and colon reveals come back. A rule that depends on
# remembering is a rule that decays, so this checks the actual output instead.
#
# slop-check is deterministic and calls no model, so this costs nothing per turn.
# It scores only the structural tells the house rules ban: em dashes, emoji,
# bolded fragments used as headers, colon reveals, binary contrasts,
# throat-clearing, recap endings, banned words.
#
# Fires at most once per turn. If the rewrite is still flagged, that is a
# judgment call for the human, not grounds for an infinite loop.
set -uo pipefail

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0

MSG=$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // empty')
[ -n "$MSG" ] || exit 0

PROMPT_ID=$(printf '%s' "$INPUT" | jq -r '.prompt_id // .session_id // "unknown"')
GUARD="${TMPDIR:-/tmp}/slop-guard-$PROMPT_ID"
[ -f "$GUARD" ] && exit 0

# The two flags a rewrite is worth a duplicate for. See the comment in the
# prose-check block below for why nothing else refuses.
HARD_RE='^(em-dash|banned-word)$'
STATE="${CHEWBACCA_HOME:-$HOME/.chewbacca}"

queue_flags() {  # $1 = detail, $2 = labels
  mkdir -p "$STATE" 2>/dev/null
  printf '%s\n' "$1" >> "$STATE/voice-flags.pending"
  printf '%s\t%s\n' "$(date '+%Y-%m-%d %H:%M')" "$(printf '%s' "$2" | tr '\n' ' ')" \
    >> "$STATE/voice-flags.log"
}

SLOP=$(command -v slop-check || echo "$HOME/.local/bin/slop-check")
[ -x "$SLOP" ] || exit 0

# prose-check runs Caleb's own list (kickers, announced turns, not-X-but-Y,
# dramatic fragments) which slop-check does not know. Added 2026-09-16 after a
# draft passed both ai-scan and slop-check while carrying six kickers.
PROSE=$(command -v prose-check || echo "$HOME/.local/bin/prose-check")
if [ -x "$PROSE" ]; then
  # --chat adds the REGISTER rules: anaphoric triples, bold used as paragraph
  # scaffolding, headers and tables in a reply, reflex next-steps endings, and
  # formal constructions where he runs 74 contractions to 4. It also drops the
  # essay-only rules, because his median sent message is 5 words and stacked
  # short lines are his native register rather than a rhythm trick.
  #
  # Added 2026-09-20. He asked why the guard let "Same brief, same stance,
  # same model" through. It did because slop-check scored that reply 0 and
  # prose-check had no concept of register: voice.md loaded every session and
  # was enforced by nothing.
  #
  # No "# reply" wrapper any more. In chat mode prose-check does not strip to
  # the first header, so a wrapper would trip the chat-header rule on itself.
  TMPMD="${TMPDIR:-/tmp}/slop-guard-reply-$$.md"
  printf '%s\n' "$MSG" > "$TMPMD"
  if ! PROSE_REPORT=$("$PROSE" --chat "$TMPMD" 2>/dev/null); then
    rm -f "$TMPMD"
    PROSE_DETAIL=$(printf '%s' "$PROSE_REPORT" | tail -n +2 | head -20)
    LABELS=$(printf '%s\n' "$PROSE_DETAIL" \
      | sed -nE 's/^ *(L[0-9]+)? +([a-z][a-z-]+) +.*/\2/p' | sort -u)

    # ONLY HARD BANS REFUSE. Everything else feeds forward.
    #
    # A Stop refusal cannot retract anything: the flagged reply is already on
    # Caleb's screen, so exit 2 only adds a second copy under it. 2026-09-29,
    # twice in one day. First, four bold section labels were refused and
    # re-sent word for word without the bold ("Ur back to repeating
    # yourself???"), so format flags stopped refusing. Hours later a four-line
    # reply with one colon reveal and one "Not a midterm, but" was refused,
    # and the rewrite said the same four things with two phrases reworded. He
    # sent a screenshot of both copies and "Bruh". A reworded duplicate costs
    # him more than the colon did.
    #
    # So only an em dash or a banned word, which he has banned outright, still
    # refuses. The rest goes to the pending file, and voice-remind.sh puts it
    # in front of the model at the start of the next turn, before the next
    # reply is composed rather than after it has shipped.
    if [ -n "$LABELS" ] && ! printf '%s\n' "$LABELS" | grep -qE "$HARD_RE"; then
      queue_flags "$PROSE_DETAIL" "$LABELS"
    else
      : > "$GUARD"
      # Exit 2, for the same reason as the slop-check path below: a JSON
      # advisory carrying `continueLoop` is not part of the Stop hook contract,
      # so the harness ignored it and the reply shipped. This was the FIRST of
      # the two exits and it is the one that was actually being taken, which is
      # why fixing the second one alone changed nothing.
      {
        echo "prose-check flagged your reply against Caleb's own rules:"
        printf '%s\n' "$PROSE_DETAIL"
        echo
        echo "Rewrite the reply plainly. Do not explain the rewrite, do not"
        echo "apologise, and do not mention this check."
      } >&2
      exit 2
    fi
  else
    rm -f "$TMPMD"
  fi
fi

MAX="${SLOP_CHECK_MAX:-10}"
REPORT=$(printf '%s' "$MSG" | "$SLOP" --stdin --chat --issues 2>/dev/null)
SCORE=$(printf '%s' "$REPORT" | awk 'NR==1{print $1}')
[ -n "$SCORE" ] || exit 0
[ "$SCORE" -le "$MAX" ] 2>/dev/null && exit 0

: > "$GUARD"

DETAIL=$(printf '%s' "$REPORT" | tail -n +2 | head -20)
SLOP_LABELS=$(printf '%s\n' "$DETAIL" \
  | sed -nE 's/^ *L[0-9]+ +([a-z][a-z-]+):.*/\1/p' | sort -u)
if [ -n "$SLOP_LABELS" ] && ! printf '%s\n' "$SLOP_LABELS" | grep -qE "$HARD_RE"; then
  queue_flags "$DETAIL" "$SLOP_LABELS"
  exit 0
fi

# EXIT 2, NOT A JSON ADVISORY. This used to print
# hookSpecificOutput.continueLoop and exit 0, and exit 2 was only the
# fallback for when jq itself failed. `continueLoop` is not part of the Stop
# hook contract, so the harness ignored the whole object and the reply went
# out unchanged. The guard fired on every one of them and changed nothing.
#
# Measured 2026-09-21 on twelve consecutive replies in one session: they
# scored 40, 100, 40, 40, 40, 40, 40, 40, 100, 40, 100, 0 against a limit of
# 10, and one of them opened with an em dash, which is banned outright.
# Caleb: "why'd chewbacca stop talking like me the ai slop is back bruh".
#
# Exit 2 is what stops a turn and hands the text back. It is the same
# mechanism handoff-guard uses. The once-per-prompt guard file above means
# this can refuse at most one rewrite, so it cannot loop.
{
  echo "Your reply scored $SCORE on slop-check, and the limit is $MAX."
  printf '%s\n' "$DETAIL"
  echo
  echo "Rewrite the reply itself, plainly. Say the same things with the drama"
  echo "removed: no em dashes, no bolded fragments used as headers, no colon"
  echo "reveals, no recap ending. Do not explain the rewrite, do not apologise"
  echo "for it, and do not mention this check."
} >&2
exit 2
