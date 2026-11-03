#!/usr/bin/env python3
"""Replay real SPEC titles through .claude/hooks/lecture-gate.sh and check each recorded verdict.

Corpus: tests/fixtures/lecture_gate/corpus.json, the title lines of every SPEC on the
Mac on 2026-11-02 (A20, A22 and A16 for ACAD 185, then ACAD 324, WRIT 150 and non-school
specs), against the real ACAD 185 assigned-in.json that `brightspace-sync decks` wrote.
"""
import json
import os
import subprocess
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(ROOT, ".claude/hooks/lecture-gate.sh")
FIX = os.path.join(ROOT, "tests/fixtures/lecture_gate")


def main():
    cases = json.load(open(os.path.join(FIX, "corpus.json")))
    env = dict(os.environ, LECTURE_GATE_SLIDES=os.path.join(FIX, "slides"),
               CHEWBACCA_LOG_DIR=os.path.join("/tmp", "lecture-gate-replay-logs"))
    fail = 0
    for c in cases:
        payload = json.dumps({"tool_name": "Write", "tool_input": {
            "file_path": "/tmp/" + c["file"], "content": c["title"] + "\n\n" + c["body"] + "\n"}})
        rc = subprocess.run(["bash", HOOK], input=payload, capture_output=True, text=True, env=env).returncode
        got = "deny" if rc == 2 else "allow"
        ok = got == c["expect"]
        fail += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {c['title'][:50]}: {got} (want {c['expect']}, {c['why']})")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
