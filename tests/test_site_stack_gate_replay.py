#!/usr/bin/env python3
"""Replay real HTML Writes through .claude/hooks/site-stack-gate.sh.

The corpus, tests/fixtures/site-stack-gate/real_writes_2026_10_27.json, holds
pages recorded from disk on 2026-10-27: the Kyber landing that started this
(a Tailwind CDN index.html), the vote, 404, study app and deck pages that must
stay allowed, and a personal site in raw HTML. Each is rebuilt at its real
line count with its real structural tags, written with no ux-pick run and no
house stack, and must get the verdict the corpus records.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
HOOK = ROOT / ".claude/hooks/site-stack-gate.sh"
CORPUS = ROOT / "tests/fixtures/site-stack-gate/real_writes_2026_10_27.json"


def verdict(tmp: Path, case: dict) -> str:
    body = case["structure"] + ["<div></div>"] * max(0, case["lines"] - len(case["structure"]))
    target = tmp / "repo" / case["file_path"]
    payload = {"session_id": "replay", "tool_name": "Write",
               "transcript_path": str(tmp / "t.jsonl"),
               "tool_input": {"file_path": str(target), "content": "\n".join(body)}}
    env = dict(os.environ, CHEWBACCA_HOME=str(tmp / "home"), CHEWBACCA_LOG_DIR=str(tmp / "logs"))
    run = subprocess.run(["bash", str(HOOK)], input=json.dumps(payload), capture_output=True,
                         text=True, env=env)
    if run.returncode != 0:
        return f"exit {run.returncode}"
    return "deny" if '"permissionDecision": "deny"' in run.stdout else "allow"


def main() -> int:
    cases = json.loads(CORPUS.read_text())["cases"]
    fail = 0
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        (tmp / "repo/.git").mkdir(parents=True)
        (tmp / "home/state").mkdir(parents=True)
        (tmp / "t.jsonl").write_text("")
        for case in cases:
            got = verdict(tmp, case)
            ok = got == case["expect"]
            fail += not ok
            print(f"{'ok  ' if ok else 'FAIL'} {got:<5} {case['name']} ({case['lines']} lines)")
    print(f"site-stack-gate replay: {len(cases) - fail}/{len(cases)} match")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
