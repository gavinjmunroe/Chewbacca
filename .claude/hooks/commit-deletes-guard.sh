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

# The same hardening destructive-guard.sh uses: a repo this hook does not own
# must not get to run its own hooks, filters or attribute drivers just because
# something here ran git inside it.
G=(git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.attributesFile=/dev/null)
export GIT_OPTIONAL_LOCKS=0

command -v jq >/dev/null 2>&1 || exit 0
input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0
# The segment that actually commits. Matching the override or --amend anywhere
# in the command let `echo COMMIT_DELETES_OK=x; git commit` through.
seg="$(printf '%s' "$cmd" | tr ';&|' '\n\n\n' | grep -E '(^|[[:space:]])git([[:space:]]+-[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)' | head -1)"
[ -n "$seg" ] || seg="$cmd"
printf '%s' "$seg" | grep -qE '(^|[[:space:]])COMMIT_DELETES_OK=[^[:space:]]' && exit 0

printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^[:space:]]+)?)*[[:space:]]+commit([[:space:]]|$)' || exit 0

# Where the commit runs: an explicit `cd X && ...`, else the session's cwd.
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)"
dir="$(printf '%s' "$cmd" | sed -nE 's/^[[:space:]]*cd[[:space:]]+([^;&|]+)[[:space:]]*&&.*/\1/p' | head -1)"
dir="${dir%"${dir##*[![:space:]]}"}"
dir="${dir/#\~/$HOME}"
case "$dir" in "") dir="$cwd" ;; /*) ;; *) dir="$cwd/$dir" ;; esac
[ -n "$dir" ] && [ -d "$dir" ] || exit 0
"${G[@]}" -C "$dir" rev-parse --git-dir >/dev/null 2>&1 || exit 0

# An --amend or a merge legitimately reshapes a tree; so does an explicit `git
# rm`. This guard is about the silent case.
printf '%s' "$seg" | grep -qE '(^|[[:space:]])--amend([[:space:]]|$)' && exit 0

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
  seeded=0
  printf '%s' "$cmd" | grep -qE 'read-tree[[:space:]]+HEAD([[:space:]]|$|;|&)' && seeded=1
  if [ ! -s "$idx" ]; then
    # The index is built by this same command, so there is nothing to read yet.
    # Standing down on ANY missing index was too generous; only the safe
    # seeding pattern this guard's own message recommends gets the pass, and
    # anything else is refused rather than waved through.
    [ "$seeded" = 1 ] && exit 0
    echo "commit-deletes-guard: refusing. The command commits through $idx, which" >&2
    echo "does not exist yet, so what it would delete cannot be read. Seed it with" >&2
    echo "  GIT_INDEX_FILE=\$t git read-tree HEAD" >&2
    echo "before staging, or add COMMIT_DELETES_OK='<reason>'." >&2
    exit 2
  fi
  [ "$seeded" = 1 ] && exit 0
  export GIT_INDEX_FILE="$idx"
fi

if printf '%s' "$seg" | grep -qE '(^|[[:space:]])(-[a-zA-Z]*a[a-zA-Z]*|--all)([[:space:]]|$)'; then
  gone="$("${G[@]}" -C "$dir" diff --no-renames --name-only --diff-filter=D HEAD 2>/dev/null)"
else
  gone="$("${G[@]}" -C "$dir" diff --no-renames --cached --name-only --diff-filter=D 2>/dev/null)"
fi
# Paths named after `--` are deletions and rewrites somebody asked for, so
# both checks below read them. This used to be parsed after the first check,
# which meant naming a path did not exempt it from that one.
named="$(printf '%s' "$seg" | sed -nE 's/.*[[:space:]]--[[:space:]]+(.*)$/\1/p' | head -1)"

# A commit can also wipe work without deleting a single file: edit a file in a
# shared checkout that is behind origin, and the commit writes your stale copy
# over everything landed since. On 2026-11-06 one added registration to
# setup.sh took 261 lines with it, including a guard added an hour earlier and
# the code that preserves a user's own hooks through an install. Nothing
# printed; a review found it. So a commit that strips a lot of lines a file has
# on origin says so out loud.
if [ -z "${COMMIT_DELETES_OK:-}" ]; then
  "${G[@]}" -C "$dir" fetch -q origin main 2>/dev/null
  big=""
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case " ${named:-} " in *" $f "*) continue ;; esac
    lost="$("${G[@]}" -C "$dir" diff --numstat origin/main -- "$f" 2>/dev/null | awk '{print $2}')"
    [ -n "$lost" ] && [ "$lost" -ge 100 ] 2>/dev/null && big="$big  $f: $lost lines this file has on origin"$'\n'
  done <<< "$("${G[@]}" -C "$dir" diff --cached --name-only --diff-filter=M 2>/dev/null)"
  if [ -n "$big" ]; then
    {
      echo "commit-deletes-guard: refusing. This commit drops 100+ lines that"
      echo "origin/main has, in a file the command never named:"
      printf '%s' "$big" | sed -n '1,8p'
      cat <<'MSG'

2026-11-06: one added registration to setup.sh in this shared checkout took
261 lines with it, a guard added an hour earlier and the code that preserves a
user's own hooks through an install. The file on disk was behind origin, and
committing it wrote that stale copy over everything landed since.

Rebuild the file on origin's copy and re-apply only your change:
  git show origin/main:<path> > /tmp/base && <re-apply> && mv /tmp/base <path>
Then name it after `--`, or add COMMIT_DELETES_OK='<reason>'.
MSG
    } >&2
    exit 2
  fi
fi

[ -n "$gone" ] || exit 0

# Paths named after `--` are deletions somebody asked for.
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
