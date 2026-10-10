#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init destructive-guard.sh 5
# PreToolUse: refuse the git commands that destroy uncommitted work other tabs
# may own, before they run.
#
# WHAT HAPPENED. 2026-10-09: a cleanup ran `git worktree list | grep
# scratchpad | ... git worktree remove --force` and deleted another tab's
# worktree along with its uncommitted edit. The creator distill (2026-10-10)
# found the same failure elsewhere: Jeffrey Emanuel's destructive_command_guard
# exists because an agent ran `git checkout --` and destroyed uncommitted work.
# settings.json already denies rm -rf ~ and force pushes; nothing covered these.
#
# WHAT IT REFUSES, only when there's something to lose:
#   1. `git worktree remove` of a path inside another Claude session's
#      scratchpad (/private/tmp/claude-*/<project>/<session-id>/...).
#   2. In a repo with uncommitted changes: `git checkout -- <path>` or
#      `git checkout .`, `git restore` without --staged, `git reset --hard`,
#      `git clean -f`, and a bare `git stash` / `stash drop` / `stash clear`
#      (the stash stack is shared by every worktree of the repo).
# DESTRUCTIVE_OK=1 in the command lets a deliberate one through.

command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat)
[ "$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty')
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty')
[ -n "$CMD" ] || exit 0
case "$CMD" in *DESTRUCTIVE_OK=1*) exit 0 ;; esac

REASON=$(DG_CMD="$CMD" DG_SID="$SID" DG_CWD="${CWD:-$PWD}" python3 - <<'PY'
import os, re, shlex, subprocess
cmd, sid, cwd = os.environ["DG_CMD"], os.environ["DG_SID"], os.environ["DG_CWD"]

# Split into simple commands; heredoc bodies and quoted text are data.
body = re.sub(r"<<-?\s*['\"]?(\w+)['\"]?.*?\n\1\s*$", "", cmd, flags=re.S | re.M)
segments = re.split(r"&&|\|\||;|\n|\|", body)

def repo_dirty(where):
    try:
        out = subprocess.run(["git", "-C", where, "status", "--porcelain"],
                             capture_output=True, text=True, timeout=4).stdout
    except Exception:
        return False
    return any(l and not l.startswith("??") for l in out.splitlines())

where = cwd
for seg in segments:
    try:
        w = shlex.split(seg)
    except ValueError:
        w = seg.split()
    while w and ("=" in w[0] and not w[0].startswith("-") or w[0] in ("nice", "-n", "19", "10", "env")):
        w = w[1:]
    if not w:
        continue
    if w[0] == "cd" and len(w) > 1:
        where = os.path.expanduser(w[1]) if os.path.isabs(os.path.expanduser(w[1])) else os.path.join(where, w[1])
        continue
    if w[0] != "git":
        continue
    a = w[1:]
    if a[:1] == ["-C"] and len(a) > 1:
        where, a = os.path.expanduser(a[1]), a[2:]
    if not a:
        continue
    verb = a[0]
    # 1. another session's worktree
    if verb == "worktree" and a[1:2] == ["remove"]:
        for p in a[2:]:
            m = re.search(r"/claude-\d+/[^/]+/([0-9a-f-]{36})/", p + "/")
            if m and sid and m.group(1) != sid:
                print(f"`git worktree remove {p}` targets another Claude session's worktree ({m.group(1)[:8]}), not this one's ({sid[:8]}).")
                raise SystemExit
        continue
    destroys = (
        (verb == "checkout" and ("--" in a or "." in a[1:]))
        or (verb == "restore" and "--staged" not in a)
        or (verb == "reset" and "--hard" in a)
        or (verb == "clean" and any(x.startswith("-") and "f" in x for x in a[1:]))
        or (verb == "stash" and (len(a) == 1 or a[1] in ("drop", "clear") or (a[1] == "push" and "-m" not in a)))
    )
    if destroys and repo_dirty(where):
        print(f"`git {' '.join(a)}` would throw away uncommitted work in {where}, and other tabs share this checkout.")
        raise SystemExit
PY
)
[ -n "$REASON" ] || exit 0
{
  echo "destructive-guard: refusing. $REASON"
  echo
  echo "On 2026-10-09 a worktree cleanup deleted another tab's uncommitted edit,"
  echo "and the same shape (git checkout --) is how agents elsewhere lose work."
  echo "Commit or copy what you need first, touch only paths you created, or put"
  echo "DESTRUCTIVE_OK=1 in the command if you've checked it's yours to discard."
} >&2
exit 2
