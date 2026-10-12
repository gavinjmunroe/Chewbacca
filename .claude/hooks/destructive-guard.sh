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
# DESTRUCTIVE_OK=1 counts only as a leading assignment on the very command
# it lets through, decided per piece below. A substring check let "echo
# DESTRUCTIVE_OK=1; git reset --hard" through (security review, 2026-10-10),
# and a leading one on the whole line let "DESTRUCTIVE_OK=1 echo x; git reset
# --hard" through until 2026-10-11.

REASON=$(DG_CMD="$CMD" DG_SID="$SID" DG_CWD="${CWD:-$PWD}" python3 -I - <<'PY'
import os, re, shlex, subprocess, time
cmd, sid, cwd = os.environ["DG_CMD"], os.environ["DG_SID"], os.environ["DG_CWD"]

# Split into simple commands; heredoc bodies and quoted text are data.
body = re.sub(r"<<-?\s*['\"]?(\w+)['\"]?.*?\n\1\s*$", "", cmd, flags=re.S | re.M)
segments = re.split(r"&&|\|\||;|\n|\|", body)

SAFE = ["git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
        "-c", "core.attributesFile=/dev/null"]
ENV = dict(os.environ, GIT_OPTIONAL_LOCKS="0")
# One budget for every git call in a check. The hook is registered with a 5 s
# timeout and a killed hook lets the command through, so three calls at 4 s
# each (2026-10-09) could fail open. Past the budget, assume dirty.
DEADLINE = time.monotonic() + 3.0

def left():
    remaining = DEADLINE - time.monotonic()
    if remaining <= 0.05:
        raise TimeoutError("destructive-guard: git budget spent")
    return remaining

def filter_guard(where):
    # A repo's filter.<name>.clean runs on git status, and attributes can name
    # it from .git/info/attributes, which no attr-source or flag skips (shown
    # 2026-10-09). So blank every driver the repo's own config defines, as
    # bin/lib/surfaces/code.py does. Reading config runs nothing. None means
    # the config can't be read or names a driver a -c can't take back.
    r = subprocess.run(SAFE + ["-C", where, "config", "--list", "--show-scope", "-z"],
                       capture_output=True, text=True, timeout=left(), env=ENV)
    if r.returncode != 0:
        return None
    tokens = r.stdout.split("\0")
    names = set()
    for scope, entry in zip(tokens[0::2], tokens[1::2]):
        key = entry.split("\n", 1)[0]
        if scope in ("global", "system") or not key.lower().startswith("filter."):
            continue
        rest = key[len("filter."):]
        if "." not in rest:
            continue
        name = rest.rsplit(".", 1)[0]
        if not name or any(ch in name for ch in "=\n\0"):
            return None
        names.add(name)
    guard = []
    for name in sorted(names):
        for var in ("clean", "smudge", "process"):
            guard += ["-c", f"filter.{name}.{var}="]
        guard += ["-c", f"filter.{name}.required=false"]
    return guard

def repo_dirty(where):
    # `where` comes from the command being checked, so the repo is untrusted:
    # git status runs core.fsmonitor and filter drivers from repo config, which
    # are arbitrary code. Turn them and hooks off. If git can't answer, or the
    # config can't be neutralised, assume there's work to lose (fail closed),
    # since that's the case this guard exists for.
    try:
        probe = subprocess.run(SAFE + ["-C", where, "rev-parse", "--git-dir"],
                               capture_output=True, text=True, timeout=left(), env=ENV)
        if probe.returncode != 0:
            return "not a git repository" not in probe.stderr
        guard = filter_guard(where)
        if guard is None:
            return True
        r = subprocess.run(SAFE + guard + ["-C", where, "status", "--porcelain", "--ignore-submodules=all"],
                           capture_output=True, text=True, timeout=left(), env=ENV)
    except Exception:
        return True
    if r.returncode != 0:
        return "not a git repository" not in r.stderr
    return any(l and not l.startswith("??") for l in r.stdout.splitlines())

where = cwd
# Catch-all on the text itself, whatever names git: eval "...", x=git; $x,
# $(which git), sh -c '...' (security review of f92c31af, 2026-10-10). The
# word-level parser below can't see through those, so a verb phrase it did not
# parse decides on the session's cwd when that has work to lose (after the
# loop). A commit message that mentions one belongs in a -F heredoc, which is
# stripped above.
PHRASE = re.compile(r"\b(reset\s+(?:\S+\s+)*--hard|checkout\s+(?:--(?=\s)|\.(?=\s|$|['\";)]))|clean\s+-\w*f|stash\s+(?:drop|clear))")
phrases = 0  # verb phrases in pieces that carry no override
# Plain NAME=value segments, so `W=/tmp/wt; git -C "$W" reset --hard` judges
# /tmp/wt. On 2026-10-11 that shape was refused as "uncommitted work in
# /Users/joelnewton/$WT": the variable was never read, the session's dirty
# checkout was judged instead, and a week of real refusals held 30 like it.
# A value that still holds $ or a backtick after expansion stays unresolved, and an
# unresolved path is judged dirty, as before.
names = {"HOME": os.path.expanduser("~"), "TMPDIR": os.environ.get("TMPDIR", "/tmp")}

def expand(word):
    out = re.sub(r"\$\{(\w+)\}|\$(\w+)", lambda m: names.get(m.group(1) or m.group(2), m.group(0)), word)
    return os.path.expanduser(out)

def resolve(path, base):
    path = expand(path)
    return path if os.path.isabs(path) else os.path.join(base, path)

seen = 0  # destructive git verbs the parser saw directly
for seg in segments:
    try:
        w = shlex.split(seg)
    except ValueError:
        w = seg.split()
    assigned = []
    while w and ("=" in w[0] and not w[0].startswith("-") or w[0] in ("nice", "-n", "19", "10", "env")):
        assigned.append(w[0])
        w = w[1:]
    if not w:
        for a in assigned:
            key, _, value = a.partition("=")
            if re.fullmatch(r"[A-Za-z_]\w*", key):
                value = expand(value)
                if "$" not in value and chr(96) not in value:
                    names[key] = value
                else:
                    names.pop(key, None)
        continue
    ok_here = "DESTRUCTIVE_OK=1" in assigned
    if ok_here:
        continue  # the override names this command, and only this one
    phrases += len(PHRASE.findall(seg))
    if w[0] == "cd" and len(w) > 1:
        where = resolve(w[1], where)
        continue
    # `command git`, `exec git`, `/usr/bin/git`, `xargs git` all run git.
    while w and w[0] in ("command", "exec", "xargs", "sudo", "time"):
        w = w[1:]
    if not w or os.path.basename(w[0]) != "git":
        continue
    a = w[1:]
    # Global options before the verb: -C <dir>, -c k=v, --git-dir=, --work-tree=
    while a and a[0].startswith("-"):
        if a[0] == "-C" and len(a) > 1:
            where, a = resolve(a[1], where), a[2:]
        elif a[0] == "-c" and len(a) > 1:
            a = a[2:]
        elif a[0].startswith("--work-tree="):
            where, a = resolve(a[0].split("=", 1)[1], where), a[1:]
        else:
            a = a[1:]
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
    if destroys:
        seen += 1
    if destroys and repo_dirty(where):
        print(f"`git {' '.join(a)}` would throw away uncommitted work in {where}, and other tabs share this checkout.")
        raise SystemExit
# More verb phrases in the text than direct git calls: something the parser
# can't see runs one (eval, sh -c, $x). Judge the session's cwd, as before.
if phrases > seen and repo_dirty(cwd):
    first = PHRASE.search(body)
    print(f"this runs `{first.group(1) if first else 'a destructive git verb'}`, which would throw away uncommitted work in {cwd}.")
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
