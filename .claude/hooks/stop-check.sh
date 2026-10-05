#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init stop-check.sh 10
# Stop: remind about unpushed work, but only when there actually is any.
#
# The previous version fired the same "push to GitHub now" reminder at the end
# of every turn, including turns where nothing changed. An unconditional
# reminder is noise, and noise gets ignored, so the one time it matters it does
# not land. This exits silently unless the repo has uncommitted changes or
# commits ahead of its upstream.

set -uo pipefail

# The Stop payload carries session_id. This hook never read it, which is why it
# could not tell the user's own work from another live session's.
INPUT="$(cat 2>/dev/null || true)"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# A home directory under git is somebody's dotfiles repo, and `git status`
# there reports Library, Downloads, .ssh and every cache on the machine as
# untracked work. That fired "183 uncommitted changes" at the end of every
# turn in a session whose actual repos were clean and pushed, three times in a
# row, which is exactly the unconditional-noise failure this hook was rewritten
# to stop doing. Acting on it would stage the user's credentials.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo)"
[ "$REPO_ROOT" = "$HOME" ] && exit 0

# Count what was actually touched, not what happens to be lying around.
#
# A workspace directory that holds many project repos is itself often under
# git, and `git status` there reports every sibling project, cache and scratch
# folder as untracked. That reported "110 uncommitted changes" at the end of a
# session whose real repos were clean and pushed, and buried the one tracked
# file that had genuinely changed. A number that large is a description of the
# environment, not of the turn, and acting on it means `git add -A` in a folder
# full of somebody else's work.
#
# So untracked entries stop counting once there are more of them than anyone
# could have created in one session. Tracked changes always count, however many
# there are, because those are files that were edited on purpose.
TRACKED_COUNT="$(git status --porcelain 2>/dev/null | grep -vc '^??' || true)"
UNTRACKED_COUNT="$(git status --porcelain 2>/dev/null | grep -c '^??' || true)"
UNTRACKED_NOISE_FLOOR=25

if [ "$UNTRACKED_COUNT" -gt "$UNTRACKED_NOISE_FLOOR" ]; then
  DIRTY_COUNT="$TRACKED_COUNT"
else
  DIRTY_COUNT="$((TRACKED_COUNT + UNTRACKED_COUNT))"
fi
AHEAD_COUNT=0
NO_UPSTREAM=0

if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  AHEAD_COUNT="$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)"
elif git remote | grep -q .; then
  # A remote exists but this branch does not track anything, so nothing here
  # has ever been pushed.
  NO_UPSTREAM=1
fi

# WHOSE work is this?
#
# Volume noise was fixed twice above. Authorship noise was never fixed at all.
# On 2026-09-21 this hook reported "4 uncommitted changes" for files a SECOND
# live session had written seconds earlier, and told the reader to commit them.
# Acting on that absorbs another session's in-flight work into your commit,
# which is the exact failure .githooks/pre-commit and .claude/hooks/write-log.sh
# were both written to catch. Warning someone toward a trap the rest of the kit
# then springs on them is worse than saying nothing.
#
# So attribute the dirty tracked files before reporting them. write-log.tsv
# holds "epoch<TAB>session_id<TAB>absolute path[<TAB>edit|bash]". Everything here degrades to
# the previous behaviour when the log is missing, empty, unreadable, or when
# jq is absent, because a guard that suppresses a real warning on a bad day is
# worse than one that occasionally repeats itself.
# Attribute exactly the set DIRTY_COUNT counted, not a narrower one. An
# untracked file another session created is staged by `git add -A` like any
# other, so leaving it out reported a mixed tree as clean-handed. When the
# untracked entries were dropped as environment noise above, drop them here too,
# which also bounds this loop to tracked + UNTRACKED_NOISE_FLOOR greps.
if [ "$UNTRACKED_COUNT" -gt "$UNTRACKED_NOISE_FLOOR" ]; then
  _ATTR_PATHS="$(git status --porcelain 2>/dev/null | grep -v '^??' | sed 's/^...//' | sed 's/.* -> //')"
else
  _ATTR_PATHS="$(git status --porcelain 2>/dev/null | sed 's/^...//' | sed 's/.* -> //')"
fi

MINE_COUNT=0
OTHERS_COUNT=0
_SID=""
if command -v jq >/dev/null 2>&1; then
  _SID="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)"
