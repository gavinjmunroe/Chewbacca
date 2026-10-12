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

# Split into simple commands. Heredoc bodies are data, unless a shell or an
# eval reads them: 'bash <<EOF' runs its body (security review, 2026-10-11).
# The opener line itself always stays: 'cat <<EOF; git reset --hard' runs the
# reset, and the old regex dropped everything after the tag.
SHELLS = ("bash", "sh", "zsh", "dash", "ksh", "fish", "eval", "source", ".", "xargs")
lines, kept, i = cmd.split("\n"), [], 0
while i < len(lines):
    line = lines[i]
    kept.append(line)
    i += 1
    for tag in re.findall(r"<<-?\s*['\"]?([A-Za-z_]\w*)['\"]?", line):
        opener = re.split(r"&&|\|\||;|\|", line.split("<<", 1)[0])[-1].split()
        runs = bool(opener) and os.path.basename(opener[0]) in SHELLS
        while i < len(lines) and lines[i].strip() != tag:
            if runs:
                kept.append(lines[i])
            i += 1
        i += 1
body = "\n".join(kept)
# A subshell, `cd -`, pushd/popd or a command substitution makes the working
# directory after a piece unknowable from the text, so every directory the
# command names is judged, not just the tracked one.
uncertain = bool(re.search(r"[()\x60]|\bpopd\b|\bcd\s+-(\s|$)", body))
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

def repo_dirty(where, untracked=False):
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
    return any(l and (untracked or not l.startswith("??")) for l in r.stdout.splitlines())

where = cwd
# Catch-all on the text itself, whatever names git: eval "...", x=git; $x,
# $(which git), sh -c '...' (security reviews of f92c31af, 2026-10-10, and of
# 2232e9d9, 2026-10-11). The word-level parser below can't see through those,
# so a verb phrase in a piece it did not parse as that very git call decides
# on every directory the text names, and on the session's cwd. Quotes are
# removed first, so 'git reset --ha""rd' is still the phrase.
PHRASE = re.compile(r"\b(reset\s+(?:\S+\s+)*--hard|checkout\s+(?:--(?=\s)|\.(?=\s|$|[;)])|-f\b|--force\b)|clean\s+-\w*f|stash\s+(?:drop|clear))")
dequote = lambda text: re.sub(r"[\"'\\]", "", text)
hidden = 0  # verb phrases no parsed git call accounts for
# Variables: `W=/tmp/wt; git -C "$W" reset --hard` judges /tmp/wt. On
# 2026-10-11 that shape was refused as "uncommitted work in
# /Users/joelnewton/$WT": the session's dirty checkout was judged instead, and
# a week of real refusals held 30 like it. Only a name assigned exactly once,
# as a plain NAME=value piece, resolves. Anything else that touches a name
# (a second assignment, export, read, for, declare) leaves it unresolved, and
# an unresolved path is judged dirty.
names = {"HOME": os.path.expanduser("~"), "TMPDIR": os.environ.get("TMPDIR", "/tmp")}
counts = {}
for n in re.findall(r"(?<![\w$])([A-Za-z_]\w*)\+?=", cmd):
    counts[n] = counts.get(n, 0) + 1
tainted = {n for n, c in counts.items() if c > 1}
tainted |= set(re.findall(r"\b(?:export|declare|typeset|local|readonly|read|for|select|unset|getopts)\s+(?:-\S+\s+)*([A-Za-z_]\w*)", cmd))
tainted |= {"PWD", "OLDPWD", "GIT_DIR", "GIT_WORK_TREE"}

def expand(word):
    out = re.sub(r"\$\{(\w+)\}|\$(\w+)", lambda m: names.get(m.group(1) or m.group(2), m.group(0)), word)
    return os.path.expanduser(out)

def resolve(path, base):
    path = expand(path)
    return path if os.path.isabs(path) else os.path.join(base, path)

