#!/bin/bash
# hookd skips this guard for a Bash call while this session has no
# skill-required marker: on Bash it only ever acts on that file (see below).
# Every other tool always runs it. 0.062 s of CPU on every Bash call before
# (2026-10-12).
# gate-file: state/skill-required-{session}
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"
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
# It nudges ONCE per big-work prompt and then clears the marker. The nudge
# rides on the call as context and the call still runs: until 2026-10-11 it
# refused with exit 2, which Caleb sees as a red "hook error" on a command that
# did nothing wrong ("Fix chewb, you should never error bro", on a form fill
# the router had misread as big work).
set -uo pipefail
nudge() {
  jq -n --arg m "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $m}}'
  exit 0
}
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
  # Its own stamp: the list above is appended on every load, so its mtime
  # said "a skill loaded recently", and any unrelated skill load then switched
  # this gate off for ten minutes (caught by tests/skill_gate.sh, 2026-10-10).
  [ "${ASKED##*:}" = graph-engineering ] && touch "$STATE/graph-loaded-$SID"
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
    nudge "skill-gate: this is big work ($WHY) and nobody asked \"should I graph engineer here?\". Load graph-engineering, then decide in one line: what fans out, what verifies from ground truth, or why none of it applies. This call went through; say it once and carry on."
  fi
fi

[ -s "$MARK" ] || exit 0

# The marker is per big-work PROMPT (skill-route.sh deletes it on every new
# prompt and re-arms it on big work, loaded or not). 2026-10-07: loaded once at
# session start, the skill then sat unused for hours of one-at-a-time jobs.
# Two things count as having drawn this turn's task graph: re-reading the
# skill, or fanning out to an agent or workflow, which is the graph applied.
if [ "$TOOL" = "Skill" ]; then
  # A scoped variant ("repo:graph-engineering") counts as the skill.
  if grep -qxF "${ASKED##*:}" "$MARK"; then rm -f "$MARK"; fi
  exit 0
fi
case "$TOOL" in
  Agent|Task|Workflow)
    if grep -qxF graph-engineering "$MARK"; then rm -f "$MARK"; exit 0; fi ;;
esac

# mv is atomic: of several parallel calls in one message, exactly one claims
# the marker and refuses, and the rest go through.
CLAIM="$MARK.$$"
mv "$MARK" "$CLAIM" 2>/dev/null || exit 0
NEED=$(tr '\n' ' ' < "$CLAIM")
rm -f "$CLAIM"
# A load in the last 10 minutes is this turn's graph. 2026-10-09: a mid-turn
# message re-armed the marker a minute after the skill loaded, so the same turn
# got refused twice and Caleb saw "commands that fail".
if [ -n "$(find "$STATE/graph-loaded-$SID" -mmin -10 2>/dev/null)" ]; then
  exit 0
fi
if grep -qxF graph-engineering "$STATE/skill-loaded-$SID" 2>/dev/null; then
  nudge "skill-gate: this prompt is big work. graph-engineering was loaded earlier in the session, but loaded is not applied: draw THIS turn's task graph before acting. Re-load the skill, or fan the independent jobs out with Agent, and say in one line what runs in parallel, what verifies from ground truth, or why it is one sequential chain. This call went through. Never mention skills to the user."
else
  nudge "skill-gate: the router named ${NEED}for this request, and it hasn't been loaded. Load it with the Skill tool now, and apply it: fan out independent work, verify from ground truth. If it truly doesn't fit, carry on silently. This call went through. Never mention skills to the user."
fi
