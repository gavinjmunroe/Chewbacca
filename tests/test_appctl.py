#!/usr/bin/env python3
"""appctl and chewie app find: the parts that can be checked without driving a real app.

The first driver assertion is a REFUSAL (feedback_a_silent_guard_proves_nothing):
a Return key to Finder without --yes must exit 4 before any key is sent.
"""
import json
import os
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

# `do` must never forward --yes: consent went to a sentence, not to the
# control Jev picked. A fake appctl records every argv it gets.
with tempfile.TemporaryDirectory() as tmp:
    log = Path(tmp) / "argv.log"
    fake_bin = Path(tmp) / "appctl"
    fake_bin.write_text(f"""#!/usr/bin/env python3
import json, sys
open({str(log)!r}, "a").write(json.dumps(sys.argv[1:]) + "\\n")
if sys.argv[1] == "see":
    print(json.dumps({json.dumps(SNAP)}))
    sys.exit(0)
sys.stderr.write('{{"error":"refused"}}')
sys.exit(4)
""")
    fake_bin.chmod(0o755)
    run = subprocess.run([sys.executable, str(ROOT / "mac/lib/app_find.py"), "do", str(fake_bin), "Photos",
                          "remove from mac", "--yes"], capture_output=True, text=True)
    calls = [json.loads(line) for line in log.read_text().splitlines()]
    check("do never forwards --yes to the press", all("--yes" not in c for c in calls) and len(calls) == 2)
    check("a gated do exits 4 and names the exact confirm command",
          run.returncode == 4 and "press Photos 2 --yes" in run.stdout)

# batch: a label step takes a fresh see first, a gated step stops the run,
# and --yes reaches appctl only on the step that carries "yes": true.
with tempfile.TemporaryDirectory() as tmp:
    log = Path(tmp) / "argv.log"
    fake_bin = Path(tmp) / "appctl"
    fake_bin.write_text(f"""#!/usr/bin/env python3
import json, sys
open({str(log)!r}, "a").write(json.dumps(sys.argv[1:]) + "\\n")
if sys.argv[1] == "see":
    print("{{}}"); sys.exit(0)
if "label:Delete" in sys.argv and "--yes" not in sys.argv:
    sys.stderr.write("refused"); sys.exit(4)
print("{{}}")
""")
    fake_bin.chmod(0o755)
    steps = Path(tmp) / "steps.json"
    steps.write_text(json.dumps([{"do": "press", "label": "Add"}, {"do": "key", "combo": "tab"},
                                 {"do": "press", "label": "Delete"}, {"do": "press", "i": 3}]))
    run = subprocess.run([sys.executable, str(ROOT / "mac/lib/app_batch.py"), str(fake_bin), "Calc", str(steps)],
                         capture_output=True, text=True)
    calls = [json.loads(line) for line in log.read_text().splitlines()]
    check("a batch stops at the gated step with exit 4", run.returncode == 4
          and json.loads(run.stdout)["stopped_at"] == 2 and ["press", "Calc", "3"] not in calls)
    check("a label step takes a fresh see first", calls[0] == ["see", "Calc"] and calls[1] == ["press", "Calc", "label:Add"])
    check("no step gets --yes unless it says so", all("--yes" not in c for c in calls))
    log.unlink()
    steps.write_text(json.dumps([{"do": "press", "label": "Delete", "yes": True}]))
    run = subprocess.run([sys.executable, str(ROOT / "mac/lib/app_batch.py"), str(fake_bin), "Calc", str(steps)],
                         capture_output=True, text=True)
    check("yes on one step passes that step only", run.returncode == 0
          and json.loads(log.read_text().splitlines()[-1])[-1] == "--yes")

# Voice route: only an installed app by exact name plus a verb-led action.
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import app_route  # noqa: E402
APPS = ["Calculator", "Photos", "System Settings", "Notion"]
for said, want in [
    ("press Change Sign in Calculator", ("Calculator", "press Change Sign")),
    ("in Photos, turn off iCloud Photos", ("Photos", "turn off iCloud Photos")),
    ("hey chewie, clear the display in the Calculator", ("Calculator", "clear the display")),
    ("toggle dark mode in System Settings.", ("System Settings", "toggle dark mode")),
]:
    got = app_route.parse(said, APPS)
    check(f"route takes {said!r}", got is not None and (got.app, got.intent) == want)
for said in ["what's the weather in Paris", "set up a meeting in Notion", "press the button in Spotify",
             "in Calculator", "I was in Photos earlier", "search for cats in Photos"]:
    check(f"route leaves {said!r} alone", app_route.parse(said, APPS) is None)

