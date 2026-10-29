"""bin/work-ledger never imports from its own folder. The launch guard lets the
ledger run near Clay (2026-10-28), and python puts a script's folder first on
sys.path, so a json.py planted in bin/ would otherwise run on import."""
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


tmp = tempfile.mkdtemp()
try:
    os.makedirs(os.path.join(tmp, "bin"))
    os.makedirs(os.path.join(tmp, "tools"))
    shutil.copy(os.path.join(ROOT, "bin", "work-ledger"), os.path.join(tmp, "bin", "work-ledger"))
    shutil.copy(os.path.join(ROOT, "tools", "work_ledger.py"), os.path.join(tmp, "tools", "work_ledger.py"))
    mark = os.path.join(tmp, "planted-ran")
    for mod in ("json", "argparse", "pathlib", "runpy"):
        with open(os.path.join(tmp, "bin", mod + ".py"), "w") as fh:
            fh.write(f"open({mark!r}, 'w').close()\nraise SystemExit('planted {mod}')\n")
    env = dict(os.environ, HOME=tmp, CHEWBACCA_STATE_DIR=os.path.join(tmp, "state"))
    p = subprocess.run([sys.executable, os.path.join(tmp, "bin", "work-ledger"), "list", "--scope", tmp],
                       capture_output=True, text=True, timeout=30, env=env)
    check("a planted module in bin/ never runs", not os.path.exists(mark), p.stderr[-200:])
    check("the ledger still runs", p.returncode == 0, p.stderr[-200:])
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print(f"{'FAIL' if failed else 'ok'}: {failed} failed")
sys.exit(1 if failed else 0)
