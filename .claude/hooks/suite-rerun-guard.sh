#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init suite-rerun-guard.sh 10
# PreToolUse (Bash): refuse a second full `tests/run.sh` in one session when
# the repository has not changed since the last one.
#
# 2026-10-03. Saving work Codex left behind took most of an afternoon, and the
# largest single cost was the full suite run four times, about 15 minutes
# each, twice with nothing new to test. Caleb: "Smth's gotta be wrong with our
# process if it's taking this long every time." The suite went parallel the
# same day (6 minutes), and the rule "touched tests first, whole suite once"
# went into the agent instructions, where nothing stopped it being skipped.
#
# A full run is only refused when the tree is byte-identical to the last full
# run this session started: same HEAD, same diff, same untracked files. A run
# that was killed and genuinely needs repeating passes with
# CHEWBACCA_SUITE_RERUN=1 in front of the command.
set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0

payload="$(cat)"
[ "$(printf '%s' "$payload" | jq -r '.tool_name // empty')" = "Bash" ] || exit 0
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty')"
[ -n "$cmd" ] || exit 0

# Full suite only: run.sh followed by nothing but redirects. `tests/run.sh
# hud` names a group and is always allowed.
# Only an EXECUTION of the full suite counts. On 2026-10-06 `grep ...
# tests/run.sh | head` and `sed -n ... tests/run.sh;` each recorded a
# fingerprint as if the suite had run, so the next command, `bash -n
# tests/run.sh && ...`, was refused as a repeat and the edits chained after it
# never happened. A first fix allowlisted wrappers (bash, time, nohup) and a
# review the same night found it missed `timeout 900 bash tests/run.sh`,
# `caffeinate -i ...` and a quoted path. So this is a blocklist: run.sh is
# executed unless the command word only READS it, or the shell is `-n`.
CMD="$cmd" python3 -I -c '
import os, re, shlex, sys
READERS = {"grep", "egrep", "fgrep", "rg", "sed", "awk", "cat", "head", "tail", "less",
           "more", "wc", "diff", "cp", "mv", "ls", "git", "echo", "printf", "stat",
           "file", "shellcheck", "shfmt", "open", "code", "vim", "nano", "bat", "touch", "chmod"}
SEP = r"&&|\|\||;|\n|\|(?!\|)|(?<![>&])&(?![>&])|[()`]"
for seg in re.split(SEP, os.environ["CMD"]):
    if "tests/run.sh" not in seg:
        continue
    try:
        toks = shlex.split(seg)
    except ValueError:
        toks = seg.split()
    while toks and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", toks[0]):
        toks.pop(0)
    if not toks or os.path.basename(toks[0]) in READERS:
        continue
    at = next((i for i, t in enumerate(toks) if t.endswith("tests/run.sh")), None)
    if at is None or "-n" in toks[1:at]:
        continue
    rest, i, group = toks[at + 1:], 0, False
    while i < len(rest):
        t = rest[i]
        if re.match(r"^(\d*>>?|&>>?|<)$", t):
            i += 2; continue
        if re.match(r"^(\d*>>?|&>>?|<)", t):
            i += 1; continue
        group = True; break
    if not group:
        sys.exit(0)
sys.exit(1)
' || exit 0
printf '%s' "$cmd" | grep -q 'CHEWBACCA_SUITE_RERUN=1' && exit 0

# The repository is the one the script lives in when the path is absolute,
# otherwise the working directory's.
script="$(printf '%s' "$cmd" | grep -oE '[^[:space:]"'\'']*tests/run\.sh' | head -1)"
case "$script" in
  /*) dir="${script%/tests/run.sh}" ;;
  '~'*) dir="$HOME${script#\~}"; dir="${dir%/tests/run.sh}" ;;
  *)  dir="$(printf '%s' "$payload" | jq -r '.cwd // empty')" ;;
esac
repo="$(git -C "${dir:-.}" rev-parse --show-toplevel 2>/dev/null)" || exit 0

# This runs BEFORE the command is approved, inside whatever repo the command
# names, so the repo's own config must not get to run anything. `git diff`
# applies a repo's clean filter to every modified file and no flag stops it,
# which the security review of 596584a found on 2026-10-03; an fsmonitor or
# external diff would run too. So git only LISTS here, never reads content:
# HEAD, the raw index, and the file names. The bytes are hashed by shasum.
safe_git() {
  git -c core.fsmonitor=false -c core.untrackedCache=false -c core.hooksPath=/dev/null "$@"
}
fingerprint="$(
  cd "$repo" || exit 0
  safe_git rev-parse HEAD 2>/dev/null
  safe_git ls-files -s -z 2>/dev/null
  { safe_git ls-files -z 2>/dev/null; safe_git ls-files -o --exclude-standard -z 2>/dev/null; } \
    | python3 -I -c '
import hashlib, os, stat, sys
# Regular files by content, symlinks by target, nothing else opened: a tracked
# link to /dev/zero or a FIFO would otherwise hang the hook.
h = hashlib.sha256()
for name in sorted(set(sys.stdin.buffer.read().split(b"\0")) - {b""}):
    h.update(name + b"\0")
    try:
        info = os.lstat(name)
    except OSError:
        h.update(b"missing"); continue
    if stat.S_ISLNK(info.st_mode):
        h.update(b"link" + os.readlink(name))
    elif stat.S_ISREG(info.st_mode):
        with open(name, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
    else:
        h.update(b"other")
print(h.hexdigest())' 2>/dev/null
)"
fingerprint="$(printf '%s' "$fingerprint" | shasum -a 256 | cut -d' ' -f1)"

session="$(printf '%s' "$payload" | jq -r '.session_id // "unknown"')"
state="${CHEWBACCA_HOME:-$HOME/.chewbacca}/state/suite-runs"
mkdir -p "$state" 2>/dev/null || exit 0
key="$state/$(printf '%s:%s' "$session" "$repo" | shasum -a 256 | cut -c1-24)"

if [ -f "$key" ] && [ "$(cat "$key")" = "$fingerprint" ]; then
  cat >&2 <<EOF
suite-rerun-guard: refusing a second full suite run with nothing changed.

$repo is byte-identical to the last full tests/run.sh this session started,
so it would print the same verdict again after six minutes. Read the result
you already have. To check one area, run its group: bash tests/run.sh <group>
(bash tests/run.sh --list names them).

If the last run was killed and really needs repeating, prefix the command
with CHEWBACCA_SUITE_RERUN=1.
EOF
  exit 2
fi
printf '%s' "$fingerprint" > "$key"
exit 0
