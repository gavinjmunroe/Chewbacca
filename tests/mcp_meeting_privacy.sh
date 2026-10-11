#!/usr/bin/env bash
# No read through chewbacca-mcp may print a private meeting title or a health
# word from a meeting. On 2026-10-11 the meetings panel printed a psychiatric
# intake and a therapy session by name on the glass; kit_read hands the same
# rows to any agent in any browser, which is a wider audience than the glass.
set -uo pipefail
ROOT="${1:?repo root}"
MCP="$ROOT/bin/chewbacca-mcp"
fail() { echo "$1" >&2; exit 1; }

# 1. redact() hides a private line or JSON string and leaves the rest alone.
python3 - "$ROOT/bin/lib" <<'PY' || fail "meeting_privacy.redact let a private title through"
import json, sys
sys.path.insert(0, sys.argv[1])
from meeting_privacy import redact
text = "Today\n  10:00  Psychiatric intake\n  11:00  thera-py w Dr Lee\n  12:00\tTeam sync\n  13:00  Caleb&apos;s t.h.e.r.a.p.y"
out = redact(text).split("\n")
assert out[0] == "Today", out
assert out[1] == "  Private" and out[2] == "  Private" and out[4] == "  Private", out
assert out[3] == "  12:00\tTeam sync", out
j = json.loads(redact(json.dumps([{"title": "OB-GYN follow up", "at": "2026-10-12"}, {"title": "Amber standup"}])))
assert j == [{"title": "Private", "at": "2026-10-12"}, {"title": "Amber standup"}], j
k = json.loads(redact(json.dumps({"Therapy 3pm": ["notes"], "Psychiatric intake": [], "Amber standup": []})))
assert set(k) == {"Private 1", "Private 2", "Amber standup"}, k
PY

# 2. Every registry entry that can print a meeting is marked for redaction:
#    the calendar, the meeting tools, a HUD walk, the ledger (its rows are
#    made from meeting action items), and mac-db's store picker.
python3 - "$ROOT/config/data/mcp-reads.json" <<'PY' || fail "a meeting-shaped read is not marked private"
import json, sys
# The voice log, agent transcripts and the front window title echo calendar
# and meeting titles back (automated review, 2026-10-11).
MEETING_TOOLS = {"meeting-autopilot", "room-capture", "granola-import", "work-ledger", "gtme-lookup",
                 "superassistant", "agent-history", "hud-context"}
for e in json.load(open(sys.argv[1]))["reads"]:
    argv = e.get("argv", [])
    shaped = (e["tool"] in MEETING_TOOLS or "calendar" in argv or "meetings" in argv
              or (e["tool"] == "kyber-surfaces" and "walk" in argv)
              or (e["tool"] == "mac-db" and "store" in (e.get("params") or {})))
    assert not shaped or e.get("private") == "meetings", e["id"]
PY

# 3. End to end: a read marked private comes back through kit_read with the
#    title hidden; the same read unmarked shows it, so the hiding is the
#    filter's doing and not an empty fixture.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
printf '%s\n' '{"said":"what comes after my Psychiatric intake at 3pm","answer":"Team sync at 4","at":"2026-10-11T09:00:00"}' \
  '{"said":"Amber standup notes","answer":"posted","at":"2026-10-11T09:05:00"}' > "$tmp/questions.jsonl"
cat > "$tmp/reads.json" <<'JSON'
{"reads": [
  {"id": "fixture.private", "tool": "superassistant", "argv": ["recent", "5"], "private": "meetings", "about": "fixture"},
  {"id": "fixture.plain", "tool": "superassistant", "argv": ["recent", "5"], "about": "fixture"}
]}
JSON
call() {
  printf '%s\n' "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"kit_read\",\"arguments\":{\"id\":\"$1\"}}}" |
    SUPERASSISTANT_DIR="$tmp" CHEWBACCA_MCP_READS="$tmp/reads.json" "$MCP" 2>/dev/null | head -1
}
plain="$(call fixture.plain)"
echo "$plain" | grep -q 'Psychiatric' || fail "fixture did not reach the CLI: $plain"
hidden="$(call fixture.private)"
echo "$hidden" | grep -qi 'psychiatr' && fail "kit_read printed a private meeting title: $hidden"
echo "$hidden" | grep -q 'Private' || fail "kit_read did not mark the hidden line: $hidden"
echo "$hidden" | grep -q 'Amber standup' || fail "kit_read hid a line that was not private: $hidden"

exit 0
