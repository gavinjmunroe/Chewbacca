"""launch-guard.sh: the original 2026-10-05 cases, kept as regressions.

Reads still run; every launch-shaped command, click or receipt forgery refuses.
The receipts are set up as before, so a case refusing proves the hook no longer
lets fresh receipts open a shell launch. tests/test_launch_guard_grade.py holds
the allowlist and the send-path grade checks.

Run: python3 tests/launch-guard-test.py
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time

# The repo's hook, not the installed copy: the installed one lags a commit.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
H = os.path.join(ROOT, ".claude", "hooks", "launch-guard.sh")
# A real signed launch grade for cam_x, so only the pre-send half decides here.
SIGN = r"""
import json, sys
sys.path.insert(0, sys.argv[1])
import gtme_grade as G
class Passed:
    n = 1
    passed = True
G.write_receipt("1372623", "cam_x", "launch", {"name": "t", "raw": json.load(open(sys.argv[3]))},
                [Passed()], [sys.argv[2]])
"""


def run(tool, tool_input, receipt=None, files=None, last_url=None, chat=None):
    home = os.path.realpath(tempfile.mkdtemp())
    state = os.path.join(home, ".chewbacca", "state")
    os.makedirs(state)
    session = "s-caleb"
    if chat is not None:
        rec_session, age = chat
        os.makedirs(os.path.join(state, "clay-chat-approval"))
        with open(os.path.join(state, "clay-chat-approval", rec_session + ".json"), "w") as fh:
            json.dump({"v": 2, "interactive": True, "at": int(time.time()) - age, "session_id": rec_session}, fh)
    if last_url:
        with open(os.path.join(state, "launch-guard-last-url"), "w") as fh:
            fh.write(last_url)
    if receipt is not None:
        receipt = dict(receipt)
        if files is not None:
            hashes = {}
            for name, (content, recorded) in files.items():
                p = os.path.join(home, name)
                with open(p, "w") as fh:
                    fh.write(content)
                hashes[p] = hashlib.sha256(recorded.encode()).hexdigest()
            receipt["hashes"] = hashes
        with open(os.path.join(state, "send-gate-receipt.json"), "w") as fh:
            json.dump(receipt, fh)
    # These cases test the pre-send half; a passing gtme-grade receipt is always
    # present so only that half decides. tests/test_launch_guard_grade.py covers
    # the grade half.
    gin = os.path.join(home, "graded.csv")
    with open(gin, "w") as fh:
        fh.write("email\n")
    fixtures = os.path.join(home, "clay")
    os.makedirs(fixtures)
    with open(os.path.join(fixtures, "cam_x.json"), "w") as fh:
        json.dump({"id": "cam_x", "sequence": []}, fh)
    env = dict(os.environ, HOME=home, GTME_GRADE_KEY_FILE=os.path.join(home, "k", "grade.key"),
               GTME_GRADE_CLAY_FIXTURE_DIR=fixtures, CHEWBACCA_ROOT=ROOT)
    subprocess.run([sys.executable, "-c", SIGN, os.path.join(ROOT, "tools"), gin,
                    os.path.join(fixtures, "cam_x.json")], env=env, check=True, timeout=30)
    p = subprocess.run([H], input=json.dumps({"tool_name": tool, "tool_input": tool_input, "session_id": session}),
                       capture_output=True, text=True, env=env, timeout=20)
    return p.returncode


now = int(time.time())
FULL = {"time": now, "full": True}
SAME = {"list.csv": ("a,b\n", "a,b\n")}
EDITED = {"list.csv": ("a,b\nextra\n", "a,b\n")}
CLAY = "https://app.clay.com/workspaces/1/campaigns/cam_x"
L = 'chewie web click "Launch"  # cam_x'
cases = [
    # must PASS (0): reads, navigation, unrelated clicks
    ("read analytics", "Bash", {"command": "clay campaigns analytics cam_x"}, None, None, None, 0),
    ("list campaigns", "Bash", {"command": "clay campaigns list"}, None, None, None, 0),
    ("open replies tab", "Bash", {"command": 'chewie web click "Replies"'}, None, None, None, 0),
    ("goto clay", "Bash", {"command": 'chewie web goto "https://app.clay.com/x"'},
     None, None, None, 0),
    ("note about launching", "Bash", {"command": "echo 'launch monday' >> notes.md"},
     None, None, None, 0),
    ("gate run passes the hook", "Bash",
     {"command": "python3 scripts/pre_send_gate.py l.csv --mx"}, None, None, None, 0),
    # Since 2026-10-10 no shell command starts a campaign, receipts or not: a
    # START goes only through chewbacca clay, a person and a passing grade.
    ("launch from a shell refuses even with fresh receipts", "Bash",
     {"command": "clay campaigns update cam_x --status active"},
     FULL, SAME, None, 2),
    ("mcp click off clay", "mcp__chrome-devtools__click", {"uid": "1"},
     None, None, "https://github.com", 0),
    # must BLOCK (2)
    ("launch click, no receipt", "Bash", {"command": L}, None, None, None, 2),
    ("resume click, no receipt", "Bash", {"command": 'chewie web click "Resume campaign"'},
     None, None, None, 2),
    ("extra spaces still match", "Bash", {"command": 'chewie  web   click  "Launch"'},
     None, None, None, 2),
    ("env prefix still matches", "Bash",
     {"command": 'CHEWIE_CHROME_PROFILE=x chewie web click "Launch"'}, None, None, None, 2),
    ("chewie eval launch", "Bash",
     {"command": "chewie web eval \"document.querySelector('#launch').click()\""},
     None, None, None, 2),
    ("clay cli status active", "Bash", {"command": "clay campaigns update cam_x --status active"},
     None, None, None, 2),
    ("partial receipt does not unlock", "Bash", {"command": L},
     {"time": now, "full": False}, SAME, None, 2),
    ("stale receipt does not unlock", "Bash", {"command": L},
     {"time": now - 13 * 3600, "full": True}, SAME, None, 2),
    ("receipt without hashes does not unlock", "Bash", {"command": L}, FULL, None, None, 2),
    ("list edited after the pass", "Bash", {"command": L}, FULL, EDITED, None, 2),
    ("forging the receipt from the shell", "Bash",
     {"command": "echo '{\"full\":true}' > ~/.chewbacca/state/send-gate-receipt.json"},
     None, None, None, 2),
    ("faking the gate in a comment", "Bash",
     {"command": "echo x > ~/.chewbacca/state/send-gate-receipt.json  # pre_send_gate.py"},
     None, None, None, 2),
    ("forging the last-url state", "Bash",
     {"command": "echo https://github.com > ~/.chewbacca/state/launch-guard-last-url"},
     None, None, None, 2),
    ("mcp click on any clay page, url lagging", "mcp__chrome-devtools__click", {"uid": "2"},
     None, None, "https://app.clay.com/workspaces/1/home", 2),
    ("peekaboo launch click", "mcp__peekaboo__click", {"query": "Launch"}, None, None, None, 2),
    ("mcp click on a clay campaign page", "mcp__chrome-devtools__click", {"uid": "1_5"},
     None, None, CLAY, 2),
    ("playwright click on a clay campaign page",
     "mcp__plugin_playwright_playwright__browser_click", {"ref": "e5"}, None, None, CLAY, 2),
]

# 2026-10-10: Caleb's "do it yourself" in chat (chat-approval.sh) stands in for a
# person at the Clay UI, in his session, for 2 hours, and never skips the gate.
FULL_NO_LINES = {"time": now, "full": False, "full_but_lines": True}
HOME_PAGE = "https://app.clay.com/workspaces/1/home"
cases = [(*c, None) for c in cases] + [
    # The recorded URL lags in-app navigation, so a "home page" click may land on Start.
    ("chat ok alone never opens a Clay click, URL lagging", "mcp__chrome-devtools__click", {"uid": "2"},
     None, None, HOME_PAGE, 2, ("s-caleb", 60)),
    ("chat ok + gate pass opens a Clay click", "mcp__chrome-devtools__click", {"uid": "2"},
     FULL_NO_LINES, SAME, HOME_PAGE, 0, ("s-caleb", 60)),
    ("chat ok: a campaign-page click still needs a gate receipt", "mcp__chrome-devtools__click", {"uid": "1_5"},
     None, None, CLAY, 2, ("s-caleb", 60)),
    ("chat ok + full receipt, lines off: Start goes through", "mcp__chrome-devtools__click", {"uid": "1_5"},
     FULL_NO_LINES, SAME, CLAY, 0, ("s-caleb", 60)),
    ("chat ok + receipt, list edited after the pass", "mcp__chrome-devtools__click", {"uid": "1_5"},
     FULL_NO_LINES, EDITED, CLAY, 2, ("s-caleb", 60)),
    ("chat ok + partial receipt", "Bash", {"command": L},
     {"time": now, "full": False}, SAME, None, 2, ("s-caleb", 60)),
    ("chat ok from another tab's session, gate passed", "mcp__chrome-devtools__click", {"uid": "2"},
     FULL_NO_LINES, SAME, HOME_PAGE, 2, ("s-other", 60)),
    ("chat ok older than 2 hours, gate passed", "mcp__chrome-devtools__click", {"uid": "2"},
     FULL_NO_LINES, SAME, HOME_PAGE, 2, ("s-caleb", 3 * 3600)),
    ("writing the chat approval with the Write tool", "Write",
     {"file_path": "/Users/x/.chewbacca/state/clay-chat-approval.json", "content": "{}"},
     None, None, None, 2, None),
    ("writing the chat approval from the shell", "Bash",
     {"command": "echo {} > ~/.chewbacca/state/clay-chat-approval.json"}, None, None, None, 2, None),
    ("an ordinary file write", "Write", {"file_path": "/tmp/notes.md", "content": "x"},
     None, None, None, 0, None),
]

# 2026-10-11: the Bash description is never run. "Quit and relaunch Kyber"
# there refused a plain quit. The block cases are the seven bypasses a review
# reproduced against a narrower rule tried the same night; the substring rule
# must keep refusing every one.
U = lambda c, want, desc="": (c[:60], "Bash", {"command": c, "description": desc},  # noqa: E731
                              None, None, None, want, None)
cases += [
    U("osascript -e 'quit app \"Kyber\"' && sleep 1 && open -g -a Kyber", 0,
      "Quit and relaunch Kyber, check listener and surfaces"),
    U('nice chewie web click "Launch"', 2),
    U('{ chewie web click "Launch"; }', 2),
    U('W=launch; chewie web click $W', 2),
    U('find . -maxdepth 0 -exec chewie web click launch \\;', 2),
    U('cat <<EOF | osascript\ntell application "System Events" to click button "Launch" of window 1\nEOF', 2),
    U('echo "a <<END"\nchewie web click launch', 2),
    U('fish -c "chewie web click launch"', 2),
]

bad = 0
for name, tool, ti, receipt, files, last_url, want, chat in cases:
    got = run(tool, ti, receipt, files, last_url, chat)
    ok = got == want
    bad += not ok
    print(f"{'ok  ' if ok else 'FAIL'} {name}: want {want} got {got}")
print(f"\n{len(cases) - bad}/{len(cases)} passed")
raise SystemExit(1 if bad else 0)
