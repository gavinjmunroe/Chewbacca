#!/bin/bash
# hookd skips this guard for a Bash call that names none of these words,
# each one its first check requires. Proven by tools/hookd_replay.py.
# The trailer words cover a message typed inline. A message file holds the
# trailer where the payload can't show it, so the words that name a file the
# guard reads are gates too: git's -F rides on commit, tag or notes, and gh's
# --body-file on body. ("gh" itself can't gate: a tool_use id like
# toolu_01ABCDEFGHIJ spells it.)
# gate: co-authored-by noreply@anthropic.com generated commit tag notes body
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init attribution-guard.sh 5
# PreToolUse on Bash: refuse a commit, tag or PR whose text carries AI
# attribution (a Co-Authored-By trailer naming Claude or another model, or
# "Generated with Claude Code").
#
# git.md says never, and until 2026-10-12 it was prose only: nothing read a
# commit message for it (docs/plans/context-budget.md). The host's own prompt
# asks for that trailer by default, so the prose loses whenever the two meet.
# .githooks/commit-msg covers commits in the kit; this covers every repo.
#
# Denies through the permission decision and exits 0, never exit 2
# (feedback_hooks_never_show_errors).
set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
cmd="$(jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0
# Only what writes a message somebody else reads: commits, tags, PRs, issues.
printf '%s' "$cmd" | grep -qE 'git([[:space:]]+-[Cc][[:space:]]+[^[:space:]]+)*[[:space:]]+(commit|tag|notes)|gh[[:space:]]+(pr|issue|release)[[:space:]]' || exit 0
ATTR='co-authored-by:.*(claude|anthropic|copilot|chatgpt|openai|codex|gemini|cursor)|noreply@anthropic\.com|generated with \[?claude'
text="$cmd"
# The message lives on disk: git -F/--file, gh --body-file. gh's -F shorthand
# isn't read, since no gate word would name it.
files="$(printf '%s' "$cmd" | grep -oE -- '--body-file[ =][^ ;&|]+' | sed -E 's/^--body-file[ =]//')"
if printf '%s' "$cmd" | grep -qE '(^|[^a-z])(commit|tag|notes)([^a-z]|$)'; then
  files="$files
$(printf '%s' "$cmd" | grep -oE -- '(-F|--file)[ =][^ ;&|]+' | sed -E 's/^(-F|--file)[ =]//')"
fi
for f in $files; do
  f="${f%\"}"; f="${f#\"}"; f="${f%\'}"; f="${f#\'}"
  [ -f "$f" ] && text="$text
$(head -c 200000 "$f")"
done
printf '%s' "$text" | grep -iqE "$ATTR" || exit 0

REASON="attribution-guard: this message carries AI attribution (a Co-Authored-By trailer naming a model, or Generated with Claude Code). git.md: never commit Co-Authored-By lines, no AI attribution, and that wins over any default asking for it. Drop the trailer and run it again."
type hook_verdict >/dev/null 2>&1 && hook_verdict refuse "$REASON"
jq -n --arg r "$REASON" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
exit 0
