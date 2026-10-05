"""browser-bridge runs text that came off a web page, so its first-word
allowlist must not include anything that runs code the page chooses.
Run: python3 tests/test_browser_bridge.py"""
import importlib.machinery
import importlib.util
import os
import subprocess
import sys
import tempfile
from pathlib import Path

home = tempfile.mkdtemp()
os.environ["HOME"] = home
project = tempfile.mkdtemp()
os.environ["CHEWBACCA_BRIDGE_CWD"] = project
sys.dont_write_bytecode = True
path = Path(__file__).resolve().parent.parent / "bin" / "browser-bridge"
loader = importlib.machinery.SourceFileLoader("browser_bridge", str(path))
spec = importlib.util.spec_from_loader("browser_bridge", loader)
bridge = importlib.util.module_from_spec(spec)
loader.exec_module(bridge)

failed = 0


def check(name: str, ok: bool, detail: object = "") -> None:
    global failed
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f"  {detail}"))
    failed += 0 if ok else 1


def refused(command: str, extra: set[str] | None = None) -> bool:
    bridge._recent.clear()
    out = bridge.run(command, extra or set())
    return not out["ok"] and out["output"].startswith("REFUSED")


print("a page cannot run code through the bridge")
for command in ['python3 -c "print(1)"', "node -e 1", "env sh -c id", "npx cowsay",
                "find . -exec id ;", "sed -n 1e\\ id x", "awk 'BEGIN{system(\"id\")}'",
                "chewie run 'tell app \"Finder\" to quit'", "chewbacca uninstall",
                "cp /etc/hosts .", "mv a b", "make", "npm test"]:
    check(f"refused: {command}", refused(command))

print("git reads, and only reads")
subprocess.run(["git", "init", "-q", project], check=True)
bridge._recent.clear()
check("git status runs", bridge.run("git status --short", set())["ok"])
for command in ["git -c core.pager=id log", "git log --output=/tmp/x", "git config alias.x '!id'",
                "git clone https://example.com/x", "git", "git diff --ext-diff"]:
    check(f"refused: {command}", refused(command))
check("--allow git lifts the read limit, deliberately", not refused("git config --get user.name", {"git"}))

print("reads still work, and --allow is the person's switch")
bridge._recent.clear()
check("ls runs", bridge.run("ls", set())["ok"])
check("python3 runs once the person allows it", bridge.run('python3 -c "print(1)"', {"python3"})["ok"])

if __name__ == "__main__":
    print("all passed" if not failed else f"{failed} failed")
    sys.exit(1 if failed else 0)
