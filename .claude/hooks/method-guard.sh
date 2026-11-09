#!/bin/bash
# UserPromptSubmit: name the process and the falsifier BEFORE the work starts.
#
# THE FAILURE THIS EXISTS FOR. Caleb, 2026-09-20: "Make chewbacca always ask
# creative high leverage outside of the box questions to itself before it
# builds anything... I should never have to prompt engineer ever again."
#
# The obvious build is a skill file full of good questions. That fails, and
# this repo has proven it repeatedly: voice.md loaded into every session and
# was obeyed by nothing until a hook started refusing replies;
# research-the-craft was a rule that did nothing until craft-gate could exit 1.
# Text that is retrieved does not fire. Text that is INJECTED does.
#
# WHY IT ASKS FOR ONE THING. A checklist makes the performance of thinking
# cheaper, not rarer. So this demands the single answer that cannot be faked
# by answering in a friendly tone: what result would show this was wrong.
# A falsifier is a prediction, so it is either stated and tested or it is not.
#
# WHAT IT CANNOT DO, stated because the limit is real: a hook can verify a
# falsifier was WRITTEN, never that it was believed or that the work tested
# it. This raises the cost of skipping the step. It does not do the thinking.
#
# It used to stay silent unless a word list saw build intent, on the theory that
# an injection firing every turn gets skipped. Kept short for that reason. If the
# model starts ignoring it, that shows in the eval, not in a wider word list.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init method-guard.sh 5
set -uo pipefail

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0
PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // empty')
[ -n "$PROMPT" ] || exit 0

# A TAKE is a strategy, design or pricing opinion, not a fact about his own life.
# Caleb, 2026-11-03, after an agent reordered a whole outbound wave on one passing
# line ("some churches we might wanna wait til we hv more ... credibility") and he
# then wrote "Bro don't take my word as Bible maybe that isn't the best strat!"
# and "Fix chewbs to not assume my takes to be always correct! Same goes for
# anyone - ai is too much of a yes man by default". Facts about his life, people
# and numbers still win over notes (context-discipline).
#
# This used to be a phrase list plus bin/method's word classifier. On 2026-11-05
# the classifier called a sweep of the kit's hooks "debug" because it said "wrong"
# somewhere. Caleb that day: "its llm and jev powered not if statement powered".
# The model reading the prompt judges both now. Scores against the old regex on
# the same phrasings: tests/eval_intent_notes.py.
NOTE="If his message carries a take in any wording (a strategy, design, pricing or priority opinion, his or anyone's), it's a hypothesis: your first words, before any tool, are your own read and what would settle it. A fact about his own life, people or numbers isn't a take, he's right on those. Before real work, pick the process that fits (debug, experiment, research, creative, decision, build), read \`method <name>\`, and say in one sentence what result would prove this the wrong approach."

# The sharpest question bank this kit has is its own history. 53 commits
# describe a failure somebody actually made here, and nothing ever read them.
# Once per session: the same scars on every turn is noise. A local search of
# commit messages, so it guesses nothing about what he means.
SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // "unknown"')
SEEN="${TMPDIR:-/tmp}/method-guard-$SESSION-scars"
SCARS_BIN=$(command -v scars || echo "$HOME/.local/bin/scars")
if [ ! -f "$SEEN" ] && [ -x "$SCARS_BIN" ] && [ "$(printf '%s' "$PROMPT" | wc -w | tr -d ' ')" -ge 6 ]; then
  : > "$SEEN"
  SCARS=$("$SCARS_BIN" find "$PROMPT" --terse -n 2 2>/dev/null) || SCARS=""
  [ -n "$SCARS" ] && NOTE="$NOTE"$'\n\n'"$SCARS"
fi

jq -n --arg t "$NOTE" '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $t}}' 2>/dev/null
exit 0
