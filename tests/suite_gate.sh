#!/bin/bash
# The full suite refuses a second run in one agent session on an unchanged
# tree, from tests/run.sh itself (bin/lib/suite-gate.sh), not from a guard
# reading every shell command. It permits a first run, a group, a run after
# any edit, a run with no agent session, and CHEWBACCA_SUITE_RERUN=1.
#
# 2026-10-13: suite-rerun-guard.sh refused 26 calls in a week; 4 were real
# repeat runs and 22 only named run.sh (grep, awk, sed, pgrep, a heredoc).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GATE="$ROOT/bin/lib/suite-gate.sh"
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export CHEWBACCA_HOME="$T/home"
unset CHEWBACCA_AGENT_SESSION CHEWBACCA_SUITE_RERUN
repo="$T/repo"; mkdir -p "$repo/tests"
git -C "$repo" init -q
printf 'echo hi\n' > "$repo/tests/run.sh"
git -C "$repo" add . && git -C "$repo" -c user.name=t -c user.email=t@t commit -qm base

gate() {  # label, wanted exit, session ('' for none), then env K=V...
  local label="$1" want="$2" s="$3"; shift 3
  env CLAUDE_CODE_SESSION_ID="$s" "$@" bash "$GATE" "$repo" >/dev/null 2>&1
  local got=$?
  if [ "$got" = "$want" ]; then ok "$label (exit $got)"; else no "$label: wanted $want got $got"; fi
}

if [ ! -f "$GATE" ]; then
  no "bin/lib/suite-gate.sh exists"
else
  s="s-$$-$RANDOM"
  echo "the gate:"
  gate "the first full run" 0 "$s"
  gate "a second full run on an unchanged tree" 2 "$s"
  gate "the same tree in another session" 0 "o-$s"
  gate "no agent session at all (CI, a terminal)" 0 ""
  gate "an explicit retry" 0 "$s" CHEWBACCA_SUITE_RERUN=1
  gate "a job's session wins over the tab that started it" 2 "other-tab" CHEWBACCA_AGENT_SESSION="$s"
  gate "a job with no recorded session is not judged as the tab's" 0 "$s" CHEWBACCA_AGENT_SESSION=
  printf 'changed\n' > "$repo/new.txt"
  gate "a run after the tree changed" 0 "$s"
  gate "and a repeat of that one" 2 "$s"

  echo "never runs the repo's own git programs:"
  marker="$T/pwned"
  git -C "$repo" config core.fsmonitor "touch $marker #"
  git -C "$repo" config diff.external "sh -c 'touch $marker'"
  git -C "$repo" config filter.evil.clean "sh -c 'touch $marker; cat'"
  printf '* filter=evil diff=evil\n' > "$repo/.gitattributes"
  git -C "$repo" config diff.evil.textconv "sh -c 'touch $marker; cat'"
  printf 'open("%s", "w").close()\nfrom _sha2 import *\n' "$marker" > "$repo/hashlib.py"
  (cd "$repo" && gate "a repo whose config names diff, filter and fsmonitor programs" 0 "x-$s")
  [ ! -e "$marker" ] && ok "none of those programs ran" || no "the gate executed a repo-configured program"
  ln -s /dev/zero "$repo/zero"
  start=$SECONDS
  gate "an untracked symlink to /dev/zero" 0 "z-$s"
  [ $((SECONDS - start)) -lt 5 ] && ok "and it does not hang on it" || no "hung reading a device"
fi

# tests/run.sh asks the gate before it starts any group. xargs is what starts
# the groups, so a stand-in xargs that leaves a marker shows whether a run
# began. The old run.sh started the suite here.
echo "tests/run.sh asks the gate first:"
shim="$T/shim"; mkdir -p "$shim"
printf '#!/bin/sh\ntouch "%s/started"\nexit 0\n' "$T" > "$shim/xargs"; chmod +x "$shim/xargs"
s2="run-$$-$RANDOM"
key_state() { CLAUDE_CODE_SESSION_ID="$s2" bash "$GATE" "$ROOT" >/dev/null 2>&1; }
if [ -f "$GATE" ]; then key_state; fi
rm -f "$T/started"
PATH="$shim:$PATH" CLAUDE_CODE_SESSION_ID="$s2" bash "$ROOT/tests/run.sh" >/dev/null 2>&1
rc=$?
if [ ! -e "$T/started" ] && [ "$rc" = 2 ]; then ok "a repeat full run stops before any group starts (exit $rc)"
else no "a repeat full run started the suite (exit $rc)"; fi
rm -f "$T/started"
PATH="$shim:$PATH" CLAUDE_CODE_SESSION_ID="$s2" CHEWBACCA_SUITE_RERUN=1 bash "$ROOT/tests/run.sh" >/dev/null 2>&1
[ -e "$T/started" ] && ok "CHEWBACCA_SUITE_RERUN=1 lets it start" || no "the retry override did not start the suite"

echo "chewbacca jobs hands the submitter's session to the job:"
grep -q 'CHEWBACCA_AGENT_SESSION=j.get("session")' "$ROOT/bin/chewbacca-jobs" \
  && ok "the job runs with the session it was submitted from" \
  || no "chewbacca-jobs does not pass the submitter's session"

[ "$fail" -eq 0 ] || exit 1
echo "suite-gate: $pass checks passed."
