#!/usr/bin/env bash
# A Stop hook runs after the reply is already on Caleb's screen, so a refusal
# that asks for the reply to be rewritten or resent shows him a second copy.
# 2026-10-11: three replies in a row went out twice, and he wrote "You're
# repeating yourself the same message? ... you often do this". A Stop hook may
# ask for one short added line, never the reply again.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail=0
STOP_HOOKS=$(python3 - "$ROOT" <<'PY'
import re, sys, pathlib
root = pathlib.Path(sys.argv[1])
text = (root / "setup.sh").read_text()
names = set(re.findall(r'_register\("Stop", hooks_dir \+ "/([\w.-]+\.sh)"', text))
print("\n".join(sorted(names)))
PY
)
[ -n "$STOP_HOOKS" ] || { echo "FAIL  found no Stop hooks registered in setup.sh"; exit 1; }
while read -r hook; do
  f="$ROOT/.claude/hooks/$hook"
  [ -f "$f" ] || continue
  # Only what the model is told (echo/printf lines), never the comments.
  if grep -E '^\s*(echo|printf)' "$f" | grep -qiE 'rewrite the reply|resend the reply|then resend|rewrite the reply itself|say the same things'; then
    echo "FAIL  $hook asks for the reply to be rewritten or resent"; fail=1
  fi
done <<<"$STOP_HOOKS"
[ $fail = 0 ] && echo "ok    no Stop hook asks for the reply again ($(printf '%s\n' "$STOP_HOOKS" | wc -l | tr -d ' ') checked)"
exit $fail
