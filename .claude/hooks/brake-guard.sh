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
# Refuses, judged per simple command by its own words (so `echo "rm -rf ~"`
# or a grep for it passes), with a `bash -c` body read as commands too:
#   1. rm -rf, -fr, -Rf or --recursive --force on ~, ~/, ~/*, $HOME, / or /*
#   2. git push with a force flag (or a +refspec) that names main or master,
#      or names no branch, HEAD or @ while main or master is checked out
#      (a branch it can't read counts as main)
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
cwd = str(data.get("cwd") or os.getcwd())
home = os.path.normpath(os.path.expanduser("~"))
# The flag groups the gate words in the header admit. A group outside them is
# skipped by hookd before this runs, so judging it here would mean nothing.
RF_STARTS = ("-rf", "-fr", "-vrf", "-rvf", "-fvr", "-vfr")
SHELLS = {"bash", "sh", "zsh", "dash", "ksh"}
WRAPPERS = {"sudo", "command", "nice", "time", "nohup", "env", "exec", "xargs", "builtin"}

def segments(text, depth=0):
    """Simple commands, with a `bash -c` body read as commands too."""
    for seg in re.split(r"&&|\|\||;|\n|\||&|\$\(|`|\(|\)|\{|\}", text):
        w = words(seg.strip())
        if not w:
            continue
        if depth < 3 and os.path.basename(w[0]) in SHELLS and "-c" in w[1:]:
            i = w.index("-c")
            if i + 1 < len(w):
                yield from segments(w[i + 1], depth + 1)
                continue
        yield seg.strip(), w

def words(seg):
    try:
        w = shlex.split(seg, posix=True)
    except ValueError:
        w = seg.split()
    while w and (re.match(r"^[A-Za-z_]\w*=", w[0]) or os.path.basename(w[0]) in WRAPPERS
                 or (w[0].startswith("-") and len(w) > 1)):
        w = w[1:]
    return w

def target(a):
    """The path an rm argument names, with ~ and $HOME read the way a shell would."""
    a = re.sub(r"^(\$\{HOME\}|\$HOME)(?=/|$)", home, a)
    a = os.path.expanduser(a)
    star = a.endswith("/*")
    base = os.path.normpath(a[:-2] if star else a) if a not in ("/", "/*") else "/"
    return base

def rm_home(w):
    if not w or os.path.basename(w[0]) != "rm":
        return False
    shorts = [a.lower() for a in w[1:] if a.startswith("-") and not a.startswith("--")]
    long = {a for a in w[1:] if a.startswith("--")}
    rf = any(g.startswith(RF_STARTS) for g in shorts) or (
        "--recursive" in long and ("--force" in long or any("f" in g for g in shorts)))
    return rf and any(target(a) in (home, "/") for a in w[1:] if not a.startswith("-"))

def current_branch():
    try:
        out = subprocess.run(["git", "-C", cwd, "symbolic-ref", "--short", "-q", "HEAD"],
                             capture_output=True, text=True, timeout=3)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return out.stdout.strip() or None

MAIN = re.compile(r"(^|[:+/])(main|master)$")

def force_main(w):
    if len(w) < 2 or os.path.basename(w[0]) != "git":
        return False
    i = 1
    while i < len(w) and w[i].startswith("-"):
        i += 2 if w[i] in ("-C", "-c") else 1
    if i >= len(w) or w[i] != "push":
        return False
    rest = w[i + 1:]
    opts = [a for a in rest if a.startswith("-")]
    args = [a for a in rest if not a.startswith("-")]
    forced = any(a == "-f" or a.startswith("--force") or (re.match(r"^-[a-z]+$", a) and "f" in a) for a in opts) \
        or any(a.startswith("+") for a in args[1:])
    if not forced:
        return False
    refs = [r.lstrip("+") for r in args[1:]]
    if any(MAIN.search(r) for r in refs):
        return True
    # No branch named, or HEAD / @: it pushes what is checked out. Unknown
    # counts as main, so a failed lookup refuses rather than lets through.
    if not refs or any(r.split(":")[0] in ("HEAD", "@") and (":" not in r or not r.split(":")[1]) for r in refs):
        branch = current_branch()
        return branch is None or branch in ("main", "master")
    return False

for seg, w in segments(cmd):
    if rm_home(w):
        print("brake-guard: refusing `" + seg[:80] + "`. It deletes your home folder or the whole disk, and there is no undo.")
        break
    if force_main(w):
        print("brake-guard: refusing `" + seg[:80] + "`. A force push to main rewrites history everyone else has pulled. Push a branch, or push without --force.")
        break
')
[ -n "$REASON" ] || exit 0
echo "$REASON" >&2
exit 2
