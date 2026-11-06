#!/bin/bash
# hookd skips this guard for a Bash call that names none of these words.
# gate: commit
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init commit-deletes-guard.sh 5
#
# PreToolUse on Bash: a commit never deletes files nobody asked it to.
#
# 2026-11-06. Commits built in a temp index seeded with `cp .git/index` in a
# checkout several tabs were working in wrote trees missing files HEAD already
# had. Four files went first, quietly: a guard, its test, a skill and the
# lesson explaining them. By the time anyone looked, 431 committed files were
# gone from the working tree, including a guard written that same morning.
# Nothing printed. Nothing failed. Caleb: "Bro ensure nothing like that ever
# happens again plz".
#
# So: work out what the commit WOULD remove, and refuse if those paths were
# not named on the command line. Deleting on purpose stays one argument away.
# Override: COMMIT_DELETES_OK='<reason>'.

set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0
case "$cmd" in *COMMIT_DELETES_OK=*) exit 0 ;; esac

printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^[:space:]]+)?)*[[:space:]]+commit([[:space:]]|$)' || exit 0

# Where the commit runs: an explicit `cd X && ...`, else the session's cwd.
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)"
dir="$(printf '%s' "$cmd" | sed -nE 's/^[[:space:]]*cd[[:space:]]+([^;&|]+)[[:space:]]*&&.*/\1/p' | head -1)"
dir="${dir%"${dir##*[![:space:]]}"}"
dir="${dir/#\~/$HOME}"
case "$dir" in "") dir="$cwd" ;; /*) ;; *) dir="$cwd/$dir" ;; esac
[ -n "$dir" ] && [ -d "$dir" ] || exit 0
git -C "$dir" rev-parse --git-dir >/dev/null 2>&1 || exit 0

# An --amend or a merge legitimately reshapes a tree; so does an explicit `git
# rm`. This guard is about the silent case.
printf '%s' "$cmd" | grep -qE '(^|[[:space:]])(--amend|--no-verify[[:space:]]+--amend)([[:space:]]|$)' && exit 0

# Honour a temp index the command sets, so the check sees the same tree the
# commit will write. This is the exact case that caused the incident.
idx="$(printf '%s' "$cmd" | sed -nE 's/.*GIT_INDEX_FILE=([^[:space:]]+).*/\1/p' | head -1)"
idx="${idx/#\~/$HOME}"
if [ -n "$idx" ]; then
  # The command builds that index in the same breath, so at hook time the file
  # may not exist yet and git would read an empty index as "deletes
  # everything". That is not a judgement, it is a blind spot, and refusing on
  # it made the guard fire on every correct temp-index commit including the one
  # that shipped the guard. Seeding with `read-tree HEAD` is the safe pattern
  # this guard's own message recommends, so recognise it and stand down.
  [ -s "$idx" ] || exit 0
  printf '%s' "$cmd" | grep -q 'read-tree[[:space:]]\+HEAD' && exit 0
  export GIT_INDEX_FILE="$idx"
fi

if printf '%s' "$cmd" | grep -qE '(^|[[:space:]])-a([[:space:]]|$)|--all([[:space:]]|$)'; then
  gone="$(git -C "$dir" diff --name-only --diff-filter=D HEAD 2>/dev/null)"
else
  gone="$(git -C "$dir" diff --cached --name-only --diff-filter=D 2>/dev/null)"
fi
[ -n "$gone" ] || exit 0

# Paths named after `--` are deletions somebody asked for.
named="$(printf '%s' "$cmd" | sed -nE 's/.*[[:space:]]--[[:space:]]+(.*)$/\1/p' | head -1)"
unnamed=""
count=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case " $named " in *" $f "*) continue ;; esac
  unnamed="$unnamed$f"$'\n'
  count=$((count + 1))
done <<< "$gone"
[ "$count" -gt 0 ] || exit 0

{
  echo "commit-deletes-guard: refusing. This commit would remove $count file(s)"
  echo "that the command never named:"
  # `printf | head` closes the pipe early on a long list and bash prints a
  # broken-pipe error over the refusal. Slice first, then print.
  printf '%s' "$unnamed" | sed -n '1,12p' | sed 's/^/  /'
  [ "$count" -gt 12 ] && echo "  ... and $((count - 12)) more"
  cat <<'MSG'

On 2026-11-06 a commit built in a temp index copied from a stale .git/index
wrote a tree missing files HEAD already had. It printed nothing. 431 committed
files were gone from the working tree before anyone looked, including a guard
written that same morning.

If the deletion is intended, name those paths after `--`. If it is not, the
index is stale: seed it with `GIT_INDEX_FILE=$t git read-tree HEAD`, never
`cp .git/index`. For a deliberate bulk removal, add
COMMIT_DELETES_OK='<reason>' to the command.
MSG
} >&2
exit 2
