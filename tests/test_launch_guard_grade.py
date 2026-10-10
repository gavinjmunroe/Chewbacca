"""launch-guard.sh refuses a launch, resume or add-leads without a fresh gtme-grade pass.

The pre-send receipt is valid in every case here, so only the grade half decides
(tests/launch-guard-test.py covers the pre-send half). Synthetic ids only.
Run: python3 tests/test_launch_guard_grade.py
"""
import hashlib
import json
import os
import subprocess
import tempfile
import time

H = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".claude", "hooks",
                 "launch-guard.sh")
NOW = int(time.time())


def run(tool, tool_input, grades=(), last_url=None, edit_after=False, presend=True):
    home = tempfile.mkdtemp()
    state = os.path.join(home, ".chewbacca", "state")
    gdir = os.path.join(state, "gtme-grade")
    os.makedirs(gdir)
    if presend:
        lst = os.path.join(home, "list.csv")
        with open(lst, "w") as fh:
            fh.write("email\n")
        with open(os.path.join(state, "send-gate-receipt.json"), "w") as fh:
            json.dump({"time": NOW, "full": True,
                       "hashes": {lst: hashlib.sha256(b"email\n").hexdigest()}}, fh)
    for cid, passed, age in grades:
        inp = os.path.join(home, f"{cid}-leads.csv")
        with open(inp, "w") as fh:
            fh.write("graded\n")
        with open(os.path.join(gdir, f"{cid}.json"), "w") as fh:
            json.dump({"campaign": cid, "time": NOW - age, "pass": passed,
                       "hashes": {inp: hashlib.sha256(b"graded\n").hexdigest()}}, fh)
        if edit_after:
            with open(inp, "a") as fh:
                fh.write("added after grading\n")
    if last_url:
        with open(os.path.join(state, "launch-guard-last-url"), "w") as fh:
            fh.write(last_url)
    p = subprocess.run(["bash", H], input=json.dumps({"tool_name": tool, "tool_input": tool_input}),
                       capture_output=True, text=True, env=dict(os.environ, HOME=home), timeout=20)
    return p.returncode, p.stderr


LAUNCH_A = {"command": "clay campaigns update cam_alpha --status active"}
CLAY_A = "https://app.clay.com/workspaces/1/campaigns/cam_alpha"
cases = [
    # pass (0)
    ("graded campaign launches", "Bash", LAUNCH_A, [("cam_alpha", True, 60)], None, False, True, 0),
    ("running gtme-grade itself is not a launch", "Bash",
     {"command": "gtme-grade --campaign cam_alpha --leads l.csv"}, [], None, False, True, 0),
    ("mcp click on a graded campaign page", "mcp__chrome-devtools__click", {"uid": "1"},
     [("cam_alpha", True, 60)], CLAY_A, False, True, 0),
    # refuse (2)
    ("no grade receipt refuses", "Bash", LAUNCH_A, [], None, False, True, 2),
    ("a failing grade refuses", "Bash", LAUNCH_A, [("cam_alpha", False, 60)], None, False, True, 2),
    ("a grade over 12 hours old refuses", "Bash", LAUNCH_A, [("cam_alpha", True, 13 * 3600)],
     None, False, True, 2),
    ("a list edited after grading refuses", "Bash", LAUNCH_A, [("cam_alpha", True, 60)],
     None, True, True, 2),
    ("a pass for another campaign does not unlock this one", "Bash", LAUNCH_A,
     [("cam_beta", True, 60)], None, False, True, 2),
    ("resume names the campaign and needs its grade", "Bash",
     {"command": 'chewie web click "Resume campaign" # cam_alpha'}, [("cam_beta", True, 60)],
     None, False, True, 2),
    ("add leads without a grade refuses", "Bash",
     {"command": 'chewie web click "Add leads"'}, [], None, False, True, 2),
    ("mcp click on an ungraded campaign page refuses", "mcp__chrome-devtools__click", {"uid": "1"},
     [("cam_beta", True, 60)], CLAY_A, False, True, 2),
    ("a grade pass alone, without the pre-send gate, refuses", "Bash", LAUNCH_A,
     [("cam_alpha", True, 60)], None, False, False, 2),
    ("forging a grade receipt from the shell refuses", "Bash",
     {"command": "echo '{\"pass\":true}' > ~/.chewbacca/state/gtme-grade/cam_alpha.json"},
     [], None, False, True, 2),
]

bad = 0
for name, tool, ti, grades, url, edit, presend, want in cases:
    got, err = run(tool, ti, grades, url, edit, presend)
    ok = got == want
    if ok and want == 2 and "forging" not in name and "pre-send" not in name:
        ok = "gtme-grade" in err
    bad += not ok
    print(f"{'ok  ' if ok else 'FAIL'} {name}: want {want} got {got}" + ("" if ok else f"\n{err[:400]}"))
print(f"\n{len(cases) - bad}/{len(cases)} passed")
raise SystemExit(1 if bad else 0)
