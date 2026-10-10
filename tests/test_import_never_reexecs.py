"""Importing a bin/ script must never replace the importing process.

bin/hud-listen re-execs itself under a newer python when started by an old
one. On 2026-10-09 that ran at import too: a uv pytest run under macOS's 3.9
imported it through test_hud_runtime.py, the whole pytest process was
replaced, and the run printed nothing and exited 0. A silent pass.

This imports each re-exec'ing script under the oldest python3 on the machine
and checks the importer is still there afterwards, whether the import worked
or raised.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OLD = "/usr/bin/python3"
SCRIPTS = ("bin/hud-listen", "bin/room-listen")

PROBE = """
import importlib.machinery, importlib.util, sys
loader = importlib.machinery.SourceFileLoader("probe", sys.argv[1])
module = importlib.util.module_from_spec(importlib.util.spec_from_loader("probe", loader))
sys.modules["probe"] = module
try:
    loader.exec_module(module)
except BaseException as error:
    print("raised", type(error).__name__)
print("still-here")
"""


def main() -> int:
    failures = 0
    for interpreter in (OLD, sys.executable):
        if not Path(interpreter).exists():
            print(f"  skip  {interpreter} is not installed")
            continue
        for script in SCRIPTS:
            out = subprocess.run([interpreter, "-c", PROBE, str(ROOT / script)],
                                 capture_output=True, text=True, timeout=60,
                                 env={"PATH": "/usr/bin:/bin", "HOME": "/tmp"})
            ok = "still-here" in out.stdout
            failures += not ok
            print(f"  {'pass' if ok else 'FAIL'}  {script} imported under {interpreter}")
            if not ok:
                print(out.stdout[-400:], out.stderr[-400:])
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
