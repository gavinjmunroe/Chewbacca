#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init voice-remind.sh 5
# UserPromptSubmit: say what slop-guard checks for BEFORE the reply is written.
#
# slop-guard is a Stop hook, and a Stop hook can only act once the reply is
# already on screen. When it refuses, the rewrite lands under the refused copy,
# so Caleb reads the same answer twice. prayer-remind.sh fixed that for the
# prayer by moving the rule to the start of the turn. This does the same for
# the writing rules, which caused the other half of the duplicates.
#
# 2026-09-29: a reply opened four sections with bold labels. It was refused and
# re-sent word for word without the bold, and he wrote back "Ur back to
# repeating yourself???". A memory note from 9/28 already said to run
# prose-check on long drafts first. It was loaded that session and nothing
# made it happen, so this is the version that doesn't depend on remembering.
#
# It also hands over what slop-guard caught on the previous reply. Format-only
# flags don't refuse any more (see slop-guard.sh), so this is where they reach
# the model, one turn later and before the next reply rather than after it.
set -uo pipefail

STATE="${CHEWBACCA_HOME:-$HOME/.chewbacca}"
PENDING="$STATE/voice-flags.pending"

cat <<'EOF'
Chat register, checked by slop-guard when the reply ends. Get it right the
first time: a refused reply is re-sent, and Caleb sees both copies.
- No bold labels opening paragraphs or sections, no markdown headers, no
  tables. Plain sentences, and "-" lists only where there's a real list.
- No em dashes, no "it's not X, it's Y", no recap ending, no offer of next
  steps unless it's a real fork. Contractions, not "do not" / "it is".
EOF

if [ -s "$PENDING" ]; then
  echo
  echo "Your LAST reply was flagged for this. Don't repeat it:"
  head -12 "$PENDING"
  rm -f "$PENDING"
fi
exit 0
