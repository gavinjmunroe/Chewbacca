"""launch-guard.sh: a campaign launch needs a full pre-send gate receipt.

Run: python3 tests/launch-guard-test.py
"""
import json
import os
import subprocess
import tempfile
import time

H = os.path.expanduser("~/.claude/hooks/launch-guard.sh")


def run(tool, tool_input, receipt=None):
    home = tempfile.mkdtemp()
    if receipt is not None:
        os.makedirs(os.path.join(home, ".chewbacca", "state"))
        with open(os.path.join(home, ".chewbacca", "state", "send-gate-receipt.json"), "w") as fh:
            json.dump(receipt, fh)
    env = dict(os.environ, HOME=home)
    p = subprocess.run([H], input=json.dumps({"tool_name": tool, "tool_input": tool_input}),
                       capture_output=True, text=True, env=env, timeout=20)
    return p.returncode


now = int(time.time())
FULL = {"time": now, "full": True}
cases = [
    # must PASS (0): reads, navigation, unrelated clicks
    ("read analytics", "Bash", {"command": "clay campaigns analytics cam_x"}, None, 0),
    ("list campaigns", "Bash", {"command": "clay campaigns list"}, None, 0),
    ("open replies tab", "Bash", {"command": 'chewie web click "Replies"'}, None, 0),
    ("goto clay", "Bash", {"command": 'chewie web goto "https://app.clay.com/x"'}, None, 0),
    ("note about launching", "Bash", {"command": "echo 'launch monday' >> notes.md"}, None, 0),
    ("launch with fresh full receipt", "Bash", {"command": 'chewie web click "Launch"'}, FULL, 0),
    # must BLOCK (2)
    ("launch click, no receipt", "Bash", {"command": 'chewie web click "Launch"'}, None, 2),
    ("resume click, no receipt", "Bash", {"command": 'chewie web click "Resume campaign"'}, None, 2),
    ("clay cli status active", "Bash",
     {"command": "clay campaigns update cam_x --status active"}, None, 2),
    ("partial receipt does not unlock", "Bash", {"command": 'chewie web click "Launch"'},
     {"time": now, "full": False}, 2),
    ("stale receipt does not unlock", "Bash", {"command": 'chewie web click "Launch"'},
     {"time": now - 13 * 3600, "full": True}, 2),
    ("peekaboo launch click", "mcp__peekaboo__click", {"query": "Launch"}, None, 2),
]

bad = 0
for name, tool, ti, receipt, want in cases:
    got = run(tool, ti, receipt)
    ok = got == want
    bad += not ok
    print(f"{'ok  ' if ok else 'FAIL'} {name}: want {want} got {got}")
print(f"\n{len(cases) - bad}/{len(cases)} passed")
raise SystemExit(1 if bad else 0)