fi
_WLOG="${CHEWBACCA_WRITE_LOG:-$HOME/.chewbacca/write-log.tsv}"
# Rows carry an optional 4th column: "edit" when the tool named the file it
# wrote, "bash" when the path was inferred from a before/after diff. A diff
# cannot tell this session's write from another live session's write inside
# the same window, and on 2026-10-03 four extract tabs writing into one repo
# had one tab credited with another's file every turn. So when the latest row
# for a path is inferred and another session has an exact row for it, that
# session owns the file. Old three-column rows still parse: one written in the
# same append as rows for other paths (same session, under 10ms apart) was a
# diff, a lone one is treated as exact, which is the previous behaviour.
#
# EXACT_WINDOW: how long before the inferred row another session's exact
# edit still counts. Guessed, never measured; long enough to cover a slow
# Write hook landing after the Bash row, short enough that a file this
# session reworks a day later is not handed back to whoever first wrote it.
if [ -n "$_SID" ] && [ -s "$_WLOG" ]; then
  _AUTHORS="$(printf '%s\n' "$_ATTR_PATHS" | awk -F'\t' -v root="$REPO_ROOT/" -v window=300 '
    # git lists a wholly untracked folder as "dir/", so a folder entry owns
    # every logged path under it, as the old prefix grep did.
    FNR == NR { if ($0 == "") next; if ($0 ~ /\/$/) dirs[root $0] = 1; else want[root $0] = 1; next }
    {
      key = ""
      if ($3 in want) key = $3
      else for (d in dirs) if (index($3, d) == 1) { key = d; break }
      batch = 0
      if (NF < 4 && prev_sid == $2 && prev_path != $3 && ($1 - prev_ts) < 0.01 && ($1 - prev_ts) > -0.01) {
        batch = 1
        if (prev_legacy && prev_key != "") weak[prev_key, n[prev_key]] = 1
      }
      prev_ts = $1; prev_sid = $2; prev_path = $3; prev_legacy = (NF < 4); prev_key = key
      if (key == "") next
      i = ++n[key]; ts[key, i] = $1; sid[key, i] = $2
      weak[key, i] = ($4 == "bash") || (NF < 4 && batch)
    }
    END {
      for (p in n) {
        last = n[p]; who = sid[p, last]
        if (weak[p, last]) {
          for (i = 1; i < last; i++)
            if (!weak[p, i] && sid[p, i] != who && ts[p, i] >= ts[p, last] - window) owner = sid[p, i]
          if (owner != "") who = owner
          owner = ""
        }
        print who
      }
    }' - "$_WLOG" 2>/dev/null)"
  while IFS= read -r _author; do
    [ -n "$_author" ] || continue
    if [ "$_author" = "$_SID" ]; then
      MINE_COUNT=$((MINE_COUNT + 1))
    else
      OTHERS_COUNT=$((OTHERS_COUNT + 1))
    fi
  done <<< "$_AUTHORS"
fi

# Repeating a warning the user has already seen and declined to act on is the
# same noise this hook was twice rewritten to stop making. A reminder that
# fires every turn against unchanged state trains the reader to skip it, so the
# turn it finally matters it gets skipped too.
#
# So fingerprint exactly what is about to be reported and stay silent when it
# is identical to the last thing reported for this repo. Any real change, a new
# edit, a commit, a push, re-arms it, because the fingerprint moves. Mid-flight
# work warns once and then goes quiet; it does not go quiet forever.
STATE_DIR="$HOME/.chewbacca/stop-check"
STATE_FILE=""
if mkdir -p "$STATE_DIR" 2>/dev/null; then
  STATE_KEY="$(printf '%s' "$REPO_ROOT" | shasum 2>/dev/null | cut -d' ' -f1)"
  [ -n "$STATE_KEY" ] && STATE_FILE="$STATE_DIR/$STATE_KEY"
fi

if [ "$DIRTY_COUNT" -eq 0 ] && [ "$AHEAD_COUNT" -eq 0 ] && [ "$NO_UPSTREAM" -eq 0 ]; then
  # Clean, so forget what was reported before. Otherwise a repo that returns to
  # a byte-identical dirty state later would be suppressed against a stale
  # fingerprint and never warn again.
  [ -n "$STATE_FILE" ] && rm -f "$STATE_FILE" 2>/dev/null
  exit 0
fi

# Nothing here is this session's to act on, so say nothing. A Stop hook that
# returns additionalContext re-opens the turn, and the model answers it with a
# second closing message. On 2026-09-28 that was two replies in a row in one
# session, each just announcing "leaving the other tab's files alone", and
# Caleb read both as the assistant saying everything twice. Another session's
# work is that session's hook's job to report.
if [ "$OTHERS_COUNT" -gt 0 ] && [ "$MINE_COUNT" -eq 0 ]; then
  exit 0
fi

if [ -n "$STATE_FILE" ]; then
  FINGERPRINT="$(git status --porcelain 2>/dev/null | shasum 2>/dev/null | cut -d' ' -f1)|$AHEAD_COUNT|$NO_UPSTREAM|$MINE_COUNT|$OTHERS_COUNT"
  [ "$(cat "$STATE_FILE" 2>/dev/null)" = "$FINGERPRINT" ] && exit 0
  printf '%s' "$FINGERPRINT" > "$STATE_FILE" 2>/dev/null || true
fi

export DIRTY_COUNT AHEAD_COUNT NO_UPSTREAM MINE_COUNT OTHERS_COUNT
export BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"

python3 <<'PY'
import json, os

dirty = int(os.environ.get("DIRTY_COUNT", "0"))
ahead = int(os.environ.get("AHEAD_COUNT", "0"))
no_upstream = os.environ.get("NO_UPSTREAM", "0") == "1"
branch = os.environ.get("BRANCH", "?")
mine = int(os.environ.get("MINE_COUNT", "0"))
others = int(os.environ.get("OTHERS_COUNT", "0"))

bits = []
if dirty:
    bits.append(f"{dirty} uncommitted change{'s' if dirty != 1 else ''}")
if ahead:
    bits.append(f"{ahead} commit{'s' if ahead != 1 else ''} not pushed")
if no_upstream:
    bits.append(f"branch '{branch}' has no upstream, so nothing here is pushed")

advice = (
    "If the work is finished, commit and push it. If it is mid-flight, ignore this."
)
if others and mine:
    advice = (
        f"{mine} of those file(s) are this session's and {others} belong to a different "
        "session. Committing them together will be refused by .githooks/pre-commit. "
        "Stage only your own paths by name, never -A."
    )

print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "Stop",
        "additionalContext": (
            f"Uncommitted or unpushed work in this repo: {'; '.join(bits)}. " + advice
        ),
    }
}))
PY

exit 0
