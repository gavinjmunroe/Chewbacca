#!/usr/bin/env python3
"""appctl and chewie app find: the parts that can be checked without driving a real app.

The first driver assertion is a REFUSAL (feedback_a_silent_guard_proves_nothing):
a Return key to Finder without --yes must exit 4 before any key is sent.
"""
import json
import platform
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "mac" / "lib"))
sys.path.insert(0, str(ROOT / "tools"))
import app_find  # noqa: E402
import jev  # noqa: E402

FAILED = []


def check(name, ok):
    print(("ok   " if ok else "FAIL ") + name)
    if not ok:
        FAILED.append(name)


SNAP = {"app": "Photos", "title": "iCloud", "elements": [
    {"i": 0, "role": "AXStaticText", "value": "Do you want to download a copy?"},
    {"i": 1, "role": "AXButton", "label": "Download", "actions": ["AXPress"]},
    {"i": 2, "role": "AXButton", "label": "Remove from Mac", "actions": ["AXPress"]},
    {"i": 3, "role": "AXButton", "label": "Cancel", "actions": ["AXPress"]},
]}

# Exact label answers in code, and must never reach Jev.
real_eval = jev.evaluate
jev.evaluate = lambda payload: (_ for _ in ()).throw(AssertionError("Jev called on an exact label"))
r = app_find.find(SNAP, "cancel")
check("an exact label is found without a model call", r["i"] == 3 and r["via"] == "exact label")

# Jev's choice is an index into the actionable pool, which skips the static
# text; the answer has to map back to the snapshot's own index.
def fake(payload):
    crit = payload["questions"]["target"]["criteria"]
    assert "none" in crit and "StaticText" not in json.dumps(crit)
    return {"answers": {"target": {"choice": "1", "confidence": 0.93,
                                   "probabilities": {"0": 0.04, "1": 0.93, "2": 0.02, "none": 0.01}}}}
jev.evaluate = fake
r = app_find.find(SNAP, "turn off iCloud but keep the photos in the cloud")
check("a Jev choice maps back to the snapshot index", r["i"] == 2 and r["element"]["label"] == "Remove from Mac")
check("runner-up alternatives are reported", any(a["i"] == 1 for a in r["alternatives"]))

def down(payload):
    raise jev.JevError("no key")
jev.evaluate = down
r = app_find.find(SNAP, "something vague")
check("Jev unavailable returns candidates, never a guess", r["i"] is None and len(r["candidates"]) == 3)
jev.evaluate = real_eval

# The compiled driver, macOS only.
if platform.system() == "Darwin" and shutil.which("swiftc"):
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "appctl"
        build = subprocess.run(["swiftc", "-swift-version", "5", "-O", str(ROOT / "mac/appctl/appctl.swift"),
                                "-o", str(out)], capture_output=True, text=True)
        check("appctl compiles in Swift 5 language mode", build.returncode == 0)
        if build.returncode == 0:
            usage = subprocess.run([str(out)], capture_output=True, text=True)
            check("appctl with no args prints usage", usage.returncode == 0 and "press" in usage.stdout)
            refused = subprocess.run([str(out), "key", "Finder", "return"], capture_output=True, text=True)
            check("Return to an app without --yes is refused with exit 4", refused.returncode == 4
                  and "irreversible" in refused.stderr)
            missing = subprocess.run([str(out), "see", "no-such-app-zz"], capture_output=True, text=True)
            check("an unknown app fails with a fix", missing.returncode == 1 and "fix" in missing.stderr)
else:
    print("skip appctl build checks: not macOS or no swiftc")

sys.exit(1 if FAILED else 0)
