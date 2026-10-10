#!/usr/bin/env python3
"""main-ci: queues once per new commit, reads failures, and names the bisect range."""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CI = ROOT / "bin" / "main-ci"
FAILED = []


def check(name, ok):
    print(("ok   " if ok else "FAIL ") + name)
    if not ok:
        FAILED.append(name)


with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    calls = tmp / "jobs.log"
    fake_jobs = tmp / "jobs"
    fake_jobs.write_text(f"import sys, json\nopen({str(calls)!r}, 'a').write(json.dumps(sys.argv[1:]) + '\\n')\n")
    env = dict(os.environ, MAIN_CI_DIR=str(tmp / "ci"), MAIN_CI_JOBS=str(fake_jobs), MAIN_CI_NO_FETCH="1")
    head = subprocess.run(["git", "rev-parse", "origin/main"], cwd=ROOT, capture_output=True, text=True).stdout.strip()

    subprocess.run([sys.executable, str(CI), "tick"], env=env, check=True)
    subprocess.run([sys.executable, str(CI), "tick"], env=env, check=True)
    lines = calls.read_text().splitlines() if calls.exists() else []
    check("a new commit is queued once, not once per tick", len(lines) == 1)
    check("the run goes through jobs as build work", lines and json.loads(lines[0])[:2] == ["submit", "--build"]
          and json.loads(lines[0])[-1] == head)

    (tmp / "ci" / "running.json").unlink()
    results = tmp / "ci" / "results.jsonl"
    results.write_text("\n".join(json.dumps(r) for r in [
        {"sha": "a" * 40, "ok": True, "exit": 0, "at": "2026-10-10T10:00:00", "seconds": 400, "summary": "1 passed"},
        {"sha": head, "ok": False, "exit": 1, "at": "2026-10-10T11:00:00", "seconds": 410, "summary": "1 failed",
         "failures": ["hooks: the gate refuses"], "since_green": "a" * 40},
    ]) + "\n")
    subprocess.run([sys.executable, str(CI), "tick"], env=env, check=True)
    check("a commit that already has a result is not queued again", len(calls.read_text().splitlines()) == 1)
    st = subprocess.run([sys.executable, str(CI), "status"], env=env, capture_output=True, text=True)
    check("status exits 1 on a red main and names the bisect range",
          st.returncode == 1 and f"git bisect aaaaaaaa..{head[:8]}" in st.stdout and "hooks: the gate refuses" in st.stdout)

sys.path.insert(0, str(ROOT / "bin"))
import importlib.machinery, importlib.util  # noqa: E402
loader = importlib.machinery.SourceFileLoader("main_ci", str(CI))
spec = importlib.util.spec_from_loader("main_ci", loader)
mod = importlib.util.module_from_spec(spec)
loader.exec_module(mod)
log = "  \x1b[0;32mok\x1b[0m  fine\n  \x1b[0;31mFAIL\x1b[0m  installer: links the tool\n3 failed, 9 passed"
check("failure names are read from the suite output", mod.failures(log) == ["installer: links the tool"])

sys.exit(1 if FAILED else 0)
