#!/usr/bin/env python3
"""Replay real files through .claude/hooks/gtm-reuse-gate.sh and check each recorded verdict.

Corpus: tests/fixtures/gtm_reuse/corpus.json, real scripts from 2026-10-27 (the hand-rolled
Medrano scorer, FF's lead card) and kit scripts that already build on gtme_score.
"""
import json
import os
import subprocess
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(ROOT, ".claude/hooks/gtm-reuse-gate.sh")
FIX = os.path.join(ROOT, "tests/fixtures/gtm_reuse")


def main():
    cases = json.load(open(os.path.join(FIX, "corpus.json")))
    env = dict(os.environ, CHEWBACCA_LOG_DIR=os.path.join("/tmp", "gtm-reuse-replay-logs"))
    fail = 0
    for c in cases:
        content = open(os.path.join(FIX, c["file"]), encoding="utf-8").read()
        payload = json.dumps({"tool_name": "Write", "tool_input": {"file_path": "/tmp/" + c["file"], "content": content}})
        out = subprocess.run(["bash", HOOK], input=payload, capture_output=True, text=True, env=env).stdout
        got = "deny" if '"permissionDecision": "deny"' in out else "allow"
        ok = got == c["expect"]
        fail += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {c['file']}: {got} (want {c['expect']}, {c['why']})")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
