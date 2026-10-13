#!/bin/bash
# The full suite refuses to run twice in one agent session on a tree that has
# not changed. tests/run.sh calls this before it starts a full run, so the
# check sits where the six minutes are spent, not in front of every shell
# command.
#
#   suite-gate.sh <repo>     exit 0 to run, 2 to refuse (reason on stderr)
#
# It replaces .claude/hooks/suite-rerun-guard.sh, which read every Bash
# command that named tests/run.sh and guessed whether it ran the suite. Over
# 2026-10-06 to 10-13 that hook refused 26 calls: 4 were real repeat runs and
# 22 were greps, awks, sed patches and pgrep loops that only named the file
# (tools/hookd_replay.py over the week's transcripts). Here nothing is
# guessed: this file only runs when the suite does, from any shell, script,
# job or agent.
#
# The session is CHEWBACCA_AGENT_SESSION when set (chewbacca jobs passes the
# submitter's, so a job started by another tab's tick is not judged as that
# tab), else CLAUDE_CODE_SESSION_ID. No session (CI, a person in a terminal)
# means no gate. CHEWBACCA_SUITE_RERUN=1 lets a killed run go again.
set -uo pipefail

repo="${1:-}"
[ -n "$repo" ] || exit 0
[ "${CHEWBACCA_SUITE_RERUN:-}" = 1 ] && exit 0
if [ -n "${CHEWBACCA_AGENT_SESSION+x}" ]; then
  session="$CHEWBACCA_AGENT_SESSION"
else
  session="${CLAUDE_CODE_SESSION_ID:-}"
fi
[ -n "$session" ] || exit 0
repo="$(git -C "$repo" rev-parse --show-toplevel 2>/dev/null)" || exit 0

# The same fingerprint the hook took: HEAD, the raw index, and every tracked
# and untracked file's bytes. git only lists here, never reads content, so a
# repo's clean filter, fsmonitor or external diff can't run (security review
# of 596584a, 2026-10-03).
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
# link to /dev/zero or a FIFO would otherwise hang.
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

# Its own folder, not the hook's suite-runs: while both are installed the hook
# records a run before this file sees it, and a shared record would refuse
# the first run.
state="${CHEWBACCA_HOME:-$HOME/.chewbacca}/state/suite-gate"
mkdir -p "$state" 2>/dev/null || exit 0
key="$state/$(printf '%s:%s' "$session" "$repo" | shasum -a 256 | cut -c1-24)"

if [ -f "$key" ] && [ "$(cat "$key")" = "$fingerprint" ]; then
  cat >&2 <<EOF
suite-gate: refusing a second full suite run with nothing changed.

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
