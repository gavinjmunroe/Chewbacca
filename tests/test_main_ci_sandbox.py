#!/usr/bin/env python3
"""main-ci's sandbox refuses what an unattended run of pushed code must not do.

The first assertions are refusals (feedback_a_silent_guard_proves_nothing):
each one is a real attempt that the profile has to stop. macOS only.
"""
import importlib.machinery
import importlib.util
import platform
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FAILED = []


def check(name, ok):
    print(("ok   " if ok else "FAIL ") + name)
    if not ok:
        FAILED.append(name)


if platform.system() != "Darwin" or not shutil.which("sandbox-exec"):
    print("skip: sandbox-exec is macOS only")
    sys.exit(0)

loader = importlib.machinery.SourceFileLoader("main_ci", str(ROOT / "bin" / "main-ci"))
spec = importlib.util.spec_from_loader("main_ci", loader)
ci = importlib.util.module_from_spec(spec)
loader.exec_module(ci)

with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    home = tmp / "home"
    for rel in ci.SECRET_PATHS + ["Library/LaunchAgents"]:
        (home / rel).mkdir(parents=True, exist_ok=True)
    (home / ".ssh" / "id_test").write_text("not a real key\n")
    wt = tmp / "wt"
    wt.mkdir()
    profile = tmp / "p.sb"
    profile.write_text(ci.sandbox_profile(home, wt))

    def boxed(*cmd):
        return subprocess.run(["sandbox-exec", "-f", str(profile), *cmd], capture_output=True, text=True).returncode

    check("reading a key under .ssh is refused", boxed("cat", str(home / ".ssh" / "id_test")) != 0)
    check("listing the brain is refused", boxed("ls", str(home / "second-brain")) != 0)
    check("listing Messages is refused", boxed("ls", str(home / "Library" / "Messages")) != 0)
    check("planting a launch agent is refused",
          boxed("touch", str(home / "Library" / "LaunchAgents" / "x.plist")) != 0
          and not (home / "Library" / "LaunchAgents" / "x.plist").exists())
    check("writing the shell startup file is refused", boxed("touch", str(home / ".zshrc")) != 0)
    check("outbound network is refused",
          boxed("/usr/bin/python3", "-c",
                "import socket; socket.create_connection(('1.1.1.1', 53), timeout=3)") != 0)
    check("the worktree stays writable", boxed("touch", str(wt / "ok")) == 0)
    check("python and bash still run", boxed("/bin/bash", "-c", "/usr/bin/python3 -c 'print(1)'") == 0)

sys.exit(1 if FAILED else 0)
