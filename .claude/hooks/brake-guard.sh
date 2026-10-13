#!/bin/bash
# hookd skips this guard for a Bash call that names none of these words.
# Not `rm` and not `-r`: gate words match the whole payload, "rm" is inside
# "permission_mode" on every call and "-r" inside any path like my-repo or a
# -Users-rachel project folder, so both gated nothing (replay, 10/13: skip 0
# of 800). The rm check below acts only on these spellings, so the gate is
# sound: -rf covers -rf and -Rf (words match lowercased), -fr covers -fR.
# gate: -rf -fr --recursive push
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
# or a grep for it passes):
#   1. rm -rf, -fr, -Rf or --recursive --force on ~, ~/, ~/*, $HOME, / or /*
#   2. git push with a force flag (or a +refspec) that names main or master,
#      or names no branch at all (it pushes whatever is checked out)
command -v python3 >/dev/null 2>&1 || exit 0
INPUT=$(cat)
REASON=$(printf '%s' "$INPUT" | python3 -I -c '
import json, os, re, shlex, sys
try:
    data = json.load(sys.stdin)
except ValueError:
    raise SystemExit
if data.get("tool_name") != "Bash":
    raise SystemExit
cmd = str((data.get("tool_input") or {}).get("command") or "")
HOME_WORDS = {"~", "~/", "~/*", "$HOME", "$HOME/", "$HOME/*", "${HOME}", "${HOME}/", "${HOME}/*", "/", "/*"}
home = os.path.expanduser("~")
HOME_WORDS |= {home, home + "/", home + "/*"}
def words(seg):
    try:
        w = shlex.split(seg, posix=True)
    except ValueError:
        w = seg.split()
    while w and (re.match(r"^[A-Za-z_]\w*=", w[0]) or w[0] in ("sudo", "command", "nice", "time", "nohup")):
        w = w[1:]
    return w
def rm_home(w):
    if not w or os.path.basename(w[0]) != "rm":
        return False
    flags = "".join(a[1:] for a in w[1:] if a.startswith("-") and not a.startswith("--"))
    long = {a for a in w[1:] if a.startswith("--")}
    # Only the spellings the gate words see (header): a flag group that
    # starts -rf/-Rf or -fr/-fR, or --recursive with a force. setup.sh denies
    # `rm -rf ~` for the full install; this covers that and its reorderings.
    seen = [a.lower() for a in w[1:] if a.startswith("-")]
    rec = any(a.startswith("-rf") or a.startswith("-fr") for a in seen if not a.startswith("--")) \
        or ("--recursive" in long and ("--force" in long or "f" in flags))
    force = rec
    # shlex already expanded nothing: a quoted "$HOME" arrives as $HOME.
    return rec and force and any(a in HOME_WORDS for a in w[1:] if not a.startswith("-"))
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
    forced = any(a in ("-f", "--force") or a.startswith("--force") or (re.match(r"^-[a-z]+$", a) and "f" in a) for a in opts) \
        or any(a.startswith("+") for a in args[1:])
    if not forced:
        return False
    refs = args[1:]
    if not refs:
        return True
    return any(re.search(r"(^|[:+/])(main|master)$", r) for r in refs)
for seg in re.split(r"&&|\|\||;|\n|\|", cmd):
    w = words(seg.strip())
    if rm_home(w):
        print("brake-guard: refusing `" + seg.strip()[:80] + "`. It deletes your home folder or the whole disk, and there is no undo.")
        break
    if force_main(w):
        print("brake-guard: refusing `" + seg.strip()[:80] + "`. A force push to main rewrites history everyone else has pulled. Push a branch, or push without --force.")
        break
')
[ -n "$REASON" ] || exit 0
echo "$REASON" >&2
exit 2
