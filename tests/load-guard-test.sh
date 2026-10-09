#!/bin/bash
H="${LOAD_GUARD_HOOK:-$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/load-guard.sh}"
# Pin the load average. Without this the "single heavy job" case passes or
# fails depending on what the machine is doing, which it did on 2026-09-22.
export LOAD_GUARD_LOAD=1.0
pass=0; fail=0
t() { # name, expected_exit, command
  out=$(printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$3")" | bash "$H" 2>/dev/null)
  rc=$?
  if [ "$rc" = "$2" ]; then echo "  ok   $1 (exit $rc)"; pass=$((pass+1));
  else echo "  FAIL $1 (exit $rc, wanted $2)"; fail=$((fail+1)); fi
}
echo "SHOULD BLOCK (exit 2):"
t "xargs -P 6 whisper"        2 'cat ids.txt | xargs -P 6 -I{} yt-transcript {}'
t "parallel -j 8 ffmpeg"      2 'parallel -j 8 ffmpeg -i {} out.mp4 ::: *.mov'
t "unbounded & loop"          2 'for f in *.wav; do whisper "$f" & done'
t "xargs -P 4 mlx_whisper"    2 'ls | xargs -P 4 python3 -c "import mlx_whisper"'
echo "SHOULD PASS (exit 0):"
t "serial + nice 19"          0 'for x in a b; do nice -n 19 yt-transcript "$x"; done'
t "single whisper"            0 'yt-transcript abc123 --timestamps'
t "xargs -P 6, not heavy"     0 'cat urls.txt | xargs -P 6 -I{} curl -s {}'
t "grepping for whisper"      0 'grep -rn "whisper" notes/'
t "killing whisper"           0 'pkill -9 -f mlx_whisper'
t "writing about it"          0 'echo "we ran ffmpeg in parallel and it was bad" >> notes.md'
t "non-Bash tool"             0 'ignored'
# Regression, 2026-09-22: an hour after shipping, the guard blocked a heredoc
# that was WRITING about the incident, because the markdown said "6 local
# Whisper jobs". Data is not an invocation.
t "heredoc naming it"         0 'python3 - <<PY
s = "6 local Whisper jobs took his load to 50"
print(s)
PY'
t "quoted string only"        0 'echo "ffmpeg is what we used" >> notes.md'
# Regression, same day: the fan-out exception re-broke the data case. A commit
# message QUOTING a fan-out command is not a fan-out.
t "commit msg quoting it"     0 'git commit -F - <<MSG
Fix: xargs -P 4 python3 -c "import mlx_whisper" was the shape that broke it
MSG'

# Regression, 2026-09-27: a BLANK line inside a commit message ended the
# heredoc early, so the body after it was read as commands and a message
# mentioning ffmpeg was refused.
t "blank line in commit msg" 0 'git commit -F - <<MSG
feat: a title

the body mentions ffmpeg and whisper
MSG'
echo "SHOULD BLOCK ON LOAD (exit 2):"
LOAD_GUARD_LOAD=12.0 t "single job, busy machine" 2 'yt-transcript abc123 --timestamps'
# The 2026-09-27 regression only shows under load, which is when it bit: a
# lone heavy word is refused on a busy machine, so a commit message whose
# body sat after a blank line was refused at a load average of 10.8.
LOAD_GUARD_LOAD=12.0 t "busy, blank line in commit msg" 0 'git commit -F - <<MSG
feat: a title

the body mentions ffmpeg
MSG'
# Regression, 2026-10-09: on a machine at load 30 to 40, every one of these
# was refused. Each only names a heavy tool as an argument to a lookup, and a
# `2>&1` redirect was read as a background `&`, which switched the guard to
# reading the raw text, quotes included. Four lookups in a row were blocked
# while ingesting a friend's reels, and the work-around was prefixing reads
# with nice.
echo "BUSY, BUT ONLY LOOKING (exit 0):"
LOAD_GUARD_LOAD=30.0 t "command -v a heavy tool" 0 'for t in yt-dlp ffmpeg; do command -v $t; done; uptime'
LOAD_GUARD_LOAD=30.0 t "grep a cache for it" 0 'ls ~/.cache/huggingface/hub | grep -i whisper'
LOAD_GUARD_LOAD=30.0 t "git grep for its name" 0 'git ls-tree -r --name-only origin/main | grep -E "load-guard|yt-transcript"'
LOAD_GUARD_LOAD=30.0 t "2>&1 is a redirect" 0 'grep -rn "mlx_whisper" bin 2>&1 | head -1'
echo "BUSY AND REALLY RUNNING IT (exit 2):"
LOAD_GUARD_LOAD=30.0 t "redirected, still a job" 2 'cd /tmp && yt-transcript abc123 2>&1 | tail -1'
LOAD_GUARD_LOAD=30.0 t "python importing it" 2 'python3 -c "import mlx_whisper; mlx_whisper.transcribe(\"a.mp4\")"'
LOAD_GUARD_LOAD=30.0 t "after a semicolon" 2 'cd /tmp; ffmpeg -i a.mov b.mp4'
# Heavy work handed to the queue passes even on a busy Mac: the queue decides.
LOAD_GUARD_LOAD=30.0 t "jobs submit --heavy" 0 'jobs submit --heavy --title tx -- yt-bulk https://youtube.com/@x --out /tmp/x'
# 2026-10-10: a headless Nalana render sat at 305% CPU while the Mac swapped.
LOAD_GUARD_LOAD=30.0 t "nalana headless render" 2 '/Applications/Nalana.app/Contents/MacOS/Nalana -b --python shot6.py'
LOAD_GUARD_LOAD=1.0 t "nalana render, quiet machine" 0 '/Applications/Nalana.app/Contents/MacOS/Nalana -b --python shot6.py'
echo; echo "pass=$pass fail=$fail"
[ "$fail" = 0 ]
