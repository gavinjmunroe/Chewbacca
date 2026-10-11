#!/bin/bash
# ask-capture keeps every link he sends, even past the 1200-character trim
# (feedback_catalogued_is_not_read, 2026-10-09: "There's a shit ton of links
# and repos I sent you ... DONT LOSE THEM").
set -u
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/ask-capture.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
pad="$(python3 -c 'print("look at these for chewbs " * 80)')"
prompt="$pad https://github.com/a/one, https://github.com/b/two. and (https://x.com/c/status/3) again https://github.com/a/one"
jq -nc --arg p "$prompt" '{prompt:$p, session_id:"abcdef123", cwd:"/x"}' | HOME="$T" bash "$HOOK"
python3 - "$T/.chewbacca/asks.jsonl" <<'PY'
import json, sys
row = json.loads(open(sys.argv[1]).read().splitlines()[-1])
assert row["said"].endswith("[trimmed]"), "the prompt was long enough to be trimmed"
assert row.get("links") == ["https://github.com/a/one", "https://github.com/b/two", "https://x.com/c/status/3"], row.get("links")
print("ask-capture: every link kept past the trim, deduped, punctuation stripped: ok")
PY