# chewie app ask against a fake Kyber: the tap is the only thing that presses.
import socket as _socket
import threading as _threading
def ask_with_fake_kyber(reply):
    with tempfile.TemporaryDirectory() as tmp:
        sock_path = str(Path(tmp) / "hud.sock")
        Path(tmp, "hud.token").write_text("a" * 64)
        log = Path(tmp) / "argv.log"
        fake_bin = Path(tmp) / "appctl"
        fake_bin.write_text(f"""#!/usr/bin/env python3
import json, sys
open({str(log)!r}, "a").write(json.dumps(sys.argv[1:]) + "\\n")
v = sys.argv[1]
if v == "see":
    print(json.dumps({{"app": "Calculator", "window": 7, "elements": [
        {{"i": 1, "role": "AXButton", "label": "Change Sign", "actions": ["AXPress"]}}]}}))
elif v == "where":
    print(json.dumps({{"screen": [100, 200, 40, 40]}}))
elif v == "windows":
    print(json.dumps([{{"window": 7, "hidden": False, "minimized": False}}]))
else:
    print("{{}}")
""")
        fake_bin.chmod(0o755)
        server = _socket.socket(_socket.AF_UNIX, _socket.SOCK_STREAM)
        server.bind(sock_path); server.listen(1)
        got = []
        def serve():
            conn, _ = server.accept()
            buf = b""
            while b"r s" not in buf:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                buf += chunk
            got.append(buf.decode())
            if reply:
                conn.sendall((reply + "\n").encode())
            try:
                while conn.recv(4096):
                    pass
            except OSError:
                pass
            conn.close()
        _threading.Thread(target=serve, daemon=True).start()
        env = dict(os.environ, BOB_HUD_SOCKET=sock_path, APP_ASK_WAIT_S="3")
        run = subprocess.run([sys.executable, str(ROOT / "mac/lib/app_hud.py"), str(fake_bin), "Calculator",
                              "change sign"], capture_output=True, text=True, env=env, timeout=30)
        server.close()
        calls = [json.loads(line) for line in log.read_text().splitlines()]
        return run, calls, (got[0] if got else "")
import os  # noqa: E402
run, calls, drawn = ask_with_fake_kyber("e action appctl-go")
check("the ask card brackets the control and offers Press it",
      "m appctl-target 96 196 48 48" in drawn and "near=100,200,40,40" in drawn and 'label="Press it"' in drawn)
check("a tap on Press it presses that element with --yes, pinned to what was shown",
      any(c[:4] == ["press", "Calculator", "1", "--yes"] and "--expect" in c
          and json.loads(c[c.index("--expect") + 1])["label"] == "Change Sign" for c in calls))
run, calls, drawn = ask_with_fake_kyber("e action appctl-no")
check("Not this presses nothing", not any(c[0] == "press" and "--yes" in c for c in calls)
      and json.loads(run.stdout)["pressed"] is False)
run, calls, drawn = ask_with_fake_kyber("")
check("no answer before the timeout presses nothing", not any(c[0] == "press" and "--yes" in c for c in calls)
      and json.loads(run.stdout)["answer"] == "timeout")

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
                  and "refused without --yes" in refused.stderr)
            for combo in ("space", "cmd+q", "cmd+d", "enter", "delete"):
                r = subprocess.run([str(out), "key", "Finder", combo], capture_output=True, text=True)
                check(f"key {combo} without --yes is refused", r.returncode == 4)
            # --expect refuses when the snapshot no longer holds what was shown.
            seen = subprocess.run([str(out), "see", "Calculator"], capture_output=True, text=True)
            if seen.returncode == 0 and json.loads(seen.stdout)["elements"]:
                first = json.loads(seen.stdout)["elements"][0]
                wrong = json.dumps({"role": first["role"], "label": "Not What Was Shown", "path": first["path"]})
                r = subprocess.run([str(out), "press", "Calculator", str(first["i"]), "--yes", "--expect", wrong],
                                   capture_output=True, text=True)
                check("a press pinned to a different shown element is refused, exit 5", r.returncode == 5)
            menu = subprocess.run([str(out), "menu", "Finder", "File", "Move to Trash"], capture_output=True, text=True)
            if menu.returncode == 2:
                print("skip menu gate check: accessibility not granted to this process")
            else:
                check("a Move to Trash menu item is refused without --yes", menu.returncode == 4)
            # The security review's case: "OK" under a destructive alert.
            # osascript's own alert gives a real dialog with no app to set up.
            # That dialog is real: it opens on the person's screen and takes
            # focus, so the suite never runs it. 2026-10-13: every suite run
            # drew "Permanently delete all 172,703 items?" over Caleb's work
            # for up to 5 s. CHEWBACCA_LIVE_DIALOGS=1 runs it on purpose.
            import time
            if not os.environ.get("CHEWBACCA_LIVE_DIALOGS"):
                print("skip alert gate check: it opens a real dialog on the screen; CHEWBACCA_LIVE_DIALOGS=1 runs it")
            alert = None if not os.environ.get("CHEWBACCA_LIVE_DIALOGS") else subprocess.Popen(["osascript", "-e", 'display dialog "Permanently delete all 172,703 items?" '
                                      'buttons {"Cancel", "OK"} default button "OK"'],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                seen = None
                for _ in range(20 if alert else 0):
                    time.sleep(0.25)
                    seen = subprocess.run([str(out), "see", "osascript"], capture_output=True, text=True)
                    if seen.returncode == 0 and '"OK"' in seen.stdout:
                        break
                if alert is None:
                    pass
                elif seen is None or seen.returncode != 0:
                    print("skip alert gate check: alert not readable (accessibility?)")
                else:
                    ok = subprocess.run([str(out), "press", "osascript", "OK"], capture_output=True, text=True)
                    check("OK under a destructive alert is refused and quotes the alert",
                          ok.returncode == 4 and "Permanently delete" in ok.stderr)
                    subprocess.run([str(out), "see", "osascript"], capture_output=True)
                    cancel = subprocess.run([str(out), "press", "osascript", "Cancel"], capture_output=True, text=True)
                    check("Cancel in the same alert passes without --yes", cancel.returncode == 0)
            finally:
                if alert:
                    alert.kill()
            missing = subprocess.run([str(out), "see", "no-such-app-zz"], capture_output=True, text=True)
            check("an unknown app fails with a fix", missing.returncode == 1 and "fix" in missing.stderr)
else:
    print("skip appctl build checks: not macOS or no swiftc")

sys.exit(1 if FAILED else 0)