targets = {cwd}  # every directory the command names, for the catch-all
for seg in segments:
    try:
        w = shlex.split(seg)
    except ValueError:
        w = seg.split()
    # A subshell or group: `( cd x && git reset --hard )` runs inside.
    while w and w[0] in ("(", "{", "!", "then", "do", "else", "elif", "if", "while", "until"):
        w = w[1:]
    assigned = []
    while w and ("=" in w[0] and not w[0].startswith("-") or w[0] in ("nice", "-n", "19", "10", "env")):
        assigned.append(w[0])
        w = w[1:]
    if not w:
        for a in assigned:
            key, _, value = a.partition("=")
            if re.fullmatch(r"[A-Za-z_]\w*", key) and key not in tainted:
                value = expand(value)
                if "$" not in value and chr(96) not in value:
                    names[key] = value
        continue
    ok_here = "DESTRUCTIVE_OK=1" in assigned
    if ok_here:
        continue  # the override names this command, and only this one
    found = len(PHRASE.findall(dequote(seg)))
    if w[0] in ("cd", "pushd") and len(w) > 1:
        where = resolve(w[1], where)
        targets.add(where)
        hidden += found
        continue
    # `command git`, `exec git`, `/usr/bin/git`, `xargs git` all run git.
    while w and w[0] in ("command", "exec", "xargs", "sudo", "time"):
        w = w[1:]
    if not w or os.path.basename(w[0]) != "git":
        hidden += found
        continue
    here = where
    # GIT_DIR / GIT_WORK_TREE in front of git move it somewhere else.
    for a in assigned:
        key, _, value = a.partition("=")
        if key in ("GIT_WORK_TREE", "GIT_DIR"):
            here = resolve(value[:-5] if key == "GIT_DIR" and value.rstrip("/").endswith(".git") else value, where)
    a = w[1:]
    # Global options before the verb: -C <dir>, -c k=v, --git-dir, --work-tree
    while a and a[0].startswith("-"):
        if a[0] == "-C" and len(a) > 1:
            here, a = resolve(a[1], here), a[2:]
        elif a[0] in ("-c", "--git-dir", "--work-tree", "--namespace", "--exec-path") and len(a) > 1:
            if a[0] == "--work-tree":
                here = resolve(a[1], here)
            a = a[2:]
        elif a[0].startswith("--work-tree="):
            here, a = resolve(a[0].split("=", 1)[1], here), a[1:]
        else:
            a = a[1:]
    targets.add(here)
    if not a:
        hidden += found
        continue
    verb = a[0]
    # 1. another session's worktree
    if verb == "worktree" and a[1:2] == ["remove"]:
        for p in a[2:]:
            m = re.search(r"/claude-\d+/[^/]+/([0-9a-f-]{36})/", p + "/")
            if m and sid and m.group(1) != sid:
                print(f"`git worktree remove {p}` targets another Claude session's worktree ({m.group(1)[:8]}), not this one's ({sid[:8]}).")
                raise SystemExit
        hidden += found
        continue
    plain = [x for x in a[1:] if not x.startswith("-")]
    destroys = (
        (verb == "checkout" and ("--" in a or "." in a[1:] or "-f" in a or "--force" in a
                                 or (len(plain) >= 2 and not {"-b", "-B", "--orphan"} & set(a))))
        or (verb == "switch" and bool({"-f", "--force", "--discard-changes"} & set(a)))
        or (verb == "restore" and "--staged" not in a)
        or (verb == "reset" and ("--hard" in a or "--merge" in a or "--keep" in a))
        or (verb == "clean" and any(x.startswith("-") and "f" in x for x in a[1:]))
        or (verb == "stash" and (len(a) == 1 or a[1] in ("drop", "clear") or (a[1] == "push" and "-m" not in a)))
    )
    # This call accounts for at most one phrase in its own text; any other
    # phrase in the piece ($(...), an alias) is hidden.
    hidden += max(0, found - (1 if destroys and PHRASE.search(" ".join(a)) else 0))
    if destroys:
        for d in ([here] + sorted(targets - {here}) if uncertain else [here]):
            if repo_dirty(d, untracked=(verb == "clean")):
                print(f"`git {' '.join(a)}` would throw away uncommitted work in {d}, and other tabs share this checkout.")
                raise SystemExit
# A phrase no parsed git call accounts for: something the parser can't see
# runs it (eval, sh -c, $x). Judge the cwd and every directory the text names.
if hidden:
    for m in re.finditer(r"(?:-C|cd|pushd|--work-tree=?|GIT_WORK_TREE=)\s*(\S+)", dequote(body)):
        targets.add(resolve(m.group(1).rstrip(";)&|"), cwd))
    first = PHRASE.search(dequote(body))
    for t in sorted(targets):
        if repo_dirty(t, untracked=True):
            print(f"this runs `{first.group(1) if first else 'a destructive git verb'}`, which would throw away uncommitted work in {t}.")
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
