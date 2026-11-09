#!/usr/bin/env bash
# New iMessages reach the store even inside the sync cooldown. 2026-11-05: the
# cooldown said "nothing to do" while 15 new texts with Caleb's dad sat in
# chat.db, and a read reported that his dad had not replied.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
check() { if [ "$2" = "$3" ]; then echo "  ok    $1"; else echo "  FAIL  $1: wanted $3 got $2"; fail=$((fail+1)); fi; }

export PEOPLE_DIR="$T/people" PEOPLE_SYNC_LOCK="$T/lock" PEOPLE_TEXTS_READER="$T/reader.py"
mkdir -p "$PEOPLE_DIR"
echo 1 > "$T/newest"
cat > "$T/reader.py" <<PY
import json, sys
newest = int(open("$T/newest").read())
if "--max-id" in sys.argv:
    if newest < 0:
        sys.exit(1)
    print(newest)
    sys.exit(0)
open("$T/full_reads", "a").write("x")
print(json.dumps([{"id": i, "with": "Test Dad", "handle": "+15550100000", "from_me": False,
                   "text": "hello number %d" % i, "at": "2026-11-05T14:5%d:00" % i}
                  for i in range(1, newest + 1)]))
PY
people() { node "$ROOT/bin/people" texts "$@" 2>&1; }

people stats >/dev/null
node -e '
const { DatabaseSync } = require("node:sqlite");
const d = new DatabaseSync(process.argv[1] + "/people.db");
const up = d.prepare("INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES (?,?,?)");
const now = new Date().toISOString().slice(0, 19).replace("T", " ");
up.run("messages_max_id", "1", now);
up.run("messages_last_sync", now, now);
' "$PEOPLE_DIR" 2>/dev/null || { echo "could not seed the store"; ls "$PEOPLE_DIR"; exit 1; }

check "nothing new: sync still stands down" \
  "$(people sync | grep -c 'nothing to do')" 1
check "nothing new: the slow read never runs" \
  "$([ -e "$T/full_reads" ] && echo ran || echo skipped)" skipped

echo 3 > "$T/newest"
check "new texts inside the cooldown: sync pulls them" \
  "$(people sync | grep -c 'new iMessages')" 1
check "and they are readable" \
  "$(people --days 36500 | grep -c 'hello number 3')" 1

echo 4 > "$T/newest"
check "a plain read catches up with no sync first" \
  "$(people --days 36500 | grep -c 'hello number 4')" 1

echo -1 > "$T/newest"
check "reader failure: the read still answers" \
  "$(people --days 36500 | grep -c 'hello number 4')" 1

[ "$fail" = 0 ] && echo "texts catch-up ok"
exit "$fail"
