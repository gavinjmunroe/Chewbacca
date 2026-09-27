#!/bin/bash
# zsh-guard must refuse the three commands that each cost a re-run on
# 2026-09-27, and pass ordinary commands, including ones that only MENTION
# the traps inside a heredoc or single quotes. A guard nobody has seen refuse
# anything proves nothing, so both directions are asserted.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
H="$ROOT/.claude/hooks/zsh-guard.sh"
export ZSH_GUARD_SHELL=zsh
pass=0; fail=0
t() { # name, expected_exit, command
  out=$(printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$3")" | bash "$H" 2>&1 >/dev/null)
  rc=$?
  if [ "$rc" = "$2" ]; then pass=$((pass+1)); else echo "  FAIL $1 (exit $rc, wanted $2) $out"; fail=$((fail+1)); fi
}
# The three real commands, trimmed.
t "for path in"          2 'for path in "/" "/make"; do echo "$path" | sed s/a/b/; done'
t "path assignment"      2 'path=/tmp/x; ls $path'
t "\$G[v] in a filter"   2 'G="fps=30"; ffmpeg -filter_complex "[0:v]scale=1:1,$G[v]" -map "[v]" out.mp4'
t "flags in a variable"  2 'F="-threads 2"; ffmpeg $F -i in.webm out.mp4'
t "braced flags var"     2 'F="-loglevel error"; ffmpeg ${F} -i a b'
# Ordinary commands.
t "renamed loop var"     0 'for route in "/" "/make"; do echo "$route"; done'
t "braced subscript"     0 'G="fps=30"; ffmpeg -filter_complex "[0:v]scale=1:1,${G}[v]" out.mp4'
t "quoted flags var"     0 'MSG="-x y"; echo "$MSG"'
t "PATH itself"          0 'export PATH="$HOME/bin:$PATH"'
t "awk field in quotes"  0 "awk '{print \$1[0]}' file"
t "heredoc mentions it"  0 'python3 - <<PY
print("for path in x: and $G[v] and F=\"-threads 2\"; ffmpeg $F")
PY'
t "commit msg about it"  0 'git commit -F - <<MSG
fix: for path in broke PATH, and $G[v] was a subscript
MSG'
t "blank line in heredoc" 0 'git commit -F - <<MSG
fix: title

for path in x, and F="-threads 2"; ffmpeg $F
MSG'
t "command after heredoc" 2 'cat <<EOF
hello
EOF
for path in a b; do echo $path; done'
t "variable named paths" 0 'for paths in a b; do echo $paths; done'
t "non-Bash tool"        0 'ignored'
# Not zsh: bash splits words and has no tied $path, so nothing to refuse.
ZSH_GUARD_SHELL=bash t "bash shell passes" 0 'F="-threads 2"; ffmpeg $F -i a b'
echo "zsh-guard: $pass passed, $fail failed"
[ "$fail" = 0 ]
