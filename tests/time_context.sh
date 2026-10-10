#!/usr/bin/env bash
# time-context prints valid hook JSON carrying today's date.
set -uo pipefail
H="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/time-context.sh"
out=$(echo '{}' | bash "$H")
python3 - "$out" <<'PY'
import json, sys, time
d = json.loads(sys.argv[1])["hookSpecificOutput"]
ok = d["hookEventName"] == "UserPromptSubmit" and time.strftime("%B") in d["additionalContext"] \
     and str(time.localtime().tm_year) in d["additionalContext"]
print("time-context ok" if ok else f"FAIL {d}"); sys.exit(0 if ok else 1)
PY
