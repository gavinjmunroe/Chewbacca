#!/bin/bash
# lesson-guard refuses three repeated mistakes: a long check in the foreground
# (feedback_nothing_takes_this_long), 3D work without Nalana
# (feedback_3d_means_nalana), and a new project started without a look for the
# existing one (feedback_find_the_existing_thing_first). Ordinary commands pass.
set -u
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/lesson-guard.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export HOME="$T/home" CHEWBACCA_HOME="$T/chew" CHEWBACCA_LOG_DIR="$T/logs"
mkdir -p "$HOME/code/amber/amber-circles/.git" "$HOME/code/tools/kyber/.git"
fail=0
bash_call() {  # command, background(true|false)
  jq -nc --arg c "$1" --argjson b "${2:-false}" \
    '{tool_name:"Bash", session_id:"s1", cwd:"/Users/fixture/code", tool_input:{command:$c, run_in_background:$b}}'
}
agent_call() { jq -nc --arg p "$1" '{tool_name:"Agent", session_id:"s1", tool_input:{prompt:$p, description:"x"}}'; }
expect() {  # code, label, payload
  got=$(printf '%s' "$3" | bash "$HOOK" 2>"$T/err"; echo $?)
  [ "$got" = "$1" ] || { echo "FAIL: expected $1, got $got: $2"; cat "$T/err"; fail=1; }
}
expect 2 "whole suite in the foreground" "$(bash_call 'bash tests/run.sh > /tmp/x.log 2>&1')"
expect 0 "whole suite in the background" "$(bash_call 'bash tests/run.sh' true)"
expect 2 "slow group in the foreground" "$(bash_call 'cd ~/code/chewbacca && bash tests/run.sh installer 2>&1 | tail -8')"
expect 2 "named slow group with a space" "$(bash_call "bash tests/run.sh 'reasoning backends'")"
expect 0 "quick group" "$(bash_call 'bash tests/run.sh people')"
expect 0 "reading run.sh is not running it" "$(bash_call 'grep -n group tests/run.sh')"
expect 2 "closeout in the foreground" "$(bash_call 'cd ~/code/chewbacca && bin/closeout; echo exit=$?')"
expect 2 "doctor in the foreground" "$(bash_call 'bash doctor.sh 2>&1 | grep -i fail')"
expect 0 "an explicit foreground override" "$(bash_call 'CHEWBACCA_FOREGROUND_OK=1 bash tests/run.sh hud')"
expect 0 "an ordinary command" "$(bash_call 'ls -la')"
expect 2 "headless blender" "$(bash_call 'blender -b scene.blend -o //out -f 1')"
expect 0 "blender version check" "$(bash_call 'blender --version')"
expect 2 "3D brief without Nalana" "$(agent_call 'Make a 3D render of the dorm room diorama for the hero')"
expect 0 "3D brief naming Nalana" "$(agent_call 'Make a 3D scene in Nalana via the blender MCP tools')"
expect 0 "React render is not 3D" "$(agent_call 'Fix the list so it does not re-render on every keystroke')"
expect 2 "new repo, first time" "$(bash_call 'git init amber-keyboard')"
grep -q "amber-circles" "$T/err" || { echo "FAIL: the closest existing repo was not named"; fail=1; }
expect 0 "same new repo, second time" "$(bash_call 'git init amber-keyboard')"
# 2026-10-12: one look per project, whatever command starts it. The weekly
# false-positive report found `git init` then `gh repo create` for one folder
# refused twice, and the second rerun unchanged.
expect 2 "git init after a cd, first time" "$(bash_call 'mkdir -p ~/code/design-quiz2 && cd ~/code/design-quiz2 && git init -q')"
expect 0 "gh repo create for the project already looked at" "$(bash_call 'cd ~/code/design-quiz2 && gh repo create calebnewtonusc/design-quiz2 --private --source=. --push')"
expect 2 "a different project still gets its look" "$(bash_call 'gh repo create calebnewtonusc/marketing-midterm --private')"
expect 0 "scaffold in a scratch dir" "$(jq -nc '{tool_name:"Bash", session_id:"s1", cwd:"/private/tmp/x/scratchpad", tool_input:{command:"npx create-next-app demo"}}')"
expect 0 "git init mention inside another command" "$(bash_call 'echo git init is how you start')"

# Runtime, recorded in docs/plans/REPEAT-MISTAKES.md. The fast path is every
# Bash call that names none of these; the slow path parses in python.
start=$(perl -MTime::HiRes=time -e 'printf "%d", time*1000')
for _ in 1 2 3 4 5 6 7 8 9 10; do bash_call 'ls -la' | bash "$HOOK" >/dev/null 2>&1; done
fast=$(( ($(perl -MTime::HiRes=time -e 'printf "%d", time*1000') - start) / 10 ))
start=$(perl -MTime::HiRes=time -e 'printf "%d", time*1000')
for _ in 1 2 3 4 5; do bash_call 'bash tests/run.sh people' | bash "$HOOK" >/dev/null 2>&1; done
slow=$(( ($(perl -MTime::HiRes=time -e 'printf "%d", time*1000') - start) / 5 ))
echo "lesson-guard: fast path ${fast} ms, parse path ${slow} ms (load $(sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}'))"
[ $fail = 0 ] && echo "lesson-guard: ok"
exit $fail
