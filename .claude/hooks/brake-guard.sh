#!/bin/bash
# hookd skips this guard for a Bash call that names none of these words.
# Not `rm` and not `-r`: gate words match the whole payload, "rm" is inside
# "permission_mode" on every call and "-r" inside any path like my-repo or a
# -Users-rachel project folder, so both gated nothing (replay, 10/13: skip 0
# of 800). The rm check below acts only on these spellings, so the gate is
# sound: -rf covers -rf and -Rf (words match lowercased), -fr covers -fR.
# gate: -rf -fr -vrf -rvf -fvr -vfr --recursive push
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init brake-guard.sh 5
# PreToolUse, runtime installs: the two commands with no undo that the full
# installer denies in settings.json (setup.sh: Bash(rm -rf ~), Bash(git push
# --force*)). The runtime install promises no permission changes, so it had
# no brake at all: the 10/12 stranger run let `rm -rf ~` and a force push to
# main straight through, where Caleb's install refused both. This is that
# brake as a check, for any user, without touching their permissions.
#
# Refuses, reading the command the way the shell does: separators inside
# quotes separate nothing, a $( ) or backtick body and a bash -c / -lc or
# eval body are commands of their own, sudo, nice, timeout, env and xargs are
# unwrapped with their option values, and a literal cd moves where relative
# paths point (so `echo "rm -rf ~"` passes and `cd ~ && rm -rf *` doesn't):
#   1. rm -rf (or -fr, -Rf, --recursive --force) of /, your home, or a folder
#      that holds your home, by any spelling: ~, $HOME, ${HOME}, ~/.., . or *
#      after a cd there. A relative . or * where the folder can't be known
#      counts as deadly.
#   2. a forced git push unless every destination it names is a branch other
#      than main or master. No branch, HEAD or @ is read as the checked-out
#      branch (at -C and after a cd); a branch it can't read (GIT_DIR,
#      --git-dir, a checkout or switch in the command), a computed or
#      $variable branch, a glob, a bare :, --all, --mirror or --branches
#      counts as main. --force-if-includes alone is not a force.
# A backstop for accidents, not a sandbox: a determined spelling can still
# get past a text reader (team lesson feedback_denylist_gate_is_a_backstop:
# a word-list gate never converges). Four reviews on 10/13 closed every
# spelling they found; the next one goes in tests/test_brake_guard.py.
command -v python3 >/dev/null 2>&1 || exit 0
INPUT=$(cat)
REASON=$(printf '%s' "$INPUT" | python3 -I -c '
import json, os, re, shlex, subprocess, sys
try:
    data = json.load(sys.stdin)
except ValueError:
    raise SystemExit
if data.get("tool_name") != "Bash":
    raise SystemExit
cmd = str((data.get("tool_input") or {}).get("command") or "")
start_dir = str(data.get("cwd") or os.getcwd())
home = os.path.normpath(os.path.expanduser("~"))
SUBST = "__subst__"
# A cd inside ( ), a pipeline or a substitution runs in a subshell and moves
# nothing after it; once flattened that cannot be told apart, so any cd in a
# command shaped like that leaves the folder unknown (fail closed).
CD_UNSURE = bool(re.search(r"[()|`]|\$\(", cmd))
# The flag groups the gate words in the header admit. A group outside them is
# skipped by hookd before this runs, so judging it here would mean nothing.
RF_STARTS = ("-rf", "-fr", "-vrf", "-rvf", "-fvr", "-vfr")
SHELLS = {"bash", "sh", "zsh", "dash", "ksh"}
# Wrappers and the options of theirs that take a value.
WRAP_VALUE_OPTS = {
    "sudo": {"-u", "-g", "-C", "-h", "-p", "-r", "-t", "-U", "-D"},
    "nice": {"-n"},
    "timeout": {"-s", "-k"},
    "env": {"-u", "-C"},
    "exec": {"-a"},
    "xargs": {"-n", "-I", "-L", "-P", "-d", "-s", "-E", "-a"},
    "command": set(), "builtin": set(), "nohup": set(), "time": set(), "nocorrect": set(), "noglob": set(),
}
MAIN = re.compile(r"(^|[:+/])(main|master)$")


def find_close(text, i):
    """Index of the ) closing the $( that opens at i, or len(text)."""
    depth, j, q = 0, i + 1, None
    while j < len(text):
        c = text[j]
        if q:
            if c == "\\" and q == "\"":
                j += 2
                continue
            if c == q:
                q = None
        elif c in "\"\x27":
            q = c
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return j
        j += 1
    return len(text)


def split_commands(text, depth=0):
    """Simple commands in run order, read the way the shell reads them: a
    separator inside quotes separates nothing, and a $( ) or backtick body
    runs (first) even inside double quotes, so it is a command of its own."""
    out, cur, i, q = [], [], 0, None
    def flush():
        piece = "".join(cur).strip()
        if piece:
            out.append(piece)
        cur.clear()
    while i < len(text):
        c = text[i]
        if q == "\x27":
            cur.append(c)
            q = None if c == "\x27" else q
            i += 1
            continue
        if c == "\\" and i + 1 < len(text):
            cur.append(text[i:i + 2])
            i += 2
            continue
        if text.startswith("$(", i) and not text.startswith("$((", i):
            end = find_close(text, i + 1)
            if depth < 4:
                out.extend(split_commands(text[i + 2:end], depth + 1))
            cur.append(SUBST)
            i = end + 1
            continue
        if c == "`":
            end = text.find("`", i + 1)
            end = len(text) if end < 0 else end
            if depth < 4:
                out.extend(split_commands(text[i + 1:end], depth + 1))
            cur.append(SUBST)
            i = end + 1
            continue
        if q == "\"":
            cur.append(c)
            q = None if c == "\"" else q
            i += 1
            continue
        if c in "\"\x27":
            q = c
            cur.append(c)
            i += 1
            continue
        if c in ";&|\n()":
            flush()
            i += 1
            continue
        cur.append(c)
        i += 1
    flush()
    return out


def words(seg):
    try:
        w = shlex.split(seg, posix=True)
    except ValueError:
        w = seg.split()
    while w:
        head = os.path.basename(w[0])
        if re.match(r"^[A-Za-z_]\w*=", w[0]) or w[0] in ("{", "}", "!"):
            w = w[1:]
            continue
        if head == "eval":
            return ["eval"] + w[1:]
        if head not in WRAP_VALUE_OPTS:
            break
        takes = WRAP_VALUE_OPTS[head]
        w = w[1:]
        while w and (w[0].startswith("-") or re.match(r"^[A-Za-z_]\w*=", w[0])):
            opt = w[0]
            if head == "env" and opt in ("-S", "--split-string") and len(w) > 1:
                # env -S runs its value split into words: the command itself.
                try:
                    w = shlex.split(w[1], posix=True) + w[2:]
                except ValueError:
                    w = w[1].split() + w[2:]
                break
            w = w[2:] if opt in takes else w[1:]
        if head == "timeout" and w:
            w = w[1:]
    while w and w[-1] == "}":
        w = w[:-1]
    return w


def expand(a):
    a = re.sub(r"^(\$\{HOME\}|\$HOME)(?=/|$)", home, a)
    return os.path.expanduser(a)


def resolve(a, here):
    """The directory an rm argument removes, or None when it cannot be known.
    A trailing * or /* is the folder it empties."""
    a = expand(a)
    if SUBST in a or "$" in a or "`" in a:
        return None
    # A last part made only of wildcards (*, .*, .??*, [!.]*) empties the
    # folder above it; one with a name in it (*.log) does not.
    parent, _, last = a.rpartition("/")
    if last and re.fullmatch(r"[*?.\[\]!]+", last) and any(ch in last for ch in "*?["):
        a = (parent or "/") if "/" in a else "."
    if os.path.isabs(a):
        return os.path.normpath(a)
    if here is None:
        return "" if a in (".", "./", "..", "../") else None
    return os.path.normpath(os.path.join(here, a))


def deadly(path):
    """/, your home, or a folder that holds your home."""
    if path == "":
        return True
    return path == "/" or path == home or home.startswith(path.rstrip("/") + "/")


def rm_home(w, here):
    if not w or os.path.basename(w[0]) != "rm":
        return False
    shorts = [a.lower() for a in w[1:] if a.startswith("-") and not a.startswith("--") and a != "-"]
    long = {a for a in w[1:] if a.startswith("--")}
    rf = any(g.startswith(RF_STARTS) for g in shorts) or (
        "--recursive" in long and ("--force" in long or any("f" in g for g in shorts)))
    if not rf:
        return False
    args, after_dashes = [], False
    for a in w[1:]:
        if a == "--":
            after_dashes = True
            continue
        if a.startswith("-") and not after_dashes:
            continue
        args.append(a)
    for a in args:
        p = resolve(a, here)
        if p is not None and deadly(p):
            return True
    return False


def branch_at(where):
    if where is None or re.search(r"\b(checkout|switch|worktree)\b", cmd) \
            or re.search(r"\bGIT_(DIR|WORK_TREE|NAMESPACE)=", cmd):
        return None
    try:
        out = subprocess.run(["git", "-C", where, "symbolic-ref", "--short", "-q", "HEAD"],
                             capture_output=True, text=True, timeout=3)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return out.stdout.strip() or None


def force_main(w, here):
    """A forced push gets through only when every destination it names is a
    branch other than main or master. Anything it cannot pin down counts as
    main: no branch, HEAD or @ where the branch cannot be read, a computed
    or $variable branch, a glob, a bare :, --all, --mirror, --branches."""
    if len(w) < 2 or os.path.basename(w[0]) != "git":
        return False
    i, where = 1, here
    while i < len(w) and w[i].startswith("-"):
        if w[i] == "-C" and i + 1 < len(w):
            where = None if where is None else os.path.join(where, expand(w[i + 1]))
        if w[i].startswith(("--git-dir", "--work-tree", "--namespace")):
            where = None
        i += 2 if w[i] in ("-C", "-c") else 1
    if i >= len(w) or w[i] != "push":
        return False
    rest = w[i + 1:]
    opts = [a for a in rest if a.startswith("-")]
    args = [a for a in rest if not a.startswith("-")]
    forced = any((a.startswith("--force") and a != "--force-if-includes")
                 or (re.match(r"^-[a-zA-Z]+$", a) and "f" in a) for a in opts) \
        or any(a.startswith("+") for a in args[1:])
    if not forced:
        return False
    if any(a in ("--all", "--mirror", "--branches") for a in opts):
        return True

    def checked_out_is_main():
        branch = branch_at(where)
        return branch is None or branch in ("main", "master")

    refs = args[1:]
    if not refs:
        return checked_out_is_main()
    for ref in refs:
        r = ref.lstrip("+")
        if SUBST in r or "$" in r or "`" in r or r == ":" or "*" in r:
            return True
        dst = r.split(":", 1)[1] if ":" in r else r
        if dst in ("", "HEAD", "@"):
            if checked_out_is_main():
                return True
            continue
        if MAIN.search(dst):
            return True
    return False


def judge(text, here, depth=0):
    for seg in split_commands(text):
        w = words(seg)
        if not w:
            continue
        head = os.path.basename(w[0])
        if head == "eval" and depth < 4:
            hit = judge(" ".join(w[1:]), here, depth + 1)
            if hit:
                return hit
            continue
        if head in SHELLS and depth < 4:
            flag = next((k for k, a in enumerate(w[1:], 1) if re.match(r"^-[a-zA-Z]*c[a-zA-Z]*$", a)), None)
            if flag is not None:
                k = flag + 1
                while k < len(w) and (w[k].startswith(("-", "+"))):
                    k += 2 if w[k] in ("-o", "+o", "-O", "+O") else 1
                if k < len(w):
                    hit = judge(w[k], here, depth + 1)
                    if hit:
                        return hit
                    continue
        if head in ("cd", "pushd", "popd"):
            targets = w[1:]
            while targets and targets[0] in ("-P", "-L", "-e", "-@", "--"):
                targets = targets[1:]
            if CD_UNSURE or head == "popd" or (targets and targets[0].startswith("-")):
                here = None
            elif not targets:
                here = home
            else:
                t = expand(targets[0])
                here = None if (SUBST in t or "$" in t or here is None and not os.path.isabs(t)) \
                    else os.path.normpath(os.path.join(here or "/", t))
            continue
        if rm_home(w, here):
            return ("brake-guard: refusing `" + seg[:80] + "`. It deletes your home folder or the whole disk, "
                    "and there is no undo.")
        if force_main(w, here):
            return ("brake-guard: refusing `" + seg[:80] + "`. A force push to main rewrites history everyone "
                    "else has pulled. Push a named branch, or push without --force.")
    return None


reason = judge(cmd, start_dir)
if reason:
    print(reason)
')
[ -n "$REASON" ] || exit 0
echo "$REASON" >&2
exit 2
