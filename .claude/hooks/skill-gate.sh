#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init skill-gate.sh 5
# PreToolUse: when skill-route named an ENFORCED skill for this prompt, refuse
# the first tool call that isn't loading it.
#
# skill-route.sh names skills as advice. For graph-engineering that advice was
# skipped on several prompts in one session on 2026-09-29, after the identical
# skip on 2026-09-21, and Caleb had to say it out loud both times. This turns
# the router's line into one refusal: load the skill, or be stopped once.
#
# It refuses ONCE and then clears the marker, so a skill that truly doesn't fit
# costs one tool call, never a loop.
set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat)
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' | tr -cd 'A-Za-z0-9_-')
[ -n "$SID" ] || exit 0
STATE="${CHEWBACCA_HOME:-$HOME/.chewbacca}/state"
MARK="$STATE/skill-required-$SID"
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')
# Record every load, marker or not, so skill-route stops gating a skill that
# is already in this session's context.
if [ "$TOOL" = "Skill" ]; then
  ASKED=$(printf '%s' "$INPUT" | jq -r '.tool_input.skill // empty')
  [ -n "$ASKED" ] && mkdir -p "$STATE" && echo "${ASKED##*:}" >> "$STATE/skill-loaded-$SID"
fi

# BEHAVIOR backstop: the prompt classifier misses some big work (2026-10-06,
# 3 of 15 labeled big prompts slipped under Jev's cutoff), so the work itself
# is the second trigger. Spawning an agent or workflow, or touching a THIRD
# distinct file, without graph-engineering loaded is refused once per session.
# Three because a two-file fix plus its test is the common small change;
# guessed, never measured. GRAPH_GATE_FILES overrides it.
if ! grep -qxF graph-engineering "$STATE/skill-loaded-$SID" 2>/dev/null \
   && [ ! -e "$STATE/graph-asked-$SID" ]; then
  # Notes and scratch are not the build: the house rules write memory files
  # all the time, and a fix + test + memory note is still a small change.
  WHY=""
  case "$TOOL" in
    Agent|Task|Workflow) WHY="spawning $TOOL" ;;
    Edit|Write|MultiEdit|NotebookEdit)
      F=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
      case "$F" in "$HOME/second-brain/"*|"$HOME/.claude/"*|/tmp/*|/private/tmp/*|/private/var/folders/*) F="" ;; esac
      if [ -n "$F" ]; then
        mkdir -p "$STATE"
        echo "$F" >> "$STATE/graph-edits-$SID"
        # sort -u, not a read-then-append check: parallel Edits race that.
        N=$(sort -u "$STATE/graph-edits-$SID" | wc -l | tr -d ' ')
        [ "$N" -ge "${GRAPH_GATE_FILES:-3}" ] && WHY="file $N of this session ($F)"
      fi ;;
  esac
  # mkdir is atomic, so parallel tool calls in one message refuse once, not
  # once each. The prompt marker goes too, or the call the message promises
  # will go through gets refused a second time by it.
  if [ -n "$WHY" ] && mkdir "$STATE/graph-asked-$SID" 2>/dev/null; then
    rm -f "$MARK"
    echo "skill-gate: this is big work ($WHY) and nobody asked \"should I graph engineer here?\". Load graph-engineering, then decide in one line: what fans out, what verifies from ground truth, or why none of it applies. Refused once; the next call goes through." >&2
    exit 2
  fi
fi

[ -s "$MARK" ] || exit 0

if [ "$TOOL" = "Skill" ]; then
  # A scoped variant ("repo:graph-engineering") counts as the skill.
  if grep -qxF "${ASKED##*:}" "$MARK"; then rm -f "$MARK"; fi
  exit 0
fi

NEED=$(tr '\n' ' ' < "$MARK")
rm -f "$MARK"
echo "skill-gate: the router named ${NEED}for this request, and it hasn't been loaded. Load it with the Skill tool before acting, and apply it: fan out independent work, verify from ground truth. If it truly doesn't fit, load it anyway and carry on silently. Never mention skills to the user." >&2
exit 2
