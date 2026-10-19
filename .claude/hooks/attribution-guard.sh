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
INPUT="$(cat)"
cmd="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0
# Only what writes a message somebody else reads: commits, tags, PRs, issues.
# git or gh in command position, so a script or heredoc that mentions one in
# a string isn't judged (a python heredoc holding this guard's own test text
# was the one refusal in 1,888 real calls before this).
# Wrappers (env VAR=x, command, exec, sudo, time), a full path to git, and
# git's own global options (--no-pager, --git-dir=..., -C dir, -c k=v) all
# still mean git commit. Break-it, 2026-10-19: /usr/bin/git commit,
# env X=1 git commit, git --no-pager commit and git --git-dir=.git commit
# all got through.
printf '%s' "$cmd" | grep -qE '(^|[;&|({`]|\$\()[[:space:]]*((env|command|exec|sudo|time)[[:space:]]+([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*)*([^[:space:];&|]*/)?(git([[:space:]]+(-[Cc][[:space:]]+[^[:space:]]+|--?[A-Za-z][A-Za-z-]*(=[^[:space:]]+)?))*[[:space:]]+(commit|tag|notes)|gh[[:space:]]+(pr|issue|release)[[:space:]])' || exit 0
# Same pattern as .githooks/commit-msg: a model's address or name and version
# in a Co-Authored-By trailer, or the markdown "Generated with [Claude Code]".
# `--trailer "Co-Authored-By=..."` takes = as well as :, and the plain-text
# "Generated with Claude Code" on a line of its own counts as much as the markdown one (break-it,
# 2026-10-19).
ATTR='co-authored-by[:=][^<]*<[^>]*(anthropic\.com|openai\.com|cursor\.(com|sh)|copilot)[^>]*>|co-authored-by[:=][[:space:]]*(claude|chatgpt|gpt|codex|gemini|copilot)([ -](opus|sonnet|haiku|fable|code|pro|flash|[0-9][0-9.]*))+[[:space:]]*<|generated with \[claude|^[^[:alnum:]]*generated with claude code[^[:alnum:]]*$'
text="$cmd"
# The message lives on disk: git -F/--file, gh --body-file. gh's -F shorthand
# isn't read, since no gate word would name it.
files="$(printf '%s' "$cmd" | grep -oE -- '--body-file[ =][^ ;&|]+' | sed -E 's/^--body-file[ =]//')"
if printf '%s' "$cmd" | grep -qE '(^|[^a-z])(commit|tag|notes)([^a-z]|$)'; then
  # -F/path with no space and a cluster like -aF path name the file too.
  files="$files
$(printf '%s' "$cmd" | grep -oE -- '(^|[[:space:]])(-[a-zA-Z]*F|--file)([ =]+)?[^ ;&|-][^ ;&|]*' | sed -E 's/^[[:space:]]*(-[a-zA-Z]*F|--file)[ =]*//')"
fi
# A message built from a file at run time, -m "$(cat msg)" or
# gh --body "$(< f)", is read from that file.
files="$files
$(printf '%s' "$cmd" | grep -oE '\$\((cat[[:space:]]+|<[[:space:]]*)[^)[:space:]]+\)' | sed -E 's/^\$\((cat[[:space:]]+|<[[:space:]]*)//; s/\)$//')"
# Relative paths resolve against the call's cwd, and ~ expands. A path with
# a space, or one after a cd in the same command, isn't followed; the
# commit-msg hook still reads the message in the kit.
pcwd="$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)"
while IFS= read -r f; do
  [ -n "$f" ] || continue
  f="${f%\"}"; f="${f#\"}"; f="${f%\'}"; f="${f#\'}"
  case "$f" in "~/"*) f="$HOME/${f#\~/}" ;; /*) ;; *) [ -n "$pcwd" ] && f="$pcwd/$f" ;; esac
  [ -f "$f" ] && text="$text
$(head -c 200000 "$f")"
done <<< "$files"
printf '%s' "$text" | grep -iqE "$ATTR" || exit 0

REASON="attribution-guard: this message carries AI attribution (a Co-Authored-By trailer naming a model, or Generated with Claude Code). git.md: never commit Co-Authored-By lines, no AI attribution, and that wins over any default asking for it. Drop the trailer and run it again."
type hook_verdict >/dev/null 2>&1 && hook_verdict refuse "$REASON"
jq -n --arg r "$REASON" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
exit 0
